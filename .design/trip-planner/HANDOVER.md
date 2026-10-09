# Handover: Trip Planner, Google Calendar and Editor Autosave

Read this, then [`DECISIONS.md`](DECISIONS.md) (T1–T18, G1–G5, I1–I4, the user's; don't re-ask), then
[`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).

**Model: Opus, effort high. Frontend task** (also writes priced travel lines → money bucket).

## State as of 2026-10-09

Design phases done 2026-10-08 (grill, brief, IA, tasks; tokens skipped). Building on branch
**`trip-planner`** (off `ui-clarity`, unpushed).

- [x] **Task 1** trip storage and the km/hours rule, `fc331dc`. Schema v16, server derivation,
  calc functions, 19 new tests (`test-trips.js`, plus `test-calc.js` and `test-db.js`).
- [x] **Task 2** Maps loader and the travel view shell, `7d83047`. `maps.js`, `views/trip-planner.js`,
  `css/trip.css`, Define travel foot, `?trip=` with router `claim()`/`mark()`. Verified in the
  browser at 1280, 800 and 375: map draws (key + billing OK), reload reopens, view Back and
  browser Back/Forward keep unsaved edits with no prompt, unknown day id dropped, no-key message.
- [ ] **Next: task 3**, placing stops. *Frontend: Opus/high.* **Frontend task.** Wire
  `.trip-add-start` (rendered disabled in task 2) and add the search bar, pins and cells.

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

- The repo is public. Keys never go in tracked files. The browser key reaches Pages through a
  GitHub secret written into the gitignored `web/js/config.js` by `deploy-pages.yml`.
- The browser key only works from `https://lsccreative.github.io/*` and `http://localhost:5173/*`
  (the console refused a wildcard port). Local previews on other ports need a row added.
- Autosave vs `backup.js` preWriteBackup: every mutating request snapshots the whole DB. Autosave
  PUTs must be throttled (I2), or recovery points collapse to seconds.
- New schema (v16): NAS before Pages. The NAS and the live site are back online (2026-10-09).
- `GET /api/estimates` (the list) now carries every day's trip, polyline included (≤ 50k chars
  each). Fine at today's volume. If the list slows, strip `polyline` there, not in `readDays`.
- Limits in `days.js`: 23 destinations, 2000 chars per detail, 300 per address, 50k polyline,
  `minutesOnSite` a whole number ≤ 1440.
