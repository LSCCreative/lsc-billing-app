# Design Brief: UI Clarity

Three requests from the user, built as one track: **D1** (the app is too busy), **D2** (branded
emails) and **D3** (a modular service agreement builder). The user's answers are U1–U19 in
[`DECISIONS.md`](DECISIONS.md); this brief doesn't restate the reasoning.

## Problem

The owner runs every job through this app: quoting, booking days, sending, invoicing. On most
screens everything looks the same. Panels, tabs, menus, buttons and labels share one surface, one
border and one small capital-letter style, so nothing tells the eye where one thing ends and the
next begins. A single document row on the Project page carries four or five identical outlined
buttons. The Estimate editor is one 4,900px scroll where the calendar, day cards, service tables
and totals all run together. Finding the one thing to do next means reading everything.

Clients see two other weak spots. The emails the app sends are plain black text, with no logo and
nothing to say who they're from at a glance. The service agreement is one long text box: reordering
a clause means cutting and pasting and renumbering by hand, and one slip leaves a signed agreement
with "3, 5, 6".

## Solution

The app gains a clear structure:
- **Layered panels.** Each section is a panel lifted off a darker page, with its own header bar.
  Rows inside a panel are separated only by hairlines.
- **One loud action per view.** Each screen and each document has one terracotta primary action.
  Everything else sits one click away in an **Actions ▾** or **Documents ▾** menu.
- **Quieter labels.** Capitals are kept for the small set of labels that need them, set in mono so
  they read as metadata rather than buttons.
- **The editor.** It stays one page, now a stack of collapsible panels. A jump rail sits beside
  them, and the client total and Save are pinned at the bottom.

Emails arrive looking like the client page they open: LSC's logo and name on warm paper, the
message on a white card, and a terracotta button.

The service agreement becomes a builder. A fixed header, filled in per project (parties, project,
payment schedule, scope), sits above a stack of clause cards. Each card shows its number and
title. Clicking a card opens it to edit its title, intro and lettered sub-clauses. Dragging a card
to a new position renumbers everything immediately, and the client signs the result exactly as
before.

## Experience Principles

1. **One loud thing per view.** Calm beats complete. Terracotta marks the single next action on
   a screen or row. Secondary actions are reachable but quiet: in a menu, or a ghost button. When
   in doubt, a thing goes into the menu.
2. **Structure from space and layers, not lines.** Separation comes from surface level, padding
   and grouping. A new border, divider or capital is added only when space can't do the job. Each
   panel answers one question ("What's booked?", "What's been sent?").
3. **Collapse, never hide.** The overview stays intact. The editor stays one page with totals
   always in view. A collapsed panel still shows its summary (count, subtotal). Agreement cards
   show every clause title when closed. A menu never hides the only way to do something urgent.

## Aesthetic Direction

- **Philosophy:** functionalist, LSC-warm (U17). This is Dieter Rams discipline inside LSC's
  warm dark:
  - One accent: terracotta, used only for the primary action and live focus.
  - One spacing scale (4px base, 8px rhythm) and one type scale, used strictly.
  - Warm near-black layers replace today's blue-grey `#2C2F35` / `#3D4A5C`.
  - Hairlines over boxes. Corners slightly rounded and consistent. No decorative shadow, only a
    soft one on floating layers (menus, dialogs, the sticky bar).
- **Tone:** calm, precise and confident: a studio's production desk, not an admin back-office.
- **Reference points** (U18):
  - **Linear:** layered dark panels, quiet secondary actions and ⋯ menus.
  - **Stripe Dashboard:** document and invoice rows with clear status, one primary action and the
    rest in a menu.
  - **Frame.io:** a dark creative-industry tool that feels made for film people.
- **Anti-references:** the current look (everything outlined, everything in capitals), Bootstrap
  or admin templates, generic SaaS (purple gradients, glassmorphism, Inter), and anything that
  looks like accounting software.
- **Type (U19):**
  - **Delight** (700) for page titles, panel titles and big figures.
  - **Metro Sans** (new) for reading text: paragraphs, form fields, buttons and table cells.
  - **CS Felice Mono** for eyebrow labels, UPIDs, invoice numbers and status chips: the only
    text that stays in capitals.

## Existing Patterns

The **Desktop Preservation Law is retired** (U16). `app.css` is edited directly, and its header
comment is rewritten. The earlier override files (`responsive.css`, `a11y.css`) stay, but values
they patched move into the tokens where that's cleaner.

- **Typography:**
  - Funnel Sans (variable) is the body font today. It is replaced by Metro Sans.
  - Delight 400/700 is used for headings.
  - CS Felice Mono is in `web/fonts/` but used only by the client pages (`web/c/c.css`).
  - The base size is 13px. Labels are 9–11px uppercase with 0.08–0.12em tracking, used everywhere:
    this is the main source of noise.
- **Colours:** `app.css :root` holds `--bg #181818`, `--surface #2C2F35`, `--border #3D4A5C`,
  `--accent #B85444`, `--ah #9a3d31`, `--muted` and `--muted2`. `a11y.css` lifts `--muted` to
  0.6 alpha and adds `--accent-text #c1695a`. Many hard-coded colours are scattered through the
  files: `#111` panel heads, `#1a1c20` inputs, `#e06060` danger, and others. The site's brand
  tokens (`--lsc-black #0E0E0E`, `--lsc-white #F0EDE8`, `--lsc-terra #C0603C`, `--lsc-terra-dk
  #8C4832`) are used by the client pages and by the emails (D2).
- **Spacing:** there is no scale. Padding is hard-coded per rule (5/7/8/9/14/18/22px). Radius is
  mostly 0 (4px on nav links).
- **Breakpoints:** `responsive.css` uses max-width bands at 1099 / 900 / 767px. Desktop is
  ≥1100px. New CSS is written mobile-first with `min-width` queries; the old bands are folded in
  as screens are reworked.
- **Components:**
  - `.btn` with `-accent`, `-ghost`, `-danger`, `-sm`, `-xs`, all uppercase.
  - `.billing-block` / `.bb-head` (`.collapsible`) and `.est-block` are panel precursors.
  - `.field` forms, `.gt-*` grid tables and `.summary-bar`.
  - `web/js/modal.js`: the shared focus trap.
  - `web/js/toast.js`: no Undo yet.
  - The editor's **Move to** popover (`estimate-editor.js` ~1355–1440): the only `role="menu"`
    in the app, with outside-click close.
  - The editor's pointer-event line drag (~1529).
  - Settings and Finance have a **jump rail** (`.set-rail`; a jump list below 1100px).
  - `ProjectCard.statusChip` / `stageMarkup`, `SendPanel.statusMarkup`.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Design tokens (`app.css :root`) | Modify | Surfaces ×3, text ×3, hairline/border, accent + accent-text, danger, success, warning; spacing, radius, type and shadow scales; three font families. Phase 4 produces them. |
| Fonts | Modify | Add Metro Sans `.woff2` (Regular, Medium, Semi Bold; Book if needed) to `web/fonts/`. Use CS Felice Mono in the app. Retire Funnel Sans once nothing uses it. |
| Panel (`.panel`, `-head`, `-body`, `-foot`) | New | Replaces `.billing-block`, `.est-block` and the folder's sections. The header holds a title, an optional count or subtotal, and at most one action. |
| Collapsible panel | Modify | Built on `.bb-head.collapsible`. A real `<button aria-expanded>`. The summary stays visible when collapsed. |
| Button hierarchy | Modify | Primary (terracotta, the one caps button), secondary (filled surface), quiet (text and ghost), danger. Sentence case. Two sizes. 44px touch targets below 768px. |
| Menu button (`Actions ▾`, `Documents ▾`, `⋯`) | New | Shared `web/js/menu.js`, generalised from the editor's Move to popover. Follows the APG menu button pattern. Below 768px it becomes a bottom sheet. The editor's Move to switches to it. |
| Document row | Modify | `pf-doc`: name + mono number, status line, amount, primary button, Actions ▾ and Documents ▾ (U3). |
| Eyebrow / ID / chip type styles | New | `.eyebrow`, `.ref` (UPID, invoice number) and the status chip, all in CS Felice Mono. |
| Status chip | Modify | `statusChip` restyled in mono. Shape and colour stay paired (DR15). |
| Jump rail | Exists → reuse | The Settings/Finance rail pattern, used by the Estimate editor (U5). |
| Sticky action bar | New | The editor's bottom bar: client total, Cancel, Save. Reusable for the agreement builder's Save. |
| Project page | Modify | Header (one primary + Actions ▾), Production days panel, Documents panel, Activity panel. |
| Invoice screen | Modify | The same panel and menu treatment. |
| Estimate editor | Modify | Section panels, jump rail and sticky bar. The booking block's calendar and day cards are re-layered inside their panel, not rebuilt. |
| Agreement header block | New | Fixed, filled per project (U10): Parties, Project, Payment schedule, Scope + production days. Shows field chips in Settings. Deposit and Balance rows hide for a single invoice. |
| Agreement module card | New | Accordion card: drag handle, auto number, title, chevron; Actions ⋯ (Move up, Move down, Duplicate, Delete). When open: title input, intro textarea, sub-clause list. |
| Sub-clause row | New | Optional heading + text. Drag to reorder. Indent and outdent one level. Auto-lettered (a)… and (i)… (U12). |
| Drag-and-drop reorder | New | Pointer events (mouse and touch), modelled on the editor's line drag. Keyboard and menu alternatives are always present. |
| `{hourly_rate}` field | New | One money input under Settings → Service agreement. It joins `AGREEMENT_FIELDS` (U13). |
| Agreement render | Modify | `documents.js` (server + web, drift-tested) gains one function that turns header + modules + values into the numbered text that is signed. `signing.js` and the Settings preview both call it. |
| Sign dialog and agreement PDF | Modify | Clause titles render as headings, from the numbered text the app itself generates. The text and hash stay exactly what was signed. |
| Toast with Undo | Modify | `toast.js` gains an optional action, used for deleting a module or sub-clause. |
| Email shell (`mail.js shell()`) | Modify | Light, in the site's colours: logo + "LSC Creative" header, white card, terracotta button, business footer. It applies to all six templates. |

## Key Interactions

**Menus.**
- **Opening:** clicking `Actions ▾` opens the menu under the button, with focus on the first item.
- **Keys:** arrows move, Home and End jump, typing a letter jumps to the item, Enter or Space
  chooses, and Esc closes and returns focus to the button. Clicking outside also closes it.
- **Danger items** (Delete, Void, Decline) sit last, below a divider, in danger colour. They still
  open their existing confirm dialogs.
- **Unavailable actions:** an action that can't run right now is left out of the menu, not shown
  disabled. The existing rules decide availability (sendable stage, a live link, and so on).

**Document row.**
- **Primary button:** Open for a sent or paid document, Send… for a draft.
- **Actions ▾:** Edit, Send vN…, Copy link, Duplicate, Decline…, Void…
- **Documents ▾:** Estimate PDF, Invoice PDF, Cost Breakdown, Signed agreement.
- **Copy link** gives the same "Copied" toast it does today.

**Editor.**
- **Panels:** each panel header toggles its body. A collapsed panel keeps its title, count and
  subtotal. The open/closed state is remembered per browser.
- **Jump rail:** scrolls to a panel (opening it if it's collapsed) and highlights the panel in
  view.
- **Sticky bar:** the total updates live. Save keeps its current behaviour, including D104's
  "Save and send the update".

**Agreement builder.**
- **Opening a card:** clicking a card's title row expands it to edit. Several cards can be open
  at once.
- **Editing:** edits are local until Save. The existing unsaved-changes guard applies.
- **Reordering clauses:** drag a card by its handle. A placeholder shows where it will land, and
  the numbers on every card update on drop. Keyboard and screen-reader users get Move up and
  Move down in the card's ⋯ menu, plus Alt+↑ / Alt+↓ on a focused handle.
- **Announcements:** each move is announced, e.g. "Payment moved to section 2 of 12".
- **Sub-clauses:** each row has a handle to drag it, and Indent / Outdent letters it (a) or (i).
  The letters re-flow at once.
- **Deleting:** removing a module or sub-clause shows a toast with Undo. Delete asks to confirm
  only if the module has text.
- **Adding:** `+ Add clause` appends a card that is open, with focus in its title. The first
  time, the builder starts from the user's 12 modules (U13).
- **Preview:** "Preview with a project…" (the existing dialog) shows the filled, numbered text.

**Signing (client).** The dialog shows the same numbered text, with titles as headings. Signing,
the stored text, the SHA-256 and the PDF work as they do today (U14).

**Emails.** Nothing about sending changes. The HTML shell is new; the plain-text version is kept.

## Responsive Behavior

Built mobile-first: 375px first, then `min-width` 768px and 1100px.

**Below 768px (phone):**
- **Menus** open as bottom sheets with 48px rows and a Cancel row.
- **Document rows** stack: name and amount, then status, then the primary button full width with
  the two menu buttons beside it.
- **Editor:**
  - The jump rail becomes a "Jump to…" select at the top.
  - The sticky bar shows the total and Save; Cancel moves into its ⋯.
  - Table panels keep their existing phone layouts, restyled.
- **Agreement cards:** the drag handle stays (touch drag via pointer events), and Move up / Move
  down are always in the ⋯ menu.

**768–1099px (tablet):** panels at full width. The rail is still the select.

**1100px and up (desktop):**
- **Editor:** the rail sits beside the panels.
- **Project page:** two columns as today (days + activity | documents), now as panels.
- **Agreement builder:** sits in the Settings content column with its existing rail.

**Emails:** a 560px column, readable at 320px.

## Accessibility Requirements

- **Contrast:** text 4.5:1 on its own surface, large text and UI parts 3:1. This is checked for
  every surface level and stated next to each token (the existing `a11y.css` habit).
  - Terracotta as text uses the lifted `--accent-text`.
  - Mono at small sizes is held to 4.5:1. No mono below 11px.
- **Keyboard:**
  - Every menu, panel toggle, card and sub-clause works by keyboard alone.
  - The focus ring is the existing `:focus-visible` treatment, moved into tokens.
  - Focus is never lost on collapse, delete or reorder: it goes to the moved card's handle, or,
    after a delete, to the next card or the Add button.
- **Screen readers:**
  - Menu buttons use `aria-haspopup="menu"` and `aria-expanded`.
  - Panels are `<section aria-labelledby>`. Panel toggles are buttons with `aria-expanded` and
    `aria-controls`.
  - Section numbers are real text in the card ("Section 2, Payment").
  - Reorders and deletes are announced through one polite live region.
- **Drag** always has a non-drag equivalent (WCAG 2.5.7).
- **Touch targets:** 44×44px below 768px.
- **Motion:** expand/collapse and drag settle are under 200ms, and `prefers-reduced-motion`
  removes them.
- **Dialogs** keep `modal.js`'s focus trap.
- **Emails:** the logo has alt text "LSC Creative". The wordmark text is also there, so an email
  with images blocked still says who sent it. The button is a real link with its URL printed
  below.

## Out of Scope

- A full rework of other screens: Home, Projects list, Clients, Finance & Price (Dashboard,
  Capacity, Depreciation, Goals), Rate Card, the rest of Settings and Login. They get only the
  system-level change (tokens, fonts, buttons, panels where a class is shared).
- A light theme or theme toggle (U6). The client pages stay as they are, apart from the sign
  dialog's clause headings.
- Per-project agreement edits (U9). Cross-references, pinned or essential clauses, and a live
  preview pane (U11).
- Any change to what is signed or how: the text and hash model, version freezing and the PDF
  storage (U14). Signed agreements are never re-rendered from modules.
- New email types, wording changes beyond the header and footer, and the send queue.
- Stripe (production-booking task 31, held), the HubSpot sync and the Client Hub.
- Money maths (`calc.js` is untouched).

## Open Questions

1. **The logo file** (U7): needed before the D2 task. Ideally a PNG at 2× for a light
   background, or an SVG to export from.
2. **Metro Sans licence:** no licence came with the folder. The font's own notice reads
   "Copyright © 2017 by Samuel Oakes. All rights reserved." The repo is public and Pages serves
   the files (Delight has the same issue and is handled by committing only the needed `.woff2`).
   Confirm that web embedding is allowed before the fonts are committed.
3. **Money figures:** checked. **Metro Sans has no tabular figures**: it has no OpenType
   features at all, and its digits are proportional ("0" is 629 units wide, "1" is 551). Columns
   of money would not line up. Phase 4 decides what sets money: CS Felice Mono (monospaced, so
   it aligns by nature), Delight for big totals, or keeping Funnel Sans's tabular figures for
   numbers only.
