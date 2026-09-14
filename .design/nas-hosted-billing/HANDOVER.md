# Handover: NAS-Hosted Billing → GitHub Pages Website

For a fresh agent picking this up. Root: the repo containing this `.design/` folder. Read
[CLAUDE.md](../../CLAUDE.md) first for the model/effort guidance and the two-codebases warning.

## What this is

Overhauling the LSC Billing App from a memoryless Electron desktop app into a real website.
Frontend on GitHub Pages, backend (Node/Express + SQLite) in Docker on the user's NAS. Full
rationale, architecture diagram and experience principles: [DESIGN_BRIEF.md](DESIGN_BRIEF.md).

## State as of 2026-09-14 (every section of TASKS.md is complete, including Deployment — the app
is live: **https://lsccreative.github.io/lsc-billing-app/** talking to
**https://billing.lsccreative.studio**. All that remains is the user signing in once with real
credentials, per the "Login accounts" note below)

Working tree: `server/` (the API, Node/Express + SQLite) and `web/` (the GitHub Pages frontend —
new as of 8 Sept 2026, see below). `index.html`/`main.js`/`preload.js` at repo root are the old
Electron app, being retired — leave alone except to port pieces per the task list below.

**Done and tested** (`cd server && npm test` — 68/68 passing):
- Foundation: Docker scaffold, SQLite schema/migrations, auth (Argon2id, sessions, login
  throttle), `calc.js` money model.
- Core API: full Estimates CRUD + duplicate (`server/src/routes/estimates.js`), Clients CRUD +
  typeahead search + upsert-by-name + per-client estimate history (`routes/clients.js`), Pricing
  and Settings read/write (`routes/pricing.js`, `routes/settings.js` — this is the fix for the
  old app's fake "Save Rates" button).
- Backup + safety layer (`server/src/backup.js`): nightly snapshot (2am local, 14 kept) plus a
  pre-write snapshot before every mutating `/api` request (10 kept), both via better-sqlite3's
  Online Backup API. Corrupt-file boot refusal already existed in `db.js`'s `quick_check`
  pragma. Wired into `app.js` (middleware) and `index.js` (scheduler + shutdown). Tested in
  `test/test-backup.js` and manually verified against a running server.
- Cross-origin plumbing for the GitHub Pages split: `CORS_ORIGINS` allow-list and
  `COOKIE_SAMESITE` config in `server/src/config.js`, applied in `app.js` and `auth.js`. See
  `server/.env.example` for the env vars a real deployment needs.
- **Server-side PDF export** (`server/src/pdf.js`, `server/src/routes/pdf.js`):
  `POST /api/estimates/:id/pdf` builds the same HTML the old `main.js` did
  (`buildClientPDF`/`buildClientInvoicePDF`, ported verbatim — quote vs. invoice picked by
  `docType`), renders it via `puppeteer-core` against headless Chromium, streams the PDF back,
  and writes a copy to `/data/exports`. The Dockerfile's runtime stage installs the `chromium`
  apt package and sets `PUPPETEER_EXECUTABLE_PATH`; on a Mac dev machine with no `PUPPETEER_EXECUTABLE_PATH`
  set, `pdf.js` falls back to a locally installed Google Chrome so `npm test` still exercises a
  real render. Tested in `test/test-pdf.js` (HTML content assertions + one real end-to-end
  render, skipped automatically if no Chromium/Chrome is found) and manually verified against a
  built Docker image: seeded an account, logged in, saved pricing, created an estimate, and
  confirmed the endpoint returns a valid PDF and writes the file to `/data/exports` inside the
  container.
- **The frontend scaffold + login screen** (`web/`) — the GitHub Pages site. No build step, no
  dependencies. See [`web/README.md`](../../web/README.md) for layout, conventions and how to run
  it locally; the essentials:
  - `web/css/app.css` is the Electron stylesheet ported **verbatim** (byte-identical apart from
    the two inert `-webkit-app-region` declarations and the `@font-face` blobs, which became real
    files in `web/fonts/`). The Desktop Preservation Law applies — don't edit rules in it. New
    screens add their own additive stylesheet, as `css/login.css` does.
  - `web/js/api.js` is the only place that calls `fetch`. It classifies every failure as
    `network` / `auth` / `throttled` / `client` / `server`, because those need completely
    different UI responses. **The connection-lost banner should hook in here**, not into
    individual callers.
  - `web/js/config.js` holds `window.LSC_API_BASE` and is **gitignored** — copy it from
    `config.example.js`. Keeps the NAS hostname out of a public repo.
  - Views are IIFEs exposing one global (`LoginView`), mounted by `js/app.js`. No ES modules, so
    a plain static host needs no MIME configuration.
  - `.claude/launch.json` has `api` and `web` preview configs that run the two origins locally
    with the right CORS/cookie env vars. Verified end to end in a browser: anonymous boot, wrong
    password, 429 throttle countdown, API-unreachable, successful login, and session surviving a
    reload.
  - **Gotcha worth keeping**: an id selector's own `display` outranks the UA stylesheet's
    `[hidden] { display: none }`, so `el.hidden = true` silently did nothing to `#login-view`.
    `css/login.css` carries a `[hidden] { display: none !important }` guard. Any new view that
    sets `display` on an id and relies on the `hidden` attribute needs that guard to be present.
- **The connection-lost banner** (`web/js/connection.js`, `web/css/connection.css`, markup in
  `web/index.html` under the header). Sticky at `top:52px` under the app header, `role="status"`,
  with a Try Again button. Two things here are conventions the rest of the port depends on:
  - **`js/api.js` now has `subscribe(listener)`**, called with `{ok:true}` or `{ok:false, kind}`
    after every request. The banner uses it so it sees all traffic from one place. Use it for
    anything else that needs to watch the connection — don't make callers notify the banner.
  - **Every control that writes to the API must carry `data-write`.** While the banner is up,
    `connection.js` blocks activation of those elements in the capture phase and CSS dims them.
    It's done that way, rather than by flipping `disabled`, because the screens that own those
    buttons manage `disabled` for their own reasons (save in flight, incomplete form) and an
    outside toggle would re-enable buttons meant to stay off. Delegation also covers markup
    rendered after the banner appears. Read-only controls must *not* carry it.
  - **The trigger is narrower than TASKS.md's original wording** ("any non-2xx"), on purpose:
    only `network` and `server` raise it. `auth`/`client`/`throttled` are a healthy server
    refusing one request — the caller handles those inline, and they *clear* the banner. Copy
    differs per kind, so it never says "can't reach the server" about a server that answered.
  - Verified in a browser end to end (banner raised/cleared, writes dead to mouse *and* keyboard
    while a read-only button beside them still fired, sticky at scroll, recovery, 404 clearing
    it, and the banner staying hidden on the login screen so it doesn't double up on that
    screen's own inline error).
  - ~~**Open seam this leaves**: an `auth` failure mid-session clears the banner and does nothing
    else.~~ **Closed** by the estimates port below — every estimate screen routes an `auth`
    failure to `onAuthLost`, which lands on the login screen with an explanation. The visible
    Sign Out button followed on 2026-09-11 (see "Session control" below).
  - Fixed in passing: `api.js` resolved `base()` inside the `try` that treats any throw as a
    fetch failure, so a missing `js/config.js` reported "could not reach the server" instead of
    "copy config.example.js" — the wrong first diagnosis for a fresh deploy.

- **The estimates list, detail and editor** (`web/js/views/estimate-{list,detail,editor}.js`, with
  `views/estimates.js` routing between them, and `js/rows.js` / `js/data.js` / `js/util.js` /
  `js/toast.js` behind them). `var projects=[]` and `localStorage` are gone; the list is
  `GET /api/estimates` and each estimate is fetched fresh when opened. Save, delete and duplicate
  are wired, carry `data-write`, and have pending / success / failure states. The things worth
  knowing before touching this:
  - **`web/js/calc.js` is a byte-identical copy of `server/src/calc.js`.** The editor's live
    totals are computed by the same code the server stores totals with. The desktop app's inline
    arithmetic could not be ported — it predates GST and counted pass-through as margin — and a
    second browser-side implementation would have been free to drift from the record. **If you
    change the money model, run `cp server/src/calc.js web/js/calc.js`**; `test-calc.js` fails if
    the two differ. `calc.js` is the only thing that produces a headline figure. `js/rows.js`
    produces the per-row and per-section numbers under it and follows calc.js's lookup rule, so
    the rows always sum to the total beneath them.
  - **The money labels changed**, as `BILLING_APP_PLAN.md` §204 specifies: Client Price (ex GST) /
    GST / Total (inc GST) / Tax Set-Aside / Est. Take-Home, replacing "Net Invoice" / "Internal
    Tax" / "Gross Profit". "Pixel-identical" was read as the layout and visual system, which is
    unchanged — verified numerically at ≥1100px (`#main` still 1080px wide with 34px/40px
    padding; summary bars still `repeat(5,1fr)`, the second one spanning 2/1/2).
  - **A row whose service has left the rate card bills “—”, not a number.** `computeTotals` prices
    a labour or travel line only if it is still on the live card, so anything else contributes
    nothing; the UI now says so instead of printing a figure that isn't in the subtotal. The
    category still renders, tagged "No longer on the rate card", with its rows visible and
    removable but no picker. Reachable as of the Pricing screen, and verified against it.
  - **The client snapshot is nested**: the editor reads and writes `client.businessName` /
    `client.contactName` / `client.email`, and passes `phone` / `abn` / `address` through
    untouched so saving from here never erases fields set elsewhere.
  - Verified in a browser against a running API: create → save → detail → edit → save → duplicate
    → delete; live totals matching stored totals on both not-registered and GST-exclusive
    settings; the custom-bill override; row removal restoring the empty state; HTML escaping;
    validation; a save with the server stopped (banner + inline message, no input lost, write
    controls dead while a read-only button beside them still fired); recovery via Try Again; and
    a 401 landing on the login screen.
  - **Fixed in passing — two server bugs, both money- or safety-affecting:**
    1. **Estimates were priced against an empty rate card on a fresh database.**
       `routes/estimates.js` and `routes/pdf.js` each had their own `readPricing`/`readSettings`
       that fell back to `{}`, while `GET /api/pricing` fell back to `DEFAULT_PRICING`. An empty
       card is not a neutral default — `computeTotals` skips any labour or travel line it can't
       find on it — so until someone opened the Pricing screen and saved once, every estimate was
       *stored* with its labour and travel silently zeroed (crew and equipment, which carry their
       own costs, came through) while the editor displayed the correct figures. Now one
       implementation in `server/src/ratecard.js`, used by all four routes. Regression test:
       `server/test/test-ratecard.js`. **This is the bug the shared `calc.js` was meant to make
       impossible, and it surfaced within a minute of the first real save.**
    2. **Backups taken in the same millisecond overwrote each other.** `backup.js` built the
       filename from `toISOString()`, so two snapshots inside one millisecond resolved to a single
       path and the second replaced the first — losing a recovery point, which a burst of writes
       makes likely. `test-backup.js` had been failing intermittently on this; it passed in full
       runs only because the extra load spread the writes out. Fixed with a collision suffix.

- **The Pricing screen** (`web/js/views/pricing.js`, `web/css/pricing.css`, mounted from the
  header's Pricing nav item in `js/app.js`). "Save Rates" is now `PUT /api/pricing` and the
  confirmation waits for the server — the fake-save bug is dead. Reset Defaults is
  `POST /api/pricing/reset`. Things worth knowing before touching it:
  - **Edits run against a deep clone of `LSCData.pricing()`**, and the cache is replaced only by
    what the server echoes back on a successful save. The editor computes live totals from that
    cache, so an abandoned or failed edit must never reach it.
  - **Field edits write straight to the working copy without a re-render** (typing a name would
    otherwise lose focus mid-word); adding or deleting a row re-renders, because the
    `data-si`/`data-ri` indices every other input carries would go stale.
  - **The tax set-aside rate is validated, not defaulted.** The desktop app read it as
    `parseFloat(v)/100 || 0.35`, so a deliberate 0% silently became 35%. Blank or out-of-range now
    blocks the save. The field shows a percent and stores a fraction; `toPercent` snaps the
    round-trip so 0.07 doesn't render as `7.000000000000001`.
  - Delete confirmations keep the desktop app's "N saved estimates use it" warning, counted from
    `GET /api/estimates`. It is advisory — if that request fails the note is dropped rather than
    claiming a reassuring zero.
  - Verified in a browser against the real API: rate edit → save → read back from the server →
    the editor pricing against the new figure with no reload; consecutive saves; every validation
    case; Reset Defaults; a save with the server stopped (banner + inline message, no input lost,
    writes dead while a read-only button beside them still fired) and recovery via Try Again; and
    the ≥1100px layout confirmed numerically (`#main` 1080px, 34px/40px padding, `.pricing-grid`
    2 × 493px).
  - **Fixed in passing — two bugs, both of the "looks like it worked" kind this screen exists to
    kill:**
    1. **Every save after the first was a silent no-op.** The `saving` guard was set on entry and
       cleared only in the `catch`, so after one success the flag stayed true and the next click
       returned early — button enabled, spinner gone, nothing sent. Found by asserting against the
       server after a *second* save rather than trusting the toast.
    2. **`routes/pdf.js` kept its own estimates-row mapper** that predated `section_labels_json`,
       so the snapshot below reached the API and not the PDF — the fix was in the row and the
       document still printed the wrong heading. This is the *second* bug caused by that
       duplication (the first was `readPricing`, last session), so both routes now read a row
       through **`server/src/estimate.js`**. Unit tests passed throughout; only re-exporting a
       real PDF and reading the text caught it.

- **Labour category labels are snapshotted onto the estimate** (schema **v2**,
  `estimates.section_labels_json`; `sectionLabelsFor` in `server/src/ratecard.js`). This closes the
  seam the estimates port left open, and it was worse than that note described: the label is a
  heading on the **client-facing PDF** (`serviceItemsHtml` in `pdf.js`), and it was read from the
  live rate card at render time. Deleting a category re-headed old quotes "Archived Services" —
  but *renaming* one silently re-headed every quote already sent under the old name, which is both
  likelier and harder to notice. Nothing could trigger either until the Pricing screen shipped.
  - The live card wins for a category that still exists, because saving an estimate is re-quoting
    it (the client fields are re-snapshotted on the same save). The stored label is kept only for
    categories the card no longer has, so editing an old estimate can't discard the last record of
    what it was called.
  - **The editor and the detail view deliberately differ**, and `sectionsFor` in `web/js/rows.js`
    takes an `asDocument` flag to say which is which: the detail view shows what the estimate says
    (matching its PDF), the editor shows the live card, because its picker offers the live
    category's services and saving adopts the live name.
  - A duplicate inherits the original's headings rather than re-reading the card.
  - Estimates written before the migration carry `{}` and fall back to the live card, exactly as
    they behaved before. Tested in `server/test/test-section-labels.js`; verified end to end by
    renaming, then deleting, a category and re-exporting the PDF of an estimate that used it.

- **The Invoice Settings modal** (`web/js/views/settings.js`, `web/css/settings.css`, overlay in
  `web/index.html`, opened from the header's nav item in `js/app.js`). Reads and writes
  `/api/settings` instead of `localStorage`. Things worth knowing before touching it:
  - **It carries the GST block as well as the payment details**, extended from the original task
    with the user on 2026-09-10. `calc.js` reads `settings.gst` on every estimate — add on top,
    back out of a GST-inclusive price, or none — but nothing in the UI could set it, so the app was
    pinned to the `registered: false` default and half the money model was unreachable. The desktop
    modal had no GST because the desktop app had no GST.
  - **The save merges onto a freshly-read copy of the settings; it does not replace them.**
    `PUT /api/settings` writes the request body over the whole `data_json` blob, and this modal only
    shows `gst` and `payment`. PUTting just those two would have silently wiped `business` and
    `paths` — and wiping `gst` would have changed the money on every estimate saved afterwards, from
    a screen that never mentions it. It reads fresh on open rather than from `LSCData.settings()`
    for the same reason: a merge is only as good as what it merges onto, and the cache is a snapshot
    from boot. The Pricing screen can safely edit from its cache because it owns every key it
    writes; this one does not. **Any screen added later that writes a subset of settings needs the
    same treatment.**
  - **The GST rate is validated, not defaulted** — the same falsy-zero trap the tax set-aside rate
    had. A deliberate 0% stores as 0. The rate and the inclusive-pricing toggle are disabled while
    unregistered, because `calc.js` ignores both then.
  - **`EstimateEditor.refreshTotals()` exists for this screen.** The modal opens *over* the estimate
    editor without unmounting it, so changing GST left the summary bar showing figures from the old
    configuration until the next keystroke happened to recompute them. A successful save calls it;
    it no-ops unless the editor is actually on screen.
  - **The modal watches `LSCApi.subscribe` itself.** The connection banner is sticky at `z-index:99`
    and the overlay is at 9000, so while the modal is open the banner is behind it — and
    `connection.js` blocks `[data-write]` in the capture phase, so a blocked Save never reaches a
    handler that could explain itself. Watching the same signal the banner watches puts the
    explanation inside the modal. This is the sanctioned use of `subscribe()`, not a workaround.
  - Verified in a browser against the real API: save → reopen → read back from the server; a
    *second* save landing; `business`/`paths` provably intact across both; trim-on-save; validation
    blocking with no input lost; 0% storing as 0; the editor's live totals matching the server's
    stored totals after a GST change; save with the server stopped and recovery via Try Again; a 401
    mid-edit landing on login; Escape closing and returning focus; every control carrying exactly one
    associated label; and the ≥1100px layout numerically unchanged.
  - **Left open on purpose**: a full focus trap. The accessibility task in TASKS.md owns modals
    across the app and should do them together. Escape-to-close and focus-return are already here.
  - **The one-time `localStorage` import was dropped, not forgotten.** The old app runs from
    `file://` (`win.loadFile` in `main.js:34`), so its settings are in a different origin inside
    Electron's own Chromium profile — a GitHub Pages page can never read them. The prompt would have
    been code that silently never fired. Reasoning is written up in TASKS.md.
  - **Found doing this — a bug in the client-facing invoice, since fixed (see "Invoice GST" below):** with GST registered, the
    exported invoice prints no GST line and a footer reading "All prices in AUD. GST not included."
    on an estimate the server stored with `gst: 50.91`. Both strings are hardcoded in `pdf.js`
    (lines 127 and 172), ported from the desktop app, which had no GST. Nothing could reach it until
    this screen made GST settable — the same shape as the category-rename bug the Pricing screen
    exposed. **It is the reason GST should not actually be switched on yet**, and it is its own task
    in TASKS.md. Caught by re-exporting a real invoice and reading it with `pdftotext`; every test in
    the suite passed throughout, which is the third time that has been true on this project.

- **GST-free estimates** (schema **v3**, `estimates.gst_free`; the fourth `options` argument to
  `computeTotals`). Being GST-registered doesn't make every job GST-bearing, and the money model
  only knew about GST globally — so the only way to quote a GST-free job was to switch GST off
  account-wide, which re-priced everything saved afterwards. Decided and built 2026-09-10.
  - **Per estimate, not per line item** — the user's choice between the two.
  - **A GST-free estimate prices exactly as an unregistered business would.** That is the entire
    rule, and `test-calc.js` asserts it as a `deepEqual` against the unregistered case rather than
    restating the arithmetic, so the two can't drift.
  - **The decision that isn't derivable, and the one to preserve**: on a GST-*inclusive* rate card, a
    GST-free job bills the **listed** rate. A service at $560 stays $560; it does not fall to
    $509.09. A job's tax treatment must not move the quoted price. It follows that the whole $560 is
    revenue, so the tax set-aside is provisioned on all of it and take-home *rises* on a GST-free
    job — which looks surprising until you remember the GST was never the business's money.
  - **The flag is on the estimate, not derived at render time**, for the same reason `client_json`
    and `section_labels_json` are: the tax treatment of a document already sent must not move. A
    duplicate inherits it rather than re-reading settings.
  - **The editor's toggle only exists when the business is registered**, since it could do nothing
    otherwise — and when it is absent, `payload()` falls back to the estimate's stored flag instead
    of sending false. Without that, switching GST off account-wide and then editing an old estimate
    would erase the record of it having been quoted GST-free.
  - **Only a literal `true` opts out**, matching `gst.registered`, so a half-populated request body
    can never silently drop GST off an invoice. Worth knowing that the test asserting this is what
    caught the first implementation being merely truthy — `{ gstFree: 1 }` would have worked.
  - Verified in a browser against the real API on both settings shapes: live totals matching the
    server's stored totals in both states, toggling back cleanly, the duplicate inheriting the flag,
    the toggle absent and the flag preserved when unregistered, the v3 migration leaving an existing
    estimate's totals byte-identical, and the ≥1100px layout unchanged (document-type bar 61px tall
    with and without the toggle).
  - **Found doing this, and it is a deployment problem rather than a code one**: a browser served a
    stale `js/calc.js` across a full reload, so the editor priced with the *old* money model while
    the server used the new one — precisely the disagreement that keeping `calc.js` byte-identical
    exists to prevent, and invisible to `test-calc.js`, which only compares the files on disk. The
    GitHub Pages task in TASKS.md now owns cache-busting for that file. **If live totals ever look
    impossible, check the browser is running the calc.js you think it is** — `LSCCalc.computeTotals.length`
    should be 4.

- **The API is now running on the real NAS** (`/volume4/lsc-billing/app`, data at
  `/volume4/lsc-billing/data` on Storage Pool 4), not just tested locally. Decided and done with the
  user 2026-09-11 in response to a caching bug found the day before (see the GST-free entry above) —
  the user wanted the database on real hardware rather than continuing to iterate against a local
  file. `docker compose build && docker compose up -d` ran **unmodified**; only the compose file's
  volume line changed, from `./data` to the absolute NAS path. All three migrations applied on first
  boot. Verified: seeded account, login round-trip (wrong password rejected, right password sets a
  session, protected route 401s without it), a create → confirmed on disk via a direct `sqlite3`
  query on the NAS itself (not through the API) → deleted round trip on `/api/estimates`, the
  container surviving `docker compose restart` with data intact, and pre-write backups landing in
  `/data/backups/` exactly as `backup.js` describes.
  - **This satisfies TASKS.md's "Local-to-NAS migration test"**, against real hardware rather than a
    simulated mount — see that task for the three NAS-specific SSH/transfer gotchas (a custom `rsync`
    wrapper, sandboxed `scp`, and the `sudo`/docker-group TTY requirement) worth knowing before
    touching this NAS again.
  - **Not reachable from outside the NAS yet, on purpose.** The container is bound to
    `127.0.0.1:8080`, per the compose file's own guidance, until a proxy or tunnel is deliberately
    put in front of it. The user already runs a Cloudflare Tunnel (`cloudflared-tunnel`, serving
    Nextcloud and a self-hosted Supabase) but it's **token-mode** — routes live in the Cloudflare
    Zero Trust dashboard, not a file this session could edit — and sits on Docker's default `bridge`
    network rather than one shared with other services. Wiring the billing API into it (or standing
    up a second tunnel) is the remaining half of the Deployment task in TASKS.md, and needs the user
    at that dashboard.
  - `ADMIN_PASSWORD` was removed from the NAS's `.env` after seeding, per the app's own convention
    (`scripts/seed-account.js`'s own printed reminder) — the account exists in the database now, the
    env var was only ever needed once.

- **Invoice GST** (2026-09-11) — the invoice/quote PDF no longer contradicts the GST it charges.
  Full write-up in TASKS.md; the things to know before touching it:
  - **Three states, one classifier**: `gstTreatment(totals, estimate)` in `calc.js` returns
    `taxable` / `free` / `none`. Both `pdf.js` and the detail view call it, so they can't disagree.
    It lives in `calc.js` for that reason — **re-copy to `web/js/calc.js` if you touch it**.
  - **It reads the stored `totals.gst` and the estimate's `gstFree` flag, never live
    `settings.gst`.** Same principle as `client_json`/`section_labels_json`: a sent document's tax
    treatment must not move. Verified by re-exporting a taxable invoice after switching GST off.
  - Only `taxable` invoices are titled **TAX INVOICE**. A GST-free or unregistered one is a plain
    INVOICE and must not claim otherwise. "GST not included" is gone from every state — for an
    unregistered business it implied GST was still to come.
  - **The export route refuses a taxable invoice with no ABN** (422 `abn_required`, with a
    `message`). The PDF export button, when built, should show that message inline — it's the one
    4xx from that route a user can fix themselves.
  - The Invoice Settings modal now owns `business` as well (name + ABN; `email`/`phone` pass
    through untouched). ABN is ATO-checksum validated, stored as bare digits, printed formatted.
  - **GST is now safe to switch on** — once the real ABN is entered in Invoice Settings.
  - Open, for the user to decide: ATO tax invoices over $1,000 should describe each item's quantity
    and price; this document deliberately lists services without per-line prices.

- **The Clients screen + typeahead** (2026-09-11) — `web/js/views/clients.js`,
  `web/js/typeahead.js`, `web/css/clients.css`, a Clients nav item, and changes to the estimate
  editor. No server changes. Full verification list in TASKS.md; the things to know:
  - **Two decisions made with the user.** The editor shows **all six client fields** now (phone,
    ABN, address added) — the invoice PDF prints the client's ABN, and nothing should print that
    the editor didn't show. And an unlinked business name gets a **"Save to client list"
    checkbox, on by default**, so the client list builds itself while quoting.
  - **Details flow one way: client list → estimate, copied at save.** Editing or deleting a client
    never touches a saved estimate's snapshot (verified). Save-to-list links to an existing record
    with the same name (case-insensitive) and **never overwrites it** — which is why it doesn't use
    `POST /api/clients/upsert`: that route overwrites every field, `notes` included, with whatever
    the body carries. It's still unused by the UI; don't wire it to the estimate save.
  - **Business names are kept unique** — the Clients screen refuses a second record with an
    existing name — because the save-to-list link is by name. Both checks read the full
    `GET /api/clients`, not `?q=`, which caps at 20 partial matches and could drop the exact one.
  - **The link (`clientId`) is derived, not sticky.** It holds while Business Name still matches
    the linked client's name; editing it away lapses the link (and shows the checkbox), typing it
    back restores it. An old estimate with no link shows the checkbox too, so re-saving it adds the
    client.
  - A save-to-list creates the client *before* the estimate save and links it immediately, so if
    the estimate save then fails, the retry reuses that record instead of making a second one
    (verified by failing the estimate POST).
  - The typeahead fails silently (closes the list); `api.js` already tells the banner.
  - ABN validation now lives in `js/util.js` (`abnDigits` / `abnValid` / `abnFormat`), shared by
    Invoice Settings, the Clients screen and the editor's client ABN.
  - **Gotcha, again**: the browser served a stale `js/util.js` on first load, same as the
    `calc.js` caching note above. If a new helper is `undefined`, refetch the scripts with
    `fetch(url, {cache: 'reload'})` before reloading.

- **The PDF export button** (2026-09-11) — back in the estimate detail header, wired to
  `POST /api/estimates/:id/pdf`, downloading via a blob URL. Full verification list in TASKS.md;
  the things to know:
  - **`LSCApi.postPdf(path)` is the binary path** — resolves `{ blob, filename }`. Only a *successful*
    PDF reply takes it; error replies are still JSON and classified exactly as before. The filename
    comes from `Content-Disposition` (`filename*` first), which the page can only read because the
    API now lists it in `Access-Control-Expose-Headers` — **if downloads start arriving named
    `CL-D.pdf` instead of the full name, that header has gone missing from `corsMiddleware`**.
  - **No `data-write` on Export, on purpose.** It never changes the record, so the banner doesn't
    block it; offline it stays clickable and explains itself inline.
  - **Failures are inline** (`#export-error` under the header), because the `abn_required` one needs
    a button next to it (Open Invoice Settings) and none of them should vanish with the toast.
  - **Fixed in passing — three server bugs, all harmless until export became a routine click:**
    1. **A non-Latin-1 character in a name made the export 500.** The route hand-built
       `Content-Disposition`; Node rejects such headers. `Nick’s Bakery` (a curly apostrophe) was
       enough. Now `res.attachment()`.
    2. **The filename header wasn't exposed cross-origin** (above).
    3. **Every export burned a backup.** `preWriteBackup` snapshots before every POST and keeps 10,
       so ten exports would have replaced every real recovery point with identical copies. The PDF
       route now mounts **before** `preWriteBackup` (still after `requireAuth`) in `app.js`. **Any
       future POST that doesn't write the database should mount there too.**

- **Login accounts — worth knowing before the next browser session.** On 2026-09-11 the user
  reported having no credentials for either database: every account so far was seeded by an agent.
  They re-seeded the **scratch** database themselves (username `Lachlan`) so the export could be
  verified. **The NAS account is still one they can't sign into** — they were given
  `cd /volume4/lsc-billing/app && docker compose exec billing npm run seed -- --username Lachlan --logout-all`
  to reset it in place (it prompts for the password; 12+ characters). An agent can't do either of
  these itself, or sign in through the login form, so browser verification needs the user to sign
  in first.

- **Session control** (2026-09-11) — **Sign Out** in the header, and unsaved input surviving an
  expired session. All in `web/js/app.js`; full verification list in TASKS.md. The things to know:
  - **A 401 no longer costs the screen.** `showLogin` only ever hid `#app-view`, so the half-typed
    form was still in the page; the next sign-in now un-hides it instead of re-mounting. Nothing is
    serialised. **Opt-in: call `onAuthLost({ keepScreen: true })` only when the screen is complete**
    — every write path, the export, opening an estimate. A load that 401s mid-draw must call it
    bare, or sign-in un-hides a "Loading…" that never finishes. **New screens need to make this
    choice at each `auth` branch.** It relies on every screen resetting its own pending state
    before calling `onAuthLost`, which all of them do; keep it that way.
  - **The Invoice Settings modal stays open across a 401** (hidden with `#app-view`). Its Escape
    handler ignores keys while hidden — without that, Escape on the login screen discarded it.
  - **Sign Out only claims success when the server confirms it.** The cookie is httpOnly, so a
    failed `POST /api/logout` leaves the user signed in, and the toast says exactly that. A real
    sign-out empties `#main` and clears `LSCData` (new `clear()`).
  - `onAuthLost` ignores repeat calls while the login screen is up — parallel 401s used to
    re-mount it and wipe what the user had typed.
  - **Header overflow below ~720px**, up from ~616px — no header breakpoint exists yet. Fits at 768px.
    Noted on the Mobile layout task, which owns the compact nav.
  - Not done, deliberately: warning before a Sign Out that would discard unsaved edits. Nav
    discards the same way today; it belongs with **Save state coverage**, which should cover
    Sign Out too.

- **Unsaved-edit warnings** (2026-09-12) — `web/js/unsaved.js`, plus guards at every exit in
  `js/app.js` and the four screens that hold edits. This is the **Save state coverage** task; the
  per-screen pending/success/failure states already existed, the cross-screen half did not. Full
  write-up in TASKS.md; the things to know:
  - **Native dialogs on both halves, at the user's direction**: `window.confirm` leaving a screen,
    `beforeunload` leaving the page. The browser fixes the text of the second one — nothing a page
    passes is displayed — so the specifics ("changes to the rate card") only ever appear in the
    `confirm`.
  - **Dirty is a snapshot comparison, not a touched flag.** Typing a character and deleting it
    again raises nothing. Screens compare against the state at mount, and **must re-snapshot after a
    successful save** or they stay "unsaved" until something replaces them.
  - **Watchers prune themselves.** Screens are replaced by writing over `#main` and there is no
    unmount hook, so a registration carries an `onScreen()` sentinel rather than an element
    reference — which is exactly what lets the rate card survive the re-render it does on every
    structural edit. Nothing needs releasing.
  - **A new screen with unsaved state needs two things**: an `LSCUnsaved.watch(...)` at mount, and a
    `confirmLeave()` at each of its own ways out. The header nav and Sign Out are already covered
    centrally, so a screen that forgets is still guarded against those.
  - **Found and fixed doing this — a write's outcome could paint over the screen that replaced it.**
    A pricing save landing after the user navigated away re-rendered the rate card **on top of the
    estimates list**, and a failure landing there threw a `TypeError` reaching for an error region
    that was gone. `pricing.js`, `estimate-editor.js` and `clients.js` now check `onScreen()` before
    their post-await UI work, while still clearing `saving` and still writing the reply into
    `LSCData` — the save happened, so the cache and the toast must say so; only the redraw is
    skipped. Pre-existing, reachable by anyone who clicks a nav item mid-save.
  - **Note for browser verification**: saves here take ~100ms normally but can take well over a
    second after a burst of writes (every mutating request takes a pre-write backup snapshot).
    Asserting on a fixed sleep gave a false "still unsaved" reading that looked exactly like a bug in
    this feature — wait on a condition, not a timer.

- **First-run setup states** (2026-09-12) — `web/js/views/estimate-list.js`, with `js/data.js`,
  `js/views/estimates.js`, `js/app.js`, `js/views/settings.js` and `css/estimates.css`. This is the
  **Empty and first-run states** task, and it completes the Interactions & States section. The two
  list empty states already existed; the first-run half did not. Full write-up in TASKS.md; what to
  know before touching it:
  - **A never-saved rate card is not an empty one.** `GET /api/pricing` falls back to a complete
    `DEFAULT_PRICING` — 3 categories, 18 services — so content cannot tell you whether anyone has
    configured it. The **row** is what's missing until the first write, and `updatedAt: null` is how
    the API says so. `LSCData` now keeps `updatedAt` from both endpoints (it was throwing them away)
    behind `pricingConfigured()` / `settingsConfigured()`. **If you add another "has this been set
    up" check, read `updatedAt` — don't inspect the data.**
  - **Decided with the user**: the prompt lives in the **estimates empty state**, not on the Pricing
    screen, and settings get a **first-run state only** — an export-time warning for an invoice with
    no payment details was explicitly declined. Don't add one without asking again.
  - **It is self-clearing and one-shot.** A satisfied step isn't rendered; with both done the plain
    "No estimates yet" state returns. The checklist only ever shows while the list is empty, so it
    cannot become furniture.
  - **`EstimateList.refreshFirstRun()` exists for the Invoice Settings modal**, exactly as
    `EstimateEditor.refreshTotals()` does. The modal saves over this screen without unmounting it, so
    without it the checklist kept listing the step the user had just completed. It redraws the block
    in place and **re-binds its buttons** — the DOM is replaced, so a new control added there needs
    the same treatment.
  - Neither setup button carries `data-write`: they navigate and write nothing.
  - Verified against a purpose-built never-configured database — the new **`api-firstrun`** launch
    config (`DATA_DIR=/tmp/lsc-billing-firstrun`), which is what you want for re-testing this rather
    than `api-scratch`, whose database is long since configured.
  - **Harness gotcha worth keeping**: real mouse clicks in the Browser pane did not reach the page at
    all — three different controls, correct coordinates, no handler and no console error — while
    dispatched `.click()` ran the same listeners every time. It cost most of a pass chasing product
    bugs that weren't there. Drive this UI with dispatched clicks, and poll on a DOM condition rather
    than a timer (the page-title check is a trap: `loadingMarkup()` renders the title synchronously,
    so polling on it measures the "Loading…" state).

- **Desktop preservation check** (2026-09-12) — the first item of **Responsive & Polish**, and the
  only change it produced is two scoped rules in `web/css/settings.css`. Full write-up in TASKS.md;
  what to know:
  - **There were no pre-port screenshots.** The task said to diff against them; none exist in the
    repo. Done instead as a live A/B — the old root `index.html` served next to `web/` and both
    driven screen by screen, measured with `getBoundingClientRect`/`getComputedStyle` rather than
    eyeballed. The old app runs fine in a plain browser (both its `electronAPI` calls are guarded),
    which is what makes this repeatable. **The tablet and mobile tasks should capture their
    baseline the same way** — there still isn't a stored one.
  - **The Preservation Law holds.** `app.css` is byte-identical to the old `<style>` block bar the
    two documented `-webkit-app-region` lines (189 lines each, 2 differ). No additive stylesheet
    collides with a base selector. Geometry matches screen by screen; **Pricing matches down to its
    total height** (926px). The one genuinely global additive rule is `.btn .spinner{flex-shrink:0}`,
    which can only reach markup the desktop app never had.
  - **🔴 It found a real bug, and not a cosmetic one: the Invoice Settings modal could not be saved
    on a normal laptop.** The modal grew from the desktop app's 391px to **864px** when GST and
    business joined payment, and the shared shell in `app.css` centres a box with no `max-height`
    and `overflow:visible`. At **1440×800** the title was clipped off the top and **Save and Cancel
    sat below the bottom edge with nothing scrollable to reach them** — openable and readable, but
    only escapable. The old modal fits at 1280×720, so this was **damage from the port**. Fixed
    additively and **scoped to `#modal-invoice-settings`** (`align-items:flex-start; overflow-y:auto;
    padding:24px 0`, plus `margin:auto` on the box, which keeps it centred whenever it fits) so the
    base shell stays untouched.
  - **The lesson worth carrying**: this modal had already been "verified … the ≥1100px layout
    numerically unchanged", and that was true — the pass measured **width** in a tall window.
    Nothing in this project's verification habit was checking viewport *height*, and the desktop
    band has a short edge too. Check both from here on.
  - **The shared modal shell still has no height strategy**, so any modal whose content grows will
    repeat this. The accessibility task already owns modals — a real `max-height`/scroll treatment
    on `.modal-overlay` belongs with the focus trap and would let the scoped override be deleted.
  - Also recorded, deliberately not reverted: **Client Email went from full-width to half-width in
    the editor**, a knock-on of the documented "show all six client fields" decision that nobody
    wrote down at the time. Every other shared field is at a byte-identical position.
  - Verified after the fix at 1280×720, 1440×800 and 1440×1000, then **saved through the modal and
    read the row back from the database** rather than trusting the toast — marker landed,
    `business.abn` / `gst.registered` / `paths` all intact. `npm test` 68/68.

- **The tablet band, 768–1099px** (2026-09-13) — `web/css/responsive.css`, a new file linked last
  from `web/index.html`, plus two small markup additions in the header. Full write-up in TASKS.md;
  what to know before touching it:
  - **It is a separate file, not an `@media` block appended to `app.css`**, which is what the task
    line asked for. `app.css` is byte-identical to the desktop `<style>` block and the preservation
    check depends on that, so the band is additive like every other screen's stylesheet. It loads
    last, so it wins ties on equal specificity.
  - **The band is `max-width: 1099px`, not the `992px` TASKS.md names** — 992 contradicts the
    768–1099 band that both TASKS.md and DESIGN_BRIEF.md state, and would have left 993–1099px on
    the desktop rules inside a sub-desktop viewport.
  - **There are two queries.** Nothing measurably breaks between ~900 and 1099px, so that half gets
    only a latent table guard. Both real breaks appear at ~860px and are fixed at 900 with margin.
    **If you add a tablet rule, put it in the half that needs it** rather than widening the 900 one.
  - 🔴 **`.summary-bar` was silently clipping a money figure below ~860px.** `1fr`'s minimum is
    `auto`, so a five-figure total forced every track to 153.6px — 692px of tracks in a 671px box —
    and the bar is `overflow:hidden`, so the Tax Set-Aside figure was **cut, not scrolled**. Fixed
    with `minmax(0,1fr)` + a 16px value + `overflow-wrap:anywhere` as the backstop; seven figures
    now fit on one line at 768px and eight wrap instead of vanishing.
    **The lesson is about the test data, not the CSS**: this never showed up because the scratch
    database tops out at **$560**, and no estimate in it is wide enough to force the track. It was
    found by substituting a realistic figure into the live DOM. **Do that for anything money-shaped
    from here on** — the fixtures are not representative of the real numbers.
  - **The header nav wrapped to two lines from ~865px, not the ~720px TASKS.md recorded**, so it was
    a tablet-band bug, not a mobile one. Fixed by taking space back (`nowrap`, 12px gap, 8px
    padding) rather than by collapsing the nav — **the compact nav is still the mobile task's**.
    The last 95px came from hiding the home button's label, which is safe because `#logo-btn` and
    `#nav-estimates` are both wired to `toEstimates` in `js/app.js`.
  - **`index.html` gained a `<span class="nav-label">` and an `aria-label` on `#logo-btn`** so the
    icon-only button keeps an accessible name. Both are inert at desktop (`#logo-btn` measures
    128.8px before and after). **Don't remove the `aria-label` when the mobile nav lands** — the
    SVG is `aria-hidden`, so it is the button's only name below 900px.
  - ⚠️ **The card grid was deliberately not forced to two columns**, against the letter of the task
    and the brief. `repeat(auto-fill,minmax(260px,1fr))` already measures 3 columns at 1099px and 2
    from ~860px down, so the brief's "two columns" is what the base rule delivers across most of the
    band. Forcing it would render two 493px cards at 1099px where 1100px renders three 324px ones.
    **Flagged rather than done quietly — it is a one-line change if the literal reading is wanted.**
  - **The editor tables' horizontal scroll is in but latent by design** — a 660px floor against a
    705px content width at 768px, so it never forces a scrollbar where the tables still fit. The
    floor is on `.bb-head`/`.bb-picker` too, so the title bar and picker scroll *with* the rows.
  - **Two harness traps, both of which cost a pass.** The browser served a **cached `index.html`**
    after the new `<link>` was added, so the first verification measured desktop values inside the
    band and looked exactly like a broken media query; `curl`ing the dev server proved the HTML was
    fine and `?cb=1` fixed it. `web/README.md` documents this cache trap for `js/calc.js` — **it
    applies to `index.html` too.** And **`@media` matched `innerWidth`, not the 15px-narrower client
    width** (1100px did not trigger `max-width:1099px`), so check band edges at the exact pixel.
  - Verified at 1400 / 1100 / 1099 / 901 / 900 / 860 / 768px across all five screens plus the modal
    and the connection banner, with zero horizontal page overflow at every width, and **preservation
    re-measured with the new file actually loaded** rather than assumed. `npm test` 68/68.

- **The mobile band, <768px** (2026-09-13) — the second half of `web/css/responsive.css`, plus a
  menu button in `web/index.html`, `bindCompactNav()` in `web/js/app.js`, two new classes in
  `web/css/estimates.css`, and `data-label` attributes on the table cells of
  `views/estimate-{editor,detail}.js`, `views/pricing.js` and `views/clients.js`. Full write-up in
  TASKS.md; what to know before touching it:
  - **The band is `max-width: 767px`**, not the 768 TASKS.md names — 768 is the tablet band's first
    pixel in both TASKS.md and the brief, same reasoning that made the band above 1099 and not 992.
  - 🔴 **The header was shrinking the whole app, not just overflowing.** `#hdr-right` needs 515px
    against ~236px of room at 375px, and a page wider than its layout viewport gets **zoomed out to
    fit** by the phone: `innerWidth` measured **625** against a `clientWidth` of 375. Every screen
    was rendering shrunken because of the header alone, which reads as "the text is small on my
    phone" rather than as a broken nav. `innerWidth` is 375 now.
  - **The compact nav is `#hdr-right` itself**, taken out of flow and parked under the header as a
    panel; `#nav-menu-btn` opens it. **There is deliberately no second set of nav markup** — the six
    buttons are the same elements with the same handlers at every width, so it can't drift from the
    desktop header and it inherits `js/app.js`'s unsaved-edit guards for free. Closed it is
    `display:none`, so its buttons leave the tab order with it. It closes on a nav choice, Escape
    (focus returns to the toggle), an outside click (capture phase), leaving the band, and landing
    on the login screen. `#logo-btn` is hidden *inside the panel* — it and `#nav-estimates` both
    call `toEstimates`, which is a duplicate row in a menu.
  - **Four tables stack, by one shared mechanism**: every cell carries a `data-label` matching its
    own column heading, the head row is hidden, and CSS prints the label beside the value.
    **A column added later needs a `data-label` or it loses its heading on a phone.** Per-cell
    rather than `nth-child`, because three editor sections share `.expense-grid` with different
    headings.
  - 🔴 **Two of those four were stacked because they were broken, not for consistency.** The
    read-only `.est-table` measured 381px inside a 341px `overflow:hidden` block with a realistic
    total in it, so the **Bill column was cut off rather than scrolled to** — the same shape as the
    tablet band's summary-bar bug, found the same way, and again invisible because the scratch
    database tops out at $560 and fits. And the rate card's service-name input was **90px at 375px
    and 45px at 320px** — narrowing every other column only got it to 112px. **Keep substituting a
    realistic figure into the live DOM for anything money-shaped; the fixtures do not reach the
    widths that break things.**
  - **Two inline styles in `estimate-editor.js` are now classes** (`.gt-row .del-cell`,
    `.summary-bar .sum-span2` in `css/estimates.css`), carrying exactly what the attribute carried.
    A style attribute can only be beaten with `!important`, which nothing could then beat in turn —
    and the single-column summary bar has to set `grid-column` back to `auto`, or a `span 2` builds
    an implicit second column and puts half the bar off the screen. **Prefer a class to an inline
    style in markup the responsive bands have to reach.**
  - **Touch targets went wider than the `.btn-xs` the task names** — that class is used once in the
    whole frontend. The controls actually too small were `.del-btn` (15.7 × 14px), `.btn-sm`, the
    client-history link (15px) and every form field (~36px); all are ≥44px in the band via
    `min-height`, checkboxes excluded. The row-delete moved to the row's top-right corner rather
    than taking a sixth stacked line.
  - ⚠️ **Single-column cards were built, measured and removed again** — the same decision the tablet
    task made about two columns. `repeat(auto-fill,minmax(260px,1fr))` already gives one column from
    ~534px down; forcing it would only change 534–767px, where it renders one 735px card at 767px
    against two 352px ones at 768px. **One line in `responsive.css` if the literal reading is
    wanted** — the answer is now on record for both bands.
  - Verified at 1400 / 1100 / 900 / 768 / 767 / 375 / 320px across every screen, the modal, the
    login screen, the banner and the first-run block, with zero horizontal overflow anywhere.
    Behaviour as well as layout: an estimate edited and saved from the 375px stacked editor was
    **read back from the server**, and so was a rate saved from the stacked rate card. Desktop
    preservation re-measured with every new file loaded — full figures in TASKS.md. `npm test` 68/68.
  - **The cache trap bit twice**, the second time looking exactly like the `data-label` attributes
    never being written (`::before` rendered `""`). `fetch(url, {cache:'reload'})` on each changed
    file before reloading is the fix, and it applies to the view scripts, not just `index.html` and
    `calc.js`.

- **The accessibility pass** (2026-09-14) — `web/css/a11y.css` (new, loaded last of all) plus a
  focus trap in `web/js/views/settings.js`. This closes out **Responsive & Polish**. Full write-up
  in TASKS.md; the things to know before touching it:
  - **`--muted`'s contrast fix lives in a `:root` override in `a11y.css`, not in `app.css`.** The
    base file's own header says not to edit rules in it, so the fix redeclares the custom property
    from a later stylesheet instead — same mechanism `responsive.css` already uses to override base
    rules additively. **If you ever need to change a base *token*'s value, override it from a later
    file rather than editing `app.css`** — this is now the second time that's been the answer.
  - **Focus rings are global now** (`.btn`, `.nav-link`, `.back-btn`, `.del-btn`, every input/select/
    textarea `app.css` strips `outline` from), matching the `outline: 2px solid var(--accent);
    outline-offset: 2px` ring a few screens had already added locally (login, the connection banner,
    the estimate card, the client-history link). `:focus-visible`, so a mouse click rings nothing.
  - **The modal focus trap is in `settings.js`, the only true dialog in the app.** The compact mobile
    nav is a disclosure panel, not a dialog — it already closes on Escape with focus return, and
    doesn't block interaction with the rest of the page, so it wasn't in scope. `focusable()` is
    recomputed on every Tab rather than cached, because toggling GST registration disables two
    fields while the modal is open; a stale list would let Tab land on a disabled input.
  - **`aria-live` was already done** before this task reached it — `role="status"` on the connection
    banner, `role="alert" aria-live="assertive"` on the login error — both from earlier work. Nothing
    to add.
  - **Left open, on purpose, and not a regression**: `.modal-overlay` in `app.css` still has no
    `max-height`/scroll strategy of its own; the scoped fix in `css/settings.css` for the one modal
    that needs it stays. Widening that into a real base treatment would mean editing `app.css`,
    which nothing in this task justified doing alone.
  - Verified in a browser against `api-scratch`: login screen tab order and ring; the header nav
    ring; the new-estimate editor's autofocused first field; the modal's Tab wrapping from the first
    field to Save and back (checked via `document.activeElement`, not just visually); Escape closing
    the modal and returning focus to whichever control opened it; and the ≥1100px layout unchanged
    (`#main` 1080px at `34px 40px`). `npm test` 68/68 (no server files touched).

**Not started**: nothing — **every task in TASKS.md is now checked off**, including Deployment
(closed 2026-09-14, see below). The remaining "Design review" item under Review is the only open
checklist line, and it's a standing task (`/design-review`) rather than build work.

- **Deployment** (2026-09-14) — `.gitignore` (new, repo's first — see below),
  `.github/workflows/deploy-pages.yml`, `.design/nas-hosted-billing/DEPLOYMENT.md` (new). Closes
  both remaining TASKS.md items. Full write-up in `DEPLOYMENT.md` and in TASKS.md's own Deployment
  section; the things to know before touching it:
  - **This repo had no `.git` at all until this session.** `git init` plus a root `.gitignore`
    came first — the app had been worked on entirely uncommitted up to this point.
    `server/data/`, `server/.env` and `web/js/config.js` are excluded for the same reason they were
    already gitignored/`.env.example`'d individually: real client data and the NAS's real hostname
    must never land in a repo that's about to go public for GitHub Pages.
  - **The Cloudflare Tunnel question is answered, not left open, per TASKS.md's own instruction.**
    Adds a public hostname to the user's existing `cloudflared-tunnel` (already serving Nextcloud
    and Supabase) rather than standing up a second tunnel — decided with the user 2026-09-14, one
    less container to run. Needs the billing container joined to whatever Docker network that
    tunnel is on (`docker network connect`, or declare it `external: true` in
    `server/docker-compose.yml` so it survives a recreate) and a Public Hostname added in the Zero
    Trust dashboard pointing at `lsc-billing:8080` — **not** `127.0.0.1:8080`, which is only
    reachable from inside the NAS itself. Both are steps only the user can take from here; nothing
    in this session could reach either.
  - **Tailscale vs. public reverse proxy, the brief's original open question, is now decided**:
    Cloudflare Tunnel. The reasoning is the security posture already on record in CLAUDE.md — the
    user judged the data not sensitive enough to require Tailscale-only access and accepted
    password-auth-on-a-public-port as a conscious risk. Gating the API behind Tailscale would
    reintroduce exactly the access friction that decision opted out of, for a security bar the user
    already declined.
  - **The GitHub Pages publish is an Actions workflow, chosen over a `gh-pages` branch** (user,
    2026-09-14) — `.github/workflows/deploy-pages.yml`, triggered on a push to `main` touching
    `web/`. It does two things beyond a plain static-file deploy, both because TASKS.md's Pages
    task named them as required, not optional:
    1. **Writes `web/js/config.js` from a repository secret** (`LSC_API_BASE`) on every run. The
       file is gitignored on purpose — it would otherwise hardcode the NAS's real hostname into a
       public repo — so it has never existed in git and is generated fresh each deploy instead of
       committed once.
    2. **Cache-busts every local script and stylesheet reference** by appending
       `?v=<short commit sha>` to each `<script src="js/...">` / `<link href="css/...">` in
       `index.html` during the build, via a `sed` step over the checked-out copy (verified locally
       against the real file before relying on it in CI — every nested `js/views/*.js` path
       matched, nothing else did). **This is the fix for a real bug, not cosmetic**: TASKS.md
       records a stale cached `js/calc.js` silently pricing the editor with an old money model
       while the server used a new one, found 2026-09-10 during local dev against
       `python3 -m http.server`. A GitHub Pages deploy can hit the same failure on any repeat
       visit if the URL never changes, so every deploy now gets a new URL for every local asset.
  - **The repo now exists**: [`LSCCreative/lsc-billing-app`](https://github.com/LSCCreative/lsc-billing-app),
    public (GitHub Pages needs that on the free plan), created and pushed this session — the app
    had no `.git` before this task. **Pages source was set to GitHub Actions** via
    `gh api -X POST repos/.../pages -f build_type=workflow` rather than the dashboard click, since
    the API allowed it directly.
  - **The tunnel wiring is done, on the real NAS, with the user's live-in-conversation approval**
    (the NAS also runs other people's Nextcloud/Supabase, so this asked first rather than acting
    unattended). `cloudflared-tunnel`'s network turned out to be `media_net`, not a network named
    after the tunnel — found by inspecting it over SSH rather than assumed.
    `server/docker-compose.yml` now declares `media_net` as `external: true` and attaches `billing`
    to it, so this survives any future `docker compose up -d`. Reachability was proven with a
    throwaway `curlimages/curl` container on `media_net`, because the official `cloudflared` image
    has no shell to `docker exec` into — worth remembering before reaching for `docker exec` on it
    again.
  - **The hostname is `billing.lsccreative.studio`** — added as a Published application route on
    the tunnel (dashboard name `deck-productions-nas`; the two existing routes were
    `media.lsccreative.studio` and `db.productiondecks.online`, so `lsccreative.studio` was picked
    to match the media one; user confirmed both the domain and the tunnel-reuse decision before
    either was touched).
  - **🔴 Found and fixed: `docker compose restart` does not reload `.env`.** After updating
    `CORS_ORIGINS`/`COOKIE_SAMESITE`/`COOKIE_SECURE` in the NAS's `.env` and restarting, the
    container kept answering `/health` correctly but sent **no `Access-Control-Allow-Origin`
    header at all** — because `restart` reuses the container's environment as baked in at
    *creation*, not what's currently in `.env`. In the browser this surfaced as the login
    screen's generic "could not reach the server" (a CORS-blocked `fetch` throws, and `api.js`
    classifies any throw as `network`), while `curl` against the identical URL looked completely
    healthy — the two tools were telling two different, both-true stories, and only the browser's
    network log surfaced the missing header. Fixed with `docker compose up -d`, which recreates
    the container from the current `.env`. Written up as its own 🔴 note in `DEPLOYMENT.md` so it
    isn't repeated next time an env var changes.
  - **The `LSC_API_BASE` secret is set** (`https://billing.lsccreative.studio`), and a manual
    workflow run confirmed a full green pipeline: checkout → config.js generated from the secret →
    cache-busting applied → Pages configured → artifact uploaded → deployed.
  - **Verified end to end, live, in a real browser** (not just `curl`): the deployed
    `https://lsccreative.github.io/lsc-billing-app/` renders the login screen with no error
    banner, the cross-origin `/api/session` preflight and request both carry the correct
    `Access-Control-Allow-Origin` header, `js/config.js` on the live site reads the real tunnel
    URL, and every script/stylesheet tag carries the deploying commit's `?v=` hash. **Not
    verified**: an actual sign-in and a save round-trip, since that needs real account
    credentials only the user has — see "Login accounts" below. Everything a login depends on
    (CORS, cookie flags, config generation, cache-busting) is already proven; signing in is the
    last confirmation, not a debugging step. `npm test` 68/68 — no `server/` or `web/` application
    code changed by this task, only `server/docker-compose.yml` (network) and the NAS's `.env`
    (CORS/cookie config).

~~**Open seam left by the estimates port**: the server has no column for `sectionLabels`.~~
**Closed** by the schema v2 snapshot above, decided with the user on 2026-09-09.

~~**Open seam left by the Pricing port**: leaving the Pricing screen with unsaved edits discards them
without warning.~~ **Closed** 2026-09-12 by the unsaved-edit warnings above, for all four screens at
once (and for Sign Out and page reload) rather than one-off on Pricing, as the seam asked.

The client snapshot shape on an estimate is `{businessName, contactName, email, phone, abn,
address}` — not the old flat `proj.businessName`/`proj.clientName`/`proj.clientEmail` fields from
the desktop app. Anything still porting from `index.html` needs the same translation.

## Resolved decisions (do not re-litigate)

Everything in DESIGN_BRIEF.md's "Resolved decisions"-equivalent content, plus, decided
2026-09-07 and documented in DESIGN_BRIEF.md's "Architecture update" section:

1. **Hosting split**: GitHub Pages (static frontend) + NAS (API + SQLite), not a single
   container serving both. This supersedes the brief's original Tailscale-vs-reverse-proxy
   framing — there's no UI to protect behind Tailscale anymore, only the API.
2. **Security posture is deliberately low**: the user judged the data (rates, client contacts,
   ABN, bank details) not sensitive enough to justify Tailscale-only access, and accepted
   password-auth-on-a-public-port as a conscious risk. Don't raise this as a concern again unless
   asked.
3. **`SameSite=None` still requires HTTPS** on the NAS API even in this low-security deployment —
   browsers won't send the cookie otherwise, security posture aside. A Cloudflare Tunnel is the
   low-effort way to get TLS without port-forwarding or cert management.
4. **GST-free estimates are in scope, per estimate** — decided with the user 2026-09-10. This
   **supersedes DESIGN_BRIEF.md's out-of-scope line** ("any change to the money model beyond what
   `BILLING_APP_PLAN.md` already specifies"), which the brief wrote before GST had any UI at all.
   The scope granted is a per-estimate flag and nothing wider: a **per-line-item** GST flag was
   considered and *not* chosen, so don't build one without asking again. The GST-inclusive pricing
   rule that came with it (a GST-free job bills the listed rate) is a decision, not arithmetic —
   it is written up above and in `calc.js`'s header, and should not be quietly re-derived.

## Verifying your work

`cd server && npm test` after any backend change (the frontend has no test suite; verify it in a
browser against a running API, per `web/README.md`) — it's fast (a few seconds, dominated by the one
real Chromium render in `test-pdf.js`) and it's the acceptance gate for this phase, same pattern
as the existing `test-auth.js`/`test-db.js`/`test-calc.js`/`test-backup.js`/`test-pdf.js`/
`test-ratecard.js`/`test-section-labels.js`. New routes should get a corresponding test in
`server/test/test-api.js` (follow its existing pattern: spin up the app on an ephemeral port, log in
once in `test.before`, reuse the cookie).

`npm test` also covers three things that are not routes: that `web/js/calc.js` still matches
`server/src/calc.js` (in `test-calc.js`), that an estimate saved before pricing is ever
configured still prices against the default rate card (`test-ratecard.js`), and that a renamed or
deleted labour category doesn't rewrite the headings on an already-sent document
(`test-section-labels.js`).

**A green suite is not the gate on its own.** Both bugs found in the Pricing port passed every test
in the suite: the repeat-save no-op was invisible to a test that saved once, and the PDF dropping
`sectionLabels` was invisible to tests that called `buildEstimateHtml` directly instead of going
through the route. When a change touches something a person *looks at* — a document, a saved
figure, a second attempt at the same action — go and look at it: re-export the PDF and read the
text, save twice and re-read from the server, not just from the screen that told you it worked.

For frontend work, use the **`api-scratch`** launch config rather than `api` — same server against
`DATA_DIR=/tmp/lsc-billing-scratch`, so creating and deleting estimates while testing doesn't touch
`server/data`. Seeding instructions are in `web/README.md`.
