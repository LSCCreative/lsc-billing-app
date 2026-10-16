'use strict';

/**
 * Google events on the app's calendar (Project build archive/tracks/trip-planner/ task 13; G2, G3):
 * GET /api/calendar?google=1 merges the switched-on calendars' events, minus
 * the app's own, as Sydney dates and times, cached five minutes per calendar
 * and range. A stub stands in for Google and records every request. No reply
 * may carry a token, and Google failing never fails the calendar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-gevents-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const google = require('../src/google');

const PASSWORD = 'correct-horse-battery-staple';
const CLIENT = { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'CLIENT-SECRET-NEVER-SHOWN', redirectUri: 'http://localhost:8080/api/google/oauth/callback' };
const REFRESH = 'REFRESH-TOKEN-NEVER-SHOWN';
const ACCESS = 'ACCESS-TOKEN-NEVER-SHOWN';
const ACCESS2 = 'ACCESS-TOKEN-RENEWED-NEVER-SHOWN';
const SECRETS = [CLIENT.clientSecret, REFRESH, ACCESS, ACCESS2];

const PRIMARY = 'lachlan@creativelsc.com';
const CREW = 'crew@group.calendar.google.com';
const HOLS = 'en.australian#holiday@group.v.calendar.google.com';
const ALEX = 'alex@example.com';
const CALENDARS = [
  { id: PRIMARY, summary: PRIMARY, colour: '#9fc6e7', primary: true, role: 'owner', on: true },
  { id: CREW, summary: 'Crew bookings', colour: '#f83a22', primary: false, role: 'writer', on: true },
  { id: HOLS, summary: 'Holidays in Australia', colour: null, primary: false, role: 'reader', on: false },
  { id: ALEX, summary: 'Alex (editor)', colour: '#7bd148', primary: false, role: 'freeBusyReader', on: true },
];

let db;
let base;
const servers = [];
let clock = Date.parse('2026-10-11T00:00:00Z');

/* ── The stub Google ──────────────────────────────────────────────────────── */

const calls = [];
const g = {
  events: {}, // calendar id → items
  failing: new Set(), // calendar ids answering 500
  refreshFails: false,
  pageSize: 0, // > 0 splits a calendar's items into pages of this size
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fakeGoogle(url, init = {}) {
  const u = new URL(url);
  const method = init.method || 'GET';
  const body = typeof init.body === 'string' ? init.body : '';
  const auth = (init.headers && init.headers.Authorization) || '';
  calls.push({ method, host: u.host, path: u.pathname, search: u.search, auth });
  if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
    const p = new URLSearchParams(body);
    if (g.refreshFails || p.get('refresh_token') !== REFRESH) return json(400, { error: 'invalid_grant' });
    return json(200, { access_token: ACCESS2, expires_in: 3599, token_type: 'Bearer' });
  }
  if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') return json(200, {});
  const m = u.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
  if (u.host === 'www.googleapis.com' && m) {
    if (auth !== `Bearer ${ACCESS}` && auth !== `Bearer ${ACCESS2}`) return json(401, { error: { status: 'UNAUTHENTICATED' } });
    const id = decodeURIComponent(m[1]);
    if (g.failing.has(id)) return json(500, { error: { message: `backend error for ${ACCESS}` } });
    const items = g.events[id] || [];
    if (!g.pageSize) return json(200, { items });
    const at = Number(u.searchParams.get('pageToken') || 0);
    const next = at + g.pageSize;
    return json(200, { items: items.slice(at, next), ...(next < items.length ? { nextPageToken: String(next) } : {}) });
  }
  return json(404, { error: 'not stubbed' });
}

/* ── Plumbing ─────────────────────────────────────────────────────────────── */

async function start(opts) {
  const app = createApp(db, { mapsKey: '', appOrigin: 'https://pages.example/lsc/', googleOAuth: CLIENT, googleFetch: fakeGoogle, googleNow: () => clock, ...opts });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let cookie;

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`INSERT INTO account (id, username, password_hash, created_at, updated_at) VALUES (1, 'lachlan', ?, ?, ?)`)
    .run(await hashPassword(PASSWORD), nowIso(), nowIso());
  base = await start();
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
});

test.after(() => {
  servers.forEach((s) => s.close());
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function api(pathname, opts = {}) {
  const res = await fetch(`${base}${pathname}`, {
    ...opts,
    headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) },
  });
  const text = await res.text();
  for (const s of SECRETS) assert.ok(!text.includes(s), `${pathname} leaked a secret`);
  return { status: res.status, body: JSON.parse(text) };
}

const cal = (q) => api(`/api/calendar?${q}`);
const eventCalls = () => calls.filter((c) => c.path.endsWith('/events'));

function connect(calendars = CALENDARS, { expired = false } = {}) {
  db.prepare(`
    INSERT INTO google_account (id, email, refresh_token, access_token, access_expires_at, calendars_json, connected_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(PRIMARY, REFRESH, ACCESS, new Date(clock + (expired ? -1000 : 3600 * 1000)).toISOString(), JSON.stringify(calendars), nowIso());
}

function reset() {
  db.prepare('DELETE FROM google_account').run();
  google.forgetEvents();
  google.forgetReconnect();
  calls.length = 0;
  g.events = {};
  g.failing = new Set();
  g.refreshFails = false;
  g.pageSize = 0;
  clock = Date.parse('2026-10-11T00:00:00Z');
}

const timed = (id, summary, start, end, extra = {}) => ({ id, status: 'confirmed', summary, start: { dateTime: start }, end: { dateTime: end }, ...extra });
const allDay = (id, summary, start, end, extra = {}) => ({ id, status: 'confirmed', summary, start: { date: start }, end: { date: end }, ...extra });

const RANGE = 'from=2026-09-28&to=2026-11-08';

/* ── Shape ────────────────────────────────────────────────────────────────── */

test('without google=1 the reply is as before: no Google keys and no request to Google', async () => {
  reset();
  connect();
  const r = await cal(RANGE);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['days', 'ok', 'rentals']);
  assert.equal(calls.length, 0);
});

test('not connected: googleState off, nothing asked of Google', async () => {
  reset();
  const r = await cal(`${RANGE}&google=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.googleState, 'off');
  assert.deepEqual(r.body.google, []);
  assert.deepEqual(r.body.googleCalendars, []);
  assert.equal(calls.length, 0);
});

test('connected: the switched-on calendars’ events, in Sydney time, with their calendar’s name and colour', async () => {
  reset();
  connect();
  g.events[PRIMARY] = [
    // 22:30 UTC on the 12th is 09:30 on the 13th in Sydney (AEDT, +11).
    timed('m1', 'Client call', '2026-10-12T22:30:00Z', '2026-10-12T23:15:00Z'),
    allDay('h1', 'Long weekend away', '2026-10-16', '2026-10-19'), // Fri–Sun (end exclusive)
    timed('late', 'Edit night', '2026-10-20T09:00:00Z', '2026-10-20T13:00:00Z'), // 20:00 → midnight
    timed('trip', 'Melbourne trip', '2026-10-22T21:00:00Z', '2026-10-24T07:00:00Z'), // Fri 08:00 → Sat 18:00
  ];
  g.events[CREW] = [timed('c1', '  Gear prep  ', '2026-10-13T03:00:00Z', '2026-10-13T05:00:00Z')];
  g.events[ALEX] = [{ id: 'fb1', start: { dateTime: '2026-10-14T00:00:00Z' }, end: { dateTime: '2026-10-14T02:00:00Z' } }];
  g.events[HOLS] = [allDay('x', 'Should not show: switched off', '2026-10-13', '2026-10-14')];

  const r = await cal(`${RANGE}&google=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.googleState, 'ok');
  assert.deepEqual(r.body.googleMissing, []);
  const byTitle = Object.fromEntries(r.body.google.map((e) => [e.title, e]));
  assert.deepEqual(Object.keys(byTitle).sort(), ['Busy', 'Client call', 'Edit night', 'Gear prep', 'Long weekend away', 'Melbourne trip']);

  const call = byTitle['Client call'];
  assert.deepEqual(Object.keys(call).sort(), ['allDay', 'calendar', 'calendarId', 'colour', 'date', 'endDate', 'endTime', 'id', 'startTime', 'title']);
  assert.equal(call.date, '2026-10-13');
  assert.equal(call.endDate, '2026-10-13');
  assert.equal(call.startTime, '09:30');
  assert.equal(call.endTime, '10:15');
  assert.equal(call.allDay, false);
  assert.equal(call.calendar, PRIMARY);
  assert.equal(call.colour, '#9fc6e7');
  assert.match(call.id, /^[0-9a-f]{16}$/);

  assert.deepEqual([byTitle['Long weekend away'].date, byTitle['Long weekend away'].endDate, byTitle['Long weekend away'].allDay], ['2026-10-16', '2026-10-18', true]);
  assert.deepEqual([byTitle['Long weekend away'].startTime, byTitle['Long weekend away'].endTime], [null, null]);
  // Ending at midnight ends that day, not the next.
  assert.deepEqual([byTitle['Edit night'].date, byTitle['Edit night'].endDate, byTitle['Edit night'].endTime], ['2026-10-20', '2026-10-20', '00:00']);
  assert.deepEqual([byTitle['Melbourne trip'].date, byTitle['Melbourne trip'].endDate, byTitle['Melbourne trip'].startTime, byTitle['Melbourne trip'].endTime],
    ['2026-10-23', '2026-10-24', '08:00', '18:00']);
  assert.equal(byTitle['Gear prep'].calendar, 'Crew bookings');
  // An untitled event on a busy-times-only calendar is all Google says it is.
  assert.equal(byTitle.Busy.calendar, 'Alex (editor)');

  // In date order, an all-day event before a timed one on the same date.
  const dates = r.body.google.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort());

  // The toggle list comes with it, for Calendars ▾.
  assert.deepEqual(r.body.googleCalendars.map((c) => [c.id, c.on]), CALENDARS.map((c) => [c.id, c.on]));
  // Switched-off calendars aren't asked.
  assert.deepEqual(eventCalls().map((c) => decodeURIComponent(c.path.split('/')[4])).sort(), [ALEX, CREW, PRIMARY].sort());
});

test('the app’s own events, cancelled ones, declined invitations and working locations are left out', async () => {
  reset();
  connect();
  g.events[PRIMARY] = [
    timed('own', 'LSC-042 · Shoot · Acme', '2026-10-13T21:00:00Z', '2026-10-14T06:00:00Z', { extendedProperties: { private: { lscDayId: 'd_abc' } } }),
    timed('gone', 'Cancelled thing', '2026-10-13T01:00:00Z', '2026-10-13T02:00:00Z', { status: 'cancelled' }),
    timed('no', 'Declined meeting', '2026-10-13T01:00:00Z', '2026-10-13T02:00:00Z', { attendees: [{ self: true, responseStatus: 'declined' }] }),
    allDay('wl', 'Home', '2026-10-13', '2026-10-14', { eventType: 'workingLocation' }),
    timed('yes', 'Accepted meeting', '2026-10-13T01:00:00Z', '2026-10-13T02:00:00Z', { attendees: [{ self: true, responseStatus: 'accepted' }, { email: 'x@y', responseStatus: 'declined' }] }),
    { id: 'untitled', status: 'confirmed', start: { date: '2026-10-15' }, end: { date: '2026-10-16' } },
  ];
  const r = await cal(`${RANGE}&google=1`);
  assert.deepEqual(r.body.google.map((e) => e.title).sort(), ['(No title)', 'Accepted meeting']);
});

test('events outside the range are dropped; one that overlaps its start is kept', async () => {
  reset();
  connect([{ ...CALENDARS[0] }]);
  g.events[PRIMARY] = [
    allDay('before', 'Ends the day before', '2026-09-25', '2026-09-28'),
    allDay('over', 'Runs into the range', '2026-09-26', '2026-09-30'),
    // 23:30 UTC on 8 Nov is 10:30 on the 9th in Sydney: after the range.
    timed('after', 'Next morning in Sydney', '2026-11-08T23:30:00Z', '2026-11-09T00:30:00Z'),
  ];
  const r = await cal(`${RANGE}&google=1`);
  assert.deepEqual(r.body.google.map((e) => e.title), ['Runs into the range']);
});

test('the request: single events in Sydney’s zone round the range, the calendar id escaped, every page read', async () => {
  reset();
  connect([{ ...CALENDARS[2], on: true }]);
  g.pageSize = 2;
  g.events[HOLS] = ['a', 'b', 'c', 'd', 'e'].map((n, i) => allDay(n, `Holiday ${n}`, `2026-10-0${i + 1}`, `2026-10-0${i + 2}`));
  const r = await cal(`${RANGE}&google=1`);
  assert.equal(r.body.google.length, 5);
  const ev = eventCalls();
  assert.equal(ev.length, 3);
  assert.equal(ev[0].path, `/calendar/v3/calendars/${encodeURIComponent(HOLS)}/events`);
  const q = new URLSearchParams(ev[0].search);
  assert.equal(q.get('singleEvents'), 'true');
  assert.equal(q.get('timeZone'), 'Australia/Sydney');
  assert.equal(q.get('timeMin'), '2026-09-27T00:00:00Z');
  assert.equal(q.get('timeMax'), '2026-11-09T00:00:00Z');
  assert.equal(new URLSearchParams(ev[2].search).get('pageToken'), '4');
});

/* ── The cache ────────────────────────────────────────────────────────────── */

test('cached five minutes per calendar and range; refresh=1 asks again', async () => {
  reset();
  connect();
  g.events[PRIMARY] = [timed('m1', 'Client call', '2026-10-12T22:30:00Z', '2026-10-12T23:15:00Z')];
  await cal(`${RANGE}&google=1`);
  assert.equal(eventCalls().length, 3);

  g.events[PRIMARY] = [timed('m2', 'Moved call', '2026-10-13T22:30:00Z', '2026-10-13T23:15:00Z')];
  clock += 4 * 60 * 1000;
  const cached = await cal(`${RANGE}&google=1`);
  assert.equal(eventCalls().length, 3, 'served from the cache');
  assert.deepEqual(cached.body.google.map((e) => e.title), ['Client call']);

  const refreshed = await cal(`${RANGE}&google=1&refresh=1`);
  assert.equal(eventCalls().length, 6);
  assert.deepEqual(refreshed.body.google.map((e) => e.title), ['Moved call']);

  // Another range is its own entry.
  await cal('from=2026-10-26&to=2026-12-06&google=1');
  assert.equal(eventCalls().length, 9);

  clock += 5 * 60 * 1000;
  await cal(`${RANGE}&google=1`);
  assert.equal(eventCalls().length, 12, 'expired after five minutes');
});

test('switching a calendar on asks for that one only; switching one off hides it at once', async () => {
  reset();
  connect();
  g.events[PRIMARY] = [timed('m1', 'Client call', '2026-10-12T22:30:00Z', '2026-10-12T23:15:00Z')];
  g.events[HOLS] = [allDay('lw', 'Labour Day', '2026-10-05', '2026-10-06')];
  await cal(`${RANGE}&google=1`);
  calls.length = 0;

  const put = await api('/api/google/calendars', { method: 'PUT', body: JSON.stringify({ on: [PRIMARY, HOLS] }) });
  assert.equal(put.status, 200);
  const r = await cal(`${RANGE}&google=1`);
  assert.deepEqual(eventCalls().map((c) => decodeURIComponent(c.path.split('/')[4])), [HOLS]);
  assert.deepEqual(r.body.google.map((e) => e.title), ['Labour Day', 'Client call']);

  await api('/api/google/calendars', { method: 'PUT', body: JSON.stringify({ on: [HOLS] }) });
  const off = await cal(`${RANGE}&google=1`);
  assert.deepEqual(off.body.google.map((e) => e.title), ['Labour Day']);
  assert.equal(eventCalls().length, 1, 'nothing new asked');
});

test('no calendar switched on: ok and empty, nothing asked', async () => {
  reset();
  connect(CALENDARS.map((c) => ({ ...c, on: false })));
  const r = await cal(`${RANGE}&google=1`);
  assert.equal(r.body.googleState, 'ok');
  assert.deepEqual(r.body.google, []);
  assert.equal(calls.length, 0);
});

test('disconnecting forgets the cached events', async () => {
  reset();
  connect([{ ...CALENDARS[0] }]);
  g.events[PRIMARY] = [timed('m1', 'Client call', '2026-10-12T22:30:00Z', '2026-10-12T23:15:00Z')];
  await cal(`${RANGE}&google=1`);
  await api('/api/google/disconnect', { method: 'POST', body: '{}' });
  const off = await cal(`${RANGE}&google=1`);
  assert.equal(off.body.googleState, 'off');
  calls.length = 0;
  connect([{ ...CALENDARS[0] }]);
  await cal(`${RANGE}&google=1`);
  assert.equal(eventCalls().length, 1, 'asked again, not served from before the disconnect');
});

/* ── Failures ─────────────────────────────────────────────────────────────── */

test('one calendar failing: the others still show, and it is named', async () => {
  reset();
  connect();
  g.events[PRIMARY] = [timed('m1', 'Client call', '2026-10-12T22:30:00Z', '2026-10-12T23:15:00Z')];
  g.failing.add(CREW);
  const r = await cal(`${RANGE}&google=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.googleState, 'ok');
  assert.deepEqual(r.body.googleMissing, ['Crew bookings']);
  assert.deepEqual(r.body.google.map((e) => e.title), ['Client call']);
  // A failure isn't cached: the next look asks again.
  calls.length = 0;
  g.failing.clear();
  await cal(`${RANGE}&google=1`);
  assert.deepEqual(eventCalls().map((c) => decodeURIComponent(c.path.split('/')[4])), [CREW]);
});

test('every calendar failing: unavailable, and the app’s days still come', async () => {
  reset();
  connect();
  g.failing = new Set([PRIMARY, CREW, ALEX]);
  const r = await cal(`${RANGE}&google=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.googleState, 'unavailable');
  assert.deepEqual(r.body.google, []);
  assert.ok(Array.isArray(r.body.days));
});

test('the token renewed once for every calendar; a refused refresh token says reconnect', async () => {
  reset();
  connect(CALENDARS, { expired: true });
  await cal(`${RANGE}&google=1`);
  assert.equal(calls.filter((c) => c.path === '/token').length, 1);
  assert.ok(eventCalls().every((c) => c.auth === `Bearer ${ACCESS2}`));

  reset();
  connect(CALENDARS, { expired: true });
  g.refreshFails = true;
  const r = await cal(`${RANGE}&google=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.googleState, 'reconnect');
  assert.equal(eventCalls().length, 0);
});

/* ── Units ────────────────────────────────────────────────────────────────── */

test('sydneyParts follows daylight saving', () => {
  assert.deepEqual(google.sydneyParts('2026-07-01T00:00:00Z'), { date: '2026-07-01', time: '10:00' }); // AEST
  assert.deepEqual(google.sydneyParts('2026-12-01T00:00:00Z'), { date: '2026-12-01', time: '11:00' }); // AEDT
  assert.deepEqual(google.sydneyParts('2026-12-01T13:00:00Z'), { date: '2026-12-02', time: '00:00' });
  assert.equal(google.sydneyParts('not a time'), null);
});

test('eventFrom refuses what it can’t place', () => {
  const c = { id: PRIMARY, role: 'owner' };
  assert.equal(google.eventFrom(null, c), null);
  assert.equal(google.eventFrom({ id: 'x', start: {}, end: {} }, c), null);
  assert.equal(google.eventFrom({ id: 'x', start: { dateTime: 'garbage' }, end: {} }, c), null);
  // No end at all: a moment, on its start date.
  const moment = google.eventFrom({ id: 'x', summary: 'Ping', start: { dateTime: '2026-10-13T01:00:00Z' } }, c);
  assert.deepEqual([moment.date, moment.endDate, moment.startTime, moment.endTime], ['2026-10-13', '2026-10-13', '12:00', '12:00']);
  // The same event in two calendars has two ids.
  const a = google.eventFrom({ id: 'same', start: { date: '2026-10-13' }, end: { date: '2026-10-14' } }, c);
  const b = google.eventFrom({ id: 'same', start: { date: '2026-10-13' }, end: { date: '2026-10-14' } }, { id: CREW, role: 'writer' });
  assert.notEqual(a.id, b.id);
});
