# Handover: NAS-Hosted Billing → GitHub Pages Website

For a fresh agent picking this up. Root: the repo containing this `.design/` folder. Read
[CLAUDE.md](../../CLAUDE.md) first for the model/effort guidance and the two-codebases warning.

> **2026-09-22:** the Clients CRM described below is being replaced by a two-way HubSpot sync — see
> [`../hubspot-crm-sync/HANDOVER.md`](../hubspot-crm-sync/HANDOVER.md). The `clients` table and
> `client_json` snapshot behaviour documented here remain the starting point for that work.

## What this is

Overhauling the LSC Billing App from a memoryless Electron desktop app into a real website.
Frontend on GitHub Pages, backend (Node/Express + SQLite) in Docker on the user's NAS. Full
rationale, architecture diagram and experience principles: [DESIGN_BRIEF.md](DESIGN_BRIEF.md).

## State as of 2026-10-03

Live: **https://lsccreative.github.io/lsc-billing-app/** talking to **https://billing.lsccreative.studio**
(Cloudflare Tunnel to the NAS). Every section of TASKS.md is complete except a handful of
redeploy-hardening items (see its "NAS redeploy fix"). Since the 2026-09-22 incident (a redeploy that
overwrote the NAS's hand-edited `docker-compose.yml`), every deploy has worked by: `sqlite3 ".backup"`
the live DB, tar-copy `server/` over **excluding `node_modules`, `data`, `.env` and
`docker-compose.yml`**, `docker compose up -d --build`, check `healthy` + boot log. Full steps:
[`DEPLOYMENT.md`](DEPLOYMENT.md). **Deploy order: NAS before Pages.** Logins: `.credentials.local.md`.

The per-section build log that used to sit here was removed to save agent tokens
(`git log -p -- .design/nas-hosted-billing/HANDOVER.md`).

## Resolved decisions (do not re-litigate)

Everything in DESIGN_BRIEF.md's "Resolved decisions"-equivalent content, plus, decided
2026-09-07 and documented in DESIGN_BRIEF.md's "Architecture update" section:

1. **Hosting split**: GitHub Pages (static frontend) + NAS (API + SQLite), not a single
   container serving both. This supersedes the brief's original Tailscale-vs-reverse-proxy
   framing — there's no UI to protect behind Tailscale anymore, only the API.
2. **Security posture is deliberately low**: the user judged the data (rates, client contacts,
   ABN, bank details) not sensitive enough to justify Tailscale-only access, and accepted
   password-auth-on-a-public-port as a conscious risk. Don't raise this as a concern again unless
   asked.
3. **`SameSite=None` still requires HTTPS** on the NAS API even in this low-security deployment —
   browsers won't send the cookie otherwise, security posture aside. A Cloudflare Tunnel is the
   low-effort way to get TLS without port-forwarding or cert management.
4. **GST-free estimates are in scope, per estimate** — decided with the user 2026-09-10. This
   **supersedes DESIGN_BRIEF.md's out-of-scope line** ("any change to the money model beyond what
   `BILLING_APP_PLAN.md` already specifies"), which the brief wrote before GST had any UI at all.
   The scope granted is a per-estimate flag and nothing wider: a **per-line-item** GST flag was
   considered and *not* chosen, so don't build one without asking again. The GST-inclusive pricing
   rule that came with it (a GST-free job bills the listed rate) is a decision, not arithmetic —
   it is written up above and in `calc.js`'s header, and should not be quietly re-derived.

## Verifying your work

`cd server && npm test` after any backend change (the frontend has no test suite; verify it in a
browser against a running API, per `web/README.md`) — it's fast (a few seconds, dominated by the one
real Chromium render in `test-pdf.js`) and it's the acceptance gate for this phase, same pattern
as the existing `test-auth.js`/`test-db.js`/`test-calc.js`/`test-backup.js`/`test-pdf.js`/
`test-ratecard.js`/`test-section-labels.js`. New routes should get a corresponding test in
`server/test/test-api.js` (follow its existing pattern: spin up the app on an ephemeral port, log in
once in `test.before`, reuse the cookie).

`npm test` also covers three things that are not routes: that `web/js/calc.js` still matches
`server/src/calc.js` (in `test-calc.js`), that an estimate saved before pricing is ever
configured still prices against the default rate card (`test-ratecard.js`), and that a renamed or
deleted labour category doesn't rewrite the headings on an already-sent document
(`test-section-labels.js`).

**A green suite is not the gate on its own.** Both bugs found in the Pricing port passed every test
in the suite: the repeat-save no-op was invisible to a test that saved once, and the PDF dropping
`sectionLabels` was invisible to tests that called `buildEstimateHtml` directly instead of going
through the route. When a change touches something a person *looks at* — a document, a saved
figure, a second attempt at the same action — go and look at it: re-export the PDF and read the
text, save twice and re-read from the server, not just from the screen that told you it worked.

For frontend work, use the **`api-scratch`** launch config rather than `api` — same server against
`DATA_DIR=/tmp/lsc-billing-scratch`, so creating and deleting estimates while testing doesn't touch
`server/data`. Seeding instructions are in `web/README.md`.
