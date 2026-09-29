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
      - [x] Task 8 — responsive pass (2026-09-28). Measured at seven widths against `main` on the
            same data. Nothing overflowed; the fixes were 44px targets (`↺`, the notice, the
            editor line's unit select), Show as three equal thirds, the Service Day fields sharing
            the row, and the state line's `·` held to the part before it. See its Done note. At
            768px and up, every measurement matches the pre-change run. Screenshots are in
            `screenshots/responsive-*`.
      - [x] Task 9 — accessibility pass (2026-09-29). Audited, then walked the IA's flows with
            real keys. Fixed two keyboard traps: Tab from a price to its `↺` lost focus, because
            the blur rewrote the line; and `+ Add Service` dropped focus. Also: a plain-sentence
            description for the price field, names that start with the visible words, labels that
            follow a rename, and option text carrying the whole problem. Contrast was measured and
            needed nothing. See its Done note.
      - [ ] **Code review fixes R1–R14** (2026-09-29). A `/code-review` (xhigh) of the whole
            branch found 14 issues. **R1–R4, the four recommended before the deploy, are done**
            (2026-09-29). R1: GST changes from the Invoice Settings modal refresh both screens'
            auto prices. R2: estimate writes need `pricingShape` (`calc.js` `PRICING_SHAPE`), or
            they're refused as outdated. R3: the Rate Card won't open a pre-v9 card
            (`calc.js` `cardShapeOutdated`). R4: a reset card gets row ids. See their Done notes.
            R5–R14 can follow the deploy. They're listed in TASKS.md under "Code review
            fixes". R1–R4 are recommended before the deploy: stale GST settings in auto prices;
            the estimate routes having no shape guard, so an old tab can save $0 labour; the
            Rate Card accepting a pre-v9 card; and reset-to-defaults leaving rows without ids.
            R9 (PDF names) is a settled user decision, listed for completeness only.
- [x] **Phase 7 — Design Review** (2026-09-29) → [`DESIGN_REVIEW.md`](DESIGN_REVIEW.md). No
      must-fixes. Four should-fixes, checklisted in TASKS.md as **D1–D4** (inline Service Day error,
      dangling `·` in the state line at ≥1100px, Show switch's selected state, estimator unit-select
      width), plus five could-improves. Reviewed against the local build after checking it is
      byte-identical to the deployed one; the live login was not used.
      - [x] **D1–D4 done 2026-09-29**, on `main`, **uncommitted and not deployed** (pushing `main`
            deploys Pages; frontend only, so no NAS step). Two deviations from the review's
            suggestions, both measured: D1's inline reason isn't `role="alert"` (the save bar
            already announces it), and D2's band is ≥768px, not ≥1100 (no two-part state line fits
            at any table width). See the Done note under "Design review fixes" in TASKS.md.
      - [x] **R5–R7, R10–R14 done 2026-09-29** (uncommitted). Every money-math one was checked
            against the committed build on the same inputs, with that file swapped in. R8
            doesn't reproduce in Chrome; Safari wasn't checked (remote automation is off), so it's
            left open for a person. R9 is closed, no change. See the Done notes in TASKS.md.

Nothing deployed. **As of task 3 the branch is only coherent as a whole**: the server now
stores and demands the new card shape, while the web build still reads and writes the old one.
As of task 7 every screen reads the new shape (Rate Card, estimator, Dashboard), so the branch is
coherent again end to end. Every build task is done; what's left is the deploy (task 10), then the
review. **Don't merge before task 10.**

**The scratch API migrates too.** Starting `api-scratch` from this branch takes the `/tmp` scratch
DB to v9, and a `main` checkout then refuses it ("newer database"). Re-seed it if you switch back.

**DEPLOYED 2026-09-29 (see "Deployed" below), design-reviewed the same day. D1–D4 and R5–R7, R10–R14 are done, on `main`, uncommitted and not deployed. R9 was closed without change (the user's decision). The one open item is R8, which needs a person in Safari (see its note in TASKS.md). Next: commit, then deploy when the user says so.** Deploy note: the only server change is `calc.js` `serviceDayOk` plus the route using it. There's no schema change and no new route, and the web has its own `calc.js` copy, so the order doesn't matter this time. Deploy both anyway, so the two copies stay identical on the NAS and on Pages. _Superseded:_ "Exact next item is R5" _Old text:_ task 10, "Deploy: NAS (v9) first, then Pages"** (deploy — Sonnet/medium).
R1–R4 are done. R5–R14 can follow the deploy, or come first if the user prefers. **New since R2:**
from the moment the NAS runs v9 until Pages is live, the live site can't save an estimate at all.
Its saves lack `pricingShape` and are refused with a "reload" message. So do the Pages push
straight after the NAS checks, and don't edit estimates in between. **Ask the user before
starting it.** Back up the live DB first. Remove the two
temporary `launch.json` entries (`api-v9-scratch`, `web-v9`) before merging. Then task 11 (design
review on the live site). **For the review:** on a phone, a row showing a day reads "RATE ($/HR)
120.96/day" (task 8's Done note).

**A real VoiceOver pass is still for a person** (as in price-calculator). What to listen for:
- Rate Card, Tab onto a set-by-you price: "Hourly price for Video Capture, 200 … Set by you,
  suggested $103." Change the row's unit, and both the name and that sentence should change with it.
- Tab once more: "Use $103, the suggested hourly price for Video Capture, button". Activate it:
  focus goes back to the price, and "Video Capture, hour: back to auto, $103." is spoken once.
- Type in a price: one announcement after you pause, not one per keystroke.
- Edit the Service Day's Full hours: "Auto prices updated for N-hour full day." once, not once per
  row.
- The unit select's options: the other units read with their problem ("half day · below floor by
  $104.64"). Does VoiceOver's rotor/list read the whole option?
- `+ Add Service`: lands on the new name field, text selected.
- Estimator: "Unit to add for Production"; a disabled option reads "no price yet, needs Profit
  Goals, dimmed"; switching a line's unit speaks "…: now per half day, $412, 4 billable hrs."
- Show buttons: VoiceOver should say "selected" / "not selected" (from `aria-pressed`). Check it
  doesn't spell out the uppercase labels letter by letter.

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

## Deployed 2026-09-29 (~09:15 AEST), NAS first, with the user's go-ahead

Branch committed and merged to `main` locally (`25ba574`), `launch.json` temp entries dropped (R14).
`npm test` 252 pass. Backup via `sqlite3 ".backup"` to
`/volume4/lsc-billing/data/backups/pre-v9-20260929-0911.db`, integrity ok (schema v8). `server/`
copied with the usual `COPYFILE_DISABLE=1 tar` (excluding `node_modules`, `./data`, `.env`,
`docker-compose.yml`; the NAS compose still mounts `/volume4/lsc-billing/data:/data`).
`docker compose up -d --build`: `healthy`, boot log `migrated to v9`. The log printed no per-row
day-hours lines. The live card's labour rows all had no day rows to convert. Live DB after:
integrity ok, v9, 9 overhead items, `serviceDay` 8/4 present, no labour row has `mu` (Travel keeps
its own). Public `/health` 200, `/api/goals` 401 signed out. Then `main` pushed: Pages run
36497076581, success; live `calc.js` carries `suggestedPrice`; the site boots signed in with no
console errors. The NAS-to-Pages gap was about a minute.

**Only the user can do:** save the FY 2026–27 tax scale on Profit Goals (until then every auto
hourly, and any auto day on one, reads `—`), and fold the old "— Full Day" / "— Half Day" rows into
their services by hand.
