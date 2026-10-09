# Handover: Trip Planner, Google Calendar and Editor Autosave

Read this, then [`DECISIONS.md`](DECISIONS.md) (T1–T18, G1–G5, I1–I4, the user's; don't re-ask), then
[`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).

**Model: Opus, effort high. Frontend task** (task 5 next; tasks 4 and 6 are money too).

## State as of 2026-10-09 (task 4)

Design phases done 2026-10-08 (grill, brief, IA, tasks; tokens skipped). Building on branch
**`trip-planner`** (off `ui-clarity`, unpushed).

- [x] **Task 1** trip storage and the km/hours rule, `fc331dc`. Schema v16, server derivation,
  calc functions, 19 new tests (`test-trips.js`, plus `test-calc.js` and `test-db.js`).
- [x] **Task 2** Maps loader and the travel view shell, `7d83047`. `maps.js`, `views/trip-planner.js`,
  `css/trip.css`, Define travel foot, `?trip=` with router `claim()`/`mark()`. Verified in the
  browser at 1280, 800 and 375: map draws (key + billing OK), reload reopens, view Back and
  browser Back/Forward keep unsaved edits with no prompt, unknown day id dropped, no-key message.
- [x] **Task 3** placing stops, `7df0e05`. Cells, search combobox over Places, pending pin, map
  click, numbered pins, remove + Undo, Return trip, Home base offer; the trip saves in
  `days[].trip`. Verified at 1280, 800 and 375: a 3-stop round trip by keyboard events alone,
  saved and reloaded (server stores it, no dirty flag on reopen); map click by a real click;
  Escape ×2; Change + Escape keeps the old spot; 23 cap; no results; search failure (stubbed);
  Home base (stubbed in memory). 593 server tests pass (no server change).
- [x] **Task 4** routing, legs, totals and the linked lines, `COMMIT4`. Routes API, Show trip
  details, Trip totals, FROM TRIP lines, Recalculate (⋯ and the message), Day changed, failure +
  Try again, the live region. Verified on the scratch trip (Fitzroy North VIC → Bondi → Eveleigh
  → return, ~1,750 km): editor total = Rate Card price × rounded quantities ($0.90 × 1,751 km,
  $95 × 19 h; then 1,752 km and 18.5 h without traffic), and the server's derived qty matched after
  each save. No Routes call on open; Undo restores route + lines with no call; a slow reply after
  an Undo is dropped. Shots at 1280/800/375 (headless), no overflow. 593 server tests pass.
- [ ] **Next: task 5**, destination details, time on location and reordering. *Frontend:
  Opus/high.* **Frontend task.** `minutesOnSite` already feeds the route (dwell before the next
  leg, and the stop signature), so a time-on-location edit must go through the view's
  `changed()` to re-route. A reorder likewise.

**Scratch state (for testing):** the scratch card now prices both trip rows (Overhead
`vehicleCostPerKm` 0.9; Transport & Logistics Hrs typed $95). Setting the vehicle figure through
`PUT /api/goals` also filled in Capacity defaults. `est_43f5777a` day `d_nbk1` is saved as START
→ Bondi → RETURN with **no start time** (traffic-unaware route), and still has the hand-typed
"Vehicle — per km" (qty 120) line that sets off the double-billing note.

## Decisions made in task 4 (agent's, within the brief)

- **Routes over REST** (`routes.googleapis.com/directions/v2:computeRoutes`, key in a header),
  not the Maps JS routes library: one known request shape, no script needed. Works from the
  browser with the website-restricted key. All in `maps.js` (`route`, `routeLine`, polyline
  codec).
- **With traffic: one request per leg, in order**, each departing at the previous arrival + that
  stop's time on location (T5/T11). **Without traffic: one request** for the whole trip.
  Traffic needs the day's date + start time *and* a start still in the future (Google refuses
  past times for traffic), else traffic-unaware with a note that says which.
- **`routedFor.stops`**: a short FNV signature of the stops (role, spot, time on location),
  accepted by `days.js` (`ROUTE_SIG`, optional). A stored route that doesn't match the stops
  shows "The stops changed after the route was worked out" + Recalculate (after a failed
  re-route, or Back while one was on its way). A trip never routed shows "hasn't been routed
  yet" + Recalculate. **Opening never routes**, not even an unrouted trip.
- Leg clock times are wall-clock `HH:MM` from the day's start time (`departAt`/`arriveAt`), only
  when the day has one. Totals: km to 0.1, time "18 h 55"; the lines show the billed (rounded-up)
  quantities.
- **Linked lines exist only while the trip has ≥ 1 leg.** The editor (`syncTripLines`) makes
  each the first time it's needed, priced like a menu add (`unitSnap`, `markOwn`; the rates
  toggle applies), then only its qty follows. A start alone, or no trip, removes them (Undo
  brings them back). A row with no price yet adds no line, and the totals say why.
- **Linked lines are fully locked** (T4): read-only qty (dashed), FROM TRIP chip + Edit trip,
  **no ×, no Move to, no drag**. Unlink is task 6.
- **A line typed by hand of a kind the trip bills is not adopted.** The totals warn instead
  ("also has … typed in by hand. Remove it if this trip covers the same driving"). Adopting it
  would fight task 6's Unlink (an unlinked line would be re-adopted on the next route). Task 6
  may revisit.
- **Duplicate day strips `fromTrip`** from the copies (`duplicateLines`) until task 6 copies the
  trip with them.
- The ⋯ shows once the trip has ≥ 2 stops, holding Recalculate only. Show trip details shows when
  the stored legs fit the stops; it's `localStorage['lsc.trip.details']`.
- The route line is `--color-accent-mark`, faint (0.35) while routing or out of date. Leg lines
  are `aria-hidden` list items; each cell carries the spoken leg ("Drive from the stop before:
  …") so the list still counts stops only.
- Polylines over 49,000 characters are thinned (every nth point, ends kept). The scratch
  Melbourne–Sydney round trip was ~42k.

## Decisions made in task 3 (agent's, within the brief)

- **Only placed stops are saved** (parseTrip needs a spot each, START first, a destination
  before RETURN). An empty cell is screen-only and gone after a reload. To keep the list saving
  as it reads: one empty destination at a time (+ Destination goes back to it); START is
  removable only when it's the last cell, and every placed cell (not RETURN) has **Change**
  (re-place; Escape keeps the old spot); RETURN goes with the last placed destination ("Stop and
  return trip removed", one Undo restores both).
- The view keeps the stored `legs/totals/polyline/routedFor/routedAt` untouched on stop edits
  (task 4 replaces them). When the trip goes (no start) they go too, so a new start can't inherit
  an old route's totals.
- `BookingBlock` keeps `trip` per day (`norm`), sends `trip: d.trip || null` for every day, and has
  `tripOf(id)` / `setTrip(id, trip)` (→ `onChange` → recalc + dirty). Duplicate day starts with
  `trip: null` until task 6.
- A stop's address is the Places suggestion's full text less ", Australia" (it names the place and
  the street); the place lookup asks for `location` only (cheapest field). Typed best match = the
  top suggestion, else Geocoding. Geocoding drops country/state results ("Australia" came back
  for nonsense); reverse geocoding prefers a street address to a Plus Code.
- One search session token per search (made on the first suggest, ended by the place lookup).
  Suggestions start at 3 letters, 250 ms debounce.
- The pending card sits at the map's foot, lifted 32px and inset 60px on the right: Google's logo,
  attribution and zoom buttons must stay visible. "Use this location" is the view's one
  terracotta action.
- START's pin reads S with a small R badge once there's a return (they share a spot).
- An Undo from the toast reaches the view on show for that day (a module-level map), or, if it
  has closed, sets the day's trip directly. The editor's `onChange` ignores calls once the editor
  has gone.

## Decisions made in task 2 (agent's, within the brief)

- **The router owns no screen knowledge still.** `LSCRouter.claim(fn)` lets the screen on show take
  a query-only move on its own path (Back/Forward/typed). `fn` must not `mark()` synchronously
  (the move is recorded after it returns); it defers with `queueMicrotask`. `LSCRouter.mark(path,
  {replace})` moves the address without a render. A claim is cleared on every render.
- View Back = `history.back()` when the view pushed its entry (so Forward reopens it), else a
  replace (after a reload or a link).
- **The travel view's ⋯ isn't drawn yet**: `menu.js` draws no menu without items. Task 4 adds
  Recalculate and task 6 Clear trip; the ⋯ appears with them.
- Map: `gestureHandling` cooperative below 768, greedy above; `clickableIcons: false` (a click
  will place a stop); fullscreen/map type/street view off; opens on Sydney (`LSCMaps.HOME_VIEW`)
  until Home base exists (task 6).
- The day menu's foot sticks above the editor's bar via `--ed-bar-h`, set on `.ed-shell` by the
  editor (`watchBar`, measured once synchronously, then a ResizeObserver).

## Decisions made in task 1 (agent's, within the brief)

- **A day sent without a `trip` key keeps its stored trip**; `trip: null` clears it. The editor
  rebuilds days from scratch (`booking-block.js` `norm()` drops unknown keys), so today's build and
  any cached old one would otherwise wipe trips on save. Task 3 must send `trip` for every day it
  knows (null to clear). A new day id never inherits a trip.
- **`fromTrip` is dropped** (line left at the qty sent) when the line isn't in Travel, sits on no
  day or a day with no trip, names a kind its own snapshot isn't (`tripKindOf`: km only on a
  `perKm` line, hours only on an own-time line), or is a second line of the same kind on that day.
- Legs and totals are stored as sent; **totals are what bill**. Leg count needn't match the stops
  (a failed re-route keeps the last good figures). Unrouted trip = totals 0 = qty 0.
- `tripRows(pricing, ctx)` returns resolved rows (`travelRowDef`); `mu === null` means unpriced.
- Duplicate estimate strips `fromTrip` with the day (the line keeps its qty).
- A trip-only edit on a sent estimate doesn't need a resend (`changedSince` compares the client
  view); a changed km/hours qty does, correctly.

## Google setup (done 2026-10-08; Map ID 2026-10-09)

Two keys in Cloud project *LSC Production Decks*: **LSC Billing — browser** (website-restricted,
4 APIs) and **LSC Billing — server** (Maps Static only). Values are in `.credentials.local.md`
only. Map ID **"LSC Billing — trip planner"** `48b0b465b984a1fcfa2d9969` (JavaScript, vector,
Google default style) created 2026-10-09 with the user's OK; in `.credentials.local.md` and the
local `web/js/config.js`. **Billing works**: the map drew on localhost:5173 with no refusal.
Still open: a $1 budget alert, and the Pages secrets `LSC_MAPS_KEY` / `LSC_MAPS_ID` (task 20).

Google Calendar: the Calendar API is enabled, and the consent screen is Internal ("Production Decks", shared,
left unchanged). The OAuth client "LSC Billing — NAS calendar" (Web application, two redirect URIs,
see G1) was filled in but **not confirmed created**. The agent was blocked from reading its
secret, correctly. **The user creates it and pastes the client ID and secret into
`.credentials.local.md`.** Check `/auth/clients` for a duplicate before creating another.

## Traps

- `LSCData` (like every module here) is a top-level `const`: `window.LSCData` is **undefined**.
  Test for globals with `typeof`, or just use them.
- Pins and the pending pin draw a beat after the list (the marker library loads async), and
  later still while the browser pane is hidden. Poll for `.trip-pin`, don't read it at once.

- The repo is public. Keys never go in tracked files. The browser key reaches Pages through a
  GitHub secret written into the gitignored `web/js/config.js` by `deploy-pages.yml`.
- The browser key only works from `https://lsccreative.github.io/*` and `http://localhost:5173/*`
  (the console refused a wildcard port). Local previews on other ports need a row added.
- Autosave vs `backup.js` preWriteBackup: every mutating request snapshots the whole DB. Autosave
  PUTs must be throttled (I2), or recovery points collapse to seconds.
- New schema (v16): NAS before Pages. The NAS and the live site are back online (2026-10-09).
- `GET /api/estimates` (the list) now carries every day's trip, polyline included (≤ 50k chars
  each). Fine at today's volume. If the list slows, strip `polyline` there, not in `readDays`.
- The browser pane is often **hidden** (`document.visibilityState === 'hidden'`): its screenshots
  freeze. Use the headless route (memory: review screenshots); a script like task 4's lives in
  the session scratchpad only.
- A route reply that lands after the stops changed is dropped by `routeSeq`. Anything that
  changes the stops must go through `changed()` (never `emit()` alone), or a late reply can
  overwrite it.
- Limits in `days.js`: 23 destinations, 2000 chars per detail, 300 per address, 50k polyline,
  `minutesOnSite` a whole number ≤ 1440.
