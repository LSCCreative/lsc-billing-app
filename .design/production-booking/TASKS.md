# Build Tasks: Production Booking

Generated from: [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md), [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md)
and [`DECISIONS.md`](DECISIONS.md) (D1–D99, all the user's; don't re-ask; D67–D72 came from the 2026-10-02 money review, D73–D99 are Stage B2).
Date: 2 October 2026

Stages are built in order, **A+B → B2 → C → D → E** (D1, D73), and each one ships and is usable on its own.
Every task carries a model/effort tag from root `CLAUDE.md`'s buckets:

- **(money math — Opus/high)**: `calc.js`, a stored or printed price, invoice amounts, or anything
  that renders a computed price. Applies "regardless of how small the diff looks".
- **(auth/security — Opus/high)**: public routes, tokens, signing, the Stripe webhook, secrets.
- **(frontend — Opus/high)**: UI build with no money figure of its own.
- **(backend — Sonnet/high)**: routes, tests and infrastructure that move no price.
- **(deploy — Sonnet/medium)**: infra steps.

State the bucket out loud and pause for the user to switch before starting a task.

## Ground rules for every task

- **Prerequisite: estimate-accuracy lands first.** That branch holds uncommitted work through
  migration v10 and `PRICING_SHAPE` `'travel-km'`. This track starts at **v11**, so branch
  `production-booking` from `estimate-accuracy` once that work is committed. Deploy v10 before v11.
  Pushing `main` deploys Pages.
- **`calc.js` is two byte-identical copies** (`server/src/calc.js`, `web/js/calc.js`). The drift test
  fails otherwise.
- **The gate is `cd server && npm test`.** New pure functions get worked-example tests in
  `test-calc.js`, routes get tests in `test-api.js`, and migrations get tests in `test-db.js`.
- **Money math: check the mutation, not just the green suite.** Break the line, confirm a test
  fails, put it back, and list the mutations in the task's Done note.
- **Saved estimates never move.** Every new line or estimate field is optional, null-safe on read,
  and absent from rows already saved. An absent field must total identically to before; pin that
  with a test.
- **A new field must reach every place it belongs:** `computeTotals`, the editor's row builder and
  `collect()`, the estimate detail, the PDF and, from stage E, the public serializer. Missing one of
  those is the bug class this repo keeps catching.
- **Nothing owner-only on a public route.** From task 24 on, a test asserts that no `/public/*`
  payload contains `surcharge`, `floor`, `taxSetAside`, `overheadShare`, `estTakeHome` or
  `costBreakdown`.
- **Schema changes are additive and null-safe. NAS before Pages** for every migration or new route
  the web reads.
- **The Desktop Preservation Law applies**: above 1100px, existing screens stay pixel-identical except
  for the new blocks and states.
- **Verify anything a person looks at in the browser**, against `api-scratch` (login `dev`; re-seed if
  `/tmp` was wiped; restart it after server edits; cache-bust the web JS). Real clicks don't always
  land in the pane, so use dispatched `.click()` and poll on a DOM condition. Measure at 1280, 800
  and 375.
- **Each finished task gets a Done note in this file**, and `HANDOVER.md` is updated.

---

## Stage A + B — Surcharges and Production Booking (migration v11; ship together)

- [x] **1. The surcharge maths** (money math — Opus/high): pure functions in both `calc.js` copies.
  This is the riskiest arithmetic, so it goes first and has no UI.
  - `dayKind(date, settings, holidays)` → `weekday` | `weekend` | `holiday`. The working weekdays
    come from settings; a holiday is any date on the list that isn't `hidden`.
  - `afterHoursShare(start, end, officeStart, officeEnd)` → 0–1. An end before the start means
    overnight, and every hour past midnight counts as outside office hours (D21). With no times
    it returns 0.
  - `surchargeFactor(day, card, shortNotice)`, per the brief's three-mode table (D2, D5, D11). A
    Date TBC day has w = 1 and s = 0, but short notice still applies (D9).
  - `surchargedLinePrice(base, factor)` = `ceil(base × factor)` to the whole dollar (D20).
  - `surchargeAttribution(...)` gives the per-surcharge $ amounts for the Cost Breakdown, adding
    up to the cent to the rounded difference, with the rounding on the last row.

  **Done when** the brief's worked examples are pinned exactly: Saturday $1,680; weekday 9–7
  $1,176; short-notice Saturday 1–9pm at $3,360 / $3,780 / $2,240 across the three modes. Also
  pinned: overnight Fri 8pm → 2am; a holiday on a weekday; a `hidden` holiday reads as a weekday;
  ×1 everywhere gives the base price; attribution sums exactly over a price sweep. Mutations
  checked: mode swap, ceil → round, share inverted, overnight ignored, short notice skipped on a
  TBC day. _New functions only; `computeTotals` is untouched in this task._

  **Done 2026-10-02** on branch `production-booking`, committed `86edf25`. Seven exports in both
  copies: `SURCHARGE_DEFAULTS`, `surchargeSettings(card)`, `dayKind`, `afterHoursShare`,
  `surchargeFactor(day, card, shortNotice, holidays?)`, `surchargedLinePrice`,
  `surchargeAttribution(base, day, card, shortNotice, holidays?)`. There are 18 new tests in
  `test-calc.js`; the suite is 308/308.
  - **Every worked example is pinned**, plus: overnight Fri 8pm–2am at $1,400 (Friday's rate); a
    weekday holiday; a hidden holiday; ×1 everywhere; TBC with short notice; and a 1,680-case
    attribution sweep that is exact to the cent.
  - **Mutations, each caught with both copies mutated** (so the drift test can't be what catches
    it): mode swap ×2, ceil → round, share inverted, overnight ignored, short notice skipped on
    TBC, hidden holiday not skipped, rounding on the first row, no float-noise guard, factor 1
    still ceiled.

  **Shapes later tasks must use** (chosen here, not in the brief):
  - **`card.surcharges`:** `{ shortNotice, shortNoticeHintDays, weekend, afterHours, officeStart,
    officeEnd, workingWeekdays, mode }`.
    - Weekdays use `getUTCDay` numbers (0 = Sunday).
    - Modes are `'higher'` (default), `'multiply'` and `'highest'`.
    - A missing or unusable field reads as its default, and a multiplier below 1 reads as 1.
    - Task 4's `defaults.js` should use `SURCHARGE_DEFAULTS`, not a second copy.
  - **A day** is `{ date, startTime, endTime }` (snake_case is accepted), plus an optional `kind`.
    - When `kind` is present it wins over the holiday list. That's the snapshot hook for task 2.
    - The holiday list is a 4th argument. A date of `null` is TBC.
  - **Factor ≤ 1** returns the base to the cent, not rounded up, so a line nothing applies to
    prices exactly as before.
  - **Booked start = end** is a share of 0.
  - **Past midnight is all after hours**, even after the next day's office start (D21, as worded).
  - **Attribution** charges along a chain:
    - in "higher" mode, each part of the day goes to the winner of weekend vs after hours, with
      short notice on top of the surcharged day;
    - in "multiply" mode, the order is weekend → after hours (on the weekend price) → short
      notice;
    - in "highest" mode, the single winner per part takes it all.
    - Ties name the earlier of weekend, after hours, short notice; the $ are the same either way.
    - Each row carries `share`, the fraction of booked hours it covered. Task 8 can turn that into
      hours.

- [x] **2. Schema v11, days and holidays on the server** (money math — Opus/high, since the server
  re-prices). _Depends on: 1._
  - **Migration v11:**
    - `production_days` (IA Data Model): `id`, `estimate_id`, `date` NULL, `status`,
      `start_time`, `end_time`, `override_note`, `sort`, timestamps, with indexes on `date` and
      `estimate_id`;
    - `holidays`: `date` PK, `name`, `source`, `hidden`;
    - on `estimates`: `short_notice` (0/1) and `surcharges_json`.
  - **`computeTotals`** prices `prod` lines that carry a `dayId` through task 1. A line with no
    `dayId` prices exactly as today. It adds `totals.surchargeTotal`.
  - **The estimate write routes** accept a `days` array, replace that estimate's days in one
    transaction, re-price on the server and snapshot `surcharges_json`. They enforce the clash
    rules: a date confirmed by another non-declined estimate is refused (`date_locked`) unless the
    day carries an `override_note` (D16); pencilled and proposed are never refused (D15).
  - **`GET /api/calendar?from=&to=`** returns each day with UPID, project name, client, status,
    times and production item names. Declined estimates are excluded once task 15 adds the
    status; until then, all estimates are included.
  - **`PRICING_SHAPE` bump**, plus a card marker an old build won't send, so `cardShapeOutdated`
    and the estimate routes refuse old builds. The v9/6a pattern in full.

  **Done when:**
  - an estimate saved before v11 totals identically and reads `days: []`;
  - the worked examples price the same on the server as in task 1;
  - lock and override are tested from a second "tab" (a raw API call);
  - the calendar range query returns only overlapping days;
  - migration tests rewind and re-run cleanly.

  _Modifies: `db.js`, `calc.js` (×2), `routes/estimates.js`, `ratecard.js`; new
  `routes/calendar.js`._

  **Done 2026-10-02** on `production-booking` (committed `a571c67`). The suite is 327/327. New files are
  `days.js` and `routes/calendar.js`; `estimate.js`, `routes/pricing.js` and `app.js` also changed.
  `ratecard.js` needed nothing.
  - **Migration v11** is as specified and safe to re-run. `production_days.estimate_id` cascades on
    delete (D22). **Trap for task 15:** rebuilding `estimates` with `DROP TABLE` while foreign keys
    are on would delete every day. The migration's comment says so too.
  - **`calc.js`:**
    - `computeTotals` options gain `days`, `surcharges` and `shortNotice`. Only a `prod` line
      whose `dayId` is one of `days` is surcharged; anything else prices as before.
    - `totals.surchargeTotal` is always present (0 when nothing applies). The one whole-totals
      test gained that key, and nothing else in it changed.
    - `surchargeSnapshot(days, card, holidays, prior)` sets what an estimate pins.
    - `stampSurchargedPrices` writes `surchargedPrice` onto each `prod` line that is on a day,
      and strips it from every other line.
  - **`PRICING_SHAPE`** is now `'production-days'`. A `'travel-km'` build's estimate writes and
    card saves are both refused.
  - **Estimate writes:**
    - `days` replaces the estimate's days whole. A PUT **without** `days` or `shortNotice` keeps
      them, because losing booked days is the expensive direction.
    - **The snapshot is pinned on save.** It keeps the prior settings and each unmoved day's kind.
      `refreshSurcharges: true` re-reads the live card and holidays. An estimate with no days stores
      `'{}'`, so its first day takes today's settings.
    - **Refusals:**
      - 400: `days_not_a_list`, `day_id_invalid`, `day_id_duplicate`, `day_date_invalid`,
        `day_status_invalid`, `day_time_invalid`, `day_note_too_long`, `too_many_days`,
        `line_day_unknown`, `day_on_non_production_line`, `day_id_taken`.
      - 409: `date_locked`, carrying `{ date, upid, estimateId, message }`.
    - **When the lock is checked:** only for a day that is new, has moved date, or has just become
      confirmed. An unchanged day can always be re-saved, so an estimate that pencilled a date first
      is never stuck once another confirms it.
  - **Duplicate** gets no days and no short notice. Its lines come off their days, and it is
    re-totalled at base price when anything was stripped (this is D60 early).
  - **`GET /api/calendar?from&to`** is inclusive at both ends and capped at 400 days, and it skips
    TBC days. Each day carries `{ id, estimateId, date, status, startTime, endTime, overrideNote,
    upid, projectName, client, items }`.
  - **Beyond the spec:** `PUT /api/pricing` checks `surcharges` when present (multipliers 1–10,
    office hours, weekdays, mode and hint days). Task 4's screen should mirror those codes.
  - **Decided here; flag to the user at task 7:** a custom-bill (override) production line on a
    surcharged day is surcharged on its custom amount.
  - **Mutations:** 18 checked across the whole suite, and all caught:
    - **calc.js:** any section surcharged; base not surcharged; surcharge adds hours; prior settings
      ignored; a moved day's kind kept; short notice ignored; stale stamp kept.
    - **days.js:** override note ignored; unchanged days re-checked; promotion to confirmed not
      checked; pencilled locks; unknown line day allowed.
    - **Routes:** PUT without days wipes them; refresh ignored; lines not stamped; duplicate copies
      totals; calendar end exclusive; multiplier < 1 accepted.
  - **In the browser** (`api-scratch` migrated to v11): an existing estimate re-saved at the same
    total with `days: []`, and the Rate Card round-tripped as current.

- [x] **3. Public holidays: fetch and edit** (backend — Sonnet/high). _Depends on: 2._
  - `POST /api/holidays/fetch` pulls this year and next from a free, keyless Australian holiday
    source (e.g. Nager.Date `/PublicHolidays/{year}/AU`). It keeps national holidays and those
    whose subdivision includes `AU-NSW` (D6), upserts them as `fetched`, and never re-adds a
    `hidden` row.
  - `GET/PUT /api/holidays`: add a date (`added`), and remove one (an `added` row is deleted; a
    `fetched` row is set to `hidden`).
  - A failed fetch returns a clear error, and manual entry still works (D7). The fetch also runs
    once on boot if next year is missing, and never blocks start-up.

  **Done when** tests with a stubbed source pin the NSW filter (e.g. Bank Holiday included,
  another state's holiday dropped), the tombstone and the failure path. _Modifies: `app.js`; new
  `routes/holidays.js`._

  **Done 2026-10-02** on `production-booking`, committed `a7c1dc7`. The suite is
  348/348, with 20 new tests in `test-holidays.js` and one in `test-db.js`. New files are
  `holidays.js` and `routes/holidays.js`; `app.js`, `index.js` and `db.js` also changed.
  - **Routes** (all behind the sign-in; the shapes task 4 builds on):
    - `GET /api/holidays` returns `{ holidays: [{ date, name, source, hidden }], lastFetchedAt }`.
      Hidden rows **are** included and flagged, so the editor builds the same snapshot the server
      does (`dayKind` skips them itself). The Rate Card list should filter on `!hidden`.
    - `POST /api/holidays/fetch` returns the same plus `added` (dates new to the table). On any
      failure it is a 502 `holiday_fetch_failed` with a fixed "Add dates by hand" message; the raw
      network error goes to the log only.
    - **`PUT /api/holidays/:date`** (body `{ name }`) and **`DELETE /api/holidays/:date`**, not a
      `PUT /api/holidays` as the task text said, because add and remove are per date.
      - PUT on a new date adds it as `added`.
      - PUT on an existing date un-hides it and renames it if a name is given. It keeps its
        source, so a removed fetched date comes back as `fetched`.
      - DELETE on `added` deletes the row; on `fetched` it sets `hidden`; on a missing date it is
        404.
      - Errors: `holiday_date_invalid` (400, a real calendar date is required),
        `holiday_name_invalid`, `holiday_name_too_long` (100), `holiday_not_found`.
  - **The fetch:** `nagerSource(year)` is Nager.Date, with a 10s timeout. Any
    `async (year) => list` can replace it: `createApp(db, { holidaySource })` for tests.
    - It asks for this year and next (**Sydney's calendar year, not UTC's**).
    - It keeps `global: true` entries and those whose `counties` include `AU-NSW`. Malformed
      entries are dropped, and the first of a repeated date wins.
    - **All-or-nothing:** every year is fetched before anything is written, then one transaction.
    - A re-fetch never un-hides a removed date, and never overwrites an `added` row's name.
  - **Boot:** `index.js` calls `fetchIfNextYearMissing(db)` without awaiting it. It runs if no
    **fetched** row exists for next year (a date the owner added doesn't count), and it logs rather
    than throws. It ran against the real source on `api-scratch`: 22 dates.
  - **Schema change inside v11:** `holidays.fetched_at`, set on each fetched row by a fetch.
    `lastFetchedAt` is the newest. v11 isn't deployed anywhere, so it was amended in place with a
    guarded `ALTER` for a table made earlier. **A dev DB already at v11 needs
    `DELETE FROM schema_version WHERE version >= 11` and a restart** (re-run-safe; `api-scratch`
    was done this way).
  - **Real-data findings** (Nager, 2026–27), for the user rather than a bug:
    - the **NSW Bank Holiday is not in the source** (first Monday of August, banks only), so the
      Rate Card should say they can add it by hand;
    - Nager lists the *observed* Christmas and Boxing Day dates and never a weekend one. That is
      harmless, because a weekend date already takes the weekend rate;
    - Easter Saturday and Sunday are kept (NSW observes both).
  - **Mutations**, each caught: state-only holidays dropped; no filter at all; wrong state; a
    re-fetch un-hiding; a re-fetch overwriting an `added` row; DELETE of a fetched row really
    deleting it; a failed year swallowed (a partial write); UTC year instead of Sydney; boot
    counting an `added` row; boot throwing; the raw error shown to the user.

- [x] **4. Rate Card: Surcharges, Public holidays, Additional work** (frontend — Opus/high).
  _Depends on: 2, 3._
  - **A Surcharges block** below the existing tables, a `.billing-block`:
    - short notice × and hint days (default ×2, 7);
    - weekend & public holiday × (×1.5);
    - after hours × (×1.25), office start/end (07:00–17:00) and working weekdays (Mon–Fri);
    - "How surcharges combine", three radios worded as in the IA glossary, with ⓘ.
  - **A Public holidays block**: this year and next, "+ Add a date", remove, "Fetch again", and the
    last-fetched date.
  - **Defaults:** a new **Additional work** labour section (not on set), and Overtime moved there
    from Production in `DEFAULT_PRICING` (D14). The `prod` section can be renamed but its delete
    control is gone (D24).
  - Validation: each multiplier ≥ 1; end after start; at least one working weekday.

  **Done when**: the block saves inside the card and reloads; a pre-v11 card shows the defaults;
  nothing above it moves at 1280; it stacks at 375. _Modifies: `pricing.js`, `pricing.css`,
  `defaults.js`, `rows.js`. Reuses: `.billing-block`, `Info`, `LSCUtil.showFieldErrors`._

  **Done 2026-10-02** on `production-booking` (committed `da2db86`). The suite is 349/349, with one new
  test in `test-ratecard.js`. `pricing.js`, `pricing.css`, `server/src/defaults.js` and
  `test-ratecard.js` changed. `rows.js` needed nothing: a new section id never collides with
  `newSectionId`'s `catN`.
  - **Defaults:** `DEFAULT_PRICING` gains an `additional` section, "Additional work", holding
    Overtime, which has left `prod`. It also gains `surcharges`, a copy of calc.js
    `SURCHARGE_DEFAULTS` rather than a second literal. Only a fresh database and Reset Defaults
    read either.
  - **On set (D24):** `prod`'s × is replaced by an "On set" tag, which the category name's field is
    described by. The delete handler also refuses `prod`.
  - **Beyond the spec: "+ Add Additional work".** A card without an `additional` section (every
    live card) gets this button in the catalogue bar, the 6b km-row precedent. It makes the
    section **empty, under id `additional`**, which later stages look the section up by. A
    hand-made category would be `catN`. Moving Overtime into it stays the user's job (D14):
    delete it from Production and add it there.
  - **The Surcharges block** sits below the tables and is part of the card: Save Services saves it,
    and the unsaved guard covers it. The working copy starts from `LSCCalc.surchargeSettings`, so
    a card saved before v11 shows the defaults without reading as unsaved. `payload()` sends all
    eight fields.
    - **Validation mirrors `surchargesProblem`.** It checks multipliers ×1–×10, hint days as a
      whole number from 0 to 365, office hours ending after they start, and at least one working
      day. The six route codes have words in `SAVE_REFUSALS`.
    - **Each "How surcharges combine" option shows its live result** for a short-notice weekend
      shoot wholly outside office hours, worked out by calc.js `surchargeFactor`: ×3 / ×3.75 / ×2
      at the defaults (D2's own figures). The day is pinned with `kind: 'weekend'` and runs office
      end → office start, so its share is 1 whatever the settings. Nothing is re-derived in the
      view. The ⓘ explains the three modes, the share rule and rounding.
    - **The flagged interpretation is said in the UI.** After hours' description reads "on any
      day. A weekend evening is both weekend and after hours."
  - **The Public holidays block** sits **below the save bar** and saves itself on every add,
    remove and fetch. It says so in bold, and Save Services has nothing to do with it.
    - It shows this year and next (filtered on `!hidden`), with past dates muted and a "fetched" or
      "added by you" tag on each.
    - It carries the NSW Bank Holiday note, "+ Add a date" (an inline date and optional name), "×"
      with a confirm that says what removal means, "Fetch again", and "Last fetched …".
    - A date already on the list is refused before the request. Failures show inside the block.
    - Busy is shown in place (`aria-busy`, "Fetching…") rather than by disabling, so focus never
      drops. Focus goes to the next row's × after a remove, and to "+ Add a date" after an add.
  - **Not collapsible.** The IA's reuse map lists a collapsible head for these blocks. They are
    short settings, and nothing in the app implements a collapsible `.billing-block` yet, so task
    6's Booking block will be the first.
  - **Responsive:** written phone first in `pricing.css` (new classes only).
    - At 375: label above field, 16px/44px fields, the week as a 4-column chip grid, and holiday
      rows of date | name over its tag | ×. No overflow, and every new control is ≥44px.
    - At 800: `responsive.css`'s 660px `.bb-head` floor for the editor's grids was pushing these
      heads past their block. A doubled-class override opts them out. The holiday years stay in
      one column until 1100.
  - **Verified in the browser** (`api-scratch`):
    - **Nothing above the blocks moved at 1280:** the old and new builds give identical rects for
      the page head, both settings bars, the catalogue bar, the note, the Show switch, every
      section head, every table row and every foot.
    - **Save and reload round-trip** with no false "unsaved" prompt, while a real edit does
      trigger it.
    - **Validation** names all three problems, flags each field and focuses the first.
    - **Holidays:** add, duplicate refusal, remove, fetch and a simulated fetch failure all work.
    - **Additional work** saves as `additional:Additional work:0`.
    - **Console:** no errors.
    - The scratch card was put back to the default surcharges afterwards. It keeps the new empty
      Additional work section.
  - **Mutations** on the new test, each caught: Overtime left in `prod`; `surcharges` dropped from
    the defaults.

- [x] **5. The month calendar component** (frontend — Opus/high). _New shared component_
  (`web/js/calendar.js`, `web/css/calendar.css`), built for the editor first and reused by Home in
  task 12.
  - A month grid with "Go to date" (jumps to the month and highlights the date), previous/next and
    Today.
  - Tiles: confirmed is solid green and pencilled is yellow with a hatch, both full width; proposed
    is a grey quarter tile. Every tile carries its UPID. An "emphasis" option renders one
    estimate's days at full strength and the rest faded (D23).
  - A keyboard grid: arrows move by day and week, PgUp/PgDn by month, Home/End to the week's
    ends, Enter activates.
  - Callbacks for "date activated" and "tile activated". Status colours are new tokens meeting 3:1
    on `--bg`/`--surface`.

  **Done when**: it renders a fixture month at 1280, 800 and 375 (dots-per-date below 768px, D29);
  it can be driven entirely by keyboard; and a screen reader announces "Saturday 4 October: 1
  confirmed, UPID-042". _Aesthetic: the existing dark editorial system, a quiet production-board
  grid, not Google Calendar's look (brief, Aesthetic Direction)._

  **Done 2026-10-02** on `production-booking` (committed `cbe5f07`). New `web/js/calendar.js` and
  `web/css/calendar.css`, both added to `index.html` (the CSS before `responsive.css`, the JS after
  `info.js`). Nothing mounts the calendar yet; task 6 is its first caller. The suite is unchanged
  at 349/349: there is no server change and no harness for web modules.
  - **API:** `LSCCalendar.mount(el, { id, label, emphasis, today, selected, showList,
    onRangeChange, onDateActivate, onTileActivate })` returns `{ setDays, setEmphasis, goTo, range,
    selected, focus }`.
    - Days are `GET /api/calendar`'s shape as is. Date TBC days and unknown statuses are dropped.
    - The component never fetches. `onRangeChange({ month, from, to })` fires on mount and on
      every month change, with the six-week range to ask `/api/calendar` for. `from`/`to` are
      always 42 days, Monday first.
    - Both activate callbacks get `{ trigger }`: the live cell, or the list button. Hand it to
      `Modal` so focus goes back there.
    - Also exported for tasks 6 and 12: `statusChip(status)` (the shared chip from the IA's reuse
      map), `describeDate`, `timeText`, `gridRange`, `longDate`, `shortDate`, `addDays`,
      `addMonths`, `isDate`.
  - **Interpretations the user may want to check:**
    - **Tiles are not keyboard stops.** A tile inside a grid cell would be a second interactive
      layer, and Enter already belongs to the date. A tile is a pointer shortcut. The keyboard and
      phones reach each day through **a list under the grid of the selected date's bookings**, as
      buttons with words, and Tab goes from the grid straight into it. The list is on at every
      width (`showList: false` turns it off). It is also D29's "tapped-date list".
    - **"Quarter tile"** is read as half the width and half the height of a full tile. At the
      400px layout that is a grey slug too short for text, so its UPID is in the cell's name, the
      `title` tooltip and the list. At 640px and up it carries the UPID.
    - **Faded (D23)** is an outline in the status colour with `--muted` text (pencilled keeps a
      faint hatch), not lowered opacity, so the status colour stays readable as a line. With
      emphasis on, the estimate's own days sort first in each cell and its list entries say
      "this estimate".
    - **Tiles or dots go by the calendar's own width** (a container query), not the viewport:
      dots under 400px, UPID tiles from 400 (the editor's ~420px column at 1280), and tiles with
      the project name from 640 (Home, and the editor at 768–1099). At 375 that gives dots, as
      D29 asks. Touch sizing (44px controls) still follows the viewport, under 768.
    - Weekends get a faint tint (they carry a surcharge). Public holidays don't yet. There is a
      seam if task 6 or 12 wants them: pass them in and add a cell class.
    - Six weeks always, so the block never changes height. Clicking an out-of-month date moves to
      its month. Next or previous month keeps the day of the month, clamped (31 Jan → 28 Feb).
  - **Status tokens** (`:root` in calendar.css), measured against `--bg` / `--surface`:
    `--cal-confirmed` #5f9a6d (5.35 / 4.04), `--cal-pencilled` #c9a443 (7.50 / 5.67), hatch
    `#ad8a35` (5.77 / 4.13), `--cal-proposed` #8d939c (5.74 / 4.34). Text is `--cal-ink` #121212,
    at least 5.65:1 on any of them.
  - **Accessibility:** an ARIA grid with one roving tab stop. The visible title stays "October
    2026", and the grid's name is "Production calendar, October 2026" through an sr-only span.
    Cell contents are aria-hidden, so the cell's name is all that's read: "Saturday 3 October: 1
    confirmed, LSC-042; 1 pencilled, LSC-051", with "Today, " in front on today. A month change is
    announced through a polite live region. The key help is in an sr-only description. Reduced
    motion turns off the 180ms month slide and every transition.
  - **Verified** against `api-scratch` with a 15-day fixture across Sep–Dec and all three
    statuses, mounted into the signed-in app at 420px (emphasis on) and full width (emphasis off):
    - **1280 / 800 / 375:** no document overflow at any width. At 375 both calendars show dots,
      and every control and cell is at least 44px. At 800 and 1280 the bar's controls use the
      app's compact desktop sizes, on purpose. Screenshots were saved to the session scratchpad,
      not the repo.
    - **Keyboard, dispatched:** arrows, Home/End and PageUp/PageDown across month and year
      boundaries, one tab stop throughout, and `onRangeChange` firing only when the month changes.
    - **Keyboard, real keys (headless Chrome):** Tab reaches the grid; arrows show the accent
      `:focus-visible` ring; Enter fires `onDateActivate`; the next Tab lands on the first list
      entry.
    - **Clicks, dispatched:** a tile, a cell, an out-of-month cell, a list entry, the three
      buttons and Go to date (jumps, washes the date in accent, lists its bookings).
    - **Nothing moved:** the Estimates screen's element rects at 1280 are identical with and
      without `calendar.css`. The console shows no errors.

- [x] **6. Editor: the Production Booking block and day cards** (frontend — Opus/high).
  _Depends on: 2, 5._
  - A collapsible `.billing-block` below the doc-type bar. It's collapsed unless the estimate
    has days or production items (D64), and its head summarises them.
  - Inside: the task 5 calendar (other projects' days from `/api/calendar`, faded) and the day
    cards in date order, plus "+ Add Date TBC day".
  - **The add-day pop-up** (`Modal`): + Confirmed day / + Pencilled day / + Proposed day (D63).
    - A date pencilled elsewhere gets a warning, "add anyway?".
    - A date confirmed elsewhere locks the three buttons until a **specification note** is typed.
    - The server's `date_locked` refusal is handled the same way.
  - **A day card**: date or "Date TBC", a status select, start and end times (native `time`, with
    "ends next day" stated when overnight), the note if any, and remove (with a confirm, because
    its items go with it). Moving a date re-checks clashes.
  - `collect()` sends `days`, the unsaved guard covers them, and save and reload round-trip.

  **Done when**: three days can be added, edited, moved and removed; lock and override work
  against a second project in the scratch DB; nothing else in the editor moves at 1280. _Reuses:
  `.billing-block`, `Modal`, `LSCUnsaved`._

  **Done 2026-10-02** on `production-booking` (committed `685ebbb`). The suite is unchanged at 349/349:
  no server change. New: `web/js/views/booking-block.js` and `web/css/booking.css`. Changed:
  `estimate-editor.js` (a slot, `days` in `payload()`, the lock check before save, the 409),
  `api.js` (a refusal now carries its whole reply as `err.data`), and `index.html` (the script,
  the stylesheet and a `#modal-add-day` overlay).
  - **`BookingBlock.mount(slot, { estimate, identity, hasProductionItems, onChange })`** returns
    `{ payloadDays, lockProblem, serverLocked, refreshIdentity }`.
    - It keeps its own day state and doesn't read the DOM. `payloadDays()` is sorted by date with
      TBC days last, so the server's `sort` matches what's on screen.
    - Day ids are `d` + a random UUID's hex, made in the browser.
    - `onChange` is wired to the editor's `recalc`. That does nothing yet, and task 7 needs it.
  - **Collapsed unless** the estimate has days or `prod` lines (D64). Every scratch estimate has a
    `prod` line, so they all open. A new estimate starts closed. **Nothing is fetched until the
    block opens:** the calendar mounts on first open, and each month it shows is then fetched from
    `/api/calendar`.
  - **The calendar:** this estimate's days come from the editor's live state, labelled with the
    UPID, name and business as typed, and refreshed on `change`. The server's copy of them is
    dropped, so they're never drawn twice. Other projects' days are faded.
    - Clicking a date, or pressing Enter on it, opens the add-day pop-up.
    - Clicking one of this estimate's tiles focuses that card. Clicking another project's tile
      opens the pop-up for its date, which names who has it (D23).
  - **The lock mirrors `days.js` `lockedDay` exactly.** It applies only to a day that is new, has
    moved, or has just been made confirmed, on a date another estimate has confirmed, with no note.
    - **In the pop-up:** the three buttons stay disabled until a note is typed, and focus starts
      in the note.
    - **On a card:** the error-style line plus the note field (`aria-invalid`). The lock is
      announced once, through the block's polite live region.
    - **Save:** `lockProblem()` stops it client-side and focuses that day's note. A 409
      `date_locked` (someone confirmed the date since the editor fetched) does the same through
      `serverLocked(date, upid)`, which also re-fetches the month on show.
  - **Pencilled elsewhere:** "Already pencilled for X. Add anyway?" in the pop-up, and "Also
    pencilled for X." on the card. Proposed elsewhere says nothing (D15).
  - **Interpretations the user may want to check:**
    - **A Date TBC day starts as Proposed** (the card's select changes it). It is on no calendar,
      and accepting leaves it alone (D18), so Proposed is the least committal choice.
    - **A day booked before another project confirmed its date** reads "Since confirmed for X.
      This day was booked first." It isn't asked for a note, matching the server.
    - **The same date twice on one estimate is allowed.** The pop-up notes it ("This estimate
      already has a day on…").
    - **Remove uses `window.confirm`**, as the editor's own Delete does. The wording already
      warns that items on the day go too, ready for task 7.
  - **Layout** (phone first): the calendar sits above the cards, and beside them at 420px from
    1100. Card fields stack on a phone and go four across once the cards' column is 460px wide (a
    container query). The pop-up is a full-width bottom sheet with 44px buttons below 768, and a
    460px box above. Like the Rate Card's blocks, it opts out of `responsive.css`'s 660px
    `.bb-head` floor.
  - **Verified** against `api-scratch`, mostly with dispatched events:
    - **Days:** three days added (confirmed, pencilled, TBC), an overnight time ("Ends next day"
      shown), saved, and reloaded intact. The total was unchanged at $400 (no lines on days yet),
      and the surcharge snapshot was stored.
    - **Unsaved guard:** clean on open, dirty after a status change, clean again once it's
      reverted.
    - **Second project ("Test draft", now UPID `TST-001`):**
      - lock and override in the pop-up, and the pencil warning;
      - a cleared note re-locks the day;
      - save is blocked and focus goes to that day's note;
      - a moved day re-checks;
      - the saved note is stored with its day.
    - **Server 409:** a raw-API PUT confirmed 21 Oct on Audit A behind the editor's back. The save
      then came back 409, and the right card locked with its note focused.
    - **Other paths:** a new estimate is collapsed with zero `/api/calendar` requests until
      opened; Enter on a cell opens the pop-up, and Escape returns focus to the cell; remove asks
      first, then focuses the next card.
    - **Nothing moved:** at 1280, all 303 other editor elements kept their x, width and height.
      Those above the block didn't move, and every one below shifted by the same 755.9px (the
      block plus its margin).
    - **Overflow and targets:** no document overflow at 1280, 800 or 375. At 375 every control
      in the block is at least 44px and the calendar shows dots. The sheet is full width at the
      bottom, with 44px buttons.
    - **Console:** only the intended 409, and Chrome blocking the unsaved prompt on scripted
      reloads.
  - **Scratch DB state for task 7:**
    - Audit A (`est_8dca1cee`) has Sat 3 Oct (confirmed), Wed 14 Oct 18:00–02:00 (pencilled),
      Wed 21 Oct (confirmed, added by the raw API) and a TBC day.
    - "Test draft" is now `TST-001`, with Sat 3 Oct (confirmed, note "Subcontractor shooting")
      and Wed 14 Oct (proposed).

- [x] **7. Editor: production items live on days, priced with surcharges** (money math —
  Opus/high). _Depends on: 1, 6._
  - **Production items:** the Production section's "+ Add" becomes "Add to a day ▾". Each day
    card lists its items with the existing service → unit → Add picker scoped to `prod`, and each
    line stores `dayId`.
  - **An existing estimate's undated production lines** show under a single "Unassigned — pick a
    day" group. They keep pricing exactly as before until moved, so nothing changes on open.
  - **Live pricing** in the editor through task 1: each surcharged line shows its price with a
    muted "incl. weekend ×1.5" (owner-only); the summary gets "Surcharges +$X ⓘ"; and "Booked 12
    hrs, items cover 8" shows on a long day (D26).
  - **Short notice:** the tick sits in the doc-type bar, with the hint when the first dated day is
    within the threshold (D19).
  - Each line snapshots `surchargedPrice`, and the editor's totals match the server's stored totals
    to the cent.

  **Done when**:
  - the brief's worked examples reproduce in the browser;
  - Income floor and Minimum Job Price are unchanged by a surcharge (it is income, with the same
    hours);
  - an estimate saved before this opens and totals identically;
  - the mutations from task 1 are re-checked through the editor path (one each).

  **Done 2026-10-02** on `production-booking` (committed `5261323`). The suite is unchanged at 349/349:
  there's no server change, and both `calc.js` copies are untouched. Changed:
  `estimate-editor.js`, `booking-block.js` and `booking.css`.
  - **Where the lines live.** A production line is built **inside its day's card**, as the brief's
    day card asks ("that day's production items, the existing labour line UI").
    - Each card has its own service → unit → Add picker, a "Day total", and D26's hint ("Booked 10
      hrs, items cover 8.").
    - A line's `dayId` is read from the card it sits in. It is never stored on the row, so a
      line can't disagree with where it's shown.
    - The editor builds one items element per day (`itemsFor(dayId)`). The booking block **moves**
      it into the card on every paint and never rebuilds it, so typing survives re-sorts and month
      fetches.
  - **The Production section** keeps its place and its Subtotal (surcharges included). Its
    "+ Add Service" became **"Add to a day ▾" + "+ Add Items"**.
    - That opens the booking block and focuses the chosen day's picker. "A new Date TBC day" makes
      one first. The day's own picker does the adding, so there is one way to add an item.
    - Under it is one line per day (title, status chip, items, total), each linking to its card.
    - Then **"Unassigned — pick a day"**: lines saved before days existed, priced exactly as before.
      Each has a "Pick a day…" select that moves it onto a day. The move is rebuilt rather than
      moved, so it keeps quantity, override and both rate marks.
  - **Live pricing** is calc.js, as the server prices it. Nothing in the view multiplies:
    - `surchargeSnapshot` is built with the stored snapshot as `prior`, or `null` once "Update to
      current rates" asked.
    - `stampSurchargedPrices` gives each line's price, and `computeTotals` gets `{ days,
      surcharges, shortNotice }`.
    - A surcharged line shows a muted note under its price from `surchargeAttribution`: "incl.
      weekend ×1.5", "after hours ×1.25 on 2 of 10 hrs", "short notice ×2", or "public holiday".
  - **Summary:** "Surcharges +$X ⓘ", owner-only, is an advisory-style line under the bars.
    - It's shown only when a surcharge applies, and isn't under the overhead switch.
    - The ⓘ names the estimate's own settings and mode and says the floors don't move.
  - **Short notice:** a tick in the doc-type bar, beside GST-free. The hint ("First shoot day is
    tomorrow — short notice?") uses the earliest booked date from today on, against the live card's
    `shortNoticeHintDays`. It's never ticked for you. `payload()` always sends `shortNotice`.
  - **"Update to current rates"** also sets `refreshSurcharges` (sent on save), but only when that
    changes the snapshot. A no-op click doesn't make the form dirty. The toast says when it did.
  - **Holidays:** `GET /api/holidays` is fetched once, the first time a day has a date, and the
    whole list goes in, hidden rows included, as the server does it.
  - **Booking block additions:** `itemsFor`, `list()`, `showDay(id)` and `addTbc()`. Focus inside a
    day's items survives a repaint. The remove confirm counts the day's items ("Its production item
    is removed too.").
  - **Interpretations shown to the user, all five confirmed 2026-10-02:**
    - **"Add to a day" goes to the day, not straight to a line.** Adding happens in the day card's
      picker, so the Production section doesn't carry a second service/unit picker.
    - **A line moves one way only,** from Unassigned onto a day. Moving between days means removing
      the line and adding it to the other day.
    - **The short notice hint** counts any status and hides once the box is ticked.
    - **"Surcharges +$X" stays visible** with the overhead switch off, because it's part of the
      price, not an advisory floor.
    - **From task 2:** a custom-bill production line on a surcharged day is surcharged on its
      custom amount.
  - **Verified** headless against `api-scratch` (dispatched events, puppeteer):
    - **Worked examples,** all on Audit A with Video Capture — Full Day at $1,120:
      - Sat, no times: $1,680, "incl. weekend ×1.5".
      - Weekday 9–7: $1,176, "after hours ×1.25 on 2 of 10 hrs".
      - Overnight 6pm–2am: $1,400.
      - TBC: $1,120.
      - Short-notice Sat 1–9pm: $3,360 (default), $3,780 (multiply), $2,240 (highest). The other
        modes were reached by changing the card's mode, then "Update to current rates". The card
        is back on "higher".
      - TBC with short notice: $2,240.
    - **Editor = server to the cent** on save: total $11,152.00, tax set-aside $3,723.27,
      take-home $6,914.65, `surchargeTotal` 6272, and each line's stored `surchargedPrice`.
    - **Floors unmoved:** Minimum Job Price $642.60 and Income floor $2,793.44, before and after
      the short-notice tick (same 34 hrs).
    - **Saved estimates never move:** after the card's mode changed, the estimate opened at its
      pinned price until "Update to current rates".
    - **Old estimates open at their stored total.** Three scratch estimates match exactly.
      `est_d9c6e5bf` and `est_1c0705ef` show $2,000 / $4,000 against stored $1,400 / $2,800, but
      the server's own `computeTotals` gives the same $2,000 / $4,000. They're stale seed rows from
      27 Sep, not this change.
    - **Unsaved guard:** clean on open for all five estimates and a new one.
    - **Paths:** move a line onto a day (×1.5, saved with its `dayId`); a new estimate via "A new
      Date TBC day" (picker focused, saved); remove a day with an item (confirm counts it, line
      and price gone).
    - **Nothing moved at 1280:** old build (HEAD's three files) vs new, for a legacy estimate.
      - All 218 elements outside the booking block, the Production block, the doc-type bar and
        the surcharge line kept x, width and height.
      - Everything above the Production block kept its y. Everything after it shifted by one
        constant 106.5px.
    - **Overflow:** none at 1280, 800 or 375. At 375, every new control is ≥ 44px except the
      Short notice checkbox (13px, the GST-free tick's own pattern; its label is the target). That
      goes to task 9.
    - **Console:** no errors (one 401 before sign-in, from the harness).
  - **Mutations,** each in `web/js/calc.js` only and each caught by the editor's figures:
    - **mode swap** ("higher" taking multiply's steps): Sat 1–9pm with short notice went $3,360 →
      $3,780;
    - **ceil → round:** a Drone hour on the 9–7 day went $89 → $88;
    - **share inverted:** 9–7 went $1,176 → $1,344;
    - **overnight ignored:** 3pm–1am went $1,344 → $1,400. On 6pm–2am it isn't visible, because
      that day is wholly after hours either way;
    - **short notice skipped on TBC:** $2,240 → $1,120.
    - The file was restored and `git diff` is clean.
  - **Scratch DB state:**
    - Audit A (`est_8dca1cee`) now has short notice ticked and a Full Day on each of its four days
      (Sat 3 Oct 1–9pm, Wed 14 Oct 6pm–2am, Wed 21 Oct 9–7, TBC). Its old Video Capture line is
      still unassigned. Total $11,152.
    - "Test draft" (`TST-001`) had its 100 hrs of Video Capture moved onto Sat 3 Oct ($30,000).

- [x] **8. Estimate detail, client PDF and Cost Breakdown PDF** (money math — Opus/high).
  _Depends on: 7._
  - **The estimate detail and client PDF** list production days by date with Confirmed / Pencilled
    / Proposed (D63), times, and items at their **surcharge-folded** prices. No surcharge wording
    appears anywhere client-facing (D8, D12). When any day is proposed, they print the disclaimer:
    "The proposed dates are not locked in and other project bookings may happen before this
    estimate is agreed upon".
  - **A new owner-only "Cost Breakdown" download** on the estimate detail,
    `Cost Breakdown_<UPID>_<ProjectName>.pdf`, client-safe (D13):
    - each day's items at base price;
    - each surcharge row (type, ×, day or hours covered, $), then short notice;
    - pass-throughs, GST and the total;
    - **no** floors, Minimum Job Price, tax set-aside or take-home.

  **Done when** `test-pdf.js` pins: folded prices that sum to the total; the disclaimer present
  only with a proposed day; the Cost Breakdown's rows adding up to the total; and neither PDF
  containing the other's forbidden words. _Modifies: `pdf.js`, `routes/pdf.js`,
  `estimate-detail.js`._

  **Done 2026-10-02** on `production-booking`, committed `0d82f73`. The suite is 366/366: 8 new tests in
  `test-calc.js` and 9 in `test-pdf.js` (one renders through real Chromium). Changed: both
  `calc.js` copies, `pdf.js`, `routes/pdf.js`, `estimate-detail.js`, `rows.js`,
  `estimate-editor.js` and `booking.css`.
  - **A bug fixed on the way:** `POST /api/estimates/:id/pdf` called `loadEstimate(row)` without
    the days, so every PDF would have read `days: []`. Both PDF routes now load them (`readDays`).
  - **`calc.js` `costBreakdown(activeRows, pricing, { days, surcharges, shortNotice, totals,
    gstFree })`** returns the Cost Breakdown as figures. Only the PDF uses it today; it's in
    `calc.js` because it is money maths, and stage E's pages can reuse it.
    - **Days:** each day's lines at base, with `price` = what computeTotals charged. Its weekend /
      holiday / after-hours rows are summed across the day's lines. Each row has `multiplier`,
      `share` and `hours` (share × booked hours).
    - **Short notice is one estimate-wide row** (`shortNotice: { multiplier, amount, dayIds }`), not
      a row under each day. D13 lists it after the day surcharges.
    - **Everything else:** unassigned `prod` lines and the other labour sections at their bills,
      then travel, equipment and crew.
    - **Reconciliation, in whole cents:** `itemsTotal` is the sum of the lines as shown. `target` is
      the stored figure the lines add up to: the total inc GST when the card's prices included
      GST, otherwise the ex-GST price. Which one is read from the stored totals (whichever the
      lines are nearer), not today's settings, as `gstTreatment` does. `adjustment` = target −
      items. It is non-zero only when a line is priced in fractions of a cent, and then the PDF
      prints it as a "Rounding" row.
    - **Reads the estimate's snapshot, never the live card's surcharge settings.** A test pins
      this: the live card at ×3 still explains a ×1.5 estimate.
  - **The client PDF** (quote and invoice): a "Production Days" block before "What Goes Into This
    Project". It shows each day in the estimate's order (date, or "Date TBC"), the status word,
    12-hour times with "(ends next day)", and the items with qty and unit at their **stored
    `surchargedPrice`**. Nothing is re-priced.
    - **The services list skips lines that sit on a day,** so each item is listed once. The
      services block is dropped only when every item is on a day. An estimate with no days prints
      byte-identically to before (pinned).
    - **The disclaimer** prints under the days on a quote with any proposed day, and never on an
      invoice (an invoice comes after agreement).
    - **Owner-only data stays off it:** no surcharge wording in any mode, and no clash note
      (`overrideNote` is about other projects).
  - **The Cost Breakdown PDF** comes from `POST /api/estimates/:id/cost-breakdown` (behind
    sign-in), named `Cost Breakdown_<UPID>_<ProjectName>.pdf`, with a copy in `exportDir` like the
    quote.
    - **Layout:** the quote's header with "COST BREAKDOWN", and one line on what it is. Then
      Production Days: per day, its items "at the standard rate", each surcharge row ("Weekend
      rate ×1.5 · whole day +$560.00", "After hours ×1.25 · 2 of 10 hrs +$56.00"), and a "Day
      total" when the day has surcharges.
    - **Then:** Short Notice; the other sections; Travel; Equipment Hire and External Crew
      ("2 days at $650.00"); "Items total"; and the quote's totals box and GST note.
    - Each row carries `data-cb` (`item` / `subtotal` / `total`), so the tests add up exactly what
      is printed.
  - **The estimate detail:**
    - **Production by day:** with days, it groups one `<tbody>` per day. Each has a head row (date,
      the shared status chip, times, the clash note), its items at the stored price, and the
      owner-only "incl. weekend ×1.5" note. The note is now `LSCRows.surchargeNote`, moved out of
      the editor so both screens word it alike. Then come "Not on a day" lines.
    - **The disclaimer** shows as "On the client's copy: …".
    - **Totals:** a muted "incl. Surcharges $X" row under Labour Subtotal when it's above zero.
    - **Header:** "↓ Cost Breakdown" with an ⓘ that says what it is, beside Export. Its failures
      show inline, as Export's do.
    - **No days, no change:** an estimate without days renders the old markup.
  - **Interpretations, approved by the user 2026-10-02 (they saw sample PDFs and asked to commit):**
    - **Prices on the client PDF appear only on production-day items.** D12 asks for folded
      prices. The brief rules out changing the PDF's look beyond adding the days, so the other
      sections stay names only, as before.
    - **Short notice is one row** for the estimate, with the number of days it covered.
    - **"Day total"** is the day before short notice: items plus its own surcharges.
    - **The client PDF shows times in 12-hour format** (the app shows 24-hour).
  - **Mutations,** 12 in all, each caught by `test-calc.js` and `test-pdf.js` (both `calc.js`
    copies mutated together), then restored:
    - **calc.js:** short notice left in the day rows; the adjustment's sign flipped; the GST side
      inverted; hours ignoring share; a day line totalled at base; the surcharge rows dropped.
    - **pdf.js:** the client price re-priced at base; the disclaimer on the invoice; day lines
      repeated under the services; crew dropped from the breakdown; no rounding row; the
      disclaimer whatever the status.
  - **Verified** headless against `api-scratch` (restarted for the new routes):
    - **Folded prices match the totals.** On Audit A ($11,152, short notice, four days, one
      unassigned line) and TST-001 ($30,000), the detail's prices add up to the stored totals to
      the cent.
    - **Both PDFs download** with the right filenames. Audit A's Cost Breakdown adds up: 4 × $1,120
      + $560 + $280 + $56 + $5,376 short notice + $400 = $11,152.
    - **Nothing moved at 1280:** for two estimates without days, the old build (HEAD's files,
      served by request interception) and the new one gave identical rects for all ~60 elements
      outside the header's button group.
    - **No overflow** at 1280, 800 or 375. At 375 the header buttons are 44px tall, and the ⓘ keeps
      its 44px hit area.
    - **The editor, after the `surchargeNote` move,** shows Audit A exactly as in task 7: $11,152,
      +$6,272, the same five notes and the same hours hint.
    - **Console:** no errors (only the harness's 401 before sign-in).

- [x] **9. A+B responsive and accessibility pass** (frontend — Opus/high). Breakpoints 1280, 800
  and 375.
  - The editor calendar sits beside the cards at ≥1100px and above them below that.
  - The add-day pop-up becomes a bottom sheet with 44px buttons below 768px.
  - The Rate Card blocks stack.
  - Checks:
    - status is never colour alone;
    - the calendar's keyboard grid and its announcements work;
    - a surcharge recompute announces once, politely;
    - the clash lock is announced;
    - reduced motion is respected;
    - every new control is ≥44px on phones.

  **Done when** it's measured and recorded here, with no overflow.

  **Done 2026-10-02** on `production-booking` (uncommitted). The suite is unchanged at 366/366: no
  server change. Changed: `estimate-editor.js` and `booking.css`. Most of the list was already
  built in tasks 4–8. This pass measured all of it, and built the two things that were missing.
  - **Built: the surcharge recompute announcement** (brief: "Saturday 4 October: weekend rate
    applied").
    - **What it says:** each dated day's day/time surcharges, worded from calc.js
      `surchargeAttribution` on a nominal base, so a day with no items yet is described too.
      Short notice is said once for the estimate. For example:
      - "Wednesday 21 October: after hours ×1.25 on 4 of 12 hrs applied."
      - "…: no surcharge now."
      - "Short notice ×2 applied to the production days." / "Short notice removed."
    - **When:** it compares against what was last *announced*, after a second's quiet. Typing a
      time through "20:00" to "21:00" is read once, where it lands. A change undone within the
      second says nothing. Several days changing together are read in one message.
    - **Where:** its own polite region `#sur-live`, so it never cancels a message in
      `#editor-live`.
    - **Never on open:** the first recalc with the booking block is the baseline. It is reset on
      every mount, so opening a second estimate doesn't "announce" the difference from the first.
  - **Built: the Short notice tick is 44px on phones.** Below 768 the wrapping label is
    `min-height: 44px` and the box is 20px. At 768 and up nothing changes. Task 7 had flagged it.
  - **Measured** headless against `api-scratch` (puppeteer; dispatched events, plus one real Tab
    for focus rings):
    - **Layout:** the editor calendar sits beside the cards at 1280 (420px column) and above them
      at 800 and 375. At 375 the calendar is 313px wide, so it shows dots.
    - **The add-day pop-up:** at 1280 and 800 it is a 460px box with 44px buttons. At 375 it is a
      full-width bottom sheet (375px wide, 0px from the bottom) with 341×44 buttons. The first
      button takes focus, and Escape closes it and returns focus to the grid cell.
    - **Rate Card:** the Surcharges and Public holidays blocks stack, with labels above fields at
      375 (screenshot checked).
    - **No overflow:** nothing overflows, in the document or inside either block, at 1280, 800 or
      375.
    - **≥44px on phones:** at 375, nothing is under 44px in the booking block, the doc bar's short
      notice group, the surcharge line, the Production day list, the Unassigned group, or the Rate
      Card's two blocks.
      - The ⓘ buttons are excluded: each has a 44px `::after` hit area.
      - So is a checkbox whose wrapping label is the target.
    - **Status is never colour alone:**
      - every status chip carries its word;
      - calendar tiles carry the UPID;
      - dots differ by shape (solid / hatched / small grey);
      - list entries read "Proposed: UPID, project, Sat 4 Oct, …", the brief's format;
      - the detail's day heads carry the chip.
    - **Keyboard grid in the editor:** arrows, PageDown/PageUp and one tab stop all work. Each
      focused date is named with its bookings ("Saturday 3 October: 2 confirmed, AUD-Audit A and
      TST-001"). Enter on a date confirmed elsewhere opens the pop-up with the lock message. The
      month live region is present.
    - **Clash lock:** the lock line shows and is announced through `#booking-live` (task 6), and
      re-checked here through the keyboard path.
    - **Reduced motion:** under emulated `prefers-reduced-motion`, nothing in the booking block (after
      a month change), the doc bar, the add-day sheet or the Rate Card blocks has a transition or
      animation over 1ms. a11y.css's global rule takes everything to 0.01ms, and calendar.css also
      drops the month slide. As a control, the same probe finds 82 moving elements without it.
    - **Focus rings:** after one real Tab, all 59 focusable controls in the booking block, the
      short notice box, the Production day links and the ⓘ buttons match `:focus-visible` with a
      visible outline. So do the detail's "↓ Cost Breakdown" and its ⓘ (2px accent).
    - **Nothing moved:** the editor at 1280 and at 800, for an estimate with days and one without,
      old build (HEAD's `estimate-editor.js` and `booking.css`, served by request interception) vs
      new. Every element kept its rect. The only new element is the 1×1 sr-only `#sur-live`.
    - **Console:** no errors (only the harness's 401 before sign-in).
  - **Not done here:** a real screen reader. Everything above is DOM and ARIA. A person should run
    VoiceOver over the booking block, the add-day sheet and the detail's day groups (`<tbody>` with
    a `scope="rowgroup"` head) before or soon after deploy, as was done for price-calculator.

- [x] **9a. Money review fixes** (money math — Opus/high). 2026-10-02, after a code and accounting
  review of the whole finance → billing pipeline (ten findings). The user decided D67–D72 for the
  ones that changed a rule. **Done 2026-10-02, uncommitted.** The suite is 377/377.
  - **The surcharge core was rewritten in `calc.js`** (both copies):
    - `coveredWindow` places each item from the booked start for its own hours (D67);
    - `windowPieces` cuts that window at midnight and at each date's office hours (D69);
    - `surchargeParts` gives each piece its own date's status (D70).
    - `surchargeFactor` and `surchargeAttribution` take an optional `lineHours`. Without it they
      read the whole booking: the Rate Card's mode example and the editor's announcement.
    - Attribution rows gain `hours` and `carry`, and the result gains `window`, `hours`,
      `nextKind` and `carryDate`.
    - `surchargeSnapshot` stores `nextDays` (the next date's kind) for an overnight day, kept on
      re-save like `days`.
  - **Short notice on no day (D72):** `surchargeContext` exists with no days when short notice is
    ticked. `surchargedPriceOf` applies it to a production line on no day, and
    `stampSurchargedPrices` stamps that line. The server pins a snapshot whenever short notice is
    ticked.
  - **`costBreakdown`** is per item now. Each day line has `window`, `coveredHours`, `carryDate`
    and its own `surcharges` (short notice still one estimate-wide row, `items` counted). It adds
    `stale` (more than half a cent per line off the stored total) and `settings`. `bookedHoursOf`
    is exported and is the one definition `rows.js` reads.
  - **The Cost Breakdown PDF** shows the explanation (D67, in the estimate's own office hours and
    mode), a "Covers 9:00am–5:00pm…" note per item where it matters, each item's rates, and
    carry-over sub-lines ("Carry-over into Saturday 17 October 2026: weekend rate ×1.5 · 2 of its 6
    hrs, after midnight, $186.67/hr → $280.00/hr"). The route refuses a stale estimate (409
    `breakdown_stale`) instead of printing a "Rounding" row of any size.
  - **Migration v11** (amended in place; not deployed anywhere) moves rows named "Overtime…" from
    Production to Additional work (D71). **A dev DB already at v11 needs `DELETE FROM
    schema_version WHERE version >= 11` and a restart** (`api-scratch` was done; it logged the
    move).
  - **The editor:**
    - it won't save a booked date until it has the holiday list, and it stops and says so if the
      list can't load or changes a price;
    - one shared in-flight holiday request;
    - line notes from each line's own hours, with "after midnight" for carry-overs;
    - a note on a short-noticed line that isn't on a day.
  - **The detail screen:** quantity-0 items with no price are left off, the notes use line hours, a
    line on no day shows its stored short-notice price, and an owner-only "N production items aren't
    on a booked day…" note appears. Duplicate's toast says how many items came off their days (the
    route returns `unbooked`).
  - **Client PDF:** quantity-0 items with no price are left off.
  - **Mutations:** 22, each caught (both `calc.js` copies mutated together; the files were restored
    and `calc.js` is identical):
    - item hours ignored, or not capped at the booking;
    - the next morning's office hours ignored;
    - the next date's status ignored, or its snapshot ignored;
    - carry rows not split;
    - short notice skipped on no-day lines, with no context or no stamp for them;
    - computeTotals not passing hours;
    - nextDays not snapshotted;
    - the stale threshold loosened, or the stale blocker skipped;
    - no snapshot for short notice without days;
    - the breakdown dropping no-day short notice, or keeping qty-0 lines;
    - `unbooked` not returned;
    - Overtime left in Production, or copied rather than moved;
    - the client PDF keeping qty-0 items;
    - carry-over shown as a plain row;
    - the long-day cover note missing.
  - **Verified** headless against `api-scratch` (re-migrated):
    - **Audit A, priced by the editor and the server alike ($11,440, then $11,627):**
      - the 9am–7pm full day fell to short notice only, $2,240;
      - its line on no day took short notice, $400 → $800;
      - a day moved to Fri 16 Oct 8pm–2am priced at $2,987, with "weekend ×1.5 after midnight on
        2 of 6 hrs", announced once, and `nextDays` stored;
    - **Save guard:**
      - the holiday list failing (a 4xx) stops the save with its message;
      - a slow list that turns a Labour Day price up stops it with the new price shown;
      - saving again stores $1,680.
      - A 5xx or network failure is already blocked by the connection banner.
    - **Detail, duplicate and PDF:** the detail shows the off-day note, the duplicate toast reads
      "Its 4 production items are off their days…", and the Cost Breakdown adds up: $4,880 + $933.34
      + $5,813.66 = $11,627.
    - **Console:** no errors.
  - **Scratch DB state:** Audit A now has Sat 3 Oct, Fri 16 Oct 8pm–2am, Thu 22 Oct 9–7 and a TBC
    day, with short notice. Total $11,627.

- [x] **10. Deploy A+B** (deploy — Sonnet/medium). **Deployed 2026-10-02 with the user's go-ahead** (see the Done note below).
  - **NAS:** back up the live DB, deploy NAS v11 (watch the boot log for the migration and the
    holiday fetch), check `healthy`.
  - **Pages:** then push Pages, back to back (the shape bump refuses the old tab in between, as at
    v9).
  - **Watch the boot log for** `[db] v11: moved 1 Overtime row(s) from Production to Additional
    work` (D71). The migration does the move; the user no longer has to.
  - **Afterwards, the user:** checks Overtime sits in Additional work; checks the Public holidays
    list; sets their multipliers.

  Record the run ids in `HANDOVER.md`.

  - **Done 2026-10-02.** Backup (`sqlite3 ".backup"`, integrity ok, schema v9) to
    `/volume4/lsc-billing/data/backups/pre-v11-20261002-1558.db`. `server/` tar-copied over the
    `lsc-nas` key alias, excluding `node_modules`, `data`, `.env` and `docker-compose.yml` (the last
    two md5-identical after, volume still `/volume4/lsc-billing/data:/data`). `docker compose up -d
    --build`: `healthy`, 0 restarts, boot log `migrated to v10` then `migrated to v11`, then
    `[holidays] fetched, 22 new date(s)`; live DB at v11. **No `moved 1 Overtime row(s)` line:** the live
    card has no Overtime row, so the migration had nothing to move. Container carries
    `production-days`; `/health` 200 and `/api/calendar`, `/api/holidays`, `/api/estimates` 401 signed out.
  - **Pages:** `main` fast-forwarded to `6074c3e` and pushed, run 36971522863 success; live
    `index.html` carries `calendar.js?v=6074c3e0` and `js/views/booking-block.js` serves 200.

## Stage B2 — Day-built estimates and the post-production planner (migration v12; built before C)

Added 2026-10-03 from the brief's "Stage B2" section and the IA's "Stage B2 addendum" (D73–D99).
Task ids are **B2-1 … B2-13**, so tasks 11–33 keep their numbers. Build them in order. B2 ships
on its own (B2-13) before task 11 starts. The ground rules above apply. In particular: **a new field
must reach every place it belongs.** B2's new fields (`dayId` on travel/crew/equip, equipment
`item`, prod `capture`, the deliverable's `id`/`typeId`/`typeName`/`multiplier`, the post line's
`deliverableId`, `rentals`) must each reach:

- the editor's row builder and `collect()`;
- `payload()`;
- the server's write checks;
- the duplicate route;
- the estimate detail;
- the PDF;
- from Stage E, the public serializer.

- [x] **B2-1. `postPlan` and the card shape** (money math — Opus/high). _Pure functions in both
  `calc.js` copies._ **Done 2026-10-03, committed `33af089`.**
  - **`postPlan(activeRows, pricing)`** → `{ captureHours, shares: [{ deliverableId, hours }],
    recommended, onPostLines }`, per the brief's B2 Key Interactions 3:
    - Capture hours = Σ `unitHours × qty` over `prod` lines with `capture` (falling back to the
      card's row of the same name when the line has no `capture` field).
    - Each share = capture × multiplier × qty, rounded **up** to 0.5.
    - Recommended = Σ shares.
    - `onPostLines` = the hours of every `post` line.
  - **Worked-example tests** in `test-calc.js`: 10 capture → 20 + 15 = 35; ×0.33 → 3.5; no capture
    → 0; untyped → 0; qty 0 → 0; a Full Day on a card whose Service Day is 7 hrs → 7.
  - **`PRICING_SHAPE`** → `'deliverable-types'`, with the card marker and `cardShapeOutdated`, in the
    v9/6a/v11 pattern. `DEFAULT_PRICING` gains `deliverableTypes: []` and no `capture` ticks (the
    user ticks their own).
  - **A pinned test:** a non-`prod` line with a `dayId` on a Saturday, after hours, short-notice day
    is **never** surcharged. It covers travel (including own-time Transport hrs and per-km), crew
    and equip.
  - **Mutations:** the rounding direction, qty dropped, the capture fallback skipped, and a surcharge
    let onto `travel`. Each must fail a test.

  **Done when** the suite is green, the drift test passes, and the four mutations are listed.

  **Done note (2026-10-03).** `npm test` 387/387 (was 377), and the drift test passes.
  - **What exists now:**
    - `calc.js` `postPlan` (both copies, exported to `LSCCalc`) under a new "post-production
      planner" heading after `costBreakdown`. `PRICING_SHAPE` is `'deliverable-types'`.
    - `defaults.js` `DEFAULT_PRICING.deliverableTypes: []`, with no Capture ticks.
    - `PUT /api/pricing` refuses a `capture` that isn't a boolean (`labour_capture_not_a_flag`)
      and a malformed `deliverableTypes` (`deliverable_types_invalid`): not an array, or a type
      without a string `id`, with `services` not a list of names, or a multiplier that isn't a
      number ≥ 0. Not in the spec; added so B2-9 has a server check to lean on.
    - **The Rate Card carries both fields through a save** (`pricing.js` `workingCopy` and
      `payload()`), and the two refusal codes have messages. Without that, bumping the shape
      would have let this build's own Rate Card drop them. Verified in the browser against
      `api-scratch`: a seeded type and tick survive "Save Services". The scratch card was put back.
      B2-9 builds the editing UI on top.
  - **Tests** (`test-calc.js`, 9 new, and one in `test-api.js`):
    - the worked example (10 → 20 + 15 = 35);
    - rounding (×0.33 → 3.5, 3 × 0.1 × 5 → 1.5 not 2, on and just over a half hour, recommended =
      Σ rounded shares);
    - edge cases (no capture, untyped, saved before B2 with no id, qty 0, negative or non-numeric
      qty and multiplier);
    - a Full Day on a 7-hr card → 7;
    - the capture flag and its fallback;
    - only `prod` counts;
    - "on post lines";
    - the B2 fields price nothing (with vs without, `computeTotals` deep-equal);
    - **the pinned D3 test:** own-time Transport hrs, per km, direct, resold meals, crew and equip
      on a Saturday 6–11pm short-notice day total exactly as with no day, through `computeTotals`,
      `stampSurchargedPrices` and `costBreakdown`;
    - the shape guard refuses `'production-days'`;
    - and the route round trip plus each refusal.
  - **Mutations, each failing a test:**
    - rounding down, rounding to nearest, and the float-noise guard dropped;
    - qty dropped from the share;
    - the capture fallback skipped, and a snapshotted `capture: false` ignored;
    - an untyped deliverable counted;
    - hours read as quantity;
    - a surcharge let onto own-time/resold travel, per-km travel, crew or equip, and stamping on
      every section.
  - **Interpretations to show the user:**
    1. **Capture counts the hours a line bills**, meaning its own snapshotted hours per unit
       through `lineDef`, the same figure as `computeTotals`' `totalHours`. The brief's
       `unitHours(pricing, unit)` reads the live Service Day instead. The two differ only when the
       Service Day changed after the line was added: a Full Day added at 8 hrs on a card now at 7
       captures 8, as it bills 8.
    2. **The capture fallback matches the card row by `rowId`, then by name**, as `lineDef` does,
       so a service renamed on the card still finds its tick. The brief says "the same name".
    3. **"Untyped" means no `typeId`.** A deliverable carrying a multiplier but no type
       recommends 0.
  - **Seams for later tasks:**
    - **B2-10:** the editor's deliverable `collect()` saves a qty of 0 or blank as 1 (`|| 1`), so
      a qty-0 deliverable shows 0 live and its full share after a save. Decide there whether qty 0
      is allowed.
    - **B2-2:** `costBreakdown`'s equipment name reads `vendor` (`atCost('equip', 'vendor', …)`).
      For the Cost Breakdown PDF to print `item || vendor` as the client PDF will, change it
      there.

- [x] **B2-2. Schema v12, rentals, and the server's line rules** (money math — Opus/high, because
  it governs which lines can carry a day). _Depends on: B2-1._ **Done 2026-10-03, committed `26e4e75`.**
  - **Migration v12:** the `rentals` table, per the IA (columns, indexes, `ON DELETE CASCADE`).
    Write a `test-db.js` migration test. Extend `db.js`'s v11 trap comment to name `rentals` too.
  - **`days.js` `lineDayProblem`** allows `dayId` on `prod`, `travel`, `crew` and `equip`.
    - `deliverableId` is refused outside `post`, and refused when it names no deliverable
      (`line_deliverable_unknown`).
    - Deliverable ids must be unique on the estimate.
  - **Rentals on the estimate routes:**
    - `GET` returns `rentals`.
    - `POST`/`PUT` replace them wholesale, inside the same transaction as days.
    - The write refuses `rental_vendor_duplicate` and bad dates or methods, and drops a rental whose
      vendor is on no equipment line.
  - **`GET /api/calendar`** adds `rentals` overlapping the range. A rental with one date is a
    one-day marker; one with no dates is left out.
  - **Duplicate route:** travel, crew and equip lines come off their days too (count them in
    `unbooked`). The copy gets **no rentals**, because it's a new project with no dates (D60).
    Deliverables, their tags and `capture` are copied as they are.
  - **PDF:** equipment prints `item || vendor`. A post line prints " · <deliverable name>" when its
    `deliverableId` resolves. `daysWithItems` stays `prod`-only (D85).
  - **Tests:**
    - an estimate saved before B2 totals identically, through the route and `computeTotals`;
    - the round trip of every new field;
    - each refusal code.

  **Done when** `npm test` is green with the new tests, and a raw-API save of travel, crew and equip
  on days plus two rentals round-trips and shows on `/api/calendar`.

  **Done note (2026-10-03).** `npm test` 396/396 (was 387). `calc.js` copies identical.
  - **What exists now:**
    - **Migration v12:** the `rentals` table, as the IA has it, with CHECKs on the two methods and
      the three indexes. The v11 trap comment in `db.js` now names rentals too, and v12 repeats it.
    - **New `src/rentals.js`**, modelled on `days.js`: `parseRentals`, `rentalsWithGear` (the
      vendor match, trimmed and case-insensitive), `rentalIdTakenElsewhere`, `replaceRentals`,
      and the readers.
    - **`days.js`:** `ON_SET_KEYS` (`prod`, `travel`, `crew`, `equip`) for `lineDayProblem`, plus
      a new `lineDeliverableProblem`.
    - **The estimate routes:**
      - `GET` (one and list) returns `rentals`.
      - `POST`/`PUT` replace them in the same transaction as days.
      - **A PUT without `rentals` keeps the stored ones**, as days do. Either way, a rental
        whose vendor is on none of the equipment lines being saved is dropped. The editor
        doesn't send rentals until B2-7, so its saves keep them.
    - **`GET /api/calendar`** returns `rentals` overlapping the range, both ends inclusive.
      - A one-date rental is a marker on that date; one with no dates is left out.
      - Ordered by start date, then UPID.
      - Day tiles' `items` stay production only.
    - **Duplicate:** it already took every line off its day, so travel, crew and equip now count
      in `unbooked` with no code change. The copy gets no rentals. Its comment is updated.
    - **PDF:**
      - equipment prints `item || vendor` (a blank Item falls back);
      - a post line prints " · <deliverable>" from the deliverable's current name, and nothing
        when the id resolves to nothing or to a blank name;
      - `daysWithItems` is unchanged (production only).
    - **Cost Breakdown:** `calc.js` `costBreakdown` names equipment by `item || vendor` too. That
      closes B2-1's seam.
  - **Refusal codes** (all 400):
    - **Rentals:**
      - `rentals_not_a_list`, `too_many_rentals` (>100), `rental_invalid`;
      - `rental_id_invalid`, `rental_id_duplicate`, `rental_id_taken`;
      - `rental_vendor_duplicate`, `rental_vendor_too_long` (>200);
      - `rental_date_invalid`, `rental_dates_reversed` (back before out);
      - `rental_method_invalid`, `rental_note_too_long` (>500).
    - **Deliverables:** `deliverable_id_invalid` (the day-id pattern), `deliverable_id_duplicate`,
      `deliverable_on_non_post_line`, `line_deliverable_unknown`.
    - **`day_on_non_production_line` keeps its name.** It now means "not an on-set line"
      (`preprod`, `post`, `additional`, `deliverables`).
  - **Tests:**
    - **`test-db.js`:** the v12 upgrade, re-run, CHECKs and cascade. The v11 tests count to
      `LATEST_VERSION`.
    - **`test-api.js`:** 5 new tests:
      - the full round trip on days with two rentals, priced unsurcharged, on the calendar,
        kept, dropped, removed and cascaded;
      - a pre-B2 estimate re-saving at the same totals;
      - every refusal;
      - one-date and no-date rentals;
      - the duplicate (`unbooked` 8, no rentals, deliverables, tags and capture copied).
    - **`test-pdf.js`:** 3 new tests: Item vs old text (and the Cost Breakdown), tags with rename
      and unresolved, and on-set extras kept out of Production Days.
  - **Mutations, each failing a test:**
    - **Day and deliverable rules:** `dayId` allowed on `post`; refused on `equip`;
      `deliverableId` allowed outside post; unknown deliverable allowed; duplicate deliverable ids
      allowed.
    - **Rentals:**
      - the vendor duplicate check made case-sensitive;
      - vendor-less rentals kept (rentals with no gear left, or a blank-vendor rental beside a
        blank-vendor line — the latter caught only after its own test was added);
      - reversed dates allowed;
      - a PUT without rentals wiping them;
      - the vendor match skipped;
      - a PUT not storing them.
    - **Calendar:** the back date exclusive; one-date rentals dropped.
    - **PDF:** vendor printed instead of the Item; the tag dropped; the Cost Breakdown naming by
      vendor.
    - **One harness note:** the first mutation run hung inside `npm test` on "deliverableId
      allowed outside post". Re-run alone, the same mutation fails cleanly, so the later runs
      were wrapped in an alarm.
  - **Raw API against `api-scratch`** (migrated to v12, "migrated to v12 — gear rentals" in the
    boot log):
    - travel, crew and equip on two days plus two rentals round-tripped;
    - the calendar showed Lensworks 13→16 Nov and Grip Co as a one-date marker;
    - the surcharge was $560 of $2,890, production only;
    - the delete cascaded.
    - The test estimate was deleted.
  - **Interpretations to show the user:**
    1. **A PUT without `rentals` keeps them**, as days do. Orphaned rentals are still dropped.
    2. **A rental with no vendor is dropped, not refused.** It can't join any line.
    3. **A rental whose back date is before its out date is refused** (`rental_dates_reversed`).
       The brief only said "bad dates".
    4. **A deliverable with a blank name prints no tag** on its post lines.
  - **Seams for later tasks:**
    - **B2-4/B2-7:** the editor has no wording for the new refusal codes. It shows
      `err.message`, and the server sends none for them. Map them where the editor first sends
      rentals or tags.
    - **B2-10:** the editor should drop a tag whose deliverable is gone before saving, or the
      save is refused with `line_deliverable_unknown`.

- [x] **B2-3. Deliverables block: moved, restyled, typed; the Prices bar moved** (frontend —
  Opus/high). _Depends on: B2-1._ This is the first visible B2 slice, to confirm the look early.
  **Done 2026-10-03, committed `51b3a80`.**
  - **Placement:** Deliverables moves above the booking block, and the Prices bar moves above
    Deliverables (D98).
  - **The treatment (D86):** the Total box's tint (`rgba(184,84,68,.08)` fill, a stronger accent
    border at 2px) and a larger Delight heading, in additive CSS. Check text contrast on the tint
    (≥4.5:1).
  - **Columns:** Type ▾ · Name · Format · Length · Qty · Post hrs (rec.) · ×.
    - Type lists the card's `deliverableTypes` alphabetically, after "— None —".
    - Each deliverable gets a browser-made `id`, assigned on load to old rows that lack one.
    - Picking a type prefills a blank Name and snapshots `typeId`/`typeName`/`multiplier`.
    - *Adding post lines is B2-10.*
    - Post hrs shows "—" until B2-10.
  - **Phones:** stacked `data-label` rows, as the other tables.

  **Done when** an old estimate opens with its deliverables intact and unsaved-clean; the Type
  saves and reloads; and nothing outside the moved blocks shifts at 1280 except by the blocks' own
  height change. _Reuses: `.billing-block`, the deliverable row builder._

  **Done note (2026-10-03).** Changed only `estimate-editor.js` and `estimates.css`; no server
  change (396/396 unchanged).
  - **Order:** document-type bar → Prices bar → Deliverables → booking block → the sections.
    The rest of D98's order (Post-Production before the "On set, by day" summaries) is B2-5's.
  - **Rows:** `buildDeliverableRow` makes Type ▾ · Name · Format · Length · Qty · Post hrs (rec.) ·
    ×, with phone `data-label`s.
    - **Each row's id** is `dv` plus a random UUID. A row saved without one gets one when
      it's built, which is before the baseline, so an old estimate opens unsaved-clean
      (verified).
    - **Picking a type** snapshots `typeId`/`typeName`/`multiplier` onto the row, and its name
      fills a blank Name. "— None —" clears it. `collect()` writes the snapshot only on typed
      rows.
    - **Post hrs (rec.)** is a `.deliv-rec` cell showing "—", for B2-10.
  - **Look (`estimates.css`, additive):**
    - `.deliv-block`: a 2px border at `rgba(184,84,68,.6)`, the `.08` fill, a `.14` head and a
      15px Delight label.
    - `.deliv-grid.deliv-typed`: `150px 2.4fr 1fr 1fr 70px 116px 32px`. The read-only screens'
      `.deliv-grid` is untouched.
    - `.deliv-type-sel`: the `.lab-unit-sel` chrome, 44px tall on phones.
  - **Measured:**
    - **1280:** the doc-type bar, Prices bar (47.5), booking block (739) and every block below
      kept their heights. Everything after the booking block moved down by exactly the
      Deliverables block's own change (142 → 150 for two rows: the border, head padding and
      larger heading).
    - **800:** columns 150/199/83/83/70/116/32, no scroll inside the block, no page overflow.
    - **375:** stacked rows with all six labels, every control 44px, the select at 16px, no
      page overflow.
    - **Contrast on the tint:** text ≥ 12:1, and `--muted` (a11y.css 0.6) ≥ 5.4:1 on the
      block, head and row hover.
  - **In the browser against `api-scratch`:**
    - an estimate saved in the old shape ("B2-3 old shape", two untyped deliverables, no ids)
      opened clean;
    - Brand Story on a named row kept its name, and Socials on a blank row filled it;
    - the save stored ids and snapshots;
    - **after the card changed** (Brand Story ×2 → ×3, Socials removed), it reopened clean,
      with Brand Story still ×2 and Socials shown as "Socials (removed)";
    - None → Socials restored its snapshot and left the form clean.
    - That estimate and a one-type card (Brand Story ×3) are left on `api-scratch` for B2-10.
  - **Interpretations to show the user:**
    1. **A type removed from the Rate Card stays on the row** as "<name> (removed)", with its
       saved multiplier. A tooltip says why.
    2. **Re-picking the same type keeps the saved multiplier.** To take the card's new one, pick
       "— None —" and then the type. Whether "Update to current rates" should refresh it is open
       for B2-10.
    3. **On phones, Type is the first (full-width) field** of each stacked row, as the IA's
       column order has it.
  - **Seams for later tasks:**
    - **B2-10:** the multiplier refresh above. The detail screen shows no type yet; add it with
      the tag.
    - **Equipment's `item` and `dayId` on travel, crew and equip** are still dropped by
      `collect()`. That's B2-4 and B2-7.

- [x] **B2-4. The service menu, and every on-set kind on a day** (money math — Opus/high, because
  production lines price live). _Depends on: B2-2._ This is the riskiest slice.
  **Done 2026-10-03, uncommitted.**
  - **The button:** "Add Production Service Items" on each day card ("Add items" on Not on a day)
    replaces the card's service → unit → Add picker.
  - **The menu (≥768):** it swaps in for the calendar in its column. It has the head "Adding to
    <day>" + Done, and four disclosure groups:
    - **Production** (open): rows with unit buttons and muted prices;
    - **Travel**: rows with Add;
    - **External Crew**: "+ Add crew member";
    - **Equipment Hire**: "+ Add hire item".
    A running "N added" count shows. Done or Escape returns the calendar with focus on the
    trigger, and another card's button retargets it. A filter field appears when there are more
    than 12 Production rows.
  - **Below 768:** the menu is a `Modal` bottom sheet with 44px targets and a sticky Done.
  - **Day cards** hold line groups (Production · Travel · Crew · Equipment, each shown only with
    lines) and a day total over everything on the day. Travel, crew and equip rows read their
    `dayId` from their card, as `prod` rows already do. `itemsFor(dayId)` becomes per kind. The
    move-not-rebuild rule holds for every group.
  - **The "Not on a day" card** comes last. On open, old unassigned `prod` lines and every travel,
    crew and equip line without a `dayId` are placed there. Production lines in it price as
    unassigned lines do today.
  - **Each add is announced politely.** Vehicle per km arrives focused at 0 km. Crew focuses Role,
    and equipment focuses Vendor (still the old single field until B2-7).
  - **Reaching the old flat sections:** the Travel, Crew and Equipment sections' own add buttons go
    away. Their lines now live in cards. *The read-only summaries are B2-6*, so until then those
    sections render empty heads. That's fine on the branch, but not deployable.

  **Done when:**
  - a day holds all four kinds;
  - totals match the server to the cent on save (including a surcharged production line next to an
    unsurcharged travel line on a Saturday);
  - an old estimate opens with everything in Not on a day, at its stored total, unsaved-clean;
  - nothing above the booking block moves at 1280.

  _Reuses: `BookingBlock`, the labour row and cost row builders, `Modal`._

  **Done note (2026-10-03).** Changed `estimate-editor.js`, `booking-block.js`, `booking.css` and
  `index.html` (one overlay, `#modal-day-menu`). No server change; 396/396.
  - **The booking block:**
    - **Not on a day** is a static last card (`#booking-off`), never in `payloadDays()`. It's
      filled once from `opts.offItems()`, under the key `BookingBlock.OFF`.
    - **Editor hooks:** `menuHost()` (the calendar's column), `setTarget(id)` (the card's
      accent edge, kept across repaints), `showOff()`, and `opts.onToggle`.
    - **Removing a day** now says "Its N items are removed too", counting every kind.
    - **`opts.hasItems`** opens the block when any on-set line exists, not just production:
      those lines live in it now.
  - **The day panel** (`panelFor`) is now "Add Production Service Items" ("Add items" on Not on
    a day), the day total, a "Nothing on this day yet." line, then four `.day-group`s
    (Production · Travel · Crew · Equipment), each with its section's column heads and shown
    only with lines. Then D26's hours hint.
  - **Rows:** travel, crew and equip rows carry `data-kind` (travel keeps no `data-section`, which
    the rates code reads as "travel"). `rowsIn` finds them anywhere on the page. `rowDayId`
    reads any on-set row's card, and `collect()` writes `dayId` on crew and equip as `lineFrom`
    does on travel.
  - **The service menu** (`openMenu`/`closeMenu`/`addFromMenu`):
    - **≥768:** a labelled `<section>` in the calendar's column. `.is-menu` hides the calendar.
    - **<768:** inside `#modal-day-menu`, a bottom sheet with `LSCModal.trapTab`, a sticky
      head and 44px targets.
    - **Contents:** the four disclosure groups (Production open), unit buttons with muted prices
      from `unitSnap`, disabled with what they need, an "N added" count and a `role=status`
      line ("Added Video Capture — Full Day."), plus the filter past 12 Production rows.
    - **Closing:** Done, Escape, or the card's button again close it, with focus back on the
      button. Another card's button retargets it. Folding the block, or the target day going,
      closes it.
  - **Adds:**
    - Production at qty 1; travel at 1;
    - the car per km at 0 km, focused on its kilometres;
    - crew and gear empty, focused on Role or Vendor;
    - a production line on Not on a day gets the "Pick a day…" select.
  - **Production section:** its "Unassigned — pick a day" group is gone (those lines are on Not
    on a day), and "Add to a day" opens that day's menu. Its per-day list shows production totals
    only.
  - **Travel, Crew and Equipment sections:** each is a head and subtotal with a one-line note
    (`.onset-block`). Their own add buttons are gone, so **this is not deployable until B2-6.**
  - **Card totals:** `recalc` tallies every line per card: production at its stamped price, the
    rest as billed. "Day total" is everything on the card.
  - **Also:** `.day-menu` and `.day-card` got `scroll-margin-top: 64px`, so scrolling into
    view clears the 52px sticky page header (it hid the menu's head at 800).
  - **In the browser against `api-scratch`:**
    - **An old estimate** ("B2-4 old flat": production, post, two travel lines, crew and gear,
      none on a day) opened with everything on Not on a day: the card total was $2,155, the
      page total matched the stored $2,659, and the form was unsaved-clean.
    - **A Saturday 6–11pm day** got Video Capture Day ($2,400 at weekend ×1.5), Crew Meals,
      a Gaffer and Lensworks gear through the menu, for a day total of $3,330.
    - **The save matched the server to the cent:** total $5,989, tax $1,302.56, take-home
      $2,419.04. The surcharge was $800, production only.
    - **It reopened clean** with every line on its card.
    - **Per km** (scratch Overhead set to $0.92/km) arrived focused, and 80 km came to $73.60.
    - **Short notice on:** the surcharge was $4,320 (both production lines), expenses stayed
      $2,038.60, and the screen and server agreed on $9,582.60.
    - **Retarget, Escape, the toggle, "Add to a day" and the remove question** all checked.
    - **The filter** was tested with 8 temporary services; the card was put back after.
  - **Measured:**
    - **1280:** everything above the booking block is where B2-3 left it (doc-type bar 686,
      Prices 755, Deliverables 824.5+186, booking from 1022.5).
    - **800:** the menu spans the column above the cards and scrolls to 64px.
    - **375:** the sheet is 375 wide, focus goes to its heading, Tab wraps, and Done, the group
      heads and unit buttons are 44px. A production add updates the card behind; a crew add
      closes the sheet and focuses Role. No page overflow.
    - **Console:** clean, apart from one connection error from an earlier `api-scratch` restart.
  - **Interpretations to show the user:**
    1. **On a phone, adding a crew member, a hire item or the car per km closes the sheet** and
       focuses the field, since it can't be typed in behind the sheet. Production and other
       travel adds keep it open.
    2. **Every Production service shows all three unit buttons** (Hr · ½ Day · Day), as the old
       picker listed all three units; one with no price is disabled and says what it needs.
    3. **Crew and gear rows arrive empty**, with no default of 1 day.
    4. **Not on a day always shows** while the block is open, even when it's empty.
    5. **The day total counts everything on the card**, but the hours hint and the Production
       section's per-day list stay production only.
  - **Seams for later tasks:**
    - **B2-5:** a travel, crew or gear line on Not on a day has no way onto a day yet except
      removing and re-adding it. Move to fixes that. The "Pick a day…" select on production
      lines is the one to replace.
    - **B2-6:** fill the head-only Travel, Crew and Equipment sections.
    - **B2-7:** equipment is still the single "Vendor / Item" field.
    - **B2-12:** resizing across 768 with the menu open keeps its mode until reopened.
      Escape at ≥768 only acts with focus inside the menu.
    - **Scratch data:** "B2-4 old flat" now has a Saturday 10 Oct day. The scratch goals have
      `vehicleCostPerKm` 0.92, and the scratch card has a "Vehicle — per km" row.

- [ ] **B2-5. Moving lines: drag, Move to, Duplicate day** (money math — Opus/high, because a move
  re-prices). _Depends on: B2-4._
  - **Drag (mouse and pen, pointer events):** a handle `<button>` on each line. Drop targets are
    the same kind's group on any card, and Not on a day. A drop rule shows the insert point.
    Dropping in its own card reorders. There's no handle below 768.
  - **Move to ▾** on every line (the handle button opens it for keyboard users), listing the days
    by title, then "Not on a day". Focus follows the line.
  - **Either way:** quantity, unit, override and both rate marks are kept. The price re-prices for
    the new day, and the announcement says the line, the day, the new price and the surcharge. This
    overturns task 7's one-way move (D80).
  - **Duplicate day:** a new Date TBC day (Proposed) after the source, copying every line, with
    production re-priced as TBC. Equipment copies keep their vendor. Focus goes to the new card's
    date.

  **Done when:**
  - a Video Capture Full Day dragged Sat → Mon goes $1,680 → $1,120, and back again;
  - saved totals equal the server's;
  - Move to works from the keyboard alone;
  - Duplicate then date gives the weekend price;
  - mutations: keeping the old day's surcharge on move is caught by a figure check.

- [ ] **B2-6. "On set, by day": the four read-only summaries, and the editor order** (money math —
  Opus/high, because it renders day totals). _Depends on: B2-4._
  - **One builder for four summaries** (Production, Travel, External Crew & Contracts, Equipment
    Hire). Each has:
    - groups per day in card order (title, status chip, lines, group total, "Edit on the day ↑"
      focusing the card);
    - Date TBC days, then "Not on a day";
    - the subtotal;
    - "Add to a day ▾" opening that day's menu at the category.
    An empty summary shows "Nothing on set yet." It replaces task 7's Production day list and its
    Unassigned group.
  - **The order (D98):** Pre-Production → Post-Production → Additional work → the "On set, by day"
    divider → the four summaries → summary area.

  **Done when** each summary's subtotal equals the matching figure in `computeTotals`, legacy
  estimates show one "Not on a day" group per summary, and the order matches D98 at 1280, 800 and
  375.

- [ ] **B2-7. Gear rentals** (frontend — Opus/high). _Depends on: B2-4._
  - **Equipment rows:** split into **Vendor** (a typeahead from this estimate's vendors) and
    **Item**. Old lines show their `vendor` text as the Item, with Vendor blank (confirmed
    2026-10-03).
  - **The Gear rentals panel**, under both columns, has one row per vendor (trimmed,
    case-insensitive): vendor, item count (names in an ⓘ), Out date + Pickup/Postage, Back date +
    Return/Postage, Note.
    - A new vendor adds a row, and the line hints "Add pickup and return dates ↓".
    - Renaming a vendor's only item renames the rental, and a rental with no items goes.
    - With no equipment: "Gear you hire shows here, grouped by vendor."
  - **Saving:** `payload()` sends `rentals`, the unsaved guard covers them, and they round-trip.
  - **The collapsed head** adds "· N rentals" and "· N off-day lines".
  - **The estimate detail** shows Item (and the vendor, muted) in Equipment.

  **Done when** two vendors across two days make two rentals, dates save and reload, emptying a
  vendor removes its rental, and an old estimate is unchanged.

- [ ] **B2-8. Rental bars on the calendar** (frontend — Opus/high). _Depends on: B2-2, B2-7. A
  change to the shared `web/js/calendar.js`._
  - **A bar layer** spanning out → back across week rows, labelled vendor · UPID. A one-date
    rental is a one-day marker. Other estimates' bars are faded, and this estimate's come from live
    editor state (as its days do).
  - **Dots mode** draws a thin bar under each covered date. The selected date's list (the keyboard
    and phone route) gains its rentals.
  - **Clicking this estimate's bar** focuses its rental row. Clicking another's names it (UPID,
    vendor, dates). No clash rules (D84).
  - **Task 12 (Home)** must draw them too. Add that line to task 12 when this lands.

  **Done when** bars draw correctly across a month boundary and a week wrap, at 1280 and 375,
  against a second scratch project's rental.

- [ ] **B2-9. Rate Card: the Capture tick and Deliverable Types** (frontend — Opus/high).
  _Depends on: B2-1._
  - **Capture:** a column beside Custom on `prod` rows only, with an ⓘ in its head. It's saved with
    the card and the existing outdated-card guard still holds.
  - **The Deliverable Types block,** after Travel and before Surcharges, saved by "Save Services".
    Rows have:
    - Name and Description;
    - Post services as chips: "+ Add" is a select of Post-Production rows, × removes a chip, and a
      service no longer on the card shows struck through as "missing";
    - Multiplier "[ N ] × 1 capture hour" (step 0.25, 2 dp, ≥ 0);
    - ×.
    "+ Add Deliverable Type" sits underneath, with an empty state. Validation goes through
    `LSCUtil.showFieldErrors`.
  - **Reset Defaults** clears types only after its existing confirm.

  **Done when** types and capture ticks save and reload, an old build is refused by the shape
  guard, and nothing in the existing tables moves at ≥1100 except the new column (Desktop
  Preservation Law, the brief's exception).

- [ ] **B2-10. The post-production planner in the editor** (money math — Opus/high). _Depends on:
  B2-1, B2-3, B2-9._
  - **Picking a type** adds its post services to Post-Production at 0 hrs, each carrying
    `deliverableId`. A missing service is skipped with a toast naming it.
  - **Changing the type or removing the deliverable** removes its tagged lines, with a confirm
    naming the count when any has hours.
  - **Tags:** a tagged line shows a "· <deliverable name>" chip that follows renames. A tag whose
    deliverable is gone is dropped on save.
  - **The planner cell** heads Post-Production: [Production Capture Hours N] [Recommended Post
    Production Hours N], and "On post lines: X of Y recommended". It's hidden with no capture hours
    and no typed deliverables. Each deliverable's row shows its share. All of it comes from
    `postPlan`, live.
  - **Capture snapshot:** a `prod` line added from the menu takes `capture` from its card row.
  - **Elsewhere:** the detail screen shows the tag. The client PDF's tag is checked (B2-2). Lines at
    0 hrs stay off documents.

  **Done when:**
  - the brief's worked example reproduces in the browser (10 capture → 35, then 20 → 70 after
    Duplicate day);
  - a rename follows to the PDF;
  - an untyped deliverable adds nothing;
  - mutations: rounding down, qty ignored.

- [ ] **B2-11. The surcharge box and the Totals row** (money math — Opus/high). _Independent of
  B2-4 to B2-10; can be built any time after B2-2._
  - **The box** replaces `#sur-line`. Its rows come from `calc.js` `costBreakdown()` surcharge
    entries (day, kind, multiplier, hours covered, $, carry-overs), then the total and "already
    folded into each production line's price". The ⓘ text carries over.
    - With days but no surcharge: "No surcharges apply." With no days: hidden.
  - **The Totals row:** the figures step up in Delight, with Total (inc GST) the largest. The
    take-home sentence moves into an `LSCInfo` ⓘ on its label, which opens on hover.

  **Done when** the box's rows sum to `surchargeTotal` and match the Cost Breakdown PDF for Audit A
  to the cent, all three states show, and the larger figures fit at 375 without overflow.

- [ ] **B2-12. B2 responsive and accessibility pass** (frontend — Opus/high). Breakpoints 1280,
  800, 375. _Depends on: B2-3 to B2-11._
  - **Check and fix:**
    - the menu's swap at ≥768 and its sheet at <768;
    - no drag handle on touch;
    - Move to as the full alternative (WCAG 2.5.7);
    - focus on open, close, move and duplicate;
    - every announcement;
    - targets ≥44px under 768;
    - the tint's contrast;
    - reduced motion (the swap and the drop);
    - no document overflow;
    - nothing moved at 1280 outside B2's blocks.
  - **Record** the measurements in its Done note. A real VoiceOver pass stays for a person.

- [ ] **B2-13. Deploy B2** (deploy — Sonnet/medium). **Ask first.** NAS before Pages:
  1. back up;
  2. NAS v12 (check the boot log);
  3. check that `/api/calendar` returns `rentals`;
  4. Pages.

  `PRICING_SHAPE` changes, so Pages must not go before NAS. After deploy, the user ticks Capture on
  their real capture services and adds their Deliverable Types.

## Stage C — Home: the production calendar (no migration)

- [ ] **11. Hash router** (frontend — Opus/high). _New `web/js/router.js`._ The foundation for C
  and everything after it (D59).
  - **Routes:** `#/home`, `#/estimates` (renamed `#/projects` in task 17), `#/estimates/<id>`,
    `#/clients[/<id>]`, `#/finance[/<tab>]`.
  - **The router drives `setNav`**, and `hashchange` runs `LSCUnsaved.confirmLeave()`. A refusal
    restores the old hash without re-rendering.
  - **Sign-in and reload:** a signed-out visit goes on to the requested route after sign-in, and
    reload keeps your place.
  - **Odd states:** an unknown route goes to Home with a toast; a deleted id says so in place.
  - **Modals:** Back closes an open modal first.
  - **Existing screens:** every one keeps working, and their own click handlers now set the hash
    rather than mounting directly.

  **Done when** Back and Forward, reload and deep links work across every screen, the unsaved guard
  still catches every exit, and nothing moves at 1280.

- [ ] **12. Home screen** (frontend — Opus/high). _Depends on: 5, 11._ `#/home` becomes the landing
  route and the logo goes there (D27).
  - **The calendar** in month and week views (week: tiles at their times, untimed ones at the
    top), with all estimates' days equal.
  - **A tile pop-up** (`Modal`): UPID, project, business, times, production items, "Open project".
    Until stage D that opens the estimate.
  - **"Coming up"**: the next 14 days, all three statuses, labelled.
  - **Phones:** dots plus a tapped-date list, and the week view as a list (D29).
  - **Rental bars** (D84, from B2-8): all estimates' bars at equal strength, in month view; in
    week view, as a strip above the untimed tiles.

  **Done when** it's verified against the scratch DB with days across two months and three
  statuses.

- [ ] **13. C polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium).
  - The accessibility pass on Home (the keyboard grid, pop-up focus return) and responsive checks.
  - Then Pages only: no migration, but Pages must go after NAS v11.

## Stage D — Projects and invoices (migration v13)

- [ ] **14. Invoice maths** (money math — Opus/high). _Pure functions in both `calc.js` copies._
  - `depositAmount(estimateTotals, pct)`: on the total inc GST, `round2`, with GST split
    proportionally so the deposit's GST plus its ex-GST equals its total to the cent.
  - `finalInvoiceTotals(snapshot, extras, deposit)`: the snapshot plus extras priced through
    `computeTotals`, then "less deposit", then the balance due.
  - `singleInvoiceTotals(snapshot, extras)`.
  - `averageJobValue`'s won set becomes `accepted` (with legacy `approved` / `invoiced` / `paid`
    still read, for rows not yet migrated).

  **Done when**: worked examples are pinned on a $5,000 estimate at 50% (deposit $2,500; final
  with $420 of Overtime extras = $5,420 − $2,500 = $2,920 due), on GST-registered and unregistered
  cards; 30% and 0% deposits are handled; the deposit and the final's balance add up to estimate
  plus extras exactly. Mutations: pct as a whole number, deposit not subtracted, extras skipped, GST
  split rounding.

- [ ] **15. Schema v13: projects, statuses, invoices, activity** (money math — Opus/high).
  _Depends on: 14._
  - **`projects`** (IA Data Model). One per distinct non-blank UPID; shared or blank UPIDs become
    projects with `upid` NULL and `needs_upid` (D61). Also `estimates.project_id`.
  - **An `estimates` rebuild** for the status CHECK: draft / sent / accepted / declined.
    `approved` maps to accepted; `invoiced` and `paid` map to accepted plus a **legacy invoice**.
  - **`invoices`, `activity`.** Rows with `doc_type = 'invoice'` yield a `legacy` invoice carrying
    their number (D62).
  - **The estimate write routes** keep `estimates.upid` in sync with the project, and refuse a
    UPID already used by another project (`upid_taken`).

  **Done when** migration tests on fixtures cover: unique UPIDs; two sharing one; a blank one; an
  `invoice`-typed row; and an `approved` row, each landing as specified. Every existing estimate's
  totals are byte-identical after the migration, and a re-run is a no-op.

- [ ] **16. The UPID fix-up screen and Duplicate** (frontend — Opus/high).
  _Depends on: 11, 15._
  - **`#/setup/upids`** lists groups (estimates with name, date and total). Per estimate, the user
    types a new UPID; per group, they can choose "Keep together". It uses `GET/POST
    /api/setup/upids`.
  - **A banner on the list** while any are left, which disappears with the route when none remain
    (D61).
  - **Duplicate creates a new draft with no UPID** (focused) and no days, and refuses to save until
    the UPID is unique (D60).

  **Done when** it's verified against a scratch DB seeded with a duplicate pair and a blank UPID.

- [ ] **17. The Projects list** (frontend — Opus/high). _Depends on: 15._
  - The nav item and route become **Projects** (`#/projects`), and the list shows **one card per
    project** (D58).
  - **A stage line** from one shared function, for example "Sent v2 · valid until 14 Oct" or
    "Deposit paid · final not sent". Before stage E, "Sent" is set by the owner (task 18).
  - **Search and stage chips**, with `?stage=` and `?q=` in the hash, and "Show more" after 50.
  - **The Clients screen's history** lists projects using the same card.

  **Done when** the stage line reads the same on the card, the folder and the client.

- [ ] **18. The project folder** (frontend — Opus/high). _Depends on: 17._
  - **`#/projects/<id>`**: Overview (UPID, name, client, stage line, the **one next action**), a
    compact Production days list, Documents, and Activity (IA Content Hierarchy).
  - **Actions:**
    - Mark sent: a Stage-D stopgap, which records the date and is replaced by sending in E.
    - Decline / Reopen: days leave and return to calendars; Reopen re-runs the clash check (D22).
    - Duplicate as new project; Delete.
  - **The editor moves** under `#/projects/<id>/estimate`, and Back returns to the folder.
  - **D62:** the doc-type select and invoice-number field are removed from the editor.
  - Calendar tiles now open the folder.

  **Done when** every action round-trips, a declined project disappears from Home and the editor
  calendar, and nothing else in the editor moves at 1280.

- [ ] **19. Accepting, and creating invoices** (money math — Opus/high). _Depends on: 14, 18._
  - **`POST /api/projects/:id/accept`**, in one transaction:
    - sets accepted;
    - confirms every dated day and flags any clash "clash, rebook" (D18);
    - creates the pair or single invoice (D32) at the project's deposit % (D33, copied from
      settings);
    - logs activity.

    It is idempotent.
  - **The folder's "Mark accepted"** asks Pair or Single (and lets the deposit % be changed for this
    project).
  - **`POST /api/projects/:id/invoices`** handles a project accepted before this existed.
  - Numbers are `INV-<UPID>-D` / `-F` / `INV-<UPID>` (D36), and the UPID locks at that point.

  **Done when** tests cover:
  - the transaction rolling back whole on a failure;
  - a double accept;
  - a clash flag;
  - the numbers;
  - the amounts matching task 14 exactly.

- [ ] **20. The invoice screen and invoice PDFs** (money math — Opus/high). _Depends on: 19._
  - **`#/projects/<id>/invoices/<invoiceId>`:**
    - **The deposit** is a fixed summary (D37).
    - **The final** shows the accepted estimate read-only, then an editable **Extras** block
      (Additional work services through the existing picker), less deposit, and the balance due
      (D35). It's editable until sent.
    - **Mark paid** takes a date and method.
    - **A legacy invoice** is read-only, marked "made the old way".
  - **PDFs** for deposit, final and single invoices (the existing invoice PDF's header and payment
    block), plus a Cost Breakdown per invoice (D8).

  **Done when** `test-pdf.js` pins each kind's amounts and wording and the final's "Less deposit
  paid (INV-…-D)". In the browser: add $420 of Overtime to a final invoice, save, reload, and the
  PDF matches.

- [ ] **21. The Settings screen** (frontend — Opus/high). _Depends on: 11._
  - **Invoice Settings becomes `#/settings`** (D65), with sections Business, Payment, Estimates &
    invoices, Service agreement, Email and Card payments (a rail at ≥1100px, a jump list on
    phones). The existing fields move over unchanged.
  - **New fields:**
    - deposit % (default 50, D33);
    - valid-for days (default 30, D44);
    - the four default messages (D43);
    - the service agreement text area, with a fill-in field list and "Preview with a project…"
      (D39);
    - the FAQ URL (default `https://lsccreative.studio/faq.html`, D55).
  - **Email and Card payments** read "Not set up yet" until stage E.
  - **The nav item** becomes "Settings", and the modal and its focus-trap use are retired.

  **Done when** every old setting round-trips unchanged, and the preview fills `{client_business}`
  and the others from a real project.

- [ ] **22. Recent activity on Home** (frontend — Opus/high). _Depends on: 12, 19._ The last 10
  events (sent, accepted, declined, invoice created, paid), each linking to its project (D52).

- [ ] **23. D polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium).
  - **Accessibility:** the folder, Projects, Settings and fix-up screens.
  - **Responsive:** 1280, 800 and 375.
  - **Deploy:** ask first, then NAS v13 (back up first; read the boot log's project counts and
    `needs_upid` count), then Pages.
  - **The user** then runs the fix-up if the banner shows.

## Stage E — Client pages, signing, sending and payment (migration v14)

**Inputs needed from the user before tasks 27–31 can be finished:**

- the service agreement text (D39);
- a Google Workspace app password, set in the NAS `.env`;
- a Stripe account and keys, plus the webhook secret.

Tasks 24–26 can be built with placeholders.

- [ ] **24. The client page shell, in the light brand** (frontend — Opus/high). _New `web/c/`
  (`index.html`, `c.css`, `c.js`)._
  - **This task sets the client-facing aesthetic, so the user validates it before anything is wired
    to it.** It's a Swiss/editorial document on warm paper (D54):
    - colours `--lsc-white` / `--lsc-surface-lt` / `--lsc-black` / `--lsc-terra` /
      `--lsc-terra-dk`;
    - Delight headings;
    - CS Felice Mono for labels and figures. Copy only `CSFeliceMono-Regular.woff2` from the
      git-ignored `Visual Design/` into `web/fonts/` (D57).
  - **Content:** the wordmark "LSC *Creative*.", a single column (≤680px), tabular figures, rules as
    structure, 8px radii.
  - **Rendered from a static fixture** (an estimate with three days and a proposed day), with the
    "we" voice (D56).

  **Done when** the user has seen it at 375 and 1280 and said yes, contrast is verified for every
  text pairing, and nothing from the app's CSS is loaded.

- [ ] **25. Sent versions and the public estimate route** (auth/security — Opus/high).
  _Depends on: 19, 24._
  - **Migration v14:**
    - `estimate_versions`;
    - `estimates.public_token`;
    - `signatures` (with `pdf_blob`, D66);
    - `sends`;
    - `payments`;
    - `invoices.public_token`.
  - **Sending freezes vN** (D34): the full snapshot with surcharge-folded client lines, client
    totals and valid-until (D44). The previous version is superseded.
  - **`/public/*` is mounted before `requireAuth`**, with CORS for the Pages origin without
    credentials, and a per-IP rate limit.
  - **`GET /public/estimates/:token`** goes through a **dedicated serializer**. Its `state` is
    computed live: `open` | `taken` (any proposed day now confirmed elsewhere, D41) | `expired`
    | `superseded` | `declined` | `accepted`. It includes `unavailableDays`. Also `GET
    /public/estimates/:token/pdf`.
  - **The editor banner:** "Editing after v2 was sent…".

  **Done when** tests cover:
  - the **leak test** (Ground rules);
  - a wrong or short token getting 404 with no timing tell;
  - each state;
  - a re-send keeping the link;
  - rate limiting kicking in.

- [ ] **26. The client estimate page, wired** (frontend — Opus/high). _Depends on: 24, 25._
  - `c/#e/<token>` renders the version: days with status words, times and items; the disclaimer;
    totals; valid-until.
  - **Accept** shows only in `open`. Each other state shows its notice (brief, Key Interactions 6),
    and a taken day is marked "No longer available".
  - "Download PDF".
  - **No `localStorage`, no analytics.** Opening the page logs "opened" through the GET.

  **Done when** each state is checked in the browser against the scratch API, and the page stays a
  single column at 375.

- [ ] **27. Signing** (auth/security — Opus/high). _Depends on: 19, 26._
  - **The signing dialog** (full screen on phones):
    - the agreement filled from the client snapshot (D39), in a focusable, labelled scroll box;
    - "Service agreement FAQ" (D55);
    - full name, role, "I agree";
    - **Sign & submit**, disabled until all three are done (D40).
  - **`POST /public/estimates/:token/accept`:**
    - re-checks the state;
    - stores the signature: name, role, IP, user agent, time, version, exact text, sha256, and
      the rendered PDF as a blob (D66);
    - then runs **task 19's accept transaction**.

    It's idempotent per version, and refuses any state other than `open`.
  - **Afterwards:** a thank-you screen with "Download signed agreement", and the agreement shown in
    the project folder's Documents.

  **Done when** tests cover a race (two submits), a submit after the state changes to `taken`, the
  stored text matching what was shown, and the PDF opening. Placeholder agreement text is allowed
  until the user supplies theirs.

- [ ] **28. Email and the send queue** (backend — Sonnet/high). _Depends on: 25._
  - **`server/src/mail.js`:** `nodemailer` over smtp.gmail.com with `SMTP_USER` /
    `SMTP_APP_PASSWORD` from `.env` (D38). Never logged, never in the database.
  - **The `sends` queue and a one-minute scheduler.** A row is claimed (`sending`) in a
    transaction before the SMTP call. On boot, overdue rows go out and are marked `late` (D47).
  - **Templates:**
    - the estimate link and invoice links, with the user's message;
    - the owner's "accepted" notice, with a `#/projects/<id>` link;
    - the client's signed copy (the PDF attached).
  - **Settings → Email:** "Connected / Not set up", plus "Send a test email".

  **Done when** tests with a stubbed transport pin claiming (no double send across a simulated
  restart), late marking, cancel and edit, and that a failure is stored and shown, not swallowed.

- [ ] **29. The send panel** (frontend — Opus/high). _Depends on: 18, 28._
  - **The panel** (`Modal`), for an estimate or any invoice: send date and time (default now), the
    pre-filled message per kind, **Confirm to send**, and **Copy link** off to the side (D43).
  - **On the folder's document rows:** "Scheduled Tue 9:00 · Edit · Cancel", "Sent late at 11:42
    (scheduled 9:00)", and "Failed — retry".
  - **It replaces stage D's "Mark sent".** Sending an estimate is what freezes the version
    (task 25).

  **Done when** the panel schedules, edits, cancels and sends against the scratch API with a stub
  transport, and Copy link toasts.

- [ ] **30. The client invoice page** (frontend — Opus/high). _Depends on: 20, 24, 25._
  - **`GET /public/invoices/:token[/pdf]`**, through the serializer.
  - **`c/#i/<token>`:** the invoice by kind, amount due, bank details, "Download PDF", and "Paid
    on …" once paid (D46).

  **Done when** the leak test covers invoices too, and each kind renders correctly.

- [ ] **31. Stripe card payment** (auth/security + money — Opus/high). _Depends on: 30._
  - **A per-invoice "Card payment on/off"** in the invoice screen.
  - **`POST /public/invoices/:token/checkout`** creates a Checkout session for the amount due plus
    a **card surcharge line** (Settings %, D49). The client page states the surcharge before
    redirecting.
  - **`POST /hooks/stripe`:** verifies the signature (`STRIPE_WEBHOOK_SECRET`), then on
    `checkout.session.completed` marks the invoice paid (`paid_via: card`, `card_fee`) and logs
    activity. It's idempotent on the event id.
  - **The surcharge is a pass-through**, not income (D49).
  - **Settings → Card payments:** status, plus the % with its legal note.

  **Done when** tests with Stripe's signed test payloads cover a bad signature (refused), replay
  (no double pay), and amount plus fee correct to the cent. A test-mode payment completes against
  the scratch NAS through a tunnel or the Stripe CLI.

- [ ] **32. E polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium).
  - **Client pages, phone-first:** 16px body, 44px targets, Sign & submit reachable, reduced
    motion.
  - **Accessibility:** the signing dialog's focus and scroll box.
  - **Deploy (ask first):** add the `.env` secrets on the NAS; NAS v14; check the boot log and the
    scheduler; then Pages.
  - **An end-to-end run with the user:** send a real estimate to their own address, sign it,
    confirm the email, the invoices, the calendar and the signed PDF, then pay a deposit by card in
    test mode.

## Review

- [ ] **33. Money-math and security review, then design review** (review).
  - **A `/code-review` (xhigh) of the whole track's diff, Stage B2 included**, hunting for:
    - a field that prices but doesn't print, or the reverse;
    - a line saved before a change that now totals differently;
    - `calc.js` drift;
    - **any owner-only figure reachable from `/public/*`**;
    - a send that can go twice;
    - a signature that can be replayed.
  - **Then `/design-review`** against the brief, covering both surfaces.
  - List the fixes here under "Code review fixes" and "Design review fixes", as earlier tracks do.

## Not in this list (and why)

- **`estimate-accuracy` tasks 9, 10, 12–14** stay in that track and are un-grilled. When grilled,
  **10 (discount)** must say whether it applies before or after surcharges, and **12 (minimum
  call)** whether it applies per booked day.
- **The Client Hub integration** is out of scope (D53).
- **Post-production days on the calendar** (D97): a formula from the deliverables, deferred until
  after A–E by the user. Grill it then; `postPlan` is its input.
- **Removing the committed Delight `.woff2` from git history** is the user's call (D57), and a
  separate job.
