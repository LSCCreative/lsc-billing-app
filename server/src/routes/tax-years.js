'use strict';

const { nowIso } = require('../db');
const { fyBounds, normaliseTaxYear } = require('../calc');

/**
 * The user's own record of each financial year's resident income-tax brackets
 * and Medicare levy (migration v7). One row per FY, written only by the
 * Profit Goals screen. Nothing is seeded or built in: the scale changes with
 * the federal budget, so the screen prefills placeholders the user confirms
 * with their accountant and saves as theirs — the same rule as effective lives
 * and the write-off threshold (.design/price-calculator/HANDOVER.md).
 */
function loadTaxYear(row) {
  return {
    fy: row.fy_label,
    brackets: JSON.parse(row.brackets_json),
    medicareLevyPct: row.medicare_levy_pct,
    updatedAt: row.updated_at,
  };
}

function registerTaxYearRoutes(app, db) {
  app.get('/api/tax-years', (_req, res) => {
    const rows = db.prepare('SELECT * FROM tax_years ORDER BY fy_label').all();
    res.json({ ok: true, taxYears: rows.map(loadTaxYear) });
  });

  /* The whole year in one write. Validated through the same normaliseTaxYear
     every calculation uses, so a year that saves is a year that computes: a
     rate that isn't a number, thresholds out of order, or rates of 100% or
     more with the levy are refused rather than stored and then silently read
     as "no tax year" everywhere. Stored in the normalised order. */
  app.put('/api/tax-years/:fy', (req, res) => {
    const bounds = fyBounds(req.params.fy);
    if (!bounds) return res.status(400).json({ error: 'invalid_fy' });
    const body = req.body || {};
    const ty = normaliseTaxYear({ fy: bounds.label, brackets: body.brackets, medicareLevyPct: body.medicareLevyPct });
    if (!ty) {
      return res.status(400).json({
        error: 'invalid_tax_year',
        message: 'Each bracket needs a starting income and a rate, in order, and no rate (with the levy) can reach 100%.',
      });
    }
    const now = nowIso();
    db.prepare(`
      INSERT INTO tax_years (fy_label, brackets_json, medicare_levy_pct, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(fy_label) DO UPDATE SET
        brackets_json = excluded.brackets_json,
        medicare_levy_pct = excluded.medicare_levy_pct,
        updated_at = excluded.updated_at
    `).run(bounds.label, JSON.stringify(ty.brackets), ty.medicareLevyPct, now);
    const row = db.prepare('SELECT * FROM tax_years WHERE fy_label = ?').get(bounds.label);
    res.json({ ok: true, taxYear: loadTaxYear(row) });
  });
}

module.exports = { registerTaxYearRoutes, loadTaxYear };
