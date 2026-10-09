'use strict';

/**
 * Editor autosave on the server (.design/trip-planner/ task 7, IA "Estimate
 * writes (autosave)"). `baseUpdatedAt` refuses a write over a newer one
 * (every PUT); `X-LSC-Autosave: 1` is refused on anything but a draft. The
 * snapshot throttle (I2) is in test-backup.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-autosave-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'https://lsccreative.github.io';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE } = require('../src/calc');

const PASSWORD = 'correct-horse-battery-staple';

let server;
let baseUrl;
let db;
let cookie;

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`
    INSERT INTO account (id, username, password_hash, created_at, updated_at)
    VALUES (1, 'lachlan', ?, ?, ?)
  `).run(await hashPassword(PASSWORD), nowIso(), nowIso());
  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
});

test.after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

let counter = 0;
async function create() {
  counter += 1;
  const res = await fetch(`${baseUrl}/api/estimates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ pricingShape: PRICING_SHAPE, name: `Autosave job ${counter}`, client: { businessName: 'Acme' } }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).estimate;
}
async function put(id, body, headers = {}) {
  const res = await fetch(`${baseUrl}/api/estimates/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie, ...headers },
    body: JSON.stringify({ pricingShape: PRICING_SHAPE, client: { businessName: 'Acme' }, ...body }),
  });
  return { status: res.status, body: await res.json() };
}
const AUTOSAVE = { 'X-LSC-Autosave': '1', 'X-LSC-Session': 'mount-1' };
const nameOf = (id) => db.prepare('SELECT name FROM estimates WHERE id = ?').get(id).name;

test('a write based on the latest updatedAt saves and returns the new one', async () => {
  const est = await create();
  const first = await put(est.id, { name: 'Tab A', baseUpdatedAt: est.updatedAt }, AUTOSAVE);
  assert.equal(first.status, 200);
  assert.equal(first.body.estimate.name, 'Tab A');
  assert.ok(first.body.estimate.updatedAt, 'the reply carries the base for the next write');

  const second = await put(est.id, { name: 'Tab A again', baseUpdatedAt: first.body.estimate.updatedAt }, AUTOSAVE);
  assert.equal(second.status, 200);
  assert.equal(nameOf(est.id), 'Tab A again');
});

test('a write over a newer one is refused with estimate_changed_elsewhere and changes nothing', async () => {
  const est = await create();
  // Tab B saves first; tab A still holds the original updatedAt.
  const b = await put(est.id, { name: 'Tab B', baseUpdatedAt: est.updatedAt }, AUTOSAVE);
  assert.equal(b.status, 200);

  const a = await put(est.id, { name: 'Tab A', baseUpdatedAt: est.updatedAt }, AUTOSAVE);
  assert.equal(a.status, 409);
  assert.equal(a.body.error, 'estimate_changed_elsewhere');
  assert.equal(a.body.updatedAt, b.body.estimate.updatedAt, 'it says what the latest is');
  assert.equal(nameOf(est.id), 'Tab B', "tab B's save stands");

  // Not only autosaves: an explicit Save with a stale base is refused too.
  const manual = await put(est.id, { name: 'Tab A by Save', baseUpdatedAt: est.updatedAt });
  assert.equal(manual.status, 409);
  assert.equal(manual.body.error, 'estimate_changed_elsewhere');
  assert.equal(nameOf(est.id), 'Tab B');
});

test('a write with no baseUpdatedAt behaves as before (older clients)', async () => {
  const est = await create();
  await put(est.id, { name: 'Moved on', baseUpdatedAt: est.updatedAt });
  const old = await put(est.id, { name: 'Old client' });
  assert.equal(old.status, 200);
  const nulled = await put(est.id, { name: 'Null base', baseUpdatedAt: null });
  assert.equal(nulled.status, 200);
  assert.equal(nameOf(est.id), 'Null base');
});

test('an autosave is refused on a sent, accepted or declined estimate; Save still works', async () => {
  for (const status of ['sent', 'accepted', 'declined']) {
    const est = await create();
    db.prepare('UPDATE estimates SET status = ? WHERE id = ?').run(status, est.id);

    const auto = await put(est.id, { name: 'Autosaved', baseUpdatedAt: est.updatedAt }, AUTOSAVE);
    assert.equal(auto.status, 409, status);
    assert.equal(auto.body.error, 'autosave_not_draft', status);
    assert.equal(nameOf(est.id), `Autosave job ${counter}`, `${status}: nothing saved`);

    // The draft-only refusal comes first, even when the base is stale too,
    // so the editor switches to Save rather than asking for a reload.
    const staleAuto = await put(est.id, { name: 'Autosaved', baseUpdatedAt: 'stale' }, AUTOSAVE);
    assert.equal(staleAuto.body.error, 'autosave_not_draft', status);

    const manual = await put(est.id, { name: 'Saved by hand', baseUpdatedAt: est.updatedAt });
    assert.equal(manual.status, 200, `${status}: the explicit Save is unchanged`);
    assert.equal(nameOf(est.id), 'Saved by hand');
  }
});

test('the CORS preflight lets the editor send the autosave headers', async () => {
  const res = await fetch(`${baseUrl}/api/estimates/est_x`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://lsccreative.github.io',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'content-type,x-lsc-autosave,x-lsc-session',
    },
  });
  assert.equal(res.status, 204);
  const allowed = res.headers.get('access-control-allow-headers').toLowerCase().split(/\s*,\s*/);
  for (const h of ['content-type', 'x-lsc-autosave', 'x-lsc-session']) assert.ok(allowed.includes(h), h);
});
