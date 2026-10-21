'use strict';

/* The Dashboard (#/home, task 12; renamed from "LSC Creative" 2026-10-17): the
 * screen the app opens on (D27).
 *
 * THE CALENDAR sits top right, small: this month in dots, one button. Pressed,
 * it grows into the full production calendar where it always was (left, 672px
 * at desktop) with a Collapse button to shrink it back; the choice is kept in
 * this browser. Full, it is every estimate's days at equal strength, in month
 * view (the shared js/calendar.js) or week view (views/home-week.js), with gear
 * rentals as bars (D84).
 *
 * THREE OVERVIEW LISTS, each its latest five with a way to the rest: Open
 * projects (GET /api/projects?stage=open: not yet paid or declined), Outstanding
 * invoices (GET /api/invoices?state=outstanding, most overdue first) and Recent
 * payments (state=paid). An invoice's amount is the one it stores, never
 * re-priced here.
 *
 * And down the right, "Coming up", the next 14 days in date order with all
 * three statuses labelled, because a proposed date tomorrow still needs a
 * decision; and "Recent activity" (D52, task 22): the last 10 times a job
 * moved on (sent, accepted, invoiced, paid, declined) across every project,
 * from GET /api/activity, worded by the same ProjectCard.activityText as the
 * folder's log.
 *
 * A tile opens a pop-up (D28): UPID, project, business, times, the day's
 * production items, and a button to the project folder. Coming up's and
 * Recent activity's rows go straight to the folder, as the IA's contextual
 * links do.
 *
 * Public holidays (task 33 DR4) are shaded and named on both views, from
 * GET /api/holidays, asked once per visit. If that fails the calendar simply
 * has no holidays marked: the bookings fetch reports any real trouble.
 *
 * Google Calendar (trip-planner task 13, G2): the calendar's range fetches ask
 * for the switched-on Google calendars' events too (google=1), drawn faded on
 * both views, and Calendars ▾ in the calendar's bar (gcal-menu.js) switches
 * them. Coming up stays bookings only: Google events aren't jobs.
 *
 * Nothing here is cached between visits except where the calendar was looking
 * and which view it was in: each visit and each month or week asks
 * GET /api/calendar for just its range (IA, Content Growth Plan), so a day
 * booked in the editor is on Home the moment you come back.
 */

const HomeView = (() => {
  const C = LSCCalendar;
  const { esc, money } = LSCUtil;

  const { STATUS_WORD } = C;
  // The strongest booking on a day marks it on the small calendar.
  const STATUS_RANK = { confirmed: 0, pencilled: 1, proposed: 2 };

  const COMING_UP_DAYS = 14;
  const ACTIVITY_COUNT = 10;
  const LIST_COUNT = 5;
  const VIEW_KEY = 'lsc-home-view';
  const SIZE_KEY = 'lsc-home-cal-size';

  const icon = (paths) => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths + '</svg>';
  const ICON = {
    open: icon('<path d="M7 17 17 7"/><path d="M7 7h10v10"/>'),
    add: icon('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    next: icon('<path d="m9 18 6-6-6-6"/>'),
    grow: icon(C.SIZE_ICON.grow),
    shrink: icon(C.SIZE_ICON.shrink),
  };

  let root = null;
  let handlers = null;
  // Where the calendar was looking, kept for the next visit in this page load.
  let anchor = null;
  let anchorDay = null; // the day `anchor` was set on, so tomorrow's first visit starts on tomorrow
  let view = readView();
  let calSize = readSize(); // 'mini' (top right) or 'full'
  let cal = null; // the month or week component on show, or the small calendar
  let rangeSeq = 0;
  /* Coming up's window, { from, to, asked }, while it waits on a calendar
     reply that covers it: the month on show usually does, so a visit is one
     fetch rather than two. */
  let upWanted = null;
  let holidays = null; // this visit's GET /api/holidays list, once it's in
  let gcal = null; // Calendars ▾ on the calendar on show
  let googleSeen = null; // the last reply's Google state, so a re-mounted view's button doesn't pop in late

  function readView() {
    return LSCUtil.readPref(VIEW_KEY, ['week'], 'month');
  }
  function saveView(v) {
    LSCUtil.savePref(VIEW_KEY, v);
  }
  function readSize() {
    return LSCUtil.readPref(SIZE_KEY, ['full'], 'mini');
  }
  function saveSize(v) {
    LSCUtil.savePref(SIZE_KEY, v);
  }

  function failureText(err) {
    return err.kind === 'network'
      ? 'the server is unreachable.'
      : (err.message || 'the server had a problem.');
  }

  // ── The tile pop-up (D28) ───────────────────────────────────────────────────

  /* A booked day opens its project's folder (D28, task 18). A day from a
     server before v13 names no project: its estimate's old address finds it. */
  const projectPath = (day) => (day.projectId
    ? '/projects/' + encodeURIComponent(day.projectId)
    : '/estimates/' + encodeURIComponent(day.estimateId));

  const pop = { overlay: null, opener: null };

  function onPopKeydown(event) {
    if (pop.overlay.closest('[hidden]')) return; // behind the login card
    if (event.key === 'Escape') return closePop(true);
    LSCModal.trapTab(pop.overlay, event);
  }
  function onPopClick(event) {
    if (event.target === pop.overlay) closePop(true);
  }

  function closePop(returnFocus) {
    const o = pop.overlay;
    if (!o || !o.classList.contains('open')) return;
    o.classList.remove('open');
    o.innerHTML = '';
    document.removeEventListener('keydown', onPopKeydown);
    o.removeEventListener('click', onPopClick);
    if (returnFocus && pop.opener && pop.opener.isConnected) pop.opener.focus();
    pop.opener = null;
  }

  function openPop(day, trigger) {
    pop.overlay = document.getElementById('modal-home-day');
    if (!pop.overlay) return;
    closePop(false);
    pop.opener = trigger || null;
    const today = LSCUtil.today();
    const items = (day.items || []).filter((n) => String(n).trim() !== '');

    pop.overlay.innerHTML =
      '<div class="modal-box hd-box" role="dialog" aria-modal="true" aria-labelledby="hd-title" aria-describedby="hd-when">' +
      '<p class="hd-when" id="hd-when">' + C.statusChip(day.status) +
      '<span>' + esc(C.longDate(day.date, today)) + '</span></p>' +
      '<h2 class="modal-title" id="hd-title"><span class="hd-upid">' + esc(day.upid || 'No UPID') + '</span>' +
      esc(day.projectName || 'Untitled estimate') + '</h2>' +
      '<dl class="hd-facts">' +
      '<div><dt>Business</dt><dd>' + esc(day.client || '—') + '</dd></div>' +
      '<div><dt>Times</dt><dd>' + esc(C.timeText(day)) + '</dd></div>' +
      (day.overrideNote ? '<div><dt>Note</dt><dd>' + esc(day.overrideNote) + '</dd></div>' : '') +
      '</dl>' +
      '<h3 class="hd-sub">Production items</h3>' +
      (items.length
        ? '<ul class="hd-items">' + items.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>'
        : '<p class="hd-none">None on this day yet.</p>') +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="hd-close">Close</button>' +
      '<button type="button" class="btn btn-accent" id="hd-open">Open project</button>' +
      '</div></div>';

    pop.overlay.classList.add('open');
    document.addEventListener('keydown', onPopKeydown);
    pop.overlay.addEventListener('click', onPopClick);
    pop.overlay.querySelector('#hd-close').addEventListener('click', () => closePop(true));
    pop.overlay.querySelector('#hd-open').addEventListener('click', () => {
      closePop(false);
      LSCRouter.go(projectPath(day));
    });
    pop.overlay.querySelector('#hd-open').focus();
  }

  // ── The calendar ────────────────────────────────────────────────────────────

  function calMessage(text, retry) {
    const box = root.querySelector('#home-cal-msg');
    if (!box) return;
    box.hidden = !text;
    box.innerHTML = text
      ? '<span>' + esc(text) + '</span>' + (retry ? '<button type="button" class="btn btn-ghost btn-sm" id="home-cal-retry">Try again</button>' : '')
      : '';
    const btn = box.querySelector('#home-cal-retry');
    if (btn) btn.addEventListener('click', retry);
  }

  const coversUp = (range) => Boolean(upWanted) && range.from <= upWanted.from && range.to >= upWanted.to;

  /* Coming up's window, taken by the first reply that covers it (or fails
     to). Null when it was already taken, or this range doesn't cover it. */
  function claimUp(range) {
    if (!coversUp(range)) return null;
    const w = upWanted;
    upWanted = null;
    return w;
  }

  /* One range's days and rentals onto whichever view asked, unless the user
     has moved on meanwhile. Off Home (the router's ticket has moved) nothing
     is touched, a 401 included: it is not this screen's to report. Still on
     Home but on another range or view, the reply can still serve Coming up. */
  async function loadRange(range, target, label, opts) {
    const mine = ++rangeSeq;
    const ticket = LSCRouter.ticket();
    // The small calendar draws bookings only: Google's events are the full calendar's.
    const google = !(opts && opts.noGoogle);
    target.range = range;
    if (coversUp(range)) upWanted.asked = true;
    const gone = () => !LSCRouter.isCurrent(ticket);
    const superseded = () => mine !== rangeSeq || cal !== target.component;
    let reply;
    try {
      reply = await LSCApi.get('/api/calendar?from=' + range.from + '&to=' + range.to + (google ? '&google=1' : '') +
        (opts && opts.refresh ? '&refresh=1' : ''));
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (gone()) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      // Coming up was waiting on this reply: it asks for itself, and says so if that fails too.
      if (claimUp(range)) loadComingUp();
      if (superseded()) return;
      calMessage('Couldn’t load the bookings for ' + label + ': ' + failureText(err), () => loadRange(range, target, label, opts));
      return;
    }
    if (gone()) return;
    if (google) googleSeen = reply;
    const days = reply.days || [];
    const w = claimUp(range);
    if (w) showComingUp(days.filter((d) => d.date >= w.from && d.date <= w.to), w.from);
    if (superseded()) return;
    calMessage('');
    target.apply(days, reply.rentals || []);
    cal.setGoogle(reply.google || []);
    if (gcal) gcal.update(reply);
  }

  function mountCalendar() {
    const slot = root.querySelector('#home-cal-slot');
    slot.className = 'home-cal-slot';
    slot.innerHTML = '';
    calMessage('');
    const today = LSCUtil.today();
    const target = { component: null, apply: null, range: null, label: '' };

    if (view === 'week') {
      cal = HomeWeek.mount(slot, {
        id: 'home-wk',
        anchor: anchor || today,
        today,
        onRangeChange: (range) => loadRange(range, target, (target.label = 'this week')),
        onTileActivate: (day, { trigger }) => openPop(day, trigger),
      });
      target.apply = (days, rentals) => cal.setData(days, rentals);
    } else {
      cal = C.mount(slot, {
        id: 'home-cal',
        label: 'Production calendar',
        emphasis: null, // every estimate at equal strength
        quietGear: true, // gear is logistics: outlined bars, listed on its ends (DR5)
        today,
        selected: anchor || today,
        onRangeChange: (range) => loadRange(range, target, (target.label = 'this month')),
        onTileActivate: (day, { trigger }) => openPop(day, trigger),
      });
      target.apply = (days, rentals) => {
        cal.setDays(days);
        cal.setRentals(rentals);
      };
    }
    /* The first onRangeChange fired inside mount(), before `cal` was set; its
       fetch only checks the target once the reply is in, by which time it is. */
    target.component = cal;
    if (holidays) cal.setHolidays(holidays);
    gcal = LSCGcalMenu.attach(cal.slots(), {
      reload: (o) => (target.range ? loadRange(target.range, target, target.label, o) : null),
    });
    if (googleSeen) gcal.update(googleSeen);
  }

  async function loadHolidays() {
    const ticket = LSCRouter.ticket();
    let reply;
    try {
      reply = await LSCApi.get('/api/holidays');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      return; // unmarked, not an error worth a message of its own
    }
    if (!LSCRouter.isCurrent(ticket)) return;
    holidays = reply.holidays || [];
    if (cal) cal.setHolidays(holidays);
  }

  function currentAnchor() {
    if (!cal || calSize !== 'full') return anchor;
    return view === 'week' ? cal.anchor : cal.selected;
  }

  function setView(next, focusBtn) {
    if (next === view) return;
    anchor = currentAnchor();
    view = next;
    saveView(next);
    root.querySelectorAll('.home-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    mountCalendar();
    if (focusBtn) focusBtn.focus();
  }

  // ── The small calendar (top right) ─────────────────────────────────────────

  /* This month's six weeks, a dot under each booked day in the shape and
     colour of its strongest booking (calendar.css .cal-dot), holidays shaded,
     today underlined. The whole card is one button that grows it into the full
     calendar; the grid is drawn inside it rather than replacing it, so a
     button that has focus keeps it when the bookings come in. */
  function mountMini(slot, today, onOpen) {
    const ym = today.slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const range = C.gridRange(ym);
    let days = [];
    let loaded = false; // the bookings are in, so the summary can say what they are
    let hols = new Map();

    slot.innerHTML =
      '<button type="button" class="dash-mini" id="dash-cal-open" aria-label="Open the full calendar"' +
      ' aria-describedby="dash-mini-sum">' +
      '<span class="dash-mini-head"><span class="dash-mini-month">' + C.MONTHS[m - 1] +
      ' <span class="dash-mini-year">' + y + '</span></span>' +
      '<span class="dash-mini-grow">' + ICON.grow + '</span></span>' +
      '<span class="dash-mini-grid" aria-hidden="true"></span>' +
      '<span class="dash-mini-sum" id="dash-mini-sum">Loading this month’s bookings…</span>' +
      '</button>';
    const grid = slot.querySelector('.dash-mini-grid');
    const sum = slot.querySelector('#dash-mini-sum');
    slot.querySelector('#dash-cal-open').addEventListener('click', onOpen);

    function draw() {
      const marks = new Map();
      days.forEach((d) => {
        if (!C.isDate(d.date) || !STATUS_WORD[d.status]) return;
        const was = marks.get(d.date);
        if (!was || STATUS_RANK[d.status] < STATUS_RANK[was]) marks.set(d.date, d.status);
      });
      let cells = C.DAY_SHORT.map((w) => '<span class="dm-wd">' + w.charAt(0) + '</span>').join('');
      for (let d = range.from; d <= range.to; d = C.addDays(d, 1)) {
        const mark = marks.get(d);
        cells += '<span class="dm-day' + (d.slice(0, 7) !== ym ? ' is-out' : '') + (d === today ? ' is-today' : '') +
          (hols.has(d) ? ' is-holiday' : '') + '"><span class="dm-num">' + Number(d.slice(8)) + '</span>' +
          '<span class="dm-mark">' + (mark ? '<span class="cal-dot is-' + mark + '"></span>' : '') + '</span></span>';
      }
      grid.innerHTML = cells;
      if (!loaded) return;
      const booked = Array.from(marks.keys()).filter((d) => d.slice(0, 7) === ym).length;
      sum.textContent = C.MONTHS[m - 1] + ': ' +
        (booked ? booked + ' booked day' + (booked === 1 ? '' : 's') : 'nothing booked yet');
    }
    draw();

    return {
      range,
      setDays(list) {
        days = Array.isArray(list) ? list : [];
        loaded = true;
        draw();
      },
      setHolidays(list) {
        hols = C.holidayMap(list);
        draw();
      },
      setGoogle() {}, // bookings only (loadRange's note)
    };
  }

  function mountSmall() {
    const slot = root.querySelector('#dash-mini-slot');
    gcal = null;
    calMessage('');
    const target = { component: null, apply: null, range: null, label: 'this month' };
    cal = mountMini(slot, LSCUtil.today(), () => setCalSize('full'));
    target.component = cal;
    target.apply = (days) => cal.setDays(days);
    if (holidays) cal.setHolidays(holidays);
    loadRange(cal.range, target, 'this month', { noGoogle: true });
  }

  /* The calendar's card, small or full. Full, its bar carries the Month /
     Week switch and Collapse; the calendar's own bar (month, Go to date,
     arrows, Calendars ▾) is unchanged below it. */
  function drawCal() {
    const full = calSize === 'full';
    const box = root.querySelector('#dash-cal');
    root.querySelector('.dash').classList.toggle('is-cal-full', full);
    box.classList.toggle('is-full', full);
    box.innerHTML =
      '<h2 class="sr-only" id="home-cal-h">Production calendar</h2>' +
      (full
        ? '<div class="dash-cal-bar">' +
          '<div class="home-switch" role="group" aria-label="Calendar view">' +
          ['month', 'week'].map((v) =>
            '<button type="button" class="home-switch-btn" data-view="' + v + '" aria-pressed="' + (v === view) + '">' +
            (v === 'month' ? 'Month' : 'Week') + '</button>'
          ).join('') +
          '</div>' +
          '<button type="button" class="btn btn-ghost btn-sm dash-cal-shrink" id="dash-cal-close">' +
          ICON.shrink + '<span>Collapse</span></button>' +
          '</div>'
        : '') +
      '<p class="home-cal-msg" id="home-cal-msg" role="status" hidden></p>' +
      (full ? '<div id="home-cal-slot"></div>' : '<div id="dash-mini-slot"></div>');
    if (full) {
      box.querySelectorAll('.home-switch-btn').forEach((b) =>
        b.addEventListener('click', () => setView(b.dataset.view, b)));
      box.querySelector('#dash-cal-close').addEventListener('click', () => setCalSize('mini'));
      mountCalendar();
    } else {
      mountSmall();
    }
  }

  /* Grow or shrink, moving focus to the control that undoes it. Where the
     browser has view transitions, the card grows from where it sat (and the
     lists slide to their new places); with reduced motion it simply changes. */
  function setCalSize(next) {
    if (next === calSize || !root.querySelector('#dash-cal')) return;
    anchor = currentAnchor();
    calSize = next;
    saveSize(next);
    const focusOn = () => {
      const el = root.querySelector(next === 'full' ? '#dash-cal-close' : '#dash-cal-open');
      if (el) el.focus();
    };
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof document.startViewTransition === 'function' && !still) {
      // The cards carry view-transition names only while they move (home.css).
      const dash = root.querySelector('.dash');
      dash.classList.add('is-moving');
      const move = document.startViewTransition(drawCal);
      move.updateCallbackDone.then(focusOn, focusOn);
      move.finished.finally(() => dash.classList.remove('is-moving'));
    } else {
      drawCal();
      focusOn();
    }
  }

  // ── Coming up ───────────────────────────────────────────────────────────────

  function relative(date, today) {
    const n = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    return 'In ' + n + ' days';
  }

  function comingUpMarkup(days, today) {
    const byDate = new Map();
    days.forEach((d) => {
      if (!C.isDate(d.date) || !STATUS_WORD[d.status]) return;
      if (!byDate.has(d.date)) byDate.set(d.date, []);
      byDate.get(d.date).push(d);
    });
    if (!byDate.size) {
      return '<p class="home-empty">Nothing booked in the next ' + COMING_UP_DAYS + ' days.</p>';
    }
    return '<ol class="up-list">' + Array.from(byDate.keys()).sort().map((date) => {
      const d = Number(date.slice(8));
      const rel = relative(date, today);
      return '<li class="up-date' + (date === today ? ' is-today' : '') + '">' +
        '<div class="up-when" aria-hidden="true">' +
        '<span class="up-dow">' + esc(C.shortDate(date).slice(0, 3)) + '</span>' +
        '<span class="up-num">' + d + '</span>' +
        '<span class="up-mon">' + esc(C.shortDate(date).split(' ')[2]) + '</span>' +
        '</div>' +
        '<div class="up-body">' +
        '<p class="up-rel"><span class="sr-only">' + esc(C.longDate(date, today)) + ', </span>' + esc(rel) + '</p>' +
        '<ul class="up-rows">' + byDate.get(date).map((day) =>
          '<li><a class="up-row is-' + day.status + '" href="#' + esc(projectPath(day)) + '">' +
          C.statusChip(day.status) +
          '<span class="up-main"><span class="up-upid">' + esc(day.upid || 'No UPID') + '</span>' +
          '<span class="up-name">' + esc(day.projectName || 'Untitled estimate') + '</span></span>' +
          '<span class="up-meta">' +
          (day.client ? '<span class="up-client">' + esc(day.client) + '</span>' : '') +
          '<span class="up-time">' + esc(C.timeText(day)) + '</span>' +
          '</span></a></li>'
        ).join('') + '</ul></div></li>';
    }).join('') + '</ol>';
  }

  function showComingUp(days, today) {
    const box = root.querySelector('#home-up');
    if (!box) return;
    box.innerHTML = comingUpMarkup(days, today);
    const count = days.filter((d) => STATUS_WORD[d.status]).length;
    root.querySelector('#home-up-sub').textContent =
      'Next ' + COMING_UP_DAYS + ' days' + (count ? ' · ' + count + ' booked day' + (count === 1 ? '' : 's') : '');
  }

  /* Coming up's own fetch, for when the calendar on show doesn't cover the
     next fortnight (the week view, or a month left elsewhere last visit). */
  async function loadComingUp() {
    const box = root.querySelector('#home-up');
    const ticket = LSCRouter.ticket();
    const today = LSCUtil.today();
    const to = C.addDays(today, COMING_UP_DAYS - 1);
    let reply;
    try {
      reply = await LSCApi.get('/api/calendar?from=' + today + '&to=' + to);
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket) || !box.isConnected) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      box.innerHTML = '<p class="home-empty">Couldn’t load what’s coming up: ' + esc(failureText(err)) +
        '</p><button type="button" class="btn btn-ghost btn-sm" id="home-up-retry">Try again</button>';
      box.querySelector('#home-up-retry').addEventListener('click', () => {
        box.innerHTML = '<p class="home-empty">Loading…</p>';
        loadComingUp();
      });
      return;
    }
    if (!LSCRouter.isCurrent(ticket) || !box.isConnected) return;
    showComingUp(reply.days || [], today);
  }

  // ── Recent activity ─────────────────────────────────────────────────────────

  // "Today", "Yesterday", else "Thu 2 Oct" (with the year when it isn't this one).
  function dayLabel(ymd, today) {
    if (ymd === today) return 'Today';
    if (ymd === C.addDays(today, -1)) return 'Yesterday';
    return C.shortDate(ymd) + (ymd.slice(0, 4) !== today.slice(0, 4) ? ' ' + ymd.slice(0, 4) : '');
  }

  /* A run of days, newest first, each event under the day it happened on
     this browser's clock (`at` is UTC: an evening here is the next morning
     there). The row opens the project's folder. */
  function activityMarkup(events, today) {
    const byDay = new Map();
    events.forEach((a) => {
      const t = new Date(a.at);
      if (!a.project || !Number.isFinite(t.getTime())) return;
      const ymd = ProjectCard.localDate(a.at);
      if (!byDay.has(ymd)) byDay.set(ymd, []);
      byDay.get(ymd).push({ a, time: t.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) });
    });
    if (!byDay.size) {
      return '<p class="home-empty">Nothing yet. Marking a project sent or accepted, its invoices and payments show here.</p>';
    }
    return '<ol class="act-list">' + Array.from(byDay.keys()).map((ymd) =>
      '<li class="act-day"><h3 class="act-day-h">' + esc(dayLabel(ymd, today)) + '</h3>' +
      '<ul class="act-rows">' + byDay.get(ymd).map(({ a, time }) =>
        '<li><a class="act-row' + (a.kind === 'invoice_paid' ? ' is-paid' : '') + '" href="#' + esc(ProjectCard.pathOf(a.project)) + '">' +
        '<span class="act-time">' + esc(time) + '</span>' +
        '<span class="act-main"><span class="act-upid">' + esc(a.project.upid || 'No UPID') + '</span>' +
        '<span class="act-name">' + esc(a.project.name || 'Untitled') + '</span></span>' +
        '<span class="act-what">' + esc(ProjectCard.activityText(a, today)) + '</span>' +
        (a.project.client ? '<span class="act-client">' + esc(a.project.client) + '</span>' : '') +
        '</a></li>'
      ).join('') + '</ul></li>'
    ).join('') + '</ol>';
  }

  async function loadActivity() {
    const box = root.querySelector('#home-act');
    const ticket = LSCRouter.ticket();
    let reply;
    try {
      reply = await LSCApi.get('/api/activity?limit=' + ACTIVITY_COUNT);
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket) || !box.isConnected) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      box.innerHTML = '<p class="home-empty">Couldn’t load recent activity: ' + esc(failureText(err)) +
        '</p><button type="button" class="btn btn-ghost btn-sm" id="home-act-retry">Try again</button>';
      box.querySelector('#home-act-retry').addEventListener('click', () => {
        box.innerHTML = '<p class="home-empty">Loading…</p>';
        loadActivity();
      });
      return;
    }
    if (!LSCRouter.isCurrent(ticket) || !box.isConnected) return;
    box.innerHTML = activityMarkup(reply.activity || [], LSCUtil.today());
  }

  // ── The overview lists ──────────────────────────────────────────────────────

  // Whole days from `today` to a date: negative before it.
  const dayGap = (ymd, today) => Math.round((Date.parse(ymd + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);

  function agoText(ymd, today) {
    if (!C.isDate(ymd)) return '';
    const n = -dayGap(ymd, today);
    if (n <= 0) return 'Today';
    return n === 1 ? 'Yesterday' : n + ' days ago';
  }

  function dueText(ymd, today) {
    if (!C.isDate(ymd)) return 'No due date';
    const n = dayGap(ymd, today);
    if (n === 0) return 'Due today';
    if (n === 1) return 'Due tomorrow';
    if (n === -1) return 'Due yesterday';
    return n > 0 ? 'Due in ' + n + ' days' : 'Due ' + -n + ' days ago';
  }

  /* One line: who or what, a meta line, then the amount and either a chip
     (stacked under it) or the chevron. The whole line is the link. */
  function rowMarkup(r) {
    return '<li><a class="dash-row" href="#' + esc(r.href) + '">' +
      '<div class="dash-row-main"><span class="dash-row-name">' + esc(r.name) + '</span>' + r.meta + '</div>' +
      '<div class="dash-row-end' + (r.chip ? ' is-stacked' : '') + '">' +
      '<span class="dash-row-amt fig">' + money(r.amount) + '</span>' +
      (r.chip || '<span class="dash-row-go">' + ICON.next + '</span>') +
      '</div></a></li>';
  }

  const invoiceName = (i) => i.project.client || i.project.name || 'Untitled';
  const invoiceHref = (i) => InvoiceView.pathOf(i.projectId, i.id);
  const metaLine = (parts, alert) => '<span class="dash-row-meta' + (alert ? ' is-alert' : '') + '">' +
    parts.filter(Boolean).join(' · ') + '</span>';

  const LISTS = {
    proj: {
      title: 'Open projects',
      act: { href: '/projects/new', label: 'New project', icon: ICON.add },
      url: (today) => '/api/projects?stage=open&limit=' + LIST_COUNT + '&today=' + today,
      what: 'open projects',
      empty: 'No open projects. A project shows here from its first estimate until it’s paid or declined.',
      sub: (reply) => (reply.total ? reply.total + ' open' : ''),
      rows: (reply, today) => (reply.projects || []).map((p) => ({
        href: ProjectCard.pathOf(p),
        name: p.name || 'Untitled estimate',
        meta: ProjectCard.stageMarkup(p, today),
        amount: p.totalIncGst,
      })),
    },
    out: {
      title: 'Outstanding invoices',
      act: { href: '/projects?stage=invoiced', label: 'Invoiced projects', icon: ICON.open },
      url: () => '/api/invoices?state=outstanding&limit=' + LIST_COUNT,
      what: 'outstanding invoices',
      empty: 'Nothing outstanding: every invoice sent has been paid.',
      sub: (reply) => (reply.total ? money(reply.sum) + ' across ' + reply.total + ' invoice' + (reply.total === 1 ? '' : 's') : ''),
      rows: (reply, today) => (reply.invoices || []).map((i) => {
        const due = String(i.dueAt || '').slice(0, 10);
        const overdue = C.isDate(due) && due < today;
        const word = i.kind === 'legacy' ? 'Legacy' : overdue ? 'Overdue' : 'Sent';
        const tone = overdue ? 'alert' : i.kind === 'legacy' ? 'neutral' : 'info';
        return {
          href: invoiceHref(i),
          name: invoiceName(i),
          meta: metaLine([esc(dueText(due, today)), i.number ? '<span class="ref">' + esc(i.number) + '</span>' : ''], overdue),
          amount: i.amountDue,
          chip: '<span class="pf-chip is-' + tone + '">' + word + '</span>',
        };
      }),
    },
    paid: {
      title: 'Recent payments',
      act: { href: '/projects?stage=paid', label: 'Paid projects', icon: ICON.open },
      url: () => '/api/invoices?state=paid&limit=' + LIST_COUNT,
      what: 'recent payments',
      empty: 'No payments yet. An invoice marked paid shows here.',
      sub: () => '',
      rows: (reply, today) => (reply.invoices || []).map((i) => ({
        href: invoiceHref(i),
        name: invoiceName(i),
        meta: metaLine([esc(agoText(String(i.paidAt || '').slice(0, 10), today)), i.number ? '<span class="ref">' + esc(i.number) + '</span>' : '']),
        amount: i.amountDue,
      })),
    },
  };

  function cardMarkup(key) {
    const L = LISTS[key];
    return '<section class="dash-card" id="dash-' + key + '" aria-labelledby="dash-' + key + '-h">' +
      '<div class="dash-card-head"><div class="dash-card-titles">' +
      '<h2 class="dash-card-title" id="dash-' + key + '-h">' + esc(L.title) + '</h2>' +
      '<p class="dash-card-sub" id="dash-' + key + '-sub"></p></div>' +
      '<a class="dash-card-act" href="#' + esc(L.act.href) + '" aria-label="' + esc(L.act.label) + '" title="' + esc(L.act.label) + '">' +
      L.act.icon + '</a></div>' +
      '<div class="dash-card-body" id="dash-' + key + '-body"><p class="home-empty">Loading…</p></div>' +
      '</section>';
  }

  async function loadList(key) {
    const L = LISTS[key];
    const box = root.querySelector('#dash-' + key + '-body');
    const ticket = LSCRouter.ticket();
    const today = LSCUtil.today();
    let reply;
    try {
      reply = await LSCApi.get(L.url(today));
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket) || !box.isConnected) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      box.innerHTML = '<p class="home-empty">Couldn’t load ' + L.what + ': ' + esc(failureText(err)) +
        '</p><button type="button" class="btn btn-ghost btn-sm" id="dash-' + key + '-retry">Try again</button>';
      box.querySelector('#dash-' + key + '-retry').addEventListener('click', () => {
        box.innerHTML = '<p class="home-empty">Loading…</p>';
        loadList(key);
      });
      return;
    }
    if (!LSCRouter.isCurrent(ticket) || !box.isConnected) return;
    const rows = L.rows(reply, today);
    root.querySelector('#dash-' + key + '-sub').textContent = L.sub(reply);
    box.innerHTML = rows.length
      ? '<ul class="dash-rows">' + rows.map(rowMarkup).join('') + '</ul>'
      : '<p class="home-empty">' + esc(L.empty) + '</p>';
  }

  // ── The screen ─────────────────────────────────────────────────────────────

  function render() {
    const today = LSCUtil.today();
    // A new day since the last visit: start on today, not on where yesterday left off.
    if (anchorDay !== today) {
      anchor = null;
      anchorDay = today;
    }
    window.scrollTo(0, 0);
    root.innerHTML =
      '<div class="page-head home-head"><div><h1 class="page-title">Dashboard</h1>' +
      '<div class="page-sub">' + esc(C.longDate(today, today)) + '</div></div></div>' +
      '<div class="dash">' +
      '<section class="dash-cal" id="dash-cal" aria-labelledby="home-cal-h"></section>' +
      '<div class="dash-main"><div class="dash-lists">' +
      cardMarkup('proj') + cardMarkup('out') + cardMarkup('paid') +
      '</div>' +
      '<section class="dash-card" id="dash-act" aria-labelledby="home-act-h">' +
      '<div class="dash-card-head"><div class="dash-card-titles"><h2 class="dash-card-title" id="home-act-h">Recent activity</h2></div></div>' +
      '<div id="home-act"><p class="home-empty">Loading…</p></div>' +
      '</section></div>' +
      '<div class="dash-side">' +
      '<section class="dash-card" id="dash-up" aria-labelledby="home-up-h">' +
      '<div class="dash-card-head"><div class="dash-card-titles"><h2 class="dash-card-title" id="home-up-h">Coming up</h2>' +
      '<p class="dash-card-sub" id="home-up-sub">Next ' + COMING_UP_DAYS + ' days</p></div></div>' +
      '<div id="home-up"><p class="home-empty">Loading…</p></div>' +
      '</section>' +
      '</div></div>';

    upWanted = { from: today, to: C.addDays(today, COMING_UP_DAYS - 1), asked: false };
    holidays = null;
    loadHolidays();
    drawCal(); // asks for its first range inside, which may cover Coming up's
    if (!upWanted.asked) {
      upWanted = null;
      loadComingUp();
    }
    Object.keys(LISTS).forEach(loadList);
    loadActivity();
  }

  return {
    init(main, h) {
      root = main;
      handlers = h;
    },
    /** #/home. False for anything under it: Home has no sub-pages. */
    show(segments) {
      if (segments.length) return false;
      closePop(false);
      // Back from an estimate opens the month or week you left, not today's.
      if (cal) anchor = currentAnchor();
      cal = null;
      render();
      return true;
    },
  };
})();
