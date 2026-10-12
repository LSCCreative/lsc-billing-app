# Roadmap: every track, one plan

The one record of what is built, what is live, and what happens next, across every track and every
session working in this folder. **Read this first**, then only the HANDOVER of the track you are
working on (it has the detail, decisions and traps). Last consolidated **2026-10-12** (ui-clarity task 18).

**Keep it true:** when a task changes the order, a branch, a deploy wave, a seam between tracks or
the user's to-do list, update this file in the same commit. Per-task logs stay in the track's
HANDOVER/TASKS, never here.

## 1. Where things stand

| | Code | State |
|---|---|---|
| **Live** (NAS + Pages) | `main` `34c3213` (NAS and Pages; trip-planner should-fixes 2026-10-12), schema **v16** | Deployed 2026-10-11/12 as wave 3: trip planner, call sheet, Google Calendar, autosave, **and all of ui-clarity's tasks 1–7 and 9–13** (they ride in `main`'s history). Plus production-booking A–E, account recovery. Awaiting the user's Connect + Sync existing bookings. |
| **ui-clarity** | branch `ui-clarity` = `main` `db1a8ce` (worktree) | Tasks 1–18 **live** (wave 4 deployed 2026-10-12, Pages only). Track closed; open should-fixes are the user's calls (§5). |
| **trip-planner** | deployed as `main` `70845d8`; should-fixes on branch `trip-should-fix` (worktree `.claude/worktrees/trip-should-fix`, off `main` `7dd0a92`) | All 20 tasks done and deployed. Task 17's two should-fixes (`15ad279`: one km rule, no R badge) **deployed** 2026-10-12, NAS then Pages, `main` `34c3213`. Only the Routes tier choice left. |
| **production-booking** | `origin/production-booking` `39ccebd` | Live; that one commit (a HANDOVER line) isn't on `main`. Merge it at the next deploy. |

```
main = trip-planner (live, v16, 70845d8), which contains ui-clarity's 850f904
ui-clarity (worktree) ── equals main db1a8ce (wave 4 deployed)
```

`main` gets each line only when it deploys. `main` now holds everything through trip-planner.

## 2. Who is working where

| Line | Session (on this Mac) | Checkout | Next task |
|---|---|---|---|
| **ui-clarity** | "Continue next task" | **its own git worktree** on `ui-clarity` (see the rules below) | **Closed.** Wave 4 deployed 2026-10-12 |
| **trip-planner** | "Travel input feature for estimate editor"; should-fixes in their own session | **this folder** (`main`); the should-fixes in worktree `.claude/worktrees/trip-should-fix` (API :8082 on `/tmp/lsc-billing-scratch-tsf`, web :5173, run from the worktree since launch.json is read from here) | Should-fixes deployed. Nothing queued. The worktree can be removed. |
| **"Feature 4: day-based media tree"** | "Feature 4 day-based media tree" | unknown | **Unknown.** It has written nothing to disk or git, and its session didn't receive the status request (held: different permission mode). The user to say what it is, or have that session add a row here. |

**Rules for sharing this folder (two sessions build at once):**

- **Never `git checkout` another branch in this folder** while another session works here: it swaps
  the files under the other session's feet. `main` is checked out here. ui-clarity work runs in
  a worktree (`EnterWorktree`, or `git worktree add <path> ui-clarity`).
- **One scratch database per schema.** `/tmp/lsc-billing-scratch` is **v16** (trip-planner migrated
  it; it is also connected to the user's **real Google account**, refresh token stored in it). **Since
  task 14 a save there would write events to that real calendar** (5 s later), so the configs that use
  it carry `GOOGLE_CALENDAR_WRITE=0`; build and check writing on `/tmp/lsc-billing-scratch-sync` with
  `api-scratch-sync` (a copy with no Google account, and a pretend Google). ui-clarity (v16 since it took `main`) uses its own copy, `/tmp/lsc-billing-scratch-uic`, with
  launch.json's `api-uic` (:8081) and `web-uic` (:5174); the config's comment says how to make it.
- **One API on :8080, one web on :5173.** They belong to this folder's line (trip-planner). A
  worktree runs its previews on other ports (e.g. web 5174, API 8081 with `CORS_ORIGINS` and
  `APP_URL` set to match). The Maps browser key works only from :5173, which ui-clarity doesn't need.
- **Scratch is shared state.** Before a check that sends, voids, deletes or marks paid, back up the
  DB (`db.backup()`), and restore it after (stop the API, copy over `billing.db`, delete `-wal`/`-shm`).
- **The repo is public.** Keys and passwords live only in `.credentials.local.md`, `server/.env` and
  the gitignored `web/js/config.js`.
- Each session edits only its own track's files plus its own row here. A change to `CLAUDE.md` or this
  file is committed on `ui-clarity` and merged forward (rule below), so both lines carry the same copy.

## 3. The plan, in order

Two build lines run in parallel; deploys go out in **waves**, each one asked for first (CLAUDE.md).
Every wave starts with `git fetch` and a diff against `origin/main` (memory: deploy base check), and
ships a `server/` with v15 or later.

### Merge rule

Wave 3 shipped, so `main` already holds everything through trip-planner and the `trip-planner`
branch is gone. The ui-clarity worktree **merges `main` into `ui-clarity`** before its next commit and
whenever `main` moves. `ui-clarity` reaches `main` only at its own wave (1 or 2). See §4 for the
files both lines touched.

### Line 1: ui-clarity (tracker: [`ui-clarity/TASKS.md`](ui-clarity/TASKS.md))

1. ~~Task 14: accessibility and responsive pass~~, done 2026-10-12 (HANDOVER; a VoiceOver list for a
   person is in §5).
2. **Wave 1, deploy ui-clarity 14** *(Sonnet/medium)*: tasks 1–7 and 9–13 already went live inside
   wave 3, so this is task 14 alone, frontend only: **Pages only** (fast-forward `main` to
   `ui-clarity` and push; no NAS trip, no server change).
   **Needs from the user:** the OK to deploy. (The agreement header wording went live with wave 3;
   approving or rewording it no longer blocks a deploy.)
   **After:** the user fills Settings → Business email, phone and Signs for the business, and checks
   the 13 clauses. *(If the user wants the agreement builder sooner, task 8 can ship 1–13 now and
   task 15 follows after 14; one wave is fewer NAS trips.)*
3. **Task 16: branded email shell** *(Opus/high, **frontend**)*: **done 2026-10-12**, look approved by
   the user (HANDOVER "Decisions made in task 16"); the call sheet email is on the
   new shell with the client footer and in `test-mail.js`. Needs the logo trimmed from
   `Visual Design/` and the user's approval of the look. **trip-planner seam:** trip-planner added an
   eighth template, `callSheetEmail`, which already calls `shell({ heading, bodyHtml, button, footer })`.
   Keep that signature working (or update its one caller when task 16 lands),
   give it the client footer like the other client emails, and add it to `test-mail.js`'s checks.
4. ~~**Wave 2, deploy D2**~~ done 2026-10-12 *(Sonnet/medium)*: **Pages before NAS** (the logo must be live first), then
   a test email the user checks in Gmail on phone and desktop.
5. ~~**Task 18: design review**~~ done 2026-10-12 (`ui-clarity/DESIGN_REVIEW.md`): must-fix items
   fixed (the editor's table money no longer terracotta, now mono; the Invoice's repeated terracotta),
   then every should-fix and could-improve at the user's "fix all". Web files only (incl. `web/c/`).
6. ~~**Wave 4, deploy task 18**~~ done 2026-10-12, `main` `db1a8ce` *(Sonnet/medium)*: **Pages only** (no server change): fetch, merge
   `main` in if it moved, fast-forward `main` to `ui-clarity`, push. Ask first. ui-clarity then closes;
   its open should-fixes are the user's calls (§5).

### Line 2: trip-planner (tracker: [`trip-planner/TASKS.md`](trip-planner/TASKS.md))

1. ~~Task 13: Google events on the calendars~~, done: Calendars ▾, checkbox items in `menu.js`.
2. ~~Task 14: writing bookings to Google~~, built and tested against a pretend Google
   (`google-sync.js`, Settings → Writing bookings, the day card's mark). **Live check on the user's
   calendar passed 2026-10-11** (create, move, re-time, accept, delete; HANDOVER).
3. ~~Task 15: responsive and accessibility pass~~, done (HANDOVER: what failed, what passed, and a
   VoiceOver list for a person).
4. ~~Task 16: code review~~, done: 8 of 9 findings fixed (HANDOVER).
   **Tasks 17–19:** design review, live Google check *(with the user present)*, docs
   (`DEPLOYMENT.md` env incl. `GOOGLE_CALENDAR_WRITE`, `web/README.md`).
5. **Wave 3, deploy trip-planner** *(task 20, Sonnet/medium)*: only after wave 1 (and ideally wave 2),
   with `ui-clarity` and `main` merged in. **NAS first (v16 migration), then Pages.** New NAS env:
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_MAPS_SERVER_KEY`, `APP_URL`/`APP_ORIGIN`,
   and `GOOGLE_OAUTH_REDIRECT_URI=https://billing.lsccreative.studio/api/google/oauth/callback` unless
   the tunnel passes https and the host through (`TRUST_PROXY`). Pages secrets `LSC_MAPS_KEY`,
   `LSC_MAPS_ID`. After: connect Google Calendar on the live site, then Sync existing bookings.

### After both lines

The parked tracks (§6), in the order the user picks. Nothing there is in progress.

## 4. Seams between the lines

Both lines change these. Merge `ui-clarity` forward often and read the other side's diff first.

| Where | ui-clarity | trip-planner |
|---|---|---|
| `menu.js` | task 14 (done): `menu-btn-icon`, `#app-view` inert under a phone sheet | task 13 added checkbox items (`menuitemcheckbox`, `ITEM` selector, stays open on choose) |
| `views/settings.js`, `css/settings.css` | task 14 (agreement builder, Account) | Home base, Google Calendar section |
| `calendar.js`, `views/home.js`, `views/home-week.js`, `views/booking-block.js` | task 14 (panels, focus) | task 13 Google tiles, bands, pop-up, `.cal-tools`/`.cal-gnote` slots, Calendars ▾ (`gcal-menu.js`) |
| `views/estimate-editor.js`, `css/estimates.css` | tasks 11–12 rail, sticky bar, panels (done) | autosave bar (Done / Save), travel foot, FROM TRIP lines, the day card's Google mark (`watchGoogleSync`) |
| `views/booking-block.js`, `css/booking.css` | task 14 (panels, focus) | the day card's `.day-sync` line + Try again, `setSync()` (task 14) |
| `mail.js` | task 16 rebuilt `shell()` (done): templates take `business` + `appUrl` | `callSheetEmail` moved onto it in task 16; its route passes `business` and `appUrl` |
| a11y passes | task 14: its screens | task 15 **done**: travel view, Share, call sheet, Google settings, Calendars ▾ |
| `.back-btn` (app.css:71) | task 14 (done): `min-height: var(--control-h-sm)` | `#csp-back`'s own rule deleted (task 14) |
| `calendar.css` `.cal-goto` | task 14 may touch the bar | task 15: Go to date no longer clips at 375 (`min-width: 9.5rem`, label may wrap) |
| design reviews | task 18 | task 17 |
| `tokens.css` | the token source; task 13 warmed `--color-status-neutral` | uses tokens only; inherits on merge |

**Editor bar:** ui-clarity's sticky bar (task 12) and trip-planner's autosave (task 8) share the
editor's foot. They are already reconciled on `main`: `barActs()` draws ⋯, then Done for a
draft (autosaved) or Cancel + Save for a sent estimate, beside the same live total. A ui-clarity
change to the bar (task 14) must be merged into `barActs()` by hand, not taken whole.

## 5. Waiting on the user

**Decisions**
- [ ] **Feature 4, "day-based media tree":** what it is and where it stands (§2).
- [ ] **ui-clarity task 4's agreement header wording:** live since wave 3; approve or reword.
- [x] **Wave 1 timing:** done 2026-10-12, one Pages push.
- [x] **Terracotta headline figures and the Summary's boxes:** the user said "fix all" (2026-10-12): the
  figures are white, the Summary is flat (ui-clarity task 18, round 2).
- [x] **ui-clarity task 16:** email look approved 2026-10-12.
- [ ] **estimate-accuracy:** `/grill-me` on its tasks 9, 10, 12–14 (each has an open decision).
- [x] **trip-planner km rule:** whole km, rounded up as the line bills it, totals the sum of the days (2026-10-12).
- [x] **trip-planner should-fix deploy:** done 2026-10-12, NAS then Pages, `main` `34c3213`.

**Things only a person can do**
- [ ] **Wave 2 test email:** Settings → Email → Send a test email; check it in Gmail on phone and desktop.
- [ ] After wave 1: fill Settings → Business email, phone, Signs for the business.
- [ ] A Google Cloud **$1 budget alert**; add the Pages secrets `LSC_MAPS_KEY` / `LSC_MAPS_ID` (or let
  an agent do it, with permission) before wave 3.
- [ ] Be present for trip-planner task 18 (live Google check: the trip planner's own routes, and a
  real project end to end).
- [x] **VoiceOver passes:** cancelled by the user 2026-10-12 ("they are fine"). The lists in the HANDOVERs stay as reference only.
- [ ] **Safari:** service-rate-tiers R8 (select-on-focus after a mouse click).
- [ ] **account-recovery:** the live test of Forgot password.
- [ ] **estimate-accuracy:** 5(b) tick Transport & Logistics Hrs as "Your time" on the live Rate Card;
  task 4 confirm the FY 2026–27 tax scale.

## 6. Parked tracks

| Track | Open | Blocked on |
|---|---|---|
| [`estimate-accuracy/`](estimate-accuracy/HANDOVER.md) | 4, 5(b), 7, 9, 10, 12–14, 15 deploy, 16 review | grill decisions; user checks |
| [`hubspot-crm-sync/`](hubspot-crm-sync/HANDOVER.md) | everything (design done) | a HubSpot credential, created with the user |
| [`production-booking/`](production-booking/HANDOVER.md) | task 31 Stripe | **held** (D101), don't build |
| [`nas-hosted-billing/`](nas-hosted-billing/TASKS.md) | redeploy hardening (compose data volume, a written redeploy procedure) | nothing; its "missed redeploy" items predate v13–v15 and are probably stale: check before acting |
| [`service-rate-tiers/`](service-rate-tiers/HANDOVER.md), [`price-calculator/`](price-calculator/HANDOVER.md) | R8 (VoiceOver cancelled) | a person |
| [`overhead-finance/`](overhead-finance/DESIGN_REVIEW.md) | four optional could-improves | nothing; low priority |
| [`account-recovery/`](account-recovery/HANDOVER.md) | the user's live test | a person |

## 7. Shared traps

- Previews show stale code: restart the API after server edits; cache-bust web files (memory).
- Menu items (`menu.js`) can't be chosen by `el.click()` in tests; dispatch a bubbling `MouseEvent`
  or a keydown Enter.
- Headless screenshots are the reliable route (`server/node_modules/puppeteer-core` + local Chrome,
  in-page login, `page.reload()` after a hash goto, accept `beforeunload` dialogs).
- `.design/*/screenshots/` are local only (gitignored).
- `calc.js`, `documents.js` and `call-sheet.js` each have a byte-identical copy in `server/src` and
  `web/js`; the drift tests fail otherwise.
