'use strict';

/**
 * Connecting Google Calendar (.design/trip-planner/ task 12; G1, G2, I3).
 *
 * THE FLOW
 * Settings → Google Calendar → Connect sends the browser (a top-level
 * navigation, so the session cookie goes with it) to GET
 * /api/google/oauth/start, which redirects to Google's consent page with a
 * signed `state`. Google sends the browser back to GET
 * /api/google/oauth/callback?code&state; the NAS checks the state, swaps the
 * code for tokens, reads the calendar list (the primary calendar's id is the
 * account's address), stores the row and redirects to the app's
 * `#/settings/calendar?connected=1`, or `?error=<reason>`.
 *
 * Both are browser navigations, not fetches, so they answer with redirects,
 * never JSON, and are mounted ahead of the API's session gate: a missing
 * session sends the browser back to the app to sign in rather than leaving it
 * on a bare 401 at the API's address.
 *
 * THE STATE
 * `<payload>.<hmac>`: the payload (base64url JSON) holds a random nonce, the
 * time it was made and a fingerprint of the session that asked. The HMAC is
 * keyed by SESSION_SECRET. The callback refuses a state that doesn't verify,
 * is over 10 minutes old, has been used before (nonces are kept in memory
 * until they expire) or belongs to another session. So a code can only be
 * redeemed in the browser that started the flow, and only once.
 *
 * TOKENS NEVER LEAVE THE NAS
 * The refresh and access tokens live in `google_account` (plain, I3). No reply
 * here carries them: status is an allow-list (statusOf), and every error is a
 * short code of ours.
 */

const crypto = require('crypto');
const { config } = require('../config');
const { loadSession } = require('../auth');
const { nowIso } = require('../db');
const google = require('../google');

const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = '/api/google/oauth/callback';
const SETTINGS_HASH = '#/settings/calendar';

/* Nonces of states already redeemed → when they would have expired anyway. */
const usedNonces = new Map();

function sweepNonces(now) {
  for (const [nonce, until] of usedNonces) if (until <= now) usedNonces.delete(nonce);
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => b64(crypto.createHmac('sha256', config.sessionSecret).update(`google-oauth:${payload}`).digest());
const sessionMark = (session) => b64(crypto.createHash('sha256').update(`google-oauth:${session.id}`).digest()).slice(0, 22);

function makeState(session, now) {
  const payload = b64(JSON.stringify({ n: b64(crypto.randomBytes(16)), t: now, s: sessionMark(session) }));
  return `${payload}.${sign(payload)}`;
}

/** The state's payload when it is genuine, fresh, unused and this session's; else null. */
function checkState(state, session, now) {
  if (typeof state !== 'string' || state.length > 512) return null;
  const dot = state.indexOf('.');
  if (dot < 1) return null;
  const payload = state.slice(0, dot);
  const given = Buffer.from(state.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!data || typeof data.n !== 'string' || typeof data.t !== 'number') return null;
  if (now - data.t > STATE_TTL_MS || data.t - now > 60 * 1000) return null;
  if (!session || data.s !== sessionMark(session)) return null;
  sweepNonces(now);
  if (usedNonces.has(data.n)) return null;
  usedNonces.set(data.n, data.t + STATE_TTL_MS);
  return data;
}

function redirectUriOf(req, oauth) {
  return oauth.redirectUri || `${req.protocol}://${req.get('host')}${CALLBACK_PATH}`;
}

/**
 * GET /api/google/status, the Settings section's one read. An allow-list:
 * no token, no expiry, nothing Google said beyond the address and the list.
 */
function statusOf(db, oauth) {
  const row = google.readAccount(db);
  const counts = db.prepare(`
    SELECT SUM(state = 'pending') AS pending, SUM(state = 'error') AS errors FROM google_event_sync
  `).get();
  if (!row) {
    return { configured: google.configured(oauth), connected: false, email: '', connectedAt: null, calendars: [], problem: null, sync: { pending: 0, errors: 0 } };
  }
  return {
    configured: google.configured(oauth),
    connected: true,
    email: row.email,
    connectedAt: row.connected_at,
    calendars: google.storedCalendars(row).map((c) => ({
      id: c.id, summary: c.summary, colour: c.colour, primary: c.primary === true, role: c.role, on: c.on === true,
    })),
    // 'reconnect' once Google has refused the stored token (google.js).
    problem: google.needsReconnect() ? 'reconnect' : null,
    sync: { pending: counts.pending || 0, errors: counts.errors || 0 },
  };
}

/* A GoogleError as a reply. Never Google's own words. */
function googleFailure(res, err) {
  if (!(err instanceof google.GoogleError)) throw err;
  if (err.code === 'not_connected') return res.status(409).json({ error: 'google_not_connected' });
  if (err.code === 'reconnect') return res.status(409).json({ error: 'google_reconnect' });
  if (err.code === 'not_configured') return res.status(409).json({ error: 'google_not_configured' });
  return res.status(502).json({ error: 'google_unavailable' });
}

/**
 * The two browser navigations, mounted BEFORE the session gate (app.js).
 * opts: { oauth: {clientId, clientSecret, redirectUri, fetchImpl, now}, appOrigin }
 */
function registerGoogleOAuthRoutes(app, db, opts) {
  const oauth = opts.oauth;
  const appOrigin = opts.appOrigin;
  const now = () => (oauth.now || Date.now)();

  function back(res, query) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!appOrigin) {
      // Nowhere to send the browser: say so in words rather than strand it on JSON.
      res.status(500).type('text/plain').send('The server has no APP_URL, so it can’t send you back to the app. Set APP_URL (or APP_ORIGIN) and restart it.');
      return;
    }
    res.redirect(302, `${appOrigin}${SETTINGS_HASH}?${query}`);
  }

  app.get('/api/google/oauth/start', (req, res) => {
    const session = loadSession(db, req);
    if (!session) return back(res, 'error=signed_out');
    if (!google.configured(oauth)) return back(res, 'error=not_configured');
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, google.oauthUrl({
      clientId: oauth.clientId,
      redirectUri: redirectUriOf(req, oauth),
      state: makeState(session, now()),
    }));
  });

  app.get(CALLBACK_PATH, async (req, res, next) => {
    try {
      const session = loadSession(db, req);
      if (!session) return back(res, 'error=signed_out');
      // The state first: an error reply with a forged state is just as forged.
      if (!checkState(req.query.state, session, now())) return back(res, 'error=oauth_failed');
      if (req.query.error) return back(res, req.query.error === 'access_denied' ? 'error=access_denied' : 'error=oauth_failed');
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code || code.length > 2048) return back(res, 'error=oauth_failed');
      if (!google.configured(oauth)) return back(res, 'error=not_configured');

      let tokens;
      let items;
      try {
        tokens = await google.exchangeCode(oauth, { code, redirectUri: redirectUriOf(req, oauth) });
        // Consent lets a person untick a permission; both are needed (G1).
        if (!google.hasScopes(tokens.scopes)) return back(res, 'error=scopes');
        if (!tokens.refreshToken) return back(res, 'error=oauth_failed');
        items = await google.listCalendarsWith(oauth, tokens.accessToken);
      } catch (err) {
        if (!(err instanceof google.GoogleError)) throw err;
        return back(res, 'error=oauth_failed');
      }

      const email = google.accountEmail(items);
      const previous = google.readAccount(db);
      const sameAccount = Boolean(previous && previous.email && previous.email === email);
      const calendars = google.calendarsFrom(items, sameAccount ? google.storedCalendars(previous) : null);
      db.transaction(() => {
        // Another account's events aren't this one's to edit: forget them.
        if (previous && !sameAccount) db.prepare('DELETE FROM google_event_sync').run();
        db.prepare(`
          INSERT INTO google_account (id, email, refresh_token, access_token, access_expires_at, calendars_json, connected_at)
          VALUES (1, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token,
            access_token = excluded.access_token, access_expires_at = excluded.access_expires_at,
            calendars_json = excluded.calendars_json, connected_at = excluded.connected_at
        `).run(email, tokens.refreshToken, tokens.accessToken, tokens.expiresAt, JSON.stringify(calendars),
          sameAccount ? previous.connected_at : nowIso());
      })();
      google.forgetReconnect();
      return back(res, 'connected=1');
    } catch (err) {
      return next(err);
    }
  });
}

/** The section's API, mounted after the session gate. */
function registerGoogleRoutes(app, db, opts) {
  const oauth = opts.oauth;

  app.get('/api/google/status', (_req, res) => {
    res.json(statusOf(db, oauth));
  });

  /* PUT /api/google/calendars { on: [calendarId…] } — the calendars shown
     (G2). Ids not in the list are ignored; the list itself only changes on a
     refresh. Answers with the whole list. */
  app.put('/api/google/calendars', (req, res) => {
    const on = req.body && req.body.on;
    if (!Array.isArray(on) || on.length > 500 || !on.every((id) => typeof id === 'string' && id.length <= 300)) {
      return res.status(400).json({ error: 'calendars_invalid' });
    }
    const row = google.readAccount(db);
    if (!row) return res.status(409).json({ error: 'google_not_connected' });
    const wanted = new Set(on);
    const calendars = google.storedCalendars(row).map((c) => ({ ...c, on: wanted.has(c.id) }));
    db.prepare('UPDATE google_account SET calendars_json = ? WHERE id = 1').run(JSON.stringify(calendars));
    res.json({ calendars: statusOf(db, oauth).calendars });
  });

  /* POST /api/google/calendars/refresh — the list again from Google (a
     calendar shared since connecting), each toggle kept. */
  app.post('/api/google/calendars/refresh', async (_req, res, next) => {
    try {
      await google.refreshCalendars(db, oauth);
      res.json(statusOf(db, oauth));
    } catch (err) {
      try {
        googleFailure(res, err);
      } catch (other) {
        next(other);
      }
    }
  });

  /* POST /api/google/disconnect { removeEvents } — optionally deletes the
     app's events from the primary calendar (the ones google_event_sync knows),
     revokes the grant, and forgets the account. Disconnecting always happens
     locally, even when Google can't be reached; the reply says what Google
     did. Events that couldn't be removed keep their rows, so connecting the
     same account again can still find them. */
  app.post('/api/google/disconnect', async (req, res, next) => {
    try {
      const row = google.readAccount(db);
      if (!row) return res.json({ disconnected: true, revoked: false, removed: 0, notRemoved: 0 });
      const removeEvents = req.body && req.body.removeEvents === true;
      let removed = 0;
      let notRemoved = 0;
      if (removeEvents) {
        const synced = db.prepare('SELECT day_id, event_id FROM google_event_sync WHERE event_id IS NOT NULL').all();
        for (const [i, s] of synced.entries()) {
          try {
            await google.calendarApi(db, oauth, 'DELETE', `/calendars/primary/events/${encodeURIComponent(s.event_id)}`);
            removed += 1;
          } catch (err) {
            if (!(err instanceof google.GoogleError)) throw err;
            // Already gone from Google is as good as removed.
            if (err.status === 404 || err.status === 410) {
              removed += 1;
            } else if (err.code === 'reconnect' || err.code === 'not_configured') {
              // No token to delete with: none of the rest will go either.
              notRemoved += synced.length - i;
              break;
            } else {
              notRemoved += 1;
              continue;
            }
          }
          db.prepare('DELETE FROM google_event_sync WHERE day_id = ?').run(s.day_id);
        }
      }
      const revoked = await google.revokeToken(oauth, row.refresh_token);
      db.prepare('DELETE FROM google_account WHERE id = 1').run();
      google.forgetReconnect();
      res.json({ disconnected: true, revoked, removed, notRemoved });
    } catch (err) {
      next(err);
    }
  });
}

/* For tests: forget redeemed states. */
const forgetStates = () => usedNonces.clear();

module.exports = { registerGoogleOAuthRoutes, registerGoogleRoutes, makeState, checkState, statusOf, forgetStates };
