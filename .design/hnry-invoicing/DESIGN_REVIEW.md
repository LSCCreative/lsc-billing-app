# Design Review: Hnry invoicing screens (H6 and H7)

Reviewed against: BRIEF.md (decisions H1 to H10, the failure path) and the H6 and H7 task specs in TASKS.md
Philosophy: the app's own system (dark warm surfaces, terracotta accent, LSC Metro Sans, mono figures).
The brief is a decisions brief with no visual direction of its own, so these screens are held to the
patterns already on the project and invoice pages: chips, one status line, one primary button, then
Actions and Documents.
Date: 2026-10-23 (H11)

Captured headless (the server's puppeteer-core and local Chrome) on a throwaway copy of the H9 scratch
database, with the pretend Hnry (`dev-stub-hnry.js`) on :8080 and the web app from the working tree on
:5173. The real Hnry was never called. Two states were made on the copy only: HF-300's final stopped
after 2 of its 4 lines on a timeout (Part in Hnry), and HF-400's deposit marked paid by card. The app is
dark only (light is opt-in, client pages), so there is no second theme to capture.

## Screenshots Captured

Local only (`.design/*/screenshots/` is git-ignored), in `.design/hnry-invoicing/screenshots/`. Every
name below exists at `-desktop-1280`, `-tablet-800` and `-mobile-375` unless marked.

| Screenshot | What it shows |
| --- | --- |
| `review-project-error-*.png` | HF-200: deposit "Hnry error" with Retry in Hnry; its final "Not in Hnry", not ready |
| `review-project-out-of-date-*.png` | HF-100: final "Hnry out of date"; remade deposit "Not in Hnry" with Create in Hnry; the void deposit |
| `review-project-part-way-*.png` | HF-300: deposit "In Hnry"; final "Part in Hnry" (2 lines), Retry in Hnry |
| `review-project-paid-final-ready-*.png` | HF-400: deposit Paid (in Hnry); final "Not in Hnry" with Create in Hnry… |
| `review-project-old-way-*.png` | HF-500: deposit sent by the app before Hnry; the final stays on the app's Send… |
| `review-project-in-hnry-*.png` | H9-TEST-1: deposit and final both in Hnry |
| `review-invoice-part-way-*.png`, `review-invoice-out-of-date-*.png`, `review-invoice-final-ready-*.png`, `review-invoice-error-*.png`, `review-invoice-in-hnry-*.png` | The invoice page in each of those states |
| `review-settings-hnry-*.png` | Settings → Hnry, Connected (the stub's check) |
| `review-dialog-mark-sent-*.png` | Mark sent… on a deposit in Hnry |
| `review-dialog-create-final-*.png` | Create the final invoice in Hnry? (not confirmed) |
| `review-focus-retry-desktop-1280.png` (1280 only) | Keyboard focus reached by Tab on Retry in Hnry |
| `review-ratecard-card-fee-info-desktop-1280.png` (1280 only) | The Rate Card's card-fee ⓘ, open |

Measured on every capture: no page is wider than its viewport at any width, no button or link in the
page is under 44px on phones, and every Hnry chip and status line is 7.2:1 to 10.5:1 against its
background. Tab reaches Retry in Hnry and draws the shared focus ring: a 2px ink ring, then the 2px focus colour.

## Summary

The H6 and H7 screens deliver what the brief and tasks ask. Every invoice row and invoice page shows the
Hnry number first with the app's as "app ref", one chip and one status line in the email line's own
style, and one main button that is the next thing to do. A failed push is visible on the project page
without opening anything, Send, PDF and Copy link are gone for an invoice in Hnry, and the old-way
projects are untouched. The biggest finding is not a layout one: **voiding an invoice that lives in Hnry
says nothing about Hnry**, so the old invoice stays payable there. Three copy and spacing issues follow.

## Must Fix

1. **Voiding an invoice in Hnry leaves it live in Hnry, and the dialog doesn't say so.** `openVoid`
   (`web/js/views/invoice.js:1017`) titles the dialog with the app's reference (`INV-HF-100-D`), not the
   Hnry number the rest of the page uses (brief H3). It tells the user the client sees the reason "on the
   old invoice's page… and printed on the void copy", but an invoice in Hnry has neither (H5). It never
   says to void or credit the invoice in Hnry. After voiding, the folder's void row
   (`project-folder.js:416`, `review-project-out-of-date-desktop-1280.png`: `INV-10670000`, sent from
   Hnry) reads "voided · replaced by …" with nothing about Hnry. The client can still pay the old invoice
   by card in Hnry while the app counts it void. _Fix: for an invoice with a Hnry number, title the dialog
   with that number, replace the client-page sentence with "Void or credit INV-… in Hnry too: voiding here
   doesn't change it there.", and add "· void it in Hnry too" to the void row's line._

## Should Fix

1. **Invoice-page copy still says "sent" where Hnry locks the invoice.** The Extras footer
   (`invoice.js:478–479`) says "Sent invoices don't change. To correct one, void it and make a
   replacement." on a draft that is locked only because it is in Hnry
   (`review-invoice-out-of-date-desktop-1280.png`). It says "Editable until the invoice is sent." on a
   final that locks at Create in Hnry (`review-invoice-final-ready-mobile-375.png`). _Fix: on an invoice in
   Hnry, "It's in Hnry: change it there."; on a final that will go to Hnry, "Editable until you create it
   in Hnry."_
2. **The Balance panel names the deposit by the app's reference while Hnry names it by its own.**
   `lessLabel` (`invoice.js:289`) prints `less.number`: HF-400's final shows "Less deposit paid
   INV-HF-400-D", while the final it makes in Hnry says "Less deposit (INV-10670003)". _Fix: print the
   deposit's Hnry number when it has one (brief H3)._
3. **Mark sent's two date fields are crowded.** `.pf-dialog` gives a `.field` no space after the
   paragraph or after another field (`project-folder.css:490`), so "Due on" sits closer to the Issued box
   than to its own (`review-dialog-mark-sent-mobile-375.png`). Mark sent is the first dialog with two
   fields in a row. The void dialog's reason field has the same tight gap under its paragraph. _Fix:
   `.pf-dialog .pfd-text + .field, .pf-dialog .field + .field { margin-top: var(--space-6) }` or the
   project's equivalent step._

## Could Improve

1. **"app ref" drops under the longer "Hnry out of date" chip.** On HF-100's final at 1280
   (`review-project-out-of-date-desktop-1280.png`) the reference wraps to its own line, where every other
   row keeps it beside the chip. _Suggestion: let the chip and the meta wrap as one line (inline flow), or
   accept it: it only happens with the longest chip._
2. **Status lines are 11px on phones.** They follow the app's send-status style (the email lines use the
   same), so this is consistent, and contrast is 7–10:1. _Suggestion: if the app ever raises its hint size
   on phones, these move with it; nothing Hnry-specific to change._
3. **The Rate Card ⓘ says "Your invoices are paid through Hnry" unconditionally**
   (`review-ratecard-card-fee-info-desktop-1280.png`), which is untrue until the credential is on the NAS.
   This is the open code-review item from H7. _Suggestion: "Card payments go through Hnry, which charges
   you…"._
4. **The Settings rail marked Google Calendar while Hnry was in view** (`review-settings-hnry-desktop-1280.png`).
   This is the rail's shared scroll tracking (`settings.js:1371`, 120px threshold), not Hnry code. After a
   jump the section should sit at `scroll-margin-top` (70px) and be marked. In the capture something moved
   the page after the jump. The cause wasn't confirmed. _Suggestion: check a rail click to Hnry by hand. If
   the mark is wrong there too, re-run the tracking once the panels that load later (Google Calendar,
   Account) have drawn._

## Outcome (2026-10-23, same day)

All four Must and Should items are fixed. They were checked on a fresh throwaway copy at 1280 and 375
(`screenshots/fixed-*.png`, local only), measuring what each fixed text now says:

- **Must 1:** for an invoice in Hnry, the void dialog is titled with the Hnry number. It says the replacement is made "to
  correct and create in Hnry" and ends in bold: "Voiding here doesn't change Hnry: void or credit INV-… in
  Hnry too, or the client can still pay it there." The reason hint reads "For your records. The client's
  copy is in Hnry, so they don't see this here." The toast says "voided here: void it in Hnry too". The void
  row adds "· void it in Hnry too", and the voided invoice's page says "Voided here only. Void or credit
  INV-… in Hnry too…". An old-way invoice's dialog is unchanged.
- **Should 1:** `extrasHint()` gives "Editable until you create it in Hnry." on a final headed for Hnry, and
  "It's in Hnry, so it doesn't change here: change it in Hnry." on one in Hnry. The old-way and void wording
  is unchanged.
- **Should 2:** `invoiceJson` (server) now carries `hnryNumber` on `less`, `replaces` and `replacedBy`, and
  the page names an invoice by it when there is one: HF-400 reads "Less deposit paid INV-10670003", the
  number its Hnry final uses. A test pins it, and it fails without the column.
- **Should 3:** `.pf-dialog .pfd-text + .field, .pf-dialog .field + .field` get `--space-6`. Mark sent now has
  16px from the words to "Issued on" and 16px from the Issued box to "Due on" (12px label to box).

The Could improve items are left as they are.

## What Works Well

- **One next step per invoice.** Each state's main button is the thing to do: Retry in Hnry, Create in
  Hnry, Create in Hnry… (with a confirm) for a final, or Open in Hnry. The app's own Send drops into
  Actions as "Send from the app…". The header's main action agrees with the rows (HF-400: Edit final
  invoice, then Create in Hnry…).
- **The part-way warning is exact and honest.** "Only part of this invoice is in Hnry (2 lines so far). A
  line that timed out may already be in the draft: look at it in Hnry before you retry." states the
  known limit without alarm (`review-project-part-way-*.png`).
- **The Hnry number leads and the app's stays findable.** Eyebrow `INV-10679475 · APP REF INV-H9-TEST-1-D`
  on the invoice page, and the same order on every row.
- **Old ways stay old.** A final whose deposit the app sent keeps the app's Send… (HF-500). Legacy and
  void rows are unchanged, and an invoice in Hnry offers only its Cost Breakdown under Documents.
- **Mobile.** Rows stack into full-width 44px+ buttons with Actions and Documents beside them, long
  warnings wrap cleanly, and nothing scrolls sideways at 375.
- **Settings → Hnry** sits in the same pattern as Email and Google Calendar: the status pill, Check again
  beside it, the detail line, then Card payments with the Rate Card link. The Create-final confirm puts
  focus on Cancel, the safe default for a step that can't be undone here.
