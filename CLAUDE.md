# LSC Billing App

Quoting/invoicing tool for LSC Creative. **Currently mid-overhaul**: rebuilding from a
memoryless Electron desktop app into a real website. Read before touching anything.

## Start here

`.design/` holds one self-contained folder per feature track — each has its own `DESIGN_BRIEF.md`,
`TASKS.md`, and (once any work has happened on it) `HANDOVER.md`. Four tracks exist right now:

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
   (brief, IA and tasks all written 2026-09-27). **Build in progress: 14 of 21 tasks done** — the
   whole Foundation group (calc, migrations v5–v6, depreciation chain, routes), the sidebar rail,
   the Capacity screen, the Dashboard, the Rate Card's day rows, the whole Depreciation tab
   (register, schedule, CSV export, lodgement lock) and the shared info control.
   Everything through the lodgement lock is live (NAS + Pages, 2026-09-27); check its handover for
   what is committed but not yet pushed.
   Read its `HANDOVER.md` first. Build bucket: Opus, effort high, and **more of it sits in the
   money-math bucket than is usual** — its `TASKS.md` tags every task, don't re-derive.

   Two things in here a fresh agent will want to argue with, both settled: **the 48-week year is
   retired** (capacity becomes four real fields, which raises every overhead-derived rate ~8%
   knowingly), and **Finance is renamed `Finance & Price` and restructured, not supplemented** — a
   second area writing the same singleton `goals` row would break "one number, one truth". The full
   list of eleven resolved decisions is in its `HANDOVER.md`.

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
