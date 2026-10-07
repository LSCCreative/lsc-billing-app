# Handover: UI Clarity

Read this file, then [`DECISIONS.md`](DECISIONS.md) (the user's answers U1–U23; don't re-ask), then
[`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) and [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md).

## What this is

There are three requests from the user, built as one track:
- **D1:** the UI is too busy. A new panel system, Actions ▾ and Documents ▾ menus, and a rework of
  the Project page, Invoice screen and Estimate editor.
- **D2:** branded emails, with the logo and "LSC Creative" in a light shell.
- **D3:** a modular service agreement builder in Settings, with drag-to-reorder,
  auto-numbering and lettered sub-clauses.

The work runs through `/design-flow`. **Model: Opus, effort high. Frontend task.**

## Account recovery (from `main`, merged 2026-10-07)

On 2026-10-07 another session built **account recovery** and deployed it (NAS **v15**, then Pages,
`main` `a728420`). It is merged into this branch. Its record is
`.design/account-recovery/HANDOVER.md`. Keep it working through every task. It adds:

- "Forgot password?" on the sign-in card, which emails a reset link through Resend. The link,
  `#/reset/<token>`, opens a new-password page; `app.js` answers it before the session check.
  `login.js` is now one card with five states (sign in, forgot, sent, new password, link expired).
- Sign-in takes the username **or** the account's email.
- **Settings → Account**, a seventh section after Card payments, with its own `<form>` and
  **Update account** button. Its fields are deliberately *not* in `form`, so they don’t touch
  Save settings or the unsaved-edit check.
- Server: `routes/account.js` (`/api/password/*` before the gate, `/api/account` behind it),
  schema **v15** (`account.email`, `password_resets`), `mail.js passwordResetEmail`, and
  `npm run set-email`.

**The merge:** `login.js` took `main`'s file with this branch's sentence case on its labels;
Account's labels are sentence case too ("Update account", "Save settings"). The new CSS uses the
legacy names (`--muted`, `--accent`, `--ok`, `--err-*`), which `tokens.css` aliases, so **don't
delete those aliases** (task 13 may move it onto `--color-*` names instead).

**Deploy trap:** the live database is v15, and `db.js` refuses to start on a newer database than
it knows. Every deploy (tasks 8, 15, 17) must ship a `server/` that has v15 and
`routes/account.js`. `git fetch` and merge `origin/main` before each deploy; other sessions push
`main` too.

## State as of 2026-10-06

- **Phase 1** (Grill Me): done. The answers are in DECISIONS.md.
- **Phase 2** (Design Brief): done, in `DESIGN_BRIEF.md`.
- **Phase 3** (IA): done, in `INFORMATION_ARCHITECTURE.md`. It covers the menu contents for
  every state, the editor's six panels, the agreement data shape and the `agreementText` render
  seam.
- **Phase 4** (tokens): done. `web/css/tokens.css` exists but is **not loaded yet**: wiring it
  into `index.html` and deleting `app.css`'s and `a11y.css`'s own `:root` values is build task 1.
  `.design/ui-clarity/tokens-preview.html` is the specimen. Open it with launch.json's `design`
  server at `/.design/ui-clarity/tokens-preview.html`.
- **Phase 5** (tasks): done, in `TASKS.md` (18 tasks).
- **Phase 6** (build) on branch **`ui-clarity`** (off `production-booking`, unpushed, not deployed).
  - [x] Task 1, tokens live (`07df49a`). `tokens.css` loads first in `web/index.html`, and in
    `web/c/index.html` with `<html data-theme="light">` (c.css's names now alias the tokens). No
    raw hex left in the screen CSS except Overhead's measured chart palette and warm-white alphas.
    Funnel Sans is deleted. Inputs moved to `--input-bg` / `--input-border` in app.css and wherever
    they used the old `#1a1c20` well; other inputs still read `--surface`/`--border` (task 13).
  - [x] Task 2, buttons and panels. Plain `.btn` **is** the secondary button (`.btn-secondary`
    needs no rule); `.btn-accent` = `.btn-primary`; `.btn-ghost` = quiet plus a hairline ring (kept
    for rows of document actions until tasks 9–10 move them into menus); `.btn-xs` = `.btn-sm`.
    Edges are inset shadows, so focus (`--shadow-focus`) replaces them. Panel markup and the
    collapsible variant are documented in `app.css`'s Panels comment; `web/js/panel.js` turns
    `.panel-toggle`s and fires `lsc:panel` ({open}) for task 11's remembered states and task 12's
    rail. Panels carry no margin (containers set `--panel-gap`); the legacy `.billing-block`,
    `.est-block`, `.pricing-section` keep a margin-bottom. `tokens-preview.html` now loads the real
    `app.css` and `panel.js` instead of copies.
  - [x] Task 3, the menu button (`2e1bd3f`). `web/js/menu.js` + `web/css/menu.css`; API in
    menu.js's header. `LSCMenu.markup({ label, items, ariaLabel?, icon?, btnClass? })` returns ''
    when nothing is available, so tasks 9–10 can concatenate it unconditionally. Items are
    `{ text, hint, danger, href, download, attrs }`, `'-'` or falsy; danger items are moved last
    below a divider automatically. `LSCMenu.open(opener, { label, items, onSelect, empty })` is for
    lists built on the spot (the editor's Move to and Add to a day use it; `.move-pop` is gone).
  - [x] Task 4, agreement clauses and the one render (`cc92530`). `documents.js` exports
    `DEFAULT_CLAUSES` (the user's 12 with Payment split in two, so 13: ids `c01`–`c13`; `c02` Deposit is deposit-only), `agreementText(agreement, values, { single })`
    → `{ text, unknown, blank }`, `FALLBACK_TEXT`, `AGREEMENT_TITLE` and `AGREEMENT_HEADS` (task 7
    styles those lines as heads). `docSettings().agreement` is `{ intro, clauses, hourlyRate }`;
    `agreementText` and `agreement.text` are gone. The seed JSON the user gave is
    `server/test/fixtures/agreement-seed.json`, and a test turns the defaults back into it.
  - [x] Task 5, the builder (`890def6`). Settings → Service agreement is panels (Header, Clauses,
    Agreement values, Fields you can use, Client page); Business gains **Signs for the business**
    (`business.signer`). `web/js/sortable.js` is the shared reorder helper; `Toast.ok(msg, { action })`
    gives the Undo.
  - [x] Task 6, sub-clauses and reset. Open cards edit their sub-clause rows (handle, letter,
    heading, text, ⋯ with Indent/Outdent/Move up/Move down/Delete); each card's row list has its
    own `LSCSortable` (`Clauses.wire`), attached at draw and on every insert. The Clauses panel
    head's ⋯ holds **Reset to LSC default clauses…** (`D.docSettings({}).agreement.clauses`).
  - [x] Task 7, clause headings. `documents.js agreementLayout(text)` → `{ kind, items, tail }`
    reads agreementText's format back from the stored text (never the clauses): title, section
    heads, numbered clause heads (sequential only), lettered/roman subs with hanging indents,
    continuation paragraphs at their sub's depth, the signing line. Lossless by construction and
    test. `pdf.js agreementBodyHtml` and `c.js showAgreement` draw it; the dialog joins `parts`
    with one NUL per slot, lays out, and puts the slot spans back in order.
- **Task 8, "Deploy system + D3" is ON HOLD (2026-10-08): the NAS is offline.** It is still the
  first deploy owed (fetch and merge `origin/main`, ship v15, NAS before Pages) and must still
  happen before any Pages push, because the old server ignores saved clauses. Don't attempt it,
  don't push `main`, and don't treat the offline NAS as a bug.
  - [x] Task 9, the Project page. `project-folder.js` draws the header (`headMarkup`: one
    `.btn-primary` = `nextAction`, Actions ▾ = `headerActions`), `noticeMarkup` (now also the
    dates-taken warning), and three `.panel`s; each document is `estimateDoc` / `invoiceDoc` →
    `docRow`. Menu items carry the old `data-act` / `data-doc`; `openerOf` gives dialogs the
    menu's button to return focus to. New row kinds: `inv-paid`, `inv-void` (hand over to the
    Invoice screen, which now takes `state.action` `'void'` as well as `'paid'`), and `duplicate`
    (the row's own estimate).
- **Next: task 10, "Invoice screen"** (frontend — Opus/high), then 11–14 and 16. These need no NAS
  or live app: build and verify only against local `api-scratch` / `api-scratch-mail`, never the
  live site or API. Skip the deploy tasks (8, 15, 17) until the user says the NAS is back; when it
  is, task 8 comes first, then 15 and 17. Commit locally on `ui-clarity`; don't push.
  Task 10 should move the Invoice screen off the `.pf-actions*`, `.pf-section-head`, `.pf-h2`
  rules kept at the foot of `project-folder.css` (marked), then delete them.

## Waiting on the user

- **Task 4's header wording** (below): to read and approve, or reword, before task 8 deploys it.

The logo is in `Visual Design/CS-Felice-Mono-Monospaced-Font/` (`LogoDark_ No Text.png`
for light grounds, `Logo Light_ No Text.png` for dark; 2000×2000, trim the margin) for task 16.
Metro Sans's licence (`Visual Design/Metro-Sans---Full-Family/Metro Sans License.pdf`) is free:
commercial use, web embedding and redistribution are all allowed, so it is live in `web/fonts/`.

## Decisions made in the build (tell the user)

- **D86 overridden by U17:** the editor's Deliverables block lost its terracotta border and tint
  (production-booking D86 made it the one non-neutral block). It is a plain panel now.
- **Invoice:** while extras are unsaved, Save extras takes the terracotta and the header's primary
  (Send…, Mark paid…) drops to secondary, so the view keeps one.
- Secondary "+ Add service / deliverable / date", Download CSV and the Cost Breakdown's Close are
  no longer terracotta. Title Case UI labels in `web/js/views` are sentence case now (data
  defaults like "New Service" untouched).

## Decisions made in task 9 (tell the user)

- **One terracotta on the page:** the header's next action. A document row's own button (Open,
  Send…, Send vN…) is a secondary button, so the rows don't compete with it.
- **Decline… is a danger item** (red, below the divider) in every menu, with Delete and Void.
- **Accepted with no invoices still offers Decline…** in the header: IA's table left it out, but
  today's rule (no live invoice) allows it, and this track doesn't change rules.
- **Row Mark paid… / Void and remake…** open the invoice's own page with that dialog already open.
- **Rows say more:** an overdue invoice reads OVERDUE · was due 4 Oct, an expired quote "expired
  5 Oct" in red, a void one VOID · voided … · replaced by ….
- **The dates-taken warning** moved from the Production days panel to the notices under the header.
- **Duplicate as new project** on a second estimate's row copies that estimate (the header's
  copies the lead). **Show all (N)** in Activity resets on each visit.

## Decisions made in task 4 (tell the user)

- **Header wording** (none was specified): `SERVICE AGREEMENT`; `PARTIES` (business name (ABN),
  "represented by" the signer, (the "Business"), email · phone; then the client the same way);
  the Intro; `PROJECT` ("…, as set out in quote X (the "Quote")", which defines "Quote" for the
  clauses); `PAYMENT SCHEDULE` (Total, Deposit (%), Balance, "Invoices are due N days after each
  is issued"; single: "Total: $X, on a single invoice, due N days after it is issued");
  `SCOPE AND PRODUCTION DAYS`; `TERMS`; the clauses; then
  "Signed for {client} by {name}, {role}, on {date}." The default Intro is the user's own line
  from their Blue Harvest agreement, with "your accepted quote" made "the Quote".
- **Deposit-only clauses** (user's request): `clause.depositOnly === true` leaves the clause out,
  unnumbered, when `agreementText` gets `{ single: true }` (signing passes the project's
  invoicing; the Settings preview passes the previewed project's). Only a real `true` counts.
  If every clause is deposit-only, a single invoice gets `FALLBACK_TEXT`.
- **Payment split (user, 2026-10-06):** the defaults' 2. Deposit (deposit-only) holds "A
  non-refundable deposit of {deposit_pct}… The balance is due on the date shown on the final
  invoice."; 3. Payment keeps the AUD/GST line and Late payment. A single invoice reads 12 clauses
  with Payment as 2; the header's payment row says when its one invoice is due.
- `hourlyRate` defaults to 63; `null` stored = cleared on purpose (the field is then blank).
- Blank sub-clauses and empty clauses are skipped and take no letter or number. An indented
  first sub-clause is lettered (and stored as indent 0).

## Decisions made in task 7 (tell the user)

- **The client page now loads `../js/documents.js`** (pure functions, no DOM/storage/requests),
  so the dialog and the PDF share one layout. Its header comment and c.js's say so.
- **Only the app's own format gets headings.** A text is 'clauses' only if it starts
  `SERVICE AGREEMENT`, then `PARTIES`, and has a `TERMS` block; `ACCEPTANCE OF QUOTE` gets its
  title and signing line; anything else (pre-task-4 free text) is plain paragraphs, even if it
  has "1. Payment" lines.
- **The (i) rule:** "(i)" after (h) is a letter unless the next mark is (ii); (v) and (x)
  likewise. A *lone* indented (i) under (h) is the same text as a ninth letter and reads as one
  (it loses its extra indent; the words are unchanged).
- Sub-clause headings aren't bolded: the text can't tell "Heading." from a first sentence.
- PDF heads are tracked only .06em: wider, and PDF readers copy "PARTIES" as "PA R T I E S".
- **The Settings preview draws with `agreementLayout` too** (settings.js `drawAgreement`, no
  slots; settings.css ports c.css's styles onto the dark tokens). Its `textContent` is still
  `filled.text` exactly.

## Decisions made in task 5 (tell the user)

- **The preview shows what's on screen, saved or not** (D39's original rule), not the saved
  clauses as task 4's interim did.
- **Cards are numbered by position**, as a deposit project reads them. A deposit-only clause
  carries a "Deposit only" tag; on a single invoice the render skips it and numbers on.
- A clause with sub-clauses calls its text box "Intro (optional)" (the label follows as rows
  are added or deleted).

## Decisions made in task 6 (tell the user)

- **A new, blank sub-clause is lettered at once** ((d)), so the card letters every row, blank or
  not, while the render skips blank ones. **Save drops blank rows**, so the two agree once
  saved. A row with only a heading (8(a) "By the Client") is not blank.
- **A row moved or left to the top loses its indent** (it has nothing to sit under); moving it
  back down doesn't restore it.
- **Rows move one at a time.** Moving a lettered row doesn't carry its (i)(ii) along; they
  re-letter under whichever lettered row is now above them.
- **Sub-clause delete has no confirm**, only the 10s Undo (back where it was, indent and all).
- **Reset** confirms with the count ("Your 12 clauses are replaced by the 13…"), skips the
  confirm when there are none, and its toast has Undo too (open cards come back open).
- The heading's placeholder is just "Heading" (the 375 box cut "(optional)" off); its
  accessible name still says optional.
- **Delete confirms only when the clause has text** (body or sub-clauses; a title alone doesn't
  count). Undo lasts 10s and holds while hovered or focused.
- **Field insertion** goes where the cursor last was in the Intro or a clause (else the Intro's
  end), opening that card if it was closed.
- **Missing** (Header panel) covers Email, Phone and Signs for the business; it jumps to the
  field and updates as you type.

## Traps

- **Agreement business details come from the version's frozen snapshot** (`snap.business`), as
  name and ABN always did. A link sent before Settings → Business email, phone and signer are
  filled offers a header without them, until it is re-sent.
- **`(i)` is ambiguous in the text** (the 9th letter and roman one): `agreementLayout` settles it
  by the next mark (task 7's decisions). Any new reader of the text must use that function.
- **`agreement.text` still rides in the live row** (merged through `loaded.agreement`, read by
  nothing). Left on purpose as a second copy of the user's old text; the pre-deploy backup is the
  first.
- The owner's agreement PDF route (`routes/projects.js`) always uses the real renderer and ignores
  `opts.renderPdf`; tests read a PDF through the client's `/public/estimates/:token/agreement`.

- **Testing declarative menus by script:** `el.click()` on a menu item does nothing in the end,
  because menu.js re-clicks the item in place and `HTMLElement.click()` is a no-op on an element
  whose own click is in progress. Real clicks are fine. Test with
  `el.dispatchEvent(new MouseEvent('click', { bubbles: true }))`. Task 9 will meet this too.
- **Stacked grids need `grid-template-columns: minmax(0, 1fr)`**, or a nowrap child (an
  ellipsised title, a chip) widens the column: the panels overflowed 375 by 54px until both
  `.set-agr-panels` and `.clause-list` had it.
- **sortable.js** takes items that are direct children of the list only, so task 6's sub-clause
  list inside a card attaches its own instance. Its `onMove(from, to)` must move data and node
  together, as `Clauses.move` does. The handle is `touch-action: none`.
- **Scratch DB recreated 2026-10-08** (macOS cleared /tmp). It holds the review dataset
  DRF-001…VOD-010 from [`seed-review.js`](seed-review.js) (its header lists each state); the old
  SEND-A…RVR-011 names are gone. Rebuild: seed the `dev` account (launch.json), start
  `api-scratch-mail`, `node .design/ui-clarity/seed-review.js server`. Its signing step was fixed
  after the run that built today's data (DPD-006 was signed by hand), so check it the first time.
- **Project page menus have stable ids** (`pf-menu-head`, `pf-menu-e-<estimateId>-act|doc`,
  `pf-menu-i-<invoiceId>-act|doc`): the quiet refresh after a send puts focus back by id, and
  waits while a menu is open (a redraw would close it).
- **On a phone the download toast sits over the foot of the page** for its few seconds, so a tap
  on Activity's Show all can land on the toast. Task 14 to look at (toast placement).
- **Menus (task 3):** an open list is moved into `<body>`, and a chosen declarative item is put
  back and `.click()`ed in place, so a screen's delegated `data-act` handler must listen on a
  container that holds the *closed* menu, not on the list. menu.js listens in the capture phase
  and stops Esc there, so Esc in a menu inside a dialog closes only the menu.
- Move to keeps its "No other day yet…" note (`open()`'s `empty`): its button is per line and
  exists before any day does. "A menu with no items isn't drawn" is `markup()`'s rule.
- **Screenshots:** a puppeteer `clip` capture resizes the viewport to 1×1 for a frame, which
  flips the 767px query (and restarts the menu's fade). menu.js ignores flips that don't settle
  (150ms); take menu shots with `captureBeyondViewport: false` and no clip.

- **The studio Mac has a Fontspring DEMO of Metro Sans installed** (`~/Library/Fonts/fontspring-demo-*`):
  its glyphs for `( ) - @` and some digits are `±`. Chrome falls back to an installed font of the
  same family name when a web font file 404s, so `tokens.css` names the face **'LSC Metro Sans'**.
  Keep that name. The masters in `Visual Design/` are the full family (checked).
- Screenshots: `node <scratch>/shots.js` pattern (headless Chrome via `server/node_modules/puppeteer-core`,
  in-page login, computed-colour scan for old palette values). `screenshots/` stays local, uncommitted.

- `.sum-label` is the mono caps figure label now; `.tax-setting .sum-label` scopes it back to a
  sentence-case title (Rate Card, Goals reuse it as a setting name).
- Metro Sans has **no tabular figures**: money uses `--font-figures` (mono), U24.
- Metro Sans: `web/fonts/MetroSans-{400,500,600}.woff2` are the Regular, Medium and Semi Bold
  webfonts from `Visual Design/Metro-Sans---Full-Family/`. A 700 request uses 600 (no synthetic
  bold). It lacks `▾ ⋯ ← → ↑ ↓ ✓ ±`, which come from the system face. The client pages don't use
  it (Delight + mono, by design).
- The Desktop Preservation Law in `app.css` is retired (U16). Rewrite that header comment when
  tokens land.
