'use strict';

/**
 * The call sheet (.design/trip-planner/ task 9; T12, T13, T18, I4): the
 * allow-listed schedule of an estimate's trips, the link that shares it, and
 * the Maps Static image behind each day. Google is never called: the fetch is
 * a stub that counts and records what it was asked.
 *
 * Its own server, so its public rate limits don't touch test-public.js's.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-callsheet-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';
const PAGES = 'https://pages.example';
process.env.CORS_ORIGINS = PAGES;

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE } = require('../src/calc');
const google = require('../src/google');

const PASSWORD = 'correct-horse-battery-staple';
const SERVER_KEY = 'AIzaSy-SERVER-KEY-MUST-NEVER-LEAVE-0123456789';
const APP_URL = 'https://pages.example/lsc/';

let db;
let cookie;
const servers = [];
let base;
let keylessBase;

/* Everything any request got back (status line aside): body and headers. The
   server key must be in none of it. */
const seen = [];

/* The stub Maps Static. `mode` picks what it answers. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('route-image-bytes')]);
const maps = { calls: [], mode: 'ok' };
async function mapsFetch(url) {
  maps.calls.push(String(url));
  if (maps.mode === 'down') throw new Error('network down: ' + SERVER_KEY);
  if (maps.mode === 'refused') return new Response('{"error":"REQUEST_DENIED key=' + SERVER_KEY + '"}', { status: 403 });
  if (maps.mode === 'html') return new Response('<html>not an image</html>', { status: 200 });
  return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
}

async function start(opts) {
  const app = createApp(db, {
    publicLimits: { all: { max: 10000, windowMs: 60000 }, pdf: { max: 10000, windowMs: 60000 } },
    appUrl: APP_URL,
    ...opts,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`INSERT INTO account (id, username, password_hash, created_at, updated_at) VALUES (1, 'lachlan', ?, ?, ?)`)
    .run(await hashPassword(PASSWORD), nowIso(), nowIso());
  base = await start({ mapsKey: SERVER_KEY, mapsFetch });
  keylessBase = await start({ mapsKey: '', mapsFetch });
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
  await api('/api/pricing/reset', { method: 'POST' });
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      business: {
        name: 'LSC Creative', abn: '12345678901', email: 'hello@lsc.example', phone: '0412 000 000',
        signer: 'Lachlan Sullivan-Carey', bankName: 'Secret Bank', bsb: '062-000', accountNumber: '12345678',
      },
    }),
  });
});

test.after(() => {
  servers.forEach((s) => s.close());
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function record(res) {
  const text = await res.text();
  seen.push(text, JSON.stringify([...res.headers.entries()]));
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) { /* not JSON */ }
  return { status: res.status, body, text, headers: res.headers };
}
function api(pathname, opts = {}, url = base) {
  let body = opts.body;
  if (body && /^\/api\/estimates(\/[^/]+)?$/.test(pathname)) body = JSON.stringify({ pricingShape: PRICING_SHAPE, ...JSON.parse(body) });
  return fetch(`${url}${pathname}`, { ...opts, body, headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) } })
    .then(record);
}
const pub = (token, url = base) => fetch(`${url}/public/call-sheets/${token}`).then(record);
const sheet = (id) => api(`/api/estimates/${id}/call-sheet`);
const link = (id, on) => api(`/api/estimates/${id}/call-sheet/link`, { method: 'POST', body: JSON.stringify({ on }) });

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const HOME = { address: '1 Home St, Marrickville NSW', lat: -33.91, lng: 151.15, placeId: 'p_home' };
const SPOT = (id, name, lat, lng, extra) => ({ id, role: 'stop', address: name, lat, lng, placeId: `p_${id}`, ...(extra || {}) });

/* A real-looking route line: a few hundred points from Marrickville to Bondi. */
function routeLine(points = 300) {
  const pts = [];
  for (let i = 0; i < points; i += 1) {
    pts.push([-33.91 + (i / points) * 0.02 + Math.sin(i / 7) * 0.0004, 151.15 + (i / points) * 0.12 + Math.cos(i / 5) * 0.0004]);
  }
  return google.encodePolyline(pts);
}

function twoStopTrip(extra) {
  return {
    stops: [
      { id: 's0', role: 'start', ...HOME },
      SPOT('s1', 'Bondi Pavilion, Queen Elizabeth Dr, Bondi Beach NSW', -33.8915, 151.2767, {
        minutesOnSite: 90,
        details: { capture: 'Wide of the pool, then the sunrise', description: 'Car park level 2', access: '' },
      }),
      SPOT('s2', 'Eveleigh Works, 243 Edward St, Eveleigh NSW', -33.8955, 151.1935, { minutesOnSite: 30, details: { access: 'Gate code 4417' } }),
      { id: 's3', role: 'return' },
    ],
    legs: [
      { km: 14.2, minutes: 31, departAt: '07:00', arriveAt: '07:31' },
      { km: 9.8, minutes: 24, departAt: '09:01', arriveAt: '09:25' },
      { km: 6.1, minutes: 17, departAt: '09:55', arriveAt: '10:12' },
    ],
    totals: { km: 30.1, minutes: 72 },
    polyline: routeLine(),
    routedFor: { date: '2026-11-03', startTime: '07:00', traffic: true },
    routedAt: '2026-10-09T01:02:03.000Z',
    ...(extra || {}),
  };
}

const day = (id, date, trip, extra) => ({
  id, date, status: 'pencilled', startTime: date ? '07:00' : null, endTime: date ? '17:00' : null, overrideNote: '',
  ...(trip === undefined ? {} : { trip }), ...(extra || {}),
});

let counter = 0;
async function create(days, extra) {
  counter += 1;
  const res = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: `Harbour shoot ${counter}`,
      upid: `CS-${counter}`,
      client: {
        businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example', phone: '0400 111 222', abn: '51824753556',
      },
      notes: 'INTERNAL-NOTE-MARKER do not share',
      activeRows: {
        prod: days.map((d) => ({ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, dayId: d.id })),
      },
      days,
      ...(extra || {}),
    }),
  });
  assert.equal(res.status, 201, res.text);
  return res.body.estimate;
}
const save = (id, days, extra) => api(`/api/estimates/${id}`, {
  method: 'PUT',
  body: JSON.stringify({
    name: 'Harbour shoot', upid: `CS-S${id.slice(-4)}`, client: { businessName: 'Saltwater Co.' }, activeRows: {}, days, ...(extra || {}),
  }),
});

/* ── google.js ────────────────────────────────────────────────────────────── */

test('polylines round-trip, and a 40,000-character route is cut to fit a Static Maps URL with its ends kept', () => {
  const pts = [[-33.91, 151.15], [-33.8915, 151.2767], [-31.95224, 115.8614], [-37.81362, 144.96305]];
  assert.deepEqual(google.decodePolyline(google.encodePolyline(pts)), pts);

  const long = [];
  for (let i = 0; i < 9000; i += 1) long.push([-33.9 - i * 0.0009 + Math.sin(i / 11) * 0.0008, 151.1 - i * 0.0008 + Math.cos(i / 13) * 0.0008]);
  const encoded = google.encodePolyline(long);
  assert.ok(encoded.length > 30000, `a long fixture (${encoded.length})`);
  const fitted = google.fitPolyline(encoded);
  assert.ok(fitted.length <= google.MAX_PATH_CHARS, `thinned to ${fitted.length}`);
  const out = google.decodePolyline(fitted);
  assert.ok(out.length > 100, 'still a line, not two points');
  const at5 = (p) => p.map((v) => Math.round(v * 1e5) / 1e5);
  assert.deepEqual(out[0], at5(long[0]));
  assert.deepEqual(out[out.length - 1], at5(long[long.length - 1]));

  // A short one is untouched.
  const short = google.encodePolyline(pts);
  assert.equal(google.fitPolyline(short), short);
  assert.equal(google.fitPolyline(''), '');
  assert.equal(google.fitPolyline(undefined), '');
});

test('the Static Maps request: one pin per stop, START last and labelled S, ten onwards run on as letters, inside the URL cap', () => {
  assert.deepEqual([1, 9, 10, 11, 23].map(google.pinLabel), ['1', '9', 'A', 'B', 'N']);
  const stops = [{ id: 's0', role: 'start', ...HOME }];
  for (let i = 1; i <= 23; i += 1) stops.push(SPOT(`s${i}`, `Stop ${i}`, -33.8 - i * 0.01, 151.2 + i * 0.01));
  stops.push({ id: 'sr', role: 'return' });
  stops[stops.length - 1] = { ...stops[stops.length - 1], lat: HOME.lat, lng: HOME.lng };
  const big = [];
  for (let i = 0; i < 12000; i += 1) big.push([-33.9 - i * 0.0005 + Math.sin(i / 3) * 0.0006, 151.1 + i * 0.0004 + Math.cos(i / 4) * 0.0006]);
  const trip = { stops, polyline: google.encodePolyline(big) };
  assert.ok(trip.polyline.length > 40000);
  const url = google.staticMapUrl(trip, SERVER_KEY);
  assert.ok(url.length < 8192, `request is ${url.length} characters`);
  assert.match(url, /^https:\/\/maps\.googleapis\.com\/maps\/api\/staticmap\?/);
  assert.match(url, /[?&]key=AIzaSy-SERVER-KEY/);
  const labels = [...decodeURIComponent(url).matchAll(/label:([A-Z0-9])\|/g)].map((m) => m[1]);
  assert.equal(labels.length, 24, 'the start and 23 destinations; the return shares the start\'s pin');
  assert.equal(labels[labels.length - 1], 'S', 'drawn last, so a return can\'t cover it');
  assert.deepEqual(labels.slice(0, 11), ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B']);
  assert.match(decodeURIComponent(url), /path=color:0xC0603C\|weight:5\|enc:/);
});

test('the picture is keyed on what it shows: the line and the pins, not the words', () => {
  const a = twoStopTrip();
  const same = twoStopTrip({ totals: { km: 99, minutes: 99 }, routedAt: '2027-01-01T00:00:00.000Z' });
  same.stops = same.stops.map((s) => ({ ...s, minutesOnSite: 5, details: { capture: 'changed' }, address: s.address + ' (renamed)' }));
  assert.equal(google.staticMapHash(a), google.staticMapHash(same));
  const moved = twoStopTrip();
  moved.stops[2] = { ...moved.stops[2], lat: -33.7 };
  assert.notEqual(google.staticMapHash(a), google.staticMapHash(moved));
  assert.notEqual(google.staticMapHash(a), google.staticMapHash(twoStopTrip({ polyline: routeLine(120) })));
});

/* ── The sheet itself ─────────────────────────────────────────────────────── */

test('the owner\'s call sheet: days in date order with Date TBC last, a day with no trip left out, stops and legs read as the page needs them', async () => {
  const est = await create([
    day('cs_tbc', null, twoStopTrip({ routedFor: { date: null, startTime: null, traffic: false } })),
    day('cs_late', '2026-11-10', twoStopTrip()),
    day('cs_none', '2026-11-05'),
    day('cs_start', '2026-11-06', { stops: [{ id: 'a', role: 'start', ...HOME }], legs: [], totals: { km: 0, minutes: 0 }, polyline: '' }),
    day('cs_early', '2026-11-03', twoStopTrip()),
  ]);
  const r = await sheet(est.id);
  assert.equal(r.status, 200, r.text);
  const cs = r.body.callSheet;
  assert.equal(r.body.editDay, 'cs_early', 'Edit trips opens the first day with a trip');
  assert.deepEqual(cs.days.map((d) => d.date), ['2026-11-03', '2026-11-10', null]);
  assert.equal(cs.kind, 'call-sheet');
  assert.deepEqual([cs.upid, cs.name, cs.client], [est.upid, est.name, { businessName: 'Saltwater Co.' }]);
  assert.deepEqual(cs.business, { name: 'LSC Creative', email: 'hello@lsc.example', phone: '0412 000 000' });
  assert.deepEqual(cs.summary, { days: 3, km: 90 });

  const d = cs.days[0];
  assert.deepEqual([d.startTime, d.routed, d.totals], ['07:00', true, { km: 30.1, minutes: 72 }]);
  assert.deepEqual(d.legs.map((l) => [l.km, l.minutes, l.departAt, l.arriveAt]),
    [[14.2, 31, '07:00', '07:31'], [9.8, 24, '09:01', '09:25'], [6.1, 17, '09:55', '10:12']]);
  assert.deepEqual(d.stops.map((s) => [s.role, s.n, s.mapLabel, s.arriveAt, s.leaveAt]), [
    ['start', null, 'S', null, '07:00'],
    ['stop', 1, '1', '07:31', '09:01'],
    ['stop', 2, '2', '09:25', '09:55'],
    ['return', null, 'S', '10:12', null],
  ]);
  const bondi = d.stops[1];
  assert.equal(bondi.minutesOnSite, 90);
  assert.deepEqual(bondi.details, { capture: 'Wide of the pool, then the sunrise', description: 'Car park level 2' }, 'a field left blank is not a heading');
  assert.deepEqual(d.stops[2].details, { access: 'Gate code 4417' });
  assert.equal(d.stops[3].address, HOME.address, 'the return is the start\'s place');
  assert.match(bondi.mapsUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Bondi%20Pavilion.*&query_place_id=p_s1$/);
  assert.equal(d.stops[0].minutesOnSite, undefined, 'only destinations carry time on location');
  assert.match(d.map, /^data:image\/png;base64,/);
  assert.match(cs.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('an estimate with no trips has an empty sheet, and a link can\'t be turned on for it', async () => {
  const est = await create([day('cs_n1', '2026-12-01')]);
  const r = await sheet(est.id);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.callSheet.days, r.body.callSheet.summary, r.body.editDay, r.body.link],
    [[], { days: 0, km: 0 }, null, { on: false, token: null, url: null }]);
  const on = await link(est.id, true);
  assert.equal(on.status, 409);
  assert.equal(on.body.error, 'no_trips');
  assert.equal((await link(est.id, false)).status, 200, 'turning off is always allowed');
  assert.equal((await sheet('est_nope')).status, 404);
});

test('stops whose route is out of step are shown without drive times, never with the wrong ones', async () => {
  const stale = twoStopTrip({ legs: [{ km: 5, minutes: 9, departAt: '07:00', arriveAt: '07:09' }] });
  const est = await create([day('cs_stale', '2026-11-20', stale)]);
  const d = (await sheet(est.id)).body.callSheet.days[0];
  assert.equal(d.routed, false);
  assert.deepEqual(d.legs, []);
  assert.deepEqual(d.stops.map((s) => [s.arriveAt, s.leaveAt]), [[null, null], [null, null], [null, null], [null, null]]);
  assert.equal(d.stops.length, 4, 'the stops themselves are all there');
});

/* ── The link ─────────────────────────────────────────────────────────────── */

test('turning the link on makes a 43-character token, off keeps it, on again gives the same link, and none of it touches the estimate\'s save stamp', async () => {
  const est = await create([day('cs_l1', '2026-11-12', twoStopTrip())]);
  const before = (await api(`/api/estimates/${est.id}`)).body.estimate.updatedAt;

  const on = await link(est.id, true);
  assert.equal(on.status, 200, on.text);
  assert.match(on.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(on.body.on, true);
  assert.equal(on.body.url, `${APP_URL}c/#s/${on.body.token}`);
  assert.equal((await sheet(est.id)).body.link.on, true);

  const off = await link(est.id, false);
  assert.deepEqual([off.body.token, off.body.on], [on.body.token, false]);
  assert.deepEqual((await sheet(est.id)).body.link, { on: false, token: on.body.token, url: `${APP_URL}c/#s/${on.body.token}` });

  const again = await link(est.id, true);
  assert.equal(again.body.token, on.body.token);

  // The editor's `baseUpdatedAt` is this stamp: sharing must not read as an edit made elsewhere.
  const after = (await api(`/api/estimates/${est.id}`)).body.estimate.updatedAt;
  assert.equal(after, before);
  const put = await save(est.id, [day('cs_l1', '2026-11-12', twoStopTrip())], { baseUpdatedAt: before });
  assert.equal(put.status, 200, put.text);

  assert.equal((await link(est.id, 'yes')).body.error, 'invalid_on');
  assert.equal((await api(`/api/estimates/${est.id}/call-sheet/link`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await link('est_nope', true)).status, 404);
});

test('the owner\'s routes need the session', async () => {
  const est = await create([day('cs_auth', '2026-11-13', twoStopTrip())]);
  for (const [method, p] of [['GET', `/api/estimates/${est.id}/call-sheet`], ['POST', `/api/estimates/${est.id}/call-sheet/link`]]) {
    const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{"on":true}' : undefined });
    assert.equal(r.status, 401, p);
  }
});

test('the public page: the same content as the owner\'s, with no session, no credentials and no caching', async () => {
  const est = await create([day('cs_p1', '2026-11-14', twoStopTrip()), day('cs_p2', '2026-11-15', twoStopTrip())]);
  const { body: { token } } = await link(est.id, true);
  const owner = (await sheet(est.id)).body.callSheet;
  const r = await pub(token);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.callSheet, owner);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('x-robots-tag'), /noindex/);

  // Crew open it from the Pages origin.
  const cors = await fetch(`${base}/public/call-sheets/${token}`, { headers: { origin: PAGES } });
  assert.equal(cors.headers.get('access-control-allow-origin'), PAGES);
  await cors.arrayBuffer();
});

test('always the latest saved trip (T18): a save shows on the link, and "Updated" moves only when a day did', async () => {
  const est = await create([day('cs_u1', '2026-11-16', twoStopTrip())]);
  const { body: { token } } = await link(est.id, true);
  const first = (await pub(token)).body.callSheet;
  assert.equal(first.days[0].stops.length, 4);
  await new Promise((r) => setTimeout(r, 15));

  // A save that changes only a price leaves every day as it was.
  const same = await save(est.id, [day('cs_u1', '2026-11-16', twoStopTrip())], { notes: 'changed a note' });
  assert.equal(same.status, 200, same.text);
  assert.equal((await pub(token)).body.callSheet.updatedAt, first.updatedAt, 'unchanged days keep their stamp');

  // A new stop is a change to the sheet.
  const trip = twoStopTrip();
  trip.stops.splice(2, 0, SPOT('s9', 'Manly Wharf', -33.8, 151.28));
  trip.legs.splice(1, 0, { km: 8, minutes: 14, departAt: '09:01', arriveAt: '09:15' });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await save(est.id, [day('cs_u1', '2026-11-16', trip)])).status, 200);
  const next = (await pub(token)).body.callSheet;
  assert.equal(next.days[0].stops.length, 5);
  assert.ok(next.updatedAt > first.updatedAt, `${next.updatedAt} after ${first.updatedAt}`);
});

test('off, never made and malformed links are one 404 with nothing to tell them apart', async () => {
  const est = await create([day('cs_off', '2026-11-17', twoStopTrip())]);
  const never = await create([day('cs_never', '2026-11-18', twoStopTrip())]);
  const { body: { token } } = await link(est.id, true);
  assert.equal((await pub(token)).status, 200);
  await link(est.id, false);

  const wrong = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  const tries = [token, wrong, 'x', token.slice(0, 20), `${token}A`, '%27%20OR%201%3D1', never.id, est.id, ' '];
  const answers = await Promise.all(tries.map((t) => fetch(`${base}/public/call-sheets/${t}`)));
  const shape = async (res) => {
    const text = await res.text();
    seen.push(text);
    return [res.status, res.headers.get('content-type'), res.headers.get('content-length'), res.headers.get('cache-control'), text];
  };
  const first = await shape(answers[0]);
  assert.deepEqual([first[0], first[4]], [404, '{"error":"not_found"}'], 'turned off');
  for (const r of answers.slice(1)) assert.deepEqual(await shape(r), first);

  // Back on, the same link works again.
  await link(est.id, true);
  assert.equal((await pub(token)).status, 200);
});

/* ── The route image ──────────────────────────────────────────────────────── */

test('the image is fetched once per trip, kept, and fetched again only when the trip moves', async () => {
  const est = await create([day('cs_m1', '2026-11-19', twoStopTrip()), day('cs_m2', '2026-11-20', twoStopTrip({ polyline: routeLine(150) }))]);
  const { body: { token } } = await link(est.id, true);
  google.forgetFailures();
  maps.calls.length = 0;

  const a = await pub(token);
  assert.equal(maps.calls.length, 2, 'one request per day with a trip');
  assert.ok(a.body.callSheet.days.every((d) => d.map === `data:image/png;base64,${PNG.toString('base64')}`));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM static_maps WHERE day_id IN (?, ?)').get('cs_m1', 'cs_m2').n, 2);

  await pub(token);
  await sheet(est.id);
  assert.equal(maps.calls.length, 2, 'views come from the cache');

  // Words change nothing about the picture…
  const reworded = twoStopTrip();
  reworded.stops[1] = { ...reworded.stops[1], address: 'Bondi Pavilion (north entrance)', minutesOnSite: 45 };
  await save(est.id, [day('cs_m1', '2026-11-19', reworded), day('cs_m2', '2026-11-20', twoStopTrip({ polyline: routeLine(150) }))]);
  await pub(token);
  assert.equal(maps.calls.length, 2);

  // …a moved pin does, for that day only.
  const moved = twoStopTrip();
  moved.stops[2] = { ...moved.stops[2], lat: -33.7, lng: 151.1 };
  await save(est.id, [day('cs_m1', '2026-11-19', moved), day('cs_m2', '2026-11-20', twoStopTrip({ polyline: routeLine(150) }))]);
  await pub(token);
  assert.equal(maps.calls.length, 3);
});

test('the request carries the server key; no reply, header or error ever does', async () => {
  const est = await create([day('cs_k1', '2026-11-21', twoStopTrip({ polyline: routeLine(77) }))]);
  const { body: { token } } = await link(est.id, true);
  google.forgetFailures();
  maps.calls.length = 0;
  await pub(token);
  assert.equal(maps.calls.length, 1);
  assert.ok(maps.calls[0].includes(`key=${SERVER_KEY}`), 'the NAS asks Google with the key');

  // Failures: a thrown network error and a refusal both quote the key in the
  // error they raise. Neither may come out.
  for (const mode of ['down', 'refused', 'html']) {
    maps.mode = mode;
    google.forgetFailures();
    db.prepare('DELETE FROM static_maps WHERE day_id = ?').run('cs_k1');
    const p = await pub(token);
    assert.equal(p.status, 200, mode);
    assert.equal(p.body.callSheet.days[0].map, null, `${mode}: no image, still a page`);
    assert.equal(p.body.callSheet.days[0].stops.length, 4);
    const o = await sheet(est.id);
    assert.equal(o.status, 200);
    assert.equal(o.body.callSheet.days[0].map, null);
  }
  maps.mode = 'ok';

  // A failure is not retried straight away (a crew's links can't hammer Google while it is down)…
  maps.mode = 'down';
  google.forgetFailures();
  maps.calls.length = 0;
  await pub(token);
  await pub(token);
  assert.equal(maps.calls.length, 1);
  // …and the next good fetch fills the gap.
  maps.mode = 'ok';
  google.forgetFailures();
  assert.match((await pub(token)).body.callSheet.days[0].map, /^data:image\/png;base64,/);

  for (const piece of seen) assert.ok(!piece.includes(SERVER_KEY), 'the server key reached a reply');
});

test('with no server key the sheet has no image and Google is never asked', async () => {
  const est = await create([day('cs_nokey', '2026-11-22', twoStopTrip({ polyline: routeLine(66) }))]);
  const { body: { token } } = await link(est.id, true);
  db.prepare('DELETE FROM static_maps WHERE day_id = ?').run('cs_nokey');
  google.forgetFailures();
  maps.calls.length = 0;
  const r = await pub(token, keylessBase);
  assert.equal(r.status, 200);
  assert.equal(r.body.callSheet.days[0].map, null);
  assert.equal(maps.calls.length, 0);
});

test('a picture whose day is gone is swept with the next write', async () => {
  const est = await create([day('cs_sw1', '2026-11-23', twoStopTrip({ polyline: routeLine(55) }))]);
  const { body: { token } } = await link(est.id, true);
  google.forgetFailures();
  await pub(token);
  db.prepare("INSERT INTO static_maps (day_id, hash, png, fetched_at) VALUES ('cs_orphan', 'h', x'89504e47', 'x')").run();
  const other = await create([day('cs_sw2', '2026-11-24', twoStopTrip({ polyline: routeLine(44) }))]);
  const { body: { token: t2 } } = await link(other.id, true);
  google.forgetFailures();
  await pub(t2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM static_maps WHERE day_id = 'cs_orphan'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM static_maps WHERE day_id = 'cs_sw1'").get().n, 1);
});

/* ── The leak test ────────────────────────────────────────────────────────── */

const FORBIDDEN = /surcharge|floor|taxSetAside|overheadShare|estTakeHome|costBreakdown|clientPrice|totalIncGst|\bgst\b|\bprice\b|\brate\b|\bmu\b|margin|hourlyRate|dayUnit|markup/i;
function keysOf(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.push(k); keysOf(x, out); });
  return out;
}
const sorted = (o) => Object.keys(o).sort();

test('the leak test: the public call sheet is exactly its allow-list, and nothing priced, private or internal is in it', async () => {
  const days = [day('cs_lk1', '2026-11-25', twoStopTrip()), day('cs_lk2', null, twoStopTrip())];
  const est = await create(days, {
    shortNotice: true,
    activeRows: {
      prod: days.map((d) => ({ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, dayId: d.id })),
      travel: [{ name: 'Vehicle — per km', rowId: 'car', mu: 0.9, perKm: true, qty: 30, dayId: 'cs_lk1', fromTrip: 'km' }],
      equip: [{ vendor: 'SECRET-HIRE-VENDOR', item: 'Drone package', days: 1, cost: 300 }],
    },
  });
  assert.ok(est.totals.clientPriceExGst > 0 || est.totals.totalIncGst > 0, 'the estimate is priced');
  const { body: { token } } = await link(est.id, true);
  google.forgetFailures();

  const replies = [await pub(token), await pub('nope'), await fetch(`${base}/public/call-sheets/`).then(record)];
  for (const r of replies) {
    assert.doesNotMatch(r.text, FORBIDDEN, `${r.status} ${r.text.slice(0, 80)}`);
    if (r.body) keysOf(r.body).forEach((k) => assert.doesNotMatch(k, FORBIDDEN, k));
    assert.equal(r.headers.get('set-cookie'), null);
  }
  const text = replies[0].text;
  for (const secret of [
    'Priya', 'priya@salt.example', '0400 111 222', '51824753556', 'INTERNAL-NOTE-MARKER', 'SECRET-HIRE-VENDOR', 'Video Capture',
    'Vehicle', '12345678901', 'Lachlan Sullivan-Carey', 'Secret Bank', '062-000', '12345678',
    est.id, est.projectId, 'cs_lk1', 'cs_lk2', '"s0"', '"s1"', '"s2"', '"s3"', SERVER_KEY,
  ]) {
    assert.ok(!text.includes(secret), `"${secret}" is in the public reply`);
  }

  // Exactly the allow-list, level by level: a new field has to be added here on purpose.
  const cs = replies[0].body.callSheet;
  assert.deepEqual(sorted(replies[0].body), ['callSheet']);
  assert.deepEqual(sorted(cs), ['business', 'client', 'days', 'kind', 'name', 'summary', 'updatedAt', 'upid']);
  assert.deepEqual(sorted(cs.client), ['businessName']);
  assert.deepEqual(sorted(cs.business), ['email', 'name', 'phone']);
  assert.deepEqual(sorted(cs.summary), ['days', 'km']);
  assert.equal(cs.days.length, 2);
  for (const d of cs.days) {
    assert.deepEqual(sorted(d), ['date', 'legs', 'map', 'routed', 'startTime', 'stops', 'totals']);
    assert.deepEqual(sorted(d.totals), ['km', 'minutes']);
    d.legs.forEach((l) => assert.deepEqual(sorted(l), ['arriveAt', 'departAt', 'km', 'minutes']));
    d.stops.forEach((s) => {
      const base = ['address', 'arriveAt', 'lat', 'leaveAt', 'lng', 'mapLabel', 'mapsUrl', 'n', 'role'];
      assert.deepEqual(sorted(s), s.role === 'stop' ? [...base, 'details', 'minutesOnSite'].sort() : base, s.role);
      if (s.details) Object.keys(s.details).forEach((k) => assert.ok(['capture', 'description', 'access'].includes(k), k));
    });
  }
});

test('the stored allow-list has no second copy to leak later: the estimate\'s own JSON never carries the link or an image', async () => {
  const est = await create([day('cs_st1', '2026-11-26', twoStopTrip({ polyline: routeLine(33) }))]);
  await link(est.id, true);
  google.forgetFailures();
  await sheet(est.id);
  const e = (await api(`/api/estimates/${est.id}`)).body.estimate;
  assert.ok(!JSON.stringify(e).includes('data:image'), 'no image on the estimate');
  assert.ok(!('call_sheet_token' in e) && !('callSheetToken' in e));
  const list = await api('/api/estimates');
  assert.ok(!list.text.includes('data:image'));
});

/* ── The PDF (task 10) ────────────────────────────────────────────────────── */

/* A renderer that keeps what it was asked to print: the PDF is the markup, so
   the markup is what's checked. Chromium is never started. */
const PDF_BYTES = Buffer.from('%PDF-1.4 call sheet');
const printed = [];
let renderDown = false;
async function fakeRender(html) {
  printed.push(html);
  if (renderDown) throw Object.assign(new Error('no chromium'), { code: 'pdf_unavailable' });
  return PDF_BYTES;
}
let pdfBase;
const pdfServer = async () => {
  if (!pdfBase) {
    pdfBase = await start({
      mapsKey: SERVER_KEY, mapsFetch, renderPdf: fakeRender,
      publicLimits: { all: { max: 10000, windowMs: 60000 }, pdf: { max: 4, windowMs: 60000 } },
    });
  }
  return pdfBase;
};

test('the owner\'s PDF is the page\'s own content, named for the project, and needs the session', async () => {
  const url = await pdfServer();
  const est = await create([day('cs_pd1', '2026-11-03', twoStopTrip()), day('cs_pd2', '2026-11-04', twoStopTrip())], {
    shortNotice: true,
  });
  const res = await fetch(`${url}/api/estimates/${est.id}/call-sheet/pdf`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type').split(';')[0], 'application/pdf');
  assert.match(decodeURIComponent(res.headers.get('content-disposition')), new RegExp(`filename.*Call sheet - ${est.upid} - ${est.name}\\.pdf`));
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(PDF_BYTES));

  const html = printed[printed.length - 1];
  assert.match(html, /<title>Call sheet · CS-\d+ · Harbour shoot \d+<\/title>/);
  assert.match(html, /Tuesday 3 November 2026/);
  assert.match(html, /Wednesday 4 November 2026/);
  assert.ok(html.includes('Bondi Pavilion, Queen Elizabeth Dr, Bondi Beach NSW'));
  assert.ok(html.includes('Gate code 4417'), 'the details in full');
  assert.ok(html.includes('data:image/png;base64,'), 'the route image is in the print');
  assert.equal((html.match(/class="cs-day"/g) || []).length, 2, 'a section per day');
  for (const secret of ['Priya', 'priya@salt.example', '0400 111 222', '51824753556', 'INTERNAL-NOTE-MARKER',
    'Video Capture', '1120', 'Secret Bank', '062-000', SERVER_KEY, 'cs_pd1', est.id]) {
    assert.ok(!html.includes(secret), `"${secret}" is in the PDF`);
  }
  assert.ok(html.includes('hello@lsc.example') && html.includes('0412 000 000'), 'the business\'s contact is the footer');

  const noSession = await fetch(`${url}/api/estimates/${est.id}/call-sheet/pdf`);
  assert.equal(noSession.status, 401);
  assert.equal((await fetch(`${url}/api/estimates/est_nope/call-sheet/pdf`, { headers: { cookie } })).status, 404);
});

test('the public PDF prints exactly what the owner\'s does, only while the link is on, and is rate-limited', async () => {
  const url = await pdfServer();
  const est = await create([day('cs_pd3', '2026-11-05', twoStopTrip())]);
  const owner = await fetch(`${url}/api/estimates/${est.id}/call-sheet/pdf`, { headers: { cookie } });
  await owner.arrayBuffer();
  const ownerHtml = printed[printed.length - 1];

  // Never made, then off, are the same 404, and the renderer isn't started.
  const before = printed.length;
  assert.equal((await fetch(`${url}/public/call-sheets/nope/pdf`)).status, 404);
  const { body: { token } } = await link(est.id, true);
  await link(est.id, false);
  const off = await fetch(`${url}/public/call-sheets/${token}/pdf`);
  assert.equal(off.status, 404);
  assert.deepEqual(await off.json(), { error: 'not_found' });
  assert.equal(printed.length, before, 'nothing was rendered for a dead link');

  await link(est.id, true);
  const on = await fetch(`${url}/public/call-sheets/${token}/pdf`, { headers: { origin: PAGES } });
  assert.equal(on.status, 200);
  assert.equal(on.headers.get('content-type').split(';')[0], 'application/pdf');
  assert.equal(on.headers.get('cache-control'), 'no-store');
  assert.equal(on.headers.get('set-cookie'), null);
  assert.equal(on.headers.get('access-control-allow-origin'), PAGES);
  assert.match(on.headers.get('access-control-expose-headers'), /Content-Disposition/);
  assert.ok(Buffer.from(await on.arrayBuffer()).equals(PDF_BYTES));
  assert.equal(printed[printed.length - 1], ownerHtml, 'one document for both');

  // The renderer being missing is "not ready", not a crash and not a 404.
  renderDown = true;
  const down = await fetch(`${url}/public/call-sheets/${token}/pdf`);
  renderDown = false;
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { error: 'pdf_unavailable' });

  // The pdf limit is 4 per window per address, and every request counts, a
  // dead link's too: the unknown, the off, the on and the down one above use
  // it up, so the next is refused.
  let limited = null;
  for (let i = 0; i < 4 && !limited; i += 1) {
    const r = await fetch(`${url}/public/call-sheets/${token}/pdf`);
    await r.arrayBuffer();
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, 'a runaway client is stopped');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
