# Build Tasks: Service Rate Tiers

Generated from: `.design/service-rate-tiers/DESIGN_BRIEF.md` + `.design/service-rate-tiers/INFORMATION_ARCHITECTURE.md`
Date: 28 September 2026

Every task carries a model/effort tag from root `CLAUDE.md`'s buckets, using the same convention as
`.design/price-calculator/TASKS.md`:

- **(money math — Opus/high)**: anything touching `calc.js`, a stored price, or a screen that
  *renders* a computed price or floor. This applies "regardless of how small the diff looks".
- **(frontend — Opus/high)**: UI-build work with no money figure of its own.
- **(deploy — Sonnet/medium)**: infra steps.

**Almost all of this feature is money math.** Every screen it touches shows a price derived from
`suggestedPrice`. Don't move a task to Sonnet because its diff looks like plain UI.

## Ground rules for every task

- **Build on a branch (`service-rate-tiers`), not `main`.** Pushing `main` deploys Pages. The new
  card shape can't ship piecemeal: once the server reshapes the card, the Rate Card, the estimator
  and the Dashboard must all understand it at the same moment. Tasks 1–2 are additive (new functions
  beside the old). From task 3 onward the branch is only coherent as a whole. Merge after task 10.
- **`calc.js` is two byte-identical copies** (`server/src/calc.js`, `web/js/calc.js`). Every edit is
  two edits. The drift test in `test-calc.js` fails otherwise.
- **Gate: `cd server && npm test`** after any server change. New pure functions get worked-example
  tests in `test-calc.js`. Route changes get tests in `test-api.js` (ephemeral port, log in once in
  `test.before`).
- **For money math, check the mutation, not just the green suite**: break the line you wrote,
  confirm a test fails, put it back. Record which mutations you checked in the task's "Done" note.
- **Anything a person looks at is verified in a browser** against the scratch API (`api-scratch`
  in `.claude/launch.json`, login `dev`; re-seed if `/tmp` was wiped). Real mouse clicks in the
  browser pane don't always land, so use dispatched `.click()` and poll on a DOM condition. Measure
  at 1280 / 800 / 375.
- **Above 1100px nothing may move** except the new states. The layout adds no new columns.
- **Leave alone:** the Dashboard's post-ratio readout (`postRatioReadout`, `postMarkup`) keeps
  Capacity's `billableHoursPerDay`. That readout is a capacity-planning average, which is exactly
  what the Service Day is *not*. Travel & Accommodation rows are untouched throughout. The client
  PDF is unchanged (brief decision 9).

---

## Foundation

- [x] **1. Suggested price and unit resolution in `calc.js`** (money math — Opus/high): Add three
  pure functions, exported in both export shapes, used by nothing yet. `unitHours(pricing, unit)`
  returns 1 for `hour`, and `serviceDay.halfHours` / `fullHours` for `half` / `full`, falling back to
  4 / 8 for any missing, 0, above-24 or non-numeric value (IA "Arithmetic §1").
  `suggestedPrice(floorPerHour, hours, markupPct, settings)` is `null` when the floor is null or ≤ 0,
  or when markup is null, blank or negative. Otherwise it computes floor × hours × (1 + markup/100),
  multiplies by (1 + gst.rate) only when `registered && pricesIncludeGst`, cent-rounds, then takes
  `Math.ceil` to the dollar (IA §2). `unitDef(row, unit, pricing, ctx)` returns the **old flat row
  shape** `{ id, name, mu, auto, rate, customBill, hoursPerUnit, dayUnit }`, with `dayUnit` absent
  for `hour`, and `mu: null` when auto has no price (IA §3). Tests (worked examples): $45.05 × 1 ×
  1.25 → $57; an input landing on exactly $57.00 stays $57; markup 0 → floor rounded up; markup
  null → null; floor null → null; GST-inclusive card; the full day is computed on its own, not
  8 × the rounded hourly; `unitDef` on a set-by-you unit returns the stored number untouched (no
  rounding); `lineSnapshot(unitDef(…))` equals what a flat day row with the same price and hours
  produced before. Update calc.js's header with a "SERVICE UNITS" section in the file's
  decision-recording style (why auto is derived on read, why `null` ≠ $0, why ceil). _New. Depends
  on: nothing. Do it first: every screen reads it._

  **Done 2026-09-28** (branch `service-rate-tiers`). `unitHours`, `suggestedPrice`, `unitDef` and a
  `SERVICE_UNITS` constant (`['hour','half','full']`), exported in both shapes, used by nothing yet.
  Header gains SERVICE UNITS (decisions 1–3). **One deliberate change from the IA's recipe:** on a
  GST-inclusive card, `suggestedPrice` returns the least whole dollar whose `priceExGst` reaches the
  cent-rounded target, rather than `ceil(round(raw × 1.1))`. A sweep showed the literal recipe lands
  1¢ under the floor in ~130 half-cent edge cases at 0% markup, which task 2's "auto is never below
  floor" test would have caught. They differ by +$1 where they differ. Brief §4 and IA §2 record it.
  `unitDef` returns `null` for no row or an unknown unit; it includes `rate` and `customBill` only
  when the row has them, and `dayUnit` only for half and full. 19 new tests (234 total, all green),
  including a 100k-case sweep that auto ≥ target and is the least such dollar. **Mutations checked
  (all caught):** the brief's literal GST recipe; `round` for `ceil`; no cent-round before ceil (the
  4.48 × 10 × 1.25 = 56.00000000000001 case); negative markup allowed; null floor → $0; GST ignored;
  unpriced auto → $0; set-by-you price rounded; no 24 h cap; 0 h allowed; `dayUnit` on an hour; an
  unknown unit priced as an hour; full day = 8 × rounded hour; the search returning a dollar high.

  **Amended 2026-09-28 after task 3 (brief decision 13, the user's call):** an auto half or full
  day is now the hourly price (typed or auto) × the day's hours, to the cent. So "the full day is
  computed on its own" is reversed, and `unitDef` does it. `suggestedPrice` is called for the hour
  only, and rounds up against the **exact** floor × markup (minus 1e-8 for float noise) rather than
  the cent-rounded one. The cent-rounded target let an auto hourly sit up to half a cent under the
  true floor, and eight of those put an auto full day 1¢ under its floor: a sweep over unrounded
  floors (`cents/100 + 0.0041`, `cents/99.7`) found it. The GST-inclusive search compares
  `p ÷ (1 + rate)` to that exact target instead of `priceExGst`. **Mutations checked:** day rounded
  on its own; day ceiled to the dollar; typed day ignored; typed hour ignored for the day; no hourly
  → $0 day; cent-rounded target; no noise allowance; a noise allowance of 1¢; the GST search on
  `priceExGst`; all caught. The GST search starting $1 higher is not caught; the noise allowance
  makes it land on the same answer for every realistic floor.

- [x] **2. Per-service floor comparison and the legacy `lineDef` fallback** (money math —
  Opus/high): Add `serviceFloorComparison(pricing, settings, floorPerHour, ctx)` **beside** the
  existing `labourFloorComparison`, which stays until task 7 removes its last caller. It returns one
  entry per service, `{ sectionId, sectionLabel, rowIndex, name, units: { hour, half, full } }`.
  Each unit is `{ mu, muExGst, auto, hoursPerUnit, floor, gap, belowFloor }`, with the same rules as
  today: GST out of an inclusive price via `priceExGst`, exactly-at-floor is not below, travel
  excluded, and `mu: null` gives `belowFloor: null` (can't tell), not "below". Also teach `lineDef`'s
  no-snapshot fallback to handle a row carrying `prices`: resolve the stored price for the line's
  own unit (`line.dayUnit` or hour), or `null` if that unit is auto (IA §5). The server has no
  `ctx`, and that's deliberate. Tests: an auto unit is never below floor (sweep floor × markup
  values); a set-by-you unit priced $1 under its floor badges a $1 gap; a floor per unit equals
  `floorPerHour × unitHours` to the cent; the fallback on a `prices` row prices a pinned hour and
  returns null for an auto one. _New + modifies `lineDef`. Depends on: 1._

  **Done 2026-09-28** (branch `service-rate-tiers`). `serviceFloorComparison` sits beside
  `labourFloorComparison` (untouched, still used by the Rate Card and Dashboard), exported in both
  shapes, called by nothing yet. **Two choices worth knowing:**
  (a) it prices auto units from **its own** `floorPerHour` and `settings` and reads only
  `ctx.markupPct`, so an auto price and the floor it's compared with can never come from two
  different floors (a test passes a ctx with a different floor and GST setting and pins that they're
  ignored). Callers can still pass `priceContext()` whole.
  (b) `lineDef` gains an optional third argument, `pricing` (the whole card, for `serviceDay`).
  `computeTotals` and `labourHoursBreakdown` pass it. `web/js/rows.js`'s two `lineDef` calls don't
  yet; without it a day unit falls back to 8 / 4 hrs. That's harmless in practice (a pre-snapshot
  line never carries `dayUnit`, so it always resolves to an hour), but task 6 should pass the card
  while it's in `rows.js`. On the fallback path an auto unit returns `null` (the line prices at
  nothing, like a lost row) rather than a def with `mu: null`, so it adds no hours either.
  Header gains SERVICE UNITS decision 4 (the server never resolves an auto price). 10 new tests (244
  total, all green), including a 100k+-case sweep that no auto unit is ever below its floor across
  three GST settings and three service days. **Mutations checked (all 20 caught):** comparing `mu`
  instead of `muExGst`; `<=` at the floor; `mu: null` read as not-below; `mu: null` read as $0;
  floor ignoring hours; floor on a fixed 8 / 4 day; floor not cent-rounded; auto priced from ctx's
  floor; auto ignoring GST; a 0 floor allowed; gap not cent-rounded; gap 0 when can't tell (checked
  on both functions); travel included; `rowIndex` off by one; the fallback pricing auto as $0; the
  fallback ignoring `dayUnit`; the fallback ignoring the card's service day; the fallback returning
  the raw `prices` row; `computeTotals` and `labourHoursBreakdown` not passing the card.

- [x] **3. Schema v9, new defaults, and the shape guard on `PUT /api/pricing`** (money math —
  Opus/high): This is a data migration of stored prices, so it sits in this bucket and not the
  backend one. One `MIGRATIONS` entry in `server/src/db.js`, in this order (IA "Migration and
  deploy"):
  **(a)** snapshot every estimate line in `active_rows_json` that lacks `mu`, against the
  *pre-migration* card (by `rowId`, then name, via `lineSnapshot`);
  **(b)** only if a `pricing` row exists, add `serviceDay: { fullHours: 8, halfHours: 4 }` and turn
  each labour row into `prices: { hour, half, full }`. The slot is `dayUnit` when set; otherwise a
  row with `hoursPerUnit` 8 goes to full and 4 goes to half; everything else goes to hour. Put
  `mu` in that slot, set the others `null`, and delete `mu` / `hoursPerUnit` / `dayUnit`;
  **(c)** log every row whose old hours don't match its new slot's hours.
  Reshape `DEFAULT_PRICING` in `defaults.js`: one "Video Capture" service with $140 / $640 /
  $1,120 set by you (the Full / Half Day rows are gone). Every other default labour row keeps its
  price as hourly set-by-you, with half and full day `null`. Rewrite the file's DAY ROWS header to
  match. `routes/pricing.js` validation: `serviceDay` is required (each 0.5–24 in 0.5 steps, half ≤
  full); every labour row has `prices` with all three keys, each ≥ 0 or `null`. A labour row
  carrying `mu`, `hoursPerUnit` or `dayUnit`, or lacking `prices`, gets **400
  `pricing_shape_outdated`**. Fix the existing tests that build cards from the old default shape
  (`test-calc.js`, `test-api.js`, `test-section-labels.js`, `test-ratecard.js`, `test-pdf.js`). Keep
  their intent; don't delete coverage. New tests: **every estimate's recomputed totals are identical
  before and after v9** (seed estimates with legacy and snapshotted lines, including a day row and a
  line whose service has left the card); migration on a fresh DB is a no-op; running `migrate` twice
  changes nothing; the log line appears for a 6-hour day row; the PUT refusals; a full new-shape
  round-trip. _Modifies: `db.js`, `defaults.js`, `routes/pricing.js`, tests. Depends on: 1, 2._

  **Done 2026-09-28** (branch `service-rate-tiers`). The migration's steps live in
  `server/src/migrations/v9-service-units.js` (`snapshotLegacyLines`, `reshapeCard`, `migrateV9`),
  so each can be tested; `db.js`'s v9 entry just calls `migrateV9`. **Decisions made while building:**
  (a) **A database that never saved a card** priced its estimates from the old `DEFAULT_PRICING`,
  which `defaults.js` no longer holds. So the module carries a frozen `V8_DEFAULT_PRICING` to
  snapshot against, and no card is written (it reads the new defaults from then on).
  (b) **A row with no `mu`** (it priced at $0) gets `null` in its slot, which is auto. It's logged.
  A negative `mu` becomes 0, also logged.
  (c) **Neither step touches `updated_at`**, on estimates or on the card. The card's `updatedAt` is
  what `data.js` reads as "ever saved".
  (d) **The guard:** a missing `serviceDay` is also `pricing_shape_outdated`, since no old build sends
  one, and the shape check runs before every other check, so an old build always gets that code.
  The other new codes are `service_day_out_of_range`, `service_day_half_over_full`,
  `labour_prices_incomplete`, `labour_price_not_a_number` (a string `"140"` is refused, not
  coerced) and `labour_price_negative`. `pricingProblem` is now exported, and a test checks that the
  migrated card passes it.
  (e) Log lines read `[db] v9: Production › Drone Day: was 6 hrs a unit, now a full day of 8 hrs.
  Price kept ($900).`, plus one `[db] v9: snapshotted N line(s) on M estimate(s)` summary.
  (f) A snapshot carries a labour row's `rate` too. That's `lineSnapshot`'s existing behaviour,
  unchanged.
  **Tests:** 252 total, all green. New in `test-db.js`: recomputed totals identical before and after
  v9 (legacy lines by id and by name, day rows, a 6-hour day, an unpriced row, custom bill with an
  override, all three kinds of travel, crew and equipment, already-snapshotted lines, a service gone
  from the card, a deleted category, GST-inclusive, a GST-free estimate); slot placement; the log
  lines; the no-card database; fresh-DB no-op; running v9 twice over its own output. New in
  `test-api.js`: the outdated-shape refusals (and nothing written), the service-day and price
  checks, a full new-shape round-trip that the server prices from. Old-shape fixtures in
  `test-api.js`, `test-pdf.js` and `test-section-labels.js` are converted, and their card saves now
  assert 200. Several used to get a silent 400 under the new guard and would have kept passing
  against a stale card. The three pricing-refusal API tests reset to the defaults first rather than
  inheriting an earlier test's empty card. **Mutations checked (all caught but one, which is
  equivalent):** reshaping before snapshotting; the no-card case snapshotting against the new
  defaults; `dayUnit` ignored; an 8-hour row left hourly; `mu` kept on the row; a negative kept; no
  price read as $0; travel not snapshotted; lookup across every category instead of the line's own;
  an existing snapshot overwritten; `updated_at` touched; no hours-change log; no `serviceDay`;
  reshape not idempotent; the shape check after the tax check; `mu`, `dayUnit` or a missing
  `serviceDay` tolerated; any fraction of an hour; no 24 h cap; half over full; a string price; a
  missing key; a negative price. The equivalent one: reshaping when no card was saved, which
  changes nothing because the `UPDATE … WHERE id = 1` has no row to hit.

## Core UI

- [x] **4. Rate Card rows on the new shape: unit dropdown, auto and set-by-you prices** (money
  math — Opus/high): This is the first visible slice, and it sets the look. The aesthetic is the
  existing dark editorial system, extended rather than restyled (brief "Aesthetic Direction"), so the
  new states are siblings of today's `floor $X` line. Add `LSCData.priceContext()` to `data.js` (`{
  floorPerHour: incomeFloor(), markupPct: goals().targetProfitMarginPct, settings }`); the estimator
  and Dashboard reuse it. In `pricing.js`, the `per [unit ▾]` select becomes a **view switch**: it
  lives in per-row view state, not in the card, so it never dirties the unsaved check and resets to
  Hourly on mount. The day-hours input and `dayHours()` Capacity prefill go; a day unit shows
  `· 8 billable hrs` as text. The Rate cell shows overhead × `unitHours` with its unit suffix. The
  price field shows `unitDef(...).mu`, or `—` when null. The state line (extending `.pricing-floor`)
  reads `auto · floor $X`, `set by you · ↺ use $X` (a real `<button>`), `below floor by $X`, or `— ·
  needs Profit Goals` (link → `selectTab('goals')`). Typing a number pins that unit (`prices[unit] =
  n`). `↺` or an emptied field sets it back to `null`. `0` pins 0. `floorLineHtml` moves from
  `labourFloorComparison` to `serviceFloorComparison` on a one-row card, so the Dashboard stays its
  last caller for task 7 to remove. `payload()` emits the new shape and
  never writes an auto figure. Retire the "switching hourly ↔ day asks first" guard (brief §6).
  `focusRow` accepts `unit`, sets the dropdown, then focuses the price. Rewrite the header's DAY ROWS
  / EACH ROW'S FLOOR sections to describe what's actually there. Verify in a browser: a new service
  shows three auto prices matching a hand calculation; pinning one survives save + reload; `↺`
  returns it to auto; a floor-unset scratch DB shows `—` / "needs Profit Goals"; and a 400
  `pricing_shape_outdated` surfaces as a readable error. _Modifies: `pricing.js`, `pricing.css`,
  `data.js`. Reuses: `.pricing-floor`, `.pricing-unit-sel`, `LSCUtil.fmt`. Depends on: 1, 2, 3._

  **Done 2026-09-28** (branch `service-rate-tiers`). Built as specified, plus brief decision 13 (an
  auto day follows the hourly). **Choices made while building:** the unit view state is keyed by
  row id (`viewUnits`), not index, so it survives adding and deleting rows. The auto price is shown
  *in* the field, muted (`.pricing-auto`); focusing an auto field selects it so typing replaces the
  suggestion, and leaving an emptied field shows the auto figure again. The state line wraps
  between its parts (`.pricing-state-part` is `nowrap`), so a set-by-you row below the floor reads
  on two or three lines at 1280. That's the one visible change above 1100px, and it's worth a look
  in task 8 or the review. The Rate cell stays bare for an hour, matching the "Rate ($/hr)" head,
  and reads `120.96/day` / `60.48/half day` for a day (112px wide only while a day is shown). With no
  auto figure available, `↺` reads "use auto". The state line's buttons are delegated on the root,
  because the line is rewritten as you type. Save refusals map the route's codes to sentences
  (`SAVE_REFUSALS`). **Verified in a browser** against a v9 copy of the scratch DB on its own ports
  (`127.0.0.1:8081` / `:5174`, because another session held 8080 / 5173 with the v8 server). The
  migration there snapshotted 3 legacy lines, and all 5 scratch estimates recomputed identically.
  Checks: a new service reads $103 / $412 / $824 (floor $82.16 × 1.25, rounded up; × 4; × 8),
  with Rate 15.12 / 60.48 / 120.96 and floors $82.16 / $328.64 / $657.28. Typing $120 hourly moved
  the auto half day to $480. A pinned $900 full day survived save + reload, stored as `{ hour: 120,
  half: null, full: 900 }`, with no `mu` on any row. `↺ use $960` returned it to auto, refocused the
  price and announced it. Unit switches alone never triggered the unsaved-changes prompt, and the
  dropdown was back on Hourly on remount. With no income floor, auto prices showed `—` and "auto ·
  needs Profit Goals", which links to Profit Goals. A forced `pricing_shape_outdated` showed "Couldn't
  save: this page is out of date … Reload the page". No script errors. **Not yet:** the Dashboard and
  the estimator still read the old shape (tasks 6–7), so both are wrong on this branch until then.

- [x] **5. Service Day setting, the Show switch, and the hidden-unit notice** (money math —
  Opus/high): Add the Service Day pair to the Rate Card's settings strip: `Full [8] hrs · Half [4]
  hrs`, with an `LSCInfo.markup` info control whose text separates it from Capacity's day. Place it
  after Tax Set-Aside. It's stored as `card.serviceDay`, in the working copy, validated like the
  server (0.5–24, half ≤ full; a bad value blocks save with an inline reason). Editing it
  re-resolves every **auto** day price on screen as you type, through `priceContext` plus the
  working copy's `serviceDay`, and updates every set-by-you unit's `↺ use $X` and floor line.
  Stored prices never change. Add `Show: Hourly | Half day | Full day` (`.btn-ghost.btn-sm`
  buttons, `aria-pressed`) above the first category. It sets every row's dropdown; any per-row
  change afterwards un-presses all three. Add the hidden-unit notice under a service name when a
  unit *not* currently shown is below floor or has no price ("Full day below floor by $12.40 ▸").
  It's a button that switches that row's dropdown. The select's option text carries the same fact.
  Verify: changing Full 8 → 10 moves auto full-day prices by exactly 10/8 before rounding and leaves
  pinned ones alone; Show → Full day flips all rows; a pinned half day below floor is flagged while
  the row shows Hourly. _Modifies: `pricing.js`, `pricing.css`. Reuses: `LSCInfo`, `.tax-setting`
  layout. Depends on: 4._

  **Done 2026-09-28** (branch `service-rate-tiers`). **Choices made while building:** the Service
  Day is a *second* `.tax-setting` block under Tax Set-Aside rather than a field squeezed into the
  same one, so each keeps its own copy line. Editing it refreshes every row **in place**
  (`refreshAllRows`) rather than re-rendering, so the field keeps the cursor. One announcement per
  edit goes to the existing polite region. A Show button's pressed state is **derived**: pressed
  while every row shows its unit, which is the IA's rule. New rows start on the last Show.
  **The hidden-unit notice appears only when the unit on show is fine** (as the brief's component
  table says). Otherwise a card with no Profit Goals would flag every row under its own `— · needs
  Profit Goals` too. Option text flags only the *other* units, and the select is a fixed `7.6em`:
  Chrome sizes a closed select to its longest option, which pushed "per [unit]" onto two lines in
  the narrow Pre-Production column. The unit select's `change` is now delegated on the root, because
  `refreshRow` rewrites the unit line. **Verified in a browser** (the same v9 scratch copy):
  Show → Full day flipped every row and pressed that button, and a per-row change un-pressed all
  three. Full 8 → 10 moved every auto full day by exactly 10/8 (1600 → 2000, 896 → 1120) and left
  pinned ones (1120, 900) alone, while their `↺ use` moved (824 → 1030, 960 → 1200). Day rates
  went 120.96 → 151.20 and floors $657.28 → $821.60, focus stayed in the field, and it announced
  "Auto prices updated for 10-hour full day." A pinned $100 half day read "below floor by $228.64";
  with the row on Hourly it showed "Half day below floor by $228.64 ▸" and the option "half day ·
  below floor", and clicking the notice switched the row with the price focused. A blank full day,
  7.3 hrs, and half 12 > full 10 each blocked the save with its sentence on the right field. 10 / 5
  saved and read back from the API. The info control opens. No script errors, no overflow at 1280.

- [x] **6. Estimate editor: unit picker, unit switch on the line, rates keyed by unit** (money math
  — Opus/high): In each labour `.bb-picker`, add a unit `<select>` between the service select and
  `+ Add Service`. It repopulates on service change, **always starting on Hour** (decision 11), with
  options like "Hour · $140" / "Half day · $640" / "Full day · no price yet" (the last disabled).
  Add snapshots `lineSnapshot(unitDef(row, unit, card, priceContext()))`. The line's `.lab-unit`
  becomes a select (`per [full day ▾] · 8 billable hrs`). Switching it re-snapshots that line from
  the card at the new unit, keeps qty and recalculates. It uses the last-project price instead when
  "Use rates from last project" is on and that client has one for the row id + unit. A disabled
  (no-price) unit can't be chosen, and the line stays put. `rateKey` / `lastRateFor` match by row
  id + unit, then name + unit, where unit = `dayUnit` or hour. "Update to current rates" re-prices
  each line **at its own unit**; a line whose unit is now auto-without-price keeps its snapshot, and
  the result message says how many. The Qty header is always "Qty" in a category with services.
  Retire `LSCRows.sectionHasUnits` (also used by `estimate-detail.js:92`, so it's always true there
  now). The same service can be added at two units. Announce a unit switch's new price in the
  editor's existing live region. Verify in a browser: add Video Capture full day → Total Hours +8,
  bill $1,120; switch to half day → $640 / +4 hrs; save, reload, and the line keeps its unit and
  price; change the card's price, and the saved line doesn't move until "Update to current rates";
  Minimum Job Price hours follow the unit. _Modifies: `estimate-editor.js`, `rows.js`,
  `estimate-detail.js`, `estimates.css`. Reuses: `.svc-select` styling, `lineSnapshot`, the rates
  bar. Depends on: 4._

  **Done 2026-09-28** (branch `service-rate-tiers`). `rows.js`'s `labourDef` takes the card as a
  third argument and passes it to `lineDef` (task 2's note); `sectionHasUnits` is gone, and both
  estimate screens head every labour category "Qty" and spell each line's unit. **Choices made while
  building:**
  (a) **The line's current option is just the unit's name** ("per [half day ▾] · 4 billable hrs");
  the *other* options carry what switching would price the line at, or "no price yet" (disabled).
  The line's own price is already in the Mark-Up column beside it, and a price in the closed select
  would read twice. The select is a fixed `7.6em`, as on the Rate Card.
  (b) **One function decides what a unit would cost** (`unitSnap`): the client's last-project
  price for that service at that unit while the toggle is on and one exists, otherwise today's card
  (`cardSnap` → `unitDef` with `priceContext()` resolved at mount). The picker's options, a line's
  options, Add and a switch all read it, so an option's price is always what you get.
  (c) **A line priced from the last project remembers today's card price as its own** — for a
  switched line that's the price *at the new unit*, and now also for a line added while the toggle is
  on (before, such a line kept last time's price when the toggle went off). Turning the toggle off
  therefore never reverts a unit switch.
  (d) **The picker starts on Hour** when a service is chosen (decision 11), unless the hour has no
  price, when it starts on the first unit that has one. No priceable unit: every option disabled
  and `+ Add Service` disabled. It keeps the last unit after an Add (only a *service* change resets
  it).
  (e) The unit select appears only while the line's service is still on the card; a line in an
  archived category or whose service was deleted shows plain text ("per full day · 8 billable hrs").
  A legacy line in no unit the card sells (hours ≠ 1, no `dayUnit`) shows a selected "unit" option
  and can be switched *to* hour / half / full, never back. Its rate key is `unit` + its hours, so it
  matches nothing.
  (f) **The editor had no live region**, despite the brief's wording, so it gains one
  (`#editor-live`, sr-only, polite, via `LSCUtil.announce`): "Video Capture: now per half day,
  $800, 4 billable hrs." (plus ", as on the last project." when it came from there). "Update to
  current rates" also resets the rates note, which it used to leave saying "N lines priced as last
  time".
  **Verified in a browser** (the v9 scratch copy on `127.0.0.1:8081` / `:5174`; Video Capture was
  $200 hourly typed, days auto): the picker read Hour · $200 / Half day · $800 / Full day · $1,600
  and started on Hour. Added a full day: Total Hours 8, bill $1,600, MJP note "(1 full day of 8
  hrs)". Switched it to half day: $800, 4 hrs, qty kept, focus stayed on the select, announced.
  Added the same service by the hour (qty 2): 6 hrs, $1,200; saved; the detail view read "1 half
  day" / "2 hours" and the server's totals agreed. Raised the card's hourly to $250: the reopened
  quote still read $800 / $200 until "Update to current rates", which moved them to $1,000 / $250
  (each at its own unit). With the income floor stubbed out: a service whose hour is auto listed
  Hour and Half day as "no price yet" (disabled) and started on Full day; a line at an auto hour
  kept its $103 on update, and the toast said "1 line at a unit with no price on it yet kept its
  price". An all-auto service disabled every unit and Add. Last project (card hourly then $300,
  last quote $250 hourly / $1,000 half day): with the toggle on, Hour added at $250 and Full day at
  the card's $2,400 (not on the last quote); switching the hour line to half day took $1,000 "as on
  the last project"; toggling off gave $1,200, still at half day. A deleted service and an archived
  category showed plain unit text. No script errors; no overflow at 1280 or 375. The test estimate
  was deleted and the card put back to $200 afterwards.
  **Not mutation-checked:** this task changed no `calc.js` and no server code, and the editor has no
  automated tests (`npm test` doesn't load the web views); every branch above was exercised in the
  browser instead. 253 server tests still green. **Left for task 8/9:** the line's unit select is
  28px tall at 375 (under the 44px target), and a11y wording is task 9's.

- [x] **7. Dashboard: day floors from Service Day, one comparison row per service** (money math —
  Opus/high): In `finance-dashboard.js` `figures()`, headline `halfDay` / `fullDay` become
  `perHour × unitHours(pricing, 'half' | 'full')`. The tiles' "at N hrs" reads Service Day, and
  `dayHours` from Capacity is no longer used there (brief decision 4). **`postMarkup` /
  `postRatioReadout` keep Capacity's day, untouched.** The "Rate card against its floors" table
  moves to `serviceFloorComparison`: one row per service, columns Service | Hourly | Half day | Full
  day. Each cell shows its price, plus either a `Below by $X` badge button or an `auto` tag, and `—`
  for no price. Categories are grouped as today, and the `.est-table` stacks below 768. A badge
  sends `focusRow: { sectionId, index, unit }`. Update `finance.js`'s router note for the new key.
  Then **delete `labourFloorComparison`** from both calc.js copies along with its tests, once `grep`
  shows no caller. Rewrite the file header's "decision 1" note, which this reverses. Verify: the
  headline full day = hourly floor × 8 to the cent; a pinned below-floor full day badges and its
  button lands on that row, set to Full day, with the price focused; an all-auto service shows three
  `auto` tags. _Modifies: `finance-dashboard.js`, `finance-dashboard.css`, `finance.js`, both
  `calc.js`. Depends on: 2, 4._

  **Done 2026-09-28** (branch `service-rate-tiers`). Headline half / full floors are `perHour ×
  unitHours(card, 'half' | 'full')`; each tile reads "at N hrs" from the Service Day, and the old
  "set your full-day hours on Capacity" prompt is gone (`unitHours` is never null). The comparison
  is `serviceFloorComparison(card, settings, perHour, priceContext())`: Service | Section | Hourly |
  Half day | Full day, each cell the unit's price **ex-GST** over a `Below by $X` badge or an `auto`
  tag, `—` for no price. Section stays as its own column (that's how "grouped as today" was done),
  still hidden at 768–1099. A service counts as below floor (row class, the "N of M below floor"
  count, the phone view's opening rows) if **any** of its units is. Badges carry
  `data-focus-unit`, and the router passes `focusRow: { sectionId, index, unit }`; `index` is now
  the comparison's own `rowIndex` rather than a counter in the view. `labourFloorComparison` is
  deleted from both calc.js copies with its three tests (253 → 250 tests); the only check they had
  that `serviceFloorComparison`'s tests lacked ("the internal `rate` plays no part") moved onto its
  $1-gap test. The dashboard header's old "headline day floors use Capacity's day" note is
  rewritten, and two stale calc.js comments are fixed (`hoursPerUnitOf`, `postRatioReadout`).
  **One thing found while verifying:** an **auto** day *can* be below floor when the service's
  hourly price is typed below it (decision 13 carries it over; e.g. $56/hr typed → a $224 auto half
  day against a $328.64 floor). Such a cell shows the badge, not the tag. The info control and the
  header say so. My first draft of both said auto prices can't be below; that's only true of an
  auto *hourly*.
  **Verified in a browser** (the v9 scratch copy): at an $82.16 floor the tiles read $82.16 /
  $328.64 at 4 hrs / $657.28 at 8 hrs. With the Service Day set to 10 / 5 in memory (Capacity's day
  stayed 8), they read $410.80 at 5 hrs / $821.60 at 10 hrs, while the post-ratio readout still said
  "8 hrs, your Capacity day". A service made all-auto in memory showed three `auto` tags. Test Tier
  Service's typed $100 half day badged "Below by $228.64". Its button opened the Rate Card on that
  row, dropdown on Half day, with the $100 price field focused (accessible name "Half-day price for
  Test Tier Service"). 1280: fits; 800: Section hidden, no price wraps; 375: cards stacked, opens on
  the 7 below-floor services, price over badge on each line, no page overflow. No script errors.
  **Checks instead of mutations:** the task changes no pricing arithmetic; `calc.js` only loses a
  function. What could go wrong in the view is reading the wrong day or row, and the checks above
  used inputs that tell those apart (Service Day ≠ Capacity's day; the badge landing on the right
  row *and* unit).

## Responsive & Polish

- [ ] **8. Responsive pass** (frontend — Opus/high): At < 768px: the Rate Card row's unit select,
  the `· N billable hrs` text and the hidden-unit notice sit under the service name; the state line
  stays under the price; the settings strip wraps (Tax, Service Day, Show each on their own line,
  Show buttons full-width in three equal parts). The estimator's `.bb-picker` stacks Service / Unit
  / Add at full width (every field keeps `responsive.css`'s 16px rule; any flex item holding a
  select needs `min-width: 0`, as `.svc-select` did). The line's unit select fits in the stacked
  row. The Dashboard table's three price cells stack under the service with their `data-label`s.
  Selects, `↺` and badges stay ≥ 44px targets. Check 1280 / 1100 / 1000 / 800 / 768 / 375 / 320: no
  page overflow; truncated service names at 1280 unchanged from today (3). Save screenshots via the
  server's `puppeteer-core` + local Chrome. Breakpoints: 1100, 768. _Modifies: `responsive.css`,
  `pricing.css`, `estimates.css`, `finance-dashboard.css`. Depends on: 5, 6, 7._

- [ ] **9. Accessibility pass** (frontend — Opus/high): Per the brief's "Accessibility
  Requirements":
  - The Rate Card unit select is named "Unit shown for {service}", and its options carry problem
    text.
  - The price field's accessible name includes the unit ("Full-day price for Video Capture"), and
    `aria-describedby` points at its state line. Both update when the unit changes.
  - `↺ use $X` is labelled "Use the suggested price, $X, for {service} {unit}", and focus returns
    to the price field afterwards.
  - Service Day edits announce once through a single polite live region ("Auto prices updated for
    8-hour full day"), not per row.
  - The Show buttons have `aria-pressed`.
  - Estimator: the unit select is labelled "Unit to add for {category}", a disabled option says
    why, and a line unit switch is announced.
  - State lines in `--muted` meet 4.5:1 at their size (use `a11y.css`'s adjustments).
  - Everything works keyboard-only, with no `title`-only information (repo rule: button +
    popover).

  Verify with the accessibility tree (`read_page`) and a keyboard-only walk-through of all three
  flows in the IA. A real VoiceOver pass is for a person (as in price-calculator); list what to
  listen for in the handover. _Modifies: `pricing.js`, `estimate-editor.js`, `finance-dashboard.js`,
  `a11y.css`. Depends on: 5, 6, 7._

## Ship

- [ ] **10. Deploy: NAS (v9) first, then Pages** (deploy — Sonnet/medium; **ask the user before
  starting**): Merge `service-rate-tiers` → `main` locally, but **don't push yet**.
  1. On the NAS, back up the live DB with `sqlite3 ".backup"` to
     `/volume4/lsc-billing/data/backups/pre-v9-<stamp>.db`, and check integrity.
  2. Copy `server/` over with the usual `COPYFILE_DISABLE=1 tar`, excluding `node_modules`,
     `./data`, `.env` and `docker-compose.yml`. Run `docker compose up -d --build`.
  3. Confirm `healthy` and a `migrated to v9` boot log. Copy **every migration log line** (rows
     whose day hours changed) into the handover.
  4. Check the live DB: integrity ok, v9, goals and overhead untouched, card has `serviceDay`, and
     no labour row has `mu`.
  5. **Then** push `main` (Pages) and confirm the Pages run succeeded, the live `calc.js` carries
     `suggestedPrice`, and the site boots with no script errors.

  The order is load-bearing: an old Pages build against a v9 server can only fail safely
  (`pricing_shape_outdated`); a new Pages build against a v8 server cannot. Afterwards, tell the
  user the two things only they can do: save the FY 2026–27 tax scale on Profit Goals (until then
  every auto hourly price, and every auto day on one, reads `—`), and fold the old "— Full Day" / "— Half Day" rows into their services
  by hand. Record the deploy in the handover, in the price-calculator handover's "Deployed" style.
  _Depends on: 1–9._

## Review

- [ ] **11. Design review**: Run `/design-review` against the brief and IA, on the live site after
  task 10. Write `DESIGN_REVIEW.md` in this folder. Fix must-fixes before closing the track.
  _Depends on: 10._
