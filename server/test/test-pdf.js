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
const {
  buildEstimateHtml, buildCostBreakdownHtml, costBreakdownBlocker, exportBlocker, exportFilename, costBreakdownFilename,
  resolveExecutablePath, PROPOSED_DISCLAIMER,
} = require('../src/pdf');
const { PRICING_SHAPE, computeTotals, surchargeSnapshot, stampSurchargedPrices } = require('../src/calc');

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
  serviceDay: { fullHours: 8, halfHours: 4 },
  labourSections: [{ id: 'prod', label: 'Production', rows: [{ name: 'Video Capture', rate: 100, prices: { hour: 140, half: null, full: null } }] }],
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

/* ── Production days and the Cost Breakdown (production-booking task 8) ────── */

const DAY_PRICING = {
  serviceDay: { fullHours: 8, halfHours: 4 },
  labourSections: [
    { id: 'prod', label: 'Production', rows: [] },
    { id: 'post', label: 'Post-Production', rows: [] },
  ],
  travelRows: [],
  taxSetAsideRate: 0.35,
};
const UNREG = { gst: { registered: false } };
const EXCL = { gst: { registered: true, rate: 0.1, pricesIncludeGst: false } };
const INCL = { gst: { registered: true, rate: 0.1, pricesIncludeGst: true } };
const cap = (extra) => ({ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, ...extra });
const SAT = { id: 'd_sat', date: '2026-10-03', status: 'confirmed', startTime: '13:00', endTime: '21:00', overrideNote: 'Subcontractor shooting' };
const FRI = { id: 'd_fri', date: '2026-10-02', status: 'pencilled', startTime: '09:00', endTime: '19:00', overrideNote: '' };
const TBC = { id: 'd_tbc', date: null, status: 'proposed', startTime: null, endTime: null, overrideNote: '' };

/* An estimate as the server stores it: lines stamped, totals computed, the
   surcharge snapshot pinned — the shape loadEstimate hands the PDF. */
function bookedEstimate({ rows, days, shortNotice = false, settings = UNREG, mode, gstFree = false }) {
  const surcharges = surchargeSnapshot(days, DAY_PRICING, [], null);
  if (mode) surcharges.settings.mode = mode;
  const opts = { days, surcharges, shortNotice, gstFree };
  return {
    ...QUOTE,
    activeRows: stampSurchargedPrices(rows, DAY_PRICING, opts),
    totals: computeTotals(rows, DAY_PRICING, settings, opts),
    days, surcharges, shortNotice, gstFree,
  };
}

const ALL_ON_DAYS = () => bookedEstimate({
  rows: { prod: [cap({ dayId: 'd_sat' }), cap({ dayId: 'd_fri' }), cap({ dayId: 'd_tbc', name: 'Drone', mu: 600, dayUnit: 'half', hoursPerUnit: 4 })] },
  days: [SAT, FRI, TBC],
  shortNotice: true,
});

const moneyIn = (html) => [...html.matchAll(/\$([\d,]+\.\d\d)/g)].map((m) => Math.round(parseFloat(m[1].replace(/,/g, '')) * 100));

/* Words that would tell the client a surcharge exists (D8, D12), and the
   owner's internal figures the Cost Breakdown must never carry (D13). */
const SURCHARGE_WORDS = /surcharge|weekend|after hours|short notice|holiday rate|standard rate|&times;|×|Cost Breakdown|Subcontractor/i;
const INTERNAL_WORDS = /floor|minimum job|set-aside|set aside|take-home|take home|overhead|markup|mark-up|Subcontractor/i;

test('client PDF: production days by date with status and times, items at their folded prices', () => {
  const est = ALL_ON_DAYS();
  const html = buildEstimateHtml(est, DAY_PRICING, {});
  assert.match(html, /Production Days/);
  assert.match(html, /Saturday 3 October 2026.*Confirmed &middot; 1:00pm–9:00pm.*Video Capture.*1 full day.*\$3,360\.00/s);
  // Friday 9–7 holds a full day, which covers 9–5: short notice only.
  assert.match(html, /Friday 2 October 2026.*Pencilled &middot; 9:00am–7:00pm.*\$2,240\.00/s);
  assert.match(html, /Date TBC.*Proposed.*Drone.*1 half day.*\$1,200\.00/s);
  // Days print in the estimate's own order (the editor saves them by date, TBC last).
  assert.ok(html.indexOf('Saturday 3 October') < html.indexOf('Friday 2 October'));
  // Each item is listed once: under its day, not again under the services.
  assert.equal(html.match(/Video Capture/g).length, 2);
  assert.doesNotMatch(html, /What Goes Into This Project/);
});

test('client PDF: the folded prices add up to the total', () => {
  const est = ALL_ON_DAYS();
  const html = buildEstimateHtml(est, DAY_PRICING, {});
  const days = html.slice(html.indexOf('Production Days'), html.indexOf('Your Investment'));
  const lines = moneyIn(days);
  assert.deepEqual(lines, [336000, 224000, 120000]);
  assert.equal(lines.reduce((a, b) => a + b, 0), Math.round(est.totals.totalIncGst * 100));
  assert.match(html, /Total Investment.*\$6,800\.00/s);

  // On a GST-exclusive card they add up to the ex-GST subtotal shown above GST.
  const ex = bookedEstimate({ rows: { prod: [cap({ dayId: 'd_sat' })] }, days: [SAT], settings: EXCL });
  const exHtml = buildEstimateHtml(ex, DAY_PRICING, {});
  assert.match(exHtml, /Production Days.*\$1,680\.00.*Subtotal \(ex GST\).*\$1,680\.00.*GST.*\$168\.00.*\$1,848\.00/s);
});

test('client PDF: no surcharge wording, and the owner\'s clash note stays off it', () => {
  for (const mode of ['higher', 'multiply', 'highest']) {
    const est = bookedEstimate({ rows: { prod: [cap({ dayId: 'd_sat' })] }, days: [SAT], shortNotice: true, mode });
    for (const docType of ['estimate', 'invoice']) {
      const html = buildEstimateHtml({ ...est, docType, invoiceNumber: 'INV-1' }, DAY_PRICING, {});
      assert.doesNotMatch(html, SURCHARGE_WORDS, mode + ' ' + docType);
      assert.match(html, /Saturday 3 October 2026/);
    }
  }
});

test('client PDF: the proposed-dates disclaimer prints only on a quote with a proposed day', () => {
  const withProposed = ALL_ON_DAYS();
  assert.ok(buildEstimateHtml(withProposed, DAY_PRICING, {}).includes(PROPOSED_DISCLAIMER));
  assert.equal(PROPOSED_DISCLAIMER,
    'The proposed dates are not locked in and other project bookings may happen before this estimate is agreed upon.');
  const none = bookedEstimate({ rows: { prod: [cap({ dayId: 'd_sat' })] }, days: [SAT, FRI] });
  assert.ok(!buildEstimateHtml(none, DAY_PRICING, {}).includes(PROPOSED_DISCLAIMER));
  // An invoice is past agreement: no disclaimer even with a proposed day.
  assert.ok(!buildEstimateHtml({ ...withProposed, docType: 'invoice' }, DAY_PRICING, {}).includes(PROPOSED_DISCLAIMER));
});

test('client PDF: unassigned production lines and an estimate with no days print as before', () => {
  const mixed = bookedEstimate({ rows: { prod: [cap({ dayId: 'd_sat' }), cap({ name: 'Interview Setup' })] }, days: [SAT] });
  const html = buildEstimateHtml(mixed, DAY_PRICING, {});
  assert.match(html, /Production Days.*Video Capture.*What Goes Into This Project.*Production.*Interview Setup/s);
  assert.doesNotMatch(html.slice(html.indexOf('What Goes Into')), /Video Capture/);

  const plain = buildEstimateHtml({ ...QUOTE, days: [] }, PRICING, {});
  assert.doesNotMatch(plain, /Production Days/);
  assert.match(plain, /What Goes Into This Project.*Video Capture/s);
  assert.equal(plain, buildEstimateHtml(QUOTE, PRICING, {})); // no `days` reads as none
});

/* The Cost Breakdown's printed rows: every 'item' row, and the 'total'. */
function cbFigures(html) {
  const rows = [...html.matchAll(/<tr data-cb="(\w+)">(.*?)<\/tr>/gs)];
  const amount = (cells) => {
    const m = /([+-]?)\$([\d,]+\.\d\d)<\/td>$/.exec(cells);
    return Math.round(parseFloat(m[2].replace(/,/g, '')) * 100) * (m[1] === '-' ? -1 : 1);
  };
  return {
    items: rows.filter((r) => r[1] === 'item').map((r) => amount(r[2])),
    total: rows.filter((r) => r[1] === 'total').map((r) => amount(r[2])),
    text: rows.map((r) => r[2].replace(/<[^>]+>/g, '').replace(/&middot;/g, '·').replace(/&times;/g, '×')
      .replace(/&rarr;/g, '→').replace(/&amp;/g, '&')),
  };
}

test('Cost Breakdown: base prices, each item\'s rates with its hours, carry-over, short notice, adding up to the total', () => {
  const FRI_NIGHT = { id: 'd_fn', date: '2026-10-02', status: 'confirmed', startTime: '20:00', endTime: '02:00', overrideNote: '' };
  const est = bookedEstimate({
    rows: {
      prod: [cap({ dayId: 'd_sat' }), cap({ dayId: 'd_fn' }), cap({ dayId: 'd_fri' }), cap({ dayId: 'd_tbc' })],
      post: [cap({ name: 'Edit', dayUnit: undefined, hoursPerUnit: undefined, mu: 150, qty: 6 })],
      crew: [{ role: 'Gaffer', days: 2, cost: 650 }],
      equip: [{ vendor: 'Lens hire', days: 1, cost: 180 }],
    },
    days: [SAT, FRI_NIGHT, FRI, TBC],
    shortNotice: true,
  });
  const html = buildCostBreakdownHtml(est, DAY_PRICING, {});
  const f = cbFigures(html);
  const has = (re) => assert.ok(f.text.some((t) => re.test(t)), String(re));
  has(/^Video Capture · 1 full day, standard rate\$1,120\.00$/);
  // Saturday 1–9pm: the weekend rate on all eight hours (it beats after hours).
  has(/^Weekend rate ×1\.5 · all of its 8 hrs\+\$560\.00$/);
  // Friday 8pm → 2am: after hours until midnight, then a carry-over into Saturday at the weekend rate.
  has(/^After hours ×1\.25 · 4 of its 6 hrs\+\$186\.67$/);
  has(/^Carry-over into Saturday 3 October 2026: weekend rate ×1\.5 · 2 of its 6 hrs, after midnight, \$186\.67\/hr → \$280\.00\/hr\+\$186\.67$/);
  has(/^Day total · before short notice\$1,493\.34$/);
  // Friday 9–7: the full day covers 9–5, and the page says why the last two hours carry nothing.
  has(/^Covers 9:00am–5:00pm: 8 hrs from the 9:00am start, of the 10 hrs booked\. The rest of the booking carries no day or time rate\.$/);
  // Short notice: once, on all four items: 1,680 + 1,493.66 + 1,120 + 1,120.
  has(/^Short notice ×2 · booked at short notice, on 4 production items\+\$5,413\.66$/);
  has(/^Edit · 6 hours\$900\.00$/);
  has(/^Gaffer · 2 days at \$650\.00\$1,300\.00$/);
  // The explanation, in the estimate's own office hours and mode.
  assert.match(html, /Each item&rsquo;s day and time rates apply to the hours it covers.*7:00am&ndash;5:00pm.*Hours after midnight take the next date&rsquo;s rate, shown as a carry-over\. Where a weekend or holiday rate and after hours overlap, the higher one applies/s);
  // The rows add up to the total, which is the estimate's own.
  const sum = f.items.reduce((a, b) => a + b, 0);
  assert.deepEqual(f.total, [sum]);
  assert.equal(sum, Math.round(est.totals.totalIncGst * 100));
  assert.match(html, /Total <span[^>]*>inc\. all services<\/span><\/td><td[^>]*>\$13,207\.00/);
  // Its header names it, and none of the owner's internal figures appear.
  assert.match(html, /COST BREAKDOWN.*UP-042.*Brand film/s);
  assert.doesNotMatch(html, INTERNAL_WORDS);
});

test('Cost Breakdown: an estimate whose stored total no longer matches its lines is refused, not "rounded"', () => {
  const est = { ...QUOTE, activeRows: { post: [cap({ name: 'Edit', mu: 1000, qty: 2 })] },
    totals: { clientPriceExGst: 1400, gst: 0, totalIncGst: 1400 }, days: [] };
  assert.equal(costBreakdownBlocker(est, DAY_PRICING).error, 'breakdown_stale');
  assert.match(costBreakdownBlocker(est, DAY_PRICING).message, /save it again/);
  assert.equal(costBreakdownBlocker(ALL_ON_DAYS(), DAY_PRICING), null);
});

test('client PDF and Cost Breakdown: a zero-quantity item is left off, a charged one never is', () => {
  const est = bookedEstimate({
    rows: { prod: [cap({ dayId: 'd_sat' }), cap({ dayId: 'd_sat', name: 'Drone', qty: 0 }), cap({ dayId: 'd_sat', name: 'Handover', qty: 0, override: 150 })] },
    days: [SAT],
  });
  const html = buildEstimateHtml(est, DAY_PRICING, {});
  assert.doesNotMatch(html, /Drone/);
  assert.match(html, /Handover.*\$225\.00/s); // its custom $150, at the weekend rate
  assert.doesNotMatch(buildCostBreakdownHtml(est, DAY_PRICING, {}), /Drone/);
});

test('Cost Breakdown: adds up on GST-inclusive and exclusive cards, in every mode', () => {
  for (const settings of [UNREG, INCL, EXCL]) {
    for (const mode of ['higher', 'multiply', 'highest']) {
      const est = bookedEstimate({
        rows: {
          prod: [cap({ dayId: 'd_sat', mu: 1337 }), cap({ dayId: 'd_fri', qty: 1.5, mu: 241 }), cap({ name: 'Unassigned', mu: 99.5 })],
          crew: [{ role: 'Grip', days: 1, cost: 412.5 }],
        },
        days: [SAT, FRI],
        shortNotice: mode !== 'highest',
        settings,
        mode,
      });
      const html = buildCostBreakdownHtml(est, DAY_PRICING, {});
      const f = cbFigures(html);
      const sum = f.items.reduce((a, b) => a + b, 0);
      assert.deepEqual(f.total, [sum], mode);
      const target = settings === INCL ? est.totals.totalIncGst : est.totals.clientPriceExGst;
      assert.equal(sum, Math.round(target * 100), mode);
      assert.doesNotMatch(html, INTERNAL_WORDS);
      if (settings === EXCL) assert.match(html, /Items total \(ex GST\)/);
      if (settings === INCL) assert.match(html, /Items total \(inc\. GST\)/);
    }
  }
});

test('Cost Breakdown: a rounding row only when lines are in fractions of a cent', () => {
  const rows = { post: [cap({ name: 'Grade', mu: 33.33, qty: 1.5, dayUnit: undefined, hoursPerUnit: undefined }),
    cap({ name: 'Mix', mu: 33.33, qty: 1.5, dayUnit: undefined, hoursPerUnit: undefined })] };
  const est = { ...QUOTE, activeRows: rows, totals: computeTotals(rows, DAY_PRICING, UNREG), days: [] };
  const f = cbFigures(buildCostBreakdownHtml(est, DAY_PRICING, {}));
  assert.ok(f.text.some((t) => /^Rounding/.test(t)));
  assert.deepEqual(f.total, [9999]);
  assert.equal(f.items.reduce((a, b) => a + b, 0), 9999);
  assert.ok(!cbFigures(buildCostBreakdownHtml(ALL_ON_DAYS(), DAY_PRICING, {})).text.some((t) => /^Rounding/.test(t)));
});

test('costBreakdownFilename: Cost Breakdown_<UPID>_<ProjectName>.pdf, filesystem-safe', () => {
  assert.equal(costBreakdownFilename(QUOTE), 'Cost Breakdown_UP-042_Brand film.pdf');
  assert.doesNotMatch(costBreakdownFilename({ ...QUOTE, name: 'Q3/Q4: "Recap"' }), /[/\\:*?"<>|]/);
  assert.equal(costBreakdownFilename({ name: 'X' }), 'Cost Breakdown_EST_X.pdf');
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

    // A current client's card carries the shape marker (calc.js PRICING_SHAPE).
    const saved = await api('/api/pricing', { method: 'PUT', body: JSON.stringify({ pricingShape: PRICING_SHAPE, ...PRICING }) });
    assert.equal(saved.status, 200);

    const created = await api('/api/estimates', {
      method: 'POST',
      body: JSON.stringify({
        name: QUOTE.name, upid: QUOTE.upid, date: QUOTE.date,
        client: QUOTE.client, activeRows: QUOTE.activeRows, pricingShape: PRICING_SHAPE,
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

    // The Cost Breakdown: its own route and filename, for an estimate with a day.
    const booked = await api(`/api/estimates/${created.estimate.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: QUOTE.name, upid: QUOTE.upid, date: QUOTE.date, client: QUOTE.client, pricingShape: PRICING_SHAPE,
        activeRows: { prod: [{ ...QUOTE.activeRows.prod[0], dayId: 'd_sat' }] },
        days: [{ id: 'd_sat', date: '2026-10-03', status: 'proposed', startTime: '13:00', endTime: '21:00' }],
      }),
    });
    assert.equal(booked.status, 200);
    const cbRes = await api(`/api/estimates/${created.estimate.id}/cost-breakdown`, { method: 'POST' });
    assert.equal(cbRes.status, 200);
    assert.equal(cbRes.headers.get('content-type'), 'application/pdf');
    assert.match(cbRes.headers.get('content-disposition'), /Cost Breakdown_UP-042_Brand film\.pdf/);
    assert.equal(Buffer.from(await cbRes.arrayBuffer()).subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(fs.readdirSync(path.join(TMP, 'exports')).includes('Cost Breakdown_UP-042_Brand film.pdf'));
    assert.equal((await api('/api/estimates/est_nope/cost-breakdown', { method: 'POST' })).status, 404);
  } finally {
    server.close();
    db.close();
  }
});

/* ── Day-built estimates (production-booking B2-2) ────────────────────────── */

test('client PDF: a hire line prints its Item; one saved before B2 prints its old text', () => {
  const est = {
    ...QUOTE,
    activeRows: {
      equip: [
        { vendor: 'Lensworks', item: 'Cine zoom kit', days: 2, cost: 150 },
        { vendor: 'Lens hire / Matte box', days: 1, cost: 90 },
        { vendor: 'Grip Co', item: '  ', days: 1, cost: 10 },
      ],
    },
  };
  const html = buildEstimateHtml(est, DAY_PRICING, {});
  const hire = html.slice(html.indexOf('Equipment Hire'));
  assert.match(hire, /Cine zoom kit.*Lens hire \/ Matte box.*Grip Co/s);
  assert.doesNotMatch(html, /Lensworks/);
  // The Cost Breakdown names it the same way.
  const cb = cbFigures(buildCostBreakdownHtml(bookedEstimate({ rows: est.activeRows, days: [] }), DAY_PRICING, {}));
  assert.deepEqual(cb.text.filter((t) => / days? at /.test(t)).map((t) => t.split(' · ')[0]), ['Cine zoom kit', 'Lens hire / Matte box', 'Grip Co']);
});

test('client PDF: an edit line prints its deliverable\'s current name, and a tag naming nothing prints none', () => {
  const edit = (name, extra) => ({ name, qty: 2, mu: 63, hoursPerUnit: 1, ...extra });
  const rows = (brandName) => ({
    deliverables: [{ id: 'dv1', name: brandName, qty: 1 }, { id: 'dv2', name: '', qty: 1 }],
    post: [
      edit('A-Roll Offline Edit', { deliverableId: 'dv1' }),
      edit('Project Setup', { deliverableId: 'dv_gone' }),
      edit('Socials Edit', { deliverableId: 'dv2' }),
      edit('Colour', { deliverableId: 'dv1', qty: 0 }),
      edit('Sound Mix'),
    ],
  });
  const tag = (name) => '<span style="font-weight:400;color:#888">&middot; ' + name + '</span>';
  const html = buildEstimateHtml({ ...QUOTE, activeRows: rows('Brand Story') }, DAY_PRICING, {});
  assert.ok(html.includes('A-Roll Offline Edit ' + tag('Brand Story') + '</div>'));
  assert.ok(html.includes('>Project Setup</div>'));
  assert.ok(html.includes('>Socials Edit</div>')); // its deliverable has no name to print
  assert.ok(html.includes('>Sound Mix</div>'));
  assert.doesNotMatch(html, /Colour/); // 0 hrs: off the document, tag and all
  // A rename follows to the document.
  const renamed = buildEstimateHtml({ ...QUOTE, activeRows: rows('Hero Film') }, DAY_PRICING, {});
  assert.ok(renamed.includes('A-Roll Offline Edit ' + tag('Hero Film') + '</div>'));
  assert.doesNotMatch(renamed, /Brand Story/);
});

test('client PDF: travel, crew and gear on a day stay in their own blocks; Production Days lists production only (D85)', () => {
  const est = bookedEstimate({
    rows: {
      prod: [cap({ dayId: 'd_sat' })],
      travel: [{ name: 'Crew Meals', qty: 3, mu: 30, rate: 30, dayId: 'd_sat' }],
      crew: [{ role: 'Gaffer', days: 1, cost: 600, dayId: 'd_sat' }],
      equip: [{ vendor: 'Lensworks', item: 'Cine zoom kit', days: 1, cost: 150, dayId: 'd_sat' }],
    },
    days: [SAT],
  });
  const html = buildEstimateHtml(est, DAY_PRICING, {});
  const days = html.slice(html.indexOf('Production Days'), html.indexOf('What Goes Into This Project'));
  assert.match(days, /Video Capture/);
  assert.doesNotMatch(days, /Crew Meals|Gaffer|Cine zoom kit/);
  const services = html.slice(html.indexOf('What Goes Into This Project'));
  assert.match(services, /Equipment Hire.*Cine zoom kit.*Travel &amp; Accommodation.*Crew Meals.*External Crew &amp; Contracts.*Gaffer/s);
  assert.doesNotMatch(services, /Video Capture/);
  // Only the production line is surcharged: $1,680 + 90 + 600 + 150.
  assert.equal(est.totals.totalIncGst, 2520);
});
