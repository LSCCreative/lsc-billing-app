'use strict';

/* Home's week view (task 12): one Monday-first week of every estimate's booked
 * days, each placed at its times, the untimed ones at the top, and the week's
 * gear rentals as a strip above those (D84). Home only (IA, Component Reuse
 * Map); the month view is the shared js/calendar.js, and this borrows its
 * words (dates, times, status chip, rental wording) so a booking reads the
 * same in both.
 *
 *   const wk = HomeWeek.mount(el, {
 *     id: 'home-wk',
 *     anchor: '2026-10-04',         // any date in the week to show
 *     onRangeChange({ from, to }),  // the seven days on show: fetch them
 *     onTileActivate(day, { trigger }),
 *   });
 *   wk.setData(days, rentals); wk.setHolidays(holidays); wk.goTo(date); wk.anchor;
 *
 * Days and rentals are GET /api/calendar's shapes, as the month view takes.
 *
 * TWO LAYOUTS, BOTH DRAWN
 * From 600px of its own width (a container query in home.css, like the month
 * view's tiles and dots) it's a seven-column grid on an hour scale. Under that
 * it's a day-by-day list (D29), which is also the shape a phone needs. CSS shows
 * one; the other is display:none, so it's out of the tab order and the
 * accessibility tree.
 *
 * TILES ARE BUTTONS HERE
 * Unlike the month grid, this isn't an ARIA grid with its own keys, so each
 * tile is a plain button, named in words ("Pencilled: LSC-051, Acme launch,
 * Sat 10 Oct, 09:00 to 17:00"), in date then time order. Gear is a list read
 * in place and never a control: on Home a rental has nowhere to go.
 *
 * TIMES
 * A day with a start is placed at it. With no end it's an hour-long stub with
 * an open foot; an end before the start runs past midnight (D21), so it runs
 * to the foot of its column and says "ends next day". A day with no start is
 * untimed and sits at the top, with "Until 17:00" if it has an end. The scale
 * is 07:00–19:00, stretched to fit the week's earliest start and latest end.
 */

const HomeWeek = (() => {
  const C = LSCCalendar;
  const { esc } = LSCUtil;

  const { MONTHS, DAY_SHORT, STATUS_WORD, upidOf } = C;

  // The hour scale's default span, the office hours' neighbourhood.
  const SCALE_FROM = 7;
  const SCALE_TO = 19;
  // Shorter bookings are drawn this long, so a tile always has room for its UPID.
  const MIN_DRAWN = 45;
  // The foot of a column. A drawn length never runs past it.
  const MIDNIGHT = 24 * 60;

  function minutes(t) {
    const m = /^(\d{2}):(\d{2})$/.exec(t || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  const weekStart = (date) => C.addDays(date, -C.weekday(date));

  // "5 – 11 October 2026", "28 September – 4 October 2026", "28 December 2026 – 3 January 2027".
  function weekTitle(from) {
    const to = C.addDays(from, 6);
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    if (y1 !== y2) return d1 + ' ' + MONTHS[m1 - 1] + ' ' + y1 + ' – ' + d2 + ' ' + MONTHS[m2 - 1] + ' ' + y2;
    if (m1 !== m2) return d1 + ' ' + MONTHS[m1 - 1] + ' – ' + d2 + ' ' + MONTHS[m2 - 1] + ' ' + y2;
    return d1 + ' – ' + d2 + ' ' + MONTHS[m2 - 1] + ' ' + y2;
  }

  /* Where a timed day sits, in minutes from midnight. `open` is a start with
     no end; `overnight` an end before the start. */
  function span(day) {
    const a = minutes(day.startTime);
    if (a === null) return null;
    const b = minutes(day.endTime);
    if (b === null) return { a, b: Math.min(a + 60, MIDNIGHT), open: true, overnight: false };
    if (b < a) return { a, b: MIDNIGHT, open: false, overnight: true };
    return { a, b: Math.min(Math.max(b, a + MIN_DRAWN), MIDNIGHT), open: false, overnight: false };
  }

  /* Side by side when they overlap: each cluster of overlapping bookings is
     split into as many lanes as it needs at its busiest, and each booking
     takes the first lane free at its start. */
  function packColumn(items) {
    items.sort((x, y) => x.s.a - y.s.a || y.s.b - x.s.b);
    let cluster = [];
    let clusterEnd = -1;
    const close = () => {
      const lanes = cluster.reduce((n, it) => Math.max(n, it.lane + 1), 0);
      cluster.forEach((it) => (it.lanes = lanes));
      cluster = [];
    };
    items.forEach((it) => {
      if (cluster.length && it.s.a >= clusterEnd) close();
      const ends = [];
      cluster.forEach((c) => (ends[c.lane] = Math.max(ends[c.lane] || 0, c.s.b)));
      let lane = ends.findIndex((end) => end === undefined || end <= it.s.a);
      if (lane === -1) lane = ends.length;
      it.lane = lane;
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.s.b);
    });
    if (cluster.length) close();
    return items;
  }

  let seq = 0;

  function mount(root, options) {
    const o = Object.assign(
      { id: 'wk' + ++seq, label: 'Production calendar', anchor: null, today: null, onRangeChange: null, onTileActivate: null },
      options || {}
    );
    const id = o.id;
    const today = C.isDate(o.today) ? o.today : LSCUtil.today();
    const st = {
      from: weekStart(C.isDate(o.anchor) ? o.anchor : today),
      anchor: C.isDate(o.anchor) ? o.anchor : today,
      days: [],
      rentals: [],
      holidays: new Map(), // date → name (task 33 DR4), as the month view has them
    };

    root.classList.add('cal', 'wk');
    root.innerHTML =
      '<div class="cal-bar">' +
      '<p class="cal-title" id="' + esc(id) + '-title"></p>' +
      '<div class="cal-nav">' +
      '<button type="button" class="cal-btn wk-prev" aria-label="Previous week"><span aria-hidden="true">‹</span></button>' +
      '<button type="button" class="cal-btn wk-today">Today</button>' +
      '<button type="button" class="cal-btn wk-next" aria-label="Next week"><span aria-hidden="true">›</span></button>' +
      '</div>' +
      '<label class="cal-goto"><span class="cal-goto-label">Go to date</span>' +
      '<input type="date" class="cal-goto-inp" id="' + esc(id) + '-goto"></label>' +
      '</div>' +
      '<div class="wk-body" role="region" aria-labelledby="' + esc(id) + '-title"></div>' +
      '<div class="sr-only" aria-live="polite" id="' + esc(id) + '-live"></div>';

    const $ = (sel) => root.querySelector(sel);
    const els = { title: $('.cal-title'), body: $('.wk-body'), goto: $('.cal-goto-inp'), live: $('#' + CSS.escape(id) + '-live') };

    const dates = () => Array.from({ length: 7 }, (_, i) => C.addDays(st.from, i));
    const daysOn = (date) => st.days.filter((d) => d.date === date);
    const rentalsOn = (date) => st.rentals.filter((r) => r.from <= date && date <= r.to);

    function entryLabel(day) {
      return STATUS_WORD[day.status] + ': ' + upidOf(day) + (day.projectName ? ', ' + day.projectName : '') +
        ', ' + C.shortDate(day.date) + ', ' + C.timeText(day, true);
    }
    function rentalLabel(r) {
      return 'Gear rental: ' + r.vendor + ', ' + upidOf(r) + (r.projectName ? ', ' + r.projectName : '') + ', ' +
        C.rentalDates(r, true);
    }

    // ── The grid (600px and up) ─────────────────────────────────────────────

    function gearStrip() {
      const weekTo = C.addDays(st.from, 6);
      const base = dates();
      const lanes = []; // lane → last column taken
      const segs = st.rentals.filter((r) => r.from <= weekTo && r.to >= st.from).map((r) => {
        const s = Math.max(0, base.indexOf(r.from < st.from ? st.from : r.from));
        const e = r.to > weekTo ? 6 : base.indexOf(r.to);
        let lane = lanes.findIndex((end) => end < s);
        if (lane === -1) lane = lanes.length;
        lanes[lane] = e;
        return { r, s, e, lane, contL: r.from < st.from, contR: r.to > weekTo };
      });
      if (!segs.length) return { lanes: 0, html: '' };
      return {
        lanes: lanes.length,
        html: '<ul class="wk-gear" aria-label="Gear rentals this week">' + segs.map((g) =>
          '<li class="wk-rbar' + (g.contL ? ' is-cont-l' : '') + (g.contR ? ' is-cont-r' : '') + '"' +
          ' style="--s:' + g.s + ';--e:' + g.e + ';--lane:' + g.lane + '" title="' + esc(rentalLabel(g.r)) + '">' +
          '<span class="wk-rbar-t" aria-hidden="true">' + esc(g.r.vendor + ' · ' + upidOf(g.r)) + '</span>' +
          '<span class="sr-only">' + esc(rentalLabel(g.r)) + '</span></li>'
        ).join('') + '</ul>',
      };
    }

    function tileButton(day, cls, style, timeLine) {
      return '<button type="button" class="wk-tile is-' + day.status + (cls ? ' ' + cls : '') + '"' +
        ' data-day-id="' + esc(day.id) + '"' + (style ? ' style="' + style + '"' : '') +
        ' aria-label="' + esc(entryLabel(day)) + '" title="' + esc(entryLabel(day)) + '">' +
        '<span class="wk-tile-time" aria-hidden="true">' + esc(timeLine) + '</span>' +
        '<span class="wk-tile-upid" aria-hidden="true">' + esc(upidOf(day)) + '</span>' +
        (day.projectName ? '<span class="wk-tile-name" aria-hidden="true">' + esc(day.projectName) + '</span>' : '') +
        '</button>';
    }

    function gridMarkup() {
      const cols = dates().map((date) => {
        const all = daysOn(date);
        const timed = packColumn(all.map((day) => ({ day, s: span(day) })).filter((it) => it.s));
        const untimed = all.filter((day) => !span(day));
        return { date, timed, untimed };
      });

      // The scale: 07:00–19:00, stretched to the week's earliest start and latest end.
      let fromH = SCALE_FROM;
      let toH = SCALE_TO;
      cols.forEach((c) => c.timed.forEach((it) => {
        fromH = Math.min(fromH, Math.floor(it.s.a / 60));
        toH = Math.max(toH, Math.ceil(it.s.b / 60));
      }));
      toH = Math.min(24, toH);
      const fromMin = fromH * 60;
      const untimedRows = cols.reduce((n, c) => Math.max(n, c.untimed.length), 0);
      const gear = gearStrip();

      let gutter = '<div class="wk-gutter" aria-hidden="true"><div class="wk-dhead"></div>' +
        '<div class="wk-gearspace">' + (gear.lanes ? '<span class="wk-glabel">Gear</span>' : '') + '</div>' +
        '<div class="wk-untimed">' + (untimedRows ? '<span class="wk-glabel">No time</span>' : '') + '</div>' +
        '<div class="wk-timed">';
      for (let h = fromH; h < toH; h++) {
        gutter += '<span class="wk-hour" style="--h:' + (h - fromH) + '">' + String(h).padStart(2, '0') + ':00</span>';
      }
      gutter += '</div></div>';

      const columns = cols.map((c, i) => {
        const cls = ['wk-day'];
        const holiday = st.holidays.get(c.date);
        if (c.date === today) cls.push('is-today');
        if (i > 4) cls.push('is-weekend');
        if (holiday) cls.push('is-holiday');
        const [, , d] = c.date.split('-').map(Number);
        const headId = id + '-d' + i;
        return '<section class="' + cls.join(' ') + '" aria-labelledby="' + esc(headId) + '">' +
          '<div class="wk-dhead" id="' + esc(headId) + '">' +
          '<span class="sr-only">' + (c.date === today ? 'Today, ' : '') + esc(C.longDate(c.date, today)) +
          (holiday ? ', ' + esc(holiday) + ', public holiday' : '') + '</span>' +
          '<span class="wk-dow" aria-hidden="true">' + DAY_SHORT[i] + '</span>' +
          '<span class="wk-dnum" aria-hidden="true">' + d + '</span>' +
          (holiday ? '<span class="wk-dhol" aria-hidden="true" title="' + esc(holiday) + '">' + esc(holiday) + '</span>' : '') +
          '</div>' +
          '<div class="wk-gearspace"></div>' +
          '<div class="wk-untimed">' + c.untimed.map((day) => tileButton(day, '', '', day.endTime ? C.timeText(day) : 'No time')).join('') + '</div>' +
          '<div class="wk-timed">' + c.timed.map((it) => {
            const style = '--top:' + (it.s.a - fromMin) / 60 + ';--len:' + (it.s.b - it.s.a) / 60 +
              ';--lane:' + it.lane + ';--lanes:' + it.lanes;
            // Under an hour and a quarter there's room for the time and the UPID, not the name.
            const cls2 = (it.s.open ? 'is-open-end' : '') + (it.s.overnight ? ' is-overnight' : '') +
              (it.s.b - it.s.a < 75 ? ' is-short' : '') + (it.lanes > 1 ? ' is-narrow' : '');
            return tileButton(it.day, cls2.trim(), style, C.timeText(it.day));
          }).join('') + '</div>' +
          '</section>';
      }).join('');

      return '<div class="wk-grid' + (gear.lanes ? ' has-gear' : '') + (untimedRows ? ' has-untimed' : '') + '" style="--hours:' + (toH - fromH) + ';--glanes:' + gear.lanes + ';--untimed:' + untimedRows + '">' +
        gear.html + gutter + columns + '</div>';
    }

    // ── The list (under 600px, and phones, D29) ─────────────────────────────

    function listMarkup() {
      return '<ol class="wk-list">' + dates().map((date) => {
        const days = daysOn(date);
        // A rental is a full entry on its out and back days only; between, one muted line (DR5).
        const { ends: gear, onHire } = C.gearSplit(rentalsOn(date), date);
        const holiday = st.holidays.get(date);
        return '<li class="wk-lday' + (date === today ? ' is-today' : '') + '">' +
          '<h3 class="wk-lhead">' + esc(C.shortDate(date)) +
          (holiday ? ' <span class="wk-lhol">· ' + esc(holiday) + '</span>' : '') +
          (date === today ? ' <span class="wk-ltoday">Today</span>' : '') + '</h3>' +
          (days.length
            ? '<ul class="cal-entries">' + days.map((day) =>
              '<li><button type="button" class="cal-entry" data-day-id="' + esc(day.id) + '" aria-label="' + esc(entryLabel(day)) + '">' +
              C.statusChip(day.status) +
              '<span class="cal-entry-main"><span class="cal-entry-upid">' + esc(upidOf(day)) + '</span>' +
              (day.projectName ? '<span class="cal-entry-name">' + esc(day.projectName) + '</span>' : '') +
              (day.client ? '<span class="cal-entry-client">' + esc(day.client) + '</span>' : '') + '</span>' +
              '<span class="cal-entry-time">' + esc(C.timeText(day)) + '</span>' +
              '</button></li>').join('') + '</ul>'
            : gear.length ? '' : '<p class="cal-empty">Nothing booked.</p>') +
          (gear.length
            ? '<ul class="cal-entries cal-gear" aria-label="Gear rentals">' + gear.map((r) => {
              const role = C.rentalRole(r, date);
              return '<li><div class="cal-entry cal-rentry">' +
                '<span class="status-chip is-rental">Gear</span>' +
                '<span class="cal-entry-main"><span class="cal-entry-upid">' + esc(r.vendor) + '</span>' +
                '<span class="cal-entry-name">' + esc(upidOf(r)) + (r.projectName ? ' · ' + esc(r.projectName) : '') + '</span></span>' +
                '<span class="cal-entry-time">' + esc(role.charAt(0).toUpperCase() + role.slice(1)) + '</span>' +
                '<span class="cal-entry-note">' + esc(C.rentalDates(r)) + '</span></div></li>';
            }).join('') + '</ul>'
            : '') +
          C.onHireLine(onHire) +
          '</li>';
      }).join('') + '</ol>';
    }

    function render() {
      const hadFocus = els.body.contains(document.activeElement) ? document.activeElement.dataset.dayId || null : undefined;
      els.title.innerHTML = '<span class="sr-only">' + esc(o.label) + ', week of </span>' + esc(weekTitle(st.from));
      els.body.innerHTML = gridMarkup() + listMarkup();
      // A refresh under a focused tile keeps the focus on it, in whichever layout is showing.
      if (hadFocus !== undefined) {
        const again = hadFocus && Array.from(els.body.querySelectorAll('[data-day-id="' + CSS.escape(hadFocus) + '"]'))
          .find((b) => b.offsetParent !== null);
        if (again) again.focus();
      }
    }

    function fireRange() {
      if (typeof o.onRangeChange === 'function') o.onRangeChange({ from: st.from, to: C.addDays(st.from, 6) });
    }

    function moveTo(date) {
      const from = weekStart(date);
      st.anchor = date;
      if (from === st.from) return;
      st.from = from;
      render();
      els.live.textContent = 'Week of ' + weekTitle(from);
      fireRange();
    }

    root.querySelector('.wk-prev').addEventListener('click', () => moveTo(C.addDays(st.from, -7)));
    root.querySelector('.wk-next').addEventListener('click', () => moveTo(C.addDays(st.from, 7)));
    root.querySelector('.wk-today').addEventListener('click', () => moveTo(today));
    els.goto.addEventListener('change', () => {
      if (C.isDate(els.goto.value)) moveTo(els.goto.value);
    });
    els.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-day-id]');
      const day = btn && st.days.find((d) => String(d.id) === btn.dataset.dayId);
      if (day && typeof o.onTileActivate === 'function') o.onTileActivate(day, { trigger: btn });
    });

    const api = {
      /** Replace the week's days and rentals. Ones outside the week are kept, harmlessly. */
      setData(days, rentals) {
        st.days = (Array.isArray(days) ? days : [])
          .filter((d) => d && C.isDate(d.date) && STATUS_WORD[d.status])
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
            (minutes(a.startTime) ?? -1) - (minutes(b.startTime) ?? -1));
        st.rentals = (Array.isArray(rentals) ? rentals : []).map(C.normRental).filter(Boolean)
          .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.to < b.to ? 1 : a.to > b.to ? -1 : 0) ||
            a.vendor.localeCompare(b.vendor));
        render();
      },
      /** Shade and name the public holidays (task 33 DR4); GET /api/holidays' list. */
      setHolidays(list) {
        st.holidays = C.holidayMap(list);
        render();
      },
      goTo(date) {
        if (C.isDate(date)) moveTo(date);
      },
      /** The date the week was last moved to: the month view opens on it. */
      get anchor() {
        return st.anchor;
      },
    };

    render();
    fireRange();
    return api;
  }

  return { mount };
})();
