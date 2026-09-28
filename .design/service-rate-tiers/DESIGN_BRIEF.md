# Design Brief: Service Rate Tiers

Hourly, half-day and full-day prices on every labour service, auto-priced from the floor plus
Target Markup, and picked per line in the estimate editor.

Builds on the live Finance & Price area ([`.design/price-calculator/`](../price-calculator/)). That
track stays the authority for everything this brief does not explicitly overturn. The overturned
points are listed under **Resolved Decisions** below, so nobody reverts them by mistake.

## Problem

A service like Video Capture is one thing to me, but the rate card makes it three: "Video Capture",
"Video Capture — Full Day" and "Video Capture — Half Day", each a separate row that I have to
create, name, price and keep in step. Every new service I want to sell by the day means more
duplicate rows. When I'm building a quote and the shoot shrinks from a full day to a half day, I
have to delete one line and hunt for a different service in the list, rather than just changing the
day length.

The prices themselves are also guesswork. The Rate Card already knows my floor for each row (what an
hour has to earn to hit my Target Annual Revenue), and Profit Goals already knows the markup I want
on top. But the price box sits there empty or holding an old number, and I work out floor × markup
in my head for every service, three times over now.

## Solution

Each labour service holds **three prices: hourly, half day and full day**. On the Rate Card, a row
looks the way it does today. The `per [hour ▾]` dropdown under the service name switches which
unit's Rate and Mark-Up the row is showing, so the card stays one line per service.

Every price **fills itself in**: the floor for that unit, marked up by Target Markup, rounded up to
the whole dollar. As long as I leave a price alone it keeps following my numbers. If I raise my
revenue target or add an overhead cost, it moves with them. Once I type my own figure, that price is
mine and stays put. A small "set by you" line under it shows what the suggestion would be now, with a
one-click way back to auto.

A service day is defined once for the whole card: **full day = 8 billable hrs, half day = 4**. These
are the hours inside a service on a job, not Capacity's average working day.

In the estimate editor I pick a service, pick its unit (Hour / Half day / Full day), then Add. The
line shows its unit, and I can switch the unit on the line later. The line re-prices from the card
at the new unit, so a shoot that shrinks from a full day to a half day is one change, not a delete
and re-add.

## Experience Principles

1. **One service, one row.** The card lists what I sell, not every way I sell it. Units are a view
   of the service (the dropdown), not extra rows. Anything a hidden unit needs to tell me (below
   floor, no price yet) still shows on the row I'm looking at.
2. **The suggestion leads, my number wins.** Auto prices do the arithmetic I was doing in my head,
   and follow my goals without being asked. A figure I type is never overwritten, and I can always
   see how far it sits from the suggestion.
3. **A quote never moves on its own.** Auto prices move on the card. Saved estimate lines keep the
   price and hours they were added at (the existing per-line snapshot), until I press "Update to
   current rates".

## Aesthetic Direction

- **Philosophy**: The existing dark editorial system, extended rather than restyled. The Rate Card
  and estimate editor must look as they do now, with one more state on the price field.
- **Tone**: Calm and authoritative. This is a pricing tool: numbers first, few words, no
  celebration.
- **Reference points**: The Rate Card's own floor line (`floor $X` / `below floor by $X`) and its
  existing `per [hour ▾] [8] billable hrs` second line. The new states read as siblings of those.
  Spreadsheet "formula vs typed value" behaviour is the mental model for auto vs set-by-you.
- **Anti-references**: A pricing-wizard or SaaS "plan tiers" look (three cards side by side). A
  price that changes with no visible indication. A dense grid of 3 × 19 price inputs.

## Existing Patterns

- **Typography**: Funnel Sans (body, 13px base; labels 9–11px uppercase with letter-spacing),
  Delight 700 for page titles and headline figures. Self-hosted in `web/fonts/`, declared in
  `web/css/app.css:14-16`.
- **Colors**: `web/css/app.css:19-21`: `--bg #181818`, `--text #F0EDE8`, `--surface #2C2F35`,
  `--border #3D4A5C`, `--accent #B85444`, `--muted` (42% text), `--muted2` (18%). `--accent-text`
  and `--ok` in `a11y.css`/`app.css`. Below-floor uses `.pricing-below` (`--accent-text`).
- **Spacing**: The app's existing ad-hoc px values (no scale file). Match neighbouring rules in
  `pricing.css` and `estimates.css`; don't introduce a scale.
- **Components**:
  - Rate Card rows: `pricing.js` `labourSectionMarkup()`: `.pricing-table`, `.pricing-row-meta`
    (the `per [unit ▾]` line), `.pricing-unit-sel`, `.pricing-hpu-inp`, `.pricing-rate-ro`,
    `.pricing-floor` (the line under Mark-Up).
  - Estimate editor pickers: `.bb-picker` with `.svc-select` + `+ Add Service`
    (`estimate-editor.js` `labourSectionMarkup()`); labour lines `buildLabourRow()` with the
    `.lab-unit` second line.
  - Line snapshots: `LSCCalc.lineSnapshot` / `lineDef` (calc.js); the editor's `SNAP_KEYS`,
    "Update to current rates" and "Use rates from last project" (`rateKey`, `lastRateFor`).
  - Floors: `LSCData.incomeFloor()` (Target Annual Revenue ÷ annual billable hours),
    `LSCCalc.labourFloorComparison`, `LSCCalc.hoursPerUnitOf`.
  - Target Markup: `LSCData.goals().targetProfitMarginPct` (a markup percent; the column predates
    the rename).
  - Info control: `web/js/info.js` (`LSCInfo.markup`), button + popover, not hover.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Rate Card labour row | Modify | Still one `<tr>` per service. Rate and Mark-Up show the selected unit's figures. |
| Unit dropdown (`per [hour ▾]`) | Modify | Becomes a **view switch** (it no longer changes what the row *is*). Resets to Hour on each mount. Option text flags a hidden problem, e.g. "full day · below floor". |
| Billable-hrs field on the row | Remove | Replaced by the card-level Service Day setting. The row shows `· 8 billable hrs` as text when a day unit is selected. |
| Rate ($/hr) cell | Modify | Shows the selected unit's cost: overhead/hr × that unit's hours (13.51 → 108.08 for a full day), with the existing unit suffix (`/hr`, `/half day`, `/day`). Still read-only; still never written. |
| Mark-Up ($) price field | Modify | Holds the selected unit's price. Two states: **auto** (value derived live) and **set by you** (typed). |
| Price state line (under Mark-Up) | Modify | Extends `.pricing-floor`: `auto · floor $45.05`, or `set by you · ↺ use $57`, plus `below floor by $X` as today. |
| Hidden-unit notice | New | Under the service name when the selected unit is fine but another isn't: "Full day below floor by $12.40 ▸". Clicking it switches the dropdown to that unit. |
| "Show" switch | New | Card-wide `Show: Hourly \| Half day \| Full day` above the tables. Sets every row's dropdown; view-only (decision 12). |
| Service Day setting | New | One card-level pair at the top of the Rate Card: Full day `[8]` billable hrs, Half day `[4]`. Validated 0.5–24, half ≤ full. |
| Estimator unit picker | New | A second `<select>` in `.bb-picker` between the service select and `+ Add Service`: "Hour · $140", "Half day · $640", "Full day · $1,120". A unit with no price is listed disabled with the reason. |
| Estimator line unit switch | Modify | `.lab-unit` ("per full day · 8 billable hrs") becomes a small select on the line. Switching re-snapshots that line's price and hours from the card at the new unit. |
| `calc.js` suggested price | New | One function, identical in `server/src/calc.js` and `web/js/calc.js`, for floor × hours × (1 + markup), GST-adjusted, rounded up to the dollar. Every screen reads it. None re-derives it. |
| Rate card data shape + migration | Modify | Per-service unit prices with an auto flag, plus card-level service-day hours. The shape itself is for the IA/tasks step (see Key Interactions §6 for the rules it must meet). |
| Dashboard comparison + headline day floors | Modify | Headline half/full-day floors use Service Day hours, not Capacity's. The comparison covers every unit of every service. |
| Client PDF | Unchanged | Labour still lists by service name only (the user's call). |
| Travel & Accommodation rows | Unchanged | Single cost-based price; no units, no auto price. |

## Key Interactions

### 1. Service Day setting

Top of the Rate Card, beside the tax set-aside setting: `Service day: Full [8] hrs · Half [4] hrs`,
with an info control. The info text says these are the hours inside a service on a job, separate
from Capacity's billable hours per day, which only averages the year.

- Editing either value re-derives every **auto** day price on screen as you type (the floor ×
  hours changes). **Set-by-you** prices don't move. Only their "use $X" suggestion does.
- A blank or out-of-range value (0, above 24, or half above full) blocks the save and shows an
  inline reason, the same as the existing hours field does.
- Saved estimates keep the hours each line was added at (`hoursPerUnit` is already on the
  snapshot).

### 2. Switching units on a Rate Card row

`per [hour ▾]` → pick "full day":
- The Rate cell becomes the full-day cost (`108.08/day`), the price field shows the full-day price,
  and the second line reads `per [full day ▾] · 8 billable hrs`.
- Focus stays on the select. The price field's accessible name follows the unit ("Full-day price
  for Video Capture").
- The choice is view state only: not saved, not "unsaved changes", and back to Hour on the next
  mount.

### 3. Auto vs set-by-you prices

- **Auto**: the field shows the suggested price, with `auto · floor $450.50` under it. It updates
  live when the Service Day hours change on this screen, and on the next mount after Overhead,
  Capacity or Profit Goals change.
- **Typing a number** into the field switches that unit, and only that unit, to **set by you**. The
  line becomes `set by you · ↺ use $451`. It keeps `below floor by $X` when below floor, and the
  existing floor check still applies.
- **↺ use $451** puts the unit back to auto. A service can mix auto and set-by-you units.
- **Clearing the field** (empty) also returns it to auto, rather than saving a blank price.
- **When the floor can't be worked out** (Target Revenue or capacity unset, e.g. the FY tax scale
  isn't saved yet), an auto price shows `—` with `auto · needs Profit Goals` linking there.
  Set-by-you prices are unaffected.

### 4. The suggested price (money math — pin with tests)

```
suggested(unit) = ceilToDollar( incomeFloorPerHour × hours(unit) × (1 + targetMarkupPct / 100) × gstFactor )
hours(hour) = 1, hours(half) = serviceDay.halfHours, hours(full) = serviceDay.fullHours
gstFactor   = 1.1 only when the card is kept GST-inclusive (settings.gst.pricesIncludeGst); else 1
```

- **Rounded up per unit**, never down, so an auto price is always at or above floor × markup. Each
  unit is rounded on its own: the full day is `ceil(floor × 8 × 1.25)`, not 8 × the rounded hourly.
- Round to the cent first, then ceil, so an exact `$57.00` stays `$57`, not `$58` from float noise.
- **Refined in build (task 1, 2026-09-28):** on a GST-inclusive card the price is the smallest whole
  dollar whose GST-exclusive part (via `priceExGst`) reaches the cent-rounded floor × hours × markup.
  Multiplying by 1.1 and then rounding lands 1¢ under the floor at a few half-cent edges (0% markup),
  which would badge an auto price below its own floor. Where the two recipes differ, it is by +$1.
- The floor is the **income floor** (`incomeFloorPerHour`, what the Rate Card's floor line already
  shows), not the cost floor. The markup is **Target Markup**.
- A consequence the user accepts knowingly: an auto half day is (to the dollar) exactly half an
  auto full day. Independent half-day pricing still exists; you get it by typing the price.

### 5. Estimate editor: adding and switching

- `.bb-picker`: `[Service ▾] [Unit ▾] [+ Add Service]`. The unit select repopulates when the service
  changes, each option carrying its current price ("Full day · $1,120"). It defaults to Hour.
- **Add** creates a line snapshotted at that unit: `mu`, `unit`, `hoursPerUnit` (from the Service
  Day setting) and `rowId`. Auto prices are snapshotted as the number they resolve to at that
  moment.
- The same service can be on an estimate at several units (1 full day + 2 hrs). Each is its own
  line.
- **Switching a line's unit** on the line re-snapshots price and hours from the card at the new
  unit, keeps the quantity, and recalculates. If "Use rates from last project" is on and that client
  was quoted that service at that unit, the last-project price is used instead, as the toggle does
  today.
- An auto unit with no price (floor unset) is disabled in both selects, labelled "no price yet".
- "Use rates from last project" and "Update to current rates" match by **row id + unit**, then
  name + unit.
- The quantity column reads "Qty" in every labour category (every service now has units). Each line
  says what its quantity counts in its second line, as day rows do today.

### 6. Data and migration rules (the IA/tasks step picks the exact shape)

- Every labour service stores a price state for `hour`, `half`, `full`: either auto (no stored
  figure, derived on read through the one calc.js function) or set-by-you (a stored figure).
- **Migration, schema-versioned, one-off.** Each existing row becomes a service. Its current `mu`
  becomes set-by-you in the slot matching its `dayUnit` (none → hour). The other two slots start
  auto. The row's `id`, name, category and `customBill` carry over. Nothing is merged by name: the
  user folds "Video Capture — Full Day" into "Video Capture" by hand (type the price, delete the
  old row).
- A day row whose own `hoursPerUnit` differs from the new card-level Service Day loses that
  per-row figure. Its price is set-by-you, so it doesn't move. List any such rows in the migration
  log and the handover.
- `DEFAULT_PRICING` is reshaped: the three Video Capture rows collapse into one service with its
  $140 / $640 / $1,120 set-by-you. Every other default row keeps its price as set-by-you hourly,
  with half and full day on auto.
- The inert per-row `rate` stays untouched, as today.
- The existing guard, "switching a row between hourly and day asks first when saved estimates use
  it", is retired: the dropdown no longer changes what a row is.

## Responsive Behavior

- **≥ 1100px**: identical to today apart from the new states. There are no new columns: the unit
  dropdown swaps the row's content in place, so name truncation is unchanged.
- **768–1099px**: as today. The Service Day setting wraps under the tax setting if needed.
- **< 768px**: rows stack as today (`data-label`s). The unit select and hidden-unit notice sit
  under the service name. The price state line stays under the price. The estimator's `.bb-picker`
  stacks as Service / Unit / Add, full width, and every field keeps the site-wide 16px rule from
  `responsive.css`. Selects and the ↺ link keep a 44px target.

## Accessibility Requirements

- Contrast as the rest of the Rate Card: state lines in `--muted` must meet 4.5:1 at their size, or
  use the existing `a11y.css` adjustments. Below-floor stays `--accent-text`.
- The unit select has a name ("Unit shown for Video Capture"), and its options carry the problem
  text ("full day, below floor by $12.40") so a screen reader user hears it without switching.
- The price field's accessible name includes the unit, and `aria-describedby` points at its state
  line, so "auto" or "set by you, suggested $451" is read on focus. Changing units updates both.
- `↺ use $451` is a real `<button>`: "Use the suggested price, $451, for Video Capture full day".
  After activating it, focus returns to the price field.
- An auto price changing as you type in Service Day is announced once, politely, through a single
  live region ("Auto prices updated for 8-hour full day"), not once per row.
- Estimator: the unit select is labelled "Unit to add for Pre-Production". A disabled option says
  why. Switching a line's unit announces the new price in the editor's existing announce region.
- Everything works with keyboard alone. No hover-only information: this repo's rule is a button +
  popover, never `title`.

## Resolved Decisions

Decided with the user on 2026-09-28. Don't re-litigate.

1. **Every labour service has hourly, half-day and full-day prices, always.** Travel &
   Accommodation stays single-price (it's a cost of goods sold, not time).
2. **A price auto-fills as floor × (1 + Target Markup)** and follows the numbers until you type over
   it. A typed price is kept, with a way back to auto.
   *Overturns* the price-calculator rule "nothing ever auto-writes the rate card / `mu` is never
   written". Auto prices are derived on read, but they do move the card's prices without a save.
   Saved estimates are still protected by line snapshots.
3. **Auto prices round up to the whole dollar, each unit on its own.**
4. **Service-day hours are one card-level setting, full 8 / half 4**, separate from Capacity.
   *Overturns* the 2026-09-27 day-row rule that prefilled `hoursPerUnit` from Capacity's billable
   hours per day. Also *reverses* the Dashboard's decision 1: headline half/full-day floors now use
   Service Day hours.
5. **Price-calculator decision 3 is reshaped, not reverted.** A half day still has its own price,
   never a 0.5 multiplier on a *typed* full-day price. It now lives on the same service instead of
   a separate row. An auto half day is half an auto full day by construction, which the user
   accepts.
6. **The Rate Card row is one line per service**, with the `per [unit ▾]` dropdown switching which
   unit it shows. Three price columns and stacked sub-rows were both considered and not chosen.
7. **Estimator: service → unit → Add**, and a line's unit can be switched later.
8. **Existing rows are merged by hand**, not by name-matching. Live DB had 0 saved estimates as of
   2026-09-28.
9. **The client PDF lists labour by service name only**, as today. It was offered name + unit and
   declined. Accepted consequence: the same service at two units prints as two identical names.

Added during the IA step (2026-09-28). The detail is in
[`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md):

10. **The Dashboard's comparison table is one row per service** with Hourly / Half day / Full day
    cells, each showing its price plus a "Below by $X" badge or an "auto" tag.
11. **The estimator's unit picker starts on Hour every time.** It does not remember the last unit.
12. **The Rate Card gets a card-wide "Show: Hourly / Half day / Full day" switch** that sets every
    row's dropdown at once. It is view-only and resets to Hourly.

## Out of Scope

- Auto-pricing Travel & Accommodation (cost × markup on resold items). Considered and not chosen.
- A per-estimate markup % field. Target Markup still comes from Profit Goals, and the advisory
  Minimum Job Price is unchanged.
- Renaming the "Mark-Up ($)" column (it is the client price). Not requested; leave the label.
- Per-service day lengths (e.g. a 6-hour drone day). The Service Day setting is card-wide.
- Units other than hour / half day / full day (week, per deliverable, per item).
- Any change to the client PDF, estimate detail's printed figures, or invoice numbering.
- Automatically merging existing "X — Full Day" / "X — Half Day" rows.
- Changing how the income floor, Target Revenue, capacity or Target Markup are calculated.
