'use strict';

const { DEFAULT_PRICING, DEFAULT_SETTINGS } = require('./defaults');

/**
 * Reading the rate card and settings, with the fallback every caller must
 * agree on.
 *
 * A fresh database has no pricing or settings row — those tables stay empty
 * until the Pricing screen and the Invoice Settings modal write to them. What
 * the app should use in the meantime is DEFAULT_PRICING / DEFAULT_SETTINGS,
 * which is what GET /api/pricing and GET /api/settings have always answered.
 *
 * The estimate and PDF routes had their own copies of this lookup that fell
 * back to `{}` instead. An empty rate card is not "no opinion", it is "every
 * labour and travel line prices at zero": computeTotals iterates
 * `pricing.labourSections` and skips any row it can't find there. So on a
 * database nobody had saved pricing to yet, the editor showed the real figures
 * (it reads GET /api/pricing) while the server stored an estimate with its
 * labour and travel silently dropped, and the PDF printed that same wrong
 * total. Only crew and equipment, which carry their own costs and need no rate
 * card, came through intact.
 *
 * One implementation, so the question is answered the same way everywhere.
 */
function readPricing(db) {
  const row = db.prepare('SELECT data_json FROM pricing WHERE id = 1').get();
  return row ? JSON.parse(row.data_json) : DEFAULT_PRICING;
}

function readSettings(db) {
  const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get();
  return row ? JSON.parse(row.data_json) : DEFAULT_SETTINGS;
}

/** activeRows keys that are not labour categories. */
const RESERVED_SECTION_IDS = { travel: 1, equip: 1, crew: 1, deliverables: 1 };

/**
 * The labour category labels to store on an estimate being saved.
 *
 * The label is printed as a heading on the client-facing PDF, so it is part of
 * the document rather than a view of the current rate card — the same argument
 * that snapshots the client's details. Without this, renaming a category
 * re-headed every quote already sent under the old name.
 *
 * The live card wins for a category that still exists, because saving an
 * estimate is re-quoting it: the client fields are re-snapshotted from the form
 * on the same save, and the headings should agree with them. `existing` is kept
 * only for categories the card no longer has, so editing an old estimate after
 * its category was deleted doesn't discard the last record of what it was
 * called.
 */
function sectionLabelsFor(activeRows, pricing, existing) {
  const live = (pricing && pricing.labourSections) || [];
  const byId = new Map(live.map((s) => [s.id, s.label]));
  const out = {};

  Object.keys(activeRows || {}).forEach((id) => {
    if (RESERVED_SECTION_IDS[id]) return;
    const rows = activeRows[id];
    if (!Array.isArray(rows) || rows.length === 0) return;
    const label = byId.has(id) ? byId.get(id) : (existing || {})[id];
    if (label) out[id] = label;
  });

  return out;
}

module.exports = { readPricing, readSettings, sectionLabelsFor, RESERVED_SECTION_IDS };
