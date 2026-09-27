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
 *   2. CAPACITY IS FOUR REAL FIELDS, NOT AN ASSUMED 48-WEEK YEAR.
 *      SUPERSEDED 2026-09-27 (.design/price-calculator/). This used to read
 *      "billable capacity annualises at 48 weeks, not 52 (WEEKS_PER_YEAR)":
 *      hours were entered per week and multiplied by an assumed 48, on the
 *      grounds that roughly four weeks of the year bill nothing.
 *
 *      That constant is retired. Annual billable hours are now derived from
 *      what the user actually works — annualBillableHours() below — because an
 *      assumed four weeks of downtime is a guess sitting underneath every rate
 *      on the card, and the two halves of it (leave, and sick/miscellaneous
 *      days) cannot be recovered from a single weekly figure.
 *
 *      THIS RAISED EVERY OVERHEAD-DERIVED RATE, KNOWINGLY. On the reference
 *      defaults (8 billable hrs/day, 5 working days/week, 30 leave days, 8 sick
 *      days) the year is 1,776 billable hours against the old model's 1,920, so
 *      the recovery rate rises about 8%. The user accepted that when the model
 *      was chosen: the old figure was flattering the rate, not protecting it.
 *
 *      Costs are untouched by any of this — a weekly expense is owed all 52
 *      weeks, which is why FREQUENCY_MULTIPLIERS.weekly is 52 while capacity
 *      counts working days. Decided with the user on 2026-09-15, replaced with
 *      their agreement on 2026-09-27.
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
 * HOURS AND QUANTITY ARE NOT THE SAME THING (hoursPerUnit)
 * Added 2026-09-27 for the price calculator (.design/price-calculator/). The
 * rate card now carries day-unit labour rows — `Video Capture — Full Day`,
 * `— Half Day` — alongside the hourly ones. A quantity of 2 on a full-day row
 * is two shoot days, which is roughly twenty billable hours, not two.
 *
 * `totalHours` used to be a plain sum of quantities, which was correct only
 * because every labour row on the card happened to be priced by the hour. It is
 * now `Σ qty × hoursPerUnit`, where a row's `hoursPerUnit` is how many billable
 * hours one unit of it consumes.
 *
 * This matters because `totalHours` is not a display figure. `minimumJobPrice`
 * allocates overhead across it, so a two-day shoot left on the old arithmetic
 * would carry 2 hours of overhead instead of ~20 and the advisory floor would
 * come back low by hundreds of dollars — silently, with no error and no zero to
 * notice. That is why this landed in the same change as the day-unit rows rather
 * than after them.
 *
 * `hoursPerUnit` DEFAULTS TO 1, AND ANYTHING UNUSABLE FALLS BACK TO 1
 * (hoursPerUnitOf below). The default is the whole safety argument: every row
 * already on the card and every estimate already saved is an hourly row with no
 * `hoursPerUnit`, and must total identically after this change. The fallback
 * direction is deliberate too — a missing, zero, negative or non-numeric value
 * reads as "one hour per unit", never as zero. Zero would drop the job's hours
 * out of the overhead allocation entirely, which is the expensive direction to
 * be wrong in: the floor would read as a computed answer while quietly pricing
 * a shoot as though it took no time at all.
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
 * How many billable hours one unit of a labour row consumes.
 *
 * Self-contained rather than reusing numOrNull() below, because the answer here
 * is never null: an unusable value resolves to 1, for the reasons in "Hours and
 * quantity are not the same thing" in the header. Exported so the Rate Card's
 * day-rate prefill and the Dashboard's full-day floor use this same fallback
 * instead of each re-deciding what a blank cell means.
 *
 * @param {object} def — a rate-card labour row, which may predate hoursPerUnit.
 * @returns {number} a positive number of hours; 1 when the row does not say.
 */
function hoursPerUnitOf(def) {
  const h = parseFloat(def && def.hoursPerUnit);
  return Number.isFinite(h) && h > 0 ? h : 1;
}

/**
 * @param {object} activeRows  { deliverables, preprod, prod, post, travel, crew, equip }
 *   — the rows saved on the estimate. Labour rows carry { name, qty, override },
 *   travel rows { name, qty }, crew/equip rows { days, cost }.
 * @param {object} pricing     the rate card: { labourSections, travelRows, taxSetAsideRate }
 *   — a labour row def carries { name, mu, rate } and optionally hoursPerUnit
 *   (absent on every hourly row; see the header).
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
  //
  // Hours are counted separately from quantity, because a day-unit row's
  // quantity is in days: totalHours is Σ qty × hoursPerUnit, and it feeds the
  // overhead allocation in minimumJobPrice rather than the client's price.
  let labourTotal = 0;
  let totalHours = 0;

  for (const section of labourSections) {
    const saved = rows[section.id] || [];
    for (const line of saved) {
      const def = (section.rows || []).find((r) => r.name === line.name);
      if (!def) continue; // rate removed from the card since this was saved
      const qty = num(line.qty);
      totalHours += qty * hoursPerUnitOf(def);
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
    /* Billable hours, not line quantities — see the header. Overhead is
       allocated across this, so a day row contributes its whole day. */
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

/** Weeks in a calendar year. Not the retired WEEKS_PER_YEAR — see above. */
const WEEKS_IN_YEAR = 52;

/**
 * How many hours the year can actually be billed for.
 *
 *   ((workingDaysPerWeek × 52) − leaveDays − sickDays) × billableHoursPerDay
 *
 * This is the divisor behind every overhead-derived rate on the card, and it
 * replaced an assumed 48-week year — see decision 2 in the header for why, and
 * for the ~8% rise that came with it.
 *
 * LEAVE AND SICK DAYS ARE COUNTED IN WORKING DAYS, NOT CALENDAR DAYS. Four
 * weeks off is 20, not 28. Nothing here can tell the difference, so the entry
 * labels carry the burden; getting it wrong overstates capacity by eight days
 * and under-recovers overhead all year. The 52 is deliberate and is not the
 * retired constant coming back: weeks in a year is a fact, and the leave that
 * used to be assumed inside it is now entered.
 *
 * THE LEGACY WEEKLY COLUMN IS NOT AN INPUT. goals.billableCapacityHrsPerWeek
 * is display-only since migration v5 (recomputed on save as this ÷ 52). Until
 * the Capacity screen shipped, a transitional annualBillableHoursFromGoals()
 * fell back to it × the retired 48 when the four fields were absent; that
 * branch was deleted with the screen's arrival on 2026-09-27, because every
 * goals row has carried the four fields since v5 and a fallback left in place
 * would let a half-migrated row price silently against the old assumption. A
 * goals payload is passed straight in — its four fields have these names.
 *
 * @param {object} capacity — { billableHoursPerDay, workingDaysPerWeek,
 *   leaveDaysPerYear, sickDaysPerYear }, all four required. The /api/goals
 *   payload qualifies as it is.
 * @returns {number|null} null when any field is missing or out of range, and
 *   when leave + sick consume the whole working year. A zero or negative
 *   capacity is not a smaller number, it is a broken one: every rate derived
 *   from it would be zero, infinite or negative, and each of those renders as a
 *   plausible-looking figure. Null is the signal every screen already turns into
 *   an em dash and a set-up prompt.
 */
function annualBillableHours(capacity) {
  const c = capacity || {};

  const hoursPerDay = numOrNull(c.billableHoursPerDay);
  if (hoursPerDay === null || hoursPerDay <= 0 || hoursPerDay > 24) return null;

  const daysPerWeek = numOrNull(c.workingDaysPerWeek);
  if (daysPerWeek === null || daysPerWeek <= 0 || daysPerWeek > 7) return null;

  const leave = numOrNull(c.leaveDaysPerYear);
  if (leave === null || leave < 0) return null;

  const sick = numOrNull(c.sickDaysPerYear);
  if (sick === null || sick < 0) return null;

  const workingDaysPerYear = daysPerWeek * WEEKS_IN_YEAR;
  /* Not `> workingDaysPerYear`: at exactly equal the answer is zero billable
     hours, which divides into an infinite rate. Both are the same empty state. */
  if (leave + sick >= workingDaysPerYear) return null;

  return round2((workingDaysPerYear - leave - sick) * hoursPerDay);
}

/**
 * The cost basis: what a single billable hour must earn, before any profit, to
 * carry its share of running the business. Annual overhead ÷ annual billable
 * hours.
 *
 * THE SECOND PARAMETER IS ANNUAL HOURS, NOT WEEKLY HOURS. It was weekly until
 * 2026-09-27, and this function multiplied it by an assumed 48-week year
 * itself. It no longer multiplies by anything: the caller passes the finished
 * annual figure, from annualBillableHours().
 *
 * That change is silent and expensive in both directions, which is why it is
 * stated here and pinned by a test rather than left to the parameter name. A
 * weekly figure passed by mistake divides $24,000 by 20 and puts $1,200/hr on
 * the rate card; an annual figure passed to the old signature divided by 46,080
 * and put $0.52 there. Neither errors, and both look like answers.
 *
 * @param {number} annualTotal — from annualOverheadTotal() (or, once the
 *   price-calculator work lands, annualBusinessCost(), which adds the gear
 *   replacement reserve).
 * @param {number} annualBillableHrs — ANNUAL billable hours, from
 *   annualBillableHours(). Not goals.billable_capacity_hrs_per_week.
 * @returns {number|null} null when the rate cannot be computed: no billable
 *   capacity set, or no overhead recorded. Null rather than 0, Infinity or NaN,
 *   because every screen that renders this shows an em dash for null, and a
 *   rate card reading "$0.00" looks like a computed answer meaning "an hour of
 *   your time costs nothing" instead of "you have not set this up yet". A zero
 *   overhead total is treated as that same empty state — a business with
 *   genuinely no costs is not a case worth mispricing every other one for.
 */
function overheadRatePerHour(annualTotal, annualBillableHrs) {
  const total = numOrNull(annualTotal);
  if (total === null || total <= 0) return null;

  const hours = numOrNull(annualBillableHrs);
  if (hours === null || hours <= 0) return null;

  return round2(total / hours);
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
 * @param {number} estimatedHours — totalHours from computeTotals, which is
 *   Σ qty × hoursPerUnit and not a sum of quantities. This function is the
 *   reason that distinction exists: it is the only place the job's hours turn
 *   into money, so a day row counted as one hour under-allocates overhead here
 *   and nowhere else. See the header.
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
 * Where a job's totalHours came from, for the sentence that explains the floor.
 *
 * The estimate editor's Minimum Job Price note says "across N hours", and once
 * a job has day rows N is no longer something a reader can check against the
 * quantities on screen: two shoot days read as "2" in the table and "16" in the
 * note. This splits N back into its parts — so many full days at so many hours,
 * so many hours of hourly work — so the note can show its working.
 *
 * It walks the labour rows exactly as computeTotals does (same lookup, same
 * skipped rows, same hoursPerUnitOf), and a test pins `totalHours` here equal to
 * computeTotals' own, so the explanation cannot drift from the number it
 * explains. Display only: nothing prices off it.
 *
 * A row is a "unit" row when it carries a dayUnit or hours other than one; every
 * other row is hourly. Unit rows are grouped by (dayUnit, hoursPerUnit), so two
 * full-day rows of the same length read as one "3 full days at 8 hrs".
 *
 * @param {object} activeRows — as computeTotals takes it.
 * @param {object} pricing — as computeTotals takes it.
 * @returns {{ units: Array<{ dayUnit: string|null, hoursPerUnit: number,
 *   qty: number, hours: number }>, hourlyHours: number, totalHours: number }}
 *   units ordered full days, half days, then any other unit by length; groups
 *   whose quantity sums to zero are left out.
 */
function labourHoursBreakdown(activeRows, pricing) {
  const rows = activeRows || {};
  const labourSections = (pricing && pricing.labourSections) || [];
  const groups = new Map();
  let hourlyHours = 0;
  let totalHours = 0;

  for (const section of labourSections) {
    for (const line of rows[section.id] || []) {
      const def = (section.rows || []).find((r) => r.name === line.name);
      if (!def) continue; // same rule as computeTotals
      const qty = num(line.qty);
      const perUnit = hoursPerUnitOf(def);
      totalHours += qty * perUnit;

      const dayUnit = def.dayUnit === 'full' || def.dayUnit === 'half' ? def.dayUnit : null;
      if (!dayUnit && perUnit === 1) {
        hourlyHours += qty;
        continue;
      }
      const key = (dayUnit || '') + '|' + perUnit;
      const group = groups.get(key) || { dayUnit, hoursPerUnit: perUnit, qty: 0 };
      group.qty += qty;
      groups.set(key, group);
    }
  }

  const rank = (g) => (g.dayUnit === 'full' ? 0 : g.dayUnit === 'half' ? 1 : 2);
  const units = [...groups.values()]
    .filter((g) => g.qty !== 0)
    .sort((a, b) => rank(a) - rank(b) || b.hoursPerUnit - a.hoursPerUnit)
    .map((g) => ({ ...g, qty: round2(g.qty), hours: round2(g.qty * g.hoursPerUnit) }));

  return { units, hourlyHours: round2(hourlyHours), totalHours: round2(totalHours) };
}

/* ── The cost of the business, and the financial year ────────────────────────
   Added 2026-09-27 for .design/price-calculator/. Two things live here: the
   gear replacement reserve that joins operating costs to form the real annual
   cost of the business, and the Australian financial year helper everything
   dated depends on. */

/**
 * Reads a field that may arrive in either of two shapes.
 *
 * THE TRAP THIS EXISTS FOR. Routes map database rows to camelCase for the
 * browser (`created_at` → `createdAt`, see routes/overhead.js's loadItem), but
 * server-side callers hand raw snake_case rows straight to this file —
 * writeSnapshot() already does exactly that with annualisedCost(). Every
 * function above got away with it because `cost`, `frequency` and `qty` are one
 * word in both shapes. `replacement_cost_estimate` is not.
 *
 * Without this, a raw row passed to replacementReserveTotal() would read every
 * field as undefined and return 0 — the replacement reserve would silently
 * vanish out of the overhead rate and every job would be under-priced, with no
 * error and no zero on screen to notice. Accepting both shapes is the cheap
 * fix; requiring callers to remember which one is the footgun.
 */
function field(obj, camel, snake) {
  if (!obj) return undefined;
  return obj[camel] !== undefined ? obj[camel] : obj[snake];
}

/** True when an asset has been sold or written off, in either field shape. */
function isDisposed(asset) {
  const date = field(asset, 'disposalDate', 'disposal_date');
  return date !== null && date !== undefined && date !== '';
}

/**
 * The business-use share of an asset, as a multiplier.
 *
 * business_use_pct IS STORED AS A PERCENT, 0–100 — see migration v5's comments,
 * which chose that to match goals.target_profit_margin_pct rather than inventing
 * a fraction column. So this divides by 100, and nothing else in the depreciation
 * work should divide again. A fraction/percent mix-up here is a silent 100×
 * error, which is the units trap this file's header opens with.
 *
 * A missing value reads as 100% — matching the column's own DEFAULT, and erring
 * the way the rest of this file errs: towards keeping a cost in, never towards
 * silently dropping one.
 */
function businessUseShare(asset) {
  const pct = numOrNull(field(asset, 'businessUsePct', 'business_use_pct'));
  if (pct === null || pct < 0) return 1;
  return Math.min(pct, 100) / 100;
}

/**
 * What the business should be setting aside each year to replace its gear.
 *
 *   Σ over assets still held: (replacementCostEstimate ÷ replacementCycleYears)
 *                             × businessUseShare
 *
 * Three decisions, none of them derivable from the arithmetic, all from the IA
 * doc:
 *
 *   1. REPLACEMENT COST, NOT HISTORICAL COST. Pricing has to recover what the
 *      NEXT body costs, not what the last one did. This is the single reason
 *      this function is not just the depreciation figure reused.
 *
 *   2. STRAIGHT-LINE OVER THE USER'S OWN CYCLE, NOT THE ATO EFFECTIVE LIFE.
 *      Diminishing value would swing the day rate 30–40% year to year for gear
 *      still in daily use, which is useless for setting a price. The ATO
 *      calculation still exists — it is the separate chain feeding the
 *      accountant's schedule — and the two numbers are meant to differ. That
 *      difference is what the Depreciation tab's info button explains.
 *
 *   3. APPORTIONED BY BUSINESS USE. Only the business share of a part-personal
 *      laptop is a business cost to recover.
 *
 * A DISPOSED ASSET CONTRIBUTES NOTHING, from the moment it is marked disposed.
 * Sold gear must stop inflating overhead immediately. It stays on its disposal
 * year's tax schedule for the balancing adjustment — that is the other chain,
 * and the two deliberately disagree about a sold camera.
 *
 * @param {Array<object>} assets — depreciation_assets rows, either field shape.
 * @returns {number} the annual reserve at cent precision; 0 for no assets. Zero
 *   rather than null: unlike a missing overhead rate, "no gear recorded" is a
 *   complete answer that adds nothing to the annual cost, and it must be safe to
 *   add to annualOverheadTotal without null-checking every term.
 */
function replacementReserveTotal(assets) {
  if (!Array.isArray(assets)) return 0;

  let total = 0;
  for (const asset of assets) {
    if (isDisposed(asset)) continue;

    const cost = numOrNull(field(asset, 'replacementCostEstimate', 'replacement_cost_estimate'));
    const years = numOrNull(field(asset, 'replacementCycleYears', 'replacement_cycle_years'));

    /* Both are nullable columns: an asset can be entered for tax purposes
       without a replacement plan. Such a row contributes nothing rather than
       being guessed at, and a cycle of zero is treated the same way instead of
       dividing into infinity. */
    if (cost === null || cost <= 0) continue;
    if (years === null || years <= 0) continue;

    total += (cost / years) * businessUseShare(asset);
  }

  return round2(total);
}

/**
 * The real annual cost of running the business: what it pays out, plus what it
 * should be putting aside to replace the gear it earns with.
 *
 * This is what the overhead rate should be divided from, and it replaces
 * annualOverheadTotal() at every screen. annualOverheadTotal KEEPS ITS NAME AND
 * BEHAVIOUR — it is still the operating-costs-only figure, it still has its own
 * tests, and the Dashboard needs it separately anyway.
 *
 * THE DASHBOARD MUST ALWAYS SHOW THE TWO TERMS SPLIT, never this total alone.
 * A camera entered as a one-off operating expense *and* as an asset is counted
 * twice here, inflating every rate, and nothing structural prevents it. The
 * visible Operating / Replacement-reserve split is half the mitigation (the
 * other half is the soft prompt on large one-off expenses). Collapsing it into
 * one figure removes the only way a doubled camera is noticeable.
 */
function annualBusinessCost(items, assets) {
  return round2(annualOverheadTotal(items) + replacementReserveTotal(assets));
}

/* ── The Australian financial year ───────────────────────────────────────────
   1 July – 30 June. Every dated figure in the depreciation work is bucketed by
   it, so it is one helper and nothing computes a year inline: reaching for
   new Date().getFullYear() is wrong for half the year, by up to twelve months.

   TWO STRING FORMS, ON PURPOSE. The canonical form is `FY2025-26` — no space,
   plain hyphen — and that is what is stored in depreciation_locks.fy_label,
   passed as the ?fy= query parameter and put in the CSV filename, because it is
   URL-safe and compares as a plain string. `FY 2025–26`, with the en dash the
   IA doc specifies, is for DISPLAY ONLY, via fyDisplay(). Keeping one canonical
   token and rendering the other is what stops an en dash from a copied label
   failing an equality check against a stored one. fyBounds() parses either,
   being the boundary where untrusted input arrives. */

/** Australian FY starts 1 July. Month index 6 = July. */
const FY_START_MONTH_INDEX = 6;

/**
 * The calendar year an FY starts in, for a date.
 *
 * TIMEZONES ARE THE TRAP HERE, NOT THE ARITHMETIC. A 'YYYY-MM-DD' column value
 * is parsed TEXTUALLY, never through Date: `new Date('2026-06-30')` is UTC
 * midnight, and read back with local getters west of Greenwich that is 29 June —
 * which lands the asset in the wrong financial year and moves a deduction
 * between tax returns. A real Date is read with its LOCAL fields, because a
 * Date means "now" and the user's today is their local calendar day.
 */
function fyStartYear(date) {
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
    if (!m) return null;
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return null;
    return monthIndex >= FY_START_MONTH_INDEX ? year : year - 1;
  }

  const d = date instanceof Date ? date : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.getMonth() >= FY_START_MONTH_INDEX ? d.getFullYear() : d.getFullYear() - 1;
}

/** `FY2025-26` from the calendar year the FY starts in. */
function fyTokenFor(startYear) {
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `FY${startYear}-${endShort}`;
}

/**
 * The canonical FY token for a date: a 'YYYY-MM-DD' string or a Date.
 * @returns {string|null} e.g. 'FY2025-26', or null for an unparseable date.
 */
function fyLabel(date) {
  const startYear = fyStartYear(date);
  return startYear === null ? null : fyTokenFor(startYear);
}

/**
 * The FY containing a moment — today, unless one is passed.
 * @param {Date|string} [now] — injectable so tests can pin the boundary rather
 *   than being unrunnable in June.
 */
function currentFinancialYear(now) {
  return fyLabel(now === undefined ? new Date() : now);
}

/**
 * The inclusive date range of an FY, as 'YYYY-MM-DD' strings.
 *
 * Strings rather than Dates so callers compare against date columns directly —
 * 'YYYY-MM-DD' sorts and compares correctly as text, which sidesteps the
 * timezone question entirely.
 *
 * Tolerant of every form the label appears in, because this is where a query
 * parameter or a stored value arrives: 'FY2025-26', 'FY 2025–26' (en dash),
 * 'FY2025-2026' and a bare '2025-26' all resolve. A four-digit year on its own
 * is rejected — '2025' cannot say whether it means FY2024-25 or FY2025-26, and
 * guessing would put a deduction in the wrong return.
 *
 * @returns {{start:string, end:string, startYear:number, label:string}|null}
 */
function fyBounds(label) {
  if (typeof label !== 'string') return null;

  const m = /^\s*(?:FY)?\s*(\d{4})\s*[-–—]\s*(\d{2}|\d{4})\s*$/i.exec(label);
  if (!m) return null;

  const startYear = Number(m[1]);
  const endGiven = m[2];
  const expectedEnd = startYear + 1;

  /* The second half must actually be the following year. A label saying
     'FY2025-27' is a typo, not a two-year financial year, and silently trusting
     the first half would file against a year the user did not name. */
  const endYear = endGiven.length === 4
    ? Number(endGiven)
    : Math.floor(expectedEnd / 100) * 100 + Number(endGiven);
  if (endYear !== expectedEnd) return null;

  return {
    start: `${startYear}-07-01`,
    end: `${expectedEnd}-06-30`,
    startYear,
    label: fyTokenFor(startYear),
  };
}

/**
 * The display form: `FY 2025–26`, with the en dash the IA doc specifies.
 * Rendering only — never stored, never compared, never put in a URL.
 */
function fyDisplay(label) {
  const bounds = fyBounds(label);
  if (!bounds) return null;
  return `FY ${bounds.startYear}–${String((bounds.startYear + 1) % 100).padStart(2, '0')}`;
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

/* ── Floors, and the rate card measured against them ──────────────────────────
   Added 2026-09-27 for the Finance & Price Dashboard. The Rate Card will show
   the same per-row comparison, so it lives here rather than in either screen:
   two screens computing "is this row below its floor?" separately is how they
   come to disagree about a row. */

/**
 * The least an hour of work can be sold for: its share of the business's
 * running cost, plus the target margin.
 *
 *   overheadRatePerHour × (1 + profitMarginPct ÷ 100)
 *
 * Deliberately the same arithmetic minimumJobPrice() applies to a job's hours
 * — minimumJobPrice(0, h, rate, margin) is exactly h × this — so the Dashboard's
 * floors and the estimate editor's Minimum Job Price cannot disagree about what
 * an hour is worth. A test pins that equivalence.
 *
 * @param {number} overheadRate — from overheadRatePerHour().
 * @param {number} profitMarginPct — a PERCENT (25 is 25%). See UNITS above.
 * @returns {number|null} null when there is no overhead rate, or no margin set.
 *   A 0% margin is a real answer (break even) and passes through; a missing one
 *   does not, because a floor that silently left the margin out would read as
 *   the real minimum.
 */
function hourlyFloor(overheadRate, profitMarginPct) {
  const rate = numOrNull(overheadRate);
  if (rate === null || rate <= 0) return null;
  const margin = numOrNull(profitMarginPct);
  if (margin === null || margin < 0) return null;
  return round2(rate * (1 + margin / 100));
}

/**
 * A rate-card price with any GST taken out.
 *
 * Floors are GST-exclusive — GST collected belongs to the ATO, not the
 * business — but a rate card kept GST-inclusive (settings.gst.pricesIncludeGst
 * while registered) stores `mu` with GST inside it. Comparing that raw against
 * a floor would flatter every row by the GST rate. Same rule computeTotals
 * applies to `billed`, applied to one price.
 */
function priceExGst(price, settings) {
  const gstCfg = (settings && settings.gst) || {};
  const p = num(price);
  if (gstCfg.registered === true && gstCfg.pricesIncludeGst === true) {
    return round2(p / (1 + num(gstCfg.rate)));
  }
  return round2(p);
}

/**
 * Every labour row on the rate card beside the floor for one unit of it.
 *
 * A row's floor is hourlyFloor × hoursPerUnitOf(row): an hourly row's floor is
 * the hourly floor, a day row's is that many hours of it. Compared against the
 * row's `mu` — what the client is charged — with GST taken out, never against
 * `rate`, which feeds no billing arithmetic anywhere (see computeTotals).
 *
 * LABOUR ROWS ONLY. Travel rows are excluded entirely, marked-up or not: crew,
 * hire, travel, flights and accommodation are added to a job at cost on top of
 * the labour, and are not what carries the overhead. That is the brief's
 * decision 6, and the Dashboard copy says so.
 *
 * @returns {Array<object>} one entry per labour row, in rate-card order:
 *   { sectionId, sectionLabel, name, mu, muExGst, hoursPerUnit, floor, gap,
 *     belowFloor }. When there is no hourly floor, floor/gap/belowFloor are
 *   null — "can't tell yet", which is not the same as "fine".
 */
function labourFloorComparison(pricing, settings, floorPerHour) {
  const perHour = numOrNull(floorPerHour);
  const sections = (pricing && pricing.labourSections) || [];
  const out = [];

  for (const section of sections) {
    for (const def of section.rows || []) {
      const hoursPerUnit = hoursPerUnitOf(def);
      const muExGst = priceExGst(def.mu, settings);
      const floor = perHour === null || perHour <= 0 ? null : round2(perHour * hoursPerUnit);
      /* Compared in cents after rounding both, so a row priced exactly at its
         floor is not badged by float noise. */
      const belowFloor = floor === null ? null : muExGst < floor;
      out.push({
        sectionId: section.id,
        sectionLabel: section.label,
        name: def.name,
        mu: num(def.mu),
        muExGst,
        hoursPerUnit,
        floor,
        gap: belowFloor ? round2(floor - muExGst) : belowFloor === null ? null : 0,
        belowFloor,
      });
    }
  }
  return out;
}

/** Statuses that mean the work was won. Draft and sent are still quotes. */
const WON_STATUSES = ['approved', 'invoiced', 'paid'];

/**
 * The same calendar date one year earlier, as 'YYYY-MM-DD', computed as text.
 * Not through Date — fyStartYear() above explains why a date-only string must
 * never be read back with local getters. 29 February steps back to the 28th.
 */
function oneYearBefore(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const year = Number(m[1]) - 1;
  const day = m[2] === '02' && m[3] === '29' ? '28' : m[3];
  return String(year) + '-' + m[2] + '-' + day;
}

/**
 * The average value of a job actually won in the last twelve months — the
 * divisor for "jobs needed per year".
 *
 * Counts an estimate when its status is approved, invoiced or paid (a draft or
 * a sent quote is not a job), its date falls after the same date a year ago
 * (future-dated bookings count: they are won work), and its ex-GST client price
 * is above zero. The price is `totals.clientPriceExGst` as stored at save time —
 * what the job was actually quoted at, not a re-pricing against today's card.
 *
 * @param {Array<object>} estimates — the /api/estimates payload.
 * @param {string} today — 'YYYY-MM-DD', the local date (LSCUtil.today()).
 * @returns {{average:number, count:number}|null} null when no job qualifies:
 *   dividing a revenue target by no history is not a number of jobs.
 */
function averageJobValue(estimates, today) {
  const cutoff = oneYearBefore(today);
  if (cutoff === null || !Array.isArray(estimates)) return null;

  let total = 0;
  let count = 0;
  for (const e of estimates) {
    if (!e || WON_STATUSES.indexOf(e.status) === -1) continue;
    const date = String(e.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= cutoff) continue;
    const price = numOrNull(e.totals && e.totals.clientPriceExGst);
    if (price === null || price <= 0) continue;
    total += price;
    count += 1;
  }
  if (!count) return null;
  return { average: round2(total / count), count };
}

/**
 * How many jobs of the recent average size it takes to reach the revenue
 * target. Rounded UP: 11.2 jobs is twelve jobs, and rounding down would report
 * a target reached one job early.
 *
 * @returns {number|null} null when either input is missing or not positive.
 */
function jobsNeededPerYear(annualRevenueTarget, averageJob) {
  const target = numOrNull(annualRevenueTarget);
  const avg = numOrNull(averageJob);
  if (target === null || target <= 0 || avg === null || avg <= 0) return null;
  return Math.ceil(round2(target / avg));
}

/**
 * The Dashboard's post-ratio readout: at N shoot days a month, with R edit
 * days of post behind each, how much of a month's billable capacity is used,
 * and how much is left to sell.
 *
 * A REALITY CHECK, NOT A CAP (brief decision 9). Hours are one pool — post
 * hours are billable hours — and the post-to-shoot ratio is the most variable
 * number in the business (≈1 edit day for a corporate interview, ≈3 for a
 * wedding). So both inputs are what-ifs the user types on the Dashboard; they
 * are never stored and nothing prices against them. Over-subscription is an
 * answer (negative unsoldHours), not an error: it's the thing the readout
 * exists to show.
 *
 * A DAY IS CAPACITY'S DAY. Shoot days and edit days are each
 * billableHoursPerDay long — the same standard day the Dashboard's headline
 * floors use — not a Full Day row's hoursPerUnit: a card can have several day
 * rows at different lengths, and an edit day has no row at all. A month is
 * annual billable hours ÷ 12, an average, as the targets panel labels it.
 *
 * @param {object} capacity — the goals payload (the four Capacity fields).
 * @param {number} shootDaysPerMonth — 0 or more.
 * @param {number} editDaysPerShootDay — 0 or more; 0 means no post.
 * @returns {{monthlyHours:number, dayHours:number, shootHours:number,
 *   postHours:number, unsoldHours:number, maxShootDays:number}|null}
 *   null when capacity can't be computed or either input is missing or
 *   negative. unsoldHours is negative when the month is over-subscribed.
 *   maxShootDays — how many shoot days a month fit at this ratio — is floored
 *   to one decimal, so the ceiling never promises a fraction of a day that
 *   doesn't fit.
 */
function postRatioReadout(capacity, shootDaysPerMonth, editDaysPerShootDay) {
  const annual = annualBillableHours(capacity);
  if (annual === null) return null;
  // annualBillableHours() has already range-checked this field.
  const dayHours = numOrNull((capacity || {}).billableHoursPerDay);

  const shootDays = numOrNull(shootDaysPerMonth);
  const ratio = numOrNull(editDaysPerShootDay);
  if (shootDays === null || shootDays < 0 || ratio === null || ratio < 0) return null;

  const monthlyHours = annual / 12;
  const shootHours = shootDays * dayHours;
  const postHours = shootDays * ratio * dayHours;
  return {
    monthlyHours: round2(monthlyHours),
    dayHours,
    shootHours: round2(shootHours),
    postHours: round2(postHours),
    unsoldHours: round2(monthlyHours - shootHours - postHours),
    /* Snapped at the ×10 scale before flooring, so float error can't turn an
       exact 6.8 into 67.999… tenths and report 6.7. */
    maxShootDays: Math.floor(round2((monthlyHours / ((1 + ratio) * dayHours)) * 10)) / 10,
  };
}

/* This file is the single source of the money model. The server requires it,
 * and web/js/calc.js is a byte-identical copy the browser loads as a plain
 * script, so the editor's live totals cannot disagree with what the server
 * computes and stores. test/test-calc.js fails if the two copies drift.
 *
 * THE ATO DEPRECIATION CHAIN LIVES IN ITS SIBLING, depreciation.js, under the
 * same two-copy rule. It was split out at 867 lines rather than pushing this
 * file past 1,300: the two answer different questions (what to charge, versus
 * what to tell the accountant) and are meant to produce different numbers for
 * the same camera. It depends on this file, not the other way round, and the
 * browser loads calc.js first.
 *
 * numOrNull, field and businessUseShare are exported for it. They are the
 * shared primitives, not general utilities — businessUseShare in particular
 * exists so that the percent-not-fraction rule from migration v5 is applied in
 * exactly one place. */
if (typeof module === 'object' && module.exports) {
  module.exports = {
    computeTotals,
    round2,
    numOrNull,
    field,
    businessUseShare,
    gstTreatment,
    hoursPerUnitOf,
    annualisedCost,
    annualOverheadTotal,
    replacementReserveTotal,
    annualBusinessCost,
    annualBillableHours,
    overheadRatePerHour,
    minimumJobPrice,
    labourHoursBreakdown,
    targetAnnualRevenue,
    hourlyFloor,
    priceExGst,
    labourFloorComparison,
    averageJobValue,
    jobsNeededPerYear,
    postRatioReadout,
    currentFinancialYear,
    fyLabel,
    fyBounds,
    fyDisplay,
    FREQUENCY_MULTIPLIERS,
  };
} else {
  globalThis.LSCCalc = {
    computeTotals,
    round2,
    numOrNull,
    field,
    businessUseShare,
    gstTreatment,
    hoursPerUnitOf,
    annualisedCost,
    annualOverheadTotal,
    replacementReserveTotal,
    annualBusinessCost,
    annualBillableHours,
    overheadRatePerHour,
    minimumJobPrice,
    labourHoursBreakdown,
    targetAnnualRevenue,
    hourlyFloor,
    priceExGst,
    labourFloorComparison,
    averageJobValue,
    jobsNeededPerYear,
    postRatioReadout,
    currentFinancialYear,
    fyLabel,
    fyBounds,
    fyDisplay,
    FREQUENCY_MULTIPLIERS,
  };
}
