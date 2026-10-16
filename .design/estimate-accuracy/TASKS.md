# Estimate accuracy: open tasks

What is left of the 2026-09-30 money-logic audit. Done: 1, 2, 3, 5(a), 6a, 6b (live, schema v10).
Scrapped: 8 (expected booking rate, the user is "not ready for it": don't re-propose). Superseded:
11 (loadings, replaced by production-booking's surcharges). The built tasks' full text and the audit
are in `Project build archive/tracks/estimate-accuracy/` (read only if something here is unclear).

**Rules for this track.** Tasks 10–14 change what the app charges, and each has an open decision:
run `/grill-me` on one before building it (task 9 is done as `.design/own-kit/`); the recommendations below are mine, not the user's.
Money-math tasks are Opus/high; write the worked example into `test-calc.js` as written and break
the line to prove a test fails. Pass-throughs (crew, hire, direct travel) are billed at cost and are
not income unless a task says so (10 and 13 are the exceptions, both decisions). Task 14 reopens
service-rate-tiers decision 13: decision only until the user says go. Deploy order NAS then Pages.

**Settled by the user (don't re-ask):** Transport & Logistics Hrs is "Your time"; income tax stays
out of the Overhead "Tax" category (task 7); the FY 2026–27 tax scale is saved on the live site
(reported, unverified: task 4 checks it).

## Source: what the audit found

Sample inputs used for every worked example below (a reference set, not the user's live figures):
six overhead items totalling $15,940/yr; three assets giving a $4,483.33/yr replacement reserve;
capacity 8 hrs × 5 days, 30 leave + 8 sick = 1,776 billable hrs; Desired Net Income $65,000, Target
Markup 25%, super 12%, bad debt 2%; the FY 2026–27 resident scale with 2% Medicare. That chain gives
business cost $20,423.33, overhead rate $11.50/hr, pay before tax $81,647.06, **Target Annual Revenue
$114,151.06, income floor $64.27/hr**, and an auto hourly price of $81 (half day $324, full day $648).

The arithmetic was sound, and every step reconciles (pay before tax minus its tax is exactly the
$65,000 target). The findings are the three things in tasks 1–3, the four settings in tasks 4–7, and
the seven accuracy gaps in tasks 8–14 (task 8 since scrapped by the user).

## Open tasks

- [ ] **4. Confirm the FY 2026–27 tax scale is live** (settings — user, then a check): the user
  reports on 2026-09-30 that they have saved it on the live site. Nothing to build. When a session has
  the user's go-ahead to sign in (credentials in `.credentials.local.md`), check the live Dashboard
  and Rate Card show real floors and auto prices rather than `—`, and record the live income floor in
  `HANDOVER.md` as the reference figure the later tasks' before/after numbers use. _No code._

- [ ] **5. Transport & Logistics Hrs is "Your time"** (money math — Opus/high): the user confirmed on
  2026-09-30 that it is their own hours. Two parts. **(a)** In
  [`defaults.js`](../../server/src/defaults.js) set `ownTime: true` on that travel row so Reset
  Defaults and a fresh database match; add a test that `DEFAULT_PRICING` carries it, and that a
  2-hour line on it counts as $70 of income (2 × `mu` 35, none of it treated as cost) and 2 billable
  hours in `totalHours` (today it counts $20, the markup over its $25 `rate`, and 0 hours). **(b)** The
  **live** Rate Card needs the "Your time" box ticked and saved, which is a change to live data:
  do it only with the user's go-ahead, or leave it to them; record which in the Done note. Note the
  row's `rate` stops meaning anything once ticked. Also see task 6, which is the reason this row
  matters. _Modifies: `defaults.js`, its test._

  **(a) Done 2026-09-30** (Opus/high, branch `estimate-accuracy`). `defaults.js`: Transport &
  Logistics Hrs now carries `ownTime: true`. `rate: 25` is left as it was but is no longer read, and
  the docblock says why. This reaches exactly three things: a fresh database, Reset Defaults, and a
  line added to a card nobody has saved, because `readPricing` falls back to `DEFAULT_PRICING`. A
  saved card keeps its own row. A saved line keeps its snapshot: one added before this change carries
  `{ mu: 35, rate: 25 }` with no flag and still prices as resold, which a test pins.
  **Tests** (5 new, 262 pass): `DEFAULT_PRICING` carries the flag on that row and no other; a 2-hr
  line on it gives `expenseTotal` 70, `incomeExGst` 70, `directJobCost` 0, `totalHours` 2, tax 24.50,
  overhead 20 at $10/hr, and `labourHoursBreakdown` agrees. The same line on the old row gives
  income 20, cost 50, 0 hrs. A line added from the default card snapshots the flag, and a line saved
  before it does not move. The route test Reset Defaults → GET returns the flag.
  **Fixtures moved.** The `JOB` worked example in `test-calc.js` used the default transport row as
  its *resold-travel* case ("exercises every path at once"). It now prices against a pinned
  `JOB_PRICING`: the default card with that one row still resold. So its figures (1420, 2040 income,
  714, …) are unchanged and still cover the resold path. 23 call sites switched. The fresh-database
  route test in `test-ratecard.js` really does read the default card, so it moved knowingly and is
  commented: `totalHours` 10 → 14, `taxSetAside` 504 → 539, `estTakeHome` 936 → 1001 (income 1,540
  not 1,440).
  **Mutations checked**, each caught: flag removed (5 tests fail), flag `false` (5), flag put on
  Crew Meals instead (1).
  **Browser** (scratch API, restarted so the server loaded the new defaults; the first attempt ran
  against the old process and showed the box unticked): after Reset Defaults the Rate Card's travel
  table shows "Your time" ticked on Transport & Logistics Hrs only. The scratch card was saved first
  and put back afterwards, and it matches exactly.
  **(b) Not done: needs the user.** The live Rate Card's "Your time" box on that row must be ticked
  and saved. That is a change to live data, so it is left to the user or to an agent with explicit
  go-ahead. Until it is ticked, live quotes keep treating transport hours as resold ($10/hr income,
  0 hours). **Deploy:** server-only (`defaults.js`), no migration. It changes nothing live until the
  live card is reset, so it can ride along with any NAS deploy.

- [ ] **7. Keep income tax out of the Overhead "Tax" category** (frontend — Opus/high): Target Annual
  Revenue already adds the owner's income tax through the ATO scale, so income tax entered as an
  overhead item is counted twice and raises every rate. The category's label is display-only (the
  stored value stays `tax`, no migration). Relabel it in `CATEGORIES` in
  [`overhead.js:96`](../../web/js/views/overhead.js) to say what belongs there, for example
  "Business taxes & fees (not income tax)", and show a one-sentence note when it is chosen in the
  add/edit form, in the same place and manner as the existing double-count hint (`overhead.js:325`).
  Check every place the category label is printed — the register, the charts and legend, the
  Dashboard's split, the CSV if any — takes the new label from one source rather than a second
  copy. **The user must also open the live Overhead list and delete or reduce any item in that
  category that is income tax or a tax instalment;** it is their data. _Modifies: `overhead.js`
  and whatever else prints the label._ Done when the note appears only for that category, the label
  reads the same everywhere, and it is verified at 375px.

- [x] **9. "Own kit" on equipment hire: moved to `.design/own-kit/`** (decided 2026-10-13, tasks K1–K10). Done by own-kit, deployed 2026-10-17.
  Don't build it from here.

- [ ] **10. A discount line** (money math — Opus/high): the only way to discount today is to cut
  hours, and that cuts both floor lines too, so a discount never shows. Quoting 20 real hours as 16
  makes the Income floor read $1,028.32 instead of $1,285.40 (sample). **Decision needed:** (a) shape —
  recommend one estimate-level discount, either a dollar amount or a percent; (b) what it applies to —
  recommend **labour and own-time income only, never pass-throughs** (which are billed at cost), so a
  crew invoice is not discounted below what it cost; (c) where it is stored — recommend a
  `discount` object beside `activeRows` and a small migration, not a non-array key hidden inside
  `activeRows`, which three places (`NON_LABOUR_KEYS` in calc, `RESERVED_SECTION_IDS` in ratecard and
  rows) would each have to be told to ignore; (d) whether the client sees it on the PDF —
  recommend yes, as a "Discount" line before GST. **Build:** `computeTotals` takes it, reduces
  `labourTotal`'s income before GST and tax, and leaves `totalHours` at the real hours (that is the
  point); the editor shows the discount, the real price before discount and the after-discount price
  against both floors (the Income floor line already says "under it by $X"); PDF and estimate detail
  print it. Worked example: 20 hrs at $110 = $2,200, less $440 (20%) gives a client price of $1,760,
  20 hours, Income floor need still $1,285.40, tax and take-home on $1,760. Saved estimates with no
  discount total identically. `averageJobValue` reads the discounted price, which is what was won.
  _Modifies: `calc.js`, migration, `routes/estimates.js`, `estimate-editor.js`, `estimate-detail.js`,
  `pdf.js`._

- [ ] **12. Minimum call per service** (money math — Opus/high): an on-site service (capture,
  drone) is rarely worth turning up for under a set number of hours. **Decision needed:** enforce
  (bill at least N) or warn only — recommend **warn only**, in the editor, as an advisory like
  Minimum Job Price, because forcing a bill is a pricing rule the user hasn't asked for. A
  `minHours` on a Rate Card service (optional, blank = none), snapshotted on the line; the line shows
  "under the 2 hr minimum" when qty × hoursPerUnit is below it. Migration: card JSON shape only, so
  add it to `cardShapeOutdated` awareness carefully — an old card without it must keep working, and
  an old build must not save a card that drops it. _Modifies: `calc.js`, `pricing.js`,
  `estimate-editor.js`, `routes/pricing.js`._

- [ ] **13. Handling markup on crew and hire** (money math — Opus/high): crew and equipment are
  billed exactly at cost, so the business fronts other people's invoices for nothing and carries the
  risk of a client not paying (the bad-debt allowance only covers the business's own revenue).
  **Decision needed:** whether to charge a handling markup at all — recommend an optional, blank-means-0
  **card-level percent** on Crew & Contracts and on Equipment Hire (two fields on the rate card,
  beside `taxSetAsideRate`), applied to the cost, with the markup counted as **income** (taxed, no
  hours) and the rest still pass-through. Not per line: per-line is fiddly and easy to forget. This
  changes `directJobCost` only by the cost part, not the markup. Also decide the rounding and the
  GST treatment on an inclusive card (see task 3). _Modifies: `calc.js`, `pricing.js`, the estimate
  editor, `pdf.js`._ Depends on: tasks 3 and 9, which both change the same lines.

- [ ] **14. A half-day loading** (money math — Opus/high, **decision only until the user says
  go**): an auto half day is exactly half an auto full day, because brief decision 13 (service rate
  tiers) made every auto day the hourly × its hours. The user accepted that, but the earlier
  price-calculator rule was that setup, travel and turnaround don't halve. This is reopening a
  settled decision, so **don't build it unless the user asks.** If asked, the least invasive shape is a
  card-level "half-day loading (%)" beside Service Day, blank = 0, applied only to *auto* half-day
  prices (a typed price still wins), rounded up like the hourly. _Modifies: `calc.js` (`unitDef`),
  `pricing.js`, the Service Day popover copy._

- [ ] **15. Deploy** (deploy — Sonnet/medium): **ask the user first.** Back up the live DB
  (`sqlite3 ".backup"` into `/volume4/lsc-billing/data/backups/`), redeploy `server/` with the usual
  `COPYFILE_DISABLE=1 tar` (excluding `node_modules`, `./data`, `.env`, `docker-compose.yml`),
  `docker compose up -d --build`, check `healthy` and the boot log's migration lines, then push
  `main` for Pages. **NAS before Pages** whenever a migration or a new goals/asset field ships. Web-only
  tasks (1, 2, 7) can go without the NAS step. Record run ids and the live income floor before and
  after in `HANDOVER.md`.

- [ ] **16. Money-math review, then design review** (review): a `/code-review` (xhigh) of the whole
  track's diff, hunting specifically for a field that prices but doesn't print (or the reverse), a
  line saved before the change that now totals differently, and a two-copy `calc.js` drift. Fix
  findings, then run `/design-review` against the screens changed here. List fixes in this file
  under "Code review fixes" and "Design review fixes", as the earlier tracks do.
