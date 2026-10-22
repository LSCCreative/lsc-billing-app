# Working notes: settled rules and traps

Everything a builder needs from the finished tracks, in one place. Each item was a deliberate call or
a mistake someone already made. If one looks wrong, ask the user; don't quietly "fix" it. Full
reasoning lives in `Project build archive/` (read it only when an item here isn't enough).

## Money model (`calc.js`)

- `server/src/calc.js` and `web/js/calc.js` are byte-identical; so are `documents.js` and
  `call-sheet.js` (server/src and web/js). The drift tests fail otherwise.
- One floor, the **income floor** = `revenueTarget().breakEven` ÷ annual billable hours (running
  costs + gross pay + super + bad debt; $143.75 on the defaults). Pass `breakEven`, never `total`
  (total adds business profit, which auto prices add per hour). The cost floor (`hourlyFloor`) is
  deleted. The **Minimum Job Price** is break-even, advisory, owner-only: direct cost + hours × income
  floor, no profit, no card fee ("under by $X", never blocks). The editor's ⓘ takes it apart through
  `minimumJobPriceParts` (whole cents, largest remainder): don't round the shares in the view.
- **Auto price** = floor × (1 + business profit) × (1 + card fee), rounded up once ($159 hourly, $161
  at 1.65%); badges compare against the bare floor. A typed price is never auto-written or moved; an
  auto one (null) follows Capacity, Overhead, Profit Goals and the card fee, so changing any of them
  moves every auto price on the card, knowingly. Saved estimate lines keep their own price snapshot;
  "Update to current rates" is explicit.
- Re-saving an estimate re-derives its owner-only `overheadShare`, `taxSetAside` and `estTakeHome`
  from today's overhead rate (`prepareWrite` → `readOverheadRate`); client figures, PDFs and the Cost
  Breakdown don't move (PF9 check: a pre-v18 draft re-saved on v18 moved only those three). Not a bug.
- A line's or row's `mu` is shown as **Price** (Rate Card "Price ($)", the editor's and the estimate's
  line columns; PF10). "Markup" is only ever Business profit; don't bring the word back for a price.
- The markup is **Business profit (%) — before tax** (pricing-floor PF6; was "Target Markup", before
  that "Target Profit Margin"): profit = break-even × %, on top of pay, its own line in the target.
  The DB column and the API key `targetProfitMarginPct` keep the old name. `profitMarginPct` is a
  percent (25 = 25%); tax rates are fractions.
- Income tax uses the ATO resident brackets + Medicare, stored per FY in `tax_years`, user-entered
  (placeholders flagged). Tax is levied on pay, not revenue. Thresholds and effective lives stay
  user-entered; never hardcode them.
- Capacity is five real fields: working days, leave, sick, **hours worked per day** and **share you
  can bill** (`utilisationPct`, 1–100). Annual billable hours = (days − leave − sick) × hours worked ×
  share: 222 × 8 × 65% = 1,154.4 on the defaults (it was 1,776, every working hour billed). One
  capacity pool, no shoot-day cap. `goals.billable_capacity_hrs_per_week` is legacy, display-only:
  don't delete it or compute from it.
- A service's hour, half and full prices are independent: a typed day doesn't follow the hourly. An
  **auto** day is the hourly price × the day's hours (an auto half day is half an auto full day).
  Service-day hours (8/4) are not Capacity's hours worked per day: don't link them. An auto hourly is
  rounded up against the exact floor × profit × card fee (on a GST-inclusive card it is a search, not
  `ceil(raw × 1.1)`): don't simplify. An auto day under the floor is badged, not wrong.
- Depreciation gives two numbers from one table: the ATO figure for the accountant, and a straight-
  line replacement reserve over the user's own cycle for the rate. Schedules are computed on read;
  a lodged FY is frozen by an append-only `depreciation_locks` row. Every export (single-FY and
  multi-year CSV) reads a lodged FY from that snapshot, so a lodged year's closing value can differ
  from the next live year's opening value once an asset is edited; the multi-year headings say
  "(lodged)" for that reason.
- **Accounting traps (each yields a plausible wrong number):** deduction is apportioned by business-
  use %, the adjustable value is not; `daysHeld` runs from `start_date` not `purchase_date`;
  Australian FY is 1 Jul–30 Jun, one shared FY helper, never `getFullYear()`; leave and sick days are
  working days; ÷ 365 even in leap years, DV factor 200% from 10 May 2006; the replacement reserve
  uses `replacement_cost_estimate`, not historical cost.
- Asset `recovery` (`rate` Overhead Floor / `kit_hire` On-Set Kit) and `dayRate` (v17): a PUT that omits
  either keeps the stored value, so a stale tab can't reset a kit asset; `dayRate` is kept when an asset
  is on `rate` and null means "no rate yet", never $0.
- A `kit_hire` asset is out of `replacementReserveTotal` (so out of every rate, the snapshot and the
  Dashboard split); only the exact value leaves. To show what a kit asset *would* reserve, pass a copy
  with `recovery: 'rate'` (as disposal copy passes `disposalDate: null`).
- The asset modal hides the fields of the recovery not chosen but keeps and sends them; their
  validation still runs and names where the hidden field is. Register "gaps" skip disposed assets and
  a floor Vehicle when Overhead has a cost per km (its blank reserve is the advice, not a gap).
- An `equip` line with `ownKit: true` (exactly) is the owner's kit (K-D6): billed and in `expenseTotal`,
  income (taxed), no hours, never in `passThroughCost`/`directJobCost`. Anything else is a vendor's line.
- A saved kit line is `{ ownKit: true, assetId, assetName, item, vendor: '', days, cost }`; the server
  checks the shape (`days.js kitLineProblem`) but never looks the asset up, so a renamed, re-rated or
  deleted asset leaves saved lines alone. Kit is hired from no one: no rental, no vendor suggestion.
- `assetName` must be 1–200 characters after trimming, but the register doesn't cap a name: build a kit
  line's name through the editor's `kitName()`, never from `asset.name` directly. Use `LSCCalc.isKitHire`
  for "is this kit", and `DepreciationView.categoryLabel` for a category's words.
- Every document names a hire line through `calc.js equipLineName` (kit: "Kit Hire - <assetName>").
  Client documents price no hire line, kit included (only production-day items carry a price); every
  hire line's days go in the item's `tag` (vendor hire too, since 2026-10-17), so changing hire days on a
  sent quote is a client-facing change (resend). Days × rate shows only on the owner's detail and the
  Cost Breakdown, which never says "own kit" or "income" (it can be forwarded to a client).
- Double counting is possible (gear entered as one-off expense and as an asset). The annual cost is
  shown split Operating / Replacement reserve, with a soft prompt on large one-offs.
- Overhead items are entered GST-exclusive (a hint, no toggle). Every labour row's internal `rate`
  is the one computed Overhead Rate/hr; travel rows are excluded. Direct costs are ex-GST on a
  GST-inclusive card. GST-free is a **per-estimate** flag; a per-line flag was considered and
  refused. A GST-free job bills the listed rate.
- `null` means "cannot compute", never 0/NaN. `mu: null` from `unitDef` means unavailable, never $0.
  `unitDef` returns the old flat row shape so `computeTotals` doesn't change: if a task is editing
  `computeTotals`, it has gone wrong.
- `PUT /api/pricing` refuses the old row shape (`pricing_shape_outdated`); this is all that stops a
  stale tab writing the old card back. Bump `PRICING_SHAPE` when the card shape changes.
- Travel: own-time travel ("Your time") is priced at the income floor × card fee, auto, no profit, and can be
  typed over (badge under the floor). The car is a separate at-cost per-km line from Overhead's
  vehicle cost per km, billed as a pass-through. Pass-throughs are never discounted or marked up.
- Surcharges (short notice, weekend/holiday, after hours) apply to Production items only, are folded
  into each item's price rounded up to the dollar, never shown to the client (reasons are in the
  owner-only Cost Breakdown), are income (taxed, no extra hours, no change to floors or Minimum Job
  Price). Estimates snapshot multipliers, stacking mode and each day's status.
- v18 (pricing-floor) rewrites the goals row to 8 h / 65% / 10% on every run, so an older upgrade
  test that rewinds `schema_version` and runs to the latest moves its goals row: stop it at
  `migrate(db, { to: 17 })`. `PUT /api/goals` without `utilisationPct` keeps the stored share.
- `cardFeePct` (rate card) is a PERCENT (1.65), unlike `taxSetAsideRate` (a FRACTION, 0.35). The Rate
  Card rebuilds the card field by field on save: a new card field must go through `workingCopy` and
  `payload` and bump `PRICING_SHAPE`, or an older build's save drops it.
  The Rate Card's `priceCtx` is read once at mount: a card field that changes auto prices (the card
  fee) must be copied onto it as typed and after save/reset (`takeFee`), or the rows lag the field.
- **No card surcharges, ever** (eftpos, Mastercard, Visa, Amex, PayPal no-surcharge rules from
  2026-10-01). Card fees are recovered through prices that every client pays, never added only to
  card-paid invoices, whatever it is called. "Non-taxable" on a tax invoice means only GST-free or
  input-taxed: on-charged crew and purchases are GST-taxable pass-throughs (out of income, not out of GST).
- Deliverable Types (post-multipliers, v19): read a type's services only through `calc.js typeServices`
  (`{ name, multiplier }`; an old bare name reads as 0×) and its total through `typePostRate`. `postPlan`
  recommends each post line from its own `postMultiplier`, rounded up per line, never per deliverable; a
  deliverable none of whose lines carries one plans from its old `multiplier` (G9), so old estimates don't move.
  The card refuses a bare-name service or a type `multiplier` (v19); `postMultiplier` (≥ 0) and `follows`
  (flag) live only on `post` lines (days.js `postLineProblem`) and stay off every client route and PDF.
  Post lines a type lays out are **priced, not suggested** (replaces B2's "suggest, don't price"): an
  hourly one `follows` and the editor's `fillFollowing` writes its qty from `postPlan().lines` on every
  recalc, billed as filled. A typed qty or a unit switch sets `follows: false` for good; only re-picking
  the type brings following lines back. `postPlan().lines[].index` is the index in `activeRows.post`,
  which is `rowsIn('post')` order: keep collect() reading them in that order.
  The editor recalcs while `restoreRows` is still rebuilding the form (no Production rows on cards, no
  deliverables yet), so `fillFollowing` waits for `followReady`; mount's `recalc(true)` is the opening
  pass, which pins a following line whose saved hours don't match the plan instead of rewriting it.
- Invoice totals live in `calc.js` (`depositAmount`, `extrasTotals`, `finalInvoiceTotals`,
  `singleInvoiceTotals`). `accepted` counts as won. Extras charge GST as the job did.

## Structure and product rules

- Hosting: GitHub Pages frontend at `app.lsccreative.studio` + Node/Express/SQLite API on the NAS in
  Docker, `billing.lsccreative.studio` over a Cloudflare Tunnel. Cross-origin (CORS) with
  `SameSite=None; Secure` cookies; site and API share `lsccreative.studio` so the cookie is
  first-party (iPhone/Safari). The security bar is low by the user's choice: don't re-raise it, but
  keep internal figures (floors, tax set-aside, take-home, Cost Breakdown) off every public route.
- "Estimate" is the only name (no "quote" object). A sent estimate is a frozen version. A sent quote
  can't change without the client being sent the update (D104: "Save and send the update").
- Projects: one per UPID under a client, holding a deposit + final invoice pair (`INV-<UPID>-D/-F`)
  or a single invoice. Declined estimates leave the calendar. A paid invoice can't be un-marked
  (credit note not built). Delete is refused while a non-legacy invoice is scheduled, sent or paid.
- Only the section with id `prod` is "on set"; `post` and `prod` are undeletable and any section the
  app keys on must keep its id (a re-added one gets `catN` and silently stops working).
- A confirmed day locks the whole date; a required note overrides. Accept is paused, not flagged,
  when a proposed date is taken.
- Public pages are unguessable links (`web/c/`). `estimate_snapshot_json` and `invoiceJson` are
  owner-only: public views read through allow-lists (`public.js invoiceView`, the client PDF's
  fields), never the whole object. A new client-visible field must reach both. Client events
  (opened, signed) need adding to `HOME_KINDS` (`routes/projects.js`) and `ProjectCard.activityText`.
- Stage E reads settings through `documents.js` (`docSettings`, `validDays`, `faqUrl`, agreement text,
  `agreementValues` + `fillAgreement` on the frozen version); the Settings preview calls the same
  code. Agreement business details come from the version's frozen `snap.business`. `(i)` in agreement
  text is ambiguous: use `agreementLayout`.
- A later rebuild of `estimates` or `projects` must flag the migration `foreignKeysOff: true`
  (`db.js`): days, rentals, invoices, estimate_versions, signatures hang off them. Run a migration on
  a copy of the live backup first (`foreign_key_check` refuses the whole boot).
- Home (`#/home`) is the **Dashboard**. Its small calendar grows into the full one, and the choice is kept
  in `localStorage` `lsc-home-cal-size`. The lists read `GET /api/projects?stage=open` (not paid or
  declined, any age) and `GET /api/invoices?state=outstanding|paid`. The amount is the stored `amountDue`,
  never re-priced, and an unpaid legacy invoice counts as outstanding.
- Holidays are fetched in the editor once a day is dated; the server always prices with the real
  list on save.
- Email is Resend over SMTP from `admin@lsccreative.studio` (`mail.js`, `sends.js`). A reset signs
  every session out; any Account change asks for the current password (403, not 401, when wrong);
  usernames can't contain `@`; passwords 12+ chars.
- Google: Calendar read + write (`google-sync.js`), Maps trip planner. Any save re-checks every
  estimate with a sync row. Trip limits in `days.js`: 23 destinations, 2000 chars per detail, 300 per
  address, 50k polyline. Autosave PUTs are throttled because every mutating request snapshots the DB
  (`backup.js`). Anything that changes trip stops goes through `changed()`, not `emit()` alone
  (`routeSeq` drops late replies).
- Hnry: an invoice in Hnry (or with a push under way, `hnryPush.busy`) must not change in the app. Edits
  and sends go through `cannotEdit(row, { pushing })` (routes/invoices.js `refusalOf`); the one other
  writer of invoice figures, `repriceFinal`, flags an in-Hnry final `hnry_changed` instead. A new
  writer of `totals_json`/`extras_json`/`less_invoice_id` must do one or the other.

## Frontend traps

- Menus (`menu.js`): a scripted `el.click()` on an item does nothing; dispatch a bubbling
  `MouseEvent` or keydown Enter. An open list moves into `<body>`, so a screen's delegated
  `data-act` handler must listen on the container holding the *closed* menu. Esc closes only the menu.
- The booking block draws day cards while closed (collect() reads the page): never put `paintCards()`
  behind `if (!open)`. Open/close goes through `LSCPanel.setOpen`.
- The booking block adds days only from the calendar (no button of its own); `addTbc()` survives
  only for the editor's "Add to a day ▾ → A new Date TBC day". Removing the last day focuses the calendar.
  A card has no fields but the specification note: date, times and status change only in the day dialog
  (`editDay`, edit mode of `openDialog`), so focus targets on a card are `[data-act="more"]`, never `[data-f="date"]`.
  A calendar click on a date with one of this estimate's days edits it (`pickDate`), never adds; a second day comes from the dialog's
  "+ Another day" (and "Go to its items" is the way down to the card). The calendar redraws its cells on every render, so a dialog
  opened from it returns focus through `ctx.opener()` (calendar.js), never the `trigger` element; `cal.select(date)` moves without a wash.
  Bump in = bump out is refused only once the times are touched (the server takes any pair).
  A calendar tile also carries `data-day-id`: scope card lookups to `#booking-cards`.
- The editor's calendar is always full width above the cards, compact until Expand (`lsc-booking-cal-size`,
  through `LSCUtil.readPref`); only the open service menu takes a 420px column beside them from 1296px
  (`:has(.is-menu)`). Compact's 52px is exact: `fitCell` (two lines, bookings first, bands included) and the
  one-line tile sizes in calendar.css are one budget, so change them together.
- Touch tablets: calendar.css and booking.css shrink their 44px controls from 768 only under `(any-pointer: fine)`.
  a11y.css loads last and sets a 24px floor on `.btn-sm`/`.line-move` from 768: a touch-tablet 44px rule
  needs a prefix (`.booking-block …`) to win.
- Stacked grids need `grid-template-columns: minmax(0, 1fr)`. A table that stacks on a phone needs a
  `data-label` on every cell. Prefer a class to an inline `style` where responsive rules must reach.
- Editor equipment rows are hire or kit: read a hire row's fields through `hireRows()` and a row's cost
  through `costOf(tr)`; a kit row has no `.vendor-inp`, `.cost-inp` or `.rental-hint`.
- Mark every API-writing control `data-write`; register unsaved screens with `LSCUnsaved`; a write's
  outcome must not touch a screen the user has left (`onScreen()` check); `onAuthLost({keepScreen})`.
- Info controls are buttons with `aria-expanded`, not hover tooltips. Finance sub-tabs are `<nav>` +
  `aria-current`, not `role=tablist`.
- Fonts: the face is named **'LSC Metro Sans'** on purpose (a Fontspring demo on the studio Mac has
  `±` glyphs). It has no tabular figures: money uses `--font-figures` (mono). Brand font masters in
  `Visual Design/` are gitignored (licence); only `.woff2` goes in `web/fonts/`.
- Test money layouts with a five-figure total, not the fixtures (scratch tops out near $560).
- Dashboard layout: below 768 the column wrappers (`.dash-main`, `.dash-side`) are `display: contents`,
  so Coming up can sit between the lists and Recent activity. Any `grid-area` on their children must be
  reset to `auto` at ≥768. View-transition names go on only while the calendar resizes (`.is-moving`).
- Module globals are top-level `const`s: `window.LSCData` is undefined; use `typeof`.

## Testing and previews

- `cd server && npm test` is the acceptance gate. For money math, break the line and confirm a test
  fails. `test-public.js`/`test-call-sheet-page.js` "wrong link is the same 404" is timing-based and
  flaky under load (passes on rerun).
- Restart the API after server edits; cache-bust web JS before trusting the browser.
- Headless screenshots: `server/node_modules/puppeteer-core` + local Chrome, in-page login,
  `page.on('dialog', d => d.accept())`, wait for `#ed-bar` not networkidle, `captureBeyondViewport:
  false` and no clip for menu shots. The browser pane is often hidden and freezes screenshots.
- Scratch DB: `/tmp/lsc-billing-scratch` (v16) holds the user's real Google account: never run a
  write-capable build on it; use `api-scratch-sync` (pretend Google) and `api-scratch-mail`. Rebuild
  the review dataset with `node .design/seed-review.js server` after seeding the `dev` account. Back
  the DB up before any check that sends, voids or marks paid. Don't `git stash` to compare trees.
- Every deploy: fetch and diff `origin/main` first; ask the user; NAS before Pages when there is a
  migration or new route (see `DEPLOYMENT.md`).
- Real Hnry on scratch: `api-scratch-hnry-live` (credential from 1Password, see `DEPLOYMENT.md`). A
  1Password mounted `.env` must sit outside the Drive folder, and only `grep` reads it (sh, awk get
  nothing). Accepting or Create/Retry there makes REAL Hnry drafts: the user's own client only.
- Settings → Hnry checks only once its section is on screen: a background tab never starts it.
