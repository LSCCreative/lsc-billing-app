'use strict';

const crypto = require('crypto');

/**
 * MIGRATION v13 — projects, the new estimate statuses, invoices and activity
 * (.design/production-booking/ task 15; IA "Data Model", Stage D).
 *
 * Runs with foreign keys OFF (db.js `foreignKeysOff`, checked with
 * foreign_key_check before it commits). Step 2 rebuilds `estimates` to change
 * its status CHECK, and with foreign keys on, DROP TABLE estimates would
 * cascade-delete every production day (v11) and gear rental (v12).
 *
 * Safe to run twice, as every migration since v9 is: the upgrade tests rewind
 * schema_version and re-run everything after the version they rewound to.
 * The second time, every table exists, `estimates` already has project_id,
 * every estimate already has a project and every legacy invoice exists, so
 * nothing changes.
 *
 * 1. TABLES. `projects` (one per UPID, D31), `invoices` and `activity`.
 *    `projects.upid` is UNIQUE, case-insensitively, and NULL while a project
 *    waits for the fix-up screen (`needs_upid`, D61) or is a new draft with
 *    no UPID typed yet (needs_upid 0: nothing to fix, it just isn't named).
 *    Invoice numbers are unique among invoices this app makes (`INV-<UPID>-D`
 *    and so on, D36); a legacy invoice keeps whatever number it was printed
 *    with, duplicates and blanks included, because it already went out.
 *
 * 2. STATUSES. draft | sent | accepted | declined (expired is derived).
 *    approved → accepted. invoiced and paid → accepted, plus a legacy invoice
 *    (step 4). An estimate whose Document Type was Invoice is accepted too:
 *    no screen ever set a status (DECISIONS, "Found in the code"), so on the
 *    live data the doc type is the only sign a job went ahead, and a project
 *    with an invoice in it has, by definition, been accepted.
 *
 * 3. PROJECTS. Every estimate without one gets one. A UPID used by exactly one
 *    estimate (trimmed, case-insensitive) becomes that project's UPID. A
 *    shared or blank one is never guessed at (D61): each such estimate gets
 *    its own project with upid NULL and needs_upid 1, and keeps its old UPID
 *    on the estimate row, which is how the fix-up screen groups them. An
 *    accepted estimate's project is accepted at the estimate's updated_at,
 *    the last time anyone touched it: the closest date there is.
 *
 * 4. LEGACY INVOICES (D62). Each estimate that was an invoice (doc type
 *    Invoice, or status invoiced / paid) yields one `legacy` invoice in its
 *    project. It carries the estimate's invoice number and a copy of its
 *    stored totals, never repriced, and a snapshot of the row, so a later
 *    edit to the estimate can't change an invoice that went out. Its status
 *    is what the old row said: paid → paid; invoiced or sent → sent;
 *    otherwise draft. The paid date was never recorded, so paid_at is NULL.
 *    issued_at is the document's own date, if it had one.
 *
 * Nothing touches a stored total: every estimate's totals_json, rows,
 * labels, days and rentals are copied across as they are.
 */
function migrateV13(db) {
  createTables(db);
  const legacy = legacyCandidates(db);
  if (!hasColumn(db, 'estimates', 'project_id')) rebuildEstimates(db);
  const made = assignProjects(db);
  const invoices = addLegacyInvoices(db, legacy);
  const needs = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE needs_upid = 1').get().n;
  const total = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  console.log(`[db] v13: ${total} project(s) (${made} new), ${needs} need a UPID, ${invoices} legacy invoice(s) made`);
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      upid        TEXT COLLATE NOCASE UNIQUE
                    CHECK (upid IS NULL OR (upid <> '' AND upid = trim(upid))),
      client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
      needs_upid  INTEGER NOT NULL DEFAULT 0 CHECK (needs_upid IN (0, 1)),
      invoicing   TEXT CHECK (invoicing IN ('pair', 'single')),
      deposit_pct REAL,
      accepted_at TEXT,
      declined_at TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_client ON projects (client_id);
    CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects (updated_at DESC);

    CREATE TABLE IF NOT EXISTS invoices (
      id                     TEXT PRIMARY KEY,
      project_id             TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      estimate_id            TEXT REFERENCES estimates(id) ON DELETE SET NULL,
      kind                   TEXT NOT NULL CHECK (kind IN ('deposit', 'final', 'single', 'legacy')),
      number                 TEXT,
      status                 TEXT NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'scheduled', 'sent', 'paid', 'void')),
      pct                    REAL,
      estimate_snapshot_json TEXT,
      extras_json            TEXT NOT NULL DEFAULT '{}',
      totals_json            TEXT NOT NULL DEFAULT '{}',
      less_invoice_id        TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      issued_at              TEXT,
      due_at                 TEXT,
      paid_at                TEXT,
      paid_via               TEXT CHECK (paid_via IN ('bank', 'card')),
      card_fee               REAL,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices (project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number
      ON invoices (number COLLATE NOCASE) WHERE kind <> 'legacy' AND number IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_legacy_estimate
      ON invoices (estimate_id) WHERE kind = 'legacy' AND estimate_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS activity (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      at          TEXT NOT NULL,
      kind        TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_activity_at ON activity (at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_project ON activity (project_id, at DESC);
  `);
}

/**
 * Read BEFORE the rebuild, which maps invoiced / paid to accepted and so
 * loses what the old row said. On a re-run the statuses are already new, and
 * the doc type is what finds them (their invoices exist by then anyway).
 */
function legacyCandidates(db) {
  return db.prepare(`
    SELECT * FROM estimates
     WHERE doc_type = 'invoice' OR status IN ('invoiced', 'paid')
     ORDER BY created_at, id
  `).all();
}

/** SQLite can't alter a CHECK, so the table is rebuilt (the v6 / v8 pattern). */
function rebuildEstimates(db) {
  db.exec(`
    CREATE TABLE estimates_v13 (
      id               TEXT PRIMARY KEY,
      upid             TEXT NOT NULL DEFAULT '',
      name             TEXT NOT NULL DEFAULT '',
      date             TEXT NOT NULL DEFAULT '',
      -- draft | sent | accepted | declined (v13). "Expired" is derived from a
      -- sent version's valid-until, never stored.
      status           TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'sent', 'accepted', 'declined')),
      -- Retired by D62: kept for rows made before it, no longer written.
      doc_type         TEXT NOT NULL DEFAULT 'estimate'
                         CHECK (doc_type IN ('estimate', 'invoice')),
      invoice_number   TEXT NOT NULL DEFAULT '',
      -- Link to the CRM record, kept loose on purpose: deleting a client
      -- must never delete or rewrite the estimates they appear on.
      client_id        TEXT REFERENCES clients(id) ON DELETE SET NULL,
      -- The client details as they were when this estimate was saved.
      client_json      TEXT NOT NULL DEFAULT '{}',
      notes            TEXT NOT NULL DEFAULT '',
      active_rows_json TEXT NOT NULL DEFAULT '{}',
      totals_json      TEXT NOT NULL DEFAULT '{}',
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      -- Derived from totals_json rather than stored twice.
      total_inc_gst    REAL GENERATED ALWAYS AS
                         (json_extract(totals_json, '$.totalIncGst')) VIRTUAL,
      section_labels_json TEXT NOT NULL DEFAULT '{}',
      gst_free         INTEGER NOT NULL DEFAULT 0,
      short_notice     INTEGER NOT NULL DEFAULT 0,
      surcharges_json  TEXT NOT NULL DEFAULT '{}',
      -- v13. NULL only between an insert that skipped the routes and the next
      -- migration run, which gives it one. Deleting a project deletes its
      -- estimates (and, through them, their days and rentals).
      project_id       TEXT REFERENCES projects(id) ON DELETE CASCADE
    );
    INSERT INTO estimates_v13
      (id, upid, name, date, status, doc_type, invoice_number, client_id, client_json, notes,
       active_rows_json, totals_json, created_at, updated_at, section_labels_json, gst_free,
       short_notice, surcharges_json, project_id)
    SELECT id, upid, name, date,
           CASE WHEN status IN ('approved', 'invoiced', 'paid') OR doc_type = 'invoice'
                THEN 'accepted' ELSE status END,
           doc_type, invoice_number, client_id, client_json, notes,
           active_rows_json, totals_json, created_at, updated_at, section_labels_json, gst_free,
           short_notice, surcharges_json, NULL
      FROM estimates;
    DROP TABLE estimates;
    ALTER TABLE estimates_v13 RENAME TO estimates;
    CREATE INDEX idx_estimates_updated ON estimates (updated_at DESC);
    CREATE INDEX idx_estimates_client  ON estimates (client_id);
    CREATE INDEX idx_estimates_status  ON estimates (status);
    CREATE INDEX idx_estimates_project ON estimates (project_id);
  `);
}

/** Step 3. Returns how many projects it made. */
function assignProjects(db) {
  const orphans = db.prepare(`
    SELECT id, upid, client_id, status, created_at, updated_at
      FROM estimates WHERE project_id IS NULL ORDER BY created_at, id
  `).all();
  if (!orphans.length) return 0;

  const key = (upid) => String(upid || '').trim().toLowerCase();
  const groups = new Map();
  for (const e of orphans) {
    const k = key(e.upid);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  // A UPID already held by a project, or by an estimate that has one, is
  // taken: an orphan using it is a shared one.
  const held = db.prepare(`
    SELECT 1 FROM projects WHERE upid = @upid
     UNION ALL
    SELECT 1 FROM estimates WHERE project_id IS NOT NULL AND lower(trim(upid)) = lower(@upid)
     LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO projects (id, upid, client_id, needs_upid, accepted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const link = db.prepare('UPDATE estimates SET project_id = ? WHERE id = ?');
  const trimUpid = db.prepare('UPDATE estimates SET upid = ? WHERE id = ? AND upid <> ?');

  let made = 0;
  for (const [k, list] of groups) {
    const unique = k !== '' && list.length === 1 && !held.get({ upid: list[0].upid.trim() });
    for (const e of list) {
      const id = newId('prj');
      const upid = unique ? e.upid.trim() : null;
      insert.run(id, upid, e.client_id, unique ? 0 : 1,
        e.status === 'accepted' ? e.updated_at : null, e.created_at, e.updated_at);
      link.run(id, e.id);
      if (unique) trimUpid.run(upid, e.id, upid);
      made += 1;
    }
  }
  return made;
}

const LEGACY_STATUS = { paid: 'paid', invoiced: 'sent', sent: 'sent' };

/** Step 4. Returns how many legacy invoices it made. */
function addLegacyInvoices(db, candidates) {
  const projectOf = db.prepare('SELECT project_id FROM estimates WHERE id = ?');
  const insert = db.prepare(`
    INSERT OR IGNORE INTO invoices
      (id, project_id, estimate_id, kind, number, status, estimate_snapshot_json, totals_json,
       issued_at, created_at, updated_at)
    VALUES (?, ?, ?, 'legacy', ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  let made = 0;
  for (const e of candidates) {
    const row = projectOf.get(e.id);
    if (!row || !row.project_id) continue;
    const snapshot = { ...e };
    delete snapshot.total_inc_gst;
    delete snapshot.project_id;
    const result = insert.run(
      newId('inv'), row.project_id, e.id,
      String(e.invoice_number || '').trim() || null,
      LEGACY_STATUS[e.status] || 'draft',
      JSON.stringify(snapshot), e.totals_json || '{}',
      e.date || null, now, now
    );
    made += result.changes;
  }
  return made;
}

module.exports = { migrateV13 };
