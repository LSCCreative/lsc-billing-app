# Roadmap: every track, one plan

The one record of what is built, what is live, and what happens next, across every track and every
session working in this folder. **Read this first**, then only the HANDOVER of the track you are
working on (it has the detail, decisions and traps). Last consolidated **2026-10-11** (trip-planner task 14).

**Keep it true:** when a task changes the order, a branch, a deploy wave, a seam between tracks or
the user's to-do list, update this file in the same commit. Per-task logs stay in the track's
HANDOVER/TASKS, never here.

## 1. Where things stand

| | Code | State |
|---|---|---|
| **Live** (NAS + Pages) | `main` `a728420`, schema **v15** | production-booking A–E, account recovery, everything older. NAS and site back online since 2026-10-09. |
| **ui-clarity** | branch `ui-clarity` `850f904` + this record, on `main`, unpushed | Tasks 1–7, 9–13 built. Nothing of it is live. |
| **trip-planner** | branch `trip-planner`, on `ui-clarity`, unpushed, schema **v16** | Tasks 1–14 built (stages A, B, C, D; task 14's live check on the real calendar still to do). Nothing live. |
| **production-booking** | `origin/production-booking` `39ccebd` | Live; that one commit (a HANDOVER line) isn't on `main`. Merge it at the next deploy. |

```
main (live, v15) ── ui-clarity (+33, UI system, agreement builder, three screens) ── trip-planner (+23, v16)
```

`trip-planner` contains all of `ui-clarity`. `main` gets each line only when it deploys.

## 2. Who is working where

| Line | Session (on this Mac) | Checkout | Next task |
|---|---|---|---|
| **ui-clarity** | "Continue next task" | **its own git worktree** on `ui-clarity` (see the rules below) | **14** a11y + responsive pass *(Opus/high, frontend)* |
| **trip-planner** | "Travel input feature for estimate editor" | **this folder** (`trip-planner` is checked out here) | **15** responsive + accessibility pass *(Opus/high, frontend)*; task 14's live check waits on the user |
| **"Feature 4: day-based media tree"** | "Feature 4 day-based media tree" | unknown | **Unknown.** It has written nothing to disk or git, and its session didn't receive the status request (held: different permission mode). The user to say what it is, or have that session add a row here. |

**Rules for sharing this folder (two sessions build at once):**

- **Never `git checkout` another branch in this folder** while another session works here: it swaps
  the files under the other session's feet. `trip-planner` owns this checkout. ui-clarity work runs in
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

`ui-clarity` → `trip-planner` after **every** ui-clarity commit (the trip-planner session merges it,
in this folder). Never the other way: `trip-planner` → `main` happens only at wave 3. Merging often
keeps the conflicts small: see §4 for the files both lines touch.

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
   Keep that signature working (or update its one caller when task 16 merges into `trip-planner`),
   give it the client footer like the other client emails, and add it to `test-mail.js`'s checks.
4. **Wave 2, deploy D2** *(Sonnet/medium)*: **Pages before NAS** (the logo must be live first), then
   a test email the user checks in Gmail on phone and desktop.
5. **Task 18: design review** *(Opus/high, **frontend**)*. Fix the must-fix items. ui-clarity then
   closes.

### Line 2: trip-planner (tracker: [`trip-planner/TASKS.md`](trip-planner/TASKS.md))

1. ~~Task 13: Google events on the calendars~~, done: Calendars ▾, checkbox items in `menu.js`.
2. ~~Task 14: writing bookings to Google~~, built and tested against a pretend Google
   (`google-sync.js`, Settings → Writing bookings, the day card's mark). **Its live check on the
   user's calendar is not done**: it needs the user's OK, a test project and a clean-up (HANDOVER).
3. **Tasks 15–19:** responsive/a11y pass, code review, design review, live Google check *(with the
   user present; fold task 14's live check into it)*, docs (`DEPLOYMENT.md` env incl.
   `GOOGLE_CALENDAR_WRITE`, `web/README.md`).
4. **Wave 3, deploy trip-planner** *(task 20, Sonnet/medium)*: only after wave 1 (and ideally wave 2),
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
| a11y passes | task 14: its screens | task 15: travel view, Share, call sheet, Google settings |
| design reviews | task 18 | task 17 |
| `tokens.css` | the token source; task 13 warmed `--color-status-neutral` | uses tokens only; inherits on merge |

**Editor bar:** ui-clarity's sticky bar (task 12) and trip-planner's autosave (task 8) share the
editor's foot. They are already reconciled on `trip-planner`: `barActs()` draws ⋯, then Done for a
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
- [ ] **OK a live check of writing bookings** on the real calendar (trip-planner task 14: a test project
  with one pencilled and one confirmed day, then removed; an agent can do it, or fold it into task 18
  with the user present), and be present for trip-planner task 18 (live Google check).
- [ ] **VoiceOver passes:** production-booking, price-calculator, service-rate-tiers, and the list
  ui-clarity task 14 will leave.
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
