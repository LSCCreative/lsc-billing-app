# Design Brief: Production Booking

Date: 30 September 2026. Written from the user's request of the same day, their 66 answers in
[`DECISIONS.md`](DECISIONS.md) (cited below as **D1–D72**; don't re-ask any of them; D67–D72 revised the surcharge maths on 2026-10-02), and the
codebase. This track replaces `estimate-accuracy` task 8 (booking rate, scrapped) and task 11
(loadings, superseded). Earlier tracks remain the authority for anything not overturned here.

**Five stages, built in order (D1):** **A** surcharges, **B** Production Booking in the editor
(A and B ship together), **C** the home dashboard, **D** projects and the deposit/final invoice
pair, **E** client pages, signing, sending and payment. Each stage must be usable on its own.

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
