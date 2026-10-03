# Design Review: Finance & Price

Reviewed against: [DESIGN_BRIEF.md](DESIGN_BRIEF.md) (+ [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md))
Philosophy: Editorial dark utility — "a film-lab studio tool, not a SaaS dashboard", inherited
unchanged from `overhead-finance`
Date: 28 September 2026
Reviewed live against `api-scratch` at commit `08d1c72` (all 23 build tasks): $24,000/yr operating
costs + $2,850 replacement reserve, 8/5/30/8 capacity (1,776 hrs), 25% margin → $18.90 hourly
floor; one diminishing-value asset (Sony FX6, $8,800, 3-yr life) and one pooled MacBook.

## Screenshots

Removed to save space; re-capture if needed (the findings below stand alone).

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

**Status 2026-09-28: 1–3 and 5–10 fixed** (the user approved 3 and 8 as suggested); **4 stays
open**, because it needs a person listening to VoiceOver. Each item's outcome is under it. Verified
with headless Chrome against `api-scratch`, by measurement and screenshot; see the handover's
"What landed — review should-fixes".

1. **The floor comparison table wraps across the whole tablet band.** At 1100px it fits on one line
   per row; at 1000px 13 of 21 rows run to two lines, at 900px 15, and at 768 the "Against floor"
   column splits "$37.10 / over" and Section hyphenates "Pre- / Production". A 21-row table becomes
   ~40 visual lines, and the one column the table exists for is the one that breaks. See
   `screenshots/review-dashboard-tablet-768.png`. _Fix: in the 1099–768 band, hide the Section
   column (the service names already carry it, and the <768 cards and the Rate Card both show it)
   and `white-space: nowrap` the four numeric columns. `finance-dashboard.css` / `responsive.css`,
   the Dashboard's own table only._
   **Fixed.** Section hidden and the figure cells held to one line in a bounded 768–1099 query;
   the headings may wrap and the cells lose 4px a side. Rows wrapping: 0 from 1099 down to 850
   (was 13 at 1000 and 15 at 900); 3 of 21 at 768, long service names only.
2. **"Below by $X" looks like a link and isn't one.** `.dash-badge` is a `<span>` drawn with an
   accent underline (`finance-dashboard.css:104`), the same visual language as the Dashboard's real
   links, so it invites a click that does nothing. The IA's "Checking a day rate" flow has it go to
   the Rate Card with that row focused, and the Dashboard task says every figure deep-links to its
   owner. The Rate Card is one rail click away, so nothing is unreachable — but the most actionable
   thing on the page is the one element that doesn't act. See
   `screenshots/review-dashboard-below-floor-table-desktop-1280.png`. _Fix: make it a `<button>`
   calling `onGoTab('pricing', { focusRow: … })`, and have the Rate Card focus that row's Mark-Up
   on mount. Key the row by section id + index, not name — names are user-editable._
   **Fixed** as suggested. The accessible name reads "Below by $17.90: change <service>'s Mark-Up
   on the Rate Card". All three below-floor badges were clicked and each landed on its own
   row's Mark-Up, focused and centred.
3. **Every text input is 13px on phones, so iOS Safari zooms the page on focus.** Tapping Capacity's
   hours, a Mark-Up, the post-ratio fields or anything in the asset dialog zooms in and leaves the
   page zoomed after blur. This is **site-wide** — `app.css` sets 13px on all inputs and
   `responsive.css` never raises it below 768 — so it is not Finance & Price's own defect, but this
   feature adds more inputs than any screen before it. _Fix: one rule in `responsive.css`'s <768
   band, `input, select, textarea { font-size: 16px }`. It changes every form on a phone, so it
   wants the user's go-ahead rather than a quiet inclusion._
   **Fixed with the user's go-ahead.** It needed `!important`, because the sizes it replaces are
   set by class selectors up to (0,2,1). Checkboxes and radios are excluded. A sweep of every
   screen, the asset dialog, the estimate editor and login at 375 found no field under 16px and
   no page overflow. It surfaced one knock-on, now fixed: the estimate editor's service picker
   ran 16px off-screen until it was given `min-width: 0`.
4. **No real screen-reader pass yet.** The accessibility pass verified the announcer regions and
   the hidden chart table by reading the DOM, not by listening. Most worth hearing: whether the
   announcer regions inside the `aria-modal` asset and dispose dialogs speak in VoiceOver, and
   whether the one-second debounce feels right while typing. _Fix: ten minutes with VoiceOver on
   Capacity, the Rate Card and the asset dialog._
   **Still open.** It needs a person, not an agent.
5. **On a phone the floors push the comparison down ~700px.** Three full-width tiles at ~180px each
   stack before "Rate card against its floors", which is the answer the page is for. See
   `screenshots/review-dashboard-below-floor-mobile-375.png`. _Fix: below 768, render the floors
   as three label-left / figure-right rows in one block (Delight figures kept), about 190px in
   total._
   **Fixed.** One bordered block with three rows (label and note left, 28px Delight figure
   right), 180px in total. The comparison now starts at y=583 on a 375×812 phone.
6. **The comparison info popover opens over the floors it explains.** With less than ~340px below
   the button it flips upward and covers the Half Day tile. See
   `screenshots/review-dashboard-info-open-desktop-1280.png`. _Fix: prefer below and let the page
   scroll, flipping only when the button is in the bottom third of the viewport (`info.js`, shared
   by both info controls)._
   **Fixed.** The popover flips only when its button is in the bottom third of the viewport,
   and the side is chosen once, on open, so it doesn't jump around while scrolling. At
   1280×800 it opens below and overlaps no floor. At 1280×600, where the button is in the
   bottom third, it flips.
7. **Day rows mix units in one line.** On the Rate Card, `Video Capture — Full Day` shows a Rate of
   `15.12` (per hour, per the column head) beside a Mark-Up of `1120` (per full day); the floor line
   underneath is what reconciles them. See `screenshots/review-rate-card-desktop-1280.png`.
   _Fix: render the read-only rate as `15.12/hr` on day-unit rows only._
   **Fixed**, with the day-row field widened to 90px so "15.12/hr" isn't clipped (the extra
   width goes left, so the column stays aligned).
8. **Derived outputs sit in different places on the two sibling screens** — Capacity's annual hours
   above its fields, Profit Goals' target revenue below its save bar. Each follows its own IA
   ordering (Goals' placement is the overhead-finance IA's "separated from everything editable").
   _Fix: pick one placement for both. Recommended: move Target Annual Revenue above Goals' fields,
   matching Capacity — the output is what people open the screen for, and the card's own border
   still separates it from the inputs. This overturns an overhead-finance IA decision, so it is the
   user's call._
   **Fixed with the user's go-ahead.** Target Annual Revenue now leads Profit Goals. The shared
   `.goals-outcome` now carries the top-of-screen margin itself, so Capacity's `.cap-outcome`
   override was deleted. The overhead-finance IA records the reversal.
9. **Capacity's save-bar sentence strands "at." on its own line at 1280.** See
   `screenshots/review-capacity-desktop-1280.png`. _Fix: `text-wrap: pretty` on
   `.pricing-save-bar p`, which every save bar shares._
   **Fixed, with `balance` rather than `pretty`.** Chrome's `pretty` only rescues a one-word
   last line, and "quoted at." is two words, so `pretty` measurably changed nothing. At 1280
   Capacity's sentence is now two lines of 431 and 401px.
10. **The Overhead donut legend runs the full block width**, leaving the amount ~350px from its
    category name at desktop. From `overhead-finance`, not this feature. See
    `screenshots/review-overhead-desktop-1280.png`. _Fix: cap the legend at ~420px._
   **Fixed at 340px, not 420.** The rows were already capped at 480, which is what left the
   ~300px gap. The category names are a fixed list, the longest ~80px, so at 340 nothing
   truncates.

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
