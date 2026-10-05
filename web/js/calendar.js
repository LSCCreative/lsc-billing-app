'use strict';

/* The month calendar: one shared view of every booked production day.
 *
 * Built for the estimate editor's Production Booking block (task 6: this
 * estimate at full strength, every other project's days faded, D23) and reused
 * by Home (task 12: all estimates equal). The component only draws and reports;
 * it never fetches. The caller hands it days in the shape GET /api/calendar
 * returns, and it says which range it is showing through onRangeChange.
 *
 *   const cal = LSCCalendar.mount(el, {
 *     id: 'ed-cal',                 // unique on the page; every inner id derives from it
 *     label: 'Production calendar', // the grid's accessible name, before the month
 *     emphasis: estimateId,         // or null: every day at full strength
 *     onRangeChange({ from, to }),  // the six weeks on show: fetch them
 *     onDateActivate(date, { trigger }),
 *     onTileActivate(day, { trigger }),
 *   });
 *   cal.setDays(days); cal.setRentals(rentals); cal.setEmphasis(id); cal.goTo('2026-10-04');
 *   cal.setHolidays(holidays);    // GET /api/holidays' list: { date, name, hidden }
 *
 * A day is { id, estimateId, date, status, startTime, endTime, upid,
 * projectName, client, overrideNote }. Date TBC days (date null) are on no
 * calendar (D9) and are dropped. An overnight booking sits on its start date
 * only (D21).
 *
 * THE GRID
 * An ARIA grid of six Monday-first weeks, always six, so the block's height
 * never jumps between months. One cell holds the roving tabindex: arrows move
 * by day and week, Page Up/Down by month, Home/End to the week's ends, and
 * Enter or Space activates the date. Each cell's accessible name is the whole
 * date, read as "Saturday 4 October: 1 confirmed, UPID-042", and its visible
 * contents are aria-hidden so that name is all a screen reader gets.
 *
 * TILES ARE NOT TAB STOPS
 * A tile inside a gridcell would be a second interactive layer the grid
 * pattern handles badly, and Enter is already the date's. So a tile is a
 * mouse and touch shortcut only. The keyboard (and a phone, where the cells
 * show dots, D29) reaches the same days through the list under the grid. It
 * shows the selected date's bookings as real buttons, in words, and Tab moves
 * from the grid straight into it.
 *
 * TILES OR DOTS
 * Chosen by the calendar's own width (a container query in calendar.css), not
 * the viewport: the editor's ~420px column at 1280 and a 375px phone are
 * different problems, and the viewport can't tell them apart. Both are drawn;
 * CSS shows one.
 *
 * RENTAL BARS (B2-8, D84)
 * A gear rental is a bar from its out date to its back date, under each
 * week's tiles, split where it crosses a week. A rental with one date is a
 * one-day marker, and one with neither (or back before out) is on no
 * calendar. Rentals come in the shape GET /api/calendar's `rentals` has:
 * { id, estimateId, upid, projectName, vendor, outDate, outMethod, backDate,
 * backMethod }. They follow the same emphasis as days: another project's are
 * faded. There are no clash rules (D84): a bar never blocks a date.
 *
 * Bars are a mouse and touch shortcut, like tiles, and aria-hidden: each
 * covered date's name says its gear ("gear: Lensworks for UPID-042 goes
 * out"), and the selected date's list has its gear after its bookings. A bar or its list
 * entry calls onRentalActivate(rental, { trigger, entry }); `entry` is the
 * rental's line in the list, which names it. The entry is a button only when
 * rentalActionable(rental) says so (default: whenever onRentalActivate is
 * given); otherwise it is text that can take focus. In dots mode a bar is a
 * thin line under each covered date, too thin to aim at: a tap is the date's.
 *
 * PUBLIC HOLIDAYS (task 33 DR4)
 * A holiday prices like a weekend, so it is shaded like one, and its name is
 * in the date's accessible name and the list's title ("Monday 5 October ·
 * Labour Day"); the wide layout prints it small beside the date. Hidden
 * (removed) holidays are skipped, as calc.js dayKind skips them.
 *
 * Dates are 'YYYY-MM-DD' strings throughout, with arithmetic done on UTC
 * epoch days so a daylight-saving change can never skip or repeat a date.
 */

const LSCCalendar = (() => {
  const { esc } = LSCUtil;

  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

  const STATUS_WORD = { confirmed: 'Confirmed', pencilled: 'Pencilled', proposed: 'Proposed' };
  const STATUS_ORDER = ['confirmed', 'pencilled', 'proposed'];

  // More than this in one cell and the rest become "+N".
  const MAX_TILES = 3;
  const MAX_DOTS = 3;
  const WEEKS = 6;
  // Rental bar lanes in one week. Past this, the last lane says "+N" per date.
  const MAX_LANES = 3;

  // ── Date maths ──────────────────────────────────────────────────────────────

  const pad = (n) => String(n).padStart(2, '0');
  const DAY_MS = 86400000;

  function toEpoch(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY_MS;
  }
  function fromEpoch(e) {
    const dt = new Date(e * DAY_MS);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }
  const addDays = (ymd, n) => fromEpoch(toEpoch(ymd) + n);
  // 0 = Monday … 6 = Sunday.
  const weekday = (ymd) => (new Date(toEpoch(ymd) * DAY_MS).getUTCDay() + 6) % 7;
  const monthOf = (ymd) => ymd.slice(0, 7);

  // A real calendar date, not just the right shape: '2026-02-30' is refused.
  function isDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromEpoch(toEpoch(s)) === s;
  }

  // The same day of the month n months on, clamped: 31 January + 1 month is 28 or 29 February.
  function addMonths(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return first.getUTCFullYear() + '-' + pad(first.getUTCMonth() + 1) + '-' + pad(Math.min(d, last));
  }

  // The six weeks a month is drawn across, Monday of the first week to the 42nd day.
  function gridRange(ym) {
    const first = ym + '-01';
    const from = addDays(first, -weekday(first));
    return { from, to: addDays(from, WEEKS * 7 - 1) };
  }

  // ── Words ───────────────────────────────────────────────────────────────────

  // "Saturday 4 October", with the year only when it isn't this year.
  function longDate(ymd, today) {
    const [y, m, d] = ymd.split('-').map(Number);
    const s = DAY_NAMES[weekday(ymd)] + ' ' + d + ' ' + MONTHS[m - 1];
    return today && ymd.slice(0, 4) !== today.slice(0, 4) ? s + ' ' + y : s;
  }
  // "Sat 4 Oct"
  function shortDate(ymd) {
    const [, m, d] = ymd.split('-').map(Number);
    return DAY_SHORT[weekday(ymd)] + ' ' + d + ' ' + MONTHS_SHORT[m - 1];
  }

  function joinAnd(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  const upidOf = (day) => (day.upid ? String(day.upid) : 'No UPID');

  /* GET /api/holidays' rows as date → name, the hidden ones left out. A
     holiday with no name is still one. */
  function holidayMap(list) {
    const map = new Map();
    (Array.isArray(list) ? list : []).forEach((h) => {
      if (h && isDate(h.date) && !h.hidden) map.set(h.date, String(h.name || '').trim() || 'Public holiday');
    });
    return map;
  }

  /* A booking's times in words. An end before the start runs past midnight
     (calc.js afterHoursShare, D21), and the brief wants that said, not
     implied. Equal times book no hours, so they read as the times alone. */
  function timeText(day, spoken) {
    const a = day.startTime || '';
    const b = day.endTime || '';
    const dash = spoken ? ' to ' : '–';
    if (a && b) return a + dash + b + (b < a ? (spoken ? ', ends next day' : ' (ends next day)') : '');
    if (a) return (spoken ? 'from ' : 'From ') + a;
    if (b) return (spoken ? 'until ' : 'Until ') + b;
    return spoken ? 'no times set' : 'No times set';
  }

  /**
   * A date and its bookings in one sentence, the way the grid announces it:
   * "Saturday 4 October: 1 confirmed, UPID-042". Statuses in a fixed order,
   * and only the ones present.
   */
  function describeDate(ymd, days, today, rentals, holiday) {
    const head = (ymd === today ? 'Today, ' : '') + longDate(ymd, today) + (holiday ? ', ' + holiday + ', public holiday' : '');
    const gear = (rentals || []).map((r) => r.vendor + ' for ' + upidOf(r) + ' ' + rentalRole(r, ymd));
    if ((!days || !days.length) && !gear.length) return head + ': nothing booked';
    const parts = STATUS_ORDER.map((s) => {
      const of = (days || []).filter((d) => d.status === s);
      return of.length ? of.length + ' ' + s + ', ' + joinAnd(of.map(upidOf)) : null;
    }).filter(Boolean);
    if (gear.length) parts.push('gear: ' + joinAnd(gear));
    return head + ': ' + parts.join('; ');
  }

  // ── Rentals ─────────────────────────────────────────────────────────────────

  const METHOD_WORD = { pickup: 'Pickup', postage: 'Postage', return: 'Return' };

  /* A rental as the calendar draws it, with the span it covers (`from`, `to`),
     or null for one on no calendar. */
  function normRental(r) {
    if (!r || typeof r !== 'object') return null;
    const out = isDate(r.outDate) ? r.outDate : null;
    const back = isDate(r.backDate) ? r.backDate : null;
    const from = out || back;
    const to = back || out;
    if (!from || to < from) return null;
    return {
      id: String(r.id),
      estimateId: r.estimateId,
      upid: r.upid || '',
      projectName: r.projectName || '',
      vendor: String(r.vendor || '').trim() || 'No vendor',
      outDate: out,
      outMethod: METHOD_WORD[r.outMethod] ? r.outMethod : null,
      backDate: back,
      backMethod: METHOD_WORD[r.backMethod] ? r.backMethod : null,
      from,
      to,
    };
  }

  /* What the gear is doing on a date it covers. */
  function rentalRole(r, ymd) {
    if (r.outDate && r.backDate) {
      if (r.from === r.to) return 'goes out and comes back';
      if (ymd === r.from) return 'goes out';
      if (ymd === r.to) return 'comes back';
      return 'on hire';
    }
    return r.outDate ? 'goes out' : 'comes back';
  }

  // "Out Fri 9 Oct · Pickup — Back Mon 12 Oct · Return"; the spoken form, lower case with commas.
  function rentalDates(r, spoken) {
    const end = (word, date, method) => {
      if (!date) return spoken ? 'no ' + word.toLowerCase() + ' date' : 'No ' + word.toLowerCase() + ' date';
      const m = method ? METHOD_WORD[method] : '';
      return spoken
        ? word.toLowerCase() + ' ' + shortDate(date) + (m ? ', ' + m.toLowerCase() : '')
        : word + ' ' + shortDate(date) + (m ? ' · ' + m : '');
    };
    return end('Out', r.outDate, r.outMethod) + (spoken ? '; ' : ' — ') + end('Back', r.backDate, r.backMethod);
  }

  /**
   * The status chip: the word, always, in the status colour, hatched when
   * pencilled. Shared with the day cards (task 6) and Coming up (task 12).
   */
  function statusChip(status) {
    const s = STATUS_WORD[status] ? status : 'proposed';
    return '<span class="status-chip is-' + s + '">' + STATUS_WORD[s] + '</span>';
  }

  // ── The component ──────────────────────────────────────────────────────────

  let seq = 0;

  function mount(root, options) {
    const o = Object.assign(
      {
        id: 'cal' + ++seq,
        label: 'Production calendar',
        emphasis: null,
        today: null,
        selected: null,
        showList: true,
        onRangeChange: null,
        onDateActivate: null,
        onTileActivate: null,
        onRentalActivate: null,
        rentalActionable: null,
      },
      options || {}
    );
    const id = o.id;
    const today = isDate(o.today) ? o.today : LSCUtil.today();

    const st = {
      active: isDate(o.selected) ? o.selected : today, // the selected date, and the grid's tab stop
      view: null, // 'YYYY-MM' on show
      target: null, // the date "Go to date" last jumped to, washed in accent
      emphasis: o.emphasis || null,
      byDate: new Map(),
      byId: new Map(),
      rentals: [], // normalised, own first (see sortRentals)
      rentalSig: '[]',
      holidays: new Map(), // date → name
    };
    st.view = monthOf(st.active);

    root.classList.add('cal');
    root.innerHTML =
      '<div class="cal-bar">' +
      '<p class="cal-title" id="' + esc(id) + '-title"></p>' +
      '<div class="cal-nav">' +
      '<button type="button" class="cal-btn cal-prev" aria-label="Previous month"><span aria-hidden="true">‹</span></button>' +
      '<button type="button" class="cal-btn cal-today">Today</button>' +
      '<button type="button" class="cal-btn cal-next" aria-label="Next month"><span aria-hidden="true">›</span></button>' +
      '</div>' +
      '<label class="cal-goto"><span class="cal-goto-label">Go to date</span>' +
      '<input type="date" class="cal-goto-inp" id="' + esc(id) + '-goto"></label>' +
      '</div>' +
      '<div class="cal-grid" role="grid" aria-labelledby="' + esc(id) + '-title" aria-describedby="' + esc(id) + '-keys">' +
      '<div class="cal-row cal-head" role="row">' +
      DAY_NAMES.map((n, i) =>
        '<div class="cal-colhead' + (i > 4 ? ' is-weekend' : '') + '" role="columnheader" aria-label="' + n + '">' +
        '<span aria-hidden="true">' + DAY_SHORT[i] + '</span></div>'
      ).join('') +
      '</div>' +
      '<div class="cal-body" role="rowgroup"></div>' +
      '</div>' +
      '<p class="sr-only" id="' + esc(id) + '-keys">Arrow keys move by day and week, Page Up and Page Down by month, ' +
      'Home and End to the start and end of the week. Enter chooses the date.</p>' +
      (o.showList
        ? '<div class="cal-list" role="region" aria-labelledby="' + esc(id) + '-list-title">' +
          '<p class="cal-list-title" id="' + esc(id) + '-list-title"></p><div class="cal-list-body"></div></div>'
        : '') +
      '<div class="sr-only" aria-live="polite" id="' + esc(id) + '-live"></div>';

    const $ = (sel) => root.querySelector(sel);
    const els = {
      title: $('.cal-title'),
      body: $('.cal-body'),
      goto: $('.cal-goto-inp'),
      listTitle: $('.cal-list-title'),
      list: $('.cal-list-body'),
      live: $('#' + CSS.escape(id) + '-live'),
    };

    const daysOn = (date) => st.byDate.get(date) || [];
    const isOwn = (day) => st.emphasis && day.estimateId === st.emphasis;
    const isFaded = (day) => !!st.emphasis && day.estimateId !== st.emphasis;
    const rentalsOn = (date) => st.rentals.filter((r) => r.from <= date && date <= r.to);

    // This estimate's first, then by out date, the longer first, then vendor: the lane order.
    function sortRentals() {
      st.rentals.sort((a, b) =>
        Number(Boolean(isOwn(b))) - Number(Boolean(isOwn(a))) ||
        (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) ||
        (toEpoch(b.to) - toEpoch(a.to)) ||
        a.vendor.localeCompare(b.vendor));
    }

    function rentalLabel(r) {
      return 'Gear rental: ' + r.vendor + ', ' + upidOf(r) + (r.projectName ? ', ' + r.projectName : '') + ', ' +
        rentalDates(r, true) + (isOwn(r) ? ', this estimate' : '');
    }

    const rentalActionable = (r) => typeof o.onRentalActivate === 'function' &&
      (typeof o.rentalActionable !== 'function' || Boolean(o.rentalActionable(r)));

    /* One week's bars: each rental crossing it is a segment from its first to
       its last column there, in the first lane free for it. */
    function weekBars(weekFrom) {
      const weekTo = addDays(weekFrom, 6);
      const base = toEpoch(weekFrom);
      const lanes = []; // lane → last column taken
      const segs = st.rentals.filter((r) => r.from <= weekTo && r.to >= weekFrom).map((r) => {
        const s = Math.max(0, toEpoch(r.from) - base);
        const e = Math.min(6, toEpoch(r.to) - base);
        let lane = lanes.findIndex((end) => end < s);
        if (lane === -1) lane = lanes.length;
        lanes[lane] = e;
        return { r, s, e, lane, contL: r.from < weekFrom, contR: r.to > weekTo };
      });
      if (!segs.length) return { lanes: 0, html: '' };
      const over = lanes.length > MAX_LANES;
      const keep = over ? MAX_LANES - 1 : MAX_LANES;
      let html = segs.filter((g) => g.lane < keep).map((g) => {
        const cls = ['cal-rbar'];
        if (isFaded(g.r)) cls.push('is-faded');
        if (g.contL) cls.push('is-cont-l');
        if (g.contR) cls.push('is-cont-r');
        return '<span class="' + cls.join(' ') + '" data-rental-id="' + esc(g.r.id) + '"' +
          ' style="--s:' + g.s + ';--e:' + g.e + ';--lane:' + g.lane + '" title="' + esc(rentalLabel(g.r)) + '">' +
          '<span class="cal-rbar-t">' + esc(g.r.vendor + ' · ' + upidOf(g.r)) + '</span></span>';
      }).join('');
      if (over) {
        for (let c = 0; c < 7; c++) {
          const n = segs.filter((g) => g.lane >= keep && g.s <= c && c <= g.e).length;
          if (n) {
            html += '<span class="cal-rbar-more" data-date="' + addDays(weekFrom, c) + '"' +
              ' style="--s:' + c + ';--e:' + c + ';--lane:' + keep + '">+' + n + ' gear</span>';
          }
        }
      }
      return { lanes: Math.min(lanes.length, MAX_LANES), html };
    }

    function entryLabel(day) {
      return STATUS_WORD[day.status] + ': ' + upidOf(day) +
        (day.projectName ? ', ' + day.projectName : '') + ', ' + shortDate(day.date) + ', ' +
        timeText(day, true) + (isOwn(day) ? ', this estimate' : '');
    }

    function tileMarkup(day) {
      return (
        '<span class="cal-tile is-' + day.status + (isFaded(day) ? ' is-faded' : '') + '"' +
        ' data-day-id="' + esc(day.id) + '" title="' + esc(entryLabel(day)) + '">' +
        '<span class="cal-tile-upid">' + esc(upidOf(day)) + '</span>' +
        (day.projectName ? '<span class="cal-tile-name">' + esc(day.projectName) + '</span>' : '') +
        '</span>'
      );
    }

    function cellMarkup(date) {
      const days = daysOn(date);
      const [, , d] = date.split('-').map(Number);
      const cls = ['cal-cell'];
      if (monthOf(date) !== st.view) cls.push('is-out');
      if (weekday(date) > 4) cls.push('is-weekend');
      const holiday = st.holidays.get(date);
      if (holiday) cls.push('is-holiday');
      if (date === today) cls.push('is-today');
      if (date === st.target) cls.push('is-target');
      if (date === st.active) cls.push('is-selected');
      const extra = days.length - MAX_TILES;
      return (
        '<div role="gridcell" class="' + cls.join(' ') + '" data-date="' + date + '"' +
        ' tabindex="' + (date === st.active ? '0' : '-1') + '"' +
        ' aria-selected="' + (date === st.active) + '"' +
        (date === today ? ' aria-current="date"' : '') +
        ' aria-label="' + esc(describeDate(date, days, today, rentalsOn(date), holiday)) + '">' +
        (holiday
          ? '<span class="cal-numrow" aria-hidden="true"><span class="cal-num">' + d + '</span>' +
            '<span class="cal-hol" title="' + esc(holiday) + '">' + esc(holiday) + '</span></span>'
          : '<span class="cal-num" aria-hidden="true">' + d + '</span>') +
        '<span class="cal-tiles" aria-hidden="true">' +
        days.slice(0, extra > 0 ? MAX_TILES - 1 : MAX_TILES).map(tileMarkup).join('') +
        (extra > 0 ? '<span class="cal-more">+' + (extra + 1) + ' more</span>' : '') +
        '</span>' +
        '<span class="cal-dots" aria-hidden="true">' +
        days.slice(0, MAX_DOTS).map((day) =>
          '<span class="cal-dot is-' + day.status + (isFaded(day) ? ' is-faded' : '') + '"></span>'
        ).join('') +
        (days.length > MAX_DOTS ? '<span class="cal-dot-more">+' + (days.length - MAX_DOTS) + '</span>' : '') +
        '</span>' +
        '</div>'
      );
    }

    function renderGrid(slide) {
      const hadFocus = root.querySelector('.cal-body').contains(document.activeElement);
      const { from } = gridRange(st.view);
      let html = '';
      for (let w = 0; w < WEEKS; w++) {
        const weekFrom = addDays(from, w * 7);
        const bars = weekBars(weekFrom);
        html += '<div class="cal-row" role="row"' + (bars.lanes ? ' style="--lanes:' + bars.lanes + '"' : '') + '>';
        for (let i = 0; i < 7; i++) html += cellMarkup(addDays(weekFrom, i));
        if (bars.html) html += '<div class="cal-rbars" aria-hidden="true">' + bars.html + '</div>';
        html += '</div>';
      }
      els.body.innerHTML = html;
      const [y, m] = st.view.split('-').map(Number);
      // Seen as "October 2026"; the grid's name is "Production calendar, October 2026".
      els.title.innerHTML = '<span class="sr-only">' + esc(o.label) + ', </span>' +
        esc(MONTHS[m - 1]) + ' <span class="cal-year">' + y + '</span>';
      if (slide) {
        els.body.classList.remove('slide-next', 'slide-prev');
        void els.body.offsetWidth; // restart the animation on a quick second press
        els.body.classList.add(slide > 0 ? 'slide-next' : 'slide-prev');
      }
      if (hadFocus) activeCell().focus();
    }

    function rentalEntryMarkup(r) {
      const role = rentalRole(r, st.active);
      const inner =
        '<span class="status-chip is-rental">Gear</span>' +
        '<span class="cal-entry-main">' +
        '<span class="cal-entry-upid">' + esc(r.vendor) + '</span>' +
        '<span class="cal-entry-name">' + esc(upidOf(r)) + (r.projectName ? ' · ' + esc(r.projectName) : '') + '</span>' +
        '</span>' +
        '<span class="cal-entry-time">' + esc(role.charAt(0).toUpperCase() + role.slice(1)) + '</span>' +
        '<span class="cal-entry-note">' + esc(rentalDates(r)) + '</span>';
      const cls = 'cal-entry cal-rentry' + (isFaded(r) ? ' is-faded' : '') + (isOwn(r) ? ' is-own' : '');
      return '<li>' + (rentalActionable(r)
        ? '<button type="button" class="' + cls + '" data-rental-id="' + esc(r.id) + '"' +
          ' aria-label="' + esc(rentalLabel(r) + ', ' + role) + '">' + inner + '</button>'
        // Not something to press here, but a bar click brings focus to it, so it names the rental.
        : '<div class="' + cls + '" data-rental-id="' + esc(r.id) + '" tabindex="-1">' + inner + '</div>') +
        '</li>';
    }

    function renderList() {
      if (!o.showList) return;
      const days = daysOn(st.active);
      const gear = rentalsOn(st.active);
      const holiday = st.holidays.get(st.active);
      els.listTitle.textContent = (st.active === today ? 'Today, ' : '') + longDate(st.active, today) +
        (holiday ? ' · ' + holiday : '');
      els.list.innerHTML = (days.length
        ? '<ul class="cal-entries">' +
          days.map((day) =>
            '<li><button type="button" class="cal-entry' + (isFaded(day) ? ' is-faded' : '') + (isOwn(day) ? ' is-own' : '') + '"' +
            ' data-day-id="' + esc(day.id) + '" aria-label="' + esc(entryLabel(day)) + '">' +
            statusChip(day.status) +
            '<span class="cal-entry-main">' +
            '<span class="cal-entry-upid">' + esc(upidOf(day)) + '</span>' +
            (day.projectName ? '<span class="cal-entry-name">' + esc(day.projectName) + '</span>' : '') +
            (day.client ? '<span class="cal-entry-client">' + esc(day.client) + '</span>' : '') +
            '</span>' +
            '<span class="cal-entry-time">' + esc(timeText(day)) + '</span>' +
            (day.overrideNote ? '<span class="cal-entry-note">Note: ' + esc(day.overrideNote) + '</span>' : '') +
            '</button></li>'
          ).join('') +
          '</ul>'
        : gear.length ? '' : '<p class="cal-empty">Nothing booked.</p>') +
        (gear.length
          // Each line's chip says "Gear", so the list needs no visible heading of its own.
          ? '<ul class="cal-entries cal-gear" aria-label="Gear rentals">' + gear.map(rentalEntryMarkup).join('') + '</ul>'
          : '');
    }

    function render(slide) {
      renderGrid(slide);
      renderList();
    }

    const activeCell = () => els.body.querySelector('[data-date="' + st.active + '"]');

    function fireRange() {
      if (typeof o.onRangeChange === 'function') o.onRangeChange(Object.assign({ month: st.view }, gridRange(st.view)));
    }

    /* Select a date, bringing its month into view when it isn't. Focus follows
       only when asked (the grid's own keys); the toolbar keeps its focus. */
    function moveTo(date, focus) {
      const month = monthOf(date);
      const changed = month !== st.view;
      const slide = changed ? (month > st.view ? 1 : -1) : 0;
      st.active = date;
      st.view = month;
      render(slide);
      if (focus) activeCell().focus();
      if (changed) {
        const [y, m] = month.split('-').map(Number);
        els.live.textContent = MONTHS[m - 1] + ' ' + y;
        fireRange();
      }
    }

    function activateDate(date) {
      if (date !== st.active || monthOf(date) !== st.view) moveTo(date, root.querySelector('.cal-body').contains(document.activeElement));
      if (typeof o.onDateActivate === 'function') o.onDateActivate(date, { trigger: activeCell() });
    }

    // ── Events: delegated once, so re-rendering never drops a listener ────────

    root.querySelector('.cal-prev').addEventListener('click', () => moveTo(addMonths(st.active, -1), false));
    root.querySelector('.cal-next').addEventListener('click', () => moveTo(addMonths(st.active, 1), false));
    root.querySelector('.cal-today').addEventListener('click', () => moveTo(today, false));

    /* "change" fires once a whole date is in the field (typed or picked), never
       on a half-typed one, so the calendar doesn't lurch about mid-entry. */
    els.goto.addEventListener('change', () => {
      if (isDate(els.goto.value)) api.goTo(els.goto.value);
    });

    els.body.addEventListener('click', (e) => {
      // A bar sits over the foot of its week's cells: the date under the pointer is the one chosen.
      const bar = e.target.closest('.cal-rbar');
      const rental = bar && st.rentals.find((r) => r.id === bar.dataset.rentalId);
      if (rental) {
        const row = bar.closest('.cal-row');
        const box = row.getBoundingClientRect();
        const col = Math.min(6, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * 7)));
        let date = row.querySelectorAll('[role="gridcell"]')[col].dataset.date;
        if (date < rental.from) date = rental.from;
        if (date > rental.to) date = rental.to;
        if (date !== st.active || monthOf(date) !== st.view) moveTo(date, true);
        activateRental(rental, activeCell());
        return;
      }
      // "+N gear": the date, so its list shows every rental. Never a booking.
      const more = e.target.closest('.cal-rbar-more');
      if (more) {
        moveTo(more.dataset.date, true);
        return;
      }
      const cell = e.target.closest('[role="gridcell"]');
      if (!cell) return;
      const tile = e.target.closest('.cal-tile');
      const day = tile && st.byId.get(tile.dataset.dayId);
      if (day) {
        if (cell.dataset.date !== st.active) moveTo(cell.dataset.date, true);
        if (typeof o.onTileActivate === 'function') o.onTileActivate(day, { trigger: activeCell() });
        return;
      }
      activateDate(cell.dataset.date);
    });

    els.body.addEventListener('keydown', (e) => {
      const cell = e.target.closest('[role="gridcell"]');
      if (!cell || e.altKey || e.ctrlKey || e.metaKey) return;
      const d = cell.dataset.date;
      let next = null;
      switch (e.key) {
        case 'ArrowLeft': next = addDays(d, -1); break;
        case 'ArrowRight': next = addDays(d, 1); break;
        case 'ArrowUp': next = addDays(d, -7); break;
        case 'ArrowDown': next = addDays(d, 7); break;
        case 'PageUp': next = addMonths(d, e.shiftKey ? -12 : -1); break;
        case 'PageDown': next = addMonths(d, e.shiftKey ? 12 : 1); break;
        case 'Home': next = addDays(d, -weekday(d)); break;
        case 'End': next = addDays(d, 6 - weekday(d)); break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          activateDate(d);
          return;
        default:
          return;
      }
      e.preventDefault();
      moveTo(next, true);
    });

    function activateRental(rental, trigger) {
      const entry = o.showList ? els.list.querySelector('.cal-rentry[data-rental-id="' + CSS.escape(rental.id) + '"]') : null;
      if (typeof o.onRentalActivate === 'function') o.onRentalActivate(rental, { trigger, entry });
      else if (entry) entry.focus();
    }

    if (o.showList) {
      els.list.addEventListener('click', (e) => {
        const rb = e.target.closest('button.cal-rentry');
        const rental = rb && st.rentals.find((r) => r.id === rb.dataset.rentalId);
        if (rental) {
          activateRental(rental, rb);
          return;
        }
        const btn = e.target.closest('.cal-entry');
        const day = btn && st.byId.get(btn.dataset.dayId);
        if (day && typeof o.onTileActivate === 'function') o.onTileActivate(day, { trigger: btn });
      });
    }

    // ── The controller ────────────────────────────────────────────────────────

    const api = {
      /** Shade and name the public holidays (task 33 DR4). Hidden ones are skipped. */
      setHolidays(list) {
        const map = holidayMap(list);
        if (JSON.stringify([...map]) === JSON.stringify([...st.holidays])) return;
        st.holidays = map;
        render(0);
      },
      /** Replace every day on the calendar. Days for dates not on show are kept, harmlessly. */
      setDays(days) {
        st.byDate = new Map();
        st.byId = new Map();
        (Array.isArray(days) ? days : []).forEach((day) => {
          if (!day || !isDate(day.date) || !STATUS_WORD[day.status]) return;
          st.byId.set(String(day.id), day);
          if (!st.byDate.has(day.date)) st.byDate.set(day.date, []);
          st.byDate.get(day.date).push(day);
        });
        api.setEmphasis(st.emphasis);
      },
      /**
       * Replace every rental bar. Called as often as the caller likes (the
       * editor does on each keystroke): an unchanged set draws nothing.
       */
      setRentals(rentals) {
        const list = (Array.isArray(rentals) ? rentals : []).map(normRental).filter(Boolean);
        const sig = JSON.stringify(list);
        if (sig === st.rentalSig) return;
        st.rentalSig = sig;
        st.rentals = list;
        sortRentals();
        render(0);
      },
      /** Draw one estimate's days at full strength, listed first; every other one faded. */
      setEmphasis(estimateId) {
        st.emphasis = estimateId || null;
        if (st.emphasis) {
          // A stable sort: the server's order (time, then UPID) holds within each group.
          st.byDate.forEach((list) => list.sort((a, b) => Number(isOwn(b)) - Number(isOwn(a))));
        }
        sortRentals();
        render(0);
      },
      /** Jump to a date's month, select it and wash it in accent until the next jump ("Go to date"). */
      goTo(date) {
        if (!isDate(date)) return;
        st.target = date;
        if (els.goto.value !== date) els.goto.value = date;
        moveTo(date, false);
      },
      range: () => gridRange(st.view),
      get selected() {
        return st.active;
      },
      /** The grid's tab stop, for a caller returning focus to the calendar. */
      focus() {
        activeCell().focus();
      },
    };

    render(0);
    fireRange();
    return api;
  }

  /* weekday through upidOf are for Home and its week view (task 12), so a
     booking or a rental reads the same in every view. */
  return {
    mount, statusChip, describeDate, timeText, gridRange, longDate, shortDate, addDays, addMonths, isDate,
    weekday, normRental, rentalRole, rentalDates, upidOf, holidayMap, STATUS_WORD, MONTHS, DAY_SHORT,
  };
})();
