'use strict';

/* The rate card, settings, overhead, goals and depreciation assets, held in memory for the life of
 * the session.
 *
 * The editor needs the first two on every keystroke — computeTotals looks a
 * labour row's markup up in the rate card and reads the GST configuration out
 * of settings — so they are fetched once when the app view opens rather than
 * per estimate.
 *
 * Overhead and Goals joined that same preload rather than loading with their
 * own screens, because they stopped being only their own screens' data: the
 * Pricing rate column is computed from them, and so is the estimate editor's
 * Minimum Job Price line. Fetching them later would mean both of those screens
 * painting an em dash first and a number a moment after, which reads as a bug
 * on a figure that is supposed to be authoritative. One preload gate for all
 * of them, not a second Finance-shaped loading state.
 *
 * Depreciation assets joined for the same reason: each non-disposed asset's
 * replacement reserve is part of annualBusinessCost(), which is what the
 * overhead rate is now divided out of. An asset list that arrived late would
 * price the first estimate opened without its gear.
 *
 * They are cached rather than re-read because this is a single-user app: the
 * only thing that can change any of them is a screen in this same tab, which
 * refreshes the cache when it saves.
 */

const LSCData = (() => {
  let pricing = null;
  let settings = null;
  let overheadItems = null;
  let overheadSnapshots = null;
  let goals = null;
  let depreciationAssets = null;
  let taxYears = null;

  /* Whether each has ever been written, taken from the reply's updatedAt.
     Emptiness cannot answer this: GET /api/pricing falls back to a complete
     DEFAULT_PRICING card, so a rate card nobody has saved looks exactly like
     one they have. What is actually absent until the first write is the row,
     and updatedAt is null for precisely that long. */
  let pricingSaved = false;
  let settingsSaved = false;
  let goalsSaved = false;

  async function load() {
    // All six are needed before an estimate can be priced, and none depends on
    // another, so the round-trips overlap.
    const [pricingReply, settingsReply, itemsReply, snapshotsReply, goalsReply, assetsReply, taxReply] =
      await Promise.all([
        LSCApi.get('/api/pricing'),
        LSCApi.get('/api/settings'),
        LSCApi.get('/api/overhead-items'),
        LSCApi.get('/api/overhead-snapshots'),
        LSCApi.get('/api/goals'),
        LSCApi.get('/api/depreciation-assets'),
        LSCApi.get('/api/tax-years'),
      ]);
    pricing = pricingReply.pricing || {};
    settings = settingsReply.settings || {};
    /* [] rather than null on a missing key: an account with no expenses yet has
       an empty list, and the screens are written against a list. null here
       would mean "never loaded", which is what loaded() below is asking. */
    overheadItems = itemsReply.items || [];
    overheadSnapshots = snapshotsReply.snapshots || [];
    /* An unsaved goals singleton comes back as three nulls, not defaults —
       there is no non-arbitrary income or capacity to guess, so the screens
       render empty fields and the calc functions return null rather than a
       figure nobody chose. Keep the reply's nulls; don't substitute zeros. */
    goals = goalsReply.goals || {};
    /* Disposed assets included: the route returns the whole register, and the
       calc functions are what exclude sold gear from the reserve — filtering
       here would drop it from the disposal year's tax schedule too. */
    depreciationAssets = assetsReply.assets || [];
    /* The user's own tax years (migration v7). The revenue target and the
       income floor need one; none saved is the em-dash set-up state. */
    taxYears = taxReply.taxYears || [];
    pricingSaved = Boolean(pricingReply.updatedAt);
    settingsSaved = Boolean(settingsReply.updatedAt);
    goalsSaved = Boolean(goalsReply.updatedAt);
  }

  return {
    load,
    loaded: () =>
      pricing !== null &&
      settings !== null &&
      overheadItems !== null &&
      overheadSnapshots !== null &&
      goals !== null &&
      depreciationAssets !== null &&
      taxYears !== null,
    pricing: () => pricing || {},
    settings: () => settings || {},
    overheadItems: () => overheadItems || [],
    overheadSnapshots: () => overheadSnapshots || [],
    goals: () => goals || {},
    depreciationAssets: () => depreciationAssets || [],
    taxYears: () => taxYears || [],
    /* The tax year planning figures use: the current FY's when the user has
       saved it, otherwise the latest saved year before it — last year's scale
       is a closer guess than none, and the screens name which year is in use.
       null when nothing usable is saved. */
    taxYearInUse: () => {
      const current = LSCCalc.currentFinancialYear();
      const start = (fy) => (LSCCalc.fyBounds(fy) || { startYear: -1 }).startYear;
      const usable = (taxYears || [])
        .filter((t) => start(t.fy) <= start(current))
        .sort((a, b) => start(b.fy) - start(a.fy));
      return usable.length ? usable[0] : null;
    },
    /* DERIVED, NOT CACHED — the one place any screen asks what the business
       costs a year and what an hour of it costs. The Rate Card's rate column,
       the estimate editor's Minimum Job Price, the Capacity save confirm and
       the Dashboard all read these, so they cannot disagree about a number the
       user can see on two screens at once. Computed on every call from the
       cache above, so a save that refreshes the cache moves them immediately.

       Business cost, not operating cost: annualBusinessCost() adds the gear
       replacement reserve to the overhead items (calc.js explains why that is
       the right divisor). The Overhead screen's own "Annual Total" stays
       operating-only, because that screen is the operating-costs register. */
    businessCost: () => LSCCalc.annualBusinessCost(overheadItems || [], depreciationAssets || []),
    overheadRate: () =>
      LSCCalc.overheadRatePerHour(
        LSCCalc.annualBusinessCost(overheadItems || [], depreciationAssets || []),
        LSCCalc.annualBillableHours(goals || {})
      ),
    /* The revenue target's parts (calc.js revenueTarget) and the INCOME floor
       per billable hour — what the rate card is measured against since
       2026-09-28. Derived here for the same reason as overheadRate: the
       Dashboard, the Rate Card, Profit Goals and the estimate editor must not
       disagree about them. */
    revenueTarget: () => {
      const g = goals || {};
      return LSCCalc.revenueTarget(
        LSCCalc.annualBusinessCost(overheadItems || [], depreciationAssets || []),
        g.desiredNetIncome,
        LSCData.taxYearInUse(),
        { superPct: g.superPct, badDebtPct: g.badDebtPct }
      );
    },
    incomeFloor: () => {
      const r = LSCData.revenueTarget();
      return LSCCalc.incomeFloorPerHour(r && r.total, LSCCalc.annualBillableHours(goals || {}));
    },
    /* What stops the income floor — and so every auto price — in the order
       the arithmetic needs it, each with the Finance & Price tab that sets it
       (`tab` for FinanceView's selectTab, `screen` to name it, `what` for a
       sentence). Empty when there is a floor. One list, so the Dashboard's
       "Set up … to see your floors" and every auto price's "needs …" name the
       same screen: missing billable hours are Capacity's, not Profit Goals'
       (service-rate-tiers R7, 2026-09-29). */
    floorBlockers: () => {
      const g = goals || {};
      const out = [];
      if (!(LSCCalc.annualBillableHours(g) > 0)) {
        out.push({ tab: 'capacity', screen: 'Capacity', what: 'your capacity' });
      }
      if (!(LSCData.businessCost() > 0)) {
        out.push({ tab: 'overhead', screen: 'Overhead', what: 'what the business costs to run' });
      }
      const net = parseFloat(g.desiredNetIncome);
      if (!Number.isFinite(net) || net < 0) out.push({ tab: 'goals', screen: 'Profit Goals', what: 'the income you want' });
      if (!LSCData.taxYearInUse()) out.push({ tab: 'goals', screen: 'Profit Goals', what: 'your income tax scale' });
      return out;
    },
    /* The one screen an auto price with no figure sends you to: the first
       floor blocker, else Profit Goals, which holds Target Markup (the other
       thing an auto price needs) and the rest of the floor's inputs. */
    autoPriceBlocker: () => LSCData.floorBlockers()[0] || { tab: 'goals', screen: 'Profit Goals', what: 'your Profit Goals' },
    /* What an auto price on the rate card is worked out from (calc.js unitDef,
       .design/service-rate-tiers/): the income floor, Target Markup — a
       PERCENT, stored in a column that predates the rename — and the GST
       settings, which decide whether the price carries GST inside it. One
       builder, so the Rate Card, the estimator's unit picker and the Dashboard
       can't resolve the same auto price two ways. */
    priceContext: () => ({
      floorPerHour: LSCData.incomeFloor(),
      markupPct: (goals || {}).targetProfitMarginPct,
      settings: settings || {},
      // The car's running cost per km, from Overhead (task 6b): a km travel
      // row's price (calc.js travelRowDef).
      vehicleCostPerKm: (goals || {}).vehicleCostPerKm,
    }),
    /* For the first-run setup checklist on the estimates empty state. */
    pricingConfigured: () => pricingSaved,
    settingsConfigured: () => settingsSaved,
    goalsConfigured: () => goalsSaved,
    /* Called by the Pricing screen after a successful save, so an estimate
       opened afterwards prices against the new card without a page reload.
       Reaching here at all means a write landed, which is what makes it the
       right place to record that one has. */
    setPricing: (next) => {
      pricing = next || {};
      pricingSaved = true;
    },
    setSettings: (next) => {
      settings = next || {};
      settingsSaved = true;
    },
    /* The Overhead screen's writes, for the same reason: a rate computed from
       this cache has to move the moment an expense is added, or the Pricing tab
       one click away still shows the old number. Snapshots are set alongside
       items because the server appends one to every overhead write — the two
       are one update, not two. */
    setOverheadItems: (next) => {
      overheadItems = next || [];
    },
    setOverheadSnapshots: (next) => {
      overheadSnapshots = next || [];
    },
    setGoals: (next) => {
      goals = next || {};
      goalsSaved = true;
    },
    /* The asset register's writes. Every asset write also appends an overhead
       snapshot server-side, so the register refreshes snapshots alongside this
       exactly as the Overhead screen does for its items. */
    setDepreciationAssets: (next) => {
      depreciationAssets = next || [];
    },
    /* Profit Goals' tax-year save: replaces that FY's entry in the cache. */
    setTaxYear: (ty) => {
      taxYears = (taxYears || []).filter((t) => t.fy !== ty.fy).concat([ty]);
    },
    // On sign-out, so the next sign-in reads the card fresh.
    clear: () => {
      pricing = null;
      settings = null;
      overheadItems = null;
      overheadSnapshots = null;
      goals = null;
      depreciationAssets = null;
      taxYears = null;
      pricingSaved = false;
      settingsSaved = false;
      goalsSaved = false;
    },
  };
})();
