'use strict';

/**
 * The final invoice in Hnry, and Retry (hnry-invoicing H4), through the real
 * routes with a fake Hnry behind them. What these pin: Hnry's draft adds up to
 * what the app asks the client to pay, to the cent, whatever the extras are;
 * a push that stops part-way continues from where it stopped instead of
 * doubling lines; and nothing goes out that doesn't add up, carries GST, or
 * takes off a deposit Hnry doesn't have.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-hnryfinal-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE, finalInvoiceTotals } = require('../src/calc');
const { createHnry } = require('../src/hnry');
const { fakeHnry } = require('./fake-hnry');

const PASSWORD = 'correct-horse-battery-staple';
const LIMITS = { all: { max: 100000, windowMs: 60000 }, pdf: { max: 100000, windowMs: 60000 }, sign: { max: 100000, windowMs: 60000 } };
let db;
let cookie;
let base;
let app;
const servers = [];

let fake;
const transport = { run: (spec, inputs) => fake.run(spec, inputs) };

async function start(opts) {
  const a = createApp(db, { today: () => '2026-10-04', renderPdf: async () => Buffer.from('%PDF-fake'), publicLimits: LIMITS, ...opts });
  const server = await new Promise((resolve) => { const s = a.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server);
  return { app: a, url: `http://127.0.0.1:${server.address().port}` };
}

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare("INSERT INTO account (id, username, password_hash, created_at, updated_at) VALUES (1, 'lachlan', ?, ?, ?)")
    .run(await hashPassword(PASSWORD), nowIso(), nowIso());
  ({ app, url: base } = await start({ hnry: createHnry({}, transport) }));
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
  await api('/api/pricing/reset', { method: 'POST' });
});
test.beforeEach(() => {
  fake = fakeHnry();
  db.prepare('UPDATE clients SET hnry_client_id = NULL').run();
});
test.after(() => { servers.forEach((s) => s.close()); if (db) db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

function api(pathname, opts = {}) {
  let body = opts.body;
  if (body && /^\/api\/estimates(\/[^/]+)?$/.test(pathname)) body = JSON.stringify({ pricingShape: PRICING_SHAPE, ...JSON.parse(body) });
  return fetch(`${base}${pathname}`, { ...opts, body, headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) } });
}
const json = async (r) => ({ status: r.status, body: await r.json() });
const act = (id, action, body) => api(`/api/projects/${id}/${action}`, { method: 'POST', body: JSON.stringify(body || {}) }).then(json);
const inv = (id, action, body, method) => api(`/api/invoices/${id}${action ? '/' + action : ''}`, {
  method: method || (action ? 'POST' : 'GET'), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}).then(json);
const putInv = (id, body) => inv(id, '', body, 'PUT');
const toHnry = (id) => inv(id, 'hnry');
const idle = () => app.locals.hnryPush.idle();
const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const totalsOf = (r) => JSON.parse(r.totals_json);
const cents = (n) => Math.round(n * 100);

const OT = { name: 'Overtime — per hour', qty: 2, mu: 210, rowId: 'row_ot' }; // $420
const CUSTOM = { name: 'Raw Footage Handover', qty: 1, mu: 98, customBill: true, override: 150 }; // $150

let n = 0;
let savedClientId = null;
async function savedClient() {
  if (!savedClientId) {
    const r = await api('/api/clients', {
      method: 'POST', body: JSON.stringify({ businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' }),
    }).then(json);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    savedClientId = (r.body.client || r.body).id;
  }
  return savedClientId;
}
/* A project accepted as a pair at `pct`%, its deposit pushed, its final still a draft in the app only. */
async function accepted({ pct = 40, rows } = {}) {
  n += 1;
  const res = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Harbour ' + n,
      upid: 'HF-' + n,
      clientId: await savedClient(),
      client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' },
      activeRows: { prod: [{ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8 }], ...(rows || {}) },
    }),
  }).then(json);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const est = res.body.estimate;
  const r = await act(est.projectId, 'accept', { invoicing: 'pair', depositPct: pct });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await idle();
  const all = db.prepare('SELECT * FROM invoices WHERE project_id = ?').all(est.projectId);
  return { est, deposit: all.find((i) => i.kind === 'deposit'), final: all.find((i) => i.kind === 'final') };
}
const draftOf = (r) => fake.invoices.find((d) => d.poNumber === r.number);

/* ── The final, line by line ──────────────────────────────────────────── */

test('the final goes as its balance line, each extra, and a negative "less deposit", adding up to what it bills', async () => {
  const { est, deposit, final } = await accepted({ pct: 40 });
  assert.ok(row(deposit.id).hnry_number, 'the deposit is in Hnry first');
  assert.equal((await putInv(final.id, { extras: [OT, CUSTOM] })).status, 200);

  const r = await toHnry(final.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.hnry.ok, r.body.invoice.hnryNumber], [true, row(final.id).hnry_number]);

  const t = totalsOf(row(final.id));
  const draft = draftOf(final);
  assert.ok(draft, 'a draft carrying the final\'s number');
  assert.deepEqual(draft.items.map((i) => i.description), [
    `Final invoice: ${est.name}`,
    'Overtime — per hour (×2)',
    'Raw Footage Handover',
    `Less deposit (${row(deposit.id).hnry_number})`,
  ]);
  assert.deepEqual(draft.items.map((i) => i.price), [t.job.clientPriceExGst, 420, 150, -t.deposit.totalIncGst]);
  assert.ok(draft.items.every((i) => i.quantity === 1));
  assert.equal(fake.total(draft.id), cents(t.balanceDue), 'Hnry\'s total is the app\'s balance to the cent');

  const after = row(final.id);
  assert.deepEqual([after.hnry_lines_done, !!after.hnry_pushed_at, after.hnry_error], [4, true, null]);
  assert.equal(after.hnry_invoice_id, draft.id);
});

test('a five-figure job with cents everywhere still adds up exactly', async () => {
  const { final } = await accepted({
    pct: 33.3, rows: { prod: [{ name: 'Video Capture', qty: 11, mu: 1120.35, dayUnit: 'full', hoursPerUnit: 8 }] },
  });
  assert.ok(totalsOf(row(final.id)).job.clientPriceExGst > 10000, 'five figures');
  await putInv(final.id, { extras: [{ name: 'Drone day', qty: 3, mu: 333.33 }, { name: 'Travel', qty: 1, mu: 87.65 }] });
  const r = await toHnry(final.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const draft = draftOf(final);
  assert.equal(fake.total(draft.id), cents(totalsOf(row(final.id)).balanceDue));
  assert.equal(draft.items.length, 4);
});

test('with no extras the final is its balance line and the deduction', async () => {
  const { est, final } = await accepted({ pct: 50 });
  assert.equal((await toHnry(final.id)).status, 200);
  const draft = draftOf(final);
  assert.equal(draft.items.length, 2);
  assert.equal(draft.items[0].description, `Final invoice: ${est.name}`);
  assert.match(draft.items[1].description, /^Less deposit \(INV-\d+\)$/);
  assert.equal(fake.total(draft.id), cents(totalsOf(row(final.id)).balanceDue));
});

test('an extra that bills nothing is left out; extras that can\'t be split cleanly go as one "Additional work" line', async () => {
  const { final } = await accepted({ pct: 40 });
  await putInv(final.id, { extras: [OT, { name: 'Courtesy edit', qty: 1, mu: 0 }] });
  assert.equal((await toHnry(final.id)).status, 200);
  const draft = draftOf(final);
  assert.deepEqual(draft.items.map((i) => i.description).slice(1, -1), ['Overtime — per hour (×2)'], 'the $0 line is not sent');
  assert.equal(fake.total(draft.id), cents(totalsOf(row(final.id)).balanceDue));

  // The stored extras figure is $400 though the line prices to $420: the pieces don't add up, so one line carries the stored figure.
  const other = await accepted({ pct: 40 });
  await putInv(other.final.id, { extras: [OT] });
  const r = row(other.final.id);
  const snap = JSON.parse(r.estimate_snapshot_json);
  const odd = finalInvoiceTotals(snap.totals, { clientPriceExGst: 400, gst: 0, totalIncGst: 400 }, totalsOf(other.deposit));
  db.prepare('UPDATE invoices SET totals_json = ? WHERE id = ?').run(JSON.stringify(odd), other.final.id);
  assert.equal((await toHnry(other.final.id)).status, 200);
  const d2 = draftOf(other.final);
  assert.deepEqual(d2.items.map((i) => [i.description, i.price]).slice(1, -1), [['Additional work', 400]]);
  assert.equal(fake.total(d2.id), cents(odd.balanceDue));
});

/* ── Stopping part-way, and continuing ────────────────────────────────── */

test('a push that stops part-way keeps what landed, and Retry adds only the rest', async () => {
  const { final } = await accepted({ pct: 40 });
  await putInv(final.id, { extras: [OT, CUSTOM] });
  fake.fail('addItem', 1, { after: 1, message: 'Zapier error: simulated outage' }); // the 2nd addItem fails once

  const first = await toHnry(final.id);
  assert.deepEqual([first.status, first.body.error], [502, 'zapier_error']);
  const mid = row(final.id);
  assert.deepEqual([!!mid.hnry_invoice_id, mid.hnry_lines_done, mid.hnry_pushed_at, mid.hnry_error], [true, 2, null, 'zapier_error']);
  assert.equal(draftOf(final).items.length, 2, 'the balance line and the first extra landed');

  const creates = () => fake.calls.filter((c) => c.name === 'createInvoice' && c.inputs.poNumber === final.number).length;
  const second = await toHnry(final.id);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const draft = draftOf(final);
  assert.equal(draft.items.length, 4, 'no line doubled');
  assert.equal(creates(), 1, 'no second draft');
  assert.equal(fake.total(draft.id), cents(totalsOf(row(final.id)).balanceDue));
  const done = row(final.id);
  assert.deepEqual([done.hnry_lines_done, !!done.hnry_pushed_at, done.hnry_error], [4, true, null]);
});

test('Retry on an invoice already fully in Hnry changes nothing', async () => {
  const { deposit } = await accepted({ pct: 40 });
  const before = fake.calls.length;
  const r = await toHnry(deposit.id);
  assert.equal(r.status, 200);
  assert.equal(r.body.hnry.already, true);
  assert.equal(fake.calls.length, before);
});

test('Retry makes a deposit that failed at acceptance', async () => {
  fake.fail('findOrCreateClient', 1);
  const { deposit, final } = await accepted({ pct: 40 });
  assert.equal(row(deposit.id).hnry_error, 'zapier_error');
  assert.equal((await toHnry(deposit.id)).status, 200);
  assert.equal(fake.invoices.length, 1);
  assert.equal(row(deposit.id).hnry_error, null);
  assert.equal(row(final.id).hnry_invoice_id, null, 'the final still waits to be asked for');
});

/* ── What must not go out ─────────────────────────────────────────────── */

test('a final won\'t be made until its deposit is in Hnry', async () => {
  fake.fail('findOrCreateClient', 1);
  const { deposit, final } = await accepted({ pct: 40 });
  fake.calls.length = 0;
  const r = await toHnry(final.id);
  assert.deepEqual([r.status, r.body.error], [409, 'deposit_not_in_hnry']);
  assert.match(r.body.message, /deposit/i);
  assert.equal(fake.calls.length, 0, 'nothing reached Hnry');
  assert.equal(row(final.id).hnry_error, 'deposit_not_in_hnry');
  assert.equal((await toHnry(deposit.id)).status, 200);
  assert.equal((await toHnry(final.id)).status, 200, 'with the deposit there, the final goes');
});

test('lines that don\'t add up to what the invoice bills are refused, and nothing is sent', async () => {
  const { final } = await accepted({ pct: 40 });
  const t = totalsOf(row(final.id));
  db.prepare('UPDATE invoices SET totals_json = ? WHERE id = ?').run(JSON.stringify({ ...t, balanceDue: t.balanceDue + 1 }), final.id);
  const before = fake.calls.length;
  const r = await toHnry(final.id);
  assert.deepEqual([r.status, r.body.error], [409, 'amount_mismatch']);
  assert.equal(fake.calls.length, before);
  assert.equal(row(final.id).hnry_invoice_id, null);
});

test('a final carrying GST in any figure is refused', async () => {
  for (const where of ['extras', 'job', 'total']) {
    const { final } = await accepted({ pct: 40 });
    const t = totalsOf(row(final.id));
    t[where] = { ...t[where], gst: 5 };
    db.prepare('UPDATE invoices SET totals_json = ? WHERE id = ?').run(JSON.stringify(t), final.id);
    const before = fake.calls.length;
    const r = await toHnry(final.id);
    assert.deepEqual([r.status, r.body.error], [409, 'gst_registered'], where);
    assert.equal(fake.calls.length, before);
  }
});

test('a final with nothing left to bill (the deposit was 100%) is not pushed as $0', async () => {
  const { final } = await accepted({ pct: 100 });
  assert.equal(totalsOf(row(final.id)).balanceDue, 0);
  const before = fake.calls.length;
  const r = await toHnry(final.id);
  assert.deepEqual([r.status, r.body.error], [409, 'zero_amount']);
  assert.equal(fake.calls.length, before);
});

test('a void or paid invoice, and an unknown one, are refused', async () => {
  const { deposit } = await accepted({ pct: 40 });
  const other = await accepted({ pct: 40 });
  db.prepare("UPDATE invoices SET status = 'void', hnry_invoice_id = NULL, hnry_pushed_at = NULL WHERE id = ?").run(other.final.id);
  let r = await toHnry(other.final.id);
  assert.deepEqual([r.status, r.body.error, r.body.reason], [409, 'hnry_skipped', 'void']);
  db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(other.final.id);
  r = await toHnry(other.final.id);
  assert.deepEqual([r.status, r.body.reason], [409, 'paid']);
  assert.equal((await toHnry('inv_nope')).status, 404);
  void deposit;
});

test('with Hnry not set up the route says so', async () => {
  const off = await start({});
  const login = await fetch(`${off.url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  const c2 = login.headers.getSetCookie()[0].split(';')[0];
  const { final } = await accepted({ pct: 40 });
  const r = await fetch(`${off.url}/api/invoices/${final.id}/hnry`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c2 }, body: '{}' });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'hnry_not_configured');
});

/* ── Once it is in Hnry, the app doesn't change it ───────────────────── */

test('an invoice that is in Hnry can no longer be edited in the app, so the two cannot drift', async () => {
  const { deposit, final } = await accepted({ pct: 40 });
  // The deposit is in Hnry: its % is fixed, and it says so.
  const dep = await putInv(deposit.id, { depositPct: 30 });
  assert.deepEqual([dep.status, dep.body.error], [409, 'in_hnry']);
  assert.equal(row(deposit.id).pct, 40);
  assert.equal((await inv(deposit.id)).body.invoice.depositEditable, false);

  // The final can still take extras until it is made in Hnry, and not after.
  assert.equal((await putInv(final.id, { extras: [OT] })).status, 200);
  assert.equal((await toHnry(final.id)).status, 200);
  const late = await putInv(final.id, { extras: [] });
  assert.deepEqual([late.status, late.body.error], [409, 'in_hnry']);
  assert.equal(JSON.parse(row(final.id).extras_json).additional.length, 1);
  assert.equal(late.body.message, 'This invoice is in Hnry. Change it there, so the two stay the same.');
});
