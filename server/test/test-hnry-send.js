'use strict';

/**
 * An invoice in Hnry is sent from Hnry (hnry-invoicing H5): the app refuses to
 * email, schedule, link or print it, and records that you sent it from Hnry
 * through Mark sent. Invoices the app sent itself before Hnry keep working.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-hnrysend-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE } = require('../src/calc');
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
/* The status of a route that answers with a PDF (the body is not JSON). */
const rawStatus = (id, action) => api(`/api/invoices/${id}/${action}`, { method: 'POST', body: '{}' }).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), text: r.status === 200 ? '' : await r.text() }));
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

/* ── The app doesn't send an invoice that lives in Hnry ──────────────── */

test('an invoice in Hnry is not emailed, linked, scheduled or printed by the app', async () => {
  const { deposit } = await accepted({ pct: 40 });
  assert.ok(row(deposit.id).hnry_invoice_id);
  const sendsBefore = db.prepare('SELECT COUNT(*) AS n FROM sends').get().n;
  for (const body of [{ by: 'link', dueAt: '2026-12-01' }, { by: 'email', to: 'priya@salt.example', dueAt: '2026-12-01' },
    { by: 'email', to: 'priya@salt.example', scheduledFor: '2027-01-01T09:00:00.000Z', dueAt: '2027-02-01' }]) {
    const r = await inv(deposit.id, 'send', body);
    assert.deepEqual([r.status, r.body.error], [409, 'sent_from_hnry'], JSON.stringify(body));
    assert.match(r.body.message, /Hnry/);
  }
  const after = row(deposit.id);
  assert.deepEqual([after.status, after.public_token, after.issued_at, after.due_at], ['draft', null, null, null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sends').get().n, sendsBefore, 'nothing queued');

  const pdf = await rawStatus(deposit.id, 'pdf');
  assert.equal(pdf.status, 409);
  assert.equal(JSON.parse(pdf.text).error, 'sent_from_hnry');
  const cb = await rawStatus(deposit.id, 'cost-breakdown');
  assert.notEqual(cb.status, 409, 'the owner-only Cost Breakdown is not Hnry\'s to make');
});

test('Mark sent records that the user sent it from Hnry: the invoice, the project stage and Outstanding follow', async () => {
  const { est, deposit } = await accepted({ pct: 40 });
  const r = await inv(deposit.id, 'sent', { issuedAt: '2026-10-22', dueAt: '2026-11-11' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.invoice.status, r.body.invoice.issuedAt, r.body.invoice.dueAt], ['sent', '2026-10-22', '2026-11-11']);
  assert.equal(r.body.invoice.hnryNumber, row(deposit.id).hnry_number);

  const act1 = db.prepare("SELECT detail_json FROM activity WHERE project_id = ? AND kind = 'invoice_sent'").get(est.projectId);
  assert.deepEqual(
    [JSON.parse(act1.detail_json).by, JSON.parse(act1.detail_json).hnryNumber, JSON.parse(act1.detail_json).number],
    ['hnry', row(deposit.id).hnry_number, deposit.number],
  );
  assert.equal(r.body.project.stage, 'invoiced', 'the project reads invoiced once the deposit has gone out');
  const outstanding = await api('/api/invoices?state=outstanding&limit=50').then(json);
  assert.ok(outstanding.body.invoices.some((i) => i.id === deposit.id), 'it shows on the Dashboard as outstanding');

  // Again: nothing changes. Then paid, by bank: the dates it went out with are kept.
  const again = await inv(deposit.id, 'sent', { issuedAt: '2026-10-25', dueAt: '2026-11-20' });
  assert.deepEqual([again.status, again.body.already], [200, true]);
  assert.equal(row(deposit.id).issued_at, '2026-10-22');
  const paid = await inv(deposit.id, 'paid', { paidAt: '2026-10-22', via: 'bank' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.deepEqual([row(deposit.id).status, row(deposit.id).paid_via, row(deposit.id).issued_at], ['paid', 'bank', '2026-10-22']);
});

test('Mark sent needs real dates, and the whole invoice to be in Hnry', async () => {
  const { deposit, final } = await accepted({ pct: 40 });
  for (const [body, code] of [[{}, 'issued_at_invalid'], [{ issuedAt: 'x', dueAt: '2026-11-11' }, 'issued_at_invalid'],
    [{ issuedAt: '2026-10-22' }, 'due_at_invalid'], [{ issuedAt: '2026-10-22', dueAt: '2026-10-01' }, 'due_at_invalid']]) {
    const r = await inv(deposit.id, 'sent', body);
    assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body));
  }
  assert.equal(row(deposit.id).status, 'draft');

  // A final that stopped part-way is not one to mark sent.
  fake.fail('addItem', 1, { after: 0 });
  assert.equal((await inv(final.id, 'hnry')).status, 502);
  assert.ok(row(final.id).hnry_invoice_id && !row(final.id).hnry_pushed_at);
  const r = await inv(final.id, 'sent', { issuedAt: '2026-10-22', dueAt: '2026-11-11' });
  assert.deepEqual([r.status, r.body.error], [409, 'hnry_incomplete']);
  assert.equal(row(final.id).status, 'draft');
});

/* ── Production: Mark sent is for Hnry invoices only ─────────────────── */

test('where the test-only Mark sent route is off, only an invoice in Hnry can be marked sent', async () => {
  const prod = await start({ hnry: createHnry({}, transport), markSentRoutes: false });
  const login = await fetch(`${prod.url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  const c2 = login.headers.getSetCookie()[0].split(';')[0];
  const post = (id, action, body) => fetch(`${prod.url}/api/invoices/${id}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: c2 }, body: JSON.stringify(body || {}),
  });

  fake.fail('findOrCreateClient', 1);
  const { deposit } = await accepted({ pct: 40 }); // Hnry failed at acceptance: not in Hnry yet
  assert.equal(row(deposit.id).hnry_invoice_id, null);
  const refused = await post(deposit.id, 'sent', { issuedAt: '2026-10-22', dueAt: '2026-11-11' });
  assert.equal(refused.status, 404, 'no Mark sent for an invoice the app sends itself');
  assert.equal(row(deposit.id).status, 'draft');

  assert.equal((await post(deposit.id, 'hnry')).status, 200, 'now it is in Hnry');
  const ok = await post(deposit.id, 'sent', { issuedAt: '2026-10-22', dueAt: '2026-11-11' });
  assert.equal(ok.status, 200);
  assert.equal(row(deposit.id).status, 'sent');
});

/* ── Invoices the app sent before Hnry keep working ──────────────────── */

test('an invoice the app already sent keeps its link, page and sending; it is never made again in Hnry', async () => {
  fake.fail('findOrCreateClient', 1);
  const { deposit } = await accepted({ pct: 40 }); // not in Hnry
  const sent = await inv(deposit.id, 'send', { by: 'link', dueAt: '2026-12-01' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const sentRow = row(deposit.id);
  assert.equal(sentRow.status, 'sent');
  assert.ok(sentRow.public_token, 'the app made its link');

  const page = await fetch(`${base}/public/invoices/${sentRow.public_token}`).then(json);
  assert.equal(page.status, 200, 'the client\'s page still opens');
  assert.equal(page.body.invoice.number, deposit.number);

  // Hnry is not asked to make a second copy of an invoice the client already has.
  const before = fake.calls.length;
  const r = await inv(deposit.id, 'hnry');
  assert.deepEqual([r.status, r.body.error, r.body.reason], [409, 'hnry_skipped', 'sent']);
  assert.match(r.body.message, /already sent/);
  assert.equal(fake.calls.length, before);
  assert.equal(row(deposit.id).hnry_invoice_id, null);

  const paid = await inv(deposit.id, 'paid', { paidAt: '2026-10-22', via: 'bank' });
  assert.equal(paid.status, 200);
});

test('an invoice made before Hnry, still a draft, is sent by the app as before', async () => {
  fake.fail('findOrCreateClient', 1);
  const { deposit } = await accepted({ pct: 40 });
  const r = await inv(deposit.id, 'send', { by: 'link', dueAt: '2026-12-01' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(row(deposit.id).status, 'sent');
  assert.equal((await rawStatus(deposit.id, 'pdf')).status, 200, 'its PDF is the app\'s, as before');
});

test('marking an invoice in Hnry paid works from draft, as before', async () => {
  const { deposit } = await accepted({ pct: 40 });
  const paid = await inv(deposit.id, 'paid', { paidAt: '2026-10-22', via: 'card' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const after = row(deposit.id);
  assert.deepEqual([after.status, after.paid_via, after.issued_at], ['paid', 'card', '2026-10-22']);
});

/* ── The screens ask whether Hnry is set up (H6) ──────────────────────── */

test('GET /api/hnry/status says whether Hnry is set up, and needs a session', async () => {
  const on = await api('/api/hnry/status').then(json);
  assert.deepEqual([on.status, on.body], [200, { enabled: true }]);
  const off = await start({});
  const loginOff = await fetch(`${off.url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  const c2 = loginOff.headers.getSetCookie()[0].split(';')[0];
  const none = await fetch(`${off.url}/api/hnry/status`, { headers: { cookie: c2 } }).then(json);
  assert.deepEqual([none.status, none.body], [200, { enabled: false }]);
  const anon = await fetch(`${base}/api/hnry/status`);
  assert.equal(anon.status, 401);
});

/* ── The project page's rows carry where each invoice is in Hnry (H6) ── */

test('the folder\'s invoice rows say where each invoice is in Hnry, as the invoice page does', async () => {
  fake.fail('addItem', 1, { after: 0 });
  const { est, deposit, final } = await accepted({ pct: 40 });
  await putInv(final.id, { extras: [OT] });
  assert.equal((await inv(final.id, 'hnry')).status, 502); // the balance line landed; the extra didn't
  const f = (await api(`/api/projects/${est.projectId}`).then(json)).body;
  const dep = f.invoices.find((i) => i.id === deposit.id);
  const fin = f.invoices.find((i) => i.id === final.id);
  const d = row(deposit.id);
  assert.deepEqual([dep.hnryInvoiceId, dep.hnryNumber, dep.hnryPushedAt, dep.hnryLinesDone, dep.hnryError],
    [d.hnry_invoice_id, d.hnry_number, d.hnry_pushed_at, 1, null]);
  assert.ok(dep.hnryInvoiceId && dep.hnryPushedAt, 'the deposit is wholly in Hnry');
  assert.deepEqual([!!fin.hnryInvoiceId, fin.hnryPushedAt, fin.hnryLinesDone, fin.hnryError], [true, null, 1, 'zapier_error'], 'the final is part-way');
  // The invoice page's own view says the same.
  const one = (await inv(final.id)).body.invoice;
  assert.deepEqual([one.hnryInvoiceId, one.hnryLinesDone, one.hnryError], [fin.hnryInvoiceId, fin.hnryLinesDone, fin.hnryError]);
});
