'use strict';

const { dayKind } = require('../calc');

/* A month view asks for six weeks; a year view would ask for 366 days. Past
   that the request is a mistake, not a calendar. */
const MAX_RANGE_DAYS = 400;

function epochDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — every estimate's booked
 * days dated from `from` to `to` inclusive, for the editor's calendar (task 6)
 * and Home (task 12). Date TBC days are on no calendar (D9). An overnight
 * booking belongs to its start date (D21), so it is returned for that date
 * only.
 *
 * Each day carries what a tile and its pop-up show: UPID, project name, the
 * client's business, status, times, the override note, and the names of the
 * production items on it.
 *
 * Declined estimates are excluded once task 15 adds that status; until then
 * every estimate's days are returned.
 */
function registerCalendarRoutes(app, db) {
  app.get('/api/calendar', (req, res) => {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (dayKind(from, {}, []) === null || dayKind(to, {}, []) === null) {
      return res.status(400).json({ error: 'calendar_range_invalid' });
    }
    const span = epochDay(to) - epochDay(from);
    if (span < 0 || span > MAX_RANGE_DAYS) return res.status(400).json({ error: 'calendar_range_invalid' });

    const rows = db.prepare(`
      SELECT d.id, d.estimate_id, d.date, d.status, d.start_time, d.end_time, d.override_note,
             e.upid, e.name, e.client_json, e.active_rows_json
        FROM production_days d JOIN estimates e ON e.id = d.estimate_id
       WHERE d.date IS NOT NULL AND d.date BETWEEN ? AND ?
       ORDER BY d.date, d.start_time, e.upid, d.id
    `).all(from, to);

    const days = rows.map((r) => {
      const client = JSON.parse(r.client_json || '{}');
      const prod = JSON.parse(r.active_rows_json || '{}').prod;
      const items = (Array.isArray(prod) ? prod : [])
        .filter((line) => line && String(line.dayId) === r.id)
        .map((line) => line.name || '');
      return {
        id: r.id,
        estimateId: r.estimate_id,
        date: r.date,
        status: r.status,
        startTime: r.start_time || null,
        endTime: r.end_time || null,
        overrideNote: r.override_note || '',
        upid: r.upid,
        projectName: r.name,
        client: client.businessName || '',
        items,
      };
    });
    res.json({ ok: true, days });
  });
}

module.exports = { registerCalendarRoutes };
