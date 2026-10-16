# Handover: Estimate Accuracy

Read this first, then [`TASKS.md`](TASKS.md). This track follows the money-logic audit of
2026-09-30. It sits on top of [`.design/price-calculator/`](../price-calculator/) and
[`.design/service-rate-tiers/`](../service-rate-tiers/), and those stay the authority for every
decision this one does not explicitly overturn.

**Build bucket: `Opus, effort: high`** for tasks 3, 5, 6 and 9–14 (all money math; 8 is scrapped). Tasks 1 and 2
are wording only (Sonnet/high), task 7 is UI (Opus/high), 15 is Sonnet/medium. The list was written
on a Sonnet session, so **switch model before starting any money-math task.**

## What this is

An audit traced the whole chain (overhead → capacity → goals → rate card → estimate) through the real
`calc.js` and found the arithmetic sound: every step reconciles, all 253 server tests pass, and no
invoice figure is wrong. It did find three inaccuracies in explanations and advisory lines, four
settings, and seven gaps in what an estimate can express. `TASKS.md` lists all of them as 16 tasks.

## State as of 2026-09-30

- [x] **Audit** — done; findings and sample figures are under "Source" in `TASKS.md`.
- [x] **Task list** — written.
- [x] **Grill Me on task 6** — done 2026-09-30. It became "travel priced properly" (6a / 6b); the
      decisions are in `TASKS.md` under task 6.
- [x] **Task 8 scrapped** by the user, 2026-09-30 (see decisions below).
- [ ] **Grill Me** on tasks 9–14 — **not done.** Every one carries an open decision and a
      recommendation that is mine, not the user's. Do this before building any of them.
- [ ] **Build** — in progress.
      - [x] Task 1 — Capacity's stale "Full-day hours" block replaced by a pointer to the Service
            Day (2026-09-30). See its Done note.
      - [x] Task 2 — Target Markup hint now says it sets every auto price (2026-09-30). See its
            Done note; the Dashboard and Rate Card needed no change.
      - [x] Task 3 — direct costs (`passThroughCost`, `directJobCost`) are ex-GST on a
            GST-inclusive card (2026-09-30, Opus/high). 257 tests pass, six mutations checked, and a
            19,520-case sweep against the old `calc.js` moved nothing else. The detail row reads
            "Pass-through Cost (ex GST)" when GST was charged. See its Done note for three open
            seams.
      - [~] Task 5 — **(a) done** (2026-09-30): the default card marks Transport & Logistics Hrs
            `ownTime: true`; 262 tests pass. The `JOB` fixture now pins its own card so it keeps
            testing resold travel. **(b) open:** the live Rate Card's box still needs ticking, by
            the user or with their go-ahead.
      - [x] Task 6a — own-time travel priced from the floor, auto, no markup (2026-09-30,
            Opus/high): `travelRowDef` / `travelFloorComparison` in `calc.js`; Rate Card state
            line; Dashboard rows; editor picker; `PRICING_SHAPE` → `'travel-auto'`, now also
            required on the card. 277 tests pass and 12 mutations were checked. See its Done
            note. **Deploy NAS then Pages back to back.**
      - [x] Task 6b — the car per km, at cost (2026-09-30, Opus/high): migration **v10**
            (`goals.vehicle_cost_per_km`); a Vehicle — cost per km block on Overhead; a `perKm`
            travel row priced from it (`travelRowDef`), billed as a pass-through; Fuel & Tolls →
            Tolls & Parking; double-count hints; `PRICING_SHAPE` → `'travel-km'`. 288 tests pass
            and 16 mutations were checked. **Task 6 is done.**

Tasks 1–3, 5(a), 6a and 6b are **uncommitted and not deployed**, on branch **`estimate-accuracy`** (created
2026-09-30 from `main` at `418b6ab`; the uncommitted work came across with it). **Deploy order: NAS
then Pages, back to back** — 6b adds migration v10 and 6a/6b bump `PRICING_SHAPE`, so between the
two the live Pages can't save the card or an estimate (it's told to reload), as at v9. The scratch DB
in `/tmp/lsc-billing-scratch` is now at v10. The
working tree also holds `web/index.html` and `web/favicon.png` changes, plus edits to `CLAUDE.md` and
`.design/price-calculator/HANDOVER.md`, that were there before this track and are not part of it.

**Exact next item: `/grill-me` on tasks 9–14** — every remaining money task carries an open
decision. Task 11 (loadings) is being replaced by the user's surcharge + production-booking request
of 2026-09-30; see [`.design/production-booking/`](../production-booking/HANDOVER.md). Task 7 (relabel the Overhead
"Tax" category, frontend, Opus/high) needs no decision and can be built any time. 5(b) and the
other post-deploy steps are in task 6b's Done note and wait on a deploy and on the user.

## Decisions the user made on 2026-09-30 (don't re-ask)

- **The FY 2026–27 tax scale is saved on the live site.** Reported by the user; unverified. Task 4
  checks it and records the live income floor here as the reference for later before/after figures.
- **Transport & Logistics Hrs is "Your time"** — it is the user's own hours. Task 5 sets the default
  card; the live Rate Card box still has to be ticked (the user, or an agent with the go-ahead).
- **Keep income tax out of the Overhead "Tax" category** — agreed. Task 7 relabels and adds a note.
  The user must also clean any income-tax items already in that category on the live Overhead list.
- **The three "wrong" items and the "accuracy fields" are to be built** — all seven are in the list.
  The user did not pick between them, and did not decide any of their open questions.

- **Task 8 (expected booking rate) is scrapped.** The user is "not ready for such an advanced way
  of pricing". The income floor keeps assuming every billable hour sells, and the 25% Target Markup
  keeps covering unsold time as well as profit. That is known and accepted; don't re-propose it.

- **Task 6 grilled (2026-09-30), and grown.** Travel time is auto-priced at exactly the income
  floor (no markup) and can be typed over, with a badge under the floor. The car is recovered by a
  separate at-cost km line, whose full-running-cost per-km figure lives only on Overhead. Fuel &
  Tolls becomes Tolls & Parking, and a double-count warning is added. The full list is in `TASKS.md`
  task 6, decisions 1–9, plus the untick rule in 6a.

## Things a fresh agent will want to argue with

- **Task 6 doesn't really overturn price-calculator decision 6.** That decision excluded travel as
  a pass-through, and an `ownTime` row isn't one. The user approved own-time rows joining the
  comparison (2026-09-30). The km row is at cost and stays out.
- **Task 14 reopens service-rate-tiers decision 13.** Decision only until the user says go.
- **Pass-throughs are never discounted or marked up unless a task says so** (tasks 10 and 13 are the
  exceptions and both are decisions). The current rule — crew, hire and direct travel are billed at
  cost and are not income — is the model, not an omission.

## How to verify your work

As for the earlier tracks: `npm test` in `server/`; identical `calc.js` in both copies (the drift
test); for money math, break the line and confirm a test fails. Each Group C task has a worked
example in `TASKS.md` on the audit's sample figures; put it in `test-calc.js` as written.
