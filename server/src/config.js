'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

/* APP_URL as the emails use it: an absolute http(s) address with one trailing
   slash, or '' when it's unset or unusable (C7). '' is what keeps a link-bearing
   email from going: sends.js fails it with `no_app_url` rather than mailing a
   client a relative link that opens nothing. */
function appUrlOf(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return '';
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.host) return '';
  return raw.replace(/\/*$/, '/');
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

const config = {
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'billing.db'),
  backupDir: path.join(DATA_DIR, 'backups'),
  exportDir: path.join(DATA_DIR, 'exports'),
  port: Number(process.env.PORT || 8080),
  sessionSecret: process.env.SESSION_SECRET || '',
  adminUsername: process.env.ADMIN_USERNAME || 'lachlan',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  trustProxy: bool(process.env.TRUST_PROXY, false),
  cookieSecure: bool(process.env.COOKIE_SECURE, true),
  // 'strict' when the UI is served by this same process (the old plan);
  // 'none' when the UI lives on a different origin (GitHub Pages) and the
  // browser needs to send the cookie cross-site. 'none' requires Secure.
  cookieSameSite: process.env.COOKIE_SAMESITE || 'strict',
  // Comma-separated list of origins allowed to call the API with credentials,
  // e.g. "https://lachlan.github.io". Empty = same-origin only (CORS off).
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // Outgoing email (task 28, D102): plain SMTP, Resend today. `smtp.pass` is
  // the API key; it lives here and in .env only, never in the database, a log
  // or a reply. Email counts as "connected" when the pass and a From address
  // are both set.
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || 'resend',
    pass: process.env.SMTP_PASS || '',
  },
  mailFrom: process.env.MAIL_FROM || '',
  // Replies go here, and so do the owner's notices ("a client signed").
  mailReplyTo: process.env.MAIL_REPLY_TO || '',
  // Where the app and the client pages are served (GitHub Pages), with the
  // trailing slash: emails link to `${appUrl}c/#e/<token>` and
  // `${appUrl}#/projects/<id>`.
  appUrl: appUrlOf(process.env.APP_URL),
  // The call sheet's route images (trip-planner task 9, T1a): the Maps Static
  // key. It stays here and in the one request google.js makes; no reply, log
  // or page ever carries it. Empty = the call sheet simply has no map image.
  googleMapsServerKey: (process.env.GOOGLE_MAPS_SERVER_KEY || '').trim(),
  // The Calendar connection (trip-planner task 12, G1): the OAuth client
  // "LSC Billing — NAS calendar". Like the SMTP key, the secret is read here
  // and sent to Google only. Empty = Settings says Google Calendar isn't set
  // up on the server. The redirect URI must be one the client lists; unset,
  // it is this API's own address as the request reached it.
  googleOAuth: {
    clientId: (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
    redirectUri: (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim(),
  },
  // Hnry, through Zapier's SDK (hnry-invoicing H1): the "client credentials" made in
  // Zapier (Connections → SDK credentials). Like the SMTP key they live here and
  // in .env only, never in the database, a log or a reply. Empty = Hnry is "not
  // set up": nothing is pushed and nothing throws at boot. `timeoutSeconds` is the
  // longest one Hnry call may take before it is treated as failed.
  hnry: {
    clientId: (process.env.ZAPIER_CREDENTIALS_CLIENT_ID || '').trim(),
    clientSecret: (process.env.ZAPIER_CREDENTIALS_CLIENT_SECRET || '').trim(),
    timeoutSeconds: Number(process.env.HNRY_TIMEOUT_SECONDS || 60),
  },
  // Writing bookings to the connected calendar (task 14, G4) is on whenever a
  // calendar is connected. GOOGLE_CALENDAR_WRITE=0 switches it off for a server
  // that shares a real connection with a throwaway database (a dev server on
  // a scratch copy), so a test save can't put events in a real calendar.
  googleCalendarWrite: process.env.GOOGLE_CALENDAR_WRITE !== '0',
  // Where Google's consent sends the browser back to: the app's address
  // (Pages), with the trailing slash. APP_URL unless APP_ORIGIN says otherwise.
  appOrigin: appUrlOf(process.env.APP_ORIGIN) || appUrlOf(process.env.APP_URL),
  isTest: process.env.NODE_ENV === 'test',
};

// The data directory is the whole point of this app — if it can't be created,
// fail at boot rather than half-running and losing writes.
function ensureDataDirs() {
  for (const dir of [config.dataDir, config.backupDir, config.exportDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { config, ensureDataDirs, appUrlOf };
