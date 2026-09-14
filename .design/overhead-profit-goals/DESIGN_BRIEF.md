# Design Brief: Overhead Dashboard, Profit Goals & Dynamic Pricing Integration

**Status:** Approved direction, pre-build
**Date:** 7 September 2026
**Builds on:** the live Electron app (`index.html`, `main.js`, `preload.js`). Deliberately does **not** depend on or block on `.design/nas-hosted-billing/`, which is mid-migration and has no working CRUD API or ported UI yet.

---

## Problem

Lachlan prices every job the same way: labour hours × marked-up rate, plus whatever travel and crew cost outright. That number has never once been checked against what it actually costs to keep the business open — software subscriptions, insurance, accounting fees, hosting — or against what he's actually trying to take home this year. Overhead is invisible until the bank balance or tax time proves it was there all along, and "enough profit" isn't a number he's ever stated, so there's nothing to price against.

The friction is: **the price on every quote is a guess about affordability that nobody has ever actually checked.** It's possible to be busy all year, hit every deadline, and still come out behind — and not find out until it's too late to do anything about that job.

## Solution

Two new places make the invisible numbers visible, once, at the source: an **Overhead** page where the real recurring cost of running the business gets tracked as it changes, and a **Goals** page where Lachlan states what he actually wants to take home and keep as margin. Once both exist, every estimate quietly grows a second number next to the price being charged — the minimum this specific job needs to clear to cover its share of overhead and hit the profit target — broken down so it's obvious why. Nothing about the actual quote changes unless he decides it should; the app now just tells him the truth about what he's charging, in the same breath as it always has.

## Experience Principles

1. **Visible, not enforced** — the cost-plus number is a second data point next to the real quote, never a replacement for it. The toggle can be switched off per estimate at any time; turning it off costs nothing and hides nothing else.
2. **One number, one truth** — overhead totals, the tax reserve rate, and profit targets are each stored in exactly one place and read everywhere they're used. The tax rate the Pricing screen has always used for take-home math is the same rate the Goals page sets — there is no second tax field to fall out of sync with the first.
3. **Same density, same restraint** — Overhead and Goals read as two more pages of the same rate card, not an analytics product bolted onto a billing tool: dense tables, small-caps tracked labels, flat 1px-bordered surfaces, one accent colour doing the interactive work. The category donut chart is the one deliberate exception — see Aesthetic Direction.

## Aesthetic Direction

- **Philosophy**: Editorial dark utility — inherited unchanged from the existing app. A film-lab studio tool, not a SaaS dashboard.
- **Tone**: Calm, precise, professional. This is still the screen where money gets decided.
- **Reference points**: The existing app itself (Pricing screen's `.tax-setting` block and `.est-table` are the closest living precedent for these new screens), Linear's density, a printed rate card.
- **Anti-references**: KPI-tile dashboards, gauge/speedometer widgets, colourful progress rings, Xero/QuickBooks chrome, any "insights" card with an icon and a drop shadow.
- **Scoped palette exception**: the single-accent rule holds everywhere except the category breakdown donut, which needs 5–6 legible categories. There, terracotta (`--accent`) marks the largest category and the rest use a small, muted, same-family tonal ramp (desaturated warm greys/ochres sitting between `--muted` and `--accent`) — restrained enough to read as "the one chart with colour," not a rainbow.

## Existing Patterns

Pulled from the current `index.html` — binding.

- **Typography**: `Delight` (Georgia fallback, weight 700) for headings, card titles, and money figures. `Funnel Sans` for body/UI at 13px base; field and column labels are 10–11px uppercase with `letter-spacing:.08–.1em`.
- **Colors**: `--bg:#181818` `--text:#F0EDE8` `--surface:#2C2F35` `--border:#3D4A5C` `--accent:#B85444` `--ah:#9a3d31` (accent hover) `--muted:rgba(240,237,232,.42)` `--muted2:rgba(240,237,232,.18)` `--row-hover:rgba(240,237,232,.03)`.
- **Shape/spacing**: flat edges everywhere (no border-radius in the app), 1px solid borders, card padding ~22px, modal padding 28×32px, dense table cells (7×14px).
- **Components already in the codebase** (reuse, don't reinvent):
  - `.btn` / `.btn-accent` — uppercase, tracked, transparent-until-hover buttons.
  - `.proj-card` — the card-grid tile pattern (accent underline sweep on hover).
  - `.field` — labeled input group (uppercase 10px label + bordered input).
  - `.est-table` — dense data table with uppercase muted headers.
  - `.modal-overlay` / `.modal-box` / `.modal-title` — the app's only modal pattern.
  - `.tax-setting` — the existing bordered block on the Pricing screen that holds the tax rate control. This becomes the shared control referenced by both Pricing and Goals.
  - Delete confirmation uses a native `confirm()` dialog (see `deleteProject()`), not a custom modal — expense-row deletion follows the same convention.
- **Persistence convention**: the app has no database today. `localStorage` already holds the rate card (`CATALOGUE_KEY`) and Invoice Settings (`lsc-invoice-settings`) — the only two things in the app that survive a restart at all. Overhead items, the overhead snapshot log, and Goals settings follow this same convention (new namespaced `localStorage` keys, JSON-shaped so they port cleanly into `nas-hosted-billing`'s SQLite schema later without a rewrite). Estimates themselves are still in-memory only (`var projects=[]`) — out of scope to fix here.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Nav item: "Overhead" | New | Flat top-level `.nav-link`, same pattern as `#nav-pricing`. |
| Nav item: "Goals" | New | Flat top-level `.nav-link`. |
| Overhead expense table | New | Extends `.est-table`: Name, Category, Cost, Frequency, computed monthly-equivalent, row actions. |
| Add/Edit Expense modal | New | Extends `.modal-box` + `.field`; category is a `select`, frequency is a `select`. |
| Delete expense row | New | Native `confirm()`, matching `deleteProject()`. |
| Overhead Summary Card | New | Extends `.proj-card`: Monthly Total / Annual Total, computed live from the table. |
| Historical Overhead Trend chart | New | Hand-rolled inline SVG line chart, one point per snapshot event. |
| Category Breakdown chart | New | Hand-rolled inline SVG donut, scoped tonal-ramp palette + legend. |
| Goals form | New | Extends `.field` group: Desired Net Income, Target Profit Margin %, Billable Capacity (hrs/wk), Tax Reserve Target %. |
| Tax Reserve Target control | Modify | `.tax-setting` becomes the one shared control, surfaced on both Pricing and Goals, writing the same stored value. |
| Overhead/Profit toggle (estimate editor) | New | Inline switch near the estimate totals, defaults on. |
| Cost breakdown modal/tooltip | New | Extends `.modal-box`: Direct Labor/Materials, Overhead Allocation, Net Profit Goal → Minimum Job Price. |

## Key Interactions

- **Adding an expense**: click "Add Expense" → `.modal-box` opens with empty `.field`s → save writes the row, appends one entry to the overhead snapshot log, closes the modal, and both the Summary Card and both charts update immediately (no page reload, no separate "recalculate" step).
- **Editing/deleting an expense**: edit reopens the same modal pre-filled; either action re-snapshots and re-renders totals/charts the same way add does. Delete asks via native `confirm()` first.
- **Setting Goals**: a single form, saved as one unit (not per-field autosave) with the same explicit "Save" affordance the Pricing screen uses today — consistent with "trust over speed": a write is confirmed before the UI says it stuck.
- **The estimate-editor toggle**: switching "Include Overhead & Profit Margin" on shows a small secondary line under the existing totals — "Minimum Job Price: $X" — with a `(?)` or click target that opens the cost breakdown modal showing the three-line math (Direct Labor/Materials, Overhead Allocation, Net Profit Goal). Switching it off removes the line entirely; the real billed total never moves either way.
- **Chart interaction**: hovering a donut segment or trend point shows its value (category + $ for the donut, date + total for the trend) — simple SVG `<title>`/tooltip, no external library.

## Responsive Behavior

This is an Electron desktop window, not a responsive web page — `main.js` fixes `minWidth: 1100` / `minHeight: 700` with no mobile or tablet target. The only real constraint is that the Overhead table, Summary Card, and both charts stay legible and don't overflow between 1100px and a fully maximized window — no breakpoint work beyond what already exists in the app.

## Accessibility Requirements

Matches the bar the rest of the app should already hold, since this is still a single-user professional tool, not a public site:

- All new interactive elements (`.btn`, toggle, chart legend items, table row actions) get a visible focus ring — the existing app currently lacks these broadly; don't make it worse here.
- Modals (`Add/Edit Expense`, cost breakdown) trap focus while open and return focus to the trigger on close, `Escape` closes.
- The donut chart's data is also available as a legend list (category name + $ + %), not colour-only — colourblind-safe even with the scoped tonal-ramp palette.
- Chart colours and `--muted` text must hit ≥4.5:1 contrast against `--bg`/`--surface`, same standard called out as outstanding work in the `nas-hosted-billing` brief.

## Out of Scope

- Anything that requires the `nas-hosted-billing` server/API — no work here is blocked by or ported into that track as part of this brief.
- Multi-user or multi-account support of any kind — this remains a single-account tool.
- Making the fixed category list (Software, Admin/Legal, Marketing, Hosting, Tax, Other) user-editable.
- A "projects/year" capacity model — Billable Capacity is hours/week only.
- The toggle ever changing the actual billed client price — it is permanently advisory.
- Persisting `estimates` themselves (`var projects=[]` stays in-memory) — unrelated pre-existing gap, not introduced or fixed by this feature.
- Any mobile/tablet responsive layout work.
- Variance/actuals reporting (target vs. what was really earned) — this brief covers target-setting and the advisory floor only, not after-the-fact tracking against those targets.
