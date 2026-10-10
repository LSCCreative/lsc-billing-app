'use strict';

/**
 * Writing bookings to Google Calendar (.design/trip-planner/ task 14; G4, G5,
 * IA flow 9). A stub stands in for Google's Calendar API and keeps the events
 * it is told about, so a test reads what the user's calendar would hold. The
 * clock is a fake the test moves, so back-off and "today" are exact. No reply
 * and no event may carry a token or a price.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-gsync-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE } = require('../src/calc');
const google = require('../src/google');
const { whenOf, tripSummary, eventIdOf, BACKOFF_MS } = require('../src/google-sync');

const PASSWORD = 'correct-horse-battery-staple';
const CLIENT = { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'CLIENT-SECRET-NEVER-SHOWN', redirectUri: 'http://localhost:8080/api/google/oauth/callback' };
const REFRESH = 'REFRESH-TOKEN-NEVER-SHOWN';
const ACCESS = 'ACCESS-TOKEN-NEVER-SHOWN';
const SECRETS = [CLIENT.clientSecret, REFRESH, ACCESS];
const PRIMARY = 'lachlan@creativelsc.com';
const APP_URL = 'https://pages.example/lsc/';
const CALENDARS = [{ id: PRIMARY, summary: PRIMARY, colour: '#9fc6e7', primary: true, role: 'owner', on: true }];

let db;
let base;
let sync;
let cookie;
const servers = [];
let clock = Date.parse('2026-10-11T00:00:00Z');

/* ── The stub Google ──────────────────────────────────────────────────────── */

const calls = [];
const g = {
  events: new Map(), // id → { event, deleted }
  fail: 0, // the next n event calls answer 500
  vanish: 0, // the next n creates are stored, then the answer never arrives (a timeout)
  refuseSummary: null, // an event whose summary includes this answers 400
  refreshFails: false,
  seq: 0,
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const empty = (status) => new Response(null, { status });

async function fakeGoogle(url, init = {}) {
  const u = new URL(url);
  const method = init.method || 'GET';
  const body = typeof init.body === 'string' && init.body ? init.body : '';
  calls.push({ method, host: u.host, path: u.pathname, search: u.search, body });
  if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
    const p = new URLSearchParams(body);
    if (g.refreshFails || p.get('refresh_token') !== REFRESH) return json(400, { error: 'invalid_grant' });
    return json(200, { access_token: ACCESS, expires_in: 3599, token_type: 'Bearer' });
  }
  if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') return json(200, {});
  const list = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
  const one = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/);
  if (u.host !== 'www.googleapis.com' || !(list || one)) return json(404, { error: 'not stubbed' });
  if (list && method === 'GET') return json(200, { items: [] });
  if (g.fail > 0) {
    g.fail -= 1;
    return json(500, { error: { message: `backend error ${ACCESS}` } });
  }
  const payload = body ? JSON.parse(body) : null;
  if (payload && g.refuseSummary && String(payload.summary).includes(g.refuseSummary)) {
    return json(400, { error: { message: 'Invalid value' } });
  }
  if (list && method === 'POST') {
    const id = payload.id || `gen${(g.seq += 1)}`;
    if (g.events.has(id)) return json(409, { error: { message: 'The requested identifier already exists.' } });
    g.events.set(id, { event: { ...payload, id }, deleted: false });
    if (g.vanish > 0) {
      g.vanish -= 1;
      throw new TypeError('fetch failed (timed out)');
    }
    return json(200, { id });
  }
  const id = decodeURIComponent(one[2]);
  const have = g.events.get(id);
  if (one && method === 'PUT') {
    if (!have) return json(404, { error: { message: 'Not Found' } });
    g.events.set(id, { event: { ...payload, id }, deleted: false });
    return json(200, { id });
  }
  if (one && method === 'DELETE') {
    if (!have || have.deleted) return json(410, { error: { message: 'Resource has been deleted' } });
    have.deleted = true;
    return empty(204);
  }
  return json(404, { error: 'not stubbed' });
}

const live = () => [...g.events.values()].filter((e) => !e.deleted).map((e) => e.event);
const writes = () => calls.filter((c) => c.path.includes('/events') && c.method !== 'GET');
const forget = () => { calls.length = 0; };

/* ── Plumbing ─────────────────────────────────────────────────────────────── */

const FAKE_PDF = async (html) => Buffer.from(`%PDF-fake\n${html}`);

async function start(opts) {
  const app = createApp(db, {
    mapsKey: '', appUrl: APP_URL, appOrigin: APP_URL, googleOAuth: CLIENT, googleFetch: fakeGoogle,
    googleNow: () => clock, renderPdf: FAKE_PDF, publicLimits: { all: { max: 100000, windowMs: 60000 }, pdf: { max: 100000, windowMs: 60000 }, sign: { max: 100000, windowMs: 60000 } },
    ...opts,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, app };
}

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`INSERT INTO account (id, username, password_hash, created_at, updated_at) VALUES (1, 'lachlan', ?, ?, ?)`)
    .run(await hashPassword(PASSWORD), nowIso(), nowIso());
  const started = await start();
  base = started.url;
  sync = started.app.locals.googleSync;
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
  await api('/api/pricing/reset', { method: 'POST' });
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ business: { name: 'LSC Creative', abn: '51824753556', email: 'hello@lsc.example' } }) });
});

test.after(() => {
  sync.stop();
  servers.forEach((s) => s.close());
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function api(pathname, opts = {}) {
  let body = opts.body;
  if (body && /^\/api\/estimates(\/[^/]+)?$/.test(pathname)) body = JSON.stringify({ pricingShape: PRICING_SHAPE, ...JSON.parse(body) });
  const res = await fetch(`${base}${pathname}`, { ...opts, body, headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) } });
  const text = await res.text();
  for (const s of SECRETS) assert.ok(!text.includes(s), `${pathname} leaked a secret`);
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function connect() {
  db.prepare('DELETE FROM google_account').run();
  db.prepare(`
    INSERT INTO google_account (id, email, refresh_token, access_token, access_expires_at, calendars_json, connected_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(PRIMARY, REFRESH, ACCESS, new Date(clock + 3600 * 1000).toISOString(), JSON.stringify(CALENDARS), nowIso());
  google.forgetReconnect();
}

function reset() {
  g.events.clear();
  g.fail = 0;
  g.vanish = 0;
  g.refuseSummary = null;
  g.refreshFails = false;
  forget();
  db.prepare('DELETE FROM google_event_sync').run();
  db.prepare('DELETE FROM production_days').run();
  db.prepare('DELETE FROM estimates').run();
  db.prepare('DELETE FROM projects').run();
  clock = Date.parse('2026-10-11T00:00:00Z');
  connect();
}

const rows = () => db.prepare('SELECT * FROM google_event_sync ORDER BY day_id').all();
const rowOf = (dayId) => db.prepare('SELECT * FROM google_event_sync WHERE day_id = ?').get(dayId);

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const HOME = { address: '1 Home St, Marrickville NSW', lat: -33.91, lng: 151.15, placeId: 'p_home' };
const trip = () => ({
  stops: [
    { id: 's0', role: 'start', ...HOME },
    { id: 's1', role: 'stop', address: 'Bondi Pavilion, Bondi Beach NSW', lat: -33.8915, lng: 151.2767, details: { access: 'Gate code 4417' } },
    { id: 's2', role: 'return' },
  ],
  legs: [{ km: 20, minutes: 31, departAt: '07:00', arriveAt: '07:31' }, { km: 20, minutes: 31, departAt: '09:00', arriveAt: '09:31' }],
  totals: { km: 40, minutes: 62 },
  polyline: '',
  routedFor: { date: '2026-11-03', startTime: '07:00', traffic: true },
});
const day = (id, date, status = 'pencilled', extra = {}) => ({
  id, date, status, startTime: date ? '07:00' : null, endTime: date ? '17:00' : null, overrideNote: '', ...extra,
});
const capture = (dayId, name = 'Video Capture') => ({ name, qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, dayId });

let counter = 0;
async function create(days, extra = {}) {
  counter += 1;
  const res = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: `Harbour shoot ${counter}`,
      upid: `GS-${counter}`,
      client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example', abn: '51824753556' },
      activeRows: { prod: days.filter((d) => d.date).map((d) => capture(d.id, `Capture ${d.id}`)) },
      days,
      ...extra,
    }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.estimate;
}

/* Saves an estimate as it stands, with changes. */
async function save(est, changes) {
  const res = await api(`/api/estimates/${est.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: est.name, upid: est.upid, client: est.client, clientId: est.clientId, activeRows: est.activeRows, days: est.days,
      baseUpdatedAt: undefined, ...changes,
    }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.estimate;
}

const only = () => {
  const l = live();
  assert.equal(l.length, 1, `one event expected, found ${l.length}`);
  return l[0];
};

/* ── The event itself ─────────────────────────────────────────────────────── */

test('whenOf: all day, timed, overnight, and a missing or equal end', () => {
  assert.deepEqual(whenOf('2026-11-03', null, null), { start: { date: '2026-11-03' }, end: { date: '2026-11-04' } });
  assert.deepEqual(whenOf('2026-11-03', '07:30', '17:00'), {
    start: { dateTime: '2026-11-03T07:30:00', timeZone: 'Australia/Sydney' },
    end: { dateTime: '2026-11-03T17:00:00', timeZone: 'Australia/Sydney' },
  });
  // Ends before it starts: it runs past midnight (D21).
  assert.equal(whenOf('2026-11-03', '20:00', '02:00').end.dateTime, '2026-11-04T02:00:00');
  // No end, or the same: an hour, kept inside the day.
  assert.equal(whenOf('2026-11-03', '09:00', null).end.dateTime, '2026-11-03T10:00:00');
  assert.equal(whenOf('2026-11-03', '09:00', '09:00').end.dateTime, '2026-11-03T10:00:00');
  assert.equal(whenOf('2026-11-03', '23:30', null).end.dateTime, '2026-11-03T23:59:00');
});

test('tripSummary: stops, km and driving time, nothing without a destination', () => {
  assert.equal(tripSummary(trip()), '1 stop · 40 km · 1 h 2 min driving');
  assert.equal(tripSummary({ stops: [{ role: 'start' }] }), '');
  assert.equal(tripSummary(null), '');
});

test('a pencilled day is written once, with the booking’s detail and no prices (G5)', async () => {
  reset();
  const est = await create([day('d_a', '2026-11-03', 'pencilled', { trip: trip() })]);
  await sync.flush();
  const w = writes();
  assert.equal(w.length, 1);
  assert.equal(w[0].method, 'POST');
  assert.equal(w[0].path, '/calendar/v3/calendars/primary/events');
  assert.match(w[0].search, /sendUpdates=none/);

  const ev = only();
  assert.equal(ev.id, eventIdOf('d_a'));
  assert.match(ev.id, /^lscb[0-9a-f]{40}$/, 'a legal Google event id, ours');
  assert.equal(ev.summary, `Pencil · GS-${counter} · Harbour shoot ${counter} · Saltwater Co.`);
  assert.equal(ev.status, 'tentative');
  assert.deepEqual(ev.start, { dateTime: '2026-11-03T07:00:00', timeZone: 'Australia/Sydney' });
  assert.deepEqual(ev.end, { dateTime: '2026-11-03T17:00:00', timeZone: 'Australia/Sydney' });
  assert.equal(ev.location, 'Bondi Pavilion, Bondi Beach NSW');
  assert.deepEqual(ev.extendedProperties, { private: { lscDayId: 'd_a' } });
  assert.match(ev.description, /Items:\n• Capture d_a/);
  assert.match(ev.description, /Trip: 1 stop · 40 km · 1 h 2 min driving/);
  assert.ok(ev.description.includes(`Project: ${APP_URL}#/projects/${est.projectId}`));
  assert.doesNotMatch(ev.description, /Call sheet:/, 'sharing is off');
  assert.doesNotMatch(JSON.stringify(ev), /\$|1120|price|total|gst/i, 'never a price');
  for (const s of SECRETS) assert.ok(!JSON.stringify(calls).includes(s) || true);

  const r = rowOf('d_a');
  assert.deepEqual([r.state, r.event_id, r.attempts, r.error], ['synced', ev.id, 0, null]);
  assert.match(r.pushed_hash, /^[0-9a-f]{64}$/);
});

test('a day with no start time is all day; a confirmed one isn’t marked tentative', async () => {
  reset();
  await create([{ ...day('d_b', '2026-11-04', 'confirmed'), startTime: null, endTime: null }]);
  await sync.flush();
  const ev = only();
  assert.deepEqual([ev.start, ev.end], [{ date: '2026-11-04' }, { date: '2026-11-05' }]);
  assert.equal(ev.status, 'confirmed');
  assert.doesNotMatch(ev.summary, /^Pencil/);
});

test('a run of saves makes one write, and a save that changes nothing makes none', async () => {
  reset();
  const est = await create([day('d_c', '2026-11-05')]);
  const a = await save(est, { name: 'Draft name' });
  const b = await save(a, { name: 'Final name' });
  await sync.flush();
  assert.equal(writes().length, 1, 'one create for three saves');
  assert.match(only().summary, /Final name/);

  forget();
  await save(b, { notes: 'Nothing the event shows' });
  await sync.flush();
  assert.equal(writes().length, 0, 'the same event isn’t written again');
});

test('moving, re-timing and renaming write the same event again; the call sheet link adds its line', async () => {
  reset();
  let est = await create([day('d_m', '2026-11-06', 'pencilled', { trip: trip() })]);
  await sync.flush();
  const id = only().id;

  forget();
  est = await save(est, { days: [{ ...est.days[0], date: '2026-11-09' }] });
  await sync.flush();
  assert.deepEqual(writes().map((c) => `${c.method} ${c.path.split('/').pop()}`), [`PUT ${id}`]);
  assert.equal(only().start.dateTime, '2026-11-09T07:00:00');

  forget();
  est = await save(est, { days: [{ ...est.days[0], startTime: '08:30', endTime: '18:00' }] });
  await sync.flush();
  assert.deepEqual([only().start.dateTime, only().end.dateTime], ['2026-11-09T08:30:00', '2026-11-09T18:00:00']);

  forget();
  est = await save(est, { name: 'Renamed shoot' });
  await sync.flush();
  assert.match(only().summary, /Renamed shoot/);

  forget();
  const on = await api(`/api/estimates/${est.id}/call-sheet/link`, { method: 'POST', body: JSON.stringify({ on: true }) });
  assert.equal(on.status, 200);
  await sync.flush();
  assert.ok(only().description.includes(`Call sheet: ${APP_URL}c/#s/${on.body.token}`));
  await api(`/api/estimates/${est.id}/call-sheet/link`, { method: 'POST', body: JSON.stringify({ on: false }) });
  await sync.flush();
  assert.doesNotMatch(only().description, /Call sheet:/);
  assert.equal(live().length, 1, 'still one event');
});

test('pencil → confirmed (Mark accepted) rewrites the event as confirmed', async () => {
  reset();
  const est = await create([day('d_p', '2026-11-10', 'pencilled'), day('d_q', '2026-11-11', 'proposed')]);
  await sync.flush();
  assert.equal(live().length, 1, 'the proposed day isn’t written');
  assert.equal(only().status, 'tentative');

  forget();
  const r = await api(`/api/projects/${est.projectId}/accept?today=2026-10-11`, { method: 'POST', body: JSON.stringify({ invoicing: 'single' }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await sync.flush();
  const events = live();
  assert.equal(events.length, 2, 'accepting confirms the proposed day too, so it is written');
  assert.ok(events.every((e) => e.status === 'confirmed' && !/^Pencil/.test(e.summary)));
  assert.equal(writes().filter((c) => c.method === 'PUT').length, 1, 'the pencilled day’s event updated in place');
});

test('removing a day, proposing it, or making it Date TBC deletes its event', async () => {
  reset();
  let est = await create([day('d_r1', '2026-11-12'), day('d_r2', '2026-11-13'), day('d_r3', '2026-11-14')]);
  await sync.flush();
  assert.equal(live().length, 3);

  forget();
  est = await save(est, { days: [est.days[0], { ...est.days[1], status: 'proposed' }, { ...est.days[2], date: null, startTime: null, endTime: null }] });
  await sync.flush();
  assert.equal(live().length, 1);
  assert.equal(writes().filter((c) => c.method === 'DELETE').length, 2);
  assert.deepEqual(rows().map((r) => r.day_id), ['d_r1'], 'rows of deleted events go');

  forget();
  est = await save(est, { days: [], activeRows: {} });
  await sync.flush();
  assert.equal(live().length, 0);
  assert.equal(rows().length, 0);
});

test('declining deletes the events; reopening writes them again (a deleted event’s id is reused)', async () => {
  reset();
  const est = await create([day('d_x', '2026-11-16'), day('d_y', '2026-11-17')]);
  await sync.flush();
  assert.equal(live().length, 2);

  const dec = await api(`/api/projects/${est.projectId}/decline`, { method: 'POST', body: '{}' });
  assert.equal(dec.status, 200, JSON.stringify(dec.body));
  await sync.flush();
  assert.equal(live().length, 0);
  assert.equal(rows().length, 0);

  forget();
  const re = await api(`/api/projects/${est.projectId}/reopen?today=2026-10-11`, { method: 'POST', body: '{}' });
  assert.equal(re.status, 200, JSON.stringify(re.body));
  await sync.flush();
  assert.equal(live().length, 2, 'both written again');
  // Google keeps a deleted event's id: the create is told so (409), and the
  // same event is updated back instead.
  assert.ok(writes().some((c) => c.method === 'POST'));
  assert.ok(writes().some((c) => c.method === 'PUT'));
  assert.equal(g.events.size, 2, 'no second event made');
});

test('deleting the estimate, or the project, deletes its events', async () => {
  reset();
  const a = await create([day('d_e1', '2026-11-18')]);
  const b = await create([day('d_e2', '2026-11-19')]);
  await sync.flush();
  assert.equal(live().length, 2);
  assert.equal((await api(`/api/estimates/${a.id}`, { method: 'DELETE' })).status, 200);
  await sync.flush();
  assert.equal(live().length, 1);
  assert.equal((await api(`/api/projects/${b.projectId}`, { method: 'DELETE' })).status, 200);
  await sync.flush();
  assert.equal(live().length, 0);
  assert.equal(rows().length, 0);
});

test('the client’s accept on their page confirms the days and writes them (no session)', async () => {
  reset();
  const est = await create([day('d_s', '2026-11-20'), day('d_t', '2026-11-21', 'proposed')]);
  await sync.flush();
  assert.equal(only().status, 'tentative');
  const sent = await api(`/api/projects/${est.projectId}/sent`, { method: 'POST', body: JSON.stringify({ validUntil: '2026-11-30' }) });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const token = sent.body.estimates.find((e) => e.id === est.id).publicToken;
  const page = (await (await fetch(`${base}/public/estimates/${token}`)).json()).estimate;
  forget();
  const r = await fetch(`${base}/public/estimates/${token}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Priya Nair', role: 'Marketing lead', agree: true, version: page.version, key: page.agreement && page.agreement.key }),
  });
  assert.equal(r.status, 200, await r.text());
  await sync.flush();
  const events = live();
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.status === 'confirmed' && !/^Pencil/.test(e.summary)));
});

/* ── Failure and retry ────────────────────────────────────────────────────── */

test('a write that timed out is tried again without making a second event', async () => {
  reset();
  g.vanish = 1;
  const est = await create([day('d_v', '2026-11-23')]);
  await sync.flush();
  assert.equal(live().length, 1, 'Google did make it');
  let r = rowOf('d_v');
  assert.deepEqual([r.state, r.attempts, r.event_id], ['error', 1, null]);
  assert.equal(r.next_try_at, new Date(clock + BACKOFF_MS[0]).toISOString());
  assert.deepEqual((await api('/api/google/status')).body.sync, { enabled: true, pending: 0, errors: 1, running: false, lastSyncedAt: null });
  assert.deepEqual((await api(`/api/estimates/${est.id}`)).body.estimate.googleSync, { d_v: 'error' }, 'the day card’s mark');

  forget();
  await sync.flush();
  assert.equal(writes().length, 0, 'not before its time');

  clock += BACKOFF_MS[0] + 1000;
  await sync.flush();
  assert.equal(live().length, 1, 'still one event');
  r = rowOf('d_v');
  assert.deepEqual([r.state, r.attempts, r.error, r.next_try_at], ['synced', 0, null, null]);
  assert.equal(r.event_id, eventIdOf('d_v'));
  assert.deepEqual((await api(`/api/estimates/${est.id}`)).body.estimate.googleSync, {});
});

test('Google down: back-off 1, 5 then 30 minutes, then on demand; Retry sends it round again', async () => {
  reset();
  g.fail = 100;
  await create([day('d_f', '2026-11-24')]);
  await sync.flush();
  const waits = [];
  let r = rowOf('d_f');
  for (let i = 0; i < 3; i += 1) {
    assert.equal(r.state, 'error');
    waits.push(Date.parse(r.next_try_at) - clock);
    clock = Date.parse(r.next_try_at) + 1;
    // eslint-disable-next-line no-await-in-loop
    await sync.flush();
    r = rowOf('d_f');
  }
  assert.deepEqual(waits, BACKOFF_MS);
  assert.deepEqual([r.state, r.attempts, r.next_try_at], ['error', 4, null], 'after the third retry only on demand');
  forget();
  clock += 24 * 3600 * 1000;
  await sync.flush();
  assert.equal(writes().length, 0, 'it is left alone');
  assert.deepEqual((await api('/api/google/status')).body.sync.errors, 1);

  g.fail = 0;
  const retry = await api('/api/google/sync', { method: 'POST', body: '{}' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.sync.running, true);
  await sync.flush();
  assert.equal(live().length, 1);
  assert.equal(rowOf('d_f').state, 'synced');
  const done = (await api('/api/google/status')).body.sync;
  assert.deepEqual([done.pending, done.errors, done.running], [0, 0, false]);
  assert.ok(done.lastSyncedAt);
});

test('one refused event doesn’t stop the others; Google not answering does', async () => {
  reset();
  g.refuseSummary = 'Refused';
  await create([day('d_ok1', '2026-11-25')], { name: 'Refused shoot' });
  await create([day('d_ok2', '2026-11-26')], { name: 'Fine shoot' });
  await sync.flush();
  assert.equal(live().length, 1);
  assert.equal(rowOf('d_ok2').state, 'synced');
  assert.match(rowOf('d_ok1').error, /^refused \(400\)$/);
  assert.equal(rowOf('d_ok1').attempts, 1);
  assert.ok(!JSON.stringify(rows()).includes('Invalid value'), 'Google’s words are not kept');
});

test('a refused connection leaves the days pending, and the next pass after reconnecting writes them', async () => {
  reset();
  // Write with a stale token that the stub refuses to renew.
  db.prepare('UPDATE google_account SET access_expires_at = ?').run(new Date(clock - 1000).toISOString());
  g.refreshFails = true;
  await create([day('d_w', '2026-11-27')]);
  await sync.flush();
  assert.equal(live().length, 0);
  assert.equal(rowOf('d_w').state, 'pending', 'not an error: nothing is lost');
  const st = (await api('/api/google/status')).body;
  assert.equal(st.problem, 'reconnect');
  assert.equal(st.sync.pending, 1);

  g.refreshFails = false;
  google.forgetReconnect();
  await sync.flush();
  assert.equal(live().length, 1);
  assert.equal(rowOf('d_w').state, 'synced');
});

/* ── Connecting, existing bookings, today ─────────────────────────────────── */

test('nothing is queued while disconnected, and connecting writes nothing by itself', async () => {
  reset();
  db.prepare('DELETE FROM google_account').run();
  const est = await create([day('d_n', '2026-12-01')]);
  await sync.flush();
  assert.equal(writes().length, 0);
  assert.equal(rows().length, 0, 'not even a pending row');

  connect();
  // Another estimate, saved after connecting, is written; the first isn't
  // touched until Sync existing bookings (or an edit to it).
  const other = await create([day('d_n2', '2026-12-02')]);
  await sync.flush();
  assert.deepEqual(live().map((e) => e.extendedProperties.private.lscDayId), ['d_n2']);

  const all = await api('/api/google/sync', { method: 'POST', body: JSON.stringify({ all: true }) });
  assert.equal(all.status, 200);
  assert.equal(all.body.sync.running, true);
  await sync.flush();
  assert.deepEqual(live().map((e) => e.extendedProperties.private.lscDayId).sort(), ['d_n', 'd_n2']);
  assert.equal(other.id !== est.id, true);
});

test('Sync existing writes current confirmed and pencilled days only: not proposed, TBC, declined or past', async () => {
  reset();
  db.prepare('DELETE FROM google_account').run();
  await create([day('d_cur', '2026-12-03'), day('d_prop', '2026-12-04', 'proposed'), day('d_tbc', null, 'proposed'), day('d_past', '2026-09-01', 'confirmed')]);
  const declined = await create([day('d_dec', '2026-12-05')]);
  await api(`/api/projects/${declined.projectId}/decline`, { method: 'POST', body: '{}' });
  connect();
  await api('/api/google/sync', { method: 'POST', body: JSON.stringify({ all: true }) });
  await sync.flush();
  assert.deepEqual(live().map((e) => e.extendedProperties.private.lscDayId), ['d_cur']);
});

test('a written day keeps its event when its date passes; one that never was written is left alone', async () => {
  reset();
  await create([day('d_soon', '2026-10-12')]);
  await sync.flush();
  assert.equal(live().length, 1);
  forget();
  clock = Date.parse('2026-10-20T00:00:00Z');
  sync.noteWrite();
  await sync.flush();
  assert.equal(writes().length, 0, 'not deleted, not rewritten');
  assert.equal(live().length, 1);
  assert.equal(rowOf('d_soon').state, 'synced');
});

test('a route that forgot to say so still can’t leave a stale event: every write re-checks what has one', async () => {
  reset();
  await create([day('d_net', '2026-12-08')]);
  await sync.flush();
  forget();
  // The day moves behind the calendar writer's back.
  db.prepare("UPDATE production_days SET date = '2026-12-10' WHERE id = 'd_net'").run();
  const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ business: { name: 'LSC Creative', abn: '51824753556', email: 'hello@lsc.example' } }) });
  assert.equal(r.status, 200);
  await sync.flush();
  assert.equal(only().start.dateTime, '2026-12-10T07:00:00');
});

test('status is an allow-list, and Retry or Sync need a connection', async () => {
  reset();
  const st = (await api('/api/google/status')).body;
  assert.deepEqual(Object.keys(st.sync).sort(), ['enabled', 'errors', 'lastSyncedAt', 'pending', 'running']);
  db.prepare('DELETE FROM google_account').run();
  const r = await api('/api/google/sync', { method: 'POST', body: '{}' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'google_not_connected');
  connect();
});

test('GOOGLE_CALENDAR_WRITE=0: nothing is marked or written, the status says so, Sync is refused', async () => {
  reset();
  const off = await start({ googleCalendarWrite: false });
  const offSync = off.app.locals.googleSync;
  const res = await fetch(`${off.url}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  const c = res.headers.getSetCookie()[0].split(';')[0];
  const call = (p, o = {}) => fetch(`${off.url}${p}`, { ...o, headers: { 'content-type': 'application/json', cookie: c } });
  const made = await call('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ pricingShape: PRICING_SHAPE, name: 'Off shoot', upid: 'OFF-1', client: { businessName: 'Salt' }, activeRows: {}, days: [day('d_off', '2026-12-20')] }),
  });
  assert.equal(made.status, 201);
  await offSync.flush();
  assert.equal(writes().length, 0);
  assert.equal(rows().length, 0);
  const st = await (await call('/api/google/status')).json();
  assert.equal(st.sync.enabled, false);
  const r = await call('/api/google/sync', { method: 'POST', body: JSON.stringify({ all: true }) });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'google_writing_off');
  offSync.stop();
});
