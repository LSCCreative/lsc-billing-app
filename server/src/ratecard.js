'use strict';

const { DEFAULT_PRICING, DEFAULT_SETTINGS } = require('./defaults');
const { PRICING_SHAPE, annualBusinessCost, annualBillableHours, overheadRatePerHour } = require('./calc');

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
  /* Every card this server serves is in its shape (calc.js PRICING_SHAPE),
     including one stored before the marker existed: it has been read by this
     server's rules since the deploy. The marker is what lets a newer build
     tell this server from an older one, and an older build from a newer one. */
  return row ? Object.assign(JSON.parse(row.data_json), { pricingShape: PRICING_SHAPE }) : DEFAULT_PRICING;
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

/**
 * The overhead rate per billable hour, from the database — the same
 * computation as the browser's LSCData.overheadRate(), so an estimate's stored
 * tax set-aside (which deducts the job's overhead share, calc.js "Take-home")
 * matches what the editor showed. null when overhead or capacity isn't set up.
 */
function readOverheadRate(db) {
  const items = db.prepare('SELECT * FROM overhead_items').all();
  const assets = db.prepare('SELECT * FROM depreciation_assets').all();
  const goals = db.prepare('SELECT * FROM goals WHERE id = 1').get() || {};
  return overheadRatePerHour(
    annualBusinessCost(items, assets),
    annualBillableHours({
      billableHoursPerDay: goals.billable_hours_per_day,
      workingDaysPerWeek: goals.working_days_per_week,
      leaveDaysPerYear: goals.leave_days_per_year,
      sickDaysPerYear: goals.sick_days_per_year,
    })
  );
}

/**
 * A negative quantity, day count, cost, custom bill or snapshotted price on
 * any line of an estimate — refused on save (2026-09-28 audit). calc.js
 * already prices one as nothing; refusing it too means the stored rows can
 * never say something the stored totals don't.
 * @returns {string|null} the first offending field, or null.
 */
function negativeLineField(activeRows) {
  const rows = activeRows || {};
  for (const key of Object.keys(rows)) {
    if (!Array.isArray(rows[key])) continue;
    for (const line of rows[key]) {
      for (const f of ['qty', 'override', 'days', 'cost', 'mu', 'rate', 'hoursPerUnit']) {
        if (line && line[f] !== undefined && line[f] !== null && line[f] !== '' && Number(line[f]) < 0) {
          return key + '.' + f;
        }
      }
    }
  }
  return null;
}

module.exports = {
  readPricing, readSettings, sectionLabelsFor, readOverheadRate, negativeLineField, RESERVED_SECTION_IDS,
};
