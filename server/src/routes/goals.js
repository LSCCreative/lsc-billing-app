'use strict';

const { nowIso } = require('../db');

function loadGoals(row) {
  if (!row) {
    return { desiredNetIncome: null, targetProfitMarginPct: null, billableCapacityHrsPerWeek: null };
  }
  return {
    desiredNetIncome: row.desired_net_income,
    targetProfitMarginPct: row.target_profit_margin_pct,
    billableCapacityHrsPerWeek: row.billable_capacity_hrs_per_week,
  };
}

function registerGoalsRoutes(app, db) {
  // Singleton with no seeded row — same "a never-saved row is not an empty
  // one" convention as pricing/settings. Unlike those, there is no sensible
  // guessed default for an income target, so the unsaved shape is nulls
  // (the same "cannot compute yet" signal calc.js's functions use), not a
  // real-looking number.
  app.get('/api/goals', (_req, res) => {
    const row = db.prepare('SELECT * FROM goals WHERE id = 1').get();
    res.json({ ok: true, goals: loadGoals(row), updatedAt: row ? row.updated_at : null });
  });

  app.put('/api/goals', (req, res) => {
    const body = req.body || {};
    const now = nowIso();
    db.prepare(`
      INSERT INTO goals (id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        desired_net_income = excluded.desired_net_income,
        target_profit_margin_pct = excluded.target_profit_margin_pct,
        billable_capacity_hrs_per_week = excluded.billable_capacity_hrs_per_week,
        updated_at = excluded.updated_at
    `).run(
      Number(body.desiredNetIncome) || 0,
      Number(body.targetProfitMarginPct) || 0,
      Number(body.billableCapacityHrsPerWeek) || 0,
      now,
      now
    );
    const row = db.prepare('SELECT * FROM goals WHERE id = 1').get();
    res.json({ ok: true, goals: loadGoals(row), updatedAt: row.updated_at });
  });
}

module.exports = { registerGoalsRoutes };
