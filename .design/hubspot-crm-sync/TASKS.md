# Build Tasks: HubSpot Two-Way CRM Sync

Generated from: `.design/hubspot-crm-sync/DESIGN_BRIEF.md`
Date: 22 September 2026

Every task is tagged with its CLAUDE.md model/effort bucket. The sync engine and token handling
are treated as **auth/data-loss-adjacent → Opus/high** regardless of diff size. Acceptance gate:
`cd server && npm test`; `npm test` never touches real HubSpot (fake HubSpot server in tests).
Decision numbers (d5–d16) refer to "Resolved at Grill Me" in the brief.
**Do not create anything in the HubSpot account without asking first.**

## Before any code

- [x] **Grill Me on the brief's open questions** (design — Opus/high): auth type, structured
  address, notes local-only, import rules, contacts UI scope. Fold answers into the brief.
  *Done 2026-09-22 — decisions 5–16 in the brief.*
- [ ] **Create the HubSpot credential** (infra — Sonnet/medium): legacy private app (d5) with the
  minimum scopes: `crm.objects.companies.read/write`, `crm.objects.contacts.read/write`.
  **Ask Lachlan first — it changes their HubSpot account.** Token goes in the NAS env only, never
  in the repo, chat, or frontend; add the var name to `server/.env.example`.

## Foundation

- [ ] **Migration: hubspot ids, contacts, sync bookkeeping** (backend — Sonnet/high): additive
  migration in `server/src/db.js` — `clients.hubspot_id`, `domain`, structured address
  (`street/city/state/postcode/country`), `archived_at/archived_reason`, sync state columns;
  `contacts` table with `first_name/last_name`. Migrate existing `contact_name/email/phone` into a
  primary contact (split at first space, d8) and free-text `address` into `street` unparsed (d6).
  ABN and notes untouched and never part of any sync payload. Verify on a **copy of a NAS backup
  snapshot that Lachlan provides** (d16) — the repo's `server/data/billing.db` is empty.
- [ ] **HubSpot client module** (backend — Opus/high): `server/src/hubspot.js` — thin wrapper over
  `api.hubapi.com` (companies, contacts, associations, "modified since" listing), honours 429s,
  timeouts, no token in logs. Fake HubSpot server for tests.

## Sync

- [ ] **Sync engine: push on local write** (backend — Opus/high): queue + retry when HubSpot is
  unreachable; never blocks or fails the local save; maps only the synced fields (brief's mapping
  table). Local delete becomes local archive (d10). Link to an existing HubSpot contact on an
  email conflict. Decide the fate of `POST /api/clients/upsert` (see brief → Seams).
- [ ] **Sync engine: timed pull** (backend — Opus/high): poll modified-since every 5 min + manual
  trigger, last-write-wins per record with an overwrite log; HubSpot archives flagged locally,
  never applied; locally archived records are never resurrected (d10). Confirm the
  pre-write backup snapshot covers sync writes.
- [ ] **ABN isolation tests** (backend — Opus/high): prove a pull never blanks or overwrites ABN
  (or notes, d7), a push never includes either, and a client with no ABN saves, syncs and
  invoices normally.
- [ ] **Initial import with dry-run** (backend — Opus/high): two separate steps, each preview +
  confirm (d13): **pull** (HubSpot → local copy; read-only on HubSpot) then **push** (local-only
  clients → HubSpot, after Lachlan's CSV export). Preview shows created / matched (name,
  case-insensitive) with every field clash (fill blanks, HubSpot wins — d11) / skipped nameless
  (with domain) / flagged duplicate names (d12). Writes only on confirm.

## UI

- [ ] **Sync status indicator** (frontend — Opus/high): quiet, distinct from the connection-lost
  banner; shows last sync, and "HubSpot unreachable"/"token rejected" states. Does not carry
  `data-write` blocking.
- [ ] **Clients screen: contacts per company** (frontend — Opus/high): list/add/edit/remove
  (= archive) contacts, mark primary; structured address + website fields; Archived filter with
  restore; "Archived in HubSpot" flag. ABN and notes stay, clearly labelled as not synced.
- [ ] **Estimate editor: choose contact** (frontend — Opus/high): Contact select on a linked
  client, defaulting to primary; no inline add (d15). Snapshot shape unchanged — joined name and
  joined address.

## Wrap-up

- [ ] **Design review + docs** (frontend/docs — Opus/high): run design-review; update the
  deployment guide with the token env var; update HANDOVER.md and root CLAUDE.md.
