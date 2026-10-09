# Decisions: Trip Planner + Editor Autosave

The user's answers from `/design-flow` Phase 1 (grill) and Phase 2, 2026-10-08. They are the
user's; don't re-ask. Numbered T1… so later docs can cite them.

## Map service and keys

- **T1 Google Maps Platform** powers the map, address search, routes and the brief's map images.
- **T1a Two dedicated keys**, created 2026-10-08 in Cloud project *LSC Production Decks*
  (`lsc-production-decks`). Values live only in `.credentials.local.md` (gitignored), never in a
  tracked file:
  - **LSC Billing — browser**: website-restricted to `https://lsccreative.github.io/*` and
    `http://localhost:5173/*`; APIs Maps JavaScript, Places (New), Routes, Geocoding. Reaches the
    page as `window.LSC_MAPS_KEY` in `web/js/config.js`, written by `deploy-pages.yml` from a new
    GitHub secret `LSC_MAPS_KEY` (same pattern as `LSC_API_BASE`).
  - **LSC Billing — server**: Maps Static only, no application restriction (dynamic NAS IP). NAS
    env `GOOGLE_MAPS_SERVER_KEY`. The server fetches the image and embeds it. The key is
    never put in a URL a browser sees.
  - The project's older "Maps Platform API Key" (35 APIs, unrestricted) is **not** used by the app.
- **T1b Standard Google map style** everywhere (no custom dark style). One Map ID with the default
  style is still needed for Advanced Markers (numbered pins). Create it at build time, after asking.

## Trips and price

- **T2 One trip per production day.** Duplicate day copies the trip. Date TBC days can have one;
  "Not on a day" can't.
- **T3 The trip writes two lines on its day:** total km → the Rate Card's per-km row
  (`perKm`, "Vehicle — per km"), rounded **up** to the whole km; total drive time → the own-time
  hours row ("Transport & Logistics Hrs"), rounded **up** to 15 minutes. Prices come from the
  Rate Card as today. No new money math.
- **T4 Linked lines are locked.** They read "From trip" with an Edit trip link. **Unlink from trip**
  makes the quantity editable, and the trip stops updating that line.
- **T5 Traffic-aware drive times** for the day's date and start time; each leg departs at its real
  time (after the time on location before it, T11). A day with no date or start time uses
  Google's traffic-unaware time and says so.
- **T6 Figures move only on edit or Recalculate.** They are computed when the trip changes and then
  stored. Reopening shows the stored figures. A changed day date or start time shows "Day changed,
  recalculate drive times?" and waits. Sent versions never move.
- **T7 Clear trip asks:** "Also remove the 2 travel lines it added? ($X)". Yes removes them; Keep
  turns them into ordinary editable lines.

## The travel view

- **T8** DEFINE TRAVEL is a fixed button at the foot of the day's service menu. The travel view
  takes over the **whole** Production booking panel (map left, destinations right). Back (top
  left) returns to that day's open service menu. On a phone the map stacks above the list.
- **T9 Home base.** A new "Home base address" in Settings → Business. "+ Add start location"
  offers it as one click.
- **T10 Search** suggests Australian addresses and places as you type; Search or Enter takes the
  best match. A pin drops and is clicked to confirm, or a click anywhere on the map pins that
  spot (reverse-geocoded).
- **T11 Optional time on location** per destination, so the brief shows depart/arrive clock times.
  It isn't billed as travel; labour lines cover it.

## Brief and sharing

- **T12 One Call sheet per estimate**, a row in the Project page's Documents panel once any day
  has a trip: a schedule grouped by day, with a route map per day and an Open in Google Maps link
  per stop. Open, Download PDF and Share are on the row.
- **T13 Share** makes a secret-token link (same kind as client pages) to a light page in the
  site's colours. Copy link, or email it via Resend to typed addresses. The link can be turned off.
  It shows addresses and access details, **never prices**.
- **T18 The link always shows the latest saved trip**, headed "Updated <date, time>".

## Editor autosave (new scope, whole editor)

- **T14 Unsent estimates only.** A sent or accepted estimate keeps Save and its
  send-the-update dialog (`resend_required`). No server change for that path.
- **T15** Saves 1.5 s after typing stops, and on leaving a field or opening another panel. The
  sticky bar shows "Saving…" / "Saved 2:41 pm" / "Not saved: <reason>" (links to the field).
  Nothing navigates after a save.
- **T16** Cancel + Save become **Done** (back to the project). ⋯ gets **Undo changes since I opened
  this**, which restores the estimate as it was at open.
- **T17** A new estimate starts saving once it has a name and UPID ("Not saved yet: add a project
  name and UPID"). The client is added to the client list only on the first save after leaving
  Business Name, never mid-word.

## Google Calendar (added 2026-10-08, before IA)

The calendar keeps its current design (`js/calendar.js`). What changes is what it shows and what
the app writes.

- **G1 The connection lives on the NAS.** Settings → Google Calendar → **Connect** runs Google's
  OAuth web flow once. The NAS keeps the refresh token, so it can write even when no browser is
  open (e.g. a client accepts on their page and the days confirm). **Disconnect** revokes it.
  The token is never sent to a browser and never appears on a public route.
  - Cloud setup: the Calendar API is already enabled in *LSC Production Decks*. The consent
    screen is already **Internal** (Workspace accounts only, so no verification and no 7-day
    token expiry), named "Production Decks" (shared with another tool; left unchanged). OAuth
    client **"LSC Billing — NAS calendar"** (Web application). Redirect URIs
    `https://billing.lsccreative.studio/api/google/oauth/callback` and
    `http://localhost:8080/api/google/oauth/callback`. NAS env `GOOGLE_OAUTH_CLIENT_ID` /
    `GOOGLE_OAUTH_CLIENT_SECRET`. The values are entered by the user into `.credentials.local.md`.
  - Scopes: `calendar.events` (read/write events on calendars the user can access) and
    `calendar.calendarlist.readonly` (the list of calendars to toggle).
- **G2 Show Google events on the existing calendar** (Home and the editor's booking calendar). A
  calendar-settings control lists the user's Google calendars (their own and other people's
  shared with them) as toggles. The choice is stored server-side so Home and the editor agree.
  Events from switched-on calendars draw as faded, read-only "busy" tiles in the existing tile
  style with the calendar's colour as a dot. A tile opens to title, time and calendar name.
- **G3 Show only.** Google events never warn and never block a booking. The existing app-day
  lock rules are unchanged.
- **G4 The app writes to the user's primary calendar:** confirmed days, and pencilled days
  (marked tentative, title prefixed "Pencil ·"). Proposed and Date TBC days are not written.
  Moving, re-timing, removing a day or declining the estimate updates or deletes its event.
  Every app event carries `extendedProperties.private.lscDayId`, so the app only ever edits its
  own events. The app is the source of truth: edits made in Google to an app event are
  overwritten on the next sync. App events are filtered out of the Google layer, because the app
  already draws those days.
- **G5 Full booking detail in each event:** title "UPID · Project · Client". Start and end times
  (all-day when the day has no start time) in `Australia/Sydney` (the app's existing zone). The
  trip's first destination as location. A description with the day's production items, the trip
  summary, the call sheet link (when sharing is on) and a link to the project in the app.
  **Never prices.**

## IA answers (Phase 3, 2026-10-08)

- **I1 The planner has an address:** `?trip=<dayId>` on the editor's route. A reload reopens it,
  and browser Back closes it like the in-app Back.
- **I2 Autosave backups are throttled:** an autosave PUT takes the pre-write snapshot on the first
  autosave after the editor opens, then at most once per 10 minutes per estimate. Every other
  write, manual saves included, keeps today's snapshot-per-write.
- **I3 The Google refresh token is stored plain** in `billing.db` (the user's call, in line with
  the deliberately low security bar). It is never sent to a browser.
- **I4 The shareable schedule is called a "Call sheet"** everywhere (this replaces "Travel brief"
  in T12/T13/T18).

## Defaults accepted with the grill (veto any)

Numbered pins plus the route line on the map. Start and return cells take no detail fields. With a
return trip in place, + Destination still works and inserts before it. At most 23 destinations
(Google's waypoint limit). If the per-km row has no price yet, the trip shows its totals and says
why no km line was added. The day card shows a one-line trip summary. Keyboard reorder is the
non-drag equivalent. The brief never appears on the client's quote page. Build branch
`trip-planner` off `ui-clarity`. Deploy is NAS first, then Pages (new table). The NAS is offline
as of 2026-10-08.
