# Design Review: Trip Planner, Google Calendar and Editor Autosave

Reviewed against: [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) (and T1–T18, G1–G5, I1–I4 in `DECISIONS.md`)
Philosophy: ui-clarity's functionalist, LSC-warm (app dark; call sheet light, in lsccreative.studio's colours)
Date: 11 October 2026 (trip-planner task 17)

Captured headless (puppeteer-core + local Chrome) against `api-scratch-sync` (a copy of the scratch
DB with a pretend Google, so nothing reached the real calendar) and the `web` server on
localhost:5173 with the real Maps browser key. The app is dark-only by design (ui-clarity U6), so
there are no dark-mode variants; the call sheet is light by the brief. The accessibility probes
(axe, contrast, keyboard, 44px, 320px reflow) were run in task 15 and are not repeated here.

## Screenshots Captured

All in `.design/trip-planner/screenshots/` (gitignored), each at `desktop-1280` (1280×800),
`tablet-768` (768×1024) and `mobile-375` (375×812):

| Screenshot | Description |
| --- | --- |
| `review-travel-*.png` | Travel view, five-stop Sydney day, Show trip details on (viewport) |
| `review-travel-full-*.png` | The same, whole page: stops, Return, + Destination, Trip totals (stale state) |
| `review-travel-empty-*.png` | Travel view of a day with no trip: "+ Add start location" |
| `review-day-menu-*.png` | The day's service menu with its foot "Edit travel · 109 km" (bottom sheet at 375) |
| `review-editor-*.png` | Editor: calendar with Google tiles, day cards with "Trip · 5 stops · 109 km · 3 h 27", autosave bar |
| `review-project-*.png` | Project page: Call sheet row ("LINK ON · 2 days · 141 km"), production days' trip lines |
| `review-callsheet-app-*.png` | In-app call sheet |
| `review-callsheet-public-*.png` | Public call sheet `c/#s/<token>` |
| `review-share-*.png` | Share the call sheet dialog (email not set up on this server) |
| `review-settings-cal-*.png` | Settings → Google Calendar, connected (pretend Google), Writing bookings synced |
| `review-settings-homebase-*.png` | Settings → Business → Home base address |
| `review-home-month-*.png`, `review-home-week-*.png` | Home calendar with Google events |
| `review-home-cals-*.png` | Calendars ▾ open (menu at 1280, bottom sheet at 375) |

No view scrolled sideways at any width (the script checked `scrollWidth` on each).

## Summary

The feature reads as the brief asked: the existing panel system holding a map, with no new visual
language. Terracotta stays on the pins, the route and one action per view; figures are set in mono;
the call sheet looks like a production desk's. Two defects were found and fixed, both on the
shared call sheet: its clock times could disagree with the day's start time, and the dotted rail
crossed the numbered stop discs.

## Must Fix (both fixed in this task)

1. **The call sheet's clock times ignored a changed start time.** The stored leg times are worked
   out for the start time the trip was routed at. Move the day from 8:00 to 7:30 without pressing
   Recalculate (T6) and the crew's page read **"Starts 7:30am"** over **"Depart 8:00am"**, and every
   arrive/leave after it was 30 minutes late. The editor's leg lines showed the same old times.
   See `review-callsheet-public-desktop-1280.png` (before: Depart 8:00am; after: 7:30am).
   _Fixed:_ clock times are now the day's current start time plus the stored leg minutes and the
   time on location before each leg, the editor's own sum (`trip-planner.js clockLegs`).
   `public.js callSheetClocks` does it for the in-app page, the public link and the PDF;
   `trip-planner.js legsByCell` does it for the editor's leg lines. Km and drive minutes still
   wait for Recalculate (T6); only the clock they start from moves. A day with no start time shows
   no clock times. New test in `test-call-sheet.js`; 706 server tests pass.
2. **The dotted rail ran through the numbered stop discs** on the call sheet (app and public),
   crossing the stop number. Each stop opens with the drive into it, and the rail was measured
   from the top of the stop, so it started mid-disc. See `review-callsheet-public-*.png`.
   _Fixed:_ the rail hangs off `.cs-stop-row` (`call-sheet.css`), so it starts under the disc.
   The PDF draws no rail and is unchanged.

## Should Fix

1. **Km figures don't add up across surfaces.** The Project page's days say 109 km and 33 km
   while the Call sheet row says 141 km (each figure rounds its own exact total: 108.8, 32.6 and
   141.4). The travel view's Trip totals say 108.8 km, and the line it bills is 109 km.
   Each number is right on its own, but a reader adding them up will notice. See
   `review-project-desktop-1280.png`. _Fix:_ pick one rule. Either whole km everywhere a trip is
   summarised, with the sheet's total as the sum of the days' rounded figures, or one decimal
   everywhere. This changes what the owner sees, so it's the user's call.
   _Fixed (`15ad279`):_ the user chose whole km, rounded up exactly as the km line bills it
   (`calc.js tripLineQty`). Days read 109 and 33, the sheet and the Call sheet row 142, Trip
   totals 109, on every surface (app, public page, PDF, Calendar text).
2. **On the live map, the R pin sits on top of the S pin** at the same spot
   (`review-travel-desktop-1280.png`). The static map on the call sheet already leaves R out
   ("RETURN has no pin"). _Fix:_ hide the R marker when the return is the start's spot, or offset
   it, so the two maps agree.
   _Fixed (`15ad279`):_ the R was a badge on the S pin; the return is always the start's spot
   (`days.js`), so the badge is gone and S alone marks both, as on the static map.

## Could Improve

1. **Static map pins are black, not terracotta.** The brief says only the pins and the route carry
   the accent. Task 9 chose black numbered pins with a terracotta S so they match the call sheet's
   black stop discs, which reads well. Recorded here as a deliberate departure, not a defect.
2. **Two clock styles:** the editor writes "8:00 am → 8:49 am" and the call sheet "8:00am". Pick
   one when the type is next touched.
3. **The `.back-btn` target size** (21px tall above 768px) is still ui-clarity's to fix (noted in
   task 15).
4. **Headings show a focus ring when a page is opened straight from its address** (the travel
   heading, the day menu's "Adding to …"). It's `:focus-visible`, and after a click on "Define
   travel" no ring shows, so it's correct for keyboard users. Seen in every screenshot here only
   because they were loaded by URL.

## What Works Well

- **The travel view is the panel, not a takeover.** Back, the panel header and the jump rail stay;
  the map and the stop list split 55/45 at 1280, 50/50 at 768, and stack at 375 with the sticky
  bar clear of the list. This is exactly the brief's anti-reference avoided.
- **Restraint with the accent.** Terracotta is on the pins, the route line and one primary action per
  view (Done, Send, Save settings). Ghost "+ Destination" and
  "+ Add start location" are quiet dashed buttons, as in the Linear reference.
- **Figures set as figures.** Leg lines (`— 18 km · 49 min —`), the totals' DISTANCE/DRIVE TIME,
  the day card's "Trip · 5 stops · 109 km · 3 h 27" and the call sheet's facts line all use the
  mono face, so the numbers scan in columns.
- **The call sheet looks like a call sheet.** Day header, facts line, route map, then a timed
  schedule on a rail with notes in tinted blocks and a Google Maps link per stop. It's the same
  at 375 and in the PDF, and never shows a price.
- **Google stays in the background.** Google events are faded tiles with a calendar-colour dot, all-day
  ones a thin band; Calendars ▾ is a compact menu at 1280 and a bottom sheet with Done at 375;
  Settings explains each calendar's access in one line.
