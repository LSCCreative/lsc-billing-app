# LSC Billing App

Quoting/invoicing tool for LSC Creative. **Currently mid-overhaul**: rebuilding from a
memoryless Electron desktop app into a real website. Read before touching anything.

## Start here

1. [`.design/nas-hosted-billing/HANDOVER.md`](.design/nas-hosted-billing/HANDOVER.md) — **the
   current build**, what's done, what's next, exactly where to pick up.
2. [`.design/nas-hosted-billing/DESIGN_BRIEF.md`](.design/nas-hosted-billing/DESIGN_BRIEF.md) —
   why, architecture, experience principles. Binding unless HANDOVER.md says otherwise.
3. [`.design/nas-hosted-billing/TASKS.md`](.design/nas-hosted-billing/TASKS.md) — the ordered
   checklist. Work top-down through the unchecked items unless told otherwise.

Two other docs exist and are **superseded, historical context only**:
`BILLING_APP_PLAN.md` (JSON-file storage — superseded by SQLite) and
`.design/overhead-profit-goals/` (a separate, paused feature track — not part of this overhaul,
do not touch unless explicitly asked to resume it).

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
not a quick task. Set expectations per the *kind* of work in front of you, not for the whole
project at once:

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
