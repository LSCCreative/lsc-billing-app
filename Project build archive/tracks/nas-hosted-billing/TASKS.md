# Build Tasks: NAS-Hosted LSC Billing

Generated from: .design/nas-hosted-billing/DESIGN_BRIEF.md
Date: 14 August 2026

Each task is independently verifiable. Server tasks are checked with `node test-*.js` or curl, no UI needed until the "Core UI" section. This preserves the old plan's habit of proving the back end before touching the front end — just with a database and an API instead of IPC.

Sections Foundation, Core API, Core UI, Interactions & States, Responsive & Polish and Deployment are **all done** (detail removed to save tokens; see git history of this file). Remaining:

## NAS redeploy fix (2026-09-22 incident — do this before touching deployment again)

`Sonnet, effort: medium` (Docker/deploy-infra, per CLAUDE.md's "Model / effort" table — not the
money-math/auth-code exception, so no need to bump to Opus). Full incident writeup and the exact
fix to make: [DEPLOYMENT.md § 5.5](DEPLOYMENT.md#55-redeploying-server-code-to-the-nas-fix-this-before-the-next-redeploy).
Also see the 2026-09-22 note near the top of [HANDOVER.md](HANDOVER.md).

- [ ] **Parameterize `server/docker-compose.yml`'s data volume** via a `${HOST_DATA_DIR:-./data}`
  substitution instead of the hard-coded `./data:/data`, document the new `HOST_DATA_DIR` var in
  `server/.env.example`, and set it in the NAS's real `.env`
  (`HOST_DATA_DIR=/volume4/lsc-billing/data`) so the compose file itself no longer differs between
  local dev and the NAS.
- [ ] **Write down and use a safe redeploy procedure** in DEPLOYMENT.md (git-on-NAS with
  `git pull`, or `rsync` with an explicit exclude list) — see § 5.5 for the two options and why an
  ad hoc `tar`/`rsync` of the whole `server/` tree caused a real outage this session.
- [ ] **After the fix ships, do the redeploy the NAS has actually been missing**: nothing since the
  initial 2026-09-14 deploy had ever been pushed to the NAS, so the `overhead-finance` track's
  entire backend (`routes/overhead.js`, `routes/goals.js`) only just reached it as a side effect of
  this session's manual fix. Confirm the deployed code now matches `main` exactly (not just "the
  two routes users noticed were broken") before calling this done.
- [ ] **Clean up the stray goals row** left by this session's own verification testing — one-line
  fix, command is in HANDOVER.md's 2026-09-22 note. Do this once, not as a template for future
  cleanup.
- [ ] **Re-verify Pricing's "doesn't survive a refresh" report** against the now-current NAS build
  before assuming the redeploy fixed it too — it was never independently reproduced, only reported
  alongside the two routes that were provably 404ing.

## Review

- [x] **Design review**: Run `/design-review` against the brief once the Core UI and Responsive sections are built. _Done 2026-09-21 — [DESIGN_REVIEW.md](DESIGN_REVIEW.md). Two must-fix (accent text contrast, `--muted2` text), nine should-fix, eight could-improve; none of them fixed yet._
