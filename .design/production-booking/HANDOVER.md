# Handover: Production Booking

Read this first, then [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) and [`DECISIONS.md`](DECISIONS.md) (the
user's answers, D1–D99; don't re-ask), then
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

Design is complete: Grill Me (D1–D99), `DESIGN_BRIEF.md`, `INFORMATION_ARCHITECTURE.md` (hash routes,
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
  calendar tiles and Coming up open the folder). 2026-10-04, **uncommitted, not deployed** (new
  routes: NAS before Pages, with v13 at task 23). Its decisions are in its Done note in `TASKS.md`.

**Exact next item: TASKS.md task 19, accepting and creating invoices** (money math, Opus/high).
Hooks waiting for it:
- `nextAction()` and `moreActions()` in `web/js/views/project-folder.js` are where "Mark
  accepted…" (sent, and draft if the owner skips Mark sent) and "Create invoices" (accepted, no
  invoices: a project v13 mapped from `approved`) go. Each action posts to
  `/api/projects/:id/<action>?today=` and redraws from the folder it answers with (`post()`), so
  `accept` and `invoices` should answer with `readFolder` as `sent`/`decline` do.
- The folder's Documents already list invoices (kind, number, status, `totals_json.totalIncGst`);
  task 20 gives each row its page and PDF.
- D18's "clash, rebook" flag has no column yet: when 19 adds one, show it on the folder's
  Production days rows first (IA).

`GET /api/clients/:id/estimates` is no longer used by the web; keep it until the D deploy (an old
cached Pages build still calls it), then delete it.

**Seams left for later tasks:**
- **Invoices (tasks 19–20):** store the deposit's `depositAmount(...)` result on the deposit invoice
  and pass that stored object to `finalInvoiceTotals`; don't recompute it from a % later. On the
  final's tax invoice, the GST for this supply is `balance.gst`, because the deposit's GST was
  already on its own tax invoice. Show `total` as the full job, then "Less deposit paid", then
  `balance`. Extras lines need price snapshots (`mu`) so later card changes don't move them.
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
- **Invoices on a waiting project (task 19):** the banner says invoicing waits for a UPID, and
  invoice numbers carry it, so refuse creating an invoice while `projects.needs_upid = 1`.
- **UPID lock (D36, task 19):** `planProjectWrite` (`projects.js`) lets the UPID change freely
  today. Once a project has a non-legacy invoice or a send, refuse a change there.
- **Accept (task 19)** sets `estimates.status` and `projects.accepted_at` together; estimate saves
  never touch the status. Decline and Reopen (task 18) already do this for theirs; Reopen clears
  `accepted_at` too, and Decline is refused once a non-void invoice exists.
- **Delete (task 18)** is refused while a non-legacy invoice is scheduled, sent or paid. Task 20's
  void action is the way out of that.
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
