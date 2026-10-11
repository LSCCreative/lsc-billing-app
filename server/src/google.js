'use strict';

/**
 * The server's side of Google (trip-planner): the call sheet's route image,
 * from Maps Static (task 9, T1a, T12), and the Calendar connection (task 12
 * on, G1; at the end of the file).
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

/* ══ Google Calendar (trip-planner task 12; G1, I3) ══════════════════════════
 *
 * The NAS holds the one connection: Connect runs Google's OAuth web flow once
 * (routes/google.js), and the refresh token it leaves is kept in
 * `google_account` (plain, I3). Everything below takes that row's tokens and
 * makes the requests; no token is ever returned from here to a route, a reply
 * or a log. Errors carry a short code of ours (GoogleError), never Google's
 * reply body, which can echo a token back.
 */

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const SCOPE_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const SCOPES = [SCOPE_EVENTS, SCOPE_LIST];
const API_TIMEOUT_MS = 10000;
/* An access token is renewed this long before Google says it ends, so one
   never runs out between the check and the request. */
const ACCESS_MARGIN_MS = 60 * 1000;
/* Google's list can't sensibly run past this; a cap keeps a looping
   nextPageToken from spinning forever. */
const MAX_LIST_PAGES = 10;

/**
 * `code` is ours: 'not_connected' (no account row), 'reconnect' (Google no
 * longer accepts the refresh token: revoked, the password changed, or the
 * client was deleted), 'unavailable' (Google didn't answer, or answered with
 * a server error), 'refused' (a 4xx other than the above), 'scopes' (consent
 * left a permission unticked), 'not_configured' (no client id/secret).
 */
class GoogleError extends Error {
  constructor(code, status) {
    super(`google: ${code}`);
    this.code = code;
    this.status = status || null;
  }
}

/* The last time Google refused the refresh token. In memory: the status reply
   says "reconnect" until a token is issued again, and a restart forgets it
   until the next request finds out again (one failed call). */
let reconnectNeeded = false;
const needsReconnect = () => reconnectNeeded;

function configured(oauth) {
  return Boolean(oauth && oauth.clientId && oauth.clientSecret);
}

/** Google's consent page for `state`. Offline + consent so a refresh token always comes back. */
function oauthUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `${OAUTH_AUTH_URL}?${q.toString()}`;
}

/* One request to Google: a timeout, JSON back, and our own error codes. A
   reply body is read for its `error` field only (invalid_grant), never kept. */
async function call(fetchImpl, url, init) {
  let res;
  try {
    res = await (fetchImpl || fetch)(url, { ...init, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  } catch (_) {
    throw new GoogleError('unavailable');
  }
  let body = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = null;
  }
  if (res.ok) return body || {};
  const reason = body && (typeof body.error === 'string' ? body.error : body.error && body.error.status);
  if (reason === 'invalid_grant' || reason === 'unauthorized_client' || reason === 'invalid_client') {
    throw new GoogleError('reconnect', res.status);
  }
  if (res.status === 401) throw new GoogleError('unauthorized', 401);
  if (res.status >= 500 || res.status === 429) throw new GoogleError('unavailable', res.status);
  throw new GoogleError('refused', res.status);
}

const form = (fields) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

const expiryOf = (seconds, now) => new Date(now + Math.max(0, Number(seconds) || 0) * 1000).toISOString();

/**
 * Swaps the consent's one-time code for tokens.
 * @returns {{accessToken, refreshToken, expiresAt, scopes:string[]}}
 */
async function exchangeCode(oauth, { code, redirectUri }) {
  const now = (oauth.now || Date.now)();
  const body = await call(oauth.fetchImpl, OAUTH_TOKEN_URL, form({
    code,
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }));
  if (!body.access_token) throw new GoogleError('refused');
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : '',
    expiresAt: expiryOf(body.expires_in, now),
    scopes: String(body.scope || '').split(/\s+/).filter(Boolean),
  };
}

const hasScopes = (granted) => SCOPES.every((s) => granted.includes(s));

/** Best effort: a token Google has already forgotten is gone either way. */
async function revokeToken(oauth, token) {
  if (!token) return false;
  try {
    await call(oauth.fetchImpl, OAUTH_REVOKE_URL, form({ token }));
    return true;
  } catch (_) {
    return false;
  }
}

function readAccount(db) {
  return db.prepare('SELECT * FROM google_account WHERE id = 1').get() || null;
}

/**
 * A live access token for the stored account, renewed from the refresh token
 * when it is near its end. `force` renews regardless (after a 401).
 */
async function accessToken(db, oauth, { force = false } = {}) {
  const row = readAccount(db);
  if (!row) throw new GoogleError('not_connected');
  const now = (oauth.now || Date.now)();
  if (!force && row.access_token && row.access_expires_at &&
      Date.parse(row.access_expires_at) - ACCESS_MARGIN_MS > now) {
    return row.access_token;
  }
  if (!configured(oauth)) throw new GoogleError('not_configured');
  let body;
  try {
    body = await call(oauth.fetchImpl, OAUTH_TOKEN_URL, form({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }));
  } catch (err) {
    // Only Google refusing the grant itself (invalid_grant and kin, which
    // call() turns into 'reconnect') means reconnect. Any other 4xx (a rate
    // limit, a malformed request) is a refusal of this one try: the sync
    // engine backs off and tries again, and Settings doesn't ask for a
    // reconnect the grant doesn't need (task 16).
    if (err.code === 'reconnect') reconnectNeeded = true;
    throw err;
  }
  if (!body.access_token) throw new GoogleError('unavailable');
  reconnectNeeded = false;
  const token = String(body.access_token);
  db.prepare('UPDATE google_account SET access_token = ?, access_expires_at = ? WHERE id = 1')
    .run(token, expiryOf(body.expires_in, now));
  return token;
}

/**
 * A Calendar API request as the stored account. A 401 renews the token once
 * and tries again (Google can end one early).
 */
async function calendarApi(db, oauth, method, path, body) {
  const send = (token) => call(oauth.fetchImpl, CALENDAR_API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    return await send(await accessToken(db, oauth));
  } catch (err) {
    if (err.code !== 'unauthorized') throw err;
    try {
      return await send(await accessToken(db, oauth, { force: true }));
    } catch (again) {
      if (again.code === 'unauthorized') {
        reconnectNeeded = true;
        throw new GoogleError('reconnect', 401);
      }
      throw again;
    }
  }
}

/* The raw calendar list, every page, with a given access token (the callback
   has one before there is an account row to read it from). */
async function listCalendarsWith(oauth, token) {
  const items = [];
  let pageToken = '';
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const q = new URLSearchParams({ maxResults: '250', showHidden: 'false' });
    if (pageToken) q.set('pageToken', pageToken);
    const body = await call(oauth.fetchImpl, `${CALENDAR_API}/users/me/calendarList?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (Array.isArray(body.items)) items.push(...body.items);
    pageToken = body.nextPageToken || '';
    if (!pageToken) break;
  }
  return items;
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const ROLE_RANK = { owner: 1, writer: 2, reader: 3, freeBusyReader: 4 };

/**
 * The toggle list (G2) from Google's calendar list: primary first, then the
 * user's own, then everyone else's, each alphabetically. `previous` keeps the
 * user's choices across a refresh or a reconnect; a calendar new to the list
 * starts off, except the primary the first time (IA flow 7: "primary on").
 *
 * A free/busy-only calendar is listed (it is "a calendar shown in my
 * Calendar") but can only show busy blocks, so it says so.
 *
 * @returns {Array<{id, summary, colour, primary, role, on}>}
 */
function calendarsFrom(items, previous) {
  const before = new Map((previous || []).map((c) => [c.id, c.on]));
  const firstTime = !(previous && previous.length);
  const list = (items || [])
    .filter((c) => c && typeof c.id === 'string' && c.id && !c.deleted)
    .map((c) => {
      const primary = c.primary === true;
      return {
        id: c.id.slice(0, 300),
        summary: String(c.summaryOverride || c.summary || c.id).slice(0, 200),
        colour: HEX_COLOUR.test(c.backgroundColor || '') ? c.backgroundColor.toLowerCase() : null,
        primary,
        role: ROLE_RANK[c.accessRole] ? c.accessRole : 'reader',
        on: before.has(c.id) ? before.get(c.id) === true : (primary && firstTime),
      };
    });
  const rank = (c) => (c.primary ? 0 : c.role === 'owner' ? 1 : 2);
  list.sort((a, b) => rank(a) - rank(b) || a.summary.localeCompare(b.summary, 'en', { sensitivity: 'base' }));
  return list;
}

/** The primary calendar's id is the account's address (no extra scope needed for it). */
const accountEmail = (items) => {
  const primary = (items || []).find((c) => c && c.primary === true);
  return primary && typeof primary.id === 'string' ? primary.id : '';
};

function storedCalendars(row) {
  try {
    const list = JSON.parse((row && row.calendars_json) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

/** Fetches the list again as the stored account, keeping each calendar's toggle. */
async function refreshCalendars(db, oauth) {
  const token = await accessToken(db, oauth);
  let items;
  try {
    items = await listCalendarsWith(oauth, token);
  } catch (err) {
    if (err.code !== 'unauthorized') throw err;
    items = await listCalendarsWith(oauth, await accessToken(db, oauth, { force: true }));
  }
  const row = readAccount(db);
  if (!row) throw new GoogleError('not_connected');
  const calendars = calendarsFrom(items, storedCalendars(row));
  db.prepare('UPDATE google_account SET calendars_json = ? WHERE id = 1').run(JSON.stringify(calendars));
  return calendars;
}

/** For tests. */
const forgetReconnect = () => { reconnectNeeded = false; };

/* ══ Google events on the app's calendar (task 13; G2, G3) ════════════════════
 *
 * GET /api/calendar?google=1 asks for the events of every switched-on calendar
 * in the range on show. They are shown, never stored: each calendar's events
 * for a range are kept in memory for five minutes (the brief's "cached about 5
 * minutes"), so paging back and forth between months doesn't ask Google again,
 * and Refresh (Calendars ▾) asks regardless. The key holds the account's
 * address, so another account connecting never sees the last one's events.
 *
 * The app's own events (tagged lscDayId, G4) are left out: the app already
 * draws those days. So are cancelled ones, ones the owner declined, and
 * Google's "working location" markers (an all-day "Home" on every weekday is
 * not a commitment).
 *
 * Times become Sydney wall-clock dates and HH:MM, the shape the app's own days
 * have, so the browser does no time-zone arithmetic and a laptop set to
 * another zone still draws a 9am shoot at 9am.
 */

const EVENTS_TTL_MS = 5 * 60 * 1000;
const MAX_EVENT_PAGES = 4; // 1,000 events per calendar per range is plenty for six weeks
const MAX_CACHED = 300;
const ZONE = 'Australia/Sydney';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_FIELDS = 'items(id,status,summary,start,end,eventType,extendedProperties(private),attendees(self,responseStatus)),nextPageToken';

const eventCache = new Map(); // `${email}\n${calendarId}\n${from}\n${to}` → { at, events }

const sydneyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** An RFC 3339 time as Sydney's date and HH:MM, or null. */
function sydneyParts(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const p = Object.fromEntries(sydneyFormat.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

function shiftDate(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * One Google event as the calendar draws it, or null for one it doesn't.
 * `date`..`endDate` are the Sydney dates it covers, inclusive (Google's
 * all-day end is exclusive; a timed event ending at midnight ends the day
 * before). An untitled event on a busy-times-only calendar is "Busy", which
 * is all Google tells anyone about it.
 */
function eventFrom(item, cal) {
  if (!item || typeof item.id !== 'string' || item.status === 'cancelled') return null;
  if (item.eventType === 'workingLocation') return null;
  const priv = item.extendedProperties && item.extendedProperties.private;
  if (priv && priv.lscDayId) return null;
  if (Array.isArray(item.attendees) && item.attendees.some((a) => a && a.self && a.responseStatus === 'declined')) return null;
  const s = item.start || {};
  const e = item.end || {};
  let date;
  let endDate;
  let startTime = null;
  let endTime = null;
  let allDay;
  if (YMD.test(s.date || '')) {
    allDay = true;
    date = s.date;
    endDate = YMD.test(e.date || '') && e.date > s.date ? shiftDate(e.date, -1) : s.date;
  } else if (s.dateTime) {
    const a = sydneyParts(s.dateTime);
    const b = e.dateTime ? sydneyParts(e.dateTime) : a;
    if (!a || !b) return null;
    allDay = false;
    date = a.date;
    startTime = a.time;
    endTime = b.time;
    endDate = b.date > a.date && b.time === '00:00' ? shiftDate(b.date, -1) : b.date;
    if (endDate < date) endDate = date;
  } else {
    return null;
  }
  const summary = typeof item.summary === 'string' ? item.summary.trim().slice(0, 200) : '';
  return {
    // An invitation sits in each calendar it's on under the same id: the pair is unique.
    id: crypto.createHash('sha1').update(`${cal.id}\n${item.id}`).digest('hex').slice(0, 16),
    calendarId: cal.id,
    title: summary || (cal.role === 'freeBusyReader' ? 'Busy' : '(No title)'),
    date,
    endDate,
    startTime,
    endTime,
    allDay,
  };
}

/* Every page of one calendar's events in a margin round the range (Sydney is
   ahead of UTC by 10 or 11 hours); eventFrom's dates then decide what's in. */
async function listEvents(db, oauth, calendarId, from, to) {
  const items = [];
  let pageToken = '';
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const q = new URLSearchParams({
      timeMin: `${shiftDate(from, -1)}T00:00:00Z`,
      timeMax: `${shiftDate(to, 1)}T00:00:00Z`,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      timeZone: ZONE,
      fields: EVENT_FIELDS,
    });
    if (pageToken) q.set('pageToken', pageToken);
    // eslint-disable-next-line no-await-in-loop
    const body = await calendarApi(db, oauth, 'GET', `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    if (Array.isArray(body.items)) items.push(...body.items);
    pageToken = body.nextPageToken || '';
    if (!pageToken) break;
  }
  return items;
}

const order = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
  Number(b.allDay) - Number(a.allDay) ||
  String(a.startTime || '').localeCompare(String(b.startTime || '')) ||
  a.title.localeCompare(b.title);

/**
 * The switched-on calendars' events overlapping from..to (dates, inclusive).
 *
 * @returns {{ state: 'off'|'ok'|'unavailable'|'reconnect',
 *   events: Array<{id, calendarId, calendar, colour, title, date, endDate, startTime, endTime, allDay}>,
 *   calendars: Array<{id, summary, colour, primary, role, on}>,
 *   missing: string[] }}  `missing` names calendars that failed while others didn't.
 */
async function calendarEvents(db, oauth, { from, to, refresh = false }) {
  const row = readAccount(db);
  if (!row) return { state: 'off', events: [], calendars: [], missing: [] };
  const all = storedCalendars(row).map((c) => ({
    id: c.id, summary: c.summary, colour: c.colour, primary: c.primary === true, role: c.role, on: c.on === true,
  }));
  const on = all.filter((c) => c.on);
  const result = (state, events, missing) => ({ state, events, calendars: all, missing });
  if (!on.length) return result('ok', [], []);

  const now = (oauth.now || Date.now)();
  for (const [k, v] of eventCache) if (now - v.at >= EVENTS_TTL_MS) eventCache.delete(k);
  const keyOf = (cal) => `${row.email}\n${cal.id}\n${from}\n${to}`;
  const stale = on.filter((cal) => refresh || !eventCache.has(keyOf(cal)));

  const failed = new Map(); // calendar id → GoogleError code
  if (stale.length) {
    // One renewal up front, not one per calendar racing each other.
    try {
      await accessToken(db, oauth);
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err;
      return result(err.code === 'reconnect' ? 'reconnect' : 'unavailable', [], []);
    }
    await Promise.all(stale.map(async (cal) => {
      try {
        const events = (await listEvents(db, oauth, cal.id, from, to))
          .map((item) => eventFrom(item, cal))
          .filter((ev) => ev && ev.date <= to && ev.endDate >= from);
        eventCache.set(keyOf(cal), { at: now, events });
      } catch (err) {
        if (!(err instanceof GoogleError)) throw err;
        failed.set(cal.id, err.code);
      }
    }));
    if (eventCache.size > MAX_CACHED) eventCache.clear();
  }

  if (failed.size === on.length) {
    return result([...failed.values()].includes('reconnect') ? 'reconnect' : 'unavailable', [], []);
  }
  const events = [];
  for (const cal of on) {
    const hit = eventCache.get(keyOf(cal));
    if (!hit || failed.has(cal.id)) continue;
    hit.events.forEach((ev) => events.push({ ...ev, calendar: cal.summary, colour: cal.colour }));
  }
  events.sort(order);
  return result('ok', events, on.filter((c) => failed.has(c.id)).map((c) => c.summary));
}

/** For tests, and after a disconnect. */
const forgetEvents = () => eventCache.clear();

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
  // Calendar (task 12)
  GoogleError,
  SCOPES,
  configured,
  oauthUrl,
  exchangeCode,
  hasScopes,
  revokeToken,
  readAccount,
  accessToken,
  calendarApi,
  listCalendarsWith,
  calendarsFrom,
  accountEmail,
  storedCalendars,
  refreshCalendars,
  needsReconnect,
  forgetReconnect,
  // Events on the calendar (task 13)
  ZONE,
  shiftDate,
  sydneyParts,
  eventFrom,
  calendarEvents,
  forgetEvents,
};
