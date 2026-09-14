> **Superseded.** The storage decision below (JSON files via Electron IPC) was replaced by
> SQLite + a web server — see [`.design/nas-hosted-billing/`](.design/nas-hosted-billing/),
> start at its `HANDOVER.md`. The data model, money model and CRM scope here still stand and are
> worth reading for that. Kept for historical context only.

# LSC Billing App — Persistence + CRM Rebuild Plan

**Goal:** Turn the app into a proper Mac desktop app that permanently remembers every estimate,
invoice, client, and pricing change — with a lightweight CRM that auto-fills client details from
memory when you start a new estimate. Plus the improvements that make the desktop version better.

**Workflow we agreed:**
1. Approve this plan.
2. Build the **back end** (data layer) — no UI changes yet.
3. **Confirm the back end works** (headless test + files on disk).
4. Build the **front end** (wire the UI to the data layer + new UX).

---

## The core problem today

- Estimates live only in memory (`var projects=[]`). Quit the app = everything is gone.
- The Pricing "Save Rates" button is fake — it flashes "saved" but never writes anything.
- Only invoice settings are persisted (in `localStorage`).
- Client details (business, contact, email) are retyped on every estimate and never remembered.

Nothing about the desktop shell needs to change — it's already an Electron app that builds to a
`.dmg`. We're adding the missing **memory** underneath it.

---

## Architecture decision

**Storage: JSON files written by the Electron main process (Node `fs`), one file per data type.**

Why JSON files over the alternatives:

| Option | Verdict |
|---|---|
| `localStorage` in the page | Quick, but opaque, ~5MB cap, wiped if app data is cleared, no backup, no sync. Fine as a fallback, not as the system of record. |
| **JSON files via main process** | ✅ **Chosen.** Human-readable, backup-friendly, can live in Google Drive so it survives reinstalls and syncs across your Macs, easy to inspect/repair. Matches how you already work (you export PDFs to Drive). |
| SQLite / native DB | Robust but overkill for a solo tool with hundreds of records, and adds native-module build pain (electron-rebuild for arm64). Revisit only if you outgrow JSON. |

The renderer has `nodeIntegration:false` + `contextIsolation:true`, so the page can't touch the disk
directly — it goes through the `preload.js` bridge to the main process. This is the **same pattern
the PDF export already uses**, so we're extending proven plumbing, not inventing new architecture.

### Where the data lives  ← decision needed (see bottom)

Default proposal: a dedicated Drive folder next to your quotes, e.g.
`…/My Drive/03 Project Quotes/_LSC Billing Data/`, so it's backed up and portable. Trade-off: if you
run the app on two Macs at the same moment, Drive's last-write-wins could clobber a change (very low
risk for a solo operator). Safer-but-local alternative: Electron's `userData` folder (never syncs,
never conflicts, but tied to one machine). We atomic-write + keep backups either way.

### New file layout (in the data folder)

```
_LSC Billing Data/
  clients.json        # the CRM
  estimates.json      # all estimates + invoices
  pricing.json        # labour rates, travel rates, tax set-aside % (fixes the fake save)
  settings.json       # business info, ABN, GST, bank details, payment terms, paths
  templates.json      # optional saved "packages" (stretch)
  _backups/           # timestamped copies written on every save
```

Every file is wrapped so we can evolve the schema safely:
```json
{ "schemaVersion": 1, "updatedAt": "2026-08-05T...", "data": [ ... ] }
```

---

## Data model

### Client (the CRM record)
```
id           "cl_ab12cd"          (generated)
businessName
contactName
email
phone
abn
address
notes
createdAt / updatedAt
```

### Estimate (extends what the app already stores)
```
id           "est_ab12cd"
upid                              (auto-suggested, editable)
name
date
status       draft | sent | approved | invoiced | paid   (NEW — pipeline)
docType      estimate | invoice
invoiceNumber
clientId     → links to a CRM client
client       { businessName, contactName, email, phone, abn, address }
                  ↑ SNAPSHOT copied in at save time, so an old quote's PDF never changes
                    if you later edit that client. (Standard invoicing practice.)
notes
activeRows   { deliverables, preprod, prod, post, travel, crew, equip }   (as today)
totals       { labourTotal, expenseTotal, passThroughCost,
               clientPriceExGst, gst, totalIncGst,
               taxSetAside, estTakeHome, totalHours }   (computed, stored for list + PDF)
createdAt / updatedAt
```

### Settings (merges today's invoice settings + adds compliance fields)
```
business  { name, abn, email, phone }
gst       { registered: bool, rate: 0.10, pricesIncludeGst: bool }
taxSetAsideRate  0.35            (your internal income-tax provision — renamed for clarity)
payment   { bankName, accountName, bsb, accountNumber, terms }
paths     { exportDir, dataDir }
```

### Pricing (so rate edits finally persist)
```
labourSections [...]   travelRows [...]   taxSetAsideRate
```

---

## PHASE 1 — Back end (build first, confirm before any UI)

The heart of this phase is one **pure Node module with zero Electron dependencies**, so it can be
tested headlessly. Electron just wires IPC to it.

### 1.1 `store.js` — the data layer (pure Node)
- Read/write each JSON file under a given `dataDir`.
- **Atomic writes:** write `foo.json.tmp` then `rename` over `foo.json` (can't corrupt on a crash).
- **Backups:** copy the previous file into `_backups/` (timestamped, rolling) on every save.
- **Corruption safety:** if a file is unreadable, back it up untouched, return empty, surface a warning — never blind-overwrite.
- **CRUD:**
  - Estimates: `list`, `get`, `save` (create/update), `duplicate`, `delete`
  - Clients: `list`, `get`, `search(query)`, `upsert`, `delete`
  - Pricing: `load`, `save`, `resetToDefaults`
  - Settings: `load`, `save`
- **Migration:** on first run, import existing `localStorage` invoice settings → `settings.json`; seed `pricing.json` from current defaults.
- **UPID helper:** suggest a unique id (date + client initials + sequence), collision-checked.

### 1.2 `calc.js` — money model (pure Node, shared with UI later)
Fixes the mislabels and adds GST. One function, fully unit-tested:
- `clientPriceExGst` = marked-up labour + expenses
- `gst` = registered ? clientPriceExGst × rate : 0 (handles inclusive vs exclusive)
- `totalIncGst` = what the client actually pays
- `passThroughCost` = crew + equipment + direct travel (billed at cost)
- `taxSetAside` = labour × 35% (renamed from the confusing "Internal Tax")
- `estTakeHome` = labour revenue − tax set-aside (real margin, **excludes** pass-through — today's "Gross Profit" wrongly includes it)

### 1.3 `main.js` — add IPC handlers
Thin wrappers that call `store.js`/`calc.js`. Keep the existing `export-pdf` / `open-folder`.

### 1.4 `preload.js` — expose `window.api`
```
estimates: list, get, save, duplicate, delete
clients:   list, get, search, upsert, delete
pricing:   load, save, reset
settings:  load, save
files:     exportPDF, openFolder, getDataDir, chooseDataDir
```

### 1.5 `test-store.js` — the acceptance gate (run with `node test-store.js`)
Proves the back end works **without any UI**:
- Create → read back → update → duplicate → delete an estimate
- Upsert a client, search it, confirm autofill lookup returns the right record
- Save pricing, reload, confirm it stuck (the bug that's fake today)
- Save settings, reload, confirm
- Atomic write leaves no `.tmp` behind; a backup appears in `_backups/`
- Feed a corrupt file → confirm it's quarantined and recovered, not clobbered
- `calc.js` returns correct GST / take-home for a known example

### ✅ Phase 1 is "done" when:
1. `node test-store.js` prints all-green.
2. The JSON files exist on disk with correct contents (we'll look at them together).
3. Bonus check: launch the app, and from the dev console call `window.api.estimates.save(...)` then `list()` — data round-trips. (No UI needed to verify.)

Only after you confirm this do we move to Phase 2.

---

## PHASE 2 — Front end (after back end is confirmed)

Wire the existing UI to `window.api` instead of the in-memory arrays, then layer the UX wins.

### 2.1 Persistence wiring (invisible but essential)
- On launch: load estimates, clients, pricing, settings from disk.
- On save/delete/duplicate: write through to disk.
- Pricing "Save Rates" actually saves; tax rate persists.
- Autosave the in-progress estimate as a draft so a crash never loses work.

### 2.2 CRM + auto-fill (your main ask)
- Client field becomes a **typeahead** backed by `clients.json`: pick a client → business, contact, email, phone, ABN, address auto-fill.
- New client name → on save, offer "Add to client list" so the CRM builds itself as you work.
- A simple **Clients** screen to view/edit saved clients and see their estimate history.

### 2.3 Desktop UX improvements (from the review, the ones worth doing)
- **Duplicate estimate** button on each card — biggest time-saver for repeat quoting.
- **Search / sort / filter** the estimates list (by client, date, value, status).
- **Status pipeline** (Draft → Sent → Approved → Invoiced → Paid) shown on cards + filterable.
- **Corrected money labels** — "Client Price", "GST", "Total (inc GST)", "Tax set-aside", "Est. take-home" — replacing the backwards "Net Invoice" / misleading "Gross Profit".
- **GST + ABN on invoices** so the Invoice PDF is a valid Australian tax invoice.
- **Faster line-item entry** — multi-add checklist instead of one-at-a-time dropdown; block duplicate rows.
- **Per-row unit hints** on expenses (the single number means hours / dollars / meals depending on row).
- **Auto-suggested UPID** (editable).

### Deferred / optional (flag for later)
- Email quote straight to the client email on file.
- Saveable package **templates**.
- Undo on delete.

---

## Data safety summary
- Atomic writes (tmp + rename) — no corruption on crash/quit mid-save.
- Rolling timestamped backups on every write.
- Corrupt files quarantined, never blind-overwritten.
- `schemaVersion` on every file for safe future migrations.
- Client details snapshotted onto each estimate so historical PDFs never change.

---

## Decisions I need from you before building the back end
1. **Where should the data live?** Drive-synced folder (backed up, portable, tiny multi-machine risk) — *my recommendation* — **or** app-local `userData` (never conflicts, single machine)?
2. **Are you GST-registered**, and do you want invoices to show GST + your ABN as a compliant tax invoice? (Changes the money model + invoice PDF.)
3. **Scope check:** happy to include the desktop UX wins in 2.3, or keep Phase 2 strictly to persistence + CRM and do the rest afterward?

---

## Risks / caveats
- Running on two Macs simultaneously with Drive storage → last-write-wins. Mitigation: use one machine at a time, or choose `userData`.
- Google Drive "streaming" files must be materialised locally to read/write; the app already assumes Drive is present (it runs from Drive), so this is consistent with today.
- `calc.js` changes will make totals on **new** estimates differ from the old figures (because the profit math is being corrected). Existing (none are persisted yet) aren't affected.
