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
      - D: 14–23 (migration v13, was v12 until B2 took v12 on 2026-10-03);
      - E: 24–32 (migration v14, was v13);
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

      - [x] **Task 4, the Rate Card blocks**: committed 2026-10-02 (`da2db86`).
        - **What exists now:** the Surcharges block (saved with the card), the Public holidays
          block (below the save bar, saves itself), an "On set" tag in place of Production's ×,
          and `DEFAULT_PRICING` with an `additional` section holding Overtime plus `surcharges`.
        - **Beyond the spec:** "+ Add Additional work" on any card without that section. It makes
          an empty section under id `additional`, which later stages should look up by id.
        - **Read task 4's Done note before task 6.** The 768–1099 `.bb-head` 660px floor in
          `responsive.css` catches any new `.billing-block` without a grid. The Booking block will
          meet the same thing.

      - [x] **Task 5, the month calendar component**: committed 2026-10-02 (`cbe5f07`).
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

      - [x] **Task 6, the editor's Production Booking block**: committed 2026-10-02 (`685ebbb`).
        - **What exists now:** `web/js/views/booking-block.js` and `web/css/booking.css`. The
          editor sends `days` on every save, blocks a save with a locked day, and handles the 409.
          `api.js` refusals carry `err.data`.
        - Its Done note has the block's API and the interpretations to show the user (TBC starts
          Proposed; a day booked first needs no note; the same date twice is allowed).
      - [x] **Task 7, production items on days, priced with surcharges**: committed 2026-10-02
        (`5261323`). Only `estimate-editor.js`, `booking-block.js` and `booking.css` changed;
        no server change, and `calc.js` is untouched (349/349).
        - **What exists now:** each day card holds its production lines and its own picker. The
          Production section lists the days, has "Add to a day ▾", and holds old lines under
          "Unassigned — pick a day". Live surcharged prices, "incl. weekend ×1.5" notes,
          "Surcharges +$X ⓘ", the short notice tick and hint, and D26's hours hint are all in.
        - **Verified to the cent against the server** on every worked example, all three modes,
          and the five task 1 mutations re-checked through the editor. Details are in TASKS.md
          task 7's Done note.
        - **The user confirmed all five interpretations on 2026-10-02**: the four in that Done note,
          and task 2's custom-bill line being surcharged on its custom amount.
      - [x] **Task 8, the estimate detail, the client PDF and the Cost Breakdown PDF**: committed
        2026-10-02 (`0d82f73`). The suite is 366/366.
        - **What exists now:**
          - `calc.js` `costBreakdown()`, the figures;
          - the client PDF's "Production Days" block, with folded prices and the proposed-days
            disclaimer;
          - `POST /api/estimates/:id/cost-breakdown`;
          - the detail's Production grouped by day, an "incl. Surcharges" total, and a
            "↓ Cost Breakdown" button.
        - **Bug fixed:** the PDF route never loaded the estimate's days.
        - **The user saw a sample Cost Breakdown and client PDF on 2026-10-02** and asked for the
          commit with no changes. That settles the attribution question below and the five
          interpretations in TASKS.md task 8's Done note.

      - [x] **Task 9, the A+B responsive and accessibility pass**: done 2026-10-02,
        **uncommitted**. Only `estimate-editor.js` and `booking.css` changed (366/366).
        - **Built:** a debounced, polite surcharge announcement (`#sur-live`, "Saturday 24
          October: weekend rate ×1.5 applied."), and the Short notice tick at 44px on phones.
        - **Measured and recorded** in TASKS.md task 9's Done note: layout at 1280/800/375, the
          add-day sheet, ≥44px targets, status words, the keyboard grid, reduced motion, focus
          rings, and nothing moved at 1280/800.
        - **Still for a person:** a real VoiceOver pass over the booking block, the add-day
          sheet and the detail's day groups.

      - [x] **Task 9a, the money review fixes**: done 2026-10-02, **uncommitted** (377/377).
        - **What changed:** a code and accounting review of the whole pipeline raised ten findings.
          The user decided D67–D72 for the ones that changed a rule:
          - after hours per item, over its own hours from the booked start;
          - after hours every day;
          - the next morning's office hours count as in-hours;
          - the hours after midnight take the next date's status, as a carry-over sub-line in the
            Cost Breakdown;
          - migration v11 moves Overtime off set;
          - short notice reaches items on no day.
        - **Also fixed:** the editor's holiday save guard, the Cost Breakdown refusing stale totals,
          qty-0 items, and the duplicate's message.
        - **Details** are in TASKS.md task 9a.
        - **Brief:** its surcharge maths and worked examples are updated (the 9–7 full day is now
          $1,120).

- [x] **Tasks 9 and 9a committed** (`6074c3e`) and **task 10 deployed 2026-10-02**: NAS at v11
      (v10 ran with it), Pages run 36971522863 success, `main` at `6074c3e`. Details in TASKS.md
      task 10's Done note. The live card had no Overtime row, so the v11 move was a no-op.
      **Still for the user:** check the Public holidays list, set the surcharge multipliers.

- [ ] **Stage B2, day-built estimates and the post-production planner** (added 2026-10-03, to be
      built **before** task 11, D73). It's going through the design flow:
      - [x] **Grill Me**: done 2026-10-03 (D73–D97 in `DECISIONS.md`).
      - [x] **Design brief**: done 2026-10-03 (the "Stage B2" section at the end of
            `DESIGN_BRIEF.md`). The user confirmed its six interpretations the same day (recorded
            under D99).
      - [x] **Information architecture**: done 2026-10-03 (the "Stage B2 addendum" at the end of
            `INFORMATION_ARCHITECTURE.md`, D98–D99). **B2 takes migration v12** (the `rentals`
            table), so Stage D is now v13 and E v14. TASKS.md, the IA and the `db.js` trap comment
            were renumbered. The tokens phase is skipped by choice.
      - [x] **Tasks**: done 2026-10-03. TASKS.md's "Stage B2" section has **B2-1 … B2-13**, between
            Stage A+B and Stage C, each tagged with its bucket. Task 12 gained rental bars, task 33's
            review covers B2, and D97 (post days on the calendar) is under "Not in this list".
      - [ ] **Build B2-1 → B2-13**, then deploy (NAS v12 before Pages).
        - [x] **B2-1, `postPlan` and the card shape**: done 2026-10-03, committed `33af089` (387/387).
          - **What exists now:** `calc.js` `postPlan`, and `PRICING_SHAPE` `'deliverable-types'`.
            `DEFAULT_PRICING.deliverableTypes` is `[]`. `PUT /api/pricing` checks `capture` and
            `deliverableTypes`. The Rate Card carries both through a save; there's no UI for them
            yet (B2-9).
          - **Read its Done note before B2-2 and B2-10.** It has three interpretations to show the
            user, two seams, and the mutations. In short: capture counts the hours a line bills;
            the fallback matches by row id, then name; untyped means no `typeId`.
          - **Not deployed, and it can't go alone:** the shape bump means Pages must follow NAS.
            It ships with B2-13.
        - [x] **B2-2, schema v12, rentals, and the server's line rules**: done 2026-10-03,
          **uncommitted** (396/396).
          - **What exists now:** migration v12 (`rentals`), `src/rentals.js`, `dayId` allowed on
            travel/crew/equip, the deliverable-tag checks, `rentals` on the estimate routes and
            `/api/calendar`, and the PDF printing Item and tags. `api-scratch` is at v12.
          - **Read its Done note before B2-4, B2-7 and B2-10.** It has every refusal code, four
            interpretations to show the user, and two seams. The main one: the editor has no
            wording for the new codes yet.

**Exact next item: TASKS.md B2-3, the Deliverables block moved, restyled and typed, and the Prices
bar moved** (frontend, Opus/high). After B2 is built and deployed, task 11, the hash router (Stage C; frontend,
Opus/high).

**Seams left for later tasks:**
- **Stage E's public pages:** `calc.js` `costBreakdown` and `pdf.js`'s `daysWithItems` are the
  two readers of a booked estimate. The client page lists days as the client PDF does, with
  stored prices, never `costBreakdown`'s figures. Its Cost Breakdown stays owner-only.
- **A VoiceOver pass by a person** (task 9 did everything short of it): the detail's day groups
  are `<tbody>` with a `scope="rowgroup"` head. Check how they read.
- **Holidays in the editor:** fetched once, the first time the estimate has a dated day. Until it
  arrives, or if it fails, new dates price as non-holidays. The server always prices with the real
  list on save, and the detail screen shows what was stored.
- **Status migration (task 15):** turn foreign keys off for the `estimates` rebuild, or the cascade
  deletes every production day. Also exclude declined estimates in `lockedDay` (`days.js`) and in
  `routes/calendar.js`.

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
