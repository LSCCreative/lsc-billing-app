# Build Tasks: Hnry invoicing

Generated from: `.design/hnry-invoicing/BRIEF.md` (H1–H10, findings 2026-10-22). Date: 2026-10-22.
Schema goes to **v20** (v19 is post-multipliers, built but not deployed: whichever deploys first takes the
other's migration with it, so deploy both NAS-first as one wave or build v20 on top of v19). Deploy NAS before
Pages. `npm test` in `server/` is the gate. Tags: **(backend — Sonnet/high)**, **(money — Opus/high)**,
**(frontend — Opus/high)** = **Frontend task**.

What exists today (read before building): accepting a project (`POST /api/projects/:id/accept` by the owner,
`POST /public/estimates/:token/accept` by the client's signature, `signing.js`) already creates the invoice
**rows** as drafts: a deposit + final pair or a single (`routes/projects.js` ~1012, `invoices.js`,
`calc.js depositAmount / finalInvoiceTotals / singleInvoiceTotals`). `POST /api/invoices/:id/paid` takes
`via: 'bank' | 'card'`. Sending is `routes/invoices.js` `/send`, `sends.js`, `mail.js`; the client's page and
PDF are `public.js`, `routes/public.js`, `pdf.js`, `web/js/views/invoice.js`.

Reference check for every push, on the live setup (not GST-registered): the Hnry line price is the invoice's
**ex-GST total** exactly as the app computes it; Hnry shows Subtotal = Amount due, GST $0.00.

## Foundation

- [x] **H1. The Hnry module** (backend — Sonnet/high): `server/src/hnry.js`, the only file that knows Zapier. One
  small interface: `findOrCreateClient({name,email})`, `createInvoice({clientId,invoiceDate?,dueDate?,
  poNumber,description,quantity,price})`, `addItem({invoiceId,description,quantity,price})`, `findByPo
  ({clientId,poNumber})`. A real transport (Zapier SDK `runAction`, client credentials from
  `ZAPIER_CREDENTIALS_CLIENT_ID/_SECRET`, `config.js`) and a **fake** transport for tests. No credentials =
  `hnry.enabled === false` and every caller degrades to "not set up", never throws at boot. Return shapes are
  the ones the brief recorded (invoice `ID`, `Invoice Number`, `Status`). Done when: the fake covers success,
  Zapier error, timeout and "found nothing", and the real transport is exercised once against the user's own
  throwaway client (H11). _New file; `package.json` gains `@zapier/zapier-sdk`._

- [x] **H2. Schema v20** (backend — Sonnet/high): `invoices` gains `hnry_invoice_id TEXT`, `hnry_number TEXT`,
  `hnry_pushed_at TEXT`, `hnry_error TEXT`; `clients` gains `hnry_client_id TEXT`. Additive, no rebuild. The
  invoice JSON (`invoices.js invoiceJson`) carries them. The app's own `number` stays (it is what goes in
  Hnry's PO field and the cross-reference); `hnry_number` is what the UI shows once set (H3). Done when: v20
  migrates a copy of the live backup (every other table unchanged, `foreign_key_check` clean), `test-db.js`
  pins the columns, old invoices read as "not in Hnry". _Depends on: nothing. Modifies: `db.js`,
  `invoices.js`._
  _Done 2026-10-22 (not committed): migration v20 (`hnry_invoice_id`, `hnry_number`, `hnry_pushed_at`,
  `hnry_error` on invoices, `hnry_client_id` on clients; each added only when missing), `invoiceJson`
  returns `hnryInvoiceId / hnryNumber / hnryPushedAt / hnryError`. 2 tests in `test-db.js`: every table
  identical but the new columns, idempotent, `foreign_key_check` clean. The v19 tests now stop at
  `{ to: 19 }`. Not yet run on a copy of the live backup (H12)._

## Core

- [x] **H3. Push the deposit (or single) on acceptance** (money — Opus/high): when a project is accepted (both
  routes), after the transaction commits, the server pushes the **deposit** (or the **single**) draft to Hnry:
  find-or-create the client (cache `hnry_client_id`), `createInvoice` with `poNumber` = the app's invoice
  number, one line, quantity 1, price = the invoice's ex-GST amount, then store `hnry_invoice_id`,
  `hnry_number`, `hnry_pushed_at`. Description (H7): `Deposit invoice (N%): <project name>`; a single:
  `Invoice: <project name>`. **A failure never blocks or rolls back the acceptance**: store `hnry_error`, log
  activity `hnry_push_failed`, and answer the client's accept exactly as today. Idempotent: before creating,
  `findByPo`; a second run reuses what exists. **Guard:** if the business is GST-registered in Settings, do
  not push; record `hnry_error: 'gst_registered'` ("GST handling in Hnry isn't set up yet", brief C2).
  Done when: a fake-transport test accepts a project and finds one draft with the right PO, line and price; a
  failing transport still accepts; a repeat run creates no second draft; a GST-registered setup refuses;
  mutations fail (drop the idempotency find, push before commit, swallow a wrong amount). _Modifies:
  `routes/projects.js`, `routes/public.js`/`signing.js`, `hnry.js` callers._
  _Done 2026-10-22 (not committed): `src/hnry-push.js` (`createHnryPusher(db, hnry)`: `push(id)`, `pushMade(made)`,
  `idle()`), wired in `app.js` (`app.locals.hnryPush`; a fake `opts.hnry` in tests; Hnry off by default in
  tests) and called after commit from the owner's accept, Create invoices and `signing.js` (`ctx.onInvoices`).
  It runs in the background: the accept never waits (a test holds Hnry slow) and never fails on it. Price =
  `amountDue(kind, stored totals)`. GST guard = the invoice's `gst > 0` OR Settings registered
  (`gst_registered`); also `zero_amount`, `no_client`; void/paid skipped; Hnry not set up = silent (no error
  recorded). Idempotent: `findByPo` adopts an existing draft; one in-flight push per invoice. A failed push
  forgets the client's cached Hnry id (a client deleted in Hnry would otherwise fail every retry). 17 tests
  in `test-hnry-push.js`, 15 mutations killed; suite 817/817. `POST /api/invoices/:id/hnry` (retry and the
  final) is H4. A push still running when the NAS restarts leaves the invoice "not in Hnry yet" until Retry._

- [x] **H4. Create the final in Hnry** (money — Opus/high): `POST /api/invoices/:id/hnry` for a **final**
  (also used as "Retry" for any invoice): `createInvoice` with the balance line (`Final invoice: <project
  name>`), then one `addItem` per extra line and a negative `Less deposit (INV-…)` line, so Hnry's total
  equals the app's `finalInvoiceTotals` to the cent. Refuses unless the deposit exists in Hnry. Partial
  failure (draft created, an item failed): record the invoice id and which lines landed, so a retry adds only
  the missing ones (find by PO first). Done when: a five-figure final with two extras and a deposit sums
  exactly in the fake; a failure after line 2 then a retry produces no duplicate lines; the GST guard applies.
  _Depends on: H3. Modifies: `routes/invoices.js`._
  _Done 2026-10-22 (not committed): `hnry-push.js` now plans LINES for every kind (`planFor`) and checks they sum
  to `amountDue` to the cent (`amount_mismatch` otherwise). A final = `Final invoice: <project>` at the job's
  total, one line per extra (each priced through calc.js; if the pieces don't equal the stored extras figure,
  or can't be priced alone, one `Additional work` line carries the stored figure; $0 extras are left out),
  then `Less deposit (<deposit's Hnry number>)` negative. Refused: `deposit_not_in_hnry` (the deposit must be
  in Hnry first), `gst_registered` (any GST figure, any block), `zero_amount` (a 100% deposit leaves a $0
  final), `amount_mismatch`. Resumable: schema v20 gained `hnry_lines_done` (amended before deploy);
  `hnry_pushed_at` is set only when ALL lines are in, a retry continues from `hnry_lines_done`. `POST
  /api/invoices/:id/hnry` (routes/invoices.js; waits for Hnry): 200 + `hnry`; 409 for refusals
  (`hnry_not_configured`, `hnry_skipped` void/paid, the codes above); 502 when Hnry/Zapier failed. **Once an
  invoice is in Hnry the app refuses to edit it** (`cannotEdit` → 409 `in_hnry`; `depositEditable` false):
  change it in Hnry. 14 tests in `test-hnry-final.js`; with H3's, 32 tests and 28 mutations killed; suite
  831/831. **Known limit:** a line that times out may still have landed in Hnry (Zapier can't read a draft's
  lines back), so a retry can double it: H6 tells the user to check the draft in Hnry before sending._

- [x] **H5. Retire the app's invoice sending for Hnry invoices** (backend — Sonnet/high): an invoice that has a
  `hnry_invoice_id` is **not sent by the app**: `/send`, scheduled sends and the invoice email are refused with
  "This invoice is sent from Hnry" (409 `sent_from_hnry`); no new invoice PDF or public invoice token is made
  for it. Invoices made before v20 (sent or paid, with live client links) keep working unchanged and read-only.
  "Mark paid" (`via: 'bank' | 'card'`) is untouched (H4 in the brief: paid is manual). Done when: tests show a
  Hnry invoice refuses `/send`, an old sent invoice's public page still resolves, `cancelPending` still works.
  _Modifies: `routes/invoices.js`, `sends.js`, `public.js`._
  _Done 2026-10-22 (not committed): for an invoice with a `hnry_invoice_id`, `/send` (email, link, scheduled) and
  `/pdf` answer 409 `sent_from_hnry`; no token, send row or PDF is made. The owner-only Cost Breakdown still
  works. **Mark sent** (`POST /api/invoices/:id/sent`) was a test-only route; it is now always registered but,
  outside the tests, works only for an invoice in Hnry, and records "you sent it from Hnry": from a draft that
  is FULLY in Hnry (`hnry_incomplete` otherwise), with issue and due dates, activity `invoice_sent` with
  `by: 'hnry'` and the Hnry number; the project stage and the Dashboard's Outstanding list follow (they key on
  status `sent`). Mark paid is untouched. The pusher now pushes **drafts only** (an invoice the app already
  sent or scheduled is never made again in Hnry: `hnry_skipped`), and a fully pushed one answers `already`
  first. Invoices sent by the app before Hnry keep their link, page and PDF. No change to `sends.js` or
  `public.js` was needed (a Hnry invoice never gets a token). 7 tests in `test-hnry-send.js`, 9 mutations
  killed; suite green. H6 needs: a **Mark sent** control on a Hnry invoice (dates prefilled from Hnry's
  defaults: issued today, due +20 days)._

## UI (**Frontend task**s)

- [x] **H6. Project page invoice rows** (frontend — Opus/high): in `project-folder.js` / `project-card.js` each
  invoice row shows the Hnry number (falling back to the app's number), its kind, amount, the status the user
  set, and a Hnry state: "In Hnry (draft)", "Not in Hnry yet" with **Retry**, or "Hnry error" with the message
  and Retry. "Open in Hnry" opens `https://app.hnry.io/invoices/<numeric id>/edit` (decode the id's trailing
  number from `hnry_invoice_id`'s base64 gid). A final shows **Create final in Hnry** once its deposit exists.
  Send / PDF / schedule controls disappear for Hnry invoices (H5). Done when: five states are checked
  (draft, error, retry, final ready, old invoice) at 1280 / 800 / 375, and a failed push is visible without
  opening the invoice. _Modifies: `project-folder.js`, `project-card.js`, `web/js/views/invoice.js`._
  _Done 2026-10-22 (not committed, not deployed): both screens (the project page's rows and the invoice page) share
  **`web/js/hnry.js`** (`LSCHnry`: `describe(inv, ctx)`, status line, `urlOf`, push / Mark sent calls, Hnry's 20-day
  default dates), and `GET /api/hnry/status` ({enabled}) tells them whether Hnry is set up. Each Hnry invoice shows
  the Hnry number (the app's as "app ref"), a chip (In Hnry / Part in Hnry / Hnry error / Not in Hnry; Sent and Paid
  once it has gone), one status line in the email line's own style, and one main button: Open in Hnry,
  Retry in Hnry, Create in Hnry (a final asks first: "can't be edited here after"), or Open. Mark sent… (dates
  prefilled issued today / due +20 days) records "sent from Hnry". Send / PDF / Copy link are gone for an invoice in
  Hnry; the app's own Send stays as "Send from the app…" in Actions for one not in Hnry. A part-way final says how
  many lines landed and tells the user to **look at the draft in Hnry before retrying** (a timed-out line may be
  there). A final whose deposit went out by the app stays entirely on the old path. Server: the folder's invoice
  rows now carry the `hnry*` fields (found on screen: they were missing); activity reads "made in Hnry as …",
  "didn't reach Hnry: …", "sent from Hnry". New: `scripts/dev-stub-hnry.js` + launch config `api-scratch-hnry`
  (pretend Hnry with a control port :8081). Checked on that stub against a scratch DB: draft, error, part-way (Retry
  completed it; Hnry's draft summed to the app's $10,470.00), final (Hnry $12,323.85 - $4,929.54 = the row's
  $7,394.31), Mark sent (validation, then Sent), the old-way project unchanged; 800 and 375 (no overflow, 44px
  targets, the longest line wraps to 3); 1280 layout seen but too small in the pane to read. 13 tests in
  `test-hnry-web.js` (the web file loaded in a sandbox), 10 mutations killed; suite 853/853. Not checked: Safari,
  a keyboard walk-through of the new dialogs (they reuse the project dialog's focus trap), the design review (H11)._

- [x] **H7. Settings and Rate Card copy** (frontend — Opus/high): Settings' "Card payments" block
  (`settings.js` ~620) becomes **Hnry**: connected or not (a harmless read call), "Invoices are created in
  Hnry as drafts; you send them from Hnry", and the card-fee note (1.45%, min $0.25, paid by you). The Rate
  Card's card-fee ⓘ and its placeholder (`pricing.js` ~1028 and ~1852) drop "Stripe 1.65% + 30c" for Hnry's
  1.45%; the user decides at build time whether the saved fee moves (it is their number to type).
  Done when: no "Stripe" or "passed on to the client" remains in `web/`, and 375px is checked.
  _Modifies: `settings.js`, `pricing.js`._
  _Done 2026-10-22 (committed, not deployed): Settings' "Card payments" section is now **Hnry**
  (`#/settings/hnry`): what Hnry does (drafts made there, sent from there), a status line from the new
  **`GET /api/hnry/check`** (`hnry.check()`: signs in to Zapier and looks the Hnry connection up afresh; no Hnry
  action runs, nothing read or made; always 200 with `{ enabled, connected, code?, message? }`) in four states
  (Connected / Not connected with why and what it means for an accepted project / Not set up yet with the env
  names / Couldn't check), a **Check again** button (announced; `aria-disabled` while checking so focus stays),
  and the card-fee note (1.45%, min $0.25, paid by you) linking to the Rate Card. The Rate Card's card-fee ⓘ
  names Hnry's 1.45% instead of Stripe's 1.65% + 30c; the PF8 Stripe readout comment is gone. The saved fee is
  untouched (the user's number). The fake and `dev-stub-hnry.js` fail the check with `/fail {"name":"check"}`.
  3 tests (`test-hnry.js` ×2, `test-hnry-send.js`); suite 866/866. Checked on the stub: all four states, 375px
  (no sideways scroll, 44px targets). One "Stripe" stays in `web/css/tokens.css`: a design reference to its
  dashboard look (U18), not payment copy. Adds a boot-time route: NAS before Pages. Review fixes: the
  check has its own 15 s deadline, a push keeps the connection it looked up (a failed check can't clear it),
  Settings checks only once the Hnry section is near the screen, an answer counts only for the latest check
  (a rail jump no longer leaves "Checking…"), and focus moves to the answer when Check again hides. Left open
  from the review: the Settings wording duplicates `LSCHnry.wordsOf`; the Rate Card ⓘ says invoices are paid
  through Hnry even before it is set up; no `#/settings/cards` alias; no web test for the panel._

## Setup and verification

- [x] **H8. Credentials and runbook** (deploy — Sonnet/medium; the user does the secret steps): the user creates a
  Zapier **SDK credential** (Connections → SDK credentials, secret shown once) and stores it in a 1Password
  Environment (never chat or tracked files); `create_local_env_file` feeds scratch; the NAS `server/.env` gets
  the two variables (`server/.env.example` and `DEPLOYMENT.md` updated). The Zapier connection to Hnry is
  already made. Done when: `hnry.enabled` is true on scratch and the Settings block says connected.
  _2026-10-22: Environment `ZAPIER_CREDENTIALS` made; `DEPLOYMENT.md` gains the Hnry section; launch config
  `api-scratch-hnry-live` reads it (see there for the grep-only mount). **Done:** on scratch
  `hnry.enabled` is true and Settings → Hnry says Connected (the check took ~5 s). The NAS `.env` lines
  are the user's to type at H12._

- [x] **H9. Live round trip** (money — Opus/high): on scratch with the real credential and the user's **own
  client record only** (never a real client): accept a $1,000 test project → one deposit draft in Hnry with
  the PO, line and price; create the final with an extra and a "less deposit" line → totals match to the cent;
  Retry after a forced failure; confirm card payment is on by default and GST is $0.00. The user deletes the
  drafts afterwards (the stray `INV-10657741` and test `INV-10670074` too). Done when: the numbers are
  recorded in this file.
  _Done 2026-10-23 on `api-scratch-hnry-live`, client "Lachlan Sullivan-Carey" (the user's own Hnry record).
  **Found first: the guessed action table was wrong** (`find_or_create_client`, `find_invoice`, a flat line):
  read from the account with the SDK, the real ones are `search_client`, `search_invoice` (by reference it
  takes `poNumber` only, no client; rows carry `client`; none found = no rows) and `create_invoice` with the
  line in `invoiceItems: [{ description, quantity, price }]`. `hnry.js`, the fake (now refuses the old shapes)
  and tests fixed; `findByPo` adopts only a draft on the same client. Then, all checked on Hnry's own edit page:
  (1) $1,000 job accepted as a 50% pair → deposit `INV-10679475`, PO `INV-H9-TEST-1-D`, one line "Deposit
  invoice (50%): H9 test - delete me" 1 × $500.00, GST $0.00, due $500.00, card on ($7.25).
  (2) Final with a $250.50 extra → `INV-10679486`, PO `INV-H9-TEST-1-F`: $1,000.00 + $250.50 − $500.00 "Less
  deposit (INV-10679475)" = $750.50 = the app's balance to the cent, GST $0.00, card $10.88.
  (3) Wrong Zapier secret → $100 single accepted anyway, row "Hnry error" (`zapier_error`), nothing in Hnry;
  real secret + Retry → `INV-10679524` 1 × $100.00, PO `INV-H9-TEST-2`; a second press answered "already".
  A reference search shows one draft per reference. The user deletes INV-10679475, INV-10679486,
  INV-10679524, INV-10657741 and INV-10670074._

- [x] **H10. Money review** (money — Opus/high): end-to-end pass: stored totals, Cost Breakdown and every
  document unchanged for projects accepted before v20; a new project pushes the same figures it stores; no
  internal figure (floors, tax set-aside, take-home) is sent to Hnry (the line is only the client-facing
  amount). Update `WORKING_NOTES.md` (Hnry is the invoice rail; paid is manual; never block acceptance on
  Zapier; the GST guard).
  _Done 2026-10-23: `migration-check.js` (this folder; usage in its header) on the review dataset made with
  the v19 tree `0491971` (11 projects, every invoice state): NO DIFFERENCES. Every table identical but the
  new `hnry_*` columns (all empty), schema one new row 20; calc.js identical on 26 priced copies; 169 owner
  and public routes and PDFs identical (45 PDF texts, invoices and Cost Breakdowns) with Hnry not set up;
  against a fake Hnry, every sent/paid/void/legacy invoice is refused with nothing sent, the two finals
  whose deposit went the old way refuse (`deposit_not_in_hnry`), the one pre-v20 draft and a newly
  accepted pair (deposit, final + 2 extras, $4,899.05 in 4 lines) each equal their stored figure to the
  cent with stored totals unchanged; the 12 calls carry only names, the reference, ids and line prices.
  Mutation: the take-home figure put in a line's text is caught. The dataset has no saved client rows,
  so `clients.hnry_client_id` is only checked empty. Run it again on a copy of the live backup at H12._

- [x] **H11. Design review**: run /design-review against the brief for H6–H7 at 1280 / 800 / 375.
  _Done 2026-10-23: `DESIGN_REVIEW.md` (44 captures, local only). Must fix: voiding an invoice in Hnry
  leaves it live in Hnry and the dialog doesn't say so. Should fix: "sent" copy where Hnry locks the
  invoice; the Balance names the deposit by the app's reference; Mark sent's fields crowded. Four
  could-improves. All four Must and Should fixes made the same day (see the review's Outcome): void and Hnry,
  Hnry-locking copy, the deposit's Hnry number (`invoiceJson` gains `hnryNumber` on less/replaces/replacedBy,
  1 test), dialog field spacing. The could-improves are left._

- [ ] **H12. Deploy** (Sonnet/medium; ask the user first): back up the live DB, run v20 (and v19 if still
  pending) on a copy of the backup, fetch and diff `origin/main`, NAS before Pages, credentials in the NAS
  `.env` first. After deploy: accept nothing real; the user does one real project when ready. Update ROADMAP,
  move the folder to the archive, delete the draft Zap "Untitled Zap" in Zapier.

## Open checks carried into the build

- **C2 (GST):** when the user registers for GST, check whether Hnry adds GST on top of the pushed price or
  treats it as inclusive, then lift the H3 guard. Until then the guard stops a wrong total.
- **C4 (paid status):** Find Invoice returned a DRAFT only; paid stays manual. Re-test later with a sent
  invoice if the user wants a "Check Hnry" refresh.
- **Zapier SDK is free only in early access:** keep every call in `hnry.js` so the transport can swap to a
  paid webhook Zap.
