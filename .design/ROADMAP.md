# Roadmap: what is live, what is open

The one current-state record. Read it first. Keep it true: when a task changes what is live, what is
open or what waits on the user, update this file in the same commit. Per-task logs don't go here;
built work is summarised in `Project build archive/Project build summary archive.md` (don't read it
unless you hit a real misunderstanding).

## 1. Live

`main` `937aebb` (deployed NAS then Pages 2026-10-17), schema **v17**.
Every track is built, reviewed and deployed: nas-hosted base, price-calculator / Finance, overhead-
finance, service-rate-tiers, estimate-accuracy tasks 1–3, 5a, 6, production-booking A–E (surcharges,
booking, Home calendar, projects, invoices, client pages, e-signing, Resend email), account recovery,
own kit (per-asset Recovery, kit lines, multi-year CSV), trip planner + call sheet + Google Calendar read/write + autosave, ui-clarity 1–18 (panels, menus,
agreement builder, branded email, Metro Sans). Site moved to `app.lsccreative.studio` 2026-10-13.

| What | Setting (verified in Cloudflare / Google consoles 2026-10-13) |
|---|---|
| Site | `https://app.lsccreative.studio/`, DNS CNAME → `lsccreative.github.io`, DNS only |
| API | `https://billing.lsccreative.studio` (Cloudflare Tunnel `deck-productions-nas`) |
| Maps browser key | referrers `app.lsccreative.studio/*`, `lsccreative.github.io/*`, `localhost:5173/*` |
| OAuth client | redirects `billing.lsccreative.studio/api/google/oauth/callback`, `localhost:8080/...` |

Branches and worktrees: work happens on `main` in this folder. `.claude/worktrees/ui-clarity` and
`.claude/worktrees/trip-should-fix` are finished and can be removed (check them for uncommitted work
first). `origin/production-booking` holds one docs-only commit not on `main`; ignore it.

## 2. Open work

| Track | Open | Blocked on |
|---|---|---|
| [`own-kit/`](own-kit/TASKS.md) | **Built and deployed 2026-10-17 (K1–K10).** Move the folder to the archive when convenient | the user: set each asset's Recovery, replacement cost/cycle on floor assets, day rates on kit assets |
| **dashboard** (the user's request 2026-10-17) | **Built, undeployed.** Home renamed "Dashboard": small calendar top right that grows into the full calendar (Collapse shrinks it), lists of open projects, outstanding invoices and recent payments, Coming up and Recent activity kept. Adds `GET /api/invoices?state=` and `GET /api/projects?stage=open` | ask before deploying: **NAS first** (new route), then Pages |
| [`estimate-accuracy/`](estimate-accuracy/TASKS.md) | 7 (relabel Overhead "Tax", no decision needed), 10, 12–14 (each has an open decision: `/grill-me` first), 4 and 5(b) (user checks), 15 deploy, 16 review | grill decisions; user |
| production-booking task 31 | Stripe card payment, **on hold (D101): don't build** | the user |
| nas-hosted redeploy hardening | compose data volume as `${HOST_DATA_DIR:-./data}`, a written redeploy procedure (now in `DEPLOYMENT.md`) | nothing; low priority |
| trip-planner | Google Routes tier: `maps.js` asks `TRAFFIC_AWARE`; Google Maps itself uses the pricier `TRAFFIC_AWARE_OPTIMAL` (explains a 0.8 km leg difference). Switch or not is the user's call after checking price | the user |
| overhead-finance | four optional could-improve items (low priority; see archive `DESIGN_REVIEW.md`) | nothing |
| **travel-in-booking** (the user's request 2026-10-13; not yet briefed) | The maps trip view is to be the **only** travel feature on estimate editing. Today travel is split three ways: the day's service menu "Travel" group (Tolls & Parking, Vehicle — per km, Crew Meals, Transport & Logistics Hrs, Flights, Crew Accommodation, plus the "Define travel →" foot), the flat "Travel & accommodation" section under "On set, by day", and the maps trip view that is only reachable by booking a day first. Wanted: travel lives in the **Production booking** panel, under Production, **replacing** the current travel items (the service-menu Travel group and the on-set Travel section go). Shipped as a **Frontend task** and it touches priced lines (calc.js, `fromTrip`), so `Opus, effort: high`; `/grill-me` first | decisions to grill: what becomes of the non-distance items (tolls, meals, flights, accommodation) and of travel lines already saved on live estimates; whether a day is auto-created when travel is defined on an estimate with none; trip-planner task docs are in the archive |
| **service-menu-on-day** (the user's request 2026-10-13; not yet briefed; build with travel-in-booking, same panel) | "Add production service items" opens its menu at the top of the page (at ≥768 it swaps in for the calendar, in its column: `BookingBlock.menuHost`), which is confusing. Wanted: the menu opens **directly under the day card it is for** and looks like it grows out of that card, so its link to that production day is visible. Below 768 it is a bottom sheet today; decide whether that stays. A **Frontend task**, `Opus, effort: high`; keep the existing focus return, Escape/Done close and "retarget to another card" behaviour (see the service-menu comment in `estimate-editor.js`) | decision to grill: what happens to the calendar column while the menu is open under a day, and the connector treatment (open edge, shared border, caret) |
| **bunny-db-migration** (the user's request 2026-10-14; not yet briefed) | Migrate the SQLite database (schema v16, today on the NAS behind the Cloudflare Tunnel) to **bunny.net**'s hosted database, using the bunny.net API (dash.bunny.net) to get the most out of it (provisioning, region/replicas, backups, access tokens, scripted migrations). A backend/deploy task touching auth and money tables, so `Opus, effort: high`; `/grill-me` first. Secrets (API keys, DB tokens) go in a 1Password Environment, never in tracked files | decisions to grill: bunny.net DB product fit vs better-sqlite3 usage and `node --test` suite, cutover and rollback plan, data-volume and latency from the NAS/Pages split, what happens to the NAS and the Cloudflare Tunnel afterwards, backup/export routine, cost |

Scrapped, don't rebuild: HubSpot CRM sync (2026-10-13), expected booking rate (estimate-accuracy 8).

## 3. Waiting on the user

- **Feature 4, "day-based media tree":** what it is and where it stands (an unknown session; it has
  written nothing to disk or git).
- Connect Google Calendar on the live site, then press **Sync existing bookings** (`DEPLOYMENT.md`).
- Settings → Email → Send a test email; check it in Gmail on phone and desktop.
- Settings → Business: fill email, phone and "Signs for the business"; check the 13 agreement clauses.
- Approve or reword the agreement header wording (live).
- Test **Forgot password** on the live sign-in.
- estimate-accuracy: tick Transport & Logistics Hrs as "Your time" on the live Rate Card (5b);
  confirm the FY 2026–27 tax scale (4); delete any income-tax items in Overhead's "Tax" category (7).
- Safari check of service-rate-tiers R8 (select-on-focus after a mouse click).
- A Google Cloud $1 budget alert.
- Live Google check with the user present (trip planner's own routes, a real project end to end).

## 4. Rules for working here

- Sessions share this folder: never `git checkout` another branch here; use a worktree.
- One API on :8080, one web on :5173 (the Maps browser key works only from :5173).
- Scratch DB `/tmp/lsc-billing-scratch` is v16 (migrates to v17 on first boot of the new build) and holds the user's **real Google account**: see
  `WORKING_NOTES.md` before running anything that saves. Back up before checks that send, void or
  mark paid.
- The repo is public: keys and passwords live only in `.credentials.local.md`, `server/.env` and the
  gitignored `web/js/config.js`.
- Deploys are waves, each asked for first: fetch and diff `origin/main`, NAS before Pages
  (`DEPLOYMENT.md`).
