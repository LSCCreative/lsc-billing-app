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

## State as of 2026-10-03

**Every task is done** and design-reviewed ([`DESIGN_REVIEW.md`](DESIGN_REVIEW.md)); all five
should-fixes landed 2026-09-21. Only four optional could-improve items remain (listed in the review).
This track is **restructured by `.design/price-calculator/`** (nav, capacity model, landing tab); the
decisions below stay authoritative unless that track overturns them.

The step-by-step build log and the closed "open items" list were removed to save agent tokens;
`git log -p -- .design/overhead-finance/HANDOVER.md` has them.

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
