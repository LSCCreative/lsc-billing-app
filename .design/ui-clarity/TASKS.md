# Build Tasks: UI Clarity

Generated from: [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md), [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md),
[`DECISIONS.md`](DECISIONS.md) (U1–U25, the user's; don't re-ask) and the tokens in
[`web/css/tokens.css`](../../web/css/tokens.css), whose specimen is [`tokens-preview.html`](tokens-preview.html).
Date: 6 October 2026

**Build order (U15):** system → **D3** agreement builder → **D1** screens → **D2** emails. Each stage
deploys on its own.

Every task carries a model/effort tag from root `CLAUDE.md`'s buckets. **Frontend** marks any task a
person looks at. State the tag out loud and pause for the user to switch before starting.

- **(frontend — Opus/high)**: UI build.
- **(money — Opus/high)**: renders or stores a computed price.
- **(signing — Opus/high)**: what a client signs, its text, hash or PDF.
- **(backend — Sonnet/high)**: routes, tests and config that move no price and no signed text.
- **(deploy — Sonnet/medium)**: infra steps.

## Ground rules for every task

- **Philosophy: functionalist, LSC-warm (U17).**
  - Terracotta marks one action per view or row.
  - Separation comes from layers and space, never extra borders or capitals.
  - New CSS uses only `tokens.css` names (`--color-*`, `--space-*`, `--font-*`…): no raw hex,
    px sizes or font names.
- **Mobile-first.** New CSS is written for 375px first, then `min-width` 768 and 1100. Below 768px
  every target is 44px and inputs are 16px.
- **Gate: `cd server && npm test`.** `documents.js` and `calc.js` are each two byte-identical
  copies (`server/src`, `web/js`), and the drift tests fail otherwise.
- **Verify in the browser** against `api-scratch` (or `api-scratch-mail` for anything that
  sends), at 1280, 800 and 375. Cache-bust the web JS first (memory: preview stale code).
  - Its review dataset covers every state: SEND-A, SEND-B, NBK-014, FLW-002, HCC-031, KTL-007,
    MRL-003, RVR-011 (see production-booking HANDOVER).
- **Menus keep today's rules.** What a menu offers in each state is IA's tables. *Whether* an
  action is allowed stays the existing code's decision (`nextAction`, `moreActions`, `actionsFor`,
  the send and void rules). This track moves buttons; it doesn't change permissions.
- **Signing invariants (U14):**
  - The text shown is the text signed.
  - The SHA-256 is of that text.
  - Signed agreements are never re-rendered from clauses.
  - A change while the client reads → `agreement_changed`.
- **Metro Sans is live** (its licence is free, with web embedding and redistribution allowed):
  `web/fonts/MetroSans-{400,500,600}.woff2`.
- **Account recovery is live on `main` (2026-10-07, schema v15)** and must survive every task:
  the login card's five states, `#/reset/<token>`, and Settings → Account. Merged into this
  branch 2026-10-07 (see HANDOVER). Never deploy a `server/` tree without v15.
- **Commits** are named `UI clarity: <task>`. When a task finishes, tick it and leave its title,
  commit and a one-line outcome; decisions and traps go to HANDOVER (root `CLAUDE.md`).

## Foundation: the system

- [x] **1. Tokens live, palette and type across the app** (frontend — Opus/high) **Frontend**
  - **Done** `07df49a`: every screen warm at 1280 and 375, no old colours left (computed-style scan), no overflow; screenshots `screenshots/task1-*`.
  - **Metro Sans added** once the licence arrived: all three weights load on every app screen at 1280/375, no overflow, no font errors; screenshots `screenshots/font-*`.
  - Load `tokens.css` first in `web/index.html`, and in `web/c/index.html` for the shared primitives
    only (the client pages stay light, via `[data-theme="light"]` or their own `c.css`).
  - Delete the `:root` values in `app.css` and `a11y.css` that the legacy aliases now supply, and
    rewrite `app.css`'s header to retire the Desktop Preservation Law (U16).
  - Body, inputs and buttons use `--font-family-body`.
  - Add the type primitives `.eyebrow`, `.ref`, `.fig` and the mono status chip (restyle
    `ProjectCard.statusChip` and the calendar chips onto `--color-status-*`).
  - Replace the scattered hard-coded colours (`#111` heads, `#1a1c20` inputs, `#e06060`,
    `#2C2F35`/`#3D4A5C` greys) with tokens.
  - **Done when:** every screen (Home, Projects, Project page, Editor, Estimate view, Invoice,
    Clients, Finance ×4, Rate Card, Settings, Login, client pages) renders in the warm palette at
    1280 and 375, with no blue-grey left and nothing broken. Screenshots go in `screenshots/`.
  - _Modifies: `app.css`, `a11y.css`, `index.html`, `project-card.js`, `calendar.css`. Reuses:
    `tokens.css`._

- [x] **2. Button hierarchy and the panel component** (frontend — Opus/high) **Frontend**
  - **Done** `4f01c5f`: four button kinds and the panel live; one terracotta per view on every screen at 1280/800/375 (scan), focus ring `--shadow-focus` everywhere, no overflow; screenshots `screenshots/task2-*`.
  - Rebuild `.btn` as primary (terracotta, the only caps button), secondary, quiet and danger, in
    sentence case (U4), in two sizes (`--control-h`, `--control-h-sm`). `.btn-accent`, `.btn-ghost`
    and `.btn-xs` map onto them so existing markup keeps working.
  - New `.panel` / `.panel-head` / `.panel-title` / `.panel-body` / `.panel-foot`.
  - The collapsible variant is a real `<button aria-expanded aria-controls>` whose summary stays
    visible when closed.
  - Restyle `.billing-block`, `.est-block` and `.bb-head` onto the panel look, so every screen
    using them improves at once.
  - Uppercase labels outside nav, eyebrows and chips become sentence case.
  - **Done when:** the button and panel sections of `tokens-preview.html` match the real app;
    no screen has more than one terracotta button per view or row; the focus ring is
    `--shadow-focus` everywhere.
  - _Depends on: 1. Modifies: `app.css`, `a11y.css`, `responsive.css`. New: panel classes._

- [x] **3. The menu button (`menu.js`)** (frontend — Opus/high) **Frontend**
  - **Done** `2e1bd3f`: `LSCMenu.markup` / `LSCMenu.open` live; every key, outside click, AX "Actions, menu button, collapsed", the 375 sheet (48px rows, Cancel, Esc, backdrop, Tab trap) checked in the specimen and the editor's Move to / Add to a day at 1280, 800, 375; screenshots `screenshots/task3-*`.
  - A shared `LSCMenu`: a button opens a `role="menu"` list of items. Items can be links,
    dividers or danger. A menu with no available items isn't rendered.
  - **Keyboard** (APG menu button): arrows, Home/End, typeahead, Enter/Space, and Esc returning
    focus. Outside click closes it.
  - **Below 768px** it is a bottom sheet with 48px rows, a Cancel row and the modal focus trap.
  - Move the editor's **Move to** popover (`estimate-editor.js` ~1355–1440) onto it.
  - **Done when:** in a scratch screen and in the editor's Move to, every key works, a screen
    reader hears "Actions, menu button, collapsed", and on 375 it opens as a sheet and closes
    on Cancel, Esc and backdrop.
  - _Depends on: 2. New: `web/js/menu.js`, menu CSS. Modifies: `estimate-editor.js`._

## D3: the service agreement builder

- [x] **4. Agreement clauses and the one render** (signing — Opus/high)
  - **Follow-up** (user, 2026-10-06): a per-clause **deposit-only** switch (`depositOnly`), left out and not numbered on a single-invoice project (`72f1a68`, both mutations caught). Then the user's Payment clause split into **2. Deposit** (deposit-only: the deposit and final-invoice sentences) and **3. Payment** (GST, late payment), so the defaults are 13 clauses (12 on a single invoice) (`898c5ec`, 557 green).
  - **Done** `cc92530`: 554 tests green, drift test passes; the three mutations (number from a stored field, broken letter sequence, single branch dropped) each fail tests; RVR-011's open link on a scratch copy offers the 12 defaults under the new header.
  - **Shapes** (IA "Data Shape"):
    - `documents.js` gains the default clauses: the user's 12, verbatim, with `a.` / `(i)` turned
      into `subs`, and `$63.00` → `{hourly_rate}` (U13).
    - `docSettings()` normalises `agreement.{intro, clauses, hourlyRate}`: missing → defaults,
      bad entries dropped, ids kept.
  - **New fields:** `hourly_rate`, `business_email`, `business_phone` and `business_signer` join
    `AGREEMENT_FIELDS` and `agreementValues`.
  - **The render:** `agreementText(agreement, values, { single })` builds the fixed header (U10,
    U22: empty parts dropped, single-invoice payment wording), then `TERMS` and the numbered
    clauses: `N. Title`, the body, `(a) Heading. Text`, `(i) …` for indented subs.
    - It fills `{fields}` through `fillAgreement`, so unknown fields are still listed.
    - No clauses → `FALLBACK_TEXT`.
  - `signing.js agreementOf` uses it in place of `settings.agreementText`. `agreement.text` is
    retired.
  - **Tests:**
    - `test-documents.js`: numbering follows array order; moving clause 4 to 2 renumbers; subs
      letter (a)(b) and indent to (i); blank ABN gives no "(ABN )"; single vs pair payment rows;
      `{deposit_pct}` and `{hourly_rate}` fill; unknown field reported; the defaults match the
      seed.
    - `test-public.js`: the text the GET offers is the text stored at signing and its SHA-256;
      reordering clauses between GET and sign → `agreement_changed`; a signature made before this
      task is byte-identical after it.
  - **Done when:** `npm test` is green, the drift test passes, and mutations are checked (swap the
    number source to a stored field, break the letter sequence, drop the single branch → a test
    fails each time).
  - _Modifies: `documents.js` ×2, `signing.js`, tests._

- [x] **5. The builder: header and clause cards** (frontend — Opus/high) **Frontend**
  - **Done** `890def6`: on scratch, clause 7 dragged to 2 and saved; the preview and the client link's agreement are byte-identical (header + all of TERMS). Real-key Alt+↑ and Tab focus ring checked; touch drag and the ⋯ sheet (Move up/down, 48px rows) at 375; no overflow at 1280/800/375; 565 tests green. Screenshots `screenshots/task5-*`.
  - Settings → Service agreement becomes these panels, in order:
    - The section intro and **Preview with a project…**.
    - **Header:** the locked layout with field chips, the **Intro** textarea, and "Missing" links
      for blank business email, phone or signer.
    - **Clauses:** cards with handle, number, title, chevron and ⋯ (Move up, Move down,
      Duplicate, Delete).
    - **Agreement values:** Hourly rate for extra work.
    - **Fields you can use:** a disclosure.
    - **Client page:** the FAQ URL.
  - Settings → Business gains **Signs for the business**.
  - **Clause cards:**
    - **Open and edit:** a card opens to edit its title and body, and a **Deposit projects only**
      checkbox (`depositOnly`, task 4 follow-up), with a hint that it's left out of a
      single-invoice agreement.
    - **Reorder:** by pointer drag (mouse and touch: placeholder line, `--color-accent-mark`), by
      Alt+↑/↓ on the handle, and from the ⋯ menu. Every card renumbers on drop, and one polite
      live region says "Payment moved to clause 2 of 13".
    - **Add and delete:** + Add clause opens a new card with focus in its title. Delete shows a
      toast with **Undo** (`toast.js` gains an optional action) and confirms first only if the
      clause has text.
  - **Saving and preview:** Save goes through the existing settings save bar and unsaved-changes
    guard. The preview dialog calls `agreementText`.
  - The sortable logic is one helper (`web/js/sortable.js`), so task 6 reuses it.
  - **Done when:**
    - On scratch, dragging clause 7 to position 2 and saving shows the new numbering in the
      preview, and the client sign dialog on SEND-A's link offers the same text.
    - Keyboard-only reorder works.
    - At 375 the drag works by touch and the ⋯ menu offers Move up/down.
  - _Depends on: 3, 4. Modifies: `settings.js`, `settings.css`, `toast.js`. New: `sortable.js`._
  - Settings now has a seventh section, **Account** (account recovery). Keep it, its own form
    and its Update account button outside Save settings.

- [x] **6. Sub-clauses and reset** (frontend — Opus/high) **Frontend**
  - **Done** `23e5e69`: clause 5 reads (a) Raw materials, (b) Client licence, (c) Portfolio use; a new row is (d) at once, moved up and indented it is (b)(i) in the card, the preview and the stored settings; Reset (confirm names the count, Undo) restored and saved the 13 defaults. Alt+↑/↓ and ⋯ at both levels, pointer drag, Tab focus ring; at 375 44px targets, 16px inputs, the ⋯ sheet (Outdent on an indented row, 48px rows), no overflow at 1280/800/375; 565 green. Screenshots `screenshots/task6-*`.
  - Inside an open card, add a **Sub-clauses** list. Each row has a handle, an auto letter, an
    optional heading, text and ⋯ (Indent, Outdent, Move up, Move down, Delete).
  - Letters re-flow at once: (a)(b)(c), and (i)(ii) under the row above when indented. An indented
    first row can't exist: Indent is offered only from the second row on.
  - **+ Add sub-clause.** Delete has toast Undo.
  - The Clauses panel's ⋯ gets **Reset to LSC default clauses…**, with a confirm naming how many
    clauses will be replaced.
  - **Done when:**
    - Clause 5 in the default set shows (a) Raw materials, (b) Client licence, (c) Portfolio use.
    - Indenting a new row under (b) makes it (b)(i) in the card and in the preview.
    - Reset restores the 13 defaults.
    - Keyboard and 375 checks as in task 5.
  - _Depends on: 5. Reuses: `sortable.js`, `menu.js`._

- [x] **7. Clause headings on the sign dialog and agreement PDF** (signing — Opus/high) **Frontend**
  - **Done** (commit below): `documents.js agreementLayout` reads the format back from the text; the dialog (h3/h4/h5) and PDF (h1/h2/h3) draw it. On SEND-A the dialog's text equals the offered parts at 1280/800/375 and the signed row's text and SHA; `test-pdf.js` strips the PDF's tags back to `agreement_text` exactly; free text prints as plain paragraphs; separator and roman-rule mutations each fail tests; 574 green. Screenshots `screenshots/task7-*`.
  - The client sign dialog (`web/c/c.js showAgreement`) and `pdf.js buildAgreementHtml` render the
    app's own format, from the stored text, purely as presentation:
    - `TERMS` and the header labels as section heads.
    - `N. Title` lines as headings.
    - `(a)` / `(i)` paragraphs with a hanging indent.
  - The characters, the slots for name and role, and the hash are untouched.
  - **Done when:**
    - `test-pdf.js` asserts the PDF HTML's visible text equals `agreement_text` exactly.
    - SEND-A's dialog and signed PDF read with headings at 1280 and 375.
    - An agreement signed before task 4 (free text) still renders, as plain paragraphs.
  - _Depends on: 4. Modifies: `web/c/c.js`, `web/c/c.css`, `server/src/pdf.js`, `test-pdf.js`._

- [ ] **8. Deploy system + D3** (deploy — Sonnet/medium)
  - **Fetch and merge `origin/main` first.** The server tree must contain schema **v15** (`db.js`) and
    `routes/account.js`; one without them won't boot on the live database. Back up as
    `pre-<task>-<date>.db`; the boot log should show no migration (already v15).
  - **NAS before Pages:** the old server reads `agreement.text`, and a new Settings page saves
    clauses, which it would ignore and fall back to `FALLBACK_TEXT`.
  - Back up the live DB (it keeps the old agreement text).
  - Copy the code by tar over ssh (`DEPLOYMENT.md`). Confirm the boot log, then that
    `/public/estimates/:token` offers the default clauses for an open link, if one exists.
  - Then push `main` for Pages.
  - **Ask the user before deploying.**
  - **After deploying:** the user fills Settings → Business email, phone and Signs for the
    business, and checks the 13 clauses.
  - _Depends on: 1–7._

## D1: the busy screens

- [ ] **9. Project page** (frontend — Opus/high) **Frontend**
  - Rebuild `project-folder.js`'s markup per IA:
    - **Header:** eyebrow UPID, title, client, stage line, facts, then **one primary** and
      **Actions ▾** (IA "Project header" table).
    - **Documents** panel as the wide main column. Each row has name + mono ref, status + send
      status, a `--font-figures` amount, then primary, **Actions ▾** and **Documents ▾** (IA
      "Estimate row" and "Invoice row" tables). The Cost Breakdown and Signed agreement rows fold
      into Documents ▾. Void rows are quiet and sort last.
    - **Production days** and **Activity** panels in the side column. Activity shows the latest 8
      with **Show all (N)**.
    - Notices full width under the header.
  - Every existing `data-act` / `data-doc` handler keeps working from menu items.
  - **Done when:** each scratch project (draft, sent, expired, accepted needing invoices, deposit
    overdue, deposit paid, single paid, declined, legacy) shows exactly IA's primary and menu
    items, and every action still runs (send panel, copy link, PDFs, accept, decline, delete
    refusals). Checked at 1280, 800 and 375, where Documents comes first.
  - _Depends on: 2, 3. Modifies: `project-folder.js`, `project-folder.css`, `responsive.css`._

- [ ] **10. Invoice screen** (frontend — Opus/high) **Frontend**
  - **Header:** mono number eyebrow, kind title, project · client, status, and the **Balance
    due** figure in Delight. Then one primary, **Actions ▾** and **Documents ▾** (IA invoice
    table, Invoice-screen column).
  - **Notices**, then panels: **The accepted estimate** (collapsed), **Extras** with Save extras
    in its footer, and **Balance**.
  - Money in rows uses `--font-figures`.
  - **Done when:** draft, scheduled, sent, paid, void (with replacement), legacy and a final
    whose deposit was voided each show the right primary and menus, and Send, Mark paid, Void
    and remake, Copy link and both PDFs still work. Checked at 1280, 800 and 375.
  - _Depends on: 2, 3. Modifies: `invoice.js`, `invoice.css`._

- [ ] **11. Editor: six panels** (money — Opus/high) **Frontend**
  - Regroup the editor into **Job details · Deliverables · Production booking · Services · On
    set, by day · Summary** (U21). Pre, Post and Additional become sub-sections of Services, and
    Production, Travel, Crew and Equipment become sub-sections of On set.
  - Each header shows a summary from figures the editor already computes (no new maths): the job
    line, the deliverable count, the booking line, the services subtotal, the on-set subtotal and
    the client total.
  - **Collapsing:**
    - Job details starts collapsed on an existing estimate.
    - Open/closed states are remembered per browser (`localStorage` in try/catch).
    - A collapsed panel keeps its inputs in the DOM, so `collect()` and the unsaved guard are
      unaffected.
  - **Done when:**
    - NBK-014 opens with Job details collapsed, and every summary matches the figures inside
      its panel.
    - Collapsing any panel and saving changes nothing in the saved estimate (compare the PUT
      body before and after).
    - Checked at 1280, 800 and 375.
  - _Depends on: 2. Modifies: `estimate-editor.js`, `booking-block.js` (its own toggle becomes
    the panel's), `estimates.css`, `booking.css`._

- [ ] **12. Editor: jump rail and sticky bar** (money — Opus/high) **Frontend**
  - **Jump rail** (the Settings/Finance rail pattern) beside the panels at ≥1100px; a
    "Jump to…" select below that. It scrolls, opens a closed panel, focuses its heading,
    highlights the panel in view, and never touches the hash.
  - **Sticky bottom bar:**
    - The live client total (inc GST) in Delight.
    - **⋯** with Delete estimate… and How this is calculated.
    - Cancel and **Save**. Save keeps D104's "Save and send the update".
    - The old `form-actions` row goes.
  - **Done when:** the total in the bar always equals the Summary panel's total while editing
    lines; Save, Save and send the update, Cancel's unsaved guard and Delete's refusals work as
    before; on 375 the bar shows the total, ⋯ and Save, with Cancel in ⋯.
  - _Depends on: 3, 11. Modifies: `estimate-editor.js`, `estimates.css`._

- [ ] **13. System sweep of the other screens** (frontend — Opus/high) **Frontend**
  - Home, Projects list and cards, Clients, Estimate view, Finance (Dashboard, Capacity,
    Depreciation, Goals), Rate Card, the rest of Settings (including **Account**), Login (all
    five states: sign in, forgot, sent, new password, link expired, via `#/reset/<token>`) and
    the setup screens:
    - Fix anything tasks 1–3 left misaligned.
    - Move remaining caps buttons to sentence case.
    - Put each screen's sections on `.panel` where the markup already groups them.
    - Keep one terracotta per view.
  - No re-layouts (out of scope).
  - **Done when:** a 1280 and 375 screenshot of each screen shows no old-style outlined caps
    buttons, no blue-grey and no double terracotta.
  - _Depends on: 1–3._

- [ ] **14. Accessibility and responsive pass** (frontend — Opus/high) **Frontend**
  - Across tasks 3, 5, 6, 9–12:
    - Contrast checked per surface.
    - Every menu, panel toggle, card and sub-clause usable by keyboard alone.
    - Focus lands sensibly after collapse, delete, reorder and menu close.
    - Live-region announcements; drag alternatives (WCAG 2.5.7).
    - 44px targets below 768px; `prefers-reduced-motion`.
    - Each screen checked at 1280, 800 and 375 with no horizontal scroll.
  - A VoiceOver listen is left for a person (as in earlier tracks), with a list of what to hear.
  - _Depends on: 9–12._

- [ ] **15. Deploy D1** (deploy — Sonnet/medium)
  - Pages only (no server change since task 8). Ask first. `git fetch` and fast-forward onto
    `origin/main` first: other sessions push `main` too. Check the live Project page, Invoice
    and Editor on one real project.
  - _Depends on: 9–14._

## D2: branded emails

- [ ] **16. The branded email shell** (frontend — Opus/high) **Frontend**
  - **The logo:** `Visual Design/CS-Felice-Mono-Monospaced-Font/LogoDark_ No Text.png` (dark heads,
    for the paper background; `Logo Light_ No Text.png` is for dark grounds). Each is 2000×2000 with a
    wide empty margin, so trim it to the mark before scaling.
  - Host it as a 2× PNG at `web/email/logo.png` (Pages), referenced by absolute URL from the
    Pages base. Gmail and Outlook block SVG and embedded images (U7).
  - Rebuild `mail.js shell()` (U8):
    - Paper `#F0EDE8` background.
    - Logo (alt "LSC Creative") and the "LSC Creative" wordmark above the body.
    - The white card: heading, project line, message, then the button in `#8C4832` with white
      text (6.8:1).
    - The URL printed below the button.
    - A footer with the business name · ABN · email · phone · lsccreative.studio.
  - Table-based, with inline styles only, and readable at 320px and with images off.
  - `passwordResetEmail` (account recovery) uses `shell()` too, so it's a seventh template. Keep
    its link, its 30-minute wording and its plain text, and give it the owner variant (no client
    footer).
  - Pass the business details into all six templates from their callers (`sends.js`,
    `signing.js`, the test route). The owner notices use the shell without the client footer.
    The plain-text versions are unchanged.
  - `test-mail.js` asserts:
    - The logo `src` is absolute and `alt` present.
    - The wordmark is present.
    - Each template's button `href` is its link.
    - The footer shows only the details that are set.
    - Nothing owner-only appears in a client email.
  - **Done when:** `api-scratch-mail` prints each email. They're opened in the browser at 600
    and 320 (screenshots in `screenshots/`), and the user approves the look.
  - _Modifies: `mail.js`, `sends.js`, `signing.js`, `routes/email.js`, `test-mail.js`. New:
    `web/email/logo.png`._

- [ ] **17. Deploy D2** (deploy — Sonnet/medium)
  - **Pages before NAS this time:** the logo must already be live at its URL before any email
    references it. Push `main`, check that the logo URL returns 200, then tar the server to the
    NAS and check the boot log.
  - Settings → Email → **Send a test email** to the user, who confirms it in Gmail on a phone
    and desktop.
  - Ask first.
  - _Depends on: 16._

## Review

- [ ] **18. Design review:** run `/design-review` against the brief. Screenshots of the Project
  page, Invoice, Editor, agreement builder, sign dialog and one email at 1280, 800 and 375 go in
  `screenshots/`. Fix the must-fix items before closing the track.
