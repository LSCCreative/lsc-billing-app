# Own kit: asset recovery setting, kit hire lines, multi-year CSV

Replaces estimate-accuracy task 9. Decided with the user 2026-10-13 (a `/grill-me` and their written
spec). All decisions below are the user's; don't re-ask.

## Why

Equipment Hire lines are always a vendor's invoice passed through at cost. The user's own gear billed
there counts as $0 income, raises Minimum Job Price as if it were a cost, and the client pays for it
twice, because the same asset is already recovered through the hourly rate by the replacement reserve.

## What already exists (don't rebuild)

The Depreciation register: asset fields, ATO methods (DV, PC, instant write-off, pools, car), opening →
decline → closing with FY locks, disposal and balancing adjustment, an editable write-off threshold,
the replacement reserve feeding the overhead rate, the Operating / Replacement-reserve split, and a
single-FY accountant CSV (`GET /api/depreciation-schedule.csv`).

## Decisions

- **K-D1 Tax engine unchanged.** Deduction is apportioned by business use, the adjustable value is not;
  days-held proration from the start date; threshold stays user-entered; no salvage in the tax calc.
- **K-D2 Reserve formula unchanged:** (replacement cost − expected resale) ÷ replacement cycle years ×
  business use %. The cycle is the user's own number, separate from the ATO effective life.
- **K-D3 Warning:** an asset on the Overhead Floor with no replacement cost or no cycle contributes $0;
  the register flags it so it can't silently under-recover.
- **K-D4 Recovery setting per asset:** `rate` ("Overhead Floor", default) or `kit_hire` ("On-Set Kit").
  A kit asset leaves `replacementReserveTotal`, so the hourly rate stops charging for it.
- **K-D5 One day rate per kit asset.** No hourly rate. (Equipment lines are already Days × Cost/day.)
- **K-D6 Option A pricing:** a kit line is billed to the client and is the user's **income**: taxed,
  no hours, **not** in `directJobCost` or `passThroughCost`, so it doesn't raise Minimum Job Price.
  Worked example (sample figures): 8 hrs at $110 plus a $300 kit line gives client price 1,180,
  income 1,180, tax 354.00 at 30%, Minimum Job Price 115.00 (without the flag: income 880, MJP 415.00).
  A line without the flag totals identically to before.
- **K-D7 Snapshot:** a line keeps the day rate it was added at; saved estimates, sent versions and
  invoices never move. The line records its asset (`assetId`, `assetName`) for display only.
- **K-D8 Pop-up "Add On-Set Equipment":** multi-select of non-disposed On-Set Kit assets with a day
  rate, adding lines to the estimate or attaching them to a booked day (`dayId`, as other on-set items).
- **K-D9 "Own kit" tag:** kit lines are kept out of vendor suggestions and gear-rental tracking
  (rentals are keyed by vendor name; a kit line has no vendor and makes no rental).
- **K-D10 Client sees** "Kit Hire - [Asset name]" per line, with days and total, like other hire.
- **K-D11 Multi-year CSV:** current FY + prior FY by default, FY columns side by side
  (Opening / Claim / Closing per year), a totals row (Taxable Cost Base and each year's claim), and
  disposal notes. A lodged FY reads from its frozen snapshot. Pools appear as rows.

## My assumptions (small; the user can overturn)

- A kit asset with no day rate is flagged in the register and left out of the pop-up.
- "Update to current rates" doesn't touch kit lines (they snapshot; re-add to refresh).
- Pop-up days: 1 per asset from a day card; the count of booked days (min 1) for the whole estimate;
  always editable. An asset already on the estimate is tagged "Already added" but can be added again
  for another day.
- The existing single-FY CSV stays; the multi-year file is an added export, not a replacement.
- Switching an asset to On-Set Kit shows how much per year leaves the floor, so the rate drop isn't a
  surprise. A job without the kit line then under-recovers that gear: that is accepted.

## Out of scope

Hourly kit rates, per-asset utilisation, kit availability or clash checking against the shared
calendar, changing any tax calculation.
