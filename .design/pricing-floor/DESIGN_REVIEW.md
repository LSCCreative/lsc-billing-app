# Design Review: Pricing floor (PF4–PF8)

Reviewed against: `BRIEF.md` (P1–P7) and `TASKS.md` PF4–PF8
Philosophy: the app's own system (functionalist: dark panels, `.tax-setting` blocks, mono figures in
`--font-figures`, `--accent-text` as the "below floor / under by" voice)
Date: 2026-10-20

## Screenshots Captured

Headless Chrome (`server/node_modules/puppeteer-core`) against the scratch API with one five-figure
review estimate ($10,988, deleted afterwards). Screens after the fixes below. Local only
(`.design/*/screenshots/` is gitignored).

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-capacity-{desktop-1280,tablet-800,mobile-375}.png` | 1280 / 800 / 375 | Capacity: hours worked, share you can bill, the working line, save bar |
| `screenshots/review-goals-{desktop-1280,tablet-800,mobile-375}.png` | 1280 / 800 / 375 | Profit Goals: target ledger, Business profit field |
| `screenshots/review-dashboard-{desktop-1280,tablet-800,mobile-375}.png` | 1280 / 800 / 375 | Finance Dashboard: floors, rate card against floors, Per hour, Target |
| `screenshots/review-ratecard-{desktop-1280,tablet-800,mobile-375}.png` | 1280 / 800 / 375 | Rate Card: tax rate, Card fees, Service Day, rows |
| `screenshots/review-ratecard-cardfee-info-*.png` | 1280 / 800 / 375 | The Card fees ⓘ open |
| `screenshots/review-editor-*.png`, `review-editor-mjp-*.png` | 1280 / 800 / 375 | Estimate editor summary, Minimum Job Price line and tick |
| `screenshots/review-editor-mjp-breakdown-*.png` | 1280 / 800 / 375 | The Minimum Job Price breakdown modal |

## Summary

The five screens tell one consistent story: income floor $143.75, auto hourly $161 at 1.65%, break-even
$165,939.97 + profit $16,594.00 = $182,533.97, and every ledger and the Minimum Job Price breakdown add
up to the cent at all three widths with no sideways scroll. The findings were all **copy the new model
had made wrong** (Capacity and the Service Day ⓘ still talked in overhead-rate and "billable hours per
day" terms) and one placement: the "Show minimum" tick sat two blocks above the line it controls.
These four are fixed. One naming question is left for the user.

## Must Fix

None.

## Should Fix

1. **Capacity's save bar described the old model** — "Saving changes every labour rate on your card…
   your overhead is divided across these hours" (`views/capacity.js`). Typed prices don't move, and
   break-even (not overhead) is what the hours divide. See `review-capacity-desktop-1280.png`.
   _Fixed: "Saving moves your income floor, and every auto price on your Rate Card with it: break-even
   is divided across these hours. Prices you've typed, and estimates already saved, keep their figures."_
2. **Capacity's save confirm quoted the wrong figure** — "Your overhead cost per hour rises from …"
   (`moveWarning`). Since PF1 no price follows the overhead rate. _Fixed: it quotes the income floor
   (`incomeFloorPerHour(revenueTarget().breakEven, hours)`): at 60% "Your income floor rises from
   $143.75 to $155.72 an hour, and every auto price on your Rate Card and the Minimum Job Price on new
   estimates move with it. Prices you've typed don't move." Checked on scratch with the dialog
   intercepted, nothing saved._
3. **The Service Day ⓘ on the Rate Card** said "Not Capacity's billable hours per day: that one averages
   your whole year, admin and quiet days included" (`views/pricing.js serviceDayInfo`), which PF4 made
   untrue. _Fixed: "Not Capacity's hours worked per day: that one is a normal working day, admin
   included, and with the share you can bill it sets your hourly floor. A day on a job is often longer."_
4. **"Show minimum" sat above the totals, two blocks from its line** (`views/estimate-editor.js
   summaryMarkup`). It was placed when it governed two floors. See `review-editor-mjp-mobile-375.png`.
   _Fixed: the tick now sits directly above the Minimum Job Price line; off hides only that line, the
   total is unchanged._
5. **Open, the user's call: the Rate Card's "Mark-Up ($)" column is the price.** Its note says
   "Mark-Up stays yours to set", and the read-only estimate's lines say "Markup" too
   (`estimate-detail.js`). Since PF6 the markup is "Business profit", so a column called Mark-Up that
   holds $161 (an auto price that already includes the 10% profit) now reads as a second, different
   markup. _Suggestion: rename the column "Price ($)" and the note "Prices stay yours to set"; the
   field's own accessible name already says "Hourly price for …". Not changed: it renames a column the
   user has worked with since the desktop app._

## Could Improve

1. **Label casing on the Rate Card**: "Card fees (%)" (as PF8 specified, sentence case like PF4/PF6)
   sits under "Tax Set-Aside Rate (%)" and above "Service Day (billable hrs)". _Suggestion: pick one
   casing for the three blocks; sentence case matches the newer screens._
2. **Est. Take-Home is green while the quote is under break-even** (editor summary: $4,450.40 in
   `--ok` beside "This quote is under by $2,220.75"). Both are right, but green reads as "fine".
   _Suggestion: keep take-home neutral when the Minimum Job Price verdict is "under"._
3. **Pre-existing, not from this track:** at 375 the Profit Goals tax-bracket table stacks each bracket
   into a tall card with the × on its own line, and the Finance sub-nav strip clips its outer tabs.

## What Works Well

- **Every ledger sums to the cent and says so visibly**: Profit Goals and the Dashboard's Target share
  the `.dash-line` ledger (parts, ruled Break-even, Business profit, total), and the Minimum Job Price
  modal's four shares add to "Your hours" exactly ($2,001.10 + $7,898.46 + $947.82 + $221.37 =
  $11,068.75).
- **One voice for "too low"**: "below floor by", "under by" are `--accent-text` everywhere, with no
  green/red pair the palette doesn't have.
- **The Per hour chain on the Dashboard** (floor → + profit → + card fee → auto hourly, overhead rate
  muted as a reference) explains the auto price in the order the maths runs.
- **The settings blocks stay one pattern**: tax rate, card fees and Service Day are the same
  `.tax-setting` shape, stacking to full-width 44px fields at 375.
