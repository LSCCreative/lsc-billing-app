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

## State as of 2026-10-03

**Built, reviewed and deployed** (NAS v9 + Pages, 2026-09-29, then again for D1–D4/R5–R14). Open:
**R8** (select-on-focus in Safari, needs a person), the VoiceOver pass, and the user saving the FY
2026–27 tax scale (until then auto hourly prices read `—`). Build log and deploy runs were removed to
save agent tokens (`git log -p -- .design/service-rate-tiers/HANDOVER.md`).

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
