# Design Review: Own kit (K3, K5, K6, K7 + K9 fixes)

Reviewed against: DESIGN_BRIEF.md (K-D3, K-D4, K-D8–K-D11)
Philosophy: the app's own system (dark owner UI, Metro Sans + mono figures, terracotta accent; light
client pages in lsccreative.studio colours). No new aesthetic: fidelity means "looks native".
Date: 2026-10-17. Data: a copy of the scratch DB with Google removed (`/tmp/lsc-billing-scratch-sync`),
seeded with five kit assets (rated, unrated, $0), two floor assets (one complete, one missing cycle) and
"Harbour brand shoot" (2 days, three kit lines, two vendor lines, crew), frozen as v1 for the client page.

## Screenshots Captured

All in `.design/own-kit/screenshots/`, each at desktop 1280×800, tablet 800×1024 and mobile 375×812
(suffixes `-desktop-1280`, `-tablet-800`, `-mobile-375`) unless noted.

| Screenshot | Shows |
|---|---|
| `review-depreciation-*` | Finance → Overhead → Depreciation, full page (register, schedule, multi-year block) |
| `review-depreciation-long-name-desktop-1280` | The register with a 200-character unbroken asset name (desktop only) |
| `review-depreciation-register-mobile-375` | Stacked register cards on a phone |
| `review-asset-modal-kit-*` | Edit asset modal, opened (focus on Name) |
| `review-asset-modal-switch-floor-*` | The modal after switching a kit asset to Overhead Floor (focus kept on the radio) |
| `review-asset-modal-recovery-{kit,zero-rate,floor-gap}-*` | The Recovery block: kit with a rate, kit at $0, floor asset missing its cycle |
| `review-editor-*` | Estimate editor, full page (day cards with kit rows, On set summary, totals) |
| `review-editor-kit-rows-mobile-375`, `review-editor-onset-equipment-mobile-375` | Kit rows stacked, and the On set Equipment Hire block, on a phone |
| `review-kit-popup-*`, `review-kit-popup-ticked-*` | Add On-Set Equipment pop-up (bottom sheet on phone), empty and with one ticked |
| `review-day-menu-*`, `review-day-menu-equipment-*` | A day's service menu, closed groups and Equipment Hire opened |
| `review-estimate-detail-*` | Owner estimate detail (Kit Hire lines, Own kit tag, totals card) |
| `review-client-page-*` | Client quote page `c/#e/…` (Also included) |

No page errors and no horizontal page overflow at any width.

## Summary

The track looks like it was always part of the app. The register's Recovery tags and warnings are clear
and not colour-only, the modal's Recovery cards and live reserve line explain the money move well, the
pop-up is the cleanest dialog in the editor, and nothing internal shows on the client page. The biggest
issue is responsive. At 800px the register's new Recovery column, which holds the K-D3 warnings, is
scrolled out of view under the pinned actions. The second is a padding mismatch on phone cards.

**All ten fixed 2026-10-17** (see TASKS.md K9, "Design review fixes"; #4 as days on all hire). Check shots:
`screenshots/fix-*`.

## Must Fix

None.

## Should Fix

1. **At 800px the Recovery column is off-screen.** The register scrolls sideways between ~560 and
   ~1100px. With K3's two new columns, Business use, Adjustable value and Recovery all sit under the
   pinned Edit / Dispose column until you scroll (`review-depreciation-tablet-800`). Recovery holds the
   "contributes $0 to your rates" and "can't be added to an estimate" warnings, which K-D3 says must not
   go unseen. _Fix: below ~1100px, print the Recovery tag, figure and gap under the asset name in the
   Asset cell (hide the column), so the warning is always in the first column. Keep the scroll for the
   rest._

2. **Money cells on phone cards sit 4px inside the others.** On stacked depreciation cards, Cost (inc
   GST), Business use and Adjustable value are indented compared with Category, Method and Recovery,
   on both label and value (`review-depreciation-register-mobile-375`). Measured: `.right` cells have
   14px padding, the rest 10px. The cause is `responsive.css:136` (`.dep-scroll .est-table td`, 10px),
   which the stacked table's later `.est-table td.right` (`responsive.css:839`, 14px) overrides at equal
   specificity. The schedule's cards have the same problem. _Fix: add `.dep-scroll .est-table td.right`
   to the 10px rule._

3. **A long unbroken asset name breaks the register.** Names may be up to 200 characters. A name with
   no spaces stretches the Asset column so far that, at 1280, only Asset is visible and every row grows
   tall (`review-depreciation-long-name-desktop-1280`). The schedule's Individual assets table does the
   same. _Fix: `overflow-wrap: anywhere` on the register's and schedule's name cells, and on
   `.kit-asset` / `.kp-name` in the editor and pop-up, which print the same snapshot._

4. **Client page: kit lines show days, vendor hire doesn't.** "Also included" reads "Kit Hire - Sony
   FX6 cinema camera · 1 day", then "Aputure 1200d" with no days, then the FX6 again "· 2 days" with
   nothing to say why it appears twice (`review-client-page-desktop-1280`, the quote PDF is the same).
   The two kinds of hire look different to the client for no visible reason. _Fix (your call, it
   revisits K6): either show days on every hire line (`pdf.js serviceGroups`, so the PDF and the page
   stay one reader), or show none on kit either. Days on all hire is the clearer option._

5. **The pop-up eyebrow reads "ADDING TO NOT ON A DAY".** When opened from Equipment Hire's summary head,
   the target's name is "Not on a day", which reads as a typo in caps (`review-kit-popup-*`). _Fix:
   eyebrow "Not tied to a shoot day" for OFF_DAY (it's the card's own subtitle), or quote the name:
   "Adding to “Not on a day”"._

## Could Improve

6. **Mixed formats in the Cost/day column.** In the same column, a kit row shows muted `$300.00` text
   and a vendor row shows a bare `240` input (`review-editor-desktop-1280`). That is right in principle
   (a shown rate vs a typed one), but the figure formats differ. _Suggestion: leave it, or give the kit
   rate the input's right inset so the numbers line up._

7. **The pop-up's rates drop the cents** ("$150 a day"); the register, the editor and the detail all
   print "$150.00". _Suggestion: use `fmt` in `.kp-rate` for one money format._

8. **Duplicate kit labels in the On set summary.** Each kit line reads "Kit Hire - Sony FX6…" with "Own
   kit" under it (since K9, which matched the documents' name), inside a block chipped "EXPENSES",
   though kit is income (`review-editor-onset-equipment-mobile-375`). _Suggestion: drop the "Own kit"
   sub-note there (the name already says Kit Hire), and leave the chip, which describes the editor's
   Expenses subtotal._

9. **The pop-up's unrated note is clumsy:** "2 kit assets have no day rate above $0 yet" (K9's wording).
   _Suggestion: "2 kit assets have no day rate yet, or a $0 one, so they aren't listed."_

10. **The day menu's kit entry is two levels deep:** open the menu, then expand Equipment Hire
    (`review-day-menu-*` vs `review-day-menu-equipment-*`). _Suggestion: open the Equipment Hire group by
    default when there are rated kit assets, or leave as is: the summary head's button is one tap._

## What Works Well

- **Register tags and gaps** (`review-depreciation-desktop-1280`): the boxed mono ON-SET KIT / OVERHEAD
  FLOOR tags, the figure under them ($/day or $/yr), and the terracotta-ruled gap sentences say what's
  wrong in words, not colour. The $0 tripod reads correctly since K9.
- **The modal's Recovery cards** (`review-asset-modal-recovery-*`): two clear choices with one-line
  consequences, the Day rate field only when it applies, and a live line that changes to a warning for a
  missing or $0 rate. Focus survives the re-render on a switch.
- **The pop-up**: plain intro ("counts as your income, not a cost passed through"), the ticked row's accent
  rule, the "Already added" chip, a counted note instead of listing unusable assets, "Add 1 item" naming
  the batch, and a real bottom sheet with 44px controls on a phone.
- **Kit rows in the editor**: the Own kit tag, the rate shown rather than typed (with its tooltip), and
  phone stacking with every cell labelled. The day total ($2,440) and the On set subtotal ($1,410)
  reconcile with the lines.
- **Owner detail and client page**: "Kit Hire - <asset>" is one name everywhere; the owner sees days ×
  rate and the Own kit tag, the client sees neither price nor "own kit" nor anything internal. Totals
  agree across the editor, the detail and the client page ($3,870.00).
- **Multi-year CSV block**: sits under the year's export as a quiet secondary action and wraps cleanly at
  800 and 375.
