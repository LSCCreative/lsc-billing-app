# Build Tasks: Finance & Price (Price Calculator)

Generated from: `.design/price-calculator/DESIGN_BRIEF.md` + `.design/price-calculator/INFORMATION_ARCHITECTURE.md`
Date: 27 September 2026

Model/effort tag on every task per root `CLAUDE.md`'s buckets, following the same convention as
`.design/overhead-finance/TASKS.md` so nobody re-derives it: **(money math — Opus/high)** for
anything touching `calc.js`, the rate formulas, the depreciation chain, or a screen that *renders* a
computed money figure — CLAUDE.md is explicit this applies "regardless of how small the diff looks";
**(backend — Sonnet/high)** for plain routes, migrations and their tests; **(frontend — Opus/high)**
for UI-build work, per CLAUDE.md's UI-port bucket.

**More of this feature sits in the money-math bucket than is usual**, because the arithmetic order in
the IA doc is where the accounting accuracy lives and most screens render a figure derived from it.
Don't downgrade a task to Sonnet because its diff looks like plain UI.

The acceptance gate is unchanged: **`cd server && npm test`** after any backend change. New routes get
tests in `server/test/test-api.js` (ephemeral port, log in once in `test.before`, reuse the cookie).
New pure functions get tests in `server/test/test-calc.js` following its worked-example pattern. A
green suite is **not** the gate on its own for anything a person looks at — the Dashboard floors, the
schedule, the comparison badges — open those in a browser against the live API and check them.

`calc.js` exists as two byte-identical copies (`server/src/calc.js` and `web/js/calc.js`). Every
change to it is two identical edits. A task that edits one and not the other is not done.

---

## Foundation

- [x] **Fix `totalHours` — add `hoursPerUnit` to rate-card rows** (money math — Opus/high): `computeTotals` currently does `totalHours += qty` for every labour row unconditionally (`server/src/calc.js:137`), and `minimumJobPrice` allocates overhead across that figure (`web/js/views/estimate-editor.js:629`). Change to `totalHours += qty × (def.hoursPerUnit ?? 1)`. **Default of 1 is the whole safety argument** — every existing rate-card row and every already-saved estimate must total *identically* after this change. Add tests in `test-calc.js`: (a) a card with no `hoursPerUnit` anywhere produces byte-identical totals to today's, (b) a row with `hoursPerUnit: 10` and `qty: 2` contributes 20 hours, (c) a malformed `hoursPerUnit` (`0`, `null`, `"abc"`, negative) falls back to 1 rather than zeroing the row's overhead allocation — a zero here silently removes a shoot from the overhead calculation, which is the expensive direction. Update the docblock in the same decision-recording style as the file's existing GST-free note: state that day-unit rows exist, why hours and quantity are no longer the same thing, and that `minimumJobPrice` depends on this. _Modifies: `server/src/calc.js` + `web/js/calc.js` (identical). **This goes first and alone.** It is a live defect, it is the prerequisite for every day-rate task below, and it must be provably behaviour-preserving before anything is built on it._

  **Done 2026-09-27.** The functional change is four lines: `hoursPerUnitOf(def)`
  (`parseFloat`, then `> 0 ? h : 1`), `totalHours += qty * hoursPerUnitOf(def)`, and the helper
  added to both export shapes — **it is exported on purpose**, so the Rate Card's day-rate prefill
  and the Dashboard's full-day floor use this one fallback instead of each re-deciding what a blank
  cell means. Everything else in the diff is the docblock. Six tests added to `test-calc.js`; the
  behaviour-preservation one pins the *whole* totals object for the worked `JOB` on a GST-inclusive
  card (no row in `DEFAULT_PRICING` carries `hoursPerUnit`), so a regression cannot hide in a field
  nobody asserted on. Both mutations were checked to fail: reverting the multiplier breaks 3 tests,
  and a fallback of `0` instead of `1` breaks 8 — including `minimumJobPrice`'s own. Suite: 97 pass,
  0 fail. **No route change was needed** — `PUT /api/pricing` stores the rate card as whole-document
  JSON with no field whitelist (`server/src/routes/pricing.js`), so `hoursPerUnit` persists as soon
  as the Rate Card screen writes it.

- [x] **Capacity math — `annualBillableHours()`, and `overheadRatePerHour()` changes meaning** (money math — Opus/high): Add `annualBillableHours({ billableHoursPerDay, workingDaysPerWeek, leaveDaysPerYear, sickDaysPerYear })` returning `((workingDaysPerWeek × 52) − leaveDays − sickDays) × billableHoursPerDay`, or `null` when any input is missing or when `leave + sick >= workingDaysPerYear` (a zero or negative capacity makes every downstream rate nonsense — `null` renders as the em-dash set-up prompt, per existing convention). **Then change `overheadRatePerHour`'s second parameter from hours-per-week to annual billable hours** and retire `WEEKS_PER_YEAR = 48`. All four call sites move in the same commit (`routes/goals.js`, `views/goals.js`, `views/pricing.js`, and `calc.js`'s own internal use — grep for `billableCapacity` and `WEEKS_PER_YEAR` to confirm the set before starting). Tests: the worked example from the brief — `(5 × 52 − 30 − 8) × 8 = 1,776` hours — plus a test pinning the **new** parameter semantics so a future reader cannot mistake it for hours-per-week, plus the leave-exceeds-working-days guard. Document in the header why 48 weeks died: it was an assumed four weeks of downtime, and the four real fields replace it, raising every overhead-derived rate ~8% knowingly. _Modifies: `server/src/calc.js` + `web/js/calc.js`, and every call site. **Highest-risk task in the feature** — it moves every rate on the card. Depends on: nothing. Do it second, while nothing is built on top._

  **Done 2026-09-27.** `annualBillableHours()` and `annualBillableHoursFromGoals()` added,
  `overheadRatePerHour()`'s second parameter is now annual hours and multiplies by nothing,
  `WEEKS_PER_YEAR = 48` is gone. 104 tests pass. Five mutations were checked to fail (9 / 13 / 3 / 3 /
  3 tests respectively), including reinstating a `× 48` inside `overheadRatePerHour` and flipping the
  `leave + sick >= workingDays` guard to `>`.

  **Two corrections to this task as written, for whoever audits it:**

  1. **The call-site list was wrong.** `routes/goals.js` and `views/goals.js` never call
     `overheadRatePerHour` — the route only stores the column, and `goals.js` uses
     `annualOverheadTotal` + `targetAnnualRevenue` only. The real live callers are
     **`views/pricing.js:665`** and **`views/estimate-editor.js:1100`**, and the editor was not on
     this task's list at all even though it is the one feeding the Minimum Job Price floor. Both were
     changed.
  2. **A build-order gap needed a bridge.** The four capacity columns do not exist until the
     migration task and do not reach the browser until the routes task, both of which come *after*
     this one. Swapping the parameter's meaning with nothing else changed would have turned the live
     rate card's $25/hr into $1,200/hr for the duration. So
     **`annualBillableHoursFromGoals(goals)`** was added: it prefers the four new fields and falls
     back to annualising the legacy `billableCapacityHrsPerWeek` column at the retired 48 when they
     are absent. Verified against `git HEAD`'s `calc.js` that **every** legacy goals row — 5, 12.5,
     20, 30, 37.5, 40 hrs/week, plus `0` / `null` / `undefined` / negative — produces the identical
     rate, empty states included. The intended ~8% rise (12.50 → 13.51 on the fixture book) arrives
     only when the Capacity screen writes real fields. **The Capacity screen task must delete the
     legacy branch and `LEGACY_WEEKS_PER_YEAR`** — this is now noted on that task too.

- [x] **Migration — capacity columns, `depreciation_assets`, `depreciation_locks`** (backend — Sonnet/high): One new versioned migration in `server/src/db.js`, following the existing pattern exactly (never edit a shipped migration). Adds to `goals`: `billable_hours_per_day`, `working_days_per_week`, `leave_days_per_year`, `sick_days_per_year`, `iawo_threshold`. **Seeds them with the reference defaults (8 / 5 / 30 / 8) rather than deriving from `billable_capacity_hrs_per_week`** — leave and sick days cannot be inferred from a single weekly figure, and inventing them would be fabrication; the Capacity screen flags them as defaults to confirm. Leaves `billable_capacity_hrs_per_week` in place with a schema comment reading *legacy, display-only, recomputed on save as `annualBillableHours ÷ 52`, read by nothing, safe to drop in a later migration* — without that comment the next agent either deletes it mid-feature or starts computing from it. New `depreciation_assets` table per the IA doc's field list: identity (`name`, `category`, `serial_number`, `supplier`), acquisition (`purchase_date`, `start_date`, `cost_inc_gst`, `gst_amount`, `gst_credit_claimed`), ATO treatment (`method`, `effective_life_years`, `business_use_pct`, `opening_adjustable_value`), pricing (`replacement_cycle_years`, `replacement_cost_estimate`), disposal (`disposal_date`, `disposal_proceeds`, `disposal_reason`), plus `notes`, `created_at`, `updated_at`. `CHECK` constraints on `method` and `category`, matching how `overhead_items` constrains its own enums. New `depreciation_locks`: `id`, `fy_label`, `locked_at`, `figures_json` — **append-only, no update or delete route**, same discipline and same reasoning as `overhead_snapshots` (it's a log, not editable state). Verify against a fresh DB *and* against the real dev DB. _New. Depends on: nothing._

  **Done 2026-09-27** as migration **v5**. Verified on a fresh DB, on a copy of the dev DB (which is
  at v1, so that exercised the whole 1→5 chain), and — the case that actually matters — on a v4
  database built from `git HEAD`'s `db.js` with a real goals row, which kept every value and gained
  the 8/5/30/8 seeds with `iawo_threshold` NULL. `migrate()` is idempotent on re-run. 111 tests pass.
  The dev DB on disk was not touched.

  **Four decisions this migration had to make on its own**, all recorded in its SQL comments because
  no design doc specifies them:

  1. **`business_use_pct` stores a PERCENT (0–100), not a fraction.** The IA doc writes
     `decline × business_use_pct`, which reads like a fraction, but `goals.target_profit_margin_pct`
     already sets the convention that a `_pct` column holds 0–100 and `calc.js` divides. **The
     depreciation chain must divide by 100** — a fraction/percent mix-up here is a silent 100× error
     on every deduction, which is precisely the units trap `calc.js`'s header warns about. A `CHECK
     (0..100)` now exists so a `0.6` meant as 60% is rejected rather than quietly deducted.
  2. **The `category` enum is this migration's own choice** — none is specified anywhere. Chose
     `camera / lens / lighting / audio / computer / drone / vehicle / other`, following v4's precedent
     for `frequency` (documented as this migration's choice, changed by a new migration if a view
     lands elsewhere). **`vehicle` is not optional**: step 2 of the chain caps cars at the car limit
     and nothing else can identify which assets those are.
  3. **`car_limit` was added even though this task's field list omits it.** Step 2 of the IA doc's
     chain requires a user-entered limit, and it is per-asset rather than global because the limit
     that applies is the one in force for the FY the car was first used. A nullable column now is
     cheaper than a second migration during the depreciation task.
  4. **`depreciation_locks` has no UNIQUE on `fy_label`** — a re-lodgement is an amendment and an
     append-only log should keep both. **Readers must take the latest row per FY**
     (`ORDER BY locked_at DESC LIMIT 1`), which the CSV/lock task needs to honour.

  Also: `iawo_threshold` is **nullable with no default**, not `NOT NULL DEFAULT 20000`. The design
  says ATO thresholds stay user-entered with the current figure as a *placeholder*; a schema default
  would be exactly the hardcode it refuses. A `0` default would be worse — every one-off expense
  exceeds 0, so the double-count hint would fire on all of them and be trained away.

  **One finding for the Capacity screen task:** the seeds are 1,776 annual hours, while a legacy row
  saying 20 hrs/week annualises to 960. Accepting the seeds unexamined would nearly *halve* that
  user's overhead rate. The before/after on that screen's save confirm is a real guard, not a nicety
  — a test pins the gap.

- [x] **Cost of the business — `annualBusinessCost()` and the replacement reserve** (money math — Opus/high): Add `replacementReserveTotal(assets)` = Σ over **non-disposed** assets of `(replacement_cost_estimate ÷ replacement_cycle_years) × business_use_pct`, and `annualBusinessCost(items, assets)` = `annualOverheadTotal(items) + replacementReserveTotal(assets)`. Three decisions to record in the docblock, all from the IA doc: `replacement_cost_estimate` not historical cost (pricing must recover what the *next* body costs); straight-line over the user's own cycle not the ATO effective life (diminishing value would swing the day rate 30–40% for gear still in daily use); apportioned by `business_use_pct` (only the business share of a part-personal laptop is a business cost). **Leave `annualOverheadTotal()`'s name and behaviour untouched** so existing tests keep passing; screens move to `annualBusinessCost`. Also add the shared **Australian FY helper** here — `currentFinancialYear()`, `fyBounds(label)`, `fyLabel(date)` for the 1 July – 30 June year, formatted `FY 2025–26`. Nothing anywhere computes a year inline: `new Date().getFullYear()` is wrong for half the year. Tests: a disposed asset contributes nothing; a 50%-business asset contributes half; the FY helper across the 30 June / 1 July boundary in both directions. _Modifies: `server/src/calc.js` + `web/js/calc.js`. Depends on: the migration (for the asset shape)._

  **Done 2026-09-27.** `replacementReserveTotal()`, `annualBusinessCost()`, and the FY helper —
  `currentFinancialYear()`, `fyLabel()`, `fyBounds()` plus a fourth, `fyDisplay()`.
  `annualOverheadTotal()` untouched. 125 tests pass; six mutations checked to fail.

  **Three things this task needed that the spec did not cover:**

  1. **Field-name casing is a live trap, now handled.** Routes map rows to camelCase for the browser,
     but server-side callers pass **raw snake_case rows** into `calc.js` — `writeSnapshot()` in
     `routes/overhead.js` already does. Every earlier function survived that because `cost` and
     `frequency` are one word; `replacement_cost_estimate` is not. A raw row read camelCase-only
     returns **0**, silently removing the reserve from the overhead rate and under-pricing every job.
     `field(obj, camel, snake)` reads either shape, and a test pins that both agree. **The routes and
     depreciation tasks can pass either shape** — do not add a mapping step on the assumption one is
     required.
  2. **`fyDisplay()` is a fourth FY function, because the label has two forms.** The IA doc specifies
     `FY 2025–26` (en dash) for display, while the routes task uses `?fy=FY2025-26` in a URL. Those
     are different strings and an equality check between them fails. Canonical is **`FY2025-26`** —
     no space, plain hyphen — and that is what gets stored in `depreciation_locks.fy_label`, queried,
     compared and put in the CSV filename. `fyDisplay()` renders the en-dash form; `fyBounds()`
     parses either, plus `FY2025-2026` and a bare `2025-26`. A bare `2025` is **rejected**, not
     guessed — it cannot say which FY it means. So is `FY2025-27`, which is a typo rather than a range.
  3. **`fyLabel()` parses date-only strings textually, never through `Date`.** `new Date('2026-07-01')`
     is UTC midnight; read back with local getters west of Greenwich that is 30 June — the **previous
     financial year** — so an asset first used on the first day of the year files its whole decline
     twelve months early. 30 June cannot expose this (shifted back it is still June), so the test pins
     **1 July** across five timezones in a child process, because `Date`'s zone is fixed at startup and
     this host is UTC+10. **The defect is invisible on the dev machine and on the NAS if its container
     is UTC** — that test is the only thing standing between the code and a wrong tax return.

  Also settled: a **disposed asset leaves the reserve immediately** but stays on its disposal FY's tax
  schedule — the two chains are meant to disagree about a sold camera. A missing `business_use_pct`
  reads as **100%**, matching the column DEFAULT and erring towards keeping a cost in.
  `replacementReserveTotal` returns **0, not null**, for no assets, so it is safe to add to
  `annualOverheadTotal` without null-checking every term.

- [x] **The ATO depreciation chain** (money math — Opus/high): Add `declineInValue(asset, fyLabel)` and `assetSchedule(asset, fyLabel)` implementing the IA doc's five-step order exactly: (1) `costBase = cost_inc_gst − (gst_credit_claimed ? gst_amount : 0)`; (2) cap at the user-entered car limit for vehicles; (3) method-specific decline, pro-rata `daysHeld ÷ 365` — `diminishing_value: base × (daysHeld ÷ 365) × (200% ÷ life)`, `prime_cost: costBase × (daysHeld ÷ 365) × (100% ÷ life)`, `instant_writeoff: costBase` in the first FY only; (4) `deductible = decline × business_use_pct`; (5) `adjustableValue −= decline` — **the full decline, not the apportioned one.** Step 4 vs 5 is the one to get right: apportioning both is the common error and it overstates the closing value of every part-personal asset for the rest of its life. Add a test that fails if someone "simplifies" them into one. `daysHeld` runs from **`start_date`**, not `purchase_date`, and ends at FY end or `disposal_date`. `÷ 365` even in a leap year, and `200%` is a named constant carrying the "assets held from 10 May 2006" date in its comment so nobody corrects it to 150%. Also `balancingAdjustment(asset)` = `(disposal_proceeds − adjustableValue) × business_use_pct`, belonging to the disposal FY. Pools are **pool-level**: `poolSchedule(assets, fyLabel)` for `small_business_pool` (15% first FY, 30% after) and `low_value_pool` (18.75%, then 37.5%) — a pooled asset contributes its cost base to a balance rather than pretending to have its own decline. Cents throughout via `round2`; no pre-rounding to whole dollars. Tests: a worked example per method with a mid-year `start_date`; a 60%-business asset checking steps 4 and 5 diverge correctly; a disposal mid-FY; a pool with two assets added in different years. _Modifies: `server/src/calc.js` + `web/js/calc.js` — or a sibling `depreciation.js` if `calc.js` is getting crowded, matching whichever keeps the decision-docblock convention intact. **The largest and second-riskiest task.** Depends on: `annualBusinessCost` (for the FY helper)._

  **Done 2026-09-27**, in a **sibling `depreciation.js`** (server + web, byte-identical, own drift
  test) — `calc.js` was at 867 lines and this would have pushed it past 1,300. `calc.js` now exports
  `numOrNull`, `field` and `businessUseShare` for it. **New `<script src="js/depreciation.js">` in
  `web/index.html`, after `calc.js`.** 156 tests pass; ten mutations checked to fail.

  Implemented: `costBaseOf`, `daysHeldInFy`, `declineInValue`, `assetSchedule`, `assetScheduleRows`,
  `balancingAdjustment`, `poolSchedule`, `poolScheduleRows`, plus `financialYearSchedule(assets, fy)`
  — the whole-year view the schedule screen and the CSV both need, with reconciling totals.

  **A live-site bug this task found, which no unit test could have caught.** In the browser, `calc.js`
  and `depreciation.js` are plain `<script>` tags sharing **one global scope**, so a top-level
  `const { round2 } = ...` in the second file collides with the first file's top-level
  `function round2` — `SyntaxError: Identifier 'round2' has already been declared`, which takes the
  page down. **Node cannot see this**: there each file is a module with its own scope, so the entire
  suite passed while the deployed site would have been blank. Caught by loading both copies into one
  shared `vm` context, which is what a browser does. `depreciation.js` is therefore **wrapped in an
  IIFE**, and there is now a permanent test that loads the web copies in `index.html` order and fails
  if they collide. **If a later task adds a third sibling, extend that test rather than trusting the
  unit tests** — and wrap it.

  **Decisions and non-obvious behaviour a later task must not "fix":**

  - **Schedules walk forward from the asset's first FY**, they do not jump to the requested one.
    Diminishing value compounds — year three's base is year two's closing value — so there is no
    closed form once a mid-year start date and a possible disposal are involved. The loop is the
    algorithm, not an inefficiency.
  - **Diminishing value reads the OPENING ADJUSTABLE VALUE; prime cost reads the COST BASE.** Both are
    passed to `declineForYear` for that reason. Swapping either fails 5 and 13 tests respectively.
  - **A leap financial year gives 366 ÷ 365**, slightly over a full year's decline, because the
    divisor is always 365 while `daysHeld` is real days. Published formula; "correcting" it fails 15
    tests and puts the app out of step with the accountant.
  - **Pools apportion business use on the way IN and take a reduced first-year rate INSTEAD of
    day-count pro-rata** — the exact opposite of step 4 for an individual asset. Apportioning the pool
    decline as well halves a 50% asset twice. An asset pooled on 29 June still gets the full 15%.
  - **Pool rows carry no single "rate applied" field.** In a year with both an opening balance and
    additions, *both* rates apply, and one label on a screen the accountant reads would be wrong.
    `POOL_RATES` is exported if a view wants to show them.
  - **A disposed asset has no row after its disposal FY** — `assetSchedule` returns `null`, not a zero
    row, because a zero row reads as "still held, nothing claimed".
  - An asset with **no effective life declines nothing** rather than having a life guessed for it, and
    nothing ever declines below zero.

- [x] **Routes — capacity fields, assets, schedule, locks** (backend — Sonnet/high): Extend `PUT /api/goals` to accept and validate the five new columns (`working_days_per_week` 1–7, `billable_hours_per_day` 0–24, leave and sick ≥ 0 with `leave + sick < workingDaysPerYear` rejected, `iawo_threshold` ≥ 0), and recompute `billable_capacity_hrs_per_week` as `annualBillableHours ÷ 52` on every save. New `server/src/routes/depreciation.js`: `GET/POST/PUT/DELETE /api/depreciation-assets`; `GET /api/depreciation-schedule?fy=FY2025-26` returning the computed schedule (**computed on read — never stored**, so it cannot drift from the assets); `GET /api/depreciation-schedule.csv?fy=…` for the export; `GET/POST /api/depreciation-locks` (post only, no update or delete). **Every asset write appends an `overhead_snapshots` row in the same handler**, exactly as the overhead CRUD handlers already do — assets now move the annual total, so a change that skipped the snapshot would leave the trend chart lying. Tests in `test-api.js` following the existing pattern, including the `leave + sick` rejection and a locked-FY read. _New: `server/src/routes/depreciation.js`. Modifies: `server/src/routes/goals.js`. Depends on: the migration, the depreciation chain, capacity math._

  **Done 2026-09-27.** `GET/PUT /api/goals` now round-trips all five capacity
  fields plus `iawoThreshold`, validated on the RESOLVED values (body, or
  fallback), not just on whatever the caller happened to send. New
  `server/src/routes/depreciation.js` registered in `app.js`: full asset CRUD,
  `GET /api/depreciation-schedule[.csv]?fy=`, `GET/POST /api/depreciation-locks`.
  160 tests pass (was 156); one mutation checked to fail (dropping
  `writeSnapshot()` from the asset POST handler breaks the snapshot-count
  assertion).

  **One thing this task had to decide that the spec didn't cover, with a real
  live-rate consequence:** `PUT /api/goals` now writes every column on every
  save (matching the existing upsert shape), but the *current, still-live*
  `views/goals.js` only ever sends `desiredNetIncome` / `targetProfitMarginPct`
  / `billableCapacityHrsPerWeek` — it doesn't know the five new fields exist.
  Naively writing `Number(body.x) || 0` for them, as the three old fields do,
  would zero out a user's confirmed capacity the next time they change their
  income target, and would insert zeros instead of the reference defaults on a
  brand first-ever save. **`resolveCapacityField(body, existing, ...)` fixes
  this**: a field the caller sent is validated and stored; a field the caller
  omitted falls back to what's already on the row, or to the reference
  defaults (8/5/30/8) only when there is no row yet. See its docstring in
  `routes/goals.js`.

  **The corollary, and it's deliberate, not a bug to "fix" later:** once this
  route ships, `GET /api/goals` exposes the four real capacity fields for the
  first time, already seeded 8/5/30/8 on every pre-existing row by migration
  v5. The two *already-live* callers of `LSCCalc.annualBillableHoursFromGoals`
  — `views/pricing.js:665` and `views/estimate-editor.js:1100` — will
  therefore stop taking the bridge's legacy branch and start pricing off the
  real capacity model **immediately upon deploying this route, before the
  Capacity screen exists to let anyone confirm the seeded defaults.** This is
  exactly resolved decision 2 ("every overhead-derived rate rises ~8%,
  knowingly") and exactly what the bridge function in the capacity-math task
  was built to allow — see that task's note "after every goals row has the
  four fields" for the same conclusion reached from the calc.js side. Flagging
  it here again because it is this task's deploy, specifically, that trips it.

  **Two more decisions, smaller but worth not re-deriving:**

  1. **`routes/overhead.js`'s `writeSnapshot()` was widened**, though this
     task's file list didn't mention `overhead.js`. It now reads
     `depreciation_assets` too and stores `annualBusinessCost(items, assets)`
     as `total_annual` (was `annualOverheadTotal(items)` alone) — otherwise an
     asset-only edit would move the true annual cost without ever moving the
     trend chart, since only overhead-item writes used to snapshot. Exported
     so `routes/depreciation.js` calls the exact same function rather than a
     second copy that could drift. `by_category_json` keeps every existing
     overhead category untouched and gains one more bucket,
     `depreciation_reserve`, left out entirely when there's no reserve — so
     the donut still reconciles against the new total without mixing the
     asset category vocabulary (camera/lens/…) into the overhead one
     (software/other/…).
  2. **The CSV includes pool rows, not just individual assets**, though the IA
     doc's wording ("one row per asset") only describes the common case.
     Leaving pools out would silently drop every small-business-pool or
     low-value-pool deduction from the accountant's export. **A locked FY's
     CSV and JSON schedule both read the FROZEN `figures_json`**, not a fresh
     recompute — matching "editing effective life in 2027 must not rewrite
     what was filed in 2026" — while `category`/`method` columns still come
     from the live `depreciation_assets` table, since those are descriptive
     fields, not frozen figures.

  **Not done, and intentionally out of this task's scope:** no route-level
  enum/range validation on asset fields (category, method, business_use_pct)
  beyond what the table's own `CHECK` constraints already enforce — same
  convention as `overhead_items`, confirmed by a test that a bad category or
  method 500s rather than being silently stored.

---

## Core UI

- [x] **Sidebar rail + router restructure + `Finance & Price` rename** (frontend — Opus/high): **Establishes the aesthetic direction for the whole feature — editorial dark utility, inherited unchanged: flat 1px borders, no radii, 10–11px uppercase tracked labels, `Delight` 700 for money figures, one accent doing all the interactive work.** Rename the header nav item to `Finance & Price` in `web/index.html` (id stays `#nav-finance`; the label is what changes). In `web/js/views/finance.js`: replace the `.finance-tabs` horizontal row with a vertical left rail of five items — `Dashboard`, `Rate Card`, `Overhead`, `Capacity`, `Profit Goals` — as `<nav aria-label="Finance sections">` containing real `.nav-link` `<button>`s with `aria-current="page"` on the active one. **Not `role="tablist"`** — that file's header already documents why, and the decision stands. `dashboard` becomes `TABS[0]` and the unknown-`initialTab` fallback, replacing Pricing as the landing tab: the comment justifying Pricing-as-landing was written when it was the only built screen. `selectTab(id, opts)` gains an optional second argument forwarded to the child's `mount`, so the Dashboard can deep-link to Overhead's Depreciation inner tab — this is the one router-contract change the feature makes. Keep the `LSCUnsaved.confirmLeave()` guard on every switch, and the `typeof ViewName === 'undefined'` resolution pattern (a top-level `const` in its own `<script>` is not on `window`, so `typeof` is the only honest check). Extend `LSCData.load()` to preload `depreciation-assets` alongside the existing five, and `loaded()` to require it. New `web/css/finance-rail.css`, or extend `finance.css` — the existing file's header explains why there's no rule under the tab row; the rail has the same reasoning to respect. _Modifies: `web/index.html`, `web/js/views/finance.js`, `web/js/data.js`, `web/css/finance.css`. Reuses: `.nav-link`. Depends on: nothing backend — buildable against stubbed Dashboard/Capacity views._

  **Done 2026-09-27.** Header item reads `Finance & Price`; the rail is a
  `<nav>` of five `.nav-link` buttons with `aria-current`; `dashboard` is
  `TABS[0]` and the fallback; `selectTab(id, opts)` forwards `opts` into the
  child's `mount` handlers (the IA doc's key is `inner`, e.g.
  `onGoTab('overhead', { inner: 'depreciation' })`); `LSCData` preloads
  `/api/depreciation-assets` and `loaded()` requires it. Also touched, beyond
  the file list: `web/js/app.js` (the first-run setup step now asks for
  `toFinance('pricing')`, since no-argument lands on the Dashboard) and
  `web/css/responsive.css` (the <768px horizontal-row fallback — shipping the
  rail without it would have broken the live mobile layout). Verified in the
  browser at 1280 / 900 / 375px; see HANDOVER.md for the one layout decision
  this task made against the brief's wording (`#main` grows by the rail).

- [x] **Capacity screen** (money math — Opus/high — it renders the divisor behind every rate): New `web/js/views/capacity.js`. Four `.field` inputs — Billable hours per day, Working days per week, Leave + public holidays, Sick + miscellaneous days. **Labels must say "working days", not "days"** — four weeks' leave is 20 working days, not 28, and the difference is 8 days of capacity. Above the fields, the derived **Annual billable hours** figure, updating live as fields change (before saving) in an `aria-live="polite"` region, exactly as Goals' Target Annual Revenue already follows its inputs. One explicit Save button, `LSCUnsaved` registered the way `goals.js` does it (snapshot comparison, `onScreen()` sentinel scoped to `#finance-sub`, and a sentinel id that doesn't collide with another screen's — `goals.js`'s header explains what that collision broke last time). **Saving moves every overhead-derived rate**, so the save button's confirm states the before/after annual hours and says so plainly. First-run: if the migration's seeded defaults have never been saved over, show *these are defaults — confirm they're yours*, because the migration could not infer leave and sick days from the single weekly figure. Validation mirrors the route's: 1–7 days, 0–24 hours, and `leave + sick < workingDaysPerYear` with a field error rather than a silent `null`. Also surfaces **Full-day hours** as the prefill source for the Rate Card's day rows. **Finally, delete the transitional legacy branch in `annualBillableHoursFromGoals()` and the `LEGACY_WEEKS_PER_YEAR = 48` constant it uses** (both in `calc.js`, added by the capacity-math task so the live rate card would not break in the meantime), plus the two tests named "the bridge …". Leaving it in place once every goals row has the four fields would let a half-migrated row silently price against the retired assumption. Replace the `goals.js` capacity hint text at the same time — "annualised over 48 weeks" is accurate only while that branch lives. _New component. Reuses: `.field`, `.btn-accent`, `LSCUnsaved`. Depends on: capacity math, routes, rail._

  **Done 2026-09-27.** `web/js/views/capacity.js` (`CapacityView`) + `web/css/capacity.css`. Legacy
  bridge deleted — not just its branch: `annualBillableHoursFromGoals()` is gone entirely and both
  call sites (`pricing.js`, `estimate-editor.js`) call `annualBillableHours(LSCData.goals())`, since
  the goals payload already carries the four fields under those names. The two "bridge" tests are
  replaced by one that fails if a legacy fallback ever returns. 163 tests pass.

  **Needed a migration the task didn't list — v6.** Two reasons, both found while building:
  (1) `PUT /api/goals` wrote `Number(body.desiredNetIncome) || 0` and the same for margin, so a
  Capacity save (four fields only) **zeroed the user's income and margin** — and a 0% margin is a
  break-even floor, not an empty state. The route now resolves both like the capacity fields (sent →
  stored → null), and v6 rebuilds `goals` so they can be NULL on a Capacity-first insert. (2) "Have
  the seeded defaults ever been saved over?" can't be answered by comparing with 8/5/30/8 — those can
  be real — so v6 adds `capacity_confirmed_at`, stamped only by a PUT carrying all four fields.
  Mutation-checked: restoring the `|| 0`, `some` for `every`, dropping the carry-forward, and a
  0 first-insert default each fail a test.

  Two small copy fixes outside the file list, both made wrong by this task: the Rate Card's rate
  note now names Overhead / **Capacity** (not Goals) as what the rate comes from, and the Goals
  capacity hint links to Capacity and says a value typed there isn't saved.

- [x] **Dashboard** (money math — Opus/high): New `web/js/views/finance-dashboard.js`. Read-only — registers no `LSCUnsaved` watcher. Content order is the IA doc's hierarchy and is not a styling preference: (1) the three floors — hourly, half day, full day — in `Delight` 700, the largest type on the page; (2) the **comparison against the rate card**, every labour row's `mu` beside its floor, below-floor rows badged in `--accent-text` with the gap in dollars; (3) the cost-to-rate chain in two panels, costs left and capacity right, mirroring the reference spreadsheet — and **annual business cost is always shown split `Operating` + `Replacement reserve`, never as one figure**, because that split is the only thing that makes a double-counted camera visible; (4) target annual revenue, plus the same figure per month and per week labelled as averages; (5) jobs needed per year with the 12-month average job value it came from shown beside it; (6) the post-ratio readout; (7) the GST mirror. Every figure and panel heading deep-links to its owner screen via `onGoTab`. Floors compare against **`mu`, not `rate`**, and exclude pass-throughs entirely — crew, hire and travel are added at cost on top, and the copy says so. `null` propagates to an em dash plus a set-up prompt; never `$0.00`. Empty states: no capacity, no cost, no margin, and no estimate history (jobs-needed shows an em dash rather than dividing by zero). _New component. Reuses: `.est-table`, `.proj-card` (stat usage, hover affordance dropped as `overhead.js` already does). Depends on: every Foundation task, rail._

  **Done 2026-09-27** — items (1)–(5). Items (6) post-ratio and (7) GST mirror, and the info button,
  are their own tasks below and slot in under (5). New calc functions (both copies): `hourlyFloor`,
  `priceExGst`, `labourFloorComparison`, `averageJobValue`, `jobsNeededPerYear`; 172 tests pass,
  ten mutations checked to fail. **Every screen now divides `annualBusinessCost`** (operating +
  replacement reserve) through new `LSCData.businessCost()` / `LSCData.overheadRate()` — Rate Card,
  estimate editor, Capacity confirm, Goals' target revenue and the Dashboard read one computation.
  Headline half/full-day floors use Capacity's full-day hours, not a "Full Day row" (none is
  identifiable yet) — see HANDOVER. Also fixed in `finance.js`: children's delegated listeners piled
  up on a reused `#finance-sub` and ate the Dashboard's deep-link opts.

- [x] **Rate Card — day / half-day / overtime rows and the `hoursPerUnit` column** (money math — Opus/high): In `web/js/views/pricing.js`, add a `hoursPerUnit` column to labour rows, prefilled from Capacity's billable-hours-per-day for a Full Day row and half that for Half Day, **and editable** — a shoot day genuinely runs longer than an average working day, and forcing them equal would distort one to fix the other. Seed the new Production rows in `server/src/defaults.js`: `Video Capture — Full Day`, `Video Capture — Half Day`, `Video Capture — Hourly`, `Overtime — per hour`. **The half-day row carries its own independent `mu`** — a half day is not half a full day, because setup, travel and turnaround do not halve; there is no 0.5 multiplier anywhere. Existing rows get no `hoursPerUnit` and therefore default to 1, unchanged. Show each row's floor beside its `mu` with the below-floor badge, matching the Dashboard's comparison so the two screens cannot disagree. _Modifies: `web/js/views/pricing.js`, `server/src/defaults.js`. Depends on: the `hoursPerUnit` fix, capacity math, Dashboard (for the shared badge component)._

  **Done 2026-09-27.** Each labour row gets a second line under its name — `per [hour / half day /
  full day]` plus, for day rows, an editable billable-hours field prefilled from Capacity (half for
  a half day) — and one under its Mark-Up showing its floor or "below floor by $X", computed by the
  Dashboard's own `labourFloorComparison` (verified: all 19 rows identical on both screens). Day rows
  are marked `dayUnit: 'full' | 'half'`, not by name. **Fixed a live defect:** `payload()` dropped
  `hoursPerUnit` on every save, so a day row would have reverted to hourly on the next unrelated
  edit. Seeded Full Day ($1,120, 8 h), Half Day ($640, 4 h — its own price) and Overtime ($210/h);
  **no "Video Capture — Hourly" row** — the existing "Video Capture" is the hourly row, and renaming
  it would orphan saved estimates on default-card databases. 176 tests pass.

- [x] **Overhead inner tabs + Depreciation asset register** (frontend — Opus/high): In `web/js/views/overhead.js`, add a horizontal `.nav-link` row — `Operating Costs` (the existing expense register, default) and `Depreciation` — reusing the pattern the rail just vacated so the area has one navigation idea, not two. Accept the inner-tab id from `mount`'s handlers so the Dashboard's deep link lands on Depreciation. New `web/js/views/depreciation.js`: the register as `.est-table` (Asset, Category, Start date, Cost, Method, Business use %, Replacement reserve, actions) with **`data-label` on every cell** — a new column without one loses its heading below 768px. Add/Edit in the existing focus-trapped `.modal-box` from `settings.js` (reuse it, don't rebuild it): all the IA doc's fields, **`purchase_date` and `start_date` as two separate required inputs** with the start-date hint explaining ATO start time, the GST block stating what `settings.gst.registered` currently is and therefore which cost base applies, and placeholders on `effective_life_years` and the write-off threshold with *confirm with your accountant*. Delete via `window.confirm()` + `LSCApi.del()` + `Toast`, matching `clients.js`'s `remove()`. Above the register: **replacement reserve and this FY's tax deduction side by side**, with the info button between them. A `Disposed` filter defaulting to hidden, sorted by category then start date, with a count in the heading. Empty state names the rule: capital purchases here, running costs in Operating Costs. _Modifies: `web/js/views/overhead.js`. New: `web/js/views/depreciation.js`. Reuses: `.est-table`, `.modal-box` + focus trap, `.nav-link`, `window.confirm()` + `Toast`. Depends on: routes, the depreciation chain, rail._

  **Done 2026-09-27.** Inner tabs `Operating Costs | Depreciation` (Operating Costs unchanged);
  `handlers.inner === 'depreciation'` lands on it, so the Dashboard's Replacement reserve link works.
  New `DepreciationView` (`web/js/views/depreciation.js`, `css/depreciation.css`, overlay
  `#modal-depreciation-asset`). **Edits carry `disposalDate` / `disposalProceeds` / `disposalReason`
  through** — the PUT writes every column, so an edit without them would un-dispose a sold asset
  (verified). The write-off threshold (`goals.iawo_threshold`, owned by this screen per the IA map)
  is a small save at the foot of the tab. The info button between the two numbers is its own task —
  a short explanatory note sits there meanwhile. No server change.

- [x] **Depreciation schedule + FY selector** (money math — Opus/high) — done 2026-09-27: Below the register, the schedule for the selected financial year: per asset, opening adjustable value, decline in value, deductible portion, closing adjustable value; plus pool rows rendered separately from individual assets; plus any balancing adjustments for assets disposed of that year. FY selector labelled `FY 2025–26` — always the two-year form, never a bare year — defaulting to the current Australian FY from the shared helper. Read-only; computed on read from `GET /api/depreciation-schedule`. Column labels use the ATO's own vocabulary per the IA doc's glossary: **decline in value**, **adjustable value**, **disposal** — not "depreciation", "book value" or "sale", so which number this is stays unambiguous next to the replacement reserve. Empty state: no assets, or none held in the selected year. _New. Depends on: the depreciation chain, routes, the register._

- [x] **CSV export + lodgement lock** (money math — Opus/high — the lock compares stored figures against live recomputation) — done 2026-09-27: Download button at the foot of the schedule, hitting `GET /api/depreciation-schedule.csv?fy=…`, one row per asset for the selected FY with the IA doc's column set, and the FY in the filename. Local download only — no email, no upload, no sharing. **Mark FY as lodged** posts a `depreciation_locks` row capturing that year's computed figures as a JSON snapshot; the schedule then shows the locked figures with a badge and **flags any divergence** if live recomputation now disagrees, rather than silently applying the new numbers. Editing an asset's effective life in 2027 must not rewrite what was filed in 2026. No unlock route — if a lodgement was wrong, that's an amendment, and it should require a deliberate act outside this UI rather than a button. _New. Depends on: the schedule, routes._

---

## Interactions & States

- [x] **Info button + popover — shared component** (frontend — Opus/high) — done 2026-09-27: One reusable control, two required instances: the floor comparison (the floor is measured against the marked-up price, pass-throughs excluded) and the depreciation split (why the replacement reserve and the ATO figure differ, and which is used for what). **A `<button>`, not a hover target and not a `title` attribute** — hover-only is unreachable by keyboard and does nothing on touch, and both explanations carry real money meaning. Accessible name describing the content ("How the floor comparison works"), `aria-expanded` toggled on a popover that is reachable by Tab, dismissed by Escape, and returns focus to the trigger. Hover may reveal the same content as a convenience; it is never the only way in. The user asked for hover — this delivers it without making it the contract. _New shared component. Depends on: rail._

- [x] **GST mirror block** (money math — Opus/high — it changes `computeTotals`' path and the depreciation cost base) — done 2026-09-27: The `.tax-setting` pattern on the Dashboard, holding `Registered`, `Rate`, and `Prices include GST`, writing `settings.gst` through the existing `/api/settings` route. **An editable mirror, not a copy** — the same stored field the Invoice Settings modal writes, with copy saying so out loud, exactly as Goals already mirrors the tax reserve rate. Currently `registered: false`. State the two consequences in the block: every calculator figure stays GST-exclusive regardless, and ticking this changes the depreciation cost base for gear bought from that point on, which is why each asset carries its own `gst_credit_claimed` flag. Verify round-trip: change it here, confirm Invoice Settings shows it, and vice versa. _New. Reuses: `.tax-setting`. Depends on: Dashboard._

  **Done 2026-09-27.** Section (7) of the Dashboard with its own Save GST button and `LSCUnsaved`
  watcher. Saves merge onto a fresh `GET /api/settings` (never the cache), apply the modal's own
  rules (ABN before registering, rate 0–100 while registered), and **refuse on conflict** if the
  stored GST moved since the block loaded. `SettingsView` calls `FinanceDashboardView.refreshGst()`
  after its save, so the mirror follows the modal live. Round trip verified both ways, including the
  comparison backing 15% out of a GST-inclusive card. See HANDOVER.

- [x] **Post-ratio readout** (frontend — Opus/high) — done 2026-09-27: One editable ratio input (edit days per shoot day) and a derived sentence: *"at N shoot days/month, post consumes X hrs — leaving Y billable hrs unsold."* Display-local, saves nothing, resets on remount. The app deliberately does **not** enforce a shoot-day cap: the post-to-shoot ratio is the most variable number in the business (≈1 edit day for a corporate interview, ≈3 for a wedding) and enforcing it needs a constant that doesn't exist. Covers: ratio of zero, a ratio that oversubscribes capacity (the "over" case must read as a warning, not an error), and no capacity set. _New. Depends on: Dashboard, capacity math._

  **Done 2026-09-27.** **Two** inputs, by the user's choice — shoot days/month joins the ratio, since
  the sentence needs an N — plus a ceiling line ("fits at most 7.4 shoot days a month"). Arithmetic
  is `postRatioReadout()` in `calc.js` (both copies, 5 tests); days are Capacity's day, a month is
  annual ÷ 12, over-full is a negative answer rendered as an accent warning. See HANDOVER.

- [x] **Double-count guard on large one-off expenses** (frontend — Opus/high) — done 2026-09-27: In the Operating Costs add form, a `one_off` item above the user's `iawo_threshold` prompts *"This looks like a capital asset — track it in Depreciation instead?"* with a link to the register and a dismiss. **Non-blocking** — a hint, not a validation rule, because the user may genuinely be recording a large one-off that isn't gear. This is the only mitigation for the one place the design can silently lie: a camera entered as both an expense and an asset inflates every rate, and nothing structural prevents it. The Dashboard's Operating / Replacement-reserve split is the other half of the mitigation. _Modifies: `web/js/views/overhead.js`. Depends on: the register._

  **Done 2026-09-27.** Add Expense only (not Edit), one-off strictly above the saved threshold, no
  hint when no threshold is saved. "Track it in Depreciation" discards the unsaved expense without
  a confirm and opens Add Asset with the name (not the GST-exclusive cost) carried over; Dismiss
  hides it for that modal. Also touched `depreciation.js` (`openAdd` prefill) and `overhead.css`.

- [x] **Disposal flow** (money math — Opus/high) — done 2026-09-27: A `Dispose` action per register row opening a modal for `disposal_date`, `disposal_proceeds` and `disposal_reason`. On save the asset **leaves the replacement reserve immediately** — sold gear must stop inflating overhead — while **staying on the disposal FY's schedule with its balancing adjustment**, because that is that year's tax event. Verify both halves: the Dashboard's annual business cost drops, and the schedule for the disposal year still lists the asset. Covers: disposal for zero proceeds, disposal before the FY start (belongs to the earlier year), and a disposal date before `start_date` (rejected with a field error). _New. Depends on: the register, the depreciation chain._

  **Done 2026-09-27.** Dispose / Disposal per row, one dialog for record, correct and **undo**, with a
  live preview (reserve drop; disposal FY, adjustable value and balancing adjustment, or the pool
  wording) and a warning when the disposal FY is lodged. The before-start rule is **also enforced by
  the route** (`disposalProblem()`, 400s with messages) — a server change, so the NAS needs a
  redeploy for it. 2 new API tests; figures matched hand working in the browser. See HANDOVER.

- [x] **Profit Goals — capacity becomes a derived read-only figure** (frontend — Opus/high) — done 2026-09-27: In `web/js/views/goals.js`, the `Billable Capacity (hrs / week)` input becomes a **read-only derived figure** showing annual billable hours, with a link to the Capacity screen — one writer per number, per the IA doc's read/write map. Its existing hint text ("annualised over 48 weeks, so leave and downtime don't flatter the rate") is now wrong and must be replaced: the year is no longer 48 weeks and the leave is no longer assumed. Everything else on the screen is unchanged, including the tax reserve mirror. _Modifies: `web/js/views/goals.js`. Depends on: capacity math, the Capacity screen._

  **Done 2026-09-27.** A read-only "Annual billable hours" figure (not a disabled input) with
  Capacity's own working (`CapacityView.derivation`, now exported) and a link; the save stops sending
  the weekly field. Also retitled the page **Profit Goals** and corrected the save-bar copy (margin
  moves floors, not the overhead rate). See HANDOVER.

- [x] **Estimate editor — day-unit-aware floor copy** (money math — Opus/high): `minimumJobPrice` now receives an hours figure that can come from day rows, so the Minimum Job Price note ("to cover $X/hr of overhead across N hours and a Y% margin", `estimate-editor.js:650`) must read correctly when those hours came from two shoot days rather than twenty hourly lines. Verify the floor itself is right for a day-row estimate — this is the defect from the first Foundation task observed end to end, and it's the one place a reader can see whether that fix actually worked. Also confirm `clientPriceExGst` and `totalIncGst` are unchanged by all of this, in both the editor and `estimate-detail.js`. _Modifies: `web/js/views/estimate-editor.js`. Depends on: the `hoursPerUnit` fix, the Rate Card day rows._

  **Done 2026-09-28.** The floor is right end to end: 2 full days (8 h) + 1 half day (4 h) + 3 h +
  4 h editing = **27 hrs → $510.30** at $15.12/hr and 25% (the pre-fix arithmetic would have said
  10 hrs → $189.00); client price and total inc GST unchanged by the toggle and identical to what the
  server stored. The note now shows its working — "across 27 hours (2 full days of 8 hrs, 1 half day
  of 4 hrs, plus 7 hrs of hourly work)" — from a new `calc.js` `labourHoursBreakdown()` whose total a
  test pins to `computeTotals().totalHours`; hourly-only jobs read exactly as before. The cost
  breakdown modal's Overhead Allocation line carries the same working. In a category whose card has
  a day row, the editor and estimate detail head the quantity column **Qty** and name each row's unit
  ("per full day · 8 billable hrs" under the name in the editor; "2 full days" in the detail);
  hourly-only categories still say **Hours** with no extra line. 188 tests pass. See HANDOVER.

---

## Responsive & Polish

- [x] **Responsive pass** (frontend — Opus/high): Breakpoints `1099px`, `900px`, `767px`, all in `web/css/responsive.css` — **`app.css` is never edited for responsive work**, per its own header. ≥1100px: rail as a fixed-width left column, child view in the remainder; every ported screen must still look as it did, with only the container narrowed by the rail's width. 1099–900px: rail narrows, labels stay, Dashboard panels stay side by side. 899–768px: Dashboard panels stack, rail stays. <768px: rail reverts to the horizontal `.finance-tabs` row it replaced, horizontally scrollable, 44px touch targets, with the Overhead inner tabs as a second row below it; every table stacks via `data-label`; the schedule's widest columns collapse into the stacked card layout and the CSV button stays reachable without horizontal scrolling. Check the register and schedule at 375px specifically — they are the widest tables in the app. _Modifies: `web/css/responsive.css`. Depends on: all Core UI._

  **Done 2026-09-28.** Measured every Finance & Price screen (Dashboard, Rate Card, Overhead,
  Depreciation, Capacity, Profit Goals) at 1280 / 1240 / 1100 / 1099 / 1000 / 901 / 900 / 800 /
  768 / 767 / 375 / 320 with a scripted audit (page overflow, clipped content, content spilling its
  column, wrapped buttons, <44px targets below 768). **Tablet band:** rail 152 → 120px, gap 36 → 24
  (fixed a Dashboard floor figure clipped 8px and Overhead's Edit/× clipped 3px at 768); head
  buttons held on one line; depreciation cells 14 → 10px padding (schedules now fit at 768); the
  register still scrolls (138px at 768) but its **actions column is pinned** to the scroller's right
  edge. **1100–1267px:** save-bar buttons were wrapping inside the rail's shell (Goals from 1240
  down) — fixed in `finance.css`, shell-scoped. **Phone:** the Dashboard comparison opens on the
  below-floor rows with a "Show all N services" toggle (page 6,421 → 3,021px at 375); 44px targets
  for the Dashboard's heading and line links and the Rate Card's unit select; the info button's hit
  area was 42px, not 44 — fixed in `info.css`. Also touched `finance-dashboard.js` (the toggle) and
  `finance-dashboard`-scoped rules. No server change. See HANDOVER.

- [x] **Accessibility pass** (frontend — Opus/high): Every info control is a button with `aria-expanded`, Tab-reachable popover, Escape to close, focus returned to the trigger — no hover-only path anywhere. Rail is `<nav>` + `aria-current="page"`, real buttons in the tab order, no roving tabindex (these are not ARIA tabs). `:focus-visible` rings from `a11y.css` on every new interactive element including rail items and info buttons. Derived figures that change while typing — annual billable hours, the floors — sit in `aria-live="polite"` regions, matching how Goals announces Target Annual Revenue. Contrast: body text ≥4.5:1 on both `--bg` and `--surface`; `--muted` is the `0.6` from `a11y.css`, not `app.css`'s `0.42`; below-floor badges use `--accent-text`, never raw `--accent` (3.71:1 — fills and rings only). Verify every step of the decline-curve ramp, not just the accent. The asset modal uses the existing trap from `settings.js` with the focusable set recomputed each Tab. Empty and unset states render an em dash plus an explanation, never `$0.00`. _Depends on: all Core UI and Interactions._

  **Done 2026-09-28.** Scripted audit of all six screens plus both info popovers and all three
  modals (text contrast against the composited background, accessible names, dangling ARIA refs,
  duplicate ids, `$0.00` / `NaN`, focus rings via one real Tab then scripted focus — 246 controls,
  none missing). Already met, verified rather than rebuilt: info controls, rail semantics, the
  `LSCModal` trap, `--accent-text` on below-floor text. **Fixed:** (1) derived figures now speak
  through a shared **debounced** announcer, `LSCUtil.announce()` + an `.sr-only` region per screen —
  Capacity's annual hours, Profit Goals' target revenue, the Dashboard's post-ratio sentence, each
  Rate Card floor line, the asset modal's reserve line and the disposal preview. Plain `aria-live` on
  the visible figure was removed where it existed (Capacity, post-ratio, disposal): it read out
  every half-typed value. (2) **Focus fell to `<body>`** after saving an edited asset or expense and
  after deleting either — now back on that row's Edit, or the Add button. (3) The Rate Card's `<h1>`
  read "Pricing & Services" under a rail item named Rate Card. (4) A Dashboard copy slip ("your
  Capacity day, your Capacity day") with capacity unset. **Left, on purpose:** the GST mirror's
  dimmed labels (4.02:1, inactive controls — exempt), empty-list totals reading `$0.00` (Finance
  decision 28), the decline ramp (every step ≥3.55:1 on both backgrounds, checked for the chart
  task). See HANDOVER.

- [x] **Decline curve chart** (frontend — Opus/high): Hand-rolled inline SVG on the Depreciation tab, one point per FY of an asset's adjustable value, no chart library — matching the app's zero-dependency pattern in `overhead-charts.js`. Applies the scoped palette exception already granted to the category donut, on the same terms: `--accent` marks the current FY, everything else uses the muted warm tonal ramp. Hover shows FY + value via `<title>`. Empty state: a plain message, not a broken axis. _New. Reuses: `overhead-charts.js`'s ramp and axis helpers. Depends on: the schedule._

  **Done 2026-09-28.** A "Decline in value" section between the register and the schedule, with an
  **Asset** picker (the register's own list, honouring "Show disposed", narrowed to diminishing value
  and prime cost — an instant write-off is one step to $0 and a pooled asset has no value of its own).
  Points are `closingAdjustableValue` from `LSCDepreciation.assetScheduleRows()` — the schedule's own
  walk — out to the end of the effective life (or this FY, if later), stopping at a disposal. **One
  addition to the spec: a starting point** at the cost base (or entered opening value) on the day it
  was first used, as a small muted ring labelled "Start" — without it the first FY's point already
  has the biggest drop taken out, and a diminishing-value curve hid exactly the front-loading it is
  there to show. Current FY = the one terracotta point (+ faint guide, FY label in the same colour);
  the rest is one ramp step (`--oh-c3`), solid for reported years, **hollow on a dashed line for
  projected ones**. `<title>` per point; `role="img"` summary; an `.sr-only` table of every point; the
  picker announces the new summary. Ramp tokens hoisted in `overhead.css` so the donut and the curve
  share one declaration; `bindResize` redraws it. See HANDOVER.

---

## Review

- [ ] **Design review**: Run `/design-review` against `.design/price-calculator/DESIGN_BRIEF.md` once the Core UI is built. Screenshots to `.design/price-calculator/screenshots/`.
