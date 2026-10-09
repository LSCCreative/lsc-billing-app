'use strict';

/* The travel view (.design/trip-planner/, T8; task 2 the shell, task 3 the
 * stops, task 4 the route).
 *
 * One production day's trip, planned on a map. It takes over the Production
 * booking panel's body (BookingBlock.showTrip): the panel's head, collapse
 * and the editor's jump rail keep working around it. The editor owns when it
 * opens and closes (the `?trip=<dayId>` address, I1); this file owns what's
 * inside.
 *
 *   const view = TripPlanner.mount({ day, trip, onChange, onBack, lines });
 *   view.el        // the view's element, for BookingBlock.showTrip
 *   view.dayId
 *   view.focus()   // its heading, as the view opens
 *   view.destroy() // stop listening; the caller removes the element
 *
 * `day` is { id, title, date, startTime } as BookingBlock.list() gives it,
 * the title "Day 2 · Thu 29 Oct". `trip` is the day's stored trip or null.
 * onChange(trip) hands back the whole trip after every edit that changes it
 * (null once it has no start), and again when its route comes back; the
 * editor stores it on the day, writes the day's linked travel lines from it,
 * and it saves with the estimate. onBack() is the Back button: the editor
 * drops `?trip` and returns to the day's service menu. lines() is what the
 * Trip totals list: { lines: [{ name, qty, bill } | { missing }], typed:
 * [{ name, bill }] }, the day's linked lines (or why one couldn't be added)
 * and any typed line of the same kind, as the editor holds them.
 *
 * LAYOUT (brief, Responsive Behavior): header across the top; the map and
 * the stops side by side from 768px (55/45 from 1100px, the map sticky as the
 * list scrolls), stacked below 768px with the map on top. CSS: css/trip.css.
 *
 * THE MAP loads on first open (LSCMaps), never on page load. Until it is
 * ready the pane says so; if Google can't be reached or refuses the key, the
 * pane says which, with Try again where trying again can help. Placing a
 * stop needs Google, so the add buttons wait for it too.
 *
 * STOPS (task 3; brief, Key Interactions). The list is the trip: START, the
 * destinations 1…n, then an optional RETURN that mirrors START. A cell is
 * placed (it has a spot) or empty (just added). One cell at a time WAITS for
 * a location: the search bar shows above the map, and a suggestion, a
 * Search/Enter best match or a click on the map drops a hollow PENDING pin
 * with its address. The pin, "Use this location" or Enter sets the cell;
 * Escape drops the pin, and a second Escape stops waiting (the empty cell
 * stays). Every placed stop has a numbered pin, mirroring the list.
 *
 * Only placed stops are saved: days.js parseTrip needs a spot for every stop,
 * a START first, and a destination before a RETURN. An empty cell is this
 * screen's alone, so it is gone after a reload. So that the list always saves
 * as it reads:
 *   - there is at most one empty destination: + Destination goes back to it;
 *   - START can be removed only when it is the last cell, and can always be
 *     changed (Change re-places a cell; until a new spot is chosen it keeps
 *     its old one);
 *   - RETURN goes with the last placed destination (Undo brings both back).
 *
 * THE ROUTE (task 4, T5, T6): see "The route" below. Each change to the
 * stops asks Google again; opening the view never does. The stored legs,
 * totals and line stand until a route replaces them whole, and
 * routedFor.stops says which stops they were worked out for.
 */

const TripPlanner = (() => {
  const { esc } = LSCUtil;
  const PHONE = window.matchMedia('(max-width: 767px)');
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
  const MAX_DESTINATIONS = 23; // days.js MAX_TRIP_DESTINATIONS: Google's waypoint limit
  const SUGGEST_MS = 250;
  const MIN_QUERY = 3; // fewer letters suggest the whole country, and each request is billed

  /* The view on show for each day, so an Undo from a toast still reaches it
     after Back and a reopen. */
  const live = new Map();

  /* Stop ids follow days.js DAY_ID ([A-Za-z0-9_-]{1,64}), unique in their trip. */
  function newStopId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return 's' + crypto.randomUUID().replace(/-/g, '');
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  const isPlaced = (c) => typeof c.lat === 'number' && typeof c.lng === 'number';
  const copyCells = (cells) => cells.map((c) => Object.assign({}, c, c.details ? { details: Object.assign({}, c.details) } : {}));

  /* What a stored trip looks like as cells: its stops, as they are. */
  const cellsFrom = (trip) => (trip && Array.isArray(trip.stops) ? copyCells(trip.stops) : []);

  /* The cells as the day's trip (IA appendix), or null for none. */
  function tripOf(cells, base) {
    const start = cells.find((c) => c.role === 'start' && isPlaced(c));
    if (!start) return null;
    const out = (c) => {
      const s = { id: c.id, role: c.role, address: c.address, lat: c.lat, lng: c.lng, placeId: c.placeId || '' };
      if (c.role === 'stop') {
        if (typeof c.minutesOnSite === 'number') s.minutesOnSite = c.minutesOnSite;
        if (c.details) s.details = Object.assign({}, c.details);
      }
      return s;
    };
    const dests = cells.filter((c) => c.role === 'stop' && isPlaced(c));
    const stops = [out(start)].concat(dests.map(out));
    const ret = cells.find((c) => c.role === 'return');
    if (ret && dests.length) {
      stops.push({ id: ret.id, role: 'return', address: start.address, lat: start.lat, lng: start.lng, placeId: start.placeId || '' });
    }
    const b = base || {};
    return {
      stops,
      legs: Array.isArray(b.legs) ? b.legs : [],
      totals: b.totals || { km: 0, minutes: 0 },
      polyline: b.polyline || '',
      routedFor: b.routedFor || null,
      routedAt: b.routedAt || null,
    };
  }

  /* "Start", "Destination 2", "Return": what a cell is called in labels and announcements. */
  function nameOf(cells, cell) {
    if (cell.role === 'start') return 'Start';
    if (cell.role === 'return') return 'Return';
    return 'Destination ' + (cells.filter((c) => c.role === 'stop').indexOf(cell) + 1);
  }

  function chipOf(cells, cell) {
    if (cell.role === 'start') return 'Start';
    if (cell.role === 'return') return 'Return';
    return String(cells.filter((c) => c.role === 'stop').indexOf(cell) + 1);
  }

  /* Settings → Business → Home base (task 6), offered first for START (T9). Nothing until it exists. */
  function homeBase() {
    const settings = LSCData.settings();
    const hb = settings && settings.business && settings.business.homeBase;
    return hb && hb.address && typeof hb.lat === 'number' && typeof hb.lng === 'number' ? hb : null;
  }

  const spotText = (at) => 'Pinned spot ' + at.lat.toFixed(5) + ', ' + at.lng.toFixed(5);

  // ── The route's figures (task 4) ──────────────────────────────────────────

  /* Which stops a route was worked out for: FNV-1a over each stop's role,
     spot and time on location, stored as routedFor.stops (days.js ROUTE_SIG).
     A trip whose stops no longer match it is out of date: saved after a
     failed re-route, or closed while one was on its way. */
  function stopsSig(stops) {
    const text = stops.map((s) => [s.role, s.lat.toFixed(6), s.lng.toFixed(6), s.minutesOnSite || 0].join(',')).join(';');
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'r' + h.toString(16).padStart(8, '0');
  }

  /* "4.5 km" under 10 km, "42 km" above; a total to the tenth: "186.2 km". */
  const legKm = (km) => (km < 10 ? Math.round(km * 10) / 10 : Math.round(km)).toLocaleString('en-AU') + ' km';
  const totalKm = (km) => (Math.round(km * 10) / 10).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';

  /* "48 min", "1 h 05" (IA Naming: "h" and "min", never "Hour"). */
  function duration(minutes) {
    const m = Math.round(minutes);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }

  /* The same, for a screen reader: "2 hours 40 minutes". */
  function durationSpoken(minutes) {
    const m = Math.round(minutes);
    const h = Math.floor(m / 60);
    const parts = [];
    if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'));
    if (m % 60 || !h) parts.push((m % 60) + ((m % 60) === 1 ? ' minute' : ' minutes'));
    return parts.join(' ');
  }

  /* 'HH:MM' plus minutes, on the wall clock, as 'HH:MM' (past midnight wraps). */
  function clockPlus(hhmm, minutes) {
    const [h, m] = hhmm.split(':').map(Number);
    const total = (((h * 60 + m + Math.round(minutes)) % 1440) + 1440) % 1440;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  /* '07:05' → '7:05 am'. */
  function clockText(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' am' : ' pm');
  }

  /* The instant a day's date and start time name in Sydney (the app's zone),
     wherever this browser is. Two passes settle a daylight-saving edge. */
  const SYDNEY = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  function sydneyOffset(t) {
    const p = {};
    SYDNEY.formatToParts(new Date(t)).forEach((x) => {
      p[x.type] = x.value;
    });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  }
  function sydneyInstant(date, hhmm) {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const wall = Date.UTC(y, mo - 1, d, h, mi);
    let t = wall;
    for (let k = 0; k < 2; k++) t = wall - sydneyOffset(t);
    return new Date(t);
  }

  /* Show trip details is remembered in this browser (the brief). */
  const DETAILS_KEY = 'lsc.trip.details';
  function detailsPref() {
    try {
      return localStorage.getItem(DETAILS_KEY) === '1';
    } catch (err) {
      return false;
    }
  }
  function saveDetailsPref(on) {
    try {
      localStorage.setItem(DETAILS_KEY, on ? '1' : '0');
    } catch (err) {
      // Private mode or blocked storage: it just isn't remembered.
    }
  }

  function markup(day) {
    return (
      '<section class="trip-view" aria-labelledby="trip-h">' +
      '<div class="trip-head">' +
      '<button type="button" class="btn btn-quiet btn-sm trip-back" aria-label="Back to ' + esc(day.title) + '’s services">' +
      '<span aria-hidden="true">←</span> Back</button>' +
      '<h3 class="trip-title" id="trip-h" tabindex="-1">' +
      '<span class="trip-kicker">Travel<span class="sr-only"> · </span></span><span class="trip-day">' + esc(day.title) + '</span></h3>' +
      '<button type="button" class="btn btn-quiet btn-sm trip-more" aria-haspopup="menu" aria-expanded="false" ' +
      'aria-label="More travel actions" hidden><span aria-hidden="true">⋯</span></button>' +
      '</div>' +
      '<div class="trip-map-pane">' +
      // The search bar: shown while a cell waits for a location (APG combobox).
      '<div class="trip-search" hidden>' +
      '<label class="trip-search-label" for="trip-q">Find a place for <span class="trip-search-for"></span></label>' +
      '<div class="trip-search-row">' +
      '<div class="trip-combo">' +
      '<input id="trip-q" class="trip-q" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" ' +
      'aria-controls="trip-q-list" aria-describedby="trip-q-msg" autocomplete="off" spellcheck="false" enterkeyhint="search" ' +
      'placeholder="Address or place">' +
      '<ul class="trip-suggest" id="trip-q-list" role="listbox" aria-label="Places" hidden></ul>' +
      '</div>' +
      '<button type="button" class="btn trip-q-go">Search</button>' +
      '</div>' +
      '<p class="trip-q-msg" id="trip-q-msg" role="status"></p>' +
      '</div>' +
      '<div class="trip-map" role="region" aria-label="Map of ' + esc(day.title) + '’s route, no stops yet">' +
      '<div class="trip-map-canvas"></div>' +
      // The pending pin's card: its address and the one way to take it besides the pin and Enter.
      '<div class="trip-pending" hidden>' +
      '<p class="trip-pending-addr"></p>' +
      '<div class="trip-pending-acts">' +
      '<button type="button" class="btn btn-primary btn-sm trip-use">Use this location</button>' +
      '<button type="button" class="btn btn-quiet btn-sm trip-pending-x">Cancel</button>' +
      '</div>' +
      '</div>' +
      '<div class="trip-map-state" role="status">' +
      '<p class="trip-map-msg">Loading map…</p>' +
      '<button type="button" class="btn btn-sm trip-map-retry" hidden>Try again</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="trip-stops">' +
      '<div class="trip-stops-bar">' +
      '<h4 class="trip-stops-h">Destinations</h4>' +
      // A toggle, so its name stays put and aria-pressed says which way it is.
      '<button type="button" class="btn btn-quiet btn-sm trip-details-btn" aria-pressed="false" hidden>' +
      '<span class="trip-switch" aria-hidden="true"></span>Show trip details</button>' +
      '</div>' +
      '<p class="trip-empty">No stops yet. A trip starts where the day starts: home, the studio, or the first pickup.</p>' +
      '<ol class="trip-cells" aria-label="Stops"></ol>' +
      '<div class="trip-adds"></div>' +
      '<p class="trip-cap" hidden>23 destinations is the most Google can route in one trip.</p>' +
      // The outcome, last (IA Content Hierarchy): figures, the lines they bill, and why when they can't.
      '<section class="trip-totals" aria-labelledby="trip-totals-h" hidden>' +
      '<h4 class="trip-stops-h" id="trip-totals-h" tabindex="-1">Trip totals</h4>' +
      '<div class="trip-route-msg" hidden><p class="trip-route-text"></p>' +
      '<button type="button" class="btn btn-sm trip-recalc">Recalculate</button></div>' +
      '<dl class="trip-figures">' +
      '<div class="trip-figure"><dt>Distance</dt><dd class="trip-fig-km"></dd></div>' +
      '<div class="trip-figure"><dt>Drive time</dt><dd class="trip-fig-time"></dd></div>' +
      '</dl>' +
      '<p class="trip-traffic"></p>' +
      '<ul class="trip-lines" aria-label="Lines this trip bills"></ul>' +
      '<p class="trip-also" hidden></p>' +
      '</section>' +
      '<p class="sr-only trip-live" aria-live="polite"></p>' +
      '</div>' +
      '</section>'
    );
  }

  /* A cell. `leg` is the drive to it from the stop before, spoken with the
     cell when Show trip details is on (the line drawn above it is hidden
     from screen readers, so the list counts stops only). */
  function cellMarkup(cells, cell, waiting, startCell, leg) {
    const name = nameOf(cells, cell);
    const placed = cell.role === 'return' ? Boolean(startCell && isPlaced(startCell)) : isPlaced(cell);
    const isWaiting = waiting === cell.id;
    const address = cell.role === 'return' ? (startCell && startCell.address) || '' : cell.address || '';
    // START goes only on its own: without it, the stops after it couldn't be saved (see the head).
    const removable = cell.role !== 'start' || cells.length === 1;
    const cls = 'trip-cell is-' + cell.role + (placed ? '' : ' is-empty') + (isWaiting ? ' is-waiting' : '');
    let body;
    if (placed) {
      body = '<p class="trip-addr">' + esc(address) + '</p>';
      if (cell.role === 'return') body += '<p class="trip-cell-note">Back to the start</p>';
      else if (isWaiting) body += '<p class="trip-cell-note">Choosing a new location</p>';
    } else {
      body = '<p class="trip-addr">' + (isWaiting ? 'Search above the map or click it to place this stop' : 'Not placed yet') + '</p>';
    }
    let acts = '';
    if (!isWaiting && cell.role !== 'return') {
      acts += placed
        ? '<button type="button" class="btn btn-quiet btn-sm" data-act="change" aria-label="Change ' + esc(name) + '’s location">Change</button>'
        : '<button type="button" class="btn btn-quiet btn-sm" data-act="place" aria-label="Place ' + esc(name) + '">Place</button>';
    }
    if (removable) {
      acts += '<button type="button" class="btn btn-quiet btn-sm trip-x" data-act="remove" aria-label="Remove ' + esc(name) + '">' +
        '<span aria-hidden="true">×</span></button>';
    }
    return (
      '<li class="' + cls + '" data-stop-id="' + esc(cell.id) + '">' +
      '<span class="trip-chip" aria-hidden="true">' + esc(chipOf(cells, cell)) + '</span>' +
      '<div class="trip-cell-body"><span class="sr-only">' + esc(name) + ': </span>' + body +
      (leg ? '<span class="sr-only"> ' + esc(leg) + '</span>' : '') + '</div>' +
      (acts ? '<div class="trip-cell-acts">' + acts + '</div>' : '') +
      '</li>'
    );
  }

  /* A pin's face: the stop's chip, in terracotta (the brief's one accent on the map). */
  function pinEl(text, extra) {
    const el = document.createElement('div');
    el.className = 'trip-pin' + (extra ? ' ' + extra : '');
    el.setAttribute('aria-hidden', 'true');
    // The face, then the tail under it: Google stands a marker's bottom edge on its spot.
    const face = document.createElement('span');
    face.className = 'trip-pin-face';
    face.textContent = text;
    el.appendChild(face);
    return el;
  }

  function mount(options) {
    const opts = options || {};
    const day = opts.day;
    const onBack = typeof opts.onBack === 'function' ? opts.onBack : () => {};
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

    const holder = document.createElement('div');
    holder.innerHTML = markup(day);
    const el = holder.firstElementChild;
    const q = (sel) => el.querySelector(sel);
    const pane = q('.trip-map');
    const state = q('.trip-map-state');
    const msg = q('.trip-map-msg');
    const retry = q('.trip-map-retry');
    const search = q('.trip-search');
    const input = q('.trip-q');
    const list = q('.trip-suggest');
    const qMsg = q('.trip-q-msg');
    const card = q('.trip-pending');
    const listEl = q('.trip-cells');
    const adds = q('.trip-adds');
    const liveEl = q('.trip-live');

    let map = null;
    let mapReady = false;
    let alive = true;

    /* The route figures the trip carries until task 4 replaces them; a trip
       that has gone (no start) takes them with it. */
    let base = opts.trip || null;
    let cells = cellsFrom(base);
    let waiting = null; // the id of the cell waiting for a location
    let pending = null; // { address, lat, lng, placeId, looking } while a pin waits to be used
    let pendingLabel = ''; // the search text that stands for the pending pin (Enter takes it)
    let pendingMarker = null;
    let markers = [];
    let drawSeq = 0;
    let pinned = ''; // what the pins on the map show, so an unchanged list doesn't redraw them

    // The search's own state: one Places session per search, newest reply only.
    let session = null;
    let seq = 0;
    let timer = null;
    let results = [];
    let active = -1;

    const cellById = (id) => cells.find((c) => c.id === id) || null;
    const startCell = () => cells.find((c) => c.role === 'start') || null;
    const destinations = () => cells.filter((c) => c.role === 'stop');
    const placedCount = () => cells.filter((c) => (c.role === 'return' ? false : isPlaced(c))).length +
      (cells.some((c) => c.role === 'return') && destinations().some(isPlaced) ? 1 : 0);

    function say(text) {
      // Cleared first, so the same words twice are announced twice.
      liveEl.textContent = '';
      setTimeout(() => {
        if (alive) liveEl.textContent = text;
      }, 30);
    }

    // ── Saving ─────────────────────────────────────────────────────────────

    function emit() {
      const next = tripOf(cells, base);
      if (!next) base = null;
      onChange(next);
    }

    /* After every change to the stops: save, then route if the stops are not
       the ones the stored route was worked out for (an Undo puts back a stop
       list and the route that went with it, so it asks Google nothing). */
    function changed() {
      emit();
      const trip = tripOf(cells, base);
      if (trip && !fits(trip)) {
        reroute();
        return;
      }
      // No trip, or the stored route is already these stops' (an Undo): a route on its way is for stops that have gone.
      routeSeq++;
      routing = false;
      routeError = '';
      paint();
    }

    // ── The route (task 4; T5, T6) ─────────────────────────────────────────
    /* Each change to the stops asks Google for the whole trip (maps.js
       route), with traffic when the day has a date and a start time still to
       come, and replaces the legs, totals, line and routedFor/routedAt whole
       when it answers. Until it does, the last good figures stand, greyed;
       if it fails they stay, with Try again. The editor writes the day's two
       linked lines from the totals (opts.onChange). Opening the view asks
       Google nothing: the stored line and figures are drawn as they are (T6),
       and a changed day only says so, with Recalculate. */

    let routing = false;
    let routeError = '';
    let routeSeq = 0;
    let routeLine = null;
    let routeDrawn = ''; // the polyline and look the route line was drawn with
    let lineSeq = 0;
    let details = detailsPref();

    /* Does the stored route belong to these stops? */
    function fits(trip) {
      const f = base && base.routedFor;
      if (!trip || !f || !base.routedAt) return false;
      if (f.stops) return f.stops === stopsSig(trip.stops);
      // Stored before signatures: the leg count is the best there is.
      return Array.isArray(base.legs) && base.legs.length === trip.stops.length - 1;
    }

    /* When the route leaves: with traffic from the day's start (T5), or
       without when there's no date or time, or it has already passed
       (Google predicts traffic only for times to come). */
    function departure() {
      if (!day.date || !day.startTime) return { at: null, traffic: false };
      const at = sydneyInstant(day.date, day.startTime);
      return at.getTime() > Date.now() + 60000 ? { at, traffic: true } : { at: null, traffic: false };
    }

    /* Each leg's clock times, when the day has a start time: leaving the
       first stop then, each next leg after the time on location. */
    function clockLegs(legs, stops) {
      if (!day.startTime) return legs.map((l) => ({ km: l.km, minutes: l.minutes }));
      let elapsed = 0;
      return legs.map((l, i) => {
        if (i > 0) elapsed += stops[i].minutesOnSite || 0;
        const departAt = clockPlus(day.startTime, elapsed);
        elapsed += l.minutes;
        return { km: l.km, minutes: l.minutes, departAt, arriveAt: clockPlus(day.startTime, elapsed) };
      });
    }

    async function reroute() {
      const trip = tripOf(cells, base);
      if (!trip) return;
      const stops = trip.stops;
      const go = departure();
      const routedFor = { date: day.date || null, startTime: day.startTime || null, traffic: go.traffic, stops: stopsSig(stops) };
      const mine = ++routeSeq;
      routeError = '';
      if (stops.length < 2) {
        // A start alone: nothing to drive, and nothing to ask Google.
        routing = false;
        base = { legs: [], totals: { km: 0, minutes: 0 }, polyline: '', routedFor, routedAt: new Date().toISOString() };
        emit();
        paint();
        return;
      }
      routing = true;
      paint();
      let found;
      try {
        found = await LSCMaps.route(stops, { departAt: go.at, dwell: (i) => stops[i].minutesOnSite || 0 });
      } catch (err) {
        if (mine !== routeSeq || !alive) return;
        routing = false;
        routeError = err.message;
        paint();
        say('Route not updated. ' + err.message);
        return;
      }
      // A newer change has its own route on the way, or the view has closed (the stops then read as changed when it reopens).
      if (mine !== routeSeq || !alive) return;
      const legs = clockLegs(found.legs, stops);
      const totals = {
        km: legs.reduce((sum, l) => sum + l.km, 0),
        minutes: legs.reduce((sum, l) => sum + l.minutes, 0),
      };
      base = { legs, totals, polyline: found.polyline, routedFor, routedAt: new Date().toISOString() };
      routing = false;
      emit();
      paint();
      fit(true);
      say('Route updated: ' + totalKm(totals.km) + ', ' + durationSpoken(totals.minutes) + '.');
    }

    /* What the totals say about the stored route. */
    function routeState(trip) {
      if (routing) return 'routing';
      if (routeError) return 'error';
      if (!base || !base.routedAt) return 'unrouted';
      if (!fits(trip)) return 'stops';
      const f = base.routedFor;
      if ((f.date || null) !== (day.date || null) || (f.startTime || null) !== (day.startTime || null)) return 'day';
      return 'ok';
    }

    const ROUTE_TEXT = {
      routing: 'Working out the route…',
      unrouted: 'This trip hasn’t been routed yet.',
      stops: 'The stops changed after the route was worked out.',
      day: 'Day changed. Drive times may differ.',
    };

    /* The totals block, the legs, the ⋯ and the route line, from the stored route. */
    function paintRoute() {
      const trip = tripOf(cells, base);
      const routable = Boolean(trip && trip.stops.length > 1);
      const totalsEl = q('.trip-totals');
      totalsEl.hidden = !routable;
      q('.trip-more').hidden = !routable;
      const fitsNow = routable && fits(trip);
      q('.trip-details-btn').hidden = !fitsNow;
      drawRoute(fitsNow);
      if (!routable) return;

      const state = routeState(trip);
      const msgEl = q('.trip-route-msg');
      const text = state === 'error' ? routeError : ROUTE_TEXT[state] || '';
      msgEl.hidden = !text;
      msgEl.classList.toggle('is-error', state === 'error');
      q('.trip-route-text').textContent = text;
      const again = q('.trip-recalc');
      again.hidden = state === 'routing' || state === 'ok' || !text;
      again.textContent = state === 'error' ? 'Try again' : 'Recalculate';

      // The last good figures, greyed while they wait for a route or no longer fit the stops.
      const has = Boolean(base && base.routedAt);
      const stale = state === 'routing' || !fitsNow;
      const figures = q('.trip-figures');
      figures.hidden = !has;
      figures.classList.toggle('is-stale', stale);
      totalsEl.setAttribute('aria-busy', String(state === 'routing'));
      if (has) {
        q('.trip-fig-km').textContent = totalKm(base.totals.km);
        q('.trip-fig-time').textContent = duration(base.totals.minutes);
      }
      const f = has ? base.routedFor : null;
      let traffic = '';
      if (f && f.traffic) {
        traffic = 'With traffic, leaving ' + clockText(f.startTime) + '.';
      } else if (f) {
        traffic = !f.date || !f.startTime
          ? 'Without traffic: this day has no date or start time.'
          : 'Without traffic: Google predicts traffic only for times still to come.';
      }
      const trafficEl = q('.trip-traffic');
      trafficEl.textContent = traffic;
      trafficEl.hidden = !traffic;

      // The day's two lines, as the editor holds them.
      const info = typeof opts.lines === 'function' ? opts.lines() : { lines: [], typed: [] };
      const linesEl = q('.trip-lines');
      linesEl.innerHTML = info.lines.map((l) =>
        l.missing
          ? '<li class="trip-line is-missing">' + esc(l.missing) + '</li>'
          : '<li class="trip-line' + (stale ? ' is-stale' : '') + '"><span class="trip-line-name">' + esc(l.name) + '</span>' +
            '<span class="trip-line-qty">' + esc(l.qty) + '</span><span class="trip-line-bill">' + esc(l.bill) + '</span></li>'
      ).join('');
      linesEl.hidden = !info.lines.length;
      const also = q('.trip-also');
      also.textContent = info.typed.length
        ? day.title + ' also has ' + info.typed.map((t) => t.name + ' (' + t.bill + ')').join(' and ') +
          ' typed in by hand. Remove ' + (info.typed.length === 1 ? 'it' : 'them') + ' if this trip covers the same driving.'
        : '';
      also.hidden = !info.typed.length;
    }

    /* The route line, from the stored polyline: full strength while it fits
       the stops, faint while it waits for a route or no longer fits them. */
    async function drawRoute(fitsNow) {
      const encoded = mapReady && base && base.polyline ? base.polyline : '';
      const faint = !fitsNow || routing;
      const look = encoded ? encoded.length + ':' + encoded.slice(0, 64) + ':' + faint : '';
      if (look === routeDrawn) return;
      routeDrawn = look;
      const mine = ++lineSeq;
      if (routeLine) routeLine.setMap(null);
      routeLine = null;
      if (!encoded) return;
      const color = getComputedStyle(document.documentElement).getPropertyValue('--color-accent-mark').trim();
      const line = await LSCMaps.routeLine(map, encoded, { color, opacity: faint ? 0.35 : 0.9 });
      if (mine !== lineSeq || !alive) {
        if (line) line.setMap(null);
        return;
      }
      routeLine = line;
    }

    function recalculate() {
      if (!tripOf(cells, base)) return;
      reroute();
    }

    // ── The map ────────────────────────────────────────────────────────────

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
      mapReady = true;
      map.addListener('click', onMapClick);
      paint();
      fit(false);
    }

    const stopListening = LSCMaps.onRefused((err) => {
      if (!alive) return;
      mapReady = false;
      showState(err.message, false);
      if (waiting) stopWaiting(null);
      else paint();
    });

    /* A tablet turned, or a window narrowed past 768: the map's gestures follow. */
    function onPhoneChange() {
      if (map) map.setOptions({ gestureHandling: PHONE.matches ? 'cooperative' : 'greedy' });
    }
    PHONE.addEventListener('change', onPhoneChange);

    /* Every placed stop in view (RETURN shares START's spot), and the route
       between them while it fits them: a road can bulge past its stops. */
    function fit(animate) {
      if (!mapReady) return;
      let points = cells.filter((c) => c.role !== 'return' && isPlaced(c)).map((c) => ({ lat: c.lat, lng: c.lng }));
      const trip = tripOf(cells, base);
      if (points.length > 1 && base && base.polyline && fits(trip)) points = points.concat(LSCMaps.decode(base.polyline));
      LSCMaps.show(map, points, { animate: animate && !REDUCED.matches });
    }

    /* The pins, redrawn whole: there are at most 25. */
    async function drawPins() {
      const start = startCell();
      const looped = cells.some((c) => c.role === 'return') && destinations().some(isPlaced);
      const sig = mapReady ? JSON.stringify([looped, cells.filter(isPlaced).map((c) => [chipOf(cells, c), c.lat, c.lng, c.address])]) : '';
      if (sig === pinned) return;
      pinned = sig;
      const mine = ++drawSeq;
      markers.forEach((m) => {
        m.map = null;
      });
      markers = [];
      if (!mapReady || !LSCMaps.canPin()) return;
      const made = [];
      for (const c of cells) {
        if (c.role === 'return' || !isPlaced(c)) continue;
        const name = nameOf(cells, c);
        const isStart = c === start;
        const face = pinEl(chipOf(cells, c) === 'Start' ? 'S' : chipOf(cells, c), (isStart ? 'is-start' : '') + (isStart && looped ? ' is-loop' : ''));
        // eslint-disable-next-line no-await-in-loop
        const m = await LSCMaps.pin(map, { lat: c.lat, lng: c.lng }, face, {
          title: (isStart && looped ? 'Start and return' : name) + ': ' + c.address,
          zIndex: isStart ? 2 : 1,
        });
        if (m) made.push(m);
      }
      if (mine !== drawSeq || !alive) {
        made.forEach((m) => {
          m.map = null;
        });
        return;
      }
      markers = made;
    }

    async function drawPending() {
      if (pendingMarker) pendingMarker.map = null;
      pendingMarker = null;
      if (!pending || !mapReady) return;
      const at = { lat: pending.lat, lng: pending.lng };
      const m = await LSCMaps.pin(map, at, pinEl('', 'is-pending'), {
        title: 'Use this location',
        zIndex: 3,
        onClick: () => confirm(),
      });
      // Replaced or dropped while the marker library loaded.
      if (!alive || !pending || pending.lat !== at.lat || pending.lng !== at.lng) {
        if (m) m.map = null;
        return;
      }
      if (pendingMarker) pendingMarker.map = null;
      pendingMarker = m;
    }

    // ── Drawing the stops ──────────────────────────────────────────────────

    /* The drive into each placed cell, by cell id, while Show trip details is
       on and the stored legs belong to these stops: legs[i] runs from stop i
       to stop i + 1 of the trip, whose stops are the placed cells in order. */
    function legsByCell() {
      const out = new Map();
      const trip = tripOf(cells, base);
      if (!details || !trip || !fits(trip)) return out;
      trip.stops.forEach((s, i) => {
        const leg = i > 0 ? base.legs[i - 1] : null;
        if (leg) out.set(s.id, leg);
      });
      return out;
    }

    function legMarkup(leg) {
      const clock = leg.departAt && leg.arriveAt ? clockText(leg.departAt) + ' → ' + clockText(leg.arriveAt) : '';
      return (
        '<li class="trip-leg' + (routing ? ' is-stale' : '') + '" aria-hidden="true">' +
        '<span class="trip-leg-fig">— ' + esc(legKm(leg.km)) + ' · ' + esc(duration(leg.minutes)) + ' —</span>' +
        (clock ? '<span class="trip-leg-clock">' + esc(clock) + '</span>' : '') +
        '</li>'
      );
    }

    function legSpoken(leg) {
      return 'Drive from the stop before: ' + legKm(leg.km) + ', ' + durationSpoken(leg.minutes) +
        (leg.departAt && leg.arriveAt ? ', leaving ' + clockText(leg.departAt) + ', arriving ' + clockText(leg.arriveAt) : '') + '.';
    }

    function paint() {
      const start = startCell();
      const legs = legsByCell();
      // A route can come back while focus is on a cell's button: the rebuilt cell gets it back.
      const had = listEl.contains(document.activeElement) ? document.activeElement : null;
      const hadCell = had && had.closest('[data-stop-id]');
      const hadAct = had && had.dataset.act;
      listEl.innerHTML = cells.map((c) => {
        const leg = legs.get(c.id);
        return (leg ? legMarkup(leg) : '') + cellMarkup(cells, c, waiting, start, leg ? legSpoken(leg) : '');
      }).join('');
      if (hadCell && !listEl.contains(document.activeElement)) focusIn(hadCell.dataset.stopId, hadAct);
      const toggle = q('.trip-details-btn');
      toggle.setAttribute('aria-pressed', String(details));
      listEl.hidden = !cells.length;
      q('.trip-empty').hidden = cells.length > 0;

      const dests = destinations();
      const full = dests.length >= MAX_DESTINATIONS;
      const hasReturn = cells.some((c) => c.role === 'return');
      const wait = mapReady ? '' : ' disabled';
      let html = '';
      if (!start) {
        html = '<button type="button" class="btn btn-ghost trip-add trip-add-start"' + wait + '>+ Add start location</button>';
      } else if (isPlaced(start)) {
        html = '<button type="button" class="btn btn-ghost trip-add trip-add-dest"' + (full ? ' disabled' : wait) + '>+ Destination</button>';
        if (!hasReturn && dests.some(isPlaced)) {
          html += '<button type="button" class="btn btn-ghost trip-add trip-add-return">Return trip</button>';
        }
      }
      adds.innerHTML = html;
      adds.hidden = !html;
      q('.trip-cap').hidden = !full;

      const n = placedCount();
      pane.setAttribute('aria-label', 'Map of ' + day.title + '’s route, ' + (n ? n + (n === 1 ? ' stop' : ' stops') : 'no stops yet'));
      if (map) map.setOptions({ draggableCursor: waiting ? 'crosshair' : null });
      drawPins();
      paintRoute();
    }

    function focusIn(id, act) {
      const li = id && listEl.querySelector('[data-stop-id="' + CSS.escape(id) + '"]');
      const btn = li && (li.querySelector('[data-act="' + act + '"]') || li.querySelector('button'));
      if (btn) btn.focus();
      return Boolean(btn);
    }

    /* After a stop is set: the next thing to do, in the order the brief adds them. */
    function focusNext() {
      const btn = adds.querySelector('.trip-add-dest:not(:disabled)') || adds.querySelector('.trip-add-return') ||
        adds.querySelector('.trip-add:not(:disabled)');
      if (btn) btn.focus();
      else q('#trip-h').focus();
    }

    // ── Waiting for a location ─────────────────────────────────────────────

    function startWaiting(id) {
      const cell = cellById(id);
      if (!cell || !mapReady) return;
      waiting = id;
      clearPending();
      closeList();
      session = null;
      input.value = '';
      qMsg.textContent = '';
      q('.trip-search-for').textContent = nameOf(cells, cell);
      search.hidden = false;
      paint();
      input.focus({ preventScroll: !PHONE.matches });
      if (PHONE.matches) search.scrollIntoView({ block: 'nearest' });
      if (cell.role === 'start') offerHome();
    }

    /* Stop waiting: the cell keeps what it had (an empty one stays empty). */
    function stopWaiting(focusAct) {
      const id = waiting;
      waiting = null;
      clearPending();
      closeList();
      session = null;
      search.hidden = true;
      paint();
      if (focusAct && !focusIn(id, focusAct)) focusNext();
    }

    function setPending(place) {
      pending = Object.assign({ looking: false }, place);
      pendingLabel = place.address;
      paintCard();
      drawPending();
      if (mapReady && !place.looking) {
        const at = { lat: place.lat, lng: place.lng };
        if (REDUCED.matches) map.setCenter(at);
        else map.panTo(at);
        if ((map.getZoom() || 0) < 14) map.setZoom(15);
      }
    }

    function clearPending() {
      pending = null;
      pendingLabel = '';
      if (pendingMarker) pendingMarker.map = null;
      pendingMarker = null;
      paintCard();
    }

    function paintCard() {
      card.hidden = !pending;
      if (!pending) return;
      q('.trip-pending-addr').textContent = pending.looking ? 'Finding the address…' : pending.address;
      q('.trip-use').disabled = Boolean(pending.looking);
    }

    /* The pending pin, its card's button or Enter: the waiting cell takes the spot. */
    function confirm() {
      const cell = waiting && cellById(waiting);
      if (!cell || !pending || pending.looking) return;
      Object.assign(cell, { address: pending.address, lat: pending.lat, lng: pending.lng, placeId: pending.placeId || '' });
      waiting = null;
      clearPending();
      closeList();
      session = null;
      search.hidden = true;
      paint();
      changed();
      fit(true);
      say(nameOf(cells, cell) + ' set: ' + cell.address + '.');
      focusNext();
    }

    // ── The search combobox (typeahead.js's shape, over Places) ────────────

    function closeList() {
      list.hidden = true;
      list.innerHTML = '';
      results = [];
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setActive(i) {
      active = i;
      Array.from(list.children).forEach((li, j) => li.setAttribute('aria-selected', j === i ? 'true' : 'false'));
      if (i >= 0) {
        input.setAttribute('aria-activedescendant', 'trip-q-' + i);
        list.children[i].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function renderList(items) {
      results = items;
      active = -1;
      if (!items.length) return closeList();
      list.innerHTML = items
        .map((item, i) =>
          '<li role="option" id="trip-q-' + i + '" aria-selected="false" data-i="' + i + '"' + (item.home ? ' class="is-home"' : '') + '>' +
          '<span class="trip-sug-main">' + esc(item.home ? 'Home base' : item.main || item.label) + '</span>' +
          (item.home || item.sub ? '<span class="trip-sug-sub">' + esc(item.home ? item.place.address : item.sub) + '</span>' : '') +
          '</li>')
        .join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    /* Home base first for START (T9): on an empty field, and for a query it matches. */
    function homeItem(query) {
      const cell = waiting && cellById(waiting);
      const hb = cell && cell.role === 'start' ? homeBase() : null;
      if (!hb) return null;
      const qq = (query || '').toLowerCase();
      if (qq && 'home base'.indexOf(qq) !== 0 && hb.address.toLowerCase().indexOf(qq) === -1) return null;
      return { home: true, place: { address: hb.address, lat: hb.lat, lng: hb.lng, placeId: hb.placeId || '' } };
    }

    function offerHome() {
      const item = homeItem('');
      if (item && !input.value.trim()) renderList([item]);
    }

    async function ensureSession() {
      if (!session) session = await LSCMaps.newSession();
      return session;
    }

    async function suggestFor(query) {
      const mine = ++seq;
      let items;
      try {
        items = await LSCMaps.suggest(query, { session: await ensureSession(), map });
      } catch (err) {
        if (mine === seq && alive) {
          closeList();
          qMsg.textContent = err.message;
        }
        return;
      }
      if (mine !== seq || !alive || document.activeElement !== input) return;
      qMsg.textContent = '';
      const home = homeItem(query);
      renderList((home ? [home] : []).concat(items));
    }

    async function pick(item) {
      seq++; // a search still in flight must not reopen the list over the pick
      clearTimeout(timer);
      closeList();
      if (item.home) {
        setPending(item.place);
        confirm();
        return;
      }
      const forCell = waiting;
      qMsg.textContent = 'Finding ' + item.label + '…';
      let place;
      try {
        place = await LSCMaps.place(item);
      } catch (err) {
        if (alive && waiting === forCell) qMsg.textContent = err.message;
        return;
      }
      session = null; // that search's session ended with the place
      if (!alive || waiting !== forCell) return;
      qMsg.textContent = '';
      input.value = place.address;
      setPending(place);
      say('Pin at ' + place.address + '. Press Enter, or choose Use this location, to set ' + nameOf(cells, cellById(forCell)) + '.');
    }

    /* Search, or Enter with nothing chosen: the best match (T10). The top
       suggestion if there is one, else the address geocoded. */
    async function bestMatch(query) {
      const mine = ++seq;
      const forCell = waiting;
      clearTimeout(timer);
      closeList();
      qMsg.textContent = 'Searching…';
      try {
        const items = await LSCMaps.suggest(query, { session: await ensureSession(), map });
        if (mine !== seq || !alive || waiting !== forCell) return;
        if (items.length) return pick(items[0]);
        const found = await LSCMaps.geocode(query);
        if (mine !== seq || !alive || waiting !== forCell) return;
        if (found) {
          qMsg.textContent = '';
          input.value = found.address;
          setPending(found);
          say('Pin at ' + found.address + '. Press Enter, or choose Use this location, to set ' + nameOf(cells, cellById(forCell)) + '.');
          return;
        }
        qMsg.textContent = 'Nothing found for “' + query + '”. Try a street address and suburb, or click the spot on the map.';
      } catch (err) {
        if (mine === seq && alive) qMsg.textContent = err.message;
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const query = input.value.trim();
      qMsg.textContent = '';
      if (query.length < MIN_QUERY) {
        seq++;
        const home = homeItem(query);
        if (home) renderList([home]);
        else closeList();
        return;
      }
      timer = setTimeout(() => suggestFor(query), SUGGEST_MS);
    });

    input.addEventListener('focus', () => {
      if (!input.value.trim()) offerHome();
    });

    input.addEventListener('keydown', (e) => {
      const open = !list.hidden && results.length > 0;
      if (e.key === 'ArrowDown' && open) {
        e.preventDefault();
        setActive(active < results.length - 1 ? active + 1 : 0);
      } else if (e.key === 'ArrowUp' && open) {
        e.preventDefault();
        setActive(active > 0 ? active - 1 : results.length - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (open && active >= 0) return void pick(results[active]);
        const query = input.value.trim();
        if (pending && !pending.looking && query === pendingLabel) return confirm();
        if (query) bestMatch(query);
      } else if (e.key === 'Escape') {
        // Stops here so nothing round the view (a sheet, the editor) also takes it.
        e.stopPropagation();
        // Closing the list also drops a reply still on its way, which would open it again.
        seq++;
        clearTimeout(timer);
        if (open) return closeList();
        if (pending) {
          clearPending();
          qMsg.textContent = '';
          say('Pin removed.');
          return;
        }
        const cell = cellById(waiting);
        stopWaiting(cell && isPlaced(cell) ? 'change' : 'place');
      }
    });

    input.addEventListener('blur', () => {
      clearTimeout(timer);
      if (!list.hidden) {
        seq++;
        closeList();
      }
    });

    // mousedown, not click: a click lands after the field's blur has closed the list.
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      e.preventDefault();
      pick(results[Number(li.dataset.i)]);
    });

    q('.trip-q-go').addEventListener('click', () => {
      const query = input.value.trim();
      if (pending && !pending.looking && query === pendingLabel) return confirm();
      if (query) bestMatch(query);
      else input.focus();
    });

    q('.trip-use').addEventListener('click', () => confirm());
    q('.trip-pending-x').addEventListener('click', () => {
      seq++;
      clearPending();
      input.focus();
    });

    /* A click on the map, while a cell waits: that spot, its address looked up. */
    async function onMapClick(e) {
      if (!waiting || !e.latLng) return;
      const at = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const forCell = waiting;
      seq++;
      closeList();
      qMsg.textContent = '';
      setPending({ address: '', lat: at.lat, lng: at.lng, placeId: '', looking: true });
      let found = null;
      let failed = false;
      try {
        found = await LSCMaps.reverseGeocode(at);
      } catch (err) {
        failed = true;
      }
      // Another click, a search or a cancel got there first.
      if (!alive || waiting !== forCell || !pending || pending.lat !== at.lat || pending.lng !== at.lng) return;
      const place = found || { address: spotText(at), lat: at.lat, lng: at.lng, placeId: '' };
      pending = Object.assign({ looking: false }, place);
      pendingLabel = place.address;
      input.value = place.address;
      paintCard();
      if (failed) qMsg.textContent = 'Couldn’t look up the address. The pin can still be used: it’s saved by its coordinates.';
      say('Pin at ' + place.address + '. Choose Use this location to set ' + nameOf(cells, cellById(forCell)) + '.');
    }

    // Escape on the card's buttons: the pin goes, and the search takes focus back.
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !pending) return;
      e.stopPropagation();
      seq++;
      clearPending();
      input.focus();
    });

    // ── Adding and removing stops ──────────────────────────────────────────

    function addStart() {
      if (startCell()) return;
      const cell = { id: newStopId(), role: 'start' };
      cells.unshift(cell);
      startWaiting(cell.id);
    }

    function addDestination() {
      // One empty destination at a time: + Destination goes back to it.
      const empty = destinations().find((c) => !isPlaced(c));
      if (empty) return startWaiting(empty.id);
      if (destinations().length >= MAX_DESTINATIONS) return;
      const cell = { id: newStopId(), role: 'stop' };
      const at = cells.findIndex((c) => c.role === 'return');
      cells.splice(at === -1 ? cells.length : at, 0, cell);
      startWaiting(cell.id);
    }

    function addReturn() {
      if (cells.some((c) => c.role === 'return') || !destinations().some(isPlaced)) return;
      cells.push({ id: newStopId(), role: 'return' });
      paint();
      changed();
      say('Return trip added: back to ' + startCell().address + '.');
      focusNext();
    }

    /* Put the stops back as they were (a toast's Undo). */
    function restoreCells(saved) {
      if (waiting) {
        waiting = null;
        clearPending();
        closeList();
        search.hidden = true;
      }
      cells = copyCells(saved);
      paint();
      changed();
      fit(true);
    }

    function removeCell(id) {
      const i = cells.findIndex((c) => c.id === id);
      if (i === -1) return;
      const cell = cells[i];
      const name = nameOf(cells, cell);
      const before = copyCells(cells);
      const baseBefore = base;
      const wasPlaced = cell.role === 'return' || isPlaced(cell);
      cells.splice(i, 1);
      // RETURN needs a placed destination before it (days.js), so it goes with the last one.
      const dropsReturn = cell.role === 'stop' && !destinations().some(isPlaced) && cells.some((c) => c.role === 'return');
      if (dropsReturn) cells = cells.filter((c) => c.role !== 'return');
      if (waiting === id || (waiting && !cellById(waiting))) {
        waiting = null;
        clearPending();
        closeList();
        search.hidden = true;
      }
      paint();
      if (wasPlaced) {
        changed();
        fit(true);
        const dayId = day.id;
        Toast.ok(dropsReturn ? 'Stop and return trip removed' : 'Stop removed', {
          action: {
            label: 'Undo',
            run: () => {
              const view = live.get(dayId);
              if (view) return view.restore(before, baseBefore);
              // The view has closed: the day takes its trip back all the same.
              onChange(tripOf(before, baseBefore));
            },
          },
        });
      }
      say(name + (dropsReturn ? ' and the return trip' : '') + ' removed.');
      // Focus to the cell that took its place, or the one before, or what comes next.
      const next = cells[i] || cells[i - 1];
      if (!next || !focusIn(next.id, 'remove')) focusNext();
    }

    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('[data-stop-id]').dataset.stopId;
      if (btn.dataset.act === 'remove') removeCell(id);
      else startWaiting(id);
    });

    adds.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      if (btn.classList.contains('trip-add-start')) addStart();
      else if (btn.classList.contains('trip-add-dest')) addDestination();
      else if (btn.classList.contains('trip-add-return')) addReturn();
    });

    q('.trip-back').addEventListener('click', () => onBack());
    retry.addEventListener('click', () => {
      startMap();
      retry.blur();
      q('#trip-h').focus();
    });

    // Recalculate, or Try again after a failure: the message's button, then focus to the totals' heading.
    q('.trip-recalc').addEventListener('click', () => {
      recalculate();
      q('#trip-totals-h').focus();
    });

    // The view's ⋯ (task 6 adds Clear trip).
    const more = q('.trip-more');
    more.addEventListener('click', () => {
      LSCMenu.open(more, {
        label: 'Travel actions',
        items: [{ text: 'Recalculate', hint: 'Ask Google again for this day' }],
        onSelect: () => recalculate(),
      });
    });

    q('.trip-details-btn').addEventListener('click', () => {
      details = !details;
      saveDetailsPref(details);
      paint();
      say(details ? 'Trip details shown: the drive between each stop.' : 'Trip details hidden.');
    });

    paint();
    startMap();

    const view = {
      el,
      dayId: day.id,
      focus() {
        q('#trip-h').focus({ preventScroll: true });
      },
      restore(saved, savedBase) {
        if (!alive) return;
        base = savedBase;
        restoreCells(saved);
      },
      destroy() {
        alive = false;
        clearTimeout(timer);
        if (live.get(day.id) === view) live.delete(day.id);
        stopListening();
        PHONE.removeEventListener('change', onPhoneChange);
        markers.forEach((m) => {
          m.map = null;
        });
        if (pendingMarker) pendingMarker.map = null;
        routeSeq++;
        lineSeq++;
        if (routeLine) routeLine.setMap(null);
        routeLine = null;
        map = null;
      },
    };
    live.set(day.id, view);
    return { el, dayId: view.dayId, focus: view.focus, destroy: view.destroy };
  }

  return { mount };
})();
