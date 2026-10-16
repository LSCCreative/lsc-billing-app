# LSC Billing App

Quoting/invoicing tool for LSC Creative: a static site on GitHub Pages (`web/`) plus a Node/Express/
SQLite API on the user's NAS (`server/`). **Live and fully built**; only the open work in the roadmap
remains.

## What to read

1. **This file**, then [`.design/ROADMAP.md`](.design/ROADMAP.md): what is live, what is open, what
   waits on the user.
2. [`.design/WORKING_NOTES.md`](.design/WORKING_NOTES.md): settled rules and traps. Skim before touching
   money math, estimates, projects, public pages or the frontend.
3. Only when relevant: [`.design/own-kit/`](.design/own-kit/TASKS.md) (the track being built next: brief +
   tasks) and [`.design/estimate-accuracy/TASKS.md`](.design/estimate-accuracy/TASKS.md) (the other open
   build work), [`.design/DEPLOYMENT.md`](.design/DEPLOYMENT.md) (only to deploy),
   [`web/README.md`](web/README.md) (only when changing the frontend: file map and conventions).

**Do NOT read `Project build archive/`** (and don't grep into it) unless there is a critical problem
or misunderstanding that the files above can't settle: for example a built feature behaves in a way
you can't explain and its original design, decisions or build notes would. It holds the finished
tracks' briefs, decisions, task lists, handovers, reviews, a per-track summary
(`Project build summary archive.md`) and local screenshots. Nothing there is needed to keep building.
Code comments that cite `.design/<track>/` point into that archive.

## Two codebases in this repo

- **`server/`**: Node/Express + SQLite API, tested with `node --test` in `server/test/`. Run `npm test`
  in `server/` after any change; it is the acceptance gate.
- **`web/`**: the static frontend, no build step. `server/src/calc.js` and `web/js/calc.js` must stay
  byte-identical (also `documents.js`, `call-sheet.js`); a drift test fails otherwise.
- `index.html` / `main.js` / `preload.js` at the repo root are the retired Electron app (git-ignored).
  Don't touch them.

## Architecture (short)

Different origins, so CORS (`CORS_ORIGINS`) and cross-site cookies (`COOKIE_SAMESITE=none`, `Secure`;
API over HTTPS through a Cloudflare Tunnel). Site `app.lsccreative.studio`, API
`billing.lsccreative.studio`. The security bar is deliberately low (the user's conscious call): don't
re-raise it, but keep internal figures (floors, tax set-aside, take-home, Cost Breakdown) off every
public route. Client pages (`web/c/`) are light, in the colours of lsccreative.studio.

## Model / effort

Say the bucket out loud before starting a task and pause for the user to switch if needed. If it is a
**frontend task** (it builds or changes anything a person looks at), say so with a bold **Frontend
task** flag so the user can load the design skills first.

- Money math (`calc.js`, GST, tax, stored or printed prices) or auth/session code: `Opus, effort:
  high`, however small the diff.
- UI / frontend: `Opus, effort: high`.
- Backend routes, tests, config: `Sonnet, effort: high`.
- Deploy / Docker / Cloudflare: `Sonnet, effort: medium`.

If unsure, ask rather than defaulting to the cheapest.

## Deploying

**Ask the user first.** Pushing `main` deploys Pages. Any server change that adds a boot-time route or
migration deploys **NAS before Pages**. Fetch and diff `origin/main` before any copy or push. Steps in
`.design/DEPLOYMENT.md`.

## Keeping the docs small

When a task finishes: tick it, update `ROADMAP.md` (live state, open items, waiting-on-user), and add
any new standing rule or trap to `WORKING_NOTES.md` in a line or two. Don't write per-task build logs;
git history is the record. When a track is finished and live, move its folder into
`Project build archive/tracks/` and add a short entry to `Project build summary archive.md`. Superseded
docs are deleted, not kept in `.design/`.

## Credentials for agents

Prefer 1Password (see **Secrets & SSH** below). Legacy NAS and billing-app logins still live in
`.credentials.local.md` at the repo root (gitignored; the repo is public, so passwords never go in
tracked files). Don't read that file unless a task needs it; migrate its entries into a 1Password
Environment and delete it when convenient.

## Secrets & SSH (1Password MCP)

The `1password` MCP server is configured in `.mcp.json` (command `1password-mcp`, STDIO; no secrets in the
file, safe to commit). It exposes 1Password **Environments** tools: `list_environments`, `list_variables`
(names only), `list_local_env_files`, `append_variables`, `create_environment`, `rename_environment`,
`create_local_env_file`, `authenticate`. First use needs approval in the 1Password desktop app.

- **Never** put API keys, tokens, passwords or private keys in tracked files, chat, scratchpads or logs.
  Store them in a 1Password Environment and reference them by variable name.
- To run something that needs secrets, use `create_local_env_file` (a locally mounted `.env` backed by
  1Password) and let the app/process read it. Don't `cat`/print/commit that file, and don't paste values
  into responses.
- Add a new secret with `append_variables`; ask the user before creating or renaming Environments.
- **SSH keys are not part of this MCP.** Use the 1Password SSH agent (enable in 1Password > Settings >
  Developer > "Use the SSH agent"; keys then authenticate via Touch ID). Never read, copy or generate
  private keys into the repo; ask the user to run any `ssh`/`git` command that needs a key approval.
