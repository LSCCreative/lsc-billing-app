'use strict';

/**
 * The server's side of Google Maps Platform (trip-planner task 9, T1a, T12):
 * the call sheet's route image, from Maps Static.
 *
 * The NAS makes the request with GOOGLE_MAPS_SERVER_KEY and keeps the PNG; a
 * browser, a client page and a crew member's phone only ever receive the image
 * itself, inlined as a data URI. The key is in the one request URL built here
 * and nowhere else: never returned, logged or put in an error (a failed fetch
 * reports a short reason of ours, not Google's reply or the URL).
 *
 * Images are cached in `static_maps` by day, under a hash of what they show
 * (the route line and the pins), so they are fetched once per change to a
 * trip and not per view. A fetch that fails leaves the call sheet without a
 * map rather than without a page, and isn't tried again for a minute, so a
 * crew's links can't hammer Google while it is down.
 */

const crypto = require('crypto');
const { nowIso } = require('./db');

const STATIC_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const FETCH_TIMEOUT_MS = 8000;
const RETRY_AFTER_MS = 60 * 1000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/* Bumped when the picture itself changes (size, colours, labelling), so the
   cache doesn't keep serving the old look. */
const RENDER_VERSION = 1;
/* Static Maps takes one GET, whose URL is capped (16,384 characters). A stored
   route can run to 50,000 (days.js), so the line is thinned to this many
   characters of encoded polyline, which after URL-escaping leaves the whole
   request well inside the cap even with 23 pins. */
const MAX_PATH_CHARS = 4500;
const SIZE = '640x360';
const SCALE = 2;
const ROUTE_COLOUR = '0xC0603C';
const PIN_COLOUR = '0x1F1D1B';
const START_PIN_COLOUR = '0xC0603C';

/* ── Encoded polylines (Google's algorithm, 1e5 precision) ────────────────── */

function decodePolyline(str) {
  const points = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b;
    do {
      if (i >= str.length) return null;
      b = str.charCodeAt(i) - 63;
      i += 1;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function encodePolyline(points) {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const put = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of points) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    put(la - pLat);
    put(ln - pLng);
    pLat = la;
    pLng = ln;
  }
  return out;
}

/* Ramer–Douglas–Peucker, iterative (a 20,000-point route would overflow a
   recursive one). Plain degrees: at these sizes the distortion is nothing
   next to a line on a 640px map. */
function simplify(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1;
    let farD = t2;
    const [ay, ax] = points[a];
    const [by, bx] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i += 1) {
      const [py, px] = points[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far !== -1) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * A stored route line cut down to what fits in a Static Maps URL: the same
 * line, with the fewest points that keep its shape, ends kept.
 */
function fitPolyline(encoded, maxChars = MAX_PATH_CHARS) {
  if (typeof encoded !== 'string' || !encoded) return '';
  if (encoded.length <= maxChars) return encoded;
  const points = decodePolyline(encoded);
  if (points.length < 2) return '';
  let tolerance = 0.00005;
  for (let n = 0; n < 24; n += 1) {
    const out = encodePolyline(simplify(points, tolerance));
    if (out.length <= maxChars) return out;
    tolerance *= 1.8;
  }
  return encodePolyline([points[0], points[points.length - 1]]);
}

/* ── What the picture shows ───────────────────────────────────────────────── */

/* A Static Maps pin label is ONE character, A–Z or 0–9. Destinations 1–9 are
   labelled with their number; 10 onwards run on through the alphabet (10 → A,
   23 → N). The call sheet prints the same label beside each stop
   (`mapLabel`), so the pins and the schedule always agree. START (and RETURN,
   which sits on it) is "S". */
function pinLabel(destinationNumber) {
  if (destinationNumber <= 9) return String(destinationNumber);
  return String.fromCharCode(65 + destinationNumber - 10);
}

/**
 * The pins a trip draws, in order: START, then each destination. RETURN has
 * no pin of its own (it is START's place).
 * @returns {Array<{label:string, lat:number, lng:number, start:boolean}>}
 */
function tripPins(trip) {
  const pins = [];
  let n = 0;
  for (const s of (trip && trip.stops) || []) {
    if (s.role === 'return') continue;
    if (s.role === 'start') {
      pins.push({ label: 'S', lat: s.lat, lng: s.lng, start: true });
    } else {
      n += 1;
      pins.push({ label: pinLabel(n), lat: s.lat, lng: s.lng, start: false });
    }
  }
  return pins;
}

function mapDescriptor(trip) {
  return { path: fitPolyline(trip && trip.polyline), pins: tripPins(trip) };
}

/** A hash of everything that changes the picture, and so the cache key. */
function staticMapHash(trip) {
  const d = mapDescriptor(trip);
  const pins = d.pins.map((p) => `${p.label}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
  return crypto.createHash('sha256')
    .update(`v${RENDER_VERSION};${SIZE}@${SCALE};${d.path};${pins}`)
    .digest('hex');
}

/**
 * The Maps Static request for a trip. The key is part of it; the URL is for
 * `fetchStaticMap` and must not be passed on or logged.
 */
function staticMapUrl(trip, key) {
  const d = mapDescriptor(trip);
  const params = [
    ['size', SIZE],
    ['scale', String(SCALE)],
    ['maptype', 'roadmap'],
  ];
  if (d.path) params.push(['path', `color:${ROUTE_COLOUR}|weight:5|enc:${d.path}`]);
  // Destinations first so START, drawn last, is never hidden under a return.
  d.pins.filter((p) => !p.start).forEach((p) => {
    params.push(['markers', `color:${PIN_COLOUR}|label:${p.label}|${p.lat},${p.lng}`]);
  });
  d.pins.filter((p) => p.start).forEach((p) => {
    params.push(['markers', `color:${START_PIN_COLOUR}|label:${p.label}|${p.lat},${p.lng}`]);
  });
  params.push(['key', key]);
  return `${STATIC_URL}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/* ── Fetching and caching ─────────────────────────────────────────────────── */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * One Maps Static request. Resolves a PNG buffer, or null for any failure
 * (no key, a refusal, a timeout, something that isn't a PNG). Nothing about
 * the failure is carried out: not Google's reply and not the URL.
 */
async function fetchStaticMap(trip, { key, fetchImpl }) {
  if (!key) return null;
  try {
    const res = await (fetchImpl || fetch)(staticMapUrl(trip, key), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res || !res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8 || buf.length > MAX_IMAGE_BYTES || !buf.subarray(0, 4).equals(PNG_SIGNATURE)) return null;
    return buf;
  } catch (_) {
    return null;
  }
}

/* Hashes whose fetch failed lately → when to try again. In memory: a restart
   forgetting it costs one extra attempt. */
const failedAt = new Map();

/**
 * A day's route image as a data URI, from the cache when the trip hasn't
 * changed since it was drawn, else fetched and kept. Null when the day has no
 * trip, there is no key, or Google didn't answer.
 *
 * @param {object} day  { id, trip }
 * @param {{key:string, fetchImpl?:function, now?:function}} maps
 */
async function staticMapFor(db, day, maps) {
  const trip = day && day.trip;
  if (!trip || !Array.isArray(trip.stops) || !trip.stops.length) return null;
  const hash = staticMapHash(trip);
  const cached = db.prepare('SELECT hash, png FROM static_maps WHERE day_id = ?').get(day.id);
  if (cached && cached.hash === hash) return dataUri(cached.png);

  // A cached image of an older trip is never shown in place of today's.
  if (!maps || !maps.key) return null;
  const t = Date.now();
  const failed = failedAt.get(hash);
  if (failed && t - failed < RETRY_AFTER_MS) return null;

  const png = await fetchStaticMap(trip, { key: maps.key, fetchImpl: maps.fetchImpl });
  if (!png) {
    failedAt.set(hash, t);
    if (failedAt.size > 500) failedAt.clear();
    return null;
  }
  failedAt.delete(hash);
  const stamp = (maps.now || nowIso)();
  db.prepare(`
    INSERT INTO static_maps (day_id, hash, png, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(day_id) DO UPDATE SET hash = excluded.hash, png = excluded.png, fetched_at = excluded.fetched_at
  `).run(day.id, hash, png, stamp);
  // Days that no longer exist leave their picture behind: sweep them with the
  // write (a handful of rows, so it costs nothing).
  db.prepare('DELETE FROM static_maps WHERE day_id NOT IN (SELECT id FROM production_days)').run();
  return dataUri(png);
}

/* For tests: the one minute's wait after a failed fetch. */
const forgetFailures = () => failedAt.clear();

const dataUri = (png) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;

module.exports = {
  decodePolyline,
  encodePolyline,
  fitPolyline,
  pinLabel,
  tripPins,
  staticMapHash,
  staticMapUrl,
  fetchStaticMap,
  staticMapFor,
  forgetFailures,
  MAX_PATH_CHARS,
};
