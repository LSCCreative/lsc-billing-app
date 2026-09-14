'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-ratecard-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { readPricing, readSettings } = require('../src/ratecard');
const { DEFAULT_PRICING, DEFAULT_SETTINGS } = require('../src/defaults');

const PASSWORD = 'correct-horse-battery-staple';
const USERNAME = 'lachlan';

let server;
let baseUrl;
let db;
let cookie;

/* Everything here runs against a database nobody has saved pricing to — the
   state every deployment is in until the Pricing screen is opened for the first
   time. That was the state in which estimates were being stored with their
   labour and travel priced at zero. */
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

  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
});

test.after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function api(pathname, opts = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...opts,
    headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) },
  });
}

test('with no pricing row saved, the rate card is the default, not an empty one', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pricing').get().c, 0);
  assert.deepEqual(readPricing(db), DEFAULT_PRICING);
  assert.deepEqual(readSettings(db), DEFAULT_SETTINGS);
});

/* The regression itself. An empty rate card is not a neutral default:
   computeTotals prices a labour or travel line only if it can find it in
   `pricing.labourSections` / `pricing.travelRows`, so `{}` silently drops every
   one of them and keeps only crew and equipment, which carry their own costs.
   The editor priced against GET /api/pricing (which did return the defaults),
   so the figures on screen and the figures in the database disagreed. */
test('an estimate saved before pricing is configured still bills labour and travel', async () => {
  const created = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      upid: 'LSC-2026-001',
      name: 'Fresh database job',
      activeRows: {
        prod: [{ name: 'Video Capture', qty: 10 }], // 10 x 140 mark-up
        travel: [
          { name: 'Fuel & Tolls', qty: 50 }, // direct cost, billed at cost
          { name: 'Transport & Logistics Hrs', qty: 4 }, // 4 x 35 mark-up
        ],
        crew: [{ role: 'Gaffer', days: 2, cost: 500 }],
        equip: [],
        deliverables: [],
      },
    }),
  }).then((r) => r.json());

  const totals = created.estimate.totals;
  assert.equal(totals.labourTotal, 1400);
  assert.equal(totals.expenseTotal, 1190); // 50 + 140 travel + 1000 crew
  assert.equal(totals.totalIncGst, 2590);
  assert.equal(totals.totalHours, 10);
  // 35% of labour, which is the whole point of having found the rate card.
  assert.equal(totals.taxSetAside, 490);
  assert.equal(totals.estTakeHome, 910);
});
