'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-api-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const PASSWORD = 'correct-horse-battery-staple';
const USERNAME = 'lachlan';

let server;
let baseUrl;
let db;
let cookie;

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

test('clients: create, search, get, update, upsert, delete', async () => {
  const created = await api('/api/clients', {
    method: 'POST',
    body: JSON.stringify({ businessName: 'Acme Pty Ltd', contactName: 'Jo', email: 'jo@acme.example' }),
  }).then((r) => r.json());
  assert.equal(created.client.businessName, 'Acme Pty Ltd');

  const search = await api('/api/clients?q=acme').then((r) => r.json());
  assert.equal(search.clients.length, 1);

  const got = await api(`/api/clients/${created.client.id}`).then((r) => r.json());
  assert.equal(got.client.email, 'jo@acme.example');

  const updated = await api(`/api/clients/${created.client.id}`, {
    method: 'PUT',
    body: JSON.stringify({ businessName: 'Acme Pty Ltd', contactName: 'Jo', email: 'jo2@acme.example' }),
  }).then((r) => r.json());
  assert.equal(updated.client.email, 'jo2@acme.example');

  // upsert on the same business name must not create a duplicate row.
  const upserted = await api('/api/clients/upsert', {
    method: 'POST',
    body: JSON.stringify({ businessName: 'Acme Pty Ltd', phone: '0400000000' }),
  }).then((r) => r.json());
  assert.equal(upserted.created, false);
  assert.equal(upserted.client.id, created.client.id);
  const list = await api('/api/clients').then((r) => r.json());
  assert.equal(list.clients.filter((c) => c.businessName === 'Acme Pty Ltd').length, 1);

  const del = await api(`/api/clients/${created.client.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const missing = await api(`/api/clients/${created.client.id}`);
  assert.equal(missing.status, 404);
});

test('pricing: save actually persists (the fake "Save Rates" bug)', async () => {
  const put = await api('/api/pricing', {
    method: 'PUT',
    body: JSON.stringify({ labourSections: [], travelRows: [], taxSetAsideRate: 0.4 }),
  }).then((r) => r.json());
  assert.equal(put.pricing.taxSetAsideRate, 0.4);

  const get = await api('/api/pricing').then((r) => r.json());
  assert.equal(get.pricing.taxSetAsideRate, 0.4);
});

test('settings: round-trips', async () => {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ business: { name: 'LSC Creative' }, gst: { registered: true, rate: 0.1 } }),
  });
  const get = await api('/api/settings').then((r) => r.json());
  assert.equal(get.settings.business.name, 'LSC Creative');
  assert.equal(get.settings.gst.registered, true);
});

test('estimates: create, list, get, update, duplicate, delete — with computed totals', async () => {
  // Reset GST state so this test doesn't depend on running after the settings
  // test above.
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ gst: { registered: false, rate: 0.1, pricesIncludeGst: false } }),
  });
  await api('/api/pricing', {
    method: 'PUT',
    body: JSON.stringify({
      labourSections: [{ id: 'prod', label: 'Production', rows: [{ name: 'Video Capture', rate: 100, mu: 140 }] }],
      travelRows: [],
      taxSetAsideRate: 0.35,
    }),
  });

  const created = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Brand film', client: { businessName: 'Acme' },
      activeRows: { prod: [{ name: 'Video Capture', qty: 2 }] },
    }),
  }).then((r) => r.json());
  assert.equal(created.estimate.totals.labourTotal, 280);
  assert.equal(created.estimate.totals.totalIncGst, 280);

  const list = await api('/api/estimates').then((r) => r.json());
  assert.equal(list.estimates.length, 1);

  const got = await api(`/api/estimates/${created.estimate.id}`).then((r) => r.json());
  assert.equal(got.estimate.name, 'Brand film');

  const updated = await api(`/api/estimates/${created.estimate.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Brand film v2', client: { businessName: 'Acme' },
      activeRows: { prod: [{ name: 'Video Capture', qty: 3 }] },
    }),
  }).then((r) => r.json());
  assert.equal(updated.estimate.name, 'Brand film v2');
  assert.equal(updated.estimate.totals.labourTotal, 420);

  const dup = await api(`/api/estimates/${created.estimate.id}/duplicate`, { method: 'POST' })
    .then((r) => r.json());
  assert.equal(dup.estimate.name, 'Brand film v2 (copy)');
  assert.equal(dup.estimate.status, 'draft');

  const del = await api(`/api/estimates/${created.estimate.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const missing = await api(`/api/estimates/${created.estimate.id}`);
  assert.equal(missing.status, 404);
});

test('estimates: a GST-free estimate survives the round trip and prices without GST', async () => {
  // A registered, GST-exclusive business — so GST would apply unless the
  // estimate opts out.
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ gst: { registered: true, rate: 0.1, pricesIncludeGst: false } }),
  });
  await api('/api/pricing', {
    method: 'PUT',
    body: JSON.stringify({
      labourSections: [{ id: 'prod', label: 'Production', rows: [{ name: 'Video Capture', rate: 100, mu: 140 }] }],
      travelRows: [],
      taxSetAsideRate: 0.35,
    }),
  });
  const rows = { prod: [{ name: 'Video Capture', qty: 2 }] };

  const bearing = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ name: 'Taxable job', activeRows: rows }),
  }).then((r) => r.json());
  assert.equal(bearing.estimate.gstFree, false);
  assert.equal(bearing.estimate.totals.gst, 28);
  assert.equal(bearing.estimate.totals.totalIncGst, 308);

  const free = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ name: 'GST-free job', activeRows: rows, gstFree: true }),
  }).then((r) => r.json());
  assert.equal(free.estimate.gstFree, true);
  assert.equal(free.estimate.totals.gst, 0);
  assert.equal(free.estimate.totals.totalIncGst, 280);

  // Read back in a fresh request: the flag is a column, not something the POST
  // reply happened to echo.
  const reread = await api(`/api/estimates/${free.estimate.id}`).then((r) => r.json());
  assert.equal(reread.estimate.gstFree, true);
  assert.equal(reread.estimate.totals.gst, 0);

  // A duplicate is a copy of the document, so it inherits the tax treatment.
  // Re-deriving it from settings would quietly add GST to a copy of a GST-free
  // quote.
  const dup = await api(`/api/estimates/${free.estimate.id}/duplicate`, { method: 'POST' })
    .then((r) => r.json());
  assert.equal(dup.estimate.gstFree, true);
  assert.equal(dup.estimate.totals.gst, 0);

  // And it can be switched back off, which must re-price rather than keep the
  // stored figure.
  const back = await api(`/api/estimates/${free.estimate.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'GST-free job', activeRows: rows, gstFree: false }),
  }).then((r) => r.json());
  assert.equal(back.estimate.gstFree, false);
  assert.equal(back.estimate.totals.gst, 28);

  for (const id of [bearing.estimate.id, free.estimate.id, dup.estimate.id]) {
    await api(`/api/estimates/${id}`, { method: 'DELETE' });
  }
});

test('pdf: a GST-bearing invoice is refused until the ABN is set; other documents are not', async () => {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ business: { name: '', abn: '' }, gst: { registered: true, rate: 0.1, pricesIncludeGst: false } }),
  });
  const rows = { prod: [{ name: 'Video Capture', qty: 2 }] };
  const make = (extra) => api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ name: 'Doc', activeRows: rows, ...extra }),
  }).then((r) => r.json()).then((j) => j.estimate);

  const taxInvoice = await make({ docType: 'invoice', invoiceNumber: 'INV-1' });
  const freeInvoice = await make({ docType: 'invoice', invoiceNumber: 'INV-2', gstFree: true });
  const quote = await make({});
  assert.equal(taxInvoice.totals.gst, 28);

  const refused = await api(`/api/estimates/${taxInvoice.id}/pdf`, { method: 'POST' });
  assert.equal(refused.status, 422);
  const body = await refused.json();
  assert.equal(body.error, 'abn_required');
  assert.match(body.message, /ABN/);

  // 200 with Chromium present, 503 without — either way, not refused.
  for (const est of [freeInvoice, quote]) {
    const res = await api(`/api/estimates/${est.id}/pdf`, { method: 'POST' });
    assert.notEqual(res.status, 422, `${est.docType} ${est.gstFree ? 'GST-free' : ''} was refused`);
    await res.arrayBuffer();
  }

  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ business: { name: 'Lachlan Sullivan-Carey', abn: '51824753556' }, gst: { registered: true, rate: 0.1, pricesIncludeGst: false } }),
  });
  const allowed = await api(`/api/estimates/${taxInvoice.id}/pdf`, { method: 'POST' });
  assert.notEqual(allowed.status, 422);
  await allowed.arrayBuffer();

  for (const est of [taxInvoice, freeInvoice, quote]) {
    await api(`/api/estimates/${est.id}`, { method: 'DELETE' });
  }
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({}) });
});

test('pdf: a non-ASCII name exports with its filename intact and takes no backup snapshot', async () => {
  const created = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Nick’s launch — v2',
      client: { businessName: 'Café Ltd' },
      activeRows: { prod: [{ name: 'Video Capture', qty: 1 }] },
    }),
  }).then((r) => r.json());

  const backupDir = path.join(TMP, 'backups');
  const snapshotsBefore = fs.readdirSync(backupDir).sort();

  const res = await api(`/api/estimates/${created.estimate.id}/pdf`, { method: 'POST' });
  // 200 with Chromium present, 503 without. Before the fix, a raw header 500'd.
  assert.notEqual(res.status, 500);
  if (res.status === 200) {
    const disposition = res.headers.get('content-disposition');
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    assert.ok(encoded, disposition);
    assert.equal(decodeURIComponent(encoded[1]), 'EST - Café Ltd - Nick’s launch — v2.pdf');
  }
  await res.arrayBuffer();

  // Compared as a set, not a count: at retention a new snapshot would replace
  // the oldest and leave the count unchanged.
  assert.deepEqual(fs.readdirSync(backupDir).sort(), snapshotsBefore);

  await api(`/api/estimates/${created.estimate.id}`, { method: 'DELETE' });
});

test('CORS: an allow-listed origin gets credentialed headers, others get none', async () => {
  // This server instance was built with no CORS_ORIGINS set, so no origin
  // should be echoed back — same-origin-only is the safe default.
  const res = await api('/api/settings', { headers: { origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);

  const { config } = require('../src/config');
  config.corsOrigins.push('https://pages.example');
  try {
    const allowed = await api('/api/settings', { headers: { origin: 'https://pages.example' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://pages.example');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    // The export button names the download from this header.
    assert.match(allowed.headers.get('access-control-expose-headers'), /Content-Disposition/);
  } finally {
    config.corsOrigins.pop();
  }
});
