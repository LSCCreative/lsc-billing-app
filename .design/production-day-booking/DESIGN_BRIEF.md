# Design Brief: Production Day Booking (estimate editor revision)

## Problem

Booking a shoot day feels clunky and split in two. The calendar is big, and the Production Days list is tucked under it, so it isn't clear why the calendar is that large or how the two relate. Clicking a day darkens the whole screen but no add-day popup appears (the dialog `#modal-add-day` opens an overlay that shows nothing; the cause is unknown and is the first thing to diagnose). The list is crowded with text, and "+ Add Date TBC day" is a second way to add a day when the owner only wants to add days from the calendar.

## Solution

One way in: click a date on a compact calendar and a popup opens for that date, where the owner sets bump-in and bump-out times and the status, then adds the day. The calendar sits in balance with the Production Days list below it, and can be expanded to the current large size when the owner wants to scan or pick dates in bulk. The list is just the title "Production days" and one quiet card per booked day. Each card holds that day's items and "+ Add service item".

## Experience Principles

1. **One door in** -- Days are only ever created from the calendar. No second "Add day" button.
2. **Quiet by default** -- A day card shows date, times and status chip and nothing else. Notes, clash text and trip summary appear only when they exist.
3. **Calendar is a picker, not a feature** -- Compact next to the list; expand only when needed.

## Aesthetic Direction

- **Philosophy**: Existing LSC app look (dark, terracotta accent). Extend, don't restyle.
- **Tone**: Calm, efficient, confident.
- **Reference points**: Google Calendar's click-a-day quick-add popover; the app's own cost-breakdown modal.
- **Anti-references**: A second form pinned under the calendar; stacked helper paragraphs.

## Existing Patterns

Code: `web/js/views/booking-block.js` (block, cards, add-day dialog), `web/js/calendar.js` (shared month calendar), `web/css/booking.css`, `web/css/calendar.css`, `web/js/modal.js` (focus trap). Tokens in `web/css/tokens.css`.

- Typography: `--font-family-display`, `--font-family-mono`, sizes `--font-size-xs/sm/md`.
- Colors: terracotta `--accent` (fill), `--accent-text` (text), `--color-surface-overlay`, `--color-bg-float`; status colours per day (`is-confirmed/pencilled/proposed`).
- Components: `.modal-overlay` / `.modal-box`, `.day-card`, `.panel`, `.btn`, `LSCModal.trapTab`.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Add-day popup (`#modal-add-day`) | Modify (fix + extend) | Fix why it doesn't show. Fields: date (heading, fixed), bump-in time, bump-out time, status picker (Confirmed / Pencilled / Proposed), Add day + Cancel. The specification note field stays but only appears when another estimate has confirmed the date (server rule `lockedDay`). Pencilled/clash warnings stay as one short line. |
| Compact calendar | Modify | Full-width short month grid, cells about half current height. "Expand" toggle restores the current size and back. Day click opens the popup in both sizes. |
| Production days list | Modify | Heading "Production days". Remove "+ Add Date TBC day" and the empty-state paragraph about Date TBC. Empty state is one short line: "Pick a date on the calendar." |
| Day card | Modify | Header: date, bump-in to bump-out, status chip, a menu for edit times / duplicate / remove. Body: items and "+ Add service item". Trip summary, override note and clash text only when present. |
| "Not on a day" card | Exists (keep) | Stays always, as today. Date TBC days on existing estimates still render (legacy), but no new ones can be created. |

## Key Interactions

1. Owner clicks a date (compact or expanded). The popup opens focused on bump-in time, with the date as its title.
2. Owner sets times and status (default status as today's default for a dated day), presses Add day (Enter also submits). The popup closes, the new card appears in date order and is scrolled into view with focus on its "+ Add service item".
3. Clicking a date that already has a day on this estimate opens the same popup in edit mode for that day (or scrolls to its card; confirm at build).
4. Esc, backdrop click or Cancel closes the popup and returns focus to the date cell.
5. Expand/Collapse toggles the calendar size; the choice is remembered per browser like the panel's open state.

## Responsive Behavior

Desktop: compact calendar full panel width above the list. Tablet/mobile: popup becomes a bottom sheet or full-width dialog with large time inputs; calendar cells stay at least 44px tall for touch, so the compact size is the minimum.

## Accessibility Requirements

- Popup is `role="dialog"` `aria-modal`, traps focus via `LSCModal.trapTab`, returns focus to the opener.
- Calendar days remain keyboard reachable; Enter/Space opens the popup.
- Status must not rely on colour alone (label plus swatch as today).
- Contrast per `--accent-text` rules; focus rings from `a11y.css`.
- Time inputs labelled "Bump in" and "Bump out".

## Out of Scope

- The quote format (separate track: `.design/quote-format/`).
- Service-item menu, rentals, trip planner, pricing and surcharge maths.
- Removing existing Date TBC days or "Not on a day" lines from saved estimates.
- Server changes (the days payload keeps `startTime`/`endTime`/`status`/`overrideNote`).
