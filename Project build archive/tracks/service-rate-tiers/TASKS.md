# Build Tasks: Service Rate Tiers

Generated from: `.design/service-rate-tiers/DESIGN_BRIEF.md` + `.design/service-rate-tiers/INFORMATION_ARCHITECTURE.md`
Date: 28 September 2026

Every task carries a model/effort tag from root `CLAUDE.md`'s buckets, using the same convention as
`.design/price-calculator/TASKS.md`:

- **(money math — Opus/high)**: anything touching `calc.js`, a stored price, or a screen that
  *renders* a computed price or floor. This applies "regardless of how small the diff looks".
- **(frontend — Opus/high)**: UI-build work with no money figure of its own.
- **(deploy — Sonnet/medium)**: infra steps.

**Almost all of this feature is money math.** Every screen it touches shows a price derived from
`suggestedPrice`. Don't move a task to Sonnet because its diff looks like plain UI.

## Ground rules for every task

- **Build on a branch (`service-rate-tiers`), not `main`.** Pushing `main` deploys Pages. The new
  card shape can't ship piecemeal: once the server reshapes the card, the Rate Card, the estimator
  and the Dashboard must all understand it at the same moment. Tasks 1–2 are additive (new functions
  beside the old). From task 3 onward the branch is only coherent as a whole. Merge after task 10.
- **`calc.js` is two byte-identical copies** (`server/src/calc.js`, `web/js/calc.js`). Every edit is
  two edits. The drift test in `test-calc.js` fails otherwise.
- **Gate: `cd server && npm test`** after any server change. New pure functions get worked-example
  tests in `test-calc.js`. Route changes get tests in `test-api.js` (ephemeral port, log in once in
  `test.before`).
- **For money math, check the mutation, not just the green suite**: break the line you wrote,
  confirm a test fails, put it back. Record which mutations you checked in the task's "Done" note.
- **Anything a person looks at is verified in a browser** against the scratch API (`api-scratch`
  in `.claude/launch.json`, login `dev`; re-seed if `/tmp` was wiped). Real mouse clicks in the
  browser pane don't always land, so use dispatched `.click()` and poll on a DOM condition. Measure
  at 1280 / 800 / 375.
- **Above 1100px nothing may move** except the new states. The layout adds no new columns.
- **Leave alone:** the Dashboard's post-ratio readout (`postRatioReadout`, `postMarkup`) keeps
  Capacity's `billableHoursPerDay`. That readout is a capacity-planning average, which is exactly
  what the Service Day is *not*. Travel & Accommodation rows are untouched throughout. The client
  PDF is unchanged (brief decision 9).

---

## Foundation

- [x] **1. Suggested price and unit resolution in `calc.js`** (money math — Opus/high): Add three pure functions, exported in both export shapes, used by nothing yet. `unitHours(pricing, unit)`
- [x] **2. Per-service floor comparison and the legacy `lineDef` fallback** (money math — Opus/high): Add `serviceFloorComparison(pricing, settings, floorPerHour, ctx)` **beside** the
- [x] **3. Schema v9, new defaults, and the shape guard on `PUT /api/pricing`** (money math — Opus/high): This is a data migration of stored prices, so it sits in this bucket and not the
## Core UI

- [x] **4. Rate Card rows on the new shape: unit dropdown, auto and set-by-you prices** (money math — Opus/high): This is the first visible slice, and it sets the look. The aesthetic is the
- [x] **5. Service Day setting, the Show switch, and the hidden-unit notice** (money math — Opus/high): Add the Service Day pair to the Rate Card's settings strip: `Full [8] hrs · Half [4]
- [x] **6. Estimate editor: unit picker, unit switch on the line, rates keyed by unit** (money math — Opus/high): In each labour `.bb-picker`, add a unit `<select>` between the service select and
- [x] **7. Dashboard: day floors from Service Day, one comparison row per service** (money math — Opus/high): In `finance-dashboard.js` `figures()`, headline `halfDay` / `fullDay` become
## Responsive & Polish

- [x] **8. Responsive pass** (frontend — Opus/high): At < 768px: the Rate Card row's unit select, the `· N billable hrs` text and the hidden-unit notice sit under the service name; the state line
- [x] **9. Accessibility pass** (frontend — Opus/high): Per the brief's "Accessibility Requirements":
## Code review fixes (2026-09-29)

From a `/code-review` (xhigh) of the whole branch, including the uncommitted task 8–9 work. There are
14 findings, none fixed yet. They're numbered R1–R14 so tasks 10 and 11 keep their numbers. **R1–R4
are recommended before task 10.** R2 and R3 are deploy-window hazards, and R1 and R4 give wrong
prices or a broken screen on live data. The rest can follow the deploy. Each item names where the
problem is, what goes wrong, and the fix direction. The fix direction is a suggestion, not a
decision. Same gate as every task: `npm test`, both `calc.js` copies, a checked mutation for money
math, and a browser check for anything a person looks at.

### Correctness

- [x] **R1. Auto prices go stale when GST settings change mid-screen** (money math — Opus/high). `estimate-editor.js` mount (`priceCtx = LSCData.priceContext()`, ~l.1610) and `pricing.js` mount
- [x] **R2. The shape guard doesn't cover estimate saves** (money math — Opus/high). `routes/pricing.js` refuses a pre-v9 card (`pricing_shape_outdated`), but `POST`/`PUT
- [x] **R3. The Rate Card accepts a pre-v9 card, and one save wipes every typed price** (money math — Opus/high). `pricing.js` mount (~l.1146) fills in `serviceDay` when the server's card has none,
- [x] **R4. "Reset to defaults" leaves rows without ids, so the unit view collides** (money math — Opus/high; the screen renders computed prices). `reset()` (`pricing.js` ~l.1095) sets `card =
- [x] **R5. Turning "Use rates from last project" off can leave a line unpriced and unit-less** (money math — Opus/high). `markOwn` (`estimate-editor.js` ~l.210) stores `prevSnap = 'none'`
- [x] **R6. "Update to current rates" counts unchanged hourly lines as updated** (money math — Opus/high). `unitDef` always sets `hoursPerUnit`, so `cardSnap` for an hour carries
- [x] **R7. "needs Profit Goals" is wrong when Capacity is the blocker** (frontend — Opus/high). An auto unit with no price is always "no price yet, needs Profit Goals": in the estimator's
- [ ] **R8. Select-on-focus may not survive a mouse click** (frontend — Opus/high; **verify
  first**). Auto price fields call `input.select()` in their focus handler (`pricing.js` ~l.859) so
  that typing replaces the suggestion. In WebKit/Blink, the mouseup after a click-to-focus can clear
  the selection. Typing "150" into "140" could then become "140150", pinned as a typed price.
  Keyboard focus is unaffected. Not verified. Check with a real click in Safari and Chrome before
  changing anything. *Fix direction if confirmed:* suppress the first `mouseup` after focus, or
  select in a `requestAnimationFrame`.

  **Checked in Chrome 2026-09-29, not reproduced there; Safari not checked, so nothing changed.**
  A real mouse click (CDP `Input.dispatchMouseEvent`, puppeteer `mouse.click`) on an auto
  field reading 103, then typing "150", left **150**. The selection survived the mouseup. Safari
  couldn't be driven: `safaridriver` refuses a session until "Allow remote automation" is on in
  Safari's Developer settings, which is the user's to switch on, not an agent's. **Still open:
  a person clicks an auto price in Safari and types.** If it reads "103150", apply the fix
  direction above.

- [x] **R9. The PDF prints a service twice with no unit** (**settled: the user's call**, see the handover's "The PDF keeps service name only"). `server/src/pdf.js` ~l.58 prints only `line.name`,
### Cleanup

- [x] **R10. `dayHoursOk` is duplicated on the server and the web** (money math — Opus/high; touches `calc.js`). It's defined word for word in `routes/pricing.js` ~l.17 and `pricing.js`
- [x] **R11. `money()` is duplicated** (frontend — Opus/high). The same whole-dollar-or-cents formatter is in `pricing.js` ~l.221 and `estimate-editor.js` ~l.165. The estimator's "Full day ·
- [x] **R12. `compare()` runs about 5× per row refresh** (money math — Opus/high; renders computed prices). `stateLineHtml`, `stateSentence` and `rowMetaHtml` (via `unitProblem` ×3) each run the
- [x] **R13. The blur handler does more than it needs; `rewrite()` papers over it** (frontend — Opus/high; a11y). The price field's blur (`pricing.js` ~l.857) runs the whole `refreshRow`, and
- [x] **R14. The temporary `launch.json` entries are still there** (any). `api-v9-scratch` and `web-v9` (`.claude/launch.json` ~l.47) point at a `/tmp` DB and are marked TEMPORARY for task 4.
## Ship

- [x] **10. Deploy: NAS (v9) first, then Pages** (deploy — Sonnet/medium; **ask the user before starting**): Merge `service-rate-tiers` → `main` locally, but **don't push yet**.
## Review

- [x] **11. Design review**: Run `/design-review` against the brief and IA, on the live site after task 10. Write `DESIGN_REVIEW.md` in this folder. Fix must-fixes before closing the track.
### Design review fixes (2026-09-29)

All frontend, `Opus/high` per the bucket list (Sonnet/high would do for D3 and D4, which are CSS
only). None touches money math. Details, screenshots and the suggested fix for each are in
`DESIGN_REVIEW.md`; these are the checklist.

- [x] **D1. The Service Day error shows a page away from the field.** Add an inline `role="alert"` reason inside the Service Day block and point the two fields' `aria-describedby` at it. Keep the
- [x] **D2. The state line wraps into dangling `·` separators at ≥1100px.** Stack the parts and hide the separators in that band. Check 1100, 1280 and that 768 and phones are unchanged.
- [x] **D3. The Show switch's selected state is border hue only.** Fill the pressed button with `var(--surface)`. _Modifies: `pricing.css`._
- [x] **D4. The estimator's unit select is sized by its longest option**, so Add doesn't line up between categories. One fixed width above 768px. _Modifies: `estimates.css`._