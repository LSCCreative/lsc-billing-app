# Design Brief: Production Booking

Date: 30 September 2026. Written from the user's request of the same day, their 66 answers in
[`DECISIONS.md`](DECISIONS.md) (cited below as **D1–D72**; don't re-ask any of them; D67–D72 revised the surcharge maths on 2026-10-02), and the
codebase. This track replaces `estimate-accuracy` task 8 (booking rate, scrapped) and task 11
(loadings, superseded). Earlier tracks remain the authority for anything not overturned here.

**Five stages, built in order (D1):** **A** surcharges, **B** Production Booking in the editor
(A and B ship together), **C** the home dashboard, **D** projects and the deposit/final invoice
pair, **E** client pages, signing, sending and payment. Each stage must be usable on its own.
**Stage B2** (day-built estimates and the post-production planner, D73–D97) was added on
2026-10-03, to be built after A+B and before C. Its section is at the end of this file.

## Problem

A solo video-production business prices every job off one flat rate card. That leaves three gaps.

**Awkward jobs pay the same as easy ones.** A shoot booked two days out, on a Saturday, running
until 9pm, earns exactly what a Tuesday booked a month ahead earns. The only way to charge more is to
remember to type over prices by hand.

**Dates live nowhere.** An estimate has one "Date" field and no times. Which days are locked in,
which are held for a client who hasn't said yes, and which were floated in a quote are kept in the
owner's head. Nothing stops two jobs landing on one day.

**Winning a job is a chain of manual steps.** Export a PDF, attach it to an email, wait, chase a
yes, hand-build a deposit invoice, remember to send the final one after delivery. The client has
no clear way to say yes and sign, and nothing records what they agreed to.

## Solution

The owner builds an estimate as today, but a job's on-set work now lives on **booked days**. Each
day has a date (or "Date TBC"), a status (confirmed, pencilled or proposed) and optional start and
end times. All days sit on one calendar shared by every estimate, so a clash shows up the moment a
date is picked.

**Weekends, NSW public holidays, time outside office hours and short notice raise the price of that
day's production work automatically.** The multipliers are the owner's own, set on the Rate Card.
The client sees clean, higher item prices with no "surcharge" wording. The owner keeps a Cost
Breakdown that explains every dollar, ready to forward if a client asks.

The app opens on a **production calendar**, so the week ahead is the first thing the owner sees.

When the estimate is ready, the owner **sends a link** from their own email, scheduled or right
away. The client reads it on a clean, light, on-brand page, accepts it, reads and signs the
service agreement with a typed name, and is done. Signing:

- confirms the dates on the calendar;
- saves the signed agreement to the NAS;
- emails the owner;
- lays out a deposit invoice and a final invoice in the project folder, ready to send.

## Experience Principles

1. **The client sees a price; the owner sees the reasons.** Surcharges fold into item prices on
   everything a client can see (D8, D12). Every reason lives in the owner's Cost Breakdown (D13) and
   in the editor. Never put an internal figure on a public page, and never leave the owner
   guessing why a figure moved.
2. **Nothing leaves without the owner pressing a button.** Signing creates documents; it never
   sends them (D43). Every email is confirmed, or scheduled and still cancellable (D47). The app
   warns about clashes rather than deciding (D15), and locks only what the owner has confirmed
   (D16).
3. **Frozen once sent.** A sent estimate is a version (D34). A signed agreement stores its exact text
   (D39). A saved line keeps its price. The calendar can change around a quote, but what a client
   agreed to never changes underneath them.

## Aesthetic Direction

There are **two surfaces with two looks**. Don't let either leak into the other.

**The app (owner-facing): the existing dark editorial system, extended, not restyled.**

- **Tone**: calm and authoritative. It's a production office: dates, times and money, few words.
- **Reference points**: the Estimates card grid (`.proj-card`, its accent underline on hover), the
  editor's `.billing-block` collapsible sections, and the Finance rail. The calendar should feel
  like a call sheet or a production board: a quiet grid, with tiles carrying a UPID and a
  project name.
- **Anti-references**: Google Calendar's bright rounded blobs; a SaaS scheduling app; any drag-to-
  resize time-block editor. Surcharges shown as red "warning" badges.
- **The Desktop Preservation Law holds**: at ≥1100px every existing screen stays pixel-identical,
  except for the new sections and states this brief adds.

**Client pages (estimate, invoice, signing): light, in the owner's site colours (D50, D54).**

- **Philosophy**: *Swiss / editorial document.* A printed quote, set well, on warm paper. A strict
  single-column reading measure, rules as structure, figures aligned in a tabular column, one
  accent. It echoes the PDF (white page, black rules, terra accent) and the site's tokens, not
  its dark cinematic look.
- **Tone**: plain and warm, in the studio's voice, "we" (D56). Confident, never salesy.
- **Reference points**: the existing PDF layout (`server/src/pdf.js`), the site's light token
  `--lsc-surface-lt`, and a well-designed restaurant or gallery invoice.
- **Anti-references**: DocuSign's yellow tabs; a checkout funnel; the site's dark loading-screen
  drama; anything that looks like a template from an invoicing SaaS.

## Existing Patterns

**App** (`web/css/app.css`, ported verbatim; additive files after it):

- **Typography**: Delight (400/700, `web/fonts/`) for titles and big figures; Funnel Sans (variable,
  300–800) for everything else at 13px base. Labels are 10–11px uppercase with 0.08–0.1em
  tracking.
- **Colors**: `--bg #181818`, `--surface #2C2F35`, `--border #3D4A5C`, `--text #F0EDE8`,
  `--accent #B85444` (fills and borders only), `--accent-text #c1695a` (accent as text),
  `--muted rgba(240,237,232,.6)`, `--ok #6fcf6f` (the Take-Home green).
- **Spacing**: `#main` max 1080px, padding 34px 40px; blocks 12–14px apart; field gap 6px.
- **Breakpoints**: ≥1100 desktop (preserved); 768–1099 tablet; <768 phone (`responsive.css`).
- **Components**: `.btn` / `.btn-accent` / `.btn-ghost` / `-sm` / `-xs`, `.field`,
  `.form-grid`, `.billing-block` + `.bb-head.collapsible`, `.proj-card`, `.tag`, `.empty-state`,
  `Modal` (the shared focus trap in `web/js/modal.js`), `Info` (the ⓘ disclosure,
  `web/js/info.js`), `Toast` (role=status), `Unsaved` (native confirm + beforeunload),
  `ClientTypeahead`, the connection banner, the Finance rail, and `LSCUtil.showFieldErrors`.

**Client pages** (new, from the site `lsccreative.studio`'s own tokens):

- **Colors**: `--lsc-white #F0EDE8` (page), `--lsc-surface-lt #E8E2D9` (panels),
  `--lsc-black #0E0E0E` (text), `--lsc-mid #7A7470` (secondary text, checked for contrast before
  use), `--lsc-terra #C0603C` (accent fill and rules), `--lsc-terra-dk #8C4832` (accent as text on
  paper). Contrast is checked at build time; swap tokens if one fails.
- **Type**: Delight for headings and the total; CS Felice Mono (Regular; Italic is available) for
  labels, dates and figures (D54, D57), with Funnel Sans and tabular numerals as the fallback.
  Font masters sit in the git-ignored `Visual Design/`; only the loaded `.woff2` is copied into
  `web/fonts/` (D57: the repo is public and the Delight licence forbids redistribution).
- **Radii**: the site uses 8 / 16 / 24px. Client pages use 8px on panels and buttons only.
- **Wordmark**: "LSC *Creative*." as on the site and the PDF: "LSC" in black, "Creative." in terra.

**Money model** (`calc.js`, two byte-identical copies). `computeTotals` prices lines from
snapshots. `PRICING_SHAPE` (now `'travel-km'`) plus `cardShapeOutdated` guard old builds. The
estimate `status` set today is draft / sent / approved / invoiced / paid, and `doc_type` is
estimate | invoice.

## Component Inventory

| Component | Status | Notes |
|---|---|---|
| Rate Card → **Surcharges** block | New | Below the existing tables. Short notice ×, hint days; weekend/holiday ×; after hours ×, office start/end, working weekdays; stacking mode (3 options, D2); holiday list |
| Holiday list | New | Fetched national + NSW (D6, D7); rows: date, name, source (fetched / added); add, remove; "Fetch again" |
| Rate Card → **Additional work** section | New (default) | A new default labour section holding Overtime; not on set (D14, D24). `prod` becomes undeletable |
| Editor → **Short notice** tick | New | In the doc-type bar area, with the hint "First shoot day is in N days — short notice?" (D19) |
| Editor → **Production Booking** block | New | A `.billing-block` with a collapsible head, below the doc-type bar, above the rates bar. Its collapsed head summarises: "3 days · 2 confirmed · 1 proposed · Fri 3 – Sun 5 Oct" |
| Month calendar | New, shared | Used in the editor (this estimate at full strength, others faded, D23) and on Home. Has a date search ("Go to date" jumps to that month and highlights the date) |
| Add-day pop-up | New | Opens over the calendar on a date click: [+ Confirmed day] green, [+ Pencilled day] yellow, [+ Proposed day] grey (D63) |
| Day card | New | Date or "Date TBC", status chip, start/end time, that day's production items (the existing labour line UI, scoped to `prod`), "Booked 12 hrs, items cover 8" hint (D26), clash warning or lock with override note (D15, D16) |
| Production section in the editor | Modify | For `prod` it's built from the day cards (D4); other sections unchanged |
| Estimate line price | Modify | A production line shows its surcharged price, with a small muted note, e.g. "incl. weekend ×1.5", owner-side only |
| **Cost Breakdown** | New | A downloadable PDF, `Cost Breakdown_<UPID>_<ProjectName>.pdf`, client-safe (D13). One per sent version and per invoice |
| **Home** (the "LSC Creative" tab) | New | Month/week calendar, "Coming up" (14 days), "Recent activity" (D27, D52). The app lands here after sign-in |
| Day tile | New | Full tile for confirmed/pencilled, quarter tile for proposed. Shows UPID + project name |
| Tile pop-up | New | UPID, project name, business, times, production items → "Open project" (D28) |
| **Projects** list (replaces Estimates in the nav, D58) | Modify | One card per UPID with a stage line; search + stage chips |
| **Project folder** | New | One per UPID, under its client (D31). Holds estimate versions, Cost Breakdowns, deposit/final (or single) invoices, the signed agreement, and a send log |
| Estimate status | Modify | Becomes draft / sent / accepted / declined (IA); adds **Declined** (owner-only, D22) and an "expired" state derived from valid-until (D44) |
| Invoice pair | New | `INV-<UPID>-D` summary deposit (D37); `INV-<UPID>-F` full job + extras − deposit (D35); `INV-<UPID>` single (D32, D36) |
| **Send panel** | New | Per estimate or invoice: send date/time, pre-filled message, "Confirm to send", "Copy link"; shows scheduled / sent / sent late / cancelled (D43, D47) |
| **Settings screen** (was the Invoice Settings pop-up, D65) | Modify | Deposit % (D33), valid-for days (D44), agreement text with fill-in fields (D39), default messages per document type, FAQ URL (D55, default https://lsccreative.studio/faq.html), Google app password status, Stripe keys status, card surcharge % (D49) |
| **Client estimate page** | New | Public, no login, light (D53, D54): items by day with the status words Confirmed / Pencilled / Proposed (D63), the proposed-days disclaimer, totals, valid-until, Accept |
| **Signing dialog** | New | Agreement text in a scroll box, FAQ button (opens lsccreative.studio/faq.html), full name, role, "I agree" tick, Sign & submit (D40) |
| **Client invoice page** | New | The invoice, Download PDF, bank details, "Pay by card" (Stripe, fee shown first), Paid state (D46, D48, D49) |
| Emails | New | Link-to-client, accepted-to-owner, signed-copy-to-client; plain, branded, text-first |

## Key Interactions

### 1. Surcharge maths (money math, pin with tests)

These rules apply to production items only (the `prod` section, D3, D24). Pass-throughs, other
sections and Additional work are never surcharged. *Revised 2026-10-02 after a money review
(D67–D72): the rates are worked out per item, over the hours it covers.* For each production item
on a **dated** day:

- **w**: the weekend/holiday multiplier if the date is not a working weekday (the "working
  weekdays" setting, default Mon–Fri) or is on the holiday list; otherwise 1.
- **The item's window** (D67): from the booked start, for the item's own hours (qty × hours per
  unit), never past the booked end. A full day booked 9am–9pm covers 9am–5pm; the rest of the
  booking carries no rate (it's Overtime's to bill). With no times there is no window.
- **s**: the after-hours share of the item's window, outside office start–end. Office hours apply on
  **every** day (D68), and on the next date too, so an overnight shoot's hours inside the next
  morning's office hours are in-hours (D69). 0 with no times.
- **Overnight** (D70): an end before the start runs past midnight. The hours after midnight take
  the **next date's** weekend/holiday status: the window splits at midnight, each part with its own
  w. Where the status changes, those hours are a **carry-over**, shown as their own sub-line in the
  Cost Breakdown.
- **A**: the after-hours multiplier. **S**: the short-notice multiplier if the tick is on, else 1.

| Mode (D2) | In-hours part | After-hours part |
|---|---|---|
| Higher wins, short notice on top (default) | S × w | S × max(w, A) |
| All multiply | S × w | S × w × A |
| Only the highest | max(S, w) | max(S, w, A) |

Item factor = Σ over the window's parts (in or out of office hours, on each date) of the part's
share × its column above, with w that part's own date's. The client price of the line is
`ceil(base × factor)` to the whole dollar, applied once per line after all surcharges (D20). A
**Date TBC** day has w = 1 and s = 0, but short notice still applies (D9), and it applies to a
production item on no day too (D72). The surcharge is
**income**: taxed, no extra hours, and no change to the floors or Minimum Job Price. Each line
snapshots its surcharged price, and the estimate snapshots the multipliers, the mode, the office
hours, each day's weekend/holiday status and, for an overnight day, the next date's, so a later
Rate Card or holiday-list change moves only new estimates.

**The Cost Breakdown's surcharge amounts add up to the cent** to the difference between the
rounded client price and the base price. The rounding lands on the last surcharge row for that line.

Worked examples for the tests, on the default card (Video Capture Full Day $1,120):

- A Saturday, no times, default mode: 1,120 × 1.5 = **$1,680**.
- A weekday booked 9am–7pm, default mode: the full day covers 9–5, so **$1,120** (D67). Ten
  hourly hours on the same booking cover 5–7pm too (s = 0.2): 1,120 × (0.8 + 0.2 × 1.25) = **$1,176**.
- Friday 8pm → Saturday 2am, a full day ($1,120, the window is the 6-hr booking), default mode:
  Friday's 4 hrs after hours ×1.25, Saturday's 2 hrs weekend ×1.5 (a carry-over):
  1,120 × (4/6 × 1.25 + 2/6 × 1.5) = $1,493.33, so **$1,494** (D70).
- A short-notice Saturday booked 1pm–9pm (s = 0.5) prices differently in each mode:
  - default: 2 × 1.5 on both parts = **$3,360**;
  - all multiply: 2 × (0.5 × 1.5 + 0.5 × 1.875) = **$3,780**;
  - only the highest: max(2, 1.5) = 2 on both parts = **$2,240**.

### 2. Booking a day (editor)

1. The owner opens the Production Booking block. The calendar shows this month, with this
   estimate's days at full strength and other projects' days faded (D23).
2. They type a date in "Go to date". The calendar jumps to that month and highlights the date.
3. Clicking the date opens the add-day pop-up (a `Modal`, focus trapped) with three buttons.
4. The check runs against other projects' days on that date:
   - **Confirmed elsewhere** (D15, D16): the pop-up says "Sat 4 Oct is confirmed for UPID-042". The
     three buttons are disabled until the owner writes a **specification note** (e.g.
     "Subcontractor shooting"), which then unlocks them and is stored with the day.
   - **Pencilled elsewhere**: a warning, "Already pencilled for UPID-042 — add anyway?". Adding puts
     both on the tile.
   - **Proposed elsewhere**: no message.
5. The new day card appears in date order with focus on its start time. The owner adds production
   items to it using the same service → unit → Add picker as today, scoped to Production.
6. Weekend, holiday and after-hours surcharges recompute live. Each surcharged line shows a muted
   "incl. weekend ×1.5" beside its price. The summary shows one owner-only line, "Surcharges
   +$X", with the ⓘ explaining it.
7. "+ Add Date TBC day" sits beside the calendar for undated work (D9).

A day card's status can be changed (confirmed / pencilled / proposed) and its date moved. Moving
the date re-runs the clash check. Removing a day asks first, since its items go with it.

### 3. Short notice

A tick box, "Short notice", sits in the doc-type bar. When the first dated production day is within
the hint threshold of today, a muted line beside it reads "First shoot day is in 3 days — short
notice?". The app never ticks it (D19).

### 4. Home (C)

- **Month view (default).** Each date cell holds its entries as tiles. Confirmed is solid green,
  pencilled is yellow with a diagonal hatch, and proposed is a grey quarter-tile. Each carries the
  UPID, so status never depends on colour alone.
- **Week view.** Seven columns with tiles at their times; untimed days sit at the top.
- **Tile pop-up.** Clicking a tile opens the project summary (UPID, project name, business, times,
  production items) and an "Open project" button.
- **"Coming up".** The next 14 days, in date order.
- **"Recent activity".** Opened, accepted and paid events, each linking to its project.
- **Phones.** Coloured dots per date, and tapping a date lists its entries below; the week view
  becomes a day-by-day list (D29).

### 5. Sending (D, E)

- The send panel opens with the message pre-filled for the document type and the time set to
  "Now".
- "Confirm to send" either sends immediately or schedules; a scheduled send shows "Scheduled Tue
  8 Oct, 9:00 · Edit · Cancel". A send missed while the NAS was off goes out on restart and reads
  "Sent late at 11:42 (scheduled 9:00)" (D47).
- "Copy link" copies the client URL and toasts "Link copied".
- **Sending an estimate freezes version N** (D34). Editing after that shows a banner, "Editing
  after v2 was sent — the client still sees v2 until you send again".
- Sending also sets valid-until (default 30 days, D44).

### 6. The client's estimate page (E)

- **Top of the page**: the wordmark, then UPID, project name, client business, date and
  valid-until.
- **Production days**: listed by date, each with its status word ("Confirmed", "Pencilled",
  "Proposed", D63), times, and items with their prices. Other sections follow as on the PDF.
- **Proposed days**: the disclaimer, "The proposed dates are not locked in and other project
  bookings may happen before this estimate is agreed upon".
- **Bottom**: totals, GST line and the total, then **Accept estimate**.
- **Accept is replaced with a notice** in three cases:
  - a proposed day has since been confirmed by another project: "Some proposed dates are no
    longer available — we'll send an updated estimate" (D17, D41), with that day marked "No
    longer available";
  - the estimate has expired (D44);
  - a newer version exists: "This estimate has been updated", with a link to the latest.
- **Accept opens the signing dialog**: the agreement, filled from the client's details, in a
  scroll box. Below it are "Service agreement FAQ" (the site's FAQ page in a new tab, D55), full name, role, the
  "I agree to the service agreement" tick, and **Sign & submit**, disabled until all three are
  filled.
- **Submitting shows "Thank you — we'll be in touch to confirm the details"** and a "Download
  signed agreement" link. Behind it, the automations from D18 and D38–D42 run:
  - the dated days are confirmed;
  - the signed PDF is saved;
  - the owner is emailed;
  - the deposit and final invoices (or the single invoice) are created, unsent;
  - the client is emailed their signed copy.

### 7. The client's invoice page (E)

The invoice as a document; a "Download PDF" button; bank details. "Pay by card" appears if it's on
for that invoice: it states the card surcharge amount before handing off to Stripe's hosted
checkout (D48, D49). Once paid, the page reads **Paid** with the date.

### 8. Declining and deleting

**Declined** is an owner-only action on any sent estimate (D22). It takes the estimate's days off
every calendar (they stay on the estimate for history), and its link then reads "This estimate is
no longer available". Deleting an estimate removes its days too.

## Responsive Behavior

- **≥1100**: existing screens are unchanged except for the new blocks. The editor calendar sits
  beside the day cards (calendar ~420px, cards fill the rest). Home: calendar left, "Coming up" and
  "Recent activity" in a right column.
- **768–1099**: the editor calendar sits above the day cards at full width. Home: calendar full
  width, with the two lists below side by side.
- **<768**: calendars switch to dots-per-date with a tapped-date list (D29); the week view is a
  list. Day cards stack their fields. The add-day pop-up becomes a full-width bottom sheet, and its
  three buttons are full width at 44px tall. The Rate Card surcharges block stacks label above
  field.
- **Client pages** are phone-first: one column at a comfortable measure (≤ 680px), 16px body text,
  and a Sign & submit that stays visible under the scroll box. The signing dialog is full screen on
  phones.

## Accessibility Requirements

- **Status is never colour alone.** Every tile and chip carries a word or the UPID. Pencilled adds
  a hatch pattern, and proposed has its quarter-tile shape plus the word "Proposed" in its
  accessible name ("Proposed: UPID-042, Acme launch, Sat 4 Oct").
- **Contrast**:
  - App text keeps the app's 4.5:1, and the status fills meet 3:1 against `--bg` and `--surface`.
  - Client pages meet 4.5:1 for body text on paper. Terra is used as text only via
    `--lsc-terra-dk`, verified.
- **The calendar is a keyboard grid**: arrow keys move by day and week, Page Up/Down by month,
  Home/End to week start and end, Enter opens the add-day pop-up. The focused date is announced
  with its entries.
- **Dialogs** (add-day, tile pop-up, signing) use `Modal`'s shared focus trap, return focus to
  their trigger, and close on Escape. The signing dialog's scroll box is focusable and labelled
  "Service agreement".
- **Live regions**:
  - A surcharge recompute announces once, politely: "Saturday 4 October: weekend rate applied".
  - A clash warning or lock is announced as it appears.
- **Time inputs** are native `<input type="time">` with visible labels. The overnight case is
  stated in text ("ends next day"), not implied.
- **The ⓘ controls** (surcharges, Cost Breakdown, stacking mode) use `Info`: a button, never hover.
- Touch targets are ≥44px on phones and client pages. Reduced motion disables the calendar's
  month-slide and dialog transitions.

## Resolved Decisions

All 66 are in [`DECISIONS.md`](DECISIONS.md), grouped A+B (D1–D26), C (D27–D29), D (D30–D37),
E (D38–D52) and brief (D53–D57) and IA (D58–D66). The ones a fresh agent is most likely to argue with:

- **Surcharges are invisible to the client** (D8, D12). This is deliberate, not a transparency bug.
- **Only the `prod` section is on set** (D24). A per-section flag was offered and refused.
- **"Estimate" is the only name** (D30). There's no quote object; sending freezes a version (D34).
- **A confirmed day locks the whole date**, and only a written note overrides it (D16).
- **Signing never sends an invoice** (D43).
- **The card fee is always passed on** (D49), capped by Australian law at the cost of acceptance.
- **Client links live on the app's GitHub Pages address, with no login** (D51, D53). The Client Hub
  comes later.
- **The low security bar** (root `CLAUDE.md`) covers the public pages: unguessable links, no
  login. Don't re-raise it, but no internal figure may ever be served on a public route.

## Out of Scope

- The **Client Hub integration** (D53): listing a client's estimates and invoices inside the
  site's portal.
- **HubSpot**: projects, invoices and signatures are local. The HubSpot track's scope (Companies +
  Contacts only) is unchanged.
- **Recurring or retainer billing**; more than two payment stages (deposit + final only, or single).
- **Card payment providers other than Stripe**; refunds and partial payments through Stripe (the
  owner handles those in Stripe).
- **Drawn signatures** (D40), or signing by anyone but the client contact.
- **A client-side decline button** (D22), and client comments or change requests on the page.
- **Syncing with Google Calendar or iCal.** The calendar lives in this app only.
- **Per-state holidays per shoot**: the holidays are national + NSW only (D6).
- **Separate Saturday and Sunday rates**: one weekend/holiday multiplier.
- **Changes to the existing PDF's look**, beyond adding booked days and the proposed-days
  disclaimer.
- **Writing the service agreement.** The owner supplies it. The FAQ is the owner's own page on
  lsccreative.studio (D55), maintained there, not in this app.
- `estimate-accuracy` tasks 9, 10, 12–14. They're un-grilled. Tasks 10 and 12 must say how they
  interact with booked days and surcharges when they are.

---

# Stage B2: Day-built estimates and the post-production planner

Added 3 October 2026, from the user's request after using the live A+B build, settled in
`/grill-me` the same day as **D73–D97** ([`DECISIONS.md`](DECISIONS.md)). **Built next, before
Stage C** (D73). Everything above still holds unless a D-number here overturns it. The one thing
it overturns is task 7's "a line moves one way only" (D80).

## Problem (B2)

**A shoot day is more than its camera work, but the day card only holds Production.** The owner
books Saturday, then has to scroll down to Travel, Crew and Equipment and add that day's car, meals,
gaffer and lens hire into flat lists that don't know which day they belong to. When a shoot moves
from day 1 to day 2, nothing moves with it. To move a line today, the owner removes it and adds it
again.

**Gear logistics live in the owner's head.** When the hire is picked up or posted, and when it goes
back, appears nowhere, so a Friday pickup for a Saturday shoot is easy to forget.

**Post-production is guessed.** The edit is usually the biggest cost on a job, yet the owner works
out its hours from memory each time. Nothing connects how much is filmed to how long the edit
takes, or to which deliverable each edit line is for.

**The totals area hides what matters.** The surcharges worked into the price are one line. The
three figures the owner actually reads (total, tax set-aside, take-home) are no bigger than the
rest, and a long sentence clutters the take-home cell. Deliverables, the thing the client is
buying, look like just another table.

## Solution (B2)

The estimate reads top-down the way a job is planned. **What the client receives** (Deliverables,
now visually the headline block) → **when and where it's shot** (the booking calendar and its day
cards) → **the edit** → **what it all comes to**.

**A day card is a whole shoot day.** "Add Production Service Items" swaps the calendar for a menu of
Production, Travel, External Crew and Equipment Hire. The owner taps through it, and each item lands
on that day. When the schedule changes, lines are dragged from one day to another and their prices
follow the new day's surcharges. "Duplicate day" makes the near-identical second day in one click.
Anything not tied to a shoot day goes in a "Not on a day" card. The sections further down become
read-only summaries of the days.

**Gear hire knows its dates.** All the items from one vendor form one rental with an out date and a
back date, and that rental shows as a bar on the calendar.

**Post-production plans itself from the shoot.** Capture-ticked production items add up to Capture
Hours. Each deliverable picks a type from the Rate Card, which brings in its post services and a
multiplier, so the Post-Production section shows **[Production Capture Hours 10] [Recommended
Post Production Hours 35]**. The owner types the hours against that guide, and every edit line
says which deliverable it's for.

## Experience Principles (B2)

1. **One place to add, many places to read.** Every on-set line is added in a day card. The
   summaries below, the calendar and the PDFs only read the days. There is never a second picker
   that could disagree with the first.
2. **Suggest, don't price.** The planner recommends hours and lays out post lines at 0 hrs. It never
   writes a billable number. The owner's typed hours are the price. Prices move when a line moves
   day (D80), since the brief's rule is that a surcharge follows its day. They never move behind
   the owner's back.
3. **The client's document doesn't change shape** (D85). B2 is an owner-side rework. The only new
   thing a client sees is the deliverable tag on post lines (D95).

## Aesthetic Direction (B2)

The existing dark editorial system, extended (see above). Two deliberate shifts in emphasis:

- **Deliverables are the headline block** (D86). A soft accent tint (the Total box's
  `rgba(184,84,68,.08)` fill and `.3` border, made heavier), a larger Delight heading, and a 2px
  border. It's the one block on the page that isn't neutral. Not cards. Not a coloured badge per
  row.
- **The Totals row is the page's last word** (D88). Its figures step up in Delight, with Total (inc
  GST) the largest on the screen, then Tax Set-Aside and Est. Take-Home, both larger than the
  first bar's figures.

The service menu should feel like a **call-sheet checklist, not a shop**: plain rows, the service
name left, unit buttons right, categories as quiet uppercase heads. No product tiles, icons or
prices in big type. The prices sit muted beside each unit button.

## Existing Patterns (B2)

Everything listed above, plus what A+B built:

- `BookingBlock` (`web/js/views/booking-block.js`, `web/css/booking.css`): day cards, `itemsFor(dayId)`
  (one items element per day, *moved* into its card on repaint, never rebuilt), `list()`,
  `showDay(id)`, `addTbc()`, and the polite live region.
- **The calendar** (`web/js/calendar.js`, `LSCCalendar.mount`). It draws per-date tiles only today,
  with no spanning bar.
- **The day card's service → unit → Add picker**, scoped to `prod`. The menu replaces it.
- **The Production section's "Add to a day ▾"**, its per-day list and the "Unassigned — pick a
  day" group (task 7).
- **The rate card's labour-row table** (`pricing.js`): it already has a per-row "Custom" tick
  column. "Capture" is a sibling column, shown on `prod` rows only.
- **`calc.js`**: `unitHours`, `labourHoursBreakdown`, `surchargeAttribution` and `costBreakdown`,
  which give the surcharge box's rows.
- **`Info`** (the ⓘ disclosure; it opens on mouse hover as well as click and keyboard), `Modal`
  (the bottom sheet below 768), `Unsaved`, and the typeahead pattern (`web/js/typeahead.js`).
- **Line shapes today:** crew `{ role, days, cost }`, equipment `{ vendor, days, cost }`
  (`vendor` holds "vendor / item" as one field), deliverables `{ name, format, duration, qty }`
  (no id), and labour lines carrying `dayId` (on `prod` only).
- **The server refuses `dayId` outside `prod`** (`days.js` `lineDayProblem` →
  `day_on_non_production_line`). B2 has to relax this for travel, crew and equip, and keep it for
  every other section.

## Component Inventory (B2)

| Component | Status | Notes |
|---|---|---|
| Day card → **"Add Production Service Items"** button | New | Replaces the card's service → unit → Add picker. Also on Date TBC days and the Not on a day card (D74) |
| **Service menu** | New | Swaps in where the calendar is (D74). Header "Adding to Sat 3 Oct" + Done. Four expandable groups: Production (open by default), Travel, External Crew, Equipment Hire. Production rows: service name + unit buttons with muted prices (D76). Travel rows: name + Add. Crew: "+ Add crew member" (D77). Equipment: "+ Add hire item". Shows a running "3 added" count |
| Day card lines | Modify | Production, travel, crew and equipment lines, each in its own small group inside the card, with a drag handle and "Move to ▾" (D80). Day total = everything on the day |
| **"Not on a day" card** | New | Last card. Same menu, drag and Move to. Holds legacy unassigned lines from every on-set section (D79). Production lines in it price as unassigned lines do today |
| **"Duplicate day"** | New | On each day card's actions (D81) |
| **Gear rentals panel** | New | In the booking block, under the cards. One row per vendor on this estimate: vendor, item count, out date + Pickup/Postage, back date + Return/Postage, note (D82) |
| Equipment line | Modify | Vendor (typeahead from this estimate's vendors) + Item + Days + Cost/Day (D82, D83) |
| Calendar **rental bar** | New | Spans out → back date across week rows. Label: vendor · UPID. Faded for other projects. Dots mode (narrow) shows a small bar under the date (D84) |
| Production / Travel / Crew / Equipment sections | Modify | Read-only summaries grouped by day, each group linking to its card, then a "Not on a day" group, then the subtotal (D78). "Add to a day ▾" opens that day's menu at the section's category |
| **Deliverables block** | Modify | Moves above the booking block. Tinted, heavier, larger heading (D86). Columns: Type ▾ · Name · Format · Length · Qty · Post hrs (rec.) · × |
| Post-Production section | Modify | A head cell [Production Capture Hours N] [Recommended Post Production Hours N], plus "On post lines: X of Y recommended" (D93). Tagged lines show a "· Brand Story" chip (D95) |
| **Surcharge box** | New (replaces the line) | Itemised rows, total, "already folded into the prices", or "No surcharges apply" (D87). The ⓘ text carries over |
| Totals row | Modify | Larger figures (D88). The take-home sentence moves into an `Info` ⓘ |
| Rate Card → **Capture** tick | New | A column on `prod` rows only (D89) |
| Rate Card → **Deliverable Types** block | New | Rows: name, description, post services (multi-pick from the Post-Production section, as chips), multiplier "N × 1 capture hour" (D91) |
| Client PDF | Modify | Equipment prints the Item (old lines print their old text). Post lines print "· deliverable name" (D95). Nothing else changes (D85) |

## Key Interactions (B2)

### 1. Adding to a day (D74–D77)

1. The owner clicks **Add Production Service Items** on a day card (or on Date TBC, or Not on a
   day).
2. The calendar's column is replaced by the menu. Focus moves to the menu's heading, "Adding to Sat
   3 Oct", and the day card gets a highlighted edge so the target is obvious.
3. The owner clicks **½ Day** on Video Capture. A line appears on the card straight away, priced
   with that day's surcharges, and the menu says "Added Video Capture — Half Day". It's announced
   politely, and the count goes up. The menu stays open.
4. **Travel** items add one line each, at qty 1 (Vehicle per km at 0 km, focused, so the owner
   types the distance). **+ Add crew member** adds an empty crew row on the day, focused on Role.
   **+ Add hire item** adds an equipment row, focused on Vendor.
5. **Done**, Escape, or the card's button again returns the calendar, with focus back on the
   card's button. Opening another card's menu just retargets the menu.

**Equipment and rentals:** when a hire item's Vendor is filled with a name new to this estimate
(trimmed, case-insensitive), the rentals panel gets a row for it with the dates empty, and the
line hints "Add pickup and return dates ↓". Another item with the same vendor joins that rental.
Renaming the vendor on a vendor's only item renames the rental. A rental with no items left is
removed. Old equipment lines open with their text as the **Item** and no vendor, so they join no
rental.

### 2. Moving lines (D80, D81)

- **Drag:** a handle on each line (mouse and pen). While dragging, valid drop zones (every card's
  line group of the same kind, and Not on a day) outline, and the drop point shows a rule. Dropping
  on another card moves the line there. Dropping inside its own card reorders it.
- **Move to ▾** on every line: lists each day ("Sat 3 Oct", "Day 3 — date TBC"), then "Not on a
  day". Picking one moves the line and keeps focus on it in its new place.
- **Either way, the price re-prices live** for the new day (weekend, holiday, after hours from its
  times, short notice). The line's note updates, and a polite announcement says "Moved Video
  Capture — Full Day to Sun 4 Oct: $1,680, weekend ×1.5." A moved line keeps its quantity, unit,
  override and rate marks, as task 7's move does today.
- **Duplicate day** makes a new Date TBC day (Proposed, as TBC days start) after the source, copying
  every line. Production lines re-price as TBC. Equipment copies keep their vendor, so they stay
  in the same rental. The new card scrolls into view with focus on its date field.

### 3. Post-production planner (D89–D96) (money math: pure function in `calc.js`, pin with tests)

- **Capture Hours** = Σ over capture lines of `unitHours(pricing, line.unit) × qty`, in every
  section key that holds `prod` lines (every day, TBC and Not on a day). A line's capture flag is
  **snapshotted when it's added** (`capture: true`). Lines saved before B2 fall back to the live
  card's row of the same name.
- **Each deliverable's share** = Capture Hours × its snapshotted multiplier × qty, **rounded up to
  the nearest 0.5**. The **Recommended** total is the sum of the rounded shares, so the rows add
  up to it.
- **"On post lines"** = the hours of every Post-Production line, tagged or not.
- **Worked examples** (for `test-calc.js`):
  - **Capture Hours:** Video Capture Full Day ×1 (8 hrs, capture) + Drone 2 hrs (capture) + Photo
    Capture 3 hrs (not ticked) → **10**.
  - **Shares:** Brand Story ×2, qty 1 → 20. Socials ×0.5, qty 3 → 15. **Recommended 35.**
  - **Rounding:** a ×0.33 deliverable, qty 1, on 10 capture hrs → 3.3 → **3.5**.
  - **Edge cases:** no capture lines → 0 / 0. An untyped deliverable adds 0. A deliverable at qty 0
    adds 0.
- **Picking a type** on a deliverable: its name prefills the deliverable's Name if blank. The
  deliverable stores `{ id, typeId, typeName, multiplier }`, and each of the type's post services
  is added to Post-Production at 0 hrs, carrying `deliverableId`.
  - A post service no longer on the Rate Card is skipped, with a toast naming it.
- **Changing the type or removing the deliverable** removes its tagged lines, after a confirm
  ("2 of its post lines have hours — remove them?") when any has qty > 0. Removing a tagged line
  on its own is just a delete.
- **The tag** shows the deliverable's *current* name (the editor and the PDF read it through
  `deliverableId`). A tag whose deliverable is gone prints no tag.
- Lines at 0 hrs are already left off the documents (the 9a rule), so an un-filled plan never
  prints.

### 4. Surcharge box and totals (D87, D88)

- **Rows** come from `calc.js` `costBreakdown()`'s surcharge entries, the same figures as the PDF:
  "Sat 3 Oct · Weekend ×1.5 · +$560", "Wed 21 Oct · After hours ×1.25 on 2 of 10 hrs · +$56",
  "Fri 9 → Sat 10 Oct · carry-over · …", "Short notice ×2 · +$2,240". Then "Total surcharges
  +$X — already folded into each production line's price."
- **States:** hidden with no days. With days but nothing surcharged: "No surcharges apply." It
  isn't under the overhead switch (as today).
- **Totals:** the figures are larger. The take-home's "(income ex GST, less the overhead…)" becomes
  an ⓘ beside the label, with the same words.

### 5. Server and data (exact shapes are in the IA)

- `lineDayProblem` allows `dayId` on `travel`, `crew` and `equip` lines, and still refuses it on
  every other non-`prod` key. `computeTotals` **never surcharges a non-`prod` line**, wherever it
  sits (D3). Pin that with a test that puts travel, crew and equipment on a Saturday after-hours
  short-notice day, including own-time Transport hrs.
- **Rentals** are stored per estimate, and `GET /api/calendar` returns the rentals overlapping the
  range.
- **Fields saved estimates gain:** deliverable `id` / `typeId` / `typeName` / `multiplier`, the
  post line's `deliverableId`, the prod line's `capture`, and the equipment line's `item`. All are
  optional and null-safe. An estimate without them totals exactly as before (a pinned test).
- **The card gains** `deliverableTypes[]` and `capture` on `prod` rows. `PRICING_SHAPE` moves on so
  an old build can't strip them.

## Responsive Behavior (B2)

- **≥1100:** the menu takes the calendar's 420px column, beside the cards, so the target card stays
  in view. The rentals panel spans the block under both columns. Above the booking block, nothing
  moves except the deliverables block's new place and treatment.
- **768–1099:** the calendar sits above the cards, so the menu does too. On open it scrolls so its
  header and the target card's head are both visible where they fit.
- **<768: the menu is a bottom sheet** (`Modal`, like the add-day pop-up), full width, with 44px
  unit buttons and a sticky Done. Behind it, the card updates. **No drag on touch:** the handle is
  hidden and Move to ▾ is the route (D80's alternative). Deliverables and rentals stack as the
  other tables do (`data-label` rows).
- **Rental bars** wrap across week rows on the month grid. In dots mode they're a thin bar under
  each covered date.

## Accessibility Requirements (B2)

- **Dragging has a single-pointer alternative** (WCAG 2.5.7): Move to ▾ on every line, a real
  `<select>` (or a menu button with a list). The drag handle is a `<button>` named "Move Video
  Capture — Full Day" that opens the same menu, so keyboard users never need to drag.
- **The menu is a labelled region, not a dialog,** at ≥768. Focus goes to its heading on open and
  back to the trigger on Done/Escape. Below 768 it's a `Modal`, with its focus trap. Each group head
  is a disclosure button (`aria-expanded`). Unit buttons are named in full ("Add Video Capture,
  half day, $640").
- **Announcements** (the existing polite regions): each add, each move with its new price, a
  duplicate, a removed tagged line.
- **The surcharge box** is a list with a heading. **The planner cell** is two labelled figures,
  plus the comparison as text, not colour alone.
- **The deliverables tint** keeps text at ≥4.5:1 on the tinted surface. Check it at build time.
- Targets are ≥44px below 768. Reduced motion turns off the menu's swap transition and the drop
  animation.

## Out of Scope (B2)

- **Post-production days on the calendar** (D97). Deferred until after A–E.
- **A Rate Card crew list** (D77) and pre-set equipment items. Both stay typed.
- **Rental clash warnings, times, or billing from the rental dates** (D83, D84).
- **Auto-filling post hours** (D93): the split by %, or evenly, was offered and not picked.
- **Printing a deliverable type's description** (D91), or the planner's figures, on any client
  document.
- **Pre-Production and Additional work** stay where they are, editable as today. They don't go in
  the day menu.
- **Changes to the Cost Breakdown PDF.** Pass-throughs are listed as now, wherever they sit.
