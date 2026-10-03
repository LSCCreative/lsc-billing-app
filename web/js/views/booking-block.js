'use strict';

/* The estimate editor's Production Booking block (production-booking task 6).
 *
 * A collapsible .billing-block under the doc-type bar. Inside: the shared month
 * calendar (js/calendar.js) with this estimate's days at full strength and every
 * other project's faded (D23), and this estimate's day cards in date order,
 * with Date TBC days (D9) after the dated ones.
 *
 * It is collapsed unless the estimate already has days or production items
 * (D64): the editor is the screen used most, and booking must not slow down
 * adding items. Nothing is fetched until it is opened.
 *
 * WHAT THE EDITOR GETS
 *   const booking = BookingBlock.mount(slot, { estimate, identity, hasProductionItems, onChange, itemsFor });
 *   booking.payloadDays()      // the `days` the estimate routes take, in display order
 *   booking.list()             // the same days with their card titles ("Day 1 · Sat 3 Oct")
 *   booking.lockProblem()      // { msg, fieldId } for a day the server would refuse, or null
 *   booking.serverLocked(date) // after a 409 date_locked: { msg, fieldId }
 *   booking.refreshIdentity()  // the UPID / name / business changed: redraw this estimate's tiles
 *   booking.showDay(id)        // open the block and scroll that day's card into view
 *   booking.addTbc()           // add a Date TBC day; returns its id
 * Duplicate day (B2-5) is the card's own action: it adds the copy, then calls
 * opts.onDuplicate(sourceId, newId) for the editor to copy the lines.
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

  // ── The add-day dialog: one overlay for the page, like the cost breakdown's ──

  const dlg = { overlay: null, opener: null, onPick: null };
  const $d = (id) => dlg.overlay.querySelector('#' + id);

  function onDialogKeydown(event) {
    // Behind the login card after a lost session: nothing here to trap into.
    if (dlg.overlay.closest('[hidden]')) return;
    if (event.key === 'Escape') return closeDialog(true);
    LSCModal.trapTab(dlg.overlay, event);
  }
  function onDialogClick(event) {
    if (event.target === dlg.overlay) closeDialog(true);
  }

  function closeDialog(returnFocus) {
    const o = dlg.overlay;
    if (!o || !o.classList.contains('open')) return;
    o.classList.remove('open');
    o.innerHTML = '';
    document.removeEventListener('keydown', onDialogKeydown);
    o.removeEventListener('click', onDialogClick);
    if (returnFocus && dlg.opener && dlg.opener.isConnected) dlg.opener.focus();
    dlg.opener = null;
    dlg.onPick = null;
  }

  /**
   * @param {object} a
   * @param {string} a.date
   * @param {Array} a.confirmed — other projects' confirmed days on that date
   * @param {Array} a.pencilled — and pencilled
   * @param {boolean} a.unknown — the check couldn't be made (fetch failed)
   * @param {boolean} a.ownAlready — this estimate already has a day that date
   */
  function openDialog(a, opener, onPick) {
    dlg.overlay = document.getElementById('modal-add-day');
    if (!dlg.overlay) return;
    closeDialog(false);
    dlg.opener = opener || null;
    dlg.onPick = onPick;

    const locked = a.confirmed.length > 0;
    const msgs = [];
    if (locked) {
      msgs.push('<p class="ad-msg is-lock">' + esc(short(a.date)) + ' is confirmed for <b>' +
        esc(upidList(a.confirmed)) + '</b>. Write a specification note to book it anyway.</p>');
    }
    if (a.pencilled.length) {
      msgs.push('<p class="ad-msg is-warn">Already pencilled for <b>' + esc(upidList(a.pencilled)) +
        '</b>. Add anyway?</p>');
    }
    if (a.unknown) {
      msgs.push('<p class="ad-msg">Other projects’ bookings couldn’t be checked just now. ' +
        'The date is checked again when you save.</p>');
    }
    if (a.ownAlready) {
      msgs.push('<p class="ad-msg">This estimate already has a day on ' + esc(short(a.date)) + '.</p>');
    }

    dlg.overlay.innerHTML =
      '<div class="modal-box ad-box" role="dialog" aria-modal="true" aria-labelledby="ad-title"' +
      (msgs.length ? ' aria-describedby="ad-msgs"' : '') + '>' +
      '<p class="ad-eyebrow">Add a production day</p>' +
      '<h2 class="modal-title" id="ad-title">' + esc(C.longDate(a.date, LSCUtil.today())) + '</h2>' +
      (msgs.length ? '<div class="ad-msgs" id="ad-msgs">' + msgs.join('') + '</div>' : '') +
      (locked
        ? '<div class="field ad-note"><label for="ad-note">Specification note</label>' +
          '<input id="ad-note" type="text" maxlength="' + MAX_NOTE + '" placeholder="e.g. Subcontractor shooting"' +
          ' aria-describedby="ad-msgs ad-note-hint">' +
          '<span class="ad-note-hint" id="ad-note-hint">Kept with the day. It unlocks the buttons below.</span></div>'
        : '') +
      '<div class="ad-adds" role="group" aria-label="Add as">' +
      STATUSES.map(([s, w]) =>
        '<button type="button" class="ad-add is-' + s + '" data-status="' + s + '"' + (locked ? ' disabled' : '') + '>' +
        '<span class="ad-swatch" aria-hidden="true"></span>+ ' + w + ' day</button>'
      ).join('') +
      '</div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" id="ad-cancel">Cancel</button></div>' +
      '</div>';

    dlg.overlay.classList.add('open');
    document.addEventListener('keydown', onDialogKeydown);
    dlg.overlay.addEventListener('click', onDialogClick);
    $d('ad-cancel').addEventListener('click', () => closeDialog(true));

    const note = locked ? $d('ad-note') : null;
    const adds = Array.from(dlg.overlay.querySelectorAll('.ad-add'));
    if (note) {
      note.addEventListener('input', () => {
        const empty = note.value.trim() === '';
        adds.forEach((b) => (b.disabled = empty));
      });
    }
    adds.forEach((b) =>
      b.addEventListener('click', () => {
        const pick = dlg.onPick;
        const chosen = { status: b.dataset.status, overrideNote: note ? note.value.trim() : '' };
        closeDialog(false); // focus goes to the new card instead (brief, Booking a day 5)
        if (pick) pick(chosen);
      })
    );
    (note || adds[0]).focus();
  }

  // ── The block ──────────────────────────────────────────────────────────────

  function mount(slot, opts) {
    closeDialog(false); // a re-mount must not leave an old estimate's dialog up

    const estimate = opts.estimate || null;
    const ownId = (estimate && estimate.id) || 'this-estimate';
    const stored = new Map(((estimate && estimate.days) || []).map((d) => [String(d.id), norm(d)]));
    let days = sortDays(((estimate && estimate.days) || []).map(norm));
    let open = days.length > 0 || Boolean(opts.hasItems);
    let cal = null;
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
    const headNotes = typeof opts.headNotes === 'function' ? opts.headNotes : () => [];
    const ownRentals = typeof opts.ownRentals === 'function' ? opts.ownRentals : () => [];
    const onRentalFocus = typeof opts.onRentalFocus === 'function' ? opts.onRentalFocus : () => {};
    let targetId = null; // the card the service menu is adding to, edged

    slot.innerHTML =
      '<div class="billing-block booking-block" id="block-booking">' +
      '<div class="bb-head booking-head">' +
      '<button type="button" class="booking-toggle" id="booking-toggle" aria-controls="booking-body">' +
      '<span class="bb-chevron" aria-hidden="true">▶</span><span class="bb-label">Production Booking</span></button>' +
      '<span class="bb-sum" id="booking-sum"></span>' +
      '</div>' +
      '<div class="booking-body" id="booking-body">' +
      '<div class="booking-cal-col">' +
      '<div id="booking-cal"></div>' +
      '<p class="booking-load-note" id="booking-load-note" hidden>Other projects’ bookings couldn’t be loaded. ' +
      'Dates are still checked when you save.</p>' +
      '</div>' +
      '<div class="booking-days-col">' +
      '<div class="booking-days-bar"><span class="booking-days-label" id="booking-days-label">Production days</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="booking-add-tbc">+ Add Date TBC day</button></div>' +
      '<ol class="day-cards" id="booking-cards" aria-labelledby="booking-days-label"></ol>' +
      '<p class="booking-empty" id="booking-empty">No production days yet. Choose a date on the calendar to book ' +
      'one, or add a Date TBC day for work without a date.</p>' +
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
      '</div>';

    const $ = (id) => slot.querySelector('#' + id);
    const alive = () => slot.isConnected && Boolean($('booking-cards'));
    const byId = (id) => days.find((d) => d.id === id);

    // ── What other projects have booked ───────────────────────────────────────

    const isCovered = (date) => covered.some((r) => r.from <= date && date <= r.to);

    async function load(from, to) {
      try {
        const reply = await LSCApi.get('/api/calendar?from=' + from + '&to=' + to);
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

    function cardMarkup(day, n) {
      const k = 'bd-' + day.id;
      const title = titleOf(day, n);
      const field = (label, control, extra) =>
        '<div class="day-field' + (extra || '') + '"><label for="' + k + '-' + label.toLowerCase() + '">' + label + '</label>' + control + '</div>';
      return (
        '<li class="day-card is-' + day.status + (day.id === targetId ? ' is-target' : '') + '" data-day-id="' + esc(day.id) + '">' +
        '<div class="day-card-in" role="group" aria-labelledby="' + k + '-t">' +
        '<div class="day-card-head">' +
        '<span class="day-card-title" id="' + k + '-t">' + esc(title) + '</span>' +
        C.statusChip(day.status) +
        '<button type="button" class="btn btn-ghost btn-sm day-dup" data-act="duplicate" aria-label="Duplicate ' + esc(title) + '">Duplicate day</button>' +
        '<button type="button" class="del-btn day-card-del" data-act="remove" aria-label="Remove ' + esc(title) + '">×</button>' +
        '</div>' +
        '<div class="day-fields">' +
        field('Date',
          '<input type="date" class="text-inp" id="' + k + '-date" data-f="date" value="' + esc(day.date || '') + '"' +
          ' aria-describedby="' + k + '-date-h">' +
          '<span class="day-hint" id="' + k + '-date-h">' + (day.date ? 'Moving it re-checks other bookings.' : 'Leave empty while the date is TBC.') + '</span>',
          ' day-field-date') +
        field('Status',
          '<select class="svc-select" id="' + k + '-status" data-f="status">' +
          STATUSES.map(([s, w]) => '<option value="' + s + '"' + (s === day.status ? ' selected' : '') + '>' + w + '</option>').join('') +
          '</select>') +
        field('Start', '<input type="time" class="text-inp" id="' + k + '-start" data-f="startTime" value="' + esc(day.startTime) + '"' +
          ' aria-describedby="' + k + '-on">') +
        field('End', '<input type="time" class="text-inp" id="' + k + '-end" data-f="endTime" value="' + esc(day.endTime) + '"' +
          ' aria-describedby="' + k + '-on">') +
        '</div>' +
        '<p class="day-overnight" id="' + k + '-on" hidden>Ends next day: the shoot runs past midnight and belongs to its start date.</p>' +
        '<p class="day-clash" id="' + k + '-clash" hidden></p>' +
        '<div class="day-field day-note" hidden>' +
        '<label for="' + k + '-note">Specification note</label>' +
        '<input type="text" class="text-inp" id="' + k + '-note" data-f="overrideNote" maxlength="' + MAX_NOTE + '"' +
        ' placeholder="e.g. Subcontractor shooting" value="' + esc(day.overrideNote) + '" aria-describedby="' + k + '-clash">' +
        '</div>' +
        // The day's production items: the editor's element, moved in by paintCards.
        '<div class="day-items-slot"></div>' +
        '</div>' +
        '</li>'
      );
    }

    /* Everything on a card that follows from its values, updated in place so a
       keystroke never re-renders the field it is typed in. */
    function updateCard(li, day) {
      const k = 'bd-' + day.id;
      li.className = 'day-card is-' + day.status + (day.id === targetId ? ' is-target' : '');
      const chip = li.querySelector('.status-chip');
      if (chip) chip.outerHTML = C.statusChip(day.status);

      const overnight = Boolean(day.startTime && day.endTime && day.endTime < day.startTime);
      li.querySelector('#' + CSS.escape(k + '-on')).hidden = !overnight;

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
        const items = itemsFor(li.dataset.dayId);
        if (items) li.querySelector('.day-items-slot').appendChild(items);
      });
      $('booking-empty').hidden = days.length > 0;
      if (inItems && inItems.isConnected) inItems.focus();
      else if (keep) focusCard(keep.id, keep.f);
    }

    function focusCard(id, f) {
      const li = $('booking-cards').querySelector('[data-day-id="' + CSS.escape(id) + '"]');
      if (!li) return;
      const el = li.querySelector('[data-f="' + f + '"], [data-act="' + f + '"]') || li.querySelector('[data-f="date"]');
      el.focus();
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

    function paintHead() {
      $('booking-sum').textContent = summary();
      const toggle = $('booking-toggle');
      toggle.setAttribute('aria-expanded', String(open));
      $('booking-body').hidden = !open;
      slot.querySelector('.booking-block').classList.toggle('is-open', open);
    }

    function paint() {
      paintHead();
      if (!open) return;
      if (cal) {
        cal.setRentals(calendarRentals());
        cal.setDays(calendarDays());
      }
      $('booking-load-note').hidden = !loadFailed;
      paintCards();
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
        onRangeChange: (r) => load(r.from, r.to),
        onDateActivate: (date, ctx) => addOn(date, ctx.trigger),
        onTileActivate: (day, ctx) => {
          if (day.estimateId === ownId) return focusCard(day.id, 'date');
          addOn(day.date, ctx.trigger); // the dialog says whose it is (D23)
        },
        // Only this estimate's rentals have somewhere to go; another's is named in the list (D84).
        rentalActionable: (r) => r.estimateId === ownId,
        onRentalActivate: (r, ctx) => {
          if (r.estimateId === ownId) onRentalFocus(r.id);
          else if (ctx.entry) ctx.entry.focus();
        },
      });
      // This estimate's own days now; other projects' when the fetch the mount set off returns.
      cal.setRentals(calendarRentals());
      cal.setDays(calendarDays());
      // The cards' own dates may sit outside the month on show.
      ensureCovered(days.map((d) => d.date));
    }

    function setOpen(next) {
      open = next;
      if (open) ensureCalendar();
      paint();
      onToggle(open);
    }

    $('booking-toggle').addEventListener('click', () => setOpen(!open));
    // The whole head is the target, as the old app's collapsible heads were; the button is what a keyboard reaches.
    slot.querySelector('.booking-head').addEventListener('click', (e) => {
      if (!e.target.closest('#booking-toggle')) setOpen(!open);
    });

    // ── Adding ────────────────────────────────────────────────────────────────

    async function addOn(date, trigger) {
      await ensureCovered([date]);
      if (!alive()) return;
      const list = others.get(date) || [];
      openDialog(
        {
          date,
          confirmed: list.filter((d) => d.status === 'confirmed'),
          pencilled: list.filter((d) => d.status === 'pencilled'),
          unknown: !isCovered(date),
          ownAlready: days.some((d) => d.date === date),
        },
        trigger,
        ({ status, overrideNote }) => {
          if (!alive()) return;
          const day = { id: newDayId(), date, status, startTime: '', endTime: '', overrideNote };
          days = sortDays(days.concat(day));
          paint();
          onChange();
          // The brief: the new card appears in date order with focus on its start time.
          focusCard(day.id, 'startTime');
          $('booking-live').textContent = WORD[status] + ' day added, ' + C.longDate(date, LSCUtil.today()) + '.';
        }
      );
    }

    function addTbc() {
      const day = { id: newDayId(), date: null, status: TBC_STATUS, startTime: '', endTime: '', overrideNote: '' };
      days = sortDays(days.concat(day));
      if (!open) setOpen(true);
      else paint();
      onChange();
      return day.id;
    }

    $('booking-add-tbc').addEventListener('click', () => focusCard(addTbc(), 'date'));

    // ── Editing a card ────────────────────────────────────────────────────────

    const cards = $('booking-cards');

    cards.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      const li = e.target.closest('[data-day-id]');
      if (!li || !(f === 'startTime' || f === 'endTime' || f === 'overrideNote')) return;
      const day = byId(li.dataset.dayId);
      day[f] = e.target.value;
      updateCard(li, day);
      if (cal) cal.setDays(calendarDays()); // the list under it shows times and notes
      onChange();
    });

    cards.addEventListener('change', async (e) => {
      const f = e.target.dataset.f;
      const li = e.target.closest('[data-day-id]');
      if (!li || !(f === 'date' || f === 'status')) return;
      const day = byId(li.dataset.dayId);
      if (f === 'status') {
        day.status = e.target.value;
        updateCard(li, day);
        if (cal) cal.setDays(calendarDays());
        paintHead();
        onChange();
        return;
      }
      // A half-typed date reads as '' here; only a whole one (or a cleared field) moves the day.
      const value = e.target.value;
      if (value && !C.isDate(value)) return;
      day.date = value || null;
      days = sortDays(days);
      paint(); // re-sorted, re-numbered; focus stays on this card's date field
      onChange();
      if (day.date) {
        await ensureCovered([day.date]);
        if (alive() && cal) cal.goTo(day.date);
      }
    });

    /* Duplicate day (B2-5, D81): a Date TBC day straight after the source,
       Proposed as TBC days start, with the source's times, so the copy is
       the near-identical second day; the editor copies its lines
       (onDuplicate). Focus goes to the copy's date, the field to fill next. */
    cards.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="duplicate"]');
      if (!btn) return;
      const i = days.findIndex((d) => d.id === btn.closest('[data-day-id]').dataset.dayId);
      if (i === -1) return;
      const src = days[i];
      const srcTitle = titleOf(src, i + 1);
      const day = { id: newDayId(), date: null, status: TBC_STATUS, startTime: src.startTime, endTime: src.endTime, overrideNote: '' };
      days.splice(i + 1, 0, day);
      days = sortDays(days);
      const n = onDuplicate(src.id, day.id);
      paint();
      onChange();
      focusCard(day.id, 'date');
      const at = days.indexOf(day);
      $('booking-live').textContent = srcTitle + ' duplicated as ' + titleOf(day, at + 1) +
        (n ? ', with its ' + (n === 1 ? 'item' : n + ' items') : '') + '.';
    });

    cards.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="remove"]');
      if (!btn) return;
      const li = btn.closest('[data-day-id]');
      const i = days.findIndex((d) => d.id === li.dataset.dayId);
      const title = titleOf(days[i], i + 1);
      // Its items go with it — production, travel, crew and gear — so the question says how many.
      const items = itemsFor(li.dataset.dayId);
      const n = items ? items.querySelectorAll('[data-rid]').length : 0;
      const what = n ? ' Its ' + (n === 1 ? 'item is' : n + ' items are') + ' removed too.' : '';
      if (!window.confirm('Remove ' + title + '?' + what)) return;
      days.splice(i, 1);
      paint();
      onChange();
      $('booking-live').textContent = title + ' removed.';
      // Focus to the card that took its place, or the one before, or the add button.
      const next = days[i] || days[i - 1];
      if (next) focusCard(next.id, 'remove');
      else $('booking-add-tbc').focus();
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
      payloadDays: () =>
        days.map((d) => ({
          id: d.id,
          date: d.date,
          status: d.status,
          startTime: d.startTime || null,
          endTime: d.endTime || null,
          overrideNote: d.overrideNote.trim(),
        })),

      /** The first day the server would refuse as it stands, opened up and ready to point at. */
      lockProblem() {
        const day = days.find(isLocked);
        if (!day) return null;
        reveal();
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

      /** Open the block and bring a day's card into view; the caller moves focus. */
      showDay(id) {
        reveal();
        const li = $('booking-cards').querySelector('[data-day-id="' + CSS.escape(id) + '"]');
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
