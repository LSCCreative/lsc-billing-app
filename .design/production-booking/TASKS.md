# Build Tasks: Production Booking

Generated from: [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md), [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md)
and [`DECISIONS.md`](DECISIONS.md) (D1–D66, all the user's; don't re-ask).
Date: 2 October 2026

Stages are built in order, **A+B → C → D → E** (D1), and each one ships and is usable on its own.
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

  **Done 2026-10-02** on branch `production-booking` (uncommitted). Seven exports in both
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

  **Done 2026-10-02** on `production-booking` (uncommitted). The suite is 327/327. New files are
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

  **Done 2026-10-02** on `production-booking` (uncommitted). The suite is 349/349, with one new
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

  **Done 2026-10-02** on `production-booking` (uncommitted). New `web/js/calendar.js` and
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

- [ ] **6. Editor: the Production Booking block and day cards** (frontend — Opus/high).
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

- [ ] **7. Editor: production items live on days, priced with surcharges** (money math —
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

- [ ] **8. Estimate detail, client PDF and Cost Breakdown PDF** (money math — Opus/high).
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

- [ ] **9. A+B responsive and accessibility pass** (frontend — Opus/high). Breakpoints 1280, 800
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

- [ ] **10. Deploy A+B** (deploy — Sonnet/medium). **Ask the user first.**
  - **NAS:** back up the live DB, deploy NAS v11 (watch the boot log for the migration and the
    holiday fetch), check `healthy`.
  - **Pages:** then push Pages, back to back (the shape bump refuses the old tab in between, as at
    v9).
  - **Afterwards, the user:** moves Overtime into Additional work on the live card (or resets it);
    checks the Public holidays list; sets their multipliers.

  Record the run ids in `HANDOVER.md`.

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

  **Done when** it's verified against the scratch DB with days across two months and three
  statuses.

- [ ] **13. C polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium).
  - The accessibility pass on Home (the keyboard grid, pop-up focus return) and responsive checks.
  - Then Pages only: no migration, but Pages must go after NAS v11.

## Stage D — Projects and invoices (migration v12)

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

- [ ] **15. Schema v12: projects, statuses, invoices, activity** (money math — Opus/high).
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
  - **Deploy:** ask first, then NAS v12 (back up first; read the boot log's project counts and
    `needs_upid` count), then Pages.
  - **The user** then runs the fix-up if the banner shows.

## Stage E — Client pages, signing, sending and payment (migration v13)

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
  - **Migration v13:**
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
  - **Deploy (ask first):** add the `.env` secrets on the NAS; NAS v13; check the boot log and the
    scheduler; then Pages.
  - **An end-to-end run with the user:** send a real estimate to their own address, sign it,
    confirm the email, the invoices, the calendar and the signed PDF, then pay a deposit by card in
    test mode.

## Review

- [ ] **33. Money-math and security review, then design review** (review).
  - **A `/code-review` (xhigh) of the whole track's diff**, hunting for:
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
- **Removing the committed Delight `.woff2` from git history** is the user's call (D57), and a
  separate job.
