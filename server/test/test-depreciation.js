'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  costBaseOf,
  daysHeldInFy,
  declineInValue,
  assetSchedule,
  assetScheduleRows,
  balancingAdjustment,
  poolSchedule,
  financialYearSchedule,
  isPooledMethod,
  daysInclusive,
  DIMINISHING_VALUE_FACTOR,
  DAYS_IN_YEAR_DIVISOR,
  POOL_RATES,
} = require('../src/depreciation');

/**
 * The worked asset. A $6,600 body bought in August, FIRST USED 1 OCTOBER — the
 * two dates differ on purpose, because daysHeld runs from start_date and using
 * purchase_date instead is the error that shifts a deduction between years.
 *
 *   cost base    6600 − 600 GST credit claimed = 6000
 *   days held    1 Oct 2025 → 30 Jun 2026 inclusive = 273
 */
const CAMERA = {
  id: 'as_1',
  name: 'A7S III',
  category: 'camera',
  purchase_date: '2025-08-01',
  start_date: '2025-10-01',
  cost_inc_gst: 6600,
  gst_amount: 600,
  gst_credit_claimed: 1,
  effective_life_years: 6,
  business_use_pct: 100,
};

const FY1 = 'FY2025-26';
const FY2 = 'FY2026-27';
const FY3 = 'FY2027-28';

// ── Step 1 and 2: the cost base ─────────────────────────────────────────────

test('the cost base subtracts GST only when the credit was actually claimed', () => {
  assert.equal(costBaseOf(CAMERA), 6000);

  // Bought while not registered: the GST stays in the cost base, forever. This
  // is why the flag is per asset rather than read from settings.gst — an asset's
  // cost base is fixed at acquisition and registration changes over time.
  assert.equal(costBaseOf({ ...CAMERA, gst_credit_claimed: 0 }), 6600);
  assert.equal(costBaseOf({ ...CAMERA, gst_credit_claimed: false }), 6600);
});

test('the car limit caps vehicles and nothing else', () => {
  const car = { ...CAMERA, category: 'vehicle', cost_inc_gst: 80000, gst_amount: 0,
    gst_credit_claimed: 0, car_limit: 69674 };
  assert.equal(costBaseOf(car), 69674);

  // A car under the limit is not raised to it.
  assert.equal(costBaseOf({ ...car, cost_inc_gst: 30000 }), 30000);

  // The same limit on a camera is ignored — the cap is a vehicle rule.
  assert.equal(costBaseOf({ ...car, category: 'camera' }), 80000);

  // No limit entered: nothing is capped, rather than a figure being assumed.
  // ATO limits move every year and are deliberately never hardcoded.
  const { car_limit, ...noLimit } = car;
  assert.equal(costBaseOf(noLimit), 80000);
});

test('reads snake_case rows and camelCase payloads identically', () => {
  const camel = {
    category: 'camera', startDate: '2025-10-01', costIncGst: 6600,
    gstAmount: 600, gstCreditClaimed: 1, effectiveLifeYears: 6,
    businessUsePct: 100, method: 'diminishing_value',
  };
  assert.equal(costBaseOf(camel), costBaseOf(CAMERA));
  assert.equal(
    declineInValue(camel, FY1),
    declineInValue({ ...CAMERA, method: 'diminishing_value' }, FY1),
  );
});

// ── daysHeld ────────────────────────────────────────────────────────────────

test('daysHeld runs from start_date, not purchase_date', () => {
  const bounds = { start: '2025-07-01', end: '2026-06-30' };

  // 1 Oct → 30 Jun inclusive. Counting from the August purchase date would give
  // 334 and inflate the first year's deduction by a fifth.
  assert.equal(daysHeldInFy(CAMERA, bounds), 273);
  assert.equal(daysInclusive('2025-10-01', '2026-06-30'), 273);

  // Held all year in later years.
  assert.equal(daysHeldInFy(CAMERA, { start: '2026-07-01', end: '2027-06-30' }), 365);

  // Not yet held: the FY before it was first used.
  assert.equal(daysHeldInFy(CAMERA, { start: '2024-07-01', end: '2025-06-30' }), 0);
});

test('a start date on the last day of the financial year counts as one day', () => {
  const juneThirty = { ...CAMERA, start_date: '2026-06-30' };
  assert.equal(daysHeldInFy(juneThirty, { start: '2025-07-01', end: '2026-06-30' }), 1);

  // And the next day belongs to the next year entirely.
  const julyOne = { ...CAMERA, start_date: '2026-07-01' };
  assert.equal(daysHeldInFy(julyOne, { start: '2025-07-01', end: '2026-06-30' }), 0);
  assert.equal(daysHeldInFy(julyOne, { start: '2026-07-01', end: '2027-06-30' }), 365);
});

// ── Step 3: the methods ─────────────────────────────────────────────────────

test('diminishing value: 200% of the OPENING adjustable value, pro-rata', () => {
  const asset = { ...CAMERA, method: 'diminishing_value' };

  // Year 1: 6000 × 273/365 × (2 ÷ 6) = 1495.89
  const y1 = assetSchedule(asset, FY1);
  assert.equal(y1.openingAdjustableValue, 6000);
  assert.equal(y1.daysHeld, 273);
  assert.equal(y1.decline, 1495.89);
  assert.equal(y1.closingAdjustableValue, 4504.11);

  // Year 2 compounds off year 1's closing value, not the cost base:
  // 4504.11 × 365/365 × (2 ÷ 6) = 1501.37. This is why a schedule cannot be
  // computed for one year in isolation.
  const y2 = assetSchedule(asset, FY2);
  assert.equal(y2.openingAdjustableValue, 4504.11);
  assert.equal(y2.decline, 1501.37);
  assert.equal(y2.closingAdjustableValue, 3002.74);

  assert.equal(DIMINISHING_VALUE_FACTOR, 2.0, '200% for assets held from 10 May 2006, not 150%');
});

test('prime cost: 100% of the fixed COST BASE, so the decline does not compound', () => {
  const asset = { ...CAMERA, method: 'prime_cost' };

  // Year 1: 6000 × 273/365 × (1 ÷ 6) = 747.95
  assert.equal(assetSchedule(asset, FY1).decline, 747.95);
  // Year 2: a full year off the cost base, NOT off the reduced opening value.
  // 6000 × (1 ÷ 6) = 1000 exactly, every full year.
  const y2 = assetSchedule(asset, FY2);
  assert.equal(y2.openingAdjustableValue, 5252.05);
  assert.equal(y2.decline, 1000);
  assert.equal(y2.closingAdjustableValue, 4252.05);
});

test('instant write-off takes the whole cost base in the first year and nothing after', () => {
  const asset = { ...CAMERA, method: 'instant_writeoff' };

  const y1 = assetSchedule(asset, FY1);
  assert.equal(y1.decline, 6000);
  assert.equal(y1.closingAdjustableValue, 0);
  // No day pro-rata: an instant write-off is not a rate, so first-used-in-June
  // still writes off the lot.
  assert.equal(assetSchedule({ ...asset, start_date: '2026-06-29' }, FY1).decline, 6000);

  // Nothing left to decline afterwards.
  assert.equal(assetSchedule(asset, FY2).decline, 0);
  assert.equal(assetSchedule(asset, FY2).closingAdjustableValue, 0);
});

test('the divisor is 365 even through a leap financial year', () => {
  assert.equal(DAYS_IN_YEAR_DIVISOR, 365);

  // FY2027-28 contains 29 February 2028, so a full year held is 366 days and the
  // pro-rata is 366/365 — very slightly over a full year's decline. That is the
  // published formula; "correcting" it would put this app out of step with the
  // accountant's figures.
  const y3 = assetSchedule({ ...CAMERA, method: 'prime_cost' }, FY3);
  assert.equal(y3.daysHeld, 366);
  assert.equal(y3.decline, round2ish(6000 * (366 / 365) * (1 / 6)));
});

function round2ish(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

test('an asset with no effective life declines nothing, rather than guessing one', () => {
  // A guessed life is a wrong deduction that still looks right. The form requires
  // this field so it never has to be invented here.
  const noLife = { ...CAMERA, method: 'diminishing_value', effective_life_years: null };
  assert.equal(declineInValue(noLife, FY1), 0);
  assert.equal(declineInValue({ ...noLife, effective_life_years: 0 }, FY1), 0);
});

test('an asset never declines below zero, however long it is held', () => {
  const asset = { ...CAMERA, method: 'prime_cost', effective_life_years: 2 };
  // Written off across two years; the third must not push it negative.
  const rows = assetScheduleRows(asset, 'FY2030-31');
  for (const r of rows) {
    assert.ok(r.closingAdjustableValue >= 0, `negative closing value in ${r.fy}`);
    assert.ok(r.decline >= 0);
  }
  assert.equal(rows[rows.length - 1].closingAdjustableValue, 0);
});

// ── Steps 4 and 5: the one everybody gets wrong ─────────────────────────────

/**
 * THE TEST THE HEADER PROMISES. If someone "simplifies" steps 4 and 5 into one
 * apportioned line, this fails — which is the point.
 */
test('the deduction is apportioned but the adjustable value declines in FULL', () => {
  const laptop = {
    id: 'as_2', name: 'Laptop', category: 'computer',
    purchase_date: '2025-07-01', start_date: '2025-07-01',
    cost_inc_gst: 3000, gst_amount: 0, gst_credit_claimed: 0,
    method: 'prime_cost', effective_life_years: 3, business_use_pct: 60,
  };

  const y1 = assetSchedule(laptop, FY1);
  assert.equal(y1.decline, 1000);       // step 3: the full decline
  assert.equal(y1.deductible, 600);     // step 4: apportioned 60%
  assert.equal(y1.closingAdjustableValue, 2000); // step 5: the FULL 1000 comes off

  // Apportioning step 5 too would leave 2400 here, and would overstate the
  // closing value of this asset for the rest of its life — plus every later
  // year's decline and the balancing adjustment on disposal.
  assert.notEqual(y1.closingAdjustableValue, 3000 - 600);

  const y2 = assetSchedule(laptop, FY2);
  assert.equal(y2.openingAdjustableValue, 2000);
  assert.equal(y2.decline, 1000);
  assert.equal(y2.deductible, 600);
  assert.equal(y2.closingAdjustableValue, 1000);

  // Stated as an invariant, so the relationship survives a rewrite.
  for (const row of assetScheduleRows(laptop, FY2)) {
    assert.equal(
      row.closingAdjustableValue,
      round2ish(row.openingAdjustableValue - row.decline),
      'closing value must fall by the full decline, never the deductible part',
    );
    assert.ok(row.deductible < row.decline, 'a 60% asset must deduct less than it declines');
  }
});

test('business_use_pct is a percent: 60 means 60%, not 6000%', () => {
  const asset = { ...CAMERA, method: 'prime_cost', business_use_pct: 60 };
  const row = assetSchedule(asset, FY1);
  assert.equal(row.deductible, round2ish(row.decline * 0.6));

  // 100% and a missing value both deduct the whole decline.
  const full = assetSchedule({ ...asset, business_use_pct: 100 }, FY1);
  assert.equal(full.deductible, full.decline);
  const { business_use_pct, ...noPct } = asset;
  assert.equal(assetSchedule(noPct, FY1).deductible, full.decline);

  // A 0.6 meant as "60%" would deduct 0.6% — the migration's CHECK rejects it at
  // the database, and this pins that nothing here quietly rescues it.
  const asFraction = assetSchedule({ ...asset, business_use_pct: 0.6 }, FY1);
  assert.equal(asFraction.deductible, round2ish(asFraction.decline * 0.006));
});

// ── Mid-life entry ──────────────────────────────────────────────────────────

test('an opening adjustable value lets part-depreciated gear be entered mid-life', () => {
  // A camera already three years old when the register was created must not
  // restart at full cost.
  const midLife = { ...CAMERA, method: 'diminishing_value', opening_adjustable_value: 2000 };
  const y1 = assetSchedule(midLife, FY1);
  assert.equal(y1.openingAdjustableValue, 2000);
  assert.equal(y1.decline, round2ish(2000 * (273 / 365) * (2 / 6)));

  // Absent, it starts at the cost base.
  assert.equal(assetSchedule({ ...CAMERA, method: 'diminishing_value' }, FY1).openingAdjustableValue, 6000);
});

// ── Disposal ────────────────────────────────────────────────────────────────

test('a disposal stops the schedule and carries the balancing adjustment', () => {
  const sold = {
    ...CAMERA, method: 'prime_cost', start_date: '2025-07-01',
    effective_life_years: 3, disposal_date: '2026-12-31', disposal_proceeds: 1500,
  };

  // Full first year.
  assert.equal(assetSchedule(sold, FY1).decline, 2000); // 6000 / 3
  assert.equal(assetSchedule(sold, FY1).disposed, false);
  assert.equal(assetSchedule(sold, FY1).balancingAdjustment, null);

  // Disposal year: pro-rata to 31 December = 184 days, then the adjustment.
  const y2 = assetSchedule(sold, FY2);
  assert.equal(y2.daysHeld, 184);
  assert.equal(y2.decline, round2ish(6000 * (184 / 365) * (1 / 3)));
  assert.equal(y2.disposed, true);
  assert.equal(y2.balancingAdjustment, round2ish(1500 - y2.closingAdjustableValue));

  // Gone from every later year — no row, rather than a zero row that would read
  // as "still held, nothing claimed".
  assert.equal(assetSchedule(sold, FY3), null);

  const bal = balancingAdjustment(sold);
  assert.equal(bal.fy, FY2, 'the adjustment belongs to the FY of disposal');
  assert.equal(bal.amount, y2.balancingAdjustment);
});

test('the balancing adjustment is apportioned by business use', () => {
  const sold = {
    ...CAMERA, method: 'prime_cost', start_date: '2025-07-01', effective_life_years: 3,
    business_use_pct: 50, disposal_date: '2026-12-31', disposal_proceeds: 1500,
  };
  const y2 = assetSchedule(sold, FY2);
  // Only the business half was ever deducted, so only that half is adjusted.
  assert.equal(y2.balancingAdjustment, round2ish((1500 - y2.closingAdjustableValue) * 0.5));
});

test('a row carries the inputs it was computed from, so a lodged snapshot is self-contained', () => {
  const sold = {
    ...CAMERA, method: 'prime_cost', start_date: '2025-07-01', effective_life_years: 3,
    business_use_pct: 50, disposal_date: '2026-12-31', disposal_proceeds: 1500,
  };
  const y1 = assetSchedule(sold, FY1);
  assert.equal(y1.businessUsePct, 50);
  assert.equal(y1.disposalDate, null, 'not disposed in the first year');
  assert.equal(y1.disposalProceeds, null);

  const y2 = assetSchedule(sold, FY2);
  assert.equal(y2.businessUsePct, 50);
  assert.equal(y2.disposalDate, '2026-12-31');
  assert.equal(y2.disposalProceeds, 1500);
  // The adjustment is recomputable from the row alone — what a reader of a
  // frozen snapshot has to be able to do.
  assert.equal(
    y2.balancingAdjustment,
    round2ish((y2.disposalProceeds - y2.closingAdjustableValue) * (y2.businessUsePct / 100))
  );

  const scrapped = { ...sold, disposal_proceeds: null };
  assert.equal(assetSchedule(scrapped, FY2).disposalProceeds, 0, 'no proceeds entered is proceeds of nothing');
});

test('a disposal for nothing is a deduction, not income', () => {
  const scrapped = {
    ...CAMERA, method: 'prime_cost', start_date: '2025-07-01', effective_life_years: 6,
    disposal_date: '2026-12-31', disposal_proceeds: 0,
  };
  const row = assetSchedule(scrapped, FY2);
  assert.ok(row.closingAdjustableValue > 0, 'still has value when scrapped');
  assert.ok(row.balancingAdjustment < 0, 'a write-off below value is a deduction');
});

test('an asset with no disposal has no balancing adjustment', () => {
  assert.equal(balancingAdjustment({ ...CAMERA, method: 'prime_cost' }), null);
  assert.equal(balancingAdjustment({ ...CAMERA, method: 'prime_cost', disposal_date: null }), null);
  assert.equal(balancingAdjustment({ ...CAMERA, method: 'prime_cost', disposal_date: '' }), null);
});

// ── Pools ───────────────────────────────────────────────────────────────────

const GIMBAL = {
  id: 'as_p1', name: 'Gimbal', category: 'other',
  purchase_date: '2025-08-01', start_date: '2025-08-01',
  cost_inc_gst: 2000, gst_amount: 0, gst_credit_claimed: 0,
  method: 'small_business_pool', business_use_pct: 100,
};
const TRIPOD = {
  ...GIMBAL, id: 'as_p2', name: 'Tripod',
  purchase_date: '2026-09-01', start_date: '2026-09-01', cost_inc_gst: 1000,
};

test('a small business pool takes 15% on additions and 30% on the balance', () => {
  assert.deepEqual(POOL_RATES.small_business_pool, { firstYear: 0.15, thereafter: 0.30 });
  const assets = [GIMBAL, TRIPOD];

  // Year 1: 2000 added × 15% = 300.
  const y1 = poolSchedule(assets, FY1)[0];
  assert.equal(y1.openingBalance, 0);
  assert.equal(y1.additions, 2000);
  assert.equal(y1.decline, 300);
  assert.equal(y1.closingBalance, 1700);

  // Year 2: the balance takes the full rate and the new asset the reduced one —
  // 1700 × 30% + 1000 × 15% = 510 + 150 = 660. Both rates in one year, which is
  // why there is no single "rate applied" field.
  const y2 = poolSchedule(assets, FY2)[0];
  assert.equal(y2.openingBalance, 1700);
  assert.equal(y2.additions, 1000);
  assert.equal(y2.decline, 660);
  assert.equal(y2.closingBalance, 2040);

  // Year 3: no additions, 2040 × 30% = 612.
  const y3 = poolSchedule(assets, FY3)[0];
  assert.equal(y3.decline, 612);
  assert.equal(y3.closingBalance, 1428);
});

test('a low-value pool takes 18.75% then 37.5%', () => {
  assert.deepEqual(POOL_RATES.low_value_pool, { firstYear: 0.1875, thereafter: 0.375 });
  const asset = { ...GIMBAL, method: 'low_value_pool', cost_inc_gst: 1000 };

  assert.equal(poolSchedule([asset], FY1)[0].decline, 187.5);
  assert.equal(poolSchedule([asset], FY1)[0].closingBalance, 812.5);
  assert.equal(poolSchedule([asset], FY2)[0].decline, round2ish(812.5 * 0.375));
});

test('pools apportion business use on the way IN, not on the decline', () => {
  // The opposite of step 4 for an individual asset. A 50%-business asset
  // contributes half its cost base, and the whole pool decline is then
  // deductible — apportioning again here would halve it twice.
  const half = { ...GIMBAL, business_use_pct: 50 };
  const row = poolSchedule([half], FY1)[0];
  assert.equal(row.additions, 1000);
  assert.equal(row.decline, 150);
  assert.equal(row.deductible, row.decline, 'pool decline is deductible in full');
});

test('pools take a reduced first-year rate instead of day-count pro-rata', () => {
  // Pooled on the last day of the year: still the full 15%, not 15% × 1/365.
  const lateJune = { ...GIMBAL, start_date: '2026-06-30' };
  assert.equal(poolSchedule([lateJune], FY1)[0].decline, 300);
});

test('pooled assets have no individual schedule row, and vice versa', () => {
  assert.equal(isPooledMethod('small_business_pool'), true);
  assert.equal(isPooledMethod('low_value_pool'), true);
  assert.equal(isPooledMethod('diminishing_value'), false);

  // A pooled asset contributes to a balance rather than pretending to have its
  // own decline figure.
  assert.equal(declineInValue(GIMBAL, FY1), 0);

  // And an unpooled asset produces no pool rows.
  assert.deepEqual(poolSchedule([{ ...CAMERA, method: 'prime_cost' }], FY1), []);
  assert.deepEqual(poolSchedule([], FY1), []);
});

test('the two pools are tracked separately, never merged into one balance', () => {
  const sbp = { ...GIMBAL, cost_inc_gst: 2000 };
  const lvp = { ...GIMBAL, id: 'as_p3', method: 'low_value_pool', cost_inc_gst: 1000 };

  const rows = poolSchedule([sbp, lvp], FY1);
  assert.equal(rows.length, 2);
  const byPool = Object.fromEntries(rows.map((r) => [r.pool, r]));
  assert.equal(byPool.small_business_pool.decline, 300);      // 2000 × 15%
  assert.equal(byPool.low_value_pool.decline, 187.5);          // 1000 × 18.75%
});

// ── The whole-year schedule ─────────────────────────────────────────────────

test('a financial year schedule reconciles assets, pools and the deductible total', () => {
  const camera = { ...CAMERA, method: 'prime_cost', start_date: '2025-07-01', effective_life_years: 6 };
  const laptop = {
    id: 'as_4', name: 'Laptop', category: 'computer',
    purchase_date: '2025-07-01', start_date: '2025-07-01',
    cost_inc_gst: 3000, gst_amount: 0, gst_credit_claimed: 0,
    method: 'prime_cost', effective_life_years: 3, business_use_pct: 60,
  };

  const s = financialYearSchedule([camera, laptop, GIMBAL], FY1);

  assert.equal(s.fy, FY1);
  assert.equal(s.assets.length, 2, 'the pooled asset is not an individual row');
  assert.equal(s.pools.length, 1);

  // 1000 (camera, full business use) + 600 (laptop at 60%) + 300 (pool).
  assert.equal(s.totalDeductible, 1900);
  assert.equal(s.totalBalancingAdjustment, 0);

  // Rows carry enough to render and to export.
  assert.equal(s.assets[0].assetId, 'as_1');
  assert.equal(s.assets[0].name, 'A7S III');
});

test('a year with no assets held is an empty schedule, not a broken one', () => {
  const s = financialYearSchedule([{ ...CAMERA, method: 'prime_cost' }], 'FY2020-21');
  assert.deepEqual(s.assets, []);
  assert.deepEqual(s.pools, []);
  assert.equal(s.totalDeductible, 0);

  assert.deepEqual(financialYearSchedule([], FY1).assets, []);
  assert.equal(financialYearSchedule(undefined, FY1).totalDeductible, 0);
});

test('an unparseable financial year is refused rather than guessed', () => {
  assert.equal(financialYearSchedule([CAMERA], '2025'), null);
  assert.equal(financialYearSchedule([CAMERA], 'nonsense'), null);
  assert.equal(assetSchedule(CAMERA, 'FY2025-27'), null);
});

test('an asset with no usable start date produces no schedule at all', () => {
  assert.deepEqual(assetScheduleRows({ ...CAMERA, method: 'prime_cost', start_date: null }, FY1), []);
  assert.deepEqual(assetScheduleRows({ ...CAMERA, method: 'prime_cost', start_date: 'soon' }, FY1), []);
  assert.equal(assetSchedule(undefined, FY1), null);
});

// ── The copy discipline ─────────────────────────────────────────────────────

test('web/js/depreciation.js is a byte-identical copy of the server chain', () => {
  const server = readFileSync(join(__dirname, '..', 'src', 'depreciation.js'));
  const web = readFileSync(join(__dirname, '..', '..', 'web', 'js', 'depreciation.js'));
  assert.ok(
    server.equals(web),
    'server/src/depreciation.js and web/js/depreciation.js have drifted. Re-copy the ' +
    'server file over the web one; the browser must compute the same schedule.',
  );
});

test('the browser copy is loaded after calc.js, which it depends on', () => {
  // It reads round2, numOrNull, field, businessUseShare, fyLabel and fyBounds
  // off globalThis.LSCCalc at load time, so a script tag in the wrong order is a
  // blank Depreciation tab with a console error and no other symptom.
  const html = readFileSync(join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
  const calcAt = html.indexOf('js/calc.js');
  const depAt = html.indexOf('js/depreciation.js');
  assert.ok(calcAt !== -1, 'calc.js must be loaded');
  assert.ok(depAt !== -1, 'depreciation.js must be loaded');
  assert.ok(calcAt < depAt, 'calc.js must load before depreciation.js');
});

/**
 * THE TEST THAT WOULD HAVE CAUGHT A BROKEN LIVE SITE.
 *
 * In the browser, calc.js and depreciation.js are plain <script> tags sharing
 * ONE global scope. A top-level `const { round2 } = ...` in the second file
 * collides with the first file's top-level `function round2` and the whole file
 * dies with "Identifier 'round2' has already been declared" — taking the page
 * with it.
 *
 * Node cannot see that: there each file is a module with its own scope, so every
 * other test in this suite passed while the deployed site would have been blank.
 * The only honest check is to load both copies into one shared context the way a
 * browser does, which is what this does. It caught exactly that bug, which is why
 * depreciation.js is wrapped in an IIFE.
 *
 * If a third sibling is added, extend this rather than trusting the unit tests.
 */
test('both browser copies load into one shared global scope without colliding', () => {
  const vm = require('node:vm');
  const webDir = join(__dirname, '..', '..', 'web', 'js');

  const sandbox = { console };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  // Same order as index.html.
  for (const file of ['calc.js', 'depreciation.js']) {
    assert.doesNotThrow(
      () => vm.runInContext(readFileSync(join(webDir, file), 'utf8'), ctx, { filename: file }),
      `web/js/${file} failed to load alongside the scripts before it`,
    );
  }

  assert.ok(sandbox.LSCCalc, 'calc.js must expose globalThis.LSCCalc');
  assert.ok(sandbox.LSCDepreciation, 'depreciation.js must expose globalThis.LSCDepreciation');

  // And the browser copy must compute what the server computes.
  assert.equal(
    sandbox.LSCDepreciation.assetSchedule({ ...CAMERA, method: 'diminishing_value' }, FY1).decline,
    assetSchedule({ ...CAMERA, method: 'diminishing_value' }, FY1).decline,
  );
});
