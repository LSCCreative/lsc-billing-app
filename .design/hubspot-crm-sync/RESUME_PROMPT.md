Paste into a new session (Opus, effort high) opened on the LSC Billing App [V8] repo:

---

We're building the HubSpot two-way CRM sync for the LSC Billing App. Before doing anything else, read these in order:

1. `CLAUDE.md` (root) — model/effort buckets, handover discipline, and the two-codebases warning (`server/` and `web/` are the new build; root `index.html`/`main.js`/`preload.js` is the retired Electron app — don't touch it).
2. `.design/hubspot-crm-sync/HANDOVER.md` — current state and resolved decisions.
3. `.design/hubspot-crm-sync/DESIGN_BRIEF.md` — architecture, field mapping, open questions.
4. `.design/hubspot-crm-sync/TASKS.md` — the ordered task list; you are picking up the first unchecked item.
5. Skim `.design/nas-hosted-billing/HANDOVER.md` (top section and the Clients/estimates parts) and `server/src/routes/clients.js` + the `clients` table in `server/src/db.js`, since that is what we're evolving.

Decisions already made by me — do not re-litigate:
- A client is a HubSpot **Company**, with **Contacts** attached.
- **Two-way sync**; I can edit on either side and it reaches the other.
- The local DB stays a complete, self-sufficient copy (data and structure) so I lose nothing if I ever leave HubSpot.
- **ABN is optional and fully independent of HubSpot**: local-only, never sent to HubSpot, never read from it, never overwritten or blanked by a sync, never blocks a quote or invoice. No HubSpot custom property for it.
- Out of scope: HubSpot Quotes/Invoices/Deals, webhooks, workflows, any change to the money model.

How to work:
- Start with the first task in TASKS.md: **Grill Me** on the brief's open questions (auth type, structured address, notes local-only, import rules, contacts UI scope). Fold my answers into the brief. Give recommendations, not a survey — the brief already states mine.
- Per CLAUDE.md's handover discipline: state each task's model/effort bucket before starting it, and update `HANDOVER.md` and check off `TASKS.md` when you finish a task or stop.
- **Do not create anything in my HubSpot account (legacy app, service key, properties, records) without asking me first.** The portal is 441825893 (AP1, free tier) and I'm logged in on the browser pane. Never put the token in the repo, in chat, or in the frontend — it lives only in the NAS env, and you never need to see the value in chat.
- `npm test` (in `server/`) must never call real HubSpot; use an in-process fake HubSpot server. Green tests are not enough for anything I look at — verify UI in a browser against `api-scratch`.
- Database migrations are additive; never edit a shipped migration. Test migrations on a **copy** of `server/data/billing.db`, and do the first real sync only against a copy, after a dry-run preview I've approved.
- Deletes/archives never propagate automatically in either direction. Estimates keep their `client_json` snapshot untouched.
- Commit only when I ask.
