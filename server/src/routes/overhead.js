'use strict';

const { newId, nowIso } = require('../db');
const { annualOverheadTotal, annualisedCost } = require('../calc');

function loadItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    cost: row.cost,
    frequency: row.frequency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadSnapshot(row) {
  return {
    id: row.id,
    ts: row.ts,
    totalAnnual: row.total_annual,
    byCategory: JSON.parse(row.by_category_json),
  };
}

/**
 * Appends one overhead_snapshots row from the *current* overhead_items table —
 * called at the end of every CRUD write in this file (never its own route),
 * matching the brief's "no separate recalculate step". by_category_json holds
 * the same annualised figures total_annual is the sum of, so the donut chart's
 * segments add back up to the headline number.
 */
function writeSnapshot(db) {
  const items = db.prepare('SELECT * FROM overhead_items').all();
  const byCategory = {};
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] || 0) + annualisedCost(item);
  }
  db.prepare(`
    INSERT INTO overhead_snapshots (id, ts, total_annual, by_category_json)
    VALUES (?, ?, ?, ?)
  `).run(newId('ohs'), nowIso(), annualOverheadTotal(items), JSON.stringify(byCategory));
}

function registerOverheadRoutes(app, db) {
  app.get('/api/overhead-items', (_req, res) => {
    const rows = db.prepare(
      'SELECT * FROM overhead_items ORDER BY category, name COLLATE NOCASE'
    ).all();
    res.json({ ok: true, items: rows.map(loadItem) });
  });

  app.post('/api/overhead-items', (req, res) => {
    const body = req.body || {};
    const id = newId('oh');
    const now = nowIso();
    db.prepare(`
      INSERT INTO overhead_items (id, name, category, cost, frequency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.name || '', body.category, Number(body.cost) || 0, body.frequency, now, now);
    writeSnapshot(db);
    const row = db.prepare('SELECT * FROM overhead_items WHERE id = ?').get(id);
    res.status(201).json({ ok: true, item: loadItem(row) });
  });

  app.put('/api/overhead-items/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM overhead_items WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const body = req.body || {};
    const now = nowIso();
    db.prepare(`
      UPDATE overhead_items SET
        name = ?, category = ?, cost = ?, frequency = ?, updated_at = ?
      WHERE id = ?
    `).run(body.name || '', body.category, Number(body.cost) || 0, body.frequency, now, req.params.id);
    writeSnapshot(db);
    const row = db.prepare('SELECT * FROM overhead_items WHERE id = ?').get(req.params.id);
    res.json({ ok: true, item: loadItem(row) });
  });

  app.delete('/api/overhead-items/:id', (req, res) => {
    const result = db.prepare('DELETE FROM overhead_items WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
    writeSnapshot(db);
    res.json({ ok: true });
  });

  // Read-only history for the Overhead tab's trend chart. Written internally
  // by the CRUD handlers above, not its own write route.
  app.get('/api/overhead-snapshots', (_req, res) => {
    const rows = db.prepare('SELECT * FROM overhead_snapshots ORDER BY ts').all();
    res.json({ ok: true, snapshots: rows.map(loadSnapshot) });
  });
}

module.exports = { registerOverheadRoutes };
