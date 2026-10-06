'use strict';

/**
 * The login's own details, and getting back in without the password
 * (.design/account-recovery/).
 *
 * Before the session gate (registerRecoveryRoutes):
 *   POST /api/password/forgot        { login }  username or email; emails a one-time link
 *   GET  /api/password/reset/:token  is the link still good? { username, expiresAt }
 *   POST /api/password/reset         { token, password }  sets it, signs every session out
 *
 * Behind it (registerAccountRoutes):
 *   GET  /api/account                { username, email }
 *   PUT  /api/account                { currentPassword, username, email, newPassword? }
 *
 * "Forgot password" answers the same whether or not the login matched, and
 * sends after replying, so neither the words nor the timing say whether a
 * username exists. The link is `${APP_URL}#/reset/<token>`: in the hash, so it
 * never reaches GitHub Pages' logs or a Referer header. Only the token's HMAC
 * is stored (auth.js hashToken), and a link works once, for RESET_MINUTES.
 */

const crypto = require('crypto');
const {
  hashPassword, verifyPassword, hashToken, clientKey,
  throttleCheck, recordFailure, clearFailures,
} = require('../auth');
const { isEmail, passwordResetEmail } = require('../mail');
const { readSettings } = require('../ratecard');
const { nowIso } = require('../db');

const RESET_MINUTES = 30;
const MIN_PASSWORD = 12; // the seed script's rule (scripts/seed-account.js)
const MAX_PASSWORD = 256;

// "Forgot password" per address: FORGOT_MAX asks in FORGOT_WINDOW_MS. In
// memory, like login throttling (auth.js): a restart forgetting it is fine.
const FORGOT_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_MAX = 5;
// However many addresses ask, one email a minute at most: the inbox can't be
// flooded through this.
const SEND_GAP_MS = 60 * 1000;

const lower = (v) => String(v || '').trim().toLowerCase();

function refuse(res, status, error, message) {
  return res.status(status).json({ error, message });
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  return '';
}

function usernameProblem(username) {
  if (username.length < 2 || username.length > 64) return 'A username needs 2 to 64 characters.';
  if (username.includes('@')) return 'A username can’t contain @, so it can’t be mistaken for an email address.';
  return '';
}

/** The live reset row a token names, or null when it's unknown, used or expired. */
function liveReset(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const row = db.prepare('SELECT * FROM password_resets WHERE id = ?').get(hashToken(token));
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

const LINK_GONE = 'This reset link has expired or has already been used. Ask for a new one.';

function registerRecoveryRoutes(app, db, { mailer, appUrl }) {
  const asks = new Map(); // address -> timestamps of recent asks
  let lastSentAt = 0;

  function overLimit(key) {
    const now = Date.now();
    const recent = (asks.get(key) || []).filter((t) => now - t < FORGOT_WINDOW_MS);
    if (recent.length >= FORGOT_MAX) {
      asks.set(key, recent);
      return FORGOT_WINDOW_MS - (now - recent[0]);
    }
    recent.push(now);
    asks.set(key, recent);
    // Drop addresses nobody has used lately, so the map can't grow forever.
    if (asks.size > 500) {
      for (const [k, times] of asks) if (!times.some((t) => now - t < FORGOT_WINDOW_MS)) asks.delete(k);
    }
    return 0;
  }

  app.post('/api/password/forgot', (req, res) => {
    const wait = overLimit(clientKey(req));
    if (wait > 0) {
      res.set('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: wait });
    }
    // Server state, not the account's: saying so gives nothing away.
    if (!mailer.configured || !appUrl) {
      return refuse(res, 503, 'email_not_configured',
        'This server can’t send email yet, so a reset link can’t be sent. Reset the password on the server instead.');
    }
    const login = lower((req.body || {}).login);
    if (!login) return refuse(res, 400, 'missing_login', 'Enter your username or email address.');

    const account = db.prepare('SELECT * FROM account WHERE id = 1').get();
    const matches = account &&
      (login === lower(account.username) || (account.email && login === lower(account.email)));

    res.json({ ok: true });

    if (!matches) return;
    if (!isEmail(account.email)) {
      console.log('[password] a reset was asked for, but the account has no email address to send it to');
      return;
    }
    if (Date.now() - lastSentAt < SEND_GAP_MS) return;
    lastSentAt = Date.now();

    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    // Only the newest link works: asking again retires the one before it.
    db.transaction(() => {
      db.prepare('DELETE FROM password_resets WHERE used_at IS NULL OR expires_at <= ?').run(now.toISOString());
      db.prepare('INSERT INTO password_resets (id, created_at, expires_at, ip) VALUES (?, ?, ?, ?)').run(
        hashToken(token), now.toISOString(),
        new Date(now.getTime() + RESET_MINUTES * 60 * 1000).toISOString(),
        clientKey(req)
      );
    })();

    const settings = readSettings(db);
    const mail = passwordResetEmail({
      username: account.username,
      link: `${appUrl}#/reset/${token}`,
      minutes: RESET_MINUTES,
      businessName: (settings.business || {}).name,
    });
    const sending = mailer.send({ to: account.email, ...mail })
      .then(() => console.log('[password] reset link sent'))
      .catch((err) => console.error('[password] the reset email failed:', err.message));
    // For the tests, which have to wait for a send the reply didn't.
    app.locals.lastResetSend = sending;
  });

  app.get('/api/password/reset/:token', (req, res) => {
    const row = liveReset(db, req.params.token);
    if (!row) return refuse(res, 410, 'reset_link_invalid', LINK_GONE);
    const account = db.prepare('SELECT username FROM account WHERE id = 1').get();
    res.json({ ok: true, username: account ? account.username : '', expiresAt: row.expires_at });
  });

  app.post('/api/password/reset', async (req, res, next) => {
    try {
      const { token, password } = req.body || {};
      if (!liveReset(db, token)) return refuse(res, 410, 'reset_link_invalid', LINK_GONE);
      const problem = passwordProblem(password);
      if (problem) return refuse(res, 400, 'weak_password', problem);

      const hash = await hashPassword(password);
      // Checked again inside the write: two tabs submitting the same link
      // can't both use it.
      const done = db.transaction(() => {
        const row = liveReset(db, token);
        if (!row) return false;
        db.prepare('UPDATE account SET password_hash = ?, updated_at = ? WHERE id = 1').run(hash, nowIso());
        db.prepare('DELETE FROM password_resets WHERE id != ?').run(row.id);
        db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
        // Whoever was signed in with the old password isn't any more.
        db.prepare('DELETE FROM sessions').run();
        return true;
      })();
      if (!done) return refuse(res, 410, 'reset_link_invalid', LINK_GONE);

      clearFailures(clientKey(req));
      const account = db.prepare('SELECT username FROM account WHERE id = 1').get();
      console.log('[password] reset through an emailed link');
      res.json({ ok: true, username: account ? account.username : '' });
    } catch (err) {
      next(err);
    }
  });
}

function registerAccountRoutes(app, db) {
  const shown = (a) => ({ ok: true, username: a.username, email: a.email || '' });

  app.get('/api/account', (_req, res) => {
    const account = db.prepare('SELECT username, email FROM account WHERE id = 1').get();
    if (!account) return refuse(res, 404, 'not_found', 'There is no account.');
    res.json(shown(account));
  });

  /* Every change asks for the current password: the email decides where a
     reset link goes, so changing it is as good as changing the password. A
     wrong one is 403, never 401, which the app reads as "signed out". */
  app.put('/api/account', async (req, res, next) => {
    try {
      const key = clientKey(req);
      const wait = throttleCheck(key);
      if (wait > 0) {
        res.set('Retry-After', String(Math.ceil(wait / 1000)));
        return res.status(429).json({ error: 'too_many_attempts', retryAfterMs: wait });
      }

      const body = req.body || {};
      const account = db.prepare('SELECT * FROM account WHERE id = 1').get();
      if (!account) return refuse(res, 404, 'not_found', 'There is no account.');

      const username = body.username === undefined ? account.username : String(body.username).trim();
      const email = body.email === undefined ? (account.email || '') : String(body.email).trim();
      const newPassword = body.newPassword ? String(body.newPassword) : '';

      const fields = {};
      const uProblem = usernameProblem(username);
      if (uProblem) fields.username = uProblem;
      if (email && !isEmail(email)) fields.email = 'That doesn’t look like an email address.';
      if (newPassword) {
        const pProblem = passwordProblem(newPassword);
        if (pProblem) fields.newPassword = pProblem;
      }
      if (Object.keys(fields).length) {
        return res.status(400).json({ error: 'invalid_account', message: Object.values(fields)[0], fields });
      }

      if (!(await verifyPassword(account.password_hash, String(body.currentPassword || '')))) {
        recordFailure(key);
        return res.status(403).json({
          error: 'wrong_password',
          message: 'Your current password isn’t right.',
          fields: { currentPassword: 'Your current password isn’t right.' },
        });
      }
      clearFailures(key);

      const hash = newPassword ? await hashPassword(newPassword) : account.password_hash;
      let signedOut = 0;
      db.transaction(() => {
        db.prepare('UPDATE account SET username = ?, email = ?, password_hash = ?, updated_at = ? WHERE id = 1')
          .run(username, email, hash, nowIso());
        if (newPassword) {
          // A new password signs out every other browser, and retires any
          // reset link that was waiting.
          signedOut = db.prepare('DELETE FROM sessions WHERE id != ?').run(req.session.id).changes;
          db.prepare('DELETE FROM password_resets').run();
        }
        if (lower(email) !== lower(account.email)) db.prepare('DELETE FROM password_resets').run();
      })();

      const saved = db.prepare('SELECT username, email FROM account WHERE id = 1').get();
      res.json({ ...shown(saved), passwordChanged: Boolean(newPassword), signedOutOthers: signedOut });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerRecoveryRoutes, registerAccountRoutes, RESET_MINUTES, MIN_PASSWORD };
