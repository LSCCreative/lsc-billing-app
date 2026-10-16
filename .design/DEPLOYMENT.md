# Deployment runbook

Read this only when deploying or redoing infrastructure. Logins and keys: `.credentials.local.md`
(gitignored; the repo is public). The long original with the 2026-09-22 incident write-up is in
`Project build archive/tracks/nas-hosted-billing/DEPLOYMENT_full.md`.

## What is live

| Part | Where |
|---|---|
| Site | GitHub Pages, `https://app.lsccreative.studio/`. Cloudflare DNS `app` CNAME → `lsccreative.github.io`, **DNS only** (grey cloud). Pages source = GitHub Actions, custom domain set, HTTPS enforced. |
| API | Docker on the NAS at `/volume4/lsc-billing/app`, data `/volume4/lsc-billing/data`, bound to `127.0.0.1:8080`, container `lsc-billing` on network `media_net`. |
| Tunnel | Cloudflare Tunnel `deck-productions-nas` (container `cloudflared-tunnel`, token mode): `billing.lsccreative.studio` → `http://lsc-billing:8080`. Routes are edited in the Zero Trust dashboard. |
| Why one domain | The site and API must share `lsccreative.studio`, or the session cookie is third-party and iPhone/Safari/Incognito drop it (sign-in "works", next request 401s). |

## Deploying

Ask the user first. `git fetch` and diff `origin/main` before any copy or push. **NAS before Pages**
whenever the server adds a migration or route; Pages alone for web-only changes. Pushing `main`
deploys Pages (workflow publishes `web/` on pushes touching it, writes `web/js/config.js` from
secrets, appends `?v=<sha>` to local script/css URLs).

**NAS (server code):**
1. Back up the live DB: `sqlite3 ".backup"` into `/volume4/lsc-billing/data/backups/` (or `exports/`).
2. Copy `server/` over with `COPYFILE_DISABLE=1 tar` through `ssh lsc-nas`, **excluding
   `node_modules`, `data`, `.env`, `docker-compose.yml`**. rsync to the NAS is refused. Never copy the
   whole tree blind: a past overwrite reverted the compose volume path and crash-looped the API.
3. `cd /volume4/lsc-billing/app && docker compose up -d --build`. **Not `restart`**: restart keeps
   the old env, so an edited `.env` is silently ignored (CORS then fails invisibly to curl).
4. Check `healthy`, the boot log's migration line (`migrated to vN`), and hit a route the old build
   lacked (expect 401/200, not 404). `/health` answers from the old image and proves nothing.
5. If a migration ships, run it on a copy of the backup first.

**Pages:** push `main`. Check the Actions run succeeded and the live `?v=` matches the commit.

Open hardening (low priority, may be stale): parameterise the compose volume as
`${HOST_DATA_DIR:-./data}`, with `HOST_DATA_DIR` set in the NAS `.env`, so the compose file stops
differing between local and NAS.

## NAS `server/.env` (see `server/.env.example`)

```
CORS_ORIGINS=https://app.lsccreative.studio,https://lsccreative.github.io   # scheme+host, no path
COOKIE_SAMESITE=none
COOKIE_SECURE=1
APP_URL=https://app.lsccreative.studio/
MAIL_FROM=admin@lsccreative.studio     # + SMTP_PASS (Resend key "LSC Billing App (NAS)"), MAIL_REPLY_TO
GOOGLE_MAPS_SERVER_KEY=               # "LSC Billing — server" key, Maps Static only
GOOGLE_OAUTH_CLIENT_ID=               # client "LSC Billing — NAS calendar"
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://billing.lsccreative.studio/api/google/oauth/callback
```

`APP_ORIGIN` stays unset (falls back to `APP_URL`). **Never set `GOOGLE_CALENDAR_WRITE=0` on the
NAS**: that is the dev-server switch and would stop live bookings writing to Google. A missing Google
or mail value only disables that one feature.

## Pages secrets (Settings → Secrets and variables → Actions)

`LSC_API_BASE` = `https://billing.lsccreative.studio` (no trailing slash), `LSC_MAPS_KEY` = the
**LSC Billing — browser** key, `LSC_MAPS_ID` = Map ID **LSC Billing — trip planner**. Without the Maps
ones the travel view says Maps isn't set up; the build still deploys.

## Google Cloud (project "LSC Production Decks"), checked 2026-10-13

- Browser key website restrictions: `https://app.lsccreative.studio/*`,
  `https://lsccreative.github.io/*`, `http://localhost:5173/*` (the console refuses a wildcard
  port; a preview on another port needs a row). 4 APIs.
- Server key: Maps Static API only.
- OAuth client "LSC Billing — NAS calendar": redirect URIs `https://billing.lsccreative.studio/api/
  google/oauth/callback` and `http://localhost:8080/api/google/oauth/callback`; no JS origins. The
  consent screen is Internal (Workspace only): no verification, no 7-day token expiry.
- A $1 budget alert on the billing account is still the user's to set.

## After a trip-planner/Google deploy (user, in this order)

Settings → Google Calendar → Connect → switch on calendars → **Sync existing bookings** once → check
a trip routes (browser key + Map ID) and a call sheet shows its route map (server key).

## Local verification after any change

Sign in (proves the cookie round-trips cross-origin), create/edit/reload an estimate (proves the save
reaches SQLite), and `LSCCalc.computeTotals.length === 4` in devtools (the page isn't running a stale
cached `calc.js`).
