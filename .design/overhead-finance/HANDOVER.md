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
progress — the nav shell and the Pricing rate column are in, 8 UI tasks to go)** → Design Review
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

**Not started:** everything else in TASKS.md, starting with **Overhead expense table + Add/Edit
modal + Summary Card**. `web/js/calc.js` is byte-identical to the server money model and must be
re-copied (`cp server/src/calc.js web/js/calc.js`) after *any* edit to `calc.js`.

**To resume:** open [TASKS.md](TASKS.md), start at the first unchecked item (currently **Overhead
expense table + Add/Edit modal + Summary Card**, `frontend — Opus/high`), state its model/effort
bucket out loud before writing code, and work top-down. Everything that task needs exists: the
routes are live, `LSCData.overheadItems()` / `setOverheadItems()` / `setOverheadSnapshots()` are
in place, `annualisedCost()` and `FREQUENCY_MULTIPLIERS` are exported from `web/js/calc.js` for the
monthly-equivalent column, and the enum spellings it must put in its `<select>`s are in resolved
decisions 8 and 11. Note that the Pricing screen reads its rate from `LSCData` at mount, so an
expense added on the Overhead tab shows up on Pricing as soon as that screen is re-entered — as
long as the Overhead view calls `LSCData.setOverheadItems()` after each write (decision 19).

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
- **The `api-scratch` database is now seeded with the brief's worked example**, so the screens
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
- `server/src/calc.js` is 428 lines, `server/src/db.js` ~290, and there are now two new route files
  (`overhead.js` ~95 lines, `goals.js` ~45 lines) plus ~90 new lines in `test-api.js`. On the
  frontend `web/js/views/pricing.js` is now ~690 lines. None need splitting yet — see resolved
  decision 12 for why `calc.js` specifically should stay one file — but check before assuming that
  still holds after the next big addition.
