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
progress — the nav shell, the Pricing rate column, the Overhead screen, the Goals form and the
Overhead Trend chart are in, 5 UI tasks to go)** → Design Review
(not applicable yet).

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

**Not started:** everything else in TASKS.md, starting with the **Category Breakdown donut +
legend**. `web/js/calc.js` is byte-identical to the server money model and must be re-copied
(`cp server/src/calc.js web/js/calc.js`) after *any* edit to `calc.js`.

**To resume:** open [TASKS.md](TASKS.md), start at the first unchecked item (currently **Category
Breakdown donut + legend**, `frontend — Opus/high`), state its model/effort bucket out loud before
writing code, and work top-down. The donut has real data to draw and a file to live in:
`web/js/views/overhead-charts.js` is already the charts module (decision 37), and the donut is
computed from `LSCData.overheadItems()` grouped by category — not from `overhead_snapshots`'
`by_category_json`, which is the historical record rather than the live one. **It mounts between
the expense table and the trend chart**, per the IA doc's content order ("what's costing me" above
"is it getting better or worse"); `overhead.js`'s `markup()` has a comment marking the spot. Follow
the trend chart's shape: a `*Markup()` that returns the block with an empty canvas div, and a
`draw*()` that fills it after the markup is in the document, because `OverheadView.render()`
rewrites `root.innerHTML` wholesale on every write and nothing may hold an element reference across
that. `contentWidth()` and `bindResize()` are already there to reuse.

After the donut come the last money-math tasks, the estimate-editor toggle and the cost breakdown
modal. `minimumJobPrice()` still has no screen rendering it, which is the open item flagged below.

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

- **Nothing is blocked.** The previous session's one open item (the category/frequency enum
  spellings) was put to the user and confirmed as-is — see resolved decision 11.
- **The calc functions have now been seen rendering in a browser — for the first time, on the
  Pricing rate column.** Both states were checked by eye against `api-scratch`: `null` renders as a
  muted em dash and `25` renders as `25.00`, with no `$0.00`, `NaN` or `$Infinity` anywhere. That
  closes this item for `overheadRatePerHour()` specifically. It stays open for
  `minimumJobPrice()` and `targetAnnualRevenue()`, which still have no screen rendering them —
  keep checking it by eye as the Goals stat and the estimate-editor line land, since a view
  coercing `null` on its way out is the failure mode decision 13 is shaped to prevent and only a
  person looking at the screen will catch it.
- **`api-scratch` now holds six snapshots, not the four it was seeded with.** Verifying the trend
  chart's live-update path meant a real Add Expense and a real Delete through the modal, and each
  appended a snapshot — so the chart's line now rises to $25,200 and comes back to $24,000. That is
  a state the app produces itself, not a corrupted fixture, and the four `overhead_items` and the
  goals singleton are untouched (Pricing re-checked afterwards: all 18 labour rates still `25.00`).
  Reset it by deleting `/tmp/lsc-billing-scratch` and re-seeding if a clean four-point line is
  wanted for the donut work.
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
- **Below 768px the expense table's action cell sits left while every other cell right-aligns its
  value.** `responsive.css` turns each `.est-table` cell into a `justify-content: space-between`
  flex row keyed off its `data-label`; the actions cell has no label, so Edit and × end up on the
  left of the row instead of under the values above them. It is legible and nothing overlaps —
  noted for the **Layout check at 1099px / 900px / 768px** task rather than tuned here, both
  because new responsive rules belong in `responsive.css` inside a media query by convention and
  so the whole Finance area gets measured in one pass instead of this cell being adjusted twice.
- **The sub-tab row's active underline sits ~12px below its label below 768px**, because
  `.nav-link` gets `min-height:44px` there (responsive.css's touch-target rule) while the text
  stays vertically centred. It is legible and consistent with the rest of the system — the header's
  own nav does the same thing — but it reads a little loose. Noted for the **Layout check at
  1099px / 900px / 768px** task rather than tuned here, so the whole Finance area gets measured in
  one pass instead of this row being adjusted twice. Otherwise the row behaves at 375px: one line,
  no wrap, no horizontal overflow (`body.scrollWidth` 375 at a 375px viewport).
- **The preload's failure copy is now slightly narrow.** `app.js`'s catch still says "Couldn't load
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
- **Two names for the shared tax field** — "Tax Reserve Target" on Goals, "Tax Set-Aside Rate" on
  Pricing, one stored `pricing.taxSetAsideRate`. Both names come from the source documents (see
  resolved decision 36). Worth settling on one during the design review.
- **The Goals form keeps three columns from 768px up**, where the columns measure 231px and the
  longest field hint runs four lines. Legible and not overflowing — measured at 1400/900/768/375px
  — but tight enough to be worth a look during the **Layout check at 1099px / 900px / 768px** task,
  which is where a new `max-width` rule would belong anyway.
- **The live Target Annual Revenue figure carries no `aria-live`**, so a screen-reader user typing
  into the fields is not told it changed. This matches the estimate editor's `.summary-bar`, which
  recomputes the same way on every keystroke and announces nothing either — it is a site-wide gap
  rather than something this screen introduced, so it is flagged for the **Accessibility pass**
  where both can be decided together, rather than diverged from here (the same call decision 21
  made about accent-on-hover contrast).
- `server/src/calc.js` is 428 lines, `server/src/db.js` ~290, and there are now two new route files
  (`overhead.js` ~95 lines, `goals.js` ~45 lines) plus ~90 new lines in `test-api.js`. On the
  frontend `web/js/views/pricing.js` is now ~690 lines, `web/js/views/overhead.js` ~490,
  `web/js/views/goals.js` ~506 and `web/js/views/overhead-charts.js` ~300. None need splitting yet
  — see resolved decision 12 for why `calc.js` specifically should stay one file, and decision 37
  for why the charts were split out of `overhead.js` *before* they made it one of these — but check
  before assuming that still holds after the next big addition.
- **The trend chart has only been measured at 1400px and 375px**, which is where its own two
  failure modes were (a scaled `viewBox`, and a floor fighting the real box width). The **Layout
  check at 1099px / 900px / 768px** task still owns the middle band: the chart redraws itself at
  the measured width on resize, so what to check there is the *content* at those widths — how many
  date labels survive (the rule is one per ~120px, so 5 on desktop and 2 on a phone), whether the
  head line "Up $22,800.00 since 15 Sep 2026" still fits beside "OVERHEAD TREND" in an
  `.est-block-head` at 768px, and whether 200px of chart height is still enough once the donut sits
  above it.
- **The trend line's `--accent` measures 3.71:1 on `--bg`** — over WCAG's 3:1 bar for a graphical
  object, under the brief's blanket 4.5:1 for chart colours. See resolved decision 43 for why it
  was flagged rather than changed; it belongs in the **Accessibility pass** with the accent items
  decision 21 already queued there, and it is the same question the donut's palette will raise.
