# Design Brief: HubSpot Two-Way CRM Sync

**Status:** Direction approved and every open question resolved (Grill Me, 22 Sep 2026). Pre-build:
no code written, nothing changed in HubSpot.
**Date:** 22 September 2026
**Supersedes:** the "Clients screen + typeahead" row in `nas-hosted-billing/DESIGN_BRIEF.md` — the
CRM is no longer a standalone local table; it is a local mirror of HubSpot companies and contacts.
Everything else in that brief stands.

---

## Problem

The billing app has its own hand-built CRM (`clients` table, `server/src/routes/clients.js`, the
Clients screen), while Lachlan's real client relationships already live in HubSpot (portal
**441825893**, AP1 region, free tier, ~42 companies). Two client lists means retyping and drift.

## Decisions (made by Lachlan 2026-09-22 — do not re-litigate)

1. **A "client" is a HubSpot Company, with Contacts attached.** Not a Contact.
2. **Two-way sync.** Edits on either platform propagate to the other.
3. **The billing app must keep a complete, self-sufficient copy.** The point of two-way sync is
   that if Lachlan ever leaves HubSpot, the billing app already holds the data *and its structure*
   (companies, contacts, the links between them). HubSpot is a peer, not the only home.
4. **ABN is entirely optional and independent of HubSpot.** It is entered by the user in the
   billing app only. It is never sent to HubSpot, never read from HubSpot, no HubSpot custom
   property is created for it, and a sync must never blank or overwrite it. A client with no ABN
   is normal and must never block a quote or invoice.

Decisions 5–14 were settled in the Grill Me session on the same day and are equally closed — see
"Resolved at Grill Me" below.

## Findings from the investigation

- API access looks available on the free tier. Auth options in the portal: **legacy private app**
  ("Create legacy app", none exist yet) or **Service Keys (Beta)** (none exist yet). Legacy private
  app chosen (decision 5); not yet created — creating it still needs Lachlan's explicit OK.
- Limits on Free/Starter: **100 requests / 10s per app, 250,000 / day per account**
  ([HubSpot usage guidelines](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines)).
  Ample. The CRM **Search** API has stricter, unverified limits — don't build typeahead on it.
- Company data quality: ~26% of companies have **no name** (95% have a domain), consistent with
  auto-creation from email domains. Import must skip or flag nameless companies.
- Region is AP1 but the public API host is `api.hubapi.com` for all regions.
- HubSpot also has Quotes and Invoices objects. **Out of scope** — the billing app stays the
  system of record for quotes/invoices; HubSpot is for companies and contacts only.

## Architecture

- **The HubSpot token lives only on the NAS API server** (env var, same pattern as the existing
  secrets in `server/.env.example`). The GitHub Pages frontend never sees it and never talks to
  HubSpot; it only calls the existing `/api/clients*` routes, which sync behind the scenes.
- **Local DB is the read path.** Typeahead and the Clients screen read SQLite, never HubSpot
  directly — fast, works when HubSpot is down, and keeps the "own your data" promise.
- **New columns/tables (additive migration; never edit a shipped migration):**
  - on `clients`: `hubspot_id`, `domain`, structured address `street`, `city`, `state`,
    `postcode`, `country` (decision 6), `archived_at` + `archived_reason` (decision 10), and sync
    bookkeeping (last synced timestamp / content hash of the synced fields).
  - a `contacts` table: id, client_id, hubspot_id, `first_name`, `last_name` (decision 8), email,
    phone, is_primary, archived_at, sync bookkeeping, timestamps.
  - Existing `contact_name`/`email`/`phone` on `clients` migrate into one primary contact,
    `contact_name` split once at the **first space** (`Jane van der Berg` → `Jane` /
    `van der Berg`); editable afterwards. Existing free-text `address` migrates **unparsed** into
    `street` — no guessing at city/state/postcode. The legacy columns stay until estimates and
    PDFs no longer read them.
- **`estimates.client_json` snapshot is untouched.** Estimates keep their frozen copy so a synced
  edit or a deleted company never rewrites an issued quote/invoice. `client_id` stays a loose link.
  The snapshot's **shape doesn't change either**: `contactName` is the chosen contact's first +
  last name joined, `email` is that contact's email, and `address` is the structured parts joined
  into one string at save time. (Client address is not printed on either PDF today — `pdf.js`
  prints business name, contact name and email — so the address split changes no client-facing
  document.)
- **Sync directions:** push on every local write (best-effort, queued if HubSpot is unreachable);
  pull on a timer (poll companies/contacts modified since the last pull — webhooks need a public
  app and a reachable endpoint, not worth it here). Default pull interval **5 minutes**, plus a
  manual "Sync now" on the sync-status indicator.
- **Field mapping (synced), all standard HubSpot properties — no custom properties needed
  (decision 14):**

  | Billing app | HubSpot |
  |---|---|
  | `clients.business_name` | Company `name` |
  | `clients.phone` | Company `phone` |
  | `clients.domain` | Company `domain` |
  | `clients.street` / `city` / `state` / `postcode` / `country` | Company `address` / `city` / `state` / `zip` / `country` |
  | `contacts.first_name` / `last_name` / `email` / `phone` | Contact `firstname` / `lastname` / `email` / `phone` |
  | `contacts.client_id` | Contact → Company association (the contact's primary company) |

- **Local-only, never synced, never read, never overwritten by a sync:** ABN (decision 4), notes
  (decision 7), `contacts.is_primary` (HubSpot has no "primary contact of a company" concept), and
  local archive state.
- **Deletes never propagate automatically in either direction** (decision 10):
  - **Local delete of a synced client or contact = local archive**, not a row delete. The row
    keeps its `hubspot_id`, so the next pull recognises it and does **not** resurrect it. The UI
    says "Removed from the billing app — still in HubSpot"; an Archived filter on the Clients
    screen restores it. The existing `DELETE /api/clients/:id` changes meaning accordingly.
  - **A company/contact archived in HubSpot** is flagged locally ("Archived in HubSpot") and left
    in place; the user decides. Never auto-archived or deleted locally — a client with estimates
    must not silently vanish.
- **Conflicts:** per-record last-write-wins on modified time, and log what was overwritten. (The
  one exception is the initial import — see decision 11.) The
  pre-write SQLite snapshot in `server/src/backup.js` already covers sync writes; verify it does.
- **Failure is visible and distinct.** The connection-lost banner means "the NAS API is
  unreachable". HubSpot being down or the token being revoked is a different state and needs its
  own quiet sync-status indicator — never reuse the banner copy for it (see the banner's
  per-kind copy rule in `nas-hosted-billing/HANDOVER.md`).

## Resolved at Grill Me (Lachlan, 22 Sep 2026 — do not re-litigate)

5. **Auth: legacy private app**, scopes `crm.objects.companies.read/write` and
   `crm.objects.contacts.read/write` only. Not Service Keys (Beta). Creating it is still a change
   to Lachlan's HubSpot account — **ask before doing it**. Token only in the NAS env.
6. **Address: structured and synced.** Local `street`/`city`/`state`/`postcode`/`country` ↔
   HubSpot `address`/`city`/`state`/`zip`/`country`. Legacy free text → `street`, unparsed.
7. **Notes: local-only in v1**, same treatment as ABN. HubSpot Notes are timeline engagements,
   not a field; not synced either way.
8. **Contact names: `first_name` + `last_name` locally**, matching HubSpot. Displayed joined.
   Legacy `contact_name` split once at the first space.
9. **Company domain is synced** (`clients.domain` ↔ Company `domain`) — keeps the exit copy
   complete and lets HubSpot auto-associate contacts with companies pushed from the app.
10. **Local delete = hide + remember** (archive with `hubspot_id` kept so pulls don't resurrect;
    restorable). HubSpot archive = local flag only. See Architecture → Deletes.
11. **Initial import matching:** local client ↔ HubSpot company by name, case-insensitive exact.
    For each synced field on a matched pair: an empty side takes the other's value; where both
    are non-empty and differ, **HubSpot wins**, and the preview lists every such clash before
    confirm. ABN and notes are never touched.
12. **Import edge records (strict v1 rules):** nameless companies are **skipped** and listed in
    the preview with their domain, so Lachlan can name them in HubSpot and re-run. Duplicate
    company names in HubSpot are **flagged, not imported**. Only contacts associated with an
    imported company come across, each under its **primary company** (a contact linked to
    several companies lives under one locally). Unassociated contacts are ignored.
13. **First live run is two separate steps, each with its own dry-run preview and confirm:**
    1. **Pull** — HubSpot → a copy of the NAS database. Read-only on the HubSpot side.
    2. **Push** — create/update HubSpot companies and contacts from local-only clients.
       Lachlan exports Companies and Contacts to CSV from HubSpot **before** step 2, since the
       preview is the only guard on the HubSpot side.
14. **No HubSpot custom properties.** Every synced field in the mapping is a standard property.
15. **Contacts UI, smallest version:** Clients screen gets a contacts list per company (add, edit,
    remove = local archive, mark primary). The estimate editor gets a **Contact** select for a
    linked client, defaulting to the primary contact, which fills `contactName`/`email` in the
    snapshot. Unlinked clients keep today's free-text fields. No adding contacts from inside the
    editor in v1.
16. **The database copy comes from the NAS.** The repo's `server/data/billing.db` is an empty
    schema-v1 dev file (0 clients, 0 estimates, 15 Aug) and proves nothing. At the migration task,
    Lachlan copies the latest nightly snapshot from the NAS's `/data/backups` into a scratch
    folder outside the repo (never committed); migrations and the first sync run against that
    copy. The live NAS file is never touched by an agent.

## Seams for the build (not decisions — things the relevant task must handle)

- **Contact email is HubSpot's dedupe key.** Creating a contact whose email already exists
  returns a conflict; the push should link to the existing contact rather than fail or duplicate.
- **`POST /api/clients/upsert` overwrites every field, including ABN and notes.** It is unused by
  the UI (see `nas-hosted-billing/HANDOVER.md`). It must not become a sync write path; decide in
  the push task whether to remove it or restrict it.
- **Local business-name uniqueness is enforced in the UI only**, because the estimate editor's
  save-to-list link matches by name. A HubSpot rename can now collide with another local name; the
  pull should apply it (the link is by id now) and the Clients screen should show the duplicate
  rather than block on it.

## Out of scope

HubSpot Quotes/Invoices/Deals sync, HubSpot workflows (locked on free tier), webhooks, marketing
emails, multi-user ownership/permissions, and any change to the money model.

## Testing approach

`npm test` must never call the real HubSpot. Tests run the sync engine against a small in-process
fake HubSpot HTTP server (same ephemeral-port pattern as `server/test/test-api.js`). The
acceptance gate is unchanged: `cd server && npm test`. Anything a person looks at (Clients screen,
contacts, sync status) is verified in a browser against `api-scratch`, and the first live sync is
done against a **copy** of the real DB and only after the dry-run preview.
