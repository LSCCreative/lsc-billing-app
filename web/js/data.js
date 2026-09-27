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
    const [pricingReply, settingsReply, itemsReply, snapshotsReply, goalsReply, assetsReply] =
      await Promise.all([
        LSCApi.get('/api/pricing'),
        LSCApi.get('/api/settings'),
        LSCApi.get('/api/overhead-items'),
        LSCApi.get('/api/overhead-snapshots'),
        LSCApi.get('/api/goals'),
        LSCApi.get('/api/depreciation-assets'),
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
      depreciationAssets !== null,
    pricing: () => pricing || {},
    settings: () => settings || {},
    overheadItems: () => overheadItems || [],
    overheadSnapshots: () => overheadSnapshots || [],
    goals: () => goals || {},
    depreciationAssets: () => depreciationAssets || [],
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
    // On sign-out, so the next sign-in reads the card fresh.
    clear: () => {
      pricing = null;
      settings = null;
      overheadItems = null;
      overheadSnapshots = null;
      goals = null;
      depreciationAssets = null;
      pricingSaved = false;
      settingsSaved = false;
      goalsSaved = false;
    },
  };
})();
