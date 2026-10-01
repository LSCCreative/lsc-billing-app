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
const { PRICING_SHAPE, SURCHARGE_DEFAULTS } = require('../src/calc');
const { pricingProblem } = require('../src/routes/pricing');

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

/* Every estimate write and rate-card save here comes from a current client,
   as the web build's all do, so it carries calc.js's PRICING_SHAPE (a card
   carries it since task 6a). `bare: true` sends the body as given, for the
   tests of what the route does with a write that doesn't. */
const SHAPED_WRITE = /^\/api\/(estimates(\/[^/]+)?|pricing)$/;
function api(pathname, { bare, ...opts } = {}) {
  let body = opts.body;
  if (!bare && body && SHAPED_WRITE.test(pathname) && (opts.method === 'POST' || opts.method === 'PUT')) {
    body = JSON.stringify({ pricingShape: PRICING_SHAPE, ...JSON.parse(body) });
  }
  return fetch(`${baseUrl}${pathname}`, {
    ...opts,
    body,
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
          { name: 'Tolls & Parking', qty: 50 }, // direct cost, billed at cost (was Fuel & Tolls)
          // The owner's own time, auto-priced since task 6a: a bare line on it
          // has no price on the server (no income floor there), so it bills
          // nothing. The web editor always sends a snapshot instead.
          { name: 'Transport & Logistics Hrs', qty: 4 },
        ],
        crew: [{ role: 'Gaffer', days: 2, cost: 500 }],
        equip: [],
        deliverables: [],
      },
    }),
  }).then((r) => r.json());

  const totals = created.estimate.totals;
  assert.equal(totals.labourTotal, 1400);
  assert.equal(totals.expenseTotal, 1050); // 50 tolls + 1000 crew; transport unpriced
  assert.equal(totals.totalIncGst, 2450);
  // Labour's 10. The transport line's 4 don't count: an unpriced line counts
  // no hours either, never hours at $0 (calc.js lineDef).
  assert.equal(totals.totalHours, 10);
  // 35% of income, which is labour — the whole point of having found the rate
  // card. (Task 5 made transport $140 of it, 539 set aside; before that, $40
  // and 504. Task 6a made its price auto, which only the browser resolves.)
  assert.equal(totals.taxSetAside, 490);
  assert.equal(totals.estTakeHome, 910);
});

/* production-booking task 4: Overtime has moved out of Production into a new
   "Additional work" section (D14), because `prod` is the one section on set
   (D24) and Overtime is never surcharged. The card also carries calc.js's
   surcharge defaults, as the Rate Card's Surcharges block shows them. */
test('the default card keeps Overtime in Additional work, off set, with the surcharge defaults', async () => {
  const ids = DEFAULT_PRICING.labourSections.map((s) => s.id);
  assert.deepEqual(ids, ['preprod', 'prod', 'post', 'additional']);
  const byId = (id) => DEFAULT_PRICING.labourSections.find((s) => s.id === id);
  assert.equal(byId('additional').label, 'Additional work');
  assert.deepEqual(byId('additional').rows.map((r) => r.name), ['Overtime — per hour']);
  assert.ok(!byId('prod').rows.some((r) => /Overtime/.test(r.name)), 'Overtime is not a production item');

  // The calc.js constant, not a second copy, and not the same object.
  assert.deepEqual(DEFAULT_PRICING.surcharges, SURCHARGE_DEFAULTS);
  assert.notEqual(DEFAULT_PRICING.surcharges, SURCHARGE_DEFAULTS);
  assert.notEqual(DEFAULT_PRICING.surcharges.workingWeekdays, SURCHARGE_DEFAULTS.workingWeekdays);

  // The route accepts the card it hands out, and Reset Defaults returns it.
  assert.equal(pricingProblem(DEFAULT_PRICING), null);
  const reset = await api('/api/pricing/reset', { method: 'POST' }).then((r) => r.json());
  assert.deepEqual(reset.pricing, DEFAULT_PRICING);
  db.prepare('DELETE FROM pricing').run();
});
