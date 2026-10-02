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
 * is built inside that day's card in the Production Booking block, which has
 * its own service → unit → Add picker, and it saves with that day's `dayId`
 * (read from where the row sits, never stored on the row). The Production
 * section further down keeps its place and subtotal; it lists the days, and
 * its "Add to a day" select takes you to a day's picker. A Production line
 * saved before days existed has no day: it is shown there, under
 * "Unassigned — pick a day", priced exactly as before until it is moved.
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
  let daysSig = ''; // the day titles the day selects were last built from

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
      if (section.id === 'prod') dayPanels.forEach((panel) => paintPicker(section, true, pickerEls(panel)));
    });
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

  /* A Production row's day is the card it sits in. */
  function rowDayId(tr) {
    if (tr.dataset.section !== 'prod') return null;
    const panel = tr.closest('[data-items-day]');
    return panel ? panel.dataset.itemsDay : null;
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
    const unitSel = tr.querySelector('.lab-unit-sel');
    if (unitSel) unitSel.addEventListener('change', () => switchUnit(tr, unitSel.value));
    return tr;
  }

  function buildTravelRow(def, line) {
    const tr = document.createElement('div');
    tr.className = 'gt-row expense-grid';
    tr.dataset.rid = rid();
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
    return tr;
  }

  /* Equipment and crew are the same shape — a free-text name, days, and a cost
     per day — and bill identically. One builder, two labels. */
  function buildCostRow(kind, line) {
    const isEquip = kind === 'equip';
    const nameClass = isEquip ? 'vendor-inp' : 'role-inp';
    const placeholder = isEquip ? 'Vendor / item name' : 'Role / contractor name';
    const label = isEquip ? 'Vendor or item' : 'Role or contractor';
    const value = isEquip ? line.vendor : line.role;
    // Must match costSectionMarkup's `columns` for this kind — the stacked
    // mobile row prints these in place of the headings it hides.
    const nameCol = isEquip ? 'Vendor / Item' : 'Role / Name';
    const costCol = isEquip ? 'Cost/Day' : 'Day Rate';

    const tr = document.createElement('div');
    tr.className = 'gt-row expense-grid';
    tr.dataset.rid = rid();

    tr.innerHTML =
      '<div data-label="' + nameCol + '"><input class="text-inp ' + nameClass + '" type="text" value="' + esc(value || '') +
      '" placeholder="' + placeholder + '" aria-label="' + label + '"></div>' +
      '<div class="right" data-label="Days"><input class="num-inp days-inp" type="number" min="0" step="0.5" value="' +
      (line.days || '') + '" aria-label="Days"></div>' +
      '<div class="right" data-label="' + costCol + '"><input class="num-inp cost-inp" type="number" min="0" step="0.01" value="' +
      (line.cost || '') + '" aria-label="Cost per day"></div>' +
      '<div class="right muted-td mu-cell">—</div>' +
      '<div class="right" data-label="Total"><span class="bill-cell">—</span></div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove" aria-label="Remove row">×</button></div>';

    bindRow(tr, ['.days-inp', '.cost-inp']);
    return tr;
  }

  function buildDeliverableRow(line) {
    const tr = document.createElement('div');
    tr.className = 'gt-row deliv-grid';
    tr.dataset.rid = rid();

    tr.innerHTML =
      '<div data-label="Deliverable Name"><input class="deliv-name-inp text-inp" type="text" placeholder="e.g. Hero Video" value="' +
      esc(line.name || '') + '" aria-label="Deliverable name"></div>' +
      '<div data-label="Format / Aspect Ratio"><input class="deliv-fmt-inp text-inp" type="text" placeholder="e.g. 16:9 4K" value="' +
      esc(line.format || '') + '" aria-label="Format"></div>' +
      '<div data-label="Duration / Length"><input class="deliv-dur-inp text-inp" type="text" placeholder="e.g. 60 sec" value="' +
      esc(line.duration || '') + '" aria-label="Duration"></div>' +
      '<div class="right" data-label="Qty"><input class="deliv-qty-inp num-inp" type="number" min="0" value="' +
      (line.qty || 1) + '" aria-label="Quantity"></div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove" aria-label="Remove deliverable">×</button></div>';

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
    if (!body.querySelector('[data-rid]')) {
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

  /* The Production section, in its usual place: the subtotal of every
     production line, surcharges included; "Add to a day", which takes you to
     a day card's picker (or makes a Date TBC day); one line per day; and the
     lines that have no day yet. paintDays() fills the day parts. */
  function prodSectionMarkup(section) {
    return (
      '<div class="billing-block" id="block-prod">' +
      '<div class="bb-head"><div><h2 class="bb-label">' + esc(section.label) + '</h2>' +
      '<span class="bb-label-tag">On set</span></div>' +
      '<span class="bb-sum">Subtotal <b id="sum-prod">$0.00</b></span></div>' +
      '<div class="bb-picker prod-add">' +
      '<label class="prod-add-label" for="prod-day-sel">Add to a day</label>' +
      '<select class="svc-select" id="prod-day-sel"></select>' +
      '<button type="button" class="btn btn-accent btn-sm" id="prod-day-go">+ Add Items</button></div>' +
      '<ol class="prod-days" id="prod-days"></ol>' +
      '<div class="prod-unassigned" id="prod-unassigned" hidden>' +
      '<p class="prod-unassigned-head" id="prod-unassigned-head">Unassigned — pick a day</p>' +
      '<p class="prod-unassigned-note">Added before production days. Each prices as it always has until you ' +
      'move it onto a day, where that day’s surcharges apply.</p>' +
      labourHead +
      bodyMarkup('prod', 'No unassigned production items.') +
      '</div>' +
      '</div>'
    );
  }

  const pickerEls = (panel) => ({
    svc: panel.querySelector('.day-svc'),
    unitSel: panel.querySelector('.unit-select'),
    add: panel.querySelector('.day-add'),
  });

  const prodSection = () => sections.find((s) => s.id === 'prod' && !s.archived) || null;

  /* One day's items: its own picker, the labour grid, and the D26 hours
     hint. Built once per day and kept (dayPanels); the booking block moves it
     into the day's card on every paint. */
  function panelFor(dayId) {
    if (dayPanels.has(dayId)) return dayPanels.get(dayId);
    const section = prodSection();
    const panel = document.createElement('div');
    panel.className = 'day-items';
    panel.dataset.itemsDay = dayId;
    const k = 'di-' + dayId;
    const options = section && section.rows.length
      ? section.rows.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + '</option>').join('')
      : '';
    panel.innerHTML =
      '<div class="day-items-bar"><span class="day-items-label" id="' + k + '-l">Production items</span>' +
      '<span class="day-items-sum">Day total <b class="day-items-total">$0.00</b></span></div>' +
      (options
        ? '<div class="bb-picker day-picker">' +
          '<select class="svc-select day-svc" aria-label="Production service to add"></select>' +
          '<select class="svc-select unit-select" aria-label="Unit to add"></select>' +
          '<button type="button" class="btn btn-accent btn-sm day-add">+ Add</button></div>'
        : '<p class="day-items-none">No Production services on the rate card to add.</p>') +
      labourHead +
      '<div class="gt-body" data-empty-text="No production items on this day yet.">' +
      '<div class="empty-row">No production items on this day yet.</div></div>' +
      '<p class="day-hours" hidden></p>';
    dayPanels.set(dayId, panel);
    if (!options) return panel;

    const els = pickerEls(panel);
    els.svc.innerHTML = options;
    els.svc.addEventListener('change', () => paintPicker(section, false, els));
    paintPicker(section, false, els);
    /* As the section pickers do (bind): snapshotted at the picked unit there
       and then, at last time's price while that toggle is on. */
    els.add.addEventListener('click', () => {
      const row = section.rows.find((r) => r.name === els.svc.value);
      if (!row) return;
      const picked = unitSnap(section.id, row, row.prices ? els.unitSel.value : 'hour');
      if (!picked.snap) return;
      const tr = buildLabourRow(section, null, Object.assign({ name: row.name, qty: 0 }, picked.snap));
      markOwn(tr, picked);
      injectRow(panel.querySelector('.gt-body'), tr);
      const qty = tr.querySelector('.qty-inp');
      if (qty) qty.focus();
    });
    return panel;
  }

  /* An unassigned line's way onto a day: a select under its name. */
  function addMoveControl(tr) {
    const svc = tr.firstElementChild;
    const wrap = document.createElement('div');
    wrap.className = 'lab-move';
    wrap.innerHTML =
      '<select class="lab-move-sel" aria-label="Move ' + esc(tr.dataset.name) + ' to a day"></select>';
    svc.classList.add('lab-svc');
    svc.appendChild(wrap);
    const sel = wrap.firstElementChild;
    sel.innerHTML = moveOptions();
    sel.addEventListener('change', () => {
      if (sel.value) moveToDay(tr, sel.value);
    });
  }

  function moveOptions() {
    const days = booking ? booking.list() : [];
    return '<option value="">' + (days.length ? 'Pick a day…' : 'No days booked yet') + '</option>' +
      days.map((d) => '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>').join('');
  }

  /* Rebuilt rather than moved, so it loses its move select; everything typed,
     and both rate marks, go with it (as reprice does). */
  function moveToDay(tr, dayId) {
    const section = sections.find((sec) => sec.id === 'prod');
    const line = Object.assign({ name: tr.dataset.name }, snapOf(tr) || {}, {
      qty: inputValue(tr, '.qty-inp'),
      override: inputValue(tr, '.custom-bill-inp'),
    });
    const fresh = buildLabourRow(section, null, line);
    if (tr.dataset.prevSnap) fresh.dataset.prevSnap = tr.dataset.prevSnap;
    if (tr.dataset.lastOnly) fresh.dataset.lastOnly = tr.dataset.lastOnly;
    const day = (booking ? booking.list() : []).find((d) => d.id === dayId);
    tr.remove();
    injectRow(panelFor(dayId).querySelector('.gt-body'), fresh);
    if (booking) booking.showDay(dayId);
    const qty = fresh.querySelector('.qty-inp');
    if (qty) qty.focus();
    LSCUtil.announce($('editor-live'), tr.dataset.name + ' moved to ' + (day ? day.title : 'its day') + '.');
  }

  /* "Booked 12 hrs, items cover 8" (D26): the day's booked hours, from its
     times, when they're longer than its items' hours. Never a price. */
  const { bookedHours, hrsText } = LSCRows;

  /* Everything about the days that isn't a price: the Production section's
     day list and "Add to a day" select, each unassigned line's day select,
     each day card's labels, dropped days' items. Selects are only rebuilt when
     the days themselves change, so one being used is never pulled from under
     the pointer. `perDay` is recalc's { dayId → { total, hours, count, names } }. */
  function paintDays(perDay, unassigned) {
    // Mid-mount (restoreRows runs before the booking block exists): nothing to paint yet.
    if (!booking) return;
    const days = booking.list();
    const live = new Set(days.map((d) => d.id));
    Array.from(dayPanels.keys()).forEach((id) => {
      if (!live.has(id)) dayPanels.delete(id);
    });

    const sig = days.map((d) => d.id + '|' + d.title + '|' + d.status).join('\n');
    if (sig !== daysSig) {
      daysSig = sig;
      const sel = $('prod-day-sel');
      if (sel) {
        const was = sel.value;
        sel.innerHTML =
          days.map((d) => '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>').join('') +
          '<option value="' + NEW_TBC + '">A new Date TBC day</option>';
        sel.value = live.has(was) ? was : days.length ? days[0].id : NEW_TBC;
      }
      rowsIn('prod').forEach((tr) => {
        const move = tr.querySelector('.lab-move-sel');
        if (move) move.innerHTML = moveOptions();
      });
      days.forEach((d) => {
        const panel = dayPanels.get(d.id);
        if (!panel) return;
        panel.querySelector('.day-items-label').textContent = 'Production items, ' + d.title;
        const els = pickerEls(panel);
        if (els.svc) els.svc.setAttribute('aria-label', 'Production service to add to ' + d.title);
        if (els.unitSel) els.unitSel.setAttribute('aria-label', 'Unit to add to ' + d.title);
        if (els.add) els.add.setAttribute('aria-label', 'Add to ' + d.title);
      });
    }

    days.forEach((d) => {
      const panel = dayPanels.get(d.id);
      if (!panel) return;
      const p = perDay.get(d.id) || { total: 0, hours: 0 };
      panel.querySelector('.day-items-total').textContent = fmt(p.total);
      const booked = bookedHours(d);
      const hint = panel.querySelector('.day-hours');
      const long = booked > 0 && booked - p.hours > 1e-9;
      hint.hidden = !long;
      hint.textContent = long ? 'Booked ' + hrsText(booked) + ', items cover ' + hrsText(p.hours).replace(/ hrs?$/, '') + '.' : '';
    });

    const list = $('prod-days');
    if (list) {
      const html = days.length
        ? days.map((d) => {
            const p = perDay.get(d.id) || { total: 0, count: 0, names: [] };
            return (
              '<li class="prod-day"><button type="button" class="prod-day-link" data-day="' + esc(d.id) + '">' +
              esc(d.title) + '</button>' + LSCCalendar.statusChip(d.status) +
              '<span class="prod-day-items">' +
              (p.count ? esc(p.names.join(', ')) : 'No items yet') + '</span>' +
              '<b class="prod-day-total">' + fmt(p.total) + '</b></li>'
            );
          }).join('')
        : '<li class="prod-days-empty">No production days yet. Book one in Production Booking above, or add ' +
          'a Date TBC day here.</li>';
      if (list.innerHTML !== html) list.innerHTML = html;
    }
    const group = $('prod-unassigned');
    if (group) group.hidden = unassigned === 0;
  }

  /* "incl. weekend ×1.5" under a surcharged line's price: the rows of
     calc.js surchargeAttribution, in its order, with the hours a partial
     share covered. Empty when nothing applied. */
  // Shared with the estimate detail, so both screens word a surcharge alike.
  const surNote = LSCRows.surchargeNote;

  /* An own-time item on auto has no price until the income floor exists, and
     the car's km row none until Overhead has its per-km cost (task 6b), so
     their options are disabled and say why, as a service unit's is
     (unitOptions). The browser selects the first option that isn't; with
     none, Add is off. */
  function travelSectionMarkup(pricing) {
    const defs = (pricing && pricing.travelRows) || [];
    const needs = LSCData.autoPriceBlocker().screen;
    const priced = defs.map((r) => cardSnap(r, 'hour') !== null);
    const options = defs.length
      ? defs.map((r, i) =>
          '<option value="' + esc(r.name) + '"' + (priced[i] ? '' : ' disabled') + '>' + esc(r.name) +
          (priced[i] ? '' : ' · no price yet, needs ' + esc(r.perKm ? 'Overhead' : needs)) + '</option>'
        ).join('')
      : '<option value="">No items — add one under Pricing</option>';
    const canAdd = priced.some(Boolean);

    return (
      '<div class="billing-block">' +
      '<div class="bb-head"><div><h2 class="bb-label">Travel &amp; Accommodation</h2>' +
      '<span class="bb-label-tag">Expenses</span></div>' +
      '<span class="bb-sum">Subtotal <b id="sum-travel">$0.00</b></span></div>' +
      '<div class="bb-picker"><select class="svc-select" id="sel-travel" aria-label="Travel item to add">' +
      options + '</select>' +
      '<button type="button" class="btn btn-accent btn-sm" id="add-travel"' + (canAdd ? '' : ' disabled') + '>+ Add Item</button></div>' +
      '<div class="gt-head expense-grid"><div>Service</div><div class="right">Qty / Cost</div>' +
      '<div class="right">Rate</div><div class="right">Mark-Up</div><div class="right">Client Bill</div><div></div></div>' +
      bodyMarkup('travel', 'No items added. Use the selector above to add one.') +
      '</div>'
    );
  }

  function costSectionMarkup(kind, label, addLabel, columns, emptyText) {
    return (
      '<div class="billing-block">' +
      '<div class="bb-head"><div><h2 class="bb-label">' + label + '</h2>' +
      '<span class="bb-label-tag">Expenses</span></div>' +
      '<span class="bb-sum">Subtotal <b id="sum-' + kind + '">$0.00</b></span></div>' +
      '<div class="bb-picker"><button type="button" class="btn btn-accent btn-sm" id="add-' + kind + '">' +
      addLabel + '</button></div>' +
      '<div class="gt-head expense-grid"><div>' + columns[0] + '</div><div class="right">' + columns[1] +
      '</div><div class="right">' + columns[2] + '</div><div class="right">—</div>' +
      '<div class="right">Total</div><div></div></div>' +
      bodyMarkup(kind, emptyText) +
      '</div>'
    );
  }

  function deliverablesSectionMarkup() {
    return (
      '<div class="billing-block" id="block-deliverables">' +
      '<div class="bb-head"><div><h2 class="bb-label">Deliverables</h2>' +
      '<span class="bb-label-tag">PROJECT OUTPUT</span></div>' +
      '<button type="button" class="btn btn-accent btn-sm" id="add-deliverables">+ Add Deliverable</button></div>' +
      '<div class="gt-head deliv-grid"><div>Deliverable Name</div><div>Format / Aspect Ratio</div>' +
      '<div>Duration / Length</div><div class="right">Qty</div><div></div></div>' +
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
      // The Production Booking block (production-booking task 6), filled by BookingBlock.mount.
      '<div id="booking-slot"></div>' +
      ratesBarMarkup() +
      // Where a line's unit switch is announced (switchUnit).
      '<p class="sr-only" id="editor-live" aria-live="polite"></p>' +
      // Where a day's surcharge changing is announced (announceSurcharges).
      '<p class="sr-only" id="sur-live" aria-live="polite"></p>';

    html += deliverablesSectionMarkup();
    sections.forEach((section) => {
      html += section.id === 'prod' && !section.archived ? prodSectionMarkup(section) : labourSectionMarkup(section);
    });
    html += travelSectionMarkup(pricing);
    html += costSectionMarkup('crew', 'External Crew &amp; Contracts', '+ Add Crew Member',
      ['Role / Name', 'Days', 'Day Rate'], 'No crew added. Click above to add a member.');
    html += costSectionMarkup('equip', 'Equipment Hire', '+ Add Equipment Item',
      ['Vendor / Item', 'Days', 'Cost/Day'], 'No equipment added. Click above to add an item.');

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
     then the Production section's unassigned ones — so they are every
     Production row in the form, in page order. A removed day's rows have left
     the page with its card. */
  function rowsIn(id) {
    if (id === 'prod') return Array.from(root.querySelectorAll('.gt-row[data-rid][data-section="prod"]'));
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

    activeRows.crew = rowsIn('crew').map((tr) => ({
      role: inputValue(tr, '.role-inp'),
      days: num(inputValue(tr, '.days-inp')),
      cost: num(inputValue(tr, '.cost-inp')),
    }));

    activeRows.equip = rowsIn('equip').map((tr) => ({
      vendor: inputValue(tr, '.vendor-inp'),
      days: num(inputValue(tr, '.days-inp')),
      cost: num(inputValue(tr, '.cost-inp')),
    }));

    activeRows.deliverables = rowsIn('deliverables').map((tr) => ({
      name: inputValue(tr, '.deliv-name-inp'),
      format: inputValue(tr, '.deliv-fmt-inp'),
      duration: inputValue(tr, '.deliv-dur-inp'),
      qty: num(inputValue(tr, '.deliv-qty-inp')) || 1,
    }));

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
    const perDay = new Map();
    let unassigned = 0;

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
        if (!day) {
          unassigned += 1;
          return;
        }
        const p = perDay.get(day.id) || { total: 0, hours: 0, count: 0, names: [] };
        p.total += bill || 0;
        p.hours += def ? num(line.qty) * LSCCalc.hoursPerUnitOf(def) : 0;
        p.count += 1;
        p.names.push(line.name);
        perDay.set(day.id, p);
      });
      setText('sum-' + section.id, fmt(subtotal));
    });
    paintDays(perDay, unassigned);
    paintShortNotice(days);

    let travelSubtotal = 0;
    rowsIn('travel').forEach((tr) => {
      const line = lineFrom(tr, false);
      travelSubtotal += paintRow(tr, travelBill(travelDef(line, pricing), line));
    });
    setText('sum-travel', fmt(travelSubtotal));

    ['crew', 'equip'].forEach((kind) => {
      let subtotal = 0;
      rowsIn(kind).forEach((tr) => {
        const line = {
          days: num(inputValue(tr, '.days-inp')),
          cost: num(inputValue(tr, '.cost-inp')),
        };
        subtotal += paintRow(tr, costBill(line));
      });
      setText('sum-' + kind, fmt(subtotal));
    });

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
    if (tr.querySelector('.lab-move')) addMoveControl(fresh); // still unassigned
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

  /* A Production line goes to its day's items when it has a day this estimate
     still has, and to "Unassigned — pick a day" otherwise (every line saved
     before task 7). Its stored surchargedPrice isn't read: the server stamps
     it again on save, and recalc shows what that will be. */
  function restoreRows(activeRows, pricing, days) {
    const dayIds = new Set((days || []).map((d) => String(d.id)));
    sections.forEach((section) => {
      (activeRows[section.id] || []).forEach((line) => {
        const tr = buildLabourRow(section, labourDef(section, line, pricing), line);
        if (section.id !== 'prod' || section.archived) return injectRow($('tbody-' + section.id), tr);
        if (line.dayId && dayIds.has(String(line.dayId))) {
          return injectRow(panelFor(String(line.dayId)).querySelector('.gt-body'), tr);
        }
        addMoveControl(tr);
        injectRow($('tbody-prod'), tr);
      });
    });
    (activeRows.travel || []).forEach((line) => {
      injectRow($('tbody-travel'), buildTravelRow(travelDef(line, pricing), line));
    });
    (activeRows.crew || []).forEach((line) => injectRow($('tbody-crew'), buildCostRow('crew', line)));
    (activeRows.equip || []).forEach((line) => injectRow($('tbody-equip'), buildCostRow('equip', line)));
    (activeRows.deliverables || []).forEach((line) =>
      injectRow($('tbody-deliverables'), buildDeliverableRow(line))
    );
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

    /* "Add to a day": to that day's picker, or to a new Date TBC day's. The
       day's own picker does the adding, so there is one way to add an item. */
    const goToDay = (dayId) => {
      if (!booking) return;
      booking.showDay(dayId);
      const panel = dayPanels.get(dayId);
      const target = panel && (panel.querySelector('.day-svc') || panel.querySelector('.qty-inp'));
      if (target) target.focus();
    };
    const dayGo = $('prod-day-go');
    if (dayGo) {
      dayGo.addEventListener('click', () => {
        const value = $('prod-day-sel').value;
        goToDay(value === NEW_TBC ? booking.addTbc() : value);
      });
      $('prod-days').addEventListener('click', (e) => {
        const link = e.target.closest('.prod-day-link');
        if (link) goToDay(link.dataset.day);
      });
    }

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

    $('add-travel').addEventListener('click', () => {
      const select = $('sel-travel');
      const defs = (pricing && pricing.travelRows) || [];
      const def = defs.find((r) => r.name === (select && select.value));
      if (!def) return;
      const picked = unitSnap('', def, 'hour');
      if (!picked.snap) return; // an own-time item with no floor yet — its option is disabled
      const tr = buildTravelRow(null, Object.assign({ name: def.name, qty: 0 }, picked.snap));
      markOwn(tr, picked);
      injectRow($('tbody-travel'), tr);
    });

    $('add-crew').addEventListener('click', () => injectRow($('tbody-crew'), buildCostRow('crew', {})));
    $('add-equip').addEventListener('click', () => injectRow($('tbody-equip'), buildCostRow('equip', {})));
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
    dayPanels.clear();
    // A fresh estimate: its first recalc is the baseline, announced as nothing.
    clearTimeout(surTimer);
    surAnnounced = null;
    holidays = null;
    holidaysLoading = null;
    refreshSurcharges = false;
    daysSig = null; // so the first paint builds the day selects

    root.innerHTML = formMarkup(estimate, pricing);
    restoreRows(activeRows, pricing, estimate && estimate.days);
    booking = BookingBlock.mount($('booking-slot'), {
      estimate,
      // Collapsed unless there is booking to show (D64).
      hasProductionItems: Array.isArray(activeRows.prod) && activeRows.prod.length > 0,
      // How this estimate's own tiles are labelled on the calendar, read live.
      identity: () => ({
        upid: $('f-upid').value.trim(),
        projectName: $('f-name').value.trim(),
        client: $('f-business').value.trim(),
      }),
      // A day's date, times or removal moves its items' prices.
      onChange: recalc,
      // Each day's production items (task 7), built here and kept across paints.
      itemsFor: (dayId) => panelFor(dayId),
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
