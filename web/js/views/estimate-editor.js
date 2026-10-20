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
 * break-even (pricing-floor P5): LSCCalc.minimumJobPrice() from the job's
 * direct costs and its hours at the income floor, no business profit, no card
 * fee. It is not persisted with the estimate, and neither it nor its "Show
 * minimum" tick is allowed to move clientPriceExGst or totalIncGst by a cent
 * in either position. Everything it needs is read off the totals computeTotals
 * already returned — it never recomputes a headline figure of its own. It says
 * whether this quote clears it or is under by $X, and never blocks a save or a
 * send. The (?) beside it opens the breakdown dialog: the hours split by where
 * the break-even year goes, plus direct costs (LSCCalc.minimumJobPriceParts).
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
 * SERVICE UNITS (2026-09-28, Project build archive/tracks/service-rate-tiers/)
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
 * PRODUCTION ITEMS LIVE ON DAYS (2026-10-02, Project build archive/tracks/production-booking/ task 7)
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
 * through one service menu ("Add production service items"). A line on no
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
  let barWatch = null; // the sticky bar's ResizeObserver: --ed-bar-h, what sticky feet sit above
  let handlers = null;
  let existing = null; // the estimate being edited, or null for a new one
  let copiedFrom = null; // { upid, name } when Duplicate just made this one (D60)
  let sections = []; // labour categories this form was built from
  let rowCounter = 0;
  let saving = false;
  let link = null; // { id, name } of the client record this estimate points at
  let baseline = ''; // the form as last saved (at mount, or by autosave), for the unsaved-edit check
  let followReady = false; // the form is restored: see fillFollowing
  let booking = null; // the Production Booking block (views/booking-block.js)

  /* Autosave (trip-planner task 8; see SAVING below). `auto` is the
     LSCAutosave instance while this is an unsent estimate, null in Save
     mode (sent, accepted: T14). */
  let auto = null;
  let autoMode = false; // drawn for autosave (status + Done) rather than Save
  let held = false; // an Undo or a delete has the estimate: autosave sends nothing
  let mountGen = 0; // which mount an autosave reply belongs to
  let session = ''; // X-LSC-Session: one per mount, for the server's snapshot throttle (I2)
  let baseUpdatedAt = null; // the updatedAt this editor last saw: sent as baseUpdatedAt
  let inFlight = null; // the snapshot an autosave is sending, until it lands
  let opened = null; // { at, body, surcharges }: the estimate as opened, for Undo changes since I opened this
  let savedSinceOpen = false;
  /* T17: autosave adds the client to the client list only once Business
     Name has been typed in and then left, never mid-word, and never just
     because an estimate opened with an unlinked name. */
  let businessTyped = false;
  let businessLeft = false;
  let refreshMark = 0; // counts Update to current rates, so a save only clears the one it sent

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
  let incomeFloor = null; // LSCData.incomeFloor(): the Minimum Job Price's hourly figure
  let breakEvenYear = null; // LSCData.revenueTarget(): the year that floor divides, for the (?)
  /* LSCData.priceContext(), for resolving a service's auto prices at a unit.
     Resolved at mount for the same reason as the three above. (Its GST
     settings are changed on the Settings screen, which replaces this one, so
     the next mount takes them.) */
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
  // X-LSC-Session: random, one per mount (I2). Not a secret, only a label.
  const newSession = () =>
    (window.crypto && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const $ = (id) => root.querySelector('#' + id);

  /* Is this editor still the screen on #main? A save or delete is async and the
     nav doesn't wait for it, so its outcome can land after the user has gone
     somewhere else — at which point neither the form's fields nor its error
     region exist any more, and following through would yank them off the screen
     they chose. */
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
     in the Price column and the closed select should read "per full day".
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
    // A travel line its day's trip writes (trip-planner task 4): days.js applyTripLines sets its qty.
    if (tr.dataset.fromTrip) line.fromTrip = tr.dataset.fromTrip;
    // The planner's two marks (B2-10): see planMarks().
    if (tr.dataset.capture) line.capture = tr.dataset.capture === 'true';
    // A tag whose deliverable has gone is dropped (the server refuses one: line_deliverable_unknown).
    if (tr.dataset.deliverableId && deliverableRow(tr.dataset.deliverableId)) line.deliverableId = tr.dataset.deliverableId;
    if (tr.dataset.postMultiplier !== undefined) line.postMultiplier = Number(tr.dataset.postMultiplier);
    if (tr.dataset.follows) line.follows = tr.dataset.follows === 'true';
    return line;
  }

  /* What a labour row carries for the post-production planner (B2-10), kept
     on the row like its snapshot and through every rebuild (reprice,
     Duplicate day): a production line's `capture`, taken from its card row
     when it was added from the menu, so the line keeps the tick it was added
     with (a line saved before B2 has none and follows the card: calc.js
     postPlan); and a post line's `deliverableId`, the deliverable it was laid
     out for. Neither prices anything.

     Since v19 (post-multipliers PM4) a post line laid out by a type also
     carries `postMultiplier`, its service's multiplier snapshotted when the
     type was picked (G8), and `follows`, whether recalc still fills its hours
     from capture (fillFollowing). A line saved before v19 has neither and
     never follows (G9). */
  function planMarks(tr, section, line) {
    if (section.id === 'prod' && typeof line.capture === 'boolean') tr.dataset.capture = String(line.capture);
    if (section.id !== 'post') return;
    if (line.deliverableId) tr.dataset.deliverableId = String(line.deliverableId);
    if (typeof line.postMultiplier === 'number' && Number.isFinite(line.postMultiplier) && line.postMultiplier >= 0) {
      tr.dataset.postMultiplier = String(line.postMultiplier);
    }
    if (typeof line.follows === 'boolean') tr.dataset.follows = String(line.follows);
  }

  const deliverableRow = (did) =>
    Array.from(root.querySelectorAll('#tbody-deliverables [data-did]')).find((tr) => tr.dataset.did === did) || null;

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
     "Qty / Cost", crew is "Days"/"Day rate", equipment is "Days"/"Cost/Day").
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
    planMarks(tr, section, line);
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
      '<div data-label="Service"' + (unitLine ? ' class="lab-svc"' : '') + '>' +
      /* A post line's "· Brand Story": the deliverable's current name, painted
         by paintPlanner (D95). In one span with the name, so it reads on the
         name's line rather than stacking under it in .lab-svc's column. */
      (section.id === 'post'
        ? '<span class="post-name">' + esc(line.name) + '<span class="post-tag" hidden></span></span>'
        : esc(line.name)) +
      unitLine + '</div>' +
      '<div class="right" data-label="' + qtyLabel + '"><input class="num-inp qty-inp" type="number" min="0" step="0.5" value="' +
      (line.qty || '') + '" aria-label="' + qtyLabel + ' for ' + esc(line.name) + '"></div>' +
      '<div class="right muted-td" data-label="Price">' + (def ? fmt(def.mu) : '—') + '</div>' +
      /* A Production line on a surcharged day says why its price is higher,
         under the price, owner-only (the client's copy never says it, D8). */
      '<div class="right' + (section.id === 'prod' ? ' bill-col' : '') + '" data-label="Client bill">' +
      '<span class="bill-cell">—</span>' + customCell +
      (section.id === 'prod' ? '<span class="sur-note" hidden></span>' : '') + '</div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove ' +
      esc(line.name) + '" aria-label="Remove ' + esc(line.name) + '">×</button></div>';

    /* Typing a following post line's hours makes them the owner's, for good
       (G2). Before bindRow, so the recalc it starts sees the line pinned. */
    if (section.id === 'post') {
      tr.querySelector('.qty-inp').addEventListener('input', () => {
        if (tr.dataset.follows === 'true') tr.dataset.follows = 'false';
      });
    }
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

    /* A line its day's trip writes (trip-planner task 4, T4): its quantity is
       the trip's, so it reads FROM TRIP, can't be typed in, and stays on its
       day (no Move to, no ×). Edit trip opens the travel view; its ⋯ has
       Unlink from trip (task 6). The server re-derives the quantity on save.
       An ordinary line carries a Link to trip button, shown by
       paintTripLinks() only while its day's trip could take it. */
    const linked = line.fromTrip === 'km' || line.fromTrip === 'hours' ? line.fromTrip : '';
    if (linked) tr.dataset.fromTrip = linked;
    const qtyName = perKm ? 'Kilometres' : linked ? 'Hours' : 'Quantity';

    tr.innerHTML =
      '<div data-label="Service">' + esc(line.name) +
      (linked
        ? '<div class="from-trip"><span class="from-trip-chip">From trip</span>' +
          '<button type="button" class="btn btn-quiet btn-sm from-trip-edit" aria-label="Edit trip for ' + esc(line.name) + '">Edit trip</button>' +
          '<button type="button" class="btn btn-quiet btn-sm from-trip-more" aria-haspopup="menu" aria-expanded="false" ' +
          'aria-label="More for ' + esc(line.name) + '"><span aria-hidden="true">⋯</span></button></div>'
        : '<button type="button" class="btn btn-quiet btn-sm trip-link" hidden></button>') +
      '</div>' +
      '<div class="right" data-label="' + (perKm ? 'Kilometres' : linked ? 'Hours' : 'Qty / Cost') + '"><input class="num-inp qty-inp" type="number" min="0" step="0.01" value="' +
      (line.qty || '') + '"' + (linked ? ' readonly' : '') + ' aria-label="' + qtyName + ' for ' + esc(line.name) +
      (linked ? ', from the trip' : '') + '"></div>' +
      '<div class="right muted-td" data-label="Rate">' + rateLabel + '</div>' +
      '<div class="right muted-td" data-label="Price">' + muLabel + '</div>' +
      '<div class="right" data-label="Client bill"><span class="bill-cell">—</span></div>' +
      '<div class="del-cell">' + (linked ? '' : '<button type="button" class="del-btn" title="Remove ' +
      esc(line.name) + '" aria-label="Remove ' + esc(line.name) + '">×</button>') + '</div>';

    if (linked) {
      tr.firstElementChild.classList.add('lab-svc');
      tr.querySelector('.from-trip-edit').addEventListener('click', () => {
        const dayId = rowDayId(tr);
        if (dayId) defineTravel(dayId);
      });
      const more = tr.querySelector('.from-trip-more');
      more.addEventListener('click', () => LSCMenu.open(more, {
        label: 'More for ' + line.name,
        items: [{ text: 'Unlink from trip', hint: 'Type its quantity yourself' }],
        onSelect: () => askUnlink(tr, more),
      }));
      return tr;
    }
    tr.querySelector('.trip-link').addEventListener('click', () => linkLine(tr));
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
    if (isEquip && LSCCalc.isOwnKit(line)) return buildKitRow(line);
    const legacy = isEquip && !Object.prototype.hasOwnProperty.call(line, 'item');
    const costCol = isEquip ? 'Cost/day' : 'Day rate';

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

  /* ── The owner's own kit (own-kit K5, K-D6–K-D9) ──────────────────────────
     A hire line for one of the owner's On-Set Kit assets, added from "Add
     On-Set Equipment" (openKitPicker). It bills days × its day rate like any
     hire, but calc.js counts it as income, not a pass-through (K4). Its rate
     is the asset's when it was added (K-D7): shown, not typed, and re-adding
     the asset is how to take a new one; "Update to current rates" leaves it
     alone, as it does all hire. It has no vendor, so it joins no rental and
     no vendor suggestion (K-D9). The asset's id and name ride on the row for
     collect(); they are for display only. */
  const isKitRow = (tr) => tr.dataset.ownKit === 'true';

  // The rows hired from a vendor: every equipment line but the owner's own kit.
  const hireRows = () => rowsIn('equip').filter((tr) => !isKitRow(tr));

  // What a crew or hire row charges a day: typed, or a kit row's snapshot.
  const costOf = (tr) => (isKitRow(tr) ? num(tr.dataset.cost) : num(inputValue(tr, '.cost-inp')));

  // The line a kit row saves as (the server's kitLineProblem shape), with no day: collect() adds it.
  function kitLineOf(tr) {
    return {
      ownKit: true,
      assetId: tr.dataset.assetId,
      assetName: tr.dataset.assetName,
      item: tr.dataset.assetName,
      vendor: '',
      days: num(inputValue(tr, '.days-inp')),
      cost: num(tr.dataset.cost),
    };
  }

  function buildKitRow(line) {
    const name = String(line.assetName || line.item || 'Own kit');
    const cost = Math.max(0, num(line.cost));
    const tr = document.createElement('div');
    tr.className = 'gt-row expense-grid kit-row';
    tr.dataset.rid = rid();
    tr.dataset.kind = 'equip';
    tr.dataset.ownKit = 'true';
    tr.dataset.assetId = String(line.assetId || '');
    tr.dataset.assetName = name;
    tr.dataset.cost = String(cost);
    const rateTip = 'Your day rate for ' + name + ' when it was added. To take a new rate, remove it and add it again.';
    tr.innerHTML =
      '<div data-label="Item"><p class="kit-name"><span class="kit-tag">Own kit</span>' +
      '<span class="kit-asset">' + esc(name) + '</span></p></div>' +
      '<div class="right" data-label="Days"><input class="num-inp days-inp" type="number" min="0" step="0.5" value="' +
      (line.days || '') + '" aria-label="Days for ' + esc(name) + '"></div>' +
      '<div class="right muted-td" data-label="Cost/day"><span class="kit-rate" title="' + esc(rateTip) + '">' +
      fmt(cost) + '<span class="sr-only"> a day, the rate when it was added</span></span></div>' +
      '<div class="right muted-td mu-cell">—</div>' +
      '<div class="right" data-label="Total"><span class="bill-cell">—</span></div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove ' + esc(name) +
      '" aria-label="Remove ' + esc(name) + '">×</button></div>';
    bindRow(tr, ['.days-inp']);
    addLineControls(tr, 'equip');
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

    /* A new type lays out its post services; leaving one takes its lines
       away first (B2-10, the brief's B2 Key Interactions 3). Cancelling that
       leaves the row on the type it had. */
    const sel = tr.querySelector('.deliv-type-sel');
    let was = sel.value;
    sel.addEventListener('change', () => {
      const value = sel.value;
      if (value === was) return;
      if (!dropTagged(tr, 'change')) {
        sel.value = was;
        return;
      }
      was = value;
      const t = value && !(savedGone && value === saved.typeId) ? types.find((x) => x.id === value) : null;
      if (!value || !t) {
        // None, or the removed type put back: its saved snapshot, with no services left to lay out.
        setType(value && savedGone && value === saved.typeId ? saved : null);
        return paintPlanner();
      }
      /* A v19 type has no type-wide multiplier: the row's is 0, and its lines'
         own (postMultiplier) plan it. Only a deliverable none of whose lines
         carries one plans from its row's (G9). */
      setType({ typeId: t.id, typeName: String(t.name || ''), multiplier: Number(t.multiplier) || 0 });
      // The type's name fills a blank Name; a name already typed is the owner's.
      const name = tr.querySelector('.deliv-name-inp');
      if (!name.value.trim()) name.value = String(t.name || '');
      layOutPost(tr, t);
    });

    /* A name prices nothing, but the planner and the post lines' tags read
       it. The quantity does price: its following post lines fill from it
       (PM4), so it recalculates. */
    tr.querySelector('.deliv-name-inp').addEventListener('input', () => paintPlanner());
    const qty = tr.querySelector('.deliv-qty-inp');
    qty.addEventListener('input', () => recalc());
    /* The saved quantity is never below 1 (collect's `|| 1`), so a cleared or
       0 field shows the 1 it will be saved, and planned, as. */
    qty.addEventListener('change', () => {
      if (!(num(qty.value) > 0)) {
        qty.value = '1';
        recalc();
      }
    });
    tr.querySelector('.del-btn').addEventListener('click', () => {
      const tagged = taggedRows(tr.dataset.did).length;
      if (dropTagged(tr, 'remove')) removeRow(tr, tagged ? 'and its ' + lineCount(tagged) : '');
    });
    return tr;
  }

  // ── The post-production planner (B2-10, D89–D96; post-multipliers PM4) ────
  /* The quote builds itself, the owner has the last word (post-multipliers,
     replacing B2's "suggest, don't price" for lines a type lays out). A typed
     deliverable lays its type's post services out in Post-Production, each
     tagged with the deliverable (`deliverableId`) and carrying its service's
     multiplier (`postMultiplier`, snapshotted, G8). A line priced by the hour
     `follows`: every recalc fills its hours from calc.js postPlan (capture ×
     multiplier × the deliverable's qty, up to the half hour, G1), and they are
     billed. Typing over them, or switching the line's unit, pins it for good
     (G2); re-picking the type lays fresh following lines. A line on another
     unit is laid out at 0 and never follows (G3). The planner cell heading
     the section shows Production Capture Hours and the hours recommended, and
     each deliverable its share, all from postPlan — the editor works none of
     it out. Lines at 0 never print (the 9a rule). */

  const postSectionLive = () => sections.find((s) => s.id === 'post' && !s.archived) || null;
  const taggedRows = (did) => rowsIn('post').filter((tr) => tr.dataset.deliverableId === did);
  const lineCount = (n) => n + ' post line' + (n === 1 ? '' : 's');

  function deliverableLabel(tr) {
    const name = inputValue(tr, '.deliv-name-inp').trim();
    return name || 'this deliverable';
  }

  /* Takes a deliverable's tagged post lines away, when its type changes or
     it is removed. Lines with hours are the owner's work, so they go only
     after a confirm naming how many; lines at 0 hrs just go. False: the
     owner said no, and nothing changed. */
  function dropTagged(tr, why) {
    const rows = taggedRows(tr.dataset.did);
    if (!rows.length) return true;
    const withHours = rows.filter((row) => num(inputValue(row, '.qty-inp')) > 0).length;
    const name = deliverableLabel(tr);
    if (withHours) {
      const ask = (why === 'change' ? 'Changing the type of ' + name + ' removes its post lines. ' : '') +
        withHours + ' of ' + (name === 'this deliverable' ? 'its' : name + '’s') + ' post lines ' +
        (withHours === 1 ? 'has' : 'have') + ' hours — remove ' + (rows.length === 1 ? 'it' : 'them') + '?';
      if (!window.confirm(ask)) return false;
    }
    rows.forEach((row) => row.remove());
    restoreEmpty($('tbody-post'));
    recalc();
    LSCUtil.announce($('editor-live'), 'Removed ' + lineCount(rows.length) + ' for ' + name + '.');
    return true;
  }

  /* A removeRow without the recalc, for several rows at once: the empty
     text back when the body has none left. */
  function restoreEmpty(body) {
    if (!body || !body.dataset.emptyText || body.querySelector('[data-rid]') || body.querySelector('.empty-row')) return;
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = body.dataset.emptyText;
    body.appendChild(empty);
  }

  /* The type's post services, onto Post-Production, tagged, each with its
     multiplier (calc.js typeServices). Each is priced as Add Service would
     price it (unitSnap), by the hour — or, when the hour has no price yet, the
     first unit that has one. An hourly line follows and the recalc below fills
     its hours; any other is laid out at 0 (G3). A service no longer on the
     card, or with no price at all, is skipped and named. */
  function layOutPost(tr, type) {
    const section = postSectionLive();
    const services = LSCCalc.typeServices(type)
      .map((s) => ({ name: s.name.trim(), multiplier: s.multiplier }))
      .filter((s) => s.name);
    const skipped = [];
    let added = 0;
    services.forEach(({ name: svc, multiplier }) => {
      const row = section && section.rows.find((r) => String(r.name || '').trim() === svc);
      const units = row && row.prices ? ['hour'].concat(LSCCalc.SERVICE_UNITS.filter((u) => u !== 'hour')) : ['hour'];
      const picked = row ? units.map((u) => unitSnap('post', row, u)).find((p) => p.snap) : null;
      if (!picked) {
        skipped.push(svc);
        return;
      }
      const line = buildLabourRow(section, null, Object.assign(
        { name: row.name, qty: 0, deliverableId: tr.dataset.did, postMultiplier: multiplier },
        picked.snap,
        { follows: unitKey(picked.snap) === 'hour' }));
      markOwn(line, picked);
      const body = $('tbody-post');
      const empty = body.querySelector('.empty-row');
      if (empty) empty.remove();
      body.appendChild(line);
      added += 1;
    });
    recalc();
    const name = deliverableLabel(tr);
    if (added) LSCUtil.announce($('editor-live'), 'Added ' + lineCount(added) + ' for ' + name + ' to Post-Production, hours filled from capture.');
    if (skipped.length) {
      Toast.error(
        (section ? 'Not on the Rate Card’s Post-Production any more, so not added: ' : 'There’s no Post-Production on the Rate Card, so not added: ') +
          skipped.join(', ') + '.'
      );
    }
  }

  // "10", "3.5", "12.25": hours as the planner shows them (no unit: its labels say hours).
  const planHrs = (n) => String(Math.round((Number(n) || 0) * 100) / 100);

  /* The planner cell, each deliverable's share, and every tag, from the form
     as it stands. recalc calls it with what it has just collected; the
     deliverables' own fields, which price nothing, call it alone. */
  function paintPlanner(active) {
    if (!root) return;
    const plan = LSCCalc.postPlan(active || collect(), LSCData.pricing());
    const delivs = rowsIn('deliverables');
    delivs.forEach((tr, i) => {
      const cell = tr.querySelector('.deliv-rec');
      const share = plan.shares[i];
      if (cell) cell.textContent = tr.dataset.typeId && share ? planHrs(share.hours) : '—';
    });

    const cell = $('post-plan');
    if (cell) {
      const typed = delivs.some((tr) => tr.dataset.typeId);
      cell.hidden = !(plan.captureHours > 0 || typed);
      setText('pp-capture', planHrs(plan.captureHours));
      setText('pp-rec', planHrs(plan.recommended));
      setText('pp-on', 'On post lines: ' + planHrs(plan.onPostLines) + ' of ' + planHrs(plan.recommended) + ' recommended');
    }

    // Each tag reads its deliverable's name now, so a rename follows (D95).
    const names = new Map(delivs.map((tr) => [tr.dataset.did, inputValue(tr, '.deliv-name-inp').trim()]));
    rowsIn('post').forEach((tr) => {
      const tag = tr.querySelector('.post-tag');
      if (!tag) return;
      const did = tr.dataset.deliverableId;
      const gone = !did || !names.has(did);
      tag.hidden = gone;
      tag.textContent = gone ? '' : '· ' + (names.get(did) || 'unnamed deliverable');
      tag.classList.toggle('is-unnamed', !gone && !names.get(did));
    });
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

  /* `also`: what went with it, said after its name ("and its 2 post lines"). */
  function removeRow(tr, also) {
    const body = tr.parentNode;
    if (!body) return;
    const emptyText = body.dataset.emptyText;
    // The × goes with the row, which would drop focus to the page (ui-clarity task 14).
    const hadFocus = tr.contains(document.activeElement);
    const name = rowName(tr);
    const sibling = (dir) => {
      let el = tr[dir];
      while (el && !el.matches('[data-rid]')) el = el[dir];
      return el;
    };
    const next = sibling('nextElementSibling') || sibling('previousElementSibling');
    tr.remove();
    if (emptyText && !body.querySelector('[data-rid]')) {
      const empty = document.createElement('div');
      empty.className = 'empty-row';
      empty.textContent = emptyText;
      body.appendChild(empty);
    }
    recalc();
    if (!hadFocus) return;
    focusIn(next || addControlOf(body));
    say((name || 'Line') + ' removed' + (also ? ' ' + also : '') + '.');
  }

  /* #editor-live, emptied first so a second "Video Capture removed." is
     still a change to announce. */
  function say(text) {
    const live = $('editor-live');
    if (!live) return;
    live.textContent = '';
    LSCUtil.announce(live, text);
  }

  /* Focus after a row comes or goes: the row that took its place (or the one
     above) at its first field, else the section's own way to add one. */
  function focusIn(el) {
    if (!el) return;
    const field = el.matches('input, select, textarea, button') ? el
      : el.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea, button:not(.del-btn):not([tabindex="-1"])');
    (field || el).focus();
  }

  function addControlOf(body) {
    const id = body.id.replace(/^tbody-/, '');
    return $('sel-' + id) || $('add-' + id) ||
      (body.closest('.panel') && body.closest('.panel').querySelector('.panel-toggle'));
  }

  function rowName(tr) {
    if (isKitRow(tr)) return tr.dataset.assetName;
    const typed = tr.querySelector('.deliv-name-inp, .role-inp, .vendor-inp, .item-inp');
    return ((typed && typed.value) || tr.dataset.name || '').trim();
  }

  /* A new row takes focus at the field it needs first (`at`), and says so. */
  function injectRow(body, tr, at) {
    if (!body) return;
    const empty = body.querySelector('.empty-row');
    if (empty) empty.remove();
    body.appendChild(tr);
    recalc();
    if (!at) return;
    const field = tr.querySelector(at);
    if (field) field.focus();
    say((rowName(tr) || 'A deliverable') + ' added.');
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
        '<button type="button" class="btn btn-sm" id="add-' + esc(section.id) + '">+ Add service</button></div>';

    /* A sub-section of the Services panel (task 11, U21), so an h3. Every
       one is labour there, so only an archived category is tagged. */
    const tag = section.archived ? '<span class="bb-label-tag">No longer on the rate card</span>' : '';

    return (
      '<div class="billing-block ed-sub" id="block-' + esc(section.id) + '">' +
      '<div class="bb-head"><div><h3 class="bb-label">' + esc(section.label) + '</h3>' + tag + '</div>' +
      '<span class="bb-sum">Subtotal <b id="sum-' + esc(section.id) + '">$0.00</b></span></div>' +
      (section.id === 'post' && !section.archived ? postPlanMarkup() : '') +
      picker +
      '<div class="gt-head labour-grid"><div>Service</div><div class="right">Qty</div>' +
      '<div class="right">Price</div><div class="right">Client bill</div><div></div></div>' +
      bodyMarkup(section.id, 'No services added. Use the selector above to add one.') +
      '</div>'
    );
  }

  /* The planner cell (B2-10, D93): two labelled figures and the comparison
     in words, not colour. Hidden until there is capture or a typed
     deliverable (paintPlanner). */
  function postPlanMarkup() {
    return (
      '<div class="post-plan" id="post-plan" hidden>' +
      '<dl class="pp-figs">' +
      '<div class="pp-fig"><dt>Production capture hours</dt><dd id="pp-capture">0</dd></div>' +
      '<div class="pp-fig pp-rec"><dt>Recommended Post Production Hours' +
      LSCInfo.markup({
        id: 'post-plan',
        label: 'How the recommended post-production hours are worked out',
        title: 'Recommended Post Production Hours',
        paragraphs: [
          'Production Capture Hours add up the hours of every Production line ticked <strong>Capture</strong> on ' +
            'the Rate Card, on every day. A line keeps the tick it was added with.',
          'Each deliverable with a type recommends capture hours × its type’s multiplier × its quantity, rounded ' +
            'up to the half hour. The recommendation is their sum.',
          'A guide, never a price: the hours you type on the post lines are what’s billed, and lines left at 0 hrs ' +
            'don’t print.',
        ],
      }) +
      '</dt><dd id="pp-rec">0</dd></div></dl>' +
      '<p class="pp-on" id="pp-on"></p></div>'
    );
  }

  // ── Production items on days (task 7) ─────────────────────────────────────

  // "Add to a day"'s option for a new Date TBC day. A space: no day id can hold one (days.js DAY_ID).
  const NEW_TBC = 'new tbc';

  const labourHead =
    '<div class="gt-head labour-grid"><div>Service</div><div class="right">Qty</div>' +
    '<div class="right">Price</div><div class="right">Client bill</div><div></div></div>';

  const prodSection = () => sections.find((s) => s.id === 'prod' && !s.archived) || null;

  /* A day card's line groups (B2-4, the IA's card order): each with the
     column heads of the section it belongs to, shown only when it has lines. */
  const DAY_GROUPS = [
    ['prod', 'Production', labourHead],
    ['travel', 'Travel', '<div class="gt-head expense-grid"><div>Service</div><div class="right">Qty / Cost</div>' +
      '<div class="right">Rate</div><div class="right">Price</div><div class="right">Client bill</div><div></div></div>'],
    ['crew', 'Crew', '<div class="gt-head expense-grid"><div>Role / Name</div><div class="right">Days</div>' +
      '<div class="right">Day rate</div><div class="right">—</div><div class="right">Total</div><div></div></div>'],
    ['equip', 'Equipment', '<div class="gt-head expense-grid"><div>Vendor · Item</div><div class="right">Days</div>' +
      '<div class="right">Cost/Day</div><div class="right">—</div><div class="right">Total</div><div></div></div>'],
  ];

  const OFF_DAY = BookingBlock.OFF;
  const groupBody = (panel, kind) => panel.querySelector('.gt-body[data-group="' + kind + '"]');

  /* One card's items: "Add production service items", which opens the service
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
      (off ? 'Add items' : 'Add production service items') + '</button>' +
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
  /* "Add production service items" on a card opens one menu, the editor's
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
    // No Rate Card list for crew or gear (D77): a typed row each. Gear also
    // takes the owner's own kit, from its pop-up (own-kit K5).
    return kind === 'crew'
      ? '<button type="button" class="btn btn-ghost btn-sm dm-blank" data-add="crew">+ Add crew member</button>'
      : '<div class="dm-blanks"><button type="button" class="btn btn-ghost btn-sm dm-blank" data-add="equip">+ Add hire item</button>' +
        '<button type="button" class="btn btn-ghost btn-sm dm-blank dm-kit" aria-haspopup="dialog">+ Add On-Set Equipment</button></div>';
  }

  /* The menu's foot: "Define travel", or for a day with a trip "Edit travel",
     with its km once it has a route ("Edit travel · 186 km"). */
  function travelLabel(dayId) {
    const s = booking ? TripPlanner.summary(booking.tripOf(dayId)) : null;
    if (!s) return 'Define travel';
    return s.km ? 'Edit travel · ' + s.km : 'Edit travel';
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
      // A day's trip (trip-planner T8): the menu's fixed foot. Not on a day has none (T2).
      (menu.target === OFF_DAY
        ? ''
        : '<div class="dm-foot"><button type="button" class="btn dm-travel">' + esc(travelLabel(menu.target)) +
          '<span class="dm-travel-go" aria-hidden="true">→</span></button></div>') +
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
    /* Equipment Hire starts open when there is kit to add, so "+ Add On-Set
       Equipment" isn't two taps deep; once the group is toggled, that choice
       stands (menu.open keeps it). */
    else if (menu.open.equip === undefined && kitAssets().ready.length) menu.open.equip = true;
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

  /* The window crossed 768 with the menu open (a tablet turned, a window
     resized): open it again in the other form, on the same card, with what
     it had added (its count; the last "Added …" isn't said again). Going to
     the sheet takes focus, as the sheet is modal; going to the column takes
     it only from inside the menu. */
  function onMenuModeChange() {
    if (!menu.el || menu.sheet === narrow()) return;
    // Left open in a column when another screen replaced the editor: it goes, it doesn't come back as a sheet.
    if (!onScreen() || !menu.el.isConnected) return closeMenu(false);
    const { target, trigger, count } = menu;
    const inside = menu.el.contains(document.activeElement);
    const was = document.activeElement;
    closeMenu(false);
    openMenu(target, trigger);
    menu.count = count;
    paintMenuCount();
    if (!menu.sheet && !inside && was && was.isConnected) was.focus({ preventScroll: true });
  }
  window.matchMedia('(max-width: 767px)').addEventListener('change', onMenuModeChange);

  // ── The travel view (trip-planner task 2, T8, I1) ──────────────────────────
  /* A day's service menu → Define travel opens that day's travel view in the
     Production booking panel's body (BookingBlock.showTrip; TripPlanner draws
     it). It has an address, `?trip=<dayId>` on this screen's own path: a
     reload reopens it, and Back, the view's or the browser's, closes it and
     reopens the day's menu with focus on Define travel.

     The address moves without re-rendering the editor (LSCRouter.mark), and
     the editor claims Back and Forward between its own `?trip` addresses
     (LSCRouter.claim), so nothing typed is lost and the unsaved guard isn't
     asked. An unknown day id in the address is dropped with a replace. */
  const trip = { view: null, pushed: false };

  /* This screen's address with `?trip` set to dayId, or without it. */
  function tripAddress(dayId) {
    const here = LSCRouter.current() || LSCRouter.parse(location.hash);
    const query = new URLSearchParams(here.query);
    if (dayId) query.set('trip', dayId);
    else query.delete('trip');
    const qs = query.toString();
    return here.path + (qs ? '?' + qs : '');
  }

  const dayOf = (dayId) => (booking && dayId ? booking.list().find((d) => d.id === dayId) : null) || null;

  /* Draws the view for dayId. False for a day this estimate doesn't have. */
  function openTrip(dayId) {
    const day = dayOf(dayId);
    if (!day) return false;
    if (trip.view && trip.view.dayId === dayId) return true;
    dropTripView();
    closeMenu(false);
    trip.view = TripPlanner.mount({
      day,
      trip: booking.tripOf(dayId),
      /* Each placed, changed or removed stop, and each route that comes back:
         the day's trip and its two linked lines written from it, then
         saved by autosave (task 8: recalc() touches it) on an unsent
         estimate, or by Save on a sent one. */
      onChange: (next) => {
        // A stop's Undo can come from a toast after the editor has gone.
        if (!booking || !onScreen()) return;
        booking.setTrip(dayId, next);
        syncTripLines(dayId, next);
      },
      lines: () => tripLinesInfo(dayId),
      onClear: (opener) => clearTrip(dayId, opener),
      onBack: leaveTrip,
    });
    booking.showTrip(trip.view.el);
    trip.view.el.scrollIntoView({ block: 'start' });
    trip.view.focus();
    return true;
  }

  /* ── The lines a trip writes (trip-planner tasks 4 and 6, T3, T4, T7) ──
     While a day's trip has a route (one leg or more), its travel group holds
     one line of each kind the Rate Card can price: km on the first per-km
     row, drive time on the first own-time row (calc.js tripKindOf), each
     marked `fromTrip` with its quantity from the trip (calc.js tripLineQty:
     km up to the whole km, minutes up to the quarter hour). A line is made
     the first time it's needed, priced as one added from the menu is
     (unitSnap, markOwn), and after that only its quantity follows the trip.
     With no route (a start alone, or no trip) the linked lines go: they
     would bill nothing. A row with no price yet adds no line; the trip's
     totals say why (tripLinesInfo). The server derives the same quantities
     on save (days.js applyTripLines), so this only has to be right for
     what's on screen in between.

     UNLINK (task 6): a linked line's ⋯ → Unlink from trip, after a confirm.
     It keeps its quantity as an ordinary line, and the kind goes on the
     trip's `unlinked` list, so the trip makes no new line of that kind. An
     ordinary line of a kind the trip bills (an unlinked one, or one typed
     before the trip) shows Relink / Link to trip while the trip has a route
     and no linked line of that kind: it takes the trip's quantity, and the
     kind comes off the list. */
  const tripHasRoute = (t) => Boolean(t && Array.isArray(t.legs) && t.legs.length > 0);
  const TRIP_KINDS = ['km', 'hours'];
  const KIND_NAME = { km: 'Vehicle km', hours: 'Drive time' };
  const unlinkedOf = (t) => (t && Array.isArray(t.unlinked) ? t.unlinked : []);
  const travelBody = (dayId) => groupBody(panelFor(dayId), 'travel');
  const linkedRows = (dayId, kind) => Array.from(travelBody(dayId).querySelectorAll(':scope > [data-from-trip="' + kind + '"]'));

  /* Which kind of trip line a travel row could be: its snapshot's, or (a
     line with no snapshot: saved before them, or its row has no price yet)
     its card row's. */
  function rowTripKind(tr) {
    return LSCCalc.tripKindOf(snapOf(tr) || cardRowFor('', null, tr.dataset.name));
  }

  function syncTripLines(dayId, t) {
    const body = travelBody(dayId);
    if (!body) return;
    const defs = (LSCData.pricing() || {}).travelRows || [];
    let moved = false;
    TRIP_KINDS.forEach((kind) => {
      const linked = linkedRows(dayId, kind);
      if (!tripHasRoute(t)) {
        linked.forEach(removeRow);
        return;
      }
      linked.slice(1).forEach(removeRow); // one per kind; the server would unlink a second
      const qty = LSCCalc.tripLineQty(t, kind);
      if (linked[0]) {
        const input = linked[0].querySelector('.qty-inp');
        if (num(input.value) !== qty) {
          input.value = qty ? String(qty) : '';
          moved = true;
        }
        return;
      }
      if (unlinkedOf(t).indexOf(kind) !== -1) return; // the owner bills this one as typed
      const row = defs.find((r) => LSCCalc.tripKindOf(r) === kind);
      const picked = row ? unitSnap('', row, 'hour') : null;
      if (!picked || !picked.snap) return;
      const tr = buildTravelRow(null, Object.assign({ name: row.name, qty, fromTrip: kind }, picked.snap));
      markOwn(tr, picked);
      injectRow(body, tr);
    });
    if (moved) recalc();
  }

  /* What the trip's totals list (TripPlanner's lines()): each linked line
     as the editor prices it; an unlinked kind's line, billed as typed; or
     why there isn't one. And any other line typed by hand on the same day
     of a kind the trip bills, which could charge the same road twice. */
  function tripLinesInfo(dayId) {
    const out = { lines: [], typed: [] };
    const t = booking ? booking.tripOf(dayId) : null;
    if (!tripHasRoute(t)) return out;
    const pricing = LSCData.pricing();
    const defs = (pricing && pricing.travelRows) || [];
    const rows = Array.from(travelBody(dayId).querySelectorAll(':scope > [data-rid]'));
    const billOf = (tr) => {
      const line = lineFrom(tr, false);
      const bill = travelBill(travelDef(line, pricing), line);
      return { line, bill: bill === null ? 'no price' : fmt(bill) };
    };
    const shown = (tr, kind, note) => {
      const { line, bill } = billOf(tr);
      const qty = num(line.qty);
      out.lines.push(Object.assign({ name: line.name, qty: kind === 'km' ? qty.toLocaleString('en-AU') + ' km' : qty + ' h', bill },
        note ? { note } : {}));
    };
    TRIP_KINDS.forEach((kind) => {
      const tr = rows.find((r) => r.dataset.fromTrip === kind);
      const typed = rows.filter((r) => !r.dataset.fromTrip && rowTripKind(r) === kind);
      const unlinked = !tr && unlinkedOf(t).indexOf(kind) !== -1;
      if (tr) {
        shown(tr, kind);
      } else if (unlinked && typed.length) {
        /* The line unlinked in this session is marked; after a reload, the
           last one (a trip's lines are added after any typed before it). */
        const was = typed.find((r) => r.dataset.tripUnlinked === kind) || typed[typed.length - 1];
        typed.splice(typed.indexOf(was), 1);
        shown(was, kind, KIND_NAME[kind] + ' unlinked: billed as typed.');
      } else if (unlinked) {
        out.lines.push({ missing: KIND_NAME[kind] + ' unlinked, and there’s no line for it on this day.' });
      } else {
        const row = defs.find((r) => LSCCalc.tripKindOf(r) === kind);
        const what = kind === 'km' ? 'No km line' : 'No drive-time line';
        let why;
        if (!row) why = kind === 'km' ? 'the Rate Card has no per-km travel item.' : 'the Rate Card has no travel item billed as your time.';
        else if (kind === 'km') why = row.name + ' has no price yet. Set the vehicle’s running costs on Overhead.';
        else why = row.name + ' has no price yet: it needs ' + LSCData.autoPriceBlocker().screen + '.';
        out.lines.push({ missing: what + ': ' + why });
      }
      typed.forEach((r) => out.typed.push({ name: r.dataset.name, bill: billOf(r).bill }));
    });
    return out;
  }

  /* A travel row rebuilt as the same line, linked as `fromTrip` (a kind) or
     ordinary (null), at `qty` when given: its snapshot, unit and rate marks
     go with it, as a Duplicate's do. */
  function relinkRow(tr, fromTrip, qty) {
    const line = lineFrom(tr, false);
    delete line.dayId;
    delete line.fromTrip;
    if (fromTrip) line.fromTrip = fromTrip;
    if (qty !== undefined) line.qty = qty;
    const fresh = buildTravelRow(travelDef(line, LSCData.pricing()), line);
    if (tr.dataset.prevSnap) fresh.dataset.prevSnap = tr.dataset.prevSnap;
    if (tr.dataset.lastOnly) fresh.dataset.lastOnly = tr.dataset.lastOnly;
    tr.replaceWith(fresh);
    return fresh;
  }

  /* The day's trip with a kind on or off its unlinked list. */
  function setUnlinked(dayId, kind, on) {
    const t = booking.tripOf(dayId);
    if (!t) return;
    const kinds = new Set(unlinkedOf(t));
    if (on) kinds.add(kind);
    else kinds.delete(kind);
    const next = Object.assign({}, t);
    if (kinds.size) next.unlinked = TRIP_KINDS.filter((k) => kinds.has(k));
    else delete next.unlinked;
    booking.setTrip(dayId, next);
  }

  function askUnlink(tr, opener) {
    const dayId = rowDayId(tr);
    const kind = tr.dataset.fromTrip;
    if (!dayId || !kind) return;
    const qty = num(inputValue(tr, '.qty-inp'));
    const qtyText = kind === 'km' ? qty.toLocaleString('en-AU') + ' km' : qty + ' h';
    tripDialog(opener, {
      title: 'Unlink ' + tr.dataset.name + ' from the trip?',
      body: 'It stays at ' + qtyText + ', and its quantity becomes yours to type. The trip stops updating it; ' +
        'Relink to trip puts the trip’s figure back.',
      actions: [{ label: 'Unlink', cls: 'btn-accent', run: () => {
        const fresh = relinkRow(tr, null);
        fresh.dataset.tripUnlinked = kind; // the one the totals call unlinked
        setUnlinked(dayId, kind, true);
        recalc();
        const input = fresh.querySelector('.qty-inp');
        if (input) input.focus();
        LSCUtil.announce($('editor-live'), fresh.dataset.name + ' unlinked from the trip: billed as typed.');
        return false; // focus is placed; the dialog doesn't hand it back
      } }],
    });
  }

  function linkLine(tr) {
    const dayId = rowDayId(tr);
    const kind = rowTripKind(tr);
    const t = dayId && booking ? booking.tripOf(dayId) : null;
    if (!kind || !tripHasRoute(t) || linkedRows(dayId, kind).length) return;
    const qty = LSCCalc.tripLineQty(t, kind);
    const fresh = relinkRow(tr, kind, qty);
    setUnlinked(dayId, kind, false);
    recalc();
    const more = fresh.querySelector('.from-trip-more');
    if (more) more.focus();
    LSCUtil.announce($('editor-live'), fresh.dataset.name + ' linked to the trip: ' +
      (kind === 'km' ? qty + ' km' : qty + ' hours') + ', ' + fresh.querySelector('.bill-cell').textContent + '.');
  }

  /* Each ordinary travel line's Link to trip: shown while its day's trip has
     a route and no linked line of its kind. "Relink" when it's the kind the
     owner unlinked. Run from recalc(), which follows every change to lines
     and days. */
  function paintTripLinks() {
    if (!booking) return;
    rowsIn('travel').forEach((tr) => {
      const btn = tr.querySelector('.trip-link');
      if (!btn) return;
      const dayId = rowDayId(tr);
      const t = dayId ? booking.tripOf(dayId) : null;
      const kind = rowTripKind(tr);
      const can = Boolean(kind && tripHasRoute(t) && !linkedRows(dayId, kind).length);
      btn.hidden = !can;
      if (!can) return;
      const again = unlinkedOf(t).indexOf(kind) !== -1;
      btn.textContent = again ? 'Relink to trip' : 'Link to trip';
      btn.setAttribute('aria-label', (again ? 'Relink ' : 'Link ') + tr.dataset.name + ' to the trip');
    });
  }

  /* Clear trip (the travel view's ⋯, T7): the stops, details and route go.
     With linked lines on the day, the dialog asks whether they go too
     (Remove) or stay as ordinary lines at their quantities (Keep). The view
     is then drawn afresh, empty. */
  function clearTrip(dayId, opener) {
    const pricing = LSCData.pricing();
    const linked = TRIP_KINDS.flatMap((k) => linkedRows(dayId, k));
    const sum = linked.reduce((total, tr) => {
      const line = lineFrom(tr, false);
      return total + (travelBill(travelDef(line, pricing), line) || 0);
    }, 0);
    const done = (keep) => {
      if (keep) linked.forEach((tr) => relinkRow(tr, null));
      booking.setTrip(dayId, null);
      syncTripLines(dayId, null); // with keep, nothing linked is left to remove
      recalc();
      dropTripView();
      openTrip(dayId);
      LSCUtil.announce($('editor-live'), 'Trip cleared' +
        (linked.length ? (keep ? ', its travel lines kept as ordinary lines.' : ', with its travel lines.') : '.'));
      return false;
    };
    const n = linked.length;
    tripDialog(opener, n
      ? {
        title: 'Clear the trip?',
        body: 'Its stops, their details and the route go. Also remove the ' + (n === 1 ? 'travel line' : n + ' travel lines') +
          ' it added? (' + fmt(sum) + ')',
        actions: [
          { label: 'Keep as ordinary lines', cls: 'btn-ghost', run: () => done(true) },
          { label: 'Remove', cls: 'btn-danger', run: () => done(false) },
        ],
      }
      : {
        title: 'Clear the trip?',
        body: 'Its stops, their details and the route go.',
        actions: [{ label: 'Clear trip', cls: 'btn-danger', run: () => done(false) }],
      });
  }

  // ── The trip's dialog (Unlink, Clear trip) ──
  /* One overlay (#modal-trip), the app's focus trap (modal.js), Escape and
     the backdrop cancel. actions: [{ label, cls, run }], drawn after Cancel;
     run() closes it, and returning false means it placed focus itself. */
  const tripDlg = { overlay: null, opener: null };

  function onTripDlgKeydown(event) {
    if (!tripDlg.overlay || tripDlg.overlay.closest('[hidden]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeTripDialog(true);
      return;
    }
    LSCModal.trapTab(tripDlg.overlay, event);
  }
  function onTripDlgClick(event) {
    if (event.target === tripDlg.overlay) closeTripDialog(true);
  }

  function closeTripDialog(returnFocus) {
    const o = tripDlg.overlay;
    if (!o || !o.classList.contains('open')) return;
    o.classList.remove('open');
    o.innerHTML = '';
    document.removeEventListener('keydown', onTripDlgKeydown, true);
    o.removeEventListener('click', onTripDlgClick);
    if (returnFocus && tripDlg.opener && tripDlg.opener.isConnected) tripDlg.opener.focus();
    tripDlg.opener = null;
  }

  function tripDialog(opener, opts) {
    tripDlg.overlay = document.getElementById('modal-trip');
    if (!tripDlg.overlay) return;
    closeTripDialog(false);
    tripDlg.opener = opener || null;
    tripDlg.overlay.innerHTML =
      '<div class="modal-box trip-dialog" role="dialog" aria-modal="true" aria-labelledby="tripd-title" aria-describedby="tripd-desc">' +
      '<h2 class="modal-title" id="tripd-title">' + esc(opts.title) + '</h2>' +
      '<p class="tripd-desc" id="tripd-desc">' + esc(opts.body) + '</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" data-i="-1">Cancel</button>' +
      opts.actions.map((a, i) => '<button type="button" class="btn ' + a.cls + '" data-i="' + i + '">' + esc(a.label) + '</button>').join('') +
      '</div></div>';
    tripDlg.overlay.classList.add('open');
    // Captured, so Escape here doesn't also close the travel view's menus or sheet.
    document.addEventListener('keydown', onTripDlgKeydown, true);
    tripDlg.overlay.addEventListener('click', onTripDlgClick);
    tripDlg.overlay.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      if (i < 0) return closeTripDialog(true);
      const back = tripDlg.opener;
      closeTripDialog(false);
      if (opts.actions[i].run() !== false && back && back.isConnected) back.focus();
    }));
    // Cancel first: the safe choice has focus.
    tripDlg.overlay.querySelector('[data-i="-1"]').focus();
  }

  function dropTripView() {
    if (!trip.view) return;
    trip.view.destroy();
    trip.view = null;
    if (booking) booking.hideTrip();
  }

  /* The view goes, and the day's menu comes back with focus on Define travel
     (the brief's Back). A day that has gone in the meantime just closes. */
  function closeTrip() {
    const dayId = trip.view && trip.view.dayId;
    dropTripView();
    trip.pushed = false;
    if (!dayOf(dayId)) return;
    const panel = panelFor(dayId);
    openMenu(dayId, panel && panel.querySelector('.day-menu-btn'));
    const travel = menu.el && menu.el.querySelector('.dm-travel');
    if (travel) travel.focus({ preventScroll: !menu.sheet });
  }

  /* Writing bookings to Google (trip-planner task 14). The server writes a
     saved day to the calendar a few seconds after the save, so its reply can
     only say a day is waiting. Look again a few times for one Google refused,
     and mark that day's card (a quiet line with Try again). Nothing here
     touches the form or the saved copy: only the card's mark. */
  let syncLooks = 0;
  let syncTimer = null;
  let syncState = {}; // { dayId: 'pending' | 'error' } as last heard
  function watchGoogleSync(fromReply, delay) {
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    const pending = (map) => Object.keys(map || {}).some((id) => map[id] === 'pending');
    if (fromReply) {
      syncLooks = 0;
      syncState = fromReply;
      if (booking) booking.setSync(fromReply);
      if (!pending(fromReply)) return;
    }
    if (syncLooks >= 3 || !existing) return;
    syncLooks += 1;
    const gen = mountGen;
    syncTimer = setTimeout(async () => {
      syncTimer = null;
      if (gen !== mountGen || !onScreen() || !existing) return;
      let map = null;
      try {
        map = (await LSCApi.get(estimateUrl())).estimate.googleSync;
      } catch (err) {
        if (!(err instanceof LSCApi.ApiError)) throw err;
        return; // the page isn't the place to fuss about a calendar
      }
      if (gen !== mountGen || !booking) return;
      syncState = map || {};
      booking.setSync(syncState);
      if (pending(syncState)) watchGoogleSync(null);
    }, delay || 8000);
  }

  async function retryGoogleSync(dayId) {
    try {
      await LSCApi.post('/api/google/sync', {});
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') { handlers.onAuthLost({ keepScreen: true }); return; }
      Toast.error(
        err.code === 'google_not_connected' ? 'Google Calendar isn’t connected. Connect it in Settings.'
          : err.code === 'google_reconnect' ? 'Google no longer accepts the connection. Connect again in Settings.'
            : 'Couldn’t ask Google just now. Try again in a moment.'
      );
      return;
    }
    Toast.ok('Trying Google Calendar again.');
    // Marks clear at once; the look in a few seconds says whether it took.
    const again = {};
    Object.keys(syncState).forEach((id) => { again[id] = 'pending'; });
    if (dayId) again[dayId] = 'pending';
    watchGoogleSync(again);
  }

  function defineTravel(dayId) {
    if (!dayOf(dayId)) return;
    if (!LSCRouter.mark(tripAddress(dayId))) return;
    trip.pushed = true;
    openTrip(dayId);
  }

  /* Back in the view: the browser's own Back when this view pushed the
     entry (so Forward reopens it), otherwise (a reload, a link) the address
     loses `?trip` in place. Either way closeTrip() runs once. */
  function leaveTrip() {
    if (trip.pushed) {
      history.back();
      return;
    }
    LSCRouter.mark(tripAddress(null), { replace: true });
    closeTrip();
  }

  /* LSCRouter.claim: Back, Forward or a typed `?trip` on this screen. */
  function onTripRoute(route) {
    if (!booking || !onScreen()) return false;
    const want = route.query.get('trip') || null;
    const showing = trip.view ? trip.view.dayId : null;
    if (want === showing) return true;
    if (!want) {
      closeTrip();
      return true;
    }
    // Forward onto a trip this view pushed earlier counts as pushed again.
    if (openTrip(want)) trip.pushed = true;
    // A day this estimate doesn't have: dropped once the router has recorded the move (LSCRouter.claim).
    else queueMicrotask(() => LSCRouter.mark(tripAddress(null), { replace: true }));
    return true;
  }

  function bindMenu(el) {
    el.querySelector('.day-menu-done').addEventListener('click', () => closeMenu(true));
    const travel = el.querySelector('.dm-travel');
    if (travel) travel.addEventListener('click', () => defineTravel(menu.target));
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
      const kitBtn = e.target.closest('.dm-kit');
      if (kitBtn) return openKitFromMenu(kitBtn);
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
      // Capture is snapshotted from the card row as the line is added (B2-10, D89).
      tr = buildLabourRow(section, null, Object.assign({ name: row.name, qty: 1, capture: row.capture === true }, picked.snap));
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

  // ── Add On-Set Equipment (own-kit K5, K-D8) ───────────────────────────────
  /* A pop-up over the owner's On-Set Kit: each asset whose Recovery is On-Set
     Kit, with a day rate, not sold or written off (Finance → Overhead →
     Depreciation is where each gets one). Tick any number; Add puts one kit
     line per tick on the card it was opened for, at the asset's day rate now
     (buildKitRow snapshots it). Opened from a day card's service menu it adds
     to that day, 1 day each; from Equipment Hire's summary it adds to Not on a
     day, at the estimate's number of days (at least 1). "Days each" is the one
     field for the batch; each line's Days is its own after. An asset already
     on the estimate says so, and can still be added for another day.

     A dialog with the app's focus trap (LSCModal): Escape, Cancel or a click
     outside closes it with nothing added, focus back where it came from. From
     the phone's bottom sheet the sheet closes first: two modals don't stack. */
  const picker = { overlay: null, opener: null, target: null };

  /* The assets the pop-up lists (`ready`, A–Z) and how many kit assets it
     leaves out for having no day rate yet. $0 is a rate the owner set; blank
     is none (K1), read as the register reads it. */
  function kitAssets() {
    // Above $0: a $0 kit asset would bill nothing while out of the reserve (depreciation.js recoveryGap).
    const rated = (a) => {
      const rate = LSCCalc.numOrNull(a.dayRate);
      return rate !== null && rate > 0;
    };
    const kitOnes = LSCData.depreciationAssets().filter((a) => LSCCalc.isKitHire(a) && !a.disposalDate);
    return {
      ready: kitOnes.filter(rated).sort((x, y) =>
        String(x.name || '').localeCompare(String(y.name || ''), undefined, { sensitivity: 'base' })),
      unrated: kitOnes.filter((a) => !rated(a)).length,
    };
  }

  function onPickerKeydown(event) {
    if (!picker.overlay || picker.overlay.closest('[hidden]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return closeKitPicker(true);
    }
    LSCModal.trapTab(picker.overlay, event);
  }
  function onPickerClick(event) {
    if (event.target === picker.overlay) closeKitPicker(true);
  }

  function closeKitPicker(returnFocus) {
    const o = picker.overlay;
    if (!o || !o.classList.contains('open')) return;
    o.classList.remove('open');
    o.innerHTML = '';
    document.removeEventListener('keydown', onPickerKeydown);
    o.removeEventListener('click', onPickerClick);
    const opener = picker.opener;
    picker.opener = null;
    picker.target = null;
    if (returnFocus && opener && opener.isConnected) opener.focus();
  }

  /**
   * @param {string} key — the card to add to: a day id, or OFF_DAY.
   * @param {HTMLElement} opener — where focus goes back to.
   * @param {number} days — "Days each" to start with.
   */
  function openKitPicker(key, opener, days) {
    const overlay = document.getElementById('modal-own-kit');
    if (!overlay || !booking) return;
    closeKitPicker(false);
    picker.overlay = overlay;
    picker.opener = opener || null;
    picker.target = key;

    const { ready, unrated } = kitAssets();
    const onEstimate = new Set(rowsIn('equip').filter(isKitRow).map((tr) => tr.dataset.assetId));
    // The card's own subtitle for Not on a day: "Adding to Not on a day" read as a typo.
    const where = key === OFF_DAY ? 'Not tied to a shoot day' : 'Adding to ' + cardName(key);
    const unratedNote = unrated
      ? '<p class="kp-note">' + plural(unrated, 'kit asset has', 'kit assets have') + ' no day rate yet, or a $0 one, so ' +
        (unrated === 1 ? 'it isn’t' : 'they aren’t') + ' listed. Give ' + (unrated === 1 ? 'it' : 'each') +
        ' one in Finance → Overhead → Depreciation.</p>'
      : '';

    const list = ready.map((a) => {
      const id = 'kp-a-' + String(a.id).replace(/[^A-Za-z0-9_-]/g, '');
      const added = onEstimate.has(String(a.id));
      return '<li class="kp-item"><input type="checkbox" class="kp-check" id="' + id + '" value="' + esc(a.id) + '"' +
        (added ? ' aria-describedby="' + id + '-added"' : '') + '>' +
        '<label class="kp-row" for="' + id + '">' +
        '<span class="kp-main"><span class="kp-name">' + esc(kitName(a)) + '</span>' +
        '<span class="kp-meta">' + esc(DepreciationView.categoryLabel(a.category)) +
        (added ? '<span class="kp-tag" id="' + id + '-added">Already added</span>' : '') + '</span></span>' +
        '<span class="kp-rate">' + fmt(LSCCalc.numOrNull(a.dayRate)) + '<span class="kp-per"> a day</span></span>' +
        '</label></li>';
    }).join('');

    overlay.innerHTML =
      '<div class="modal-box kp-box" role="dialog" aria-modal="true" aria-labelledby="kp-title" aria-describedby="kp-where">' +
      '<p class="ad-eyebrow" id="kp-where">' + esc(where) + '</p>' +
      '<h2 class="modal-title" id="kp-title">Add On-Set Equipment</h2>' +
      (ready.length
        ? '<p class="kp-intro">Your own gear, billed at its day rate. It counts as your income, not a cost passed through.</p>' +
          '<fieldset class="kp-set"><legend class="sr-only">On-Set Kit</legend><ul class="kp-list">' + list + '</ul></fieldset>' +
          unratedNote +
          '<div class="kp-foot">' +
          '<div class="kp-days"><label for="kp-days">Days each</label>' +
          '<input id="kp-days" class="num-inp" type="number" min="0.5" step="0.5" inputmode="decimal" value="' + days + '"></div>' +
          '<div class="kp-actions"><button type="button" class="btn btn-ghost" id="kp-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-accent" id="kp-add" disabled>Add</button></div></div>'
        : '<p class="kp-empty">No On-Set Kit with a day rate yet.</p>' +
          (unratedNote || '<p class="kp-note">In Finance → Overhead → Depreciation, set an asset’s Recovery to ' +
            'On-Set Kit and give it a day rate. It then shows here.</p>') +
          '<div class="kp-foot"><div class="kp-actions"><button type="button" class="btn btn-ghost" id="kp-cancel">Close</button></div></div>') +
      '</div>';

    overlay.classList.add('open');
    document.addEventListener('keydown', onPickerKeydown);
    overlay.addEventListener('click', onPickerClick);
    overlay.querySelector('#kp-cancel').addEventListener('click', () => closeKitPicker(true));

    const add = overlay.querySelector('#kp-add');
    if (!add) {
      overlay.querySelector('#kp-cancel').focus();
      return;
    }
    const daysInput = overlay.querySelector('#kp-days');
    const checks = Array.from(overlay.querySelectorAll('.kp-check'));
    const paintAdd = () => {
      const n = checks.filter((c) => c.checked).length;
      add.disabled = n === 0 || !(num(daysInput.value) > 0);
      add.textContent = n ? 'Add ' + plural(n, 'item', 'items') : 'Add';
    };
    checks.forEach((c) => c.addEventListener('change', paintAdd));
    daysInput.addEventListener('input', paintAdd);
    add.addEventListener('click', () => {
      const picked = checks.filter((c) => c.checked).map((c) => ready.find((a) => String(a.id) === c.value)).filter(Boolean);
      addKit(key, picked, num(daysInput.value));
    });
    checks[0].focus();
  }

  /* The name a kit line keeps for its asset: trimmed and within the 200
     characters the server allows a line (days.js kitLineProblem), so a long
     or blank register name can't make the estimate unsaveable. */
  const kitName = (a) => String((a && a.name) || '').trim().slice(0, 200).trim() || 'Untitled asset';

  /* One kit line per asset onto the card, then the pop-up closes. Focus goes
     back to the button that opened it; if that has gone (the phone's sheet
     closed under it), to the first new line's Days. */
  function addKit(key, assets, days) {
    if (!assets.length || !(days > 0)) return;
    const body = groupBody(panelFor(key), 'equip');
    const rows = assets.map((a) => {
      const tr = buildKitRow({ ownKit: true, assetId: String(a.id), assetName: kitName(a), days, cost: LSCCalc.numOrNull(a.dayRate) });
      injectRow(body, tr);
      return tr;
    });
    const opener = picker.opener;
    closeKitPicker(false);
    if (menu.el && menu.target === key) {
      menu.count += rows.length;
      paintMenuCount();
    }
    const names = assets.map(kitName);
    const said = 'Added ' + (names.length > 2 ? plural(names.length, 'kit item', 'kit items') : names.join(' and ')) +
      (key === OFF_DAY ? ', not tied to a shoot day.' : ' to ' + cardName(key) + '.');
    const status = menu.el && menu.el.querySelector('#day-menu-status');
    if (status) status.textContent = said;
    if (opener && opener.isConnected) opener.focus();
    else rows[0].querySelector('.days-inp').focus();
    say(said);
  }

  /* From a card's service menu: that day, 1 day each. The phone's sheet goes
     first; focus then comes back to the card's own menu button. */
  function openKitFromMenu(btn) {
    const key = menu.target;
    if (key === null) return;
    let opener = btn;
    if (menu.sheet) {
      opener = panelFor(key).querySelector('.day-menu-btn');
      closeMenu(false);
    }
    openKitPicker(key, opener, 1);
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
    if (kind === 'equip' && isKitRow(tr)) return tr.dataset.assetName;
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
      '<span class="sr-only"></span><span class="menu-caret" aria-hidden="true"></span></button>';
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
  /* Each is a menu of cards (LSCMenu, menu.js) under the button that opened
     it; the same button again closes it, and below 768px it's a bottom
     sheet. Picking a card closes it, then acts. */
  function openMovePop(tr, opener) {
    const here = keyOf(tr);
    const cards = (booking ? booking.list() : []).map((d) => d.id).concat([OFF_DAY]).filter((k) => k !== here);
    LSCMenu.open(opener, {
      label: 'Move ' + lineLabel(tr) + ' to',
      items: cards.map((k) => ({ key: k, text: cardName(k) })),
      empty: 'No other day yet. Book one in Production Booking.',
      onSelect: (it) => {
        moveLine(tr, groupBody(panelFor(it.key), kindOf(tr)), null);
        // Focus follows the line (the brief's B2 Key Interactions 2).
        const again = tr.querySelector('.line-move');
        if (again) again.focus();
      },
    });
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
    if (!(on && commit && body)) return;
    moveLine(tr, body, before);
    // Re-inserting the row drops focus to the page: put it back on the line, as Move to does (B2-12).
    const again = tr.querySelector('.line-move');
    if (again) again.focus({ preventScroll: true });
  }

  function onDragKey(e) {
    if (e.key !== 'Escape' || !drag.on) return;
    e.preventDefault();
    e.stopPropagation();
    // The button is let go of after this, on the handle it was pressed on: that release isn't a press either.
    drag.suppressClick = true;
    endDrag(false);
  }

  function bindDrag(tr, kind, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      drag.suppressClick = false; // a cancelled drag whose release made no click mustn't swallow this one
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
        LSCMenu.close(false);
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
      if (drag.tr !== tr) {
        // Let go after Escape: the click this release makes (if any) comes first, then the flag goes.
        if (drag.suppressClick) setTimeout(() => (drag.suppressClick = false), 0);
        return;
      }
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
          // A linked travel line stays linked: Duplicate day copies the trip with it (trip-planner task 6, T2).
          fresh = kind === 'prod'
            ? buildLabourRow(prod, labourDef(prod, line, pricing), line)
            : buildTravelRow(travelDef(line, pricing), line);
        } else if (isKitRow(tr)) {
          // Own kit keeps its snapshot: the copy bills the rate the original was added at (K-D7).
          fresh = buildKitRow(kitLineOf(tr));
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
    const lines = hireRows();
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
      .map((r) => ({ vendor: r.vendor, items: hireRows().filter((tr) => vendorKey(vendorOf(tr)) === r.key).length }));
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
    /* The group (its fields, named by the vendor) sits inside the list item:
       an <li> can't itself be a group (ui-clarity task 14, axe). */
    const li = document.createElement('li');
    li.dataset.rental = r.id;
    li.innerHTML = '<div class="rental-row" role="group" aria-labelledby="rn-' + esc(r.id) + '-v">' +
      rentalRowMarkup(r) + '</div>';
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
    // Own kit is hired from no one: it has no rental and no "Add pickup and return dates".
    const lines = hireRows();
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
    // The calendar's bars (B2-8): an unchanged set redraws nothing.
    if (booking) booking.refreshRentals();
  }

  /* From a line's hint: its rental's Out date. */
  function focusRental(key) {
    const r = shownRentals().find((x) => x.key === key);
    if (r) focusRentalRow(r.id);
  }

  /* From a calendar bar (B2-8): the rental's row, at its Out date. */
  function focusRentalRow(id) {
    const li = rentalRows.get(id);
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
        panel.querySelector('.day-menu-btn').setAttribute('aria-label', 'Add production service items to ' + d.title);
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
    // Labelled with the Rate Card's own name for the section. Tagged by the subtotal it counts toward.
    ['prod', null, 'Labour'],
    ['travel', 'Travel &amp; accommodation', 'Expenses'],
    ['crew', 'External crew &amp; contracts', 'Expenses'],
    ['equip', 'Equipment Hire', 'Expenses'],
  ];
  const ON_SET_MENU = { prod: 'Production', travel: 'Travel', crew: 'External Crew', equip: 'Equipment Hire' };

  function onSetSummaryMarkup(kind, label, tag) {
    return (
      '<div class="billing-block ed-sub onset-block" id="block-' + kind + '" data-onset="' + kind + '">' +
      '<div class="bb-head"><div><h3 class="bb-label" id="onset-h-' + kind + '">' + label + '</h3>' +
      '<span class="bb-label-tag">' + tag + '</span></div>' +
      '<div class="onset-head-r">' +
      // Own kit for the whole job (own-kit K5): to Not on a day, at the estimate's day count.
      (kind === 'equip'
        ? '<button type="button" class="btn btn-quiet btn-sm onset-kit" aria-haspopup="dialog">Add On-Set Equipment</button>'
        : '') +
      '<button type="button" class="btn btn-quiet btn-sm onset-add" aria-haspopup="menu" aria-expanded="false">' +
      'Add to a day<span class="sr-only">, ' + esc(ON_SET_MENU[kind]) + '</span><span class="menu-caret" aria-hidden="true"></span></button>' +
      '<span class="bb-sum">Subtotal <b id="sum-' + kind + '">$0.00</b></span></div></div>' +
      '<div class="onset-body" id="onset-' + kind + '"><p class="onset-empty">Nothing on set yet.</p></div>' +
      '</div>'
    );
  }

  function onSetMarkup() {
    const prod = prodSection();
    return (
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
    LSCMenu.open(opener, {
      label: 'Add ' + ON_SET_MENU[kind] + ' to',
      items: keys.map((k) => ({ key: k, text: cardName(k) })).concat([{ key: NEW_TBC, text: 'A new Date TBC day' }]),
      onSelect: (it) => openDayMenuAt(it.key, kind),
    });
  }

  /* What the client is buying, above when it's shot (D98). The Deliverables
     panel's body (task 11): its title and "+ Add deliverable" are the panel's
     head, so the block keeps only the table. Still a .billing-block, for
     responsive.css's tablet floor and phone stacking. */
  function deliverablesSectionMarkup() {
    return (
      '<div class="billing-block ed-sub deliv-block" id="block-deliverables">' +
      '<div class="gt-head deliv-grid deliv-typed"><div>Type</div><div>Name</div><div>Format</div>' +
      '<div>Length</div><div class="right">Qty</div><div class="right">Post hrs (rec.)</div><div></div></div>' +
      bodyMarkup('deliverables', 'No deliverables added yet. Use “+ Add deliverable” above.') +
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
  function minimumToggleMarkup() {
    return (
      '<div class="mjp-toggle-row">' +
      '<label class="mjp-toggle" for="f-show-minimum">' +
      '<input type="checkbox" id="f-show-minimum" checked ' +
      'aria-describedby="mjp-toggle-hint">' +
      '<span>Show minimum</span></label>' +
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
      '<span class="mjp-line-verdict" id="s-min-verdict"></span>' +
      '<span class="mjp-line-note" id="s-min-note"></span>' +
      '</div>'
    );
  }

  /* The surcharge box (B2-11, D87): one row per surcharge applied, from the
     Cost Breakdown's own figures (calc.js surchargeSummary), then the total,
     already folded into the prices. Owner-only, and not a headline figure —
     it is already inside the Labour Subtotal — so it sits above the totals
     as a list, not as a .sum-item. Not under the overhead switch, which
     governs the two advisory floors, not this. Hidden with no days and
     nothing surcharged; "No surcharges apply." with days and none. The ⓘ's
     first paragraph is the estimate's own settings, filled by
     paintSurcharges(). */
  function surchargeBoxMarkup() {
    return (
      '<section class="sur-box" id="sur-box" aria-labelledby="sur-box-h" hidden>' +
      '<div class="sur-box-head"><h3 class="sur-box-h" id="sur-box-h">Surcharges</h3>' +
      LSCInfo.markup({
        id: 'surcharges',
        label: 'How the surcharges are worked out',
        title: 'Surcharges',
        paragraphs: [
          '<span id="sur-info-rules"></span>',
          'Each production line on a day is multiplied, then rounded up to the whole dollar. After hours counts ' +
            'only the share of a day’s booked hours outside office hours.',
          'A surcharge is income for the same work: it adds no hours, so the Minimum Job Price doesn’t ' +
            'move. The client sees only each line’s price, never the word “surcharge”.',
          'These settings are kept from when this estimate was first priced. <strong>Update to current ' +
            'rates</strong> takes today’s Rate Card and public holidays.',
        ],
      }) +
      '</div>' +
      '<ul class="sur-box-rows" id="sur-box-rows"></ul>' +
      '<p class="sur-box-none" id="sur-box-none" hidden>No surcharges apply.</p>' +
      '<p class="sur-box-total" id="sur-box-total"><span class="sur-box-total-label">Total surcharges</span>' +
      '<span class="sur-box-amt" id="s-surcharges">+$0.00</span>' +
      '<span class="sur-box-note">already folded into each production line’s price</span></p>' +
      '</section>'
    );
  }

  /* One row of the box: what, where and how much. The detail says the hours
     a rate reached only when it reached part of an item's hours (after hours,
     a carry-over), as the announcement does; a whole day's rate needs none. */
  const SUR_BOX_WORD = { weekend: 'Weekend rate', holiday: 'Public holiday rate', afterHours: 'After hours' };
  function surBoxRowMarkup(label, detail, amount) {
    return '<li class="sur-box-row"><span class="sur-box-what">' + label +
      (detail ? ' <span class="sur-box-detail">· ' + detail + '</span>' : '') + '</span>' +
      '<span class="sur-box-amt">+' + fmt(amount) + '</span></li>';
  }
  function surBoxHours(items) {
    const partial = items.filter((it) => it.timed && it.share < 1 - 1e-9);
    const many = items.length > 1 ? plural(items.length, 'item', 'items') : '';
    if (!partial.length) return many;
    const of = (it) => LSCRows.hrsText(it.hours).replace(/ hrs?$/, '') + ' of ' + LSCRows.hrsText(it.coveredHours);
    const same = items.every((it) => it.timed && of(it) === of(items[0]));
    if (same) return 'on ' + of(items[0]) + (many ? ', ' + many : '');
    return 'on part of ' + many;
  }
  function surBoxDayRow(r) {
    const when = r.date ? LSCCalendar.shortDate(r.date) : 'Date TBC';
    const label = r.carry && r.carryDate
      ? esc(when + ' → ' + LSCCalendar.shortDate(r.carryDate)) + ' · ' + SUR_BOX_WORD[r.type] + ' ×' + r.multiplier + ' after midnight'
      : esc(when) + ' · ' + SUR_BOX_WORD[r.type] + ' ×' + r.multiplier;
    return surBoxRowMarkup(label, esc(surBoxHours(r.items)), r.amount);
  }

  function summaryMarkup() {
    return (
      // D98: "On set, by day" → surcharge box → totals.
      surchargeBoxMarkup() +
      '<div class="summary-bar">' +
      '<div class="sum-item"><div class="sum-label">Total hours</div><div class="sum-value" id="s-hours">0</div></div>' +
      '<div class="sum-item"><div class="sum-label">Labour subtotal</div><div class="sum-value" id="s-labour">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Expenses subtotal</div><div class="sum-value" id="s-expenses">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Client price ex GST</div><div class="sum-value" id="s-client-price">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">GST</div><div class="sum-value" id="s-gst" style="font-size:15px">$0.00</div></div>' +
      '</div>' +
      /* The Totals row, the page's last word (D88): its figures a step up
         from the bar above, Total (inc GST) the largest on the screen. */
      '<div class="summary-bar totals-row" style="margin-bottom:24px">' +
      /* The two-column spans are a class, not the inline style they used to be:
         the mobile band stacks this bar into one column, and an inline
         grid-column would have needed !important to undo — which would then be
         undoable by nothing. Identical at every other width. */
      '<div class="sum-item sum-span2 sum-total">' +
      '<div class="sum-label sum-label-strong">Total (inc GST)</div>' +
      '<div class="sum-value accent tot-main" id="s-total">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Tax Set-Aside</div>' +
      '<div class="sum-value" id="s-tax">$0.00</div></div>' +
      '<div class="sum-item sum-span2">' +
      // D88: the explanation that cluttered this cell is now its ⓘ, same words.
      '<div class="sum-label">Est. Take-Home' +
      LSCInfo.markup({
        id: 'takehome',
        label: 'What Est. Take-Home counts',
        title: 'Est. Take-Home',
        paragraphs: ['Income ex GST, less the overhead its hours carry and the tax set-aside — pass-through excluded.'],
      }) +
      '</div>' +
      '<div class="sum-value" id="s-takehome">$0.00</div></div>' +
      '</div>' +
      /* Under the bars, not inside them: a sixth .sum-item would read as one
         more headline figure, and this one is explicitly not that. The tick
         sits directly above the one line it shows or hides (pricing-floor
         PF10; it sat above the totals while it governed two floors). */
      minimumToggleMarkup() +
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

  /* Editing an estimate the client already has (D34, task 25): a save that
     changes what they read sends them the change (task 33 C2). Only while that
     version is the live one; once something newer went out, or the project
     moved on, there's nothing for an edit here to differ from. */
  function sentNoteMarkup(estimate) {
    const versions = (estimate && estimate.versions) || [];
    const last = versions[versions.length - 1];
    if (!last || last.supersededAt || estimate.status !== 'sent') return '';
    return '<div class="upid-banner" role="note"><p><strong>Editing after v' + last.n + ' was sent.</strong> ' +
      'Your client has v' + last.n + '. Saving a change they would see sends it to them as v' + (last.n + 1) + '.</p></div>';
  }

  /* Editing an accepted estimate (task 33 C11): its invoices bill it as it
     was accepted, so nothing here reaches them, and the client's page keeps
     the version they accepted. Said before the owner changes a price
     expecting the bill to follow. */
  function acceptedNoteMarkup(estimate) {
    if (!estimate || estimate.status !== 'accepted') return '';
    const bills = (estimate.invoices || []).map((i) => i.number).filter(Boolean);
    const named = bills.length > 1 ? bills.slice(0, -1).join(', ') + ' and ' + bills[bills.length - 1] : bills[0];
    return '<div class="upid-banner" role="note"><p><strong>Accepted' + (bills.length ? ' and invoiced' : '') + '.</strong> ' +
      (bills.length
        ? 'Changes here don’t reach ' + esc(named) + ': ' + (bills.length > 1 ? 'they bill' : 'it bills') +
          ' the estimate as accepted. To bill more, add extras to the ' + (bills.some((n) => /-F\d*$/.test(n)) ? 'final ' : '') +
          'invoice; to change a sent one, void and remake it.'
        : 'Changes here don’t reach the invoices, which are made from the estimate as accepted.') +
      ' Your client’s page keeps the version they accepted.</p></div>';
  }

  // ── The six panels (ui-clarity task 11, U21) ──────────────────────────────
  /* Job details · Deliverables · Production booking · Services · On set, by
     day · Summary. Each is a collapsible .panel (app.css's Panels comment,
     js/panel.js turns it) whose head keeps a summary while it is closed. A
     closed body is [hidden], never removed, so collect(), payload() and the
     unsaved guard read every field as before. Production booking is
     BookingBlock's own panel, under the same rules.

     The summaries are figures recalc() has already painted inside the panel
     (paintPanelSums): a subtotal here is the sum of the subtotals on show,
     so the two can't disagree.

     Open and closed are remembered per browser, by panel, for all but Job
     details, which follows the estimate instead (formMarkup). */
  const PANELS_KEY = 'lsc.editor.panels';

  function storedPanels() {
    try {
      const v = JSON.parse(localStorage.getItem(PANELS_KEY));
      return v && typeof v === 'object' ? v : {};
    } catch (e) {
      return {};
    }
  }

  function rememberPanel(key, open) {
    try {
      const all = storedPanels();
      all[key] = open;
      localStorage.setItem(PANELS_KEY, JSON.stringify(all));
    } catch (e) {
      // Private mode or storage off: the panel simply isn't remembered.
    }
  }

  /** The remembered state of a panel, or `fallback` when there is none. */
  function panelOpen(key, fallback) {
    const v = storedPanels()[key];
    return typeof v === 'boolean' ? v : fallback;
  }

  /* One panel. opts.open: its state (default: remembered, else open);
     opts.flush: a body of edge-to-edge sub-sections and tables; opts.action:
     the head's one button, beside the toggle; opts.line: a summary in words,
     which takes its own line under the name on a phone. */
  function edPanel(key, name, body, opts) {
    const o = opts || {};
    const open = typeof o.open === 'boolean' ? o.open : panelOpen(key, true);
    const id = 'ed-' + key;
    return (
      '<section class="panel ed-panel' + (open ? '' : ' is-collapsed') + '" id="' + id + '" data-panel="' + key +
      '" aria-labelledby="' + id + '-name">' +
      '<div class="panel-head"><h2 class="panel-title">' +
      '<button type="button" class="panel-toggle" aria-expanded="' + open + '" aria-controls="' + id + '-body">' +
      '<span class="panel-chev" aria-hidden="true"></span>' +
      '<span class="panel-name" id="' + id + '-name">' + name + '</span>' +
      '<span class="panel-sum' + (o.line ? ' ed-sum-line' : '') + '" id="' + id + '-sum"></span></button></h2>' +
      (o.action || '') + '</div>' +
      '<div class="panel-body ed-panel-body' + (o.flush ? ' is-flush' : '') + '" id="' + id + '-body"' +
      (open ? '' : ' hidden') + '>' + body + '</div>' +
      '</section>'
    );
  }

  /** Open the panel `el` sits in, if it's closed: before focusing a field there. */
  function openPanelOf(el) {
    const panel = el && el.closest('.ed-panel');
    if (panel && panel.classList.contains('is-collapsed')) LSCPanel.setOpen(panel, true);
  }

  /* Job details' summary: which job this is (IA: "NBK-014 · Autumn campaign ·
     Northbank Studio"), then the two ticks in it that move prices, so a
     closed panel doesn't hide them. Painted as the fields are typed in. */
  function paintJobSum() {
    const sum = $('ed-job-sum');
    if (!sum) return;
    const upid = $('f-upid').value.trim();
    const parts = [$('f-name').value.trim(), $('f-business').value.trim()].filter(Boolean).map(esc);
    if (upid) parts.unshift('<span class="ref">' + esc(upid) + '</span>');
    if ($('f-shortnotice').checked) parts.push('Short notice');
    if (gstFreeNow() && $('f-gstfree')) parts.push('GST-free');
    const html = parts.length ? parts.join(' · ') : 'Not filled in yet';
    if (sum.innerHTML !== html) sum.innerHTML = html;
  }

  const figSum = (label, amount) => label + ' <span class="fig">' + fmt(amount) + '</span>';

  /* The other summaries, at the end of every recalc(). `subs` is each labour
     section's subtotal as painted (sum-<id>); `onSetTotal` adds travel, crew
     and gear's to the production one; `total` is the Summary panel's Total
     (inc GST). Production booking's is the block's own head (refreshHead). */
  function paintPanelSums(subs, onSetTotal, total) {
    const put = (id, html) => {
      const el = $(id);
      if (el && el.innerHTML !== html) el.innerHTML = html;
    };
    const n = rowsIn('deliverables').length;
    put('ed-deliverables-sum', n ? plural(n, 'deliverable', 'deliverables') : 'None yet');
    const services = sections
      .filter((s) => s.id !== 'prod' || s.archived)
      .reduce((sum, s) => sum + (subs[s.id] || 0), 0);
    put('ed-services-sum', figSum('Subtotal', services));
    put('ed-onset-sum', figSum('Subtotal', onSetTotal));
    put('ed-summary-sum', figSum('Total (inc GST)', total));
  }

  function formMarkup(estimate, pricing) {
    const client = (estimate && estimate.client) || {};

    const head =
      '<button class="back-btn" id="js-back">← Back</button>' +
      '<div class="page-head"><div><h1 class="page-title">' +
      (estimate ? 'Edit estimate' : 'New estimate') + '</h1>' +
      '<div class="page-sub">Select services from each category to build your estimate</div></div></div>' +
      sentNoteMarkup(estimate) + acceptedNoteMarkup(estimate);

    const job =
      '<div class="form-grid">' +
      '<div class="field full"><label for="f-upid" class="label-accent">UPID — Unique Project Identifier *</label>' +
      '<input id="f-upid" type="text" value="' + esc(estimate ? estimate.upid : '') + '"' +
      (estimate && estimate.upidLocked ? ' readonly aria-describedby="f-upid-lock"' : '') +
      (copiedFrom ? ' aria-describedby="f-upid-copy"' : '') + '>' +
      // Invoice numbers carry the UPID, so it is fixed from the first invoice (D36).
      (estimate && estimate.upidLocked
        ? '<p class="field-copy-note" id="f-upid-lock">Fixed: this project’s invoice numbers carry it.</p>'
        : '') +
      (copiedFrom
        ? '<p class="field-copy-note" id="f-upid-copy">Copied from ' +
          esc([copiedFrom.upid, copiedFrom.name].filter(Boolean).join(' · ') || 'another estimate') +
          '. A copy is a new project, so it needs a UPID of its own.</p>'
        : '') +
      '</div>' +
      '<div class="field"><label for="f-name">Project Name *</label>' +
      '<input id="f-name" type="text" value="' + esc(estimate ? estimate.name : '') + '"></div>' +
      /* The old free Date field (task 33 DR11, the user's call): nothing the
         client sees reads it now (the booked days are the dates), and beside
         them it read as "the shoot date". New estimates don't get it; one that
         already has a date keeps the field, and the value, as it was. */
      (estimate && estimate.date
        ? '<div class="field"><label for="f-date">Date</label>' +
          '<input id="f-date" type="date" value="' + esc(estimate.date) + '"></div>'
        : '') +
      '<div class="field client-field"><label for="f-business">Business name</label>' +
      '<input id="f-business" type="text" value="' + esc(client.businessName || '') + '">' +
      '<div class="client-link-status">' +
      '<span id="client-linked" hidden>From your client list</span>' +
      '<label class="client-save-toggle" id="client-save-wrap" hidden>' +
      '<input type="checkbox" id="f-saveclient" checked><span>Save to client list</span></label>' +
      '</div></div>' +
      '<div class="field"><label for="f-contact">Client name</label>' +
      '<input id="f-contact" type="text" value="' + esc(client.contactName || '') + '"></div>' +
      '<div class="field"><label for="f-email">Client email</label>' +
      '<input id="f-email" type="email" value="' + esc(client.email || '') + '"></div>' +
      '<div class="field"><label for="f-phone">Client phone</label>' +
      '<input id="f-phone" type="tel" value="' + esc(client.phone || '') + '"></div>' +
      '<div class="field"><label for="f-abn">Client ABN</label>' +
      '<input id="f-abn" type="text" inputmode="numeric" value="' + esc(abnFormat(client.abn)) + '"></div>' +
      '<div class="field"><label for="f-address">Client address</label>' +
      '<input id="f-address" type="text" value="' + esc(client.address || '') + '"></div>' +
      '<div class="field full"><label for="f-notes">Internal notes</label>' +
      '<textarea id="f-notes">' + esc(estimate ? estimate.notes : '') + '</textarea></div>' +
      '</div>' +
      /* The Document Type switch and invoice number are retired (D62, task
         18): the editor only edits the estimate, and invoices are made in the
         project folder. The bar is now the Short notice row. */
      '<div class="doc-type-bar">' +
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
      /* D98: the Prices bar governs every line below it, so it closes the
         job's details, above the first line. */
      ratesBarMarkup();

    /* D98: the editable sections in the Rate Card's order (Pre-Production,
       Post-Production, Additional work), then the read-only "On set, by
       day". An archived production section has no day cards to summarise,
       so it stays an ordinary section among them. */
    const services = sections
      .filter((section) => section.id !== 'prod' || section.archived)
      .map(labourSectionMarkup).join('') ||
      '<p class="ed-panel-empty">No service categories on the Rate Card.</p>';

    /* The six panels (task 11, U21), in D98's order: what you edit first,
       then what's being made, when it's shot, the work, the shoot, the sums.
       Job details is closed on an estimate that already exists (its summary
       says which job this is) and open on a new one or a fresh copy, whose
       UPID is still to fill in. */
    const jobOpen = !estimate || Boolean(copiedFrom);
    /* The rail beside everything from 1100px, the page and its bar in the
       column next to it (task 12); below that the rail is the Jump to… select
       at the head of the panels. */
    let html =
      '<div class="ed-shell">' + railMarkup() + '<div class="ed-main">' +
      head +
      jumpSelectMarkup() +
      '<div class="ed-panels" id="ed-panels">' +
      edPanel('job', 'Job details', job, { open: jobOpen, line: true }) +
      edPanel('deliverables', 'Deliverables', deliverablesSectionMarkup(), {
        flush: true,
        action: '<button type="button" class="btn btn-sm" id="add-deliverables">+ Add deliverable</button>',
      }) +
      // Production booking (production-booking task 6): BookingBlock.mount draws its own panel here.
      '<div id="booking-slot"></div>' +
      edPanel('services', 'Services', services, { flush: true }) +
      edPanel('onset', 'On set, by day', onSetMarkup(), { flush: true }) +
      edPanel('summary', 'Summary', summaryMarkup()) +
      '</div>' +
      // Where a line's unit switch is announced (switchUnit).
      '<p class="sr-only" id="editor-live" aria-live="polite"></p>' +
      // Where a day's surcharge changing is announced (announceSurcharges).
      '<p class="sr-only" id="sur-live" aria-live="polite"></p>' +
      barMarkup() +
      '</div></div>';

    return html;
  }

  // ── Jump rail and sticky bar (ui-clarity task 12, U5) ─────────────────────
  /* The rail and the Jump to… select scroll to a panel, open it if it's
     closed (LSCPanel.setOpen, so it is remembered and Production booking
     loads its calendar as from a click), and focus its toggle. They never
     touch the hash: the router owns it (IA "Panel anchors"). The rail marks
     the panel being read as the page scrolls, as Settings' does.

     The rail's labels are short enough for its column (IA allows it); the
     select's are the panels' own names. */
  const JUMPS = [
    ['job', 'Job details', 'Job details'],
    ['deliverables', 'Deliverables', 'Deliverables'],
    ['booking', 'Booking', 'Production booking'],
    ['services', 'Services', 'Services'],
    ['onset', 'On set', 'On set, by day'],
    ['summary', 'Summary', 'Summary'],
  ];
  /* A panel is the one being read once its top passes this far down the
     window: under the 52px header, with room for the panel's head. */
  const SPY_LINE = 120;
  const PHONE = window.matchMedia('(max-width: 767px)');

  function railMarkup() {
    return '<nav class="ed-rail" aria-label="Estimate sections">' +
      JUMPS.map(([key, short]) =>
        '<button type="button" class="nav-link" data-jump="' + key + '">' + short + '</button>').join('') +
      '</nav>';
  }

  function jumpSelectMarkup() {
    return '<div class="ed-jump"><select id="ed-jump" aria-label="Jump to a section">' +
      '<option value="">Jump to…</option>' +
      JUMPS.map(([key, , name]) => '<option value="' + key + '">' + esc(name) + '</option>').join('') +
      '</select></div>';
  }

  /* The bar: the client total, the save state, ⋯ and the way out, always in
     reach. An unsent estimate saves itself (task 8, T15, T16): the autosave
     status and Done. A sent or accepted one keeps Cancel and Save, and Save's
     resend dialog (T14). A save error sits on top of the bar, beside the
     button that raised it, rather than at the foot of a page the owner may be
     halfway down. Below 768px Cancel goes into ⋯ (moreItems), and the status
     takes its own line under the buttons. */
  function barMarkup() {
    return (
      '<div class="ed-bar" id="ed-bar">' +
      '<div id="editor-error" role="alert"></div>' +
      '<div class="ed-bar-total"><span class="eyebrow ed-bar-label">Client total · inc GST</span>' +
      '<span class="ed-bar-fig" id="ed-bar-total">$0.00</span></div>' +
      '<p class="ed-autosave" id="ed-autosave"' + (autoMode ? '' : ' hidden') + '></p>' +
      '<p class="sr-only" id="ed-autosave-live" aria-live="polite"></p>' +
      '<div class="ed-bar-acts" id="ed-bar-acts">' + barActs() + '</div></div>'
    );
  }

  function barActs() {
    const more = '<button type="button" class="btn btn-quiet ed-bar-more" id="js-more" aria-label="More for this estimate" ' +
      'aria-haspopup="menu" aria-expanded="false"><span aria-hidden="true">⋯</span></button>';
    if (autoMode) {
      return more +
        '<button type="button" class="btn btn-primary" id="js-done">' +
        '<span class="spinner" id="done-spin"></span><span id="done-label">Done</span></button>';
    }
    return more +
      '<button type="button" class="btn btn-quiet ed-bar-cancel" id="js-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="js-save" data-write>' +
      '<span class="spinner" id="save-spin"></span><span id="save-label">Save</span></button>';
  }

  const panelEl = (key) => $('ed-panels').querySelector('[data-panel="' + key + '"]');

  function markRail(key) {
    root.querySelectorAll('.ed-rail [data-jump]').forEach((b) => {
      if (b.dataset.jump === key) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  }

  /* Where a jump left the page: the rail keeps that panel marked until the
     page moves on, even when a short panel near the end can't reach the top. */
  let jumpHold = null;

  function jumpTo(key) {
    const panel = panelEl(key);
    if (!panel) return;
    if (panel.classList.contains('is-collapsed')) LSCPanel.setOpen(panel, true);
    panel.scrollIntoView({ block: 'start' });
    const toggle = panel.querySelector('.panel-toggle');
    if (toggle) toggle.focus({ preventScroll: true });
    jumpHold = { key, y: window.scrollY };
    markRail(key);
  }

  /* The last panel whose top has passed SPY_LINE, or the last panel once the
     page can't scroll further. */
  function spy() {
    if (!onScreen()) return;
    if (jumpHold && Math.abs(window.scrollY - jumpHold.y) < 2) return markRail(jumpHold.key);
    jumpHold = null;
    const atEnd = window.scrollY > 0 &&
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    let current = JUMPS[0][0];
    JUMPS.forEach(([key]) => {
      const p = panelEl(key);
      if (p && p.getBoundingClientRect().top <= SPY_LINE) current = key;
    });
    markRail(atEnd ? JUMPS[JUMPS.length - 1][0] : current);
  }

  let spyQueued = false;
  function onSpyScroll() {
    if (!onScreen()) {
      window.removeEventListener('scroll', onSpyScroll);
      return;
    }
    if (spyQueued) return;
    spyQueued = true;
    requestAnimationFrame(() => {
      spyQueued = false;
      spy();
    });
  }

  /* ⋯'s items as things stand: built each time it opens, so Delete is never
     offered mid-save and How this is calculated only while there is a
     Minimum Job Price to explain (its ⓘ in Summary follows the same rule).
     "Cancel editing", not "Cancel": the phone's sheet ends with a Cancel row
     of its own, which only closes the sheet. */
  function moreItems() {
    return [
      !autoMode && PHONE.matches && { act: 'cancel', text: 'Cancel editing' },
      // Once something has been saved since it opened (task 8, T16).
      autoMode && opened && savedSinceOpen && !saving && { act: 'undo', text: 'Undo changes since I opened this…', attrs: { 'data-write': '' } },
      breakdown && { act: 'calc', text: 'How this is calculated' },
      existing && !saving && { act: 'delete', text: 'Delete estimate…', danger: true, attrs: { 'data-write': '' } },
    ];
  }

  /* A new estimate on a desktop with no Finance set up has nothing for ⋯. */
  function paintMore() {
    const more = $('js-more');
    if (more) more.hidden = !LSCMenu.hasItems(moreItems());
  }

  function openMore(opener) {
    LSCMenu.open(opener, {
      label: 'More for this estimate',
      title: 'This estimate',
      items: moreItems(),
      onSelect: (it) => {
        if (it.act === 'cancel') handlers.onCancel();
        else if (it.act === 'undo') undoSinceOpen();
        else if (it.act === 'calc') openBreakdown(opener);
        else if (it.act === 'delete') remove();
      },
    });
  }

  // Crossing 768px moves Cancel into ⋯ or out of it, which can show or hide ⋯.
  PHONE.addEventListener('change', () => {
    if (onScreen()) paintMore();
  });

  // A tab put away (or a phone locked) may not come back: what's waiting saves now (T15).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && auto && onScreen()) auto.flush();
  });

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

    activeRows.equip = rowsIn('equip').map((tr) => onDay(tr, isKitRow(tr) ? kitLineOf(tr) : {
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

  /* Fetched when the editor opens: a new or moved day's weekend/holiday kind
     needs it, and the booking calendar shades them (task 33 DR4). Until it arrives (or
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
          if (booking) booking.setHolidays(holidays);
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

  /* Every following post line's hours, from postPlan's per-line
     recommendation (PM4, G1), written into its field and into `active` before
     anything is priced. Capture and qty don't read post lines, so writing
     them can't change the plan: one pass, no input events, focus untouched.
     A following line stops following, for good, when it is no longer by the
     hour (its unit was switched: hours aren't days, G3) or has no deliverable
     to plan it.

     `opening` (mount's first recalc only): a saved estimate never moves on
     open (G9, principle 3). Its following lines were saved as filled, so they
     match the plan; one that doesn't (a Production line saved before B2 reads
     the card's Capture tick, which may have changed since) keeps the hours it
     was saved with and becomes the owner's, rather than being rewritten under
     a baseline taken after this pass, where no "unsaved" would show it.

     Nothing at all before that pass (`followReady`): restoring the form
     recalculates as rows go in, before the Production rows are on their cards
     and the deliverables are built, when the plan reads 0 capture and no
     deliverable for every line. */
  function fillFollowing(active, pricing, opening) {
    if (!opening && !followReady) return;
    const plan = LSCCalc.postPlan(active, pricing);
    const trs = rowsIn('post');
    const pin = (tr, line) => {
      tr.dataset.follows = 'false';
      line.follows = false;
    };
    plan.lines.forEach(({ index, recommended }) => {
      const tr = trs[index];
      const line = (active.post || [])[index];
      if (!tr || !line || tr.dataset.follows !== 'true') return;
      if (unitKey(snapOf(tr) || {}) !== 'hour' || !line.deliverableId) return pin(tr, line);
      if (opening && num(line.qty) !== recommended) return pin(tr, line);
      const inp = tr.querySelector('.qty-inp');
      /* Never under the owner's cursor: a field they're in (its 0 cleared on
         focus) is priced as it shows, and filled at the next recalc. "0"
         rather than blank: a following line says what it bills. */
      if (!inp || document.activeElement === inp) return;
      if (inp.value !== String(recommended)) inp.value = String(recommended);
      line.qty = recommended;
    });
  }

  /* `opening`: mount's first pass (see fillFollowing). */
  function recalc(opening) {
    const pricing = LSCData.pricing();

    // Read first: the Production rows' prices depend on their days.
    const active = collect();
    fillFollowing(active, pricing, opening === true);
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

    // Each subtotal as painted, for the panel heads (paintPanelSums).
    const subs = {};
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
      subs[section.id] = subtotal;
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
    paintTripLinks();
    subs.travel = travelSubtotal;

    ['crew', 'equip'].forEach((kind) => {
      let subtotal = 0;
      rowsIn(kind).forEach((tr) => {
        const line = {
          days: num(inputValue(tr, '.days-inp')),
          cost: costOf(tr),
        };
        const bill = paintRow(tr, costBill(line));
        subtotal += bill;
        if (kind === 'equip' && isKitRow(tr)) {
          // The name already says Kit Hire: no "Own kit" note under it.
          tally(kind, rowDayId(tr), bill, onSetLine(LSCCalc.equipLineName(kitLineOf(tr)),
            plural(line.days, 'day', 'days') + ' × ' + fmt(line.cost), bill, '', false));
          return;
        }
        // Gear reads as its Item, with its vendor under it (B2-7).
        const vendor = kind === 'equip' ? vendorOf(tr) : '';
        const name = kind === 'crew' ? inputValue(tr, '.role-inp').trim() : inputValue(tr, '.item-inp').trim() || vendor;
        tally(kind, rowDayId(tr), bill, onSetLine(
          name || (kind === 'crew' ? 'Crew member, no name yet' : 'Hire item, no name yet'),
          plural(line.days, 'day', 'days') + ' × ' + fmt(line.cost), bill, name !== vendor ? vendor : '', !name));
      });
      setText('sum-' + kind, fmt(subtotal));
      subs[kind] = subtotal;
    });
    paintDays(perDay);
    paintOnSet(onSet);
    // Capture follows every production line, wherever it sits; the shares follow capture.
    paintPlanner(active);
    syncRentals();
    paintRentals();
    if (booking) booking.refreshHead();
    paintShortNotice(days);

    // The headline figures, from the same code the server will run on save.
    const totals = LSCCalc.computeTotals(active, pricing, LSCData.settings(), options);
    // The box's figures are the Cost Breakdown's, on the lines as they stand.
    paintSurcharges(LSCCalc.surchargeSummary(LSCCalc.costBreakdown(active, pricing, options)), surcharges, days.length > 0);
    announceSurcharges(dayById, surcharges, shortNotice);
    setText('s-hours', totals.totalHours);
    setText('s-labour', fmt(totals.labourTotal));
    setText('s-expenses', fmt(totals.expenseTotal));
    setText('s-client-price', fmt(totals.clientPriceExGst));
    setText('s-gst', fmt(totals.gst));
    setText('s-total', fmt(totals.totalIncGst));
    // The sticky bar's total (task 12): the same figure, painted in the same pass.
    setText('ed-bar-total', fmt(totals.totalIncGst));
    setText('s-tax', fmt(totals.taxSetAside));
    setText('s-takehome', fmt(totals.estTakeHome));

    // On set's subtotal is its blocks' (an archived production section is a Service).
    const prod = prodSection();
    const onSetTotal = (prod ? subs.prod || 0 : 0) + subs.travel + subs.crew + subs.equip;
    paintPanelSums(subs, onSetTotal, totals.totalIncGst);
    paintJobSum();

    // Reads the totals above rather than recomputing anything of its own.
    paintMinimum(totals, hoursWorking(LSCCalc.labourHoursBreakdown(active, pricing), totals));
    // The breakdown just painted decides whether ⋯ offers How this is calculated.
    paintMore();
    // Whatever moved the figures is an edit to save (task 8).
    if (auto) auto.touch();
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

  /* The owner's surcharge box (B2-11), from calc.js surchargeSummary, and the
     settings it was priced under for its ⓘ. A short-notice surcharge on lines
     that are on no day still shows it: the money is real, and the box is the
     only place the owner sees it. */
  const MODE_WORDS = {
    higher: 'the higher of weekend and after hours applies, with short notice on top',
    multiply: 'they all multiply',
    highest: 'only the highest one applies',
  };
  function paintSurcharges(summary, surcharges, hasDays) {
    const box = $('sur-box');
    if (!box) return;
    const any = summary.total > 0;
    box.hidden = !any && !hasDays;
    if (box.hidden) return;
    let html = summary.rows.map(surBoxDayRow).join('');
    const sn = summary.shortNotice;
    if (sn) {
      html += surBoxRowMarkup('Short notice ×' + sn.multiplier,
        'on ' + plural(sn.items, 'production item', 'production items'), sn.amount);
    }
    const list = $('sur-box-rows');
    if (list.innerHTML !== html) list.innerHTML = html;
    list.hidden = !any;
    $('sur-box-none').hidden = any;
    $('sur-box-total').hidden = !any;
    setText('s-surcharges', '+' + fmt(summary.total));
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

  const showMinimumNow = () => {
    const box = $('f-show-minimum');
    // Defaults ON, per the brief — including for the instant before bind() runs.
    return box ? box.checked : true;
  };

  /* The advisory floor: break-even (pricing-floor P5). Everything here is
     display: the arithmetic is minimumJobPrice()'s, and the inputs are the
     totals computeTotals just returned. directJobCost (pass-throughs at cost
     plus what resold travel cost) and totalHours, which is what calc.js's own
     docblock for that function specifies. `working` is hoursWorking()'s
     sentence, or '' for an hourly-only job.

     One line since PF5: it replaced both the old cost-floor minimum and the
     separate "Income floor" line under it, which by then showed the same
     figure. The verdict is measured against Client price ex GST, the figure
     the minimum is ex GST against too. Advice only: never a block on save or
     send. */
  function paintMinimum(totals, working) {
    const line = $('mjp-line');
    if (!line) return; // left mid-edit, or a screen that has no summary bar

    const floor = LSCCalc.minimumJobPrice(totals.directJobCost, totals.totalHours, incomeFloor);
    /* Take-home is green only while the quote clears its minimum (pricing-floor
       PF10): beside "under by $X" a green figure reads as "this job is fine".
       Whether or not the line is showing, since the job is the same job. A
       minimum that can't be worked out says nothing against it. */
    const under = floor !== null && floor > 0 && LSCCalc.round2(floor - totals.clientPriceExGst) > 0;
    const takeHome = $('s-takehome');
    if (takeHome) takeHome.classList.toggle('is-clear', !under);

    const on = showMinimumNow();
    line.hidden = !on;
    if (!on) return;

    setBreakdown(totals, floor, working);

    /* null is "cannot be computed", and it has to survive the trip to the
       screen as an em dash and a prompt — not as $0.00, which reads as a real
       answer meaning this job could be done for nothing. Per the IA doc there
       is deliberately no link out of here: an in-progress estimate is the wrong
       moment to send somebody to another screen. */
    if (floor === null) {
      setText('s-min-price', '—');
      setVerdict('', false);
      setText('s-min-note', 'Set up Overhead & Goals to see this.');
      line.classList.add('mjp-unset');
      return;
    }

    setText('s-min-price', fmt(floor));
    /* A blank estimate has nothing to clear: no verdict until the minimum is
       more than nothing. */
    const short = LSCCalc.round2(floor - totals.clientPriceExGst);
    if (!(floor > 0)) setVerdict('', false);
    else if (short > 0) setVerdict('This quote is under by ' + fmt(short), true);
    else setVerdict('This quote clears it', false);
    setText(
      's-min-note',
      totals.totalHours + (totals.totalHours === 1 ? ' hour' : ' hours') +
        (working ? ' (' + working + ')' : '') + ' at your ' + fmt(incomeFloor) +
        '/hr income floor, plus direct costs'
    );
    line.classList.remove('mjp-unset');
  }

  /* Under is said in --accent-text, as the Rate Card says "below floor": a
     thing to look at, not an error. Clears is said plainly. */
  function setVerdict(text, under) {
    const el = $('s-min-verdict');
    if (!el) return;
    setText('s-min-verdict', text);
    el.hidden = !text;
    el.classList.toggle('is-under', under);
  }

  // ── The cost breakdown modal ──────────────────────────────────────────────

  /* WHY THE MODAL DOESN'T COMPUTE ANYTHING OF ITS OWN
     It is handed the figures paintMinimum() just put on the screen, at the
     moment it put them there. Recomputing them on open would be a second route
     to the same number and therefore a second chance to disagree with the line
     the (?) is attached to — the one thing a "here is how that was worked out"
     panel cannot afford to do.

     WHAT IT SPLITS (pricing-floor PF5)
     The income floor is the break-even year ÷ billable hours, so each hour of
     the job carries that year's parts in proportion: running costs, pay before
     tax, super and the bad-debt allowance. calc.js's minimumJobPriceParts does
     the split in whole cents by largest remainder, so the four shares add up to
     the hours' figure and, with direct costs, to the line exactly: the column a
     reader can add up has to come out. It replaced direct / overhead / markup,
     the cost floor's parts. */
  function setBreakdown(totals, floor, working) {
    const help = $('mjp-help');
    const parts = floor === null
      ? null
      : LSCCalc.minimumJobPriceParts(totals.directJobCost, totals.totalHours, incomeFloor, breakEvenYear);

    // The same figure as the line, or no (?) at all: never a dialog that disagrees.
    if (!parts || parts.total !== floor) {
      breakdown = null;
      if (help) help.hidden = true;
      return;
    }

    breakdown = Object.assign({}, parts, {
      hoursCount: totals.totalHours,
      working: working || '',
      rate: incomeFloor,
      year: breakEvenYear,
    });
    if (help) help.hidden = false;
  }

  const $b = (id) => breakdownOverlay.querySelector('#' + id);

  function breakdownRow(label, value, note, cls) {
    return (
      '<div class="cb-row' + (cls ? ' ' + cls : '') + '"><div class="cb-row-head">' +
      '<span class="cb-row-label">' + label + '</span>' +
      '<span class="cb-row-value">' + fmt(value) + '</span></div>' +
      (note ? '<p class="cb-row-note">' + note + '</p>' : '') + '</div>'
    );
  }

  /* The hours first, as a group with its four shares indented under it, then
     the direct costs, then the sum. Each share's note gives its yearly figure
     "of" the break-even year, which is the proportion the split used, in
     dollars a reader recognises from Profit Goals rather than a percentage
     that would need rounding of its own. */
  function breakdownMarkup() {
    const b = breakdown;
    const y = b.year;
    const hours = b.hoursCount + (b.hoursCount === 1 ? ' hour' : ' hours') + (b.working ? ' (' + esc(b.working) + ')' : '');
    const ofYear = (amount) => fmt(amount) + ' of your ' + fmt(y.breakEven) + ' year';
    return (
      '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="cb-title">' +
      '<h2 class="modal-title" id="cb-title">How this is calculated</h2>' +
      '<div class="cb-rows">' +
      '<div class="cb-group">' +
      breakdownRow('Your hours', b.hours, hours + ' × ' + fmt(b.rate) + '/hr income floor, shared out as your ' +
        'break-even year is.', 'cb-group-head') +
      '<div class="cb-group-rows">' +
      breakdownRow('Running costs', b.businessCost, 'Overhead and the gear replacement reserve: ' +
        ofYear(y.businessCost) + '.') +
      breakdownRow('Your pay and its income tax', b.pay, 'Pay before tax: ' + ofYear(y.grossPay) +
        ', ' + fmt(y.incomeTax) + ' of it income tax.') +
      breakdownRow('Super', b.superContribution, 'Super on your pay: ' + ofYear(y.superContribution) + '.') +
      breakdownRow('Bad-debt allowance', b.badDebt, 'For invoices that never get paid: ' +
        ofYear(y.badDebtAllowance) + '.') +
      '</div></div>' +
      breakdownRow(
        'Direct job costs',
        b.direct,
        'What the job costs you out of pocket: crew, hired gear and travel at cost, ex GST. Passed ' +
          'through, so nothing is added to it.'
      ) +
      '</div>' +
      '<div class="cb-total"><span class="cb-total-label">Minimum Job Price</span>' +
      '<span class="cb-total-value">' + fmt(b.total) + '</span></div>' +
      '<p class="cb-note">Break-even: the job pays its costs and its share of your year, and leaves ' +
      'nothing over. Business profit and the card fee are on top of it in your auto prices. The income ' +
      'floor comes from your Capacity, Overhead and Profit Goals. Advisory only — nothing here changes ' +
      'what the client is billed.</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn" id="cb-close">Close</button></div></div>'
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
    // A new price, not a new line: it keeps its Capture tick and its deliverable (planMarks).
    if (tr.dataset.capture) line.capture = tr.dataset.capture === 'true';
    if (tr.dataset.deliverableId) line.deliverableId = tr.dataset.deliverableId;
    if (tr.dataset.postMultiplier !== undefined) line.postMultiplier = Number(tr.dataset.postMultiplier);
    if (tr.dataset.follows) line.follows = tr.dataset.follows === 'true';
    // A line its trip writes stays linked (trip-planner task 4).
    if (tr.dataset.fromTrip) line.fromTrip = tr.dataset.fromTrip;
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
    /* A typed deliverable's multiplier is a Rate Card snapshot too (B2-3):
       it takes today's, for a type still on the card. Its post lines stay as
       they are; only the recommendation moves. */
    let multipliers = 0;
    const types = deliverableTypes();
    rowsIn('deliverables').forEach((tr) => {
      const t = tr.dataset.typeId && types.find((x) => x.id === tr.dataset.typeId);
      if (!t) return;
      const next = Number(t.multiplier) || 0;
      if (Number(tr.dataset.multiplier) !== next || tr.dataset.typeName !== String(t.name || '')) {
        tr.dataset.multiplier = String(next);
        tr.dataset.typeName = String(t.name || '');
        multipliers += 1;
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
    refreshMark += 1;
    const surchargesMoved = !was && JSON.stringify(surchargesNow(days, pricing)) !== kept;
    if (!was && !surchargesMoved) refreshSurcharges = false;
    paintLineUnits();
    recalc();
    const lines = (n) => n + ' line' + (n === 1 ? '' : 's');
    const keptIts = (n) => (n === 1 ? ' kept its' : ' kept their') + ' price';
    Toast.ok(
      (changed ? changed + ' price' + (changed === 1 ? '' : 's') + ' updated to the rate card' : 'Every price already matches the rate card') +
        (surchargesMoved ? '; surcharges now follow today’s Rate Card and public holidays' : '') +
        (multipliers ? '; ' + multipliers + ' deliverable type' + (multipliers === 1 ? '' : 's') + ' now plan' +
          (multipliers === 1 ? 's' : '') + ' with today’s multiplier' : '') +
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
    // The field may sit in a closed panel; showFieldErrors focuses it.
    openPanelOf($(id));
    LSCUtil.showFieldErrors($('editor-error'), [{ msg, field: $(id) }]);
  }

  function setSaving(next) {
    // The flag first: it is module state and has to be cleared even when the
    // controls it describes have gone.
    saving = next;
    if (!onScreen()) return;
    // Save mode's button; Done is held by its own busy state (done()).
    if ($('js-save')) {
      $('js-save').disabled = next;
      $('save-spin').style.display = next ? 'inline-block' : 'none';
      $('save-label').textContent = next ? 'Saving…' : 'Save';
    }
    if ($('js-done')) $('js-done').disabled = next;
    // Delete leaves ⋯ while a save is in flight (moreItems).
    paintMore();
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
    if (auto) auto.touch();
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
      date: $('f-date') ? $('f-date').value : '',
      notes: $('f-notes').value.trim(),
      clientId: linkedClientId(),
      // The server treats an omitted gstFree as false, so it is always sent
      // rather than left to a default. (No status: since v13 only the
      // project's own actions move it, and a save keeps it.)
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

  /* What would stop this form being saved, checked before anything is sent,
     or null. Both save paths read it: Save shows `msg` on the bar's error
     line and goes to the field; autosave shows `short` in its status and
     leaves the cursor where it is (T15). `reveal` opens what hides the field.
     A new estimate's missing name or UPID is `waiting`: not saved *yet*. */
  function problemOf(body) {
    if (!body.name || !body.upid) {
      // The brief's words: "add a project name and UPID".
      const missing = !body.name && !body.upid ? 'a project name and UPID' : !body.name ? 'a project name' : 'a UPID';
      return {
        msg: !body.name ? 'Enter a project name before saving.' : 'Enter a UPID before saving.',
        fieldId: !body.name ? 'f-name' : 'f-upid',
        // The form's order: the UPID comes first.
        autoField: !body.upid ? 'f-upid' : 'f-name',
        short: 'add ' + missing,
        waiting: !existing,
      };
    }
    // The client's ABN prints on the invoice.
    if (body.client.abn && !abnValid(body.client.abn)) {
      return {
        msg: 'That client ABN doesn’t check out — it should be 11 digits, as shown on the ABN Lookup.',
        short: 'the client ABN doesn’t check out',
        fieldId: 'f-abn',
      };
    }
    // A rental back before it went out: the server refuses it (rental_dates_reversed).
    const backwards = shownRentals().find(reversed);
    if (backwards) {
      return {
        msg: 'The ' + backwards.vendor + ' rental comes back before it goes out. Check its Back date.',
        short: 'the ' + backwards.vendor + ' rental comes back before it goes out',
        fieldId: 'rn-' + backwards.id + '-back',
        reveal: () => booking && booking.showOff(), // opens the block if it was folded
      };
    }
    // A day on a date another project has confirmed, with no specification note (D16).
    const locked = booking && booking.lockProblem({ quiet: true });
    if (locked) {
      return { msg: locked.msg, short: locked.msg, fieldId: locked.fieldId, reveal: () => booking.lockProblem() };
    }
    return null;
  }

  /* Moves to a field a refusal named: its panel opened, the field in view
     and focused. */
  function goToField(id, reveal) {
    if (!onScreen()) return;
    if (reveal) reveal();
    const field = id && $(id);
    if (!field) return;
    openPanelOf(field);
    field.scrollIntoView({ block: 'center' });
    field.focus({ preventScroll: true });
  }

  async function save() {
    if (saving) return;
    clearError();

    const body = payload();
    const problem = problemOf(body);
    if (problem) {
      if (problem.reveal) problem.reveal();
      fieldError(problem.msg, problem.fieldId);
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
        const resolved = await resolveClient(clientFields(body));
        body.clientId = resolved.id;
        added = resolved.created;
        paintLink();
      }

      // baseUpdatedAt (task 7): refused if another tab or device saved since this one last did.
      const reply = existing
        ? await LSCApi.put(estimateUrl(), Object.assign({}, body, { baseUpdatedAt }))
        : await LSCApi.post('/api/estimates', body);
      saved(reply, added ? 'Estimate saved — ' + body.client.businessName + ' added to your client list.' : 'Estimate saved.');
    } catch (err) {
      // A quote the client has, changed (task 33 C2, C3): it can't be saved
      // without sending them the change. The dialog saves it again with how.
      if (err instanceof LSCApi.ApiError && err.code === 'resend_required' && existing && err.data) {
        setSaving(false);
        Toast.hide();
        if (!onScreen()) return;
        SendPanel.openUpdate($('js-save'), {
          info: err.data,
          save: (resend) => LSCApi.put(estimateUrl(), Object.assign({}, body, { baseUpdatedAt, resend })),
          done: (reply) => {
            const r = reply.resent || {};
            saved(reply, r.by === 'email' ? 'Saved. v' + r.version + ' is on its way to your client.'
              : r.by === 'waiting' ? 'Saved. The scheduled email will carry v' + r.version + '.'
                : 'Saved. Your client’s link now opens v' + r.version + '.');
          },
          fail: (e) => refused(e),
        });
        return;
      }
      refused(err);
    }
  }

  const estimateUrl = () => '/api/estimates/' + encodeURIComponent(existing.id);

  // The client record "Save to client list" makes, from the estimate's copy.
  const clientFields = (body) => ({
    businessName: body.client.businessName,
    contactName: body.client.contactName,
    email: body.client.email,
    phone: body.client.phone,
    abn: body.client.abn,
    address: body.client.address,
  });

  /* A save that went through. */
  function saved(reply, said) {
    Toast.ok(said);
    // Nothing more to do to a screen the user has already left — and
    // snapshot() reads the form, which is no longer there to read.
    if (!onScreen()) return;
    // What is on screen is now what is stored. onSaved may go Back to the
    // detail, and until that lands the editor is still in the page —
    // without this a reload in the gap would warn about an estimate that
    // had just been saved.
    baseline = snapshot();
    handlers.onSaved(reply.estimate);
  }

  /* A save the server refused, or that couldn't reach it. */
  function refused(err) {
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
    // UPIDs are unique (D60): the server names the project that has it.
    if (err.code === 'upid_taken') {
      return fieldError(err.message || 'That UPID is already used by another project.', 'f-upid');
    }
    if (err.code === 'upid_locked') {
      return fieldError(err.message || 'The UPID is fixed: this project’s invoice numbers carry it.', 'f-upid');
    }
    if (err.code === 'estimate_changed_elsewhere') {
      return showError('This estimate was changed in another tab or device after you opened it, so nothing was saved. ' +
        'Reload to see the latest (your changes here would be lost).');
    }
    showError(
      err.kind === 'network'
        ? 'Couldn’t save — the server is unreachable. Your work is still here; try again once it’s back.'
        : 'Couldn’t save: ' + (err.message || 'the server refused the request.')
    );
  }

  /* ── Autosave (trip-planner task 8; T14–T17, I2) ──────────────────────────
     An unsent estimate (a new one, or a draft) saves itself: 1.5 s after the
     last edit, on leaving a field, on opening a panel, on Done and when the
     tab is hidden (js/autosave.js has the timing). Nothing navigates after a
     save and nothing toasts; the bar's status says where it stands.

     A new estimate saves once it has a name and a UPID: its first save makes
     the project, and the address becomes the project's in place
     (handlers.onCreated, LSCRouter.rename). Every save after is a PUT with
     X-LSC-Autosave (the server refuses it once the estimate isn't a draft)
     and baseUpdatedAt (refused if another tab or device saved since).

     The money rules are Save's: the same checks first (problemOf), the
     public holiday list before a dated day is priced, and a price the
     holiday list changes is on screen for a full pause before it is saved.
     The client goes on the client list only once Business Name has been
     left (T17), so never mid-word.

     The unsaved guard asks only about edits not yet saved, or not on their
     way (a save in flight that carries them lands even if the editor is
     left). */

  // The payload as the server will hold it once saved: refreshSurcharges asks for a change, it isn't one.
  function savedKey(body) {
    const plain = Object.assign({}, body);
    delete plain.refreshSurcharges;
    return JSON.stringify(plain);
  }

  const autoHeaders = () => ({ 'X-LSC-Autosave': '1', 'X-LSC-Session': session });

  // The status when nothing is waiting to be saved.
  function cleanStatus() {
    if (existing) return { kind: 'saved', at: existing.updatedAt };
    const problem = problemOf(payload());
    return { kind: 'waiting', text: problem ? problem.short : 'add a project name and UPID', field: problem ? problem.autoField : 'f-upid' };
  }

  async function autoAttempt({ sending }) {
    const gen = mountGen;
    const still = () => gen === mountGen && onScreen();
    if (!still() || held) return null;

    let body = payload();
    // T17's client-list add is work of its own: leaving Business Name after the pause already saved it.
    const wantsClient = (b) => businessTyped && businessLeft && !b.clientId && b.client.businessName && $('f-saveclient').checked;
    if (JSON.stringify(body) === baseline && !wantsClient(body)) return cleanStatus();

    const problem = problemOf(body);
    if (problem) {
      return {
        kind: problem.waiting ? 'waiting' : 'refused',
        text: problem.short,
        field: problem.autoField || problem.fieldId,
        reveal: problem.reveal,
      };
    }

    // The holiday list before a dated day is priced, as Save does. A price it
    // changes is on screen for a full pause before it is saved.
    if ((body.days || []).some((d) => d.date) && !holidays) {
      const shown = ($('s-total') || {}).textContent;
      await loadHolidays();
      if (!still()) return null;
      if (!holidays) {
        return { kind: 'refused', text: 'the public holiday list couldn’t be loaded to price a booked date. It’s tried again on your next change.' };
      }
      if (($('s-total') || {}).textContent !== shown) {
        auto.touch();
        return { kind: 'waiting', text: 'a booked date is a public holiday, so its prices just changed. They save in a moment.' };
      }
      body = payload();
    }

    const mark = refreshMark;
    sending();
    inFlight = JSON.stringify(body);
    try {
      let added = false;
      // T17: only once Business Name has been left, so never a half-typed name.
      if (wantsClient(body)) {
        const resolved = await resolveClient(clientFields(body));
        if (!still()) return null;
        added = resolved.created;
        paintLink();
        body = payload();
        inFlight = JSON.stringify(body);
      }

      const reply = existing
        ? await LSCApi.put(estimateUrl(), Object.assign({}, body, { baseUpdatedAt }), { headers: autoHeaders() })
        : await LSCApi.post('/api/estimates', body);
      inFlight = null;
      if (gen !== mountGen) return null;

      const created = !existing;
      existing = reply.estimate;
      baseUpdatedAt = existing.updatedAt || null;
      baseline = savedKey(body);
      // Today's surcharges are stored now; only a click since this was sent still wants them.
      if (refreshMark === mark) refreshSurcharges = false;
      savedSinceOpen = true;
      if (!onScreen()) return null;
      watchGoogleSync(existing.googleSync || {});
      if (created) {
        // A new project, in place: its address, title and Delete (T17, IA flow 4).
        handlers.onCreated(existing);
        const title = root.querySelector('.page-title');
        if (title) title.textContent = 'Edit estimate';
      }
      if (added) Toast.ok(body.client.businessName + ' added to your client list.');
      paintMore();
      return { kind: 'saved', at: existing.updatedAt };
    } catch (err) {
      inFlight = null;
      if (gen !== mountGen) return null;
      return autoRefused(err);
    }
  }

  /* An autosave the server refused, or that couldn't reach it, as a status.
     The form is left as it is, and the next edit tries again. */
  function autoRefused(err) {
    if (!(err instanceof LSCApi.ApiError)) throw err;
    if (err.kind === 'auth') {
      handlers.onAuthLost({ keepScreen: true });
      return { kind: 'refused', text: 'you were signed out. Your work is still here; it saves on your next change.' };
    }
    // Sent from another tab or device: from now on it saves with Save (T14).
    if (err.code === 'autosave_not_draft') {
      toSaveMode();
      return null;
    }
    if (err.code === 'estimate_changed_elsewhere') return { kind: 'conflict' };
    if (err.code === 'date_locked' && booking) {
      const lock = booking.serverLocked(err.data && err.data.date, err.data && err.data.upid);
      return { kind: 'refused', text: lock.msg, field: lock.fieldId || null };
    }
    if (RENTAL_ERRORS[err.code]) return { kind: 'refused', text: RENTAL_ERRORS[err.code] };
    if (err.code === 'upid_taken') {
      return { kind: 'refused', text: err.message || 'that UPID is already used by another project.', field: 'f-upid' };
    }
    if (err.code === 'upid_locked') {
      return { kind: 'refused', text: err.message || 'the UPID is fixed: this project’s invoice numbers carry it.', field: 'f-upid' };
    }
    if (err.kind === 'network') {
      return { kind: 'refused', text: 'the server is unreachable. Your work is still here; it saves on your next change.' };
    }
    return { kind: 'refused', text: err.message || 'the server refused the request.' };
  }

  /* The estimate was sent elsewhere while this was open: the bar becomes
     Save's, and Save sends the client the change (T14). */
  function toSaveMode() {
    if (auto) auto.stop();
    auto = null;
    autoMode = false;
    if (!onScreen()) return;
    $('ed-autosave').hidden = true;
    $('ed-bar-acts').innerHTML = barActs();
    paintMore();
    showError('This estimate has been sent from another tab or device, so changes here aren’t saved automatically any more. ' +
      'Save sends your client the update.');
  }

  /* "Changed in another tab or device · Reload": the latest from the server,
     after the guard asks about anything here not yet saved. */
  function reloadEstimate() {
    if (!LSCUnsaved.confirmLeave('Reloading it')) return;
    const here = LSCRouter.current();
    if (here) LSCRouter.go(here.key, { skipGuard: true });
  }

  /* Done (T16): the project, once whatever is waiting has saved. Anything
     still unsaved after that (a refusal, a conflict) is the guard's to ask
     about. Back does the same. */
  let doneBusy = false;
  async function done() {
    if (doneBusy) return;
    if (!auto) return handlers.onDone(existing);
    doneBusy = true;
    const label = $('done-label');
    const spin = $('done-spin');
    const waits = auto.busy() || snapshot() !== baseline;
    if (waits && label) {
      label.textContent = 'Saving…';
      spin.style.display = 'inline-block';
    }
    try {
      if (auto.stopped()) await auto.idle();
      else await auto.flush();
    } finally {
      doneBusy = false;
    }
    if (!onScreen()) return;
    if (label) {
      label.textContent = 'Done';
      spin.style.display = 'none';
    }
    handlers.onDone(existing);
  }

  /* ⋯ Undo changes since I opened this (T16): the payload captured at mount,
     saved back through the autosave path, then the editor drawn again from
     the reply, so days, trips and lines are all as they were. */
  async function undoSinceOpen() {
    if (!auto || !opened || !existing || saving) return;
    if (!window.confirm(
      'Put this estimate back as it was at ' + LSCAutosave.clock(opened.at) + '?\n\n' +
      'Everything changed since then is undone, days, trips and lines included.' +
      ((await undoMovesSurcharges()) ? ' Weekend, public holiday and after-hours pricing follows today’s Rate Card ' +
        'and holiday list, so the total may not be quite what it was.' : '')
    )) return;

    held = true;
    await auto.idle();
    if (!onScreen()) return;
    setSaving(true);
    Toast.working('Putting it back…');
    try {
      const reply = await LSCApi.put(estimateUrl(), Object.assign({}, opened.body, { baseUpdatedAt }), { headers: autoHeaders() });
      Toast.ok('Back as it was at ' + LSCAutosave.clock(opened.at) + '.');
      if (!onScreen()) return;
      // The travel view is drawn afresh with the editor, so its address goes too.
      if (trip.view) LSCRouter.mark(tripAddress(null), { replace: true });
      mount(root, reply.estimate, handlers, {});
    } catch (err) {
      setSaving(false);
      Toast.hide();
      held = false;
      if (!onScreen()) return;
      const status = autoRefused(err);
      if (status && auto) auto.set(status);
    }
  }

  /* Will putting the opened version back leave its surcharge snapshot as it
     was? The server rebuilds the snapshot from what it holds now
     (prepareWrite), so a day removed since and restored by the Undo takes
     today's kind, and settings refreshed or dropped since (Update to current
     rates; every day removed) come back as today's. Worked out with the same
     calc.js function the server runs, so the Undo dialog only warns when the
     price can really differ. True when it would differ, or can't be told. */
  async function undoMovesSurcharges() {
    await loadHolidays();
    if (!holidays) return true;
    const body = opened.body;
    const after = (body.days || []).length || body.shortNotice
      ? LSCCalc.surchargeSnapshot(body.days, LSCData.pricing(), holidays,
        { surcharges: existing.surcharges || {}, days: existing.days || [] })
      : {};
    return JSON.stringify(after) !== opened.surcharges;
  }

  async function remove() {
    if (saving || !existing) return;
    if (!window.confirm('Delete this estimate? This cannot be undone.')) return;

    // An autosave on its way lands first, and none starts after: a PUT after the DELETE would 404.
    held = true;
    if (auto) await auto.idle();
    if (!onScreen()) return;
    setSaving(true);
    Toast.working('Deleting…');
    try {
      await LSCApi.del(estimateUrl());
      Toast.ok('Estimate deleted.');
      if (!onScreen()) return;
      handlers.onDeleted();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      held = false;
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
       lose a form. The question is the router's: onCancel is a route change,
       and every route change asks it (js/router.js). */
    const leave = () => (autoMode ? done() : handlers.onCancel());
    $('js-back').addEventListener('click', leave);
    // One listener for the bar's buttons: they are drawn again when the bar
    // changes mode (toSaveMode).
    $('ed-bar-acts').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'js-more') openMore(b);
      else if (b.id === 'js-cancel') leave();
      else if (b.id === 'js-save') save();
      else if (b.id === 'js-done') done();
    });

    /* Autosave's cues (task 8, T15): any edit restarts its pause (recalc()
       touches it too, for edits made by code: a trip's lines, a day moved);
       leaving a field or opening a panel saves now. Leaving Business Name is
       also what lets a save add the client (T17). */
    const shell = root.querySelector('.ed-shell');
    shell.addEventListener('input', () => auto && auto.touch());
    shell.addEventListener('change', () => auto && auto.touch());
    shell.addEventListener('focusout', (e) => {
      if (!auto) return;
      if (e.target.id === 'f-business') businessLeft = true;
      if (e.target.matches('input, textarea, select')) auto.flush();
    });

    // The jump rail and its select (task 12).
    root.querySelector('.ed-rail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-jump]');
      if (b) jumpTo(b.dataset.jump);
    });
    $('ed-jump').addEventListener('change', (e) => {
      const key = e.target.value;
      // Back to "Jump to…": it is a way to go somewhere, not a setting.
      e.target.value = '';
      if (key) jumpTo(key);
    });
    window.removeEventListener('scroll', onSpyScroll);
    window.addEventListener('scroll', onSpyScroll, { passive: true });

    ['f-upid', 'f-name', 'f-business'].forEach((id) => {
      $(id).addEventListener('change', () => booking.refreshIdentity());
      $(id).addEventListener('input', paintJobSum);
    });

    /* The panels remember being opened or closed (task 11), Job details
       aside. lsc:panel comes from js/panel.js, on the panel itself, for a
       click on its head and for an open from elsewhere (an error's field,
       Edit on the day) alike. */
    $('ed-panels').addEventListener('lsc:panel', (e) => {
      const key = e.target.dataset && e.target.dataset.panel;
      if (key && key !== 'job') rememberPanel(key, e.detail.open);
      // Opening or closing one moves every panel below it.
      onSpyScroll();
      if (auto && e.detail.open) auto.flush();
    });

    const business = $('f-business');
    ClientTypeahead.attach(business, { onPick: pickClient });
    business.addEventListener('input', () => {
      businessTyped = true;
      businessLeft = false;
      paintLink();
      paintLastToggle();
    });

    $('js-rates-current').addEventListener('click', updateToCurrent);
    $('f-rates-last').addEventListener('change', function () {
      setRatesFromLast(this.checked);
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
        const kitBtn = e.target.closest('.onset-kit');
        if (kitBtn && booking) return openKitPicker(OFF_DAY, kitBtn, Math.max(1, booking.list().length));
        const edit = e.target.closest('.onset-edit');
        if (edit) editOnDay(edit.dataset.key, kind);
      });
    });

    /* Straight to recalc() like any other input that feeds the bar — not a
       lighter show/hide path. The toggle changes nothing computeTotals reads,
       so running the full pass is the cheap way to be certain of it: if this
       ever did move a headline figure, it would show up here rather than in a
       shortcut that skipped the comparison. */
    $('f-show-minimum').addEventListener('change', recalc);

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
        injectRow($('tbody-' + section.id), tr, '.qty-inp');
      });
    });

    // The button is in the panel's head, so it works with the panel closed: it opens it first.
    $('add-deliverables').addEventListener('click', () => {
      openPanelOf($('tbody-deliverables'));
      injectRow($('tbody-deliverables'), buildDeliverableRow({ qty: 1 }), '.deliv-name-inp');
    });
  }

  /* options.copiedFrom: { upid, name } of the estimate Duplicate just copied
     (D60), said under the blank UPID. options.focusDay: a day id, from the
     project folder's Production days list — the booking block opens on that
     day's card instead of the UPID taking focus. */
  function mount(container, estimate, viewHandlers, options) {
    root = container;
    handlers = viewHandlers;
    existing = estimate || null;
    copiedFrom = (options && options.copiedFrom) || null;
    rowCounter = 0;
    saving = false;
    /* Autosave (task 8): an unsent estimate, new or a draft (T14). The last
       mount's instance stops here, and a reply of its still on the way is
       dropped (mountGen). */
    if (auto) auto.stop();
    auto = null;
    mountGen += 1;
    autoMode = !estimate || estimate.status === 'draft';
    held = false;
    inFlight = null;
    opened = null;
    savedSinceOpen = false;
    businessTyped = false;
    businessLeft = false;
    refreshMark = 0;
    doneBusy = false;
    baseUpdatedAt = (estimate && estimate.updatedAt) || null;
    session = newSession();
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
    /* Resolved once, before the first recalc(). They stay null when Finance has
       not been set up, and minimumJobPrice() turns a null income floor into a
       null minimum, which paintMinimum() renders as the set-up prompt. */
    /* The same LSCData.overheadRate() the Rate Card's rate column and the
       Dashboard read, so the floor here and the rate there cannot disagree. */
    overheadRate = LSCData.overheadRate();
    incomeFloor = LSCData.incomeFloor();
    breakEvenYear = LSCData.revenueTarget();
    priceCtx = LSCData.priceContext();
    lastProject = undefined;
    lastProjectFor = null;
    ratesFromLast = false;
    const activeRows = (estimate && estimate.activeRows) || {};
    sections = sectionsFor(activeRows, pricing, estimate && estimate.sectionLabels);

    booking = null;
    closeMenu(false);
    closeKitPicker(false);
    // The last estimate's travel view went with its form.
    if (trip.view) trip.view.destroy();
    trip.view = null;
    trip.pushed = false;
    LSCMenu.close(false);
    endDrag(false);
    dayPanels.clear();
    followReady = false;
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
      // Its panel as last left in this browser (task 11), when it has been.
      open: panelOpen('booking', undefined),
      // Otherwise collapsed unless there is booking to show (D64): days, or any on-set line, which lives on a card.
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
      // A day card's trip summary (trip-planner task 6) opens its travel view.
      onTrip: defineTravel,
      // A day Google didn't take (trip-planner task 14): Try again on its card.
      onSyncRetry: retryGoogleSync,
      // Gear rentals (B2-7): the panel under both columns, and the head's counts.
      rentals: rentalsPanel,
      headNotes: bookingHeadNotes,
      // Rental bars (B2-8): this estimate's rentals as they stand, and where a bar of theirs leads.
      ownRentals: rentalsPayload,
      onRentalFocus: focusRentalRow,
    });
    bind(pricing);
    paintLink();
    recalc(true);
    followReady = true;
    loadHolidays(); // recalc asked already if a day has a date; the calendar wants them either way
    lookUpLastProject();

    baseline = snapshot();
    jumpHold = null;
    spy();
    LSCUnsaved.watch('estimate-editor', {
      label: 'this estimate',
      // Hidden still counts as on screen: behind the login card after a 401
      // this form is being kept for after sign-in, and a reload would lose it.
      onScreen: () => Boolean(root && root.querySelector('#f-upid')),
      // Not yet saved and not on its way: a save in flight lands even if the editor is left.
      dirty: () => {
        const now = snapshot();
        return now !== baseline && now !== inFlight;
      },
    });

    if (autoMode) {
      // What Undo changes since I opened this puts back (T16): only a saved estimate has one.
      if (estimate) {
        opened = { at: new Date().toISOString(), body: payload(), surcharges: JSON.stringify(estimate.surcharges || {}) };
      }
      auto = LSCAutosave.create({
        status: cleanStatus(),
        attempt: autoAttempt,
        el: () => (onScreen() ? $('ed-autosave') : null),
        live: () => (onScreen() ? $('ed-autosave-live') : null),
        onField: (s) => goToField(s.field, s.reveal),
        onReload: reloadEstimate,
      });
    }

    watchBar();
    // The folder's reply doesn't say which days Google refused: ask the estimate once, so a day stuck
    // from an earlier session is marked on open and not only after the next save.
    syncLooks = 0;
    watchGoogleSync(null, 600);
    LSCRouter.claim(onTripRoute);
    // A reload or a link to `?trip=<dayId>` (I1) reopens that day's travel view; an unknown day is dropped.
    const tripDay = options && options.trip;
    if (tripDay) {
      if (openTrip(tripDay)) return;
      LSCRouter.mark(tripAddress(null), { replace: true });
    }

    const day = options && options.focusDay ? booking.showDay(options.focusDay) : null;
    const dayField = day && day.querySelector('[data-f="date"]');
    if (dayField) dayField.focus();
    // Job details is closed on an existing estimate: its head, whose summary names the job, takes focus.
    else if ($('ed-job-body').hidden) $('ed-job').querySelector('.panel-toggle').focus();
    else $('f-upid').focus();
  }

  /* The sticky bar's height, as --ed-bar-h, for anything that sticks to the
     bottom of the page above it (the day menu's Define travel foot) and for
     the page's scroll-padding, which keeps a control Tab reaches clear of the
     bar (a11y.css, WCAG 2.4.11). On the root, so <html> can read it. The bar
     wraps and grows with an error, so it is watched. */
  function watchBar() {
    if (barWatch) barWatch.disconnect();
    barWatch = null;
    const bar = $('ed-bar');
    if (!bar || typeof ResizeObserver !== 'function') return;
    const measure = () => document.documentElement.style.setProperty('--ed-bar-h', bar.offsetHeight + 'px');
    measure();
    barWatch = new ResizeObserver(measure);
    barWatch.observe(bar);
  }

  return { mount };
})();
