# Handover: Production Booking

Read this first, then [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) and [`DECISIONS.md`](DECISIONS.md) (the
user’s answers, D1–D100; don’t re-ask), then
[`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md) (routes, screens, data model). This track replaces
`estimate-accuracy` task 8 (expected booking rate, scrapped) and task 11 (loadings, superseded). It
sits on top of every earlier track, and those stay the authority for anything this one doesn't
overturn.

## What this is

The user asked for price adjustments that are simpler than a booking rate, and the request grew into
five stages. Build them in this order (decision 1):

- **A. Surcharges.** Short notice (a tick box), weekend/public holiday, and after hours. They apply
  to Production-section items only and never show to the client. A user-only Cost Breakdown
  explains them.
- **B. Production Booking** in the estimate editor. Booked days are cards (date or TBC, status,
  times, that day's production items) on a calendar shared across every estimate, with a warning or
  lock on clashes.
- **C. The home dashboard.** "LSC Creative" becomes a production calendar with month and week
  views, a Coming-up list and Recent activity.
- **D. Projects.** One per UPID, under its client, holding a deposit + final invoice pair with
  `INV-<UPID>-D` / `-F` numbering. It is first triggered by an in-app "client accepted" action.
- **E. Client pages.** A web page per sent estimate and invoice, a service agreement signed with a
  typed name and tick, scheduled email sending through Google Workspace, and Stripe card payment
  with the fee passed on.

A and B ship together, because the weekend/holiday and after-hours surcharges need booked dates and
times.

## State as of 2026-10-04

Design is complete: Grill Me (D1–D99, plus D100 at task 19), `DESIGN_BRIEF.md`, `INFORMATION_ARCHITECTURE.md` (hash routes,
"Projects" replaces "Estimates" in the nav, unique UPIDs, Settings as a screen), and `TASKS.md`
(33 tasks plus B2-1…B2-13). Migrations: v11 (A+B), v12 (B2 `rentals`), **v13 (Stage D)**, **v14 (E)**.

**Built and committed on branch `production-booking`:**
- **A+B, tasks 1–10** (surcharge maths, schema v11 days/holidays, holidays fetch, Rate Card
  Surcharges block, shared calendar `web/js/calendar.js`, editor Production Booking block, live
  surcharged pricing, estimate detail + client PDF + Cost Breakdown PDF, a11y pass, money review
  fixes D67–D72). **Deployed 2026-10-02** (NAS v11, Pages, `main` `6074c3e`).
- **B2, B2-1…B2-13** (`postPlan`, rentals v12, service menu and on-set kinds on day cards, drag/Move
  to/Duplicate day, "On set, by day" summaries, gear rentals, rental bars, Rate Card Capture tick and
  Deliverable Types, post-production planner, surcharge box, a11y pass). **Deployed 2026-10-03**
  (NAS v12, then Pages, `main` `930249c`). The user still needs to tick Capture on real services and
  add Deliverable Types on the Rate Card.
- **C, tasks 11–13** (hash router `web/js/router.js`, Home calendar dashboard, deploy). **Live
  2026-10-03** (Pages only, `main` `7910c53`). The user skipped the VoiceOver pass on Home.
- **Stage C code-review fixes, 2026-10-03, committed `ff3f8fa`, not deployed** (Pages only, no server
  change). The router also listens to `popstate`, so Back between two entries with the same
  address (left by a replace: a deleted client's entry becoming the list, or a bad address
  becoming Home) keeps its index in step. Before this, a refused Back could undo by the wrong
  distance, and a `leaveTo()` could leave its skipped guard set. Estimate and client routes that
  fetch now show "Loading…" at once, so the screen being left can't take edits after the guard
  has asked. Home checks the router's ticket and no longer has its own `visit` counter, so a late
  401 after leaving Home is dropped. Coming up reuses the month's reply when it covers the next 14
  days, so a visit makes one fetch. Week tiles stop at midnight. `STATUS_WORD`, `MONTHS`,
  `DAY_SHORT` and `upidOf` are exported from `calendar.js`. Checked in the browser against
  `api-scratch`.

Per-task detail (shapes, error codes, mutation lists, verification logs) was removed from here and
`TASKS.md` to save tokens: the code and tests are the record, and
`git log -p -- .design/production-booking/` has the old text. Commits are named
`Production booking: <task>`.

- **D, task 14** (invoice maths in `calc.js`: `depositAmount`, `extrasTotals`,
  `finalInvoiceTotals`, `singleInvoiceTotals`; `accepted` counts as won). 2026-10-03, committed `bd85aa9`,
  nothing to deploy alone. See its Done note in `TASKS.md`.

- **D, task 15** (schema v13: `projects`, the draft/sent/accepted/declined rebuild, `invoices`
  with legacy ones, `activity`; the estimate routes keep the UPID on the project and refuse
  `upid_taken`; declined estimates leave the calendar and the lock). 2026-10-03, **not deployed**
  (NAS v13 ships with task 23). Its decisions are in its Done note in `TASKS.md`.

- **D, task 16** (the UPID fix-up `#/setup/upids` with `GET/POST /api/setup/upids`, the list
  banner, Duplicate into the copy's editor). 2026-10-03, committed `ad63ac0`, **not deployed** (ships
  with v13 at task 23). Its decisions are in its Done note in `TASKS.md`. The `api-scratch` DB is now
  v13, with every group settled and one duplicate (`B28-COPY`).

- **D, task 17** (the Projects list: `GET /api/projects`, `#/projects` with stage chips and search
  in the address, one stage-line function, the client's projects as the same cards).
  2026-10-04, committed `4cd0ed4`, **not deployed** (a new route: NAS before Pages, with v13 at
  task 23). The `api-scratch` DB has a project at every stage (sent with valid-until, expired,
  overdue deposit, deposit paid, single sent, legacy, paid, declined).

- **D, task 18** (the project folder `#/projects/<id>`: `GET /api/projects/:id`, Mark sent,
  Decline, Reopen with the clash check, Delete; the editor and a read-only view under
  `…/estimate`; D62's doc-type controls gone from the editor and no longer written by the server;
  calendar tiles and Coming up open the folder). 2026-10-04, committed `c278225`, **not deployed**
  (new routes: NAS before Pages, with v13 at task 23). Its decisions are in its Done note in
  `TASKS.md`.

- **D, task 19** (`POST /api/projects/:id/accept` and `/invoices`: one transaction confirms the
  days and flags clashes, makes the pair or single invoice from the stored totals, copies the
  deposit %; the UPID lock; the folder's Mark accepted… / Create invoices… dialog).
  2026-10-04, committed, **not deployed** (with v13 at task 23). Its decisions are in its Done
  note in `TASKS.md`. `production_days.rebook` went into v13 (undeployed), so the `api-scratch` DB
  was rewound to v12 and re-migrated; a backup of it from before is in this session's scratchpad
  only. Scratch now has AUD-B accepted as a 40% pair with 16 Oct flagged (against a hand-added
  confirmed day `d_t19_scratch` on B210-PLAN) and TST-001 as a single invoice.

- **D, task 20** (the invoice screen `#/projects/<id>/invoices/<invoiceId>`, deposit / final /
  single PDFs and per-invoice Cost Breakdowns, Mark sent, Mark paid, void and remake). 2026-10-04,
  committed, **not deployed** (new routes and v13 columns: NAS before Pages, with v13 at task 23).
  Its decisions are in its Done note in `TASKS.md`. `invoices.voided_at`, `void_reason` and
  `replaces_id` went into v13 (undeployed); the `api-scratch` DB got them by `ALTER TABLE` (a
  backup from before is in this session's scratchpad only). Scratch now has AUD-B with D void, D2
  paid at 50%, and F a draft with 2 hrs of Overtime ($6,233.50 due).

- **D, task 21** (Settings as a screen, `#/settings[/<section>]`; deposit %, valid-for days,
  due-after days, the four messages, the service agreement with fill-in fields and "Preview with a
  project…", the FAQ URL; Email and Card payments "Not set up yet"). 2026-10-04, committed, **not
  deployed**. New `server/src/documents.js` (= `web/js/documents.js`, drift-tested), which
  `routes/projects.js` now requires, so the NAS needs it before Pages (it ships with v13 at task
  23). Its decisions are in its Done note in `TASKS.md`. The `api-scratch` settings row now holds
  a full business/payment set, GST registered at 7% inclusive, and 40% / 21 days / 7 days (no
  agreement text); the row from before is in this session's scratchpad only.

- **D, task 22** (Recent activity on Home: `GET /api/activity`, `ProjectCard.activityText` shared
  with the folder). 2026-10-04, committed, **not deployed** (a new route: NAS before Pages, with v13
  at task 23). Its decisions are in its Done note in `TASKS.md`.

- **D, task 23 polish** (a11y + responsive pass on Projects, the folder, invoice, Settings, fix-up
  and their dialogs). 2026-10-04, committed, frontend only. New `LSCUtil.landFocus(root)` puts
  focus on the new screen's `h1` when the old screen took it; dialog danger buttons lifted in
  `a11y.css`. See its note in `TASKS.md`.

**Task 23 deployed 2026-10-04** (`main` `2c7131b`). NAS first (backup `pre-v13-20261004-134122.db` in
`data/exports` and `manual-backup`; dry run clean; code copied by tar over `ssh lsc-nas`, excluding
`.env`, `data`, `docker-compose.yml`; boot log `v13: 1 project(s), 0 need a UPID`; `/api/projects`
401 not 404), then Pages. No UPID fix-up is needed. rsync to the NAS is refused; use tar over ssh.

**Stage E inputs (2026-10-04):** card payment is **held** (D101): skip task 31 and the card parts
of 32. The service agreement came as `LSC-Service-Agreement-Template.pdf`. `LSC-Service-Agreement.txt`
(both gitignored: personal details, public repo) is a Settings-ready draft that uses the existing
fields, with "Quote" renamed to "Estimate" (D30), the fixed 50% replaced by `{deposit_pct}`, and the
per-project scope boxes and signature block dropped (the Estimate and the signing dialog cover
those). The user confirmed the GST sentence (still not registered). Commit `6764113` (not deployed) added
fields `client_email`, `client_phone`, `signatory_role` (typed at signing, task 27 passes it),
`deposit_amount`, `balance_amount` (the caller passes calc.js `depositAmount` / `finalInvoiceTotals`
figures; `documents.js` stays free of money maths) and `due_days`. The draft uses them. A
single-invoice project prints "Deposit (): ," (no conditional text yet). **In live Settings since 2026-10-04** (written over SSH;
backup `data/exports/pre-agreement-20261004.db`). Until `6764113` is deployed (NAS then Pages), the
six new fields read as "not a field" in the live preview. The SMTP password is **not**
set: the one supplied matched the app login, not a 16-letter Google app password, and the sending
address isn't known yet.

**Exact next item: stage E (v14), TASKS.md task 24.** Check the "Inputs needed from the user" list first.
The user should also try the live site once (sign in, open a project).

`GET /api/clients/:id/estimates` is no longer used by the web; the D deploy is done, so delete it
(task 24 housekeeping).

**Seams left for later tasks:**
- **Stage E reads its settings through `documents.js`:** `docSettings(settings)` for the
  messages (send panel), `validDays` (send), `faqUrl` ('' hides the button) and the agreement
  text; signing fills the text with `agreementValues` + `fillAgreement` from the frozen version
  (its client snapshot, stored `totalIncGst`, days) and stores the result (D39). That is the same
  call the Settings preview makes, so the two can't differ. Card payments' surcharge % (D49) and
  Email's status/test button go into the two "Not set up yet" sections.
- **Stage E's public pages:** `calc.js` `costBreakdown` and `pdf.js`'s `daysWithItems` are the
  two readers of a booked estimate. The client page lists days as the client PDF does, with
  stored prices, never `costBreakdown`'s figures. Its Cost Breakdown stays owner-only.
- **A VoiceOver pass by a person** (tasks 9 and B2-12 did everything short of it; skipped for Home
  by the user at task 13): the detail's
  day groups are `<tbody>` with a `scope="rowgroup"` head. Check how they read. B2-12's Done
  note lists the B2 parts to hear; one of them is whether a silently added gear rental is
  missed.
- **Holidays in the editor:** fetched once, the first time the estimate has a dated day. Until it
  arrives, or if it fails, new dates price as non-holidays. The server always prices with the real
  list on save, and the detail screen shows what was stored.
- **Any later rebuild of `estimates` or `projects`:** flag the migration `foreignKeysOff: true`
  (`db.js`). `production_days`, `rentals` and `invoices` hang off `estimates`; estimates,
  invoices and activity hang off `projects`.
- **Before deploying v13 (task 23):** run the migration on a copy of the live backup first. Its
  `foreign_key_check` refuses the whole migration (and the boot) if the live DB already holds a row
  pointing at nothing. The boot log line `[db] v13: N project(s) … M need a UPID …` gives the fix-up
  count.
- **Stage E's accept** (the client page's Sign) should call the same pieces as task 19's route:
  `confirmDays`, `createInvoices` and the `accepted` activity, inside its signing transaction. D41
  pauses it while a proposed day is taken, which the in-app accept doesn't check.
- **The invoice snapshot is owner-only:** `estimate_snapshot_json` is the whole estimate, including
  its `totals` with internal figures. A public invoice page (E) must print from it through the
  client PDF's fields, never send it whole.
- **Stage E's client events** (opened, signed, paid by card) go into `HOME_KINDS`
  (`routes/projects.js`) to reach Home, and get a case in `ProjectCard.activityText`.
- **Stage E's send panel** replaces both Mark sents (estimate and invoice). An invoice's public page
  prints through `pdf.js` `buildInvoiceDocHtml`'s fields, never `invoiceJson` whole (its `estimate`
  is the owner-only snapshot).
- **Delete (task 18)** is refused while a non-legacy invoice is scheduled, sent or paid, and so is
  deleting that project's billed or last estimate in the editor (task 19). Voiding (task 20) leaves
  a draft replacement, so a project whose only sent invoice is voided can be deleted again.
- **A paid invoice can't be un-marked** (D100: corrected by a credit note, not built).
- **Stage E's sends:** Stage D's Mark sent logs `sent` with `{ validUntil, estimateId }` and **no
  version** (nothing is frozen, D34). E's versions should write `version` on the same activity
  kind, which the stage line already reads ("Sent v2").

**For review at task 8 (Cost Breakdown); settled 2026-10-02, the user approved the sample:** how attribution splits money between surcharges is an
implementation choice, not a user decision. For example, under "multiply", after hours is charged
on the weekend price. The totals are fixed by the brief; only the row labels depend on it. Show the
user one Cost Breakdown before calling it done.

## Things a fresh agent will want to argue with

- **Surcharges are hidden from the client** (decision 8). That's deliberate: the price is folded into
  each item and rounded up to the dollar, and the reasons live in the Cost Breakdown.
- **"Estimate" is the only name** (30). There's no "quote" object. A sent estimate is a frozen
  version (34).
- **Only the section with id `prod` is on set** (24), whatever it's called, and it becomes
  undeletable. The user turned down a per-section flag.
- **A confirmed day locks the whole date**, but a required note overrides it (16), because a
  subcontractor may shoot the second job.
- **Accept is paused, not flagged, when a proposed date is taken** (41). This narrows decision 18
  for the client page.
- **The card fee is always passed on** (49), capped by law at the cost of acceptance, so it's a %
  setting.
- **The security bar is low by choice** (root `CLAUDE.md`). Client pages are public by unguessable
  link. Don't re-raise it, but keep internal figures (floors, tax set-aside, take-home, the Cost
  Breakdown) off every public route.

## Money rules that carry over (from the codebase, not re-decided)

- Surcharges are income: taxed, no extra hours, and no change to the floors or Minimum Job Price.
- Saved estimates never move. Lines snapshot their surcharged price. The estimate snapshots the
  multipliers, the stacking mode and each day's weekend/holiday status.
- `calc.js` is two byte-identical copies. Any surcharge maths lives there, with worked-example
  tests, and mutations are checked.

## How to verify your work

As for the earlier tracks: `npm test` in `server/`; the `calc.js` drift test; for money maths, break
the line and confirm a test fails. Anything a person sees is checked in the browser against
`api-scratch` at 1280 / 800 / 375.
