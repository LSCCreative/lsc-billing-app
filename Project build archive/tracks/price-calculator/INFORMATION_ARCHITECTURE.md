# Information Architecture: Finance & Price

Companion to [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md). Where the brief says *what* and *why*, this says
*where each number lives, who may write it, and in what order the arithmetic runs*.

Written 2026-09-27 (Phase 3). The accounting decisions in here were delegated to the agent —
"whatever you think is best for optimal finance and accounting accuracy" — so every one of them is
stated with its reasoning rather than left implicit, and the ones a fresh agent is most likely to
"simplify" are flagged as such.

## Structural constraint discovered before designing anything

**This app has no URL router.** Not React Router, not hash routing, not `history.pushState` —
nothing. `web/js/app.js` swaps screens by calling `SomeView.mount(main, handlers)` and toggling an
`.active` class on header buttons. `finance.js` does the same one level down, and already exposes
`onGoTab(id)` to its children so the Pricing screen's inline links can open Overhead or Goals.

So there are no URLs to design. What follows maps **view states**, and `onGoTab` is the existing
mechanism the Dashboard's deep links will use — not a new one to invent. See
[URL Strategy](#url-strategy) for why this is deliberately not the change that introduces routing.

## View Map

Router state ids, as they will exist in `finance.js`'s `TABS` array. Indentation is nesting.

- **Estimates** — `app.js` top level (unchanged)
- **Clients** — `app.js` top level (unchanged)
- **Finance & Price** — `app.js` → `FinanceView.mount()`, sidebar rail below
  - **Dashboard** `dashboard` ← **new landing tab**
  - **Rate Card** `pricing` (existing `PricingView`, unmoved)
  - **Overhead** `overhead` (existing `OverheadView`)
    - Operating Costs `overhead` *(default inner tab — the existing expense register)*
    - Depreciation `overhead/depreciation` *(new inner tab: asset register + schedule)*
  - **Capacity** `capacity` ← new
  - **Profit Goals** `goals` (existing `GoalsView`)
- **Invoice Settings** — modal over whatever is mounted (unchanged)

**One nesting level inside Overhead, and only there.** Depreciation is a *view of the same question*
Overhead answers — "what does this business cost to run per year?" — so it belongs inside it rather
than as a sixth rail item. Six items would also push the rail past the point where it reads as a
short list. Nothing else in this area nests; two levels is the ceiling.

**Landing tab changes from Rate Card to Dashboard.** `finance.js`'s current comment says the header's
Finance item passes no `initialTab` and lands on Pricing so nobody's muscle memory breaks. That
reasoning was written when Pricing was the only built screen. The Dashboard is now the screen that
answers "is my pricing right?", which is the question the area exists for, so it becomes
`TABS[0]` and the fallback for an unknown `initialTab`.

## Navigation Model

- **Primary navigation** — the existing header: `Estimates` · `Clients` · `Finance & Price` ·
  `Invoice Settings` · `Sign Out`. Four items plus utility. Unchanged in count; one label renamed.
- **Secondary navigation** — the **left sidebar rail** inside Finance & Price: five items, replacing
  `.finance-tabs`'s horizontal row. `<nav aria-label="Finance sections">` containing real
  `<button>`s with `.nav-link`, `aria-current="page"` on the active one. **Not `role="tablist"`** —
  `finance.js`'s header already documents why (ARIA tabs promise roving-tabindex arrow navigation
  that isn't implemented; these are nav links that replace a screen). That decision stands.
- **Tertiary navigation** — the Overhead inner tabs (`Operating Costs` / `Depreciation`), rendered as
  a horizontal `.nav-link` row inside the Overhead screen. Reusing the pattern the rail just vacated
  keeps the vocabulary to one idea: a row of tracked uppercase links whose active item carries an
  accent underline.
- **Utility navigation** — none new. The FY selector and CSV download are page controls inside
  Depreciation, not navigation.
- **Mobile navigation (<768px)** — the rail reverts to the horizontal `.finance-tabs` row it
  replaced, above the child screen, horizontally scrollable, 44px touch targets. The Overhead inner
  tabs sit below it as a second row; two stacked rows of two and five short items is legible where a
  collapsed rail-as-hamburger would hide the whole structure behind a tap.
- **Deep links** — every Dashboard figure links to the screen that owns it via the existing
  `onGoTab`. Depreciation is reached as `onGoTab('overhead', { inner: 'depreciation' })`, which means
  `finance.js`'s `selectTab` gains an optional second argument it forwards to the child's `mount`.
  That is the one router-contract change this feature makes.

## The Read / Write Map

This is the table that makes "one number, one truth" checkable instead of aspirational. **Every
stored number in the area, exactly one writer.**

| Number | Stored at | Written by | Read by |
| --- | --- | --- | --- |
| Operating expense items | `overhead_items` rows | Overhead → Operating Costs | Dashboard, `annualOperatingTotal()` |
| Capital assets | `depreciation_assets` rows (**new**) | Overhead → Depreciation | Dashboard, `replacementReserveTotal()`, schedule, CSV |
| Overhead audit trail | `overhead_snapshots` rows | append-only, on any overhead **or asset** write | Overhead trend chart |
| Locked FY figures | `depreciation_locks` rows (**new**, append-only) | Depreciation → "Mark FY as lodged" | Schedule (shows locked vs live) |
| Billable hrs / day | `goals.billable_hours_per_day` (**new**) | Capacity | `annualBillableHours()`, Rate Card day-row prefill |
| Working days / week | `goals.working_days_per_week` (**new**) | Capacity | `annualBillableHours()` |
| Leave + public holidays | `goals.leave_days_per_year` (**new**) | Capacity | `annualBillableHours()` |
| Sick + misc days | `goals.sick_days_per_year` (**new**) | Capacity | `annualBillableHours()` |
| Desired net income | `goals.desired_net_income` | Profit Goals | `targetAnnualRevenue()`, Dashboard |
| Target profit margin % | `goals.target_profit_margin_pct` | Profit Goals | `minimumJobPrice()`, floors, Dashboard |
| Tax reserve rate | `pricing.taxSetAsideRate` | Profit Goals **or** Rate Card (same field, existing mirror) | `computeTotals()`, `targetAnnualRevenue()` |
| GST registration / rate / inclusive | `settings.gst` | Invoice Settings **or** Finance & Price mirror (**new**) | `computeTotals()`, depreciation cost base |
| Rate card rows, `mu`, `rate`, `hoursPerUnit` | `pricing.labourSections` | Rate Card | `computeTotals()`, floor comparison |
| ATO write-off threshold, effective lives | `depreciation_assets` per row + `goals.iawo_threshold` (**new**) | Depreciation | schedule only |

**Derived, never stored:** annual billable hours, overhead rate/hr, the hourly / half-day / full-day
floors, target annual revenue, jobs-needed-per-year, every depreciation schedule figure, the
replacement reserve. If a number can be computed from the table above it is computed on read, so it
cannot drift from its inputs.

**The one legacy exception.** `goals.billable_capacity_hrs_per_week` is **kept, recomputed on every
Capacity save as `annualBillableHours ÷ 52`, and read by nothing.** Keeping it avoids a SQLite table
rebuild and a migration that would have to invent leave and sick values it cannot infer from a single
weekly number. Its schema comment must say *legacy, display-only, superseded by the four capacity
columns, safe to drop in a later migration*. A fresh agent finding an unread column will otherwise
either delete it mid-feature or start computing from it again.

## The Arithmetic Order — where accounting accuracy actually lives

Order of operations, stated because getting it wrong produces plausible-looking wrong numbers rather
than errors.

### 1. Capacity

```
workingDaysPerYear   = working_days_per_week × 52
billableDaysPerYear  = workingDaysPerYear − leave_days_per_year − sick_days_per_year
annualBillableHours  = billableDaysPerYear × billable_hours_per_day
```

Validation: `working_days_per_week` 1–7; `billable_hours_per_day` 0–24; **`leave + sick` must be less
than `workingDaysPerYear`**, or `annualBillableHours` goes zero or negative and every rate derived
from it becomes nonsense. Leave and sick are entered in **working days, not calendar days** — the
field labels must say so, because "4 weeks leave" is 20 working days, not 28, and the difference is
8 days of capacity.

`WEEKS_PER_YEAR = 48` is retired. `overheadRatePerHour()` changes its second parameter from
*hours per week* to *annual billable hours* — a semantic change to an existing signature, so all
four call sites move together and a test pins the new meaning.

### 2. Annual cost of the business

```
annualOperatingTotal  = Σ overhead_items (existing annualOverheadTotal, unchanged)
replacementReserve    = Σ over assets, where not disposed:
                          (replacement_cost_estimate ÷ replacement_cycle_years) × business_use_pct
annualBusinessCost    = annualOperatingTotal + replacementReserve
```

Three decisions in that second line:

- **`replacement_cost_estimate`, not historical cost.** Pricing must recover what the *next* body
  costs, not what the last one did. Gear that has got more expensive would otherwise be under-priced
  for its whole life.
- **Straight-line over the user's own cycle, not the ATO effective life.** Diminishing value would
  swing the day rate 30–40% year to year for gear still in daily use. This is the brief's decision 8.
- **Apportioned by `business_use_pct`.** Only the business share of a part-personal laptop is a
  business cost. The same percentage is applied here and in the tax calculation, but at different
  points in their respective chains — see below.

`annualOverheadTotal()` keeps its current name and behaviour so existing tests keep passing; a new
`annualBusinessCost(items, assets)` is what every screen moves to.

### 3. Rates and floors

```
overheadRatePerHour = annualBusinessCost ÷ annualBillableHours
hourlyFloor         = overheadRatePerHour × (1 + target_profit_margin_pct ÷ 100)
fullDayFloor        = hourlyFloor × (Full Day row's hoursPerUnit)
halfDayFloor        = hourlyFloor × (Half Day row's hoursPerUnit)
targetAnnualRevenue = (annualBusinessCost + desired_net_income) ÷ (1 − taxSetAsideRate)
jobsNeededPerYear   = targetAnnualRevenue ÷ (average clientPriceExGst of estimates, last 12 months)
```

All GST-exclusive. Floors **exclude pass-through costs entirely** — crew, hire, travel, flights,
accommodation are added at cost on top, per the brief's decision 6. The comparison is against each
row's **`mu`**, not `rate`.

`null` propagates: no capacity, no cost, or no margin set yields `null`, which renders as an em dash
plus a set-up prompt — never `$0.00`. Existing convention, non-negotiable.

### 4. Depreciation — the ATO chain

Runs per asset, per financial year. **Order matters and step 4 is the one people get wrong.**

```
1. costBase   = cost_inc_gst − (gst_credit_claimed ? gst_amount : 0)
2. costBase   = min(costBase, car_limit)              // vehicles only, user-entered limit
3. decline    = method-specific, pro-rata by days held:
     diminishing_value : base_value × (daysHeld ÷ 365) × (200% ÷ effective_life_years)
     prime_cost        : costBase   × (daysHeld ÷ 365) × (100% ÷ effective_life_years)
     instant_writeoff  : costBase                       // full amount, first FY only
     small_business_pool : pool-level, 15% first FY then 30%
     low_value_pool      : pool-level, 18.75% first FY then 37.5%
4. deductible      = decline × business_use_pct        // apportion the DEDUCTION
5. adjustableValue = adjustableValue − decline         // reduce by the FULL decline
```

- **Step 4 vs step 5 is the subtlety.** The deduction is apportioned for business use; the asset's
  adjustable value is **not** — it declines by the full amount regardless. Apportioning both is the
  common error and it overstates the closing value of every part-personal asset for the rest of its
  life.
- **`daysHeld` runs from `start_date`, not `purchase_date`.** ATO "start time" is when the asset was
  first used or installed ready for use. A camera bought in June and first used in July belongs to the
  next financial year. Two separate date fields, both required.
- **`÷ 365` even in a leap year** — that is the published formula, and matching the ATO matters more
  than matching the calendar.
- **`200%` applies to assets held from 10 May 2006.** Everything this business owns qualifies; the
  factor is a named constant with that date in its comment so nobody "corrects" it to 150%.
- **Disposal:** `daysHeld` ends at `disposal_date`.
  `balancingAdjustment = (disposal_proceeds − adjustableValue) × business_use_pct` — positive is
  assessable income, negative is a deduction. It belongs to the FY of disposal.
- **Pools are pool-level, not asset-level.** A pooled asset contributes its cost base to a pool
  balance; the schedule renders pool rows beside individual asset rows rather than pretending each
  pooled asset has its own decline figure.
- **Precision:** cents throughout via the existing `round2`. The ATO permits whole dollars on a
  return; the app does not pre-round, because rounding twice is how totals stop reconciling.

### 5. Australian financial year

**1 July – 30 June, everywhere.** Labelled `FY 2025–26`. The FY selector, every schedule row, every
pro-rata `daysHeld` boundary and the CSV filename use it. A fresh agent reaching for
`new Date().getFullYear()` will be off by up to twelve months for half the year — the FY helper is a
single shared function, and nothing computes a year inline.

### 6. Double-counting: the one place this design can silently lie

A $6,000 camera entered as a `one_off` operating expense **and** as a depreciation asset is counted
twice in `annualBusinessCost`, inflating every rate. Nothing structural prevents it, so:

- **The Dashboard always shows `annualBusinessCost` split into `Operating` + `Replacement reserve`**,
  never as a single figure. A doubled camera is visible as a reserve line that doesn't match the gear.
- **The Overhead add form intercepts, softly.** A `one_off` item above the user's write-off threshold
  prompts *"This looks like a capital asset — track it in Depreciation instead?"* with a link and a
  dismiss. Non-blocking: it is a hint, not a validation rule, because the user may genuinely be
  recording a one-off that isn't gear.
- **The Depreciation register's empty state names the rule**: capital purchases belong here, running
  costs belong in Operating Costs.

### 7. Immutability: recompute from source, lock on lodgement

Schedules are **computed on read** from `depreciation_assets`, so they cannot drift from the assets
they describe. But a figure already lodged with the ATO must remain visible as lodged, and editing an
asset's effective life in 2027 would otherwise silently rewrite what was filed in 2026.

So: **"Mark FY as lodged"** writes an append-only `depreciation_locks` row capturing that year's
computed figures as a JSON snapshot. The schedule then shows the locked figures for that FY with a
badge, and flags any divergence if the live recomputation now disagrees. No update route, no delete
route — same append-only discipline as `overhead_snapshots`, and the same reasoning: it's a log, not
editable state.

## Content Hierarchy

### Dashboard
1. **The three floors — hourly, half day, full day.** The answer the screen exists to give. Money
   figures in `Delight` 700, largest type on the page.
2. **The comparison against the Rate Card**, with below-floor rows badged. Immediately under the
   floors, because a floor with nothing to compare it to is trivia.
3. **The cost-to-rate chain**: annual business cost (split Operating / Replacement reserve) → annual
   billable hours → overhead rate/hr. Two panels side by side, mirroring the reference spreadsheet's
   costs-left / capacity-right layout.
4. **Annual targets**: target annual revenue, and the same figure per month and per week labelled as
   averages.
5. **Jobs needed per year**, with the 12-month average job value it was derived from shown beside it.
6. **The post-ratio readout** — editable ratio, derived sentence. Below the fold; it's a reality
   check, not a headline.
7. **The GST mirror** — last. It changes rarely and is currently off.

### Overhead → Depreciation
1. **Replacement reserve total and this FY's tax deduction, side by side**, with the info button
   explaining why they differ. Two numbers first, because the split is the whole concept.
2. **The asset register** — the list, add button, and per-row edit/dispose.
3. **FY selector and the schedule** for the selected year.
4. **CSV download** and the lodgement lock, at the foot of the schedule where an accountant's
   workflow ends.

### Capacity
1. **Derived annual billable hours**, live above the fields — the output people came for.
2. **The four inputs.**
3. **A warning when saving will move existing rates**, with the before/after hours.
4. **Full-day hours**, as the prefill source for the Rate Card's day rows.

## User Flows

### First run — nothing set up
1. Opens Finance & Price, lands on **Dashboard**.
2. Every floor reads an em dash with "Set up Capacity and Overhead to see this."
3. Follows the Capacity link → four fields prefilled with the reference defaults (8 / 5 / 30 / 8),
   flagged as *defaults — confirm these are yours*, because the migration cannot infer leave and sick
   days from the single weekly figure that existed before.
4. Saves → Dashboard now shows floors if overhead exists, or an Overhead prompt if not.

### Checking a day rate
1. Dashboard → reads `Full day floor $1,340` against `Video Capture — Full Day $1,120`, badged.
2. Opens the info button: the floor is measured against the marked-up price, pass-throughs excluded.
3. Clicks the badge → Rate Card, that row focused.
4. Edits `mu` and saves → returns to Dashboard, badge gone.
   - *Nothing auto-applied the floor.* The edit was a human decision, per the brief's decision 7.

### Adding a camera
1. Overhead → Depreciation → **Add asset**, modal opens.
2. Enters name, category, supplier, serial; **purchase date and start date** (separate, both
   required); cost inc GST and the GST component; ticks whether a GST credit was claimed — the form
   states that `settings.gst.registered` is currently `false`, so the full GST-inclusive cost is the
   base.
3. Chooses ATO method and effective life — placeholder shows a typical figure with *confirm with your
   accountant*.
4. Enters business-use %, replacement cycle, and estimated replacement cost.
5. Saves → asset stored, replacement reserve recomputed, `annualBusinessCost` up, **every
   overhead-derived rate on the Dashboard moves**, an `overhead_snapshots` row is appended, `Toast`
   confirms.

### Tax time
1. Overhead → Depreciation → FY selector → `FY 2025–26`.
2. Reads the schedule: opening adjustable value, decline, deductible portion, closing value per asset,
   plus pool rows and any balancing adjustments.
3. **Download CSV** → one row per asset for that FY. Hands it to the accountant.
4. Once lodged, **Mark FY as lodged** → figures frozen in `depreciation_locks`, badged as lodged,
   and any later divergence flagged rather than silently applied.

### Disposing of gear
1. Register → row → **Dispose**, enters disposal date and proceeds.
2. Asset leaves the replacement reserve immediately, so overhead stops carrying gear that's gone.
3. It stays on the disposal FY's schedule with its balancing adjustment, because that is that year's
   tax event.

## Naming Conventions

| Concept | Label in UI | Notes |
| --- | --- | --- |
| The area | **Finance & Price** | User's wording. Header nav, uppercase, fits the 11px tracked treatment |
| The rate card screen | **Rate Card** | Was "Pricing". "Price" is now the area name; the screen is the card |
| Recurring running costs | **Operating Costs** | Was "Overhead", which is now the parent. Distinguishes it from capital |
| Capital gear | **Assets** / **Depreciation** | "Asset" for the thing, "Depreciation" for the screen |
| Cost of gear, for pricing | **Replacement reserve** | Not "depreciation" — it isn't the ATO number and must never be mistaken for it |
| Cost of gear, for tax | **Decline in value** | The ATO's own term. Using it signals which number this is |
| Written-down value | **Adjustable value** | ATO term. Not "book value" |
| Sale of an asset | **Disposal** | ATO term |
| What the business costs / year | **Annual business cost** | Operating + replacement reserve. Never shown as one undivided figure |
| Cost recovery per hour | **Overhead rate / hr** | Existing label, unchanged |
| The advisory minimum | **Floor** | "Floor" for rates on the Dashboard; **Minimum Job Price** stays the estimate's existing label |
| Sellable hours in a year | **Annual billable hours** | Never just "capacity" — ambiguous between hours and jobs |
| Australian tax year | **FY 2025–26** | Always the two-year form. Never a bare year |
| Income goal | **Desired net income** | Existing label, unchanged |

## Component Reuse Map

| Component | Used on | Behaviour differences |
| --- | --- | --- |
| `FinanceView` router | the whole area | Gains a 5-item rail, a `dashboard` tab, and an optional second `selectTab` argument for inner tabs |
| `.nav-link` | header, rail, Overhead inner tabs | Vertical in the rail; identical states and focus ring |
| `.est-table` | Rate Card, Operating Costs, asset register, schedule | Schedule is read-only and wider — every new column needs a `data-label` |
| `.modal-box` + focus trap | asset add/edit, dispose | Unchanged; existing trap from `settings.js` |
| `.tax-setting` block | Profit Goals (tax), Dashboard (GST mirror) | Same pattern, different stored field |
| `.field` | Capacity, asset modal | Unchanged |
| `window.confirm()` + `Toast` | asset delete | Existing delete convention |
| `LSCUnsaved` | Capacity, Rate Card, Profit Goals | Dashboard registers no watcher — it's read-only |
| `overhead-charts.js` | Operating Costs, Depreciation | Decline curve reuses the trend chart's muted tonal ramp; accent marks the current FY |
| Info button + popover | floor comparison, depreciation split | **New shared component.** Button + `aria-expanded`, Escape closes, focus returns. Not a `title` attribute, not hover-only |

## Content Growth Plan

- **`overhead_items`** — tens of rows. Existing table handles it; no pagination needed.
- **`depreciation_assets`** — the one that grows without bound: a videography business accumulates
  bodies, lenses, drives and machines for as long as it trades, and **disposed assets are never
  deleted** because their schedule history is a tax record. So: a `Disposed` filter defaulting to
  *hidden*, sort by category then start date, and a count in the heading. No pagination until it
  exceeds ~100 rows, which is years away.
- **Depreciation schedule** — grows as assets × financial years. Bounded by the FY selector: exactly
  one year is ever rendered.
- **`depreciation_locks` / `overhead_snapshots`** — append-only, one row per lodgement and per
  overhead change. Never rendered as a list; read by the chart and the lock badge.
- **Estimate history** feeding `jobsNeededPerYear` — already paginated on the Estimates screen; the
  Dashboard reads a 12-month aggregate, not rows.

## URL Strategy

**There is none, and this feature does not introduce one.** No route files, no hash routing, no
`pushState` anywhere in `web/js/`. View state lives in module-level variables (`activeTab` in
`finance.js`) and is lost on reload, which lands the user back on the Dashboard.

Recorded as a deliberate non-decision rather than an oversight. Adding routing would mean a
whole-app change — deep links, sign-in redirects, the unsaved-changes guard interacting with browser
back — and none of it is needed for a single-operator tool where every screen is two clicks from
anywhere. **The costs of not having it**, so it can be reconsidered honestly later: the FY selector
and the Depreciation tab can't be bookmarked, and a reload during tax-time work returns to the
Dashboard rather than the schedule.

If it is ever added, `finance.js`'s `selectTab` and `mount`'s `initialTab` are already the seam —
they take a tab id from outside and validate it with `isTab()`, which is exactly what a route handler
would call.
