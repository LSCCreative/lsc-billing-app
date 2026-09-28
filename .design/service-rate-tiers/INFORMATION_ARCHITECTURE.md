# Information Architecture: Service Rate Tiers

Companion to [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md). Extends
[`.design/price-calculator/INFORMATION_ARCHITECTURE.md`](../price-calculator/INFORMATION_ARCHITECTURE.md);
everything there stands unless this document names it.

## Structural constraint discovered before designing anything

**Totals are already priced per line, not per rate-card row.** Since the 2026-09-28 money-math
audit, every estimate line carries a snapshot (`mu`, `rowId`, `hoursPerUnit`, `dayUnit`, …) and
`calc.js` `lineDef()` prices a line from that snapshot before it ever looks at the card.
`computeTotals`, `minimumJobPrice`, the hours breakdown, the PDF and the estimate detail all read
lines, not rows.

So the whole feature reduces to one question: **what snapshot does a line get when it is added at a
unit?** Answer: the snapshot a flat day row would have produced (`mu`, `hoursPerUnit`, and `dayUnit`
for a day unit). Everything downstream of the snapshot is untouched. The change is confined to:

1. the rate card's stored shape (and its one writer, the Rate Card screen),
2. one new resolver in `calc.js` that turns *(service, unit)* into a flat def,
3. the three screens that read the card directly: Rate Card, estimate editor picker, Dashboard.

The second constraint: **`PUT /api/pricing` writes the card as one whole document.** A browser still
running the previous web build (a cached Pages copy, a tab left open over the deploy) would read the
new shape, fail to understand it, and write the old shape back over it. The server must refuse
the old shape outright (see "Migration and deploy").

## View Map

No new views. No view removed. Changes are inside three existing screens:

- Estimates
  - Estimate editor: **modified** (unit picker in each labour `.bb-picker`, a unit switch on each labour line)
  - Estimate detail: unchanged (reads line snapshots)
- Finance & Price (left rail)
  - Dashboard: **modified** (headline day floors from Service Day; comparison table one row per service × three units)
  - Rate Card: **modified** (Service Day setting, "Show" switch, per-row unit dropdown as a view switch, auto / set-by-you prices)
  - Overhead / Capacity / Profit Goals: unchanged (their outputs now also feed auto prices)
- Client PDF: unchanged (service name only, the user's call)

## Navigation Model

- **Primary / secondary / utility / mobile navigation**: unchanged. The Finance & Price rail keeps
  its five items.
- **Contextual links (new or changed)**:
  - Rate Card → an auto price reading `—` links "needs Profit Goals" → `selectTab('goals')`.
  - Rate Card → the hidden-unit notice ("Full day below floor by $12.40 ▸") switches that row's
    dropdown in place. It never leaves the screen.
  - Dashboard → a "Below by $X" badge → `selectTab('pricing', { focusRow: { sectionId, index, unit } })`.
    `focusRow` gains `unit`: the Rate Card sets that row's dropdown to it, then focuses the price.
  - Estimator → a disabled "no price yet" unit option has no link (it sits inside a `<select>`). The
    reason is in the option text.
- **In-screen view state (not navigation, never saved, never "unsaved changes")**:
  - Rate Card "Show: Hourly / Half day / Full day": sets every row's dropdown at once. Resets to
    Hourly on mount.
  - Per-row `per [unit ▾]`: overrides the Show switch for that row. Once any row differs from the
    others, no Show button is pressed.
  - Estimator unit picker: starts on **Hour every time** a service is chosen (decided).

## The Read / Write Map

One writer per stored number, the same rule as price-calculator.

| Stored value | Written by (only) | Read by |
| --- | --- | --- |
| `pricing.serviceDay.fullHours / halfHours` | Rate Card (Service Day setting) | `calc.unitDef` → Rate Card, estimator picker, Dashboard (headline day floors + table) |
| `row.prices.hour / half / full` (number = set by you, `null` = auto) | Rate Card: typing sets a number; `↺ use` or clearing sets `null` | `calc.unitDef` only. No screen reads `prices` directly. |
| `goals.target_profit_margin_pct` (Target Markup) | Profit Goals | Minimum Job Price (as today), **and now** `calc.suggestedPrice` via `LSCData.priceContext()` |
| Income floor per hour | nobody (derived: `LSCData.incomeFloor()`) | `suggestedPrice`, the floor lines, the Dashboard |
| `goals.billable_hours_per_day` (Capacity) | Capacity | annual billable hours **only**. No longer read by the Rate Card's day hours or the Dashboard's headline day floors. |
| Line snapshot `{ mu, rowId, hoursPerUnit, dayUnit?, customBill? }` | Estimator: on Add, on unit switch, on "Update to current rates", on "Use rates from last project" | `lineDef` → everything that prices a line (unchanged) |
| `row.rate` (labour) | nothing (inert since 2026-09-21) | nothing. Carried through saves untouched. |

**Nothing writes a resolved auto price anywhere on the card.** An auto price exists only as the
return value of `unitDef`. It becomes a stored number in exactly one place: a line's snapshot, at
the moment the line is added or re-priced.

## The Rate Card data shape

```js
pricing = {
  serviceDay: { fullHours: 8, halfHours: 4 },          // NEW, card-level
  labourSections: [{
    id, label,
    rows: [{
      id, name,
      prices: { hour: 140, half: null, full: 1120 },   // NEW: number = set by you, null = auto
      customBill,                                      // unchanged, applies to every unit
      rate,                                            // unchanged, inert
      // REMOVED from labour rows: mu, hoursPerUnit, dayUnit
    }],
  }],
  travelRows: [ /* unchanged: { id, name, rate, mu, directCost, ownTime, unit } */ ],
  taxSetAsideRate,                                     // unchanged
}
```

- **Units are a fixed vocabulary**: `hour`, `half`, `full`. The dropdown order is Hourly, Half day,
  Full day. `hour` is 1 hr by definition, and is not configurable.
- **Validation (`PUT /api/pricing`)**: `serviceDay` is required. Each field is 0.5–24 in 0.5 steps,
  and `halfHours ≤ fullHours`. Every labour row needs a `prices` object with all three keys, each a
  number ≥ 0 or `null`. A labour row carrying `mu`, `hoursPerUnit` or `dayUnit`, or missing
  `prices`, is refused with `pricing_shape_outdated` (see Migration). Travel validation is unchanged.
- **`$0` is a price, not auto.** Typing 0 pins 0 (it will badge below floor). Only an empty field or
  `↺` returns a unit to auto.

## The Arithmetic

All of it lives in `calc.js`, applied identically to `server/src/calc.js` and `web/js/calc.js`
(the drift test enforces this).

### 1. Hours in a unit

```
unitHours(pricing, 'hour') = 1
unitHours(pricing, 'half') = serviceDay.halfHours
unitHours(pricing, 'full') = serviceDay.fullHours
```

An unusable stored value (missing, 0, above 24, non-numeric) falls back to 8 / 4. This follows
`hoursPerUnitOf`'s rule that an hours figure is never `null`. The Rate Card blocks saving such a
value, so the fallback only covers a hand-edited or partially migrated card.

### 2. Suggested (auto) price

```
suggestedPrice(floorPerHour, hours, markupPct, settings) → number | null

  null when floorPerHour is null or ≤ 0, or markupPct is null, blank or negative
  target = floorPerHour × hours × (1 + markupPct / 100) − 1e-8     // exact; the 1e-8 absorbs float noise
  GST-exclusive card: price = Math.ceil(target)
  GST-inclusive card (registered && pricesIncludeGst):
          price = the least whole dollar p with p ÷ (1 + gst.rate) ≥ target
```

- *Revised 2026-09-28 (brief decision 13):* `unitDef` calls this for the **hour only**. An auto
  day is the hourly × its hours (§3). So the target is exact rather than cent-rounded: a
  cent-rounded target let an hourly land a fraction of a cent under the floor, which a day
  multiplies into a whole cent under.

- *As built (task 1, superseded by the exact target above):* the inclusive case is a search against `priceExGst`, not
  `ceil(raw × 1.1)`. The multiply-then-round recipe first written here lands 1¢ under the floor at
  some half-cent edges (0% markup; a sweep found ~130), so an auto price could badge below its own
  floor. The two differ by +$1 where they differ at all. See SERVICE UNITS decision 3 in `calc.js`.

- ~~Each unit is computed from its own hours and rounded on its own.~~ Reversed by brief
  decision 13: an auto full day is exactly 8 × the hourly.
- A Target Markup of 0 is valid: the auto price is the floor rounded up. Only *unset* markup gives
  `null`.
- The GST step mirrors `priceExGst` in reverse, so an auto price on a GST-inclusive card compares
  equal to or above its floor after `labourFloorComparison` takes GST back out.
- **Pin with tests**: $45.05 × 1 × 1.25 = 56.3125 → $57; an exact $57.00 input stays $57; markup 0;
  markup null → null; floor null → null; GST-inclusive; an auto day = hourly × hours; no auto
  unit below its floor over unrounded floors.

### 3. Resolving a service at a unit

```
unitDef(row, unit, pricing, ctx) → flat def | null
  ctx = { floorPerHour, markupPct, settings }       // LSCData.priceContext() in the browser

  hours  = unitHours(pricing, unit)
  stored = row.prices[unit]
  auto   = stored === null || stored === undefined
  hourly = row.prices.hour ?? suggestedPrice(ctx.floorPerHour, 1, ctx.markupPct, ctx.settings)
  mu     = !auto ? stored
         : hourly === null ? null
         : unit === 'hour' ? hourly
         : round2(hourly × hours)              // brief decision 13: a day follows the hourly
  return { id: row.id, name: row.name, mu, auto, rate: row.rate, customBill: row.customBill,
           hoursPerUnit: hours, dayUnit: unit === 'hour' ? undefined : unit }
```

- The return value is **exactly the flat row shape existing code already understands**, so
  `lineSnapshot(def)` is unchanged, and so is everything that prices a snapshot.
- `mu: null` means "no price available" (an auto hour with no floor, or an auto day on one). Callers must treat it as unavailable,
  never as $0: the estimator disables the unit, and the Rate Card shows `—`.
- An hourly snapshot carries `hoursPerUnit: 1` and no `dayUnit`, as an hourly row's did.

### 4. Floors and the comparison

- A unit's floor = `floorPerHour × unitHours`. This is what `labourFloorComparison` did per row;
  now it runs per service × unit.
- `labourFloorComparison(pricing, settings, floorPerHour, ctx)` returns **one entry per service**:
  `{ sectionId, sectionLabel, rowIndex, name, units: { hour, half, full } }`, each unit
  `{ mu, muExGst, auto, hoursPerUnit, floor, gap, belowFloor }`. It uses the same rules as today:
  GST out of an inclusive price, exactly-at-floor is not below, travel excluded.
- An auto unit is compared like any other. By construction it can't be below floor (it's rounded
  up and the markup is ≥ 0), and a test pins that.
- Dashboard headline tiles: `halfDay = floorPerHour × serviceDay.halfHours`,
  `fullDay = floorPerHour × serviceDay.fullHours`, each labelled "at N hrs". This **replaces** the
  Capacity `billableHoursPerDay` basis (brief decision 4).

### 5. Legacy lines

`lineDef`'s fallback (a line with no snapshot → live row by id, then name) now finds a row with
`prices`. The server has no `ctx` to resolve an auto price, so the fallback resolves **the stored
price for the line's own unit** (`line.dayUnit` or hour), or `null` if that unit is auto. The v9
migration snapshots every legacy line *before* reshaping the card, so the only lines that still hit
this path are ones whose service had already left the card, and those price at nothing today anyway.

## Migration and deploy (schema v9)

One `MIGRATIONS` entry in `db.js`, run inside its own transaction like every other.

1. **Snapshot legacy estimate lines first**, against the *old* card. For every estimate's
   `active_rows_json` labour and travel line without `mu`: find its row by `rowId`, then name, in
   the pre-migration card, and write `lineSnapshot(row)` onto the line. Test: every estimate's
   recomputed totals are identical before and after v9.
2. **Reshape the card** (only if a `pricing` row exists; a fresh DB uses the new `DEFAULT_PRICING`):
   - Add `serviceDay: { fullHours: 8, halfHours: 4 }`.
   - For each labour row: `prices = { hour: null, half: null, full: null }`. The slot is
     `row.dayUnit` when set. Otherwise, a row whose `hoursPerUnit` equals 8 or 4 goes to `full` /
     `half`, and any other row goes to `hour`. Then `prices[slot] = row.mu` (set by you), and
     `mu`, `hoursPerUnit` and `dayUnit` are deleted.
   - Log every row whose old `hoursPerUnit` doesn't match its new slot's hours ("Drone Day: was 6
     hrs, now 8. Price kept"), to the boot log and into the handover after the NAS run.
3. **Nothing is merged by name.** "Video Capture — Full Day" becomes a service with a set-by-you
   full-day price and auto hourly / half day. The user folds it into "Video Capture" by hand.

**Deploy order: NAS before Pages.** Old web build + new server: the old Rate Card reads rows with no
`mu` and would save them back, but `PUT` refuses the old shape with `pricing_shape_outdated`, so
nothing is lost; the error tells the user to reload. New web build + old server is the dangerous
direction and must not happen. Back up `billing.db` before the NAS run, as for v7 and v8.

## Content Hierarchy

### Rate Card

1. **Page head**: "Rate Card", unchanged sub-line.
2. **Rate note**: the overhead-rate explanation as today, plus one sentence: auto prices are your
   floor plus Target Markup, rounded up to the dollar, and they follow your numbers until you type
   your own.
3. **Settings strip**: Tax Set-Aside Rate (existing), then **Service day** (Full `[8]` hrs · Half
   `[4]` hrs, info control), then **Show: Hourly | Half day | Full day**. The Show switch sits last,
   directly above the tables it controls.
4. **Labour categories**, in card order. Each row:
   - Service name (input)
     - `per [unit ▾]` and, for a day unit, `· 8 billable hrs` as text (no longer an input)
     - Hidden-unit notice, only when another unit is below floor or has no price
   - Rate (read-only): overhead × unit hours, with unit suffix
   - Mark-Up ($) (the price) with its state line beneath: `auto · floor $X`, or
     `set by you · ↺ use $X`, or `below floor by $X`, or `— · needs Profit Goals`
   - Custom, delete (unchanged)
5. **Travel & Accommodation**: unchanged.

### Estimate editor: a labour category

1. Category head + subtotal (unchanged)
2. **Picker**: `[Service ▾] [Unit ▾] [+ Add Service]`. The unit options read "Hour · $140",
   "Half day · $640", "Full day · $1,120", with "Full day · no price yet" disabled when applicable.
3. Column heads: Service / **Qty** (always "Qty" now: every service has units) / Mark-Up / Client
   Bill
4. Lines: name, then a second line `per [full day ▾] · 8 billable hrs` (a select), qty, price,
   bill, remove.

### Dashboard: "Rate card against its floors"

1. Headline floors: hourly / half day / full day tiles, day tiles "at N hrs" **from Service Day**.
2. Comparison table: **one row per service**, columns Service | Hourly | Half day | Full day. Each
   cell shows the price plus either a `Below by $X` badge (a button → Rate Card, that row, that unit)
   or an `auto` tag. Categories are grouped as today.
3. Everything below is unchanged.

## User Flows

### Pricing a new service

1. Rate Card → `+ Add Service` in a category → a new row, name focused.
2. All three units start **auto**. The price shows the suggestion, e.g. `57.00`, with
   `auto · floor $45.05`.
   - If the floor is unknown → `—` / `needs Profit Goals` link. The row can still be saved, and the
     user can type prices.
3. User types a name → Save. Done: the service sells at all three units on auto.
4. Optional: `Show: Full day` → review every full-day price → type `1200` over one → that unit is
   now `set by you · ↺ use $451`.

### Folding old day rows into one service (one-off, after v9)

1. Rate Card → "Video Capture — Full Day" (full day set by you, $1,120).
2. On "Video Capture": dropdown → Full day → type `1120`. Half day → type `640`.
3. Delete the two old rows (the existing delete warning appears if saved estimates use them; their
   lines keep their snapshots, so billed figures don't move) → Save.

### Quoting a shoot

1. Estimator → Production → Service: Video Capture → Unit: Full day · $1,120 → `+ Add Service`.
2. Line added: `per [full day ▾] · 8 billable hrs`, Qty 1. Total Hours +8, bill $1,120.
3. The job shrinks → the line's unit select → Half day → the line re-snapshots at $640 / 4 hrs, the
   qty stays 1, and totals recalculate. It is announced in the editor's live region.
   - If "Use rates from last project" is on and this client was quoted Video Capture at half day
     → the last-project half-day price is used instead.
   - If the half day is auto with no price yet → that option is disabled and the line stays as it
     was.
4. Overtime → Service: Video Capture → Unit: Hour → Add → Qty 2. The same service now has two
   lines, at two units.

### Goals change after quotes exist

1. User raises Desired Net Income on Profit Goals → the income floor rises.
2. Rate Card (next mount): every auto price has risen. Set-by-you prices haven't, but their
   `↺ use $X` has moved and their floor lines may now badge.
3. Saved estimates: unchanged. The user can press "Update to current rates" on a draft to re-price
   it at today's figures, **per line at the line's own unit**.

## Naming Conventions

| Concept | Label in UI | Notes |
| --- | --- | --- |
| The three ways a service is sold | **Hourly**, **Half day**, **Full day** (select options and Show switch); **per hour / per half day / per full day** (inline line text) | Stored as `hour` / `half` / `full`. Never "tier" in the UI; "tier" is only this folder's name. |
| Card-level day length | **Service day** | Distinguishes it from Capacity's "billable hours per day". The info text states the difference. |
| A price that follows the numbers | **auto** | Lower-case tag in the state line. |
| A price the user typed | **set by you** | Not "manual", "custom" or "override": **Custom** already means `customBill`. |
| Going back to auto | **↺ use $X** | Button. Its accessible name spells it out ("Use the suggested price, $451, for Video Capture full day"). |
| The auto figure when shown against a typed one | the `$X` in `↺ use $X` | Not given a noun on screen. In docs and code it is the "suggested price". |
| The price column | **Mark-Up ($)** (unchanged) | It is the client price. The rename is explicitly out of scope. |
| The profit target applied | **Target Markup** | From Profit Goals. Never "margin" in new copy (DB column `target_profit_margin_pct` keeps its name). |
| No price available | **no price yet** (estimator), **needs Profit Goals** (Rate Card) | Never `$0`. |

## Component Reuse Map

| Component | Used on | Behavior differences |
| --- | --- | --- |
| `calc.unitDef` / `suggestedPrice` / `unitHours` | Rate Card, estimator picker + line switch, Dashboard, v9 migration (`unitHours` only) | None. Single implementation, both calc.js copies. |
| `LSCData.priceContext()` (new, `data.js`) | Rate Card, estimator, Dashboard | Rate Card passes its **working copy's** `serviceDay` (live as you type); others pass the saved card. |
| `.pricing-unit-sel` (`per [unit ▾]`) | Rate Card rows | Now a view switch, not a row property. |
| Unit `<select>` (new, same styling as `.svc-select`) | Estimator picker, estimator line | Picker: options carry prices and start on Hour. Line: options carry prices and start on the line's unit. |
| `.pricing-floor` state line | Rate Card price cells | Gains the auto / set-by-you / needs-goals states beside `floor` / `below floor`. |
| Segmented "Show" control | Rate Card only | New. Buttons with `aria-pressed`, styled as `.btn-ghost.btn-sm`. |
| `LSCInfo.markup` | Service Day setting | Reused as is. |
| `labourFloorComparison` | Dashboard table, Rate Card state lines, hidden-unit notice | Now per service × unit. The Rate Card calls it on a one-row card as today. |
| `LSCRows.labourUnit` / `unitWord` / `qtyLabel` | Estimator lines, estimate detail | Unchanged: they read snapshots. `sectionHasUnits` becomes "always true" for any non-empty category and can be retired. |

## Content Growth Plan

- **Services grow; units don't.** The unit vocabulary is closed at three (brief: out of scope to
  add more). Every screen is laid out for exactly three, so adding a fourth would be a redesign, not
  a config change. Don't make it data-driven.
- The Rate Card stays one row per service, however many services there are. That's the reason for
  the dropdown over three columns. The Show switch is what keeps whole-card review cheap as the
  card grows.
- The Dashboard table grows by one row per service (not three).
- Estimate lines can grow by up to three per service (one per unit). No change to the editor's
  list pattern.

## URL Strategy

No URL changes. The app routes screens in-page (`FinanceView.selectTab(id, opts)`), not by URL, and
nothing here adds a deep link beyond `focusRow`'s new `unit` key. Unit and Show selections are view
state and deliberately not reflected in any URL or storage.
