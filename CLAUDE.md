# LSC Billing App

Quoting/invoicing tool for LSC Creative, rebuilt from a memoryless Electron desktop app into a real
website (GitHub Pages frontend + Node/Express/SQLite API on the user's NAS). Live.

## Start here

**Read [`.design/ROADMAP.md`](.design/ROADMAP.md) first.** It is the one plan across every track and
session: what's live, the branches, who works where (two sessions build here at once), the order of
work, the deploy waves, the seams between tracks, and everything waiting on the user.

`.design/` holds one folder per feature track, each with `DESIGN_BRIEF.md`, `TASKS.md` and
`HANDOVER.md`. **Read only the HANDOVER of the track you are working on** (finished tracks have
short ones now; older build logs were deleted — `git log -p -- <file>` recovers them).

| Track | State | Notes |
|---|---|---|
| [`production-booking/`](.design/production-booking/) | **Active.** Branch `production-booking`. Stages A+B, B2, C and D are built and **deployed** (D: NAS v13 then Pages, `main` at `2c7131b`). Stage E (tasks 24–30, 32) **deployed** 2026-10-05 (NAS v14 then Pages), email live through Resend; task 31 (Stripe) held. Task 33 done: code review fixes C1–C15 and design review fixes DR1–DR17, **deployed 2026-10-05** (NAS then Pages, `main` `df0bd3c`). **Next: nothing queued** (Stripe held; VoiceOver pass by a person). | Surcharges, day-based estimate editor, post-production planner, Home calendar; next projects/invoices, then public client pages, e-signing, Stripe. Decisions D1–D104 in its `DECISIONS.md` are the user's; don't re-ask. Opus, effort high. |
| [`ui-clarity/`](.design/ui-clarity/) | **Building** on branch `ui-clarity` (unpushed). Tasks 1–7 and 9–13 done (tokens, buttons/panels, menu.js, agreement clauses + render, the clause builder, sub-clauses + reset, clause headings on the sign dialog and PDF, the Project page, the Invoice screen, the editor's six panels, its jump rail and sticky bar, the system sweep of the other screens); Metro Sans live; 1–7 and 9–13 went live inside trip-planner's wave 3. Task 14 (accessibility and responsive pass) done 2026-10-12 in **its own git worktree** (`.claude/worktrees/ui-clarity`, fast-forwarded to `main`, so v16) with its own scratch DB (ROADMAP §2). **Next: wave 1**, now Pages only (task 14 is frontend; ask first). Then 16, wave 2, 18. | D1 busy UI → panel system + Actions/Documents menus (Project, Invoice, Editor); D2 branded emails; D3 modular service agreement builder. Decisions U1–U25 in its `DECISIONS.md`. Opus/high, frontend. |
| [`trip-planner/`](.design/trip-planner/) | **Deployed** (live as `main`; the `trip-planner` branch is deleted). Stage A (tasks 1–6) done: schema v16 + server-derived km/hours lines, Maps loader + travel view at `?trip=`, placing stops, routing + linked FROM TRIP lines, details/time on location/reordering, unlink/relink/clear/duplicate + Home base. Map ID created, Google billing confirmed working. Tasks 7–8 (autosave, server and editor), 9–11 (call sheet data, page, public page `c/#s/`, PDF, Project page row, Share and email) 12 (connect Google Calendar: OAuth client created, Settings → Google Calendar with calendar toggles, tested on the user's real account) 13 (Google events on Home and the editor's calendar, Calendars ▾), 14 (writing bookings to Google: the sync engine, Settings → Writing bookings, the day card's mark; tested against a pretend Google, live-checked on the user's real calendar 2026-10-11) 15 (responsive and accessibility pass), 16 (code review), 17 (design review, `DESIGN_REVIEW.md`) 18 (live Google check: legs match Google Maps) and 19 (docs: `DEPLOYMENT.md` §7) done. This folder's checkout is on `main`; the ui-clarity worktree merges `main` forward. **All 20 tasks done; deployed 2026-10-11/12 as wave 3** (NAS v16 then Pages, `main` `70845d8`, with ui-clarity's tasks 1–7 and 9–13 in its history). **Next: the user** connects Google Calendar on the live site and presses Sync existing bookings (`DEPLOYMENT.md` §7). | Per-day trip planner (Google Maps) feeding the per-km and travel-hours lines, a shareable Call sheet, Google Calendar read + write on the existing calendar, and autosave for unsent estimates. Decisions T1–T18, G1–G5, I1–I4 in its `DECISIONS.md`. Google keys in `.credentials.local.md` only. Opus/high, frontend. |
| [`account-recovery/`](.design/account-recovery/) | **Deployed** 2026-10-07 (NAS v15 then Pages, `main` `a728420`); merged into `ui-clarity`. Awaiting the user's live test. | Forgot password by Resend email, reset page `#/reset/<token>`, sign-in by email, Settings → Account. Any `server/` deployed must include v15. Opus/high, frontend. |
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
   user to switch if the session isn't already running at that setting. **Whenever you name the
   model/effort of a task (this one or the next), say plainly if it's a frontend task** (it builds or
   changes anything a person looks at, whatever its bucket tag) with a bold **Frontend task** flag, so
   the user can load the design skills (e.g. `/frontend-design`) before starting it.
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
