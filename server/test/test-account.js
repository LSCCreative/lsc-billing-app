'use strict';

/* Account details and "forgot password" (.design/account-recovery/). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-account-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer, passwordResetEmail } = require('../src/mail');
const { hashPassword } = require('../src/auth');

const PASSWORD = 'correct-horse-battery-staple';
const EMAIL = 'owner@example.com';
const APP_URL = 'https://example.github.io/billing/';

let server;
let baseUrl;
let db;
let app;
const sent = [];

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`INSERT INTO account (id, username, password_hash, email, created_at, updated_at)
              VALUES (1, 'lachlan', ?, ?, ?, ?)`).run(await hashPassword(PASSWORD), EMAIL, nowIso(), nowIso());
  const transport = { async sendMail(m) { sent.push(m); return { messageId: '<t>' }; } };
  app = createApp(db, { mailer: createMailer({ mailFrom: 'billing@example.com' }, { transport }), appUrl: APP_URL });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const call = (method, url, body, cookie) => fetch(baseUrl + url, {
  method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const cookieOf = (res) => (res.headers.getSetCookie()[0] || '').split(';')[0];
async function signIn(username, password) {
  const res = await call('POST', '/api/login', { username, password });
  assert.equal(res.status, 200, `sign in as ${username}`);
  return cookieOf(res);
}
const tokenFrom = (mail) => /#\/reset\/([A-Za-z0-9_-]+)/.exec(mail.text)[1];
/* Each "forgot" test starts clean: no rate limits left from the last one. */
function fresh() {
  sent.length = 0;
  db.prepare('DELETE FROM password_resets').run();
}

test('the email signs in as well as the username, in any case', async () => {
  await signIn('LACHLAN', PASSWORD);
  await signIn('Owner@Example.com', PASSWORD);
});

test('the reset email names the account, the time limit and the link', () => {
  const mail = passwordResetEmail({ username: 'lachlan', link: APP_URL + '#/reset/abc', minutes: 30 });
  assert.match(mail.subject, /Reset your billing app password/);
  assert.match(mail.text, /“lachlan”/);
  assert.match(mail.text, /30 minutes/);
  assert.ok(mail.html.includes(APP_URL + '#/reset/abc'));
});

test('forgot, then reset: one email, one use, every session signed out', async () => {
  fresh();
  const before = await signIn('lachlan', PASSWORD);

  const ask = await call('POST', '/api/password/forgot', { login: 'lachlan' });
  assert.equal(ask.status, 200);
  assert.deepEqual(await ask.json(), { ok: true });
  await app.locals.lastResetSend;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, EMAIL);
  assert.ok(sent[0].text.includes(APP_URL + '#/reset/'));

  const token = tokenFrom(sent[0]);
  const stored = db.prepare('SELECT id FROM password_resets').all();
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].id, token, 'only the HMAC is stored');

  const check = await call('GET', `/api/password/reset/${token}`);
  assert.equal(check.status, 200);
  assert.equal((await check.json()).username, 'lachlan');

  const short = await call('POST', '/api/password/reset', { token, password: 'short' });
  assert.equal(short.status, 400);
  assert.equal((await short.json()).error, 'weak_password');

  const NEW = 'a-brand-new-password-42';
  const done = await call('POST', '/api/password/reset', { token, password: NEW });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).username, 'lachlan');

  assert.equal((await call('GET', '/api/session', undefined, before)).status, 401, 'the old session is gone');
  assert.equal((await call('POST', '/api/login', { username: 'lachlan', password: PASSWORD })).status, 401);
  await signIn('lachlan', NEW);

  const again = await call('POST', '/api/password/reset', { token, password: 'yet-another-password-1' });
  assert.equal(again.status, 410, 'a link works once');
  assert.equal((await call('GET', `/api/password/reset/${token}`)).status, 410);

  // Put the password back for the tests after this one.
  db.prepare('UPDATE account SET password_hash = ? WHERE id = 1').run(await hashPassword(PASSWORD));
});

test('forgot answers the same for a login that doesn’t exist, and sends nothing', async () => {
  fresh();
  const res = await call('POST', '/api/password/forgot', { login: 'nobody' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0);
});

test('an expired link is refused', async () => {
  fresh();
  const { hashToken } = require('../src/auth');
  db.prepare('INSERT INTO password_resets (id, created_at, expires_at) VALUES (?, ?, ?)')
    .run(hashToken('expired-token-expired-token'), nowIso(), new Date(Date.now() - 1000).toISOString());
  const res = await call('POST', '/api/password/reset', { token: 'expired-token-expired-token', password: 'long-enough-password' });
  assert.equal(res.status, 410);
  assert.equal((await res.json()).error, 'reset_link_invalid');
});

test('account details: read, change with the current password, refuse without it', async () => {
  const cookie = await signIn('lachlan', PASSWORD);
  const other = await signIn('lachlan', PASSWORD);

  const read = await call('GET', '/api/account', undefined, cookie);
  assert.deepEqual(await read.json(), { ok: true, username: 'lachlan', email: EMAIL });
  assert.equal((await call('GET', '/api/account')).status, 401, 'behind the session gate');

  const wrong = await call('PUT', '/api/account', { currentPassword: 'nope', email: 'x@example.com' }, cookie);
  assert.equal(wrong.status, 403, '403, so the app doesn’t read it as signed out');
  assert.equal((await wrong.json()).error, 'wrong_password');

  const bad = await call('PUT', '/api/account', { currentPassword: PASSWORD, username: 'a@b', email: 'not-an-email' }, cookie);
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.ok(badBody.fields.username && badBody.fields.email);

  const NEW = 'another-long-password-7';
  const ok = await call('PUT', '/api/account', {
    currentPassword: PASSWORD, username: 'Lachlan', email: 'new@example.com', newPassword: NEW,
  }, cookie);
  assert.equal(ok.status, 200);
  const saved = await ok.json();
  assert.deepEqual([saved.username, saved.email, saved.passwordChanged, saved.signedOutOthers],
    ['Lachlan', 'new@example.com', true, 2 /* `other` and the session from the last test */]);
  assert.equal((await call('GET', '/api/session', undefined, cookie)).status, 200, 'this browser stays signed in');
  assert.equal((await call('GET', '/api/session', undefined, other)).status, 401, 'other browsers are signed out');
  await signIn('new@example.com', NEW);
});

test('forgot is refused plainly when the server can’t send email', async () => {
  const bare = createApp(db, { mailer: createMailer({}), appUrl: APP_URL });
  const s = await new Promise((resolve) => { const l = bare.listen(0, '127.0.0.1', () => resolve(l)); });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/password/forgot`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'Lachlan' }),
  });
  s.close();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'email_not_configured');
});
