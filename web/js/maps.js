'use strict';

/* Google Maps, in one place (Project build archive/tracks/trip-planner/, T1; task 2).
 *
 * Every call the browser makes to Google goes through this file: loading the
 * script, the map itself, address search and reverse geocoding (task 3),
 * and routes (task 4). That keeps the billable calls countable, the failure
 * messages consistent, and a change of provider inside one file.
 *
 * THE KEY. window.LSC_MAPS_KEY (and LSC_MAPS_ID, the Map ID that numbered
 * Advanced Markers need) come from js/config.js, which is gitignored: Pages
 * writes it from repository secrets (deploy-pages.yml), and a local copy is
 * filled in by hand from .credentials.local.md. The key is website-restricted
 * to the Pages origin and http://localhost:5173, so a preview on any other
 * port is refused by Google, not by this file.
 *
 * LOADING. The script is added once, on first use, never at page load: a
 * session that never opens the travel view never loads Google (or pays for a
 * map load). load() resolves when it is ready. It rejects with an Error whose
 * `code` says why, and whose message is the sentence to show:
 *   no_key      this site has no map key (config.js)
 *   network     the script didn't arrive (offline, blocked)
 *   refused     Google turned the key down: not allowed from this address,
 *               an API not enabled on it, or billing off on the project
 * A network failure can be tried again (load() starts afresh); a refusal
 * can't, short of reloading the page with a fixed key, so it stays refused.
 *
 * Google reports a refusal by calling window.gm_authFailure after the script
 * has loaded, and may do so after a map has been drawn (the map then turns
 * into Google's own error tile). onRefused(fn) tells a screen when that
 * happens, so it can say so in its own words.
 */

const LSCMaps = (() => {
  const LIBRARIES = ['places', 'routes', 'marker', 'geocoding'];
  const CALLBACK = '__lscMapsReady';
  /* Where a map opens before it has anything to show: Sydney, where the
     business is (the app's zone is Australia/Sydney). */
  const HOME_VIEW = { center: { lat: -33.8688, lng: 151.2093 }, zoom: 10 };

  let loading = null; // the load in flight or done, or null
  let refusal = null; // the Error once Google has refused the key
  const refusedListeners = new Set();

  function fail(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  const REFUSED_MESSAGE =
    'Google refused this site’s map key. It may not allow this address, an API may be switched off ' +
    'for it, or billing may be off on the Google Cloud project.';

  window.gm_authFailure = () => {
    refusal = fail('refused', REFUSED_MESSAGE);
    refusedListeners.forEach((fn) => {
      try {
        fn(refusal);
      } catch (err) {
        console.error(err);
      }
    });
  };

  const ready = () => Boolean(window.google && window.google.maps && window.google.maps.importLibrary);

  /** Google Maps JS, loaded once. Resolves with google.maps. */
  function load() {
    if (refusal) return Promise.reject(refusal);
    if (loading) return loading;
    const key = String(window.LSC_MAPS_KEY || '').trim();
    if (!key) {
      return Promise.reject(fail('no_key', 'Google Maps isn’t set up on this site yet: there’s no map key in its settings.'));
    }
    if (ready()) {
      loading = Promise.resolve(window.google.maps);
      return loading;
    }
    let script = null;
    loading = new Promise((resolve, reject) => {
      window[CALLBACK] = () => {
        delete window[CALLBACK];
        resolve(window.google.maps);
      };
      const params = new URLSearchParams({
        key,
        v: 'weekly',
        libraries: LIBRARIES.join(','),
        loading: 'async',
        callback: CALLBACK,
        region: 'AU',
        language: 'en-AU',
      });
      script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?' + params.toString();
      script.async = true;
      script.onerror = () => reject(fail('network', 'Google Maps didn’t load. Check the connection and try again.'));
      document.head.appendChild(script);
    }).catch((err) => {
      // A failed script can't be retried in place: take it out so the next load() starts afresh.
      if (script) script.remove();
      delete window[CALLBACK];
      loading = null;
      throw err;
    });
    return loading;
  }

  /**
   * A map in `el`: Google's standard style (T1b), its own +/− zoom and drag,
   * and nothing else of its chrome. Clicks on Google's own places don't open
   * their info cards, because a click on the map places a stop (task 3).
   *
   * `phone`: Google's cooperative gestures (two fingers to pan, so one finger
   * still scrolls the page past the map). Otherwise the wheel zooms, as on
   * Google Maps.
   */
  async function createMap(el, options) {
    const opts = options || {};
    await load();
    const { Map } = await window.google.maps.importLibrary('maps');
    const mapId = String(window.LSC_MAPS_ID || '').trim();
    return new Map(el, Object.assign({
      center: HOME_VIEW.center,
      zoom: HOME_VIEW.zoom,
      disableDefaultUI: true,
      zoomControl: true,
      keyboardShortcuts: true,
      clickableIcons: false,
      gestureHandling: opts.phone ? 'cooperative' : 'greedy',
    }, mapId ? { mapId } : {}));
  }

  // ── Places: address search (task 3, T10) ───────────────────────────────────
  /* Places Autocomplete (New), Australian addresses and places, nudged
     towards what the map is showing. Google bills autocomplete by SESSION:
     the suggestions typed for one stop and the one place looked up at the
     end are one session when they share a token. So a caller makes a token
     with newSession() when a search starts, passes it to every suggest() and
     to the place() that ends it, and makes a fresh one for the next search.

     A stop's address is the suggestion's own full text ("Bondi Pavilion,
     Queen Elizabeth Drive, Bondi Beach NSW"), which names the place as well
     as the street, less the country every stop shares. The place lookup then
     asks for its location only, the cheapest field there is. */

  const searchFailed = () => fail('search', 'Couldn’t search Google Maps. Check the connection and try again.');
  const COUNTRY = /,\s*Australia$/;
  const tidy = (text) => String(text || '').replace(COUNTRY, '').trim().slice(0, 300);

  async function places() {
    await load();
    return window.google.maps.importLibrary('places');
  }

  async function newSession() {
    const { AutocompleteSessionToken } = await places();
    return new AutocompleteSessionToken();
  }

  /**
   * Suggestions for `query`: [{ placeId, label, main, sub, prediction }].
   * `bias` is the map (its bounds) or nothing (Home view). Rejects with
   * code 'search' when Google can't be asked.
   */
  async function suggest(query, options) {
    const opts = options || {};
    let lib;
    try {
      lib = await places();
    } catch (err) {
      throw err.code ? err : searchFailed();
    }
    const request = {
      input: query,
      includedRegionCodes: ['au'],
      region: 'au',
      language: 'en-AU',
    };
    if (opts.session) request.sessionToken = opts.session;
    const bounds = opts.map && opts.map.getBounds && opts.map.getBounds();
    request.locationBias = bounds || { center: HOME_VIEW.center, radius: 50000 };
    let reply;
    try {
      reply = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
    } catch (err) {
      console.error(err);
      throw searchFailed();
    }
    return (reply.suggestions || [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        placeId: p.placeId,
        label: tidy(p.text && p.text.text),
        main: (p.mainText && p.mainText.text) || '',
        sub: tidy(p.secondaryText && p.secondaryText.text),
        prediction: p,
      }))
      .filter((s) => s.label);
  }

  /** The suggestion as a stop's place: { address, lat, lng, placeId }. Ends its session. */
  async function place(suggestion) {
    let found;
    try {
      found = suggestion.prediction.toPlace();
      await found.fetchFields({ fields: ['location'] });
    } catch (err) {
      console.error(err);
      throw searchFailed();
    }
    if (!found.location) throw searchFailed();
    return { address: suggestion.label, lat: found.location.lat(), lng: found.location.lng(), placeId: suggestion.placeId || '' };
  }

  // ── Geocoding (task 3, T10) ─────────────────────────────────────────────────
  /* The two directions: a typed address nothing suggested (Search with no
     suggestion, a pasted address), and a spot clicked on the map. Google
     answers "nothing there" with an error, not an empty list; that's an empty
     list here, and only a failure to reach it is an error. */

  async function geocoder() {
    await load();
    const { Geocoder } = await window.google.maps.importLibrary('geocoding');
    return new Geocoder();
  }

  async function geocodeRequest(request) {
    let gc;
    try {
      gc = await geocoder();
    } catch (err) {
      throw err.code ? err : searchFailed();
    }
    try {
      const reply = await gc.geocode(request);
      return (reply && reply.results) || [];
    } catch (err) {
      if (err && err.code === 'ZERO_RESULTS') return [];
      console.error(err);
      throw searchFailed();
    }
  }

  const fromResult = (r) => ({
    address: tidy(r.formatted_address),
    lat: r.geometry.location.lat(),
    lng: r.geometry.location.lng(),
    placeId: r.place_id || '',
  });

  /* Too coarse to drive to: restricted to Australia, a query Google can't
     read comes back as "Australia" (or a state) rather than as nothing. */
  const COARSE = ['country', 'administrative_area_level_1', 'colloquial_area'];
  const types = (r) => r.types || [];
  const usable = (r) => !types(r).some((t) => COARSE.indexOf(t) !== -1);

  /** The best place for a typed address in Australia, or null. */
  async function geocode(query) {
    const results = (await geocodeRequest({ address: query, region: 'au', componentRestrictions: { country: 'AU' } })).filter(usable);
    return results.length ? fromResult(results[0]) : null;
  }

  /** The address at a spot, or null when Google has none (open water, the bush). A
      street address is preferred to a Plus Code ("P6GR+37 Newnes Plateau"), which
      is what Google puts first where there's no street. */
  async function reverseGeocode(at) {
    const results = (await geocodeRequest({ location: at })).filter(usable);
    if (!results.length) return null;
    const best = results.find((r) => types(r).indexOf('plus_code') === -1) || results[0];
    return Object.assign(fromResult(best), { lat: at.lat, lng: at.lng });
  }

  // ── Pins (task 3) ───────────────────────────────────────────────────────────
  /* Advanced Markers, which need the Map ID (LSC_MAPS_ID). Their look is the
     element they're given, so the caller styles it with tokens like any
     other element (css/trip.css .trip-pin). Without a Map ID there are no
     pins, and the stop list still carries every stop. */

  const canPin = () => Boolean(String(window.LSC_MAPS_ID || '').trim());

  /** A pin on `map` at `at`, drawn as `el`. Returns the marker; marker.map = null removes it. */
  async function pin(map, at, el, options) {
    if (!canPin()) return null;
    const opts = options || {};
    const { AdvancedMarkerElement } = await window.google.maps.importLibrary('marker');
    const marker = new AdvancedMarkerElement({
      map,
      position: at,
      content: el,
      title: opts.title || '',
      zIndex: opts.zIndex || null,
      gmpClickable: Boolean(opts.onClick),
    });
    if (opts.onClick) marker.addEventListener('gmp-click', opts.onClick);
    return marker;
  }

  /**
   * Bring `points` ([{ lat, lng }]) into view: one is centred at street
   * level, several are fitted with room round the pins. `animate` pans
   * rather than jumps, where Google can (off for reduced motion).
   */
  function show(map, points, options) {
    if (!map || !points.length) return;
    const animate = Boolean(options && options.animate);
    if (points.length === 1) {
      if (animate) map.panTo(points[0]);
      else map.setCenter(points[0]);
      if ((map.getZoom() || 0) < 14) map.setZoom(15);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 56);
  }

  // ── Routes (task 4, T5) ─────────────────────────────────────────────────────
  /* Google's Routes API, asked directly over HTTPS with the browser key (it
     is website-restricted, and the request carries this page's address the
     way the map's own requests do). The Maps script isn't needed for it.

     WITH TRAFFIC (a departure time is given): one request per leg, in order,
     each leaving when the one before it arrived plus the time on location
     there (T5, T11), so every leg is priced at its own hour of the day.
     WITHOUT: one request for the whole trip, its stops as waypoints.

     A route is all or nothing: if any leg fails, route() rejects and the
     caller keeps its last good figures (the brief's "never a half result"). */

  const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  const ROUTE_FIELDS = 'routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline';

  const routeFailed = () => fail('route', 'Couldn’t reach Google Maps to work out the route. Check the connection and try again.');

  const waypoint = (s) => ({ location: { latLng: { latitude: s.lat, longitude: s.lng } } });
  const seconds = (d) => (typeof d === 'string' ? parseFloat(d) : 0) || 0;

  /* One Routes request through `points`, in order: [{ km, minutes, polyline }] per leg. */
  async function computeLegs(key, points, departAt) {
    const body = {
      origin: waypoint(points[0]),
      destination: waypoint(points[points.length - 1]),
      travelMode: 'DRIVE',
      routingPreference: departAt ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
      polylineQuality: 'OVERVIEW',
      regionCode: 'AU',
      languageCode: 'en-AU',
      units: 'METRIC',
    };
    if (points.length > 2) body.intermediates = points.slice(1, -1).map(waypoint);
    if (departAt) body.departureTime = departAt.toISOString();
    let res;
    try {
      res = await fetch(ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': ROUTE_FIELDS },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw routeFailed();
    }
    let reply = null;
    try {
      reply = await res.json();
    } catch (err) {
      reply = null;
    }
    if (res.status === 403) {
      throw fail('refused', 'Google refused the route request. The Routes API may be switched off for this site’s map key.');
    }
    if (!res.ok) {
      console.error('Routes API', res.status, reply);
      throw routeFailed();
    }
    const route = reply && Array.isArray(reply.routes) ? reply.routes[0] : null;
    const legs = route && Array.isArray(route.legs) ? route.legs : [];
    if (legs.length !== points.length - 1) {
      throw fail('no_route', 'Google found no driving route between these stops. Check that each one can be reached by road.');
    }
    return legs.map((l) => ({
      km: (l.distanceMeters || 0) / 1000,
      minutes: seconds(l.duration) / 60,
      polyline: (l.polyline && l.polyline.encodedPolyline) || '',
    }));
  }

  /**
   * The driving route through `stops` ([{ lat, lng }], two or more), as
   * { legs: [{ km, minutes }], polyline } with the legs in order and the
   * polyline the whole trip's line, encoded.
   *
   * options.departAt: a Date to leave the first stop at, with traffic; leave
   * it out for Google's traffic-unaware times. options.dwell(i): minutes
   * spent at stop i before the next leg leaves (time on location).
   */
  async function route(stops, options) {
    const opts = options || {};
    const key = String(window.LSC_MAPS_KEY || '').trim();
    if (!key) throw fail('no_key', 'Google Maps isn’t set up on this site yet: there’s no map key in its settings.');
    if (refusal) throw refusal;
    const dwell = typeof opts.dwell === 'function' ? opts.dwell : () => 0;
    let legs;
    if (!opts.departAt) {
      legs = await computeLegs(key, stops, null);
    } else {
      legs = [];
      let at = opts.departAt.getTime();
      for (let i = 0; i < stops.length - 1; i++) {
        // eslint-disable-next-line no-await-in-loop
        const [leg] = await computeLegs(key, [stops[i], stops[i + 1]], new Date(at));
        legs.push(leg);
        at += (leg.minutes + (Number(dwell(i + 1)) || 0)) * 60000;
      }
    }
    return {
      legs: legs.map((l) => ({ km: l.km, minutes: l.minutes })),
      polyline: joinPolylines(legs.map((l) => l.polyline)),
    };
  }

  // ── Encoded polylines ───────────────────────────────────────────────────────
  /* Google's encoded polyline format (precision 5): the legs' lines joined
     into one, stored with the trip so the map redraws without asking Google
     (T6), and later drawn on the call sheet's static map. days.js caps it at
     50,000 characters; a longer line is thinned to fit, keeping each end. */

  const MAX_POLYLINE = 49000;

  function decode(str) {
    const points = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
      let result = 0;
      let shift = 0;
      let b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20); // past the end, charCodeAt is NaN, which stops it
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (i < (str || '').length) {
      lat += next();
      lng += next();
      points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return points;
  }

  function encodeValue(v) {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let out = '';
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return out + String.fromCharCode(n + 63);
  }

  function encode(points) {
    let lat = 0;
    let lng = 0;
    let out = '';
    points.forEach((p) => {
      const la = Math.round(p.lat * 1e5);
      const ln = Math.round(p.lng * 1e5);
      out += encodeValue(la - lat) + encodeValue(ln - lng);
      lat = la;
      lng = ln;
    });
    return out;
  }

  function joinPolylines(parts) {
    let points = [];
    parts.forEach((part) => {
      const pts = decode(part || '');
      // A leg starts where the last one ended: that point once, not twice.
      points = points.concat(points.length && pts.length ? pts.slice(1) : pts);
    });
    let out = encode(points);
    for (let step = 2; out.length > MAX_POLYLINE && points.length > 2; step++) {
      const thin = points.filter((p, i) => i % step === 0 || i === points.length - 1);
      out = encode(thin);
    }
    return out;
  }

  /** The route's line on `map`, drawn from its encoded polyline. line.setMap(null) removes it. */
  async function routeLine(map, encoded, options) {
    if (!map || !encoded) return null;
    const opts = options || {};
    const { Polyline } = await window.google.maps.importLibrary('maps');
    return new Polyline({
      map,
      path: decode(encoded),
      clickable: false,
      strokeColor: opts.color || '#C0603C',
      strokeOpacity: opts.opacity === undefined ? 0.9 : opts.opacity,
      strokeWeight: 5,
      zIndex: 1,
    });
  }

  return {
    load,
    createMap,
    show,
    newSession,
    suggest,
    place,
    geocode,
    reverseGeocode,
    canPin,
    pin,
    route,
    routeLine,
    decode,
    /** fn(err) once Google refuses the key; returns a function that stops listening. */
    onRefused(fn) {
      refusedListeners.add(fn);
      return () => refusedListeners.delete(fn);
    },
    /** The refusal, if Google has refused the key in this page. */
    refused: () => refusal,
    HOME_VIEW,
  };
})();
