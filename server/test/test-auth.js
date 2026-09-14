'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Must be set before config.js is loaded, so the test never touches the real
// .env, the real data directory, or the real billing.db.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-auth-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0'; // the test server speaks plain HTTP
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword, COOKIE_NAME } = require('../src/auth');

const PASSWORD = 'correct-horse-battery-staple';
const USERNAME = 'lachlan';

let server;
let baseUrl;
let db;

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`
    INSERT INTO account (id, username, password_hash, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(USERNAME, await hashPassword(PASSWORD), nowIso(), nowIso());

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function login(username, password) {
  return fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

function cookieFrom(res) {
  const header = res.headers.getSetCookie()[0] || '';
  return header.split(';')[0];
}

test('/health answers without a session', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('a protected route refuses an anonymous caller', async () => {
  const res = await fetch(`${baseUrl}/api/estimates`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'unauthorized');
});

test('the wrong password is rejected, and says nothing about which half was wrong', async () => {
  const res = await login(USERNAME, 'not-the-password');
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'invalid_credentials');
  assert.equal(res.headers.getSetCookie().length, 0);

  const unknownUser = await login('someone-else', PASSWORD);
  assert.equal(unknownUser.status, 401);
  assert.equal((await unknownUser.json()).error, 'invalid_credentials');
});

test('the right password sets a hardened session cookie', async () => {
  const res = await login(USERNAME, PASSWORD);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);

  const setCookie = res.headers.getSetCookie()[0];
  assert.match(setCookie, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);

  // The token itself is never what's stored.
  const stored = db.prepare('SELECT id FROM sessions').all();
  assert.equal(stored.length, 1);
  const token = setCookie.split('=')[1].split(';')[0];
  assert.notEqual(stored[0].id, token);
  assert.equal(stored[0].id.length, 64); // sha256 hex
});

test('a session cookie opens the protected routes', async () => {
  const jar = cookieFrom(await login(USERNAME, PASSWORD));

  const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie: jar } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).username, USERNAME);

  // 404 rather than 401: the gate let this through, there is just no such route.
  const gated = await fetch(`${baseUrl}/api/not-a-real-route`, { headers: { cookie: jar } });
  assert.equal(gated.status, 404);
});

test('a forged or stale cookie is not a session', async () => {
  const res = await fetch(`${baseUrl}/api/session`, {
    headers: { cookie: `${COOKIE_NAME}=made-up-token-value` },
  });
  assert.equal(res.status, 401);
});

test('logging out kills the session on the server, not just in the browser', async () => {
  const jar = cookieFrom(await login(USERNAME, PASSWORD));

  const out = await fetch(`${baseUrl}/api/logout`, { method: 'POST', headers: { cookie: jar } });
  assert.equal(out.status, 200);
  assert.match(out.headers.getSetCookie()[0], /Max-Age=0/i);

  // Replaying the old cookie must not work.
  const replay = await fetch(`${baseUrl}/api/session`, { headers: { cookie: jar } });
  assert.equal(replay.status, 401);
});

test('an expired session is rejected and cleaned up', async () => {
  const jar = cookieFrom(await login(USERNAME, PASSWORD));
  const token = jar.split('=')[1];

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const crypto = require('node:crypto');
  const id = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(token).digest('hex');
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(yesterday, id);

  const res = await fetch(`${baseUrl}/api/session`, { headers: { cookie: jar } });
  assert.equal(res.status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').get(id).n, 0);
});

// Last: this leaves the throttle counter tripped for the test client's address.
test('three failures in a minute slow the next attempt down', async () => {
  for (let i = 0; i < 3; i += 1) {
    const res = await login(USERNAME, 'wrong');
    assert.equal(res.status, 401, `attempt ${i + 1} should still be answered normally`);
  }

  const throttled = await login(USERNAME, 'wrong');
  assert.equal(throttled.status, 429);
  const body = await throttled.json();
  assert.equal(body.error, 'too_many_attempts');
  assert.ok(body.retryAfterMs > 0);
  assert.ok(Number(throttled.headers.get('retry-after')) >= 1);

  // And the throttle applies to the real password too — no bypass by guessing
  // right on the fourth try.
  assert.equal((await login(USERNAME, PASSWORD)).status, 429);
});
