# Roadmap: what is live, what is open

The one current-state record. Read it first. Keep it true: when a task changes what is live, what is
open or what waits on the user, update this file in the same commit. Per-task logs don't go here;
built work is summarised in `Project build archive/Project build summary archive.md` (don't read it
unless you hit a real misunderstanding).

## 1. Live

`main` `a820c84` (production-day-booking through Breakpoints deployed to Pages 2026-10-21, web only; post-multipliers NAS then Pages earlier that day), schema **v19** live. Pricing floor was deployed 2026-10-20.
Every track is built, reviewed and deployed: nas-hosted base, price-calculator / Finance, overhead-
finance, service-rate-tiers, estimate-accuracy tasks 1–3, 5a, 6, production-booking A–E (surcharges,
booking, Home calendar, projects, invoices, client pages, e-signing, Resend email), account recovery,
own kit (per-asset Recovery, kit lines, multi-year CSV), the Dashboard (Home renamed; small calendar, open projects / outstanding / paid lists), trip planner + call sheet + Google Calendar read/write + autosave, ui-clarity 1–18 (panels, menus,
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
| [`estimate-accuracy/`](estimate-accuracy/TASKS.md) | 7 (relabel Overhead "Tax", no decision needed), 10, 12–14 (each has an open decision: `/grill-me` first), 4 and 5(b) (user checks), 15 deploy, 16 review | grill decisions; user |
| pricing-floor (built, reviewed and **deployed 2026-10-20**, PF1–PF11; folder in `Project build archive/tracks/pricing-floor/`) | Done. Live row is 8 h / 65% / 10%. The default Rate Card's typed rates sit under the new $143.75/h floor (badged on the live card; a sample job is $486.75 under its Minimum Job Price) | the user: review the typed rows below the floor |
| [`post-multipliers/`](post-multipliers/TASKS.md) (the user's request 2026-10-20; grilled, brief + tasks PM1–PM11 written, schema v19 after pricing-floor v18) | Each Deliverable Type's post service gets its own multiplier; picking a type on an estimate **fills** hourly post lines (capture × multiplier × qty, up 0.5 h per line) and they follow capture until typed over; the Rate Card block becomes collapsed summaries, one open at a time. **PM1 done** (not deployed): `calc.js` `typeServices` / `typePostRate` / `postLineHours`, `postPlan` per line with a `lines` list and the pre-v19 fallback (identical plan on old estimates), `PRICING_SHAPE` 'post-multipliers'. **PM2 done** (not deployed): schema v19 rewrites the card's types to `services: [{ name, multiplier: 0 }]` with no type multiplier (estimates untouched); the pricing route refuses the old shape; `postMultiplier` / `follows` only on post lines (`line_post_multiplier_invalid`), never on a client page or PDF. **PM3 done** (not deployed): the Rate Card's Deliverable Types are collapsed summaries (name · N post services · X post hrs per capture hr), one open at a time, each service with its own multiplier field; saves the v19 shape. **PM4 done** (not deployed): picking a type lays out post lines with their service's multiplier snapshotted; hourly ones follow capture and qty on every recalc and bill those hours until typed over (or their unit switched); old estimates open unchanged, and a following line whose saved hours don't match the plan is pinned on open, not rewritten. Switching a following line off the hour sets it to 0. The planner and Capture ⓘ texts describe filled hours. **PM5 done** (not deployed): a post line by the half or full day shows "· N hrs recommended" on its unit line (own line on phones, described on its qty field); figures checked against the reference on scratch. **PM6 done** (not deployed): the Rate Card block's states and focus: a summary says "N missing" when services left the card, save problems name the service and type and open it, removals move focus to the next control (never the page), Reset names the types it deletes, and every change is announced. **PM7 done** (not deployed): breakpoints checked from 1280 to 320 (one-line summary from 768, two-column panel from 1100, phone sizes and 44 px targets below 768, no horizontal scroll); a wrapped summary never leaves a dangling "·". **PM8 done** (not deployed): accessibility audited (names, keyboard, focus, contrast); a missing service's multiplier field says "missing" in its name. **PM9 done** (not deployed): money review on a v18 dataset: v19 leaves every estimate, invoice, route and PDF identical, filled lines bill exactly their plan, pinned lines never move; `post-multipliers/migration-check.js` reruns it on a live backup copy (part of PM11). **PM10 done**: design review in `post-multipliers/DESIGN_REVIEW.md`, no must or should fixes (four small could-improves). **PM11 done: deployed 2026-10-21** (`migration-check.js` on a live backup copy: no differences; NAS then Pages). Track finished; move its folder to the archive when convenient | the user: re-enter each Deliverable Type's service multipliers on the live Rate Card (they start at 0×, so new picks fill 0 h until then) |
| **project-receipts** (the user's request 2026-10-20; not yet briefed) | One-off **purchase** lines on the estimate/invoice (e.g. a hard drive handed to the client) beside External crew and hire, and a **receipts box on the project page**: pick a pass-through line (crew, hire, purchase, Direct travel), upload the supplier's invoice or receipt (PDF/image), kept with the project for tax time. **Not GST-free** (the user's call: purchases are the business's own, no disbursements): pass-through lines stay GST-taxable when registered and stay out of income and the tax reserve, as crew/hire already are (the Hnry "untaxed portion" is income tax, not GST; ATO: "non-taxable" on a tax invoice means only GST-free/input-taxed). Money math + **Frontend task**, `Opus, effort: high`; `/grill-me` first | decisions to grill: a new Purchases section vs extending hire; file storage on the NAS (data volume, size/type limits, backups, the bunny-db move); owner-only (never on public routes); an FY receipts export; does a missing receipt flag anything; can one receipt cover several lines |
| [`hnry-invoicing/`](hnry-invoicing/TASKS.md) (replaces card-payments; the user's request 2026-10-20, grilled 2026-10-21, brief + tasks H1–H12 written, schema v20 after post-multipliers v19) | Invoices are created, sent and paid **in Hnry** (card payment built in, 1.45% paid by the user). On quote acceptance the NAS calls Zapier to create a Hnry **deposit draft**; "Create final" pushes the final. Hnry's number replaces the app's; the app retires its invoice email, PDF and public page. Stripe is dropped. Money math + **Frontend task**, `Opus, effort: high` | Hnry enabling the Zapier beta (asked via Hnry chat 2026-10-21); Zapier enabled and checked 2026-10-22 (C1–C3, C5 answered; C4 paid status stays manual; C2 GST re-check when the user registers). **H1–H4 done** (not committed, not deployed): `server/src/hnry.js` + fake, schema v20, the deposit/single push on acceptance and the final + Retry route (`hnry-push.js`, `POST /api/invoices/:id/hnry`); an invoice in Hnry can't be edited in the app. **Next: H5** (retire the app's invoice sending). The user: create the Zapier SDK credential into a 1Password Environment (H8); delete the two throwaway Hnry drafts INV-10657741 and INV-10670074 |
| [`production-day-booking/`](production-day-booking/TASKS.md) (the user's request 2026-10-21; brief + tasks written) | Days are booked only from a compact calendar through one add-day popup (bump in/out, status); quiet day cards. **Done and deployed to Pages 2026-10-21 (`a820c84`):** the popup (status defaults to Proposed, times from the last day), the simplified Production days list (no "+ Add Date TBC day", one-line empty state), quiet day cards (date, times, chip, ⋯ with Edit day / Duplicate / Remove; edit re-uses the popup with a Date field), the compact calendar with Expand (full width above the list at every width, remembered per browser), the open/close/focus and edit flow (a date with a day opens it for editing, plus "+ Another day"; focus returns to the date cell; same bump in/out refused), legacy and empty states (Date TBC days and Not on a day render and save as before; a Date TBC card has a quiet "Set date"). Breakpoints (phones already passed; a touch tablet now keeps 44px calendar, card and dialog targets via `any-pointer: fine`). Next: a11y, review. **Frontend task**, `Opus, effort: high` | nothing |
| nas-hosted redeploy hardening | compose data volume as `${HOST_DATA_DIR:-./data}`, a written redeploy procedure (now in `DEPLOYMENT.md`) | nothing; low priority |
| trip-planner | Google Routes tier: `maps.js` asks `TRAFFIC_AWARE`; Google Maps itself uses the pricier `TRAFFIC_AWARE_OPTIMAL` (explains a 0.8 km leg difference). Switch or not is the user's call after checking price | the user |
| overhead-finance | four optional could-improve items (low priority; see archive `DESIGN_REVIEW.md`) | nothing |
| **travel-in-booking** (the user's request 2026-10-13; not yet briefed) | The maps trip view is to be the **only** travel feature on estimate editing. Today travel is split three ways: the day's service menu "Travel" group (Tolls & Parking, Vehicle — per km, Crew Meals, Transport & Logistics Hrs, Flights, Crew Accommodation, plus the "Define travel →" foot), the flat "Travel & accommodation" section under "On set, by day", and the maps trip view that is only reachable by booking a day first. Wanted: travel lives in the **Production booking** panel, under Production, **replacing** the current travel items (the service-menu Travel group and the on-set Travel section go). Shipped as a **Frontend task** and it touches priced lines (calc.js, `fromTrip`), so `Opus, effort: high`; `/grill-me` first | decisions to grill: what becomes of the non-distance items (tolls, meals, flights, accommodation) and of travel lines already saved on live estimates; whether a day is auto-created when travel is defined on an estimate with none; trip-planner task docs are in the archive |
| **service-menu-on-day** (the user's request 2026-10-13; not yet briefed; build with travel-in-booking, same panel) | "Add production service items" opens its menu at the top of the page (at ≥768 it swaps in for the calendar, in its column: `BookingBlock.menuHost`), which is confusing. Wanted: the menu opens **directly under the day card it is for** and looks like it grows out of that card, so its link to that production day is visible. Below 768 it is a bottom sheet today; decide whether that stays. A **Frontend task**, `Opus, effort: high`; keep the existing focus return, Escape/Done close and "retarget to another card" behaviour (see the service-menu comment in `estimate-editor.js`) | decision to grill: what happens to the calendar column while the menu is open under a day, and the connector treatment (open edge, shared border, caret) |
| **bunny-db-migration** (the user's request 2026-10-14; not yet briefed) | Migrate the SQLite database (schema v16, today on the NAS behind the Cloudflare Tunnel) to **bunny.net**'s hosted database, using the bunny.net API (dash.bunny.net) to get the most out of it (provisioning, region/replicas, backups, access tokens, scripted migrations). A backend/deploy task touching auth and money tables, so `Opus, effort: high`; `/grill-me` first. Secrets (API keys, DB tokens) go in a 1Password Environment, never in tracked files | decisions to grill: bunny.net DB product fit vs better-sqlite3 usage and `node --test` suite, cutover and rollback plan, data-volume and latency from the NAS/Pages split, what happens to the NAS and the Cloudflare Tunnel afterwards, backup/export routine, cost |

Scrapped, don't rebuild: HubSpot CRM sync (2026-10-13), expected booking rate (estimate-accuracy 8).

## 3. Waiting on the user

- **Post multipliers:** re-enter each Deliverable Type's per-service multipliers on the live Rate Card (all 0× after v19).
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
