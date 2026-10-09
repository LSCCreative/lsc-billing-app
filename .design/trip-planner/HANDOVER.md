# Handover: Trip Planner, Google Calendar and Editor Autosave

Read this, then [`DECISIONS.md`](DECISIONS.md) (T1–T18, G1–G5, I1–I4, the user's; don't re-ask), then
[`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).

**Next: task 9, Sonnet, effort high: backend** (call sheet data, links and the static map; no
frontend). Stage A (the trip planner) and stage B (autosave) are done.

## State as of 2026-10-10 (task 8)

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
- [x] **Task 4** routing, legs, totals and the linked lines, `a2f040f`. Routes API, Show trip
  details, Trip totals, FROM TRIP lines, Recalculate (⋯ and the message), Day changed, failure +
  Try again, the live region. Verified on the scratch trip (Fitzroy North VIC → Bondi → Eveleigh
  → return, ~1,750 km): editor total = Rate Card price × rounded quantities ($0.90 × 1,751 km,
  $95 × 19 h; then 1,752 km and 18.5 h without traffic), and the server's derived qty matched after
  each save. No Routes call on open; Undo restores route + lines with no call; a slow reply after
  an Undo is dropped. Shots at 1280/800/375 (headless), no overflow. 593 server tests pass.
- [x] **Task 5** destination details, time on location and reordering, `5f2c1d1`. Verified on a
  five-destination Sydney day: + Add details ▾ (used items leave the menu), blocks open/close in
  place with a one-line excerpt, Remove in the block's ⋯ with Undo; time on location parsed,
  re-routed and the clock times shifted by it; reorder by ⋯ Move up/down and Alt+↑/↓ (pane,
  dispatched events), by a real mouse drag at 1280 and a real finger drag at 375 (headless
  Chrome); each re-routed and announced "… moved to stop N of 7". Details and minutes saved to
  the server. Shots at 1280/800/375, no overflow. No server change.
- [x] **Task 6** trip lifecycle around the day, and Home base, `5c0563f`. **Stage A is done.**
  Verified in the pane on the scratch estimate, each answer saved and checked on the server:
  Unlink (dialog → ordinary line, `unlinked: ['km']`, no new linked line on the next route, the
  totals say "billed as typed"), Relink (trip's 109 km back on the line), Clear trip → Remove
  (linked lines gone, trip null) and → Keep (lines kept as ordinary at their qty), Duplicate day
  (copy has the trip, its linked lines, "Day changed" until recalculated; server derives both),
  Remove day ("Its trip and 4 items are removed too"), day card / menu foot / Project page
  summaries, Settings → Home base (pick by keyboard, saved with coordinates; typed text refused;
  blank removes it) and its one-pick Start in the travel view. Shots at 1280 and 375
  (headless), no overflow. 594 server tests pass.
- [x] **Task 7** autosave on the server, `ff61ec7`. 600 server tests pass (`test-autosave.js`, and
  the throttle with a fake clock in `test-backup.js`). No schema change.
- [x] **Task 8** autosave in the editor, `8f92a09`. **Stage B is done.** Verified in the pane on
  scratch (dispatched events; the pane was hidden, so focus/blur were dispatched `focusout`s):
  a blank new estimate saved with no click once it had a name and UPID, and its address became
  `#/projects/<id>/estimate` with no re-render; nothing sent mid-typing, one PUT after the pause,
  on leaving a field and on opening a panel, each with `X-LSC-Autosave`, `X-LSC-Session` and
  `baseUpdatedAt`; a bad ABN read "Not saved: …" with a button to the field, sent nothing, and
  saved once fixed; a write from "another tab" → "Changed in another tab or device · Reload",
  nothing more sent, Reload asked and redrew the server's copy; removing the trip day ($5,094)
  then ⋯ Undo put back all three days, the seven-stop trip, both linked lines, the notes and
  $6,644.60; a sent estimate kept Cancel/Save, sent no autosave and Save opened the resend
  dialog; the client was added only on leaving Business Name; Back from a new estimate's travel
  view after its first save closed the view on the same form; Done waited for the save, then
  the project; a stubbed `autosave_not_draft` switched the bar to Save; Delete waited for the
  save on its way. Shots at 1280/800/375 (headless), no overflow. 600 server tests pass (no
  server change).
- [ ] **Next: task 9**, call sheet data, links and the static map. *Sonnet/high, backend.*

## Decisions made in task 8 (agent's, within the brief)

- **Autosave mode = a new estimate or `status === 'draft'`** (the server's own rule). Anything
  else draws today's Cancel + Save. A 409 `autosave_not_draft` mid-session switches the bar to
  Save in place and says why on the error line.
- **The bar:** total · status · ⋯ · **Done** (primary). Below 768px the status is its own line
  under the buttons. "Saving…" only while a request is out (a blur with nothing new sends
  nothing and doesn't flicker). A status naming a field is a button to it (opens its panel,
  focuses it; never steals focus by itself). Screen readers hear a problem once and the save
  that fixes it, not every routine save (`#ed-autosave-live`).
- **One attempt function, two paths:** `problemOf(body)` holds Save's client-side checks for both
  (Save: `msg` + focus the field; autosave: `short` in the status). `lockProblem({ quiet })`
  doesn't open the booking block for autosave's check.
- **Retry only on the next edit** (or blur, panel, Done, tab hidden): a timer would retry a
  refusal forever. A save asked for while one is out runs after it lands, never alongside.
- **`baseline` is now "last saved"**, so the unsaved guard asks only about edits not yet saved
  *and not on their way* (`inFlight`: a save in flight lands even if the editor is left). Save
  mode is unchanged. Save also sends `baseUpdatedAt` and explains `estimate_changed_elsewhere`.
- **After a save `existing` becomes the reply** (its `updatedAt` is the next base, its surcharge
  snapshot the next prior), and `refreshSurcharges` clears only if no Update to current rates
  was clicked while it was out (`refreshMark`).
- **Holiday reprice:** if loading the list moves the total, the new prices stay on screen for a
  full pause ("Not saved yet: … its prices just changed. They save in a moment.") and then save.
- **T17:** the client is added only when Business Name was *typed in* this session and then left
  (`businessTyped` + `businessLeft`), so an old estimate with an unlinked name never adds one by
  being opened; leaving the field is work in itself even if the pause already saved the text.
- **New estimate's address:** `LSCRouter.rename(path)` replaces the entry with no render, keeps
  the query (`?trip`), rewrites the trail, and reads the old path as the new one until the next
  render (an entry the travel view pushed before the save still says `/projects/new`).
  `handlers.onCreated` / `handlers.onDone` in `estimates.js`. Done for a never-saved estimate
  goes where Cancel went; Back = Done in autosave mode.
- **Undo** is offered only once something saved since opening. It PUTs the payload captured at
  mount (autosave headers, `baseUpdatedAt`), then re-mounts from the reply (the travel view and
  its `?trip` go). The confirm warns about surcharges only when `calc.js`'s `surchargeSnapshot`,
  run on the days it will send against what the server holds now, differs from the snapshot at
  open (a removed-and-restored day, or settings refreshed or dropped since).
- **Delete and Undo hold autosave** (`held`) and wait for the save in flight first. Each mount
  bumps `mountGen`, so a late reply from the last estimate is dropped.
- `LSCApi.post/put(path, body, { headers })` sends extra headers (the API's CORS list has them).

## Decisions made in task 7 (agent's, within the brief)

- **Order of the PUT's refusals:** 404, then `autosave_not_draft`, then
  `estimate_changed_elsewhere`, then validation. The draft check comes first so the editor
  switches to Save instead of asking for a reload.
- **`autosave_not_draft` = any status but `draft`** (sent, accepted, declined, invoiced, paid).
- **`baseUpdatedAt`** is compared to the stored `updated_at` string exactly. Absent or `null` =
  no check (older clients). The 409 carries `updatedAt` (the latest). The editor sends the
  `updatedAt` of its last reply as the next base.
- **The throttle is in memory** (`backup.js`, `seen` per estimate id): an autosave is a PUT to
  `/estimates/:id` with `X-LSC-Autosave: 1`. It snapshots when the estimate has none in the last
  10 min, or the `X-LSC-Session` is new to it; no session header = the window alone. A restart
  costs one extra snapshot. A refused autosave still uses up its slot (harmless).
- **CORS** allows `X-LSC-Autosave` and `X-LSC-Session` (preflight), or Pages couldn't send them.
- For task 8: a fresh `X-LSC-Session` per editor mount (random); `Undo changes since I opened
  this` goes through the autosave path, so on a sent estimate it must use the plain PUT.

**Scratch state (for testing):** the scratch card prices both trip rows (Overhead
`vehicleCostPerKm` 0.9; Transport & Logistics Hrs typed $95; setting the vehicle figure through
`PUT /api/goals` also filled in Capacity defaults). The scratch ABN is now `51 824 753 556` (the
old one failed its checksum and blocked every Settings save). Home base is Marrickville Metro.
`est_43f5777a` day `d_nbk1` (start 08:00) is saved as a routed five-destination Sydney day with
both lines linked, plus the hand-typed "Vehicle — per km" (qty 120) line. A PUT straight to the
API needs `pricingShape` from `GET /api/pricing`.

## Decisions made in task 6 (agent's, within the brief)

- **`trip.unlinked`** (`['km'|'hours']`, days.js parseTrip, stored only when non-empty): the
  kinds the owner unlinked. `syncTripLines` makes no line of an unlinked kind. The server
  doesn't enforce it against `fromTrip` (a linked line wins); the editor keeps them consistent.
- **Unlink** is the linked line's ⋯ → confirm ("It stays at 109 km … Relink to trip puts the
  trip's figure back") → the same line rebuilt ordinary, focus in its qty. **Relink / Link to
  trip** is a quiet button on any ordinary line of a trip kind on a routed day with no linked
  line of that kind ("Relink" when that kind is unlinked). No confirm: it's the explicit action.
  Linking a hand-typed line is how the double-billing note gets resolved now.
- The totals call one line "unlinked: billed as typed": the one unlinked this session
  (`data-trip-unlinked`), else after a reload the last typed line of that kind.
- **Clear trip** is in the view's ⋯ (shown once there's a start; Recalculate only with ≥ 2
  stops). With linked lines: T7's dialog (Cancel / Keep as ordinary lines / Remove, with their
  total); without: Cancel / Clear trip. Then the view is drawn afresh, empty. No Undo.
- One editor dialog for the trip (`#modal-trip`, `tripDialog`), Cancel focused first, Escape
  captured so it doesn't also close the view's menus.
- **Duplicate day copies the trip as it is** (routed for the source's date, so the copy reads
  "Day changed") and keeps its lines linked.
- Summaries: `TripPlanner.summary/summaryText`; stops count destinations only ("5 stops"), km
  rounded to the whole km, time "3 h 27"; "Trip · not routed yet" on the Project page when
  there's no route.
- **Home base** uses `typeahead.js` over `LSCMaps.suggest/place` (no map), one session per
  pick; only a picked place saves. Never on a public route (`clientBusiness` allow-list).

## Decisions made in task 5 (agent's, within the brief)

- **Cell layout by the column's width** (container query on `.trip-cells`, 440px): narrow, the
  chip and actions share a row and the address goes full width under them; wide, one row. The
  stops column is ~340px at both 375 and 800, so the narrow layout is the common one.
- A destination cell: handle (only while there's another destination), chip, address, Change,
  ⋯ (Move up / Move down, only while there's another destination), ×; then, once placed, its
  detail blocks and a footer with **Time on location** and **+ Add details ▾**. START and RETURN
  keep task 3's controls; an empty handle column keeps the chips aligned.
- **Detail blocks with text start closed**, blank ones open; the state is kept per stop for the
  page session (module-level `detailOpen`). Open/close happens in place, no redraw.
- Detail text saves on each keystroke (`emit()`, never re-routes: the route doesn't read it).
  Removing a block with text offers Undo (toast); a blank one goes quietly.
- **Time on location is typed** ("3 h", "1 h 30", "90 min", "1:30"; a bare number is hours up
  to 24, minutes above) and committed on Enter or leaving the field, then typed back
  ("2 h 15"). Unreadable → an inline message, nothing saved. ≤ 24 h. It re-routes (it moves
  departures and is in the stop signature).
- One `moveDest(from, to)` for drag, Alt+↑/↓ (sortable.js) and ⋯; focus stays on the moved
  stop's handle; announced by short name ("Bondi Pavilion moved to stop 3 of 7"). No Undo for a
  move (it's one more move back).
- `paint()` restores focus by `data-f` / `data-act` (caret and an uncommitted time kept), and
  waits while a drag is lifted (a route can land mid-drag).

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

- In the hidden browser pane, scripted `.focus()` fires **no** focus/blur events. Test the blur
  save by dispatching `new FocusEvent('focusout', { bubbles: true })` on the field.
- Headless screenshots of the editor: a reload over a dirty form raises `beforeunload` and hangs
  `page.reload` — `page.on('dialog', d => d.accept())`. The app never reaches `networkidle0`;
  wait for `#ed-bar` instead.

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
