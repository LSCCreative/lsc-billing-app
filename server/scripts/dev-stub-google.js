'use strict';

/**
 * A development server with a pretend Google (trip-planner task 12): the app
 * as `npm start` runs it, but Connect goes to a local consent page instead of
 * Google's, and every Google request (token, calendar list, revoke, delete)
 * is answered here. For checking Settings → Google Calendar in the browser
 * against a scratch database (launch.json "api-scratch-google") without an
 * OAuth client. The real flow is `api-scratch-mail` with the client in .env.
 *
 *   STUB_GOOGLE_REFRESH_FAIL=1   Google refuses the refresh token (Reconnect).
 *   STUB_GOOGLE_DOWN=1           every Google request fails (unavailable).
 *
 * Never for the NAS.
 */

const { config, ensureDataDirs } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const google = require('../src/google');

ensureDataDirs();

const ACCESS = 'stub-access-token';
const REFRESH = 'stub-refresh-token';
const SCOPE = google.SCOPES.join(' ');
const LIST = [
  { id: 'lachlan@creativelsc.com', summary: 'lachlan@creativelsc.com', primary: true, accessRole: 'owner', backgroundColor: '#9fc6e7' },
  { id: 'crew@group.calendar.google.com', summary: 'Crew bookings', accessRole: 'writer', backgroundColor: '#f83a22' },
  { id: 'jess@lsccreative.studio', summary: 'jess@lsccreative.studio', summaryOverride: 'Jess (editor)', accessRole: 'reader', backgroundColor: '#7bd148' },
  { id: 'alex.martinez.camera.op@example.com', summary: 'Alex Martinez — camera operator, freelance availability', accessRole: 'freeBusyReader', backgroundColor: '#ffad46' },
  { id: 'en.australian#holiday@group.v.calendar.google.com', summary: 'Holidays in Australia', accessRole: 'reader', backgroundColor: '#16a765' },
  { id: 'gear@group.calendar.google.com', summary: 'Gear room', accessRole: 'owner', backgroundColor: '#a47ae2' },
];

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fakeGoogle(url, init = {}) {
  await new Promise((r) => setTimeout(r, 400)); // a believable wait
  if (process.env.STUB_GOOGLE_DOWN === '1') throw new Error('stub: Google is down');
  const u = new URL(url);
  const body = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
  console.log(`[stub-google] ${init.method || 'GET'} ${u.host}${u.pathname}`);
  if (u.pathname === '/token') {
    if (body.get('grant_type') === 'authorization_code') {
      return json(200, { access_token: ACCESS, expires_in: 3599, refresh_token: REFRESH, scope: body.get('code') === 'one-scope' ? google.SCOPES[1] : SCOPE });
    }
    // Any refresh token but ours is refused, so editing the stored one in
    // billing.db (with access_expires_at in the past) shows Reconnect.
    if (process.env.STUB_GOOGLE_REFRESH_FAIL === '1' || body.get('refresh_token') !== REFRESH) return json(400, { error: 'invalid_grant' });
    return json(200, { access_token: ACCESS, expires_in: 3599, scope: SCOPE });
  }
  if (u.pathname === '/revoke') return json(200, {});
  if (u.pathname.endsWith('/users/me/calendarList')) return json(200, { items: LIST });
  if ((init.method || 'GET') === 'DELETE') return new Response(null, { status: 204 });
  return json(404, { error: 'not stubbed' });
}

// Connect goes to the page below instead of accounts.google.com.
google.oauthUrl = ({ redirectUri, state }) =>
  `http://localhost:${config.port}/dev/google-consent?${new URLSearchParams({ redirect_uri: redirectUri, state })}`;

const db = openDatabase(config.dbFile);
const app = createApp(db, {
  appUrl: config.appUrl || 'http://localhost:5173/',
  appOrigin: config.appOrigin || 'http://localhost:5173/',
  googleOAuth: { clientId: 'stub-client', clientSecret: 'stub-secret', redirectUri: '' },
  googleFetch: fakeGoogle,
});

/* The pretend consent screen. */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const consent = (req, res) => {
  const back = String(req.query.redirect_uri || '');
  const state = String(req.query.state || '');
  const go = (q) => `${back}?${new URLSearchParams({ ...q, state })}`;
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Pretend Google consent</title>
<body style="font:16px system-ui;max-width:480px;margin:60px auto;line-height:1.5">
<h1 style="font-size:20px">Pretend Google consent (dev-stub-google)</h1>
<p>“Production Decks” wants to see and edit events on your calendars, and see your list of calendars.</p>
<p><a id="allow" href="${esc(go({ code: 'good-code' }))}">Allow</a> ·
<a id="one-scope" href="${esc(go({ code: 'one-scope' }))}">Allow with one permission unticked</a> ·
<a id="cancel" href="${esc(go({ error: 'access_denied' }))}">Cancel</a></p></body>`);
};
// Express matches in registration order, and createApp ends with fallbacks
// for /api only, so a /dev path added now is still reached.
app.get('/dev/google-consent', consent);

app.listen(config.port, () => console.log(`[stub-google] dev server on :${config.port}; Google is pretend`));
