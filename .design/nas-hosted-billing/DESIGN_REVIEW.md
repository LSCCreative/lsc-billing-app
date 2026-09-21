# Design Review: NAS-Hosted LSC Billing (the base site)

Reviewed against: [DESIGN_BRIEF.md](DESIGN_BRIEF.md)
Philosophy: Editorial dark utility — "a film-lab studio tool, not a SaaS dashboard"
Date: 21 September 2026
Scope: every screen outside Finance: login, header and compact nav, Estimates list, estimate
editor, estimate detail, Clients list, client record, Invoice Settings, and the connection-lost
banner. Finance (Pricing / Overhead / Goals) had its own review on 2026-09-18:
[`../overhead-finance/DESIGN_REVIEW.md`](../overhead-finance/DESIGN_REVIEW.md). Its site-wide
should-fixes (headings, `<main>`, field errors, error tokens, reduced motion) were already done
before this review, so this review starts from that state.

Reviewed live against `api-scratch`. Confirmed first that port 8080 had
`/tmp/lsc-billing-scratch/billing.db` open, not `server/data`. Scratch was in its never-configured
state (0 estimates, 0 clients, pricing and settings never saved, Finance seeded at $25/hr). One
throwaway client and one estimate were created through the real forms to reach the populated
screens, then deleted. Scratch is back to 0 / 0.

## Screenshots Captured

**Captured and analysed in the Claude desktop app's built-in browser pane. That pane returns
images to the reviewer but cannot write files to disk**, so `screenshots/` was not created, the
same limit the Finance review hit. The table names every view that was captured, so each finding
can be traced. To keep a file record, re-run this review somewhere with Playwright MCP.

| Capture | Breakpoint | Description |
| --- | --- | --- |
| `review-estimates-empty-desktop-1280` | Desktop (1280×800) | First-run: checklist (rate card / invoice details) |
| `review-estimates-empty-tablet-768` | Tablet (768×1024) | Same, tablet |
| `review-estimates-empty-mobile-375` | Mobile (375×812) | Same, phone. Left-aligned full-width New Estimate |
| `review-nav-menu-open-mobile-375` | Mobile (375×812) | Compact nav panel open |
| `review-clients-empty-mobile-375` | Mobile (375×812) | No clients yet |
| `review-client-new-desktop-1280` (+ error) | Desktop (1280×800) | New Client form, clean and after an empty save |
| `review-client-record-desktop-1280` | Desktop (1280×800) | Saved record, empty estimate history, toast |
| `review-editor-top-desktop-1280` (+ typeahead) | Desktop (1280×800) | Header fields, UPID at rest, client typeahead open |
| `review-editor-sections-desktop-1280` | Desktop (1280×800) | Deliverables + labour sections with rows |
| `review-editor-summary-desktop-1280` | Desktop (1280×800) | Expenses, toggle, summary bars, Minimum Job Price |
| `review-editor-sections-mobile-375` | Mobile (375×812) | Stacked labour rows |
| `review-editor-top-tablet-768` | Tablet (768×1024) | Editor head and Deliverables |
| `review-detail-desktop-1280` (top, totals) | Desktop (1280×800) | Estimate detail: section tables, totals card, notes |
| `review-detail-tablet-768` | Tablet (768×1024) | Detail, with the Export button wrapping |
| `review-detail-mobile-375` | Mobile (375×812) | Detail stacked |
| `review-estimates-list-desktop-1280` | Desktop (1280×800) | One card |
| `review-clients-list-mobile-375` | Mobile (375×812) | One card |
| `review-client-history-mobile-375` | Mobile (375×812) | Record with one estimate in the history, stacked |
| `review-invoice-settings-desktop-1280` | Desktop (1280×800) | Modal open over the client record |
| `review-login-error-desktop-1280` / `-mobile-375` | Desktop / Mobile | Login card with its error state shown |
| `review-connection-lost-desktop-1280` | Desktop (1280×800) | Banner raised plus the list's own load failure |

Dark mode: not applicable. The site is dark-only by design, with no light theme or toggle.

**How it was driven**, per this repo's browser-pane notes: clicks and form input were dispatched
from script. Focus rings were checked with one real Tab keypress, then scripted focus, read after
the `.btn` transition. The login card was mounted locally with `LoginView.mount` and a sample error
written into it. Nothing was submitted and the session was untouched. The connection-lost state
was forced by making `fetch` reject in the page, then restored.

## Summary

The port kept its promise. Every screen reads as the Electron app moved into a browser: the same
dark editorial rate card, Delight headings, one terracotta accent, and no SaaS chrome. The new
pieces (login, connection banner, clients, typeahead) look like they were always part of it.
Responsive work is solid down to 320px, with no horizontal overflow anywhere.

**The two must-fix findings are both text contrast**, which the brief sets at ≥4.5:1 and which
the site's earlier accessibility pass only settled for `--muted`:
- The accent is used as a *text* colour on the busiest screens, including the headline figure on
  every estimate card at 2.8:1.
- A second grey, `--muted2`, carries real instructions at 1.67:1.

The most important should-fix sits where the two tracks meet: the editor and detail views still
show each row's old stored rate, which disagrees with the computed rate the Pricing screen now
shows for the same data.

> **Actioned 2026-09-21, the same day:** both must-fix, all nine should-fix, and could-improve 1,
> 2, 4, 5 and 6. Left as written: could-improve 3 (a deliberate trade), 7 (matches the PDF) and 8
> (the separate fonts task). See HANDOVER.md's "Design review fixes" entry for what changed and
> how it was verified. Items are kept below as written, for the reasoning.

## Must Fix

1. **Accent-coloured text is under the brief's 4.5:1 almost everywhere it is used as text.**
   Measured by compositing each element down through its background stack:

   | Where | Style | Ratio | Bar |
   | --- | --- | --- | --- |
   | Estimates card: total (26px, the card's headline) | `.card-gross` on `--surface` | **2.80** | 3.0 (large) |
   | Estimates card: UPID | `.card-num` on `--surface` | **2.80** | 4.5 |
   | Editor + detail: every Client Bill / Bill / Total cell | `.bill-cell` / `.bill` on `--bg` | **3.71** | 4.5 |
   | Editor: "UPID — Unique Project Identifier *" label | accent label | **3.71** | 4.5 |
   | Editor: "Total (inc GST)" label on its tinted cell | `.sum-label` | **3.46** | 4.5 |
   | Detail: UPID above the title, contact email | `.est-upid`, email | **3.71** | 4.5 |
   | Client record: history row total | `.bill` | **3.71** | 4.5 |

   See `review-estimates-list-desktop-1280` and `review-editor-sections-desktop-1280`. The card
   total fails even the 3:1 large-text bar. It is the most prominent number on the most-visited
   screen. All of this is pre-existing (ported from Electron) and outside what the Finance track
   fixed. Decision 72 there lifted the accent for the **charts only** and left the brand accent
   alone everywhere else, at your request.

   _Fix — your call, because it touches the brand colour:_ the precedent is decision 72's
   approach. Add a text-only token and leave `--accent` itself (buttons, borders, underlines,
   focus rings) untouched. Measured options:

   - `--accent-text: #c1695a` (the accent mixed 12% toward white) gives **4.60:1 on `--bg`**. That
     fixes every row of the table except the card UPID, and gives the card total **3.47:1**
     (passes as large text).
   - The card UPID is 11px on `--surface`. To reach 4.5:1 there, the accent has to be mixed 28%
     (`#cc8478`), which starts to look like the error pink (`#f0a0a0`). **Recommendation:** set
     that one UPID in `--muted` (5.2:1) or `--text` rather than lightening the accent that far.

2. **`--muted2` (rgba 0.18 alpha) carries real text at 1.67:1.** `a11y.css`'s comment says it is
   "only ever a placeholder-style empty". Three of its uses are instructions or labels, not
   placeholders:
   - The editor's Take-Home explanation, "(labour revenue ex GST, less set-aside — pass-through
     excluded)". 9px, inline style, `estimate-editor.js:398`.
   - Every editor section's empty-row line, e.g. "No deliverables added yet — click + Add
     Deliverable above." `app.css:104` `.gt-body .empty-row`.
   - The detail view's "No notes added." `estimate-detail.js:208`.

   See `review-editor-summary-desktop-1280`, where the Take-Home note is barely visible.

   _Fix: switch all three to `--muted` (6.15:1 on `--bg`), and move the inline style into a
   class. `--muted2` can stay as a non-text colour (the trend chart's gridlines use it that way,
   `overhead.css:181`)._

## Should Fix

1. **The editor and detail views show a Rate that contradicts the Pricing screen.** Both still
   print each labour row's *stored* `rate` (`estimate-editor.js:117`, `estimate-detail.js:93`).
   Since the Finance track, Pricing shows every labour row at the one computed Overhead Rate/hr,
   and the stored value is inert (Finance decisions 6 and 19). On the same scratch data, Pricing
   reads **25.00** for every labour row while the editor reads **$40 / $100 / $80 / $35 / $45**,
   and the Minimum Job Price line directly below says "$25.00/hr of overhead"
   (`review-editor-sections-desktop-1280`, `review-editor-summary-desktop-1280`).
   `estimate-editor.js:134` also derives the Mark-Up label's "None" from the stored rate. The PDF
   prints no rate column, so no client document is affected; this is internal-only, but it is a
   money figure that is now wrong on screen. _Fix: either show `overheadRatePerHour()` (or `—`)
   there, matching Pricing, or drop the Rate column from labour rows in the editor and detail views.
   Your call which; per CLAUDE.md it is a **money-display change — Opus/high**._

2. **Placeholders use the browser's default grey, 2.9:1.** No stylesheet sets `::placeholder`, so
   every placeholder renders `#757575` on the `#2C2F35` input fill. Several carry the expected
   format (ABN "e.g. 51 824 753 556", BSB "e.g. 062-000", bank and payment terms in Invoice
   Settings), which is information, not decoration. See `review-invoice-settings-desktop-1280`.
   _Fix: one rule in `a11y.css`: `::placeholder { color: var(--muted); opacity: 1 }` (5.2:1 on
   `--surface`)._

3. **Below 768px, the full-width "+ New Estimate" and "+ New Client" labels sit on the left.**
   `responsive.css:288` stretches `.page-head`'s children, and `.btn` is `inline-flex` with no
   `justify-content`, so the label hugs the left edge of a 343px accent bar. Every other
   full-width button on the same screens (the checklist's Open Pricing, the editor's + Add
   Service) is centred. See `review-estimates-empty-mobile-375`, `review-clients-empty-mobile-375`.
   _Fix: `.page-head > .btn { justify-content: center; }` inside the same `max-width: 767px`
   block._

4. **"+ Add Deliverable" is missing the `.btn` class.** `estimate-editor.js:319` renders
   `class="btn-accent btn-sm"`, so it gets no uppercase and no letter-spacing, and is 27px tall
   where its siblings are 25px. It is the one mixed-case button in a section full of uppercase
   ones. See `review-editor-sections-desktop-1280`. This was ported verbatim; the Electron
   original has the same omission (`index.html:660`). _Fix: add `btn` to the class list._

5. **"↑ Export Quote PDF" wraps onto two lines at the bottom of the tablet band.** It happens at
   768px (142px wide, 2 lines) but not at 900px or 1099px. This is the same bug class the Finance
   layout check fixed for the save bars. See `review-detail-tablet-768`. _Fix: in the 768–1099
   band, give the `.est-header` action buttons `white-space: nowrap` and let the button group
   wrap as a row instead, the same approach as `responsive.css:81`._

6. **Estimate and client cards aren't announced as actionable.** They are
   `<div role="listitem" tabindex="0">`. Enter and Space work (`estimate-list.js:209`,
   `clients.js:103`), but a screen reader hears "list item" plus the whole card's text, with no
   hint it opens anything. Their focus state (`estimates.css:35`) is also identical to the hover
   state (1px accent border plus underline), and they are the only controls in the app without
   `a11y.css`'s ring. _Fix: keep the `listitem`, and make the card's `<h2>` contain a `<button>`
   (or link) whose `::after` covers the card, so the whole card stays clickable. Drop the
   `tabindex` from the div. The ring then comes from `a11y.css` like everything else._

7. **`.client-history-link` removes its focus ring.** `clients.css:116` sets `outline: none` on
   `:focus-visible`, leaving only a colour shift to accent plus an underline. Decision 73 kept the
   accent hover idiom on the premise that "keyboard focus also gets the ring"; here it doesn't.
   The ring sweep found it; apart from the cards in should-fix 6, every other control on the
   base screens passes. _Fix: delete that one `outline: none` line._

8. **The login error is the one error box not on the shared error tokens.** `login.css:64` uses
   an accent border and a hardcoded `rgba(184,84,68,0.10)` fill. Every other form's error box
   reads `--err-border` / `--err-bg` / `--err-text` (Finance should-fix 4). The first thing a user
   ever sees go wrong is styled differently from every error after it. See
   `review-login-error-desktop-1280`. The same file still has its own `:focus-visible` rule,
   whose comment says "the global focus-ring pass is a later task"; `a11y.css` now covers it.
   _Fix: point `#login-error` at the three tokens, and delete the redundant focus rule._

9. **The banner's "Try Again" leaves the page in its failed state.** With the server unreachable,
   the Estimates list shows its own "Couldn't load your estimates" block with a second "Try Again"
   in the page head (`review-connection-lost-desktop-1280`). Pressing the **banner's** Try Again
   once the server is back clears the banner, but the page still says "Could not load" until the
   second button is pressed. Two identically named buttons, and the obvious one only half-works.
   _Fix: when the banner's retry succeeds, re-mount the current screen (or, cheaper, rename one of
   the two, e.g. "Check Connection" on the banner)._

## Could Improve

1. **The detail view's section tables don't share column edges.** Each section is its own
   `table-layout: auto` table, so the Hours column's right edge sits at 705 / 563 / 696px across
   Pre-Production, Production and Post-Production, and Rate and Mark-Up wander the same way
   (`review-detail-desktop-1280`). A printed rate card lines its columns up. _Suggestion:
   `table-layout: fixed` with shared `<colgroup>` widths. This is a ≥1100px change to a ported
   screen, so it needs your sign-off under the brief's "identical to today" rule._
2. **The UPID field is terracotta-bordered on a blank form.** It is the Electron app's "this one
   matters" marker (`app.css:76`). Since field errors now draw a pink border, a red-family border
   on a fresh form reads a little like "already wrong" (`review-editor-top-desktop-1280`).
   _Suggestion: keep the accent label (fixed per must-fix 1), and give the field the normal
   border._
3. **An uneven gap under Business Name.** `.client-link-status` reserves `min-height: 16px`
   (`clients.css:50`) so the "From your client list" line doesn't shift the layout when it
   appears. The cost is a permanent 16px extra gap in that row of the grid. It is a deliberate
   trade and a reasonable one; noted only because it is visible.
4. **The client-history stacked row reads awkwardly below 768px.** The first cell (UPID) gets the
   row's "subject" block treatment (`responsive.css:599`), but the Project link is the real
   subject, and its 44px target sits a line below its own label
   (`review-client-history-mobile-375`). _Suggestion: `align-items: center` on that table's
   cells, or give the Project cell the subject treatment._
5. **The editor's service `<select>`s are 40px tall on a phone**, just under the 44px target the
   brief sets below 768px. Everything else was measured at ≥44px.
6. **The Take-Home green (`#6fcf6f`) is hardcoded inline in four places** (`estimate-editor.js:399`,
   `estimate-detail.js:203–204`, `app.css:156, 175`). It is inherited, and correct under "port,
   not redesign", but it is the only semantic colour not on a token.
7. **The detail view's section order differs from the editor's.** The editor goes Deliverables →
   labour → Travel → Crew → Equipment; the detail view goes labour → Equipment → Travel → Crew →
   Deliverables. This is inherited, and the detail view matches the PDF's order, so it is
   probably right. It's noted so any change is deliberate.
8. **Fonts:** `web/fonts/` holds `.ttf`, not the brief's `.woff2`. `Funnel Sans` is still not
   embedded, so body text falls back off the designed face on any device without it. Both are the
   open "Fonts, embedded assets" task in TASKS.md, not new.

### Noted, deliberately not findings

- **Desktop-first media queries, 13px body on mobile, dark-only.** These are recorded decisions
  (the Desktop Preservation Law in `responsive.css`, and "same tool, more places"), as the
  Finance review also noted.
- **The home button beside the wordmark** both go to Estimates. That's deliberate, per the
  comment at `responsive.css:250`, and the wordmark itself is not a control.
- **The wordmark's accent full stop at 2.8–3.7:1.** It's a logo mark, which WCAG exempts from
  contrast requirements.
- **Electron chrome:** no `-webkit-app-region` or `hiddenInset` remains anywhere in `web/`.
- **Not seen live:** PDF export (writes to `/data/exports`) and Duplicate. Both are covered by
  earlier verified tasks and were outside what a visual pass needed.

## What Works Well

- **Aesthetic fidelity is high, and the new screens pass the "must look like it belongs" test.**
  The login card is the header's wordmark on a surface card with one field pair, with no
  illustration and no SaaS gradient. The Clients screens reuse the estimate card grid and form
  exactly. Nothing in the app has a sidebar, a toolbar or a shadow.
- **First-run empty states do real work.** The Estimates empty state explains what the two setup
  steps change ("they only change what a new estimate is priced and printed from") instead of
  just saying "nothing here".
- **"Trust over speed" is visible.** Save buttons go to a disabled "Saving…" state and only then
  confirm with a toast. The connection banner is `role="status"`, names the consequence ("Your
  changes can't be saved until it's back"), and the page's own error block says the same thing
  in context.
- **Forms are well built.** Labels are associated. Errors flag the exact field with
  `aria-invalid` and a described sentence, and focus goes to it. The typeahead is a real
  combobox (`aria-expanded`, `aria-activedescendant`, arrow keys, Escape contained). The
  Invoice Settings dialog traps focus, opens on its first field, closes on Escape and returns
  focus to the header button.
- **Responsive work reorganises rather than shrinks.** The compact nav is a proper disclosure
  panel with Escape and focus return. Detail and editor tables become labelled blocks on a phone.
  No screen overflows horizontally at any width checked, and every target is ≥44px except the
  selects in could-improve 5.
- **Focus rings: every control but three** shows `a11y.css`'s ring under a genuine
  `:focus-visible`. That's 113 checks across list, detail, editor, clients, record and Invoice
  Settings, with the header re-counted on each screen. The three exceptions are the two card
  types and the history link (should-fix 6 and 7).
