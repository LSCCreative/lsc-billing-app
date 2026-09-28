'use strict';

const crypto = require('crypto');
const Database = require('better-sqlite3');

/**
 * Schema migrations, applied in order. Each entry's `version` becomes the value
 * in schema_version once it has run. Never edit a migration that has shipped —
 * add a new one, so an existing billing.db upgrades the same way a fresh one is
 * built.
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(`
        -- The single account. No roles, no second user; the CHECK keeps it that
        -- way rather than relying on the app to remember.
        CREATE TABLE account (
          id            INTEGER PRIMARY KEY CHECK (id = 1),
          username      TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );

        -- Session tokens are stored hashed, so a stolen copy of billing.db does
        -- not hand over a live session.
        CREATE TABLE sessions (
          id           TEXT PRIMARY KEY,
          created_at   TEXT NOT NULL,
          expires_at   TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          user_agent   TEXT,
          ip           TEXT
        );
        CREATE INDEX idx_sessions_expires ON sessions (expires_at);

        -- The CRM.
        CREATE TABLE clients (
          id            TEXT PRIMARY KEY,
          business_name TEXT NOT NULL DEFAULT '',
          contact_name  TEXT NOT NULL DEFAULT '',
          email         TEXT NOT NULL DEFAULT '',
          phone         TEXT NOT NULL DEFAULT '',
          abn           TEXT NOT NULL DEFAULT '',
          address       TEXT NOT NULL DEFAULT '',
          notes         TEXT NOT NULL DEFAULT '',
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );
        CREATE INDEX idx_clients_business ON clients (business_name COLLATE NOCASE);

        CREATE TABLE estimates (
          id              TEXT PRIMARY KEY,
          upid            TEXT NOT NULL DEFAULT '',
          name            TEXT NOT NULL DEFAULT '',
          date            TEXT NOT NULL DEFAULT '',
          status          TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','sent','approved','invoiced','paid')),
          doc_type        TEXT NOT NULL DEFAULT 'estimate'
                            CHECK (doc_type IN ('estimate','invoice')),
          invoice_number  TEXT NOT NULL DEFAULT '',
          -- Link to the CRM record, kept loose on purpose: deleting a client
          -- must never delete or rewrite the estimates they appear on.
          client_id       TEXT REFERENCES clients(id) ON DELETE SET NULL,
          -- The client details as they were when this estimate was saved. This
          -- is what the PDF renders from, so an old quote never changes when a
          -- client's address is edited later.
          client_json     TEXT NOT NULL DEFAULT '{}',
          notes           TEXT NOT NULL DEFAULT '',
          active_rows_json TEXT NOT NULL DEFAULT '{}',
          totals_json     TEXT NOT NULL DEFAULT '{}',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          -- Derived from totals_json rather than stored twice, so the list view
          -- can sort by value without a second source of truth to keep in sync.
          total_inc_gst   REAL GENERATED ALWAYS AS
                            (json_extract(totals_json, '$.totalIncGst')) VIRTUAL
        );
        CREATE INDEX idx_estimates_updated ON estimates (updated_at DESC);
        CREATE INDEX idx_estimates_client  ON estimates (client_id);
        CREATE INDEX idx_estimates_status  ON estimates (status);

        -- Pricing and settings are each one JSON document with one row. They
        -- are edited whole, read whole, and their shape belongs to the UI.
        CREATE TABLE pricing (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          data_json  TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE settings (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          data_json  TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'snapshot labour category labels onto estimates',
    up(db) {
      // The labour category label is printed as a heading on the client-facing
      // PDF (see serviceItemsHtml in pdf.js). Until now it was read from the
      // live rate card at render time, so renaming a category silently
      // re-headed every quote already sent under the old name, and deleting one
      // re-headed them "Archived Services". The label belongs to the estimate
      // for the same reason client_json does: the document was sent, and it
      // must not change afterwards.
      //
      // Existing rows default to '{}' and fall back to the live card, which is
      // the behaviour they have today — no estimate changes when this runs.
      db.exec(`
        ALTER TABLE estimates
          ADD COLUMN section_labels_json TEXT NOT NULL DEFAULT '{}';
      `);
    },
  },
  {
    version: 3,
    name: 'per-estimate GST-free flag',
    up(db) {
      // Being GST-registered does not make every job GST-bearing. Until now GST
      // was all-or-nothing per business (settings.gst.registered), so a GST-free
      // job could only be quoted by switching GST off account-wide, which would
      // have re-priced every other estimate saved afterwards.
      //
      // It lives on the estimate rather than being worked out at render time for
      // the same reason client_json and section_labels_json do: the tax
      // treatment of a document that has already gone to a client must not
      // change underneath it.
      //
      // Existing rows default to 0, which is the behaviour they have today — no
      // estimate's totals change when this runs.
      db.exec(`
        ALTER TABLE estimates
          ADD COLUMN gst_free INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
  {
    version: 4,
    name: 'overhead items, overhead snapshots, and goals',
    up(db) {
      // Foundation for the Finance area (.design/overhead-finance/): an
      // Overhead page tracking real recurring costs, a Goals page stating
      // income/margin targets, and a computed Overhead Rate/hr that replaces
      // the Pricing screen's manually-guessed per-row `rate`. See
      // DESIGN_BRIEF.md for the full rationale. Schema only — nothing here
      // changes what an existing estimate bills.
      db.exec(`
        -- One row per recurring cost. 'category' is a fixed list by design
        -- (the brief's Out of Scope explicitly rules out making it
        -- user-editable), enforced here rather than trusted to the UI alone.
        -- 'frequency' has no list specified anywhere in the brief or its
        -- superseded predecessor as of this migration — weekly/monthly/
        -- quarterly/annual/one_off is this migration's own choice, covering
        -- every recurrence a subscription or annual fee could have. If the
        -- Overhead route/view lands on a different set, add a new migration
        -- to change it rather than editing this one.
        CREATE TABLE overhead_items (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          category   TEXT NOT NULL
                       CHECK (category IN
                         ('software', 'admin_legal', 'marketing', 'hosting', 'tax', 'other')),
          cost       REAL NOT NULL,
          frequency  TEXT NOT NULL
                       CHECK (frequency IN
                         ('weekly', 'monthly', 'quarterly', 'annual', 'one_off')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_overhead_items_category ON overhead_items (category);

        -- Append-only history, one row per overhead add/edit/delete, written by
        -- the CRUD handlers in routes/overhead.js — not its own write route.
        -- Feeds the Overhead tab's trend chart. No update/delete route by
        -- design: it's a log, not editable state.
        CREATE TABLE overhead_snapshots (
          id               TEXT PRIMARY KEY,
          ts               TEXT NOT NULL,
          total_annual     REAL NOT NULL,
          by_category_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX idx_overhead_snapshots_ts ON overhead_snapshots (ts);

        -- Singleton, same pattern as pricing/settings: no row is seeded here.
        -- GET /api/goals falls back to defaults with updatedAt: null until the
        -- first PUT, matching the "a never-saved row is not an empty one"
        -- convention pricing/settings already use.
        --
        -- Deliberately no tax column: Tax Reserve Target reads/writes
        -- pricing.taxSetAsideRate via the existing /api/pricing route. A
        -- second tax field here would violate "one number, one truth" — see
        -- the brief's Design Principles.
        CREATE TABLE goals (
          id                             INTEGER PRIMARY KEY CHECK (id = 1),
          desired_net_income             REAL NOT NULL,
          target_profit_margin_pct       REAL NOT NULL,
          billable_capacity_hrs_per_week REAL NOT NULL,
          created_at                     TEXT NOT NULL,
          updated_at                     TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 5,
    name: 'capacity fields, depreciation assets and lodgement locks',
    up(db) {
      // Foundation for Finance & Price (.design/price-calculator/): real
      // working-days capacity in place of an assumed 48-week year, and a
      // capital-asset register that feeds both the accountant's depreciation
      // schedule and the gear replacement reserve inside the overhead rate.
      // Schema only — nothing here changes what an existing estimate bills.
      //
      // FOUR DECISIONS THIS MIGRATION MAKES ON ITS OWN, because no design doc
      // specifies them. Each follows v4's precedent for `frequency`: the choice
      // is made here, recorded here, and changed by a NEW migration if a route
      // or view later lands somewhere else.
      //
      //   1. `business_use_pct` STORES A PERCENT (100 means 100%), not a
      //      fraction. The IA doc writes the arithmetic as
      //      `decline × business_use_pct`, which reads like a fraction, but
      //      `goals.target_profit_margin_pct` already establishes the
      //      convention that a _pct column holds 0–100 and calc.js divides. A
      //      fraction here would be the only _pct column in the schema that
      //      isn't. THE DEPRECIATION CHAIN MUST DIVIDE BY 100 — getting this
      //      wrong is a silent 100× error on every deduction, which is exactly
      //      the units trap calc.js's header warns about.
      //   2. `category` needs an enum and none is specified. The list below is
      //      this migration's own, chosen for a videography business.
      //      `vehicle` is not optional: step 2 of the depreciation chain caps
      //      cars at the car limit, and without the category nothing can tell
      //      which assets that applies to.
      //   3. `car_limit` is a column even though the task's field list omits
      //      it. Step 2 of the chain needs a user-entered limit, and it is
      //      per-asset rather than global because the limit that applies is the
      //      one in force for the FY the car was first used — a 2019 car and a
      //      2026 car are capped differently and always will be. A nullable
      //      column now is cheaper than a second migration during the
      //      depreciation task.
      //   4. `depreciation_locks` has NO unique constraint on `fy_label`. A
      //      re-lodgement is an amendment, and amendments are exactly what an
      //      append-only log should keep. READERS MUST TAKE THE MOST RECENT ROW
      //      PER FY (`ORDER BY locked_at DESC LIMIT 1`), not assume one.
      db.exec(`
        -- ── Capacity ────────────────────────────────────────────────────────
        -- The four fields that replaced the assumed 48-week year. Annual
        -- billable hours are DERIVED from these by calc.js's
        -- annualBillableHours(), never stored: a stored copy would be a second
        -- truth to keep in sync.
        --
        -- SEEDED WITH THE REFERENCE DEFAULTS (8 / 5 / 30 / 8), not derived from
        -- billable_capacity_hrs_per_week. Leave and sick days cannot be
        -- recovered from a single weekly figure, and splitting one into the
        -- other two would be inventing the user's leave. The Capacity screen
        -- flags these as defaults to confirm, which is the honest version of
        -- not knowing.
        --
        -- LEAVE AND SICK DAYS ARE WORKING DAYS, NOT CALENDAR DAYS. Four weeks
        -- off is 20, not 28. The entry labels carry that burden; nothing here
        -- can tell the difference.
        ALTER TABLE goals ADD COLUMN billable_hours_per_day  REAL NOT NULL DEFAULT 8;
        ALTER TABLE goals ADD COLUMN working_days_per_week   REAL NOT NULL DEFAULT 5;
        ALTER TABLE goals ADD COLUMN leave_days_per_year     REAL NOT NULL DEFAULT 30;
        ALTER TABLE goals ADD COLUMN sick_days_per_year      REAL NOT NULL DEFAULT 8;

        -- The instant-asset-write-off threshold, used only to decide when the
        -- Overhead form should ask "is this actually a capital asset?".
        --
        -- NULLABLE ON PURPOSE, AND NOT DEFAULTED. This figure moves with the
        -- federal budget, so a schema default would be the hardcoded ATO
        -- threshold the design explicitly refuses — the screen shows the
        -- current figure as a placeholder with a confirm-with-your-accountant
        -- note, and NULL means the user has not confirmed one. A default of 0
        -- would be worse than NULL: every one-off expense exceeds 0, so the
        -- double-count hint would fire on all of them and be trained away.
        ALTER TABLE goals ADD COLUMN iawo_threshold REAL;

        -- billable_capacity_hrs_per_week (added in v4) IS DELIBERATELY KEPT.
        -- LEGACY, DISPLAY-ONLY: recomputed on save as annualBillableHours ÷ 52,
        -- read by nothing, safe to drop in a later migration. Dropping it here
        -- would mean a table rebuild and a migration that cannot infer the
        -- leave and sick values it would have to replace it with. It is NOT an
        -- input to any rate any more — do not start computing from it, and do
        -- not delete it mid-feature. calc.js's annualBillableHoursFromGoals()
        -- reads it only through a transitional branch that the Capacity screen
        -- task removes.

        -- ── Capital assets ──────────────────────────────────────────────────
        -- One row per item of gear. Depreciation schedules are COMPUTED ON READ
        -- from these rows and never stored, so they cannot drift from the
        -- assets they describe; the only stored figures are the lodgement
        -- snapshots below.
        CREATE TABLE depreciation_assets (
          id                        TEXT PRIMARY KEY,

          -- Identity
          name                      TEXT NOT NULL,
          category                  TEXT NOT NULL
                                      CHECK (category IN
                                        ('camera', 'lens', 'lighting', 'audio',
                                         'computer', 'drone', 'vehicle', 'other')),
          serial_number             TEXT NOT NULL DEFAULT '',
          supplier                  TEXT NOT NULL DEFAULT '',

          -- Acquisition. TWO DATES, BOTH REQUIRED, AND THEY ARE NOT THE SAME:
          -- purchase_date is when it was bought; start_date is the ATO "start
          -- time", when it was first used or installed ready for use, and it is
          -- the one daysHeld runs from. A camera bought in June and first used
          -- in July belongs to the next financial year.
          purchase_date             TEXT NOT NULL,
          start_date                TEXT NOT NULL,

          -- cost_inc_gst is what was paid. The cost base subtracts gst_amount
          -- only when the credit was actually claimed, which is why the flag is
          -- per asset rather than read from settings.gst: registration status
          -- changes over time and an asset's cost base is fixed at acquisition.
          cost_inc_gst              REAL NOT NULL,
          gst_amount                REAL NOT NULL DEFAULT 0,
          gst_credit_claimed        INTEGER NOT NULL DEFAULT 0
                                      CHECK (gst_credit_claimed IN (0, 1)),

          -- ATO treatment. The two pool methods are POOL-LEVEL: such a row
          -- contributes its cost base to a pool balance rather than having a
          -- decline of its own, and the schedule renders pool rows separately.
          method                    TEXT NOT NULL
                                      CHECK (method IN
                                        ('diminishing_value', 'prime_cost', 'instant_writeoff',
                                         'small_business_pool', 'low_value_pool')),
          effective_life_years      REAL,
          -- 0–100, A PERCENT — see decision 1 in the comment above. Divide by
          -- 100 before multiplying anything by it.
          business_use_pct          REAL NOT NULL DEFAULT 100
                                      CHECK (business_use_pct >= 0 AND business_use_pct <= 100),
          -- NULL means "this asset starts at its cost base". A value is for
          -- gear that was already part-depreciated when it was entered, so the
          -- schedule does not restart a three-year-old camera at full value.
          opening_adjustable_value  REAL,
          -- Vehicles only; NULL for everything else. See decision 3.
          car_limit                 REAL,

          -- Pricing. These drive the replacement reserve inside the overhead
          -- rate and have nothing to do with tax. replacement_cost_estimate is
          -- deliberately NOT historical cost: pricing has to recover what the
          -- NEXT body costs.
          replacement_cycle_years   REAL,
          replacement_cost_estimate REAL,

          -- Disposal. NULL disposal_date is the "still held" signal, and it is
          -- what replacementReserveTotal() filters on — sold gear must stop
          -- inflating overhead immediately, while staying on its disposal FY's
          -- schedule for the balancing adjustment.
          disposal_date             TEXT,
          disposal_proceeds         REAL,
          disposal_reason           TEXT NOT NULL DEFAULT '',

          notes                     TEXT NOT NULL DEFAULT '',
          created_at                TEXT NOT NULL,
          updated_at                TEXT NOT NULL
        );
        -- The register sorts by category then start date, and the schedule
        -- filters by held-in-FY, which is start_date plus disposal_date.
        CREATE INDEX idx_depreciation_assets_category ON depreciation_assets (category, start_date);
        CREATE INDEX idx_depreciation_assets_start ON depreciation_assets (start_date);
        CREATE INDEX idx_depreciation_assets_disposal ON depreciation_assets (disposal_date);

        -- ── Lodgement locks ─────────────────────────────────────────────────
        -- Append-only, one row per "Mark FY as lodged". Same discipline and the
        -- same reasoning as overhead_snapshots: it is a log, not editable
        -- state, so there is no update route and no delete route.
        --
        -- Why it exists at all: schedules are recomputed from the assets on
        -- every read, so editing an asset's effective life in 2027 would
        -- silently rewrite what was filed in 2026. figures_json is that year's
        -- computed figures frozen at lodgement; the schedule shows them with a
        -- badge and FLAGS DIVERGENCE if live recomputation now disagrees,
        -- rather than quietly adopting the new numbers.
        --
        -- No UNIQUE on fy_label — see decision 4. Take the latest row per FY.
        CREATE TABLE depreciation_locks (
          id           TEXT PRIMARY KEY,
          fy_label     TEXT NOT NULL,
          locked_at    TEXT NOT NULL,
          figures_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX idx_depreciation_locks_fy ON depreciation_locks (fy_label, locked_at);
      `);
    },
  },
  {
    version: 6,
    name: 'goals: income and margin may be unset, capacity confirmation',
    up(db) {
      // Two changes the Capacity screen needs, both about telling "not set"
      // apart from a real number.
      //
      // 1. desired_net_income AND target_profit_margin_pct BECOME NULLABLE.
      //    v4 made them NOT NULL because one screen (Goals) wrote all three
      //    fields at once. Capacity is now a second writer to the same
      //    singleton row, and it can be the FIRST — the IA doc's first-run flow
      //    goes Dashboard → Capacity → save before Profit Goals is ever opened.
      //    With NOT NULL, that first insert has to invent an income and a
      //    margin, and the only candidate is 0. A 0% margin is not an empty
      //    state: minimumJobPrice() accepts it as "break even" and the floor
      //    renders as a real figure that nobody chose. NULL keeps the em-dash
      //    set-up prompt, which is what an unset margin already means
      //    everywhere else (GET returns nulls for a row that doesn't exist).
      //
      // 2. capacity_confirmed_at IS NEW. v5 seeded 8 / 5 / 30 / 8 onto every
      //    row, and the Capacity screen must flag those as defaults until the
      //    user confirms them. Comparing against 8/5/30/8 can't answer that —
      //    they are the user's own reference-spreadsheet figures, so a person
      //    who genuinely works them would be nagged forever. So the route
      //    stamps this when a PUT carries all four capacity fields (only the
      //    Capacity screen does), and NULL means "never confirmed".
      //
      // SQLite cannot drop a NOT NULL constraint in place, so the table is
      // rebuilt. Every column and value is carried across unchanged, including
      // the legacy billable_capacity_hrs_per_week (still NOT NULL: the route
      // always computes it) and v5's seeded capacity fields. No foreign key
      // references goals, so the drop is safe with foreign_keys = ON.
      db.exec(`
        CREATE TABLE goals_v6 (
          id                             INTEGER PRIMARY KEY CHECK (id = 1),
          desired_net_income             REAL,
          target_profit_margin_pct       REAL,
          billable_capacity_hrs_per_week REAL NOT NULL,
          created_at                     TEXT NOT NULL,
          updated_at                     TEXT NOT NULL,
          billable_hours_per_day         REAL NOT NULL DEFAULT 8,
          working_days_per_week          REAL NOT NULL DEFAULT 5,
          leave_days_per_year            REAL NOT NULL DEFAULT 30,
          sick_days_per_year             REAL NOT NULL DEFAULT 8,
          iawo_threshold                 REAL,
          capacity_confirmed_at          TEXT
        );
        INSERT INTO goals_v6 (
          id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week,
          created_at, updated_at, billable_hours_per_day, working_days_per_week,
          leave_days_per_year, sick_days_per_year, iawo_threshold, capacity_confirmed_at
        )
        SELECT
          id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week,
          created_at, updated_at, billable_hours_per_day, working_days_per_week,
          leave_days_per_year, sick_days_per_year, iawo_threshold, NULL
        FROM goals;
        DROP TABLE goals;
        ALTER TABLE goals_v6 RENAME TO goals;
      `);
    },
  },
  {
    version: 7,
    name: 'money-math audit: tax years, super, bad debt, resale, opening-value FY',
    up(db) {
      // From the 2026-09-28 money-math audit (.design/price-calculator/
      // HANDOVER.md, "What landed — audit fixes"). All additive: nullable
      // columns and one new table, no rebuild.
      //
      // 1. tax_years — the ATO resident income-tax brackets and Medicare levy,
      //    one row per financial year, ENTERED AND CONFIRMED BY THE USER. They
      //    change with the federal budget, so nothing here seeds them: the
      //    Profit Goals screen prefills placeholders the user saves as theirs,
      //    the same rule as effective lives and the write-off threshold.
      //    brackets_json is [{ from, ratePct }, …], ascending, PERCENT (15 is
      //    15%), matching how a tax table is printed. medicare_levy_pct is a
      //    percent too.
      //
      // 2. goals.super_pct / goals.bad_debt_pct — PERCENT, nullable (unset is
      //    0, and says so on screen). Super is the personal concessional
      //    contribution the owner wants on top of their pay; bad debt is the
      //    share of invoices expected never to be paid.
      //
      // 3. depreciation_assets.expected_resale_value — what the old body will
      //    sell for at replacement. The reserve recovers replacement cost LESS
      //    this. Nullable: unset is 0.
      //
      // 4. depreciation_assets.opening_value_fy — the FY an
      //    opening_adjustable_value applies FROM. Without it the override was
      //    applied at start_date's FY and then declined again for every year
      //    since, double-depreciating gear entered part-way through its life.
      //    Backfilled from created_at for every row that already carries an
      //    override, because the form described it as the value "when you
      //    entered it here".
      db.exec(`
        CREATE TABLE tax_years (
          fy_label          TEXT PRIMARY KEY,
          brackets_json     TEXT NOT NULL,
          medicare_levy_pct REAL NOT NULL CHECK (medicare_levy_pct >= 0 AND medicare_levy_pct < 100),
          updated_at        TEXT NOT NULL
        );
        ALTER TABLE goals ADD COLUMN super_pct REAL;
        ALTER TABLE goals ADD COLUMN bad_debt_pct REAL;
        ALTER TABLE depreciation_assets ADD COLUMN expected_resale_value REAL;
        ALTER TABLE depreciation_assets ADD COLUMN opening_value_fy TEXT;
      `);

      const { fyLabel } = require('./calc');
      const rows = db.prepare(
        'SELECT id, created_at FROM depreciation_assets WHERE opening_adjustable_value IS NOT NULL'
      ).all();
      const set = db.prepare('UPDATE depreciation_assets SET opening_value_fy = ? WHERE id = ?');
      for (const r of rows) set.run(fyLabel(String(r.created_at || '').slice(0, 10)), r.id);
    },
  },
  {
    version: 8,
    name: 'overhead_items: five more operating-cost categories',
    up(db) {
      // Asked for by the user 2026-09-28: Motor vehicle expenses, Mobile phone
      // and internet, Home office, Advertising and marketing, Training and
      // education. "Advertising and marketing" is the existing 'marketing'
      // value with a new label (views/overhead.js) — a second marketing
      // category beside the first would split one kind of cost across two
      // slices of the donut. So four new values, and no row changes category.
      //
      // SQLite can't alter a CHECK in place, so the table is rebuilt — the same
      // pattern as v6. Every column and row is carried across unchanged, and
      // nothing references overhead_items, so the drop is safe with
      // foreign_keys = ON. overhead_snapshots keys its by_category_json on
      // these same values and needs no change.
      db.exec(`
        CREATE TABLE overhead_items_v8 (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          category   TEXT NOT NULL
                       CHECK (category IN
                         ('software', 'admin_legal', 'marketing', 'hosting', 'tax', 'other',
                          'motor_vehicle', 'phone_internet', 'home_office', 'training')),
          cost       REAL NOT NULL,
          frequency  TEXT NOT NULL
                       CHECK (frequency IN
                         ('weekly', 'monthly', 'quarterly', 'annual', 'one_off')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO overhead_items_v8 (id, name, category, cost, frequency, created_at, updated_at)
          SELECT id, name, category, cost, frequency, created_at, updated_at FROM overhead_items;
        DROP TABLE overhead_items;
        ALTER TABLE overhead_items_v8 RENAME TO overhead_items;
        CREATE INDEX idx_overhead_items_category ON overhead_items (category);
      `);
    },
  },
  {
    version: 9,
    name: 'rate card: each service priced per hour, half day and full day',
    up(db) {
      // .design/service-rate-tiers/ (2026-09-28). No table changes: this
      // rewrites the JSON in pricing.data_json and estimates.active_rows_json.
      // Snapshot every legacy estimate line against the OLD card first, then
      // reshape the card (labour rows' mu / hoursPerUnit / dayUnit become
      // prices: { hour, half, full }, and the card gains serviceDay), then log
      // every row whose unit of work changed length. The steps, and why that
      // order, are in migrations/v9-service-units.js.
      require('./migrations/v9-service-units').migrateV9(db);
    },
  },
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function nowIso() {
  return new Date().toISOString();
}

/** Short, readable, collision-resistant ids: est_9f3a1c2b. */
function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function currentVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  return row && row.v ? row.v : 0;
}

/**
 * Applies any migrations newer than the file's recorded version. Safe to run on
 * a fresh file and on an existing one; running it twice does nothing the second
 * time.
 */
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const from = currentVersion(db);
  if (from > LATEST_VERSION) {
    throw new Error(
      `billing.db is at schema version ${from}, but this build only knows up to ` +
      `${LATEST_VERSION}. Refusing to run against a newer database.`
    );
  }

  const pending = MIGRATIONS.filter((m) => m.version > from);
  const record = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)');

  for (const migration of pending) {
    // Each migration lands whole or not at all.
    db.transaction(() => {
      migration.up(db);
      record.run(migration.version, nowIso());
    })();
    console.log(`[db] migrated to v${migration.version} — ${migration.name}`);
  }

  return { from, to: currentVersion(db), applied: pending.length };
}

/**
 * Opens billing.db, verifies it, and brings the schema up to date.
 *
 * A file that fails its integrity check is left exactly as it is: the server
 * refuses to start rather than writing over damaged data that a backup could
 * still be recovered from.
 */
function openDatabase(file, options = {}) {
  const db = new Database(file, { fileMustExist: false });

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // WAL + NORMAL is durable across process crashes; only a host power-cut can
  // lose the last transaction, which the nightly backup covers.
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  const check = db.pragma('quick_check', { simple: true });
  if (check !== 'ok') {
    db.close();
    throw new Error(
      `billing.db failed its integrity check (${check}). The file has NOT been ` +
      `modified. Restore the most recent copy from the backups directory before ` +
      `starting the server again.`
    );
  }

  if (options.migrate !== false) migrate(db);

  return db;
}

module.exports = { openDatabase, migrate, newId, nowIso, LATEST_VERSION };
