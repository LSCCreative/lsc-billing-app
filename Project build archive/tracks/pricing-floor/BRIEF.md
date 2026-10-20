# Pricing floor: utilisation, one minimum, business profit

From the money-math review of 2026-10-20 (findings 1–3), grilled with the user the same day. Money
math throughout: `Opus, effort: high`. The Capacity, Profit Goals, Dashboard and editor changes are a
**Frontend task**.

## The problem

- Capacity priced as if every working hour is billed (8 h × 222 days = 1,776 h), so the income floor
  was ~35–40% low.
- The editor's headline "Minimum Job Price" was the cost floor (overhead × markup, no pay): $168.90
  for an 8-hour day against a $747 income floor.
- The 25% markup sat on top of an income floor that already carries pay, tax, super and bad debt, and
  nothing in the target accounted for it, so the Dashboard target never matched a full card. In
  practice it was quietly standing in for the missing utilisation.

## Decisions (the user's, 2026-10-20)

| # | Decision |
|---|---|
| P1 | Capacity becomes **hours worked per day × share you can bill (%)**. Annual billable hours = (working days − leave − sick) × hours worked × utilisation. "Billable hours per day" is renamed "Hours worked per day". |
| P2 | Migration sets the live row to **hours worked 8, utilisation 65%**, whatever was stored (the old figure was already averaged down, so keeping it would count admin twice). New installs default to 65%. The card moves on deploy, knowingly. |
| P3 | The markup is **business profit, before tax**: renamed "Business profit (%)", shown as its own line in Target Annual Revenue. Profit = break-even target × %. Auto price = income floor × (1 + profit), as `suggestedPrice` does today. |
| P4 | Migration sets the live profit to **10%** (from the stored markup), in the same deploy as P2, so the card moves once. |
| P5 | **One Minimum Job Price = break-even**: direct job cost + hours × income floor, no profit. Replaces both the cost-floor MJP and the separate "Income floor" line in the editor. |
| P6 | **The cost floor goes everywhere**: `hourlyFloor`, the Dashboard's "Cost floor" row and sentence, the editor's cost-based MJP. The overhead rate stays as a reference figure on the Dashboard, because the per-job tax reserve subtracts hours × overhead rate. |
| P7 | **Card fees are built into every price, for every client** (added 2026-10-20). A Rate Card field "Card fees (%)" raises every auto price, whatever the client pays with: auto price = income floor × (1 + profit) × (1 + card fee). **Never a card-only surcharge**: eftpos, Mastercard, Visa, Amex and PayPal ban surcharging from 1 October 2026 (RBA conclusions, March 2026), so adding the fee only to invoices paid by card is not allowed, however it is labelled. |

## Card fees (P7), settled while adding it

- Stripe has no API that returns a merchant's rate. Once card payments exist (the `card-payments` track),
  the field shows the rate actually paid, Stripe fees ÷ amount over recent payments (30c included), with a
  "Use this" button. It is never written automatically. Until then the field is typed; Stripe standard is
  1.65% + A$0.30 domestic from 1 October 2026.
- Typed prices are final and don't move. Only auto prices carry the fee, like profit.
- The fee is income-side pricing, not a floor: the break-even Minimum Job Price (P5) and the Rate Card badges
  leave it out.
- It is a new field on the card, so bump `PRICING_SHAPE` (an older build would drop it on save).
- Not covered: the card fee on pass-through money (a $10,000 crew line paid by card costs ~$165 in fees).
  That belongs with the review's handling-fee finding, which is out of scope here.

## Settled while grilling (veto here if wrong)

- The income floor divides the **break-even** total (cost + gross pay + super + bad debt), never the
  total with profit. `revenueTarget` returns `breakEven`, `businessProfit` and `total`;
  `incomeFloorPerHour` is fed `breakEven`. Bad debt is not grossed up on the profit.
- The Minimum Job Price is advisory only: "under by $X", never blocks a save or send. It stays owner-only
  (off public routes and the Cost Breakdown).
- The editor's ⓘ breakdown splits hours × income floor into business cost / pay and tax / super / bad
  debt (each its share of the break-even target), plus direct costs. That replaces direct /
  overhead / markup.
- The "Include overhead" tick becomes "Show minimum".
- Own-time travel stays at the income floor with no profit, but does take the card fee (P7: every auto
  price). Pass-throughs and the per-km car take neither.
- Rate Card badges keep comparing against the income floor (no profit): a typed price between the floor and
  floor × 1.1 is not badged.
- The post-ratio readout uses hours worked as a day's length, against utilised capacity.
- `PUT /api/goals` that leaves out utilisation keeps the stored value (an old Pages tab during the NAS-first
  deploy must not reset it). Utilisation range is 1–100%.
- Deploy NAS before Pages (new column + migration).

## Reference figures (defaults: $30k cost, $90k net, 12% super, 2% bad debt, FY2026-27 scale)

| | Before | After |
|---|---|---|
| Annual billable hours | 1,776 | 1,154.4 |
| Income floor / h | $93.43 | $143.75 |
| Overhead rate / h | $16.89 | $25.99 |
| Auto hourly | $117 (+25%) | $159 (+10%) |
| Auto full day (8 h) | $936 | $1,272 |
| Minimum Job Price, 8 h, no costs | $168.90 (cost floor) | $1,150 (break-even) |
| Target Annual Revenue | $165,940 | $165,940 break-even + $16,594 profit = $182,534 |

Figures are before the card fee (P7). At 1.65% the auto hourly is $161 (rounded up once, on floor × 1.1 × 1.0165) and the
full day $1,288.

A full card at capacity bills $183,550: the target to within whole-dollar rounding of the hourly price.

## Not in scope

Findings 4–9 of the review (jobs-needed averaging pass-throughs, surcharge defaults, pass-through
handling fee, kit day-rate check, marginal tax reserve, surcharge simplification) are separate.
