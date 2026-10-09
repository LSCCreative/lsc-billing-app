# Information Architecture: Trip Planner, Google Calendar and Editor Autosave

Extends the existing app; nothing here replaces its navigation. Decisions: T1–T18, G1–G5, I1–I4
in [`DECISIONS.md`](DECISIONS.md). Experience: [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).
**Model: Opus, effort high. Frontend task.**

Who uses what:
- **The owner** (signed in) plans trips in the editor, where they spend about 80% of their time,
  reads the call sheet on the Project page, and connects Google Calendar in Settings.
- **Crew and others** (no account) only ever see the public call sheet link or its PDF. That is a
  second, separate entry point, in the same shell as the client quote page.

## Site Map

New items are **bold**; existing ones are shown for place only.

- Home `#/home`: month calendar + Coming up
  - **Calendars ▾** in the calendar header (Google calendar toggles, Refresh)
  - **Google event tiles** on the grid and in the under-grid list
- Projects `#/projects`
  - Project page `#/projects/<projectId>`
    - Documents panel
      - **Call sheet row** (one per estimate with ≥1 trip)
    - Production days panel (read-only; rows open the editor's day)
  - Estimate editor `#/projects/<projectId>/estimate[/<estimateId>]`
    - Production booking panel
      - Calendar column → **Calendars ▾**, Google event tiles
      - Day service menu → **Define travel** (fixed footer)
      - **Travel view** `…/estimate[/<estimateId>]?trip=<dayId>` (I1)
    - On set, by day → travel lines show **FROM TRIP** when linked
    - Sticky bar → **autosave status · Done** (unsent) / Save (sent, accepted)
    - ⋯ → **Undo changes since I opened this**
  - New estimate `#/projects/new` → on first autosave, **replaced** with
    `#/projects/<projectId>/estimate` (router `replace`, no re-render)
  - Read-only estimate `…/estimate[/<estimateId>]/view`
  - **Call sheet (in app)** `#/projects/<projectId>/estimate[/<estimateId>]/call-sheet`
- Settings `#/settings/<section>`
  - Business `#/settings/business` → **Home base address**
  - **Google Calendar** `#/settings/calendar` (new section, between Email and Card payments)
  - (Payment, Estimates & invoices, Service agreement, Email, Card payments, Account: unchanged)
- Client pages (separate page, no session) `c/`
  - Quote `c/#e/<token>`, Invoice `c/#i/<token>`: unchanged, never show travel
  - **Call sheet `c/#s/<token>`**

## Navigation Model

- **Primary navigation:** unchanged (LSC Creative · Projects · Clients · Finance & Price ·
  Settings · Sign out). Nothing new earns a top-level item.
- **Secondary navigation:**
  - The editor's jump rail is unchanged. "Booking" scrolls to the Production booking panel,
    which may be showing the travel view.
  - Inside the travel view the only navigation is **Back** (top left): it drops `?trip`, the
    same as browser Back, and returns to that day's open service menu.
  - The Settings rail gains **Google Calendar**.
- **Contextual links (the cross-wiring):**
  - Travel line FROM TRIP → **Edit trip** → `?trip=<dayId>`.
  - The day card's trip summary → `?trip=<dayId>`.
  - Call sheet stop rows → nothing in-app (read-only). Each has **Open in Google Maps**
    (external, new tab).
  - Call sheet page header → **Edit trips** → the editor (`?trip=` the first day with a trip).
  - Calendars ▾ when not connected → **Connect Google Calendar** → `#/settings/calendar`.
  - Settings → Google Calendar → **Manage calendars** shows the same toggles as Calendars ▾.
  - Project page → Production days row → the editor's day (existing). If that day has a trip,
    the row shows "Trip · 186 km".
- **Utility:** the OAuth round trip leaves the app for Google's consent page and returns to
  `#/settings/calendar?connected=1` (or `?error=<code>`), which the section reads once and then
  clears with `replace`.
- **Mobile:** unchanged top nav. The travel view stacks (map, then stops). Menus are bottom
  sheets (`menu.js`). The call sheet is one column.

## Content Hierarchy

### Travel view (editor, Production booking panel body)
1. **Header row:** Back, "Travel · Day 2 · Thu 29 Oct", ⋯ (Recalculate, Clear trip). Which day
   you are on comes first, because there's one trip per day.
2. **Map** (left / top) with the search bar above it while a stop is waiting for a location.
   It's how stops get placed.
3. **Stops** (right / below): the Destinations heading, the Show trip details toggle, START,
   destinations (each with details and time on location), RETURN, then + Destination / Return
   trip.
4. **Trip totals:** km, drive time, and the two lines they feed with prices. It sits last because
   it's the outcome. The stale-figures message (T6) appears here.
5. Status line: routing in progress or failure, a polite live region.

### Day service menu (existing sheet)
1. Service groups (existing).
2. **Define travel** / **Edit travel · 186 km**, a fixed footer that's always visible.

### Editor sticky bar
1. Client total (existing).
2. **Autosave status** (Saving… / Saved 2:41 pm / Not saved: reason → field / Not saved yet).
3. **Done** (unsent) or **Save** (sent, accepted). ⋯ holds Undo changes since I opened this.

### Call sheet (in app, public page and PDF share one layout)
1. **Header:** "Call sheet", UPID · project name, client business name, "Updated 8 Oct, 2:41
   pm". The in-app page adds Download PDF, Share… and Edit trips.
2. **One section per day with a trip**, in date order (Date TBC days last): day title, start
   time, and the day's total km and drive time.
3. **The route map image** for that day.
4. **The schedule:** START (depart time), then for each leg "— 42 km · 48 min —", then each stop
   (number, arrive and leave times, address, Open in Google Maps), then each stop's Capture
   details, Location description and Access details in full. RETURN closes the day.
5. Footer: LSC Creative business name, email, phone (as client pages show). Never prices.

### Project page: Call sheet row (Documents panel)
1. "Call sheet" + facts ("3 days · 412 km") + link state ("Link on" chip).
2. Primary **Open** → in-app call sheet.
3. Documents ▾: **Download PDF**. Actions ▾: **Share…**, **Copy link** (when on), **Turn off
   link** (danger section).
   The row sits after its estimate's row. With several estimates in a project, each has its own.

### Settings → Google Calendar
1. **Connection state:** "Connected as lachlan@… since 8 Oct" + Disconnect, or the Connect
   button and one sentence on what connecting does.
2. **Calendars:** toggles with colour dots, primary first. Explains "Shown on Home and the
   booking calendar".
3. **Writing bookings:** fixed text (confirmed + pencilled to your primary calendar). Sync status
   ("All bookings synced" / "2 days not synced · Retry"). **Sync existing bookings** button.
4. Disconnect dialog's option "Also remove the app's events from Google".

### Settings → Business
- **Home base address:** after the existing business fields. A search field with suggestions
  (the same combobox as the planner, no map). It stores address + coordinates.

### Calendar (Home + editor)
1. App days (existing, unchanged).
2. **Google events:** faded tiles with a colour dot. All-day events are a thin top band.
3. Header: month controls (existing) + **Calendars ▾**.
4. Under-grid list (existing) includes Google events, read-only.

## User Flows

### 1. Plan a day's trip (first time)
1. The owner opens a day's service menu (day card "+ Add" or the Production section's "Add to a
   day").
2. Clicks **Define travel** → `?trip=<dayId>`. The panel body swaps to the travel view.
   - If the panel was collapsed → it opens first.
   - If the Maps script isn't loaded → it loads once (`maps.js`). On failure → "Couldn't load
     Google Maps" + Try again. The stop list still works by search only if Places loaded,
     otherwise the whole view says what failed.
3. **+ Add start location** → START cell + search focused. Home base is offered first.
   - If Home base is picked → START fills at once.
   - Otherwise search → pending pin → confirm (pin, "Use this location" or Enter), or click the
     map → pending pin (reverse-geocoded) → confirm.
4. **+ Destination** → empty cell → place as above. Optional: + Add details ▾, time on location.
5. With ≥1 destination the first route is requested (Routes API, traffic for the day's
   date + start time, T5).
   - If the day has no date or start time → traffic-unaware, and the totals say so.
   - If the per-km or own-time hours row is missing or unpriced → the totals show the figures
     and say which line couldn't be added and why.
6. The route returns → map line, legs, totals. The two linked lines are created or updated on
   the day (km ↑ whole, hours ↑ 0.25). The editor recalculates, then autosaves (unsent) or marks
   the form dirty (sent).
7. Optional: **Return trip** → RETURN cell → re-route.
8. **Back** → the day's menu. The day card shows "Trip · 3 stops · 186 km · 2 h 40".

### 2. Edit an existing trip
1. Edit trip (from a FROM TRIP line, the day card summary, the menu footer or `?trip=` link) →
   travel view with the stored route drawn from the stored polyline (no API call on open, T6).
2. Change stops: add, place, drag or Move up/down, remove (toast Undo), time on location.
3. Each change → re-route → lines update → autosave.
   - If the day's date or start time changed since `routedFor` → the totals show "Day changed.
     Drive times may differ." + **Recalculate**. Nothing moves until it's pressed.

### 3. Unlink or clear
- **Unlink:** a travel line's ⋯ → Unlink from trip → confirm → the line drops `fromTrip`, its qty
  becomes editable, and the trip totals note "Vehicle km unlinked: billed as typed". The trip
  never touches that line again. Relinking means clearing and rebuilding the trip (or a
  "Relink" item in the same ⋯; it re-applies the trip's figures).
- **Clear trip:** ⋯ → Clear trip → "Also remove the 2 travel lines it added? ($X)" →
  Remove / Keep as ordinary lines / Cancel → the trip is null, and the view returns to the empty
  state (+ Add start location).

### 4. Autosave: a new estimate
1. `#/projects/new` → the bar says "Not saved yet: add a project name and UPID".
2. Name + UPID present and the form valid → 1.5 s after the last edit → POST → the route
   **replaces** to `#/projects/<id>/estimate` → "Saved 2:41 pm".
   - If the Save-to-client-list tick is on and the Business Name field has been left → the client
     is created in the same save.
   - If a check fails (ABN, reversed rental, locked date, holiday reprice pending) → "Not saved:
     <reason>" linked to the field. It retries on the next edit.
3. Later edits → PUT with `X-LSC-Autosave: 1` and `baseUpdatedAt`.
   - If the server says `estimate_changed_elsewhere` (409) → "Changed in another tab or
     device · Reload". Autosave pauses until reload.
4. **Done** → waits for an in-flight save → the Project page.

### 5. Autosave does not apply: sent or accepted estimate
1. The editor opens a sent or accepted estimate → the bar shows **Save** (today's behaviour),
   with no autosave status.
2. Save → `resend_required` → SendPanel update dialog (existing).

### 6. Undo changes since I opened this
1. ⋯ → Undo changes since I opened this → confirm ("Put this estimate back as it was at 2:12
   pm?").
2. The editor PUTs the payload captured at mount (autosave path) → re-mounts from the reply.
   Trips, days and lines are all restored. Google sync follows the save like any other.

### 7. Connect Google Calendar
1. `#/settings/calendar` → **Connect** → the browser goes to the API's `/api/google/oauth/start`
   (session cookie) → Google consent ("Production Decks" wants to view and edit events,
   see your calendar list).
2. Google → `/api/google/oauth/callback?code&state` → the NAS checks `state`, swaps the code for
   tokens, reads the account email and calendar list, stores them, and redirects to
   `<Pages origin>/#/settings/calendar?connected=1`.
   - If the user cancels or it errors → `?error=access_denied|oauth_failed` → the section
     explains and offers Connect again.
3. The section shows Connected + calendars (primary on) + **Sync existing bookings**.
4. Sync existing bookings → the NAS writes every confirmed or pencilled dated day → status
   "All bookings synced" or "N days not synced · Retry".

### 8. Choose which Google calendars show
1. Calendars ▾ (Home or editor) or Settings → toggles. Each toggle saves at once (PUT) → the
   calendar refetches the visible range.
   - If not connected → the menu has one item: **Connect Google Calendar**.

### 9. A booking reaches Google
1. Any write that changes a dated day's date, times, status, items, trip, the estimate's name or
   UPID, the client, or declined state: estimate POST/PUT (autosave included), duplicate,
   decline, Mark accepted, the client's accept on `c/#e/`, a day removed, an estimate deleted.
2. After the commit the NAS queues the estimate for sync (debounced 5 s per estimate, so a run of
   autosaves makes one push).
3. For each day: the wanted state comes from G4/G5. The current state comes from
   `google_event_sync`. The NAS creates, patches or deletes the event and stores the event id +
   pushed hash.
   - If Google errors → the row is marked `error`, retried with backoff (1 min, 5 min, 30 min, then
     on demand). It shows on the day card (small mark) and in Settings. The save is never blocked.
   - If disconnected → nothing is queued.

### 10. Share the call sheet
1. Project page → Call sheet row → Actions ▾ → **Share…** (or the in-app call sheet's Share…).
2. The dialog: if there's no link yet → **Turn on link** creates the token. Then the link field
   with **Copy link** (toast "Copied") and **Email**: To (one or more addresses, comma or
   Enter), optional note → Send → "Call sheet sent to 2 people" (toast).
3. **Turn off link** (dialog or row ⋯) → the token is kept but disabled. The public page then
   says "This call sheet link has been turned off." Turning it back on reuses the same link.

### 11. Crew open a call sheet
1. `c/#s/<token>` → GET `/public/call-sheets/:token` (no credentials).
   - If the link is off or unknown → "This call sheet link isn't active. Ask LSC Creative for a
     new one."
2. The page shows the call sheet (latest saved, T18) + **Download PDF**
   (`/public/call-sheets/:token/pdf`). **Open in Google Maps** per stop.

## Naming Conventions

| Concept | Label in UI | Notes |
| --- | --- | --- |
| A production day's route | **Trip** | "Trip · 3 stops · 186 km". Never "route" or "journey" in labels. |
| The planner | **Travel** view, opened by **Define travel** / **Edit travel** | Sentence case (ui-clarity). The user's "DEFINE TRAVEL" becomes "Define travel". |
| A place on the trip | **Stop** | Cells, counts, announcements ("moved to stop 2 of 4"). |
| First stop | **Start** | Chip START. Its button is "+ Add start location". |
| Middle stops | **Destination** | Its button is "+ Destination". Chip shows the number 1…n. |
| Closing stop | **Return** | Its button is "Return trip". Chip RETURN. |
| Leg distance/time | `— 42 km · 48 min —` | Mono. "h" and "min", never "Hour". Times over an hour read "1 h 05". |
| Detail fields | **Capture details**, **Location description**, **Access details** | The user's three names, verbatim. The menu is "+ Add details". |
| Time at a stop | **Time on location** | Duration field; shown on the call sheet as "(3 h)". |
| Saved default start | **Home base** | Settings → Business. |
| Re-ask Google | **Recalculate** | Only in ⋯ and in the stale message. |
| Line fed by a trip | **From trip** (chip FROM TRIP) | Actions **Edit trip**, **Unlink from trip**, **Relink to trip**. |
| Shareable schedule | **Call sheet** (I4) | Row, page title, PDF title "Call sheet · UPID · Project", email subject, public page. |
| Share actions | **Share…**, **Copy link**, **Turn off link**, **Turn on link** | Copy link matches the Project page's existing wording. |
| Google connection | **Google Calendar**, **Connect**, **Disconnect** | Settings section and Calendars ▾. |
| Google calendars list | **Calendars** | Menu button "Calendars ▾". |
| An event from Google | (its title) + calendar name | Never "busy" in labels. The tile is just faded. |
| App → Google writing | **Sync** | "All bookings synced", "Sync existing bookings", "1 day not synced · Retry". |
| Autosave states | **Saving…**, **Saved 2:41 pm**, **Not saved: …**, **Not saved yet: …** | The bar's status text. |
| Leaving the editor | **Done** | Replaces Cancel + Save on unsent estimates. |
| Session undo | **Undo changes since I opened this** | In the bar's ⋯. |

## Component Reuse Map

| Component | Used on | Behaviour differences |
| --- | --- | --- |
| `.panel` / `panel.js` | Editor (booking panel hosts the travel view) | The booking panel body gains `.is-trip`; the header and collapse are unchanged. |
| `BookingBlock` menu host | Service menu, travel view | `.is-menu` hides the calendar (one column); `.is-trip` hides both columns and the day cards. |
| `menu.js` | + Add details ▾, travel ⋯, line ⋯ (Unlink/Relink), Calendars ▾ (checkbox items), call sheet row menus | Calendars ▾ needs **checkbox menu items** (`menuitemcheckbox`), a small extension to menu.js. |
| `sortable.js` | Destination cells | START and RETURN are not items (outside the sortable list). |
| `typeahead.js` pattern | Map search, Home base field | A new `fetch` adaptor over Places Autocomplete (session tokens per search). |
| `toast.js` (with action) | Stop removed · Undo; Copied; Sent | Existing. |
| `modal.js` | Share, Clear trip, Unlink, Undo session, Disconnect | Existing focus trap. |
| `calendar.js` | Home, editor | Gains `setGoogle(events)` and a header slot for Calendars ▾. Google tiles are a new tile variant; the under-grid list includes them. |
| Call sheet renderer | In-app page, public page, PDF | One server-side HTML builder in `pdf.js` style (like the agreement). The in-app and public pages render the same JSON with one shared browser module (`web/js/call-sheet.js`) loaded by both `index.html` and `c/index.html`. |
| `web/c/` shell | Quote, invoice, **call sheet** | `linkOf` gains `s`. A call sheet has no accept, signature or payment UI. |
| `SendPanel` recipient field | Share dialog email | Reuse the To field and validation, not the scheduling. |
| `maps.js` (new) | Travel view, Home base field | Loads Google Maps JS once (`LSC_MAPS_KEY`, libraries `places`, `routes`, `marker`, `geocoding`). Every Maps call goes through it, so swapping provider stays contained. |
| Editor sticky bar | Editor | Unsent: status + Done. Sent/accepted: Save (today). |

## Content Growth Plan

- **Trips:** one per day, at most 25 stops (START + 23 + RETURN). Detail text ≤ 2,000 characters
  each, address ≤ 300. Nothing paginates.
- **Call sheets:** one per estimate. A project with several estimates lists one row per estimate
  that has trips.
- **Google calendars:** the toggle list grows with whatever the account can see. Primary first,
  then owned, then others alphabetically. The menu scrolls past ~10.
- **Google events:** fetched per visible range only (≤ 6 weeks for the month view, ≤ 400 days
  cap as today), cached ~5 minutes on the NAS per calendar + range. Nothing is stored long-term.
- **Sync rows:** one per synced day. Rows for deleted days are removed once their event is
  deleted.
- **Static map images:** cached per day by a hash of the stops and polyline (dropped when the trip
  changes). Bounded by the number of days with trips.
- **Pre-write backups:** the throttle (I2) keeps the 10 kept snapshots minutes apart instead of
  seconds.

## URL Strategy

- **App (hash routes):**
  - Pattern stays `#/<area>/<id>/<sub>[/…]`. New sub-paths are kebab-case nouns: `call-sheet`.
  - Editor state that should survive a reload uses a query: `?trip=<dayId>` (I1). Absent means
    the planner is closed. An unknown day id is ignored and the query dropped with `replace`.
  - One-shot results use a query that's read once and removed with `replace`:
    `#/settings/calendar?connected=1`, `?error=<code>`.
- **Client pages:** `c/#<kind>/<token>`, with kind `e` quote, `i` invoice, **`s` call sheet**. The
  token stays in the fragment (never logged, never in a Referer).
- **API (NAS):** see the Data & API appendix. New owner routes sit under existing nouns
  (`/api/estimates/:id/call-sheet…`) or a new `/api/google/…` group. Public routes are
  `/public/call-sheets/:token[/pdf]`.

---

## Appendix: Data & API (for brief-to-tasks)

### Schema v16 (additive; NAS before Pages)

- `production_days.trip_json TEXT` (null = no trip). The trip:
  ```
  { stops: [ { id, role: 'start'|'stop'|'return', address, lat, lng, placeId,
               minutesOnSite?,                       // stops only
               details?: { capture?, description?, access? } } ],   // stops only; key present = shown
    legs:   [ { km, minutes, departAt?, arriveAt? } ],             // legs[i] = stops[i] → stops[i+1]
    totals: { km, minutes },
    polyline: '<encoded>',                     // redraw without an API call; static map path
    routedFor: { date, startTime, traffic },   // T6 staleness check
    routedAt: '<ISO>' }
  ```
  A RETURN stop carries no coordinates of its own. It always mirrors START (server-enforced).
- `estimates.call_sheet_token TEXT UNIQUE`, `estimates.call_sheet_on INTEGER NOT NULL DEFAULT 0`.
- `google_account` (single row, id = 1): `email`, `refresh_token` (plain, I3), `access_token`,
  `access_expires_at`, `calendars_json` (`[{ id, summary, colour, primary, on }]`),
  `connected_at`.
- `google_event_sync`: `day_id PK`, `estimate_id`, `event_id`, `pushed_hash`,
  `state ('synced'|'pending'|'error')`, `error`, `attempts`, `next_try_at`, `updated_at`.
- `static_maps`: `day_id PK`, `hash`, `png BLOB`, `fetched_at`.
- Settings JSON: `business.homeBase = { address, lat, lng, placeId }`.

### Lines fed by a trip
- A travel line on `activeRows.travel` gains `fromTrip: 'km' | 'hours'` (with its existing
  `dayId`). Absent means an ordinary line.
- Which Rate Card row: the first `perKm` row for km. For hours, the first own-time row (`ownTime`,
  not `directCost`, not `perKm`). Unpriced or missing means no line, and the trip says why.
- **`calc.js` (both copies, byte-identical)** gains `tripLineQty(trip, 'km'|'hours')`: km = ceil
  of totals.km; hours = ceil(totals.minutes / 15) / 4. The server, on every estimate write, sets
  each `fromTrip` line's qty from its day's trip with this function. A line whose day has no trip
  loses `fromTrip`.

### Estimate writes (autosave)
- `PUT /api/estimates/:id` accepts `baseUpdatedAt`. A mismatch returns
  `409 estimate_changed_elsewhere` (applies to all writes, cheap and safe).
- Header `X-LSC-Autosave: 1`:
  - Refused with `409 autosave_not_draft` if the estimate is sent or accepted.
  - The pre-write snapshot is throttled (I2): the first autosave after `X-LSC-Session: <random
    per editor mount>` changes, then ≤ 1 per 10 min per estimate.
- `days[].trip` is accepted, validated (`trip_invalid`, `trip_too_many_stops`,
  `trip_text_too_long`) and stored on `trip_json`.

### Call sheet
- `GET /api/estimates/:id/call-sheet`: owner JSON (the same allow-listed shape as public, plus
  link state).
- `GET /api/estimates/:id/call-sheet/pdf`
- `POST /api/estimates/:id/call-sheet/link` `{ on: true|false }` → `{ token, on }`
- `POST /api/estimates/:id/call-sheet/email` `{ to: [..], note }` (Resend; the branded shell when
  ui-clarity D2 lands)
- `GET /public/call-sheets/:token`, `GET /public/call-sheets/:token/pdf` (rate-limited like the
  quote PDF). **An allow-list** (`callSheetView`): business name, email and phone; UPID, project
  name, client business name; per day date, start time, stops (address, lat/lng for the Maps
  link, minutesOnSite, details), legs, totals, the static map as a data URI; updatedAt.
  Never prices, rates, client contact details or internal figures. Leak test beside
  `test-public.js`.
- Static map: the NAS calls Maps Static with `GOOGLE_MAPS_SERVER_KEY` (path `enc:<polyline>`,
  numbered markers) and caches it in `static_maps`. The key never reaches a browser.

### Google Calendar
- `GET /api/google/status` → `{ connected, email, connectedAt, calendars, sync: { pending, errors } }`
- `GET /api/google/oauth/start` (session) → 302 to Google (`access_type=offline`,
  `prompt=consent`, scopes `calendar.events` + `calendar.calendarlist.readonly`, an HMAC'd
  `state`).
- `GET /api/google/oauth/callback` → stores the tokens → 302 to
  `${APP_ORIGIN}/#/settings/calendar?connected=1`. New env `APP_ORIGIN` (the Pages URL, e.g.
  `https://lsccreative.github.io/lsc-billing-app`).
- `PUT /api/google/calendars` `{ on: [calendarId…] }`
- `POST /api/google/sync` `{ all?: true }` (retry errors, or sync existing bookings)
- `POST /api/google/disconnect` `{ removeEvents: bool }` → revokes, deletes the token row, and
  deletes events if asked.
- `GET /api/calendar` gains `google: [{ id, calendarId, title, start, end, allDay, colour }]` and
  `googleState: 'off'|'ok'|'unavailable'`. Events tagged `lscDayId` are excluded.
- Event payload (G5): `summary` "UPID · Project · Client" ("Pencil · " prefix +
  `status: tentative` for pencilled); start/end `dateTime` in `Australia/Sydney`, or `date` for
  all-day; `location` = the trip's first destination address; `description` = items, trip
  summary, call sheet link (when on), project link; `extendedProperties.private.lscDayId`.
- New env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_MAPS_SERVER_KEY`,
  `APP_ORIGIN`. New Pages secret: `LSC_MAPS_KEY` (written into `config.js`). Optional
  `LSC_MAPS_ID` (Map ID) the same way.

### Frontend modules
- `web/js/maps.js` (loader + thin wrappers: autocomplete, geocode, route), `web/js/views/trip-planner.js`
  (the travel view; mounted by the editor into the booking host), `web/js/call-sheet.js` (shared
  renderer), `web/js/autosave.js` (debounce, status and flush; used by the editor only), plus
  edits to `booking-block.js`, `estimate-editor.js`, `calendar.js`, `home.js`, `menu.js`
  (checkbox items), `settings.js`, `project-folder.js`, `web/c/c.js`.

### Known risks to carry into tasks
- Autosave makes PUTs frequent. `baseUpdatedAt` stops two tabs silently overwriting each other.
  The prewrite throttle stops backup churn.
- Each route request is a billable call. Route only on stop changes, never on open (stored
  polyline), and use a session token per autocomplete search.
- The OAuth callback lands on the NAS origin and must redirect to Pages. `APP_ORIGIN` must match
  the Pages URL exactly.
- Days are replaced whole on every save (`days.js`). The sync must diff by day id, not assume
  stable rows.
