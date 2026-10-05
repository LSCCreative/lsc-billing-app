# Handover: UI Clarity

Read this file, then [`DECISIONS.md`](DECISIONS.md) (the user's answers U1–U23; don't re-ask), then
[`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) and [`INFORMATION_ARCHITECTURE.md`](INFORMATION_ARCHITECTURE.md).

## What this is

There are three requests from the user, built as one track:
- **D1:** the UI is too busy. A new panel system, Actions ▾ and Documents ▾ menus, and a rework of
  the Project page, Invoice screen and Estimate editor.
- **D2:** branded emails, with the logo and "LSC Creative" in a light shell.
- **D3:** a modular service agreement builder in Settings, with drag-to-reorder,
  auto-numbering and lettered sub-clauses.

The work runs through `/design-flow`. **Model: Opus, effort high. Frontend task.**

## State as of 2026-10-06

- **Phase 1** (Grill Me): done. The answers are in DECISIONS.md.
- **Phase 2** (Design Brief): done, in `DESIGN_BRIEF.md`.
- **Phase 3** (IA): done, in `INFORMATION_ARCHITECTURE.md`. It covers the menu contents for
  every state, the editor's six panels, the agreement data shape and the `agreementText` render
  seam.
- **Phase 4** (tokens): done. `web/css/tokens.css` exists but is **not loaded yet**: wiring it
  into `index.html` and deleting `app.css`'s and `a11y.css`'s own `:root` values is build task 1.
  `.design/ui-clarity/tokens-preview.html` is the specimen. Open it with launch.json's `design`
  server at `/.design/ui-clarity/tokens-preview.html`.
- **Phase 5** (tasks): done, in `TASKS.md` (18 tasks).
- **Next: Phase 6, build task 1, "Tokens live, palette and type across the app"** (frontend —
  Opus/high). **Frontend task.**

## Waiting on the user

- **The logo file** (for D2), PNG or SVG.
- **The Metro Sans licence:** confirm that web embedding is allowed. The repo is public.

## Traps

- Metro Sans has **no tabular figures**: money uses `--font-figures` (mono), U24.
- `tokens.css` declares Metro Sans at `../fonts/MetroSans-{400,500,600}.woff2`. Copy and rename them from
  `Visual Design/Metro-Sans---Full-Family/Metrosans * Webfont/` only once the licence is confirmed.
  Until then the browser logs a font error and falls back to the system sans.
- The Desktop Preservation Law in `app.css` is retired (U16). Rewrite that header comment when
  tokens land.
