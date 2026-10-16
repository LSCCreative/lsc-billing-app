# Design Brief: Trip Planner, Google Calendar and Editor Autosave

Decisions T1–T18 and G1–G5 are in [`DECISIONS.md`](DECISIONS.md) and are the user's. This brief turns them
into an experience. **Model: Opus, effort high. Frontend task** (it also writes priced lines, so
it's in the money bucket too).

## Problem

Travel is the part of a quote the owner currently guesses. To price a shoot day's driving, they
leave the app, plot the route in Google Maps, add up the legs, round the time, come back and type
two numbers into the travel lines. Then they do it again, differently, when a location changes.
None of that work is kept. The crew get the same information later in a text message, with the
gate code and parking notes scattered across other messages.

The calendar in the app only knows about the app. The owner's real diary (meetings, personal
commitments, colleagues' shared calendars) lives in Google Calendar, so every booking is checked
in two places and then typed into Google by hand.

Separately, the editor loses work. Every change waits for Save, and leaving the screen (or a
dropped connection) is the moment a half-built estimate is at risk.

## Solution

Each production day gets a **trip**. From the day's service menu, **Define travel** turns the
Production booking panel into a planner: a Google map on the left, the day's stops on the right.
The owner searches or clicks to place a start, adds destinations, drags them into order, closes
the loop with **Return trip**, and sees the kilometres and drive time between every stop and in
total. Those totals *are* the day's travel lines: km on the per-km vehicle row, drive time on the
Transport & Logistics hours row, priced by the Rate Card and locked to the map so the quote can't
disagree with the route.

The same trip becomes a **Call sheet**: a printable, shareable schedule on the Project page.
Each day lists its stops, the drive between them with depart and arrive times, a route map, and
the capture notes, location description and access details the owner typed against each stop.
One link gives the crew the plan, and it is always the latest saved version.

The app's calendar also becomes a window onto the owner's **Google Calendar**, keeping its
current design. Connected once in Settings, it shows the events from whichever Google calendars
the owner switches on (their own, and colleagues' shared with them) as faded busy tiles beside
the bookings. Every confirmed or pencilled day the app books is written to the owner's primary
Google calendar, with its times, first location, items and call sheet link, and kept in step
as the booking moves.

Underneath, the editor **autosaves** unsent estimates, so building a trip (or anything else) is
never at risk. Save and Cancel become Done.

## Experience Principles

1. **The map is the source of truth, the price follows.** Km and hours are never typed while a
   trip exists. They come from the route, rounded the same way every time (T3, T4). The owner can
   always see why the travel line says what it says, and can deliberately unlink when a job needs
   a different figure.
2. **Stable over live.** Traffic-aware times are useful, but a quote that changes on its own is
   worse (T6). Figures move when the owner edits the trip or presses Recalculate, never on open,
   and a sent version never moves.
3. **Tidy while building, complete when shared.** In the editor, details collapse and legs hide
   until asked for ("Show trip details") so a five-stop day stays scannable. In the brief, nothing
   is collapsed: every leg, time and access note is on the page.

## Aesthetic Direction

- **Philosophy:** ui-clarity's *functionalist, LSC-warm*, unchanged. This feature adds no new
  visual language. It is the existing panel system holding a map.
- **Tone:** calm and exact, like a production desk call sheet. Numbers are set like figures
  (mono, tabular), not decoration.
- **Reference points:** Google Maps directions (the stop list with legs between); a film call
  sheet (the brief: day header, then a timed schedule, then per-location notes); Linear's quiet
  ghost buttons for the "+ Add" affordances.
- **Anti-references:** a full-screen "map app" takeover that leaves the estimate; colourful
  route-planner SaaS; a map pinned with tooltips and popups everywhere. The map stays Google's
  **standard style** (T1b). Only the pins and route line carry the terracotta accent.
- **Call sheet / share page:** light, in **lsccreative.studio**'s colours (`--lsc-black`,
  `--lsc-white`, `--lsc-terra`), the same shell as the client quote page (`web/c/`).

## Existing Patterns

- **Tokens:** `web/css/tokens.css` (ui-clarity task 1). Use `--color-*`, `--space-*`, the type
  scale and radii from it. No new raw hex; the route colour is `--color-accent`. Phase 4 was
  skipped because the tokens exist. New component tokens (`--trip-*`) go into `tokens.css` only
  if a value is used twice.
- **Typography:** Delight 700 for the panel title and the trip totals; Metro Sans for cells,
  fields and buttons; **CS Felice Mono** for the leg lines ("— 100 km · 1 h 05 —"), the totals
  label and the "FROM TRIP" chip.
- **Panels:** `.panel` + `js/panel.js`. The travel view lives *inside* the Production booking
  panel's body, so the panel header, jump rail and collapse keep working.
- **Menus:** `js/menu.js` (APG menu button) for the destination's **+ Add details ▾** and the
  trip's ⋯ (Recalculate, Clear trip).
- **Reorder:** `js/sortable.js` (pointer drag on a handle, keyboard Move up/down, live
  announcements) for destination cells.
- **Combobox:** `js/typeahead.js` shape (sequence-numbered, out-of-order replies dropped) for the
  address suggestions, fed by Places Autocomplete instead of `/api/clients`.
- **Toasts:** `js/toast.js` with an action (Undo) for removing a stop.
- **Service menu host:** `BookingBlock.menuHost()` / `.is-menu`, which already swaps the
  service menu in for the calendar. The travel view extends this to an `.is-trip` state that
  spans both columns.
- **Client pages:** `web/c/` (token in the fragment, no credentials, allow-listed JSON) and
  `server/src/public.js`'s allow-list discipline. The share page is `c/#s/<token>`.
- **PDF:** `server/src/pdf.js` (puppeteer-core on the NAS).
- **Email:** `server/src/mail.js` via Resend, and `SendPanel`'s recipient pattern.
- **Editor bar:** the sticky bar (ui-clarity task 12) gains the autosave status and Done.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Day service menu footer: **Define travel** | Modify | Fixed at the menu's foot. If the day has a trip, it reads "Edit travel · 186 km". |
| Production booking panel, `.is-trip` state | Modify | Body swaps to the travel view across both columns. The calendar and day cards are hidden, not destroyed. |
| Travel view header | New | Back (top left, to the day's menu), "Travel · Day 2 · Thu 29 Oct", ⋯ (Recalculate, Clear trip). |
| Map pane | New | Google Maps JS, standard style, Map ID for Advanced Markers. Numbered terracotta pins (S, 1…n, R), the route polyline, Google's +/− zoom and drag. A click places a pending pin. |
| Map search bar | New | Above the map; shown while a cell is waiting for a location. Places Autocomplete suggestions (AU-biased), Search button, Enter. |
| Pending pin + confirm | New | The searched or clicked spot shows a hollow pin with the address and "Use this location". Clicking the pin or the button fills the cell. |
| **+ Add start location** | New | Ghost button. The first offer is "Home base: …" when Settings has one (T9). |
| Location cell | New | Role chip (START / 1 / 2… / RETURN), address, drag handle (destinations only), remove (×). An empty cell reads "Search above the map or click it to place this stop". |
| **+ Add details ▾** (per destination) | New | Menu: Capture details, Location description, Access details. Each adds a titled textarea in the cell once; a used item drops out of the menu. |
| Detail block | New | Title row toggles collapse (chevron, aria-expanded). Collapsed, it shows a one-line excerpt. Remove in its own ⋯. |
| Time on location | New | Optional duration field per destination ("3 h"), feeding T5/T11 departures. |
| **+ Destination** | New | Translucent ghost. Always present after the start (it inserts before a return). |
| **Return trip** | New | Translucent ghost. Appears once there is a start and at least one destination. Adds a locked RETURN cell copying the start. Removable. |
| **Show trip details** toggle | New | Between the section title and the cells. On: leg lines appear between cells: "— 100 km · 1 h 05 —". |
| Trip totals | New | Below the cells: total km, total drive time, and the two lines they feed with their prices ("Vehicle — per km · 186 km · $167.40"). A stale state ("Day changed, recalculate?") lives here. |
| "From trip" travel lines | Modify | The editor's travel row: qty read-only, a FROM TRIP chip, Edit trip, and Unlink from trip in its ⋯. |
| Day card trip summary | Modify | One line on the booking day card: "Trip · 4 stops · 186 km · 2 h 40". |
| Settings → Google Calendar | New | A section after Business: Connect / connected-as account / Disconnect; the calendar toggles list (also reachable from the calendar); sync status ("All bookings synced" / "2 days not synced · Retry"). |
| Calendar settings control | New | A small "Calendars ▾" button in the calendar header (Home + editor), via `menu.js` with checkbox items: each Google calendar with its colour. Hidden when not connected, offering "Connect Google Calendar" instead. |
| Google event tile | New | The existing tile style, faded, with a calendar colour dot; read-only; opens to title, time, calendar name. Listed under the grid like other tiles (keyboard/phone path). |
| Settings → Business: Home base | Modify | One address field with the same search (no map needed). |
| Editor sticky bar: autosave | Modify | Status text (Saving… / Saved 2:41 pm / Not saved: reason → field), **Done** replaces Cancel and Save for unsent estimates. Sent and accepted estimates keep Save. |
| ⋯ **Undo changes since I opened this** | New | Restores the opened version after a confirm. |
| Project page: Call sheet row | New | In the Documents panel: "Call sheet · 3 days · 412 km". Primary Open; Documents ▾ Download PDF; Actions ▾ Share…, Copy link, Turn off link. |
| Call sheet view (in app) | New | `#/projects/<id>/estimate/call-sheet`. Schedule by day. Read-only. |
| Share dialog | New | `modal.js` focus trap. Link state (on/off), Copy link, Email: To (one or more), optional note, Send. |
| Public call sheet page | New | `web/c/#s/<token>`, light. Same schedule plus Download PDF. "Updated …" stamp. |
| Call sheet PDF | New | `pdf.js` template: A4, a page or more per day, the static route map at the top of each day. |

## Key Interactions

**Opening the planner.** Day menu → **Define travel**. The Production booking panel body
cross-fades (≤150 ms) to the travel view and focus moves to the view's heading. Back returns to the
same day's menu with focus on Define travel. The panel's own collapse still works. Collapsing it
while in the travel view keeps the view for the next open.

**Placing the start.** **+ Add start location** → an empty START cell appears, the search bar
appears above the map with focus in it, and Home base (if set) is the first suggestion. Typing
shows Places suggestions. Picking one, or Search/Enter for the best match, pans the map there and
drops a *pending* pin with the address. Clicking the pin (or "Use this location") fills the cell:
**Start · 12 Smith St, Fitzroy VIC**. If the pin is wrong, the owner zooms (+/−, scroll, pinch),
drags the map, and clicks anywhere. That spot becomes the pending pin, its address is looked up,
and it's confirmed the same way. Escape cancels the pending pin; the empty cell stays.

**Destinations.** Under a filled start: **+ Destination** (translucent). Clicking it adds a solid
empty cell and focuses the search bar again. Placing the location works as above. Each destination
gets its **+ Add details ▾** menu; a chosen item adds a titled textarea with focus in it. Detail
blocks collapse from their title row and remember their state per cell during the session.

**Return trip.** With a start and at least one destination, **Return trip** (translucent) sits
beside + Destination. It appends a RETURN cell (the start's address, locked, no handle, no
details). Nothing can be dropped after RETURN or before START. Removing RETURN brings the button
back.

**Reordering.** Destinations drag by their handle (`sortable.js`). The drop line shows where the
stop lands, and START and RETURN are fixed ends. The keyboard equivalent is Move up / Move down in
the cell's ⋯. Each move is announced ("Bondi Pavilion moved to stop 2 of 4").

**Routing.** Any change to the stops (add, place, move, remove, time on location) asks Google's
Routes API for the route, departing at the day's date and start time with traffic, each leg
leaving after the previous stop's time on location. While it runs, the totals show "Working out
the route…" and the old figures stay greyed. Then the route line redraws, the leg lines update,
the totals update, and the day's two travel lines update (km rounded up, hours rounded up to
15 min). The editor recalculates and autosaves. A failure ("Couldn't reach Google Maps") keeps
the last good figures and offers Try again; the lines never take a half result.

**Show trip details.** Toggle on: between each pair of cells, a mono line
`— 100 km · 1 h 05 —`, plus clock times when a start time exists (`depart 7:00 am → arrive
8:05 am`). Off by default. The choice is remembered in this browser.

**Stale figures.** If the day's date or start time changes after the trip was routed, the totals
show "Day changed. Drive times may differ." with **Recalculate**. Nothing moves until it's
pressed (T6).

**Linked lines.** In the editor, the day's travel lines show FROM TRIP, a read-only quantity, and
Edit trip (opens the planner). **Unlink from trip** in the line's ⋯ asks once, then the quantity
is editable and the trip stops updating that line; the trip totals show "Vehicle km unlinked:
billed as typed".

**Clear trip.** ⋯ → Clear trip → "Also remove the 2 travel lines it added? ($X)" → **Remove** /
**Keep as ordinary lines** / Cancel (T7).

**Removing a stop.** × on the cell removes it at once with a toast "Stop removed · Undo" (10 s).

**Connecting Google Calendar.** Settings → Google Calendar → **Connect** sends the browser to
Google's consent page, then back to Settings, which reads "Connected as lachlan@…" with every
calendar the account can see listed as toggles (primary on, the rest off). Connecting also
offers **Sync existing bookings** (writes every current confirmed and pencilled day once).
**Disconnect** asks, then revokes. Events already written stay in Google unless "Also remove
the app's events" is ticked.

**Seeing Google events.** The calendar fetches the visible six weeks from the NAS, which merges
the app's days with Google events from the switched-on calendars (cached about 5 minutes; the
Calendars ▾ menu has **Refresh**). Google tiles are faded with a colour dot. They open a small
read-only popover (title, time, calendar), and they're in the under-grid list for keyboard and
phone. All-day Google events sit as a thin band at the top of the cell. If Google can't be
reached, the app's days still show and a quiet line says "Google Calendar unavailable".

**Writing bookings.** After any save that changes a confirmed or pencilled day (date, times,
status, items, trip, project name or client), the NAS creates, updates or deletes that day's
event in the primary calendar, in the background. A failure is retried, and shows as "Google
Calendar: 1 day not synced · Retry" in Settings and as a small mark on the day card. It never
blocks a save. A client's acceptance on their page confirms days and writes them the same way.

**Autosave.** On an unsent estimate, 1.5 s after the last edit (or on field blur / opening another
panel), the editor saves in place. The bar reads *Saving…*, then *Saved 2:41 pm*. A refusal reads
*Not saved: <reason>*, links to the field, and retries on the next edit. Before a name and UPID
exist it reads *Not saved yet: add a project name and UPID*. **Done** goes back to the project
(it waits for an in-flight save). ⋯ **Undo changes since I opened this** confirms, then saves the
opened version back. Sent or accepted estimates show Save as today, with its resend dialog.

**The call sheet.** Project page → Call sheet row → **Open** shows the schedule in-app. Documents ▾ →
**Download PDF**. Actions ▾ → **Share…** opens the dialog: the link (made on first share), Copy
link ("Copied" toast), Email to one or more addresses with an optional note, and Turn off link.
The public page and PDF show the schedule per day: route map; then, in order,
`START 7:00 am · Home base, 12 Smith St` → `— 42 km · 48 min —` → `1 · arrive 7:48 am · leave
10:48 am (3 h) · Bondi Pavilion…` with its Capture details, Location description and Access
details in full, then **Open in Google Maps**, and a day total. Never a price.

## Responsive Behavior

- **≥1100px:** the travel view fills the Production booking panel body as two columns, map about
  55% on the left and stops 45% on the right. The map is sticky within the panel while the stop
  list scrolls.
- **768–1099px:** still two columns, about 50/50; the map is shorter (min 360px).
- **<768px:** one column. The map sits on top at ~45vh, with the search bar above it, then the
  stops. The map is touch-panned (Google's cooperative gestures, two fingers to pan inside the
  page). Cells are full width with 44px targets, the drag handle stays (touch), and Move up/down
  is in each cell's ⋯. Menus open as bottom sheets (menu.js). Back stays top left.
- **Brief page / PDF:** single column at every width. The map image is full width. The PDF is A4
  portrait.

## Accessibility Requirements

- **Contrast:** text 4.5:1, UI parts and the translucent ghost buttons' **text and border** 3:1
  on their surface. "Slightly transparent" is a style on the fill and border, never below 3:1
  for the label.
- **The map is not the only way.** Every location can be set from the search field and
  suggestions alone. Pins and the route are mirrored in the stop list. The map region is labelled
  ("Map of Day 2's route, 4 stops"), and its clicks are an enhancement.
- **Keyboard:** search combobox per APG (arrows, Enter, Escape). Cells are reorderable with Move
  up/down. Detail blocks are disclosure buttons. Back, Show trip details, + Destination and Return
  trip are real buttons in DOM order. Focus moves to the new cell's search on add and returns to
  Define travel on Back.
- **Screen readers:** route updates announce once in a polite live region ("Route updated: 186 km,
  2 hours 40"). Reorders are announced (sortable.js). The autosave status is a polite live region,
  announcing *Not saved* states only, not every *Saved*.
- **Drag** always has a non-drag equivalent (WCAG 2.5.7).
- **Motion:** view swap and collapse ≤200 ms; `prefers-reduced-motion` removes the cross-fade and
  the map's animated pans.
- **Dialogs** (Share, Clear trip, Unlink, Undo session) keep `modal.js`'s focus trap.

## Data and Security Notes (for IA and tasks)

- A trip belongs to a production day and is saved with the estimate (the autosave path). It
  stores ordered stops `{role, address, lat, lng, placeId?, minutesOnSite?, details:{capture,
  description, access}}`, the computed legs `{km, minutes}`, totals, `routedAt` and the day
  date/time it was routed for (to detect T6 staleness). A new schema version (**v16**), so NAS
  before Pages.
- **Rounding lives in `calc.js`** (byte-identical with `server/src/calc.js`): km → `ceil`,
  minutes → hours rounded up to 0.25. The server re-derives the linked lines' quantities from the
  stored trip on save, so a tampered or stale browser can't store a km line that disagrees with
  its trip.
- **Public route `/public/call-sheets/:token`** is an **allow-list** like `public.js`: project name,
  UPID, day dates and start times, stops, legs, details, "updated at". Never prices, client
  contact or internal figures. Token in the fragment, revocable. Add a leak test alongside
  `test-public.js`.
- **Google Calendar:** OAuth runs on the NAS (`/api/google/oauth/start` behind the session gate,
  `/api/google/oauth/callback` with a `state` check). The refresh token is stored in the
  database and never sent to a browser. It isn't in the backup export unless backups already
  include settings secrets (decide in IA). `GET /api/calendar` gains a `google` array (events
  from switched-on calendars, minus `lscDayId` events) fetched server-side; the browser never
  talks to the Calendar API. Writes go through a small sync table (day id → Google event id,
  last pushed hash, last error) so retries are idempotent. The public routes never touch any of
  it.
- **Keys:** the browser key is public by nature and website-restricted. The server key never
  leaves the NAS, which fetches the Static Maps image and inlines it into the page JSON or PDF as
  a data URI.
- **Budget:** a $1 budget alert on the Cloud billing account (the user sets it, or the build asks
  to). The autosave debounce and routing on stop changes, never per keystroke, keep usage far
  below the free caps.

## Out of Scope

- Turn-by-turn navigation, live location, or ETA sharing.
- Flights, accommodation and public transport legs (they stay ordinary travel lines).
- Optimising stop order automatically ("best route").
- Tolls and fuel as separate lines (the per-km rate covers running costs).
- Multiple vehicles or per-crew trips on one day.
- Showing travel, maps or the brief on the client's quote page or PDF.
- A dark-styled map (T1b).
- Autosave for sent or accepted estimates (T14), and autosave on other screens (Rate Card,
  Settings, client records).
- Editing a trip from the call sheet page.
- Two-way calendar sync: events created or edited in Google never become bookings, and Google
  edits to app events are overwritten (G4).
- Clash warnings or blocks from Google events (G3).
- Redesigning the calendar (week/day views, drag to book). The current design stays.
- Writing proposed or Date TBC days, or rentals, to Google.
- Inviting crew or clients to the Google events (attendees).
- Stripe, HubSpot, or any other open track's work.

## Open Questions

- **Map ID:** create one (default style) at build time; it needs the user's OK in the console.
- **Billing:** Maps calls fail if billing isn't enabled on *LSC Production Decks*. Check on the
  first live map load.
- **Budget alert:** the user sets it, or allows the build to.
- **OAuth client:** the user finishes creating "LSC Billing — NAS calendar" in the console and
  saves its client ID and secret into `.credentials.local.md` themselves (the agent was blocked,
  correctly, from reading the secret off the page).
- **Backups and the refresh token:** include it in `backup.js` exports or not (IA).
