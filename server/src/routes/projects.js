'use strict';

const { STAGES, projectStage, settledAt } = require('../projects');

/* A paid or declined project leaves the Active view this long after it got
   there (IA, Content Growth Plan). Its own chip, and a search, still find it. */
const SETTLED_DAYS = 90;
const PAGE = 50;
const MAX_PAGE = 200;

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

function addDays(ymd, n) {
  return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/* The server's own date, only for a caller that sends no `today`. */
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
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

/**
 * GET /api/projects (production-booking task 17; IA "Projects", D58) — one
 * card per project, newest activity first.
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
 * A project's NAME, total and client are its lead estimate's: the one most
 * recently changed that isn't declined. Since v13 a project has one estimate;
 * only a group the fix-up kept together has more (`estimateCount`).
 */
function registerProjectRoutes(app, db) {
  app.get('/api/projects', (req, res) => {
    const stage = String(req.query.stage || 'active');
    if (stage !== 'active' && stage !== 'all' && !STAGES.includes(stage)) {
      return res.status(400).json({ error: 'stage_invalid' });
    }
    const today = req.query.today === undefined ? localToday() : String(req.query.today);
    if (!isYmd(today)) return res.status(400).json({ error: 'today_invalid' });
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
      SELECT id, project_id, upid, name, date, status, client_json, total_inc_gst, updated_at
        FROM estimates WHERE project_id IS NOT NULL
    `).all(), 'project_id');
    const invoices = groupBy(db.prepare(`
      SELECT project_id, kind, number, status, due_at, paid_at, updated_at FROM invoices
    `).all(), 'project_id');
    const lastActivity = new Map(db.prepare(`
      SELECT project_id, MAX(at) AS at FROM activity GROUP BY project_id
    `).all().map((r) => [r.project_id, r.at]));
    const sends = new Map();
    db.prepare("SELECT project_id, at, detail_json FROM activity WHERE kind = 'sent' ORDER BY at, id").all()
      .forEach((r) => {
        let detail = {};
        try {
          detail = JSON.parse(r.detail_json || '{}') || {};
        } catch (_) { /* a bad row reads as a send with no detail */ }
        sends.set(r.project_id, { at: r.at, version: detail.version, validUntil: detail.validUntil });
      });
    // The first booked date from today on, per project. Declined estimates'
    // days are on no calendar (D22), so they're no one's next day either.
    const nextDay = new Map();
    db.prepare(`
      SELECT e.project_id, d.date, d.status
        FROM production_days d JOIN estimates e ON e.id = d.estimate_id
       WHERE d.date IS NOT NULL AND d.date >= ? AND e.status <> 'declined' AND e.project_id IS NOT NULL
       ORDER BY d.date, d.start_time, d.id
    `).all(today).forEach((r) => {
      if (!nextDay.has(r.project_id)) nextDay.set(r.project_id, { date: r.date, status: r.status });
    });
    const clients = new Map(db.prepare('SELECT id, business_name, contact_name FROM clients').all()
      .map((c) => [c.id, c]));

    const cutoff = addDays(today, -SETTLED_DAYS);
    const all = projects.map((p) => {
      const own = estimates.get(p.id) || [];
      const bills = invoices.get(p.id) || [];
      const where = projectStage(p, own, bills, sends.get(p.id));
      const lead = own.slice().sort((a, b) =>
        (a.status === 'declined') - (b.status === 'declined') ||
        (b.updated_at > a.updated_at) - (b.updated_at < a.updated_at) ||
        (a.id < b.id ? -1 : 1))[0] || null;
      const snapshot = lead ? JSON.parse(lead.client_json || '{}') : {};
      const record = p.client_id ? clients.get(p.client_id) : null;
      const settled = settledAt(p, bills, where.stage);
      const { stage, ...stageDetail } = where;
      return {
        project: {
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
          nextDay: nextDay.get(p.id) || null,
          lastActivityAt: latest(p.updated_at, ...own.map((e) => e.updated_at),
            ...bills.map((i) => i.updated_at), lastActivity.get(p.id)),
        },
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
}

module.exports = { registerProjectRoutes };
