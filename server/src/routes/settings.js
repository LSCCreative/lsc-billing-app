'use strict';

const { nowIso } = require('../db');
const { readSettings } = require('../ratecard');

function registerSettingsRoutes(app, db) {
  app.get('/api/settings', (_req, res) => {
    const row = db.prepare('SELECT updated_at FROM settings WHERE id = 1').get();
    res.json({ ok: true, settings: readSettings(db), updatedAt: row ? row.updated_at : null });
  });

  app.put('/api/settings', (req, res) => {
    const now = nowIso();
    const json = JSON.stringify(req.body || {});
    db.prepare(`
      INSERT INTO settings (id, data_json, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).run(json, now);
    res.json({ ok: true, settings: JSON.parse(json), updatedAt: now });
  });
}

module.exports = { registerSettingsRoutes };
