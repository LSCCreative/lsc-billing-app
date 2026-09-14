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
  WEEKS_PER_YEAR,
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
 * The 960 hours are 20 billable hrs/week × WEEKS_PER_YEAR (48, not 52 — four
 * weeks of the year bill nothing; see decision 2 in calc.js's header).
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
  assert.equal(overheadRatePerHour(annualOverheadTotal(OVERHEAD), 20), 25);
});

test('billable capacity annualises at 48 weeks, not 52', () => {
  // The whole difference between the two conventions, pinned: at 52 weeks the
  // same inputs would give 23.08, and every rate on the card would sit ~8% low.
  assert.equal(WEEKS_PER_YEAR, 48);
  assert.equal(overheadRatePerHour(24000, 20), 25);
  assert.notEqual(overheadRatePerHour(24000, 20), round2(24000 / (20 * 52)));
});

test('no billable capacity gives no rate — never Infinity, NaN or zero', () => {
  // The case that would otherwise divide by zero and put "$Infinity" on a rate
  // card. Null is what the screens render as an em dash.
  for (const capacity of [0, -5, null, undefined, '', 'twenty']) {
    const rate = overheadRatePerHour(24000, capacity);
    assert.equal(rate, null, `capacity ${JSON.stringify(capacity)} should give null`);
  }
});

test('no overhead recorded gives no rate, rather than a $0.00 cost basis', () => {
  // "$0.00" on the rate card would read as a computed answer meaning an hour
  // costs nothing, instead of "you haven't set this up yet".
  assert.equal(overheadRatePerHour(0, 20), null);
  assert.equal(overheadRatePerHour(annualOverheadTotal([]), 20), null);
  assert.equal(overheadRatePerHour(null, 20), null);
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
