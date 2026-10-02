'use strict';

/* The estimate editor, ported from renderForm and its row builders.
 *
 * TOTALS
 * The summary bar is produced by LSCCalc.computeTotals — the same file the
 * server runs (see the note at the bottom of calc.js). The desktop app had its
 * own arithmetic inline here, and it was wrong in the two ways the plan set out
 * to fix: no GST, and a "Gross Profit" that counted pass-through costs as
 * margin. Reproducing it in the browser would have put those bugs back and let
 * the editor disagree with the record the server stores. Nothing in this file
 * computes a headline figure; it collects rows and asks calc.js.
 *
 * Per-row and per-section figures come from rows.js, which follows calc.js's
 * lookup rule so the rows always add up to the total under them.
 *
 * THE MINIMUM JOB PRICE IS ADVISORY AND MUST STAY THAT WAY
 * The floor under the summary bar is a second opinion, never a price. It is
 * computed by LSCCalc.minimumJobPrice() from the current Overhead Rate/hr and
 * Target Markup, it is not persisted with the estimate, and neither it
 * nor its toggle is allowed to move clientPriceExGst or totalIncGst by a cent
 * in either position. Everything it needs is read off the totals computeTotals
 * already returned — it never recomputes a headline figure of its own. The (?)
 * beside it opens the cost breakdown dialog, which shows the three lines that
 * make up that figure and likewise computes nothing of its own.
 *
 * EACH LINE CARRIES ITS OWN PRICE (2026-09-28 audit)
 * A line added from the rate card stores a snapshot of that row's price
 * (LSCCalc.lineSnapshot) on its DOM row, and saves it with the line. calc.js
 * prices a saved line from its snapshot, so a quote no longer moves when the
 * card does, and a renamed service no longer drops out of the total. A line
 * saved before snapshots existed takes one from the live card when the editor
 * opens it (by row id, then name) — i.e. it is priced as it always was, and
 * frozen at that price from its next save.
 *   - "Update to current rates" re-snapshots every line from today's card.
 *   - "Use rates from last project" (shown once the estimate is linked to a
 *     client with an earlier estimate that recorded its prices) swaps each
 *     line's price for the one that client was quoted last time, matched by
 *     category and row id, then name. Turning it off puts the prices back.
 *
 * SERVICE UNITS (2026-09-28, .design/service-rate-tiers/)
 * A labour service sells by the hour, the half day or the full day, each with
 * its own price on the card (LSCCalc.unitDef — typed, or auto from the income
 * floor and Target Markup). The picker is service → unit → Add, and the unit
 * starts on Hour every time a service is chosen (brief decision 11). A line is
 * one service at one unit; the same service can be on a quote twice at two
 * units. Its unit is a select on the line: switching re-snapshots the line
 * from the card at the new unit, keeping its quantity. So a line's unit is
 * part of its snapshot (`dayUnit`, absent for an hour), and both rate actions
 * match by unit too — row id + unit, then name + unit:
 *   - "Update to current rates" re-prices each line at its OWN unit. A unit
 *     with no price on the card yet (auto, no income floor) keeps its
 *     snapshot, and the message counts it.
 *   - "Use rates from last project" swaps in last time's price only for the
 *     same service at the same unit. A unit switch or a new line while it is
 *     on takes last time's price at that unit when there is one, and
 *     remembers today's card price as the line's own for turning it off.
 * A unit with no price is listed disabled ("no price yet, needs Profit
 * Goals": the brief asks a disabled option to say why, and an auto unit with
 * no income floor is the only way to have none) in both selects, never offered
 * at $0 (IA: `mu: null` means unavailable). The auto price a
 * line is added at is frozen into its snapshot like any other: this file never
 * resolves a price after that except on one of the actions above.
 *
 * PRODUCTION ITEMS LIVE ON DAYS (2026-10-02, .design/production-booking/ task 7)
 * A Production line (section id `prod`, D24) belongs to a booked day (D4): it
 * is built inside that day's card in the Production Booking block and saves
 * with that day's `dayId` (read from where the row sits, never stored on the
 * row). The Production section further down keeps its place and subtotal; it
 * lists the days, and its "Add to a day" opens a day's service menu.
 *
 * A DAY CARD IS A WHOLE SHOOT DAY (B2-4, D74–D79). Travel, crew and gear sit
 * on the cards too, each kind in its own group, and carry their card's
 * `dayId` the same way — but only production is ever surcharged (D3), so
 * they bill exactly as they would on no day. Every on-set line is added
 * through one service menu ("Add Production Service Items"). A line on no
 * day — every line saved before B2, and production saved before days — sits
 * on the last card, "Not on a day", priced exactly as before; a production
 * line there keeps a "Pick a day…" select until B2-5's Move to. The flat
 * Travel, Crew and Equipment sections keep only their heads and subtotals
 * until B2-6's summaries.
 *
 * Surcharges are priced by calc.js, as the server prices them: the snapshot
 * (surchargeSnapshot, kept from the stored estimate unless "Update to current
 * rates" asks for today's), each line's surcharged price (stampSurchargedPrices)
 * and the totals (computeTotals). A line's "incl. weekend ×1.5" comes from
 * surchargeAttribution on the same base. Nothing here multiplies a price. The
 * surcharge is income for the same hours, so neither advisory floor moves.
 *
 * CLIENT FIELDS
 * The estimate carries a client *snapshot* — {businessName, contactName, email,
 * phone, abn, address} — not the desktop app's flat businessName/clientName/
 * clientEmail. All six are on the form (the old one had three), because the
 * invoice prints the client's ABN and nothing should print that this screen
 * didn't show. Business Name is a typeahead over the client list; a pick fills
 * the fields and links the estimate to that record (clientId). Details flow one
 * way — client list into estimate — and are copied at save time, so editing a
 * client later never rewrites a quote already sent.
 */

const EstimateEditor = (() => {
  const { fmt, esc, today, num, abnDigits, abnValid, abnFormat } = LSCUtil;
  const { sectionsFor, labourDef, travelDef, labourBill, travelBill, costBill } = LSCRows;

  let root = null;
  let handlers = null;
  let existing = null; // the estimate being edited, or null for a new one
  let sections = []; // labour categories this form was built from
  let rowCounter = 0;
  let saving = false;
  let link = null; // { id, name } of the client record this estimate points at
  let baseline = ''; // the form as it was at mount, for the unsaved-edit check
  let booking = null; // the Production Booking block (views/booking-block.js)

  /* Production items on days (production-booking task 7; see PRODUCTION
     ITEMS LIVE ON DAYS below). One items element per day, by day id, kept
     here and moved into its card by the booking block. */
  const dayPanels = new Map();
  /* The public-holiday list (GET /api/holidays, hidden rows included, as the
     server reads it), for pricing a new or moved day. null until fetched;
     fetched once, the first time the estimate has a dated day. */
  let holidays = null;
  let holidaysLoading = null;
  /* "Update to current rates" also re-takes the surcharge settings and each
     day's weekday/weekend/holiday kind from today's Rate Card and holiday
     list. Sent as refreshSurcharges on the next save, so the server does the
     same. */
  let refreshSurcharges = false;
  let daysSig = ''; // the day titles the cards were last labelled from

  /* The two Finance figures the advisory floor is built from, resolved once at
     mount. Same reasoning as pricing.js's computedRate: nothing reachable from
     this screen can change an overhead item or a goal — the only screens that
     can are the Finance sub-tabs, and getting to one means leaving this editor,
     which re-mounts it on the way back. They are deliberately outside
     payload(), so they are never saved and never make the form look dirty. */
  let overheadRate = null;
  let profitMarginPct = null; // a MARKUP percent — the stored column predates the rename
  let incomeFloor = null; // LSCData.incomeFloor(), for the job's income line
  /* LSCData.priceContext(), for resolving a service's auto prices at a unit.
     Resolved at mount for the same reason as the three above — except its GST
     settings, which the Invoice Settings modal can change over this screen:
     refreshTotals() takes it again. */
  let priceCtx = null;

  /* The client's last project, for "Use rates from last project":
     { estimate, rates: Map(key → snapshot) } once looked up, null when there is
     none, undefined while unknown. ratesFromLast is the toggle's state. */
  let lastProject;
  let lastProjectFor = null; // the client id it was looked up for
  let ratesFromLast = false;

  /* The cost breakdown modal. `breakdown` is the last set of figures the
     Minimum Job Price line painted — see setBreakdown() for why the modal reads
     that rather than working them out again — and is null whenever the floor
     could not be computed, which is also when the (?) is hidden. */
  let breakdownOverlay = null;
  let breakdown = null;
  let breakdownOpener = null; // the control that opened it, to hand focus back to

  const rid = () => 'r' + ++rowCounter;
  const $ = (id) => root.querySelector('#' + id);

  /* Is this editor still the screen on #main? A save or delete is async and the
     nav doesn't wait for it, so its outcome can land after the user has gone
     somewhere else — at which point neither the form's fields nor its error
     region exist any more, and following through would yank them off the screen
     they chose. Same sentinel idea as refreshTotals below. */
  const onScreen = () => Boolean(root && root.querySelector('#f-upid'));

  const gstRegistered = () => ((LSCData.settings().gst || {}).registered === true);

  /* The estimate's own GST treatment. The checkbox only exists when the business
     is registered, so when it is absent the stored value stands rather than
     defaulting to false — switching GST off account-wide should not silently
     erase which jobs were quoted GST-free. */
  const gstFreeNow = () => {
    const box = $('f-gstfree');
    return box ? box.checked : !!(existing && existing.gstFree);
  };

  // ── Line prices ───────────────────────────────────────────────────────────

  const SNAP_KEYS = ['mu', 'rowId', 'hoursPerUnit', 'dayUnit', 'rate', 'directCost', 'ownTime', 'perKm', 'customBill'];

  /* The snapshot a row should carry: the saved line's own when it has one,
     otherwise one taken from the definition it was built from (the live card
     for a new or legacy line), otherwise none — a legacy line whose service
     has left the card, which prices at nothing. */
  function snapFor(def, line) {
    if (line && line.mu !== undefined && line.mu !== null && line.mu !== '') {
      const out = {};
      SNAP_KEYS.forEach((k) => {
        if (line[k] !== undefined) out[k] = line[k];
      });
      return out;
    }
    return def ? LSCCalc.lineSnapshot(def) : null;
  }

  const snapOf = (tr) => (tr.dataset.snap ? JSON.parse(tr.dataset.snap) : null);

  // ── Service units ─────────────────────────────────────────────────────────

  const UNIT_NAMES = { hour: 'Hour', half: 'Half day', full: 'Full day' };

  /* The Rate Card's own money format for a price in a sentence (util.js). */
  const money = LSCUtil.money;

  /* Which unit a line (or snapshot) is sold in, as the rate-matching key: 'hour',
     'half' or 'full', or — for a line saved before service units with some other
     number of hours and no day marker — 'unit' plus its hours, which matches
     nothing on today's card. Travel snapshots carry no hours and read as 'hour'. */
  function unitKey(snap) {
    const u = LSCRows.labourUnit(snap);
    return u.kind === 'unit' ? 'unit' + u.hoursPerUnit : u.kind;
  }

  /* The live card's row for a line, in its own category, by row id then name.
     `sectionId` '' is Travel. Null for a line whose service has gone. */
  function cardRowFor(sectionId, rowId, name) {
    const pricing = LSCData.pricing();
    const defs = sectionId
      ? ((pricing.labourSections || []).find((sec) => sec.id === sectionId) || { rows: [] }).rows
      : pricing.travelRows || [];
    return (rowId && defs.find((r) => r.id === rowId)) || defs.find((r) => r.name === name) || null;
  }

  /* Today's card price for a row at one unit, as a line snapshot — or null when
     that unit has no price yet (an auto unit with no income floor, or a unit the
     card doesn't sell). A row without `prices` (Travel) has one price and no
     units; an own-time one with no typed price follows the income floor
     (calc.js travelRowDef, task 6a), and is resolved here, never snapshotted
     as its raw null — lineSnapshot would read that as $0. */
  function cardSnap(row, unit) {
    if (!row) return null;
    if (!row.prices) {
      const travel = LSCCalc.travelRowDef(row, priceCtx);
      return travel.mu !== null ? LSCCalc.lineSnapshot(travel) : null;
    }
    const def = LSCCalc.unitDef(row, unit, LSCData.pricing(), priceCtx);
    return def && def.mu !== null ? LSCCalc.lineSnapshot(def) : null;
  }

  /* What a line of this row at this unit would be priced at: the client's
     last-project price for it while that toggle is on and there is one,
     otherwise today's card. `own` is today's card price, which the line goes
     back to when the toggle is turned off. `snap` null: it can't be priced. */
  function unitSnap(sectionId, row, unit) {
    const own = cardSnap(row, unit);
    const last = ratesFromLast ? lastRateFor(sectionId, row.id, row.name, unit) : null;
    return { snap: last || own, own };
  }

  /* Marks a row priced from the last project with the price it would otherwise
     have, for setRatesFromLast(false) to put back; clears the mark otherwise.
     When today's card has no price for it (an auto unit with no income floor
     yet) there is nothing to put back: the line keeps last time's price, unit
     and hours when the toggle goes off, marked `lastOnly` so the rates note
     can say so (code review R5). It used to be marked 'none', the mark for a
     legacy line whose service has left the card, and so went back to no
     price and no unit, and saved at $0. */
  function markOwn(tr, picked) {
    delete tr.dataset.lastOnly;
    if (!picked.snap || picked.snap === picked.own) delete tr.dataset.prevSnap;
    else if (picked.own) tr.dataset.prevSnap = JSON.stringify(picked.own);
    else {
      delete tr.dataset.prevSnap;
      tr.dataset.lastOnly = '1';
    }
  }

  /* The options of a unit select. `current` is the unit a line is already in:
     its option is just the unit's name, since the line's price sits beside it
     in the Mark-Up column and the closed select should read "per full day".
     Every other option says what the line would be priced at in that unit, or
     that it can't be yet — disabled, with the reason in its text (a <select>
     can hold nothing else). `lower`: the line's inline wording ("per half
     day"), rather than the picker's ("Half day · $640"). */
  function unitOptions(sectionId, row, current, lower) {
    const name = (u) => (lower ? UNIT_NAMES[u].toLowerCase() : UNIT_NAMES[u]);
    // The screen actually in the way: Capacity, Overhead or Profit Goals (R7).
    const needs = LSCData.autoPriceBlocker().screen;
    let html = '';
    if (current && LSCCalc.SERVICE_UNITS.indexOf(current) === -1) {
      // A legacy line in no unit the card sells: shown as it is, not switchable back to.
      html += '<option value="' + esc(current) + '" selected>unit</option>';
    }
    LSCCalc.SERVICE_UNITS.forEach((u) => {
      if (u === current) {
        html += '<option value="' + u + '" selected>' + name(u) + '</option>';
        return;
      }
      const { snap } = unitSnap(sectionId, row, u);
      html +=
        '<option value="' + u + '"' + (snap ? '' : ' disabled') + '>' + name(u) + ' · ' +
        (snap ? money(snap.mu) : 'no price yet, needs ' + needs) + '</option>';
    });
    return html;
  }

  /* The picker's unit select, for whichever service its service select shows.
     Starts on Hour every time the service changes (brief decision 11) — or, when
     the hour has no price, on the first unit that has one. `keep` (a repaint
     after the rates toggle) holds the current choice if it can still be priced.
     No priceable unit: every option disabled, and Add with it. `els` is a day
     card's own picker ({ svc, unitSel, add }), which may not be in the page
     yet; without it, the section's picker is looked up by id. */
  function paintPicker(section, keep, els) {
    const svc = els ? els.svc : $('sel-' + section.id);
    const unitSel = els ? els.unitSel : $('unit-' + section.id);
    const add = els ? els.add : $('add-' + section.id);
    if (!svc || !unitSel || !add) return;
    const row = section.rows.find((r) => r.name === svc.value) || null;
    if (!row || !row.prices) {
      unitSel.innerHTML = row ? '<option value="hour">' + UNIT_NAMES.hour + '</option>' : '';
      unitSel.disabled = true;
      add.disabled = !row;
      return;
    }
    const was = unitSel.value;
    unitSel.innerHTML = unitOptions(section.id, row, null, false);
    unitSel.disabled = false;
    const open = Array.from(unitSel.options).filter((o) => !o.disabled);
    const pick = (keep && open.find((o) => o.value === was)) || open.find((o) => o.value === 'hour') || open[0];
    unitSel.value = pick ? pick.value : 'hour';
    add.disabled = !pick;
  }

  /* A line's unit select, repainted in place: its other options' prices depend
     on the rates toggle, which can change without the line being rebuilt. */
  function paintLineUnits() {
    sections.forEach((section) => {
      rowsIn(section.id).forEach((tr) => {
        const sel = tr.querySelector('.lab-unit-sel');
        if (!sel) return;
        const snap = snapOf(tr) || {};
        const row = cardRowFor(section.id, snap.rowId, tr.dataset.name);
        if (row && row.prices) sel.innerHTML = unitOptions(section.id, row, unitKey(snap), true);
      });
      paintPicker(section, true);
    });
    repaintMenu();
  }

  /* Switching a line's unit: a fresh snapshot from the card at the new unit
     (or last time's, per unitSnap), the typed quantity and custom bill kept,
     totals recalculated, and the new price announced. A unit that can't be
     priced is disabled and can't be picked; if one ever is, the line stays put. */
  function switchUnit(tr, unit) {
    const snap = snapOf(tr) || {};
    const sectionId = tr.dataset.section;
    const row = cardRowFor(sectionId, snap.rowId, tr.dataset.name);
    const picked = row && row.prices ? unitSnap(sectionId, row, unit) : { snap: null, own: null };
    if (!picked.snap) {
      const sel = tr.querySelector('.lab-unit-sel');
      if (sel) sel.value = unitKey(snap);
      return;
    }
    const fresh = reprice(tr, picked.snap);
    markOwn(fresh, picked);
    recalc();
    const sel = fresh.querySelector('.lab-unit-sel');
    if (sel) sel.focus();
    const hours = LSCCalc.hoursPerUnitOf(picked.snap);
    LSCUtil.announce(
      $('editor-live'),
      tr.dataset.name + ': now per ' + UNIT_NAMES[unit].toLowerCase() + ', ' + money(picked.snap.mu) +
        (unit === 'hour' ? '' : ', ' + hours + ' billable ' + (hours === 1 ? 'hr' : 'hrs')) +
        (picked.snap !== picked.own ? ', as on the last project' : '') + '.'
    );
  }

  /* One labour or travel row read back as a saved line: name, snapshot, and
     what was typed — and, for a Production row in a day's card, that day. */
  function lineFrom(tr, withOverride) {
    const line = Object.assign({ name: tr.dataset.name }, snapOf(tr) || {}, {
      qty: num(inputValue(tr, '.qty-inp')),
    });
    if (withOverride) line.override = num(inputValue(tr, '.custom-bill-inp'));
    const dayId = rowDayId(tr);
    if (dayId) line.dayId = dayId;
    return line;
  }

  /* An on-set row's day is the card it sits in (B2-4: production, travel,
     crew and gear). Not on a day's panel has an empty data-items-day. */
  function rowDayId(tr) {
    if (tr.dataset.section !== 'prod' && !tr.dataset.kind) return null;
    const panel = tr.closest('[data-items-day]');
    return panel && panel.dataset.itemsDay ? panel.dataset.itemsDay : null;
  }

  // ── Row builders ──────────────────────────────────────────────────────────

  /* Every cell carries data-label, matching its column heading in the .gt-head
     above it. Below 768px the grid stops being a table: .gt-head is hidden and
     css/responsive.css prints each cell's data-label beside its value, so a row
     reads as a stacked list instead of six columns squeezed into 335px. The
     labels have to be per cell rather than generated from nth-child, because
     three sections share .expense-grid with different headings (Travel is
     "Qty / Cost", crew is "Days"/"Day Rate", equipment is "Days"/"Cost/Day").
     Inert above 768px: nothing reads the attribute there. */

  /* No Rate column on labour rows (2026-09-21). A row's stored `rate` has been
     inert since the Finance track made the Pricing screen show one computed
     Overhead Rate/hr for every labour row — nothing prices off it — so printing
     it here contradicted Pricing on the same data. Travel rows keep theirs: a
     travel rate is still entered by hand. The same column is gone from
     estimate-detail.js. */
  /* UNITS ON THE LINE (2026-09-27 day rows; 2026-09-28 service units). Every
     labour category heads its quantity column "Qty", and every priced line
     says what its quantity counts on a line under its name — "per [full day ▾]
     · 8 billable hrs", the Rate Card's own wording. The unit is a select while
     the line's service is still on the card (see switchUnit), and plain text
     when it isn't — an archived category, or a service since deleted — since
     there is nothing left to re-price it from. The hours are the line's own,
     from its snapshot. The stacked mobile label and the input's accessible name
     say the unit too ("Full days for …"), since neither can see the heading. */
  function buildLabourRow(section, def, line) {
    const tr = document.createElement('div');
    tr.className = 'gt-row labour-grid';
    tr.dataset.rid = rid();
    tr.dataset.section = section.id;
    tr.dataset.name = line.name;
    const snap = snapFor(def, line);
    if (snap) tr.dataset.snap = JSON.stringify(snap);
    def = snap ? Object.assign({ name: line.name }, snap) : null;

    const custom = def && def.customBill;
    const customCell = custom
      ? '<input class="num-inp custom-bill-inp" type="number" min="0" step="0.01" value="' +
        (line.override || '') + '" title="Override bill ($)" aria-label="Override bill for ' + esc(line.name) + '">'
      : '';

    const unit = LSCRows.labourUnit(def);
    const qtyLabel = LSCRows.qtyLabel(unit.kind);
    const cardRow = def && !section.archived ? cardRowFor(section.id, def.rowId, line.name) : null;
    const unitCtl = cardRow && cardRow.prices
      ? '<select class="lab-unit-sel" aria-label="Unit for ' + esc(line.name) + '">' +
        unitOptions(section.id, cardRow, unitKey(def), true) + '</select>'
      : LSCRows.unitWord(unit.kind, 1);
    const unitLine = !def
      ? ''
      : '<div class="lab-unit">per ' + unitCtl +
        (unit.kind === 'hour' ? '' : ' · ' + unit.hoursPerUnit + ' billable ' + (unit.hoursPerUnit === 1 ? 'hr' : 'hrs')) +
        '</div>';

    tr.innerHTML =
      '<div data-label="Service"' + (unitLine ? ' class="lab-svc"' : '') + '>' + esc(line.name) + unitLine + '</div>' +
      '<div class="right" data-label="' + qtyLabel + '"><input class="num-inp qty-inp" type="number" min="0" step="0.5" value="' +
      (line.qty || '') + '" aria-label="' + qtyLabel + ' for ' + esc(line.name) + '"></div>' +
      '<div class="right muted-td" data-label="Mark-Up">' + (def ? fmt(def.mu) : '—') + '</div>' +
      /* A Production line on a surcharged day says why its price is higher,
         under the price, owner-only (the client's copy never says it, D8). */
      '<div class="right' + (section.id === 'prod' ? ' bill-col' : '') + '" data-label="Client Bill">' +
      '<span class="bill-cell">—</span>' + customCell +
      (section.id === 'prod' ? '<span class="sur-note" hidden></span>' : '') + '</div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove ' +
      esc(line.name) + '" aria-label="Remove ' + esc(line.name) + '">×</button></div>';

    bindRow(tr, ['.qty-inp', '.custom-bill-inp']);
    if (section.id === 'prod' && !section.archived) addLineControls(tr, 'prod');
    const unitSel = tr.querySelector('.lab-unit-sel');
    if (unitSel) unitSel.addEventListener('change', () => switchUnit(tr, unitSel.value));
    return tr;
  }

  function buildTravelRow(def, line) {
    const tr = document.createElement('div');
    tr.className = 'gt-row expense-grid';
    tr.dataset.rid = rid();
    /* `kind`, not `section`: a row with no data-section is how the rates code
       tells travel from labour (priceRows, samePrice, lastRateFor). */
    tr.dataset.kind = 'travel';
    tr.dataset.name = line.name;
    const snap = snapFor(def, line);
    if (snap) tr.dataset.snap = JSON.stringify(snap);
    def = snap ? Object.assign({ name: line.name }, snap) : null;

    /* The car's km line (task 6b): at cost, its price per km from Overhead,
       its quantity kilometres. */
    const perKm = Boolean(def && def.perKm);
    const rateLabel = !def ? '—' : perKm ? 'At cost' : def.directCost ? 'Direct' : def.rate > 0 ? fmt(def.rate) : '—';
    const muLabel = !def ? '—' : perKm ? LSCUtil.perKm(def.mu) : def.directCost ? '—' : def.mu !== def.rate ? fmt(def.mu) : 'None';

    tr.innerHTML =
      '<div data-label="Service">' + esc(line.name) + '</div>' +
      '<div class="right" data-label="' + (perKm ? 'Kilometres' : 'Qty / Cost') + '"><input class="num-inp qty-inp" type="number" min="0" step="0.01" value="' +
      (line.qty || '') + '" aria-label="' + (perKm ? 'Kilometres' : 'Quantity') + ' for ' + esc(line.name) + '"></div>' +
      '<div class="right muted-td" data-label="Rate">' + rateLabel + '</div>' +
      '<div class="right muted-td" data-label="Mark-Up">' + muLabel + '</div>' +
      '<div class="right" data-label="Client Bill"><span class="bill-cell">—</span></div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove ' +
      esc(line.name) + '" aria-label="Remove ' + esc(line.name) + '">×</button></div>';

    bindRow(tr, ['.qty-inp']);
    addLineControls(tr, 'travel');
    return tr;
  }

  /* Equipment and crew are the same shape — a name, days, and a cost per day —
     and bill identically. One builder, two labels.

     EQUIPMENT (B2-7, D82): Vendor and Item, where it was one "Vendor / item"
     field. The Vendor suggests this estimate's vendors, since all the hire
     from one vendor is one gear rental (syncRentals). A line saved before B2-7
     has no `item`: its one field's text becomes the Item, with no Vendor, so
     it joins no rental (confirmed 2026-10-03). */
  function buildCostRow(kind, line) {
    const isEquip = kind === 'equip';
    const legacy = isEquip && !Object.prototype.hasOwnProperty.call(line, 'item');
    const costCol = isEquip ? 'Cost/Day' : 'Day Rate';

    const tr = document.createElement('div');
    tr.className = 'gt-row expense-grid';
    tr.dataset.rid = rid();
    tr.dataset.kind = kind;

    // Must match the day card's group heads (DAY_GROUPS) for this kind — the stacked
    // mobile row prints these in place of the headings it hides.
    const nameCell = isEquip
      ? '<div data-label="Vendor · Item"><div class="equip-names">' +
        '<input class="text-inp vendor-inp" type="text" maxlength="200" value="' + esc(legacy ? '' : line.vendor || '') +
        '" placeholder="Vendor" aria-label="Vendor">' +
        '<input class="text-inp item-inp" type="text" value="' + esc((legacy ? line.vendor : line.item) || '') +
        '" placeholder="Item" aria-label="Item"></div>' +
        '<button type="button" class="rental-hint" hidden>Add pickup and return dates <span aria-hidden="true">↓</span></button></div>'
      : '<div data-label="Role / Name"><input class="text-inp role-inp" type="text" value="' + esc(line.role || '') +
        '" placeholder="Role / contractor name" aria-label="Role or contractor"></div>';

    tr.innerHTML =
      nameCell +
      '<div class="right" data-label="Days"><input class="num-inp days-inp" type="number" min="0" step="0.5" value="' +
      (line.days || '') + '" aria-label="Days"></div>' +
      '<div class="right" data-label="' + costCol + '"><input class="num-inp cost-inp" type="number" min="0" step="0.01" value="' +
      (line.cost || '') + '" aria-label="Cost per day"></div>' +
      '<div class="right muted-td mu-cell">—</div>' +
      '<div class="right" data-label="Total"><span class="bill-cell">—</span></div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove" aria-label="Remove row">×</button></div>';

    bindRow(tr, ['.days-inp', '.cost-inp']);
    // Names price nothing, but the summaries and the rentals read them.
    tr.querySelectorAll('.role-inp, .vendor-inp, .item-inp').forEach((input) => input.addEventListener('input', recalc));
    if (isEquip) {
      const vendor = tr.querySelector('.vendor-inp');
      ClientTypeahead.attach(vendor, {
        fetch: (query) => vendorsLike(query),
        label: (v) => v.vendor,
        sub: (v) => plural(v.items, 'item', 'items'),
        debounce: 0,
        onPick: (v) => {
          vendor.value = v.vendor;
          vendor.dispatchEvent(new Event('input', { bubbles: true }));
        },
      });
      tr.querySelector('.rental-hint').addEventListener('click', () => focusRental(vendorKey(vendor.value)));
    }
    addLineControls(tr, kind);
    return tr;
  }

  /* ── Deliverables: typed, for the post-production planner (B2-3) ────────
     Each deliverable has an id, made here, that its post lines will point at
     (`deliverableId`, B2-10). Ids are [A-Za-z0-9_-]{1,64} and unique on the
     estimate (the server's deliverable_id_* checks); a row saved before B2
     gets one when it's built, which is before the unsaved-edit baseline is
     taken, so opening an old estimate doesn't read as an edit.

     A type is picked from the Rate Card's Deliverable Types (D91). Picking one
     SNAPSHOTS its id, name and multiplier on the row: like a line's price, a
     saved deliverable keeps the multiplier it was typed with when the card
     changes later. A type since removed from the card stays on the row,
     offered under its saved name, until another is picked. */
  function newDeliverableId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
      return 'dv' + crypto.randomUUID().replace(/-/g, '');
    }
    return 'dv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  /* The card's types, A–Z, as the Type select lists them after "— None —". */
  function deliverableTypes() {
    const types = (LSCData.pricing() || {}).deliverableTypes;
    return (Array.isArray(types) ? types : [])
      .filter((t) => t && t.id)
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  }

  const DELIV_ID = /^[A-Za-z0-9_-]{1,64}$/;

  function buildDeliverableRow(line) {
    const tr = document.createElement('div');
    tr.className = 'gt-row deliv-grid deliv-typed';
    tr.dataset.rid = rid();
    tr.dataset.did = typeof line.id === 'string' && DELIV_ID.test(line.id) ? line.id : newDeliverableId();

    /* What the row was saved with, so re-picking a removed type restores it. */
    const saved = line.typeId
      ? { typeId: String(line.typeId), typeName: String(line.typeName || ''), multiplier: Number(line.multiplier) || 0 }
      : null;
    const types = deliverableTypes();
    const savedGone = saved && !types.some((t) => t.id === saved.typeId);
    const option = (value, label, selected) =>
      '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    const options =
      option('', '— None —', !saved) +
      types.map((t) => option(t.id, t.name || 'Untitled type', saved && saved.typeId === t.id)).join('') +
      (savedGone ? option(saved.typeId, (saved.typeName || 'Type') + ' (removed)', true) : '');

    tr.innerHTML =
      '<div data-label="Type"><select class="deliv-type-sel" aria-label="Deliverable type"' +
      (savedGone ? ' title="This type has been removed from the Rate Card. The row keeps what it was saved with."'
        : types.length ? '' : ' title="Add Deliverable Types on the Rate Card"') + '>' + options + '</select></div>' +
      '<div data-label="Name"><input class="deliv-name-inp text-inp" type="text" placeholder="e.g. Hero Video" value="' +
      esc(line.name || '') + '" aria-label="Deliverable name"></div>' +
      '<div data-label="Format"><input class="deliv-fmt-inp text-inp" type="text" placeholder="e.g. 16:9 4K" value="' +
      esc(line.format || '') + '" aria-label="Format"></div>' +
      '<div data-label="Length"><input class="deliv-dur-inp text-inp" type="text" placeholder="e.g. 60 sec" value="' +
      esc(line.duration || '') + '" aria-label="Length"></div>' +
      '<div class="right" data-label="Qty"><input class="deliv-qty-inp num-inp" type="number" min="0" value="' +
      (line.qty || 1) + '" aria-label="Quantity"></div>' +
      // The planner's share for this deliverable (calc.js postPlan); filled by B2-10.
      '<div class="right muted-td deliv-rec" data-label="Post hrs (rec.)">—</div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove" aria-label="Remove deliverable">×</button></div>';

    const setType = (snap) => {
      if (snap) {
        tr.dataset.typeId = snap.typeId;
        tr.dataset.typeName = snap.typeName;
        tr.dataset.multiplier = String(snap.multiplier);
      } else {
        delete tr.dataset.typeId;
        delete tr.dataset.typeName;
        delete tr.dataset.multiplier;
      }
    };
    setType(saved);

    tr.querySelector('.deliv-type-sel').addEventListener('change', (e) => {
      const value = e.target.value;
      if (!value) return setType(null);
      if (savedGone && value === saved.typeId) return setType(saved);
      const t = types.find((x) => x.id === value);
      if (!t) return setType(null);
      setType({ typeId: t.id, typeName: String(t.name || ''), multiplier: Number(t.multiplier) || 0 });
      // The type's name fills a blank Name; a name already typed is the owner's.
      const name = tr.querySelector('.deliv-name-inp');
      if (!name.value.trim()) name.value = String(t.name || '');
    });

    bindRow(tr, []);
    return tr;
  }

  function bindRow(tr, inputSelectors) {
    inputSelectors.forEach((selector) => {
      const input = tr.querySelector(selector);
      if (!input) return;
      // Ported from the desktop app: a field showing 0 clears on focus, so the
      // first keystroke doesn't produce "05".
      input.addEventListener('focus', function () {
        if (this.value === '0' || parseFloat(this.value) === 0) this.value = '';
      });
      input.addEventListener('input', recalc);
    });
    tr.querySelector('.del-btn').addEventListener('click', () => removeRow(tr));
  }

  function removeRow(tr) {
    const body = tr.parentNode;
    if (!body) return;
    const emptyText = body.dataset.emptyText;
    tr.remove();
    if (emptyText && !body.querySelector('[data-rid]')) {
      const empty = document.createElement('div');
      empty.className = 'empty-row';
      empty.textContent = emptyText;
      body.appendChild(empty);
    }
    recalc();
  }

  function injectRow(body, tr) {
    if (!body) return;
    const empty = body.querySelector('.empty-row');
    if (empty) empty.remove();
    body.appendChild(tr);
    recalc();
  }

  // ── Section markup ────────────────────────────────────────────────────────

  function bodyMarkup(id, emptyText) {
    return (
      '<div class="gt-body" id="tbody-' + esc(id) + '" data-empty-text="' + esc(emptyText) + '">' +
      '<div class="empty-row">' + esc(emptyText) + '</div></div>'
    );
  }

  function labourSectionMarkup(section) {
    const options = section.rows.length
      ? section.rows.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + '</option>').join('')
      : '<option value="">No services in this category — add one under Pricing</option>';

    // An archived category has no picker: its services are gone from the rate
    // card, so there is nothing left to add. Existing rows stay visible and
    // removable. The unit select is filled by paintPicker() once bound.
    const picker = section.archived
      ? ''
      : '<div class="bb-picker"><select class="svc-select" id="sel-' + esc(section.id) +
        '" aria-label="Service to add to ' + esc(section.label) + '">' + options + '</select>' +
        '<select class="svc-select unit-select" id="unit-' + esc(section.id) +
        '" aria-label="Unit to add for ' + esc(section.label) + '"></select>' +
        '<button type="button" class="btn btn-accent btn-sm" id="add-' + esc(section.id) + '">+ Add Service</button></div>';

    const tag = section.archived
      ? '<span class="bb-label-tag">No longer on the rate card</span>'
      : '<span class="bb-label-tag">Labour</span>';

    return (
      '<div class="billing-block">' +
      '<div class="bb-head"><div><h2 class="bb-label">' + esc(section.label) + '</h2>' + tag + '</div>' +
      '<span class="bb-sum">Subtotal <b id="sum-' + esc(section.id) + '">$0.00</b></span></div>' +
      picker +
      '<div class="gt-head labour-grid"><div>Service</div><div class="right">Qty</div>' +
      '<div class="right">Mark-Up</div><div class="right">Client Bill</div><div></div></div>' +
      bodyMarkup(section.id, 'No services added. Use the selector above to add one.') +
      '</div>'
    );
  }

  // ── Production items on days (task 7) ─────────────────────────────────────

  // "Add to a day"'s option for a new Date TBC day. A space: no day id can hold one (days.js DAY_ID).
  const NEW_TBC = 'new tbc';

  const labourHead =
    '<div class="gt-head labour-grid"><div>Service</div><div class="right">Qty</div>' +
    '<div class="right">Mark-Up</div><div class="right">Client Bill</div><div></div></div>';

  const prodSection = () => sections.find((s) => s.id === 'prod' && !s.archived) || null;

  /* A day card's line groups (B2-4, the IA's card order): each with the
     column heads of the section it belongs to, shown only when it has lines. */
  const DAY_GROUPS = [
    ['prod', 'Production', labourHead],
    ['travel', 'Travel', '<div class="gt-head expense-grid"><div>Service</div><div class="right">Qty / Cost</div>' +
      '<div class="right">Rate</div><div class="right">Mark-Up</div><div class="right">Client Bill</div><div></div></div>'],
    ['crew', 'Crew', '<div class="gt-head expense-grid"><div>Role / Name</div><div class="right">Days</div>' +
      '<div class="right">Day Rate</div><div class="right">—</div><div class="right">Total</div><div></div></div>'],
    ['equip', 'Equipment', '<div class="gt-head expense-grid"><div>Vendor · Item</div><div class="right">Days</div>' +
      '<div class="right">Cost/Day</div><div class="right">—</div><div class="right">Total</div><div></div></div>'],
  ];

  const OFF_DAY = BookingBlock.OFF;
  const groupBody = (panel, kind) => panel.querySelector('.gt-body[data-group="' + kind + '"]');

  /* One card's items: "Add Production Service Items", which opens the service
     menu on this card (B2-4, D74), then its line groups, then the D26 hours
     hint. Built once per day and kept (dayPanels); the booking block moves it
     into the day's card on every paint. Not on a day's (OFF_DAY) is put in
     its card once; its data-items-day is empty, so its lines carry no day. */
  function panelFor(dayId) {
    if (dayPanels.has(dayId)) return dayPanels.get(dayId);
    const off = dayId === OFF_DAY;
    const panel = document.createElement('div');
    panel.className = 'day-items';
    panel.dataset.itemsDay = off ? '' : dayId;
    panel.innerHTML =
      '<div class="day-items-bar">' +
      '<button type="button" class="btn btn-ghost btn-sm day-menu-btn" aria-expanded="false">' +
      (off ? 'Add items' : 'Add Production Service Items') + '</button>' +
      '<span class="day-items-sum">' + (off ? 'Total' : 'Day total') + ' <b class="day-items-total">$0.00</b></span></div>' +
      '<p class="day-items-empty">' + (off ? 'Nothing here.' : 'Nothing on this day yet.') + '</p>' +
      DAY_GROUPS.map(([kind, label, head]) =>
        '<div class="day-group" data-group="' + kind + '" hidden>' +
        '<p class="day-group-label">' + label + '</p>' + head +
        '<div class="gt-body" data-group="' + kind + '" data-empty-text=""></div></div>'
      ).join('') +
      '<p class="day-hours" hidden></p>';
    panel.querySelector('.day-menu-btn').addEventListener('click', (e) => toggleMenu(dayId, e.currentTarget));
    dayPanels.set(dayId, panel);
    return panel;
  }

  // ── The service menu (B2-4, D74–D77) ──────────────────────────────────────
  /* "Add Production Service Items" on a card opens one menu, the editor's
     only way to add an on-set line (the brief's B2 principle 1). At ≥768 it
     swaps in for the calendar, in its column (BookingBlock.menuHost) — a
     labelled region, not a dialog, so the card it adds to stays in view and
     usable beside it. Below 768 it is a bottom sheet over the page, with the
     app's focus trap (LSCModal), and the card updates behind it.

     A call-sheet checklist, not a shop: the service name left, unit buttons
     right with their price muted, categories as quiet disclosure heads. Each
     add lands on the target card straight away at that card's day's prices;
     the menu stays open and counts what was added. Done, Escape, or the
     card's own button again closes it, with focus back on that button;
     another card's button retargets it. */
  const MENU_FILTER_AT = 12; // Production rows past which the filter field appears (IA Content Growth)
  const UNIT_SHORT = { hour: 'Hr', half: '½ Day', full: 'Day' };
  const UNIT_SPOKEN = { hour: 'hour', half: 'half day', full: 'full day' };
  const UNIT_ADDED = { hour: 'Hour', half: 'Half Day', full: 'Full Day' };
  const MENU_GROUPS = [
    ['prod', 'Production'],
    ['travel', 'Travel'],
    ['crew', 'External Crew'],
    ['equip', 'Equipment Hire'],
  ];
  const menu = { el: null, target: null, trigger: null, sheet: false, count: 0, filter: '', open: { prod: true } };
  const narrow = () => window.matchMedia('(max-width: 767px)').matches;

  function toggleMenu(dayKey, trigger) {
    if (menu.el && menu.target === dayKey) return closeMenu(true);
    openMenu(dayKey, trigger);
  }

  /* A card as the menu and Move to name it: "Sat 3 Oct", "Day 3 — date TBC",
     "Not on a day" (the IA's B2 naming). */
  function cardName(key) {
    if (key === OFF_DAY) return 'Not on a day';
    const d = (booking ? booking.list() : []).find((x) => x.id === key);
    if (!d) return 'this day';
    return d.date ? LSCCalendar.shortDate(d.date) : d.title;
  }

  function paintMenuTitle() {
    if (!menu.el) return;
    menu.el.querySelector('#day-menu-h').textContent = 'Adding to ' + cardName(menu.target);
  }

  function paintMenuCount() {
    const c = menu.el && menu.el.querySelector('#day-menu-count');
    if (c) c.textContent = menu.count ? menu.count + ' added' : '';
  }

  /* Each group's body. Prices are today's card (or the last project's while
     that toggle is on: unitSnap), as the line would be snapshotted; a unit
     with no price yet is disabled and says what it needs, as the old picker's
     options did. */
  function menuGroupBody(kind) {
    const pricing = LSCData.pricing();
    const needs = LSCData.autoPriceBlocker().screen;
    if (kind === 'prod') {
      const section = prodSection();
      const rows = section ? section.rows : [];
      if (!rows.length) return '<p class="dm-none">No Production services on the Rate Card.</p>';
      return rows.map((row) => {
        const units = row.prices ? LSCCalc.SERVICE_UNITS : ['hour'];
        const buttons = units.map((u) => {
          const { snap } = unitSnap('prod', row, u);
          const label = snap
            ? 'Add ' + row.name + ', ' + UNIT_SPOKEN[u] + ', ' + money(snap.mu)
            : row.name + ', ' + UNIT_SPOKEN[u] + ': no price yet, needs ' + needs;
          return '<button type="button" class="dm-unit" data-add="prod" data-name="' + esc(row.name) + '" data-unit="' + u + '"' +
            (snap ? '' : ' disabled') + ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
            UNIT_SHORT[u] + ' <span class="dm-price">' + (snap ? money(snap.mu) : '—') + '</span></button>';
        }).join('');
        return '<div class="dm-row" data-filter="' + esc(row.name.toLowerCase()) + '"><span class="dm-name">' + esc(row.name) +
          '</span><span class="dm-units">' + buttons + '</span></div>';
      }).join('') + '<p class="dm-none dm-nomatch" hidden>No service matches.</p>';
    }
    if (kind === 'travel') {
      const defs = (pricing && pricing.travelRows) || [];
      if (!defs.length) return '<p class="dm-none">No travel items on the Rate Card.</p>';
      return defs.map((row) => {
        const { snap } = unitSnap('', row, 'hour');
        const price = !snap ? '' : snap.perKm ? LSCUtil.perKm(snap.mu) : snap.directCost ? 'at cost' : money(snap.mu);
        const label = snap ? 'Add ' + row.name : row.name + ': no price yet, needs ' + (row.perKm ? 'Overhead' : needs);
        return '<div class="dm-row"><span class="dm-name">' + esc(row.name) + '</span><span class="dm-units">' +
          '<button type="button" class="dm-unit" data-add="travel" data-name="' + esc(row.name) + '"' + (snap ? '' : ' disabled') +
          ' aria-label="' + esc(label) + '" title="' + esc(label) + '">Add <span class="dm-price">' + esc(price || '—') + '</span></button>' +
          '</span></div>';
      }).join('');
    }
    // No Rate Card list for crew or gear (D77): a typed row each.
    return kind === 'crew'
      ? '<button type="button" class="btn btn-ghost btn-sm dm-blank" data-add="crew">+ Add crew member</button>'
      : '<button type="button" class="btn btn-ghost btn-sm dm-blank" data-add="equip">+ Add hire item</button>';
  }

  function menuMarkup() {
    const prodRows = (prodSection() || { rows: [] }).rows.length;
    return (
      '<section class="day-menu' + (menu.sheet ? ' is-sheet' : '') + '" id="day-menu" aria-labelledby="day-menu-h">' +
      '<div class="day-menu-head">' +
      '<h3 class="day-menu-title" id="day-menu-h" tabindex="-1"></h3>' +
      '<span class="day-menu-count" id="day-menu-count"></span>' +
      '<button type="button" class="btn btn-accent btn-sm day-menu-done">Done</button></div>' +
      '<p class="day-menu-status" id="day-menu-status" role="status"></p>' +
      (prodRows > MENU_FILTER_AT
        ? '<input type="search" class="text-inp dm-filter" placeholder="Filter Production services" aria-label="Filter Production services" value="' +
          esc(menu.filter) + '">'
        : '') +
      MENU_GROUPS.map(([kind, label]) => {
        const isOpen = Boolean(menu.open[kind]);
        return '<div class="dm-group" data-group="' + kind + '">' +
          '<button type="button" class="dm-ghead" aria-expanded="' + isOpen + '" aria-controls="dm-g-' + kind + '">' +
          '<span class="bb-chevron" aria-hidden="true">▶</span>' + label + '</button>' +
          '<div class="dm-gbody" id="dm-g-' + kind + '"' + (isOpen ? '' : ' hidden') + '>' + menuGroupBody(kind) + '</div></div>';
      }).join('') +
      '</section>'
    );
  }

  function applyMenuFilter() {
    if (!menu.el) return;
    const q = menu.filter.trim().toLowerCase();
    let shown = 0;
    menu.el.querySelectorAll('#dm-g-prod .dm-row').forEach((r) => {
      const hit = !q || r.dataset.filter.indexOf(q) !== -1;
      r.hidden = !hit;
      if (hit) shown += 1;
    });
    const none = menu.el.querySelector('.dm-nomatch');
    if (none) none.hidden = shown > 0;
  }

  /* The prices can move under an open menu (the rates toggle, the Invoice
     Settings modal): its group bodies are rebuilt, the rest kept. */
  function repaintMenu() {
    if (!menu.el) return;
    MENU_GROUPS.forEach(([kind]) => {
      const body = menu.el.querySelector('#dm-g-' + kind);
      if (body) body.innerHTML = menuGroupBody(kind);
    });
    applyMenuFilter();
  }

  function onMenuSheetKeydown(event) {
    const overlay = document.getElementById('modal-day-menu');
    if (!overlay || overlay.closest('[hidden]')) return;
    if (event.key === 'Escape') return closeMenu(true);
    LSCModal.trapTab(overlay, event);
  }

  /* `kind`, from a summary's "Add to a day" (B2-6), opens the menu at that
     category: it alone is expanded, so it sits right under the head. */
  function openMenu(dayKey, trigger, kind) {
    if (!booking) return;
    closeMenu(false);
    if (kind) menu.open = { [kind]: true };
    menu.target = dayKey;
    menu.trigger = trigger || null;
    menu.count = 0;
    menu.sheet = narrow();

    const holder = document.createElement('div');
    holder.innerHTML = menuMarkup();
    menu.el = holder.firstElementChild;
    if (menu.sheet) {
      const overlay = document.getElementById('modal-day-menu');
      overlay.innerHTML = '<div class="modal-box dm-sheet" role="dialog" aria-modal="true" aria-labelledby="day-menu-h"></div>';
      overlay.firstElementChild.appendChild(menu.el);
      overlay.classList.add('open');
      document.addEventListener('keydown', onMenuSheetKeydown);
      overlay.addEventListener('click', onMenuOverlayClick);
    } else {
      const host = booking.menuHost();
      host.classList.add('is-menu');
      host.appendChild(menu.el);
      menu.el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu(true);
      });
    }
    bindMenu(menu.el);
    paintMenuTitle();
    applyMenuFilter();
    booking.setTarget(dayKey);
    if (menu.trigger) menu.trigger.setAttribute('aria-expanded', 'true');
    // 768–1099 the column sits above the cards: bring the menu's head into view.
    if (!menu.sheet) menu.el.scrollIntoView({ block: 'nearest' });
    menu.el.querySelector('#day-menu-h').focus({ preventScroll: !menu.sheet });
  }

  function onMenuOverlayClick(event) {
    if (event.target === document.getElementById('modal-day-menu')) closeMenu(true);
  }

  function closeMenu(returnFocus) {
    if (!menu.el) return;
    const trigger = menu.trigger;
    if (menu.sheet) {
      const overlay = document.getElementById('modal-day-menu');
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      document.removeEventListener('keydown', onMenuSheetKeydown);
      overlay.removeEventListener('click', onMenuOverlayClick);
    } else {
      const host = menu.el.parentNode;
      menu.el.remove();
      if (host) host.classList.remove('is-menu');
    }
    if (booking) booking.setTarget(null);
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    menu.el = null;
    menu.target = null;
    menu.trigger = null;
    if (returnFocus && trigger && trigger.isConnected) trigger.focus();
  }

  function bindMenu(el) {
    el.querySelector('.day-menu-done').addEventListener('click', () => closeMenu(true));
    const filter = el.querySelector('.dm-filter');
    if (filter) {
      filter.addEventListener('input', () => {
        menu.filter = filter.value;
        applyMenuFilter();
      });
    }
    el.addEventListener('click', (e) => {
      const head = e.target.closest('.dm-ghead');
      if (head) {
        const kind = head.parentNode.dataset.group;
        menu.open[kind] = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(menu.open[kind]));
        el.querySelector('#dm-g-' + kind).hidden = !menu.open[kind];
        return;
      }
      const btn = e.target.closest('[data-add]');
      if (btn && !btn.disabled) addFromMenu(btn.dataset.add, btn.dataset.name, btn.dataset.unit);
    });
  }

  /* One line onto the target card, priced as a new line always is (unitSnap,
     markOwn). Production arrives at qty 1, so it is priced at once at its
     day's surcharges; travel at 1, but the car per km at 0 km, focused for
     the distance; crew and gear empty, focused on their name (D76, D77). A
     field that needs typing closes the sheet on a phone, where it can't be
     reached behind it. */
  function addFromMenu(kind, name, unit) {
    const panel = panelFor(menu.target);
    let tr = null;
    let focusSel = null;
    let said = '';
    if (kind === 'prod') {
      const section = prodSection();
      const row = section && section.rows.find((r) => r.name === name);
      if (!row) return;
      const picked = unitSnap('prod', row, row.prices ? unit : 'hour');
      if (!picked.snap) return;
      tr = buildLabourRow(section, null, Object.assign({ name: row.name, qty: 1 }, picked.snap));
      markOwn(tr, picked);
      said = row.name + ' — ' + UNIT_ADDED[row.prices ? unit : 'hour'];
    } else if (kind === 'travel') {
      const def = ((LSCData.pricing() || {}).travelRows || []).find((r) => r.name === name);
      if (!def) return;
      const picked = unitSnap('', def, 'hour');
      if (!picked.snap) return;
      const perKm = Boolean(picked.snap.perKm);
      tr = buildTravelRow(null, Object.assign({ name: def.name, qty: perKm ? 0 : 1 }, picked.snap));
      markOwn(tr, picked);
      if (perKm) focusSel = '.qty-inp';
      said = def.name;
    } else {
      tr = buildCostRow(kind, kind === 'equip' ? { vendor: '', item: '' } : {});
      focusSel = kind === 'crew' ? '.role-inp' : '.vendor-inp';
      said = kind === 'crew' ? 'a crew member' : 'a hire item';
    }
    injectRow(groupBody(panel, kind), tr);
    menu.count += 1;
    paintMenuCount();
    const status = menu.el && menu.el.querySelector('#day-menu-status');
    if (status) status.textContent = 'Added ' + said + '.';
    if (!focusSel) return;
    if (menu.sheet) closeMenu(false);
    const field = tr.querySelector(focusSel);
    if (field) field.focus();
  }

  // ── Moving lines between cards (B2-5, D80, D81) ───────────────────────────
  /* A line's day is the card it sits in, and recalc prices every line from
     where it sits — so a move is the row itself moved into another card's
     group, then a recalc. Nothing is rebuilt: what's typed, the snapshot, the
     unit, the custom bill and both rate marks go with it, and production
     re-prices at the new day's surcharges (D80 overturns task 7's one-way
     move).

     Two ways, one result. Drag the handle (mouse and pen, pointer events;
     touch never drags, and the handle is hidden below 768) onto any card's
     group of the same kind, or Not on a day; dropping in the line's own card
     reorders it. Or "Move to ▾", a menu button listing the other cards — the
     single-pointer and keyboard route (WCAG 2.5.7). Pressing the handle opens
     the same list. Either way the move is announced with the line's new
     price and what it now carries. */

  const keyOf = (tr) => {
    const panel = tr.closest('[data-items-day]');
    return panel && panel.dataset.itemsDay ? panel.dataset.itemsDay : OFF_DAY;
  };
  const kindOf = (tr) => tr.dataset.kind || tr.dataset.section;

  /* "Video Capture — Full Day", "Crew Meals", "Gaffer", "Lensworks". */
  function lineLabel(tr) {
    const kind = kindOf(tr);
    if (kind === 'crew') return inputValue(tr, '.role-inp').trim() || 'crew member';
    if (kind === 'equip') return inputValue(tr, '.item-inp').trim() || inputValue(tr, '.vendor-inp').trim() || 'hire item';
    const snap = snapOf(tr) || {};
    const day = kind === 'prod' && (snap.dayUnit === 'full' || snap.dayUnit === 'half') ? ' — ' + UNIT_ADDED[snap.dayUnit] : '';
    return tr.dataset.name + day;
  }

  function labelLineControls(tr) {
    const ctl = tr.querySelector('.line-ctl');
    if (!ctl) return;
    const name = lineLabel(tr);
    const handle = ctl.querySelector('.line-handle');
    handle.setAttribute('aria-label', 'Move ' + name);
    handle.title = 'Drag ' + name + ' to another day, or press to choose one';
    ctl.querySelector('.line-move .sr-only').textContent = ', for ' + name;
  }

  /* Under the line's name: the handle, then Move to. The handle is a real
     button that opens the list too, but no tab stop: Move to, beside it,
     is the keyboard's way, and one line shouldn't cost two stops for one
     action. */
  function addLineControls(tr, kind) {
    const cell = tr.firstElementChild;
    cell.classList.add('lab-svc');
    const ctl = document.createElement('div');
    ctl.className = 'line-ctl';
    ctl.innerHTML =
      '<button type="button" class="line-handle" tabindex="-1" aria-haspopup="menu" aria-expanded="false">' +
      '<span aria-hidden="true">⠿</span></button>' +
      '<button type="button" class="line-move" aria-haspopup="menu" aria-expanded="false">Move to' +
      '<span class="sr-only"></span> <span aria-hidden="true">▾</span></button>';
    cell.appendChild(ctl);
    const handle = ctl.querySelector('.line-handle');
    const move = ctl.querySelector('.line-move');
    move.addEventListener('click', () => openMovePop(tr, move));
    bindDrag(tr, kind, handle);
    tr.querySelectorAll('.role-inp, .vendor-inp, .item-inp').forEach((name) =>
      name.addEventListener('input', () => labelLineControls(tr)));
    labelLineControls(tr);
  }

  /* Puts a line in `body` before `before` (or last), re-prices, and says so. */
  function moveLine(tr, body, before) {
    const to = body.closest('[data-items-day]');
    const key = to && to.dataset.itemsDay ? to.dataset.itemsDay : OFF_DAY;
    body.insertBefore(tr, before || null);
    recalc();
    const price = (tr.querySelector('.bill-cell') || {}).textContent || '';
    const note = tr.querySelector('.sur-note');
    const carries = note && !note.hidden ? note.textContent.replace(/^incl\. /, '') : '';
    LSCUtil.announce($('editor-live'),
      'Moved ' + lineLabel(tr) + ' to ' + cardName(key) + ': ' + price + (carries ? ', ' + carries : '') + '.');
  }

  // ── The card lists: Move to, and the summaries' Add to a day (B2-6) ──
  /* One small menu of cards under the button that opened it. `owner` is what
     it's for (a line, or the summary's button): the same owner again closes
     it. Picking an item closes it, then calls onPick(key). */
  const pop = { el: null, owner: null, opener: null };

  function closeMovePop(returnFocus) {
    if (!pop.el) return;
    pop.el.remove();
    document.removeEventListener('pointerdown', onPopOutside, true);
    if (pop.opener) pop.opener.setAttribute('aria-expanded', 'false');
    if (returnFocus && pop.opener && pop.opener.isConnected) pop.opener.focus();
    pop.el = null;
    pop.owner = null;
    pop.opener = null;
  }

  function onPopOutside(event) {
    if (pop.el && !pop.el.contains(event.target) && !pop.opener.contains(event.target)) closeMovePop(false);
  }

  function openMovePop(tr, opener) {
    const here = keyOf(tr);
    const cards = (booking ? booking.list() : []).map((d) => d.id).concat([OFF_DAY]).filter((k) => k !== here);
    openCardPop(opener, tr, 'Move ' + lineLabel(tr) + ' to',
      cards.map((k) => ({ key: k, text: cardName(k) })),
      (key) => {
        moveLine(tr, groupBody(panelFor(key), kindOf(tr)), null);
        // Focus follows the line (the brief's B2 Key Interactions 2).
        const again = tr.querySelector('.line-move');
        if (again) again.focus();
      },
      'No other day yet. Book one in Production Booking.');
  }

  function openCardPop(opener, owner, label, items, onPick, emptyText) {
    const reopen = pop.el && pop.owner === owner;
    closeMovePop(false);
    if (reopen) return; // the same button again closes it
    const el = document.createElement('div');
    el.className = 'move-pop';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', label);
    el.innerHTML = items.length
      ? items.map((it) => '<button type="button" role="menuitem" tabindex="-1" data-key="' + esc(it.key) + '">' + esc(it.text) + '</button>').join('')
      : '<p class="move-pop-none">' + esc(emptyText) + '</p>';
    document.body.appendChild(el);
    const r = opener.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.top = Math.round(r.bottom + window.scrollY + 4) + 'px';
    el.style.left = Math.round(Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8)) + window.scrollX) + 'px';
    pop.el = el;
    pop.owner = owner;
    pop.opener = opener;
    opener.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onPopOutside, true);

    const buttons = Array.from(el.querySelectorAll('[role="menuitem"]'));
    el.addEventListener('keydown', (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMovePop(true);
      } else if (e.key === 'Tab') {
        closeMovePop(false);
      } else if (buttons.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[n].focus();
      }
    });
    el.addEventListener('click', (e) => {
      const item = e.target.closest('[data-key]');
      if (!item) return;
      closeMovePop(false);
      onPick(item.dataset.key);
    });
    if (buttons.length) {
      buttons[0].focus();
    } else {
      el.setAttribute('tabindex', '-1');
      el.focus();
    }
  }

  // ── Dragging ──
  /* A drag starts past a few pixels of travel, so a press is still a click
     (which opens the list). While one is on, every card shows its group of
     the line's kind as a drop zone (booking.css), and a rule marks where it
     would land. Escape, or letting go anywhere else, puts nothing anywhere. */
  const DRAG_START_PX = 4;
  const drag = { tr: null, kind: null, x: 0, y: 0, on: false, rule: null, shown: [], suppressClick: false };

  function dropTarget(x, y, kind) {
    const el = document.elementFromPoint(x, y);
    const card = el && el.closest('.day-card');
    const panel = card && card.querySelector('.day-items');
    return panel && root.contains(panel) ? groupBody(panel, kind) : null;
  }

  function placeRule(x, y) {
    const body = dropTarget(x, y, drag.kind);
    if (!body) {
      if (drag.rule.parentNode) drag.rule.remove();
      return;
    }
    const rows = Array.from(body.querySelectorAll(':scope > [data-rid]')).filter((r) => r !== drag.tr);
    const before = rows.find((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    if (drag.rule.parentNode !== body || drag.rule.nextSibling !== (before || null)) body.insertBefore(drag.rule, before || null);
  }

  function endDrag(commit) {
    if (!drag.tr) return;
    const { tr, rule, on } = drag;
    document.removeEventListener('keydown', onDragKey, true);
    root.classList.remove('is-dragging', 'drag-' + drag.kind);
    tr.classList.remove('is-dragging');
    // The empty groups shown as drop zones go again (a drop's recalc re-decides them anyway).
    drag.shown.forEach((g) => (g.hidden = !g.querySelector('[data-rid]')));
    drag.shown = [];
    const body = rule && rule.parentNode;
    const before = body ? rule.nextSibling : null;
    if (rule) rule.remove();
    drag.tr = null;
    drag.on = false;
    drag.rule = null;
    if (on && commit && body) moveLine(tr, body, before);
  }

  function onDragKey(e) {
    if (e.key !== 'Escape' || !drag.on) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag(false);
  }

  function bindDrag(tr, kind, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      drag.tr = tr;
      drag.kind = kind;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.on = false;
      try {
        handle.setPointerCapture(e.pointerId); // keeps the moves coming as the pointer leaves the handle
      } catch (err) {
        /* a pointer the browser no longer tracks: the drag still works while over the handle */
      }
    });
    handle.addEventListener('pointermove', (e) => {
      if (drag.tr !== tr) return;
      if (!drag.on) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < DRAG_START_PX) return;
        drag.on = true;
        closeMovePop(false);
        drag.rule = document.createElement('div');
        drag.rule.className = 'drop-rule';
        drag.rule.setAttribute('aria-hidden', 'true');
        root.classList.add('is-dragging', 'drag-' + kind);
        tr.classList.add('is-dragging');
        /* Every card's group of this kind is a drop zone, an empty one too.
           Shown here, not in CSS: login.css hides [hidden] with !important. */
        drag.shown = Array.from(root.querySelectorAll('.day-group[data-group="' + kind + '"][hidden]'));
        drag.shown.forEach((g) => (g.hidden = false));
        document.addEventListener('keydown', onDragKey, true);
      }
      placeRule(e.clientX, e.clientY);
    });
    handle.addEventListener('pointerup', () => {
      if (drag.tr !== tr) return;
      drag.suppressClick = drag.on; // a drag isn't also a press
      endDrag(true);
    });
    handle.addEventListener('pointercancel', () => endDrag(false));
    handle.addEventListener('click', () => {
      if (drag.suppressClick) {
        drag.suppressClick = false;
        return;
      }
      openMovePop(tr, handle);
    });
  }

  // ── Duplicate day ──
  /* The booking block has made the copy, a Date TBC day after the source
     (D81); its lines are copied here, rebuilt from what each one holds now —
     snapshot, quantity, unit, custom bill, rate marks — and priced as the new
     day is (TBC: no weekend or after hours, short notice still). Gear keeps
     its vendor, so a copy joins the same rental. */
  function duplicateLines(fromKey, toKey) {
    const from = dayPanels.get(fromKey);
    if (!from) return 0;
    const to = panelFor(toKey);
    const pricing = LSCData.pricing();
    const prod = sections.find((sec) => sec.id === 'prod');
    let n = 0;
    ['prod', 'travel', 'crew', 'equip'].forEach((kind) => {
      groupBody(from, kind).querySelectorAll(':scope > [data-rid]').forEach((tr) => {
        let fresh;
        if (kind === 'prod' || kind === 'travel') {
          const line = lineFrom(tr, kind === 'prod');
          delete line.dayId;
          fresh = kind === 'prod'
            ? buildLabourRow(prod, labourDef(prod, line, pricing), line)
            : buildTravelRow(travelDef(line, pricing), line);
        } else {
          fresh = buildCostRow(kind, {
            role: inputValue(tr, '.role-inp'),
            vendor: inputValue(tr, '.vendor-inp'),
            item: inputValue(tr, '.item-inp'),
            days: inputValue(tr, '.days-inp'),
            cost: inputValue(tr, '.cost-inp'),
          });
        }
        if (tr.dataset.prevSnap) fresh.dataset.prevSnap = tr.dataset.prevSnap;
        if (tr.dataset.lastOnly) fresh.dataset.lastOnly = tr.dataset.lastOnly;
        groupBody(to, kind).appendChild(fresh);
        n += 1;
      });
    });
    return n;
  }

  // ── Gear rentals (B2-7, D82–D84) ─────────────────────────────────────────
  /* One rental per vendor on this estimate's equipment lines (trimmed,
     case-insensitive): when that vendor's hire goes out and comes back, and
     how. Logistics only: the hire is billed on its lines' days × cost (D83),
     and a rental never reaches a client (D82).

     The lines are the truth, and syncRentals() — run by every recalc — makes
     the rentals follow them:
       - a vendor new to the estimate gets a rental, with no dates yet;
       - renaming the vendor on its only line renames its rental, dates and
         all, even through a moment of being blank while it's retyped (the
         line carries it);
       - a line given a vendor that already has a rental joins it;
       - a rental left with no lines goes (the brief's B2 Key Interactions 1).
     The server drops a rental with no lines too (rentals.js rentalsWithGear). */
  const vendorKey = (v) => String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  // { id, key, vendor, outDate, outMethod, backDate, backMethod, note, carrier }: key null while carried.
  let rentals = [];
  let rentalsReady = false; // not until restoreRows has put every line back
  let rentalsEl = null;
  const rentalRows = new Map(); // rental id → its row in the panel
  let lineVendors = new WeakMap(); // equipment row → its Vendor text at the last sync

  function newRentalId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
      return 'rn' + crypto.randomUUID().replace(/-/g, '');
    }
    return 'rn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  const vendorOf = (tr) => inputValue(tr, '.vendor-inp').trim();

  function syncRentals() {
    if (!rentalsReady) return;
    const lines = rowsIn('equip');
    const count = new Map(); // vendor key → its lines
    lines.forEach((tr) => {
      const k = vendorKey(vendorOf(tr));
      if (k) count.set(k, (count.get(k) || 0) + 1);
    });
    const byKey = new Map(rentals.filter((r) => r.key).map((r) => [r.key, r]));

    lines.forEach((tr) => {
      const text = vendorOf(tr);
      const was = lineVendors.has(tr) ? lineVendors.get(tr) : text; // a new line has changed nothing
      lineVendors.set(tr, text);
      if (was === text) return;
      const k = vendorKey(text);
      const before = vendorKey(was);
      if (k === before) {
        // Re-spelt ("lensworks" → "Lensworks"): on its only line, the rental takes the spelling.
        if (k && count.get(k) === 1 && byKey.has(k)) byKey.get(k).vendor = text;
        return;
      }
      // The rental this line takes with it: the one it's carrying, or its old vendor's if no line still has that.
      let mine = rentals.find((r) => r.carrier === tr) || null;
      if (!mine && before && !count.has(before)) mine = byKey.get(before) || null;
      if (!mine) return;
      byKey.delete(before);
      if (!k) {
        mine.key = null;
        mine.carrier = tr;
      } else if (byKey.has(k)) {
        mine.key = null; // it joins that vendor's rental; this one goes below
        mine.carrier = null;
      } else {
        Object.assign(mine, { key: k, vendor: text, carrier: null });
        byKey.set(k, mine);
      }
    });

    count.forEach((n, k) => {
      if (byKey.has(k)) return;
      const tr = lines.find((t) => vendorKey(vendorOf(t)) === k);
      const r = { id: newRentalId(), key: k, vendor: vendorOf(tr), outDate: null, outMethod: null,
        backDate: null, backMethod: null, note: '', carrier: null };
      rentals.push(r);
      byKey.set(k, r);
    });
    rentals = rentals.filter((r) => (r.key ? count.has(r.key) : Boolean(r.carrier) && lines.indexOf(r.carrier) !== -1));
  }

  /* Vendor suggestions for an equipment line: this estimate's other vendors
     matching what's typed, those starting with it first. */
  function vendorsLike(query) {
    const q = vendorKey(query);
    return rentals
      .filter((r) => r.key && r.key !== q && r.key.indexOf(q) !== -1)
      .sort((a, b) => (b.key.indexOf(q) === 0) - (a.key.indexOf(q) === 0))
      .map((r) => ({ vendor: r.vendor, items: rowsIn('equip').filter((tr) => vendorKey(vendorOf(tr)) === r.key).length }));
  }

  const shownRentals = () => rentals.filter((r) => r.key);

  /* The rentals as the estimate routes take them, in the panel's order. */
  function rentalsPayload() {
    return shownRentals().map((r) => ({
      id: r.id,
      vendor: r.vendor,
      outDate: r.outDate || null,
      outMethod: r.outMethod || null,
      backDate: r.backDate || null,
      backMethod: r.backMethod || null,
      note: (r.note || '').trim(),
    }));
  }

  function rentalsPanel() {
    if (rentalsEl) return rentalsEl;
    rentalsEl = document.createElement('section');
    rentalsEl.className = 'rentals';
    rentalsEl.setAttribute('aria-labelledby', 'rentals-h');
    rentalsEl.innerHTML =
      '<h3 class="rentals-h" id="rentals-h">Gear rentals</h3>' +
      '<p class="rentals-empty"></p>' +
      '<ul class="rentals-list"></ul>';
    rentalsEl.addEventListener('input', onRentalInput);
    rentalsEl.addEventListener('change', onRentalInput);
    return rentalsEl;
  }

  function rentalRowMarkup(r) {
    const k = 'rn-' + r.id;
    const opt = (v, t) => '<option value="' + v + '">' + t + '</option>';
    return (
      '<div class="rental-who"><span class="rental-vendor" id="' + k + '-v"></span>' +
      '<span class="rental-items"></span></div>' +
      '<div class="rental-f"><label for="' + k + '-out">Out</label><div class="rental-pair">' +
      '<input type="date" class="text-inp" id="' + k + '-out" data-r="outDate" aria-describedby="' + k + '-v">' +
      '<select class="svc-select" data-r="outMethod" aria-label="How it goes out">' +
      opt('', '—') + opt('pickup', 'Pickup') + opt('postage', 'Postage') + '</select></div></div>' +
      '<div class="rental-f"><label for="' + k + '-back">Back</label><div class="rental-pair">' +
      '<input type="date" class="text-inp" id="' + k + '-back" data-r="backDate" aria-describedby="' + k + '-v ' + k + '-err">' +
      '<select class="svc-select" data-r="backMethod" aria-label="How it comes back">' +
      opt('', '—') + opt('return', 'Return') + opt('postage', 'Postage') + '</select></div></div>' +
      '<div class="rental-f rental-note-f"><label for="' + k + '-note">Note</label>' +
      '<input type="text" class="text-inp" id="' + k + '-note" data-r="note" maxlength="500" ' +
      'placeholder="Booking ref, tracking no." aria-describedby="' + k + '-v"></div>' +
      '<p class="rental-err" id="' + k + '-err" hidden>Back is before Out.</p>'
    );
  }

  function buildRentalRow(r) {
    const li = document.createElement('li');
    li.className = 'rental-row';
    li.dataset.rental = r.id;
    li.setAttribute('role', 'group');
    li.setAttribute('aria-labelledby', 'rn-' + r.id + '-v');
    li.innerHTML = rentalRowMarkup(r);
    li.querySelector('[data-r="outDate"]').value = r.outDate || '';
    li.querySelector('[data-r="outMethod"]').value = r.outMethod || '';
    li.querySelector('[data-r="backDate"]').value = r.backDate || '';
    li.querySelector('[data-r="backMethod"]').value = r.backMethod || '';
    li.querySelector('[data-r="note"]').value = r.note || '';
    rentalRows.set(r.id, li);
    return li;
  }

  function onRentalInput(e) {
    const field = e.target.closest('[data-r]');
    const li = field && field.closest('[data-rental]');
    const r = li && rentals.find((x) => x.id === li.dataset.rental);
    if (!r) return;
    r[field.dataset.r] = field.dataset.r === 'note' ? field.value : field.value || null;
    paintRentals();
  }

  // 'YYYY-MM-DD' compares as text, as the server's check does.
  const reversed = (r) => Boolean(r.outDate && r.backDate && r.backDate < r.outDate);

  /* The panel, and each line's "Add pickup and return dates ↓". Rows are kept
     and moved, never rebuilt, so a date being typed survives a repaint. */
  function paintRentals() {
    if (!rentalsEl) return;
    const lines = rowsIn('equip');
    const shown = shownRentals();
    const empty = rentalsEl.querySelector('.rentals-empty');
    empty.textContent = lines.length
      ? 'Give a hire item its vendor to plan when its gear goes out and comes back.'
      : 'Gear you hire shows here, grouped by vendor.';
    empty.hidden = shown.length > 0;
    rentalRows.forEach((li, id) => {
      if (shown.some((r) => r.id === id)) return;
      li.remove();
      rentalRows.delete(id);
    });
    const list = rentalsEl.querySelector('.rentals-list');
    shown.forEach((r, i) => {
      const li = rentalRows.get(r.id) || buildRentalRow(r);
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
      li.querySelector('.rental-vendor').textContent = r.vendor;
      const names = lines.filter((tr) => vendorKey(vendorOf(tr)) === r.key)
        .map((tr) => inputValue(tr, '.item-inp').trim() || 'An item with no name yet');
      const sig = r.vendor + '\n' + names.join('\n');
      if (li.dataset.items !== sig) {
        li.dataset.items = sig;
        li.querySelector('.rental-items').innerHTML = plural(names.length, 'item', 'items') +
          LSCInfo.markup({
            id: 'rental-items-' + r.id,
            label: 'The items from ' + r.vendor,
            title: r.vendor,
            paragraphs: names.map(esc),
          });
      }
      const bad = reversed(r);
      li.querySelector('.rental-err').hidden = !bad;
      li.querySelector('[data-r="backDate"]').setAttribute('aria-invalid', String(bad));
    });
    lines.forEach((tr) => {
      const k = vendorKey(vendorOf(tr));
      const r = k ? shown.find((x) => x.key === k) : null;
      tr.querySelector('.rental-hint').hidden = !(r && !r.outDate && !r.backDate);
    });
  }

  /* From a line's hint: its rental's Out date. */
  function focusRental(key) {
    const r = shownRentals().find((x) => x.key === key);
    const li = r && rentalRows.get(r.id);
    if (!li) return;
    const out = li.querySelector('[data-r="outDate"]');
    out.scrollIntoView({ block: 'nearest' });
    out.focus({ preventScroll: true });
  }

  /* The collapsed head's extras (the IA's B2 Content Hierarchy 3). */
  function bookingHeadNotes() {
    const notes = [];
    const n = shownRentals().length;
    if (n) notes.push(plural(n, 'rental', 'rentals'));
    const off = dayPanels.get(OFF_DAY);
    const loose = off ? off.querySelectorAll('[data-rid]').length : 0;
    if (loose) notes.push(plural(loose, 'off-day line', 'off-day lines'));
    return notes;
  }

  /* "Booked 12 hrs, items cover 8" (D26): the day's booked hours, from its
     times, when they're longer than its items' hours. Never a price. */
  const { bookedHours, hrsText } = LSCRows;

  /* Everything about the cards that isn't a line's price: each card's total,
     which groups show, its labels and hours hint, and dropped days' items.
     The labels are only rewritten when the days themselves change. `perDay`
     is recalc's { card key → { total, hours } }: `total` is everything on the
     card (B2-4), `hours` its production lines' only (D26). */
  function paintDays(perDay) {
    // Mid-mount (restoreRows runs before the booking block exists): nothing to paint yet.
    if (!booking) return;
    const days = booking.list();
    const live = new Set(days.map((d) => d.id));
    Array.from(dayPanels.keys()).forEach((id) => {
      if (id !== OFF_DAY && !live.has(id)) dayPanels.delete(id);
    });
    if (menu.target && menu.target !== OFF_DAY && !live.has(menu.target)) closeMenu(false); // its day went

    const sig = days.map((d) => d.id + '|' + d.title + '|' + d.status).join('\n');
    if (sig !== daysSig) {
      daysSig = sig;
      days.forEach((d) => {
        const panel = dayPanels.get(d.id);
        if (!panel) return;
        panel.querySelector('.day-menu-btn').setAttribute('aria-label', 'Add Production Service Items to ' + d.title);
      });
      if (menu.target) paintMenuTitle();
    }

    dayPanels.forEach((panel, id) => {
      const p = perDay.get(id) || { total: 0, hours: 0 };
      panel.querySelector('.day-items-total').textContent = fmt(p.total);
      // Each group shows only with lines, and the card says so when it has none.
      let any = false;
      panel.querySelectorAll('.day-group').forEach((g) => {
        const has = Boolean(g.querySelector('[data-rid]'));
        g.hidden = !has;
        any = any || has;
      });
      panel.querySelector('.day-items-empty').hidden = any;
    });
    days.forEach((d) => {
      const panel = dayPanels.get(d.id);
      if (!panel) return;
      const p = perDay.get(d.id) || { total: 0, hours: 0 };
      const booked = bookedHours(d);
      const hint = panel.querySelector('.day-hours');
      const long = booked > 0 && booked - p.hours > 1e-9;
      hint.hidden = !long;
      hint.textContent = long ? 'Booked ' + hrsText(booked) + ', items cover ' + hrsText(p.hours).replace(/ hrs?$/, '') + '.' : '';
    });
  }

  /* "incl. weekend ×1.5" under a surcharged line's price: the rows of
     calc.js surchargeAttribution, in its order, with the hours a partial
     share covered. Empty when nothing applied. */
  // Shared with the estimate detail, so both screens word a surcharge alike.
  const surNote = LSCRows.surchargeNote;

  /* ── "On set, by day" (B2-6, D78, D98) ─────────────────────────────────
     Production, Travel, External Crew & Contracts and Equipment Hire, read
     only: every one of their lines is added and edited on a day card (the
     brief's B2 principle 1), so down here each is one builder's summary of
     the cards. A group per card that has lines of its kind, in card order
     (dated days, Date TBC days, then Not on a day), each with its lines, its
     total and a way back to the card; then the subtotal, in the head. The
     figures are the ones recalc() just painted on the cards, so the two
     can't disagree. "Add to a day ▾" opens a card's service menu at this
     category. */
  const ON_SET = [
    ['prod', null, 'On set'], // labelled with the Rate Card's own name for the section
    ['travel', 'Travel &amp; Accommodation', 'Expenses'],
    ['crew', 'External Crew &amp; Contracts', 'Expenses'],
    ['equip', 'Equipment Hire', 'Expenses'],
  ];
  const ON_SET_MENU = { prod: 'Production', travel: 'Travel', crew: 'External Crew', equip: 'Equipment Hire' };

  function onSetSummaryMarkup(kind, label, tag) {
    return (
      '<div class="billing-block onset-block" id="block-' + kind + '" data-onset="' + kind + '">' +
      '<div class="bb-head"><div><h3 class="bb-label" id="onset-h-' + kind + '">' + label + '</h3>' +
      '<span class="bb-label-tag">' + tag + '</span></div>' +
      '<div class="onset-head-r">' +
      '<button type="button" class="btn btn-ghost btn-sm onset-add" aria-haspopup="menu" aria-expanded="false">' +
      'Add to a day<span class="sr-only">, ' + esc(ON_SET_MENU[kind]) + '</span> <span aria-hidden="true">▾</span></button>' +
      '<span class="bb-sum">Subtotal <b id="sum-' + kind + '">$0.00</b></span></div></div>' +
      '<div class="onset-body" id="onset-' + kind + '"><p class="onset-empty">Nothing on set yet.</p></div>' +
      '</div>'
    );
  }

  function onSetMarkup() {
    const prod = prodSection();
    return (
      '<h2 class="onset-divider">On set, by day</h2>' +
      ON_SET.filter(([kind]) => kind !== 'prod' || prod)
        .map(([kind, label, tag]) => onSetSummaryMarkup(kind, label || esc(prod.label), tag)).join('')
    );
  }

  /* One summary line: what the card's row says, as text. `amount` null is a
     line with no price (its service left the card), shown as "—". */
  function onSetLine(name, qty, amount, note, muted) {
    return (
      '<li class="onset-line"><span class="onset-name' + (muted ? ' is-muted' : '') + '">' + esc(name) +
      (note ? '<span class="onset-note">' + esc(note) + '</span>' : '') + '</span>' +
      '<span class="onset-qty">' + esc(qty) + '</span>' +
      '<span class="onset-amt">' + (amount === null ? '—' : fmt(amount)) + '</span></li>'
    );
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  /* `onSet` is recalc's { kind → Map(card key → { html, total }) }. */
  function paintOnSet(onSet) {
    if (!booking) return; // mid-mount, as paintDays
    const days = booking.list();
    const order = days.map((d) => d.id).concat([OFF_DAY]);
    const byId = new Map(days.map((d) => [d.id, d]));
    Object.keys(onSet).forEach((kind) => {
      const body = $('onset-' + kind);
      if (!body) return;
      const cards = onSet[kind];
      const html = order.filter((key) => cards.has(key)).map((key) => {
        const g = cards.get(key);
        const d = byId.get(key);
        const title = d ? d.title : 'Not on a day';
        return (
          '<div class="onset-group" role="group" aria-label="' + esc(title) + '">' +
          '<div class="onset-ghead"><span class="onset-gtitle">' + esc(title) + '</span>' +
          (d ? LSCCalendar.statusChip(d.status) : '') +
          '<button type="button" class="onset-edit" data-key="' + esc(key) + '">' +
          (d ? 'Edit on the day' : 'Edit') + '<span class="sr-only">, ' + esc(title) + '</span> <span aria-hidden="true">↑</span></button>' +
          '<b class="onset-gtotal">' + fmt(g.total) + '</b></div>' +
          '<ul class="onset-lines">' + g.html + '</ul></div>'
        );
      }).join('') || '<p class="onset-empty">Nothing on set yet.</p>';
      if (body.innerHTML !== html) body.innerHTML = html;
      body.closest('.onset-block').classList.toggle('is-empty', cards.size === 0);
    });
  }

  /* "Edit on the day ↑": the card, in view and focused, with its group of
     this kind brought into view when the card is taller than the screen. */
  function editOnDay(key, kind) {
    if (!booking) return;
    const card = key === OFF_DAY ? booking.showOff() : booking.showDay(key);
    if (!card) return;
    const group = card.querySelector('.day-group[data-group="' + kind + '"]');
    if (group && !group.hidden) group.scrollIntoView({ block: 'nearest' });
    const box = card.querySelector('.day-card-in');
    box.setAttribute('tabindex', '-1');
    box.focus({ preventScroll: true });
  }

  /* "Add to a day ▾" → a card (or a new Date TBC day) → its service menu,
     opened at this summary's category. */
  function openDayMenuAt(key, kind) {
    if (!booking) return;
    if (key === NEW_TBC) key = booking.addTbc();
    if (key === OFF_DAY) booking.showOff();
    else booking.showDay(key);
    openMenu(key, panelFor(key).querySelector('.day-menu-btn'), kind);
  }

  function openAddPop(opener, kind) {
    const keys = (booking ? booking.list() : []).map((d) => d.id).concat([OFF_DAY]);
    openCardPop(opener, opener, 'Add ' + ON_SET_MENU[kind] + ' to',
      keys.map((k) => ({ key: k, text: cardName(k) })).concat([{ key: NEW_TBC, text: 'A new Date TBC day' }]),
      (key) => openDayMenuAt(key, kind), '');
  }

  /* The headline block (D86): what the client is buying, above when it's shot
     (D98). Tinted and heavier than the service sections — estimates.css. */
  function deliverablesSectionMarkup() {
    return (
      '<div class="billing-block deliv-block" id="block-deliverables">' +
      '<div class="bb-head"><div><h2 class="bb-label">Deliverables</h2>' +
      '<span class="bb-label-tag">PROJECT OUTPUT</span></div>' +
      '<button type="button" class="btn btn-accent btn-sm" id="add-deliverables">+ Add Deliverable</button></div>' +
      '<div class="gt-head deliv-grid deliv-typed"><div>Type</div><div>Name</div><div>Format</div>' +
      '<div>Length</div><div class="right">Qty</div><div class="right">Post hrs (rec.)</div><div></div></div>' +
      bodyMarkup('deliverables', 'No deliverables added yet — click “+ Add Deliverable” above.') +
      '</div>'
    );
  }

  /* The corrected money model (BILLING_APP_PLAN.md §1.2). The old bar read
     Hours / Labour / Expenses / Net Invoice / Internal Tax, with Gross Profit
     below it; "Net Invoice" was pre-GST and "Gross Profit" counted pass-through
     as margin. Same two-bar shape, honest labels. */
  /* The app's existing switch idiom — a <label> wrapping a checkbox and a
     <span>, exactly as .doc-gst-free and settings' .set-check do it. The brief
     asks for "an inline switch"; building a new sliding-pill control for it
     would be the one place in the app that has one. */
  function overheadToggleMarkup() {
    return (
      '<div class="mjp-toggle-row">' +
      '<label class="mjp-toggle" for="f-include-overhead">' +
      '<input type="checkbox" id="f-include-overhead" checked ' +
      'aria-describedby="mjp-toggle-hint">' +
      '<span>Include Overhead &amp; Markup in Calculation</span></label>' +
      '<span class="mjp-toggle-hint" id="mjp-toggle-hint">Advisory only — it never changes what ' +
      'the client is billed.</span></div>'
    );
  }

  /* Hidden rather than rebuilt when the toggle is off. The brief asks for the
     line to be "removed entirely", and [hidden] takes it out of the
     accessibility tree as well as off the screen — which an opacity or a
     visibility rule would not. estimates.css carries the [hidden] display rule
     it needs, because a display:flex on the class would otherwise beat the
     browser's own [hidden] default. */
  /* The figure and its (?) are wrapped together rather than sitting as two more
     children of .mjp-line, because the row's 12px column gap is the spacing
     between label, figure and note — and the trigger belongs to the figure, not
     beside it at the same distance. The wrapper carries its own 8px instead.

     The trigger starts hidden and paintMinimum() reveals it only for a real
     floor: there is no breakdown to show of a figure that could not be
     computed, and a (?) that opens a modal of em dashes is worse than no (?).
     Per the IA doc's flow, the unset state stays a plain sentence. */
  function minimumLineMarkup() {
    return (
      '<div class="mjp-line" id="mjp-line">' +
      '<span class="mjp-line-label">Minimum Job Price</span>' +
      '<span class="mjp-line-fig">' +
      '<span class="mjp-line-value" id="s-min-price">—</span>' +
      '<button type="button" class="mjp-help" id="mjp-help" hidden ' +
      'aria-haspopup="dialog" aria-label="How the Minimum Job Price is calculated">' +
      '<span aria-hidden="true">?</span></button>' +
      '</span>' +
      '<span class="mjp-line-note" id="s-min-note"></span>' +
      '</div>' +
      '<div class="mjp-line mjp-income" id="mjp-income" hidden></div>'
    );
  }

  /* "Surcharges +$X ⓘ" (brief, Key Interactions 2.6): owner-only, and not a
     headline figure — it is already inside the Labour Subtotal — so it takes
     the advisory line's shape rather than a .sum-item. Shown only when a
     surcharge applies; not under the overhead switch, which governs the two
     advisory floors, not this. The ⓘ's first paragraph is the estimate's own
     settings, filled by paintSurcharges(). */
  function surchargeLineMarkup() {
    return (
      '<div class="mjp-line sur-line" id="sur-line" hidden>' +
      '<span class="mjp-line-label">Surcharges</span>' +
      '<span class="mjp-line-fig"><span class="mjp-line-value" id="s-surcharges">+$0.00</span>' +
      LSCInfo.markup({
        id: 'surcharges',
        label: 'How the surcharges are worked out',
        title: 'Surcharges',
        paragraphs: [
          '<span id="sur-info-rules"></span>',
          'Each production line on a day is multiplied, then rounded up to the whole dollar. After hours counts ' +
            'only the share of a day’s booked hours outside office hours.',
          'A surcharge is income for the same work: it adds no hours, so the Minimum Job Price and the Income ' +
            'floor don’t move. The client sees only each line’s price, never the word “surcharge”.',
          'These settings are kept from when this estimate was first priced. <strong>Update to current ' +
            'rates</strong> takes today’s Rate Card and public holidays.',
        ],
      }) +
      '</span>' +
      '<span class="mjp-line-note">already in the Labour Subtotal, folded into each production line’s price</span>' +
      '</div>'
    );
  }

  function summaryMarkup() {
    return (
      overheadToggleMarkup() +
      '<div class="summary-bar">' +
      '<div class="sum-item"><div class="sum-label">Total Hours</div><div class="sum-value" id="s-hours">0</div></div>' +
      '<div class="sum-item"><div class="sum-label">Labour Subtotal</div><div class="sum-value" id="s-labour">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Expenses Subtotal</div><div class="sum-value" id="s-expenses">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Client Price (ex GST)</div><div class="sum-value" id="s-client-price">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">GST</div><div class="sum-value" id="s-gst" style="font-size:15px">$0.00</div></div>' +
      '</div>' +
      '<div class="summary-bar" style="margin-bottom:24px">' +
      /* The two-column spans are a class, not the inline style they used to be:
         the mobile band stacks this bar into one column, and an inline
         grid-column would have needed !important to undo — which would then be
         undoable by nothing. Identical at every other width. */
      '<div class="sum-item sum-span2" style="background:rgba(184,84,68,0.08);border:1px solid rgba(184,84,68,0.3)">' +
      '<div class="sum-label sum-label-strong">Total (inc GST)</div>' +
      '<div class="sum-value accent" id="s-total">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Tax Set-Aside</div>' +
      '<div class="sum-value" id="s-tax" style="font-size:15px">$0.00</div></div>' +
      '<div class="sum-item sum-span2">' +
      '<div class="sum-label">Est. Take-Home <span class="sum-label-note">(income ex GST, less the overhead its hours carry and the tax set-aside — pass-through excluded)</span></div>' +
      '<div class="sum-value" id="s-takehome" style="color:var(--ok)">$0.00</div></div>' +
      '</div>' +
      surchargeLineMarkup() +
      /* Under the bars, not inside them: a sixth .sum-item would read as one
         more headline figure, and this one is explicitly not that. */
      minimumLineMarkup()
    );
  }

  /* Where this estimate's prices come from. The update button is always
     there; the last-project toggle appears once the estimate is linked to a
     client whose earlier estimate recorded its prices. */
  function ratesBarMarkup() {
    return (
      '<div class="rates-bar" id="rates-bar">' +
      '<span class="rates-bar-label">Prices</span>' +
      '<span class="rates-bar-note" id="rates-note">Each line keeps the price it was added at.</span>' +
      '<label class="doc-gst-free rates-last" id="rates-last-wrap" hidden>' +
      '<input type="checkbox" id="f-rates-last"><span id="rates-last-label">Use rates from last project</span></label>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="js-rates-current">Update to current rates</button>' +
      '</div>'
    );
  }

  function formMarkup(estimate, pricing) {
    const client = (estimate && estimate.client) || {};
    const isInvoice = estimate && estimate.docType === 'invoice';

    let html =
      '<button class="back-btn" id="js-back">← Back</button>' +
      '<div class="page-head"><div><h1 class="page-title">' +
      (estimate ? 'Edit Estimate' : 'New Estimate') + '</h1>' +
      '<div class="page-sub">Select services from each category to build your estimate</div></div></div>' +
      '<div class="form-grid">' +
      '<div class="field full"><label for="f-upid" class="label-accent">UPID — Unique Project Identifier *</label>' +
      '<input id="f-upid" type="text" value="' + esc(estimate ? estimate.upid : '') + '"></div>' +
      '<div class="field"><label for="f-name">Project Name *</label>' +
      '<input id="f-name" type="text" value="' + esc(estimate ? estimate.name : '') + '"></div>' +
      '<div class="field"><label for="f-date">Date</label>' +
      '<input id="f-date" type="date" value="' + esc(estimate ? estimate.date : today()) + '"></div>' +
      '<div class="field client-field"><label for="f-business">Business Name</label>' +
      '<input id="f-business" type="text" value="' + esc(client.businessName || '') + '">' +
      '<div class="client-link-status">' +
      '<span id="client-linked" hidden>From your client list</span>' +
      '<label class="client-save-toggle" id="client-save-wrap" hidden>' +
      '<input type="checkbox" id="f-saveclient" checked><span>Save to client list</span></label>' +
      '</div></div>' +
      '<div class="field"><label for="f-contact">Client Name</label>' +
      '<input id="f-contact" type="text" value="' + esc(client.contactName || '') + '"></div>' +
      '<div class="field"><label for="f-email">Client Email</label>' +
      '<input id="f-email" type="email" value="' + esc(client.email || '') + '"></div>' +
      '<div class="field"><label for="f-phone">Client Phone</label>' +
      '<input id="f-phone" type="tel" value="' + esc(client.phone || '') + '"></div>' +
      '<div class="field"><label for="f-abn">Client ABN</label>' +
      '<input id="f-abn" type="text" inputmode="numeric" value="' + esc(abnFormat(client.abn)) + '"></div>' +
      '<div class="field"><label for="f-address">Client Address</label>' +
      '<input id="f-address" type="text" value="' + esc(client.address || '') + '"></div>' +
      '<div class="field full"><label for="f-notes">Internal Notes</label>' +
      '<textarea id="f-notes">' + esc(estimate ? estimate.notes : '') + '</textarea></div>' +
      '</div>' +
      '<div class="doc-type-bar">' +
      '<label class="doc-type-label" for="f-doctype">Document Type</label>' +
      '<select class="doc-type-select" id="f-doctype">' +
      '<option value="estimate"' + (isInvoice ? '' : ' selected') + '>Estimate</option>' +
      '<option value="invoice"' + (isInvoice ? ' selected' : '') + '>Invoice</option>' +
      '</select>' +
      '<div class="inv-num-wrap' + (isInvoice ? ' show' : '') + '" id="inv-num-wrap">' +
      '<label for="f-invnum" class="label-accent" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em">Invoice #</label>' +
      '<input class="inv-num-inp" id="f-invnum" type="text" placeholder="e.g. INV-001" value="' +
      esc((estimate && estimate.invoiceNumber) || '') + '">' +
      '</div>' +
      /* Short notice (D19): a tick the owner decides; the hint only suggests it
         when the first booked date is close. Multiplies production lines only. */
      '<div class="sn-group">' +
      '<label class="sn-check"><input type="checkbox" id="f-shortnotice" aria-describedby="sn-hint"' +
      (estimate && estimate.shortNotice ? ' checked' : '') + '><span>Short notice</span></label>' +
      '<span class="sn-hint" id="sn-hint"></span></div>' +
      /* Only offered when the business is registered — for an unregistered one
         GST never applies, so the toggle would be a control that does nothing.
         An estimate's stored flag is preserved rather than cleared when it isn't
         rendered; see payload(). */
      (gstRegistered()
        ? '<label class="doc-gst-free" title="No GST on this job — the rate card is what the client pays">' +
          '<input type="checkbox" id="f-gstfree"' +
          (estimate && estimate.gstFree ? ' checked' : '') + '><span>GST-free job</span></label>'
        : '') +
      '</div>' +
      /* D98: what you edit first. The Prices bar governs every line below it,
         so it heads them; then what's being made (Deliverables); then when
         it's shot (the booking block). */
      ratesBarMarkup() +
      deliverablesSectionMarkup() +
      // The Production Booking block (production-booking task 6), filled by BookingBlock.mount.
      '<div id="booking-slot"></div>' +
      // Where a line's unit switch is announced (switchUnit).
      '<p class="sr-only" id="editor-live" aria-live="polite"></p>' +
      // Where a day's surcharge changing is announced (announceSurcharges).
      '<p class="sr-only" id="sur-live" aria-live="polite"></p>';

    /* D98: the editable sections in the Rate Card's order (Pre-Production,
       Post-Production, Additional work), then the read-only "On set, by
       day". An archived production section has no day cards to summarise,
       so it stays an ordinary section among them. */
    sections.forEach((section) => {
      if (section.id !== 'prod' || section.archived) html += labourSectionMarkup(section);
    });
    html += onSetMarkup();

    html += summaryMarkup();

    html +=
      '<div id="editor-error" role="alert"></div>' +
      '<div class="form-actions">' +
      (estimate ? '<button type="button" class="btn btn-danger btn-sm" id="js-delete" data-write>Delete</button>' : '') +
      '<button type="button" class="btn btn-ghost" id="js-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-accent" id="js-save" data-write>' +
      '<span class="spinner" id="save-spin"></span><span id="save-label">Save Estimate</span></button>' +
      '</div>';

    return html;
  }

  // ── Reading the form back ─────────────────────────────────────────────────

  /* Production rows sit in several bodies — each day card's, in date order,
     then Not on a day's — so they are every Production row in the form, in
     page order. A removed day's rows have left the page with its card. The
     "On set, by day" summaries hold no rows, only text. */
  function rowsIn(id) {
    if (id === 'prod') return Array.from(root.querySelectorAll('.gt-row[data-rid][data-section="prod"]'));
    // Since B2-4 travel, crew and gear live in the day cards too, in the same page order.
    if (id === 'travel' || id === 'crew' || id === 'equip') {
      return Array.from(root.querySelectorAll('.gt-row[data-rid][data-kind="' + id + '"]'));
    }
    const body = $('tbody-' + id);
    return body ? Array.from(body.querySelectorAll('[data-rid]')) : [];
  }

  function inputValue(tr, selector) {
    const input = tr.querySelector(selector);
    return input ? input.value : '';
  }

  function collect() {
    const activeRows = { travel: [], equip: [], crew: [], deliverables: [] };

    sections.forEach((section) => {
      activeRows[section.id] = rowsIn(section.id).map((tr) => lineFrom(tr, true));
    });

    activeRows.travel = rowsIn('travel').map((tr) => lineFrom(tr, false));

    /* Crew and gear on a day carry its id (B2-4), as travel's does through
       lineFrom; a line on no day carries none, so an old one saves as it was. */
    const onDay = (tr, line) => {
      const dayId = rowDayId(tr);
      if (dayId) line.dayId = dayId;
      return line;
    };
    activeRows.crew = rowsIn('crew').map((tr) => onDay(tr, {
      role: inputValue(tr, '.role-inp'),
      days: num(inputValue(tr, '.days-inp')),
      cost: num(inputValue(tr, '.cost-inp')),
    }));

    activeRows.equip = rowsIn('equip').map((tr) => onDay(tr, {
      vendor: vendorOf(tr),
      item: inputValue(tr, '.item-inp').trim(),
      days: num(inputValue(tr, '.days-inp')),
      cost: num(inputValue(tr, '.cost-inp')),
    }));

    activeRows.deliverables = rowsIn('deliverables').map((tr) => {
      const out = {
        id: tr.dataset.did,
        name: inputValue(tr, '.deliv-name-inp'),
        format: inputValue(tr, '.deliv-fmt-inp'),
        duration: inputValue(tr, '.deliv-dur-inp'),
        qty: num(inputValue(tr, '.deliv-qty-inp')) || 1,
      };
      // The type's snapshot (buildDeliverableRow); an untyped row carries none.
      if (tr.dataset.typeId) {
        out.typeId = tr.dataset.typeId;
        out.typeName = tr.dataset.typeName || '';
        out.multiplier = Number(tr.dataset.multiplier) || 0;
      }
      return out;
    });

    return activeRows;
  }

  // ── Live totals ───────────────────────────────────────────────────────────

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function paintRow(tr, bill) {
    const cell = tr.querySelector('.bill-cell');
    if (cell) cell.textContent = bill === null ? '—' : fmt(bill);
    return bill === null ? 0 : bill;
  }

  const shortNoticeNow = () => {
    const box = $('f-shortnotice');
    return box ? box.checked : !!(existing && existing.shortNotice);
  };

  /* The surcharge snapshot this estimate would be saved with, built the way
     routes/estimates.js prepareWrite builds it: the stored one kept (settings,
     and each unmoved day's kind) unless "Update to current rates" asked for
     today's; '{}' with no days. */
  function surchargesNow(days, pricing) {
    // Short notice reaches lines on no day too, so it pins settings with no days.
    if (!days.length && !shortNoticeNow()) return {};
    const prior = existing && !refreshSurcharges
      ? { surcharges: existing.surcharges || {}, days: existing.days || [] }
      : null;
    return LSCCalc.surchargeSnapshot(days, pricing, holidays || [], prior);
  }

  /* Fetched the first time a day has a date: a new or moved day's
     weekend/holiday kind needs it, and nothing else does. Until it arrives (or
     if it can't), dates price against no holidays; the server prices on save
     with the real list either way. */
  function loadHolidays() {
    if (holidays) return Promise.resolve();
    /* One request at a time, shared: save() awaits the same one a recalc
       started, rather than reading "not loaded" while it is on its way. */
    if (!holidaysLoading) {
      holidaysLoading = (async () => {
        try {
          const reply = await LSCApi.get('/api/holidays');
          holidays = reply.holidays || [];
        } catch (err) {
          if (err instanceof LSCApi.ApiError && err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
          return; // asked again at the next change
        } finally {
          holidaysLoading = null;
        }
        if (onScreen()) recalc();
      })();
    }
    return holidaysLoading;
  }

  function recalc() {
    const pricing = LSCData.pricing();

    // Read first: the Production rows' prices depend on their days.
    const active = collect();
    const days = booking ? booking.payloadDays() : [];
    if (days.some((d) => d.date) && !holidays) loadHolidays();
    const surcharges = surchargesNow(days, pricing);
    const shortNotice = shortNoticeNow();
    const options = {
      gstFree: gstFreeNow(),
      // The job's overhead share comes off before tax is set aside.
      overheadRate,
      days,
      surcharges,
      shortNotice,
    };
    /* Each Production line at the price the server will stamp on it: its
       surchargedPrice when it is on a day, its base otherwise. Index i of
       active.prod is rowsIn('prod')[i], since collect() read it from there. */
    const stamped = LSCCalc.stampSurchargedPrices({ prod: active.prod || [] }, pricing, options).prod;
    const dayById = new Map(days.map((d) => [d.id, Object.assign({}, d, {
      kind: (surcharges.days || {})[d.id],
      nextKind: (surcharges.nextDays || {})[d.id],
    })]));
    /* Per card (a day id, or OFF_DAY): `total` is everything on it, production
       at its surcharged price and the rest as billed (B2-4); `hours` is its
       production lines' only. And per kind, per card, the "On set, by day"
       summaries' lines and group totals (B2-6), from the same figures. */
    const perDay = new Map();
    const onSet = { prod: new Map(), travel: new Map(), crew: new Map(), equip: new Map() };
    const tally = (kind, dayId, amount, lineHtml) => {
      const key = dayId || OFF_DAY;
      const p = perDay.get(key) || { total: 0, hours: 0 };
      p.total += amount || 0;
      perDay.set(key, p);
      const g = onSet[kind].get(key) || { html: '', total: 0 };
      g.html += lineHtml;
      g.total += amount || 0;
      onSet[kind].set(key, g);
      return p;
    };

    sections.forEach((section) => {
      let subtotal = 0;
      rowsIn(section.id).forEach((tr, i) => {
        const line = lineFrom(tr, true);
        const def = labourDef(section, line, pricing);
        const base = labourBill(def, line);
        if (section.id !== 'prod') {
          subtotal += paintRow(tr, base);
          return;
        }
        const s = stamped[i] && stamped[i].surchargedPrice;
        const bill = base === null ? null : typeof s === 'number' ? s : base;
        subtotal += paintRow(tr, bill);
        const day = line.dayId ? dayById.get(line.dayId) : null;
        const note = tr.querySelector('.sur-note');
        if (note) {
          /* The line's own hours decide the stretch of its day it covers
             (calc.js coveredWindow). A line on no day can still carry short
             notice, which its note then names. */
          const hours = def ? num(line.qty) * LSCCalc.hoursPerUnitOf(def) : 0;
          const text = bill !== null && bill > base ? surNote(base, day, surcharges, shortNotice, hours) : '';
          note.textContent = text;
          note.hidden = !text;
        }
        /* An archived production section's lines are on no card (restoreRows):
           its own block lists them, so they are in no summary. */
        if (section.archived) return;
        const unit = LSCRows.labourUnit(def);
        const qty = num(line.qty);
        const p = tally('prod', day ? day.id : null, bill,
          onSetLine(line.name, def ? qty + ' ' + LSCRows.unitWord(unit.kind, qty) : String(qty),
            bill, note && !note.hidden ? note.textContent : ''));
        if (day) p.hours += def ? qty * LSCCalc.hoursPerUnitOf(def) : 0;
      });
      setText('sum-' + section.id, fmt(subtotal));
    });

    /* Travel, crew and gear are never surcharged, on a day or not (D3): each
       is billed as it always was, and counts toward its card's total. */
    let travelSubtotal = 0;
    rowsIn('travel').forEach((tr) => {
      const line = lineFrom(tr, false);
      const def = travelDef(line, pricing);
      const billed = travelBill(def, line);
      const bill = paintRow(tr, billed);
      travelSubtotal += bill;
      const qty = num(line.qty);
      // The car is by the km; a direct cost's quantity is its amount; the rest are counted.
      const qtyText = !def ? String(qty) : def.perKm ? qty + ' km' : def.directCost ? 'at cost' : '× ' + qty;
      tally('travel', line.dayId, bill, onSetLine(line.name, qtyText, billed, ''));
    });
    setText('sum-travel', fmt(travelSubtotal));

    ['crew', 'equip'].forEach((kind) => {
      let subtotal = 0;
      rowsIn(kind).forEach((tr) => {
        const line = {
          days: num(inputValue(tr, '.days-inp')),
          cost: num(inputValue(tr, '.cost-inp')),
        };
        const bill = paintRow(tr, costBill(line));
        subtotal += bill;
        // Gear reads as its Item, with its vendor under it (B2-7).
        const vendor = kind === 'equip' ? vendorOf(tr) : '';
        const name = kind === 'crew' ? inputValue(tr, '.role-inp').trim() : inputValue(tr, '.item-inp').trim() || vendor;
        tally(kind, rowDayId(tr), bill, onSetLine(
          name || (kind === 'crew' ? 'Crew member, no name yet' : 'Hire item, no name yet'),
          plural(line.days, 'day', 'days') + ' × ' + fmt(line.cost), bill, name !== vendor ? vendor : '', !name));
      });
      setText('sum-' + kind, fmt(subtotal));
    });
    paintDays(perDay);
    paintOnSet(onSet);
    syncRentals();
    paintRentals();
    if (booking) booking.refreshHead();
    paintShortNotice(days);

    // The headline figures, from the same code the server will run on save.
    const totals = LSCCalc.computeTotals(active, pricing, LSCData.settings(), options);
    paintSurcharges(totals, surcharges);
    announceSurcharges(dayById, surcharges, shortNotice);
    setText('s-hours', totals.totalHours);
    setText('s-labour', fmt(totals.labourTotal));
    setText('s-expenses', fmt(totals.expenseTotal));
    setText('s-client-price', fmt(totals.clientPriceExGst));
    setText('s-gst', fmt(totals.gst));
    setText('s-total', fmt(totals.totalIncGst));
    setText('s-tax', fmt(totals.taxSetAside));
    setText('s-takehome', fmt(totals.estTakeHome));

    // Reads the totals above rather than recomputing anything of its own.
    paintMinimum(totals, hoursWorking(LSCCalc.labourHoursBreakdown(active, pricing), totals));
  }

  /* The job's hours, in words, when they aren't just a sum of the quantities on
     screen — "2 full days of 8 hrs, plus 6 hrs of hourly work". Empty for a job
     of hourly rows only, whose "across 14 hours" a reader can already add up,
     so that note reads exactly as it did before day rows existed.

     The parts come from labourHoursBreakdown, which walks the rows the way
     computeTotals does, and a test pins its total to totalHours. The check here
     is belt and braces: if they ever disagreed, the note would be showing
     working for a number it isn't next to, so it says nothing instead. */
  function hoursWorking(b, totals) {
    if (!b.units.length || b.totalHours !== totals.totalHours) return '';
    const hrs = (n) => n + (n === 1 ? ' hr' : ' hrs');
    const parts = b.units.map(
      (u) => u.qty + ' ' + LSCRows.unitWord(u.dayUnit || 'unit', u.qty) + ' of ' + hrs(u.hoursPerUnit)
    );
    const days = parts.join(', ');
    return b.hourlyHours ? days + ', plus ' + hrs(b.hourlyHours) + ' of hourly work' : days;
  }

  /* The owner's "Surcharges +$X" line, from totals.surchargeTotal (calc.js),
     and the settings it was priced under for its ⓘ. */
  const MODE_WORDS = {
    higher: 'the higher of weekend and after hours applies, with short notice on top',
    multiply: 'they all multiply',
    highest: 'only the highest one applies',
  };
  function paintSurcharges(totals, surcharges) {
    const line = $('sur-line');
    if (!line) return;
    const amount = totals.surchargeTotal || 0;
    line.hidden = !(amount > 0);
    if (line.hidden) return;
    setText('s-surcharges', '+' + fmt(amount));
    const s = LSCCalc.surchargeSettings({ surcharges: surcharges.settings });
    setText(
      'sur-info-rules',
      'Priced under weekend & public holiday ×' + s.weekend + ', after hours ×' + s.afterHours + ' (outside ' +
        s.officeStart + '–' + s.officeEnd + ') and short notice ×' + s.shortNotice + ': ' + MODE_WORDS[s.mode] + '.'
    );
  }

  /* A surcharge recompute, announced once and politely (brief, Accessibility:
     "Saturday 4 October: weekend rate applied"). What a day carries is worded
     from calc.js surchargeAttribution on a nominal base, so it is the same
     whether or not the day has items yet; short notice is said once for the
     estimate, not once per day.

     Compared against what was last ANNOUNCED, not the last recalc, and only
     after a second's quiet: typing "19:00" passes through "1", "19" and
     "19:0", and only where it lands is read out — nothing at all if it lands
     back where it started. Several days changing at once are read together.
     Its own region, so it never cancels a message in #editor-live. The first
     recalc only records the state: opening an estimate says nothing. */
  let surAnnounced = null;
  let surLatest = null;
  let surTimer = null;

  function surchargeState(dayById, surcharges, shortNotice) {
    const card = { surcharges: surcharges.settings };
    const days = {};
    dayById.forEach((day, id) => {
      if (!day.date) return; // Date TBC: no day or time surcharge
      const att = LSCCalc.surchargeAttribution(100, day, card, false);
      const words = att.rows.map((r) => {
        const part = att.hours > 0 && (r.carry || r.share < 1 - 1e-9)
          ? ' on ' + LSCRows.hrsText(r.hours).replace(/ hrs?$/, '') + ' of ' + LSCRows.hrsText(att.hours)
          : '';
        return SUR_RATE_WORD[r.type] + ' ×' + r.multiplier + (r.carry ? ' after midnight' : '') + part;
      });
      days[id] = { date: day.date, words: words.join(' and ') };
    });
    const sn = LSCCalc.surchargeSettings(card).shortNotice;
    return { days, shortNotice: shortNotice && sn > 1 ? sn : 0 };
  }
  const SUR_RATE_WORD = { weekend: 'weekend rate', holiday: 'public holiday rate', afterHours: 'after hours' };

  function surchargeMessage(before, after) {
    const out = [];
    Object.keys(after.days).forEach((id) => {
      const now = after.days[id].words;
      const was = before.days[id] ? before.days[id].words : '';
      if (now === was) return;
      const when = LSCCalendar.longDate(after.days[id].date, today());
      out.push(when + ': ' + (now ? now + ' applied.' : 'no surcharge now.'));
    });
    if (after.shortNotice !== before.shortNotice) {
      out.push(after.shortNotice
        ? 'Short notice ×' + after.shortNotice + ' applied to the production items.'
        : 'Short notice removed.');
    }
    return out.join(' ');
  }

  function announceSurcharges(dayById, surcharges, shortNotice) {
    // Mid-mount, before the booking block exists, the days aren't known yet.
    if (!booking) return;
    surLatest = surchargeState(dayById, surcharges, shortNotice);
    if (!surAnnounced) {
      surAnnounced = surLatest;
      return;
    }
    clearTimeout(surTimer);
    surTimer = setTimeout(() => {
      const region = $('sur-live');
      if (!region || !region.isConnected) return;
      const text = surchargeMessage(surAnnounced, surLatest);
      surAnnounced = surLatest;
      if (text) region.textContent = text;
    }, 1000);
  }

  /* D19: when the first booked date from today on is within the Rate Card's
     threshold, suggest the tick. Never ticks it; says nothing once ticked. */
  function paintShortNotice(days) {
    const hint = $('sn-hint');
    if (!hint) return;
    const todayStr = today();
    const next = days.map((d) => d.date).filter((d) => d && d >= todayStr).sort()[0];
    const within = LSCCalc.surchargeSettings(LSCData.pricing()).shortNoticeHintDays;
    const n = next ? Math.round((Date.parse(next + 'T00:00:00Z') - Date.parse(todayStr + 'T00:00:00Z')) / 86400000) : null;
    const text = n !== null && n <= within && !shortNoticeNow()
      ? 'First shoot day is ' + (n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days') + ' — short notice?'
      : '';
    if (hint.textContent !== text) hint.textContent = text;
  }

  const includeOverheadNow = () => {
    const box = $('f-include-overhead');
    // Defaults ON, per the brief — including for the instant before bind() runs.
    return box ? box.checked : true;
  };

  /* The advisory floor. Everything here is display: the arithmetic is
     minimumJobPrice()'s, and the inputs are the totals computeTotals just
     returned. directJobCosts is expenseTotal and estimatedHours is totalHours,
     which is what calc.js's own docblock for this function specifies.
     `working` is hoursWorking()'s sentence, or '' for an hourly-only job. */
  function paintMinimum(totals, working) {
    const line = $('mjp-line');
    if (!line) return; // left mid-edit, or a screen that has no summary bar

    const on = includeOverheadNow();
    line.hidden = !on;
    if (!on) {
      // The income line is the same kind of advisory figure, under the same switch.
      const income = $('mjp-income');
      if (income) income.hidden = true;
      return;
    }

    /* directJobCost, not expenseTotal: pass-throughs at cost plus what resold
       travel cost — carrying no markup (calc.js, minimumJobPrice). */
    const floor = LSCCalc.minimumJobPrice(
      totals.directJobCost,
      totals.totalHours,
      overheadRate,
      profitMarginPct
    );
    paintIncome(totals);
    setBreakdown(totals, floor, working);

    /* null is "cannot be computed", and it has to survive the trip to the
       screen as an em dash and a prompt — not as $0.00, which reads as a real
       answer meaning this job could be done for nothing. Per the IA doc there
       is deliberately no link out of here: an in-progress estimate is the wrong
       moment to send somebody to another screen. */
    if (floor === null) {
      setText('s-min-price', '—');
      setText('s-min-note', 'Set up Overhead & Goals to see this.');
      line.classList.add('mjp-unset');
      return;
    }

    setText('s-min-price', fmt(floor));
    setText(
      's-min-note',
      'to cover ' + fmt(overheadRate) + '/hr of overhead across ' + totals.totalHours +
        (totals.totalHours === 1 ? ' hour' : ' hours') + (working ? ' (' + working + ')' : '') +
        ', marked up ' + profitMarginPct + '%'
    );
    line.classList.remove('mjp-unset');
  }

  /* The job's INCOME floor: its direct costs plus its hours at the income floor
     — what the job has to bill for its hours to pay their share of your
     income target (Dashboard, "income floor"). A second advisory line; like
     the minimum it never moves a billed figure. */
  function paintIncome(totals) {
    const el = $('mjp-income');
    if (!el) return;
    if (incomeFloor === null || !(totals.totalHours > 0)) {
      el.hidden = true;
      return;
    }
    const need = LSCCalc.round2(totals.directJobCost + totals.totalHours * incomeFloor);
    const short = LSCCalc.round2(need - totals.clientPriceExGst);
    el.hidden = false;
    el.innerHTML =
      '<span class="mjp-line-label">Income floor</span>' +
      '<span class="mjp-line-value">' + fmt(need) + '</span>' +
      '<span class="mjp-line-note">its hours at your ' + fmt(incomeFloor) + '/hr income floor, plus direct costs' +
      (short > 0 ? ' — this quote is ' + fmt(short) + ' under it' : ' — this quote clears it') + '</span>';
  }

  // ── The cost breakdown modal ──────────────────────────────────────────────

  /* WHY THE MODAL DOESN'T COMPUTE ANYTHING OF ITS OWN
     It is handed the figures paintMinimum() just put on the screen, at the
     moment it put them there. Recomputing them on open would be a second route
     to the same number and therefore a second chance to disagree with the line
     the (?) is attached to — the one thing a "here is how that was worked out"
     panel cannot afford to do.

     WHY THE MARGIN LINE IS A REMAINDER RATHER THAN ITS OWN MULTIPLICATION
     The modal's whole claim is that its three rows add up to the figure under
     them, so the arithmetic a reader can do on it has to come out. Direct Job
     Costs arrives already rounded by computeTotals, but the overhead allocation
     is hours x rate and lands on sub-cent values routinely (7.5 x $25.33 =
     $189.975). Rounding all three independently then makes the printed column
     miss the printed total by a cent often enough to notice.

     So the two inputs are shown rounded and the margin is what is left of the
     floor after them. It is never more than a cent from margin% of the two
     lines above, and the column is always exactly right — the same trade the
     donut's largest-remainder percentages make (HANDOVER.md decision 51) to
     keep its legend summing to 100.0. Both prefer the visible sum. */
  function setBreakdown(totals, floor, working) {
    const help = $('mjp-help');

    if (floor === null) {
      breakdown = null;
      if (help) help.hidden = true;
      return;
    }

    const direct = LSCCalc.round2(totals.directJobCost);
    const alloc = LSCCalc.round2(totals.totalHours * overheadRate);
    breakdown = {
      direct,
      alloc,
      profit: LSCCalc.round2(floor - direct - alloc),
      floor,
      hours: totals.totalHours,
      working: working || '',
      rate: overheadRate,
      margin: profitMarginPct,
    };
    if (help) help.hidden = false;
  }

  const $b = (id) => breakdownOverlay.querySelector('#' + id);

  function breakdownRow(label, value, note) {
    return (
      '<div class="cb-row"><div class="cb-row-head">' +
      '<span class="cb-row-label">' + label + '</span>' +
      '<span class="cb-row-value">' + fmt(value) + '</span></div>' +
      '<p class="cb-row-note">' + note + '</p></div>'
    );
  }

  function breakdownMarkup() {
    const b = breakdown;
    const hours = b.hours + (b.hours === 1 ? ' hour' : ' hours') + (b.working ? ' (' + esc(b.working) + ')' : '');
    const margin = esc(b.margin);
    return (
      '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="cb-title">' +
      '<h2 class="modal-title" id="cb-title">How this is calculated</h2>' +
      '<div class="cb-rows">' +
      breakdownRow(
        'Direct Job Costs',
        b.direct,
        'What the job costs you out of pocket — crew, equipment and travel at cost. Passed through, so ' +
          'no markup goes on it. Labour is not here: it is what the floor is testing, not an input to it.'
      ) +
      breakdownRow(
        'Overhead Allocation',
        b.alloc,
        hours + ' × ' + fmt(b.rate) + '/hr — this job’s share of what the business costs to run.'
      ) +
      breakdownRow('Markup', b.profit, margin + '% on the overhead allocation.') +
      '</div>' +
      '<div class="cb-total"><span class="cb-total-label">Minimum Job Price</span>' +
      '<span class="cb-total-value">' + fmt(b.floor) + '</span></div>' +
      /* The one place in the app that names the Overhead Rate as a figure of its
         own, per the IA doc's naming table — everywhere else it is just "Rate". */
      '<p class="cb-note">The Overhead Rate of ' + fmt(b.rate) + '/hr and the ' + margin +
      '% markup come from your Overhead and Goals settings. Advisory only — nothing here ' +
      'changes what the client is billed.</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-accent" id="cb-close">Close</button></div></div>'
    );
  }

  function onBreakdownKeydown(event) {
    // Hidden behind the login screen after a lost session: there is nothing on
    // screen to trap focus into, and Escape there belongs to that screen.
    if (breakdownOverlay.closest('[hidden]')) return;
    if (event.key === 'Escape') return closeBreakdown();
    LSCModal.trapTab(breakdownOverlay, event);
  }

  function onBreakdownClick(event) {
    // A click that started inside the box and ended on the backdrop doesn't count.
    if (event.target === breakdownOverlay) closeBreakdown();
  }

  /* No LSCUnsaved watcher, unlike Overhead's Add/Edit dialog: there is nothing
     to type in here and nothing to discard, so closing it can never lose work
     and must not ask as though it could. */
  function closeBreakdown() {
    if (!breakdownOverlay || !breakdownOverlay.classList.contains('open')) return;
    breakdownOverlay.classList.remove('open');
    breakdownOverlay.innerHTML = '';
    document.removeEventListener('keydown', onBreakdownKeydown);
    breakdownOverlay.removeEventListener('click', onBreakdownClick);
    // Focus would otherwise land on <body>, leaving a keyboard user to tab back
    // down the whole form to get where they were.
    if (breakdownOpener && breakdownOpener.isConnected) breakdownOpener.focus();
    breakdownOpener = null;
  }

  function openBreakdown(openedBy) {
    // Defensive: the trigger is hidden whenever this is null, so reaching here
    // without one would mean rendering a dialog of undefineds.
    if (!breakdownOverlay || !breakdown) return;
    breakdownOpener = openedBy || null;

    breakdownOverlay.innerHTML = breakdownMarkup();
    breakdownOverlay.classList.add('open');
    document.addEventListener('keydown', onBreakdownKeydown);
    breakdownOverlay.addEventListener('click', onBreakdownClick);
    $b('cb-close').addEventListener('click', closeBreakdown);

    // The only control in the box, so it is both ends of the focus trap.
    $b('cb-close').focus();
  }

  // ── Rates: current card, or the client's last project ─────────────────────

  /* Rebuilds one row with a new snapshot, keeping what was typed. */
  function reprice(tr, snap) {
    const section = sections.find((sec) => sec.id === tr.dataset.section);
    const line = Object.assign({ name: tr.dataset.name }, snap, {
      qty: inputValue(tr, '.qty-inp'),
      override: inputValue(tr, '.custom-bill-inp'),
    });
    const fresh = section ? buildLabourRow(section, null, line) : buildTravelRow(null, line);
    if (tr.dataset.prevSnap) fresh.dataset.prevSnap = tr.dataset.prevSnap;
    if (tr.dataset.lastOnly) fresh.dataset.lastOnly = tr.dataset.lastOnly;
    tr.replaceWith(fresh);
    return fresh;
  }

  /* Every priced row: labour rows carry data-section, travel rows don't. */
  const priceRows = () => sections.flatMap((sec) => rowsIn(sec.id)).concat(rowsIn('travel'));

  /* Whether two snapshots price a line the same: its price, its unit and that
     unit's hours, and how it bills. Not `rowId`, which is how the line was
     found rather than what it costs; not a labour line's `rate`, which prices
     nothing (see "No Rate column" below); and hours read through
     hoursPerUnitOf, because every snapshot from before v9, and every one the
     v9 migration took, leaves an hour's `hoursPerUnit: 1` unwritten where
     today's card writes it. Compared whole, every such line "changed", and
     "Update to current rates" reported N prices updated when none had moved
     (code review R6). A travel line's `rate` does price it, so there it
     counts. */
  function samePrice(a, b, travel) {
    const key = (x) => [
      Number(x.mu) || 0,
      unitKey(x),
      LSCCalc.hoursPerUnitOf(x),
      Boolean(x.directCost),
      Boolean(x.ownTime),
      Boolean(x.perKm),
      Boolean(x.customBill),
      travel ? Number(x.rate) || 0 : '',
    ].join('|');
    return key(a) === key(b);
  }

  /* Each line at its own unit. A line whose service has left the card, or whose
     unit has no price on it yet, keeps the snapshot it has — re-pricing it at
     nothing, or at some other unit, would be a change nobody asked for. */
  function updateToCurrent() {
    let changed = 0;
    let missing = 0;
    let unpriced = 0;
    priceRows().forEach((tr) => {
      const snap = snapOf(tr) || {};
      const row = cardRowFor(tr.dataset.section || '', snap.rowId, tr.dataset.name);
      if (!row) {
        missing += 1;
        return;
      }
      const next = cardSnap(row, unitKey(snap));
      if (!next) {
        unpriced += 1;
        return;
      }
      const current = snapOf(tr);
      if (!current || !samePrice(next, current, !tr.dataset.section)) {
        delete tr.dataset.prevSnap;
        reprice(tr, next);
        changed += 1;
      }
    });
    // Current rates are no longer the last project's.
    ratesFromLast = false;
    const box = $('f-rates-last');
    if (box) box.checked = false;
    $('rates-note').textContent = 'Each line keeps the price it was added at.';
    /* The surcharge half (production-booking task 2's refreshSurcharges):
       today's multipliers, mode and office hours, and each day's kind read
       from today's holiday list. Asked for only when it changes something, so
       a no-op click doesn't leave the form looking edited. */
    const days = booking ? booking.payloadDays() : [];
    const pricing = LSCData.pricing();
    const kept = JSON.stringify(surchargesNow(days, pricing));
    const was = refreshSurcharges;
    refreshSurcharges = true;
    const surchargesMoved = !was && JSON.stringify(surchargesNow(days, pricing)) !== kept;
    if (!was && !surchargesMoved) refreshSurcharges = false;
    paintLineUnits();
    recalc();
    const lines = (n) => n + ' line' + (n === 1 ? '' : 's');
    const keptIts = (n) => (n === 1 ? ' kept its' : ' kept their') + ' price';
    Toast.ok(
      (changed ? changed + ' price' + (changed === 1 ? '' : 's') + ' updated to the rate card' : 'Every price already matches the rate card') +
        (surchargesMoved ? '; surcharges now follow today’s Rate Card and public holidays' : '') +
        (missing ? '; ' + lines(missing) + (missing === 1 ? ' isn’t' : ' aren’t') + ' on it any more and' + keptIts(missing) : '') +
        (unpriced ? '; ' + lines(unpriced) + ' at a unit with no price on it yet' + keptIts(unpriced) : '') + '.'
    );
  }

  /* Category + unit + (row id or name). The unit is unitKey()'s: last time's
     full-day price is never offered for an hour. */
  const rateKey = (sectionId, unit, by) => (sectionId || 'travel') + '|' + unit + '|' + by;

  /* The client's most recent other estimate that recorded its prices, and its
     prices keyed by category + unit + row id and category + unit + name. */
  function buildLastProject(estimates, clientId) {
    const mine = estimates
      .filter((e) => e.clientId === clientId && (!existing || e.id !== existing.id))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const e of mine) {
      const rates = new Map();
      Object.keys(e.activeRows || {}).forEach((key) => {
        if (key === 'crew' || key === 'equip' || key === 'deliverables' || !Array.isArray(e.activeRows[key])) return;
        e.activeRows[key].forEach((line) => {
          const snap = snapFor(null, line);
          if (!snap) return;
          const section = key === 'travel' ? '' : key;
          const unit = unitKey(snap);
          if (snap.rowId) rates.set(rateKey(section, unit, 'id:' + snap.rowId), snap);
          rates.set(rateKey(section, unit, 'name:' + line.name), snap);
        });
      });
      if (rates.size) return { estimate: e, rates };
    }
    return mine.length ? { estimate: mine[0], rates: new Map() } : null;
  }

  function lastRateFor(sectionId, rowId, name, unit) {
    if (!lastProject || !lastProject.rates.size) return null;
    return (rowId && lastProject.rates.get(rateKey(sectionId, unit, 'id:' + rowId))) ||
      lastProject.rates.get(rateKey(sectionId, unit, 'name:' + name)) || null;
  }

  function paintLastToggle() {
    const wrap = $('rates-last-wrap');
    if (!wrap) return;
    const clientId = linkedClientId();
    const usable = Boolean(clientId && lastProject && lastProjectFor === clientId && lastProject.rates.size);
    wrap.hidden = !(clientId && lastProject && lastProjectFor === clientId);
    const box = $('f-rates-last');
    box.disabled = !usable;
    if (lastProject && lastProjectFor === clientId) {
      const e = lastProject.estimate;
      $('rates-last-label').textContent = usable
        ? 'Use rates from last project — ' + (e.name || e.upid || 'untitled') + (e.date ? ', ' + e.date : '')
        : 'Last project (' + (e.name || e.upid || 'untitled') + ') didn’t record its prices — saved before 28 Sep 2026';
    }
    if (!usable && ratesFromLast) setRatesFromLast(false);
  }

  /* Looked up when the estimate is (or becomes) linked to a client. */
  async function lookUpLastProject() {
    const clientId = linkedClientId();
    if (!clientId || lastProjectFor === clientId) return paintLastToggle();
    lastProjectFor = clientId;
    lastProject = undefined;
    try {
      const reply = await LSCApi.get('/api/estimates');
      if (!onScreen() || linkedClientId() !== clientId) return;
      lastProject = buildLastProject(reply.estimates || [], clientId);
    } catch (err) {
      if (err instanceof LSCApi.ApiError && err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      lastProject = null;
    }
    paintLastToggle();
  }

  /* On: each line takes the last project's price for it, remembering its own.
     Off: each line gets its own back. Lines the last project didn't have keep
     the price they have. */
  function setRatesFromLast(on) {
    ratesFromLast = on;
    let swapped = 0;
    let keptLast = 0;
    priceRows().forEach((tr) => {
      if (on) {
        const snap = snapOf(tr) || {};
        const last = lastRateFor(tr.dataset.section || '', snap.rowId, tr.dataset.name, unitKey(snap));
        if (!last) return;
        const mark = tr.dataset.snap || '';
        const fresh = reprice(tr, last);
        fresh.dataset.prevSnap = mark || 'none';
        swapped += 1;
      } else if (tr.dataset.prevSnap) {
        // 'none': the line had no price of its own (a legacy line whose service
        // has left the card) — an empty snapshot rebuilds it unpriced again.
        const prev = tr.dataset.prevSnap === 'none' ? {} : JSON.parse(tr.dataset.prevSnap);
        delete tr.dataset.prevSnap;
        const fresh = reprice(tr, prev);
        if (fresh.dataset.lastOnly) {
          delete fresh.dataset.lastOnly;
          keptLast += 1;
        }
      } else if (tr.dataset.lastOnly) {
        // Today's card has no price at its unit: it keeps last time's (markOwn).
        delete tr.dataset.lastOnly;
        keptLast += 1;
      }
    });
    const box = $('f-rates-last');
    if (box) box.checked = on;
    $('rates-note').textContent = on
      ? swapped + ' line' + (swapped === 1 ? '' : 's') + ' priced as last time; anything new to this job is at today’s rates.'
      : 'Each line keeps the price it was added at.' +
        (keptLast
          ? ' ' + keptLast + ' line' + (keptLast === 1 ? '' : 's') + ' kept last project’s price: today’s rate card has ' +
            'no price at ' + (keptLast === 1 ? 'its unit' : 'their units') + ' yet.'
          : '');
    paintLineUnits();
    recalc();
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  function showError(message) {
    const el = $('editor-error');
    if (!el) return; // left while the request was in flight
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    LSCUtil.clearFieldErrors($('editor-error'));
  }

  function fieldError(msg, id) {
    LSCUtil.showFieldErrors($('editor-error'), [{ msg, field: $(id) }]);
  }

  function setSaving(next) {
    // The flag first: it is module state and has to be cleared even when the
    // controls it describes have gone.
    saving = next;
    if (!onScreen()) return;
    $('js-save').disabled = next;
    $('save-spin').style.display = next ? 'inline-block' : 'none';
    $('save-label').textContent = next ? 'Saving…' : 'Save Estimate';
    const del = $('js-delete');
    if (del) del.disabled = next;
  }

  // ── Client link ───────────────────────────────────────────────────────────

  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  /* The estimate links to a client record only while the Business Name still
     says that client's name. Editing it to something else means this is no
     longer that client, so the link lapses; typing the name back restores it. */
  function linkedClientId() {
    return link && sameName($('f-business').value, link.name) ? link.id : null;
  }

  function paintLink() {
    const named = $('f-business').value.trim() !== '';
    const linked = linkedClientId() !== null;
    $('client-linked').hidden = !linked;
    $('client-save-wrap').hidden = linked || !named;
  }

  /* A pick fills every client field, blanks included: picking a client means
     "use this client's details", and leaving a previous pick's phone behind
     under a new business name would be worse than an empty field. */
  function pickClient(client) {
    $('f-business').value = client.businessName || '';
    $('f-contact').value = client.contactName || '';
    $('f-email').value = client.email || '';
    $('f-phone').value = client.phone || '';
    $('f-abn').value = abnFormat(client.abn);
    $('f-address').value = client.address || '';
    link = { id: client.id, name: client.businessName };
    paintLink();
    lookUpLastProject();
  }

  /* "Save to client list" for a name that isn't linked. An existing record with
     the same name is linked to, never written to: the client list is the
     maintained copy, and an estimate's details (possibly typed in a hurry)
     must not overwrite it. Reads the full list rather than ?q=, which is
     capped at 20 partial matches and could leave the exact one out. */
  async function resolveClient(snapshot) {
    const all = (await LSCApi.get('/api/clients')).clients || [];
    const match = all.find((c) => sameName(c.businessName, snapshot.businessName));
    if (match) {
      link = { id: match.id, name: match.businessName };
      return { id: match.id, created: false };
    }
    const reply = await LSCApi.post('/api/clients', snapshot);
    // Linked before the estimate is saved, so if that save fails a retry
    // reuses this record instead of creating a second one.
    link = { id: reply.client.id, name: reply.client.businessName };
    return { id: reply.client.id, created: true };
  }

  function payload() {
    const client = Object.assign({}, (existing && existing.client) || {}, {
      businessName: $('f-business').value.trim(),
      contactName: $('f-contact').value.trim(),
      email: $('f-email').value.trim(),
      phone: $('f-phone').value.trim(),
      abn: abnDigits($('f-abn').value),
      address: $('f-address').value.trim(),
    });

    const body = {
      upid: $('f-upid').value.trim(),
      name: $('f-name').value.trim(),
      date: $('f-date').value,
      notes: $('f-notes').value.trim(),
      docType: $('f-doctype').value,
      invoiceNumber: $('f-invnum').value.trim(),
      // Nothing in the UI sets a status yet, but a PUT that omits it would
      // reset the estimate to 'draft'.
      status: (existing && existing.status) || 'draft',
      clientId: linkedClientId(),
      // Same reasoning as status: the server treats an omitted gstFree as false,
      // so it is always sent rather than left to a default.
      gstFree: gstFreeNow(),
      client,
      activeRows: collect(),
      // Replaces the estimate's days whole on the server, so it is always sent.
      days: booking ? booking.payloadDays() : [],
      // Gear rentals (B2-7): replaced whole, like days, so always sent.
      rentals: rentalsPayload(),
      // Like days: a PUT without it keeps the stored tick, so it is always sent.
      shortNotice: shortNoticeNow(),
      // Says this build prices lines from the v9 card; the server refuses an
      // estimate write without it (calc.js PRICING_SHAPE says why).
      pricingShape: LSCCalc.PRICING_SHAPE,
    };
    // Only when asked for, so the form isn't "unsaved" until it is.
    if (refreshSurcharges) body.refreshSurcharges = true;
    return body;
  }

  /* The whole form, as it would be saved, in one string. Compared against the
     snapshot taken at mount to answer whether there is anything here worth
     warning about — a comparison rather than a "they typed something" flag, so
     a character typed and deleted again doesn't raise a dialog. Rows count:
     collect() is in the payload, so adding a service or clearing an hours field
     is an unsaved change like any other. */
  const snapshot = () => JSON.stringify(payload());

  /* What the server's gear-rental refusals mean (rentals.js parseRentals). The
     editor's own rules keep most of them from happening. */
  const RENTAL_ERRORS = {
    rental_dates_reversed: 'A gear rental comes back before it goes out. Check its dates.',
    rental_vendor_duplicate: 'Two gear rentals have the same vendor. Nothing was saved.',
    rental_vendor_too_long: 'A vendor’s name is too long: 200 characters at most.',
    rental_note_too_long: 'A gear rental’s note is too long: 500 characters at most.',
    rental_id_taken: 'A gear rental’s id is already used by another estimate. Reload this estimate and try again.',
    too_many_rentals: 'There are more than 100 gear rentals on this estimate.',
  };

  async function save() {
    if (saving) return;
    clearError();

    const body = payload();
    if (!body.name) {
      fieldError('Enter a project name before saving.', 'f-name');
      return;
    }
    if (!body.upid) {
      fieldError('Enter a UPID before saving.', 'f-upid');
      return;
    }
    // The client's ABN prints on the invoice.
    if (body.client.abn && !abnValid(body.client.abn)) {
      fieldError('That client ABN doesn’t check out — it should be 11 digits, as shown on the ABN Lookup.', 'f-abn');
      return;
    }

    // A rental back before it went out: the server refuses it (rental_dates_reversed).
    const backwards = shownRentals().find(reversed);
    if (backwards) {
      if (booking) booking.showOff(); // opens the block if it was folded
      fieldError('The ' + backwards.vendor + ' rental comes back before it goes out. Check its Back date.',
        'rn-' + backwards.id + '-back');
      return;
    }

    // A day on a date another project has confirmed, with no specification note (D16).
    const locked = booking && booking.lockProblem();
    if (locked) {
      fieldError(locked.msg, locked.fieldId);
      return;
    }

    /* The server prices every booked date against the public holiday list.
       Until the editor has that list too, the figures on screen can be lower
       than the ones that will be saved and sent (money review, 2026-10-02).
       So it is fetched first. If it can't be, or if it changes a price, the
       save stops and says so: nothing is stored at a price the owner hasn't
       seen. */
    if ((body.days || []).some((d) => d.date) && !holidays) {
      setSaving(true);
      const shown = ($('s-total') || {}).textContent;
      await loadHolidays();
      setSaving(false);
      if (!onScreen()) return;
      if (!holidays) {
        showError('Couldn’t load the public holiday list, so a booked date can’t be priced yet. Nothing was saved — try again in a moment.');
        return;
      }
      if (($('s-total') || {}).textContent !== shown) {
        showError('A booked date is a public holiday, so the prices have been updated. Check them, then save again.');
        return;
      }
      Object.assign(body, payload());
    }

    setSaving(true);
    Toast.working('Saving…');

    try {
      let added = false;
      if (!body.clientId && body.client.businessName && $('f-saveclient').checked) {
        const resolved = await resolveClient({
          businessName: body.client.businessName,
          contactName: body.client.contactName,
          email: body.client.email,
          phone: body.client.phone,
          abn: body.client.abn,
          address: body.client.address,
        });
        body.clientId = resolved.id;
        added = resolved.created;
        paintLink();
      }

      const reply = existing
        ? await LSCApi.put('/api/estimates/' + encodeURIComponent(existing.id), body)
        : await LSCApi.post('/api/estimates', body);
      Toast.ok(added ? 'Estimate saved — ' + body.client.businessName + ' added to your client list.' : 'Estimate saved.');
      // Nothing more to do to a screen the user has already left — and
      // snapshot() reads the form, which is no longer there to read.
      if (!onScreen()) return;
      // What is on screen is now what is stored. onSaved fetches the estimate
      // before replacing this screen, and for that moment the editor is still
      // in the page — without this a reload in the gap would warn about an
      // estimate that had just been saved.
      baseline = snapshot();
      handlers.onSaved(reply.estimate);
    } catch (err) {
      // The form is left exactly as it was: a failed save must never be the
      // reason someone retypes an estimate.
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      // Confirmed by another project since this editor last looked: point at that day's note.
      if (err.code === 'date_locked' && booking) {
        const lock = booking.serverLocked(err.data && err.data.date, err.data && err.data.upid);
        if (lock.fieldId) return fieldError(lock.msg, lock.fieldId);
        return showError(lock.msg);
      }
      if (RENTAL_ERRORS[err.code]) return showError(RENTAL_ERRORS[err.code]);
      showError(
        err.kind === 'network'
          ? 'Couldn’t save — the server is unreachable. Your work is still here; try again once it’s back.'
          : 'Couldn’t save: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  async function remove() {
    if (saving || !existing) return;
    if (!window.confirm('Delete this estimate? This cannot be undone.')) return;

    setSaving(true);
    Toast.working('Deleting…');
    try {
      await LSCApi.del('/api/estimates/' + encodeURIComponent(existing.id));
      Toast.ok('Estimate deleted.');
      if (!onScreen()) return;
      handlers.onDeleted();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(
        err.kind === 'network'
          ? 'Couldn’t delete — the server is unreachable.'
          : 'Couldn’t delete: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  /* Every on-set line goes on its day's card, or on Not on a day when it has
     none (B2-4, D79) — every line saved before B2, and production lines saved
     before days. A production line's stored surchargedPrice isn't read: the
     server stamps it again on save, and recalc shows what that will be. */
  function restoreRows(activeRows, pricing, days) {
    const dayIds = new Set((days || []).map((d) => String(d.id)));
    const cardFor = (line) => panelFor(line.dayId && dayIds.has(String(line.dayId)) ? String(line.dayId) : OFF_DAY);
    sections.forEach((section) => {
      (activeRows[section.id] || []).forEach((line) => {
        const tr = buildLabourRow(section, labourDef(section, line, pricing), line);
        if (section.id !== 'prod' || section.archived) return injectRow($('tbody-' + section.id), tr);
        injectRow(groupBody(cardFor(line), 'prod'), tr);
      });
    });
    (activeRows.travel || []).forEach((line) => {
      injectRow(groupBody(cardFor(line), 'travel'), buildTravelRow(travelDef(line, pricing), line));
    });
    (activeRows.crew || []).forEach((line) => injectRow(groupBody(cardFor(line), 'crew'), buildCostRow('crew', line)));
    (activeRows.equip || []).forEach((line) => injectRow(groupBody(cardFor(line), 'equip'), buildCostRow('equip', line)));
    (activeRows.deliverables || []).forEach((line) =>
      injectRow($('tbody-deliverables'), buildDeliverableRow(line))
    );
    // Every line is back, so the rentals can follow them from here (syncRentals).
    rentalsReady = true;
  }

  function bind(pricing) {
    /* Cancel and Back both drop the estimate on the floor. Cancel says so, but
       an hour of work is worth a question either way — and Back sits where the
       browser's own back button would, which is not where anyone expects to
       lose a form. */
    const leave = () => {
      if (!LSCUnsaved.confirmLeave()) return;
      handlers.onCancel();
    };
    $('js-back').addEventListener('click', leave);
    $('js-cancel').addEventListener('click', leave);
    $('js-save').addEventListener('click', save);
    const del = $('js-delete');
    if (del) del.addEventListener('click', remove);

    ['f-upid', 'f-name', 'f-business'].forEach((id) =>
      $(id).addEventListener('change', () => booking.refreshIdentity())
    );

    const business = $('f-business');
    ClientTypeahead.attach(business, { onPick: pickClient });
    business.addEventListener('input', () => {
      paintLink();
      paintLastToggle();
    });

    $('js-rates-current').addEventListener('click', updateToCurrent);
    $('f-rates-last').addEventListener('change', function () {
      setRatesFromLast(this.checked);
    });

    const docType = $('f-doctype');
    docType.addEventListener('change', function () {
      $('inv-num-wrap').classList.toggle('show', this.value === 'invoice');
    });

    // Changing the tax treatment moves the headline figures, so it recomputes
    // like any other input that feeds them.
    const gstFreeBox = $('f-gstfree');
    if (gstFreeBox) gstFreeBox.addEventListener('change', recalc);
    $('f-shortnotice').addEventListener('change', recalc);

    /* The "On set, by day" summaries (B2-6): "Add to a day ▾" opens a card's
       service menu at the summary's category, so there is still one way to
       add an item (the brief's B2 principle 1); "Edit on the day ↑" goes to
       the card. The groups are repainted by recalc, so this listens on the
       block. */
    root.querySelectorAll('[data-onset]').forEach((block) => {
      const kind = block.dataset.onset;
      block.addEventListener('click', (e) => {
        const add = e.target.closest('.onset-add');
        if (add) return openAddPop(add, kind);
        const edit = e.target.closest('.onset-edit');
        if (edit) editOnDay(edit.dataset.key, kind);
      });
    });

    /* Straight to recalc() like any other input that feeds the bar — not a
       lighter show/hide path. The toggle changes nothing computeTotals reads,
       so running the full pass is the cheap way to be certain of it: if this
       ever did move a headline figure, it would show up here rather than in a
       shortcut that skipped the comparison. */
    $('f-include-overhead').addEventListener('change', recalc);

    $('mjp-help').addEventListener('click', (event) => openBreakdown(event.currentTarget));

    /* A new line is snapshotted at the picked unit there and then — an auto
       price as the number it resolves to now. While "Use rates from last
       project" is on it takes last time's price for that service at that unit,
       when there is one (unitSnap). */
    sections.forEach((section) => {
      const add = $('add-' + section.id);
      if (!add) return; // archived categories have no picker
      $('sel-' + section.id).addEventListener('change', () => paintPicker(section, false));
      paintPicker(section, false);
      add.addEventListener('click', () => {
        const row = section.rows.find((r) => r.name === $('sel-' + section.id).value);
        if (!row) return;
        const picked = unitSnap(section.id, row, row.prices ? $('unit-' + section.id).value : 'hour');
        if (!picked.snap) return; // no price yet — the button is disabled for it
        const tr = buildLabourRow(section, null, Object.assign({ name: row.name, qty: 0 }, picked.snap));
        markOwn(tr, picked);
        injectRow($('tbody-' + section.id), tr);
      });
    });

    $('add-deliverables').addEventListener('click', () =>
      injectRow($('tbody-deliverables'), buildDeliverableRow({ qty: 1 }))
    );
  }

  function mount(container, estimate, viewHandlers) {
    root = container;
    handlers = viewHandlers;
    existing = estimate || null;
    rowCounter = 0;
    saving = false;
    breakdownOverlay = document.getElementById('modal-cost-breakdown');
    /* The overlay lives outside `root`, so a re-mount replaces the form under
       an open dialog instead of taking it with it. Nothing in the app can
       currently navigate past the trap to get here, but the dialog would
       outlive the figures it describes if anything ever could. */
    closeBreakdown();
    breakdown = null;
    link =
      estimate && estimate.clientId
        ? { id: estimate.clientId, name: (estimate.client && estimate.client.businessName) || '' }
        : null;

    const pricing = LSCData.pricing();
    /* Resolved once, before the first recalc(). Both stay null when Finance has
       not been set up, and minimumJobPrice() turns either null into a null
       floor, which paintMinimum() renders as the set-up prompt. */
    /* The same LSCData.overheadRate() the Rate Card's rate column and the
       Dashboard read, so the floor here and the rate there cannot disagree. */
    overheadRate = LSCData.overheadRate();
    profitMarginPct = LSCData.goals().targetProfitMarginPct;
    incomeFloor = LSCData.incomeFloor();
    priceCtx = LSCData.priceContext();
    lastProject = undefined;
    lastProjectFor = null;
    ratesFromLast = false;
    const activeRows = (estimate && estimate.activeRows) || {};
    sections = sectionsFor(activeRows, pricing, estimate && estimate.sectionLabels);

    booking = null;
    closeMenu(false);
    closeMovePop(false);
    endDrag(false);
    dayPanels.clear();
    // A fresh estimate: its first recalc is the baseline, announced as nothing.
    clearTimeout(surTimer);
    surAnnounced = null;
    holidays = null;
    holidaysLoading = null;
    refreshSurcharges = false;
    daysSig = null; // so the first paint labels the cards

    // The stored rentals, before the lines come back and are matched to them (syncRentals).
    rentals = ((estimate && estimate.rentals) || []).map((r) => ({
      id: r.id,
      key: vendorKey(r.vendor),
      vendor: String(r.vendor || '').trim(),
      outDate: r.outDate || null,
      outMethod: r.outMethod || null,
      backDate: r.backDate || null,
      backMethod: r.backMethod || null,
      note: r.note || '',
      carrier: null,
    }));
    rentalsReady = false;
    rentalsEl = null;
    rentalRows.clear();
    lineVendors = new WeakMap();

    root.innerHTML = formMarkup(estimate, pricing);
    restoreRows(activeRows, pricing, estimate && estimate.days);
    booking = BookingBlock.mount($('booking-slot'), {
      estimate,
      // Collapsed unless there is booking to show (D64): days, or any on-set line, which lives on a card.
      hasItems: ['prod', 'travel', 'crew', 'equip'].some((k) => Array.isArray(activeRows[k]) && activeRows[k].length > 0),
      // How this estimate's own tiles are labelled on the calendar, read live.
      identity: () => ({
        upid: $('f-upid').value.trim(),
        projectName: $('f-name').value.trim(),
        client: $('f-business').value.trim(),
      }),
      // A day's date, times or removal moves its items' prices.
      onChange: recalc,
      // Each day's items (task 7; every on-set kind since B2-4), built here and kept across paints.
      itemsFor: (dayId) => panelFor(dayId),
      offItems: () => panelFor(OFF_DAY),
      // Folding the block takes the service menu with it.
      onToggle: (isOpen) => {
        if (!isOpen) closeMenu(false);
      },
      // Duplicate day (B2-5): the block made the day; its lines are copied here.
      onDuplicate: duplicateLines,
      // Gear rentals (B2-7): the panel under both columns, and the head's counts.
      rentals: rentalsPanel,
      headNotes: bookingHeadNotes,
    });
    bind(pricing);
    paintLink();
    recalc();
    lookUpLastProject();

    baseline = snapshot();
    LSCUnsaved.watch('estimate-editor', {
      label: 'this estimate',
      // Hidden still counts as on screen: behind the login card after a 401
      // this form is being kept for after sign-in, and a reload would lose it.
      onScreen: () => Boolean(root && root.querySelector('#f-upid')),
      dirty: () => snapshot() !== baseline,
    });

    $('f-upid').focus();
  }

  return {
    mount,
    /* Re-run the live totals against whatever LSCData now holds. The Invoice
       Settings modal opens over this screen without unmounting it, so changing
       the GST configuration leaves the summary bar showing figures from the old
       one until the next keystroke happens to recompute them.

       The auto prices move with it: on a GST-inclusive card an auto price
       carries GST inside it. So the price context is taken again and the unit
       pickers repainted, or the next line added would be snapshotted at the
       old configuration's figure and read under the new one. Lines already on
       the estimate keep their snapshots, as they would for any rate-card
       change; "Update to current rates" now re-prices them at the new figure.

       The guard is what makes this safe to call blind: `root` stays set after
       another view has replaced the markup inside it, so the sentinel asks
       whether the editor is actually on screen rather than whether it ever was. */
    refreshTotals() {
      if (!root || !root.querySelector('#s-gst')) return;
      priceCtx = LSCData.priceContext();
      paintLineUnits();
      recalc();
    },
  };
})();
