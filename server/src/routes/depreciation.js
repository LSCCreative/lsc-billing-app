'use strict';

const { newId, nowIso } = require('../db');
const { currentFinancialYear, fyBounds } = require('../calc');
const { financialYearSchedule } = require('../depreciation');
const { writeSnapshot } = require('./overhead');

function loadAsset(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    serialNumber: row.serial_number,
    supplier: row.supplier,
    purchaseDate: row.purchase_date,
    startDate: row.start_date,
    costIncGst: row.cost_inc_gst,
    gstAmount: row.gst_amount,
    gstCreditClaimed: !!row.gst_credit_claimed,
    method: row.method,
    effectiveLifeYears: row.effective_life_years,
    businessUsePct: row.business_use_pct,
    openingAdjustableValue: row.opening_adjustable_value,
    carLimit: row.car_limit,
    replacementCycleYears: row.replacement_cycle_years,
    replacementCostEstimate: row.replacement_cost_estimate,
    disposalDate: row.disposal_date,
    disposalProceeds: row.disposal_proceeds,
    disposalReason: row.disposal_reason,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadLock(row) {
  return {
    id: row.id,
    fyLabel: row.fy_label,
    lockedAt: row.locked_at,
    figures: JSON.parse(row.figures_json),
  };
}

function allAssets(db) {
  // category then start_date matches the register's own sort — see
  // views/depreciation.js's task — so the API doesn't hand back an order the
  // screen has to re-sort itself.
  return db.prepare('SELECT * FROM depreciation_assets ORDER BY category, start_date').all();
}

/**
 * The most recent lock for one FY, or null. NOT the only row for that FY —
 * see migration v5's decision 4: a re-lodgement is an amendment and the log
 * keeps every one. Every reader takes the latest.
 */
function latestLock(db, fy) {
  return db.prepare(
    'SELECT * FROM depreciation_locks WHERE fy_label = ? ORDER BY locked_at DESC LIMIT 1'
  ).get(fy);
}

/** `?fy=` (or POST body `fy`), defaulting to the current Australian FY. */
function resolveFyParam(raw) {
  const label = typeof raw === 'string' && raw.trim() ? raw : currentFinancialYear();
  const bounds = fyBounds(label);
  return bounds ? bounds.label : null;
}

function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields) {
  return fields.map(csvField).join(',');
}

/**
 * One CSV row per asset for the FY, per the IA doc's "Download CSV → one row
 * per asset", PLUS one row per pool that has a balance that year. Leaving
 * pools out would silently drop every small-business-pool or low-value-pool
 * deduction from the accountant's export — the doc's wording describes the
 * common case, not a reason to omit the other one the schedule screen already
 * shows. category/method are read from the CURRENT assets table (descriptive,
 * not a frozen figure) even when the FY is locked; the money columns come from
 * `schedule`, which is either the live recompute or the frozen lock — see the
 * route below for which.
 */
function buildCsv(schedule, assets) {
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const lines = [csvRow([
    'Name', 'Category', 'Method', 'Days Held', 'Opening Adjustable Value',
    'Decline in Value', 'Deductible', 'Closing Adjustable Value', 'Disposed', 'Balancing Adjustment',
  ])];

  for (const row of schedule.assets) {
    const asset = assetsById.get(row.assetId);
    lines.push(csvRow([
      row.name,
      asset ? asset.category : '',
      asset ? asset.method : '',
      row.daysHeld,
      row.openingAdjustableValue,
      row.decline,
      row.deductible,
      row.closingAdjustableValue,
      row.disposed ? 'yes' : '',
      row.balancingAdjustment === null ? '' : row.balancingAdjustment,
    ]));
  }

  const poolNames = { small_business_pool: 'Small Business Pool', low_value_pool: 'Low Value Pool' };
  for (const row of schedule.pools) {
    lines.push(csvRow([
      poolNames[row.pool] || row.pool,
      'pool',
      row.pool,
      '',
      row.openingBalance,
      row.decline,
      row.deductible,
      row.closingBalance,
      '',
      '',
    ]));
  }

  return lines.join('\r\n') + '\r\n';
}

function registerDepreciationRoutes(app, db) {
  app.get('/api/depreciation-assets', (_req, res) => {
    res.json({ ok: true, assets: allAssets(db).map(loadAsset) });
  });

  function writeFields(body) {
    return [
      body.name || '',
      body.category,
      body.serialNumber || '',
      body.supplier || '',
      body.purchaseDate,
      body.startDate,
      Number(body.costIncGst) || 0,
      Number(body.gstAmount) || 0,
      body.gstCreditClaimed ? 1 : 0,
      body.method,
      body.effectiveLifeYears === undefined || body.effectiveLifeYears === null || body.effectiveLifeYears === ''
        ? null : Number(body.effectiveLifeYears),
      body.businessUsePct === undefined || body.businessUsePct === null || body.businessUsePct === ''
        ? 100 : Number(body.businessUsePct),
      body.openingAdjustableValue === undefined || body.openingAdjustableValue === null || body.openingAdjustableValue === ''
        ? null : Number(body.openingAdjustableValue),
      body.carLimit === undefined || body.carLimit === null || body.carLimit === '' ? null : Number(body.carLimit),
      body.replacementCycleYears === undefined || body.replacementCycleYears === null || body.replacementCycleYears === ''
        ? null : Number(body.replacementCycleYears),
      body.replacementCostEstimate === undefined || body.replacementCostEstimate === null || body.replacementCostEstimate === ''
        ? null : Number(body.replacementCostEstimate),
      body.disposalDate || null,
      body.disposalProceeds === undefined || body.disposalProceeds === null || body.disposalProceeds === ''
        ? null : Number(body.disposalProceeds),
      body.disposalReason || '',
      body.notes || '',
    ];
  }

  // Enum and range checks (category, method, business_use_pct 0–100) are left
  // to the table's own CHECK constraints, matching overhead_items' existing
  // convention (see "an out-of-enum category is rejected" in test-api.js) — a
  // bad value 500s rather than being silently stored, and there is one
  // definition of the enum, not two.
  app.post('/api/depreciation-assets', (req, res) => {
    const body = req.body || {};
    const id = newId('da');
    const now = nowIso();
    db.prepare(`
      INSERT INTO depreciation_assets (
        id, name, category, serial_number, supplier, purchase_date, start_date,
        cost_inc_gst, gst_amount, gst_credit_claimed, method, effective_life_years,
        business_use_pct, opening_adjustable_value, car_limit, replacement_cycle_years,
        replacement_cost_estimate, disposal_date, disposal_proceeds, disposal_reason,
        notes, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, ...writeFields(body), now, now);
    writeSnapshot(db);
    const row = db.prepare('SELECT * FROM depreciation_assets WHERE id = ?').get(id);
    res.status(201).json({ ok: true, asset: loadAsset(row) });
  });

  app.put('/api/depreciation-assets/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM depreciation_assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const now = nowIso();
    db.prepare(`
      UPDATE depreciation_assets SET
        name = ?, category = ?, serial_number = ?, supplier = ?, purchase_date = ?, start_date = ?,
        cost_inc_gst = ?, gst_amount = ?, gst_credit_claimed = ?, method = ?, effective_life_years = ?,
        business_use_pct = ?, opening_adjustable_value = ?, car_limit = ?, replacement_cycle_years = ?,
        replacement_cost_estimate = ?, disposal_date = ?, disposal_proceeds = ?, disposal_reason = ?,
        notes = ?, updated_at = ?
      WHERE id = ?
    `).run(...writeFields(req.body || {}), now, req.params.id);
    writeSnapshot(db);
    const row = db.prepare('SELECT * FROM depreciation_assets WHERE id = ?').get(req.params.id);
    res.json({ ok: true, asset: loadAsset(row) });
  });

  app.delete('/api/depreciation-assets/:id', (req, res) => {
    const result = db.prepare('DELETE FROM depreciation_assets WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
    writeSnapshot(db);
    res.json({ ok: true });
  });

  /**
   * Computed on read, every time — never stored, so it cannot drift from the
   * assets it describes (only the lodgement snapshot below is ever frozen).
   * `diverges` compares the live totals against a lock's frozen ones so the
   * screen can flag a lodged FY that an asset edit since has quietly changed,
   * rather than silently showing the new numbers as if they were what was
   * filed.
   */
  app.get('/api/depreciation-schedule', (req, res) => {
    const fy = resolveFyParam(req.query.fy);
    if (!fy) return res.status(400).json({ error: 'invalid_fy' });

    const assets = allAssets(db);
    const schedule = financialYearSchedule(assets, fy);
    const lock = latestLock(db, fy);
    const frozen = lock ? JSON.parse(lock.figures_json) : null;
    const diverges = frozen
      ? (frozen.totalDeductible !== schedule.totalDeductible
        || frozen.totalBalancingAdjustment !== schedule.totalBalancingAdjustment)
      : null;

    res.json({
      ok: true,
      schedule,
      locked: !!lock,
      lockedAt: lock ? lock.locked_at : null,
      lockedFigures: frozen,
      diverges,
    });
  });

  // Local download only — no email, no upload. LOCKED FY: the export is built
  // from the FROZEN lock figures, not a fresh recompute, on purpose — "Mark FY
  // as lodged" exists precisely so editing an asset's effective life next year
  // can't rewrite what was already filed. category/method still come from the
  // live table; only the money columns are frozen. UNLOCKED FY: live schedule,
  // same as the JSON route.
  app.get('/api/depreciation-schedule.csv', (req, res) => {
    const fy = resolveFyParam(req.query.fy);
    if (!fy) return res.status(400).json({ error: 'invalid_fy' });

    const assets = allAssets(db);
    const lock = latestLock(db, fy);
    const schedule = lock ? JSON.parse(lock.figures_json) : financialYearSchedule(assets, fy);

    const csv = buildCsv(schedule, assets);
    res.attachment(`depreciation-schedule-${fy}.csv`);
    res.type('text/csv; charset=utf-8');
    res.send(csv);
  });

  // Read history — the log itself, not reduced to one row per FY. Callers
  // needing "the current lock for FYxxxx" use the schedule route's
  // `locked`/`lockedFigures`, which already does that reduction.
  app.get('/api/depreciation-locks', (_req, res) => {
    const rows = db.prepare('SELECT * FROM depreciation_locks ORDER BY locked_at').all();
    res.json({ ok: true, locks: rows.map(loadLock) });
  });

  // Append-only — no update, no delete route. A wrong lodgement is an
  // amendment, handled by locking again, not by editing or removing history.
  app.post('/api/depreciation-locks', (req, res) => {
    const fy = resolveFyParam((req.body || {}).fy);
    if (!fy) return res.status(400).json({ error: 'invalid_fy' });

    const schedule = financialYearSchedule(allAssets(db), fy);
    const id = newId('dlk');
    const now = nowIso();
    db.prepare(`
      INSERT INTO depreciation_locks (id, fy_label, locked_at, figures_json)
      VALUES (?, ?, ?, ?)
    `).run(id, fy, now, JSON.stringify(schedule));

    const row = db.prepare('SELECT * FROM depreciation_locks WHERE id = ?').get(id);
    res.status(201).json({ ok: true, lock: loadLock(row) });
  });
}

module.exports = { registerDepreciationRoutes };
