'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-pdf-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { buildEstimateHtml, exportBlocker, exportFilename, resolveExecutablePath } = require('../src/pdf');

const PASSWORD = 'correct-horse-battery-staple';
const USERNAME = 'lachlan';

const QUOTE = {
  upid: 'UP-042',
  name: 'Brand film',
  date: '2026-09-08',
  docType: 'estimate',
  invoiceNumber: '',
  client: { businessName: 'Acme Pty Ltd', contactName: 'Jo Bloggs', email: 'jo@acme.example' },
  activeRows: { prod: [{ name: 'Video Capture', qty: 2 }] },
  totals: { totalIncGst: 280 },
};

const PRICING = {
  labourSections: [{ id: 'prod', label: 'Production', rows: [{ name: 'Video Capture', rate: 100, mu: 140 }] }],
  travelRows: [],
  taxSetAsideRate: 0.35,
};

test('buildEstimateHtml: quote shows the total and escapes client fields', () => {
  const html = buildEstimateHtml(QUOTE, PRICING, {});
  assert.match(html, /Video Capture/);
  assert.match(html, /\$280\.00/);
  assert.match(html, /Acme Pty Ltd/);
  assert.doesNotMatch(html, /INVOICE/);
});

test('buildEstimateHtml: invoice shows the invoice number and payment details when set', () => {
  const invoice = { ...QUOTE, docType: 'invoice', invoiceNumber: 'INV-007' };
  const settings = { payment: { bankName: 'Big Bank', accountName: 'LSC Creative', bsb: '123-456', accountNumber: '00001111', terms: 'Net 14' } };
  const html = buildEstimateHtml(invoice, PRICING, settings);
  assert.match(html, /INVOICE.*INV-007/s);
  assert.match(html, /Big Bank/);
  assert.match(html, /Net 14/);
});

test('buildEstimateHtml: invoice omits the payment block when nothing is configured', () => {
  const invoice = { ...QUOTE, docType: 'invoice', invoiceNumber: 'INV-007' };
  const html = buildEstimateHtml(invoice, PRICING, {});
  assert.doesNotMatch(html, /Payment Details/);
});

/* The three GST states a document can be in. Classified from the stored totals
   and the estimate's own gstFree flag — note that none of these pass a `gst`
   settings block at all, because the document must not consult it. */
const TAXABLE_TOTALS = { clientPriceExGst: 280, gst: 28, totalIncGst: 308 };
const UNTAXED_TOTALS = { clientPriceExGst: 280, gst: 0, totalIncGst: 280 };
const BUSINESS = { business: { name: 'Lachlan Sullivan-Carey', abn: '51824753556' } };
const INVOICE = { ...QUOTE, docType: 'invoice', invoiceNumber: 'INV-007' };

test('buildEstimateHtml: a GST-bearing invoice is a tax invoice with the breakdown and ABN', () => {
  const html = buildEstimateHtml({ ...INVOICE, totals: TAXABLE_TOTALS }, PRICING, BUSINESS);
  assert.match(html, /TAX INVOICE.*INV-007/s);
  assert.match(html, /Subtotal \(ex GST\).*\$280\.00/s);
  assert.match(html, />GST<.*\$28\.00/s);
  assert.match(html, /Total Due.*inc\. GST.*\$308\.00/s);
  assert.match(html, /Lachlan Sullivan-Carey &middot; ABN 51 824 753 556/);
  assert.match(html, /include GST/);
  assert.doesNotMatch(html, /GST not included/);
});

test('buildEstimateHtml: a GST-free invoice on a registered business is a plain invoice saying so', () => {
  const html = buildEstimateHtml({ ...INVOICE, gstFree: true, totals: UNTAXED_TOTALS }, PRICING, BUSINESS);
  assert.doesNotMatch(html, /TAX INVOICE/);
  assert.match(html, /INVOICE.*INV-007/s);
  assert.doesNotMatch(html, /Subtotal \(ex GST\)/);
  assert.match(html, /GST-free — no GST is payable on this invoice/);
  assert.match(html, /\$280\.00/);
  assert.doesNotMatch(html, /GST not included/);
});

test('buildEstimateHtml: an unregistered invoice charges no GST and does not imply it is still to come', () => {
  const html = buildEstimateHtml({ ...INVOICE, totals: UNTAXED_TOTALS }, PRICING, {});
  assert.doesNotMatch(html, /TAX INVOICE/);
  assert.doesNotMatch(html, /Subtotal \(ex GST\)/);
  assert.match(html, /No GST is charged/);
  assert.doesNotMatch(html, /GST not included/);
  assert.doesNotMatch(html, /ABN/);
});

test('buildEstimateHtml: a quote describes GST the same three ways', () => {
  const taxed = buildEstimateHtml({ ...QUOTE, totals: TAXABLE_TOTALS }, PRICING, BUSINESS);
  assert.match(taxed, /Subtotal \(ex GST\).*GST.*Total Investment.*\$308\.00/s);
  assert.match(taxed, /include GST\. Quote valid for 30 days/);
  assert.doesNotMatch(taxed, /INVOICE/);

  const free = buildEstimateHtml({ ...QUOTE, gstFree: true, totals: UNTAXED_TOTALS }, PRICING, BUSINESS);
  assert.match(free, /no GST is payable on this quote/);

  const none = buildEstimateHtml({ ...QUOTE, totals: UNTAXED_TOTALS }, PRICING, {});
  assert.match(none, /No GST is charged\. Quote valid for 30 days/);
  for (const html of [taxed, free, none]) assert.doesNotMatch(html, /GST not included/);
});

test('buildEstimateHtml: the invoice shows the client ABN when the snapshot has one', () => {
  const invoice = { ...INVOICE, client: { ...QUOTE.client, abn: '12345678901' }, totals: TAXABLE_TOTALS };
  assert.match(buildEstimateHtml(invoice, PRICING, BUSINESS), /ABN 12 345 678 901/);
});

test('exportBlocker: only a GST-bearing invoice needs the ABN', () => {
  const taxed = { ...INVOICE, totals: TAXABLE_TOTALS };
  assert.equal(exportBlocker(taxed, {}).error, 'abn_required');
  assert.equal(exportBlocker(taxed, { business: { abn: '   ' } }).error, 'abn_required');
  assert.equal(exportBlocker(taxed, BUSINESS), null);
  assert.equal(exportBlocker({ ...INVOICE, gstFree: true, totals: UNTAXED_TOTALS }, {}), null);
  assert.equal(exportBlocker({ ...INVOICE, totals: UNTAXED_TOTALS }, {}), null);
  assert.equal(exportBlocker({ ...QUOTE, totals: TAXABLE_TOTALS }, {}), null);
});

test('exportFilename: strips filesystem-unsafe characters', () => {
  const name = exportFilename({ ...QUOTE, name: 'Q3/Q4 Recap: "Highlights"' });
  assert.doesNotMatch(name, /[/\\:*?"<>|]/);
  assert.match(name, /^UP-042 - Acme Pty Ltd - /);
  assert.match(name, /\.pdf$/);
});

test('POST /api/estimates/:id/pdf renders a real PDF and writes a copy to exportDir', async (t) => {
  if (!resolveExecutablePath()) {
    t.skip('no headless Chromium available on this machine');
    return;
  }

  const db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`
    INSERT INTO account (id, username, password_hash, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(USERNAME, await hashPassword(PASSWORD), nowIso(), nowIso());

  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    const cookie = loginRes.headers.getSetCookie()[0].split(';')[0];
    const api = (pathname, opts = {}) => fetch(`${baseUrl}${pathname}`, {
      ...opts,
      headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) },
    });

    await api('/api/pricing', { method: 'PUT', body: JSON.stringify(PRICING) });

    const created = await api('/api/estimates', {
      method: 'POST',
      body: JSON.stringify({
        name: QUOTE.name, upid: QUOTE.upid, date: QUOTE.date,
        client: QUOTE.client, activeRows: QUOTE.activeRows,
      }),
    }).then((r) => r.json());

    const pdfRes = await api(`/api/estimates/${created.estimate.id}/pdf`, { method: 'POST' });
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');

    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');

    const exported = fs.readdirSync(path.join(TMP, 'exports'));
    assert.equal(exported.length, 1);
    assert.match(exported[0], /^UP-042 - Acme Pty Ltd - Brand film\.pdf$/);
  } finally {
    server.close();
    db.close();
  }
});
