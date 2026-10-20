# Build Tasks: Pricing floor

Generated from: `.design/pricing-floor/BRIEF.md`. Date: 2026-10-20. Decisions are P1–P7 there.
Schema goes **v17 → v18**. Deploy NAS before Pages. Every `calc.js` change goes into both copies
(`server/src/calc.js`, `web/js/calc.js`); `npm test` in `server/` is the gate; for money maths, break
the line and confirm a test fails. Check screens at 1280 / 800 / 375 against the scratch API, using a
five-figure total (WORKING_NOTES).
Tags: **(money — Opus/high)**, **(frontend — Opus/high)** = **Frontend task**.

Reference check for every money task, on the defaults ($30k cost, $90k net, 12% super, 2% bad debt,
FY2026-27 scale): 1,154.4 h, floor $143.75/h, overhead $25.99/h, auto hourly $159 (no card fee) /
$161 (1.65%), full day $1,272 / $1,288, Minimum Job Price for 8 h with no costs $1,150.

## Foundation

- [x] **PF1. The money model** (money — Opus/high): in both `calc.js` copies.
  `annualBillableHours` takes `utilisationPct` (a PERCENT, 1–100; missing reads as 100 so a pre-v18
  payload prices exactly as before) and returns days × hours worked × utilisation.
  `revenueTarget` returns `breakEven` (today's total), `businessProfit` (breakEven × profit %, before
  tax, not grossed for bad debt) and `total`. `incomeFloorPerHour` callers pass `breakEven`, never
  `total`. `suggestedPrice` gains a card-fee factor: target = floor × hours × (1 + profit) × (1 + card
  fee), rounded up once. `unitDef` / `travelRowDef` read `ctx.cardFeePct`: own-time travel takes the card
  fee but not profit; per-km and every pass-through take neither. `minimumJobPrice` becomes
  `directJobCost + hours × incomeFloor` (break-even, P5). `hourlyFloor` is deleted.
  `postRatioReadout` uses hours worked as a day's length, against utilised annual hours. Update the
  header essay (decisions 1/1a/4, SERVICE UNITS 3) so it states the new model, not the old one.
  Done when: the reference figures above are pinned in `test-calc.js`; a pre-v18 goals payload (no
  utilisation) and a card with no card fee total identically to today (sweep); mutations fail (drop the
  utilisation factor, feed `total` into the floor, add profit to the minimum, put the card fee on a
  pass-through). _Modifies: `calc.js` ×2, `test-calc.js`. Nothing else depends on its UI._
  _Done 2026-10-20: 10 new tests (incl. a vm test of `data.js`), 13 mutations killed. Also touched, minimally:
  `data.js` (floor ÷ breakEven; target gets `profitPct`), `estimate-editor.js` (MJP call + note),
  `finance-dashboard.js` (no `hourlyFloor`; a Business profit line). `travelFloorComparison` takes an
  optional 4th `ctx` for the card fee: PF3/PF8 pass `priceContext()` there too._

- [x] **PF2. Schema v18 and the goals API** (money — Opus/high): migration v18 adds
  `goals.utilisation_pct REAL` (CHECK 1–100) and, on the live row, sets `billable_hours_per_day = 8`,
  `utilisation_pct = 65` and `target_profit_margin_pct = 10` (P2, P4). New installs default to 65.
  `loadGoals` returns `utilisationPct`; `PUT /api/goals` validates it (1–100, 400
  `utilisation_out_of_range`) and **keeps the stored value when the body leaves it out** (an old Pages
  tab during the NAS-first deploy). `ratecard.js readOverheadRate` and the legacy weekly column
  (`routes/goals.js` ~202) pass it to `annualBillableHours`. The column keeps its name; the API key for
  the markup stays `targetProfitMarginPct` (relabel only). Additive, no rebuild. Done when: v18 migrates a
  copy of the live backup; tests in `test-db.js` (v18 values) and `test-api.js` (validation, omission
  keeps, stored estimate totals unchanged by the migration). _Depends on: PF1. Modifies: `db.js`,
  `routes/goals.js`, `ratecard.js`._
  _Built 2026-10-20 (committed, not deployed): 3 new tests, 6 mutations killed; the v6/v10/v17 upgrade
  tests now stop at `{ to: 17 }`. A NULL profit stays NULL. The live-backup run moved to PF11 (the NAS
  was unreachable off the home network); `check-v18.js`-style: copy, migrate, diff every other table.
  Until PF4 the Capacity screen's own annual figure and change sentence ignore the share._

- [x] **PF3. Card fee on the rate card** (money — Opus/high): the card gains `cardFeePct` (a PERCENT,
  0–10, blank = 0). `PUT /api/pricing` validates it (400 `card_fee_out_of_range`); bump `PRICING_SHAPE`
  so an older build can't drop it on save. `LSCData.priceContext()` passes it (and `utilisationPct`
  reaches every `annualBillableHours` call in `data.js`). Saved estimate lines are untouched (snapshots).
  Done when: `test-ratecard.js` covers validation and the shape bump; an auto price on scratch moves by
  exactly the fee; a typed price doesn't. _Depends on: PF1. Modifies: `ratecard.js`, routes for pricing,
  `data.js`, `calc.js` ×2 (`PRICING_SHAPE`)._
  _Done 2026-10-20 (committed, not deployed): `PRICING_SHAPE` 'card-fee'; `routes/pricing.js` takes null or a
  number 0–10 (a string is refused); `priceContext().cardFeePct`; the Rate Card carries the fee through
  `workingCopy`/`payload` with no field yet (PF8). 3 tests, 5 mutations killed. Scratch: fully auto
  $159/$636/$1,272 → $161/$644/$1,288 at 1.65%, own-time travel $144 → $147, no typed price or day price
  derived from a typed hourly moved, and a Save Rates from the screen kept the fee._

## Core UI

- [x] **PF4. Capacity: hours worked × share you can bill** (frontend — Opus/high, **Frontend task**):
  "Billable hours per day" becomes "Hours worked per day"; a new "Share you can bill (%)" field beside
  it, with a hint ("most solo businesses bill 55–70%"). The working under the annual figure gains the
  utilisation step (…= 1,776 hrs worked × 65% = 1,154 billable hrs). Validation, the before/after change
  sentence and the save toast follow. The "Days sold on a job" note drops "admin and quiet days included".
  Done when: save round-trips, a blank or out-of-range share is refused with the field named, and 375px is
  checked. _Reuses: the Capacity form, `derivation()`. Depends on: PF2._
  _Done 2026-10-20 (committed, not deployed): the share sits on its own row under a rule, after leave and
  sick (not beside hours: five fields in pairs leave a gap, and it applies to the whole year, the
  order the working reads in). `derivation()` ends "…= 1,776 hrs worked × 65% = 1,154.4 billable hrs";
  the confirm adds "(1,776 hrs worked × 60% you can bill)". Profit Goals now passes `utilisationPct` to
  `derivation()`, so PF6's capacity-figure item is done. Scratch: blank and 150 refused naming the
  field, 60% saved and read back from the API, restored to 65%; 800 and 375 checked._

- [x] **PF5. Estimate editor: one Minimum Job Price** (frontend — Opus/high, **Frontend task**; money
  display): the Summary shows one advisory line, **Minimum Job Price** = break-even (P5), with "this quote
  clears it" or "under by $X" (no block on save or send). The separate "Income floor" line goes. The ⓘ
  modal splits hours × income floor into business cost / pay and tax / super / bad debt (each its share of
  `breakEven`) plus direct costs, adding up exactly (largest-remainder or remainder row, as today). The
  "Include overhead" tick becomes "Show minimum". The note says "N hours at your $X/hr income floor, plus
  direct costs", with the hours working as today. Done when: figures match PF1 on a five-figure job, the
  modal sums to the line, and 1280 / 800 / 375 are checked. _Modifies: `paintMinimum`, `paintIncome`
  (removed), `setBreakdown` in `estimate-editor.js`. Depends on: PF1._
  _Done 2026-10-20 (committed, not deployed): the split is `calc.js minimumJobPriceParts` (both copies;
  whole cents by largest remainder), 1 test, 4 mutations killed. The verdict sits after the figure
  ("This quote is under by $X" in --accent-text, the Rate Card's below-floor voice; "clears it" plain;
  none on a $0 minimum), the note on its own row. The modal: "Your hours" (muted, the shares' sum) with
  running costs / pay and its income tax / super / bad debt indented under it, each "of your $X year",
  then direct costs. Tick id `f-show-minimum`. Scratch, five-figure job: $10,947.50 under by $719.50 =
  58 h × $143.75 + $2,610; shares $1,507.32 + $5,949.49 + $713.94 + $166.75 = $8,337.50; clears at
  $17,860 vs $17,847.50; tick off/on leaves the total alone; 1280 / 800 / 375 checked._

- [x] **PF6. Profit Goals: Business profit** (frontend — Opus/high, **Frontend task**): "Target Markup"
  becomes **"Business profit (%) — before tax"**, with a hint saying what it's for (slow years,
  upgrades, growth; on top of your pay). Target Annual Revenue shows break-even parts, then a "Business
  profit" line, then the total. The read-only capacity figure shows the utilisation step. Done when: the
  breakdown adds up to the total to the cent, saving the profit moves auto prices on the Rate Card without a
  reload, and 375px is checked. _Modifies: `views/goals.js`. Depends on: PF1, PF2._
  _Done 2026-10-20 (committed, not deployed): the field is "Business profit (%) — before tax" (hint: on top of
  your pay, for slow years, upgrades and growth; in every auto price, not the floor or the Minimum Job
  Price). Target Annual Revenue now passes `profitPct` and shows a ledger under the figure, Dashboard
  `.dash-line`s in `--font-figures`: running costs, pay (tax indented), super, bad debt, a ruled
  Break-even subtotal, "Business profit, N% of break-even", then the total; the profit line shows even
  at 0%. Scratch: $165,939.97 + $16,594.00 = $182,533.97 to the cent; 12% saved moved the Rate Card's
  auto hourly $161 → $164 with no reload (badges unchanged), restored to 10%; a blank profit refused
  naming the field; 1280 / 800 / 375 checked._

- [x] **PF7. Finance Dashboard** (frontend — Opus/high, **Frontend task**): remove the "Cost floor"
  row and sentence. Per hour shows Overhead rate (labelled "running costs only, a reference") and the
  Income floor (the floor), plus the auto price with profit and card fee. Target shows break-even +
  profit = total. Floors comparison and post-ratio readout follow PF1. Jobs needed divides `total`.
  Done when: nothing on the screen still mentions a cost floor or markup, and 1280 / 375 are checked.
  _Modifies: `views/finance-dashboard.js`. Depends on: PF1._
  _Done 2026-10-20 (committed, not deployed): the chain's right panel is "Per hour": billable hours, Income
  floor (ruled subtotal), + Business profit %, + Card fees % ("none" when blank), Auto hourly price
  (`suggestedPrice` then `priceExGst`), and under it, muted, "Overhead rate — running costs only, a
  reference". Target: parts, Break-even, "Business profit, N%", total, per-month average (income floor
  moved to Per hour). `travelFloorComparison` now gets `priceContext()`; the info copy says business profit
  and card fees. The ledger modifiers `.dash-line-of/-sub/-ref` now live in finance-dashboard.css (Profit
  Goals uses them) and every `.dash-line-value` is in `--font-figures`. Scratch: $143.75 / $25.99 / $161
  at 1.65%, $165,939.97 + $16,594.00 = $182,533.97, no "cost floor" or "markup" on screen; 1280 / 375
  checked._

- [x] **PF8. Rate Card: card fee field** (frontend — Opus/high, **Frontend task**): a "Card fees (%)"
  field near the tax reserve, with an info button: the fee is in every price for every client; card
  surcharges are banned from 1 October 2026; Stripe standard is 1.65% + 30c. The "rate actually paid"
  readout and its "Use this" button wait for the `card-payments` track (leave a placeholder comment, no
  UI). Badges stay against the bare income floor. Done when: it saves, auto prices update live, typed
  prices don't move, and 375px is checked. _Modifies: `views/pricing.js`. Depends on: PF3._
  _Done 2026-10-20 (committed, not deployed): its own `.tax-setting` block under the tax rate, "Card fees
  (%)" (0–10, step 0.01, blank = none) with an ⓘ (ban from 1 Oct 2026, the price formula, Stripe 1.65% +
  30c, badges on the bare floor). Typing reprices every auto row in place (a valid figure goes onto
  `priceCtx`; a bad one keeps the last good one until the save names the field); the own-time travel
  comparison now gets `priceCtx`. Reset's confirm says the fee goes back to none. The three blocks' hint
  copy is now `.pricing-setting-hint`, not an inline style. Scratch: auto hourly $159 / $161 / $163 at
  blank / 1.65 / 3%, own-time travel $147 → $149 at 3%, floor badge stays $143.75, 23 typed prices
  unmoved; 12 refused naming the field; 2 and blank (null) saved and read back; restored to 1.65;
  1280 and 375 checked (popover included)._

## Review and ship

- [x] **PF9. Money review** (money — Opus/high): an end-to-end pass on scratch with the reference
  figures and one five-figure job (labour, a kit line, crew, travel, a weekend day): stored totals,
  Cost Breakdown, PDF and invoice unchanged for estimates saved before v18; new estimates snapshot the
  new auto prices. Rewrite the WORKING_NOTES money-model lines this changes (income floor, `mu`
  auto-writes, markup → business profit, Minimum Job Price, capacity "1,776 knowingly"). _Depends on:
  PF1–PF8._
  _Done 2026-10-20 (no code change): a scratchpad harness ran the live v17 build (`141c3e4`) on a
  throwaway DB with the reference setup and 25% markup, saved a $13,464.44 job (labour typed and auto,
  a weekend day, kit, crew, vendor hire, own-time travel, per km, meals) plus a draft, sent and accepted
  it (deposit paid, final sent), then booted HEAD on a copy (v17 → v18: goals 8 h / 65% / 10%). Every
  estimate, project and invoice JSON and all 8 documents (estimate PDF, Cost Breakdown, both invoices'
  PDF and Cost Breakdown) were identical. Reference: v17 $93.43 / $16.89 / $117 / $936; v18 $143.75 /
  $25.99 / $161 / $1,288 / own-time $147 at 1.65%. Re-saving the old draft moved only `overheadShare`
  $1,368.09 → $2,105.19, `taxSetAside` $3,000.87 → $2,742.88, `estTakeHome` (today's overhead rate; noted
  in WORKING_NOTES, not a bug). A new job on v18 snapshotted $1,288 / $161 / $147 with typed lines
  unmoved; totals $13,455.40 + $1,345.54 = $14,800.94 checked by hand, deposit/balance $7,400.47 each;
  no internal figure on any of its 6 documents. Its Minimum Job Price is $13,942.15 (81 h × $143.75 +
  $2,298.40), so the default card's typed rates leave it under by $486.75: for the user's PF11 review of
  typed rows below the floor. WORKING_NOTES money lines rewritten._

- [ ] **PF10. Design review**: run /design-review against the brief for PF4–PF8 at 1280 / 800 / 375.

- [ ] **PF11. Deploy** (Sonnet/medium; ask the user first): back up the live DB, run v18 on a copy of
  the live backup (PF2's deferred check: goals before/after, every other table unchanged, `foreign_key_check`), fetch and diff `origin/main`, then NAS before Pages (`DEPLOYMENT.md`). After deploy,
  check the live Rate Card shows the new auto prices and the user reviews typed rows now badged below the
  floor. Update ROADMAP and move the folder to the archive.
