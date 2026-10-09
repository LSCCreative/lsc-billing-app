'use strict';

/* Google Maps, in one place (.design/trip-planner/, T1; task 2).
 *
 * Every call the browser makes to Google goes through this file: loading the
 * script, the map itself, and (tasks 3 and 4) address search, reverse
 * geocoding and routes. That keeps the billable calls countable, the failure
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

  return {
    load,
    createMap,
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
