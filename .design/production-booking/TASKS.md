# Build Tasks: Production Booking

Generated from: [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md), [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md)
and [`DECISIONS.md`](DECISIONS.md) (D1–D99, all the user's; don't re-ask; D67–D72 came from the 2026-10-02 money review, D73–D99 are Stage B2).
Date: 2 October 2026

Stages are built in order, **A+B → B2 → C → D → E** (D1, D73), and each one ships and is usable on its own.
Every task carries a model/effort tag from root `CLAUDE.md`'s buckets:

- **(money math — Opus/high)**: `calc.js`, a stored or printed price, invoice amounts, or anything
  that renders a computed price. Applies "regardless of how small the diff looks".
- **(auth/security — Opus/high)**: public routes, tokens, signing, the Stripe webhook, secrets.
- **(frontend — Opus/high)**: UI build with no money figure of its own.
- **(backend — Sonnet/high)**: routes, tests and infrastructure that move no price.
- **(deploy — Sonnet/medium)**: infra steps.

State the bucket out loud and pause for the user to switch before starting a task.

_Finished tasks are summarised to their title, commit and files. The full specs, Done notes, mutation lists and verification logs are in git history (`git log -p -- .design/production-booking/TASKS.md`); the code and tests are the source of truth._

## Ground rules for every task

- **Prerequisite: estimate-accuracy lands first.** That branch holds uncommitted work through
  migration v10 and `PRICING_SHAPE` `'travel-km'`. This track starts at **v11**, so branch
  `production-booking` from `estimate-accuracy` once that work is committed. Deploy v10 before v11.
  Pushing `main` deploys Pages.
- **`calc.js` is two byte-identical copies** (`server/src/calc.js`, `web/js/calc.js`). The drift test
  fails otherwise.
- **The gate is `cd server && npm test`.** New pure functions get worked-example tests in
  `test-calc.js`, routes get tests in `test-api.js`, and migrations get tests in `test-db.js`.
- **Money math: check the mutation, not just the green suite.** Break the line, confirm a test
  fails, put it back, and list the mutations in the task's Done note.
- **Saved estimates never move.** Every new line or estimate field is optional, null-safe on read,
  and absent from rows already saved. An absent field must total identically to before; pin that
  with a test.
- **A new field must reach every place it belongs:** `computeTotals`, the editor's row builder and
  `collect()`, the estimate detail, the PDF and, from stage E, the public serializer. Missing one of
  those is the bug class this repo keeps catching.
- **Nothing owner-only on a public route.** From task 24 on, a test asserts that no `/public/*`
  payload contains `surcharge`, `floor`, `taxSetAside`, `overheadShare`, `estTakeHome` or
  `costBreakdown`.
- **Schema changes are additive and null-safe. NAS before Pages** for every migration or new route
  the web reads.
- **The Desktop Preservation Law applies**: above 1100px, existing screens stay pixel-identical except
  for the new blocks and states.
- **Verify anything a person looks at in the browser**, against `api-scratch` (login `dev`; re-seed if
  `/tmp` was wiped; restart it after server edits; cache-bust the web JS). Real clicks don't always
  land in the pane, so use dispatched `.click()` and poll on a DOM condition. Measure at 1280, 800
  and 375.
- **Each finished task gets a Done note in this file**, and `HANDOVER.md` is updated.

---

## Stage A + B — Surcharges and Production Booking (migration v11; ship together)

- [x] **1. The surcharge maths** (money math — Opus/high): pure functions in both `calc.js` copies.
  This is the riskiest arithmetic, so it goes first and has no UI.

  **Done 2026-10-02** on branch `production-booking`, committed `86edf25`. Seven exports in both
  copies: `SURCHARGE_DEFAULTS`, `surchargeSettings(card)`, `dayKind`, `afterHoursShare`,
  `surchargeFactor(day, card, shortNotice, holidays?)`, `surchargedLinePrice`,
  `surchargeAttribution(base, day, card, shortNotice, holidays?)`. There are 18 new tests in
  `test-calc.js`; the suite is 308/308.

- [x] **2. Schema v11, days and holidays on the server** (money math — Opus/high, since the server
  re-prices). _Depends on: 1._

  **Done 2026-10-02** on `production-booking` (committed `a571c67`). The suite is 327/327. New files are
  `days.js` and `routes/calendar.js`; `estimate.js`, `routes/pricing.js` and `app.js` also changed.
  `ratecard.js` needed nothing.

- [x] **3. Public holidays: fetch and edit** (backend — Sonnet/high). _Depends on: 2._

  **Done 2026-10-02** on `production-booking`, committed `a7c1dc7`. The suite is
  348/348, with 20 new tests in `test-holidays.js` and one in `test-db.js`. New files are
  `holidays.js` and `routes/holidays.js`; `app.js`, `index.js` and `db.js` also changed.

- [x] **4. Rate Card: Surcharges, Public holidays, Additional work** (frontend — Opus/high).
  _Depends on: 2, 3._

  **Done 2026-10-02** on `production-booking` (committed `da2db86`). The suite is 349/349, with one new
  test in `test-ratecard.js`. `pricing.js`, `pricing.css`, `server/src/defaults.js` and
  `test-ratecard.js` changed. `rows.js` needed nothing: a new section id never collides with
  `newSectionId`'s `catN`.

- [x] **5. The month calendar component** (frontend — Opus/high). _New shared component_
  (`web/js/calendar.js`, `web/css/calendar.css`), built for the editor first and reused by Home in
  task 12.

  **Done 2026-10-02** on `production-booking` (committed `cbe5f07`). New `web/js/calendar.js` and
  `web/css/calendar.css`, both added to `index.html` (the CSS before `responsive.css`, the JS after
  `info.js`). Nothing mounts the calendar yet; task 6 is its first caller. The suite is unchanged
  at 349/349: there is no server change and no harness for web modules.

- [x] **6. Editor: the Production Booking block and day cards** (frontend — Opus/high).
  _Depends on: 2, 5._

  **Done 2026-10-02** on `production-booking` (committed `685ebbb`). The suite is unchanged at 349/349:
  no server change. New: `web/js/views/booking-block.js` and `web/css/booking.css`. Changed:
  `estimate-editor.js` (a slot, `days` in `payload()`, the lock check before save, the 409),
  `api.js` (a refusal now carries its whole reply as `err.data`), and `index.html` (the script,
  the stylesheet and a `#modal-add-day` overlay).

- [x] **7. Editor: production items live on days, priced with surcharges** (money math —
  Opus/high). _Depends on: 1, 6._

  **Done 2026-10-02** on `production-booking` (committed `5261323`). The suite is unchanged at 349/349:
  there's no server change, and both `calc.js` copies are untouched. Changed:
  `estimate-editor.js`, `booking-block.js` and `booking.css`.

- [x] **8. Estimate detail, client PDF and Cost Breakdown PDF** (money math — Opus/high).
  _Depends on: 7._

  **Done 2026-10-02** on `production-booking`, committed `0d82f73`. The suite is 366/366: 8 new tests in
  `test-calc.js` and 9 in `test-pdf.js` (one renders through real Chromium). Changed: both
  `calc.js` copies, `pdf.js`, `routes/pdf.js`, `estimate-detail.js`, `rows.js`,
  `estimate-editor.js` and `booking.css`.

- [x] **9. A+B responsive and accessibility pass** (frontend — Opus/high). Breakpoints 1280, 800
  and 375.

  **Done 2026-10-02** on `production-booking` (uncommitted). The suite is unchanged at 366/366: no
  server change. Changed: `estimate-editor.js` and `booking.css`. Most of the list was already
  built in tasks 4–8. This pass measured all of it, and built the two things that were missing.

- [x] **9a. Money review fixes** (money math — Opus/high). 2026-10-02, after a code and accounting
  review of the whole finance → billing pipeline (ten findings). The user decided D67–D72 for the
  ones that changed a rule. **Done 2026-10-02, uncommitted.** The suite is 377/377.

- [x] **10. Deploy A+B** (deploy — Sonnet/medium). **Deployed 2026-10-02 with the user's go-ahead** (see the Done note below).

  - **Done 2026-10-02.** Backup (`sqlite3 ".backup"`, integrity ok, schema v9) to
    `/volume4/lsc-billing/data/backups/pre-v11-20261002-1558.db`. `server/` tar-copied over the
    `lsc-nas` key alias, excluding `node_modules`, `data`, `.env` and `docker-compose.yml` (the last
    two md5-identical after, volume still `/volume4/lsc-billing/data:/data`). `docker compose up -d
    --build`: `healthy`, 0 restarts, boot log `migrated to v10` then `migrated to v11`, then
    `[holidays] fetched, 22 new date(s)`; live DB at v11. **No `moved 1 Overtime row(s)` line:** the live
    card has no Overtime row, so the migration had nothing to move. Container carries
    `production-days`; `/health` 200 and `/api/calendar`, `/api/holidays`, `/api/estimates` 401 signed out.

## Stage B2 — Day-built estimates and the post-production planner (migration v12; built before C)

Added 2026-10-03 from the brief's "Stage B2" section and the IA's "Stage B2 addendum" (D73–D99).
Task ids are **B2-1 … B2-13**, so tasks 11–33 keep their numbers. Build them in order. B2 ships
on its own (B2-13) before task 11 starts. The ground rules above apply. In particular: **a new field
must reach every place it belongs.** B2's new fields (`dayId` on travel/crew/equip, equipment
`item`, prod `capture`, the deliverable's `id`/`typeId`/`typeName`/`multiplier`, the post line's
`deliverableId`, `rentals`) must each reach:

- the editor's row builder and `collect()`;
- `payload()`;
- the server's write checks;
- the duplicate route;
- the estimate detail;
- the PDF;
- from Stage E, the public serializer.

- [x] **B2-1. `postPlan` and the card shape** (money math — Opus/high). _Pure functions in both
  `calc.js` copies._ **Done 2026-10-03, committed `33af089`.**

  **Done note (2026-10-03).** `npm test` 387/387 (was 377), and the drift test passes.

- [x] **B2-2. Schema v12, rentals, and the server's line rules** (money math — Opus/high, because
  it governs which lines can carry a day). _Depends on: B2-1._ **Done 2026-10-03, committed `26e4e75`.**

  **Done note (2026-10-03).** `npm test` 396/396 (was 387). `calc.js` copies identical.

- [x] **B2-3. Deliverables block: moved, restyled, typed; the Prices bar moved** (frontend —
  Opus/high). _Depends on: B2-1._ This is the first visible B2 slice, to confirm the look early.
  **Done 2026-10-03, committed `51b3a80`.**

  **Done 2026-10-03, committed `51b3a80`.**

- [x] **B2-4. The service menu, and every on-set kind on a day** (money math — Opus/high, because
  production lines price live). _Depends on: B2-2._ This is the riskiest slice.
  **Done 2026-10-03, committed `c6f7457`.**

  **Done 2026-10-03, committed `c6f7457`.**

- [x] **B2-5. Moving lines: drag, Move to, Duplicate day** (money math — Opus/high, because a move
  re-prices). _Depends on: B2-4._ **Done 2026-10-03, committed `333c897`.**

  **Done note (2026-10-03).** Changed `estimate-editor.js`, `booking-block.js` and `booking.css`.
  No server change; 396/396.

- [x] **B2-6. "On set, by day": the four read-only summaries, and the editor order** (money math —
  Opus/high, because it renders day totals). _Depends on: B2-4._ **Done 2026-10-03, committed `77aebbb`.**

  **Done note (2026-10-03).** Changed `estimate-editor.js` and `booking.css`. No server change;
  396/396. **B2-4 and B2-5 are now deployable** (with B2-13's deploy).

- [x] **B2-7. Gear rentals** (frontend — Opus/high). _Depends on: B2-4._ **Done 2026-10-03, committed `d9071b7`.**

  **Done note (2026-10-03).** Changed `estimate-editor.js`, `estimate-detail.js`,
  `booking-block.js`, `typeahead.js` and `booking.css`. No server change; 396/396.

- [x] **B2-8. Rental bars on the calendar** (frontend — Opus/high). _Depends on: B2-2, B2-7. A
  change to the shared `web/js/calendar.js`._

  **Done 2026-10-03, uncommitted.**

- [x] **B2-9. Rate Card: the Capture tick and Deliverable Types** (frontend — Opus/high).
  _Depends on: B2-1._ **Done 2026-10-03, uncommitted** (B2-8 is also still uncommitted).

  **Done note (2026-10-03).** Only `web/js/views/pricing.js` and `web/css/pricing.css` changed;
  no server change (396/396).

- [x] **B2-10. The post-production planner in the editor** (money math — Opus/high). _Depends on:
  B2-1, B2-3, B2-9._ **Done 2026-10-03, uncommitted** (with B2-8 and B2-9).

  **Done note (2026-10-03).** Changed `estimate-editor.js`, `estimate-detail.js` and
  `estimates.css`; no server change and `calc.js` untouched (396/396).

- [x] **B2-11. The surcharge box and the Totals row** (money math — Opus/high). _Independent of
  B2-4 to B2-10; can be built any time after B2-2._ **Done 2026-10-03, committed `9d1f30f`.**

  **Done note (2026-10-03).** Changed both `calc.js` copies, `test-calc.js`,
  `estimate-editor.js` and `estimates.css` (401/401; the copies are identical).

- [x] **B2-12. B2 responsive and accessibility pass** (frontend — Opus/high). Breakpoints 1280,
  800, 375. _Depends on: B2-3 to B2-11._ **Done 2026-10-03, uncommitted.**

  **Done note (2026-10-03).** Changed `estimate-editor.js`, `booking-block.js`, `pricing.js`,
  `booking.css` and `responsive.css`. No server change (401/401; the `calc.js` copies are
  identical). Measured headless against `api-scratch` with puppeteer: dispatched events, real
  mouse input for the drags, and one real Tab before the focus-ring sweep.

- [x] **B2-13. Deploy B2** (deploy — Sonnet/medium). **Deployed 2026-10-03** (backup `pre-v12-20261003-1346.db`, integrity ok; `server/` tar-copied excluding `node_modules`, `data`, `.env`, `docker-compose.yml`, the last two md5-identical after; boot log `[db] migrated to v12 — gear rentals`, `healthy`; container carries `deliverable-types`, `rentals` table present, `/api/calendar` 401 signed out and its route reads `rentals`; Pages run 37094465617 success, `main` at `930249c`, live `index.html` carries `calendar.js?v=930249c5`). **Ask first.** NAS before Pages:
  1. back up;
  2. NAS v12 (check the boot log);
  3. check that `/api/calendar` returns `rentals`;
  4. Pages.

## Stage C — Home: the production calendar (no migration)

- [x] **11. Hash router** (frontend — Opus/high). _New `web/js/router.js`._ The foundation for C
  and everything after it (D59). **Done 2026-10-03, uncommitted** (see the Done note below).

  **Done note (2026-10-03).** Changed `router.js` (new), `app.js`, `index.html` (one `<script>`),
  `views/estimates.js`, `views/clients.js`, `views/finance.js`, `views/estimate-list.js` and
  `views/estimate-editor.js`. No server change (401/401).

- [x] **12. Home screen** (frontend — Opus/high). _Depends on: 5, 11._ `#/home` becomes the landing
  route and the logo goes there (D27). **Done 2026-10-03, uncommitted** (see the Done note below).

  **Done note (2026-10-03).** New `web/js/views/home.js` (the screen), `web/js/views/home-week.js`
  (the week view) and `web/css/home.css`. Changed `app.js` (`LANDING` is `'/home'`, a `home`
  branch in `renderRoute()`, `HomeView.init`, and `setNav('home')` lights the logo),
  `index.html` (two scripts, the stylesheet, `#modal-home-day`), `calendar.js` (exports only:
  `weekday`, `normRental`, `rentalRole`, `rentalDates`) and one stale comment in
  `estimate-list.js`. No server change (401/401).

- [x] **13. C polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium).
  **Deployed 2026-10-03, Pages only:** `main` fast-forwarded to `7910c53` (tasks 11 and 12),
  Pages run 37099081882 success, and the live `index.html` carries `js/views/home.js?v=7910c530`,
  `router.js` and `#modal-home-day`, with `LANDING = '/home'` in the live `app.js`. No NAS step:
  no server change, and the NAS was already at v12. **The user chose to skip the VoiceOver pass**
  on Home; the keyboard and focus checks in task 12's Done note are all that was done. (Task 13's
  responsive checks were covered by task 12's at 1280 / 800 / 375.)

## Stage D — Projects and invoices (migration v13)

- [x] **14. Invoice maths** (money math — Opus/high). **Done 2026-10-03, uncommitted.**

  **Done note (2026-10-03).** In both `calc.js` copies: `depositAmount`, `extrasTotals`,
  `finalInvoiceTotals`, `singleInvoiceTotals`, and `WON_STATUSES` gains `accepted`. Worked examples
  in `test-calc.js` (409/409). Decisions taken in the code:
  - `pct` is a PERCENT (50 = 50%). Blank, negative or unreadable means no deposit; above 100 is
    capped at 100.
  - Sums run in whole cents. Each block's ex-GST is total − GST. The deposit's GST is
    `round(estimate GST × deposit ÷ estimate total)`, split on the rounded deposit, not on the
    percent (pinned: 30% of $1,000.41 is $300.12, with $27.28 GST).
  - `snapshot` is the estimate's stored totals, never repriced. `extras` is
    `extrasTotals(rows, pricing, settings, gstFree)`: computeTotals with no days (never surcharged,
    D14), and GST-free if the estimate was.
  - Final and single return the same shape: `{ job, extras, total, deposit, balance, balanceDue }`,
    each block in computeTotals' three figures. `deposit` is null on a single invoice.
  - Mutations caught: pct ×100 and ÷10000; deposit not subtracted; extras skipped; GST split floored;
    GST split on the percent; ex-GST rounded on its own; the 100 cap and the negative guard removed;
    extras ignoring gstFree; `accepted`, then `approved`, dropped from the won set; the final ignoring
    its deposit; a single subtracting one.

- [ ] **15. Schema v13: projects, statuses, invoices, activity** (money math — Opus/high).
  _Depends on: 14._
  - **`projects`** (IA Data Model). One per distinct non-blank UPID; shared or blank UPIDs become
    projects with `upid` NULL and `needs_upid` (D61). Also `estimates.project_id`.
  - **An `estimates` rebuild** for the status CHECK: draft / sent / accepted / declined.
    `approved` maps to accepted; `invoiced` and `paid` map to accepted plus a **legacy invoice**.
  - **`invoices`, `activity`.** Rows with `doc_type = 'invoice'` yield a `legacy` invoice carrying
    their number (D62).
  - **The estimate write routes** keep `estimates.upid` in sync with the project, and refuse a
    UPID already used by another project (`upid_taken`).

  **Done when** migration tests on fixtures cover: unique UPIDs; two sharing one; a blank one; an
  `invoice`-typed row; and an `approved` row, each landing as specified. Every existing estimate's
  totals are byte-identical after the migration, and a re-run is a no-op.

- [ ] **16. The UPID fix-up screen and Duplicate** (frontend — Opus/high).
  _Depends on: 11, 15._
  - **`#/setup/upids`** lists groups (estimates with name, date and total). Per estimate, the user
    types a new UPID; per group, they can choose "Keep together". It uses `GET/POST
    /api/setup/upids`.
  - **A banner on the list** while any are left, which disappears with the route when none remain
    (D61).
  - **Duplicate creates a new draft with no UPID** (focused) and no days, and refuses to save until
    the UPID is unique (D60).

  **Done when** it's verified against a scratch DB seeded with a duplicate pair and a blank UPID.

- [ ] **17. The Projects list** (frontend — Opus/high). _Depends on: 15._
  - The nav item and route become **Projects** (`#/projects`), and the list shows **one card per
    project** (D58).
  - **A stage line** from one shared function, for example "Sent v2 · valid until 14 Oct" or
    "Deposit paid · final not sent". Before stage E, "Sent" is set by the owner (task 18).
  - **Search and stage chips**, with `?stage=` and `?q=` in the hash, and "Show more" after 50.
  - **The Clients screen's history** lists projects using the same card.

  **Done when** the stage line reads the same on the card, the folder and the client.

- [ ] **18. The project folder** (frontend — Opus/high). _Depends on: 17._
  - **`#/projects/<id>`**: Overview (UPID, name, client, stage line, the **one next action**), a
    compact Production days list, Documents, and Activity (IA Content Hierarchy).
  - **Actions:**
    - Mark sent: a Stage-D stopgap, which records the date and is replaced by sending in E.
    - Decline / Reopen: days leave and return to calendars; Reopen re-runs the clash check (D22).
    - Duplicate as new project; Delete.
  - **The editor moves** under `#/projects/<id>/estimate`, and Back returns to the folder.
  - **D62:** the doc-type select and invoice-number field are removed from the editor.
  - Calendar tiles now open the folder.

  **Done when** every action round-trips, a declined project disappears from Home and the editor
  calendar, and nothing else in the editor moves at 1280.

- [ ] **19. Accepting, and creating invoices** (money math — Opus/high). _Depends on: 14, 18._
  - **`POST /api/projects/:id/accept`**, in one transaction:
    - sets accepted;
    - confirms every dated day and flags any clash "clash, rebook" (D18);
    - creates the pair or single invoice (D32) at the project's deposit % (D33, copied from
      settings);
    - logs activity.

    It is idempotent.
  - **The folder's "Mark accepted"** asks Pair or Single (and lets the deposit % be changed for this
    project).
  - **`POST /api/projects/:id/invoices`** handles a project accepted before this existed.
  - Numbers are `INV-<UPID>-D` / `-F` / `INV-<UPID>` (D36), and the UPID locks at that point.

  **Done when** tests cover:
  - the transaction rolling back whole on a failure;
  - a double accept;
  - a clash flag;
  - the numbers;
  - the amounts matching task 14 exactly.

- [ ] **20. The invoice screen and invoice PDFs** (money math — Opus/high). _Depends on: 19._
  - **`#/projects/<id>/invoices/<invoiceId>`:**
    - **The deposit** is a fixed summary (D37).
    - **The final** shows the accepted estimate read-only, then an editable **Extras** block
      (Additional work services through the existing picker), less deposit, and the balance due
      (D35). It's editable until sent.
    - **Mark paid** takes a date and method.
    - **A legacy invoice** is read-only, marked "made the old way".
  - **PDFs** for deposit, final and single invoices (the existing invoice PDF's header and payment
    block), plus a Cost Breakdown per invoice (D8).

  **Done when** `test-pdf.js` pins each kind's amounts and wording and the final's "Less deposit
  paid (INV-…-D)". In the browser: add $420 of Overtime to a final invoice, save, reload, and the
  PDF matches.

- [ ] **21. The Settings screen** (frontend — Opus/high). _Depends on: 11._
  - **Invoice Settings becomes `#/settings`** (D65), with sections Business, Payment, Estimates &
    invoices, Service agreement, Email and Card payments (a rail at ≥1100px, a jump list on
    phones). The existing fields move over unchanged.
  - **New fields:**
    - deposit % (default 50, D33);
    - valid-for days (default 30, D44);
    - the four default messages (D43);
    - the service agreement text area, with a fill-in field list and "Preview with a project…"
      (D39);
    - the FAQ URL (default `https://lsccreative.studio/faq.html`, D55).
  - **Email and Card payments** read "Not set up yet" until stage E.
  - **The nav item** becomes "Settings", and the modal and its focus-trap use are retired.

  **Done when** every old setting round-trips unchanged, and the preview fills `{client_business}`
  and the others from a real project.

- [ ] **22. Recent activity on Home** (frontend — Opus/high). _Depends on: 12, 19._ The last 10
  events (sent, accepted, declined, invoice created, paid), each linking to its project (D52).

- [ ] **23. D polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium).
  - **Accessibility:** the folder, Projects, Settings and fix-up screens.
  - **Responsive:** 1280, 800 and 375.
  - **Deploy:** ask first, then NAS v13 (back up first; read the boot log's project counts and
    `needs_upid` count), then Pages.
  - **The user** then runs the fix-up if the banner shows.

## Stage E — Client pages, signing, sending and payment (migration v14)

**Inputs needed from the user before tasks 27–31 can be finished:**

- the service agreement text (D39);
- a Google Workspace app password, set in the NAS `.env`;
- a Stripe account and keys, plus the webhook secret.

Tasks 24–26 can be built with placeholders.

- [ ] **24. The client page shell, in the light brand** (frontend — Opus/high). _New `web/c/`
  (`index.html`, `c.css`, `c.js`)._
  - **This task sets the client-facing aesthetic, so the user validates it before anything is wired
    to it.** It's a Swiss/editorial document on warm paper (D54):
    - colours `--lsc-white` / `--lsc-surface-lt` / `--lsc-black` / `--lsc-terra` /
      `--lsc-terra-dk`;
    - Delight headings;
    - CS Felice Mono for labels and figures. Copy only `CSFeliceMono-Regular.woff2` from the
      git-ignored `Visual Design/` into `web/fonts/` (D57).
  - **Content:** the wordmark "LSC *Creative*.", a single column (≤680px), tabular figures, rules as
    structure, 8px radii.
  - **Rendered from a static fixture** (an estimate with three days and a proposed day), with the
    "we" voice (D56).

  **Done when** the user has seen it at 375 and 1280 and said yes, contrast is verified for every
  text pairing, and nothing from the app's CSS is loaded.

- [ ] **25. Sent versions and the public estimate route** (auth/security — Opus/high).
  _Depends on: 19, 24._
  - **Migration v14:**
    - `estimate_versions`;
    - `estimates.public_token`;
    - `signatures` (with `pdf_blob`, D66);
    - `sends`;
    - `payments`;
    - `invoices.public_token`.
  - **Sending freezes vN** (D34): the full snapshot with surcharge-folded client lines, client
    totals and valid-until (D44). The previous version is superseded.
  - **`/public/*` is mounted before `requireAuth`**, with CORS for the Pages origin without
    credentials, and a per-IP rate limit.
  - **`GET /public/estimates/:token`** goes through a **dedicated serializer**. Its `state` is
    computed live: `open` | `taken` (any proposed day now confirmed elsewhere, D41) | `expired`
    | `superseded` | `declined` | `accepted`. It includes `unavailableDays`. Also `GET
    /public/estimates/:token/pdf`.
  - **The editor banner:** "Editing after v2 was sent…".

  **Done when** tests cover:
  - the **leak test** (Ground rules);
  - a wrong or short token getting 404 with no timing tell;
  - each state;
  - a re-send keeping the link;
  - rate limiting kicking in.

- [ ] **26. The client estimate page, wired** (frontend — Opus/high). _Depends on: 24, 25._
  - `c/#e/<token>` renders the version: days with status words, times and items; the disclaimer;
    totals; valid-until.
  - **Accept** shows only in `open`. Each other state shows its notice (brief, Key Interactions 6),
    and a taken day is marked "No longer available".
  - "Download PDF".
  - **No `localStorage`, no analytics.** Opening the page logs "opened" through the GET.

  **Done when** each state is checked in the browser against the scratch API, and the page stays a
  single column at 375.

- [ ] **27. Signing** (auth/security — Opus/high). _Depends on: 19, 26._
  - **The signing dialog** (full screen on phones):
    - the agreement filled from the client snapshot (D39), in a focusable, labelled scroll box;
    - "Service agreement FAQ" (D55);
    - full name, role, "I agree";
    - **Sign & submit**, disabled until all three are done (D40).
  - **`POST /public/estimates/:token/accept`:**
    - re-checks the state;
    - stores the signature: name, role, IP, user agent, time, version, exact text, sha256, and
      the rendered PDF as a blob (D66);
    - then runs **task 19's accept transaction**.

    It's idempotent per version, and refuses any state other than `open`.
  - **Afterwards:** a thank-you screen with "Download signed agreement", and the agreement shown in
    the project folder's Documents.

  **Done when** tests cover a race (two submits), a submit after the state changes to `taken`, the
  stored text matching what was shown, and the PDF opening. Placeholder agreement text is allowed
  until the user supplies theirs.

- [ ] **28. Email and the send queue** (backend — Sonnet/high). _Depends on: 25._
  - **`server/src/mail.js`:** `nodemailer` over smtp.gmail.com with `SMTP_USER` /
    `SMTP_APP_PASSWORD` from `.env` (D38). Never logged, never in the database.
  - **The `sends` queue and a one-minute scheduler.** A row is claimed (`sending`) in a
    transaction before the SMTP call. On boot, overdue rows go out and are marked `late` (D47).
  - **Templates:**
    - the estimate link and invoice links, with the user's message;
    - the owner's "accepted" notice, with a `#/projects/<id>` link;
    - the client's signed copy (the PDF attached).
  - **Settings → Email:** "Connected / Not set up", plus "Send a test email".

  **Done when** tests with a stubbed transport pin claiming (no double send across a simulated
  restart), late marking, cancel and edit, and that a failure is stored and shown, not swallowed.

- [ ] **29. The send panel** (frontend — Opus/high). _Depends on: 18, 28._
  - **The panel** (`Modal`), for an estimate or any invoice: send date and time (default now), the
    pre-filled message per kind, **Confirm to send**, and **Copy link** off to the side (D43).
  - **On the folder's document rows:** "Scheduled Tue 9:00 · Edit · Cancel", "Sent late at 11:42
    (scheduled 9:00)", and "Failed — retry".
  - **It replaces stage D's "Mark sent".** Sending an estimate is what freezes the version
    (task 25).

  **Done when** the panel schedules, edits, cancels and sends against the scratch API with a stub
  transport, and Copy link toasts.

- [ ] **30. The client invoice page** (frontend — Opus/high). _Depends on: 20, 24, 25._
  - **`GET /public/invoices/:token[/pdf]`**, through the serializer.
  - **`c/#i/<token>`:** the invoice by kind, amount due, bank details, "Download PDF", and "Paid
    on …" once paid (D46).

  **Done when** the leak test covers invoices too, and each kind renders correctly.

- [ ] **31. Stripe card payment** (auth/security + money — Opus/high). _Depends on: 30._
  - **A per-invoice "Card payment on/off"** in the invoice screen.
  - **`POST /public/invoices/:token/checkout`** creates a Checkout session for the amount due plus
    a **card surcharge line** (Settings %, D49). The client page states the surcharge before
    redirecting.
  - **`POST /hooks/stripe`:** verifies the signature (`STRIPE_WEBHOOK_SECRET`), then on
    `checkout.session.completed` marks the invoice paid (`paid_via: card`, `card_fee`) and logs
    activity. It's idempotent on the event id.
  - **The surcharge is a pass-through**, not income (D49).
  - **Settings → Card payments:** status, plus the % with its legal note.

  **Done when** tests with Stripe's signed test payloads cover a bad signature (refused), replay
  (no double pay), and amount plus fee correct to the cent. A test-mode payment completes against
  the scratch NAS through a tunnel or the Stripe CLI.

- [ ] **32. E polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium).
  - **Client pages, phone-first:** 16px body, 44px targets, Sign & submit reachable, reduced
    motion.
  - **Accessibility:** the signing dialog's focus and scroll box.
  - **Deploy (ask first):** add the `.env` secrets on the NAS; NAS v14; check the boot log and the
    scheduler; then Pages.
  - **An end-to-end run with the user:** send a real estimate to their own address, sign it,
    confirm the email, the invoices, the calendar and the signed PDF, then pay a deposit by card in
    test mode.

## Review

- [ ] **33. Money-math and security review, then design review** (review).
  - **A `/code-review` (xhigh) of the whole track's diff, Stage B2 included**, hunting for:
    - a field that prices but doesn't print, or the reverse;
    - a line saved before a change that now totals differently;
    - `calc.js` drift;
    - **any owner-only figure reachable from `/public/*`**;
    - a send that can go twice;
    - a signature that can be replayed.
  - **Then `/design-review`** against the brief, covering both surfaces.
  - List the fixes here under "Code review fixes" and "Design review fixes", as earlier tracks do.

## Not in this list (and why)

- **`estimate-accuracy` tasks 9, 10, 12–14** stay in that track and are un-grilled. When grilled,
  **10 (discount)** must say whether it applies before or after surcharges, and **12 (minimum
  call)** whether it applies per booked day.
- **The Client Hub integration** is out of scope (D53).
- **Post-production days on the calendar** (D97): a formula from the deliverables, deferred until
  after A–E by the user. Grill it then; `postPlan` is its input.
- **Removing the committed Delight `.woff2` from git history** is the user's call (D57), and a
  separate job.
