# Deployment: Cloudflare Tunnel + GitHub Pages

For getting the NAS-hosted API reachable over HTTPS and the `web/` frontend published, once. Read
[HANDOVER.md](HANDOVER.md) first if you haven't — this is the last section of that build.

**Status: live as of 2026-09-14.** API at `https://billing.lsccreative.studio`, frontend at
`https://lsccreative.github.io/lsc-billing-app/`. The steps below are the record of how it was
done, kept as a runbook for redoing any part of it (a new NAS, a rotated tunnel, a fresh clone of
the repo).

## What's already true

- The API container runs on the real NAS at `/volume4/lsc-billing/app`, data at
  `/volume4/lsc-billing/data`. `docker compose up -d` from that directory is the whole story —
  see TASKS.md's "Local-to-NAS migration test" for how it got there and the three NAS-specific
  transfer gotchas if you ever need to redo it.
- It's bound to `127.0.0.1:8080` on the NAS — deliberately not reachable from the LAN or internet
  until a proxy sits in front of it. That's this doc.
- The user already runs a Cloudflare Tunnel on the NAS, container named `cloudflared-tunnel`,
  **tunnel name `deck-productions-nas`** in the Zero Trust dashboard, serving Nextcloud
  (`media.lsccreative.studio`) and a self-hosted Supabase (`db.productiondecks.online`). It's
  **token-mode**: routes live in the dashboard, not a local `config.yml`. This section adds a
  route to that same tunnel rather than standing up a second one — decided 2026-09-14, since it's
  one less container to run and monitor, and the billing API's security posture (see below)
  doesn't call for isolation from the other services.
- The billing API's public hostname is **`billing.lsccreative.studio`**, matching the
  `lsccreative.studio` domain already in use for `media.lsccreative.studio`.

## 1. Recommendation: Cloudflare Tunnel, not Tailscale

The brief originally left Tailscale-only access vs. a public reverse proxy as an open question.
It's closed: **Cloudflare Tunnel with password auth on a public hostname**, per the security
posture decided with the user and recorded in CLAUDE.md — the data (rates, client contacts, ABN,
bank details) was judged not sensitive enough to justify Tailscale-only access, and
password-auth-on-a-public-port was accepted as a conscious risk. Putting the API behind
Tailscale would reintroduce exactly the access friction that decision opted out of (every device
that needs to quote a job would need the Tailscale client installed and authenticated), for a
security bar the user already decided against. Cloudflare Tunnel also requires no port-forwarding
or certificate management, and reuses tooling already running on the NAS.

## 2. Join the billing container to the tunnel's network

`cloudflared-tunnel` can only reach services on a Docker network it's attached to. Find that
network:

```bash
docker inspect cloudflared-tunnel --format '{{json .NetworkSettings.Networks}}'
```

**On this NAS, that network is `media_net`** (shared with `lsc-media-server`; `cloudflared-tunnel`
is also on the default `bridge`, which doesn't help here). `server/docker-compose.yml` now
declares `media_net` as `external: true` and attaches the `billing` service to it alongside its
own `default` network, so this happens automatically on any `docker compose up -d` from
`/volume4/lsc-billing/app` — nothing extra to run day to day. If the tunnel ever moves to a
different network, update the `networks:` block in that compose file to match before recreating.

Confirm reachability once the container is up. The `cloudflared` image has no shell (`wget`/`sh`
aren't available inside it, so `docker exec` won't work for this) — run a throwaway container on
the same network instead:

```bash
docker run --rm --network media_net curlimages/curl:latest -sf http://lsc-billing:8080/health
```

Expect `ok` (per the `/health` route from the Foundation phase in TASKS.md).

## 3. Add a public hostname in the Zero Trust dashboard

This step is dashboard-only — nothing here can do it. In **Cloudflare Zero Trust → Networks →
Tunnels → `deck-productions-nas`** (the tunnel's dashboard name; its container is
`cloudflared-tunnel`) **→ Published application routes**, add:

- **Subdomain**: `billing`
- **Domain**: `lsccreative.studio`
- **Service**: `HTTP` → `lsc-billing:8080` (the container's internal hostname and port on
  `media_net` — *not* `127.0.0.1:8080`, which is only reachable from inside the NAS itself)

This gives `billing.lsccreative.studio`, alongside the tunnel's existing
`media.lsccreative.studio` and `db.productiondecks.online` routes. Once saved,
`https://billing.lsccreative.studio/health` returns `ok` from any browser, confirming Cloudflare
is terminating TLS and forwarding to the container.

## 4. Point the server's CORS and cookie config at the real origins

On the NAS, edit `server/.env` (per `server/.env.example`'s own comments):

```bash
CORS_ORIGINS=https://lsccreative.github.io
COOKIE_SAMESITE=none
COOKIE_SECURE=1
```

**No trailing path** — `CORS_ORIGINS` matches the request's `Origin` header, which is scheme and
host only (`https://lsccreative.github.io`), even though the deployed site itself lives at
`https://lsccreative.github.io/lsc-billing-app/`. `COOKIE_SAMESITE=none` requires
`COOKIE_SECURE=1` — browsers refuse the combination otherwise — which is exactly why step 3's
HTTPS termination isn't optional.

🔴 **`docker compose restart` does *not* pick up an edited `.env`.** It restarts the existing
container with the environment it was created with — `env_file` values are baked in at container
*creation*, not re-read on restart. Editing `.env` and running `restart` leaves the old
`CORS_ORIGINS` in place; found here, because the container answered `/health` fine but silently
sent no `Access-Control-Allow-Origin` header at all, which a browser reports as "could not reach
the server" (a `fetch` blocked by CORS throws, and `api.js` classifies any throw as `network`)
even though `curl` against the exact same URL looks completely healthy — the CORS failure is
invisible to anything that isn't a real cross-origin browser request. **Use `docker compose up -d`
instead**, which recreates the container with the current `.env`, any time an env var changes:

```bash
cd /volume4/lsc-billing/app && docker compose up -d
```

## 5. Publish `web/` to GitHub Pages

Handled by [`.github/workflows/deploy-pages.yml`](../../.github/workflows/deploy-pages.yml) —
automatic on every push to `main` that touches `web/`. Repo:
[`LSCCreative/lsc-billing-app`](https://github.com/LSCCreative/lsc-billing-app) (created and
pushed 2026-09-14; the old Electron app files stay untracked on disk, gitignored, per the "being
retired, not yet deleted" note in CLAUDE.md).

**Pages source is set to GitHub Actions and the `LSC_API_BASE` secret is set** to
`https://billing.lsccreative.studio` — both done during setup. If either is ever reset (a repo
transfer, a secret rotation), redo them here:

- **Settings → Pages → Source: GitHub Actions.**
- **Settings → Secrets and variables → Actions → New repository secret**, named `LSC_API_BASE`,
  the API's HTTPS URL, no trailing slash (see `web/js/config.example.js`).

What the workflow does on every run, so nothing here needs to be repeated by hand:

- Writes `web/js/config.js` (gitignored — never committed, since it would hardcode the NAS
  hostname into a public repo) from the `LSC_API_BASE` secret.
- Appends `?v=<short commit sha>` to every local `<script src="js/...">` and
  `<link href="css/...">` reference in `web/index.html`, so a new deploy is always a new URL and
  a browser's cached copy of, say, `js/calc.js` can never silently disagree with the server's
  money model — the exact bug found and written up in HANDOVER.md and TASKS.md's Pages task
  during development.
- Uploads and deploys `web/` via the standard `actions/*-pages` action trio (OIDC-based; no
  personal access token needed).

Push to `main` (or trigger manually from the Actions tab) to deploy. The deployed URL is
`https://lsccreative.github.io/lsc-billing-app/`.

## 5.5. Redeploying `server/` code to the NAS (fix this before the next redeploy)

The API code didn't have a repeatable redeploy path — `git clone`/`git pull` was never set up on
the NAS, so the only way anyone had to get newer `server/` code onto it was to copy files over by
hand (`rsync`/`tar` over SSH). **That caused a real outage on 2026-09-22**: copying the whole
`server/` tree onto `/volume4/lsc-billing/app` overwrote the NAS's `docker-compose.yml` with the
git-tracked version, whose `volumes:` line is `./data:/data` (the local-dev default — see the
comment in `server/docker-compose.yml`). The NAS's copy of that file had been hand-edited to
`/volume4/lsc-billing/data:/data`, the actual host path (`server/docker-compose.yml`'s own header
comment tells you to do exactly this edit — "NAS: change the volume's host path to a real share").
The overwrite silently reverted that edit. `docker compose up -d --build` then created a **new,
empty** `./data` folder next to the compose file, owned by the SSH login user, which the
container's non-root `node` user (uid 1000 inside the image) can't write to — the container
crash-looped on `EACCES: mkdir '/data/backups'` and the site was down until the volume line was
fixed back by hand and the container recreated. The real `billing.db` was never touched (it's a
different path than the one the broken container mounted), and a manual snapshot was taken first
into `/volume4/lsc-billing/manual-backup/` — but this must not depend on getting lucky twice.

**Root cause:** the host-side data path is a NAS-specific fact that only exists as a hand-edit to
a git-tracked file. Nothing enforces that the edit survives a redeploy, and nothing in this doc
told the next person doing a code-only redeploy that `docker-compose.yml` was one of the
NAS-local files, alongside `.env` and `data/`, that must not be blindly overwritten.

**Fix to make (not yet done — first task for whoever picks this up, see TASKS.md):**

1. **Parameterize the host data path** in `server/docker-compose.yml` instead of hard-coding it:
   ```yaml
   volumes:
     - ${HOST_DATA_DIR:-./data}:/data
   ```
   Docker Compose reads `${VAR}` substitutions in the compose file itself from a `.env` file in
   the same directory (this is separate from the `env_file:` directive, which only injects vars
   *into the container*) — so this makes `docker-compose.yml` identical on every machine, and the
   one thing that differs (the real host path) lives in `.env`, which is already gitignored and
   already NAS-local. Add `HOST_DATA_DIR=/volume4/lsc-billing/data` to the NAS's real `.env`, and
   document the var (with the `./data` local default) in `server/.env.example`.
   After this change, a wholesale overwrite of `docker-compose.yml` can never again silently
   switch the volume mount back to the local-dev default.
2. **Write down a safe redeploy procedure** here (replacing ad hoc `rsync`/`tar` by hand) — the
   three files that must never be blown away by a redeploy are `.env`, `data/`, and (until step 1
   ships) `docker-compose.yml`. Once step 1 ships, `docker-compose.yml` stops being NAS-local and
   can be copied freely. Two reasonable options, either is fine:
   - **Git on the NAS**: `git clone` the repo into `/volume4/lsc-billing/app` once, then
     `git pull && docker compose up -d --build` for every redeploy. Simplest, and gets you `git
     diff`/`git log` on the NAS for free if something looks wrong after a deploy. Needs deploy
     access to the repo from the NAS (an SSH deploy key or HTTPS token), and `.env`/`data/` must
     stay gitignored (already true) so `git clean`/`git pull` never touches them.
   - **rsync with an explicit exclude list**, if git-on-NAS isn't wanted: always exclude
     `node_modules`, `data`, `.env`, and — until step 1 ships — `docker-compose.yml`, e.g.
     `rsync -az --delete --exclude node_modules --exclude data --exclude .env --exclude
     docker-compose.yml server/ user@nas:/volume4/lsc-billing/app/`.
3. **After any redeploy**, don't just check `docker ps`/`/health` — those were green in the
   original incident's "healthy" reading right before the crash loop, and `/health` had been
   returning 200 the whole time because it was still answering off the *old* container image.
   Confirm the new code actually took effect (e.g. hit a route that didn't exist in the old build,
   like `GET /api/goals`, and expect 200 not 404) before calling a redeploy done.

## 6. Verified end to end (2026-09-14)

- `https://lsccreative.github.io/lsc-billing-app/` loads the login screen with no error banner.
- The cross-origin `GET /api/session` preflight and request both return the correct
  `Access-Control-Allow-Origin: https://lsccreative.github.io` header, confirmed with `curl`
  against the real tunnel URL and separately in a real browser tab (network log matched).
- The deployed `web/js/config.js` correctly reads
  `window.LSC_API_BASE = 'https://billing.lsccreative.studio';`, generated at build time from the
  secret, never committed.
- Every local script/stylesheet URL in the deployed `index.html` carries the deploying commit's
  `?v=` query string.
- **Not yet done**: an actual sign-in and a save round-trip — that needs real account credentials,
  which only the user has (see the "Login accounts" note in HANDOVER.md). Everything a sign-in
  depends on (CORS, cookie flags, config generation, cache-busting) is already proven above; a
  manual login is the last confirmation, not a debugging step. To re-run this checklist after any
  future change: sign in (proves the `SameSite=None; Secure` cookie round-trips cross-origin),
  create/edit/reload an estimate (proves the save reaches the NAS's real SQLite database, not a
  cache), and check `LSCCalc.computeTotals.length === 4` in devtools (per `web/README.md`'s
  existing convention, confirms the page isn't running a stale cached `calc.js`).

## Left open, on purpose

Per CLAUDE.md's security-posture decision, this deployment is intentionally password-auth on a
public hostname rather than Tailscale-gated — don't re-raise that as a concern unprompted.
