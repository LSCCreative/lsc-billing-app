# Roadmap: every track, one plan

The one record of what is built, what is live, and what happens next, across every track and every
session working in this folder. **Read this first**, then only the HANDOVER of the track you are
working on (it has the detail, decisions and traps). Last consolidated **2026-10-11** (trip-planner task 16).

**Keep it true:** when a task changes the order, a branch, a deploy wave, a seam between tracks or
the user's to-do list, update this file in the same commit. Per-task logs stay in the track's
HANDOVER/TASKS, never here.

## 1. Where things stand

| | Code | State |
|---|---|---|
| **Live** (NAS + Pages) | `main` `70845d8`, schema **v16** | Deployed 2026-10-11/12 as wave 3: trip planner, call sheet, Google Calendar, autosave, **and all of ui-clarity's tasks 1–7 and 9–13** (they ride in `main`'s history). Plus production-booking A–E, account recovery. Awaiting the user's Connect + Sync existing bookings. |
| **ui-clarity** | branch `ui-clarity` `850f904`, **behind `main`** | Tasks 1–7, 9–13 built and now live. Its worktree must **merge `main`** before its next commit. Tasks 14, 8+15, 16, 18 still to do. |
| **trip-planner** | deployed as `main` `70845d8`; the `trip-planner` branch is deleted (2026-10-12) | All 20 tasks done and deployed. Nothing queued except the user's two should-fix items (km rounding, R pin) and the Routes tier choice. |
| **production-booking** | `origin/production-booking` `39ccebd` | Live; that one commit (a HANDOVER line) isn't on `main`. Merge it at the next deploy. |

```
main = trip-planner (live, v16, 70845d8), which contains ui-clarity's 850f904
ui-clarity (worktree) ── still at 850f904: merge main, then tasks 14, 8+15, 16, 18
```

`main` gets each line only when it deploys. `main` now holds everything through trip-planner.

## 2. Who is working where

| Line | Session (on this Mac) | Checkout | Next task |
|---|---|---|---|
| **ui-clarity** | "Continue next task" | **its own git worktree** on `ui-clarity` (see the rules below) | **14** a11y + responsive pass *(Opus/high, frontend)* |
| **trip-planner** | "Travel input feature for estimate editor" | **this folder** (`main` is checked out here; no feature branch now) | **Done and deployed** (wave 3, 2026-10-11/12). Nothing queued. |
| **"Feature 4: day-based media tree"** | "Feature 4 day-based media tree" | unknown | **Unknown.** It has written nothing to disk or git, and its session didn't receive the status request (held: different permission mode). The user to say what it is, or have that session add a row here. |

**Rules for sharing this folder (two sessions build at once):**

- **Never `git checkout` another branch in this folder** while another session works here: it swaps
  the files under the other session's feet. `main` is checked out here. ui-clarity work runs in
  a worktree (`EnterWorktree`, or `git worktree add <path> ui-clarity`).
- **One scratch database per schema.** `/tmp/lsc-billing-scratch` is **v16** (trip-planner migrated
  it; it is also connected to the user's **real Google account**, refresh token stored in it). **Since
  task 14 a save there would write events to that real calendar** (5 s later), so the configs that use
  it carry `GOOGLE_CALENDAR_WRITE=0`; build and check writing on `/tmp/lsc-billing-scratch-sync` with
  `api-scratch-sync` (a copy with no Google account, and a pretend Google). A
  ui-clarity build (v15) **refuses to start on it**. For ui-clarity use its own data dir, e.g.
  `/tmp/lsc-billing-scratch-uic`: seed the `dev` account (launch.json's comment), run the API with
  that `DATA_DIR`, then `node .design/ui-clarity/seed-review.js server` for the review dataset.
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

1. **Task 14: accessibility and responsive pass** *(Opus/high, **frontend**)*. Covers ui-clarity's
   own screens (menus, panels, the agreement builder, Project page, Invoice, editor rail and bar).
   Leaves a VoiceOver list for a person.
2. **Wave 1, deploy ui-clarity 1–14** *(Sonnet/medium)*: tasks 8 and 15 as one deploy. NAS first
   (no migration: it's v15), then Pages by merging `ui-clarity` into `main` and pushing.
   **Needs from the user:** the agreement header wording (task 4) approved, and the OK to deploy.
   **After:** the user fills Settings → Business email, phone and Signs for the business, and checks
   the 13 clauses. *(If the user wants the agreement builder sooner, task 8 can ship 1–13 now and
   task 15 follows after 14; one wave is fewer NAS trips.)*
3. **Task 16: branded email shell** *(Opus/high, **frontend**)*. Needs the logo trimmed from
   `Visual Design/` and the user's approval of the look. **trip-planner seam:** trip-planner added an
   eighth template, `callSheetEmail`, which already calls `shell({ heading, bodyHtml, button, footer })`.
   Keep that signature working (or update its one caller when task 16 lands),
   give it the client footer like the other client emails, and add it to `test-mail.js`'s checks.
4. **Wave 2, deploy D2** *(Sonnet/medium)*: **Pages before NAS** (the logo must be live first), then
   a test email the user checks in Gmail on phone and desktop.
5. **Task 18: design review** *(Opus/high, **frontend**)*. Fix the must-fix items. ui-clarity then
   closes.

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
| `menu.js` | task 14 may fix keys/focus | task 13 added checkbox items (`menuitemcheckbox`, `ITEM` selector, stays open on choose) |
| `views/settings.js`, `css/settings.css` | task 14 (agreement builder, Account) | Home base, Google Calendar section |
| `calendar.js`, `views/home.js`, `views/home-week.js`, `views/booking-block.js` | task 14 (panels, focus) | task 13 Google tiles, bands, pop-up, `.cal-tools`/`.cal-gnote` slots, Calendars ▾ (`gcal-menu.js`) |
| `views/estimate-editor.js`, `css/estimates.css` | tasks 11–12 rail, sticky bar, panels (done) | autosave bar (Done / Save), travel foot, FROM TRIP lines, the day card's Google mark (`watchGoogleSync`) |
| `views/booking-block.js`, `css/booking.css` | task 14 (panels, focus) | the day card's `.day-sync` line + Try again, `setSync()` (task 14) |
| `mail.js` | task 16 rebuilds `shell()` for seven templates | `callSheetEmail` (an eighth) already calls `shell()`: keep the signature |
| a11y passes | task 14: its screens | task 15 **done**: travel view, Share, call sheet, Google settings, Calendars ▾ |
| `.back-btn` (app.css:71) | task 14: a bare 21px line above 768px, under WCAG 2.5.8's 24px; give it a `min-height` (Project page, Invoice, editor) | only `#csp-back` (call-sheet.css) is patched; its rule can go once the shared one is fixed |
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
- [ ] **ui-clarity task 4's agreement header wording:** approve or reword (blocks wave 1).
- [ ] **Wave 1 timing:** one deploy after task 14 (recommended), or task 8 now and 15 later.
- [ ] **Projects list cards:** keep the 11 terracotta totals, or make them white (ui-clarity task 13).
- [ ] **ui-clarity task 16:** approve the email look (blocks wave 2).
- [ ] **estimate-accuracy:** `/grill-me` on its tasks 9, 10, 12–14 (each has an open decision).

**Things only a person can do**
- [ ] After wave 1: fill Settings → Business email, phone, Signs for the business.
- [ ] A Google Cloud **$1 budget alert**; add the Pages secrets `LSC_MAPS_KEY` / `LSC_MAPS_ID` (or let
  an agent do it, with permission) before wave 3.
- [ ] Be present for trip-planner task 18 (live Google check: the trip planner's own routes, and a
  real project end to end).
- [ ] **VoiceOver passes:** production-booking, price-calculator, service-rate-tiers, the list
  ui-clarity task 14 will leave, and trip-planner's (five short checks at the end of "Decisions
  made in task 15" in its HANDOVER).
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
| [`service-rate-tiers/`](service-rate-tiers/HANDOVER.md), [`price-calculator/`](price-calculator/HANDOVER.md) | VoiceOver; R8 | a person |
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
