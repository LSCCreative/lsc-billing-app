'use strict';

const { nowIso } = require('./db');
const { dayKind } = require('./calc');

/* NSW's list is the national one plus the holidays whose subdivisions include
   NSW (D6). The source tags a state-only holiday with `counties: ['AU-NSW',…]`
   and a national one with `global: true`. */
const STATE = 'AU-NSW';
const SOURCE_URL = (year) => `https://date.nager.at/api/v3/PublicHolidays/${year}/AU`;
const FETCH_TIMEOUT_MS = 10000;
const MAX_NAME = 100;

/**
 * The default holiday source: Nager.Date, free and keyless. A source is any
 * `async (year) => rawList`, so tests (and a future swap of provider) pass
 * their own. It throws on a network error, a timeout or a non-200.
 */
async function nagerSource(year) {
  const res = await fetch(SOURCE_URL(year), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`holiday source answered ${res.status} for ${year}`);
  return res.json();
}

/**
 * The NSW rows of a source's list: `[{ date, name }]`, in date order and one
 * per date. Anything that isn't a dated entry is dropped rather than stored.
 * @throws if the payload isn't a list at all.
 */
function nswHolidays(raw) {
  if (!Array.isArray(raw)) throw new Error('holiday source did not return a list');
  const byDate = new Map();
  for (const h of raw) {
    if (!h || typeof h !== 'object') continue;
    const date = String(h.date || '');
    if (dayKind(date, {}, []) === null) continue;
    const national = h.global === true || (h.global !== false && !Array.isArray(h.counties));
    const state = Array.isArray(h.counties) && h.counties.includes(STATE);
    if (!national && !state) continue;
    if (!byDate.has(date)) byDate.set(date, String(h.name || h.localName || '').trim().slice(0, MAX_NAME));
  }
  return [...byDate].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, name]) => ({ date, name }));
}

/** The calendar year in Sydney, which is the year a booking is dated in. */
function sydneyYear(now) {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric' }).format(now));
}

/**
 * Pulls this year and next from `source` and keeps them as `fetched` rows.
 * Nothing is written unless every year came back, so a half-answer can't leave
 * a half-list. A date the owner removed (`hidden`) stays removed, and a date
 * they added themselves keeps their name: a fetch only ever confirms rows it
 * made.
 * @returns {Promise<{added:number, years:number[]}>} `added` counts dates new
 *   to the table.
 * @throws if the source failed or sent something that isn't a list.
 */
async function fetchHolidays(db, source = nagerSource, now = new Date()) {
  const thisYear = sydneyYear(now);
  const years = [thisYear, thisYear + 1];
  const lists = [];
  for (const y of years) lists.push(nswHolidays(await source(y)));

  const stamp = nowIso();
  const exists = db.prepare('SELECT 1 FROM holidays WHERE date = ?');
  const upsert = db.prepare(`
    INSERT INTO holidays (date, name, source, hidden, fetched_at) VALUES (?, ?, 'fetched', 0, ?)
    ON CONFLICT(date) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at
     WHERE holidays.source = 'fetched'
  `);
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const list of lists) {
      for (const h of list) {
        if (!exists.get(h.date)) added += 1;
        upsert.run(h.date, h.name, stamp);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { added, years };
}

/**
 * Boot-time top-up: if nothing is stored for next year, fetch. It resolves
 * either way and logs a failure, because a holiday source being down must
 * never stop the server starting, and manual entry still works (D7).
 */
async function fetchIfNextYearMissing(db, source, now = new Date(), log = console) {
  const next = sydneyYear(now) + 1;
  const have = db.prepare("SELECT 1 FROM holidays WHERE source = 'fetched' AND date LIKE ?").get(`${next}-%`);
  if (have) return { skipped: true };
  try {
    return { skipped: false, ...(await fetchHolidays(db, source, now)) };
  } catch (err) {
    log.error('[holidays] boot fetch failed:', err.message);
    return { skipped: false, error: err.message };
  }
}

module.exports = { nagerSource, nswHolidays, fetchHolidays, fetchIfNextYearMissing, sydneyYear, MAX_NAME };
