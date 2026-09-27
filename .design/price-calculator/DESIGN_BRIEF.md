# Design Brief: Finance & Price (Price Calculator)

**Status**: design in progress — written 2026-09-27, Phase 2 of `/design-flow`.
**Supersedes**: nothing. **Restructures**: the live Finance area from
[`.design/overhead-finance/`](../overhead-finance/DESIGN_BRIEF.md), which stays the authority for
every decision this document does not explicitly change.
**Build bucket**: `Opus, effort: high` — money math (`calc.js`, the overhead divisor, a new
depreciation schedule) plus a navigation restructure on a live site. Not the Sonnet backend bucket,
even for the route work, because the route work moves the divisor behind every rate on the card.

## Problem

Lachlan runs a one-person videography business and quotes from a rate card he inherited from the
old Electron app. The numbers on it — $140/hr for Video Capture, $63/hr for a B-roll offline edit —
were set by judgement, once, and have never been checked against what the business actually costs
to run. He cannot answer four questions that decide whether the business works:

- **"Is my day rate too low?"** He now sells shoot days and half days, not hours, but the card only
  knows hours. There is no day rate to check, let alone a floor to check it against.
- **"What does an hour of my time actually have to earn?"** The Finance area computes an Overhead
  Rate/hr, but it divides by a capacity figure annualised over a hardcoded 48 weeks. His real leave,
  public holidays and sick days are nowhere in the app, so the divisor is an assumption wearing the
  clothes of a calculation.
- **"Where does the camera money go?"** Bodies, lenses, drones, drives and a laptop are the largest
  recurring cost in a videography business and the app has no category for them. A $6,000 camera on
  a four-year cycle is $1,500/yr of real cost that his overhead rate currently says is zero.
- **"What do I tell my accountant?"** The same gear has to be depreciated under ATO rules at tax
  time, and that lives in a spreadsheet that has nothing to do with this app.

The existing screens each answer a slice of this, behind a horizontal sub-tab row that shows one
slice at a time. There is no screen where the whole picture — cost, capacity, profit target, and the
rate they imply — sits together, which is the one view that would let him see that the card is wrong.

## Solution

Finance becomes **Finance & Price**: one area, a left sidebar, and a landing **Dashboard** that puts
the whole cost-to-rate chain on one screen the way the reference spreadsheet does — costs and
capacity on one side, the rates they imply on the other, with the gap between those rates and what
the card actually charges called out.

The Dashboard is read-only. Every number on it is a link into the screen that owns it:

- **Rate Card** — the existing Pricing screen, unmoved, now carrying day and half-day rows.
- **Overhead** — the existing expense register, plus a **Depreciation** tab holding a real asset
  register that feeds overhead *and* exports for lodgement.
- **Capacity** — new. Billable hours per day, working days per week, leave and public holidays, sick
  and miscellaneous days. This replaces the hardcoded 48-week year with his actual one.
- **Profit Goals** — the existing Goals screen: desired net income, target margin, tax reserve.

The output is not a price. It is three floors — **hourly, half day, full day** — plus the annual
revenue and the number of jobs needed to hit the income he wants. What the client gets charged stays
a judgement he makes on the estimate, with the floor visible beside it.

## Experience Principles

1. **Advisory, never automatic** — the calculator computes floors and flags rows that fall below
   them. It never writes to the rate card. `computeTotals` still never reads `rate`, and no button
   bulk-rewrites `mu`. This is the `overhead-finance` brief's "Visible, not enforced" principle
   extended to a screen whose whole purpose is to disagree with the card: the disagreement is
   surfaced as a badge and an explanation, and resolving it is a human decision taken on the Rate
   Card screen.
2. **One number, one truth** — inherited verbatim, and this feature is where it gets tested hardest.
   GST is `settings.gst`, mirrored here and editable, not a second copy. The tax reserve rate stays
   `pricing.taxSetAsideRate`. Annual billable hours are *derived* from the Capacity fields, so
   `goals.billable_capacity_hrs_per_week` becomes a computed value rather than a second place to
   type one. The depreciation register is the only source of gear cost, and Overhead reads from it
   rather than asking for the same figure again.
3. **Explicit over assumed** — every number that was previously a constant with a comment becomes a
   field with a value. The 48-week year becomes four capacity inputs. The instant asset write-off
   threshold and ATO effective lives are entered, with the current figure as a placeholder and a
   note to confirm them, because both move with the federal budget and an app that quietly asserts
   last year's threshold is worse than one that asks. Where two honest numbers exist, both are
   shown rather than averaged into one — see the depreciation split below.

## Aesthetic Direction

- **Philosophy**: Editorial dark utility — inherited unchanged. A film-lab studio tool, not a SaaS
  dashboard. The sidebar is the only new structural element and must read as the same system: flat,
  1px-bordered, uppercase tracked labels, one accent doing the interactive work.
- **Tone**: Calm, precise, professional. This is the screen where the business either works or it
  doesn't, and it should read like a printed cost sheet, not a warning light.
- **Reference points**: the existing Pricing rate card and the Overhead screen's own tables. The
  reference spreadsheet's two-panel layout (costs left, capacity right) for the Dashboard.
  Linear's density.
- **Anti-references**: KPI tiles with icons and drop shadows, gauge/speedometer widgets, progress
  rings, Xero/QuickBooks chrome, a "health score". The Dashboard shows numbers and one comparison;
  it does not grade him.
- **Palette**: single-accent rule holds. The one deliberate exception already granted to the
  category donut in `overhead-finance` extends to the depreciation schedule's decline curve, on the
  same terms: `--accent` marks the current financial year, everything else is the muted tonal ramp.
  Below-floor badges use `--accent-text` (the 4.5:1-compliant accent from `a11y.css`), not red —
  there is no second hue in this system.

## Existing Patterns

Verified against the live code, 2026-09-27. Everything in the `overhead-finance` brief's "Existing
Patterns" section still holds; only the deltas are listed here.

- **Typography / colour / shape**: unchanged. `Delight` 700 for headings and money figures,
  `Funnel Sans` 13px for UI, 10–11px uppercase tracked labels, flat edges, 1px borders
  ([`web/css/app.css:19-21`](../../web/css/app.css)).
- **`--muted` is `rgba(240,237,232,0.6)`** as overridden in `web/css/a11y.css`, not the `0.42` in
  `app.css`. `--muted2` (1.67:1) is not a text colour. `--accent-text` exists for accent-coloured
  text; `--accent` is for fills, borders and rings only.
- **The area shell**: [`web/js/views/finance.js`](../../web/js/views/finance.js) is already a thin
  router owning a sub-tab row and mounting a child view into `#finance-sub`, with
  `LSCUnsaved.confirmLeave()` on every tab switch. The sidebar replaces its `TABS` row and its
  `.finance-tabs` CSS; the router contract, the mount target and the unsaved-guard behaviour are
  reused as-is. Sub-tabs are `<nav>` + `aria-current`, deliberately **not** `role="tablist"` — that
  reasoning is documented in that file's header and this feature does not overturn it.
- **Breakpoints**: `1099px`, `900px`, `767px` ([`web/css/responsive.css`](../../web/css/responsive.css)).
  `app.css` is never edited for responsive work; overrides go in `responsive.css`.
- **Singleton JSON-blob rows** (`pricing`, `settings`) and **real tables with migrations**
  (`overhead_items`, `overhead_snapshots`, `goals`) are both established
  ([`server/src/db.js`](../../server/src/db.js)). Capacity extends the `goals` table. Depreciation
  is a new table, per the decision below.
- **The money model** is one file copied byte-identically into the browser
  ([`server/src/calc.js`](../../server/src/calc.js) → `web/js/calc.js`). Any change to it is two
  identical edits, and `npm test` in `server/` is the gate.
- **Tables** use `.est-table` with `data-label` attributes on every cell — a new column without one
  loses its heading below 768px. **Modals** use `.modal-overlay`/`.modal-box` with the real focus
  trap in `web/js/views/settings.js`. **Deletes** use `window.confirm()` plus a `Toast`.

## Resolved Decisions

Settled during Phase 1 grilling (2026-09-27). Do not re-litigate these; they each cost a round trip.

1. **Finance is renamed `Finance & Price`, not joined by a second area.** Two screens writing the
   same singleton `goals` row and the same overhead items would break principle 2. The horizontal
   sub-tab row becomes a left sidebar; Pricing stays inside as Rate Card.
2. **The CSV working-days capacity model replaces the 48-week constant.**
   `annual billable hours = (working days/week × 52 − leave days − sick days) × billable hrs/day`.
   On the reference defaults that is `(5 × 52 − 30 − 8) × 8 = 1,776` against today's `40 × 48 =
   1,920` — **8% fewer hours, so every overhead-derived rate rises ~8%.** Accepted knowingly: the
   old figure flattered the rate by assuming only four weeks of downtime.
   `WEEKS_PER_YEAR = 48` is retired as a constant.
3. **There is no "unit" and no unit price.** The reference sheet is product-shaped. The outputs are
   an **hourly floor**, a **half-day floor** and a **full-day floor**, plus target annual revenue
   and jobs-needed-per-year.
4. **Day rates are ordinary rate-card rows, not a new pricing mode.** `Video Capture — Full Day`,
   `— Half Day`, `— Hourly` and `Overtime — per hour` are four rows with four independently editable
   `mu` values. A half day is **not** half a full day — setup, travel and turnaround do not halve —
   so it gets its own price rather than a 0.5 multiplier.
5. **Rate-card rows gain `hoursPerUnit`, and `totalHours` becomes `Σ qty × hoursPerUnit`.**
   See "Known defect" below. Full Day prefills from the Capacity screen's billable-hours-per-day
   and stays editable, because a shoot day genuinely runs longer than an average working day and
   forcing the two equal would distort one to fix the other.
6. **The calculator produces rates; the estimate produces prices.** No constant for crew, hire or
   travel exists or is needed. Inside an estimate, `directJobCosts` is the job's real
   `expenseTotal` — already built and already correct. On the Dashboard those costs are unknowable,
   so the floors exclude pass-throughs entirely and the copy says they are added at cost on top.
7. **The floor compares against `mu`, not `rate`** — what the client pays is what recovers overhead.
   A below-floor row gets a badge, and an info control explains the comparison.
8. **Depreciation is its own table, and it produces two different numbers.** Tax depreciation is the
   wrong number for pricing: diminishing value gives a large deduction in year one and a small one
   by year four, which would swing the day rate 30–40% for gear still owned and still in use.
   - `tax_deduction` — ATO method (diminishing value / prime cost / pool) → CSV export, lodgement.
   - `replacement_reserve` — straight-line over *his* replacement cycle → **this is what feeds the
     overhead rate and prices the work.**
9. **One capacity pool, not two.** Hours are hours; post hours are billable hours. The app will not
   enforce a shoot-day cap, because the post-to-shoot ratio is the most variable number in the
   business (≈1 edit day for a corporate interview, ≈3 for a wedding) and enforcing it needs a
   constant that does not exist. Instead the Dashboard carries an **editable post-ratio readout**:
   "at N shoot days/month, post consumes X hrs — leaving Y billable hrs unsold."
10. **GST is surfaced, not duplicated.** `settings.gst` already exists and `calc.js` already handles
    the full GST path including per-estimate GST-free jobs. Finance & Price gets an **editable
    mirror** of it, exactly as Goals already mirrors the tax reserve rate. Currently
    `registered: false`. Every figure on the calculator is GST-exclusive regardless.
11. **Not tax advice.** The app implements the ATO's published formulas against figures the user
    enters. Thresholds and effective lives are user-entered with a confirm-with-your-accountant
    note, never hardcoded.

## Known Defect This Feature Must Fix

`computeTotals` runs `totalHours += qty` for every labour row unconditionally
([`server/src/calc.js:137`](../../server/src/calc.js)), and that `totalHours` is what
`minimumJobPrice` allocates overhead across
([`web/js/views/estimate-editor.js:629`](../../web/js/views/estimate-editor.js)).

Add a day-unit row to the card today and **a two-day shoot books 2 hours of overhead instead of
~20** — the Minimum Job Price advisory silently collapses to a fraction of the truth, and the cost
breakdown dialog agrees with it. The fix is decision 5: `hoursPerUnit`, defaulting to 1 so every
existing row and every already-saved estimate is unchanged. This must land in the same change as
the day-rate rows, never after them.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Area shell / router | **Modify** | `finance.js` — swap `.finance-tabs` row for the sidebar, keep the mount contract and `confirmLeave()` |
| Sidebar nav rail | **New** | `.nav-link` markup in a vertical rail; `<nav>` + `aria-current`, not `role="tablist"` |
| Dashboard | **New** | Read-only roll-up, two-panel like the reference sheet; every figure deep-links to its owner screen |
| Floor comparison table | **New** | Card rate vs floor per row, below-floor badge in `--accent-text` |
| Info control (`i`) | **New** | Needed in at least two places (floor comparison, depreciation). Button-triggered popover — see Accessibility |
| Capacity screen | **New** | 4 fields + derived annual billable hours; extends `goals` |
| Depreciation register | **New** | `.est-table` list + add/edit modal + FY selector + CSV download |
| Depreciation schedule | **New** | Per-asset per-FY rows: opening AV, decline, deductible portion, closing AV |
| GST mirror block | **New** | `.tax-setting` pattern, writes `settings.gst` via existing route |
| Post-ratio readout | **New** | One editable number + a derived sentence |
| Rate Card (Pricing) | **Modify** | Day/half-day/overtime rows; `hoursPerUnit` column |
| Overhead screen | **Modify** | Gains the Depreciation tab; annual total gains the replacement reserve |
| Goals screen | **Modify** | Billable Capacity field becomes a derived read-only figure linking to Capacity |
| Estimate editor | **Modify** | `hoursPerUnit`-aware hours; floor note copy for day-unit rows |
| `.est-table`, `.modal-box`, `.field`, `.btn`, `Toast`, `LSCUnsaved` | **Exists** | Reused unchanged |

## Key Interactions

- **Sidebar navigation** — click a rail item, the child view is replaced in `#finance-sub`,
  `aria-current` moves, the URL-less router state updates. If the outgoing screen has unsaved edits,
  `LSCUnsaved.confirmLeave()` asks first, identically to a top-level nav change.
- **Dashboard → owner screen** — every figure and panel heading is a link. Clicking "Annual
  overhead $X" lands on Overhead. Nothing on the Dashboard is editable except the post-ratio input,
  which is display-local and saves nothing.
- **A rate falls below its floor** — the Dashboard's comparison table marks the row, states the gap
  in dollars, and offers the info control explaining that the floor is measured against the
  marked-up price because that is what recovers overhead. It does not offer to fix it. The Rate Card
  screen is one click away.
- **Info controls** — a small `i` button opens a short explanation. Two are required by name: the
  floor comparison (`mu` vs `rate`, pass-throughs excluded) and the depreciation split (why the
  overhead figure and the ATO figure differ). Hover reveals it as an enhancement; the button is the
  contract.
- **Adding an asset** — modal over the register, using the existing focus-trapped `.modal-box`.
  Saving writes the asset, recomputes the replacement reserve, updates the annual overhead total and
  every rate derived from it, and writes an `overhead_snapshots` row so the trend chart stays
  truthful. `Toast` confirms.
- **Changing a capacity field** — the derived annual billable hours figure updates live beside the
  fields, before saving, the way Goals' Target Annual Revenue already follows its inputs. Saving
  moves every overhead-derived rate on the card; the copy warns that it will before it does.
- **Downloading the depreciation CSV** — FY selector picks the year, the button downloads one row
  per asset for that year. No email, no upload, no sharing.
- **Disposing of an asset** — a disposal date and proceeds move it out of the replacement reserve
  (so sold gear stops inflating overhead forever) while keeping it on the schedule for the year it
  was sold, because the balancing adjustment is that year's tax event.

## Responsive Behavior

The site's existing bands are `≥1100px`, `1099–900px`, `899–768px`, `<768px`, and
`web/css/app.css` is not edited for responsive work.

- **≥1100px** — sidebar is a fixed-width left rail; the child view occupies the rest. This is a
  deliberate layout change inside the Finance area only. The pixel-identical-above-1100px rule the
  UI port carried applies to the *ported screens*, and each child screen keeps its own layout
  unchanged; only the container narrows by the rail's width.
- **1099–900px** — rail narrows; labels stay (they are short). The Dashboard's two panels stay
  side by side.
- **899–768px** — the Dashboard's two panels stack. The rail stays.
- **<768px** — the rail becomes the existing horizontal `.finance-tabs` row it replaced, scrolling
  horizontally if needed, with 44px touch targets. Every table stacks via `data-label`. The
  depreciation register's widest columns collapse into the stacked card layout, and the CSV button
  stays reachable without horizontal scrolling.

## Accessibility Requirements

- **Contrast**: body text ≥4.5:1 against both `--bg` and `--surface`. `--muted` at `0.6` clears both
  (6.15:1 / 5.2:1). Accent text uses `--accent-text`; raw `--accent` is fills, borders and rings
  only (3.71:1 — fine for non-text, not for text).
- **Info controls must be buttons, not hover targets.** A hover-only tooltip is unreachable by
  keyboard and unusable on touch, and both of these explanations carry real money meaning. Each is a
  `<button>` with an accessible name ("How the floor comparison works"), toggling
  `aria-expanded` on a popover that is reachable by Tab, dismissible by Escape, and returns focus to
  the trigger. Hover may reveal the same content as a convenience; it is never the only way in.
- **Sidebar**: `<nav>` with `aria-current="page"` on the active item, each item a real `<button>` in
  the document's tab order. No roving tabindex, because these are not ARIA tabs — consistent with
  the existing decision documented in `finance.js`.
- **Focus**: visible `:focus-visible` rings from `a11y.css` on every interactive element, including
  the new rail items and info buttons. The asset modal uses the existing trap: Tab/Shift+Tab wrap,
  Escape closes, focus returns to the trigger, focusable set recomputed each Tab.
- **Derived figures** that change as fields are typed (annual billable hours, target rates) sit in
  `aria-live="polite"` regions, matching how Goals announces Target Annual Revenue.
- **Tables**: every new column carries a `data-label`. Money columns are right-aligned and read as
  plain currency to a screen reader, not as bare numbers.
- **Empty and unset states** render an em dash with an explanatory line, never `$0.00` — a rate card
  reading zero looks like a computed answer meaning an hour of your time costs nothing.

## Out of Scope

- **Two-pool capacity.** Decision 9. No shoot-day cap, no enforced post ratio.
- **Seasonality.** Monthly and weekly targets are the annual figure divided, labelled as averages.
  Wedding-season and EOFY weighting is not modelled.
- **Any automatic write to the rate card.** No "apply this rate", no bulk `mu` rewrite. Decision 7.
- **An owner's wage term in the money model.** `calc.js` deliberately has none; it was declined
  knowingly on 2026-09-15 after an accounting review. Desired Net Income stays the single annual
  planning figure. Not reopened here.
- **Changing how tax is provisioned.** Tax remains a flat slice of revenue, per the existing
  documented decision, rather than the accountant's profit-based calculation.
- **Actual tax lodgement.** The CSV is handed to a human. No ATO integration, no BAS, no STP.
- **Hardcoded ATO thresholds or effective lives.** Placeholders and a confirm note only.
- **Invoicing, estimates and the PDF**, except the two `hoursPerUnit` changes named above.
- **HubSpot CRM sync** — a separate track ([`.design/hubspot-crm-sync/`](../hubspot-crm-sync/)).
- **Multi-user or multi-business support.** Still one operator, one business.
