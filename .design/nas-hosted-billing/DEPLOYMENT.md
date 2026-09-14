# Deployment: Cloudflare Tunnel + GitHub Pages

For getting the NAS-hosted API reachable over HTTPS and the `web/` frontend published, once. Read
[HANDOVER.md](HANDOVER.md) first if you haven't — this is the last section of that build.

## What's already true

- The API container runs on the real NAS at `/volume4/lsc-billing/app`, data at
  `/volume4/lsc-billing/data`. `docker compose up -d` from that directory is the whole story —
  see TASKS.md's "Local-to-NAS migration test" for how it got there and the three NAS-specific
  transfer gotchas if you ever need to redo it.
- It's bound to `127.0.0.1:8080` on the NAS — deliberately not reachable from the LAN or internet
  until a proxy sits in front of it. That's this doc.
- The user already runs `cloudflared-tunnel` on the NAS, serving Nextcloud and a self-hosted
  Supabase. It's **token-mode**: routes live in the Cloudflare Zero Trust dashboard, not a local
  `config.yml`. This section adds a route to that same tunnel rather than standing up a second
  one — decided 2026-09-14, since it's one less container to run and monitor, and the billing
  API's security posture (see below) doesn't call for isolation from the other services.

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
network and add `lsc-billing` to it:

```bash
docker inspect cloudflared-tunnel --format '{{json .NetworkSettings.Networks}}'
```

If it's on a custom network (not the default `bridge`), add the billing container to it — either
by editing `server/docker-compose.yml` on the NAS to declare that network as `external: true` and
attach the `billing` service to it, or, without touching the compose file:

```bash
docker network connect <tunnel-network-name> lsc-billing
```

The second form doesn't survive a `docker compose down`/`up` cycle — prefer editing the compose
file if you expect to recreate the container. Confirm reachability from inside the tunnel
container once connected:

```bash
docker exec cloudflared-tunnel wget -qO- http://lsc-billing:8080/health
```

Expect `200 ok` (per the `/health` route from the Foundation phase in TASKS.md).

## 3. Add a public hostname in the Zero Trust dashboard

This step is dashboard-only — nothing here can do it. In **Cloudflare Zero Trust → Networks →
Tunnels → `cloudflared-tunnel` → Public Hostname**, add:

- **Subdomain**: e.g. `billing-api` (pick anything; it becomes part of the URL everyone uses)
- **Domain**: your existing domain
- **Service**: `HTTP` → `lsc-billing:8080` (the container's internal hostname and port on the
  shared Docker network — *not* `127.0.0.1:8080`, which is only reachable from inside the NAS
  itself)

Once saved, `https://billing-api.<your-domain>/health` should return `200 ok` from any browser,
confirming Cloudflare is terminating TLS and forwarding to the container.

## 4. Point the server's CORS and cookie config at the real origins

On the NAS, edit `server/.env` (per `server/.env.example`'s own comments):

```bash
CORS_ORIGINS=https://<your-github-username>.github.io
COOKIE_SAMESITE=none
COOKIE_SECURE=1
```

`COOKIE_SAMESITE=none` requires `COOKIE_SECURE=1` — browsers refuse the combination otherwise —
which is exactly why step 3's HTTPS termination isn't optional. Restart the container to pick up
the change: `docker compose restart` from `/volume4/lsc-billing/app`.

## 5. Publish `web/` to GitHub Pages

Handled by [`.github/workflows/deploy-pages.yml`](../../.github/workflows/deploy-pages.yml) —
automatic on every push to `main` that touches `web/`. Two one-time manual steps first, both in
the GitHub repo's dashboard (can't be scripted from here):

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → New repository secret**, named `LSC_API_BASE`,
   value `https://billing-api.<your-domain>` (from step 3, no trailing slash — see
   `web/js/config.example.js`).

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

Push to `main` once both one-time steps are done, and the Actions tab will show the run. The
deployed URL is `https://<your-github-username>.github.io/<repo-name>/`.

## 6. Verify end to end

- Visit the Pages URL — the login screen should render.
- Sign in. This is a cross-origin request (`github.io` → `billing-api.<domain>`), so it proves
  CORS and the `SameSite=None; Secure` cookie are both correctly configured.
- Create or edit an estimate, save, reload the page, confirm it's still there — proves the
  round trip to the NAS's real SQLite database, not a cached response.
- Open the browser devtools console and check `LSCCalc.computeTotals.length === 4` (per
  `web/README.md`'s existing convention) — confirms the page is running the current `calc.js`
  and not a stale cached copy, even on a repeat visit.
- Hard-refresh (or check Network tab) and confirm the script/style URLs carry the current
  commit's `?v=` query string.

## Left open, on purpose

Per CLAUDE.md's security-posture decision, this deployment is intentionally password-auth on a
public hostname rather than Tailscale-gated — don't re-raise that as a concern unprompted.
