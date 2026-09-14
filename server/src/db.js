'use strict';

const crypto = require('crypto');
const Database = require('better-sqlite3');

/**
 * Schema migrations, applied in order. Each entry's `version` becomes the value
 * in schema_version once it has run. Never edit a migration that has shipped —
 * add a new one, so an existing billing.db upgrades the same way a fresh one is
 * built.
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(`
        -- The single account. No roles, no second user; the CHECK keeps it that
        -- way rather than relying on the app to remember.
        CREATE TABLE account (
          id            INTEGER PRIMARY KEY CHECK (id = 1),
          username      TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );

        -- Session tokens are stored hashed, so a stolen copy of billing.db does
        -- not hand over a live session.
        CREATE TABLE sessions (
          id           TEXT PRIMARY KEY,
          created_at   TEXT NOT NULL,
          expires_at   TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          user_agent   TEXT,
          ip           TEXT
        );
        CREATE INDEX idx_sessions_expires ON sessions (expires_at);

        -- The CRM.
        CREATE TABLE clients (
          id            TEXT PRIMARY KEY,
          business_name TEXT NOT NULL DEFAULT '',
          contact_name  TEXT NOT NULL DEFAULT '',
          email         TEXT NOT NULL DEFAULT '',
          phone         TEXT NOT NULL DEFAULT '',
          abn           TEXT NOT NULL DEFAULT '',
          address       TEXT NOT NULL DEFAULT '',
          notes         TEXT NOT NULL DEFAULT '',
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );
        CREATE INDEX idx_clients_business ON clients (business_name COLLATE NOCASE);

        CREATE TABLE estimates (
          id              TEXT PRIMARY KEY,
          upid            TEXT NOT NULL DEFAULT '',
          name            TEXT NOT NULL DEFAULT '',
          date            TEXT NOT NULL DEFAULT '',
          status          TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','sent','approved','invoiced','paid')),
          doc_type        TEXT NOT NULL DEFAULT 'estimate'
                            CHECK (doc_type IN ('estimate','invoice')),
          invoice_number  TEXT NOT NULL DEFAULT '',
          -- Link to the CRM record, kept loose on purpose: deleting a client
          -- must never delete or rewrite the estimates they appear on.
          client_id       TEXT REFERENCES clients(id) ON DELETE SET NULL,
          -- The client details as they were when this estimate was saved. This
          -- is what the PDF renders from, so an old quote never changes when a
          -- client's address is edited later.
          client_json     TEXT NOT NULL DEFAULT '{}',
          notes           TEXT NOT NULL DEFAULT '',
          active_rows_json TEXT NOT NULL DEFAULT '{}',
          totals_json     TEXT NOT NULL DEFAULT '{}',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          -- Derived from totals_json rather than stored twice, so the list view
          -- can sort by value without a second source of truth to keep in sync.
          total_inc_gst   REAL GENERATED ALWAYS AS
                            (json_extract(totals_json, '$.totalIncGst')) VIRTUAL
        );
        CREATE INDEX idx_estimates_updated ON estimates (updated_at DESC);
        CREATE INDEX idx_estimates_client  ON estimates (client_id);
        CREATE INDEX idx_estimates_status  ON estimates (status);

        -- Pricing and settings are each one JSON document with one row. They
        -- are edited whole, read whole, and their shape belongs to the UI.
        CREATE TABLE pricing (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          data_json  TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE settings (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          data_json  TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'snapshot labour category labels onto estimates',
    up(db) {
      // The labour category label is printed as a heading on the client-facing
      // PDF (see serviceItemsHtml in pdf.js). Until now it was read from the
      // live rate card at render time, so renaming a category silently
      // re-headed every quote already sent under the old name, and deleting one
      // re-headed them "Archived Services". The label belongs to the estimate
      // for the same reason client_json does: the document was sent, and it
      // must not change afterwards.
      //
      // Existing rows default to '{}' and fall back to the live card, which is
      // the behaviour they have today — no estimate changes when this runs.
      db.exec(`
        ALTER TABLE estimates
          ADD COLUMN section_labels_json TEXT NOT NULL DEFAULT '{}';
      `);
    },
  },
  {
    version: 3,
    name: 'per-estimate GST-free flag',
    up(db) {
      // Being GST-registered does not make every job GST-bearing. Until now GST
      // was all-or-nothing per business (settings.gst.registered), so a GST-free
      // job could only be quoted by switching GST off account-wide, which would
      // have re-priced every other estimate saved afterwards.
      //
      // It lives on the estimate rather than being worked out at render time for
      // the same reason client_json and section_labels_json do: the tax
      // treatment of a document that has already gone to a client must not
      // change underneath it.
      //
      // Existing rows default to 0, which is the behaviour they have today — no
      // estimate's totals change when this runs.
      db.exec(`
        ALTER TABLE estimates
          ADD COLUMN gst_free INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function nowIso() {
  return new Date().toISOString();
}

/** Short, readable, collision-resistant ids: est_9f3a1c2b. */
function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function currentVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  return row && row.v ? row.v : 0;
}

/**
 * Applies any migrations newer than the file's recorded version. Safe to run on
 * a fresh file and on an existing one; running it twice does nothing the second
 * time.
 */
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const from = currentVersion(db);
  if (from > LATEST_VERSION) {
    throw new Error(
      `billing.db is at schema version ${from}, but this build only knows up to ` +
      `${LATEST_VERSION}. Refusing to run against a newer database.`
    );
  }

  const pending = MIGRATIONS.filter((m) => m.version > from);
  const record = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)');

  for (const migration of pending) {
    // Each migration lands whole or not at all.
    db.transaction(() => {
      migration.up(db);
      record.run(migration.version, nowIso());
    })();
    console.log(`[db] migrated to v${migration.version} — ${migration.name}`);
  }

  return { from, to: currentVersion(db), applied: pending.length };
}

/**
 * Opens billing.db, verifies it, and brings the schema up to date.
 *
 * A file that fails its integrity check is left exactly as it is: the server
 * refuses to start rather than writing over damaged data that a backup could
 * still be recovered from.
 */
function openDatabase(file, options = {}) {
  const db = new Database(file, { fileMustExist: false });

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // WAL + NORMAL is durable across process crashes; only a host power-cut can
  // lose the last transaction, which the nightly backup covers.
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  const check = db.pragma('quick_check', { simple: true });
  if (check !== 'ok') {
    db.close();
    throw new Error(
      `billing.db failed its integrity check (${check}). The file has NOT been ` +
      `modified. Restore the most recent copy from the backups directory before ` +
      `starting the server again.`
    );
  }

  if (options.migrate !== false) migrate(db);

  return db;
}

module.exports = { openDatabase, migrate, newId, nowIso, LATEST_VERSION };
