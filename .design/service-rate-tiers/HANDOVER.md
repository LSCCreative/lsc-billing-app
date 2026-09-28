# Handover: Service Rate Tiers

Read this first, then [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md). This track changes the live Rate Card
and estimate editor built by [`.design/price-calculator/`](../price-calculator/). That folder stays
the authority for every decision this one does not explicitly overturn. The brief's "Resolved
Decisions" lists the overturned ones.

**Build bucket: `Opus, effort: high`.** A new suggested-price function in `calc.js` (both copies,
drift-tested), a rate-card data migration, and line-snapshot changes. All of it is money math.

## What this is

Every labour service gets hourly, half-day and full-day prices on one row. An auto hourly price is
income floor × (1 + Target Markup), rounded up to the dollar. An auto half or full day is the
service's hourly price (typed or auto) × the Service Day hours (brief decision 13). Each follows the
numbers until the user types over it. A card-level Service Day (full 8 / half 4 billable hrs) replaces
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
      - [x] **Amendment (brief decision 13, 2026-09-28):** an auto half or full day is the hourly
            price × the day's hours, and the auto hourly is rounded up against the exact target.
            This changes task 1's `unitDef` / `suggestedPrice`; the old tests were updated to the
            new figures, with new ones for the rule. 10 mutations checked, 9 caught, and the tenth
            is equivalent in practice (the GST search starting $1 higher).
      - [x] Task 3 — schema v9, reshaped `DEFAULT_PRICING`, and the `pricing_shape_outdated`
            guard (2026-09-28). The migration is `server/src/migrations/v9-service-units.js`. See
            its Done note for the six decisions, especially the frozen v8 default card.
      - [x] Task 4 — Rate Card rows on the new shape (2026-09-28): unit view switch, auto /
            set-by-you prices, `↺ use $X`, `LSCData.priceContext()`. Browser-verified; see its
            Done note, including the one visible change above 1100px (state lines wrap).
      - [x] Task 5 — Service Day setting, Show switch, hidden-unit notice (2026-09-28).
            Browser-verified; see its Done note (the notice appears only when the unit on show
            is fine; Show's pressed state is derived).
      - [x] Task 6 — estimate editor unit picker, unit switch on the line, rates keyed by unit
            (2026-09-28). Browser-verified; see its Done note (a line's current option is just the
            unit's name; one `unitSnap` decides every price shown or added; a last-project line
            remembers today's price *at its unit*; the editor gained a live region).
      - [x] Task 7 — Dashboard: headline day floors from the Service Day, one comparison row per
            service, `labourFloorComparison` deleted (2026-09-28). Browser-verified; see its Done
            note (an auto *day* can be below floor when its typed hourly is).
- [ ] Phase 7 — Design Review.

Nothing deployed. **As of task 3 the branch is only coherent as a whole**: the server now
stores and demands the new card shape, while the web build still reads and writes the old one.
As of task 7 every screen reads the new shape (Rate Card, estimator, Dashboard), so the branch is
coherent again end to end. What's left before merging is polish (tasks 8–9), then the deploy. **Don't merge
before task 10.**

**The scratch API migrates too.** Starting `api-scratch` from this branch takes the `/tmp` scratch
DB to v9, and a `main` checkout then refuses it ("newer database"). Re-seed it if you switch back.

**Exact next item:** TASKS.md **task 8, "Responsive pass"** (frontend — Opus/high). Known
already: the estimator line's unit select is 28px tall at 375 (needs 44px), and the Rate Card
state lines wrap at 1280 (task 4's note). Then task 9 (accessibility).

**Verifying UI on this branch:** another session may be running `api-scratch` / `web` on 8080 /
5173 with a v8 server, and the scratch DB is shared. Task 4 used a *copy* of the scratch DB at
`/tmp/lsc-billing-v9` (already migrated to v9, login `dev`) with two temporary, uncommitted
`launch.json` entries: `api-v9-scratch` (8081) and `web-v9` (`127.0.0.1:5174`, which serves a
`config.js` pointing at 8081, and runs on `127.0.0.1` so its cookie doesn't clash with
`localhost`'s). Remove those two entries from `.claude/launch.json` before the final merge.

## Things a fresh agent will want to argue with (settled)

- **Auto prices move the rate card without a save.** This deliberately overturns price-calculator's
  "nothing ever auto-writes the rate card". Saved estimates are still safe: each line keeps its own
  snapshot.
- **Service Day hours are not Capacity's billable hours per day.** Capacity's figure is a yearly
  average. A service day on a job is 8 / 4. Don't "helpfully" link them back together.
- **An auto day can be below floor.** An auto *hourly* never is, but an auto day follows the
  hourly, typed or not, so a typed hourly under the floor takes its auto days under too. The
  Dashboard badges such a cell, not tags it. That's decision 13 working as intended, not a bug.
- **An auto day is the hourly price × the day's hours** (brief decision 13, the user's call on
  2026-09-28, made after task 3). Type $140 an hour and the full day reads $1,120 at 8 hrs. This
  reverses "each unit rounded on its own", so an auto full day *is* 8 × the rounded hourly. It
  follows that an auto half day is half an auto full day. The "half day is not half a full day"
  rule now applies only to typed prices.
- **The unit dropdown on a Rate Card row is a view switch**, not a property of the row. It is not
  saved and does not make the card dirty.
- **The auto hourly is rounded up against the exact floor × markup**, not a cent-rounded one, and
  on a GST-inclusive card it's a search (`p ÷ 1.1 ≥ target`), not `ceil(raw × 1.1)`. Because a day
  multiplies the hourly, an hourly price even 0.1¢ under the true floor becomes a day 1¢ under its
  floor, and gets badged. Both simpler recipes do that; the sweeps in `test-calc.js` over unrounded
  floors catch it. Don't "simplify" it back.
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
  Goals, so every auto *hourly* price reads `—` until then, and so does any auto day on a service
  whose hourly is auto. A day on a typed hourly is priced regardless. That's expected, not a bug.
- **Deploy order: NAS before Pages** (the live DB is on v8; this is v9). Back up first.

## How to verify your work

As for price-calculator: `npm test` in `server/`; identical `calc.js` in both copies (the drift
test); for money math, break the line and confirm a test fails. Pin in tests: the rounding
(`ceil` after cent-rounding, per unit), GST-inclusive cards, the `null` floor, a mixed auto /
set-by-you service, and a line whose unit is switched after being added.
