'use strict';

const crypto = require('crypto');
const cookie = require('cookie');
const argon2 = require('@node-rs/argon2');
const { config } = require('./config');
const { nowIso } = require('./db');

const COOKIE_NAME = 'lsc_sid';
const SESSION_DAYS = 30;
// The session row's last_seen_at is only rewritten this often, so a burst of
// requests doesn't turn every read into a write.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

// Argon2id, tuned for a NAS-class CPU: ~19 MiB and 2 passes is the OWASP
// baseline and lands well under a second on a Core i3.
const ARGON_OPTS = {
  algorithm: argon2.Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function hashPassword(plain) {
  return argon2.hash(plain, ARGON_OPTS);
}

async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch (_) {
    // A malformed or truncated hash is a failed login, not a crash.
    return false;
  }
}

/**
 * Tokens are random; only their HMAC is written to the database. A copy of
 * billing.db therefore contains no usable session, and the secret living in the
 * environment rather than the file means rotating it logs everyone out.
 */
function hashToken(token) {
  return crypto.createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

function readCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  try {
    return cookie.parse(header)[COOKIE_NAME] || null;
  } catch (_) {
    return null;
  }
}

function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    // 'strict' when the UI is same-origin; 'none' when it's served from
    // GitHub Pages and the browser needs to send the cookie cross-site
    // (requires secure:true, which is on by default).
    sameSite: config.cookieSameSite,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

// ── Login throttling ─────────────────────────────────────────────────────────
// In memory, per client address. A single-account app on a private network does
// not need this in the database; a restart clearing the counters is acceptable
// and the alternative writes to disk on every failed guess.
const attempts = new Map();
const WINDOW_MS = 60 * 1000;
const FREE_ATTEMPTS = 3;
const MAX_DELAY_MS = 60 * 1000;

function clientKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** @returns {number} milliseconds the caller must wait, 0 if they may proceed. */
function throttleCheck(key) {
  const record = attempts.get(key);
  if (!record) return 0;

  const age = Date.now() - record.last;
  if (record.count < FREE_ATTEMPTS) {
    // A clean minute forgives a couple of fat-fingered attempts entirely.
    if (age > WINDOW_MS) attempts.delete(key);
    return 0;
  }

  // From the third failure on, each further attempt has to wait longer: 2s, 4s,
  // 8s … capped at a minute. Enough to make guessing pointless, short enough
  // that mistyping a password three times isn't a lockout.
  const delay = Math.min(2000 * 2 ** (record.count - FREE_ATTEMPTS), MAX_DELAY_MS);
  return Math.max(0, delay - age);
}

function recordFailure(key) {
  sweepAttempts();
  const record = attempts.get(key) || { count: 0, last: 0 };
  if (Date.now() - record.last > WINDOW_MS && record.count < FREE_ATTEMPTS) record.count = 0;
  record.count += 1;
  record.last = Date.now();
  attempts.set(key, record);
}

/** Drops records nobody has touched in an hour so the map can't grow forever. */
function sweepAttempts() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, record] of attempts) {
    if (record.last < cutoff) attempts.delete(key);
  }
}

function clearFailures(key) {
  attempts.delete(key);
}

// ── Session store ────────────────────────────────────────────────────────────
function createSession(db, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO sessions (id, created_at, expires_at, last_seen_at, user_agent, ip)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    hashToken(token),
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
    String(req.headers['user-agent'] || '').slice(0, 255),
    clientKey(req)
  );

  return { token, expiresAt: expires };
}

function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

function purgeExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}

/**
 * Resolves the session cookie to a live session row, or null. Expired rows are
 * deleted on sight rather than left to accumulate.
 */
function loadSession(db, req) {
  const token = readCookie(req);
  if (!token) return null;

  const id = hashToken(token);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }

  if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), id);
  }

  return { id, token, row };
}

/**
 * Gate for every route except /health and /api/login. Returns JSON 401 rather
 * than redirecting, so the client's fetch wrapper can tell "session expired"
 * from "server unreachable" and show the login screen instead of the
 * connection-lost banner.
 */
function requireAuth(db) {
  return function (req, res, next) {
    const session = loadSession(db, req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.session = session;
    next();
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────
function registerAuthRoutes(app, db) {
  app.post('/api/login', async (req, res, next) => {
    try {
      const key = clientKey(req);
      const wait = throttleCheck(key);
      if (wait > 0) {
        res.set('Retry-After', String(Math.ceil(wait / 1000)));
        res.status(429).json({ error: 'too_many_attempts', retryAfterMs: wait });
        return;
      }

      const username = String((req.body && req.body.username) || '').trim();
      const password = String((req.body && req.body.password) || '');

      const account = db.prepare('SELECT * FROM account WHERE id = 1').get();
      if (!account) {
        res.status(503).json({ error: 'no_account', message: 'No account has been seeded yet. Run: npm run seed' });
        return;
      }

      // Verify the password even when the username is wrong, so both failures
      // take the same time and look identical from outside.
      const userOk = username.toLowerCase() === account.username.toLowerCase();
      const passOk = await verifyPassword(account.password_hash, password);

      if (!userOk || !passOk) {
        recordFailure(key);
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }

      clearFailures(key);
      purgeExpiredSessions(db);

      const { token, expiresAt } = createSession(db, req);
      res.setHeader('Set-Cookie', cookie.serialize(
        COOKIE_NAME, token, cookieOptions(SESSION_DAYS * 24 * 60 * 60)
      ));
      res.json({ ok: true, username: account.username, expiresAt: expiresAt.toISOString() });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/logout', (req, res) => {
    destroySession(db, readCookie(req));
    res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', cookieOptions(0)));
    res.json({ ok: true });
  });

  // Lets the UI decide between the login screen and the estimates list on load
  // without firing a request that would 401 into the connection banner.
  app.get('/api/session', (req, res) => {
    const session = loadSession(db, req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const account = db.prepare('SELECT username FROM account WHERE id = 1').get();
    res.json({
      ok: true,
      username: account ? account.username : null,
      expiresAt: session.row.expires_at,
    });
  });
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  requireAuth,
  registerAuthRoutes,
  purgeExpiredSessions,
  loadSession,
  destroySession,
};
