'use strict';

const { nowIso } = require('../db');
const { DEFAULT_PRICING } = require('../defaults');
const { readPricing } = require('../ratecard');

/**
 * The money-bearing fields of a rate card, checked before it is stored
 * (2026-09-28 audit — this route used to store any JSON). The screen checks
 * the same things; this is the rule, the screen the courtesy. The trap it
 * matters most for is units: taxSetAsideRate is a FRACTION, and a 35 stored
 * here would set aside 35× every job's income.
 * @returns {string|null} an error code, or null.
 */
function pricingProblem(body) {
  const nonNeg = (v) => v === undefined || v === null || v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0);
  if (body.taxSetAsideRate !== undefined) {
    const t = Number(body.taxSetAsideRate);
    if (!Number.isFinite(t) || t < 0 || t >= 1) return 'tax_set_aside_rate_not_a_fraction';
  }
  for (const sec of Array.isArray(body.labourSections) ? body.labourSections : []) {
    for (const r of (sec && Array.isArray(sec.rows)) ? sec.rows : []) {
      if (!nonNeg(r.mu) || !nonNeg(r.rate)) return 'labour_price_negative';
      if (r.hoursPerUnit !== undefined) {
        const h = Number(r.hoursPerUnit);
        if (!Number.isFinite(h) || h <= 0 || h > 24) return 'hours_per_unit_out_of_range';
      }
    }
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

module.exports = { registerPricingRoutes };
