'use strict';

/**
 * Trips on production days and the travel lines they set
 * (Project build archive/tracks/trip-planner/ task 1; decisions T2–T4, T7). A day carries its trip
 * (days.js parseTrip), and a travel line marked `fromTrip` takes its quantity
 * from it on every estimate write (days.js applyTripLines), whatever was sent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-trips-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE } = require('../src/calc');
const { parseTrip } = require('../src/days');

const PASSWORD = 'correct-horse-battery-staple';

let server;
let baseUrl;
let db;
let cookie;

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`
    INSERT INTO account (id, username, password_hash, created_at, updated_at)
    VALUES (1, 'lachlan', ?, ?, ?)
  `).run(await hashPassword(PASSWORD), nowIso(), nowIso());
  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];

  const card = await api('/api/pricing', {
    method: 'PUT',
    body: {
      serviceDay: { fullHours: 8, halfHours: 4 },
      labourSections: [],
      travelRows: [
        { id: 'meals', name: 'Crew Meals', rate: 30, mu: 30 },
        { id: 'car', name: 'Vehicle — per km', rate: 0, mu: null, perKm: true, unit: 'km' },
        { id: 'tl', name: 'Transport & Logistics Hrs', rate: 25, mu: 120, ownTime: true },
      ],
      taxSetAsideRate: 0.35,
    },
  });
  assert.equal(card.status, 200, 'the test card saves');
});

test.after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function api(pathname, opts = {}) {
  const body = opts.body === undefined ? undefined : JSON.stringify(
    /^\/api\/(estimates(\/[^/]+)?|pricing)$/.test(pathname) ? { pricingShape: PRICING_SHAPE, ...opts.body } : opts.body
  );
  return fetch(`${baseUrl}${pathname}`, {
    method: opts.method || 'GET',
    body,
    headers: { 'content-type': 'application/json', cookie },
  });
}

/* The two lines a trip writes, as the editor adds them: each with the snapshot
   lineSnapshot takes from its row, and a quantity the server must replace. */
const kmLine = (dayId, qty, extra) => Object.assign(
  { name: 'Vehicle — per km', rowId: 'car', mu: 0.9, perKm: true, qty, dayId, fromTrip: 'km' }, extra);
const hoursLine = (dayId, qty, extra) => Object.assign(
  { name: 'Transport & Logistics Hrs', rowId: 'tl', mu: 120, ownTime: true, qty, dayId, fromTrip: 'hours' }, extra);
const mealsLine = (dayId, extra) => Object.assign(
  { name: 'Crew Meals', rowId: 'meals', mu: 30, rate: 30, qty: 2, dayId }, extra);

const HOME = { address: '1 Home St, Marrickville NSW', lat: -33.91, lng: 151.15, placeId: 'p_home' };
function tripOf(km, minutes, extra) {
  return Object.assign({
    stops: [
      Object.assign({ id: 's0', role: 'start' }, HOME),
      { id: 's1', role: 'stop', address: 'Bondi Pavilion', lat: -33.89, lng: 151.27, placeId: 'p_bondi', minutesOnSite: 90 },
      { id: 's2', role: 'return' },
    ],
    legs: [{ km: km / 2, minutes: minutes / 2 }, { km: km / 2, minutes: minutes / 2 }],
    totals: { km, minutes },
    polyline: 'abc~def',
    routedFor: { date: '2026-11-03', startTime: '07:00', traffic: true },
    routedAt: '2026-10-09T01:02:03.000Z',
  }, extra);
}
const day = (id, trip, extra) => Object.assign(
  { id, date: '2026-11-03', status: 'pencilled', startTime: '07:00', endTime: '17:00', overrideNote: '' },
  trip === undefined ? {} : { trip }, extra);

let counter = 0;
async function create(days, travel) {
  counter += 1;
  const res = await api('/api/estimates', {
    method: 'POST',
    body: { name: `Trip job ${counter}`, client: { businessName: 'Acme' }, days, activeRows: { travel } },
  });
  return { status: res.status, body: await res.json() };
}
async function put(id, days, travel) {
  const res = await api(`/api/estimates/${id}`, {
    method: 'PUT',
    body: Object.assign(
      { name: 'Trip job', client: { businessName: 'Acme' }, activeRows: { travel } },
      days === undefined ? {} : { days }
    ),
  });
  return { status: res.status, body: await res.json() };
}
const travelOf = (est) => est.activeRows.travel;

test('a trip round-trips on its day, and its two lines bill the rounded-up totals', async () => {
  // 185.2 km and 2 h 26 min: 186 km and 2.5 h.
  const { status, body } = await create([day('dA', tripOf(185.2, 146))], [kmLine('dA', 1), hoursLine('dA', 1)]);
  assert.equal(status, 201);
  const est = body.estimate;
  assert.equal(est.days[0].trip.totals.km, 185.2);
  assert.equal(est.days[0].trip.stops.length, 3);
  assert.equal(est.days[0].trip.polyline, 'abc~def');
  assert.deepEqual(est.days[0].trip.routedFor, { date: '2026-11-03', startTime: '07:00', traffic: true });
  const [km, hours] = travelOf(est);
  assert.equal(km.qty, 186);
  assert.equal(km.fromTrip, 'km');
  assert.equal(hours.qty, 2.5);
  assert.equal(hours.fromTrip, 'hours');
  // Rate Card price × the rounded quantities: 186 × 0.90 + 2.5 × 120.
  assert.equal(est.totals.expenseTotal, 467.4);
  assert.equal(est.totals.totalHours, 2.5);

  const again = await api(`/api/estimates/${est.id}`).then((r) => r.json());
  assert.deepEqual(again.estimate.days[0].trip, est.days[0].trip);
});

test('the billed totals are the legs’ sum: tampered totals bill nothing extra, and the list carries no trips', async () => {
  // Legs of 21 + 21 km and 24 + 24 min, sent with totals claiming 9 km and 5 min.
  const { body } = await create([day('dT', tripOf(42, 48, { totals: { km: 9, minutes: 5 } }))], [kmLine('dT', 1), hoursLine('dT', 1)]);
  assert.deepEqual(body.estimate.days[0].trip.totals, { km: 42, minutes: 48 });
  assert.deepEqual(travelOf(body.estimate).map((l) => l.qty), [42, 1]);
  // A total past the cap, summed from legs each inside it, is refused.
  const huge = tripOf(42, 48);
  huge.legs = [{ km: 60000, minutes: 1 }, { km: 60000, minutes: 1 }];
  assert.equal((await create([day('dT2', huge)], [])).body.error, 'trip_invalid');

  const list = await api('/api/estimates').then((r) => r.json());
  const mine = list.estimates.find((e) => e.id === body.estimate.id);
  assert.equal(mine.days[0].trip, undefined, 'one estimate’s read has the trip; the list doesn’t');
  assert.equal(mine.days[0].id, 'dT');
});

test('the derived quantity overrides a tampered one, on create and on every save', async () => {
  const { body } = await create([day('dB', tripOf(42, 48))], [kmLine('dB', 9999), hoursLine('dB', 0.01)]);
  assert.deepEqual(travelOf(body.estimate).map((l) => l.qty), [42, 1]);
  assert.equal(body.estimate.totals.expenseTotal, round2(42 * 0.9 + 120));

  const saved = await put(body.estimate.id, [day('dB', tripOf(42, 48))], [kmLine('dB', 5), hoursLine('dB', 50)]);
  assert.equal(saved.status, 200);
  assert.deepEqual(travelOf(saved.body.estimate).map((l) => l.qty), [42, 1]);

  // A new route moves both lines on the next save.
  const rerouted = await put(body.estimate.id, [day('dB', tripOf(60.4, 61))], travelOf(saved.body.estimate));
  assert.deepEqual(travelOf(rerouted.body.estimate).map((l) => l.qty), [61, 1.25]);
});

test('rounding edges reach the stored line: 0 km, 0.1 km, 14, 15 and 16 minutes', async () => {
  const cases = [[0, 0, 0, 0], [0.1, 14, 1, 0.25], [1, 15, 1, 0.25], [1.01, 16, 2, 0.5]];
  for (const [km, minutes, wantKm, wantHours] of cases) {
    const id = `dR${String(km).replace('.', '_')}`;
    const { body } = await create([day(id, tripOf(km, minutes))], [kmLine(id, 7), hoursLine(id, 7)]);
    assert.deepEqual(travelOf(body.estimate).map((l) => l.qty), [wantKm, wantHours], `${km} km, ${minutes} min`);
  }
});

test('fromTrip comes off a line whose day has no trip, or that sits on no day', async () => {
  const { body } = await create(
    [day('dC', null), day('dC2', tripOf(10, 10))],
    [kmLine('dC', 33), hoursLine(undefined, 4, { dayId: undefined })]
  );
  const [km, hours] = travelOf(body.estimate);
  assert.equal(km.fromTrip, undefined);
  assert.equal(km.qty, 33, 'an ordinary line bills as typed');
  assert.equal(hours.fromTrip, undefined);
  assert.equal(hours.qty, 4);
});

test('fromTrip comes off a line that is the wrong kind, the wrong section, or a second of its kind', async () => {
  const { body } = await create(
    [day('dD', tripOf(100, 100))],
    [
      kmLine('dD', 3, { fromTrip: 'hours' }),      // a km line asking for hours
      hoursLine('dD', 3, { fromTrip: 'km' }),      // an hours line asking for km
      mealsLine('dD', { fromTrip: 'hours' }),      // a resold row, never set by a trip
      kmLine('dD', 3, { fromTrip: 'fuel' }),       // no such kind
      kmLine('dD', 1),                             // the real one
      kmLine('dD', 2),                             // a second km line on the same day
    ]
  );
  const lines = travelOf(body.estimate);
  assert.deepEqual(lines.map((l) => l.fromTrip), [undefined, undefined, undefined, undefined, 'km', undefined]);
  assert.deepEqual(lines.map((l) => l.qty), [3, 3, 2, 3, 100, 2]);

  // Outside Travel the mark means nothing and is dropped.
  const res = await api('/api/estimates', {
    method: 'POST',
    body: {
      name: 'Crew trip', client: { businessName: 'Acme' }, days: [day('dD2', tripOf(5, 5))],
      activeRows: { crew: [{ name: 'Gaffer', days: 1, cost: 500, dayId: 'dD2', fromTrip: 'km' }] },
    },
  }).then((r) => r.json());
  assert.equal(res.estimate.activeRows.crew[0].fromTrip, undefined);
  assert.equal(res.estimate.activeRows.crew[0].days, 1);
});

test('an unpriced row: a linked km line with no per-km figure bills nothing, and says it is linked', async () => {
  // The car's line snapshotted at $0 (the browser shows it unpriced and adds no
  // line; if one arrives, its quantity is still the trip's, and it bills $0).
  const { body } = await create([day('dE', tripOf(50, 30))], [kmLine('dE', 1, { mu: 0 })]);
  const [km] = travelOf(body.estimate);
  assert.equal(km.qty, 50);
  assert.equal(km.fromTrip, 'km');
  assert.equal(body.estimate.totals.expenseTotal, 0);

  // A line with no snapshot is judged by its card row: the typed own-time row
  // is hours, so it links; the resold row is nothing, so it doesn't.
  const bare = await create([day('dE2', tripOf(50, 30))], [
    { name: 'Transport & Logistics Hrs', rowId: 'tl', qty: 9, dayId: 'dE2', fromTrip: 'hours' },
    { name: 'Crew Meals', rowId: 'meals', qty: 9, dayId: 'dE2', fromTrip: 'hours' },
  ]);
  assert.deepEqual(travelOf(bare.body.estimate).map((l) => [l.qty, l.fromTrip]), [[0.5, 'hours'], [9, undefined]]);
});

test('a day sent without `trip` keeps its stored trip; `trip: null` removes it', async () => {
  const { body } = await create([day('dF', tripOf(80, 70))], [kmLine('dF', 1), hoursLine('dF', 1)]);
  const id = body.estimate.id;

  // An old build: the day without its trip, the lines without fromTrip.
  const stale = await put(id, [day('dF')], [
    { name: 'Vehicle — per km', rowId: 'car', mu: 0.9, perKm: true, qty: 80, dayId: 'dF' },
  ]);
  assert.equal(stale.status, 200);
  assert.equal(stale.body.estimate.days[0].trip.totals.km, 80, 'the trip survives');
  assert.equal(travelOf(stale.body.estimate)[0].fromTrip, undefined, 'the line is ordinary now');

  // A PUT without days keeps the days, trips and all.
  const noDays = await put(id, undefined, [kmLine('dF', 1)]);
  assert.equal(noDays.body.estimate.days[0].trip.totals.km, 80);
  assert.equal(travelOf(noDays.body.estimate)[0].qty, 80);

  // Clear trip.
  const cleared = await put(id, [day('dF', null)], [kmLine('dF', 80)]);
  assert.equal(cleared.body.estimate.days[0].trip, null);
  assert.equal(travelOf(cleared.body.estimate)[0].fromTrip, undefined);
  assert.equal(travelOf(cleared.body.estimate)[0].qty, 80, 'kept as an ordinary line at the quantity sent (T7)');
  assert.equal(db.prepare('SELECT trip_json FROM production_days WHERE id = ?').get('dF').trip_json, null);

  // A new day id gets no trip from anywhere.
  const moved = await put(id, [day('dF_new')], []);
  assert.equal(moved.body.estimate.days[0].trip, null);
});

test('removing a day removes its trip, and its lines stop being linked', async () => {
  const { body } = await create([day('dG', tripOf(20, 20)), day('dG2', tripOf(30, 30))], [kmLine('dG2', 1)]);
  const saved = await put(body.estimate.id, [day('dG')], []);
  assert.equal(saved.body.estimate.days.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM production_days WHERE id = ?').get('dG2').n, 0);
});

test('RETURN always mirrors START, whatever it was sent with', async () => {
  const trip = tripOf(10, 10);
  trip.stops[2] = { id: 's2', role: 'return', address: 'Somewhere else', lat: 10, lng: 10, placeId: 'p_x', minutesOnSite: 30, details: { access: 'x' } };
  const { body } = await create([day('dH', trip)], []);
  const ret = body.estimate.days[0].trip.stops[2];
  assert.deepEqual(ret, Object.assign({ id: 's2', role: 'return' }, HOME));
});

test('duplicating an estimate takes its trip lines off their days as ordinary lines', async () => {
  const { body } = await create([day('dI', tripOf(90, 45))], [kmLine('dI', 1), hoursLine('dI', 1)]);
  const dup = await api(`/api/estimates/${body.estimate.id}/duplicate`, { method: 'POST' }).then((r) => r.json());
  assert.deepEqual(dup.estimate.days, []);
  const lines = travelOf(dup.estimate);
  assert.ok(lines.every((l) => l.fromTrip === undefined && l.dayId === undefined));
  assert.deepEqual(lines.map((l) => l.qty), [90, 0.75]);
  assert.equal(dup.unbooked, 2);
  assert.equal(dup.estimate.totals.expenseTotal, round2(90 * 0.9 + 0.75 * 120));
});

test('an unlinked kind is stored with the trip; its line bills as typed, the other stays derived', async () => {
  // 185.2 km and 2 h 26 min; the km line unlinked at 200 km, the hours line still linked.
  const { status, body } = await create([day('dU', tripOf(185.2, 146, { unlinked: ['km'] }))],
    [kmLine('dU', 200, { fromTrip: undefined }), hoursLine('dU', 1)]); // undefined: not sent
  assert.equal(status, 201);
  const est = body.estimate;
  assert.deepEqual(est.days[0].trip.unlinked, ['km']);
  const [km, hours] = travelOf(est);
  assert.equal(km.qty, 200);
  assert.equal(km.fromTrip, undefined);
  assert.equal(hours.qty, 2.5);
  assert.equal(hours.fromTrip, 'hours');
  // Relinked: fromTrip back on the line, the kind off the list, the trip's figure billed.
  const again = await put(est.id, [day('dU', tripOf(185.2, 146))], [kmLine('dU', 200), hoursLine('dU', 1)]);
  assert.equal(again.status, 200);
  assert.equal(again.body.estimate.days[0].trip.unlinked, undefined);
  assert.equal(travelOf(again.body.estimate)[0].qty, 186);
});

test('a bad trip is refused with its code, and nothing is saved', async () => {
  const refused = async (trip, code) => {
    const res = await create([day(`dJ${counter}`, trip)], []);
    assert.equal(res.status, 400, code);
    assert.equal(res.body.error, code);
  };
  const t = () => tripOf(10, 10);

  await refused('not a trip', 'trip_invalid');
  await refused({ stops: 'nope' }, 'trip_invalid');
  await refused(Object.assign(t(), { stops: [{ id: 's1', role: 'stop', ...HOME }] }), 'trip_invalid'); // no START
  await refused(Object.assign(t(), { stops: [{ id: 's0', role: 'start', ...HOME }, { id: 's2', role: 'return' }] }), 'trip_invalid'); // RETURN with no destination
  const midReturn = t();
  midReturn.stops.splice(1, 0, { id: 'sR', role: 'return' });
  await refused(midReturn, 'trip_invalid');
  const dupIds = t();
  dupIds.stops[1].id = 's0';
  await refused(dupIds, 'trip_invalid');
  const badLat = t();
  badLat.stops[1].lat = 123;
  await refused(badLat, 'trip_invalid');
  const strLng = t();
  strLng.stops[1].lng = '151.2';
  await refused(strLng, 'trip_invalid');
  await refused(Object.assign(t(), { totals: { km: -1, minutes: 0 } }), 'trip_invalid');
  await refused(Object.assign(t(), { totals: { km: 'far', minutes: 0 } }), 'trip_invalid');
  await refused(Object.assign(t(), { legs: [{ km: 1 }] }), 'trip_invalid');
  await refused(Object.assign(t(), { routedFor: { date: '2026-02-30', startTime: null, traffic: false } }), 'trip_invalid');
  await refused(Object.assign(t(), { routedAt: 'yesterday' }), 'trip_invalid');
  await refused(Object.assign(t(), { routedFor: { date: null, startTime: null, traffic: false, stops: 'has spaces' } }), 'trip_invalid');
  await refused(Object.assign(t(), { routedFor: { date: null, startTime: null, traffic: false, stops: 'x'.repeat(65) } }), 'trip_invalid');
  await refused(Object.assign(t(), { routedFor: { date: null, startTime: null, traffic: false, stops: 42 } }), 'trip_invalid');
  await refused(Object.assign(t(), { polyline: 'x'.repeat(50001) }), 'trip_invalid');
  const fraction = t();
  fraction.stops[1].minutesOnSite = 1.5;
  await refused(fraction, 'trip_invalid');

  const long = t();
  long.stops[1].details = { access: 'x'.repeat(2001) };
  await refused(long, 'trip_text_too_long');
  const longAddress = t();
  longAddress.stops[1].address = 'x'.repeat(301);
  await refused(longAddress, 'trip_text_too_long');

  const many = t();
  many.stops = [many.stops[0]]
    .concat(Array.from({ length: 24 }, (_, i) => ({ id: `m${i}`, role: 'stop', address: `Stop ${i}`, lat: -33, lng: 151 })));
  await refused(many, 'trip_too_many_stops');

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM production_days WHERE id LIKE 'dJ%'").get().n, 0);
});

test('parseTrip keeps only the fields it names, and 23 destinations is allowed', () => {
  const raw = tripOf(10, 10, { secret: 'x', totals: { km: 10, minutes: 10, price: 99 } });
  raw.stops[0].extra = 'x';
  raw.stops[0].minutesOnSite = 30; // START carries no time on location
  raw.stops[1].details = { capture: 'Wide', access: '', price: 5 };
  raw.legs[0].departAt = '07:00';
  const { trip } = parseTrip(raw);
  assert.deepEqual(Object.keys(trip).sort(), ['legs', 'polyline', 'routedAt', 'routedFor', 'stops', 'totals']);
  assert.deepEqual(trip.totals, { km: 10, minutes: 10 });
  assert.deepEqual(trip.stops[0], Object.assign({ id: 's0', role: 'start' }, HOME));
  assert.deepEqual(trip.stops[1].details, { capture: 'Wide', access: '' }, 'a present key is kept, even blank');
  assert.equal(trip.legs[0].departAt, '07:00');
  assert.deepEqual(trip.routedFor, { date: '2026-11-03', startTime: '07:00', traffic: true }, 'no stop signature, no key');

  assert.equal(trip.unlinked, undefined, 'nothing unlinked, no key');
  assert.deepEqual(parseTrip(tripOf(10, 10, { unlinked: ['hours', 'km', 'hours'] })).trip.unlinked, ['km', 'hours']);
  assert.equal(parseTrip(tripOf(10, 10, { unlinked: [] })).trip.unlinked, undefined);
  assert.deepEqual(parseTrip(tripOf(10, 10, { unlinked: ['fuel'] })), { error: 'trip_invalid' });
  assert.deepEqual(parseTrip(tripOf(10, 10, { unlinked: 'km' })), { error: 'trip_invalid' });

  const signed = tripOf(10, 10, { routedFor: { date: null, startTime: null, traffic: false, stops: 'r1a2b3c4d', extra: 'x' } });
  assert.deepEqual(parseTrip(signed).trip.routedFor, { date: null, startTime: null, traffic: false, stops: 'r1a2b3c4d' });

  assert.deepEqual(parseTrip(null), { trip: null });
  assert.deepEqual(parseTrip({ stops: [] }), { trip: null }, 'no stops is no trip');
  const unrouted = parseTrip({ stops: [Object.assign({ id: 's0', role: 'start' }, HOME)] }).trip;
  assert.deepEqual(unrouted.totals, { km: 0, minutes: 0 });
  assert.deepEqual(unrouted.legs, []);

  const full = tripOf(10, 10);
  full.stops = [full.stops[0]]
    .concat(Array.from({ length: 23 }, (_, i) => ({ id: `m${i}`, role: 'stop', address: `Stop ${i}`, lat: -33, lng: 151 })))
    .concat([{ id: 'ret', role: 'return' }]);
  assert.equal(parseTrip(full).trip.stops.length, 25);
});

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
