'use strict';

const { dayKind } = require('../calc');
const { nagerSource, fetchHolidays, MAX_NAME } = require('../holidays');

function listHolidays(db) {
  const rows = db.prepare('SELECT date, name, source, hidden, fetched_at FROM holidays ORDER BY date').all();
  const lastFetchedAt = rows.reduce((m, r) => (r.fetched_at && r.fetched_at > m ? r.fetched_at : m), '') || null;
  return {
    holidays: rows.map((r) => ({ date: r.date, name: r.name, source: r.source, hidden: r.hidden === 1 })),
    lastFetchedAt,
  };
}

/**
 * Public holidays for the surcharge (production-booking task 3, D6/D7).
 *
 *   GET    /api/holidays          every row, hidden ones included and flagged,
 *                                 so the editor builds the same surcharge
 *                                 snapshot the server does (calc.js dayKind
 *                                 skips the hidden ones itself).
 *   POST   /api/holidays/fetch    pull this year and next from the source.
 *   PUT    /api/holidays/:date    add a date (or rename one, or bring a removed
 *                                 fetched date back). Body: { name }.
 *   DELETE /api/holidays/:date    an added date is deleted; a fetched one is
 *                                 hidden, so a re-fetch can't bring it back.
 *
 * `opts.holidaySource` replaces the Nager.Date fetch (tests do).
 */
function registerHolidayRoutes(app, db, opts = {}) {
  const source = opts.holidaySource || nagerSource;

  app.get('/api/holidays', (_req, res) => {
    res.json({ ok: true, ...listHolidays(db) });
  });

  app.post('/api/holidays/fetch', async (_req, res) => {
    let result;
    try {
      result = await fetchHolidays(db, source);
    } catch (err) {
      console.error('[holidays] fetch failed:', err.message);
      return res.status(502).json({
        error: 'holiday_fetch_failed',
        message: "Couldn't get the public holiday list. Add dates by hand, or try again later.",
      });
    }
    res.json({ ok: true, added: result.added, ...listHolidays(db) });
  });

  app.put('/api/holidays/:date', (req, res) => {
    const date = req.params.date;
    if (dayKind(date, {}, []) === null) return res.status(400).json({ error: 'holiday_date_invalid' });
    const body = req.body || {};
    if (body.name !== undefined && typeof body.name !== 'string') {
      return res.status(400).json({ error: 'holiday_name_invalid' });
    }
    const name = (body.name || '').trim();
    if (name.length > MAX_NAME) return res.status(400).json({ error: 'holiday_name_too_long' });

    const row = db.prepare('SELECT name FROM holidays WHERE date = ?').get(date);
    if (!row) {
      db.prepare("INSERT INTO holidays (date, name, source, hidden) VALUES (?, ?, 'added', 0)").run(date, name);
    } else {
      // Keeps its source: a fetched date the owner re-adds is still a fetched
      // one, and stays the source's to rename on the next fetch only if they
      // never named it themselves.
      db.prepare('UPDATE holidays SET hidden = 0, name = ? WHERE date = ?').run(name || row.name, date);
    }
    res.json({ ok: true, ...listHolidays(db) });
  });

  app.delete('/api/holidays/:date', (req, res) => {
    const date = req.params.date;
    if (dayKind(date, {}, []) === null) return res.status(400).json({ error: 'holiday_date_invalid' });
    const row = db.prepare('SELECT source FROM holidays WHERE date = ?').get(date);
    if (!row) return res.status(404).json({ error: 'holiday_not_found' });
    if (row.source === 'added') db.prepare('DELETE FROM holidays WHERE date = ?').run(date);
    else db.prepare('UPDATE holidays SET hidden = 1 WHERE date = ?').run(date);
    res.json({ ok: true, ...listHolidays(db) });
  });
}

module.exports = { registerHolidayRoutes };
