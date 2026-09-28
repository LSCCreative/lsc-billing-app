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

## State as of 2026-09-28 (Phases 6 and 7 complete — built, reviewed; review fixes done except the VoiceOver pass)

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
      - [x] **Cost of the business — `annualBusinessCost()` and the replacement reserve** (money
            math — Opus/high) — done 2026-09-27, including the shared Australian FY helper. See
            "What landed" below; two conventions were set here that the rest of the feature depends on.
      - [x] **The ATO depreciation chain** (money math — Opus/high) — done 2026-09-27 in a sibling
            `depreciation.js`. See "What landed" below; it found a live-site bug that no unit test
            could catch.
      - [x] **Routes — capacity fields, assets, schedule, locks** (backend — Sonnet/high) — done
            2026-09-27. The whole Foundation group is now built. See "What landed" below for what
            shipped and — more importantly — the live-rate consequence of shipping it.
      - [x] **Sidebar rail + router restructure + `Finance & Price` rename** (frontend —
            Opus/high) — done 2026-09-27. The first visible change. See "What landed" below —
            **read its deploy-order warning before pushing anything.**
      - [x] **Capacity screen** (money math — Opus/high) — done 2026-09-27. Added **migration v6**,
            which the task didn't list — see "What landed — Capacity" below.
      - [x] **Dashboard** (money math — Opus/high) — done 2026-09-27, items 1–5; **live** (pushed).
      - [x] **Rate Card — day rows and `hoursPerUnit`** (money math — Opus/high) — done 2026-09-27;
            **live** (pushed).
      - [x] **Overhead inner tabs + Depreciation asset register** (frontend — Opus/high) — done
            2026-09-27. See "What landed — Depreciation register". **Live** (pushed).
      - [x] **Depreciation schedule + FY selector** (money math — Opus/high) — done 2026-09-27. See
            "What landed — Depreciation schedule". **Live** (pushed). Also fixed a live defect from
            the register task (Edit/delete clipped at 768–1099px).
      - [x] **CSV export + lodgement lock** (money math — Opus/high) — done 2026-09-27. See "What
            landed — CSV export and lodgement lock". **Live — NAS and Pages both deployed
            2026-09-27 ~20:40 AEST.**
      - [x] **Info button + popover — shared component** (frontend — Opus/high) — done 2026-09-27.
            See "What landed — Info control". **Live** (Pages, 2026-09-27; no server change).
      - [x] **GST mirror block** (money math — Opus/high) — done 2026-09-27. See "What landed — GST
            mirror". **Live** (Pages, pushed 2026-09-27 ~21:15 AEST; web only, no server change).
      - [x] **Post-ratio readout** (frontend — Opus/high) — done 2026-09-27. See "What landed —
            Post-ratio readout". **Live** (Pages, 2026-09-27, run 36315790751).
      - [x] **Double-count guard on large one-off expenses** (frontend — Opus/high) — done
            2026-09-27. See "What landed — Double-count hint". **Live** (Pages, run 36316035048).
      - [x] **Disposal flow** (money math — Opus/high) — done 2026-09-27. See "What landed —
            Disposal flow". **Live** — NAS redeployed and Pages pushed 2026-09-27 ~21:47 AEST.
      - [x] **Profit Goals — capacity becomes a derived read-only figure** (frontend — Opus/high) —
            done 2026-09-27. See "What landed — Profit Goals". **Live** (Pages, pushed 2026-09-28).
      - [x] **Estimate editor — day-unit-aware floor copy** (money math — Opus/high) — done
            2026-09-28. See "What landed — Estimate editor day-unit wording". **Live** (Pages,
            2026-09-28, run 36354765653; the `server/src/calc.js` copy is unused by the server, so
            no NAS redeploy was needed).
      - [x] **Responsive pass** (frontend — Opus/high) — done 2026-09-28. See "What landed —
            Responsive pass". **Live** (Pages, pushed 2026-09-28, run 36356171260; web only).
      - [x] **Accessibility pass** (frontend — Opus/high) — done 2026-09-28. See "What landed —
            Accessibility pass". **Live** (Pages, pushed 2026-09-28, run 36357488624; web only).
      - [x] **Decline curve chart** (frontend — Opus/high) — done 2026-09-28. See "What landed —
            Decline curve". **Live** (Pages, pushed 2026-09-28, run 36358829703; web only).
- [x] **Phase 7 — Design Review.** Done 2026-09-28 → [`DESIGN_REVIEW.md`](DESIGN_REVIEW.md), with
      26 screenshots in `screenshots/`. Its one must-fix (the Depreciation tab 407px wide on a
      375px phone, from the decline curve's screen-reader table) is **fixed and committed, not
      pushed** — it is live on Pages until pushed.
- [x] **The review's should-fix list** — done 2026-09-28 except (4). See "What landed — review
      should-fixes" below. **Committed, not pushed** — together with the must-fix, it all reaches the live site on
      the next push (Pages only, web-only change, no NAS redeploy).
- [ ] ← **NEXT: (a) push to Pages, with the user's go-ahead; (b) should-fix 4, a real VoiceOver
      pass** — a person with VoiceOver on Capacity, the Rate Card and the asset dialog, listening
      for the announcer regions inside the `aria-modal` dialogs and judging the one-second debounce.
      An agent can't do this one. Also still open: overhead-finance decision 74's estimate-editor
      half (no announcements there).

All 23 build tasks are done — the Foundation group, the rail, Capacity, the Dashboard (all seven
sections), the Rate Card's day rows, the whole Depreciation tab (register, schedule, CSV, lodgement
lock, disposal), the shared info control, the GST mirror, the post-ratio readout, the double-count
hint, Profit Goals' read-only capacity, the estimate editor's day-unit wording, the responsive
pass, the accessibility pass and the decline curve chart. (Earlier versions of this file said "of 21"; `TASKS.md` has 23 build tasks plus the design
review — the count was wrong, not the list.) **The design review's must-fix is committed but not
pushed.** The decline curve, the accessibility pass, the responsive pass, Profit Goals and the
estimate editor went to Pages on 2026-09-28. Everything before them is live,
NAS included (see the disposal deploy record below) — the info control and the GST mirror went to
Pages on 2026-09-27 (~21:15 AEST, run 36315015715, success) with the user's go-ahead; both are
web-only, so the NAS needed no redeploy.

**Deployed 2026-09-27 (~20:40 AEST), with the user's explicit go-ahead** — the CSV/lock task's
server change. Backup `/volume4/lsc-billing/data/backups/pre-lock-20260927-2039.db`; `Dockerfile`,
`package*.json` and `.dockerignore` diffed identical first, so the rebuild used cached layers (~1 min,
not the 20 of the v6 deploy); `server/` copied with `COPYFILE_DISABLE=1 tar … --exclude
node_modules --exclude ./data --exclude .env --exclude docker-compose.yml` (the NAS's tar prints
harmless "unknown extended header keyword LIBARCHIVE.xattr…" warnings for macOS/Drive metadata);
`docker compose up -d --build`; container `healthy`, `fy_not_ended` present in the running code,
public `/api/depreciation-schedule` → 401. No migration. The live DB had **0 assets and 0 locks**
at deploy time. Then `main` pushed. This deploy also put `defaults.js`' day rows live for Reset
Defaults. Everything before it is live. `server/src/defaults.js` did change (seeded day rows), which only
matters to **Reset Defaults** and fresh databases — redeploy the NAS whenever convenient for Reset to
include them.

**Deployed 2026-09-27 (~17:25 AEST), with the user's explicit go-ahead.** NAS first: pre-migration
backup `/volume4/lsc-billing/data/backups/pre-v6-20260927-1701.db`; `server/` copied with `tar`
excluding `node_modules`, `data`, `.env`, `docker-compose.yml`; `docker compose up -d --build`
(~20 min — the Chromium apt layer rebuilt from scratch; the old container served throughout). Boot
log showed `migrated to v5` and `migrated to v6`; the live goals row kept its income and margin, all
6 overhead items intact, `capacity_confirmed_at` NULL as intended; `/api/depreciation-assets` → 401
locally and via `https://billing.lsccreative.studio`. Then `main` was pushed to deploy Pages. **The
live Capacity screen shows the "confirm these are yours" note until the user saves it once.**

**This task's deploy is the one that changes the live rate**, not the Capacity screen's. `GET
/api/goals` now returns the four real capacity fields, already seeded 8/5/30/8 by migration v5 on
every existing row, and the two live callers of `LSCCalc.annualBillableHoursFromGoals` —
`views/pricing.js:665` and `views/estimate-editor.js:1100` — pick the new fields over the legacy
bridge the moment they're present. That is resolved decision 2 ("every overhead-derived rate rises
~8%, knowingly"), landing now rather than at Capacity-screen save time. See "What landed" below and
the Routes task's own entry in `TASKS.md` for the full reasoning — this is not something the next
session should try to "fix" by hiding the fields again.

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

## What landed (2026-09-27) — annual business cost and the financial year

`replacementReserveTotal(assets)`, `annualBusinessCost(items, assets)`, and the FY helper.
`annualOverheadTotal()` keeps its name and behaviour; screens move to `annualBusinessCost`.

### Two conventions set here that the rest of the feature must follow

1. **`calc.js` accepts BOTH field shapes — `field(obj, camel, snake)`.** Routes map rows to camelCase
   for the browser, but server-side callers hand raw snake_case rows straight in; `writeSnapshot()`
   in `routes/overhead.js` already does exactly that. Earlier functions got away with it because
   `cost` and `frequency` are one word in both shapes. `replacement_cost_estimate` is not, and a raw
   row read camelCase-only returns **0** — the reserve silently vanishes from the overhead rate and
   every job is under-priced, with nothing on screen to notice. **Pass either shape; don't add a
   mapping step believing one is required.** Use `businessUseShare(asset)` rather than reading
   `business_use_pct` yourself — it already divides by 100.
2. **The FY label has a canonical form and a display form, and they are different strings.**
   Canonical is **`FY2025-26`** (no space, plain hyphen): stored in `depreciation_locks.fy_label`,
   passed as `?fy=`, compared, and used in the CSV filename. `fyDisplay()` renders the IA doc's
   `FY 2025–26` with the en dash — **display only, never stored or compared**, because an en dash
   from a copied label fails an equality check against a stored token. `fyBounds()` parses either,
   plus `FY2025-2026` and a bare `2025-26`; it **rejects** a bare `2025` (cannot say which FY) and
   `FY2025-27` (a typo, not a range). `fyBounds()` returns `{start, end, startYear, label}` as
   `'YYYY-MM-DD'` strings, which compare correctly as text against the date columns.

### The timezone bug this avoided, and why the test looks odd

`fyLabel()` parses a date-only string **textually**. `new Date('2026-07-01')` is UTC midnight; read
back with local getters west of Greenwich that is 30 June — the **previous financial year** — so an
asset first used on 1 July would file its entire decline twelve months early.

**30 June cannot expose this** (shifted back a day it is still June), so the guard pins **1 July**
across five timezones, in a **child process**, because `Date`'s zone is fixed at process start and
this host is UTC+10. Confirmed by mutation: a `Date` + local-getters implementation passes every other
test and fails only that one. Don't delete it as over-engineering — it is the only thing in the suite
that would catch a wrong tax return, and the defect is invisible on the dev machine and on the NAS if
its container runs UTC.

### Smaller decisions worth not re-deriving

- A **disposed asset leaves the reserve immediately** (sold gear must stop inflating overhead) but
  stays on its disposal FY's tax schedule for the balancing adjustment. The two chains disagree about
  a sold camera on purpose.
- A missing `business_use_pct` reads as **100%** — matching the column DEFAULT, and erring towards
  keeping a cost in rather than silently dropping one, the same direction `hoursPerUnitOf` errs.
- An asset with no `replacement_cost_estimate` or a zero/absent cycle **contributes nothing** rather
  than being guessed at or dividing into infinity. Gear can legitimately be entered for tax only.
- `replacementReserveTotal` returns **0, not null**, for no assets: unlike a missing overhead rate,
  "no gear recorded" is a complete answer, and it must be safe to add without null-checking each term.
- The reserve **raises** the rate, which is the point: $24k operating + a $6k body on a 3-year cycle
  takes 13.51 → 14.64/hr at 1,776 hours.

## What landed (2026-09-27) — the ATO depreciation chain

**New files: `server/src/depreciation.js` and `web/js/depreciation.js`**, byte-identical, with their
own drift test and `server/test/test-depreciation.js`. Split out rather than added to `calc.js`, which
was already at 867 lines. `calc.js` now exports `numOrNull`, `field` and `businessUseShare` for it, and
**`web/index.html` has a new `<script>` after `calc.js`** — the order matters, and a test enforces it.

`costBaseOf`, `daysHeldInFy`, `declineInValue`, `assetSchedule`, `assetScheduleRows`,
`balancingAdjustment`, `poolSchedule`, `poolScheduleRows`, and `financialYearSchedule(assets, fy)` —
the whole-year view with reconciling totals that the schedule screen and the CSV both read.

### The bug this task found, and why the test for it looks strange

In the browser, `calc.js` and `depreciation.js` are plain `<script>` tags sharing **one global scope**.
A top-level `const { round2 } = ...` in the second collides with the first's top-level
`function round2`: `SyntaxError: Identifier 'round2' has already been declared`, which takes the page
down with it.

**Node structurally cannot see this** — each file is a module with its own scope there, so all 155
other tests passed while the deployed site would have been blank. It surfaced only by loading both web
copies into one shared `vm` context, the way a browser does. `depreciation.js` is therefore **wrapped
in an IIFE**, and a permanent test loads the web copies in `index.html` order and fails if they
collide. **Adding a third sibling? Wrap it, and extend that test** — the unit tests will lie to you here.

### Things that look wrong and are correct

- **Schedules walk forward from the asset's first FY.** Diminishing value compounds, so year three's
  base is year two's closing value; with a mid-year start date and a possible disposal there is no
  closed form. The loop is the algorithm.
- **Diminishing value reads the opening adjustable value; prime cost reads the cost base.** Swapping
  either fails 5 and 13 tests.
- **A leap financial year yields 366 ÷ 365** — slightly more than a full year's decline. The divisor is
  always 365 while `daysHeld` is real days. Published formula; correcting it fails 15 tests.
- **Pools are backwards from individual assets on purpose**: they apportion business use on the way
  IN (so the whole pool decline is deductible) and take a reduced first-year rate INSTEAD of day-count
  pro-rata. An asset pooled on 29 June still gets the full 15%.
- **No "rate applied" field on pool rows** — in a year with both an opening balance and additions both
  rates apply, and one label would be wrong on a page the accountant reads.
- **A disposed asset returns `null` for later years, not a zero row**, which would read as "still held,
  nothing claimed".
- **Steps 4 and 5 diverge**, and the dedicated test is the only thing that fails when they are merged.
  Verified: merging them breaks exactly that one test and nothing else.

### Verification

156 tests pass. Ten mutations checked to fail: merged steps 4/5 (1 — the dedicated test),
`purchase_date` for `start_date` (19), 150% factor (5), DV off cost base (5), prime cost compounding
(13), divisor 366 (15), pools double-apportioned (5), pool additions at the ongoing rate (13), GST
always subtracted (3), car limit on every category (1). Every per-method figure was hand-checked
against the formula before the tests were written.

## What landed (2026-09-27) — routes: capacity fields, assets, schedule, locks

`PUT /api/goals` validates and stores the five new fields; `GET /api/goals` now returns them. New
`server/src/routes/depreciation.js`, registered in `app.js`: full CRUD on `/api/depreciation-assets`,
`GET /api/depreciation-schedule[.csv]?fy=FY2025-26`, and `GET/POST /api/depreciation-locks`
(post-only, no update or delete route — a re-lodgement is a new lock row, per migration v5's decision
4). 160 tests pass (was 156). One mutation checked to fail: dropping `writeSnapshot()` from the asset
POST handler breaks the appended-snapshot count assertion.

### The live-rate consequence — read this before touching `views/goals.js` or the Capacity screen

**This route's deploy, not the Capacity screen's, is what flips the live rate to the new capacity
model.** Before this task, `GET /api/goals` didn't expose `billableHoursPerDay` /
`workingDaysPerWeek` / `leaveDaysPerYear` / `sickDaysPerYear`, so `LSCCalc.annualBillableHoursFromGoals`
— called live today by `views/pricing.js:665` and `views/estimate-editor.js:1100` — always fell
through to the legacy weekly-figure branch. Now that GET returns those four fields (seeded 8/5/30/8
by migration v5 on every pre-existing row), `annualBillableHours()` succeeds and the bridge takes the
NEW branch immediately, for every existing goals row, the moment this route is deployed — with no UI
yet to show anyone the seeded defaults or let them confirm/adjust first.

This is **resolved decision 2** ("the 48-week year is retired... every overhead-derived rate rises
~8%, knowingly") taking effect now rather than at Capacity-screen save time, and it is exactly what
the capacity-math task's bridge function was built to permit — see that task's note "after every
goals row has the four fields", reached independently from the calc.js side. **Do not build a
gate to delay this** (e.g. hiding the fields from GET until the Capacity screen ships) — that was
considered and rejected: the whole point of the bridge was to let this transition happen safely
without one, and delaying it further just moves the same one-time jump to a different commit. The
Capacity screen task's job regarding this is what it already says: delete the transitional branch and
`LEGACY_WEEKS_PER_YEAR`, and let the user edit away from the seeded defaults if 8/5/30/8 isn't them.

### Two decisions this task made that weren't in its spec

1. **`routes/overhead.js`'s `writeSnapshot()` now reads `depreciation_assets` too**, and stores
   `annualBusinessCost(items, assets)` as `total_annual` instead of `annualOverheadTotal(items)`
   alone. Without this, an asset-only edit (no overhead item touched) would move the true annual cost
   — assets now contribute the replacement reserve to it — without ever moving the trend chart, since
   only overhead-item writes used to call this function. **Exported** so
   `routes/depreciation.js` calls the identical function rather than a second copy that could drift.
   `by_category_json` is unchanged for existing categories and gains one more bucket,
   `depreciation_reserve` (omitted entirely when there's no reserve, the same way an overhead category
   with nothing in it is simply absent) — so the donut still reconciles against the new total without
   mixing the asset category vocabulary (camera/lens/…) into the overhead one (software/other/…).
2. **The CSV export includes pool rows, not just individual assets**, though the IA doc's "one row
   per asset" wording only names the common case. Omitting pools would silently drop every
   small-business-pool or low-value-pool deduction from the accountant's file. **A locked FY's CSV and
   its JSON schedule both read the FROZEN `figures_json` from the lock**, not a live recompute —
   matching "editing effective life in 2027 must not rewrite what was filed in 2026" — while
   `category`/`method` columns are still read live from `depreciation_assets`, since those are
   descriptive fields, not frozen figures, and an asset's category doesn't change retroactively.

### resolveCapacityField — why PUT /api/goals doesn't just overwrite with 0

`views/goals.js` is still live and still only sends `desiredNetIncome` / `targetProfitMarginPct` /
`billableCapacityHrsPerWeek` — it has no idea the five new fields exist yet. The route's upsert writes
every column on every save (same shape as before), so a field the caller didn't send needs a fallback
that isn't 0: `resolveCapacityField(body, existing, ...)` uses the caller's value when sent, otherwise
whatever is already on the row, and only falls back to the reference defaults (8/5/30/8) for a
first-ever INSERT with no row to fall back to. Validation runs on the RESOLVED values, not just on
whatever the caller sent, so a bad value already sitting on a row from some earlier, looser write
can't survive forever untouched. `billableCapacityHrsPerWeek` itself is no longer a write target at
all — it's recomputed from the four real fields on every save (`annualBillableHours ÷ 52`) — so
sending it now does nothing; the Profit Goals task will make that explicit on screen.

## What landed (2026-09-28) — review should-fixes

Nine of the ten should-fix items in [`DESIGN_REVIEW.md`](DESIGN_REVIEW.md) are fixed, and each
item's outcome is written under it there. Web only: no server change, no migration. 188 tests pass.
Verified with headless Chrome (the server's `puppeteer-core`) against `api-scratch` at 1280 / 1100 /
1000 / 900 / 850 / 800 / 768 / 375, by measurement plus screenshots. The below-floor state was made
in the page cache only (`LSCData.setPricing`), and nothing was saved.

Things a fresh agent should know:

- **There is now one `!important` in `responsive.css`**: the <768 rule that sets `font-size: 16px`
  on every input (except checkboxes and radios), select and textarea. It is deliberate: the sizes
  it beats are class selectors up to (0,2,1), and a new field must not quietly bring the iOS
  focus zoom back. It is site-wide, not only Finance & Price, and the user approved that. Any
  flex item holding a field on a phone may need `min-width: 0`; the estimate editor's
  `.bb-picker .svc-select` did. At 16px, three long names on the Rate Card also scroll inside
  their name fields on a phone, which is normal for a text field and was left alone.
- **`selectTab`'s opts now carry a second key**, `focusRow: { sectionId, index }`, from the
  Dashboard's "Below by $X" button to `PricingView.focusRow()`. The index is counted per section in
  `comparisonMarkup` rather than added to `labourFloorComparison`. That keeps `calc.js`, which is
  money-math and drift-tested, out of this change. The count depends on that function walking
  sections and rows in card order, which it does.
- **The Profit Goals layout decision from overhead-finance is reversed** (the user's call):
  Target Annual Revenue sits above the fields, as on Capacity. `.goals-outcome` now carries the
  top-of-screen margin itself, and `.cap-outcome` is gone. The overhead-finance IA is annotated.
- **The save-bar sentence uses `text-wrap: balance`, not the review's `pretty`.** `pretty`
  measurably did nothing to the two-word orphan. The rule is in `pricing.css` and reaches
  ≥1100px, a deliberate exception to the Desktop Preservation Law, approved with the review.
  So do the badge, the popover rule, the `/hr` rates, the Goals order and the legend cap.
  Everything in the 768–1099 and <768 bands is additive as usual.
- **The info popover picks its side once, on open** (`open.flip`). If you re-decide it inside
  `place()`, it will jump sides while the reader scrolls.

## What landed (2026-09-28) — Decline curve

`web/js/views/overhead-charts.js` (the chart), `web/js/views/depreciation.js` (the section and its
picker), `web/css/depreciation.css`, `web/css/overhead.css` (ramp hoisted). No server change; suite
188/188.

**Where and what.** A "Decline in value" section between the register and the schedule — an
asset's view, so it sits under the assets, and the schedule → CSV → lock run stays unbroken at the
foot of the tab. Its head copies the schedule's (`.dep-sched-head`, `.dep-fy`), with an **Asset**
picker where the schedule has its FY picker. Inside an `.est-block`, drawn at the container's
measured width exactly like the trend chart.

### Decisions made here — read before touching the chart

- **One asset at a time, by picker — not the whole register on one chart.** The task says "an
  asset's adjustable value"; a register total would blend methods and start years into a line that
  means nothing on a return. Default is the first chartable asset in register order; the choice
  survives re-renders (`chartAssetId`) and falls back to the first if that asset goes.
- **Only diminishing value and prime cost are charted** (`OverheadCharts.canChartDecline`, which
  the picker also uses, so the two can't disagree). An instant write-off is one step to $0; a pooled
  asset's cost joins the pool's balance and has no value of its own. When nothing qualifies, the
  section says which of those is the reason instead of drawing an axis.
- **The picker follows "Show disposed"**, like the register. A disposed asset's line ends at its
  disposal FY (the chain stops walking there) and the caption says so.
- **A starting point the task didn't list.** Every FY point is a *closing* value, so the first one
  already has that year's decline out of it — for diminishing value, the biggest drop the asset will
  ever have ($8,800 → $2,998 for the scratch FX6). Without an anchor the chart hid the front-loading
  the tab's own info popover describes. So slot 0 is the cost base (or the entered opening adjustable
  value) on the day it was first used: a smaller ring in `--muted`, labelled "Start", titled
  "First used 5 Jul 2026 — $8,800.00 cost base". Every other point is still one per FY.
- **How far it walks**: to the end of the effective life (`firstFY + ceil(life)`) or this FY,
  whichever is later — prime cost reaches $0 there; diminishing value never does and sits near an
  eighth of cost, so the life is the natural stop. $0 years after the first $0 are dropped unless
  they are this year or earlier (the schedule reports those).
- **Past / this year / projected.** Up to this FY is what the schedule reports; after it is what the
  chain gives if nothing changes, drawn **hollow on a dashed line** and captioned "projected".
  Distinguished by fill and dash, never by colour alone.
- **Colour, on the donut's terms**: the current FY is the one `--oh-chart-accent` point (4.70:1),
  with a faint dashed guide and its FY label in the same colour; everything else is **one** ramp
  step, `--oh-c3` (7.08:1), not a hue per year — years are a sequence, and six hues on one line read
  as six series. The ramp declaration moved from `.oh-donut-wrap` to `.oh-donut-wrap, .dep-decline`
  in `overhead.css` so there is still one copy of the hexes.
- **Accessibility**: `role="img"` with a summary (start, this year, last); a `<title>` per point
  for hover; an `.sr-only` `<table>` of every point for a screen reader (the titles are hover-only);
  the picker announces the new summary through `LSCUtil.announce()`.
- **Resize**: `OverheadCharts.bindResize` (bound by OverheadView, which mounts both inner tabs) now
  also redraws `#dep-decline-canvas`, from the last asset drawn — data held, never an element.

### Verified (local `api-scratch` + `web`, dispatched events)

Real data (one DV asset, 3-year life): Start $8,800 → FY 2026–27 $2,997.63 (terracotta, matching
the schedule's closing value) → three projected years to $110.41. Fixtures set **in the local cache
only** (`LSCData.setDepreciationAssets`, then a reload — nothing written): prime cost from 2024
reaching $0.00 this year, all solid; DV from 2021 with six reported years; an asset first used next
FY (no terracotta point, all dashed); a disposed asset ending at its disposal FY, listed only with
"Show disposed" and the picker falling back when it's hidden again; a pooled/write-off-only register
and an empty one, each with its own sentence. 375px: svg 309px in a 309px box, FY labels thinned to
Start / 2022–23 / 2024–25 / 2026–27 (this year always kept), select 44px, no page overflow. Resize
900 → 1280 redrew at 659 → 963px. The donut still resolves `--oh-c2`/`--oh-c3` after the hoist.

## What landed (2026-09-28) — Accessibility pass

`web/js/util.js`, `web/css/a11y.css`, and six views: `capacity.js`, `goals.js`,
`finance-dashboard.js`, `pricing.js`, `overhead.js`, `depreciation.js`. No server change; suite
188/188.

**Method.** A scripted audit in the browser (run via `javascript_tool`, not committed) over all six
screens, both info popovers open, and the Add/Edit asset, Dispose and Add/Edit expense modals:
text contrast against the *composited* background (every ancestor's alpha and opacity), accessible
names on every control, `aria-controls` / `-describedby` / `-labelledby` / `for` pointing at real
ids, duplicate ids, `tabindex > 0`, heading order, and `$0.00` / `NaN` / `undefined` / `Infinity`
in the rendered text — the last also with goals, overhead and assets emptied **in the local cache
only** (`LSCData.set*`, then a reload; nothing written). Focus rings: one real Tab, then scripted
`.focus()` on every control with a 230ms read — **246 controls, none without a ring**.

### Already met — verified, not rebuilt

Info controls (button, `aria-expanded`, Tab into the popover, Escape back to the trigger); the rail
(`<nav>`, `aria-current="page"`, plain buttons, no roving tabindex; Overhead's inner tabs the same);
`LSCModal`'s trap in all three dialogs, first field focused on open, focus back on the opener after
Escape or Cancel; below-floor text on `--accent-text`; every rate and floor an em dash when it can't
be computed. The three links that go raw `--accent` on hover/focus (`.dash-link`, `.goals-link`,
`.pricing-rate-note-link`) are **Finance decision 73** — the user kept that idiom site-wide; the
underline and the focus ring carry the state. Not changed.

### What it found and what changed

- **Derived figures now announce, once typing pauses.** `LSCUtil.announce(region, text)` writes to
  a visually hidden `aria-live="polite"` region a second after the last call, and skips text that
  hasn't changed. Each screen renders its own empty region with its markup (a region inserted
  already holding text isn't reliably announced). Wired to: Capacity's annual billable hours,
  Profit Goals' target annual revenue, the Dashboard's post-ratio sentence and ceiling, each Rate
  Card row's floor line ("Video Capture — Full Day: below floor by $X."), the asset modal's
  replacement-reserve line, and the disposal preview (only when the user's change — or the
  lodged-years fetch — actually moved it, never on open). **This closes overhead-finance decision
  74 for the Finance & Price screens.** That decision deferred announcements and named exactly
  this debounced shape as the right one; this track's brief then required them. The estimate
  editor's summary bar and Minimum Job Price are **still unannounced** — outside this track's
  brief, and 74 stays open for them.
- **`aria-live` removed from three visible figures that had it** — Capacity's outcome card
  (`aria-atomic` too), `#dash-post-out` and `#dep-disp-preview`. Each repainted per keystroke, so
  typing 1,776 read out 1, 17, 177, 1,776. The brief's "matching how Goals announces Target Annual
  Revenue" was describing something Goals didn't do; it does now, through the same helper.
- **Focus fell to `<body>` after four actions**: saving an *edited* asset, saving any expense, and
  deleting either. `render()` replaced the button `closeModal()` had just focused (Overhead
  re-renders its whole screen, "+ Add Expense" included). Now back onto that row's Edit, else the
  screen's "+ Add" button — the rule `writeDisposal()` already followed. An asset *added* from the
  page head keeps its focus; that button sits outside the depreciation view's root.
- **The Rate Card's `<h1>` read "Pricing & Services"** under a rail item called Rate Card — the
  rename the rail task left for the Rate Card task, which missed it. Now "Rate Card"; the sub-line
  is unchanged. (The rail task's other two leftovers — Goals' title and the rate note's links — were
  done by their tasks.)
- **Dashboard copy slip**: with capacity unset, the post-ratio note read "are each your Capacity
  day, your Capacity day." Now "are each one Capacity day"; set, it still reads "8 hrs, your
  Capacity day".

### Known and left

- **The GST mirror's "Rate (%)" and "Prices include GST" measure 4.02:1** while unregistered — the
  `set-row-off` 0.45 opacity Invoice Settings uses. Both controls are `disabled`; WCAG 1.4.3 exempts
  inactive components.
- **Empty-list totals read `$0.00`**: Overhead's Monthly/Annual Total, the Dashboard's Operating
  costs / Replacement reserve / Annual business cost, Depreciation's reserve and tax-deduction
  cards. That is **Finance decision 28** — a sum over nothing is computable and true; the em dash
  is for figures that *can't* be computed, and every rate and floor downstream of those zeros
  already shows one. The schedule's pool row showing `$0.00` in one column is a real figure.
- **Decline-curve ramp, measured for the chart task**: `--oh-chart-accent` 4.70 / 3.55:1 on `--bg`
  / `--surface`, the five ramp steps 6.23–10.14 / 4.71–7.66:1 — every step clears 3:1 (non-text)
  on both. The chart (built next, same day) uses the accent and `--oh-c3` only.
- **Not tested with a real screen reader** (none available to the agent). The announcer was
  verified by reading the regions' text before and after the debounce: empty mid-typing, one
  sentence after the pause. Worth a VoiceOver pass in the design review, including whether the
  announcer regions inside the `aria-modal` dialogs speak (they are placed inside the dialog for
  exactly that reason).

### Verified (local `api-scratch` + `web`, dispatched events)

The audit above, clean apart from the items under "Known and left". Announcer: Capacity hours
typed 7 → 7.5 read nothing at 200ms and "Annual billable hours: 1,665." after the pause; blank
read the missing-field reason; Goals, post-ratio, a Rate Card floor ("below floor by $17.90" at a
$1 mark-up, "floor $18.90" restored), the asset reserve line and the disposal preview likewise —
every typed value restored and nothing saved. Focus after save/delete: edited asset → its Edit,
edited expense → its Edit, deleted asset and deleted expense → the "+ Add" button (throwaway rows
created through the API and deleted; none left). No page overflow at 375px on any screen. The two
`LSCRows.sectionHasUnits is not a function` console errors seen during the session came from a
stale mix of cached scripts (their line numbers match no current file); a cache-busting reload
cleared them.

## What landed (2026-09-28) — Responsive pass

`web/css/responsive.css`, `web/css/finance.css`, `web/css/info.css`,
`web/js/views/finance-dashboard.js`. No server change.

**Method.** A scripted audit in the browser (run by hand via `javascript_tool`, not committed) visited all
six screens — Dashboard, Rate Card, Overhead, Overhead → Depreciation, Capacity, Profit Goals — at
1280 / 1240 / 1100 / 1099 / 1000 / 901 / 900 / 800 / 768 / 767 / 375 / 320, and reported page-level
horizontal overflow, content clipped by an `overflow:hidden` box, content spilling out of
`#finance-sub`, buttons whose label wraps, and (<768) targets under 44px counting a `::after` hit
area. Every fix below was a finding; after them, every width reports nothing but the register's
intended scroller and three exempt inline links.

### What it found and what changed

- **1099–768: the rail narrows** — 152 → 120px, gap 36 → 24, item padding 14 → 10px (the widest
  label, PROFIT GOALS, is 88px of text). That 44px was the difference at 768px between the
  Dashboard's Full day floor figure being **clipped 8px** by its tile and fitting, and Overhead's
  **Edit / × being clipped 3px** by `#oh-table-block`. Labels stay, per the brief.
- **"+ Add Expense" / "+ Add Asset" / "+ Add Category" wrapped** inside their buttons at 768–800px
  (noted by the register task). Held on one line; the prose beside them wraps instead.
- **Depreciation tables in the tablet band:** cell padding 14 → 10px, so both schedules fit at 768
  (they scrolled 3–47px). The register still needs ~760px and scrolls (138px at 768, 106 at 800, 0 at
  1000+), so **its actions column is `position: sticky; right: 0`** — Edit / Dispose / × stay on
  screen while the figures slide under them, with a faint shadow. **Stacking the register in this
  band was considered and rejected**: eleven assets as nine-line cards at 560px, for a table that
  fits 140px wider. Revisit only if the user dislikes the scroller.
- **1100–1267px (desktop band): save-bar buttons wrapped** — "Save Goals" from 1240px down, "Save
  Services" / "Reset Defaults" at 1100. The rail's shell narrows the child below its 1000px there
  (817px at 1100), and responsive.css's no-wrap fix only started at 1099. Fixed in **`finance.css`**,
  scoped to `.finance-shell`, at every width — inert where nothing wraps. Not a breakpoint rule, so
  not in responsive.css; ported screens outside Finance & Price are untouched.
- **<768: the Dashboard comparison collapses.** 21 stacked cards were 3,527px between the floors and
  the panels (page 6,421px at 375). It now opens on the **below-floor rows only**, with a "Show all
  N services" toggle (`aria-expanded`, `aria-controls`, toggled in place so focus stays on it;
  "Show only the N below floor" / "Hide the services that clear their floor" when open). Page now
  3,021px. State survives a GST redraw, resets on mount. Rows carry `dash-below` / `dash-clear`;
  the button row is hidden ≥768 (the `min-width: 768px` block, like `#nav-menu-btn`), so the
  desktop table is unchanged. The comparison's head also stacks on phones: title + info on one line,
  count beneath, left-aligned (the title is a `<button>`, so its wrapped text had centred).
- **<768: 44px targets.** Dashboard lines that carry a link grow to 46px (padding 7 → 14px) with the
  link's hit area filling 45px of it — linked lines were 32px apart, so plain 44px areas would have
  overlapped. Heading links (`.dash-panel-h`, the comparison title) get an invisible centred 44px
  `::after`. The Rate Card's unit select was 22px → 44px. **Inline links in prose are deliberately
  left** (GST note's "depreciation register", the Rate Card rate note's Overhead / Capacity, Profit
  Goals' "Capacity screen"): WCAG 2.5.8's inline exception, and a 44px area there would cover the
  prose lines around them. The accessibility pass may want to revisit that call.
- **Info button hit area was 42px, not 44** — `inset: -13px` on an absolute `::after` is measured
  from inside the 1px border, so 16 + 26. Now `-14px` in `info.css` (a base rule; invisible change).

### Known and left

- **At the 1100 → 1099 boundary the child gets wider** (817 → 860px) as the rail narrows. The brief
  fixes the rail at ≥1100, so this is the cost of following it; it reads as a reflow, not a break.
- **The Dashboard panels stack at ≤900px, not ≤899** as the brief words it — the Dashboard task put
  the rule in responsive.css's existing `max-width: 900px` band, which the whole file uses. 1px;
  left alone.
- The Invoice Settings dialog was found open mid-session (not opened by any script); it was
  cancelled without saving.

### Verified (local `api-scratch` + `web`, dispatched events)

The audit sweep above, with nothing left but the register scroller and the exempt inline links.
Screenshots checked at 768 (pinned actions column while scrolled), 1000 (column invisible when the
table fits), 375 (collapsed comparison with two rows forced below floor in the **local cache only**
— restored afterwards, server rate card untouched at $1,120; Rate Card unit select 44px beside the
hours field; CSV button 44px and on screen). 1280 identical to before (rail 152, child 997/1000px,
toggle hidden, all 21 rows shown). No new console errors.

## What landed (2026-09-28) — Estimate editor day-unit wording

`web/js/calc.js` (+ identical `server/src/calc.js`), `web/js/rows.js`,
`web/js/views/estimate-editor.js`, `web/js/views/estimate-detail.js`, `web/css/estimates.css`,
`server/test/test-calc.js`.

- **The floor was already right**; this task made it legible. `computeTotals().totalHours` has been
  Σ qty × hoursPerUnit since the first Foundation task, so a day-row estimate's Minimum Job Price
  was correct but its note said "across 27 hours" beside quantities of 2, 1, 3 and 4. Verified end
  to end on the scratch card (Full Day 8 h, Half Day 4 h, $15.12/hr, 25%): 2 full + 1 half + 3 h +
  4 h editing → **27 hrs, $510.30** (the pre-fix sum-of-quantities would have given 10 hrs,
  $189.00). The modal's three lines add to it ($0.00 + $408.24 + $102.06).
- **New `labourHoursBreakdown(activeRows, pricing)` in calc.js.** Walks labour rows exactly as
  `computeTotals` does and returns `{ units: [{ dayUnit, hoursPerUnit, qty, hours }], hourlyHours,
  totalHours }`. A test pins its `totalHours` to `computeTotals`' on a mixed card and on
  `DEFAULT_PRICING`; two mutations (orphan rows counted, grouping ignoring length) were checked to
  fail it. Display only; nothing prices off it. The editor also refuses to print the working if the
  two totals ever disagree.
- **The note:** "to cover $15.12/hr of overhead across 27 hours (2 full days of 8 hrs, 1 half day of
  4 hrs, plus 7 hrs of hourly work) and a 25% margin". **An hourly-only job gets no parenthesis**, so
  every existing estimate's note reads as it did. The modal's Overhead Allocation line carries the
  same working.
- **The column heading is decided per category, from the live card**: "Qty" if any row the category
  sells is a day row (or carries hours ≠ 1), else "Hours" as before. It's judged on the card, not
  the estimate's lines, so it doesn't flip as rows are added. In a Qty category the editor puts
  "per hour" / "per full day · 8 billable hrs" under each service name (the Rate Card's wording,
  `.lab-unit`), and the detail view prints "2 full days" / "3 hours" in the cell. The stacked
  mobile label and the input's `aria-label` always name the unit ("Full days for …").
- **Shared helpers in `rows.js`**: `labourUnit(def)`, `unitWord(kind, qty)`, `qtyLabel(kind)`,
  `sectionHasUnits(section)`. A row with hours ≠ 1 but no `dayUnit` is a generic "unit", never
  passed off as hours. **Next tasks should use these** rather than re-deciding what a row's
  quantity counts.
- **Units come from the live card**, like the Mark-Up beside them. An estimate saved before a row
  was switched hourly ↔ day would relabel; the Rate Card already warns before that switch.
- **Nothing client-facing changed**: the PDF lists labour by name only.

### Verified (local `api-scratch` + `web`, dispatched events)

1280px: Production heads Qty with unit lines; Pre-Production and Post-Production still say Hours with
no extra line. Toggling the overhead switch moved neither Client Price nor Total. Saved → detail
shows "2 full days / 1 half day / 3 hours", Total Hours 27, $3,552.00 as the server stored it;
re-opened in the editor with the same floor and note. 375px: editor and detail, no horizontal
scroll, stacked labels Full days / Half days / Hours. No console errors after a cache-bypassing
reload (a stale cached `rows.js` threw `sectionHasUnits is not a function` on the first load; the
python dev server doesn't bust caches). The test estimate was deleted from the scratch DB afterwards.
188 server tests pass.

### Deploy note

`server/src/calc.js` changed only to stay byte-identical with the browser copy; the server never
calls the new function, so **Pages alone deploys this**. Redeploy the NAS whenever convenient.

## What landed (2026-09-27) — Profit Goals

`web/js/views/goals.js`: the **Billable Capacity (hrs / week)** input is gone. In its place, in the
same third column, a read-only **Annual billable hours** figure (`1,776 hrs`) with Capacity's own
working under it — `CapacityView.derivation()`, now exported from `capacity.js` so the two screens
can't explain the number differently — and a link to the Capacity screen; em dash plus a set-up link
when capacity can't be computed. The page title is now **Profit Goals** (was "Goals"; the rail
already said Profit Goals) with a new sub-line, and the save bar no longer claims saving "changes every
labour rate" — margin moves the floors and the minimum job price, not the overhead rate.
`goals.css` gained the figure's styles.

### Decisions made here

1. **A figure, not a disabled input.** A greyed box reads "you can't edit this right now"; the truth
   is "this is edited somewhere else", which the hint and link say.
2. **The save no longer sends `billableCapacityHrsPerWeek`.** The route already recomputes that
   legacy column from the four capacity fields on every write, so nothing changes server-side and no
   deploy is needed there. The form is now three fields (net, margin, tax); the capacity validation
   and its 168-hour rule went with the input, and the "every field is required" comment was rewritten
   around the margin's `|| 0` trap, which is the one still true.

### Verified (local `api-scratch`, dispatched events)

Three columns at 1280px (net, margin, hours) with the working sentence; no `#goals-capacity` in the
DOM. A margin save (25 → 30 → 25) changed **only** `targetProfitMarginPct` on the stored row — the four
capacity fields, `capacityConfirmedAt`, `iawoThreshold` and the legacy weekly column untouched — and
the unsaved guard saw the edit and cleared after save. The hint's link lands on Capacity with the rail
following. Capacity nulled in the local cache only → "—" and "Not set up yet…" with the link;
restored → 1,776 hrs. 375px: single column, no horizontal scroll. No console errors. No server change;
suite not re-run for it.

## What landed (2026-09-27) — Disposal flow

**Register** (`web/js/views/depreciation.js`): each held asset gets a **Dispose** button; a disposed
one (visible under "Show disposed") gets **Disposal**, which reopens the same dialog to correct it or
**Undo disposal**. **Dialog**: disposal date (min = start date, max = today), proceeds, an optional
reason (Sold / Traded in / Scrapped / Lost or stolen / Given away / Other — stored as the words), and a
live preview of what saving does: the reserve drop per year, then either the disposal FY, adjustable
value at disposal and signed balancing adjustment (from `LSCDepreciation.balancingAdjustment`, the
server's own chain) or, for a pooled asset, that the proceeds come off the pool's balance with no
adjustment of its own. On save the schedule jumps to the disposal FY. **Route**
(`server/src/routes/depreciation.js`): `disposalProblem()` on POST and PUT. `depreciation.css` has the
dialog styles.

### Decisions made here

1. **The route enforces the date rule, not just the screen.** A disposal before `start_date` makes
   the chain count negative days held and produces a decline and adjustment from time that never
   happened — a wrong number, not an error. 400 `disposal_before_start` (same day allowed),
   `disposal_date_invalid` (not a real calendar date — 2025-02-30 is refused, not rolled into March),
   `disposal_proceeds_invalid` (negative). Each carries a `message` the screens show.
2. **Future dates are refused on screen only** ("record a disposal once it has happened"). The server
   would judge "today" by the NAS clock, so it stays out of that.
3. **Proceeds are required on screen** (0 allowed — scrapped, lost, given away) though the route
   accepts null (the chain reads it as 0). The hint follows GST registration: registered → exclude
   the GST charged on the sale (the ATO's termination value excludes it); not registered → the full
   amount.
4. **A lodged disposal year is warned about, not refused.** The dialog fetches
   `/api/depreciation-locks` when it opens; if the disposal FY is lodged it says the schedule will
   keep the lodged figures and flag the change, and that it's an amendment for the accountant. This
   matches "no unlock from this UI" — the lock already shows divergences.
5. **Undo is a real action** (confirm names the reserve rise and the schedules it rejoins). Without
   it, a mis-dated disposal could only be fixed by re-dating it, and a wrongly-disposed asset not at
   all short of deleting it.
6. **Edit refuses a start date after an existing disposal** on the field (the route refuses it too).
7. **One write for record / correct / undo**: the whole stored asset with the three disposal fields
   swapped in — PUT writes every column, so anything not carried would be blanked.
8. Focus after save returns to the row's button (or the "Show disposed" filter when the row is now
   hidden), never `<body>`. A stale refusal clears as soon as the figures become valid.

### Deployed 2026-09-27 (~21:47 AEST), with the user's go-ahead

`main` pushed (Pages run 36316682462, success), then the NAS: SSH via the `lsc-nas` host alias (key
auth, no password). `Dockerfile`, `package*.json` and `.dockerignore` diffed identical to the NAS
copies. Backup with `sqlite3 billing.db ".backup …"` (online-safe, unlike `cp` beside a WAL) to
`/volume4/lsc-billing/data/backups/pre-disposal-20260927-2144.db`, `PRAGMA integrity_check` ok
(schema v6, 0 assets, 0 locks). `server/` copied with `COPYFILE_DISABLE=1 tar -czf - --exclude
node_modules --exclude ./data --exclude .env --exclude docker-compose.yml . | ssh lsc-nas 'tar -xzf -
-C /volume4/lsc-billing/app'`; `docker-compose.yml` and `.env` md5 identical before and after, volume
still `/volume4/lsc-billing/data:/data`. `docker compose up -d --build` used cached layers; container
recreated, `healthy`, 0 restarts, `disposal_before_start` present in the running code. Public
`/health` 200, `/api/depreciation-assets` GET and POST signed out → 401; live DB still v6 with its 6
overhead items. (Note: `/volume4/lsc-billing/app/data/` is a stray root-owned folder left from the
2026-09-22 incident — not the real data, harmless, excluded by the copy.)

### Deploy note — this one has a server change

`server/src/routes/depreciation.js` changed (validation only — no migration, no new route, same
response shapes). **Order doesn't matter** for safety: the web build validates the same rules and
doesn't depend on the new error codes, so pushing Pages first is fine; the server rule only becomes
enforced once the NAS is redeployed (§5.5 of `nas-hosted-billing/DEPLOYMENT.md`; take a backup, copy
`server/` excluding `node_modules`, `data`, `.env`, `docker-compose.yml`; `Dockerfile` /
`package*.json` unchanged so cached layers apply). The last deploy's check for this one: `POST
/api/depreciation-assets` signed out → 401.

### Verified

185 tests pass (2 new API tests: refusals — before start, 2025-02-30, negative proceeds, on both POST
and PUT — plus same-day allowed; and the flow — disposal on 30 Jun 2025 belongs to FY2024-25 with
+100, reserve drops by 1,000 at once, nothing on FY2025-26; re-dated to 31 Dec 2025 for $0: 184 days,
decline 100.82, adjustable value 699.18, −699.18; undo restores the reserve). Mutation checked:
disabling the before-start rule fails the refusal test. **In the browser** (local `api-scratch`,
restarted for the route change): all five refusals on their fields (blank, before start, future,
blank proceeds, negative); FX6 sold 20 Sep 2026 for $5,000 previewed **and** scheduled at 78 days,
decline $1,253.70, adjustable value $7,546.30, balancing **−$2,037.04** — matching the hand working;
business cost $26,850 → $25,050 (the $1,800 reserve) and overhead/hr $15.12 → $14.10; schedule jumped
to FY 2026–27 with a Disposals block; MacBook (small business pool) into lodged FY 2025–26 showed the
pool wording and the lodged warning; Disposal reopened prefilled; Undo restored $26,850 and focus went
to the row; Edit on the disposed drone refused a start date after its disposal. 375px: row buttons
44px, no overlap, dialog fits. No console errors. **Scratch data left as found** (FX6 held again).

## What landed (2026-09-27) — Double-count hint

In the **Add Expense** modal (`web/js/views/overhead.js`): when Frequency is **One-off** and Cost is
**above** `goals.iawoThreshold`, a hint appears under the cost field — *"This looks like a capital
asset — track it in Depreciation instead?"* — saying why (counted once there as a replacement
reserve; entered here too, it's counted twice and every rate rises) and that it's only a hint. Two
buttons: **Track it in Depreciation** and **Dismiss**. Styled as a hint (1px border, 2px accent rule
on the left, `--muted` text), in an `aria-live="polite"` box that is always in the DOM and only
rewritten when its content changes, so it's announced once, not per digit. `overhead.css` gained the
styles; `depreciation.js`'s `openAdd(openedBy, prefill)` gained the optional prefill.

### Decisions made here

1. **Never blocks.** `problems()` doesn't know the hint exists; Save works with it showing.
2. **No threshold, no hint.** With `iawoThreshold` null there is nothing to compare against, and the
   threshold is deliberately never hard-coded (open seam: "ATO thresholds stay user-entered"). The
   Depreciation tab's threshold copy already says it's used for this flag.
3. **Strictly above** the threshold (`cost > threshold`), per the IA doc's "above". The cost is the
   expense's GST-exclusive figure compared as entered.
4. **Add only, not Edit.** It was offered when the expense was added; "track it in Depreciation" from
   an edit would leave the saved expense behind — the two-records problem itself.
5. **"Track it in Depreciation" skips the discard confirm** (choosing to move it answers that
   question), switches Overhead to its Depreciation tab and opens **Add Asset with only the name**
   carried over. Not the cost: the expense is GST-exclusive and the asset's cost is GST-inclusive, so
   carrying the number would plant it on the wrong basis. The name is applied *after* the asset
   form's unsaved baseline, so closing Add Asset without saving still asks before discarding it.
6. **Dismiss** hides it for the rest of that modal (resets on the next open) and puts focus on Cost,
   since the button that had focus has just gone.

### Verified (local `api-scratch`, threshold $20,000, dispatched events)

Monthly $25,000 → no hint; one-off $25,000 → hint; one-off exactly $20,000 → none; $20,000.01 → hint;
Dismiss → gone, stays gone while typing, focus on Cost. Saved a one-off $25,000 with the hint showing
→ saved (non-blocking); its Edit modal showed no hint; then deleted it (the scratch DB gained two
overhead snapshots from that save/delete — harmless). Track it in Depreciation → no confirm, expense
modal closed, Depreciation tab active, Add Asset open with "Sony FX6 body", cost empty, focus on
name; Escape asked "unsaved changes to this new asset"; no asset created. Threshold nulled in the
local cache only → no hint on a $99,999 one-off; restored → hint. 1280px and 375px (buttons 44px, no
horizontal scroll). No console errors. No server change; the suite was not re-run for it.

## What landed (2026-09-27) — Post-ratio readout

Dashboard section (6), between jobs needed (5) and the GST mirror (7): **Shooting and post against
capacity**. Two display-local inputs — shoot days / month (default 4) and edit days per shoot day
(default 1) — and a sentence in an `aria-live="polite"` region: *"At 6 shoot days a month, post takes
72 hrs — leaving 28 hrs of billable time unsold"*, then the shooting + post of monthly hours, then the
ceiling: *"At this ratio your capacity fits at most 7.4 shoot days a month."* Nothing saved, no
route, no `LSCUnsaved` watcher; defaults return on every mount.

### Decisions made here

1. **Two inputs, not one — the user's call (2026-09-27).** The task named one editable ratio, but
   the brief's sentence needs an N. Asked; the user chose shoot days/month as a second input over
   deriving N from jobs-needed ÷ 12 (a job isn't one shoot day) or dropping N for a ceiling-only
   sentence. The ceiling line is kept as well.
2. **The arithmetic is `postRatioReadout(capacity, shootDays, ratio)` in `calc.js`** (both copies),
   not inline in the view, so it is unit-tested like `jobsNeededPerYear`. A shoot day and an edit day
   are each **Capacity's `billableHoursPerDay`** — the same standard day as the headline floors — and a
   month is annual billable hours ÷ 12. Over-subscription returns a **negative `unsoldHours`**, not
   null. `maxShootDays` is **floored** to a tenth (snapped at ×10 first so float error can't turn 6.8
   into 6.7) — never rounded up into a day that doesn't fit.
3. **Over-full reads as a warning, not an error**: "with shooting, that's 172 hrs more than the
   month has" in `--accent-text` with the badge's 1px accent rule — not the red error box, not
   `role="alert"`. "With shooting" because the excess is shoot + post, not post alone.
4. Ratio 0 reads "with no post, shooting takes X hrs"; blank or negative input → em dash + "Enter
   shoot days and edit days — each 0 or more"; no capacity → em dash + a link to Capacity.

### Deploy note

`server/src/calc.js` changed (the two copies must stay identical), but no route calls the new
function, so **the NAS does not need a redeploy** — pushing `main` (Pages) is the whole deploy. The
NAS catches up on its next redeploy for any other reason.

### Verified

183 tests pass (5 new). Two mutations checked to fail: dropping the ratio from `postHours` (3 tests)
and `Math.round` for the ceiling's floor (1). In the browser (local `api-scratch`, 8/5/30/8 capacity
= 148 hrs/month, dispatched input events): defaults 4 × 1 → 32 + 32, 84 unsold, ceiling 9.2; 6 × 1.5
→ 48 + 72, 28 unsold, 7.4; ratio 0 → "with no post", 100 unsold, 18.5; 10 × 3 → 172 over, warning
class, 4.6; blank and negative → the prompt; leave and return → back to 4 / 1, and no unsaved prompt;
capacity nulled in the local cache only → em dash + Capacity link, then restored. Section order is
1–7. 1280px and 375px (inputs full-width and 44px tall on the phone, no horizontal scroll). No
console errors.

## What landed (2026-09-27) — GST mirror

Dashboard section (7), last on the page: a `.tax-setting` block (`#dash-gst`) with `Registered for
GST`, `Rate (%)` and `Prices include GST`, and its own **Save GST** button, writing `settings.gst`
through the existing `PUT /api/settings`. Copy says out loud that it is the same setting as Invoice
Settings, states what the stored setting does today (a status line built from the **saved** values,
never the half-edited form), and names both consequences: every figure on the page stays ex-GST,
and registering changes the cost base of gear bought from then on — existing assets keep their own
`gst_credit_claimed` tick (with a deep link to the register). Files: `web/js/views/finance-dashboard.js`
(section 7 + header), `web/js/views/settings.js` (one call + header note), `web/css/finance-dashboard.css`,
`web/css/responsive.css` (<768px touch targets only). No server change; 178 tests pass.

### Decisions made here — read before touching either GST screen

1. **The Dashboard is no longer strictly read-only.** Its header now says "read-only, bar one
   mirror": sections 1–5 still own and edit nothing; section 7 edits a number Invoice Settings owns.
   It registers one `LSCUnsaved` watcher (`dashboard-gst`, label "the GST settings") scoped to the
   block, so leaving with an unticked-but-unsaved change asks first.
2. **The save merges onto a FRESH read, not the LSCData cache** — `GET /api/settings` at save time,
   swap in `gst`, `PUT` the whole row. Same reason the modal reads fresh on open: the route replaces
   the whole row, and a boot-time cache can lack an ABN or bank details saved since. Sending `{ gst }`
   alone would wipe the payment block off every invoice.
3. **Same validation as the modal, deliberately duplicated in wording:** registering needs an ABN
   (checked against the fresh row; the error carries an **Open Invoice Settings** button, the same
   one `estimate-detail.js` uses for its missing-ABN export error); the rate must be 0–100 only
   while registered; an unusable rate while unregistered keeps the stored rate. `settings.js`'s
   header now says the rules live in two places and must move together.
4. **Conflict check — new, not in the task.** If the stored `gst` no longer matches what the block
   loaded (another window, or the modal saved while this block had unsaved edits), nothing is
   written: the block redraws with what is stored and says so. Without it, a form built on the old
   value would silently revert someone else's change to a field that moves the money on every
   estimate.
5. **`FinanceDashboardView.refreshGst()`**, called by `SettingsView` after its save (alongside
   `EstimateEditor.refreshTotals()` / `EstimateList.refreshFirstRun()`, same no-op-unless-on-screen
   shape). The modal opens over any screen, including this one: with no unsaved edits the block
   follows the new setting in place; with edits, it leaves them **and leaves `gstSaved` alone**, so
   decision 4's check fires on the next save rather than the stale form winning.
6. **Only the comparison table redraws on save.** It is the one GST-aware part of sections 1–5
   (`labourFloorComparison` → `priceExGst` backs GST out of a GST-inclusive card's `mu`). Floors,
   chain and targets don't read GST. The rest of the page isn't re-rendered, so focus stays on Save.
7. **Checkboxes inside `.tax-setting` needed putting back to their own size**: `app.css`'s
   `.tax-setting input { width: 90px }` and `responsive.css`'s `{ width: 100%; min-height: 44px }`
   are written for the block's one number field. `.dash-gst input[type='checkbox']` overrides them;
   below 768px each checkbox *label* is the 44px target instead.

### Verified (local `api-scratch` + `web`, dispatched events per the memory note)

Initial state (unregistered, 10%, exclusive; rate and inclusive disabled). Registered with no ABN →
refused, error + Open Invoice Settings button, stored `gst` unchanged. Unsaved guard on the rail
(confirm text "unsaved changes to the GST settings", declined → stays). Error button → modal → ABN
only → saved; the Dashboard kept its unsaved tick through the modal's save, then Save GST registered
**and the ABN the modal had just written survived the merge**. Dashboard → 15% inclusive → Invoice
Settings modal showed registered / 15 / inclusive / the ABN; the comparison's first row went
$56.00 → $48.70 (= 56 ÷ 1.15). Invoice Settings → 10% exclusive with the Dashboard behind it → mirror
followed in place, comparison back to $56.00, not dirty. Conflict: edited the mirror, changed the rate
to 12.5% by a direct PUT, saved → refused with the conflict message, stored 12.5% intact, block
showing 12.5%. Deregister with a blank rate → saved, stored rate kept at 12.5%. Registered at 150% →
field error, `aria-invalid`, focus on the rate, nothing stored. 1280px and 375px (no horizontal
scroll; checkbox labels 44px tall on the phone, checkboxes 13px). No console errors. **Scratch
settings restored to exactly what they were** (unregistered, 10%, no ABN).

## What landed (2026-09-27) — Info control

A shared component: `web/js/info.js` (`LSCInfo.markup({ id, label, title, paragraphs })`) and
`web/css/info.css`, loaded after `typeahead.js` / after `finance-dashboard.css`. Two instances:

- **Dashboard → "Rate card against its floors"** — `compareInfo()` in `finance-dashboard.js`, named
  "How the floor comparison works". It **replaces the `.dash-note` that sat under the table**; the
  popover says the same things in full (floor = hourly floor × hours per unit; measured against the
  Mark-Up price ex-GST, not the internal rate; crew/hire/travel/flights/accommodation excluded as
  pass-throughs; below floor is a warning, change it on the Rate Card).
- **Overhead → Depreciation, under the two-number card** — `splitInfo()` in `depreciation.js`, named
  "Why the replacement reserve and the tax deduction differ". It **replaces the paragraph** that
  explained the split; the line now reads "Two numbers from the same gear, on purpose. (i)".

### The contract, and how it's met — don't regress these

- **A `<button>`** with an accessible name saying what it explains, `aria-expanded` +
  `aria-controls`. A disclosure, not a dialog: no focus trap, no backdrop.
- **Tab-reachable:** the popover follows the button in the DOM with `tabindex="0"` (a `hidden`
  element isn't focusable), `role="region"` labelled by its caption. Tab from the button lands in it;
  Tab out closes it (`focusin` elsewhere).
- **Escape** closes and returns focus to the trigger — a capture-phase listener that only stops the
  event when a popover was open, so a modal behind it keeps its own Escape.
- **Hover is a convenience:** real mouse only (`pointerType === 'mouse'`), 150ms in / 250ms out so
  the pointer can cross the gap; clicking a hover-opened popover pins it; outside click closes.
- **All spans.** The markup is phrasing content throughout so it can sit inside a heading or a
  sentence without invalid HTML — but on the Dashboard it is placed **beside** the `<h2>`
  (`.dash-block-title`), not in it, so the heading's accessible name stays "Rate card against its
  floors".
- **`position: fixed`**, placed from the button's rect on open and on every scroll/resize — because
  `.est-block` is `overflow: hidden` and an absolute popover would be clipped. Clamped 16px inside the
  viewport, flips above the button when there's no room below; a notch follows the button
  (`--info-nub-x`). **A transformed ancestor would break this** — none exists in `#main`.
- 44px hit area on an 18px mark via an inset `::after`. `z-index: 60` — above page content and the
  typeahead (50), below the header (100) and modals.

### Verified (local, 2026-09-27)

Real key presses and real mouse: Tab from the button into the popover, Tab out closed it; Escape
closed it with focus back on the trigger; hover opened it and leaving closed it; hover then click
pinned it open past leaving; an outside click closed it. At 375px the Depreciation popover sat
16–19px inside both edges, below its button, and kept an 8px gap while the page scrolled. No console
errors. The Accessibility pass should re-check both instances with a screen reader.

## What landed (2026-09-27) — CSV export and lodgement lock

The foot of the schedule on Overhead → Depreciation, plus server changes. Files:
`server/src/routes/depreciation.js`, `server/src/depreciation.js` + `web/js/depreciation.js` (the
byte-identical pair), `web/js/views/depreciation.js`, `web/js/api.js` (`getCsv`), `web/js/util.js`
(`saveFile`, moved from `estimate-detail.js`), `web/css/depreciation.css`, and both test files.

- **Download CSV — FY 2025–26**: `LSCApi.getCsv('/api/depreciation-schedule.csv?fy=…')` →
  `LSCUtil.saveFile`, filename from the server (`depreciation-schedule-FY2025-26.csv`). Through
  fetch, not an `<a href>`, because `download` is ignored on a cross-origin link and an expired
  session would show a bare 401. Local download only.
- **Mark FY 2025–26 as lodged**: only for a **finished, unlodged** year. `window.confirm` names the
  figures being frozen and says there's no undo; then `POST /api/depreciation-locks`, refetch, focus
  moves to the new "Lodged" statement (the button that had focus is gone). The current FY shows
  "You can mark FY 2026–27 as lodged once it ends on 30 June 2027" instead.
- **A lodged year renders `lockedFigures`, never the live recompute**, with a "Lodged" badge and
  the date. If today's recompute disagrees, an accent-ruled block lists **each line and each figure
  that moved** ("DJI Mavic 3 — disposal proceeds: lodged $1,000.00, now $1,200.00; balancing
  adjustment: lodged −$561.10, now −$361.10") and the changed rows are tagged "Changed since
  lodging". Deleted-since and added-since lines are listed too. Putting an asset back clears it.
- **No unlock, no second lodgement from the UI** — per the task. The server still accepts a second
  POST (append-only log, migration v5 decision 4); that is the "deliberate act outside this UI".

### Decisions made here — read before touching the lock or the CSV

1. **Divergence is line by line, not totals.** The Routes task compared only `totalDeductible` and
   `totalBalancingAdjustment`, which misses edits that cancel across lines and can't say which asset
   moved — the one thing the user needs for their accountant. `scheduleDivergences(lodged, live)` in
   the route returns `[{kind, id, name, change: 'changed'|'removed'|'added', fields: [{field, lodged,
   live}]}]`; `diverges` is kept as its boolean (null when unlocked). Exact comparison is correct:
   both sides are round2'd cents through the same JSON round trip.
2. **Schedule rows now carry their own inputs** — `businessUsePct`, `disposalDate`,
   `disposalProceeds` — in the shared chain (`assetScheduleRows`). Without that, a lodged year's
   Disposals block paired frozen figures with the asset's *current* proceeds and business use (the
   seam the schedule task left). Locks taken before this change lack the fields; the view and the
   CSV fall back to the live asset for them, and divergence skips fields the lodged row doesn't have.
   No live locks existed when this landed, so that fallback is belt-and-braces.
3. **The server refuses to lock an unfinished FY** (`400 fy_not_ended`, via `fyHasEnded()` comparing
   FY start years through the shared helper). A year's figures still move until 30 June. The
   schedule reply now carries `fyEnded` so the screen asks the same question.
4. **CSV format changed**: columns are Name, Category, Method, Start Date, Days Held, Business Use %,
   Opening Adjustable Value, Pool Additions, Decline in Value, Deductible, Closing Adjustable Value,
   Disposal Date, Disposal Proceeds, Balancing Adjustment. Money to two places (`800.00`); a **UTF-8
   BOM** so Excel doesn't mangle "—" in names; text cells starting `= + - @` get a leading apostrophe
   (formula injection — numbers are never touched, so −561.10 stays a number); pools fill Pool
   Additions so their row reconciles alone. The old `Disposed yes` column went — Disposal Date says it.
   Category/method/start date still come from the live asset (descriptive); an asset deleted after
   lodging keeps its frozen money row with those three blank.

### Deploy note — this one needs the NAS

`server/` changed (route + chain). **Order doesn't break anything either way**, checked: with new
Pages on the old server, the reply has no `fyEnded`, so every year shows the "once it ends" note and
**no lock button is offered** until the NAS is redeployed; the badge, lodged figures and CSV all work
against the old server (the CSV in its old column format). No migration — no schema change. Deploy
the NAS the same way as 2026-09-27 (tar `server/` excluding `node_modules`, `data`, `.env`,
`docker-compose.yml`; `docker compose up -d --build`). This also brings `defaults.js`' day rows live
for Reset Defaults.

### Verified (local scratch DB, 2026-09-27)

- `npm test` **178 pass** (new: row carries its inputs; line-level divergence with exact fields;
  deleted-since divergence; locked CSV after delete; `fy_not_ended`; BOM checked on raw bytes —
  `Response.text()` strips it; formula-name escaping).
- FY 2026–27 (current): "once it ends on 30 June 2027" note, no lock button. FY 2025–26: CSV captured
  in-page (not saved to disk) — BOM, filename, `DJI Mavic 3,…,2386.85,,825.75,825.75,1561.10,
  2026-03-31,1000.00,-561.10` and `Small Business Pool,…,0.00,3080.00,462.00,462.00,2618.00`.
- Locked it: confirm text named $1,287.75 and −$561.10; badge "Lodged … 27 Sept 2026"; focus on it.
- Changed MacBook business use 70→60 **through the Edit modal** (exercises the cache drop) and the
  drone's proceeds 1000→1200 via the API: two divergence lines with exactly the expected pairs (pool
  additions $3,080→$2,640, decline $462→$396, closing $2,618→$2,244; proceeds $1,000→$1,200,
  balancing −$561.10→−$361.10); totals stayed at the lodged $1,287.75 / −$561.10; the Disposals row
  still read the lodged $1,000.00; the lodged CSV was unchanged. Reverting both cleared it
  (`divergences: []`).
- 1280px and 375px: no page-level horizontal scroll; CSV button 44px tall and on-screen at 375px.
  No console errors. **The scratch DB now has FY 2025–26 locked** — fine for later tasks; re-seed if
  you need it unlocked.

## What landed (2026-09-27) — Depreciation schedule

Below the register on Overhead → Depreciation, in `web/js/views/depreciation.js` (`scheduleMarkup`,
`scheduleBodyMarkup`, `ensureSchedule`) and `web/css/depreciation.css`. No server change.

- **FY selector** — a `<select class="doc-type-select">` labelled `FY 2025–26` (via `fyDisplay`),
  the current FY marked "(this year)" and selected on every mount (`currentFinancialYear()`, never
  `getFullYear()`). Options run newest-first from the earliest start date to the latest of this FY,
  any start date and any disposal date — a year with nothing held stays in the list and shows the
  empty state, because a gap is a fact, not a hole. If a delete or re-date removes the selected year
  from the range, `render()` falls back to the current FY.
- **Fetched, not computed locally.** `GET /api/depreciation-schedule?fy=` per selected year, one
  reply cached (`sched`), dropped by `refreshCache()` → `dropSchedule()` on every asset write (which
  also bumps `schedSeq`, so a reply computed before the write is ignored). Ticking "Show disposed"
  doesn't refetch. Why the route and not `LSCDepreciation` in the browser: the route is where a locked
  year's frozen figures and `diverges` come from — a local recompute would have to be torn out by the
  next task. (The summary card's one headline figure still computes locally; that's fine.)
- **Three blocks, not one table:** Individual assets (days held, opening adjustable value, decline
  in value, business use, deductible, closing adjustable value, plus a totals row when >1 asset);
  Pools (opening pool balance, additions at business share, decline in value — deductible in full,
  disposal proceeds, closing pool balance, and "Added this year: …" naming the gear, which the pool
  row itself doesn't carry); Disposals, only when something was disposed of that year (date and
  proceeds read from the asset, adjustable value at disposal, business use, signed balancing
  adjustment with "assessable" / "deduction" in words). Above them, two totals: deductible decline in
  value, and balancing adjustments — **kept separate, never summed**; they are different lines on the
  return.
- **Vocabulary** is the IA glossary's throughout: decline in value, adjustable value, disposal. Not
  "depreciation" (except the section title, which names the screen), "book value" or "sale".
- **Totals are a `<tbody>` row, not `<tfoot>`** — responsive.css has no stacked-card rule for a
  footer group. Its spacer cells are `.dep-blank`, hidden below 768px.
- **`signedFmt`** — `LSCUtil.fmt(-5)` prints `$-5.00`; balancing adjustments get a real minus sign.
- **Screen reader:** a visually hidden `aria-live="polite"` line (`.dep-live` — the app has no shared
  sr-only class) announces "FY 2025–26: $1,287.75 deductible across 2 lines." only after the user
  changes the year, never on first load; the tables themselves are not live. Only the body under the
  select re-renders, so focus stays on the select.
- **Empty states:** no assets at all (no selector — there's nothing to select); nothing held in the
  selected FY; a failed fetch shows the error with **Try again**; auth loss goes through
  `onAuthLost({ keepScreen: true })`.

### A live defect found and fixed on the way (from the register task)

Between **768px and 1099px** the rail leaves `#finance-sub` ~550px, and `.est-block` has
`overflow: hidden` — the register (needs ~760px) was clipping its **Edit and delete buttons out of
reach** on the live site. Every depreciation table now sits in `.dep-scroll` (`overflow-x: auto`,
tinted scrollbar); read-only schedule tables' scrollers take `tabindex="0"` + `role="region"` + a
name so a keyboard can scroll them. At ≥1100px nothing scrolls (checked: 0px overflow on all four).
The Dashboard, Rate Card and Operating Costs tables were measured at 800px and fit — this was only the
depreciation tables. The **Responsive pass** should still decide whether this band wants the tables
stacked instead; the scroller is the minimum that makes the buttons reachable. Also noticed at 800px,
not fixed: Overhead's "+ Add Asset" / "+ Add Expense" head button wraps to two lines.

### Seams this left for the lock task — all closed by it

Rendering frozen figures, the badge and the divergence flag, placing the CSV and lock at the foot,
and where a locked year's disposal inputs come from were all decided by the next task — see "What
landed — CSV export and lodgement lock" above.

### Verified (local scratch DB, 2026-09-27)

Added a prime-cost drone ($3,300, not GST-claimed, 3-year life, started 1 Sep 2024, disposed 31 Mar
2026 for $1,000) beside the existing FX6 and pooled MacBook, and checked every figure by hand:

- **FY 2024–25:** 303 days × $1,100/yr ÷ 365 = **$913.15**, closing **$2,386.85**.
- **FY 2025–26:** 274 days → **$825.75**, closing **$1,561.10**; balancing (1,000 − 1,561.10) × 100%
  = **−$561.10 deduction**; pool additions $4,400 × 70% = **$3,080** × 15% = **$462.00**, closing
  **$2,618.00**; total deductible **$1,287.75**.
- **FY 2026–27:** FX6 361 days → decline **$5,802.37**, deductible **$4,641.90** (80%), closing
  **$2,997.63** (not apportioned); pool $2,618 × 30% = **$785.40**; total **$5,427.30** — equal to
  the summary card's local figure.
- Gap year (an instant-write-off tripod in FY 2022–23 made FY 2023–24 empty): empty state reads
  right; the tripod's zero-proceeds disposal nets to **$0.00**; deleting it while FY 2022–23 was
  selected fell back to FY 2026–27 and refetched. No-assets state: message, no selector.
- 1280px, 800px and 375px: no page-level horizontal scroll; the stacked cards at 375px carry every
  label; the select is 44px tall on mobile. No console errors. `npm test` 176 pass.

## What landed (2026-09-27) — Depreciation register

`web/js/views/overhead.js` (inner tabs), new `web/js/views/depreciation.js` (`DepreciationView` —
not the `LSCDepreciation` maths in `web/js/depreciation.js`), `web/css/depreciation.css`, inner-tab
rules in `overhead.css` / `responsive.css`, overlay `#modal-depreciation-asset` in `index.html`.

- **Inner tabs** are a `<nav aria-label="Overhead sections">` of `.nav-link`s — the row the rail
  vacated. Operating Costs renders exactly as before. The page-head button follows the tab (+ Add
  Expense / + Add Asset). Switching asks `LSCUnsaved.confirmLeave()` (the threshold field watches).
- **Top of the tab: replacement reserve / year beside this FY's tax deduction**, each captioned (in
  every rate / in no rate), plus a one-paragraph explanation where the info button will go. The
  deduction is `LSCDepreciation.financialYearSchedule(cache, currentFinancialYear()).totalDeductible`
  — **live, not the locked figure**; when the lock task lands, decide whether a locked current FY
  should show its frozen total here.
- **Register**: `.est-table` with `data-label` on every cell (verified at 375px), API order
  (category, start date), disposed hidden behind a "Show disposed (N)" toggle with counts in the
  heading, disposed rows muted and tagged "Disposed <date>". Empty state names the capital vs running
  cost rule.
- **Modal**: five groups (identity / dates / cost & GST / for tax / for pricing), `LSCModal.trapTab`,
  Escape and backdrop dismiss via `LSCUnsaved`, focus returns to the opener. Method and category
  re-render the box (effective life appears for diminishing value and prime cost only; car limit for
  vehicles only) with focus kept. Live "Adds $X a year to your replacement reserve" line. GST note
  states the current `settings.gst.registered` and doesn't disable the checkbox (the credit belongs
  to the purchase, not today's registration). Validation includes start date before purchase date.
- **The trap avoided: edits carry the disposal fields through.** The PUT writes every column and a
  missing `disposalDate` becomes NULL, so an edit sending only on-screen fields would un-dispose a
  sold asset. Verified by disposing via the API, renaming in the modal, and re-reading.
- **Effective-life placeholders** (camera 3, computer 2, drone 3, vehicle 8) are placeholders only,
  never values, each with "confirm with your accountant". Worth the accountant checking them.
- **Write-off threshold**: its own small save at the foot of the tab, `PUT /api/goals
  { iawoThreshold }` only — verified it leaves income, margin, capacity and `capacityConfirmedAt`
  untouched. Blank clears it to NULL ("not confirmed").
- **Verified numbers**: FX6 $8,800, 80%, DV 3 yrs from 5 Jul 2026 → deduction $4,641.90 (361/365 ×
  200%/3 × 80%); reserve $9,000 ÷ 4 × 80% = $1,800; pooled MacBook $4,400 × 70% → $785.40 in its
  second year; total $5,427.30. With the reserve, Dashboard and Rate Card both read $14.53/hr
  ($25,800 ÷ 1,776).

## What landed (2026-09-27) — Rate Card day rows

`web/js/views/pricing.js`, `web/css/pricing.css` (+ one <768px rule in `responsive.css`),
`server/src/defaults.js`.

- **Second lines, not new columns.** Under each labour row's name: `per [hour ▾]`, and for a day row
  `[8] billable hrs`. Under its Mark-Up: `floor $X` or `below floor by $X` (`--accent-text`). Two
  extra columns would have cut most service names to a word; measured, truncation is unchanged
  (3 names at 1280px, as before).
- **`dayUnit: 'full' | 'half'` marks a day row**, never its name. Choosing a day unit prefills
  `hoursPerUnit` from Capacity's billable hours per day (half for half day; 8/4 if Capacity has no
  usable figure — visible and editable either way). Choosing "hour" removes both fields.
- **Switching an existing row between hourly and day asks first when saved estimates use it**: the
  quantity on those estimates would read as days (or hours) if edited later. Billed figures don't
  move — price is still qty × Mark-Up.
- **The live defect fixed:** `payload()` rebuilt rows from name/rate/mu/customBill/unit only, so
  `hoursPerUnit` was dropped on every save — a day row would silently revert to hourly, taking its
  hours out of every Minimum Job Price. Now carried, plus `dayUnit`; `hoursPerUnit` 1 is left off
  like every hourly row. A blank or out-of-range (0 or > 24) hours field blocks the save.
- **Floors via `labourFloorComparison` on a one-row card**, so each line is the Dashboard's figure to
  the cent (verified all 19 rows). The hourly floor is read once at mount, like the rate column.
- **Defaults:** Full Day $1,120 / 8 h, Half Day $640 / 4 h (own price — no 0.5 multiplier),
  Overtime $210/h. Not seeded: "Video Capture — Hourly" (the task named it) — "Video Capture" is
  already the hourly row and a rename would orphan saved estimates on default-card databases.
- **Your live saved card won't gain these rows** (defaults only apply to Reset and fresh DBs). Add a
  service and set its unit, or Reset (which replaces the whole card).
- **Dashboard headline floors stay on Capacity hours** even now that day rows are marked: a card can
  have several day rows at different lengths. Every row's own floor is in its table.
- **For the Estimate-editor task:** the editor's and estimate detail's labour column header says
  "Hours" — wrong for a day row's quantity. The client PDF lists labour by name only, so nothing
  client-facing is mislabelled.

## What landed (2026-09-27) — Dashboard

`web/js/views/finance-dashboard.js` (`FinanceDashboardView`) + `web/css/finance-dashboard.css`.
Sections 1–5 of the IA hierarchy: floors (40px Delight, largest type on the page) → rate card
against its floors (`.est-table`, badge "Below by $X" in `--accent-text` on a 1px accent rule) →
cost panel (Operating / Replacement reserve / Annual business cost — always split) beside capacity
panel (hours / overhead per hour / margin / hourly floor) → target annual revenue with month and week
averages beside jobs needed per year. Post-ratio (6), GST mirror (7) and the info button are their
own tasks; slot them in under (5).

### Decisions made here — read before the Rate Card task

1. **Headline half/full-day floors use Capacity's billable hours per day**, not "the Full Day row's
   hoursPerUnit" as the IA doc writes it. No row is identifiable as the Full Day row: the Rate Card
   task hasn't seeded them, names are user-editable, and name-matching breaks on the first rename.
   Each tile says "at N hrs" so the basis is visible, and **every actual row — day rows included —
   is still compared at its own hoursPerUnit** in the table. If the Rate Card task gives day rows a
   stable marker (e.g. a `dayUnit: 'full' | 'half'` key), switch `figures()` to read that row's
   hoursPerUnit; the header comment in `finance-dashboard.js` says the same.
2. **Every screen now divides annual BUSINESS cost**, via new `LSCData.businessCost()` and
   `LSCData.overheadRate()` in `data.js` — Rate Card column, estimate editor floor, Capacity confirm,
   Goals' target revenue and the Dashboard. Before this, the IA doc's "every screen moves to
   annualBusinessCost" hadn't happened anywhere, so the Dashboard would have disagreed with the Rate
   Card the moment an asset existed. No live number moves today (no assets exist yet). The Overhead
   screen's own "Annual Total" stays operating-only — it's the operating-costs register.
3. **Comparison math lives in calc.js** (`labourFloorComparison`), so the Rate Card task reuses it
   rather than re-deriving "is this row below floor". It takes GST out of `mu` when the card is kept
   GST-inclusive (`priceExGst`) — irrelevant while unregistered, silently flattering every row by 10%
   the day registration is ticked if it weren't there. Exactly-at-floor is not below. Travel rows are
   excluded entirely.
4. **`hourlyFloor(rate, margin)` is pinned equal to `minimumJobPrice`'s per-hour arithmetic** by a
   test, so the Dashboard and the estimate editor can't disagree about what an hour is worth.
5. **Average job value** = mean `totals.clientPriceExGst` (as stored at save, not re-priced) of
   estimates with status approved / invoiced / paid, dated after the same date last year (textual,
   29 Feb → 28 Feb; future-dated bookings count), price > 0. Drafts and sent quotes are not jobs.
   **Jobs needed rounds up.** Fetched from `/api/estimates` on mount; the panel says "Working out…"
   until it lands, and names why it's an em dash if nothing qualifies.

### Router fix found on the way (finance.js)

Goals (and now the Dashboard) bind delegated click listeners on the container they're handed.
FinanceView reused one `#finance-sub` across visits and `innerHTML` doesn't remove listeners, so they
piled up — and after a Goals visit, a Dashboard link was handled by Goals' stale listener first,
which navigated **without opts** and dropped the Overhead → Depreciation deep link. `mountChild()`
now swaps in a fresh `#finance-sub` node each time. Verified: after visiting Goals, the Replacement
reserve link mounts Overhead once, with `inner: 'depreciation'`.

### Verified (local scratch DB)

Empty states (no margin → floors em dash + "Set up a target profit margin", target → "Set a desired
net income", jobs → "No approved, invoiced or paid jobs…"). With $24,000 overhead, 1,776 hrs, 25%
margin, 35% tax, $80k net, a $100 8-hr test row and three estimates (approved $1,400, paid $2,800,
draft excluded): floors $16.89 / $67.56 / $135.12, "1 of 19 below floor — Below by $35.12", target
$160,000.00 (Goals shows the same), 77 jobs at a $2,100 average; Rate Card rate 13.51 = Dashboard
overhead/hr. Deep links: reserve → Overhead with `inner`, hours → Capacity, table heading → Rate Card.
No console errors. 1280px and 375px, no overflow. **For the Responsive pass:** on a phone the
comparison is 19 six-line stacked cards before the panels — consider collapsing to below-floor rows
first on mobile.

## What landed (2026-09-27) — Capacity

`web/js/views/capacity.js` (`CapacityView`), `web/css/capacity.css`. Order per the IA doc: first-run
note → **Annual billable hours** (live, `aria-live="polite"`, with the working spelled out: "5 days ×
52 weeks = 260 working days, less 30 leave and 8 sick = 222 billable days × 8 hrs") → the four fields
(labels say *working days*) → save bar → **Full-day hours** readout (billable hours per day under a
second name; half-day shown as half — the Rate Card task owns the actual rows). Reuses Goals'
`.goals-outcome` / `.goals-hint` classes rather than a third copy, as `goals.css` asks.

### Migration v6 — the task didn't list it; here's why it exists

1. **A Capacity save was going to zero the income target and profit margin.** `PUT /api/goals`
   wrote `Number(body.desiredNetIncome) || 0` (same for margin) on every save. The existing API
   test's capacity-only PUT was already doing it, unasserted. A 0% margin isn't "unset" —
   `minimumJobPrice()` treats it as break-even and the floor renders as a real figure. Now
   `resolveGoalField()` does body → stored → **null**. A value that *is* sent keeps the old `|| 0`
   coercion, so the Goals screen behaves exactly as before.
2. **v6 rebuilds `goals`** so `desired_net_income` / `target_profit_margin_pct` are nullable — the
   IA doc's first-run flow saves Capacity before Profit Goals ever exists, and NOT NULL would force a
   0 in. Every value carries across; the upgrade test builds the real v5 table shape, rewinds
   `schema_version`, and runs `migrate()` over it (the path the NAS DB will take).
3. **`capacity_confirmed_at`** (→ `capacityConfirmedAt`) drives the "defaults — confirm these are
   yours" note. Stamped by the route only when a PUT carries **all four** capacity fields (only
   Capacity sends them); carried forward otherwise. Deliberately not "fields equal 8/5/30/8" — those
   are the user's own spreadsheet figures and may be real. Every live row starts NULL after v6, so
   the note **will show on the live site** until the user saves Capacity once.

### Also changed

- **`annualBillableHoursFromGoals()` is deleted outright**, not just its legacy branch, with
  `LEGACY_WEEKS_PER_YEAR`. Both call sites now use `annualBillableHours(LSCData.goals())`. The "bridge"
  tests are replaced by one that fails if a weekly-figure fallback ever returns. v5's SQL comment
  still names the old function — shipped migrations aren't edited.
- **The Capacity screen sends only its four fields** — never echoes income/margin from cache (the
  header explains: that's how two writers of one row clobber each other).
- **0 hours/day is refused on screen** though the route accepts it: it stores fine and then every
  rate goes to an em dash. The route was left alone.
- **The save confirm** shows before/after hours *and* before/after overhead cost per hour, computed
  exactly as `pricing.js` computes its rate column (`annualOverheadTotal`, not yet
  `annualBusinessCost`) so the dialog's number is the Rate Card's number — verified: confirm said
  $14.15 → $13.51, Rate Card then read 13.51. **When the Dashboard/Rate Card switch to
  `annualBusinessCost`, move `rateFor()` in `capacity.js` with them.** No confirm when the hours don't
  change (e.g. confirming defaults as they stand), or when there was no capacity before.
- Copy made wrong by this task, fixed: the Rate Card note now says the rate comes from Overhead and
  **Capacity**; the Goals capacity hint links to Capacity and says a value typed there isn't saved
  (the Profit Goals task still makes that field read-only).

### Verified (local, scratch DB)

First run with no goals row (defaults shown + flagged, save doesn't confirm, flag clears, income and
margin stay **null**); before/after confirm text and figures; decline saves nothing; unsaved guard on
leaving; Rate Card rate after save; zero hours, over-full leave+sick (both fields flagged, focus to the
first), blank field; Goals → Capacity link; 1280 and 375px (no overflow; save button no longer wraps).
Found in passing, not a code bug: the *local* `python -m http.server` preview served a cached old
`pricing.js` beside a new `calc.js`, and Rate Card threw `annualBillableHoursFromGoals is not a
function`. The deployed site is protected — the Pages workflow stamps every script/stylesheet URL
with `?v=<commit>` (DEPLOYMENT.md §6) — but local previews are not: refetch with `cache:'reload'`
before trusting a local check after editing a shared file.

## What landed (2026-09-27) — the rail, the router, the rename

`web/js/views/finance.js` rewritten around a `.finance-shell` grid: a `<nav class="finance-rail">`
of five `.nav-link` buttons (Dashboard, Rate Card, Overhead, Capacity, Profit Goals) beside
`#finance-sub`. Header item reads `Finance & Price`. Tests 160/160 (nothing under `server/` changed).

### Deploy order — the NAS goes first, or the whole app stops loading

`LSCData.load()` now also fetches `GET /api/depreciation-assets`, and `loaded()` requires it. That
route exists only in commit `7fb3402`, which is **not on the NAS yet**. Pushing `main` deploys
GitHub Pages automatically; if the frontend lands before the API, the preload 404s and **every
screen** shows "Couldn't load your pricing and finance settings" — not just Finance. So:

1. Redeploy `server/` to the NAS first, and read `nas-hosted-billing/DEPLOYMENT.md` §5.5 before
   doing it — a hand-copy of `server/` caused an outage on 2026-09-22 by overwriting the NAS's
   `docker-compose.yml` volume path. The boot log must show **both** `migrated to v5` and `migrated to
   v6`. Confirm with `GET /api/depreciation-assets` → 401 when signed out (not 404). Take a DB backup
   first: v6 rebuilds the `goals` table.
2. Remember that same redeploy flips the live rate onto the capacity model (see "What landed —
   routes" below). That's resolved decision 2, but it happens at step 1, not at push time.
3. Only then push `main`.

Also expect, once pushed: the header's Finance & Price item lands on the **Dashboard placeholder**
until the Dashboard task ships. Its "Open Rate Card" button is the way through. If that's not
acceptable on the live site for a while, hold the push until the Dashboard is built.

### One layout decision made against the brief's wording

The brief says "only the container narrows by the rail's width". Built that way first and measured
at 1280px: the Rate Card lost 188px and truncated service-name inputs went from **3 to 18**
("Video Editor — Proj…" for most of Post-Production). So **`#main`'s 1080px cap grows by the rail
plus gap (to 1268px) inside Finance & Price only**, via `#main:has(> .finance-shell)` in
`finance.css` — `app.css` stays frozen, and `:has()` stops matching the moment another view
replaces the shell, so no class needs removing. Result: every child keeps its 1000px at ≥1268px
viewports (truncation back to 3, identical to before), and other screens are untouched (verified
`#main` returns to 1080 on Estimates). That better serves the brief's actual intent — each ported
screen keeps its layout. It's a one-rule revert if the user prefers the literal reading.

### Things the next tasks must match

- **View names the router resolves**: `FinanceDashboardView` (in `finance-dashboard.js`) and
  `CapacityView` (in `capacity.js`). Anything else and the router keeps showing the placeholder
  with no error. Add each `<script>` before `views/finance.js` in `index.html` by convention.
- **Tab ids didn't change**: `pricing` and `goals` stay the ids (existing `data-go-tab` links and
  the first-run step use them); only the labels are `Rate Card` / `Profit Goals`.
- **`selectTab(id, opts)`**: `opts` is shallow-merged into the child's `mount` handlers, with the
  router's own `onAuthLost` / `onGoTab` assigned last so opts can't replace them. Only plain objects
  are accepted — a click event handed in as `opts` is dropped (it has an own `isTrusted`, and would
  otherwise leak into handlers). The IA doc's key is `inner`: `onGoTab('overhead', { inner:
  'depreciation' })`. Re-selecting the current tab is still a no-op even with opts — switching a
  screen's own inner tab is that screen's job, not the router's.
- **Label/title mismatches left for their owning tasks**: the Rate Card's page title still reads
  `Pricing & Services`, Goals' reads `Goals`, and the Rate Card's rate note says "update it on the
  Overhead / Goals tabs". Renaming them is `pricing.js` / `goals.js` work — the Rate Card task and
  the Profit Goals task respectively. **All three done** — the last, the Rate Card's `<h1>`, by the
  Accessibility pass (2026-09-28).
- **Responsive**: only the <768px fallback shipped (horizontal scrolling row, 44px targets, first
  label on the 16px gutter, scrollbar hidden, active item scrolled into view). The 1099–900 "rail
  narrows" band was built by the Responsive pass (2026-09-28) — 120px from 1099 down to 768.

### Verification

Local `api-scratch` + `web` previews, freshly seeded scratch DB (the old `/tmp` one was gone; seeded
with the `dev` login named in `.claude/launch.json`). Driven with dispatched `.click()` per the memory
note; a real Tab for the focus ring. Checked: landing tab, rail `aria-current`, unsaved guard
(declined → stays, same-tab click doesn't ask, accepted → moves), Goals' in-screen link to Overhead,
first-run setup step → Rate Card, preload request fired and `loaded()` true, `opts` forwarding with
probe views injected for Dashboard/Capacity, focus ring on all five rail items, no page overflow at
1280 / 900 / 375px.

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
