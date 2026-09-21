# Handover: Finance — Overhead, Goals & Cost-Basis Pricing

For a fresh agent picking this up. Root: the repo containing this `.design/` folder. Read
[CLAUDE.md](../../CLAUDE.md) first for the model/effort guidance and the handover discipline rules
— this file exists because of that discipline, keep it current.

## What this is

A new **Finance** area of the live website (`.design/nas-hosted-billing/`, already built and
deployed): an Overhead page tracking real recurring business costs, a Goals page stating income
and margin targets, and a computed Overhead Rate/hr that replaces manual entry for the Pricing
screen's per-row internal cost basis. Full rationale, formulas, and architecture:
[DESIGN_BRIEF.md](DESIGN_BRIEF.md). Structural detail (nav, mount contracts, user flows):
[INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md).

## Where this is in the design flow

Sequence: Grill Me → Design Brief → Information Architecture → Design Tokens (skipped — the site's
dark-editorial token set is locked and unchanged) → Brief to Tasks → **Frontend Design (in
progress — the nav shell, the Pricing rate column, the Overhead screen, the Goals form, both
Overhead charts, the estimate-editor floor and its cost breakdown dialog are in, and the layout
check and the accessibility pass are done)** → **Design Review (done 2026-09-18 —
[DESIGN_REVIEW.md](DESIGN_REVIEW.md))**. Every item in TASKS.md is checked off.

**Completed, 2026-09-15:**
1. Grill Me — no file output; every structural decision folded into the brief (see "Resolved
   decisions" below).
2. Design Brief — [DESIGN_BRIEF.md](DESIGN_BRIEF.md).
3. Information Architecture — [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md).
4. Brief to Tasks — [TASKS.md](TASKS.md), 13 tasks, each tagged with its CLAUDE.md model/effort
   bucket.
5. **A real-world accounting review of the pricing formula**, requested by the user after the task
   list was written but before any code — see "Resolved decisions" below for what it confirmed and
   changed. This is why the brief and tasks have GST-hint and wage-scope language added after
   their initial write-up; read the brief's current version, not an earlier draft of it.

**Done, 2026-09-15:**
6. **SQLite migrations** — `server/src/db.js` schema **v4**: `overhead_items`, `overhead_snapshots`,
   `goals`. Tested in `server/test/test-db.js` (fresh-DB table list, category/frequency `CHECK`
   enforcement, snapshot append-only ordering, goals singleton `CHECK (id = 1)`, and that a fresh
   `goals` table starts with no row — see "Resolved decisions" below). Also verified by hand against
   a **copy** of the real local `server/data/billing.db` (not the working file): migrated cleanly,
   pre-existing `account` row untouched, `schema_version` recorded through v4. `npm test` 72/72.

7. **Overhead + Goals calc functions** — `server/src/calc.js` (198 → 428 lines), byte-copied to
   `web/js/calc.js`. `annualOverheadTotal`, `overheadRatePerHour`, `minimumJobPrice`,
   `targetAnnualRevenue`, plus two exported helpers the views need (`annualisedCost` for the expense
   table's monthly-equivalent column, `FREQUENCY_MULTIPLIERS`/`WEEKS_PER_YEAR` so nothing downstream
   keeps a second copy of the constants). 16 new tests in `server/test/test-calc.js`; `npm test`
   88/88. The brief's worked example lands exactly: $24,000 annual overhead ÷ 960 billable hours =
   **$25/hr**, and a 14-hour/$1560-expense job floors at **$2387.50** at a 25% margin.

8. **Routes: `overhead.js` and `goals.js`** — `server/src/routes/overhead.js` (`GET/POST/PUT/DELETE
   /api/overhead-items`, `GET /api/overhead-snapshots`) and `server/src/routes/goals.js`
   (`GET/PUT /api/goals`), both registered in `server/src/app.js`. Mirrors `clients.js`'s CRUD shape
   and `pricing.js`'s singleton upsert exactly, per the brief's route table. Every overhead-items
   write (create/update/delete) appends one `overhead_snapshots` row in the same handler via a
   shared `writeSnapshot(db)` helper — no separate recalculate step. `by_category_json` sums
   `annualisedCost()` per item (not raw `cost`), so its values add back up to `total_annual` — this
   was a bug caught by the tests themselves (first draft summed raw monthly cost against an
   annualised total and the two didn't add up). 6 new tests in `server/test/test-api.js`: CRUD +
   snapshot-per-write, a bad `category` enum value rejected with 500 (Express 5 catches the
   synchronous `CHECK` failure and routes it to the shared error handler — no manual validation
   added, matching `clients.js`'s trust-the-shape style), and the goals singleton (unsaved reads as
   `{ desiredNetIncome: null, targetProfitMarginPct: null, billableCapacityHrsPerWeek: null,
   updatedAt: null }` — see "Resolved decisions" #9 and the new #15 below — then round-trips and
   re-updates in place). `npm test` 91/91.

9. **Finance nav + `FinanceView` shell** — `web/js/views/finance.js` (new, ~140 lines) plus
   `web/css/finance.css` (new, one rule). `#nav-pricing` is now `#nav-finance`; `setNav()` takes
   `'finance'`; `toPricing()` is now `toFinance(initialTab)`. `LSCData.load()` preloads all five
   payloads in one `Promise.all` and `loaded()` requires all five; new accessors
   (`overheadItems()`, `overheadSnapshots()`, `goals()`, `goalsConfigured()`) and setters
   (`setOverheadItems`, `setOverheadSnapshots`, `setGoals`) are in place for the screens that write
   them. Pricing mounts unmodified into `#finance-sub`; Overhead and Goals render a placeholder
   until their own tasks land. **One fix to `pricing.js` came with the move** — see resolved
   decision 16, it's the only reason that file is in this commit. Verified in a browser against
   `api-scratch` (see "Verifying your work"), not just by eye over the diff: routing, `initialTab`,
   the unsaved-edit guard in all four of its states, the stale-watcher case, a full save
   round-trip from inside the sub-container, 375px, and a clean console. `npm test` still 91/91
   (no backend change in this task).

10. **Pricing screen: computed rate column + explanatory note** — `web/js/views/pricing.js`
    (+95 lines), `web/css/pricing.css` (+72), and one line in `web/js/views/finance.js`. Every
    labour row's Rate ($/hr) is now the single Overhead Rate/hr, read-only, `aria-readonly="true"`,
    `aria-describedby` the note above the grid; travel rows are untouched and still manually
    editable. **The computed figure is never written back** — see resolved decision 19, this was
    the one open question in the task and the user settled it explicitly. No backend change, so
    `npm test` is unchanged at 91/91 and `calc.js` did not need re-copying.

    Verified in a browser against `api-scratch`, both states, not just over the diff: with no
    overhead/goals rows all 18 labour rates render a muted `—` (no `$0`, `NaN` or `Infinity`
    anywhere); with the brief's worked example seeded they all render `25.00`. A real save with an
    unrelated Mark-Up edit (56 → 57) round-tripped through the API and left every stored `rate`
    byte-identical — `[[40,30],[100,80,60],[35,45,...,110]]` before and after — which is the
    specific regression this task could have caused. Both note links navigate (Overhead / Goals,
    `aria-current` follows), ask `LSCUnsaved` first from a dirty card, stay put when that is
    declined, and stay silent from a clean one. Finance → Estimates → Clients → Finance prompts
    nothing (decision 16's stale-watcher case, re-checked). Contrast measured live, not assumed:
    note 6.15:1, computed rate 15.21:1, links 15.21:1 — the first draft's accent links were
    3.71:1 and were changed for it (decision 21). 375px: no horizontal overflow, rate and Mark-Up
    right edges agree to the pixel, both 44px tall. Console clean.

11. **Overhead expense table + Add/Edit modal + Summary Card** — `web/js/views/overhead.js` (new,
    ~484 lines), `web/css/overhead.css` (new, ~135), `web/js/modal.js` (new, ~65 — see decision 24),
    plus four wiring lines in `web/index.html` and a small edit to `web/js/views/settings.js`. The
    screen is the page head + Add Expense button, the Summary Card (Monthly / Annual), the GST
    convention note, and the expense table; **neither chart is here** — those are their own two
    tasks and the screen simply ends after the table for now. No backend change: `npm test` is
    unchanged at 91/91 and `calc.js` was not touched.

    Verified against `api-scratch` by driving the real screen, not by reading the diff. Table and
    Summary Card against the seeded fixture: 4 rows, monthly equivalents correct per frequency
    ($750/qtr → $250, $1800/yr → $150), Monthly $2,000.00 / Annual $24,000.00. Add: validation
    blocks an empty form with all three messages at once, then a real POST landed with the right
    enum values, closed the modal, and re-rendered the card to $24,600 with a snapshot appended.
    Edit: opens pre-filled and titled "Edit Expense", cost 600 → 900 updated in place without
    adding a row. Delete: names the item and the annual amount at stake, declining leaves it
    alone, accepting returns the total to $24,000. Empty state: $0.00 card, "0 expenses", the
    first-run message, no table. Focus trap: wraps both directions, pulls focus back when it
    escapes to the header behind, Escape closes and returns focus to the control that opened it, a
    dirty form asks before discarding and keeps the edits when that is declined. **And the
    cross-screen promise from decision 19 actually holds** — editing an expense to $24,900 and
    clicking back to Pricing showed $25.94/hr (24900 ÷ 960) with no reload. 375px: table stacks on
    its `data-label`s, summary card wraps, no horizontal overflow. Console clean.

12. **Goals form + shared Tax Reserve control** — `web/js/views/goals.js` (new, ~506 lines,
    over half of it comment), `web/css/goals.css` (new, ~116), plus two wiring lines in `web/index.html`. Three fields
    (Desired Net Income, Target Profit Margin %, Billable Capacity hrs/wk), the shared
    `.tax-setting` control, one Save button, and a live Target Annual Revenue stat below the save
    bar. No backend change: `npm test` is unchanged at **91/91** and `calc.js` was not touched, so
    it did not need re-copying.

    **The dangerous part of this task was not in the brief.** `PUT /api/pricing` is a
    *whole-document* write — `server/src/routes/pricing.js` stores the request body verbatim and
    `readPricing()` returns it with no merge against `DEFAULT_PRICING` — so writing the shared tax
    field as `{ taxSetAsideRate }` would have replaced the entire rate card with an object holding
    no `labourSections` and no `travelRows`, and `computeTotals` prices every labour and travel
    line at zero against a card it can't find rows in. The body is the whole cached card with one
    field swapped; see resolved decision 30.

    Verified against `api-scratch` by driving the real screen, not by reading the diff. Empty
    state: three blank fields (not `0`, not `null`), tax pre-filled at 35 from the stored 0.35, and
    Target Annual Revenue a muted em dash naming the Overhead tab. Validation blocks an empty form
    with all three messages at once and writes nothing; every bound rejects — capacity 0, capacity
    960 (a year typed into a weekly field), margin −5, net −1, tax 101. The live stat tracks every
    keystroke and matches `LSCCalc.targetAnnualRevenue()` called directly ($175,384.62 on
    24000/90000/0.35); 0% tax gives $114,000 with no gross-up, and 100% gives an em dash with its
    own sentence rather than `$Infinity`. **The rate card survived every tax write** — 3 sections /
    18 labour rows / 5 travel rows byte-identical by fingerprint before and after, across four
    separate saves. Both directions of the shared field round-trip: saving 30% here put 30 in
    Pricing's own field, and saving 27.5% on Pricing put 27.5 here. **The cross-screen promise
    holds** — saving 20 hrs/wk and clicking straight to Pricing showed all 18 labour rates at
    `25.00` (24000 ÷ 960) with no reload. The partial-failure path was forced by failing only the
    pricing write: the goals landed, the message said exactly that, the screen stayed dirty on the
    one field that didn't, and a retry recovered cleanly. Unsaved guard in all four states,
    including typed-then-undone reading clean, and **the decision-16 stale-watcher case**: leaving
    Finance from a dirty Goals prompted once, then Clients → Estimates → Finance prompted zero
    times. Contrast measured live with the alpha composited (`--muted` is `rgba(...,0.6)`, so
    reading its channels raw measures `--text` by mistake): hints and labels 6.15:1 on `--bg`, the
    card and save-bar copy 5.2:1 on `--surface`, the headline figure 11.49:1, the Overhead link
    11.49:1. Focus rings: all five controls plus the link get a11y.css's `2px solid var(--accent)`
    @2px — see the note in "Open items" about how to measure that without a false negative. Tab
    order is the visual order. 375px: no horizontal overflow, the form collapses to one column,
    every input 44px. Console clean.

13. **Historical Overhead Trend chart (SVG line)** — `web/js/views/overhead-charts.js` (new, ~300
    lines), ~85 new lines in `web/css/overhead.css`, four wiring lines in `web/js/views/overhead.js`
    and one `<script>` tag in `web/index.html`. Hand-rolled inline SVG, no library, mounted at the
    bottom of the Overhead screen. No backend change: `npm test` is unchanged at **91/91** and
    `calc.js` was not touched, so it did not need re-copying. `web/README.md`'s file listing gained
    the new file and the four earlier ones it was already missing (`css/overhead.css`,
    `css/goals.css`, `js/modal.js`, `js/views/overhead.js`, `js/views/goals.js`).

    **The chart is in its own file, not in `overhead.js`** — see resolved decision 37 — and the
    donut belongs in there beside it. **The x axis is event order, not elapsed time** (decision 38),
    which is the one thing to read before touching it.

    Verified against `api-scratch` by driving the real screen, not by reading the diff. Every state
    was rendered and read back: zero snapshots and exactly one snapshot each give a plain sentence
    and no axis; two points falling, fourteen points crossing a year boundary, 120 points, and a
    run where every total is `$0.00` (everything deleted) all draw without a `NaN`, an `$Infinity`
    or a collapsed axis. **A real Add Expense through the modal** took the chart from 4 points to 5
    with the head line moving $22,800 → $24,000 and the Summary Card to $25,200, with no reload;
    deleting it again returned both. Axis ticks land on round money at every scale checked
    ($0/$10k/$20k/$30k on the seeded data, $0/$250/$500/$750/$1k on the all-zero run). Contrast
    measured live with the alpha composited: axis ticks and dates both **6.15:1** on `--bg`. 375px:
    `body.scrollWidth` 375, no horizontal overflow, labels at their real 11px/10px. Console clean
    apart from the app's pre-existing pre-login `401` on `/api/session`. Pricing re-checked
    afterwards: all 18 labour rates still `25.00`, so the write round-trip left the worked example
    intact.

    **Three bugs were caught by measuring rather than by looking**, all in the geometry: the svg was
    drawn to `clientWidth`, which includes the container's padding, so it rendered 998 user units
    into 966 pixels and scaled every label by 0.968 — the exact fractional scaling the measured-width
    approach exists to remove; a `Math.max(320, …)` floor did the same thing again at a 375px
    viewport, where the real box is 309px; and a fourteen-point fixture spanning Jan 2025 → Feb 2026
    labelled its ends "12 Jan" and "12 Feb", which reads as ten months backwards. All three look
    right in a screenshot.

14. **Category Breakdown donut + legend** — ~200 new lines in `web/js/views/overhead-charts.js`,
    ~150 new lines in `web/css/overhead.css`, and two wiring lines in `web/js/views/overhead.js`.
    Hand-rolled inline SVG donut with an HTML legend beside it, mounted between the expense table
    and the trend chart per the IA doc's content order. No new files and no `index.html` change —
    the charts module and its stylesheet were already wired by task 13. No backend change:
    `npm test` is unchanged at **91/91** and `calc.js` was not touched, so it did not need
    re-copying.

    **Three things to read before touching it:** the scoped palette is measured and written up in
    `overhead.css`'s own comment block (decision 48); this chart has **no `draw()` phase** unlike
    its sibling, on purpose (decision 49); and the percentages are largest-remainder rounded so the
    legend sums to exactly 100.0 (decision 51).

    Verified against `api-scratch` by driving the real screen, not by reading the diff — and first
    against a 20-case Node harness over the pure markup functions, which is where the arc geometry
    and the rounding were pinned down before a browser was involved. Every state was rendered in
    place and read back: no expenses, every expense at $0, one category (a closed ring, not a
    sector — a 360° arc paints nothing), a category sitting at $0 alongside real ones, an
    unrecognised stored category, four categories and all six. Percentages sum to exactly 100.0 in
    every case including three equal thirds, and the legend's dollar column sums to exactly the
    figure in the hole. **A real Add Expense through the modal** took the donut from 4 categories
    to 5 and the hole from $24,000.00 to $24,720.00 with the Summary Card and the trend chart
    (6 → 7 points) moving with it, no reload; deleting it again returned all three, and Pricing
    re-checked afterwards still showed all 18 labour rates at `25.00`. Contrast measured live with
    the alpha composited: the five ramp steps are 6.23, 7.08, 9.96, 6.41 and 10.14:1 on `--bg`,
    legend names and amounts 15.21:1, shares and caption 6.15:1. 375px: `body.scrollWidth` 375, no
    horizontal overflow, the legend stacks under a centred ring. Console clean apart from the app's
    pre-existing pre-login `401` on `/api/session`.

    **The figure in the donut's hole is sized to fit it** (decision 50) — that came out of
    measuring, not looking: at a fixed 19px it was 119.3px inside a 128px hole, which looks
    perfectly fine on the seeded data and runs out over the ring the moment somebody's overhead
    reaches seven figures. The first fit constant was itself wrong for a second reason worth
    knowing here — it was measured before `Delight` had loaded, so it described Georgia.

15. **Estimate-editor Overhead/Profit toggle + Minimum Job Price line** — ~70 new lines in
    `web/js/views/estimate-editor.js` and ~90 in `web/css/estimates.css`. An "Include Overhead &
    Profit Margin in Calculation" checkbox above the summary bars, defaulting ON, and an advisory
    Minimum Job Price line below them. No new files. No backend change: `npm test` is unchanged at
    **91/91** and `calc.js` was not touched, so it did not need re-copying.

    **`minimumJobPrice()` now has a screen, which closes the last of the three calc functions'
    "never been rendered" open item.** Both of its states were checked by eye against
    `api-scratch`: a `null` floor renders as a muted em dash under "Set up Overhead & Goals to see
    this", and a real one renders as money — no `$0.00`, `NaN`, `Infinity`, `null` or `undefined`
    reached the screen in any state.

    Verified against `api-scratch` by driving the real form, not by reading the diff. **The screen
    reproduces the calc suite's own worked example exactly**: a 14-hour job with $1,560 of crew
    against the seeded $25/hr rate and 25% margin renders `$2,387.50`, the figure
    `server/test/test-calc.js` pins — entered through the real row pickers, not stubbed. The
    quote's own price ($3,520.00) clears it, which is the story the feature exists to tell. **The
    invariant holds**: all eight headline figures (hours, labour, expenses, client price ex GST,
    GST, total inc GST, tax set-aside, take-home) are byte-identical with the toggle on, off, and
    back on. Off genuinely removes the line — `hidden`, no layout box, zero height — rather than
    hiding it visually. Toggling never makes the form dirty (0 prompts on the way out), while the
    control case of a real edit still prompts. Empty states forced both ways, by stubbing goals to
    `{}` and overhead to `[]` separately. The saved estimate round-tripped and the **read-only
    detail view renders the same money as the editor** with no floor line and no toggle — the
    scope call in decision 56. 375px: no horizontal overflow, the line wraps to two rows and stays
    inside the viewport. Console clean; the only errors in the buffer were `ERR_CONNECTION_REFUSED`
    from the app stopping the preview servers mid-session, and every API call after the last reload
    returned 200.

    **Two process notes that cost real time here**, both worth reading before the next browser
    session — see "Open items": the preview servers were stopped by the app twice mid-verification,
    and a `location.reload()` re-served `estimates.css` from cache so the new rules were silently
    absent while the file on disk and on the server both had them.

16. **Cost breakdown modal** — ~140 new lines in `web/js/views/estimate-editor.js`, ~120 in
    `web/css/estimates.css`, one overlay div in `web/index.html`, and one rule in
    `web/css/responsive.css`. A `(?)` beside the Minimum Job Price figure opening a read-only
    `.modal-box` with the three-line math. No new files. No backend change: `npm test` is unchanged
    at **91/91** and `calc.js` was not touched, so it did not need re-copying.

    **Three things to read before touching it:** the dialog computes nothing of its own and is
    handed the figures the line just painted (decision 63); the margin row is a *remainder*, not
    its own multiplication, so the printed column always adds to the printed total (decision 64);
    and the total is `--text`, deliberately not `--accent` (decision 65).

    Verified against `api-scratch` by driving the real form, not by reading the diff. **The screen
    reproduces the calc suite's worked example exactly**: a 14-hour job with $1,560 of crew against
    the seeded $25/hr rate and 25% margin gives $1,560.00 + $350.00 + $477.50 = **$2,387.50**,
    entered through the real row pickers. The dialog's total always equals the line it hangs off.
    Rounding was pinned down first in a **2,240-case Node sweep** over the exact expression
    `setBreakdown()` uses — 0 column-sum mismatches, worst margin drift $0.01 at a $2.2M floor —
    and then the half-cent case was forced live in the browser (17 hrs/wk → $29.41/hr, 7.5 hours →
    an unrounded $220.575 allocation): the column still summed to the cent with zero drift.

    Focus trap via `LSCModal.trapTab`, not a third copy: wraps both directions on a single-control
    dialog, and pulls focus back when it escapes to the form behind. All three exits (Escape, the
    Close button, the backdrop) close it and return focus to the `(?)`; a click that lands inside
    the box does not. Listeners are removed on close — a later Escape does nothing. **The invariant
    holds**: all eight headline figures are byte-identical across opening, closing and a full
    toggle cycle, and using the dialog leaves the form clean (0 prompts on the way out, while a
    real edit still prompts once). Empty states forced both ways by stubbing goals to `{}` and
    overhead to `[]`: em dash, trigger `hidden` and out of the focusable set, and `openBreakdown()`
    refuses even when the trigger is forced visible, so no dialog of `undefined`s exists. Toggling
    off takes the trigger out of layout with the line.

    Contrast measured live with the alpha composited: dialog title, row labels and row values
    **11.49:1**, the total **11.49:1**, row notes and the caption **5.2:1** on `--surface`, the
    `(?)` glyph **6.15:1** on `--bg`. The ring is `--border` at 1.97:1, which is exactly what every
    `.btn` in the app already uses for its boundary with `--muted` text on it — the app's existing
    control convention, not a new gap. Focus rings confirmed with **real** keyboard input:
    a11y.css's `2px solid var(--accent)` @2px offset. 375px: `body.scrollWidth` 375, no horizontal
    overflow, the box fits at 9–366px, labels never collide with values, and the hit target is
    44×44 while the ring stays 20px. Optical centres of the figure and the `(?)` agree to 0.0px.
    Console clean apart from the app's pre-existing pre-login `401` on `/api/session`; every API
    call after the last reload returned 200.

    **One measurement bug of my own is worth knowing about** — see "Open items": a contrast helper
    that finds the first non-transparent ancestor background and treats it as opaque reads the
    summary bar's accent total as **1:1**, because that cell's background is `rgba(184,84,68,0.08)`
    and the accent text composited against it unchanged. It looks exactly like a catastrophic
    finding in the existing app. Composite the whole stack down to `--bg` instead; the real figure
    there is 3.46:1.

17. **Layout check at 1099px / 900px / 768px** — ~60 new lines in `web/css/responsive.css`, all
    inside existing `max-width` media queries, nothing else touched. No backend change: `npm test`
    unchanged at **91/91**.

    **Measured first, at 1400 / 1099 / 900 / 768 / 767 / 375 / 320px**, on all three Finance
    sub-tabs, with `getBoundingClientRect`/`getComputedStyle` against `api-scratch`. Most of the
    task's checklist already held and needed nothing: no horizontal overflow on any Finance screen
    at any width; both charts render at exactly **1.000** scale (viewBox width = box width) at every
    width; the sub-tab row is one line everywhere, and at 320px it ends at 227px with 304px
    available, so it never needs to wrap; the expense table already carried `data-label`s and
    stacks below 768px; the Goals form is one column below 768px with 44px inputs.

    **Three real bugs, fixed:**
    - **The expense table's actions cell overflowed its own box below 768px.** `overhead.css`'s
      desktop `width: 1%` (0,2,1) outranks `.est-table td`'s stacking rule (0,1,1), so the stacked
      cell was **20px wide with 118px of Edit and × spilling out of it**, on the left of a row whose
      values are all on the right. Now full-width, right-aligned, and the buttons end exactly where
      the values above them do (both 14px in) at 767, 375 and 320px.
    - **"Save Goals", "Save Services" and "Reset Defaults" broke onto two lines** in the tablet band
      (found by eye in a 768px screenshot, then measured — the numbers alone had not been looking
      at buttons). The save bar is a flex row of a sentence and a button group that both shrink,
      and the sentence won: 569px against the group's 105px. The group now holds its width and the
      sentence wraps; zero wrapped buttons on any Finance screen at any width.
    - **The active sub-tab's underline sat 16px under its label below 768px**, against 8px at every
      wider width — the 44px touch target grew the button with the label centred in it. The label
      now sits at the bottom of the same 44px button: **8px at every width**, target kept.

    **Two things deliberately not changed, both with measurements** — decisions 68 and 69: the
    donut legend's stacking point (the brief's 900px rule is **not** applied), and the Goals form's
    three columns down to 768px.

    Desktop verified unmoved: 1400px and 1099px figures identical before and after (actions cell
    92px, save bar 603/111px, tab button 28px with an 8px gap). Console clean except one error from
    this session's own measuring script (it passed the API's `{ok, snapshots}` envelope to
    `LSCData.setOverheadSnapshots` instead of the array — a test-harness mistake, gone after
    reload). **`api-scratch` now holds 12 snapshots** — see Open items.

18. **Accessibility pass** — one new token and five changed lines in `web/css/overhead.css`; nothing
    else in the code changed. No backend change.

    **Focus rings: all 162 interactive controls, zero gaps.** Header (6), Pricing (134), Overhead
    (12), Goals (8), the Add Expense dialog (6), the estimate editor's toggle and `(?)`, and the
    cost breakdown dialog — every one showed a11y.css's `2px solid var(--accent)` under a genuine
    `:focus-visible`, and `.nav-link`s the 3px offset. **How it was measured matters** — see Open
    items: one real Tab to put the browser in keyboard mode, then every focusable element focused
    by script, read after the `.btn` transition settles.

    **Contrast: every text style on all three Finance screens clears its bar.** A tree walk over
    every visible text node in `#main`, alpha composited through the whole background stack, large
    text judged at 3:1 and the rest at 4.5:1: 51 distinct styles, **0 failures, lowest 4.78:1**.
    Chart text 6.15:1, the donut's centre figure 15.21:1.

    **The one colour under the brief's bar was `--accent` in both charts, and it is fixed** — the
    trend line, its dots and wash, and the donut's largest slice now use `--oh-chart-accent`
    (`#c26b5d`), **4.70:1 on `--bg`** against `--accent`'s 3.71:1. Every chart colour is now ≥4.70:1;
    the ramp is unchanged at 6.23–10.14:1; swatches still match their slices exactly. See decision
    72 — this was the user's call.

    **Pricing's computed rates confirmed:** all 18 are `readonly` + `aria-readonly="true"`, all
    `aria-describedby="pricing-rate-note"`, which exists and holds the brief's copy, and each one's
    accessible name ends "calculated automatically". **Both new dialogs confirmed:** `role="dialog"`,
    `aria-modal="true"`, a resolving `aria-labelledby`, Escape closes, focus returns to the trigger
    (the cost breakdown's trap was verified in depth in entry 16; the Add Expense dialog's in
    entry 11, re-checked here). **The toggle** has a `<label for>` naming it and an
    `aria-describedby` hint saying it is advisory.

    **`npm test` 91/91** — on the third attempt. The first two hung with no code change behind
    them and the third passed in 13s untouched; see Open items.

19. **Design review** — [DESIGN_REVIEW.md](DESIGN_REVIEW.md), no code changed. Run with the
    `design-review` skill against DESIGN_BRIEF.md, live against `api-scratch`, at 1280 / 768 /
    375px plus the first-run empty states and the Add Expense validation state.

    **Verdict: no must-fix issue in the Finance feature.** Aesthetic fidelity is high — it reads as
    more pages of the same rate card, and every anti-reference in the brief is avoided. Five
    should-fix and five could-improve items, **most of them site-wide and pre-existing** rather
    than introduced here; the most important is that no screen in the app has a heading element or
    (once signed in) a `<main>` landmark. See the review for each with its fix.

    **The skill's screenshot files were not written.** It asks for PNGs in
    `.design/overhead-finance/screenshots/`; the built-in browser pane shows captures to the
    reviewer but cannot save them, no Playwright/Cursor browser MCP was available, and driving a
    separate headless browser would have meant signing in to the app, which the agent does not do.
    Every capture was still taken and analysed, and the review names each one so its findings stay
    traceable. If a file record matters, re-run the review where Playwright MCP is available.

20. **Design review follow-ups, 2026-09-21 — should-fix 1–5 and could-improve 4, all done.** The
    user chose these five by name ("I want this app ready to go live"), run under the
    `frontend-design` skill with the site's locked dark-editorial system as the direction — the
    skill's mobile-first and light-mode rules were deliberately not applied (desktop-first and
    dark-only are recorded decisions). No backend change: `npm test` **91/91**. `calc.js` untouched.

    - **Headings + `<main>` (SF1), site-wide.** `index.html`'s `#main` is now `<main id="main">`.
      Every `.page-title` is an `<h1>` (Estimates, Clients, client record, estimate editor,
      Pricing, Overhead, Goals); the estimate detail's `.est-name` is its `<h1>`; `.est-block-label`,
      `.bb-label`, Pricing's Travel `.pricing-sec-label`, both list screens' `.card-name` and all
      three dialog `.modal-title`s are `<h2>`; Invoice Settings' `.set-group-head`s are `<h3>`; the
      login wordmark is the login screen's `<h1>`. Classes unchanged — decision 75.
    - **Field-level errors (SF2), every validating form.** New `LSCUtil.showFieldErrors(box, found,
      lead)` / `clearFieldErrors(box)` in `web/js/util.js` — decision 76. Wired into Add/Edit
      Expense, Goals, Invoice Settings, Pricing (flags the exact row/category input), client record
      and estimate editor. Goals' hints are now also tied to their inputs by `aria-describedby`
      (they weren't). Visible half: `[aria-invalid='true']` border in `--err-text` — decision 77.
    - **Legend width (SF3).** `max-width: 480px` on `.oh-legend-row`, not `.oh-legend` — decision 78.
    - **Error tokens (SF4).** `--err-border` / `--err-bg` / `--err-text` defined once in `a11y.css`;
      all seven stylesheets' error boxes and the toast's error state read them — decision 79.
    - **Startup message (SF5).** `app.js`: "Couldn't load your pricing and finance settings".
    - **Reduced motion (CI4).** One rule in `a11y.css`, spinner exempt (a frozen one reads as a hung
      save).

    **Verified against `api-scratch` by driving every screen**, dispatched clicks per the
    browser-pane notes. **Pixel identity measured, not assumed**: on each screen every new
    heading was swapped back to its old `div`/`span` in place and every visible box in `#app-view`
    re-measured — **0 differing boxes** across Estimates (empty and with a card), estimate detail,
    estimate editor (7 `h2`s), Clients, client record, Pricing (359 boxes), Overhead, Goals and
    Invoice Settings. Heading outline read back on each. Field errors: every form submitted bad,
    each flagged field carries `aria-invalid` + `aria-describedby` → its own sentence, focus lands
    on the first, editing one field clears only that field, the summary text is unchanged from
    before. Legend at 1024px: rows 663 → 480px, donut x = 57 capped and uncapped. A throwaway
    estimate made to reach the detail view and a list card was deleted afterwards; `api-scratch`
    is as it was. Console clean.
    **Not seen live:** the login `<h1>` (would need a sign-out) and the startup failure message
    (needs `/api/session` up but the preload down) — both are markup/string-only changes.

**Not started:** nothing in TASKS.md. Of the design review's follow-ups, **should-fix 1–5 and
could-improve 4 are done** (entry 20). Still open, all optional polish: could-improve 1 (Goals
result card's half-width row), 2 (echo Desired Net Income formatted), 3 (`aria-live` — deferred by
the user, decision 74) and 5 (embed Funnel Sans — the base track's font task). `web/js/calc.js` is byte-identical
to the server money model and must be re-copied (`cp server/src/calc.js web/js/calc.js`) after
*any* edit to `calc.js`.

**To resume:** the user's stated goal is **going live**. Ask whether they want any of the four
remaining could-improve items first; otherwise the next step is the base track's own remaining
list ([`../nas-hosted-billing/TASKS.md`](../nas-hosted-billing/TASKS.md) — design review, font/asset
cleanup) and a deploy of these changes to GitHub Pages. Two small seams from entry 20 worth
knowing: Pricing's user-named labour categories have no heading (their name is an editable
`<input>`, which can't sit inside one — only Travel, whose name is fixed, is an `<h2>`), and the
`.empty-state` titles are still `<h3>` under an `<h1>` (their CSS is keyed to the tag).

Buckets per CLAUDE.md: all of it is UI work (`Opus/high`); nothing touches money math. Two things
**not** to reopen without asking: the chart-only terracotta (decision 72) and the accent link-hover
idiom (decision 73), both put to the user on 2026-09-18. The review recommends closing the
"two names for the tax field" open item as-is.

## Resolved decisions (do not re-litigate — these were deliberate calls, not oversights)

Everything in DESIGN_BRIEF.md's decisions, plus, from the accounting-review round specifically:

1. **This feature checks overhead recovery only, never wage adequacy.** Minimum Job Price =
   (Direct Job Costs + Estimated Hours × Overhead Rate/hr) × (1 + Profit Margin%) — no wage/direct
   labor term anywhere, in either this formula or the per-row Overhead Rate/hr calculation. The
   user was shown the gap explicitly (nothing checks whether `mu` covers a living wage) and chose
   to keep it that way: `mu` stays fully manual and trusted, Desired Net Income stays an annual
   planning stat only (feeds Target Annual Revenue), never wired into a per-job or per-row floor.
   Don't add a wage term back in without asking again — it was considered and declined with full
   awareness of the trade-off, not missed.
2. **Overhead item costs are entered GST-exclusive**, by convention + a one-line hint on the entry
   form, not by a GST-registered toggle + auto-conversion formula. If the user enters a
   GST-inclusive figure despite the hint, Annual Overhead Total (and everything computed from it)
   runs high by the GST component — an accepted risk of the hint-only approach, not a bug to silently
   "fix" with an unrequested toggle later.
3. **Every labour row's `rate` field becomes the same single computed number** (Overhead Rate/hr),
   collapsing the Pricing screen's current $30–$110 per-row cost differentiation. Confirmed
   accounting-sound (a standard flat overhead-absorption rate per direct-labour-hour) — this is a
   deliberate simplification, not a bug to "fix" by reintroducing per-row differentiation.
4. **Travel rows are excluded** from the Overhead Rate/hr auto-calculation entirely — they keep
   their current manually-editable `rate`.
5. **No new nav dropdown/menu component.** "Finance" is one `.nav-link` like any other, opening a
   page whose own `#main` content starts with a Pricing/Overhead/Goals sub-tab row (same `.nav-link`
   markup, different container) — chosen specifically because the header nav already wraps below
   ~865px and this codebase has no dropdown pattern to extend. Don't build one for this.
6. **`rate` is not used in any billing calculation today** (confirmed by reading `calc.js`: only
   `mu` drives `labourTotal`) — this is *why* making it auto-computed and read-only is safe and
   can't silently change a past or in-progress quote's billed price. If a future change ever makes
   `rate` feed into billing math, this whole feature's safety argument needs re-examining, not just
   assumed to still hold.
7. **The old `.design/overhead-profit-goals/` brief for this same feature (Electron/`localStorage`
   -targeted) has been deleted from the repo**, not kept as "historical context" — it was fully
   superseded by this track and its presence risked confusing exactly the kind of fresh agent this
   handover is for. If anyone needs to see it, it's in git history before 2026-09-15.
8. **`overhead_items.category` and `.frequency` are `CHECK`-constrained enums, and neither list is
   specified anywhere in this brief or its superseded predecessor.** The migrations task
   (TASKS.md/DESIGN_BRIEF.md) only says "category is a fixed list" and names six categories in the
   brief's Out of Scope line (Software, Admin/Legal, Marketing, Hosting, Tax, Other) — nothing gives
   their on-the-wire spelling, and frequency isn't enumerated at all. The migration stores them as
   lowercase snake_case: `category IN ('software','admin_legal','marketing','hosting','tax','other')`,
   `frequency IN ('weekly','monthly','quarterly','annual','one_off')` — chosen to match this
   codebase's existing enum convention (`estimates.status`/`doc_type`), not sourced from the brief.
   **The Overhead route/view tasks must use these exact strings** (their `<select>` option values,
   any server-side validation) or every write will fail its `CHECK`. If a task downstream decides
   different values are needed, add a new migration to change the constraint — per the "never edit a
   shipped migration" rule — rather than editing schema v4.
9. **The `goals` table has no seeded row**, matching `pricing`/`settings`'s "a never-saved row is not
   an empty one" convention (`nas-hosted-billing/HANDOVER.md`'s First-run entry). `GET /api/goals`
   (not yet built) should return computed defaults with `updatedAt: null` until the first `PUT`,
   exactly like `GET /api/pricing` does — don't have the migration `INSERT` a default row instead.

10. **Three money constants the brief never specified were decided with the user on 2026-09-15**,
    before any code was written, because each one silently moves every rate on the card:
    **(a) Billable capacity annualises at 48 weeks, not 52** (`WEEKS_PER_YEAR`) — hours entered are
    billable hours in a *working* week, so ~4 weeks of leave bill nothing. This is what makes the
    brief's worked example come out at exactly $25/hr (20 hrs/wk × 48 = 960). Costs are untouched
    by it: `FREQUENCY_MULTIPLIERS.weekly` is 52, because a weekly expense is owed all year.
    **(b) Target Annual Revenue = (overhead + desired net) ÷ (1 − taxRate)** — tax as a flat slice
    of revenue. Not the accountant's formula (income tax is levied on profit, which would give
    $124,000 instead of $144,615 on the same inputs), but it is the model `calc.js` already uses for
    `taxSetAside`, and one internally consistent planning figure beats two models of tax in one app.
    **(c) `one_off` items count ×1 in the annual total** — real money out the door this year. They
    never expire; an old one-off keeps inflating the total until deleted by hand. All three err in
    the conservative direction (higher rate, higher target). Don't "correct" any of them silently.
11. **The category/frequency enum spellings from decision 8 were shown to the user and confirmed
    as-is** on 2026-09-15 — `software`/`admin_legal`/`marketing`/`hosting`/`tax`/`other` and
    `weekly`/`monthly`/`quarterly`/`annual`/`one_off`. The open item from the last session is
    closed; the Overhead view can lock `<select>` markup around these.
12. **The calc functions stayed in `calc.js` rather than a sibling module**, which TASKS.md left
    open ("or a sibling module if `calc.js` is getting crowded"). 428 lines is long but the file is
    mostly docblock, and a sibling would need its own byte-identical `web/` copy, its own drift test,
    and its own `<script>` tag in `web/index.html` — three new seams to keep the browser and server
    agreeing, to tidy one file. Revisit if a later task adds a comparable block again.
13. **`null` is the "cannot compute" signal throughout, never `0`/`NaN`/`Infinity`.** A zero
    overhead total returns `null` too, not `$0.00` — the screens render `null` as an em dash, and a
    rate card reading "$0.00" looks like a computed answer meaning an hour of your time costs
    nothing. The views therefore do **not** need their own `items.length === 0` check to produce the
    brief's empty state; they need to handle `null`. Same for `minimumJobPrice` (no rate → `null`,
    never a floor with the overhead term silently dropped) and `targetAnnualRevenue`.
14. **`profitMarginPct` is a PERCENT (25 = 25%); `taxRate`/`taxSetAsideRate` are FRACTIONS
    (0.35 = 35%).** These two conventions now sit in the same file. The parameter names carry the
    difference and the functions deliberately don't guess — passing `0.25` as a margin means a
    quarter of one percent. There's a test pinning this. The Goals form writes
    `target_profit_margin_pct` as a percent; the `.tax-setting` control writes a fraction. Getting
    these crossed under-prices every job by ~25%, so check the unit at every layer boundary.

15. **`GET /api/goals` on an unsaved singleton returns nulls for the three fields, not guessed
    numbers.** `pricing`/`settings` have real fallback defaults (`DEFAULT_PRICING`,
    `DEFAULT_SETTINGS` in `defaults.js`) because the app has an opinion about a sensible starting
    rate card. Nothing in the brief or IA doc gives a default Desired Net Income, Target Profit
    Margin %, or Billable Capacity — there is no non-arbitrary number to guess — so the unsaved
    shape uses the same `null` "cannot compute" signal decision 13 already established for the calc
    functions, rather than inventing a `DEFAULT_GOALS`. The Goals view (not yet built) should render
    these as empty fields, not zeros.

16. **`pricing.js`'s on-screen sentinel now asks the document, not its own `root`** — the one
    change the Finance move forced on a file this feature otherwise doesn't touch. It used to read
    `root.querySelector('#tax-inp')`, which was correct only while `root` was `#main`, an element
    no navigation ever removes. `root` is now `#finance-sub`, and leaving Finance replaces `#main`
    wholesale — taking that div *out of the document with the rate card still inside it*. The old
    sentinel kept finding `#tax-inp` in the detached tree and answered "still on screen" forever,
    which left a dirty `LSCUnsaved` watcher interrupting *every subsequent navigation* to ask about
    a screen nobody could see. `document.getElementById` can't see a detached node, which is
    exactly the question being asked. Confirmed load-bearing rather than cosmetic by measuring both
    forms against the same detached node (old: `true`, new: `false`). The duplicate copy of the
    expression inline in the `LSCUnsaved.watch` call was collapsed into the shared const at the
    same time — there were two of them and only one would have been fixed.
    **This makes `#tax-inp` a document-unique id.** The Goals screen reuses `.tax-setting` for the
    same underlying field and **must give its input a different id** (`#goals-tax-inp` or
    similar), or Pricing's sentinel starts answering for Goals' field.
17. **The sub-tabs are `<nav>` + `aria-current="page"`, not `role="tablist"`.** ARIA tabs promise
    arrow-key movement between tabs and a labelled tabpanel; this row replaces a whole screen and
    has neither, so claiming the role would describe behaviour that isn't implemented. It is the
    header's own `.nav-link` markup and `.active` convention moved into `#main`, exactly as the IA
    doc specifies — which also means the `:focus-visible` ring, the `white-space:nowrap` at
    ~865px and the 44px touch target below 768px all arrive with the class, nothing new to write.
    If these ever become real tabs, that's a deliberate change with roving tabindex attached.
18. **`onGoPricing` kept its name** where the estimates first-run checklist calls it
    (`estimate-list.js` → `estimates.js` → `app.js`). The step still means the rate card
    specifically, and Pricing is where `toFinance()` with no argument lands — renaming it through
    three files would have been churn for no gain. It is passed as `() => toFinance()` rather than
    by reference, so a caller that ever hands it an event doesn't have that event read as
    `initialTab` (`FinanceView` also falls back to Pricing on a non-tab value, so both ends are
    defensive; there's a check for it in the verification run).

19. **The computed rate is displayed, never persisted.** TASKS.md and the brief both left this
    open; it was put to the user on 2026-09-15 and settled before any code: the rate column is
    derived at mount and never enters Pricing's working copy, so `payload()` still ships each row's
    own stored `rate` untouched. Persisting instead would flatten all 18 rows' saved rates to one
    number on the next save of any unrelated edit — irreversible, invisible in a UI that shows the
    computed figure either way, and impossible in the empty state where there is no number to
    write. The stored values are simply inert now (decision 6: nothing prices off `rate`). A row
    added with "+ Add Service" still stores `rate: 0` and displays the computed figure; that 0 is
    inert for the same reason. **A consequence for the screens still to be built:** because the
    rate is read from `LSCData` at mount, the Overhead and Goals views must call
    `LSCData.setOverheadItems()` / `setGoals()` after every write, or the Pricing tab one click
    away will compute against a stale cache. The setters exist for exactly this.
20. **The rate cell is `<input type="text" readonly>`, not a readonly number input.** A number
    input cannot render an em dash, and the empty state is an em dash — the only alternative would
    be an empty value with `—` as a *placeholder*, which is a hint rather than a value and is
    announced as one. It stays an `<input>` at all (rather than becoming a `<span>`) because the
    brief requires `aria-readonly` and an `aria-describedby` link to the note, which is the whole
    guard against a screen-reader user hitting a field that silently stopped accepting input. It
    also deliberately carries **no `data-si`/`data-ri`/`data-field`**: those are what
    `bindFieldEdits` uses to find the row an input writes to, so their absence means that even if
    the `readonly` attribute were ever lost, there is still nothing for an edit to land on.
21. **The note's two links are `--text` + a permanent underline at rest, not `--accent`.** The
    first draft followed `.toast-link` (accent, underlined) and measured **3.71:1** against this
    background — under the 4.5:1 the brief sets for body text, and 11px muted copy is exactly where
    that bar matters. `--text` is 15.21:1 and, against the `--muted` sentence around them, makes
    the links read brighter than their surroundings rather than dimmer. The rest/hover pair now
    matches `.client-history-link`, which is this codebase's existing inline-link idiom, rather
    than inventing a third one. **Still open for the accessibility pass:** accent-on-hover is
    itself 3.71:1, and that is a *pre-existing site-wide pattern* (`.toast-link`,
    `.client-history-link`) rather than something this task introduced — flagged there rather than
    diverged from here.
22. **`#pricing-rate-note` is now a second document-unique id on this screen**, alongside
    `#tax-inp` (decision 16). Every labour rate input's `aria-describedby` points at it, so no
    other screen may reuse the id — the Goals screen in particular, which already has to rename its
    `.tax-setting` input for the same reason.
23. **Pricing reaches Overhead/Goals through `FinanceView`'s `selectTab`, not `app.js`'s
    `toFinance`.** TASKS.md wrote the cross-links as `toFinance('overhead')` /
    `toFinance('goals')`; `FinanceView` now passes `onGoTab` down to every child it mounts instead.
    Same destination and the same `LSCUnsaved.confirmLeave()` guard, without tearing down and
    rebuilding the router to land one div lower. It is wrapped (`(id) => selectTab(id)`) rather
    than passed by reference so a child that ever hands it a click event doesn't have that event
    read as a tab id, and `selectTab`'s own `isTab()` check is the second half of that belt — the
    same defensiveness decision 18 applied to `onGoPricing`.

24. **The modal focus trap now lives in `web/js/modal.js` (`LSCModal`), and `settings.js` was moved
    onto it.** TASKS.md scoped this task to a new `overhead.js` only, so touching a working,
    verified screen was a deliberate widening — the reason is that both this task and the
    cost-breakdown task are told to "reuse the exact focus-trap implementation in
    `web/js/views/settings.js`", and the literal way to reuse an implementation is to share it
    rather than copy it a second and third time. Three copies would be three chances to disagree
    about what counts as focusable. The move changed exactly two things: the container is an
    argument instead of a closed-over `overlay`, and `select` joined the focusable selector (inert
    for Invoice Settings, which has none; required here, which has two). **The Invoice Settings
    modal was re-verified in a browser afterwards** — trap wraps both directions, the focusable set
    still recomputes when the GST toggle enables its two controls (10 → 12), Escape still closes —
    so this is a checked refactor, not an assumed-safe one. The cost-breakdown task should use
    `LSCModal.trapTab(container, event)` and not write a third trap.
25. **Every overhead write re-reads both lists rather than patching the cache locally.** POST and
    PUT answer with the single item they touched and DELETE answers with nothing, but the server
    also appends an `overhead_snapshots` row on all three and returns items in its own
    `ORDER BY category, name COLLATE NOCASE`. Reproducing that sort and that append in the browser
    would be two things that have to stay in step with the server forever, to save two round-trips
    on a list the brief itself says stays small. So `refreshCache()` GETs both and puts them in
    `LSCData` — which is also what keeps decision 19's promise that the Pricing tab one click away
    computes against fresh data.
26. **Category has a "Choose a category" placeholder; frequency defaults to Monthly.** A deliberate
    asymmetry, not an inconsistency. Most overhead genuinely is monthly, and a wrong frequency is
    visible immediately in the Monthly Equivalent column, so a default there saves a click and
    corrects itself. There is no majority category, and a silently defaulted one is invisible once
    saved — the studio rent would just be filed under Software forever for anyone who tabbed past
    it. So category has to be chosen and `problems()` says so if it isn't.
27. **`.field select` is styled in `overhead.css` as a general rule, not scoped to this modal.**
    `app.css` styles `.field input` and `.field textarea` but never had a `.field select` to style
    — the app's other selects (`.svc-select`, `.doc-type-select`) sit outside `.field` with their
    own rules. These two are the first, and the Goals form is likely to want the same, so it is
    written as the general case. `font: inherit` is load-bearing: a bare `<select>` otherwise
    renders in the UA's font at the UA's size, which on this dark surface reads as a control
    borrowed from another application.
28. **The Summary Card shows `$0.00` when there are no expenses — not an em dash.** This looks like
    it contradicts decision 13, and doesn't. Decision 13 is about figures that *cannot be computed*:
    a rate with no billable capacity to divide by, where "$0.00" would assert that an hour of your
    time costs nothing. An overhead total of zero is computable and true — you have recorded no
    costs — and `annualOverheadTotal([])` returns `0`, not `null`, for exactly that reason.
    TASKS.md specifies "$0 Summary Card" explicitly. The em-dash rule still governs everything
    downstream: with zero overhead, `overheadRatePerHour()` still returns `null` and Pricing still
    shows dashes.
29. **The modal holds Cost as the string the field shows, not a number.** `num()` on every
    keystroke would turn a half-typed "1." into `1` under the cursor, and — worse — an empty field
    into a `0` that `problems()` could no longer tell apart from a deliberate zero, so a blank Cost
    would save as a free expense and quietly drag the annual total down. It is parsed once, on the
    way out, after validation. Same reason the Pricing screen keeps `taxRaw` as typed.

30. **The Goals screen's tax write sends the whole rate card, not just the field.** `PUT
    /api/pricing` replaces `pricing.data_json` with the request body verbatim, and `readPricing()`
    returns whatever is in there with no merge against `DEFAULT_PRICING` — so the obvious-looking
    `LSCApi.put('/api/pricing', { taxSetAsideRate })` would not have updated one field, it would
    have deleted every category, service and travel row on the card. `computeTotals` iterates
    `pricing.labourSections` and skips rows it can't find, so the damage would have surfaced as
    estimates quietly pricing labour and travel at zero, not as an error. The body is
    `Object.assign({}, LSCData.pricing(), { taxSetAsideRate })` and must stay that way. Checked
    rather than reasoned about: the stored card was fingerprinted before and after four separate
    saves from this screen and came back identical each time (3 sections / 18 labour rows / 5
    travel rows). Nothing in DESIGN_BRIEF.md or TASKS.md mentions this — they say "reuses
    `.tax-setting` verbatim, reading/writing `pricing.taxSetAsideRate` via the existing
    `/api/pricing` route", which reads like a field-level write and isn't one.
31. **One Save button over two endpoints, run in sequence, with a partial-failure message.** The
    brief asks for a single explicit Save and the IA doc groups the tax control with the other
    rate-driving inputs, so the button writes `/api/goals` and then — only when the tax field
    actually changed — `/api/pricing`. Sequential rather than `Promise.all` because a parallel pair
    that half-fails cannot say which half, and "saved" meaning saved is the reason this whole
    rewrite exists. When the second write fails the message says the goals were saved and the tax
    reserve wasn't, the three goals fields go clean while the tax field stays dirty, and the Save
    button re-enables for a retry. Forced and checked in a browser, not just written.
32. **Target Annual Revenue recomputes on every keystroke, unlike Pricing's rate column.** Pricing
    computes its rate once at mount because its inputs live on another screen and cannot move while
    you look at it. These three inputs are directly above the figure they produce, and a planning
    number that only appears after a save makes the screen read as broken. Neither is persisted, so
    there is nothing for a live figure to disagree with — decision 19 is about persistence, not
    about when a derived figure is allowed to recompute. The form deliberately does **not**
    re-render on input; only the value and its note are replaced, so focus never leaves the field
    being typed into.
33. **All three goals fields are required, and Billable Capacity is capped at 168.** The route
    coerces a blank with `Number(x) || 0`, so a half-filled save would store a 0 capacity, and
    `overheadRatePerHour()` returns `null` on a zero divisor — meaning every labour rate on Pricing
    would go back to an em dash under a note telling you to come here and set it, having just come
    here and set it. The 168 ceiling is not pedantry: these are hours inside one week, and a year's
    worth typed into a weekly field (960, say) divides the annual overhead by fifty times too many
    hours and under-recovers it on every job afterwards with nothing on any screen looking wrong.
    Target Profit Margin deliberately has **no** upper bound — `minimumJobPrice()` accepts any
    margin from 0 up, and a view should not be stricter than the function it feeds.
34. **The tax field uses Pricing's exact 0-100 rule, including accepting 100.** Two screens writing
    one stored number must not disagree about what a valid one is, so this validation is copied from
    `pricing.js` rather than tightened. A rate of exactly 100 still leaves Target Annual Revenue
    uncomputable (`targetAnnualRevenue` guards `rate >= 1`), and the stat says so in its own
    sentence instead of the save being blocked for it.
35. **`.goals-outcome` repeats `.oh-summary`'s two hover resets rather than hoisting them.** Both
    are a `.proj-card` with its navigation affordances taken back off, and decision 24's rule —
    the literal way to reuse an implementation is to share it — argued for a shared modifier. It
    was not applied here because this is two CSS declarations, not a focus trap, and hoisting means
    editing a verified screen's markup and CSS from a task that otherwise doesn't touch it. **If a
    third stat card appears, hoist it then** — that is the point where the copies start being
    chances to disagree.
36. **The screen calls its shared field "Tax Reserve Target (%)" while Pricing calls the same
    stored number "Tax Set-Aside Rate (%)".** The brief and TASKS.md both name it Tax Reserve
    Target, so that name is used here rather than silently renaming a verified screen's label. The
    caption under it says out loud that it is the rate card's Tax Set-Aside Rate and that changing
    one changes the other, which is what ties the two names together for anyone who notices. Two
    names for one number is still a "one number, one truth" wart — flagged for the design review
    below rather than resolved by widening this task.

37. **The charts live in `web/js/views/overhead-charts.js`, not in `overhead.js`.** TASKS.md scoped
    the task to "a new component" without naming a file. `overhead.js` was already ~484 lines of
    CRUD — a table, a modal and four write paths — and the charts share none of that state: they
    are markup in, markup out over the same cache. Putting both of them inside it would have taken
    it past 850 lines, which is the size the last session's own note said to check for. The module
    holds no element references at all, because `OverheadView.render()` rewrites `root.innerHTML`
    wholesale on every write and anything kept across that is a reference to a node no longer in
    the document. **The donut goes in this file too** — that is half the reason it exists.
38. **The trend chart's x axis is event order, not elapsed time, and the chart says so in its own
    caption.** `overhead_snapshots` gets a row per add/edit/delete whenever those happen, not on a
    schedule: the four rows in the scratch database are **twelve milliseconds apart**. On a true
    time axis they stack into one vertical line, and one edit made a year later would own the whole
    width while everything before it collapsed to a dot — a chart that is technically accurate and
    tells you nothing. Points are therefore spaced evenly in order, with the dates under the line
    carrying the elapsed time. The honest fix for the resulting distortion is to *state* it rather
    than to encode it, which is what `.oh-chart-caption` is for: "spaced evenly in the order the
    changes happened, not by how far apart in time they were." **Don't silently switch it to a time
    axis** — the data shape that makes that unreadable hasn't changed. The same applies to the
    donut if it ever grows a time dimension.
39. **The y axis always starts at zero, and a stepped line was considered and rejected.** A money
    chart auto-scaled to its own minimum turns a 2% rise into a cliff, and this is the number the
    rate card is computed from. On the line shape: overhead is really a step function (a total
    holds until the next change), but with event-ordered spacing a plateau's *width* means nothing,
    so a step implies a duration that is as fake as a slope implies a drift. Both are fake; the
    plain line is the conventional reading of "trend" and the caption carries the caveat.
40. **The svg is drawn at the container's measured pixel width, not scaled from a fixed `viewBox`.**
    One user unit is one CSS pixel, so an 11px axis label is 11px at every breakpoint. The usual
    hand-rolled alternative — one fixed `viewBox` plus `width:100%` — renders that same label at
    ~15px on a 1000px screen and **under 4px at 375px**, which is how a chart like this becomes
    unreadable on a phone. Two things this cost, both caught by measuring and both easy to
    reintroduce: `clientWidth` **includes the container's padding**, so drawing to it produced an
    svg 32px wider than its box that `width:100%` then scaled back down (998 user units rendered
    into 966 pixels); and a `Math.max(320, …)` floor did the same thing again at a 375px viewport,
    where the real content box is 309px. `contentWidth()` now subtracts the padding and only floors
    a box with no layout at all. The CSS keeps `width:100%` deliberately — that is the graceful
    path for a window dragged between redraws, not the sizing mechanism.
41. **The axis labels are abbreviated money (`$24k`), not `fmt()`.** `fmt()` is right in the
    tooltip and the head line — exact dollars and cents — and wrong down the side of a chart:
    "$24,000.00" five times is more precision than an axis carries and pushes the plot into the
    margin. Tick *values* still come off a 1/2/2.5/5 ladder so they are round money rather than a
    quarter of whatever the largest total happens to be.
42. **The direction of travel is stated in words ("Up $22,800.00 since 15 Sep 2026"), never in a
    colour.** There is no green and no red in this palette, and inventing a pair for up/down would
    be a second scoped palette exception on the same screen as the donut's — which the brief
    reserves for the donut alone. It is also the accessible form: nothing in this chart is carried
    by colour only, since every point has a `<title>` and the `<svg>` has a `role="img"` and an
    `aria-label` naming the count, the endpoints and their dates.
43. **The trend line is `--accent` at a measured 3.71:1 against `--bg`, which is under the brief's
    blanket 4.5:1 for chart colours and over WCAG 1.4.11's 3:1 for graphical objects.** Flagged
    rather than diverged from, for the same reason decision 21 flagged accent-on-hover: 4.5:1 is a
    *text* threshold, the applicable rule for a 2px chart stroke is the 3:1 one, and this palette
    has no lighter accent to reach for — `--ah` is darker. Hitting 4.5:1 would mean inventing a
    colour, which is precisely the exception the brief scopes to the donut. The axis text, which
    *is* text, measures 6.15:1. Decide it in the **Accessibility pass** alongside the accent items
    already queued there, not by quietly introducing a second accent here.
44. **One point is not a trend, and it gets a sentence instead of a chart.** Two empty states, not
    one: no snapshots at all ("the line starts as soon as you add your first expense") and exactly
    one ("One change recorded so far, on 4 Mar 2026 — $8,400.00 a year"). The single-point case is
    the state the screen is in for the whole of a first session, so it is worth its own copy rather
    than an axis drawn around one value.
45. **Markers come off above 40 points or below 14px of spacing, and the hover targets shrink with
    the spacing.** Years of edits put hundreds of points across 600px; a solid bar of overlapping
    circles is noise, so the line and the tooltips stay and the dots go. The transparent hit circles
    (`fill="transparent"`, not `fill="none"` — "none" stops pointer events and would make the
    tooltip unreachable) scale from r=11 down to r=4, because overlapping targets hand every hover
    to whichever was drawn last and the tooltip would name a point several steps from the cursor.
46. **Axis date labels carry a 2-digit year only when the chart crosses one.** A fourteen-point
    fixture running Jan 2025 → Feb 2026 labelled its ends "12 Jan" and "12 Feb", which reads as ten
    months backwards. Within a single year the year is noise, and the full date is in every
    tooltip regardless. Related: when *every* point falls on one day — which is exactly what a
    first session of data entry produces — the axis prints one centred full date instead of the
    same short date four times.
47. **One `resize` listener for the life of the page, added on first mount.** It re-queries
    `#oh-trend-canvas` each time rather than closing over it, so it survives the wholesale
    re-render and does nothing at all when Overhead isn't the screen on show; it is handed a
    *getter* for the snapshot list rather than today's array, so a resize after a write redraws
    what the screen is actually showing. Debounced at 150ms. Verified by driving the viewport 375px
    → desktop and reading the redrawn `viewBox` (309 → 895, 1:1 both times).

48. **The scoped palette is five measured colours, and the accent is knowingly the weakest of the
    six.** The brief reserves its one exception to the single-accent rule for this chart:
    `--accent` marks the largest category and the rest run a desaturated warm ramp. The ramp is
    `#ce8a4f` ochre, `#a8a39b` warm grey, `#dcbe8b` pale sand, `#b0968a` rose-taupe, `#c9c3b9`
    light grey, measured at **6.23, 7.08, 9.96, 6.41 and 10.14:1 against `--bg`** and 4.71 to
    7.66:1 against `--surface` — every step over the brief's 4.5:1 on both. The background that
    actually matters is `--bg`: an `.est-block` has a border and no background of its own, checked
    by walking the tree rather than assumed. `--accent` itself is 3.71:1, which is decision 43's
    already-flagged case and is deliberately *not* forked into a second, lighter terracotta here —
    inventing a colour is the thing this exception exists to do once, not twice. Settle it in the
    **Accessibility pass** with the other accent items, and settle it for both charts at once.
    Two consequences worth keeping: the classes are **ranks, not categories** (`.oh-c1` is always
    the biggest slice), so the accent always lands on the number that matters most and the palette
    doesn't reshuffle when the expenses do; and each rank's colour is **one custom property read by
    both the slice and its legend swatch**, so a swatch cannot drift out of step with the segment
    it stands for, which is the only job a legend has. Adjacent slices carry a 2px `--bg` stroke,
    so no slice is ever judged against the colour beside it — six mutually-3:1 colours do not exist
    inside a restrained warm band, and separating them against the page is the answer that does.
49. **The donut has no `draw()` phase, unlike the trend chart beside it in the same file.** The
    previous session's handover suggested copying the trend's `*Markup()` + `draw*()` split. That
    split exists for one reason — the trend is drawn at its container's *measured* pixel width, so
    it cannot be built before it is in the document (decision 40). The donut is a fixed 200px
    square with no text in the ring but the total in its hole, so there is nothing to measure and
    nothing to defer; a second phase would only add a `draw()` that can silently no-op when its
    canvas isn't there, in exchange for nothing. It is also why the donut is **not** in
    `bindResize()`: a resize changes where the HTML legend wraps, not what is drawn. The file's
    header comment says all of this out loud, because two shapes in one module otherwise reads as
    an oversight.
50. **The figure in the hole is sized to fit the hole, not set once at a fixed size.** At 19px,
    "$24,000.00" measures 119.3px inside a 128px hole — four pixels of air a side, which looks
    perfectly fine on the seeded data and runs out over the ring the moment an overhead total
    reaches seven figures ("$1,240,000.00" is 13 characters). `centreSize()` divides a 116px budget
    by a measured 0.628em-per-character, clamped to 11–19px, and it was checked in the browser from
    $900 to $124,000,000 — every figure lands with at least 10px of air each side. **The first
    constant was wrong and looked right**: 0.597, measured before `Delight` had loaded, describing
    the Georgia fallback. Anything measuring text in this app should `await document.fonts.ready`
    first. The size is a presentation attribute rather than CSS on purpose — a `font-size` in
    `overhead.css` would win over it and quietly undo the fit.
51. **Percentages are largest-remainder rounded, so the legend sums to exactly 100.0.** Rounding
    each share on its own gives a column that adds to 99.9 or 100.1, which on the screen the rate
    card is computed from reads as an arithmetic error rather than as rounding — and "one number,
    one truth" is this feature's second stated principle. Verified against three equal thirds
    (33.4/33.3/33.3) and against the live six-category state. The dollar column is not rounded at
    all: it is `annualisedCost()` per category, and it sums to exactly the figure in the hole.
52. **The donut slices by annualised cost, never by the `cost` column as typed.** A $1,500 monthly
    rent and a $1,800 annual hosting bill are $18,000 and $1,800 of the year; slicing by the typed
    figure would draw them as nearly equal, which is the one wrong answer this chart can give. It
    runs every figure through `annualisedCost()` — the same function the Monthly Equivalent column
    and the rate itself are built on — and the caption states the convention with those two
    examples in it, rather than leaving the reader to infer it.
53. **The legend is a static list, deliberately not interactive.** The brief's accessibility
    section lists "chart legend items" among the elements needing a focus ring, which reads as an
    expectation that they are focusable. Nothing happens when you click one — there is no filter,
    no drill-down and no highlight in this feature — and a focusable row that does nothing costs a
    keyboard user a stop for no return, which is worse than not having it. Checked rather than
    asserted: the block contains **zero** tabbable nodes. If a legend interaction is ever wanted,
    it needs a purpose first.
54. **Three states get sentences instead of a ring, and a fourth gets a slice-less legend row.** No
    expenses at all, and every expense recorded at `$0` (Cost accepts a deliberate zero, so a table
    with rows and a zero total is a real state, not a bug) — a ring of zero-width slices is not a
    chart. Separately: **one category owning everything is a closed `<circle>`, not a sector**,
    because a 360° arc starts and ends at the same point and svg paints nothing at all for it. And
    a category holding items that sum to `$0` alongside real ones keeps its legend row at
    `$0.00 / 0.0%` with no arc — the legend accounts for every expense in the table above it, which
    is what makes it the accessible form of the chart rather than a caption for it.
55. **The legend wraps below the ring on its own, with no media query — and the brief's 900px rule
    is left for the responsive task to settle, because measuring suggests it is wrong.** `flex-wrap`
    plus `flex: 1 1 260px` puts the legend under a centred donut at about a 606px viewport and
    below, which covers the phone band for free. The brief and TASKS.md both ask for the stack to
    start **below 900px**; measured at 768px the side-by-side arrangement is comfortable (legend
    439px, no name truncation, no overflow) and reads *better* than it does at 1280px, where the
    legend stretches across 734px. Stacking it there would be a downgrade. New responsive rules
    belong in `responsive.css` inside a media query by convention anyway, so this is flagged for
    the **Layout check** task to decide with the measurements in hand rather than implemented blind
    from the brief here. `margin-inline: auto` on `.oh-donut` is what centres the ring once it is
    alone on its line and does nothing before that, since auto margins only take leftover free
    space and `.oh-legend`'s flex-grow has already taken it on a wide row.

56. **The Minimum Job Price line is editor-only; `estimate-detail.js` was deliberately left
    untouched.** TASKS.md hedged this ("possibly `web/js/views/estimate-detail.js`") and the brief's
    only sentence about the detail view is about `clientPriceExGst`/`totalIncGst` not moving, which
    reads both ways. **Put to the user and settled on 2026-09-16: editor only.** Three reasons, in
    order of weight: the floor is a pricing-*decision* aid and the decision happens in the editor;
    it is recomputed from **today's** Overhead Rate and margin rather than the ones current when the
    estimate was saved, so on a quote sent months ago it would show a floor that estimate was never
    actually judged against; and there is no toggle on a read-only screen, so the brief's own
    promise that switching it off removes the line could not be kept there. The brief's "verify in
    both edit and read-only" requirement was still honoured as written — the saved estimate's
    detail view renders money identical to the editor's. **If this is ever revisited, the honest
    version is the third option the user was offered and declined for now: persist the floor and
    the rate/margin it used with the estimate**, which is a schema change and its own backend task,
    not a view tweak.
57. **The `(?)` cost-breakdown trigger is not in this task, and the line shipped without it.** Both
    the brief and the old 2026-09-07 brief describe the line as carrying a `(?)`, which makes it
    look like an omission. TASKS.md splits them into two tasks on purpose and the modal is the next
    unchecked item, so the trigger lands with the thing it opens rather than as a dead control for
    one commit. `#mjp-line`'s three spans (label / value / note) are where it goes.
58. **The toggle is the app's existing switch — a `<label>` wrapping a checkbox — not a new sliding
    control.** The brief says "inline switch", which invites building a pill. `.doc-gst-free` two
    sections up in the same file and settings' `.set-check` are both label-wraps-checkbox, and a
    custom switch here would be the only one in the app. It also inherits `a11y.css`'s focus ring
    for free: that file's selector list ends in a bare `input:focus-visible`, so every input in the
    app is already covered and **no new focus CSS was needed or added**. The 13×13px checkbox is
    under 44px at phone widths, which is `responsive.css`'s own documented, deliberate exemption
    ("Checkboxes are excluded: they size themselves, and a 44px one would push its own row apart"),
    not a new gap introduced here.
59. **Toggling runs the full `recalc()` rather than a lighter show/hide path.** The toggle changes
    nothing `computeTotals` reads, so re-running the whole pass is the cheap way to keep proving
    it: if this ever did start moving a headline figure, it surfaces in the bar immediately instead
    of hiding behind a shortcut that skipped the comparison. Verified as byte-identical across on →
    off → on for all eight figures.
60. **The overhead rate and margin are resolved once at mount, but the floor repaints on every
    keystroke.** Same split as `pricing.js`'s `computedRate` (decision 19's neighbourhood): nothing
    reachable from the editor can change an overhead item or a goal, so those two are fixed for the
    life of the screen; the hours and expenses they are multiplied by change constantly, so the
    line is painted from the totals `recalc()` already has rather than recomputed independently.
    Both live outside `payload()`, so they are never saved and — checked, not assumed — toggling
    never marks the form dirty while a real edit still does.
61. **An empty estimate shows `$0.00`, not an em dash, and that is correct.** The em dash is
    reserved for "cannot be computed" — no overhead rate, or no margin. A new estimate with no rows
    genuinely floors at zero, and every other figure in the bar above it reads `$0.00` in that same
    state, so a dash here would be the odd one out. The set-up prompt is strictly about Finance not
    being configured.
62. **`expenseTotal` is the `directJobCosts` input, and that is specified rather than chosen.**
    `calc.js`'s own docblock for `minimumJobPrice()` names it and TASKS.md repeats it. Worth knowing
    what it means: `expenseTotal` is the *billed* expense figure, so a marked-up travel row
    contributes its marked-up amount rather than its cost, which makes the floor slightly higher —
    the conservative direction, consistent with the rest of the file. A GST-inclusive rate card was
    checked directly rather than reasoned about and **does not skew it**: `computeTotals` derives
    `expenseTotal` before the GST split, so it is the same number under either setting.

63. **The dialog is handed the figures the line just painted, and computes nothing of its own.**
    `setBreakdown()` runs inside `paintMinimum()`, storing what it just put on screen; the modal
    renders that. Recomputing on open would be a second route to the same number and so a second
    chance to disagree with the line the `(?)` is attached to — the one thing a "here is how that
    was worked out" panel cannot afford to do. It also means the dialog cannot drift while open,
    since nothing behind a trapped modal can change the form.
64. **The Profit Margin row is a remainder, not its own multiplication.** The dialog's whole claim
    is that its three rows add to the figure under them, so the arithmetic a reader can do on it has
    to come out. Direct Job Costs arrives already rounded by `computeTotals`, but the overhead
    allocation is `hours × rate` and lands on sub-cent values routinely (7.5 × $29.41 = $220.575);
    rounding all three independently makes the printed column miss the printed total by a cent often
    enough to notice. So the two inputs are shown rounded and the margin is what is left of the
    floor after them. **Measured, not assumed**: a 2,240-case sweep over the exact expression the
    view uses found 0 column-sum mismatches and a worst-case drift from the true margin figure of
    $0.01, at a $2.2M floor. This is the same trade decision 51 made for the donut's
    largest-remainder percentages — both prefer the visible sum.
65. **The total is `--text`, not `--accent`, and the first draft was wrong about this.** Accent is
    spoken for by "Total (inc GST)", the figure a client actually pays; `estimates.css`'s own block
    comment above `.mjp-toggle-row` already settled that the advisory line does not wear it, and a
    dialog explaining that line should not out-dress it. The draft that did also measured **2.8:1**
    on `--surface`, under WCAG's 3:1 for large text, where `--text` is 11.49:1 — so the same change
    fixed a contrast miss and a hierarchy mistake. The rule above the figure and its 19px are what
    mark it as the sum.
66. **The `(?)` is hidden whenever the floor is `null`, rather than opening a dialog of em dashes.**
    The IA doc's flow says the unset state is a plain sentence, and there is no breakdown to show of
    a figure that could not be computed. `openBreakdown()` refuses independently of the trigger's
    visibility, so forcing the button visible still cannot produce a dialog of `undefined`s. It also
    leaves the focusable set, so a keyboard user never lands on a trigger for a line that is not
    there.
67. **The `(?)`'s touch target grows without the ring growing.** A 20px ring is the point — it
    annotates a number, and a 44px one beside a 17px figure outweighs what it points at. So
    `responsive.css` gives it an absolutely-positioned 44×44 `::after` inside the existing
    touch-target block rather than a `min-height`, which adds no layout box and leaves the line's
    height alone. This is the one responsive rule that was written now instead of being left to the
    **Layout check** task, because it closes a gap this task would otherwise have opened; it
    overhangs the figure to its left by ~4px, which costs nothing since that is a span, not a
    control.

68. **The donut legend's stacking point is the natural flex wrap at ~606px, not the brief's 900px —
    this settles decision 55.** Measured side by side: at 900px the legend is 571px wide, at 768px
    439px, at 767px 469px, with **no category name truncated at any of them**, and it stacks under
    a centred ring at 375px. Stacking at 900px would trade a legend that reads comfortably beside
    its ring for a 200px ring alone on a line with ~500px of empty space beside it, then the
    legend below — a longer, emptier screen for no legibility gain. So no media query was added.
    **This departs from the letter of the brief and TASKS.md**, which is why it is recorded here;
    if the user wants the brief's rule anyway it is one `flex-basis: 100%` on `.oh-legend` inside
    `@media (max-width: 900px)`.
69. **The Goals form keeps three columns from 768px up.** At 768px the columns are 231px, the
    longest hint runs four lines at ~38 characters, and the three inputs stay top-aligned because
    each hint sits under its input rather than above it. Checked in a screenshot as well as by
    measurement. The alternatives were worse: two columns orphan the third field beside a gap
    (which is why `.goals-grid` is three in the first place), and one column at 703px puts a
    two-digit percentage in a 703px input. Below 768px it is already one column.
70. **The save-bar fix is in the ≤1099px band, not ≤900px, and covers Pricing as well as Goals.**
    Goals reuses `.pricing-save-bar`, so the bug and the fix are shared. It is latent at 1099px
    (nothing wraps there) and engages where the sentence starts winning. Pricing is in scope because
    it is a Finance sub-tab now, even though the screen predates this feature.
71. **The Finance tab-underline fix is scoped to `.finance-tabs .nav-link`, not all `.nav-link`s.**
    The header's own nav collapses into the menu panel below 768px, where its links are a vertical
    list and the underline question does not arise; the sub-tab row is the only horizontal row of
    them left in that band. Changing the shared class would have touched the header for no gain.

72. **Both charts draw their terracotta from a chart-only tint, `--oh-chart-accent` (`#c26b5d`),
    not from `--accent`. Put to the user on 2026-09-18 and chosen by them** over the alternative
    two earlier sessions had leaned towards (keep `--accent` and read the brief's 4.5:1 as a text
    threshold, since WCAG 1.4.11's bar for graphics is 3:1). The brief's line is "Chart colours
    (including the scoped donut palette) … must hit ≥4.5:1", and the user preferred meeting it as
    written. `--accent` mixed 12% toward white keeps its hue; `#c06759` (11%) is the lightest that
    clears at all but sits on 4.50 exactly, so this is one step past it for margin. It measures
    3.55:1 on `--surface`, which is moot — neither chart sits on `--surface`. The brand `--accent`
    is untouched everywhere else, including the active tab underline and focus rings. Cost worth
    knowing: the largest slice is now 1.33:1 from the ochre beside it (was 1.73:1), which the 2px
    `--bg` separators and the legend carry, per decision 48. **This supersedes decisions 43 and
    48's "flagged, not changed" status on the accent.**
73. **The accent link-hover idiom stays, including on the two Finance links. User's call,
    2026-09-18.** `.pricing-rate-note-link` and `.goals-link` go `--accent` (3.71:1) on
    `:hover`/`:focus-visible`, as `.client-history-link` and `.toast-link` do site-wide. The resting
    state is `--text` with a permanent underline (decision 21), the underline stays in every state,
    and keyboard focus also gets the ring, so the state is never carried by colour alone. Offered
    and declined: fixing the Finance links only (would diverge from the rest of the site) or
    site-wide (out of this feature's scope). **This closes decision 21's "still open" note.**
74. **No `aria-live` on the live-recomputing figures, for now. User's call, 2026-09-18.** Goals'
    Target Annual Revenue, the editor's summary bar and the Minimum Job Price line all repaint on
    every keystroke and announce nothing. The brief does not require announcements and sets "the
    bar already built site-wide" as the standard, which this matches. Offered and deferred: a
    debounced (~1s), visually hidden `aria-live="polite"` region announcing the headline figure
    once typing pauses — the right shape if it is ever wanted, since a plain `aria-live` on a
    figure that changes per keystroke reads out every intermediate value. **Left for the design
    review** to raise again, not closed.

75. **Headings keep their old classes; only the tag changed.** Every class already sets its own
    size, weight and family, and app.css's `*` reset zeroes margins, so the swap is inert by
    construction; `a11y.css` adds `h1,h2,h3 { font-size/weight: inherit }` for the one class that
    set no weight (`.set-group-head`) and `.bb-label { display: inline }` because it was a span
    sitting inline beside its tag. Measured 0-box-diff (entry 20) — keep it that way: restyle via
    the class, never via the tag.

76. **Field errors go through one helper, and the summary box stays.** `showFieldErrors` writes
    each message as its own `<span id="<box>-<n>">` inside the existing `role="alert"` box (reads
    exactly like the old joined sentence), flags each named field with `aria-invalid="true"`,
    *appends* that span's id to the field's `aria-describedby` (so existing hints survive), and
    focuses the first flagged field. A field unflags on its own next `input`/`change`; the summary
    clears at the next save attempt, as before. `problems()` in each view now returns
    `{ msg, field }` (Pricing: `{ msg, fields }`, one sentence can cover several inputs).
    Server-side failures still use plain `showError` — they aren't about a field. Login is
    deliberately not wired: a wrong-credentials reply can't say which field is wrong.

77. **The invalid border is `--err-text` (#f0a0a0) with `!important`, not `--err-border`.** The
    box's #7a2222 is 1.33:1 on `--surface` — invisible as a field state; the pink is 6.54:1 and
    matches the message text. `!important` because input families set border-colour at up to
    (0,2,1), including on `:focus` and `.upid-field`'s own `!important`; focus is still shown by
    the outline. **Measuring trap:** `.field input` transitions all properties over 0.15s and the
    pane throttles transitions when hidden, so a read right after flagging returns the old
    border colour — read with `transition: none` or after a screenshot.

78. **The legend cap is on `.oh-legend-row`, not `.oh-legend`.** `.oh-donut`'s centring is
    `margin-inline: auto`, which works only because the legend's flex-grow eats all free space
    (see the comment above `.oh-donut`). Capping the list would hand ~290px back to the ring's
    auto margins and slide it right at desktop; capping the rows doesn't (donut x measured
    identical both ways).

79. **The error tokens live in `a11y.css`, not app.css's `:root`.** app.css is frozen by the
    Desktop Preservation Law; `--muted`'s override already set the precedent. The seven id-scoped
    error rules keep their own layout (margins and line-height differ per screen) and only take
    their colours from the tokens — a shared `.form-error` class would have meant fighting id
    specificity for `display` in every file for no visual gain. app.css's ported
    `.export-toast.err` still has the literal hexes; `a11y.css` re-points it at the tokens.

## Verifying your work

Same acceptance gate as `nas-hosted-billing`: `cd server && npm test` after any backend change.
New routes need tests in `server/test/test-api.js` following its existing pattern (ephemeral port,
log in once in `test.before`, reuse the cookie); new pure functions in `calc.js` need tests in
`server/test/test-calc.js` following its existing worked-example pattern — specifically include a
zero-billable-hours edge case for `overheadRatePerHour()` (must not divide by zero).

**A green suite is not the gate on its own** — `nas-hosted-billing/HANDOVER.md` already found two
bugs that passed every test in its suite because the tests never looked at what a person actually
sees. The same risk applies here: the Pricing screen's rate-column note, the Minimum Job Price
line, and both charts are all things a person *looks at* — verify them in a browser against
`api-scratch` (per `web/README.md`'s seeding instructions), not just via a passing `npm test`.

## Open items for whoever picks this up next

- **CLOSED 2026-09-18 by the Layout check — see decision 68.** ~~The donut's legend stacking point is an open question for the Layout check task, not a
  settled one.~~ The brief asks for it below 900px; measuring says side-by-side still reads well at
  768px and the natural wrap already happens at ~606px. See resolved decision 55 — it wants a
  decision with the measurements in hand, not a rule applied from the brief.
- **CLOSED 2026-09-18 by the Accessibility pass — both charts now use `--oh-chart-accent` at 4.70:1; see decision 72.** ~~`--accent` at 3.71:1 is now the fill of the donut's largest slice as well as the trend line's
  stroke.~~ Same colour, same background, same already-flagged gap against the brief's blanket
  4.5:1 for chart colours (decision 43, now also decision 48). It is one decision covering both
  charts and it belongs to the **Accessibility pass**; don't settle it for one chart alone.
- **Measure text only after `await document.fonts.ready`.** A `getBBox()` taken before `Delight`
  loads describes the Georgia fallback, which is narrower — it produced a fit constant this session
  that was wrong by 5% and looked entirely correct on screen. This sits alongside the
  `:focus-visible` note below as the second "measured it, still got a false reading" trap on this
  feature.
- **The `npm test` gate hung twice on 2026-09-18 with no code change behind it.** Three runs earlier
  the same session passed 91/91 in ~11s; then `test/test-api.js` and `test/test-pdf.js` sat idle at
  0% CPU indefinitely, and a rerun did the same. No `server/` file changed in between — the
  accessibility pass touched only `web/css/overhead.css`. The repo lives on a Google Drive-backed
  filesystem, and the `api-scratch` preview server was running against `/tmp` at the time; either
  could plausibly be involved, neither was proved. **The third run, with nothing changed, passed
  91/91 in 13s** — so it is transient, not a broken test. If it happens: `pkill -f "node --test"`
  and rerun (backgrounded, so a hang does not eat the tool timeout) before suspecting the code.
- **Three focus-ring measurement traps from the accessibility pass**, each producing a result that
  looks like a real bug:
  1. **A `focusin` recorder that reads each element after a timeout reports `outline: none` on
     everything** when real Tabs are sent with `repeat`: the presses outrun the reads, so each
     element is measured after focus has already left it. Only the last stop reads correctly.
  2. **`.btn` has `transition: .15s` on all properties, so the ring animates in.** A read 15ms
     after focus reports colours like `rgba(227, 203, 195, 0.66)` — the outline mid-fade from
     currentColor to accent. Wait ~220ms and every one settles to `rgb(184, 84, 68)`.
  3. **`requestAnimationFrame` never fires while the Browser pane is hidden** (already noted
     below) — a sweep awaiting two rAFs per element hung the tool for 45s. Use timers.
  **The method that works:** one *real* Tab (the harness's key events carry an empty `event.key`,
  but focus movement is genuine and flips the browser into keyboard mode), then focus every
  element by script — Chromium keeps `:focus-visible` on scripted focus while the last real input
  was a keypress — and assert `el.matches(':focus-visible')` on each, so a stop that silently lost
  keyboard mode is caught rather than read as a missing ring.
- **A contrast helper that treats the first non-transparent ancestor background as opaque reports
  a false catastrophe.** The summary bar's "Total (inc GST)" cell is `rgba(184,84,68,0.08)` and its
  text is `--accent`; a helper that stops at that first background and ignores its alpha composites
  accent over accent and reports **1:1** — which reads as the worst contrast bug in the app, in code
  nobody touched this session. Composite the whole ancestor stack down to `--bg`; the real figure is
  **3.46:1**, comfortably over the 3:1 bar that 19px/700 large text has to clear. This is the third
  "measured it, still got a false reading" trap on this feature, alongside the `:focus-visible`
  recalc and the `document.fonts.ready` one — and the only one that incriminates existing code, so
  it is the one most likely to send the next session chasing a ghost.
- **Real key events reach the Browser pane with an empty `event.key`.** Pressing Return on a focused
  `<button>` through the pane's `computer` tool delivers a keydown the page sees as `key: ""`, so the
  browser never synthesizes the button's click and any handler reading `event.key` (every Escape
  handler in this app) never fires. It looks exactly like a broken control: this session's first
  reading was "Enter does not open the dialog", which was the harness, not the app. **Focus movement
  from a real Tab is genuine**, and it is the only way to get `:focus-visible` to resolve, so the
  working split is: real Tab for focus and focus-ring checks, dispatched `KeyboardEvent`s of the
  right shape for Escape/Enter behaviour, dispatched `.click()` for activation. The **Accessibility
  pass** is going to measure exactly this on a dozen elements, so read this before concluding that
  any keyboard interaction is broken.
- **Nothing is blocked.**
- **The app stopped both preview servers twice mid-verification**, ~3 minutes into each run, with a
  clean `SIGTERM received, shutting down.` in the log — not a crash, and nothing to do with the
  code under test. It surfaces in the browser as "The server could not be reached" on a screen that
  was working a moment earlier, and in `javascript_tool` as a bare `TypeError: Failed to fetch`.
  If a verification run suddenly starts failing that way, check `preview_logs` before debugging the
  app: `preview_start` brings it straight back, and the session cookie survives.
- **A `location.reload()` re-serves the stylesheet from cache, so new CSS can be silently absent.**
  `web/README.md` already warns about this for scripts; it bit again here for `css/estimates.css`
  and cost a round of confused measurements — the rule was on disk, on the dev server and in the
  `<link>`, and simply not in `document.styleSheets`. **`fetch(url, {cache:'reload'})` first, then
  reload** — and the cheap way to be sure is to assert the rule is really live before measuring
  anything: `[...document.styleSheets].some(s => [...s.cssRules].some(r => r.selectorText === '.your-class'))`.
- **Two browser-measurement traps in one feature, both of which look like real bugs.** Neither is
  about this app's code: `requestAnimationFrame` **never fires while the Browser pane is hidden**,
  so the two-rAF `:focus-visible` trick noted below hangs rather than returning a wrong answer; and
  a hidden pane reports `window.innerWidth === 0`, which makes every `getBoundingClientRect()` read
  like a catastrophic layout collapse (a full-width bar measuring 2px). Set an explicit viewport
  with `resize_window` before measuring, and prefer `read_page` to screenshots while the pane is
  hidden — a screenshot of a hidden pane is a blank rectangle, not an error. The previous session's one open item (the category/frequency enum
  spellings) was put to the user and confirmed as-is — see resolved decision 11.
- **CLOSED: every calc function has now been seen rendering in a browser, in both its states.**
  `overheadRatePerHour()` closed on the Pricing rate column, `targetAnnualRevenue()` on the Goals
  stat, and `minimumJobPrice()` on the estimate-editor line as of 2026-09-16 — em dash for `null`,
  money for a real figure, with no `$0.00`, `NaN` or `$Infinity` reaching any screen in any state.
  The failure mode decision 13 is shaped to prevent — a view coercing `null` to `0` on its way out
  — is now checked by eye on all three. Keep the habit for anything new that renders one. The
  original wording of this item follows, for the history:
- **The calc functions have now been seen rendering in a browser — for the first time, on the
  Pricing rate column.** Both states were checked by eye against `api-scratch`: `null` renders as a
  muted em dash and `25` renders as `25.00`, with no `$0.00`, `NaN` or `$Infinity` anywhere. That
  closes this item for `overheadRatePerHour()` specifically. It stays open for
  `minimumJobPrice()` and `targetAnnualRevenue()`, which still have no screen rendering them —
  keep checking it by eye as the Goals stat and the estimate-editor line land, since a view
  coercing `null` on its way out is the failure mode decision 13 is shaped to prevent and only a
  person looking at the screen will catch it.
- **As of 2026-09-18 `api-scratch` was re-seeded from scratch** (the `/tmp` directory had been cleared) with the same four items and goals singleton, **plus eleven hand-written historical snapshots** from Jul 2025 to Aug 2026 so the trend chart has a real line across a year boundary to measure — 12 in total. Each row's `by_category_json` sums to its `total_annual` and no category is negative, so it is a state the app could have produced. Reset by deleting `/tmp/lsc-billing-scratch` and re-seeding. The older note follows:
- **`api-scratch` now holds eight snapshots, not the four it was seeded with.** Verifying each
  chart's live-update path meant a real Add Expense and a real Delete through the modal — the trend
  chart's session added two and the donut's added two more — and every one of those appends a
  snapshot. The line now rises to $25,200, returns to $24,000, rises to $24,720 and returns again.
  That is a state the app produces itself, not a corrupted fixture, and the four `overhead_items`
  and the goals singleton are untouched (Pricing re-checked after each: all 18 labour rates still
  `25.00`). Reset it by deleting `/tmp/lsc-billing-scratch` and re-seeding if a clean four-point
  line is wanted.
- **The `api-scratch` database is seeded with the brief's worked example**, so the screens
  still to be built have something to render: four `overhead_items` totalling **$24,000/yr**
  (Adobe CC $100/mo, Accountant $750/qtr, hosting $1800/yr, studio rent $1500/mo — four different
  categories and three different frequencies), one matching `overhead_snapshots` row, and a `goals`
  singleton at $90,000 net / 25% margin / 20 hrs per week, which is what makes the rate come out at
  exactly $25/hr. Written straight into the SQLite file rather than through the API, but in the
  shape `writeSnapshot()` produces, so `by_category_json` adds back to `total_annual` — it is not a
  state the app couldn't have reached itself. Reset it by deleting `/tmp/lsc-billing-scratch` and
  re-seeding per `.claude/launch.json`.
- **Browser caching bit hard during verification.** `python3 -m http.server` serves the static
  files with no cache-busting, and an edited `css/pricing.css` kept loading from cache across
  ordinary reloads — long enough to look like the CSS simply wasn't working. If new styles or
  scripts seem not to apply, re-fetch them with `fetch(url, { cache: 'reload' })` before
  `location.reload()` rather than assuming the change is wrong.
- **CLOSED 2026-09-18 by the Layout check — it was worse than noted: the cell overflowed its own 20px box. Fixed; see entry 17.** ~~Below 768px the expense table's action cell sits left while every other cell right-aligns its
  value.~~ `responsive.css` turns each `.est-table` cell into a `justify-content: space-between`
  flex row keyed off its `data-label`; the actions cell has no label, so Edit and × end up on the
  left of the row instead of under the values above them. It is legible and nothing overlaps —
  noted for the **Layout check at 1099px / 900px / 768px** task rather than tuned here, both
  because new responsive rules belong in `responsive.css` inside a media query by convention and
  so the whole Finance area gets measured in one pass instead of this cell being adjusted twice.
- **CLOSED 2026-09-18 by the Layout check — measured at 16px, now 8px at every width; see entry 17 and decision 71.** ~~The sub-tab row's active underline sits ~12px below its label below 768px~~, because
  `.nav-link` gets `min-height:44px` there (responsive.css's touch-target rule) while the text
  stays vertically centred. It is legible and consistent with the rest of the system — the header's
  own nav does the same thing — but it reads a little loose. Noted for the **Layout check at
  1099px / 900px / 768px** task rather than tuned here, so the whole Finance area gets measured in
  one pass instead of this row being adjusted twice. Otherwise the row behaves at 375px: one line,
  no wrap, no horizontal overflow (`body.scrollWidth` 375 at a 375px viewport).
- **CARRIED INTO THE DESIGN REVIEW as should-fix 5, not yet actioned.** **The preload's failure copy is now slightly narrow.** `app.js`'s catch still says "Couldn't load
  your rate card", but the `Promise.all` behind it now also fetches overhead, snapshots and goals —
  so a 500 from `/api/overhead-items` shows a message naming the rate card. The remedy it gives
  ("once the server is back, reload the page") is right either way, so it was left alone rather
  than reworded mid-task; worth a second look during the design review.
- **`:focus-visible` cannot be read with `getComputedStyle` immediately after `.focus()`.** Doing
  so during this session's accessibility check reported the browser's default ring on three fields
  and the Save button, and looked exactly like a real regression — it survived a cross-check
  against another screen's button, which failed the same way for the same reason. The pseudo-class
  needs a style recalc first: `await` two `requestAnimationFrame`s between focusing and reading and
  every control reports a11y.css's `2px solid var(--accent)` @2px correctly. Worth knowing before
  the **Accessibility pass** task, which is going to measure exactly this on a dozen elements.
- **`--muted` is `rgba(240, 237, 232, 0.6)`, not an opaque colour.** Any contrast check that reads
  its three channels and ignores the alpha measures `--text` by mistake and reports every muted
  string as 15.21:1. Composite it over the background first. Correct figures on this feature's
  surfaces: muted on `--bg` is **6.15:1**, muted on `--surface` (inside a `.proj-card` or the save
  bar) is **5.2:1** — both over the brief's 4.5:1 bar, but the second one is the tighter of the two
  and is where a smaller type size would start to matter.
- **REVIEWED 2026-09-18 — the design review recommends closing this as-is**: the Goals hint already reconciles the two names on screen. Original item: **Two names for the shared tax field** — "Tax Reserve Target" on Goals, "Tax Set-Aside Rate" on
  Pricing, one stored `pricing.taxSetAsideRate`. Both names come from the source documents (see
  resolved decision 36). Worth settling on one during the design review.
- **CLOSED 2026-09-18 by the Layout check — kept deliberately; see decision 69.** ~~The Goals form keeps three columns from 768px up, where the columns measure 231px and the
  longest field hint runs four lines.~~ Legible and not overflowing — measured at 1400/900/768/375px
  — but tight enough to be worth a look during the **Layout check at 1099px / 900px / 768px** task,
  which is where a new `max-width` rule would belong anyway.
- **DEFERRED TO THE DESIGN REVIEW by the user on 2026-09-18 — see decision 74.** The live Target Annual Revenue figure carries no `aria-live`, so a screen-reader user typing
  into the fields is not told it changed. This matches the estimate editor's `.summary-bar`, which
  recomputes the same way on every keystroke and announces nothing either — it is a site-wide gap
  rather than something this screen introduced, so it is flagged for the **Accessibility pass**
  where both can be decided together, rather than diverged from here (the same call decision 21
  made about accent-on-hover contrast).
- `server/src/calc.js` is 428 lines, `server/src/db.js` ~290, and there are now two new route files
  (`overhead.js` ~95 lines, `goals.js` ~45 lines) plus ~90 new lines in `test-api.js`. On the
  frontend `web/js/views/pricing.js` is now ~690 lines, `web/js/views/overhead.js` ~490,
  `web/js/views/goals.js` ~506, `web/js/views/overhead-charts.js` ~300 and
  **`web/js/views/estimate-editor.js` ~1138, which is now the largest file in the app** — the
  cost breakdown dialog added ~140 to a file that was already the biggest. It is still one screen's
  worth of one screen's concerns, and the dialog is genuinely part of the editor's summary block, so
  it was not split; but it is the file to look at first if anything here grows again, and decision
  37's reasoning about splitting the charts out of `overhead.js` *before* they made it unmanageable
  is the precedent for how to do it. None need splitting yet
  — see resolved decision 12 for why `calc.js` specifically should stay one file, and decision 37
  for why the charts were split out of `overhead.js` *before* they made it one of these — but check
  before assuming that still holds after the next big addition.
- **CLOSED 2026-09-18 by the Layout check:** scale 1.000 at every width, 5 date labels from 767px up and 2 at 375px, the head line ("Up $5,400.00 since 3 Jul 2025") on one line beside the title at every width including 375px, height 240px down to 767px and 200px on a phone. Nothing needed changing. Original item: ~~The trend chart has only been measured at 1400px and 375px~~, which is where its own two
  failure modes were (a scaled `viewBox`, and a floor fighting the real box width). The **Layout
  check at 1099px / 900px / 768px** task still owns the middle band: the chart redraws itself at
  the measured width on resize, so what to check there is the *content* at those widths — how many
  date labels survive (the rule is one per ~120px, so 5 on desktop and 2 on a phone), whether the
  head line "Up $22,800.00 since 15 Sep 2026" still fits beside "OVERHEAD TREND" in an
  `.est-block-head` at 768px, and whether 200px of chart height is still enough once the donut sits
  above it.
- **CLOSED 2026-09-18 — see decision 72.** ~~The trend line's `--accent` measures 3.71:1 on `--bg`~~ — over WCAG's 3:1 bar for a graphical
  object, under the brief's blanket 4.5:1 for chart colours. See resolved decision 43 for why it
  was flagged rather than changed; it belongs in the **Accessibility pass** with the accent items
  decision 21 already queued there, and it is the same question the donut's palette will raise.
