# Build Tasks: Trip Planner, Google Calendar and Editor Autosave

Generated from: [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md), [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md)
(its Data & API appendix is the contract), [`DECISIONS.md`](DECISIONS.md) (T1–T18, G1–G5,
I1–I4, the user's; don't re-ask). Tokens: ui-clarity's [`web/css/tokens.css`](../../web/css/tokens.css)
(Phase 4 skipped).
Date: 8 October 2026

**Build order:** risk first, then each feature as a stage that works on its own:
**A** trip planner (Google Maps, the riskiest unknown, and the most visible) → **B** autosave →
**C** call sheet → **D** Google Calendar → **E** polish, review, deploy.

Tags follow root `CLAUDE.md`. State the tag out loud and pause for the user to switch before
starting. **Frontend** marks anything a person looks at.
- **(frontend: Opus/high)**: UI build.
- **(money: Opus/high)**: computes, stores or prints a price, or `calc.js`.
- **(auth: Opus/high)**: sign-in, sessions, OAuth tokens.
- **(backend: Sonnet/high)**: routes, tests, config that move no price.
- **(deploy: Sonnet/medium)**: infra.

## Ground rules for every task

- **Philosophy: ui-clarity's functionalist, LSC-warm.** The map is Google's standard style (T1b).
  Terracotta (`--color-accent`) marks the pins, the route line and one action per view only. New
  CSS uses `tokens.css` names only, mobile-first (375 → 768 → 1100), with 44px targets below 768.
- **Gate: `cd server && npm test`.** `calc.js` and `documents.js` stay byte-identical across
  `server/src` and `web/js`.
- **Verify in the browser** against `api-scratch` + the `web` server on **localhost:5173** (the only
  local origin the browser key allows) at 1280, 800 and 375. Cache-bust the web JS first (memory:
  preview stale code). Real clicks may not reach the pane: dispatch `.click()` and poll (memory).
- **Keys never in tracked files.** Locally `web/js/config.js` (gitignored) gets
  `window.LSC_MAPS_KEY` (+ `LSC_MAPS_ID`) by hand from `.credentials.local.md`. Server keys go in
  `server/.env` (gitignored).
- **Every Google call goes through one module** (`web/js/maps.js` in the browser, a
  `server/src/google.js` on the NAS using plain `fetch`, no new npm dependency). That keeps billing,
  error handling and a future provider swap in one place.
- **Public routes are allow-lists** and never carry prices (CLAUDE.md, `public.js`).
- **Branch `trip-planner` off `ui-clarity`.** No pushes, no deploys until task 20, and ask first.
- When a task finishes: tick it, add the commit and a one-line outcome, and update `HANDOVER.md`
  with the exact next item. No build logs.

## Stage A: Trip planner

- [x] **1. Trip storage and the km/hours rule** *(money: Opus/high)*: **Done `fc331dc`.** v16, `parseTrip`, `applyTripLines`, `tripLineQty`/`tripKindOf`/`tripRows`; 593 tests pass. Original spec: Schema **v16** (additive):
  `production_days.trip_json`, `estimates.call_sheet_token` / `call_sheet_on`,
  `google_account`, `google_event_sync`, `static_maps` (IA appendix). `days.js` reads, validates
  (`trip_invalid`, `trip_too_many_stops`, `trip_text_too_long`; RETURN mirrors START) and writes
  `trip`. `calc.js` (both copies) gains `tripLineQty(trip, 'km'|'hours')` (ceil km; minutes →
  ceil to 0.25 h) and `tripRows(pricing)` (first `perKm` row; first own-time row). On every
  estimate write the server sets each `fromTrip` line's qty from its day's trip, and strips
  `fromTrip` from a line whose day has none. Done when tests cover: rounding edges (0, 0.1 km,
  14/15/16 min), the derived qty overriding a tampered one, the unpriced/missing-row cases, the
  upgrade from v15, and the drift test. _New: migration, calc functions. Modifies: `days.js`,
  `routes/estimates.js`, `estimate.js`._

- [x] **2. Maps loader and the travel view shell** *(frontend: Opus/high)*: **Done `7d83047`.** Map ID created; Google accepted the key (billing on); verified at 1280/800/375. Original spec: `web/js/maps.js` loads
  Google Maps JS once from `LSC_MAPS_KEY` (`places`, `routes`, `marker`, `geocoding`) and reports a
  clear failure. **Define travel** is a fixed footer in the day service menu. Clicking it sets
  `?trip=<dayId>` (I1) and `BookingBlock` switches to an `.is-trip` state that hides both columns
  and shows the travel view across the panel body: header (Back, "Travel · Day 2 · Thu 29 Oct",
  ⋯), the map pane (standard style, +/−, drag) on the left, and an empty Destinations column with
  **+ Add start location** on the right. Back and browser Back both drop `?trip` and return to the
  day's open menu with focus on Define travel. A reload reopens the view, and an unknown day id is
  dropped. Before building, **ask the user to approve creating a default-style Map ID** in the
  console (for Advanced Markers). This task also proves the key and billing work, so stop and
  report if Google refuses. `deploy-pages.yml` writes `LSC_MAPS_KEY`/`LSC_MAPS_ID` into
  `config.js` from secrets (the secrets themselves are task 20). Done when the map shows at 1280,
  800 and 375 (stacked), and Back/reload behave. _New: `maps.js`, `views/trip-planner.js`.
  Modifies: `booking-block.js` (menu host → `.is-trip`), `estimate-editor.js` (menu footer,
  route query), `router` use, `deploy-pages.yml`, `config.example.js`._

- [x] **3. Placing stops** *(frontend: Opus/high)*: **Done `7df0e05`.** Built by mouse and keyboard, saved, reloaded; 1280/800/375. Original spec: START, destination and RETURN cells per the
  brief. The search bar appears above the map while a cell waits, with Places Autocomplete
  suggestions (AU-biased, a session token per search), Search/Enter for the best match, a pending
  hollow pin with the address and "Use this location", and a click anywhere for a reverse-geocoded
  pending pin; Escape cancels. **+ Destination** (translucent, always after a start, inserting
  before RETURN), **Return trip** (translucent once there's a start and one destination; RETURN
  locked and removable), and × remove with a "Stop removed · Undo" toast. Numbered terracotta
  Advanced Markers (S, 1…n, R) mirror the list. Home base appears as the first suggestion when set
  (it degrades to nothing until task 6). The trip lives in the day payload (`days[].trip`) and
  saves with Save for now. Done when a three-stop round trip can be built by mouse **and** by
  keyboard alone (search only), and survives save and reload. Covers: empty, pending, placed,
  search failure, no results, 23-destination cap. _Reuses: `typeahead.js` pattern, `toast.js`.
  Modifies: `trip-planner.js`, `maps.js`._ _Depends on: 1, 2._

- [x] **4. Routing, legs, totals and the linked lines** *(money: Opus/high, frontend)*: **Done `a2f040f`.** Routes REST per leg with traffic, linked FROM TRIP lines, stale/failure states; editor and server quantities agree. Original spec: Any stop
  change asks the Routes API for the whole trip, departing at the day's date + start time with
  traffic (T5), each leg leaving after the previous stop's time on location. With no date or time
  it's traffic-unaware and says so. It stores legs, totals, the polyline and `routedFor`/`routedAt`,
  and redraws from the stored polyline on open (no API call, T6). **Show trip details** toggles
  the `— 42 km · 48 min —` leg lines, with clock times when there's a start time; the choice is
  remembered per browser. The **Trip totals** block shows total km and drive time, plus the two
  lines with their prices. It creates or updates the day's per-km and own-time hours lines with
  `fromTrip` via `tripLineQty`. In the editor those lines show the **FROM TRIP** chip, a
  read-only qty and **Edit trip** (→ `?trip=`). The stale state: "Day changed. Drive times may
  differ." + **Recalculate** (also in ⋯). Routing in progress greys the old figures; a failure
  keeps the last good figures + Try again, and never writes a half result. A polite live region
  announces "Route updated: 186 km, 2 hours 40". Done when the editor total matches the Rate Card
  price × the rounded quantities, and the server's derived qty agrees after save. _Modifies:
  `trip-planner.js`, `maps.js`, `estimate-editor.js` (`buildTravelRow`, line state)._ _Depends
  on: 3._

- [x] **5. Destination details, time on location and reordering** *(frontend: Opus/high)*: **Done `5f2c1d1`.** Details menu + collapsible blocks, time on location re-routes, drag (mouse and touch) / Alt+arrows / ⋯ Move up/down. Original spec:
  **+ Add details ▾** (`menu.js`) with Capture details / Location description / Access details. Each
  adds a titled textarea once (a used item leaves the menu), collapsible from its title row with a
  one-line excerpt when closed and remove in its ⋯. **Time on location** is a duration field that
  re-routes (T11). Destinations drag by a handle (`sortable.js`) between fixed START and RETURN,
  with Move up/down in each cell's ⋯ and announcements ("Bondi Pavilion moved to stop 2 of 4").
  A reorder re-routes. Done when a five-stop day stays scannable with details collapsed, and
  reorder works by mouse, touch (375) and keyboard. _Reuses: `menu.js`, `sortable.js`. Modifies:
  `trip-planner.js`._ _Depends on: 4._

- [x] **6. Trip lifecycle around the day, and Home base** *(frontend: Opus/high, money for
  unlink/clear)*: **Done `5c0563f`.** `trip.unlinked`, Unlink/Relink/Link, Clear trip (both answers), card + menu + Project page summaries, Duplicate copies trip and lines, Home base. Original spec: The travel line's ⋯ gets **Unlink from trip** (confirm → `fromTrip` dropped, qty
  editable, the totals note "billed as typed") and **Relink to trip**. ⋯ → **Clear trip** with the
  "Also remove the 2 travel lines it added? ($X)" dialog (Remove / Keep as ordinary lines /
  Cancel, T7). The day card shows "Trip · 4 stops · 186 km · 2 h 40" (it opens `?trip=`). The
  menu footer reads "Edit travel · 186 km". **Duplicate day** copies the trip and its linked
  lines. Removing a day removes its trip. The Project page's Production days row shows "Trip ·
  186 km". **Settings → Business → Home base address**: the same search combobox (no map), storing
  `{address, lat, lng, placeId}`, and offered first by "+ Add start location". Done when unlink,
  relink, clear (both answers), duplicate and remove all leave the prices and server-derived
  quantities consistent. _Modifies: `estimate-editor.js`, `booking-block.js`, `project-folder.js`,
  `settings.js`, `trip-planner.js`._ _Depends on: 4._

## Stage B: Editor autosave

- [x] **7. Autosave on the server** *(backend: Sonnet/high)*: **Done `ff61ec7`.** `baseUpdatedAt` 409, draft-only autosave 409, snapshot throttle, CORS headers; 600 tests pass. Original spec: `PUT /api/estimates/:id` accepts
  `baseUpdatedAt` → `409 estimate_changed_elsewhere` on mismatch (all writes). Header
  `X-LSC-Autosave: 1` → `409 autosave_not_draft` for sent or accepted estimates. `preWriteBackup`
  throttle (I2): an autosave snapshots on the first request with a new `X-LSC-Session`, then at
  most once per 10 minutes per estimate. Every other write is unchanged. Done when the tests cover
  the conflict, the draft-only refusal, and the throttle (fake clock), and the existing backup tests
  still pass. _Modifies: `backup.js`, `app.js`, `routes/estimates.js`._

- [x] **8. Autosave in the editor** *(frontend: Opus/high, money: it stores prices)*: **Done `8f92a09`.** Status + Done for drafts, Save for sent; new estimate saves and renames its address; conflict pauses with Reload; Undo restores days, trips and lines. Original spec:
  `web/js/autosave.js` (debounce 1.5 s, flush on blur, panel open and Done, one request in flight,
  coalescing). The sticky bar shows the status (Saving… / Saved 2:41 pm / Not saved: reason →
  field link / Not saved yet: add a project name and UPID) and **Done** for unsent estimates; sent
  and accepted keep **Save** and the resend dialog (T14). A new estimate POSTs once name + UPID
  are valid, then the route **replaces** to `#/projects/<id>/estimate` without a re-render. The
  client list is added to only after leaving Business Name (T17). The holiday list loads at mount
  when any day is dated, and a reprice shows before the save. `estimate_changed_elsewhere` →
  "Changed in another tab or device · Reload", with autosave paused. ⋯ **Undo changes since I
  opened this** PUTs the payload captured at mount after a confirm, then re-mounts. The unsaved
  guard warns only for a pending or failed save. The trip planner now saves through this. Done
  when: a new estimate goes from blank to saved without a click; a refused save names its field; two
  tabs can't overwrite each other; Undo restores days, trips and lines; a sent estimate behaves
  exactly as today. _New: `autosave.js`. Modifies: `estimate-editor.js` (bar, `save()`,
  `saved()`, `refused()`), `unsaved.js` use, `app.js` (new-estimate route replace)._ _Depends on:
  7._

## Stage C: Call sheet

- [ ] **9. Call sheet data, links and the static map** *(backend: Sonnet/high)*: The
  `callSheetView` allow-list (IA appendix). `server/src/google.js` → Maps Static with
  `GOOGLE_MAPS_SERVER_KEY` (path from the polyline, numbered markers), cached in `static_maps` by
  hash, embedded as a data URI. Owner `GET /api/estimates/:id/call-sheet`, `POST …/call-sheet/link
  {on}`; public `GET /public/call-sheets/:token` (link off or unknown → the inactive state). A
  **leak test** beside `test-public.js` proves no price, rate, client contact or internal figure
  leaves, and that the server key never appears in any response. Done when the tests pass with the
  Static call mocked. _New: `google.js`, `callSheetView`. Modifies: `public.js`,
  `routes/public.js`, `routes/estimates.js`._ _Depends on: 1._

- [ ] **10. Call sheet page, public page and PDF** *(frontend: Opus/high)*: One shared renderer
  `web/js/call-sheet.js`, loaded by `index.html` and `c/index.html`, for the layout in IA
  "Content Hierarchy → Call sheet": header, day sections, map image, the schedule with legs and
  depart/arrive times, the details in full, Open in Google Maps, footer. In-app at
  `…/estimate[/<id>]/call-sheet` (dark app shell, with Download PDF, Share…, Edit trips). Public
  at `c/#s/<token>` (light, lsccreative.studio colours, "Updated …", Download PDF). The PDF
  template in `pdf.js` (A4, a day per page or more), with owner and public `/pdf` routes
  (rate-limited). Done when all three show the same content for the review dataset with a two-day
  trip, at 1280 and 375, and the PDF prints cleanly. _New: `call-sheet.js`, PDF template.
  Modifies: `app.js` (route), `web/c/c.js` (`linkOf` gains `s`), `pdf.js`, routes._ _Depends on:
  9._

- [ ] **11. Call sheet on the Project page, Share and email** *(frontend: Opus/high)*: A **Call
  sheet** row in the Documents panel after its estimate's row (once any day has a trip):
  "3 days · 412 km", a "Link on" chip, primary **Open**, Documents ▾ Download PDF, Actions ▾
  Share… / Copy link / Turn off link. The **Share dialog** (`modal.js`): Turn on link, Copy link,
  Email to one or more addresses with an optional note (`POST …/call-sheet/email` via Resend,
  reusing SendPanel's To field). Turn off link keeps the token, and turning it back on reuses it.
  Done when share, copy, email (`api-scratch-mail`), turn off and back on all work, and the public
  page reflects each. _Reuses: `menu.js`, `modal.js`, SendPanel's recipient field, `mail.js`.
  Modifies: `project-folder.js`, `mail.js`, routes._ _Depends on: 10._

## Stage D: Google Calendar

The user must first create the OAuth client and put its ID and secret in `.credentials.local.md`
(HANDOVER). Copy them into `server/.env` locally. Test the OAuth flow against
`http://localhost:8080/api/google/oauth/callback`.

- [ ] **12. Connect and disconnect Google Calendar** *(auth: Opus/high, frontend)*:
  `/api/google/oauth/start` (session-gated, HMAC'd `state`, `access_type=offline`,
  `prompt=consent`, scopes `calendar.events` + `calendar.calendarlist.readonly`) and
  `/api/google/oauth/callback` (state check, code exchange, account email, calendar list, plain
  refresh token per I3, redirect to `${APP_ORIGIN}/#/settings/calendar?connected=1|error=`).
  Access-token refresh lives in `google.js`. `GET /api/google/status`, `POST
  /api/google/disconnect {removeEvents}`. **Settings → Google Calendar** (the new section between
  Email and Card payments): connection state, Connect/Disconnect (dialog with "Also remove the app's
  events"), the calendar toggles, the writing explainer, the sync status placeholder. Done when
  connect → toggles → disconnect works end to end locally with the user's real account (the user
  clicks Google's consent themselves), and the tests cover the state check and that no token leaves
  the NAS. _New: `routes/google.js`, the Settings section. Modifies: `google.js`, `settings.js`,
  `config.js` (env)._ _Depends on: 1._

- [ ] **13. Google events on the calendar** *(frontend: Opus/high)*: `GET /api/calendar` merges
  `google` events (switched-on calendars, minus `lscDayId`, cached ~5 min) and `googleState`.
  `PUT /api/google/calendars`. `calendar.js` gains `setGoogle()`, faded tiles with a colour dot, an
  all-day band, read-only popovers and entries in the under-grid list. `menu.js` gains checkbox
  items. **Calendars ▾** in the calendar header on Home and the editor (toggles, Refresh, or
  "Connect Google Calendar" when not connected). "Google Calendar unavailable" when it fails. Done
  when the user's real events appear on both calendars, toggles change them at once, and keyboard
  and screen readers reach them through the list. _Modifies: `routes/calendar.js`, `google.js`,
  `calendar.js`, `menu.js`, `home.js`, `booking-block.js`._ _Depends on: 12._

- [ ] **14. Writing bookings to Google** *(backend: Sonnet/high, with a small frontend status)*:
  The sync engine in `google.js`: after any commit that changes a dated confirmed or pencilled
  day (IA flow 9's trigger list, **including the client's accept on `c/#e/` and Mark accepted**),
  queue the estimate (5 s debounce), diff by day id against `google_event_sync`, and create, patch
  or delete the primary-calendar event with the G4/G5 payload (title, "Pencil ·" + tentative,
  Sydney times or all-day, the first destination as location, the description with items, trip
  summary, call sheet link and project link, `lscDayId`; never prices). Retries back off 1/5/30
  min, then on demand. `POST /api/google/sync {all}` drives Retry and **Sync existing bookings**.
  Status shows in Settings ("2 days not synced · Retry") and as a small mark on the day card. Done
  when tests with a mocked Google prove create, move, re-time, pencil→confirm, remove, decline,
  accept-from-client and retry; then one live check on the user's calendar (ask first; use a test
  project and clean up). _Modifies: `google.js`, `routes/estimates.js`, `routes/public.js`
  (accept), `routes/projects.js`, `settings.js`, `booking-block.js`._ _Depends on: 12._

## Stage E: Polish, review, deploy

- [ ] **15. Responsive and accessibility pass** *(frontend: Opus/high)*: The travel view, Share
  dialog, call sheet pages, Settings → Google Calendar and Calendars ▾ at 375/768/1100+. The checks
  from the brief: 3:1 on the translucent buttons' label and border, 4.5:1 text; full keyboard paths
  (search combobox, reorder, disclosure, menus); live regions (route updates, Not saved states
  only); drag alternatives; `prefers-reduced-motion`; focus return on Back and dialogs; 44px
  targets. Fix what fails.

- [ ] **16. Code review** *(Opus/high)*: `/code-review high` on the branch. Fix the findings, with
  extra scrutiny on money (task 1/4/6 derivations), the public allow-list, OAuth state and token
  handling, and the sync engine's idempotency.

- [ ] **17. Design review** *(frontend: Opus/high)*: `/design-review` against the brief,
  screenshots in `screenshots/`. Fix the must-fix items.

- [ ] **18. Live Google check** *(frontend: Opus/high)*: With the user present: plan a real
  trip, compare its km and time with Google Maps, connect the real calendar, confirm a test day,
  see the event, move it, remove it. Record the result in HANDOVER.

- [ ] **19. Update docs** *(backend: Sonnet/high)*: `DEPLOYMENT.md` (new env:
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_MAPS_SERVER_KEY`, `APP_ORIGIN`;
  the Pages secrets `LSC_MAPS_KEY`, `LSC_MAPS_ID`), `web/README.md` (config.js keys), and the
  CLAUDE.md track row.

- [ ] **20. Deploy** *(deploy: Sonnet/medium)*: **Ask first.** It needs ui-clarity and `main` merged in
  as they stand (fetch + diff `origin/main`; memory: deploy base check), the NAS online, and v15+ in
  the shipped `server/`. Add the GitHub secrets (the user, or the agent with permission). Set the
  NAS env. **NAS (v16) first, then Pages.** After deploy: connect Google Calendar on the live site
  (the redirect URI `https://billing.lsccreative.studio/api/google/oauth/callback` is already
  registered) and run Sync existing bookings.
