# Design Review: UI Clarity (D1, D2, D3)

Reviewed against: [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md), [`DECISIONS.md`](DECISIONS.md) (U1–U25)
Philosophy: functionalist, LSC-warm (U17)
Date: 12 October 2026 (task 18)

## How it was checked

- **Setup:** the worktree's own API and web (`api-uic` :8081, `web-uic` :5174), on its scratch copy
  of the review data. Headless Chrome (`server/node_modules/puppeteer-core`) at 1280×800, 800×1024
  and 375×812 (as a phone).
- **Screens:**
  - The Project page in three states: DEP-005 deposit overdue, DPD-006 signed and deposit paid,
    DRF-001 a draft.
  - The Invoice: a sent deposit and a draft final.
  - The editor: NBK-014, which has a line in every section.
  - The agreement builder: the header, the clause list, and clause 5 open.
  - The client page and its sign dialog: SNT-002.
  - The quote email (`preview-mail.js`).
  - The estimate row's Actions ▾, as a menu and as the phone sheet.
- **Probes on every screen:**
  - sideways scroll;
  - the count of terracotta buttons;
  - every leaf element painted in terracotta;
  - the font of every money figure;
  - axe-core (WCAG 2.1 AA and best practice).

## Screenshots Captured

All in `screenshots/task18/` (local only, gitignored). Each set is at `-1280`, `-800` and `-375`.

| Screenshot set | Shows |
| --- | --- |
| `review-project-DEP005-*` | Project page: deposit overdue; header with one primary + Actions ▾; Documents, Production days, Activity |
| `review-project-DPD006-*` | Project page: signed, deposit paid, 14 activity rows (Show all) |
| `review-project-DRF001-*` | Project page: a draft (Send v1… as the primary) |
| `review-menu-estimate-row-*` | An estimate row's Actions ▾ open (a menu at 1280/800, a bottom sheet at 375) |
| `review-invoice-deposit-sent-*` | Invoice: sent, overdue deposit |
| `review-invoice-final-draft-*` | Invoice: draft final with Extras and Balance |
| `before-invoice-*` | The same two invoices before this task's fixes |
| `review-editor-NBK014-*` | The editor, full page (the sticky bar shows mid-page: a full-page capture artefact) |
| `review-editor-NBK014-viewport-*` | The editor as first seen: rail or Jump to…, panels, sticky bar |
| `before-editor-NBK014-*` | The editor before this task's fixes |
| `review-agreement-header-*`, `-clauses-*`, `-clause5-open-*` | Settings → Service agreement: header with field chips, clause cards, clause 5 open with (a)(b)(c) |
| `review-agreement-builder-*` | The whole Settings page (full page; the sticky bars repeat mid-page) |
| `review-client-quote-*` | The client's quote page (light) |
| `review-sign-dialog-*`, `-clauses-*` | The sign dialog: the header, then scrolled to the numbered clauses |
| `review-email-quote-*` | The quote email in the new shell |
| `review-estimate-view-SNT002-1280` | The read-only estimate view (checked after the money change) |

## Summary

The track does what the brief asked:
- Every reworked screen has exactly one terracotta button: the probe found one per view at all
  three widths, on 21 screen states.
- No screen scrolls sideways at any width.
- axe finds nothing on the Project page, Invoice, agreement builder or client page. The editor has
  one minor known item, the weekday headers, left as trip-planner left it.
- Menus, panels, the rail and the builder read as one system.

**The biggest finding was the editor's money.** Every line's client bill (17 cells) and every On
set day subtotal (7) were still terracotta, carried over from the old app's `.bill-cell` rule. That
is around 24 loud figures on a screen whose brief says terracotta marks one action. The ~50 line
figures were also set in Metro Sans, which has no tabular figures, so the columns didn't line up
(U24). Both are fixed. The Invoice's deduction line and its repeated Balance due were terracotta
too, and are fixed.

## Must Fix

1. **The editor's line money was terracotta** (fixed).
   - `.bill-cell` (`app.css`, lifted to `--accent-text` in `a11y.css`) and `.onset-gtotal`
     (`booking.css`) painted 24 figures terracotta on NBK-014. This goes against U17 and the brief's
     principle 1.
   - See `before-editor-NBK014-1280.png` against `review-editor-NBK014-1280.png`.
   - _Fix:_ these figures now read in the primary text colour; the Markup and Rate columns stay
     secondary. The editor's only terracotta now: Done/Save, today's date in the calendar (a mark),
     and the Summary's headline total (see Should fix 2).
   - `.est-table .bill` (the read-only estimate view) got the same change.

2. **Table money in the editor wasn't in the figures font** (fixed).
   - U24 says money in tables and rows uses `--font-figures`. The editor's client bill, Markup,
     Rate, On set line amounts, group totals and day totals (about 50 cells) were Metro Sans, whose
     digits are proportional, so a column of prices didn't align.
   - _Fix:_
     - `.bill-cell`, `.gt-row > div.muted-td`, `.onset-amt`, `.onset-gtotal` and
       `.day-items-sum b` take `--font-figures`.
     - The phone's stacked labels (`.gt-row > div::before`, from `data-label`) are pinned to the
       body font, so "Client bill" doesn't turn mono.
     - The mono face has one weight, so the bill cell is no longer 600: no synthetic bold.
   - See `review-editor-NBK014-375.png`: labels in sans, figures in mono, right-aligned.

## Should Fix

1. **The Invoice repeated its terracotta** (fixed).
   - **Repeated Balance due:** the Balance panel's "Balance due" / "Deposit due" figure repeated
     the header's terracotta Balance due. At ≥1100 the two sit side by side; at 375 they're one
     screen apart.
   - **Deduction line:** "Less deposit invoiced −$2,250.00" was terracotta as well, which gave
     terracotta a third meaning (a deduction).
   - _Fix:_ the panel's total reads in the primary text colour (Delight, same size), and the
     deduction in secondary. The header's figure stays the screen's one terracotta figure, as
     task 10 intended.
   - See `before-invoice-final-draft-1280.png` against `review-invoice-final-draft-1280.png`.

2. **Headline figures in terracotta: one decision for all of them** (open, **your call**).
   - These are figures, not buttons, so the one-button rule holds. But together they're the
     largest terracotta on each screen:
     - the Project page's Total inc GST;
     - the Invoice's Balance due;
     - the editor Summary's Total (inc GST);
     - the Projects list cards' totals (already waiting on you from task 13).
   - _Suggestion:_ decide them together. Either keep all of them as "the figure that matters", or
     make all of them primary white so terracotta means only "press this". The review leaves them
     as built.

3. **The editor's Summary panel is boxes inside a panel** (open, **your call**).
   - Inside the Summary panel sit:
     - a bordered Surcharges box;
     - two bordered tile grids;
     - a Total tile with an inline terracotta tint and border;
     - a bordered Minimum Job Price line.
   - That is the "everything outlined" look the brief set out to remove ("hairlines over boxes").
     Task 11 left it for 13/14 to judge, and neither did. It is production-booking's D87/D88
     layout ("the page's last word", Total the largest figure), so it wasn't changed here.
   - _Suggestion:_
     - Keep the order and sizes.
     - Drop the outer borders and set the tiles on the inset fill, divided by hairlines.
     - Take the tint and border off the Total tile; its size already makes it the headline.
   - See the bottom of `review-editor-NBK014-1280.png`.

4. **Move to ▾ on every line looks like an old button.**
   - Each line's Move to is a boxed button with a typed "▾", unlike the chevron caret every other
     menu button uses (`menu.js`'s `.menu-caret`). On a phone it is a 44px boxed block under every
     line: four per day card.
   - _Fix:_ use the quiet `btn-sm` look with `.menu-caret`; consider moving it into the line's
     ⋯ beside "Edit trip" on a phone.
   - See `review-editor-NBK014-375.png`.

5. **Leftover Title Case in the editor** (fixed).
   - "Add Production Service Items", "Include Overhead & Markup in Calculation", and the phone's
     "Mark-Up" label (the desktop column says "Markup").
   - _Fix:_ now "Add production service items" (with its aria-label), "Include overhead and markup
     in the calculation", and "Markup" (also on the read-only estimate view).
   - Not changed: other Title Case labels in the Summary ("Tax Set-Aside", "Est. Take-Home",
     "Client Price (ex GST)"). They are mono caps eyebrows on screen, so their case doesn't show.

## Could Improve

1. **Category tags are ringed; status chips are filled.**
   - "ADDITIONAL WORK", "EXPENSES", "LABOUR" and "FROM TRIP" are outlined mono boxes; status chips
     (CONFIRMED, PAID) are filled. They're the last outlined caps on the reworked screens.
   - _Suggestion:_ the inset fill with no ring, or plain mono secondary text with no box at all.

2. **Agreement header chips are all terracotta.**
   - The Header panel shows 24 `{field}` chips in terracotta, plus 13 terracotta clause numbers.
     They mark fields as the brief asked, but they are the busiest terracotta in the app.
   - _Suggestion:_ chips in the primary or secondary text on the inset fill. The brace syntax
     already says "field".

3. **The sign dialog on a phone reads through a small window.**
   - At 375 the agreement box is about 300px tall inside a dialog that also scrolls: 13 clauses
     read through a slot.
   - _Suggestion:_ on a phone, let the text take the dialog's height and the form follow it, so
     the page scrolls as one. The client pages are otherwise out of this track's scope.
   - See `review-sign-dialog-375.png`.

4. **The Summary's first tile row wraps at 1280.** "CLIENT PRICE (EX GST)" breaks onto two lines in
   its fifth of the row. A shorter label ("Client ex GST") would keep the row even.

5. **The landing focus ring.** Opening the editor puts focus on the closed Job details head, and the
   headless shots show its ring. After a real click, Chrome doesn't draw `:focus-visible` for
   programmatic focus, so a person shouldn't see it. Worth a glance on the iPhone.

## What Works Well

- **One loud thing per view holds everywhere.**
  - The Project page's header action, the Invoice's Send… / Mark paid…, the editor's Done/Save
    and Settings' Save settings are the only terracotta buttons.
  - Document rows step down to a secondary Open / Send… beside quiet Actions ▾ and Documents ▾,
    the Stripe-dashboard row the brief named.
- **Layers, not lines.**
  - Panels lift off the warm near-black page, and rows inside them are hairlines.
  - The Project page at 1280 reads as three questions: what's been sent, what's booked, what
    happened.
- **Mono where it means metadata.** UPIDs, invoice numbers, status chips, eyebrows and table money
  are all CS Felice Mono; nothing else is in caps.
- **Responsive that reorganises, not shrinks.**
  - Documents comes first on a phone, and row buttons go full width with the two menus beside them.
  - Menus become bottom sheets with a titled header and Cancel.
  - The editor's rail becomes Jump to…, and the sticky bar keeps the total and Done in one row.
- **The agreement builder.** Numbered cards with handles; sub-clauses lettered by the app ((a)(b)(c))
  in terracotta mono as marks; Save settings pinned. It is the clearest new screen in the track.
- **D2.** The email reads like the client page it opens: paper, logo and wordmark, a white card,
  one button, the address printed beneath, and a footer that says who it's from.
- **The sign dialog's headings.** Section heads in mono caps, numbered clause titles in bold, the
  same text that is hashed.

## Fixed in this task (files)

- `web/css/app.css`:
  - `.bill-cell`: primary text colour, `--font-figures`, no 600.
  - `.est-table .bill`: the same change.
  - `.gt-row > div.muted-td`: takes `--font-figures`.
- `web/css/a11y.css`: `.bill-cell` and `.est-table .bill` removed from the terracotta-text list.
- `web/css/booking.css`:
  - `.onset-gtotal`: no longer terracotta; mono.
  - `.onset-amt`: mono.
  - `.day-items-sum b`: mono at weight 400.
- `web/css/responsive.css`: the phone's stacked `data-label`s stay in the body font.
- `web/css/invoice.css`: `.is-less` in secondary text; the panel's `.is-due` figure in the
  primary colour.
- `web/js/views/estimate-editor.js`, `estimate-detail.js`: the sentence-case labels.
- **Checks:**
  - The probe again: the editor's terracotta text is now the calendar's today mark and the Summary
    headline. The Project page and Invoice have none outside the header figure.
  - Every money cell is mono.
  - No sideways scroll at 1280, 800 or 375; one primary per view.
  - `npm test`: 711 pass.
