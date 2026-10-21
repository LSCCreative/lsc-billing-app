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
 *     quietGear: false,             // Home: every bar outlined, lists name gear on its ends (DR5)
 *     size: null,                   // 'compact' or 'full': draws Expand / Collapse in the bar
 *     onSizeChange(size),           // the button was pressed: remember it
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
 * the viewport: a calendar in a narrow panel and a 375px phone are
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
 * QUIET GEAR (task 33 DR5)
 * On Home, where every booking is at full strength, a solid blue bar was the
 * loudest thing on the board. `quietGear` draws every bar in the outlined
 * style other projects' get in the editor, and the date list gives a rental a
 * full entry only on its out and back days; between, it is one muted
 * "On hire" line (gearSplit, onHireLine; the week view uses them too).
 *
 * PUBLIC HOLIDAYS (task 33 DR4)
 * A holiday prices like a weekend, so it is shaded like one, and its name is
 * in the date's accessible name and the list's title ("Monday 5 October ·
 * Labour Day"); the wide layout prints it small beside the date. Hidden
 * (removed) holidays are skipped, as calc.js dayKind skips them.
 *
 * GOOGLE CALENDAR (trip-planner task 13, G2, G3)
 * setGoogle(events) takes GET /api/calendar's `google` list (Sydney dates and
 * HH:MM, worked out on the NAS). A timed event is a faded tile after the
 * date's bookings, with its calendar's colour as a dot; an all-day or
 * multi-day one is a thin band under the date on each date it covers; in dots
 * mode each is a short dash. They are in the date's accessible name and in
 * the list under the grid as plain text, not buttons: nothing can be done to
 * them here, and they never block or warn (G3). A tile or band click opens a
 * small read-only pop-up (openGooglePop) instead of the date's own action.
 * slots() hands Calendars ▾ (gcal-menu.js) its place in the bar and the quiet
 * line under it.
 *
 * COMPACT OR FULL (production-day-booking)
 * The editor's calendar is a picker, so it opens short: `size: 'compact'`
 * halves the wide layout's cells, each tile one line (UPID and name), two to
 * a date before "+N more". Expand gives back the full board and Collapse
 * takes it away again; the caller remembers the choice (onSizeChange). With
 * no `size` (Home) there is no button and the board is always full. Under
 * 400px the dots layout is already the touch minimum, so both sizes are the
 * same there and calendar.css hides the button.
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
  const MAX_TILES_COMPACT = 2;
  // Grow and shrink arrows (24px viewBox): the size button here, Home's own size controls.
  const SIZE_ICON = {
    grow: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
    shrink: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
  };
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

  /* A date's rentals split for a list (DR5): `ends`, going out or coming back
     that day, get a full entry; `onHire` are only out on hire. */
  function gearSplit(rentals, ymd) {
    const ends = [];
    const onHire = [];
    (rentals || []).forEach((r) => (rentalRole(r, ymd) === 'on hire' ? onHire : ends).push(r));
    return { ends, onHire };
  }
  // "On hire: CameraHire Co (HCC-031), Lemac (NBK-014)", or '' for none.
  function onHireLine(rentals) {
    if (!rentals.length) return '';
    return '<p class="cal-onhire">On hire: ' +
      esc(joinAnd(rentals.map((r) => r.vendor + ' (' + upidOf(r) + ')'))) + '</p>';
  }

  // ── Google Calendar events (trip-planner task 13, G2, G3) ──────────────────

  const HEX = /^#[0-9a-f]{6}$/i;
  const HHMM = /^\d{2}:\d{2}$/;

  /* An event as GET /api/calendar's `google` has it, checked, or null. */
  function normGoogle(ev) {
    if (!ev || typeof ev !== 'object' || !ev.id || !isDate(ev.date)) return null;
    const endDate = isDate(ev.endDate) && ev.endDate >= ev.date ? ev.endDate : ev.date;
    return {
      id: String(ev.id),
      calendarId: String(ev.calendarId || ''),
      calendar: String(ev.calendar || '').trim() || 'Google Calendar',
      colour: HEX.test(ev.colour || '') ? ev.colour : null,
      title: String(ev.title || '').trim() || '(No title)',
      date: ev.date,
      endDate,
      startTime: !ev.allDay && HHMM.test(ev.startTime || '') ? ev.startTime : null,
      endTime: !ev.allDay && HHMM.test(ev.endTime || '') ? ev.endTime : null,
      allDay: Boolean(ev.allDay) || !HHMM.test(ev.startTime || ''),
    };
  }

  /* All-day, or running over more than one date: drawn as a band across the
     top of each date it covers, as Google itself draws them, not as a tile. */
  const isBand = (ev) => ev.allDay || ev.endDate > ev.date;

  /* Its times in words. Visible: "09:30–10:15", "All day", "Fri 23 Oct 08:00 –
     Sat 24 Oct 18:00", "All day, Fri 16 – Sun 18 Oct". Spoken: lower case,
     "to" for the dash. */
  function googleTime(ev, spoken) {
    const to = spoken ? ' to ' : '–';
    if (ev.allDay) {
      if (ev.endDate === ev.date) return spoken ? 'all day' : 'All day';
      return (spoken ? 'all day, ' : 'All day, ') + shortDate(ev.date) + (spoken ? ' to ' : ' – ') + shortDate(ev.endDate);
    }
    if (ev.endDate > ev.date) {
      return shortDate(ev.date) + ' ' + ev.startTime + (spoken ? ' to ' : ' – ') + shortDate(ev.endDate) + ' ' + ev.endTime;
    }
    return ev.endTime && ev.endTime !== ev.startTime ? ev.startTime + to + ev.endTime : ev.startTime;
  }

  // "Client call, 09:30 to 10:15, Crew bookings": a tile's title and an event's name in a sentence.
  const googleLabel = (ev) => ev.title + ', ' + googleTime(ev, true) + ', ' + ev.calendar;

  const swatch = (ev) => '<span class="cal-gdot" aria-hidden="true"' + (ev.colour ? ' style="--g:' + ev.colour + '"' : '') + '></span>';

  /* A Google event in a date's list: read in place, never a button (there is
     nothing to do with it here, G3). The chip says where it's from. */
  function googleEntryMarkup(ev) {
    return '<li><div class="cal-entry cal-gentry">' +
      '<span class="cal-gchip">' + swatch(ev) + 'Google</span>' +
      '<span class="cal-entry-main"><span class="cal-entry-gtitle">' + esc(ev.title) + '</span>' +
      '<span class="cal-entry-client">' + esc(ev.calendar) + '</span></span>' +
      '<span class="cal-entry-time">' + esc(googleTime(ev)) + '</span>' +
      '</div></li>';
  }
  function googleListMarkup(events) {
    return events.length
      ? '<ul class="cal-entries cal-glist" aria-label="From Google Calendar">' + events.map(googleEntryMarkup).join('') + '</ul>'
      : '';
  }

  /* The small read-only pop-up a Google tile or band opens (brief: title,
     time, calendar). Not modal: a click outside, Esc, Tab away or the route
     changing closes it, and Esc puts focus back on `trigger`. One at a time,
     for every calendar on the page. */
  const gpop = { el: null, trigger: null };

  function closeGooglePop(returnFocus) {
    const el = gpop.el;
    if (!el) return;
    gpop.el = null;
    document.removeEventListener('pointerdown', onGpopOutside, true);
    window.removeEventListener('hashchange', onGpopHash);
    el.remove();
    if (returnFocus && gpop.trigger && gpop.trigger.isConnected) gpop.trigger.focus();
    gpop.trigger = null;
  }
  function onGpopOutside(e) {
    if (gpop.el && !gpop.el.contains(e.target)) closeGooglePop(false);
  }
  function onGpopHash() {
    closeGooglePop(false);
  }

  let gpopSeq = 0;
  function openGooglePop(ev, anchor, trigger, today) {
    closeGooglePop(false);
    const n = ++gpopSeq;
    const el = document.createElement('div');
    el.className = 'cal-gpop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'cal-gpop-t' + n);
    el.innerHTML =
      '<p class="cal-gpop-from">' + swatch(ev) + '<span>' + esc(ev.calendar) + '</span></p>' +
      '<h3 class="cal-gpop-title" id="cal-gpop-t' + n + '">' + esc(ev.title) + '</h3>' +
      '<p class="cal-gpop-when">' + esc(ev.endDate > ev.date
        ? googleTime(ev)
        : longDate(ev.date, today) + ' · ' + googleTime(ev)) + '</p>' +
      '<p class="cal-gpop-note">From Google Calendar. Change it there.</p>' +
      '<button type="button" class="cal-gpop-x" aria-label="Close"><span aria-hidden="true">×</span></button>';
    document.body.appendChild(el);
    gpop.el = el;
    gpop.trigger = trigger || null;

    // Under the anchor, else above it; kept inside the window's width.
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const below = r.bottom + 6 + h <= window.innerHeight - 8 || r.top - 6 - h < 8;
    el.style.left = Math.round(left + window.scrollX) + 'px';
    el.style.top = Math.round((below ? r.bottom + 6 : r.top - 6 - h) + window.scrollY) + 'px';

    el.querySelector('.cal-gpop-x').addEventListener('click', () => closeGooglePop(true));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeGooglePop(true);
      }
    });
    el.addEventListener('focusout', (e) => {
      if (gpop.el === el && e.relatedTarget && !el.contains(e.relatedTarget)) closeGooglePop(false);
    });
    document.addEventListener('pointerdown', onGpopOutside, true);
    window.addEventListener('hashchange', onGpopHash);
    el.querySelector('.cal-gpop-x').focus();
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
        quietGear: false,
        size: null,
        onSizeChange: null,
      },
      options || {}
    );
    const sizable = o.size === 'compact' || o.size === 'full';
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
      google: [], // normGoogle'd events from the switched-on Google calendars (task 13)
      googleSig: '[]',
      size: o.size === 'compact' ? 'compact' : 'full',
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
      // Calendars ▾ goes here (gcal-menu.js), and its quiet line under the bar.
      // With a size button, the two are one group, so neither wraps onto a row alone.
      (sizable
        ? '<div class="cal-acts"><div class="cal-tools"></div><button type="button" class="cal-btn cal-size"></button></div>'
        : '<div class="cal-tools"></div>') +
      '</div>' +
      '<p class="cal-gnote" role="status" hidden></p>' +
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
    const googleOn = (date) => st.google.filter((ev) => ev.date <= date && date <= ev.endDate);
    const gById = (gid) => st.google.find((ev) => ev.id === gid);

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
        if (o.quietGear || isFaded(g.r)) cls.push('is-faded');
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

    function gTileMarkup(ev) {
      return '<span class="cal-tile cal-gtile" data-gid="' + esc(ev.id) + '" title="' + esc(googleLabel(ev)) + '">' +
        swatch(ev) + '<span class="cal-tile-upid">' + esc(ev.startTime + ' ' + ev.title) + '</span></span>';
    }

    // Two bands a date, then "+N": the cell is for bookings first.
    const MAX_BANDS = 2;
    function gBandsMarkup(bands, date) {
      if (!bands.length) return '';
      const over = bands.length > MAX_BANDS;
      return '<span class="cal-gbands">' +
        bands.slice(0, over ? MAX_BANDS - 1 : MAX_BANDS).map((ev) =>
          '<span class="cal-gband' + (ev.date < date ? ' is-cont-l' : '') + (ev.endDate > date ? ' is-cont-r' : '') + '"' +
          ' data-gid="' + esc(ev.id) + '"' + (ev.colour ? ' style="--g:' + ev.colour + '"' : '') + ' title="' + esc(googleLabel(ev)) + '">' +
          '<span class="cal-gband-t">' + esc(ev.title) + '</span></span>'
        ).join('') +
        (over ? '<span class="cal-gband-more">+' + (bands.length - MAX_BANDS + 1) + ' all day</span>' : '') +
        '</span>';
    }

    /* What a cell has room for. Full: three tiles, then "+N more", under the
       all-day bands (gBandsMarkup caps those). Compact: two lines in all,
       bookings first, so a band shows only beside a single tile; past two
       lines it is one tile and "+N more" counting the bands too. */
    function fitCell(tiles, bands) {
      const compact = st.size === 'compact';
      if (!compact || !bands.length || !tiles.length) {
        const max = compact ? MAX_TILES_COMPACT : MAX_TILES;
        const over = tiles.length > max;
        return { bands, tiles: tiles.slice(0, over ? max - 1 : max), more: over ? tiles.length - max + 1 : 0 };
      }
      if (tiles.length + bands.length <= MAX_TILES_COMPACT) return { bands, tiles, more: 0 };
      const keep = MAX_TILES_COMPACT - 1;
      return { bands: [], tiles: tiles.slice(0, keep), more: tiles.length + bands.length - keep };
    }

    function cellMarkup(date) {
      const days = daysOn(date);
      const gAll = googleOn(date);
      const gBands = gAll.filter(isBand);
      const gTimed = gAll.filter((ev) => !isBand(ev));
      const tiles = days.map(tileMarkup).concat(gTimed.map(gTileMarkup));
      const dots = days.map((day) => '<span class="cal-dot is-' + day.status + (isFaded(day) ? ' is-faded' : '') + '"></span>')
        .concat(gAll.map((ev) => '<span class="cal-dot cal-gdash"' + (ev.colour ? ' style="--g:' + ev.colour + '"' : '') + '></span>'));
      const label = describeDate(date, days, today, rentalsOn(date), st.holidays.get(date)) +
        (gAll.length ? '; Google Calendar: ' + joinAnd(gAll.map((ev) => ev.title + ', ' + googleTime(ev, true))) : '');
      const [, , d] = date.split('-').map(Number);
      const cls = ['cal-cell'];
      if (monthOf(date) !== st.view) cls.push('is-out');
      if (weekday(date) > 4) cls.push('is-weekend');
      const holiday = st.holidays.get(date);
      if (holiday) cls.push('is-holiday');
      if (date === today) cls.push('is-today');
      if (date === st.target) cls.push('is-target');
      if (date === st.active) cls.push('is-selected');
      const fit = fitCell(tiles, gBands);
      return (
        '<div role="gridcell" class="' + cls.join(' ') + '" data-date="' + date + '"' +
        ' tabindex="' + (date === st.active ? '0' : '-1') + '"' +
        ' aria-selected="' + (date === st.active) + '"' +
        (date === today ? ' aria-current="date"' : '') +
        ' aria-label="' + esc(label) + '">' +
        (holiday
          ? '<span class="cal-numrow" aria-hidden="true"><span class="cal-num">' + d + '</span>' +
            '<span class="cal-hol" title="' + esc(holiday) + '">' + esc(holiday) + '</span></span>'
          : '<span class="cal-num" aria-hidden="true">' + d + '</span>') +
        '<span class="cal-tiles" aria-hidden="true">' +
        gBandsMarkup(fit.bands, date) +
        fit.tiles.join('') +
        (fit.more ? '<span class="cal-more">+' + fit.more + ' more</span>' : '') +
        '</span>' +
        '<span class="cal-dots" aria-hidden="true">' +
        dots.slice(0, MAX_DOTS).join('') +
        (dots.length > MAX_DOTS ? '<span class="cal-dot-more">+' + (dots.length - MAX_DOTS) + '</span>' : '') +
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
      const gEvents = googleOn(st.active);
      const split = o.quietGear ? gearSplit(rentalsOn(st.active), st.active) : { ends: rentalsOn(st.active), onHire: [] };
      const gear = split.ends;
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
          : '') +
        onHireLine(split.onHire) +
        // Not bookings (G3): after the app's own, each chipped "Google".
        googleListMarkup(gEvents);
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

    /* Expand / Collapse: the button names what it does next, so focus can stay
       on it and pressing again undoes it; the live region says what changed,
       as it says a new month. Home's grow and shrink arrows (SIZE_ICON). */
    const sizeBtn = root.querySelector('.cal-size');
    function paintSize() {
      root.classList.toggle('is-compact', st.size === 'compact');
      if (!sizeBtn) return;
      const grow = st.size === 'compact';
      sizeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        (grow ? SIZE_ICON.grow : SIZE_ICON.shrink) + '</svg><span>' + (grow ? 'Expand' : 'Collapse') + '</span>';
      sizeBtn.setAttribute('aria-label', (grow ? 'Expand' : 'Collapse') + ' the calendar');
    }
    paintSize();
    if (sizeBtn) {
      sizeBtn.addEventListener('click', () => {
        st.size = st.size === 'compact' ? 'full' : 'compact';
        paintSize();
        renderGrid(0); // what fits in a cell follows the size
        els.live.textContent = st.size === 'compact' ? 'Calendar collapsed' : 'Calendar expanded';
        if (typeof o.onSizeChange === 'function') o.onSizeChange(st.size);
      });
    }

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
      // A Google tile or band: its date, and the read-only pop-up beside it.
      const gEl = e.target.closest('[data-gid]');
      const ev = gEl && gById(gEl.dataset.gid);
      if (ev) {
        if (cell.dataset.date !== st.active) moveTo(cell.dataset.date, true);
        const at = activeCell();
        openGooglePop(ev, at, at, today);
        return;
      }
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
      /**
       * The switched-on Google calendars' events (trip-planner task 13), in
       * GET /api/calendar's `google` shape. Faded tiles, all-day bands, list
       * entries; never a booking (G3). An unchanged set draws nothing.
       */
      setGoogle(events) {
        const list = (Array.isArray(events) ? events : []).map(normGoogle).filter(Boolean);
        const sig = JSON.stringify(list);
        if (sig === st.googleSig) return;
        st.googleSig = sig;
        st.google = list;
        render(0);
      },
      /** Where Calendars ▾ and its quiet line go (gcal-menu.js). */
      slots: () => ({ tools: root.querySelector('.cal-tools'), note: root.querySelector('.cal-gnote'), root }),
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
    weekday, normRental, rentalRole, rentalDates, gearSplit, onHireLine, upidOf, holidayMap, STATUS_WORD, MONTHS, DAY_SHORT, SIZE_ICON,
    // Google events (task 13), for the week view
    normGoogle, isBand, googleTime, googleLabel, googleListMarkup, openGooglePop, closeGooglePop,
  };
})();
