# Handover: Service Rate Tiers

Read this first, then [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md). This track changes the live Rate Card
and estimate editor built by [`.design/price-calculator/`](../price-calculator/). That folder stays
the authority for every decision this one does not explicitly overturn. The brief's "Resolved
Decisions" lists the overturned ones.

**Build bucket: `Opus, effort: high`.** A new suggested-price function in `calc.js` (both copies,
drift-tested), a rate-card data migration, and line-snapshot changes. All of it is money math.

## What this is

Every labour service gets hourly, half-day and full-day prices on one row. Each price auto-fills as
income floor × unit hours × (1 + Target Markup), rounded up to the dollar, and follows the numbers
until the user types over it. A card-level Service Day (full 8 / half 4 billable hrs) replaces
per-row day hours. The estimate editor picks service → unit → Add, and a line's unit can be switched.

## State as of 2026-09-28

`/design-flow` sequence position:

- [x] **Phase 1 — Grill Me.** Covered inside the brief interview (four rounds of questions,
      2026-09-28). Nine decisions, recorded in the brief.
- [x] **Phase 2 — Design Brief.** Complete → [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).
- [x] **Phase 3 — Information Architecture.** Complete →
      [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md) (2026-09-28). Settles the data
      shape (`prices: { hour, half, full }`, `null` = auto; card-level `serviceDay`), the read/write
      map, the `calc.js` functions (`unitHours`, `suggestedPrice`, `unitDef`, a reworked
      `labourFloorComparison`), the v9 migration and the deploy order. Three more decisions went into
      the brief (10–12).
- [ ] Phase 4 — Design Tokens. **Skipped by agreement**, as in price-calculator: the existing
      `web/css/app.css` + `a11y.css` system must survive.
- [x] **Phase 5 — Brief to Tasks.** Complete → [`TASKS.md`](TASKS.md) (2026-09-28). There are 11
      tasks: 3 foundation, 4 core UI, 2 polish, deploy, review. Every build task except the
      responsive and a11y passes is money math (Opus/high). The deploy is Sonnet/medium and needs
      the user's go-ahead.
- [ ] **Phase 6 — Build.** In progress on branch **`service-rate-tiers`** (not `main`: pushing
      `main` deploys Pages, and from task 3 onward the branch is only coherent as a whole).
      - [x] Task 1 — `unitHours` / `suggestedPrice` / `unitDef` in `calc.js` (2026-09-28). See its
            Done note in TASKS.md, including the one change from the IA's rounding recipe.
      - [x] Task 2 — `serviceFloorComparison` and `lineDef`'s fallback for `prices` rows
            (2026-09-28). See its Done note: auto units are priced from the comparison's own floor
            (only `ctx.markupPct` is read), and `lineDef` takes an optional `pricing` third
            argument that `rows.js` should start passing in task 6.
- [ ] Phase 7 — Design Review.

Nothing deployed. Tasks 1–2 are additive: nothing calls the new functions yet, and `lineDef`'s
new path only fires for a row carrying `prices`, which no card has until v9. So the live site is
unaffected even if this branch were merged. **From task 3 onward it is not**: merge only after
task 10.

**Exact next item:** TASKS.md **task 3, "Schema v9, new defaults, and the shape guard on
`PUT /api/pricing`"** (money math — Opus/high).

## Things a fresh agent will want to argue with (settled)

- **Auto prices move the rate card without a save.** This deliberately overturns price-calculator's
  "nothing ever auto-writes the rate card". Saved estimates are still safe: each line keeps its own
  snapshot.
- **Service Day hours are not Capacity's billable hours per day.** Capacity's figure is a yearly
  average. A service day on a job is 8 / 4. Don't "helpfully" link them back together.
- **An auto half day is half an auto full day.** The "half day is not half a full day" rule now
  applies only to typed prices. The user accepted this.
- **The unit dropdown on a Rate Card row is a view switch**, not a property of the row. It is not
  saved and does not make the card dirty.
- **An auto price on a GST-inclusive card is a search, not `ceil(raw × 1.1)`** (task 1). The
  least whole dollar whose `priceExGst` reaches the cent-rounded target. The literal
  multiply-then-round recipe lands 1¢ under the floor at half-cent edges. Don't "simplify" it back.
- **The PDF keeps service name only**, even though two units of one service then print as identical
  names. That was the user's call.

## Open seams for the tasks step

All settled in the IA doc; these are what a task list most easily gets wrong:

- **Snapshot first, reshape second**, both in the v9 migration. Pin it with a test that every
  estimate's recomputed totals are identical before and after v9.
- **`PUT /api/pricing` must refuse the old row shape** (`pricing_shape_outdated`). This is the only
  thing stopping a stale browser tab from writing the old card back over the new one.
- **`unitDef` returns the old flat row shape**, so `lineSnapshot`, `lineDef`'s snapshot path and
  `computeTotals` don't change. If a task finds itself editing `computeTotals`, it has gone wrong.
- **`mu: null` from `unitDef` means unavailable**, never $0.
- On the live site the income floor reads `—` until the FY 2026–27 tax scale is saved on Profit
  Goals, so every auto price reads `—` until then. That's expected, not a bug.
- **Deploy order: NAS before Pages** (the live DB is on v8; this is v9). Back up first.

## How to verify your work

As for price-calculator: `npm test` in `server/`; identical `calc.js` in both copies (the drift
test); for money math, break the line and confirm a test fails. Pin in tests: the rounding
(`ceil` after cent-rounding, per unit), GST-inclusive cards, the `null` floor, a mixed auto /
set-by-you service, and a line whose unit is switched after being added.
