# Resume prompt

Paste this verbatim into a new chat in this project directory to pick up the work.

---

Read `CLAUDE.md`, then `.design/nas-hosted-billing/HANDOVER.md`, then
`.design/nas-hosted-billing/TASKS.md`. This is a multi-session overhaul of the LSC Billing App
from an Electron desktop app into a website (GitHub Pages frontend + NAS-hosted API/SQLite) —
you are picking up mid-build, not starting fresh.

Before doing anything:
1. Confirm what's actually done by running `cd server && npm test` — don't trust the docs alone,
   they can drift. Reconcile TASKS.md against the test output if they disagree, and update
   TASKS.md/HANDOVER.md to match reality before you add new work on top.
2. Identify the next unchecked item in TASKS.md (HANDOVER.md lists them in order) and tell me
   which one you're about to start, plus which model/effort setting CLAUDE.md recommends for it,
   before writing code.
3. If you're about to touch `calc.js`, GST/tax math, or anything in `server/src/auth.js` — stop
   and flag it explicitly, since CLAUDE.md calls these out as needing Opus/high regardless of
   diff size.

Do not re-open decisions marked "resolved" or "do not re-litigate" in HANDOVER.md or
DESIGN_BRIEF.md (e.g. the GitHub Pages split, the low-security posture) — those were deliberate
calls, not oversights.

When you finish a task, update TASKS.md (check it off) and HANDOVER.md (move the "not started"
list forward) before ending the session, so the next agent doesn't have to re-derive state from
the diff.
