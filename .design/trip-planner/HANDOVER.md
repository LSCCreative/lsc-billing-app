# Handover: Trip Planner, Google Calendar and Editor Autosave

Read this, then [`DECISIONS.md`](DECISIONS.md) (T1–T18, G1–G5, I1–I4, the user's; don't re-ask), then
[`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).

**Next: task 14, Sonnet, effort high, with a small frontend part** (writing bookings to Google,
the sync engine; its live check on the user's calendar needs their OK, a test project and a
clean-up). Stages A, B and C (tasks 1–11) and tasks 12–13 are done. The scratch DB is connected to
the user's real Google account (all four calendars on).

## State as of 2026-10-11 (task 13)

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
- [x] **Task 9** call sheet data, links and the static map, `e9b7d0b`. 617 server tests pass
  (`test-call-sheet.js`, 17). Verified: the unit tests with Maps Static stubbed, and **one live
  Static request** with the server key (`google.fetchStaticMap`): numbered pins, a terracotta S,
  the route line, 142 KB PNG (a throwaway script in the session scratchpad; no key printed).
  No schema change (v16 already had the token, flag and `static_maps`).
- [x] **Task 10** call sheet page, public page and PDF, `68c9b69`. Built by Sonnet, then reviewed
  and fixed by Opus. 633 server tests pass (`test-call-sheet-page.js`, 14; PDF routes in
  `test-call-sheet.js`). Verified on scratch `est_705f805a` (two days, real Static images): public
  and app pages at 1280/800/375 (headless, no overflow), Back, Edit trips (`?trip=cs10_a`), both
  Download PDF buttons, the dead-link page, an unknown estimate id; owner and public PDFs
  byte-identical, A4, 3 pages.
- [x] **Task 11** call sheet row, Share and email, `ba05c05`. **Stage C is done.** 638 server tests
  pass (`test-call-sheet-share.js`, 5). Verified in the pane on scratch `est_705f805a` against
  `api-scratch-mail`: the row ("2 days · 141 km", Link on/off/Not shared), Actions ▾ by keyboard,
  Share… → Turn on link (same token back, public 200) → chips (typed, pasted list, "Name <a@b>",
  a bad entry kept with its message, a repeat dropped) → note → Send: two separate stub emails,
  toast "Call sheet sent to 2 people.", focus back on the row's Actions, the activity line; a
  stubbed partial failure (refused addresses stay as chips, with why); Turn off in the dialog
  (public 404) and on again (same link, chips kept); Copy link both ways (stubbed clipboard, and
  the browser's refusal → link selected); email not set up (note, Send disabled); Escape; the row's
  Turn off → toast Undo → on; the row's Call sheet PDF (671 KB); Open; the page's Share… and its
  link line. Shots at 1280 and 375 (pane), no overflow, 44px targets below 600.
- [x] **Task 12** connect and disconnect Google Calendar, `99c4b1e`. 663 server tests pass
  (`test-google-oauth.js`, 25). Verified with the user's real account on localhost (consent →
  4 calendars → toggles saved, Refresh, Disconnect revoked, reconnect), and every state at
  1280/800/375 (headless, no overflow) against `api-scratch-google`, a pretend Google.
- [x] **Task 13** Google events on the calendar, `COMMIT13`. 678 server tests pass
  (`test-google-events.js`, 15). Verified with the user's real account on localhost
  (`api-scratch-mail`): events on Home month and week and the editor's calendar, Calendars ▾ by
  keyboard (toggle off/on redraws at once, menu stays open, Esc back to the button), Refresh,
  the pop-up from a tile (month, week, editor: no add-day dialog), the list entries; the
  unavailable / reconnect / partial lines, not connected → Settings, and a refused toggle
  (reverted + toast) by standing in for the reply in the page. 375 (dots, sheet with Done),
  800, 1280: no overflow.
- [ ] **Next: task 14**, writing bookings to Google. *Sonnet/high, small frontend part.*

## Decisions made in task 13 (agent's, within the brief)

- **Only the calendar on show asks Google:** `GET /api/calendar?google=1` (Home's range fetches,
  the editor's month on show and Calendars ▾). The editor's clash checks (`ensureCovered`) and
  Coming up don't send it, so they never wait on Google. The reply then carries `google`,
  `googleState` (`off`/`ok`/`unavailable`/`reconnect`: **reconnect added**, the IA had three),
  `googleCalendars` (the toggle list, so the menu needs no second request) and `googleMissing`
  (calendars that failed while others didn't). `refresh=1` skips the cache. Google failing is
  never a failed request. `PUT /api/google/calendars` was already there from task 12.
- **Cache** (`google.js calendarEvents`): in memory, per account email + calendar + range, 5 min;
  failures aren't cached; cleared on disconnect. Switching a calendar on asks for that one only.
  One token renewal up front, not one per calendar.
- **Sydney wall-clock on the NAS:** each event is `{ id, calendarId, calendar, colour, title,
  date, endDate, startTime, endTime, allDay }`, dates inclusive (Google's all-day end is
  exclusive; a timed event ending at midnight ends that day). `id` is a hash of calendar + event
  (one invite sits in several calendars). Left out: `lscDayId` (G4), cancelled, declined by
  the owner, `workingLocation`. An untitled event is "(No title)", or "Busy" on a busy-times-only
  calendar. Colour = the calendar's, never the event's own.
- **Month view:** timed events are faded tiles after the bookings (they share the 3-tile cap and
  "+N more"); all-day and multi-day events are bands under the date (2, then "+N all day"),
  capped on their real ends; in dots mode a short dash in the calendar's colour. The date's
  accessible name adds "; Google Calendar: <title>, <time>…". The list under the grid lists them
  after bookings, gear and On hire as **plain text, not buttons** (nothing to do with them, G3);
  "Nothing booked." still shows when only Google has the date.
- **Week view (home-week.js, not in the task's file list):** Google tiles pack beside bookings at
  their times; all-day/multi-day ones go in the top row (labelled "All day" when any are there);
  tiles are buttons opening the pop-up; the list layout lists them per date.
- **The pop-up** (`LSCCalendar.openGooglePop`): calendar (dot + name), title, date and time, "From
  Google Calendar. Change it there." Non-modal: Esc (focus back to the date or tile), ×, a click
  outside, Tab away or a route change closes it. A click on a Google tile never runs the date's
  own action (the editor's add-day dialog).
- **Calendars ▾** (`web/js/gcal-menu.js`, `LSCGcalMenu.attach(cal.slots(), { reload })`): a
  bordered bar button with the on-calendars' colour dots. Checkbox items save at once (PUTs in
  order; a reply mid-save keeps unsaved ticks), then Refresh (busy state, then a toast "Google
  Calendar refreshed.") and Manage in Settings. Not connected: one item, Connect Google Calendar;
  refused token: Reconnect Google Calendar. Both go to `#/settings/calendar`.
- **menu.js checkbox items:** `{ text, checked, swatch }` → `menuitemcheckbox`; choosing flips it
  and calls `onSelect(item, checked)` with the menu left open; the phone sheet's last row says
  Done. `open()` menus only. (ui-clarity task 14 seam: small, self-contained.)
- **Quiet line** `.cal-gnote` under the bar: "Google Calendar unavailable. Your bookings are all
  here. Try again", "…needs reconnecting… Reconnect", "Couldn’t load X from Google Calendar. Try
  again".
- **Dev:** `dev-stub-google.js` now answers events (a made-up week, repeated; one tagged
  `lscDayId`), and `STUB_GOOGLE_FAIL_CAL=<id>` fails one calendar.

## Decisions made in task 12 (agent's, within the brief)

- **Routes** (`server/src/routes/google.js`). `GET /api/google/oauth/start` and `…/callback` are
  browser navigations mounted **before** the session gate: they read the session themselves and
  always answer with a redirect to `${appOrigin}#/settings/calendar?connected=1` or
  `?error=signed_out|not_configured|access_denied|oauth_failed|scopes`. After the gate:
  `GET /api/google/status` → `{ configured, connected, email, connectedAt, calendars:[{id, summary,
  colour, primary, role, on}], problem: 'reconnect'|null, sync:{pending, errors} }` (an
  allow-list; a test checks its keys), `PUT /api/google/calendars {on:[ids]}`,
  `POST /api/google/calendars/refresh` (the list again, toggles kept; **added**, the IA had none:
  shared calendars change), `POST /api/google/disconnect {removeEvents}` →
  `{ disconnected, revoked, removed, notRemoved }`. Errors: `google_not_connected`,
  `google_reconnect` (409), `google_not_configured`, `google_unavailable` (502).
- **State** = `base64url(json{n, t, s}).hmac` keyed by SESSION_SECRET; refused if forged, > 10 min
  old, used before (in-memory nonce set) or from another session (`s` = a hash of the session id).
  Checked before Google's `error` param, and before any code swap.
- **No openid/email scope:** the account's address is the primary calendar's id.
- **Consent can untick a permission:** both scopes must come back, else `error=scopes`, nothing
  stored. No refresh token back → `oauth_failed`.
- **Never revoke on reconnect:** Google's revoke kills the whole grant, new token included. Only
  Disconnect revokes (after deleting events, while the token still works).
- **Same account reconnecting** (while still connected) keeps its toggles, `connected_at` and
  `google_event_sync` rows; **another account** clears the sync rows. **Disconnect deletes the
  row**, so toggles start afresh on the next connect (primary on). Event rows survive a disconnect
  unless their event was removed, so a reconnect can still find them.
- **Token renewal** in `google.js` (`accessToken`, 60 s margin; `calendarApi` retries a 401 once
  with a forced renewal). `invalid_grant`/refused renewal → `GoogleError('reconnect')` and an
  in-memory flag that `status.problem` reports (a restart forgets it until the next call).
  `GoogleError` codes are ours; Google's reply bodies are never passed on.
- **Calendar list:** every page (`nextPageToken`, ≤ 10 pages), deleted ones dropped, colour kept only
  if `#rrggbb`. Order: primary, then own, then others A–Z. New calendars start off; the primary is on
  only on a first connect. Roles shown as "Your main calendar", "Yours", "Shared with you · can
  edit / view only / busy times only", "Subscribed" (`@group.v.calendar.google.com`).
- **Config:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, optional
  `GOOGLE_OAUTH_REDIRECT_URI` (unset = this API's own address as the request reached it, so set it
  on the NAS if the proxy doesn't pass the scheme/host), `APP_ORIGIN` (falls back to `APP_URL`).
  createApp opts for tests: `googleOAuth`, `googleFetch`, `googleNow`, `appOrigin`.
- **Settings → Google Calendar** (`GcalPanel` in `settings.js`, `.gcal-*` in `settings.css`):
  status chip; Connect (plain `btn`: terracotta stays Save settings'); connected = "As … since …",
  Disconnect… (the settings Confirm, which gained an `option` checkbox: "Also remove the app's
  events"), the toggle list (real checkboxes with `role="switch"`, the whole row is the label), Refresh
  the list, the writing explainer, and **"Not writing yet"**, the placeholder task 14 replaces
  (`#set-gcal-sync`, `.gcal-sync-hint`). Each toggle PUTs at once; a change while one is out goes
  after it; a failure reverts to the server's copy. Arrival messages show once, then the query is
  dropped with `LSCRouter.mark` (replace). `SettingsView.show` now takes `route.query`.
- **Dev:** `server/scripts/dev-stub-google.js` (launch `api-scratch-google`): Connect goes to a
  local pretend consent page (Allow / one permission unticked / Cancel); a refresh token other than
  the stub's is refused (edit `google_account` to see Reconnect). The real flow is
  `api-scratch-mail` with the client in `server/.env`.

## Decisions made in task 11 (agent's, within the brief)

- **Email goes now, one per person, not through the outbox.** `POST
  /api/estimates/:id/call-sheet/email {to:[..], note}` sends to each address in turn (no one sees
  the others) and replies `{ sent, failed:[{to,message}] }` (200 even if the provider refused some,
  as Settings' test email does). Refused: `link_off` (the email *is* the link), `not_configured`,
  `no_trips`, `no_app_url`, `bad_recipient` (names the bad one), `too_many_recipients` (> 20),
  `note_invalid` (> 2,000). Addresses trimmed, repeats dropped case-blind.
  `mail.js callSheetEmail`: subject "Call sheet · UPID · Project", the days in words ("Tue 3 Nov and
  1 day still to be dated"), "the link always shows the latest schedule", the note as text, button
  "View the call sheet". The plain shell (ui-clarity D2 branding hasn't landed).
- **Activity:** `call_sheet_sent {to, estimateId}` in the folder's log only (not Home's kinds), only
  when something went: "Call sheet emailed to a and b" / "to a and 3 others". Link on/off isn't
  logged (it would reorder the Projects list for no job change).
- **Folder reply:** each estimate carries `callSheet: { days, km, on, token } | null`
  (`routes/projects.js callSheetState`, the sheet's own `summary.km` rule). Owner-only, like
  `publicToken`.
- **The row** (after its estimate's): "Call sheet" (+ " — name" with several estimates), chip
  **Link on** / **Link off** (token kept) / **Not shared**, "2 days · 141 km", primary **Open**,
  Actions ▾ Share… / Copy link / Turn off link (danger, when on), Documents ▾ **Call sheet PDF**
  ("No prices"). **Turn off link has no dialog**: it's reversible, so the toast offers **Undo**.
- **The dialog** `web/js/call-sheet-share.js` (`CallSheetShare`, overlay `#modal-share`): the send
  panel's frame (`.send-panel`, full screen on a phone). Link section (Off: one sentence + **Turn
  on link**, the one terracotta action; On: mono link field, Copy link, Turn off link), then
  "Email it" only while on (To as chips, Note, **Send** terracotta). To reuses
  `SendPanel.isEmail` and `SendPanel.copyText` (both newly exported). A refused copy selects the
  link in the field and says so; the row's Copy link opens the dialog that way.
- **Nothing behind the dialog redraws while it's open:** `onClose({link, changed})` →
  the folder's quiet `refresh(true)` (focus stays on the row's menu button); the page redraws its
  `#csp-link` line only.
- **Public page wording unchanged:** the IA's "has been turned off" vs "isn't active" was settled in
  task 10 as one message for off and unknown (the page can't tell them apart).

## Decisions made in task 10 (agent's, within the brief)

- **One markup function, three skins.** `server/src/call-sheet.js` `markup(callSheet)` is the whole
  document; `web/js/call-sheet.js` is a byte-identical copy (drift test), loaded as a plain script by
  `index.html` and `c/index.html` (global `LSCCallSheet`). The PDF (`pdf.js buildCallSheetHtml`)
  wraps the same string, so "the three show the same content" holds by construction. Skins:
  `web/css/call-sheet.css` (tokens only, so the app's dark and `c/`'s light palette both theme it)
  and `CALL_SHEET_STYLE` in `pdf.js` (Arial, like the other PDFs).
- **The renderer distrusts its input:** every string escaped; a stop link must match
  `https://www.google.com/maps/…`, the image `data:image/png;base64,…`, or it's left out.
- **Layout:** header (Call sheet, project as h1, For / Reference / Covers / Updated in Sydney
  time); a section per day (date as h2, "5 stops · Starts 7:30am · 109 km · 3 h 27 min driving"),
  the map, then the stops on a dotted rail with the map's pins (terracotta S, numbered discs, an
  outlined R; 10+ say "· map pin A"), each with its inbound "Drive 18 km · 49 min",
  Depart/Arrive/Leave, time on location, Open in Google Maps and the details in full; footer with the
  business's name, email and phone. Not routed = stops with no times or legs.
- **PDF:** letterhead "LSC CREATIVE. / CALL SHEET <UPID>", a page break before each day after the
  first, no stop split, map capped at 66 mm high, a print-only "project · UPID" line above each later
  day (`.cs-day-for`, hidden on screen), one-line footer, body bottom padding dropped (it made a
  blank last page). Filename `Call sheet - UPID - Project.pdf`.
- **Routes:** owner `GET /api/estimates/:id/call-sheet/pdf` (session; not kept in exportDir);
  public `GET /public/call-sheets/:token/pdf` (pdf rate limit; off/unknown = the same 404, renderer
  not started; no Chromium = 503 `pdf_unavailable`). `registerEstimateRoutes` takes `render`
  (`opts.renderPdf`) for tests.
- **In-app page** `views/call-sheet-page.js` at `…/estimate[/<eid>]/call-sheet` (estimates.js):
  ← Back (the project), Edit trips (the editor at `?trip=<editDay>`, or plain with no trips),
  Download PDF (the one terracotta action, hidden with no trips), errors inline.
  Share… and the link line were added in task 11; the Project page's row is the way in.
- **Public page** `c/#s/<token>`: masthead, Download PDF under it, the document. A 404 reads "This
  call sheet link isn't active … Ask LSC Creative for a new one." No `?owner=1` (only quotes log
  opens).
- **Seen, not changed:** `summary.km` (the "Covers" figure) sums every day's stored totals,
  including a day shown unrouted; task 11's row should use the same figure.

## Decisions made in task 9 (agent's, within the brief)

- **What it is.** `GET /api/estimates/:id/call-sheet` → `{ callSheet, link: {on, token, url},
  editDay }`; `POST …/call-sheet/link {on}` → `{ token, on, url }`; public `GET
  /public/call-sheets/:token` → `{ callSheet }`. The owner's `callSheet` and the public one are the
  same object (a test holds them equal). `url` is `${APP_URL}c/#s/<token>`, or null with no APP_URL.
  **No PDF and no email routes yet**: they are tasks 10 and 11.
- **`callSheetView` (public.js) is the allow-list**; `test-call-sheet.js` asserts its keys level by
  level, so a new field must be added there on purpose. Shape: `{ kind:'call-sheet', upid, name,
  client:{businessName}, business:{name,email,phone}, updatedAt, summary:{days,km}, days:[{ date,
  startTime, routed, totals:{km,minutes}, legs:[{km,minutes,departAt,arriveAt}], stops:[{ role,
  n, mapLabel, address, lat, lng, mapsUrl, arriveAt, leaveAt, + for destinations minutesOnSite,
  details }], map }] }`. No ids at all (day, stop, estimate). `details` holds only the fields with
  text. `n` numbers destinations 1…; START and RETURN have `n: null`.
- **`arriveAt` / `leaveAt` are on each stop** (arrive = the leg in, leave = the leg out; the stored
  times already include the time on location), and `legs` gives the "— 42 km · 48 min —" lines.
  The renderer needs no arithmetic.
- **`routed: false`** when the stored legs don't number stops − 1 (a re-route failed): `legs: []`
  and no times, the stops still listed. The server can't see the browser's stop signature
  (`routedFor.stops`), so a trip whose stops changed *without* changing the leg count still shows
  its old times; the owner sees that in the editor ("Recalculate"). Task 10 may say nothing more.
- **Days shown** = days whose trip has ≥ 1 destination (a start alone is no trip), date order,
  Date TBC last, editor order within a date. `summary.km` is the sum of the stored totals, rounded
  to the whole km (the row's "3 days · 412 km").
- **"Updated" (T18)** = the newest `production_days.updated_at` of the estimate, else the
  estimate's own. **`days.js replaceDays` now keeps a day's `updated_at` when a save changed
  nothing in it**, since every save replaces the days whole and autosave would otherwise restamp
  them on any edit. Deleting a day doesn't move it. Confirming a day (projects.js) does.
- **Link toggling doesn't touch `estimates.updated_at`** (it's the editor's `baseUpdatedAt`; a
  test saves with the pre-share stamp after sharing). Off keeps the token; on again reuses it.
  Turning on with no trip day is refused `409 no_trips`; off is always allowed; a non-boolean `on`
  is `400 invalid_on`. A link that is off, never made or malformed is one `404 not_found`.
- **The static map** (`google.js`): 640×360 at scale 2 (1280×720 PNG8, ~140 KB), roadmap,
  terracotta route line, black numbered pins, terracotta **S** for START (RETURN has no pin).
  A Static pin label is one character, so destinations 10–23 are **A–N**; each stop carries its
  `mapLabel` so the schedule can print the same character as the pin. The stored polyline (up to
  50k characters) is thinned by Douglas–Peucker to ≤ 4,500 encoded characters so the GET stays
  under the URL cap (a test builds 23 pins and a 40k route: ~7 KB).
- **Cache** `static_maps` keyed by day, valid while the hash of the thinned line + pins + render
  version matches. Words, time on location and totals don't change it. Fetched lazily on the
  first view after a trip changes (owner or public), in parallel, 8 s timeout. A failure or no
  key = `map: null` and a 200; not retried for 60 s per picture (in memory). Orphans are swept on
  each insert. A cached image is never shown for a changed trip.
- **Wiring:** `createApp` opts `mapsKey` / `mapsFetch` (tests); the key defaults to
  `GOOGLE_MAPS_SERVER_KEY` (and to empty under `NODE_ENV=test`, as the mailer's does).
  `registerEstimateRoutes(app, db, { maps, appUrl })`.
- **Leaving a gap for task 11:** `GET /api/estimates` (and the project folder) carry no call
  sheet state yet. Task 11's Documents row needs "has trips, N days · km, link on" — add it there
  from `callSheetDays` / `summary` (exported from public.js: `callSheetDays`, `hasDestination`).
- **Backups:** each cached PNG (~140 KB) lives in billing.db, and every mutating request
  snapshots the whole DB. A few dozen trip days is a few MB per snapshot; fine, but if backups
  swell, move the PNGs to files beside the DB.

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
left unchanged). The OAuth client **"LSC Billing — NAS calendar"** (Web application, both G1
redirect URIs) was **created 2026-10-11** by the agent with the user's OK; its ID and secret are in
`.credentials.local.md` and the local `server/.env`. The NAS env needs both at deploy (task 20).

## Traps

- **Menu items can't be chosen by a scripted `.click()`.** menu.js stops the click and calls
  `item.click()` at home, and a browser ignores `click()` on an element whose own synthetic click
  is still running. Real clicks work. In tests: focus the item and dispatch `keydown` Enter, or
  click the `[data-doc]` button directly.

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
