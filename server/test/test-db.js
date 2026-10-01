'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, migrate, newId, nowIso, LATEST_VERSION } = require('../src/db');

function tempDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lsc-db-${label}-`));
  return path.join(dir, 'billing.db');
}

test('creates a fresh database with every table the app needs', () => {
  const file = tempDbPath('fresh');
  const db = openDatabase(file);

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).all().map((r) => r.name);

  for (const expected of
    ['account', 'clients', 'depreciation_assets', 'depreciation_locks', 'estimates', 'goals',
      'overhead_items', 'overhead_snapshots', 'pricing', 'schema_version', 'sessions',
      'settings']) {
    assert.ok(tables.includes(expected), `missing table: ${expected}`);
  }

  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
});

test('re-running migrations against an existing database changes nothing', () => {
  const file = tempDbPath('idempotent');

  const first = openDatabase(file);
  first.prepare(`
    INSERT INTO clients (id, business_name, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(newId('cl'), 'Acme Pty Ltd', nowIso(), nowIso());
  first.close();

  // Second open on the same file: the data survives and no migration re-runs.
  const second = openDatabase(file);
  const result = migrate(second);
  assert.equal(result.applied, 0);
  assert.equal(result.to, LATEST_VERSION);

  const clients = second.prepare('SELECT business_name FROM clients').all();
  assert.equal(clients.length, 1);
  assert.equal(clients[0].business_name, 'Acme Pty Ltd');

  const versions = second.prepare('SELECT COUNT(*) AS n FROM schema_version').get();
  assert.equal(versions.n, LATEST_VERSION);
  second.close();
});

test('refuses to run against a database built by a newer version of the app', () => {
  const file = tempDbPath('future');
  const db = openDatabase(file);
  db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
    .run(LATEST_VERSION + 5, nowIso());
  db.close();

  assert.throws(() => openDatabase(file), /newer database/);
});

test('a corrupt file is refused rather than overwritten', () => {
  const file = tempDbPath('corrupt');
  // Not a database at all — the shape a truncated copy or a bad restore takes.
  fs.writeFileSync(file, 'this is not a sqlite file, but it is the only copy');
  const before = fs.readFileSync(file);

  assert.throws(() => openDatabase(file));

  // The point of the check: whatever was in there is still in there.
  assert.deepEqual(fs.readFileSync(file), before);
});

test('only one account row can ever exist', () => {
  const file = tempDbPath('account');
  const db = openDatabase(file);

  db.prepare(`
    INSERT INTO account (id, username, password_hash, created_at, updated_at)
    VALUES (1, 'lachlan', 'hash', ?, ?)
  `).run(nowIso(), nowIso());

  assert.throws(() => {
    db.prepare(`
      INSERT INTO account (id, username, password_hash, created_at, updated_at)
      VALUES (2, 'someone-else', 'hash', ?, ?)
    `).run(nowIso(), nowIso());
  }, /CHECK constraint failed/);

  db.close();
});

test('deleting a client leaves their estimates intact, snapshot and all', () => {
  const file = tempDbPath('snapshot');
  const db = openDatabase(file);

  const clientId = newId('cl');
  db.prepare('INSERT INTO clients (id, business_name, created_at, updated_at) VALUES (?,?,?,?)')
    .run(clientId, 'Acme Pty Ltd', nowIso(), nowIso());

  const estimateId = newId('est');
  db.prepare(`
    INSERT INTO estimates (id, upid, name, client_id, client_json, totals_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    estimateId, 'UPID-001', 'Brand film', clientId,
    JSON.stringify({ businessName: 'Acme Pty Ltd', email: 'accounts@acme.example' }),
    JSON.stringify({ totalIncGst: 3916 }),
    nowIso(), nowIso()
  );

  db.prepare('DELETE FROM clients WHERE id = ?').run(clientId);

  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  assert.ok(row, 'the estimate must survive its client being deleted');
  assert.equal(row.client_id, null);
  assert.equal(JSON.parse(row.client_json).businessName, 'Acme Pty Ltd');

  db.close();
});

test('total_inc_gst tracks totals_json without being stored twice', () => {
  const file = tempDbPath('generated');
  const db = openDatabase(file);

  const id = newId('est');
  db.prepare(`
    INSERT INTO estimates (id, totals_json, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(id, JSON.stringify({ totalIncGst: 3916 }), nowIso(), nowIso());

  assert.equal(db.prepare('SELECT total_inc_gst AS t FROM estimates WHERE id = ?').get(id).t, 3916);

  db.prepare('UPDATE estimates SET totals_json = ? WHERE id = ?')
    .run(JSON.stringify({ totalIncGst: 100.5 }), id);

  assert.equal(db.prepare('SELECT total_inc_gst AS t FROM estimates WHERE id = ?').get(id).t, 100.5);
  db.close();
});

test('an estimate cannot be saved with a status the pipeline does not have', () => {
  const file = tempDbPath('status');
  const db = openDatabase(file);

  assert.throws(() => {
    db.prepare('INSERT INTO estimates (id, status, created_at, updated_at) VALUES (?,?,?,?)')
      .run(newId('est'), 'archived', nowIso(), nowIso());
  }, /CHECK constraint failed/);

  db.close();
});

test('an overhead item is confined to the fixed category and frequency lists', () => {
  const file = tempDbPath('overhead-category');
  const db = openDatabase(file);

  const insert = (category, frequency) => db.prepare(`
    INSERT INTO overhead_items (id, name, category, cost, frequency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId('ovh'), 'Adobe Creative Cloud', category, 79.99, frequency, nowIso(), nowIso());

  assert.throws(() => insert('subscriptions', 'monthly'), /CHECK constraint failed/);
  assert.throws(() => insert('software', 'yearly'), /CHECK constraint failed/);

  insert('software', 'monthly');
  const row = db.prepare('SELECT * FROM overhead_items').get();
  assert.equal(row.category, 'software');
  assert.equal(row.frequency, 'monthly');

  db.close();
});

test('overhead snapshots are an append-only log, ordered by time', () => {
  const file = tempDbPath('overhead-snapshots');
  const db = openDatabase(file);

  const insert = db.prepare(`
    INSERT INTO overhead_snapshots (id, ts, total_annual, by_category_json) VALUES (?, ?, ?, ?)
  `);
  insert.run(newId('snap'), '2026-09-01T00:00:00.000Z', 20000, JSON.stringify({ software: 20000 }));
  insert.run(newId('snap'), '2026-09-15T00:00:00.000Z', 24000, JSON.stringify({ software: 24000 }));

  const rows = db.prepare('SELECT total_annual FROM overhead_snapshots ORDER BY ts').all();
  assert.deepEqual(rows.map((r) => r.total_annual), [20000, 24000]);

  db.close();
});

test('only one goals row can ever exist, matching pricing/settings', () => {
  const file = tempDbPath('goals');
  const db = openDatabase(file);

  db.prepare(`
    INSERT INTO goals
      (id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week,
       created_at, updated_at)
    VALUES (1, 80000, 20, 25, ?, ?)
  `).run(nowIso(), nowIso());

  assert.throws(() => {
    db.prepare(`
      INSERT INTO goals
        (id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week,
         created_at, updated_at)
      VALUES (2, 80000, 20, 25, ?, ?)
    `).run(nowIso(), nowIso());
  }, /CHECK constraint failed/);

  db.close();
});

test('a fresh database has no goals row until the app writes one', () => {
  const file = tempDbPath('goals-unset');
  const db = openDatabase(file);

  const row = db.prepare('SELECT * FROM goals WHERE id = 1').get();
  assert.equal(row, undefined, 'goals must start empty, like pricing/settings, not pre-seeded');

  db.close();
});

/**
 * MIGRATION v5 — capacity fields, depreciation assets and lodgement locks.
 *
 * The upgrade test is the one that matters. A goals row saved under v4 has no
 * capacity fields, and what it gets on upgrade is a decision the migration
 * makes on the user's behalf: the reference defaults, because leave and sick
 * days cannot be inferred from the single weekly figure that existed before.
 * Inventing a split would be fabrication dressed as a migration.
 */
function insertV4Goals(db, capacityHrsPerWeek = 20) {
  db.prepare(`
    INSERT INTO goals
      (id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week,
       created_at, updated_at)
    VALUES (1, 80000, 25, ?, ?, ?)
  `).run(capacityHrsPerWeek, nowIso(), nowIso());
}

test('a goals row keeps its data and gains the seeded capacity defaults', () => {
  const file = tempDbPath('v5-goals');
  const db = openDatabase(file);
  insertV4Goals(db, 20);

  const g = db.prepare('SELECT * FROM goals WHERE id = 1').get();

  // Seeded, not derived from billable_capacity_hrs_per_week.
  assert.equal(g.billable_hours_per_day, 8);
  assert.equal(g.working_days_per_week, 5);
  assert.equal(g.leave_days_per_year, 30);
  assert.equal(g.sick_days_per_year, 8);

  // Nothing that was already there moved.
  assert.equal(g.desired_net_income, 80000);
  assert.equal(g.target_profit_margin_pct, 25);
  assert.equal(g.billable_capacity_hrs_per_week, 20);

  db.close();
});

test('the seeded capacity defaults are NOT derived from the legacy weekly figure', () => {
  // Two databases whose legacy capacity differs wildly still seed identically.
  // This is the point: the seeds are a starting guess the Capacity screen asks
  // the user to confirm, not a conversion of what they had.
  //
  // It also pins the size of what confirming costs. 8 × 5 with 30 + 8 days off
  // is 1,776 annual hours; a legacy 20 hrs/week annualised at the retired 48 is
  // 960. Accepting the seeds unexamined would nearly halve the overhead rate for
  // that user, which is why the screen must show before/after and not just save.
  for (const legacy of [10, 20, 37.5]) {
    const db = openDatabase(tempDbPath(`v5-seed-${legacy}`));
    insertV4Goals(db, legacy);
    const g = db.prepare('SELECT * FROM goals WHERE id = 1').get();
    assert.equal(g.billable_hours_per_day, 8, `legacy ${legacy} must not change the seed`);
    assert.equal(g.leave_days_per_year, 30);
    assert.equal(g.billable_capacity_hrs_per_week, legacy, 'the legacy column is kept as-is');
    db.close();
  }
});

test('iawo_threshold starts NULL — an ATO figure is never hardcoded as a default', () => {
  const file = tempDbPath('v5-iawo');
  const db = openDatabase(file);
  insertV4Goals(db);

  // NULL, not 0. The threshold moves with the federal budget, so the screen
  // offers the current figure as a placeholder to confirm. A 0 would make every
  // one-off expense exceed the threshold and the double-count hint would fire
  // on all of them until the user learned to ignore it.
  assert.equal(db.prepare('SELECT iawo_threshold FROM goals WHERE id = 1').get().iawo_threshold, null);

  db.close();
});

test('depreciation_assets constrains method and category, like overhead_items does', () => {
  const file = tempDbPath('v5-assets');
  const db = openDatabase(file);

  const insert = (over) => {
    const a = {
      id: newId('asset'), name: 'Camera', category: 'camera',
      purchase_date: '2025-08-01', start_date: '2025-08-15',
      cost_inc_gst: 6600, gst_amount: 600, gst_credit_claimed: 1,
      method: 'diminishing_value', effective_life_years: 6, business_use_pct: 100,
      created_at: nowIso(), updated_at: nowIso(), ...over,
    };
    db.prepare(`
      INSERT INTO depreciation_assets
        (id, name, category, purchase_date, start_date, cost_inc_gst, gst_amount,
         gst_credit_claimed, method, effective_life_years, business_use_pct, created_at, updated_at)
      VALUES (@id, @name, @category, @purchase_date, @start_date, @cost_inc_gst, @gst_amount,
              @gst_credit_claimed, @method, @effective_life_years, @business_use_pct,
              @created_at, @updated_at)
    `).run(a);
    return a;
  };

  insert({});
  for (const method of
    ['prime_cost', 'instant_writeoff', 'small_business_pool', 'low_value_pool']) {
    insert({ method });
  }
  for (const category of
    ['lens', 'lighting', 'audio', 'computer', 'drone', 'vehicle', 'other']) {
    insert({ category });
  }

  assert.throws(() => insert({ method: 'straight_line' }), /CHECK constraint failed/);
  assert.throws(() => insert({ category: 'tripod' }), /CHECK constraint failed/);

  // business_use_pct is a PERCENT, 0–100 — not a 0–1 fraction. The CHECK is the
  // only thing standing between a 0.6 typed as "60% of business use" and a
  // deduction 100× too small, so it is pinned here.
  insert({ business_use_pct: 0 });
  insert({ business_use_pct: 60 });
  insert({ business_use_pct: 100 });
  assert.throws(() => insert({ business_use_pct: 101 }), /CHECK constraint failed/);
  assert.throws(() => insert({ business_use_pct: -1 }), /CHECK constraint failed/);

  assert.throws(() => insert({ gst_credit_claimed: 2 }), /CHECK constraint failed/);

  db.close();
});

test('an asset defaults to held, fully business-use, and no GST credit claimed', () => {
  const file = tempDbPath('v5-asset-defaults');
  const db = openDatabase(file);

  db.prepare(`
    INSERT INTO depreciation_assets
      (id, name, category, purchase_date, start_date, cost_inc_gst, method, created_at, updated_at)
    VALUES (?, 'Mic', 'audio', '2025-07-01', '2025-07-01', 300, 'prime_cost', ?, ?)
  `).run(newId('asset'), nowIso(), nowIso());

  const a = db.prepare('SELECT * FROM depreciation_assets').get();

  // A NULL disposal_date is the "still held" signal replacementReserveTotal()
  // filters on, so it must not default to anything else.
  assert.equal(a.disposal_date, null);
  assert.equal(a.disposal_proceeds, null);
  assert.equal(a.business_use_pct, 100);
  assert.equal(a.gst_credit_claimed, 0);
  assert.equal(a.gst_amount, 0);
  // NULL means "starts at its cost base" rather than mid-life.
  assert.equal(a.opening_adjustable_value, null);
  // Vehicles only.
  assert.equal(a.car_limit, null);

  db.close();
});

test('depreciation_locks is an append-only log that keeps amendments', () => {
  const file = tempDbPath('v5-locks');
  const db = openDatabase(file);

  const insert = db.prepare(`
    INSERT INTO depreciation_locks (id, fy_label, locked_at, figures_json) VALUES (?, ?, ?, ?)
  `);
  // The canonical FY token from calc.js's fyLabel() — no space, plain hyphen.
  // The en-dash form is display only and must never reach a stored value.
  insert.run(newId('lock'), 'FY2025-26', '2026-07-10T00:00:00.000Z', JSON.stringify({ total: 4200 }));
  insert.run(newId('lock'), 'FY2025-26', '2026-09-02T00:00:00.000Z', JSON.stringify({ total: 4350 }));

  // Deliberately NO unique constraint on fy_label: a re-lodgement is an
  // amendment, and an append-only log should keep both. Readers take the latest.
  const rows = db.prepare(
    'SELECT figures_json FROM depreciation_locks WHERE fy_label = ? ORDER BY locked_at DESC'
  ).all('FY2025-26');
  assert.equal(rows.length, 2);
  assert.equal(JSON.parse(rows[0].figures_json).total, 4350);

  db.close();
});

/**
 * MIGRATION v6 — goals income and margin may be unset; capacity confirmation.
 *
 * A table rebuild, so the upgrade test builds the real v5 shape of `goals`
 * (NOT NULL income and margin, no capacity_confirmed_at), puts a row in it,
 * rewinds schema_version, and lets migrate() run v6 over it — the same path the
 * NAS database takes on its next boot.
 */
function rewindGoalsToV5(db) {
  // v7's additive changes come off too, so migrate() can re-apply them.
  db.exec(`
    DROP TABLE IF EXISTS tax_years;
    ALTER TABLE depreciation_assets DROP COLUMN expected_resale_value;
    ALTER TABLE depreciation_assets DROP COLUMN opening_value_fy;
  `);
  db.exec(`
    DROP TABLE goals;
    CREATE TABLE goals (
      id                             INTEGER PRIMARY KEY CHECK (id = 1),
      desired_net_income             REAL NOT NULL,
      target_profit_margin_pct       REAL NOT NULL,
      billable_capacity_hrs_per_week REAL NOT NULL,
      created_at                     TEXT NOT NULL,
      updated_at                     TEXT NOT NULL,
      billable_hours_per_day         REAL NOT NULL DEFAULT 8,
      working_days_per_week          REAL NOT NULL DEFAULT 5,
      leave_days_per_year            REAL NOT NULL DEFAULT 30,
      sick_days_per_year             REAL NOT NULL DEFAULT 8,
      iawo_threshold                 REAL
    );
  `);
  db.prepare('DELETE FROM schema_version WHERE version >= 6').run();
}

test('v6 carries every goals value across the rebuild and starts unconfirmed', () => {
  const db = openDatabase(tempDbPath('v6-upgrade'));
  rewindGoalsToV5(db);
  db.prepare(`
    INSERT INTO goals
      (id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week,
       created_at, updated_at, billable_hours_per_day, working_days_per_week,
       leave_days_per_year, sick_days_per_year, iawo_threshold)
    VALUES (1, 80000, 25, 34.15, '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', 7, 4, 20, 5, 20000)
  `).run();

  const result = migrate(db);
  assert.deepEqual([result.from, result.to, result.applied], [5, LATEST_VERSION, LATEST_VERSION - 5]);

  const g = db.prepare('SELECT * FROM goals WHERE id = 1').get();
  assert.deepEqual(
    [g.desired_net_income, g.target_profit_margin_pct, g.billable_capacity_hrs_per_week],
    [80000, 25, 34.15],
  );
  assert.deepEqual(
    [g.billable_hours_per_day, g.working_days_per_week, g.leave_days_per_year, g.sick_days_per_year],
    [7, 4, 20, 5],
    'capacity the user already had must survive the rebuild, not reset to the seeds',
  );
  assert.equal(g.iawo_threshold, 20000);
  assert.equal(g.created_at, '2026-09-01T00:00:00.000Z');
  assert.equal(g.updated_at, '2026-09-02T00:00:00.000Z');
  // Nobody has confirmed capacity on the Capacity screen yet — it didn't exist.
  assert.equal(g.capacity_confirmed_at, null);

  // And the singleton rule survived the rebuild.
  assert.throws(() => {
    db.prepare(`
      INSERT INTO goals (id, billable_capacity_hrs_per_week, created_at, updated_at)
      VALUES (2, 1, ?, ?)
    `).run(nowIso(), nowIso());
  }, /CHECK constraint failed/);

  db.close();
});

test('v6 lets income and margin be unset rather than forcing a zero', () => {
  // The Capacity screen can be the first thing ever saved. A NOT NULL margin
  // would force a 0 in, and 0% is a real break-even margin, not "not set".
  const db = openDatabase(tempDbPath('v6-nullable'));
  db.prepare(`
    INSERT INTO goals (id, billable_capacity_hrs_per_week, created_at, updated_at)
    VALUES (1, 34.15, ?, ?)
  `).run(nowIso(), nowIso());
  const g = db.prepare('SELECT * FROM goals WHERE id = 1').get();
  assert.equal(g.desired_net_income, null);
  assert.equal(g.target_profit_margin_pct, null);
  db.close();
});

/**
 * MIGRATION v7 — the 2026-09-28 money-math audit. Additive: a tax_years table,
 * goals.super_pct / bad_debt_pct, and two asset columns. The one data step is
 * the opening-value backfill: an asset already carrying an opening adjustable
 * value gets opening_value_fy from its created_at, because the form described
 * the value as the one "when you entered it here".
 */
test('v7 backfills opening_value_fy from created_at, and only where an opening value exists', () => {
  const db = openDatabase(tempDbPath('v7-upgrade'));
  db.exec(`
    DROP TABLE tax_years;
    ALTER TABLE depreciation_assets DROP COLUMN expected_resale_value;
    ALTER TABLE depreciation_assets DROP COLUMN opening_value_fy;
    ALTER TABLE goals DROP COLUMN super_pct;
    ALTER TABLE goals DROP COLUMN bad_debt_pct;
  `);
  db.prepare('DELETE FROM schema_version WHERE version >= 7').run();
  const insert = db.prepare(`
    INSERT INTO depreciation_assets
      (id, name, category, purchase_date, start_date, cost_inc_gst, method, effective_life_years,
       opening_adjustable_value, created_at, updated_at)
    VALUES (?, 'Cam', 'camera', '2023-07-01', '2023-07-01', 9000, 'diminishing_value', 3, ?, ?, ?)
  `);
  insert.run('da_old', 3000, '2025-10-02T01:00:00.000Z', '2025-10-02T01:00:00.000Z');
  insert.run('da_new', null, '2025-10-02T01:00:00.000Z', '2025-10-02T01:00:00.000Z');

  const result = migrate(db);
  assert.deepEqual([result.from, result.to], [6, LATEST_VERSION]);
  const byId = (id) => db.prepare('SELECT opening_value_fy FROM depreciation_assets WHERE id = ?').get(id);
  assert.equal(byId('da_old').opening_value_fy, 'FY2025-26');
  assert.equal(byId('da_new').opening_value_fy, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'tax_years'").get().n, 1);
  db.close();
});

/**
 * MIGRATION v8 — five more operating-cost categories (four new values; the
 * fifth is the existing 'marketing', relabelled on screen). A table rebuild, so
 * the upgrade test puts a row in the v7 shape, rewinds, and lets v8 run.
 */
test('v8 keeps every overhead row and widens the category list', () => {
  const db = openDatabase(tempDbPath('v8-upgrade'));
  db.prepare(`
    INSERT INTO overhead_items (id, name, category, cost, frequency, created_at, updated_at)
    VALUES ('oh_keep', 'Website ads', 'marketing', 120, 'monthly', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z')
  `).run();
  db.prepare('DELETE FROM schema_version WHERE version >= 8').run();

  const result = migrate(db);
  // v9 and every later one run too; with no pricing row and no estimates, v9
  // changes nothing, and v10 only adds a goals column.
  assert.deepEqual([result.from, result.to, result.applied], [7, LATEST_VERSION, LATEST_VERSION - 7]);
  const row = db.prepare("SELECT * FROM overhead_items WHERE id = 'oh_keep'").get();
  assert.deepEqual(
    [row.name, row.category, row.cost, row.frequency, row.created_at, row.updated_at],
    ['Website ads', 'marketing', 120, 'monthly', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'],
  );

  const insert = db.prepare(`
    INSERT INTO overhead_items (id, name, category, cost, frequency, created_at, updated_at)
    VALUES (?, 'x', ?, 1, 'monthly', ?, ?)
  `);
  for (const c of ['motor_vehicle', 'phone_internet', 'home_office', 'training']) {
    insert.run('oh_' + c, c, nowIso(), nowIso());
  }
  assert.throws(() => insert.run('oh_bad', 'fuel', nowIso(), nowIso()), /CHECK constraint failed/);
  // The category index came back with the rebuild.
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'idx_overhead_items_category'").get().n,
    1,
  );
  db.close();
});

/* ── v9: services priced per hour, half day and full day ───────────────────── */

const { computeTotals } = require('../src/calc');
const { readPricing, readSettings } = require('../src/ratecard');
const { DEFAULT_PRICING } = require('../src/defaults');
const { pricingProblem } = require('../src/routes/pricing');
const { reshapeCard, snapshotLegacyLines, V8_DEFAULT_PRICING } = require('../src/migrations/v9-service-units');

/* A v8 card with one of every kind of labour row the migration must place. */
const V8_CARD = {
  labourSections: [
    {
      id: 'prod',
      label: 'Production',
      rows: [
        { id: 'vc', name: 'Video Capture', rate: 100, mu: 140 },
        { id: 'vcf', name: 'Video Capture — Full Day', rate: 800, mu: 1120, hoursPerUnit: 8, dayUnit: 'full' },
        { name: 'Video Capture — Half Day', rate: 400, mu: 640, hoursPerUnit: 4, dayUnit: 'half' },
        { id: 'dd', name: 'Drone Day', rate: 0, mu: 900, hoursPerUnit: 6, dayUnit: 'full' },
        { name: 'Eight-hour row', rate: 0, mu: 700, hoursPerUnit: 8 },
        { name: 'Four-hour row', rate: 0, mu: 380, hoursPerUnit: 4 },
        { name: 'Long block', rate: 0, mu: 500, hoursPerUnit: 5 },
        { name: 'Unpriced', rate: 0 },
      ],
    },
    {
      id: 'post',
      label: 'Post-Production',
      rows: [{ id: 'raw', name: 'Raw Footage Handover [on HDD]', rate: 70, mu: 98, customBill: true }],
    },
  ],
  travelRows: [
    { name: 'Fuel & Tolls', rate: 1, mu: 1, directCost: true },
    { name: 'Crew Meals', rate: 30, mu: 33, unit: 'meals' },
    { name: 'Transport & Logistics Hrs', rate: 25, mu: 35, ownTime: true },
  ],
  taxSetAsideRate: 0.35,
};

const V9_ESTIMATES = [
  {
    id: 'est_legacy', gstFree: 0,
    rows: {
      prod: [
        { rowId: 'vc', name: 'Renamed since', qty: 3 },
        { name: 'Video Capture — Full Day', qty: 2 },
        { rowId: 'vcf', name: 'Video Capture — Full Day', qty: 1 },
        { name: 'Video Capture — Half Day', qty: 1 },
        { name: 'Drone Day', qty: 2 },
        { name: 'Eight-hour row', qty: 1 },
        { name: 'Long block', qty: 2 },
        { name: 'Unpriced', qty: 4 },
      ],
      post: [{ rowId: 'raw', name: 'Raw Footage Handover [on HDD]', qty: 1, override: 250 }],
      travel: [
        { name: 'Fuel & Tolls', qty: 120 },
        { name: 'Crew Meals', qty: 4 },
        { name: 'Transport & Logistics Hrs', qty: 3 },
      ],
      crew: [{ name: 'Gaffer', days: 2, cost: 500 }],
      equip: [{ name: 'Lens', days: 2, cost: 150 }],
    },
  },
  {
    // Snapshotted already, and lines no card can price.
    id: 'est_mixed', gstFree: 1,
    rows: {
      prod: [
        { rowId: 'vc', name: 'Video Capture', qty: 2, mu: 99 },
        { rowId: 'vcf', name: 'Video Capture — Full Day', qty: 1, mu: 1000, hoursPerUnit: 8, dayUnit: 'full' },
        { name: 'Gone from the card', qty: 5 },
        { name: 'Video Capture', qty: 1 },
      ],
      oldcat: [{ name: 'Video Capture', qty: 7 }],
    },
  },
];

const GST_INC_SETTINGS = { gst: { registered: true, rate: 0.1, pricesIncludeGst: true } };

/** A database at v8, holding `card` (or no pricing row) and the estimates above. */
function v8Database(label, card) {
  const db = openDatabase(tempDbPath(label));
  db.prepare('DELETE FROM schema_version WHERE version >= 9').run();
  if (card) {
    db.prepare("INSERT INTO pricing (id, data_json, updated_at) VALUES (1, ?, '2026-09-01T00:00:00.000Z')")
      .run(JSON.stringify(card));
  }
  db.prepare("INSERT INTO settings (id, data_json, updated_at) VALUES (1, ?, '2026-09-01T00:00:00.000Z')")
    .run(JSON.stringify(GST_INC_SETTINGS));
  const insert = db.prepare(`
    INSERT INTO estimates (id, name, active_rows_json, gst_free, created_at, updated_at)
    VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z')
  `);
  for (const e of V9_ESTIMATES) insert.run(e.id, e.id, JSON.stringify(e.rows), e.gstFree);
  return db;
}

/** Every estimate's totals as the server would compute them now. */
function recomputedTotals(db) {
  const pricing = readPricing(db);
  const settings = readSettings(db);
  const out = {};
  for (const e of db.prepare('SELECT id, active_rows_json, gst_free FROM estimates ORDER BY id').all()) {
    out[e.id] = computeTotals(JSON.parse(e.active_rows_json), pricing, settings, {
      gstFree: e.gst_free === 1,
      overheadRate: 30,
    });
  }
  return out;
}

function quietly(t) {
  const log = t.mock.method(console, 'log', () => {});
  return () => log.mock.calls.map((c) => c.arguments.join(' '));
}

test('v9 leaves every estimate\'s recomputed totals exactly as they were', (t) => {
  const logs = quietly(t);
  const db = v8Database('v9-totals', V8_CARD);
  const before = recomputedTotals(db);
  // The fixture means something: labour is priced, and some of it by day rows.
  assert.ok(before.est_legacy.labourTotal > 0);
  assert.ok(before.est_legacy.totalHours > 20);

  const result = migrate(db);
  // v9 and every later one (v10 only adds a goals column).
  assert.deepEqual([result.from, result.to, result.applied], [8, LATEST_VERSION, LATEST_VERSION - 8]);
  assert.deepEqual(recomputedTotals(db), before);
  assert.ok(logs().some((l) => /migrated to v9/.test(l)));

  // …and they now come from each line's own snapshot, not the card.
  const legacy = JSON.parse(db.prepare("SELECT active_rows_json FROM estimates WHERE id = 'est_legacy'").get().active_rows_json);
  assert.deepEqual(legacy.prod[1], { name: 'Video Capture — Full Day', qty: 2, mu: 1120, rowId: 'vcf', hoursPerUnit: 8, dayUnit: 'full', rate: 800 });
  assert.deepEqual(legacy.prod[0], { rowId: 'vc', name: 'Renamed since', qty: 3, mu: 140, rate: 100 });
  assert.deepEqual(legacy.prod[4], { name: 'Drone Day', qty: 2, mu: 900, rowId: 'dd', hoursPerUnit: 6, dayUnit: 'full', rate: 0 });
  assert.deepEqual(legacy.post[0], { rowId: 'raw', name: 'Raw Footage Handover [on HDD]', qty: 1, override: 250, mu: 98, rate: 70, customBill: true });
  assert.deepEqual(legacy.travel[2], { name: 'Transport & Logistics Hrs', qty: 3, mu: 35, rate: 25, ownTime: true });
  assert.deepEqual(legacy.crew, V9_ESTIMATES[0].rows.crew);
  assert.deepEqual(legacy.prod[7], { name: 'Unpriced', qty: 4, mu: 0, rate: 0 });

  // A line that already had its price, or has nowhere to get one, is untouched.
  const mixed = JSON.parse(db.prepare("SELECT active_rows_json FROM estimates WHERE id = 'est_mixed'").get().active_rows_json);
  assert.deepEqual(mixed.prod.slice(0, 3), V9_ESTIMATES[1].rows.prod.slice(0, 3));
  assert.deepEqual(mixed.oldcat, V9_ESTIMATES[1].rows.oldcat);
  assert.deepEqual(mixed.prod[3], { name: 'Video Capture', qty: 1, rowId: 'vc', mu: 140, rate: 100 });

  // A migration is not an edit.
  for (const r of db.prepare('SELECT updated_at FROM estimates').all()) assert.equal(r.updated_at, '2026-09-02T00:00:00.000Z');
  assert.equal(db.prepare('SELECT updated_at FROM pricing').get().updated_at, '2026-09-01T00:00:00.000Z');
  db.close();
});

test('v9 puts each row\'s one price in one slot and keeps everything else on the card', (t) => {
  quietly(t);
  const db = v8Database('v9-card', V8_CARD);
  migrate(db);
  const card = readPricing(db);

  assert.deepEqual(card.serviceDay, { fullHours: 8, halfHours: 4 });
  assert.deepEqual(card.travelRows, V8_CARD.travelRows);
  assert.equal(card.taxSetAsideRate, 0.35);
  const rows = Object.fromEntries(card.labourSections.flatMap((s) => s.rows).map((r) => [r.name, r]));
  const slots = (name) => rows[name].prices;
  assert.deepEqual(slots('Video Capture'), { hour: 140, half: null, full: null });
  assert.deepEqual(slots('Video Capture — Full Day'), { hour: null, half: null, full: 1120 });
  assert.deepEqual(slots('Video Capture — Half Day'), { hour: null, half: 640, full: null });
  assert.deepEqual(slots('Drone Day'), { hour: null, half: null, full: 900 }); // dayUnit wins over 6 hrs
  assert.deepEqual(slots('Eight-hour row'), { hour: null, half: null, full: 700 });
  assert.deepEqual(slots('Four-hour row'), { hour: null, half: 380, full: null });
  assert.deepEqual(slots('Long block'), { hour: 500, half: null, full: null });
  assert.deepEqual(slots('Unpriced'), { hour: null, half: null, full: null });
  // Nothing merged by name, nothing lost.
  assert.equal(Object.keys(rows).length, 9);
  assert.deepEqual(rows['Raw Footage Handover [on HDD]'], {
    id: 'raw', name: 'Raw Footage Handover [on HDD]', rate: 70, customBill: true, prices: { hour: 98, half: null, full: null },
  });
  assert.equal(rows['Video Capture'].id, 'vc');
  for (const r of Object.values(rows)) {
    for (const old of ['mu', 'hoursPerUnit', 'dayUnit']) assert.equal(r[old], undefined, `${r.name} kept ${old}`);
  }
  // The card it leaves is one the Rate Card can save back.
  assert.equal(pricingProblem(card), null);
  db.close();
});

test('v9 logs every row whose unit of work changed length', (t) => {
  const logs = quietly(t);
  const db = v8Database('v9-log', V8_CARD);
  migrate(db);
  const v9 = logs().filter((l) => l.startsWith('[db] v9: '));
  assert.ok(v9.includes('[db] v9: Production › Drone Day: was 6 hrs a unit, now a full day of 8 hrs. Price kept ($900).'), v9.join('\n'));
  assert.ok(v9.includes('[db] v9: Production › Long block: was 5 hrs a unit, now an hour of 1 hrs. Price kept ($500).'));
  assert.ok(v9.includes('[db] v9: Production › Unpriced: had no price; an hour is now auto.'));
  assert.ok(v9.some((l) => /snapshotted \d+ line\(s\) on 2 estimate\(s\)/.test(l)));
  // Rows whose hours match their slot are not mentioned.
  assert.ok(!v9.some((l) => /Video Capture|Eight-hour|Four-hour|Raw Footage/.test(l)), v9.join('\n'));
  db.close();
});

test('v9 on a database that never saved a card snapshots against the old defaults', (t) => {
  quietly(t);
  const db = v8Database('v9-no-card', null);
  // What these estimates priced from until now: v8's defaults, frozen in the migration.
  const pricedAt = (activeRows, card) => computeTotals(activeRows, card, GST_INC_SETTINGS, { overheadRate: 30 });
  const before = pricedAt(V9_ESTIMATES[0].rows, V8_DEFAULT_PRICING);
  // Three full days and a half day from the old day rows, and the hour of handover.
  // The fixture's other services were never on the default card.
  assert.equal(before.totalHours, 24 + 4 + 1);

  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pricing').get().n, 0, 'no card is written');
  assert.deepEqual(readPricing(db), DEFAULT_PRICING);
  const rows = JSON.parse(db.prepare("SELECT active_rows_json FROM estimates WHERE id = 'est_legacy'").get().active_rows_json);
  assert.deepEqual(pricedAt(rows, readPricing(db)), before);
  db.close();
});

test('v9 on a fresh database changes nothing, and running it again changes nothing', (t) => {
  quietly(t);
  const fresh = openDatabase(tempDbPath('v9-fresh'));
  assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM pricing').get().n, 0);
  assert.deepEqual(readPricing(fresh), DEFAULT_PRICING);
  fresh.close();

  const db = v8Database('v9-twice', V8_CARD);
  migrate(db);
  assert.equal(migrate(db).applied, 0);
  const state = () => JSON.stringify([
    db.prepare('SELECT data_json FROM pricing').all(),
    db.prepare('SELECT id, active_rows_json FROM estimates ORDER BY id').all(),
  ]);
  const once = state();
  // Even forced to run a second time over its own output, v9 is a no-op
  // (and so is every one after it, which run again with it).
  db.prepare('DELETE FROM schema_version WHERE version >= 9').run();
  assert.equal(migrate(db).applied, LATEST_VERSION - 8);
  assert.equal(state(), once);
  db.close();
});

test('the v9 steps leave their inputs alone', () => {
  const card = JSON.parse(JSON.stringify(V8_CARD));
  reshapeCard(card);
  assert.deepEqual(card, V8_CARD);
  const rows = JSON.parse(JSON.stringify(V9_ESTIMATES[0].rows));
  snapshotLegacyLines(rows, V8_CARD);
  assert.deepEqual(rows, V9_ESTIMATES[0].rows);
  // A negative price from before the audit's validation is not carried across.
  const neg = reshapeCard({ labourSections: [{ id: 'p', label: 'P', rows: [{ name: 'Neg', mu: -5 }] }] });
  assert.deepEqual(neg.card.labourSections[0].rows[0].prices, { hour: 0, half: null, full: null });
  assert.equal(neg.notes.length, 1);
});

test('the schema knows it is at v10', () => {
  assert.equal(LATEST_VERSION, 10);
});

/**
 * MIGRATION v10 — goals.vehicle_cost_per_km (estimate-accuracy task 6b). One
 * nullable column: an existing goals row keeps every value and reads the new
 * one as unset, and running it again changes nothing.
 */
test('v10 adds the per-km cost as unset and touches nothing else on goals', () => {
  const db = openDatabase(tempDbPath('v10-upgrade'));
  db.prepare(`
    INSERT INTO goals (id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week,
      billable_hours_per_day, working_days_per_week, leave_days_per_year, sick_days_per_year,
      super_pct, bad_debt_pct, created_at, updated_at)
    VALUES (1, 65000, 25, 34.15, 8, 5, 30, 8, 12, 2, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run();
  const before = db.prepare('SELECT * FROM goals WHERE id = 1').get();
  db.exec('ALTER TABLE goals DROP COLUMN vehicle_cost_per_km;');
  db.prepare('DELETE FROM schema_version WHERE version >= 10').run();

  const result = migrate(db);
  assert.deepEqual([result.from, result.to], [9, 10]);
  const after = db.prepare('SELECT * FROM goals WHERE id = 1').get();
  assert.deepEqual(after, before);
  assert.equal(after.vehicle_cost_per_km, null);

  // Rewound again with the column still there: v10 runs, and nothing moves.
  db.prepare('DELETE FROM schema_version WHERE version >= 10').run();
  assert.equal(migrate(db).applied, 1);
  assert.deepEqual(db.prepare('SELECT * FROM goals WHERE id = 1').get(), before);
  db.close();
});
