# Build Tasks: Finance (Overhead, Goals & Cost-Basis Pricing)

Generated from: `.design/overhead-finance/DESIGN_BRIEF.md` + `.design/overhead-finance/INFORMATION_ARCHITECTURE.md`
Date: 15 September 2026

Model/effort tag on every task per root `CLAUDE.md`'s buckets, so whoever picks a task up next
doesn't have to re-derive it: **(money math — Opus/high)** for anything touching `calc.js` or the
Overhead Rate/hr formula in any layer, including a frontend screen that renders a computed money
figure (CLAUDE.md is explicit this applies "regardless of how small the diff looks"); **(backend —
Sonnet/high)** for plain API routes/tests/migrations; **(frontend — Opus/high)** for UI-build work
per CLAUDE.md's UI-port bucket, since this is new screens wired to a live API, the same category of
work.

The acceptance gate is unchanged from the rest of this repo: **`cd server && npm test`** after any
backend change. New routes get tests in `server/test/test-api.js` following its existing pattern
(ephemeral port, log in once in `test.before`, reuse the cookie). New pure functions in `calc.js`
get tests in `server/test/test-calc.js` following its existing worked-example pattern. Per
`nas-hosted-billing/HANDOVER.md`'s own warning, a green suite is not the gate on its own for
anything a person *looks at* — the rate-card note, the Minimum Job Price line, the charts — go and
look at those in a browser against `api-scratch`, don't trust a passing test alone.

## Foundation

- [x] **SQLite migrations — `overhead_items`, `overhead_snapshots`, `goals`** (backend — Sonnet/high): Add three tables to `server/src/db.js`'s migration list, following the exact pattern of the existing `CREATE TABLE pricing`/`settings` mi …
- [x] **Overhead + Goals calc functions** (money math — Opus/high): Add `annualOverheadTotal(items)`, `overheadRatePerHour(annualOverheadTotal, billableCapacityHrsPerWeek)`, `minimumJobPrice(directJobCosts, estimatedHours, overheadRate, pro …
- [x] **Routes: `overhead.js` and `goals.js`** (backend — Sonnet/high): `server/src/routes/overhead.js` — `GET/POST/PUT/DELETE /api/overhead-items`, `GET /api/overhead-snapshots` (read-only, written internally by the CRUD handlers above, no …
## Core UI

- [x] **Finance nav + `FinanceView` shell** (frontend — Opus/high): Replace `#nav-pricing` with `#nav-finance` in `web/index.html`; add `web/js/views/finance.js` as the thin sub-tab router per the IA doc's mount contract (`FinanceView.mount …
- [x] **Pricing screen: computed rate column + explanatory note** (money math — Opus/high): In `web/js/views/pricing.js`, every labour row's Rate input becomes `readonly` + `aria-readonly="true"`, its value sourced from `overheadRatePerHour …
- [x] **Overhead expense table + Add/Edit modal + Summary Card** (frontend — Opus/high): New `web/js/views/overhead.js`. Expense table extends `.est-table` (Name, Category, Cost, Frequency, computed monthly-equivalent, row actions), populat …
- [x] **Goals form + shared Tax Reserve control** (money math — Opus/high, since Target Annual Revenue is a rendered money figure computed from the formula): New `web/js/views/goals.js`. Single `.field`-group form — Desired Net Income, Targ …
## Interactions & States

- [x] **Historical Overhead Trend chart (SVG line)** (frontend — Opus/high): Hand-rolled inline SVG line chart on the Overhead sub-tab, one point per `overhead_snapshots` row, x-axis by date, y-axis by total. Hover a point shows date + tota …
- [x] **Category Breakdown donut + legend** (frontend — Opus/high): Hand-rolled inline SVG donut on the Overhead sub-tab, computed live from current `overhead-items` grouped by category. Applies the brief's scoped palette exception: terraco …
- [x] **Estimate-editor Overhead/Profit toggle + Minimum Job Price line** (money math — Opus/high): In `web/js/views/estimate-editor.js`, add "Include Overhead & Profit Margin in Calculation" as an inline switch directly above the existing  …
- [x] **Cost breakdown modal** (money math — Opus/high): Add a `(?)` click target next to the Minimum Job Price line opening a `.modal-box` showing the three-line math (Direct Job Costs / Overhead Allocation / Profit Margin → Minimum Job Pr …
## Responsive & Polish

- [x] **Layout check at 1099px / 900px / 768px** (frontend — Opus/high): This is real responsive work, not the old brief's Electron-only exemption — the site already has breakpoints for this. Finance sub-tab row: confirm it wraps the same w …
- [x] **Accessibility pass** (frontend — Opus/high): Visible `:focus-visible` rings (reuse `a11y.css`'s existing rule, don't invent a new one) on every new interactive element — Finance sub-tabs, the toggle, chart legend items, Overhead tab …
## Review

- [x] **`cd server && npm test`**: The repo's stated acceptance gate for any backend change — run after every task above that touches `server/`, not just once at the end.
- [x] **Design review**: Run `/design-review` against `.design/overhead-finance/DESIGN_BRIEF.md` once Core UI, Interactions & States, and Responsive & Polish are done.