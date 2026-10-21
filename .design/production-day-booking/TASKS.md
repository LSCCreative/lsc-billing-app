# Build Tasks: Production Day Booking

Generated from: .design/production-day-booking/DESIGN_BRIEF.md
Date: 2026-10-21

Frontend work, so Opus, effort high. Files: `web/js/views/booking-block.js`, `web/css/booking.css`, `web/css/calendar.css`, `web/js/calendar.js`, `web/index.html` (modal mount), `web/css/responsive.css`. No server change. Aesthetic: the app's existing dark/terracotta look; extend, don't restyle. Read `.design/WORKING_NOTES.md` before touching estimates or projects.

## Foundation
- [x] **Diagnose the empty popup** (skipped: not reproducible locally on current code, dispatched or real clicks, locked or free dates; the dialog is replaced by the next task anyway. Watch for it on the live site after deploy; unversioned CSS/JS caching on Pages is the leading suspect): reproduce "click a date, screen darkens, nothing appears" (`#modal-add-day` opens `.modal-overlay.open` but the `.ad-box` is not visible: check the dialog's CSS, stacking, the `hidden` ancestor check in `onDialogKeydown`, and the browser pane). Done = cause named and fixed, popup visibly opens on a date click. _Modifies: add-day dialog._

## Core UI
- [x] **Add-day popup with bump-in/out and status** (done: status defaults to Proposed; times start on the last day's set times): replace the three "+ Status day" buttons with one form: date as the title, Bump in and Bump out time inputs (labelled), a status picker (Confirmed / Pencilled / Proposed, today's default), and an Add day button plus Cancel. Pencilled warning stays as one line; the specification note field appears only for a confirmed-elsewhere date and keeps Add day disabled until filled. Enter submits; focus starts on Bump in. Add day creates the day with `startTime`/`endTime` set. _Modifies: `openDialog`, `addOn`; reuses `LSCModal.trapTab`._ _Depends on: Diagnose the empty popup._
- [x] **Simplify the Production days list** (done: heading is an `<h3>`; `addTbc()` is still used by the editor's "A new Date TBC day", so it stays; removing the last day now focuses the calendar): heading "Production days" only. Remove "+ Add Date TBC day" and the long empty-state text (empty state: "Pick a date on the calendar."). Keep "Not on a day" and any existing Date TBC days rendering. _Modifies: `booking-days-bar`, `booking-empty`; `addTbc()` stays for the editor's "A new Date TBC day" menu entry unless it proves unused, in which case note it._
- [x] **Quiet day cards** (done: head is title, times (`C.timeText`, so "(ends next day)" replaces the overnight line), chip and ⋯ (Edit day / Duplicate day / Remove day); the dialog's edit mode adds a Date field and re-checks a new date live; Duplicate opens the copy's dialog on its date, Cancel leaves it Date TBC; the day button reads "+ Add service item". Lock path not exercised on scratch, which has one estimate): header shows date, bump-in to bump-out, status chip and a menu (edit times, duplicate, remove). Body is the items plus "+ Add service item". Trip summary, override note and clash text appear only when present. Editing times re-uses the popup in edit mode. _Modifies: day card render (~line 453)._ _Depends on: popup._
- [x] **Compact calendar with Expand** (done: `LSCCalendar.mount({ size, onSizeChange })` draws Expand/Collapse in the bar; compact is 52px cells, one-line tiles, two a date before "+N more"; kept in `lsc-booking-cal-size`, default compact; the ≥1296px 420px side column is gone, so the calendar is full width above the list at every width; under a 400px calendar nothing changes and the button is hidden; Home has no `size`, so no button): full-width month grid with cells about half today's height, an Expand/Collapse toggle that restores the current size, choice remembered per browser (try/catch localStorage). Day click opens the popup at both sizes. The calendar must visually balance with the list below it. _Modifies: `calendar.js` size option, `calendar.css`, `booking.css`._

## Interactions & States
- [ ] **Open, close, focus and edit flow**: new day gets its card scrolled into view with focus on its "+ Add service item"; Esc/backdrop/Cancel return focus to the date cell; clicking a date that already has a day on this estimate opens that day's popup in edit mode. Covers: locked date, pencilled, check failed, duplicate date, validation (bump-out before bump-in).
- [ ] **Legacy and empty states**: an estimate with Date TBC days or "Not on a day" items renders as before; an estimate with no days shows the one-line empty state; payload (`payloadDays()`) unchanged. Server `npm test` still passes.

## Responsive & Polish
- [ ] **Breakpoints**: tablet 768-1099 and mobile <768: popup as a bottom sheet, 44px touch targets, compact calendar cells at least 44px tall, cards don't overflow. _Modifies: `responsive.css`._
- [ ] **Accessibility pass**: dialog role and focus trap, labelled time inputs, status not by colour alone, keyboard open on Enter/Space for calendar days, contrast per `--accent-text`, focus rings.

## Review
- [ ] **Design review**: run /design-review against the brief.
- [ ] **Docs**: tick tasks, update `ROADMAP.md` and `WORKING_NOTES.md` (one line each). Deploy only after asking the user.
