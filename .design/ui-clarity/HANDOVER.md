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
- **Phase 6** (build) on branch **`ui-clarity`** (off `production-booking`, unpushed, not deployed).
  - [x] Task 1, tokens live (`07df49a`). `tokens.css` loads first in `web/index.html`, and in
    `web/c/index.html` with `<html data-theme="light">` (c.css's names now alias the tokens). No
    raw hex left in the screen CSS except Overhead's measured chart palette and warm-white alphas.
    Funnel Sans is deleted. Inputs moved to `--input-bg` / `--input-border` in app.css and wherever
    they used the old `#1a1c20` well; other inputs still read `--surface`/`--border` (task 13).
  - [x] Task 2, buttons and panels. Plain `.btn` **is** the secondary button (`.btn-secondary`
    needs no rule); `.btn-accent` = `.btn-primary`; `.btn-ghost` = quiet plus a hairline ring (kept
    for rows of document actions until tasks 9–10 move them into menus); `.btn-xs` = `.btn-sm`.
    Edges are inset shadows, so focus (`--shadow-focus`) replaces them. Panel markup and the
    collapsible variant are documented in `app.css`'s Panels comment; `web/js/panel.js` turns
    `.panel-toggle`s and fires `lsc:panel` ({open}) for task 11's remembered states and task 12's
    rail. Panels carry no margin (containers set `--panel-gap`); the legacy `.billing-block`,
    `.est-block`, `.pricing-section` keep a margin-bottom. `tokens-preview.html` now loads the real
    `app.css` and `panel.js` instead of copies.
  - [x] Task 3, the menu button (`2e1bd3f`). `web/js/menu.js` + `web/css/menu.css`; API in
    menu.js's header. `LSCMenu.markup({ label, items, ariaLabel?, icon?, btnClass? })` returns ''
    when nothing is available, so tasks 9–10 can concatenate it unconditionally. Items are
    `{ text, hint, danger, href, download, attrs }`, `'-'` or falsy; danger items are moved last
    below a divider automatically. `LSCMenu.open(opener, { label, items, onSelect, empty })` is for
    lists built on the spot (the editor's Move to and Add to a day use it; `.move-pop` is gone).
- **Next: task 4, "Agreement clauses and the one render"** (signing — Opus/high). Not a frontend
  task (server + `documents.js` + tests); task 5 after it is **Frontend**.

## Waiting on the user

- **The logo file** (for D2), PNG or SVG.
- **The Metro Sans licence:** confirm that web embedding is allowed (the repo is public), and that
  it's a bought licence: the installed copy is a Fontspring demo, which is never licensed for web.

## Decisions made in the build (tell the user)

- **D86 overridden by U17:** the editor's Deliverables block lost its terracotta border and tint
  (production-booking D86 made it the one non-neutral block). It is a plain panel now.
- **Invoice:** while extras are unsaved, Save extras takes the terracotta and the header's primary
  (Send…, Mark paid…) drops to secondary, so the view keeps one.
- Secondary "+ Add service / deliverable / date", Download CSV and the Cost Breakdown's Close are
  no longer terracotta. Title Case UI labels in `web/js/views` are sentence case now (data
  defaults like "New Service" untouched).

## Traps

- **Menus (task 3):** an open list is moved into `<body>`, and a chosen declarative item is put
  back and `.click()`ed in place, so a screen's delegated `data-act` handler must listen on a
  container that holds the *closed* menu, not on the list. menu.js listens in the capture phase
  and stops Esc there, so Esc in a menu inside a dialog closes only the menu.
- Move to keeps its "No other day yet…" note (`open()`'s `empty`): its button is per line and
  exists before any day does. "A menu with no items isn't drawn" is `markup()`'s rule.
- **Screenshots:** a puppeteer `clip` capture resizes the viewport to 1×1 for a frame, which
  flips the 767px query (and restarts the menu's fade). menu.js ignores flips that don't settle
  (150ms); take menu shots with `captureBeyondViewport: false` and no clip.

- **The studio Mac has a Fontspring DEMO of Metro Sans installed** (`~/Library/Fonts/fontspring-demo-*`):
  its glyphs for `( ) - @` and some digits are `±`. Chrome falls back to an installed font of the
  same family name when a web font file 404s, so `tokens.css` names the face **'LSC Metro Sans'**.
  Keep that name. The masters in `Visual Design/` are the full family (checked).
- Screenshots: `node <scratch>/shots.js` pattern (headless Chrome via `server/node_modules/puppeteer-core`,
  in-page login, computed-colour scan for old palette values). `screenshots/` stays local, uncommitted.

- `.sum-label` is the mono caps figure label now; `.tax-setting .sum-label` scopes it back to a
  sentence-case title (Rate Card, Goals reuse it as a setting name).
- Metro Sans has **no tabular figures**: money uses `--font-figures` (mono), U24.
- `tokens.css` declares Metro Sans at `../fonts/MetroSans-{400,500,600}.woff2`. Copy and rename them from
  `Visual Design/Metro-Sans---Full-Family/Metrosans * Webfont/` only once the licence is confirmed.
  Until then the browser logs a font error and falls back to the system sans.
- The Desktop Preservation Law in `app.css` is retired (U16). Rewrite that header comment when
  tokens land.
