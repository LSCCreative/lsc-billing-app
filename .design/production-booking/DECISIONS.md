# Decisions: Production Booking

Decisions the user made during `/grill-me` and `/design-brief` on their 2026-09-30 request (the
request itself is folded into [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md)). Each one is the user's;
don't re-ask. The brief refers to these by number.

## 2026-09-30

1. **Build order: A + B → C → D → E.**
   - A: surcharges.
   - B: Production Booking in the editor, plus the shared calendar backend. A and B go together,
     because the weekend/holiday and after-hours surcharges need booked dates and times.
   - C: the home dashboard's production calendar.
   - D: the deposit + final invoice pair and project grouping, first triggered by an in-app
     "client accepted" action.
   - E: the public quote page, e-signing, service agreement, email and automations. E's Sign button
     calls D.

   Each stage is usable on its own.
2. **How surcharges combine is a setting** in the Rate Card's surcharge area, not fixed. Three modes:
   - **Day/time higher wins, short notice on top** (the default). An hour that is both weekend and
     after-hours takes the higher multiplier (1.5×), and short notice multiplies on top
     (2 × 1.5 = 3×).
   - **All multiply** (2 × 1.5 × 1.25 = 3.75×).
   - **Only the highest applies** (never more than one surcharge).

   "Add the uplifts" was offered and not picked.
3. **Short notice applies to production items only**, like the other two. Pre- and post-production
   price as normal. Pass-throughs (crew, hire, travel costs) are never surcharged by any of the three.
4. **Production items live on each booked day.** A booked day is a card: date, status (confirmed /
   pencilled / proposed), start and end time, and that day's production items, each with its unit
   (hour, half day, full day) and quantity. The estimate's Production section is built from the
   days rather than typed separately, so a weekend or holiday surcharge lands on exactly that day's
   items. The quote and invoice list the days with their items.
5. **After hours surcharges only the after-hours share of a day.** A weekday booked 9am–7pm, with
   after hours starting at 5pm, has 2 of its 10 booked hours after hours. So 2/10 of that day's
   production price takes ×1.25. The same rule applies whether the day's items are full-day,
   half-day or hourly.
6. **Public holidays: national plus NSW.**
7. **Holiday dates are fetched and editable.** The NAS fetches Australian national and NSW holidays
   once a year from a free public-holiday service (no key needed) and stores them. The list shows on
   the Rate Card's surcharge area, where the user can add or remove dates (e.g. a local show day). If
   the fetch fails, dates can be typed in.
8. **Surcharges never appear on the client's quote or invoice.** Instead each quote gets a
   **"Cost Breakdown_UPID_ProjectName"** document for the user only. It shows the surcharges, the
   user can download it and send it if a client asks for more detail, and it lives with the quote
   and with every invoice made from it. *(How the surcharge is carried on the client's copy, and
   what the breakdown contains: see 11–12.)*
9. **A "Date TBC" day is allowed.** It holds items and prices at normal rates (no weekend, holiday
   or after-hours surcharge until it has a date). It shows on the quote as "Day N — date TBC" and
   appears on no calendar.
10. **"Overtime — per hour" stays.** The user will use it to adjust the final invoice after a shoot
    day has run long, and for extra editing requested beyond the **2 free revision rounds**.
    *(Where it lives, now that production items belong to days: see 13.)*
11. **After hours is defined by office hours**: a start and an end, default 7am–5pm, on weekdays.
    Anything outside them is after hours, early call times included. Weekends are covered by the
    weekend surcharge. The start, end and working weekdays are settings.
12. **The client's copy folds each surcharge into the item's price.** For example, "Sat 4 Oct — Video
    Capture Full Day $1,680" (normally $1,120, ×1.5). Every line adds up to the total, and the reason
    appears only in the Cost Breakdown. Short notice is folded into each production item the same
    way.
13. **The Cost Breakdown is client-safe**, so it can always be forwarded. It shows each day's items
    at normal price, then each surcharge: which one, its multiplier, the day or hours it covered, and
    the $ amount. Then short notice, pass-throughs, GST and the total. It has **no internal figures**
    (no floors, no Minimum Job Price, no tax set-aside, no take-home).
14. **Overtime moves to a new "Additional work" section.** It can be added to any estimate or
    invoice, is not tied to a day, and is never surcharged. Later items (e.g. an extra revision
    round) go there too.
15. **Clashes across projects: warn, and block only on a confirmed day.**
    - A date another project has **confirmed** (01) is locked: nothing can be added on it until the
      user removes or edits that day. *(Scope of the lock: see 16.)*
    - A date another project has **pencilled** (02) gets a warning, "already pencilled for UPID-X —
      add anyway?", and yes shares the tile.
    - **Proposed** (03) days never trigger a warning.
16. **A confirmed day locks the whole date, with a noted override.**
    - A second project *can* book a day on that date if the user writes a **specification note**
      with it, e.g. that a subcontractor will shoot it. The note is required to override the lock
      and is stored with that day.
    - Without a note, the date stays locked.
17. **"Proposed dates no longer available" is triggered by a confirmed day only.** Another project
    confirming (01) that date makes the proposal unavailable. A pencilled one does not.
18. **Accepting a quote confirms all of its dated days.** Pencilled and proposed days all turn green.
    If another project confirmed one of those dates in the meantime, the accept still goes through,
    but that day is flagged "clash, rebook" for the user to sort out. Date TBC days are untouched.
19. **Short notice: a hint, never automatic.** When the first dated production day is within N days
    of today (a setting, default 7), the editor shows "First shoot day is in N days — short notice?"
    beside the box. It is never ticked for the user.

**Settled by the existing rules, not asked** (the codebase's standing money rules apply):

- A surcharge is **income**: it is taxed, and adds no hours. It doesn't change the job's floors or
  Minimum Job Price, since it's extra money over the same work.
- **Saved quotes never move.** Each line snapshots its surcharged price, and the estimate snapshots
  the multipliers, the stacking mode and which days were weekends or holidays. A later Rate Card or
  holiday-list change moves only new quotes.
- **Times are optional.** A day with no times gets no after-hours surcharge.
20. **Surcharged client prices round up to the whole dollar**, after all of the item's surcharges.
    This matches the Rate Card's auto prices and never undercharges.
21. **An overnight shoot belongs to its start date.** An end time earlier than the start means past
    midnight. The start date's weekend or holiday status applies to the whole shoot, and every hour
    outside office hours is after hours.
22. **A "Declined" action, on the user's side only.** Any sent quote can be marked Declined by the
    user. The client never has a decline button, because deals go back and forth. Declining takes
    the quote's days off the shared calendar, though they stay on the quote for history. Deleting
    an estimate removes its days too.
23. **The editor's calendar shows other projects' days, faded.** Green and yellow days fill a tile,
    grey ones take a quarter tile. This estimate's days are in full colour. Hovering or tapping
    another project's day shows its UPID and project name.

**Found in the code:** Rate Card labour sections can be added and renamed by the user (ids `cat1`,
`cat2` …). "Production" is just the default section with id `prod`, so which sections count as on
set needs a rule (see 24).
24. **Only the Production section is on set.** It is hard-wired to the default section (id `prod`),
    whatever it's renamed to. Sections the user adds are never on set. *Build consequence:* the
    `prod` section can be renamed but not deleted. "Additional work" (decision 14) is a new default
    section that isn't on set. On the live card, Overtime has to move out of Production into it,
    which the user does, or an agent with their go-ahead.
25. *(Words refined by D63: Confirmed / Pencilled / Proposed.)* **The client's quote labels days in the app's own words**: "Production day", "Pencilled",
    "Proposed". Proposed days carry the disclaimer.
26. **A long day gets a hint only.** If a day's booked hours are longer than its items cover, the
    card says "Booked 12 hrs, items cover 8". There is no price change. The user adds Overtime from
    Additional work if they want to bill it.

**Surcharge settings on the Rate Card** (the new area below the existing tables), with defaults
taken from the request:

- Short notice ×2, with the hint threshold at 7 days.
- Weekend / public holiday ×1.5.
- After hours ×1.25, with office hours 07:00–17:00, Mon–Fri.
- Stacking mode: "day/time higher wins, short notice on top".
- The holiday list (fetched for national + NSW, editable).

A multiplier of ×1 is how a surcharge is switched off. These defaults price only new quotes whose
days fall on those dates or times, or that have short notice ticked.

### C — the home dashboard

27. **Home is the calendar plus a "Coming up" list** of the next 14 days' production days in date
    order, beside the calendar (below it on a phone). The app opens here after sign-in, and the
    "LSC Creative" logo leads here. Estimates stays in the nav.
28. **A tile's pop-up opens the project folder**, which holds the estimate and, when they exist,
    the quote and the invoices. This makes a **project** a real thing in the app (see D).
29. **On a phone the month view shows coloured dots**, and tapping a date lists its entries below
    the calendar. The week view becomes a vertical day-by-day list.

### D — projects, deposit and final invoices

30. **One name: "Estimate".** An estimate is what the user builds and what the client receives.
    "Quote" is not a separate thing in the app, and screens and the client page say "Estimate". (In
    the request and earlier decisions, "quote" means a sent estimate.)
31. **A project is one UPID, under its client.** The project folder is everything with that UPID:
    the estimate (and its sent versions, see 34), Cost Breakdowns, the deposit and final invoices,
    and the signed agreement. It shows under the client on the Clients screen and opens from the
    calendar and the Estimates list.
32. **Deposit + final pair by default, single invoice allowed.** Accepting an estimate creates the
    pair. A per-project "Single invoice (no deposit)" option stays for small jobs, which is what
    today's Estimate → Invoice switch does.
33. **The deposit % is a setting**, default 50%, in Invoice Settings. It can be changed on one
    project before acceptance, and is copied into the project when the estimate is accepted.
34. **Sending freezes a version.** Send makes v1. Later edits are a draft until the user presses Send
    again, which makes v2. The client's link then shows v2, and v1 stays in the project folder marked
    "superseded". A client can only ever accept exactly what was sent.
35. **The final invoice is the full job, plus extras, minus the deposit.**
    - It holds every item from the accepted estimate, plus anything added after the shoot
      (Overtime, extra revision rounds from Additional work).
    - Then "Less deposit paid (INV-…-D) −$X", then the balance due.
    - It stays editable until it is sent.
36. **Invoice numbers carry the UPID**: `INV-<UPID>-D` for the deposit, `INV-<UPID>-F` for the
    final, and `INV-<UPID>` for a single invoice. The number is fixed when the invoice is created.
37. **The deposit invoice is a summary plus the amount due**: "Deposit — N% to secure your booking"
    for estimate UPID, with the estimate total, the production days booked, and the deposit due. It
    has no itemised lines, because the accepted estimate is the itemised document.

### E — the client's estimate page and signing

38. **The app sends email through the user's Google Workspace account** (@creativelsc.com, via an
    app password set once, stored like the other secrets and never in the repo). It sends three
    emails:
    - the link to the client on Send;
    - a notice to the user when an estimate is accepted;
    - the signed copy to the client.
39. **The service agreement is the user's own text, with fill-in fields**, pasted once into Invoice
    Settings. Fields include {client_business}, {client_abn}, {upid}, {total}, {deposit_pct} and
    {production_days}. The 2 free revision rounds are written into it. Each signing stores the exact
    text used, so later edits never change a signed agreement.
40. **The signature is a typed name plus an "I agree" tick.** There is no drawn signature. The
    client types their full name and role and ticks "I agree to the service agreement". The app
    records the date and time, their IP address, and the exact estimate version signed.
41. **Accepting is paused while a proposed date is taken.** If any proposed day on the estimate has
    been confirmed by another project, Accept is replaced by "Some proposed dates are no longer
    available — we'll send an updated estimate", and the user re-sends with new dates. (This
    narrows decision 18: through the client page, an accept can't include a taken proposed date.
    Pencilled days that clash are still flagged on accept.)
42. **Signed agreements are PDFs kept by the app** on the NAS, so the existing backup covers them
    (how they are stored: D66). They open from the project folder in the app.
43. **Every send is manual and can be scheduled, for estimates, deposit invoices and final invoices
    alike.** Signing creates the deposit invoice but does not send it. Each document has a send panel
    with:
    - a date and time to send;
    - a message box pre-filled per document type (e.g. "Here's the project deposit invoice"),
      editable;
    - a **"Confirm to send"** button;
    - a **"Copy link"** button to the side, for sending another way or at another time.

    The email goes out from the user's Google address (decision 38).
44. **A sent estimate is valid until a date**, default 30 days after sending (a setting). After that
    the page reads "This estimate has expired — contact us for an updated one" and Accept is off.
45. **Payment is by bank transfer by default, with an optional online card payment module on an
    invoice.** Details are in 46–49.
46. **Invoices get a web page too**, in the same style as the estimate page. It shows the invoice, a
    "Download PDF" button, the bank details, and "Pay by card" when card payment is switched on for
    that invoice. Once marked paid, it shows "Paid".
47. **A missed scheduled send goes out when the NAS is back**, and the document shows "Sent late at
    11:42 (scheduled 9:00)". A scheduled send can be edited or cancelled any time before it goes.
48. **Card payments go through Stripe**, using its hosted checkout, so no card details touch the
    app. The invoice is marked paid automatically by Stripe's callback to the NAS.
49. **The card fee is always passed on** as a card surcharge, shown to the client before they pay.
    *Build constraint:* Australian law caps a card surcharge at the business's actual cost of
    acceptance, so it is a % setting matching Stripe's fee, not a free figure. The fee is billed at
    cost and is not income.
50. **Client pages use the user's brand, light and clean**, matching their PDF and website (logo,
    fonts, colours) and readable on a phone. Not the app's dark internal look.
51. **Client links use the existing app address** (the GitHub Pages site). No subdomain is set up.
52. **Client actions also show in the app**, as a "Recent activity" strip on the home dashboard:
    estimate opened, accepted, invoice paid by card. Each entry links to its project. This is in
    addition to the email.

### From `/design-brief` (2026-09-30)

53. **Client pages are no-login link pages now, Client Hub later.** The user's site has a Client Hub
    (email + 4-digit PIN). Estimates and invoices stay as no-login links on the billing app's
    address (51), styled to match lsccreative.studio. Linking them into the Hub is a separate, later
    job.
54. **Client pages are light, in the site's own colours.** A warm paper background (the site's
    `--lsc-white` #F0EDE8 / `--lsc-surface-lt` #E8E2D9), near-black text (`--lsc-black` #0E0E0E),
    and the terra accent (`--lsc-terra` #C0603C). Delight for headings; CS Felice Mono for labels
    and figures (the user supplied the files on 2026-10-01; see D57), with Funnel Sans as the
    fallback stack.
    They read like a document, echoing the PDF's white page. Not the site's dark cinematic look.
55. **The FAQ lives on the user's site: https://lsccreative.studio/faq.html** (live 2026-10-01).
    The "Service agreement FAQ" button opens it in a new tab. The URL is a setting in Invoice
    Settings, **defaulting to that page**; the button hides only if the setting is cleared. (This
    replaces "hidden until a URL is set", decided the day before the page existed.) The app holds
    no FAQ text of its own. The page already matches the agreement on two points the agreement
    must keep consistent: **two revision rounds** (First Cut, Fine Cut), and **licensing rights
    pass on final payment**, while raw footage stays the business's.
56. **Client wording says "we", plain and warm**: "Here's your estimate. If it looks right, accept
    it below and we'll lock in your dates."

57. **Font files stay out of git.** The user's brand fonts are in `Visual Design/` at the repo
    root: CS Felice Mono Regular, Italic and Reverse Italic, and Delight in every weight, with its
    licence. That folder is git-ignored (2026-10-01), because **the repo is public and the Delight
    licence forbids redistributing the font files "in any form"**. The build copies only the
    `.woff2` a page actually loads into `web/fonts/`, as today. For the client pages that is
    `CSFeliceMono-Regular.woff2`, plus any extra Delight weight the design ends up using.
    *Open, separate from this track:* `web/fonts/Delight-400/700.woff2` are already committed to
    the public repo (from the base rewrite). Whether to take them out of git history is the user's
    call. There is **no licence file for CS Felice Mono** in the folder; the user's site already
    uses it, so it's taken as licensed.

### From `/information-architecture` (2026-10-02)

58. **"Estimates" in the nav becomes "Projects".** The list shows one card per UPID with the stage
    it's at. Opening a card opens the project folder, and the estimate editor opens from inside it.
    The nav reads: LSC Creative · Projects · Clients · Finance & Price · Settings · Sign out.
59. **The app gets real addresses for its main screens**, as hash routes (`#/home`,
    `#/projects/<id>`, `#/finance/pricing` …). The browser's Back button works, a reload keeps your
    place, and an email can link straight to a project. This reverses the price-calculator IA's
    "no router" stance, knowingly.
60. **Duplicate starts a new project.** It copies the items into a new draft with the UPID left
    blank. **UPIDs become unique** (enforced in the database).
61. **Shared or blank UPIDs in the live data get a one-off fix-up screen** before projects switch
    on. It lists each shared UPID with its estimates; the user gives each a new UPID or confirms
    they belong together. Nothing is guessed.
62. **The editor's Document Type switch is retired.** The editor only edits the estimate. Invoices
    are created in the project folder after acceptance: "Create deposit + final" or "Create single
    invoice" (D32). Invoices made with the old switch stay readable in their project, marked
    "made the old way".
63. **Day statuses are Confirmed / Pencilled / Proposed**, in the app and on the client page. Every
    booked day is a "production day". The add-day buttons read "+ Confirmed day", "+ Pencilled
    day" and "+ Proposed day". This refines D25, which used "Production day" for the green status.
64. **The estimate editor is the screen used most.** The booking block must not slow down adding
    items: it is collapsed by default, and opens on its own only when the estimate has
    production items.
65. **Invoice Settings becomes a Settings screen** (`#/settings`), with sections Business · Payment ·
    Estimates & invoices · Service agreement · Email · Card payments. It is no longer a pop-up.
66. **Signed agreements are stored inside the database** (the PDF's bytes in the signature record),
    not as loose files. *Found in the code:* `backup.js` backs up only the database, so a file on
    disk would not have been covered. This keeps D42's intent, that the backup covers them.

**Found in the code (2026-10-02):** no screen ever sets an estimate's status, so the live
estimates are almost certainly all `draft`, and the Dashboard's "average job value" (it counts
approved / invoiced / paid) has had nothing to count. The new statuses (sent / accepted) will start
filling it. `averageJobValue`'s won set has to move to the new model (see the IA).

## 2026-10-02 — after the money review

A code and accounting review of the whole pipeline (finance inputs → floors → card → estimate →
surcharges → stored figures → PDFs) found that some of the surcharge rules could overcharge or
undercharge. The user decided these on 2026-10-02:

67. **After hours is measured over each item's own hours, from the booked start** (replaces D5's
    share of the whole booking). A full day booked 9am–9pm covers 9am–5pm and takes no after-hours
    rate; the evening is billed as Overtime when it runs (D10, D26). Under D5 that full day would
    also have paid an after-hours share for hours it didn't cover: a double charge. An item longer
    than the booking covers the booking. **The explanation goes in the Cost Breakdown only**, the
    owner's sheet for a client who asks: each item says what it covers.
68. **After hours applies on every day, weekends included** (D2's "All multiply" example, over
    D11's "on weekdays"). The two decisions disagreed; the user chose D2.
69. **Office hours apply on the next morning too.** An overnight shoot's hours inside the next
    date's office hours are in-hours (they were all after hours).
70. **Hours after midnight take the next date's status** (replaces D21's "the start date's status
    applies to the whole shoot"), as penalty rates split at midnight. Where the status changes
    (Friday night into Saturday), those hours are a **carry-over**: their own sub-line under the
    item in the Cost Breakdown, naming the date, the rate and the hourly rate it changes to. The
    client's copy still shows one folded price per item.
71. **Overtime is moved off set by migration v11**, with the user's go-ahead (D14 left it to them).
    Every production line now sits on a day and takes its rates, so Overtime left in Production
    would be surcharged on top of its own premium. Saved estimates' Overtime lines keep their own
    prices.
72. **Short notice applies to every production item**, including one on no day (D3). It used to
    be skipped there, so an older estimate ticked for short notice was undercharged by the whole
    premium.

Also from the review, without a new decision: the editor won't save a booked date until it has
the public holiday list (so the price saved is the price shown); the Cost Breakdown refuses an
estimate whose saved total no longer matches its items, rather than calling the gap "rounding";
items with no quantity and no price are left off the documents; and a duplicate says how many
items came off their days.

## Left for the user to supply (not decisions, inputs)

- The **service agreement text** (decision 39), ideally checked by a lawyer.
- A **Google Workspace app password** for sending email (38).
- A **Stripe account** and its keys (48), plus the card-surcharge % matching Stripe's fee (49).
- ~~The FAQ page URL~~: supplied 2026-10-01 (D55).
- ~~The CS Felice Mono font files~~: supplied 2026-10-01 (D57).
- ~~On the live Rate Card: move Overtime out of Production into Additional work~~: done by
  migration v11 with the user's go-ahead (D71).

## Where this touches `estimate-accuracy`

- Task 8 is scrapped and task 11 is superseded by this track.
- Task 10 (discount) and task 12 (minimum call per service) are still un-grilled. Both now have to
  say how they interact with day-based production items and surcharges. For example: is a discount
  taken before or after surcharges? Does a minimum call apply per booked day?
