# Information Architecture: Production Booking

Date: 2 October 2026. Read after [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md). Decisions are cited
**D1–D66** from [`DECISIONS.md`](DECISIONS.md); D58–D66 were made while writing this file.

This track turns a list of estimates into a **project-centred app with a calendar at the front and
public pages for clients**. Three structural changes come first, because everything else hangs off
them:

1. **Projects** become a real object. There is one per UPID (D31), UPIDs are unique (D60), and the
   nav item "Estimates" becomes "Projects" (D58).
2. **The app gets addresses**, as hash routes (D59). Until now every screen was mounted in place,
   with no URL.
3. **Some routes are public**: the client pages and the Stripe callback. Until now everything but
   `/health` and login sat behind `requireAuth`.

## Site Map

### The app (owner, signed in): hash routes on the existing Pages site

- **Home** `#/home`, which is also `#/` and the landing view after sign-in (D27).
- **Projects** `#/projects`, with optional `?stage=` and `?q=`.
  - New project `#/projects/new`. This opens the estimate editor; the project is created on first
    save.
  - **Project folder** `#/projects/<projectId>`.
    - Estimate editor `#/projects/<projectId>/estimate`. Always the working draft.
    - Sent version (read-only) `#/projects/<projectId>/estimate/v/<n>`.
    - Invoice `#/projects/<projectId>/invoices/<invoiceId>`. A view, plus editing for a final
      invoice that hasn't been sent (D35).
- **Clients** `#/clients`.
  - Client `#/clients/<clientId>`. Its estimate history becomes its **projects**.
- **Finance & Price** `#/finance`, which opens the Dashboard.
  - `#/finance/<tab>`, with tab = `dashboard`, `pricing`, `overhead`, `capacity` or `goals` (the
    existing `FinanceView` ids). The Rate Card (`pricing`) gains the Surcharges block and the
    Holidays list (stage A).
- **Settings** `#/settings`, replacing the Invoice Settings pop-up (D65).
  - Sections, linkable as `#/settings/<section>`: `business`, `payment`, `documents` (deposit %,
    validity, numbering preview), `agreement`, `email`, `cards`.
- **UPID fix-up** `#/setup/upids`. One-off, reachable only while conflicts exist (D61).
- Sign in / sign out: unchanged, not routed. A signed-out visit to any route shows the login, then
  goes on to the route that was asked for.

### Client pages (public, no login): a separate light page on the same Pages site

- Estimate `c/#e/<token>`: the latest sent version of one estimate.
- Invoice `c/#i/<token>`: one invoice.

The token is 32 random bytes, base64url. It sits in the **fragment**, so it never appears in server
logs or `Referer` headers. `c/index.html` has its own CSS and JS (the light brand, D54) and loads
none of the app.

### Server routes

- **Existing `/api/*`**: still behind `requireAuth`. New owner endpoints are listed under each
  stage below.
- **New `/public/*`**: mounted **before** `requireAuth`, with no cookies, a CORS allow-list of the
  Pages origin without credentials, and a per-IP rate limit. It may only ever return what the
  client is meant to see (Principle 1).
- **New `/hooks/stripe`**: before `requireAuth`, verified by Stripe's signature.

## Navigation Model

- **Primary**: LSC Creative (logo → Home) · **Projects** · Clients · Finance & Price · **Settings**
  · Sign out. That's five destinations plus sign out, the same count as today, because Invoice
  Settings becomes Settings rather than an addition. The active item follows the route, so the
  nav's `setNav` is driven by the router, not by each click handler.
- **Secondary**:
  - The Finance rail stays as it is, now addressable.
  - The **project folder** uses in-page sections, not tabs: Overview, Production days, Documents,
    Activity. It's short enough to scroll, and tabs would hide the stage at a glance.
  - Settings uses a section list: a left rail at ≥1100px, a jump list above the sections on phones.
- **Contextual**:
  - Calendar tile pop-up → "Open project" (D28).
  - "Coming up" and "Recent activity" rows → the project.
  - Client page → its projects.
  - The estimate editor's "← Back" returns to the project folder, or to Projects for an unsaved new
    one.
- **Mobile**: the existing compact nav panel below 768px. It already re-uses the same buttons, so
  "Projects" and "Settings" arrive with no new markup. Routes and Back behave identically.
- **Router rules (D59)**:
  - `hashchange` runs the same `LSCUnsaved.confirmLeave()` guard as nav clicks. Refusing restores
    the previous hash without re-rendering.
  - An unknown route goes to Home with a toast ("That page doesn't exist any more").
  - A project id that's gone says "That project was deleted" in place, rather than bouncing.
  - Modals (add-day, tile pop-up, send panel) are not routes. Back closes an open modal first.

## Content Hierarchy

### Home (`#/home`)
1. **The production calendar**, month view by default (D27), with a week/month switch and Today.
   It's why the app opens here: what is booked, and when.
2. **Coming up**: the next 14 days of production days in date order. Each row: date, status word,
   UPID, project, client, times. It shows all three statuses (proposed ones are labelled), because
   a proposed date tomorrow still needs a decision.
3. **Recent activity** (D52): the last 10 events, each a link. Arrives with stage D; empty before.
4. Below the fold: nothing. Home stays a dashboard, not a second Projects list.

### Projects (`#/projects`)
1. **Search** (UPID, project name, client) and **stage filter chips**: All · Draft · Sent ·
   Accepted · Invoiced · Paid · Declined.
2. **Project cards**, newest activity first. Each shows UPID, project name, client, the **stage
   line** (e.g. "Sent v2 · valid until 14 Oct" or "Deposit paid · final not sent"), the next
   production day if any, and the total. This is the existing `.proj-card`, with the stage line
   where the date sat.
3. **+ New project** in the page head, where "+ New Estimate" is today.

### Project folder (`#/projects/<id>`)
1. **Overview**: UPID, project name, client, the stage line, and **the one next action** as the
   primary button. It changes with the stage:
   - Draft: "Edit estimate".
   - Draft changes since the last send: "Send v3".
   - Sent: "Mark accepted" (stage D, until E's signing exists) or the send status.
   - Accepted: "Create invoices".
   - Deposit unpaid: "Mark deposit paid".
   - Shoot done: "Edit final invoice".

   Secondary actions sit in a quiet row: Decline (owner-only, D22), Duplicate as new project
   (D60), Delete.
2. **Production days**: a compact list (date, status word, times, the day's items) linking into
   the editor's booking block. Clash flags ("clash, rebook", D18) show here first.
3. **Documents**, newest first:
   - the estimate (draft, plus each sent version, superseded ones marked, D34);
   - a Cost Breakdown per version and per invoice (D8);
   - the invoices: deposit, final, or single (D32–D37), with legacy ones marked "made the old way"
     (D62);
   - the signed agreement (D42, D66).

   Each row: name, number or version, status, a link to its page, "Download PDF", and a "Send…"
   button that opens the send panel (D43).
4. **Activity**: the full log for this project, as on Home but complete.

### Estimate editor (`#/projects/<id>/estimate`), the 80% screen (D64)
1. **Header fields as today** (UPID … Internal Notes). The Document Type bar becomes the
   **Short notice** row: the tick plus its hint (D19). The doc-type select and invoice-number
   field are removed (D62); GST-free stays.
2. **Production Booking**: collapsed by default, and opened automatically only when the estimate
   already has production days or items (D64). Its head summarises ("3 days · 2 confirmed · 1
   proposed · Fri 3 – Sun 5 Oct").
3. **The rest of the editor as today**: rates bar, deliverables, Pre-Production, **Production**
   (now built from the day cards, D4; its own "+ Add" is replaced by "Add to a day ▾"),
   Post-Production, **Additional work** (D14), travel, crew, equipment.
4. **Summary**: as today, plus one owner-only line, "Surcharges +$X ⓘ".
5. If a version has been sent: a banner above everything, "Editing after v2 was sent — the client
   still sees v2 until you send again".

### Invoice (`#/projects/<id>/invoices/<invoiceId>`)
1. Number, kind (Deposit / Final / Single), status (draft, scheduled, sent, paid), and the
   amount due.
2. **The deposit invoice is a fixed summary** (D37), with nothing to edit but its message. **The
   final invoice** shows the accepted estimate's items, read-only, then an editable **Extras**
   block (Additional work items, D35), then "Less deposit paid", then the balance due.
3. Send panel button, Download PDF, Copy link, "Mark paid" (with date and method), and "Card
   payment on/off" (stage E).

### Rate Card (`#/finance/pricing`), additions only
1. The existing tables, untouched above 1100px (Desktop Preservation Law).
2. **Surcharges** (new block): Short notice ×, hint threshold (days); Weekend & public holiday ×;
   After hours ×, office start/end, working weekdays; How surcharges combine (3 options, D2), with
   ⓘ.
3. **Public holidays** (new block): the list for this year and next (date, name, "fetched" or
   "added by you"), "+ Add a date", remove, "Fetch again", and the last-fetched date (D7).
4. **Additional work** appears as an ordinary labour section in the existing table (D14).

### Settings (`#/settings`, D65)
1. **Business**: as in today's modal.
2. **Payment**: bank details and terms, as today.
3. **Estimates & invoices**: deposit % (D33), valid-for days (D44), the invoice-numbering preview
   (`INV-<UPID>-D`, D36), and the default message for each of: estimate, deposit invoice, final
   invoice, single invoice (D43).
4. **Service agreement**: a large text area, the list of fill-in fields and what each becomes, and
   "Preview with a project…" (D39). The FAQ URL sits here (D55).
5. **Email**: the Google account in use, "Connected / Not set up", and "Send a test email". The app
   password itself is set on the NAS, never typed into this page (see Data).
6. **Card payments**: Stripe "Connected / Not set up" and the card surcharge % with its legal note
   (D49).

### Client estimate page (`c/#e/<token>`)
1. The wordmark, then UPID, project name, the client's business, the issue date and **valid
   until**.
2. **Production days** by date: status word (D63), times, items with prices.
3. The other sections, as on the PDF; then totals, GST line and Total.
4. The **disclaimer** if any day is proposed.
5. **Accept estimate**, or the notice that replaces it (taken proposed date, expired, newer
   version, declined, D41, D44, D34, D22).
6. Footer: contact line, "Download PDF".

### Client invoice page (`c/#i/<token>`)
1. Wordmark, invoice number, kind, issue and due dates, client.
2. The invoice body, by kind (D35, D37).
3. **Amount due**, then bank details; "Pay by card" when it's on, showing the surcharge before
   handing over to Stripe (D48, D49). Once paid: "Paid on 12 Oct".
4. "Download PDF".

## User Flows

### 1. Quote a shoot (stages A + B)
1. Projects → **+ New project**, which opens the editor at `#/projects/new`.
2. Fill in the header. Open **Production Booking** → "Go to date" → click a date → the add-day
   pop-up.
   - Date confirmed by another project: "Confirmed for UPID-042". The buttons are locked until a
     **specification note** is written (D16).
   - Date pencilled by another project: "Already pencilled for UPID-042 — add anyway?" (D15).
   - Otherwise: pick + Confirmed / + Pencilled / + Proposed day.
3. The day card appears. Add its items (service → unit → Add). Repeat per day, or add a **Date TBC**
   day (D9).
4. Surcharged lines show "incl. weekend ×1.5", and the summary shows "Surcharges +$X".
5. Tick **Short notice** if wanted; the hint suggests it within the threshold (D19).
6. Save. On the first save the project is created, the URL becomes `#/projects/<id>/estimate`, and
   the days join every calendar.

### 2. Send an estimate (stage E; stage D uses "Download PDF" plus "Mark sent")
1. In the project folder: **Send v1**, which opens the send panel with the estimate message
   pre-filled, time "Now", and "Copy link".
2. **Confirm to send**. This freezes v1 (D34), sets valid-until (D44), and either queues the email
   or schedules it.
   - Scheduled: the row reads "Scheduled Tue 9:00 · Edit · Cancel". If missed, it goes on restart
     and reads "Sent late" (D47).
3. The stage line reads "Sent v1 · valid until …".

### 3. The client accepts (stage E)
1. The client opens the link, and "Opened" is logged.
2. Accept **is available** unless one of these applies, in which case it's replaced by its notice:
   - a proposed day has been taken (D41);
   - the estimate has expired;
   - a newer version exists (the page links to the latest);
   - the estimate was declined.
3. Accept → the signing dialog → full name, role, "I agree" → **Sign & submit**.
4. The server, in one transaction:
   - stores the signature (name, role, IP, time, version, exact agreement text, and the PDF bytes;
     D40, D66);
   - sets the estimate to **accepted**;
   - confirms the dated days, flagging any clash (D18);
   - creates the invoice pair or single (D32), **unsent**;
   - logs the activity.

   After the transaction it queues the owner email and the client's signed copy (D38).
5. The client sees "Thank you — we'll be in touch to confirm the details", plus a download link
   for the signed agreement.

### 4. Accept in the app (stage D, before E exists)
Project folder → **Mark accepted** → choose "Deposit + final" or "Single invoice" → the same
server path as flow 3, minus the signature and emails.

### 5. Bill after the shoot
1. Project folder → **Edit final invoice**.
2. Add **Overtime** or an extra revision round in Extras, from Additional work (D14, D35).
3. Send, scheduled or now. When it's marked paid (or paid by card), the stage line reads "Paid".

### 6. Decline
Project folder → **Decline** → confirm. The estimate becomes declined, its days leave every
calendar, and its client link reads "no longer available" (D22). A declined project can be
**reopened**, which returns it to draft and puts its days back, going through the clash check
again.

### 7. Fix shared UPIDs (one-off, before stage D switches on)
1. After the stage D migration, if any estimates share a UPID or have none, a banner on Projects
   says "3 projects need a UPID before invoicing can be used — Fix now".
2. The `#/setup/upids` screen shows one group per shared UPID, listing its estimates (name, date,
   total). For each group, the owner can:
   - type a **new UPID** per estimate; or
   - choose "**Keep together**", making one project with several estimates (a legacy shape that new
     projects never take).
3. When no groups are left, the banner and the route disappear.

### 8. Duplicate (D60)
Project folder → **Duplicate as new project** → the editor opens on a new draft with the items
copied, no days, and the **UPID blank and focused**. It can't be saved until the UPID is unique.

## Naming Conventions

| Concept | Label in UI | Notes |
|---|---|---|
| A job, keyed by UPID | **Project** | Nav, list, folder (D31, D58) |
| The priced document | **Estimate** | Never "quote" (D30) |
| A frozen sent copy | **v1, v2…** / "Sent v2" | Older ones are "superseded" (D34) |
| Every booked date | **Production day** | Collective noun only (D63) |
| Green status | **Confirmed** | Button "+ Confirmed day" (D63) |
| Yellow status | **Pencilled** | Australian spelling, double L |
| Grey status | **Proposed** | Quarter tile on calendars |
| A day with no date | **Date TBC** | "Day 2 — date TBC" (D9) |
| Clash override text | **Specification note** | Required on a confirmed date (D16) |
| The three uplifts | **Short notice**, **Weekend & public holiday**, **After hours** | Grouped as **Surcharges**, owner-side only |
| How they combine | **How surcharges combine** | Options: "Higher of weekend/after hours, short notice on top" · "Multiply all" · "Highest one only" |
| The owner's detail sheet | **Cost Breakdown** | File `Cost Breakdown_<UPID>_<ProjectName>.pdf` |
| 50% up front | **Deposit invoice** | `INV-<UPID>-D` |
| The rest | **Final invoice** | `INV-<UPID>-F`; "Extras" for post-shoot items |
| No deposit | **Single invoice** | `INV-<UPID>` |
| Owner says no-go | **Declined** | Owner-only; "Reopen" reverses it |
| Past valid-until | **Expired** | Derived, never stored |
| Client signs | **Accept estimate** → **Sign & submit** | Two steps: page button, then dialog button |
| Sending UI | **Send…** → **Confirm to send**; **Copy link** | Scheduled sends: **Edit**, **Cancel** |
| Post-shoot extras section | **Additional work** | Rate Card section, holds Overtime |

## Component Reuse Map

| Component | Used on | Behavior differences |
|---|---|---|
| **Router** (new, `web/js/router.js`) | Every app screen | Drives `setNav`; runs the unsaved guard on `hashchange` |
| **Month calendar** (new) | Editor booking block; Home | Editor: this estimate at full strength, others faded, click → add-day. Home: all equal, click tile → pop-up, week view on |
| Week view | Home only | Phones: a vertical list (D29) |
| `Modal` (existing focus trap) | Add-day, tile pop-up, send panel, signing dialog (client page), Mark accepted, Decline, Mark paid | Signing dialog: full-screen on phones, and its scroll box is focusable |
| `Info` (existing ⓘ) | Surcharges summary line, How surcharges combine, holiday list | — |
| `.proj-card` | Projects list; client page's project list | The stage line replaces the date line |
| Stage line (new, one function) | Project card, folder overview, client's projects | One source, so the three can't disagree |
| Day card (new) | Editor; project folder (compact, read-only) | Folder version has no inputs |
| Status chip (new) | Day cards, tiles, Coming up, client page | Word always present; hatch on Pencilled |
| Send panel (new) | Estimate, deposit, final, single | Pre-filled message per kind |
| Document row (new) | Project folder Documents | Kind-specific actions |
| `.billing-block` + collapsible head | Booking block; Surcharges and Holidays on the Rate Card | — |
| Light document shell (new, `web/c/`) | Client estimate and invoice pages | Not shared with the app; shares only `calc.js` formatting helpers if needed |
| PDF renderer (`server/src/pdf.js`) | Estimate PDF (+ days, disclaimer), Cost Breakdown, deposit/final/single invoice, signed agreement | One header and footer; the body varies |

## Content Growth Plan

- **Projects** grow without limit. Search and stage chips first. Load 50 at a time, with "Show
  more"; there's no paging UI until the count warrants it. Declined and Paid projects are hidden by
  the default "Active" filter after 90 days.
- **Production days** grow with projects. The calendar API is **range-queried**
  (`?from=&to=`); a calendar never loads all days.
- **Activity** grows fastest. Home shows the last 10, the folder shows that project's events, and
  nothing is pruned (it's small).
- **Versions** are typically 1–3 per project, all listed.
- **Holidays**: this year and next are fetched; past years stay (old estimates' snapshots don't
  need them, but the list is tiny).
- **Signed agreement PDFs** are about 100 KB each in the database, so 100 a year is about 10 MB.
  The 14 nightly and 10 pre-write backups multiply that; acceptable, and worth re-checking at
  ~500.

## Data Model

The task list picks exact column names. This is the shape and the rules. Migrations start at
**v11**, after estimate-accuracy's v10. Every migration is additive and null-safe, and **NAS
deploys before Pages** for each stage.

### Stage A + B (v11)
- **`production_days`**:
  - Columns: `id`, `estimate_id`, `date` (NULL = TBC), `status` (`confirmed` | `pencilled` |
    `proposed`), `start_time`, `end_time` (HH:MM; end < start means overnight, D21),
    `override_note`, `sort`, `created_at`, `updated_at`.
  - Indexes: `(date)` and `(estimate_id)`.
  - A table, not estimate JSON, because the calendar is a cross-estimate range query.
- **`holidays`**: `date` PK, `name`, `source` (`fetched` | `added`), `hidden` (a fetched date the
  owner removed, kept so a re-fetch doesn't bring it back).
- **Estimate rows**:
  - Production lines in `active_rows_json.prod` gain `dayId`.
  - The estimate gains `short_notice` (0/1) and `surcharges_json`. That's the snapshot: the
    multipliers, the mode, office hours, working weekdays, and each day's weekend/holiday result
    at save.
  - Each surcharged line snapshots its `surchargedPrice` (D20 rounding).
- **Rate card JSON** gains `surcharges` (multipliers, hint days, office hours, weekdays, mode) and
  the `additional` section in the defaults. `prod` is marked undeletable (D24).
  **`PRICING_SHAPE` bumps** (an old build would drop `dayId` and the surcharge snapshot), and the
  card gets a new marker, the v9/6a pattern in full.
- **`calc.js`** (both copies): `surchargeFactor(day, settings)` and the line pricing in
  `computeTotals`, per the brief's table. `totals.surchargeTotal` is owner-only and is never sent
  on a public route.
- **API**:
  - `GET /api/calendar?from=&to=` returns days with UPID, project, client, status, times and
    production items. Declined estimates are excluded.
  - `GET/PUT /api/holidays`, plus `POST /api/holidays/fetch` (server-side fetch, NSW +
    national).
  - The estimate write routes accept and return days. Clash rules (D15, D16) are **checked on the
    server too**, so a second tab can't bypass the lock.

### Stage C (no migration)
Home reads `/api/calendar`. The router lands here (D59). Recent activity waits for D.

### Stage D (v12, plus the fix-up)
- **`projects`**:
  - Columns: `id`, `upid` UNIQUE (NULL only while awaiting fix-up), `client_id`,
    `invoicing` (`pair` | `single`), `deposit_pct`, `accepted_at`, `declined_at`, `created_at`,
    `updated_at`.
  - The migration creates one per distinct non-blank UPID. Shared or blank UPIDs become projects
    with `upid` NULL and a `needs_upid` flag for the fix-up (D61).
- **`estimates.project_id`** (FK). `estimates.upid` is kept in sync with its project's for old
  builds and the PDF, and refused on write if it differs.
- **Estimate status** moves to `draft` | `sent` | `accepted` | `declined`; *expired* is derived.
  That's a table rebuild, because SQLite can't alter a CHECK. Mapping: `approved` → accepted;
  `invoiced` and `paid` → accepted, and the row also yields a **legacy invoice** in its project
  (D62). In practice the live rows are almost all `draft` (see DECISIONS, "Found in the code").
- **`invoices`**:
  - Columns: `id`, `project_id`, `kind` (`deposit` | `final` | `single` | `legacy`), `number`
    UNIQUE, `status` (`draft` | `scheduled` | `sent` | `paid` | `void`), `pct`,
    `estimate_snapshot_json`, `extras_json`, `totals_json`, `less_invoice_id`, `issued_at`,
    `due_at`, `paid_at`, `paid_via` (`bank` | `card`), `card_fee`, `public_token`.
  - The amounts: the deposit is `round2(estimate total inc GST × pct)`. The final is the snapshot
    plus extras, minus the deposit's total. A single invoice is the snapshot plus extras. These go
    in **`calc.js` (money math, Opus/high)**, with GST split per invoice the same way as
    `computeTotals`.
- **`activity`**: `id`, `project_id`, `at`, `kind`, `detail_json`.
- **Doc-type retired (D62).** `doc_type` and `invoice_number` stay as columns for old rows, but
  the editor no longer writes them.
- **`averageJobValue`'s won set** becomes accepted estimates. This is money math: re-pin its
  tests.
- **API**:
  - `GET /api/projects?stage=&q=&limit=&before=`, plus `GET /api/projects/:id` (the folder in one
    call).
  - `POST /api/projects/:id/accept` (the flow 3/4 transaction), `/decline`, `/reopen`.
  - `POST /api/projects/:id/invoices`.
  - `PUT /api/invoices/:id` (final extras; anything unsent).
  - `POST /api/invoices/:id/paid`.
  - `GET /api/setup/upids`, plus `POST /api/setup/upids` (assign or keep together).

### Stage E (v13)
- **`estimate_versions`**: `id`, `estimate_id`, `n`, `snapshot_json` (the whole estimate,
  including its days and the surcharge-folded client lines), `client_totals_json`, `sent_at`,
  `valid_until`, `superseded_at`. The client token is **not** here: `estimates.public_token` (added
  in v13) is one token per estimate, resolved to its latest sent version, so a re-send keeps the
  link.
- **`sends`**: `id`, `doc_kind` (`estimate` | `invoice`), `doc_id`, `version_id`, `to_email`,
  `message`, `scheduled_for`, `status` (`scheduled` | `sending` | `sent` | `failed` |
  `cancelled`), `sent_at`, `late`, `error`.
  - A one-minute in-process scheduler sends due rows. **On boot it sends every overdue row and
    marks it `late`** (D47).
  - A row is claimed (set to `sending`) inside a transaction before the SMTP call, so a restart
    mid-send can't double-send.
- **`signatures`**: `id`, `version_id`, `full_name`, `role`, `ip`, `user_agent`, `signed_at`,
  `agreement_text`, `agreement_sha256`, `pdf_blob` (D66).
- **`payments`**: `id`, `invoice_id`, `stripe_session_id`, `amount`, `card_fee`, `status`,
  `created_at`, `paid_at`.
- **Secrets live in the NAS `.env`, never the database or the repo**: `SMTP_USER`,
  `SMTP_APP_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Settings shows only
  "Connected / Not set up" and a test button.
- **New dependencies**: `nodemailer` (SMTP via smtp.gmail.com) and `stripe`.
- **Public API**:
  - `GET /public/estimates/:token` returns the client view of the latest version. It includes a
    live `unavailableDays` and a `state` (`open` | `taken` | `expired` | `superseded` |
    `declined` | `accepted`).
  - `POST /public/estimates/:token/accept` takes the signature. It is idempotent per version.
  - `GET /public/estimates/:token/pdf`.
  - `GET /public/invoices/:token`, `GET /public/invoices/:token/pdf`.
  - `POST /public/invoices/:token/checkout` creates a Stripe Checkout session, including the
    card fee line.
  - `POST /hooks/stripe` marks the invoice paid.
  - **Every public response is built by a dedicated serializer** that has no access to totals'
    owner fields. A test asserts that no public payload contains `surcharge`, `floor`,
    `taxSetAside`, `overheadShare` or `estTakeHome`.

## URL Strategy

- **App pattern**: `#/<area>[/<id>[/<sub>[/<id>]]]`, all lowercase.
  - Areas: `home`, `projects`, `clients`, `finance`, `settings`, `setup`.
  - The ids are database ids, **not UPIDs**. A UPID can be edited until the first send, and an
    emailed link must survive that. **The UPID locks at the first send**, because invoice numbers
    and sent PDFs carry it (D36). The UPID is shown in the page, not the URL.
- **Query parameters** (in the hash, after `?`): Projects uses `stage` and `q`. Nothing else is
  query-driven; filters on Home are not persisted.
- **Client pattern**: `c/#e/<token>`, `c/#i/<token>`. Opaque, unguessable, and
  version-independent for estimates: one token per estimate, which always resolves to its latest
  sent version (D34), so a re-send doesn't need a new link.
- **Deep links in email** (owner notice): `<pages>/#/projects/<id>`. If not signed in, sign in first,
  then continue to the route.
- **Never** put a token, an email address or a name in a query string (it would reach logs), and
  never use UPIDs in public URLs.
