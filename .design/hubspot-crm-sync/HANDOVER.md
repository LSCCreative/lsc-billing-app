# Handover: HubSpot Two-Way CRM Sync

For a fresh agent picking this up. Root: the repo containing this `.design/` folder. Read
[CLAUDE.md](../../CLAUDE.md) first for model/effort guidance and the handover discipline rules.
Rationale, architecture and decisions: [DESIGN_BRIEF.md](DESIGN_BRIEF.md). Task list:
[TASKS.md](TASKS.md).

## What this is

Replace the hand-built CRM (`clients` table, `server/src/routes/clients.js`, Clients screen) with a
**two-way sync against HubSpot Companies + Contacts**, while the billing app keeps a complete local
copy so leaving HubSpot loses nothing. The frontend never talks to HubSpot; the NAS API does.

## State as of 2026-09-22 (end of Grill Me session)

**Design complete. No code written. Nothing created or changed in HubSpot.** The Grill Me task is
done: every open question in the brief is resolved (decisions 5–16 under "Resolved at Grill Me" in
[DESIGN_BRIEF.md](DESIGN_BRIEF.md)), and the later TASKS.md items were reworded to match.

**Next unchecked item: Create the HubSpot credential** (infra — Sonnet/medium). It is a change to
Lachlan's HubSpot account, so **ask for explicit approval first**. It is a legacy private app
with exactly four scopes. The token goes only into the NAS env; add just the variable name to
`server/.env.example`. Never show the value in chat, the repo or the frontend.

**After that: the migration task needs a database copy from Lachlan** (d16). The repo's
`server/data/billing.db` is an empty schema-v1 dev file (0 clients, 0 estimates, dated 15 Aug), so
testing a migration on it proves nothing. Ask Lachlan to copy the latest nightly snapshot out of
the NAS's `/data/backups` into a scratch folder outside the repo.

**Recommended session setting for the build: Opus, effort high.** The sync engine and token
handling fall in CLAUDE.md's auth/data-loss bucket.

## Resolved decisions (Lachlan, 2026-09-22 — do not re-litigate)

1. Client = HubSpot **Company**, with **Contacts** attached.
2. **Two-way sync**; edit on either side, changes reach the other.
3. Local DB stays a full, self-sufficient copy (data *and* structure) — that is the exit plan
   from HubSpot.
4. **ABN is optional and fully independent of HubSpot** — local-only, never sent, never read,
   never overwritten by a sync, never blocks a quote/invoice. No HubSpot custom property for it.

Grill Me (same day) added 5–16. In short: legacy private app; structured address, synced; notes
local-only; contact first/last name locally; company domain synced; local delete = archive and
remember (no resurrection on pull); import matches by name, fills blanks, HubSpot wins clashes;
nameless companies skipped, duplicates flagged, only associated contacts imported; first live run
= pull then push as separate previewed steps, with a HubSpot CSV export before the push; no custom
properties; contacts UI = Clients-screen list plus an estimate-editor contact picker; DB copy
comes from a NAS backup. Full wording is in the brief — treat it as closed.

## Facts from the investigation (verified in the logged-in browser pane, 2026-09-22)

- Portal **441825893**, region AP1 (`app-ap1.hubspot.com`), **free tier** (Workflows locked,
  "Upgrade to Starter" shown). API host is `api.hubapi.com`.
- ~42 companies exist; ~26% have no name (95% have a domain); 115 company properties, all
  standard/HubSpot-created — no ABN property, and none is wanted.
- Legacy Apps: empty ("Create legacy app" available). Service Keys (Beta): empty. **No credential
  exists yet.**
- Limits (Free/Starter): 100 req/10s per app, 250k/day per account. Search API has stricter
  limits (not verified) — typeahead reads local SQLite instead.
- HubSpot Quotes/Invoices exist in the portal but are **out of scope**.
- Existing local CRM shape to migrate: `clients(id, business_name, contact_name, email, phone,
  abn, address, notes, created_at, updated_at)`; estimates keep a loose `client_id` plus a
  `client_json` snapshot that must stay untouched.

## Open seams

No design questions remain open. The build-level seams (contact email conflicts, the unused
`POST /api/clients/upsert` route, local name uniqueness vs HubSpot renames) are listed under
"Seams for the build" in the brief, each tied to the task that has to handle it. Two things are
**still waiting on Lachlan**: approval to create the credential, and the NAS database copy.

## Cleanup done this session

`BILLING_APP_PLAN.md` no longer exists in the repo, but `nas-hosted-billing/DESIGN_BRIEF.md` still
cited it as the CRM spec; that row and the "CRM scope still stands" line were rewritten to point at
this track. Remaining `BILLING_APP_PLAN.md` mentions elsewhere are historical citations of the
money model (calc.js), not CRM, and were left alone.

## How to verify your work

`cd server && npm test` (fake HubSpot server; no live calls). UI changes: browser check against
`api-scratch` per `nas-hosted-billing/HANDOVER.md`. First real sync: against a **copy of a NAS
backup snapshot** (not the repo's empty `server/data/billing.db`), pull and push as separate steps,
each after a dry-run preview Lachlan has approved.
