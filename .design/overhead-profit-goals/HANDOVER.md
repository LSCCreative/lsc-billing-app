# Handover: Overhead Dashboard, Profit Goals & Dynamic Pricing Integration

For a fresh agent picking this up. Feature slug: `overhead-profit-goals`. Project: LSC Billing (Electron app), root at the repo containing this `.design/` folder.

## Where this is in the design flow

Running `/design-flow`, sequence: Grill Me → **Design Brief (done)** → Information Architecture (next) → Design Tokens (skipped, see below) → Brief to Tasks → Frontend Design → Design Review (on request).

**Completed:**
1. **Grill Me** — no file output, decisions folded into the brief (see "Resolved decisions" below).
2. **Design Brief** — [.design/overhead-profit-goals/DESIGN_BRIEF.md](DESIGN_BRIEF.md).

**Not started:**
3. Information Architecture — page structure, routing/nav placement detail, how the estimate editor's new toggle connects to Overhead/Goals data.
4. Design Tokens — **deliberately skipped**: this app already has a locked dark-editorial token set (`:root` in `index.html`), documented in the brief's "Existing Patterns" section. No new token file is planned; the only net-new visual decision (the donut chart's scoped colour exception) is already specified in the brief.
5. Brief to Tasks — ordered build checklist, not yet generated.
6. Frontend Design — no code written yet.
7. Design Review — not applicable until Frontend Design produces something.

**To resume:** run `/design-flow` and say you're continuing `overhead-profit-goals` from Information Architecture, or just run the `information-architecture` skill directly against `.design/overhead-profit-goals/DESIGN_BRIEF.md`.

## Codebase orientation (read before touching anything)

This app is **not** the server/NAS-hosted rewrite. Two codebases exist in this repo:

- **`index.html` / `main.js` / `preload.js`** — the live Electron app. This is where this feature gets built. No database — `localStorage` holds the rate card (`CATALOGUE_KEY`) and Invoice Settings (`lsc-invoice-settings`); estimates themselves are in-memory only (`var projects=[]`, unpersisted — a pre-existing gap, not this feature's problem to fix).
- **`server/`** — a separate, mid-migration rewrite to a Node/SQLite/Docker NAS-hosted service (`.design/nas-hosted-billing/`). Its schema, auth, and pure money model (`server/src/calc.js`) exist, but the CRUD API routes and the ported UI do not (`server/src/app.js` has comments saying "mount here" with nothing mounted; `server/public/` is empty). **This feature explicitly does not depend on or block on this track** — see the brief's header and Out of Scope section.

Don't confuse the two. If a fresh agent starts reading `server/src/calc.js`, that's fine for understanding the money model concepts (labour/expense totals, tax set-aside), but the actual UI and persistence work happens in `index.html`.

## Resolved decisions (do not re-litigate — re-derive from Grill Me only if something here seems wrong)

1. **Build target**: directly in the Electron app (`index.html`), not the server track.
2. **Persistence**: new `localStorage` keys, JSON-shaped, following the existing convention used by the rate card and Invoice Settings. Overhead expense items (CRUD), an append-only overhead snapshot log (one entry per add/edit/delete), and a Goals singleton record.
3. **Tax rate unification**: the existing `taxSetAsideRate` concept (currently a `.tax-setting` block on the Pricing screen, default 0.35) is the *same* value as the new Goals page's "Tax Reserve Target %" — one stored number, editable from both places, not two independent rates. This was a deliberate real-world-accounting call: a sole trader's per-invoice tax set-aside and their annual income-goal tax assumption have to be the same rate or the numbers never reconcile.
4. **Minimum Job Price is advisory only** — shown alongside the real billed total in the estimate editor, never overwrites `clientPriceExGst` or any line item.
5. **Capacity model**: Billable Capacity = hours/week, annualized ×52. Estimated Hours per job = the existing per-estimate `totalHours` already computed in `calc.js` from labour rows.
6. **Direct Job Costs** in the Minimum Job Price formula = `calc.js`'s existing `expenseTotal` (travel/crew/equipment pass-through costs), **not** `labourTotal` — labour cost is separately re-estimated via Estimated Hours × Overhead Rate for this floor calculation.
7. **Toggle**: "Include Overhead & Profit Margin in Calculation" lives per-estimate inside the estimate editor (next to totals), **defaults ON** (user's explicit choice, overriding the initial "off by default" recommendation).
8. **Charts**: hand-rolled inline SVG for both the historical trend (line) and category breakdown (donut) — no new npm/frontend dependency, matching the app's current zero-dependency pattern.
9. **Snapshot cadence**: event-based, one row per expense add/edit/delete — not a scheduled rollup.
10. **Navigation**: two new flat top-level nav items, "Overhead" and "Goals", alongside the existing Estimates / Pricing / Invoice Settings — no submenu/grouping.
11. **Palette exception**: the app's "one accent colour" rule is explicitly broken, *only* for the category donut chart, using a small distinct qualitative palette (5–6 hues) anchored on the existing terracotta `--accent`. Nowhere else in the app.
12. **Category list** (fixed, not user-editable): Software, Admin/Legal, Marketing, Hosting, Tax, Other.
13. **Delete pattern**: reuse the app's existing native `confirm()` convention (see `deleteProject()` in `index.html`) — no new custom confirmation modal.

## Formulas to implement (from the original spec, unchanged)

- `Annual Total = (Weekly × 52) + (Monthly × 12) + (Quarterly × 4) + Yearly`
- `Target Annual Revenue = (Total Annual Overhead + Target Net Income) / (1 - Tax Rate %)`
- `Overhead Rate Per Hour = Total Annual Overhead / Annual Billable Hours`
- `Minimum Job Price = (Direct Job Costs + (Estimated Hours × Overhead Rate)) × (1 + Profit Margin %)`

## Existing visual system to reuse (see brief for full detail)

Tokens: `--bg:#181818` `--text:#F0EDE8` `--surface:#2C2F35` `--border:#3D4A5C` `--accent:#B85444` `--ah:#9a3d31` `--muted:rgba(240,237,232,.42)`. Fonts: `Delight` (headings/money, weight 700) + `Funnel Sans` (body/UI, 13px base). Reusable components: `.btn`/`.btn-accent`, `.proj-card`, `.field`, `.est-table`, `.modal-overlay`/`.modal-box`, `.tax-setting`. No border-radius anywhere in the app — flat edges throughout.

## Open items for whoever does Information Architecture next

- Exact page layout for `/dashboard/overhead` and `/dashboard/goals` (these are Electron in-app views, not real routes — probably new `view` states in the existing single-page nav switcher, same pattern as `#nav-pricing`/`#nav-invoice-settings`).
- Where exactly in the estimate editor's totals block the new toggle and Minimum Job Price line sit relative to the existing `clientPriceExGst`/`totalIncGst` display.
- Whether the Goals form autosaves per-field or uses one explicit Save button (brief recommends matching Pricing's explicit-save pattern, but IA should confirm against the actual estimate-editor save-state conventions).
