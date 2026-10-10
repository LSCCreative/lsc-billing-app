'use strict';

/**
 * Connecting Google Calendar (.design/trip-planner/ task 12; G1, G2, I3): the
 * OAuth start and callback, the state check, the stored account, the calendar
 * toggles, token renewal and disconnect. A stub stands in for Google; every
 * request it gets is recorded so the tests can say what was (and wasn't) sent.
 * No reply may carry a token.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-google-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { forgetStates } = require('../src/routes/google');
const google = require('../src/google');

const PASSWORD = 'correct-horse-battery-staple';
const APP = 'https://pages.example/lsc/';
const CLIENT = { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'CLIENT-SECRET-NEVER-SHOWN', redirectUri: 'http://localhost:8080/api/google/oauth/callback' };
const REFRESH = 'REFRESH-TOKEN-NEVER-SHOWN';
const ACCESS = 'ACCESS-TOKEN-NEVER-SHOWN';
const ACCESS2 = 'ACCESS-TOKEN-RENEWED-NEVER-SHOWN';
const SECRETS = [CLIENT.clientSecret, REFRESH, ACCESS, ACCESS2];
const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';

let db;
let base; // configured
let bare; // no OAuth client
const servers = [];
let clock = Date.parse('2026-10-11T00:00:00Z');

/* ── The stub Google ──────────────────────────────────────────────────────── */

const calls = [];
const google_ = {
  scope: SCOPE,
  refreshToken: REFRESH,
  refreshFails: false, // invalid_grant on renewal
  list: [
    { id: 'lachlan@creativelsc.com', summary: 'lachlan@creativelsc.com', primary: true, accessRole: 'owner', backgroundColor: '#9FC6E7' },
    { id: 'crew@group.calendar.google.com', summary: 'Crew bookings', accessRole: 'writer', backgroundColor: '#f83a22' },
    { id: 'en.australian#holiday@group.v.calendar.google.com', summary: 'Holidays in Australia', accessRole: 'reader', backgroundColor: 'not-a-colour' },
    { id: 'alex@example.com', summary: 'alex@example.com', summaryOverride: 'Alex (editor)', accessRole: 'freeBusyReader', backgroundColor: '#7bd148' },
    { id: 'mine@group.calendar.google.com', summary: 'A personal one', accessRole: 'owner' },
  ],
  missingEvents: new Set(),
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fakeGoogle(url, init = {}) {
  const u = new URL(url);
  const method = init.method || 'GET';
  const body = typeof init.body === 'string' ? init.body : '';
  const auth = (init.headers && init.headers.Authorization) || '';
  calls.push({ method, host: u.host, path: u.pathname, search: u.search, body, auth });
  if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
    const p = new URLSearchParams(body);
    if (p.get('client_secret') !== CLIENT.clientSecret) return json(401, { error: 'invalid_client' });
    if (p.get('grant_type') === 'authorization_code') {
      if (p.get('code') !== 'good-code') return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: ACCESS, expires_in: 3599, refresh_token: google_.refreshToken, scope: google_.scope, token_type: 'Bearer' });
    }
    if (p.get('grant_type') === 'refresh_token') {
      if (google_.refreshFails || p.get('refresh_token') !== REFRESH) return json(400, { error: 'invalid_grant', error_description: `Token ${REFRESH} has been expired or revoked.` });
      return json(200, { access_token: ACCESS2, expires_in: 3599, scope: google_.scope, token_type: 'Bearer' });
    }
  }
  if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') return json(200, {});
  if (u.host === 'www.googleapis.com' && u.pathname === '/calendar/v3/users/me/calendarList') {
    if (auth !== `Bearer ${ACCESS}` && auth !== `Bearer ${ACCESS2}`) return json(401, { error: { status: 'UNAUTHENTICATED' } });
    const page = new URLSearchParams(u.search).get('pageToken');
    // Two pages, to prove the list is read to the end.
    return page === 'p2'
      ? json(200, { items: google_.list.slice(2) })
      : json(200, { items: google_.list.slice(0, 2), nextPageToken: 'p2' });
  }
  const del = u.pathname.match(/^\/calendar\/v3\/calendars\/primary\/events\/(.+)$/);
  if (u.host === 'www.googleapis.com' && del && method === 'DELETE') {
    const id = decodeURIComponent(del[1]);
    if (google_.missingEvents.has(id)) return json(410, { error: { status: 'GONE' } });
    return new Response(null, { status: 204 });
  }
  return json(404, { error: 'not stubbed' });
}

/* ── Plumbing ─────────────────────────────────────────────────────────────── */

async function start(opts) {
  const app = createApp(db, { mapsKey: '', appOrigin: APP, googleFetch: fakeGoogle, googleNow: () => clock, ...opts });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function login(url) {
  const res = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  return res.headers.getSetCookie()[0].split(';')[0];
}

let cookie;
let otherCookie; // a second browser, signed in too

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`INSERT INTO account (id, username, password_hash, created_at, updated_at) VALUES (1, 'lachlan', ?, ?, ?)`)
    .run(await hashPassword(PASSWORD), nowIso(), nowIso());
  base = await start({ googleOAuth: CLIENT });
  bare = await start({ googleOAuth: {} });
  cookie = await login(base);
  otherCookie = await login(base);
});

test.after(() => {
  servers.forEach((s) => s.close());
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** Every reply is checked for leaked secrets on the way through. */
function noSecrets(text, where) {
  for (const s of SECRETS) assert.ok(!text.includes(s), `${where} leaked a secret`);
}

async function api(pathname, opts = {}, url = base) {
  const res = await fetch(`${url}${pathname}`, {
    redirect: 'manual',
    ...opts,
    headers: { 'content-type': 'application/json', cookie: opts.cookie === undefined ? cookie : opts.cookie, ...(opts.headers || {}) },
  });
  const text = await res.text();
  noSecrets(text, pathname);
  noSecrets(res.headers.get('location') || '', `${pathname} (Location)`);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) { /* not JSON */ }
  return { status: res.status, body, text, location: res.headers.get('location') };
}

/* Start the flow; returns the state Google would carry back. */
async function begin(c = cookie) {
  const r = await api('/api/google/oauth/start', { cookie: c });
  assert.equal(r.status, 302);
  const to = new URL(r.location);
  return { to, state: to.searchParams.get('state') };
}

const callback = (q, c = cookie) => api(`/api/google/oauth/callback?${new URLSearchParams(q)}`, { cookie: c });
const backTo = (query) => `${APP}#/settings/calendar?${query}`;
const tokenCalls = () => calls.filter((c) => c.path === '/token').length;
const status = () => api('/api/google/status');

async function connect() {
  const { state } = await begin();
  const r = await callback({ code: 'good-code', state });
  assert.equal(r.location, backTo('connected=1'));
}

function reset() {
  db.prepare('DELETE FROM google_account').run();
  db.prepare('DELETE FROM google_event_sync').run();
  google.forgetReconnect();
  forgetStates();
  calls.length = 0;
  google_.scope = SCOPE;
  google_.refreshToken = REFRESH;
  google_.refreshFails = false;
  google_.missingEvents = new Set();
}

/* ── Status before connecting ─────────────────────────────────────────────── */

test('status: not set up on the server, and set up but not connected', async () => {
  reset();
  const off = await api('/api/google/status', {}, bare);
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { configured: false, connected: false, email: '', connectedAt: null, calendars: [], problem: null, sync: { pending: 0, errors: 0 } });
  const on = await status();
  assert.equal(on.body.configured, true);
  assert.equal(on.body.connected, false);
});

test('status and the toggles need a session', async () => {
  for (const [method, p] of [['GET', '/api/google/status'], ['PUT', '/api/google/calendars'], ['POST', '/api/google/disconnect'], ['POST', '/api/google/calendars/refresh']]) {
    const r = await api(p, { method, cookie: '', body: method === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 401, `${method} ${p}`);
  }
});

/* ── Start ────────────────────────────────────────────────────────────────── */

test('start: signed out, or no client on the server, goes back to the app with a reason', async () => {
  reset();
  const signedOut = await api('/api/google/oauth/start', { cookie: '' });
  assert.equal(signedOut.status, 302);
  assert.equal(signedOut.location, backTo('error=signed_out'));
  const noClient = await api('/api/google/oauth/start', {}, bare);
  assert.equal(noClient.location, backTo('error=not_configured'));
});

test('start: Google’s consent page with offline access, consent, both scopes and a state', async () => {
  reset();
  const { to, state } = await begin();
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = to.searchParams;
  assert.equal(q.get('client_id'), CLIENT.clientId);
  assert.equal(q.get('redirect_uri'), CLIENT.redirectUri);
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('access_type'), 'offline');
  assert.equal(q.get('prompt'), 'consent');
  assert.deepEqual(q.get('scope').split(' ').sort(), SCOPE.split(' ').sort());
  assert.match(state, /^[\w-]+\.[\w-]+$/);
  assert.ok(!to.href.includes(CLIENT.clientSecret), 'the secret never goes to the browser');
});

test('start: with no redirect URI configured, the API’s own address is used', async () => {
  reset();
  const derived = await start({ googleOAuth: { ...CLIENT, redirectUri: '' } });
  const r = await api('/api/google/oauth/start', { cookie: await login(derived) }, derived);
  assert.equal(new URL(r.location).searchParams.get('redirect_uri'), `${derived}/api/google/oauth/callback`);
});

/* ── The state check ──────────────────────────────────────────────────────── */

test('callback: a state that was tampered with, missing or made up is refused before any code is swapped', async () => {
  reset();
  const { state } = await begin();
  const [payload, sig] = state.split('.');
  const flipped = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
  for (const bad of [`${flipped}.${sig}`, `${payload}.${sig.slice(0, -2)}xx`, '', 'nonsense', `${payload}.`]) {
    const r = await callback({ code: 'good-code', state: bad });
    assert.equal(r.location, backTo('error=oauth_failed'), `state ${JSON.stringify(bad)}`);
  }
  assert.equal(tokenCalls(), 0);
  assert.equal(google.readAccount(db), null);
});

test('callback: a state from another browser’s session is refused', async () => {
  reset();
  const { state } = await begin(otherCookie);
  const r = await callback({ code: 'good-code', state }, cookie);
  assert.equal(r.location, backTo('error=oauth_failed'));
  assert.equal(tokenCalls(), 0);
});

test('callback: signed out by the time Google sends the browser back', async () => {
  reset();
  const { state } = await begin();
  const r = await callback({ code: 'good-code', state }, '');
  assert.equal(r.location, backTo('error=signed_out'));
  assert.equal(tokenCalls(), 0);
});

test('callback: a state over 10 minutes old is refused', async () => {
  reset();
  const { state } = await begin();
  clock += 10 * 60 * 1000 + 1;
  const r = await callback({ code: 'good-code', state });
  assert.equal(r.location, backTo('error=oauth_failed'));
  assert.equal(tokenCalls(), 0);
});

test('callback: a state works once', async () => {
  reset();
  const { state } = await begin();
  assert.equal((await callback({ code: 'good-code', state })).location, backTo('connected=1'));
  const again = await callback({ code: 'good-code', state });
  assert.equal(again.location, backTo('error=oauth_failed'));
  assert.equal(tokenCalls(), 1);
});

/* ── The callback's outcomes ──────────────────────────────────────────────── */

test('callback: cancelling on Google’s screen says so, and stores nothing', async () => {
  reset();
  const { state } = await begin();
  const r = await callback({ error: 'access_denied', state });
  assert.equal(r.location, backTo('error=access_denied'));
  assert.equal(tokenCalls(), 0);
  assert.equal(google.readAccount(db), null);
});

test('callback: a code Google won’t swap fails without storing anything', async () => {
  reset();
  const { state } = await begin();
  const r = await callback({ code: 'stale-code', state });
  assert.equal(r.location, backTo('error=oauth_failed'));
  assert.equal(google.readAccount(db), null);
});

test('callback: a permission left unticked is refused (both are needed)', async () => {
  reset();
  google_.scope = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
  const { state } = await begin();
  const r = await callback({ code: 'good-code', state });
  assert.equal(r.location, backTo('error=scopes'));
  assert.equal(google.readAccount(db), null);
});

test('callback: no refresh token back means no lasting connection', async () => {
  reset();
  google_.refreshToken = undefined;
  const { state } = await begin();
  const r = await callback({ code: 'good-code', state });
  assert.equal(r.location, backTo('error=oauth_failed'));
  assert.equal(google.readAccount(db), null);
});

test('callback: connects, storing the tokens on the NAS and the calendar list (primary first and on)', async () => {
  reset();
  await connect();
  const swap = calls.find((c) => c.path === '/token');
  const sent = new URLSearchParams(swap.body);
  assert.equal(sent.get('redirect_uri'), CLIENT.redirectUri, 'the same redirect URI as the consent');
  assert.equal(sent.get('grant_type'), 'authorization_code');

  const row = google.readAccount(db);
  assert.equal(row.email, 'lachlan@creativelsc.com');
  assert.equal(row.refresh_token, REFRESH, 'stored plain (I3)');
  assert.equal(row.access_token, ACCESS);

  const s = await status();
  assert.equal(s.body.connected, true);
  assert.equal(s.body.email, 'lachlan@creativelsc.com');
  assert.ok(s.body.connectedAt);
  assert.deepEqual(s.body.calendars.map((c) => [c.summary, c.role, c.on]), [
    ['lachlan@creativelsc.com', 'owner', true],
    ['A personal one', 'owner', false],
    ['Alex (editor)', 'freeBusyReader', false],
    ['Crew bookings', 'writer', false],
    ['Holidays in Australia', 'reader', false],
  ]);
  assert.equal(s.body.calendars[0].primary, true);
  assert.equal(s.body.calendars[0].colour, '#9fc6e7');
  assert.equal(s.body.calendars.find((c) => c.summary === 'Holidays in Australia').colour, null, 'a bad colour is dropped');
  // The reply is an allow-list.
  assert.deepEqual(Object.keys(s.body).sort(), ['calendars', 'configured', 'connected', 'connectedAt', 'email', 'problem', 'sync']);
  assert.deepEqual(Object.keys(s.body.calendars[0]).sort(), ['colour', 'id', 'on', 'primary', 'role', 'summary']);
});

/* ── The toggles ──────────────────────────────────────────────────────────── */

test('calendars: the toggles save, unknown ids are ignored, a bad body is refused', async () => {
  reset();
  await connect();
  const r = await api('/api/google/calendars', {
    method: 'PUT',
    body: JSON.stringify({ on: ['crew@group.calendar.google.com', 'alex@example.com', 'no-such-calendar'] }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.calendars.filter((c) => c.on).map((c) => c.id), ['alex@example.com', 'crew@group.calendar.google.com']);
  assert.ok(!r.body.calendars.some((c) => c.id === 'no-such-calendar'));
  assert.deepEqual((await status()).body.calendars.filter((c) => c.on).length, 2);

  for (const bad of [{}, { on: 'crew' }, { on: [1] }, { on: ['x'.repeat(301)] }]) {
    const no = await api('/api/google/calendars', { method: 'PUT', body: JSON.stringify(bad) });
    assert.equal(no.status, 400, JSON.stringify(bad));
    assert.equal(no.body.error, 'calendars_invalid');
  }
});

test('calendars: refused when not connected', async () => {
  reset();
  const r = await api('/api/google/calendars', { method: 'PUT', body: JSON.stringify({ on: [] }) });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'google_not_connected');
  const refresh = await api('/api/google/calendars/refresh', { method: 'POST', body: '{}' });
  assert.equal(refresh.body.error, 'google_not_connected');
});

test('calendars: Refresh keeps each toggle, adds a newly shared calendar switched off, and renews an expired token', async () => {
  reset();
  await connect();
  await api('/api/google/calendars', { method: 'PUT', body: JSON.stringify({ on: ['crew@group.calendar.google.com'] }) });
  google_.list.push({ id: 'new@group.calendar.google.com', summary: 'Just shared', accessRole: 'reader', backgroundColor: '#ffad46' });
  try {
    clock += 2 * 60 * 60 * 1000; // the access token has run out
    calls.length = 0;
    const r = await api('/api/google/calendars/refresh', { method: 'POST', body: '{}' });
    assert.equal(r.status, 200);
    const on = r.body.calendars.filter((c) => c.on).map((c) => c.id);
    assert.deepEqual(on, ['crew@group.calendar.google.com'], 'the primary stays off once switched off; the new one starts off');
    assert.ok(r.body.calendars.some((c) => c.id === 'new@group.calendar.google.com' && !c.on));
    const renew = calls.find((c) => c.path === '/token');
    assert.equal(new URLSearchParams(renew.body).get('grant_type'), 'refresh_token');
    assert.equal(google.readAccount(db).access_token, ACCESS2);
  } finally {
    google_.list.pop();
  }
});

test('calendars: a refresh token Google no longer accepts asks for a reconnect', async () => {
  reset();
  await connect();
  clock += 2 * 60 * 60 * 1000;
  google_.refreshFails = true;
  const r = await api('/api/google/calendars/refresh', { method: 'POST', body: '{}' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'google_reconnect');
  assert.equal((await status()).body.problem, 'reconnect');
  // Connecting again clears it.
  google_.refreshFails = false;
  await connect();
  assert.equal((await status()).body.problem, null);
});

test('calendars: reconnecting the same account keeps the toggles and the connected date; another account starts afresh', async () => {
  reset();
  await connect();
  const first = (await status()).body.connectedAt;
  await api('/api/google/calendars', { method: 'PUT', body: JSON.stringify({ on: ['crew@group.calendar.google.com'] }) });
  db.prepare(`INSERT INTO google_event_sync (day_id, estimate_id, event_id, state, updated_at) VALUES ('d1', 'e1', 'ev1', 'synced', ?)`).run(nowIso());
  clock += 1000;
  await connect();
  const again = (await status()).body;
  assert.equal(again.connectedAt, first);
  assert.deepEqual(again.calendars.filter((c) => c.on).map((c) => c.id), ['crew@group.calendar.google.com']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM google_event_sync').get().n, 1, 'the same account keeps its events');

  const primary = google_.list[0];
  const saved = { ...primary };
  Object.assign(primary, { id: 'someone@else.com', summary: 'someone@else.com' });
  try {
    await connect();
    const other = (await status()).body;
    assert.equal(other.email, 'someone@else.com');
    assert.deepEqual(other.calendars.filter((c) => c.on).map((c) => c.id), ['someone@else.com']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM google_event_sync').get().n, 0, 'another account’s events are forgotten');
  } finally {
    Object.assign(primary, saved);
  }
});

/* ── Disconnect ───────────────────────────────────────────────────────────── */

test('disconnect: revokes the grant and forgets the account, leaving Google’s events', async () => {
  reset();
  await connect();
  db.prepare(`INSERT INTO google_event_sync (day_id, estimate_id, event_id, state, updated_at) VALUES ('d1', 'e1', 'ev1', 'synced', ?)`).run(nowIso());
  calls.length = 0;
  const r = await api('/api/google/disconnect', { method: 'POST', body: JSON.stringify({ removeEvents: false }) });
  assert.deepEqual(r.body, { disconnected: true, revoked: true, removed: 0, notRemoved: 0 });
  const revoke = calls.find((c) => c.path === '/revoke');
  assert.equal(new URLSearchParams(revoke.body).get('token'), REFRESH);
  assert.ok(!calls.some((c) => c.method === 'DELETE'));
  assert.equal(google.readAccount(db), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM google_event_sync').get().n, 1, 'kept, for a reconnect to find');
  assert.equal((await status()).body.connected, false);
});

test('disconnect: “Also remove the app’s events” deletes each from the primary calendar (one already gone counts)', async () => {
  reset();
  await connect();
  const ins = db.prepare(`INSERT INTO google_event_sync (day_id, estimate_id, event_id, state, updated_at) VALUES (?, 'e1', ?, 'synced', ?)`);
  ins.run('d1', 'ev1', nowIso());
  ins.run('d2', 'ev/2', nowIso());
  ins.run('d3', null, nowIso()); // never written
  google_.missingEvents.add('ev/2');
  calls.length = 0;
  const r = await api('/api/google/disconnect', { method: 'POST', body: JSON.stringify({ removeEvents: true }) });
  assert.deepEqual(r.body, { disconnected: true, revoked: true, removed: 2, notRemoved: 0 });
  assert.deepEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.path), [
    '/calendar/v3/calendars/primary/events/ev1',
    '/calendar/v3/calendars/primary/events/ev%2F2',
  ]);
  assert.deepEqual(db.prepare('SELECT day_id FROM google_event_sync').all().map((x) => x.day_id), ['d3']);
  // Removing comes before revoking: the token is still good for the deletes.
  const order = calls.map((c) => (c.path === '/revoke' ? 'revoke' : c.method === 'DELETE' ? 'delete' : null)).filter(Boolean);
  assert.deepEqual(order, ['delete', 'delete', 'revoke']);
});

test('disconnect: works locally even when Google refuses the token', async () => {
  reset();
  await connect();
  db.prepare(`INSERT INTO google_event_sync (day_id, estimate_id, event_id, state, updated_at) VALUES ('d1', 'e1', 'ev1', 'synced', ?)`).run(nowIso());
  clock += 2 * 60 * 60 * 1000;
  google_.refreshFails = true;
  const r = await api('/api/google/disconnect', { method: 'POST', body: JSON.stringify({ removeEvents: true }) });
  assert.equal(r.body.disconnected, true);
  assert.equal(r.body.removed, 0);
  assert.equal(r.body.notRemoved, 1);
  assert.equal(google.readAccount(db), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM google_event_sync').get().n, 1);
});

test('disconnect when not connected is a quiet success', async () => {
  reset();
  const r = await api('/api/google/disconnect', { method: 'POST', body: '{}' });
  assert.deepEqual(r.body, { disconnected: true, revoked: false, removed: 0, notRemoved: 0 });
});

/* ── Unit: the list ───────────────────────────────────────────────────────── */

test('calendarsFrom: deleted and id-less entries are dropped; the primary is on only the first time', () => {
  const items = [
    { id: 'a@x', summary: 'a@x', primary: true, accessRole: 'owner' },
    { id: 'gone', summary: 'Gone', deleted: true },
    { summary: 'no id' },
  ];
  assert.deepEqual(google.calendarsFrom(items, null).map((c) => [c.id, c.on]), [['a@x', true]]);
  assert.deepEqual(google.calendarsFrom(items, [{ id: 'other', on: true }]).map((c) => [c.id, c.on]), [['a@x', false]]);
  assert.equal(google.accountEmail(items), 'a@x');
});
