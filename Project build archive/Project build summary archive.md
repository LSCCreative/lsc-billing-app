# Project build summary archive

**Agents: do not read this unless a critical problem or misunderstanding can't be settled from
`CLAUDE.md`, `.design/ROADMAP.md` and `.design/WORKING_NOTES.md`.** It records what each finished
track built, so you can find the original design, decisions and build notes (in `tracks/<name>/`)
when a built slice behaves in a way you can't explain. Each track folder holds some of:
`DESIGN_BRIEF.md`, `INFORMATION_ARCHITECTURE.md`, `DECISIONS.md`, `TASKS.md`, `HANDOVER.md`,
`DESIGN_REVIEW.md`, and local-only `screenshots/` (gitignored). The HANDOVER's "Traps" and "Decisions
made in task N" sections are where complexity notes live.

Order is build order. Schema versions in brackets.

## nas-hosted-billing (base rewrite)
Electron desktop app → website: static frontend on GitHub Pages, Express/SQLite API on the NAS in
Docker, Cloudflare Tunnel, cookie auth, estimates, clients, rate card, PDF export, backups.
Settled: low security by choice; GST-free is a per-estimate flag only. Notes: `DESIGN_BRIEF.md`
(architecture update), `DEPLOYMENT_full.md` (the 2026-09-22 redeploy outage in full), `TASKS.md`
(redeploy-hardening leftovers).

## overhead-finance
Finance area: Overhead items, Goals, computed Overhead Rate/hr, donut + trend charts, Minimum Job
Price line and its cost-breakdown dialog. HANDOVER holds ~80 numbered UI/implementation decisions
(chart rules, focus, error tokens); the first ~7 are money decisions, now in WORKING_NOTES.
Open: four optional could-improve items in `DESIGN_REVIEW.md`.

## price-calculator (Finance & Price)
Restructured Finance: Dashboard, Capacity (four real fields, 1,776 hrs), Depreciation (ATO + replacement
reserve), Profit Goals, income floor vs cost floor, tax years, Target Markup rename, saved-line
snapshots. Decisions 1–9 and the accounting traps are in its HANDOVER (and WORKING_NOTES).
`INFORMATION_ARCHITECTURE.md` has the arithmetic order.

## service-rate-tiers
Hourly / half-day / full-day prices per labour service, auto prices from the floor, Service Day
hours, `unitDef`, Rate Card row units, PDF prints service name only. Knowingly overturns "nothing
auto-writes the rate card". [v9] Open: R8 (Safari select-on-focus).

## estimate-accuracy
Audit of the money chain; built tasks 1 (Capacity copy), 2 (Target Markup hint), 3 (ex-GST direct
costs), 5a (Transport & Logistics "Your time" default), 6a/6b (own-time travel at the floor; car per
km at cost, vehicle cost per km on Overhead) [v10]. Open tasks live in `.design/estimate-accuracy/`.
`TASKS.md` here has the full audit ("Source"), Done notes, and the scrapped/superseded tasks 8 and 11.

## production-booking (stages A–E)
Surcharges, booking days and shared calendar, B2 post-production planner and gear rentals, Home
calendar dashboard and hash router, Projects with deposit/final invoices (UPIDs), client pages
(`web/c/`), e-signing, Resend email and send queue, code review C1–C15, design review DR1–DR17.
[v11 A+B, v12 rentals, v13 projects, v14 sent versions/signatures] `DECISIONS.md` has the user's
D1–D104 (don't re-ask); `INFORMATION_ARCHITECTURE.md` has routes, screens and data model;
`HANDOVER.md` has the per-task seams. Task 31 (Stripe card payment) is **held (D101)**: design is in
the brief (D49 passes the card fee on).

## account-recovery
Forgot password by Resend email, reset page `#/reset/<token>`, sign-in by email, Settings → Account
(`routes/account.js`, `scripts/set-account-email.js`). [v15] Five built-in decisions in its HANDOVER.

## ui-clarity
Token system, panel system, `menu.js` (Actions/Documents menus, phone sheets), modular service
agreement builder (13 clauses, sub-clauses, `agreementLayout`), Project page, Invoice screen, editor's
six panels with jump rail and sticky bar, system sweep, a11y/responsive pass, branded email shell,
Metro Sans, design review (all fixed). HANDOVER "Traps" has the menu, grid and font gotchas.
`seed-review.js` (now `.design/seed-review.js`) builds the review dataset on the scratch DB.

## trip-planner
Per-day trip planner on Google Maps feeding per-km and travel-hours lines (FROM TRIP), shareable Call
sheet (page `c/#s/`, PDF, email), Google Calendar read (Home, editor) and write (sync engine), Home
base, editor autosave. [v16] Decisions T1–T18, G1–G5, I1–I4 in `DECISIONS.md`; HANDOVER holds one
"Decisions made in task N" block per task and a Traps list. Should-fixes (one km rule, no R badge)
deployed 2026-10-12. Open: the Routes API tier choice.

## hubspot-crm-sync
Designed 2026-09-22, never built, **scrapped by the user 2026-10-13**. Docs deleted; git history has
them (`git log -- .design/hubspot-crm-sync`). The local Clients table stays as the CRM.
