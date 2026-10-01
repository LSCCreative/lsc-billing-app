'use strict';

/**
 * Public holidays (production-booking task 3): the fetch with its NSW filter,
 * the owner's add / remove with the tombstone that stops a re-fetch undoing
 * it, the failure path, and the boot-time top-up. The source is always a stub;
 * nothing here touches the network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-holidays-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { dayKind } = require('../src/calc');
const { readHolidays } = require('../src/days');
const { nswHolidays, fetchHolidays, fetchIfNextYearMissing, sydneyYear } = require('../src/holidays');

const PASSWORD = 'correct-horse-battery-staple';
const USERNAME = 'lachlan';

const THIS_YEAR = sydneyYear(new Date());
const NEXT_YEAR = THIS_YEAR + 1;

/* The shape Nager.Date answers with: a national holiday is `global: true` with
   no counties; a state one is `global: false` with the subdivisions it covers. */
function nager(year) {
  return [
    { date: `${year}-01-01`, localName: "New Year's Day", name: "New Year's Day", global: true, counties: null },
    { date: `${year}-01-26`, localName: 'Australia Day', name: 'Australia Day', global: true, counties: null },
    { date: `${year}-08-03`, localName: 'Bank Holiday', name: 'Bank Holiday', global: false, counties: ['AU-NSW'] },
    { date: `${year}-09-28`, localName: 'AFL Grand Final Friday', name: 'Friday before the AFL Grand Final', global: false, counties: ['AU-VIC'] },
    { date: `${year}-10-05`, localName: 'Labour Day', name: 'Labour Day', global: false, counties: ['AU-NSW', 'AU-ACT', 'AU-SA'] },
    { date: `${year}-06-08`, localName: 'Western Australia Day', name: 'Western Australia Day', global: false, counties: ['AU-WA'] },
  ];
}

let source;
let calls;
let server;
let baseUrl;
let db;
let cookie;

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`
    INSERT INTO account (id, username, password_hash, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(USERNAME, await hashPassword(PASSWORD), nowIso(), nowIso());

  const app = createApp(db, {
    holidaySource: async (year) => {
      calls.push(year);
      return source(year);
    },
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
});

test.beforeEach(() => {
  db.prepare('DELETE FROM holidays').run();
  source = async (year) => nager(year);
  calls = [];
});

test.after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function api(pathname, opts = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...opts,
    headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) },
  });
}
const put = (date, body) => api(`/api/holidays/${date}`, { method: 'PUT', body: JSON.stringify(body) });
const del = (date) => api(`/api/holidays/${date}`, { method: 'DELETE' });
const fetchNow = () => api('/api/holidays/fetch', { method: 'POST', body: '{}' });
const dates = (list) => list.map((h) => h.date);

test('nswHolidays keeps national and NSW holidays and drops other states', () => {
  const kept = nswHolidays(nager(2026));
  assert.deepEqual(kept.map((h) => h.name), ["New Year's Day", 'Australia Day', 'Bank Holiday', 'Labour Day']);
  assert.ok(!dates(kept).includes('2026-09-28'), 'the Victorian holiday is dropped');
  assert.ok(!dates(kept).includes('2026-06-08'), 'the WA holiday is dropped');
});

test('nswHolidays skips malformed entries, keeps the first of a repeated date, and refuses a non-list', () => {
  const kept = nswHolidays([
    null, 'x', {}, { date: 'not-a-date', global: true },
    { date: '2026-02-30', name: 'Impossible', global: true },
    { date: '2026-12-25', name: 'Christmas Day', global: true },
    { date: '2026-12-25', name: 'Christmas again', global: true },
  ]);
  assert.deepEqual(kept, [{ date: '2026-12-25', name: 'Christmas Day' }]);
  assert.throws(() => nswHolidays({ error: 'rate limited' }), /not return a list/);
  assert.throws(() => nswHolidays(null), /not return a list/);
});

test('fetch: asks for this year and next, stores the NSW rows as fetched, and reports them', async () => {
  const res = await fetchNow();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(calls, [THIS_YEAR, NEXT_YEAR]);
  assert.equal(body.added, 8);
  assert.equal(body.holidays.length, 8);
  assert.ok(body.holidays.every((h) => h.source === 'fetched' && h.hidden === false));
  assert.deepEqual(dates(body.holidays).filter((d) => d.startsWith(`${NEXT_YEAR}-`)),
    [`${NEXT_YEAR}-01-01`, `${NEXT_YEAR}-01-26`, `${NEXT_YEAR}-08-03`, `${NEXT_YEAR}-10-05`]);
  assert.ok(body.lastFetchedAt, 'the last-fetched stamp is set');

  const got = await api('/api/holidays').then((r) => r.json());
  assert.deepEqual(got.holidays, body.holidays);
  assert.equal(got.lastFetchedAt, body.lastFetchedAt);
});

test('fetch twice: no duplicates, nothing reported as new the second time', async () => {
  await fetchNow();
  const again = await fetchNow().then((r) => r.json());
  assert.equal(again.added, 0);
  assert.equal(again.holidays.length, 8);
});

test('a removed fetched holiday is hidden, and a re-fetch does not bring it back', async () => {
  await fetchNow();
  const day = `${THIS_YEAR}-01-26`;
  const removed = await del(day).then((r) => r.json());
  const row = removed.holidays.find((h) => h.date === day);
  assert.deepEqual([row.source, row.hidden], ['fetched', true], 'tombstoned, not deleted');

  const again = await fetchNow().then((r) => r.json());
  assert.equal(again.holidays.find((h) => h.date === day).hidden, true, 'still hidden after a re-fetch');
  assert.equal(again.added, 0);
});

test('a removed fetched holiday stops surcharging, and adding it back restores it', async () => {
  await fetchNow();
  const day = `${THIS_YEAR}-10-05`;
  assert.equal(dayKind(day, {}, readHolidays(db)), 'holiday');
  await del(day);
  assert.notEqual(dayKind(day, {}, readHolidays(db)), 'holiday', 'a hidden holiday reads as the day it is');
  const back = await put(day, {}).then((r) => r.json());
  const row = back.holidays.find((h) => h.date === day);
  assert.deepEqual([row.hidden, row.source, row.name], [false, 'fetched', 'Labour Day']);
  assert.equal(dayKind(day, {}, readHolidays(db)), 'holiday');
});

test('an added date is stored as added, named, and deleted outright when removed', async () => {
  const res = await put('2026-11-03', { name: '  Melbourne Cup  ' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.holidays, [{ date: '2026-11-03', name: 'Melbourne Cup', source: 'added', hidden: false }]);
  assert.equal(body.lastFetchedAt, null, 'adding by hand is not a fetch');

  const after = await del('2026-11-03').then((r) => r.json());
  assert.deepEqual(after.holidays, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM holidays').get().n, 0, 'deleted, no tombstone');
});

test("a re-fetch leaves a date the owner added alone, name and all", async () => {
  await put(`${THIS_YEAR}-10-05`, { name: 'Our Labour Day' });
  await fetchNow();
  const row = db.prepare('SELECT * FROM holidays WHERE date = ?').get(`${THIS_YEAR}-10-05`);
  assert.deepEqual([row.source, row.name], ['added', 'Our Labour Day']);
});

test('adding a date that already shows keeps its name when none is given', async () => {
  await fetchNow();
  const day = `${THIS_YEAR}-08-03`;
  await put(day, {});
  assert.equal(db.prepare('SELECT name FROM holidays WHERE date = ?').get(day).name, 'Bank Holiday');
  await put(day, { name: 'Bank Holiday (NSW)' });
  assert.equal(db.prepare('SELECT name FROM holidays WHERE date = ?').get(day).name, 'Bank Holiday (NSW)');
});

test('add and remove refuse bad input', async () => {
  for (const bad of ['2026-13-01', '2026-02-30', 'tomorrow', '26-10-05']) {
    assert.equal((await put(bad, { name: 'x' })).status, 400, `PUT ${bad}`);
    assert.equal((await del(bad)).status, 400, `DELETE ${bad}`);
  }
  assert.equal((await put('2026-10-05', { name: 5 })).status, 400);
  const long = await put('2026-10-05', { name: 'x'.repeat(101) });
  assert.equal(long.status, 400);
  assert.equal((await long.json()).error, 'holiday_name_too_long');
  assert.equal((await del('2026-10-05')).status, 404, 'removing a date that is not listed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM holidays').get().n, 0);
});

test('fetch failure: a clear error, nothing stored, and manual entry still works (D7)', async () => {
  source = async () => { throw new Error('getaddrinfo ENOTFOUND date.nager.at'); };
  const res = await fetchNow();
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'holiday_fetch_failed');
  assert.match(body.message, /Add dates by hand/);
  assert.ok(!JSON.stringify(body).includes('ENOTFOUND'), 'the raw network error is not shown');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM holidays').get().n, 0);

  assert.equal((await put('2026-10-05', { name: 'Labour Day' })).status, 200);
});

test('fetch failure on the second year writes nothing from the first', async () => {
  source = async (year) => {
    if (year === NEXT_YEAR) throw new Error('503');
    return nager(year);
  };
  assert.equal((await fetchNow()).status, 502);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM holidays').get().n, 0);
});

test('a source that answers with something other than a list is a failed fetch', async () => {
  source = async () => ({ message: 'Too many requests' });
  assert.equal((await fetchNow()).status, 502);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM holidays').get().n, 0);
});

test('a source that has nothing for next year yet is fine', async () => {
  source = async (year) => (year === NEXT_YEAR ? [] : nager(year));
  const body = await fetchNow().then((r) => r.json());
  assert.equal(body.holidays.length, 4);
});

test('the holiday routes sit behind the sign-in', async () => {
  for (const [m, p] of [['GET', '/api/holidays'], ['POST', '/api/holidays/fetch'], ['PUT', '/api/holidays/2026-10-05'], ['DELETE', '/api/holidays/2026-10-05']]) {
    const res = await fetch(`${baseUrl}${p}`, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
    assert.equal(res.status, 401, `${m} ${p}`);
  }
});

/* Boot top-up. `now` is fixed so the years don't depend on today's date. */
const NOW = new Date('2026-10-02T03:00:00Z'); // 2 October 2026, Sydney

test('boot: fetches when next year is missing, and says how many dates were new', async () => {
  const r = await fetchIfNextYearMissing(db, async (y) => nager(y), NOW, { error() {} });
  assert.deepEqual([r.skipped, r.added, r.years], [false, 8, [2026, 2027]]);
});

test('boot: does nothing when next year is already stored', async () => {
  db.prepare("INSERT INTO holidays (date, name, source) VALUES ('2027-01-01', 'New Year', 'fetched')").run();
  let asked = false;
  const r = await fetchIfNextYearMissing(db, async () => { asked = true; return []; }, NOW, { error() {} });
  assert.equal(r.skipped, true);
  assert.equal(asked, false);
});

test('boot: a date the owner added for next year does not count as fetched', async () => {
  db.prepare("INSERT INTO holidays (date, name, source) VALUES ('2027-03-03', 'Mine', 'added')").run();
  const r = await fetchIfNextYearMissing(db, async (y) => nager(y), NOW, { error() {} });
  assert.equal(r.skipped, false);
});

test('boot: a failing source is logged and swallowed, never thrown', async () => {
  const logged = [];
  const r = await fetchIfNextYearMissing(db, async () => { throw new Error('down'); }, NOW, { error: (...a) => logged.push(a.join(' ')) });
  assert.equal(r.error, 'down');
  assert.match(logged[0], /boot fetch failed: down/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM holidays').get().n, 0);
});

test('fetchHolidays years follow the Sydney calendar, not UTC', async () => {
  // 31 Dec 2026 23:30 UTC is already 1 Jan 2027 in Sydney.
  const asked = [];
  await fetchHolidays(db, async (y) => { asked.push(y); return []; }, new Date('2026-12-31T23:30:00Z'));
  assert.deepEqual(asked, [2027, 2028]);
});
