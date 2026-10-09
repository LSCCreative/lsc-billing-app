# Handover: Trip Planner, Google Calendar and Editor Autosave

Read this, then [`DECISIONS.md`](DECISIONS.md) (T1–T18, G1–G5, I1–I4, the user's; don't re-ask), then
[`DESIGN_BRIEF.md`](DESIGN_BRIEF.md).

**Model: Opus, effort high. Frontend task** (also writes priced travel lines → money bucket).

## State as of 2026-10-08

Running through `/design-flow`:
- [x] Phase 1 Grill Me: decisions in DECISIONS.md.
- [x] Phase 2 Design Brief: `DESIGN_BRIEF.md` (Google Calendar added before IA, G1–G5).
- [x] Phase 3 Information Architecture: `INFORMATION_ARCHITECTURE.md` (incl. the Data & API appendix). "Travel brief" is now **Call sheet** (I4).
- Phase 4 Design Tokens: **skipped** (ui-clarity's `tokens.css` covers it).
- [x] Phase 5 Brief to Tasks: `TASKS.md` (20 tasks, stages A trip planner → B autosave → C call sheet → D Google Calendar → E polish/review/deploy).
- [ ] **Phase 6 Build: next is task 1** (trip storage and the km/hours rule, *money: Opus/high*), on branch `trip-planner` off `ui-clarity` (not created yet).

## Google setup (done 2026-10-08)

Two keys in Cloud project *LSC Production Decks*: **LSC Billing — browser** (website-restricted,
4 APIs) and **LSC Billing — server** (Maps Static only). Values are in `.credentials.local.md`
only. Still open: a default-style Map ID (ask first), whether billing is enabled (unverified;
the console's billing page didn't load in the panel), and a $1 budget alert.

Google Calendar: the Calendar API is enabled, and the consent screen is Internal ("Production Decks", shared,
left unchanged). The OAuth client "LSC Billing — NAS calendar" (Web application, two redirect URIs,
see G1) was filled in but **not confirmed created**. The agent was blocked from reading its
secret, correctly. **The user creates it and pastes the client ID and secret into
`.credentials.local.md`.** Check `/auth/clients` for a duplicate before creating another.

## Traps

- The repo is public. Keys never go in tracked files. The browser key reaches Pages through a
  GitHub secret written into the gitignored `web/js/config.js` by `deploy-pages.yml`.
- The browser key only works from `https://lsccreative.github.io/*` and `http://localhost:5173/*`
  (the console refused a wildcard port). Local previews on other ports need a row added.
- Autosave vs `backup.js` preWriteBackup: every mutating request snapshots the whole DB. Autosave
  PUTs must be throttled (I2), or recovery points collapse to seconds.
- New schema (v16): NAS before Pages, and the NAS is offline as of 2026-10-08.
