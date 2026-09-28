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
const { currentFinancialYear } = require('../src/calc');

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

function api(pathname, opts = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...opts,
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
  // Stored exactly as sent: null stays null (auto), a typed 0 stays 0.
  assert.deepEqual(reread.pricing, body);

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

  const taxInvoice = await make({ docType: 'invoice', invoiceNumber: 'INV-1' });
  const freeInvoice = await make({ docType: 'invoice', invoiceNumber: 'INV-2', gstFree: true });
  const quote = await make({});
  assert.equal(taxInvoice.totals.gst, 28);

  const refused = await api(`/api/estimates/${taxInvoice.id}/pdf`, { method: 'POST' });
  assert.equal(refused.status, 422);
  const body = await refused.json();
  assert.equal(body.error, 'abn_required');
  assert.match(body.message, /ABN/);

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
