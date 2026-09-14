'use strict';

const { nowIso } = require('../db');
const { DEFAULT_PRICING } = require('../defaults');
const { readPricing } = require('../ratecard');

function registerPricingRoutes(app, db) {
  app.get('/api/pricing', (_req, res) => {
    const row = db.prepare('SELECT updated_at FROM pricing WHERE id = 1').get();
    res.json({ ok: true, pricing: readPricing(db), updatedAt: row ? row.updated_at : null });
  });

  // Whole-document write — this is the fix for the desktop app's fake
  // "Save Rates" button. The row is upserted rather than requiring a
  // separate seed step, so a fresh database just works on first save.
  app.put('/api/pricing', (req, res) => {
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
