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

/* A real calendar date in the stored 'YYYY-MM-DD' form. Round-tripped
   through UTC so 2026-02-30 — which Date would quietly roll into March — is
   refused rather than stored. */
function isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * The disposal fields' rules, checked on every asset write (POST and PUT).
 *
 * These are the only asset fields validated here rather than left to the
 * table's CHECK constraints, because a bad one doesn't fail loudly — it prices
 * wrongly. A disposal dated before start_date gives the depreciation chain a
 * negative number of days held, and the asset's last year then shows a decline
 * and a balancing adjustment computed from time that never happened. The
 * screen refuses it too; this is the rule, the screen is the courtesy.
 *
 * Same-day is allowed (held one day). A future date is NOT refused here: the
 * server's "today" is the NAS clock, and the screen owns that softer rule.
 * Proceeds are optional (the chain reads a missing one as 0) but never
 * negative — a disposal can't cost the buyer less than nothing.
 *
 * @returns {{error:string, message:string}|null}
 */
function disposalProblem(body) {
  const date = body.disposalDate;
  if (date !== undefined && date !== null && date !== '') {
    if (!isIsoDate(date)) {
      return { error: 'disposal_date_invalid', message: 'The disposal date isn’t a real date.' };
    }
    if (isIsoDate(body.startDate) && date < body.startDate) {
      return {
        error: 'disposal_before_start',
        message: `The disposal date can’t be before the asset’s start date (${body.startDate}).`,
      };
    }
  }
  const proceeds = body.disposalProceeds;
  if (proceeds !== undefined && proceeds !== null && proceeds !== '') {
    const n = Number(proceeds);
    if (!Number.isFinite(n) || n < 0) {
      return { error: 'disposal_proceeds_invalid', message: 'Disposal proceeds must be $0 or more.' };
    }
  }
  return null;
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

/* Text cells that a spreadsheet would read as a formula (=, +, -, @, and the
   tab/CR tricks) get a leading apostrophe. Only TEXT cells: a negative
   balancing adjustment is a number and must stay one. The one person who
   opens this is the user's accountant, but an asset named "=HYPERLINK(…)" is
   still an asset name, not an instruction to their spreadsheet. */
/* True once the FY's 30 June is behind us: its start year is before the
   current FY's. Compared by FY, through the shared helper, not by date maths
   here — the helper is the one place that knows where Australian years turn. */
function fyHasEnded(label) {
  const bounds = fyBounds(label);
  const current = fyBounds(currentFinancialYear());
  return Boolean(bounds && current && bounds.startYear < current.startYear);
}

function csvText(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/* Money as a fixed two-decimal string — 800.00, not 800 — so a column reads
   as money when opened and nothing looks like it lost its cents. Blank, not
   0.00, when there is no figure (a pool has no balancing adjustment). */
function csvMoney(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '';
}

function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(fields) {
  return fields.map(csvField).join(',');
}

const CSV_HEADER = [
  'Name', 'Category', 'Method', 'Start Date', 'Days Held', 'Business Use %',
  'Opening Adjustable Value', 'Pool Additions', 'Decline in Value', 'Deductible', 'Closing Adjustable Value',
  'Disposal Date', 'Disposal Proceeds', 'Balancing Adjustment',
];

const POOL_NAMES = { small_business_pool: 'Small Business Pool', low_value_pool: 'Low Value Pool' };

/**
 * One CSV row per asset for the FY, per the IA doc's "Download CSV → one row
 * per asset", PLUS one row per pool that has a balance that year. Leaving
 * pools out would silently drop every small-business-pool or low-value-pool
 * deduction from the accountant's export. A pool row puts its opening and
 * closing POOL balance under the adjustable-value headings and fills Pool
 * Additions (at business share) so the row reconciles on its own; the
 * per-asset columns it has no figure for stay blank rather than holding a
 * different kind of number.
 *
 * Money and the row's own inputs (business use, disposal date and proceeds)
 * come from `schedule` — the live recompute, or for a lodged FY the frozen
 * snapshot, so an edit made since can't change what the export says was filed.
 * Only the descriptive columns (category, method, start date) are read from
 * the current assets table. A snapshot taken before rows carried their own
 * inputs falls back to the asset for those, which is the best that lock has.
 *
 * UTF-8 with a byte-order mark: without it Excel opens the file as Windows-1252
 * and "Sony FX6 — body" arrives as mojibake.
 */
function buildCsv(schedule, assets) {
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const lines = [csvRow(CSV_HEADER)];

  for (const row of schedule.assets) {
    const asset = assetsById.get(row.assetId);
    const use = row.businessUsePct !== undefined ? row.businessUsePct : asset ? asset.business_use_pct : null;
    const disposalDate = row.disposalDate !== undefined ? row.disposalDate : row.disposed && asset ? asset.disposal_date : null;
    const proceeds = row.disposalProceeds !== undefined
      ? row.disposalProceeds
      : row.disposed && asset ? (asset.disposal_proceeds || 0) : null;
    lines.push(csvRow([
      csvText(row.name),
      asset ? asset.category : '',
      asset ? asset.method : '',
      asset ? asset.start_date : '',
      row.daysHeld,
      use === null || use === undefined ? '' : use,
      csvMoney(row.openingAdjustableValue),
      '',
      csvMoney(row.decline),
      csvMoney(row.deductible),
      csvMoney(row.closingAdjustableValue),
      disposalDate || '',
      csvMoney(proceeds),
      csvMoney(row.balancingAdjustment),
    ]));
  }

  for (const row of schedule.pools) {
    lines.push(csvRow([
      POOL_NAMES[row.pool] || row.pool,
      'pool',
      row.pool,
      '',
      '',
      '',
      csvMoney(row.openingBalance),
      csvMoney(row.additions),
      csvMoney(row.decline),
      csvMoney(row.deductible),
      csvMoney(row.closingBalance),
      '',
      row.disposalProceeds ? csvMoney(row.disposalProceeds) : '',
      '',
    ]));
  }

  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/* ── Divergence: a lodged FY against today's recompute ─────────────────────

   Line by line, not totals only. Comparing the two totals missed any edit
   whose effects cancel out across lines, and even when the totals did move it
   couldn't say WHICH asset moved — which is the one thing the user needs to
   take to their accountant. Figures are compared exactly: both sides are
   round2'd cents that went through the same JSON round trip, so a difference
   of any size is a real one.

   A line present on one side only is a divergence too: an asset deleted since
   (the lodged line has no live counterpart) or one added or re-dated into the
   year (the reverse). The input fields (business use, disposal date and
   proceeds) are compared only when the lodged row carries them — a snapshot
   from before rows carried their inputs can't be said to disagree about them. */
const ASSET_FIELDS = [
  'daysHeld', 'businessUsePct', 'openingAdjustableValue', 'decline', 'deductible',
  'closingAdjustableValue', 'disposalDate', 'disposalProceeds', 'balancingAdjustment',
];
const POOL_FIELDS = ['openingBalance', 'additions', 'decline', 'deductible', 'disposalProceeds', 'closingBalance'];

function lineChanges(lodged, live, fields) {
  const changes = [];
  for (const f of fields) {
    if (lodged[f] === undefined) continue;
    const was = lodged[f];
    const now = live[f] === undefined ? null : live[f];
    if (was !== now) changes.push({ field: f, lodged: was, live: now });
  }
  return changes;
}

function scheduleDivergences(lodged, live) {
  const out = [];

  const liveAssets = new Map(live.assets.map((r) => [r.assetId, r]));
  const seen = new Set();
  for (const was of lodged.assets || []) {
    seen.add(was.assetId);
    const now = liveAssets.get(was.assetId);
    if (!now) {
      out.push({ kind: 'asset', id: was.assetId, name: was.name, change: 'removed', fields: [] });
      continue;
    }
    const fields = lineChanges(was, now, ASSET_FIELDS);
    if (fields.length) out.push({ kind: 'asset', id: was.assetId, name: now.name || was.name, change: 'changed', fields });
  }
  for (const now of live.assets) {
    if (!seen.has(now.assetId)) out.push({ kind: 'asset', id: now.assetId, name: now.name, change: 'added', fields: [] });
  }

  const livePools = new Map(live.pools.map((r) => [r.pool, r]));
  const seenPools = new Set();
  for (const was of lodged.pools || []) {
    seenPools.add(was.pool);
    const now = livePools.get(was.pool);
    if (!now) {
      out.push({ kind: 'pool', id: was.pool, name: POOL_NAMES[was.pool] || was.pool, change: 'removed', fields: [] });
      continue;
    }
    const fields = lineChanges(was, now, POOL_FIELDS);
    if (fields.length) out.push({ kind: 'pool', id: was.pool, name: POOL_NAMES[was.pool] || was.pool, change: 'changed', fields });
  }
  for (const now of live.pools) {
    if (!seenPools.has(now.pool)) {
      out.push({ kind: 'pool', id: now.pool, name: POOL_NAMES[now.pool] || now.pool, change: 'added', fields: [] });
    }
  }

  return out;
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
    const problem = disposalProblem(body);
    if (problem) return res.status(400).json(problem);
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
    const problem = disposalProblem(req.body || {});
    if (problem) return res.status(400).json(problem);
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
   * For a lodged FY, `divergences` lists every line where today's recompute
   * disagrees with what was lodged (see scheduleDivergences), so the screen
   * can flag it rather than silently showing the new numbers as if they were
   * what was filed. `diverges` is its boolean, null when the FY isn't lodged.
   */
  app.get('/api/depreciation-schedule', (req, res) => {
    const fy = resolveFyParam(req.query.fy);
    if (!fy) return res.status(400).json({ error: 'invalid_fy' });

    const assets = allAssets(db);
    const schedule = financialYearSchedule(assets, fy);
    const lock = latestLock(db, fy);
    const frozen = lock ? JSON.parse(lock.figures_json) : null;
    const divergences = frozen ? scheduleDivergences(frozen, schedule) : null;

    res.json({
      ok: true,
      schedule,
      locked: !!lock,
      lockedAt: lock ? lock.locked_at : null,
      lockedFigures: frozen,
      diverges: divergences ? divergences.length > 0 : null,
      divergences,
      // Whether this FY can be lodged yet — see the POST route below.
      fyEnded: fyHasEnded(fy),
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
  // (The screen offers no second lock: an amendment is a deliberate act done
  // outside the UI — see the lock task in TASKS.md.)
  app.post('/api/depreciation-locks', (req, res) => {
    const fy = resolveFyParam((req.body || {}).fy);
    if (!fy) return res.status(400).json({ error: 'invalid_fy' });
    /* A return can't be lodged for a year that hasn't finished — the figures
       are still moving (a disposal next month changes them). Freezing them now
       would record a lodgement that never happened. */
    if (!fyHasEnded(fy)) {
      return res.status(400).json({
        error: 'fy_not_ended',
        message: `${fy} hasn’t ended yet, so it can’t have been lodged.`,
      });
    }

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
