# Design Review: Production Booking (task 33)

Reviewed against: [DESIGN_BRIEF.md](DESIGN_BRIEF.md) (A–E and B2), with [DECISIONS.md](DECISIONS.md)
and the Done notes in [TASKS.md](TASKS.md).
Philosophy: two surfaces. **The app** is the existing dark editorial system, extended (a production
office, a call-sheet calendar). **Client pages** are a Swiss/editorial document on warm paper, in
the lsccreative.studio tokens.
Date: 5 October 2026, at `7385930` (C1–C15 included, not deployed).

**How it was checked.** I captured headless Chrome screenshots (the server's `puppeteer-core`)
against `api-scratch-mail`, at 1280 / 800 / 375, with dispatched clicks for the dialogs. A script
then swept each main screen at 375 for touch targets under 44px, text contrast against WCAG AA,
and sideways overflow.
**Data:** scratch got a fictional review set: SEND-A and SEND-B, plus NBK-014 (draft: deliverables,
a post plan and a Lemac rental), FLW-002 (sent; its Sun 11 Oct is taken), HCC-031 (accepted pair,
deposit paid, final scheduled), KTL-007 (single, paid), MRL-003 (declined) and RVR-011 (expired).
SEND-B's deposit is overdue, and SEND-A was signed through the real dialog. The scratch DB from
before is `/tmp/lsc-billing-scratch/exports/scratch-before-review.db`.

## Screenshots Captured

All are in `screenshots/` (local only, not committed: 86 files, 11 MB), named
`review-<screen>-<width>.png`.

| Area | Screens (widths) |
|---|---|
| Home | `home-month`, `home-week` (1280/800/375), `dlg-tile` (tile pop-up) |
| Projects | `projects`, `client-detail` |
| Folder | `folder-draft`, `folder-sent-taken`, `folder-accepted`, `folder-scheduled`, `folder-signed` |
| Editor | `editor-draft` (full page), `editor-menu` (service menu), `dlg-adddday` (locked date), `editor-sent-banner`, `editor-accepted-banner` |
| Documents | `estimate-view-accepted`, `invoice-final-draft`, `invoice-deposit-paid` |
| Dialogs | `dlg-send-estimate`, `dlg-accept` |
| Settings / Rate Card | `settings`, `ratecard` |
| Client quote | `client-estimate-open`, `-taken`, `-expired`, `-accepted`, `-declined`, `client-dock` (phone Accept bar), `client-sign-dialog`, `client-sign-filled`, `client-signed`, `client-bad-link` |
| Client invoice | `client-invoice-overdue`, `client-invoice-paid`, `client-invoice-single-paid` |

The sweep at 375 found no overflow on any screen, no client-page target under 44px, and no
client-page contrast failure. Its only real owner-side failure is DR9. Its other hits were false
alarms: the ⓘ buttons and card titles have 44px hit areas drawn by pseudo-elements, the hatched
chips have a background image the script can't read, and the wordmark's dot is decorative.

## Summary

Both looks hold, and neither leaks into the other. The client pages read as a set document on paper
(the call-sheet day gutter, mono figures, one terra rule, the payment slip), and the app reads as a
production office. The signing flow does what the brief asks at every width. **One must-fix:**
Settings has no field for the business email and phone, yet every client page's contact line, the
"contact us" in each notice, and the quote PDF's sign-off read them. Live has none, so a client
with a question has no address on the page. The biggest should-fixes are on Home and the calendar:
- proposed tiles cut their own UPID to "FLW…";
- public holidays look like any weekday, though they price like a Saturday;
- gear rentals are louder than the bookings.

## Must Fix

1. **DR1. There's no way to set the business email or phone.** Settings → Business has only the
   name and ABN (`settings.js:163`). `business.email` and `.phone` are kept on save but never
   shown. Since stage E, three things need them:
   - the client page footer ("Questions…? We're happy to." followed by the name, email and
     phone);
   - every notice ("Contact <email> and we'll send you an updated one"), which falls back to
     "Contact us" with no link;
   - the quote PDF's sign-off (C1).

   Live's are blank (HANDOVER), and the only way to fill them today is SQL.
   See `client-estimate-open-1280` (that frozen version has no business details, so the footer
   reads "We're happy to." and stops), and compare `client-estimate-taken-375`.
   _Fix: add Email and Phone to Settings → Business. Save already merges onto the stored row. The
   hint should say that the client pages and documents show them._

## Should Fix

1. **DR2. Proposed tiles cut off their UPID.** On the month grid at 1280, a proposed quarter-tile
   gives its code 29px of the 39–41px it needs, so FLW-002 reads "FLW…" and NBK-014 reads "NB…".
   That's at the widest layout; narrower ones are worse. In the week view, proposed tiles are
   half-width even with nothing beside them, and cut off time, code and name ("10:0…", "FLW…",
   "Vint…"). The brief says every tile carries its UPID, so status never depends on colour alone.
   The accessible name is complete; the visible label isn't. See `home-month-1280` and
   `home-week-1280`.
   _Fix: the month tile sizes to its code (it can drop the name, never the code). In the week
   view, a proposed tile takes the full column when nothing overlaps it, and keeps the code when
   it's narrow._
2. **DR3. The service menu's closed groups show an "open" arrow on desktop.** At ≥768,
   `.booking-block.is-open .bb-chevron` (`booking.css:41`) rotates every chevron in the block,
   including the menu's group heads. Travel, External Crew and Equipment Hire point down while
   closed. `aria-expanded` is right, and the phone sheet is right because it sits outside the
   block. See `editor-menu-1280`.
   _Fix: scope the rule to the block's own head (`.booking-block.is-open > .booking-head
   .bb-chevron`)._
3. **DR4. Public holidays aren't marked on any calendar.** Weekends are shaded (`is-weekend`). A
   holiday weekday prices at the weekend rate but looks like any Tuesday. Today, Mon 5 Oct, is
   Labour Day and nothing shows it. Principle 1 says the owner should never be left guessing why a
   figure moved. See `home-month-1280` and `ratecard-1280` (the holiday list).
   _Fix: shade holidays like weekends on the Home and editor calendars, and put the holiday's name
   in the date's accessible name and its date list ("Mon 5 Oct · Labour Day"). The editor fetches
   holidays already; Home would read `GET /api/holidays`._
4. **DR5. Gear rentals crowd out the bookings on Home.**
   - **Month view:** each bar is full tile height in a saturated blue, across every week it
     spans. That makes it the boldest thing on the board, above confirmed shoots: the "bright
     blobs" the brief warns against.
   - **Phone week list (and each date's list):** a rental repeats as a full card on every day
     it's on hire. CameraHire Co is 6 cards in one week, each with its whole out/back sentence.

   See `home-month-1280` and `home-week-375`.
   _Fix: on Home, draw bars in the quieter outlined/wash style the editor uses for other projects'
   rentals (`.cal-rbar.is-faded`). In lists, show a rental on its out and back days only ("Goes
   out" / "Comes back"), and on the days between as a single muted line or not at all._
5. **DR6. Mark accepted doesn't warn about a taken date.** On FLW-002, Sun 11 Oct is confirmed
   for HCC-031, yet the dialog only says "Its 2 pencilled and proposed days turn confirmed". The
   clash shows up only in the toast afterwards. `project.takenDays` is already on the folder.
   Also, "2 pencilled and proposed" is two proposed days. See `dlg-accept-1280`.
   _Fix: name each taken date in the dialog ("Sun 11 Oct is already confirmed for HCC-031. It
   will be confirmed here too and flagged 'clash, rebook'."). Use real counts ("2 proposed
   days")._
6. **DR7. The send panel doesn't warn about a taken date.** Send v2 on FLW-002 would email a quote
   the client can't accept. The folder already says to move the day first. See
   `dlg-send-estimate-1280`.
   _Fix: one line above Confirm: "Sun 11 Oct is taken. Move that day first, or your client still
   can't accept."_
7. **DR8. Paid invoices still say "due".**
   - The client invoice page heads the figure "Amount due" over "Deposit paid $2,634.00"
     (`c.js:437`).
   - The owner's invoice screen ends a paid deposit with "Deposit due $2,634.00". Its `owed()`
     (`invoice.js:243`) renames void ("Was due") but not paid.

   See `client-invoice-paid-375` and `invoice-deposit-paid-375`.
   _Fix: a paid invoice reads "Amount paid" on the client page. `owed()` maps paid to "Deposit
   paid" / "Balance paid" / "Total paid", as `c.js PAID_LABEL` already does._
8. **DR9. The "On set, by day" day totals use the accent as text.** `.onset-gtotal`
   (`booking.css:704`) is `var(--accent)`: 3.71:1 at 12px. The brief keeps `--accent` for fills
   and borders and uses `--accent-text` for text. The same applies to two hover colours in
   `settings.css` (`.set-link:hover`, `.set-field-code:hover code`). See `editor-draft-1280`.
   _Fix: `var(--accent-text)` in all three._
9. **DR10. Some Settings copy is out of date.** "Sending from the app arrives with client pages."
   (`settings.js:210`) It has arrived. _Fix: delete the sentence._
10. **DR11. The old "Date" field still sits in the editor header** (`estimate-editor.js:2278`),
    beside Project name, and is set to today on a new estimate. Nothing the client sees reads it
    now: the quote's dates come from the sent version and the shoot dates from the booking. Only
    the legacy invoice PDF and the read-only view print it, and the view prints it as raw ISO,
    "2026-10-05" (`estimate-detail.js:39`). With booked days below it, it reads as "the shoot
    date" and can disagree with them. The brief names this very field as the problem.
    _Fix (the user's call): hide it on estimates with booked days, or on every new one, and keep
    stored values for old estimates._

## Could Improve

1. **DR12. Day-card heads wrap to three lines on phones** ("Day 3 / — date / TBC") beside
   Duplicate day and ×. _Below 768, put Duplicate day on its own row under the head._
   (`editor-draft-375`)
2. **DR13. The folder's total is its smallest figure.** It's 13px plain text, while the Projects
   card shows the same number large in terra. _Use Delight at about 22px, as the card does._
   (`folder-accepted-1280`)
3. **DR14. The accepted client page still reads like an open quote.** It keeps "Valid until" in
   the meta block and the footnote, and its notice says "We'll be in touch to confirm the
   details" even weeks after signing, when the days already read Confirmed. _After acceptance,
   show "Accepted 5 October 2026" instead of Valid until, and word the notice for what's
   happened._ (`client-estimate-accepted-375`)
4. **DR15. Stage marks share terra between good and bad.** "Deposit paid" uses the same terra
   square as "Deposit overdue"; only the overdue text colour tells them apart. _Give the healthy
   invoiced stages their own mark and keep terra and red for alerts._ (`projects-1280`)
5. **DR16. The Settings fill-in field list runs about 900px below the agreement box**, leaving the
   left column empty. _Make the list sticky beside the textarea, or set the chips in two
   columns._ (`settings-1280`)
6. **DR17. Surcharge-box rows are as heavy as their total.** "+$320.00" appears twice at the same
   size and weight. _Use regular weight for the rows and keep the total bold._
   (`editor-draft-1280`)

**Seen in passing, not this track's:** on phones, the "Use rates from last project" tick
(service-rate-tiers) and the overhead tick have 15px-tall labels. Short notice was already
lifted to 44px in task 9.

## What Works Well

- **The client pages.** The production days as a call sheet (the date large in the gutter, the
  status as a stamped word, mono figures on the right) carry the whole page. The payment slip,
  with its dashed rule and a Copy button per field, is the best part of the invoice. Every state
  (open, taken, expired, accepted, declined, bad link) has its own plain notice in the "we" voice.
  There's no overflow and every target is at least 44px at 375.
- **Signing.** The agreement box is labelled and focusable. Sign & submit stays visible under it
  and says what's still needed while it's disabled. The phone Accept bar hands over cleanly. The
  thank-you moves focus to its heading and offers the signed copy.
- **The locked-date pop-up.** The clash is stated in one sentence with the UPID, and the
  specification note sits right where it unlocks the three buttons. It's a bottom sheet on
  phones. (`dlg-adddday`)
- **The folder.** Production days, documents and activity read top-down. The taken-date warning
  says what's wrong and what to do. A scheduled email reads "Email scheduled Tue 13 Oct, 9:00 am
  to … · Change · Cancel email", as the brief asks.
- **The editor's B2 shifts landed.** Deliverables is the one tinted block. The planner gives two
  labelled figures plus "On post lines: 29 of 49 recommended". The Totals row ends the page with
  the largest figures. The service menu is a call-sheet checklist with muted prices, not a shop.
- **Status never relies on colour alone** in chips, the folder or the Coming up list. Pencilled
  is hatched, proposed is dashed, and every chip carries its word.
- **Dark mode:** not applicable. The brief fixes the app dark and the client pages light, and
  both stay in their tokens.
