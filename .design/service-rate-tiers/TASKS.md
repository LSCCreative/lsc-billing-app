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

- [ ] **3. Schema v9, new defaults, and the shape guard on `PUT /api/pricing`** (money math —
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

## Core UI

- [ ] **4. Rate Card rows on the new shape: unit dropdown, auto and set-by-you prices** (money
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

- [ ] **5. Service Day setting, the Show switch, and the hidden-unit notice** (money math —
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

- [ ] **6. Estimate editor: unit picker, unit switch on the line, rates keyed by unit** (money math
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

- [ ] **7. Dashboard: day floors from Service Day, one comparison row per service** (money math —
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
  every auto price reads `—`), and fold the old "— Full Day" / "— Half Day" rows into their services
  by hand. Record the deploy in the handover, in the price-calculator handover's "Deployed" style.
  _Depends on: 1–9._

## Review

- [ ] **11. Design review**: Run `/design-review` against the brief and IA, on the live site after
  task 10. Write `DESIGN_REVIEW.md` in this folder. Fix must-fixes before closing the track.
  _Depends on: 10._
