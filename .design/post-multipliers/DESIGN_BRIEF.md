# Design Brief: Per-service post multipliers (Deliverable Types)

Track `post-multipliers`, the user's request 2026-10-20, grilled the same day. Money math (calc.js
`postPlan`, hours that become billed) + **Frontend task**: `Opus, effort: high`.

## Problem

A Deliverable Type on the Rate Card ("Plans post-production") has one multiplier for the whole
deliverable, but its post services don't scale alike: a Brand Story's edit might need 2 hours per
capture hour while its colour grade needs 0.5. Today the owner can't say that, and the estimate lays
the post lines out at 0 hrs with one lump recommendation the owner then splits by hand. On top of
that, the block shows every type's name, description, chips and fields at once, so a card with several
types is a wall of inputs.

## Solution

Each post service on a type carries its own multiplier. On an estimate, picking a type adds its post
lines **with their hours already filled in** (capture hours × that service's multiplier × the
deliverable's qty, each line rounded up to 0.5 hr), and they keep following capture as the shoot is
built: add an hour of videography and the edit and grade grow with it. Typing over a line's hours makes
it the owner's; it stops following.

On the Rate Card the block becomes a tidy list of one-line summaries: **Brand Story · 4 post services ·
3.5 post hrs per capture hr**. Opening a type (one at a time) reveals its name, description, its post
services as a list with a multiplier field each, "+ Add service" and Remove type.

## Settled decisions (grill 2026-10-20)

| # | Decision |
|---|---|
| G1 | Post lines are **filled and follow capture**: hours = captureHours × service multiplier × deliverable qty, rounded **up to 0.5 hr per line**. They update whenever capture or qty changes. |
| G2 | A line whose hours the owner types over stops following (it is the owner's). **No visual marker** for following vs typed; re-picking the type is the way back. |
| G3 | Only lines priced **by the hour** are filled. A post service laid out on another unit (half/full day) is added at 0 with its recommended hours shown, as today. |
| G4 | The type-level `multiplier` goes. A type's services become `{ name, multiplier }`; the type's total is the sum. |
| G5 | Migration: every existing type's services start at **0×** (the user re-enters them). A service added to a type from now on starts at **1×**. |
| G6 | Collapsed summary: `Name · N post services · X post hrs per capture hr` (X = Σ multipliers). |
| G7 | **One type open at a time.** A new type opens straight away; a save problem opens the type it's in. |
| G8 | Picking a type **snapshots** each service's multiplier onto its post line, like a price: a later Rate Card change never moves a started estimate. |
| G9 | Saved estimates never change on open: post lines saved before this track count as typed (they don't follow). Following/typed state is saved on the line and survives save + reopen. |
| G10 | The deliverable row's "Post hrs (rec.)" = Σ its services' recommendations; the planner cell's "On post lines X of Y recommended" stays. A 0× service is still laid out at 0 hrs (and doesn't print, the 9a rule). |

This **replaces** the B2 principle "suggest, don't price" for post lines laid out by a type: their filled
hours are billed unless typed over. Record that in `WORKING_NOTES.md` when built.

## Experience Principles

1. **Summary first, detail on demand** -- The block reads as a short list of types; every field lives
   behind its type's row and only one is open at a time.
2. **The quote builds itself, the owner has the last word** -- Filled hours follow the shoot without
   asking; one typed number overrides them, silently and for good.
3. **A started estimate never moves under you** -- Multipliers snapshot when the type is picked; old
   estimates open exactly as saved.

## Aesthetic Direction

- **Philosophy**: the app's own system (dark warm surfaces, terracotta accent, LSC Metro Sans, mono
  figures). Extend the Rate Card's `billing-block` / `dtype-*` vocabulary; nothing new in look.
- **Tone**: calm, ledger-like, quiet. Settings, not a feature showcase.
- **Reference points**: the Rate Card's own tables and the editor's planner cell; a settings list
  where each row is a summary that opens in place (macOS System Settings rows, Linear's settings lists).
- **Anti-references**: card grids, heavy accordions with big shaded headers, chips with inputs crammed
  inside them, anything animated for show.

## Existing Patterns

- Typography: `--font-family-body` (LSC Metro Sans) for text, `--font-figures` (mono) for the summary
  figures and multiplier inputs; `--font-size-base` rows, `--font-size-sm` meta, `--font-size-md`
  inputs below 768 (no iOS zoom).
- Colors: `--color-bg-panel` block, `--color-bg-inset` for the open type's panel and inputs,
  `--color-border-hairline` between rows, `--color-border-strong` field edges, `--color-border-focus`,
  `--color-text-secondary` for the summary meta, `--color-status-warning-text` for a "missing" flag.
- Spacing: the tokens in `web/css/tokens.css`; match the existing `.dtype-row` padding.
- Components: `.billing-block` + `.bb-head`, `.dtype-*` rules (pricing.css:895–1210), `.del-btn`,
  `.btn-ghost.btn-sm`, `LSCInfo` ⓘ, `LSCUtil.announce` with `#pricing-floor-live`, the
  `aria-expanded` disclosure buttons used by panel.js / menu.js.

## Component Inventory

| Component | Status | Notes |
| --------- | ------ | ----- |
| Deliverable Types block (`typesMarkup`) | Modify | Intro copy rewritten for per-service multipliers and filled hours. |
| Type summary row | New | A `<button aria-expanded>` holding name, service count, Σ post hrs per capture hr, a chevron; a "N missing" flag when services left the card; "untitled type" when blank. |
| Type detail panel | New (from today's row) | Name + description fields, the service list, "+ Add service", Remove type. |
| Service list row | New (replaces chips) | Service name, a multiplier number field ("× capture hr"), remove ×; a missing service struck through, as the chip is today. |
| "+ Add service" select | Modify | Lives inside the open panel only; adds at 1×. |
| Column head (`.dtype-head`) | Remove | The summary rows don't need columns. |
| Validation (`typeProblems`) | Modify | Per-service multiplier: a number ≥ 0, ≤ 2 decimals; opens the type that has the problem and focuses the field. |
| Editor deliverable row / `layOutPost` | Modify | Snapshots per-service multipliers onto lines; fills hourly lines. |
| Post line follow logic | New | Recomputes following lines on every recalc; a typed edit pins the line. |
| Planner cell / deliverable "Post hrs (rec.)" | Modify | Sums per-service recommendations. |
| `calc.js` `postPlan` (both copies) | Modify | Per-line recommendation from the line's own multiplier; old single-multiplier deliverables still work. |
| Server `deliverableTypesOk` + migration | Modify | New service shape; schema bump moves `services: [name]` → `[{ name, multiplier: 0 }]` and drops the type multiplier. |

## Key Interactions

**Rate Card**
1. The block loads with every type collapsed. Each summary row shows `Brand Story · 4 post services ·
   3.5 post hrs per capture hr`.
2. Click/Enter/Space on a summary opens it (`aria-expanded="true"`), closing any other open type. The
   panel opens in place under its row; focus stays on the summary button. Click again to close.
3. In the open panel, each service has its multiplier field. Typing updates the summary's total live.
4. "+ Add service" picks a post service not yet listed; it joins the list at 1×, the select returns to
   "+ Add service" for the next one, and the summary count updates.
5. × on a service removes it from the type (no confirm: nothing is lost that isn't one click back).
6. Remove type confirms when the type has services, then focus goes to the next type's summary (or
   "+ Add deliverable type").
7. "+ Add deliverable type" adds one, opens it and focuses its Name.
8. Save Services with a problem opens the type it's in and focuses the field, using the screen's
   existing problem list.
9. Renaming a post service in the Post-Production table above still renames it on every type
   (chipRows), and its multiplier stays with it.

**Estimate editor**
1. Picking a type on a deliverable adds its post lines; hourly ones get filled hours, others 0.
2. Adding, changing or removing capture lines, or changing the deliverable's qty, updates every
   following line's hours (and the totals) in the same recalc.
3. Typing a line's hours pins it; it never follows again unless the type is re-picked.
4. Changing or removing the type still removes its lines, confirming when any has hours. Filled hours
   count as hours for that confirm.

## Responsive Behavior

- ≥1100: summary row on one line: name left, meta (count · hrs per capture hr) right-aligned in mono,
  chevron at the end. The open panel is a two-column layout: name + description left, service list right.
- 768–1099: same summary row; the open panel stacks (name, description, then the service list).
- <768: the summary wraps to two lines (name, then meta). Service rows stay one line (name, multiplier
  field, ×), with the name truncating. Inputs at `--font-size-md`; tap targets ≥ 44px.

## Accessibility Requirements

- Summary is a real `<button>` with `aria-expanded` and `aria-controls` pointing to its panel; the
  panel has `role="region"` labelled by the type's name.
- The summary's accessible name reads in full: "Brand Story, 4 post services, 3.5 post hours per
  capture hour".
- Each multiplier field has a label naming the service and type ("Edit multiplier for Brand Story")
  and a described-by unit ("post hours per capture hour").
- Opening, closing, adding and removing are announced through `#pricing-floor-live`.
- Removing the focused service or type moves focus to the next sensible control, never the page.
- Contrast: summary meta in `--color-text-secondary` (passes on `--color-bg-panel`); focus rings use
  `--color-border-focus`; "missing" says so in words, not colour alone.

## Out of Scope

- A per-line "auto" marker or "use recommended" reset in the editor (G2: none).
- Converting hours into half/full-day quantities for non-hourly post services (G3).
- Per-deliverable overrides of a service's multiplier on the estimate (edit the line's hours instead).
- Reordering services within a type, or types within the block.
- Any change to capture ticks, the Production section, client documents or public pages (post lines
  print as they already do).
- Deploying: that is its own task, asked for first, NAS before Pages.
