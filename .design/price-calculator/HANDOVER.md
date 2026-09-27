# Handover: Finance & Price (Price Calculator)

Read this first, then [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md). This track **restructures the live
Finance area** built in [`.design/overhead-finance/`](../overhead-finance/) — that folder stays the
authority for every decision this one does not explicitly overturn.

**Build bucket: `Opus, effort: high`.** Money math plus a nav restructure on a live site. The route
work is not in the Sonnet bucket here, because it moves the divisor behind every rate on the card.

## What this is

A left-sidebar Finance & Price area with a read-only Dashboard that shows the whole cost-to-rate
chain on one screen: overhead (including gear depreciation), real working-days capacity, profit
goals, and the hourly / half-day / full-day floors they imply — compared against what the rate card
actually charges. Modelled on the user's `Price Calculator` reference spreadsheet, reshaped for a
service business that sells shoot days rather than units.

## State as of 2026-09-27 (Phase 6 — 3 of 21 tasks done)

`/design-flow` sequence position:

- [x] **Phase 1 — Grill Me.** Complete. 11 decisions resolved, recorded in the brief's
      "Resolved Decisions" section.
- [x] **Phase 2 — Design Brief.** Complete → [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).
- [x] **Phase 3 — Information Architecture.** Complete →
      [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md). Contains the read/write map (one
      writer per stored number), the arithmetic order, the full ATO depreciation chain, and the
      accounting decisions that were delegated to the agent.
- [ ] Phase 4 — Design Tokens. **Skipped by agreement.** `web/css/app.css:19-21` plus
      `web/css/a11y.css` already hold the system and it must survive.
- [x] **Phase 5 — Brief to Tasks.** Complete → [`TASKS.md`](TASKS.md). 21 tasks in 5 groups, each
      tagged with its model/effort bucket. Build order is risk-first: the `hoursPerUnit` defect fix
      goes first and alone, then the capacity-math change that moves every rate.
- [ ] **Phase 6 — Frontend Design (build).** ← **IN PROGRESS.** Work `TASKS.md` in order, checking
      off each item and confirming with the user before moving on.
      - [x] **Fix `totalHours` — add `hoursPerUnit` to rate-card rows** (money math — Opus/high) —
            done 2026-09-27, see "What landed" below.
      - [x] **Capacity math — `annualBillableHours()`, and `overheadRatePerHour()` changes meaning**
            (money math — Opus/high) — done 2026-09-27, see "What landed" below. The 48-week year is
            retired.
      - [x] **Migration — capacity columns, `depreciation_assets`, `depreciation_locks`**
            (backend — Sonnet/high; built on Opus at the user's direction 2026-09-27) — landed as
            **schema v5**. See "What landed" below; four decisions were made inside it that the
            depreciation and routes tasks depend on.
      - [ ] ← **NEXT: Cost of the business — `annualBusinessCost()` and the replacement reserve**
            (money math — Opus/high). Also carries the shared **Australian FY helper**, which the
            whole depreciation chain then builds on.
- [ ] Phase 7 — Design Review. On request only, after there is something built.

Three tasks of 21 are built: the money-model rewrite and the schema behind it. No route added, no new
view, `server/src/defaults.js` untouched, and the only edits outside `calc.js` / `db.js` are the two
call sites in `views/pricing.js` and `views/estimate-editor.js`. **The live site still behaves exactly
as it did** — verified, not assumed (see "Rates have not moved yet" below). Nothing visible changes
until the Capacity screen ships.

## What landed (2026-09-27) — the `hoursPerUnit` fix

The live defect described in the brief's decision 5 is **fixed and provably behaviour-preserving**.
`computeTotals` no longer does `totalHours += qty`; it does `totalHours += qty × hoursPerUnitOf(def)`.
Do not re-derive this — read `calc.js`'s header section "Hours and quantity are not the same thing".

What exists now, and what a next session should rely on rather than re-invent:

- **`hoursPerUnitOf(def)` is exported** from both `calc.js` shapes (`module.exports` and
  `globalThis.LSCCalc`). It returns a positive number, falling back to **1** for missing, `0`,
  negative, non-numeric or `null`. **Use it** for the Rate Card's day-rate prefill and the
  Dashboard's `fullDayFloor = hourlyFloor × (Full Day row's hoursPerUnit)` — it exists so the two
  screens and the server cannot disagree about what a blank cell means. Don't re-read
  `def.hoursPerUnit` raw anywhere.
- **The fallback direction is a decision, not a default.** 1, never 0: a 0 drops the job's hours out
  of `minimumJobPrice`'s overhead allocation entirely, and the floor then reads as a computed answer
  while pricing a shoot as though it took no time. A test asserts this and it is not cosmetic — a
  fallback of `0` fails 8 tests, 3 of which are pre-existing.
- **Nothing on the rate card carries `hoursPerUnit` yet.** `server/src/defaults.js` is untouched;
  the day/half-day/overtime rows are still the Rate Card task's job. Every existing row and every
  saved estimate therefore totals identically today, which is what the whole-object snapshot test
  (`a card with no hoursPerUnit anywhere totals exactly as it did before`) locks in.
- **No route or migration was needed.** `PUT /api/pricing` writes the rate card as whole-document
  JSON with no field whitelist, so `hoursPerUnit` will persist the moment the Rate Card screen sends
  it. Don't add validation for it there without a reason — the file's comment explains why the
  whole-document write exists.
- Suite is **97 pass / 0 fail** (`cd server && npm test`), up from 91. Both `calc.js` copies are
  byte-identical and the drift test passes.

Still outstanding from the same defect, and it is *not* done until these land: the Rate Card task
adds the day rows and the editable `hoursPerUnit` column, and the Estimate-editor task verifies the
floor end to end on a day-row estimate. That editor task is the only place a person can see whether
this fix actually worked, so don't drop it.

## What landed (2026-09-27) — the capacity model

The 48-week year is gone. `calc.js` now has:

- **`annualBillableHours({ billableHoursPerDay, workingDaysPerWeek, leaveDaysPerYear, sickDaysPerYear })`**
  → `((days × 52) − leave − sick) × hoursPerDay`. The reference defaults give **1,776**. Returns
  `null` for any missing or out-of-range field, and when `leave + sick >= workingDaysPerYear` —
  `>=`, not `>`, because exactly-equal is zero billable hours, which divides into an infinite rate.
  The `52` here is weeks in a year, a fact; it is not the retired constant returning, and the
  comment says so.
- **`overheadRatePerHour(annualTotal, annualBillableHrs)`** — the second parameter **changed meaning**
  and the function no longer multiplies by anything. Both directions of that mistake are silent and
  expensive, so a test asserts the two wrong answers by name: a weekly figure passed in gives
  $1,200/hr, and the old signature given an annual figure gave $0.52.
- **`annualBillableHoursFromGoals(goals)`** — the transitional bridge, described below.
- `WEEKS_PER_YEAR = 48` is **deleted**, including from both export shapes. The only surviving
  mentions are prose: the superseded-decision note in the header, and one comment disambiguating
  `WEEKS_IN_YEAR` from it.

### Rates have not moved yet — and that was the hard part

The build order in `TASKS.md` puts this task *before* the migration and the routes, so the four
capacity columns do not exist in the database yet and do not reach the browser. The two live callers
had only the legacy weekly column to offer. Swapping the parameter's meaning with nothing else changed
would have turned the live rate card's **$25/hr into $1,200/hr**, on a deployed site, for the next
four tasks.

`annualBillableHoursFromGoals(goals)` is the bridge: new fields win when present, otherwise the legacy
`billableCapacityHrsPerWeek` is annualised at the retired 48. Verified against `git HEAD`'s `calc.js`
that every legacy row (5, 12.5, 20, 30, 37.5, 40 hrs/week, plus `0` / `null` / `undefined` / negative)
gives a **bit-identical** rate, empty states included. The intended rise arrives only when real fields
are written: **12.50 → 13.51/hr, +8.08%**, on the test fixture's $24,000 book.

**The Capacity screen task must delete the legacy branch and `LEGACY_WEEKS_PER_YEAR`**, plus the two
tests named "the bridge …". That is noted on the task itself. Leaving it in after every goals row has
the four fields would let a half-migrated row silently price against the retired assumption. Delete
the `goals.js:286` capacity hint text ("annualised over 48 weeks") in the same change — it is still
*accurate* while the branch lives, which is why it was not touched now.

### Two errors in the task as written, now corrected in `TASKS.md`

1. **`routes/goals.js` and `views/goals.js` do not call `overheadRatePerHour`.** The task listed them
   as two of "four call sites". The route only stores the column; `goals.js` uses `annualOverheadTotal`
   and `targetAnnualRevenue`. The real callers are `views/pricing.js:665` and
   `views/estimate-editor.js:1100` — **and the editor was not on the list**, though it is the one
   feeding the Minimum Job Price floor. Don't trust the remaining tasks' call-site lists without
   grepping.
2. The build-order gap above was not anticipated by the task either. Expect the same for
   `annualBusinessCost` — the Dashboard and Pricing screens will want it before the migration that
   defines the asset shape has run.

## What landed (2026-09-27) — schema v5

`server/src/db.js` migration v5, `capacity fields, depreciation assets and lodgement locks`. Verified
on a fresh DB, on a copy of the dev DB (at v1, so the whole 1→5 chain ran), and on a v4 database built
from `git HEAD`'s `db.js` carrying a real goals row — which kept every value and gained the seeds.
`migrate()` is idempotent. The dev DB on disk was not touched.

`goals` gains `billable_hours_per_day` / `working_days_per_week` / `leave_days_per_year` /
`sick_days_per_year`, **seeded 8 / 5 / 30 / 8** by `DEFAULT`, plus a nullable `iawo_threshold`.
`billable_capacity_hrs_per_week` is kept and marked legacy in v5's comments (it could not be commented
in place — v4 has shipped and is never edited).

New `depreciation_assets` (23 columns) and `depreciation_locks`.

### Four decisions made inside the migration — the next tasks depend on these

1. **`business_use_pct` IS A PERCENT, 0–100 — not a fraction.** The IA doc writes
   `decline × business_use_pct`, which reads like a fraction, but `target_profit_margin_pct` already
   established that a `_pct` column holds 0–100 and `calc.js` divides. **The depreciation chain must
   divide by 100.** This is the single most likely silent error in the rest of the feature: a
   fraction/percent mix-up is a 100× wrong deduction that still looks like a number. A
   `CHECK (0..100)` rejects a `0.6` meant as 60%.
2. **The `category` enum was chosen here**, because nothing specifies one:
   `camera / lens / lighting / audio / computer / drone / vehicle / other`. Follows v4's `frequency`
   precedent — documented as this migration's own choice, changed by a *new* migration if a view
   disagrees. **`vehicle` is load-bearing**: step 2 of the chain caps cars at the car limit and
   nothing else identifies them.
3. **`car_limit` exists**, though the task's field list omitted it. Step 2 needs it. It is per-asset,
   not global, because the applicable limit is the one in force for the FY the car was first used — a
   2019 car and a 2026 car are capped differently forever.
4. **`depreciation_locks` has NO UNIQUE on `fy_label`.** A re-lodgement is an amendment and the log
   should keep it. **Every reader must take the latest row per FY** (`ORDER BY locked_at DESC
   LIMIT 1`) rather than assuming one exists.

`iawo_threshold` is **nullable with no default** on purpose: the design refuses to hardcode an ATO
figure that moves with the budget, so NULL means "not confirmed" and the screen shows the current
figure as a placeholder. A `0` default would be worse than NULL — every one-off expense exceeds 0, so
the double-count hint would fire on all of them and get trained away.

### A finding the Capacity screen must respect

The seeds give **1,776** annual hours. A legacy row saying 20 hrs/week annualises to **960**. So
accepting the seeded defaults unexamined could nearly *halve* that user's overhead rate — or raise it
sharply, depending on what their legacy figure was. The before/after annual-hours confirm that
`TASKS.md` already asks for on that screen's save is a genuine guard, and a test in `test-db.js`
pins the gap so nobody drops it as cosmetic.

## Resolved decisions (Lachlan, 2026-09-27 — do not re-litigate)

All eleven are written up in the brief's "Resolved Decisions" section with the reasoning. The five
that will get questioned by a fresh agent:

1. **Finance is renamed `Finance & Price` and restructured, not supplemented.** A second area
   writing the same singleton `goals` row would break "one number, one truth".
2. **The 48-week year is retired.** Capacity becomes four real fields; annual billable hours are
   derived. On the reference defaults this is 1,776 hrs vs today's 1,920 — **every overhead-derived
   rate rises ~8%, knowingly.**
3. **Day and half-day are separate rate-card rows with independent prices.** A half day is not half
   a full day. No 0.5 multiplier.
4. **Depreciation produces two numbers from one table**: the ATO figure for the accountant's CSV, and
   a straight-line replacement reserve over the user's own cycle for the overhead rate. Tax
   depreciation would swing the day rate 30–40% year to year for gear still in use.
5. **One capacity pool.** No shoot-day cap. The post-to-shoot ratio is too variable to enforce; it
   appears as an editable Dashboard readout instead.

Also settled: GST is an editable mirror of `settings.gst` (currently `registered: false`), not a
copy; the floor compares against `mu`, not `rate`; nothing ever auto-writes the rate card; the owner's
wage term stays out of `calc.js` (declined knowingly 2026-09-15 — do not reopen).

## Accounting rules a fresh agent will get wrong

All of these are settled in the IA doc's "Arithmetic Order" section. Listed here because each one
produces a plausible-looking wrong number rather than an error.

- **The deduction is apportioned by business-use %; the adjustable value is not.** It declines by the
  full decline in value. Apportioning both overstates the closing value of every part-personal asset
  for the rest of its life.
- **`daysHeld` runs from `start_date` (ATO "start time" — first used or installed ready for use), not
  `purchase_date`.** Two separate date fields, both required.
- **Australian FY is 1 July – 30 June.** One shared FY helper; never `new Date().getFullYear()`
  inline, which is off by up to twelve months for half the year.
- **Leave and sick days are entered in WORKING days, not calendar days.** Four weeks' leave is 20, not
  28. The labels must say so.
- **`÷ 365` even in leap years**, and the diminishing-value factor is `200%` for assets held from
  10 May 2006. Both are published formula, not arithmetic to correct.
- **`replacement_cost_estimate`, not historical cost**, drives the replacement reserve — pricing has
  to recover what the next body costs.
- **Double-counting is possible and nothing structurally prevents it**: a camera entered as a one-off
  operating expense *and* as an asset inflates every rate. Mitigated by always showing the annual
  cost split Operating / Replacement reserve, plus a soft prompt on large one-off entries.

## Open seams

- **`goals.billable_capacity_hrs_per_week` is KEPT**, recomputed on save as `annualBillableHours ÷ 52`,
  and read by nothing. Resolved in Phase 3: dropping it means a SQLite table rebuild and a migration
  that would have to invent leave and sick values it cannot infer. Its schema comment must mark it
  legacy and display-only, or the next agent will either delete it mid-feature or compute from it.
- ~~**`overheadRatePerHour()`'s second parameter changes meaning**~~ — **DONE 2026-09-27.** See
  "What landed — the capacity model". The one live seam it leaves behind is the transitional legacy
  branch in `annualBillableHoursFromGoals()`, which the Capacity screen task deletes.
- **`annualOverheadTotal()` keeps its name and behaviour** so existing tests pass; screens move to a
  new `annualBusinessCost(items, assets)`.
- **`finance.js`'s router contract gains one argument**: `selectTab(id, opts)` forwarding an inner-tab
  id, so the Dashboard can deep-link to Overhead → Depreciation.
- **The capacity migration cannot infer leave and sick days** from the single weekly figure that
  existed before, so it seeds the reference defaults (8 / 5 / 30 / 8) and the Capacity screen flags
  them as defaults to confirm.
- **ATO thresholds and effective lives stay user-entered**, with the current figure as a placeholder
  and a confirm-with-your-accountant note. Both move with the federal budget. Nobody should
  "helpfully" hardcode them later.
- **Depreciation schedules are computed on read, not stored** — single source of truth — with an
  append-only `depreciation_locks` row freezing a FY once the user marks it lodged.
- **Info controls are buttons, not hover tooltips.** The user asked for hover; hover-only fails
  keyboard and touch, and both explanations carry money meaning. Button + `aria-expanded` popover,
  with hover as an enhancement. Agreed in the brief's Accessibility section — do not simplify it
  back to a `title` attribute.

## How to verify your work

- `npm test` inside `server/` after any change under `server/` — the acceptance gate for this phase.
- `calc.js` changes must be applied identically to `server/src/calc.js` and `web/js/calc.js` — the
  last test in `test-calc.js` fails if they drift. The `hoursPerUnit` default-of-1 coverage now
  exists (see "What landed"); keep it passing rather than rewriting it.
- For anything in the money-math bucket, **check the mutation, not just the green suite**: break the
  line you just wrote, confirm a test fails, put it back. The capacity task next up moves every rate
  on the card, and a test that passes both ways is worse than no test.
- The live site is GitHub Pages + the NAS API over Cloudflare Tunnel. Logins are in
  `.credentials.local.md` at the repo root (gitignored). Ask the user to sign in before browser
  testing — real mouse clicks in the browser pane do not always reach the page; verify with a
  dispatched `.click()` and poll on a DOM condition.
- Above 1100px, every *ported* screen must still look as it did; only the container narrows by the
  sidebar rail's width.
