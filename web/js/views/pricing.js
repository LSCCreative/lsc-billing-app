'use strict';

/* The Rate Card screen — the rate card every estimate is priced from. Titled
 * "Pricing & Services" until 2026-09-28, when its heading was brought in line
 * with the Finance & Price rail item a screen reader user picks it by.
 *
 * Ported from renderPricing in the desktop app. Same layout, same grid, same
 * per-category tables; app.css already carries every rule they use. What
 * changed is where the card lives and what "Save" means.
 *
 * THE FAKE SAVE
 * The desktop button wrote to localStorage and flashed "Services saved" whether
 * or not the write landed — the bug this screen exists to fix. Saving is now
 * PUT /api/pricing, and the confirmation waits for the server to answer.
 *
 * A WORKING COPY, NOT THE CACHE
 * Edits are made against a deep clone of LSCData.pricing(). The cached card is
 * replaced only by what the server echoes back on a successful save, so an
 * abandoned or failed edit can never price an estimate. This matters more than
 * it looks: the editor computes live totals from that cache.
 *
 * THE TAX SET-ASIDE RATE
 * This screen owns the one input to calc.js's tax provision. The desktop app
 * read it as `parseFloat(v)/100 || 0.35`, which quietly turned a deliberate 0%
 * into 35% — 0 is falsy. It is validated here instead, and a blank or
 * out-of-range value blocks the save rather than being guessed at.
 *
 * THE COMPUTED RATE COLUMN
 * Every labour row's Rate ($/hr) is now the one Overhead Rate/hr — Annual
 * Business Cost / Annual Billable Hours — read from Overhead and Capacity via
 * LSCData.overheadRate(), shown
 * read-only, and identical down the whole card. Travel rows are untouched and
 * still manually priced. This collapses the card's old $30-$110 per-row cost
 * differentiation on purpose: it is a standard flat overhead-absorption rate
 * per direct-labour-hour, confirmed against real-world accounting practice
 * before it was built, not a shortcut.
 *
 * It is safe to do this to a field the estimator reads because `rate` feeds no
 * billing calculation anywhere — computeTotals prices labour off `mu` alone.
 * If that ever stops being true, this whole column needs re-examining rather
 * than assuming the argument still holds.
 *
 * NOTHING HERE WRITES THE COMPUTED RATE BACK
 * The displayed figure is derived at mount and never enters the working copy,
 * so payload() still ships each row's own stored `rate` untouched. Persisting
 * it instead would flatten every row's saved rate to one number on the next
 * save of any unrelated edit — irreversible, invisible in the UI (which shows
 * the computed figure either way), and impossible in the empty state, where
 * there is no number to write at all. The stored value is simply inert.
 *
 * SERVICE UNITS (2026-09-28, .design/service-rate-tiers/)
 * A labour row is a service with three prices, `prices: { hour, half, full }`:
 * a number is a price set by the user, null is auto. The card's `serviceDay`
 * says how many billable hours a half and a full day are (8 / 4 by default,
 * not Capacity's figure). calc.js's unitDef resolves any of them, and this
 * screen never works a price out for itself.
 *
 *   - `per [unit ▾]` under the name is a VIEW SWITCH, not a property of the
 *     row: it picks which of the three prices the Rate and Mark-Up cells show.
 *     It lives in viewUnits, outside the working copy, so it never makes the
 *     card "unsaved", and it is back to Hourly on every mount. (Until
 *     2026-09-28 it changed what the row was, and switching asked first when
 *     estimates used it. There is nothing to ask about now.)
 *   - An auto price is shown in the field, muted, and follows the income floor
 *     and Target Markup — an auto day follows the hourly price × its hours.
 *     Typing a number pins that unit (set by you); emptying the field or
 *     "↺ use $X" puts it back to null. A typed 0 is a price. payload() sends
 *     prices exactly as the working copy holds them, so an auto figure is never
 *     written to the card: it is only ever unitDef's return value.
 *   - The Rate cell is the overhead rate × the unit's hours, so a full day
 *     reads "108.08/day"; still read-only, still never written.
 *   - SERVICE DAY: the card's `serviceDay` hours, edited in the second
 *     settings block. Every row updates in place as you type (never a
 *     re-render, which would take the field out from under the cursor): the
 *     auto day prices, the day rates, each "↺ use $X" and each floor. Typed
 *     prices don't move. One polite announcement per edit, not one per row.
 *   - SHOW: Hourly | Half day | Full day sets every row's switch at once, and
 *     new rows start on it. A button reads pressed only while every row shows
 *     its unit (the IA's rule), so it is worked out, not remembered.
 *   - HIDDEN-UNIT NOTICE: under the name, when the unit on show is fine but
 *     another is below its floor or has no price ("Full day below floor by
 *     $12.40 ▸", a button that switches the row to it). Only then: when the
 *     unit on show has the problem itself, the state line already says so,
 *     and a card with no Profit Goals would otherwise flag every row twice.
 *     The unit options carry the same fact in their text.
 *
  * ROW IDS (2026-09-28 audit)
 * Every row carries a stable `id`, assigned at mount to any row that lacks one
 * (every row saved before this) and carried by payload(). Saved estimate lines
 * record it with their own price snapshot, so a renamed service still matches
 * its row for "Update to current rates" and "Use rates from last project".
 * Assigned into the baseline too, so a card whose rows just got ids isn't
 * "unsaved": the ids reach the server on the next real save.
 *
 * YOUR-TIME TRAVEL ROWS (2026-09-28 audit)
 * A travel row ticked "Your time" (ownTime) is the owner's own hours billed as
 * travel: the whole of it is income for the tax set-aside, and its quantity
 * counts as billable hours. Otherwise a non-direct row is bought in and
 * resold, and only its markup above Rate is income (calc.js, Travel).
 *
 * Since task 6a (2026-09-30) an own-time row's price follows the income floor
 * with no markup until it is typed over — calc.js travelRowDef, `mu: null` —
 * and carries a service's state line under it ("auto · floor $X", "set by you
 * · below floor by $X · ↺ use $X"), from travelFloorComparison. Unticking Your
 * time on an auto row keeps the figure on screen as a typed price (the user's
 * call), since a resold row can't be auto, and says so under the field until
 * the next save. The card is saved with calc.js PRICING_SHAPE, without which
 * the server refuses it.
 *
 * THE CAR'S KM ROW (task 6b). A travel row flagged `perKm` has no price of
 * its own: it is Overhead's per-km running cost, shown read-only here with a
 * link across, and billed at cost (calc.js travelRowDef). Its Rate, Direct and
 * Your time don't apply, so they are shown as such and disabled. A card
 * without one (every card saved before 6b) gets an "+ Add Vehicle per km"
 * button beside "+ Add Item".
 *
 * EACH ROW'S STATE LINE, UNDER ITS MARK-UP
 * For the unit on show: "auto · floor $X", "set by you · ↺ use $X", with
 * "below floor by $X" in place of the floor when it is, or "auto · needs
 * Profit Goals" when there is no price to show — or "needs Capacity" / "needs
 * Overhead", whichever screen is actually in the way (LSCData
 * .autoPriceBlocker, shared with the Dashboard and the estimator). Computed by
 * LSCCalc.serviceFloorComparison on a one-row card, once per paint of the row
 * (unitsOf), which prices auto units
 * from the floor it compares them against, so an auto price is never badged
 * below its own floor. It follows the working copy as you type, against an
 * hourly floor and Target Markup read once at mount like the rate column.
 * The price field is described by the same facts as one plain sentence
 * (stateSentence, in a `hidden` span), not by the visible line.
 *
 * SURCHARGES AND PUBLIC HOLIDAYS (2026-10-02, .design/production-booking/
 * task 4). Two blocks below the tables.
 *
 *   - SURCHARGES is part of the card: `card.surcharges`, saved by Save
 *     Services like everything above it, and in the unsaved-edit check. The
 *     working copy starts from calc.js surchargeSettings, so a card saved
 *     before them shows the defaults (calc.js SURCHARGE_DEFAULTS) and isn't
 *     "unsaved" for it; the first save writes them. A field that isn't a usable
 *     figure is held as '' (as the Service Day's are) and blocks the save. Each
 *     "How surcharges combine" option shows what it makes of one fixed case, a
 *     short-notice weekend shoot wholly outside office hours, worked out by
 *     calc.js surchargeFactor from the figures as typed: never re-derived here.
 *   - PUBLIC HOLIDAYS is not part of the card. Each add, remove and "Fetch
 *     again" saves straight away through /api/holidays (task 3), and the block
 *     says so. It sits below the save bar for the same reason. Hidden rows (a
 *     fetched date the owner removed) come back from the server and are left
 *     out of the list. Only this block re-renders on a holiday change, so a
 *     half-edited card above it is never touched.
 *   - PRODUCTION IS ON SET (D24): the `prod` section can be renamed but has no
 *     delete control; an "On set" tag stands in its place. `post` is kept the
 *     same way, with a "Post" tag (2026-10-05, the user's call). A card without the
 *     `additional` section (every card saved before this task) offers
 *     "+ Add Additional work", which makes it under that id, empty: moving
 *     Overtime into it is the user's call (D14).
 *
 * CAPTURE AND DELIVERABLE TYPES (2026-10-03, .design/production-booking/
 * B2-9). Both are part of the card, saved by Save Services, and read by
 * calc.js postPlan, which this screen never works anything out with.
 *
 *   - CAPTURE is a tick column beside Custom on the On set category only
 *     (D89), absent rather than false when off, as Custom is. Its ⓘ is in the
 *     column head; below 768 the head is hidden, so the same sentence shows
 *     under the category's name instead, and every tick is described by it.
 *   - DELIVERABLE TYPES is a block after the tables and before Surcharges
 *     (D99). A type names its Post-Production services by row name, as lines
 *     do. A name no longer on the card shows struck through as "missing" and
 *     doesn't block a save (the editor skips it). While this screen is open a
 *     chip follows its row by id, so renaming a post service here renames it
 *     on every type that lists it, in the same save (chipRows). The block
 *     re-renders on its own (paintTypes), never the tables above it.
 */

const PricingView = (() => {
  const { esc, num } = LSCUtil;
  const RESERVED_SECTION_IDS = LSCRows.RESERVED_SECTION_IDS;
  /* The section on set (D24) and the post-shoot one (D14), by the ids
     server/src/defaults.js gives them. */
  const ON_SET_ID = 'prod';
  const ADDITIONAL_ID = 'additional';
  /* The section a Deliverable Type's services come from (D91). */
  const POST_ID = 'post';

  let root = null;
  let handlers = null;
  let card = null; // the working copy
  let taxRaw = ''; // the percent field exactly as typed
  let usage = null; // saved estimates, for delete warnings. null = unknown
  let saving = false;
  let baseline = ''; // the card as last saved, for the unsaved-edit check

  /* The public holiday list (see SURCHARGES AND PUBLIC HOLIDAYS above).
     Not the card: saved by its own routes, never in snapshot(). */
  let holidays = null; // { holidays, lastFetchedAt } once loaded
  let holidayLoad = 'loading'; // 'loading' | 'ready' | 'failed'
  let holidayBusy = false; // a holiday request is in flight
  let addingHoliday = false; // the "+ Add a date" form is open

  const $ = (id) => root.querySelector('#' + id);
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /* The working copy of a card as the server sent it: the three parts the
     tables edit, plus its surcharge settings with the defaults filled in (see
     SURCHARGES above). One builder for mount, save and reset, so the three
     can't disagree about what "unsaved" is measured against. */
  function workingCopy(pricing) {
    return clone({
      serviceDay: pricing.serviceDay,
      labourSections: pricing.labourSections || [],
      travelRows: pricing.travelRows || [],
      surcharges: LSCCalc.surchargeSettings(pricing),
      // See CAPTURE AND DELIVERABLE TYPES above. Every field present, so the
      // block never has to ask whether one is.
      deliverableTypes: (Array.isArray(pricing.deliverableTypes) ? pricing.deliverableTypes : [])
        .filter((t) => t && typeof t === 'object')
        .map((t) => Object.assign({}, t, {
          name: String(t.name || ''),
          description: String(t.description || ''),
          services: Array.isArray(t.services) ? t.services.map(String) : [],
          multiplier: typeof t.multiplier === 'number' && Number.isFinite(t.multiplier) ? t.multiplier : '',
        })),
    });
  }

  /* Which Post-Production row each type's chip is, by row id, for as long as
     the screen is open: { typeId: [rowId | null, …] }, in the order of its
     services. Linked by name whenever a card arrives (mount, save, reset), so
     a rename of the row while editing renames the chip (followRename). */
  let chipRows = {};

  /* The working copy as it stands, for the unsaved-edit check. Deliberately not
     payload(): that trims and coerces, so a category renamed only by a trailing
     space would compare equal to the saved card and leaving would discard it
     without asking. */
  const snapshot = () => JSON.stringify({ card, taxRaw });

  /* Is this screen still in the page?
     A save is async and nothing stops the user navigating while it is in
     flight, so its outcome can land after they have moved on — and render()
     writes over its container, which put the whole rate card back on top of
     whatever had replaced it. Verified by delaying the PUT and leaving
     mid-save. The same applies to the failure path, where $('pricing-error') is
     simply gone and the old code threw on it.

     Asked of the document, not of `root`. This used to be root.querySelector,
     which was correct while root was #main — a permanent element that other
     screens write over. Since the Finance move, root is #finance-sub, and a
     nav item that leaves Finance replaces #main wholesale and takes that div
     out of the document with the rate card still inside it: root.querySelector
     would keep finding #tax-inp in the detached tree and answer "still on
     screen" forever. The LSCUnsaved watcher below is the one that makes that
     visible — a stale dirty rate card would then interrupt every later
     navigation to ask about a screen nobody can see. getElementById can't see a
     detached node, which is exactly the question being asked.

     This depends on #tax-inp being unique in the document: the Goals screen
     reuses .tax-setting for the same underlying field and must give its input a
     different id. */
  const onScreen = () => Boolean(document.getElementById('tax-inp'));

  /* The stored rate is a fraction; the field shows a percent. A plain ×100 puts
     the float error on screen — 0.07 renders as 7.000000000000001 — so the
     result is snapped to 6 decimal places, far finer than the field's 0.5 step
     and coarse enough to absorb the artifact without rounding a real value. */
  const toPercent = (rate) => String(Math.round(num(rate) * 1e8) / 1e6);

  /* The Overhead Rate/hr every labour row shows in place of its stored rate.
     null is "not set up yet" — LSCCalc returns null rather than 0 for an empty
     overhead list or an unset billable capacity, and that has to survive all
     the way to the screen: a rate card reading "$0.00" looks like a computed
     answer meaning an hour of your time costs nothing, rather than a question
     nobody has answered.

     Read once per mount, not per render. Nothing on this screen can change an
     overhead item or a goal; the only screens that can are the other two
     Finance sub-tabs, and visiting one and coming back re-mounts this view
     through FinanceView. So it cannot go stale between two renders, and
     mount() is what the brief's "recomputed fresh on every page load" means. */
  let computedRate = null;

  /* The hourly INCOME floor — target annual revenue ÷ billable hours, since
     the 2026-09-28 audit (it was overhead × (1 + markup)) — that each row's
     floor line multiplies by its hours. null when either is unset, which the
     line shows as an em dash rather than a floor of $0. Read once per mount,
     for the same reason computedRate is. */
  let perHourFloor = null;

  /* The income floor with Target Markup and the GST settings, for unitDef.
     Read once per mount, with perHourFloor, and for the same reason. (The GST
     settings are changed on the Settings screen, which replaces this one.) */
  let priceCtx = null;

  /* The screen an auto price with no figure needs set up (LSCData
     .autoPriceBlocker: Capacity, Overhead or Profit Goals). Read with
     priceCtx, from the same data, so "needs …" names the screen actually in
     the way (code review R7). */
  let blocker = { tab: 'goals', screen: 'Profit Goals' };

  /* Which unit each row is showing, by row id — see SERVICE UNITS above. Not
     part of the working copy. Rows lacking an id get one at mount, so every
     row has a key. */
  let viewUnits = {};
  /* The unit a row with no choice of its own shows: Hourly, or the last Show. */
  let showDefault = 'hour';
  const unitOf = (row) => viewUnits[row.id] || showDefault;
  const UNIT_WORD = { hour: 'hour', half: 'half day', full: 'full day' };
  const UNIT_CAP = { hour: 'Hourly', half: 'Half day', full: 'Full day' };
  const UNIT_ADJ = { hour: 'Hourly', half: 'Half-day', full: 'Full-day' };
  const UNIT_LOWADJ = { hour: 'hourly', half: 'half-day', full: 'full-day' };
  const RATE_SUFFIX = { half: '/half day', full: '/day' };

  /* A row's name as its controls' labels say it. A new row starts nameless,
     and "Hourly price for " is a label that stops mid-sentence. */
  const nameOf = (row) => String(row.name || '').trim() || 'untitled service';

  /* A row's prices object with all three keys, created on first write. */
  function pricesOf(row) {
    row.prices = Object.assign({ hour: null, half: null, full: null }, row.prices || {});
    return row.prices;
  }

  /* One service at one unit, as the estimator will quote it. */
  const resolve = (row, unit) => LSCCalc.unitDef(row, unit, card, priceCtx);

  /* What the unit would be on auto: the "↺ use $X" figure. */
  const autoPrice = (row, unit) =>
    resolve(Object.assign({}, row, { prices: Object.assign({}, row.prices, { [unit]: null }) }), unit).mu;

  /* Whole dollars without the cents, anything else to the cent (util.js). */
  const money = LSCUtil.money;

  /* A row's three units against their floors — see EACH ROW'S STATE LINE
     above. One one-row serviceFloorComparison per paint of a row, handed to
     everything that describes it: the state line, its sentence and the unit
     line (code review R12; each used to run its own, about five a row per
     keystroke). The settings are priceCtx's, the ones resolve() prices the
     field with: an auto figure and its own state line can't be worked out
     from two GST configurations. */
  function unitsOf(row) {
    const [c] = LSCCalc.serviceFloorComparison(
      { serviceDay: card.serviceDay, labourSections: [{ id: '', label: '', rows: [row] }] },
      priceCtx.settings,
      perHourFloor,
      priceCtx
    );
    return c.units;
  }

  /* The unit on show, in the terms both the line and the sentence use:
     `unpriced` (auto, with no figure until `blocker` is set up), `auto` or
     `set`; `gap` when it is below its floor; for a set price, the auto figure
     `↺` would put back (`suggestion`, null when there is none). */
  function unitState(row, unit, units) {
    const u = units[unit];
    if (u.auto && u.mu === null) return { kind: 'unpriced' };
    return {
      kind: u.auto ? 'auto' : 'set',
      gap: u.belowFloor ? u.gap : null,
      floor: u.floor,
      suggestion: u.auto ? null : autoPrice(row, unit),
    };
  }

  /* An own-time travel row — Your time ticked, not Direct — is priced from the
     floor (task 6a); any other travel row is a plain typed price. */
  const ownAuto = (row) => row.ownTime === true && !row.directCost && !row.perKm;
  const resolveTravel = (row) => LSCCalc.travelRowDef(row, priceCtx);

  /* An own-time row's state, in unitState's terms, from the same comparison
     the Dashboard runs (calc.js travelFloorComparison) on a one-row card. */
  function travelState(row) {
    const [c] = LSCCalc.travelFloorComparison({ travelRows: [row] }, priceCtx.settings, perHourFloor);
    const u = c.units.hour;
    if (u.auto && u.mu === null) return { kind: 'unpriced' };
    return {
      kind: u.auto ? 'auto' : 'set',
      gap: u.belowFloor ? u.gap : null,
      floor: u.floor,
      suggestion: u.auto ? null : resolveTravel(Object.assign({}, row, { mu: null })).mu,
    };
  }

  /* Rows whose Your time was just unticked while on auto, by row id: their
     price was kept as typed, and the line under it says so until the next
     save or reset. View state, not the card. */
  let stoppedFollowing = {};

  /* Between the state line's parts. The no-break space holds each dot to the
     part before it, so a line that wraps (every set-by-you row does, in the
     80px Mark-Up column) ends on "·" rather than starting the next one with
     it: "below floor by $26.16 ·" / "↺ use $103", not "· ↺ use $103".
     Its own span, because at 1100px and up, where the Mark-Up column is
     narrowest, pricing.css stacks the parts one to a line and hides it: a
     dot at the end of every line only reads as a stray (design review D2). */
  const STATE_SEP = '<span class="pricing-state-sep">&nbsp;· </span>';

  /* Each control's accessible name starts with the words it shows (WCAG 2.5.3,
     so "click use 103" works by voice), then says what it acts on, which the
     visible words alone don't: the Dashboard badge's pattern. */
  function stateLineHtml(row, si, ri, st) {
    /* si null: an own-time travel row, which sells by the hour only. */
    const travel = si === null;
    const unit = travel ? 'hour' : unitOf(row);
    const rowAttrs = travel ? ' data-travel-ri="' + ri + '"' : ' data-si="' + si + '" data-ri="' + ri + '"';
    const part = (html) => '<span class="pricing-state-part">' + html + '</span>';
    if (st.kind === 'unpriced') {
      const needs = 'needs ' + blocker.screen;
      return part('auto') + STATE_SEP + part(
        '<button type="button" class="pricing-state-link" data-state-tab="' + blocker.tab + '"' +
        ' aria-label="' + esc(needs + ': open ' + blocker.screen) + '">' + esc(needs) + '</button>'
      );
    }
    const parts = [part(st.kind === 'auto' ? 'auto' : 'set by you')];
    if (st.gap !== null) parts.push(part('<span class="pricing-below">below floor by ' + LSCUtil.fmt(st.gap) + '</span>'));
    else if (st.kind === 'auto') parts.push(part(st.floor === null ? 'floor —' : 'floor ' + LSCUtil.fmt(st.floor)));
    if (st.kind === 'set') {
      const label = st.suggestion === null ? 'auto' : money(st.suggestion);
      parts.push(part(
        '<button type="button" class="pricing-state-link" data-use-auto' + rowAttrs +
        ' aria-label="' + esc(st.suggestion === null
          ? 'Use auto: put ' + nameOf(row) + '’s ' + UNIT_LOWADJ[unit] + ' price back to auto'
          : 'Use ' + label + ', the suggested ' + UNIT_LOWADJ[unit] + ' price for ' + nameOf(row)) +
        '"><span aria-hidden="true">↺&nbsp;</span>use ' + label + '</button>'
      ));
    }
    return parts.join(STATE_SEP);
  }

  /* The state line as one plain sentence: what the price field's
     aria-describedby reads on focus (the brief's "set by you, suggested $451"),
     and what typing announces. The visible line can't be the description: it
     carries "↺ use $X", whose full accessible name would be read into it,
     service name and all. Rendered into a `hidden` span, which a description
     reference still reads, so browsing the page doesn't meet it a second time. */
  function stateSentence(st) {
    if (st.kind === 'unpriced') return 'Auto, no price until ' + blocker.screen + ' is set up.';
    const parts = [st.kind === 'auto' ? 'Auto' : 'Set by you'];
    if (st.gap !== null) parts.push('below floor by ' + LSCUtil.fmt(st.gap));
    else if (st.kind === 'auto') parts.push(st.floor === null ? 'no floor yet' : 'floor ' + LSCUtil.fmt(st.floor));
    if (st.kind === 'set') {
      parts.push(st.suggestion === null
        ? 'no suggested price until ' + blocker.screen + ' is set up'
        : 'suggested ' + money(st.suggestion));
    }
    return parts.join(', ') + '.';
  }

  /* What is wrong with one unit, if anything: below its floor, or no price
     to quote. For the hidden-unit notice and the option text. */
  function unitProblem(u) {
    if (u.belowFloor) {
      const text = 'below floor by ' + LSCUtil.fmt(u.gap);
      return { text, option: text };
    }
    if (u.mu === null) return { text: 'has no price yet', option: 'no price yet, needs ' + blocker.screen };
    return null;
  }

  /* The line under a service's name: the unit switch, a day's hours, and any
     hidden-unit notice — see SERVICE UNITS above. */
  function rowMetaHtml(row, si, ri, units) {
    const unit = unitOf(row);
    const problem = {};
    LSCCalc.SERVICE_UNITS.forEach((u) => {
      problem[u] = unitProblem(units[u]);
    });
    /* The flag goes on the other units' options only: the one on show has
       its state line, and a flag on it would widen the closed select. */
    const opt = (value) =>
      '<option value="' + value + '"' + (unit === value ? ' selected' : '') + '>' + UNIT_WORD[value] +
      (problem[value] && value !== unit ? ' · ' + problem[value].option : '') + '</option>';
    let html =
      'per <select class="pricing-unit-sel" data-si="' + si + '" data-ri="' + ri +
      '" aria-label="Unit shown for ' + esc(nameOf(row)) + '">' + LSCCalc.SERVICE_UNITS.map(opt).join('') + '</select>' +
      (unit === 'hour' ? '' : '<span> · ' + LSCCalc.unitHours(card, unit) + ' billable hrs</span>');
    if (!problem[unit]) {
      LSCCalc.SERVICE_UNITS.filter((u) => u !== unit && problem[u]).forEach((u) => {
        html +=
          '<button type="button" class="pricing-hidden-note" data-show-unit="' + u + '" data-si="' + si +
          '" data-ri="' + ri + '" aria-label="' + esc(UNIT_CAP[u] + ' ' + problem[u].text + ': show ' + nameOf(row) + '’s ' +
          UNIT_LOWADJ[u] + ' price') + '">' + UNIT_CAP[u] + ' ' + problem[u].text + ' <span aria-hidden="true">▸</span></button>';
      });
    }
    return html;
  }

  /* The price field's shown figure and auto styling. What its blur does, and
     all it does: the state line is already current from the input handler.
     Blur used to run the whole refreshRow, which rewrote the state line under
     a Tab heading for its "↺ use $X" and dropped focus to the top of the page
     (code review R13; the task 9 trap). */
  function paintPrice(inp, d) {
    inp.value = d.mu === null ? '' : String(d.mu);
    inp.classList.toggle('pricing-auto', d.auto);
  }

  /* After an edit that doesn't restructure the row: its day rate, its unit
     line, the price field's shown value (unless it is the field being typed
     in) and auto styling, and the state line. The unit line is left alone
     while focus is inside it, so a keyboard user on the select keeps it.
     Returns the state sentence, for the caller that announces it. */
  function refreshRow(si, ri) {
    const row = (card.labourSections[si] || { rows: [] }).rows[ri];
    if (!row) return '';
    const unit = unitOf(row);
    const units = unitsOf(row);
    const st = unitState(row, unit, units);
    const sentence = stateSentence(st);
    const inp = root.querySelector('input[data-si="' + si + '"][data-ri="' + ri + '"][data-field="price"]');
    if (inp) {
      const d = resolve(row, unit);
      if (document.activeElement !== inp) paintPrice(inp, d);
      else inp.classList.toggle('pricing-auto', d.auto);
      const rate = inp.closest('tr').querySelector('.pricing-rate-ro');
      if (rate) rate.value = rateDisplay(row);
      const meta = inp.closest('tr').querySelector('.pricing-row-meta');
      if (meta && !meta.contains(document.activeElement)) meta.innerHTML = rowMetaHtml(row, si, ri, units);
    }
    const el = root.querySelector('#pfl-' + si + '-' + ri);
    if (el) el.innerHTML = stateLineHtml(row, si, ri, st);
    const said = root.querySelector('#pfd-' + si + '-' + ri);
    if (said) said.textContent = sentence;
    return sentence;
  }

  /* refreshRow for an own-time travel row: the price field's figure and auto
     styling (not while it is being typed in), the state line and its
     sentence. Returns the sentence. */
  function refreshTravelRow(ri) {
    const row = card.travelRows[ri];
    if (!row || !ownAuto(row)) return '';
    const st = travelState(row);
    const sentence = stateSentence(st);
    const inp = root.querySelector('input[data-type="travel"][data-ri="' + ri + '"][data-field="mu"]');
    if (inp) {
      const d = resolveTravel(row);
      if (document.activeElement !== inp) paintPrice(inp, d);
      else inp.classList.toggle('pricing-auto', d.auto);
    }
    const el = root.querySelector('#tfl-' + ri);
    if (el) el.innerHTML = stateLineHtml(row, null, ri, st);
    const said = root.querySelector('#tfd-' + ri);
    if (said) said.textContent = sentence;
    return sentence;
  }

  /* A rename, as it is typed: every label in the row that names the service.
     They are written at render, and a render would take the name field out
     from under the cursor. refreshRow rewrites the unit line (focus is in the
     name, not in it) and the state line with its "↺". */
  function relabelRow(si, ri) {
    const row = (card.labourSections[si] || { rows: [] }).rows[ri];
    const nameInp = root.querySelector('input[data-type="labour"][data-si="' + si + '"][data-ri="' + ri + '"][data-field="name"]');
    if (!row || !nameInp) return;
    const tr = nameInp.closest('tr');
    const n = nameOf(row);
    const label = (sel, text) => {
      const el = tr.querySelector(sel);
      if (el) el.setAttribute('aria-label', text);
    };
    label('input[data-field="price"]', UNIT_ADJ[unitOf(row)] + ' price for ' + n);
    label('.pricing-rate-ro', 'Internal rate for ' + n + ', calculated automatically');
    label('input[data-field="customBill"]', 'Allow a custom bill amount for ' + n);
    label('input[data-field="capture"]', 'Count ' + n + ' toward Production Capture Hours');
    label('.del-btn', 'Delete ' + n);
    refreshRow(si, ri);
  }

  function refreshAllRows() {
    card.labourSections.forEach((sec, si) => sec.rows.forEach((row, ri) => refreshRow(si, ri)));
    card.travelRows.forEach((row, ri) => refreshTravelRow(ri));
  }

  /* Is every service showing this unit? What a Show button's pressed state
     says. With no services, the last Show chosen. */
  function allShowing(unit) {
    const rows = card.labourSections.flatMap((sec) => sec.rows);
    return rows.length ? rows.every((row) => unitOf(row) === unit) : showDefault === unit;
  }

  /* A service-day length as the server accepts it: 0.5 to 24, in half hours
     (calc.js serviceDayOk, the one definition the route checks too). */
  const dayHoursOk = LSCCalc.serviceDayOk;

  /* A stable row id — see ROW IDS above. Random rather than derived from the
     name, which is the thing it has to survive a change of. */
  const newRowId = () => 'r_' + Math.random().toString(36).slice(2, 10);

  /* Gives every row an id it doesn't already have. Returns whether any did. */
  function assignRowIds(c) {
    let changed = false;
    c.labourSections.forEach((sec) => sec.rows.forEach((row) => {
      if (!row.id) { row.id = newRowId(); changed = true; }
    }));
    c.travelRows.forEach((row) => {
      if (!row.id) { row.id = newRowId(); changed = true; }
    });
    return changed;
  }

  /* The cost of the unit on show: the overhead rate × its hours. An hour
     matches the column head and stays bare; a day carries its unit, so
     "108.08/day" beside "1120" reads as the same unit of work. */
  const rateDisplay = (row) => {
    if (computedRate === null) return '—';
    const unit = unitOf(row);
    return (computedRate * LSCCalc.unitHours(card, unit)).toFixed(2) + (RATE_SUFFIX[unit] || '');
  };

  function newSectionId(taken) {
    let n = 1;
    let id;
    do {
      id = 'cat' + n;
      n++;
    } while (RESERVED_SECTION_IDS[id] || taken[id]);
    return id;
  }

  function takenSectionIds() {
    const taken = {};
    card.labourSections.forEach((s) => {
      taken[s.id] = 1;
    });
    return taken;
  }

  // ── How many saved estimates a deletion would affect ──────────────────────

  /* The desktop app could count these for free — every project was in memory.
     Here it costs a request, and the answer is advisory: it changes the wording
     of a confirm, never whether the delete is allowed. So a failure to load it
     leaves the count unknown and the note is dropped, rather than claiming a
     reassuring zero. */
  function countUsingSection(sectionId) {
    if (!usage) return null;
    return usage.filter((e) => ((e.activeRows || {})[sectionId] || []).length).length;
  }

  function countUsingRow(sectionId, name) {
    if (!usage) return null;
    return usage.filter((e) =>
      ((e.activeRows || {})[sectionId] || []).some((r) => r.name === name)
    ).length;
  }

  function usedNote(count) {
    if (count === null || count === 0) return '';
    return count === 1
      ? '\n\n1 saved estimate uses it. It keeps the figures it was quoted at.'
      : '\n\n' + count + ' saved estimates use it. They keep the figures they were quoted at.';
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /* Names key everything: computeTotals finds a row by matching its name against
     the card, so a blank or duplicated name makes a service impossible to price.
     Ported from catalogueProblems, plus the tax rate, which the desktop app
     never validated. */
  // One sentence per problem, however many inputs share it; every one of
  // those inputs is still flagged.
  const collector = (found) => (msg, field) => {
    const hit = found.find((p) => p.msg === msg);
    if (hit) hit.fields.push(field);
    else found.push({ msg, fields: [field] });
  };

  /* The Service Day's own problems, apart from the rest: their reason is also
     shown inside the Service Day block (showProblems), and a fixed field
     clears it there as you type. */
  function serviceDayProblems() {
    const found = [];
    const add = collector(found);
    const full = card.serviceDay.fullHours;
    const half = card.serviceDay.halfHours;
    if (!dayHoursOk(full)) add('A service day must be between 0.5 and 24 hours, in half hours.', $('svc-full-inp'));
    if (!dayHoursOk(half)) add('A service day must be between 0.5 and 24 hours, in half hours.', $('svc-half-inp'));
    if (dayHoursOk(full) && dayHoursOk(half) && half > full) {
      add('A half day can’t be longer than a full day.', $('svc-half-inp'));
    }
    return found;
  }

  function problems() {
    const found = serviceDayProblems();
    const add = collector(found);
    const q = (selector) => root.querySelector(selector);

    const percent = parseFloat(taxRaw);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      add('The tax set-aside rate must be a number between 0 and 100.', $('tax-inp'));
    }

    const seenSection = {};
    card.labourSections.forEach((sec, si) => {
      const label = String(sec.label || '').trim();
      const labelInp = q('.pricing-sec-label-inp[data-si="' + si + '"]');
      if (!label) add('A category is missing a name.', labelInp);
      const lower = label.toLowerCase();
      if (lower && seenSection[lower]) add('Two categories are both called “' + label + '”.', labelInp);
      seenSection[lower] = 1;

      const seenRow = {};
      sec.rows.forEach((r, ri) => {
        const name = String(r.name || '').trim();
        const key = name.toLowerCase();
        const nameInp = q('input[data-type="labour"][data-si="' + si + '"][data-ri="' + ri + '"][data-field="name"]');
        if (!key) add('A service in “' + (label || 'a category') + '” is missing a name.', nameInp);
        else if (seenRow[key]) add('“' + name + '” is listed twice in “' + label + '”.', nameInp);
        seenRow[key] = 1;
      });
    });

    /* A negative price. The field's min="0" doesn't stop one being typed,
       and the server refuses it; saying so here names the field. */
    card.labourSections.forEach((sec, si) => {
      sec.rows.forEach((r, ri) => {
        const bad = LSCCalc.SERVICE_UNITS.filter((u) => r.prices && typeof r.prices[u] === 'number' && r.prices[u] < 0);
        if (bad.length) {
          add(
            'A price can’t be negative (' + (String(r.name).trim() || 'a service') + ', ' +
              bad.map((u) => UNIT_WORD[u]).join(', ') + ').',
            q('input[data-si="' + si + '"][data-ri="' + ri + '"][data-field="price"]')
          );
        }
      });
    });

    surchargeProblems(add);

    const seenTravel = {};
    card.travelRows.forEach((r, ri) => {
      const name = String(r.name || '').trim();
      const key = name.toLowerCase();
      const nameInp = q('input[data-type="travel"][data-ri="' + ri + '"][data-field="name"]');
      if (!key) add('A travel item is missing a name.', nameInp);
      else if (seenTravel[key])
        add('“' + name + '” is listed twice under Travel & Accommodation.', nameInp);
      seenTravel[key] = 1;
      /* Only an own-time row can be left on auto; a blank anywhere else would
         quote at $0 (the route refuses it: travel_price_missing). */
      if (!ownAuto(r) && !r.directCost && !r.perKm && LSCCalc.numOrNull(r.mu) === null) {
        add('“' + (name || 'A travel item') + '” needs a price, or tick Your time to follow your floor.',
          q('input[data-type="travel"][data-ri="' + ri + '"][data-field="mu"]'));
      }
    });

    typeProblems(add);

    return found;
  }

  // ── Markup ────────────────────────────────────────────────────────────────

  /* Each <td> below carries data-label, matching its own <th> — the same
     arrangement as estimate-editor.js and estimate-detail.js. Below 768px
     css/responsive.css hides the head row and prints those labels beside the
     values. Five columns, four of them fixed, means the service name gets
     whatever is left: 112px at 375px and 45px at 320px, which is not enough of a
     name to edit or even recognise. Inert above 768px. */

  /* The Rate cell is type=text, not a readonly number input: a number input
     cannot render an em dash, and the empty state is an em dash. The only
     alternative would be an empty value with "—" as a placeholder, which is a
     hint rather than a value and is announced as one.

     It also carries no data-si/data-ri/data-field. Those are what bindFieldEdits
     uses to find the row an input writes to, and this one writes to no row —
     leaving them off means that even if the readonly attribute were ever lost,
     there would still be nothing for an edit to land on. */
  function labourSectionMarkup(sec, si) {
    // The On set category has a sixth column, Capture (D89).
    const onSet = sec.id === ON_SET_ID;
    let rows = '';
    if (!sec.rows.length) {
      rows = '<tr><td colspan="' + (onSet ? 6 : 5) + '" class="pricing-empty-td">No services yet — add one below.</td></tr>';
    }
    sec.rows.forEach((row, ri) => {
      const unit = unitOf(row);
      const d = resolve(row, unit);
      const units = unitsOf(row);
      const st = unitState(row, unit, units);
      rows +=
        '<tr><td data-label="Service"><input class="pricing-name-inp" type="text" value="' + esc(row.name) +
        '" placeholder="Service name" aria-label="Service name" data-si="' + si + '" data-ri="' + ri +
        '" data-field="name" data-type="labour">' +
        /* The unit line: which of the three prices this row is showing, and
           for a day, the card's hours in one. */
        '<div class="pricing-row-meta">' + rowMetaHtml(row, si, ri, units) + '</div></td>' +
        '<td style="text-align:right" data-label="Rate ($/hr)"><input type="text" readonly' +
        ' aria-readonly="true" aria-describedby="pricing-rate-note" class="pricing-rate-ro' +
        (computedRate === null ? ' pricing-rate-none' : '') + (unit === 'hour' ? '' : ' pricing-rate-day') +
        '" value="' + rateDisplay(row) +
        '" aria-label="Internal rate for ' + esc(nameOf(row)) + ', calculated automatically"></td>' +
        '<td style="text-align:right" data-label="Mark-Up ($)"><input type="number" min="0" step="0.01"' +
        ' class="pricing-price-inp' + (d.auto ? ' pricing-auto' : '') + '" value="' + (d.mu === null ? '' : esc(String(d.mu))) +
        '" placeholder="—" aria-label="' + UNIT_ADJ[unit] + ' price for ' + esc(nameOf(row)) + '" aria-describedby="pfd-' + si + '-' + ri +
        '" data-si="' + si + '" data-ri="' + ri + '" data-field="price" data-type="labour">' +
        '<div class="pricing-floor" id="pfl-' + si + '-' + ri + '">' + stateLineHtml(row, si, ri, st) + '</div>' +
        '<span hidden id="pfd-' + si + '-' + ri + '">' + esc(stateSentence(st)) + '</span></td>' +
        // Each tick in a label (B2-12): on a phone it is the rest of the row, a 44px target (responsive.css).
        '<td style="text-align:center" data-label="Custom"><label class="pricing-tick"><input type="checkbox"' + (row.customBill ? ' checked' : '') +
        ' data-si="' + si + '" data-ri="' + ri + '" data-field="customBill" data-type="labour"' +
        ' aria-label="Allow a custom bill amount for ' + esc(nameOf(row)) + '"' +
        ' title="Allow a custom bill amount to override hours × mark-up"></label></td>' +
        (onSet
          ? '<td style="text-align:center" data-label="Capture"><label class="pricing-tick"><input type="checkbox"' + (row.capture === true ? ' checked' : '') +
            ' data-si="' + si + '" data-ri="' + ri + '" data-field="capture" data-type="labour"' +
            ' aria-label="Count ' + esc(nameOf(row)) + ' toward Production Capture Hours"' +
            ' aria-describedby="pricing-capture-d"></label></td>'
          : '') +
        '<td class="pricing-act"><button type="button" class="del-btn" title="Delete this service"' +
        ' aria-label="Delete ' + esc(nameOf(row)) + '" data-del-si="' + si + '" data-del-row="' + ri + '">×</button></td></tr>';
    });

    return (
      '<div class="pricing-section"><div class="pricing-sec-head">' +
      '<input class="pricing-sec-label-inp" type="text" value="' + esc(sec.label) +
      '" placeholder="Category name" aria-label="Category name" data-si="' + si + '" data-field="label"' +
      (sec.id === ON_SET_ID ? ' aria-describedby="pricing-on-set"' : '') +
      (sec.id === POST_ID ? ' aria-describedby="pricing-post"' : '') + '>' +
      /* Production is the one section on set (D24): renamable, never
         deleted, since surcharges price exactly its items. Post-Production
         is kept the same way, since Deliverable Types and the planner read
         exactly its items: a deleted and re-added one gets a new id
         (newSectionId) that neither finds. */
      (sec.id === ON_SET_ID
        ? '<span class="pricing-sec-tag" id="pricing-on-set" title="Surcharges apply to this category’s items. It can be renamed, not deleted.">' +
          'On set<span class="sr-only">: surcharges apply to this category’s items. It can be renamed, not deleted.</span></span>'
        : sec.id === POST_ID
          ? '<span class="pricing-sec-tag" id="pricing-post" title="Deliverable Types take their services from this category. It can be renamed, not deleted.">' +
            'Post<span class="sr-only">: Deliverable Types take their services from this category. It can be renamed, not deleted.</span></span>'
          : '<button type="button" class="del-btn" title="Delete this category"' +
            ' aria-label="Delete the ' + esc(sec.label) + ' category" data-del-sec="' + si + '">×</button>') +
      '</div>' +
      /* What Capture means, where a phone can read it (the column head, and
         its ⓘ, are hidden below 768), and every tick's description. */
      (onSet ? '<p class="pricing-capture-note" id="pricing-capture-d">' + esc(CAPTURE_MEANS) + '</p>' : '') +
      '<table class="pricing-table"><thead><tr><th>Service</th>' +
      '<th style="text-align:right">Rate ($/hr)</th>' +
      '<th style="text-align:right">Mark-Up ($)</th>' +
      '<th class="pricing-flag-th" title="Let this service take a custom bill amount on the estimate">Custom</th>' +
      (onSet ? '<th class="pricing-flag-th pricing-capture-th">Capture' + captureInfo() + '</th>' : '') +
      '<th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pricing-sec-foot">' +
      '<span class="pricing-hint">' + sec.rows.length + ' service' + (sec.rows.length === 1 ? '' : 's') + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-add-row="' + si + '">+ Add Service</button>' +
      '</div></div>'
    );
  }

  /* A travel row's Mark-Up cell. An own-time row's is a service's hourly
     price field: empty with its auto figure shown when on auto, a state line
     under it, and that line as one sentence for the field's description. Any
     other row's is the plain client rate it always was, plus the note when Your
     time has just been unticked off auto. */
  function travelPriceCell(row, ri) {
    if (row.perKm) {
      /* Not an input: the one figure lives on Overhead (the user's call). */
      const d = resolveTravel(row);
      return (
        '<span class="pricing-km-price' + (d.mu === null ? ' pricing-rate-none' : '') + '">' +
        (d.mu === null ? '—' : esc(LSCUtil.perKm(d.mu))) + '</span>' +
        '<div class="pricing-floor"><span class="pricing-state-part">' +
        (d.mu === null ? 'no cost per km yet' : 'at cost, from Overhead') + '</span>' + STATE_SEP +
        '<span class="pricing-state-part"><button type="button" class="pricing-state-link" data-state-tab="overhead"' +
        ' aria-label="' + (d.mu === null ? 'Set' : 'Change') + ' the cost per km for ' + esc(nameOf(row)) + ' on Overhead">' +
        (d.mu === null ? 'set it on Overhead' : 'change on Overhead') + '</button></span></div>'
      );
    }
    if (ownAuto(row)) {
      const d = resolveTravel(row);
      const st = travelState(row);
      return (
        '<input type="number" min="0" step="0.01" class="pricing-price-inp' + (d.auto ? ' pricing-auto' : '') +
        '" value="' + (d.mu === null ? '' : esc(String(d.mu))) + '" placeholder="—"' +
        ' aria-label="Hourly price for ' + esc(nameOf(row)) + '" aria-describedby="tfd-' + ri + '"' +
        ' data-ri="' + ri + '" data-field="mu" data-type="travel">' +
        '<div class="pricing-floor" id="tfl-' + ri + '">' + stateLineHtml(row, null, ri, st) + '</div>' +
        '<span hidden id="tfd-' + ri + '">' + esc(stateSentence(st)) + '</span>'
      );
    }
    const blank = LSCCalc.numOrNull(row.mu) === null;
    /* Two parts, as a state line's are: a short one, then a sentence that may
       wrap inside the column (.pricing-state-note). */
    const note = !stoppedFollowing[row.id] ? null : blank
      ? ['no price', 'type one, or tick Your time again']
      : ['set by you', 'no longer follows your floor'];
    return (
      '<input type="number" min="0" step="0.01" value="' + (blank ? '' : num(row.mu)) + '"' +
      (note ? ' aria-describedby="tfd-' + ri + '"' : '') +
      ' aria-label="Client rate for ' + esc(row.name) + '" data-ri="' + ri + '" data-field="mu" data-type="travel">' +
      (note
        ? '<div class="pricing-floor"><span class="pricing-state-part">' + note[0] + '</span>' + STATE_SEP +
          '<span class="pricing-state-part pricing-state-note">' + note[1] + '</span></div>' +
          '<span hidden id="tfd-' + ri + '">' + esc(note[0].charAt(0).toUpperCase() + note[0].slice(1) + ', ' + note[1]) + '.</span>'
        : '')
    );
  }

  function travelSectionMarkup() {
    let rows = '';
    if (!card.travelRows.length) {
      rows = '<tr><td colspan="6" class="pricing-empty-td">No items yet — add one below.</td></tr>';
    }
    card.travelRows.forEach((row, ri) => {
      const km = row.perKm === true;
      rows +=
        '<tr><td data-label="Service"><input class="pricing-name-inp" type="text" value="' + esc(row.name) +
        '" placeholder="Item name" aria-label="Item name" data-ri="' + ri +
        '" data-field="name" data-type="travel"></td>' +
        '<td style="text-align:right" data-label="Rate ($)">' +
        (km
          ? '<span class="pricing-km-na">at cost</span>'
          : '<input type="number" min="0" step="0.01" value="' + num(row.rate) +
            '" aria-label="Cost for ' + esc(row.name) + '" data-ri="' + ri + '" data-field="rate" data-type="travel">') +
        '</td>' +
        '<td style="text-align:right" data-label="Mark-Up ($)">' + travelPriceCell(row, ri) + '</td>' +
        '<td style="text-align:center" data-label="Direct"><label class="pricing-tick"><input type="checkbox"' + (row.directCost ? ' checked' : '') +
        (km ? ' disabled' : '') +
        ' data-ri="' + ri + '" data-field="directCost" data-type="travel"' +
        ' aria-label="Bill ' + esc(row.name) + ' at cost"' +
        ' title="Billed at cost — the quantity entered is the amount billed"></label></td>' +
        '<td style="text-align:center" data-label="Your time"><label class="pricing-tick"><input type="checkbox"' + (row.ownTime ? ' checked' : '') +
        (row.directCost || km ? ' disabled' : '') +
        ' data-ri="' + ri + '" data-field="ownTime" data-type="travel"' +
        ' aria-label="' + esc(row.name) + ' is your own time"' +
        ' title="Your own hours: all of it is income, and the quantity counts as billable hours"></label></td>' +
        '<td class="pricing-act"><button type="button" class="del-btn" title="Delete this item"' +
        ' aria-label="Delete ' + esc(row.name) + '" data-del-travel="' + ri + '">×</button></td></tr>';
    });

    return (
      '<div class="pricing-section"><div class="pricing-sec-head">' +
      '<h2 class="pricing-sec-label">Travel &amp; Accommodation</h2>' +
      '<span style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Expenses</span></div>' +
      '<table class="pricing-table"><thead><tr><th>Item</th>' +
      '<th style="text-align:right">Rate ($)</th>' +
      '<th style="text-align:right">Mark-Up ($)</th>' +
      '<th class="pricing-flag-th" title="Billed straight through at cost, with no mark-up">Direct</th>' +
      '<th class="pricing-flag-th" title="Your own hours, not something bought in">Your time</th>' +
      '<th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pricing-sec-foot">' +
      '<span class="pricing-hint">' + card.travelRows.length + ' item' +
      (card.travelRows.length === 1 ? '' : 's') + '</span>' +
      '<span class="pricing-sec-foot-btns">' +
      (card.travelRows.some((r) => r.perKm)
        ? ''
        : '<button type="button" class="btn btn-ghost btn-sm" id="js-add-km">+ Add Vehicle per km</button>') +
      '<button type="button" class="btn btn-ghost btn-sm" id="js-add-travel">+ Add Item</button></span>' +
      '</div></div>'
    );
  }

  /* How the service day differs from Capacity's day — the one thing about it
     that is easy to get wrong. */
  function serviceDayInfo() {
    return LSCInfo.markup({
      id: 'svc-day',
      label: 'How the service day differs from Capacity',
      title: 'Service day',
      paragraphs: [
        'The billable hours inside one day of a service on a job — a shoot day, an edit day. A full-day line on ' +
          'an estimate carries this many hours into Minimum Job Price.',
        'Not Capacity’s billable hours per day: that one averages your whole year, admin and quiet days included, ' +
          'to set your hourly floor. A day on a job is usually longer.',
        'Auto half- and full-day prices are the hourly price × these hours. Prices you’ve typed don’t move.',
      ],
    });
  }

  // ── Capture and Deliverable Types ─────────────────────────────────────────

  /* The Capture column's meaning, in the IA's glossary words. */
  const CAPTURE_MEANS = 'Capture: counts toward Production Capture Hours, which plan post-production.';

  function captureInfo() {
    return LSCInfo.markup({
      id: 'capture',
      label: 'What the Capture tick does',
      title: 'Capture',
      paragraphs: [
        'Counts toward Production Capture Hours, which plan post-production.',
        'On an estimate, the hours of every ticked service add up to its capture hours, across all its days. ' +
          'Each deliverable with a type then recommends post hours: capture hours × the type’s multiplier × its quantity.',
        'A line keeps the tick it was added with, so a change here only reaches lines added from now on.',
      ],
    });
  }

  const newTypeId = () => 'dt_' + Math.random().toString(36).slice(2, 10);
  const typeNameOf = (t) => String(t.name || '').trim() || 'untitled type';
  const svcName = (row) => String(row.name || '').trim();

  /* The Post-Production rows a type can list, by the name the card will save
     (trimmed). Blank and repeated names are left out: neither can be picked
     on an estimate. */
  function postRows() {
    const sec = card.labourSections.find((s) => s.id === POST_ID);
    const seen = {};
    return (sec ? sec.rows : []).filter((row) => {
      const n = svcName(row);
      if (!n || seen[n]) return false;
      seen[n] = 1;
      return true;
    });
  }

  /* See chipRows. A chip with no row yet (missing) is linked as soon as a row
     takes its name, so a later rename of that row carries it too. */
  function linkChips(keep) {
    const rows = postRows();
    const next = {};
    card.deliverableTypes.forEach((t) => {
      const was = (keep && chipRows[t.id]) || [];
      next[t.id] = t.services.map((n, j) => {
        if (was[j]) return was[j];
        const row = rows.find((r) => svcName(r) === n);
        return row ? row.id : null;
      });
    });
    chipRows = next;
  }

  /* A post row renamed as it's typed: every chip that is that row takes the
     new name, so the type and the service save together. */
  function followRename(row) {
    const name = svcName(row);
    card.deliverableTypes.forEach((t) => {
      (chipRows[t.id] || []).forEach((id, j) => {
        if (id === row.id) t.services[j] = name;
      });
    });
  }

  /* How many types list any of these names: for the delete confirms. */
  function typesListing(names) {
    return card.deliverableTypes.filter((t) => t.services.some((n) => names.indexOf(n) !== -1)).length;
  }
  function typesNote(count, several) {
    if (!count) return '';
    return '\n\n' + (count === 1 ? '1 deliverable type lists' : count + ' deliverable types list') +
      (several ? ' its services, and will show them as missing.' : ' it, and will show it as missing.');
  }

  function chipsMarkup(t, ti) {
    if (!t.services.length) return '<p class="dtype-none">None yet</p>';
    const names = postRows().map(svcName);
    const of = typeNameOf(t);
    return (
      '<ul class="dtype-chips" aria-label="Post services for ' + esc(of) + '">' +
      t.services.map((n, j) => {
        const missing = names.indexOf(n) === -1;
        const shown = n || 'untitled service';
        return (
          '<li class="dtype-chip' + (missing ? ' dtype-chip-missing' : '') + '"' +
          (missing ? ' title="No longer on the Rate Card’s Post-Production. An estimate skips it when this type is picked."' : '') +
          '>' +
          '<span class="dtype-chip-text">' +
          (missing
            ? '<s class="dtype-chip-name">' + esc(shown) + '</s><span class="dtype-chip-flag">missing</span>'
            : '<span class="dtype-chip-name">' + esc(shown) + '</span>') +
          '</span>' +
          '<button type="button" class="dtype-chip-x" data-dtype-unchip="' + j + '" data-ti="' + ti + '"' +
          ' aria-label="Remove ' + esc(shown) + (missing ? ' (missing)' : '') + ' from ' + esc(of) + '">' +
          '<span aria-hidden="true">×</span></button></li>'
        );
      }).join('') +
      '</ul>'
    );
  }

  /* "+ Add service": the post rows this type doesn't list yet. Disabled, and
     saying why, when there's nothing left to add. */
  function addServiceMarkup(t, ti) {
    const rows = postRows();
    const left = rows.map(svcName).filter((n) => t.services.indexOf(n) === -1);
    const none = !rows.length
      ? 'No Post-Production services on the card'
      : !left.length ? 'Every post service is listed' : '';
    return (
      '<select class="dtype-add" id="dtype-add-' + ti + '" data-dtype-add data-ti="' + ti + '"' +
      ' aria-label="Add a post service to ' + esc(typeNameOf(t)) + '"' + (none ? ' disabled' : '') + '>' +
      '<option value="">' + (none || '+ Add service') + '</option>' +
      left.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('') +
      '</select>'
    );
  }

  /* One type. Every field has its own label: shown above it below 1100,
     read only by screen readers from 1100 up, where .dtype-head names the
     columns once. */
  function typeRowMarkup(t, ti) {
    return (
      '<li class="dtype-row">' +
      '<div class="dtype-cell dtype-what">' +
      '<label class="dtype-lbl" for="dtype-name-' + ti + '">Name</label>' +
      '<input type="text" class="dtype-inp dtype-name" id="dtype-name-' + ti + '" value="' + esc(t.name) + '"' +
      ' placeholder="e.g. Brand Story" autocomplete="off" data-dtype="name" data-ti="' + ti + '">' +
      '<label class="dtype-lbl" for="dtype-desc-' + ti + '">Description <span class="dtype-lbl-note">for you, never printed</span></label>' +
      '<textarea class="dtype-inp dtype-desc" id="dtype-desc-' + ti + '" rows="1"' +
      ' placeholder="What it is (for you, never printed)" data-dtype="description" data-ti="' + ti + '">' +
      esc(t.description) + '</textarea></div>' +
      '<div class="dtype-cell dtype-svcs" role="group" aria-labelledby="dtype-svcs-' + ti + '">' +
      '<span class="dtype-lbl" id="dtype-svcs-' + ti + '">Post services</span>' +
      chipsMarkup(t, ti) + addServiceMarkup(t, ti) + '</div>' +
      '<div class="dtype-cell dtype-mult">' +
      '<label class="dtype-lbl" for="dtype-mult-' + ti + '">Multiplier</label>' +
      '<span class="dtype-mult-row"><input type="number" class="dtype-inp dtype-mult-inp" id="dtype-mult-' + ti + '"' +
      ' min="0" step="0.25" inputmode="decimal" value="' + esc(String(t.multiplier)) + '"' +
      ' aria-describedby="dtype-mult-u-' + ti + '" data-dtype="multiplier" data-ti="' + ti + '">' +
      '<span class="dtype-mult-unit" id="dtype-mult-u-' + ti + '">× 1 capture hour</span></span></div>' +
      '<div class="dtype-act"><button type="button" class="del-btn dtype-del" data-dtype-del="' + ti + '"' +
      ' title="Remove this type" aria-label="Remove the ' + esc(typeNameOf(t)) + ' type">×</button></div>' +
      '</li>'
    );
  }

  function typesBodyMarkup() {
    const types = card.deliverableTypes;
    return (
      (types.length
        ? '<div class="dtype-head" aria-hidden="true"><span>Type</span><span>Post services</span>' +
          '<span>Multiplier</span><span></span></div>' +
          '<ul class="dtype-list" aria-label="Deliverable types">' + types.map(typeRowMarkup).join('') + '</ul>'
        : '<p class="dtype-empty">Add the kinds of deliverable you make, like Brand Story or Socials, and the post ' +
          'services each needs.</p>') +
      '<div class="dtype-foot"><span class="pricing-hint">' + types.length + ' type' + (types.length === 1 ? '' : 's') +
      '</span><button type="button" class="btn btn-ghost btn-sm" id="dtype-add-type">+ Add Deliverable Type</button></div>'
    );
  }

  function typesMarkup() {
    return (
      '<section class="billing-block dtype-block" aria-labelledby="dtype-title">' +
      '<div class="bb-head"><div><h2 class="bb-label" id="dtype-title">Deliverable Types</h2>' +
      '<span class="bb-label-tag">Plans post-production</span></div></div>' +
      '<p class="dtype-intro">The kinds of deliverable you make. Picking one on an estimate adds its post services to ' +
      'Post-Production at 0 hrs, and recommends the hours they need from the services ticked Capture: ' +
      '<strong>2 × 1 capture hour</strong> on a 10-hour shoot recommends 20. Descriptions are for you and never print.</p>' +
      '<div id="dtype-body">' + typesBodyMarkup() + '</div></section>'
    );
  }

  /* The description grows with what's typed (the IA). CSS field-sizing does
     it where the browser has it; elsewhere, its height follows its content. */
  const GROWS = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content');
  function sizeDesc(ta) {
    if (GROWS || !ta.isConnected) return;
    ta.style.height = 'auto';
    if (ta.scrollHeight) ta.style.height = ta.scrollHeight + (ta.offsetHeight - ta.clientHeight) + 'px';
  }
  const sizeDescs = () => root.querySelectorAll('.dtype-desc').forEach(sizeDesc);

  /* The block alone, as the holiday block does: a post row renamed above, or
     a type's own structure changed. Focus then goes to `focusSel`, or to the
     first of a list of them that exists and can take it. */
  function paintTypes(focusSel) {
    const body = $('dtype-body');
    if (!body) return;
    linkChips(true);
    body.innerHTML = typesBodyMarkup();
    sizeDescs();
    [].concat(focusSel || []).some((sel) => {
      const el = root.querySelector(sel);
      if (!el || el.disabled) return false;
      el.focus();
      return true;
    });
  }

  /* A type renamed as it's typed: the labels in its row that name it. */
  function relabelType(li, t) {
    const of = typeNameOf(t);
    const set = (el, text) => el && el.setAttribute('aria-label', text);
    set(li.querySelector('.dtype-chips'), 'Post services for ' + of);
    set(li.querySelector('.dtype-add'), 'Add a post service to ' + of);
    set(li.querySelector('.dtype-del'), 'Remove the ' + of + ' type');
    li.querySelectorAll('.dtype-chip-x').forEach((btn) => {
      const n = t.services[parseInt(btn.dataset.dtypeUnchip, 10)];
      const missing = btn.closest('.dtype-chip-missing');
      set(btn, 'Remove ' + (n || 'untitled service') + (missing ? ' (missing)' : '') + ' from ' + of);
    });
  }

  function typeProblems(add) {
    const seen = {};
    card.deliverableTypes.forEach((t, ti) => {
      const name = t.name.trim();
      const key = name.toLowerCase();
      if (!key) add('A deliverable type is missing a name.', $('dtype-name-' + ti));
      else if (seen[key]) add('Two deliverable types are both called “' + name + '”.', $('dtype-name-' + ti));
      seen[key] = 1;
      const m = t.multiplier;
      if (typeof m !== 'number' || m < 0) {
        add('A multiplier is the post hours for each capture hour: a number, 0 or more.', $('dtype-mult-' + ti));
      } else if (Math.abs(m * 100 - Math.round(m * 100)) > 1e-6) {
        add('A multiplier can have at most two decimal places.', $('dtype-mult-' + ti));
      }
    });
  }

  /* The block's fields, delegated: it re-renders on its own. Written to the
     working copy as typed, as every other field on this screen is. */
  function onTypeInput(event) {
    const inp = event.target.closest('[data-dtype]');
    if (!inp || !root.contains(inp)) return;
    const t = card.deliverableTypes[parseInt(inp.dataset.ti, 10)];
    if (!t) return;
    const f = inp.dataset.dtype;
    if (f === 'multiplier') {
      // '' while it isn't a number, so the save can name the field.
      const v = inp.value === '' ? NaN : Number(inp.value);
      t.multiplier = Number.isFinite(v) ? v : '';
    } else t[f] = inp.value;
    if (f === 'name') relabelType(inp.closest('.dtype-row'), t);
    if (f === 'description') sizeDesc(inp);
  }

  function onTypeChange(event) {
    const sel = event.target.closest('[data-dtype-add]');
    if (!sel || !root.contains(sel)) return false;
    const ti = parseInt(sel.dataset.ti, 10);
    const t = card.deliverableTypes[ti];
    const row = postRows().find((r) => svcName(r) === sel.value);
    if (!t || !row) return true;
    t.services.push(svcName(row));
    (chipRows[t.id] = chipRows[t.id] || []).push(row.id);
    // Back on "+ Add" for the next one; on the last chip once nothing's left.
    paintTypes(['#dtype-add-' + ti, '[data-ti="' + ti + '"][data-dtype-unchip="' + (t.services.length - 1) + '"]']);
    LSCUtil.announce($('pricing-floor-live'), 'Added ' + svcName(row) + ' to ' + typeNameOf(t) + '.');
    return true;
  }

  function onTypeClick(event) {
    const btn = event.target.closest('#dtype-add-type, [data-dtype-del], [data-dtype-unchip]');
    if (!btn || !root.contains(btn)) return false;
    const types = card.deliverableTypes;

    if (btn.id === 'dtype-add-type') {
      const t = { id: newTypeId(), name: '', description: '', services: [], multiplier: 1 };
      types.push(t);
      chipRows[t.id] = [];
      paintTypes('#dtype-name-' + (types.length - 1));
      return true;
    }

    if (btn.dataset.dtypeDel !== undefined) {
      const ti = parseInt(btn.dataset.dtypeDel, 10);
      const t = types[ti];
      if (!t) return true;
      // Nothing to lose on a type that's still blank.
      if ((t.name.trim() || t.services.length) &&
        !window.confirm('Remove the “' + typeNameOf(t) + '” deliverable type?\n\nEstimates already saved keep it.')) return true;
      types.splice(ti, 1);
      delete chipRows[t.id];
      // The next type's name, else the one before, else the add button.
      paintTypes(['#dtype-name-' + ti, '#dtype-name-' + (ti - 1), '#dtype-add-type']);
      LSCUtil.announce($('pricing-floor-live'), 'Removed the ' + typeNameOf(t) + ' type.');
      return true;
    }

    const ti = parseInt(btn.dataset.ti, 10);
    const j = parseInt(btn.dataset.dtypeUnchip, 10);
    const t = types[ti];
    if (!t || j < 0 || j >= t.services.length) return true;
    const gone = t.services.splice(j, 1)[0];
    (chipRows[t.id] || []).splice(j, 1);
    // The chip that took its place, else the one before, else "+ Add".
    const chip = (k) => '[data-ti="' + ti + '"][data-dtype-unchip="' + k + '"]';
    paintTypes([chip(j), chip(j - 1), '#dtype-add-' + ti]);
    LSCUtil.announce($('pricing-floor-live'), 'Removed ' + (gone || 'untitled service') + ' from ' + typeNameOf(t) + '.');
    return true;
  }

  // ── Surcharges ────────────────────────────────────────────────────────────

  const MULTIPLIERS = ['shortNotice', 'weekend', 'afterHours'];
  const MULT_NAME = { shortNotice: 'Short notice', weekend: 'Weekend & public holiday', afterHours: 'After hours' };
  /* The modes as the IA's glossary words them, in calc.js's ids. */
  const MODES = [
    ['higher', 'Higher of weekend/after hours, short notice on top'],
    ['multiply', 'Multiply all'],
    ['highest', 'Highest one only'],
  ];
  /* The working week, Monday first; values are getUTCDay numbers (calc.js). */
  const WEEK = [[1, 'Mon', 'Monday'], [2, 'Tue', 'Tuesday'], [3, 'Wed', 'Wednesday'], [4, 'Thu', 'Thursday'],
    [5, 'Fri', 'Friday'], [6, 'Sat', 'Saturday'], [0, 'Sun', 'Sunday']];

  /* What the server accepts (routes/pricing.js surchargesProblem). */
  const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
  const multOk = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 10;
  const hintOk = (v) => Number.isInteger(v) && v >= 0 && v <= 365;
  const officeOk = (s) => CLOCK.test(s.officeStart) && CLOCK.test(s.officeEnd) && s.officeEnd > s.officeStart;

  /* "×1.25", trimmed of float noise: 1.5 × 1.25 × 2 is 3.75, not 3.7500000001. */
  const times = (f) => '×' + String(Math.round(f * 10000) / 10000);

  /* What one mode makes of a short-notice weekend shoot wholly outside office
     hours: calc.js's own factor, from the figures as typed. The day runs from
     office end to the next office start, so every hour of it is after hours
     (afterHoursShare is 1 whatever the office hours are), and `kind` and
     `nextKind` pin both its dates as weekend whatever the working week says. null while a figure it needs
     isn't usable. */
  function comboExample(mode) {
    const s = card.surcharges;
    if (!MULTIPLIERS.every((f) => multOk(s[f])) || !officeOk(s)) return null;
    // Both dates pinned as weekend: the hours after midnight take the next date's status.
    const day = { date: '2026-01-03', kind: 'weekend', nextKind: 'weekend', startTime: s.officeEnd, endTime: s.officeStart };
    return LSCCalc.surchargeFactor(day, { surcharges: Object.assign({}, s, { mode }) }, true);
  }
  const comboFigure = (mode) => {
    const f = comboExample(mode);
    return f === null ? '—' : times(f);
  };

  function combineInfo() {
    return LSCInfo.markup({
      id: 'surch-combine',
      label: 'How the three ways of combining surcharges work',
      title: 'How surcharges combine',
      paragraphs: [
        'Decides what happens when more than one surcharge applies to the same hours of a production day.',
        '<strong>Higher of weekend/after hours, short notice on top:</strong> an hour that is both weekend and ' +
          'after hours takes the larger of the two. Short notice then multiplies the result.',
        '<strong>Multiply all:</strong> every surcharge that applies multiplies the price.',
        '<strong>Highest one only:</strong> never more than one surcharge, the largest that applies.',
        'After hours counts only the hours outside office hours, on any day: a weekday booked 9–7, with office ' +
          'hours ending at 5, surcharges 2 of its 10 hours. A surcharged item is rounded up to the dollar.',
      ],
    });
  }

  /* A multiplier field with its "×" in front. Labelled by its row's name. */
  function multField(f) {
    const v = card.surcharges[f];
    return (
      '<span class="surch-mult"><span class="surch-x" aria-hidden="true">×</span>' +
      '<input type="number" class="surch-inp" id="surch-' + f + '" min="1" max="10" step="0.05" inputmode="decimal"' +
      ' value="' + esc(String(v)) + '" data-surch="' + f + '" aria-label="' + esc(MULT_NAME[f]) + ' multiplier"' +
      ' aria-describedby="surch-' + f + '-d"></span>'
    );
  }

  function surchRow(f, desc, extra) {
    return (
      '<div class="surch-row"><div class="surch-copy">' +
      '<h3 class="surch-name">' + esc(MULT_NAME[f]) + '</h3>' +
      '<p class="surch-desc" id="surch-' + f + '-d">' + desc + '</p></div>' +
      '<div class="surch-ctl">' + multField(f) + (extra || '') + '</div></div>'
    );
  }

  function surchargesMarkup() {
    const s = card.surcharges;
    const days = WEEK.map(([n, short, long]) =>
      '<label class="surch-day"><input type="checkbox" value="' + n + '" data-surch-day' +
      (s.workingWeekdays.indexOf(n) !== -1 ? ' checked' : '') + ' aria-label="' + long + '">' +
      '<span aria-hidden="true">' + short + '</span></label>'
    ).join('');
    const modes = MODES.map(([id, words]) =>
      '<label class="surch-mode-opt"><input type="radio" name="surch-mode" value="' + id + '" data-surch-mode' +
      (s.mode === id ? ' checked' : '') + ' aria-describedby="surch-ex-' + id + '">' +
      '<span class="surch-mode-words">' + esc(words) +
      '<span class="surch-mode-ex" id="surch-ex-' + id + '">Short-notice weekend, after hours: ' +
      '<span class="surch-mode-f" data-combo="' + id + '">' + comboFigure(id) + '</span></span></span></label>'
    ).join('');

    return (
      '<section class="billing-block surch-block" aria-labelledby="surch-title">' +
      '<div class="bb-head"><div><h2 class="bb-label" id="surch-title">Surcharges</h2>' +
      '<span class="bb-label-tag">Production only</span></div></div>' +
      '<p class="surch-intro">Raise the price of the On set category’s items on the days they apply to. The client ' +
      'sees a higher item price and never the word “surcharge”. ×1 switches one off.</p>' +
      surchRow('shortNotice',
        'Ticked on an estimate when the job is booked late, and applies to all of its production days. The editor ' +
          'suggests it when the first day is this close.',
        '<label class="surch-sub">Suggest within <input type="number" class="surch-inp surch-inp-days" id="surch-hint"' +
          ' min="0" max="365" step="1" inputmode="numeric" value="' + esc(String(s.shortNoticeHintDays)) + '"' +
          ' data-surch="shortNoticeHintDays"> days</label>') +
      surchRow('weekend',
        'Days outside your working week, and every date in the public holiday list further down.') +
      surchRow('afterHours',
        'Only the share of a day’s booked hours outside office hours, on any day. A weekend evening is both weekend ' +
          'and after hours.',
        '<div class="surch-sub surch-office" role="group" aria-label="Office hours">Office hours ' +
          '<input type="time" class="surch-inp surch-inp-time" id="surch-office-start" value="' + esc(s.officeStart) + '"' +
          ' data-surch="officeStart" aria-label="Office hours start"> to ' +
          '<input type="time" class="surch-inp surch-inp-time" id="surch-office-end" value="' + esc(s.officeEnd) + '"' +
          ' data-surch="officeEnd" aria-label="Office hours end"></div>' +
        '<fieldset class="surch-week" id="surch-week"><legend class="surch-sub">Working week</legend>' +
          '<span class="surch-days">' + days + '</span></fieldset>') +
      '<fieldset class="surch-modes"><legend class="surch-name surch-modes-legend">How surcharges combine' +
      combineInfo() + '</legend><div class="surch-mode-opts">' + modes + '</div></fieldset>' +
      '</section>'
    );
  }

  /* After a surcharge edit: each option's worked example. In place, so the
     field being typed in keeps focus. */
  function refreshCombos() {
    MODES.forEach(([id]) => {
      const el = root.querySelector('[data-combo="' + id + '"]');
      if (el) el.textContent = comboFigure(id);
    });
  }

  function surchargeProblems(add) {
    const s = card.surcharges;
    MULTIPLIERS.forEach((f) => {
      if (!multOk(s[f])) add('A surcharge multiplier must be between ×1 and ×10 (×1 switches it off).', $('surch-' + f));
    });
    if (!hintOk(s.shortNoticeHintDays)) {
      add('Short notice’s suggestion must be a whole number of days, 0 to 365.', $('surch-hint'));
    }
    if (!officeOk(s)) add('Office hours must end after they start, on the same day.', $('surch-office-end'));
    if (!s.workingWeekdays.length) {
      add('Pick at least one day in your working week.', root.querySelector('[data-surch-day]'));
    }
  }

  // ── Public holidays ───────────────────────────────────────────────────────

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* 'YYYY-MM-DD' → "Mon 26 Jan", read as text (calc.js dayKind explains why
     a date string never goes through local Date getters). */
  function holidayDate(ymd, withYear) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return DOW[dow] + ' ' + d + ' ' + MON[m - 1] + (withYear ? ' ' + y : '');
  }

  /* The fetch's timestamp as a local date: "2 Oct 2026". */
  function fetchedOn(iso) {
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? null : t.getDate() + ' ' + MON[t.getMonth()] + ' ' + t.getFullYear();
  }

  const holidayLabel = (h) => (h.name ? h.name : 'Unnamed date');

  function holidaySum() {
    if (holidayLoad !== 'ready') return '';
    const on = holidays.lastFetchedAt ? fetchedOn(holidays.lastFetchedAt) : null;
    return on ? 'Last fetched ' + on : 'Not fetched yet';
  }

  function holidayYearMarkup(year, today) {
    const list = holidays.holidays.filter((h) => !h.hidden && h.date.slice(0, 4) === String(year));
    const items = list.map((h) => {
      const past = h.date < today;
      const src = h.source === 'added' ? 'added by you' : 'fetched';
      return (
        '<li class="hol-item' + (past ? ' hol-past' : '') + '">' +
        '<span class="hol-date">' + holidayDate(h.date) + '</span>' +
        '<span class="hol-name">' + esc(holidayLabel(h)) + '</span>' +
        '<span class="hol-src hol-src-' + esc(h.source) + '">' + src + '</span>' +
        '<button type="button" class="del-btn hol-del" data-hol-del="' + esc(h.date) + '"' +
        ' aria-label="Remove ' + esc(holidayLabel(h)) + ', ' + holidayDate(h.date, true) + '">×</button></li>'
      );
    }).join('');
    return (
      '<div class="hol-year"><h3 class="hol-year-head">' + year +
      '<span class="hol-count"> · ' + list.length + ' date' + (list.length === 1 ? '' : 's') + '</span></h3>' +
      (list.length
        ? '<ul class="hol-list">' + items + '</ul>'
        : '<p class="hol-empty">No dates yet. Fetch again, or add them by hand.</p>') +
      '</div>'
    );
  }

  function holidayBodyMarkup() {
    if (holidayLoad === 'loading') return '<p class="hol-status">Loading public holidays…</p>';
    if (holidayLoad === 'failed') {
      return (
        '<p class="hol-status">Couldn’t load the holiday list. ' +
        '<button type="button" class="pricing-state-link" id="hol-retry">Try again</button></p>'
      );
    }
    const today = LSCUtil.today();
    const year = Number(today.slice(0, 4));
    const add = addingHoliday
      ? '<form class="hol-add" id="hol-add" novalidate>' +
        '<label class="hol-field"><span>Date</span><input type="date" id="hol-add-date" required></label>' +
        '<label class="hol-field hol-field-name"><span>Name <span class="hol-optional">(optional)</span></span>' +
        '<input type="text" id="hol-add-name" maxlength="100" placeholder="e.g. NSW Bank Holiday"></label>' +
        '<span class="hol-add-btns"><button type="submit" class="btn btn-accent btn-sm">Add date</button><button type="button" class="btn btn-ghost btn-sm" id="hol-add-cancel">Cancel</button></span>' +
        '</form>'
      : '';
    return (
      '<p class="surch-intro">A production day on one of these dates takes the weekend &amp; public holiday ' +
      'surcharge. National and NSW holidays, fetched for this year and next. <strong>Changes here save straight ' +
      'away</strong>; estimates already saved keep the dates they were priced with.</p>' +
      '<p class="hol-note">The NSW Bank Holiday (the first Monday in August) isn’t in the source. Add it by hand ' +
      'if it affects your bookings.</p>' +
      '<div class="hol-years">' + holidayYearMarkup(year, today) + holidayYearMarkup(year + 1, today) + '</div>' +
      '<p class="hol-error" id="hol-error" role="alert"></p>' +
      add +
      '<div class="pricing-sec-foot hol-foot"><span class="pricing-hint" id="hol-sum-foot">' + esc(holidaySum()) + '</span>' +
      '<span class="pricing-sec-foot-btns">' +
      (addingHoliday ? '' : '<button type="button" class="btn btn-ghost btn-sm" id="hol-add-open">+ Add a date</button>') +
      '<button type="button" class="btn btn-ghost btn-sm" id="hol-fetch">' +
      (holidayBusy === 'fetch' ? 'Fetching…' : 'Fetch again') + '</button></span></div>'
    );
  }

  function holidaysMarkup() {
    return (
      '<section class="billing-block hol-block" aria-labelledby="hol-title">' +
      '<div class="bb-head"><div><h2 class="bb-label" id="hol-title">Public holidays</h2>' +
      '<span class="bb-label-tag">National + NSW</span></div></div>' +
      '<div id="hol-body">' + holidayBodyMarkup() + '</div></section>'
    );
  }

  /* Re-renders the holiday block alone, then puts focus on `focusSel` if
     given and present (else `fallbackSel`). */
  function paintHolidays(focusSel, fallbackSel) {
    const body = $('hol-body');
    if (!body) return;
    body.innerHTML = holidayBodyMarkup();
    const target = (focusSel && body.querySelector(focusSel)) || (fallbackSel && body.querySelector(fallbackSel));
    if (target) target.focus();
  }

  async function loadHolidays() {
    holidayLoad = 'loading';
    paintHolidays();
    try {
      holidays = await LSCApi.get('/api/holidays');
      holidayLoad = 'ready';
    } catch (err) {
      if (err instanceof LSCApi.ApiError && err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      holidayLoad = 'failed';
    }
    if (onScreen()) paintHolidays();
  }

  /* Busy, in place: the block is marked aria-busy and "Fetch again" reads
     "Fetching…". Nothing is disabled or re-rendered, either of which would
     drop focus from the button just pressed; a second press while busy is
     simply ignored (holidayRequest). */
  function markBusy(kind) {
    holidayBusy = kind;
    const body = $('hol-body');
    if (!body) return;
    body.setAttribute('aria-busy', kind ? 'true' : 'false');
    const f = $('hol-fetch');
    if (f) f.textContent = kind === 'fetch' ? 'Fetching…' : 'Fetch again';
  }

  /* One holiday request: busy while it runs, the list replaced by the
     server's on success (the caller re-paints and places focus), and on
     failure a sentence in the block with everything else left as it was,
     the add form's typing included. Returns the reply, or false. */
  async function holidayRequest(kind, send, failWords) {
    if (holidayBusy) return false;
    LSCUtil.clearFieldErrors($('hol-error'));
    markBusy(kind);
    try {
      const reply = await send();
      holidays = { holidays: reply.holidays, lastFetchedAt: reply.lastFetchedAt };
      holidayBusy = false;
      return reply;
    } catch (err) {
      markBusy(false);
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') {
        handlers.onAuthLost({ keepScreen: true });
        return false;
      }
      if (!onScreen()) return false;
      const words = err.kind === 'network'
        ? 'the server is unreachable. Try again once it’s back.'
        : HOLIDAY_REFUSALS[err.code] || err.message || 'the server refused the request.';
      const box = $('hol-error');
      box.textContent = failWords + words;
      box.classList.add('show');
      return false;
    }
  }

  const HOLIDAY_REFUSALS = {
    holiday_date_invalid: 'that isn’t a real date.',
    holiday_name_invalid: 'the name isn’t text.',
    holiday_name_too_long: 'the name is longer than 100 characters.',
    holiday_not_found: 'it had already gone. Reload the page to see the current list.',
  };

  async function fetchHolidays() {
    const reply = await holidayRequest('fetch', () => LSCApi.post('/api/holidays/fetch'), 'Couldn’t fetch: ');
    if (!reply || !onScreen()) return;
    const n = (reply.added || []).length;
    paintHolidays('#hol-fetch');
    Toast.ok(n ? 'Fetched ' + n + ' new date' + (n === 1 ? '' : 's') + '.' : 'The list is up to date.');
  }

  async function addHoliday() {
    const dateInp = $('hol-add-date');
    const nameInp = $('hol-add-name');
    const date = dateInp.value;
    const name = nameInp.value.trim();
    const box = $('hol-error');
    const refuse = (msg, field) => LSCUtil.showFieldErrors(box, [{ msg, fields: [field] }]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return refuse('Pick a date to add.', dateInp);
    const existing = holidays.holidays.find((h) => h.date === date && !h.hidden);
    if (existing) return refuse(holidayDate(date, true) + ' is already on the list, as “' + holidayLabel(existing) + '”.', dateInp);
    const reply = await holidayRequest('add',
      () => LSCApi.put('/api/holidays/' + date, { name }), 'Couldn’t add it: ');
    if (!reply) return;
    addingHoliday = false;
    if (!onScreen()) return;
    paintHolidays('#hol-add-open');
    Toast.ok('Added ' + holidayDate(date, true) + '.');
  }

  async function removeHoliday(date) {
    const h = holidays.holidays.find((x) => x.date === date);
    if (!h) return;
    const confirmed = window.confirm(
      'Remove “' + holidayLabel(h) + '” (' + holidayDate(date, true) + ')?\n\n' +
        'New production days on it won’t take the public holiday surcharge. Estimates already saved keep it.' +
        (h.source === 'fetched' ? ' Fetching again won’t bring it back; add the date by hand if you change your mind.' : '')
    );
    if (!confirmed) return;
    /* Where focus goes once the row has gone: the next row's remove, else
       the previous one's, else "+ Add a date". */
    const dels = Array.from(root.querySelectorAll('[data-hol-del]')).map((b) => b.dataset.holDel);
    const at = dels.indexOf(date);
    const next = dels[at + 1] || dels[at - 1];
    const reply = await holidayRequest('remove', () => LSCApi.del('/api/holidays/' + date), 'Couldn’t remove it: ');
    if (!reply || !onScreen()) return;
    paintHolidays(next ? '[data-hol-del="' + next + '"]' : null, '#hol-add-open');
    Toast.ok('Removed ' + holidayDate(date, true) + '.');
  }

  function markup() {
    let html =
      '<div class="page-head"><div><h1 class="page-title">Rate Card</h1>' +
      '<div class="page-sub">Add, rename, re-price or remove anything the estimator offers</div></div></div>' +
      '<div class="tax-setting"><div>' +
      '<div class="sum-label" style="margin-bottom:4px">Tax Set-Aside Rate (%)</div>' +
      '<div style="color:var(--muted);font-size:11px">Set aside from each job’s profit — labour, your-time travel ' +
      'and the markup on resold travel, less the overhead its hours carry — before GST. Pass-through costs are exempt.</div></div>' +
      '<input type="number" id="tax-inp" min="0" max="100" step="0.5" value="' + esc(taxRaw) +
      '" aria-label="Tax set-aside rate, percent"></div>' +
      /* The Service Day — see SERVICE UNITS above. Same block as the tax rate:
         copy left, fields right. */
      '<div class="tax-setting pricing-day-setting"><div>' +
      '<div class="sum-label pricing-day-title">Service Day (billable hrs)' + serviceDayInfo() + '</div>' +
      '<div style="color:var(--muted);font-size:11px">The hours in a half and a full day of a service on a job. ' +
      'An auto day price is the service’s hourly price × these hours.</div>' +
      /* Why a save was refused, beside the fields it names — the save bar's
         copy of it is a page away (design review D1). Not role="alert":
         #pricing-error already speaks it, and focus lands on the field this
         describes, so a second live region would read it a third time. */
      '<p class="pricing-day-error" id="svc-day-error"></p></div>' +
      '<div class="pricing-day-ctl">' +
      '<label>Full <input type="number" id="svc-full-inp" min="0.5" max="24" step="0.5" value="' +
      esc(String(card.serviceDay.fullHours)) + '" data-day="fullHours" aria-label="Billable hours in a full service day"> hrs</label>' +
      '<span aria-hidden="true">·</span>' +
      '<label>Half <input type="number" id="svc-half-inp" min="0.5" max="24" step="0.5" value="' +
      esc(String(card.serviceDay.halfHours)) + '" data-day="halfHours" aria-label="Billable hours in a half service day"> hrs</label>' +
      '</div></div>' +
      '<div class="pricing-catalogue-bar">' +
      '<span class="pricing-hint">These categories and services are exactly what you pick from when building an estimate.</span>' +
      '<span class="pricing-sec-foot-btns">' +
      (card.labourSections.some((s) => s.id === ADDITIONAL_ID)
        ? ''
        : '<button type="button" class="btn btn-ghost btn-sm" id="js-add-additional">+ Add Additional work</button>') +
      '<button type="button" class="btn btn-ghost btn-sm" id="js-add-cat">+ Add Category</button></span>' +
      '</div>' +
      /* Directly above the tables, so it is read before the first read-only
         field is reached rather than after. #pricing-rate-note is the target of
         every labour rate input's aria-describedby, which makes it a
         document-unique id with the same constraint #tax-inp carries (see
         onScreen above): no other screen may reuse it. */
      '<p class="pricing-rate-note" id="pricing-rate-note">' +
      'Rate is calculated automatically from your Overhead and Capacity settings and can’t be ' +
      /* &nbsp; before the dash so a wrap can't start a line with it — the copy
         is unchanged, the break just moves to after the dash instead. */
      'edited here&nbsp;— update it on the ' +
      '<button type="button" class="pricing-rate-note-link" data-go-tab="overhead">Overhead</button>' +
      ' / ' +
      '<button type="button" class="pricing-rate-note-link" data-go-tab="capacity">Capacity</button>' +
      ' tabs. Mark-Up stays yours to set.</p>' +
      '<p class="sr-only" id="pricing-floor-live" aria-live="polite"></p>' +
      '<div class="pricing-show" role="group" aria-label="Show every service’s price per">' +
      '<span class="pricing-show-label" aria-hidden="true">Show</span>' +
      LSCCalc.SERVICE_UNITS.map((u) =>
        '<button type="button" class="btn btn-ghost btn-sm pricing-show-btn" data-show-all="' + u +
        '" aria-pressed="' + allShowing(u) + '">' + UNIT_CAP[u] + '</button>'
      ).join('') +
      '</div>' +
      '<div class="pricing-grid">';

    card.labourSections.forEach((sec, si) => {
      html += labourSectionMarkup(sec, si);
    });
    html += travelSectionMarkup();
    html += '</div>';
    // After Travel, before Surcharges (D99).
    html += typesMarkup();
    html += surchargesMarkup();

    html +=
      '<div id="pricing-error" role="alert"></div>' +
      '<div class="pricing-save-bar">' +
      '<p>Changes apply to estimates you build from here on. Estimates already saved keep the figures they were quoted at.</p>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<span class="saved-msg" id="saved-msg">✓ Services saved</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="js-reset" data-write>Reset Defaults</button>' +
      '<button type="button" class="btn btn-accent" id="js-save-pricing" data-write>' +
      '<span class="spinner" id="save-spin"></span><span id="save-label">Save Services</span></button>' +
      '</div></div>' +
      /* Below the save bar: it saves itself (see SURCHARGES AND PUBLIC
         HOLIDAYS above), and the bar's Save has nothing to do with it. */
      holidaysMarkup();

    return html;
  }

  /* The card the server sent is in a shape this page can't write (calc.js
     cardShapeOutdated: before v9, or without task 6a's marker): this page is
     newer than the server. Read-only and
     final — reloading only helps once the server has been updated. */
  function outdatedMarkup() {
    return (
      '<div class="page-head"><div><h1 class="page-title">Rate Card</h1>' +
      '<div class="page-sub">Add, rename, re-price or remove anything the estimator offers</div></div></div>' +
      '<div class="empty-state" role="alert"><h3>The server hasn’t been updated for this Rate Card yet</h3>' +
      '<p>This page is newer than the server, which stores the rate card in an older way. Editing is ' +
      'switched off until the server is updated, so a save from here can’t overwrite your prices. ' +
      'Reload once it has been.</p></div>'
    );
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  function showError(message) {
    const el = $('pricing-error');
    if (!el) return; // left while the request was in flight
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    LSCUtil.clearFieldErrors($('svc-day-error'));
    LSCUtil.clearFieldErrors($('pricing-error'));
  }

  /* A refused save: every sentence in the save bar, as on every screen, and
     the Service Day's again inside its own block. Its two fields are
     flagged from there (aria-invalid, and aria-describedby pointing at the
     reason beside them) rather than from the save bar, so each field is
     described once; showFieldErrors focuses them last, so a Service Day
     problem still takes focus first, as it did. */
  function showProblems(found) {
    const day = serviceDayProblems().map((p) => p.msg);
    LSCUtil.showFieldErrors(
      $('pricing-error'),
      found.map((p) => (day.indexOf(p.msg) === -1 ? p : { msg: p.msg, fields: [] })),
      'Fix this before saving:'
    );
    const dayFound = found.filter((p) => day.indexOf(p.msg) !== -1);
    if (dayFound.length) LSCUtil.showFieldErrors($('svc-day-error'), dayFound);
  }

  function setSaving(next) {
    // The flag first: it is module state and has to be cleared even when the
    // buttons it describes are no longer in the page.
    saving = next;
    if (!onScreen()) return;
    $('js-save-pricing').disabled = next;
    $('js-reset').disabled = next;
    $('save-spin').style.display = next ? 'inline-block' : 'none';
    $('save-label').textContent = next ? 'Saving…' : 'Save Services';
  }

  function flashSaved() {
    const msg = $('saved-msg');
    if (!msg) return;
    msg.style.display = 'inline';
    setTimeout(() => {
      // The screen may have been re-rendered or left in the meantime.
      if (msg.isConnected) msg.style.display = 'none';
    }, 2500);
  }

  /* Field edits write straight to the working copy without a re-render, so
     typing a name never loses focus mid-word. Structural changes — adding or
     deleting a row or category — re-render, because the data-si/data-ri indices
     every other input carries would otherwise be stale. */
  function bindFieldEdits() {
    /* :not([readonly]) skips the computed rate column. An `input` event never
       fires on a readonly field anyway, so this changes no behaviour — it says
       at the binding site that the field is not part of the working copy,
       instead of leaving it to be inferred from a missing data-field. */
    root.querySelectorAll('.pricing-table input:not([readonly]), .pricing-sec-label-inp').forEach((input) => {
      const event = input.type === 'checkbox' ? 'change' : 'input';
      input.addEventListener(event, () => {
        const field = input.dataset.field;
        if (!field) return;

        if (field === 'label') {
          card.labourSections[parseInt(input.dataset.si, 10)].label = input.value;
          return;
        }

        const target =
          input.dataset.type === 'labour'
            ? (card.labourSections[parseInt(input.dataset.si, 10)] || { rows: [] })
                .rows[parseInt(input.dataset.ri, 10)]
            : card.travelRows[parseInt(input.dataset.ri, 10)];
        if (!target) return;

        if (field === 'name') {
          target.name = input.value;
          if (input.dataset.type === 'labour') {
            const si = parseInt(input.dataset.si, 10);
            relabelRow(si, parseInt(input.dataset.ri, 10));
            /* A post service: the types that list it follow the new name,
               and every "+ Add service" offers it (see CAPTURE AND DELIVERABLE TYPES above). */
            if (card.labourSections[si].id === POST_ID) {
              followRename(target);
              paintTypes();
            }
          } else refreshTravelRow(parseInt(input.dataset.ri, 10)); // its "↺ use" names it
        }
        else if (field === 'price') {
          /* Typing pins the unit on show; an empty field is auto again. A
             number input reads '' for anything it can't parse, too, so a
             half-typed "1e" is auto for that moment, not $0. */
          const n = input.value === '' ? NaN : parseFloat(input.value);
          pricesOf(target)[unitOf(target)] = Number.isFinite(n) ? n : null;
        } else if (field === 'mu' && input.dataset.type === 'travel' && ownAuto(target)) {
          /* As a service's price: typing sets it, an empty field is auto. */
          const n = input.value === '' ? NaN : parseFloat(input.value);
          target.mu = Number.isFinite(n) ? n : null;
          const ri = parseInt(input.dataset.ri, 10);
          LSCUtil.announce($('pricing-floor-live'), nameOf(target) + ', hourly: ' + refreshTravelRow(ri));
          return;
        } else if (field === 'customBill' || field === 'capture' || field === 'directCost' || field === 'ownTime') {
          const wasOwnAuto = input.dataset.type === 'travel' && ownAuto(target);
          // Absent rather than false, matching the shape defaults.js ships.
          if (input.checked) target[field] = true;
          else delete target[field];
          /* Your time changes the whole Mark-Up cell, so it re-renders. Off an
             auto price, the figure on screen is kept as a typed one (task 6a,
             the user's call): a resold row can't follow the floor. */
          if (field === 'ownTime') {
            if (wasOwnAuto && !input.checked && LSCCalc.numOrNull(target.mu) === null) {
              target.mu = resolveTravel(Object.assign({}, target, { ownTime: true })).mu;
              stoppedFollowing[target.id] = true;
            }
            if (input.checked) delete stoppedFollowing[target.id];
            render();
            const again = root.querySelector('input[data-type="travel"][data-ri="' + input.dataset.ri + '"][data-field="ownTime"]');
            if (again) again.focus();
          }
          /* Direct and your-time are exclusive — a direct row is money passed
             through, not anybody's hours — so ticking Direct clears and
             disables Your time. Structural, so it re-renders. */
          if (field === 'directCost') {
            delete target.ownTime;
            render();
            const again = root.querySelector('input[data-type="travel"][data-ri="' + input.dataset.ri + '"][data-field="directCost"]');
            if (again) again.focus();
          }
        } else target[field] = num(input.value);

        if (input.dataset.type === 'labour' && field === 'price') {
          const si = parseInt(input.dataset.si, 10);
          const ri = parseInt(input.dataset.ri, 10);
          const sentence = refreshRow(si, ri);
          /* The sentence is the Mark-Up's description, so it is read on focus;
             this is for the change while typing, spoken once typing pauses. */
          LSCUtil.announce($('pricing-floor-live'), nameOf(target) + ', ' + UNIT_WORD[unitOf(target)] + ': ' + sentence);
        }
      });
    });

    /* An auto price field: once left, show the auto figure again (emptying it
       returned the unit to auto, and an empty box would read as no price) —
       paintPrice only, never the state line (see paintPrice). No `change`
       handler either: every edit already ran refreshRow as it was typed.
       On focus, select it, so typing replaces the suggestion rather than
       appending to it. */
    root.querySelectorAll('input[data-type="travel"][data-field="mu"].pricing-price-inp').forEach((input) => {
      input.addEventListener('blur', () => {
        const row = card.travelRows[parseInt(input.dataset.ri, 10)];
        if (row && ownAuto(row)) paintPrice(input, resolveTravel(row));
      });
      input.addEventListener('focus', () => {
        if (input.classList.contains('pricing-auto')) input.select();
      });
    });

    root.querySelectorAll('input[data-field="price"]').forEach((input) => {
      input.addEventListener('blur', () => {
        const row = (card.labourSections[parseInt(input.dataset.si, 10)] || { rows: [] }).rows[parseInt(input.dataset.ri, 10)];
        if (row) paintPrice(input, resolve(row, unitOf(row)));
      });
      input.addEventListener('focus', () => {
        if (input.classList.contains('pricing-auto')) input.select();
      });
    });

    /* The Service Day. Held as a number, or '' while it isn't one, so
       validation can tell "no hours" from a figure (unitHours falls back to
       8 / 4 meanwhile). Every row follows in place. */
    root.querySelectorAll('[data-day]').forEach((input) => {
      input.addEventListener('input', () => {
        const v = input.value === '' ? NaN : parseFloat(input.value);
        card.serviceDay[input.dataset.day] = Number.isFinite(v) ? v : '';
        refreshAllRows();
        // A refused save's reason beside the fields goes once they're fixed
        // (the save bar's copy stays until the next save, as for any field).
        if ($('svc-day-error').classList.contains('show') && !serviceDayProblems().length) {
          LSCUtil.clearFieldErrors($('svc-day-error'));
        }
        if (dayHoursOk(v)) {
          LSCUtil.announce(
            $('pricing-floor-live'),
            'Auto prices updated for ' + v + '-hour ' + (input.dataset.day === 'fullHours' ? 'full' : 'half') + ' day.'
          );
        }
      });
    });

    $('tax-inp').addEventListener('input', function () {
      taxRaw = this.value;
    });

    /* The Surcharges block (see SURCHARGES above). A figure that isn't one
       is held as '', as the Service Day's are, so the save can name the field;
       a time input reads '' until all of it is filled in. Every edit updates
       the combine options' examples in place. */
    root.querySelectorAll('[data-surch]').forEach((input) => {
      input.addEventListener('input', () => {
        const f = input.dataset.surch;
        if (input.type === 'time') card.surcharges[f] = input.value;
        else {
          const v = input.value === '' ? NaN : Number(input.value);
          card.surcharges[f] = Number.isFinite(v) ? v : '';
        }
        refreshCombos();
      });
    });
    root.querySelectorAll('[data-surch-day]').forEach((box) => {
      box.addEventListener('change', () => {
        // Ascending, as calc.js surchargeSettings holds them, so ticking a day
        // off and on again is no change.
        card.surcharges.workingWeekdays = Array.from(root.querySelectorAll('[data-surch-day]:checked'))
          .map((b) => Number(b.value))
          .sort((a, b) => a - b);
      });
    });
    root.querySelectorAll('[data-surch-mode]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) card.surcharges.mode = radio.value;
      });
    });
  }

  function bindStructure() {
    $('js-add-cat').addEventListener('click', () => {
      card.labourSections.push({
        id: newSectionId(takenSectionIds()),
        label: 'New Category',
        rows: [{ id: newRowId(), name: 'New Service', rate: 0, prices: { hour: null, half: null, full: null } }],
      });
      render();
    });

    /* The new row's name is focused and selected, as the IA's "Pricing a new
       service" flow has it: render() rebuilds the card, so without this a
       keyboard user was dropped at the top of the page, a whole card away from
       the row they had just made, and typing replaces "New Service". */
    root.querySelectorAll('[data-add-row]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const si = parseInt(btn.dataset.addRow, 10);
        const rows = card.labourSections[si].rows;
        rows.push({
          id: newRowId(),
          name: 'New Service',
          rate: 0,
          prices: { hour: null, half: null, full: null },
        });
        render();
        const nameInp = root.querySelector(
          'input[data-type="labour"][data-si="' + si + '"][data-ri="' + (rows.length - 1) + '"][data-field="name"]'
        );
        if (nameInp) {
          nameInp.focus();
          nameInp.select();
        }
      });
    });

    /* The post-shoot section (D14), under the id later stages look it up by.
       Empty: which services go in it, Overtime included, is the user's call.
       Focus goes to its name, as a new service's does. */
    const addAdditional = $('js-add-additional');
    if (addAdditional) {
      addAdditional.addEventListener('click', () => {
        card.labourSections.push({ id: ADDITIONAL_ID, label: 'Additional work', rows: [] });
        render();
        const inp = root.querySelector('.pricing-sec-label-inp[data-si="' + (card.labourSections.length - 1) + '"]');
        if (inp) inp.focus();
      });
    }

    $('js-add-travel').addEventListener('click', () => {
      card.travelRows.push({ id: newRowId(), name: 'New Item', rate: 0, mu: 0 });
      render();
    });

    /* The car's km row, as the default card has it (task 6b). Only offered
       while the card has none. Focus goes to its name, as a new service's does. */
    const addKm = $('js-add-km');
    if (addKm) {
      addKm.addEventListener('click', () => {
        card.travelRows.push({ id: newRowId(), name: 'Vehicle — per km', rate: 0, mu: null, perKm: true, unit: 'km' });
        render();
        const nameInp = root.querySelector('input[data-type="travel"][data-ri="' + (card.travelRows.length - 1) + '"][data-field="name"]');
        if (nameInp) nameInp.focus();
      });
    }

    root.querySelectorAll('[data-del-sec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const si = parseInt(btn.dataset.delSec, 10);
        const sec = card.labourSections[si];
        // Production (D24) and Post-Production are never deleted; they have
        // no button.
        if (!sec || sec.id === ON_SET_ID || sec.id === POST_ID) return;
        const count = sec.rows.length;
        const confirmed = window.confirm(
          'Delete the “' + sec.label + '” category and its ' + count + ' service' +
            (count === 1 ? '' : 's') + '?' + usedNote(countUsingSection(sec.id))
        );
        if (!confirmed) return;
        card.labourSections.splice(si, 1);
        render();
      });
    });

    root.querySelectorAll('[data-del-row]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = card.labourSections[parseInt(btn.dataset.delSi, 10)];
        if (!sec) return;
        const ri = parseInt(btn.dataset.delRow, 10);
        const row = sec.rows[ri];
        if (!row) return;
        if (!window.confirm('Delete “' + row.name + '”?' + usedNote(countUsingRow(sec.id, row.name)) +
          (sec.id === POST_ID ? typesNote(typesListing([svcName(row)])) : ''))) return;
        sec.rows.splice(ri, 1);
        render();
      });
    });

    root.querySelectorAll('[data-del-travel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ri = parseInt(btn.dataset.delTravel, 10);
        const row = card.travelRows[ri];
        if (!row) return;
        if (!window.confirm('Delete “' + row.name + '”?' + usedNote(countUsingRow('travel', row.name)))) return;
        card.travelRows.splice(ri, 1);
        render();
      });
    });

    /* The note's Overhead / Goals links. onGoTab is FinanceView's selectTab,
       which asks LSCUnsaved before it swaps screens — so following one of these
       from a half-edited rate card offers to save it, exactly as clicking the
       sub-tab itself would. Absent if this view is ever mounted outside
       Finance, in which case the links do nothing rather than throw. */
    root.querySelectorAll('[data-go-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (handlers.onGoTab) handlers.onGoTab(btn.dataset.goTab);
      });
    });

    $('js-save-pricing').addEventListener('click', save);
    $('js-reset').addEventListener('click', reset);
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  /* Trim on the way out only. Trimming as the user types would eat the space
     between two words the moment it was pressed. */
  function payload() {
    /* A typed price as the number it is; anything else is auto (null). Never
       the resolved auto figure: see SERVICE UNITS above. */
    const price = (row, unit) => {
      const v = row.prices ? row.prices[unit] : null;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    return {
      serviceDay: { fullHours: card.serviceDay.fullHours, halfHours: card.serviceDay.halfHours },
      labourSections: card.labourSections.map((sec) => ({
        id: sec.id,
        label: String(sec.label).trim(),
        rows: sec.rows.map((row) => {
          const out = {
            id: row.id,
            name: String(row.name).trim(),
            rate: num(row.rate),
            prices: { hour: price(row, 'hour'), half: price(row, 'half'), full: price(row, 'full') },
          };
          if (row.customBill) out.customBill = true;
          // Counts toward Production Capture Hours (calc.js postPlan, B2-1),
          // which reads it on the On set category only.
          if (sec.id === ON_SET_ID && row.capture === true) out.capture = true;
          if (row.unit) out.unit = row.unit;
          return out;
        }),
      })),
      travelRows: card.travelRows.map((row) => {
        /* An own-time row on auto goes as null, never its resolved figure:
           it follows the floor from here (calc.js travelRowDef). */
        const mu = row.perKm || (ownAuto(row) && LSCCalc.numOrNull(row.mu) === null) ? null : num(row.mu);
        const out = { id: row.id, name: String(row.name).trim(), rate: num(row.rate), mu };
        // The car's row: its price is Overhead's, never stored on the card (task 6b).
        if (row.perKm) out.perKm = true;
        if (row.directCost && !row.perKm) out.directCost = true;
        if (row.ownTime && !row.directCost && !row.perKm) out.ownTime = true;
        if (row.unit) out.unit = row.unit;
        return out;
      }),
      taxSetAsideRate: parseFloat(taxRaw) / 100,
      surcharges: {
        shortNotice: card.surcharges.shortNotice,
        shortNoticeHintDays: card.surcharges.shortNoticeHintDays,
        weekend: card.surcharges.weekend,
        afterHours: card.surcharges.afterHours,
        officeStart: card.surcharges.officeStart,
        officeEnd: card.surcharges.officeEnd,
        workingWeekdays: card.surcharges.workingWeekdays.slice(),
        mode: card.surcharges.mode,
      },
      deliverableTypes: card.deliverableTypes.map((t) => Object.assign({}, t, {
        name: t.name.trim(),
        description: t.description.trim(),
        services: t.services.slice(),
      })),
      // Without it the server refuses the card as outdated (calc.js PRICING_SHAPE).
      pricingShape: LSCCalc.PRICING_SHAPE,
    };
  }

  async function save() {
    if (saving) return;
    clearError();

    const found = problems();
    if (found.length) {
      // The desktop app used alert() here. A blocking dialog hides the very
      // fields the message is describing.
      showProblems(found);
      return;
    }

    const body = payload();
    setSaving(true);
    Toast.working('Saving rates…');

    try {
      const reply = await LSCApi.put('/api/pricing', body);
      // Only now is this the card estimates are priced against.
      LSCData.setPricing(reply.pricing);
      card = workingCopy(reply.pricing);
      linkChips();
      taxRaw = toPercent(reply.pricing.taxSetAsideRate);
      stoppedFollowing = {};
      baseline = snapshot();
      Toast.ok('Rates saved.');
      // Cleared before the re-render, not through setSaving: render() replaces
      // the button this would otherwise re-enable. Leaving the flag set is what
      // made every save after the first one a silent no-op.
      saving = false;
      if (!onScreen()) return;
      render();
      flashSaved();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(
        err.kind === 'network'
          ? 'Couldn’t save — the server is unreachable. Your changes are still here; try again once it’s back.'
          : 'Couldn’t save: ' + (SAVE_REFUSALS[err.code] || err.message || 'the server refused the request.')
      );
    }
  }

  /* The route's refusal codes (server/src/routes/pricing.js) in words. The
     first is the one a user can actually meet: a tab open across a deploy
     sends a card in the shape it loaded, and the server refuses it rather than
     letting it overwrite the new one. */
  const SAVE_REFUSALS = {
    pricing_shape_outdated:
      'this page is out of date — the rate card has changed shape since it was opened. ' +
      'Reload the page, then make your changes again.',
    service_day_out_of_range: 'a service day must be between 0.5 and 24 hours, in half hours.',
    service_day_half_over_full: 'a half day can’t be longer than a full day.',
    labour_prices_incomplete: 'a service is missing one of its three prices. Reload the page and try again.',
    labour_price_not_a_number: 'a price isn’t a number.',
    labour_price_negative: 'a price can’t be negative.',
    travel_price_negative: 'a travel price can’t be negative.',
    travel_price_missing: 'a travel item has no price. Type one, or tick Your time to follow your floor.',
    travel_per_km_flags: 'the vehicle per km row can’t also be Direct or Your time. Reload the page and try again.',
    tax_set_aside_rate_not_a_fraction: 'the tax set-aside rate must be between 0 and 100.',
    surcharges_invalid: 'the surcharge settings are malformed. Reload the page and try again.',
    surcharge_multiplier_out_of_range: 'a surcharge multiplier must be between ×1 and ×10.',
    surcharge_hint_days_out_of_range: 'short notice’s suggestion must be a whole number of days, 0 to 365.',
    surcharge_office_hours_invalid: 'office hours must end after they start.',
    surcharge_weekdays_invalid: 'pick at least one day in your working week.',
    surcharge_mode_invalid: 'pick how surcharges combine.',
    labour_capture_not_a_flag: 'a Capture tick is malformed. Reload the page and try again.',
    deliverable_types_invalid: 'a deliverable type’s multiplier must be 0 or more.',
  };

  async function reset() {
    if (saving) return;
    /* The default card has no Deliverable Types (B2-1), so a reset deletes
       them: said here, where it can still be cancelled. */
    const types = card.deliverableTypes.length ||
      ((LSCData.pricing() || {}).deliverableTypes || []).length;
    const confirmed = window.confirm(
      'Reset every category, service and rate back to the built-in defaults?' +
        (types ? ' Your deliverable types are deleted too.' : '') + '\n\n' +
        'This replaces the saved rate card immediately. Estimates already saved keep ' +
        'the figures they were quoted at.'
    );
    if (!confirmed) return;

    clearError();
    setSaving(true);
    Toast.working('Restoring defaults…');

    try {
      const reply = await LSCApi.post('/api/pricing/reset');
      LSCData.setPricing(reply.pricing);
      Toast.ok('Defaults restored.');
      saving = false;
      if (!onScreen()) return;
      // A server rolled back to before v9 since mount resets to its own card.
      if (LSCCalc.cardShapeOutdated(reply.pricing)) {
        card = null;
        root.innerHTML = outdatedMarkup();
        return;
      }
      /* Everything mount sets up for a card, again: the default rows carry no
         ids (see ROW IDS above), and the unit view is keyed by id — without
         them every row would share one entry, and switching one row's unit
         would switch them all. */
      card = workingCopy(reply.pricing);
      assignRowIds(card);
      linkChips();
      viewUnits = {};
      showDefault = 'hour';
      stoppedFollowing = {};
      taxRaw = toPercent(reply.pricing.taxSetAsideRate);
      baseline = snapshot();
      render();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(
        err.kind === 'network'
          ? 'Couldn’t restore defaults — the server is unreachable.'
          : 'Couldn’t restore defaults: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  // ── Mounting ──────────────────────────────────────────────────────────────

  function render() {
    const scrollY = window.scrollY;
    root.innerHTML = markup();
    bindFieldEdits();
    bindStructure();
    sizeDescs();
    window.scrollTo(0, scrollY);
  }

  /* Advisory only — it sharpens the delete confirmations. The screen is fully
     usable before it arrives, and stays usable if it never does. */
  async function loadUsage() {
    try {
      const reply = await LSCApi.get('/api/estimates');
      usage = reply.estimates || [];
    } catch (err) {
      if (err instanceof LSCApi.ApiError && err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      usage = null;
    }
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers;
    saving = false;
    usage = null;
    holidays = null;
    holidayLoad = 'loading';
    holidayBusy = false;
    addingHoliday = false;

    const pricing = LSCData.pricing();
    /* A server not yet on v9 serves a card this screen can't read: every row
       would show as all-auto, and one save would put that over every typed
       price, where the v9 migration would then leave it. So it isn't opened
       for editing at all. With no #tax-inp, onScreen() is false, and every
       async path stands down. */
    if (LSCCalc.cardShapeOutdated(pricing)) {
      card = null;
      root.innerHTML = outdatedMarkup();
      return;
    }
    card = workingCopy(pricing);
    viewUnits = {};
    showDefault = 'hour';
    stoppedFollowing = {};
    taxRaw = toPercent(pricing.taxSetAsideRate);
    assignRowIds(card);
    linkChips(); // by row id, so after assignRowIds
    /* Deliberately outside the working copy and outside snapshot(): this is
       derived, read-only and unsaveable, so it must not make the card look
       dirty or be shipped by payload(). */
    /* Annual business cost (operating costs + gear replacement reserve) ÷
       annual billable hours from Capacity — through LSCData.overheadRate() so
       this column, the estimate editor's floor, the Capacity confirm and the
       Dashboard all use one computation. See data.js. */
    computedRate = LSCData.overheadRate();
    priceCtx = LSCData.priceContext();
    perHourFloor = priceCtx.floorPerHour;
    blocker = LSCData.autoPriceBlocker();
    baseline = snapshot();

    render();
    LSCUnsaved.watch('pricing', {
      label: 'the rate card',
      // The module-level sentinel, not a second copy of it: these two had drifted
      // into duplicate expressions asking the same question, and only one of them
      // would have been fixed for the Finance move. Asks what is in the page
      // rather than holding an element, because every structural edit re-renders
      // this screen and would invalidate a stored reference.
      onScreen,
      dirty: () => snapshot() !== baseline,
    });
    /* The state line's buttons, delegated: the line is rewritten as you type,
       so a listener bound to one button would be lost with it. */
    root.addEventListener('click', onRootClick);
    root.addEventListener('change', onRootChange);
    root.addEventListener('submit', onRootSubmit);
    root.addEventListener('input', onTypeInput);
    loadUsage();
    loadHolidays();
    focusRow(handlers && handlers.focusRow);
  }

  /* Shows a unit on one row, re-rendering its cells, and focuses `then` on it. */
  function showUnit(si, ri, unit, then) {
    const row = (card.labourSections[si] || { rows: [] }).rows[ri];
    if (!row) return;
    viewUnits[row.id] = unit;
    render();
    const again = root.querySelector(then + '[data-si="' + si + '"][data-ri="' + ri + '"]');
    if (again) again.focus();
  }

  /* The unit view switch, delegated because the unit line is rewritten in
     place. View state only: not the card. Focus stays on the select. */
  function onRootChange(event) {
    if (onTypeChange(event)) return;
    const sel = event.target.closest('.pricing-unit-sel');
    if (!sel || !root.contains(sel)) return;
    showUnit(parseInt(sel.dataset.si, 10), parseInt(sel.dataset.ri, 10), sel.value, '.pricing-unit-sel');
  }

  /* The Public holidays block's buttons, delegated: the block re-renders on
     its own (paintHolidays). */
  function onHolidayClick(event) {
    const btn = event.target.closest('#hol-body button');
    if (!btn || !root.contains(btn)) return false;
    if (btn.id === 'hol-retry') loadHolidays();
    else if (btn.id === 'hol-fetch') fetchHolidays();
    else if (btn.id === 'hol-add-open') {
      addingHoliday = true;
      paintHolidays('#hol-add-date');
    } else if (btn.id === 'hol-add-cancel') {
      addingHoliday = false;
      paintHolidays('#hol-add-open');
    } else if (btn.dataset.holDel) removeHoliday(btn.dataset.holDel);
    else return false;
    return true;
  }

  function onRootSubmit(event) {
    if (event.target.id !== 'hol-add') return;
    event.preventDefault();
    addHoliday();
  }

  function onRootClick(event) {
    if (onHolidayClick(event) || onTypeClick(event)) return;
    const show = event.target.closest('[data-show-all]');
    if (show && root.contains(show)) {
      const unit = show.dataset.showAll;
      showDefault = unit;
      card.labourSections.forEach((sec) => sec.rows.forEach((row) => {
        viewUnits[row.id] = unit;
      }));
      render();
      const again = root.querySelector('[data-show-all="' + unit + '"]');
      if (again) again.focus();
      return;
    }
    const note = event.target.closest('.pricing-hidden-note');
    if (note && root.contains(note)) {
      showUnit(parseInt(note.dataset.si, 10), parseInt(note.dataset.ri, 10), note.dataset.showUnit, 'input[data-field="price"]');
      return;
    }
    const btn = event.target.closest('.pricing-floor button');
    if (!btn || !root.contains(btn)) return;
    if (btn.dataset.stateTab) {
      if (handlers.onGoTab) handlers.onGoTab(btn.dataset.stateTab);
      return;
    }
    if (btn.hasAttribute('data-use-auto') && btn.dataset.travelRi !== undefined) {
      const ri = parseInt(btn.dataset.travelRi, 10);
      const row = card.travelRows[ri];
      if (!row) return;
      row.mu = null;
      refreshTravelRow(ri);
      const inp = root.querySelector('input[data-type="travel"][data-ri="' + ri + '"][data-field="mu"]');
      const d = resolveTravel(row);
      /* Painted here, not left to refreshTravelRow, which skips a field that
         has focus — as this one does when the ↺ was reached without leaving
         it (the Dashboard's badge lands focus in it). */
      if (inp) {
        paintPrice(inp, d);
        inp.focus();
      }
      LSCUtil.announce(
        $('pricing-floor-live'),
        nameOf(row) + ', hourly: back to auto' + (d.mu === null ? ', no price yet.' : ', ' + money(d.mu) + '.')
      );
      return;
    }
    if (btn.hasAttribute('data-use-auto')) {
      const si = parseInt(btn.dataset.si, 10);
      const ri = parseInt(btn.dataset.ri, 10);
      const row = (card.labourSections[si] || { rows: [] }).rows[ri];
      if (!row) return;
      pricesOf(row)[unitOf(row)] = null;
      const inp = root.querySelector('input[data-si="' + si + '"][data-ri="' + ri + '"][data-field="price"]');
      refreshRow(si, ri);
      if (inp) inp.focus();
      const d = resolve(row, unitOf(row));
      LSCUtil.announce(
        $('pricing-floor-live'),
        nameOf(row) + ', ' + UNIT_WORD[unitOf(row)] + ': back to auto' +
          (d.mu === null ? ', no price yet.' : ', ' + money(d.mu) + '.')
      );
    }
  }

  /* The Dashboard's "Below by $X" lands here with { sectionId, index, unit }
     — or sectionId 'travel' and the row's index in travelRows:
     the row's section id and its position in that section, since names are
     editable and needn't be unique, and the unit the gap is on (hour when
     absent). Shows that unit, focuses the price — the one field the gap is
     about — and centres it: a price in the last category would otherwise sit
     at the bottom edge. A row that has gone (the card changed in between) just
     leaves the screen at the top, as a rail click would. */
  function focusRow(target) {
    if (!target || typeof target !== 'object') return;
    /* An own-time travel row's badge (task 6a): its price, by index. */
    if (String(target.sectionId) === 'travel') {
      const inp = root.querySelector('input[data-type="travel"][data-ri="' + Number(target.index) + '"][data-field="mu"]');
      if (!inp) return;
      inp.focus({ preventScroll: true });
      inp.scrollIntoView({ block: 'center' });
      return;
    }
    const si = card.labourSections.findIndex((sec) => String(sec.id) === String(target.sectionId));
    if (si < 0) return;
    const ri = Number(target.index);
    const row = card.labourSections[si].rows[ri];
    if (!row) return;
    if (LSCCalc.SERVICE_UNITS.indexOf(target.unit) !== -1 && unitOf(row) !== target.unit) {
      viewUnits[row.id] = target.unit;
      render();
    }
    const inp = root.querySelector('input[data-si="' + si + '"][data-ri="' + ri + '"][data-field="price"]');
    if (!inp) return;
    inp.focus({ preventScroll: true });
    inp.scrollIntoView({ block: 'center' });
  }

  return { mount };
})();
