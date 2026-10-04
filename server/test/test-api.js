'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-api-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { currentFinancialYear, PRICING_SHAPE } = require('../src/calc');

const PASSWORD = 'correct-horse-battery-staple';
const USERNAME = 'lachlan';

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

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
});

test.after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

/* Every estimate write and rate-card save here comes from a current client,
   as the web build's all do, so it carries calc.js's PRICING_SHAPE (a card
   carries it since task 6a). `bare: true` sends the body as given, for the
   tests of what the route does with a write that doesn't. */
const SHAPED_WRITE = /^\/api\/(estimates(\/[^/]+)?|pricing)$/;
function api(pathname, { bare, ...opts } = {}) {
  let body = opts.body;
  if (!bare && body && SHAPED_WRITE.test(pathname) && (opts.method === 'POST' || opts.method === 'PUT')) {
    body = JSON.stringify({ pricingShape: PRICING_SHAPE, ...JSON.parse(body) });
  }
  return fetch(`${baseUrl}${pathname}`, {
    ...opts,
    body,
    headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) },
  });
}

test('clients: create, search, get, update, upsert, delete', async () => {
  const created = await api('/api/clients', {
    method: 'POST',
    body: JSON.stringify({ businessName: 'Acme Pty Ltd', contactName: 'Jo', email: 'jo@acme.example' }),
  }).then((r) => r.json());
  assert.equal(created.client.businessName, 'Acme Pty Ltd');

  const search = await api('/api/clients?q=acme').then((r) => r.json());
  assert.equal(search.clients.length, 1);

  const got = await api(`/api/clients/${created.client.id}`).then((r) => r.json());
  assert.equal(got.client.email, 'jo@acme.example');

  const updated = await api(`/api/clients/${created.client.id}`, {
    method: 'PUT',
    body: JSON.stringify({ businessName: 'Acme Pty Ltd', contactName: 'Jo', email: 'jo2@acme.example' }),
  }).then((r) => r.json());
  assert.equal(updated.client.email, 'jo2@acme.example');

  // upsert on the same business name must not create a duplicate row.
  const upserted = await api('/api/clients/upsert', {
    method: 'POST',
    body: JSON.stringify({ businessName: 'Acme Pty Ltd', phone: '0400000000' }),
  }).then((r) => r.json());
  assert.equal(upserted.created, false);
  assert.equal(upserted.client.id, created.client.id);
  const list = await api('/api/clients').then((r) => r.json());
  assert.equal(list.clients.filter((c) => c.businessName === 'Acme Pty Ltd').length, 1);

  const del = await api(`/api/clients/${created.client.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const missing = await api(`/api/clients/${created.client.id}`);
  assert.equal(missing.status, 404);
});

test('pricing: save actually persists (the fake "Save Rates" bug)', async () => {
  const put = await api('/api/pricing', {
    method: 'PUT',
    body: JSON.stringify({ serviceDay: { fullHours: 8, halfHours: 4 }, labourSections: [], travelRows: [], taxSetAsideRate: 0.4 }),
  }).then((r) => r.json());
  assert.equal(put.pricing.taxSetAsideRate, 0.4);

  const get = await api('/api/pricing').then((r) => r.json());
  assert.equal(get.pricing.taxSetAsideRate, 0.4);
});

test('settings: round-trips', async () => {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ business: { name: 'LSC Creative' }, gst: { registered: true, rate: 0.1 } }),
  });
  const get = await api('/api/settings').then((r) => r.json());
  assert.equal(get.settings.business.name, 'LSC Creative');
  assert.equal(get.settings.gst.registered, true);
});

test('overhead items: create, list, update, delete — each write appends a snapshot', async () => {
  const before = await api('/api/overhead-snapshots').then((r) => r.json());
  const snapshotsBefore = before.snapshots.length;

  const created = await api('/api/overhead-items', {
    method: 'POST',
    body: JSON.stringify({ name: 'Adobe CC', category: 'software', cost: 100, frequency: 'monthly' }),
  }).then((r) => r.json());
  assert.equal(created.item.name, 'Adobe CC');
  assert.equal(created.item.category, 'software');

  const created2 = await api('/api/overhead-items', {
    method: 'POST',
    body: JSON.stringify({ name: 'Office rent', category: 'other', cost: 500, frequency: 'monthly' }),
  }).then((r) => r.json());

  const list = await api('/api/overhead-items').then((r) => r.json());
  assert.ok(list.items.some((i) => i.id === created.item.id));
  assert.ok(list.items.some((i) => i.id === created2.item.id));

  const updated = await api(`/api/overhead-items/${created.item.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'Adobe CC', category: 'software', cost: 120, frequency: 'monthly' }),
  }).then((r) => r.json());
  assert.equal(updated.item.cost, 120);

  // Every write above (2 creates + 1 update) must have appended a snapshot —
  // no separate recalculate step, per the brief.
  const afterWrites = await api('/api/overhead-snapshots').then((r) => r.json());
  assert.equal(afterWrites.snapshots.length, snapshotsBefore + 3);
  const latest = afterWrites.snapshots[afterWrites.snapshots.length - 1];
  assert.equal(latest.totalAnnual, (120 + 500) * 12);
  assert.equal(latest.byCategory.software, 120 * 12);
  assert.equal(latest.byCategory.other, 500 * 12);

  const del = await api(`/api/overhead-items/${created.item.id}`, { method: 'DELETE' }).then((r) => r.json());
  assert.equal(del.ok, true);
  const afterDelete = await api('/api/overhead-snapshots').then((r) => r.json());
  assert.equal(afterDelete.snapshots.length, snapshotsBefore + 4);

  const missing = await api(`/api/overhead-items/${created.item.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'x', category: 'other', cost: 1, frequency: 'monthly' }),
  });
  assert.equal(missing.status, 404);

  await api(`/api/overhead-items/${created2.item.id}`, { method: 'DELETE' });
});

test('overhead items: an out-of-enum category is rejected, not silently stored', async () => {
  const res = await api('/api/overhead-items', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bad', category: 'not_a_category', cost: 10, frequency: 'monthly' }),
  });
  assert.equal(res.status, 500);
});

test('goals: unsaved singleton reads as nulls, then round-trips after PUT', async () => {
  const empty = await api('/api/goals').then((r) => r.json());
  assert.equal(empty.updatedAt, null);
  assert.equal(empty.goals.desiredNetIncome, null);
  assert.equal(empty.goals.targetProfitMarginPct, null);
  assert.equal(empty.goals.billableCapacityHrsPerWeek, null);
  assert.equal(empty.goals.billableHoursPerDay, null);
  assert.equal(empty.goals.workingDaysPerWeek, null);
  assert.equal(empty.goals.leaveDaysPerYear, null);
  assert.equal(empty.goals.sickDaysPerYear, null);
  assert.equal(empty.goals.iawoThreshold, null);

  // This PUT does not send the five capacity fields — the shape
  // views/goals.js still sends today, ahead of the Capacity screen. The
  // first-ever row falls back to the reference defaults (8/5/30/8), and
  // billableCapacityHrsPerWeek is now SERVER-COMPUTED from them
  // (1,776 annual hours ÷ 52 = 34.15), not the 20 this request sends —
  // it is legacy, display-only and no longer a write target. See
  // resolveCapacityField's docstring in routes/goals.js.
  const put = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ desiredNetIncome: 80000, targetProfitMarginPct: 25, billableCapacityHrsPerWeek: 20 }),
  }).then((r) => r.json());
  assert.equal(put.goals.desiredNetIncome, 80000);
  assert.equal(put.goals.targetProfitMarginPct, 25);
  assert.equal(put.goals.billableCapacityHrsPerWeek, 34.15);
  assert.equal(put.goals.billableHoursPerDay, 8);
  assert.equal(put.goals.workingDaysPerWeek, 5);
  assert.equal(put.goals.leaveDaysPerYear, 30);
  assert.equal(put.goals.sickDaysPerYear, 8);
  assert.equal(put.goals.iawoThreshold, null);
  assert.ok(put.updatedAt);

  const get = await api('/api/goals').then((r) => r.json());
  assert.equal(get.goals.desiredNetIncome, 80000);
  assert.equal(get.updatedAt, put.updatedAt);

  // A second PUT in the same old shape updates in place — still the same
  // singleton row — and must NOT reset the capacity fields to 0: they fall
  // back to what is already stored, not to the reference defaults again.
  const put2 = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ desiredNetIncome: 90000, targetProfitMarginPct: 25, billableCapacityHrsPerWeek: 20 }),
  }).then((r) => r.json());
  assert.equal(put2.goals.desiredNetIncome, 90000);
  assert.equal(put2.goals.billableHoursPerDay, 8);
  assert.equal(put2.goals.workingDaysPerWeek, 5);
  assert.equal(put2.goals.billableCapacityHrsPerWeek, 34.15);
});

test('goals: the five capacity fields are settable, validated, and recompute the legacy figure', async () => {
  const put = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({
      desiredNetIncome: 80000,
      targetProfitMarginPct: 25,
      billableHoursPerDay: 6,
      workingDaysPerWeek: 4,
      leaveDaysPerYear: 20,
      sickDaysPerYear: 5,
      iawoThreshold: 20000,
    }),
  }).then((r) => r.json());
  assert.equal(put.goals.billableHoursPerDay, 6);
  assert.equal(put.goals.workingDaysPerWeek, 4);
  assert.equal(put.goals.leaveDaysPerYear, 20);
  assert.equal(put.goals.sickDaysPerYear, 5);
  assert.equal(put.goals.iawoThreshold, 20000);
  // (4 × 52 − 20 − 5) × 6 = 1,098 annual hours ÷ 52 = 21.12
  assert.equal(put.goals.billableCapacityHrsPerWeek, 21.12);

  // A later PUT that omits iawoThreshold keeps it, but explicit null clears it.
  const kept = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ workingDaysPerWeek: 4, leaveDaysPerYear: 20, sickDaysPerYear: 5 }),
  }).then((r) => r.json());
  assert.equal(kept.goals.iawoThreshold, 20000);
  // A PUT that doesn't send income or margin keeps them. These were
  // `Number(x) || 0` before migration v6, so any save from a screen that owns
  // other fields zeroed the margin — and 0% is a break-even floor, not "unset".
  assert.equal(kept.goals.desiredNetIncome, 80000);
  assert.equal(kept.goals.targetProfitMarginPct, 25);
  const cleared = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ iawoThreshold: null }),
  }).then((r) => r.json());
  assert.equal(cleared.goals.iawoThreshold, null);

  const outOfRangeDays = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ workingDaysPerWeek: 8 }),
  });
  assert.equal(outOfRangeDays.status, 400);

  const outOfRangeHours = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ billableHoursPerDay: 25 }),
  });
  assert.equal(outOfRangeHours.status, 400);

  const negativeLeave = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ leaveDaysPerYear: -1 }),
  });
  assert.equal(negativeLeave.status, 400);

  // Same '>=' guard as annualBillableHours: leave + sick consuming the whole
  // working year is rejected, not silently stored as a zero-hour capacity.
  const noCapacityLeft = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ workingDaysPerWeek: 4, leaveDaysPerYear: 104, sickDaysPerYear: 104 }),
  });
  assert.equal(noCapacityLeft.status, 400);
  assert.equal((await noCapacityLeft.json()).error, 'leave_and_sick_exceed_working_year');
});

test('goals: only a save carrying all four capacity fields confirms capacity', async () => {
  const fourFields = { billableHoursPerDay: 8, workingDaysPerWeek: 5, leaveDaysPerYear: 30, sickDaysPerYear: 8 };

  // A Goals-screen-shaped save: no capacity fields, so nothing is confirmed —
  // the seeded defaults are still a guess the Capacity screen must flag.
  db.prepare('DELETE FROM goals').run();
  const goalsShaped = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ desiredNetIncome: 80000, targetProfitMarginPct: 25 }),
  }).then((r) => r.json());
  assert.equal(goalsShaped.goals.capacityConfirmedAt, null);
  assert.equal(goalsShaped.goals.billableHoursPerDay, 8);

  // Three of the four is not the Capacity screen's save either.
  const partial = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ workingDaysPerWeek: 5, leaveDaysPerYear: 30, sickDaysPerYear: 8 }),
  }).then((r) => r.json());
  assert.equal(partial.goals.capacityConfirmedAt, null);

  // All four confirms — even when they are exactly the seeded values, because
  // 8/5/30/8 can genuinely be someone's week. Income and margin are untouched.
  const confirmed = await api('/api/goals', { method: 'PUT', body: JSON.stringify(fourFields) })
    .then((r) => r.json());
  assert.ok(confirmed.goals.capacityConfirmedAt);
  assert.equal(confirmed.goals.desiredNetIncome, 80000);
  assert.equal(confirmed.goals.targetProfitMarginPct, 25);

  // A later Goals save carries the confirmation forward rather than clearing it.
  const later = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ desiredNetIncome: 90000, targetProfitMarginPct: 30 }),
  }).then((r) => r.json());
  assert.equal(later.goals.capacityConfirmedAt, confirmed.goals.capacityConfirmedAt);
});

test('goals: a Capacity save onto a row that does not exist leaves income and margin unset', async () => {
  // The IA doc's first-run flow: Dashboard → Capacity → Save, before Profit
  // Goals has ever been opened. The margin must stay null (the em-dash set-up
  // prompt), not become a 0% margin that prices every floor at break-even.
  db.prepare('DELETE FROM goals').run();
  const put = await api('/api/goals', {
    method: 'PUT',
    body: JSON.stringify({ billableHoursPerDay: 7, workingDaysPerWeek: 5, leaveDaysPerYear: 20, sickDaysPerYear: 5 }),
  }).then((r) => r.json());
  assert.equal(put.goals.desiredNetIncome, null);
  assert.equal(put.goals.targetProfitMarginPct, null);
  assert.equal(put.goals.billableHoursPerDay, 7);
  assert.ok(put.goals.capacityConfirmedAt);
  // (5 × 52 − 20 − 5) × 7 = 1,645 annual hours ÷ 52 = 31.63
  assert.equal(put.goals.billableCapacityHrsPerWeek, 31.63);
});

test('pricing: a service\'s three prices and the service day round-trip, and the server prices by them', async () => {
  // Its own card rather than whatever an earlier test in this file left saved.
  const card = await api('/api/pricing').then((r) => r.json());
  const body = {
    serviceDay: { fullHours: 9, halfHours: 4.5 },
    labourSections: [
      { id: 'prod', label: 'Production', rows: [{ name: 'Test Day', rate: 0, prices: { hour: null, half: 0, full: 900 } }] },
    ],
    travelRows: [],
    taxSetAsideRate: 0.35,
  };
  const saved = await api('/api/pricing', { method: 'PUT', body: JSON.stringify(body) });
  assert.equal(saved.status, 200);
  const reread = await api('/api/pricing').then((r) => r.json());
  // Stored exactly as sent: null stays null (auto), a typed 0 stays 0. The
  // card comes back carrying this server's shape marker (task 6a).
  assert.deepEqual(reread.pricing, { pricingShape: PRICING_SHAPE, ...body });

  // The stored estimate's totals are computed server-side from the saved card:
  // a line with no snapshot at the full-day unit is 2 × 9 hours for the
  // overhead allocation, and 2 × $900 billed.
  const est = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ name: 'Day test', activeRows: { prod: [{ name: 'Test Day', qty: 2, dayUnit: 'full' }] } }),
  }).then((r) => r.json());
  assert.equal(est.estimate.totals.totalHours, 18);
  assert.equal(est.estimate.totals.labourTotal, 1800);

  await api('/api/estimates/' + est.estimate.id, { method: 'DELETE' });
  assert.equal((await api('/api/pricing', { method: 'PUT', body: JSON.stringify(card.pricing) })).status, 200);
});

test('pricing: a card in the pre-v9 shape is refused as outdated, whatever else is in it', async () => {
  // From the defaults, not whatever card an earlier test left saved.
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  const put = async (body) => {
    const res = await api('/api/pricing', { method: 'PUT', body: JSON.stringify(body) });
    return [res.status, (await res.json()).error];
  };
  const withRow = (row) => {
    const c = JSON.parse(JSON.stringify(card));
    c.labourSections[0].rows[0] = row;
    return c;
  };
  const outdated = [400, 'pricing_shape_outdated'];
  const prices = { hour: 140, half: null, full: null };

  // Exactly what the old Rate Card sends: no serviceDay, rows with mu.
  assert.deepEqual(await put({
    labourSections: [{ id: 'prod', label: 'Production', rows: [{ name: 'Video Capture', rate: 100, mu: 140 }] }],
    travelRows: [], taxSetAsideRate: 0.35,
  }), outdated);
  // Any one old field on any one row is enough.
  assert.deepEqual(await put(withRow({ name: 'A', mu: 140, prices })), outdated);
  assert.deepEqual(await put(withRow({ name: 'A', hoursPerUnit: 8, prices })), outdated);
  assert.deepEqual(await put(withRow({ name: 'A', dayUnit: 'full', prices })), outdated);
  assert.deepEqual(await put(withRow({ name: 'A' })), outdated);
  assert.deepEqual(await put(withRow({ name: 'A', prices: [140, null, null] })), outdated);
  // No service day, even with every row in the new shape.
  const { serviceDay, ...noDay } = card;
  assert.ok(serviceDay);
  assert.deepEqual(await put(noDay), outdated);
  // Checked first: an old card with a percent tax rate is still "outdated".
  assert.deepEqual(await put({ ...withRow({ name: 'A', mu: 1 }), taxSetAsideRate: 35, serviceDay: undefined }), outdated);

  // Nothing was written by any of that.
  assert.deepEqual((await api('/api/pricing').then((r) => r.json())).pricing, card);
});

test('pricing: the service day and each price are checked', async () => {
  // From the defaults, not whatever card an earlier test left saved.
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  const put = async (body) => {
    const res = await api('/api/pricing', { method: 'PUT', body: JSON.stringify(body) });
    return [res.status, (await res.json()).error];
  };
  const day = (fullHours, halfHours) => ({ ...card, serviceDay: { fullHours, halfHours } });
  for (const [full, half] of [[0, 4], [8, 0], [24.5, 4], [8, 0.25], [7.3, 4], ['8', 4], [null, 4], [8, undefined]]) {
    assert.deepEqual(await put(day(full, half)), [400, 'service_day_out_of_range'], `${full} / ${half}`);
  }
  assert.deepEqual(await put(day(4, 5)), [400, 'service_day_half_over_full']);
  // The edges are allowed, and so is a half day as long as the full.
  for (const [full, half] of [[24, 0.5], [0.5, 0.5], [7.5, 3.5], [10, 10]]) {
    assert.equal((await put(day(full, half)))[0], 200, `${full} / ${half}`);
  }

  const withPrices = (prices) => {
    const c = JSON.parse(JSON.stringify(card));
    c.labourSections[0].rows[0].prices = prices;
    return c;
  };
  assert.deepEqual(await put(withPrices({ hour: -1, half: null, full: null })), [400, 'labour_price_negative']);
  assert.deepEqual(await put(withPrices({ hour: 140, half: null })), [400, 'labour_prices_incomplete']);
  assert.deepEqual(await put(withPrices({ hour: '140', half: null, full: null })), [400, 'labour_price_not_a_number']);
  assert.deepEqual(await put(withPrices({ hour: '', half: null, full: null })), [400, 'labour_price_not_a_number']);
  // null is auto and 0 is a price: both are fine.
  assert.equal((await put(withPrices({ hour: 0, half: null, full: null })))[0], 200);
  assert.equal((await put(card))[0], 200);
});

function depreciationAssetPayload(overrides = {}) {
  return {
    name: 'Camera Body',
    category: 'camera',
    serialNumber: 'SN1',
    supplier: 'Acme',
    purchaseDate: '2024-07-01',
    startDate: '2024-07-01',
    costIncGst: 1100,
    gstAmount: 100,
    gstCreditClaimed: true,
    method: 'prime_cost',
    effectiveLifeYears: 5,
    businessUsePct: 100,
    replacementCycleYears: 3,
    replacementCostEstimate: 3000,
    ...overrides,
  };
}

test('depreciation assets: create, list, update, delete — each write appends an overhead snapshot', async () => {
  const before = await api('/api/overhead-snapshots').then((r) => r.json());
  const snapshotsBefore = before.snapshots.length;

  const created = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload()),
  }).then((r) => r.json());
  assert.equal(created.asset.name, 'Camera Body');
  assert.equal(created.asset.costIncGst, 1100);
  assert.equal(created.asset.gstCreditClaimed, true);

  const list = await api('/api/depreciation-assets').then((r) => r.json());
  assert.ok(list.assets.some((a) => a.id === created.asset.id));

  const updated = await api(`/api/depreciation-assets/${created.asset.id}`, {
    method: 'PUT',
    body: JSON.stringify(depreciationAssetPayload({ name: 'Camera Body Mk2' })),
  }).then((r) => r.json());
  assert.equal(updated.asset.name, 'Camera Body Mk2');

  // Every write above (1 create + 1 update) must have appended a snapshot,
  // exactly like the overhead-items CRUD above — see writeSnapshot's docblock
  // in routes/overhead.js.
  const afterWrites = await api('/api/overhead-snapshots').then((r) => r.json());
  assert.equal(afterWrites.snapshots.length, snapshotsBefore + 2);
  // Straight-line reserve: (3000 ÷ 3) × 100% = 1000/yr, apportioned into the
  // depreciation_reserve bucket so the donut still reconciles against total.
  const latest = afterWrites.snapshots[afterWrites.snapshots.length - 1];
  assert.equal(latest.byCategory.depreciation_reserve, 1000);

  const del = await api(`/api/depreciation-assets/${created.asset.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const afterDelete = await api('/api/overhead-snapshots').then((r) => r.json());
  assert.equal(afterDelete.snapshots.length, snapshotsBefore + 3);
  assert.equal(
    afterDelete.snapshots[afterDelete.snapshots.length - 1].byCategory.depreciation_reserve,
    undefined
  );

  const missing = await api(`/api/depreciation-assets/${created.asset.id}`, {
    method: 'PUT',
    body: JSON.stringify(depreciationAssetPayload()),
  });
  assert.equal(missing.status, 404);
});

test('depreciation assets: an out-of-enum category or method is rejected, not silently stored', async () => {
  const badCategory = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload({ category: 'not_a_category' })),
  });
  assert.equal(badCategory.status, 500);

  const badMethod = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload({ method: 'not_a_method' })),
  });
  assert.equal(badMethod.status, 500);
});

test('depreciation schedule, CSV and lodgement lock', async () => {
  const created = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload({ name: 'Schedule Camera' })),
  }).then((r) => r.json());
  const assetId = created.asset.id;

  // costBase = 1100 − 100 (GST credit claimed) = 1000. prime_cost declines
  // the FIXED COST BASE, not the opening value, so it does NOT compound:
  // every full year is 1000 × (1/5) = 200. FY2024-25: decline 200, closing
  // 800. FY2025-26: decline 200 again, closing 600. One asset, no pools, so
  // the FY total is just that asset's deductible.
  const schedule = await api('/api/depreciation-schedule?fy=FY2025-26').then((r) => r.json());
  assert.equal(schedule.schedule.fy, 'FY2025-26');
  assert.equal(schedule.schedule.totalDeductible, 200);
  assert.equal(schedule.locked, false);
  assert.equal(schedule.diverges, null);
  assert.equal(schedule.divergences, null);
  assert.equal(schedule.fyEnded, true, 'FY2025-26 ended on 30 June 2026');
  const row = schedule.schedule.assets.find((r2) => r2.assetId === assetId);
  assert.equal(row.openingAdjustableValue, 800);
  assert.equal(row.decline, 200);
  assert.equal(row.closingAdjustableValue, 600);

  const badFy = await api('/api/depreciation-schedule?fy=2025');
  assert.equal(badFy.status, 400);

  const csvRes = await api('/api/depreciation-schedule.csv?fy=FY2025-26');
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get('content-disposition') || '', /depreciation-schedule-FY2025-26\.csv/);
  // Raw bytes: Response.text() strips a leading BOM while decoding, which
  // would make this assertion pass or fail for the wrong reason.
  const csvBytes = Buffer.from(await csvRes.arrayBuffer());
  // A BOM so Excel reads it as UTF-8; money to two places; the pool-only
  // column and the disposal columns blank for a held asset.
  assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csvText = csvBytes.subarray(3).toString('utf8');
  assert.ok(csvText.startsWith('Name,Category,Method,Start Date,Days Held,Business Use %,'));
  assert.match(csvText, /\r\nSchedule Camera,camera,prime_cost,2024-07-01,365,100,800\.00,,200\.00,200\.00,600\.00,,,,,\r\n/);

  // Lodging a year that hasn't finished is refused: its figures still move.
  const notEnded = await api('/api/depreciation-locks', {
    method: 'POST',
    body: JSON.stringify({ fy: currentFinancialYear() }),
  });
  assert.equal(notEnded.status, 400);
  assert.equal((await notEnded.json()).error, 'fy_not_ended');
  const current = await api('/api/depreciation-schedule').then((r) => r.json());
  assert.equal(current.fyEnded, false);

  // Lock the FY, then change the asset in a way that moves the same FY's
  // recompute — a schedule is computed from the asset's CURRENT definition,
  // so effective life is retroactive across every year, not just future ones.
  const lock = await api('/api/depreciation-locks', {
    method: 'POST',
    body: JSON.stringify({ fy: 'FY2025-26' }),
  }).then((r) => r.json());
  assert.equal(lock.lock.fyLabel, 'FY2025-26');
  assert.equal(lock.lock.figures.totalDeductible, 200);

  const badLockFy = await api('/api/depreciation-locks', {
    method: 'POST',
    body: JSON.stringify({ fy: 'not-a-fy' }),
  });
  assert.equal(badLockFy.status, 400);

  await api(`/api/depreciation-assets/${assetId}`, {
    method: 'PUT',
    body: JSON.stringify(depreciationAssetPayload({ name: 'Schedule Camera', effectiveLifeYears: 10 })),
  });

  // Life 10 makes the fixed straight-line decline 1000 × (1/10) = 100, the
  // same every year — diverges from the locked 200.
  const afterEdit = await api('/api/depreciation-schedule?fy=FY2025-26').then((r) => r.json());
  assert.equal(afterEdit.schedule.totalDeductible, 100);
  assert.equal(afterEdit.locked, true);
  assert.equal(afterEdit.lockedFigures.totalDeductible, 200);
  assert.equal(afterEdit.diverges, true);
  // Line by line, naming the asset and every figure that moved: life 10
  // means FY2024-25 took 100, so FY2025-26 opens at 900, declines 100, and
  // closes at 800 — against the lodged 800 / 200 / 200 / 600.
  const moved = afterEdit.divergences.find((d) => d.id === assetId);
  assert.equal(moved.change, 'changed');
  assert.equal(moved.name, 'Schedule Camera');
  assert.deepEqual(
    Object.fromEntries(moved.fields.map((f) => [f.field, [f.lodged, f.live]])),
    {
      openingAdjustableValue: [800, 900],
      decline: [200, 100],
      deductible: [200, 100],
      closingAdjustableValue: [600, 800],
    }
  );

  // The CSV for a locked FY must still read the FROZEN figures — editing
  // effective life in a later session cannot rewrite what was already filed.
  const lockedCsv = await api('/api/depreciation-schedule.csv?fy=FY2025-26').then((r) => r.text());
  assert.match(lockedCsv, /\r\nSchedule Camera,camera,prime_cost,2024-07-01,365,100,800\.00,,200\.00,200\.00,600\.00,,,,,\r\n/);

  // An asset deleted after lodging is a divergence, not a silent disappearance.
  await api(`/api/depreciation-assets/${assetId}`, { method: 'DELETE' });
  const afterDelete = await api('/api/depreciation-schedule?fy=FY2025-26').then((r) => r.json());
  const gone = afterDelete.divergences.find((d) => d.id === assetId);
  assert.equal(gone.change, 'removed');
  assert.equal(gone.name, 'Schedule Camera');
  // …and the lodged CSV still lists it, from the snapshot.
  const csvAfterDelete = await api('/api/depreciation-schedule.csv?fy=FY2025-26').then((r) => r.text());
  assert.match(csvAfterDelete, /\r\nSchedule Camera,,,,365,100,800\.00,,200\.00,200\.00,600\.00,,,,,\r\n/);

  const locks = await api('/api/depreciation-locks').then((r) => r.json());
  assert.ok(locks.locks.some((l) => l.id === lock.lock.id));
});

/**
 * THE DISPOSAL FLOW (2026-09-27). The default payload: cost 1100 − 100 GST
 * credit = 1000 cost base, prime cost over 5 years (200 a full year), started
 * 1 July 2024, replacement reserve 3000 ÷ 3 = 1000 a year.
 */
test('disposal: refused before the start date, with a bad date, or with negative proceeds', async () => {
  const created = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload({ name: 'Disposal Guard Camera' })),
  }).then((r) => r.json());
  const id = created.asset.id;
  const put = (overrides) => api(`/api/depreciation-assets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(depreciationAssetPayload(overrides)),
  });

  const before = await put({ disposalDate: '2024-06-30', disposalProceeds: 0 });
  assert.equal(before.status, 400);
  assert.equal((await before.json()).error, 'disposal_before_start');
  // The same rule on create: an asset can't arrive already sold before it started.
  const createdBefore = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload({ disposalDate: '2024-06-30' })),
  });
  assert.equal(createdBefore.status, 400);

  const notADate = await put({ disposalDate: '2025-02-30', disposalProceeds: 0 });
  assert.equal(notADate.status, 400);
  assert.equal((await notADate.json()).error, 'disposal_date_invalid');

  const negative = await put({ disposalDate: '2025-01-01', disposalProceeds: -1 });
  assert.equal(negative.status, 400);
  assert.equal((await negative.json()).error, 'disposal_proceeds_invalid');

  // Nothing above was stored.
  const list = await api('/api/depreciation-assets').then((r) => r.json());
  assert.equal(list.assets.find((a) => a.id === id).disposalDate, null);

  // Disposed the same day it started is a real (one-day) holding, not an error.
  assert.equal((await put({ disposalDate: '2024-07-01', disposalProceeds: 0 })).status, 200);

  await api(`/api/depreciation-assets/${id}`, { method: 'DELETE' });
});

test('disposal: leaves the reserve at once, stays on its own FY with the balancing adjustment', async () => {
  const reserveNow = async () => {
    const snaps = (await api('/api/overhead-snapshots').then((r) => r.json())).snapshots;
    return snaps[snaps.length - 1].byCategory.depreciation_reserve || 0;
  };
  const created = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload({ name: 'Disposal Flow Camera' })),
  }).then((r) => r.json());
  const id = created.asset.id;
  const held = await reserveNow();
  const put = (overrides) => api(`/api/depreciation-assets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(depreciationAssetPayload(overrides)),
  }).then((r) => r.json());
  const rowFor = async (fy) => {
    const reply = await api(`/api/depreciation-schedule?fy=${fy}`).then((r) => r.json());
    return reply.schedule.assets.find((r) => r.assetId === id) || null;
  };

  // Sold on the last day of FY2024-25 — before the current FY started, so it
  // belongs to that earlier year. Held all 365 days: decline 200, adjustable
  // value 800; sold for 900 → balancing adjustment +100 (assessable).
  const sold = await put({ disposalDate: '2025-06-30', disposalProceeds: 900, disposalReason: 'Sold' });
  assert.equal(sold.asset.disposalDate, '2025-06-30');
  assert.equal(sold.asset.disposalReason, 'Sold');
  assert.equal(await reserveNow(), held - 1000, 'the reserve drops by the asset’s 1000/yr at once');

  const soldRow = await rowFor('FY2024-25');
  assert.equal(soldRow.disposed, true);
  assert.equal(soldRow.daysHeld, 365);
  assert.equal(soldRow.closingAdjustableValue, 800);
  assert.equal(soldRow.balancingAdjustment, 100);
  assert.equal(await rowFor('FY2025-26'), null, 'no schedule after the disposal year');

  // Scrapped for nothing mid FY2025-26: held 1 Jul – 31 Dec = 184 days,
  // decline 1000 × 184/365 × 20% = 100.82, adjustable value 699.18, and a
  // balancing adjustment of −699.18 (a further deduction).
  await put({ disposalDate: '2025-12-31', disposalProceeds: 0, disposalReason: 'Scrapped' });
  const scrapped = await rowFor('FY2025-26');
  assert.equal(scrapped.daysHeld, 184);
  assert.equal(scrapped.decline, 100.82);
  assert.equal(scrapped.closingAdjustableValue, 699.18);
  assert.equal(scrapped.balancingAdjustment, -699.18);
  assert.equal((await rowFor('FY2024-25')).balancingAdjustment, null, 'the earlier year is back to an ordinary one');

  // Undone: back in the reserve.
  await put({ disposalDate: null, disposalProceeds: null, disposalReason: '' });
  assert.equal(await reserveNow(), held);

  await api(`/api/depreciation-assets/${id}`, { method: 'DELETE' });
});

test('the depreciation CSV defuses a name a spreadsheet would run as a formula', async () => {
  const created = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload({ name: '=HYPERLINK("x")', startDate: '2023-07-01', purchaseDate: '2023-07-01' })),
  }).then((r) => r.json());
  const csv = await api('/api/depreciation-schedule.csv?fy=FY2023-24').then((r) => r.text());
  // Apostrophe-prefixed, then quoted because it contains quotes.
  assert.match(csv, /\r\n"'=HYPERLINK\(""x""\)",camera,/);
  await api(`/api/depreciation-assets/${created.asset.id}`, { method: 'DELETE' });
});

test('estimates: create, list, get, update, duplicate, delete — with computed totals', async () => {
  // Reset GST state so this test doesn't depend on running after the settings
  // test above.
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ gst: { registered: false, rate: 0.1, pricesIncludeGst: false } }),
  });
  const cardSave = await api('/api/pricing', {
    method: 'PUT',
    body: JSON.stringify({
      serviceDay: { fullHours: 8, halfHours: 4 },
      labourSections: [{ id: 'prod', label: 'Production', rows: [{ name: 'Video Capture', rate: 100, prices: { hour: 140, half: null, full: null } }] }],
      travelRows: [],
      taxSetAsideRate: 0.35,
    }),
  });
  assert.equal(cardSave.status, 200);

  const created = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Brand film', client: { businessName: 'Acme' },
      activeRows: { prod: [{ name: 'Video Capture', qty: 2 }] },
    }),
  }).then((r) => r.json());
  assert.equal(created.estimate.totals.labourTotal, 280);
  assert.equal(created.estimate.totals.totalIncGst, 280);

  const list = await api('/api/estimates').then((r) => r.json());
  assert.equal(list.estimates.length, 1);

  const got = await api(`/api/estimates/${created.estimate.id}`).then((r) => r.json());
  assert.equal(got.estimate.name, 'Brand film');

  const updated = await api(`/api/estimates/${created.estimate.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Brand film v2', client: { businessName: 'Acme' },
      activeRows: { prod: [{ name: 'Video Capture', qty: 3 }] },
    }),
  }).then((r) => r.json());
  assert.equal(updated.estimate.name, 'Brand film v2');
  assert.equal(updated.estimate.totals.labourTotal, 420);

  const dup = await api(`/api/estimates/${created.estimate.id}/duplicate`, { method: 'POST' })
    .then((r) => r.json());
  assert.equal(dup.estimate.name, 'Brand film v2 (copy)');
  assert.equal(dup.estimate.status, 'draft');

  const del = await api(`/api/estimates/${created.estimate.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const missing = await api(`/api/estimates/${created.estimate.id}`);
  assert.equal(missing.status, 404);
});

test('estimates: a GST-free estimate survives the round trip and prices without GST', async () => {
  // A registered, GST-exclusive business — so GST would apply unless the
  // estimate opts out.
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ gst: { registered: true, rate: 0.1, pricesIncludeGst: false } }),
  });
  const cardSave = await api('/api/pricing', {
    method: 'PUT',
    body: JSON.stringify({
      serviceDay: { fullHours: 8, halfHours: 4 },
      labourSections: [{ id: 'prod', label: 'Production', rows: [{ name: 'Video Capture', rate: 100, prices: { hour: 140, half: null, full: null } }] }],
      travelRows: [],
      taxSetAsideRate: 0.35,
    }),
  });
  assert.equal(cardSave.status, 200);
  const rows = { prod: [{ name: 'Video Capture', qty: 2 }] };

  const bearing = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ name: 'Taxable job', activeRows: rows }),
  }).then((r) => r.json());
  assert.equal(bearing.estimate.gstFree, false);
  assert.equal(bearing.estimate.totals.gst, 28);
  assert.equal(bearing.estimate.totals.totalIncGst, 308);

  const free = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ name: 'GST-free job', activeRows: rows, gstFree: true }),
  }).then((r) => r.json());
  assert.equal(free.estimate.gstFree, true);
  assert.equal(free.estimate.totals.gst, 0);
  assert.equal(free.estimate.totals.totalIncGst, 280);

  // Read back in a fresh request: the flag is a column, not something the POST
  // reply happened to echo.
  const reread = await api(`/api/estimates/${free.estimate.id}`).then((r) => r.json());
  assert.equal(reread.estimate.gstFree, true);
  assert.equal(reread.estimate.totals.gst, 0);

  // A duplicate is a copy of the document, so it inherits the tax treatment.
  // Re-deriving it from settings would quietly add GST to a copy of a GST-free
  // quote.
  const dup = await api(`/api/estimates/${free.estimate.id}/duplicate`, { method: 'POST' })
    .then((r) => r.json());
  assert.equal(dup.estimate.gstFree, true);
  assert.equal(dup.estimate.totals.gst, 0);

  // And it can be switched back off, which must re-price rather than keep the
  // stored figure.
  const back = await api(`/api/estimates/${free.estimate.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'GST-free job', activeRows: rows, gstFree: false }),
  }).then((r) => r.json());
  assert.equal(back.estimate.gstFree, false);
  assert.equal(back.estimate.totals.gst, 28);

  for (const id of [bearing.estimate.id, free.estimate.id, dup.estimate.id]) {
    await api(`/api/estimates/${id}`, { method: 'DELETE' });
  }
});

test('pdf: a GST-bearing invoice is refused until the ABN is set; other documents are not', async () => {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ business: { name: '', abn: '' }, gst: { registered: true, rate: 0.1, pricesIncludeGst: false } }),
  });
  const rows = { prod: [{ name: 'Video Capture', qty: 2 }] };
  const make = (extra) => api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ name: 'Doc', activeRows: rows, ...extra }),
  }).then((r) => r.json()).then((j) => j.estimate);

  // Invoice-typed rows are only ever old ones now (D62): no write makes one.
  const asInvoice = (est, number) => {
    db.prepare("UPDATE estimates SET doc_type = 'invoice', invoice_number = ? WHERE id = ?").run(number, est.id);
    return { ...est, docType: 'invoice', invoiceNumber: number };
  };
  const taxInvoice = asInvoice(await make({}), 'INV-1');
  const freeInvoice = asInvoice(await make({ gstFree: true }), 'INV-2');
  const quote = await make({});
  assert.equal(taxInvoice.totals.gst, 28);

  const refused = await api(`/api/estimates/${taxInvoice.id}/pdf`, { method: 'POST' });
  assert.equal(refused.status, 422);
  const body = await refused.json();
  assert.equal(body.error, 'abn_required');
  assert.match(body.message, /ABN/);

  // Printed as the estimate it started as (the folder's estimate row), it is
  // no invoice, so it needs no ABN.
  const asEstimate = await api(`/api/estimates/${taxInvoice.id}/pdf`, { method: 'POST', body: JSON.stringify({ as: 'estimate' }) });
  assert.notEqual(asEstimate.status, 422);
  await asEstimate.arrayBuffer();

  // 200 with Chromium present, 503 without — either way, not refused.
  for (const est of [freeInvoice, quote]) {
    const res = await api(`/api/estimates/${est.id}/pdf`, { method: 'POST' });
    assert.notEqual(res.status, 422, `${est.docType} ${est.gstFree ? 'GST-free' : ''} was refused`);
    await res.arrayBuffer();
  }

  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ business: { name: 'Lachlan Sullivan-Carey', abn: '51824753556' }, gst: { registered: true, rate: 0.1, pricesIncludeGst: false } }),
  });
  const allowed = await api(`/api/estimates/${taxInvoice.id}/pdf`, { method: 'POST' });
  assert.notEqual(allowed.status, 422);
  await allowed.arrayBuffer();

  for (const est of [taxInvoice, freeInvoice, quote]) {
    await api(`/api/estimates/${est.id}`, { method: 'DELETE' });
  }
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({}) });
});

test('pdf: a non-ASCII name exports with its filename intact and takes no backup snapshot', async () => {
  const created = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Nick’s launch — v2',
      client: { businessName: 'Café Ltd' },
      activeRows: { prod: [{ name: 'Video Capture', qty: 1 }] },
    }),
  }).then((r) => r.json());

  const backupDir = path.join(TMP, 'backups');
  const snapshotsBefore = fs.readdirSync(backupDir).sort();

  const res = await api(`/api/estimates/${created.estimate.id}/pdf`, { method: 'POST' });
  // 200 with Chromium present, 503 without. Before the fix, a raw header 500'd.
  assert.notEqual(res.status, 500);
  if (res.status === 200) {
    const disposition = res.headers.get('content-disposition');
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    assert.ok(encoded, disposition);
    assert.equal(decodeURIComponent(encoded[1]), 'EST - Café Ltd - Nick’s launch — v2.pdf');
  }
  await res.arrayBuffer();

  // Compared as a set, not a count: at retention a new snapshot would replace
  // the oldest and leave the count unchanged.
  assert.deepEqual(fs.readdirSync(backupDir).sort(), snapshotsBefore);

  await api(`/api/estimates/${created.estimate.id}`, { method: 'DELETE' });
});

test('CORS: an allow-listed origin gets credentialed headers, others get none', async () => {
  // This server instance was built with no CORS_ORIGINS set, so no origin
  // should be echoed back — same-origin-only is the safe default.
  const res = await api('/api/settings', { headers: { origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);

  const { config } = require('../src/config');
  config.corsOrigins.push('https://pages.example');
  try {
    const allowed = await api('/api/settings', { headers: { origin: 'https://pages.example' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://pages.example');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    // The export button names the download from this header.
    assert.match(allowed.headers.get('access-control-expose-headers'), /Content-Disposition/);
  } finally {
    config.corsOrigins.pop();
  }
});

/* ── The 2026-09-28 money-math audit ──────────────────────────────────────── */

test('tax years: saved per FY in normalised order, and an unusable year is refused', async () => {
  const body = {
    brackets: [{ from: 45000, ratePct: 30 }, { from: 18200, ratePct: 15 }, { from: 0, ratePct: 0 }],
    medicareLevyPct: 2,
  };
  const saved = await api('/api/tax-years/FY 2026–27', { method: 'PUT', body: JSON.stringify(body) }).then((r) => r.json());
  assert.equal(saved.taxYear.fy, 'FY2026-27');
  assert.deepEqual(saved.taxYear.brackets.map((b) => b.from), [0, 18200, 45000]);

  const list = await api('/api/tax-years').then((r) => r.json());
  assert.ok(list.taxYears.some((t) => t.fy === 'FY2026-27'));

  for (const bad of [
    { brackets: [], medicareLevyPct: 2 },
    { brackets: [{ from: 0, ratePct: 99 }], medicareLevyPct: 2 },
    { brackets: [{ from: 0, ratePct: 'x' }], medicareLevyPct: 2 },
  ]) {
    const res = await api('/api/tax-years/FY2026-27', { method: 'PUT', body: JSON.stringify(bad) });
    assert.equal(res.status, 400);
  }
  assert.equal((await api('/api/tax-years/2026', { method: 'PUT', body: JSON.stringify(body) })).status, 400);
});

test('goals: super and bad debt are stored as percents and kept across other writers\' saves', async () => {
  const saved = await api('/api/goals', {
    method: 'PUT', body: JSON.stringify({ desiredNetIncome: 80000, targetProfitMarginPct: 25, superPct: 12, badDebtPct: 2 }),
  }).then((r) => r.json());
  assert.deepEqual([saved.goals.superPct, saved.goals.badDebtPct], [12, 2]);
  // A Capacity-shaped save doesn't carry them and must not wipe them.
  const cap = await api('/api/goals', {
    method: 'PUT', body: JSON.stringify({ billableHoursPerDay: 8, workingDaysPerWeek: 5, leaveDaysPerYear: 30, sickDaysPerYear: 8 }),
  }).then((r) => r.json());
  assert.deepEqual([cap.goals.superPct, cap.goals.badDebtPct], [12, 2]);
  assert.equal((await api('/api/goals', { method: 'PUT', body: JSON.stringify({ badDebtPct: 100 }) })).status, 400);
  assert.equal((await api('/api/goals', { method: 'PUT', body: JSON.stringify({ superPct: -1 }) })).status, 400);
});

test('pricing: a tax rate stored as a percent, or a negative price, is refused', async () => {
  // From the defaults, not whatever card an earlier test left saved.
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  const put = (body) => api('/api/pricing', { method: 'PUT', body: JSON.stringify(body) });
  assert.equal((await put({ ...card, taxSetAsideRate: 35 })).status, 400);
  const neg = JSON.parse(JSON.stringify(card));
  neg.labourSections[0].rows[0].prices.hour = -1;
  assert.equal((await put(neg)).status, 400);
  const negTravel = JSON.parse(JSON.stringify(card));
  negTravel.travelRows[0].mu = -1;
  assert.equal((await put(negTravel)).status, 400);
  const badHours = JSON.parse(JSON.stringify(card));
  badHours.serviceDay.fullHours = 0;
  assert.equal((await put(badHours)).status, 400);
  assert.equal((await put(card)).status, 200);
});

test('estimates: a negative line is refused; a snapshotted line keeps its price', async () => {
  const neg = await api('/api/estimates', {
    method: 'POST', body: JSON.stringify({ name: 'neg', activeRows: { prod: [{ name: 'Video Capture', qty: -2 }] } }),
  });
  assert.equal(neg.status, 400);
  assert.equal((await neg.json()).field, 'prod.qty');

  // Quoted at $99/hr, whatever the card says now.
  const created = await api('/api/estimates', {
    method: 'POST', body: JSON.stringify({ name: 'snap', activeRows: { prod: [{ name: 'Video Capture', qty: 2, mu: 99 }] } }),
  }).then((r) => r.json());
  assert.equal(created.estimate.totals.labourTotal, 198);
});

test('estimates: a write without the v9 pricing shape is refused as outdated, whatever else is in it', async () => {
  const count = () => api('/api/estimates').then((r) => r.json()).then((r) => r.estimates.length);
  const write = async (pathname, method, body) => {
    const res = await api(pathname, { method, body: JSON.stringify(body), bare: true });
    const reply = await res.json();
    return [res.status, reply.error, typeof reply.message];
  };
  const outdated = [400, 'pricing_shape_outdated', 'string'];

  const created = await api('/api/estimates', {
    method: 'POST', body: JSON.stringify({ name: 'kept', activeRows: { prod: [{ name: 'Video Capture', qty: 2, mu: 150 }] } }),
  }).then((r) => r.json());
  assert.equal(created.estimate.totals.labourTotal, 300);
  const before = await count();

  // Exactly what the pre-v9 editor sends for a new line on a v9 card: its
  // lineSnapshot read `mu` from a row that has `prices` instead, and got 0.
  const old = { name: 'old tab', activeRows: { prod: [{ name: 'Video Capture', qty: 2, mu: 0, rowId: 'x' }] } };
  assert.deepEqual(await write('/api/estimates', 'POST', old), outdated);
  // Its "Update to current rates", re-saving an existing estimate at $0.
  assert.deepEqual(await write(`/api/estimates/${created.estimate.id}`, 'PUT', old), outdated);
  // Any marker but this build's is the same.
  assert.deepEqual(await write('/api/estimates', 'POST', { ...old, pricingShape: 'flat' }), outdated);
  // Checked first: an old write with a negative line is still "outdated".
  assert.deepEqual(
    await write('/api/estimates', 'POST', { activeRows: { prod: [{ name: 'Video Capture', qty: -1 }] } }),
    outdated
  );

  // Nothing was written by any of that.
  assert.equal(await count(), before);
  const reread = await api(`/api/estimates/${created.estimate.id}`).then((r) => r.json());
  assert.deepEqual(reread.estimate, created.estimate);

  // The rate card's refusal carries words too, for the old Rate Card to show.
  const card = await api('/api/pricing', { method: 'PUT', body: JSON.stringify({ labourSections: [], travelRows: [] }) });
  const refusal = await card.json();
  assert.deepEqual([card.status, refusal.error, typeof refusal.message], outdated);

  await api(`/api/estimates/${created.estimate.id}`, { method: 'DELETE' });
});

test('depreciation assets: an opening value is dated to its FY, and keeps it across an edit', async () => {
  const created = await api('/api/depreciation-assets', {
    method: 'POST',
    body: JSON.stringify(depreciationAssetPayload({ openingAdjustableValue: 500, expectedResaleValue: 400 })),
  }).then((r) => r.json());
  assert.equal(created.asset.openingValueFy, currentFinancialYear());
  assert.equal(created.asset.expectedResaleValue, 400);

  // Dated explicitly, then edited without re-sending the FY: it stays put.
  const dated = await api(`/api/depreciation-assets/${created.asset.id}`, {
    method: 'PUT', body: JSON.stringify(depreciationAssetPayload({ openingAdjustableValue: 500, openingValueFy: 'FY2024-25' })),
  }).then((r) => r.json());
  assert.equal(dated.asset.openingValueFy, 'FY2024-25');
  const edited = await api(`/api/depreciation-assets/${created.asset.id}`, {
    method: 'PUT', body: JSON.stringify(depreciationAssetPayload({ name: 'Renamed', openingAdjustableValue: 500 })),
  }).then((r) => r.json());
  assert.equal(edited.asset.openingValueFy, 'FY2024-25');

  const bad = await api('/api/depreciation-assets', {
    method: 'POST', body: JSON.stringify(depreciationAssetPayload({ expectedResaleValue: -5 })),
  });
  assert.equal(bad.status, 400);
  await api(`/api/depreciation-assets/${created.asset.id}`, { method: 'DELETE' });
});

test('pricing: Reset Defaults gives back Transport & Logistics Hrs as "Your time"', async () => {
  // estimate-accuracy task 5: the owner's own hours, on a fresh or reset card.
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  const row = card.travelRows.find((r) => r.name === 'Transport & Logistics Hrs');
  assert.equal(row.ownTime, true);
});

test('pricing: since task 6a a card must carry the shape marker, and an own-time price may be auto', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  assert.equal(card.pricingShape, PRICING_SHAPE);
  assert.equal(card.travelRows.find((r) => r.name === 'Transport & Logistics Hrs').mu, null);
  const put = async (body, bare) => {
    const res = await api('/api/pricing', { method: 'PUT', body: JSON.stringify(body), bare });
    return [res.status, (await res.json()).error];
  };
  const outdated = [400, 'pricing_shape_outdated'];
  const { pricingShape, ...unmarked } = card;

  // Exactly what the Rate Card from before 6a sends: every field rebuilt, no
  // marker, and the auto transport price run through num() into a typed 0.
  const oldTab = { ...unmarked, travelRows: unmarked.travelRows.map((r) => ({ ...r, mu: Number(r.mu) || 0 })) };
  assert.deepEqual(await put(oldTab, true), outdated);
  assert.deepEqual(await put({ ...card, pricingShape: 'service-units' }, true), outdated);
  // Nothing was written.
  assert.deepEqual((await api('/api/pricing').then((r) => r.json())).pricing, card);

  // Blank prices: auto on an own-time row, allowed on a Direct row (its price
  // prices nothing), refused anywhere else.
  const withTravel = (row) => ({ ...card, travelRows: [row] });
  assert.deepEqual(await put(withTravel({ name: 'Drive', rate: 25, mu: null, ownTime: true })), [200, undefined]);
  assert.equal((await api('/api/pricing').then((r) => r.json())).pricing.travelRows[0].mu, null);
  assert.deepEqual(await put(withTravel({ name: 'Tolls', rate: 0, mu: null, directCost: true })), [200, undefined]);
  assert.deepEqual(await put(withTravel({ name: 'Meals', rate: 25, mu: null })), [400, 'travel_price_missing']);
  assert.deepEqual(await put(withTravel({ name: 'Meals', rate: 25 })), [400, 'travel_price_missing']);
  assert.deepEqual(await put(withTravel({ name: 'Meals', rate: 25, mu: '' })), [400, 'travel_price_missing']);
  assert.deepEqual(await put(withTravel({ name: 'Meals', rate: 25, mu: 0 })), [200, undefined]);

  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
});

test('pricing: a card stored before the marker existed is served with it', async () => {
  // Written straight to the table, as every card saved before task 6a is.
  const { pricingShape, ...stored } = (await api('/api/pricing').then((r) => r.json())).pricing;
  db.prepare('UPDATE pricing SET data_json = ? WHERE id = 1').run(JSON.stringify(stored));
  const served = (await api('/api/pricing').then((r) => r.json())).pricing;
  assert.equal(served.pricingShape, PRICING_SHAPE);
  assert.deepEqual({ ...served, pricingShape: undefined }, { ...stored, pricingShape: undefined });
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
});

test('estimates: a write from a build before task 6a is refused as outdated', async () => {
  const res = await api('/api/estimates', {
    method: 'POST',
    bare: true,
    // What that build's editor sends for an auto travel row: snapshotted at $0.
    body: JSON.stringify({ pricingShape: 'service-units', name: 'old tab', activeRows: { travel: [{ name: 'Transport & Logistics Hrs', qty: 2, mu: 0, rate: 25, ownTime: true }] } }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'pricing_shape_outdated');
});

test('goals: the per-km vehicle cost is saved alone, cleared with blank, and never negative', async () => {
  const put = (body) => api('/api/goals', { method: 'PUT', body: JSON.stringify(body) });
  const read = () => api('/api/goals').then((r) => r.json()).then((r) => r.goals);
  const others = (g) => ({ ...g, vehicleCostPerKm: undefined });

  const before = await read();
  let res = await put({ vehicleCostPerKm: 0.9 });
  assert.equal(res.status, 200);
  const saved = await read();
  assert.equal(saved.vehicleCostPerKm, 0.9);
  // Only that field moved: income, markup, capacity, super and the rest stay.
  assert.deepEqual(others(saved), { ...others(before), capacityConfirmedAt: saved.capacityConfirmedAt });

  // Another screen's save, which doesn't send it, leaves it alone.
  assert.equal((await put({ superPct: 11 })).status, 200);
  assert.equal((await read()).vehicleCostPerKm, 0.9);

  res = await put({ vehicleCostPerKm: -0.5 });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'vehicle_cost_per_km_out_of_range');
  assert.equal((await put({ vehicleCostPerKm: 'abc' })).status, 400);
  assert.equal((await read()).vehicleCostPerKm, 0.9);

  assert.equal((await put({ vehicleCostPerKm: '' })).status, 200);
  assert.equal((await read()).vehicleCostPerKm, null);
  assert.equal((await put({ vehicleCostPerKm: 0 })).status, 200); // a real figure
  assert.equal((await read()).vehicleCostPerKm, 0);
  assert.equal((await put({ vehicleCostPerKm: null, superPct: before.superPct })).status, 200);
});

test('pricing: a km row takes no price of its own and is never also Your time or Direct', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  const km = card.travelRows.find((r) => r.perKm);
  assert.deepEqual([km.name, km.mu, km.unit], ['Vehicle — per km', null, 'km']);
  const put = async (row) => {
    const res = await api('/api/pricing', { method: 'PUT', body: JSON.stringify({ ...card, travelRows: [row] }) });
    return [res.status, (await res.json()).error];
  };
  assert.deepEqual(await put({ name: 'Car', rate: 0, mu: null, perKm: true, unit: 'km' }), [200, undefined]);
  assert.deepEqual(await put({ name: 'Car', rate: 0, mu: null, perKm: true, ownTime: true }), [400, 'travel_per_km_flags']);
  assert.deepEqual(await put({ name: 'Car', rate: 0, mu: null, perKm: true, directCost: true }), [400, 'travel_per_km_flags']);
  // A 'travel-auto' build (6a) is refused: it would save this row as a resold $0 row.
  const old = await api('/api/pricing', { method: 'PUT', bare: true, body: JSON.stringify({ ...card, pricingShape: 'travel-auto' }) });
  assert.equal(old.status, 400);
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
});

test('estimates: a km line is billed at cost and a bare one on the server prices at nothing', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const make = (travel) => api('/api/estimates', {
    method: 'POST', body: JSON.stringify({ name: 'km', activeRows: { travel } }),
  }).then((r) => r.json()).then((r) => r.estimate);
  // As the editor sends it: snapshotted at the figure, with the flag.
  const snapped = await make([{ name: 'Vehicle — per km', qty: 120, mu: 0.9, perKm: true }]);
  assert.deepEqual(
    [snapped.totals.expenseTotal, snapped.totals.directJobCost, snapped.totals.incomeExGst, snapped.totals.totalHours],
    [108, 108, 0, 0]
  );
  // With no snapshot the server has no Overhead figure to price it from.
  const bare = await make([{ name: 'Vehicle — per km', qty: 120 }]);
  assert.equal(bare.totals.expenseTotal, 0);
  for (const e of [snapped, bare]) await api(`/api/estimates/${e.id}`, { method: 'DELETE' });
});

/* ── Production days (production-booking task 2) ───────────────────────────
   Dates: Fri 2 Oct, Sat 3 Oct, Mon 5 Oct (NSW Labour Day) 2026. Each test
   cleans up its estimates, so their days leave the calendar with them. */
const capture = (dayId, extra) => ({ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, ...(dayId ? { dayId } : {}), ...(extra || {}) });
const pbDay = (id, date, status, extra) => ({ id, date, status, startTime: null, endTime: null, overrideNote: '', ...(extra || {}) });
async function saveEstimate(body, id) {
  const res = await api(id ? `/api/estimates/${id}` : '/api/estimates', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify({ name: 'Booked', upid: 'UP-' + Math.random().toString(36).slice(2, 6), ...body }),
  });
  return { status: res.status, body: await res.json() };
}
const dropEstimates = (...ids) => Promise.all(ids.map((id) => api(`/api/estimates/${id}`, { method: 'DELETE' })));

test('estimates: one saved before v11 reads no days, and totals exactly as it did', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const rows = { prod: [capture(null)], post: [capture(null, { name: 'Edit', mu: 900 })] };
  const before = await saveEstimate({ activeRows: rows });
  assert.equal(before.status, 201);
  // As v11 leaves an older row: no days, nothing ticked, an empty snapshot,
  // and totals stored before surchargeTotal existed.
  const { surchargeTotal, ...oldTotals } = before.body.estimate.totals;
  assert.equal(surchargeTotal, 0);
  db.prepare("UPDATE estimates SET short_notice = 0, surcharges_json = '{}', totals_json = ? WHERE id = ?")
    .run(JSON.stringify(oldTotals), before.body.estimate.id);
  const read = (await api(`/api/estimates/${before.body.estimate.id}`).then((r) => r.json())).estimate;
  assert.deepEqual([read.days, read.shortNotice, read.surcharges], [[], false, {}]);
  assert.deepEqual(read.totals, oldTotals);
  // Re-saved by a v11 build, with and without a days list: every figure as it
  // was, plus a zero surchargeTotal.
  for (const extra of [{ days: [] }, {}]) {
    const again = await saveEstimate({ activeRows: rows, ...extra }, read.id);
    assert.deepEqual(again.body.estimate.totals, { ...oldTotals, surchargeTotal: 0 });
    assert.deepEqual(again.body.estimate.activeRows, rows);
  }
  await dropEstimates(read.id);
});

test('estimates: the worked examples price on the server as in calc.js, and each line carries its price', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const days = [
    pbDay('d_sat', '2026-10-03', 'confirmed', { startTime: '13:00', endTime: '21:00' }),
    pbDay('d_fri', '2026-10-02', 'pencilled', { startTime: '09:00', endTime: '19:00' }),
    pbDay('d_tbc', null, 'proposed'),
  ];
  const activeRows = { prod: [capture('d_sat'), capture('d_fri'), capture('d_tbc')] };
  const { status, body } = await saveEstimate({ activeRows, days });
  assert.equal(status, 201);
  const e = body.estimate;
  // Friday 9–7 holds a full day, which covers 9–5: no after hours on it.
  assert.deepEqual(e.activeRows.prod.map((l) => l.surchargedPrice), [1680, 1120, 1120]);
  assert.deepEqual([e.totals.surchargeTotal, e.totals.totalIncGst], [560, 3920]);
  assert.deepEqual(e.days.map((d) => d.id), ['d_sat', 'd_fri', 'd_tbc']);
  assert.deepEqual(e.surcharges.days, { d_sat: 'weekend', d_fri: 'weekday' });

  // Short notice ticked: Saturday 1–9pm is the brief's $3,360 in the default mode.
  const sn = await saveEstimate({ activeRows, days, shortNotice: true }, e.id);
  assert.deepEqual(sn.body.estimate.activeRows.prod.map((l) => l.surchargedPrice), [3360, 2240, 2240]);
  assert.equal(sn.body.estimate.shortNotice, true);
  // A PUT that doesn't mention days or short notice keeps both.
  const kept = await saveEstimate({ activeRows }, e.id);
  assert.equal(kept.body.estimate.days.length, 3);
  assert.equal(kept.body.estimate.totals.totalIncGst, sn.body.estimate.totals.totalIncGst);
  // An empty list removes them; the lines then name no day, which is refused…
  assert.equal((await saveEstimate({ activeRows, days: [] }, e.id)).body.error, 'line_day_unknown');
  // …until they come off their days too.
  const cleared = await saveEstimate({ activeRows: { prod: [capture(null)] }, days: [], shortNotice: false }, e.id);
  assert.deepEqual([cleared.body.estimate.days, cleared.body.estimate.surcharges, cleared.body.estimate.totals.surchargeTotal], [[], {}, 0]);
  await dropEstimates(e.id);
});

test('estimates: a saved estimate keeps the multipliers it was priced at until asked to refresh', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  const days = [pbDay('d_s1', '2026-10-03', 'confirmed')];
  const activeRows = { prod: [capture('d_s1')] };
  const first = await saveEstimate({ activeRows, days });
  assert.equal(first.body.estimate.totals.surchargeTotal, 560);

  assert.equal((await api('/api/pricing', { method: 'PUT', body: JSON.stringify({ ...card, surcharges: { weekend: 2 } }) })).status, 200);
  const resaved = await saveEstimate({ activeRows, days }, first.body.estimate.id);
  assert.equal(resaved.body.estimate.totals.surchargeTotal, 560);
  const fresh = await saveEstimate({ activeRows, days, refreshSurcharges: true }, first.body.estimate.id);
  assert.equal(fresh.body.estimate.totals.surchargeTotal, 1120);
  // A new estimate takes the card as it is now.
  const other = await saveEstimate({ activeRows: { prod: [capture('d_s2')] }, days: [pbDay('d_s2', '2026-10-04', 'proposed')] });
  assert.equal(other.body.estimate.totals.surchargeTotal, 1120);

  // A holiday added later moves only days saved after it.
  db.prepare("INSERT INTO holidays (date, name, source) VALUES ('2026-10-05', 'Labour Day', 'added')").run();
  const mon = await saveEstimate({ activeRows: { prod: [capture('d_m')] }, days: [pbDay('d_m', '2026-10-05', 'proposed')] });
  assert.equal(mon.body.estimate.totals.surchargeTotal, 1120);
  db.prepare("UPDATE holidays SET hidden = 1 WHERE date = '2026-10-05'").run();
  const monAgain = await saveEstimate({ activeRows: { prod: [capture('d_m')] }, days: [pbDay('d_m', '2026-10-05', 'proposed')] }, mon.body.estimate.id);
  assert.equal(monAgain.body.estimate.totals.surchargeTotal, 1120);
  db.prepare('DELETE FROM holidays').run();
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  await dropEstimates(first.body.estimate.id, other.body.estimate.id, mon.body.estimate.id);
});

test('estimates: a date another estimate confirmed is locked, unless the day carries a note', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const a = await saveEstimate({ upid: 'UPID-042', days: [pbDay('a1', '2026-10-03', 'confirmed'), pbDay('a2', '2026-10-10', 'pencilled')] });
  assert.equal(a.status, 201);

  // A second "tab": a raw write of another estimate onto A's confirmed date.
  const locked = await saveEstimate({ days: [pbDay('b1', '2026-10-03', 'proposed')] });
  assert.equal(locked.status, 409);
  assert.deepEqual([locked.body.error, locked.body.date, locked.body.upid, locked.body.estimateId],
    ['date_locked', '2026-10-03', 'UPID-042', a.body.estimate.id]);
  assert.match(locked.body.message, /UPID-042/);

  // With a specification note it goes through, and the note is kept.
  const b = await saveEstimate({ days: [pbDay('b1', '2026-10-03', 'confirmed', { overrideNote: '  Subcontractor shooting ' })] });
  assert.equal(b.status, 201);
  assert.equal(b.body.estimate.days[0].overrideNote, 'Subcontractor shooting');

  // A pencilled date never refuses, whatever the new day's status.
  const c = await saveEstimate({ days: [pbDay('c1', '2026-10-10', 'confirmed')] });
  assert.equal(c.status, 201);
  // …but now A's pencilled 10 Oct can't turn confirmed without a note,
  const promote = await saveEstimate({ upid: 'UPID-042', days: [pbDay('a1', '2026-10-03', 'confirmed'), pbDay('a2', '2026-10-10', 'confirmed')] }, a.body.estimate.id);
  assert.equal(promote.status, 409);
  // while re-saving it as it stands is still allowed.
  const same = await saveEstimate({ upid: 'UPID-042', days: [pbDay('a1', '2026-10-03', 'confirmed'), pbDay('a2', '2026-10-10', 'pencilled')] }, a.body.estimate.id);
  assert.equal(same.status, 200);
  // Moving a day onto a locked date is checked like a new one.
  const move = await saveEstimate({ days: [pbDay('c1', '2026-10-03', 'confirmed')] }, c.body.estimate.id);
  assert.equal(move.status, 409);
  // The refused writes changed nothing.
  assert.deepEqual((await api(`/api/estimates/${c.body.estimate.id}`).then((r) => r.json())).estimate.days.map((d) => d.date), ['2026-10-10']);
  await dropEstimates(a.body.estimate.id, b.body.estimate.id, c.body.estimate.id);
});

test('estimates: days and the lines on them are checked before anything is stored', async () => {
  const bad = async (body) => (await saveEstimate(body)).body.error;
  assert.equal(await bad({ days: 'Saturday' }), 'days_not_a_list');
  assert.equal(await bad({ days: [pbDay('x', '2026-02-30', 'confirmed')] }), 'day_date_invalid');
  assert.equal(await bad({ days: [pbDay('x', '2026-10-03', 'booked')] }), 'day_status_invalid');
  assert.equal(await bad({ days: [pbDay('x', '2026-10-03', 'proposed', { startTime: '9am' })] }), 'day_time_invalid');
  assert.equal(await bad({ days: [pbDay('x y', '2026-10-03', 'proposed')] }), 'day_id_invalid');
  assert.equal(await bad({ days: [pbDay('x', null, 'proposed'), pbDay('x', null, 'proposed')] }), 'day_id_duplicate');
  assert.equal(await bad({ days: [pbDay('x', null, 'proposed')], activeRows: { prod: [capture('y')] } }), 'line_day_unknown');
  assert.equal(await bad({ days: [pbDay('x', null, 'proposed')], activeRows: { post: [capture('x')] } }), 'day_on_non_production_line');

  const owner = await saveEstimate({ days: [pbDay('d_owned', null, 'proposed')] });
  assert.equal(await bad({ days: [pbDay('d_owned', null, 'proposed')] }), 'day_id_taken');
  await dropEstimates(owner.body.estimate.id);
});

test('calendar: only days dated in the range, with what a tile shows, and none once the estimate goes', async () => {
  const e = await saveEstimate({
    upid: 'UPID-077', name: 'Launch film', client: { businessName: 'Acme Pty Ltd' },
    activeRows: { prod: [capture('k1'), capture('k1', { name: 'Drone' }), capture('k2')] },
    days: [
      pbDay('k1', '2026-10-03', 'confirmed', { startTime: '20:00', endTime: '02:00' }),
      pbDay('k2', '2026-11-01', 'pencilled'),
      pbDay('k3', null, 'proposed'),
    ],
  });
  assert.equal(e.status, 201);
  const cal = (q) => api('/api/calendar' + q).then(async (r) => [r.status, await r.json()]);

  let [status, body] = await cal('?from=2026-10-01&to=2026-10-31');
  assert.equal(status, 200);
  assert.deepEqual(body.days, [{
    id: 'k1', estimateId: e.body.estimate.id, projectId: e.body.estimate.projectId, date: '2026-10-03', status: 'confirmed',
    startTime: '20:00', endTime: '02:00', overrideNote: '', upid: 'UPID-077', projectName: 'Launch film',
    client: 'Acme Pty Ltd', items: ['Video Capture', 'Drone'],
  }]);
  // Overnight into the 4th still belongs to the 3rd; both ends inclusive.
  assert.deepEqual((await cal('?from=2026-10-04&to=2026-10-31'))[1].days, []);
  assert.deepEqual((await cal('?from=2026-10-03&to=2026-11-01'))[1].days.map((d) => d.id), ['k1', 'k2']);

  assert.equal((await cal('?from=2026-10-31&to=2026-10-01'))[0], 400);
  assert.equal((await cal('?from=2026-10-01'))[0], 400);
  assert.equal((await cal('?from=2026-01-01&to=2027-12-31'))[0], 400);

  await dropEstimates(e.body.estimate.id);
  [status, body] = await cal('?from=2026-10-01&to=2026-11-30');
  assert.deepEqual(body.days, []);
});

test('estimates: short notice with no days pins the card\'s multiplier and reaches every production line', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  assert.equal((await api('/api/pricing', { method: 'PUT', body: JSON.stringify({ ...card, surcharges: { shortNotice: 1.5 } }) })).status, 200);
  const e = await saveEstimate({ activeRows: { prod: [capture(null)], post: [capture(null, { name: 'Edit' })] }, shortNotice: true });
  assert.equal(e.status, 201);
  assert.equal(e.body.estimate.surcharges.settings.shortNotice, 1.5);
  assert.deepEqual(e.body.estimate.activeRows.prod.map((l) => l.surchargedPrice), [1680]);
  assert.equal('surchargedPrice' in e.body.estimate.activeRows.post[0], false);
  assert.deepEqual([e.body.estimate.totals.totalIncGst, e.body.estimate.totals.surchargeTotal], [1680 + 1120, 560]);
  // Untick it and nothing is pinned or surcharged.
  const off = await saveEstimate({ activeRows: { prod: [capture(null)] }, shortNotice: false }, e.body.estimate.id);
  assert.deepEqual([off.body.estimate.surcharges, off.body.estimate.totals.surchargeTotal], [{}, 0]);
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  await dropEstimates(e.body.estimate.id);
});

test('estimates: a duplicate takes no days, and its lines price at base', async () => {
  const e = await saveEstimate({
    activeRows: { prod: [capture('dd1')] }, shortNotice: true,
    days: [pbDay('dd1', '2026-10-03', 'confirmed')],
  });
  assert.equal(e.body.estimate.totals.totalIncGst, 3360);
  const reply = await api(`/api/estimates/${e.body.estimate.id}/duplicate`, { method: 'POST' }).then((r) => r.json());
  const copy = reply.estimate;
  // The reply says how many items lost their day, so the screen can say so.
  assert.equal(reply.unbooked, 1);
  assert.deepEqual([copy.days, copy.shortNotice, copy.surcharges], [[], false, {}]);
  assert.deepEqual(copy.activeRows.prod, [capture(null)]);
  assert.deepEqual([copy.totals.totalIncGst, copy.totals.surchargeTotal], [1120, 0]);
  await dropEstimates(e.body.estimate.id, copy.id);
});

test('cost breakdown: an estimate whose saved total no longer matches its lines is refused before rendering', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const e = await saveEstimate({ activeRows: { post: [capture(null, { name: 'Edit', mu: 1000, qty: 2 })] } });
  db.prepare('UPDATE estimates SET totals_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...e.body.estimate.totals, clientPriceExGst: 1400, totalIncGst: 1400 }), e.body.estimate.id);
  const res = await api(`/api/estimates/${e.body.estimate.id}/cost-breakdown`, { method: 'POST' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'breakdown_stale');
  await dropEstimates(e.body.estimate.id);
});

test('estimates and pricing: a write from a build before v11 is refused as outdated', async () => {
  const est = await api('/api/estimates', { method: 'POST', bare: true, body: JSON.stringify({ pricingShape: 'travel-km', name: 'old tab' }) });
  assert.equal(est.status, 400);
  assert.equal((await est.json()).error, 'pricing_shape_outdated');
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  const { surcharges, ...dropped } = card; // what that build's Rate Card sends
  const old = await api('/api/pricing', { method: 'PUT', bare: true, body: JSON.stringify({ ...dropped, pricingShape: 'travel-km' }) });
  assert.equal(old.status, 400);
  assert.equal((await old.json()).error, 'pricing_shape_outdated');
});

test('pricing: surcharge settings are checked when a card carries them', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  const put = async (surcharges) => {
    const res = await api('/api/pricing', { method: 'PUT', body: JSON.stringify({ ...card, surcharges }) });
    return (await res.json()).error;
  };
  assert.equal(await put({ shortNotice: 2, weekend: 1.5, afterHours: 1.25, officeStart: '07:00', officeEnd: '17:00', workingWeekdays: [1, 2, 3, 4, 5], mode: 'higher', shortNoticeHintDays: 7 }), undefined);
  assert.equal(await put({ weekend: 0.8 }), 'surcharge_multiplier_out_of_range');
  assert.equal(await put({ afterHours: '1.25' }), 'surcharge_multiplier_out_of_range');
  assert.equal(await put({ officeStart: '17:00', officeEnd: '07:00' }), 'surcharge_office_hours_invalid');
  assert.equal(await put({ officeStart: '07:00' }), 'surcharge_office_hours_invalid');
  assert.equal(await put({ workingWeekdays: [] }), 'surcharge_weekdays_invalid');
  assert.equal(await put({ workingWeekdays: [1, 7] }), 'surcharge_weekdays_invalid');
  assert.equal(await put({ mode: 'add' }), 'surcharge_mode_invalid');
  assert.equal(await put({ shortNoticeHintDays: -1 }), 'surcharge_hint_days_out_of_range');
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
});

test('pricing: deliverable types and Capture ticks round-trip, and a malformed one is refused (B2-1)', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const card = (await api('/api/pricing').then((r) => r.json())).pricing;
  // A fresh card has no types and no ticks: the user sets up their own.
  assert.deepEqual(card.deliverableTypes, []);
  assert.ok(card.labourSections.every((s) => s.rows.every((r) => r.capture === undefined)));

  const ticked = card.labourSections.map((s) => s.id !== 'prod' ? s : { ...s, rows: s.rows.map((r, i) => (i < 2 ? { ...r, capture: true } : r)) });
  const types = [
    { id: 'dt_brand', name: 'Brand Story', description: 'Hero film', services: ['Video Editor — A-Roll Offline Edit', 'Video Editor — Longform Colour'], multiplier: 2 },
    { id: 'dt_socials', name: 'Socials', description: '', services: [], multiplier: 0.5 },
  ];
  const put = async (body) => {
    const res = await api('/api/pricing', { method: 'PUT', bare: true, body: JSON.stringify({ ...card, ...body }) });
    return { status: res.status, body: await res.json() };
  };
  const saved = await put({ labourSections: ticked, deliverableTypes: types });
  assert.equal(saved.status, 200);
  const reread = (await api('/api/pricing').then((r) => r.json())).pricing;
  assert.deepEqual(reread.deliverableTypes, types);
  assert.deepEqual(reread.labourSections.find((s) => s.id === 'prod').rows.map((r) => r.capture), [true, true, undefined]);

  // A card that leaves them out is still fine (calc.js reads nothing as none).
  const { deliverableTypes: _dt, ...noTypes } = card;
  assert.equal((await api('/api/pricing', { method: 'PUT', bare: true, body: JSON.stringify(noTypes) })).status, 200);

  for (const bad of [
    { deliverableTypes: {} },
    { deliverableTypes: [{ ...types[0], multiplier: -1 }] },
    { deliverableTypes: [{ ...types[0], multiplier: '2' }] },
    { deliverableTypes: [{ ...types[0], id: '' }] },
    { deliverableTypes: [{ ...types[0], services: 'Video Editor — Socials' }] },
    { deliverableTypes: [null] },
  ]) {
    const res = await put(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.error, 'deliverable_types_invalid');
  }
  const flag = await put({ labourSections: card.labourSections.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, capture: 'yes' })) })) });
  assert.equal(flag.body.error, 'labour_capture_not_a_flag');

  // A build from before B2 is refused, so its Rate Card can't drop either field.
  const old = await put({ pricingShape: 'production-days' });
  assert.equal(old.body.error, 'pricing_shape_outdated');
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
});

/* ── Day-built estimates and gear rentals (production-booking B2-2) ─────────
   Travel, crew and gear sit on days; rentals are stored per estimate and
   shown on the calendar. Dates: Fri 2 – Mon 5 Oct 2026. */
const rental = (id, vendor, extra) => ({ id, vendor, outDate: null, outMethod: null, backDate: null, backMethod: null, note: '', ...(extra || {}) });
const B2_ROWS = (sat, sun) => ({
  deliverables: [
    { id: 'dv_brand', name: 'Brand Story', format: '16:9', duration: '2 min', qty: 1, typeId: 'dt_brand', typeName: 'Brand Story', multiplier: 2 },
    { id: 'dv_soc', name: 'Socials', format: '9:16', duration: '30 s', qty: 3, typeId: 'dt_soc', typeName: 'Socials', multiplier: 0.5 },
  ],
  prod: [capture(sat, { capture: true }), capture(sun, { capture: true })],
  post: [
    { name: 'Video Editor — A-Roll Offline Edit', qty: 6, mu: 63, hoursPerUnit: 1, deliverableId: 'dv_brand' },
    { name: 'Video Editor — Socials', qty: 4, mu: 126, hoursPerUnit: 1, deliverableId: 'dv_soc' },
    { name: 'Video Editor — Project Setup', qty: 1, mu: 49, hoursPerUnit: 1 },
  ],
  travel: [
    { name: 'Transport & Logistics Hrs', qty: 2, mu: 35, rate: 25, ownTime: true, ...(sat ? { dayId: sat } : {}) },
    { name: 'Crew Meals', qty: 3, mu: 30, rate: 30, unit: 'meals', ...(sun ? { dayId: sun } : {}) },
  ],
  crew: [{ role: 'Gaffer', days: 1, cost: 600, ...(sat ? { dayId: sat } : {}) }],
  equip: [
    { vendor: 'Lensworks', item: 'Cine zoom kit', days: 2, cost: 150, ...(sat ? { dayId: sat } : {}) },
    { vendor: 'lensworks ', item: 'Matte box', days: 1, cost: 40, ...(sun ? { dayId: sun } : {}) },
    { vendor: 'Grip Co', item: 'Dolly', days: 1, cost: 220, ...(sun ? { dayId: sun } : {}) },
  ],
});

test('estimates: travel, crew and gear on days and two rentals round-trip, price unsurcharged, and show on the calendar', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const days = [pbDay('b2_sat', '2026-10-03', 'pencilled', { startTime: '18:00', endTime: '23:00' }), pbDay('b2_sun', '2026-10-04', 'proposed')];
  const rentals = [
    rental('rn_lens', 'Lensworks', { outDate: '2026-10-02', outMethod: 'pickup', backDate: '2026-10-05', backMethod: 'return', note: 'Ask for the 18–35' }),
    rental('rn_grip', 'Grip Co', { outDate: '2026-10-04', outMethod: 'postage' }),
  ];
  const activeRows = B2_ROWS('b2_sat', 'b2_sun');
  const e = await saveEstimate({ upid: 'UP-B2', name: 'Two-day shoot', activeRows, days, rentals, shortNotice: true });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  const saved = e.body.estimate;
  assert.deepEqual(saved.rentals, rentals);

  // Every new field comes back as sent; only production lines carry a surcharged price.
  const { prod: savedProd, ...rest } = saved.activeRows;
  const { prod: sentProd, ...sentRest } = activeRows;
  assert.deepEqual(rest, sentRest);
  assert.deepEqual(savedProd.map(({ surchargedPrice, ...l }) => l), sentProd);
  assert.ok(savedProd.every((l) => l.surchargedPrice > l.mu));

  // The on-set extras total exactly as they would on no day: only production moved.
  const offDays = await saveEstimate({ activeRows: { ...B2_ROWS(null, null), prod: [] } });
  const days2 = [pbDay('b2_sat2', '2026-10-03', 'pencilled', { startTime: '18:00', endTime: '23:00' }), pbDay('b2_sun2', '2026-10-04', 'proposed')];
  const onDays = await saveEstimate({ activeRows: { ...B2_ROWS('b2_sat2', 'b2_sun2'), prod: [] }, days: days2, shortNotice: true });
  assert.equal(onDays.body.estimate.totals.surchargeTotal, 0);
  assert.equal(onDays.body.estimate.totals.totalIncGst, offDays.body.estimate.totals.totalIncGst);
  assert.equal(onDays.body.estimate.totals.expenseTotal, 70 + 90 + 600 + 300 + 40 + 220);

  // GET, and the list, carry them.
  const read = (await api(`/api/estimates/${saved.id}`).then((r) => r.json())).estimate;
  assert.deepEqual([read.rentals, read.activeRows], [rentals, saved.activeRows]);
  const listed = (await api('/api/estimates').then((r) => r.json())).estimates.find((x) => x.id === saved.id);
  assert.deepEqual(listed.rentals, rentals);

  // The calendar: both rentals overlap October; a range after Grip Co's one date holds only Lensworks.
  const cal = async (q) => (await api('/api/calendar' + q).then((r) => r.json())).rentals.filter((r) => r.estimateId === saved.id);
  assert.deepEqual(await cal('?from=2026-10-01&to=2026-10-31'), [
    { id: 'rn_lens', estimateId: saved.id, projectId: saved.projectId, upid: 'UP-B2', projectName: 'Two-day shoot', vendor: 'Lensworks', outDate: '2026-10-02', outMethod: 'pickup', backDate: '2026-10-05', backMethod: 'return' },
    { id: 'rn_grip', estimateId: saved.id, projectId: saved.projectId, upid: 'UP-B2', projectName: 'Two-day shoot', vendor: 'Grip Co', outDate: '2026-10-04', outMethod: 'postage', backDate: null, backMethod: null },
  ]);
  assert.deepEqual((await cal('?from=2026-10-05&to=2026-10-31')).map((r) => r.id), ['rn_lens']); // the back date, inclusive
  assert.deepEqual((await cal('?from=2026-10-04&to=2026-10-04')).map((r) => r.id), ['rn_lens', 'rn_grip']);
  assert.deepEqual((await cal('?from=2026-09-01&to=2026-10-01')).map((r) => r.id), []);
  assert.deepEqual((await cal('?from=2026-10-06&to=2026-10-31')).map((r) => r.id), []);
  // The days' tiles still list production items only.
  const calDays = (await api('/api/calendar?from=2026-10-01&to=2026-10-31').then((r) => r.json())).days.filter((d) => d.estimateId === saved.id);
  assert.deepEqual(calDays.map((d) => d.items), [['Video Capture'], ['Video Capture']]);

  // A PUT without `rentals` keeps them…
  const kept = await saveEstimate({ upid: 'UP-B2', name: 'Two-day shoot', activeRows, days }, saved.id);
  assert.deepEqual(kept.body.estimate.rentals, rentals);
  // …a vendor with no gear left loses its rental, sent or kept…
  const noGrip = { ...activeRows, equip: activeRows.equip.filter((l) => l.vendor !== 'Grip Co') };
  assert.deepEqual((await saveEstimate({ activeRows: noGrip, days }, saved.id)).body.estimate.rentals.map((r) => r.id), ['rn_lens']);
  // A rental with no vendor joins nothing, not even a hire line whose vendor is blank too.
  const blankLine = { ...activeRows, equip: [...activeRows.equip, { vendor: ' ', item: 'Gaffer tape', days: 1, cost: 5 }] };
  assert.deepEqual((await saveEstimate({ activeRows: blankLine, days, rentals: [...rentals, rental('rn_none', '')] }, saved.id)).body.estimate.rentals.map((r) => r.id), ['rn_lens', 'rn_grip']);
  // …and an empty list removes them all.
  assert.deepEqual((await saveEstimate({ activeRows, days, rentals: [] }, saved.id)).body.estimate.rentals, []);

  // Deleting the estimate takes its rentals off the calendar.
  await saveEstimate({ activeRows, days, rentals }, saved.id);
  await dropEstimates(saved.id, offDays.body.estimate.id, onDays.body.estimate.id);
  assert.deepEqual(await cal('?from=2026-10-01&to=2026-10-31'), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rentals WHERE estimate_id = ?').get(saved.id).n, 0);
});

test('estimates: one saved before B2 re-saves at the same totals, with no rentals', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  // The shape a pre-B2 build wrote: no ids, types, tags, capture or items, and nothing but production on a day.
  const rows = {
    deliverables: [{ name: 'Brand Story', format: '16:9', duration: '2 min', qty: 1 }],
    prod: [capture(null)],
    post: [{ name: 'Video Editor — Socials', qty: 4, mu: 126, hoursPerUnit: 1 }],
    travel: [{ name: 'Crew Meals', qty: 3, mu: 30, rate: 30 }],
    crew: [{ role: 'Gaffer', days: 1, cost: 600 }],
    equip: [{ vendor: 'Lens hire / Cine zoom', days: 2, cost: 150 }],
  };
  const e = await saveEstimate({ activeRows: rows });
  const first = e.body.estimate;
  assert.deepEqual(first.rentals, []);
  for (const extra of [{}, { rentals: [] }]) {
    const again = (await saveEstimate({ activeRows: rows, ...extra }, first.id)).body.estimate;
    assert.deepEqual([again.totals, again.activeRows, again.rentals], [first.totals, rows, []]);
  }
  await dropEstimates(first.id);
});

test('estimates: rentals, on-set days and deliverable tags are checked before anything is stored', async () => {
  const equip = [{ vendor: 'Lensworks', item: 'Kit', days: 1, cost: 100 }, { vendor: 'Grip Co', item: 'Dolly', days: 1, cost: 100 }];
  const bad = async (body) => (await saveEstimate({ activeRows: { equip }, ...body })).body.error;
  assert.equal(await bad({ rentals: {} }), 'rentals_not_a_list');
  assert.equal(await bad({ rentals: [null] }), 'rental_invalid');
  assert.equal(await bad({ rentals: [rental('a b', 'Lensworks')] }), 'rental_id_invalid');
  assert.equal(await bad({ rentals: [rental('r1', 'Lensworks'), rental('r1', 'Grip Co')] }), 'rental_id_duplicate');
  assert.equal(await bad({ rentals: [rental('r1', 'Lensworks'), rental('r2', ' LENSWORKS ')] }), 'rental_vendor_duplicate');
  assert.equal(await bad({ rentals: [rental('r1', 'L'.repeat(201))] }), 'rental_vendor_too_long');
  assert.equal(await bad({ rentals: [rental('r1', 'Lensworks', { outDate: '2026-02-30' })] }), 'rental_date_invalid');
  assert.equal(await bad({ rentals: [rental('r1', 'Lensworks', { backDate: 'Monday' })] }), 'rental_date_invalid');
  assert.equal(await bad({ rentals: [rental('r1', 'Lensworks', { outDate: '2026-10-05', backDate: '2026-10-02' })] }), 'rental_dates_reversed');
  assert.equal(await bad({ rentals: [rental('r1', 'Lensworks', { outMethod: 'return' })] }), 'rental_method_invalid');
  assert.equal(await bad({ rentals: [rental('r1', 'Lensworks', { backMethod: 'pickup' })] }), 'rental_method_invalid');
  assert.equal(await bad({ rentals: [rental('r1', 'Lensworks', { note: 'x'.repeat(501) })] }), 'rental_note_too_long');
  assert.equal(await bad({ rentals: Array.from({ length: 101 }, (_, i) => rental('r' + i, 'V' + i)) }), 'too_many_rentals');
  const owner = await saveEstimate({ activeRows: { equip }, rentals: [rental('rn_owned', 'Lensworks')] });
  assert.equal(await bad({ rentals: [rental('rn_owned', 'Lensworks')] }), 'rental_id_taken');
  await dropEstimates(owner.body.estimate.id);

  // Days: travel, crew and equipment may sit on one; every other section still may not.
  const day = [pbDay('x', null, 'proposed')];
  for (const key of ['travel', 'crew', 'equip']) {
    assert.equal(await bad({ days: day, activeRows: { [key]: [{ name: 'A', role: 'A', vendor: 'A', qty: 1, days: 1, cost: 1, dayId: 'nope' }] } }), 'line_day_unknown', key);
  }
  for (const key of ['preprod', 'post', 'additional', 'deliverables']) {
    assert.equal(await bad({ days: day, activeRows: { [key]: [{ name: 'A', qty: 1, dayId: 'x' }] } }), 'day_on_non_production_line', key);
  }

  // Deliverable ids and the post lines that name them.
  const dv = (id) => ({ id, name: 'D', qty: 1 });
  const tagged = (key, id) => ({ [key]: [{ name: 'Edit', qty: 1, mu: 63, deliverableId: id }] });
  assert.equal(await bad({ activeRows: { deliverables: [dv('d 1')] } }), 'deliverable_id_invalid');
  assert.equal(await bad({ activeRows: { deliverables: [dv(7)] } }), 'deliverable_id_invalid');
  assert.equal(await bad({ activeRows: { deliverables: [dv('d1'), dv('d1')] } }), 'deliverable_id_duplicate');
  assert.equal(await bad({ activeRows: { deliverables: [dv('d1')], ...tagged('post', 'd2') } }), 'line_deliverable_unknown');
  assert.equal(await bad({ activeRows: { deliverables: [dv('d1')], ...tagged('prod', 'd1') } }), 'deliverable_on_non_post_line');
  assert.equal(await bad({ activeRows: { deliverables: [dv('d1')], ...tagged('travel', 'd1') } }), 'deliverable_on_non_post_line');
  assert.equal(await bad({ activeRows: tagged('post', 'd1') }), 'line_deliverable_unknown');
  // An untagged line and a deliverable with no id (saved before B2) are fine.
  const ok = await saveEstimate({ activeRows: { deliverables: [{ name: 'Old', qty: 1 }, dv('d1')], ...tagged('post', 'd1') } });
  assert.equal(ok.status, 201);
  await dropEstimates(ok.body.estimate.id);
});

test('calendar: a rental with one date is a one-day marker, and one with no dates is on no calendar', async () => {
  const equip = ['Back Only', 'No Dates', 'Long Hire'].map((vendor) => ({ vendor, item: 'Kit', days: 1, cost: 1 }));
  const e = await saveEstimate({
    activeRows: { equip },
    rentals: [
      rental('rn_back', 'Back Only', { backDate: '2026-10-09', backMethod: 'postage' }),
      rental('rn_none', 'No Dates'),
      rental('rn_long', 'Long Hire', { outDate: '2026-09-28', backDate: '2026-11-02' }),
    ],
  });
  assert.equal(e.status, 201);
  const ids = async (from, to) => (await api(`/api/calendar?from=${from}&to=${to}`).then((r) => r.json())).rentals
    .filter((r) => r.estimateId === e.body.estimate.id).map((r) => r.id);
  assert.deepEqual(await ids('2026-10-01', '2026-10-31'), ['rn_long', 'rn_back']);
  assert.deepEqual(await ids('2026-10-09', '2026-10-09'), ['rn_long', 'rn_back']);
  assert.deepEqual(await ids('2026-10-10', '2026-10-20'), ['rn_long']); // a span covering the whole range
  assert.deepEqual(await ids('2026-11-03', '2026-11-30'), []);
  await dropEstimates(e.body.estimate.id);
});

test('estimates: a duplicate takes its travel, crew and gear off their days, and no rentals', async () => {
  const days = [pbDay('dup_sat', '2026-10-03', 'pencilled'), pbDay('dup_sun', '2026-10-04', 'proposed')];
  const activeRows = B2_ROWS('dup_sat', 'dup_sun');
  const e = await saveEstimate({ activeRows, days, rentals: [rental('rn_dup', 'Lensworks', { outDate: '2026-10-02' })] });
  assert.equal(e.status, 201);
  const reply = await api(`/api/estimates/${e.body.estimate.id}/duplicate`, { method: 'POST' }).then((r) => r.json());
  const copy = reply.estimate;
  // 2 production + 2 travel + 1 crew + 3 equipment lines came off a day.
  assert.equal(reply.unbooked, 8);
  assert.deepEqual([copy.days, copy.rentals], [[], []]);
  assert.deepEqual(copy.activeRows, B2_ROWS(null, null)); // deliverables, tags and capture as they were
  // Only production lost a surcharge, so the copy is the original less it.
  assert.equal(copy.totals.totalIncGst, e.body.estimate.totals.totalIncGst - e.body.estimate.totals.surchargeTotal);
  await dropEstimates(e.body.estimate.id, copy.id);
});

/* ── Projects (v13, production-booking task 15) ────────────────────────── */
const projectRow = (id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

test('projects: a new estimate is a new project, the UPID is unique, and the estimate carries it', async () => {
  const a = await saveEstimate({ upid: ' UP-T15A ' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const est = a.body.estimate;
  assert.equal(est.upid, 'UP-T15A');
  assert.match(est.projectId, /^prj_/);
  assert.deepEqual([projectRow(est.projectId).upid, projectRow(est.projectId).needs_upid], ['UP-T15A', 0]);

  // Taken, whatever the case and spacing.
  const clash = await saveEstimate({ upid: 'up-t15a' });
  assert.deepEqual([clash.status, clash.body.error, clash.body.upid, clash.body.projectId],
    [409, 'upid_taken', 'up-t15a', est.projectId]);

  // A project holds its UPID even with no estimate carrying it.
  db.prepare("INSERT INTO projects (id, upid, created_at, updated_at) VALUES ('prj_t15p', 'UP-T15P', 'x', 'x')").run();
  const held = await saveEstimate({ upid: 'up-t15p' });
  assert.deepEqual([held.status, held.body.error, held.body.projectId], [409, 'upid_taken', 'prj_t15p']);
  db.prepare("DELETE FROM projects WHERE id = 'prj_t15p'").run();

  // Any number of new drafts may have no UPID yet; none of them waits for the fix-up.
  const b = await saveEstimate({ upid: '' });
  const c = await saveEstimate({ upid: '   ' });
  for (const r of [b, c]) {
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.estimate.upid, projectRow(r.body.estimate.projectId).upid,
      projectRow(r.body.estimate.projectId).needs_upid], ['', null, 0]);
  }
  assert.notEqual(b.body.estimate.projectId, c.body.estimate.projectId);

  // Renaming moves the project's UPID; the old one is then free.
  const renamed = await saveEstimate({ upid: 'UP-T15B' }, est.id);
  assert.equal(renamed.status, 200);
  assert.deepEqual([renamed.body.estimate.upid, renamed.body.estimate.projectId, projectRow(est.projectId).upid],
    ['UP-T15B', est.projectId, 'UP-T15B']);
  assert.equal((await saveEstimate({ upid: 'UP-T15B' }, b.body.estimate.id)).body.error, 'upid_taken');
  const freed = await saveEstimate({ upid: 'UP-T15A' }, b.body.estimate.id);
  assert.equal(freed.status, 200);
  // Saving with its own UPID is not a clash.
  assert.equal((await saveEstimate({ upid: 'up-t15a' }, b.body.estimate.id)).status, 200);
  assert.equal(projectRow(b.body.estimate.projectId).upid, 'up-t15a');

  // The project follows the estimate's client.
  db.prepare("INSERT OR IGNORE INTO clients (id, business_name, created_at, updated_at) VALUES ('cl_t15', 'T15 Pty Ltd', 'x', 'x')").run();
  await saveEstimate({ upid: 'UP-T15B', clientId: 'cl_t15' }, est.id);
  assert.equal(projectRow(est.projectId).client_id, 'cl_t15');

  await dropEstimates(est.id, b.body.estimate.id, c.body.estimate.id);
});

test('projects: an estimate save never moves its status', async () => {
  const a = await saveEstimate({ status: 'accepted' });
  assert.equal(a.body.estimate.status, 'draft');
  db.prepare("UPDATE estimates SET status = 'sent' WHERE id = ?").run(a.body.estimate.id);
  const saved = await saveEstimate({ upid: a.body.estimate.upid, status: 'draft' }, a.body.estimate.id);
  assert.equal(saved.body.estimate.status, 'sent');
  const omitted = await saveEstimate({ upid: a.body.estimate.upid }, a.body.estimate.id);
  assert.equal(omitted.body.estimate.status, 'sent');
  await dropEstimates(a.body.estimate.id);
});

test('projects: a duplicate is a new project with no UPID; deleting the last estimate deletes its project', async () => {
  const a = await saveEstimate({ upid: 'UP-T15D', docType: 'invoice', invoiceNumber: 'INV-9' });
  const dup = await api(`/api/estimates/${a.body.estimate.id}/duplicate`, { method: 'POST' }).then((r) => r.json());
  assert.deepEqual([dup.estimate.upid, dup.estimate.status, dup.estimate.docType, dup.estimate.invoiceNumber],
    ['', 'draft', 'estimate', '']);
  assert.notEqual(dup.estimate.projectId, a.body.estimate.projectId);
  assert.deepEqual([projectRow(dup.estimate.projectId).upid, projectRow(dup.estimate.projectId).needs_upid], [null, 0]);

  // A project the fix-up kept together: renaming one estimate renames them all,
  // and it loses its project only with its last estimate.
  db.prepare('UPDATE estimates SET project_id = ? WHERE id = ?').run(a.body.estimate.projectId, dup.estimate.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(dup.estimate.projectId);
  assert.equal((await saveEstimate({ upid: 'UP-T15E' }, a.body.estimate.id)).status, 200);
  assert.equal(db.prepare('SELECT upid FROM estimates WHERE id = ?').get(dup.estimate.id).upid, 'UP-T15E');
  await dropEstimates(dup.estimate.id);
  assert.ok(projectRow(a.body.estimate.projectId), 'still has an estimate');
  await dropEstimates(a.body.estimate.id);
  assert.equal(projectRow(a.body.estimate.projectId), undefined);
});

test('projects: one waiting for the fix-up saves with its shared UPID, and settles on a free one', async () => {
  const a = await saveEstimate({});
  const b = await saveEstimate({});
  // As v13 leaves two estimates that shared a UPID.
  for (const e of [a, b]) {
    db.prepare("UPDATE estimates SET upid = 'UP-SHARED' WHERE id = ?").run(e.body.estimate.id);
    db.prepare('UPDATE projects SET upid = NULL, needs_upid = 1 WHERE id = ?').run(e.body.estimate.projectId);
  }
  const pa = a.body.estimate.projectId;

  const same = await saveEstimate({ upid: ' up-shared ' }, a.body.estimate.id);
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal(same.body.estimate.upid, 'UP-SHARED');
  assert.deepEqual([projectRow(pa).upid, projectRow(pa).needs_upid], [null, 1]);

  // Nobody else can take a UPID a waiting group still carries.
  assert.equal((await saveEstimate({ upid: 'UP-SHARED' })).body.error, 'upid_taken');

  const settled = await saveEstimate({ upid: 'UP-T15S' }, a.body.estimate.id);
  assert.equal(settled.status, 200);
  assert.deepEqual([projectRow(pa).upid, projectRow(pa).needs_upid], ['UP-T15S', 0]);
  assert.equal(projectRow(b.body.estimate.projectId).needs_upid, 1);
  await dropEstimates(a.body.estimate.id, b.body.estimate.id);
});

test('projects: a declined estimate\'s days and rentals leave the calendar and lock nothing', async () => {
  assert.equal((await api('/api/pricing/reset', { method: 'POST' })).status, 200);
  const a = await saveEstimate({
    activeRows: { prod: [capture('t15_a')], equip: [{ vendor: 'Lensworks', item: 'Kit', days: 1, cost: 100 }] },
    days: [pbDay('t15_a', '2026-11-03', 'confirmed')],
    rentals: [rental('t15_rn', 'Lensworks', { outDate: '2026-11-02' })],
  });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const range = '/api/calendar?from=2026-11-01&to=2026-11-30';
  const mine = (cal) => [cal.days.filter((d) => d.estimateId === a.body.estimate.id).length,
    cal.rentals.filter((r) => r.estimateId === a.body.estimate.id).length];
  assert.deepEqual(mine(await api(range).then((r) => r.json())), [1, 1]);
  const locked = await saveEstimate({ activeRows: { prod: [capture('t15_b')] }, days: [pbDay('t15_b', '2026-11-03', 'confirmed')] });
  assert.equal(locked.body.error, 'date_locked');

  db.prepare("UPDATE estimates SET status = 'declined' WHERE id = ?").run(a.body.estimate.id);
  assert.deepEqual(mine(await api(range).then((r) => r.json())), [0, 0]);
  const b = await saveEstimate({ activeRows: { prod: [capture('t15_b')] }, days: [pbDay('t15_b', '2026-11-03', 'confirmed')] });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  await dropEstimates(a.body.estimate.id, b.body.estimate.id);
});

/* ── The UPID fix-up (task 16) ─────────────────────────────────────────── */
/* As v13 leaves an estimate whose UPID was shared or blank: its own project,
   with no UPID and waiting, and the old UPID kept on the estimate. */
function makeWaiting(estimate, oldUpid) {
  db.prepare('UPDATE estimates SET upid = ? WHERE id = ?').run(oldUpid, estimate.id);
  db.prepare('UPDATE projects SET upid = NULL, needs_upid = 1 WHERE id = ?').run(estimate.projectId);
}
const fixups = () => api('/api/setup/upids').then((r) => r.json());
const fixUp = (body) => api('/api/setup/upids', { method: 'POST', body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const groupOf = (listing, key) => listing.groups.find((g) => g.key === key);

test('setup: waiting estimates are grouped by their old UPID, a blank one alone, and the list counts them', async () => {
  const made = [];
  for (const [upid, date] of [['T16-G1', '2026-01-02'], [' t16-g1 ', '2026-01-01'], ['', ''], ['', ''], ['T16-LONE', '']]) {
    const r = await saveEstimate({ name: 'G ' + made.length, date });
    makeWaiting(r.body.estimate, upid);
    made.push(r.body.estimate);
  }
  const listing = await fixups();
  const shared = groupOf(listing, 'u:t16-g1');
  assert.deepEqual(shared.estimates.map((e) => e.id), [made[0].id, made[1].id], 'oldest first');
  assert.deepEqual([shared.upid, shared.canKeepTogether, shared.clientsDiffer], ['T16-G1', true, false]);
  assert.equal(typeof shared.estimates[0].totalIncGst, 'number');
  for (const blank of [made[2], made[3]]) {
    const g = groupOf(listing, 'e:' + blank.id);
    assert.deepEqual([g.upid, g.estimates.length, g.canKeepTogether], ['', 1, false]);
  }
  assert.equal(groupOf(listing, 'u:t16-lone').canKeepTogether, false);
  // Named groups first, blank ones after.
  const keys = listing.groups.map((g) => g.key);
  assert.ok(keys.indexOf('u:t16-lone') < keys.indexOf('e:' + made[2].id));
  assert.ok(listing.remaining >= 5);
  const list = await api('/api/estimates').then((r) => r.json());
  assert.equal(list.needsUpid, listing.remaining);
  await dropEstimates(...made.map((e) => e.id));
});

test('setup: assigning gives each estimate in the group its own UPID, one of them may keep the shared one', async () => {
  const a = (await saveEstimate({ name: 'A' })).body.estimate;
  const b = (await saveEstimate({ name: 'B' })).body.estimate;
  const other = (await saveEstimate({ name: 'Other job', upid: 'T16-HELD' })).body.estimate;
  const waiting = (await saveEstimate({ name: 'W' })).body.estimate;
  makeWaiting(a, 'T16-S');
  makeWaiting(b, 't16-s');
  makeWaiting(waiting, 'T16-ELSEWHERE');
  const key = 'u:t16-s';
  const send = (ua, ub) => fixUp({ key, upids: [{ estimateId: a.id, upid: ua }, { estimateId: b.id, upid: ub }] });

  // The whole group, as it stands, or nothing.
  assert.deepEqual([(await fixUp({ key, upids: [{ estimateId: a.id, upid: 'X' }] })).body.error], ['group_changed']);
  assert.equal((await fixUp({ key: 'u:no-such', upids: [] })).body.error, 'group_changed');
  assert.equal((await fixUp({ key, upids: [{ estimateId: a.id, upid: 'X1' }, { estimateId: b.id, upid: 'X2' },
    { estimateId: waiting.id, upid: 'X3' }] })).body.error, 'group_changed', 'an estimate from another group');
  assert.deepEqual((await send('T16-A', '  ')).body, { error: 'upid_required', estimateId: b.id });
  const repeated = await send('T16-SAME', ' t16-same ');
  assert.deepEqual([repeated.status, repeated.body.error, repeated.body.estimateIds], [400, 'upid_repeated', [a.id, b.id]]);
  const held = await send('T16-A', 't16-held');
  assert.deepEqual([held.status, held.body.error, held.body.estimateId, held.body.projectId, held.body.projectName],
    [409, 'upid_taken', b.id, other.projectId, 'Other job']);
  // Another group still waiting carries its UPID too.
  assert.equal((await send('T16-A', 'T16-ELSEWHERE')).body.error, 'upid_taken');
  assert.equal(projectRow(a.projectId).needs_upid, 1, 'a refusal writes nothing');

  const done = await send(' T16-S ', 'T16-S2');
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(groupOf(done.body, key), undefined);
  assert.deepEqual([projectRow(a.projectId).upid, projectRow(a.projectId).needs_upid], ['T16-S', 0]);
  assert.deepEqual([projectRow(b.projectId).upid, projectRow(b.projectId).needs_upid], ['T16-S2', 0]);
  const read = (id) => api(`/api/estimates/${id}`).then((r) => r.json()).then((r) => r.estimate.upid);
  assert.deepEqual([await read(a.id), await read(b.id)], ['T16-S', 'T16-S2']);
  // Settled: an editor save now treats them as any other project.
  assert.equal((await saveEstimate({ upid: 'T16-S' }, b.id)).body.error, 'upid_taken');

  // A blank one alone takes a UPID the same way.
  const blank = (await saveEstimate({ name: 'Blank' })).body.estimate;
  makeWaiting(blank, '');
  const settled = await fixUp({ key: 'e:' + blank.id, upids: [{ estimateId: blank.id, upid: 'T16-B' }] });
  assert.equal(settled.status, 200);
  assert.equal(projectRow(blank.projectId).upid, 'T16-B');
  await dropEstimates(a.id, b.id, other.id, waiting.id, blank.id);
});

test('setup: keep together makes one project under the shared UPID, invoices and activity moved', async () => {
  db.prepare("INSERT OR IGNORE INTO clients (id, business_name, created_at, updated_at) VALUES ('cl_t16a', 'T16 A', 'x', 'x')").run();
  db.prepare("INSERT OR IGNORE INTO clients (id, business_name, created_at, updated_at) VALUES ('cl_t16b', 'T16 B', 'x', 'x')").run();
  const old = (await saveEstimate({ name: 'Old', clientId: 'cl_t16a' })).body.estimate;
  const newer = (await saveEstimate({ name: 'Newer' })).body.estimate;
  db.prepare("UPDATE estimates SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(old.id);
  makeWaiting(old, 'T16-Keep');
  makeWaiting(newer, ' t16-keep');
  db.prepare("UPDATE projects SET accepted_at = '2025-05-05' WHERE id = ?").run(newer.projectId);
  db.prepare("INSERT INTO invoices (id, project_id, estimate_id, kind, number, created_at, updated_at) VALUES ('inv_t16', ?, ?, 'legacy', 'INV-1', 'x', 'x')")
    .run(newer.projectId, newer.id);
  db.prepare("INSERT INTO activity (id, project_id, at, kind) VALUES ('act_t16', ?, 'x', 'note')").run(newer.projectId);

  // A blank group, or one estimate, has nothing to keep together.
  const lone = (await saveEstimate({ name: 'Lone' })).body.estimate;
  makeWaiting(lone, '');
  assert.equal((await fixUp({ key: 'e:' + lone.id, keepTogether: true })).body.error, 'nothing_to_keep');

  // Two clients are two projects (D31).
  db.prepare("UPDATE estimates SET client_id = 'cl_t16b' WHERE id = ?").run(newer.id);
  assert.equal(groupOf(await fixups(), 'u:t16-keep').clientsDiffer, true);
  assert.equal((await fixUp({ key: 'u:t16-keep', keepTogether: true })).body.error, 'clients_differ');
  // An unlinked one goes along with the linked one.
  db.prepare('UPDATE estimates SET client_id = NULL WHERE id = ?').run(newer.id);

  const kept = await fixUp({ key: 'u:t16-keep', keepTogether: true });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(groupOf(kept.body, 'u:t16-keep'), undefined);
  const p = projectRow(old.projectId);
  assert.deepEqual([p.upid, p.needs_upid, p.client_id, p.accepted_at], ['T16-Keep', 0, 'cl_t16a', '2025-05-05']);
  assert.equal(projectRow(newer.projectId), undefined, 'the emptied project is gone');
  const est = db.prepare('SELECT project_id, upid FROM estimates WHERE id IN (?, ?) ORDER BY id').all(old.id, newer.id);
  assert.deepEqual(est.map((e) => [e.project_id, e.upid]), [[old.projectId, 'T16-Keep'], [old.projectId, 'T16-Keep']]);
  assert.equal(db.prepare("SELECT project_id FROM invoices WHERE id = 'inv_t16'").get().project_id, old.projectId);
  assert.equal(db.prepare("SELECT project_id FROM activity WHERE id = 'act_t16'").get().project_id, old.projectId);
  // The kept-together project saves from the editor with its UPID, as one project.
  assert.equal((await saveEstimate({ upid: 'T16-Keep' }, newer.id)).status, 200);

  await dropEstimates(old.id, newer.id, lone.id);
  assert.equal(projectRow(old.projectId), undefined);
});

// ── The Projects list (task 17) ───────────────────────────────────────────

const { projectStage } = require('../src/projects');

test('projects: the stage and step a project is at, from its estimates and invoices', () => {
  const inv = (kind, status, extra) => ({ kind, status, number: 'N-' + kind, ...extra });
  const at = (project, estimates, invoices, sent) => {
    const s = projectStage(project, estimates, invoices, sent);
    return s.stage + '/' + s.step;
  };
  const p = {};
  assert.equal(at(p, [{ status: 'draft' }], []), 'draft/draft');
  assert.equal(at(p, [{ status: 'draft' }, { status: 'sent' }], []), 'sent/sent');
  assert.deepEqual(projectStage(p, [{ status: 'sent' }], [], { at: '2026-10-01T00:00:00Z', version: 2, validUntil: '2026-10-31' }),
    { stage: 'sent', step: 'sent', at: '2026-10-01T00:00:00Z', version: 2, validUntil: '2026-10-31' });
  assert.equal(projectStage(p, [{ status: 'sent' }], [], { version: 'x' }).version, null);
  assert.equal(at(p, [{ status: 'accepted' }], []), 'accepted/accepted');
  assert.equal(at({ accepted_at: '2026-10-01' }, [{ status: 'sent' }], []), 'accepted/accepted');
  // Declined wins over everything, invoices included.
  assert.equal(at({ declined_at: '2026-10-02', accepted_at: 'x' }, [{ status: 'accepted' }], [inv('deposit', 'paid')]), 'declined/declined');

  // A pair, step by step.
  assert.equal(at(p, [], [inv('deposit', 'draft'), inv('final', 'draft')]), 'accepted/deposit_draft');
  assert.equal(at(p, [], [inv('deposit', 'scheduled'), inv('final', 'draft')]), 'accepted/deposit_scheduled');
  assert.deepEqual(projectStage(p, [], [inv('deposit', 'sent', { due_at: '2026-10-09' }), inv('final', 'draft')]),
    { stage: 'invoiced', step: 'deposit_sent', number: 'N-deposit', dueAt: '2026-10-09' });
  assert.equal(at(p, [], [inv('final', 'draft'), inv('deposit', 'paid')]), 'invoiced/deposit_paid');
  assert.equal(at(p, [], [inv('deposit', 'paid'), inv('final', 'scheduled')]), 'invoiced/final_scheduled');
  assert.equal(at(p, [], [inv('deposit', 'paid'), inv('final', 'sent')]), 'invoiced/final_sent');
  // The deposit comes first while it's unpaid, whatever the final says.
  assert.equal(at(p, [], [inv('final', 'sent'), inv('deposit', 'sent')]), 'invoiced/deposit_sent');
  assert.deepEqual(projectStage(p, [], [inv('deposit', 'paid', { paid_at: '2026-10-01' }), inv('final', 'paid', { paid_at: '2026-11-02' })]),
    { stage: 'paid', step: 'paid', at: '2026-11-02' });
  // A single invoice; a void one is ignored.
  assert.equal(at(p, [], [inv('single', 'draft')]), 'accepted/single_draft');
  assert.equal(at(p, [], [inv('single', 'scheduled')]), 'accepted/single_scheduled');
  assert.equal(at(p, [], [inv('single', 'sent'), inv('deposit', 'void')]), 'invoiced/single_sent');
  assert.equal(at(p, [{ status: 'accepted' }], [inv('single', 'void')]), 'accepted/accepted');
  // A final with no deposit at all, not yet sent.
  assert.equal(at(p, [], [inv('final', 'draft')]), 'accepted/final_draft');
  // Legacy: invoiced until paid, never "not sent".
  assert.deepEqual(projectStage(p, [{ status: 'accepted' }], [inv('legacy', 'draft')]),
    { stage: 'invoiced', step: 'legacy', number: 'N-legacy' });
  assert.equal(at(p, [], [inv('legacy', 'paid')]), 'paid/paid');
  assert.equal(projectStage(p, [], [inv('legacy', 'paid')]).at, null);
});

const listProjects = (query) => api('/api/projects?' + new URLSearchParams(query)).then(async (r) => ({ status: r.status, body: await r.json() }));

test('projects list: one card per project, searched, filtered by stage and counted', async () => {
  const today = '2026-10-04';
  const mk = async (name, upid, extra) => (await saveEstimate({ name: 'T17 ' + name, upid, ...extra })).body.estimate;
  const draft = await mk('Draft', 'T17-DRAFT', {
    date: '2026-10-01',
    days: [
      { id: 'd_t17_past', date: '2026-09-30', status: 'confirmed' },
      { id: 'd_t17_b', date: '2026-10-20', status: 'pencilled' },
      { id: 'd_t17_a', date: '2026-10-06', status: 'proposed' },
      { id: 'd_t17_tbc', date: null, status: 'proposed' },
    ],
  });
  const sent = await mk('Sent', 'T17-SENT');
  db.prepare("UPDATE estimates SET status = 'sent' WHERE id = ?").run(sent.id);
  db.prepare("INSERT INTO activity (id, project_id, at, kind, detail_json) VALUES ('act_t17s', ?, '2026-10-02T01:00:00.000Z', 'sent', ?)")
    .run(sent.projectId, JSON.stringify({ version: 2, validUntil: '2026-11-01' }));
  const paidOld = await mk('Paid long ago', 'T17-PAIDOLD');
  db.prepare("INSERT INTO invoices (id, project_id, kind, number, status, paid_at, created_at, updated_at) VALUES ('inv_t17o', ?, 'single', 'INV-T17-PAIDOLD', 'paid', '2026-06-01', '2026-06-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')")
    .run(paidOld.projectId);
  const paidNew = await mk('Paid lately', 'T17-PAIDNEW');
  db.prepare("INSERT INTO invoices (id, project_id, kind, number, status, paid_at, created_at, updated_at) VALUES ('inv_t17n', ?, 'single', 'INV-T17-PAIDNEW', 'paid', '2026-09-01', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')")
    .run(paidNew.projectId);
  const declined = await mk('Declined', 'T17-DECL', { days: [{ id: 'd_t17_decl', date: '2026-10-05', status: 'confirmed' }] });
  db.prepare("UPDATE estimates SET status = 'declined' WHERE id = ?").run(declined.id);
  db.prepare("UPDATE projects SET declined_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(declined.projectId);

  // Active: the old paid and the old declined ones are left out — unless searched for.
  // Paid when it was paid, not when the invoice was last touched.
  const active = await listProjects({ today });
  assert.equal(active.status, 200);
  const ids = (reply) => reply.body.projects.map((p) => p.id);
  assert.ok(!ids(active).includes(paidOld.projectId));
  assert.ok(!ids(active).includes(declined.projectId));
  assert.ok(ids(active).includes(paidNew.projectId));

  const found = await listProjects({ today, q: 't17' });
  assert.deepEqual(new Set(ids(found)),
    new Set([draft, sent, paidOld, paidNew, declined].map((e) => e.projectId)));
  assert.deepEqual(found.body.counts,
    { active: 5, all: 5, draft: 1, sent: 1, accepted: 0, invoiced: 0, paid: 2, declined: 1 });
  assert.equal(found.body.total, 5);
  // Newest activity first, activity rows included: a later note puts the draft on top.
  db.prepare("INSERT INTO activity (id, project_id, at, kind) VALUES ('act_t17n', ?, '2099-01-01T00:00:00.000Z', 'note')")
    .run(draft.projectId);
  const reordered = await listProjects({ today, q: 't17' });
  assert.equal(ids(reordered)[0], draft.projectId);
  assert.equal(reordered.body.projects[0].lastActivityAt, '2099-01-01T00:00:00.000Z');
  const times = reordered.body.projects.map((p) => p.lastActivityAt);
  assert.deepEqual(times, times.slice().sort().reverse());

  // What a card shows.
  const card = (reply, est) => reply.body.projects.find((p) => p.id === est.projectId);
  const d = card(found, draft);
  assert.deepEqual(
    [d.upid, d.needsUpid, d.name, d.stage, d.stageDetail, d.estimateId, d.estimateCount, d.nextDay],
    ['T17-DRAFT', false, 'T17 Draft', 'draft', { step: 'draft' }, draft.id, 1, { date: '2026-10-06', status: 'proposed' }]);
  assert.equal(typeof d.totalIncGst, 'number');
  assert.deepEqual(card(found, sent).stageDetail,
    { step: 'sent', at: '2026-10-02T01:00:00.000Z', version: 2, validUntil: '2026-11-01' });
  assert.equal(card(found, declined).nextDay, null, 'a declined project has no next day');
  assert.equal(card(found, paidNew).stageDetail.at, '2026-09-01');

  // By stage, by UPID, by name, by client; a search ignores case and finds old ones.
  assert.deepEqual(ids(await listProjects({ today, q: 't17', stage: 'paid' })).sort(),
    [paidOld.projectId, paidNew.projectId].sort());
  assert.deepEqual(ids(await listProjects({ today, stage: 'declined', q: 'T17' })), [declined.projectId]);
  assert.deepEqual(ids(await listProjects({ today, stage: 'draft', q: 'T17' })), [draft.projectId]);
  assert.deepEqual(ids(await listProjects({ today, q: 'T17-paidOLD' })), [paidOld.projectId]);
  assert.deepEqual(ids(await listProjects({ today, q: 'paid lately' })), [paidNew.projectId]);
  db.prepare("INSERT OR IGNORE INTO clients (id, business_name, contact_name, created_at, updated_at) VALUES ('cl_t17', 'Seventeen Pty', 'Sam', 'x', 'x')").run();
  await saveEstimate({ name: 'T17 Sent', upid: 'T17-SENT', clientId: 'cl_t17', client: { businessName: 'Seventeen Pty' } }, sent.id);
  assert.deepEqual(ids(await listProjects({ today, q: 'seventeen' })), [sent.projectId]);
  assert.deepEqual(ids(await listProjects({ today, q: 'sam' })), [sent.projectId], 'the linked client\'s contact');
  // A client's projects, every stage.
  const mine = await listProjects({ today, client: 'cl_t17', stage: 'all' });
  assert.deepEqual(ids(mine), [sent.projectId]);
  assert.equal(mine.body.projects[0].client.businessName, 'Seventeen Pty');
  assert.equal(mine.body.projects[0].client.id, 'cl_t17');

  // Show more: pages of `limit`, each picking up where the last stopped.
  const first = await listProjects({ today, q: 't17', limit: 2 });
  assert.equal(first.body.projects.length, 2);
  const second = await listProjects({ today, q: 't17', limit: 2, before: first.body.next });
  const third = await listProjects({ today, q: 't17', limit: 2, before: second.body.next });
  assert.equal(third.body.next, null);
  assert.deepEqual([...ids(first), ...ids(second), ...ids(third)], ids(await listProjects({ today, q: 't17' })));
  // A last page that is exactly full has nothing after it.
  assert.equal((await listProjects({ today, q: 't17', limit: 5 })).body.next, null);

  // Refused.
  for (const [query, error] of [
    [{ stage: 'expired' }, 'stage_invalid'], [{ today: '2026-02-30' }, 'today_invalid'],
    [{ limit: 0 }, 'limit_invalid'], [{ limit: 201 }, 'limit_invalid'], [{ limit: '1.5' }, 'limit_invalid'],
    [{ before: 'nope' }, 'before_invalid'],
  ]) {
    const r = await listProjects(query);
    assert.deepEqual([r.status, r.body.error], [400, error], JSON.stringify(query));
  }

  await dropEstimates(draft.id, sent.id, paidOld.id, paidNew.id, declined.id);
});

test('projects list: a kept-together project is one card, named and totalled by its latest live estimate', async () => {
  const a = (await saveEstimate({ name: 'T17 Older', upid: 'T17-KEEP' })).body.estimate;
  const b = (await saveEstimate({ name: 'T17 Newer', upid: 'T17-KEEP2' })).body.estimate;
  db.prepare('UPDATE estimates SET project_id = ?, upid = ? WHERE id = ?').run(a.projectId, 'T17-KEEP', b.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(b.projectId);
  db.prepare("UPDATE estimates SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?").run(b.id);
  let list = await listProjects({ q: 't17-keep' });
  assert.deepEqual(list.body.projects.map((p) => [p.id, p.name, p.estimateId, p.estimateCount, p.lastActivityAt]),
    [[a.projectId, 'T17 Newer', b.id, 2, '2030-01-01T00:00:00.000Z']]);
  // A declined estimate is never the lead while a live one is there.
  db.prepare("UPDATE estimates SET status = 'declined' WHERE id = ?").run(b.id);
  list = await listProjects({ q: 't17-keep' });
  assert.equal(list.body.projects[0].estimateId, a.id);
  // A waiting project is found by the UPID its estimate still carries.
  makeWaiting(a, 'T17-OLDSHARED');
  list = await listProjects({ q: 't17-oldshared' });
  assert.deepEqual(list.body.projects.map((p) => [p.id, p.upid, p.needsUpid]), [[a.projectId, null, true]]);
  assert.ok(list.body.needsUpid >= 1);
  await dropEstimates(a.id, b.id);
});

/* ── The project folder (task 18) ──────────────────────────────────────── */
const T18_TODAY = '2026-10-04';
const folderOf = (id, today) => api(`/api/projects/${id}?today=${today || T18_TODAY}`)
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const act = (id, action, body) => api(`/api/projects/${id}/${action}?today=${T18_TODAY}`, {
  method: 'POST',
  body: JSON.stringify(body || {}),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('project folder: the card the list shows, each estimate whole, invoices, and activity newest first', async () => {
  const est = (await saveEstimate({
    name: 'T18 Folder', upid: 'T18-FOLD',
    activeRows: { prod: [capture('d_t18_f1')] },
    days: [pbDay('d_t18_f1', '2026-10-09', 'pencilled'), pbDay('d_t18_ftbc', null, 'proposed')],
  })).body.estimate;
  db.prepare("INSERT INTO invoices (id, project_id, estimate_id, kind, number, status, totals_json, created_at, updated_at) VALUES ('inv_t18f', ?, ?, 'legacy', 'INV-OLD-7', 'sent', '{\"totalIncGst\":1232}', 'x', 'x')")
    .run(est.projectId, est.id);
  db.prepare("INSERT INTO activity (id, project_id, at, kind, detail_json) VALUES ('act_t18a', ?, '2026-10-01T00:00:00.000Z', 'note', '{}'), ('act_t18b', ?, '2026-10-02T00:00:00.000Z', 'note', '{\"x\":1}')")
    .run(est.projectId, est.projectId);

  const f = await folderOf(est.projectId);
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const card = (await listProjects({ q: 't18-fold', today: T18_TODAY })).body.projects[0];
  // One summary for the list, the client and the folder: the folder's adds to it, never differs.
  for (const key of Object.keys(card)) assert.deepEqual(f.body.project[key], card[key], key);
  assert.deepEqual([f.body.project.stage, f.body.project.stageDetail.step, f.body.project.nextDay],
    ['invoiced', 'legacy', { date: '2026-10-09', status: 'pencilled' }]);
  assert.deepEqual([f.body.project.declinedAt, f.body.project.acceptedAt], [null, null]);
  assert.deepEqual(f.body.estimates.map((e) => [e.id, e.days.length]), [[est.id, 2]]);
  assert.deepEqual(f.body.invoices.map((i) => [i.id, i.kind, i.number, i.status, i.estimateId, i.amountDue]),
    [['inv_t18f', 'legacy', 'INV-OLD-7', 'sent', est.id, 1232]]);
  assert.deepEqual(f.body.activity.map((a) => [a.id, a.detail]), [['act_t18b', { x: 1 }], ['act_t18a', {}]]);

  assert.equal((await folderOf('prj_nope')).status, 404);
  assert.equal((await folderOf(est.projectId, '2026-13-01')).body.error, 'today_invalid');
  await dropEstimates(est.id);
});

test('project folder: Mark sent records the valid-until the stage line reads, and only a draft or sent project can', async () => {
  const est = (await saveEstimate({ name: 'T18 Send', upid: 'T18-SEND' })).body.estimate;
  assert.equal((await act(est.projectId, 'sent', {})).body.error, 'valid_until_invalid');
  assert.equal((await act(est.projectId, 'sent', { validUntil: '2026-02-30' })).body.error, 'valid_until_invalid');

  const sent = await act(est.projectId, 'sent', { validUntil: '2026-11-03' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.estimates[0].status, 'sent');
  assert.deepEqual([sent.body.project.stage, sent.body.project.stageDetail.validUntil, sent.body.project.stageDetail.version],
    ['sent', '2026-11-03', 1]);
  assert.deepEqual([sent.body.activity[0].kind, sent.body.activity[0].detail], ['sent', { validUntil: '2026-11-03', estimateId: est.id, version: 1 }]);
  // Sent again after changes: the latest send is the one the line reads, on the list too.
  const again = await act(est.projectId, 'sent', { validUntil: '2026-11-20' });
  assert.equal(again.body.project.stageDetail.validUntil, '2026-11-20');
  assert.equal((await listProjects({ q: 't18-send' })).body.projects[0].stageDetail.validUntil, '2026-11-20');

  db.prepare("UPDATE projects SET accepted_at = 'x' WHERE id = ?").run(est.projectId);
  assert.deepEqual([(await act(est.projectId, 'sent', { validUntil: '2026-11-20' })).status,
    (await act(est.projectId, 'sent', { validUntil: '2026-11-20' })).body.error], [409, 'project_accepted']);
  db.prepare('UPDATE projects SET accepted_at = NULL WHERE id = ?').run(est.projectId);
  await act(est.projectId, 'decline');
  assert.equal((await act(est.projectId, 'sent', { validUntil: '2026-11-20' })).body.error, 'project_declined');
  assert.equal((await act('prj_nope', 'sent', { validUntil: '2026-11-20' })).status, 404);
  await dropEstimates(est.id);
});

test('project folder: Decline takes the days off every calendar; Reopen puts them back through the clash check', async () => {
  const range = '/api/calendar?from=2026-11-01&to=2026-11-30';
  const mine = async (id) => (await api(range).then((r) => r.json())).days.filter((d) => d.estimateId === id);
  const a = (await saveEstimate({
    name: 'T18 Decline', upid: 'T18-DECL',
    activeRows: { prod: [capture('d_t18_d1'), capture('d_t18_d2'), capture('d_t18_d3')] },
    days: [pbDay('d_t18_d1', '2026-11-10', 'confirmed'), pbDay('d_t18_d2', '2026-11-11', 'pencilled'),
      pbDay('d_t18_d3', '2026-11-12', 'proposed')],
  })).body.estimate;
  assert.equal((await mine(a.id)).length, 3);
  assert.equal((await mine(a.id))[0].projectId, a.projectId);

  const declined = await act(a.projectId, 'decline');
  assert.equal(declined.status, 200, JSON.stringify(declined.body));
  assert.deepEqual([declined.body.project.stage, declined.body.estimates[0].status, declined.body.activity[0].kind],
    ['declined', 'declined', 'declined']);
  assert.ok(declined.body.project.declinedAt);
  assert.equal((await mine(a.id)).length, 0);
  // A second decline changes nothing.
  const twice = await act(a.projectId, 'decline');
  assert.deepEqual([twice.status, twice.body.project.declinedAt, twice.body.activity.length],
    [200, declined.body.project.declinedAt, 1]);

  // Meanwhile another project confirms two of its dates and pencils the third.
  const b = (await saveEstimate({
    name: 'T18 Taker', upid: 'T18-TAKE',
    activeRows: { prod: [capture('d_t18_b1'), capture('d_t18_b2'), capture('d_t18_b3')] },
    days: [pbDay('d_t18_b1', '2026-11-10', 'confirmed'), pbDay('d_t18_b2', '2026-11-11', 'confirmed'),
      pbDay('d_t18_b3', '2026-11-12', 'pencilled')],
  })).body.estimate;
  const refused = await act(a.projectId, 'reopen');
  assert.deepEqual([refused.status, refused.body.error], [409, 'date_locked']);
  assert.deepEqual(refused.body.clashes.map((c) => [c.date, c.upid]), [['2026-11-10', 'T18-TAKE'], ['2026-11-11', 'T18-TAKE']]);
  assert.match(refused.body.message, /2026-11-10 is now confirmed for T18-TAKE \(and 1 more date\)/);
  assert.equal((await folderOf(a.projectId)).body.project.stage, 'declined');

  // A specification note on each clashing day is the override (D16); the
  // pencilled date is only named.
  db.prepare("UPDATE production_days SET override_note = 'Second shooter' WHERE id IN ('d_t18_d1', 'd_t18_d2')").run();
  const reopened = await act(a.projectId, 'reopen');
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.deepEqual(reopened.body.pencilled.map((c) => [c.date, c.upid]), [['2026-11-12', 'T18-TAKE']]);
  assert.deepEqual([reopened.body.project.stage, reopened.body.estimates[0].status, reopened.body.project.declinedAt,
    reopened.body.activity[0].kind], ['draft', 'draft', null, 'reopened']);
  assert.equal((await mine(a.id)).length, 3);
  assert.equal((await act(a.projectId, 'reopen')).body.error, 'not_declined');

  // An invoice means the job went ahead: no declining it.
  db.prepare("INSERT INTO invoices (id, project_id, kind, number, status, created_at, updated_at) VALUES ('inv_t18d', ?, 'deposit', 'INV-T18-DECL-D', 'draft', 'x', 'x')")
    .run(a.projectId);
  assert.deepEqual([(await act(a.projectId, 'decline')).status, (await act(a.projectId, 'decline')).body.error],
    [409, 'has_invoices']);
  db.prepare("UPDATE invoices SET status = 'void' WHERE id = 'inv_t18d'").run();
  assert.equal((await act(a.projectId, 'decline')).status, 200);
  await dropEstimates(a.id, b.id);
});

test('project folder: Delete takes everything in the project, unless an invoice has gone out', async () => {
  const est = (await saveEstimate({
    name: 'T18 Delete', upid: 'T18-DEL',
    activeRows: { prod: [capture('d_t18_x')] },
    days: [pbDay('d_t18_x', '2026-12-01', 'pencilled')],
  })).body.estimate;
  await act(est.projectId, 'sent', { validUntil: '2026-12-01' });
  db.prepare("INSERT INTO invoices (id, project_id, estimate_id, kind, number, status, created_at, updated_at) VALUES ('inv_t18x', ?, ?, 'legacy', 'INV-OLD', 'paid', 'x', 'x'), ('inv_t18y', ?, NULL, 'single', 'INV-T18-DEL', 'sent', 'x', 'x')")
    .run(est.projectId, est.id, est.projectId);
  const del = () => api(`/api/projects/${est.projectId}`, { method: 'DELETE' }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const refused = await del();
  assert.deepEqual([refused.status, refused.body.error], [409, 'has_sent_invoices']);
  assert.match(refused.body.message, /INV-T18-DEL/);

  // A made-the-old-way invoice goes with it, as deleting its estimate always took it.
  db.prepare("DELETE FROM invoices WHERE id = 'inv_t18y'").run();
  assert.equal((await del()).status, 200);
  const left = (table, col) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`);
  assert.deepEqual([projectRow(est.projectId), left('estimates', 'project_id').get(est.projectId).n,
    left('production_days', 'estimate_id').get(est.id).n, left('invoices', 'project_id').get(est.projectId).n,
    left('activity', 'project_id').get(est.projectId).n], [undefined, 0, 0, 0, 0]);
  assert.equal((await del()).status, 404);
});

test('estimates: the retired doc type and invoice number are never written (D62), and an old row keeps its own', async () => {
  const made = await saveEstimate({ upid: 'T18-DOC', docType: 'invoice', invoiceNumber: 'INV-NEW' });
  assert.deepEqual([made.body.estimate.docType, made.body.estimate.invoiceNumber], ['estimate', '']);
  db.prepare("UPDATE estimates SET doc_type = 'invoice', invoice_number = 'INV-OLD-3' WHERE id = ?").run(made.body.estimate.id);
  for (const extra of [{}, { docType: 'estimate', invoiceNumber: '' }]) {
    const saved = await saveEstimate({ upid: 'T18-DOC', ...extra }, made.body.estimate.id);
    assert.equal(saved.status, 200);
    assert.deepEqual([saved.body.estimate.docType, saved.body.estimate.invoiceNumber], ['invoice', 'INV-OLD-3']);
  }
  await dropEstimates(made.body.estimate.id);
});

/* ── Accepting, and creating invoices (task 19) ────────────────────────── */
const calc19 = require('../src/calc');
const invoiceRows = (projectId) => db.prepare(`
  SELECT * FROM invoices WHERE project_id = ?
   ORDER BY CASE kind WHEN 'deposit' THEN 0 WHEN 'final' THEN 1 ELSE 2 END
`).all(projectId);
const activityCount = (projectId) => db.prepare('SELECT COUNT(*) AS n FROM activity WHERE project_id = ?').get(projectId).n;
const gstOn = (extra) => api('/api/settings', {
  method: 'PUT',
  body: JSON.stringify({ gst: { registered: true, rate: 0.1, pricesIncludeGst: false }, ...(extra || {}) }),
});
const gstOff = () => api('/api/settings', { method: 'PUT', body: JSON.stringify({}) });

test('accept: one transaction makes the deposit + final pair from the stored totals, exactly as task 14 does', async () => {
  await gstOn({ invoicing: { depositPct: 40 } });
  // An awkward total, so the deposit's cents and its GST share both round.
  const est = (await saveEstimate({
    name: 'T19 Pair', upid: 'T19-PAIR',
    activeRows: { prod: [capture('d_t19_p1', { mu: 1123.37 })], post: [capture(null, { name: 'Edit', mu: 911.11 })] },
    days: [pbDay('d_t19_p1', '2026-11-02', 'pencilled')],
  })).body.estimate;
  const stored = est.totals;
  assert.ok(stored.gst > 0 && Math.round(stored.totalIncGst * 100) % 3 !== 0, JSON.stringify(stored));
  assert.equal(est.upidLocked, false);
  // The folder offers the setting's % before acceptance (D33).
  assert.equal((await folderOf(est.projectId)).body.project.depositPctDefault, 40);

  const r = await act(est.projectId, 'accept', { invoicing: 'pair', depositPct: 33 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [dep, fin, ...more] = invoiceRows(est.projectId);
  assert.equal(more.length, 0);
  assert.deepEqual([dep.kind, dep.number, dep.status, dep.pct, dep.estimate_id],
    ['deposit', 'INV-T19-PAIR-D', 'draft', 33, est.id]);
  assert.deepEqual([fin.kind, fin.number, fin.status, fin.pct, fin.less_invoice_id, fin.estimate_id],
    ['final', 'INV-T19-PAIR-F', 'draft', null, dep.id, est.id]);
  // The amounts are task 14's, from the estimate's stored totals, to the cent.
  const deposit = calc19.depositAmount(stored, 33);
  assert.deepEqual(JSON.parse(dep.totals_json), deposit);
  assert.deepEqual(JSON.parse(fin.totals_json), calc19.finalInvoiceTotals(stored, null, deposit));
  const final = JSON.parse(fin.totals_json);
  for (const k of ['clientPriceExGst', 'gst', 'totalIncGst']) {
    assert.equal(Math.round(deposit[k] * 100) + Math.round(final.balance[k] * 100), Math.round(stored[k] * 100), k);
  }
  assert.equal(final.total.totalIncGst, stored.totalIncGst);
  // Each keeps the estimate as accepted, its days confirmed.
  const snap = JSON.parse(dep.estimate_snapshot_json);
  assert.deepEqual([snap.id, snap.status, snap.totals, snap.days.map((d) => d.status)], [est.id, 'accepted', stored, ['confirmed']]);
  assert.equal(fin.estimate_snapshot_json, dep.estimate_snapshot_json);

  const p = projectRow(est.projectId);
  assert.deepEqual([Boolean(p.accepted_at), p.invoicing, p.deposit_pct], [true, 'pair', 33]);
  assert.deepEqual([r.body.estimates[0].status, r.body.estimates[0].days[0].status, r.body.project.stage,
    r.body.project.stageDetail.step], ['accepted', 'confirmed', 'accepted', 'deposit_draft']);
  assert.deepEqual(r.body.invoices.map((i) => [i.kind, i.number, i.amountDue]),
    [['deposit', 'INV-T19-PAIR-D', deposit.totalIncGst], ['final', 'INV-T19-PAIR-F', final.balanceDue]]);
  assert.deepEqual([r.body.activity[0].kind, r.body.activity[0].detail], ['accepted', {
    estimateId: est.id, invoicing: 'pair', depositPct: 33, invoices: ['INV-T19-PAIR-D', 'INV-T19-PAIR-F'], rebook: [],
  }]);
  assert.deepEqual(r.body.rebook, []);

  // Editing the estimate afterwards moves no invoice.
  const edited = await saveEstimate({
    name: 'T19 Pair', upid: 'T19-PAIR',
    activeRows: { prod: [capture('d_t19_p1', { mu: 2000 })] },
    days: [pbDay('d_t19_p1', '2026-11-02', 'confirmed')],
  }, est.id);
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(invoiceRows(est.projectId).map((i) => i.totals_json), [dep.totals_json, fin.totals_json]);
  await dropEstimates(est.id);
  await gstOff();
});

test('accept: without a %, the setting’s; a single invoice is INV-<UPID>, the whole job due', async () => {
  await gstOn({ invoicing: { depositPct: 40 } });
  const a = (await saveEstimate({ name: 'T19 Setting', upid: 'T19-SET', activeRows: { post: [capture(null, { mu: 777.77 })] } })).body.estimate;
  assert.equal((await act(a.projectId, 'accept', {})).status, 200);
  const [dep] = invoiceRows(a.projectId);
  assert.deepEqual([dep.pct, JSON.parse(dep.totals_json)], [40, calc19.depositAmount(a.totals, 40)]);
  // A % set on the project before acceptance beats the setting (D33).
  const own = (await saveEstimate({ name: 'T19 Own', upid: 'T19-OWN', activeRows: { post: [capture(null, { mu: 777.77 })] } })).body.estimate;
  db.prepare('UPDATE projects SET deposit_pct = 20 WHERE id = ?').run(own.projectId);
  assert.equal((await folderOf(own.projectId)).body.project.depositPctDefault, 20);
  assert.equal((await act(own.projectId, 'accept', {})).status, 200);
  assert.equal(invoiceRows(own.projectId)[0].pct, 20);
  await dropEstimates(own.id);

  const b = (await saveEstimate({ name: 'T19 Single', upid: 'T19-ONE', activeRows: { post: [capture(null, { mu: 777.77 })] } })).body.estimate;
  db.prepare('UPDATE projects SET deposit_pct = 25 WHERE id = ?').run(b.projectId);
  const r = await act(b.projectId, 'accept', { invoicing: 'single' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = invoiceRows(b.projectId);
  assert.deepEqual(rows.map((i) => [i.kind, i.number, i.pct, i.less_invoice_id]), [['single', 'INV-T19-ONE', null, null]]);
  assert.deepEqual(JSON.parse(rows[0].totals_json), calc19.singleInvoiceTotals(b.totals, null));
  assert.equal(r.body.invoices[0].amountDue, b.totals.totalIncGst);
  // A single invoice leaves the project's own deposit % alone.
  assert.deepEqual([projectRow(b.projectId).invoicing, projectRow(b.projectId).deposit_pct], ['single', 25]);
  await dropEstimates(a.id, b.id);
  await gstOff();
});

test('accept: a second accept changes nothing, whatever it asks for', async () => {
  const est = (await saveEstimate({ name: 'T19 Twice', upid: 'T19-TWICE' })).body.estimate;
  await act(est.projectId, 'sent', { validUntil: '2026-11-03' });
  const first = await act(est.projectId, 'accept', { invoicing: 'pair', depositPct: 50 });
  assert.equal(first.status, 200);
  const before = [JSON.stringify(invoiceRows(est.projectId)), activityCount(est.projectId), JSON.stringify(projectRow(est.projectId))];
  for (const body of [{ invoicing: 'pair', depositPct: 50 }, { invoicing: 'single' }, { depositPct: 'nonsense' }]) {
    const again = await act(est.projectId, 'accept', body);
    assert.deepEqual([again.status, again.body.already], [200, true], JSON.stringify(body));
  }
  assert.deepEqual([JSON.stringify(invoiceRows(est.projectId)), activityCount(est.projectId), JSON.stringify(projectRow(est.projectId))], before);
  await dropEstimates(est.id);
});

test('accept: confirms every dated day, flagging one another project confirmed first as “clash, rebook” (D18)', async () => {
  const other = (await saveEstimate({
    name: 'T19 Holder', upid: 'T19-HOLD',
    activeRows: { prod: [capture('d_t19_h1'), capture('d_t19_h2')] },
    days: [pbDay('d_t19_h1', '2026-11-16', 'confirmed'), pbDay('d_t19_h2', '2026-11-18', 'confirmed')],
  })).body.estimate;
  const est = (await saveEstimate({
    name: 'T19 Clash', upid: 'T19-CLASH',
    activeRows: { prod: [capture('d_t19_c1'), capture('d_t19_c3'), capture('d_t19_c4'), capture('d_t19_c5')] },
    days: [pbDay('d_t19_c1', '2026-11-15', 'proposed'), pbDay('d_t19_c4', '2026-11-17', 'confirmed'),
      pbDay('d_t19_c5', null, 'proposed'), pbDay('d_t19_c3', '2026-11-18', 'pencilled', { overrideNote: 'Second shooter' })],
  })).body.estimate;
  assert.ok(est && est.id);
  // Pencilled onto a date the holder confirms after: saved where it is, it stays saveable.
  db.prepare("INSERT INTO production_days (id, estimate_id, date, status, start_time, end_time, override_note, sort, created_at, updated_at) VALUES ('d_t19_c2', ?, '2026-11-16', 'pencilled', NULL, NULL, '', 9, 'x', 'x')").run(est.id);
  // A date this project confirmed first that the holder also has: not the one to rebook.
  db.prepare("INSERT INTO production_days (id, estimate_id, date, status, start_time, end_time, override_note, sort, created_at, updated_at) VALUES ('d_t19_h3', ?, '2026-11-17', 'confirmed', NULL, NULL, '', 9, 'x', 'x')").run(other.id);

  const r = await act(est.projectId, 'accept', { invoicing: 'single' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.rebook, [{ date: '2026-11-16', upid: 'T19-HOLD', name: 'T19 Holder' }]);
  const days = Object.fromEntries(db.prepare('SELECT id, status, rebook FROM production_days WHERE estimate_id = ?').all(est.id)
    .map((d) => [d.id, [d.status, d.rebook]]));
  assert.deepEqual(days, {
    d_t19_c1: ['confirmed', 0], d_t19_c2: ['confirmed', 1], d_t19_c3: ['confirmed', 0], // its note is the override (D16)
    d_t19_c4: ['confirmed', 0], d_t19_c5: ['proposed', 0], // Date TBC untouched
  });
  assert.deepEqual(r.body.activity[0].detail.rebook, ['2026-11-16']);
  const shown = (body) => body.estimates[0].days.filter((d) => d.rebook).map((d) => [d.id, d.rebook]);
  assert.deepEqual(shown(r.body), [['d_t19_c2', { upid: 'T19-HOLD', name: 'T19 Holder' }]]);

  // A save that leaves the day where it is keeps the flag; the browser can't set or clear it.
  const allDays = (extra) => [pbDay('d_t19_c1', '2026-11-15', 'confirmed'), pbDay('d_t19_c2', '2026-11-16', 'confirmed', extra),
    pbDay('d_t19_c4', '2026-11-17', 'confirmed'), pbDay('d_t19_c5', null, 'proposed'),
    pbDay('d_t19_c3', '2026-11-18', 'confirmed', { overrideNote: 'Second shooter' })];
  const rows = { prod: [capture('d_t19_c1'), capture('d_t19_c2'), capture('d_t19_c3'), capture('d_t19_c4'), capture('d_t19_c5')] };
  const flag = () => db.prepare("SELECT rebook FROM production_days WHERE id = 'd_t19_c2'").get().rebook;
  assert.equal((await saveEstimate({ name: 'T19 Clash', upid: 'T19-CLASH', activeRows: rows, days: allDays({ rebook: false }) }, est.id)).status, 200);
  assert.equal(flag(), 1);
  // While the holder is declined there's no clash to show; back, it shows again.
  await act(other.projectId, 'decline');
  assert.deepEqual(shown((await folderOf(est.projectId)).body), []);
  db.prepare("UPDATE estimates SET status = 'draft' WHERE id = ?").run(other.id);
  db.prepare('UPDATE projects SET declined_at = NULL WHERE id = ?').run(other.projectId);
  assert.equal(shown((await folderOf(est.projectId)).body).length, 1);
  // A specification note sorts it out, and clears it; so does moving the day.
  assert.equal((await saveEstimate({ name: 'T19 Clash', upid: 'T19-CLASH', activeRows: rows, days: allDays({ overrideNote: 'Sub shoots it' }) }, est.id)).status, 200);
  assert.equal(flag(), 0);
  db.prepare("UPDATE production_days SET rebook = 1, override_note = '' WHERE id = 'd_t19_c2'").run();
  assert.equal((await saveEstimate({ name: 'T19 Clash', upid: 'T19-CLASH', activeRows: rows, days: allDays({ date: '2026-11-19' }) }, est.id)).status, 200);
  assert.equal(flag(), 0);
  await dropEstimates(est.id, other.id);
});

test('accept: a failure part-way rolls the whole accept back', async () => {
  const est = (await saveEstimate({
    name: 'T19 Rollback', upid: 'T19-ROLL',
    activeRows: { prod: [capture('d_t19_r1')] },
    days: [pbDay('d_t19_r1', '2026-11-20', 'pencilled')],
  })).body.estimate;
  await act(est.projectId, 'sent', { validUntil: '2026-11-03' });
  const snapshot = () => JSON.stringify([projectRow(est.projectId), db.prepare('SELECT * FROM estimates WHERE id = ?').get(est.id),
    db.prepare('SELECT * FROM production_days WHERE estimate_id = ?').all(est.id), invoiceRows(est.projectId),
    activityCount(est.projectId)]);
  const before = snapshot();
  // The final invoice is the last write before the project's: refuse it.
  db.exec("CREATE TRIGGER t19_fail BEFORE INSERT ON invoices WHEN NEW.kind = 'final' BEGIN SELECT RAISE(ABORT, 't19 forced'); END;");
  try {
    const r = await api(`/api/projects/${est.projectId}/accept?today=${T18_TODAY}`, { method: 'POST', body: JSON.stringify({}) });
    await r.text();
    assert.equal(r.status, 500);
  } finally {
    db.exec('DROP TRIGGER t19_fail');
  }
  assert.equal(snapshot(), before);
  assert.equal((await act(est.projectId, 'accept', {})).status, 200);
  assert.equal(invoiceRows(est.projectId).length, 2);
  await dropEstimates(est.id);
});

test('accept: refused when declined, without its own UPID, at a bad %, or onto a number already used', async () => {
  const est = (await saveEstimate({ name: 'T19 Refuse', upid: 'T19-N' })).body.estimate;
  for (const [body, code] of [[{ depositPct: 0 }, 'deposit_pct_invalid'], [{ depositPct: 100.01 }, 'deposit_pct_invalid'],
    [{ depositPct: 'half' }, 'deposit_pct_invalid'], [{ invoicing: 'triple' }, 'invoicing_invalid']]) {
    const r = await act(est.projectId, 'accept', body);
    assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body));
  }
  // "T19-N-D" as a single invoice is INV-T19-N-D: project T19-N's deposit number.
  const clash = (await saveEstimate({ name: 'T19 Number', upid: 'T19-N-D' })).body.estimate;
  assert.equal((await act(clash.projectId, 'accept', { invoicing: 'single' })).status, 200);
  const taken = await act(est.projectId, 'accept', {});
  assert.deepEqual([taken.status, taken.body.error, taken.body.number], [409, 'invoice_number_taken', 'INV-T19-N-D']);
  assert.equal(projectRow(est.projectId).accepted_at, null);
  assert.equal((await act(est.projectId, 'accept', { invoicing: 'single' })).status, 200); // INV-T19-N is free

  const blank = (await saveEstimate({ name: 'T19 Blank', upid: '' })).body.estimate;
  assert.deepEqual([(await act(blank.projectId, 'accept', {})).body.error, invoiceRows(blank.projectId).length], ['upid_missing', 0]);
  const waiting = (await saveEstimate({ name: 'T19 Waiting', upid: 'T19-WAIT' })).body.estimate;
  db.prepare('UPDATE projects SET upid = NULL, needs_upid = 1 WHERE id = ?').run(waiting.projectId);
  assert.equal((await act(waiting.projectId, 'accept', {})).body.error, 'needs_upid');
  const gone = (await saveEstimate({ name: 'T19 Gone', upid: 'T19-GONE' })).body.estimate;
  await act(gone.projectId, 'decline');
  assert.deepEqual([(await act(gone.projectId, 'accept', {})).status, (await act(gone.projectId, 'accept', {})).body.error],
    [409, 'project_declined']);
  assert.equal((await act('prj_nope', 'accept', {})).status, 404);
  await dropEstimates(est.id, clash.id, blank.id, waiting.id, gone.id);
});

test('invoices: a project accepted before task 19 gets its invoices once; not before acceptance, nor beside an old one', async () => {
  const est = (await saveEstimate({ name: 'T19 Mapped', upid: 'T19-MAP', activeRows: { post: [capture(null, { mu: 640.5 })] } })).body.estimate;
  assert.equal((await act(est.projectId, 'invoices', {})).body.error, 'not_accepted');
  // As v13 maps an `approved` estimate.
  db.prepare("UPDATE estimates SET status = 'accepted' WHERE id = ?").run(est.id);
  db.prepare("UPDATE projects SET accepted_at = '2026-09-01T00:00:00.000Z' WHERE id = ?").run(est.projectId);
  const r = await act(est.projectId, 'invoices', { invoicing: 'pair', depositPct: 30 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [dep, fin] = invoiceRows(est.projectId);
  assert.deepEqual([dep.number, fin.number, JSON.parse(dep.totals_json)], ['INV-T19-MAP-D', 'INV-T19-MAP-F', calc19.depositAmount(est.totals, 30)]);
  assert.deepEqual(JSON.parse(fin.totals_json), calc19.finalInvoiceTotals(est.totals, null, calc19.depositAmount(est.totals, 30)));
  assert.deepEqual([r.body.activity[0].kind, r.body.activity[0].detail.invoices], ['invoices_created', ['INV-T19-MAP-D', 'INV-T19-MAP-F']]);
  assert.equal(projectRow(est.projectId).accepted_at, '2026-09-01T00:00:00.000Z');
  const n = activityCount(est.projectId);
  assert.deepEqual([(await act(est.projectId, 'invoices', { invoicing: 'single' })).body.already, invoiceRows(est.projectId).length,
    activityCount(est.projectId)], [true, 2, n]);

  const old = (await saveEstimate({ name: 'T19 Old', upid: 'T19-OLD' })).body.estimate;
  db.prepare("UPDATE projects SET accepted_at = 'x' WHERE id = ?").run(old.projectId);
  db.prepare("INSERT INTO invoices (id, project_id, estimate_id, kind, number, status, created_at, updated_at) VALUES ('inv_t19old', ?, ?, 'legacy', 'INV-9', 'sent', 'x', 'x')")
    .run(old.projectId, old.id);
  assert.equal((await act(old.projectId, 'invoices', {})).body.error, 'has_legacy_invoice');
  await dropEstimates(est.id, old.id);
});

test('invoices: the UPID locks with the first invoice (D36), and a sent one keeps its estimate', async () => {
  const est = (await saveEstimate({ name: 'T19 Lock', upid: 'T19-LOCK' })).body.estimate;
  // A made-the-old-way invoice doesn't lock it.
  db.prepare("INSERT INTO invoices (id, project_id, estimate_id, kind, number, status, created_at, updated_at) VALUES ('inv_t19lk', ?, ?, 'legacy', 'INV-L', 'draft', 'x', 'x')")
    .run(est.projectId, est.id);
  assert.equal((await saveEstimate({ name: 'T19 Lock', upid: 'T19-LOCK2' }, est.id)).status, 200);
  db.prepare("DELETE FROM invoices WHERE id = 'inv_t19lk'").run();
  assert.equal((await act(est.projectId, 'accept', {})).status, 200);
  const moved = await saveEstimate({ name: 'T19 Lock', upid: 'T19-LOCK3' }, est.id);
  assert.deepEqual([moved.status, moved.body.error, moved.body.upid], [409, 'upid_locked', 'T19-LOCK2']);
  const same = await saveEstimate({ name: 'T19 Lock renamed', upid: 'T19-LOCK2' }, est.id);
  assert.deepEqual([same.status, same.body.estimate.upidLocked], [200, true]);
  assert.equal((await api(`/api/estimates/${est.id}`).then((r) => r.json())).estimate.upidLocked, true);
  assert.equal((await folderOf(est.projectId)).body.estimates[0].upidLocked, true);

  db.prepare("UPDATE invoices SET status = 'sent' WHERE project_id = ? AND kind = 'deposit'").run(est.projectId);
  const del = await api(`/api/estimates/${est.id}`, { method: 'DELETE' }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.deepEqual([del.status, del.body.error], [409, 'has_sent_invoices']);
  db.prepare('UPDATE invoices SET status = ? WHERE project_id = ?').run('draft', est.projectId);
  await dropEstimates(est.id);
  assert.equal(projectRow(est.projectId), undefined);
});

/* ── The invoice screen's routes (task 20; D35–D37, D100) ──────────────── */
const inv = (id, action, body, method) => api(`/api/invoices/${id}${action ? '/' + action : ''}?today=${T18_TODAY}`, {
  method: method || (action ? 'POST' : 'GET'),
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const putInv = (id, body) => inv(id, '', body, 'PUT');
const invRow = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const EXCL20 = { gst: { registered: true, rate: 0.1, pricesIncludeGst: false } };
const OT20 = { name: 'Overtime — per hour', qty: 2, mu: 210, rowId: 'row_ot' };

/* Past the API's refusal (an invoice has gone out): estimates, days,
   invoices and activity cascade from the project. */
const dropProject = (projectId) => db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

/* An accepted pair at `pct`, GST on: the estimate and its two invoice rows. */
let t20Day = 0;
async function acceptedPair(upid, pct) {
  // Each its own date: a project whose invoice went out can't be deleted
  // through the API, so its confirmed day would lock the next test's.
  t20Day += 1;
  const est = (await saveEstimate({
    name: 'T20 ' + upid, upid,
    activeRows: { prod: [capture('d_' + upid, { mu: 1123.37 })], post: [capture(null, { name: 'Edit', mu: 911.11 })] },
    days: [pbDay('d_' + upid, '2027-01-' + String(t20Day).padStart(2, '0'), 'pencilled')],
  })).body.estimate;
  assert.ok(est && est.id, upid);
  const r = await act(est.projectId, 'accept', { invoicing: 'pair', depositPct: pct });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [dep, fin] = invoiceRows(est.projectId);
  return { est, dep, fin };
}

test('invoice: a draft final takes Additional work extras, priced from their own snapshots, to task 14’s cent (D35)', async () => {
  await gstOn();
  const { est, dep, fin } = await acceptedPair('T20-FIN', 40);
  const got = await inv(fin.id);
  assert.equal(got.status, 200, JSON.stringify(got.body));
  const i = got.body.invoice;
  assert.deepEqual([i.kind, i.number, i.status, i.editable, i.estimate.id, i.estimate.status, i.extras, i.less.number, i.less.status],
    ['final', 'INV-T20-FIN-F', 'draft', true, est.id, 'accepted', [], 'INV-T20-FIN-D', 'draft']);
  assert.equal(i.amountDue, JSON.parse(fin.totals_json).balanceDue);
  assert.deepEqual([got.body.project.id, got.body.invoices.map((x) => x.number)], [est.projectId, ['INV-T20-FIN-D', 'INV-T20-FIN-F']]);

  // Two hours of Overtime and a custom-billed line; the browser's extra keys are dropped.
  const custom = { name: 'Raw Footage Handover [on HDD]', qty: 1, mu: 98, customBill: true, override: 150 };
  const saved = await putInv(fin.id, { extras: [{ ...OT20, dayId: 'd_x', deliverableId: 'del_x', capture: true }, custom] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const stored = [OT20, custom];
  assert.deepEqual(JSON.parse(invRow(fin.id).extras_json), { additional: stored });
  const extras = calc19.extrasTotals({ additional: stored }, { labourSections: [] }, EXCL20, false);
  assert.deepEqual([extras.clientPriceExGst, extras.gst, extras.totalIncGst], [570, 57, 627]);
  const want = calc19.finalInvoiceTotals(est.totals, extras, JSON.parse(dep.totals_json));
  assert.deepEqual(JSON.parse(invRow(fin.id).totals_json), want);
  assert.deepEqual([saved.body.invoice.extras, saved.body.invoice.amountDue], [stored, want.balanceDue]);
  assert.equal(Math.round(want.balanceDue * 100), Math.round((est.totals.totalIncGst + 627) * 100) - Math.round(JSON.parse(dep.totals_json).totalIncGst * 100));
  assert.equal((await folderOf(est.projectId)).body.invoices[1].amountDue, want.balanceDue);
  assert.deepEqual([saved.body.project.stage, (await folderOf(est.projectId)).body.activity[0].kind], ['accepted', 'invoice_edited']);
  // The estimate's own totals never move, and nor does the deposit.
  assert.equal(invRow(dep.id).totals_json, dep.totals_json);

  // Bad extras are refused whole.
  for (const [body, code] of [[{}, 'extras_invalid'], [{ extras: [{ name: 'X', qty: 1 }] }, 'extra_price_missing'],
    [{ extras: [{ ...OT20, qty: -1 }] }, 'extra_qty_invalid'], [{ extras: [{ ...OT20, name: ' ' }] }, 'extra_name_invalid']]) {
    const r = await putInv(fin.id, body);
    assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body));
  }
  assert.deepEqual(JSON.parse(invRow(fin.id).totals_json), want);

  // The deposit's % edits in place while the final is a draft: the final follows, its extras kept as priced.
  const pct = await putInv(dep.id, { depositPct: 25 });
  assert.equal(pct.status, 200, JSON.stringify(pct.body));
  const deposit = calc19.depositAmount(est.totals, 25);
  assert.deepEqual([invRow(dep.id).pct, JSON.parse(invRow(dep.id).totals_json), projectRow(est.projectId).deposit_pct], [25, deposit, 25]);
  assert.deepEqual(JSON.parse(invRow(fin.id).totals_json), calc19.finalInvoiceTotals(est.totals, extras, deposit));
  assert.equal((await putInv(dep.id, { depositPct: 0 })).body.error, 'deposit_pct_invalid');

  // Once sent, nothing edits in place: neither the final, nor the deposit it takes off.
  assert.equal((await inv(fin.id, 'sent', { issuedAt: '2026-11-25', dueAt: '2026-12-09' })).status, 200);
  const late = await putInv(fin.id, { extras: [] });
  assert.deepEqual([late.status, late.body.error, late.body.status], [409, 'not_draft', 'sent']);
  assert.deepEqual([(await putInv(dep.id, { depositPct: 30 })).status, (await putInv(dep.id, { depositPct: 30 })).body.error], [409, 'final_sent']);
  assert.equal((await inv('inv_nope')).status, 404);
  dropProject(est.projectId);

  // A GST-free job's extras are GST-free too, on a registered business.
  const free = (await saveEstimate({ name: 'T20 Free', upid: 'T20-FREE', gstFree: true, activeRows: { post: [capture(null, { mu: 500 })] } })).body.estimate;
  await act(free.projectId, 'accept', { invoicing: 'single' });
  const [single] = invoiceRows(free.projectId);
  const r = await putInv(single.id, { extras: [OT20] });
  assert.deepEqual([r.body.invoice.totals.extras, r.body.invoice.totals.total.gst], [{ clientPriceExGst: 420, gst: 0, totalIncGst: 420 }, 0]);
  dropProject(free.projectId);
  await gstOff();
});

test('invoice: Mark sent dates it, Mark paid closes it, and the stage line moves with them', async () => {
  const { est, dep, fin } = await acceptedPair('T20-PAY', 50);
  for (const [body, code] of [[{ issuedAt: '2026-13-01', dueAt: '2026-12-01' }, 'issued_at_invalid'],
    [{ issuedAt: '2026-11-10', dueAt: '2026-11-09' }, 'due_at_invalid'], [{ issuedAt: '2026-11-10' }, 'due_at_invalid']]) {
    const r = await inv(dep.id, 'sent', body);
    assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body));
  }
  const sent = await inv(dep.id, 'sent', { issuedAt: '2026-10-04', dueAt: '2026-10-18' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual([sent.body.invoice.status, sent.body.invoice.issuedAt, sent.body.invoice.dueAt, sent.body.invoice.editable],
    ['sent', '2026-10-04', '2026-10-18', false]);
  assert.deepEqual([sent.body.project.stage, sent.body.project.stageDetail.step, sent.body.project.stageDetail.dueAt],
    ['invoiced', 'deposit_sent', '2026-10-18']);
  assert.equal((await inv(dep.id, 'sent', { issuedAt: '2026-10-04', dueAt: '2026-10-18' })).body.error, 'not_draft');

  for (const [body, code] of [[{ paidAt: '2026-10-03', via: 'cash' }, 'paid_via_invalid'], [{ via: 'bank' }, 'paid_at_invalid'],
    [{ paidAt: '2026-10-05', via: 'bank' }, 'paid_at_future']]) {
    const r = await inv(dep.id, 'paid', body);
    assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body));
  }
  const paid = await inv(dep.id, 'paid', { paidAt: '2026-10-03', via: 'bank' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.deepEqual([paid.body.invoice.status, paid.body.invoice.paidAt, paid.body.invoice.paidVia], ['paid', '2026-10-03', 'bank']);
  assert.deepEqual([paid.body.project.stage, paid.body.project.stageDetail.step], ['invoiced', 'deposit_paid']);
  const log = (await folderOf(est.projectId)).body.activity;
  assert.deepEqual([log[0].kind, log[0].detail], ['invoice_paid', {
    invoiceId: dep.id, number: 'INV-T20-PAY-D', paidAt: '2026-10-03', via: 'bank', amount: JSON.parse(dep.totals_json).totalIncGst,
  }]);
  assert.deepEqual([log[1].kind, log[1].detail], ['invoice_sent', { invoiceId: dep.id, number: 'INV-T20-PAY-D', issuedAt: '2026-10-04', dueAt: '2026-10-18' }]);
  // Twice is nothing new.
  const n = activityCount(est.projectId);
  assert.deepEqual([(await inv(dep.id, 'paid', { paidAt: '2026-10-04', via: 'card' })).body.already, invRow(dep.id).paid_via,
    activityCount(est.projectId)], [true, 'bank', n]);
  // The final, paid by card without being marked sent first, settles the project.
  const all = await inv(fin.id, 'paid', { paidAt: '2026-10-04', via: 'card' });
  assert.deepEqual([all.body.project.stage, all.body.invoice.paidVia], ['paid', 'card']);

  // An old-way invoice is read-only, but can be marked paid: its stage line waits on it.
  const old = (await saveEstimate({ name: 'T20 Old', upid: 'T20-OLD' })).body.estimate;
  db.prepare("UPDATE projects SET accepted_at = 'x' WHERE id = ?").run(old.projectId);
  db.prepare("INSERT INTO invoices (id, project_id, estimate_id, kind, number, status, totals_json, created_at, updated_at) VALUES ('inv_t20old', ?, ?, 'legacy', 'INV-77', 'sent', '{\"totalIncGst\":500}', 'x', 'x')")
    .run(old.projectId, old.id);
  const legacy = await inv('inv_t20old');
  assert.deepEqual([legacy.body.invoice.kind, legacy.body.invoice.estimate, legacy.body.invoice.editable, legacy.body.invoice.amountDue],
    ['legacy', null, false, 500]);
  assert.equal((await putInv('inv_t20old', { extras: [] })).body.error, 'legacy_invoice');
  assert.equal((await inv('inv_t20old', 'sent', { issuedAt: '2026-10-01', dueAt: '2026-10-02' })).body.error, 'legacy_invoice');
  assert.equal((await inv('inv_t20old', 'void', { reason: 'x' })).body.error, 'legacy_invoice');
  assert.equal((await inv('inv_t20old', 'pdf')).body.estimateId, old.id);
  assert.equal((await inv('inv_t20old', 'paid', { paidAt: '2026-10-01', via: 'bank' })).body.project.stage, 'paid');
  dropProject(est.projectId);
  dropProject(old.projectId);
});

test('invoice: void and remake (D100) — a sent, unpaid invoice is kept as void and replaced with the next free suffix', async () => {
  await gstOn();
  const { est, dep, fin } = await acceptedPair('T20-V', 50);
  await putInv(fin.id, { extras: [OT20] });
  const finTotals = JSON.parse(invRow(fin.id).totals_json);

  // A draft is edited, not voided; a reason is required.
  assert.deepEqual([(await inv(dep.id, 'void', { reason: 'x' })).status, (await inv(dep.id, 'void', { reason: 'x' })).body.error], [409, 'not_sent']);
  await inv(dep.id, 'sent', { issuedAt: '2026-10-01', dueAt: '2026-10-15' });
  assert.equal((await inv(dep.id, 'void', { reason: '  ' })).body.error, 'void_reason_required');

  const v = await inv(dep.id, 'void', { reason: 'Wrong deposit %' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const d2 = v.body.invoice;
  assert.deepEqual([v.body.voided, d2.number, d2.kind, d2.status, d2.pct, d2.replaces.number, d2.issuedAt, d2.editable],
    [dep.id, 'INV-T20-V-D2', 'deposit', 'draft', 50, 'INV-T20-V-D', null, true]);
  assert.equal(invRow(d2.id).totals_json, dep.totals_json);
  assert.equal(invRow(d2.id).estimate_snapshot_json, dep.estimate_snapshot_json);
  const old = invRow(dep.id);
  assert.deepEqual([old.status, old.voided_at, old.void_reason, old.number, old.totals_json],
    ['void', T18_TODAY, 'Wrong deposit %', 'INV-T20-V-D', dep.totals_json]);
  assert.equal((await inv(dep.id)).body.invoice.replacedBy.number, 'INV-T20-V-D2');
  // The drafted final now takes off the replacement, at the same amounts.
  assert.deepEqual([invRow(fin.id).less_invoice_id, JSON.parse(invRow(fin.id).totals_json)], [d2.id, finTotals]);
  assert.deepEqual([v.body.project.stageDetail.step, v.body.invoices.map((x) => [x.number, x.status, x.voidedAt])],
    ['deposit_draft', [['INV-T20-V-D', 'void', T18_TODAY], ['INV-T20-V-D2', 'draft', null], ['INV-T20-V-F', 'draft', null]]]);
  assert.deepEqual((await folderOf(est.projectId)).body.activity[0].detail, {
    invoiceId: dep.id, number: 'INV-T20-V-D', reason: 'Wrong deposit %', replacementId: d2.id, replacement: 'INV-T20-V-D2',
  });
  assert.equal((await inv(dep.id, 'void', { reason: 'again' })).body.error, 'invoice_void');
  assert.equal((await inv(dep.id, 'paid', { paidAt: '2026-10-01', via: 'bank' })).body.error, 'invoice_void');

  // A final sent with D2 taken off keeps naming D2 when D2 is replaced: its screen says to remake it too.
  await inv(d2.id, 'sent', { issuedAt: '2026-10-02', dueAt: '2026-10-16' });
  await inv(fin.id, 'sent', { issuedAt: '2026-10-02', dueAt: '2026-10-30' });
  const d3 = (await inv(d2.id, 'void', { reason: 'Client name' })).body.invoice;
  assert.equal(d3.number, 'INV-T20-V-D3');
  const stale = (await inv(fin.id)).body.invoice;
  assert.deepEqual([stale.less.number, stale.less.status], ['INV-T20-V-D2', 'void']);
  // Remaking the final: a number another invoice holds is skipped, and it takes off the deposit standing.
  const holder = (await saveEstimate({ name: 'T20 Holder', upid: 'T20-HOLD' })).body.estimate;
  db.prepare("INSERT INTO invoices (id, project_id, kind, number, status, created_at, updated_at) VALUES ('inv_t20f2', ?, 'single', 'inv-t20-v-f2', 'draft', 'x', 'x')")
    .run(holder.projectId);
  // D3 is still a draft with no final taking it off, so its % can change: the remade final takes off D3 as it now is.
  assert.equal((await putInv(d3.id, { depositPct: 30 })).status, 200);
  const f = (await inv(fin.id, 'void', { reason: 'Took off a void deposit' })).body.invoice;
  assert.deepEqual([f.number, f.less.number, f.extras, f.replaces.number], ['INV-T20-V-F3', 'INV-T20-V-D3', [OT20], 'INV-T20-V-F']);
  assert.deepEqual(JSON.parse(invRow(f.id).totals_json),
    calc19.finalInvoiceTotals(est.totals, finTotals.extras, calc19.depositAmount(est.totals, 30)));
  assert.notDeepEqual(JSON.parse(invRow(f.id).totals_json), finTotals);
  // A paid invoice is never voided.
  await inv(d3.id, 'paid', { paidAt: '2026-10-03', via: 'bank' });
  assert.deepEqual([(await inv(d3.id, 'void', { reason: 'x' })).status, (await inv(d3.id, 'void', { reason: 'x' })).body.error], [409, 'invoice_paid']);
  // Void ones keep their numbers, so the UPID stays locked.
  assert.equal((await saveEstimate({ name: 'T20 T20-V', upid: 'T20-V2' }, est.id)).body.error, 'upid_locked');
  dropProject(holder.projectId);

  // A single invoice's replacement is INV-<UPID>-2.
  const one = (await saveEstimate({ name: 'T20 One', upid: 'T20-ONE', activeRows: { post: [capture(null, { mu: 300 })] } })).body.estimate;
  await act(one.projectId, 'accept', { invoicing: 'single' });
  const [single] = invoiceRows(one.projectId);
  await inv(single.id, 'sent', { issuedAt: '2026-10-01', dueAt: '2026-10-15' });
  assert.equal((await inv(single.id, 'void', { reason: 'Typo' })).body.invoice.number, 'INV-T20-ONE-2');
  dropProject(one.projectId);
  await gstOff();
});

test('invoice: a void that fails part-way changes nothing', async () => {
  const { est, dep } = await acceptedPair('T20-RB', 50);
  await inv(dep.id, 'sent', { issuedAt: '2026-10-01', dueAt: '2026-10-15' });
  const before = JSON.stringify([invoiceRows(est.projectId), activityCount(est.projectId)]);
  db.exec("CREATE TRIGGER t20_fail BEFORE INSERT ON invoices WHEN NEW.replaces_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 't20 forced'); END;");
  try {
    const r = await api(`/api/invoices/${dep.id}/void?today=${T18_TODAY}`, { method: 'POST', body: JSON.stringify({ reason: 'x' }) });
    await r.text();
    assert.equal(r.status, 500);
  } finally {
    db.exec('DROP TRIGGER t20_fail');
  }
  assert.equal(JSON.stringify([invoiceRows(est.projectId), activityCount(est.projectId)]), before);
  dropProject(est.projectId);
});

test('invoice PDFs: refused without the ABN on a tax invoice; rendered with the number in the filename', async (t) => {
  await gstOn();
  const { est, fin } = await acceptedPair('T20-PDF', 50);
  await putInv(fin.id, { extras: [OT20] });
  const noAbn = await inv(fin.id, 'pdf', {});
  assert.deepEqual([noAbn.status, noAbn.body.error], [422, 'abn_required']);
  assert.equal((await inv('inv_nope', 'pdf', {})).status, 404);
  if (!require('../src/pdf').resolveExecutablePath()) {
    t.skip('no headless Chromium available on this machine');
  } else {
    await gstOn({ business: { name: 'LSC Creative', abn: '12345678901' } });
    const pdf = await api(`/api/invoices/${fin.id}/pdf?today=${T18_TODAY}`, { method: 'POST', body: JSON.stringify({ issuedAt: '2026-11-25', dueAt: '2026-12-09' }) });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-disposition'), /INV-T20-PDF-F - Client - T20 T20-PDF\.pdf/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString('ascii'), '%PDF-');
    const cb = await api(`/api/invoices/${fin.id}/cost-breakdown?today=${T18_TODAY}`, { method: 'POST' });
    assert.equal(cb.status, 200);
    assert.match(cb.headers.get('content-disposition'), /Cost Breakdown_INV-T20-PDF-F_T20 T20-PDF\.pdf/);
    await cb.arrayBuffer();
  }
  dropProject(est.projectId);
  await gstOff();
});

test('activity: Home\'s recent events across projects, newest first, named as the project card is (task 22)', async () => {
  const a = (await saveEstimate({ name: 'T22 Alpha', upid: 'T22-A', client: { businessName: 'Alpha Co' } })).body.estimate;
  const b = (await saveEstimate({ name: 'T22 Beta', upid: 'T22-B' })).body.estimate;
  assert.equal((await act(a.projectId, 'sent', { validUntil: '2026-10-18' })).status, 200);
  assert.equal((await act(b.projectId, 'decline')).status, 200);
  assert.equal((await act(b.projectId, 'reopen')).status, 200); // a correction: the folder's log only
  const get = (q) => api('/api/activity' + (q || '')).then(async (r) => ({ status: r.status, body: await r.json() }));

  let r = await get();
  assert.equal(r.status, 200);
  assert.ok(r.body.activity.length <= 10);
  const mine = r.body.activity.filter((e) => [a.projectId, b.projectId].includes(e.project.id));
  assert.deepEqual(mine.map((e) => e.kind).sort(), ['declined', 'sent']);
  const sent = mine.find((e) => e.kind === 'sent');
  assert.deepEqual(sent.project, { id: a.projectId, upid: 'T22-A', name: 'T22 Alpha', client: 'Alpha Co' });
  assert.equal(sent.detail.validUntil, '2026-10-18');
  assert.ok(!r.body.activity.some((e) => ['reopened', 'invoice_edited', 'invoice_voided'].includes(e.kind)));

  // Newest first, ties by id; the limit counts only the kinds Home shows.
  const at = (n) => `2099-01-0${n}T00:00:00.000Z`;
  const log = db.prepare('INSERT INTO activity (id, project_id, at, kind, detail_json) VALUES (?, ?, ?, ?, ?)');
  log.run('act_t22_1', a.projectId, at(1), 'invoice_paid', '{"number":"INV-T22-A","amount":5}');
  log.run('act_t22_2', b.projectId, at(2), 'reopened', '{}');
  log.run('act_t22_3', b.projectId, at(3), 'accepted', 'not json');
  r = await get('?limit=2');
  assert.deepEqual(r.body.activity.map((e) => [e.id, e.project.id]), [['act_t22_3', b.projectId], ['act_t22_1', a.projectId]]);
  assert.deepEqual(r.body.activity[0].detail, {});
  assert.equal(r.body.activity[0].project.client, '');

  // Named by its lead estimate as it stands now, not as it was when logged.
  db.prepare("UPDATE estimates SET name = 'T22 Beta renamed' WHERE id = ?").run(b.id);
  assert.equal((await get('?limit=1')).body.activity[0].project.name, 'T22 Beta renamed');
  // A newer declined estimate in the same project doesn't name it: the live one does.
  const row = { ...db.prepare('SELECT * FROM estimates WHERE id = ?').get(b.id),
    id: 'est_t22_old', upid: 'T22-B-OLD', name: 'T22 Beta declined', status: 'declined', updated_at: at(9) };
  const cols = Object.keys(row).filter((c) => c !== 'total_inc_gst'); // generated
  db.prepare(`INSERT INTO estimates (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
  assert.equal((await get('?limit=1')).body.activity[0].project.name, 'T22 Beta renamed');
  db.prepare("DELETE FROM estimates WHERE id = 'est_t22_old'").run();

  for (const bad of ['0', '51', '2.5', 'ten']) {
    const res = await get('?limit=' + bad);
    assert.deepEqual([res.status, res.body.error], [400, 'limit_invalid'], bad);
  }

  // A deleted project's events go with it.
  await dropEstimates(a.id, b.id);
  r = await get('?limit=50');
  assert.ok(!r.body.activity.some((e) => [a.projectId, b.projectId].includes(e.project.id)));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE id LIKE 'act_t22_%'").get().n, 0);
});
