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
 */

const PricingView = (() => {
  const { esc, num } = LSCUtil;
  const RESERVED_SECTION_IDS = LSCRows.RESERVED_SECTION_IDS;

  let root = null;
  let handlers = null;
  let card = null; // the working copy
  let taxRaw = ''; // the percent field exactly as typed
  let usage = null; // saved estimates, for delete warnings. null = unknown
  let saving = false;
  let baseline = ''; // the card as last saved, for the unsaved-edit check

  const $ = (id) => root.querySelector('#' + id);
  const clone = (value) => JSON.parse(JSON.stringify(value));

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
     Read once per mount, with perHourFloor, and for the same reason — except
     the GST settings, which the Invoice Settings modal can change over this
     screen. Its save calls refreshPrices(), which takes the context again. */
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
    let rows = '';
    if (!sec.rows.length) {
      rows = '<tr><td colspan="5" class="pricing-empty-td">No services yet — add one below.</td></tr>';
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
        '<td style="text-align:center" data-label="Custom"><input type="checkbox"' + (row.customBill ? ' checked' : '') +
        ' data-si="' + si + '" data-ri="' + ri + '" data-field="customBill" data-type="labour"' +
        ' aria-label="Allow a custom bill amount for ' + esc(nameOf(row)) + '"' +
        ' title="Allow a custom bill amount to override hours × mark-up"></td>' +
        '<td class="pricing-act"><button type="button" class="del-btn" title="Delete this service"' +
        ' aria-label="Delete ' + esc(nameOf(row)) + '" data-del-si="' + si + '" data-del-row="' + ri + '">×</button></td></tr>';
    });

    return (
      '<div class="pricing-section"><div class="pricing-sec-head">' +
      '<input class="pricing-sec-label-inp" type="text" value="' + esc(sec.label) +
      '" placeholder="Category name" aria-label="Category name" data-si="' + si + '" data-field="label">' +
      '<button type="button" class="del-btn" title="Delete this category"' +
      ' aria-label="Delete the ' + esc(sec.label) + ' category" data-del-sec="' + si + '">×</button></div>' +
      '<table class="pricing-table"><thead><tr><th>Service</th>' +
      '<th style="text-align:right">Rate ($/hr)</th>' +
      '<th style="text-align:right">Mark-Up ($)</th>' +
      '<th class="pricing-flag-th" title="Let this service take a custom bill amount on the estimate">Custom</th>' +
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
        '<td style="text-align:center" data-label="Direct"><input type="checkbox"' + (row.directCost ? ' checked' : '') +
        (km ? ' disabled' : '') +
        ' data-ri="' + ri + '" data-field="directCost" data-type="travel"' +
        ' aria-label="Bill ' + esc(row.name) + ' at cost"' +
        ' title="Billed at cost — the quantity entered is the amount billed"></td>' +
        '<td style="text-align:center" data-label="Your time"><input type="checkbox"' + (row.ownTime ? ' checked' : '') +
        (row.directCost || km ? ' disabled' : '') +
        ' data-ri="' + ri + '" data-field="ownTime" data-type="travel"' +
        ' aria-label="' + esc(row.name) + ' is your own time"' +
        ' title="Your own hours: all of it is income, and the quantity counts as billable hours"></td>' +
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
      '<button type="button" class="btn btn-ghost btn-sm" id="js-add-cat">+ Add Category</button>' +
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

    html +=
      '<div id="pricing-error" role="alert"></div>' +
      '<div class="pricing-save-bar">' +
      '<p>Changes apply to estimates you build from here on. Estimates already saved keep the figures they were quoted at.</p>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<span class="saved-msg" id="saved-msg">✓ Services saved</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="js-reset" data-write>Reset Defaults</button>' +
      '<button type="button" class="btn btn-accent" id="js-save-pricing" data-write>' +
      '<span class="spinner" id="save-spin"></span><span id="save-label">Save Services</span></button>' +
      '</div></div>';

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
          if (input.dataset.type === 'labour') relabelRow(parseInt(input.dataset.si, 10), parseInt(input.dataset.ri, 10));
          else refreshTravelRow(parseInt(input.dataset.ri, 10)); // its "↺ use" names it
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
        } else if (field === 'customBill' || field === 'directCost' || field === 'ownTime') {
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
        if (!sec) return;
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
        if (!window.confirm('Delete “' + row.name + '”?' + usedNote(countUsingRow(sec.id, row.name)))) return;
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
      card = clone(reply.pricing);
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
  };

  async function reset() {
    if (saving) return;
    const confirmed = window.confirm(
      'Reset every category, service and rate back to the built-in defaults?\n\n' +
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
      card = clone(reply.pricing);
      assignRowIds(card);
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

    const pricing = LSCData.pricing();
    /* A server not yet on v9 serves a card this screen can't read: every row
       would show as all-auto, and one save would put that over every typed
       price, where the v9 migration would then leave it. So it isn't opened
       for editing at all. With no #tax-inp, onScreen() is false, and every
       async path and refreshPrices() stands down. */
    if (LSCCalc.cardShapeOutdated(pricing)) {
      card = null;
      root.innerHTML = outdatedMarkup();
      return;
    }
    card = clone({
      serviceDay: pricing.serviceDay,
      labourSections: pricing.labourSections || [],
      travelRows: pricing.travelRows || [],
    });
    viewUnits = {};
    showDefault = 'hour';
    stoppedFollowing = {};
    taxRaw = toPercent(pricing.taxSetAsideRate);
    assignRowIds(card);
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
    loadUsage();
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
    const sel = event.target.closest('.pricing-unit-sel');
    if (!sel || !root.contains(sel)) return;
    showUnit(parseInt(sel.dataset.si, 10), parseInt(sel.dataset.ri, 10), sel.value, '.pricing-unit-sel');
  }

  function onRootClick(event) {
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

  return {
    mount,
    /* Called by SettingsView after the Invoice Settings modal saves, which can
       happen with this screen open behind it. An auto price on a
       GST-inclusive card carries GST inside it, so turning "prices include
       GST" on or off moves every auto figure, its state line and its "↺ use
       $X". The working copy is untouched: a typed price is the user's and
       stays as typed, and nothing here makes the card dirty. */
    refreshPrices() {
      if (!onScreen() || !card) return;
      priceCtx = LSCData.priceContext();
      perHourFloor = priceCtx.floorPerHour;
      blocker = LSCData.autoPriceBlocker();
      refreshAllRows();
    },
  };
})();
