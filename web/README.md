# web/ — the GitHub Pages frontend

The static site. It talks to the NAS API over CORS; it has no build step, no
bundler and no dependencies — plain HTML, CSS and scripts, served as-is.

## Layout

```
index.html               app shell: the login view and the app view
css/tokens.css           design tokens (ui-clarity): colour, type, spacing,
                         radii, motion, plus the legacy aliases. Loaded FIRST
css/app.css              base stylesheet. Began as the Electron app's; the
                         Desktop Preservation Law is retired (ui-clarity U16)
css/login.css            login screen, additive
css/connection.css       connection-lost banner, additive
css/estimates.css        estimate screens, additive
css/pricing.css          pricing screen, additive
css/settings.css         invoice settings modal, additive
css/clients.css          clients screen + typeahead dropdown, additive
css/finance.css          the Finance sub-tab row, additive
css/overhead.css         the Overhead screen: summary card, expense table,
                         Add/Edit modal and the charts, additive
css/goals.css            the Goals form, additive
css/responsive.css       the responsive bands (tablet 768-1099, mobile
                         <768). Every rule is inside a media query
css/a11y.css             accessibility pass: global focus-visible rings,
                         placeholders, field errors. Loaded LAST of all
fonts/*.woff2          Delight 400/700 (from the old app) + CS Felice Mono. Metro
                         Sans joins them once its web licence is confirmed
js/config.js             the API address and the Google Maps browser key + Map
                         ID. Gitignored — copy from config.example.js
js/api.js                the only place that calls fetch; classifies failures.
                         postPdf() is the one binary path (PDF export)
js/hnry.js               Hnry on the invoice screens (hnry-invoicing H6): an invoice's
                         Hnry state and words, Hnry's page, the push and Mark sent calls
js/calc.js               the money model. A byte-identical copy of
                         server/src/calc.js — see below
js/util.js               fmt / esc / today / num, and the ABN helpers
js/typeahead.js          client typeahead (combobox over /api/clients?q=)
js/rows.js               per-row and per-section figures, following calc.js
js/data.js               rate card, settings, overhead and goals, cached for
                         the session and preloaded together
js/toast.js              the corner toast
js/connection.js         the connection-lost banner; subscribes to api.js
js/modal.js              the shared modal focus trap (LSCModal.trapTab)
js/unsaved.js            unsaved-edit warnings — confirm() on the way out of a
                         screen, beforeunload on the way out of the page
js/views/login.js        the login screen
js/views/estimates.js    switches between the three estimate screens
js/views/estimate-list.js    the cards grid
js/views/estimate-detail.js  the read-only estimate
js/views/estimate-editor.js  the editor
js/views/clients.js      the client list, one client's record + estimate history
js/views/pricing.js      the Rate Card
js/views/finance.js      Finance: routes Pricing / Overhead / Goals into
                         #finance-sub. A router, not a screen
js/views/overhead.js     the Overhead screen (expense CRUD + summary card)
js/views/overhead-charts.js  the Overhead screen's hand-rolled inline SVG
                         charts. Markup in, markup out — holds no state
js/views/goals.js        the Goals form (income/margin/capacity + tax reserve)
js/views/settings.js     Settings, #/settings: business, GST, payment, estimates &
                         invoices, the service agreement (task 21)
js/documents.js          deposit / validity / due-days / message / agreement
                         defaults and the agreement's fill-in fields; a
                         byte-identical copy of server/src/documents.js
js/call-sheet.js         the call sheet's markup (app, public page, PDF); a
                         byte-identical copy of server/src/call-sheet.js
js/app.js                boot + top-level view switching
```

## js/calc.js is a copy, not a fork

`web/js/calc.js` is `server/src/calc.js`, byte for byte. The editor computes
its live totals with the same code the server uses to compute the ones it
stores, so the two cannot disagree — two implementations of GST and the tax
set-aside would drift, and the estimate on screen would stop matching the
estimate in the database.

It is a copy rather than a build step because this directory is deliberately
dependency-free and ships to GitHub Pages as-is. **If you edit the money model,
re-copy it:**

```bash
cp server/src/calc.js web/js/calc.js
```

`server/test/test-calc.js` fails if the two files differ, so `npm test` catches
a stale copy **on disk**. It cannot catch a stale copy in a *browser*: a cached
`js/calc.js` will happily price the editor with an older money model than the
server is using, which is the same disagreement the copy exists to prevent. It
happened during development against `python3 -m http.server`, across a full
reload. **`index.html` and the view scripts cache the same way** — a newly added
`<link>` or `<script>` can be missing from the page while `curl`ing the dev
server shows it present, and a stale `js/views/*.js` shows up as markup the file
on disk clearly writes simply not being there. `fetch(url, {cache: 'reload'})`
on each changed file, then reload.

If live totals ever look impossible, check what the page is actually
running — `LSCCalc.computeTotals.length` is 4 as of the GST-free change — and see
the cache-busting note on the GitHub Pages task in TASKS.md.

`computeTotals(activeRows, pricing, settings, options)` — the fourth argument
carries the estimate's own tax treatment (`{ gstFree }`), which is why the editor
passes it on every recalc rather than relying on settings alone.

Only `calc.js` produces headline figures. `js/rows.js` produces the per-row and
per-section numbers underneath them, and follows calc.js's lookup rule (a
service no longer on the rate card is priced at nothing, and renders as “—”)
so the rows always add up to the total beneath them.

## First-time setup

```bash
cp js/config.example.js js/config.js
```

Then fill in its three values. `js/config.js` is gitignored so none of them reach the public
repo; on Pages, `deploy-pages.yml` writes it from repository secrets of the same names.

| Key | What | Empty |
| --- | --- | --- |
| `LSC_API_BASE` | the API's address, no trailing slash (`http://localhost:8080` locally) | required |
| `LSC_MAPS_KEY` | the **LSC Billing — browser** Google key (trip planner, Places search) | the travel view says Google Maps isn't set up |
| `LSC_MAPS_ID` | the Map ID **LSC Billing — trip planner** (numbered pins) | the map draws, its pins don't |

The two Google values are in `.credentials.local.md`. The browser key only works from
`https://app.lsccreative.studio/*` and `http://localhost:5173/*`, so preview the frontend on port
5173 (the `web` launch config does).

## Running it locally

Two servers, because the split is the whole point — the frontend and the API
are different origins in production, so they should be different origins in
development too. In Claude Code, `preview_start` the `api` and `web` configs
from `.claude/launch.json`. By hand:

```bash
cd server && CORS_ORIGINS=http://localhost:5173 COOKIE_SAMESITE=none COOKIE_SECURE=1 npm start
```

```bash
python3 -m http.server 5173 --directory web
```

Then open http://localhost:5173.

The three env vars matter and are not in `server/.env` by default:

- `CORS_ORIGINS` must contain the frontend's origin, or every call is blocked.
- `COOKIE_SAMESITE=none` is required for the session cookie to survive a
  cross-origin fetch.
- `COOKIE_SECURE=1` is required *by* `SameSite=None` — browsers reject the
  combination otherwise. It works over plain HTTP here only because Chrome
  treats `localhost` as a secure context. **In production the API must be real
  HTTPS** (Cloudflare Tunnel); there is no local-style exemption.

You need a seeded account: `cd server && ADMIN_PASSWORD=<12+ chars> npm run seed`.

There is also an **`api-scratch`** launch config, identical to `api` but with
`DATA_DIR=/tmp/lsc-billing-scratch`. Use it to exercise the UI — creating,
editing and deleting estimates — without writing to `server/data`. Seed it once:

```bash
cd server && DATA_DIR=/tmp/lsc-billing-scratch ADMIN_USERNAME=dev ADMIN_PASSWORD=scratch-dev-password npm run seed
```

## Conventions

- `js/api.js` is the only module that calls `fetch`. Everything goes through it
  so failures are classified consistently (`network` / `auth` / `throttled` /
  `client` / `server`) — the difference between "the NAS is down" and "your
  session expired" drives two completely different UI responses.
- Views are IIFEs exposing a single global (`LoginView`), mounted by `js/app.js`.
  No modules, so no CORS/MIME complications when serving from a file host.
- Scripts load in dependency order at the end of `<body>`; `config.js` first.
- **The rate card in `LSCData` is a cache, and only a successful save replaces
  it.** The Pricing screen edits a deep clone and calls `LSCData.setPricing()`
  with what the server echoed back. The estimate editor computes its live
  totals from that cache, so an abandoned or failed edit must never reach it.
- **A category label can have two right answers, and `LSCRows.sectionsFor` takes
  an `asDocument` flag to pick one.** An estimate records what its categories
  were called when it was saved. Screens that show the *document* — the detail
  view, and the PDF on the server — use that record, so a renamed or deleted
  category never rewrites a quote already sent. The editor uses the live rate
  card instead, because its picker offers the live category's services and
  saving re-snapshots the live name.
- **A screen that writes only part of `/api/settings` must merge, not replace.**
  `PUT /api/settings` writes the request body over the whole settings row, so a
  screen that PUTs just the keys it shows silently deletes the ones it doesn't.
  The Settings screen (`js/views/settings.js`) reads fresh on open and
  merges onto that, rather than onto `LSCData.settings()`, because the cache is a
  boot-time snapshot and a merge is only as good as what it merges onto. This
  matters most for `gst`, which `calc.js` reads on every estimate: losing it
  changes the money without going near a screen that mentions money.
- **Responsive rules for the older screens live in `css/responsive.css`.** It was written while
  `app.css` was frozen (the Desktop Preservation Law, retired by ui-clarity U16), so its bands are
  additive: linked late, it wins ties on equal specificity, and every rule in it sits inside a
  media query. New CSS is mobile-first in its own file, from `tokens.css` names. Both bands are built: tablet 768–1099px, mobile <768px. The one
  `min-width` rule hides `#nav-menu-btn`, which is markup no desktop layout has. Three things
  learned building them: `@media` matched `innerWidth` rather than the 15px-narrower client width
  when the window was resized (and `clientWidth` under mobile emulation), so check a band's edges
  at the exact pixel; a `1fr` grid track cannot shrink below its content's min-content width, which
  is how `.summary-bar` came to clip a money figure; and **a page wider than its layout viewport is
  not just scrolled sideways on a phone, it is zoomed out** — the overflowing header was shrinking
  every screen in the app until the compact nav landed.
- **A table that stacks on a phone needs `data-label` on every cell.** Below 768px the editor's
  line-item grids, the read-only estimate's tables, the client history and the rate card all stop
  being tables: `css/responsive.css` hides the head row and prints each cell's `data-label` beside
  its value. The attribute has to match that cell's own heading, and it has to be per cell rather
  than generated from `nth-child`, because three editor sections share `.expense-grid` with
  different headings. **Add a column without one and it loses its heading on a phone** — where the
  alternative was worse: two of these tables were stacked because they were *cutting a money figure
  off* at phone widths, not for tidiness.
- **Prefer a class to an inline `style` in markup the responsive bands have to reach.** A
  declaration in a style attribute can only be overridden with `!important`, which nothing can then
  override in turn. Two in the estimate editor became classes in `css/estimates.css` for exactly
  this (`.gt-row .del-cell`, `.summary-bar .sum-span2`); the single-column mobile summary bar has to
  set `grid-column` back to `auto`, or a `span 2` builds an implicit second column and pushes half
  the bar off the screen.
- **The compact nav below 768px is `#hdr-right` itself**, taken out of flow and opened by
  `#nav-menu-btn` (`bindCompactNav` in `js/app.js`). There is no second copy of the nav markup on
  purpose: the buttons are the same elements with the same handlers at every width, so the menu
  can't drift from the header and it inherits the unsaved-edit guards. **A nav item added to
  `#hdr-right` is in the mobile menu automatically** — including its close-on-choice behaviour,
  which is delegated rather than wired per button.
- **Test money layouts with a realistic figure, not the fixtures.** The scratch database tops out
  at **$560**, so nothing in it is wide enough to overflow a column. The summary-bar clipping bug
  was invisible until a five-figure total was substituted into the live DOM and the bar
  re-measured. Anything that displays a currency amount deserves the same treatment — the mobile
  band then found the *same* bug a second time, in the read-only estimate's table, where the
  client's own bill was being cut off rather than scrolled to.
- **At every `auth` failure, decide whether the screen is worth coming back
  to.** `onAuthLost({ keepScreen: true })` means "this screen is complete" —
  the login screen only hides the app, and the next sign-in un-hides it as it
  was, unsaved input included. Pass it from write paths and anything else that
  fails *after* the screen has drawn. Call it bare from a load that fails
  mid-draw, or sign-in will un-hide a "Loading…" that never finishes. Either
  way, reset your own pending state (spinner, `disabled`) first — what comes
  back must be a live form.
- **Mark every control that writes to the API with `data-write`.** While the
  server is unreachable, `js/connection.js` blocks activation of anything
  carrying that attribute and dims it, so no screen has to implement its own
  "don't let them save right now" logic. It works by delegation, so markup
  rendered after the banner appears is covered too. A control that only reads
  (a nav link, a filter, the banner's own Try Again) must *not* carry it.
- **A screen that holds unsaved edits registers with `LSCUnsaved`.** It passes a
  `label`, an `onScreen()` sentinel and a `dirty()` check (a snapshot compared
  against the last saved state, not a "they typed something" flag), and the
  registration is dropped automatically once its screen leaves the page — so
  there is nothing to release. Every route *out* of such a screen then asks
  `LSCUnsaved.confirmLeave()` first and does nothing if it returns false: the
  header nav and Sign Out in `js/app.js`, and the screen's own Cancel / Back /
  Escape. A reload or tab close is covered once, centrally, by `beforeunload`.
  Re-snapshot the baseline after a successful save, or the screen stays
  "unsaved" until it is replaced.
- **A write's outcome must not touch a screen the user has left.** A save is
  async and the nav doesn't wait for it, so success and failure can both land
  after the screen has been replaced — and re-rendering there paints over
  whatever is now on `#main` (this happened: a pricing save landing after a
  nav put the whole rate card back on top of the estimates list). Each of
  these screens keeps an `onScreen()` check and returns early from the
  post-await UI work; module state like a `saving` flag is still cleared
  first, because that has to be right whether or not the controls still exist.
