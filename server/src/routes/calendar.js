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
 * A declined estimate's days and rentals are left out: they leave every
 * calendar (D22).
 *
 * GEAR RENTALS (B2-2, D84) come back beside the days: each one whose out → back
 * span overlaps the range, for the calendar's bars. A rental with only one date
 * is a one-day marker on it; one with neither is on no calendar. A bar is by
 * vendor and project, so a rental carries no client or items.
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
       WHERE d.date IS NOT NULL AND d.date BETWEEN ? AND ? AND e.status <> 'declined'
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

    /* A rental spans out → back; with one date blank it spans the other. */
    const rentals = db.prepare(`
      SELECT r.id, r.estimate_id, r.vendor, r.out_date, r.out_method, r.back_date, r.back_method,
             e.upid, e.name
        FROM rentals r JOIN estimates e ON e.id = r.estimate_id
       WHERE COALESCE(r.out_date, r.back_date) IS NOT NULL AND e.status <> 'declined'
         AND COALESCE(r.out_date, r.back_date) <= ?
         AND COALESCE(r.back_date, r.out_date) >= ?
       ORDER BY COALESCE(r.out_date, r.back_date), e.upid, r.sort, r.id
    `).all(to, from).map((r) => ({
      id: r.id,
      estimateId: r.estimate_id,
      upid: r.upid,
      projectName: r.name,
      vendor: r.vendor,
      outDate: r.out_date || null,
      outMethod: r.out_method || null,
      backDate: r.back_date || null,
      backMethod: r.back_method || null,
    }));
    res.json({ ok: true, days, rentals });
  });
}

module.exports = { registerCalendarRoutes };
