# Information Architecture: Finance (Overhead, Goals & Pricing)

Builds on [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) in this folder — every structural call below was
already made there through this session's Grill Me interview. This document formalizes it against
the actual mechanics of `web/js/app.js`, rather than assuming a router this app doesn't have.

## Site Map

This app has no URLs — no hash routing, no `pushState`, no History API (confirmed: `web/js/app.js`
has none). It is a single in-memory view switcher: a nav click calls `setNav(active)` then some
`View.mount(main, opts)`, which overwrites `#main`'s innerHTML. There is no unmount hook. The "site
map" below is therefore a **view-state map**, not a URL map — indentation shows what mounts inside
what container, not what routes to what path.

- Estimates (existing, unchanged) — `#main` via `EstimatesView.mount()`
  - Estimate Detail (existing, unchanged)
  - Estimate Editor (existing, **modified**: gains the Overhead/Profit toggle + Minimum Job Price
    line)
- Clients (existing, unchanged) — `#main` via `ClientsView.mount()`
- **Finance** (new — replaces the standalone "Pricing" nav entry) — `#main` via
  `FinanceView.mount()`
  - Pricing (existing screen, **relocated** under Finance, rate column modified) — sub-container
    via `PricingView.mount()`
  - Overhead (new) — sub-container via `OverheadView.mount()`
  - Goals (new) — sub-container via `GoalsView.mount()`
- Invoice Settings (existing, unchanged — a modal via `SettingsView.open()`, not a mounted page)

## Navigation Model

- **Primary navigation** (`#hdr-right`, top header): Estimates, Clients, **Finance**, Invoice
  Settings, Sign Out. Five items — one fewer than a flat Overhead+Goals addition would have
  produced (which would have made seven), keeping `#hdr-right` at its current width rather than
  pushing it further into the ~865px wrap threshold documented in `web/css/responsive.css`.
- **Secondary navigation** (new — inside Finance only): a `.nav-link`-styled row of three sub-tabs
  — Pricing / Overhead / Goals — rendered at the top of `#main` by `FinanceView`, immediately below
  the header. This is not a new component: it is the same `.nav-link` markup and `.active`-class
  convention the header already uses, just scoped to a sub-container instead of `#hdr-right`. No
  dropdown/disclosure menu is introduced (see brief's IA note for why: no dropdown pattern exists
  in this codebase to extend, and it would need its own mobile behavior for no real benefit over a
  second `.nav-link` row).
- **Utility navigation**: unchanged — Sign Out and the Invoice Settings modal stay exactly where
  they are.
- **Mobile navigation**: unchanged mechanism, one new entry. Below 768px, `#hdr-right` becomes a
  disclosure panel via `#nav-menu-btn` (`web/js/app.js:157-199`) — `#nav-finance` is simply one more
  button in that same panel, no special-casing needed. The Pricing/Overhead/Goals sub-tab row
  inside Finance is a normal part of `#main`'s content and follows whatever `#main` already does at
  narrow widths (data-label stacking, single-column `.field` groups) — it does not interact with
  the compact header nav at all, since it isn't part of `#hdr-right`.

## `FinanceView` mount contract

New module, `web/js/views/finance.js`, following the existing `mount(container, viewHandlers)`
shape (`web/js/views/pricing.js:552`):

```
FinanceView.mount(main, { onAuthLost, initialTab })
```

- Renders the three-tab sub-nav plus one sub-container `<div id="finance-sub">`.
- On mount and on every sub-tab click, calls the corresponding child view's own `mount()` into
  `#finance-sub` — `PricingView.mount(subContainer, {...})`, `OverheadView.mount(subContainer,
  {...})`, `GoalsView.mount(subContainer, {...})` — exactly as `app.js` mounts top-level views into
  `#main` today. `FinanceView` is a thin router, not a rewrite of any child view.
- **Unsaved-edit guard, per sub-tab**: Pricing already registers with `LSCUnsaved` today; Goals gets
  its own registration the same way (single explicit-Save form, snapshot-compared, `onScreen()`
  sentinel checking `#finance-sub`'s current content — same pattern as every other guarded screen).
  Switching sub-tabs runs `LSCUnsaved.confirmLeave()` exactly like switching top-level nav does
  (`toPricing()` at `web/js/app.js:144-150` is the precedent) — leaving Goals half-edited to peek at
  Overhead prompts the same native-`confirm()` warning as leaving Pricing half-edited today.
  Overhead's own edits (Add/Edit Expense) live inside a modal that saves or discards on its own
  close, so the Overhead sub-tab itself needs no unsaved-edit registration — same reasoning as why
  the Client record modal is guarded but the Clients list isn't.
- **`initialTab`**: `#nav-finance`'s click handler always opens Pricing by default (today's
  behavior, preserved — nobody's muscle memory for "click Pricing to see the rate card" should
  break). Internal cross-links (the Pricing rate-column note's "Overhead" / "Goals" links, described
  in the brief's Key Interactions) pass `initialTab: 'overhead'` or `'goals'` so a click actually
  lands where it says it will, rather than always dropping back to Pricing.

## Data preload

`LSCData.load()` (`web/js/data.js:26`) currently fetches `pricing` and `settings` together before
any app view renders, because the rate card is needed to price any estimate. Overhead and Goals
data join this same preload, for the same reason it was already true for pricing: **Pricing's rate
column now depends on Overhead+Goals data being in memory**, and the estimate editor's Minimum Job
Price line depends on it too — both would otherwise show a flash of `—`/loading state on first
paint. Extend the `Promise.all` in `load()` with `GET /api/overhead-items`, `GET
/api/overhead-snapshots`, and `GET /api/goals`; extend `loaded()` to require all five back before
`showApp()` proceeds. This keeps the existing single-preload-gate design rather than introducing a
second, Finance-specific loading state.

## Content Hierarchy

### Pricing sub-tab (existing screen, modified)
1. The computed-rate explanatory note, directly above the rate-card table — must be seen before the
   now-read-only Rate column is, or it reads as a bug.
2. The rate card itself (`.est-table`, labour + travel sections) — unchanged structure, `mu` still
   editable, `rate` now read-only for labour rows only.
3. The shared `.tax-setting` block — unchanged position and behavior.

### Overhead sub-tab (new)
1. Summary Card (Monthly/Annual Total) — the one number Lachlan checks most often, so it sits above
   the fold, above the table.
2. Expense table — the working data, CRUD via Add/Edit modal.
3. Category Breakdown donut + legend — answers "what's actually costing me," secondary to the raw
   total.
4. Historical Overhead Trend line chart — answers "is this getting better or worse," the most
   retrospective/least-urgent content, placed last.

### Goals sub-tab (new)
1. The form fields (Desired Net Income, Target Profit Margin %, Billable Capacity hrs/wk) — the
   inputs Lachlan actually sets.
2. The shared Tax Reserve Target control (`.tax-setting`, same field as Pricing's) — grouped with
   the other rate-driving inputs, not separated into its own section, since it's the same kind of
   number.
3. Target Annual Revenue — a computed, read-only output shown below the form, not mixed in with the
   editable fields above it (mirrors how Pricing already separates editable rows from the
   read-only-until-saved totals pattern elsewhere in the app).
   **Overturned 2026-09-28 by the user.** It now sits *above* the fields, matching Capacity's annual
   hours, and its card border does the separating — see
   [`../price-calculator/DESIGN_REVIEW.md`](../price-calculator/DESIGN_REVIEW.md), should-fix 8.

## User Flows

### First-time setup (no Overhead/Goals data yet)
1. Lachlan opens Finance → Pricing (default tab). The rate column reads `—` for every labour row,
   with the explanatory note reading "Set up Overhead & Goals to see this" (matching the exact
   empty-state copy already specified in the brief for the estimate editor's Minimum Job Price
   line, so the app says the same thing in both places rather than two different empty-state
   phrasings for the same missing data).
2. He clicks through to the Overhead sub-tab (linked from the note) → sees an empty expense table,
   empty Summary Card ($0), and both charts in their empty state (a plain message, not a broken
   axis) — same "add your first expense" framing as the Estimates list's own first-run empty state
   already uses elsewhere in the app.
3. He adds expenses → Summary Card and both charts populate immediately (no reload).
4. He clicks Goals → fills in Desired Net Income, Target Profit Margin %, Billable Capacity → Save.
5. Returning to Pricing (or opening any estimate), the rate column and Minimum Job Price line are
   now populated — no separate "recalculate" action anywhere in this flow.

### Editing an Overhead expense, seeing it reflected elsewhere
1. From the Overhead sub-tab, edit an expense's cost → Save → the snapshot log gets a new row, the
   Summary Card/charts update immediately (same screen, live).
2. **Pricing's rate column does not update live in the background** — it recomputes on next mount
   (i.e., next time Finance → Pricing is opened or Finance itself is remounted), consistent with
   the brief's "recomputes live every time the Pricing screen loads" decision, not a
   cross-sub-tab live-binding. This is worth stating explicitly here so it isn't accidentally
   over-built as a live subscription during Frontend Design.

### The per-estimate toggle (estimate editor)
1. Opening any estimate (new or existing), the Overhead/Profit toggle defaults ON.
2. If Overhead+Goals have data: the Minimum Job Price line renders with a real number and a `(?)`
   opening the cost breakdown modal.
3. If they don't: the line reads "Set up Overhead & Goals to see this" — no link out of the editor
   is required here (unlike Pricing's note above), since interrupting an in-progress estimate to go
   configure Finance is worse than letting the line sit inert until he does it on his own time.
4. Toggling off removes the line entirely; `clientPriceExGst`/`totalIncGst` never change in either
   state — this is the one flow in the whole feature that must never be observably different
   depending on Overhead/Goals data being present or not.

## Naming Conventions

| Concept | Label in UI | Notes |
|---|---|---|
| Top-level nav entry | "Finance" | Replaces "Pricing" as the nav label; per this session's resolved decision. |
| Sub-tab for the rate card | "Pricing" | Unchanged — it's still the same screen, just relocated. |
| Computed cost-basis number | "Overhead Rate/hr" internally; not shown as a standalone labeled figure to the user except inside the cost breakdown modal and the Pricing note's copy. | Avoids introducing a fourth synonym for "cost" alongside `rate`, "cost basis," and "Direct Job Costs," which already mean different things in `calc.js`. |
| Per-estimate advisory number | "Minimum Job Price" | Matches the old brief's term exactly — no renaming, since it's already precise. |
| The recurring-cost tracking page | "Overhead" | Matches the old brief and the user's own phrasing. |
| The income/margin/capacity page | "Goals" | Matches the old brief. |
| Shared tax field | "Tax Reserve Target %" on Goals, "Tax Set-Aside Rate (%)" on Pricing | **Deliberately kept as two different labels for the same stored value** — each screen's existing/precedented copy for the concept in its own context (Pricing's existing wording is unchanged per the Desktop Preservation Law equivalent for this site; Goals uses the old brief's term). The brief already established these read the same underlying number; this IA note exists so Frontend Design doesn't "fix" the apparent inconsistency by renaming one of them. |

## Component Reuse Map

| Component | Used on | Behavior differences |
|---|---|---|
| `.nav-link` | Header nav, Finance sub-tab row | Identical CSS/markup; sub-tab row is a second instance in a different container, not a variant. |
| `.est-table` | Pricing rate card, Overhead expense table, existing estimate/client tables | Overhead's table adds a computed monthly-equivalent column; otherwise identical. |
| `.modal-box` / `.modal-overlay` + focus trap | Invoice Settings (existing), Add/Edit Expense (new), Cost Breakdown (new) | Same focus-trap implementation reused verbatim from `web/js/views/settings.js`; no per-modal variation. |
| `.field` | Pricing, Clients, Overhead's Add/Edit modal, Goals form | Identical; category/frequency selects in Overhead's modal are `.field`s with a `<select>` instead of `<input>`, same as existing selects elsewhere. |
| `.proj-card` | Estimates list, Clients list, Overhead Summary Card | Overhead's usage is non-clickable (a stat display, not a navigation tile) — drop the hover accent-underline sweep and cursor:pointer for this one usage, since nothing happens on click. |
| `LSCUnsaved` guard | Estimate editor, Pricing, Invoice Settings, Client record (existing), Goals (new) | Goals registers exactly like Pricing does — single form, explicit Save, snapshot comparison. |
| `LSCData` preload | Gates all of `showApp()` today (pricing + settings) | Extended to also gate on Overhead + Goals data (see Data preload section above) rather than given its own separate loading state. |

## Content Growth Plan

- **Overhead expense table**: expected to stay small (dozens of rows at most — a solo operator's
  recurring costs) — no pagination needed, matches the brief's "dense table" framing rather than an
  infinite-scroll pattern.
- **Overhead snapshot log**: grows by one row per add/edit/delete, unbounded over the life of the
  business. The Historical Overhead Trend chart plots all of them — if this becomes visually dense
  after years of use, that's a future problem for whoever revisits this page, not something to
  pre-solve with date-range filtering now (out of scope, per the brief).
- **Goals**: a singleton — no growth dimension at all.

## URL Strategy

Not applicable. This app has no URLs for its views (confirmed: no router exists anywhere in
`web/js/app.js`). Nothing about this feature introduces one — Finance's sub-tabs are in-memory view
state (`FinanceView`'s own `activeTab`), the same as every other view transition in this app. If
deep-linking into a specific Finance sub-tab is ever wanted, that would be a site-wide routing
change well beyond this feature's scope, not something to bolt onto Finance alone.
