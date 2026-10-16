# Design Brief: Finance — Overhead, Goals & Cost-Basis Pricing

**Status:** Approved direction, pre-build
**Date:** 15 September 2026
**Builds on:** `.design/nas-hosted-billing/` — the live website (`server/` Node/Express/SQLite +
`web/` static frontend on GitHub Pages), not the old Electron app.

**Supersedes:** [`.design/overhead-profit-goals/DESIGN_BRIEF.md`](../overhead-profit-goals/DESIGN_BRIEF.md).
That brief was approved 2026-09-07 for the old Electron app (`localStorage`, in-memory
`projects[]`) at a time when the website rewrite had no working CRUD API or ported UI yet. The
website has since gone live (Cloudflare Tunnel + GitHub Pages, per
`.design/nas-hosted-billing/HANDOVER.md`), and this feature is now being built there instead. The
old brief's problem statement, aesthetic direction, and most of its resolved decisions (fixed
category list, event-based snapshot log, hand-rolled SVG charts, advisory-only toggle) carry over
unchanged and are restated below; its storage model (`localStorage`), Electron-only responsive
exemption, and its handling of the Pricing screen's internal cost basis do not, and are replaced
by the sections marked **[NEW]** below. Kept here as historical context only, same convention as
`BILLING_APP_PLAN.md` (superseded by SQLite).

---

## Problem

Lachlan prices every job the same way: labour hours × a marked-up rate, typed by hand into the
Pricing screen's rate card. The number sitting underneath that markup — the internal cost per hour
for each of the ~15 labour line items — was always a guess (currently ranging $30–$110 across
rows), never checked against what it actually costs to keep the business open: software
subscriptions, insurance, accounting fees, hosting. And there's never been a stated number for what
he's actually trying to take home this year, so "enough profit" isn't something the app — or he —
can check a quote against.

The friction is: **the cost basis behind every rate on the card is a guess that nobody has ever
actually checked against the business's real numbers.** It's possible to be busy all year, hit
every deadline, and still come out behind — and not find out until tax time.

## Solution

A new **Finance** area of the site makes the invisible numbers visible, once, at the source:
an **Overhead** page tracks the real recurring cost of running the business as it changes, a
**Goals** page states what Lachlan wants to earn and what margin and capacity he's working with,
and together they compute one number — **Overhead Rate/hr** — that becomes the cost basis
(`rate`) for every labour row on the **Pricing** page automatically, instead of being typed by
hand. The markup itself (`mu`, what clients are actually billed) stays entirely under manual
control — this feature fixes what the markup is calculated *from*, not what it charges. On top of
that, every estimate quietly grows a second, advisory number next to its real price — the minimum
that specific job needs to clear to cover its share of overhead and hit the profit target — so
Lachlan can see the truth about a quote without the app ever changing what a client is billed
unless he decides to.

## Experience Principles

1. **Visible, not enforced** — the cost-basis number and the per-estimate floor are additional
   data points, never a substitute for the real quote. Overhead Rate/hr updates the reference
   `rate` field; it never touches `mu`, `clientPriceExGst`, or `totalIncGst`. The per-estimate
   toggle can be switched off any time at no cost.
2. **One number, one truth** — overhead totals, the tax reserve rate, and profit targets are each
   stored in exactly one place and read everywhere they're used. Goals' "Tax Reserve Target %" and
   Pricing's existing tax-set-aside rate are the same stored field, not two numbers that can drift
   apart — true today for the tax rate, and this feature keeps it true rather than forking it.
3. **Same density, same restraint** — Finance reads as more pages of the same rate card, not an
   analytics product bolted onto a billing tool: dense tables, small-caps tracked labels, flat
   1px-bordered surfaces, one accent colour doing the interactive work. The category donut chart is
   the one deliberate exception — see Aesthetic Direction.

## Aesthetic Direction

- **Philosophy**: Editorial dark utility — inherited unchanged from the rest of the site. A
  film-lab studio tool, not a SaaS dashboard.
- **Tone**: Calm, precise, professional. This is still the screen where money gets decided.
- **Reference points**: The site's own Pricing screen (`.tax-setting` block, `.est-table` rate
  card) and Clients screen (`.proj-card` grid, native-`confirm()` delete) are the closest living
  precedent. Linear's density. A printed rate card.
- **Anti-references**: KPI-tile dashboards, gauge/speedometer widgets, colourful progress rings,
  Xero/QuickBooks chrome, any "insights" card with an icon and a drop shadow.
- **Scoped palette exception**: the single-accent rule holds everywhere except the category
  breakdown donut, which needs 5–6 legible categories. There, terracotta (`--accent`) marks the
  largest category and the rest use a small, muted, same-family tonal ramp (desaturated warm
  greys/ochres sitting between `--muted` and `--accent`) — restrained enough to read as "the one
  chart with colour," not a rainbow.

## Existing Patterns

Verified directly against the live site's code (not carried over from the old brief without
checking).

- **Typography**: `Delight` (`Georgia` fallback, weight 700, via `.delight`) for headings and money
  figures; `Funnel Sans` for body/UI at 13px base (`web/css/app.css:23`). Field/column labels are
  10–11px uppercase with `letter-spacing:.08–.1em`.
- **Colors** (`web/css/app.css:17-21`, confirmed current): `--bg:#181818` `--text:#F0EDE8`
  `--surface:#2C2F35` `--border:#3D4A5C` `--accent:#B85444` `--ah:#9a3d31` (accent hover)
  `--muted:rgba(240,237,232,.42)` `--muted2:rgba(240,237,232,.18)`
  `--row-hover:rgba(240,237,232,.03)`.
- **Shape/spacing**: flat edges everywhere (no `border-radius` on cards/tables/inputs — `.nav-link`
  is the one exception at `border-radius:4px`), 1px solid borders, `.proj-card` padding 22px, dense
  table cells (7×14px in `.est-table`).
- **Components already in the codebase** (reuse, don't reinvent):
  - `.nav-link` — flat, uppercase, tracked nav buttons (`web/css/app.css:30-33`); no dropdown/group
    variant exists yet — see Information Architecture note below on why this brief deliberately
    doesn't invent one.
  - `.btn` / `.btn-accent` — uppercase, tracked, transparent-until-hover buttons.
  - `.proj-card` — the card-grid tile pattern (accent underline sweep on hover, keyboard
    `:focus-visible` equivalent in `web/css/estimates.css:35-39`).
  - `.field` — labeled input group (uppercase 10px label + bordered input).
  - `.est-table` — dense data table with uppercase muted headers, `data-label` attributes for the
    <768px stacked layout (`web/css/responsive.css` — "a new column needs a data-label or it loses
    its heading on a phone").
  - `.modal-overlay` / `.modal-box` — the site's only modal, with a real focus trap
    (`web/js/views/settings.js`): Tab/Shift+Tab wrap inside `.modal-box`, Escape closes, focus
    returns to the trigger, and the focusable set is recomputed on every Tab rather than cached.
  - `.tax-setting` — the bordered block on the Pricing screen holding the tax-set-aside rate
    control, which already lives inside the `pricing` table's JSON blob (`taxSetAsideRate`,
    read/written via `GET/PUT /api/pricing`). This becomes the shared control referenced by both
    Pricing and Goals — not a new field.
  - Delete confirmation uses `window.confirm()` (see `remove()` in `web/js/views/clients.js:296`),
    not a custom modal, with an async `LSCApi.del(...)` call and `Toast` feedback — expense-row
    deletion follows the same convention.
- **Persistence convention** `[NEW — replaces the old brief's localStorage plan]`: the site has a
  real SQLite database (`server/src/db.js`) with versioned migrations, and REST routes per resource
  (`server/src/routes/{clients,estimates,pdf,pricing,settings}.js`). `pricing` and `settings` are
  each a singleton JSON-blob row (`id = 1`) with `GET`/`PUT` (`pricing` also has `POST /reset`) —
  see `server/src/routes/pricing.js` for the exact shape to mirror. Overhead and Goals follow this
  same server-backed pattern, not `localStorage`.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| `overhead_items` table | New | SQLite, CRUD rows: id, name, category, cost, frequency. Migration in `server/src/db.js`, following the existing `CREATE TABLE pricing`/`settings` pattern. |
| `overhead_snapshots` table | New | SQLite, append-only: id, ts, total_annual, by_category_json. One row per overhead add/edit/delete. |
| `goals` table | New | SQLite, singleton (`id = 1`): desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week. **No tax field** — Tax Reserve Target reads/writes `pricing.taxSetAsideRate` directly via the existing `/api/pricing` route; do not add a second tax column. |
| `server/src/routes/overhead.js` | New | `GET/POST/PUT/DELETE /api/overhead-items`, `GET /api/overhead-snapshots`. Mirrors `clients.js`'s CRUD shape. |
| `server/src/routes/goals.js` | New | `GET/PUT /api/goals`, mirroring `pricing.js`'s singleton `GET`/`PUT` exactly. |
| Calc functions in `server/src/calc.js` (or a sibling module) | New | `annualOverheadTotal`, `overheadRatePerHour`, `minimumJobPrice`, `targetAnnualRevenue` — pure functions, documented in the file's existing docblock style (see the 2026-09-10 GST-free decision note for the convention: state the decision, not just the arithmetic). |
| `web/js/views/overhead.js` | New | Follows `pricing.js`'s module shape (`markup()`/`render()`/save handlers). |
| `web/js/views/goals.js` | New | Same module shape; single explicit-Save form. |
| Finance nav entry | Modify | `#nav-pricing` (`web/index.html`) is replaced by `#nav-finance`, opening the Finance area at its default sub-tab (Pricing). See Information Architecture. |
| Finance sub-tabs (Pricing / Overhead / Goals) | New | A `.nav-link`-styled row of three sub-tabs at the top of the Finance area's own `#main` content — not a header dropdown. See rationale below. |
| Overhead expense table | New | Extends `.est-table`: Name, Category, Cost, Frequency, computed monthly-equivalent, row actions. `data-label` attributes for the mobile stacked layout. |
| Add/Edit Expense modal | New | Extends `.modal-box` + `.field`; category and frequency are `<select>`s. |
| Delete expense row | New | `window.confirm()` + `LSCApi.del(...)`, matching `clients.js`'s `remove()`. |
| Overhead Summary Card | New | Extends `.proj-card`: Monthly Total / Annual Total, computed live from the table. |
| Historical Overhead Trend chart | New | Hand-rolled inline SVG line chart, one point per `overhead_snapshots` row. Lives on the Overhead tab. |
| Category Breakdown chart | New | Hand-rolled inline SVG donut, scoped tonal-ramp palette + legend list (category + $ + %). Lives on the Overhead tab. |
| Goals form | New | Extends `.field` group: Desired Net Income, Target Profit Margin %, Billable Capacity (hrs/wk). One explicit Save button, matching Pricing's save affordance. |
| Tax Reserve Target control | Modify | `.tax-setting`, reused verbatim, now surfaced on both Pricing and Goals, both reading/writing `pricing.taxSetAsideRate`. |
| Pricing row `rate` field | Modify — **behaviour change** | Every labour row's `rate` input becomes read-only, computed live from Overhead Rate/hr on every page load. Travel rows are unaffected and stay manually editable. See Key Interactions for the exact copy explaining this. |
| Overhead/Profit toggle (estimate editor) | New | Inline switch near `.summary-bar`, defaults ON. |
| Cost breakdown modal | New | Extends `.modal-box`: Direct Job Costs / Overhead Allocation / Profit Margin → Minimum Job Price. |

## Key Interactions

- **Adding an expense** `[GST basis confirmed this session]`: click "Add Expense" → `.modal-box`
  opens with empty `.field`s, including a one-line hint under the Cost field: *"Enter the
  GST-exclusive amount — the app assumes you claim GST back on business expenses."* This keeps
  Annual Overhead Total consistent with every other dollar figure `calc.js` already produces (all
  ex-GST internally, GST added on top only where the estimate itself is GST-registered) — a
  GST-inclusive entry here would silently overstate Overhead Rate/hr, Minimum Job Price, and Target
  Annual Revenue by the GST component, since a GST-registered business normally claims that back as
  an input tax credit rather than it being a real cost. No calculation or toggle is added to
  convert a GST-inclusive figure automatically — the hint is the whole mechanism, matching this
  app's existing preference for a stated convention over an extra field. Save writes the row via
  `POST /api/overhead-items`, appends one `overhead_snapshots` row, closes the modal. The Summary
  Card, both charts, and (next time it's opened) the Pricing screen's `rate` column all reflect the
  new total — no separate "recalculate" step, no page reload required for Overhead's own screen.
- **Editing/deleting an expense**: edit reopens the same modal pre-filled (`PUT`); delete asks via
  `window.confirm()` first (`DELETE`). Either action appends a new snapshot and re-renders totals
  the same way Add does.
- **Setting Goals**: a single form, saved as one unit via one explicit Save button (`PUT
  /api/goals`) — consistent with "one number, one truth": a write is confirmed before the UI says
  it stuck, matching the Pricing screen's own save pattern.
- **The Pricing screen's computed `rate`** `[NEW]`: every labour row's Rate column becomes
  non-editable, showing the current Overhead Rate/hr (Annual Overhead ÷ Annual Billable Hours) for
  every row, recomputed fresh on every page load. A small note directly above the rate-card table
  reads: *"Rate is calculated automatically from your Overhead and Goals settings and can't be
  edited here — update it on the [Overhead](#) / [Goals](#) tabs. Mark-Up stays yours to set."*
  This prevents the field silently going read-only with no explanation. Travel rows keep their
  existing manually-editable `rate`. If Overhead or Goals have no data yet, the computed rate shows
  `—` with the same note, not `$0` or `NaN`.
- **The estimate-editor toggle**: switching "Include Overhead & Profit Margin in Calculation" on
  shows a secondary line under the existing `.summary-bar` — "Minimum Job Price: $X" — with a `(?)`
  click target opening the cost breakdown modal (Direct Job Costs / Overhead Allocation / Profit
  Margin → Minimum Job Price). Switching it off removes the line entirely. In both states,
  `clientPriceExGst` and `totalIncGst` never move — verified in both the editor and the read-only
  estimate-detail view. If Overhead/Goals have no data yet, the line reads "Set up Overhead & Goals
  to see this" instead of `$0`/`NaN`.
- **Chart interaction**: hovering a donut segment or trend point shows its value (category + $ for
  the donut, date + total for the trend) via SVG `<title>`/tooltip — no external library.

## Information Architecture note

The old brief specified two new flat top-level nav items ("Overhead", "Goals") alongside the
existing four. This brief groups Pricing, Overhead, and Goals under one **"Finance"** entry instead
— per the resolved decision this session — because a flat sixth/seventh nav item would crowd
`#hdr-right`, which already wraps to two lines below ~865px (`web/css/responsive.css`, documented
header-nav constraint). Rather than inventing a new dropdown/disclosure component with its own
mobile behaviour (the codebase has no existing dropdown pattern to extend, only the one
`#nav-menu-btn` full-panel disclosure), Finance is a single `.nav-link` like any other nav item,
opening a page whose own `#main` content starts with three `.nav-link`-styled sub-tabs
(Pricing / Overhead / Goals). This reuses the exact same component and interaction the top nav
already has, needs no new CSS component, and degrades through the existing mobile nav exactly like
any other single page does today.

## Responsive Behavior `[NEW — the old brief explicitly skipped this]`

The old brief exempted itself from responsive work because the Electron window had a fixed
1100×700 minimum. The website has none of that — it already has real breakpoints at 1099px, 900px,
and 768px (`web/css/responsive.css`) covering Estimates, Pricing, and Clients. Finance gets the
same treatment, not a desktop-only exemption:

- **Finance sub-tabs**: same `.nav-link` row pattern as the top nav; wraps the same way if it ever
  needs to.
- **Overhead expense table**: `.est-table` with `data-label` attributes, following the existing
  <768px stacked-row convention already used by the rate card and clients' history table.
- **Both charts**: SVG `viewBox` scales to container width at every breakpoint; the donut's legend
  list stacks under the chart rather than beside it below 900px, matching how other two-column
  layouts in the app collapse.
- **Goals form**: single-column `.field` stack, already how `.field` groups behave at narrow
  widths elsewhere in the app.
- **Pricing screen's computed `rate` column**: unaffected by responsive work already done for the
  rate-card table — the column becomes read-only, not restructured.

## Accessibility Requirements

Matches the bar already built site-wide (per `.design/nas-hosted-billing/HANDOVER.md`, the
accessibility pass is done for the rest of the site) — this feature must not fall below it:

- All new interactive elements (`.btn`, the toggle, chart legend items, table row actions, Finance
  sub-tabs) get the site's existing `:focus-visible` ring treatment (`a11y.css`), not a new style.
- Both new modals (Add/Edit Expense, cost breakdown) reuse the exact focus-trap implementation in
  `web/js/views/settings.js` — Tab/Shift+Tab wrap inside `.modal-box`, Escape closes, focus returns
  to the trigger, focusable set recomputed on every Tab.
- The donut chart's data is also available as a legend list (category name + $ + %), not
  colour-only — colourblind-safe even with the scoped tonal-ramp palette.
- Chart colours (including the scoped donut palette) and `--muted` text must hit ≥4.5:1 contrast
  against `--bg`/`--surface`, matching the standard already verified elsewhere in the app.
- The Pricing screen's newly-read-only `rate` inputs get `aria-readonly="true"` and the explanatory
  note is programmatically associated (`aria-describedby`), not just visually adjacent — a
  screen-reader user hitting a field that silently stopped accepting input is the exact failure
  mode this guards against.

## Out of Scope

- Any change to what a client is actually billed — `mu`, `clientPriceExGst`, and `totalIncGst` are
  never touched by Overhead Rate/hr or the Minimum Job Price line. Permanently advisory.
- Multi-user or multi-account support of any kind — this remains a single-account tool, matching
  the rest of the site.
- Making the fixed category list (Software, Admin/Legal, Marketing, Hosting, Tax, Other)
  user-editable.
- A "projects/year" capacity model — Billable Capacity is hours/week only.
- Variance/actuals reporting (target vs. what was really earned) — this brief covers target-setting
  and the advisory floor/cost-basis only, not after-the-fact tracking against those targets.
- A separate "Trends" tab with its own historical charts — considered this session and scrapped;
  the trend and donut charts live on the Overhead tab only.
- A distinct "Desired Hourly Wage" field or any wage/direct-labor term in the Overhead Rate/hr
  formula — considered this session and dropped as redundant, since `mu` already prices labour.
  Overhead Rate/hr is overhead cost only.
- **A wage-adequacy check anywhere in this feature** — reconfirmed this session, after an explicit
  accounting review. Minimum Job Price verifies overhead + profit-margin recovery only; it does not
  and will not verify that `mu` covers a minimum acceptable hourly wage. Desired Net Income feeds
  Target Annual Revenue as an annual planning stat only — it is not compared against any per-row or
  per-job number. This is a deliberate, reconfirmed narrowing from the original example text's
  full Base Cost Rate concept (Wage + Overhead): the business owner is trusted to set `mu` at a
  rate that covers their own wage, the same as today, with no system check on that judgment.
- Automatic GST conversion on Overhead item costs — the entry form carries an explanatory hint
  (GST-exclusive expected) rather than a GST-registered toggle + conversion formula. If overhead
  costs are entered GST-inclusive despite the hint, Annual Overhead Total (and everything computed
  from it) will run high by the GST component — an accepted risk of the hint-only approach,
  reconfirmed this session over building a toggle.
- Travel row `rate` fields — excluded from the automatic Overhead Rate/hr calculation; they stay
  exactly as manually editable as they are today.
- A "Finance" header dropdown/group menu component — deliberately not built; see Information
  Architecture note above for why sub-tabs on a single nav entry were chosen instead.
