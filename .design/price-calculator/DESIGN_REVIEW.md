# Design Review: Finance & Price

Reviewed against: [DESIGN_BRIEF.md](DESIGN_BRIEF.md) (+ [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md))
Philosophy: Editorial dark utility — "a film-lab studio tool, not a SaaS dashboard", inherited
unchanged from `overhead-finance`
Date: 28 September 2026
Reviewed live against `api-scratch` at commit `08d1c72` (all 23 build tasks): $24,000/yr operating
costs + $2,850 replacement reserve, 8/5/30/8 capacity (1,776 hrs), 25% margin → $18.90 hourly
floor; one diminishing-value asset (Sony FX6, $8,800, 3-yr life) and one pooled MacBook.

## Screenshots Captured

Captured with headless Chrome (`puppeteer-core`, already a server dependency for PDF export),
signed in to the local scratch server with the test login named in `.claude/launch.json`. Full-page
unless noted. The below-floor states were produced by lowering three Mark-Ups **in the page's local
cache only** — nothing was saved.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-dashboard-desktop-1280.png` | Desktop (1280) | Floors, comparison (all clear), how-the-floor-is-built panels, revenue/jobs, post ratio, GST |
| `screenshots/review-dashboard-tablet-768.png` | Tablet (768) | Same; comparison table wrapping (Should fix 1) |
| `screenshots/review-dashboard-mobile-375.png` | Mobile (375) | Horizontal rail, stacked floors, collapsed comparison |
| `screenshots/review-dashboard-below-floor-desktop-1280.png` | Desktop (1280, viewport) | Top of the Dashboard with three rows below floor |
| `screenshots/review-dashboard-below-floor-table-desktop-1280.png` | Desktop (1280, viewport) | Comparison table: "3 of 21 below floor", `Below by $X` links |
| `screenshots/review-dashboard-below-floor-mobile-375.png` | Mobile (375) | Comparison opening on the three below-floor rows as cards |
| `screenshots/review-dashboard-info-open-desktop-1280.png` | Desktop (1280, viewport) | "How the floor comparison works" popover open |
| `screenshots/review-rate-card-desktop-1280.png` | Desktop (1280) | Rate Card with day rows, hours field, floor lines |
| `screenshots/review-rate-card-below-floor-desktop-1280.png` | Desktop (1280, viewport) | Rate Card floor line in the below-floor state |
| `screenshots/review-rate-card-tablet-768.png` | Tablet (768) | Rate Card at the tablet floor |
| `screenshots/review-rate-card-mobile-375.png` | Mobile (375) | Stacked rate card |
| `screenshots/review-overhead-desktop-1280.png` | Desktop (1280) | Operating Costs: summary, table, donut, trend |
| `screenshots/review-overhead-tablet-768.png` | Tablet (768) | Same |
| `screenshots/review-overhead-mobile-375.png` | Mobile (375) | Same |
| `screenshots/review-depreciation-desktop-1280.png` | Desktop (1280) | Two numbers, register, decline curve, schedule, CSV, threshold |
| `screenshots/review-depreciation-tablet-768.png` | Tablet (768) | Same; pinned actions column |
| `screenshots/review-depreciation-mobile-375.png` | Mobile (375) | **Captured 407px wide** — the overflow in Must fix 1 |
| `screenshots/review-depreciation-asset-modal-desktop-1280.png` | Desktop (1280, viewport) | Add Asset dialog, first field focused |
| `screenshots/review-depreciation-dispose-modal-desktop-1280.png` | Desktop (1280, viewport) | Dispose dialog |
| `screenshots/review-capacity-desktop-1280.png` | Desktop (1280) | Annual hours above the four fields, save bar, full-day hours |
| `screenshots/review-capacity-tablet-768.png` | Tablet (768) | Same |
| `screenshots/review-capacity-mobile-375.png` | Mobile (375) | Same |
| `screenshots/review-profit-goals-desktop-1280.png` | Desktop (1280) | Fields, read-only capacity, shared tax control, target revenue |
| `screenshots/review-profit-goals-tablet-768.png` | Tablet (768) | Same |
| `screenshots/review-profit-goals-mobile-375.png` | Mobile (375) | Same |
| `screenshots/review-rail-focus-desktop-1280.png` | Desktop (1280, viewport) | Keyboard focus ring on a rail item |

> All screenshots are in `.design/price-calculator/screenshots/`.

Dark mode: not applicable — the site is dark-only by design; there is no light theme or toggle.

## Summary

Finance & Price reads as the brief asked: a printed cost sheet in the app's own dark editorial
system, not a dashboard product. The rail is indistinguishable in voice from the header nav, the
Dashboard lays the whole cost → capacity → floor chain out on one page with every owned figure
linking home, and the comparison states its disagreement with the card as a dollar gap in
`--accent-text` rather than a colour-coded grade. **One must-fix, and it was introduced by the last
build task:** the decline curve's screen-reader table pushed the Depreciation tab 32px past a
375px screen. It is fixed in this change. The biggest remaining issues are the floor comparison table
wrapping through the whole 1099–768 band, and the below-floor badge looking like a link without
being one.

## Must Fix

1. **The Depreciation tab overflowed every phone by 32px** — live since `08d1c72`. The decline
   curve's screen-reader `<table>` carried `.sr-only` directly; a table ignores `width: 1px` and
   lays out at its content width, so it sat 375px wide from an offset inside the chart block and
   made the page 407px wide at a 375px viewport (the whole page then zooms out to fit on a real
   phone). See `screenshots/review-depreciation-mobile-375.png` — the capture itself is 407px wide.
   _Fixed in this change_: `.sr-only` moved to a wrapping `<div>` whose `overflow: hidden` clips
   the table (`web/js/views/overhead-charts.js`, `declineTable()`). Verified: 375px page at 375px,
   all six table rows still in the accessibility tree. **Needs a push to reach the live site.**

## Should Fix

Items 5–10 were filed as could-improve and moved here at the user's request, the same day —
the whole list is now the fix backlog. Item 3 is site-wide and item 8 overturns an
overhead-finance IA decision; both want the user's go-ahead before they're built.

1. **The floor comparison table wraps across the whole tablet band.** At 1100px it fits on one line
   per row; at 1000px 13 of 21 rows run to two lines, at 900px 15, and at 768 the "Against floor"
   column splits "$37.10 / over" and Section hyphenates "Pre- / Production". A 21-row table becomes
   ~40 visual lines, and the one column the table exists for is the one that breaks. See
   `screenshots/review-dashboard-tablet-768.png`. _Fix: in the 1099–768 band, hide the Section
   column (the service names already carry it, and the <768 cards and the Rate Card both show it)
   and `white-space: nowrap` the four numeric columns. `finance-dashboard.css` / `responsive.css`,
   the Dashboard's own table only._
2. **"Below by $X" looks like a link and isn't one.** `.dash-badge` is a `<span>` drawn with an
   accent underline (`finance-dashboard.css:104`), the same visual language as the Dashboard's real
   links, so it invites a click that does nothing. The IA's "Checking a day rate" flow has it go to
   the Rate Card with that row focused, and the Dashboard task says every figure deep-links to its
   owner. The Rate Card is one rail click away, so nothing is unreachable — but the most actionable
   thing on the page is the one element that doesn't act. See
   `screenshots/review-dashboard-below-floor-table-desktop-1280.png`. _Fix: make it a `<button>`
   calling `onGoTab('pricing', { focusRow: … })`, and have the Rate Card focus that row's Mark-Up
   on mount. Key the row by section id + index, not name — names are user-editable._
3. **Every text input is 13px on phones, so iOS Safari zooms the page on focus.** Tapping Capacity's
   hours, a Mark-Up, the post-ratio fields or anything in the asset dialog zooms in and leaves the
   page zoomed after blur. This is **site-wide** — `app.css` sets 13px on all inputs and
   `responsive.css` never raises it below 768 — so it is not Finance & Price's own defect, but this
   feature adds more inputs than any screen before it. _Fix: one rule in `responsive.css`'s <768
   band, `input, select, textarea { font-size: 16px }`. It changes every form on a phone, so it
   wants the user's go-ahead rather than a quiet inclusion._
4. **No real screen-reader pass yet.** The accessibility pass verified the announcer regions and
   the hidden chart table by reading the DOM, not by listening. Most worth hearing: whether the
   announcer regions inside the `aria-modal` asset and dispose dialogs speak in VoiceOver, and
   whether the one-second debounce feels right while typing. _Fix: ten minutes with VoiceOver on
   Capacity, the Rate Card and the asset dialog._
5. **On a phone the floors push the comparison down ~700px.** Three full-width tiles at ~180px each
   stack before "Rate card against its floors", which is the answer the page is for. See
   `screenshots/review-dashboard-below-floor-mobile-375.png`. _Fix: below 768, render the floors
   as three label-left / figure-right rows in one block (Delight figures kept), about 190px in
   total._
6. **The comparison info popover opens over the floors it explains.** With less than ~340px below
   the button it flips upward and covers the Half Day tile. See
   `screenshots/review-dashboard-info-open-desktop-1280.png`. _Fix: prefer below and let the page
   scroll, flipping only when the button is in the bottom third of the viewport (`info.js`, shared
   by both info controls)._
7. **Day rows mix units in one line.** On the Rate Card, `Video Capture — Full Day` shows a Rate of
   `15.12` (per hour, per the column head) beside a Mark-Up of `1120` (per full day); the floor line
   underneath is what reconciles them. See `screenshots/review-rate-card-desktop-1280.png`.
   _Fix: render the read-only rate as `15.12/hr` on day-unit rows only._
8. **Derived outputs sit in different places on the two sibling screens** — Capacity's annual hours
   above its fields, Profit Goals' target revenue below its save bar. Each follows its own IA
   ordering (Goals' placement is the overhead-finance IA's "separated from everything editable").
   _Fix: pick one placement for both. Recommended: move Target Annual Revenue above Goals' fields,
   matching Capacity — the output is what people open the screen for, and the card's own border
   still separates it from the inputs. This overturns an overhead-finance IA decision, so it is the
   user's call._
9. **Capacity's save-bar sentence strands "at." on its own line at 1280.** See
   `screenshots/review-capacity-desktop-1280.png`. _Fix: `text-wrap: pretty` on
   `.pricing-save-bar p`, which every save bar shares._
10. **The Overhead donut legend runs the full block width**, leaving the amount ~350px from its
    category name at desktop. From `overhead-finance`, not this feature. See
    `screenshots/review-overhead-desktop-1280.png`. _Fix: cap the legend at ~420px._

## Checklist Notes

- **Visual hierarchy** — floors first at hero scale, then the comparison, then the working. The
  Depreciation tab leads with its two numbers, as the IA asks. Passes.
- **Consistency** — new CSS uses tokens throughout (two `--border`-at-40% divider tints and the
  popover's shadow are the only literals). Rail, schedule head, decline head and FY/asset pickers
  share one pattern. Passes.
- **Aesthetic fidelity** — no icons, gauges, rings or health scores; the only shadow is on a
  floating popover. The decline curve keeps to one grey plus the one terracotta point. Passes.
- **Components** — `LSCInfo`, `LSCModal`, `.est-table`, `.est-block`, `.field`, `Toast`,
  `LSCUnsaved` reused, none reimplemented. Passes.
- **States** — below-floor, empty and unset (em dashes with reasons), disposed, lodged, projected,
  loading and error states all present — except the below-floor badge's click (Should fix 2).
- **Responsive** — no page overflow at 1280 / 768 / 375 on any screen after Must fix 1; the rail,
  comparison and register all reorganise rather than shrink. Should fix 1 is the exception.
- **Accessibility** — covered by the accessibility pass (2026-09-28); contrast, focus rings (246
  controls), names, live announcements and focus return all verified. Should fix 4 remains.
- **Typography** — Delight/Funnel Sans load; captions sit at 60–78ch. Should fix 3 applies.
- **Mobile-first** — `responsive.css` is written desktop-down (`max-width`) by the Desktop
  Preservation Law, which keeps ≥1100px pixel-identical to the Electron app. A deliberate,
  documented deviation, not a finding.

## What Works Well

- **The Dashboard is the spreadsheet the brief described, without becoming a dashboard.** Floors,
  then the card measured against them, then exactly how the floor was built — cost left, capacity
  right — with every owned figure an underlined link to the screen that owns it.
- **Below floor is stated, not shouted.** "3 of 21 below floor" in the table head, a dollar gap per
  row in `--accent-text`, and nothing offering to fix it — principle 1, visibly. (Should fix 2 is
  about making that gap *go* somewhere, not about what it says.)
- **The phone comparison opens on the rows that matter** and hides the ones that clear, with the
  count in the head. That turns a 21-card scroll into three.
- **The decline curve shows the one thing the tab's info popover claims** — diminishing value's
  front-loaded first year — because it starts from the cost base, and it separates reported from
  projected by fill and dash rather than by colour.
- **The two-number Depreciation card** (reserve "in every rate on your card", deduction "in no
  rate") explains the split before anyone has to open the info button.
