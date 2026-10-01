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
 *   cal.setDays(days); cal.setEmphasis(id); cal.goTo('2026-10-04');
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
  function describeDate(ymd, days, today) {
    const head = (ymd === today ? 'Today, ' : '') + longDate(ymd, today);
    if (!days || !days.length) return head + ': nothing booked';
    const parts = STATUS_ORDER.map((s) => {
      const of = days.filter((d) => d.status === s);
      return of.length ? of.length + ' ' + s + ', ' + joinAnd(of.map(upidOf)) : null;
    }).filter(Boolean);
    return head + ': ' + parts.join('; ');
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
      if (date === today) cls.push('is-today');
      if (date === st.target) cls.push('is-target');
      if (date === st.active) cls.push('is-selected');
      const extra = days.length - MAX_TILES;
      return (
        '<div role="gridcell" class="' + cls.join(' ') + '" data-date="' + date + '"' +
        ' tabindex="' + (date === st.active ? '0' : '-1') + '"' +
        ' aria-selected="' + (date === st.active) + '"' +
        (date === today ? ' aria-current="date"' : '') +
        ' aria-label="' + esc(describeDate(date, days, today)) + '">' +
        '<span class="cal-num" aria-hidden="true">' + d + '</span>' +
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
        html += '<div class="cal-row" role="row">';
        for (let i = 0; i < 7; i++) html += cellMarkup(addDays(from, w * 7 + i));
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

    function renderList() {
      if (!o.showList) return;
      const days = daysOn(st.active);
      els.listTitle.textContent = (st.active === today ? 'Today, ' : '') + longDate(st.active, today);
      els.list.innerHTML = days.length
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
        : '<p class="cal-empty">Nothing booked.</p>';
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

    if (o.showList) {
      els.list.addEventListener('click', (e) => {
        const btn = e.target.closest('.cal-entry');
        const day = btn && st.byId.get(btn.dataset.dayId);
        if (day && typeof o.onTileActivate === 'function') o.onTileActivate(day, { trigger: btn });
      });
    }

    // ── The controller ────────────────────────────────────────────────────────

    const api = {
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
      /** Draw one estimate's days at full strength, listed first; every other one faded. */
      setEmphasis(estimateId) {
        st.emphasis = estimateId || null;
        if (st.emphasis) {
          // A stable sort: the server's order (time, then UPID) holds within each group.
          st.byDate.forEach((list) => list.sort((a, b) => Number(isOwn(b)) - Number(isOwn(a))));
        }
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

  return { mount, statusChip, describeDate, timeText, gridRange, longDate, shortDate, addDays, addMonths, isDate };
})();
