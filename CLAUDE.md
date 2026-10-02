# LSC Billing App

Quoting/invoicing tool for LSC Creative. **Currently mid-overhaul**: rebuilding from a
memoryless Electron desktop app into a real website. Read before touching anything.

## Start here

`.design/` holds one self-contained folder per feature track — each has its own `DESIGN_BRIEF.md`,
`TASKS.md`, and (once any work has happened on it) `HANDOVER.md`. Seven tracks exist right now:

1. [`.design/nas-hosted-billing/`](.design/nas-hosted-billing/) — the base website rewrite
   (Electron → GitHub Pages + NAS-hosted API/SQLite). Largely complete and **live** (Cloudflare
   Tunnel + GitHub Pages); remaining work is font/asset cleanup (its `TASKS.md`) and the fixes
   from its design review, done 2026-09-21
   ([`DESIGN_REVIEW.md`](.design/nas-hosted-billing/DESIGN_REVIEW.md) — its fixes were all
   done the same day). Read its `HANDOVER.md` first.
2. [`.design/overhead-finance/`](.design/overhead-finance/) — new Finance area (Overhead tracking,
   Goals, and cost-basis pricing feeding into the Pricing screen), built on top of the now-live
   site from (1). **Every task in its `TASKS.md` is done as of 2026-09-18**, including the design
   review ([`DESIGN_REVIEW.md`](.design/overhead-finance/DESIGN_REVIEW.md)) and, as of 2026-09-21,
   all five of its should-fix items; only four optional could-improve items remain. Read its
   `HANDOVER.md` first. **Being restructured by (4)** — it stays the authority for every Finance
   decision (4) does not explicitly overturn, but the nav, the capacity model and the landing tab
   are (4)'s now. Don't build new Finance work from this folder alone.
3. [`.design/hubspot-crm-sync/`](.design/hubspot-crm-sync/) — replaces the hand-built CRM with a
   **two-way sync against HubSpot Companies + Contacts** (decided 2026-09-22), keeping a full local
   copy. ABN stays local-only. **Design complete (Grill Me done 2026-09-22, every open question
   resolved in its brief); no code yet and no HubSpot credential created.** Read its `HANDOVER.md`
   first. Build bucket: Opus, effort high.
4. [`.design/price-calculator/`](.design/price-calculator/) — **Finance & Price**: restructures the
   Finance area from (2) into a left-sidebar area with a read-only Dashboard showing the whole
   cost-to-rate chain (overhead incl. gear depreciation → real working-days capacity → profit goals →
   the hourly / half-day / full-day floors), plus an ATO depreciation register. Design complete
   (brief, IA and tasks all written 2026-09-27). **Build complete: all 23 build tasks done, and design-reviewed 2026-09-28** — the
   whole Foundation group (calc, migrations v5–v6, depreciation chain, routes), the sidebar rail,
   the Capacity screen, the Dashboard, the Rate Card's day rows, the whole Depreciation tab
   (register, schedule, CSV export, lodgement lock), the shared info control and the Dashboard's
   GST mirror and post-ratio readout, the Operating Costs double-count hint, the disposal flow,
   Profit Goals' read-only capacity, the estimate editor's day-unit wording, the responsive
   pass, the accessibility pass and the decline curve chart. The review's must-fix and nine of
   its ten should-fixes are done ([`DESIGN_REVIEW.md`](.design/price-calculator/DESIGN_REVIEW.md),
   2026-09-28, live on Pages); what remains is a real VoiceOver pass by a person. A money-math
   audit the same day fixed 15 findings and **re-decided four settled points with the user**
   (income floor, markup rename, ATO tax brackets, per-line price snapshots) — see the handover's
   decisions 6–9; it is live (NAS migrated to v7, then Pages, 2026-09-28). **Deploy order for
   any future server change that adds a boot-time route: NAS before Pages.** All 23
   build tasks are live (NAS + Pages, 2026-09-27/28);
   check its handover for anything
   committed since but not yet pushed or deployed.
   Read its `HANDOVER.md` first. Build bucket: Opus, effort high, and **more of it sits in the
   money-math bucket than is usual** — its `TASKS.md` tags every task, don't re-derive.

   Two things in here a fresh agent will want to argue with, both settled: **the 48-week year is
   retired** (capacity becomes four real fields, which raises every overhead-derived rate ~8%
   knowingly), and **Finance is renamed `Finance & Price` and restructured, not supplemented** — a
   second area writing the same singleton `goals` row would break "one number, one truth". The full
   list of eleven resolved decisions is in its `HANDOVER.md`.
5. [`.design/service-rate-tiers/`](.design/service-rate-tiers/) — every labour service gets
   hourly / half-day / full-day prices on one Rate Card row (a `per [unit ▾]` view switch), each
   auto-filled as income floor × unit hours × (1 + Target Markup), rounded up to the dollar, until the
   user types over it; a card-level Service Day (8 / 4 billable hrs, **not** Capacity's figure); and
   service → unit → Add in the estimate editor. **Brief, IA and tasks written 2026-09-28. Merged to `main` and live: tasks 1–10 done (calc.js unit pricing incl. decision 13 — an auto day is the hourly × its hours, per-service floor comparison, schema v9 + `pricing_shape_outdated` guard, Rate Card rows, Service Day + Show switch, estimate editor unit picker + line unit switch, Dashboard on Service Day + one row per service, responsive pass, accessibility pass); a code review on 2026-09-29 added a fix list (TASKS.md "Code review fixes" R1–R14; R1–R4, the pre-deploy ones, done 2026-09-29; R5–R14 can follow the deploy), task 10 **deployed 2026-09-29** (NAS v9 + Pages, on `main`); design-reviewed 2026-09-29 (no must-fixes; four should-fixes D1–D4 in TASKS.md, all done 2026-09-29), and R5–R14 done the same day except R8 (needs a person in Safari) and R9 (settled, no change). None of that is committed or deployed yet.**
   It knowingly overturns price-calculator's "nothing auto-writes the rate card" — see its brief's
   Resolved Decisions. Read its `HANDOVER.md` first. Build bucket: Opus, effort high (money math).
6. [`.design/estimate-accuracy/`](.design/estimate-accuracy/) — follow-up to a money-logic audit on
   2026-09-30 (the chain is sound; 253 tests pass). **Tasks 1–3, 5(a) and 6 (6a travel time
   auto-priced at the floor, 6b the car per km at cost from Overhead, schema v10) done 2026-09-30 on
   branch `estimate-accuracy`, uncommitted and not deployed (NAS then Pages; `PRICING_SHAPE` is now
   `'travel-km'` and the card must carry it). 5(b) waits on the user. Task 8 (expected booking rate)
   was scrapped by the user and task 11 (loadings) superseded by track 7, both 2026-09-30; next is
   `/grill-me` on 9, 10, 12–14.**
   Three fixes (Capacity's stale "Full Day starts at…" copy, the Target Markup hint, direct costs not
   ex-GST on a GST-inclusive card), four settings (the user saved the FY 2026–27 tax scale and
   confirmed Transport & Logistics Hrs is "Your time" and that income tax stays out of the Overhead
   "Tax" category), and the remaining accuracy features (own-kit equipment, discount, minimum call,
   handling markup, half-day loading) **each with an open decision — run `/grill-me` before building
   them.** Read its `HANDOVER.md` first. Build bucket: Opus, effort high for the money-math tasks;
   its `TASKS.md` tags every one.
7. [`.design/production-booking/`](.design/production-booking/) — the user's 2026-09-30 request in
   place of a booking rate, in five stages built in order: **A** surcharges (short notice, weekend /
   NSW public holiday, after hours; Production section only; folded into the client's price, and
   explained in a user-only Cost Breakdown), **B** Production Booking in the estimate editor (day
   cards on a shared calendar: confirmed / pencilled / proposed), **C** the "LSC Creative" home
   becomes a production calendar dashboard, **D** projects per UPID with a deposit + final invoice
   pair, **E** public client pages for estimates and invoices, with typed-name e-signing of a service
   agreement, scheduled sending through Google Workspace, and Stripe card payment. **Grill Me done
   2026-09-30 and `DESIGN_BRIEF.md` written the same day (66 decisions in its `DECISIONS.md`);
   IA written 2026-10-02 (D58–D66: "Projects" replaces "Estimates" in the nav, hash routes, unique
   UPIDs, Settings becomes a screen, the data model across migrations v11–v14 after B2's renumbering).
   `TASKS.md` written 2026-10-02 (33 tasks: A+B 1–10, C 11–13, D 14–23, E 24–32, review 33).
   On branch `production-booking` (from estimate-accuracy at `e83533a`): task 1 (surcharge
   maths) committed 2026-10-02; task 2 (schema v11: production days, holidays table, surcharged
   `computeTotals`, clash lock, `GET /api/calendar`, `PRICING_SHAPE` `'production-days'`) done
   the same day, committed `a571c67`; task 3 (public holidays: `/api/holidays` routes and a boot
   fetch from Nager.Date) committed `a7c1dc7` the same day; task 4 (the Rate Card's Surcharges and
   Public holidays blocks, Additional work in the defaults) committed `da2db86`; task 5 (the shared
   month calendar component, `web/js/calendar.js`) committed `cbe5f07`; task 6 (the editor's
   Production Booking block: day cards, add-day pop-up, clash lock) committed `685ebbb`; task 7
   (production items on days, live surcharged prices, short notice, matching the server to the
   cent) committed `5261323`; task 8 (estimate detail by day, the client PDF's Production
   Days with folded prices and the proposed-days disclaimer, the owner's Cost Breakdown PDF and
   calc.js `costBreakdown`) committed `0d82f73`; task 9 (the A+B responsive and
   accessibility pass: a polite surcharge announcement, the Short notice tick at 44px on phones,
   everything else measured) and task 9a (money review fixes: after hours per item over its own
   hours, a midnight split with carry-over rows, short notice on items not on a day, Overtime
   moved off set by v11, decisions D67–D72) done the same day, uncommitted. Tasks 9/9a committed `6074c3e`; **task 10 deployed 2026-10-02 (NAS v10+v11, then Pages; `main` at `6074c3e`).** **Stage B2 added 2026-10-03 and built next, before task 11** (D73–D99): day cards take travel, crew and gear through a service menu, lines drag between days, gear rentals by vendor (migration **v12**, so D is now v13 and E v14), deliverables moved and restyled, a surcharge box, larger totals, and a post-production planner (Capture tick + Rate Card Deliverable Types). Design flow done (brief, IA addenda, tasks B2-1…B2-13). B2-1 (`calc.js` `postPlan`, `PRICING_SHAPE` `'deliverable-types'`) done 2026-10-03, committed `33af089`; B2-2 (migration v12 `rentals`, travel/crew/equip on days, rentals on `/api/calendar`) done the same day, uncommitted. Next is B2-3. Client pages are light, in the
   colours of the user's site **lsccreative.studio** (formerly creativelsc.com). Read its `HANDOVER.md` first. Build bucket: Opus, effort high.

**Superseded docs are deleted, not kept around.** A brief or task list that no longer describes
what's being built (the old `localStorage`/Electron-targeted overhead brief, the old
JSON-file-storage app plan) gets removed from the repo entirely once its replacement is written,
rather than left in place marked "historical" — a stale doc sitting next to the current one is
exactly what confuses a fresh agent into treating two specs as both live. Git history is the
record if an old version is ever needed again; don't recreate a "kept for context" folder as a
substitute for checking `git log`.

## Handover discipline

Two standing rules for anyone (human or agent) picking up work in this repo, on any track:

1. **Before starting a task**, state which model/effort bucket it falls into (see "Model / effort"
   below) and pause for the user to switch if the session isn't already running at that setting.
   Sessions don't switch models mid-conversation on their own — saying "this is a money-math task,
   Opus/high" out loud is what actually gets the right model in the seat, not just knowing the rule
   exists.
2. **When you finish a task or a session ends**, update that feature's `HANDOVER.md` before
   stopping: check off what's done in `TASKS.md`, note any decisions made or seams left open, and
   name the exact next unchecked item. If the feature folder has no `HANDOVER.md` yet, create one
   modeled on [`.design/nas-hosted-billing/HANDOVER.md`](.design/nas-hosted-billing/HANDOVER.md) —
   its structure (where the design flow is in the sequence, resolved decisions not to re-litigate,
   how to verify your work) is the template. The goal is that a fresh agent with no memory of this
   session can read one file and know exactly where things stand — never leave that to a diff or
   this file alone.

## Two codebases in this repo — do not confuse them

- **`index.html` / `main.js` / `preload.js`** — the *old* Electron app. Being retired. Only
  touch this to port pieces of its UI into the new build, per the task list.
- **`server/`** — the *new* build. Node/Express + SQLite API, tested with `node --test` in
  `server/test/`. This is where new backend work goes. Run `npm test` inside `server/` after
  any change here — it's fast and it's the acceptance gate for this phase.

## Architecture (short version — see DESIGN_BRIEF.md for the rest)

Frontend will be a **static site on GitHub Pages**. Backend is Node/Express + SQLite in Docker,
running on the user's NAS. Different origins → CORS (`CORS_ORIGINS` env var) and cross-site
session cookies (`COOKIE_SAMESITE=none`, still `Secure` — the NAS API must be served over HTTPS,
e.g. via Cloudflare Tunnel). Security bar is deliberately low: the user judged the data
non-sensitive enough to accept password-auth-on-a-public-port over Tailscale-only access. This
was a conscious call — don't re-raise it as a concern unprompted.

## Model / effort for picking up this work

This is a multi-session build spanning backend API work, a full UI port, and infra/deploy work —
not a quick task, on either track. Set expectations per the *kind* of work in front of you, not
for the whole project at once. `.design/overhead-finance/TASKS.md` and
`.design/price-calculator/TASKS.md` already tag each of their own tasks with the bucket it falls into
(per this same list) — check there first before re-deriving it for a task on either track.

- **Backend API routes, tests, config/infra changes (current phase: PDF export, backups)** —
  `Sonnet, effort: high`. Pattern-matches the existing `server/src/routes/*.js` files closely;
  the risk is in getting the money/PDF details right, not in novel design.
- **The UI port** (porting `index.html`'s ~1300 lines to the GitHub Pages static site, wiring
  every screen to the API, responsive breakpoints, accessibility fixes) — `Opus, effort: high`.
  Large surface area, many interacting pieces (save states, auth redirects, existing dark-editorial
  visual system that must survive pixel-identical above 1100px), worth the higher-capability model.
- **Deployment guide / Docker / Cloudflare Tunnel setup** — `Sonnet, effort: medium`. Mostly
  well-documented, low-ambiguity infra steps.
- **Anything touching money math (`calc.js`, GST, tax set-aside) or auth/session code** —
  `Opus, effort: high` regardless of how small the diff looks. These are the two places a subtle
  bug is expensive (wrong invoice, or a security hole) rather than just annoying.

If unsure which bucket a task falls into, ask rather than defaulting to the cheapest option.

## Credentials for agents

NAS and billing-app logins live in `.credentials.local.md` at the repo root (gitignored — this repo
is public, so passwords must never go in tracked files). Read it when you need to sign in to the
NAS or the live app.
