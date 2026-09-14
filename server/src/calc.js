'use strict';

/**
 * The money model. Pure — no database, no filesystem, no DOM — so the server,
 * the PDF renderer and the browser can all agree on one set of numbers.
 *
 * Ported from BILLING_APP_PLAN.md §1.2, which corrects two things the desktop
 * app got wrong:
 *
 *   1. "Gross Profit" counted pass-through costs (crew, equipment, direct
 *      travel) as profit. Money that lands in the account and goes straight
 *      back out is not margin. Take-home is now labour revenue only.
 *   2. There was no GST anywhere, so an invoice could not be a valid Australian
 *      tax invoice.
 *
 * Naming follows the plan: `clientPriceExGst` / `gst` / `totalIncGst` /
 * `taxSetAside` / `estTakeHome` replace the old "Net Invoice" / "Internal Tax" /
 * "Gross Profit" labels.
 *
 * GST-FREE ESTIMATES
 * Being GST-registered does not make every job GST-bearing, so an individual
 * estimate can be marked GST-free (`options.gstFree`) and is then priced exactly
 * as an unregistered business would price it: no GST line, and the rate card's
 * figures are what the client pays.
 *
 * That last part is a decision, not a derivation, and it only bites when the
 * rate card is kept GST-inclusive. A service listed at $560 normally splits into
 * $509.09 + $50.91 GST. On a GST-free estimate the client still pays $560 — the
 * listed rate is the price — rather than $509.09. Decided with the user on
 * 2026-09-10: the quoted price should not move depending on the job's tax
 * treatment. It follows that the whole $560 is revenue on such a job, so the tax
 * set-aside is provisioned against all of it, which is what falls out of
 * treating the estimate as unregistered.
 *
 * OVERHEAD, GOALS AND THE COST BASIS
 * Added 2026-09-15 for the Finance area (.design/overhead-finance/). Four pure
 * functions turn the real recurring cost of running the business into one
 * number — Overhead Rate/hr — which becomes the reference `rate` on every
 * labour row of the card, plus an advisory per-job floor (Minimum Job Price).
 *
 * None of this changes what a client is billed. `mu` drives `labourTotal`
 * above; `rate` is a reference figure `computeTotals` never reads. That is
 * exactly why making it computed is safe. If `rate` ever starts feeding billing
 * math, this safety argument has to be made again, not assumed to still hold.
 *
 * Three decisions, none of them derivable from the arithmetic:
 *
 *   1. NO WAGE TERM. The original concept had a Base Cost Rate of Wage +
 *      Overhead. The wage half is gone: `mu` already prices labour, and the
 *      business owner is trusted to set it high enough to pay themselves.
 *      Nothing here checks that — Minimum Job Price verifies overhead and
 *      profit-margin recovery only, and Desired Net Income is an annual
 *      planning input to targetAnnualRevenue, never compared against any
 *      per-job or per-row figure. Confirmed with the user on 2026-09-15 after
 *      an accounting review that put the gap explicitly in front of them. Do
 *      not add a wage term back without asking again — it was declined
 *      knowingly, not overlooked.
 *
 *   2. BILLABLE CAPACITY ANNUALISES AT 48 WEEKS, NOT 52 (WEEKS_PER_YEAR).
 *      Hours entered are billable hours in a working week, so the year carries
 *      roughly four weeks of leave and downtime that bill nothing. Costs are
 *      untouched by this — a weekly expense is owed all 52 weeks, which is why
 *      FREQUENCY_MULTIPLIERS.weekly is 52 while capacity uses 48. Fewer
 *      billable hours means a higher recovery rate, so the error direction is
 *      the conservative one. Decided with the user on 2026-09-15.
 *
 *   3. TAX IS PROVISIONED AGAINST REVENUE, NOT PROFIT. targetAnnualRevenue
 *      solves (overhead + desired net) / (1 - taxRate), treating tax as a flat
 *      slice off the top. Income tax is really levied on profit, so this is not
 *      the accountant's formula — it is the one the rest of this file already
 *      uses (taxSetAside above is labour revenue × taxSetAsideRate). One
 *      internally consistent planning figure beats two models of tax in the
 *      same app disagreeing by thousands. Chosen with the user on 2026-09-15;
 *      it errs high, asking for more revenue than a profit-based calculation
 *      would.
 *
 * UNITS — the one trap in here. `taxRate` and `taxSetAsideRate` are FRACTIONS
 * (0.35 is 35%, as the rate card stores it). `profitMarginPct` is a PERCENT (25
 * is 25%, as goals.target_profit_margin_pct stores it). The parameter names
 * carry the difference and these functions do not guess: a margin passed as
 * 0.25 is read as a quarter of one percent, not as a quarter.
 */

/** Money is stored and compared at cent precision, never as raw float sums. */
function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} activeRows  { deliverables, preprod, prod, post, travel, crew, equip }
 *   — the rows saved on the estimate. Labour rows carry { name, qty, override },
 *   travel rows { name, qty }, crew/equip rows { days, cost }.
 * @param {object} pricing     the rate card: { labourSections, travelRows, taxSetAsideRate }
 * @param {object} settings    { gst: { registered, rate, pricesIncludeGst } }
 * @param {object} [options]   the estimate's own tax treatment: { gstFree }.
 *   Named `options` rather than `estimate` or `document` on purpose — this file
 *   is copied verbatim into the browser, where a parameter called `document`
 *   would shadow the global inside this function.
 * @returns {object} totals, every money figure rounded to cents.
 */
function computeTotals(activeRows, pricing, settings, options) {
  const rows = activeRows || {};
  const labourSections = (pricing && pricing.labourSections) || [];
  const travelDefs = (pricing && pricing.travelRows) || [];
  const gstCfg = (settings && settings.gst) || {};

  /* A GST-free estimate prices as though the business were not registered. The
     whole rule is this line; see "GST-free estimates" in the header for why the
     GST-inclusive case resolves the way it does.

     Strictly `=== true`, matching gst.registered below rather than being merely
     truthy: dropping GST off an invoice is the expensive direction to get wrong,
     so a stray 1 or "yes" from a half-populated request body must not do it. */
  const gstFree = (options && options.gstFree) === true;
  const gstRegistered = gstCfg.registered === true && !gstFree;
  const gstRate = gstRegistered ? num(gstCfg.rate) : 0;
  const pricesIncludeGst = gstRegistered && gstCfg.pricesIncludeGst === true;

  // ── Labour ──────────────────────────────────────────────────────────────
  // A row is billed at qty × marked-up rate, unless it carries an explicit
  // override (the "Raw Footage Handover [on HDD]" custom-bill case).
  let labourTotal = 0;
  let totalHours = 0;

  for (const section of labourSections) {
    const saved = rows[section.id] || [];
    for (const line of saved) {
      const def = (section.rows || []).find((r) => r.name === line.name);
      if (!def) continue; // rate removed from the card since this was saved
      const qty = num(line.qty);
      totalHours += qty;
      const override = num(line.override);
      labourTotal += override > 0 ? override : qty * num(def.mu);
    }
  }

  // ── Travel ──────────────────────────────────────────────────────────────
  // Direct-cost rows (fuel, flights, accommodation) are billed at what they
  // cost. Everything else is billed at the marked-up rate.
  let travelTotal = 0;
  let travelPassThrough = 0;

  for (const line of rows.travel || []) {
    const def = travelDefs.find((r) => r.name === line.name);
    if (!def) continue;
    const qty = num(line.qty);
    if (def.directCost) {
      travelTotal += qty;
      travelPassThrough += qty;
    } else {
      travelTotal += qty * num(def.mu);
    }
  }

  // ── Crew and equipment ──────────────────────────────────────────────────
  // Always billed at cost: these are other people's invoices passing through.
  let crewTotal = 0;
  for (const line of rows.crew || []) crewTotal += num(line.days) * num(line.cost);

  let equipTotal = 0;
  for (const line of rows.equip || []) equipTotal += num(line.days) * num(line.cost);

  const expenseTotal = travelTotal + crewTotal + equipTotal;
  const passThroughCost = crewTotal + equipTotal + travelPassThrough;

  // ── GST ─────────────────────────────────────────────────────────────────
  // `billed` is the sum of every line as entered. Whether that figure already
  // contains GST depends on how the rate card is kept, so the split runs one of
  // two ways rather than assuming.
  const billed = labourTotal + expenseTotal;

  let clientPriceExGst;
  let gst;
  let totalIncGst;

  if (!gstRegistered) {
    clientPriceExGst = billed;
    gst = 0;
    totalIncGst = billed;
  } else if (pricesIncludeGst) {
    totalIncGst = billed;
    clientPriceExGst = billed / (1 + gstRate);
    gst = totalIncGst - clientPriceExGst;
  } else {
    clientPriceExGst = billed;
    gst = billed * gstRate;
    totalIncGst = billed + gst;
  }

  // ── Take-home ───────────────────────────────────────────────────────────
  // Income tax is provisioned against labour revenue only, and against the
  // ex-GST figure — GST collected belongs to the ATO, not to the business, so
  // it is never part of the tax-set-aside base.
  const labourExGst = pricesIncludeGst ? labourTotal / (1 + gstRate) : labourTotal;
  const taxSetAsideRate = num(pricing && pricing.taxSetAsideRate);
  const taxSetAside = labourExGst * taxSetAsideRate;
  const estTakeHome = labourExGst - taxSetAside;

  return {
    // What the client sees
    clientPriceExGst: round2(clientPriceExGst),
    gst: round2(gst),
    totalIncGst: round2(totalIncGst),

    // How it breaks down
    labourTotal: round2(labourTotal),
    expenseTotal: round2(expenseTotal),
    passThroughCost: round2(passThroughCost),
    totalHours: round2(totalHours),

    // What it means for the business
    taxSetAside: round2(taxSetAside),
    estTakeHome: round2(estTakeHome),
  };
}

/**
 * How a saved estimate's document should describe GST: 'taxable' (GST charged),
 * 'free' (this job was marked GST-free), or 'none' (no GST charged at all —
 * the business wasn't registered when it was saved).
 *
 * Read from what was stored, never from live settings: whether GST was charged
 * is a fact about a document that may already be with the client, and the
 * stored `gst` figure is the record of it. Switching registration later must not
 * turn an old invoice into a tax invoice, or strip the GST line off one.
 */
function gstTreatment(totals, options) {
  if ((options && options.gstFree) === true) return 'free';
  return num(totals && totals.gst) > 0 ? 'taxable' : 'none';
}

/* ── Overhead, goals and the cost basis ──────────────────────────────────────
   See "Overhead, goals and the cost basis" in the header for the decisions
   behind these; the arithmetic below is the easy half. */

/** Billable weeks in a working year — decision 2 in the header. */
const WEEKS_PER_YEAR = 48;

/**
 * How many times a year each frequency is paid.
 *
 * `one_off` counts once: a one-off cost is real money out the door this year,
 * so it belongs in the annual total (decided with the user on 2026-09-15). It
 * carries no expiry — a one-off entered two years ago still counts until it is
 * deleted by hand. That is a housekeeping habit, not a bug to patch with date
 * logic, and it errs towards overstating overhead rather than understating it.
 */
const FREQUENCY_MULTIPLIERS = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  annual: 1,
  one_off: 1,
};

/**
 * Like num(), but keeps "missing" distinguishable from zero. The functions
 * below return null for "cannot be computed" and that has to survive an input
 * of undefined, which num() would quietly turn into a real 0.
 */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * One overhead item's cost across a year.
 *
 * An unrecognised frequency contributes nothing rather than being guessed at as
 * annual. The database CHECK makes that unreachable for a stored row, so a
 * value arriving here off the list means something upstream is already wrong,
 * and it should read as missing rather than as a plausible number.
 *
 * Exported so the expense table's monthly-equivalent column can divide this by
 * 12 instead of keeping a second copy of the multipliers.
 */
function annualisedCost(item) {
  const cost = numOrNull(item && item.cost);
  if (cost === null) return 0;
  const multiplier = FREQUENCY_MULTIPLIERS[item && item.frequency];
  if (!multiplier) return 0;
  return cost * multiplier;
}

/**
 * @param {Array<{cost:number, frequency:string}>} items — overhead_items rows.
 * @returns {number} the annual cost of running the business, at cent precision.
 *
 * Item costs are entered GST-exclusive by convention — a hint on the entry
 * form, deliberately not a registered-toggle plus conversion. A GST-inclusive
 * figure typed in regardless overstates this total, and everything computed
 * from it, by the GST component. That is an accepted risk of the hint-only
 * approach, reconfirmed 2026-09-15, not an oversight to silently correct here.
 */
function annualOverheadTotal(items) {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const item of items) total += annualisedCost(item);
  return round2(total);
}

/**
 * The cost basis: what a single billable hour must earn, before any profit, to
 * carry its share of running the business. Annual overhead ÷ annual billable
 * hours, where the year is WEEKS_PER_YEAR long.
 *
 * @param {number} annualTotal — from annualOverheadTotal().
 * @param {number} billableCapacityHrsPerWeek — goals.billable_capacity_hrs_per_week.
 * @returns {number|null} null when the rate cannot be computed: no billable
 *   capacity set, or no overhead recorded. Null rather than 0, Infinity or NaN,
 *   because every screen that renders this shows an em dash for null, and a
 *   rate card reading "$0.00" looks like a computed answer meaning "an hour of
 *   your time costs nothing" instead of "you have not set this up yet". A zero
 *   overhead total is treated as that same empty state — a business with
 *   genuinely no costs is not a case worth mispricing every other one for.
 */
function overheadRatePerHour(annualTotal, billableCapacityHrsPerWeek) {
  const total = numOrNull(annualTotal);
  if (total === null || total <= 0) return null;

  const hrsPerWeek = numOrNull(billableCapacityHrsPerWeek);
  if (hrsPerWeek === null || hrsPerWeek <= 0) return null;

  return round2(total / (hrsPerWeek * WEEKS_PER_YEAR));
}

/**
 * The advisory floor for one job: what it has to clear to cover its direct
 * costs, its share of overhead, and the target margin.
 *
 *   (directJobCosts + estimatedHours × overheadRate) × (1 + profitMarginPct/100)
 *
 * Advisory only. computeTotals never reads this, and the estimate editor's
 * toggle must never move clientPriceExGst or totalIncGst in either position.
 *
 * @param {number} directJobCosts — the job's own out-of-pocket costs, i.e.
 *   expenseTotal from computeTotals.
 * @param {number} estimatedHours — totalHours from computeTotals.
 * @param {number} overheadRate — from overheadRatePerHour().
 * @param {number} profitMarginPct — a PERCENT (25 is 25%), unlike the tax rates
 *   elsewhere in this file, which are fractions. See UNITS in the header.
 * @returns {number|null} null when there is no overhead rate to allocate from,
 *   so the editor shows its set-up prompt rather than a floor that silently
 *   leaves overhead out and reads as if it were the real minimum.
 */
function minimumJobPrice(directJobCosts, estimatedHours, overheadRate, profitMarginPct) {
  const rate = numOrNull(overheadRate);
  if (rate === null || rate <= 0) return null;

  /* A 0% margin is a real answer — "just break even on this one" — so it is
     allowed through where a missing margin is not. */
  const margin = numOrNull(profitMarginPct);
  if (margin === null || margin < 0) return null;

  const cost = num(directJobCosts) + num(estimatedHours) * rate;
  return round2(cost * (1 + margin / 100));
}

/**
 * The annual planning figure: the revenue needed to cover overhead and still
 * leave the desired net income after tax.
 *
 *   (annualOverheadTotal + desiredNetIncome) / (1 - taxRate)
 *
 * Tax as a flat slice of revenue, per decision 3 in the header — this is the
 * app's existing model of tax, not the accountant's. A planning target only: it
 * is never compared against a per-job or per-row number anywhere.
 *
 * @param {number} taxRate — a FRACTION (0.35 is 35%), read from
 *   pricing.taxSetAsideRate. Goals deliberately has no tax field of its own;
 *   the rate card's is the one stored truth.
 * @returns {number|null} null when there is no overhead recorded yet — the stat
 *   shows an em dash rather than a target computed against a zero overhead
 *   total, which would read as a real answer while being wrong — or when the
 *   tax rate is not a fraction below 1. At exactly 1 the division is infinite,
 *   and above it the sign flips; a negative revenue target is worse than none.
 */
function targetAnnualRevenue(annualTotal, desiredNetIncome, taxRate) {
  const total = numOrNull(annualTotal);
  if (total === null || total <= 0) return null;

  const net = numOrNull(desiredNetIncome);
  if (net === null || net < 0) return null;

  const rate = numOrNull(taxRate);
  if (rate === null || rate < 0 || rate >= 1) return null;

  return round2((total + net) / (1 - rate));
}

/* This file is the single source of the money model. The server requires it,
 * and web/js/calc.js is a byte-identical copy the browser loads as a plain
 * script, so the editor's live totals cannot disagree with what the server
 * computes and stores. test/test-calc.js fails if the two copies drift. */
if (typeof module === 'object' && module.exports) {
  module.exports = {
    computeTotals,
    round2,
    gstTreatment,
    annualisedCost,
    annualOverheadTotal,
    overheadRatePerHour,
    minimumJobPrice,
    targetAnnualRevenue,
    FREQUENCY_MULTIPLIERS,
    WEEKS_PER_YEAR,
  };
} else {
  globalThis.LSCCalc = {
    computeTotals,
    round2,
    gstTreatment,
    annualisedCost,
    annualOverheadTotal,
    overheadRatePerHour,
    minimumJobPrice,
    targetAnnualRevenue,
    FREQUENCY_MULTIPLIERS,
    WEEKS_PER_YEAR,
  };
}
