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
  and everything after it (D59). **Done 2026-10-03** (see the Done note below).

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

- [x] **14. Invoice maths** (money math — Opus/high). **Done 2026-10-03, committed `bd85aa9`.**

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

- [x] **15. Schema v13: projects, statuses, invoices, activity** (money math — Opus/high).
  _Depends on: 14._ **Done 2026-10-03, committed `f7d55d0`** (see the Done note below).
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

  **Done note (2026-10-03).** New `server/src/migrations/v13-projects.js` and `server/src/projects.js`.
  Changed `db.js` (v13; a `foreignKeysOff` migration flag; `migrate(db, { to })` for tests),
  `routes/estimates.js`, `estimate.js` (`projectId`), `days.js`, `routes/calendar.js`, `test-db.js`
  and `test-api.js`. `npm test` 419/419 (was 409); `calc.js` untouched.
  Mutations caught (36): every status mapping; FK-off flag, `foreign_key_check`, FK restore, the
  rebuild guard; shared and blank UPIDs flagged; `accepted_at`; the unique trim; each legacy
  status, number trim, `issued_at`, copied totals, idempotency, the legacy-number exemption and
  both NOCASE uniques; the waiting-project keep, taken-by-project, taken-by-waiting-group,
  settling, sibling sync, client sync, the UPID trim; POST draft, PUT keeps status; duplicate's
  blank UPID and doc type; the dropped empty project; declined days, rentals and lock;
  `projectId` on the reply. Dry run on a copy of the `api-scratch` DB (v12, 9 estimates, 18 days,
  3 rentals): 9 projects, 4 need a UPID, 1 legacy invoice, rows and totals byte-identical, days
  and rentals kept, FK and integrity checks clean. Decisions taken in the code:
  - **The rebuild runs with foreign keys off.** SQLite ignores the pragma inside a transaction,
    so the runner turns them off around a migration flagged `foreignKeysOff` and requires an empty
    `foreign_key_check` before commit, or rolls the whole migration back. A dangling row already
    in the live DB would stop the boot: **dry-run v13 on a copy of the live backup before task 23.**
  - **Shared or blank UPIDs:** each estimate gets its own project (`upid` NULL, `needs_upid` 1)
    and keeps its old UPID on the estimate row, which is what task 16 groups by. "Shared" ignores
    case and surrounding spaces. A unique UPID is trimmed onto the estimate.
  - **`projects.upid`** is UNIQUE `COLLATE NOCASE`, never blank or padded (CHECK). New drafts may
    have none (`upid` NULL, `needs_upid` 0), so they don't trip the fix-up banner.
  - **A doc-type Invoice row becomes `accepted`** as well as `approved` / `invoiced` / `paid`,
    because no screen ever set a status and an invoice means the job went ahead. Its project's
    `accepted_at` is the estimate's `updated_at`.
  - **Legacy invoices** (one per invoice-typed or invoiced/paid row): number trimmed (NULL if
    blank), status paid → `paid`, invoiced/sent → `sent`, else `draft`; `paid_at` NULL (never
    recorded); `issued_at` the document's date; `totals_json` copied; `estimate_snapshot_json` the
    whole old row. Invoice numbers are unique case-insensitively **except legacy** (a partial
    index), so two old invoices printed with one number both survive. `invoices.estimate_id` is
    added (not in the IA) to tie a legacy invoice to its row; `public_token` waits for v14.
  - **Write routes:** a new estimate is a new project. `upid_taken` (409, with `projectId`) if
    another project holds the UPID, or an estimate waiting for the fix-up still carries it. A
    waiting project saved with its own shared UPID stays waiting; a free one settles it. Renaming
    moves every estimate in the project. The project follows the estimate's client.
  - **An estimate save never moves its status** (POST is always draft, PUT keeps it): from now on
    only project actions do (tasks 18, 19). The web already sends the stored status back.
  - **Duplicate** makes a new project with a blank UPID and doc type `estimate` (D60, D62). Task 16
    still owns the editor side (focus, refusing to save until unique).
  - **Deleting an estimate** deletes its project when no estimate is left (invoices and activity
    cascade), as deleting an invoice-typed estimate always took that invoice with it.
  - **Declined** estimates' days and rentals leave `/api/calendar` and lock no date.
  - `doc_type` / `invoice_number` are still written as sent until task 18 removes them from the
    editor. `activity.kind` has no CHECK: Stage E adds kinds.

- [x] **16. The UPID fix-up screen and Duplicate** (frontend — Opus/high).
  _Depends on: 11, 15._ **Done 2026-10-03, committed `ad63ac0`** (see the Done note below).
  - **`#/setup/upids`** lists groups (estimates with name, date and total). Per estimate, the user
    types a new UPID; per group, they can choose "Keep together". It uses `GET/POST
    /api/setup/upids`.
  - **A banner on the list** while any are left, which disappears with the route when none remain
    (D61).
  - **Duplicate creates a new draft with no UPID** (focused) and no days, and refuses to save until
    the UPID is unique (D60).

  **Done when** it's verified against a scratch DB seeded with a duplicate pair and a blank UPID.

  **Done note (2026-10-03).** New `server/src/routes/setup.js`, `web/js/views/setup-upids.js`,
  `web/css/setup.css`. Changed `projects.js` (`upidTakenBy` takes a list of own projects;
  `upidTakenReply`), `routes/estimates.js` (`needsUpid` on the list reply), `app.js` (both), the
  list, detail, editor and `estimates.js`. `npm test` 422/422 (was 419); `calc.js` untouched.
  Mutations caught (9): the group's own projects counted as taking its UPID; invoices, then
  activity, not moved; a repeat allowed; differing clients allowed; `accepted_at` dropped; an
  extra estimate in the group allowed; the emptied project kept; blank groups first. Checked in
  the browser against `api-scratch` (v12 seeded with a same-client pair, one an old invoice, then
  migrated to v13: 6 waiting, 4 groups, alongside the existing different-clients pair and two
  blanks) at 1280 / 800 / 375, with dispatched clicks and a stubbed `confirm`. Decisions taken in the code:
  - **Each field starts on the estimate's current UPID**, so what's on screen is what it will be
    called: one of a pair may keep the shared UPID. A group of one with a UPID (a sibling since
    renamed in the editor) is confirmed by saving it as it is.
  - **A group settles whole, in one write.** A POST whose estimates aren't the group as it
    stands is `group_changed`, and the screen reloads. Blank, repeated (case-insensitive) and
    taken UPIDs are refused per field (`upid_required`, `upid_repeated`, `upid_taken` with
    `estimateId`).
  - **Keep together** keeps the oldest estimate's project, under the UPID as the oldest spells
    it; moves the others' estimates, invoices and activity into it and deletes their projects;
    takes the earliest `accepted_at`, and `declined_at` only if every one was declined. **Two
    different linked clients are refused** (`clients_differ`, D31: a project is under one
    client); an unlinked estimate goes along. Blank UPIDs never group, so they can't be kept together.
  - **`upid_taken` now names the holder** (`projectName`, its oldest estimate's name) in its
    message, here and in the editor, which shows it on the UPID field.
  - **Duplicate opens the copy's editor**, not its detail: UPID blank and focused, with
    "Copied from <UPID> · <name>" under it (route state only; a reload is an ordinary edit).
    Blank was already refused on save.
  - The route goes when none remain: settling the last group, or arriving with none, leaves to
    the list with a toast. The banner counts `needsUpid` from `GET /api/estimates`. The setup
    area lights the Estimates nav item.

- [x] **17. The Projects list** (frontend — Opus/high). _Depends on: 15._ **Done 2026-10-04,
  committed `4cd0ed4`** (see the Done note below).
  - The nav item and route become **Projects** (`#/projects`), and the list shows **one card per
    project** (D58).
  - **A stage line** from one shared function, for example "Sent v2 · valid until 14 Oct" or
    "Deposit paid · final not sent". Before stage E, "Sent" is set by the owner (task 18).
  - **Search and stage chips**, with `?stage=` and `?q=` in the hash, and "Show more" after 50.
  - **The Clients screen's history** lists projects using the same card.

  **Done when** the stage line reads the same on the card, the folder and the client.

  **Done note (2026-10-04).** `GET /api/projects` (new `routes/projects.js`; `projectStage` and
  `settledAt` in `projects.js`), `web/js/project-card.js` (`ProjectCard`: `stageLine`,
  `stageMarkup`, `cardMarkup`, `bind`, `pathOf`), `views/project-list.js` (`ProjectsView`,
  replacing the deleted `estimate-list.js`), `css/projects.css`, new `test-project-card.js`.
  `npm test` 429/429 (was 422); `calc.js` untouched. Mutations caught: 24/24 server, 5/5 wording.
  Checked against `api-scratch` at 1280 / 800 / 375 (dispatched clicks, one real Tab for focus
  rings). Decisions taken in the code:
  - **The server decides the stage, the web words it.** `projectStage` returns `{stage, step, …}`
    (16 steps); the list filters and counts by it. `stageLine(project, today)` is the one wording
    function, because "valid until", "expired" (D44) and "overdue" read against the browser's
    today. Invoices (void ignored): the first unpaid of deposit, final, single, legacy is where
    the job is; a deposit or single not yet sent is still Accepted. A **legacy** invoice reads
    "Invoiced · <number>, made the old way" until paid, never "not sent" (no screen ever set a
    status). Declined wins over everything.
  - **Chips: Active · Draft · Sent · Accepted · Invoiced · Paid · Declined**, with counts. The IA's
    "All" became **Active** (its Content Growth Plan): every project except paid/declined ones
    settled 90+ days ago (paid date, else the invoice's last change). A search looks at every
    project. A chip pushes history; typing replaces the entry. The router's entries are now path
    + query (`key`), so Back between filters redraws, and the list updates in place (search keeps
    focus). `leaveTo('/projects')` returns to the list as filtered.
  - **A project's name, total and client** are its lead estimate's (latest changed, not
    declined); a kept-together group shows "· N estimates". Newest activity first (project,
    estimates, invoices, activity). Search: UPIDs (the waiting one's old UPID too), every
    estimate's name, client business and contact.
  - **Phones:** the chips are one sideways-scrolling row to the screen edge (wrapped they took
    three rows and pushed the first card below the fold).
  - **Routes:** `#/projects`, `#/projects/new` (the editor); `#/estimates` alone redirects to
    Projects. Detail and editor stay at `#/estimates/<id>` until task 18. Nav "Projects"
    (`#nav-projects`). The client's history is the same cards via `?client=&stage=all`.

- [x] **18. The project folder** (frontend — Opus/high). _Depends on: 17._ **Done 2026-10-04,
  committed `c278225`** (see the Done note below).
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

  **Done note (2026-10-04).** New `web/js/views/project-folder.js` (`ProjectFolder`),
  `web/css/project-folder.css`. Server: `routes/projects.js` gains `summarize()` (the one project
  summary, shared by the list and the folder), `readFolder`, `GET /api/projects/:id`, `POST
  /sent | /decline | /reopen`, `DELETE`; `routes/estimates.js` stops writing `doc_type` /
  `invoice_number`; `routes/pdf.js` takes `{ as: 'estimate' }`; `/api/calendar` days and rentals
  carry `projectId`. Web: `estimates.js` rewritten for the project routes, `app.js` route table,
  `ProjectCard.pathOf` → the folder, `ProjectCard.localDate`, Home's tile pop-up ("Open project")
  and Coming up, the editor (D62 controls gone, `focusDay` option), `api.js` `postPdf(path, body)`.
  `npm test` 436/436 (was 429). Mutations caught 22 of 23 (the 23rd, own days excluded from the
  reopen check, is equivalent today: they are still declined then). Checked against `api-scratch`
  at 1280 / 800 / 375 with dispatched clicks: every action, Back, the clash refusal (a scratch day
  confirmed by hand, then put back), a declined project gone from Home's and another editor's
  calendar and back after Reopen, PDFs, old addresses; the editor's 25 blocks measured before and
  after at 1280, identical. Decisions taken in the code:
  - **Routes:** `#/projects/<id>` the folder; `…/estimate` the lead estimate's editor, `…/estimate/view`
    its read-only view (the old detail screen, kept for sent and accepted estimates and for stage E's
    versions); `…/estimate/<eid>[/view]` another estimate of a kept-together group.
    `#/estimates/<eid>[/edit]` find the project and replace the entry. Save returns to the folder.
  - **Next action** (`nextAction()` in the folder, where 19 and 20 add theirs): draft and sent →
    Edit estimate; declined → Reopen; anything later → View estimate. "Mark sent…" / "Mark sent
    again…" sit beside it; Decline (hidden once any non-void invoice exists), Duplicate as new
    project and Delete in the quiet row.
  - **Mark sent** asks only "Valid until" (today + 30, D44; task 21 makes it a setting), has an
    "↓ Estimate PDF" button, sets the lead estimate `sent`, and logs `sent` `{ validUntil,
    estimateId }` **with no version**: nothing is frozen until E (D34). Refused once declined or
    accepted.
  - **Decline** sets every estimate declined and `declined_at`; refused with a live invoice; a second
    one is a no-op. **Reopen** returns everything to draft (clears `accepted_at` too) and refuses,
    `date_locked`, naming every date another project has since confirmed, unless that day has a
    specification note; "Open the estimate" goes to the clashing day's card. Pencilled overlaps are
    only named in the toast (D15).
  - **Delete** removes the project (estimates, days, rentals, invoices, activity cascade); refused
    while a non-legacy invoice is scheduled, sent or paid. The editor's own Delete stays.
  - **D62 in the server too:** POST writes `estimate` / `''`, PUT keeps what the row has, so an old
    invoice-typed row still prints as its invoice. Documents list such a row twice: its estimate
    (PDF `as: 'estimate'`) and "Invoice INV-… · Made the old way" (PDF as it was).
  - **Timestamps are read on the browser's clock** (`ProjectCard.localDate`): a UTC `declined_at`
    in the evening was showing the next day's date; this also fixes task 17's card.
  - **Found and fixed:** `isYmd` threw (500) on an impossible date like `2026-13-01`; now 400.
  - The editor's doc-type bar keeps `min-height: 61px` from 768px, so nothing below it moves.

- [x] **19. Accepting, and creating invoices** (money math — Opus/high). _Depends on: 14, 18._
  **Done 2026-10-04, committed** (see the Done note below).
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

  **Done note (2026-10-04).** Server: `routes/projects.js` gains `POST /accept` and `POST
  /invoices` (`invoicingChoice`, `cannotInvoice`, `confirmDays`, `createInvoices`), the folder's
  `depositPctDefault`, `upidLocked`, each day's `rebook` and each invoice's `amountDue` (was
  `totalIncGst`); `projects.js` `upidLocked` + the `upid_locked` refusal in `planProjectWrite`;
  `days.js` `replaceDays` carries the flag; v13 gains `production_days.rebook` (v13 is undeployed,
  so it went there, not into a v14); `DELETE /api/estimates/:id` refuses `has_sent_invoices` for
  the billed or last estimate. Web: the folder's Mark accepted… / Create invoices… dialog (pair or
  single, deposit %, a live split from `LSCCalc.depositAmount`), the clash line on day rows, the
  activity wording; the editor's UPID read-only when locked. `npm test` 444/444 (was 436).
  Mutations caught 22 of 22. Checked against `api-scratch` at 1280 / 656 / 375 with dispatched
  clicks: accept with a clash (AUD-B, 40%), Create invoices single (TST-001), the locked UPID
  refused and then saved, the flag kept through a save. Decisions taken in the code:
  - **What is accepted:** the lead estimate only; a kept-together group's others stay as they are.
    Only days that were pencilled or proposed are confirmed and can be flagged; an already
    confirmed day held its date first.
  - **The flag is stored, shown live:** `rebook = 1` from the accept; the folder shows it only while
    another live project still has that date confirmed (so it hides while that one is declined).
    Moving the day or adding a specification note clears it; the browser can't set it.
  - **Idempotent** means a second accept, or a second Create invoices, answers the folder with
    `already: true` and writes nothing, whatever the body asks.
  - **Deposit %:** the body's, else the project's own, else `settings.invoicing.depositPct`, else
    50. **Task 21 must store the setting at `settings.invoicing.depositPct`.** A pair needs
    0 < % ≤ 100; a single leaves the project's own % alone.
  - **Snapshot:** each invoice stores the accepted estimate whole (`loadEstimate`, days confirmed)
    in `estimate_snapshot_json`; totals are task 14's from its stored totals, no extras yet. All are
    `draft`, with no issued or due date.
  - **Refusals:** `needs_upid`, `upid_missing`, `invoice_number_taken` (a UPID like `ABC-D` would
    make project ABC's deposit number), `project_declined`, `not_accepted` / `has_legacy_invoice`
    for /invoices, `deposit_pct_invalid`, `invoicing_invalid`.
  - **UPID lock (D36):** any non-legacy invoice locks it, a void one too (it keeps its number).
  - **Activity:** `accepted` `{ estimateId, invoicing, depositPct, invoices, rebook }`;
    `invoices_created` `{ estimateId, invoicing, depositPct, invoices }`. Task 22 words both.

- [x] **20. The invoice screen and invoice PDFs** (money math — Opus/high). _Depends on: 19._
  **Done 2026-10-04, committed** (see the Done note below).
  - **`#/projects/<id>/invoices/<invoiceId>`:**
    - **The deposit** is a fixed summary (D37).
    - **The final** shows the accepted estimate read-only, then an editable **Extras** block
      (Additional work services through the existing picker), less deposit, and the balance due
      (D35). It's editable until sent.
    - **Mark paid** takes a date and method.
    - **A legacy invoice** is read-only, marked "made the old way".
  - **PDFs** for deposit, final and single invoices (the existing invoice PDF's header and payment
    block), plus a Cost Breakdown per invoice (D8).

  - **Correcting an invoice (D100):** a draft edits in place; a sent, unpaid one is voided (date +
    reason, kept) and replaced with the next free suffix (`-D2`, `-F2`, `INV-<UPID>-2`); a paid one
    is never voided.

  **Done when** `test-pdf.js` pins each kind's amounts and wording and the final's "Less deposit
  paid (INV-…-D)". In the browser: add $420 of Overtime to a final invoice, save, reload, and the
  PDF matches.

  **Done note (2026-10-04).** New `server/src/invoices.js`, `server/src/routes/invoices.js`,
  `web/js/views/invoice.js`, `web/css/invoice.css`. Changed `pdf.js` (`buildInvoiceDocHtml`,
  `invoiceFilename`, `invoiceBlocker`; the Cost Breakdown takes an invoice; the old invoice's head and
  payment block are helpers, output byte-identical), v13 (`invoices.voided_at`, `void_reason`,
  `replaces_id`), `routes/projects.js` (folder invoice fields), the folder, `estimate-detail.js`
  (`itemsMarkup`), `app.js`, `index.html`. `npm test` 457/457 (was 444); `calc.js` untouched.
  Mutations caught 31 of 32 (the 32nd, the live deposit ordered oldest first, is equivalent: only
  one deposit is ever unvoided). Checked against `api-scratch` at 1280 / 800 / 375 (dispatched
  clicks, puppeteer screenshots): $420 of Overtime on AUD-B's final, saved, reloaded, PDF text
  matches ($7,396.20); Mark sent, void and remake (D → D2 at 50%), Mark paid from the folder's next
  action, the final then taking off D2. Decisions taken in the code:
  - **Routes:** `GET/PUT /api/invoices/:id`, `POST …/sent | /paid | /void | /pdf | /cost-breakdown`.
    Every write answers with the invoice, its project summary and the project's invoices.
  - **Mark sent (Stage D stand-in)** asks issued + due dates (due defaults to issued + 14 days, a
    browser constant until task 21). From draft only. Its PDF button prints the dialog's dates.
  - **Mark paid** takes a date (not after today) and bank / card. Allowed on a draft (a PDF emailed
    by hand) and on an old-way invoice, so its stage line can reach Paid. Twice is `already`.
  - **Extras** are `{ additional: [...] }` lines carrying their own `mu` snapshot; the server
    refuses a line without a price. Priced on save through `extrasTotals` with the estimate's
    `gstFree`. Re-linking a final to another deposit reuses the stored extras block, never
    re-prices the lines.
  - **A draft deposit's %** edits in place while its final is a draft (`final_sent` after); the
    final and `projects.deposit_pct` follow.
  - **Void and remake (D100):** the void is dated `today`, kept with its number, and needs a
    reason. The replacement is a draft with the same snapshot, extras and %, `replaces_id` set. A
    deposit's replacement is taken off any draft final; a sent final keeps the deposit it printed
    and its screen says to remake it, and a remade final takes off the deposit standing now.
  - **PDFs:** "Less deposit paid (N)" once that deposit is paid, else "Less deposit invoiced (N)".
    A void prints VOID with its reason and replacement, and no payment block; a paid one says so.
    The final's GST rows are the balance's. Cost Breakdown filename carries the invoice number.
  - **Folder:** the next action follows the first unpaid invoice ("Open deposit invoice", "Mark
    deposit paid…" opening the page on its dialog, "Edit final invoice"); each invoice row has
    Open, ↓ PDF, ↓ Breakdown. New activity kinds: `invoice_sent`, `invoice_paid`,
    `invoice_voided`, `invoice_edited` (worded in the folder; task 22 words them on Home).

- [x] **21. The Settings screen** (frontend — Opus/high). _Depends on: 11._
  **Done 2026-10-04, committed** (see the Done note below).
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

  **Done note (2026-10-04).** `web/js/views/settings.js` rewritten as a routed screen
  (`#/settings[/<section>]`, sections `business payment documents agreement email cards`),
  `web/css/settings.css` rewritten mobile-first. New **`server/src/documents.js`**, byte-identical to
  `web/js/documents.js` (drift test in new `test/test-documents.js`, 10 tests): `DOC_DEFAULTS`,
  `docSettings(settings)`, `AGREEMENT_FIELDS`, `agreementValues(input)`, `fillAgreement(text, values)`.
  - **Stored shape:** `invoicing { depositPct, validDays, dueDays }`, `messages { estimate, deposit,
    final, single }`, `agreement { text, faqUrl }`. Every reader goes through `docSettings`, which
    fills a missing or unusable value from the defaults; a message or FAQ URL saved as `''` stays
    `''` (D55). Saving writes everything shown, merged onto a fresh read (unknown keys survive).
  - **Also a setting now:** invoices' due-after days (default 14; was `DUE_DAYS` in `invoice.js`).
    `VALID_DAYS` in `project-folder.js` is gone too; both read `docSettings(LSCData.settings())`.
    The server's `depositPctFor` reads `docSettings` (no route change).
  - **Fields:** D39's six plus `client_contact`, `project_name`, `business_name`, `business_abn`,
    `date`. Matched case- and space-insensitively; an unknown one is left as typed and listed, a
    blank one listed. Days print as the client PDF does, dated first. The preview uses the text,
    business details and deposit % on screen (saved or not), and the project's own deposit % if set.
  - **Rail jumps** change the address with `replace` + `skipGuard` + `state.jump`, so edits stay.
  - **Retired:** the modal, `#modal-invoice-settings`, and the four refresh hooks it called
    (`EstimateEditor.refreshTotals`, `PricingView.refreshPrices`, `ProjectsView.refreshFirstRun`,
    `FinanceDashboardView.refreshGst`): with Settings a screen, none could be on screen at its save.
    The "Open Invoice Settings" buttons now go to `#/settings/business`.
  - Mutations caught: deposit 0 allowed, valid-for 0 allowed, TBC days sorted first, unknown field
    blanked. Browser (api-scratch, dispatched events): a full old settings row round-tripped
    byte-identical; 40% / 21 / 7 reached the server's deposit default and both Mark sent dialogs;
    preview filled from AUD-B; Escape and Back close it. 1280/800/375 via headless Chrome: no
    overflow, 44px targets at 375.

- [x] **22. Recent activity on Home** (frontend — Opus/high). _Depends on: 12, 19._ The last 10
  events (sent, accepted, declined, invoice created, paid), each linking to its project (D52).

  **Done note (2026-10-04).** New **`GET /api/activity?limit=`** (1–50, default 10) in
  `routes/projects.js`: the latest rows of `HOME_KINDS` (`sent`, `accepted`, `invoices_created`,
  `invoice_sent`, `invoice_paid`, `declined`) across projects, newest first, each with
  `project { id, upid, name, client }` named by the lead estimate as `summarize()` picks it. The
  owner's corrections (`reopened`, `invoice_edited`, `invoice_voided`) stay in the folder only.
  **Stage E adds its client kinds (opened, signed) to `HOME_KINDS`.** A new route: NAS before
  Pages (ships with v13 at task 23). `activityText` moved from the folder into
  `ProjectCard.activityText`, so Home and the folder word events with one function (pinned in
  `test-project-card.js`). Home groups by local day (Today / Yesterday / "Fri 2 Oct"), a time
  column, UPID + name, the words, the client; rows are log lines (hairlines, not boxes) and a
  payment's words take the accent. Mutations caught 5 of 5 (kinds, order, lead estimate, limit,
  client snapshot). Browser (api-scratch): 10 events, each to its folder; 1280/800/375 via headless
  Chrome, no overflow, focus ring visible.

- [x] **23. D polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium). **Deployed 2026-10-04** (`main` `2c7131b`; see HANDOVER).
  - **Accessibility:** the folder, Projects, Settings and fix-up screens.
  - **Responsive:** 1280, 800 and 375.
  - **Deploy:** ask first, then NAS v13 (back up first; read the boot log's project counts and
    `needs_upid` count), then Pages.
  - **The user** then runs the fix-up if the banner shows.

  **Polish done 2026-10-04** (the deploy is still to do). Swept Projects, the folder, the invoice
  screen, Settings, the fix-up and their six dialogs at 1280/800/375 in the browser pane against
  `api-scratch` (overflow, target size, labels, text contrast, focus). Found and fixed:
  - **Focus fell to `<body>` on every arrival** (the clicked card or Back button goes with the old
    screen). New `LSCUtil.landFocus(root)` puts it on the new screen's `h1` (`tabindex=-1`, no ring)
    only when it was lost, so a nav link keeps it. Called by all five screens.
  - **Dialog danger buttons** (Delete, Decline, Void) were 3.84:1 on the dialog grey: lifted in
    `a11y.css` (app.css stays frozen) to `#f07a7a`, hover `#c04040`. App-wide.
  - **Desktop targets under 24px** next to each other: the folder's document buttons and Settings'
    fill-in fields are 28px from 768px up.
  - Stage chips read "Active9" (now "Active 9"); dialogs were described by their whole body, fields
    included (now `#pfd-desc`, the opening sentence); several estimates' PDF buttons had the same
    name; the invoice dates' hint wasn't tied to its fields; a refused reopen, duplicate or fix-up
    save left focus nowhere; Projects, Settings and the fix-up had no page title.
  - Left as they are: `.back-btn` and the extras' `×` are under 24px but alone in their space
    (WCAG 2.5.8's spacing exception).
  - A fix-up group was staged in scratch by SQL (`B210-PLAN` back to `needs_upid`), audited, then
    settled through the screen; scratch is as it was.

## Stage E — Client pages, signing, sending and payment (migration v14)

**Inputs needed from the user before tasks 27–31 can be finished:**

- ~~the service agreement text (D39)~~: supplied 2026-10-04 (see HANDOVER);
- a Resend SMTP key with `lsccreative.studio` verified, set in the NAS `.env` (D102);
- ~~a Stripe account and keys~~: card payment is held (D101).

Tasks 24–26 can be built with placeholders.

- [x] **24. The client page shell, in the light brand** (frontend — Opus/high). _New `web/c/`
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

  **Done 2026-10-04, approved by the user** (`fcf77d3`, revisions `9b518fb`). `web/c/` renders `fixture.js`
  at `c/#e/demo`, and `#e/demo/<state>` previews each notice (open, taken, expired, superseded,
  declined, accepted); both go at task 26. The bold move is the production days as a call sheet
  (the date large in a left gutter); headings are sentence case over a rule, figures mono on the
  right, terra only on the masthead rule and the button. Contrast: `--lsc-mid` fails on paper
  (3.94), so secondary text is `#625C58` (5.64 / 5.11 on the panel); terra is never text except
  the large wordmark (3.61, large-text floor 3:1); the button is paper on terra-dk (5.82). Only
  `c.css` loads; 375 and 1280 have no overflow in any state; targets ≥44px. The Pages workflow
  now cache-busts `web/c/index.html` too. User revisions the same day: the lede says "press the Accept estimate
  button below"; "Deliverables" (was "What we'll deliver") are tiles, each with a frame in its own
  aspect ratio (square when the format isn't a ratio), stacked for a quantity over one; "Production
  total" (was "Your investment").

- [x] **25. Sent versions and the public estimate route** (auth/security — Opus/high).
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

  **Done 2026-10-04** (commit below, not deployed). `npm test` 481/481 (was 472): new
  `test-public.js` (9) and a v14 test in `test-db.js`.
  - **v14** is additive and re-runnable: `estimate_versions` (with `snapshot_json` owner-only and
    `client_view_json`, built once at send), `estimates.public_token` and `invoices.public_token`
    (unique when set), `signatures` (one per version, `pdf_blob`), `sends`. **No `payments`
    table** (D101).
  - **Mark sent** freezes the next version (`public.js freezeVersion`), keeps the estimate's one
    link, supersedes every earlier version in the project, and logs `sent` with `version`. The
    folder's estimates and the estimate GET carry `publicToken` and `versions`.
  - **`/public/*`** (`routes/public.js`) is mounted before auth, outside `/api`: its own CORS
    (Pages origin, no credentials; the owner CORS skips `/public`), `no-store`, `noindex`,
    `no-referrer`, and a fixed-window per-IP limit (120 / 10 min; the PDF 12 / 10 min) keyed on
    `CF-Connecting-IP` behind the tunnel, since `TRUST_PROXY` makes `req.ip` the client-written
    `X-Forwarded-For`. "Today" comes from the server, never the request.
  - **The client view is an allow-list** (`clientView`), with days and services from the PDF's
    own readers: `pdf.js serviceGroups` was split out of `serviceItemsHtml` (PDF HTML checked
    byte-identical). Sections' items are `{ name, tag }`.
  - **State order:** accepted → declined → superseded (newer send, project accepted with another
    estimate, or reopened back to draft) → expired → taken (proposed date confirmed by another live
    project; days marked `unavailable`) → open. A reopened project's old link reads `superseded`
    with no `latestToken`: task 26 needs wording for that case.
  - **The editor** shows "Editing after vN was sent…" while that version is live (checked in
    headless Chrome against `api-scratch`; scratch's B210-PLAN is now sent as v1).
  - Mutations caught 12 of 12: whole totals or client snapshot in the view, credentials on public
    CORS, the owner CORS on public, no expiry / taken / declined, a reopened project left open, the
    token rewritten on re-send, no supersede, no rate limit, the routes unmounted. The timing
    check (wrong vs short token, 40 requests each, within 3×) is coarse by nature; the real
    guarantee is that every token takes the same lookup, with no early exit.

- [x] **26. The client estimate page, wired** (frontend — Opus/high). _Depends on: 24, 25._
  - `c/#e/<token>` renders the version: days with status words, times and items; the disclaimer;
    totals; valid-until.
  - **Accept** shows only in `open`. Each other state shows its notice (brief, Key Interactions 6),
    and a taken day is marked "No longer available".
  - "Download PDF".
  - **No `localStorage`, no analytics.** Opening the page logs "opened" through the GET.

  **Done when** each state is checked in the browser against the scratch API, and the page stays a
  single column at 375.

  **Done 2026-10-04** (commit below, not deployed). `npm test` 482/482.
  - **`c/#e/<token>`** reads `GET /public/estimates/:token` from `../js/config.js`'s
    `LSC_API_BASE` (the only app file the page loads), `credentials: 'omit'`. `fixture.js` and the
    `#e/demo/<state>` previews are gone. A token that isn't base64url is "couldn't find" with no
    fetch; 404 is the same page; 429 and a 5xx or no connection get their own words and Try again.
    A newer version's link (`latestToken`) loads in place, focus on the document.
  - **Superseded with no `latestToken`** (reopened, or reworked before a re-send) reads "We're
    revising this estimate". **Accepted** offers "Download signed agreement" only when the reply
    carries `signed` (task 27 adds it): an estimate accepted in the app has no signature.
  - **Also included** shows each item's tag after a muted "·", as the PDF does.
  - **Download PDF** fetches the blob and saves it under the server's filename, with a visible
    status line under the button (busy, done, or why not).
  - **"Opened"** is logged by the GET after the reply is sent (no timing tell; a failed log can't
    cost the page), at most once a day per estimate version (`OPENED_EVERY_MS`), with
    `{ estimateId, version }`. It's in `HOME_KINDS`; `activityText` reads "Client opened the
    estimate (v2)". A mail scanner fetching the HTML logs nothing; the owner opening the link
    themselves does.
  - **Accept** is still a stub that only speaks to a screen reader: task 27 wires it.
  - Checked in the browser against `api-scratch` (B210-PLAN): open, taken (5 Nov "No longer
    available"), expired, declined, reopened, accepted set in the DB and put back; superseded-with-
    link, 429 and offline by a stubbed fetch; the PDF downloads; Home shows the open. 375/800/1280:
    no overflow, the column 720 wide, no target under 44px. Mutations caught 5 of 5 (no throttle,
    version not in the throttle key, a two-day window, not in `HOME_KINDS`, never logged).
  - Housekeeping: `GET /api/clients/:id/estimates` deleted (unused since D).

- [x] **27. Signing** (auth/security — Opus/high). _Depends on: 19, 26._
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

  **Done 2026-10-04** (commit below, not deployed: new routes, NAS before Pages with stage E at
  task 32). `npm test` 491/491 (9 new in `test-public.js`). New `server/src/signing.js`.
  - **What's signed is what was shown.** The GET carries `agreement: { parts, key }` only while
    `open`: the Settings text filled (`agreementValues` + `fillAgreement`) from the FROZEN version,
    with a gap wherever `{signatory_role}` goes. The dialog joins the parts with the role as it's
    typed; signing joins the same parts with the same role and stores that text, its sha256 and
    the PDF. `key` hashes the version and parts: if the agreement, the deposit % or the date
    changed while the client read, the POST answers `agreement_changed` with the new text.
  - **The accept** is task 19's, now one function (`routes/projects.js acceptEstimate`) for both
    ways in. A signature bills the **frozen version's snapshot** (an edit after sending, not
    re-sent, isn't billed) and confirms the **live** dated days. Pair at the project's deposit %,
    or single if the project already chose single. It logs one **`signed`** activity (on Home;
    "Client signed and accepted · name, role · invoices"), not `accepted`.
  - **Never lost to an owner-side problem:** a project that can't be invoiced (needs a UPID, a
    number taken) is still signed and accepted, with no invoices and `invoiceProblem` in the log
    (the owner then uses Create invoices); a PDF renderer that's down still stores the signature,
    and the PDF is made from the stored text on its first download (`public.js signaturePdf`).
  - **Order:** validate → gate (link, already signed → 200 `already`, state `open`, version, key)
    → render the PDF (async) → transaction: the gate again, insert, accept. Two submits: one
    signature, both 200. A date taken during the render is refused.
  - **Routes:** `POST /public/estimates/:token/accept` (10 / 10 min), `GET …/agreement` (the PDF
    limit); owner `GET /api/projects/:id/agreements/:sigId/pdf`; the folder reply has `signatures`
    and Documents lists "Signed agreement". `signed` on the public reply drives the thank-you's
    download. With no agreement in Settings, `FALLBACK_TEXT` (accepting the estimate only).
  - **Accepted pages read dated days as Confirmed** (the user, 2026-10-05): applied live in
    `publicEstimate`; Date TBC days stay as sent, the proposed-dates warning goes, and the stored
    client view is untouched.
  - **`localToday` is Sydney's date**, not the server's: the container is UTC, so expiry and an
    agreement's `{date}` were a day behind until 10–11am.
  - **The dialog** is a native `<dialog>` (the client page loads none of the app, so no `Modal`):
    full screen under 560px, a sheet above; the agreement box scrolls so the fields and Sign &
    submit stay in view; Escape closes and focus returns to Accept; a line under the disabled
    button says what's still missing.
  - Checked in the browser against `api-scratch` at 375 / 800 / 1280 (dispatched clicks, a real
    Escape): sign, the agreement changing mid-read, a date taken mid-sign, the thank-you's download,
    the folder's row and download. Scratch put back as it was. Mutations caught 18 of 18 (no
    in-transaction re-check, role not stored, billed live, no state / key / version check, tick
    not required, name not cleaned, logged as accepted, fixed deposit %, a refusal blocking the
    signature, `signed` never true, the PDF never kept, agreement offered in every state, `signed`
    off Home, owner PDF under any project, today in UTC, no hash on the PDF).

- [x] **28. Email and the send queue** (backend — Sonnet/high). _Depends on: 25._ **Done 2026-10-05:** live Settings test email received (Resend key "LSC Billing App (NAS)" on the NAS).
  - **`server/src/mail.js`:** `nodemailer` over plain SMTP (Resend, D102) with `SMTP_HOST`,
    `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (`admin@lsccreative.studio`) and
    `MAIL_REPLY_TO` from `.env`. The key is never logged, never in the database.
  - **The `sends` queue and a one-minute scheduler.** A row is claimed (`sending`) in a
    transaction before the SMTP call. On boot, overdue rows go out and are marked `late` (D47).
  - **Templates:**
    - the estimate link and invoice links, with the user's message;
    - the owner's "accepted" notice, with a `#/projects/<id>` link;
    - the client's signed copy (the PDF attached).
  - **Settings → Email:** "Connected / Not set up", plus "Send a test email".

  **Done when** tests with a stubbed transport pin claiming (no double send across a simulated
  restart), late marking, cancel and edit, and that a failure is stored and shown, not swallowed.

  **Built 2026-10-05, not ticked: the real send is unverified** (the Resend key isn't in any `.env`
  yet; tick this once the Settings test email reaches an inbox). Not deployed (with stage E at
  task 32). `npm test` 509/509 (18 new: `test-mail.js`, five in `test-public.js`); mutations
  caught 12 of 12 (claim guards, boot recovery, late, key scrub, cancel/edit any state, signing
  queues nothing, no kick, failure swallowed, retry marked late).
  - **New:** `server/src/mail.js` (nodemailer, the four templates), `sends.js` (the queue and the
    outbox: tick, kick, boot sweep), `routes/email.js`, `APP_URL` / `SMTP_*` / `MAIL_*` in
    `config.js` and `.env.example`. `nodemailer` added to `package.json`.
  - **Schema:** v14 (undeployed) was amended in place: `sends.purpose` (`document`,
    `owner_signed`, `client_signed_copy`). The scratch DB needs
    `ALTER TABLE sends ADD COLUMN purpose TEXT NOT NULL DEFAULT 'document'` if it was made at v14
    before this (the one seeded 2026-10-05 is fresh).
  - **No send goes twice.** A row is claimed (`scheduled` → `sending`) in one synchronous
    transaction before the network. A row still `sending` at boot is marked **failed** ("may or
    may not have gone out"), never re-sent. A failure stays `failed` (key scrubbed from the text)
    until the owner retries; no tick retries behind their back. Late = sent over 5 minutes after
    its time (D47); a retry is never late.
  - **Signing's two emails are queued inside signing's transaction** (not after it, as the task
    said): they exist exactly when the signature does, and a crash can't lose them. The outbox is
    kicked after the commit. A client with no email gets no signed copy; the notice goes to
    `MAIL_REPLY_TO`, else Settings' business email. A mail failure never touches the signature.
  - **A due send with no key fails with "Email isn't set up"**, visible in Settings → Email
    (count and latest error). Task 29 shows it on the document rows.
  - **Routes** (owner): `GET /api/email/status`, `POST /api/email/test` (a provider refusal is a
    200 `{ok:false,message}`: a 5xx would raise the app's "server problem" banner),
    `GET /api/sends?docKind&docId`, `PUT /api/sends/:id`, `POST /api/sends/:id/cancel|retry`.
    **Creating a send is task 29's** (it freezes the version first); `addSend` is ready for it.
    An invoice's link is made the first time it's sent; the page is task 30's.
  - **Settings → Email** shows Connected / Not set up, the From and Reply-To, any failed sends,
    and "Send a test email". Checked in the browser against a scratch API (not connected,
    connected with a dead SMTP host, 375px).
  - **Tests never reach a real mailer:** `createApp` uses an unconfigured one under `NODE_ENV=test`
    whatever `.env` holds.

- [x] **29. The send panel** (frontend — Opus/high). _Depends on: 18, 28._
  - **The panel** (`Modal`), for an estimate or any invoice: send date and time (default now), the
    pre-filled message per kind, **Confirm to send**, and **Copy link** off to the side (D43).
  - **On the folder's document rows:** "Scheduled Tue 9:00 · Edit · Cancel", "Sent late at 11:42
    (scheduled 9:00)", and "Failed — retry".
  - **It replaces stage D's "Mark sent".** Sending an estimate is what freezes the version
    (task 25).

  **Done when** the panel schedules, edits, cancels and sends against the scratch API with a stub
  transport, and Copy link toasts.

  **Done 2026-10-05** (commit below, not deployed: new routes, NAS before Pages with stage E at
  task 32). `npm test` 519/519 (new `test-send.js`, 8; two in `test-project-card.js`). Mutations
  caught 18 of 18 (cancel leaving the invoice scheduled, delivery not flipping it, a failed send
  not cancellable, an edit past valid-until or a due date before the send day, no one-year cap,
  two waiting sends, decline / accept / void / paid / delete keeping a send, issued today instead
  of the send's day, valid-until before it, email queued with no mailer, an emailed invoice `sent`
  at once, no link while scheduled, no version on the row).
  - **Routes:** `POST /api/projects/:id/send` and `POST /api/invoices/:id/send`, body
    `{ by: 'email', to, message?, scheduledFor?, validUntil | dueAt }` or `{ by: 'link', … }`
    (`sends.js sendRequest`). The document changes and the send is queued in one transaction.
    `PUT /api/sends/:id` also takes `dueAt`; cancel works on a failed send too. Stage D's
    `POST …/sent` routes stay for the tests that freeze a version directly; the app no longer
    calls them (task 33 may delete them).
  - **An estimate is frozen and `sent` on Confirm** (IA flow 2), whenever the email goes, and is
    issued and valid from the send's day (Sydney's). Cancelling its email leaves the version
    standing (it may have been shared). **An invoice queued to email is `scheduled`** with its
    dates and link; the outbox turns it `sent` and logs `invoice_sent {by:'email', late}` when the
    email goes; cancelling makes it a draft with no dates (the link kept). A failed one stays
    `scheduled` until retried or cancelled.
  - **One waiting send per document** (`send_pending`, 409). Decline, accept (both ways in), void
    and Mark paid cancel a waiting send; deleting a project deletes its sends. A scheduled
    estimate email can't be moved past its version's valid-until; an invoice's issue date follows
    the send's time on edit.
  - **"Copy link"** (D43) is the same route with `by: 'link'`: the version goes live (an invoice is
    `sent` now), and the client link (`c/#e/…`, `c/#i/…`, built beside the app) is copied. The
    clipboard write starts inside the click with a promise of the text (`ClipboardItem`, for
    Safari), then `writeText`; if both are refused, the panel shows the link selected. Rows of a
    live document have their own Copy link.
  - **Email not set up:** the server refuses `by:'email'` (`not_configured`); the panel says so up
    front from `/api/email/status`, disables Confirm and leaves Copy link.
  - **Web:** new `web/js/send-panel.js` (`SendPanel`: the panel, the status line, the clipboard)
    and `web/css/send.css`, its own overlay `#modal-send`. The folder's "Send vN…" (primary on a
    draft), each row's Send… / Copy link and status line ("Email of v2 scheduled Tue 8 Oct,
    9:00 am · Change · Cancel email", "v2 emailed …", "Sent late at 11:42 am (scheduled 9:00 am)",
    "Email failed: … · Retry · Cancel email"); the invoice screen's Send… replaces Mark sent….
    While an email is due or going the screen looks again every 2s, five times at most.
    `activityText` words `sent` / `invoice_sent` by how they went; old rows still read "Marked
    sent".
  - **Dev:** `server/scripts/dev-stub-mail.js` and launch.json `api-scratch-mail` run the scratch
    API with a mailer that prints each email (`STUB_MAIL_FAIL=1` fails them).
  - Checked in the browser against `api-scratch-mail` at 800 / 1024 / 375: schedule, change
    (to Now), send now, v2 and v3 (by link), an invoice scheduled, changed (time and due date),
    cancelled to draft, sent now, a failed send retried (failure set in the DB), Copy link by a row
    and by the panel (stubbed clipboard, and the fallback with the real one refused), email not
    set up (stubbed status), Escape returning focus. 375: full-screen, actions pinned, no overflow,
    no target under 44px, 16px inputs. Dispatched clicks, plus real clicks on Copy link and Retry.

- [x] **30. The client invoice page** (frontend — Opus/high). _Depends on: 20, 24, 25._
  - **`GET /public/invoices/:token[/pdf]`**, through the serializer.
  - **`c/#i/<token>`:** the invoice by kind, amount due, bank details, "Download PDF", and "Paid
    on …" once paid (D46).

  **Done when** the leak test covers invoices too, and each kind renders correctly.

  **Done 2026-10-05** (commit below, not deployed: new routes, NAS before Pages with stage E at
  task 32). `npm test` 523/523 (4 new in `test-public.js`). Mutations caught 12 of 12 (draft or
  legacy served, overdue a day early, bank details when paid/void, a final billed its whole job,
  a draft replacement offered, days as sent on the page or the PDF, the snapshot in the reply,
  raw extra lines, the deposit said paid, no ABN blocker).
  - **The serializer** (`public.js invoiceView`) is an allow-list worked out live (a sent invoice
    can't change, D100), read from `invoiceJson` only as the PDF prints it. `invoiceOfLink` serves
    `scheduled | sent | paid | void` of kind deposit/final/single; a draft (a cancelled send
    leaves its link) and a legacy invoice are the same 404 as a wrong link. `state` is `due`,
    `overdue` (Sydney's today after `due_at`), `paid` or `void`. `payment` (the bank details) is
    sent only while due or overdue, as on the PDF. Void carries the date, reason and the
    replacement's number, and its link only once the replacement is itself live.
  - **Shared readers:** `clientDeliverables` / `clientDays` / `clientSections` / `clientBusiness`
    were pulled out of `clientView` (estimate replies unchanged). `pdf.js` now exports
    `extraItems` (the PDF's extras, used by both), `invoiceTreatment` and `acceptedEstimate`.
  - **Dated days read Confirmed on every invoice, page and PDF** (`acceptedEstimate`): a signed
    estimate is billed from the version as sent, whose days still said Pencilled/Proposed. The
    same rule as the accepted estimate page (the user, 2026-10-05). One `test-pdf.js` pin changed.
  - **The PDF** is the owner's (`buildInvoiceDocHtml`, live business and bank details). A tax
    invoice with no ABN in Settings answers 503 `pdf_unavailable` (the client page says it
    couldn't make the PDF).
  - **The page:** the same document as the estimate. Its bold move is the **payment slip** after
    the total: a dashed tear-off rule, "How to pay", then Bank / Account name / BSB / Account
    number / Reference (the invoice number) / Amount in large mono, each but the bank with a
    **Copy** button ("Copied" for 2s; if the clipboard is refused, the value is selected and a
    screen reader is told). The lede says what it is and where it stands ("Please pay $X by …",
    "Payment of $X was due on …. If you've already paid, thank you.", "It was paid on …").
    Deposit: one line (N% of the estimate total) and the days booked. Final/single: deliverables,
    days with items, also included, extras, then the PDF's sums (estimate, extras, total, less
    deposit paid/invoiced, GST) and the bar (Deposit/Balance/Total due, "… paid" once paid,
    struck through when void). ABNs print grouped. `c.js` routes `#e/` and `#i/`; `index.html`
    is kind-neutral. "Opened" isn't logged for invoices (not in this task).
  - Checked in the browser against `api-scratch-mail` (SEND-B, with placeholder business and
    bank settings) at 375 / 800 / 1280: deposit due, overdue, paid; final due with the deposit
    invoiced and paid; void with the replacement link loading in place; a wrong link; Copy (and
    the refused-clipboard fallback); Download PDF (real Chrome render). No overflow, no target
    under 44px. The scratch DB was restored from a backup afterwards.

- [ ] **31. Stripe card payment — ON HOLD (D101), don't build.** (auth/security + money — Opus/high). _Depends on: 30._
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

- [x] **32. E polish and deploy** (frontend — Opus/high, then deploy — Sonnet/medium). **Done 2026-10-05.**
  - **Client pages, phone-first:** 16px body, 44px targets, Sign & submit reachable, reduced
    motion.
  - **Accessibility:** the signing dialog's focus and scroll box.
  - **Deploy (ask first):** add the `.env` secrets on the NAS; NAS v14; check the boot log and the
    scheduler; then Pages.
  - **An end-to-end run with the user:** send a real estimate to their own address, sign it,
    confirm the email, the invoices, the calendar and the signed PDF. (The card payment step is
    held, D101.)

  **Polish done 2026-10-05** (commit below; the deploy and the end-to-end run still to do).
  - **The user's revisions (approved):** R1, no contact person's name on any estimate or invoice
    (client pages, both PDFs, `public.js` no longer serves `client.contactName`, and older frozen
    views have it stripped on read); the agreement's `{client_contact}` is now a **gap filled by
    the name typed at signing**, like the role (`signing.js` `parts` + `slots`, `joinAgreement`;
    the key hashes both). R2, the For / number / Issued / Due-or-Valid block sits above the title
    and message on both pages. R3, 50% was already the default (the 40% was scratch-only test
    data). R4, bank details were already built (Settings → Payment); scratch simply had none.
  - **Phone Accept bar** (`dock` in `c.js`/`c.css`): below 768px, while the Accept panel is still
    below the screen, a pinned bar with the total and Accept estimate; hidden (and `inert`) once
    the panel is in view or passed. **Short screens (<700px tall):** the agreement runs full
    length in one scroll, not a box inside a scrolling form.
  - `npm test` 523/523; mutations caught 3 of 3 (contact name in the PDF, in the public reply, the
    name gap left as the CRM name). Checked in headless Chrome (the pane was hidden, so its
    IntersectionObserver never fired) at 320×568, 375×667 and 1280: bar shows, hides at the
    panel, returns on scroll up; tapping it opens the dialog with focus on the agreement; Escape
    returns focus to it; no overflow.
  - **Left as is (the user may ask):** emails still greet the contact by name ("Hi Priya,"); the
    owner's own screens still show the contact.

  **Deployed 2026-10-05** (`main` `1cf0ded`). NAS first: backup `pre-v14-20261005-122248.db`
  (integrity ok) in `data/exports` and `manual-backup`; dry run of v14 on a copy of it clean (v14,
  no FK errors, 1 project / 1 estimate / 1 invoice kept); `.env` backed up to `.env.pre-v14`, then
  `SMTP_HOST/PORT/USER`, `MAIL_FROM=admin@lsccreative.studio`, `MAIL_REPLY_TO`, `APP_URL` added;
  code by tar over ssh (excluding `node_modules`, `data`, `.env*`, `docker-compose.yml`);
  `docker compose up -d --build`; boot log `migrated to v14`, `[mail] not set up`, healthy;
  `/api/projects` and `/api/email/status` 401, `/public/*` the app's JSON 404 with CORS. Then
  Pages (run 37251420070, success; live `c/c.js` carries the Accept bar). Live settings: no
  deposit % saved (so 50%), bank details all set, **business email blank**.
  `SMTP_PASS` set the same day (boot log `[mail] connected`); the Settings test email arrived.
  **End-to-end run, live, 2026-10-05 (PVLSC01):** estimate emailed (sent, not late), opened,
  signed (role and typed name in the stored text, no gap left, 47 KB signed PDF stored), owner
  notice and client signed copy both sent, accepted with a 50% pair (`INV-PVLSC01-D` emailed and
  `sent`, due in 14 days; `-F` draft), the day Confirmed, activity sent → opened → signed →
  invoice_sent. Live public replies checked: the estimate carries `client.businessName` only, the
  invoice adds the ABN and the bank details; no owner-only field in either.

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

  **Code review (2026-10-05, xhigh, `86edf25^..464c43a`):** no owner-only figure reachable from
  `/public/*`, no double send, no replayable signature; `calc.js` and `documents.js` copies identical.
  15 findings, worked in this order (bucket per CLAUDE.md; **F** = frontend task):

  - [x] **C1. Client quote PDF was the old template** (money/print, Opus/high, **F**). Fixed with
    D103 (the client sees "Quote"): `buildQuoteHtml` headed `QUOTE <UPID>` via `invoiceHeadHtml`,
    the version's issue/valid-until dates (`public.js` `versionDates`, `quoteDates` for the owner's
    download: the live version while unedited, else today + Settings' valid-for days), Settings
    contact instead of the hard-coded footer, filename `Quote <UPID> - …`; "quote" on the client
    page, invoice pages/PDFs, client emails, fallback agreement, signed-agreement label,
    disclaimer (old frozen ones reworded on read), default email message. Owner screens and the
    Cost Breakdown keep "Estimate". 527 tests; mutations: valid-until dropped (2 fail), edited-since
    ignored (1), superseded ignored (1, after adding its case), old disclaimer kept (1). Browser:
    `c/#e` and `c/#i` on `api-scratch`, quote PDF read back. Not committed, not deployed.
  - [ ] **C2. Signing confirms the live days, but bills the signed version** (money, Opus/high).
  - [ ] **C3. Mark accepted bills an estimate edited after the version sent, unwarned** (money, Opus/high, **F**).
  - [ ] **C4. Mark paid on a draft leaves no issue date: undated tax invoice** (money, Opus/high).
  - [ ] **C5. Owner's "signed" email says days confirmed even when a clash was flagged** (backend, Sonnet/high).
  - [ ] **C6. Owner never told a sent quote's proposed date was taken** (Opus/high, **F**).
  - [ ] **C7. Blank `APP_URL` becomes `/`: `no_app_url` guard dead, relative links emailed** (backend, Sonnet/high).
  - [ ] **C8. Failed sends survive accept/paid/expiry and can be retried** (backend, Sonnet/high).
  - [ ] **C9. Void reason shown on the client's invoice page; dialog doesn't say so** (Opus/high, **F**).
  - [ ] **C10. Extras priced with today's GST settings, not the job's** (money, Opus/high).
  - [ ] **C11. No warning when editing an accepted, invoiced estimate** (Opus/high, **F**).
  - [ ] **C12. Signed copy greets/sends to the contact on file, not the signer** (backend, Sonnet/high).
  - [ ] **C13. Unused Stage D `/sent` routes keep weaker guards** (backend, Sonnet/high).
  - [ ] **C14. `sends.js` own `isYmd` accepts impossible due dates** (backend, Sonnet/high).
  - [ ] **C15. Owner previewing a copied link logs "client opened"** (backend, Sonnet/high).

## Not in this list (and why)

- **`estimate-accuracy` tasks 9, 10, 12–14** stay in that track and are un-grilled. When grilled,
  **10 (discount)** must say whether it applies before or after surcharges, and **12 (minimum
  call)** whether it applies per booked day.
- **The Client Hub integration** is out of scope (D53).
- **Post-production days on the calendar** (D97): a formula from the deliverables, deferred until
  after A–E by the user. Grill it then; `postPlan` is its input.
- **Removing the committed Delight `.woff2` from git history** is the user's call (D57), and a
  separate job.
