# Design Brief: NAS-Hosted LSC Billing

**Status:** Approved direction, pre-build
**Date:** 14 August 2026
**Supersedes:** the storage decision in `BILLING_APP_PLAN.md` (JSON files via Electron IPC). The data model, money model and CRM scope in that plan still stand.

---

## Problem

Lachlan quotes and invoices from a Mac app that forgets everything the moment it quits. Estimates live in a JavaScript array, the Pricing screen's "Save Rates" button lies, and client details get retyped on every job. Beyond the amnesia, the app is welded to one machine — a `.dmg` on one Mac, with an export path hardcoded to that Mac's Google Drive folder. Quoting from a client's site, a second computer, or a phone is impossible. And the one thing that *is* persisted (invoice settings in `localStorage`) is one browser-data wipe away from gone.

The friction is: **the tool that holds his money data can't be trusted to remember it, and can't be reached from anywhere but one desk.**

## Solution

Move the app off the desktop and onto his own hardware. The UGREEN NASync DXP4800 Pro becomes the system of record: a small Node service in a Docker container, a SQLite database on the NAS array, and the existing interface served as a web app to any browser he logs into — Mac, laptop, iPad, phone.

Nothing about the app's *feel* changes. The dark editorial layout, the Delight headings, the terracotta accent, the card grid all survive intact. What changes underneath is that every estimate, client, rate change and invoice is written to a database he owns, on a drive he owns, backed up on a schedule he controls — and reachable wherever he is, behind a login.

The NAS doesn't exist yet. So the same server runs identically on his Mac today against a local data directory. When the hardware lands, one environment variable moves the data path and it's on the NAS. No rewrite, no migration cliff.

## Experience Principles

1. **Owned over hosted** — the data lives on his hardware, in an inspectable SQLite file with plain-text exports, not in someone else's cloud or an opaque app container. He can back it up, copy it, or read it with any tool.
2. **Trust over speed** — every write is confirmed by the server before the UI says "saved." No optimistic UI on financial records. A failed save shouts; it never fails silently the way "Save Rates" does today.
3. **Same tool, more places** — this is a port, not a redesign. If a screen looks or behaves differently after the move, that is a regression unless it's on the explicit change list.

## Aesthetic Direction

- **Philosophy**: Editorial dark utility — a film-lab studio tool, not a SaaS dashboard. Dense information, generous type contrast, one accent colour doing all the work.
- **Tone**: Calm, precise, professional. This is the screen where money gets decided; it should feel steady.
- **Reference points**: The existing app (the reference is itself), Linear's density, a printed rate card.
- **Anti-references**: Xero/QuickBooks chrome and toolbars. Rounded pastel fintech. Anything with a sidebar full of icons he'll never click.

## Existing Patterns

Pulled from the current `index.html` — these are binding.

- **Typography**: `Delight` (Georgia fallback) for headings, page titles, card names and money figures, always `font-weight: 700`. `Funnel Sans` for body and UI at a 13px base. Both are embedded as base64 `@font-face` blobs in the HTML — these move to served `/fonts/*.woff2` files so the HTML shrinks from 236KB to something sane.
- **Colors**: `--bg:#181818`, `--text:#F0EDE8`, `--surface:#2C2F35`, `--border:#3D4A5C`, `--accent:#B85444`, `--ah:#9a3d31`, `--muted:rgba(240,237,232,0.42)`. Note the accent is `#B85444`, not the studio's `--lsc-terra: #C0603C` — the app's value wins; no re-palette in this port.
- **Spacing**: Ad hoc pixel values, no scale. Header 52px, `#main` max-width 1080px with 34px/40px padding, card grid `auto-fill minmax(260px, 1fr)` at 14px gap. Left as-is.
- **Components**: `.btn` family (accent / ghost / danger / sm / xs), `.proj-card`, `.page-head`, `.nav-link` top bar, modal patterns. All reused verbatim.
- **Chrome to remove**: `-webkit-app-region: drag` on the header and `titleBarStyle: hiddenInset` are Electron-only and become meaningless in a browser.

## Architecture

```
Browser (any device)
   │  HTTPS, session cookie
   ▼
Reverse proxy / Tailscale ──► UGREEN DXP4800 Pro
                                └─ Docker container
                                     ├─ Node + Express  (API + static files)
                                     └─ /data volume
                                          ├─ billing.db        (SQLite, WAL)
                                          ├─ backups/          (nightly + pre-write)
                                          └─ exports/          (generated PDFs)
```

**Server**: Node 20 + Express, single container. The DXP4800 Pro runs UGOS Pro with Docker via Container Manager, so a `docker-compose.yml` is the deployment unit. An x86 Core i3, so a standard `linux/amd64` image — no ARM build needed.

**Database**: SQLite (`better-sqlite3`) rather than the JSON files the old plan chose. JSON was right when the writer was a single desktop process; with an HTTP server and multiple browser tabs it isn't. SQLite gives real transactions, no last-write-wins clobbering, and it's still a single file he can copy off the NAS. Hundreds-of-records scale, so this is never a performance question.

**PDF generation** moves server-side (the Electron `printToPDF` bridge is gone). Puppeteer/Chromium in the container renders the same HTML template; the PDF streams to the browser as a download *and* is written to `/data/exports`. The hardcoded Google Drive path in `main.js` dies with the desktop app — export destination becomes a setting.

**Auth**: single account, username + password (Argon2id hash), `httpOnly` `Secure` `SameSite=Strict` session cookie, sessions in the DB. Rate-limited login. Every API route except `/login` and `/health` requires a valid session. No user table beyond the one account, no roles.

**Internet exposure** is the one decision that carries real risk — this app holds bank details, an ABN, client contacts and every rate. The build ships proxy-agnostic (listens on a port, trusts `X-Forwarded-*`) and the deployment guide will recommend **Tailscale over a public reverse proxy**: it gives access from anywhere with no open port, no certificate management, and no login page facing the internet to be brute-forced. If a public URL is genuinely needed later, Cloudflare Tunnel + the same session auth is the fallback path. Password auth alone on a public port is not a configuration this brief endorses.

**Offline behaviour**: none. Per decision, the app is online-only and fails loudly — a clear "Can't reach the server" banner, disabled save buttons, no partial writes. Nothing is cached in the browser that could go stale or conflict.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Login screen | **New** | Only genuinely new UI. Dark, centred card, logo, one field pair. Must look like it belongs. |
| Connection-lost banner | **New** | Sticky, accent-bordered, appears on any failed API call. Disables saves. |
| Session/logout control | **New** | Small item in `#hdr-right` next to the nav links. |
| Estimates list + cards | Exists | Data source changes from `var projects=[]` to `GET /api/estimates`. Visuals untouched. |
| Estimate editor | Modify | Save goes through the API; add a saving/saved/failed state to the button. |
| Pricing screen | Modify | "Save Rates" finally writes. This is the headline bug fix. |
| Invoice Settings modal | Modify | Reads/writes `/api/settings` instead of `localStorage`. One-time import of any existing `localStorage` value on first login. |
| Clients screen + typeahead | **New** | The CRM from `BILLING_APP_PLAN.md`, built against the API rather than a JSON file. |
| PDF export button | Modify | Calls `POST /api/estimates/:id/pdf`, streams a download. Loses "Open Folder." |
| App header | Modify | Drop Electron drag regions; add logout. |

## Key Interactions

- **Login** — password submitted; on success the session cookie is set and the estimates list loads. On failure, an inline error under the field, never a page reload. Three failures inside a minute slows subsequent attempts.
- **Saving an estimate** — button enters a pending state, the request completes, the button confirms and the list re-fetches. If the server is unreachable the button reverts, the banner appears, and the form keeps every keystroke. The user never sees "saved" for something that wasn't.
- **Client typeahead** — typing a business name queries `/api/clients?q=`, debounced. Selecting one fills business, contact, email, phone, ABN and address. Those values are *snapshotted onto the estimate* at save time, so editing a client later never rewrites an old quote's PDF.
- **Editing rates** — changes save to the server and take effect on new estimates only. Estimates store their computed totals, so a rate change never silently rewrites a quote he's already sent.
- **PDF export** — button goes pending while the server renders, then the browser downloads the file. The NAS keeps a copy in `/data/exports`.

## Responsive Behavior

Currently desktop-only at a fixed 1080px column. Because it's now reachable from a phone, three breakpoints:

- **≥1100px** — identical to today. This layout is not to be touched. Any mobile work is siloed in media queries appended at the end of the stylesheet.
- **768–1099px** — `#main` goes fluid, card grid drops to two columns, editor tables scroll horizontally within their container.
- **<768px** — single-column cards, nav collapses to a compact row, editor tables become stacked label/value blocks rather than horizontally scrolling tables. Read-and-review is the realistic phone job; full estimate authoring on a phone is explicitly not a goal.

## Accessibility Requirements

- Text contrast ≥ 4.5:1 against `--bg`/`--surface`. **Flagged now**: `--muted` at `rgba(240,237,232,0.42)` computes to roughly 3:1 on `#181818` and fails. It's used for card metadata, labels and nav links. Raising it to ~0.6 alpha fixes it — a one-line change to be confirmed before the port, not after.
- Full keyboard operation: tab order follows visual order, visible focus rings (currently absent on `.btn`), Escape closes modals, focus trapped inside modals and returned to the trigger on close.
- Login form labelled properly; errors announced via `aria-live`. The connection banner is `role="status"`.
- Touch targets ≥ 44px in the <768px breakpoint — `.btn-xs` at 3px padding is well under and needs a mobile override.

## Out of Scope

- Multi-user accounts, roles, permissions, or any second person using the app.
- Offline support, service workers, local caching, sync or conflict resolution.
- Keeping the Electron app alive in any form — the `.dmg` is retired.
- Native mobile apps.
- Xero/MYOB integration, emailing invoices, payment links, or bank feeds.
- Any change to the money model beyond what `BILLING_APP_PLAN.md` already specifies (GST, tax set-aside, corrected labels).
- Re-theming to the studio's `--lsc-*` tokens.
- Buying, racking, or configuring the NAS itself. This brief makes the software ready; the deployment guide tells him what to do on the day it arrives.

## Architecture update — 7 Sept 2026: GitHub Pages + NAS split

**Supersedes** the "reverse proxy vs Tailscale" open question below, and the single-container assumption in Architecture above. Decision, made explicitly: the frontend is hosted as a static site on **GitHub Pages**; the NAS runs only the API + SQLite (Docker container, unchanged). The NAS therefore needs to be reachable from the public internet on some URL (Cloudflare Tunnel or a reverse proxy in front of it — TLS is required, see below), since GitHub Pages visitors are ordinary browsers, not Tailscale clients.

**Security posture, explicitly chosen by the owner**: the data behind this login (rates, client contacts, ABN, bank details) was judged not sensitive enough to justify Tailscale-only access. Password auth on a public port is an accepted risk here — a deliberate exception to the brief's original recommendation against it, not an oversight.

Consequences already built into the server (`server/src/config.js`, `server/src/app.js`, `server/src/auth.js`):
- `CORS_ORIGINS` env var — allow-list of origins (the GitHub Pages URL) permitted to call the API with credentials. Empty by default (same-origin only).
- `COOKIE_SAMESITE` env var — `strict` by default, set to `none` in this deployment so the session cookie survives the cross-origin fetch from Pages. Still `Secure`, so the API **must** be served over HTTPS even for this "low security need" deployment — `SameSite=None` cookies are rejected by browsers over plain HTTP regardless of risk tolerance. A Cloudflare Tunnel gives free TLS with no port-forwarding.
- Static frontend build/deploy (Pages) is a new task, not yet in TASKS.md's Deployment section — add it there when the UI port begins.

## Open Question

~~**Reverse proxy vs Tailscale**~~ — resolved above: neither in the brief's original sense. A Cloudflare Tunnel (or equivalent) fronts the NAS for the API only; there is no reverse-proxied UI to protect since the UI never touches the NAS filesystem.
