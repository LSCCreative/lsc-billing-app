'use strict';

/**
 * Pushing the deposit (or single) to Hnry on acceptance (hnry-invoicing H3),
 * through the real routes with a fake Hnry behind them. What these pin: the
 * right ONE draft, at the right price, once; that the accept never waits for
 * Hnry and never fails because of it; and that nothing goes out that Hnry
 * might tax again.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-hnrypush-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE } = require('../src/calc');
const { createHnry } = require('../src/hnry');
const { describe } = require('../src/hnry-push');
const { amountDue } = require('../src/invoices');
const { fakeHnry } = require('./fake-hnry');

const PASSWORD = 'correct-horse-battery-staple';
const LIMITS = { all: { max: 100000, windowMs: 60000 }, pdf: { max: 100000, windowMs: 60000 }, sign: { max: 100000, windowMs: 60000 } };
let db;
let cookie;
let base;
let app;
const servers = [];

/* Hnry as the app sees it: always enabled, behind whichever fake the test set. */
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
  // A new fake is a different Hnry: it doesn't know the client ids an earlier test remembered.
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
const idle = () => app.locals.hnryPush.idle();

let n = 0;
let savedClientId = null;
async function savedClient() {
  if (!savedClientId) {
    const r = await api('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' }),
    }).then(json);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    savedClientId = (r.body.client || r.body).id;
  }
  return savedClientId;
}
async function shoot(extra) {
  n += 1;
  const res = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Harbour ' + n,
      upid: 'HP-' + n,
      clientId: await savedClient(),
      client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' },
      activeRows: { prod: [{ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8 }] },
      ...(extra || {}),
    }),
  }).then(json);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.estimate;
}
const invoicesOf = (projectId) => db.prepare('SELECT * FROM invoices WHERE project_id = ? ORDER BY kind').all(projectId);
const activityKinds = (projectId) => db.prepare('SELECT kind FROM activity WHERE project_id = ? ORDER BY at, rowid').all(projectId).map((r) => r.kind);
const totalsOf = (row) => JSON.parse(row.totals_json);

/* ── The owner's Mark accepted ────────────────────────────────────────── */

test('accepting a pair pushes ONE draft, the deposit, at the deposit\'s own amount; the final stays out', async () => {
  const est = await shoot();
  const r = await act(est.projectId, 'accept', { invoicing: 'pair', depositPct: 40 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await idle();

  const [deposit, final] = invoicesOf(est.projectId);
  assert.equal(final.kind, 'final');
  assert.equal(deposit.kind, 'deposit');
  assert.equal(fake.invoices.length, 1, 'one draft in Hnry');
  const draft = fake.invoices[0];
  assert.equal(draft.poNumber, `INV-${est.upid}-D`, 'the app\'s number rides in the PO field');
  assert.deepEqual(draft.items, [{ description: `Deposit invoice (40%): ${est.name}`, quantity: 1, price: totalsOf(deposit).totalIncGst }]);
  assert.ok(totalsOf(deposit).totalIncGst > 0);
  assert.equal(fake.total(draft.id), Math.round(totalsOf(deposit).totalIncGst * 100));

  assert.equal(deposit.hnry_invoice_id, draft.id);
  assert.equal(deposit.hnry_number, draft.invoiceNumber);
  assert.ok(deposit.hnry_pushed_at);
  assert.equal(deposit.hnry_error, null);
  assert.equal(final.hnry_invoice_id, null, 'the final waits for H4');
  assert.equal(final.hnry_error, null);

  assert.deepEqual(fake.clients.map((c) => [c.name, c.email]), [['Saltwater Co.', 'priya@salt.example']]);
  assert.equal(db.prepare('SELECT hnry_client_id FROM clients WHERE id = ?').get(est.clientId).hnry_client_id, fake.clients[0].id);
  assert.ok(activityKinds(est.projectId).includes('hnry_pushed'));

  // The next job for this client reuses the remembered Hnry client: no second search.
  const searches = () => fake.calls.filter((x) => x.name === 'findOrCreateClient').length;
  const before = searches();
  const est2 = await shoot();
  await act(est2.projectId, 'accept', { invoicing: 'single' });
  await idle();
  assert.equal(searches(), before, 'the client is not looked up again');
  assert.equal(fake.invoices.length, 2);
  assert.equal(fake.clients.length, 1);
});

test('a single invoice is pushed whole, as "Invoice: <project>"', async () => {
  const est = await shoot();
  await act(est.projectId, 'accept', { invoicing: 'single' });
  await idle();
  const [single] = invoicesOf(est.projectId);
  assert.equal(single.kind, 'single');
  assert.equal(fake.invoices.length, 1);
  assert.deepEqual(fake.invoices[0].items, [{ description: `Invoice: ${est.name}`, quantity: 1, price: amountDue('single', totalsOf(single)) }]);
  assert.equal(fake.invoices[0].poNumber, single.number);
  assert.equal(single.hnry_number, fake.invoices[0].invoiceNumber);
});

test('Create invoices on a project accepted without them pushes too', async () => {
  const est = await shoot();
  // Accepted in a way that made no invoices (a client who signed before the UPID was fixed).
  db.prepare("UPDATE estimates SET status = 'accepted' WHERE id = ?").run(est.id);
  db.prepare("UPDATE projects SET accepted_at = ? WHERE id = ?").run(nowIso(), est.projectId);
  const r = await act(est.projectId, 'invoices', { invoicing: 'single' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await idle();
  assert.equal(fake.invoices.length, 1);
});

test('the description reads the way the user asked: deposit with its percent, final/single plain', () => {
  assert.equal(describe({ kind: 'deposit', pct: 50 }, 'Brand film'), 'Deposit invoice (50%): Brand film');
  assert.equal(describe({ kind: 'deposit', pct: 33.333 }, 'Brand film'), 'Deposit invoice (33.33%): Brand film');
  assert.equal(describe({ kind: 'single', pct: null }, ' Brand film '), 'Invoice: Brand film');
  assert.equal(describe({ kind: 'single' }, ''), 'Invoice: Project');
});

/* ── The accept never waits for Hnry, and never fails because of it ──── */

test('a slow Hnry does not slow the accept: the answer comes first, the draft follows', async () => {
  const est = await shoot();
  const release = fake.hold();
  const r = await act(est.projectId, 'accept', { invoicing: 'single' });
  assert.equal(r.status, 200);
  assert.equal(r.body.invoices.length, 1);
  assert.equal(fake.invoices.length, 0, 'Hnry has not answered yet');
  assert.equal(invoicesOf(est.projectId)[0].hnry_invoice_id, null);
  release();
  await idle();
  assert.equal(fake.invoices.length, 1);
  assert.ok(invoicesOf(est.projectId)[0].hnry_invoice_id);
});

test('a failing Hnry leaves the project accepted and the invoice marked; a retry then makes the one draft', async () => {
  const est = await shoot();
  fake.fail('createInvoice', 1, { message: 'Zapier error: simulated outage' });
  const r = await act(est.projectId, 'accept', { invoicing: 'pair', depositPct: 50 });
  assert.equal(r.status, 200, 'the accept stands');
  await idle();

  const proj = db.prepare('SELECT accepted_at FROM projects WHERE id = ?').get(est.projectId);
  assert.ok(proj.accepted_at);
  assert.equal(db.prepare('SELECT status FROM estimates WHERE id = ?').get(est.id).status, 'accepted');
  const [deposit] = invoicesOf(est.projectId);
  assert.equal(deposit.hnry_invoice_id, null);
  assert.equal(deposit.hnry_error, 'zapier_error');
  assert.equal(fake.invoices.length, 0);
  const failed = db.prepare("SELECT detail_json FROM activity WHERE project_id = ? AND kind = 'hnry_push_failed'").get(est.projectId);
  assert.match(JSON.parse(failed.detail_json).message, /simulated outage/);

  const retried = await app.locals.hnryPush.push(deposit.id);
  assert.equal(retried.ok, true);
  const after = db.prepare('SELECT * FROM invoices WHERE id = ?').get(deposit.id);
  assert.equal(after.hnry_error, null, 'the error clears');
  assert.equal(after.hnry_number, fake.invoices[0].invoiceNumber);
  assert.equal(fake.invoices.length, 1);
});

/* ── Never two drafts ─────────────────────────────────────────────────── */

test('pushing an invoice twice, or at once, makes one draft', async () => {
  const est = await shoot();
  await act(est.projectId, 'accept', { invoicing: 'single' });
  await idle();
  const [single] = invoicesOf(est.projectId);
  const before = fake.calls.length;
  const again = await app.locals.hnryPush.push(single.id);
  assert.deepEqual([again.ok, again.already], [true, true]);
  assert.equal(fake.calls.length, before, 'no call to Hnry for one already there');

  // Two pushes for one not-yet-pushed invoice share a single run.
  const est2 = await shoot();
  const release = fake.hold();
  await act(est2.projectId, 'accept', { invoicing: 'single' });
  const [s2] = invoicesOf(est2.projectId);
  const p1 = app.locals.hnryPush.push(s2.id);
  const p2 = app.locals.hnryPush.push(s2.id);
  try {
    assert.strictEqual(p1, p2, 'the same push');
  } finally {
    release(); // never leave Hnry held, whatever the assertion said
  }
  await idle();
  assert.equal(fake.invoices.filter((i) => i.poNumber === s2.number).length, 1);
});

test('a draft Hnry already holds for this invoice\'s number is adopted, not duplicated', async () => {
  const est = await shoot();
  // Make the invoice first, with Hnry down, so there is a number to collide with.
  fake.fail('findOrCreateClient', 1);
  await act(est.projectId, 'accept', { invoicing: 'single' });
  await idle();
  const [single] = invoicesOf(est.projectId);
  assert.equal(single.hnry_error, 'zapier_error');

  // Meanwhile a draft with this number exists in Hnry (a push that died after Hnry made it).
  const c = (await fake.run({ name: 'findOrCreateClient' }, { name: 'Saltwater Co.' }))[0];
  const [existing] = await fake.run({ name: 'createInvoice' }, { clientId: c.id, poNumber: single.number, description: 'earlier', quantity: 1, price: 5 });
  const creates = () => fake.calls.filter((x) => x.name === 'createInvoice').length;
  const before = creates();
  const r = await app.locals.hnryPush.push(single.id);
  assert.equal(r.ok, true);
  assert.equal(creates(), before, 'no second createInvoice');
  assert.equal(db.prepare('SELECT hnry_invoice_id FROM invoices WHERE id = ?').get(single.id).hnry_invoice_id, existing.id);
});

/* ── The client's signature ───────────────────────────────────────────── */

test('a client\'s signature pushes the deposit, and its answer does not wait for Hnry', async () => {
  const est = await shoot();
  const sent = await act(est.projectId, 'sent', { validUntil: '2026-11-03' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const token = sent.body.estimates.find((e) => e.id === est.id).publicToken;
  const pub = await fetch(`${base}/public/estimates/${token}`).then(json);
  const e = pub.body.estimate;
  const release = fake.hold();
  const signed = await fetch(`${base}/public/estimates/${token}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Priya Nair', role: 'Marketing lead', agree: true, version: e.version, key: e.agreement && e.agreement.key }),
  }).then(json);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.body.estimate.state, 'accepted');
  assert.equal(fake.invoices.length, 0, 'still waiting on Hnry');
  release();
  await idle();
  const [deposit, final] = invoicesOf(est.projectId);
  assert.equal(fake.invoices.length, 1);
  assert.equal(deposit.hnry_invoice_id, fake.invoices[0].id);
  assert.equal(final.hnry_invoice_id, null);
});

test('a client who signs while Hnry is down is still accepted', async () => {
  const est = await shoot();
  const sent = await act(est.projectId, 'sent', { validUntil: '2026-11-03' });
  const token = sent.body.estimates.find((x) => x.id === est.id).publicToken;
  const e = (await fetch(`${base}/public/estimates/${token}`).then(json)).body.estimate;
  fake.fail('findOrCreateClient', 5);
  const signed = await fetch(`${base}/public/estimates/${token}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Priya Nair', role: 'Lead', agree: true, version: e.version, key: e.agreement && e.agreement.key }),
  }).then(json);
  assert.equal(signed.status, 200);
  await idle();
  assert.equal(signed.body.estimate.state, 'accepted');
  assert.equal(invoicesOf(est.projectId)[0].hnry_error, 'zapier_error');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM signatures s JOIN estimate_versions v ON v.id = s.version_id WHERE v.estimate_id = ?').get(est.id).n, 1);
});

/* ── What must never go out ───────────────────────────────────────────── */

test('a GST-registered business pushes nothing: the invoice is marked, no call is made', async () => {
  const est = await shoot();
  const setGst = (registered) => api('/api/settings', { method: 'PUT', body: JSON.stringify({ gst: { registered, rate: 0.1, pricesIncludeGst: false } }) });
  assert.equal((await setGst(true)).status, 200);
  try {
    await act(est.projectId, 'accept', { invoicing: 'single' });
    await idle();
  } finally {
    await setGst(false);
  }
  assert.equal(fake.calls.length, 0, 'nothing reached Hnry');
  const [single] = invoicesOf(est.projectId);
  assert.equal(single.hnry_error, 'gst_registered');
  assert.equal(single.hnry_invoice_id, null);
});

test('an invoice that carries GST is never pushed, whatever Settings say today', async () => {
  const est = await shoot();
  await act(est.projectId, 'accept', { invoicing: 'single' });
  await idle();
  fake = fakeHnry();
  const [single] = invoicesOf(est.projectId);
  db.prepare('UPDATE invoices SET hnry_invoice_id = NULL, hnry_number = NULL, hnry_pushed_at = NULL, hnry_lines_done = NULL, hnry_error = NULL, totals_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...totalsOf(single), gst: 12.5, totalIncGst: totalsOf(single).clientPriceExGst + 12.5 }), single.id);
  const r = await app.locals.hnryPush.push(single.id);
  assert.deepEqual([r.ok, r.code], [false, 'gst_registered']);
  assert.equal(fake.calls.length, 0);
});

test('an invoice with nothing to bill is refused, not pushed as $0', async () => {
  const est = await shoot();
  await act(est.projectId, 'accept', { invoicing: 'single' });
  await idle();
  fake = fakeHnry();
  const [single] = invoicesOf(est.projectId);
  db.prepare('UPDATE invoices SET hnry_invoice_id = NULL, hnry_number = NULL, hnry_pushed_at = NULL, hnry_lines_done = NULL, totals_json = ? WHERE id = ?')
    .run(JSON.stringify({ clientPriceExGst: 0, gst: 0, totalIncGst: 0, balanceDue: 0 }), single.id);
  const r = await app.locals.hnryPush.push(single.id);
  assert.deepEqual([r.ok, r.code], [false, 'zero_amount']);
  assert.equal(fake.calls.length, 0);
});

test('a project with no client name to invoice is marked no_client', async () => {
  const est = await shoot();
  await act(est.projectId, 'accept', { invoicing: 'single' });
  await idle();
  fake = fakeHnry();
  const [single] = invoicesOf(est.projectId);
  const snap = JSON.parse(single.estimate_snapshot_json);
  snap.client = {};
  db.prepare('UPDATE invoices SET hnry_invoice_id = NULL, hnry_number = NULL, hnry_pushed_at = NULL, hnry_lines_done = NULL, estimate_snapshot_json = ? WHERE id = ?').run(JSON.stringify(snap), single.id);
  db.prepare('UPDATE projects SET client_id = NULL WHERE id = ?').run(est.projectId);
  const r = await app.locals.hnryPush.push(single.id);
  assert.deepEqual([r.ok, r.code], [false, 'no_client']);
  assert.equal(fake.calls.length, 0);
});

test('a void or paid invoice is left alone', async () => {
  for (const status of ['void', 'paid']) {
    const est = await shoot();
    await act(est.projectId, 'accept', { invoicing: 'single' });
    await idle();
    fake = fakeHnry();
    const [single] = invoicesOf(est.projectId);
    db.prepare('UPDATE invoices SET hnry_invoice_id = NULL, hnry_number = NULL, hnry_pushed_at = NULL, hnry_lines_done = NULL, status = ? WHERE id = ?').run(status, single.id);
    const r = await app.locals.hnryPush.push(single.id);
    assert.equal(r.skipped, status);
    assert.equal(fake.calls.length, 0);
  }
});

/* ── Hnry not set up ──────────────────────────────────────────────────── */

test('with Hnry not set up the app behaves as before: no call, no error recorded', async () => {
  const off = await start({});
  const login = await fetch(`${off.url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  const cookie2 = login.headers.getSetCookie()[0].split(';')[0];
  assert.equal(off.app.locals.hnry.enabled, false);
  const est = await shoot();
  const r = await fetch(`${off.url}/api/projects/${est.projectId}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie2 }, body: JSON.stringify({ invoicing: 'pair', depositPct: 50 }),
  });
  assert.equal(r.status, 200);
  await off.app.locals.hnryPush.idle();
  for (const inv of invoicesOf(est.projectId)) {
    assert.deepEqual([inv.hnry_invoice_id, inv.hnry_number, inv.hnry_error], [null, null, null]);
  }
  assert.ok(!activityKinds(est.projectId).some((k) => k.startsWith('hnry')));
  assert.equal(fake.calls.length, 0);
});

test('a remembered Hnry client Hnry no longer knows is forgotten when the push fails, so the retry works', async () => {
  const est = await shoot();
  db.prepare('UPDATE clients SET hnry_client_id = ? WHERE id = ?').run('Z2lkOi8vaG5yeS9DbGllbnQvOTk5OTk5', est.clientId);
  await act(est.projectId, 'accept', { invoicing: 'single' });
  await idle();
  const [single] = invoicesOf(est.projectId);
  assert.equal(single.hnry_error, 'zapier_error', 'the stale id failed the push');
  assert.equal(db.prepare('SELECT hnry_client_id FROM clients WHERE id = ?').get(est.clientId).hnry_client_id, null, 'and was dropped');
  const r = await app.locals.hnryPush.push(single.id);
  assert.equal(r.ok, true);
  assert.equal(fake.invoices.length, 1);
  assert.equal(db.prepare('SELECT hnry_client_id FROM clients WHERE id = ?').get(est.clientId).hnry_client_id, fake.clients[0].id);
});

test('while a push is under way the invoice can\'t be edited or sent from the app', async () => {
  const est = await shoot();
  const release = fake.hold();
  try {
    await act(est.projectId, 'accept', { invoicing: 'pair', depositPct: 50 });
    const [deposit] = invoicesOf(est.projectId);
    assert.equal(app.locals.hnryPush.busy(deposit.id), true);
    const edit = await api(`/api/invoices/${deposit.id}`, { method: 'PUT', body: JSON.stringify({ depositPct: 30 }) }).then(json);
    assert.deepEqual([edit.status, edit.body.error], [409, 'hnry_pushing']);
    const send = await api(`/api/invoices/${deposit.id}/send`, { method: 'POST', body: JSON.stringify({ by: 'link', dueAt: '2026-10-20' }) }).then(json);
    assert.deepEqual([send.status, send.body.error], [409, 'hnry_pushing']);
  } finally {
    release(); // never leave Hnry held, whatever the assertion said
  }
  await idle();
  const [deposit] = invoicesOf(est.projectId);
  assert.deepEqual([deposit.pct, deposit.status], [50, 'draft'], 'the figures Hnry got are the ones the app kept');
  assert.equal(fake.total(deposit.hnry_invoice_id), Math.round(totalsOf(deposit).totalIncGst * 100));
  assert.equal(app.locals.hnryPush.busy(deposit.id), false);
});
