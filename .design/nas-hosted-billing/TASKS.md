# Build Tasks: NAS-Hosted LSC Billing

Generated from: .design/nas-hosted-billing/DESIGN_BRIEF.md
Date: 14 August 2026

Each task is independently verifiable. Server tasks are checked with `node test-*.js` or curl, no UI needed until the "Core UI" section. This preserves the old plan's habit of proving the back end before touching the front end — just with a database and an API instead of IPC.

## Foundation

- [x] **Project scaffold + Docker shell**: New `server/` directory — Express app, `package.json`, `Dockerfile`, `docker-compose.yml` mounting a `/data` volume, `.env.example` with `DATA_DIR`, `PORT`, `SESSION_SECRET`. `docker compose up` serves a `/health` route returning `200 ok` on the Mac today, no NAS required. _New. This is the riskiest unknown (first time this app touches Docker) so it goes first._
- [x] **SQLite schema + migrations**: `db.js` using `better-sqlite3`, WAL mode, schema for `clients`, `estimates`, `pricing`, `settings`, `sessions` tables per the data model in `BILLING_APP_PLAN.md`, plus a `schema_version` table for future migrations. Verify with a script that creates the DB file fresh and re-runs safely against an existing one. _New. Depends on: Project scaffold._
- [x] **Auth: login, session, middleware**: `POST /api/login` (Argon2id verify, rate-limited), session cookie (`httpOnly`, `Secure`, `SameSite=Strict`) backed by the `sessions` table, `requireAuth` middleware on every route except `/login` and `/health`, `POST /api/logout`. A seed script creates the single account from an env var on first boot. Verify with curl: wrong password rejected, right password sets cookie, protected route 401s without it. _New. Depends on: SQLite schema._
- [x] **calc.js — money model**: Port verbatim from `BILLING_APP_PLAN.md` §1.2 (client price, GST, pass-through, tax set-aside, take-home), pure function, no I/O. Unit-tested against the known example already specified in the plan. _New, but logic is fully speced already — low risk, do it early since the API layer depends on it._

## Core API

- [x] **Estimates CRUD API**: `GET/POST /api/estimates`, `GET/PUT/DELETE /api/estimates/:id`, `POST /api/estimates/:id/duplicate`. Snapshot the client's details onto the estimate at save time (per brief, historical PDFs never change). Totals computed server-side via `calc.js` on every create/update. Verified in `test/test-api.js`: create → list → get → update → duplicate → delete round-trips correctly.
- [x] **Clients CRUD + search API**: `GET /api/clients?q=`, `GET/POST/PUT/DELETE /api/clients/:id`, `GET /api/clients/:id/estimates` (history), `POST /api/clients/upsert` (case-insensitive match on business name — the "add to client list" flow from an estimate save). Verified: search returns partial matches; upsert doesn't duplicate.
- [x] **Pricing + Settings API**: `GET/PUT /api/pricing` (+ `POST /api/pricing/reset`), `GET/PUT /api/settings`. Fixes the "Save Rates" bug — verified by saving a rate and reading it back in a fresh request.
- [x] **Backup + safety layer**: nightly backup of `billing.db` into `/data/backups/` (timestamped, rolling retention) plus a pre-write snapshot on every mutating request. Verify: trigger a save, confirm a backup file appears; simulate a corrupt DB file and confirm the server refuses to boot rather than overwriting it. `server/src/backup.js` — uses better-sqlite3's Online Backup API (safe against a live WAL writer). Retention: 14 nightly, 10 pre-write. Verified in `test/test-backup.js` and manually against a running server.
- [x] **Server-side PDF export**: `POST /api/estimates/:id/pdf` renders the existing PDF HTML template via headless Chromium in-container, streams the file back, and writes a copy to `/data/exports`. Verify: generated PDF matches today's Electron output for the same estimate data. `server/src/pdf.js` (HTML templates ported verbatim from `main.js`'s `buildClientPDF`/`buildClientInvoicePDF`, plus `puppeteer-core` rendering) and `server/src/routes/pdf.js`. Chromium installed via apt in the Dockerfile runtime stage. Verified in `test/test-pdf.js` (HTML content + a real end-to-end render) and manually against a running Docker container (login → save pricing → create estimate → export → valid 1-page PDF, file also written to `/data/exports`).

## Core UI

- [x] **Login screen**: New centred card view — logo, username/password fields, inline error state, submit disabled while pending. Matches the dark editorial system (`Delight` heading, `--surface` card, `--accent` submit button). Redirects to the estimates list on success. Built as `web/` — the GitHub Pages site (`index.html`, `css/app.css` + `css/login.css`, `js/api.js` + `js/views/login.js` + `js/app.js`, `js/config.js` for the API address). No server changes were needed; `/api/session`, `/api/login` and `/api/logout` already existed. Verified in a browser against the real API cross-origin (`localhost:5173` → `localhost:8080`, CORS + `SameSite=None` cookie): anonymous boot → login; wrong password → generic inline error with the username preserved; 429 → live countdown; API stopped → "could not reach the server" rather than a credentials error; correct password → app view, session surviving a reload; pending state disables the form and shows the spinner.
- [x] **Connection-lost banner**: Sticky, `role="status"`, accent-bordered banner that appears on any failed `fetch` (network error or non-2xx), disables all save buttons app-wide while visible, dismisses itself when a request succeeds. Built as `web/js/connection.js` + `web/css/connection.css`, with the banner markup in `index.html` under the header. `js/api.js` gained a `subscribe()` hook so the banner watches all traffic from one place instead of each caller notifying it. **Scope narrowed deliberately from "any non-2xx"**: only `network` and `server` (5xx / unreadable reply) raise it. A 401, 400 or 429 is a healthy server refusing one request — that belongs to the caller inline, and is positive evidence the connection is fine, so those *clear* the banner instead. Writes are blocked by a capture-phase block on `[data-write]` rather than by flipping `disabled` on buttons other screens own (see `web/README.md`). Carries a Try Again button, without which the banner can't be dismissed while every write is blocked. Verified in a browser against the real API: banner raised on a stopped server with the right copy, write button dead to both mouse and keyboard while a read-only button beside it still fired, `role="status"`, sticky flush under the 52px header at scroll, Try Again pending state, recovery clearing banner + re-enabling writes, a real 404 clearing it, and the banner staying hidden on the login screen so it never doubles up on that screen's inline error. _Also fixed a pre-existing bug found here: `api.js` called `base()` inside the try that assumes any throw is a fetch failure, so a missing `js/config.js` was misreported as `network` ("could not reach the server") instead of surfacing "copy config.example.js" — a bad first diagnosis for a fresh deploy._
- [x] **Wire estimates list + editor to the API**: Replace `var projects=[]` with `GET /api/estimates` on load; wire save/delete/duplicate buttons to their endpoints with pending/success/failure button states. Visual output must be pixel-identical to today. Built as `web/js/views/estimate-{list,detail,editor}.js` + `views/estimates.js` (the router between them), with `js/rows.js`, `js/data.js`, `js/util.js` and `js/toast.js` behind them. **The editor's live totals come from `web/js/calc.js`, a byte-identical copy of `server/src/calc.js`** — the desktop app's inline arithmetic was not portable, since it predates GST and counted pass-through as margin, and a second implementation would have let the editor disagree with the stored record. A test in `test-calc.js` fails if the copy drifts. Money labels are the corrected set from `BILLING_APP_PLAN.md` §204 (Client Price / GST / Total inc GST / Tax set-aside / Est. take-home); the ≥1100px layout is unchanged, verified numerically (`#main` still 1080px with 34px/40px padding, summary bars still `repeat(5,1fr)`). Verified in a browser against the real API: create → save → detail → edit → save → duplicate → delete, live totals matching the stored ones on both GST-exclusive and not-registered settings, custom-bill override, row removal restoring the empty state, field/HTML escaping, validation, save failure with the server stopped (banner + inline message + no input lost + writes dead while read-only controls still fire), recovery, and 401 → login. _Two server bugs were found and fixed doing this — see HANDOVER.md._
- [x] **Wire Pricing screen to the API**: "Save Rates" actually calls `PUT /api/pricing` and shows a real confirmation, not a fake flash. Built as `web/js/views/pricing.js` + `web/css/pricing.css`, mounted from the header's Pricing nav item in `js/app.js`. Ported from `renderPricing` in the desktop app; `app.css` already carried every rule the layout uses, so the additive stylesheet only adds the inline error region. Edits are made against a **deep clone** of `LSCData.pricing()` and the cache is replaced only by what the server echoes back, so an abandoned or failed edit can never price an estimate. Reset Defaults calls `POST /api/pricing/reset`. Validation (blank/duplicate category and service names, ported from `catalogueProblems`) reports inline above the save bar rather than through `alert()`, which covered the fields it was describing. Delete confirmations keep the desktop app's "N saved estimates use it" warning, counted from `GET /api/estimates` — advisory, so a failure to load it drops the note rather than claiming zero. Verified in a browser against the real API: rate edit → save → read back from the server → editor prices against the new figure with no reload; consecutive saves; all four validation cases; Reset Defaults; save with the server stopped (banner + inline message + no input lost + writes dead while read-only controls beside them still fired) and recovery via Try Again; delete warnings; and the ≥1100px layout confirmed numerically unchanged (`#main` 1080px, 34px/40px padding, `.pricing-grid` 2 × 493px). _Also: the tax set-aside rate is no longer read as `parseFloat(v)/100 || 0.35`, which turned a deliberate 0% into 35% because 0 is falsy — it is validated to 0–100 and a blank or out-of-range value blocks the save. Two bugs found and fixed here, one of them in this screen's own save state — see HANDOVER.md._
- [x] **Snapshot labour category labels onto estimates** (schema v2): the category label is a heading on the client-facing PDF, and it was read from the live rate card at render time. Wiring Pricing up made rename and delete reachable, so renaming a category silently re-headed every quote already sent under the old name, and deleting one re-headed them "Archived Services". `estimates.section_labels_json` now records what each category was called at save time; `pdf.js` and the estimate detail view prefer it, the editor keeps showing the live card (it is a working surface, and saving re-snapshots). Tested in `server/test/test-section-labels.js` and verified end to end by renaming, then deleting, a category and re-exporting the PDF of an estimate that used it. _Not in the original task list — added 2026-09-09. HANDOVER.md flagged the deletion half of this as an open seam to decide during the Pricing task; the rename half was found while doing it and is the more likely case._
- [x] **Wire Invoice Settings to the API**: Modal reads/writes `/api/settings`. Built as `web/js/views/settings.js` + `web/css/settings.css`, with the overlay in `index.html` and the nav wired in `js/app.js`. `app.css` already carried the whole modal shell (`.modal-overlay`, `.modal-box`, `.modal-title`, `.modal-actions`) and the form fields, so the additive stylesheet only adds the two-group layout, the checkbox rows and the inline error region. Ported from `openInvoiceSettingsModal`, with the flat `{bankName, accountName, bsb, accountNumber, paymentTerms}` translated to the nested `settings.payment` shape the PDF actually reads (`paymentTerms` → `terms`). **Scope extended with the user on 2026-09-10 to cover the GST block** (registered / rate / prices-include-GST): `calc.js` reads `settings.gst` on every estimate, but no screen could set it, so the app was pinned to the `registered: false` default and half the money model was unreachable. **The save merges rather than replaces** — `PUT /api/settings` writes the body over the whole settings row, and this modal only shows `gst` and `payment`, so it merges onto a freshly-read copy; sending just its own two keys would have silently dropped `business` and `paths`, and dropping `gst` would have changed the money on every estimate saved afterwards. It reads fresh on open rather than from `LSCData`'s cache for the same reason — a merge is only as good as what it merges onto. Verified in a browser against the real API: save → reopen → read back from the server; a **second** save landing (the repeat-save no-op that bit the Pricing screen); `business`/`paths` provably intact across both; trim-on-save; GST rate validation blocking with input preserved; a deliberate **0%** stored as 0 rather than becoming 10% (the falsy-zero bug the tax set-aside rate had); the editor's live totals matching the server's stored totals after a GST change; save with the server stopped (inline explanation, no input lost, writes dead to a second click) and recovery via Try Again; a 401 mid-edit landing on login; Escape closing and returning focus; and the ≥1100px layout numerically unchanged (`#main` 1080px, 34px/40px padding, `.pricing-grid` 2 × 493px). _The one-time `localStorage` import was **dropped, not forgotten** — see the note below. A bug in the invoice PDF was found doing this and is its own task, also below._

> **The one-time `localStorage` import was dropped on 2026-09-10, deliberately.** The brief and
> this task both asked for it, but it cannot work: the desktop app is loaded with
> `win.loadFile('index.html')` (`main.js:34`), so its settings live in the `file://` origin's
> localStorage inside Electron's own Chromium profile. A page served from GitHub Pages — or from
> `localhost:5173` — can never read that, and no amount of prompting changes it. The import would
> have been dead code that silently never fired. There are five payment fields; retyping them once
> into the new modal is the migration. If a copy is ever genuinely needed, the honest version is a
> paste box fed by a snippet run in the old app's devtools, which is more machinery than five
> fields justify.

- [x] **The invoice PDF contradicts the GST setting**: fixed 2026-09-11. Every quote and invoice used to print "All prices in AUD. GST not included." — ported from the desktop app, which had no GST — so a GST-registered invoice charged GST while saying it didn't. `server/src/pdf.js` now renders **three states**, classified by `gstTreatment(totals, estimate)` in **`calc.js`** (so the browser's copy and the server agree — re-copied to `web/js/calc.js`): **taxable** (stored `gst > 0`) → titled **TAX INVOICE**, "Subtotal (ex GST)" and "GST" rows above the existing dark total bar, "inc. GST"; **free** (the estimate's own `gstFree` flag) → plain INVOICE, "GST-free — no GST is payable on this invoice"; **none** → plain INVOICE, "No GST is charged". Quotes get the same breakdown and wording. **The classification reads the stored figures and the flag, never live `settings.gst`**: whether GST was charged is a fact about a document that may already be with the client, so switching registration later must not turn an old invoice into a tax invoice or strip the GST line off one (verified: a taxable invoice re-exported after GST was switched off still reads TAX INVOICE with its GST line). **Seller identity**: `settings.business.name` and ABN now print under the logo on both documents, and the client's snapshot ABN prints on invoices. **`POST /api/estimates/:id/pdf` refuses a GST-bearing invoice with 422 `abn_required`** (with a `message` for the UI) when no ABN is set — a tax invoice without the seller's ABN isn't one; GST-free and unregistered invoices and all quotes still export. The Invoice Settings modal gained a **Business** block (legal name + ABN), validates the ABN against the ATO checksum, blocks GST registration without an ABN, stores the ABN as bare digits and shows it formatted. The estimate detail view's GST line reads "GST-free" where the PDF does. Tested in `test-pdf.js` (all three states, both document types, the blocker), `test-calc.js` (the classifier) and `test-api.js` (the 422 through the real route). Verified by exporting real PDFs in every state against the scratch API and reading them with `pdftotext`, and in a browser (both validation rules, a save and a *second* save read back from the server, `business.email`/`phone` and `paths` intact across the merge). _Not done, and worth knowing before relying on these as tax invoices over $1,000: the ATO also expects a description of each item's quantity and price, and this document deliberately lists services without per-line prices. That's a design call about the client document, left for the user._

- [x] **GST-free estimates** (schema **v3**, `estimates.gst_free`): raised by the user on 2026-09-10 — there are jobs where GST does not apply even though the business is registered, and `calc.js` modelled GST only globally, so the only way to quote one was to switch GST off account-wide and re-price everything else. **Scoped per estimate, not per line item**, chosen by the user over a per-line flag. `computeTotals` takes a fourth `options` argument (`{ gstFree }`) and a GST-free estimate prices exactly as an unregistered business would — asserted directly in `test-calc.js` with a `deepEqual` against the unregistered case. The flag lives on the estimate for the same reason `client_json` and `section_labels_json` do: the tax treatment of a document already sent must not move underneath it. A duplicate inherits it. The editor's toggle sits in the document-type bar and is rendered **only when the business is registered**, since it could do nothing otherwise; when it is absent an estimate's stored flag is preserved rather than cleared, so switching GST off account-wide doesn't erase which jobs were quoted GST-free. **The decision worth knowing**: on a GST-inclusive rate card, a GST-free job bills the *listed* rate — a service at $560 stays $560 rather than dropping to $509.09 — because a job's tax treatment should not move the quoted price (user, 2026-09-10). It follows that the full amount is revenue, so the tax set-aside is provisioned against all of it and take-home rises. Tested in `test-calc.js` (5 cases) and `test-api.js` (round trip, re-read, duplicate inheritance, switching back off). Verified in a browser: the live totals matching the server's stored totals in both states, the toggle absent and the flag preserved when unregistered, and the ≥1100px layout unchanged (`#main` 1080px, document-type bar 61px tall with and without the toggle). _A stray `1` or `"yes"` does not opt out — only a literal `true`, matching `gst.registered`; a test asserting that caught the implementation being merely truthy._

- [x] **Decide whether `settings.business` (name / ABN) belongs in the Invoice Settings modal**: _Resolved 2026-09-11 by the invoice PDF task above — the modal now has a Business block (name + ABN). Ticked 2026-09-11 so it doesn't read as outstanding._ left out on 2026-09-10 because nothing read it, but the invoice PDF task above needs the ABN to produce a compliant tax invoice. Fold it into that task rather than doing it standalone. _Small, but it is the same screen and the same document: `Opus, effort: high`._
- [x] **Clients screen + typeahead**: New nav item, list/edit view for saved clients with estimate history, and the typeahead component embedded in the estimate editor's client field (debounced search → autofill business/contact/email/phone/ABN/address). _New screen + new component. Depends on: Clients API._ **Done 2026-09-11** — `web/js/views/clients.js`, `web/js/typeahead.js`, `web/css/clients.css`, plus changes to `estimate-editor.js`. Two product calls made with the user: (1) the editor now **shows all six client fields** (phone, ABN, address added), because the invoice PDF prints the client's ABN and nothing should print that the editor didn't show; (2) an unlinked business name gets a **"Save to client list" checkbox, on by default**, so the client list builds itself while quoting. It links to an existing record with the same name (case-insensitive) and **never overwrites one** — the client list is the maintained copy. The Clients screen refuses a second record with an existing name, since the editor's linking depends on names being unique. The estimate's link (`clientId`) lapses when the Business Name is edited away from the linked client's name, and comes back if it's typed back. ABN validation moved into `js/util.js` (`abnDigits`/`abnValid`/`abnFormat`), shared with Invoice Settings. No server changes. Verified in a browser against the scratch API: create/validate/duplicate-refusal/second save/delete on the Clients screen; keyboard and mouse picks filling all six fields; the stored `clientId` and snapshot; editing a client leaving a saved estimate's snapshot untouched; history opening the estimate; all three save-to-list paths (new, typed existing name, opted out); the half-failed save (client created, estimate POST failing) retrying without a duplicate client; offline save keeping input + banner + Try Again recovery; a 401 landing on login; HTML escaping in the list and dropdown; the ≥1100px layout (`#main` 1080px, form fields 2 × 493px, doc-type bar 61px); and a re-exported invoice PDF printing the client ABN.
- [x] **PDF export button**: Wire the existing export button to `POST /api/estimates/:id/pdf`, pending state while rendering, triggers a browser download on completion. Remove the "Open Folder" button (no local filesystem to open from a browser). _Modifies existing button. Depends on: Server-side PDF export._ **Done 2026-09-11** — the desktop app's `↑ Export Quote PDF` / `↑ Export Client Invoice` button is back in the estimate detail header (`web/js/views/estimate-detail.js`), after Edit and Duplicate. `js/api.js` gained `postPdf()`, a binary path returning `{ blob, filename }`; errors still come back as JSON and are classified as before. Pending state = disabled button + spinner + "Generating PDF…" toast (a render takes ~3s). Failures are explained **inline under the header** (`#export-error`, `role="alert"`), not in the toast: the `abn_required` 422 shows the server's message plus an **Open Invoice Settings** button, and `pdf_unavailable`, 404 and network each get their own wording. The "Open in Finder" toast link was never ported to `web/`, so nothing needed removing. **Export deliberately carries no `data-write`**: it never changes the record and a failed export loses nothing, so the connection banner has no reason to block it — offline, it stays clickable and says the server is unreachable, while Duplicate beside it is blocked. **Three server fixes, all reachable only once a button made export a routine click:** (1) `routes/pdf.js` built `Content-Disposition` by hand, and Node refuses any header character outside Latin-1 — so a curly apostrophe or em dash in the client or estimate name made the export **500**. Now `res.attachment()` (RFC 6266 `filename*`). (2) The API didn't list `Content-Disposition` in `Access-Control-Expose-Headers`, so the cross-origin page couldn't read the filename at all. (3) **Every export took a pre-write database snapshot** — it's a POST — and only 10 are kept, so ten exports rotated every real recovery point out. The PDF route now mounts after `requireAuth` but before `preWriteBackup` in `app.js`. Tests in `test-api.js` for all three, each confirmed to fail against the old code. Verified in a browser against the scratch API: invoice export → valid PDF named `INV-PDF-1 - Café Ltd - Nick’s launch — v2.pdf`, read back with `pdftotext` (TAX INVOICE, ABN, GST line); a **second** export landing; the server's copy in `/exports` and no new backup snapshot; ABN cleared → inline message + working settings button, banner correctly *not* raised, no download; ABN restored → export succeeds and the message clears; server stopped → banner + inline message, export still clickable, Duplicate blocked; Try Again recovery; quote label and filename; ≥1100px layout (`#main` 1080px, 34px/40px padding, three header buttons on one 25px row). _Not verified: a 401 mid-export — it takes the same `onAuthLost` path as Duplicate, but testing it means killing the session and there was no way to sign back in without a human._
- [x] **Session control in header**: Small logout affordance in `#hdr-right`; expired/401 responses anywhere in the app redirect to the login screen without losing unsaved form data where reasonably possible. _New, minor. Depends on: Login screen._ **Done 2026-09-11.** The 401 redirect came with the estimates port; this adds the rest, all in `web/js/app.js` plus one-line changes at the call sites. **Sign Out** is the last item in `#hdr-right` (a `.nav-link`, tooltip "Signed in as …" from `/api/session` or the login reply, explicit `aria-label` so the tooltip can't become its accessible name). It calls `POST /api/logout`; **if that fails the user is told they are still signed in**, because the cookie is httpOnly and only the server can end the session — the page can't fake it. A successful sign-out empties `#main` and calls the new `LSCData.clear()`, so nothing of the last session sits in the DOM behind the login card. No `data-write`: it changes no data. **Unsaved input now survives an expired session** — without serialising anything. `showLogin` only ever *hid* `#app-view`, so the half-typed screen was still in the page; the next sign-in now un-hides it as it was instead of re-mounting the estimates list, with the login message and a toast saying so. **It is opt-in per call site**: `onAuthLost({ keepScreen: true })` from every place a screen is complete when the 401 lands (estimate save/delete/duplicate/export, pricing save/reset/usage count, client save/delete, settings save, opening an estimate); the loads that 401 mid-draw (estimate list, clients list, client history, rate-card boot) pass nothing, because resuming them would un-hide a "Loading…" placeholder forever. A forgotten opt-in gives the old behaviour, not a stranded screen. The **Invoice Settings modal no longer closes on a 401 during save** — it sits inside `#app-view`, hides with it and comes back; its Escape handler ignores keys while hidden so Escape on the login screen can't discard it. `onAuthLost` also now ignores repeat calls while the login screen is up, since several in-flight requests can 401 together and each used to re-mount (and wipe) the login form. Verified in a browser against the scratch API: editor with an unsaved rename + contact, Invoice Settings open over it with an unsaved terms edit, session deleted server-side, Save → login with the keep message, all three edits still in the page; Escape on the login screen leaving the modal intact; a second 401 not wiping a typed username; user signed in → toast, modal and editor exactly as left; modal save and then editor save both **read back from the server** (settings merge intact — ABN, GST, paths); Sign Out with the API stopped → "you're still signed in", app untouched; Sign Out → login with no error, `/api/session` 401, `#main` empty, cache cleared; header one 52px row at 1280px (`#main` 1080px, 34px/40px) and fitting at 768px. _Limits: a reload on the login screen still loses the kept screen (it is in memory only), and a deliberate Sign Out discards unsaved edits without asking — the same as nav does today; both belong to **Save state coverage** below, which should include Sign Out when it adds unsaved-edit warnings. Not re-verified this session: the non-resume path (a list that 401s mid-load → fresh list after sign-in) — it is the pre-existing `showApp` path, unchanged._

## Interactions & States

- [x] **Save state coverage**: Every write action (estimate save, pricing save, settings save, client save) has visible pending / success / failure states, per the brief's "trust over speed" principle. Failure never loses the user's in-progress input. Covers: pending, success, network failure, server error (500). **Done 2026-09-12.** The per-screen pending/success/failure states came with each screen as it was built; what was missing was the cross-screen half, and it is `web/js/unsaved.js` — a small registry plus guards at every exit. **Native dialogs, chosen by the user**: `window.confirm` for navigation inside the app, `beforeunload` for a reload or tab close. `beforeunload` is the only thing that can stop a reload at all, so making the in-app half native too keeps one question from being asked in two different voices, and matches the delete confirmations already here. **Dirty is a snapshot comparison, not a "they typed something" flag** — a character typed and deleted again raises nothing, because a warning that fires on a screen nobody really changed teaches people to click through the one that matters. **Watchers prune themselves**: screens are replaced by writing over `#main` and there is no unmount hook, so each registration carries an `onScreen()` sentinel (the same idea as `EstimateEditor.refreshTotals`) rather than an element reference, which is what lets the rate card survive its own re-render on every structural edit. Guarded exits: all four header nav items and the logo, **Sign Out**, the estimate editor's Cancel and Back, the client record's Cancel and Back, the client history links (the one route out that isn't in the header), and the Invoice Settings modal's Cancel, Escape and backdrop click. Verified in a browser against the scratch API, on all four screens: clean screens leave silently; an edit prompts and answering "stay" keeps every keystroke; answering "discard" leaves and prunes the watcher; an edit typed and then undone stops prompting; a row added to an estimate counts; the rate card still prompts after the re-render that Add Category forces; two dirty screens at once name both ("your invoice settings and this estimate"); `beforeunload` cancels while dirty and stays silent once clean; and a successful save clears it — asserted on the pricing screen, which stays mounted, so this proves the baseline reset rather than just the pruning. **The 500 case was run against all four write paths** by faking a 5xx reply: each shows its inline "Couldn't save: …" message, keeps the input, raises the connection banner, leaves the screen still marked unsaved, and re-enables its own button. _Two notes. A deliberate Sign Out now asks, closing the last gap left by the Session control task. And a reload on the login screen after a 401 still loses the kept screen — but it now warns first, which is most of what that limitation cost._

- [x] **A write's outcome could paint over the screen that replaced it**: found 2026-09-12 while verifying the task above, and fixed with it. A save is async and nothing blocks the nav while it is in flight, so a pricing save that landed after the user navigated away ran its `render()` against `#main` and **put the entire rate card back on top of the estimates list**. Proved by delaying the PUT and leaving mid-save; the screen title went `Estimates` → `Pricing & Services` on its own. The failure path was worse in a quieter way: `showError` and `setSaving` reached for `#pricing-error` and `#js-save-pricing` unconditionally, so a save that failed after the user left threw a `TypeError` instead of reporting anything. `js/views/{pricing,estimate-editor,clients}.js` now each keep an `onScreen()` check and return early from the post-await UI work, while still clearing their `saving` flag and still writing the server's reply into `LSCData` — the save really did happen, so the cache must reflect it and the toast still says so; only the redraw is skipped. The estimate editor and the client record had the same shape (`handlers.onSaved`, `showEditor(reply.client)`, `showList()` after a delete), and are fixed the same way. Re-verified: the same delayed-save-then-navigate sequence now leaves the estimates list alone, the write still reaches the server, and a 500 landing on an abandoned screen logs nothing. _Pre-existing and unrelated to the unsaved-edit work, but reachable by any user who clicks a nav item while a save is in flight, and the guard work is what surfaced it._
- [x] **Empty and first-run states**: **Done 2026-09-12.** The empty estimates list and empty clients list already had their states — they came with those screens — so the work was the first-run half, and its shape is not what this task line assumed. **"No rates configured yet" cannot mean a blank rate card**: `GET /api/pricing` falls back to a complete `DEFAULT_PRICING` (3 categories, 18 services), so a card nobody has ever saved is indistinguishable *by content* from one they have. What is genuinely absent until the first write is the **row**, which is exactly what `updatedAt: null` reports, and that is the signal this uses. `web/js/data.js` now keeps `updatedAt` from both `/api/pricing` and `/api/settings` (it was discarding them) and exposes `pricingConfigured()` / `settingsConfigured()`. `setPricing`/`setSettings` mark configured, because reaching them at all means a write landed; `clear()` resets both on sign-out.
  **Two calls made with the user.** (1) The rate-card prompt lives in the **estimates empty state** as a setup checklist, *not* on the Pricing screen — the defaults are real rates, and a banner on a screen seen constantly would be nagging about nothing. (2) Settings get a **first-run state only**: an export-time warning for an invoice with no payment details was offered, considered and deliberately **not** built, so don't add one without asking again. A satisfied step simply isn't rendered, so once both are done the checklist falls back to the plain "No estimates yet / Click New Estimate to get started." It appears once in the life of an account and never returns. The intro line switches between "Two things" and "One thing" with the count.
  Each step names the *consequence* rather than just the screen: the rate card because every estimate is priced from it, the invoice details because `pdf.js:189` omits the **entire payment block** when every payment field is blank and a GST invoice won't export without an ABN. **Neither button carries `data-write`** — they navigate and change nothing, so the connection banner has no reason to block them. `js/app.js`'s `toPricing` and a new `openSettings` moved out of `bindNav`'s closure now the header isn't the only route to either, and `EstimatesView` threads `onGoPricing` / `onOpenSettings` through to the list.
  **Found and fixed doing this**: saving from the Invoice Settings modal left the checklist still listing the step it had just satisfied. The modal opens *over* the list without unmounting it, so nothing re-rendered — the user finishes the last piece of setup and the screen tells them they haven't. `EstimateList.refreshFirstRun()` now redraws the block where it stands (a no-op unless it is on screen) and re-binds its buttons, called from `settings.js` beside the existing `EstimateEditor.refreshTotals()`, which exists for precisely the same reason. The Pricing step needs no equivalent, because opening Pricing replaces this screen and coming back re-mounts it.
  Verified in a browser against a purpose-built never-configured database (new **`api-firstrun`** config in `.claude/launch.json`, `DATA_DIR=/tmp/lsc-billing-firstrun`): both steps on a fresh account with the plural intro; saving the rate card dropping it to one step and the intro to the singular, **confirmed against the database rather than the screen** (`pricing` row written, `settings` still absent); saving invoice settings redrawing the checklist **in place with no navigation**, its re-bound button still routing to Pricing after the DOM swap; both steps gone leaving the plain empty state; and a **full page reload** still showing the plain state — which is what proves the flags derive from the server's `updatedAt` rather than merely from the in-session setters. `#main` 1080px with 34px/40px padding throughout. _Harness note for whoever verifies next: real mouse clicks in the Browser pane never reached the page (three different controls, coordinates confirmed correct against a fresh screenshot each time, no handler and no console error), while dispatched `.click()` events ran the same listeners every time. The run above used dispatched clicks. Suspect the harness before the code if a click appears to do nothing — and poll on a DOM condition, not a fixed sleep._

## Responsive & Polish

- [x] **Desktop preservation check**: Diff the ≥1100px layout against the pre-port screenshots — confirm nothing shifted. This is the Desktop Preservation Law from the base config: no base CSS touched, only additive review. Breakpoints: ≥1100px (no changes expected).
  Done 2026-09-12. **There were no pre-port screenshots** — none exist anywhere in the repo, so
  "diff against them" was impossible as written. Done instead as a live A/B: the old root
  `index.html` served alongside `web/` (it opens fine in a browser — both its `electronAPI` calls
  are guarded), driven through both apps screen by screen at 1440×900 and measured with
  `getBoundingClientRect` + `getComputedStyle` rather than compared by eye. **Whoever does the
  tablet and mobile bands now has a baseline to regress against; capture it the same way.**
  **The law holds.** Three checks, in increasing order of what they can catch:
  1. **The base stylesheet is byte-identical.** `web/css/app.css` (rules only, excluding the
     `@font-face` header) vs the old `<style>` block: 189 lines each, **2 lines differ**, and both
     are the documented `-webkit-app-region` drops on `#app-header` and `#hdr-right`. Inert in a
     browser. No base rule was edited.
  2. **No additive stylesheet overrides a base rule.** Zero exact selector collisions across all
     six additive files. Every rule that mentions a base class reaches it only through a *new*
     container (`.login-card .btn-accent`, `#export-error .btn`, `.empty-state.first-run`,
     `.set-row .field`, `.modal-actions .saved-msg`, `.field .client-save-toggle`). One is
     genuinely global — `.btn .spinner { flex-shrink: 0 }` in `estimates.css` — but spinners only
     exist in the new async states, so it cannot reach anything the desktop app rendered.
  3. **Rendered geometry matches, screen by screen.** `#main` 1080px × 34/40 padding and the 52px
     header on every screen in both apps. Estimates list: `.cards-grid` 324/324/324 gap 14,
     `.proj-card` 243×324 pad 22 — identical, same class vocabulary. Detail: `est-header` 110,
     `totals-card`/`notes-card` 493 at relx 40/547, `tl`/`tv` pad 9/18 — identical. **Pricing is an
     exact match down to the total height** (926px both, `.pricing-grid` 493+493, and every class
     count equal — `del-btn` 26, `pricing-act` 23, `pricing-name-inp` 23). Editor backbone
     identical (`billing-block` 7, `gt-head` 7, `empty-row` 7, `right` 25, `svc-select` 4).
     Modal shell identical (box 500px, `form-grid` 210+210, pad 28/32). Clients — which has no
     desktop counterpart — conforms to the same system and overflows nothing.
  **Two differences found in the ≥1100px band. One is cosmetic and sanctioned; one was a bug.**
  - **Client Email dropped from full-width to half-width in the editor** (1000px → 493px). Every
     other shared field is at a byte-identical position; this one moved. It is a consequence of the
     documented 2026-09-11 decision to show all six client fields — three additions re-paired the
     grid — but **that decision never said the email field would change width, and nothing recorded
     it.** Left as built: reverting it would strand Client Phone alone on a row. Recorded here so it
     is a decision rather than a drift. The Business Name row is also ~22px taller now (it carries
     the client-link status and save-to-list checkbox), which pushes the rows below it down.
  - **🔴 The Invoice Settings modal was unusable on a normal laptop — found here, fixed here.** The
     desktop modal was one flat block of bank fields, 391px tall, so the shared shell in `app.css`
     (`.modal-overlay` centring a box with no `max-height` and `overflow:visible`) never had to
     think about height. This modal now carries GST, business *and* payment: **864px**. Centred in
     a shorter viewport it hung off both ends — at **1440×800, the commonest laptop viewport**, the
     title was clipped above and **Save Details and Cancel sat below the bottom edge**, with
     nothing scrollable to reach them (`ov.scrollTop` stays 0 under `overflow:visible`). The modal
     could be opened and read but **not saved or cancelled, only escaped.** Worse at 1280×720. The
     old modal at 1280×720 fits with room to spare, so this is **new damage from the port, not a
     preserved flaw** — and it is exactly what a check that only ever measured *width* would miss.
     HANDOVER's note that this modal was "verified … the ≥1100px layout numerically unchanged" was
     true and still missed it, because that pass ran in a tall window.
     Fixed additively in `css/settings.css`, **scoped to `#modal-invoice-settings`** so the shared
     shell stays untouched: `align-items:flex-start; overflow-y:auto; padding:24px 0` on the
     overlay, `margin:auto` on the box. `margin:auto` keeps it centred whenever it fits, so short
     content behaves exactly as before. Verified at 1280×720 and 1440×800 (title visible at top,
     both buttons fully reachable after scroll) and 1440×1000 (centred, 68px top and bottom, no
     scrollbar) — and then **saved through it and read the row back from the database**, not the
     toast: the marker landed and `business.abn`, `gst.registered` and `paths` were all intact, so
     the merge-not-replace behaviour survived. `npm test` 68/68.
  **Worth knowing for the two breakpoint tasks below**: the shared modal shell has no height
  strategy at all. Any modal whose content grows will repeat this, and the mobile band will hit it
  hardest. The accessibility task already owns modals — a real `max-height`/scroll treatment on
  `.modal-overlay` belongs with the focus trap, and would let this scoped override be deleted.
- [x] **Tablet layout**: `#main` fluid, card grid to two columns, editor tables scroll horizontally within their container, siloed in a `@media (max-width: 992px)` block appended at the end of the stylesheet. Breakpoints: 768–1099px.
  Done 2026-09-13, in a new **`web/css/responsive.css`** linked last from `index.html`. Not
  appended to `app.css` as the task says: that file is byte-identical to the desktop `<style>`
  block and the preservation check relies on it staying that way, so the band lives in its own
  additive file. Every rule is inside a `max-width` query; ≥1100px is untouched, re-measured and
  confirmed below.
  **The breakpoint is 1099px, not 992px.** The task line says `max-width: 992px` but states its
  own band as 768–1099px, as does the brief. 992 would have left 993–1099px on the desktop rules
  inside a sub-desktop viewport. Went with the band both documents actually describe.
  **There are two queries, because measuring found the band has two halves.** Between ~900 and
  1099px nothing is broken — the base rules already cope — so that half gets only the latent table
  guard. Both real breaks appear at ~860px and are fixed at 900 with margin:
  1. 🔴 **`.summary-bar` was silently clipping a money figure.** Five `1fr` tracks, and `1fr`'s
     minimum is `auto`, so a track cannot shrink below its content's min-content width. A
     five-figure total (`$128,450.00`) is 117px of unbreakable string at 19px, which forces every
     track to 153.6px: **692px of tracks inside a 671px box**. `.summary-bar` is `overflow:hidden`,
     so the excess is not scrolled and not wrapped — it is **cut**. At 768px the **Tax Set-Aside
     figure is simply gone**, with nothing on screen to say a number is missing. This is the same
     class of bug as the Pricing screen's: the UI looks fine and is quietly wrong.
     **It was invisible to every check so far because the scratch database tops out at $560.** No
     estimate in it is wide enough to force the track. Found by substituting a realistic figure
     into the live DOM and re-measuring, which is worth repeating for anything money-shaped: this
     app's test data is not representative of its real numbers.
     Fixed with three rules, each doing one job — `minmax(0,1fr)` stops a long value widening its
     track at all; a 16px value and 13px/12px padding make a five-figure total fit the track that
     is left (16px is already in the vocabulary, since GST carries an inline 15px at desktop); and
     `overflow-wrap:anywhere` is the backstop. Verified at 768px: five, six and seven figures all
     sit on one line with zero clip, and `$12,845,000.00` **wraps to a second line rather than
     disappearing**. Nothing is ever lost silently again.
  2. 🟡 **The header nav wraps to two lines from ~865px, not ~720px.** The Mobile layout task below
     records "it fits at 768px, so the tablet band is unaffected" — **that is wrong, and this task
     is where it bites.** `#hdr-right` needs 690px and the wordmark beside it takes 123px, so with
     24+28px of header padding the items start shrinking at ~865px. `.nav-link` sets no
     `flex-shrink`, so they shrink to min-content and the labels break: "Invoice / Settings",
     "Sign / Out", and the home button too — three items at 42px inside a header fixed at 52px.
     Not clipped, but a mess, and measured 100px above where it was expected.
     Fixed by taking the space back rather than by collapsing the nav, since the mobile task owns
     the compact nav and a real one (a menu button) is more than this band needs: `nowrap` is the
     actual fix, a 12px gap and 8px padding are what make `nowrap` fit, and the last 95px comes
     from hiding the **home button's label** — `#logo-btn` and `#nav-estimates` are both wired to
     `toEstimates` in `js/app.js`, so its label duplicates the Estimates item two places to its
     right. The house icon stays. **`index.html` gained a `<span class="nav-label">` around that
     label and an `aria-label` on the button**, so hiding it costs no accessible name — an
     icon-only button with an `aria-hidden` SVG would otherwise have had none, handing the
     accessibility task a bug this task created. Both are inert at desktop: `#logo-btn` measures
     128.8px before and after.
  **`#main` was already fluid** — `max-width:1080px` does that on its own — so the only change it
  needed was gutters: `34px 24px` below 900px, which also buys the editor's name column 32px
  (259 → 291px at 768). Held at 40px above 900 on purpose, because dropping it higher in the band
  would make the content column *grow* as the window shrinks, which reads as a jump backwards at
  the boundary. `#connection-banner` takes the same 24px inset so its text stays aligned with the
  page content.
  ⚠️ **The card grid was deliberately left alone, against the letter of this task and the brief.**
  Both say "drops to two columns". `.cards-grid` is already `repeat(auto-fill,minmax(260px,1fr))`,
  which measures **3 columns at 1099px and 2 from ~860px down** — so the brief's two columns is
  what the base rule already delivers across most of the band, and cards never go below 260px.
  Forcing `repeat(2,1fr)` would make 1099px render two 493px cards holding a name and one number,
  where 1100px renders three 324px ones: a worse layout and a visible jump at the boundary, to
  satisfy a sentence written before anything was measured. Left as-is and flagged rather than done
  quietly — **it is a one-line change in `responsive.css` if the two-column reading is preferred.**
  **The editor-table horizontal scroll is in, but latent through this band by design.** The blocks
  are `overflow-x:auto` with a 660px floor on `.gt-head`/`.gt-row` (and on `.bb-head`/`.bb-picker`,
  so the title bar and service picker scroll *with* the rows instead of leaving a blank strip
  beside them when scrolled). 660px sits just under the 705px content width at 768px, so it never
  forces a scrollbar on a width where the tables still fit — it only guarantees they can never
  silently squash. The <768px task replaces this with stacked label/value blocks.
  **Verified** at 1400 / 1100 / 1099 / 901 / 900 / 860 / 768px across the estimates list, detail,
  editor, pricing and clients screens, plus the Invoice Settings modal at 768×800 and the
  connection banner. Zero horizontal page overflow at every width. **Preservation confirmed by
  re-measurement with the new file loaded, not by assumption**: at 1400 and 1100 the block overflow
  is still `hidden`, the grid floor still `0px`, `#main` still 1080px at `34px 40px`, the summary
  bar still five 199.59px tracks at 19px with 14px/18px padding, and the cards still 3 × 324px.
  The modal's existing scoped height fix still works at 768×800 (overlay scrolls, Save and Cancel
  reachable). `npm test` 68/68.
  **Two traps worth carrying.** The browser served a **cached `index.html`** after the new `<link>`
  was added — the whole first verification pass measured desktop values in the tablet band and
  looked like the media query was broken. `curl`ing the dev server showed the correct HTML, so the
  stale copy was the browser's; a `?cb=1` reload fixed it. This is the same cache trap `web/README.md`
  already documents for `js/calc.js`, and it applies to `index.html` too. Second: **`@media` matched
  against `innerWidth` here, not the 15px-narrower client width** — 1100px did not trigger
  `max-width:1099px` — so band boundaries must be checked at the exact pixel, not inferred.
- [x] **Mobile layout**: _Note (2026-09-11, **superseded 2026-09-13** — see the Tablet layout task above): the header nav has no breakpoint yet and overflows horizontally below ~720px now that Sign Out is in it (below ~616px before). It fits at 768px, so the tablet band is unaffected; the compact nav here is what fixes it._ **It did not fit at 768px**: the labels wrapped to two lines from ~865px, inside the tablet band, and the tablet task has taken the space back (`nowrap`, tighter gap and padding, home-button label hidden) so the nav is one clean line down to 768px. That is a fit, not a collapse — **the compact nav is still this task's to build**, and it now starts from a nav that already has no label on `#logo-btn` and an `aria-label` standing in for it._ Single-column cards, collapsed compact nav, editor tables become stacked label/value blocks, `.btn-xs` touch targets bumped to ≥44px, siloed in a `@media (max-width: 768px)` block. Breakpoints: <768px.
  Done 2026-09-13, in the mobile half of **`web/css/responsive.css`**, plus a menu button in
  `index.html`, `bindCompactNav()` in `js/app.js`, and `data-label` attributes on the table cells
  of four view files. `npm test` 68/68.
  **The band is `max-width: 767px`, not the 768 this line asks for**, for the same reason the
  tablet band is 1099 and not 992: 768 is the first pixel of the tablet band in both this file and
  the brief, and a rule claiming it for both puts two layouts on one width.
  **🔴 The header was not merely untidy below 768px — it was shrinking the whole app.** `#hdr-right`
  needs 515px and there are ~236px beside the wordmark at 375px, so the header ran 250px past the
  viewport. A page whose content is wider than the layout viewport gets zoomed out to fit by the
  phone: `window.innerWidth` measured **625** against a `documentElement.clientWidth` of 375, so
  *every screen in the app* was being rendered shrunken, because of the header alone. It reads as
  "the text is small on my phone", not as "the nav is broken", which is why the earlier note
  described this as a horizontal-overflow problem. After the compact nav, `innerWidth` is 375 and
  there is zero horizontal overflow on any screen at any width tested.
  **The compact nav is `#hdr-right` itself**, taken out of flow below 768px and parked under the
  header as a panel, with a new `#nav-menu-btn` opening it. Deliberately not a second set of nav
  markup: the six buttons stay the same elements with the same handlers at every width, so the
  mobile menu cannot drift out of step with the desktop header and it inherits the unsaved-edit
  guards in `js/app.js` for nothing. Closed it is `display:none`, so its buttons leave the tab
  order and the accessibility tree with it. It closes on a nav choice (including one the unsaved
  prompt then declines), on Escape (returning focus to the toggle), on a click anywhere else
  (capture phase, so a screen that stops propagation cannot make the menu sticky), on leaving the
  band, and on landing on the login screen. **`#logo-btn` is hidden inside the panel**: it and
  `#nav-estimates` both call `toEstimates`, which is invisible as two adjacent header items and
  just a duplicate as two rows of a menu.
  **The editor's line-item tables stack, as asked** — but so do three more tables that this task
  did not name, because the same measurement that justified stacking the first one condemned them
  too. The mechanism is one shared idea: each cell carries a `data-label` matching its own column
  heading, the head row is hidden, and CSS prints the label beside the value. The labels have to be
  per cell rather than generated from `nth-child`, because three editor sections share
  `.expense-grid` with different headings (Travel is "Qty / Cost"; crew is "Days"/"Day Rate";
  equipment is "Days"/"Cost/Day"). **A column added later needs a `data-label` or it loses its
  heading on a phone.**
  1. 🔴 **The read-only estimate was cutting off the client's bill.** Same shape as the summary-bar
     bug in the tablet band, and found the same way — by substituting a realistic figure, because
     the scratch database tops out at $560 and *fits*. With a seven-figure total the five-column
     `.est-table` measured **381px inside a 341px `.est-block`**, and that block is
     `overflow:hidden`, so the **Bill column was cut, not scrolled to**, with nothing on screen to
     say a number was missing. The one number the client is charged. Now stacked, and verified
     with `$1,284,500.00` in it.
  2. 🔴 **The rate card was unusable below ~400px, and not much better at 375.** Five columns of
     which four are fixed, so the service-name input gets what is left: **90px at 375px**. Every
     pixel clawed back from the rate columns, the flag column and the padding took it to 112px —
     and at 320px it was **45px**, which is not enough of a name to read, let alone edit. Stacked,
     that input is 228px at 320px. The narrowing was built and measured first; stacking is what
     the measurements argued for.
  3. The **client history** table is an `.est-table` too, so it came along with the first.
  **Touch targets went wider than `.btn-xs`.** That class is used exactly once in the whole
  frontend; the controls that were actually too small to hit were `.del-btn` (**15.7 × 14px**, the
  row-delete on every editor and rate-card row), `.btn-sm` at 25px, the client-history link at
  15px, and every form field at ~36px. All are ≥44px in the band now, via `min-height` so anything
  already tall enough is untouched. Checkboxes are excluded — they size themselves, and a 44px one
  pushes its own row apart. The row-delete moved to the row's top-right corner once the rows
  became blocks: as a sixth stacked line it would have cost a whole row of height, across seven
  sections, for one ×.
  **Two inline styles in `estimate-editor.js` became classes in `css/estimates.css`**
  (`.gt-row .del-cell` and `.summary-bar .sum-span2`), carrying exactly what the `style` attribute
  carried. A declaration in a style attribute can only be overridden with `!important`, which
  nothing could then override in turn — and the tablet task had already recorded leaving
  `grid-column: span 2` alone for that reason. The single-column summary bar needs it set back to
  `auto`: at one explicit column, a `span 2` conjures an implicit second column and puts half the
  bar off the screen. Desktop re-measured at 399.19 / 199.61 / 399.20px, identical to the inline
  version.
  ⚠️ **Single-column cards were built, measured, and taken out again** — the same call the tablet
  task made about two columns, in the other direction. `.cards-grid` is
  `repeat(auto-fill,minmax(260px,1fr))`, which already measures one column from ~534px down, so
  every phone width gets the single column this line asks for *without a rule*. Forcing it across
  the band would only change 534–767px, where 767px would render **one 735px card** holding a name
  and one number against two 352px ones at 768px — a jump backwards at the boundary. **One line in
  `responsive.css` if the literal reading is preferred**, and the same answer is now on record for
  both bands.
  **Verified** at 1400 / 1100 / 900 / 768 / 767 / 375 / 320px across the estimates list, detail,
  editor, pricing and clients screens, plus the Invoice Settings modal, the login screen, the
  connection banner and the first-run setup block, with **zero horizontal overflow at every width
  on every screen**. Money layouts were re-checked with `$1,284,500.00` substituted into the live
  DOM, not with the fixtures. Behaviour, not just layout: an estimate edited and saved from the
  375px stacked editor (hours changed, a crew row added, then removed) was **read back from the
  server** — labour 672, expenses 900, total 1,572, hours 12, the crew row's role/days/cost all
  stored as typed — and a rate saved from the stacked rate card was read back from `/api/pricing`.
  **Desktop preservation re-measured with every new file loaded**, not assumed: `#main` 1080px at
  `34px 40px`, `#logo-btn` 128.81px, cards 3 × 324px gap 14, `.proj-card` 243px tall pad 22,
  summary bar five 199.594px tracks at 19px with 14px/18px padding, `.gt-row` 586/90/90/90/110/32,
  `.del-btn` 15.7px, `est-totals` 493+493 at relx 40/547, `tl`/`tv` pad 9px/18px, `.pricing-grid`
  493+493 with `del-btn` 26 / `pricing-act` 23 / `pricing-name-inp` 23, modal box 500px at
  `28px 32px` with `form-grid` 210+210. Every table still `display:table` with its head row
  showing and no `::before` anywhere. The tablet band re-checked at 900px: `#main` `34px 24px`,
  nav on one line, `#logo-btn`'s label hidden, the rate card still a table.
  **Traps worth carrying.** The `index.html` / asset cache trap bit again, twice — once on the new
  `<link>`, once on the four changed view files, and the second time it looked exactly like the
  `data-label` attributes not being written at all (`::before` rendered `""`). `fetch(url, {cache:
  'reload'})` on each changed file before reloading settles it. And in the Browser pane's mobile
  emulation `@media` matched `documentElement.clientWidth` (375) while a *resized window* at 768px
  matched `innerWidth` (768) against a 753px client width — the tablet task's finding still holds,
  so band edges have to be checked at the exact pixel in both modes.

- [x] **Accessibility pass**: Done 2026-09-14. `web/css/a11y.css`, a new file loaded last of all
  (after `responsive.css`), plus a focus trap in `web/js/views/settings.js`.
  - **`--muted` contrast**: was `rgba(240,237,232,0.42)` — 3.67:1 on `--bg`, 3.34:1 on `--surface`,
    both under the 4.5:1 body-text threshold (computed with the WCAG relative-luminance formula
    against both backgrounds the token is used on, not eyeballed). `0.6` clears both (6.15:1 /
    5.2:1). **Not edited in `app.css`** — that file's own header says not to edit rules in it, and
    the Desktop Preservation Law holds for a reason: this is a custom property, so redeclaring it
    on `:root` from a later-loaded stylesheet overrides the value everywhere it's used without
    touching the base file at all, the same way `responsive.css` already overrides base rules from
    outside `app.css`.
  - **Focus rings**: `app.css` strips `outline` on every text input, select and custom button
    (`.field input/textarea`, `.svc-select`, `.text-inp`, `.num-inp`, the pricing-table/tax-setting/
    doc-type/invoice-number inputs) and leaves `.btn`/`.nav-link`/`.back-btn`/`.del-btn` to the UA
    default, which reads inconsistently on this dark theme. Several screens had already added their
    own scoped `:focus-visible` ring with the same treatment (`login.css`, `connection.css`, the
    estimate card in `estimates.css`, the client-history link in `clients.css`) — `a11y.css` is that
    same `outline: 2px solid var(--accent); outline-offset: 2px` rule, applied to everything else,
    so keyboard navigation is never a guess about what's focused. `:focus-visible`, not `:focus`, so
    a mouse click still rings nothing.
  - **Modal focus trap**: `web/js/views/settings.js` (the only true modal dialog in the app — the
    compact mobile nav is a disclosure panel, not a dialog, and already closes on Escape with focus
    return, so it wasn't in scope here). Tab and Shift+Tab now wrap inside `.modal-box` instead of
    escaping into whatever `#main` renders behind it — verified in a browser: Shift+Tab from the
    first field (`set-biz-name`) landed on the last button (`set-save`), and Tab from there landed
    back on `set-biz-name`. The focusable set is computed fresh on every Tab rather than cached,
    because toggling GST registration disables/enables two fields while the modal is open. Escape-
    to-close and focus-return to the opener already existed and were re-verified, not rebuilt.
  - **`aria-live`**: already done before this task — `#connection-banner` has `role="status"`
    (`index.html`) and `#login-error` has `role="alert" aria-live="assertive"`
    (`js/views/login.js`) — so nothing needed adding here.
  - Verified in a browser against `api-scratch`: tab order on the login screen (ring on Username,
    Password, Sign In); the header nav ring (`.nav-link:focus-visible`, confirmed on "Estimates");
    the new-estimate editor's autofocused first field; the ≥1100px layout unchanged (`#main` 1080px
    at `34px 40px`); and `npm test` 68/68 (no server files touched, run as the standing acceptance
    gate anyway).
- [x] **Font loading**: Done as part of the login-screen port — the two embedded `Delight` faces (400 and 700) were decoded out of the old `index.html` into `web/fonts/Delight-{400,700}.ttf` and are referenced by `url()` at the top of `web/css/app.css`. They are `.ttf`, not `.woff2`: the source blobs are TrueType and re-compressing them needs a tool this repo doesn't carry — worth doing if page weight ever matters (~120KB total today). Note `'Funnel Sans'` was never embedded; it resolves from the system or falls back to `sans-serif`, exactly as in the desktop app. The old root `index.html` keeps its blobs and is being retired as-is.
- [ ] **Fonts, embedded assets and Electron chrome cleanup**: Remove `-webkit-app-region: drag`/`no-drag`, `titleBarStyle: hiddenInset`, and any other Electron-only artifacts from the HTML/CSS now that it's a browser page. _Partly handled already: `web/css/app.css` was written without the two `-webkit-app-region` declarations (they are inert in a browser, so this is visually identical). `titleBarStyle` lives in `main.js`, which is the Electron main process and is being retired rather than cleaned. Keep this open to catch whatever else the remaining screens drag across during the port._

## Deployment

- [x] **Deployment guide**: Done 2026-09-14 — [`DEPLOYMENT.md`](DEPLOYMENT.md). Covers joining
  `lsc-billing` to the existing `cloudflared-tunnel`'s Docker network, adding a public hostname in
  the Zero Trust dashboard (the two steps only the user can do, since they're dashboard/NAS-live
  actions), and the `CORS_ORIGINS`/cookie config that follows from it. **The Tailscale-vs-public
  question is answered, not left open**: Cloudflare Tunnel, because the security posture
  (password-auth-on-a-public-port, CLAUDE.md) was already decided and Tailscale-only would
  reintroduce the access friction that decision opted out of. Adds to the existing tunnel rather
  than a second one — one less container, and nothing about this API's data needs isolation from
  the other services already on it.
- [x] **Publish the frontend to GitHub Pages**: Done 2026-09-14 —
  [`.github/workflows/deploy-pages.yml`](../../.github/workflows/deploy-pages.yml), an Actions
  workflow rather than a `gh-pages` branch (decided with the user). Triggers on a push to `main`
  touching `web/`. **Solves the cache-busting problem this task flagged**, not just the publish
  step: every local `<script src="js/...">`/`<link href="css/...">` in `index.html` gets a
  `?v=<short commit sha>` query string appended at build time (verified locally against the real
  `web/index.html` before use — every `js/views/*.js` nested path matched correctly), so a stale
  cached `calc.js` disagreeing with the server's money model — the exact bug this task describes,
  found 2026-09-10 — can't happen again from a repeat visit. **`js/config.js` is generated at
  deploy time from a repository secret** (`LSC_API_BASE`), never committed — it's already
  gitignored, and this is the first commit this repo has, so a root `.gitignore` was added
  alongside it (`node_modules/`, `server/data/`, `server/.env`, `web/js/config.js`, `.DS_Store`).
  `CORS_ORIGINS` on the real deploy points at the resulting Pages origin, per `DEPLOYMENT.md`.
  Two one-time manual steps remain, both dashboard-only (Pages source + the secret) — written up
  in `DEPLOYMENT.md` rather than repeated here.
- [x] **Local-to-NAS migration test**: Done against the **real DXP4800 Pro**, not simulated — decided with the user 2026-09-11. The container runs at `/volume4/lsc-billing/app` with its data volume at `/volume4/lsc-billing/data` (Storage Pool 4, the NAS's fastest/emptiest volume — SQLite is random-I/O heavy). `docker compose build && docker compose up -d` succeeded unmodified; all three migrations ran on first boot (v1 → v2 → v3, including the GST-free schema from the same session); the account was seeded (`docker compose exec billing npm run seed`); login, session, and a create → verify-on-disk-via-sqlite3 → delete round trip on `/api/estimates` all passed; the container survived a `docker compose restart` with data intact; pre-write backups fired into `/volume4/lsc-billing/data/backups/` exactly as `server/src/backup.js` describes. No application code changed to make this work — `DATA_DIR=/data` inside the container, mapped to the NAS path in `docker-compose.yml`, was the whole story.
  **Three NAS-specific gotchas for whoever does the Deployment guide task below**, none of them application bugs:
  1. **UGOS wraps its own `rsync`** (likely for the NAS's snapshot-sync feature) in a way that breaks a plain `rsync -e ssh` transfer (`ug_start_server... invalid path` — it's intercepting the remote rsync binary, not a real permissions error). Worked around with `tar czf - . | ssh nas "tar xzf - -C dest"` instead.
  2. **`scp`/SFTP is sandboxed to different paths than the interactive shell** — writes that succeed via `ssh nas "cat > file"` fail via `scp` with a misleading "No such file or directory" even though the directory exists and is writable. Pipe file content through `ssh ... "cat > path"` instead of `scp`.
  3. **`/volume4`'s top level is root-owned**; creating a new folder there needs one interactive `sudo` command (`ssh -t`, not plain `ssh`, so sudo has a TTY to prompt on) — after `chown` to the account's own user, everything else is passwordless. Docker itself also needs the account added to the `docker` group (`sudo usermod -aG docker <user>`, same TTY requirement), which only takes effect in a **new** SSH session, not the one that ran the command.
  **Left deliberately undone**: the container is bound to `127.0.0.1:8080` (loopback only, per the compose file's own comment) and is not yet reachable from outside the NAS. The user's existing `cloudflared-tunnel` container (already running, serving Nextcloud and self-hosted Supabase) is **token-mode** — its routing rules live in the Cloudflare Zero Trust dashboard, not a local file, and it currently sits on Docker's plain `bridge` network rather than a custom one shared with other services. Wiring the billing API into it (network reachability + a new public hostname in the dashboard) needs the user at that dashboard and is the next piece of the Deployment task, not something done here.

## Review

- [ ] **Design review**: Run `/design-review` against the brief once the Core UI and Responsive sections are built.
