'use strict';

/* The estimate editor's Production Booking block (production-booking task 6).
 *
 * The editor's Production booking panel (ui-clarity task 11: a collapsible
 * .panel, turned by js/panel.js like the editor's other five). Inside: the shared month
 * calendar (js/calendar.js) with this estimate's days at full strength and every
 * other project's faded (D23), and this estimate's day cards in date order,
 * with Date TBC days (D9) after the dated ones.
 *
 * It opens as it was last left in this browser (`opts.open`, the editor's
 * remembered state). With none, it is collapsed unless the estimate already
 * has days or production items (D64): the editor is the screen used most, and
 * booking must not slow down adding items. Nothing is fetched until it is
 * opened. Every open and close goes through LSCPanel.setOpen, whose lsc:panel
 * event is where this block fetches and paints (and the editor remembers).
 *
 * WHAT THE EDITOR GETS
 *   const booking = BookingBlock.mount(slot, { estimate, identity, hasProductionItems, onChange, itemsFor });
 *   booking.payloadDays()      // the `days` the estimate routes take, in display order
 *   booking.list()             // the same days with their card titles ("Day 1 · Sat 3 Oct")
 *   booking.lockProblem(opts)  // { msg, fieldId } for a day the server would refuse, or null ({ quiet } doesn't open it)
 *   booking.serverLocked(date) // after a 409 date_locked: { msg, fieldId }
 *   booking.refreshIdentity()  // the UPID / name / business changed: redraw this estimate's tiles
 *   booking.showDay(id)        // open the block and scroll that day's card into view
 *   booking.addTbc()           // add a Date TBC day; returns its id (the editor's "A new Date TBC day";
 *                              // the block itself has no button for it since production-day-booking)
 *   booking.setHolidays(list)  // GET /api/holidays' list, shaded on the calendar (task 33 DR4)
 *   booking.showTrip(el)       // the travel view takes the body (.is-trip; trip-planner task 2)
 *   booking.hideTrip()         // and gives it back
 *   booking.tripOf(id)         // a day's trip, or null (trip-planner task 3)
 *   booking.setTrip(id, trip)  // the travel view's edit: replaces it whole, then onChange()
 * Duplicate day (B2-5) is the card's own action: it adds the copy, then calls
 * opts.onDuplicate(sourceId, newId) for the editor to copy the lines. The
 * copy takes the day's trip too (trip-planner task 6, T2).
 * A DAY'S TRIP (trip-planner task 6): a card with a trip shows its one-line
 * summary ("Trip · 4 stops · 186 km · 2 h 40", TripPlanner.summaryText), a
 * button that calls opts.onTrip(dayId) to open its travel view.
 *
 * GEAR RENTALS (B2-7, D82). The editor's rentals panel, `opts.rentals()`, is
 * put once under both columns, like Not on a day's items. `opts.headNotes()`
 * gives the collapsed head's extra parts ("2 rentals", "3 off-day lines"),
 * and booking.refreshHead() repaints the head after they change.
 * RENTAL BARS (B2-8, D84): `opts.ownRentals()` is this estimate's rentals as
 * the editor holds them now (rentalsPayload), drawn at full strength beside
 * the faded ones /api/calendar returns for other projects, which are kept per
 * range like their days. booking.refreshRentals() redraws after an edit (the
 * calendar ignores an unchanged set). A bar of this estimate's, or its line
 * in the date's list, calls opts.onRentalFocus(id) to bring its rentals-panel
 * row forward; another project's bar brings focus to its line in the list,
 * which names it (UPID, vendor, dates).
 * Day ids are made here, in the browser, because production lines point at
 * their day (`dayId`) before the estimate has ever been saved.
 *
 * A DAY'S ITEMS (task 7; every on-set kind since B2-4)
 * A day's items are the editor's own rows — production, travel, crew and
 * gear — so the editor builds them: `itemsFor(dayId)` returns one element per
 * day, the same element every time, and each paint moves it into that day's
 * card. Cards are re-rendered whole, but the items element is only ever
 * moved, never rebuilt, so what is typed in it survives a re-sort, a month
 * fetch or a status change. A removed day's element is simply not put back;
 * the editor drops it on the next onChange.
 *
 * NOT ON A DAY (B2-4, D79). The last card, after the Date TBC days, holds
 * everything not tied to a shoot day. It is not a day: it is never in
 * payloadDays(). Its items element is `offItems()`, put in once at mount.
 *
 * THE SERVICE MENU (B2-4, D74). The editor's menu swaps in for the calendar,
 * in its column: menuHost() is that column, and a `.is-menu` class on it hides
 * the calendar. setTarget(id) edges the card being added to (BookingBlock.OFF
 * for Not on a day). onToggle(open) tells the editor the block was folded.
 *
 * THE LOCK MIRRORS THE SERVER
 * server/src/days.js lockedDay refuses a day whose date another estimate has
 * CONFIRMED, unless it carries a specification note (D16), but only when the
 * day is new, has moved date, or has just become confirmed. A day already saved
 * where it is can always be re-saved. isLocked() below is that rule, run on what
 * this block has fetched from /api/calendar. The server stays the authority: if
 * someone confirms the date between the fetch and the save, the 409 comes back,
 * serverLocked() marks the date, and the card asks for its note like any other
 * locked one. Pencilled elsewhere is a warning only (D15); proposed elsewhere
 * says nothing.
 */

const BookingBlock = (() => {
  const { esc } = LSCUtil;
  const C = LSCCalendar;

  const STATUSES = [
    ['confirmed', 'Confirmed'],
    ['pencilled', 'Pencilled'],
    ['proposed', 'Proposed'],
  ];
  const WORD = { confirmed: 'Confirmed', pencilled: 'Pencilled', proposed: 'Proposed' };
  const MAX_NOTE = 500; // days.js MAX_NOTE
  const MAX_RANGE_DAYS = 400; // routes/calendar.js MAX_RANGE_DAYS
  /* What a Date TBC day starts as. It isn't on any calendar and accepting
     leaves it alone (D18), so the least committal status is the honest one.
     The card's select changes it. */
  const TBC_STATUS = 'proposed';
  /* The add-day popup's status to start on: an estimate's dates are proposed
     until the client agrees, so the least committal one again. */
  const NEW_STATUS = 'proposed';

  /* The calendar opens compact (a picker, not a feature) until Expand is
     pressed; the choice is this browser's, as Home's calendar size is. */
  const CAL_SIZE_KEY = 'lsc-booking-cal-size';
  const PULSE_MS = 1600; // booking.css day-arrive, a card just added or saved

  /* Day ids are [A-Za-z0-9_-]{1,64} (days.js DAY_ID) and must be unique across
     every estimate (day_id_taken), hence random rather than counted. */
  function newDayId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
      return 'd' + crypto.randomUUID().replace(/-/g, '');
    }
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  const norm = (d) => ({
    id: String(d.id),
    date: d.date || null,
    status: WORD[d.status] ? d.status : TBC_STATUS,
    startTime: d.startTime || '',
    endTime: d.endTime || '',
    overrideNote: d.overrideNote || '',
    // Its planned drive (trip-planner), kept as the server sent it; the travel view replaces it whole.
    trip: d.trip && typeof d.trip === 'object' ? d.trip : null,
  });

  // Dated days by date, then Date TBC days, each group keeping its order.
  function sortDays(list) {
    return list
      .map((d, i) => [d, i])
      .sort(([a, i], [b, j]) => {
        if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : i - j;
        if (a.date) return -1;
        if (b.date) return 1;
        return i - j;
      })
      .map(([d]) => d);
  }

  const thisYear = () => LSCUtil.today().slice(0, 4);
  // "Sat 3 Oct", with the year when it isn't this one.
  const short = (date) => C.shortDate(date) + (date.slice(0, 4) !== thisYear() ? ' ' + date.slice(0, 4) : '');

  function upidList(list) {
    const names = Array.from(new Set(list.map((d) => d.upid || 'another project')));
    return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  /* "Fri 3 – Sun 5 Oct", "Fri 30 Oct – Mon 2 Nov", "Sat 3 Oct". */
  function spanText(first, last) {
    if (first === last) return short(first);
    const [a, b] = [C.shortDate(first), C.shortDate(last)];
    const sameYear = first.slice(0, 4) === last.slice(0, 4);
    const yr = (d) => (d.slice(0, 4) !== thisYear() ? ' ' + d.slice(0, 4) : '');
    if (sameYear && first.slice(0, 7) === last.slice(0, 7)) {
      return a.replace(/ \w+$/, '') + ' – ' + b + yr(last); // drop the first month
    }
    return sameYear ? a + ' – ' + b + yr(last) : a + yr(first) + ' – ' + b + yr(last);
  }

  // ── The day dialog: one overlay for the page, like the cost breakdown's ──
  /* Adds a day (a date on the calendar) or edits one (the card's Edit day).
     The same form both ways: edit adds a Date field, since a card no longer
     has one (production-day-booking task 4, quiet day cards). */

  const dlg = { overlay: null, opener: null, onPick: null, downOnBackdrop: false };
  const $d = (id) => dlg.overlay.querySelector('#' + id);

  function onDialogKeydown(event) {
    // Behind the login card after a lost session: nothing here to trap into.
    if (dlg.overlay.closest('[hidden]')) return;
    if (event.key === 'Escape') return closeDialog(true);
    LSCModal.trapTab(dlg.overlay, event);
  }
  /* Only a press that began on the backdrop closes: selecting a field's text
     and letting go past the box's edge clicks the overlay too. */
  function onDialogPointerDown(event) {
    dlg.downOnBackdrop = event.target === dlg.overlay;
  }
  function onDialogClick(event) {
    if (event.target === dlg.overlay && dlg.downOnBackdrop) closeDialog(true);
  }

  function closeDialog(returnFocus) {
    const o = dlg.overlay;
    if (!o || !o.classList.contains('open')) return;
    o.classList.remove('open');
    o.innerHTML = '';
    document.removeEventListener('keydown', onDialogKeydown);
    o.removeEventListener('pointerdown', onDialogPointerDown);
    o.removeEventListener('click', onDialogClick);
    // The opener may be a function: a card's ⋯ is redrawn whenever the cards are.
    const back = typeof dlg.opener === 'function' ? dlg.opener() : dlg.opener;
    if (returnFocus && back && back.isConnected) back.focus();
    dlg.opener = null;
    dlg.onPick = null;
  }

  /* What the date's other bookings mean for the day, as lines over the form.
     info: { confirmed, pencilled, unknown, ownAlready, locked } (locked: a
     specification note is needed to book it). */
  function dialogMsgs(date, info) {
    if (!date) return '';
    const msgs = [];
    if (info.locked) {
      msgs.push('<p class="ad-msg is-lock">' + esc(short(date)) + ' is confirmed for <b>' +
        esc(upidList(info.confirmed)) + '</b>. Write a specification note to book it anyway.</p>');
    } else if (info.confirmed.length) {
      msgs.push('<p class="ad-msg is-warn">Since confirmed for <b>' + esc(upidList(info.confirmed)) +
        '</b>. This day was booked first.</p>');
    }
    if (info.pencilled.length) {
      msgs.push('<p class="ad-msg is-warn">Already pencilled for <b>' + esc(upidList(info.pencilled)) +
        '</b>.' + (info.locked || info.confirmed.length ? '' : ' Add anyway?') + '</p>');
    }
    if (info.unknown) {
      msgs.push('<p class="ad-msg">Other projects’ bookings couldn’t be checked just now. ' +
        'The date is checked again when you save.</p>');
    }
    if (info.ownAlready) {
      msgs.push('<p class="ad-msg">This estimate already has a day on ' + esc(short(date)) + '.</p>');
    }
    return msgs.join('');
  }

  const dialogTitle = (date) => (date ? C.longDate(date, LSCUtil.today()) : 'Date TBC');

  /**
   * @param {object} a
   * @param {string} a.mode — 'add' (a date picked on the calendar) or 'edit' (a card's Edit day)
   * @param {string} a.eyebrow — the line over the title ("Add a production day", "Edit Day 2")
   * @param {object} a.values — { date, status, startTime, endTime, overrideNote } to start on
   * @param {object} a.info — what the starting date's other bookings mean (dialogMsgs)
   * @param {Function} [a.recheck] — edit: (values) → Promise<info> when the date or status changes
   * @param {boolean} [a.focusDate] — edit: start on the date (a fresh duplicate has none)
   * @param {object} [a.another] — edit from the calendar: { label, run } for a second day on that
   *   date, since a click on a date with a day now edits it (production-day-booking task 6)
   * @param {object} [a.toCard] — edit from the calendar: { label, run } to close and go to the
   *   day's items, the calendar's way through to its card (the date's list once did that)
   *
   * opener is the element focus goes back to on Esc, Cancel or the backdrop, or a
   * function that finds it then (the calendar and the cards redraw while it is open).
   * onPick gets { date, status, startTime, endTime, overrideNote }.
   */
  function openDialog(a, opener, onPick) {
    dlg.overlay = document.getElementById('modal-add-day');
    if (!dlg.overlay) return;
    closeDialog(false);
    dlg.opener = opener || null;
    dlg.onPick = onPick;
    const edit = a.mode === 'edit';
    const v = a.values;

    const time = (f, label) =>
      '<div class="ad-time"><label for="ad-' + f + '">' + label + '</label>' +
      '<input id="ad-' + f + '" type="time" class="text-inp" value="' + esc(v[f] || '') + '"' +
      ' aria-describedby="ad-overnight' + (f === 'endTime' ? ' ad-time-err' : '') + '"></div>';

    dlg.overlay.innerHTML =
      '<form class="modal-box ad-box" role="dialog" aria-modal="true" aria-labelledby="ad-title"' +
      ' aria-describedby="ad-msgs" novalidate>' +
      (a.toCard
        ? '<div class="ad-head"><p class="ad-eyebrow">' + esc(a.eyebrow) + '</p>' +
          '<button type="button" class="btn btn-quiet btn-sm ad-tocard" id="ad-tocard">' + esc(a.toCard.label) +
          '<span aria-hidden="true"> ↓</span></button></div>'
        : '<p class="ad-eyebrow">' + esc(a.eyebrow) + '</p>') +
      '<h2 class="modal-title" id="ad-title">' + esc(dialogTitle(v.date)) + '</h2>' +
      (edit
        ? '<div class="field ad-date"><label for="ad-date">Date</label>' +
          '<input id="ad-date" type="date" class="text-inp" value="' + esc(v.date || '') + '"' +
          ' aria-describedby="ad-date-hint">' +
          '<span class="ad-hint" id="ad-date-hint">Moving it re-checks other bookings.</span></div>'
        : '') +
      '<div class="ad-msgs" id="ad-msgs" aria-live="polite">' + dialogMsgs(v.date, a.info) + '</div>' +
      '<div class="field ad-note" hidden><label for="ad-note">Specification note</label>' +
      '<input id="ad-note" type="text" class="text-inp" maxlength="' + MAX_NOTE + '" placeholder="e.g. Subcontractor shooting"' +
      ' value="' + esc(v.overrideNote || '') + '" aria-describedby="ad-msgs ad-note-hint">' +
      '<span class="ad-hint" id="ad-note-hint">Kept with the day. Needed to book a date confirmed elsewhere.</span></div>' +
      '<div class="ad-times">' + time('startTime', 'Bump in') + time('endTime', 'Bump out') + '</div>' +
      '<p class="ad-overnight" id="ad-overnight" hidden>Ends the next day. The shoot runs past midnight and stays on its start date.</p>' +
      // Bump out before bump in is an overnight shoot (above); the same time twice is no shoot at all.
      '<p class="ad-err" id="ad-time-err" hidden>Bump out can’t be the same time as bump in.</p>' +
      '<fieldset class="ad-status"><legend>Status</legend><div class="ad-status-opts">' +
      STATUSES.map(([s, w]) =>
        '<label class="ad-opt is-' + s + '"><input type="radio" name="ad-status" value="' + s + '"' +
        (s === v.status ? ' checked' : '') + '>' +
        '<span class="ad-swatch" aria-hidden="true"></span><span>' + w + '</span></label>'
      ).join('') +
      '</div></fieldset>' +
      '<div class="modal-actions">' +
      (a.another
        ? '<button type="button" class="btn btn-quiet ad-another" id="ad-another">' + esc(a.another.label) + '</button>'
        : '') +
      '<button type="button" class="btn btn-ghost" id="ad-cancel">Cancel</button>' +
      '<button type="submit" class="btn btn-primary" id="ad-submit">' + (edit ? 'Save day' : 'Add day') + '</button>' +
      '</div>' +
      '</form>';

    dlg.overlay.classList.add('open');
    dlg.downOnBackdrop = false;
    document.addEventListener('keydown', onDialogKeydown);
    dlg.overlay.addEventListener('pointerdown', onDialogPointerDown);
    dlg.overlay.addEventListener('click', onDialogClick);
    $d('ad-cancel').addEventListener('click', () => closeDialog(true));
    // The add dialog takes over when it is ready (openDialog closes this one), so focus is never left on nothing.
    if (a.another) $d('ad-another').addEventListener('click', () => a.another.run());
    if (a.toCard) {
      $d('ad-tocard').addEventListener('click', () => {
        const run = a.toCard.run;
        closeDialog(false); // focus goes to the card instead
        run();
      });
    }

    const form = dlg.overlay.querySelector('form');
    const date = edit ? $d('ad-date') : null;
    const noteBox = dlg.overlay.querySelector('.ad-note');
    const note = $d('ad-note');
    const start = $d('ad-startTime');
    const end = $d('ad-endTime');
    const submit = $d('ad-submit');
    let locked = false;

    // The note is asked for on a locked date, and kept on show once a day has one.
    const gate = () => {
      const empty = note.value.trim() === '';
      submit.disabled = locked && empty;
      if (locked && empty) note.setAttribute('aria-invalid', 'true');
      else note.removeAttribute('aria-invalid');
    };
    const applyInfo = (info) => {
      locked = Boolean(info.locked);
      $d('ad-msgs').innerHTML = dialogMsgs(dateValue(), info);
      noteBox.hidden = !(locked || (edit && v.overrideNote));
      gate();
    };
    const dateValue = () => (edit ? (C.isDate(date.value) ? date.value : null) : v.date);
    const status = () => form.elements['ad-status'].value || NEW_STATUS;
    const timeErr = $d('ad-time-err');
    /* The server takes any pair, and days saved before this check may hold the
       same time twice: those re-save as they are until their times are touched. */
    const keptTimes = () => edit && start.value === (v.startTime || '') && end.value === (v.endTime || '');
    const sameTime = () => Boolean(start.value) && start.value === end.value && !keptTimes();
    // The overnight line follows the times as they're typed; the same-time error clears once they differ.
    const overnight = () => {
      $d('ad-overnight').hidden = !(start.value && end.value && end.value < start.value);
      if (!timeErr.hidden && !sameTime()) {
        timeErr.hidden = true;
        end.removeAttribute('aria-invalid');
      }
    };
    applyInfo(a.info);
    overnight();
    start.addEventListener('input', overnight);
    end.addEventListener('input', overnight);
    note.addEventListener('input', gate);

    // Edit: a new date (or a day made confirmed) is checked again; a slow reply for an old value is dropped.
    let checkSeq = 0;
    const recheck = async () => {
      if (!a.recheck) return;
      const n = ++checkSeq;
      const info = await a.recheck({ date: dateValue(), status: status() });
      if (n === checkSeq && form.isConnected) applyInfo(info);
    };
    if (date) {
      date.addEventListener('change', () => {
        date.removeAttribute('aria-invalid');
        $d('ad-title').textContent = dialogTitle(dateValue());
        recheck();
      });
    }
    form.addEventListener('change', (e) => {
      if (e.target.name === 'ad-status') recheck();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      // A half-typed date reads as '' (badInput): don't take it as Date TBC.
      if (date && date.validity && date.validity.badInput) {
        date.setAttribute('aria-invalid', 'true');
        date.focus();
        return;
      }
      if (sameTime()) {
        timeErr.hidden = false;
        end.setAttribute('aria-invalid', 'true');
        end.focus();
        return;
      }
      const pick = dlg.onPick;
      const chosen = {
        date: dateValue(),
        status: status(),
        startTime: start.value,
        endTime: end.value,
        overrideNote: noteBox.hidden ? '' : note.value.trim(),
      };
      closeDialog(false); // focus goes to the card instead
      if (pick) pick(chosen);
    });
    (a.focusDate && date ? date : locked ? note : start).focus();
  }

  // ── The block ──────────────────────────────────────────────────────────────

  function mount(slot, opts) {
    closeDialog(false); // a re-mount must not leave an old estimate's dialog up

    const estimate = opts.estimate || null;
    const ownId = (estimate && estimate.id) || 'this-estimate';
    const stored = new Map(((estimate && estimate.days) || []).map((d) => [String(d.id), norm(d)]));
    let days = sortDays(((estimate && estimate.days) || []).map(norm));
    let open = typeof opts.open === 'boolean' ? opts.open : days.length > 0 || Boolean(opts.hasItems);
    let cal = null;
    let gcal = null; // Calendars ▾ in the calendar's bar (trip-planner task 13)
    let holidayList = null; // kept for a calendar mounted after it arrives
    let loadFailed = false;
    const others = new Map(); // date → other estimates' days, as /api/calendar returns them
    const otherRentals = new Map(); // id → other estimates' rentals, as /api/calendar returns them
    const covered = []; // [{ from, to }] ranges fetched, so an absent date means "nothing booked"
    const forced = new Map(); // date → UPID, for dates the server refused with date_locked
    const announced = new Set(); // `${id}|${date}` locks already announced
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};
    const itemsFor = typeof opts.itemsFor === 'function' ? opts.itemsFor : () => null;
    const onToggle = typeof opts.onToggle === 'function' ? opts.onToggle : () => {};
    const onDuplicate = typeof opts.onDuplicate === 'function' ? opts.onDuplicate : () => 0;
    const onTrip = typeof opts.onTrip === 'function' ? opts.onTrip : () => {};
    const onSyncRetry = typeof opts.onSyncRetry === 'function' ? opts.onSyncRetry : () => {};
    // Writing bookings to Google (trip-planner task 14): { dayId: 'pending' | 'error' } as the server last said.
    let syncMap = (estimate && estimate.googleSync) || {};
    const headNotes = typeof opts.headNotes === 'function' ? opts.headNotes : () => [];
    const ownRentals = typeof opts.ownRentals === 'function' ? opts.ownRentals : () => [];
    const onRentalFocus = typeof opts.onRentalFocus === 'function' ? opts.onRentalFocus : () => {};
    let targetId = null; // the card the service menu is adding to, edged

    slot.innerHTML =
      /* Still a .billing-block, for responsive.css's phone stacking of the day
         cards' rows. A heading round the button (B2-12): the block's h3s
         (Gear rentals, the menu) need an h2 of their own. */
      '<section class="panel ed-panel billing-block booking-block' + (open ? '' : ' is-collapsed') +
      '" id="block-booking" data-panel="booking" ' +
      'aria-labelledby="booking-name">' +
      '<div class="panel-head booking-head">' +
      '<h2 class="panel-title"><button type="button" class="panel-toggle" id="booking-toggle" ' +
      'aria-expanded="' + open + '" aria-controls="booking-body">' +
      '<span class="panel-chev" aria-hidden="true"></span>' +
      '<span class="panel-name" id="booking-name">Production booking</span>' +
      '<span class="panel-sum ed-sum-line" id="booking-sum"></span></button></h2>' +
      '</div>' +
      '<div class="booking-body" id="booking-body"' + (open ? '' : ' hidden') + '>' +
      '<div class="booking-cal-col">' +
      '<div id="booking-cal"></div>' +
      '<p class="booking-load-note" id="booking-load-note" hidden>Other projects’ bookings couldn’t be loaded. ' +
      'Dates are still checked when you save.</p>' +
      '</div>' +
      '<div class="booking-days-col">' +
      // One door in (production-day-booking): days are added from the calendar, so no button here.
      '<div class="booking-days-bar"><h3 class="booking-days-label" id="booking-days-label">Production days</h3></div>' +
      '<ol class="day-cards" id="booking-cards" aria-labelledby="booking-days-label"></ol>' +
      '<p class="booking-empty" id="booking-empty">Pick a date on the calendar.</p>' +
      // Not a day (D79): what isn't tied to a shoot day. Never re-rendered; its items are put in below.
      '<div class="day-card off-day-card" id="booking-off">' +
      '<div class="day-card-in" role="group" aria-labelledby="booking-off-t">' +
      '<div class="day-card-head"><span class="day-card-title" id="booking-off-t">Not on a day</span></div>' +
      '<p class="day-hint off-day-hint">Anything not tied to a shoot day.</p>' +
      '<div class="day-items-slot"></div>' +
      '</div></div>' +
      '</div>' +
      // Gear rentals (B2-7): under both columns, put in once below.
      '<div class="booking-rentals-slot"></div>' +
      '<p class="sr-only" id="booking-live" aria-live="polite"></p>' +
      '</div>' +
      '</section>';

    const $ = (id) => slot.querySelector('#' + id);
    const alive = () => slot.isConnected && Boolean($('booking-cards'));
    const byId = (id) => days.find((d) => d.id === id);
    const cardEl = (id) => $('booking-cards').querySelector('[data-day-id="' + CSS.escape(id) + '"]');

    /* A card just added or saved pulses once (flash), so the eye finds where it
       landed in date order. A repaint mid-way (a month's fetch after a move)
       rebuilds the card; the new one carries on from the same point. */
    let pulse = null; // { id, at }
    const pulsing = (id) => Boolean(pulse) && pulse.id === id && Date.now() - pulse.at < PULSE_MS;

    // ── What other projects have booked ───────────────────────────────────────

    const isCovered = (date) => covered.some((r) => r.from <= date && date <= r.to);

    /* `google` (the month on show, and Calendars ▾) also asks for the Google
       events; the clash checks (ensureCovered) don't, so they never wait on Google. */
    async function load(from, to, opts) {
      const google = Boolean(opts && opts.google);
      try {
        const reply = await LSCApi.get('/api/calendar?from=' + from + '&to=' + to +
          (google ? '&google=1' + (opts.refresh ? '&refresh=1' : '') : ''));
        // Only the month still on show takes its Google events: a slow reply for one paged past is dropped.
        if (google && cal && alive() && cal.range().from === from) {
          cal.setGoogle(reply.google || []);
          if (gcal) gcal.update(reply);
        }
        Array.from(others.keys()).forEach((d) => {
          if (from <= d && d <= to) others.delete(d);
        });
        (reply.days || []).forEach((d) => {
          if (d.estimateId === ownId) return; // drawn from this editor's own state instead
          if (!others.has(d.date)) others.set(d.date, []);
          others.get(d.date).push(d);
        });
        // The reply has every rental overlapping the range, so one known to overlap it and not sent has gone.
        otherRentals.forEach((r, id) => {
          const a = r.outDate || r.backDate;
          const b = r.backDate || r.outDate;
          if (a <= to && b >= from) otherRentals.delete(id);
        });
        (reply.rentals || []).forEach((r) => {
          if (r.estimateId !== ownId) otherRentals.set(String(r.id), r);
        });
        covered.push({ from, to });
        loadFailed = false;
      } catch (err) {
        if (!(err instanceof LSCApi.ApiError)) throw err;
        loadFailed = true; // the save still checks; say so beside the calendar
      }
      if (alive()) paint();
    }

    /* Make sure the dates' clashes are known: one range request spanning them,
       or one per date past the route's cap. */
    async function ensureCovered(dates) {
      const unknown = dates.filter((d) => d && !isCovered(d)).sort();
      if (!unknown.length) return;
      const from = unknown[0];
      const to = unknown[unknown.length - 1];
      if (C.addDays(from, MAX_RANGE_DAYS) >= to) return load(from, to);
      for (const d of unknown) await load(d, d); // eslint-disable-line no-await-in-loop
    }

    function clashOf(day) {
      if (!day.date || !isCovered(day.date)) return { confirmed: [], pencilled: [] };
      const list = others.get(day.date) || [];
      return {
        confirmed: list.filter((d) => d.status === 'confirmed'),
        pencilled: list.filter((d) => d.status === 'pencilled'),
      };
    }

    // days.js lockedDay: only a new day, a moved one, or one just made confirmed is checked.
    function checked(day) {
      const was = stored.get(day.id);
      return !was || was.date !== day.date || (day.status === 'confirmed' && was.status !== 'confirmed');
    }

    function isLocked(day) {
      if (!day.date || day.overrideNote.trim() || !checked(day)) return false;
      return forced.has(day.date) || clashOf(day).confirmed.length > 0;
    }

    // ── Painting ──────────────────────────────────────────────────────────────

    function summary() {
      const notes = headNotes();
      if (!days.length) return ['No days booked'].concat(notes).join(' · ');
      const parts = [days.length + (days.length === 1 ? ' day' : ' days')];
      STATUSES.forEach(([s]) => {
        const n = days.filter((d) => d.date && d.status === s).length;
        if (n) parts.push(n + ' ' + s);
      });
      const tbc = days.filter((d) => !d.date).length;
      if (tbc) parts.push(tbc + ' date TBC');
      const dated = days.filter((d) => d.date);
      if (dated.length) parts.push(spanText(dated[0].date, dated[dated.length - 1].date));
      return parts.concat(notes).join(' · ');
    }

    function titleOf(day, n) {
      return day.date ? 'Day ' + n + ' · ' + short(day.date) : 'Day ' + n + ' — date TBC';
    }

    /* The card's clash line: [text, kind]. kind 'lock' blocks the save. */
    function clashLine(day) {
      if (!day.date) return ['', ''];
      const c = clashOf(day);
      const conf = forced.has(day.date) && !c.confirmed.length ? [{ upid: forced.get(day.date) }] : c.confirmed;
      if (conf.length) {
        const who = upidList(conf);
        if (isLocked(day)) {
          return [short(day.date) + ' is confirmed for ' + who + '. Write a specification note to book it anyway.', 'lock'];
        }
        if (day.overrideNote.trim()) return ['Confirmed for ' + who + ' too. Booked anyway, with your note.', 'note'];
        return ['Since confirmed for ' + who + '. This day was booked first.', 'warn'];
      }
      if (c.pencilled.length) return ['Also pencilled for ' + upidList(c.pencilled) + '.', 'warn'];
      return ['', ''];
    }

    /* A quiet card (production-day-booking task 4): the date, its bump in to
       bump out and its status in one head, with a ⋯ for Edit day, Duplicate
       and Remove; then the day's items. Clash, note, trip and Google lines
       appear only when there is something to say. Its date, times and status
       are edited in the day dialog (editDay). */
    function cardMarkup(day, n) {
      const k = 'bd-' + day.id;
      const title = titleOf(day, n);
      return (
        '<li class="day-card is-' + day.status + (day.id === targetId ? ' is-target' : '') + '" data-day-id="' + esc(day.id) + '">' +
        '<div class="day-card-in" role="group" aria-labelledby="' + k + '-t ' + k + '-when">' +
        '<div class="day-card-head">' +
        '<span class="day-card-title" id="' + k + '-t">' + esc(title) + '</span>' +
        '<span class="day-when" id="' + k + '-when"></span>' +
        C.statusChip(day.status) +
        '<button type="button" class="btn btn-quiet btn-sm day-more" data-act="more" aria-haspopup="menu" aria-expanded="false"' +
        ' aria-label="More for ' + esc(title) + '"><span aria-hidden="true">⋯</span></button>' +
        '</div>' +
        '<p class="day-clash" id="' + k + '-clash" hidden></p>' +
        /* A Date TBC day (legacy, the editor's "A new Date TBC day", a cancelled
           duplicate): its missing date is the one thing to say, with the way to
           give it one. A date only changes in the dialog, which repaints the card. */
        (day.date
          ? ''
          : '<p class="day-tbc"><span>Not on the calendar until it has a date.</span>' +
            '<button type="button" class="btn btn-quiet btn-sm day-tbc-set" data-act="set-date"' +
            ' aria-label="Set date for ' + esc(title) + '">Set date</button></p>') +
        '<div class="day-field day-note" hidden>' +
        '<label for="' + k + '-note">Specification note</label>' +
        '<input type="text" class="text-inp" id="' + k + '-note" data-f="overrideNote" maxlength="' + MAX_NOTE + '"' +
        ' placeholder="e.g. Subcontractor shooting" value="' + esc(day.overrideNote) + '" aria-describedby="' + k + '-clash">' +
        '</div>' +
        '<button type="button" class="btn btn-quiet btn-sm day-trip" data-act="trip" hidden></button>' +
        // A day Google didn't take (task 14). Only a failure is marked: a write that is just waiting is gone in seconds.
        '<p class="day-sync" id="' + k + '-sync" hidden>' +
        '<span class="day-sync-text">Not in Google Calendar yet: Google didn’t take this day.</span>' +
        '<button type="button" class="btn btn-quiet btn-sm day-sync-retry" data-act="sync-retry" data-write>Try again</button>' +
        '</p>' +
        // The day's production items: the editor's element, moved in by paintCards.
        '<div class="day-items-slot"></div>' +
        '</div>' +
        '</li>'
      );
    }

    /* Everything on a card that follows from its values, updated in place so a
       keystroke in its note never re-renders the field it is typed in. */
    function updateCard(li, day) {
      const k = 'bd-' + day.id;
      li.className = 'day-card is-' + day.status + (day.id === targetId ? ' is-target' : '') + (pulsing(day.id) ? ' is-new' : '');
      const chip = li.querySelector('.status-chip');
      if (chip) chip.outerHTML = C.statusChip(day.status);

      // "07:00–18:00", "07:00–02:00 (ends next day)", "No times set" (calendar.js, as the date's list says it).
      const when = li.querySelector('.day-when');
      when.textContent = C.timeText(day);
      when.classList.toggle('is-unset', !day.startTime && !day.endTime);

      const [text, kind] = clashLine(day);
      const clash = li.querySelector('#' + CSS.escape(k + '-clash'));
      clash.textContent = text;
      clash.hidden = !text;
      clash.className = 'day-clash' + (kind ? ' is-' + kind : '');
      li.classList.toggle('is-locked', kind === 'lock');

      /* The note is asked for when the day is locked, and kept on show once
         written (clearing it locks the day again). A day booked before another
         project confirmed the date needs none, so it isn't offered one. */
      const note = li.querySelector('.day-note');
      note.hidden = !(kind === 'lock' || day.overrideNote);
      const input = note.querySelector('input');
      if (kind === 'lock') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');

      // The day's trip in one line, opening its travel view (trip-planner task 6).
      const tripBtn = li.querySelector('.day-trip');
      const summary = TripPlanner.summaryText(day.trip);
      tripBtn.hidden = !summary;
      tripBtn.innerHTML = summary ? esc(summary) + '<span class="day-trip-go" aria-hidden="true">→</span>' : '';
      tripBtn.setAttribute('aria-label', summary ? summary + '. Edit travel for ' + titleOf(day, days.indexOf(day) + 1) : '');

      // Not written to Google (task 14): a quiet line with its own Try again.
      const syncLine = li.querySelector('.day-sync');
      if (syncLine) syncLine.hidden = syncMap[day.id] !== 'error';

      // A lock is announced once per day and date, as it appears (brief, Live regions).
      const key = day.id + '|' + day.date;
      if (kind === 'lock' && !announced.has(key)) {
        announced.add(key);
        $('booking-live').textContent = text;
      }
    }

    function paintCards() {
      const list = $('booking-cards');
      const active = document.activeElement;
      const inList = active && list.contains(active);
      // Focus inside a day's items stays on that very element: it is moved, not rebuilt.
      const inItems = inList && active.closest('.day-items-slot') ? active : null;
      const keep = inList && !inItems && active.closest('[data-day-id]')
        ? { id: active.closest('[data-day-id]').dataset.dayId, f: active.dataset.f || active.dataset.act }
        : null;
      list.innerHTML = days.map((d, i) => cardMarkup(d, i + 1)).join('');
      list.querySelectorAll('[data-day-id]').forEach((li) => {
        updateCard(li, byId(li.dataset.dayId));
        if (pulsing(li.dataset.dayId)) li.style.animationDelay = pulse.at - Date.now() + 'ms';
        const items = itemsFor(li.dataset.dayId);
        if (items) li.querySelector('.day-items-slot').appendChild(items);
      });
      $('booking-empty').hidden = days.length > 0;
      if (inItems && inItems.isConnected) inItems.focus();
      else if (keep) focusCard(keep.id, keep.f);
    }

    function focusCard(id, f) {
      const li = cardEl(id);
      if (!li) return;
      const el = li.querySelector('[data-f="' + f + '"], [data-act="' + f + '"]') || li.querySelector('[data-act="more"]');
      el.focus();
    }

    // The card's "+ Add service item" (the editor's .day-menu-btn), scrolled into view.
    function focusItems(id) {
      const li = cardEl(id);
      if (!li) return;
      const btn = li.querySelector('.day-menu-btn');
      if (!btn) return focusCard(id, 'more');
      li.scrollIntoView({ block: 'nearest', behavior: LSCUtil.reducedMotion() ? 'auto' : 'smooth' });
      btn.focus({ preventScroll: true });
    }

    // Start the pulse (booking.css .is-new) on a card; updateCard and paintCards keep it going.
    function flash(id) {
      pulse = { id, at: Date.now() };
      const li = cardEl(id);
      if (!li) return;
      li.classList.remove('is-new');
      li.style.animationDelay = '';
      void li.offsetWidth; // restart on a second save in a row
      li.classList.add('is-new');
    }

    function calendarDays() {
      const who = opts.identity();
      const mine = days.filter((d) => d.date).map((d) => ({
        id: d.id,
        estimateId: ownId,
        date: d.date,
        status: d.status,
        startTime: d.startTime || null,
        endTime: d.endTime || null,
        overrideNote: d.overrideNote,
        upid: who.upid,
        projectName: who.projectName,
        client: who.client,
      }));
      return Array.from(others.values()).flat().concat(mine);
    }

    function calendarRentals() {
      const who = opts.identity();
      const mine = (ownRentals() || []).map((r) => Object.assign({}, r, {
        estimateId: ownId,
        upid: who.upid,
        projectName: who.projectName,
      }));
      return Array.from(otherRentals.values()).concat(mine);
    }

    // The toggle's state is LSCPanel's (and the markup's, at mount); this is the summary.
    function paintHead() {
      $('booking-sum').textContent = summary();
    }

    /* The cards are drawn open or closed (task 11): a day's items are the
       editor's own rows, which collect() reads from the page, so a block
       closed with days on it must still hold them, or a save would drop
       every on-set line. Only the calendar waits for the block to open. */
    function paint() {
      paintHead();
      paintCards();
      if (!open) return;
      if (cal) {
        cal.setRentals(calendarRentals());
        cal.setDays(calendarDays());
      }
      $('booking-load-note').hidden = !loadFailed;
    }

    // ── Opening, and the calendar ─────────────────────────────────────────────

    function ensureCalendar() {
      if (cal) return;
      const dated = days.filter((d) => d.date);
      cal = C.mount($('booking-cal'), {
        id: 'booking-cal',
        label: 'Production calendar',
        emphasis: ownId,
        // Opens on this estimate's first day when it has one, else on today.
        selected: dated.length ? dated[0].date : null,
        size: LSCUtil.readPref(CAL_SIZE_KEY, ['full'], 'compact'),
        onSizeChange: (size) => LSCUtil.savePref(CAL_SIZE_KEY, size),
        onRangeChange: (r) => load(r.from, r.to, { google: true }),
        // ctx.opener finds the date's cell (or list line) again after the calendar redraws.
        onDateActivate: (date, ctx) => pickDate(date, ctx.opener),
        onTileActivate: (day, ctx) => {
          // This estimate's tile (or its line in the list) is that very day.
          if (day.estimateId === ownId) return editDay(day.id, { from: ctx.opener });
          pickDate(day.date, ctx.opener); // the dialog says whose it is (D23)
        },
        // Only this estimate's rentals have somewhere to go; another's is named in the list (D84).
        rentalActionable: (r) => r.estimateId === ownId,
        onRentalActivate: (r, ctx) => {
          if (r.estimateId === ownId) onRentalFocus(r.id);
          else if (ctx.entry) ctx.entry.focus();
        },
      });
      if (holidayList) cal.setHolidays(holidayList);
      gcal = LSCGcalMenu.attach(cal.slots(), {
        reload: (o) => {
          const r = cal.range();
          return load(r.from, r.to, Object.assign({ google: true }, o));
        },
      });
      // This estimate's own days now; other projects' when the fetch the mount set off returns.
      cal.setRentals(calendarRentals());
      cal.setDays(calendarDays());
      // The cards' own dates may sit outside the month on show.
      ensureCovered(days.map((d) => d.date));
    }

    /* A click on the head, or reveal() below: LSCPanel turns the toggle and
       shows or hides the body, then says so here. */
    const panelEl = slot.querySelector('.booking-block');
    panelEl.addEventListener('lsc:panel', (e) => {
      if (e.target !== panelEl) return;
      open = e.detail.open;
      if (open) ensureCalendar();
      paint();
      onToggle(open);
    });
    const setOpen = (next) => LSCPanel.setOpen($('booking-toggle'), next);

    // ── Adding ────────────────────────────────────────────────────────────────

    /* A date on the calendar: a day this estimate already has there opens for
       editing (its first, if there are two; their tiles or list lines reach
       each), with a way to add another. Any other date adds one. `from` is the
       calendar's opener, where Esc, Cancel or the backdrop sends focus. */
    function pickDate(date, from) {
      const own = days.find((d) => d.date === date);
      if (own) editDay(own.id, { from });
      else addOn(date, from);
    }

    async function addOn(date, trigger) {
      await ensureCovered([date]);
      if (!alive()) return;
      const list = others.get(date) || [];
      const confirmed = list.filter((d) => d.status === 'confirmed');
      // A shoot's call times are usually the same each day: start on the last ones set.
      const last = days.slice().reverse().find((d) => d.startTime || d.endTime) || {};
      openDialog(
        {
          mode: 'add',
          eyebrow: 'Add a production day',
          values: { date, status: NEW_STATUS, startTime: last.startTime || '', endTime: last.endTime || '', overrideNote: '' },
          info: {
            confirmed,
            pencilled: list.filter((d) => d.status === 'pencilled'),
            unknown: !isCovered(date),
            ownAlready: days.some((d) => d.date === date),
            locked: confirmed.length > 0,
          },
        },
        trigger,
        ({ status, startTime, endTime, overrideNote }) => {
          if (!alive()) return;
          const day = { id: newDayId(), date, status, startTime, endTime, overrideNote, trip: null };
          days = sortDays(days.concat(day));
          paint();
          onChange();
          // The new card in date order, focus on adding its items (production-day-booking brief).
          focusItems(day.id);
          flash(day.id);
          $('booking-live').textContent = WORD[status] + ' day added, ' + C.longDate(date, LSCUtil.today()) + '.';
        }
      );
    }

    function addTbc() {
      const day = { id: newDayId(), date: null, status: TBC_STATUS, startTime: '', endTime: '', overrideNote: '', trip: null };
      days = sortDays(days.concat(day));
      if (!open) setOpen(true);
      else paint();
      onChange();
      return day.id;
    }

    // ── Editing a card ────────────────────────────────────────────────────────

    const cards = $('booking-cards');
    // A card's control by its data-act ("more", "set-date"), found afresh: the cards redraw.
    const cardAct = (id, act) => {
      const li = cardEl(id);
      return li && li.querySelector('[data-act="' + act + '"]');
    };

    /* What a day's dialog says about a date: the card's own lock rule
       (isLocked) run on the values being edited, without the note, since the
       note is what the dialog asks for. */
    function infoFor(day, values) {
      const cand = Object.assign({}, day, { date: values.date || null, status: values.status, overrideNote: '' });
      if (!cand.date) return { confirmed: [], pencilled: [], unknown: false, ownAlready: false, locked: false };
      const c = clashOf(cand);
      return {
        confirmed: forced.has(cand.date) && !c.confirmed.length ? [{ upid: forced.get(cand.date) }] : c.confirmed,
        pencilled: c.pencilled,
        unknown: !isCovered(cand.date),
        ownAlready: days.some((d) => d !== day && d.date === cand.date),
        locked: isLocked(cand),
      };
    }

    /* Edit day: the add dialog with the day's values and a Date field. A new
       date is checked as it is picked; Save re-sorts the cards and, for a
       moved day, takes the calendar to it. From a card's ⋯, focus goes back to
       that ⋯. From the calendar (`opts.from`, calOpener), it goes back to the
       calendar, on the day's date after a move, so dates can be worked through
       there; the dialog also offers a second day on the date clicked, and the
       way down to the day's items (Go to its items). `opts.act` names the card
       control it was opened from (default ⋯); focus goes back there, or to ⋯
       once it is gone (Set date, after the day gets a date). */
    async function editDay(id, opts) {
      const day = byId(id);
      if (!day) return;
      if (day.date) await ensureCovered([day.date]);
      if (!alive() || !byId(id)) return;
      const n = days.indexOf(day) + 1;
      const from = opts && opts.from;
      const act = (opts && opts.act) || 'more';
      const picked = day.date;
      openDialog(
        {
          mode: 'edit',
          eyebrow: 'Edit Day ' + n,
          values: day,
          info: infoFor(day, day),
          focusDate: Boolean(opts && opts.focusDate),
          recheck: async (values) => {
            if (values.date) await ensureCovered([values.date]);
            return infoFor(day, values);
          },
          another: from && picked
            ? { label: '+ Another day on ' + short(picked), run: () => addOn(picked, from) }
            : null,
          toCard: from ? { label: 'Go to its items', run: () => focusItems(id) } : null,
        },
        from || (() => cardAct(id, act) || cardAct(id, 'more')),
        (v) => {
          if (!alive() || !byId(id)) return;
          const moved = v.date !== day.date;
          Object.assign(day, v);
          days = sortDays(days);
          paint();
          onChange();
          flash(id);
          $('booking-live').textContent = titleOf(day, days.indexOf(day) + 1) + ' saved: ' +
            C.timeText(day, true) + ', ' + WORD[day.status].toLowerCase() + '.';
          if (from && cal) {
            if (moved && day.date) cal.select(day.date); // no Go-to-date wash; its month fetch follows from the move
            const back = moved ? null : from();
            if (back && back.isConnected) back.focus();
            else cal.focus();
            return;
          }
          focusCard(id, act); // ⋯ when that control has gone
          if (moved && day.date) {
            ensureCovered([day.date]).then(() => {
              if (alive() && cal) cal.goTo(day.date);
            });
          }
        }
      );
    }

    /* Duplicate day (B2-5, D81): a Date TBC day straight after the source,
       Proposed as TBC days start, with the source's times, so the copy is
       the near-identical second day; the editor copies its lines
       (onDuplicate). Its dialog opens on the date, the field to fill next;
       Cancel leaves the copy as Date TBC. */
    function duplicateDay(id) {
      const i = days.findIndex((d) => d.id === id);
      if (i === -1) return;
      const src = days[i];
      const srcTitle = titleOf(src, i + 1);
      // The copy takes the trip (T2), routed for the source's date: it reads "Day changed" until recalculated (T6).
      const trip = src.trip ? JSON.parse(JSON.stringify(src.trip)) : null;
      const day = { id: newDayId(), date: null, status: TBC_STATUS, startTime: src.startTime, endTime: src.endTime, overrideNote: '', trip };
      days.splice(i + 1, 0, day);
      days = sortDays(days);
      const n = onDuplicate(src.id, day.id);
      paint();
      onChange();
      focusCard(day.id, 'more');
      const at = days.indexOf(day);
      $('booking-live').textContent = srcTitle + ' duplicated as ' + titleOf(day, at + 1) +
        (n ? ', with its ' + (n === 1 ? 'item' : n + ' items') : '') + '.';
      editDay(day.id, { focusDate: true });
    }

    function removeDay(id) {
      const i = days.findIndex((d) => d.id === id);
      if (i === -1) return;
      const title = titleOf(days[i], i + 1);
      // Its items go with it — production, travel, crew and gear — and its trip, so the question says what.
      const items = itemsFor(id);
      const n = items ? items.querySelectorAll('[data-rid]').length : 0;
      const parts = (days[i].trip ? ['trip'] : []).concat(n ? [n === 1 ? 'item' : n + ' items'] : []);
      const what = parts.length ? ' Its ' + parts.join(' and ') + (parts.length > 1 || n > 1 ? ' are' : ' is') + ' removed too.' : '';
      if (!window.confirm('Remove ' + title + '?' + what)) return;
      days.splice(i, 1);
      paint();
      onChange();
      $('booking-live').textContent = title + ' removed.';
      // Focus to the card that took its place, or the one before, or the calendar (where days are added).
      const next = days[i] || days[i - 1];
      if (next) focusCard(next.id, 'more');
      else if (cal) cal.focus();
    }

    // The note is the one field left on a card (shown only when the date needs it, or it has one).
    cards.addEventListener('input', (e) => {
      const li = e.target.closest('[data-day-id]');
      if (!li || e.target.dataset.f !== 'overrideNote') return;
      const day = byId(li.dataset.dayId);
      day.overrideNote = e.target.value;
      updateCard(li, day);
      if (cal) cal.setDays(calendarDays()); // the list under it shows notes
      onChange();
    });

    cards.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const li = btn && btn.closest('[data-day-id]');
      if (!li) return;
      const id = li.dataset.dayId;
      if (btn.dataset.act === 'trip') onTrip(id);
      else if (btn.dataset.act === 'sync-retry') onSyncRetry(id);
      else if (btn.dataset.act === 'set-date') {
        editDay(id, { focusDate: true, act: 'set-date' });
      }
      else if (btn.dataset.act === 'more') {
        const day = byId(id);
        const title = titleOf(day, days.indexOf(day) + 1);
        const actions = { edit: () => editDay(id), duplicate: () => duplicateDay(id), remove: () => removeDay(id) };
        LSCMenu.open(btn, {
          label: 'More for ' + title,
          items: [
            { text: 'Edit day', hint: 'Date, times and status', act: 'edit' },
            { text: 'Duplicate day', hint: 'A copy with its items', act: 'duplicate' },
            { text: 'Remove day', danger: true, act: 'remove' },
          ],
          onSelect: (item) => actions[item.act](),
        });
      }
    });

    function reveal() {
      if (!open) setOpen(true);
    }

    const off = typeof opts.offItems === 'function' ? opts.offItems() : null;
    if (off) $('booking-off').querySelector('.day-items-slot').appendChild(off);
    const rentalsPanel = typeof opts.rentals === 'function' ? opts.rentals() : null;
    if (rentalsPanel) slot.querySelector('.booking-rentals-slot').appendChild(rentalsPanel);

    paint();
    if (open) ensureCalendar();

    return {
      setHolidays(list) {
        holidayList = list;
        if (cal) cal.setHolidays(list);
      },

      payloadDays: () =>
        days.map((d) => ({
          id: d.id,
          date: d.date,
          status: d.status,
          startTime: d.startTime || null,
          endTime: d.endTime || null,
          overrideNote: d.overrideNote.trim(),
          /* Always sent, null for none: the server keeps a stored trip for a
             day sent without the key (days.js parseDays), so leaving it out
             could never clear one. */
          trip: d.trip || null,
        })),

      /** The first day the server would refuse as it stands, opened up and ready to point at.
          `quiet` leaves the block as it is (autosave's check, which only says so). */
      lockProblem(opts) {
        const day = days.find(isLocked);
        if (!day) return null;
        if (!(opts && opts.quiet)) reveal();
        return { msg: clashLine(day)[0], fieldId: 'bd-' + day.id + '-note' };
      },

      /** The server refused with date_locked: lock that date here too and point at its note. */
      serverLocked(date, upid) {
        if (C.isDate(date)) forced.set(date, upid || '');
        reveal();
        paint();
        // What this block fetched is out of date: fetch the month on show again, so the tile appears.
        if (cal) {
          const r = cal.range();
          load(r.from, r.to);
        }
        const day = days.find(isLocked);
        return day
          ? { msg: clashLine(day)[0], fieldId: 'bd-' + day.id + '-note' }
          : { msg: 'A date on this estimate has been confirmed by another project. Add a specification note to that day to book it anyway.', fieldId: null };
      },

      /** The days as payloadDays() gives them, each with its card's title. */
      list: () =>
        days.map((d, i) => ({
          id: d.id,
          date: d.date,
          status: d.status,
          startTime: d.startTime,
          endTime: d.endTime,
          title: titleOf(d, i + 1),
        })),

      addTbc,

      /** Which days Google hasn't taken, `{ dayId: 'pending' | 'error' }`, as the
          server's estimate reply gives it (task 14). Redraws only the marks. */
      setSync(map) {
        syncMap = map && typeof map === 'object' ? map : {};
        $('booking-cards').querySelectorAll('[data-day-id]').forEach((li) => {
          const line = li.querySelector('.day-sync');
          if (line) line.hidden = syncMap[li.dataset.dayId] !== 'error';
        });
      },

      /** A day's trip as it stands (null for none), and its replacement from the
          travel view (trip-planner task 3). setTrip(id, null) clears it. */
      tripOf: (id) => {
        const day = days.find((d) => d.id === id);
        return day ? day.trip : null;
      },
      setTrip(id, trip) {
        const day = days.find((d) => d.id === id);
        if (!day) return;
        day.trip = trip || null;
        const li = cardEl(id);
        if (li) updateCard(li, day); // its trip summary
        onChange();
      },

      /** Open the block and bring a day's card into view; the caller moves focus. */
      showDay(id) {
        reveal();
        const li = cardEl(id);
        if (li) li.scrollIntoView({ block: 'nearest' });
        return li;
      },

      refreshIdentity() {
        if (!cal) return;
        cal.setRentals(calendarRentals());
        cal.setDays(calendarDays());
      },

      /** This estimate's rentals changed (B2-8): redraw their bars. */
      refreshRentals() {
        if (cal && alive()) cal.setRentals(calendarRentals());
      },

      /** The head's summary again: the editor's headNotes() changed (B2-7). */
      refreshHead: () => {
        if (alive()) $('booking-sum').textContent = summary();
      },

      /** The calendar's column, where the editor's service menu swaps in (B2-4). */
      menuHost: () => slot.querySelector('.booking-cal-col'),

      /** The travel view (trip-planner task 2) takes the whole body: both
          columns and the rentals are hidden, not destroyed, so what's typed in
          them survives. Opens the block first. One view at a time. */
      showTrip(el) {
        const body = $('booking-body');
        body.querySelectorAll(':scope > .trip-view').forEach((v) => {
          if (v !== el) v.remove();
        });
        reveal();
        body.classList.add('is-trip');
        if (el.parentNode !== body) body.appendChild(el);
      },

      /** Back to the calendar and the cards. */
      hideTrip() {
        const body = $('booking-body');
        if (!body) return;
        body.querySelectorAll(':scope > .trip-view').forEach((v) => v.remove());
        body.classList.remove('is-trip');
      },

      /** Edge the card the menu is adding to: a day id, BookingBlock.OFF, or null for none. */
      setTarget(id) {
        targetId = id && id !== OFF ? String(id) : null;
        $('booking-cards').querySelectorAll('[data-day-id]').forEach((li) => {
          li.classList.toggle('is-target', li.dataset.dayId === targetId);
        });
        $('booking-off').classList.toggle('is-target', id === OFF);
      },

      /** Open the block and bring Not on a day into view. */
      showOff() {
        reveal();
        const card = $('booking-off');
        card.scrollIntoView({ block: 'nearest' });
        return card;
      },
    };
  }

  /* Not on a day's key wherever a day id would go (the editor's panels, setTarget).
     A space: no day id can hold one (days.js DAY_ID). */
  const OFF = 'not on a day';

  return { mount, closeDialog, OFF };
})();
