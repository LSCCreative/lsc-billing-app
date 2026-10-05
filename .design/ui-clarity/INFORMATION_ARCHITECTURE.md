# Information Architecture: UI Clarity

This track adds **no new routes**. It restructures what sits inside three existing screens, the
Settings → Service agreement section and the email template. The user's answers are U1–U23 in
[`DECISIONS.md`](DECISIONS.md). The overall site map and nav are production-booking's
(`.design/production-booking/INFORMATION_ARCHITECTURE.md`) and stay as they are.

## Site Map

Only the screens this track touches are listed. The others are unchanged apart from the
system-level styles.

- Home `#/` (system-level only)
- Projects `#/projects`
  - **Project page** `#/projects/<id>`: reworked (panels, menus)
    - **Estimate editor** `#/projects/<id>/estimate/edit`, plus the new-estimate route: reworked
      (six panels, rail, sticky bar)
    - Estimate view `#/projects/<id>/estimate` (system-level only)
    - **Invoice screen** `#/projects/<id>/invoices/<invoiceId>`: reworked
- Clients `#/clients` (system-level only)
- Finance & Price `#/finance/...` (system-level only)
- Settings `#/settings/<section>`
  - Business `#/settings/business`: gains **Signs for the business** (U22)
  - **Service agreement** `#/settings/agreement`: the text box becomes the **builder**
- Client pages `c/#e/<token>`, `c/#i/<token>`: the sign dialog shows clause headings only
- Emails (`server/src/mail.js`): the new branded shell

## Navigation Model

- **Primary navigation:** unchanged. LSC Creative (Home), Projects, Clients, Finance & Price,
  Settings and Sign out. Nav labels stay in capitals (U4).
- **Secondary navigation:**
  - **Estimate editor:** a jump rail of its six panels at ≥1100px, and a "Jump to…" select below
    that. The rail scrolls the page; it never changes the hash, because the router owns the
    hash. The link for the panel in view is highlighted.
  - **Settings:** its existing rail. Service agreement stays one section in it.
  - **Project page and Invoice screen:** the back link and the menus. No rail.
- **Utility navigation:** the **Actions ▾** and **Documents ▾** menu buttons. They are
  contextual, so they are covered under Content Hierarchy below.
- **Mobile navigation:** the compact nav panel is unchanged. Below 768px every menu opens as a
  bottom sheet.

## Content Hierarchy

### Project page `#/projects/<id>`

1. **Header.** This is what the job is and where it stands:
   - The UPID as a mono eyebrow, then the title (Delight), then client and contact.
   - The stage line (`ProjectCard.stageMarkup`).
   - Facts: Total (inc GST) and the Next production day.
   - On the right: **one primary button** (today's `nextAction`) and **Actions ▾**.
2. **Notices**, when there are any: UPID needed, declined, taken dates. Full width under the
   header.
3. **Documents panel** (U20). The main column at ≥1100px and first on a phone, because it's
   where the owner acts. It lists estimates and invoices only:
   - The **Cost Breakdown** and **Signed agreement** rows are gone. Both now live in their
     estimate's Documents ▾.
   - Each row has: name + mono number, status line + send status, amount, primary button,
     Actions ▾ and Documents ▾.
4. **Production days panel.** Side column. Day rows open the editor's day, as today.
5. **Activity panel.** Side column, below the days panel.

### Estimate editor (U21)

Six panels in this order. Each header shows a summary that stays visible when the panel is
collapsed.

1. **Job details:** UPID, project name, client fields, internal notes, Short notice, and the
   prices row ("Update to current rates" / "Use rates from last project").
   - Summary: `NBK-014 · Autumn campaign · Northbank Studio`.
   - It starts **collapsed on an existing estimate** and open on a new one.
2. **Deliverables.** Summary: count (with `+ Add deliverable` in the panel header).
3. **Production booking:** calendar, day cards and gear rentals.
   - Summary: `3 days · 1 pencilled · 1 rental` (today's booking summary line).
4. **Services:** the rate card's labour sections (Pre-production, Post-production, Additional
   work, and any others) as sub-sections, each with its picker, table and subtotal.
   - Summary: the services subtotal.
5. **On set, by day:** Production, Travel & accommodation, External crew, Equipment hire, as
   sub-sections. Summary: the on-set subtotal.
6. **Summary:** surcharges, the overhead tick, the totals strip, Total / Tax set-aside /
   Take-home, and the Minimum Job Price. These are owner-only figures. Summary: client total.

**Sticky bar** (always visible): the client total (inc GST, live), then **⋯** (Delete estimate…,
How this is calculated), Cancel and **Save**. Save keeps D104's "Save and send the update".

Panels 1–6 remember their open/closed state per browser (`localStorage`, wrapped in try/catch).

### Invoice screen `#/projects/<id>/invoices/<invoiceId>`

1. **Header:**
   - Left: the mono invoice number as eyebrow, the kind as title, project · client, and the
     status.
   - Right: the **Balance due** figure.
   - Below: **one primary button**, **Actions ▾** and **Documents ▾** (menus under Content Rules).
2. **Notices:** void, replaces, voided deposit, legacy.
3. **Panels:**
   - **The accepted estimate** (collapsed).
   - **Extras**, with Save extras in the panel footer.
   - **Balance**.

### Settings → Service agreement `#/settings/agreement`

1. **Section intro:** one sentence saying what it is, and that signed agreements never change.
   Then **Preview with a project…**.
2. **Header panel:**
   - A locked preview of the header layout (Parties, Project, Payment schedule, Scope) with its
     fields marked as chips.
   - The editable **Intro** text box.
   - A note linking to Settings → Business for email, phone and Signs for the business, showing
     "Missing" next to any that are blank.
3. **Clauses panel** (count in the header):
   - The draggable clause cards, all closed by default: handle, number, title, chevron and ⋯.
   - **+ Add clause** at the bottom.
   - The panel header's ⋯ holds **Reset to LSC default clauses…**, with a confirm.
4. **Agreement values panel:** **Hourly rate for extra work** (`{hourly_rate}`).
5. **Fields you can use:** a closed disclosure listing `AGREEMENT_FIELDS`. It's today's list,
   moved out of the way.
6. **Client page panel:** the Service agreement FAQ URL (it moves here from beside the text box).

Saving uses the Settings screen's existing sticky save bar and unsaved-changes guard.

## Content Rules: what each menu holds

Rules for every menu:
- Items an action can't do right now are **left out**, not disabled. The existing rules decide
  what is available.
- Danger items sit last, below a divider.
- An item ending in "…" opens the existing dialog.

### Project header

| Project state | Primary | Actions ▾ |
|---|---|---|
| Draft, ready to send | Send vN… | Edit estimate · Mark accepted… · Duplicate as new project · ─ · Decline… · Delete… |
| Draft, send waiting / no lead | Edit estimate | Mark accepted… · Duplicate… · ─ · Decline… · Delete… |
| Sent | Mark accepted… | Edit estimate · Send vN… · Duplicate… · ─ · Decline… · Delete… |
| Accepted, needs invoices | Create invoices… | View estimate · Duplicate… · ─ · Delete… |
| Accepted / invoiced | the current invoice's action (Send…, Mark paid…, Open) | View estimate · Duplicate… · ─ · Delete… |
| Declined | Reopen | View estimate · Duplicate… · ─ · Delete… |

Decline… is present only while there's no live invoice. Delete… follows its existing refusal rules.

### Estimate row (Documents panel)

- **Primary:** **Send vN…** when this is the lead estimate and it's sendable. Otherwise **Open**,
  which opens the read-only view.
- **Actions ▾:** Open (if it isn't the primary) · Edit · Send vN… (if it isn't the primary) ·
  Copy link (with a live link) · Mark accepted… (draft/sent) · Duplicate as new project ·
  ─ · Decline… (no live invoice).
- **Documents ▾:** Estimate PDF · Cost Breakdown (for you only) · Signed agreement PDF (one item
  per signature, "Signed agreement v2" when there are several).

### Invoice row (Documents panel) and Invoice screen

| Invoice state | Primary | Actions ▾ | Documents ▾ |
|---|---|---|---|
| Draft | Send… | Open* · Mark paid… | Invoice PDF · Cost Breakdown |
| Scheduled / Sent | Open* / Mark paid…† | Copy link · Mark paid…* · ─ · Void and remake… | Invoice PDF · Cost Breakdown |
| Paid | Open* | Copy link | Invoice PDF · Cost Breakdown |
| Void | Open* | Open the replacement (if any) | Invoice PDF |
| Legacy | Open* / Mark paid…† | Mark paid…* (if unpaid) | PDF (from its estimate) |

\* on the Project page row only. † on the Invoice screen, where you already are.

## User Flows

### Send a draft quote (Project page)
1. The owner opens the project. The header's primary button reads **Send v1…**.
2. They choose it, or the estimate row's own Send v1…. Both open the existing send panel.
3. They Confirm, and the row's status line shows the email as Scheduled, then Sent.

### Download a Cost Breakdown
1. On the Project page, the owner opens the estimate row's **Documents ▾**.
2. They choose **Cost Breakdown**, and the PDF downloads, as `↓ PDF` did before.

### Edit an estimate's services
1. The owner opens the editor from the row's Actions ▾ → Edit. **Job details** is collapsed and
   its summary confirms which job this is.
2. They choose **Services** in the rail. The page scrolls there and the panel opens if it was
   closed.
3. They add a line. The sticky bar's total updates.
4. They choose **Save**.
   - If the client would see the change → "Save and send the update" (D104).
   - Otherwise it saves.

### Reorder and edit the agreement (Settings)
1. The owner goes to Settings → Service agreement. The 12 clause cards are closed:
   "1 Services and Deliverables" … "12 Acceptance".
2. They drag **Cancellation and Postponement** (7) above **Payment** (2). On drop, it becomes 2,
   and Payment and everything after it renumber. The change is announced.
   - **Keyboard:** focus the handle, then Alt+↑ five times, or ⋯ → Move up.
3. They open **Intellectual Property** and add a sub-clause. It's lettered (d) at once.
4. **Indent** under (b) makes it (b)(i).
5. **Preview with a project…** shows the filled, numbered text. Then Save Settings.
   - If they leave without saving → the existing unsaved-changes guard.

### The client signs
1. The client opens the quote link → Accept → the sign dialog.
2. The agreement shows its header, then "TERMS" with "1. Services and Deliverables" as
   headings. The text is the one generated from the Settings master at that moment.
3. They type their name and role, tick and sign. The stored text and SHA-256 cover exactly what
   was shown (unchanged pipeline).
   - If the owner saved a change while the client was reading → today's `agreement_changed`
     refusal, and the client reads it again.

## Data Shape (agreement)

Inside the settings document (`GET/PUT /api/settings`):

```
agreement: {
  intro:  string,                  // the editable header paragraph
  clauses: [                       // order = numbering; never stored numbered
    { id, title, body,             // body: optional intro text, paragraphs by blank line
      subs: [ { id, heading, text, indent: 0|1 } ] }
  ],
  hourlyRate: number|null,         // {hourly_rate}
  faqUrl: string,                  // unchanged
}
business: { …, signer: string }    // "Signs for the business"
```

- **`agreement.text` is retired.** A settings row with no `clauses` gets the U13 seed through
  `docSettings()` defaults, so the live DB needs no migration script. The old text survives in
  the pre-deploy DB backup.
- **Ids** are short random strings, made in the browser and kept stable across saves.
- **New fields** in `AGREEMENT_FIELDS`: `hourly_rate`, `business_email`, `business_phone` and
  `business_signer`.

**Render.** `documents.js` gains `agreementText(agreement, values, { single })`. It's shared by
server and browser and drift-tested. It builds the header from `values`, dropping empty parts
(no "(ABN )" when a client has none), and uses the single-invoice payment wording when
`single`. It then appends `TERMS` and the numbered clauses, and fills `{fields}` in the intro and
clauses with today's `fillAgreement`.
- **Format:** `N. Title` on its own line, then the body. Sub-clauses read `(a) Heading. Text`,
  and indented ones `(i) …`.
- **Who calls it:** `signing.js agreementOf` (replacing `settings.agreementText`) and the
  Settings preview, so the two can't differ.
- **Templates with no clauses** fall back to `FALLBACK_TEXT`, as an empty text does today.

## Naming Conventions

| Concept | Label in UI | Notes |
|---|---|---|
| A numbered module | **Clause** | "+ Add clause", "Clause 4". In signed text, "4. Title" (U23). |
| A lettered point in a clause | **Sub-clause** | Lettered (a), and (i) when indented. Never typed. |
| The fixed top block | **Agreement header** | Filled per project. |
| The header's editable paragraph | **Intro** | |
| `business.signer` | **Signs for the business** | Settings → Business. |
| `{hourly_rate}` | **Hourly rate for extra work** | Settings → Service agreement. |
| Per-row and header action list | **Actions** | Menu button label "Actions". |
| Per-row file list | **Documents** | Menu button label "Documents". It holds only downloads. |
| The Project page's file panel | **Documents** | Same word, same idea: the files of this job. |
| The estimate, to the owner | **Estimate** | D30. |
| The estimate, to the client | **Quote** | D103: emails, client pages and agreement text. |
| Editor panels | Job details · Deliverables · Production booking · Services · On set, by day · Summary | Rail labels may be shortened (Job, Booking…). |

## Component Reuse Map

| Component | Used on | Behaviour differences |
|---|---|---|
| Panel (+ collapsible) | Project page, Invoice, Editor, Settings → Service agreement; later any screen | Editor panels collapse and remember. Project/Invoice panels are fixed except "The accepted estimate". |
| Menu button (`menu.js`) | Project header, document rows, Invoice header, editor sticky ⋯, editor Move to, clause ⋯, Clauses panel ⋯ | A bottom sheet below 768px everywhere. |
| Document row | Project page Documents panel | Estimate vs invoice item sets (tables above). |
| Jump rail | Settings (exists), Finance (exists), Editor (new use) | The editor's rail tracks scroll position. |
| Sticky action bar | Editor (new), Settings (existing `set-save-bar`, restyled) | The editor shows the live total. Settings shows the saved state. |
| Sortable list (drag + keyboard + menu) | Clause cards, sub-clause rows | Sub-clauses also indent and outdent. |
| Toast with Undo | Clause/sub-clause delete | |
| Mono eyebrow / ref / chip | Every header and document row, Projects cards, client chips | |
| Email shell | All six `mail.js` templates | The owner's notices use the same shell, with no client-facing footer details. |

## Content Growth Plan

- **Documents per project** grow with versions and voided or replaced invoices. Rows stay one
  line each because actions live in menus. Void rows are quieter and sorted after live ones.
- **Activity** grows without limit. The panel shows the latest 8 with **Show all (N)**, which
  expands in place.
- **Clauses** are expected to number about 10–20. Closed cards are about 48px each, so 20 fit in
  roughly one screen. No search or paging.
- **Sub-clauses** are a handful per clause. No limit.
- **Signed agreements** are one per signing, listed in the estimate's Documents ▾ newest first.

## URL Strategy

- **Patterns:** unchanged, `#/<section>/<id>/<sub>` (production-booking's router).
- **Dynamic segments:** project id and invoice id. Unchanged.
- **Query parameters:** none added. The Projects list's existing `?stage=` and search are
  untouched.
- **Panel anchors:** none. The router owns the hash, so in-page jumps use `scrollIntoView` and
  focus the panel heading.
