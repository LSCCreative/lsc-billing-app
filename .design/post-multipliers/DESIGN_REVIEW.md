# Design Review: Per-service post multipliers

Reviewed against: DESIGN_BRIEF.md (G1–G10)
Philosophy: the app's own system (dark warm surfaces, terracotta accent, LSC Metro Sans, mono figures)
Date: 2026-10-21 (PM10)

Captured headless (the server's puppeteer-core + local Chrome) on a throwaway copy of the v18 review
dataset migrated to v19 (own API :8095, web build from `HEAD` on :5199), never the scratch DB. The
card had Brand Story at 2 / 0.5 / 0.3 plus a service no longer on the card, Socials at 0.5 and Photo
Set at 1. The estimate (REV-021) had 10 h of capture, two typed deliverables, a following line, a
pinned line and a full-day line. Line prices of $60 are the test data's, not the app's. The app is
dark only (light is opt-in, client pages), so there is no second theme to capture.

## Screenshots Captured

Local only (`.design/*/screenshots/` is git-ignored), in `.design/post-multipliers/screenshots/`.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `review-types-closed-desktop-1280.png` | Desktop 1280 | Block, every type closed: one-line summaries |
| `review-types-open-desktop-1280.png` | Desktop 1280 | Brand Story open: two-column panel, a missing service |
| `review-types-focus-summary-desktop-1280.png` | Desktop 1280 | Keyboard focus on the next summary |
| `review-types-problem-desktop-1280.png` | Desktop 1280 | Refused save: 0.125 flagged, its type open |
| `review-types-problem-message-desktop-1280.png` | Desktop 1280 | The save bar's sentence naming service and type |
| `review-types-empty-desktop-1280.png` | Desktop 1280 | Every type removed (unsaved): empty text, focus on "+ Add deliverable type" |
| `review-ratecard-fullpage-desktop-1280.png` | Desktop 1280 | The whole Rate Card, for context |
| `review-types-closed-tablet-768.png`, `review-types-open-tablet-768.png` | Tablet 768 | One-line summaries, stacked panel |
| `review-types-closed-mobile-375.png`, `review-types-open-mobile-375.png` | Mobile 375 | Two-line summaries, service rows on one line |
| `review-editor-deliverables-{desktop-1280,tablet-768,mobile-375}.png` | All three | Deliverable rows with "Post hrs (rec.)" 28 and 15 |
| `review-editor-post-{desktop-1280,tablet-768,mobile-375}.png` | All three | Planner (10 capture, 43 recommended, 29 on lines) and the post lines |
| `review-editor-fullpage-desktop-1280.png` | Desktop 1280 | The whole editor, for context |

## Summary

The track delivers the brief. The Rate Card block reads as a short ledger of types, with
every field behind one open type. The editor fills and follows exactly as G1–G3 and G10 say, and
every state the brief names is present. Nothing must or should be fixed. The few polish notes
below are small, and two of them predate this track.

## Must Fix

None.

## Should Fix

None.

## Could Improve

1. **Two "×" per service row at 768 and up.** The unit "× capture hr" and the remove "×" sit about
   40px apart in the same muted grey (`review-types-open-desktop-1280.png`). They read correctly in
   context, and the remove button is named in full for assistive technology. _Suggestion: if it ever
   confuses, give the remove control the `.del-btn` glyph weight, or say the unit as "per capture hr"
   with the "×" kept only in the field's own column. The brief chose the "× capture hr" wording, so
   ask before changing it._
2. **A missing service truncates hard on phones.** "No Longer On Ca… MISSING" at 375
   (`review-types-open-mobile-375.png`): the flag keeps its width and the name gives way, as designed.
   _Suggestion: below 768, put the MISSING flag under the name instead of beside it._
3. **The error and focus edges are close in hue.** A focused field that is refused shows
   `--err-text` (rgb 240,138,126) where focus is `--color-border-focus` (#E08B68)
   (`review-types-problem-desktop-1280.png`). The sentence above says it in words and the field is
   `aria-invalid` and described by that sentence, so nothing rests on colour. This is app-wide
   (tokens), not this track's.
4. **Phone deliverable rows: fields start at uneven left edges** (Name, Format and Length each
   follow their own label's width; `review-editor-deliverables-mobile-375.png`). This predates this
   track (production-booking B2); a fixed label column would align them.

## What Works Well

- **Summary first, detail on demand (principle 1).** The closed block is a calm ledger. Names lead,
  the figures sit right in mono, and the chevron is last. Open, the row and panel share
  `--color-bg-inset`, so the panel reads as the summary grown down, with no heavy accordion header
  (`review-types-open-desktop-1280.png`).
- **The states are complete and in words.** "1 missing" in the summary, struck through plus MISSING in
  its row; a refused save that names the service and type, opens the type and focuses the field;
  an empty block with its own sentence; focus that never drops to the page.
- **Responsive by reorganising, not shrinking.** Two columns from 1100, stacked from 768, two-line
  summaries and 44px rows on phones. The phone hides "× capture hr" so names keep their room (PM7),
  and a wrapped summary never leaves a dangling "·".
- **The editor says what it bills.** Following and pinned lines look alike (G2, deliberately), and the
  planner's "On post lines: 29 of 43 recommended" carries the gap. A full-day line shows
  "· 15 hrs recommended" beside its unit, on its own line on phones (G3,
  `review-editor-post-mobile-375.png`).
- **Nothing new in look.** Every rule extends `.dtype-*`, `.billing-block` and the existing tokens; no
  one-off colours, radii or shadows were added.
