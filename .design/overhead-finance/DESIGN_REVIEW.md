# Design Review: Finance — Overhead, Goals & Cost-Basis Pricing

Reviewed against: [DESIGN_BRIEF.md](DESIGN_BRIEF.md) (+ [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md))
Philosophy: Editorial dark utility — "a film-lab studio tool, not a SaaS dashboard"
Date: 18 September 2026
Reviewed live against `api-scratch` (the brief's worked example: $24,000/yr overhead, $90k net,
25% margin, 20 hrs/wk → $25/hr; 12 overhead snapshots Jul 2025 – Sep 2026).

## Screenshots Captured

**These were captured and analysed in the Claude desktop app's built-in browser pane, which returns
images to the reviewer but cannot write files to disk.** No Playwright/Cursor browser MCP was
available, and the alternative — driving a separate headless browser — would have meant the
reviewer signing in to the app itself, which it does not do. The table below names every view that
was captured and examined, so findings stay traceable; `screenshots/` was not created. To keep a
file record, capture these views manually (or run this review again in an environment with
Playwright MCP).

| Capture | Breakpoint | Description |
| --- | --- | --- |
| `review-pricing-desktop-1280` | Desktop (1280×800) | Pricing sub-tab: computed read-only rates beside editable Mark-Up, explanatory note |
| `review-overhead-desktop-1280` (top, lower) | Desktop (1280×800) | Summary Card, GST note, expense table; donut + legend; trend chart |
| `review-goals-desktop-1280` | Desktop (1280×800) | Goals form, shared tax control, save bar, Target Annual Revenue |
| `review-add-expense-modal-error-desktop-1280` | Desktop (1280×800) | Add Expense dialog after submitting empty — validation state |
| `review-overhead-empty-desktop-1280` | Desktop (1280×800) | First-run: no expenses, no snapshots |
| `review-goals-empty-desktop-1280` | Desktop (1280×800) | First-run: no goals, no overhead (em-dash stat) |
| `review-overhead-tablet-768` (top, lower) | Tablet (768×1024) | Full Overhead screen at the tablet floor |
| `review-goals-tablet-768` | Tablet (768×1024) | Three-column form, save bar (post layout-check fix) |
| `review-overhead-mobile-375` (top, charts) | Mobile (375×812) | Stacked table, stacked Summary Card, ring above legend, 2-label trend |
| `review-editor-mjp-mobile-375` | Mobile (375×812) | Estimate editor: toggle, summary bars, Minimum Job Price line + `(?)` |
| Cost breakdown dialog, desktop + 375px | — | Captured and reviewed in the cost-breakdown task this same session (HANDOVER.md entry 16) |

Dark mode: not applicable — the site is dark-only by design; there is no light theme or toggle.

## Summary

The Finance area reads exactly as the brief asked: more pages of the same rate card, not an
analytics product bolted on. Flat 1px-bordered blocks, small-caps tracked heads, one accent doing
the interactive work, and the donut as the single, restrained colour exception — no KPI tiles, no
gauges, no drop shadows. **No must-fix issue was found in the Finance feature itself.** The most
important findings are inherited, site-wide semantic gaps — there are no headings on any screen and
no `<main>` landmark once signed in — which the Finance screens reproduce rather than introduce.

## Must Fix

None in the Finance feature. Everything the brief's Accessibility Requirements list was verified
in the Accessibility pass (HANDOVER.md entry 18): focus rings on all 162 controls, every text style
≥4.5:1, every chart colour ≥4.70:1, Pricing's computed rates `aria-readonly` + described, both
dialogs trapping focus and returning it.

## Should Fix

> **All five actioned 2026-09-21**, plus could-improve 4 — see HANDOVER.md entry 20 and decisions
> 75–79. Kept below as written, for the reasoning.

1. **No heading structure on any Finance screen, and no `<main>` landmark after sign-in.** A
   heading walk of Pricing, Overhead and Goals found **zero** `h1`–`h6` elements: the page title is
   `<div class="page-title">` and block heads ("Recurring Costs", "Category Breakdown", "Overhead
   Trend") are divs. The only `<main>` in the document is `#login-view`, which is hidden once
   signed in; the app renders into `<div id="main">`. So a screen-reader user cannot jump by
   heading or landmark on any Finance screen — WCAG 1.3.1 / 2.4.1. **Site-wide and pre-existing**
   (the estimate editor builds `<div class="page-title">` the same way), so the brief's "must not
   fall below the site bar" is technically met — but this is the single highest-value accessibility
   fix left in the app. _Fix: render `.page-title` as `<h1>` and `.bb-label` / block-head titles as
   `<h2>` (class styling unchanged, so visually identical); make `#main` a `<main>` element. Do it
   site-wide in one pass rather than Finance-only, or the screens will disagree._

2. **Validation errors are not tied to the fields they are about.** Submitting an empty Add
   Expense form lists all three problems in one `role="alert"` box (good — announced, nothing
   lost), but the Name, Category and Cost fields themselves show no change and carry no
   `aria-invalid`. See `review-add-expense-modal-error-desktop-1280`. A sighted user has to map
   three sentences back onto three fields; a screen-reader user tabbing back into the form hears
   nothing on the offending field. No form in the app uses `aria-invalid` (Goals, Invoice Settings,
   Overhead all checked), so again site-wide. _Fix: on a failed validation set
   `aria-invalid="true"` on each failing field and give `[aria-invalid="true"]` a border in the
   existing error red (`#7a2222`, or the token from item 4); clear it on input._

3. **The donut legend is too wide at desktop.** At 1280px the legend stretches ~700px, so a
   category name and its amount sit ~350px apart ("Hosting … $1,800.00") and the eye has to track
   across the row rules to pair them. See `review-overhead-desktop-1280` (lower). At 768px (439px
   legend) it reads well — `review-overhead-tablet-768` — which is why the layout check kept the
   side-by-side arrangement (decision 68); the problem is the other end of the range. _Fix: cap
   `.oh-legend` at ~`max-width: 480px` in `overhead.css`. It is a desktop-width change, so it
   belongs in the base stylesheet rather than `responsive.css`; the ring stays where it is and the
   legend simply stops growing._

4. **The error-message styling is copy-pasted into seven stylesheets.** The same
   `#7a2222` / `#1f1414` / `#f0a0a0` triplet and near-identical box rules appear in `app.css`,
   `clients.css`, `estimates.css`, `settings.css`, `pricing.css`, and — added by this feature —
   `overhead.css` and `goals.css`. Nothing is wrong on screen today; it is the one place the
   Finance CSS hardcodes colour instead of using a token, and it inherited that habit rather than
   fixing it. _Fix: add `--err-border`, `--err-bg`, `--err-text` to `app.css`'s `:root` and one
   shared `.form-error` rule; point the seven id-scoped error boxes at it._

5. **The preload failure message still names only the rate card.** `web/js/app.js:124` shows
   "Couldn't load your rate card" when the startup `Promise.all` fails — but that call now also
   fetches overhead items, snapshots and goals, so a 500 from `/api/overhead-items` blames the
   wrong thing. The remedy it gives ("reload once the server is back") is still right, which is
   why it was left alone (HANDOVER.md Open items). _Fix: "Couldn't load your pricing and finance
   settings" — or keep it generic: "Couldn't load your settings"._

## Could Improve

1. **The Target Annual Revenue card uses half the width and leaves the right half empty** at
   desktop and tablet, directly under a full-width save bar. See `review-goals-desktop-1280`. It
   is the answer the whole form exists to produce, and it currently reads as a leftover.
   _Suggestion: either full width to match the save bar above it, or keep the width and put a
   second, related stat beside it (e.g. the resulting Overhead Rate/hr, which the IA doc allows
   to appear on Finance screens) so the row is intentional._

2. **Desired Net Income shows as a raw `90000`.** A number input cannot show separators, and the
   rest of the app's inputs are raw too, so this is consistent — but it is the one input on these
   screens large enough for a misplaced zero to go unnoticed. _Suggestion: echo the typed value
   formatted in the field's hint ("$90,000 a year") as the user types._

3. **Live figures are not announced (decision 74, deferred here by the user).** Target Annual
   Revenue, the editor's summary bar and the Minimum Job Price repaint silently. Recorded, not
   re-litigated: the right shape if it is wanted is a debounced (~1s) visually hidden
   `aria-live="polite"` region announcing the headline figure once typing pauses.

4. **No `prefers-reduced-motion` handling anywhere in the app.** Low risk for Finance — its only
   motion is 0.15s colour fades on buttons, the `(?)` and the dialog's selects, nothing that moves — but
   a single site-wide `@media (prefers-reduced-motion: reduce) { * { transition: none !important } }`
   in `a11y.css` would close it for good.

5. **`Funnel Sans` is not embedded (site-wide, pre-existing).** Body text resolves from the
   device or falls back to the system sans, so on a phone or a machine without it installed the
   UI font is not the designed one. Documented in `nas-hosted-billing/TASKS.md`'s font task, not
   introduced here.

### Noted, deliberately not findings

- **Desktop-first media queries, 13px body text on mobile.** The checklist asks for mobile-first
  queries and ≥16px mobile body text. The site is built desktop-first on purpose (the "Desktop
  Preservation Law" in `responsive.css`) and the brief's principle is "same density, same
  restraint"; Finance follows both. A 16px mobile base would be a site-wide redesign decision,
  not a Finance fix.
- **Two names for the shared tax field** ("Tax Reserve Target" on Goals, "Tax Set-Aside Rate" on
  Pricing), an open item carried into this review. The IA doc keeps both on purpose, and the Goals
  hint already reconciles them on screen — _"The same setting as the rate card's Tax Set-Aside
  Rate — change it here and it changes there."_ Recommend closing it as-is.
- **Uneven date-label spacing on the trend chart** is correct: the x axis is event order, not
  elapsed time (decision 38), and the caption says so in words.

## What Works Well

- **Aesthetic fidelity is high.** Every Finance screen could sit in the original desktop app
  unnoticed. The anti-references are all avoided: the Summary Card is a flat bordered stat, not a
  KPI tile; the charts are thin-stroked and label-led; nothing has a shadow or an icon-card. The
  donut is the only colour, as scoped, and it reads as "the one chart with colour", not a rainbow.
- **Read-only is signalled, not just enforced.** On Pricing the computed rate renders as flat
  unboxed text beside boxed, editable Mark-Up inputs, with the note directly above explaining why
  — you can see which column is yours before touching anything (`review-pricing-desktop-1280`).
- **Empty states are written, not defaulted.** First-run Overhead gives each block one plain
  sentence about what will appear and why; Goals shows an em dash and a link to the tab that fills
  it; Pricing's rates show a muted `—`. No `$0` masquerading as an answer, no axis drawn around
  nothing (`review-overhead-empty-desktop-1280`, `review-goals-empty-desktop-1280`).
- **The advisory floor stays secondary.** At every width "Total (inc GST)" in accent remains the
  dominant figure and the Minimum Job Price sits below it in `--text`, quiet but legible, with its
  `(?)` tied to the figure (`review-editor-mjp-mobile-375`).
- **Responsive adaptation reorganises rather than shrinks.** Below 768px the expense table becomes
  label/value blocks with actions under the values, the Summary Card stacks, the ring centres above
  its legend, and the trend drops to two date labels — all measured overflow-free down to 320px.
- **Copy does real work.** The GST-exclusive hint, the "estimates already saved keep the figures
  they were quoted at" save-bar line, and the trend caption explaining event-order spacing each
  pre-empt a specific wrong conclusion a user could otherwise draw about money.
- **Consistency with existing components.** `.nav-link` sub-tabs, `.est-table`, `.est-block`,
  `.modal-box` + the shared `LSCModal` focus trap, `.tax-setting` and `.pricing-save-bar` are all
  reused rather than re-implemented; the one new shared module (`modal.js`) removed a duplicate
  instead of adding one.
