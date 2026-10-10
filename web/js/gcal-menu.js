'use strict';

/* Calendars ▾ (trip-planner task 13, G2; IA flow 8): which Google calendars
 * show on the calendar, from the calendar's own header, on Home (month and
 * week) and the editor's booking calendar. Settings → Google Calendar has the
 * same toggles; both write PUT /api/google/calendars, so they always agree.
 *
 *   const ctl = LSCGcalMenu.attach(cal.slots(), { reload });
 *   ctl.update(reply);   // each GET /api/calendar?google=1 reply
 *
 * `reload({ refresh })` is the caller's: fetch the range on show again with
 * google=1 (refresh=1 for Refresh, which skips the NAS's five-minute cache)
 * and hand the reply back through update(). The calendar component itself
 * never fetches.
 *
 * THE MENU
 * Connected: a checkbox item per calendar with its colour, ticked when it
 * shows, then Refresh and Manage in Settings. Ticking saves at once and the
 * calendar redraws; the menu stays open so several can be set in one go. Not
 * connected: one item, Connect Google Calendar (to Settings). Google refusing
 * the stored token: Reconnect Google Calendar.
 *
 * THE QUIET LINE under the calendar's bar says when Google couldn't be
 * reached ("Google Calendar unavailable", with Try again), when it needs
 * reconnecting, or which calendars failed while the rest showed. The app's own
 * bookings are always there regardless (brief).
 */

const LSCGcalMenu = (() => {
  const { esc } = LSCUtil;
  const SETTINGS = '/settings/calendar';
  const MAX_DOTS = 3;

  function joinAnd(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  function attach(slots, opts) {
    const reload = typeof opts.reload === 'function' ? opts.reload : () => {};
    const st = { state: null, calendars: [], missing: [] };
    let chain = Promise.resolve(); // PUTs one after another, each with the list as it stands then
    let saving = 0; // ticks not yet saved: a reply meanwhile mustn't untick them
    let btn = null;

    function paintButton() {
      if (!slots.tools) return;
      if (!st.state) {
        slots.tools.innerHTML = '';
        btn = null;
        return;
      }
      const on = st.state === 'off' ? [] : st.calendars.filter((c) => c.on);
      const dots = on.slice(0, MAX_DOTS).map((c) =>
        '<span class="cal-cals-dot"' + (c.colour ? ' style="--g:' + c.colour + '"' : '') + '></span>').join('');
      const expanded = btn && btn.getAttribute('aria-expanded') === 'true';
      if (!btn || !btn.isConnected) {
        slots.tools.innerHTML = '<button type="button" class="cal-btn cal-cals" aria-haspopup="menu" aria-expanded="false"></button>';
        btn = slots.tools.firstElementChild;
        btn.addEventListener('click', openMenu);
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openMenu(e, e.key === 'ArrowUp');
          }
        });
      }
      btn.innerHTML = (dots ? '<span class="cal-cals-dots" aria-hidden="true">' + dots + '</span>' : '') +
        '<span>Calendars</span><span class="menu-caret" aria-hidden="true"></span>';
      btn.setAttribute('aria-expanded', String(Boolean(expanded)));
      btn.title = st.state === 'off' ? 'Show your Google Calendar here'
        : on.length ? 'Showing ' + joinAnd(on.map((c) => c.summary)) : 'No Google calendars shown';
    }

    /* Refresh and Try again: past the NAS's cache. The button says it's
       working, and a toast says when it's done (the calendar may look no
       different, which would otherwise read as nothing happening). */
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      if (btn) btn.setAttribute('aria-busy', 'true');
      if (btn) btn.classList.add('is-busy');
      try {
        await reload({ refresh: true });
      } finally {
        refreshing = false;
        if (btn && btn.isConnected) {
          btn.removeAttribute('aria-busy');
          btn.classList.remove('is-busy');
        }
      }
      if (st.state === 'ok' && !st.missing.length) Toast.ok('Google Calendar refreshed.');
    }

    function paintNote() {
      const box = slots.note;
      if (!box) return;
      let text = '';
      let action = null;
      if (st.state === 'unavailable') {
        text = 'Google Calendar unavailable. Your bookings are all here.';
        action = { label: 'Try again', run: refresh };
      } else if (st.state === 'reconnect') {
        text = 'Google Calendar needs reconnecting to show your events.';
        action = { label: 'Reconnect', run: () => LSCRouter.go(SETTINGS) };
      } else if (st.state === 'ok' && st.missing.length) {
        text = 'Couldn’t load ' + joinAnd(st.missing) + ' from Google Calendar.';
        action = { label: 'Try again', run: refresh };
      }
      box.hidden = !text;
      box.innerHTML = text
        ? '<span>' + esc(text) + '</span>' +
          '<button type="button" class="cal-gnote-act">' + esc(action.label) + '</button>'
        : '';
      if (action) box.querySelector('.cal-gnote-act').addEventListener('click', action.run);
      if (slots.root) slots.root.classList.toggle('has-gnote', Boolean(text));
    }

    function items() {
      if (st.state === 'off') return [{ text: 'Connect Google Calendar', act: 'settings' }];
      if (st.state === 'reconnect') return [{ text: 'Reconnect Google Calendar', act: 'settings' }];
      return st.calendars.map((c) => ({
        text: c.summary,
        checked: c.on,
        swatch: c.colour,
        cal: c.id,
        attrs: { 'data-cal': c.id },
      })).concat(['-', { text: 'Refresh', act: 'refresh' }, { text: 'Manage in Settings', act: 'settings' }]);
    }

    function openMenu(e, last) {
      LSCMenu.open(btn, {
        label: 'Calendars',
        title: 'Google calendars shown',
        last: last === true,
        items: items(),
        empty: 'No calendars in this Google account.',
        onSelect: (it, checked) => {
          if (it.cal) return toggle(it.cal, checked);
          if (it.act === 'refresh') return refresh();
          if (it.act === 'settings') LSCRouter.go(SETTINGS);
        },
      });
    }

    /* One calendar on or off: shown at once, saved behind it. A refusal puts
       the server's list back (and the open menu's tick with it). */
    function toggle(calId, checked) {
      const c = st.calendars.find((x) => x.id === calId);
      if (!c) return;
      c.on = checked;
      saving += 1;
      paintButton();
      chain = chain.then(async () => {
        try {
          const reply = await LSCApi.put('/api/google/calendars', { on: st.calendars.filter((x) => x.on).map((x) => x.id) });
          st.calendars = reply.calendars || st.calendars;
          paintButton();
          reload({});
        } catch (err) {
          if (!(err instanceof LSCApi.ApiError)) throw err;
          c.on = !checked;
          paintButton();
          const box = document.querySelector('.menu-pop [data-cal="' + CSS.escape(calId) + '"]');
          if (box) box.setAttribute('aria-checked', String(!checked));
          Toast.error(err.code === 'google_not_connected'
            ? 'Google Calendar isn’t connected any more.'
            : 'Couldn’t change which calendars show: ' + (err.kind === 'network' ? 'the server is unreachable.' : (err.message || 'the server had a problem.')));
          if (err.code === 'google_not_connected') reload({});
        } finally {
          saving -= 1;
        }
      });
    }

    return {
      /** A GET /api/calendar?google=1 reply. A reply without Google keys changes nothing. */
      update(reply) {
        if (!reply || typeof reply.googleState !== 'string') return;
        st.state = reply.googleState;
        const mine = new Map(st.calendars.map((c) => [c.id, c.on]));
        st.calendars = Array.isArray(reply.googleCalendars)
          ? reply.googleCalendars.map((c) => Object.assign({}, c, saving && mine.has(c.id) ? { on: mine.get(c.id) } : {}))
          : [];
        st.missing = Array.isArray(reply.googleMissing) ? reply.googleMissing : [];
        paintButton();
        paintNote();
      },
    };
  }

  return { attach };
})();
