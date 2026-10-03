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
  labourHoursBreakdown,
  targetAnnualRevenue,
  hoursPerUnitOf,
  serviceDayOk,
  annualBillableHours,
  replacementReserveTotal,
  annualBusinessCost,
  currentFinancialYear,
  fyLabel,
  fyBounds,
  fyDisplay,
  hourlyFloor,
  priceExGst,
  serviceFloorComparison,
  lineDef,
  averageJobValue,
  jobsNeededPerYear,
  postRatioReadout,
  incomeTax,
  grossForNet,
  revenueTarget,
  incomeFloorPerHour,
  taxRatesAt,
  lineSnapshot,
  unitHours,
  suggestedPrice,
  unitDef,
  SERVICE_UNITS,
  cardShapeOutdated,
  travelRowDef,
  travelFloorComparison,
  PRICING_SHAPE,
} = require('../src/calc');
const { DEFAULT_PRICING, DEFAULT_SETTINGS } = require('../src/defaults');
const { V8_DEFAULT_PRICING } = require('../src/migrations/v9-service-units');

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

/* The card JOB prices against: the default card, except that Transport &
   Logistics Hrs is still a RESOLD row (costs $25, bills $35), as it was on the
   default card until 2026-09-30. The default now marks it "Your time"
   (estimate-accuracy task 5), but this fixture exists to exercise every path
   at once, and the resold-travel path needs a row with a markup over its cost.
   Pinned here rather than read from the defaults, so the worked figures below
   test the arithmetic and not whatever the default card says this year. */
const JOB_PRICING = {
  ...DEFAULT_PRICING,
  // The travel rows as the default card had them until 2026-09-30, pinned
  // whole: tasks 5, 6a and 6b each changed the defaults (own time, auto
  // price, Fuel & Tolls renamed and a km row added), and none of that is what
  // this fixture tests.
  travelRows: [
    { name: 'Fuel & Tolls', rate: 1, mu: 1, directCost: true },
    { name: 'Crew Meals', rate: 30, mu: 30, unit: 'meals' },
    { name: 'Transport & Logistics Hrs', rate: 25, mu: 35 },
    { name: 'Flights & Public Transport', rate: 0, mu: 0, directCost: true },
    { name: 'Crew Accommodation', rate: 0, mu: 0, directCost: true },
  ],
};

function settingsWith(gst) {
  return { ...DEFAULT_SETTINGS, gst: { ...DEFAULT_SETTINGS.gst, ...gst } };
}

test('breaks the job down into labour, expenses and pass-through', () => {
  const t = computeTotals(JOB, JOB_PRICING, DEFAULT_SETTINGS);

  assert.equal(t.labourTotal, 2000);
  assert.equal(t.expenseTotal, 1560);
  assert.equal(t.passThroughCost, 1420);
  assert.equal(t.totalHours, 14);
});

test('not GST registered: the client pays exactly what was billed', () => {
  const t = computeTotals(JOB, JOB_PRICING, settingsWith({ registered: false }));

  assert.equal(t.clientPriceExGst, 3560);
  assert.equal(t.gst, 0);
  assert.equal(t.totalIncGst, 3560);
});

test('GST registered, prices exclusive: GST is added on top', () => {
  const t = computeTotals(JOB, JOB_PRICING, settingsWith({
    registered: true, rate: 0.10, pricesIncludeGst: false,
  }));

  assert.equal(t.clientPriceExGst, 3560);
  assert.equal(t.gst, 356);
  assert.equal(t.totalIncGst, 3916);
});

test('GST registered, prices inclusive: GST is backed out, and the parts still sum', () => {
  const t = computeTotals(JOB, JOB_PRICING, settingsWith({
    registered: true, rate: 0.10, pricesIncludeGst: true,
  }));

  assert.equal(t.totalIncGst, 3560);
  assert.equal(t.clientPriceExGst, 3236.36);
  assert.equal(t.gst, 323.64);
  // Rounding must never leave an invoice that doesn't add up.
  assert.equal(t.clientPriceExGst + t.gst, t.totalIncGst);
});

test('tax set-aside is provisioned on income: labour plus the markup on resold travel', () => {
  const t = computeTotals(JOB, JOB_PRICING, DEFAULT_SETTINGS);

  // Transport & Logistics bills 4 × $35 but costs 4 × $25, so $40 of it is the
  // business's income. (2000 + 40) × 0.35 = 714. The pass-throughs are not.
  assert.equal(t.incomeExGst, 2040);
  assert.equal(t.taxSetAside, 714);
});

test('take-home excludes pass-through, unlike the old "Gross Profit"', () => {
  const t = computeTotals(JOB, JOB_PRICING, DEFAULT_SETTINGS);

  assert.equal(t.estTakeHome, 1326); // 2040 income − 714 set aside

  // What the desktop app would have shown: net − tax, counting every dollar of
  // crew, equipment and fuel as profit. This is the bug the model corrects.
  const oldGrossProfit = 3560 - 714;
  assert.equal(round2(oldGrossProfit - t.estTakeHome), round2(t.expenseTotal - 40));
});

test('on GST-inclusive pricing, tax is set aside on the ex-GST income figure', () => {
  const t = computeTotals(JOB, JOB_PRICING, settingsWith({
    registered: true, rate: 0.10, pricesIncludeGst: true,
  }));

  // 2040 / 1.1 = 1854.55 of actual income; the rest belongs to the ATO.
  assert.equal(t.taxSetAside, 649.09);
  assert.equal(t.estTakeHome, 1205.45);
});

test('tax is set aside on profit: the overhead the job carries comes off first', () => {
  // 14 labour hours at $25/hr of overhead = $350 of the income is running
  // costs, which are deductible. (2040 − 350) × 0.35 = 591.50; take-home is
  // what is left after overhead AND tax.
  const t = computeTotals(JOB, JOB_PRICING, DEFAULT_SETTINGS, { overheadRate: 25 });
  assert.equal(t.overheadShare, 350);
  assert.equal(t.taxSetAside, 591.5);
  assert.equal(t.estTakeHome, 1098.5);
  // Never a negative set-aside when overhead exceeds income.
  const thin = computeTotals(JOB, JOB_PRICING, DEFAULT_SETTINGS, { overheadRate: 500 });
  assert.equal(thin.taxSetAside, 0);
});

/* GST-free estimates. Being registered doesn't make every job GST-bearing, so
   one estimate can opt out without re-pricing every other one. */

const GST_EXCLUSIVE = { registered: true, rate: 0.10, pricesIncludeGst: false };
const GST_INCLUSIVE = { registered: true, rate: 0.10, pricesIncludeGst: true };

test('a GST-free estimate charges no GST even though the business is registered', () => {
  const t = computeTotals(JOB, JOB_PRICING, settingsWith(GST_EXCLUSIVE), { gstFree: true });

  assert.equal(t.gst, 0);
  assert.equal(t.clientPriceExGst, 3560);
  assert.equal(t.totalIncGst, 3560);
});

test('GST-free on a GST-inclusive rate card: the listed rate is still the price', () => {
  const t = computeTotals(JOB, JOB_PRICING, settingsWith(GST_INCLUSIVE), { gstFree: true });

  // The decision from 2026-09-10. Without the flag this job totals 3560 with
  // 323.64 of it GST; the tempting alternative was to hand the client that
  // 323.64 back and bill 3236.36. It bills the rate card instead — a job's tax
  // treatment must not move the quoted price.
  assert.equal(t.totalIncGst, 3560);
  assert.equal(t.clientPriceExGst, 3560);
  assert.equal(t.gst, 0);
});

test('GST-free means the whole labour figure is revenue, so tax is set aside on all of it', () => {
  const inclusive = computeTotals(JOB, JOB_PRICING, settingsWith(GST_INCLUSIVE));
  const free = computeTotals(JOB, JOB_PRICING, settingsWith(GST_INCLUSIVE), { gstFree: true });

  // Normally 2040 of income is 1854.55 once the ATO's GST is out.
  assert.equal(inclusive.taxSetAside, 649.09);
  // GST-free, none of it is the ATO's: 2040 × 0.35.
  assert.equal(free.taxSetAside, 714);
  assert.equal(free.estTakeHome, 1326);
});

test('a GST-free estimate is priced exactly as an unregistered business would price it', () => {
  const free = computeTotals(JOB, JOB_PRICING, settingsWith(GST_EXCLUSIVE), { gstFree: true });
  const unregistered = computeTotals(JOB, JOB_PRICING, settingsWith({ registered: false }));

  assert.deepEqual(free, unregistered);
});

test('the flag absent, false, or a stray value leaves an estimate priced as before', () => {
  const registered = computeTotals(JOB, JOB_PRICING, settingsWith(GST_EXCLUSIVE));

  for (const options of [undefined, {}, { gstFree: false }, { gstFree: 'yes' }, { gstFree: 1 }]) {
    // Only a literal `true` opts out — the same rule as gst.registered, so a
    // half-populated body can never silently drop GST off an invoice.
    assert.deepEqual(
      computeTotals(JOB, JOB_PRICING, settingsWith(GST_EXCLUSIVE), options),
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
// Renamed when day rows joined the defaults: DEFAULT_PRICING now carries
// hoursPerUnit on its Full Day / Half Day rows, but JOB uses none of them, so
// this is still the proof that every pre-existing hourly row totals as before.
test('existing hourly rows total exactly as they did before day rows existed', () => {
  const t = computeTotals(JOB, JOB_PRICING, settingsWith(GST_INCLUSIVE));

  assert.deepEqual(t, {
    clientPriceExGst: 3236.36,
    gst: 323.64,
    totalIncGst: 3560,
    labourTotal: 2000,
    // Added 2026-10-02 (production-booking task 2): nothing here is on a
    // booked day, so nothing is surcharged. A key, not a change of figure.
    surchargeTotal: 0,
    expenseTotal: 1560,
    // Ex-GST since 2026-09-30 (estimate-accuracy task 3): this card is
    // GST-inclusive, so the 1420 of pass-throughs typed in is 1420 / 1.1.
    // The only two figures that change moved knowingly; every other field here
    // is as it was.
    passThroughCost: 1290.91,
    // Added 2026-09-28: pass-throughs plus what resold travel cost (4 × $25),
    // ex-GST as above: 1520 / 1.1.
    directJobCost: 1381.82,
    incomeExGst: 1854.55,
    overheadShare: 0,
    totalHours: 14,
    taxSetAside: 649.09,
    estTakeHome: 1205.45,
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
 * THE HOURS BREAKDOWN
 *
 * labourHoursBreakdown is the working the estimate editor prints beside the
 * Minimum Job Price ("across 23 hours (2 full days at 8 hrs, plus 7 hrs of
 * hourly work)"). Its only job is to explain computeTotals' totalHours, so the
 * test that matters is the first: the two must agree on every card, or the note
 * would show working that doesn't reach the number it sits next to.
 */
const MIXED_CARD = {
  taxSetAsideRate: 0.35,
  travelRows: [],
  labourSections: [
    {
      id: 'prod',
      label: 'Production',
      rows: [
        { name: 'Full Day', rate: 0, mu: 1120, dayUnit: 'full', hoursPerUnit: 8 },
        { name: 'Long Day', rate: 0, mu: 1400, dayUnit: 'full', hoursPerUnit: 10 },
        { name: 'Second Shooter Day', rate: 0, mu: 900, dayUnit: 'full', hoursPerUnit: 8 },
        { name: 'Half Day', rate: 0, mu: 640, dayUnit: 'half', hoursPerUnit: 4 },
        { name: 'Video Capture', rate: 0, mu: 140 },
        { name: 'Block', rate: 0, mu: 400, hoursPerUnit: 3 }, // hours without a day marker
      ],
    },
    {
      id: 'post',
      label: 'Post',
      rows: [{ name: 'Editing', rate: 0, mu: 120 }],
    },
  ],
};
const MIXED_JOB = {
  prod: [
    { name: 'Full Day', qty: 2 },
    { name: 'Second Shooter Day', qty: 1 },
    { name: 'Long Day', qty: 1 },
    { name: 'Half Day', qty: 1.5 },
    { name: 'Video Capture', qty: 3 },
    { name: 'Block', qty: 2 },
    { name: 'Gone from the card', qty: 5 },
  ],
  post: [{ name: 'Editing', qty: 4.5 }],
};

test('the hours breakdown reaches exactly the totalHours the floor is built on', () => {
  const t = computeTotals(MIXED_JOB, MIXED_CARD, settingsWith({ registered: false }));
  const b = labourHoursBreakdown(MIXED_JOB, MIXED_CARD);

  // 3 × 8 + 1 × 10 + 1.5 × 4 + 2 × 3 + 3 + 4.5 = 53.5; the orphaned row counts nowhere.
  assert.equal(t.totalHours, 53.5);
  assert.equal(b.totalHours, t.totalHours);
  const parts = b.units.reduce((sum, u) => sum + u.hours, 0) + b.hourlyHours;
  assert.equal(parts, t.totalHours);

  // And on the default card and the pre-day-row job, where everything is hourly.
  const d = computeTotals(JOB, JOB_PRICING, settingsWith({ registered: false }));
  const db = labourHoursBreakdown(JOB, JOB_PRICING);
  assert.equal(db.totalHours, d.totalHours);
  assert.deepEqual(db.units, []);
  assert.equal(db.hourlyHours, d.totalHours);
});

test('day rows group by unit and length, full days first; hourly work is one figure', () => {
  const b = labourHoursBreakdown(MIXED_JOB, MIXED_CARD);

  assert.deepEqual(b.units, [
    { dayUnit: 'full', hoursPerUnit: 10, qty: 1, hours: 10 },
    // Two differently named 8-hour full-day rows are one group: 2 + 1.
    { dayUnit: 'full', hoursPerUnit: 8, qty: 3, hours: 24 },
    { dayUnit: 'half', hoursPerUnit: 4, qty: 1.5, hours: 6 },
    // Hours on a row with no day marker are still not "hourly work".
    { dayUnit: null, hoursPerUnit: 3, qty: 2, hours: 6 },
  ]);
  // Video Capture 3 + Editing 4.5, across two sections.
  assert.equal(b.hourlyHours, 7.5);
});

test('a day row left at quantity 0 is not in the working', () => {
  const b = labourHoursBreakdown(
    { prod: [{ name: 'Full Day', qty: 0 }, { name: 'Video Capture', qty: 2 }] },
    MIXED_CARD,
  );
  assert.deepEqual(b.units, []);
  assert.equal(b.hourlyHours, 2);
  assert.equal(b.totalHours, 2);
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
 * THE LEGACY WEEKLY COLUMN IS NOT A CAPACITY INPUT
 *
 * Replaces the two "bridge" tests, deleted with the transitional
 * annualBillableHoursFromGoals() when the Capacity screen shipped. If a
 * fallback to billableCapacityHrsPerWeek × 48 ever comes back, the first
 * assertion below fails — a row missing its four fields must read as "not set
 * up", never as the retired assumption quietly pricing the card.
 */
test('the legacy weekly figure alone gives no capacity, and never outvotes the four fields', () => {
  assert.equal(annualBillableHours({ billableCapacityHrsPerWeek: 20 }), null);
  // A /api/goals payload, passed straight in as both call sites do.
  assert.equal(
    annualBillableHours({ ...REFERENCE_CAPACITY, billableCapacityHrsPerWeek: 20, desiredNetIncome: 80000 }),
    1776,
  );
  // A never-saved goals row is nulls, and stays the em-dash empty state.
  assert.equal(
    annualBillableHours({
      billableHoursPerDay: null, workingDaysPerWeek: null, leaveDaysPerYear: null, sickDaysPerYear: null,
    }),
    null,
  );
});

test('minimum job price covers direct costs, overhead allocation and markup', () => {
  // The JOB fixture above, priced against the cost basis: its direct costs
  // ($1520 — pass-throughs plus what the resold travel cost) at cost, plus its
  // 14 hours' share of overhead (14 × $25 = $350) marked up 25%.
  // 1520 + 350 × 1.25 = 1957.50.
  const t = computeTotals(JOB, JOB_PRICING, DEFAULT_SETTINGS);
  assert.equal(minimumJobPrice(t.directJobCost, t.totalHours, 25, 25), 1957.5);
});

test('pass-through costs carry no markup in the minimum job price', () => {
  // The audit's case: $10,000 of crew billed at cost plus 8 hours at $150.
  // The markup used to apply to the crew too, and this well-priced job read as
  // under its floor ($12,651.20 against $11,200).
  const card = { labourSections: [{ id: 'a', rows: [{ name: 'x', mu: 150 }] }], travelRows: [], taxSetAsideRate: 0.35 };
  const t = computeTotals({ a: [{ name: 'x', qty: 8 }], crew: [{ days: 1, cost: 10000 }] }, card, DEFAULT_SETTINGS);
  const floor = minimumJobPrice(t.directJobCost, t.totalHours, 15.12, 25);
  assert.equal(floor, 10151.2);
  assert.ok(t.clientPriceExGst > floor);
});

test('a 0% target markup is a real answer: break even on the job', () => {
  assert.equal(minimumJobPrice(1560, 14, 25, 0), 1910);
});

test('the markup is a percent, not a fraction', () => {
  // The units trap: taxSetAsideRate is a fraction (0.35 = 35%) while markupPct
  // is a percent (25 = 25%). Passing 0.25 here must mean a quarter of one
  // percent, not a quarter.
  assert.equal(minimumJobPrice(1560, 14, 25, 0.25), 1910.88);
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
  const t = computeTotals(JOB, JOB_PRICING, DEFAULT_SETTINGS);
  const floor = minimumJobPrice(t.directJobCost, t.totalHours, 25, 25);
  const again = computeTotals(JOB, JOB_PRICING, DEFAULT_SETTINGS);

  // This job quotes $3560 against a $1957.50 floor — it clears it. The point is
  // that the two numbers are independent: computing the floor left every
  // client-facing figure byte-for-byte where it was.
  assert.equal(floor, 1957.5);
  assert.equal(again.clientPriceExGst, 3560);
  assert.deepEqual(again, t);
});

/* Income tax through the user's own tax year. The fixture is the FY2026-27
   resident scale as a user would enter it — placeholders here, not a claim
   about the law: the app never builds these in. */
const TAX_YEAR = {
  fy: 'FY2026-27',
  brackets: [
    { from: 0, ratePct: 0 },
    { from: 18200, ratePct: 15 },
    { from: 45000, ratePct: 30 },
    { from: 135000, ratePct: 37 },
    { from: 190000, ratePct: 45 },
  ],
  medicareLevyPct: 2,
};

test('income tax walks the brackets and adds the levy', () => {
  assert.equal(incomeTax(0, TAX_YEAR), 0);
  assert.equal(incomeTax(18200, TAX_YEAR), 364); // levy only
  // 26800 × 15% + 55000 × 30% + 100000 × 2% = 4020 + 16500 + 2000
  assert.equal(incomeTax(100000, TAX_YEAR), 22520);
  assert.equal(incomeTax(100000, { ...TAX_YEAR, medicareLevyPct: 0 }), 20520);
});

test('grossForNet inverts incomeTax exactly, in every bracket', () => {
  for (const net of [0, 10000, 30000, 60000, 80000, 120000, 150000, 250000]) {
    const g = grossForNet(net, TAX_YEAR);
    assert.equal(round2(g - incomeTax(g, TAX_YEAR)), net, 'net ' + net);
  }
});

test('an unusable tax year gives no tax figure, never a zero bill', () => {
  for (const bad of [null, {}, { brackets: [], medicareLevyPct: 2 }, { ...TAX_YEAR, medicareLevyPct: null },
    { ...TAX_YEAR, brackets: [{ from: 0, ratePct: 99 }] }, 0.35]) {
    assert.equal(incomeTax(50000, bad), null);
    assert.equal(grossForNet(50000, bad), null);
  }
});

test('target annual revenue adds business cost untaxed, and grosses up only the pay', () => {
  const r = revenueTarget(26850, 80000, TAX_YEAR);
  const gross = grossForNet(80000, TAX_YEAR);
  assert.equal(r.grossPay, gross);
  assert.equal(r.incomeTax, round2(gross - 80000));
  assert.equal(r.total, round2(26850 + gross));
  assert.equal(targetAnnualRevenue(26850, 80000, TAX_YEAR), r.total);
  // Well under the old flat-rate-on-everything figure of $164,384.62.
  assert.ok(r.total < 164384.62);
});

test('super and a bad-debt allowance are added on top', () => {
  const base = revenueTarget(26850, 80000, TAX_YEAR);
  const r = revenueTarget(26850, 80000, TAX_YEAR, { superPct: 12, badDebtPct: 2 });
  assert.equal(r.superContribution, round2(base.grossPay * 0.12));
  const needed = round2(26850 + base.grossPay + r.superContribution);
  assert.equal(r.total, round2(needed / 0.98));
  // The printed parts add up to the printed total, to the cent.
  assert.equal(
    round2(r.businessCost + r.grossPay + r.superContribution + r.badDebtAllowance),
    r.total,
  );
});

test('no revenue target without cost, income, a tax year, or with 100% bad debt', () => {
  assert.equal(targetAnnualRevenue(0, 70000, TAX_YEAR), null);
  assert.equal(targetAnnualRevenue(null, 70000, TAX_YEAR), null);
  assert.equal(targetAnnualRevenue(24000, null, TAX_YEAR), null);
  // The old flat-rate argument is not a tax year: no silent zero-tax answer.
  assert.equal(targetAnnualRevenue(24000, 70000, 0.35), null);
  assert.equal(targetAnnualRevenue(24000, 70000, TAX_YEAR, { badDebtPct: 100 }), null);
});

test('the income floor is the revenue target spread across billable hours', () => {
  const target = targetAnnualRevenue(26850, 80000, TAX_YEAR);
  assert.equal(incomeFloorPerHour(target, 1776), round2(target / 1776));
  assert.equal(incomeFloorPerHour(null, 1776), null);
  assert.equal(incomeFloorPerHour(target, 0), null);
});

test('taxRatesAt gives the effective and marginal rate, levy included', () => {
  const r = taxRatesAt(100000, TAX_YEAR);
  assert.equal(r.effectivePct, 22.52);
  assert.equal(r.marginalPct, 32);
});

/* ── The 2026-09-28 audit's precision and input fixes ─────────────────────── */

const ONE_ROW = (mu) => ({ labourSections: [{ id: 'a', rows: [{ id: 'r1', name: 'x', mu }] }], travelRows: [], taxSetAsideRate: 0.35 });

test('ex-GST + GST always equals the total, to the cent, in both GST modes', () => {
  for (const inc of [true, false]) {
    const settings = settingsWith({ registered: true, rate: 0.1, pricesIncludeGst: inc });
    for (let cents = 1; cents <= 20000; cents += 1) {
      const t = computeTotals({ a: [{ name: 'x', qty: 1 }] }, ONE_ROW(cents / 100), settings);
      assert.equal(Math.round((t.clientPriceExGst + t.gst) * 100), Math.round(t.totalIncGst * 100),
        (inc ? 'inclusive ' : 'exclusive ') + cents / 100);
    }
  }
  // The audit's example: $3.65 used to print $3.65 + $0.37 = $4.01.
  const t = computeTotals({ a: [{ name: 'x', qty: 1 }] }, ONE_ROW(3.65), settingsWith(GST_EXCLUSIVE));
  assert.deepEqual([t.clientPriceExGst, t.gst, t.totalIncGst], [3.65, 0.37, 4.02]);
});

test('negative quantities, days and costs price as nothing, never a negative invoice', () => {
  const t = computeTotals(
    { a: [{ name: 'x', qty: -3, override: -50 }], crew: [{ days: -1, cost: 500 }], equip: [{ days: 2, cost: -100 }] },
    ONE_ROW(100),
    settingsWith(GST_EXCLUSIVE),
  );
  assert.deepEqual([t.clientPriceExGst, t.gst, t.totalIncGst, t.totalHours, t.taxSetAside], [0, 0, 0, 0, 0]);
});

test('a saved line prices from its own snapshot, not from today\'s card', () => {
  const saved = { a: [{ name: 'x', qty: 2, rowId: 'r1', mu: 100 }] };
  // The card has since gone up to 150, and the row has been renamed.
  const card = { labourSections: [{ id: 'a', rows: [{ id: 'r1', name: 'renamed', mu: 150 }] }], travelRows: [], taxSetAsideRate: 0.35 };
  assert.equal(computeTotals(saved, card, DEFAULT_SETTINGS).labourTotal, 200);
});

test('a line without a snapshot falls back to the card by row id, then by name', () => {
  const card = { labourSections: [{ id: 'a', rows: [{ id: 'r1', name: 'renamed', mu: 150 }] }], travelRows: [], taxSetAsideRate: 0.35 };
  assert.equal(computeTotals({ a: [{ name: 'x', rowId: 'r1', qty: 2 }] }, card, DEFAULT_SETTINGS).labourTotal, 300);
  assert.equal(computeTotals({ a: [{ name: 'renamed', qty: 2 }] }, card, DEFAULT_SETTINGS).labourTotal, 300);
  // A legacy line whose service is gone still prices at nothing, as before.
  assert.equal(computeTotals({ a: [{ name: 'gone', qty: 2 }] }, card, DEFAULT_SETTINGS).labourTotal, 0);
});

test('a snapshotted line in a deleted category still prices', () => {
  const card = { labourSections: [], travelRows: [], taxSetAsideRate: 0.35 };
  const t = computeTotals({ oldcat: [{ name: 'x', qty: 3, mu: 50 }] }, card, DEFAULT_SETTINGS);
  assert.equal(t.labourTotal, 150);
  assert.equal(t.totalHours, 3);
});

test('lineSnapshot copies a row\'s price fields and billing flag, and nothing else', () => {
  assert.deepEqual(lineSnapshot({ id: 'r1', name: 'Full', mu: 1120, rate: 15, hoursPerUnit: 8, dayUnit: 'full', customBill: true, unit: 'x' }),
    { mu: 1120, rowId: 'r1', hoursPerUnit: 8, dayUnit: 'full', rate: 15, customBill: true });
  assert.deepEqual(lineSnapshot({ name: 'Fuel', mu: 1, rate: 1, directCost: true }), { mu: 1, rate: 1, directCost: true });
});

test('own-time travel is income in full and its hours carry overhead', () => {
  const card = { labourSections: [], travelRows: [{ id: 't1', name: 'Driving', rate: 25, mu: 35, ownTime: true }], taxSetAsideRate: 0.35 };
  const t = computeTotals({ travel: [{ name: 'Driving', qty: 4 }] }, card, DEFAULT_SETTINGS);
  assert.equal(t.incomeExGst, 140);
  assert.equal(t.totalHours, 4);
  assert.equal(t.directJobCost, 0);
  assert.equal(labourHoursBreakdown({ travel: [{ name: 'Driving', qty: 4 }] }, card).totalHours, 4);
});

test('jobs needed rounds a fraction of a job up, even a small one', () => {
  assert.equal(jobsNeededPerYear(110040, 10000), 12);
  assert.equal(jobsNeededPerYear(110000, 10000), 11);
});

test('the replacement reserve is net of expected resale value', () => {
  const asset = { replacementCostEstimate: 9000, replacementCycleYears: 3, expectedResaleValue: 3000, businessUsePct: 100 };
  assert.equal(replacementReserveTotal([asset]), 2000);
  // A resale guess above the replacement cost reserves nothing, not a negative.
  assert.equal(replacementReserveTotal([{ ...asset, expectedResaleValue: 12000 }]), 0);
});

/* ── Service units (service rate tiers, 2026-09-28) ───────────────────────── */

const SU_NO_GST = settingsWith({ registered: false });
const SU_GST_INC = settingsWith({ registered: true, rate: 0.1, pricesIncludeGst: true });
const SU_GST_EXC = settingsWith({ registered: true, rate: 0.1, pricesIncludeGst: false });

test('unitHours: an hour is 1, a service day is the card\'s own 8 / 4', () => {
  const card = { serviceDay: { fullHours: 10, halfHours: 5 } };
  assert.equal(unitHours(card, 'hour'), 1);
  assert.equal(unitHours(card, 'full'), 10);
  assert.equal(unitHours(card, 'half'), 5);
  assert.equal(unitHours({ serviceDay: { fullHours: 7.5, halfHours: 3.5 } }, 'full'), 7.5);
  // No serviceDay at all: the 8 / 4 a day on a job is by default.
  assert.equal(unitHours({}, 'full'), 8);
  assert.equal(unitHours(undefined, 'half'), 4);
  // Anything that is not half or full is an hour.
  assert.equal(unitHours(card, 'fortnight'), 1);
});

test('unitHours: an unusable service day falls back to 8 / 4, never to 0', () => {
  for (const bad of [0, -8, 25, 'abc', '', null, undefined, NaN]) {
    const card = { serviceDay: { fullHours: bad, halfHours: bad } };
    assert.equal(unitHours(card, 'full'), 8, 'full day from ' + String(bad));
    assert.equal(unitHours(card, 'half'), 4, 'half day from ' + String(bad));
  }
  assert.equal(unitHours({ serviceDay: { fullHours: 24 } }, 'full'), 24);
});

test('serviceDayOk: 0.5 to 24 hours in half hours, a number only; unitHours stays looser', () => {
  for (const ok of [0.5, 1, 4, 7.5, 8, 23.5, 24]) assert.equal(serviceDayOk(ok), true, String(ok));
  for (const bad of [0, 0.25, 7.3, 24.5, -4, '8', '', null, undefined, NaN, Infinity]) {
    assert.equal(serviceDayOk(bad), false, String(bad));
  }
  // A figure mid-typing prices as typed; only saving it is refused.
  assert.equal(unitHours({ serviceDay: { fullHours: 7.3 } }, 'full'), 7.3);
});

test('cardShapeOutdated: the v8 card is outdated, the v9 default is not, and one old row is enough', () => {
  assert.equal(cardShapeOutdated(DEFAULT_PRICING), false);
  assert.equal(cardShapeOutdated(V8_DEFAULT_PRICING), true);
  assert.equal(cardShapeOutdated(null), true);

  const withRow = (row) => {
    const c = JSON.parse(JSON.stringify(DEFAULT_PRICING));
    c.labourSections[0].rows[0] = row;
    return c;
  };
  const prices = { hour: 140, half: null, full: null };
  assert.equal(cardShapeOutdated(withRow({ name: 'A', prices })), false);
  assert.equal(cardShapeOutdated(withRow({ name: 'A', mu: 140, prices })), true);
  assert.equal(cardShapeOutdated(withRow({ name: 'A', hoursPerUnit: 8, prices })), true);
  assert.equal(cardShapeOutdated(withRow({ name: 'A', dayUnit: 'full', prices })), true);
  assert.equal(cardShapeOutdated(withRow({ name: 'A' })), true);
  assert.equal(cardShapeOutdated(withRow({ name: 'A', prices: [140, null, null] })), true);
  assert.equal(cardShapeOutdated(withRow(null)), true);
  // Every row in the new shape, but no service day: what a v9 screen that
  // filled one in for itself would otherwise have been left to guess at.
  const { serviceDay, ...noDay } = DEFAULT_PRICING;
  assert.ok(serviceDay);
  assert.equal(cardShapeOutdated(noDay), true);
  assert.equal(cardShapeOutdated({ ...DEFAULT_PRICING, serviceDay: 8 }), true);
  // Travel rows keep `mu`: one price, no units.
  assert.ok(DEFAULT_PRICING.travelRows.some((r) => r.mu !== undefined));
});

test('suggestedPrice: $45.05 an hour at 25% markup is $57, rounded up from $56.31', () => {
  assert.equal(suggestedPrice(45.05, 1, 25, SU_NO_GST), 57);
  // Registered but pricing GST-exclusive: the card price carries no GST.
  assert.equal(suggestedPrice(45.05, 1, 25, SU_GST_EXC), 57);
  // pricesIncludeGst means nothing while unregistered.
  assert.equal(suggestedPrice(45.05, 1, 25, settingsWith({ registered: false, pricesIncludeGst: true })), 57);
});

test('suggestedPrice: a figure already on a whole dollar stays there, float noise and all', () => {
  // 4.48 × 10 × 1.25 is 56.00000000000001 in floating point; a bare ceil says $57.
  assert.equal(4.48 * 10 * 1.25 > 56, true);
  assert.equal(suggestedPrice(4.48, 10, 25, SU_NO_GST), 56);
  assert.equal(4.56 * 10 * 1.25 < 57, true);
  assert.equal(suggestedPrice(4.56, 10, 25, SU_NO_GST), 57);
  assert.equal(suggestedPrice(45.6, 1, 25, SU_NO_GST), 57);
});

test('suggestedPrice: 0% markup is the floor rounded up; unset markup is no price', () => {
  assert.equal(suggestedPrice(45.05, 1, 0, SU_NO_GST), 46);
  assert.equal(suggestedPrice(45, 1, 0, SU_NO_GST), 45);
  assert.equal(suggestedPrice(45, 1, '0', SU_NO_GST), 45);
  for (const markup of [null, undefined, '', -5, 'abc']) {
    assert.equal(suggestedPrice(45.05, 1, markup, SU_NO_GST), null, 'markup ' + String(markup));
  }
});

test('suggestedPrice: no income floor is no price, not $0', () => {
  for (const floor of [null, undefined, '', 0, -10]) {
    assert.equal(suggestedPrice(floor, 8, 25, SU_NO_GST), null, 'floor ' + String(floor));
  }
  assert.equal(suggestedPrice(45.05, 0, 25, SU_NO_GST), null);
});

test('suggestedPrice: a GST-inclusive card puts GST inside the auto price', () => {
  // $56.31 ex GST is $61.94 inc; up to $62, which is $56.36 ex GST.
  assert.equal(suggestedPrice(45.05, 1, 25, SU_GST_INC), 62);
  assert.ok(priceExGst(62, SU_GST_INC) >= 56.31);
});

test('suggestedPrice: a GST-inclusive auto price never falls a cent under its target', () => {
  // The brief's literal recipe (× 1.1, cent-round, ceil) gives $41 here, which is
  // $37.27 ex GST against a $37.28 floor. The search against priceExGst gives $42.
  assert.equal(round2(4.97 * 7.5), 37.28);
  assert.equal(priceExGst(41, SU_GST_INC), 37.27);
  assert.equal(suggestedPrice(4.97, 7.5, 0, SU_GST_INC), 42);

  let checked = 0;
  for (let cents = 1; cents <= 30000; cents += 7) {
    const floor = cents / 100;
    for (const hours of [1, 0.5, 4, 4.5, 7.5, 8, 10]) {
      for (const markup of [0, 12.5, 25]) {
        const target = round2(floor * hours * (1 + markup / 100));
        for (const settings of [SU_NO_GST, SU_GST_INC]) {
          const p = suggestedPrice(floor, hours, markup, settings);
          const exact = floor * hours * (1 + markup / 100);
          const exGst = (price) => (settings === SU_GST_INC ? price / 1.1 : price);
          assert.ok(Number.isInteger(p), 'whole dollars');
          assert.ok(priceExGst(p, settings) >= target, `${floor} × ${hours} @ ${markup}% → ${p}`);
          // Against the exact target, float noise aside…
          assert.ok(exGst(p) >= exact - 1e-8, `${p} is under the exact ${exact}`);
          // …and it is the least such dollar: rounding up, not padding.
          assert.ok(p === 0 || exGst(p - 1) < exact - 1e-8, `${p} is not the least dollar`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 100000);
});

test('suggestedPrice: the hours it is given are rounded as one figure', () => {
  assert.equal(suggestedPrice(45.05, 1, 25, SU_NO_GST), 57);
  assert.equal(suggestedPrice(45.05, 8, 25, SU_NO_GST), 451); // $450.50 up, not 8 × $57 = $456
  assert.equal(suggestedPrice(45.05, 4, 25, SU_NO_GST), 226); // $225.25 up
});

const TIERED = {
  serviceDay: { fullHours: 8, halfHours: 4 },
  labourSections: [{
    id: 'prod',
    label: 'Production',
    rows: [
      { id: 'vc', name: 'Video Capture', rate: 15, prices: { hour: 139.5, half: null, full: 1120 } },
      { id: 'dr', name: 'Drone', rate: 15, customBill: true, prices: { hour: null, half: null, full: null } },
    ],
  }],
  travelRows: [],
  taxSetAsideRate: 0.35,
};
const CTX = { floorPerHour: 45.05, markupPct: 25, settings: SU_NO_GST };

test('unitDef: a set-by-you price comes back exactly as stored, unrounded', () => {
  const def = unitDef(TIERED.labourSections[0].rows[0], 'hour', TIERED, CTX);
  assert.deepEqual(def, { id: 'vc', name: 'Video Capture', mu: 139.5, auto: false, rate: 15, hoursPerUnit: 1 });
  assert.equal('dayUnit' in def, false, 'an hour carries no dayUnit');
  assert.deepEqual(unitDef(TIERED.labourSections[0].rows[0], 'full', TIERED, CTX),
    { id: 'vc', name: 'Video Capture', mu: 1120, auto: false, rate: 15, hoursPerUnit: 8, dayUnit: 'full' });
  // A typed 0 is a price, not auto.
  assert.deepEqual(unitDef({ id: 'z', name: 'Z', prices: { hour: 0 } }, 'hour', TIERED, CTX).mu, 0);
});

test('unitDef: one service can mix set-by-you and auto units', () => {
  const row = TIERED.labourSections[0].rows[0];
  const half = unitDef(row, 'half', TIERED, CTX);
  assert.equal(half.auto, true);
  assert.equal(half.mu, 558); // the typed $139.50 an hour × 4
  assert.equal(half.hoursPerUnit, 4);
  assert.equal(half.dayUnit, 'half');
  assert.equal(unitDef(row, 'hour', TIERED, CTX).auto, false);
});

test('unitDef: an auto unit follows the service day and the goals', () => {
  const row = TIERED.labourSections[0].rows[1];
  assert.equal(unitDef(row, 'full', TIERED, CTX).mu, 456); // the auto $57 an hour × 8
  assert.equal(unitDef(row, 'full', { ...TIERED, serviceDay: { fullHours: 10, halfHours: 5 } }, CTX).mu, 570);
  assert.equal(unitDef(row, 'hour', TIERED, { ...CTX, markupPct: 0 }).mu, 46);
  assert.equal(unitDef(row, 'hour', TIERED, { ...CTX, settings: SU_GST_INC }).mu, 62);
  assert.equal(unitDef(row, 'hour', TIERED, CTX).customBill, true);
});

test('unitDef: an auto day is the service\'s hourly price × the day\'s hours', () => {
  const svc = (hour, half = null, full = null) => ({ id: 's', name: 'S', prices: { hour, half, full } });
  // Typed $140 an hour: the day follows it, whatever the floor says.
  assert.equal(unitDef(svc(140), 'full', TIERED, CTX).mu, 1120);
  assert.equal(unitDef(svc(140), 'half', TIERED, CTX).mu, 560);
  assert.equal(unitDef(svc(140), 'full', TIERED, undefined).mu, 1120, 'no floor needed');
  // To the cent, not rounded up: a typed hour may carry cents, and a day may be 7.5 hrs.
  assert.equal(unitDef(svc(139.55), 'full', TIERED, CTX).mu, 1116.4);
  const short = { ...TIERED, serviceDay: { fullHours: 7.5, halfHours: 3.5 } };
  assert.equal(unitDef(svc(57), 'full', short, CTX).mu, 427.5);
  assert.equal(unitDef(svc(57), 'half', short, CTX).mu, 199.5);
  // Auto $57 an hour: the day is 8 of those ($456), not the day rounded on its own ($451).
  assert.equal(unitDef(svc(null), 'full', TIERED, CTX).mu, 456);
  // A GST-inclusive card: $62 an hour, GST in, and so is the day.
  assert.equal(unitDef(svc(null), 'full', TIERED, { ...CTX, settings: SU_GST_INC }).mu, 496);
  // A typed day price wins, and is its own figure.
  assert.equal(unitDef(svc(140, 640), 'half', TIERED, CTX).mu, 640);
  assert.equal(unitDef(svc(140, 640), 'half', TIERED, CTX).auto, false);
  assert.equal(unitDef(svc(140, 640), 'full', TIERED, CTX).mu, 1120);
  // A typed $0 an hour is a price, so the day built on it is $0 (and will badge).
  assert.equal(unitDef(svc(0), 'full', TIERED, CTX).mu, 0);
  // No hourly price at all: no day price either, never $0.
  assert.equal(unitDef(svc(null), 'full', TIERED, { ...CTX, floorPerHour: null }).mu, null);
});

test('unitDef: an auto unit with no floor or no markup has no price, never $0', () => {
  const row = TIERED.labourSections[0].rows[1];
  for (const ctx of [undefined, {}, { ...CTX, floorPerHour: null }, { ...CTX, markupPct: null }]) {
    const def = unitDef(row, 'full', TIERED, ctx);
    assert.equal(def.mu, null);
    assert.equal(def.auto, true);
  }
  // A row with no prices object at all is all auto.
  assert.equal(unitDef({ id: 'x', name: 'X' }, 'hour', TIERED, CTX).mu, 57);
});

test('unitDef: no row, or a unit off the list, resolves to nothing', () => {
  assert.equal(unitDef(null, 'hour', TIERED, CTX), null);
  assert.equal(unitDef(TIERED.labourSections[0].rows[0], 'week', TIERED, CTX), null);
  assert.equal(unitDef(TIERED.labourSections[0].rows[0], undefined, TIERED, CTX), null);
});

test('a line added from unitDef snapshots and totals exactly as the old flat day row did', () => {
  const oldRow = { id: 'vc', name: 'Video Capture', rate: 15, mu: 1120, dayUnit: 'full', hoursPerUnit: 8 };
  const def = unitDef(TIERED.labourSections[0].rows[0], 'full', TIERED, CTX);
  assert.deepEqual(lineSnapshot(def), lineSnapshot(oldRow));

  const oldHalf = { id: 'vc', name: 'Video Capture', rate: 15, mu: 558, dayUnit: 'half', hoursPerUnit: 4 };
  assert.deepEqual(lineSnapshot(unitDef(TIERED.labourSections[0].rows[0], 'half', TIERED, CTX)), lineSnapshot(oldHalf));

  const line = (d) => ({ name: 'Video Capture', qty: 2, ...lineSnapshot(d) });
  const oldCard = { labourSections: [{ id: 'prod', rows: [oldRow] }], travelRows: [], taxSetAsideRate: 0.35 };
  const before = computeTotals({ prod: [line(oldRow)] }, oldCard, SU_NO_GST);
  const after = computeTotals({ prod: [line(def)] }, TIERED, SU_NO_GST);
  assert.deepEqual(after, before);
  assert.equal(after.labourTotal, 2240);
  assert.equal(after.totalHours, 16);
});

test('an hourly line from unitDef totals as an hourly row always has', () => {
  const def = unitDef(TIERED.labourSections[0].rows[0], 'hour', TIERED, CTX);
  const t = computeTotals({ prod: [{ name: 'Video Capture', qty: 3, ...lineSnapshot(def) }] }, TIERED, SU_NO_GST);
  assert.equal(t.labourTotal, 418.5);
  assert.equal(t.totalHours, 3);
});

/* serviceFloorComparison: one entry per service, three units each. */

test('serviceFloorComparison: each unit is set against floorPerHour × its own hours', () => {
  const [vc, dr] = serviceFloorComparison(TIERED, SU_NO_GST, 45.05, { markupPct: 25 });
  assert.equal(vc.sectionId, 'prod');
  assert.equal(vc.sectionLabel, 'Production');
  assert.equal(vc.name, 'Video Capture');
  assert.equal(vc.rowIndex, 0);
  assert.equal(dr.rowIndex, 1);
  assert.deepEqual(Object.keys(vc.units), ['hour', 'half', 'full']);

  assert.deepEqual(vc.units.hour, { mu: 139.5, muExGst: 139.5, auto: false, hoursPerUnit: 1, floor: 45.05, gap: 0, belowFloor: false });
  assert.deepEqual(vc.units.full, { mu: 1120, muExGst: 1120, auto: false, hoursPerUnit: 8, floor: 360.4, gap: 0, belowFloor: false });
  assert.deepEqual(vc.units.half, { mu: 558, muExGst: 558, auto: true, hoursPerUnit: 4, floor: 180.2, gap: 0, belowFloor: false });
  assert.equal(dr.units.full.mu, 456);

  // The floor per unit is the hourly floor × the card's own day, to the cent.
  const card = { ...TIERED, serviceDay: { fullHours: 7.5, halfHours: 3.5 } };
  for (const perHour of [45.05, 31.27, 0.01, 123.456]) {
    const [s] = serviceFloorComparison(card, SU_NO_GST, perHour, { markupPct: 25 });
    for (const unit of SERVICE_UNITS) {
      assert.equal(s.units[unit].floor, round2(perHour * unitHours(card, unit)), `${unit} at ${perHour}`);
    }
  }
});

test('serviceFloorComparison: a set-by-you unit $1 under its floor badges a $1 gap', () => {
  // Full-day floor at $45.05 × 8 = $360.40. Typed $359.40 is $1 under; $360.40 is at it.
  const card = { serviceDay: { fullHours: 8, halfHours: 4 }, labourSections: [{ id: 'p', label: 'P', rows: [
    { id: 'a', name: 'Under', rate: 999, prices: { hour: 44.95, half: null, full: 359.4 } },
    { id: 'b', name: 'At', prices: { hour: 45.05, half: null, full: 360.4 } },
    { id: 'c', name: 'Free', prices: { hour: 0, half: null, full: null } },
  ] }] };
  const [under, at, free] = serviceFloorComparison(card, SU_NO_GST, 45.05, { markupPct: 25 });
  assert.equal(under.units.full.belowFloor, true);
  assert.equal(under.units.full.gap, 1);
  // `rate` plays no part: Under's internal rate of $999 doesn't rescue it.
  // A gap is money, in cents: 45.05 − 44.95 is 0.0999… in floating point.
  assert.equal(under.units.hour.gap, 0.1);
  // Exactly at the floor is not below it.
  assert.equal(at.units.full.belowFloor, false);
  assert.equal(at.units.hour.belowFloor, false);
  assert.equal(at.units.full.gap, 0);
  // A typed $0 is a price, and the lowest one there is.
  assert.equal(free.units.hour.auto, false);
  assert.equal(free.units.hour.belowFloor, true);
  assert.equal(free.units.hour.gap, 45.05);
});

test('serviceFloorComparison: a GST-inclusive price is compared ex GST', () => {
  const card = { serviceDay: { fullHours: 8, halfHours: 4 }, labourSections: [{ id: 'x', label: 'X', rows: [
    { id: 'r', name: 'Row', prices: { hour: 33, half: null, full: null } },
  ] }] };
  // $33 inc GST is $30 ex — under a $31.25 floor by $1.25. Read raw it would pass.
  const [row] = serviceFloorComparison(card, SU_GST_INC, 31.25, { markupPct: 25 });
  assert.equal(row.units.hour.mu, 33);
  assert.equal(row.units.hour.muExGst, 30);
  assert.equal(row.units.hour.belowFloor, true);
  assert.equal(row.units.hour.gap, 1.25);
  assert.equal(serviceFloorComparison(card, SU_NO_GST, 31.25, { markupPct: 25 })[0].units.hour.belowFloor, false);
});

test('serviceFloorComparison: an auto unit is never below its floor', () => {
  let checked = 0;
  for (const settings of [SU_NO_GST, SU_GST_EXC, SU_GST_INC]) {
    for (const serviceDay of [{ fullHours: 8, halfHours: 4 }, { fullHours: 7.5, halfHours: 3.5 }, { fullHours: 10, halfHours: 5 }]) {
      const card = { serviceDay, labourSections: [{ id: 'p', label: 'P', rows: [{ id: 'a', name: 'All auto', prices: { hour: null, half: null, full: null } }] }] };
      // Whole-cent floors, and unrounded ones like a real income floor (a
      // quotient): an hourly price a fraction of a cent short would be a
      // whole cent short over a day.
      for (let cents = 1; cents <= 20000; cents += 13) {
        for (const floor of [cents / 100, cents / 100 + 0.0041, cents / 99.7]) {
        for (const markup of [0, 0.5, 12.5, 25, 100]) {
          const [s] = serviceFloorComparison(card, settings, floor, { markupPct: markup });
          for (const unit of SERVICE_UNITS) {
            const u = s.units[unit];
            assert.equal(u.auto, true);
            assert.equal(u.belowFloor, false, `${floor}/hr ${unit} @ ${markup}% → $${u.mu} (${u.muExGst} ex) vs ${u.floor}`);
            assert.equal(u.gap, 0);
            checked++;
          }
        }
        }
      }
    }
  }
  assert.ok(checked > 100000);
});

test('serviceFloorComparison: no price or no floor is "can\'t tell", not "fine" or "below"', () => {
  // No markup: an auto hour has no price, nor has a day built on one. The
  // typed ones, and a day built on a typed hour, are still compared.
  const [vc, dr] = serviceFloorComparison(TIERED, SU_NO_GST, 45.05, { markupPct: null });
  for (const unit of SERVICE_UNITS) {
    assert.equal(dr.units[unit].mu, null, unit);
    assert.equal(dr.units[unit].muExGst, null, unit);
    assert.equal(dr.units[unit].belowFloor, null, unit);
    assert.equal(dr.units[unit].gap, null, unit);
  }
  assert.equal(dr.units.half.floor, 180.2);
  assert.equal(vc.units.hour.belowFloor, false);
  assert.equal(vc.units.half.mu, 558);
  assert.equal(vc.units.half.belowFloor, false);
  // No ctx at all is the same as no markup.
  assert.equal(serviceFloorComparison(TIERED, SU_NO_GST, 45.05)[1].units.half.mu, null);

  // No floor: nothing can be told, typed or auto.
  for (const floor of [null, 0, -5, '']) {
    for (const s of serviceFloorComparison(TIERED, SU_NO_GST, floor, { markupPct: 25 })) {
      for (const unit of SERVICE_UNITS) {
        assert.equal(s.units[unit].floor, null);
        assert.equal(s.units[unit].belowFloor, null, `${s.name} ${unit} with floor ${String(floor)}`);
        assert.equal(s.units[unit].gap, null);
      }
    }
  }
});

test('serviceFloorComparison: an auto price comes from the floor it is compared with, not ctx\'s', () => {
  // A ctx carrying a different floor must not price the auto unit off it.
  const [dr] = serviceFloorComparison(TIERED, SU_NO_GST, 45.05, { floorPerHour: 10, markupPct: 25, settings: SU_GST_INC }).slice(1);
  assert.equal(dr.units.hour.mu, 57);
  assert.equal(dr.units.full.mu, 456);
});

test('serviceFloorComparison: labour services only, never travel', () => {
  const card = { ...TIERED, travelRows: [{ id: 't', name: 'Transport & Logistics Hrs', rate: 25, mu: 1, ownTime: true }] };
  const rows = serviceFloorComparison(card, SU_NO_GST, 45.05, { markupPct: 25 });
  assert.equal(rows.length, 2);
  assert.ok(!rows.some((r) => r.name === 'Transport & Logistics Hrs'));
  assert.deepEqual(serviceFloorComparison(undefined, SU_NO_GST, 45.05, { markupPct: 25 }), []);
});

/* lineDef's no-snapshot fallback on a service with three prices. */

test('lineDef: a line with no snapshot prices from its service\'s typed price for its unit', () => {
  const rows = TIERED.labourSections[0].rows;
  // Found by id, an hour: Video Capture's typed $139.50.
  const hour = lineDef(rows, { rowId: 'vc', name: 'Old name', qty: 2 }, TIERED);
  assert.equal(hour.mu, 139.5);
  assert.equal(hour.hoursPerUnit, 1);
  assert.equal('dayUnit' in hour, false);
  // Found by name, at a day unit the line names: the typed $1,120 full day.
  const full = lineDef(rows, { name: 'Video Capture', qty: 1, dayUnit: 'full' }, TIERED);
  assert.equal(full.mu, 1120);
  assert.equal(full.hoursPerUnit, 8);
  assert.equal(full.dayUnit, 'full');
  // The card's own service day, not 8 / 4.
  const long = { ...TIERED, serviceDay: { fullHours: 10, halfHours: 5 } };
  assert.equal(lineDef(rows, { name: 'Video Capture', dayUnit: 'full' }, long).hoursPerUnit, 10);
});

test('lineDef: a unit that needs the floor has no price on the fallback path, and prices at nothing', () => {
  const rows = TIERED.labourSections[0].rows;
  // The server has no floor, so an auto hour cannot be priced — not $0, not
  // guessed — and nor can a day built on one.
  for (const dayUnit of [undefined, 'half', 'full']) {
    assert.equal(lineDef(rows, { rowId: 'dr', name: 'Drone', dayUnit }, TIERED), null, String(dayUnit));
  }
  // An auto day on a typed hour needs no floor: $139.50 × 4.
  const half = lineDef(rows, { rowId: 'vc', name: 'Video Capture', dayUnit: 'half' }, TIERED);
  assert.deepEqual([half.mu, half.auto, half.hoursPerUnit], [558, true, 4]);

  const t = computeTotals({ prod: [
    { rowId: 'vc', name: 'Video Capture', qty: 2 },               // typed hour: 2 × 139.5
    { rowId: 'vc', name: 'Video Capture', qty: 1, dayUnit: 'full' }, // typed full day: 1120, 8 hrs
    { rowId: 'vc', name: 'Video Capture', qty: 1, dayUnit: 'half' }, // auto half on the typed hour: 558, 4 hrs
    { rowId: 'dr', name: 'Drone', qty: 3 },                       // auto: nothing, like a lost row
  ] }, TIERED, SU_NO_GST);
  assert.equal(t.labourTotal, 1957);
  assert.equal(t.totalHours, 14);
  assert.equal(labourHoursBreakdown({ prod: [{ rowId: 'dr', name: 'Drone', qty: 3 }] }, TIERED).totalHours, 0);

  // Totals and the hours breakdown hand the card through, so a 10-hour service
  // day counts 10 hours, not the 8-hour fallback.
  const long = { ...TIERED, serviceDay: { fullHours: 10, halfHours: 5 } };
  const dayLine = { prod: [{ rowId: 'vc', name: 'Video Capture', qty: 1, dayUnit: 'full' }] };
  assert.equal(computeTotals(dayLine, long, SU_NO_GST).totalHours, 10);
  assert.equal(labourHoursBreakdown(dayLine, long).totalHours, 10);
});

test('lineDef: a snapshot and a flat row are untouched by the prices path', () => {
  const rows = TIERED.labourSections[0].rows;
  const snapped = { rowId: 'dr', name: 'Drone', qty: 1, mu: 99, hoursPerUnit: 4, dayUnit: 'half' };
  assert.equal(lineDef(rows, snapped, TIERED), snapped);
  const flat = { id: 'f', name: 'Flat', mu: 80 };
  assert.equal(lineDef([flat], { rowId: 'f', name: 'Flat' }), flat);
  assert.equal(lineDef(rows, { rowId: 'gone', name: 'Gone' }, TIERED), null);
});

test('SERVICE_UNITS lists the units in the order the screens show them', () => {
  assert.deepEqual(SERVICE_UNITS, ['hour', 'half', 'full']);
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

/**
 * THE COST OF THE BUSINESS
 *
 * annualBusinessCost = operating costs + the gear replacement reserve. The
 * reserve is straight-line over the user's OWN replacement cycle against the
 * REPLACEMENT cost, apportioned by business use — deliberately not the ATO
 * depreciation figure, which exists separately for the accountant and is meant
 * to disagree.
 */
const CAMERA = {
  name: 'A7S III',
  replacement_cost_estimate: 6000,
  replacement_cycle_years: 3,
  business_use_pct: 100,
};

test('the replacement reserve is replacement cost over the user’s own cycle', () => {
  // $6,000 body replaced every 3 years = $2,000 a year to put aside.
  assert.equal(replacementReserveTotal([CAMERA]), 2000);
});

test('a part-business asset contributes only its business share', () => {
  // business_use_pct is a PERCENT (50 means 50%), matching migration v5 and
  // goals.target_profit_margin_pct. A 0.5 here would mean half of one percent.
  assert.equal(replacementReserveTotal([{ ...CAMERA, business_use_pct: 50 }]), 1000);
  assert.equal(replacementReserveTotal([{ ...CAMERA, business_use_pct: 0.5 }]), 10);
  assert.equal(replacementReserveTotal([{ ...CAMERA, business_use_pct: 0 }]), 0);

  // Missing reads as 100%, matching the column DEFAULT and erring towards
  // keeping a cost in rather than silently dropping one.
  const { business_use_pct, ...noPct } = CAMERA;
  assert.equal(replacementReserveTotal([noPct]), 2000);
});

test('a disposed asset stops inflating overhead immediately', () => {
  // Sold gear leaves the reserve the moment it is marked disposed. It stays on
  // its disposal year's TAX schedule for the balancing adjustment — a different
  // chain, and the two are meant to disagree about a sold camera.
  assert.equal(replacementReserveTotal([{ ...CAMERA, disposal_date: '2026-03-01' }]), 0);
  assert.equal(replacementReserveTotal([{ ...CAMERA, disposalDate: '2026-03-01' }]), 0);

  // Still held: every "no disposal" shape the row can arrive in.
  for (const held of [null, undefined, '']) {
    assert.equal(replacementReserveTotal([{ ...CAMERA, disposal_date: held }]), 2000);
  }
});

test('an asset with no replacement plan contributes nothing, and never Infinity', () => {
  // Both columns are nullable: gear can be entered for tax purposes only.
  assert.equal(replacementReserveTotal([{ ...CAMERA, replacement_cost_estimate: null }]), 0);
  assert.equal(replacementReserveTotal([{ ...CAMERA, replacement_cycle_years: null }]), 0);
  // A zero cycle must not divide into infinity.
  assert.equal(replacementReserveTotal([{ ...CAMERA, replacement_cycle_years: 0 }]), 0);
  assert.equal(replacementReserveTotal([{ ...CAMERA, replacement_cycle_years: -2 }]), 0);
  assert.equal(replacementReserveTotal([]), 0);
  assert.equal(replacementReserveTotal(undefined), 0);
});

/**
 * The shape trap. Routes map rows to camelCase for the browser, but server-side
 * callers pass raw snake_case rows straight in — writeSnapshot() already does.
 * A raw row read as camelCase-only would return 0, silently removing the reserve
 * from the overhead rate and under-pricing every job.
 */
test('reserve reads snake_case rows and camelCase payloads identically', () => {
  const snake = { replacement_cost_estimate: 9000, replacement_cycle_years: 3, business_use_pct: 60 };
  const camel = { replacementCostEstimate: 9000, replacementCycleYears: 3, businessUsePct: 60 };

  assert.equal(replacementReserveTotal([snake]), 1800);
  assert.equal(replacementReserveTotal([camel]), 1800);
  assert.equal(replacementReserveTotal([snake]), replacementReserveTotal([camel]));
});

test('annual business cost is operating costs plus the reserve, and stays splittable', () => {
  assert.equal(annualOverheadTotal(OVERHEAD), 24000);
  assert.equal(replacementReserveTotal([CAMERA]), 2000);
  assert.equal(annualBusinessCost(OVERHEAD, [CAMERA]), 26000);

  // annualOverheadTotal keeps its name and behaviour — the Dashboard needs both
  // terms separately, because the visible Operating / Replacement split is the
  // only way a double-counted camera is noticeable.
  assert.equal(annualBusinessCost(OVERHEAD, []), annualOverheadTotal(OVERHEAD));
  assert.equal(annualBusinessCost([], [CAMERA]), 2000);
  assert.equal(annualBusinessCost([], []), 0);
  assert.equal(annualBusinessCost(undefined, undefined), 0);
});

test('the reserve raises the overhead rate, which is the point of it', () => {
  const hours = annualBillableHours(REFERENCE_CAPACITY); // 1,776
  const without = overheadRatePerHour(annualBusinessCost(OVERHEAD, []), hours);
  const with_ = overheadRatePerHour(annualBusinessCost(OVERHEAD, [CAMERA]), hours);

  assert.equal(without, 13.51);
  assert.equal(with_, 14.64);
  assert.ok(with_ > without, 'gear the business has to replace must raise the floor');
});

/**
 * THE AUSTRALIAN FINANCIAL YEAR — 1 July to 30 June.
 *
 * Two string forms on purpose: `FY2025-26` is canonical and is what gets stored,
 * queried and compared; `FY 2025–26` with an en dash is display only. The tests
 * below pin the boundary in both directions, and pin that a date-only column
 * value is parsed textually rather than through Date — `new Date('2026-06-30')`
 * is UTC midnight, which west of Greenwich reads back as 29 June and would file
 * a deduction in the wrong year.
 */
test('the financial year turns over on 1 July, in both directions', () => {
  assert.equal(fyLabel('2025-07-01'), 'FY2025-26'); // first day
  assert.equal(fyLabel('2026-06-30'), 'FY2025-26'); // last day
  assert.equal(fyLabel('2026-07-01'), 'FY2026-27'); // first day of the next
  assert.equal(fyLabel('2026-06-29'), 'FY2025-26');

  // January is in the FY that started the previous July — the case
  // new Date().getFullYear() gets wrong for six months of every year.
  assert.equal(fyLabel('2026-01-15'), 'FY2025-26');
  assert.equal(fyLabel('2025-12-31'), 'FY2025-26');
});

test('a date-only string is read textually, not through a Date', () => {
  assert.equal(fyLabel('2026-06-30'), 'FY2025-26');
  assert.equal(fyLabel('2026-07-01'), 'FY2026-27');
  // A full timestamp is accepted too; only the date part is read.
  assert.equal(fyLabel('2026-07-01T00:00:00.000Z'), 'FY2026-27');

  assert.equal(fyLabel('not a date'), null);
  assert.equal(fyLabel(''), null);
  assert.equal(fyLabel(undefined), null);
  assert.equal(fyLabel(new Date('nonsense')), null);
});

test('currentFinancialYear takes an injectable now, so the boundary is testable', () => {
  assert.equal(currentFinancialYear('2026-06-30'), 'FY2025-26');
  assert.equal(currentFinancialYear('2026-07-01'), 'FY2026-27');

  // The real call still works and agrees with fyLabel for the same moment.
  const now = new Date();
  assert.equal(currentFinancialYear(), fyLabel(now));
  assert.match(currentFinancialYear(), /^FY\d{4}-\d{2}$/);
});

test('fyBounds gives an inclusive 1 July – 30 June range as comparable strings', () => {
  assert.deepEqual(fyBounds('FY2025-26'), {
    start: '2025-07-01', end: '2026-06-30', startYear: 2025, label: 'FY2025-26',
  });

  // The boundary dates belong to the year the bounds describe.
  assert.equal(fyLabel(fyBounds('FY2025-26').start), 'FY2025-26');
  assert.equal(fyLabel(fyBounds('FY2025-26').end), 'FY2025-26');
});

test('fyBounds parses every form the label arrives in, and rejects the ambiguous ones', () => {
  const expected = fyBounds('FY2025-26');
  for (const form of ['FY2025-26', 'FY 2025-26', 'FY 2025–26', 'FY2025–26', 'FY2025-2026', '2025-26', 'fy2025-26']) {
    assert.deepEqual(fyBounds(form), expected, `should parse: ${form}`);
  }

  // A bare year cannot say which FY it means, so it is refused rather than
  // guessed — a guess here files a deduction against a year nobody named.
  assert.equal(fyBounds('2025'), null);
  assert.equal(fyBounds('FY2025'), null);
  // A second half that is not the following year is a typo, not a range.
  assert.equal(fyBounds('FY2025-27'), null);
  assert.equal(fyBounds('FY2025-2027'), null);
  assert.equal(fyBounds(''), null);
  assert.equal(fyBounds(undefined), null);

  // The century rolls over correctly rather than producing FY2099-100.
  assert.equal(fyBounds('FY2099-00').end, '2100-06-30');
  assert.equal(fyLabel('2099-08-01'), 'FY2099-00');
});

test('the en dash is display only and never the stored form', () => {
  assert.equal(fyDisplay('FY2025-26'), 'FY 2025–26');
  // Round-trips: a displayed label still parses back to the canonical token.
  assert.equal(fyBounds(fyDisplay('FY2025-26')).label, 'FY2025-26');
  // The canonical token itself carries no en dash and no space, so it is safe in
  // a URL, a filename and a string equality check.
  assert.ok(!currentFinancialYear().includes('–'));
  assert.ok(!currentFinancialYear().includes(' '));
  assert.equal(fyDisplay('garbage'), null);
});

/**
 * The timezone guard, run in a child process because Date's zone is fixed at
 * startup and this host is UTC+10.
 *
 * '2026-07-01' is the case that actually breaks. `new Date('2026-07-01')` is UTC
 * midnight; read back with local getters anywhere west of Greenwich that is
 * 30 June, which is the PREVIOUS financial year — so an asset first used on the
 * first day of the year would have its whole decline filed twelve months early.
 * 30 June cannot show the bug (shifted back it is still June), which is why this
 * pins 1 July specifically.
 *
 * Verified failing: with local getters this returns FY2025-26 under
 * America/Los_Angeles and Pacific/Midway, and the correct FY2026-27 under
 * Australia/Sydney and UTC — i.e. the defect is invisible on the machine this
 * was written on and on the NAS if its container happens to be UTC.
 */
test('the FY boundary does not move with the host timezone', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    const c = require(${JSON.stringify(join(__dirname, '..', 'src', 'calc.js'))});
    process.stdout.write([
      c.fyLabel('2026-07-01'),
      c.fyLabel('2026-06-30'),
      c.currentFinancialYear('2026-07-01'),
    ].join(','));
  `;

  for (const tz of ['UTC', 'Australia/Sydney', 'America/Los_Angeles', 'Pacific/Midway', 'Pacific/Kiritimati']) {
    const out = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    assert.equal(out, 'FY2026-27,FY2025-26,FY2026-27', `FY boundary moved under TZ=${tz}`);
  }
});

/**
 * FLOORS AND THE RATE-CARD COMPARISON — the Dashboard's arithmetic.
 *
 * $25/hr of overhead at a 25% margin is a $31.25 hourly floor throughout.
 */
test('the hourly floor is the overhead rate plus the margin, as a percent', () => {
  assert.equal(hourlyFloor(25, 25), 31.25);
  // 0% is break-even, a real answer; a missing margin or rate is not.
  assert.equal(hourlyFloor(25, 0), 25);
  assert.equal(hourlyFloor(25, null), null);
  assert.equal(hourlyFloor(25, undefined), null);
  assert.equal(hourlyFloor(null, 25), null);
  assert.equal(hourlyFloor(0, 25), null);
  // A margin of 0.25 is a quarter of one percent, not a quarter.
  assert.equal(hourlyFloor(25, 0.25), 25.06);
});

test('the hourly floor and Minimum Job Price agree about what an hour is worth', () => {
  // Ten hours with no direct costs: the editor's floor must be exactly ten of
  // the Dashboard's hourly floors, or the two screens tell different stories.
  assert.equal(minimumJobPrice(0, 10, 25, 25), round2(10 * hourlyFloor(25, 25)));
  assert.equal(minimumJobPrice(0, 7.5, 13.51, 30), round2(7.5 * 13.51 * 1.3));
});

test('a GST-inclusive rate card is compared ex-GST', () => {
  const unregistered = { gst: { registered: false, rate: 0.1, pricesIncludeGst: true } };
  const exclusive = { gst: { registered: true, rate: 0.1, pricesIncludeGst: false } };
  const inclusive = { gst: { registered: true, rate: 0.1, pricesIncludeGst: true } };
  assert.equal(priceExGst(110, unregistered), 110);
  assert.equal(priceExGst(110, exclusive), 110);
  assert.equal(priceExGst(110, inclusive), 100);
});

test('average job value counts won work from the last twelve months only', () => {
  const job = (status, date, price) => ({ status, date, totals: { clientPriceExGst: price } });
  const avg = averageJobValue(
    [
      job('approved', '2026-01-10', 1000),
      job('paid', '2025-09-28', 3000), // one day inside the window
      job('invoiced', '2025-09-27', 9999), // exactly a year ago: outside
      job('draft', '2026-09-01', 5000), // a quote, not a job
      job('sent', '2026-09-01', 5000),
      job('approved', '2026-12-01', 2000), // booked ahead: won work, counts
      job('approved', '2026-05-01', 0), // nothing to average
      job('approved', '', 4000), // undated
    ],
    '2026-09-27',
  );
  assert.deepEqual(avg, { average: 2000, count: 3 });

  assert.equal(averageJobValue([], '2026-09-27'), null);
  assert.equal(averageJobValue([job('draft', '2026-09-01', 5000)], '2026-09-27'), null);
});

test('the twelve-month window steps back from 29 February to the 28th', () => {
  const job = (date) => ({ status: 'paid', date, totals: { clientPriceExGst: 100 } });
  assert.equal(averageJobValue([job('2027-02-28')], '2028-02-29'), null);
  assert.deepEqual(averageJobValue([job('2027-03-01')], '2028-02-29'), { average: 100, count: 1 });
});

test('jobs needed per year rounds up — a target is reached in whole jobs', () => {
  assert.equal(jobsNeededPerYear(100000, 9000), 12); // 11.1 → 12
  assert.equal(jobsNeededPerYear(90000, 9000), 10);
  assert.equal(jobsNeededPerYear(null, 9000), null);
  assert.equal(jobsNeededPerYear(90000, null), null);
  assert.equal(jobsNeededPerYear(90000, 0), null);
});

/**
 * THE POST-RATIO READOUT (Dashboard section 6, 2026-09-27).
 *
 * The reference capacity: 5 days × 52 = 260, less 30 leave and 8 sick = 222
 * days × 8 hrs = 1,776 hrs a year = 148 a month. Every figure below is
 * worked from that by hand.
 */
const CAPACITY = { billableHoursPerDay: 8, workingDaysPerWeek: 5, leaveDaysPerYear: 30, sickDaysPerYear: 8 };

test('post ratio: 6 shoot days at 1.5 edit days each leaves 28 of 148 hrs', () => {
  assert.deepEqual(postRatioReadout(CAPACITY, 6, 1.5), {
    monthlyHours: 148,
    dayHours: 8,
    shootHours: 48, // 6 × 8
    postHours: 72, // 6 × 1.5 × 8 — edit days are Capacity's day, like shoot days
    unsoldHours: 28, // 148 − 48 − 72
    maxShootDays: 7.4, // 148 ÷ (2.5 × 8)
  });
});

test('post ratio: a ratio of zero means no post, not no answer', () => {
  const r = postRatioReadout(CAPACITY, 4, 0);
  assert.equal(r.postHours, 0);
  assert.equal(r.unsoldHours, 116); // 148 − 32
  assert.equal(r.maxShootDays, 18.5); // 148 ÷ 8
});

test('post ratio: over-subscribing the month is a negative answer, not null', () => {
  // A wedding month: 10 shoot days at 3 edit days each is 320 hrs of 148.
  const r = postRatioReadout(CAPACITY, 10, 3);
  assert.equal(r.shootHours + r.postHours, 320);
  assert.equal(r.unsoldHours, -172);
  assert.equal(r.maxShootDays, 4.6); // 148 ÷ 32 = 4.625, floored — never rounded up to 4.7
});

test('post ratio: the ceiling floors to a tenth instead of promising a day that does not fit', () => {
  // 148 ÷ (1.7 × 8) = 10.88… → 10.8, where rounding would say 10.9.
  assert.equal(postRatioReadout(CAPACITY, 1, 0.7).maxShootDays, 10.8);
});

test('post ratio: no capacity, or a missing or negative input, is null', () => {
  assert.equal(postRatioReadout({}, 6, 1.5), null);
  assert.equal(postRatioReadout(Object.assign({}, CAPACITY, { billableHoursPerDay: 0 }), 6, 1.5), null);
  assert.equal(postRatioReadout(CAPACITY, '', 1.5), null);
  assert.equal(postRatioReadout(CAPACITY, 6, null), null);
  assert.equal(postRatioReadout(CAPACITY, -1, 1.5), null);
  assert.equal(postRatioReadout(CAPACITY, 6, -0.5), null);
  // Zero shoot days is a real what-if: the whole month is unsold.
  assert.equal(postRatioReadout(CAPACITY, 0, 1.5).unsoldHours, 148);
});

/**
 * THE SEEDED DAY ROWS (Rate Card task, 2026-09-27).
 */
test('the default card prices Video Capture at all three units, the half day its own figure', () => {
  assert.deepEqual(DEFAULT_PRICING.serviceDay, { fullHours: 8, halfHours: 4 });
  const prod = DEFAULT_PRICING.labourSections.find((s) => s.id === 'prod');
  const vc = prod.rows.find((r) => r.name === 'Video Capture');
  assert.deepEqual(vc.prices, { hour: 140, half: 640, full: 1120 });
  // No 0.5 multiplier: a typed half day carries its own price.
  assert.notEqual(vc.prices.half, vc.prices.full / 2);
  // The old separate day rows folded into it.
  assert.ok(!prod.rows.some((r) => /Full Day|Half Day/.test(r.name)));
});

test('every default service is in the new shape, its old price kept as the hourly one', () => {
  // The v8 defaults' hourly prices, by name. Names are unchanged: saved
  // estimates found rows by name.
  const before = {
    'Pre-Production Meeting with Client': 56, 'Video Capture': 140, 'Photo Capture': 112,
    'Drone Aerial Capture': 84, 'Overtime — per hour': 210, 'Video Editor — Socials': 126,
    'Raw Footage Handover [on HDD]': 98, 'Photo Editor': 154,
  };
  const rows = DEFAULT_PRICING.labourSections.flatMap((s) => s.rows);
  for (const row of rows) {
    for (const old of ['mu', 'hoursPerUnit', 'dayUnit']) assert.equal(row[old], undefined, `${row.name} has ${old}`);
    assert.deepEqual(Object.keys(row.prices), SERVICE_UNITS, row.name);
    assert.equal(typeof row.prices.hour, 'number', row.name);
    if (row.name !== 'Video Capture') assert.deepEqual([row.prices.half, row.prices.full], [null, null], row.name);
  }
  for (const [name, hour] of Object.entries(before)) {
    const row = rows.find((r) => r.name === name);
    assert.ok(row, name + ' is still on the default card');
    assert.equal(row.prices.hour, hour, name);
  }
  assert.equal(rows.find((r) => r.name === 'Raw Footage Handover [on HDD]').customBill, true);
});

test('two seeded full days carry sixteen hours into Minimum Job Price', () => {
  const vc = DEFAULT_PRICING.labourSections.find((s) => s.id === 'prod').rows.find((r) => r.name === 'Video Capture');
  const added = { name: 'Video Capture', qty: 2, ...lineSnapshot(unitDef(vc, 'full', DEFAULT_PRICING)) };
  // As the estimator will add it (a snapshot), and as the fallback prices a bare line.
  for (const line of [added, { name: 'Video Capture', qty: 2, dayUnit: 'full' }]) {
    const t = computeTotals({ prod: [line] }, DEFAULT_PRICING, settingsWith({ registered: false }));
    assert.equal(t.totalHours, 16);
    assert.equal(t.labourTotal, 2240);
  }
});

/* ── Direct costs are ex-GST on a GST-inclusive card (estimate-accuracy task 3) ──

   On a GST-inclusive card every figure typed in carries GST, costs included.
   directJobCost and passThroughCost feed Minimum Job Price and the Income floor
   line, which are measured against the EX-GST client price, so they have to be
   ex-GST too. The sample: 10 hrs at a $64.27/hr income floor, with $1,000 of
   crew that is typed in as $1,100. */

const GST_ACC_CARD = {
  labourSections: [{ id: 'prod', rows: [{ id: 'vc', name: 'Video Capture', mu: 110 }] }],
  travelRows: [
    { id: 'fuel', name: 'Fuel', mu: 1, rate: 1, directCost: true },
    { id: 'meals', name: 'Crew meals', mu: 33, rate: 22 },
  ],
  taxSetAsideRate: 0.3,
};
const GST_ACC_JOB = {
  prod: [{ name: 'Video Capture', qty: 10 }],
  crew: [{ role: 'Second Shooter', days: 1, cost: 1100 }],
};
/* The editor's Income floor line (estimate-editor.js paintIncome), written out
   so the test pins the figure a person reads, not just its input. */
const incomeFloorNeed = (t, floor) => round2(t.directJobCost + t.totalHours * floor);

test('on a GST-inclusive card, $1,100 of crew typed in is $1,000 of direct cost', () => {
  const t = computeTotals(GST_ACC_JOB, GST_ACC_CARD, settingsWith(GST_INCLUSIVE));
  assert.equal(t.directJobCost, 1000);
  assert.equal(t.passThroughCost, 1000);
  assert.equal(incomeFloorNeed(t, 64.27), 1642.7); // not 1,742.70
  // What the client is billed is untouched: 1,100 of labour + 1,100 of crew.
  assert.equal(t.expenseTotal, 1100);
  assert.equal(t.totalIncGst, 2200);
  assert.equal(t.clientPriceExGst, 2000);
  // Minimum Job Price's direct-cost term is the ex-GST figure too.
  assert.equal(minimumJobPrice(t.directJobCost, t.totalHours, 11.5, 25), 1143.75);
});

test('the same job unregistered, GST-exclusive or GST-free keeps its costs as entered', () => {
  for (const [label, settings, options] of [
    ['unregistered', settingsWith({ registered: false }), undefined],
    ['unregistered, inclusive box left ticked', settingsWith({ registered: false, pricesIncludeGst: true }), undefined],
    ['GST-exclusive', settingsWith(GST_EXCLUSIVE), undefined],
    ['GST-free on an inclusive card', settingsWith(GST_INCLUSIVE), { gstFree: true }],
  ]) {
    const t = computeTotals(GST_ACC_JOB, GST_ACC_CARD, settings, options);
    assert.equal(t.directJobCost, 1100, label);
    assert.equal(t.passThroughCost, 1100, label);
    assert.equal(incomeFloorNeed(t, 64.27), 1742.7, label);
  }
});

test('resold travel\'s cost and direct travel come out ex-GST too, and income still reconciles', () => {
  const job = { ...GST_ACC_JOB, travel: [{ name: 'Fuel', qty: 220 }, { name: 'Crew meals', qty: 2 }] };
  const t = computeTotals(job, GST_ACC_CARD, settingsWith(GST_INCLUSIVE));
  // Pass-through: (1,100 crew + 220 fuel) / 1.1. Direct: that plus 2 × $22 of meals.
  assert.equal(t.passThroughCost, 1200);
  assert.equal(t.directJobCost, 1240);
  // Income is the billed price less every cost, all ex-GST: 1,100 + 66 − 44 = 1,122 / 1.1.
  assert.equal(t.incomeExGst, 1020);
  assert.equal(round2(t.clientPriceExGst - t.directJobCost), t.incomeExGst);
});

test('across a sweep of prices, only the two cost figures differ between an inclusive card and the rule', () => {
  for (let cost = 0; cost <= 3000; cost += 37.37) {
    for (const hours of [0, 1, 7.5, 16]) {
      const job = {
        prod: [{ name: 'Video Capture', qty: hours }],
        crew: [{ days: 1, cost }],
        equip: [{ days: 2, cost: cost / 3 }],
        travel: [{ name: 'Fuel', qty: cost / 7 }, { name: 'Crew meals', qty: 3 }],
      };
      const inc = computeTotals(job, GST_ACC_CARD, settingsWith(GST_INCLUSIVE), { overheadRate: 11.5 });
      const passAsEntered = cost + 2 * (cost / 3) + cost / 7;
      assert.equal(inc.passThroughCost, round2(passAsEntered / 1.1), 'pass ' + cost);
      assert.equal(inc.directJobCost, round2((passAsEntered + 3 * 22) / 1.1), 'direct ' + cost);
      // Every as-billed figure is exactly what the same lines bill unregistered.
      const plain = computeTotals(job, GST_ACC_CARD, settingsWith({ registered: false }), { overheadRate: 11.5 });
      assert.equal(inc.totalIncGst, plain.clientPriceExGst);
      assert.equal(inc.labourTotal, plain.labourTotal);
      assert.equal(inc.expenseTotal, plain.expenseTotal);
      assert.equal(inc.totalHours, plain.totalHours);
      // And the cost can never exceed what was billed for it.
      assert.ok(inc.directJobCost <= plain.directJobCost, 'direct ' + cost);
    }
  }
});

/* ── Transport & Logistics Hrs is "Your time" on the default card (estimate-accuracy task 5) ── */

const TRANSPORT = 'Transport & Logistics Hrs';

test('the default card marks Transport & Logistics Hrs as the owner\'s own time', () => {
  const row = DEFAULT_PRICING.travelRows.find((r) => r.name === TRANSPORT);
  assert.equal(row.ownTime, true);
  assert.equal(row.directCost, undefined); // own time is never also a pass-through
  assert.equal(row.mu, null); // auto since task 6a: follows the income floor
  // No other travel row changed kind.
  assert.deepEqual(DEFAULT_PRICING.travelRows.filter((r) => r.ownTime).map((r) => r.name), [TRANSPORT]);
});

/* The row as the user's live card will have it once "Your time" is ticked:
   still their typed $35. */
const TRANSPORT_AT_35 = { ...DEFAULT_PRICING.travelRows.find((r) => r.name === TRANSPORT), mu: 35 };

test('2 hours of own-time transport at $35 are $70 of income and 2 billable hours', () => {
  const card = { ...DEFAULT_PRICING, travelRows: [TRANSPORT_AT_35] };
  const t = computeTotals({ travel: [{ name: TRANSPORT, qty: 2 }] }, card, settingsWith({ registered: false }));
  assert.equal(t.expenseTotal, 70);
  assert.equal(t.incomeExGst, 70); // all of it, none treated as cost
  assert.equal(t.directJobCost, 0);
  assert.equal(t.passThroughCost, 0);
  assert.equal(t.totalHours, 2);
  assert.equal(t.taxSetAside, 24.5); // 70 × 0.35
  // Its hours carry overhead like labour's.
  assert.equal(computeTotals({ travel: [{ name: TRANSPORT, qty: 2 }] }, card, DEFAULT_SETTINGS, { overheadRate: 10 }).overheadShare, 20);
  // And the hours editor agrees with the total.
  assert.equal(labourHoursBreakdown({ travel: [{ name: TRANSPORT, qty: 2 }] }, card).totalHours, 2);
});

test('before the flag, the same 2 hours were $20 of income, $50 of cost and no hours', () => {
  // JOB_PRICING keeps the row as it was on the default card until 2026-09-30.
  const t = computeTotals({ travel: [{ name: TRANSPORT, qty: 2 }] }, JOB_PRICING, settingsWith({ registered: false }));
  assert.deepEqual([t.expenseTotal, t.incomeExGst, t.directJobCost, t.totalHours], [70, 20, 50, 0]);
});

test('a transport line added from the card snapshots the flag; one saved before it keeps pricing as it was', () => {
  const added = { name: TRANSPORT, qty: 2, ...lineSnapshot(TRANSPORT_AT_35) };
  assert.equal(added.ownTime, true);
  // A line saved before this change carries its own snapshot without the flag,
  // and a saved line prices from its snapshot, never today's card.
  const savedBefore = { name: TRANSPORT, qty: 2, mu: 35, rate: 25 };
  const now = computeTotals({ travel: [added] }, DEFAULT_PRICING, settingsWith({ registered: false }));
  const old = computeTotals({ travel: [savedBefore] }, DEFAULT_PRICING, settingsWith({ registered: false }));
  assert.deepEqual([now.incomeExGst, now.totalHours], [70, 2]);
  assert.deepEqual([old.incomeExGst, old.totalHours, old.directJobCost], [20, 0, 50]);
});

/* ── Your time on the road is priced from the floor (estimate-accuracy task 6a) ──

   Sample income floor $64.27/hr (the audit's reference figures). An own-time
   travel row with no typed price is auto: the floor, no markup, rounded up to
   the whole dollar, GST-aware — $65 here, $71 on a GST-inclusive card. */

const FLOOR = 64.27;
const UNREG = settingsWith({ registered: false });
const OWN_AUTO = { id: 't1', name: 'Driving', rate: 25, mu: null, ownTime: true };
const OWN_35 = { id: 't2', name: 'Driving (typed)', rate: 25, mu: 35, ownTime: true };
const RESOLD_35 = { id: 't3', name: 'Meals', rate: 25, mu: 35 };

test('an auto own-time travel row is the income floor rounded up, with no markup', () => {
  assert.equal(travelRowDef(OWN_AUTO, { floorPerHour: FLOOR, settings: UNREG }).mu, 65);
  // Target Markup in the context is not read: travel time carries no profit.
  assert.equal(travelRowDef(OWN_AUTO, { floorPerHour: FLOOR, markupPct: 25, settings: UNREG }).mu, 65);
  assert.equal(travelRowDef(OWN_AUTO, { floorPerHour: 64, settings: UNREG }).mu, 64); // exactly, not up a dollar
  assert.equal(travelRowDef(OWN_AUTO, { floorPerHour: FLOOR, settings: settingsWith(GST_EXCLUSIVE) }).mu, 65);
  // Inclusive: the least whole dollar whose ex-GST part reaches 64.27 (70 is 63.64).
  assert.equal(travelRowDef(OWN_AUTO, { floorPerHour: FLOOR, settings: settingsWith(GST_INCLUSIVE) }).mu, 71);
  assert.equal(travelRowDef(OWN_AUTO, { floorPerHour: FLOOR, settings: UNREG }).auto, true);
});

test('an auto own-time row has no price without a floor — null, never $0', () => {
  assert.equal(travelRowDef(OWN_AUTO).mu, null);
  assert.equal(travelRowDef(OWN_AUTO, { floorPerHour: null, settings: UNREG }).mu, null);
  assert.equal(travelRowDef(OWN_AUTO, { floorPerHour: 0, settings: UNREG }).mu, null);
});

test('a typed price wins, and nothing but an own-time row is ever auto', () => {
  const typed = travelRowDef(OWN_35, { floorPerHour: FLOOR, settings: UNREG });
  assert.deepEqual([typed.mu, typed.auto], [35, false]);
  assert.equal(travelRowDef({ ...OWN_35, mu: 0 }, { floorPerHour: FLOOR }).mu, 0); // a typed 0 is a price
  // A blank anywhere else reads as $0, as it always has (see the header).
  for (const row of [{ name: 'x', mu: null }, { name: 'x', directCost: true }, { name: 'x', mu: '', ownTime: true, directCost: true }]) {
    const d = travelRowDef(row, { floorPerHour: FLOOR, settings: UNREG });
    assert.deepEqual([d.mu, d.auto], [0, false], JSON.stringify(row));
  }
  assert.equal(travelRowDef(null), null);
});

test('a bare line on an auto own-time row prices at nothing: no dollars and no hours', () => {
  const card = { labourSections: [], travelRows: [OWN_AUTO], taxSetAsideRate: 0.35 };
  assert.equal(lineDef(card.travelRows, { name: 'Driving', qty: 3 }), null);
  const t = computeTotals({ travel: [{ name: 'Driving', qty: 3 }] }, card, UNREG);
  assert.deepEqual([t.expenseTotal, t.incomeExGst, t.totalHours], [0, 0, 0]);
  // A priceable travel row comes back as itself, exactly as before task 6a.
  assert.equal(lineDef([OWN_35], { name: 'Driving (typed)' }), OWN_35);
  assert.equal(lineDef([RESOLD_35], { name: 'Meals' }), RESOLD_35);
});

test('a line added at the auto price snapshots the figure and prices as own time', () => {
  const def = travelRowDef(OWN_AUTO, { floorPerHour: FLOOR, settings: UNREG });
  const snap = lineSnapshot(def);
  assert.deepEqual(snap, { mu: 65, rowId: 't1', rate: 25, ownTime: true }); // no `auto` on a saved line
  const card = { labourSections: [], travelRows: [OWN_AUTO], taxSetAsideRate: 0.35 };
  const t = computeTotals({ travel: [{ name: 'Driving', qty: 2, ...snap }] }, card, UNREG);
  assert.deepEqual([t.expenseTotal, t.incomeExGst, t.totalHours, t.directJobCost], [130, 130, 2, 0]);
});

test('a travel line saved before task 6a totals exactly as it did', () => {
  const card = { ...DEFAULT_PRICING };
  for (const line of [
    { name: 'Transport & Logistics Hrs', qty: 4, mu: 35, rate: 25 },
    { name: 'Transport & Logistics Hrs', qty: 4, mu: 35, rate: 25, ownTime: true },
    { name: 'Fuel & Tolls', qty: 120, mu: 1, rate: 1, directCost: true },
  ]) {
    const a = computeTotals({ travel: [line] }, card, UNREG);
    const b = computeTotals({ travel: [line] }, JOB_PRICING, UNREG);
    assert.deepEqual(a, b, line.name); // the card, auto or not, is never read
  }
  const t = computeTotals({ travel: [{ name: 'Transport & Logistics Hrs', qty: 4, mu: 35, rate: 25 }] }, card, UNREG);
  assert.deepEqual([t.expenseTotal, t.incomeExGst, t.totalHours], [140, 40, 0]);
});

test('travelFloorComparison: only own-time rows, each by the hour against the floor', () => {
  const direct = { name: 'Direct own', mu: 1, ownTime: true, directCost: true };
  const card = { travelRows: [RESOLD_35, OWN_35, direct, OWN_AUTO] };
  const rows = travelFloorComparison(card, UNREG, FLOOR);
  assert.deepEqual(rows.map((r) => [r.name, r.rowIndex, r.sectionId, r.travel]), [
    ['Driving (typed)', 1, 'travel', true],
    ['Driving', 3, 'travel', true],
  ]);
  assert.deepEqual(Object.keys(rows[0].units), ['hour']); // no half or full day
  assert.deepEqual(rows[0].units.hour, { mu: 35, muExGst: 35, auto: false, hoursPerUnit: 1, floor: 64.27, gap: 29.27, belowFloor: true });
  assert.deepEqual(rows[1].units.hour, { mu: 65, muExGst: 65, auto: true, hoursPerUnit: 1, floor: 64.27, gap: 0, belowFloor: false });
});

test('an own-time row and a resold row at identical prices are judged differently', () => {
  const own = travelFloorComparison({ travelRows: [OWN_35] }, UNREG, FLOOR);
  const resold = travelFloorComparison({ travelRows: [RESOLD_35] }, UNREG, FLOOR);
  assert.equal(own.length, 1);
  assert.equal(own[0].units.hour.belowFloor, true);
  assert.equal(resold.length, 0); // not compared at all
});

test('travelFloorComparison: at the floor is not below, and GST comes off first', () => {
  const at = (mu, settings) => travelFloorComparison({ travelRows: [{ ...OWN_35, mu }] }, settings, FLOOR)[0].units.hour;
  assert.equal(at(64.27, UNREG).belowFloor, false);
  assert.equal(at(64.26, UNREG).belowFloor, true);
  // On a GST-inclusive card $70 is $63.64 of price: below. $71 is $64.55: clear.
  assert.deepEqual([at(70, settingsWith(GST_INCLUSIVE)).belowFloor, at(70, settingsWith(GST_INCLUSIVE)).gap], [true, 0.63]);
  assert.equal(at(71, settingsWith(GST_INCLUSIVE)).belowFloor, false);
  // An auto row is never below the floor it is priced from, in any GST mode.
  for (const settings of [UNREG, settingsWith(GST_EXCLUSIVE), settingsWith(GST_INCLUSIVE)]) {
    for (let cents = 1; cents <= 30000; cents += 7) {
      const u = travelFloorComparison({ travelRows: [OWN_AUTO] }, settings, cents / 100)[0].units.hour;
      assert.equal(u.belowFloor, false, cents);
    }
  }
});

test('travelFloorComparison: no floor yet is "can\'t tell", not fine and not below', () => {
  const rows = travelFloorComparison({ travelRows: [OWN_35, OWN_AUTO] }, UNREG, null);
  assert.deepEqual(rows[0].units.hour, { mu: 35, muExGst: 35, auto: false, hoursPerUnit: 1, floor: null, gap: null, belowFloor: null });
  assert.deepEqual(rows[1].units.hour, { mu: null, muExGst: null, auto: true, hoursPerUnit: 1, floor: null, gap: null, belowFloor: null });
  assert.deepEqual(travelFloorComparison(undefined, UNREG, FLOOR), []);
});

test('a card without this build\'s shape marker is outdated', () => {
  assert.equal(PRICING_SHAPE, 'deliverable-types');
  // Task 2's build, whose Rate Card would drop deliverable types and Capture ticks (B2-1).
  assert.equal(cardShapeOutdated({ ...DEFAULT_PRICING, pricingShape: 'production-days' }), true);
  // 6a's build, which would save a km row as a resold $0 row (task 6b).
  assert.equal(cardShapeOutdated({ ...DEFAULT_PRICING, pricingShape: 'travel-auto' }), true);
  // 6b's build, whose Rate Card would drop the surcharge settings (production-booking task 2).
  assert.equal(cardShapeOutdated({ ...DEFAULT_PRICING, pricingShape: 'travel-km' }), true);
  assert.equal(cardShapeOutdated(DEFAULT_PRICING), false);
  const { pricingShape, ...unmarked } = DEFAULT_PRICING;
  assert.equal(pricingShape, PRICING_SHAPE);
  assert.equal(cardShapeOutdated(unmarked), true);
  // Exactly what a build from before task 6a would carry, had it kept one.
  assert.equal(cardShapeOutdated({ ...DEFAULT_PRICING, pricingShape: 'service-units' }), true);
});

test('an own-time row that carries its own hours is priced and floored on them', () => {
  // No screen sets hoursPerUnit on a travel row, but computeTotals counts it,
  // so the price and the floor must use the same hours the job carries.
  const twoHr = { ...OWN_AUTO, hoursPerUnit: 2 };
  assert.equal(travelRowDef(twoHr, { floorPerHour: FLOOR, settings: UNREG }).mu, 129); // ceil(128.54)
  const u = travelFloorComparison({ travelRows: [twoHr] }, UNREG, FLOOR)[0].units.hour;
  assert.deepEqual([u.floor, u.hoursPerUnit, u.belowFloor], [128.54, 2, false]);
});

/* ── The car, per km, at cost (estimate-accuracy task 6b) ──────────────────────

   Worked example from TASKS.md: 120 km at $0.90 = $108 billed. directJobCost
   +108, incomeExGst +0, totalHours +0, and the tax set-aside unchanged. */

const KM_ROW = { id: 'km', name: 'Vehicle — per km', rate: 0, mu: null, perKm: true, unit: 'km' };
const KM_CTX = (settings) => ({ vehicleCostPerKm: 0.9, settings });

test('a km row is priced from Overhead\'s figure, plus GST only on a GST-inclusive card', () => {
  for (const settings of [UNREG, settingsWith(GST_EXCLUSIVE), settingsWith({ registered: false, pricesIncludeGst: true })]) {
    const d = travelRowDef(KM_ROW, KM_CTX(settings));
    assert.deepEqual([d.mu, d.auto], [0.9, true]);
  }
  assert.equal(travelRowDef(KM_ROW, KM_CTX(settingsWith(GST_INCLUSIVE))).mu, 0.99); // not 0.9900000000000001
  assert.equal(travelRowDef(KM_ROW, { vehicleCostPerKm: 0.88, settings: settingsWith(GST_INCLUSIVE) }).mu, 0.968);
  // A typed price on the row is never read: the figure is Overhead's alone.
  assert.equal(travelRowDef({ ...KM_ROW, mu: 5 }, KM_CTX(UNREG)).mu, 0.9);
  // The floor and the markup are never read either.
  assert.equal(travelRowDef(KM_ROW, { vehicleCostPerKm: 0.9, floorPerHour: 64.27, markupPct: 25, settings: UNREG }).mu, 0.9);
});

test('no per-km figure is no price — null, never $0', () => {
  for (const ctx of [undefined, {}, { vehicleCostPerKm: null }, { vehicleCostPerKm: '' }, { vehicleCostPerKm: -1 }]) {
    assert.equal(travelRowDef(KM_ROW, ctx).mu, null, JSON.stringify(ctx));
  }
  assert.equal(travelRowDef(KM_ROW, { vehicleCostPerKm: 0 }).mu, 0); // a figure of $0 is a figure
  // So a bare line on the row (the server's view) prices at nothing.
  assert.equal(lineDef([KM_ROW], { name: 'Vehicle — per km', qty: 120 }), null);
});

test('120 km at $0.90 is $108 at cost: a direct cost, no income, no hours, no tax', () => {
  const card = { labourSections: [{ id: 'prod', rows: [{ id: 'vc', name: 'Video Capture', mu: 110 }] }], travelRows: [KM_ROW], taxSetAsideRate: 0.3 };
  const labour = { prod: [{ name: 'Video Capture', qty: 8, mu: 110 }] };
  const km = { name: 'Vehicle — per km', qty: 120, ...lineSnapshot(travelRowDef(KM_ROW, KM_CTX(UNREG))) };
  assert.deepEqual(km, { name: 'Vehicle — per km', qty: 120, mu: 0.9, rowId: 'km', rate: 0, perKm: true });
  const before = computeTotals(labour, card, UNREG, { overheadRate: 11.5 });
  const after = computeTotals({ ...labour, travel: [km] }, card, UNREG, { overheadRate: 11.5 });
  assert.equal(round2(after.expenseTotal - before.expenseTotal), 108);
  assert.equal(round2(after.clientPriceExGst - before.clientPriceExGst), 108);
  assert.equal(round2(after.directJobCost - before.directJobCost), 108);
  assert.equal(round2(after.passThroughCost - before.passThroughCost), 108);
  assert.deepEqual(
    [after.incomeExGst, after.totalHours, after.taxSetAside, after.estTakeHome, after.overheadShare],
    [before.incomeExGst, before.totalHours, before.taxSetAside, before.estTakeHome, before.overheadShare]
  );
  // Minimum Job Price carries it at cost, with no markup on it.
  assert.equal(round2(minimumJobPrice(after.directJobCost, after.totalHours, 11.5, 25) -
    minimumJobPrice(before.directJobCost, before.totalHours, 11.5, 25)), 108);
});

test('on a GST-inclusive card the km line bills the figure plus GST and costs exactly the figure', () => {
  const card = { labourSections: [], travelRows: [KM_ROW], taxSetAsideRate: 0.3 };
  const km = { name: 'Vehicle — per km', qty: 120, ...lineSnapshot(travelRowDef(KM_ROW, KM_CTX(settingsWith(GST_INCLUSIVE)))) };
  const t = computeTotals({ travel: [km] }, card, settingsWith(GST_INCLUSIVE));
  assert.deepEqual([t.totalIncGst, t.clientPriceExGst, t.gst], [118.8, 108, 10.8]);
  assert.deepEqual([t.directJobCost, t.passThroughCost, t.incomeExGst], [108, 108, 0]);
});

test('a km line keeps its snapshot when Overhead\'s figure changes', () => {
  const card = { labourSections: [], travelRows: [KM_ROW], taxSetAsideRate: 0.3 };
  const saved = { name: 'Vehicle — per km', qty: 100, mu: 0.9, rowId: 'km', perKm: true };
  // Whatever the card or Overhead says now, the line bills what it was quoted at.
  assert.equal(computeTotals({ travel: [saved] }, card, UNREG).expenseTotal, 90);
  assert.equal(computeTotals({ travel: [saved] }, { ...card, travelRows: [] }, UNREG).expenseTotal, 90);
});

test('the km row is at cost even if it also carried Your time, and never joins the floor comparison', () => {
  const both = { ...KM_ROW, ownTime: true };
  const line = { name: 'Vehicle — per km', qty: 10, mu: 0.9, perKm: true, ownTime: true };
  const t = computeTotals({ travel: [line] }, { labourSections: [], travelRows: [both] }, UNREG);
  assert.deepEqual([t.incomeExGst, t.totalHours, t.directJobCost], [0, 0, 9]);
  assert.equal(labourHoursBreakdown({ travel: [line] }, { labourSections: [], travelRows: [both] }).totalHours, 0);
  assert.deepEqual(travelFloorComparison({ travelRows: [KM_ROW, both] }, UNREG, 64.27), []);
});

test('the default card: Tolls & Parking at cost, the car per km, and no Fuel & Tolls', () => {
  const names = DEFAULT_PRICING.travelRows.map((r) => r.name);
  assert.ok(!names.includes('Fuel & Tolls'));
  assert.deepEqual(DEFAULT_PRICING.travelRows.find((r) => r.name === 'Tolls & Parking'), { name: 'Tolls & Parking', rate: 1, mu: 1, directCost: true });
  const km = DEFAULT_PRICING.travelRows.find((r) => r.perKm);
  assert.deepEqual(km, { name: 'Vehicle — per km', rate: 0, mu: null, perKm: true, unit: 'km' });
  assert.equal(DEFAULT_PRICING.travelRows.filter((r) => r.perKm).length, 1);
});

/* ── Surcharges (production-booking task 1) ────────────────────────────────
   The brief's Key Interactions 1 is the spec; its worked examples are on the
   default card's Video Capture Full Day, $1,120. Dates: Fri 2 Oct, Sat 3 Oct
   and Mon 5 Oct 2026 (NSW Labour Day). */
const {
  SURCHARGE_DEFAULTS,
  surchargeSettings,
  dayKind,
  afterHoursShare,
  surchargeFactor,
  surchargedLinePrice,
  surchargeAttribution,
} = require('../src/calc');

const FRI = '2026-10-02';
const SAT = '2026-10-03';
const LABOUR_DAY = '2026-10-05';
const NO_SURCHARGES = {}; // a pre-v11 card: every default applies
const withMode = (mode) => ({ surcharges: { mode } });
const priceOn = (base, day, card, shortNotice, holidays) =>
  surchargedLinePrice(base, surchargeFactor(day, card, shortNotice, holidays));

test('surcharge settings: a card without any reads the defaults', () => {
  assert.deepEqual(surchargeSettings(NO_SURCHARGES), SURCHARGE_DEFAULTS);
  assert.deepEqual(SURCHARGE_DEFAULTS, {
    shortNotice: 2, shortNoticeHintDays: 7, weekend: 1.5, afterHours: 1.25,
    officeStart: '07:00', officeEnd: '17:00', workingWeekdays: [1, 2, 3, 4, 5], mode: 'higher',
  });
});

test('surcharge settings: unusable fields take the default, and a multiplier never discounts', () => {
  const s = surchargeSettings({ surcharges: {
    shortNotice: 'x', weekend: 0.5, afterHours: '1.4', officeStart: '18:00', officeEnd: '09:00',
    workingWeekdays: [], mode: 'add',
  } });
  assert.equal(s.shortNotice, 2);
  assert.equal(s.weekend, 1);
  assert.equal(s.afterHours, 1.4);
  assert.deepEqual([s.officeStart, s.officeEnd], ['07:00', '17:00']);
  assert.deepEqual(s.workingWeekdays, [1, 2, 3, 4, 5]);
  assert.equal(s.mode, 'higher');
});

test('dayKind: weekends, weekdays and the working-weekdays setting', () => {
  assert.equal(dayKind(SAT, {}, []), 'weekend');
  assert.equal(dayKind('2026-10-04', {}, []), 'weekend');
  assert.equal(dayKind(FRI, {}, []), 'weekday');
  // A Tue–Sat business: Saturday is a working day, Monday is not.
  const tueSat = { workingWeekdays: [2, 3, 4, 5, 6] };
  assert.equal(dayKind(SAT, tueSat, []), 'weekday');
  assert.equal(dayKind(LABOUR_DAY, tueSat, []), 'weekend');
});

test('dayKind: a listed holiday wins, a hidden one reads as the day it is, and no date is TBC', () => {
  assert.equal(dayKind(LABOUR_DAY, {}, [LABOUR_DAY]), 'holiday');
  assert.equal(dayKind(LABOUR_DAY, {}, [{ date: LABOUR_DAY, hidden: 0 }]), 'holiday');
  assert.equal(dayKind(LABOUR_DAY, {}, [{ date: LABOUR_DAY, hidden: 1 }]), 'weekday');
  assert.equal(dayKind(LABOUR_DAY, {}, [{ date: LABOUR_DAY, hidden: true }]), 'weekday');
  assert.equal(dayKind(LABOUR_DAY, {}, []), 'weekday');
  assert.equal(dayKind(null, {}, []), null);
  assert.equal(dayKind('', {}, []), null);
  assert.equal(dayKind('2026-02-30', {}, []), null);
});

test('afterHoursShare: the share of booked hours outside office hours', () => {
  assert.equal(afterHoursShare('09:00', '19:00', '07:00', '17:00'), 0.2);
  assert.equal(afterHoursShare('13:00', '21:00', '07:00', '17:00'), 0.5);
  assert.equal(afterHoursShare('09:00', '17:00', '07:00', '17:00'), 0);
  // An early call is after hours too (D11).
  assert.equal(afterHoursShare('05:00', '09:00', '07:00', '17:00'), 0.5);
});

test('afterHoursShare: overnight runs past midnight, and the next morning\'s office hours are in-hours (2026-10-02)', () => {
  assert.equal(afterHoursShare('20:00', '02:00', '07:00', '17:00'), 1);
  // 3pm to 1am: 2 of 10 hours in office.
  assert.equal(afterHoursShare('15:00', '01:00', '07:00', '17:00'), 0.8);
  // 4pm to 9am: 4–5pm and the next day's 7–9am are in office, 3 of 17 hours.
  // It was 16/17 while every hour past midnight counted as after hours.
  assert.equal(afterHoursShare('16:00', '09:00', '07:00', '17:00'), 14 / 17);
  // Wed 8pm → Thu 10am: Thu 7–10am in office, so 11 of 14 hours after.
  assert.equal(afterHoursShare('20:00', '10:00', '07:00', '17:00'), 11 / 14);
});

test('afterHoursShare: no times, one time, or no length is no share', () => {
  assert.equal(afterHoursShare(null, null, '07:00', '17:00'), 0);
  assert.equal(afterHoursShare('19:00', '', '07:00', '17:00'), 0);
  assert.equal(afterHoursShare('19:00', '19:00', '07:00', '17:00'), 0);
  assert.equal(afterHoursShare('25:00', '26:00', '07:00', '17:00'), 0);
  // Unusable office hours read as the defaults.
  assert.equal(afterHoursShare('09:00', '19:00', 'nope', '17:00'), 0.2);
});

test('worked example: a Saturday, no times, default mode is $1,680', () => {
  assert.equal(surchargeFactor({ date: SAT }, NO_SURCHARGES, false), 1.5);
  assert.equal(priceOn(1120, { date: SAT }, NO_SURCHARGES, false), 1680);
});

test('worked example: a weekday booked 9am–7pm, default mode is $1,176', () => {
  // 1120 × 1.05 is 1176.0000000000002 in floating point; it must not round up to $1,177.
  assert.equal(priceOn(1120, { date: FRI, startTime: '09:00', endTime: '19:00' }, NO_SURCHARGES, false), 1176);
});

test('worked example: a short-notice Saturday 1pm–9pm in each of the three modes', () => {
  const day = { date: SAT, startTime: '13:00', endTime: '21:00' };
  assert.equal(priceOn(1120, day, withMode('higher'), true), 3360);
  assert.equal(priceOn(1120, day, withMode('multiply'), true), 3780);
  assert.equal(priceOn(1120, day, withMode('highest'), true), 2240);
});

test('default mode: when after hours is the higher, it takes the after-hours share and weekend the rest', () => {
  const card = { surcharges: { weekend: 1.5, afterHours: 2 } };
  const day = { date: SAT, startTime: '13:00', endTime: '21:00' };
  assert.equal(priceOn(1120, day, card, false), 1960); // 1120 × (0.5 × 1.5 + 0.5 × 2)
  const a = surchargeAttribution(1120, day, card, false);
  assert.deepEqual(a.rows, [
    { type: 'weekend', multiplier: 1.5, share: 0.5, hours: 4, carry: false, amount: 280 },
    { type: 'afterHours', multiplier: 2, share: 0.5, hours: 4, carry: false, amount: 560 },
  ]);
});

test('an overnight Friday 8pm → 2am splits at midnight: the Saturday hours take the weekend rate (2026-10-02)', () => {
  const day = { date: FRI, startTime: '20:00', endTime: '02:00' };
  // Fri 8pm–12am after hours ×1.25 (4 of 6 hrs); Sat 12–2am weekend beats after hours, ×1.5 (2 of 6).
  assert.equal(surchargeFactor(day, NO_SURCHARGES, false), (4 / 6) * 1.25 + (2 / 6) * 1.5);
  assert.equal(priceOn(1120, day, NO_SURCHARGES, false), 1494); // 1,493.33 up to the dollar
  // All multiply: Saturday's hours are weekend AND after hours, 1.5 × 1.25.
  assert.equal(priceOn(1120, day, withMode('multiply'), false), 1634); // 1,633.33
  // The Saturday hours are their own carry-over rows, with the date they fall on.
  const a = surchargeAttribution(1120, day, NO_SURCHARGES, false);
  assert.equal(a.carryDate, SAT);
  assert.deepEqual(a.rows.map((r) => [r.type, r.carry, r.hours, r.amount]), [
    ['afterHours', false, 4, 186.67],
    ['weekend', true, 2, 187.33],
  ]);
  // A snapshotted next-date kind wins over the calendar (a Saturday the estimate saw as a weekday).
  assert.equal(priceOn(1120, { ...day, nextKind: 'weekday' }, NO_SURCHARGES, false), 1400);
  // Into a date of the same status there is no rate change and no carry-over row.
  const wed = surchargeAttribution(1120, { date: '2026-09-30', startTime: '20:00', endTime: '02:00' }, NO_SURCHARGES, false);
  assert.deepEqual([wed.carryDate, wed.rows.map((r) => [r.type, r.carry, r.hours])], [null, [['afterHours', false, 6]]]);
});

test('a public holiday on a weekday takes the weekend/holiday rate; a hidden one does not', () => {
  const day = { date: LABOUR_DAY };
  assert.equal(priceOn(1120, day, NO_SURCHARGES, false, [LABOUR_DAY]), 1680);
  assert.equal(priceOn(1120, day, NO_SURCHARGES, false, [{ date: LABOUR_DAY, hidden: 1 }]), 1120);
  assert.equal(priceOn(1120, day, NO_SURCHARGES, false, []), 1120);
  assert.equal(surchargeAttribution(1120, day, NO_SURCHARGES, false, [LABOUR_DAY]).rows[0].type, 'holiday');
});

test('a day saved with its kind keeps it, whatever the holiday list says now', () => {
  assert.equal(priceOn(1120, { date: LABOUR_DAY, kind: 'holiday' }, NO_SURCHARGES, false, []), 1680);
  assert.equal(priceOn(1120, { date: LABOUR_DAY, kind: 'weekday' }, NO_SURCHARGES, false, [LABOUR_DAY]), 1120);
  // A kind on a day with no date is ignored: TBC is TBC.
  assert.equal(priceOn(1120, { date: null, kind: 'holiday' }, NO_SURCHARGES, false), 1120);
});

test('a Date TBC day: no weekend or after hours, but short notice still applies (D9)', () => {
  const tbc = { date: null, startTime: '20:00', endTime: '23:00' };
  assert.equal(surchargeFactor(tbc, NO_SURCHARGES, false), 1);
  assert.equal(priceOn(1120, tbc, NO_SURCHARGES, false), 1120);
  assert.equal(priceOn(1120, tbc, NO_SURCHARGES, true), 2240);
  assert.equal(priceOn(1120, tbc, withMode('multiply'), true), 2240);
});

test('×1 everywhere is the base price, to the cent, not rounded up', () => {
  const off = { surcharges: { shortNotice: 1, weekend: 1, afterHours: 1, mode: 'multiply' } };
  const day = { date: SAT, startTime: '20:00', endTime: '02:00' };
  assert.equal(surchargeFactor(day, off, true), 1);
  assert.equal(priceOn(1120, day, off, true), 1120);
  assert.equal(priceOn(1120.5, day, off, true), 1120.5);
  assert.equal(priceOn(1120.5, { date: FRI }, NO_SURCHARGES, false), 1120.5);
  assert.deepEqual(surchargeAttribution(1120.5, day, off, true).rows, []);
});

test('a surcharged price rounds UP to the whole dollar, once, after every surcharge (D20)', () => {
  // 1120.20 × 1.5 = 1680.30 → $1,681 (a round() would say $1,680).
  assert.equal(priceOn(1120.2, { date: SAT }, NO_SURCHARGES, false), 1681);
  // 1120.20 × 1.5 × 2 = 3360.60 → $3,361, not ceil(1680.30) × 2 = $3,362.
  assert.equal(priceOn(1120.2, { date: SAT }, NO_SURCHARGES, true), 3361);
  // 7am–7pm is 2 of 12 hours after hours: 480 × (5/6 + 1/6 × 1.25) is exactly 500,
  // computed as 500.00000000000006. Float error must not cost the client a dollar.
  assert.equal(priceOn(480, { date: FRI, startTime: '07:00', endTime: '19:00' }, NO_SURCHARGES, false), 500);
  assert.equal(surchargedLinePrice(0, 2), 0);
  assert.equal(surchargedLinePrice(-50, 2), 0);
});

test('attribution: the worked examples, row by row', () => {
  const day = { date: SAT, startTime: '13:00', endTime: '21:00' };
  assert.deepEqual(surchargeAttribution(1120, day, withMode('higher'), true).rows, [
    { type: 'weekend', multiplier: 1.5, share: 1, hours: 8, carry: false, amount: 560 },
    { type: 'shortNotice', multiplier: 2, share: 1, hours: 8, carry: false, amount: 1680 },
  ]);
  assert.deepEqual(surchargeAttribution(1120, day, withMode('multiply'), true).rows, [
    { type: 'weekend', multiplier: 1.5, share: 1, hours: 8, carry: false, amount: 560 },
    { type: 'afterHours', multiplier: 1.25, share: 0.5, hours: 4, carry: false, amount: 210 },
    { type: 'shortNotice', multiplier: 2, share: 1, hours: 8, carry: false, amount: 1890 },
  ]);
  assert.deepEqual(surchargeAttribution(1120, day, withMode('highest'), true).rows, [
    { type: 'shortNotice', multiplier: 2, share: 1, hours: 8, carry: false, amount: 1120 },
  ]);
  // The whole booking, with no item hours given (the brief's D5 example as a day reading).
  const weekday = surchargeAttribution(1120, { date: FRI, startTime: '09:00', endTime: '19:00' }, NO_SURCHARGES, false);
  assert.deepEqual(weekday.rows, [{ type: 'afterHours', multiplier: 1.25, share: 0.2, hours: 2, carry: false, amount: 56 }]);
  assert.deepEqual([weekday.base, weekday.price, weekday.surcharge], [1120, 1176, 56]);
});

test('attribution: the round-up lands on the last row', () => {
  // 560.10 + 1680.30 = 2240.40 exactly; the price rounds 3360.60 up to 3361.
  const a = surchargeAttribution(1120.2, { date: SAT }, NO_SURCHARGES, true);
  assert.equal(a.price, 3361);
  assert.deepEqual(a.rows.map((r) => r.amount), [560.1, 1680.7]);
});

test('attribution: rows add up to price − base to the cent across a sweep', () => {
  const days = [
    { date: SAT },
    { date: FRI, startTime: '09:00', endTime: '19:00' },
    { date: SAT, startTime: '13:00', endTime: '21:00' },
    { date: FRI, startTime: '15:00', endTime: '01:00' },
    { date: SAT, startTime: '06:10', endTime: '23:35' },
    { date: LABOUR_DAY, startTime: '04:00', endTime: '11:00' },
    { date: null },
  ];
  const cards = [
    withMode('higher'), withMode('multiply'), withMode('highest'),
    { surcharges: { weekend: 1.35, afterHours: 1.7, shortNotice: 1.15, mode: 'higher' } },
    { surcharges: { weekend: 1.35, afterHours: 1.7, shortNotice: 1.15, mode: 'multiply' } },
    { surcharges: { weekend: 1.35, afterHours: 1.7, shortNotice: 1.15, mode: 'highest' } },
  ];
  let checked = 0;
  for (let base = 0.01; base < 4000; base = round2(base * 1.37 + 3.33)) {
    for (const day of days) {
      for (const card of cards) {
        for (const sn of [false, true]) {
          const a = surchargeAttribution(base, day, card, sn, [LABOUR_DAY]);
          const cents = a.rows.reduce((sum, r) => sum + Math.round(r.amount * 100), 0);
          assert.equal(cents, Math.round((a.price - a.base) * 100), `${base} ${JSON.stringify(day)}`);
          assert.equal(a.price, priceOn(base, day, card, sn, [LABOUR_DAY]));
          assert.ok(a.rows.every((r) => r.amount >= 0));
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 1000);
});

/* ── Surcharges in computeTotals (production-booking task 2) ───────────────
   A `prod` line whose dayId names one of the estimate's days is priced
   through task 1's maths; nothing else moves. Lines here carry their own
   snapshot (mu), as every line saved since 2026-09-28 does. */
const { surchargeSnapshot, stampSurchargedPrices } = require('../src/calc');

const DAY_CARD_PB = {
  labourSections: [{ id: 'prod', label: 'Production', rows: [] }, { id: 'post', label: 'Post', rows: [] }],
  travelRows: [],
  taxSetAsideRate: 0.3,
};
const capture = (extra) => ({ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, ...extra });
const SAT_DAY = { id: 'd_sat', date: SAT, status: 'confirmed', startTime: '13:00', endTime: '21:00' };
const FRI_DAY = { id: 'd_fri', date: FRI, status: 'pencilled', startTime: '09:00', endTime: '19:00' };
const TBC_DAY = { id: 'd_tbc', date: null, status: 'proposed', startTime: null, endTime: null };
const booked = (days, opts) => {
  const surcharges = surchargeSnapshot(days, DAY_CARD_PB, [], null);
  return { days, surcharges, ...(opts || {}) };
};

test('a production line on a Saturday is priced at $1,680; the $560 is income with no extra hours', () => {
  const rows = { prod: [capture({ dayId: 'd_sat' })] };
  const plain = computeTotals({ prod: [capture()] }, DAY_CARD_PB, UNREG);
  const t = computeTotals(rows, DAY_CARD_PB, UNREG, booked([{ ...SAT_DAY, startTime: null, endTime: null }]));
  assert.deepEqual([t.labourTotal, t.surchargeTotal, t.clientPriceExGst], [1680, 560, 1680]);
  assert.equal(t.totalHours, plain.totalHours);
  assert.equal(t.incomeExGst, 1680);
  assert.equal(t.taxSetAside, 504); // 30% of all of it: the surcharge is taxed
});

test('the worked examples price through computeTotals on the hours each item covers', () => {
  const rows = { prod: [capture({ dayId: 'd_sat' }), capture({ dayId: 'd_fri' }), capture({ dayId: 'd_tbc' })] };
  const days = [SAT_DAY, FRI_DAY, TBC_DAY];
  // Saturday 1–9pm $1,680; TBC at base. Friday 9–7 holds a full day of 8 hrs,
  // which covers 9–5: no after hours (it was $1,176 on D5's share of the booking).
  let t = computeTotals(rows, DAY_CARD_PB, UNREG, booked(days));
  assert.deepEqual([t.labourTotal, t.surchargeTotal], [1680 + 1120 + 1120, 560]);
  // Short notice: Saturday $3,360, Friday 2 × $1,120, TBC 2 × $1,120.
  t = computeTotals(rows, DAY_CARD_PB, UNREG, booked(days, { shortNotice: true }));
  assert.equal(t.labourTotal, 3360 + 2240 + 2240);
  // The mode comes from the snapshot, not the live card.
  const snap = booked(days, { shortNotice: true });
  snap.surcharges.settings.mode = 'multiply';
  assert.equal(computeTotals({ prod: [capture({ dayId: 'd_sat' })] }, DAY_CARD_PB, UNREG, snap).labourTotal, 3780);
});

test('each item is surcharged on its own hours from the booked start, never past the booked end', () => {
  const opts = (start, end) => booked([{ ...FRI_DAY, startTime: start, endTime: end }]);
  const price = (line, start, end) => computeTotals({ prod: [line] }, DAY_CARD_PB, UNREG, opts(start, end)).labourTotal;
  // Ten hourly hours on 9–7 still cover 5–7pm: D5's own $1,176.
  const tenHours = capture({ dayId: 'd_fri', dayUnit: undefined, hoursPerUnit: 1, mu: 112, qty: 10 });
  assert.equal(price(tenHours, '09:00', '19:00'), 1176);
  // A full day on a long 9am–9pm booking covers 9–5. The evening is Overtime's to bill.
  assert.equal(price(capture({ dayId: 'd_fri' }), '09:00', '21:00'), 1120);
  // The same full day from 1pm covers 1–9pm: 4 of its 8 hours after hours.
  assert.equal(price(capture({ dayId: 'd_fri' }), '13:00', '21:00'), 1260);
  // A two-hour item from a 3pm start covers 3–5pm, though the booking runs to 9.
  const twoHours = capture({ dayId: 'd_fri', dayUnit: undefined, hoursPerUnit: 1, mu: 140, qty: 2 });
  assert.equal(price(twoHours, '15:00', '21:00'), 280);
  // An item longer than the booking covers the booking: 8 hrs in a 6pm–10pm booking, all after hours.
  assert.equal(price(capture({ dayId: 'd_fri' }), '18:00', '22:00'), 1400);
  // Hours come from qty × hours per unit: two full days from 9am fill a 9am–9pm booking.
  assert.equal(price(capture({ dayId: 'd_fri', qty: 2 }), '09:00', '21:00'), Math.ceil(2240 * (8 / 12 + (4 / 12) * 1.25)));
});

test('short notice reaches a production line on no day, as on a Date TBC day', () => {
  const rows = { prod: [capture(), capture({ dayId: 'd_sat' })], post: [capture({ name: 'Edit' })] };
  const sat = { ...SAT_DAY, startTime: null, endTime: null };
  const t = computeTotals(rows, DAY_CARD_PB, UNREG, booked([sat], { shortNotice: true }));
  // Unassigned $2,240 (it used to stay $1,120) + Saturday $3,360 + Post untouched $1,120.
  assert.deepEqual([t.labourTotal, t.surchargeTotal], [2240 + 3360 + 1120, 1120 + 2240]);
  // With no days at all, the tick still applies, from the snapshot's own multiplier.
  const none = { days: [], shortNotice: true, surcharges: surchargeSnapshot([], { ...DAY_CARD_PB, surcharges: { shortNotice: 1.5 } }, [], null) };
  assert.equal(computeTotals({ prod: [capture()] }, DAY_CARD_PB, UNREG, none).labourTotal, 1680);
  // And without the tick, nothing on no day moves.
  assert.equal(computeTotals({ prod: [capture()] }, DAY_CARD_PB, UNREG, booked([sat])).labourTotal, 1120);
});

test('a line on no day, a dayId outside Production, and an estimate with no days all price as before', () => {
  const before = computeTotals({ prod: [capture()], post: [capture({ name: 'Edit' })] }, DAY_CARD_PB, UNREG);
  const opts = booked([SAT_DAY]);
  const noDay = computeTotals({ prod: [capture()], post: [capture({ name: 'Edit' })] }, DAY_CARD_PB, UNREG, opts);
  assert.deepEqual(noDay, before);
  const postOnDay = computeTotals({ prod: [capture()], post: [capture({ name: 'Edit', dayId: 'd_sat' })] }, DAY_CARD_PB, UNREG, opts);
  assert.deepEqual(postOnDay, before);
  // A dayId the estimate has no day for (and options with no days at all).
  assert.deepEqual(computeTotals({ prod: [capture({ dayId: 'd_gone' })], post: [capture({ name: 'Edit' })] }, DAY_CARD_PB, UNREG, opts), before);
  assert.deepEqual(computeTotals({ prod: [capture({ dayId: 'd_sat' })], post: [capture({ name: 'Edit' })] }, DAY_CARD_PB, UNREG), before);
  assert.equal(before.surchargeTotal, 0);
});

test('a custom-bill production line on a Saturday is surcharged on its custom amount', () => {
  const t = computeTotals({ prod: [capture({ dayId: 'd_sat', override: 500 })] }, DAY_CARD_PB, UNREG,
    booked([{ ...SAT_DAY, startTime: null, endTime: null }]));
  assert.deepEqual([t.labourTotal, t.surchargeTotal], [750, 250]);
});

test('on a GST-inclusive card the surcharge folds into the GST-inclusive price', () => {
  const t = computeTotals({ prod: [capture({ dayId: 'd_sat' })] }, DAY_CARD_PB, settingsWith(GST_INCLUSIVE),
    booked([{ ...SAT_DAY, startTime: null, endTime: null }]));
  assert.deepEqual([t.totalIncGst, t.clientPriceExGst, t.gst], [1680, 1527.27, 152.73]);
});

test('surchargeSnapshot: a new estimate takes the live card and today\'s holiday list', () => {
  const card = { ...DAY_CARD_PB, surcharges: { weekend: 1.75 } };
  const snap = surchargeSnapshot([SAT_DAY, TBC_DAY, { id: 'd_ld', date: LABOUR_DAY }], card, [LABOUR_DAY], null);
  assert.equal(snap.settings.weekend, 1.75);
  assert.deepEqual(snap.days, { d_sat: 'weekend', d_ld: 'holiday' }); // TBC has nothing to snapshot
});

test('surchargeSnapshot: a re-save keeps the old settings and each unmoved day\'s kind', () => {
  const prior = {
    surcharges: { settings: { ...SURCHARGE_DEFAULTS, weekend: 1.5 }, days: { d_ld: 'weekday', d_sat: 'weekend' } },
    days: [{ id: 'd_ld', date: LABOUR_DAY }, { id: 'd_sat', date: SAT }],
  };
  const liveCard = { ...DAY_CARD_PB, surcharges: { weekend: 3 } };
  const moved = { id: 'd_sat', date: FRI }; // a Saturday moved to a Friday
  const snap = surchargeSnapshot([{ id: 'd_ld', date: LABOUR_DAY }, moved, { id: 'd_new', date: LABOUR_DAY }],
    liveCard, [LABOUR_DAY], prior);
  assert.equal(snap.settings.weekend, 1.5);
  // Saved before Labour Day was on the list: still a weekday. A new day on it reads the list.
  // The moved day is read again (now a weekday), not kept as a weekend.
  assert.deepEqual(snap.days, { d_ld: 'weekday', d_sat: 'weekday', d_new: 'holiday' });
  // No prior settings (an estimate saved with no days) is a fresh snapshot.
  assert.equal(surchargeSnapshot([SAT_DAY], liveCard, [], { surcharges: {}, days: [] }).settings.weekend, 3);
});

test('stampSurchargedPrices: each production line the surcharges reach carries its price, and nothing else carries one', () => {
  const rows = {
    prod: [capture({ dayId: 'd_sat' }), capture({ surchargedPrice: 9999 })],
    post: [capture({ name: 'Edit', surchargedPrice: 1 })],
    crew: [{ name: 'Gaffer', days: 1, cost: 500 }],
  };
  const opts = booked([SAT_DAY], { shortNotice: true });
  const stamped = stampSurchargedPrices(rows, DAY_CARD_PB, opts);
  assert.equal(stamped.prod[0].surchargedPrice, 3360);
  // On no day, with short notice ticked: short notice only, and a stale stamp replaced.
  assert.equal(stamped.prod[1].surchargedPrice, 2240);
  assert.equal('surchargedPrice' in stamped.post[0], false);
  assert.deepEqual(stamped.crew, rows.crew);
  assert.equal(rows.prod[1].surchargedPrice, 9999); // the input is not modified
  // What is stamped is what is totalled.
  const t = computeTotals(stamped, DAY_CARD_PB, UNREG, opts);
  assert.equal(t.labourTotal, 3360 + 2240 + 1120);
  // Without the tick, a line on no day carries no price of its own.
  const plain = stampSurchargedPrices(rows, DAY_CARD_PB, booked([SAT_DAY]));
  assert.equal('surchargedPrice' in plain.prod[1], false);
});

/* ── The Cost Breakdown (production-booking task 8) ───────────────────────
   D13: each day's items at base price, each item's surcharges with their
   multiplier, the hours they covered and their $, carry-over rows after
   midnight, short notice once, then everything else — adding up to the stored
   total to the cent. */
const { costBreakdown } = require('../src/calc');

/* Every figure a reader of the breakdown adds up, in cents. */
function breakdownCents(b) {
  const c = (n) => Math.round(n * 100);
  let sum = 0;
  b.days.forEach((d) => d.lines.forEach((l) => {
    sum += c(l.base);
    l.surcharges.forEach((r) => { sum += c(r.amount); });
  }));
  if (b.shortNotice) sum += c(b.shortNotice.amount);
  b.sections.forEach((s) => s.lines.forEach((l) => { sum += c(l.amount); }));
  [b.travel, b.equip, b.crew].forEach((list) => list.forEach((l) => { sum += c(l.amount); }));
  return sum;
}

const breakdownOf = (rows, settings, opts) => {
  const totals = computeTotals(rows, DAY_CARD_PB, settings, opts);
  return { totals, b: costBreakdown(rows, DAY_CARD_PB, { ...opts, totals }) };
};
const rowsOf = (line) => line.surcharges.map((r) => [r.type, r.multiplier, r.hours, r.carry, r.amount]);

test('costBreakdown: the worked examples, each item\'s surcharges named with its hours, adding up to the total', () => {
  const rows = {
    prod: [capture({ dayId: 'd_sat' }), capture({ dayId: 'd_fri' }), capture({ dayId: 'd_tbc' })],
    post: [capture({ name: 'Edit' })],
    crew: [{ role: 'Gaffer', days: 1, cost: 500 }],
  };
  const { totals, b } = breakdownOf(rows, UNREG, booked([SAT_DAY, FRI_DAY, TBC_DAY]));
  const [sat, fri, tbc] = b.days;
  // Saturday 1–9pm: half of it is after hours, but the weekend's ×1.5 wins both halves.
  assert.deepEqual(sat.lines.map((l) => [l.base, l.price]), [[1120, 1680]]);
  assert.deepEqual(rowsOf(sat.lines[0]), [['weekend', 1.5, 8, false, 560]]);
  assert.deepEqual([sat.kind, sat.lines[0].window, sat.lines[0].coveredHours], ['weekend', { start: 780, end: 1260 }, 8]);
  // Friday 9–7 holds a full day: it covers 9–5, so nothing after hours.
  assert.deepEqual([fri.lines[0].window, rowsOf(fri.lines[0]), fri.price], [{ start: 540, end: 1020 }, [], 1120]);
  assert.deepEqual([rowsOf(tbc.lines[0]), tbc.price, tbc.kind, tbc.lines[0].window], [[], 1120, null, null]);
  assert.equal(b.shortNotice, null);
  assert.deepEqual(b.sections.map((s) => [s.id, s.total]), [['post', 1120]]);
  assert.deepEqual(b.crew.map((l) => [l.name, l.amount]), [['Gaffer', 500]]);
  assert.equal(b.surchargeTotal, totals.surchargeTotal);
  assert.equal(b.itemsTotal, totals.clientPriceExGst);
  assert.deepEqual([b.target, b.adjustment, b.stale], [totals.clientPriceExGst, 0, false]);
  assert.equal(breakdownCents(b), Math.round(totals.clientPriceExGst * 100));
});

test('costBreakdown: two items on one day each carry their own window and after-hours share', () => {
  // Fri 3pm–9pm: a full day covers 3–9pm (6 hrs, the booking's end), two drone hours cover 3–5pm.
  const day = { ...FRI_DAY, startTime: '15:00', endTime: '21:00' };
  const drone = capture({ name: 'Drone', dayId: 'd_fri', dayUnit: undefined, hoursPerUnit: 1, mu: 150, qty: 2 });
  const { totals, b } = breakdownOf({ prod: [capture({ dayId: 'd_fri' }), drone] }, UNREG, booked([day]));
  const [full, two] = b.days[0].lines;
  assert.deepEqual([full.window, full.coveredHours, rowsOf(full)], [{ start: 900, end: 1260 }, 6, [['afterHours', 1.25, 4, false, 187]]]); // 186.67 plus the round-up to $1,307
  assert.deepEqual([full.price, two.window, rowsOf(two), two.price], [1307, { start: 900, end: 1020 }, [], 300]);
  assert.equal(breakdownCents(b), Math.round(totals.clientPriceExGst * 100));
});

test('costBreakdown: hours after midnight on a date of another status are a carry-over row', () => {
  // Fri 8pm → Sat 2am; Sun 8pm → Mon 3am (weekend into weekday: after hours takes over).
  const fri = { id: 'd_fn', date: FRI, status: 'confirmed', startTime: '20:00', endTime: '02:00' };
  const sun = { id: 'd_sn', date: '2026-10-04', status: 'confirmed', startTime: '20:00', endTime: '03:00' };
  const rows = { prod: [capture({ dayId: 'd_fn' }), capture({ dayId: 'd_sn' })] };
  const opts = booked([fri, sun]);
  assert.deepEqual(opts.surcharges.nextDays, { d_fn: 'weekend', d_sn: 'weekday' });
  const { totals, b } = breakdownOf(rows, UNREG, opts);
  const [f, s] = b.days.map((d) => d.lines[0]);
  assert.deepEqual([rowsOf(f), f.carryDate, f.nextKind, f.price], [
    [['afterHours', 1.25, 4, false, 186.67], ['weekend', 1.5, 2, true, 187.33]], SAT, 'weekend', 1494]);
  // Sun 8pm–12am weekend (4 hrs); Mon 12–3am after hours (3 hrs), a carry-over into a weekday.
  assert.deepEqual([rowsOf(s), s.carryDate], [
    [['weekend', 1.5, 4, false, 320], ['afterHours', 1.25, 3, true, 120]], '2026-10-05']);
  assert.equal(breakdownCents(b), Math.round(totals.clientPriceExGst * 100));
});

test('costBreakdown: short notice is one row for the estimate, on every production item it reached', () => {
  const rows = {
    prod: [capture({ dayId: 'd_sat' }), capture({ dayId: 'd_fri' }), capture({ dayId: 'd_tbc' }), capture({ name: 'Loose' })],
    post: [capture({ name: 'Edit' })],
  };
  const { totals, b } = breakdownOf(rows, UNREG, booked([SAT_DAY, FRI_DAY, TBC_DAY], { shortNotice: true }));
  // $3,360 + $2,240 + $2,240 on days, $2,240 on no day: short notice is 1,680 + 1,120 × 3 of it.
  assert.deepEqual(b.days.map((d) => d.price), [3360, 2240, 2240]);
  assert.deepEqual(b.shortNotice, { multiplier: 2, amount: 1680 + 1120 * 3, items: 4 });
  // Short notice never appears among an item's own rows.
  assert.deepEqual(b.days.map((d) => d.lines[0].surcharges.map((r) => r.type)), [['weekend'], [], []]);
  // The line on no day lists at base, and is charged with its short notice.
  assert.deepEqual(b.sections.map((sec) => [sec.id, sec.lines.map((l) => [l.name, l.amount, l.price])]),
    [['prod', [['Loose', 1120, 2240]]], ['post', [['Edit', 1120, 1120]]]]);
  assert.equal(breakdownCents(b), Math.round(totals.clientPriceExGst * 100));
  assert.deepEqual([b.adjustment, b.surchargeTotal], [0, totals.surchargeTotal]);
});

test('costBreakdown: under "multiply" after hours is charged on the weekend price, and each row covers its own hours', () => {
  const opts = booked([SAT_DAY], { shortNotice: true });
  opts.surcharges.settings.mode = 'multiply';
  const { totals, b } = breakdownOf({ prod: [capture({ dayId: 'd_sat' })] }, UNREG, opts);
  assert.equal(totals.clientPriceExGst, 3780);
  assert.deepEqual(rowsOf(b.days[0].lines[0]), [['weekend', 1.5, 8, false, 560], ['afterHours', 1.25, 4, false, 210]]);
  assert.deepEqual([b.shortNotice.amount, b.days[0].price], [1890, 3780]);
  assert.equal(breakdownCents(b), 378000);
});

test('costBreakdown: the snapshot\'s settings explain the price, not the live card\'s', () => {
  const rows = { prod: [capture({ dayId: 'd_sat' })] };
  const opts = booked([{ ...SAT_DAY, startTime: null, endTime: null }]);
  const totals = computeTotals(rows, DAY_CARD_PB, UNREG, opts);
  const live = { ...DAY_CARD_PB, surcharges: { weekend: 3 } };
  const b = costBreakdown(rows, live, { ...opts, totals });
  assert.deepEqual(b.days[0].lines[0].surcharges.map((r) => [r.multiplier, r.amount]), [[1.5, 560]]);
  assert.deepEqual([b.adjustment, b.settings.weekend], [0, 1.5]);
});

test('costBreakdown: unassigned production lines list at base under Production; no days means no surcharge rows', () => {
  const rows = { prod: [capture(), capture({ dayId: 'd_gone', name: 'Drone' })], post: [capture({ name: 'Edit' })] };
  const { totals, b } = breakdownOf(rows, UNREG, booked([SAT_DAY]));
  assert.deepEqual(b.sections.map((s) => [s.id, s.lines.map((l) => [l.name, l.amount])]),
    [['prod', [['Video Capture', 1120], ['Drone', 1120]]], ['post', [['Edit', 1120]]]]);
  assert.deepEqual([b.days.length, b.days[0].lines.length, b.surchargeTotal], [1, 0, 0]);
  assert.equal(breakdownCents(b), Math.round(totals.clientPriceExGst * 100));

  const none = costBreakdown(rows, DAY_CARD_PB, { totals: computeTotals(rows, DAY_CARD_PB, UNREG) });
  assert.deepEqual([none.days, none.shortNotice, none.adjustment, none.settings], [[], null, 0, null]);
});

test('costBreakdown: a zero-quantity item with no price is left out', () => {
  const rows = { prod: [capture({ dayId: 'd_sat' }), capture({ dayId: 'd_sat', name: 'Drone', qty: 0 })] };
  const { b } = breakdownOf(rows, UNREG, booked([SAT_DAY]));
  assert.deepEqual(b.days[0].lines.map((l) => l.name), ['Video Capture']);
  // A custom amount with no quantity is still charged, so it stays.
  const custom = { prod: [capture({ dayId: 'd_sat', qty: 0, override: 300 })] };
  assert.equal(breakdownOf(custom, UNREG, booked([SAT_DAY])).b.days[0].lines.length, 1);
});

test('costBreakdown: the lines add up to the total inc GST on an inclusive card, and to the ex-GST price otherwise', () => {
  const rows = { prod: [capture({ dayId: 'd_sat' })], crew: [{ role: 'Gaffer', days: 1, cost: 550 }] };
  const opts = booked([{ ...SAT_DAY, startTime: null, endTime: null }]);
  const inc = breakdownOf(rows, settingsWith(GST_INCLUSIVE), opts);
  assert.deepEqual([inc.b.linesIncludeGst, inc.b.target, inc.b.adjustment], [true, inc.totals.totalIncGst, 0]);
  assert.equal(inc.totals.totalIncGst, 2230);
  const ex = breakdownOf(rows, settingsWith(GST_EXCLUSIVE), opts);
  assert.deepEqual([ex.b.linesIncludeGst, ex.b.target, ex.b.adjustment], [false, ex.totals.clientPriceExGst, 0]);
  assert.equal(ex.totals.totalIncGst, 2453);
  // GST-free on a registered card: no GST, so the lines are the price.
  const free = breakdownOf(rows, settingsWith(GST_INCLUSIVE), { ...opts, gstFree: true });
  assert.deepEqual([free.b.linesIncludeGst, free.b.target], [false, free.totals.totalIncGst]);
});

test('costBreakdown: lines in fractions of a cent leave a rounding difference, and nothing else does', () => {
  // 1.5 × $33.33 = $49.995 each; shown as $50.00 twice, totalled as $99.99.
  const rows = { post: [capture({ name: 'Grade', mu: 33.33, qty: 1.5 }), capture({ name: 'Mix', mu: 33.33, qty: 1.5 })] };
  const { totals, b } = breakdownOf(rows, UNREG, {});
  assert.equal(totals.clientPriceExGst, 99.99);
  assert.deepEqual([b.itemsTotal, b.target, b.adjustment, b.stale], [100, 99.99, -0.01, false]);
});

test('costBreakdown: totals that no longer match the lines are stale, not rounding', () => {
  // Lines worth $2,000 against stored totals of $1,400: an estimate saved by an older build.
  const rows = { post: [capture({ name: 'Edit', mu: 1000, qty: 2 })] };
  const b = costBreakdown(rows, DAY_CARD_PB, { totals: { clientPriceExGst: 1400, gst: 0, totalIncGst: 1400 } });
  assert.deepEqual([b.adjustment, b.stale], [-600, true]);
  // One cent on one line is rounding; two cents on one line is not.
  const one = costBreakdown(rows, DAY_CARD_PB, { totals: { clientPriceExGst: 1999.99, gst: 0, totalIncGst: 1999.99 } });
  assert.equal(one.stale, true);
  const two = costBreakdown({ post: [capture({ name: 'A', mu: 1000 }), capture({ name: 'B', mu: 999.99 })] }, DAY_CARD_PB,
    { totals: { clientPriceExGst: 2000, gst: 0, totalIncGst: 2000 } });
  assert.deepEqual([two.adjustment, two.stale], [0.01, false]);
});

test('costBreakdown: a sweep of prices, days, modes and GST cards always adds up to the stored total', () => {
  const settingsList = [UNREG, settingsWith(GST_INCLUSIVE), settingsWith(GST_EXCLUSIVE)];
  const LATE = { id: 'd_late', date: FRI, status: 'proposed', startTime: '18:00', endTime: '02:00' };
  const SUN = { id: 'd_sun', date: '2026-10-04', status: 'pencilled', startTime: '19:30', endTime: '04:15' };
  let checked = 0;
  for (const mode of ['higher', 'multiply', 'highest']) {
    for (const shortNotice of [false, true]) {
      for (const settings of settingsList) {
        for (let mu = 97; mu < 1500; mu += 137) {
          const rows = {
            prod: [capture({ dayId: 'd_sat', mu }), capture({ dayId: 'd_fri', mu: mu + 3, qty: 2 }),
              capture({ dayId: 'd_late', mu: mu / 2 }), capture({ dayId: 'd_tbc', override: mu + 0.5 }), capture({ mu }),
              capture({ dayId: 'd_sun', mu: mu + 7, dayUnit: undefined, hoursPerUnit: 1, qty: 3.5 }),
              capture({ dayId: 'd_late', mu: mu + 1, dayUnit: 'half', hoursPerUnit: 4 })],
            post: [capture({ name: 'Edit', mu: mu + 11 })],
            equip: [{ vendor: 'Lens', days: 2, cost: mu / 4 }],
          };
          const opts = booked([SAT_DAY, FRI_DAY, LATE, TBC_DAY, SUN], { shortNotice });
          opts.surcharges.settings.mode = mode;
          const { totals, b } = breakdownOf(rows, settings, opts);
          assert.equal(b.adjustment, 0, `mode ${mode}, mu ${mu}`);
          assert.equal(b.stale, false);
          assert.equal(breakdownCents(b), Math.round(b.target * 100));
          assert.equal(b.surchargeTotal, totals.surchargeTotal);
          const stamped = stampSurchargedPrices(rows, DAY_CARD_PB, opts).prod;
          b.days.forEach((d) => d.lines.forEach((l) => {
            assert.equal(l.price, stamped[l.index].surchargedPrice);
            const own = l.surcharges.reduce((sum, r) => sum + Math.round(r.amount * 100), 0);
            assert.ok(own <= Math.round((l.price - l.base) * 100)); // short notice is the rest
          }));
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 3 * 2 * 3 * 11);
});

/* ── The editor's surcharge box (production-booking B2-11, D87) ───────────
   The Cost Breakdown's surcharge rows, one per day and kind. The box and the
   PDF read the same figures, so they agree to the cent. */
const { surchargeSummary } = require('../src/calc');

const boxRows = (s) => s.rows.map((r) => [r.dayId, r.type, r.multiplier, r.carry, r.amount, r.items.length]);
const cents = (n) => Math.round(n * 100);

test('surchargeSummary: two items on a Saturday are one weekend row; short notice is one row; it all adds up', () => {
  const drone = capture({ name: 'Drone', dayId: 'd_sat', dayUnit: undefined, hoursPerUnit: 1, mu: 150, qty: 2 });
  const rows = { prod: [capture({ dayId: 'd_sat' }), drone, capture({ dayId: 'd_fri' })] };
  const { totals, b } = breakdownOf(rows, UNREG, booked([SAT_DAY, FRI_DAY], { shortNotice: true }));
  const s = surchargeSummary(b);
  // Saturday: $560 on the full day and $150 on the drone's $300. Friday's full day covers 9–5: nothing.
  assert.deepEqual(boxRows(s), [['d_sat', 'weekend', 1.5, false, 710, 2]]);
  assert.deepEqual([s.rows[0].date, s.rows[0].carryDate], [SAT, null]);
  // Short notice ×2 on the three items' surcharged prices: 1,680 + 450 + 1,120.
  assert.deepEqual(s.shortNotice, { multiplier: 2, amount: 3250, items: 3 });
  assert.equal(s.total, 3960);
  assert.equal(s.total, b.surchargeTotal);
  assert.equal(s.total, totals.surchargeTotal);
});

test('surchargeSummary: a row names the hours each item covered; carry-overs are their own rows, after the day\'s', () => {
  const day = { ...FRI_DAY, startTime: '15:00', endTime: '21:00' };
  const drone = capture({ name: 'Drone', dayId: 'd_fri', dayUnit: undefined, hoursPerUnit: 1, mu: 150, qty: 2 });
  const one = surchargeSummary(breakdownOf({ prod: [capture({ dayId: 'd_fri' }), drone] }, UNREG, booked([day])).b);
  // Only the full day reaches past 5pm: 4 of its 6 hrs. The drone (3–5pm) isn't in the row.
  assert.deepEqual(boxRows(one), [['d_fri', 'afterHours', 1.25, false, 187, 1]]);
  assert.deepEqual(one.rows[0].items, [{ name: 'Video Capture', hours: 4, coveredHours: 6, share: 4 / 6, timed: true }]);

  const fri = { id: 'd_fn', date: FRI, status: 'confirmed', startTime: '20:00', endTime: '02:00' };
  const sun = { id: 'd_sn', date: '2026-10-04', status: 'confirmed', startTime: '20:00', endTime: '03:00' };
  const { totals, b } = breakdownOf({ prod: [capture({ dayId: 'd_fn' }), capture({ dayId: 'd_sn' })] }, UNREG, booked([fri, sun]));
  const s = surchargeSummary(b);
  assert.deepEqual(boxRows(s), [
    ['d_fn', 'afterHours', 1.25, false, 186.67, 1],
    ['d_fn', 'weekend', 1.5, true, 187.33, 1],
    ['d_sn', 'weekend', 1.5, false, 320, 1],
    ['d_sn', 'afterHours', 1.25, true, 120, 1],
  ]);
  assert.deepEqual(s.rows.map((r) => r.carryDate), [null, SAT, null, '2026-10-05']);
  assert.deepEqual([s.shortNotice, s.total, totals.surchargeTotal], [null, 814, 814]);
});

test('surchargeSummary: rows are in a fixed order within a day, whichever item came first', () => {
  // Sat 5am–1pm, only the highest rate, after hours ×2: the drone (5–6am) is all after hours;
  // the full day (5am–1pm) is after hours until the 7am office start, weekend after.
  const day = { ...SAT_DAY, startTime: '05:00', endTime: '13:00' };
  const drone = capture({ name: 'Drone', dayId: 'd_sat', dayUnit: undefined, hoursPerUnit: 1, mu: 150, qty: 1 });
  const opts = booked([day]);
  Object.assign(opts.surcharges.settings, { mode: 'highest', afterHours: 2 });
  const { totals, b } = breakdownOf({ prod: [drone, capture({ dayId: 'd_sat' })] }, UNREG, opts);
  assert.deepEqual(b.days[0].lines.map((l) => l.surcharges.map((r) => r.type)), [['afterHours'], ['weekend', 'afterHours']]);
  const s = surchargeSummary(b);
  assert.deepEqual(s.rows.map((r) => [r.type, r.items.length]), [['weekend', 1], ['afterHours', 2]]);
  assert.equal(s.total, totals.surchargeTotal);
});

test('surchargeSummary: nothing surcharged, or no days at all, is no rows and a zero total', () => {
  const plain = surchargeSummary(breakdownOf({ prod: [capture({ dayId: 'd_fri' })] }, UNREG, booked([FRI_DAY, TBC_DAY])).b);
  assert.deepEqual([plain.rows, plain.shortNotice, plain.total], [[], null, 0]);
  const none = surchargeSummary(breakdownOf({ prod: [capture()] }, UNREG, {}).b);
  assert.deepEqual([none.rows, none.shortNotice, none.total], [[], null, 0]);
  assert.deepEqual(surchargeSummary(undefined), { rows: [], shortNotice: null, total: 0 });
  // Short notice with every line on no day is still a surcharge, and the box's to show.
  const loose = surchargeSummary(breakdownOf({ prod: [capture()] }, UNREG, { shortNotice: true, surcharges: booked([]).surcharges }).b);
  assert.deepEqual([loose.rows, loose.shortNotice, loose.total], [[], { multiplier: 2, amount: 1120, items: 1 }, 1120]);
});

test('surchargeSummary: across a sweep of prices, days, modes and GST cards, the rows add up to surchargeTotal to the cent', () => {
  const LATE = { id: 'd_late', date: FRI, status: 'proposed', startTime: '18:00', endTime: '02:00' };
  const SUN = { id: 'd_sun', date: '2026-10-04', status: 'pencilled', startTime: '19:30', endTime: '04:15' };
  let checked = 0;
  for (const mode of ['higher', 'multiply', 'highest']) {
    for (const shortNotice of [false, true]) {
      for (const settings of [UNREG, settingsWith(GST_INCLUSIVE)]) {
        for (let mu = 97; mu < 1500; mu += 137) {
          const rows = {
            prod: [capture({ dayId: 'd_sat', mu }), capture({ dayId: 'd_fri', mu: mu + 3, qty: 2 }),
              capture({ dayId: 'd_late', mu: mu / 3 }), capture({ dayId: 'd_tbc', override: mu + 0.5 }), capture({ mu }),
              capture({ dayId: 'd_sun', mu: mu + 7, dayUnit: undefined, hoursPerUnit: 1, qty: 3.5 }),
              capture({ dayId: 'd_late', mu: mu + 1, dayUnit: 'half', hoursPerUnit: 4 })],
          };
          const opts = booked([SAT_DAY, FRI_DAY, LATE, TBC_DAY, SUN], { shortNotice });
          opts.surcharges.settings.mode = mode;
          const { totals, b } = breakdownOf(rows, settings, opts);
          const s = surchargeSummary(b);
          const sum = s.rows.reduce((n, r) => n + cents(r.amount), 0) + (s.shortNotice ? cents(s.shortNotice.amount) : 0);
          assert.equal(sum, cents(s.total), `mode ${mode}, mu ${mu}`);
          assert.equal(cents(s.total), cents(b.surchargeTotal));
          assert.equal(cents(s.total), cents(totals.surchargeTotal));
          // Every item row the PDF prints is in exactly one box row.
          const itemRows = b.days.reduce((n, d) => n + d.lines.reduce((m, l) => m + l.surcharges.length, 0), 0);
          assert.equal(s.rows.reduce((n, r) => n + r.items.length, 0), itemRows);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 3 * 2 * 2 * 11);
});

/* ── The post-production planner (production-booking B2-1) ────────────────
   The brief's B2 Key Interactions 3. Suggests only: postPlan never reaches
   computeTotals, so these figures guide the owner's typed post hours and
   price nothing. */
const { postPlan } = require('../src/calc');

const PLAN_CARD = {
  serviceDay: { fullHours: 8, halfHours: 4 },
  labourSections: [
    {
      id: 'prod',
      label: 'Production',
      rows: [
        { id: 'r_vc', name: 'Video Capture', prices: { hour: 140, half: 640, full: 1120 }, capture: true },
        { id: 'r_dr', name: 'Drone Aerial Capture', prices: { hour: 84, half: null, full: null }, capture: true },
        { id: 'r_ph', name: 'Photo Capture', prices: { hour: 112, half: null, full: null } },
      ],
    },
    {
      id: 'post',
      label: 'Post-Production',
      rows: [{ id: 'r_ed', name: 'Video Editor — B-Roll Offline Edit', prices: { hour: 63, half: null, full: null } }],
    },
  ],
  travelRows: [],
  taxSetAsideRate: 0.3,
};
// Lines as the editor adds them: a price snapshot, and the capture flag of the row they came from.
const vcDay = (extra) => ({ name: 'Video Capture', rowId: 'r_vc', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, capture: true, ...extra });
const drone = (extra) => ({ name: 'Drone Aerial Capture', rowId: 'r_dr', qty: 2, mu: 84, hoursPerUnit: 1, capture: true, ...extra });
const photo = (extra) => ({ name: 'Photo Capture', rowId: 'r_ph', qty: 3, mu: 112, hoursPerUnit: 1, capture: false, ...extra });
const edit = (extra) => ({ name: 'Video Editor — B-Roll Offline Edit', rowId: 'r_ed', qty: 0, mu: 63, hoursPerUnit: 1, ...extra });
const deliverable = (id, multiplier, qty, extra) =>
  ({ id, name: id, format: '', duration: '', qty, typeId: 't_' + id, typeName: id, multiplier, ...extra });
const WORKED = {
  prod: [vcDay({ dayId: 'd_sat' }), drone(), photo()],
  deliverables: [deliverable('brand', 2, 1), deliverable('socials', 0.5, 3)],
};

test('postPlan worked example: 10 capture hours, Brand Story ×2 is 20 and Socials ×0.5 × 3 is 15, so 35', () => {
  assert.deepEqual(postPlan(WORKED, PLAN_CARD), {
    captureHours: 10, // the full day's 8 + the drone's 2; Photo Capture isn't ticked
    shares: [{ deliverableId: 'brand', hours: 20 }, { deliverableId: 'socials', hours: 15 }],
    recommended: 35,
    onPostLines: 0,
  });
});

test('postPlan: each share rounds UP to the half hour, and float error is not a half hour', () => {
  const share = (prod, multiplier, qty) =>
    postPlan({ prod, deliverables: [deliverable('d', multiplier, qty)] }, PLAN_CARD).shares[0].hours;
  // 10 × 0.33 = 3.3 → 3.5, never 3.
  assert.equal(share(WORKED.prod, 0.33, 1), 3.5);
  // 3 × 0.1 × 5 is 1.5000000000000002 in floating point: still 1.5, not 2.
  assert.equal(share([drone({ qty: 3 })], 0.1, 5), 1.5);
  // Exactly on a half hour stays put; just over it goes up.
  assert.equal(share(WORKED.prod, 0.25, 1), 2.5);
  assert.equal(share(WORKED.prod, 0.26, 1), 3);
  // Recommended is the sum of the ROUNDED shares, so the rows add up to it.
  const plan = postPlan({ prod: WORKED.prod, deliverables: [deliverable('a', 0.33, 1), deliverable('b', 0.33, 1)] }, PLAN_CARD);
  assert.deepEqual([plan.shares[0].hours, plan.shares[1].hours, plan.recommended], [3.5, 3.5, 7]);
});

test('postPlan edge cases: no capture lines, an untyped deliverable and qty 0 all recommend 0', () => {
  // No capture lines: 0 / 0.
  assert.deepEqual(postPlan({ prod: [photo()], deliverables: [deliverable('brand', 2, 1)] }, PLAN_CARD),
    { captureHours: 0, shares: [{ deliverableId: 'brand', hours: 0 }], recommended: 0, onPostLines: 0 });
  // Untyped: no typeId, whatever multiplier it carries. Saved before B2: no id either.
  const untyped = postPlan({ prod: WORKED.prod, deliverables: [deliverable('u', 2, 1, { typeId: undefined }), { name: 'Old', qty: 1 }] }, PLAN_CARD);
  assert.deepEqual(untyped.shares, [{ deliverableId: 'u', hours: 0 }, { deliverableId: null, hours: 0 }]);
  assert.equal(untyped.recommended, 0);
  // qty 0, and a qty or multiplier that isn't a usable number, add 0, never a negative.
  const odd = postPlan({ prod: WORKED.prod, deliverables: [deliverable('z', 2, 0), deliverable('n', 2, -1), deliverable('m', -2, 1), deliverable('s', 'x', 1)] }, PLAN_CARD);
  assert.deepEqual(odd.shares.map((s) => s.hours), [0, 0, 0, 0]);
  // Nothing at all.
  assert.deepEqual(postPlan(undefined, undefined), { captureHours: 0, shares: [], recommended: 0, onPostLines: 0 });
  assert.deepEqual(postPlan({ prod: 'x', deliverables: [null] }, PLAN_CARD), { captureHours: 0, shares: [], recommended: 0, onPostLines: 0 });
});

test('postPlan: a Full Day counts the Service Day it bills, so a 7-hour card gives 7', () => {
  const card7 = { ...PLAN_CARD, serviceDay: { fullHours: 7, halfHours: 3.5 } };
  // Added on the 7-hour card: its snapshot says 7.
  assert.equal(postPlan({ prod: [vcDay({ hoursPerUnit: 7 })] }, card7).captureHours, 7);
  // Saved before snapshots: it resolves through the live card's Service Day, as computeTotals does.
  assert.equal(postPlan({ prod: [{ name: 'Video Capture', qty: 1, dayUnit: 'full' }] }, card7).captureHours, 7);
  assert.equal(postPlan({ prod: [{ name: 'Video Capture', qty: 2, dayUnit: 'half' }] }, card7).captureHours, 7);
  // Added at 8 before the card moved to 7: it still bills 8 hours, so it captures 8.
  const added8 = { prod: [vcDay()] };
  assert.equal(postPlan(added8, card7).captureHours, 8);
  assert.equal(postPlan(added8, card7).captureHours, computeTotals(added8, card7, UNREG).totalHours);
});

test('postPlan: a line\'s own capture flag wins; a line saved before B2 falls back to its card row', () => {
  const hours = (line, card) => postPlan({ prod: [line] }, card || PLAN_CARD).captureHours;
  // Snapshotted either way, whatever the card says now.
  assert.equal(hours(drone({ capture: false })), 0);
  assert.equal(hours(photo({ capture: true })), 3);
  // No flag: the live row's tick, by id first (a renamed service), then by name.
  assert.equal(hours(drone({ capture: undefined })), 2);
  assert.equal(hours(photo({ capture: undefined })), 0);
  assert.equal(hours(drone({ capture: undefined, name: 'Drone (renamed on the card)' })), 2);
  assert.equal(hours({ name: 'Drone Aerial Capture', qty: 2, mu: 84, hoursPerUnit: 1 }), 2);
  // A row ticked with anything but true is not ticked, and a service gone from the card captures nothing.
  const truthy = { ...PLAN_CARD, labourSections: [{ id: 'prod', rows: [{ id: 'r_dr', name: 'Drone Aerial Capture', prices: { hour: 84, half: null, full: null }, capture: 'yes' }] }] };
  assert.equal(hours(drone({ capture: undefined }), truthy), 0);
  assert.equal(hours({ name: 'Gone', qty: 4, dayUnit: 'full', capture: undefined }), 0);
});

test('postPlan: only Production lines are capture, on a day, a TBC day or none', () => {
  const plan = postPlan({
    prod: [vcDay({ dayId: 'd_sat' }), vcDay({ dayId: 'd_tbc' }), vcDay()],
    post: [edit({ qty: 5, capture: true })],
    additional: [{ name: 'Overtime — per hour', qty: 3, mu: 210, hoursPerUnit: 1, capture: true }],
  }, PLAN_CARD);
  assert.equal(plan.captureHours, 24);
});

test('postPlan: "on post lines" is every post line\'s hours, tagged or not, and changes no recommendation', () => {
  const rows = { ...WORKED, post: [edit({ qty: 4, deliverableId: 'brand' }), edit({ qty: 2.5 }), edit({ qty: 0, deliverableId: 'socials' })] };
  const plan = postPlan(rows, PLAN_CARD);
  assert.equal(plan.onPostLines, 6.5);
  assert.equal(plan.recommended, 35);
  // Hours, not quantities: a post service sold by the day counts its day.
  const dayEdit = edit({ qty: 1, dayUnit: 'full', hoursPerUnit: 8 });
  assert.equal(postPlan({ post: [dayEdit] }, PLAN_CARD).onPostLines, 8);
});

test('the B2 fields price nothing: an estimate without them totals exactly as one with them', () => {
  const strip = (l) => { const { capture: _c, deliverableId: _d, ...rest } = l; return rest; };
  const withB2 = {
    ...WORKED,
    post: [edit({ qty: 4, deliverableId: 'brand' })],
    travel: [{ name: 'Crew Meals', qty: 2, mu: 30, rate: 30, dayId: 'd_sat' }],
    crew: [{ role: 'Gaffer', days: 1, cost: 600, dayId: 'd_sat' }],
    equip: [{ vendor: 'Lensworks', item: 'Cine zoom kit', days: 2, cost: 150, dayId: 'd_sat' }],
  };
  const before = {
    prod: withB2.prod.map(strip),
    post: withB2.post.map(strip),
    deliverables: withB2.deliverables.map(({ id: _i, typeId: _t, typeName: _n, multiplier: _m, ...rest }) => rest),
    travel: [{ name: 'Crew Meals', qty: 2, mu: 30, rate: 30 }],
    crew: [{ role: 'Gaffer', days: 1, cost: 600 }],
    equip: [{ vendor: 'Lensworks', days: 2, cost: 150 }],
  };
  assert.deepEqual(computeTotals(withB2, PLAN_CARD, UNREG), computeTotals(before, PLAN_CARD, UNREG));
});

/* D3, pinned for B2: travel, crew and equipment may now sit on a day (D74),
   but only Production is on set (D24). Not even the worst day there is — a
   Saturday, after hours, with short notice ticked — surcharges them. */
test('a travel, crew or equipment line on a Saturday after-hours short-notice day is never surcharged', () => {
  const NIGHT_SAT = { id: 'd_sat', date: SAT, status: 'confirmed', startTime: '18:00', endTime: '23:00' };
  const offSet = (dayId) => ({
    travel: [
      { name: 'Transport & Logistics Hrs', qty: 3, mu: 35, rate: 25, ownTime: true, dayId },
      { name: 'Vehicle — per km', qty: 80, mu: 0.9, perKm: true, dayId },
      { name: 'Tolls & Parking', qty: 40, mu: 1, rate: 1, directCost: true, dayId },
      { name: 'Crew Meals', qty: 4, mu: 30, rate: 25, dayId },
    ],
    crew: [{ role: 'Gaffer', days: 1, cost: 600, dayId }],
    equip: [{ vendor: 'Lensworks', item: 'Cine zoom kit', days: 2, cost: 150, dayId }],
  });
  const card = { ...DAY_CARD_PB, travelRows: [] };
  const opts = booked([NIGHT_SAT], { shortNotice: true });
  const plain = computeTotals(offSet(undefined), card, UNREG);
  const onDay = computeTotals(offSet('d_sat'), card, UNREG, opts);
  assert.deepEqual(onDay, plain);
  assert.equal(onDay.surchargeTotal, 0);
  assert.equal(onDay.totalHours, 3); // the own-time hours, carried as they always were
  assert.equal(onDay.clientPriceExGst, 105 + 72 + 40 + 120 + 600 + 300);

  // With a production line on the same day, only it moves.
  const rows = { ...offSet('d_sat'), prod: [capture({ dayId: 'd_sat' })] };
  const both = computeTotals(rows, card, UNREG, opts);
  const prodOnly = computeTotals({ prod: rows.prod }, card, UNREG, opts);
  assert.ok(prodOnly.surchargeTotal > 0);
  assert.equal(both.surchargeTotal, prodOnly.surchargeTotal);
  assert.equal(both.labourTotal, prodOnly.labourTotal);
  assert.equal(both.expenseTotal, plain.expenseTotal);

  // Stored lines carry no surcharged price, and the Cost Breakdown lists them at base, on no day.
  const stamped = stampSurchargedPrices(rows, card, opts);
  ['travel', 'crew', 'equip'].forEach((key) => stamped[key].forEach((l) => assert.equal(l.surchargedPrice, undefined)));
  assert.ok(stamped.prod[0].surchargedPrice > 0);
  const b = costBreakdown(offSet('d_sat'), card, opts);
  assert.equal(b.surchargeTotal, 0);
  assert.equal(b.shortNotice, null);
  assert.deepEqual(b.days.map((d) => d.lines.length), [0]);
  assert.deepEqual(b.travel.map((l) => l.amount), [105, 72, 40, 120]);
  assert.deepEqual([b.crew[0].amount, b.equip[0].amount], [600, 300]);
});

/* ── Invoices (production-booking task 14) ─────────────────────────────────
   The brief's worked example: a $5,000 estimate at a 50% deposit, and $420 of
   Overtime added to the final. A deposit is a PERCENT (50 is 50%). */
const { depositAmount, extrasTotals, finalInvoiceTotals, singleInvoiceTotals } = require('../src/calc');

const INVOICE_CARD = {
  labourSections: [
    { id: 'prod', label: 'Production', rows: [] },
    { id: 'additional', label: 'Additional work', rows: [{ id: 'r_ot', name: 'Overtime — per hour', prices: { hour: 210, half: null, full: null } }] },
  ],
  travelRows: [],
};
// Two hours of Overtime, snapshotted at $210 when it was added: $420 on the card.
const OVERTIME = { additional: [{ name: 'Overtime — per hour', rowId: 'r_ot', qty: 2, mu: 210, hoursPerUnit: 1 }] };
const figures = (ex, gst, total) => ({ clientPriceExGst: ex, gst, totalIncGst: total });

test('invoices worked example, unregistered: $5,000 at 50% is $2,500, and the final is $5,420 − $2,500 = $2,920', () => {
  const unreg = settingsWith({ registered: false });
  const estimate = computeTotals({ prod: [{ name: 'Shoot', qty: 1, mu: 5000, hoursPerUnit: 8 }] }, INVOICE_CARD, unreg);
  assert.deepEqual([estimate.clientPriceExGst, estimate.gst, estimate.totalIncGst], [5000, 0, 5000]);

  const deposit = depositAmount(estimate, 50);
  assert.deepEqual(deposit, { pct: 50, ...figures(2500, 0, 2500) });

  const extras = extrasTotals(OVERTIME, INVOICE_CARD, unreg, false);
  assert.equal(extras.totalIncGst, 420);

  const final = finalInvoiceTotals(estimate, extras, deposit);
  assert.deepEqual(final, {
    job: figures(5000, 0, 5000),
    extras: figures(420, 0, 420),
    total: figures(5420, 0, 5420),
    deposit: figures(2500, 0, 2500),
    balance: figures(2920, 0, 2920),
    balanceDue: 2920,
  });
});

test('invoices worked example, GST-inclusive card: the same $2,920 due, with GST split to the cent', () => {
  const inc = settingsWith(GST_INCLUSIVE);
  const estimate = figures(4545.45, 454.55, 5000); // as computeTotals stores $5,000 inc GST
  // GST is 454.55 × 2,500 / 5,000 = 227.275, rounded to 227.28; ex-GST is the rest.
  const deposit = depositAmount(estimate, 50);
  assert.deepEqual(deposit, { pct: 50, ...figures(2272.72, 227.28, 2500) });

  const extras = extrasTotals(OVERTIME, INVOICE_CARD, inc, false);
  assert.deepEqual([extras.clientPriceExGst, extras.gst, extras.totalIncGst], [381.82, 38.18, 420]);

  const final = finalInvoiceTotals(estimate, extras, deposit);
  assert.deepEqual(final.total, figures(4927.27, 492.73, 5420));
  assert.deepEqual(final.balance, figures(2654.55, 265.45, 2920));
  assert.equal(final.balanceDue, 2920);
});

test('invoices worked example, GST-exclusive card: $5,000 + GST is $5,500, deposit $2,750, balance $3,212', () => {
  const exc = settingsWith(GST_EXCLUSIVE);
  const estimate = computeTotals({ prod: [{ name: 'Shoot', qty: 1, mu: 5000, hoursPerUnit: 8 }] }, INVOICE_CARD, exc);
  assert.deepEqual([estimate.clientPriceExGst, estimate.gst, estimate.totalIncGst], [5000, 500, 5500]);

  const deposit = depositAmount(estimate, 50);
  assert.deepEqual(deposit, { pct: 50, ...figures(2500, 250, 2750) });

  const extras = extrasTotals(OVERTIME, INVOICE_CARD, exc, false);
  const final = finalInvoiceTotals(estimate, extras, deposit);
  assert.deepEqual(final.extras, figures(420, 42, 462));
  assert.deepEqual(final.total, figures(5420, 542, 5962));
  // Ex GST, the balance is the brief's $5,420 − $2,500 = $2,920.
  assert.deepEqual(final.balance, figures(2920, 292, 3212));
  assert.equal(final.balanceDue, 3212);
});

test('deposit: 30% and 0%, and a pct that is blank, negative, over 100 or text', () => {
  const unregJob = figures(5000, 0, 5000);
  const incJob = figures(4545.45, 454.55, 5000);
  assert.deepEqual(depositAmount(unregJob, 30), { pct: 30, ...figures(1500, 0, 1500) });
  // 454.55 × 0.3 = 136.365, rounded to 136.37.
  assert.deepEqual(depositAmount(incJob, 30), { pct: 30, ...figures(1363.63, 136.37, 1500) });
  assert.deepEqual(depositAmount(incJob, 0), { pct: 0, ...figures(0, 0, 0) });
  // GST is split on the deposit as rounded, not on the percent: 30% of $1,000.41 is $300.12,
  // whose GST is 300.12 ÷ 11 = 27.28. Taking 30% of the GST instead gives 27.29.
  assert.deepEqual(depositAmount(figures(909.46, 90.95, 1000.41), 30), { pct: 30, ...figures(272.84, 27.28, 300.12) });
  // The whole job is the estimate's own figures, GST and all.
  assert.deepEqual(depositAmount(incJob, 100), { pct: 100, ...incJob });

  // A PERCENT, not a fraction: 0.5 is half of one percent.
  assert.deepEqual(depositAmount(unregJob, 0.5), { pct: 0.5, ...figures(25, 0, 25) });
  assert.deepEqual(depositAmount(unregJob, '50'), { pct: 50, ...figures(2500, 0, 2500) });
  for (const none of [undefined, null, '', 'half', -10, NaN]) {
    assert.deepEqual(depositAmount(unregJob, none), { pct: 0, ...figures(0, 0, 0) }, String(none));
  }
  assert.deepEqual(depositAmount(incJob, 150), { pct: 100, ...incJob });
  assert.deepEqual(depositAmount(undefined, 50), { pct: 50, ...figures(0, 0, 0) });

  // With no deposit, the final is the whole job.
  const final = finalInvoiceTotals(incJob, null, depositAmount(incJob, 0));
  assert.deepEqual(final.balance, incJob);
  assert.equal(final.balanceDue, 5000);
});

test('single invoice: the estimate plus extras, all due, no deposit', () => {
  const inc = settingsWith(GST_INCLUSIVE);
  const single = singleInvoiceTotals(figures(4545.45, 454.55, 5000), extrasTotals(OVERTIME, INVOICE_CARD, inc, false));
  assert.deepEqual(single, {
    job: figures(4545.45, 454.55, 5000),
    extras: figures(381.82, 38.18, 420),
    total: figures(4927.27, 492.73, 5420),
    deposit: null,
    balance: figures(4927.27, 492.73, 5420),
    balanceDue: 5420,
  });
  // No extras: exactly the estimate.
  assert.deepEqual(singleInvoiceTotals(figures(1234.57, 0, 1234.57), null).balance, figures(1234.57, 0, 1234.57));
});

test('extras follow the estimate\'s GST-free tick and are never surcharged', () => {
  const exc = settingsWith(GST_EXCLUSIVE);
  assert.deepEqual(
    [extrasTotals(OVERTIME, INVOICE_CARD, exc, true).gst, extrasTotals(OVERTIME, INVOICE_CARD, exc, true).totalIncGst],
    [0, 420],
  );
  // Only `=== true` drops GST, as computeTotals' gstFree.
  assert.equal(extrasTotals(OVERTIME, INVOICE_CARD, exc, 'yes').gst, 42);
  // A production line with a dayId, even on a Saturday, prices at its base: an extra carries no days.
  const onDay = { prod: [{ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, dayId: 'd_sat' }] };
  const t = extrasTotals(onDay, INVOICE_CARD, settingsWith({ registered: false }), false);
  assert.deepEqual([t.totalIncGst, t.surchargeTotal], [1120, 0]);
  assert.deepEqual(extrasTotals(undefined, INVOICE_CARD, exc, false).totalIncGst, 0);
});

test('invoices: across a sweep of totals, percents and GST cards, deposit + balance is the estimate plus extras to the cent', () => {
  const cards = [settingsWith({ registered: false }), settingsWith(GST_EXCLUSIVE), settingsWith(GST_INCLUSIVE)];
  let checked = 0;
  for (const settings of cards) {
    for (let mu = 97.13; mu < 9000; mu += 731.37) {
      const estimate = computeTotals({ prod: [{ name: 'Shoot', qty: 1, mu, hoursPerUnit: 8 }] }, INVOICE_CARD, settings);
      for (const extraHours of [0, 1.5, 3]) {
        const extras = extrasTotals({ additional: [{ ...OVERTIME.additional[0], qty: extraHours, mu: mu / 7 }] }, INVOICE_CARD, settings, false);
        for (const pct of [0, 10, 25, 30, 33.3, 50, 66.67, 100]) {
          const deposit = depositAmount(estimate, pct);
          const label = `mu ${mu}, pct ${pct}, extras ${extraHours}`;
          assert.equal(cents(deposit.clientPriceExGst) + cents(deposit.gst), cents(deposit.totalIncGst), label);
          const final = finalInvoiceTotals(estimate, extras, deposit);
          for (const key of ['clientPriceExGst', 'gst', 'totalIncGst']) {
            assert.equal(cents(deposit[key]) + cents(final.balance[key]), cents(estimate[key]) + cents(extras[key]), `${key}, ${label}`);
          }
          assert.equal(cents(final.balance.clientPriceExGst) + cents(final.balance.gst), cents(final.balance.totalIncGst), label);
          assert.ok(final.balance.totalIncGst >= 0, label);
          const single = singleInvoiceTotals(estimate, extras);
          assert.equal(cents(single.balanceDue), cents(final.balanceDue) + cents(deposit.totalIncGst), label);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 3 * 13 * 3 * 8);
});

test('average job value counts accepted estimates; declined and sent ones are not jobs', () => {
  const job = (status, date, price) => ({ status, date, totals: { clientPriceExGst: price } });
  assert.deepEqual(
    averageJobValue(
      [
        job('accepted', '2026-09-01', 3000),
        job('approved', '2026-08-01', 1000), // not yet migrated: still read
        job('declined', '2026-09-01', 9000),
        job('sent', '2026-09-01', 9000),
        job('draft', '2026-09-01', 9000),
      ],
      '2026-10-03',
    ),
    { average: 2000, count: 2 },
  );
  assert.equal(averageJobValue([job('declined', '2026-09-01', 9000)], '2026-10-03'), null);
});
