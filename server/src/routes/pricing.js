'use strict';

const { nowIso } = require('../db');
const { DEFAULT_PRICING } = require('../defaults');
const { readPricing } = require('../ratecard');
const { SERVICE_UNITS, cardShapeOutdated } = require('../calc');

/** A service-day length: 0.5 to 24 hours, in half hours. */
const dayHoursOk = (v) => typeof v === 'number' && v >= 0.5 && v <= 24 && Number.isInteger(v * 2);

/**
 * The money-bearing fields of a rate card, checked before it is stored
 * (2026-09-28 audit — this route used to store any JSON). The screen checks
 * the same things; this is the rule, the screen the courtesy. The trap it
 * matters most for is units: taxSetAsideRate is a FRACTION, and a 35 stored
 * here would set aside 35× every job's income.
 *
 * pricing_shape_outdated (v9, .design/service-rate-tiers/). This route writes
 * the card as one whole document, so a browser still running the web build from
 * before v9 — a cached Pages copy, a tab left open over the deploy — would read
 * the new card, not understand it, and save the old shape back over it. Any
 * labour row carrying `mu`, `hoursPerUnit` or `dayUnit`, or lacking `prices`,
 * and any card without `serviceDay` (which no old build sends) — calc.js
 * cardShapeOutdated — is refused with this code, checked FIRST so an old
 * build always gets it and not some other complaint. The screen tells the user
 * to reload.
 * @returns {string|null} an error code, or null.
 */
function pricingProblem(body) {
  const nonNeg = (v) => v === undefined || v === null || v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0);
  const sections = Array.isArray(body.labourSections) ? body.labourSections : [];
  const labourRows = [];
  for (const sec of sections) {
    for (const r of (sec && Array.isArray(sec.rows)) ? sec.rows : []) labourRows.push(r);
  }

  if (cardShapeOutdated(body)) return 'pricing_shape_outdated';

  const { fullHours, halfHours } = body.serviceDay;
  if (!dayHoursOk(fullHours) || !dayHoursOk(halfHours)) return 'service_day_out_of_range';
  if (halfHours > fullHours) return 'service_day_half_over_full';

  if (body.taxSetAsideRate !== undefined) {
    const t = Number(body.taxSetAsideRate);
    if (!Number.isFinite(t) || t < 0 || t >= 1) return 'tax_set_aside_rate_not_a_fraction';
  }
  for (const r of labourRows) {
    for (const unit of SERVICE_UNITS) {
      if (!(unit in r.prices)) return 'labour_prices_incomplete';
      const p = r.prices[unit];
      // A number set by the user, or null for auto. A typed $0 is a price.
      if (p === null) continue;
      if (typeof p !== 'number' || !Number.isFinite(p)) return 'labour_price_not_a_number';
      if (p < 0) return 'labour_price_negative';
    }
    if (!nonNeg(r.rate)) return 'labour_price_negative';
  }
  for (const r of Array.isArray(body.travelRows) ? body.travelRows : []) {
    if (!nonNeg(r.mu) || !nonNeg(r.rate)) return 'travel_price_negative';
  }
  return null;
}

function registerPricingRoutes(app, db) {
  app.get('/api/pricing', (_req, res) => {
    const row = db.prepare('SELECT updated_at FROM pricing WHERE id = 1').get();
    res.json({ ok: true, pricing: readPricing(db), updatedAt: row ? row.updated_at : null });
  });

  // Whole-document write — this is the fix for the desktop app's fake
  // "Save Rates" button. The row is upserted rather than requiring a
  // separate seed step, so a fresh database just works on first save.
  app.put('/api/pricing', (req, res) => {
    const problem = pricingProblem(req.body || {});
    if (problem === 'pricing_shape_outdated') {
      // In words as well: the build this refuses knows no codes from after it
      // was built, and shows the server's message.
      return res.status(400).json({
        error: problem,
        message: 'This page is out of date — the rate card has changed shape since it was opened. ' +
          'Reload the page, then make your changes again.',
      });
    }
    if (problem) return res.status(400).json({ error: problem });
    const now = nowIso();
    const json = JSON.stringify(req.body || {});
    db.prepare(`
      INSERT INTO pricing (id, data_json, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).run(json, now);
    res.json({ ok: true, pricing: JSON.parse(json), updatedAt: now });
  });

  app.post('/api/pricing/reset', (_req, res) => {
    const now = nowIso();
    const json = JSON.stringify(DEFAULT_PRICING);
    db.prepare(`
      INSERT INTO pricing (id, data_json, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).run(json, now);
    res.json({ ok: true, pricing: DEFAULT_PRICING, updatedAt: now });
  });
}

module.exports = { registerPricingRoutes, pricingProblem };
