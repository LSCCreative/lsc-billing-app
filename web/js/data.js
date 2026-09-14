'use strict';

/* The rate card and settings, held in memory for the life of the session.
 *
 * The editor needs both on every keystroke — computeTotals looks a labour row's
 * markup up in the rate card and reads the GST configuration out of settings —
 * so they are fetched once when the app view opens rather than per estimate.
 *
 * They are cached rather than re-read because this is a single-user app: the
 * only thing that can change the rate card is the Pricing screen in this same
 * tab, which refreshes the cache when it saves.
 */

const LSCData = (() => {
  let pricing = null;
  let settings = null;

  /* Whether each has ever been written, taken from the reply's updatedAt.
     Emptiness cannot answer this: GET /api/pricing falls back to a complete
     DEFAULT_PRICING card, so a rate card nobody has saved looks exactly like
     one they have. What is actually absent until the first write is the row,
     and updatedAt is null for precisely that long. */
  let pricingSaved = false;
  let settingsSaved = false;

  async function load() {
    // Both are needed before an estimate can be priced, and neither depends on
    // the other, so the round-trips overlap.
    const [pricingReply, settingsReply] = await Promise.all([
      LSCApi.get('/api/pricing'),
      LSCApi.get('/api/settings'),
    ]);
    pricing = pricingReply.pricing || {};
    settings = settingsReply.settings || {};
    pricingSaved = Boolean(pricingReply.updatedAt);
    settingsSaved = Boolean(settingsReply.updatedAt);
  }

  return {
    load,
    loaded: () => pricing !== null && settings !== null,
    pricing: () => pricing || {},
    settings: () => settings || {},
    /* For the first-run setup checklist on the estimates empty state. */
    pricingConfigured: () => pricingSaved,
    settingsConfigured: () => settingsSaved,
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
    // On sign-out, so the next sign-in reads the card fresh.
    clear: () => {
      pricing = null;
      settings = null;
      pricingSaved = false;
      settingsSaved = false;
    },
  };
})();
