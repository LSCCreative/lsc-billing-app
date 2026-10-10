/**
 * The call sheet's markup (trip-planner task 10; T12, T13, T18, I4).
 *
 * One pure function, three skins. The owner's page in the app, the crew's page
 * at c/#s/<token> and the PDF all draw the same JSON (public.js callSheetView)
 * through `markup()`, so "the three show the same content" is a property of
 * the code and not of three hand-kept templates. Each host adds only its own
 * chrome around it (the app's Back and Download PDF, the public masthead, the
 * PDF's letterhead) and its own stylesheet (css/call-sheet.css on screen,
 * pdf.js for print).
 *
 * Sibling of calc.js and documents.js and subject to the same rule:
 * web/js/call-sheet.js is a byte-identical copy, and test-call-sheet-page.js
 * fails if the two drift. Pure: no database, no DOM, no other module, no
 * request. It runs in the browser on a public page that loads nothing else of
 * the app.
 *
 * The input is the allow-listed view and is still treated as untrusted text:
 * every string is escaped, the Google Maps link must be a Google Maps address,
 * and the route image must be a PNG data URI, or that part is left out.
 * Nothing here knows a price, because nothing in the view does.
 *
 * Wrapped in a function so its names stay out of the browser's one shared
 * global scope.
 */

(function () {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // The editor's own names for a destination's three notes (trip-planner.js).
  const DETAIL_LABELS = [
    ['capture', 'Capture details'],
    ['description', 'Location description'],
    ['access', 'Access details'],
  ];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Dates arrive as 'YYYY-MM-DD' and are read as text, never through local
     Date getters, so a crew member in another timezone sees the same day. */
  function dayTitle(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return 'Date to be confirmed';
    const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return WEEKDAYS[wd] + ' ' + Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }

  /* '13:00' → '1:00pm', as the quote and the client page write a time. */
  function clock12(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    if (!m) return '';
    const h = Number(m[1]);
    return (h % 12 || 12) + ':' + m[2] + (h < 12 ? 'am' : 'pm');
  }

  /* '7:05' → '07:05', the machine-readable form a <time> carries. */
  function clockIso(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? m[1].padStart(2, '0') + ':' + m[2] : '';
  }

  /* "8 Oct 2026, 2:41 pm" in Sydney time, the business's clock whatever the
     reader's is (T18). Built from parts so no ICU version changes its shape. */
  function updatedText(iso) {
    const t = new Date(iso);
    if (!iso || !Number.isFinite(t.getTime())) return '';
    const p = {};
    new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney', day: 'numeric', month: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(t).forEach((x) => {
      p[x.type] = x.value;
    });
    const month = MONTHS_SHORT[Number(p.month) - 1];
    if (!month) return '';
    // The numeric pattern pads the day ("08"); the page says "8".
    return Number(p.day) + ' ' + month + ' ' + p.year + ', ' + Number(p.hour) + ':' + p.minute + ' ' +
      String(p.dayPeriod || '').toLowerCase().replace(/\./g, '');
  }

  const kmText = (km) => {
    const n = Number(km) || 0;
    return (n > 0 ? Math.max(1, Math.round(n)) : 0) + ' km';
  };

  /* "48 min", "2 h", "2 h 40 min". */
  function durationText(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? h + ' h ' + r + ' min' : h + ' h';
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  /* The title a browser tab and a PDF viewer show: "Call sheet · ABC-123 ·
     Brand film" (I4). */
  function title(cs) {
    return ['Call sheet', cs && cs.upid, cs && cs.name].filter((x) => x && String(x).trim()).join(' · ');
  }

  // Only Google's own page for a stop, only over https.
  const MAPS_URL = /^https:\/\/www\.google\.com\/maps\/[^\s"'<>]*$/;
  // The server embeds the route image it fetched, as a PNG data URI.
  const MAP_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

  function stopRole(stop) {
    if (stop.role === 'start') return 'Start';
    if (stop.role === 'return') return 'Return';
    return 'Stop ' + (stop.n === null || stop.n === undefined ? '' : stop.n);
  }

  function pinOf(stop) {
    if (stop.role === 'start') return 'S';
    if (stop.role === 'return') return 'R';
    return String(stop.mapLabel || stop.n || '');
  }

  function timesHtml(stop) {
    const parts = [];
    if (stop.role === 'start') {
      if (clock12(stop.leaveAt)) parts.push(['Depart', stop.leaveAt]);
    } else if (stop.role === 'return') {
      if (clock12(stop.arriveAt)) parts.push(['Arrive', stop.arriveAt]);
    } else {
      if (clock12(stop.arriveAt)) parts.push(['Arrive', stop.arriveAt]);
      if (clock12(stop.leaveAt)) parts.push(['Leave', stop.leaveAt]);
    }
    if (!parts.length) return '';
    return '<p class="cs-times">' + parts.map(([label, t]) =>
      '<span class="cs-time"><span class="cs-time-label">' + label + '</span> ' +
      '<time class="cs-clock" datetime="' + esc(clockIso(t)) + '">' + esc(clock12(t)) + '</time></span>').join('') + '</p>';
  }

  function legHtml(leg) {
    if (!leg || (!Number(leg.km) && !Number(leg.minutes))) return '';
    return '<p class="cs-leg"><span class="cs-leg-text">Drive ' + esc(kmText(leg.km)) + ' · ' +
      esc(durationText(leg.minutes)) + '</span></p>';
  }

  function stopHtml(stop, leg) {
    const role = stopRole(stop);
    const pin = pinOf(stop);
    // A destination past the ninth is lettered on the map (Static pins take
    // one character); say so, so the schedule can be matched to it.
    const lettered = stop.role === 'stop' && pin && String(stop.n) !== pin;
    const onSite = stop.role === 'stop' && Number(stop.minutesOnSite) > 0
      ? '<p class="cs-onsite">' + esc(durationText(stop.minutesOnSite)) + ' on location</p>' : '';
    const details = DETAIL_LABELS
      .filter(([key]) => stop.details && typeof stop.details[key] === 'string' && stop.details[key].trim())
      .map(([key, label]) => '<div class="cs-detail"><dt>' + esc(label) + '</dt><dd>' +
        esc(stop.details[key].trim()) + '</dd></div>').join('');
    const maps = typeof stop.mapsUrl === 'string' && MAPS_URL.test(stop.mapsUrl)
      ? '<a class="cs-maps" href="' + esc(stop.mapsUrl) + '" target="_blank" rel="noopener noreferrer">' +
        'Open in Google Maps<span class="cs-vh">, ' + esc(role.toLowerCase()) + '. Opens in a new tab.</span></a>'
      : '';
    return '<li class="cs-stop cs-stop-' + esc(stop.role === 'start' || stop.role === 'return' ? stop.role : 'stop') + '">' +
      legHtml(leg) +
      '<div class="cs-stop-row">' +
        '<span class="cs-pin" aria-hidden="true">' + esc(pin) + '</span>' +
        '<div class="cs-stop-main">' +
          '<p class="cs-role">' + esc(role) + (lettered ? '<span class="cs-role-pin"> · map pin ' + esc(pin) + '</span>' : '') + '</p>' +
          '<p class="cs-address">' + esc(stop.address) + '</p>' +
          timesHtml(stop) + onSite +
          (maps ? '<p class="cs-maps-row">' + maps + '</p>' : '') +
          (details ? '<dl class="cs-details">' + details + '</dl>' : '') +
        '</div>' +
      '</div>' +
    '</li>';
  }

  function dayHtml(day, i, cs) {
    const stops = Array.isArray(day.stops) ? day.stops : [];
    const legs = Array.isArray(day.legs) ? day.legs : [];
    const totals = day.totals || {};
    const facts = [];
    if (clock12(day.startTime)) facts.push('Starts ' + clock12(day.startTime));
    if (day.routed && Number(totals.km) > 0) facts.push(kmText(totals.km));
    if (day.routed && Number(totals.minutes) > 0) facts.push(durationText(totals.minutes) + ' driving');
    const destinations = stops.filter((s) => s.role === 'stop').length;
    const map = typeof day.map === 'string' && MAP_URI.test(day.map)
      ? '<figure class="cs-map"><img src="' + esc(day.map) + '" width="1280" height="720" ' +
        'alt="' + esc('Route for ' + dayTitle(day.date) + ', with each stop pinned as numbered below.') + '"></figure>'
      : '';
    return '<section class="cs-day" aria-labelledby="cs-day-' + (i + 1) + '">' +
      '<header class="cs-day-head">' +
        // Print only: a day on its own page still says whose it is.
        '<p class="cs-day-for">' + esc([cs.name, cs.upid].filter(Boolean).join(' · ')) + '</p>' +
        '<h2 class="cs-day-title" id="cs-day-' + (i + 1) + '">' + esc(dayTitle(day.date)) + '</h2>' +
        '<p class="cs-day-facts">' + [plural(destinations, 'stop', 'stops')].concat(facts)
          .map((f) => '<span>' + esc(f) + '</span>').join('') + '</p>' +
      '</header>' +
      map +
      '<ol class="cs-stops">' + stops.map((s, n) => stopHtml(s, n > 0 ? legs[n - 1] : null)).join('') + '</ol>' +
    '</section>';
  }

  const telHref = (phone) => 'tel:' + String(phone || '').replace(/[^\d+]/g, '');

  function footerHtml(cs) {
    const b = cs.business || {};
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name && !email && !phone) return '';
    return '<footer class="cs-foot">' +
      '<p class="cs-foot-ask">Questions about the day? Contact us.</p>' +
      (name ? '<p class="cs-foot-name">' + esc(name) + '</p>' : '') +
      (email ? '<p><a class="cs-foot-link" href="mailto:' + esc(encodeURI(email)) + '">' + esc(email) + '</a></p>' : '') +
      (phone ? '<p><a class="cs-foot-link" href="' + esc(telHref(phone)) + '">' + esc(phone) + '</a></p>' : '') +
    '</footer>';
  }

  function metaRow(label, value, extra) {
    return value ? '<div><dt>' + label + '</dt><dd>' + (extra ? value : esc(value)) + '</dd></div>' : '';
  }

  /**
   * The whole document, as a string of HTML.
   *
   * @param {object} cs  public.js callSheetView's result
   * @returns {string}
   */
  function markup(cs) {
    const v = cs || {};
    const days = Array.isArray(v.days) ? v.days : [];
    const summary = v.summary || {};
    const covers = days.length
      ? plural(days.length, 'day', 'days') + (Number(summary.km) > 0 ? ' · ' + kmText(summary.km) : '')
      : '';
    const updated = updatedText(v.updatedAt);
    return '<article class="cs" aria-labelledby="cs-title">' +
      '<header class="cs-head">' +
        '<p class="cs-kicker">Call sheet</p>' +
        '<h1 class="cs-title" id="cs-title">' + esc(v.name || 'Untitled project') + '</h1>' +
        '<dl class="cs-meta">' +
          metaRow('For', v.client && v.client.businessName) +
          metaRow('Reference', v.upid) +
          metaRow('Covers', covers) +
          metaRow('Updated', updated
            ? '<time datetime="' + esc(v.updatedAt) + '">' + esc(updated) + '</time>' : '', true) +
        '</dl>' +
      '</header>' +
      (days.length
        ? days.map((d, i) => dayHtml(d, i, v)).join('')
        : '<p class="cs-empty">There are no trips on this call sheet yet.</p>') +
      footerHtml(v) +
    '</article>';
  }

  /* Loaded two ways: require()d by the server (the PDF), and as a plain
     <script> in the browser, where it becomes globalThis.LSCCallSheet. */
  const api = { markup, title, esc, dayTitle, clock12, updatedText, durationText, kmText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.LSCCallSheet = api;
}());
