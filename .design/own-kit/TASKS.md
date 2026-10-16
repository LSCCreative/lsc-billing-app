# Build Tasks: Own kit

Generated from: `.design/own-kit/DESIGN_BRIEF.md`. Date: 2026-10-13. Decisions are K-D1…K-D11 there.
Schema goes **v16 → v17**. Deploy NAS before Pages. Every `calc.js` change is applied to both copies
(`server/src/calc.js`, `web/js/calc.js`); `npm test` in `server/` is the gate; for money maths break
the line and confirm a test fails. Verify screens at 1280 / 800 / 375 against the scratch API.
Tags: **(money — Opus/high)**, **(frontend — Opus/high)** = **Frontend task**, **(backend — Sonnet/high)**.

## Foundation

- [x] **K1. Asset columns and API** (backend — Sonnet/high): migration v17 adds
  `depreciation_assets.recovery TEXT NOT NULL DEFAULT 'rate' CHECK (recovery IN ('rate','kit_hire'))`
  and `day_rate REAL` (null, ≥ 0). `loadAsset` returns `recovery` and `dayRate`; `POST`/`PUT` in
  `routes/depreciation.js` validate them (a kit asset may be saved without a rate; a negative or
  non-number rate is refused; `dayRate` is kept but ignored on `rate`). Additive migration, no rebuild.
  Done when: v17 migrates a copy of the live backup, old assets read `recovery: 'rate'`, and tests in
  `test-db.js` / `test-depreciation.js` cover the columns and refusals. _Modifies: `db.js`,
  `routes/depreciation.js`._ **Built:** `recovery` / `dayRate` are kept when a PUT omits them (a pre-v17
  tab can't move a kit asset onto the floor); `null` or `''` clears the rate; refusals are 400
  `recovery_invalid` / `day_rate_invalid`. Tests: `test-db.js` (v17), `test-api.js` (three own-kit tests).

- [x] **K2. Kit assets leave the reserve** (money — Opus/high): `replacementReserveTotal` skips any
  asset with `recovery === 'kit_hire'` (field-shape-agnostic like its other reads), in both `calc.js`
  copies. Check every reader: `annualBusinessCost` (so `ratecard.js` and every rate), `routes/overhead.js`
  snapshot, the Finance Dashboard's Operating / Replacement-reserve split, and the Overhead double-count
  prompt. Done when: an asset moved to `kit_hire` lowers the annual business cost by exactly its reserve;
  a test pins before/after; the split still sums; a mutation (drop the filter) fails a test.
  _Depends on: K1. Modifies: `calc.js` ×2, `test-calc.js`._ **Built:** one filter, `isKitHire` (exact
  `'kit_hire'` only; null, a pre-v17 row or anything else stays in), inside `replacementReserveTotal`;
  every reader goes through it, so nothing else changed. The double-count hint reads no assets. The
  register's per-asset reserve, delete and disposal copy now say $0 / "no rate changes" for a kit asset
  (correct); the modal's live reserve line passes no `recovery`, so K3 must handle it. Tests:
  `test-calc.js` (two), `test-api.js` (the snapshot's raw-row path).

## Core UI

- [x] **K3. Recovery setting in the register** (frontend — Opus/high, **Frontend task**): the Add/Edit
  asset modal gains a "Recovery" choice, Overhead Floor / On-Set Kit, with a Day rate field shown for
  On-Set Kit (the replacement cost and cycle fields are hidden or marked unused there). The register
  table gains a tag per row and shows each asset's current tax book value (add the column if the table
  lacks it). Warnings: an Overhead Floor asset missing replacement cost or cycle ("contributes $0 to your
  rates"), and an On-Set Kit asset with no day rate ("can't be added to an estimate yet"). Switching to
  On-Set Kit shows how much per year leaves the floor (`replacementReserveTotal([asset])`). Done when:
  the modal saves both fields, the tags and warnings show and clear correctly, the reserve stat and the
  info text describe kit assets, and 375px is checked. _Modifies: `views/depreciation.js`,
  `css/overhead.css`/its finance styles. Depends on: K1, K2._ **Built:** Recovery is a radio pair
  in "For pricing" (structural, like method: re-renders); Day rate shows for kit, the reserve fields hide
  but keep and still send their values. The live line says what a switch moves ("takes $X a year out" /
  "adds"), or what's missing. Register: "Adjustable value, 30 Jun <FY end>" column (this FY's closing
  value; "In pool" for pooled) and a Recovery column (tag, $/yr or $/day, gap warning). A Vehicle on the
  floor with a cost per km set isn't flagged ("Billed per km"). Checked 1280 / 800 / 375 on scratch.

- [x] **K4. Own-kit line pricing** (money — Opus/high): an equipment line may carry `ownKit: true`. In
  `computeTotals` it is billed (in the client price), counted as income and taxed exactly as an own-time
  travel line, adds no hours, and is excluded from `crewTotal`/`equipTotal` pass-through so neither
  `passThroughCost` nor `directJobCost` includes it. `costBreakdown` lists it as income (owner-only);
  `rows.js` per-row figure follows. Put the K-D6 worked example in `test-calc.js` as written, plus: a
  line without the flag totals identically (a sweep against the old results), GST on a registered /
  GST-inclusive card, and a mutation per exclusion. Done when: both copies are identical and the drift
  test passes. _Modifies: `calc.js` ×2, `rows.js`, `test-calc.js`. Independent of K1–K3._ **Built:** `isOwnKit(line)`
  (exact `true` only, exported) splits `equip` into `equipTotal` (vendor) and `kitTotal`; kit is in
  `expenseTotal` (so the editor's Labour + Expenses subtotals still sum) and `incomeExGst`, not in
  `passThroughCost` / `directJobCost` / `totalHours`. No new key on the totals object. `costBreakdown`
  keeps a kit line in `equip` (lines still add up) with `ownKit: true`; K6 decides how it prints.
  `rows.js` `costBill` needed no change (the bill is days × cost either way). Tests: 13 in `test-calc.js`
  (K-D6 example, GST exclusive / inclusive / GST-free, stray-flag sweep); 8 mutations each fail a test;
  a 20,000-estimate random sweep matched the committed `calc.js` exactly. **For K5:** the estimates route
  stores lines as sent, so an `ownKit` flag already prices once saved; K5's validation is the guard.

- [x] **K5. "Add On-Set Equipment" pop-up and kit lines in the editor** (frontend — Opus/high,
  **Frontend task**): a button in Equipment Hire (and the day card's on-set menu) opens a multi-select of
  non-disposed On-Set Kit assets that have a day rate (name, category, rate, "Already added" tag).
  Confirm adds lines `{ ownKit: true, assetId, assetName, item: assetName, vendor: '', days, cost:
  <snapshotted day rate> }`, with Days per K-D8 and attaching to the chosen day via `dayId`. A kit line
  shows an "Own kit" tag and an editable Days; its rate is shown, not typed (re-add to refresh). Kit lines
  are excluded from vendor suggestions and `syncRentals` (no rental, no "Add pickup and return dates"
  hint). The server (`routes/estimates.js`, `days.js` line checks) accepts and validates `ownKit`,
  `assetId`, `assetName`, and rejects an `ownKit` line whose day is unknown like any other line. Done
  when: add, edit days, remove and save round-trip; a saved estimate reopens identically; changing the
  asset's rate later leaves the line's price alone; "Update to current rates" doesn't touch kit lines;
  checked at 375. _Modifies: `estimate-editor.js`, `booking-block.js`, `routes/estimates.js`,
  `rentals.js` (vendor match skips kit). Depends on: K1, K4._ **Built:** two entry points: the day
  menu's Equipment Hire group ("+ Add On-Set Equipment", that day, 1 day each; on a phone the sheet closes
  first) and Equipment Hire's summary head (Not on a day, days = the estimate's day count, min 1). The
  pop-up (`#modal-own-kit`, bottom sheet <768) has one "Days each" field for the batch; Add is disabled
  until something is ticked and days > 0; "Already added" is tied to its checkbox by `aria-describedby`;
  unrated kit assets are counted in a note, never listed. A kit row (`buildKitRow`, `.kit-row`) carries
  `data-own-kit/asset-id/asset-name/cost`; `hireRows()` is every equip row but kit, used by rentals and
  vendor suggestions; Duplicate day copies the snapshot. `booking-block.js` needed no change. Server:
  `days.js kitLineProblem` → 400 `own_kit_invalid` / `own_kit_not_equipment` / `own_kit_asset_invalid` /
  `own_kit_asset_name_invalid` / `asset_on_hire_line`; the asset isn't looked up (K-D7); `rentalsWithGear`
  skips kit. Tests: three in `test-api.js` (round trip + income, rate change and asset deletion leave the
  line alone, refusals), each rule mutation-checked. Checked 1280 / 800 / 375 headless on scratch (add,
  days, remove, Move, Duplicate day, save, reopen, Update to current rates, Escape/Cancel focus). Until
  K6, documents print a kit line by its asset name like any hire line.

- [x] **K6. Kit lines on every client document** (money — Opus/high): an own-kit line prints as
  "Kit Hire - [Asset name]" with days, rate and total on the client PDF (`pdf.js` `eqName` path and
  `atCost('Equipment Hire', …)`), the owner's estimate detail, the client estimate page (`c/#e/…` through
  its allow-list), and invoice documents built from stored snapshots. Internal figures stay off public
  routes (K-D6's income treatment is never printed). Sent versions and existing invoices that held kit
  lines stay frozen. Done when: PDF, detail and client page show the same lines and totals; a test in
  `test-pdf.js` / `test-public.js` asserts the label and that no cost-breakdown figure leaks.
  _Modifies: `pdf.js`, `estimate-detail.js`, public estimate view. Depends on: K4, K5._ **Built:** the
  user's call 2026-10-16: **like other hire**, so client documents (quote and invoice PDFs, client
  estimate and invoice pages) list "Kit Hire - <asset> · N days" with **no line price** (only a
  production day's items are priced there); days × rate = total shows on the owner's estimate detail and
  in the Cost Breakdown, which already priced every hire line. One reader, `calc.js equipLineName(line)`
  (kit: "Kit Hire - " + the line's own `assetName`, else `item`; vendor: Item, else old `vendor` text),
  used by `costBreakdown`, `pdf.js serviceGroups` (kit days in the item's `tag`, now printed for hire
  groups too) and `estimate-detail.js` (plus the editor's "Own kit" tag under the name). `c.js` already
  drew tags, so no change there. Sent versions keep their frozen client view; renaming a kit line on a
  sent quote is a client-facing change (409 `resend_required`). Tests: `test-pdf.js` (quote + invoice
  PDF, single invoice doc, Cost Breakdown), `test-public.js` (client page incl. frozen version, invoice
  page), `test-calc.js` (`equipLineName`; K4's breakdown name updated). 7 mutations each fail a test;
  740/740. Checked 1280 / 375 headless (detail and client page) on a throwaway DB.

## Interactions & States

- [ ] **K7. Multi-year accountant CSV** (money — Opus/high): add `GET /api/depreciation-schedule-multi.csv
  ?from=<FY>&to=<FY>` (default prior FY → current FY) producing one row per asset with: Asset
  Description, Date Purchased, Purchase Price (AUD), Business Use %, Taxable Cost Base (cost base ×
  business use, informational), Depreciation Method, Effective Life (Yrs), then per FY Opening Value /
  Claim / Closing Value, then Disposal Date / Proceeds / Balancing Adjustment / Notes (a plain sentence,
  e.g. "Disposed 12/03/2027 for $800: balancing adjustment −$120"). Pool rows as in the single-FY CSV;
  a totals row sums Taxable Cost Base and each FY's Claim. A lodged FY reads from its frozen snapshot;
  UTF-8 with BOM. The Depreciation page gets "Export asset schedule (multi-year CSV)" with a From / To FY
  choice defaulting to prior + current; the single-FY export stays. Done when: test fixtures with a part-
  year asset, a part-personal asset, a disposal, a pool and a lodged year reconcile to the single-FY
  export figures year by year. _Modifies: `routes/depreciation.js`, `views/depreciation.js`. Reuses:
  `financialYearSchedule`, `buildCsv`'s helpers._

## Responsive & Polish

- [ ] **K8. Accessibility and responsive pass** (frontend — Opus/high, **Frontend task**): the asset
  modal's new fields and warnings, the pop-up (focus trap via `LSCModal`, Esc, multi-select keyboard use,
  labelled checkboxes), the Own kit tag and its row on a stacked phone table (`data-label` on every cell),
  the register tags (not colour alone). Breakpoints 1280 / 800 / 375. Done when: a headless axe run and
  keyboard walk show nothing new.

## Review

- [ ] **K9. Money review, then design review**: `/code-review` (xhigh) of the track's diff for a field
  that prices but doesn't print (or the reverse), a saved estimate that now totals differently, a
  two-copy `calc.js` drift, and a kit line leaking onto a public route; fix, then `/design-review`
  against the screens changed. List fixes in this file under "Code review fixes" and "Design review
  fixes".

- [ ] **K10. Deploy** (deploy — Sonnet/medium): **ask the user first.** Back up the live DB; fetch and
  diff `origin/main`; **NAS first** (v17; run the migration on a copy of the backup first), then Pages.
  Record in `ROADMAP.md` and `WORKING_NOTES.md` (the K-D6 rule, kit lines and rentals), tick
  estimate-accuracy task 9 as done by this track. After: the user sets each asset's Recovery, fills
  replacement cost/cycle on floor assets and day rates on kit assets.
