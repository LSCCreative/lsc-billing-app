# Design Review: Service Rate Tiers

Reviewed against: [DESIGN_BRIEF.md](DESIGN_BRIEF.md) (+ [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md))
Philosophy: The existing dark editorial system, "extended rather than restyled" (inherited from
`overhead-finance` / `price-calculator`)
Date: 29 September 2026

**How this was reviewed.** The live site sits behind a real login, and an agent may not type a real
password, so it was not signed in to. Instead the review ran against the same code: the eight
deployed files that matter (`calc.js`, `pricing.js`, `estimate-editor.js`, `finance-dashboard.js`,
`pricing.css`, `responsive.css`, `estimates.css`, `finance-dashboard.css`) were fetched from
`lsccreative.github.io/lsc-billing-app/` and are **byte-identical** to `web/` on `main`
(`851050c`). `web/` was then driven through the local scratch API (schema v9), signed in with the
test login named in `.claude/launch.json`. Data: $80,000 target pay, 25% markup, 1,776 billable hrs →
$82.16 income floor, 21 services (3 legacy "— Full Day / — Half Day / per hour" rows still to be folded
by hand), 5 saved estimates. Screenshots were taken with headless Chrome (`puppeteer-core`). The
below-floor and "set by you" states on the Video Capture row were produced by typing into the page
and **nothing was saved**. Editor lines were added to a draft and not saved.

Not checked: a real VoiceOver pass (still a person's job, see the handover), the estimator's disabled
"no price yet, needs Profit Goals" option (needs a database with no tax scale; its width was stress-
tested by injecting the option text), and the first-run empty state.

## Screenshots Captured

Full-page unless noted. Mobile pages are shown as side-by-side viewport slices, because a full-page
capture of a 9,000px phone page duplicates its tail in Chrome.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-rate-card-desktop-1280.png` | Desktop (1280) | Whole Rate Card on Hourly: Service Day, Show switch, four tables, state lines |
| `screenshots/review-rate-card-tablet-768.png` | Tablet (768) | Same |
| `screenshots/review-rate-card-mobile-375.png` | Mobile (375), 3 slices | Settings stack, Show as three thirds, stacked rows |
| `screenshots/review-rate-card-show-full-day-top-desktop-1280.png` | Desktop, viewport | Show = Full day: `120.96/day`, `· 8 billable hrs`, auto prices dimmed |
| `screenshots/review-rate-card-show-full-day-desktop-1280.png` | Desktop, table | The Production table on Full day |
| `screenshots/review-rate-card-show-full-day-tablet-768.png` | Tablet, top 1300px | Full day view; state line on one line |
| `screenshots/review-rate-card-show-full-day-mobile-375.png` | Mobile, viewport | Full day on a stacked row |
| `screenshots/review-rate-card-row-hidden-notice-desktop-1280.png` | Desktop, element | Hourly fine, half day typed below floor: the notice, select focused |
| `screenshots/review-rate-card-row-half-below-floor-desktop-1280.png` | Desktop, element | The same row on Half day: typed 100, "set by you · below floor" |
| `screenshots/review-rate-card-row-use-suggested-focus-desktop-1280.png` | Desktop, element | Real Tab from the price lands on `↺ use $103` with a focus ring |
| `screenshots/review-rate-card-service-day-invalid-save-desktop-1280.png` | Desktop, viewport | Half 12 > Full 8, Save pressed: the field is outlined, no reason in view |
| `screenshots/review-editor-desktop-1280.png` | Desktop (1280) | Edit Estimate, all sections, picker in each labour block |
| `screenshots/review-editor-prod-lines-desktop-1280.png` | Desktop, element | Three lines: Video Capture per hour, Photo Capture per half day, Video Capture per full day |
| `screenshots/review-editor-prod-lines-tablet-768.png` | Tablet, element | Same |
| `screenshots/review-editor-prod-lines-mobile-375.png` | Mobile, element | Stacked lines, `HALF DAYS` / `FULL DAYS` quantity labels |
| `screenshots/review-editor-preprod-lines-desktop-1280.png`, `-tablet-768.png`, `-mobile-375.png` | All three | The same for the Pre-Production block |
| `screenshots/review-editor-line-unit-focus-desktop-1280.png` | Desktop, element | Line unit select after keyboard focus |
| `screenshots/review-editor-picker-longest-option-tablet-768.png` | Tablet, element | Picker with the longest possible unit option injected |
| `screenshots/review-dashboard-desktop-1280.png` | Desktop (1280) | Floors from Service Day, one comparison row per service |
| `screenshots/review-dashboard-tablet-768.png` | Tablet (768) | Same |
| `screenshots/review-dashboard-mobile-375.png` | Mobile (375), 3 slices | Floors stacked, comparison rows as cards |

> All screenshots are in `.design/service-rate-tiers/screenshots/`. Earlier `responsive-*` files
> there are task 8's before/after measurements and were left alone.

Dark mode: not applicable. The site is dark-only by design.

## Summary

This is the brief delivered. One service is one row; the `per [unit ▾]` view switch changes what the
row shows without adding a column; "auto" and "set by you" read as siblings of the old floor line
rather than a new component; and the estimator's service → unit → Add picker is quiet enough that the
page looks like it always did. Nothing overflows at 1280, 768, 375 or 320, every colour I measured
clears WCAG AA, and the deployed files match what was reviewed. **There are no must-fixes.** The
largest finding is that a bad Service Day value gives the reason a page away from the field, against
the brief's "inline reason". The rest is small polish, mostly at ≥1100px, where the price column is
narrowest.

> **Status, 2026-09-29:** all four should-fixes are done (TASKS.md D1–D4). Two were done differently
> from the suggestion below: should-fix 1's inline reason is not a second `role="alert"`, and
> should-fix 2 applies from 768px, because the line wraps at every table width, 768 included. See
> the Done note in TASKS.md. The could-improves are open.

## Must Fix

None.

## Should Fix

1. **The Service Day error appears 2,300px from the field.** Type a Half value above the Full value
   (or 0, or over 24) and press Save Services: focus lands on the field, which is outlined and
   `aria-invalid="true"`, but the sentence "Fix this before saving: A half day can't be longer than a
   full day." is rendered in `#pricing-error` in the save bar at the bottom of the page (measured at
   y = 2,373 with the viewport at the top). A sighted user sees a red box and no reason. The brief
   (Key Interactions §1) says "an inline reason, the same as the existing hours field does".
   See [`review-rate-card-service-day-invalid-save-desktop-1280.png`](screenshots/review-rate-card-service-day-invalid-save-desktop-1280.png).
   _Fix: put a `role="alert"` line inside the Service Day block (under its description, in
   `--accent-text`) and point the fields' `aria-describedby` at it, as `pricing-error-0` already does
   for the save bar. Keep the save-bar message._

2. **The price state line wraps into dangling "·" separators at ≥1100px.** In the two-column layout
   the price cell is about 110px wide, so `set by you · below floor by $26.16 · ↺ use $103` breaks as
   `set by you ·` / `below floor by $26.16 ·` / `↺ use $103`, and `auto · floor $657.28` as `auto ·` /
   `floor $657.28`. Each line ends in a stray dot, and the row grows to three lines where today's
   floor line is one. At 768 and on phones the same text fits on one line and reads well. See
   [`review-rate-card-desktop-1280.png`](screenshots/review-rate-card-desktop-1280.png) and
   [`review-rate-card-row-hidden-notice-desktop-1280.png`](screenshots/review-rate-card-row-hidden-notice-desktop-1280.png).
   _Fix: in `pricing.css:161-170`, above 1100px, make `.pricing-floor` a column of
   `.pricing-state-part`s and drop the separators (they are text nodes, so wrap them in a
   `.pricing-state-sep` span that is `display: none` in that band)._

3. **The Show switch tells you which unit is on only by border hue.** Hourly / Half day / Full day
   differ by a red versus slate 1px border; the label colour is identical (measured `#F0EDE8` on both).
   This control is the only cue for what every row is displaying, and a red-versus-blue-grey border
   is hard to find at a glance, or for anyone who can't tell the two hues apart. See
   [`review-rate-card-show-full-day-top-desktop-1280.png`](screenshots/review-rate-card-show-full-day-top-desktop-1280.png).
   _Fix: `pricing.css:242`, give `.pricing-show-btn[aria-pressed='true']` `background: var(--surface)`
   as well, so the selected one is a filled block._

4. **The estimator's unit select is sized by its longest option, so "+ Add Service" doesn't line up
   between categories.** `.bb-picker .unit-select { flex: 0 0 auto }` (`estimates.css:459`) makes
   the select as wide as its widest option: 121px in Pre-Production and Post-Production, 128px in
   Production, so the Add button sits at x = 587 in two blocks and 593 in the third
   ([`review-editor-desktop-1280.png`](screenshots/review-editor-desktop-1280.png)). It jumps to 259px
   for a service with a "no price yet, needs Profit Goals" option (it still fits at 768,
   [`review-editor-picker-longest-option-tablet-768.png`](screenshots/review-editor-picker-longest-option-tablet-768.png)).
   _Fix: give it one fixed width above 768px, about 10.5em, and let the closed select truncate: it need
   only show "Full day · $1,600", and the open list still shows the whole reason._

## Could Improve

1. **The Rate column header still says `RATE ($/HR)` above `120.96/day`.** Correct per the brief (the
   cell takes a unit suffix), but the header contradicts it on Half and Full day, on desktop and
   mobile alike. _Suggestion: let the header follow the view: "Rate ($/half day)" / "Rate ($/day)"._
2. **Dashboard comparison rows are 47px or 50px tall depending on whether a cell carries an `auto`
   tag or a "Below by" badge.** Not a defect, but the table's rhythm wobbles down 21 rows. _Suggestion:
   a fixed `min-height` on the price cell, sized for two lines._
3. **`favicon.ico` returns 404 on every page load** (the only failed request besides the expected
   pre-login 401). Pre-existing and harmless.
4. **Pre-existing `title=""` tooltips** on the Custom checkbox, the Custom / Direct / Your time
   headers and the `×` buttons (`pricing.js:599-657`) break the repo's "button + popover, never
   `title`" rule. Not part of this track, so not blocking. Worth a sweep when the a11y pass next
   comes round.
5. **R5–R14 in `TASKS.md` still stand.** None of them showed up as a visible defect here.

## What Works Well

- **The auto / set-by-you split reads at a glance without a new component.** An auto price is dimmed
  (60% text, about 6:1 on the field) and sits above `auto · floor $657.28`; a typed one is full
  brightness above `set by you · ↺ use $103`. It is the "formula versus typed value" the brief asked
  for, and the state lives in the line that used to say `floor $X`.
- **Nothing hides on a view switch.** A unit that's fine but has a sibling below floor gets a
  clickable notice under the name ("Half day below floor by $228.64 ▸") and the option text carries
  the same words. [`review-rate-card-row-hidden-notice-desktop-1280.png`](screenshots/review-rate-card-row-hidden-notice-desktop-1280.png).
- **The estimator keeps its shape.** Service, unit, Add; three lines of one service at three units
  are told apart by their `per [unit ▾]` line and a quantity label that says what it counts
  (`HALF DAYS`, `FULL DAYS`); the same 44px-tall fields on a phone. [`review-editor-prod-lines-desktop-1280.png`](screenshots/review-editor-prod-lines-desktop-1280.png).
- **The Dashboard's one-row-per-service table is the clearest thing in the track.** The old
  duplicate-row problem is gone, `Below by $X` uses the same `--accent-text` badge as the rest of
  Finance & Price, and on a phone each service becomes a card whose three units read top to bottom.
- **The real Tab order works.** Tab from a price lands on `↺ use $103` with a 2px `--accent` ring
  and an accessible name that says what it will do.
- **Measured, not eyeballed.** No horizontal overflow at 1280 / 768 / 375 (scroll width equals client
  width on all three pages). Below-floor text is 4.60:1 at 10.5px, the tightest measured, and still
  passes. State text, Show label and row meta are about 6.3:1 once the 60% alpha is composited.
- **Deploy hygiene.** What's on Pages is exactly what was reviewed, so these findings apply to the
  live site as they stand.
