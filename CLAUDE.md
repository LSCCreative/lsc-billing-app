# LSC Billing App

Quoting/invoicing tool for LSC Creative, rebuilt from a memoryless Electron desktop app into a real
website (GitHub Pages frontend + Node/Express/SQLite API on the user's NAS). Live.

## Start here

`.design/` holds one folder per feature track, each with `DESIGN_BRIEF.md`, `TASKS.md` and
`HANDOVER.md`. **Read only the HANDOVER of the track you are working on** (finished tracks have
short ones now; older build logs were deleted — `git log -p -- <file>` recovers them).

| Track | State | Notes |
|---|---|---|
| [`production-booking/`](.design/production-booking/) | **Active.** Branch `production-booking`. Stages A+B, B2 and C are built and **deployed** (Stage C live on Pages, `main` at `7910c53`). Tasks 14–21 (invoice maths, schema v13, UPID fix-up, Projects list, project folder, accept + invoices, the invoice screen and PDFs, Settings) built, not deployed. **Next: TASKS.md task 22, Recent activity on Home**, then 23 (D deploy), then E (v14). | Surcharges, day-based estimate editor, post-production planner, Home calendar; next projects/invoices, then public client pages, e-signing, Stripe. Decisions D1–D100 in its `DECISIONS.md` are the user's; don't re-ask. Opus, effort high. |
| [`estimate-accuracy/`](.design/estimate-accuracy/) | Tasks 1–3, 5(a), 6 done and deployed (schema v10). Open: 5(b) waits on the user; `/grill-me` first on 9, 10, 12–14 (each has an open decision); 15 deploy, 16 review. Task 8 scrapped, 11 superseded by production-booking. | Opus/high for money-math tasks. |
| [`hubspot-crm-sync/`](.design/hubspot-crm-sync/) | Design complete, **no code, no HubSpot credential yet.** Two-way sync with HubSpot Companies + Contacts; ABN stays local-only. | Opus/high. Never create anything in the user's HubSpot without asking. |
| [`price-calculator/`](.design/price-calculator/) | Built, reviewed, live. Open: a VoiceOver pass by a person. | Finance & Price area (Dashboard, Capacity, Depreciation, Profit Goals). Settled: 48-week year retired; Finance renamed and restructured; see its HANDOVER decisions 1–9. |
| [`service-rate-tiers/`](.design/service-rate-tiers/) | Built, reviewed, live. Open: R8 (needs a person in Safari), VoiceOver pass. | Hourly / half-day / full-day prices per labour service. Overturns "nothing auto-writes the rate card" knowingly. |
| [`overhead-finance/`](.design/overhead-finance/) | Done. Four optional could-improve items in its `DESIGN_REVIEW.md`. | Authority for Finance decisions unless price-calculator overturns them. |
| [`nas-hosted-billing/`](.design/nas-hosted-billing/) | Done and live. Open: a few redeploy-hardening items in its `TASKS.md`. | Base rewrite; `DEPLOYMENT.md` has the NAS deploy steps. |

Client pages (stage E) are light, in the colours of the user's site **lsccreative.studio**.

**Deploy order for any server change that adds a boot-time route or migration: NAS before Pages.**
Pushing `main` deploys Pages. Ask the user before deploying.

**Superseded docs are deleted, not kept.** Git history is the record. Don't recreate "kept for
context" files, and don't pile per-task build logs into HANDOVER/TASKS: when a task finishes, tick it,
leave a title + commit + one-line outcome, and record only decisions, traps and the exact next item.

## Handover discipline

1. **Before starting a task**, state which model/effort bucket it falls into (below) and pause for the
   user to switch if the session isn't already running at that setting.
2. **When you finish a task or a session ends**, update that feature's `HANDOVER.md`: tick `TASKS.md`,
   note decisions/open seams, name the exact next unchecked item. Keep it short; a fresh agent should
   be able to read one file and know where things stand.

## Two codebases in this repo — do not confuse them

- **`index.html` / `main.js` / `preload.js`** (repo root, git-ignored) — the *old* Electron app, retired.
  Don't touch it.
- **`server/`** — Node/Express + SQLite API, tested with `node --test` in `server/test/`. Run
  `npm test` inside `server/` after any change; it's the acceptance gate.
- **`web/`** — the static frontend. `server/src/calc.js` and `web/js/calc.js` must stay byte-identical
  (a drift test fails otherwise).

## Architecture (short)

Static site on GitHub Pages; API on the NAS in Docker. Different origins → CORS (`CORS_ORIGINS`) and
cross-site cookies (`COOKIE_SAMESITE=none`, `Secure`; API served over HTTPS via Cloudflare Tunnel).
The security bar is deliberately low (user's conscious call) — don't re-raise it, but keep internal
figures (floors, tax set-aside, take-home, Cost Breakdown) off every public route.

## Model / effort

Per-task tags live in each track's `TASKS.md`; check there first.

- **Anything touching money math (`calc.js`, GST, tax, stored/printed prices) or auth/session code** —
  `Opus, effort: high`, however small the diff.
- **UI port / frontend** — `Opus, effort: high`.
- **Backend routes, tests, config** — `Sonnet, effort: high`.
- **Deploy / Docker / Cloudflare** — `Sonnet, effort: medium`.

If unsure, ask rather than defaulting to the cheapest.

## Credentials for agents

NAS and billing-app logins live in `.credentials.local.md` at the repo root (gitignored — the repo is
public, so passwords never go in tracked files).
