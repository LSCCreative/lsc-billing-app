# Brief: Hnry invoicing (replaces the Stripe card-payments plan)

Grilled with the user 2026-10-21. Supersedes the `card-payments` row (Stripe Checkout, webhook, `payments`
table, per-invoice toggle, Stripe keys: all shelved). Money math + **Frontend task**, `Opus, effort: high`.

## Goal

Invoices are created, sent and paid **in Hnry** (the user's accounting platform; its card payment is built
in). The billing app stops being the invoice the client sees. It stays the quote, agreement, project and
Cost Breakdown, and **pushes the deposit and final to Hnry as drafts** through Zapier.

## Decisions

- **H1. Hnry is the invoice and card rail.** Stripe is dropped. Reason (the user's): low cost traded for
  convenience and money management in one place. Hnry's card toggle: 1.45%, min $0.25, paid by the sole
  trader and claimed as a business expense (seen on the invoice form 2026-10-21), so no client surcharge.
- **H2. The user sends each invoice from Hnry.** The app and Zapier only create **drafts**. (Zapier's Hnry
  app has no send action, and its Add Item dropdown shows drafts only.)
- **H3. Hnry's number is the invoice number.** The app stores it and shows it wherever it names an invoice;
  the `INV-{upid}-D/F` scheme goes. The app's own reference goes in Hnry's `poNumber` as a cross-reference
  and as the key for Find Invoice.
- **H4. Paid status stays manual** ("Mark paid" in the app) unless polling Find Invoice returns a status.
- **H5. Trigger:** the client accepts the quote and signs the agreement (`POST /public/estimates/:token/
  accept`) → the server creates the Hnry **deposit** draft. Not a Zap triggered by the app: the NAS calls
  the Zapier SDK (`runAction`) directly, so no webhook-triggered Zap and no paid plan just for the trigger
  (open check C5).
- **H6. The final** is created when the user presses "Create final" in the app (extras known): one
  balance line, the extras as further lines, a negative "less deposit" line, via `Add Item to Existing
  Invoice` (one call per extra line).
- **H7. Wording:** the line description says **"Deposit invoice (N%): Project name"** and **"Final invoice:
  Project name"**. If the action also exposes Comments, a fuller sentence goes there too (C3).
- **H8. The app retires its own invoice email, scheduled sends, invoice PDF and public invoice page.**
  It keeps each invoice as a row: Hnry number, kind, amount, status the user sets.
- **H9. The Rate Card's card fee %** moves from 1.65 to 1.45 (the user's call at build time); the
  Settings copy at `settings.js:620` and the PF8 placeholder at `pricing.js:1852` are rewritten.
- **H10. Secrets:** the Zapier credential goes in a 1Password Environment, never tracked files.

## Findings 2026-10-22 (Zapier connected to the user's Hnry; read in a draft Zap, nothing published or run)

- **Create Invoice inputs, exactly:** Client* (a Hnry client id, e.g. `Z2lkOi8vaG5yeS9DbGllbnQv…`), Invoice
  Date, Due Date, Period Start/End Date, Purchase Order or Reference Number, and **one** Invoice item
  (Description, Quantity default 1, Price default 0). No Comments, no GST, no send, no card toggle, no
  repeating items: every extra line is an `Add Item to Existing Invoice` call (invoice picked from a
  list of **drafts**). Not run (it would create a real draft), so its **return value is still unseen**.
- **Find Invoice** (search by Client or by PO/Reference; options "create if none", multiple results = first)
  returns: client id/name/email/tax-deduction %, invoice **ID**, **Status**, Invoice/Due/Period dates,
  **Invoice Number** (`INV-10657741`), **PO Number**. Proven on the user's stray draft. So the number comes
  back by searching on the app's reference. It found nothing for a client whose invoices are all sent/paid:
  it may see **drafts only** (unproven), in which case it can't report "paid".
- **Clients:** 13 in Hnry, picked by opaque id. `Find or Create Client` matches by name only.
- A draft Zap "Untitled Zap" (Find Invoice step, not published) is left in the user's Zapier; delete it.

- **Create Invoice test (2026-10-22, a $100 throwaway draft, PO `TEST-GST`, client = the user):** it
  **returns** the invoice ID (`Z2lkOi8vaG5yeS9JbnZvaWNlLzg4OTA0NTI=` = gid `Invoice/8890452`), the **Hnry
  number** (`INV-10670074`), Status `DRAFT`, client details, dates (invoice date defaults to today, due
  date +20 days), PO, and the item. Hnry's edit page showed Subtotal $100.00, **Total GST $0.00**, amount
  due $100.00: the user is not GST-registered now, so Hnry adds none. **Online card payment is on by
  default** (fee $1.45 on $100, paid by the user). The draft opens at `app.hnry.io/invoices/<id>/edit`.
- Two throwaway drafts sit in the user's Hnry: `INV-10657741` (my stray, $0) and `INV-10670074` (the test,
  $100). Both to be deleted by the user.

## Open checks

**C1 answered** (Create returns the number and id; no Find needed). **C2 answered for now**: no GST while the
user isn't registered; re-check the day they register (does Hnry add GST on top of the price, or is the
price inc-GST?). **C3 answered**: no Comments input, use the line description (H7). **C4 open**: Find
Invoice returned a **DRAFT**; it found nothing for a client with only sent/seen/paid invoices, so paid
status probably can't be read that way (the user marks paid manually, as decided). **C5 answered
2026-10-22** ([SDK docs](https://docs.zapier.com/sdk), [deploy](https://docs.zapier.com/sdk/deploy)): the NAS
authenticates with **client credentials** (`ZAPIER_CREDENTIALS_CLIENT_ID` / `_CLIENT_SECRET`, or
`createZapierSdk({ credentials })`), made in Zapier (Connections → SDK credentials → Add, or
`create-client-credentials`); the secret is shown **once**, so the user puts it straight into a 1Password
Environment (H10) and the NAS `.env`. The page has a "Needs approval" filter, so a credential may need
approving. `runAction({ app: 'hnry', action: 'create_invoice', connection, input })` then runs with no Zap
and no webhook trigger. **Billing: "free during early access"; the open beta is the risk.** Task/plan
metering isn't stated, and Zapier may charge or change the SDK later. Fallback if it does: a Zap with
"Webhooks by Zapier" (paid plan) or the user creating the drafts by hand. Build the Hnry call behind one
small module (`hnry.js`) so the transport can change. The user has no SDK credential yet (0 listed).

- **C1.** What `Create Invoice` and `Add Item` return (invoice id, number, link?). If nothing, the number
  comes from `Find Invoice` by PO number.
- **C2.** GST: how Hnry applies it to an invoice made by Zapier (price ex or inc GST; GST-free lines).
- **C3.** Whether Comments (Additional Settings) is an input. Zapier lists only `poNumber`, `description`,
  `quantity`, `price`, dates, `clientId`.
- **C4.** Whether `Find Invoice` returns a status (paid / sent). If yes, offer a "Check Hnry" refresh.
- **C5.** Zapier SDK cost: does `runAction` from a server use tasks, which plan, which credential.
- Plus: the client is matched by `Find or Create Client` (name only: what about two clients with one name).

## Touches (read before building)

`server/src/invoices.js`, `routes/invoices.js` (numbering, send, mark paid, scheduled sends), `public.js`
and `routes/public.js` (invoice page, accept), `mail.js`/`sends.js`, `db.js` (a migration after v19:
`hnry_number`, `hnry_invoice_id`, `hnry_pushed_at`, `hnry_error` on invoices), the web invoice views,
`documents.js`/`pdf.js` (invoice PDF), tests. Failure path: if the Zapier call fails at acceptance the
quote still accepts; the project shows "Hnry deposit not created" with a Retry. Never block a client's
acceptance on a third party.

## Not in this track

Stripe; refunds; part payments; reading paid status from Hnry without C4; a Hnry send action.
