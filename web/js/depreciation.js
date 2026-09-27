'use strict';

/**
 * The ATO depreciation chain. Pure — no database, no DOM — so the schedule the
 * screen draws, the CSV the accountant gets and the figures frozen at lodgement
 * are all the same arithmetic.
 *
 * Sibling of calc.js and subject to the same rule: web/js/depreciation.js is a
 * byte-identical copy, and test/test-depreciation.js fails if the two drift. It
 * depends on calc.js (round2, numOrNull, field, businessUseShare) and the
 * browser loads calc.js first.
 *
 * WHY THIS IS SEPARATE FROM THE REPLACEMENT RESERVE
 * calc.js's replacementReserveTotal() and this file both describe the same
 * camera and are MEANT TO DISAGREE. The reserve asks "what should a day rate
 * recover so the next body is affordable" — replacement cost, straight-line over
 * the owner's own cycle. This file asks "what may be deducted this financial
 * year" — historical cost base, the ATO's method and effective life. Using one
 * for the other is the mistake this split exists to prevent: tax depreciation
 * would swing a day rate 30–40% year to year for gear still in daily use, and
 * the reserve is not deductible.
 *
 * THE FIVE-STEP ORDER, AND THE STEP EVERYONE GETS WRONG
 *
 *   1. costBase   = cost_inc_gst − (gst_credit_claimed ? gst_amount : 0)
 *   2. costBase   = min(costBase, car_limit)            // vehicles only
 *   3. decline    = method-specific, pro-rata daysHeld ÷ 365
 *   4. deductible = decline × businessUseShare          // apportion the DEDUCTION
 *   5. adjustable = adjustable − decline                // the FULL decline
 *
 * STEPS 4 AND 5 MUST NOT BE MERGED. The deduction is apportioned for business
 * use; the asset's adjustable value is not — it declines by the full amount
 * regardless of how the asset was used. Apportioning both is the common error and
 * it overstates the closing value of every part-personal asset for the rest of
 * its life, which then overstates every later year's decline and the balancing
 * adjustment on disposal. A test asserts the two diverge; if it fails because
 * someone "simplified" them into one line, that is the test working.
 *
 * FOUR THINGS THAT LOOK LIKE BUGS AND ARE NOT
 *
 *   - `daysHeld` RUNS FROM start_date, NOT purchase_date. ATO "start time" is
 *     when the asset was first used or installed ready for use. A camera bought
 *     in June and first used in July belongs to the NEXT financial year. Two
 *     separate date columns exist for exactly this.
 *
 *   - THE DIVISOR IS ALWAYS 365, EVEN IN A LEAP YEAR, while daysHeld is the
 *     real number of days. So an asset held through a leap financial year gets
 *     366 ÷ 365, slightly over a full year's decline. That is the published
 *     formula, not an off-by-one: matching the ATO matters more than matching
 *     the calendar, and correcting it would put the app's figures out of step
 *     with the accountant's.
 *
 *   - DIMINISHING VALUE USES THE OPENING ADJUSTABLE VALUE AS ITS BASE, PRIME
 *     COST USES THE COST BASE. That is why a schedule cannot be computed for one
 *     financial year in isolation: year three's decline depends on year two's
 *     closing value, so every function here walks forward from the asset's first
 *     year. It is not a loop that could be replaced with a formula.
 *
 *   - POOLS APPORTION ON THE WAY IN, NOT ON THE DECLINE. A pooled asset
 *     contributes costBase × businessUseShare to the pool balance, and the whole
 *     pool decline is then deductible. Individual assets do the opposite
 *     (step 4). Pools also take a reduced FIRST-YEAR RATE INSTEAD OF DAY-COUNT
 *     PRO-RATA — 15% then 30% for the small business pool, 18.75% then 37.5% for
 *     a low-value pool — so nothing here divides a pool by days.
 *
 * Cents throughout, via calc.js's round2, and never pre-rounded to whole
 * dollars. The ATO permits whole dollars on a return; rounding twice is how
 * totals stop reconciling with the CSV.
 */

/* WRAPPED IN AN IIFE, AND IT HAS TO BE. In the browser this and calc.js are
 * plain <script> tags sharing one global scope, so a top-level
 * `const { round2 } = ...` here collides with calc.js's top-level
 * `function round2` and the whole file dies with "Identifier 'round2' has
 * already been declared" — a SyntaxError that takes the page with it.
 *
 * Node cannot show you this: there each file is a module with its own scope, so
 * the entire test suite passes while the live site is broken. It was caught by
 * loading both copies into one shared vm context, which is what the browser
 * actually does. Don't unwrap this, and if you add a third sibling, wrap that
 * too. */
(function () {
  'use strict';

  const {
    round2,
    numOrNull,
    field,
    businessUseShare,
    fyLabel,
    fyBounds,
  } = (typeof module === 'object' && module.exports)
    ? require('./calc')
    : globalThis.LSCCalc;

  /**
   * 200%, for assets held from 10 May 2006. Named, with the date, because the
   * pre-2006 factor was 150% and a reader who half-remembers that will "correct"
   * this. Everything this business owns qualifies.
   */
  const DIMINISHING_VALUE_FACTOR = 2.0;

  /** 100% — prime cost writes the cost base off evenly over the effective life. */
  const PRIME_COST_FACTOR = 1.0;

  /** Always 365. See "four things that look like bugs" in the header. */
  const DAYS_IN_YEAR_DIVISOR = 365;

  /**
   * Pool rates. The first-year rate is half the ongoing one and replaces
   * day-count pro-rata — an asset pooled on 29 June gets the same 15% as one
   * pooled the previous July.
   */
  const POOL_RATES = {
    small_business_pool: { firstYear: 0.15, thereafter: 0.30 },
    low_value_pool: { firstYear: 0.1875, thereafter: 0.375 },
  };

  const POOLED_METHODS = Object.keys(POOL_RATES);

  /** True for the two methods whose decline belongs to a pool, not an asset. */
  function isPooledMethod(method) {
    return Object.prototype.hasOwnProperty.call(POOL_RATES, method);
  }

  function methodOf(asset) {
    return field(asset, 'method', 'method');
  }

  function startDateOf(asset) {
    return field(asset, 'startDate', 'start_date');
  }

  function disposalDateOf(asset) {
    const d = field(asset, 'disposalDate', 'disposal_date');
    return d === undefined || d === '' ? null : d;
  }

  /**
   * A date-only string as a whole number of days since the epoch.
   *
   * Parsed textually and assembled in UTC, so no local timezone or DST offset can
   * shift a date across a financial-year boundary — the same reasoning as
   * calc.js's fyStartYear, and it matters more here because a one-day error moves
   * a deduction between tax returns.
   */
  function epochDay(dateStr) {
    if (typeof dateStr !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(ms) ? null : Math.round(ms / 86400000);
  }

  /** Inclusive day count between two date-only strings; both ends count. */
  function daysInclusive(fromStr, toStr) {
    const from = epochDay(fromStr);
    const to = epochDay(toStr);
    if (from === null || to === null) return 0;
    return to < from ? 0 : to - from + 1;
  }

  /**
   * Step 1 and step 2: the cost base.
   *
   * GST comes off only when the credit was actually claimed, which is why the flag
   * is per asset rather than read from settings.gst — registration status changes
   * over time, and an asset's cost base is fixed at acquisition. A camera bought
   * while unregistered keeps its GST in the cost base forever.
   *
   * The car limit caps vehicles only, and is user-entered per asset because the
   * limit that applies is the one in force for the year the car was first used.
   */
  function costBaseOf(asset) {
    const cost = numOrNull(field(asset, 'costIncGst', 'cost_inc_gst'));
    if (cost === null || cost <= 0) return 0;

    const claimed = field(asset, 'gstCreditClaimed', 'gst_credit_claimed');
    const gstAmount = numOrNull(field(asset, 'gstAmount', 'gst_amount')) || 0;
    let base = (claimed === 1 || claimed === true) ? cost - gstAmount : cost;
    if (base < 0) base = 0;

    const category = field(asset, 'category', 'category');
    if (category === 'vehicle') {
      const limit = numOrNull(field(asset, 'carLimit', 'car_limit'));
      if (limit !== null && limit > 0 && base > limit) base = limit;
    }

    return base;
  }

  /** The FY token an asset's depreciation starts in — from start_date. */
  function firstFyOf(asset) {
    return fyLabel(startDateOf(asset));
  }

  /**
   * Days the asset was held inside one financial year.
   *
   * Starts at start_date or the FY's own start, whichever is later; ends at the
   * FY's end or disposal_date, whichever is earlier. Zero when the asset was not
   * held in that year at all, which is what makes a disposed asset drop off later
   * schedules without a special case.
   */
  function daysHeldInFy(asset, bounds) {
    const start = startDateOf(asset);
    const startDay = epochDay(start);
    if (startDay === null || !bounds) return 0;

    const from = startDay > epochDay(bounds.start) ? start : bounds.start;

    const disposal = disposalDateOf(asset);
    const disposalDay = disposal === null ? null : epochDay(disposal);
    const to = (disposalDay !== null && disposalDay < epochDay(bounds.end)) ? disposal : bounds.end;

    return daysInclusive(from, to);
  }

  /**
   * One financial year's step 3 for an individual asset.
   *
   * @param baseValue — the opening adjustable value (diminishing value reads this;
   *   prime cost ignores it and uses the cost base, which is why both are passed).
   * @returns the decline before any business-use apportionment, capped at the
   *   remaining adjustable value so an asset can never depreciate below zero or
   *   past its own cost.
   */
  function declineForYear(asset, { baseValue, costBase, daysHeld, isFirstFy }) {
    const method = methodOf(asset);
    if (baseValue <= 0 || daysHeld <= 0) return 0;

    let decline;

    if (method === 'instant_writeoff') {
      /* The whole cost base in the first year and nothing afterwards. No day
         pro-rata: an instant write-off is not a rate. */
      decline = isFirstFy ? baseValue : 0;
    } else {
      const life = numOrNull(field(asset, 'effectiveLifeYears', 'effective_life_years'));
      /* No effective life means the rate cannot be computed. Zero rather than a
         guessed life: a wrong life is a wrong deduction that still looks right,
         and the form requires this field precisely so it is never guessed here. */
      if (life === null || life <= 0) return 0;

      const proRata = daysHeld / DAYS_IN_YEAR_DIVISOR;

      if (method === 'diminishing_value') {
        decline = baseValue * proRata * (DIMINISHING_VALUE_FACTOR / life);
      } else if (method === 'prime_cost') {
        decline = costBase * proRata * (PRIME_COST_FACTOR / life);
      } else {
        /* Pooled methods have no per-asset decline — see the header. Anything else
           is not a method this file knows, and the schema CHECK makes it
           unreachable for a stored row. */
        return 0;
      }
    }

    return decline > baseValue ? baseValue : decline;
  }

  /**
   * The full year-by-year schedule for one asset, from its first financial year up
   * to and including the one asked for.
   *
   * It walks rather than jumps because diminishing value compounds: year three's
   * base is year two's closing value. That also means this is the only honest way
   * to answer "what is the adjustable value now" — there is no closed form once a
   * mid-year start date and a possible disposal are involved.
   *
   * @returns {Array<object>} one row per FY. Empty when the asset has no usable
   *   start date or the FY is before it was held.
   */
  function assetScheduleRows(asset, upToFyLabel) {
    const target = fyBounds(upToFyLabel);
    const firstFy = firstFyOf(asset);
    if (!target || !firstFy) return [];

    const firstBounds = fyBounds(firstFy);
    if (firstBounds.startYear > target.startYear) return [];

    const costBase = costBaseOf(asset);
    const share = businessUseShare(asset);

    /* An opening adjustable value is for gear that was already part-depreciated
       when it was entered, so a three-year-old camera does not restart at full
       value. Absent, the asset starts at its cost base. */
    const openingOverride = numOrNull(
      field(asset, 'openingAdjustableValue', 'opening_adjustable_value')
    );

    const rows = [];
    let opening = openingOverride === null ? costBase : openingOverride;

    for (let year = firstBounds.startYear; year <= target.startYear; year += 1) {
      const bounds = fyBounds(`FY${year}-${String((year + 1) % 100).padStart(2, '0')}`);
      const daysHeld = daysHeldInFy(asset, bounds);
      const isFirstFy = year === firstBounds.startYear;

      const decline = declineForYear(asset, {
        baseValue: opening, costBase, daysHeld, isFirstFy,
      });

      // Steps 4 and 5. They diverge on purpose — see the header.
      const deductible = decline * share;
      const closing = opening - decline;

      const disposal = disposalDateOf(asset);
      const disposedThisFy = disposal !== null
        && epochDay(disposal) >= epochDay(bounds.start)
        && epochDay(disposal) <= epochDay(bounds.end);

      rows.push({
        fy: bounds.label,
        daysHeld,
        openingAdjustableValue: round2(opening),
        decline: round2(decline),
        deductible: round2(deductible),
        closingAdjustableValue: round2(closing),
        disposed: disposedThisFy,
        /* Belongs to the disposal year only. Proceeds are compared against the
           adjustable value AFTER that year's decline, then apportioned — the same
           business-use share, because only the business part was ever deducted. */
        balancingAdjustment: disposedThisFy
          ? round2(((numOrNull(field(asset, 'disposalProceeds', 'disposal_proceeds')) || 0) - closing) * share)
          : null,
      });

      opening = closing;

      // Once sold, there are no further years to report.
      if (disposedThisFy) break;
    }

    return rows;
  }

  /**
   * One financial year's row for an asset, or null when it was not held then.
   * The row a schedule screen renders.
   */
  function assetSchedule(asset, forFyLabel) {
    const bounds = fyBounds(forFyLabel);
    if (!bounds) return null;
    const rows = assetScheduleRows(asset, forFyLabel);
    const row = rows.length ? rows[rows.length - 1] : null;
    return row && row.fy === bounds.label ? row : null;
  }

  /**
   * The decline in value for one asset in one financial year.
   *
   * "Decline in value" is the ATO's term and the column heading, deliberately not
   * "depreciation" — which in this app would be ambiguous next to the replacement
   * reserve — and not "book value" or "sale" either. The glossary in the IA doc is
   * the contract for these words.
   *
   * @returns {number} 0 when the asset was not held in that year, or is pooled.
   */
  function declineInValue(asset, forFyLabel) {
    const row = assetSchedule(asset, forFyLabel);
    return row ? row.decline : 0;
  }

  /**
   * The balancing adjustment on disposal: (proceeds − adjustable value) × share.
   *
   * Positive is assessable income, negative is a deduction, and it belongs to the
   * financial year of disposal — not the year the money arrived, if those differ.
   *
   * @returns {{fy:string, amount:number, adjustableValue:number}|null} null when
   *   the asset has not been disposed of.
   */
  function balancingAdjustment(asset) {
    const disposal = disposalDateOf(asset);
    if (disposal === null) return null;

    const fy = fyLabel(disposal);
    if (!fy) return null;

    const row = assetSchedule(asset, fy);
    if (!row) return null;

    return {
      fy,
      amount: row.balancingAdjustment,
      adjustableValue: row.closingAdjustableValue,
    };
  }

  /**
   * A pool's year-by-year balance, up to and including the financial year asked
   * for.
   *
   * Pool arithmetic, which is not asset arithmetic:
   *
   *   decline = openingBalance × thereafterRate + additions × firstYearRate
   *   closing = openingBalance + additions − decline
   *
   * Additions enter at costBase × businessUseShare, so the whole decline is then
   * deductible — the opposite of step 4 for an individual asset. And the reduced
   * first-year rate replaces day-count pro-rata entirely, so an asset pooled on
   * 29 June is treated the same as one pooled the previous July.
   *
   * A pooled asset that is disposed of has its proceeds' business share removed
   * from the closing balance in the disposal year; pools have no per-asset
   * balancing adjustment, because the pool has no per-asset adjustable value to
   * compare proceeds against.
   */
  function poolScheduleRows(assets, poolMethod, upToFyLabel) {
    const target = fyBounds(upToFyLabel);
    const rates = POOL_RATES[poolMethod];
    if (!target || !rates) return [];

    const pooled = (Array.isArray(assets) ? assets : [])
      .filter((a) => methodOf(a) === poolMethod)
      .map((a) => ({ asset: a, fy: firstFyOf(a) }))
      .filter((e) => e.fy !== null);

    if (pooled.length === 0) return [];

    const startYears = pooled.map((e) => fyBounds(e.fy).startYear);
    const firstYear = Math.min(...startYears);
    if (firstYear > target.startYear) return [];

    const rows = [];
    let opening = 0;

    for (let year = firstYear; year <= target.startYear; year += 1) {
      const label = `FY${year}-${String((year + 1) % 100).padStart(2, '0')}`;

      let additions = 0;
      for (const entry of pooled) {
        if (fyBounds(entry.fy).startYear === year) {
          additions += costBaseOf(entry.asset) * businessUseShare(entry.asset);
        }
      }

      let decline = opening * rates.thereafter + additions * rates.firstYear;
      const available = opening + additions;
      if (decline > available) decline = available;

      let disposals = 0;
      for (const entry of pooled) {
        const disposal = disposalDateOf(entry.asset);
        if (disposal !== null && fyLabel(disposal) === label) {
          disposals += (numOrNull(field(entry.asset, 'disposalProceeds', 'disposal_proceeds')) || 0)
            * businessUseShare(entry.asset);
        }
      }

      let closing = available - decline - disposals;
      if (closing < 0) closing = 0;

      rows.push({
        fy: label,
        pool: poolMethod,
        openingBalance: round2(opening),
        additions: round2(additions),
        /* Pool decline is deductible in full: the business-use share was applied
           to the additions on the way in, so applying it again here would halve a
           50%-business asset's deduction twice. */
        decline: round2(decline),
        deductible: round2(decline),
        disposalProceeds: round2(disposals),
        closingBalance: round2(closing),
        /* Deliberately no single "rate applied" field: in a year with both an
           opening balance and additions, BOTH rates apply, and one label would be
           wrong on a screen the accountant reads. The two rates are in POOL_RATES
           if a view wants to show them. */
      });

      opening = closing;
    }

    return rows;
  }

  /**
   * One financial year's row for each pool that has anything in it.
   * @returns {Array<object>} at most one row per pool; empty when nothing pooled.
   */
  function poolSchedule(assets, forFyLabel) {
    const bounds = fyBounds(forFyLabel);
    if (!bounds) return [];

    const out = [];
    for (const method of POOLED_METHODS) {
      const rows = poolScheduleRows(assets, method, forFyLabel);
      const row = rows.length ? rows[rows.length - 1] : null;
      if (row && row.fy === bounds.label) out.push(row);
    }
    return out;
  }

  /**
   * Everything a schedule screen or the CSV needs for one financial year:
   * individual asset rows, pool rows, and the totals that must reconcile.
   *
   * Computed on read, never stored, so it cannot drift from the assets it
   * describes. The only frozen copy is the lodgement snapshot, which exists to be
   * compared against this — not to replace it.
   */
  function financialYearSchedule(assets, forFyLabel) {
    const bounds = fyBounds(forFyLabel);
    if (!bounds) return null;

    const list = Array.isArray(assets) ? assets : [];

    const assetRows = [];
    for (const asset of list) {
      if (isPooledMethod(methodOf(asset))) continue;
      const row = assetSchedule(asset, forFyLabel);
      if (row) assetRows.push({ ...row, assetId: field(asset, 'id', 'id'), name: field(asset, 'name', 'name') });
    }

    const poolRows = poolSchedule(list, forFyLabel);

    let totalDeductible = 0;
    for (const r of assetRows) totalDeductible += r.deductible;
    for (const r of poolRows) totalDeductible += r.deductible;

    let totalBalancing = 0;
    for (const r of assetRows) if (r.balancingAdjustment !== null) totalBalancing += r.balancingAdjustment;

    return {
      fy: bounds.label,
      assets: assetRows,
      pools: poolRows,
      totalDeductible: round2(totalDeductible),
      totalBalancingAdjustment: round2(totalBalancing),
    };
  }

  /* Two copies, one source, same rule as calc.js: web/js/depreciation.js is
   * byte-identical and test/test-depreciation.js fails if they drift. */
  if (typeof module === 'object' && module.exports) {
    module.exports = {
      costBaseOf,
      daysHeldInFy,
      declineInValue,
      assetSchedule,
      assetScheduleRows,
      balancingAdjustment,
      poolSchedule,
      poolScheduleRows,
      financialYearSchedule,
      isPooledMethod,
      epochDay,
      daysInclusive,
      DIMINISHING_VALUE_FACTOR,
      PRIME_COST_FACTOR,
      DAYS_IN_YEAR_DIVISOR,
      POOL_RATES,
    };
  } else {
    globalThis.LSCDepreciation = {
      costBaseOf,
      daysHeldInFy,
      declineInValue,
      assetSchedule,
      assetScheduleRows,
      balancingAdjustment,
      poolSchedule,
      poolScheduleRows,
      financialYearSchedule,
      isPooledMethod,
      epochDay,
      daysInclusive,
      DIMINISHING_VALUE_FACTOR,
      PRIME_COST_FACTOR,
      DAYS_IN_YEAR_DIVISOR,
      POOL_RATES,
    };
  }
}());
