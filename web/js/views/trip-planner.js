'use strict';

/* The travel view (.design/trip-planner/, T8; task 2 builds the shell).
 *
 * One production day's trip, planned on a map. It takes over the Production
 * booking panel's body (BookingBlock.showTrip): the panel's head, collapse
 * and the editor's jump rail keep working around it. The editor owns when it
 * opens and closes (the `?trip=<dayId>` address, I1); this file owns what's
 * inside.
 *
 *   const view = TripPlanner.mount({ day, onBack });
 *   view.el        // the view's element, for BookingBlock.showTrip
 *   view.dayId
 *   view.focus()   // its heading, as the view opens
 *   view.destroy() // stop listening; the caller removes the element
 *
 * `day` is { id, title, date } as BookingBlock.list() gives it, the title
 * "Day 2 · Thu 29 Oct". onBack() is the Back button: the editor drops `?trip`
 * and returns to the day's service menu.
 *
 * LAYOUT (brief, Responsive Behavior): header across the top; the map and
 * the stops side by side from 768px (55/45 from 1100px, the map sticky as the
 * list scrolls), stacked below 768px with the map on top. CSS: css/trip.css.
 *
 * THE MAP loads on first open (LSCMaps), never on page load. Until it is
 * ready the pane says so; if Google can't be reached or refuses the key, the
 * pane says which, with Try again where trying again can help.
 */

const TripPlanner = (() => {
  const { esc } = LSCUtil;
  const PHONE = window.matchMedia('(max-width: 767px)');

  function markup(day) {
    return (
      '<section class="trip-view" aria-labelledby="trip-h">' +
      '<div class="trip-head">' +
      '<button type="button" class="btn btn-quiet btn-sm trip-back" aria-label="Back to ' + esc(day.title) + '’s services">' +
      '<span aria-hidden="true">←</span> Back</button>' +
      '<h3 class="trip-title" id="trip-h" tabindex="-1">' +
      '<span class="trip-kicker">Travel<span class="sr-only"> · </span></span><span class="trip-day">' + esc(day.title) + '</span></h3>' +
      '</div>' +
      '<div class="trip-map-pane">' +
      '<div class="trip-map" role="region" aria-label="Map of ' + esc(day.title) + '’s route, no stops yet">' +
      '<div class="trip-map-canvas"></div>' +
      '<div class="trip-map-state" role="status">' +
      '<p class="trip-map-msg">Loading map…</p>' +
      '<button type="button" class="btn btn-sm trip-map-retry" hidden>Try again</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="trip-stops">' +
      '<h4 class="trip-stops-h">Destinations</h4>' +
      '<p class="trip-empty">No stops yet. A trip starts where the day starts: home, the studio, or the first pickup.</p>' +
      // Placing stops is task 3: the button is the view's first action, shown in place.
      '<button type="button" class="btn btn-ghost trip-add-start" disabled>+ Add start location</button>' +
      '</div>' +
      '</section>'
    );
  }

  function mount(options) {
    const opts = options || {};
    const day = opts.day;
    const onBack = typeof opts.onBack === 'function' ? opts.onBack : () => {};

    const holder = document.createElement('div');
    holder.innerHTML = markup(day);
    const el = holder.firstElementChild;
    const q = (sel) => el.querySelector(sel);
    const pane = q('.trip-map');
    const state = q('.trip-map-state');
    const msg = q('.trip-map-msg');
    const retry = q('.trip-map-retry');

    let map = null;
    let alive = true;

    function showState(text, canRetry) {
      pane.classList.toggle('is-ready', false);
      state.hidden = false;
      msg.textContent = text;
      retry.hidden = !canRetry;
    }

    async function startMap() {
      showState('Loading map…', false);
      try {
        map = await LSCMaps.createMap(q('.trip-map-canvas'), { phone: PHONE.matches });
      } catch (err) {
        if (!alive) return;
        const code = err && err.code;
        showState(err && err.message ? err.message : 'Google Maps didn’t load.', code === 'network');
        return;
      }
      if (!alive) return;
      // Google may still refuse the key once the map asks for tiles.
      if (LSCMaps.refused()) return showState(LSCMaps.refused().message, false);
      pane.classList.add('is-ready');
      state.hidden = true;
    }

    const stopListening = LSCMaps.onRefused((err) => {
      if (alive) showState(err.message, false);
    });

    /* A tablet turned, or a window narrowed past 768: the map's gestures follow. */
    function onPhoneChange() {
      if (map) map.setOptions({ gestureHandling: PHONE.matches ? 'cooperative' : 'greedy' });
    }
    PHONE.addEventListener('change', onPhoneChange);

    q('.trip-back').addEventListener('click', () => onBack());
    retry.addEventListener('click', () => {
      startMap();
      retry.blur();
      q('#trip-h').focus();
    });
    startMap();

    return {
      el,
      dayId: day.id,
      focus() {
        q('#trip-h').focus({ preventScroll: true });
      },
      destroy() {
        alive = false;
        stopListening();
        PHONE.removeEventListener('change', onPhoneChange);
        map = null;
      },
    };
  }

  return { mount };
})();
