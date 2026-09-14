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
dark-editorial token set is locked and unchanged) → Brief to Tasks → **Frontend Design (not
started)** → Design Review (not applicable yet).

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

**Not started:** everything else in TASKS.md, starting with the Finance nav + `FinanceView` shell.
`web/` still has only one change — `web/js/calc.js`, byte-identical to the server money model, must
be re-copied (`cp server/src/calc.js web/js/calc.js`) after *any* edit to `calc.js`. No frontend
*screens* exist for this feature yet, so the new routes have only been exercised by `test-api.js`,
not by a browser — see "Open items" below.

**To resume:** open [TASKS.md](TASKS.md), start at the first unchecked item (currently **Finance
nav + `FinanceView` shell**, `frontend — Opus/high`), state its model/effort bucket out loud before
writing code, and work top-down. Per its own task note, this can be built against the now-real
`/api/overhead-items`, `/api/overhead-snapshots`, and `/api/goals` routes (no need to stub them —
that was only a fallback for if this task landed first).

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
- **Neither the calc functions nor the new routes have ever been looked at by a human in a
  browser**, because no screen renders them yet. They're pure/API-tested, which is the right gate
  for *these* tasks, but every consumer of them is a thing a person looks at — the rate column, the
  Minimum Job Price line, the Target Annual Revenue stat, the Overhead expense table itself. The
  em-dash empty states (resolved decision 13) and the goals-nulls shape (decision 15) are the
  specific things to check by eye once those screens exist: a `null` leaking through as "$0.00",
  "NaN" or "$Infinity" is the failure mode these are shaped to prevent, and only a person looking at
  the screen will catch it if a view coerces the value on its way out.
- **`.design/overhead-finance/` is still untracked in git** (`git status` shows `?? .design/
  overhead-finance/`), along with the deletion of the superseded `.design/overhead-profit-goals/`
  and `BILLING_APP_PLAN.md`. Three tasks' worth of work now sits in the working tree uncommitted —
  worth a commit before the next session rather than letting it grow further.
- `server/src/calc.js` is 428 lines, `server/src/db.js` ~290, and there are now two new route files
  (`overhead.js` ~95 lines, `goals.js` ~45 lines) plus ~90 new lines in `test-api.js`. None need
  splitting yet — see resolved decision 12 for why `calc.js` specifically should stay one file —
  but check before assuming that still holds after the next big addition.
