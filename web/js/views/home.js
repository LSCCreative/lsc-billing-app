'use strict';

/* Home (#/home, task 12): the production calendar the app opens on (D27).
 *
 * What is booked, and when: every estimate's days at equal strength, in month
 * view (the shared js/calendar.js) or week view (views/home-week.js), with gear
 * rentals as bars (D84). Beside it, "Coming up", the next 14 days in date order
 * with all three statuses labelled, because a proposed date tomorrow still
 * needs a decision. And "Recent activity" (D52, task 22): the last 10 times a
 * job moved on (sent, accepted, invoiced, paid, declined) across every
 * project, from GET /api/activity, worded by the same ProjectCard.activityText
 * as the folder's log. Home stays a dashboard: nothing below those, and no
 * second Projects list (IA, Content Hierarchy).
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
 * Nothing here is cached between visits except where the calendar was looking
 * and which view it was in: each visit and each month or week asks
 * GET /api/calendar for just its range (IA, Content Growth Plan), so a day
 * booked in the editor is on Home the moment you come back.
 */

const HomeView = (() => {
  const C = LSCCalendar;
  const { esc } = LSCUtil;

  const { STATUS_WORD } = C;

  const COMING_UP_DAYS = 14;
  const ACTIVITY_COUNT = 10;
  const VIEW_KEY = 'lsc-home-view';

  let root = null;
  let handlers = null;
  // Where the calendar was looking, kept for the next visit in this page load.
  let anchor = null;
  let anchorDay = null; // the day `anchor` was set on, so tomorrow's first visit starts on tomorrow
  let view = readView();
  let cal = null; // the month or week component on show
  let rangeSeq = 0;
  /* Coming up's window, { from, to, asked }, while it waits on a calendar
     reply that covers it: the month on show usually does, so a visit is one
     fetch rather than two. */
  let upWanted = null;
  let holidays = null; // this visit's GET /api/holidays list, once it's in

  function readView() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month';
    } catch (_) {
      return 'month';
    }
  }
  function saveView(v) {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch (_) {
      // A private window or blocked storage: the choice lasts this visit only.
    }
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
      ? '<span>' + esc(text) + '</span>' + (retry ? '<button type="button" class="btn btn-ghost btn-sm" id="home-cal-retry">Try Again</button>' : '')
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
  async function loadRange(range, target, label) {
    const mine = ++rangeSeq;
    const ticket = LSCRouter.ticket();
    if (coversUp(range)) upWanted.asked = true;
    const gone = () => !LSCRouter.isCurrent(ticket);
    const superseded = () => mine !== rangeSeq || cal !== target.component;
    let reply;
    try {
      reply = await LSCApi.get('/api/calendar?from=' + range.from + '&to=' + range.to);
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (gone()) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      // Coming up was waiting on this reply: it asks for itself, and says so if that fails too.
      if (claimUp(range)) loadComingUp();
      if (superseded()) return;
      calMessage('Couldn’t load the bookings for ' + label + ': ' + failureText(err), () => loadRange(range, target, label));
      return;
    }
    if (gone()) return;
    const days = reply.days || [];
    const w = claimUp(range);
    if (w) showComingUp(days.filter((d) => d.date >= w.from && d.date <= w.to), w.from);
    if (superseded()) return;
    calMessage('');
    target.apply(days, reply.rentals || []);
  }

  function mountCalendar() {
    const slot = root.querySelector('#home-cal-slot');
    slot.className = 'home-cal-slot';
    slot.innerHTML = '';
    calMessage('');
    const today = LSCUtil.today();
    const target = { component: null, apply: null };

    if (view === 'week') {
      cal = HomeWeek.mount(slot, {
        id: 'home-wk',
        anchor: anchor || today,
        today,
        onRangeChange: (range) => loadRange(range, target, 'this week'),
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
        onRangeChange: (range) => loadRange(range, target, 'this month'),
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
    if (!cal) return anchor;
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
        '</p><button type="button" class="btn btn-ghost btn-sm" id="home-up-retry">Try Again</button>';
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
        '</p><button type="button" class="btn btn-ghost btn-sm" id="home-act-retry">Try Again</button>';
      box.querySelector('#home-act-retry').addEventListener('click', () => {
        box.innerHTML = '<p class="home-empty">Loading…</p>';
        loadActivity();
      });
      return;
    }
    if (!LSCRouter.isCurrent(ticket) || !box.isConnected) return;
    box.innerHTML = activityMarkup(reply.activity || [], LSCUtil.today());
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
      '<div class="page-head home-head"><div><h1 class="page-title">LSC Creative</h1>' +
      '<div class="page-sub">' + esc(C.longDate(today, today)) + ' · Production calendar</div></div>' +
      '<div class="home-switch" role="group" aria-label="Calendar view">' +
      ['month', 'week'].map((v) =>
        '<button type="button" class="home-switch-btn" data-view="' + v + '" aria-pressed="' + (v === view) + '">' +
        (v === 'month' ? 'Month' : 'Week') + '</button>'
      ).join('') +
      '</div></div>' +
      '<div class="home-layout">' +
      '<section class="home-cal" aria-labelledby="home-cal-h">' +
      '<h2 class="sr-only" id="home-cal-h">Production calendar</h2>' +
      '<p class="home-cal-msg" id="home-cal-msg" role="status" hidden></p>' +
      '<div id="home-cal-slot"></div>' +
      '</section>' +
      '<div class="home-side">' +
      '<section class="home-panel" aria-labelledby="home-up-h">' +
      '<div class="home-panel-head"><h2 class="home-panel-title" id="home-up-h">Coming up</h2>' +
      '<p class="home-panel-sub" id="home-up-sub">Next ' + COMING_UP_DAYS + ' days</p></div>' +
      '<div id="home-up"><p class="home-empty">Loading…</p></div>' +
      '</section>' +
      '<section class="home-panel" aria-labelledby="home-act-h">' +
      '<div class="home-panel-head"><h2 class="home-panel-title" id="home-act-h">Recent activity</h2></div>' +
      '<div id="home-act"><p class="home-empty">Loading…</p></div>' +
      '</section>' +
      '</div></div>';

    root.querySelectorAll('.home-switch-btn').forEach((b) =>
      b.addEventListener('click', () => setView(b.dataset.view, b)));

    upWanted = { from: today, to: C.addDays(today, COMING_UP_DAYS - 1), asked: false };
    holidays = null;
    loadHolidays();
    mountCalendar(); // asks for its first range inside, which may cover Coming up's
    if (!upWanted.asked) {
      upWanted = null;
      loadComingUp();
    }
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
