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
 *   3. TAX IS LEVIED ON PROFIT, THROUGH THE ATO BRACKETS. SUPERSEDED
 *      2026-09-28 (money-math audit). This used to solve
 *      (overhead + desired net) / (1 − flat rate), which taxed deductible
 *      overhead and ignored the progressive scale — ~$14k too high on the
 *      reference figures. Now: the pay needed before tax is solved exactly
 *      through the user's own per-FY resident brackets plus Medicare levy
 *      (grossForNet), super and a bad-debt allowance are added, and business
 *      cost is added untaxed. Per job, taxSetAside is provisioned on the job's
 *      profit — its income less the overhead its hours carry — at the user's
 *      set-aside rate, which Profit Goals suggests from the same brackets.
 *
 *   1a. THE WAGE DECISION, REVISITED 2026-09-28. Decision 1 stands for
 *      minimumJobPrice and hourlyFloor, which remain COST floors. But the user
 *      chose, after the audit, to measure the rate card against an INCOME
 *      floor — Target Annual Revenue ÷ annual billable hours — which carries
 *      the owner's pay. See incomeFloorPerHour.
 *
 *   4. THE "MARGIN" IS A MARKUP. goals.target_profit_margin_pct has always
 *      been applied as cost × (1 + pct/100), which is a markup: 25% on cost is
 *      a 20% margin on price. Since 2026-09-28 the screens call it a markup;
 *      the column keeps its old name (renaming it is a table rebuild for no
 *      arithmetic change). Parameters here say markupPct.
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
 * UNITS — the one trap in here. `taxSetAsideRate` is a FRACTION (0.35 is 35%,
 * as the rate card stores it). `markupPct` is a PERCENT (25 is 25%, as
 * goals.target_profit_margin_pct stores it), and so are every other goals
 * percentage (superPct, badDebtPct) and every figure in a tax year (bracket
 * ratePct, medicareLevyPct). The parameter names carry the difference and
 * these functions do not guess: a markup passed as 0.25 is read as a quarter
 * of one percent, not as a quarter.
 *
 * SAVED LINES CARRY THEIR OWN PRICES (2026-09-28). A labour or travel line
 * saved on an estimate stores the price it was quoted at — mu, and for labour
 * hoursPerUnit/dayUnit, for travel rate/directCost/ownTime — plus the rate-card
 * row's id. computeTotals prices a line from those when present, and only
 * falls back to the live card (by row id, then by name) for a line saved
 * before this existed. Before, every save re-priced a quote against today's
 * card and a renamed service silently fell out of the total while the PDF
 * still listed it. See lineDef below.
 *
 * SERVICE UNITS (2026-09-28, .design/service-rate-tiers/). A labour service
 * carries three prices — `prices: { hour, half, full }` — instead of one `mu`,
 * and a card-level `serviceDay: { fullHours, halfHours }` (8 / 4) says how many
 * billable hours a day on a job is. That is deliberately NOT Capacity's
 * billable hours per day, which is a yearly planning average. Five decisions:
 *
 *   1. AUTO IS DERIVED ON READ, NEVER STORED. A price the user has not typed is
 *      `null` on the card, and unitDef computes it each time (decision 5 says
 *      from what). Storing it would freeze it at
 *      whatever the goals were on the day it was written, and "follows the
 *      numbers until you type over it" would need a second flag to remember
 *      which numbers were typed. This overturns price-calculator's "nothing
 *      auto-writes the rate card" knowingly. Quotes are still safe: a line
 *      added to an estimate snapshots the resolved price (lineSnapshot), so a
 *      goals change moves the card, never a saved quote.
 *
 *   2. `mu: null` MEANS "NO PRICE YET", NEVER $0. An auto unit with no income
 *      floor (tax scale unsaved, no capacity) or no markup cannot be priced.
 *      Reading that as 0 would put a free line on a quote and badge nothing,
 *      because $0 is below every floor only once there is a floor. Callers
 *      disable the unit or show "—". A typed 0, by contrast, is a real price.
 *
 *   3. UP TO THE WHOLE DOLLAR, AND NEVER BELOW THE TARGET. An auto HOURLY price
 *      is the smallest whole dollar whose GST-exclusive part reaches floor ×
 *      (1 + markup) EXACTLY. Up, because rounding down would sell the hour
 *      under the figure it was derived from; whole dollars, because that is
 *      how the card is priced by hand. Exactly, not cent-rounded, because an
 *      auto day is the hourly × its hours (decision 5): an hourly price 0.1¢
 *      under the true floor passes a cent-rounded check, but eight of them are
 *      1¢ under the day's floor, and the day is badged. Both a cent-rounded
 *      target and the brief's literal GST recipe (× 1.1, cent-round, ceil) did
 *      exactly that; sweeps over unrounded floors found it. Where the exact
 *      target gives a different price, it is $1 higher.
 *
 *   4. THE SERVER NEVER RESOLVES A FLOOR-DERIVED PRICE. It has no income floor
 *      to hand (that needs goals, overhead and capacity together), so lineDef's
 *      fallback for a line with no snapshot prices a unit only when it does not
 *      need the floor: a typed price, or an auto day on a service whose hourly
 *      price is typed (decision 5). Anything else is treated as a service gone
 *      from the card. That path is near-dead: migration v9 snapshots every
 *      legacy line before it reshapes the card. serviceFloorComparison, by
 *      contrast, runs in the browser and prices auto units from the same floor
 *      it compares them against, so an auto unit can never be badged below the
 *      floor it was derived from.
 *
 *   5. AN AUTO DAY IS THE HOURLY PRICE × THE DAY'S HOURS (the user's call,
 *      2026-09-28, reversing the brief's "each unit rounded on its own"). Only
 *      the hourly price comes from the floor. An auto half or full day is the
 *      service's hourly price — typed or auto — × serviceDay's hours, to the
 *      cent: type $140 an hour and the full day follows as $1,120 at 8 hrs. So
 *      an auto full day is exactly 8 × the rounded hourly, and costs up to 8 ×
 *      $1 more than rounding the day on its own would. It is still never below
 *      its floor: the hourly is at or above the hourly floor, and both scale
 *      by the same hours. A typed day price wins over all of this, which is how
 *      a half day stays its own figure rather than half a full day.
 *
 * YOUR TIME ON THE ROAD IS PRICED FROM THE FLOOR (2026-09-30,
 * .design/estimate-accuracy/ task 6a; the user's decisions). A travel row
 * ticked "Your time" (ownTime) is the owner's own hours, so it is priced like
 * a service's hour, with one difference:
 *
 *   - AT EXACTLY THE INCOME FLOOR, NO MARKUP. Travel hours cover running
 *     costs and pay but carry no profit. An own-time row whose `mu` is null is
 *     auto: suggestedPrice(floor, its hours, 0) — the floor rounded up to the
 *     whole dollar, GST-aware, as decision 3 above. A number is typed and wins.
 *   - EVERYTHING ELSE AS FOR SERVICES: `mu: null` is no price yet, never $0
 *     (decision 2); the server never resolves it (decision 4), so lineDef
 *     prices a bare line on an auto row at nothing; a line added to an
 *     estimate snapshots the resolved figure. travelRowDef is the one
 *     resolver, as unitDef is for services.
 *   - ONLY OWN-TIME ROWS JOIN THE FLOOR COMPARISON (travelFloorComparison).
 *     Resold and at-cost travel are passed through and recover no overhead,
 *     which is what price-calculator's decision 6 excluded; an own-time row
 *     isn't one of those.
 *
 * Only an own-time row that is not also Direct can be auto. A blank price on
 * any other travel row is not "auto" and not "no price": it reads as $0, which
 * is how every build has always priced one (nonNeg), and how the v9 migration
 * snapshotted one. PUT /api/pricing refuses a new one (travel_price_missing),
 * so it survives only in data from before.
 *
 * THE CAR IS BILLED PER KM, AT COST (2026-09-30, task 6b; the user's
 * decisions). A travel row flagged `perKm` is the car: its quantity is
 * kilometres and its price is goals.vehicle_cost_per_km, the car's full
 * running cost per km, entered once on Overhead — never typed on the card.
 *
 *   - AT COST. A km line is billed to the client and counted exactly as a
 *     Direct row is: pass-through, in directJobCost, not income, no tax set
 *     aside, no hours. It recovers what the car costs, with no profit on it.
 *   - GST-EXCLUSIVE, LIKE EVERY OVERHEAD COST. On a GST-inclusive card the
 *     billed price is the figure plus GST, so that computeTotals' exGst takes
 *     it back to exactly the figure (task 3); anywhere else it is the figure.
 *   - NOT OVERHEAD. The figure is on the goals row, not an overhead item, and
 *     no rate reads it: the car is recovered per km, not across every hour.
 *   - NO FIGURE, NO PRICE. Blank on Overhead is `mu: null` (decision 2 under
 *     SERVICE UNITS); the server, with no goals to hand, never resolves it, so
 *     a bare km line prices at nothing. A line added to an estimate snapshots
 *     the figure and the flag, so a later change on Overhead moves the card,
 *     never a saved quote.
 *
 * A `perKm` row is never also Your time or Direct (PUT /api/pricing refuses
 * that); if one ever were, `perKm` decides.
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

/* A quantity, day count or price, never below zero. A typed −3 used to price
   straight through into a negative invoice with negative GST; there is no
   negative line on a quote or an invoice, so it reads as nothing. */
function nonNeg(v) {
  return Math.max(0, num(v));
}

/** activeRows keys that are not labour categories (ratecard.js has the same list). */
const NON_LABOUR_KEYS = { travel: 1, equip: 1, crew: 1, deliverables: 1 };

/* Does a saved line carry its own price? `mu` is the marker: every line saved
   since 2026-09-28 has it, and no line saved before does. */
const hasSnapshot = (line) => Boolean(line) && line.mu !== undefined && line.mu !== null && line.mu !== '';

/**
 * The definition a saved line prices from: its own snapshot when it has one,
 * otherwise the live rate-card row with its id, otherwise the row with its
 * name (lines saved before rows had ids), otherwise null — a legacy line
 * whose service has since gone from the card, which prices at nothing, as it
 * always did.
 *
 * A row that carries `prices` (a service with hour / half / full prices) is
 * resolved at the line's unit — `line.dayUnit`, or an hour — through unitDef.
 *
 * @param {Array<object>} defs — the rate-card rows to fall back to.
 * @param {object} line — a saved line.
 * @param {object} [pricing] — the whole card, for its serviceDay; without it a
 *   day unit falls back to 8 / 4 hours (unitHours).
 */
function lineDef(defs, line, pricing) {
  if (!line) return null;
  if (hasSnapshot(line)) return line;
  const rows = defs || [];
  const row = (line.rowId && rows.find((r) => r.id === line.rowId)) || rows.find((r) => r.name === line.name) || null;
  if (!row) return null;
  if (!row.prices) {
    /* A travel row. Resolved without the income floor (decision 4 under
       SERVICE UNITS), an auto own-time row has no price, and prices at
       nothing, as a missing row does — never at $0 with its hours counted.
       Any other row is returned as it is, exactly as before task 6a. */
    return travelRowDef(row).mu === null ? null : row;
  }
  /* A service with three prices: the one for the line's own unit, resolved
     without the income floor (decision 4 under SERVICE UNITS). A unit that
     needs the floor has no price here, and prices at nothing, as a missing
     row does. */
  const def = unitDef(row, line.dayUnit === 'full' || line.dayUnit === 'half' ? line.dayUnit : 'hour', pricing);
  return def && def.mu !== null ? def : null;
}

/**
 * The price fields a line stores when it is added to an estimate, from its
 * rate-card row, plus the one flag that decides how it bills (customBill).
 * Labour and travel rows carry different fields; whichever the row has are
 * copied, and nothing else — not the name, which the line already has.
 */
function lineSnapshot(def) {
  const d = def || {};
  const out = { mu: nonNeg(d.mu) };
  if (d.id) out.rowId = d.id;
  if (d.hoursPerUnit !== undefined) out.hoursPerUnit = d.hoursPerUnit;
  if (d.dayUnit === 'full' || d.dayUnit === 'half') out.dayUnit = d.dayUnit;
  if (d.rate !== undefined) out.rate = nonNeg(d.rate);
  if (d.directCost) out.directCost = true;
  if (d.ownTime) out.ownTime = true;
  if (d.perKm) out.perKm = true;
  // Not a price, but how the line bills: whether it takes a custom amount.
  if (d.customBill) out.customBill = true;
  return out;
}

/**
 * How many billable hours one unit of a labour row consumes.
 *
 * Self-contained rather than reusing numOrNull() below, because the answer here
 * is never null: an unusable value resolves to 1, for the reasons in "Hours and
 * quantity are not the same thing" in the header. Exported so the estimate
 * screens and the v9 migration read a line's (or an old row's) hours with this
 * same fallback instead of each re-deciding what a blank cell means. A service
 * on today's card has no hoursPerUnit of its own: unitHours() gives its units'.
 *
 * @param {object} def — a line snapshot, or a pre-v9 rate-card labour row.
 * @returns {number} a positive number of hours; 1 when the row does not say.
 */
function hoursPerUnitOf(def) {
  const h = parseFloat(def && def.hoursPerUnit);
  return Number.isFinite(h) && h > 0 ? h : 1;
}

/**
 * The labour sections to walk for an estimate: the card's own, plus any
 * category the estimate has lines in that the card no longer does (a deleted
 * category). Lines there still price from their own snapshots; before
 * snapshots they were skipped with the category.
 */
function labourSectionsOf(rows, labourSections) {
  const out = labourSections.slice();
  const known = new Set(labourSections.map((s) => s.id));
  Object.keys(rows || {}).forEach((id) => {
    if (NON_LABOUR_KEYS[id] || known.has(id) || !Array.isArray(rows[id])) return;
    out.push({ id, rows: [] });
  });
  return out;
}

/**
 * @param {object} activeRows  { deliverables, preprod, prod, post, travel, crew, equip }
 *   — the rows saved on the estimate. Labour rows carry { name, qty, override },
 *   travel rows { name, qty }, crew/equip rows { days, cost }.
 * @param {object} pricing     the rate card: { labourSections, travelRows, taxSetAsideRate }
 *   — a labour row def carries { name, mu, rate } and optionally hoursPerUnit
 *   (absent on every hourly row; see the header).
 * @param {object} settings    { gst: { registered, rate, pricesIncludeGst } }
 * @param {object} [options]   { gstFree, overheadRate, days, surcharges,
 *   shortNotice } — the estimate's own tax treatment, the overhead rate per
 *   billable hour its tax set-aside deducts (optional; see Take-home), and its
 *   booked days with their surcharge snapshot (surchargeSnapshot) and the
 *   short-notice tick. A `prod` line whose `dayId` is one of `days` is priced
 *   through the surcharge maths; every other line, and every line of an
 *   estimate with no days, prices exactly as before (production-booking task 2).
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
  /* A figure as entered, less its GST. On a GST-inclusive card every figure
     typed in carries GST, costs included; everywhere else it is the identity. */
  const exGst = (v) => (pricesIncludeGst ? v / (1 + gstRate) : v);

  // ── Labour ──────────────────────────────────────────────────────────────
  // A row is billed at qty × marked-up rate, unless it carries an explicit
  // override (the "Raw Footage Handover [on HDD]" custom-bill case).
  //
  // Hours are counted separately from quantity, because a day-unit row's
  // quantity is in days: totalHours is Σ qty × hoursPerUnit, and it feeds the
  // overhead allocation in minimumJobPrice rather than the client's price.
  let labourTotal = 0;
  let totalHours = 0;
  /* What surcharges added to production lines. Income like the rest of
     labour: it is in labourTotal, it is taxed, and it adds no hours — a
     weekend day is the same day of work (D2's settled rules). */
  let surchargeTotal = 0;
  const dayCtx = surchargeContext(options);

  for (const section of labourSectionsOf(rows, labourSections)) {
    const saved = rows[section.id] || [];
    for (const line of saved) {
      const def = lineDef(section.rows, line, pricing);
      if (!def) continue; // a pre-snapshot line whose service has left the card
      const qty = nonNeg(line.qty);
      totalHours += qty * hoursPerUnitOf(def);
      const override = nonNeg(line.override);
      const base = override > 0 ? override : qty * nonNeg(def.mu);
      /* Only the section with id `prod` is on set (D24), whatever it is
         called; a dayId anywhere else prices nothing extra. */
      const price = section.id === 'prod' ? surchargedPriceOf(base, line, dayCtx, qty * hoursPerUnitOf(def)) : base;
      labourTotal += price;
      surchargeTotal += price - base;
    }
  }

  // ── Travel ──────────────────────────────────────────────────────────────
  // Three kinds of row (four since task 6b: perKm, the car, is below and is
  // at cost like directCost), and they differ in what the business keeps:
  //   directCost — fuel, flights, accommodation: the quantity IS the amount,
  //     billed at cost, passed straight through.
  //   ownTime — the owner's own hours billed as travel ("Transport & Logistics
  //     Hrs"): the whole bill is income, and its hours are billable hours that
  //     carry overhead like any labour hour.
  //   anything else — bought in and resold (crew meals): `rate` is what it
  //     costs, and only the markup above it is income.
  // Until 2026-09-28 none of travel counted as income, so a marked-up travel
  // row had no tax set aside against it and its hours carried no overhead.
  let travelTotal = 0;
  let travelPassThrough = 0;
  let travelCost = 0;
  let travelIncome = 0;

  for (const line of rows.travel || []) {
    const def = lineDef(travelDefs, line);
    if (!def) continue;
    const qty = nonNeg(line.qty);
    if (def.perKm) {
      // The car, per km (task 6b): billed at cost, a pass-through like Direct,
      // but priced by the kilometre rather than "the quantity is the amount".
      const bill = qty * nonNeg(def.mu);
      travelTotal += bill;
      travelPassThrough += bill;
      continue;
    }
    if (def.directCost) {
      travelTotal += qty;
      travelPassThrough += qty;
      continue;
    }
    const bill = qty * nonNeg(def.mu);
    travelTotal += bill;
    if (def.ownTime) {
      travelIncome += bill;
      totalHours += qty * hoursPerUnitOf(def);
    } else {
      const cost = qty * nonNeg(def.rate);
      travelCost += cost;
      travelIncome += bill - cost;
    }
  }

  // ── Crew and equipment ──────────────────────────────────────────────────
  // Always billed at cost: these are other people's invoices passing through.
  let crewTotal = 0;
  for (const line of rows.crew || []) crewTotal += nonNeg(line.days) * nonNeg(line.cost);

  let equipTotal = 0;
  for (const line of rows.equip || []) equipTotal += nonNeg(line.days) * nonNeg(line.cost);

  const expenseTotal = travelTotal + crewTotal + equipTotal;
  /* The two COST figures are ex-GST, like the client price they are measured
     against (2026-09-30, .design/estimate-accuracy/ task 3). expenseTotal is
     what the client is billed and stays as entered; these are what the
     business pays out, and a registered business claims the GST on them back.
     Before, on a GST-inclusive card, $1,100 of crew (really $1,000) went into
     Minimum Job Price and the Income floor line as $1,100, and the quote read
     $100 worse against both than it was. On any other card exGst changes
     nothing, and a GST-free estimate stays priced as unregistered (see the
     header), costs included. */
  const passThroughCost = exGst(crewTotal + equipTotal + travelPassThrough);
  /* What the job costs the business out of pocket: pass-throughs, plus what
     resold travel was bought for. minimumJobPrice's direct-cost term. */
  const directJobCost = exGst(crewTotal + equipTotal + travelPassThrough + travelCost);

  // ── GST ─────────────────────────────────────────────────────────────────
  // `billed` is the sum of every line as entered. Whether that figure already
  // contains GST depends on how the rate card is kept, so the split runs one of
  // two ways rather than assuming.
  //
  // THE THREE FIGURES ADD UP TO THE CENT. Two are rounded and the third is
  // derived from those rounded two, never rounded on its own: rounding all
  // three independently printed $3.65 + $0.37 = $4.01 on a tax invoice, about
  // once in every ninety prices (2026-09-28 audit).
  const billed = labourTotal + expenseTotal;

  let clientPriceExGst;
  let gst;
  let totalIncGst;

  if (!gstRegistered) {
    clientPriceExGst = round2(billed);
    gst = 0;
    totalIncGst = clientPriceExGst;
  } else if (pricesIncludeGst) {
    totalIncGst = round2(billed);
    clientPriceExGst = round2(totalIncGst / (1 + gstRate));
    gst = round2(totalIncGst - clientPriceExGst);
  } else {
    clientPriceExGst = round2(billed);
    gst = round2(clientPriceExGst * gstRate);
    totalIncGst = round2(clientPriceExGst + gst);
  }

  // ── Take-home ───────────────────────────────────────────────────────────
  // Income is labour plus travel income (see Travel above), ex-GST — GST
  // collected belongs to the ATO. Tax is provisioned on PROFIT: income less
  // the overhead this job's hours carry (options.overheadRate × totalHours),
  // because running costs are deductible. With no overhead rate known the
  // whole income is the base, which errs high, as the old model always did.
  const incomeExGst = exGst(labourTotal + travelIncome);
  const overheadRate = numOrNull(options && options.overheadRate);
  const overheadShare = overheadRate !== null && overheadRate > 0 ? totalHours * overheadRate : 0;
  const taxable = Math.max(0, incomeExGst - overheadShare);
  const rawRate = num(pricing && pricing.taxSetAsideRate);
  const taxSetAsideRate = rawRate > 0 && rawRate < 1 ? rawRate : 0;
  const taxSetAside = taxable * taxSetAsideRate;
  const estTakeHome = incomeExGst - overheadShare - taxSetAside;

  return {
    // What the client sees
    clientPriceExGst,
    gst,
    totalIncGst,

    // How it breaks down
    labourTotal: round2(labourTotal),
    /* Owner-only, like everything below the client figures: the client's
       copy never says "surcharge" (D8, D12). Never on a public route. */
    surchargeTotal: round2(surchargeTotal),
    expenseTotal: round2(expenseTotal),
    passThroughCost: round2(passThroughCost),
    directJobCost: round2(directJobCost),
    incomeExGst: round2(incomeExGst),
    overheadShare: round2(overheadShare),
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
 * costs, its share of overhead, and the target markup on that overhead.
 *
 *   directJobCost + estimatedHours × overheadRate × (1 + markupPct/100)
 *
 * THE MARKUP IS ON THE HOURS ONLY (2026-09-28 audit). It used to multiply the
 * direct costs too, so a job with $10,000 of crew billed at cost demanded
 * $2,500 of markup on money the Dashboard says is passed through — an $11,200
 * job read as under-priced against a $12,651 floor. Pass-throughs are billed
 * at cost and carry no markup; direct cost here is directJobCost from
 * computeTotals (pass-throughs plus what resold travel cost), not expenseTotal,
 * which includes travel's own markup.
 *
 * Advisory only. computeTotals never reads this, and the estimate editor's
 * toggle must never move clientPriceExGst or totalIncGst in either position.
 *
 * @param {number} directJobCosts — the job's own out-of-pocket costs, i.e.
 *   directJobCost from computeTotals.
 * @param {number} estimatedHours — totalHours from computeTotals, which is
 *   Σ qty × hoursPerUnit and not a sum of quantities. This function is the
 *   reason that distinction exists: it is the only place the job's hours turn
 *   into money, so a day row counted as one hour under-allocates overhead here
 *   and nowhere else. See the header.
 * @param {number} overheadRate — from overheadRatePerHour().
 * @param {number} markupPct — a PERCENT (25 is 25%), unlike taxSetAsideRate,
 *   which is a fraction. See UNITS in the header.
 * @returns {number|null} null when there is no overhead rate to allocate from,
 *   so the editor shows its set-up prompt rather than a floor that silently
 *   leaves overhead out and reads as if it were the real minimum.
 */
function minimumJobPrice(directJobCosts, estimatedHours, overheadRate, markupPct) {
  const rate = numOrNull(overheadRate);
  if (rate === null || rate <= 0) return null;

  /* A 0% markup is a real answer — "just break even on this one" — so it is
     allowed through where a missing one is not. */
  const markup = numOrNull(markupPct);
  if (markup === null || markup < 0) return null;

  return round2(nonNeg(directJobCosts) + nonNeg(estimatedHours) * rate * (1 + markup / 100));
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

  for (const section of labourSectionsOf(rows, labourSections)) {
    for (const line of rows[section.id] || []) {
      const def = lineDef(section.rows, line, pricing);
      if (!def) continue; // same rule as computeTotals
      const qty = nonNeg(line.qty);
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

  /* Own-time travel hours count in computeTotals' totalHours, so they are
     part of this total too, as hourly work — the test pins the two equal. */
  const travelDefs = (pricing && pricing.travelRows) || [];
  for (const line of rows.travel || []) {
    const def = lineDef(travelDefs, line);
    if (!def || def.perKm || def.directCost || !def.ownTime) continue;
    const h = nonNeg(line.qty) * hoursPerUnitOf(def);
    totalHours += h;
    hourlyHours += h;
  }

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
 *   Σ over assets still held:
 *     ((replacementCostEstimate − expectedResaleValue) ÷ replacementCycleYears)
 *     × businessUseShare
 *
 * NET OF RESALE (2026-09-28 audit). The old body is sold when the new one is
 * bought, so only the difference has to be saved up. expectedResaleValue is
 * optional — unset is 0, which is the old behaviour — and is clamped to the
 * replacement cost, so a resale guess above it reserves nothing rather than a
 * negative amount.
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

    const resale = Math.min(cost, nonNeg(field(asset, 'expectedResaleValue', 'expected_resale_value')));
    total += ((cost - resale) / years) * businessUseShare(asset);
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

/* ── Income tax, through the ATO resident scale ──────────────────────────────
   Added 2026-09-28 (money-math audit), replacing a flat rate on revenue. A tax
   year is the user's own record of one financial year's resident brackets and
   Medicare levy — stored per FY, entered and confirmed by the user, never
   built in, because both move with the federal budget:

     { fy: 'FY2026-27', brackets: [{ from: 0, ratePct: 0 }, { from: 18200,
       ratePct: 15 }, …], medicareLevyPct: 2 }

   `from` is the first dollar the rate applies to (a tax table's "$18,201 –"
   row is from: 18200); ratePct is a PERCENT. Not modelled, knowingly: the low
   income tax offset (gone by ~$66k), the Medicare levy's low-income reduction
   and the surcharge. At the incomes a revenue target is solved for, none of
   them moves the answer by more than rounding. */

/**
 * A tax year checked and put in order, or null when it can't be used: no
 * brackets, a rate or threshold that isn't a number, rates of 100% or more
 * (combined with the levy), or thresholds out of order. Everything downstream
 * reads null as "set up your tax year", never as a zero tax bill.
 */
function normaliseTaxYear(taxYear) {
  const ty = taxYear || {};
  const levy = numOrNull(ty.medicareLevyPct);
  if (levy === null || levy < 0 || levy >= 100) return null;
  if (!Array.isArray(ty.brackets) || ty.brackets.length === 0) return null;

  const brackets = [];
  for (const b of ty.brackets) {
    const from = numOrNull(b && b.from);
    const ratePct = numOrNull(b && b.ratePct);
    if (from === null || from < 0 || ratePct === null || ratePct < 0 || ratePct + levy >= 100) return null;
    brackets.push({ from, ratePct });
  }
  brackets.sort((a, b) => a.from - b.from);
  for (let i = 1; i < brackets.length; i += 1) {
    if (brackets[i].from === brackets[i - 1].from) return null;
  }
  // Income below the first threshold is untaxed by the brackets.
  if (brackets[0].from > 0) brackets.unshift({ from: 0, ratePct: 0 });
  return { fy: ty.fy || null, brackets, medicareLevyPct: levy };
}

/**
 * Income tax plus Medicare levy on a taxable income, under one tax year.
 * @returns {number|null} null for an unusable tax year; 0 for no income.
 */
function incomeTax(taxableIncome, taxYear) {
  const ty = normaliseTaxYear(taxYear);
  if (!ty) return null;
  const income = nonNeg(taxableIncome);
  let tax = 0;
  ty.brackets.forEach((b, i) => {
    const next = i + 1 < ty.brackets.length ? ty.brackets[i + 1].from : Infinity;
    if (income > b.from) tax += (Math.min(income, next) - b.from) * (b.ratePct / 100);
  });
  return round2(tax + income * (ty.medicareLevyPct / 100));
}

/**
 * The taxable income that leaves `net` after income tax and Medicare levy:
 * solves G − incomeTax(G) = net exactly, bracket by bracket. Within a bracket
 * the after-tax figure is a straight line in G, so each bracket is inverted in
 * closed form and the one whose range contains the answer wins — no iteration.
 *
 * @returns {number|null} null for an unusable tax year or a negative net.
 */
function grossForNet(net, taxYear) {
  const ty = normaliseTaxYear(taxYear);
  const n = numOrNull(net);
  if (!ty || n === null || n < 0) return null;
  if (n === 0) return 0;

  const levy = ty.medicareLevyPct / 100;
  let taxBelow = 0; // bracket tax on income up to the current bracket's start
  for (let i = 0; i < ty.brackets.length; i += 1) {
    const b = ty.brackets[i];
    const r = b.ratePct / 100;
    const next = i + 1 < ty.brackets.length ? ty.brackets[i + 1].from : Infinity;
    // net(G) = G − taxBelow − (G − from)·r − G·levy, for G in [from, next)
    const g = (n + taxBelow - b.from * r) / (1 - r - levy);
    if (g < next) return round2(Math.max(g, b.from));
    taxBelow += (next - b.from) * r;
  }
  return null; // unreachable: the last bracket is open-ended
}

/**
 * The effective and marginal rates, income tax plus levy, at a taxable income
 * — what Profit Goals offers as the per-job tax set-aside rate. PERCENTS.
 * @returns {{effectivePct:number, marginalPct:number}|null}
 */
function taxRatesAt(taxableIncome, taxYear) {
  const ty = normaliseTaxYear(taxYear);
  if (!ty) return null;
  const income = nonNeg(taxableIncome);
  let marginal = 0;
  for (const b of ty.brackets) if (income > b.from || b.from === 0) marginal = b.ratePct;
  const tax = incomeTax(income, ty);
  return {
    effectivePct: income > 0 ? round2((tax / income) * 100) : 0,
    marginalPct: round2(marginal + ty.medicareLevyPct),
  };
}

/**
 * The annual revenue the business must bill, and how it is made up.
 *
 *   grossPay       = grossForNet(desiredNetIncome)       // pay before tax
 *   incomeTax      = grossPay − desiredNetIncome
 *   super          = grossPay × superPct                 // personal concessional
 *                                                        // contribution: deductible,
 *                                                        // so not taxed here
 *   needed         = businessCost + grossPay + super
 *   badDebt        = needed × badDebtPct ÷ (1 − badDebtPct)
 *   total          = needed + badDebt                    // = needed ÷ (1 − badDebtPct)
 *
 * Business cost is deductible, so it is added AFTER tax, untaxed: the old flat
 * formula grossed it up and asked for ~$14k a year too much on the reference
 * figures. Super is treated as a deductible personal contribution; the 15%
 * contributions tax inside the fund and the concessional cap are the fund's
 * and the accountant's business, not a pricing input.
 *
 * @param {number} businessCost — annualBusinessCost().
 * @param {number} desiredNetIncome — after tax, per year.
 * @param {object} taxYear — see normaliseTaxYear.
 * @param {object} [opts] — { superPct, badDebtPct }, PERCENTS; unset is 0.
 * @returns {object|null} { businessCost, grossPay, incomeTax, superContribution,
 *   badDebtAllowance, total }, or null when there is no business cost yet, no
 *   income target, no usable tax year, or a bad-debt rate of 100% or more.
 */
function revenueTarget(businessCost, desiredNetIncome, taxYear, opts) {
  const cost = numOrNull(businessCost);
  if (cost === null || cost <= 0) return null;
  const net = numOrNull(desiredNetIncome);
  if (net === null || net < 0) return null;

  const gross = grossForNet(net, taxYear);
  if (gross === null) return null;

  const o = opts || {};
  const superPct = nonNeg(o.superPct);
  const badDebtPct = nonNeg(o.badDebtPct);
  if (badDebtPct >= 100) return null;

  /* Every part rounded, and the total built from the rounded parts, so the
     breakdown the Dashboard prints adds up to its total to the cent (the same
     rule as computeTotals' GST split). */
  const superContribution = round2(gross * (superPct / 100));
  const needed = round2(round2(cost) + gross + superContribution);
  const total = round2(needed / (1 - badDebtPct / 100));

  return {
    businessCost: round2(cost),
    grossPay: gross,
    incomeTax: round2(gross - net),
    superContribution,
    badDebtAllowance: round2(total - needed),
    total,
  };
}

/**
 * The annual planning figure: revenueTarget's total. A planning target and,
 * since 2026-09-28, the numerator of the income floor.
 * @returns {number|null}
 */
function targetAnnualRevenue(businessCost, desiredNetIncome, taxYear, opts) {
  const r = revenueTarget(businessCost, desiredNetIncome, taxYear, opts);
  return r ? r.total : null;
}

/**
 * The INCOME floor per billable hour: what every hour sold has to average for
 * the year to reach Target Annual Revenue — running costs, the owner's pay and
 * its tax, super and the bad-debt allowance. Chosen by the user on 2026-09-28
 * as the floor the rate card is measured against, beside the cost floor
 * (hourlyFloor), which carries running costs and markup only.
 *
 * @returns {number|null} null without a revenue target or a capacity.
 */
function incomeFloorPerHour(annualRevenueTarget, annualBillableHrs) {
  const target = numOrNull(annualRevenueTarget);
  const hours = numOrNull(annualBillableHrs);
  if (target === null || target <= 0 || hours === null || hours <= 0) return null;
  return round2(target / hours);
}

/* ── Floors, and the rate card measured against them ──────────────────────────
   Added 2026-09-27 for the Finance & Price Dashboard. The Rate Card will show
   the same per-row comparison, so it lives here rather than in either screen:
   two screens computing "is this row below its floor?" separately is how they
   come to disagree about a row. */

/**
 * The COST floor for an hour of work: its share of the business's running
 * cost, plus the target markup. The rate card is measured against the income
 * floor (incomeFloorPerHour) since 2026-09-28; this one stays on the Dashboard
 * beside it, and is what the estimate editor's Minimum Job Price is built on.
 *
 *   overheadRatePerHour × (1 + markupPct ÷ 100)
 *
 * Deliberately the same arithmetic minimumJobPrice() applies to a job's hours
 * — minimumJobPrice(0, h, rate, margin) is exactly h × this — so the Dashboard's
 * floors and the estimate editor's Minimum Job Price cannot disagree about what
 * an hour is worth. A test pins that equivalence.
 *
 * @param {number} overheadRate — from overheadRatePerHour().
 * @param {number} markupPct — a PERCENT (25 is 25%). See UNITS above.
 * @returns {number|null} null when there is no overhead rate, or no markup set.
 *   A 0% markup is a real answer (break even) and passes through; a missing one
 *   does not, because a floor that silently left it out would read as the real
 *   minimum.
 */
function hourlyFloor(overheadRate, markupPct) {
  const rate = numOrNull(overheadRate);
  if (rate === null || rate <= 0) return null;
  const markup = numOrNull(markupPct);
  if (markup === null || markup < 0) return null;
  return round2(rate * (1 + markup / 100));
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

/* ── Service units: one service, three prices ─────────────────────────────────
   Added 2026-09-28 for service rate tiers. The why is SERVICE UNITS in the
   header. Nothing here reads Capacity: a service day is the card's own. */

/** The units a labour service is priced in, in the order every screen lists them. */
const SERVICE_UNITS = ['hour', 'half', 'full'];

/* What every estimate write from a build that knows this card shape carries as
   `pricingShape`. The estimate routes refuse a write without it
   (pricing_shape_outdated): a build from before v9 would snapshot each new
   labour line at $0, because lineSnapshot on a row with `prices` and no `mu`
   reads no price. The rate card's own marker is `serviceDay`, which no old
   build sends; an estimate has nothing like it, so it carries this. Shared
   here so the web and the server can't spell it two ways.

   'service-units' until 2026-09-30, then 'travel-auto' (estimate-accuracy
   task 6a): an own-time travel row's `mu` may now be null (auto), which every
   build before it reads as $0 — its Rate Card would save the row back as a
   typed $0 (its payload() runs every travel price through num()), and its
   editor would snapshot the line at $0. So this marker is now ALSO carried by
   the rate card itself (card.pricingShape): readPricing puts it on every card
   the server serves, a build that knows it sends it back, and
   cardShapeOutdated refuses a card without it. An older build rebuilds the
   card field by field and drops it, so both of its writes are refused.

   'travel-km' since task 6b: a 'travel-auto' build's Rate Card would drop a
   km row's `perKm` flag and save it as a resold row at a typed $0.

   'production-days' since production-booking task 2 (v11): a 'travel-km'
   build's editor knows nothing of booked days, and its Rate Card rebuilds the
   card field by field and would drop `surcharges`.

   'deliverable-types' since production-booking B2-1 (v12): a 'production-days'
   build's Rate Card would drop `deliverableTypes` and every `prod` row's
   `capture` tick, which postPlan reads. */
const PRICING_SHAPE = 'deliverable-types';

/**
 * Is a rate card in a shape this build can't write? True when it doesn't carry
 * this build's `pricingShape` (see PRICING_SHAPE: a card from before task 6a,
 * or one sent by an older build), has no usable `serviceDay`, or any labour
 * row carries `mu`, `hoursPerUnit` or `dayUnit` or lacks a `prices` object. One definition for both sides: the rate card route
 * refuses such a card (pricing_shape_outdated), and the Rate Card screen won't
 * open one for editing — a server not yet on v9 serves this shape, and a
 * v9 screen would read every row as all-auto and save that back over every
 * typed price, where the v9 migration would then leave it (it skips rows that
 * already have `prices`).
 *
 * @param {object} pricing — a rate card, as served or as sent.
 * @returns {boolean}
 */
function cardShapeOutdated(pricing) {
  const p = pricing || {};
  if (p.pricingShape !== PRICING_SHAPE) return true;
  if (!p.serviceDay || typeof p.serviceDay !== 'object') return true;
  const sections = Array.isArray(p.labourSections) ? p.labourSections : [];
  return sections.some((sec) =>
    ((sec && Array.isArray(sec.rows)) ? sec.rows : []).some((r) =>
      !r || r.mu !== undefined || r.hoursPerUnit !== undefined || r.dayUnit !== undefined ||
      !r.prices || typeof r.prices !== 'object' || Array.isArray(r.prices)
    )
  );
}

/**
 * Whether an hours figure is a service-day length a card can be saved with:
 * 0.5 to 24, in half hours. The one definition: PUT /api/pricing refuses a
 * card on it (service_day_out_of_range) and the Rate Card refuses a save on
 * it, so the two can't disagree about what a valid day is.
 *
 * unitHours() below is deliberately looser (any figure above 0 and up to 24).
 * It prices what is on screen while a figure is still being typed ("7.3"
 * reads as 7.3 hours until the save refuses it), and a stored card has always
 * passed this check, so the two only differ on a working copy.
 *
 * @param {*} v — the figure as held: a number, or anything else for "not one".
 * @returns {boolean}
 */
function serviceDayOk(v) {
  return typeof v === 'number' && v >= 0.5 && v <= 24 && Number.isInteger(v * 2);
}

/* A service day when the card does not say usably. */
const SERVICE_DAY_FALLBACK = { full: 8, half: 4 };

/**
 * Billable hours in one unit of a service.
 *
 * `hour` is 1 by definition. `half` and `full` come from the card's
 * serviceDay; a missing, zero, negative, above-24 or non-numeric value falls
 * back to 4 / 8. Never null, for the same reason as hoursPerUnitOf: an hours
 * figure that read as nothing would drop a shoot out of the overhead
 * allocation. The Rate Card refuses to save such a value, so the fallback only
 * covers a hand-edited or half-migrated card. Anything that is not `half` or
 * `full` is an hour.
 *
 * @param {object} pricing — the rate card; only serviceDay is read.
 * @param {string} unit — 'hour' | 'half' | 'full'.
 * @returns {number} a positive number of hours.
 */
function unitHours(pricing, unit) {
  if (unit !== 'half' && unit !== 'full') return 1;
  const day = (pricing && pricing.serviceDay) || {};
  const h = numOrNull(unit === 'full' ? day.fullHours : day.halfHours);
  return h !== null && h > 0 && h <= 24 ? h : SERVICE_DAY_FALLBACK[unit];
}

/**
 * The auto price for a unit of work: the income floor for its hours plus the
 * target markup, as the smallest whole dollar that covers it.
 *
 *   target = floorPerHour × hours × (1 + markupPct ÷ 100)       (exact)
 *   price  = the least whole dollar p whose GST-exclusive part,
 *            p ÷ (1 + gst.rate) on a GST-inclusive card, reaches target
 *
 * which is ceil(target) on a GST-exclusive card and about ceil(target × (1 +
 * gst.rate)) on a GST-inclusive one. Against the EXACT target, not a
 * cent-rounded one — see decision 3 under SERVICE UNITS: an auto day is this
 * price × its hours, and a fraction of a cent short per hour becomes a whole
 * cent short per day. The only slack is SUGGEST_NOISE, for float error such as
 * 4.48 × 10 × 1.25 = 56.00000000000001, which is $56, not $57.
 *
 * @param {number|null} floorPerHour — incomeFloorPerHour(), GST-exclusive.
 * @param {number} hours — unitHours() for the unit.
 * @param {number|null} markupPct — a PERCENT (25 is 25%). See UNITS above.
 * @param {object} settings — { gst: { registered, rate, pricesIncludeGst } }.
 * @returns {number|null} whole dollars; null when there is no floor, no usable
 *   hours, or no markup set. A 0% markup is a real answer (the floor, rounded
 *   up); a missing or negative one is not, because a price that silently left
 *   it out would read as the real one.
 */
function suggestedPrice(floorPerHour, hours, markupPct, settings) {
  const floor = numOrNull(floorPerHour);
  if (floor === null || floor <= 0) return null;
  const h = numOrNull(hours);
  if (h === null || h <= 0) return null;
  const markup = numOrNull(markupPct);
  if (markup === null || markup < 0) return null;

  const target = floor * h * (1 + markup / 100) - SUGGEST_NOISE;
  const gstCfg = (settings && settings.gst) || {};
  if (gstCfg.registered !== true || gstCfg.pricesIncludeGst !== true) return Math.ceil(target);

  const rate = num(gstCfg.rate);
  if (rate < 0) return null;
  /* Start just under the answer and step up; this runs at most three times. */
  let price = Math.max(0, Math.floor(target * (1 + rate)) - 1);
  while (price / (1 + rate) < target) price += 1;
  return price;
}

/* Float error in floor × hours × markup is ~1e-14 at these sizes; a millionth
   of a cent is far above it and far below anything that could matter. */
const SUGGEST_NOISE = 1e-8;

/**
 * One service at one unit, as the flat row every existing caller already
 * prices from: { id, name, mu, auto, rate, customBill, hoursPerUnit, dayUnit }.
 * lineSnapshot, lineDef's snapshot path and computeTotals take it unchanged —
 * which is the point: none of them had to learn about `prices`.
 *
 * A number in row.prices[unit] is set by the user and comes back exactly as
 * stored, unrounded. null / missing / blank is auto: an hour is priced by
 * suggestedPrice from ctx, and a half or full day is the service's hourly
 * price (typed or auto) × the unit's hours, to the cent (decision 5 under
 * SERVICE UNITS). `mu: null` then means no price is available, never $0
 * (decision 2). `dayUnit` is present only for half and full, as on the old
 * day rows; rate and customBill only when the row has them.
 *
 * @param {object} row — a labour row carrying `prices`.
 * @param {string} unit — 'hour' | 'half' | 'full'.
 * @param {object} pricing — the rate card, for serviceDay.
 * @param {object} [ctx] — { floorPerHour, markupPct, settings }; the browser
 *   builds it with LSCData.priceContext(). Without it an auto hour is null,
 *   and so is an auto day on a service whose hourly price is auto.
 * @returns {object|null} null for no row or a unit off the list.
 */
function unitDef(row, unit, pricing, ctx) {
  if (!row || SERVICE_UNITS.indexOf(unit) === -1) return null;
  const hours = unitHours(pricing, unit);
  const typed = (u) => (row.prices ? numOrNull(row.prices[u]) : null);
  const stored = typed(unit);
  const auto = stored === null;
  let mu = stored;
  if (auto) {
    const c = ctx || {};
    const hourTyped = typed('hour');
    const hourly = hourTyped !== null ? hourTyped : suggestedPrice(c.floorPerHour, 1, c.markupPct, c.settings);
    mu = hourly === null ? null : unit === 'hour' ? hourly : round2(hourly * hours);
  }
  const def = { id: row.id, name: row.name, mu, auto };
  if (row.rate !== undefined) def.rate = row.rate;
  if (row.customBill) def.customBill = true;
  def.hoursPerUnit = hours;
  if (unit !== 'hour') def.dayUnit = unit;
  return def;
}

/**
 * Every labour service on the rate card, each of its three units beside the
 * floor for that unit — the Dashboard's "Rate card against its floors". It
 * replaced the one-row-per-row labourFloorComparison on 2026-09-28, when the
 * Dashboard moved to one row per service (service rate tiers, task 7).
 *
 * A unit's floor is floorPerHour × unitHours. It is compared against the
 * unit's price as unitDef resolves it — the typed one, or the auto one — with
 * GST taken out (priceExGst), never against `rate`, which feeds no billing
 * arithmetic anywhere (see computeTotals). Exactly at the floor is not below
 * it.
 *
 * LABOUR SERVICES ONLY. Resold and at-cost travel, crew and hire are added to
 * a job at cost on top of the labour and carry no overhead (price-calculator's
 * brief decision 6). Own-time travel rows are compared too, since task 6a, by
 * their own function: travelFloorComparison.
 *
 * An auto unit is priced from THIS function's floorPerHour and settings; only
 * ctx.markupPct is read from ctx. So an auto price and the floor it is set
 * against can never come from two different floors, and by construction (see
 * suggestedPrice) an auto unit is never below its floor. Without ctx, or with
 * no markup, every auto unit has no price.
 *
 * @param {object} pricing — a rate card whose labour rows carry `prices`.
 * @param {object} settings — { gst: { registered, rate, pricesIncludeGst } }.
 * @param {number|null} floorPerHour — incomeFloorPerHour(), GST-exclusive.
 * @param {object} [ctx] — { markupPct }; LSCData.priceContext() in the browser.
 * @returns {Array<object>} one entry per labour service, in rate-card order:
 *   { sectionId, sectionLabel, rowIndex, name, units: { hour, half, full } },
 *   each unit { mu, muExGst, auto, hoursPerUnit, floor, gap, belowFloor }.
 *   When there is no floor, or the unit has no price (mu null), floor-derived
 *   answers are null — "can't tell", which is neither "fine" nor "below".
 */
function serviceFloorComparison(pricing, settings, floorPerHour, ctx) {
  const perHour = numOrNull(floorPerHour);
  const hasFloor = perHour !== null && perHour > 0;
  const priceCtx = { floorPerHour: perHour, markupPct: ctx ? ctx.markupPct : null, settings };
  const sections = (pricing && pricing.labourSections) || [];
  const out = [];

  for (const section of sections) {
    (section.rows || []).forEach((row, rowIndex) => {
      const units = {};
      for (const unit of SERVICE_UNITS) {
        const def = unitDef(row, unit, pricing, priceCtx);
        const muExGst = def.mu === null ? null : priceExGst(def.mu, settings);
        const floor = hasFloor ? round2(perHour * def.hoursPerUnit) : null;
        /* Both sides in cents, so a unit priced exactly at its floor is not
           badged by float noise. */
        const belowFloor = floor === null || muExGst === null ? null : muExGst < floor;
        units[unit] = {
          mu: def.mu,
          muExGst,
          auto: def.auto,
          hoursPerUnit: def.hoursPerUnit,
          floor,
          gap: belowFloor ? round2(floor - muExGst) : belowFloor === null ? null : 0,
          belowFloor,
        };
      }
      out.push({ sectionId: section.id, sectionLabel: section.label, rowIndex, name: row.name, units });
    });
  }
  return out;
}

/**
 * One travel row as the estimator prices it: the row with `mu` resolved and an
 * `auto` flag — what lineSnapshot, lineDef and computeTotals take, as unitDef's
 * result is for a service. See YOUR TIME ON THE ROAD in the header.
 *
 * An own-time row (ownTime, not directCost) with no typed `mu` is auto:
 * suggestedPrice(ctx.floorPerHour, its hours, 0, ctx.settings) — the income
 * floor with no markup. Without ctx, or with no floor yet, that is null: no
 * price, never $0. Any other row keeps its typed `mu`, and a blank one reads
 * as 0, as it always has (see YOUR TIME ON THE ROAD in the header).
 *
 * @param {object} row — a rate-card travel row.
 * A `perKm` row (task 6b) is always derived: Overhead's per-km figure,
 * ctx.vehicleCostPerKm, plus GST on a GST-inclusive card; null without one.
 * See THE CAR IS BILLED PER KM in the header.
 *
 * @param {object} [ctx] — { floorPerHour, settings, vehicleCostPerKm };
 *   LSCData.priceContext() in the browser. Its markupPct is deliberately not
 *   read.
 * @returns {object|null} a copy of the row with `mu` and `auto`; null for no row.
 */
function travelRowDef(row, ctx) {
  if (!row) return null;
  if (row.perKm) {
    /* The car (task 6b): Overhead's per-km figure, GST-exclusive, plus GST on
       a GST-inclusive card. To 4 places: a per-km price is cents and parts of
       a cent, and 0.9 × 1.1 is 0.9900000000000001. */
    const c = ctx || {};
    const figure = numOrNull(c.vehicleCostPerKm);
    let mu = figure === null || figure < 0 ? null : figure;
    const gstCfg = (c.settings && c.settings.gst) || {};
    if (mu !== null && gstCfg.registered === true && gstCfg.pricesIncludeGst === true) {
      mu = Math.round(mu * (1 + num(gstCfg.rate)) * 1e4) / 1e4;
    }
    return Object.assign({}, row, { mu, auto: true });
  }
  const typed = numOrNull(row.mu);
  const auto = typed === null && row.ownTime === true && !row.directCost;
  let mu = typed;
  if (auto) {
    const c = ctx || {};
    mu = suggestedPrice(c.floorPerHour, hoursPerUnitOf(row), 0, c.settings);
  } else if (mu === null) {
    mu = 0;
  }
  return Object.assign({}, row, { mu, auto });
}

/**
 * The rate card's own-time travel rows beside their floors — the Dashboard's
 * and the Rate Card's companion to serviceFloorComparison, in its shape, so
 * one table and one badge serve both. Only rows ticked Your time and not
 * Direct: the rest are passed through and recover no overhead (see YOUR TIME
 * ON THE ROAD in the header). An own-time row sells by the hour only, so each
 * entry has `units.hour` and nothing else.
 *
 * The floor is floorPerHour × the row's hours, measured against its price
 * ex-GST (priceExGst), exactly at the floor not being below it. An auto price
 * is resolved from this function's own floor and settings, so it can never be
 * badged below the floor it was derived from.
 *
 * @param {object} pricing — the rate card.
 * @param {object} settings — { gst: { registered, rate, pricesIncludeGst } }.
 * @param {number|null} floorPerHour — incomeFloorPerHour(), GST-exclusive.
 * @returns {Array<object>} { sectionId: 'travel', sectionLabel: 'Travel',
 *   rowIndex (its index in travelRows), name, travel: true, units: { hour } },
 *   the unit as serviceFloorComparison's.
 */
function travelFloorComparison(pricing, settings, floorPerHour) {
  const perHour = numOrNull(floorPerHour);
  const hasFloor = perHour !== null && perHour > 0;
  const ctx = { floorPerHour: perHour, settings };
  const out = [];
  ((pricing && pricing.travelRows) || []).forEach((row, rowIndex) => {
    if (!row || row.ownTime !== true || row.directCost || row.perKm) return;
    const def = travelRowDef(row, ctx);
    const hours = hoursPerUnitOf(row);
    const muExGst = def.mu === null ? null : priceExGst(def.mu, settings);
    const floor = hasFloor ? round2(perHour * hours) : null;
    const belowFloor = floor === null || muExGst === null ? null : muExGst < floor;
    out.push({
      sectionId: 'travel',
      sectionLabel: 'Travel',
      rowIndex,
      name: row.name,
      travel: true,
      units: {
        hour: {
          mu: def.mu,
          muExGst,
          auto: def.auto,
          hoursPerUnit: hours,
          floor,
          gap: belowFloor ? round2(floor - muExGst) : belowFloor === null ? null : 0,
          belowFloor,
        },
      },
    });
  });
  return out;
}

/* ── Surcharges: weekend / public holiday, after hours, short notice ──────────
   Added 2026-10-02 (.design/production-booking/, task 1; the brief's Key
   Interactions 1 is the spec and its worked examples are pinned in
   test-calc.js). Since task 2, computeTotals prices a `prod` line through
   them when the line's `dayId` names one of the estimate's days; a line on no
   day, and every estimate saved before v11, prices exactly as it did.

   What is settled, not derived:

     1. PRODUCTION ITEMS ON A BOOKED DAY ONLY (D3, D24). Pre/post, Additional
        work and pass-throughs are never surcharged; the caller decides which
        lines reach here.
     2. A SURCHARGE IS INCOME. It adds no hours and moves no floor or Minimum
        Job Price — which is why it is a price factor, never an hours figure.
     3. THE CLIENT NEVER SEES IT (D8, D12). The factor is folded into the line
        and rounded UP to the whole dollar once, after every surcharge (D20).
        surchargeAttribution is the owner's account of where that money came
        from, for the Cost Breakdown.
     4. AFTER HOURS IS A SHARE OF THE DAY (D5), measured against office hours
        on EVERY day (D11 + the brief's flagged interpretation: a Saturday 8pm
        hour is both weekend and after hours; it only matters under "All
        multiply"). An overnight booking belongs to its start date, and every
        minute past midnight is after hours (D21).
     5. A DATE TBC DAY (no date) takes no weekend or after-hours surcharge, but
        short notice still applies (D9).
     6. A multiplier of ×1 is how a surcharge is switched off; one below 1 is
        read as 1. A surcharge never discounts. */

/* The Rate Card's surcharge settings when a card has none (any card from
   before v11) or a field is unusable. Weekdays are Date#getUTCDay numbers:
   0 Sunday … 6 Saturday. Modes (D2):
     'higher'   — day/time: the higher of weekend and after hours; short notice on top
     'multiply' — all multiply
     'highest'  — only the single highest surcharge applies */
const SURCHARGE_DEFAULTS = {
  shortNotice: 2,
  shortNoticeHintDays: 7,
  weekend: 1.5,
  afterHours: 1.25,
  officeStart: '07:00',
  officeEnd: '17:00',
  workingWeekdays: [1, 2, 3, 4, 5],
  mode: 'higher',
};

const SURCHARGE_MODES = ['higher', 'multiply', 'highest'];

/* Float error in base × factor is ~1e-13 at these sizes: 1120 × 1.05 is
   1176.0000000000002, which is $1,176, not $1,177. */
const SURCHARGE_NOISE = 1e-8;

/* 'HH:MM' (or 'HH:MM:SS', as a time input can send) → minutes after midnight. */
function clockMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t === null || t === undefined ? '' : t).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function multiplierOr(v, fallback) {
  const n = numOrNull(v);
  if (n === null) return fallback;
  return Math.max(1, n);
}

/* One surcharge settings object, every field usable. Missing or unusable
   fields take the default; office hours are taken as a pair, so a half-valid
   window never mixes with a default end. */
function normaliseSurcharges(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const D = SURCHARGE_DEFAULTS;
  const os = clockMinutes(s.officeStart);
  const oe = clockMinutes(s.officeEnd);
  const officeOk = os !== null && oe !== null && oe > os;
  const days = Array.isArray(s.workingWeekdays)
    ? s.workingWeekdays.map(Number).filter((d, i, a) => Number.isInteger(d) && d >= 0 && d <= 6 && a.indexOf(d) === i)
    : [];
  const hint = numOrNull(s.shortNoticeHintDays);
  return {
    shortNotice: multiplierOr(s.shortNotice, D.shortNotice),
    shortNoticeHintDays: hint !== null && hint >= 0 ? Math.floor(hint) : D.shortNoticeHintDays,
    weekend: multiplierOr(s.weekend, D.weekend),
    afterHours: multiplierOr(s.afterHours, D.afterHours),
    officeStart: officeOk ? String(s.officeStart).trim().slice(0, 5) : D.officeStart,
    officeEnd: officeOk ? String(s.officeEnd).trim().slice(0, 5) : D.officeEnd,
    workingWeekdays: days.length ? days.sort((a, b) => a - b) : D.workingWeekdays.slice(),
    mode: SURCHARGE_MODES.indexOf(s.mode) !== -1 ? s.mode : D.mode,
  };
}

/**
 * A rate card's surcharge settings, with the defaults filled in.
 *
 * @param {object} card — the rate card; only `surcharges` is read.
 * @returns {object} every field of SURCHARGE_DEFAULTS, usable.
 */
function surchargeSettings(card) {
  return normaliseSurcharges(card && card.surcharges);
}

/**
 * What kind of day a date is, for the weekend / public holiday surcharge.
 *
 * The date is read as TEXT (fyStartYear explains why a 'YYYY-MM-DD' must never
 * go through local Date getters); its weekday comes from Date.UTC, which no
 * timezone can shift. A holiday is any listed date that isn't `hidden` — a
 * fetched date the owner removed — and it wins over the weekday test.
 *
 * @param {string|null} date — 'YYYY-MM-DD'; null or blank is a Date TBC day.
 * @param {object} settings — the card's `surcharges` (raw is fine; defaults
 *   fill gaps). Only workingWeekdays is read.
 * @param {Array<string|object>} [holidays] — 'YYYY-MM-DD' strings or holiday
 *   rows { date, hidden }.
 * @returns {'weekday'|'weekend'|'holiday'|null} null for no date or a date
 *   that doesn't exist (2026-02-30).
 */
function dayKind(date, settings, holidays) {
  const ymd = String(date === null || date === undefined ? '' : date).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;

  const listed = (Array.isArray(holidays) ? holidays : []).some((h) => {
    if (typeof h === 'string') return h.trim() === ymd;
    if (!h || typeof h !== 'object') return false;
    if (h.hidden && h.hidden !== '0') return false;
    return String(h.date || '').trim() === ymd;
  });
  if (listed) return 'holiday';
  return normaliseSurcharges(settings).workingWeekdays.indexOf(dt.getUTCDay()) !== -1 ? 'weekday' : 'weekend';
}

/* 'YYYY-MM-DD' → the next calendar date, as text. Built with Date.UTC and
   read back in UTC, as dayKind reads a date, so no timezone can move it.
   null for anything that isn't a date. */
function nextDateOf(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd === null || ymd === undefined ? '' : ymd).trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

/* Office hours in minutes after midnight; a pair that doesn't parse, or that
   ends at or before it starts, reads as the defaults (07:00–17:00). */
function officeMinutes(officeStart, officeEnd) {
  const os = clockMinutes(officeStart);
  const oe = clockMinutes(officeEnd);
  if (os === null || oe === null || oe <= os) {
    return [clockMinutes(SURCHARGE_DEFAULTS.officeStart), clockMinutes(SURCHARGE_DEFAULTS.officeEnd)];
  }
  return [os, oe];
}

/**
 * The stretch of a booked day that one production item covers: from the
 * booked start, for the item's own hours, never past the booked end. In
 * minutes after the start date's midnight, so an overnight window ends past
 * 1440 (at most 2880: a booking is under 24 hours).
 *
 * The item's own hours, not the whole booking (decided 2026-10-02 after the
 * money review, replacing D5's share of the booked window): a full day booked
 * 9am–9pm covers 9am–5pm. Booked hours past an item's length carry no
 * surcharge, because the owner bills them as Overtime (D10, D26), and charging
 * the full day an after-hours share for them would charge those hours twice.
 * An item longer than the booking covers the booking.
 *
 * With no `lineHours` the window is the whole booking: the day's own reading,
 * as the Rate Card's mode example and the editor's announcement use it.
 *
 * @returns {{start:number, end:number}|null} null when either time is missing
 *   or unusable, or start = end: there are no booked hours to place it in.
 */
function coveredWindow(day, lineHours) {
  const a = clockMinutes(field(day, 'startTime', 'start_time'));
  const b0 = clockMinutes(field(day, 'endTime', 'end_time'));
  if (a === null || b0 === null || a === b0) return null;
  const b = b0 < a ? b0 + 1440 : b0;
  const h = numOrNull(lineHours);
  return { start: a, end: h !== null && h > 0 ? Math.min(b, a + h * 60) : b };
}

/* A window cut at midnight and at each date's office hours: its pieces, each
   { minutes, nextDay, afterHours }. Office hours hold on both dates (decided
   2026-10-02), so an overnight shoot's hours after the next morning's office
   start are in-hours; they used to count as after hours. */
function windowPieces(win, officeStart, officeEnd) {
  const [os, oe] = officeMinutes(officeStart, officeEnd);
  const pieces = [];
  for (let d = 0; d < 2; d += 1) {
    const lo = Math.max(win.start, d * 1440);
    const hi = Math.min(win.end, (d + 1) * 1440);
    if (hi <= lo) continue;
    const inside = Math.max(0, Math.min(hi, oe + d * 1440) - Math.max(lo, os + d * 1440));
    if (inside > 0) pieces.push({ minutes: inside, nextDay: d === 1, afterHours: false });
    if (hi - lo - inside > 0) pieces.push({ minutes: hi - lo - inside, nextDay: d === 1, afterHours: true });
  }
  return pieces;
}

/**
 * The share of a booking's hours that falls outside office hours (D5).
 *
 * An end before the start means overnight. Office hours apply on the next
 * date too, so after midnight only the hours outside them are after hours.
 * Office hours that don't parse, or that end at or before they start, read as
 * the defaults (07:00–17:00).
 *
 * @param {string} start — 'HH:MM'.
 * @param {string} end — 'HH:MM'; earlier than start is overnight.
 * @param {string} officeStart — 'HH:MM'.
 * @param {string} officeEnd — 'HH:MM'.
 * @returns {number} 0 to 1, exact (not rounded). 0 when either booking time is
 *   missing or unusable, or start equals end: there are no booked hours to
 *   divide, and an unpriceable share must not read as a surcharge.
 */
function afterHoursShare(start, end, officeStart, officeEnd) {
  const win = coveredWindow({ startTime: start, endTime: end });
  if (!win) return 0;
  const after = windowPieces(win, officeStart, officeEnd)
    .filter((p) => p.afterHours)
    .reduce((sum, p) => sum + p.minutes, 0);
  return after / (win.end - win.start);
}

/* The surcharge chain for one item on one day, as the steps each part of its
   window passes through. A part is a piece of the window: in or out of office
   hours, on the start date or (overnight) the next one. Each step multiplies
   that part's running price by m. Per the brief's table, with w the part's
   own date's weekend/holiday multiplier:

     mode       in-hours           after-hours
     higher     [w], S             [max(w, A)], S
     multiply   w, S               w, A, S
     highest    [max(S, w)]        [max(S, w, A)]

   [max(…)] is one step, taken by the winner. On a tie the earlier of weekend,
   after hours, short notice wins — the $ are the same either way; this only
   decides the row's name. The order of steps is also the order the
   attribution charges them in: under "multiply", after hours is charged on the
   weekend price, and short notice on the surcharged price.

   HOURS AFTER MIDNIGHT TAKE THE NEXT DATE'S STATUS (decided 2026-10-02,
   replacing D21's "the start date's status applies to the whole shoot"): a
   Friday 8pm–4am shoot's four Saturday hours are weekend hours, as penalty
   rates split at midnight. `nextKind` is that date's kind, snapshotted like
   `kind` (surchargeSnapshot's nextDays); without one it is read from the date
   and the holiday list. */
function surchargeParts(day, card, shortNotice, holidays, lineHours) {
  const cfg = surchargeSettings(card);
  const date = day ? day.date : null;
  const KINDS = ['weekday', 'weekend', 'holiday'];
  /* A day saved with its kind (the estimate's snapshot) keeps it, so a later
     holiday-list change moves only new estimates. No date is TBC either way. */
  const kind = dayKind(date, cfg, []) === null
    ? null
    : KINDS.indexOf(day.kind) !== -1 ? day.kind : dayKind(date, cfg, holidays);

  const wOf = (k) => ({ type: k === 'holiday' ? 'holiday' : 'weekend', m: k === 'weekend' || k === 'holiday' ? cfg.weekend : 1 });
  const A = { type: 'afterHours', m: cfg.afterHours };
  const S = { type: 'shortNotice', m: shortNotice ? cfg.shortNotice : 1 };
  const top = (cands) => cands.reduce((best, c) => (c.m > best.m ? c : best));
  const stepsFor = (w, after) => {
    if (cfg.mode === 'multiply') return after ? [w, A, S] : [w, S];
    if (cfg.mode === 'highest') return after ? [top([w, A, S])] : [top([w, S])];
    return after ? [top([w, A]), S] : [w, S];
  };

  const win = kind === null ? null : coveredWindow(day, lineHours);
  if (!win) {
    // Date TBC, or no times: the whole item is in-hours on its date.
    return {
      kind, nextKind: null, mode: cfg.mode, window: null, hours: 0, share: 0,
      parts: [{ share: 1, nextDay: false, afterHours: false, steps: stepsFor(wOf(kind), false) }],
    };
  }
  const total = win.end - win.start;
  const nextKind = win.end <= 1440
    ? null
    : KINDS.indexOf(day.nextKind) !== -1 ? day.nextKind : dayKind(nextDateOf(date), cfg, holidays);
  const parts = windowPieces(win, cfg.officeStart, cfg.officeEnd).map((p) => ({
    share: p.minutes / total,
    nextDay: p.nextDay,
    afterHours: p.afterHours,
    steps: stepsFor(wOf(p.nextDay ? nextKind : kind), p.afterHours),
  }));
  return {
    kind,
    nextKind,
    mode: cfg.mode,
    window: win,
    hours: total / 60,
    share: parts.filter((p) => p.afterHours).reduce((sum, p) => sum + p.share, 0),
    parts,
  };
}

/**
 * The price factor for a production item on one booked day: Σ share × the
 * product of its steps, over the parts of the window it covers (see
 * surchargeParts and coveredWindow).
 *
 * @param {object} day — { date, startTime, endTime } (snake_case accepted),
 *   optionally `kind` and `nextKind` as snapshotted at save. null is Date TBC.
 * @param {object} card — the rate card (or { surcharges } snapshot).
 * @param {boolean} shortNotice — the estimate's tick.
 * @param {Array} [holidays] — see dayKind; unused for a snapshotted kind.
 * @param {number} [lineHours] — the item's own hours (qty × hours per unit);
 *   without it, the whole booking.
 * @returns {number} ≥ 1, unrounded. Exactly 1 when nothing applies.
 */
function surchargeFactor(day, card, shortNotice, holidays, lineHours) {
  const { parts } = surchargeParts(day, card, shortNotice, holidays, lineHours);
  return parts.reduce((sum, p) => sum + p.share * p.steps.reduce((f, st) => f * st.m, 1), 0);
}

/**
 * A line's client price after surcharges: ceil(base × factor) to the whole
 * dollar (D20), once, after all of them. A factor of 1 (or below) is no
 * surcharge, and the base comes back to the cent, unrounded — a line nothing
 * applies to must price exactly as it did before surcharges existed.
 *
 * @param {number} base — the line's price before surcharges (qty × price).
 * @param {number} factor — surchargeFactor().
 * @returns {number}
 */
function surchargedLinePrice(base, factor) {
  const b = round2(nonNeg(base));
  const f = num(factor);
  if (!(f > 1) || b <= 0) return b;
  return Math.ceil(b * f - SURCHARGE_NOISE);
}

/**
 * Where a surcharged line's extra money came from, for the owner's Cost
 * Breakdown (D13): one row per surcharge that added anything. The rows add up
 * TO THE CENT to price − base; each row is rounded to the cent and the last
 * row takes the remainder, which carries the whole-dollar round-up (D20).
 *
 * Rows come in this order: the start date's weekend/holiday and after hours,
 * then the CARRY-OVER rows, then short notice. A carry-over row is a part of
 * the item after midnight on a date whose status differs from the start
 * date's (a Friday night into Saturday): the rate changes there, so it is its
 * own row (`carry: true`, the date in `carryDate`). After midnight on a date of
 * the same status there is no rate change, and those hours join the start
 * date's rows.
 *
 * @returns {{base:number, price:number, surcharge:number, factor:number,
 *   kind:string|null, nextKind:string|null, carryDate:string|null,
 *   window:{start:number,end:number}|null, hours:number,
 *   rows:Array<{type:string, multiplier:number, share:number, hours:number,
 *   carry:boolean, amount:number}>}} `share` is the fraction of the item's
 *   covered hours the row applied to, and `hours` that many hours (0 with no
 *   times). `window` and `hours` are the stretch the item covers.
 */
function surchargeAttribution(base, day, card, shortNotice, holidays, lineHours) {
  const b = round2(nonNeg(base));
  const sp = surchargeParts(day, card, shortNotice, holidays, lineHours);
  const carry = sp.nextKind !== null && sp.nextKind !== sp.kind;
  const acc = new Map();
  let factor = 0;
  sp.parts.forEach((p) => {
    let running = 1;
    p.steps.forEach((st) => {
      if (st.m > 1 && p.share > 0) {
        const isCarry = carry && p.nextDay && st.type !== 'shortNotice';
        const key = st.type + (isCarry ? '@next' : '');
        let row = acc.get(key);
        if (!row) {
          row = { type: st.type, multiplier: st.m, carry: isCarry, share: 0, raw: 0 };
          acc.set(key, row);
        }
        row.raw += b * p.share * running * (st.m - 1);
        row.share += p.share;
      }
      running *= st.m;
    });
    factor += p.share * running;
  });

  const price = surchargedLinePrice(b, factor);
  const surcharge = round2(price - b);
  const DAY_TYPES = ['weekend', 'holiday', 'afterHours'];
  const ORDER = DAY_TYPES.concat(DAY_TYPES.map((t) => t + '@next'), ['shortNotice']);
  const rows = ORDER.filter((k) => acc.has(k) && acc.get(k).raw > 0).map((k) => acc.get(k));
  let sofar = 0;
  const out = rows.map((r, i) => {
    const amount = i === rows.length - 1 ? round2(surcharge - sofar) : round2(r.raw);
    sofar = round2(sofar + amount);
    return { type: r.type, multiplier: r.multiplier, share: r.share, hours: round2(r.share * sp.hours), carry: r.carry, amount };
  });
  return {
    base: b,
    price,
    surcharge,
    factor,
    kind: sp.kind,
    nextKind: sp.nextKind,
    carryDate: carry ? nextDateOf(day.date) : null,
    window: sp.window,
    hours: sp.hours,
    rows: out,
  };
}

/* Does a day run past midnight? Its end clock time is before its start. */
function isOvernight(day) {
  const a = clockMinutes(field(day, 'startTime', 'start_time'));
  const b = clockMinutes(field(day, 'endTime', 'end_time'));
  return a !== null && b !== null && b < a;
}

/**
 * What an estimate stores as its surcharge snapshot (`surcharges_json`): the
 * settings it was priced under, each dated day's kind, and, for a day that
 * runs past midnight, the next date's kind (`nextDays`), so a later Rate Card
 * or holiday-list change moves only new estimates (brief, Key Interactions 1).
 *
 * Re-saving keeps what was snapshotted: the prior settings, and a day's kinds
 * as long as that day (same id) still has the same date. A new day, or one
 * whose date moved, is read fresh against the holiday list. With no prior
 * snapshot — a new estimate, one saved before v11, or the caller asking for
 * current rates — the card's settings are taken live.
 *
 * One definition for both sides: the server stores it, and the editor builds
 * the same one to price live, so the two agree to the cent.
 *
 * @param {Array<object>} days — the estimate's days as about to be saved:
 *   { id, date, startTime, endTime } (others ignored).
 * @param {object} card — the live rate card.
 * @param {Array} holidays — the live holiday list (see dayKind).
 * @param {object|null} prior — { surcharges, days }: the stored snapshot and
 *   the stored days; null for none.
 * @returns {{settings:object, days:Object<string,string>,
 *   nextDays?:Object<string,string>}} nextDays only when a day is overnight.
 */
function surchargeSnapshot(days, card, holidays, prior) {
  const p = prior || {};
  const snap = p.surcharges && typeof p.surcharges === 'object' ? p.surcharges : {};
  const keep = Boolean(snap.settings && typeof snap.settings === 'object');
  const settings = keep ? normaliseSurcharges(snap.settings) : surchargeSettings(card);
  const priorKinds = keep && snap.days && typeof snap.days === 'object' ? snap.days : {};
  const priorNext = keep && snap.nextDays && typeof snap.nextDays === 'object' ? snap.nextDays : {};
  const priorDates = {};
  (Array.isArray(p.days) ? p.days : []).forEach((d) => {
    if (d && d.id) priorDates[d.id] = d.date || null;
  });

  const kinds = {};
  const nextKinds = {};
  (Array.isArray(days) ? days : []).forEach((d) => {
    if (!d || !d.id) return;
    const fresh = dayKind(d.date, settings, holidays);
    if (fresh === null) return; // Date TBC: nothing to snapshot
    const unmoved = priorDates[d.id] === d.date;
    kinds[d.id] = priorKinds[d.id] && unmoved ? priorKinds[d.id] : fresh;
    if (isOvernight(d)) {
      nextKinds[d.id] = priorNext[d.id] && unmoved ? priorNext[d.id] : dayKind(nextDateOf(d.date), settings, holidays);
    }
  });
  const out = { settings, days: kinds };
  if (Object.keys(nextKinds).length) out.nextDays = nextKinds;
  return out;
}

/* The surcharge context computeTotals prices `prod` lines through: each day by
   id, with its snapshotted kinds, and the snapshot's settings as a card. null
   when the estimate has no days and no short notice, so nothing about it is
   surcharged. */
function surchargeContext(options) {
  const o = options || {};
  const days = Array.isArray(o.days) ? o.days : [];
  const shortNotice = o.shortNotice === true;
  if (!days.length && !shortNotice) return null;
  const snap = o.surcharges && typeof o.surcharges === 'object' ? o.surcharges : {};
  const kinds = snap.days && typeof snap.days === 'object' ? snap.days : {};
  const nextKinds = snap.nextDays && typeof snap.nextDays === 'object' ? snap.nextDays : {};
  const byId = new Map();
  days.forEach((d) => {
    if (d && d.id) byId.set(String(d.id), Object.assign({}, d, { kind: kinds[d.id], nextKind: nextKinds[d.id] }));
  });
  return { byId, card: { surcharges: snap.settings }, shortNotice };
}

/* A production line's price after surcharges, or `base` itself — untouched,
   not even rounded — when nothing applies to it. On a day, the day's rates
   over the hours the line covers. On no day, short notice still applies when
   it's ticked, as on a Date TBC day (D3, D9): it used to be skipped, so an
   estimate whose lines weren't on a day was undercharged by the whole short-
   notice premium (money review, 2026-10-02). */
function surchargedPriceOf(base, line, ctx, lineHours) {
  if (!ctx || !line) return base;
  const day = line.dayId ? ctx.byId.get(String(line.dayId)) : null;
  if (day) return surchargedLinePrice(base, surchargeFactor(day, ctx.card, ctx.shortNotice, undefined, lineHours));
  if (ctx.shortNotice) return surchargedLinePrice(base, surchargeFactor(null, ctx.card, true));
  return base;
}

/**
 * The estimate's lines as they are stored: every `prod` line the surcharges
 * reach — one on a day, and, with short notice ticked, one on no day — carries
 * the `surchargedPrice` computeTotals priced it at (D20's whole dollars), and no
 * other line carries one. The server writes this on every save, so a stored
 * line can never claim a price its totals don't contain; the PDF and the
 * detail read it rather than re-pricing.
 *
 * @param {object} activeRows — as computeTotals takes them.
 * @param {object} pricing — the rate card.
 * @param {object} options — computeTotals' options (days, surcharges, shortNotice).
 * @returns {object} a new activeRows; the input is not modified.
 */
function stampSurchargedPrices(activeRows, pricing, options) {
  const rows = activeRows || {};
  const ctx = surchargeContext(options);
  const prodRows = ((pricing && pricing.labourSections) || []).find((s) => s && s.id === 'prod');
  const out = {};
  Object.keys(rows).forEach((key) => {
    if (!Array.isArray(rows[key])) {
      out[key] = rows[key];
      return;
    }
    out[key] = rows[key].map((line) => {
      if (!line || typeof line !== 'object') return line;
      const copy = Object.assign({}, line);
      delete copy.surchargedPrice;
      if (key !== 'prod' || !ctx) return copy;
      const onDay = Boolean(copy.dayId) && ctx.byId.has(String(copy.dayId));
      if (!onDay && !ctx.shortNotice) return copy;
      const def = lineDef(prodRows ? prodRows.rows : [], copy, pricing);
      if (!def) return copy;
      const qty = nonNeg(copy.qty);
      const override = nonNeg(copy.override);
      const base = override > 0 ? override : qty * nonNeg(def.mu);
      copy.surchargedPrice = surchargedPriceOf(base, copy, ctx, qty * hoursPerUnitOf(def));
      return copy;
    });
  });
  return out;
}

/* ── The Cost Breakdown (production-booking task 8) ─────────────────────────
   The owner's document that explains a price (D8, D13). It is client-safe —
   it can be forwarded — so it carries line prices and surcharges, and never
   a floor, the Minimum Job Price, the tax set-aside or take-home. */

/**
 * A day's booked hours, from its times; 0 when either is missing or they're
 * equal, as coveredWindow reads them. The one definition: the editor's hours
 * hint, the owner's notes and the Cost Breakdown all read it.
 */
function bookedHoursOf(day) {
  const win = coveredWindow(day);
  return win ? (win.end - win.start) / 60 : 0;
}

/* Whole cents, so the breakdown's sums are integer additions. */
function centsOf(n) {
  return Math.round(round2(n) * 100);
}

/**
 * The Cost Breakdown as figures: production items at their base price under
 * their day, each item's own weekend / holiday / after-hours rows and its
 * carry-over rows, short notice once for the whole estimate, then every other
 * line, adding up to the estimate's stored total.
 *
 * It reads the estimate as saved — the lines' own snapshots, its days and its
 * surcharge snapshot — never the live card's surcharge settings, so it
 * explains the price the client was given, not today's. A line's price is the
 * one computeTotals charged (surchargeAttribution prices it the same way), and
 * each line's surcharge rows add up to the cent to price − base.
 *
 * SURCHARGES ARE PER ITEM, because each item covers its own hours from the
 * booked start (coveredWindow): on one day a full day and a two-hour item can
 * carry different after-hours shares. Each item says what it covers.
 *
 * Each line is shown to the cent. computeTotals rounds once, on the sum, so
 * lines priced in fractions of a cent can leave the shown lines a cent or so
 * off the stored total: `adjustment` is that difference, printed as a
 * "Rounding" row. It is measured against the figure the lines add up to: the
 * total inc GST when the card's prices included GST, otherwise the client
 * price ex GST, read from the stored totals (whichever the lines are nearer),
 * not today's settings, as gstTreatment reads GST.
 *
 * `stale` is true when the difference is more than rounding can explain (half
 * a cent per line): the stored totals no longer match the lines, as on an
 * estimate saved by an older build. The document must not paper over that as
 * "rounding"; the route refuses it and asks for a re-save.
 *
 * @param {object} activeRows — the estimate's stored lines.
 * @param {object} pricing — the rate card, for a legacy line with no snapshot.
 * @param {object} options — { days, surcharges, shortNotice, totals, gstFree },
 *   as loadEstimate gives them.
 * @returns {object} { days, shortNotice, sections, travel, equip, crew,
 *   surchargeTotal, itemsTotal, linesIncludeGst, target, adjustment, stale,
 *   settings } — see the code below for each shape; every money figure is in
 *   dollars to the cent.
 */
function costBreakdown(activeRows, pricing, options) {
  const rows = activeRows || {};
  const o = options || {};
  const labourSections = (pricing && pricing.labourSections) || [];
  const travelDefs = (pricing && pricing.travelRows) || [];
  const ctx = surchargeContext(o);

  const days = [];
  const dayById = new Map();
  if (ctx) {
    (Array.isArray(o.days) ? o.days : []).forEach((d) => {
      if (!d || !d.id || dayById.has(String(d.id))) return;
      const day = ctx.byId.get(String(d.id));
      const out = {
        id: String(d.id),
        date: day.date || null,
        status: day.status,
        startTime: field(day, 'startTime', 'start_time') || null,
        endTime: field(day, 'endTime', 'end_time') || null,
        kind: surchargeParts(day, ctx.card, false).kind,
        bookedHours: bookedHoursOf(day),
        lines: [],
        base: 0,
        price: 0,
      };
      days.push(out);
      dayById.set(out.id, out);
    });
  }

  let shortNoticeCents = 0;
  let shortNoticeMultiplier = 1;
  let shortNoticeItems = 0;
  let itemsCents = 0;
  let surchargeCents = 0;
  let lineCount = 0;

  const unitOf = (def, line) => {
    const dayUnit = def.dayUnit || line.dayUnit;
    if (dayUnit === 'full' || dayUnit === 'half') return dayUnit;
    return hoursPerUnitOf(def) === 1 ? 'hour' : 'unit';
  };
  /* Short notice is one row for the estimate; every other row stays with its
     item. */
  const takeShortNotice = (att) => att.rows.filter((r) => {
    if (r.type !== 'shortNotice') return true;
    shortNoticeCents += centsOf(r.amount);
    shortNoticeMultiplier = r.multiplier;
    shortNoticeItems += 1;
    return false;
  });

  const sections = [];
  for (const section of labourSectionsOf(rows, labourSections)) {
    const lines = [];
    (rows[section.id] || []).forEach((line, index) => {
      if (!line || typeof line !== 'object') return;
      const def = lineDef(section.rows, line, pricing);
      if (!def) return; // prices at nothing in computeTotals too
      const qty = nonNeg(line.qty);
      const override = nonNeg(line.override);
      const base = override > 0 ? override : qty * nonNeg(def.mu);
      const hours = qty * hoursPerUnitOf(def);
      const isProd = section.id === 'prod';
      const day = isProd && line.dayId ? dayById.get(String(line.dayId)) : null;
      if (!(qty > 0) && !(base > 0)) return;
      lineCount += 1;

      if (day) {
        const att = surchargeAttribution(base, ctx.byId.get(day.id), ctx.card, ctx.shortNotice, undefined, hours);
        const own = takeShortNotice(att);
        day.lines.push({
          index,
          name: line.name || '',
          qty,
          unit: unitOf(def, line),
          base: att.base,
          price: att.price,
          window: att.window,
          coveredHours: att.hours,
          carryDate: att.carryDate,
          nextKind: att.nextKind,
          surcharges: own.map((r) => ({ type: r.type, multiplier: r.multiplier, share: r.share, hours: r.hours, carry: r.carry, amount: r.amount })),
        });
        day.base = (centsOf(day.base) + centsOf(att.base)) / 100;
        day.price = (centsOf(day.price) + centsOf(att.price)) / 100;
        itemsCents += centsOf(att.price);
        surchargeCents += centsOf(att.price) - centsOf(att.base);
        return;
      }

      // A production line on no day: short notice only (surchargedPriceOf).
      let amount = round2(base);
      let price = amount;
      if (isProd && ctx && ctx.shortNotice) {
        const att = surchargeAttribution(base, null, ctx.card, true);
        takeShortNotice(att);
        amount = att.base;
        price = att.price;
        surchargeCents += centsOf(att.price) - centsOf(att.base);
      }
      lines.push({ index, name: line.name || '', qty, unit: unitOf(def, line), amount, price });
      itemsCents += centsOf(price);
    });
    if (lines.length) {
      const total = lines.reduce((sum, l) => sum + centsOf(l.amount), 0) / 100;
      sections.push({ id: section.id, lines, total });
    }
  }

  const travel = [];
  (rows.travel || []).forEach((line, index) => {
    if (!line || typeof line !== 'object') return;
    const def = lineDef(travelDefs, line);
    if (!def) return;
    const qty = nonNeg(line.qty);
    const amount = round2(def.directCost ? qty : qty * nonNeg(def.mu));
    if (!(qty > 0) && !(amount > 0)) return;
    travel.push({ index, name: line.name || '', qty, perKm: Boolean(def.perKm), directCost: Boolean(def.directCost), amount });
    itemsCents += centsOf(amount);
    lineCount += 1;
  });

  const atCost = (key, nameKey, fallback) => {
    const out = [];
    (rows[key] || []).forEach((line, index) => {
      if (!line || typeof line !== 'object') return;
      const amount = round2(nonNeg(line.days) * nonNeg(line.cost));
      if (!(amount > 0) && !line[nameKey]) return;
      out.push({ index, name: line[nameKey] || fallback, days: nonNeg(line.days), cost: nonNeg(line.cost), amount });
      itemsCents += centsOf(amount);
      lineCount += 1;
    });
    return out;
  };
  const equip = atCost('equip', 'vendor', 'Equipment');
  const crew = atCost('crew', 'role', 'Crew');

  /* What the lines should add up to. A document with no stored totals (never
     saved) has nothing to reconcile against. */
  const t = o.totals || {};
  let linesIncludeGst = false;
  let targetCents = itemsCents;
  if (Number.isFinite(parseFloat(t.totalIncGst))) {
    const ex = centsOf(num(t.clientPriceExGst));
    const inc = centsOf(num(t.totalIncGst));
    if (gstTreatment(t, { gstFree: o.gstFree === true }) === 'taxable') {
      linesIncludeGst = Math.abs(itemsCents - inc) < Math.abs(itemsCents - ex);
    }
    targetCents = linesIncludeGst ? inc : ex;
  }
  const adjustmentCents = targetCents - itemsCents;

  return {
    days,
    shortNotice: shortNoticeCents !== 0
      ? { multiplier: shortNoticeMultiplier, amount: shortNoticeCents / 100, items: shortNoticeItems }
      : null,
    sections,
    travel,
    equip,
    crew,
    surchargeTotal: surchargeCents / 100,
    itemsTotal: itemsCents / 100,
    linesIncludeGst,
    target: targetCents / 100,
    adjustment: adjustmentCents / 100,
    // Half a cent of rounding per line shown, at most.
    stale: Math.abs(adjustmentCents) > lineCount * 0.5 + 1e-9,
    settings: ctx ? surchargeSettings(ctx.card) : null,
  };
}

/* ── The post-production planner (production-booking B2-1) ──────────────────
   Suggests, never prices (the brief's B2 principle 2): nothing here reaches
   computeTotals, a stored line or a client document. The owner types the post
   hours; these figures are the guide beside them (D89–D96). */

/* A share is rounded UP to the half hour. Float error such as 10 × 0.15 =
   1.5000000000000002 is 1.5, not 2. */
const PLAN_NOISE = 1e-9;
const upToHalfHour = (h) => Math.max(0, Math.ceil(h * 2 - PLAN_NOISE) / 2);

/**
 * Production Capture Hours, each deliverable's share of the edit, and how much
 * of it the Post-Production lines already hold.
 *
 *   captureHours = Σ hours of every `prod` line whose capture flag is set,
 *                  on a day, a Date TBC day or no day (they're all in `prod`)
 *   share        = captureHours × the deliverable's multiplier × its qty,
 *                  rounded up to the nearest 0.5
 *   recommended  = Σ shares, so the rows add up to it
 *   onPostLines  = Σ hours of every `post` line, tagged or not
 *
 * A line's hours are the hours it bills — qty × the hours per unit of the
 * definition computeTotals prices it from (lineDef) — so a Full Day counts
 * the Service Day it was added on, and capture can never disagree with the
 * job's totalHours. A line that prices at nothing (its service gone from the
 * card, with no snapshot) counts nothing, as it does there.
 *
 * The capture flag is the line's own `capture`, snapshotted when it was added.
 * A line saved before B2 has none and falls back to the live card's `prod` row
 * with its id, then its name, as lineDef does. A deliverable is untyped until
 * it has a `typeId`; an untyped one recommends 0 whatever else it carries.
 *
 * @param {object} activeRows — the estimate's rows: `prod`, `post`, `deliverables`.
 * @param {object} pricing — the rate card.
 * @returns {{ captureHours: number, shares: Array<{deliverableId: string|null, hours: number}>,
 *   recommended: number, onPostLines: number }} — one share per deliverable, in
 *   order; `deliverableId` is null on one saved before B2.
 */
function postPlan(activeRows, pricing) {
  const rows = activeRows || {};
  const sectionRows = (id) => {
    const sec = ((pricing && pricing.labourSections) || []).find((s) => s && s.id === id);
    return sec && Array.isArray(sec.rows) ? sec.rows : [];
  };
  const lineHours = (defs, line) => {
    const def = lineDef(defs, line, pricing);
    return def ? nonNeg(line.qty) * hoursPerUnitOf(def) : 0;
  };
  const lines = (key) => (Array.isArray(rows[key]) ? rows[key] : []).filter((l) => l && typeof l === 'object');

  const prodDefs = sectionRows('prod');
  const captures = (line) => {
    if (typeof line.capture === 'boolean') return line.capture;
    const row = (line.rowId && prodDefs.find((r) => r && r.id === line.rowId)) ||
      prodDefs.find((r) => r && r.name === line.name);
    return Boolean(row && row.capture === true);
  };
  let capture = 0;
  lines('prod').forEach((line) => {
    if (captures(line)) capture += lineHours(prodDefs, line);
  });
  const captureHours = round2(capture);

  const shares = lines('deliverables').map((d) => ({
    deliverableId: d.id ? String(d.id) : null,
    hours: d.typeId ? upToHalfHour(captureHours * nonNeg(d.multiplier) * nonNeg(d.qty)) : 0,
  }));
  const recommended = shares.reduce((sum, s) => sum + s.hours, 0);

  const postDefs = sectionRows('post');
  const onPostLines = round2(lines('post').reduce((sum, line) => sum + lineHours(postDefs, line), 0));

  return { captureHours, shares, recommended, onPostLines };
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
  /* Not Math.ceil(round2(…)): rounding to cents first turned 11.004 into
     11.00 and reported the target reached a job early. The small epsilon only
     absorbs float noise (an exact 11 computed as 11.000000000000002). */
  return Math.ceil(target / avg - 1e-9);
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
 * billableHoursPerDay long — a yearly planning average — not the card's
 * Service Day, which is what a day sold on a job is and which the Dashboard's
 * headline floors use (SERVICE UNITS in the header). An edit day is not sold
 * at all; it is capacity the shoot uses up. A month is
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
    lineDef,
    lineSnapshot,
    normaliseTaxYear,
    incomeTax,
    grossForNet,
    taxRatesAt,
    revenueTarget,
    incomeFloorPerHour,
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
    serviceFloorComparison,
    travelRowDef,
    travelFloorComparison,
    unitHours,
    serviceDayOk,
    suggestedPrice,
    unitDef,
    SERVICE_UNITS,
    PRICING_SHAPE,
    cardShapeOutdated,
    SURCHARGE_DEFAULTS,
    surchargeSettings,
    dayKind,
    afterHoursShare,
    surchargeFactor,
    surchargedLinePrice,
    surchargeAttribution,
    surchargeSnapshot,
    stampSurchargedPrices,
    costBreakdown,
    bookedHoursOf,
    postPlan,
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
    lineDef,
    lineSnapshot,
    normaliseTaxYear,
    incomeTax,
    grossForNet,
    taxRatesAt,
    revenueTarget,
    incomeFloorPerHour,
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
    serviceFloorComparison,
    travelRowDef,
    travelFloorComparison,
    unitHours,
    serviceDayOk,
    suggestedPrice,
    unitDef,
    SERVICE_UNITS,
    PRICING_SHAPE,
    cardShapeOutdated,
    SURCHARGE_DEFAULTS,
    surchargeSettings,
    dayKind,
    afterHoursShare,
    surchargeFactor,
    surchargedLinePrice,
    surchargeAttribution,
    surchargeSnapshot,
    stampSurchargedPrices,
    costBreakdown,
    bookedHoursOf,
    postPlan,
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
