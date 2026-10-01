# Handover: Production Booking

Read this first, then [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) and [`DECISIONS.md`](DECISIONS.md) (the
user's answers, D1–D66; don't re-ask), then
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

## State as of 2026-09-30

- [x] Request captured, then folded into the brief (the raw `REQUEST.md` was deleted 2026-09-30).
- [x] **Grill Me**: done 2026-09-30 across all five stages (D1–D52).
- [x] **Design brief**: done 2026-09-30 (`DESIGN_BRIEF.md`), adding D53–D56 on the client pages'
      look, voice, FAQ and the Client Hub. It fixes the surcharge maths (a three-mode table, plus
      worked examples for tests) and one **interpretation flagged for the user**: office hours
      define after hours on every day, so a weekend evening is both weekend and after hours (it
      only matters under "All multiply").
- [x] **Inputs received 2026-10-01**:
      - the FAQ is live at https://lsccreative.studio/faq.html (D55, now the default FAQ URL);
      - the brand fonts are in the git-ignored `Visual Design/` (D57). Copy only the `.woff2` a page
        loads.
      Still to come from the user: the service agreement text, the Google app password, and the
      Stripe account.
- [x] **Information architecture**: done 2026-10-02 (`INFORMATION_ARCHITECTURE.md`, D58–D66).
      - **Navigation:** Projects replaces Estimates in the nav; Settings becomes a screen.
      - **Routing:** the app gets hash routes, reversing the old "no router" stance.
      - **UPIDs:** they become unique; Duplicate starts a new project; a one-off fix-up screen
        handles shared or blank UPIDs.
      - **Editor:** the Document Type switch is retired.
      - **Day statuses:** Confirmed / Pencilled / Proposed.
      - **Data model per stage** (migrations v11–v13): production days and holidays (A+B);
        projects, invoices and activity (D); versions, sends, signatures and payments (E).
      - **Public routes:** `/public/*` and `/hooks/stripe` sit before `requireAuth`, behind a
        dedicated serializer.
      - **Two code findings:** status is never set in the UI, so live estimates are all `draft`;
        and backups cover only the database, so signed PDFs go in the database (D66).
- [x] **Tasks**: done 2026-10-02 (`TASKS.md`), 33 tasks, each tagged with its bucket:
      - A+B: 1–10 (migration v11);
      - C: 11–13;
      - D: 14–23 (migration v12);
      - E: 24–32 (migration v13);
      - review: 33.
- [ ] **Build A → E.** In progress on branch `production-booking`. It was branched 2026-10-02 from
      `estimate-accuracy` at `e83533a`, where that track's work through v10 is committed but **not
      deployed**. v10 deploys before v11.
      - [x] **Task 1, the surcharge maths**: done and committed 2026-10-02 (`86edf25`).
        - Pure functions in both `calc.js` copies.
        - The settings, day and attribution shapes it chose are in TASKS.md task 1's Done note.
      - [x] **Task 2, schema v11 with days on the server**: done 2026-10-02, committed `a571c67`.
        - **What exists now:** migration v11, surcharged `computeTotals`, the estimate routes
          taking `days`, the clash lock, and `GET /api/calendar`. `PRICING_SHAPE` is
          `'production-days'`.
        - **Not deployed.** Ship it with the rest of A+B (task 10): NAS before Pages, and v10
          first.
        - **Read task 2's Done note before tasks 6, 7 and 15.** It lists the write rules, error
          codes and snapshot behaviour they build on.

      - [x] **Task 3, public holidays**: done and committed 2026-10-02 (`a7c1dc7`).
        - **What exists now:** `GET /api/holidays`, `POST /api/holidays/fetch`, `PUT` and `DELETE
          /api/holidays/:date`, and a non-blocking boot top-up from Nager.Date.
        - **Read task 3's Done note before task 4.** It has the response shapes, the tombstone
          rule and the one schema change (`holidays.fetched_at`, amended inside v11).
        - **A dev DB already at v11** needs `DELETE FROM schema_version WHERE version >= 11` and a
          restart to gain that column. `api-scratch` was done and now holds 22 fetched dates plus
          a hand-added NSW Bank Holiday (2026-08-03).

      - [x] **Task 4, the Rate Card blocks**: done 2026-10-02, **uncommitted**.
        - **What exists now:** the Surcharges block (saved with the card), the Public holidays
          block (below the save bar, saves itself), an "On set" tag in place of Production's ×,
          and `DEFAULT_PRICING` with an `additional` section holding Overtime plus `surcharges`.
        - **Beyond the spec:** "+ Add Additional work" on any card without that section. It makes
          an empty section under id `additional`, which later stages should look up by id.
        - **Read task 4's Done note before task 6.** The 768–1099 `.bb-head` 660px floor in
          `responsive.css` catches any new `.billing-block` without a grid. The Booking block will
          meet the same thing.

      - [x] **Task 4** committed 2026-10-02 (`da2db86`).
      - [x] **Task 5, the month calendar component**: done 2026-10-02, **uncommitted**.
        - **What exists now:** `LSCCalendar.mount()` in `web/js/calendar.js` with
          `web/css/calendar.css`, both loaded by `index.html` but not mounted anywhere yet. There's
          also a shared `LSCCalendar.statusChip()` for the day cards and Coming up.
        - **Read task 5's Done note before tasks 6 and 12.** It gives the API, the callbacks'
          `{ trigger }` for `Modal`, and the interpretations to show the user:
          - tiles aren't tab stops, because a list of the selected date's bookings under the grid
            is the keyboard and phone route;
          - "quarter tile" is read as half width × half height;
          - faded is an outline, not opacity;
          - tiles vs dots goes by the calendar's own width.

      - [x] **Task 5** committed 2026-10-02 (`cbe5f07`).
      - [x] **Task 6, the editor's Production Booking block**: done 2026-10-02, **uncommitted**.
        - **What exists now:** `web/js/views/booking-block.js` and `web/css/booking.css`. The
          editor sends `days` on every save, blocks a save with a locked day, and handles the 409.
          `api.js` refusals carry `err.data`.
        - **Read task 6's Done note before task 7.** It has the block's API and the interpretations
          to show the user (TBC starts Proposed; a day booked first needs no note; the same date
          twice is allowed).
        - **Task 7 hooks in at two points.** Production lines need a `dayId` from these cards, and
          `onChange` already calls `recalc`. The remove confirm already says items go with the day.

**Exact next item: TASKS.md task 7, production items on days, priced with surcharges** (**money
math, Opus/high**). Commit task 6 first.

**Seams left for later tasks:**
- **Holidays (task 7):** the `GET` returns hidden rows too, flagged. The Rate Card list filters on
  `!hidden` (done, task 4); the editor must pass the whole list to `surchargeSnapshot`, as the server
  does. Nothing caches the list in `LSCData` yet: the Rate Card loads it itself.
- **Short notice hint (task 7):** read `card.surcharges.shortNoticeHintDays` through
  `LSCCalc.surchargeSettings(card)`, as the Rate Card does, so a pre-v11 card still gets 7.
- **Editor (tasks 6 and 7):** `collect()` must send `days` and `shortNotice`, and day ids are made
  in the browser.
  - For live pricing, build `surchargeSnapshot(days, card, holidays, { surcharges:
    estimate.surcharges, days: estimate.days })`, or `null` for a new estimate. Pass `{ days,
    surcharges, shortNotice }` to `computeTotals`, and the totals then match the server to the
    cent.
  - "Update to current rates" should also send `refreshSurcharges: true`.
  - Handle the 409 `date_locked` and its message.
- **Status migration (task 15):** turn foreign keys off for the `estimates` rebuild, or the cascade
  deletes every production day. Also exclude declined estimates in `lockedDay` (`days.js`) and in
  `routes/calendar.js`.

**For review at task 8 (Cost Breakdown):** how attribution splits money between surcharges is an
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
