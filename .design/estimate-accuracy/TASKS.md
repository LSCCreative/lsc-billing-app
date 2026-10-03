# Build Tasks: Estimate Accuracy

Generated from: the money-logic audit of 2026-09-30 (overhead → capacity → goals → rate card →
estimate), plus the user's answers the same day. There is no `DESIGN_BRIEF.md` for this track: it is
an audit follow-up, and the findings and sample figures are under "Source" below. **Tasks 9–14
change what the app charges or how a job is judged, and each one carries an open decision. Run
`/grill-me` on them (9–10 first) before building — the recommendations below are mine, not the
user's.**
Date: 30 September 2026

Every task carries a model/effort tag from root `CLAUDE.md`'s buckets, same convention as
`.design/price-calculator/TASKS.md`:

- **(money math — Opus/high)**: anything touching `calc.js`, a stored price, or a screen that
  *renders* a computed price or floor. Applies "regardless of how small the diff looks".
- **(frontend — Opus/high)**: UI-build work with no money figure of its own.
- **(copy — Sonnet/high)**: wording only, no arithmetic and no layout. Small enough for the cheaper
  bucket; if a wording change starts needing a number computed, it is not this bucket any more.
- **(deploy — Sonnet/medium)**: infra steps.

State the bucket out loud and pause for the user to switch models before starting a task, as
`CLAUDE.md` requires. This list was written on Sonnet, so **the money-math tasks are not to be
started in that session.**

## Source: what the audit found

Sample inputs used for every worked example below (a reference set, not the user's live figures):
six overhead items totalling $15,940/yr; three assets giving a $4,483.33/yr replacement reserve;
capacity 8 hrs × 5 days, 30 leave + 8 sick = 1,776 billable hrs; Desired Net Income $65,000, Target
Markup 25%, super 12%, bad debt 2%; the FY 2026–27 resident scale with 2% Medicare. That chain gives
business cost $20,423.33, overhead rate $11.50/hr, pay before tax $81,647.06, **Target Annual Revenue
$114,151.06, income floor $64.27/hr**, and an auto hourly price of $81 (half day $324, full day $648).

The arithmetic was sound, and every step reconciles (pay before tax minus its tax is exactly the
$65,000 target). The findings are the three things in tasks 1–3, the four settings in tasks 4–7, and
the seven accuracy gaps in tasks 8–14 (task 8 since scrapped by the user).

## Ground rules for every task

- **`calc.js` is two byte-identical copies** (`server/src/calc.js`, `web/js/calc.js`). Every edit is
  two edits; the drift test in `test-calc.js` fails otherwise. `depreciation.js` follows the same rule.
- **Gate: `cd server && npm test`** after any server change (253 pass at the start of this track).
  New pure functions and changed money rules get worked-example tests in `test-calc.js`. Route
  changes get tests in `test-api.js`.
- **For money math, check the mutation, not just the green suite**: break the line you wrote,
  confirm a test fails, put it back. Record which mutations you checked in the task's "Done" note.
- **A change that moves a rate says so**, as the 48-week-year retirement did: say how much on the user's real figures before it lands.
- **Saved estimates never move.** A line keeps its own snapshot and an estimate keeps its stored
  totals. Any new per-line field is optional, null-safe on read, and absent on every line already
  saved, and its absence must total identically to before. Pin that with a test.
- **Every new estimate field must reach three places:** `computeTotals`, the estimate editor's row
  builder and `collect()`, and the client PDF / estimate detail. A field that prices but does not
  print, or prints but does not price, is the bug this list exists to prevent.
- **Schema changes are additive and null-safe.** The web build must survive an older server and
  vice versa for a deploy. **Deploy NAS before Pages** for any change that adds a boot-time route or
  column the web reads.
- **Anything a person looks at is verified in a browser** against the scratch API (`api-scratch` in
  `.claude/launch.json`, login `dev`; re-seed if `/tmp` was wiped). Real mouse clicks in the browser
  pane don't always land, so use dispatched `.click()` and poll on a DOM condition. Measure at
  1280 / 800 / 375. Above 1100px nothing may move except the new states.
- **Every task's Done note goes in this file**, and `HANDOVER.md` is updated when a task finishes.
- **Build on a branch (`estimate-accuracy`), not `main`** — pushing `main` deploys Pages. Tasks 1, 2
  and 7 are web-only and safe to ship alone.

---

## Group A — Three things that are wrong

- [x] **1. Capacity's "Full-day hours" block is out of date** (copy — Sonnet/high): the block at
  [`capacity.js:287`](../../web/js/views/capacity.js) says a Full Day row "starts at" Capacity's
  billable hours per day, with a half day at half that. Since v9 a day on a job uses the Rate Card's
  **Service Day** (8 / 4 hrs), which is deliberately not Capacity's figure; the Rate Card's own
  popover says so. Someone who sets 6 billable hrs/day is told a full day is 6 hrs and sees 8 on the
  card. Replace the block with a short pointer saying a day sold on a job takes its hours from the
  Rate Card's Service Day setting, and that Capacity's figure is a yearly planning average used only
  to work out the hourly floor. Remove the now-dead `cap-fullday-value` / `cap-halfday` writes in
  `refreshOutcome` (lines 197–199) and the `.cap-fullday*` rules in `capacity.css`, or reuse them for
  the pointer. _Modifies: `capacity.js`, `capacity.css`._ Done when no sentence on the screen says a
  Full Day starts at billable hours per day, and the screen's a11y announcer and other fields are
  untouched.

  **Done 2026-09-30.** The block is now a pointer headed "Days sold on a job": a full or half day on
  an estimate takes its hours from the Rate Card's Service Day setting, and Billable hours per day is
  a yearly average that only sets the hourly floor. It shows no figure, so there is no second number
  for "a day" to drift. Removed the `perDay` / `dayOk` block in `refreshOutcome` and the
  `.cap-fullday-value*` CSS; `.cap-fullday` stays for the spacing. Nothing else referenced those ids
  (grepped `web/`, `server/test`). Verified in the browser against `api-scratch`: the block renders,
  typing 6 into Billable hours per day moves Annual billable hours 1,776 → 1,332 and back without
  touching the pointer, no console errors, no page overflow at 375px. Copy only: no `calc.js` or
  server change, so Pages alone; 253 tests still pass.

- [x] **2. The Target Markup hint says less than markup does** (copy — Sonnet/high): the hint at
  [`goals.js:466`](../../web/js/views/goals.js) says markup is added "for a job's minimum price and
  the cost floor". It also sets every **auto price on the Rate Card** (income floor × (1 + markup),
  rounded up), and moving 25% to 35% raises all of them about 8%. Reword to say so, keeping the
  "a markup, not a margin" sentence and "enter 25 for 25%". Check the Rate Card's and Dashboard's own
  markup wording says the same thing rather than something narrower. _Modifies: `goals.js`, maybe
  `pricing.js` / `finance-dashboard.js` copy._ Done when all three places agree.

  **Done 2026-09-30.** The Profit Goals hint now reads: "Added on top of cost. It sets every auto
  price on your Rate Card (your income floor plus this markup) as well as a job's minimum price and
  the cost floor, so raising it raises them all. A markup, not a margin: 25% on cost is a 20% share of
  the price. Enter 25 for 25%, not 0.25." The header comment in `goals.js` says the same. **The other
  two places needed no change:** the Dashboard's floor-comparison popover already says an auto hourly
  price is "your floor plus your Target Markup", and the Rate Card has no sentence about markup at
  all (only the Service Day popover, which is about days), so nothing there is narrower than the
  truth. Deliberately not added to the Rate Card: it would be new copy on a screen this task did not
  find wrong. The hint is one line longer than its neighbours in the three-column row and fits …

- [x] **3. Direct costs on a GST-inclusive card are not ex-GST** (money math — Opus/high): when
  `settings.gst.registered` and `pricesIncludeGst` are both true, `computeTotals` treats `billed` as
  GST-inclusive, so crew, equipment and fuel costs typed in are inclusive too. Yet
  [`directJobCost`](../../server/src/calc.js) and `passThroughCost` come back **inclusive** and feed
  Minimum Job Price and the Income floor line, which compare against the **ex-GST** client price.
  Effect: $1,100 of crew makes the quote look $100 worse against its floors than it is. Dormant while
  the business is unregistered (the user is), so fix it before GST is ever switched on. Convert both
  through the existing `exGst()` helper inside `computeTotals`; check `travelCost` (resold travel's
  cost) takes the same conversion. Consumers: the editor's floor lines and cost breakdown
  (`estimate-editor.js`, `directJobCost`) and the Pass-through Cost row in
  [`estimate-detail.js:208`](../../web/js/views/estimate-detail.js), so confirm the detail row's label
  and value agree. Stored estimates keep their stored totals. _Modifies: `calc.js` (both copies),
  `estimate-detail.js` if its figure or label needs to follow._ Done when: tests pin, on a
  GST-inclusive card, $1,000 ex-GST of crew at $1,100 entered gives `directJobCost` 1,000 and the
  Income floor need 1,642.70 (sample figures, 10 hrs at $64.27 floor) rather than 1,742.70; the same
  estimate on an unregistered card and on a GST-free estimate is unchanged; a sweep over prices
  confirms nothing else in the totals moved. Mutation-check the divisor.

  **Done 2026-09-30** (Opus/high, on branch `estimate-accuracy`). In `computeTotals` the `exGst`
  helper now sits right after `pricesIncludeGst` and both cost figures go through it:
  `passThroughCost = exGst(crew + equip + direct travel)` and
  `directJobCost = exGst(that + travelCost)`, so resold travel's cost converts too. `expenseTotal`,
  `labourTotal` and every as-billed figure are untouched. On an unregistered card, an exclusive card
  and a GST-free estimate `exGst` is the identity, so nothing moves there. Both `calc.js` copies are
  identical. **The estimate detail row** now reads "Pass-through Cost (ex GST)" whenever the stored
  `gstTreatment` is `taxable`, which is true on both card types: an exclusive card's costs are typed
  ex-GST. Otherwise it reads as before. The editor needed no change: its Minimum Job Price, Income floor
  line and breakdown modal all read …

## Group B — Settings and the decisions the user made

- [ ] **4. Confirm the FY 2026–27 tax scale is live** (settings — user, then a check): the user
  reports on 2026-09-30 that they have saved it on the live site. Nothing to build. When a session has
  the user's go-ahead to sign in (credentials in `.credentials.local.md`), check the live Dashboard
  and Rate Card show real floors and auto prices rather than `—`, and record the live income floor in
  `HANDOVER.md` as the reference figure the later tasks' before/after numbers use. _No code._

- [ ] **5. Transport & Logistics Hrs is "Your time"** (money math — Opus/high): the user confirmed on
  2026-09-30 that it is their own hours. Two parts. **(a)** In
  [`defaults.js`](../../server/src/defaults.js) set `ownTime: true` on that travel row so Reset
  Defaults and a fresh database match; add a test that `DEFAULT_PRICING` carries it, and that a
  2-hour line on it counts as $70 of income (2 × `mu` 35, none of it treated as cost) and 2 billable
  hours in `totalHours` (today it counts $20, the markup over its $25 `rate`, and 0 hours). **(b)** The
  **live** Rate Card needs the "Your time" box ticked and saved, which is a change to live data:
  do it only with the user's go-ahead, or leave it to them; record which in the Done note. Note the
  row's `rate` stops meaning anything once ticked. Also see task 6, which is the reason this row
  matters. _Modifies: `defaults.js`, its test._

  **(a) Done 2026-09-30** (Opus/high, branch `estimate-accuracy`). `defaults.js`: Transport &
  Logistics Hrs now carries `ownTime: true`. `rate: 25` is left as it was but is no longer read, and
  the docblock says why. This reaches exactly three things: a fresh database, Reset Defaults, and a
  line added to a card nobody has saved, because `readPricing` falls back to `DEFAULT_PRICING`. A
  saved card keeps its own row. A saved line keeps its snapshot: one added before this change carries
  `{ mu: 35, rate: 25 }` with no flag and still prices as resold, which a test pins.
  **Tests** (5 new, 262 pass): `DEFAULT_PRICING` carries the flag on that row and no other; a 2-hr
  line on it gives `expenseTotal` 70, `incomeExGst` 70, `directJobCost` 0, `totalHours` 2, tax 24.50,
  overhead 20 at $10/hr, and `labourHoursBreakdown` agrees. The same line on the old row gives
  income 20, cost 50, 0 hrs. A line added from the default card snapshots the flag, and a line saved
  before it does not move. The route test Reset Defaults → GET returns the flag.
  **Fixtures moved.** The `JOB` worked example in `test-calc.js` used the default transport row as
  its *resold-travel* case ("exercises every path at once"). It now prices against a pinned
  `JOB_PRICING`: the default card with that one row still resold. So its figures (1420, 2040 income,
  714, …) are unchanged and still cover the resold path. 23 call sites switched. The fresh-database
  route test in `test-ratecard.js` really does read the default card, so it moved knowingly and is
  commented: `totalHours` 10 → 14, `taxSetAside` 504 → 539, `estTakeHome` 936 → 1001 (income 1,540
  not 1,440).
  **Mutations checked**, each caught: flag removed (5 tests fail), flag `false` (5), flag put on
  Crew Meals instead (1).
  **Browser** (scratch API, restarted so the server loaded the new defaults; the first attempt ran
  against the old process and showed the box unticked): after Reset Defaults the Rate Card's travel
  table shows "Your time" ticked on Transport & Logistics Hrs only. The scratch card was saved first
  and put back afterwards, and it matches exactly.
  **(b) Not done: needs the user.** The live Rate Card's "Your time" box on that row must be ticked
  and saved. That is a change to live data, so it is left to the user or to an agent with explicit
  go-ahead. Until it is ticked, live quotes keep treating transport hours as resold ($10/hr income,
  0 hours). **Deploy:** server-only (`defaults.js`), no migration. It changes nothing live until the
  live card is reset, so it can ride along with any NAS deploy.

- [x] **6. Travel priced properly: your time at the floor, the car per km** (money math —
  Opus/high). **Grilled with the user 2026-09-30; every decision below is theirs, don't re-ask.** It
  started as "badge an own-time travel row under the floor". The user asked for more: travel time
  priced **from the floor**, plus the car recovered **per km** at a rate they set on the Overhead
  tab. Split into 6a and 6b, which can land separately (6a first). _Depends on: task 5._

    **Done 2026-09-30** (Opus/high, branch `estimate-accuracy`).

- [ ] **7. Keep income tax out of the Overhead "Tax" category** (frontend — Opus/high): Target Annual
  Revenue already adds the owner's income tax through the ATO scale, so income tax entered as an
  overhead item is counted twice and raises every rate. The category's label is display-only (the
  stored value stays `tax`, no migration). Relabel it in `CATEGORIES` in
  [`overhead.js:96`](../../web/js/views/overhead.js) to say what belongs there, for example
  "Business taxes & fees (not income tax)", and show a one-sentence note when it is chosen in the
  add/edit form, in the same place and manner as the existing double-count hint (`overhead.js:325`).
  Check every place the category label is printed — the register, the charts and legend, the
  Dashboard's split, the CSV if any — takes the new label from one source rather than a second
  copy. **The user must also open the live Overhead list and delete or reduce any item in that
  category that is income tax or a tax instalment;** it is their data. _Modifies: `overhead.js`
  and whatever else prints the label._ Done when the note appears only for that category, the label
  reads the same everywhere, and it is verified at 375px.

## Group C — Fields and rules that make an estimate more accurate

Ordered by how much money they move. Each starts with **Decision needed** — settle it with the user
before building; the recommendation is mine.

- [—] **8. Expected booking rate — scrapped by the user, 2026-09-30.** They are not ready for
  pricing on a booking rate. The income floor keeps assuming every billable hour is sold, and the
  Target Markup keeps covering unsold time as well as profit. Don't rebuild it or re-propose it
  unless the user raises it. The number is kept so 9–14 keep theirs.

- [ ] **9. "Own kit" on equipment hire, and how each asset is recovered** (money math — Opus/high):
  Equipment Hire lines are always treated as someone else's invoice, passed through at cost. If the
  user bills their own camera kit there ($300/day on the sample), it counts as **$0 income** (no
  tax set aside), raises Minimum Job Price by $300 as though it were a cost, and the client pays for
  that gear twice because the same asset is already recovered through the hourly rate by the
  replacement reserve. **Decision needed:** (a) how the user bills their own gear — as a line the
  estimate carries ("own kit") or purely through the hourly rate; (b) if lines, whether each asset is
  marked as recovered "through my hourly rate" (today's behaviour, default) or "through kit-hire
  lines" (then the asset leaves `replacementReserveTotal`, so the rate stops charging for it).
  Recommend both, with the default unchanged. **Build:** an optional `ownKit: true` on an equipment
  line (a checkbox on the row, like travel's "Your time"), priced in `computeTotals` exactly as an
  own-time travel line — billed, counted as income, taxed, **excluded from `directJobCost` and from
  `passThroughCost`**, and no hours. An additive asset column `recovery` (`'rate'` | `'kit_hire'`,
  default `'rate'`) which `replacementReserveTotal` respects, edited in the depreciation register and
  shown on its disposal and schedule screens as informational. Check the Dashboard's Operating /
  Replacement-reserve split and the double-count prompt read correctly with an asset on `kit_hire`.
  Also cross-check the client PDF and estimate detail: the equipment line prints as before.
  Worked example, sample figures: 8 hrs at $110 plus a $300 own-kit line gives client price 1,180,
  income 1,180, tax 354.00 at 30%, and Minimum Job Price 115.00 (today: income 880 and MJP 415.00).
  A line without the flag totals identically to before. _Modifies: `calc.js`, migration,
  `routes/depreciation.js`, `estimate-editor.js`, `rows.js`, `estimate-detail.js`, `pdf.js`,
  `depreciation.js` (view)._

- [ ] **10. A discount line** (money math — Opus/high): the only way to discount today is to cut
  hours, and that cuts both floor lines too, so a discount never shows. Quoting 20 real hours as 16
  makes the Income floor read $1,028.32 instead of $1,285.40 (sample). **Decision needed:** (a) shape —
  recommend one estimate-level discount, either a dollar amount or a percent; (b) what it applies to —
  recommend **labour and own-time income only, never pass-throughs** (which are billed at cost), so a
  crew invoice is not discounted below what it cost; (c) where it is stored — recommend a
  `discount` object beside `activeRows` and a small migration, not a non-array key hidden inside
  `activeRows`, which three places (`NON_LABOUR_KEYS` in calc, `RESERVED_SECTION_IDS` in ratecard and
  rows) would each have to be told to ignore; (d) whether the client sees it on the PDF —
  recommend yes, as a "Discount" line before GST. **Build:** `computeTotals` takes it, reduces
  `labourTotal`'s income before GST and tax, and leaves `totalHours` at the real hours (that is the
  point); the editor shows the discount, the real price before discount and the after-discount price
  against both floors (the Income floor line already says "under it by $X"); PDF and estimate detail
  print it. Worked example: 20 hrs at $110 = $2,200, less $440 (20%) gives a client price of $1,760,
  20 hours, Income floor need still $1,285.40, tax and take-home on $1,760. Saved estimates with no
  discount total identically. `averageJobValue` reads the discounted price, which is what was won.
  _Modifies: `calc.js`, migration, `routes/estimates.js`, `estimate-editor.js`, `estimate-detail.js`,
  `pdf.js`._

- [—] **11. Loadings — superseded 2026-09-30** by the user's surcharge system (short notice,
  weekend/holiday, after hours, production only), which is being designed in
  [`.design/production-booking/`](../production-booking/DESIGN_BRIEF.md). Don't build a per-line loading.

- [ ] **12. Minimum call per service** (money math — Opus/high): an on-site service (capture,
  drone) is rarely worth turning up for under a set number of hours. **Decision needed:** enforce
  (bill at least N) or warn only — recommend **warn only**, in the editor, as an advisory like
  Minimum Job Price, because forcing a bill is a pricing rule the user hasn't asked for. A
  `minHours` on a Rate Card service (optional, blank = none), snapshotted on the line; the line shows
  "under the 2 hr minimum" when qty × hoursPerUnit is below it. Migration: card JSON shape only, so
  add it to `cardShapeOutdated` awareness carefully — an old card without it must keep working, and
  an old build must not save a card that drops it. _Modifies: `calc.js`, `pricing.js`,
  `estimate-editor.js`, `routes/pricing.js`._

- [ ] **13. Handling markup on crew and hire** (money math — Opus/high): crew and equipment are
  billed exactly at cost, so the business fronts other people's invoices for nothing and carries the
  risk of a client not paying (the bad-debt allowance only covers the business's own revenue).
  **Decision needed:** whether to charge a handling markup at all — recommend an optional, blank-means-0
  **card-level percent** on Crew & Contracts and on Equipment Hire (two fields on the rate card,
  beside `taxSetAsideRate`), applied to the cost, with the markup counted as **income** (taxed, no
  hours) and the rest still pass-through. Not per line: per-line is fiddly and easy to forget. This
  changes `directJobCost` only by the cost part, not the markup. Also decide the rounding and the
  GST treatment on an inclusive card (see task 3). _Modifies: `calc.js`, `pricing.js`, the estimate
  editor, `pdf.js`._ Depends on: tasks 3 and 9, which both change the same lines.

- [ ] **14. A half-day loading** (money math — Opus/high, **decision only until the user says
  go**): an auto half day is exactly half an auto full day, because brief decision 13 (service rate
  tiers) made every auto day the hourly × its hours. The user accepted that, but the earlier
  price-calculator rule was that setup, travel and turnaround don't halve. This is reopening a
  settled decision, so **don't build it unless the user asks.** If asked, the least invasive shape is a
  card-level "half-day loading (%)" beside Service Day, blank = 0, applied only to *auto* half-day
  prices (a typed price still wins), rounded up like the hourly. _Modifies: `calc.js` (`unitDef`),
  `pricing.js`, the Service Day popover copy._

## Wrap-up

- [ ] **15. Deploy** (deploy — Sonnet/medium): **ask the user first.** Back up the live DB
  (`sqlite3 ".backup"` into `/volume4/lsc-billing/data/backups/`), redeploy `server/` with the usual
  `COPYFILE_DISABLE=1 tar` (excluding `node_modules`, `./data`, `.env`, `docker-compose.yml`),
  `docker compose up -d --build`, check `healthy` and the boot log's migration lines, then push
  `main` for Pages. **NAS before Pages** whenever a migration or a new goals/asset field ships. Web-only
  tasks (1, 2, 7) can go without the NAS step. Record run ids and the live income floor before and
  after in `HANDOVER.md`.

- [ ] **16. Money-math review, then design review** (review): a `/code-review` (xhigh) of the whole
  track's diff, hunting specifically for a field that prices but doesn't print (or the reverse), a
  line saved before the change that now totals differently, and a two-copy `calc.js` drift. Fix
  findings, then run `/design-review` against the screens changed here. List fixes in this file
  under "Code review fixes" and "Design review fixes", as the earlier tracks do.
