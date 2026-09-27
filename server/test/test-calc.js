'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  computeTotals,
  gstTreatment,
  round2,
  annualisedCost,
  annualOverheadTotal,
  overheadRatePerHour,
  minimumJobPrice,
  targetAnnualRevenue,
  hoursPerUnitOf,
  annualBillableHours,
  annualBillableHoursFromGoals,
} = require('../src/calc');
const { DEFAULT_PRICING, DEFAULT_SETTINGS } = require('../src/defaults');

/**
 * The worked example. BILLING_APP_PLAN.md §1.2 defines the model but never
 * gives numbers, so this job is the fixture — chosen because it exercises every
 * path at once: a marked-up labour rate, a custom-bill override, a direct-cost
 * travel row, a marked-up travel row, crew and equipment.
 *
 *   Labour     8h Video Capture      @ 140  = 1120
 *              5h Socials editing    @ 126  =  630
 *              Raw footage handover, override =  250
 *                                            ------
 *                                              2000
 *   Travel     120 fuel & tolls (at cost)   =  120
 *              4h transport      @ 35        =  140
 *   Crew       2 days            @ 500       = 1000
 *   Equipment  2 days            @ 150       =  300
 *                                            ------
 *   Expenses                                   1560
 *   Billed                                     3560
 *   Pass-through  1000 + 300 + 120           = 1420
 */
const JOB = {
  prod: [{ name: 'Video Capture', qty: 8 }],
  post: [
    { name: 'Video Editor — Socials', qty: 5 },
    { name: 'Raw Footage Handover [on HDD]', qty: 1, override: 250 },
  ],
  travel: [
    { name: 'Fuel & Tolls', qty: 120 },
    { name: 'Transport & Logistics Hrs', qty: 4 },
  ],
  crew: [{ role: 'Second Shooter', days: 2, cost: 500 }],
  equip: [{ vendor: 'Lens hire', days: 2, cost: 150 }],
};

function settingsWith(gst) {
  return { ...DEFAULT_SETTINGS, gst: { ...DEFAULT_SETTINGS.gst, ...gst } };
}

test('breaks the job down into labour, expenses and pass-through', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, DEFAULT_SETTINGS);

  assert.equal(t.labourTotal, 2000);
  assert.equal(t.expenseTotal, 1560);
  assert.equal(t.passThroughCost, 1420);
  assert.equal(t.totalHours, 14);
});

test('not GST registered: the client pays exactly what was billed', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, settingsWith({ registered: false }));

  assert.equal(t.clientPriceExGst, 3560);
  assert.equal(t.gst, 0);
  assert.equal(t.totalIncGst, 3560);
});

test('GST registered, prices exclusive: GST is added on top', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, settingsWith({
    registered: true, rate: 0.10, pricesIncludeGst: false,
  }));

  assert.equal(t.clientPriceExGst, 3560);
  assert.equal(t.gst, 356);
  assert.equal(t.totalIncGst, 3916);
});

test('GST registered, prices inclusive: GST is backed out, and the parts still sum', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, settingsWith({
    registered: true, rate: 0.10, pricesIncludeGst: true,
  }));

  assert.equal(t.totalIncGst, 3560);
  assert.equal(t.clientPriceExGst, 3236.36);
  assert.equal(t.gst, 323.64);
  // Rounding must never leave an invoice that doesn't add up.
  assert.equal(t.clientPriceExGst + t.gst, t.totalIncGst);
});

test('tax set-aside is provisioned on labour only', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, DEFAULT_SETTINGS);

  // 2000 × 0.35 — the 1560 of expenses is not income and is not provisioned.
  assert.equal(t.taxSetAside, 700);
});

test('take-home excludes pass-through, unlike the old "Gross Profit"', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, DEFAULT_SETTINGS);

  assert.equal(t.estTakeHome, 1300); // 2000 labour − 700 set aside

  // What the desktop app would have shown: net − tax, counting every dollar of
  // crew, equipment and fuel as profit. This is the bug the model corrects.
  const oldGrossProfit = 3560 - 700;
  assert.equal(oldGrossProfit, 2860);
  assert.equal(oldGrossProfit - t.estTakeHome, t.expenseTotal);
});

test('on GST-inclusive pricing, tax is set aside on the ex-GST labour figure', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, settingsWith({
    registered: true, rate: 0.10, pricesIncludeGst: true,
  }));

  // 2000 / 1.1 = 1818.18 of actual labour income; the rest belongs to the ATO.
  assert.equal(t.taxSetAside, 636.36);
  assert.equal(t.estTakeHome, 1181.82);
});

/* GST-free estimates. Being registered doesn't make every job GST-bearing, so
   one estimate can opt out without re-pricing every other one. */

const GST_EXCLUSIVE = { registered: true, rate: 0.10, pricesIncludeGst: false };
const GST_INCLUSIVE = { registered: true, rate: 0.10, pricesIncludeGst: true };

test('a GST-free estimate charges no GST even though the business is registered', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, settingsWith(GST_EXCLUSIVE), { gstFree: true });

  assert.equal(t.gst, 0);
  assert.equal(t.clientPriceExGst, 3560);
  assert.equal(t.totalIncGst, 3560);
});

test('GST-free on a GST-inclusive rate card: the listed rate is still the price', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, settingsWith(GST_INCLUSIVE), { gstFree: true });

  // The decision from 2026-09-10. Without the flag this job totals 3560 with
  // 323.64 of it GST; the tempting alternative was to hand the client that
  // 323.64 back and bill 3236.36. It bills the rate card instead — a job's tax
  // treatment must not move the quoted price.
  assert.equal(t.totalIncGst, 3560);
  assert.equal(t.clientPriceExGst, 3560);
  assert.equal(t.gst, 0);
});

test('GST-free means the whole labour figure is revenue, so tax is set aside on all of it', () => {
  const inclusive = computeTotals(JOB, DEFAULT_PRICING, settingsWith(GST_INCLUSIVE));
  const free = computeTotals(JOB, DEFAULT_PRICING, settingsWith(GST_INCLUSIVE), { gstFree: true });

  // Normally 2000 of billed labour is 1818.18 income and 181.82 the ATO's.
  assert.equal(inclusive.taxSetAside, 636.36);
  // GST-free, none of it is the ATO's: 2000 × 0.35.
  assert.equal(free.taxSetAside, 700);
  assert.equal(free.estTakeHome, 1300);
});

test('a GST-free estimate is priced exactly as an unregistered business would price it', () => {
  const free = computeTotals(JOB, DEFAULT_PRICING, settingsWith(GST_EXCLUSIVE), { gstFree: true });
  const unregistered = computeTotals(JOB, DEFAULT_PRICING, settingsWith({ registered: false }));

  assert.deepEqual(free, unregistered);
});

test('the flag absent, false, or a stray value leaves an estimate priced as before', () => {
  const registered = computeTotals(JOB, DEFAULT_PRICING, settingsWith(GST_EXCLUSIVE));

  for (const options of [undefined, {}, { gstFree: false }, { gstFree: 'yes' }, { gstFree: 1 }]) {
    // Only a literal `true` opts out — the same rule as gst.registered, so a
    // half-populated body can never silently drop GST off an invoice.
    assert.deepEqual(
      computeTotals(JOB, DEFAULT_PRICING, settingsWith(GST_EXCLUSIVE), options),
      registered
    );
  }
});

test('gstTreatment reads the stored figures and the flag, never live settings', () => {
  const settings = { gst: { registered: true, rate: 0.1, pricesIncludeGst: false } };
  const rows = { prod: [{ name: 'Video Capture', qty: 2 }] };
  const pricing = { labourSections: [{ id: 'prod', rows: [{ name: 'Video Capture', mu: 140 }] }] };

  assert.equal(gstTreatment(computeTotals(rows, pricing, settings)), 'taxable');
  assert.equal(gstTreatment(computeTotals(rows, pricing, settings, { gstFree: true }), { gstFree: true }), 'free');
  assert.equal(gstTreatment(computeTotals(rows, pricing, {})), 'none');
  // Same strictness as computeTotals: only a literal true opts out.
  assert.equal(gstTreatment({ gst: 28 }, { gstFree: 1 }), 'taxable');
  assert.equal(gstTreatment(undefined), 'none');
});

test('rows whose rate has since been removed from the card are ignored, not guessed at', () => {
  const t = computeTotals(
    { prod: [{ name: 'Video Capture', qty: 2 }, { name: 'Deleted Rate', qty: 99 }] },
    DEFAULT_PRICING,
    DEFAULT_SETTINGS
  );

  assert.equal(t.labourTotal, 280);
  assert.equal(t.totalHours, 2);
});

test('an empty or malformed estimate totals zero rather than NaN', () => {
  for (const input of [undefined, {}, { prod: null, crew: [{ days: 'abc', cost: {} }] }]) {
    const t = computeTotals(input, DEFAULT_PRICING, DEFAULT_SETTINGS);
    for (const [key, value] of Object.entries(t)) {
      assert.equal(Number.isFinite(value), true, `${key} should be a number`);
      assert.equal(value, 0, `${key} should be 0`);
    }
  }
});

test('without a rate card, only the rows that carry their own costs still bill', () => {
  const t = computeTotals(JOB, undefined, undefined);

  // Labour and travel are priced from the rate card, so they fall to zero.
  assert.equal(t.labourTotal, 0);
  // Crew and equipment carry their cost on the estimate row itself, so they
  // survive: 1000 + 300. Losing the rate card must not silently zero an
  // estimate's real out-of-pocket costs.
  assert.equal(t.expenseTotal, 1300);
  assert.equal(t.passThroughCost, 1300);
  assert.equal(t.totalIncGst, 1300);
  assert.equal(t.estTakeHome, 0);
});

/**
 * HOURS PER UNIT
 *
 * `totalHours` is Σ qty × hoursPerUnit, because the card now carries day-unit
 * labour rows whose quantity is in days. These tests exist for the two ways that
 * can go wrong, and both are silent:
 *
 *   1. A day row counted as one hour. minimumJobPrice allocates overhead across
 *      totalHours, so a two-day shoot would carry 2 hours of overhead instead of
 *      ~20 and the advisory floor would come back hundreds of dollars low.
 *   2. An unusable hoursPerUnit resolving to 0 instead of 1, which drops the
 *      job's hours out of that allocation entirely — the same failure, with no
 *      day row needed to trigger it.
 *
 * The first test is the one that has to keep passing forever: nothing on the
 * card today carries hoursPerUnit, and no saved estimate may move by a cent.
 */
const DAY_CARD = {
  taxSetAsideRate: 0.35,
  travelRows: [],
  labourSections: [
    {
      id: 'prod',
      label: 'Production',
      rows: [
        { name: 'Video Capture — Full Day', rate: 1000, mu: 1400, hoursPerUnit: 10 },
        { name: 'Video Capture — Hourly', rate: 100, mu: 140 },
      ],
    },
  ],
};

/**
 * Today's figures for the worked JOB on a GST-inclusive card, pinned as a whole
 * object rather than field by field. DEFAULT_PRICING carries no hoursPerUnit on
 * any row, so this is the behaviour-preservation gate for the default-of-1 path:
 * if adding the multiplier had moved anything — including the figures derived
 * from labour, which it must not touch at all — this fails.
 */
test('a card with no hoursPerUnit anywhere totals exactly as it did before', () => {
  const t = computeTotals(JOB, DEFAULT_PRICING, settingsWith(GST_INCLUSIVE));

  assert.deepEqual(t, {
    clientPriceExGst: 3236.36,
    gst: 323.64,
    totalIncGst: 3560,
    labourTotal: 2000,
    expenseTotal: 1560,
    passThroughCost: 1420,
    totalHours: 14,
    taxSetAside: 636.36,
    estTakeHome: 1181.82,
  });
});

test('two full days at 10 hours a day is 20 hours, not 2', () => {
  const t = computeTotals(
    { prod: [{ name: 'Video Capture — Full Day', qty: 2 }] },
    DAY_CARD,
    settingsWith({ registered: false }),
  );

  assert.equal(t.totalHours, 20);
  // Quantity still drives the price: 2 days × $1,400, not 20 × anything.
  assert.equal(t.labourTotal, 2800);
});

test('day rows and hourly rows on one estimate add their hours, not their quantities', () => {
  const t = computeTotals(
    {
      prod: [
        { name: 'Video Capture — Full Day', qty: 2 },
        { name: 'Video Capture — Hourly', qty: 3 },
      ],
    },
    DAY_CARD,
    settingsWith({ registered: false }),
  );

  assert.equal(t.totalHours, 23); // 2 × 10 + 3 × 1
  assert.equal(t.labourTotal, 3220); // 2 × 1400 + 3 × 140
});

test('an unusable hoursPerUnit falls back to 1, never to 0', () => {
  for (const bad of [0, null, '', 'abc', -8, NaN, {}, true]) {
    assert.equal(hoursPerUnitOf({ hoursPerUnit: bad }), 1, `hoursPerUnit: ${String(bad)}`);
  }
  assert.equal(hoursPerUnitOf({}), 1);
  assert.equal(hoursPerUnitOf(undefined), 1);

  // And through computeTotals, where it decides the overhead allocation.
  const card = {
    taxSetAsideRate: 0.35,
    travelRows: [],
    labourSections: [{
      id: 'prod',
      label: 'Production',
      rows: [
        { name: 'Zero', rate: 100, mu: 140, hoursPerUnit: 0 },
        { name: 'Negative', rate: 100, mu: 140, hoursPerUnit: -8 },
        { name: 'Words', rate: 100, mu: 140, hoursPerUnit: 'abc' },
        { name: 'Null', rate: 100, mu: 140, hoursPerUnit: null },
      ],
    }],
  };
  const rows = { prod: card.labourSections[0].rows.map((r) => ({ name: r.name, qty: 2 })) };
  const t = computeTotals(rows, card, settingsWith({ registered: false }));

  assert.equal(t.totalHours, 8); // four rows × qty 2 × the fallback of 1
});

test('a zeroed hoursPerUnit would silently remove the job from the overhead floor', () => {
  const rate = 25; // the $25/hr cost basis from the overhead fixture below
  const card = {
    taxSetAsideRate: 0.35,
    travelRows: [],
    labourSections: [{
      id: 'prod',
      label: 'Production',
      rows: [{ name: 'Shoot', rate: 100, mu: 140, hoursPerUnit: 0 }],
    }],
  };
  const t = computeTotals({ prod: [{ name: 'Shoot', qty: 2 }] }, card, settingsWith({ registered: false }));

  // 2 hours of overhead recovered, not none. Had the fallback been 0, the floor
  // would equal the direct costs plus margin and read as a real answer.
  assert.equal(minimumJobPrice(0, t.totalHours, rate, 0), 50);
});

test('hoursPerUnit is fractional-safe: a half day is 4 hours, not half an hour', () => {
  const card = {
    taxSetAsideRate: 0.35,
    travelRows: [],
    labourSections: [{
      id: 'prod',
      label: 'Production',
      rows: [{ name: 'Half Day', rate: 500, mu: 800, hoursPerUnit: 4.5 }],
    }],
  };
  const t = computeTotals({ prod: [{ name: 'Half Day', qty: 3 }] }, card, settingsWith({ registered: false }));

  assert.equal(t.totalHours, 13.5);
});

/**
 * OVERHEAD, GOALS AND THE COST BASIS
 *
 * The second worked example, and the one the brief names: an overhead book
 * totalling $24,000 a year against 960 billable hours gives a $25/hr cost
 * basis. The fixture is built to hit that figure through all five frequencies
 * at once, so a broken multiplier cannot hide behind a right-looking total:
 *
 *   weekly     50 × 52 =  2600
 *   monthly  1000 × 12 = 12000
 *   quarterly 900 ×  4 =  3600
 *   annual   4300 ×  1 =  4300
 *   one-off  1500 ×  1 =  1500
 *                        -----
 *                        24000
 *
 * The 960 hours are ANNUAL billable hours, passed to overheadRatePerHour()
 * finished. They used to be written as 20 hrs/week with the function multiplying
 * by an assumed 48-week year; that constant is retired (decision 2 in calc.js's
 * header) and capacity is now four entered fields. 960 is kept as the fixture's
 * divisor so the $25/hr worked example still reads the same — what changed is
 * who does the multiplying, not the arithmetic.
 */
const OVERHEAD = [
  { name: 'Music licence', category: 'software', cost: 50, frequency: 'weekly' },
  { name: 'Adobe CC', category: 'software', cost: 1000, frequency: 'monthly' },
  { name: 'Bookkeeper', category: 'admin_legal', cost: 900, frequency: 'quarterly' },
  { name: 'Insurance', category: 'admin_legal', cost: 4300, frequency: 'annual' },
  { name: 'Website build', category: 'marketing', cost: 1500, frequency: 'one_off' },
];

test('annualises every frequency onto one yearly overhead total', () => {
  assert.equal(annualOverheadTotal(OVERHEAD), 24000);

  // Each multiplier on its own, so a compensating pair of errors can't pass.
  assert.equal(annualisedCost(OVERHEAD[0]), 2600);
  assert.equal(annualisedCost(OVERHEAD[1]), 12000);
  assert.equal(annualisedCost(OVERHEAD[2]), 3600);
  assert.equal(annualisedCost(OVERHEAD[3]), 4300);
});

test('a one-off cost counts once in the year, not never and not monthly', () => {
  assert.equal(annualisedCost(OVERHEAD[4]), 1500);
});

test('an unrecognised frequency contributes nothing rather than being guessed', () => {
  // Unreachable for a stored row (the schema CHECKs it), so if one turns up
  // here something upstream is wrong: it should read as missing, not as a
  // plausible number quietly folded into the rate every job is priced off.
  assert.equal(annualisedCost({ cost: 999, frequency: 'fortnightly' }), 0);
  assert.equal(annualisedCost({ cost: 999 }), 0);
  assert.equal(annualisedCost({ frequency: 'monthly' }), 0);
});

test('no overhead items at all totals zero, from any shape of empty', () => {
  assert.equal(annualOverheadTotal([]), 0);
  assert.equal(annualOverheadTotal(undefined), 0);
  assert.equal(annualOverheadTotal(null), 0);
});

test('the cost basis: $24,000 of overhead over 960 billable hours is $25/hr', () => {
  assert.equal(overheadRatePerHour(annualOverheadTotal(OVERHEAD), 960), 25);
});

/**
 * The parameter-semantics pin. overheadRatePerHour's second argument was
 * hours-per-week until 2026-09-27 and the function multiplied by an assumed 48;
 * it is now annual hours and the function multiplies by nothing.
 *
 * This test exists because both directions of that mistake are silent. It asserts
 * on the two wrong answers by name so a future reader cannot mistake the
 * parameter for a weekly figure, and cannot "fix" the function by reinstating a
 * multiplier without a failure.
 */
test('overheadRatePerHour takes ANNUAL billable hours, not weekly', () => {
  assert.equal(overheadRatePerHour(24000, 960), 25);

  // A weekly figure passed by mistake: $1,200/hr, not $25/hr. No error, no NaN.
  assert.equal(overheadRatePerHour(24000, 20), 1200);

  // And the function must not be annualising anything itself any more.
  assert.notEqual(overheadRatePerHour(24000, 960), round2(24000 / (960 * 48)));
  assert.equal(overheadRatePerHour(24000, 960), round2(24000 / 960));
});

test('no billable capacity gives no rate — never Infinity, NaN or zero', () => {
  // The case that would otherwise divide by zero and put "$Infinity" on a rate
  // card. Null is what the screens render as an em dash.
  for (const hours of [0, -5, null, undefined, '', 'twenty']) {
    const rate = overheadRatePerHour(24000, hours);
    assert.equal(rate, null, `annual hours ${JSON.stringify(hours)} should give null`);
  }
});

test('no overhead recorded gives no rate, rather than a $0.00 cost basis', () => {
  // "$0.00" on the rate card would read as a computed answer meaning an hour
  // costs nothing, instead of "you haven't set this up yet".
  assert.equal(overheadRatePerHour(0, 960), null);
  assert.equal(overheadRatePerHour(annualOverheadTotal([]), 960), null);
  assert.equal(overheadRatePerHour(null, 960), null);
});

/**
 * ANNUAL BILLABLE HOURS
 *
 * The brief's worked example, and the reason every overhead-derived rate moved:
 *
 *   (5 working days × 52 weeks − 30 leave − 8 sick) × 8 hrs/day = 1,776
 *
 * against the retired model's 20 hrs/week × 48 = 1,920. Same business, 144 fewer
 * billable hours, so the recovery rate rises about 8%. That was accepted when
 * the model was chosen — a test asserting the direction, so nobody later reads
 * the rise as a regression and "corrects" it.
 */
const REFERENCE_CAPACITY = {
  billableHoursPerDay: 8,
  workingDaysPerWeek: 5,
  leaveDaysPerYear: 30,
  sickDaysPerYear: 8,
};

test('annual billable hours: the reference defaults give 1,776, not 1,920', () => {
  assert.equal(annualBillableHours(REFERENCE_CAPACITY), 1776);

  /* The retired model's answer for the SAME business. It took billable hours per
     WEEK, which for this capacity is 8 × 5 = 40, and multiplied by an assumed 48
     — so the comparison is 1,920 against 1,776, a 144-hour gap. (Not 20 × 48:
     that is the OVERHEAD fixture's own weekly figure above, a different
     business, and mixing the two is how this test was wrong the first time.) */
  const retiredWeekly = REFERENCE_CAPACITY.billableHoursPerDay * REFERENCE_CAPACITY.workingDaysPerWeek;
  assert.equal(retiredWeekly, 40);
  const retired = retiredWeekly * 48;
  assert.equal(retired, 1920);
  assert.ok(annualBillableHours(REFERENCE_CAPACITY) < retired);

  // The consequence, at the fixture's overhead book: the rate goes UP.
  const now = overheadRatePerHour(24000, annualBillableHours(REFERENCE_CAPACITY));
  const before = overheadRatePerHour(24000, retired);
  assert.equal(now, 13.51);
  assert.equal(before, 12.5);
  assert.ok(now > before, 'retiring the 48-week year must raise the rate, not lower it');
});

test('leave and sick days are working days: 20, not 28, for four weeks off', () => {
  // Entering four weeks as calendar days overstates the time off by 8 days and
  // so understates capacity by 64 hours. Nothing in calc.js can tell the
  // difference — this pins the arithmetic the entry labels are protecting.
  assert.equal(annualBillableHours({ ...REFERENCE_CAPACITY, leaveDaysPerYear: 20 }), 1856);
  assert.equal(annualBillableHours({ ...REFERENCE_CAPACITY, leaveDaysPerYear: 28 }), 1792);
});

test('a six-day week and a part-time day both compute', () => {
  assert.equal(
    annualBillableHours({ billableHoursPerDay: 6, workingDaysPerWeek: 6, leaveDaysPerYear: 0, sickDaysPerYear: 0 }),
    1872,
  );
  assert.equal(
    annualBillableHours({ billableHoursPerDay: 4, workingDaysPerWeek: 3, leaveDaysPerYear: 10, sickDaysPerYear: 5 }),
    564,
  );
});

test('leave plus sick consuming the working year gives null, not zero or negative', () => {
  const workingDays = 5 * 52; // 260

  // Exactly equal is still null: zero billable hours divides into an infinite
  // rate, which is the same empty state as no capacity at all.
  assert.equal(
    annualBillableHours({ ...REFERENCE_CAPACITY, leaveDaysPerYear: 260, sickDaysPerYear: 0 }),
    null,
  );
  assert.equal(
    annualBillableHours({ ...REFERENCE_CAPACITY, leaveDaysPerYear: 200, sickDaysPerYear: 60 }),
    null,
  );
  assert.equal(
    annualBillableHours({ ...REFERENCE_CAPACITY, leaveDaysPerYear: 300, sickDaysPerYear: 0 }),
    null,
  );

  // One day short of the whole year is a real, if bleak, answer.
  assert.equal(
    annualBillableHours({ ...REFERENCE_CAPACITY, leaveDaysPerYear: workingDays - 1, sickDaysPerYear: 0 }),
    8,
  );
});

test('a missing or out-of-range capacity field gives null, never a partial answer', () => {
  for (const field of ['billableHoursPerDay', 'workingDaysPerWeek', 'leaveDaysPerYear', 'sickDaysPerYear']) {
    for (const bad of [undefined, null, '', 'abc', -1]) {
      const capacity = { ...REFERENCE_CAPACITY, [field]: bad };
      assert.equal(annualBillableHours(capacity), null, `${field} = ${JSON.stringify(bad)}`);
    }
  }

  // Zero hours in a day or zero days in a week is no capacity, not a small one.
  assert.equal(annualBillableHours({ ...REFERENCE_CAPACITY, billableHoursPerDay: 0 }), null);
  assert.equal(annualBillableHours({ ...REFERENCE_CAPACITY, workingDaysPerWeek: 0 }), null);

  // Out of range: more than 24 hours in a day, more than 7 days in a week.
  assert.equal(annualBillableHours({ ...REFERENCE_CAPACITY, billableHoursPerDay: 25 }), null);
  assert.equal(annualBillableHours({ ...REFERENCE_CAPACITY, workingDaysPerWeek: 8 }), null);

  // Zero leave and zero sick days are real answers, unlike the above.
  assert.equal(annualBillableHours({ ...REFERENCE_CAPACITY, leaveDaysPerYear: 0, sickDaysPerYear: 0 }), 2080);

  assert.equal(annualBillableHours({}), null);
  assert.equal(annualBillableHours(undefined), null);
});

/**
 * THE TRANSITIONAL BRIDGE
 *
 * annualBillableHoursFromGoals is what the two live call sites use, because the
 * four capacity fields do not reach the browser until the price-calculator
 * migration and routes tasks land. Until then it annualises the legacy weekly
 * column the old way, which is what keeps today's rate card identical to the
 * cent. Delete the legacy branch — and these two tests with it — when the
 * Capacity screen ships.
 */
test('the bridge prefers the four capacity fields when they are there', () => {
  assert.equal(annualBillableHoursFromGoals({ ...REFERENCE_CAPACITY }), 1776);

  // Both shapes present: the new fields win, and the legacy column is ignored
  // rather than averaged or preferred.
  assert.equal(
    annualBillableHoursFromGoals({ ...REFERENCE_CAPACITY, billableCapacityHrsPerWeek: 20 }),
    1776,
  );
});

test('the bridge keeps a legacy goals row on exactly the rate it had yesterday', () => {
  // 20 hrs/week × the retired 48 = 960, which is the fixture's divisor, which is
  // $25/hr. If this moves, the live rate card moved.
  assert.equal(annualBillableHoursFromGoals({ billableCapacityHrsPerWeek: 20 }), 960);
  assert.equal(
    overheadRatePerHour(annualOverheadTotal(OVERHEAD), annualBillableHoursFromGoals({ billableCapacityHrsPerWeek: 20 })),
    25,
  );

  // A never-saved goals row is nulls, and must stay the em-dash empty state.
  assert.equal(annualBillableHoursFromGoals({ billableCapacityHrsPerWeek: null }), null);
  assert.equal(annualBillableHoursFromGoals({ billableCapacityHrsPerWeek: 0 }), null);
  assert.equal(annualBillableHoursFromGoals({}), null);
  assert.equal(annualBillableHoursFromGoals(undefined), null);
});

test('minimum job price covers direct costs, overhead allocation and margin', () => {
  // The JOB fixture above, priced against the cost basis: its own expenses
  // ($1560) plus its 14 hours' share of overhead (14 × $25 = $350), then a 25%
  // margin on the lot. (1560 + 350) × 1.25 = 2387.50.
  const t = computeTotals(JOB, DEFAULT_PRICING, DEFAULT_SETTINGS);
  assert.equal(minimumJobPrice(t.expenseTotal, t.totalHours, 25, 25), 2387.5);
});

test('a 0% target margin is a real answer: break even on the job', () => {
  assert.equal(minimumJobPrice(1560, 14, 25, 0), 1910);
});

test('the profit margin is a percent, not a fraction', () => {
  // The units trap: taxRate elsewhere in calc.js is a fraction (0.35 = 35%)
  // while profitMarginPct is a percent (25 = 25%). Passing 0.25 here must mean
  // a quarter of one percent, not a quarter — guessing between the two would
  // silently under-price every job by 25%.
  assert.equal(minimumJobPrice(1560, 14, 25, 0.25), 1914.78);
});

test('no cost basis yet means no minimum job price, not a floor missing overhead', () => {
  // A number computed with the overhead term silently dropped would read as the
  // real minimum while being too low by exactly the part that matters here.
  for (const rate of [null, undefined, 0, -25, 'NaN']) {
    assert.equal(minimumJobPrice(1560, 14, rate, 25), null);
  }
  assert.equal(minimumJobPrice(1560, 14, 25, null), null);
  assert.equal(minimumJobPrice(1560, 14, 25, -10), null);
});

test('the minimum job price never moves what the client is billed', () => {
  // Advisory only. The editor's toggle shows and hides this line; nothing in
  // computeTotals reads it, so the quoted price cannot follow it.
  const t = computeTotals(JOB, DEFAULT_PRICING, DEFAULT_SETTINGS);
  const floor = minimumJobPrice(t.expenseTotal, t.totalHours, 25, 25);
  const again = computeTotals(JOB, DEFAULT_PRICING, DEFAULT_SETTINGS);

  // This job quotes $3560 against a $2387.50 floor — it clears it. The point is
  // that the two numbers are independent: computing the floor left every
  // client-facing figure byte-for-byte where it was.
  assert.equal(floor, 2387.5);
  assert.equal(again.clientPriceExGst, 3560);
  assert.deepEqual(again, t);
});

test('target annual revenue covers overhead and leaves the net income after tax', () => {
  // (24000 + 70000) / (1 - 0.35) = 144615.38. Tax as a flat slice of revenue,
  // matching the tax set-aside model the rest of this file already uses.
  assert.equal(targetAnnualRevenue(24000, 70000, 0.35), 144615.38);
  assert.equal(targetAnnualRevenue(24000, 70000, 0), 94000);
});

test('an impossible tax rate gives no revenue target', () => {
  // At 1 the division is infinite; above it the sign flips and the "target"
  // comes back negative, which is worse than showing nothing.
  assert.equal(targetAnnualRevenue(24000, 70000, 1), null);
  assert.equal(targetAnnualRevenue(24000, 70000, 1.2), null);
  assert.equal(targetAnnualRevenue(24000, 70000, -0.1), null);
  assert.equal(targetAnnualRevenue(24000, 70000, null), null);
});

test('no overhead recorded gives no revenue target either', () => {
  // Computing against a zero overhead total would put a real-looking number on
  // the Goals screen that is wrong by the entire cost of running the business.
  assert.equal(targetAnnualRevenue(0, 70000, 0.35), null);
  assert.equal(targetAnnualRevenue(null, 70000, 0.35), null);
  assert.equal(targetAnnualRevenue(24000, null, 0.35), null);
});

/**
 * The browser runs this same file. web/js/calc.js is loaded as a plain script
 * by the estimate editor so its live totals are computed by the same code the
 * server uses to store them — two implementations of GST and the tax set-aside
 * would eventually disagree, and the estimate on screen would stop matching the
 * one in the database.
 *
 * Keeping them identical is a copy rather than a build step because web/ is
 * deliberately dependency-free and served to GitHub Pages as-is. That only
 * holds if something notices when the copy goes stale, which is this test.
 */
test('web/js/calc.js is a byte-identical copy of the server money model', () => {
  const server = readFileSync(join(__dirname, '..', 'src', 'calc.js'));
  const web = readFileSync(join(__dirname, '..', '..', 'web', 'js', 'calc.js'));
  assert.ok(
    server.equals(web),
    'server/src/calc.js and web/js/calc.js have drifted. Re-copy the server ' +
      'file over the web one: cp server/src/calc.js web/js/calc.js'
  );
});
