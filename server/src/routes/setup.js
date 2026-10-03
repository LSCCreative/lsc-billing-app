'use strict';

const { nowIso } = require('../db');
const { normUpid, upidTakenBy, upidTakenReply } = require('../projects');

/**
 * The UPID fix-up (production-booking task 16; D60, D61, IA flow 7).
 *
 * v13 gave every estimate whose UPID was shared or blank a project of its
 * own with `upid` NULL and `needs_upid` 1, and left the old UPID on the
 * estimate row. Nothing was guessed. This is where the owner sorts them out,
 * one group at a time:
 *
 * - A GROUP is the waiting estimates carrying one UPID, ignoring case and the
 *   spaces round it. A blank one is a group of its own: blanks never belong
 *   together. Its key is `u:<upid, lowercased and trimmed>` or `e:<estimate
 *   id>`, and a POST names the group by it.
 * - ASSIGN gives every estimate in the group a UPID, at once. One of them may
 *   keep the shared UPID: the rest are being renamed in the same write, so it
 *   is theirs to give up. Two in the group may not end on the same UPID (that
 *   is keep together), and none may take one another project uses.
 * - KEEP TOGETHER makes one project of the group, under its shared UPID: the
 *   oldest estimate's project, with the others' estimates, invoices and
 *   activity moved into it and their emptied projects deleted. A project is
 *   under one client (D31), so two estimates linked to different clients are
 *   refused; an unlinked one goes along with either.
 *
 * Either way the whole group settles in one transaction, and a POST whose
 * estimates aren't the group's as it stands now is refused (`group_changed`),
 * so a second tab can't settle half a group the first one has since changed.
 */

function waitingEstimates(db) {
  return db.prepare(`
    SELECT e.id, e.project_id, e.upid, e.name, e.date, e.status, e.doc_type, e.invoice_number,
           e.client_id, e.client_json, e.totals_json, e.created_at
      FROM estimates e
      JOIN projects p ON p.id = e.project_id
     WHERE p.needs_upid = 1
     ORDER BY e.created_at, e.id
  `).all();
}

const keyOf = (row) => {
  const upid = normUpid(row.upid);
  return upid ? 'u:' + upid.toLowerCase() : 'e:' + row.id;
};

/** Distinct client ids among a group's estimates, unlinked ones left out. */
const clientIds = (rows) => [...new Set(rows.map((r) => r.client_id).filter(Boolean))];

/** The waiting estimates as groups: Map of key -> rows, oldest estimate first. */
function readGroups(db) {
  const groups = new Map();
  waitingEstimates(db).forEach((row) => {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

function groupJson(key, rows) {
  const upid = normUpid(rows[0].upid);
  const differ = clientIds(rows).length > 1;
  return {
    key,
    // The UPID they share, as the oldest one spells it; '' for a blank one.
    upid,
    canKeepTogether: Boolean(upid) && rows.length > 1 && !differ,
    clientsDiffer: differ,
    estimates: rows.map((r) => {
      const client = JSON.parse(r.client_json || '{}');
      const totals = JSON.parse(r.totals_json || '{}');
      return {
        id: r.id,
        projectId: r.project_id,
        upid: r.upid,
        name: r.name,
        date: r.date,
        status: r.status,
        docType: r.doc_type,
        invoiceNumber: r.invoice_number,
        client: client.businessName || '',
        totalIncGst: typeof totals.totalIncGst === 'number' ? totals.totalIncGst : null,
      };
    }),
  };
}

/** What GET answers, and what a POST answers with once it has written. */
function listing(db) {
  const groups = [...readGroups(db)].map(([key, rows]) => groupJson(key, rows));
  // Named groups by UPID, then the blank ones, oldest first (already in order).
  groups.sort((a, b) => {
    if (!a.upid !== !b.upid) return a.upid ? -1 : 1;
    return a.upid.localeCompare(b.upid, 'en', { numeric: true, sensitivity: 'base' });
  });
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE needs_upid = 1').get().n;
  return { ok: true, remaining, groups };
}

const refuse = (res, status, body) => res.status(status).json(body);

/** Every estimate in the group gets the UPID typed for it. */
function assign(db, rows, upids, res) {
  if (!Array.isArray(upids)) return refuse(res, 400, { error: 'bad_request' });
  const wanted = new Map();
  for (const item of upids) {
    if (!item || typeof item.estimateId !== 'string') return refuse(res, 400, { error: 'bad_request' });
    wanted.set(item.estimateId, normUpid(item.upid));
  }
  if (wanted.size !== upids.length || wanted.size !== rows.length || rows.some((r) => !wanted.has(r.id))) {
    return refuse(res, 409, { error: 'group_changed' });
  }

  const seen = new Map();
  for (const r of rows) {
    const upid = wanted.get(r.id);
    if (!upid) return refuse(res, 400, { error: 'upid_required', estimateId: r.id });
    const other = seen.get(upid.toLowerCase());
    if (other) return refuse(res, 400, { error: 'upid_repeated', upid, estimateIds: [other, r.id] });
    seen.set(upid.toLowerCase(), r.id);
  }

  // The group's own projects don't count: one of them may keep the shared UPID.
  const own = rows.map((r) => r.project_id);
  for (const r of rows) {
    const taken = upidTakenBy(db, wanted.get(r.id), own);
    if (taken) {
      const reply = upidTakenReply(db, wanted.get(r.id), taken);
      return refuse(res, reply.status, { ...reply.body, estimateId: r.id });
    }
  }

  // A waiting project holds exactly one estimate (v13 made one each, and only
  // v13 makes a waiting project), so the project takes its estimate's UPID.
  const now = nowIso();
  db.transaction(() => {
    for (const r of rows) {
      db.prepare('UPDATE projects SET upid = ?, needs_upid = 0, updated_at = ? WHERE id = ?')
        .run(wanted.get(r.id), now, r.project_id);
      db.prepare('UPDATE estimates SET upid = ? WHERE project_id = ?').run(wanted.get(r.id), r.project_id);
    }
  })();
  return res.json(listing(db));
}

/** One project for the whole group, under the UPID it shares. */
function keepTogether(db, rows, res) {
  const upid = normUpid(rows[0].upid);
  if (!upid || rows.length < 2) return refuse(res, 400, { error: 'nothing_to_keep' });
  const clients = clientIds(rows);
  if (clients.length > 1) return refuse(res, 409, { error: 'clients_differ' });

  const target = rows[0].project_id;
  const others = [...new Set(rows.map((r) => r.project_id))].filter((id) => id !== target);
  const taken = upidTakenBy(db, upid, [target, ...others]);
  if (taken) return refuse(res, 409, upidTakenReply(db, upid, taken).body);

  const projects = [target, ...others].map((id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  const first = (field) => {
    const found = projects.find((p) => p[field] != null);
    return found ? found[field] : null;
  };
  const accepted = projects.map((p) => p.accepted_at).filter(Boolean).sort();
  // Declined only if every one of them was: one live estimate keeps the job open.
  const declined = !accepted.length && projects.every((p) => p.declined_at)
    ? projects.map((p) => p.declined_at).sort().pop()
    : null;
  const now = nowIso();

  db.transaction(() => {
    const move = (table) => db.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`);
    for (const id of others) {
      move('invoices').run(target, id);
      move('activity').run(target, id);
      move('estimates').run(target, id);
    }
    db.prepare(`
      UPDATE projects SET upid = ?, needs_upid = 0, client_id = ?, invoicing = ?, deposit_pct = ?,
             accepted_at = ?, declined_at = ?, created_at = ?, updated_at = ?
       WHERE id = ?
    `).run(
      upid, clients[0] || first('client_id'), first('invoicing'), first('deposit_pct'),
      accepted[0] || null, declined, projects.map((p) => p.created_at).sort()[0], now, target
    );
    db.prepare('UPDATE estimates SET upid = ? WHERE project_id = ?').run(upid, target);
    for (const id of others) db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  })();
  return res.json(listing(db));
}

function registerSetupRoutes(app, db) {
  app.get('/api/setup/upids', (_req, res) => {
    res.json(listing(db));
  });

  /* { key, upids: [{ estimateId, upid }] } or { key, keepTogether: true }. */
  app.post('/api/setup/upids', (req, res) => {
    const body = req.body || {};
    if (typeof body.key !== 'string') return refuse(res, 400, { error: 'bad_request' });
    const rows = readGroups(db).get(body.key);
    if (!rows) return refuse(res, 409, { error: 'group_changed' });
    if (body.keepTogether === true) return keepTogether(db, rows, res);
    return assign(db, rows, body.upids, res);
  });
}

module.exports = { registerSetupRoutes };
