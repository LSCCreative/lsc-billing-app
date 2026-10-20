# Build Tasks: Per-service post multipliers

Generated from: `.design/post-multipliers/DESIGN_BRIEF.md` (decisions G1–G10). Date: 2026-10-20.
Schema goes **v18 → v19**: this track deploys **after pricing-floor PF11** (v18), NAS before Pages.
Every `calc.js` change goes into both copies (`server/src/calc.js`, `web/js/calc.js`); `npm test` in
`server/` is the gate; for money maths, break the line and confirm a test fails. Check screens at
1280 / 800 / 375 against the scratch API (WORKING_NOTES).
Tags: **(money — Opus/high)**, **(frontend — Opus/high)** = **Frontend task**.

Reference check for the money tasks: capture 10 h, a Brand Story (qty 1) with Edit 2×, Grade 0.5×,
Sound 0.3× → lines 20 / 5 / 3 h (0.3 × 10 = 3), recommended 28; capture 1 h → 2 / 0.5 / 0.5 (0.3 rounds
up to 0.5), recommended 3; qty 2 at 1 h → 4 / 1 / 1.

## Foundation

- [x] **PM1. The post model** (money — Opus/high): in both `calc.js` copies. A type's services become
  `{ name, multiplier }` (`typeServices(type)` normalises an old `[name]` list to multiplier 0, G5), and
  `typePostRate(type)` = Σ multipliers (G6). `postLineHours(captureHours, multiplier, qty)` =
  `upToHalfHour(captureHours × multiplier × qty)` (G1). `postPlan` gives each deliverable's share as Σ
  of its tagged post lines' recommendations when those lines carry a `postMultiplier`, and falls back to
  the deliverable's old single `multiplier` otherwise, so an estimate saved before v19 recommends exactly
  what it does today (G9); it also returns `lines: [{ index, recommended }]` for the editor. Bump
  `PRICING_SHAPE` so an older build can't save the old type shape. Update the header essay on postPlan.
  Done when: the reference figures are pinned in `test-calc.js`; a pre-v19 estimate gives an identical
  plan (sweep the existing fixtures); mutations fail (drop the qty, round per deliverable instead of per
  line, ignore the fallback). _Modifies: `calc.js` ×2, `test-calc.js`. Reuses `upToHalfHour`, `lineDef`._

- [x] **PM2. Schema v19 and the API** (money — Opus/high): migration v19 rewrites the pricing row's
  `data_json`: every type's `services` → `[{ name, multiplier: 0 }]`, the type `multiplier` dropped
  (G4, G5); estimates are not touched. `deliverableTypesOk` checks the new shape (names as strings,
  multipliers finite ≥ 0, ≤ 2 decimals) and refuses the old one; a deliverable row may still carry its
  old snapshot `multiplier`. Post lines may carry `postMultiplier` (finite ≥ 0) and `follows` (boolean),
  refused anywhere else (`line_post_multiplier_invalid`); `pdf.js` / public routes never print either.
  Done when: `test-db.js` migrates a v18 card (strings → objects at 0, multiplier gone, other card fields
  identical, estimates byte-identical); `test-api.js` covers the validation both ways and that a saved
  line keeps `postMultiplier` / `follows` through save + reload. _Depends on: PM1. Modifies: `db.js`,
  `routes/pricing.js`, `days.js` (line checks), `defaults.js` comment._

## Core UI

- [x] **PM3. The Rate Card block: summaries that open** (frontend — Opus/high): rebuild
  `typesBodyMarkup` / `typeRowMarkup` in `pricing.js` in the app's own system (dark warm surfaces,
  terracotta focus, mono figures; extend `.dtype-*`, no new look). Each type is a summary `<button
  aria-expanded aria-controls>`: name · "N post services" · "X post hrs per capture hr" · chevron, with
  "untitled type" when blank. Only one open at a time (G7); a new type opens and focuses Name. The open
  panel holds Name, Description, the **service list** (one row per service: name, a multiplier number
  field "× capture hr", ×), "+ Add service" (adds at 1×, G5) and Remove type. The column head goes.
  `workingCopy`, `chipRows`/`followRename` and the save carry the `{ name, multiplier }` shape; typing a
  multiplier updates its summary total live without a re-render. Intro copy rewritten: services each
  have a multiplier and picking a type fills their hours. Done when: the block at 1280 shows collapsed
  summaries with the right totals, one opens with its list, a save round-trips the multipliers.
  _Depends on: PM2. Modifies: `pricing.js` (types block), `pricing.css` (dtype rules). Reuses:
  `.billing-block`, `.bb-head`, `.del-btn`, `.btn-ghost.btn-sm`, the disclosure pattern of panel.js._
  _Built ahead of PM6–PM8: a save problem already opens its type (`openProblemType`); the summary's
  accessible name reads in full; the panel is `role="region"`; the three breakpoints are in, and
  below 768 the "× capture hr" unit is hidden so service names keep their room (left for PM7 to
  confirm)._

- [x] **PM4. Post lines that fill and follow** (money + frontend — Opus/high): in
  `estimate-editor.js`. `layOutPost` snapshots each service's multiplier onto its line
  (`postMultiplier`, G8) and marks hourly lines `follows` (G3: a line laid out on another unit is 0,
  not following). Every `recalc` sets each following line's qty from `postPlan`'s per-line
  recommendation (no input event loop, no focus jump). A typed edit to a following line's hours clears
  `follows` for good (G2); re-picking the type lays fresh following lines. `collect`/`planMarks` carry
  both fields through reprice, Duplicate day and save; a post line saved before v19 has neither and
  never follows (G9). `dropTagged`'s confirm counts filled hours as hours. Done when, on scratch: a
  Brand Story picked before any capture shows 0s, adding 1 h of Video Capture fills 2 / 0.5 / 0.5,
  changing qty to 2 doubles them, typing 3 on Grade keeps it at 3 when capture changes, save + reopen
  keeps all of that, and an old estimate opens with identical totals. _Depends on: PM1, PM2. Modifies:
  `estimate-editor.js`. Reuses `unitSnap`, `markOwn`, `buildLabourRow`._
  _Built: `fillFollowing` runs first in every `recalc`; the deliverable's qty now recalcs (it prices).
  Switching a following line's unit pins it too (hours aren't days); its qty is kept as for any unit
  switch. A v19 pick snapshots the deliverable's own `multiplier` as 0 (its lines plan it)._
  _Review fix: nothing fills while the form is being restored; on open a following line whose saved
  hours differ from the plan keeps them and is pinned (an estimate never moves on open); a following
  line with no deliverable is pinned, not zeroed._
  _Follow-up: switching a following line off the hour sets it to 0 and pins it (G3), instead of
  keeping its hours as days; a typed line keeps its number as before._

- [ ] **PM5. Planner figures** (frontend — Opus/high): the deliverable row's "Post hrs (rec.)" and the
  planner cell's recommended figure read the new per-line sums (G10); "On post lines X of Y
  recommended" stays; the planner ⓘ and the Capture ⓘ on the Rate Card describe per-service multipliers
  and filled hours. A non-hourly line shows its recommended hours beside it (G3). Done when the figures
  match the reference check on scratch and the ⓘ text says what the editor now does. _Done ahead
  (with the PM4 follow-up): the planner ⓘ and the Capture ⓘ text. Left: the non-hourly line's
  recommended hours, and checking the figures._ _Depends on: PM4.
  Modifies: `estimate-editor.js` (`paintPlanner`, `postPlanMarkup`), `pricing.js` (`captureInfo`)._

## Interactions & States

- [ ] **PM6. Block states and focus** (frontend — Opus/high): Covers: a save problem (blank/duplicate
  name, multiplier not a number ≥ 0 or > 2 decimals) opens the type it's in and focuses the field
  (`typeProblems` names each service's field); a service no longer on the card is struck through with a
  "missing" word in its row, and the summary shows "N missing"; renaming a post row in the table above
  renames it in every type and keeps its multiplier; removing a service focuses the next row (or "+ Add
  service"); Remove type confirms when it has services and focuses the next summary (or "+ Add
  deliverable type"); "+ Add service" disabled with its reason when nothing is left; empty block text;
  Reset Defaults' warning still names the types. Every change is announced via `#pricing-floor-live`.
  _Depends on: PM3. Modifies: `pricing.js`, `pricing.css`._

## Responsive & Polish

- [ ] **PM7. Breakpoints** (frontend — Opus/high): Breakpoints: ≥1100 one-line summary (name left,
  mono meta right, chevron) and a two-column open panel (fields left, service list right); 768–1099 the
  panel stacks; <768 the summary wraps to two lines, service rows stay one line with the name
  truncating, inputs at `--font-size-md`, tap targets ≥ 44 px, no horizontal scroll. _Depends on: PM3.
  Modifies: `pricing.css`, `responsive.css`._

- [ ] **PM8. Accessibility pass** (frontend — Opus/high): the summary's accessible name reads in full
  ("Brand Story, 4 post services, 3.5 post hours per capture hour"); its panel is `role="region"`
  labelled by the type; each multiplier field is labelled with service and type and described by its
  unit; keyboard only: Tab, Enter/Space open/close, nothing traps; focus never drops to the page;
  missing is said in words; contrast holds on `--color-bg-inset`. _Depends on: PM6, PM7._

## Review

- [ ] **PM9. Money review** (money — Opus/high): v18 → v19 on a copy of a backup leaves every saved
  estimate, invoice and document identical; a new estimate's post lines bill exactly the filled hours;
  a pinned line never moves; no new field reaches a public route or PDF. Record any standing rule in
  `WORKING_NOTES.md` (the "suggest, don't price" change for type-laid post lines).
- [ ] **PM10. Design review**: run `/design-review` against the brief; screenshots in
  `.design/post-multipliers/screenshots/`.
- [ ] **PM11. Deploy** (ask first): after pricing-floor PF11; fetch and diff `origin/main`, NAS before
  Pages (`DEPLOYMENT.md`). Then the user re-enters each type's multipliers on the live Rate Card (they
  start at 0×, G5).
