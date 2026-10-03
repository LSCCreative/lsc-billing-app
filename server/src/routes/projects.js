'use strict';

const { newId, nowIso } = require('../db');
const { STAGES, projectStage, settledAt } = require('../projects');
const { readDays } = require('../days');
const { readRentals } = require('../rentals');
const { loadEstimate } = require('../estimate');

/* A paid or declined project leaves the Active view this long after it got
   there (IA, Content Growth Plan). Its own chip, and a search, still find it. */
const SETTLED_DAYS = 90;
const PAGE = 50;
const MAX_PAGE = 200;

/* A real calendar date: '2026-13-01' and '2026-02-30' are not (an invalid
   Date's toISOString throws, so it is checked first). */
const isYmd = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

function addDays(ymd, n) {
  return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/* The server's own date, only for a caller that sends no `today`. */
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* `today` from the query, the server's date when absent, or null when bad. */
function todayOf(req) {
  const today = req.query.today === undefined ? localToday() : String(req.query.today);
  return isYmd(today) ? today : null;
}

function groupBy(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const list = map.get(row[key]);
    if (list) list.push(row);
    else map.set(row[key], [row]);
  });
  return map;
}

const latest = (...values) => values.filter(Boolean).sort().pop() || '';

const parseDetail = (json) => {
  try {
    return JSON.parse(json || '{}') || {};
  } catch (_) {
    return {}; // a bad row reads as one with no detail
  }
};

/* The latest `sent` activity row, as projectStage takes it. */
const sendOf = (row) => {
  if (!row) return undefined;
  const detail = parseDetail(row.detail_json);
  return { at: row.at, version: detail.version, validUntil: detail.validUntil };
};

/* The columns summarize() reads from an estimate. */
const ESTIMATE_COLUMNS = 'id, project_id, upid, name, date, status, client_json, total_inc_gst, updated_at';
const INVOICE_COLUMNS = 'project_id, kind, number, status, due_at, paid_at, updated_at';

/* The first booked date from `today` on. Declined estimates' days are on no
   calendar (D22), so they're no one's next day either. */
const NEXT_DAY_SQL = `
  SELECT e.project_id, d.date, d.status
    FROM production_days d JOIN estimates e ON e.id = d.estimate_id
   WHERE d.date IS NOT NULL AND d.date >= ? AND e.status <> 'declined' AND e.project_id IS NOT NULL`;

/**
 * ONE PROJECT, AS EVERY SCREEN SHOWS IT: the list's card, the client's
 * projects and the folder's Overview are all this, so the three can't
 * disagree (IA, "Stage line (new, one function)").
 *
 * A project's NAME, total and client are its lead estimate's: the one most
 * recently changed that isn't declined. Since v13 a project has one estimate;
 * only a group the fix-up kept together has more (`estimateCount`).
 *
 * `own` are its estimates (ESTIMATE_COLUMNS), `bills` its invoices
 * (INVOICE_COLUMNS), and `ctx` what is read across every project at once:
 * { sent, nextDay, client (the clients row), lastActivityAt }.
 */
function summarize(p, own, bills, ctx) {
  const where = projectStage(p, own, bills, ctx.sent);
  const lead = own.slice().sort((a, b) =>
    (a.status === 'declined') - (b.status === 'declined') ||
    (b.updated_at > a.updated_at) - (b.updated_at < a.updated_at) ||
    (a.id < b.id ? -1 : 1))[0] || null;
  const snapshot = lead ? JSON.parse(lead.client_json || '{}') : {};
  const record = ctx.client || null;
  const { stage, ...stageDetail } = where;
  return {
    id: p.id,
    upid: p.upid,
    needsUpid: p.needs_upid === 1,
    name: lead ? lead.name : '',
    client: {
      id: p.client_id || null,
      businessName: snapshot.businessName || (record && record.business_name) || '',
      contactName: snapshot.contactName || (record && record.contact_name) || '',
    },
    stage,
    stageDetail,
    totalIncGst: lead ? lead.total_inc_gst : 0,
    estimateId: lead ? lead.id : null,
    estimateCount: own.length,
    nextDay: ctx.nextDay || null,
    lastActivityAt: latest(p.updated_at, ...own.map((e) => e.updated_at),
      ...bills.map((i) => i.updated_at), ctx.lastActivityAt),
  };
}

/**
 * The project folder in one read (task 18; IA "Project folder"): the summary
 * every screen shares, plus what only the folder shows — each estimate whole
 * (days and rentals included, lead first), the invoices, and the activity log,
 * newest first. Null when there is no such project.
 */
function readFolder(db, id, today) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) return null;
  const own = db.prepare(`SELECT ${ESTIMATE_COLUMNS} FROM estimates WHERE project_id = ?`).all(id);
  const bills = db.prepare(`
    SELECT * FROM invoices WHERE project_id = ?
     ORDER BY CASE kind WHEN 'deposit' THEN 0 WHEN 'final' THEN 1 WHEN 'single' THEN 2 ELSE 3 END, created_at, id
  `).all(id);
  const log = db.prepare('SELECT * FROM activity WHERE project_id = ? ORDER BY at DESC, id DESC').all(id);
  const next = db.prepare(NEXT_DAY_SQL + ' AND e.project_id = ? ORDER BY d.date, d.start_time, d.id LIMIT 1')
    .get(today, id);
  const project = summarize(p, own, bills, {
    sent: sendOf(log.find((a) => a.kind === 'sent')),
    nextDay: next ? { date: next.date, status: next.status } : null,
    client: p.client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(p.client_id) : null,
    lastActivityAt: log.length ? log[0].at : null,
  });
  Object.assign(project, {
    acceptedAt: p.accepted_at || null,
    declinedAt: p.declined_at || null,
    invoicing: p.invoicing || null,
    depositPct: p.deposit_pct === null || p.deposit_pct === undefined ? null : p.deposit_pct,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  });
  const rows = db.prepare('SELECT * FROM estimates WHERE project_id = ?').all(id);
  const estimates = rows
    .map((row) => loadEstimate(row, readDays(db, row.id), readRentals(db, row.id)))
    .sort((a, b) => (a.id === project.estimateId ? -1 : b.id === project.estimateId ? 1 : 0) ||
      (b.updatedAt > a.updatedAt) - (b.updatedAt < a.updatedAt));
  return {
    project,
    estimates,
    invoices: bills.map((i) => ({
      id: i.id,
      kind: i.kind,
      number: i.number || null,
      status: i.status,
      estimateId: i.estimate_id || null,
      pct: i.pct === null ? null : i.pct,
      totalIncGst: Number(parseDetail(i.totals_json).totalIncGst) || 0,
      issuedAt: i.issued_at || null,
      dueAt: i.due_at || null,
      paidAt: i.paid_at || null,
      paidVia: i.paid_via || null,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    })),
    activity: log.map((a) => ({ id: a.id, at: a.at, kind: a.kind, detail: parseDetail(a.detail_json) })),
  };
}

function logActivity(db, projectId, kind, detail, now) {
  db.prepare('INSERT INTO activity (id, project_id, at, kind, detail_json) VALUES (?, ?, ?, ?, ?)')
    .run(newId('act'), projectId, now, kind, JSON.stringify(detail || {}));
}

/* Where a project is, for the actions' own checks: the same projectStage. */
function stageNow(db, p) {
  const own = db.prepare(`SELECT ${ESTIMATE_COLUMNS} FROM estimates WHERE project_id = ?`).all(p.id);
  const bills = db.prepare(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE project_id = ?`).all(p.id);
  return { stage: projectStage(p, own, bills).stage, own, bills };
}

/* Every date another project has confirmed under one of these days, unless
   the day carries a specification note (D16) — the lock lockedDay applies to
   a new day, run over each one, so a refusal can name them all. */
function lockedDates(db, estimateIds) {
  const days = db.prepare(`
    SELECT d.id, d.estimate_id, d.date FROM production_days d
     WHERE d.estimate_id IN (SELECT value FROM json_each(?)) AND d.date IS NOT NULL AND d.override_note = ''
     ORDER BY d.date, d.id
  `).all(JSON.stringify(estimateIds));
  const holder = db.prepare(`
    SELECT e.upid, e.name, d.status FROM production_days d JOIN estimates e ON e.id = d.estimate_id
     WHERE d.date = ? AND d.status = ? AND e.status <> 'declined'
       AND d.estimate_id NOT IN (SELECT value FROM json_each(?))
     ORDER BY e.upid, e.id LIMIT 1
  `);
  const ids = JSON.stringify(estimateIds);
  const out = { confirmed: [], pencilled: [] };
  const seen = new Set();
  days.forEach((d) => {
    if (seen.has(d.date)) return;
    seen.add(d.date);
    const hit = holder.get(d.date, 'confirmed', ids);
    if (hit) return out.confirmed.push({ date: d.date, upid: hit.upid || '', name: hit.name || '' });
    const soft = holder.get(d.date, 'pencilled', ids);
    if (soft) out.pencilled.push({ date: d.date, upid: soft.upid || '', name: soft.name || '' });
  });
  return out;
}

const whoHas = (c) => c.upid || (c.name ? `“${c.name}”` : 'another project');

/**
 * Projects (production-booking tasks 17, 18; IA "Projects", "Project folder").
 *
 * GET /api/projects — one card per project, newest activity first.
 *
 * Query:
 *   stage   `active` (the default), `all`, or one of projects.js STAGES. Active
 *           is every project except paid and declined ones settled more than
 *           90 days ago, unless `q` is given: a search looks at everything.
 *   q       matched, ignoring case, against the UPID (the project's, and the
 *           old one a project waiting for the fix-up still carries), every
 *           estimate's name, and the client's business and contact name.
 *   client  only that client's projects (the Clients screen's history).
 *   today   the browser's date (YYYY-MM-DD), which the 90 days and "next
 *           production day" are counted from, as every date in the app is.
 *   limit   1–200, default 50; `before` is the reply's `next`, for Show more.
 *
 * Every project is read and filtered here rather than in SQL: the stage comes
 * from its estimates and invoices together (projectStage), and one owner's
 * projects run to hundreds, not millions.
 *
 * GET /api/projects/:id?today= — the folder (readFolder).
 *
 * THE FOLDER'S ACTIONS (task 18). Each answers with the folder as it now
 * stands, so the screen redraws from one reply, and each logs an `activity`
 * row. Accepting and invoices are task 19's.
 *
 *   POST /sent     { validUntil } — Mark sent, Stage D's stand-in for sending
 *                  (E replaces it). The lead estimate becomes `sent`, and the
 *                  `sent` row's detail carries validUntil, which the stage line
 *                  reads ("valid until", "expired", D44). No version: nothing
 *                  is frozen until E (D34). Refused once declined or accepted.
 *   POST /decline  The owner's no-go (D22): every estimate becomes declined,
 *                  so its days leave the calendars and lock nothing. Refused
 *                  once an invoice exists; a second decline changes nothing.
 *   POST /reopen   Back to draft, days back on the calendars — through the
 *                  clash check again (D22): a date another project has since
 *                  confirmed refuses it, `date_locked`, naming every such
 *                  date, unless that day carries a specification note (D16).
 *                  Pencilled ones are only named in the reply (D15).
 *   DELETE         The project and everything in it: estimates, days,
 *                  rentals, invoices, activity. Refused while an invoice has
 *                  gone out or been paid (a made-the-old-way one excepted, as
 *                  deleting its estimate always took it).
 */
function registerProjectRoutes(app, db) {
  app.get('/api/projects', (req, res) => {
    const stage = String(req.query.stage || 'active');
    if (stage !== 'active' && stage !== 'all' && !STAGES.includes(stage)) {
      return res.status(400).json({ error: 'stage_invalid' });
    }
    const today = todayOf(req);
    if (!today) return res.status(400).json({ error: 'today_invalid' });
    const limit = req.query.limit === undefined ? PAGE : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      return res.status(400).json({ error: 'limit_invalid' });
    }
    const q = String(req.query.q || '').trim().toLowerCase();
    const clientId = req.query.client === undefined ? null : String(req.query.client);
    const before = req.query.before === undefined ? null : String(req.query.before);
    const cursor = before === null ? null : before.split('~');
    if (cursor && cursor.length !== 2) return res.status(400).json({ error: 'before_invalid' });

    const projects = clientId === null
      ? db.prepare('SELECT * FROM projects').all()
      : db.prepare('SELECT * FROM projects WHERE client_id = ?').all(clientId);
    const estimates = groupBy(db.prepare(`
      SELECT ${ESTIMATE_COLUMNS} FROM estimates WHERE project_id IS NOT NULL
    `).all(), 'project_id');
    const invoices = groupBy(db.prepare(`SELECT ${INVOICE_COLUMNS} FROM invoices`).all(), 'project_id');
    const lastActivity = new Map(db.prepare(`
      SELECT project_id, MAX(at) AS at FROM activity GROUP BY project_id
    `).all().map((r) => [r.project_id, r.at]));
    const sends = new Map();
    db.prepare("SELECT project_id, at, detail_json FROM activity WHERE kind = 'sent' ORDER BY at, id").all()
      .forEach((r) => sends.set(r.project_id, sendOf(r)));
    const nextDay = new Map();
    db.prepare(NEXT_DAY_SQL + ' ORDER BY d.date, d.start_time, d.id').all(today).forEach((r) => {
      if (!nextDay.has(r.project_id)) nextDay.set(r.project_id, { date: r.date, status: r.status });
    });
    const clients = new Map(db.prepare('SELECT id, business_name, contact_name FROM clients').all()
      .map((c) => [c.id, c]));

    const cutoff = addDays(today, -SETTLED_DAYS);
    const all = projects.map((p) => {
      const own = estimates.get(p.id) || [];
      const bills = invoices.get(p.id) || [];
      const record = p.client_id ? clients.get(p.client_id) : null;
      const project = summarize(p, own, bills, {
        sent: sends.get(p.id),
        nextDay: nextDay.get(p.id),
        client: record,
        lastActivityAt: lastActivity.get(p.id),
      });
      const settled = settledAt(p, bills, project.stage);
      const lead = own.find((e) => e.id === project.estimateId);
      const snapshot = lead ? JSON.parse(lead.client_json || '{}') : {};
      return {
        project,
        old: Boolean(settled) && settled.slice(0, 10) < cutoff,
        text: [
          p.upid, ...own.map((e) => e.upid), ...own.map((e) => e.name),
          snapshot.businessName, snapshot.contactName,
          record && record.business_name, record && record.contact_name,
        ].filter(Boolean).join('\n').toLowerCase(),
      };
    });

    const searched = q ? all.filter((row) => row.text.includes(q)) : all;
    const inActive = (row) => q || !row.old;
    const counts = { active: searched.filter(inActive).length, all: searched.length };
    STAGES.forEach((s) => {
      counts[s] = searched.filter((row) => row.project.stage === s).length;
    });
    const shown = searched
      .filter((row) => stage === 'all' || (stage === 'active' ? inActive(row) : row.project.stage === stage))
      .map((row) => row.project)
      .sort((a, b) => (b.lastActivityAt > a.lastActivityAt) - (b.lastActivityAt < a.lastActivityAt) ||
        (b.id > a.id) - (b.id < a.id));
    const rest = cursor
      ? shown.filter((p) => p.lastActivityAt < cursor[0] || (p.lastActivityAt === cursor[0] && p.id < cursor[1]))
      : shown;
    const page = rest.slice(0, limit);
    const last = page[page.length - 1];

    res.json({
      ok: true,
      projects: page,
      next: rest.length > limit ? last.lastActivityAt + '~' + last.id : null,
      total: shown.length,
      counts,
      // How many projects still wait for the UPID fix-up (task 16): the banner.
      needsUpid: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE needs_upid = 1').get().n,
    });
  });

  /* The folder, or a 404. Every folder route reads `today` the same way. */
  function folderReply(req, res, extra) {
    const today = todayOf(req);
    if (!today) return res.status(400).json({ error: 'today_invalid' });
    const folder = readFolder(db, req.params.id, today);
    if (!folder) return res.status(404).json({ error: 'not_found' });
    return res.json({ ok: true, ...folder, ...(extra || {}) });
  }

  /* The project behind an action, or null once a 404 has been sent. */
  function projectFor(req, res) {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) res.status(404).json({ error: 'not_found' });
    return p || null;
  }

  app.get('/api/projects/:id', (req, res) => folderReply(req, res));

  app.post('/api/projects/:id/sent', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    const validUntil = (req.body || {}).validUntil;
    if (!isYmd(validUntil)) return res.status(400).json({ error: 'valid_until_invalid' });
    const { stage, own } = stageNow(db, p);
    if (stage === 'declined') {
      return res.status(409).json({ error: 'project_declined', message: 'This project was declined. Reopen it first.' });
    }
    if (stage !== 'draft' && stage !== 'sent') {
      return res.status(409).json({ error: 'project_accepted', message: 'This project has been accepted, so there is nothing to send.' });
    }
    const lead = summarize(p, own, [], {}).estimateId;
    if (!lead) return res.status(409).json({ error: 'no_estimate' });
    const now = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE estimates SET status = 'sent' WHERE id = ?").run(lead);
      db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, p.id);
      logActivity(db, p.id, 'sent', { validUntil, estimateId: lead }, now);
    })();
    return folderReply(req, res);
  });

  app.post('/api/projects/:id/decline', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    if (p.declined_at) return folderReply(req, res);
    const { bills } = stageNow(db, p);
    if (bills.some((i) => i.status !== 'void')) {
      return res.status(409).json({
        error: 'has_invoices',
        message: 'This project has invoices, so it can’t be declined.',
      });
    }
    const now = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE estimates SET status = 'declined' WHERE project_id = ?").run(p.id);
      db.prepare('UPDATE projects SET declined_at = ?, updated_at = ? WHERE id = ?').run(now, now, p.id);
      logActivity(db, p.id, 'declined', {}, now);
    })();
    return folderReply(req, res);
  });

  app.post('/api/projects/:id/reopen', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    if (!p.declined_at) {
      return res.status(409).json({ error: 'not_declined', message: 'This project isn’t declined.' });
    }
    const ids = db.prepare('SELECT id FROM estimates WHERE project_id = ?').all(p.id).map((r) => r.id);
    const clash = lockedDates(db, ids);
    if (clash.confirmed.length) {
      const first = clash.confirmed[0];
      const more = clash.confirmed.length - 1;
      return res.status(409).json({
        error: 'date_locked',
        clashes: clash.confirmed,
        message: `${first.date} is now confirmed for ${whoHas(first)}` +
          (more ? ` (and ${more} more date${more === 1 ? '' : 's'})` : '') +
          '. Move that day, or add a specification note to it, then reopen.',
      });
    }
    const now = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE estimates SET status = 'draft' WHERE project_id = ?").run(p.id);
      db.prepare('UPDATE projects SET declined_at = NULL, accepted_at = NULL, updated_at = ? WHERE id = ?')
        .run(now, p.id);
      logActivity(db, p.id, 'reopened', {}, now);
    })();
    return folderReply(req, res, { pencilled: clash.pencilled });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    const gone = db.prepare(`
      SELECT number FROM invoices
       WHERE project_id = ? AND kind <> 'legacy' AND status IN ('scheduled', 'sent', 'paid') LIMIT 1
    `).get(p.id);
    if (gone) {
      return res.status(409).json({
        error: 'has_sent_invoices',
        message: `${gone.number || 'An invoice'} has gone out, so this project can’t be deleted.`,
      });
    }
    // Estimates (and through them days and rentals), invoices and activity
    // all hang off the project, ON DELETE CASCADE.
    db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    return res.json({ ok: true });
  });
}

module.exports = { registerProjectRoutes, summarize, readFolder };
