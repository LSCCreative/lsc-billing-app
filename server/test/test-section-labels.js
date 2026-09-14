'use strict';

/* The labour category label is a heading on the client-facing PDF, so it is
 * part of the document, not a view of the current rate card.
 *
 * Before the Pricing screen existed the rate card could never change, so
 * reading the label live was indistinguishable from snapshotting it. Wiring
 * Pricing up made rename and delete reachable, and both rewrote the headings on
 * quotes that had already been sent. These tests pin the snapshot down.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-section-labels-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { buildEstimateHtml } = require('../src/pdf');
const { sectionLabelsFor } = require('../src/ratecard');
const { loadEstimate } = require('../src/estimate');

const PASSWORD = 'correct-horse-battery-staple';
const USERNAME = 'lachlan';

const CARD = {
  labourSections: [
    { id: 'prod', label: 'Production', rows: [{ name: 'Video Capture', rate: 100, mu: 140 }] },
    { id: 'post', label: 'Post-Production', rows: [{ name: 'Photo Editor', rate: 110, mu: 154 }] },
  ],
  travelRows: [],
  taxSetAsideRate: 0.35,
};

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

const saveCard = (card) => api('/api/pricing', { method: 'PUT', body: JSON.stringify(card) });

function newEstimate(name, activeRows) {
  return api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({ upid: 'LSC-' + name, name, activeRows }),
  }).then((r) => r.json());
}

const ROWS = { prod: [{ name: 'Video Capture', qty: 2 }] };

test('a saved estimate records what its categories were called', async () => {
  await saveCard(CARD);
  const { estimate } = await newEstimate('snapshot-taken', ROWS);
  assert.deepEqual(estimate.sectionLabels, { prod: 'Production' });
});

test('only the categories the estimate actually uses are recorded', async () => {
  await saveCard(CARD);
  const { estimate } = await newEstimate('unused-not-recorded', ROWS);
  // 'post' is on the card but this estimate has no rows in it.
  assert.equal(estimate.sectionLabels.post, undefined);
  // Nor are the non-labour buckets, which have fixed headings of their own.
  const { estimate: withExpenses } = await newEstimate('reserved-not-recorded', {
    ...ROWS,
    crew: [{ role: 'Gaffer', days: 1, cost: 500 }],
    travel: [],
    deliverables: [],
  });
  assert.deepEqual(withExpenses.sectionLabels, { prod: 'Production' });
});

/* The case that motivated all of this. */
test('renaming a category does not re-head an estimate already saved under the old name', async () => {
  await saveCard(CARD);
  const { estimate } = await newEstimate('rename-victim', ROWS);

  await saveCard({
    ...CARD,
    labourSections: [
      { id: 'prod', label: 'Filming', rows: [{ name: 'Video Capture', rate: 100, mu: 140 }] },
      CARD.labourSections[1],
    ],
  });

  const reread = await api(`/api/estimates/${estimate.id}`).then((r) => r.json());
  assert.deepEqual(reread.estimate.sectionLabels, { prod: 'Production' });

  const html = buildEstimateHtml(reread.estimate, await pricingNow(), {});
  assert.match(html, /Production/);
  assert.doesNotMatch(html, /Filming/);
});

test('deleting a category leaves the estimate its heading, not "Archived Services"', async () => {
  await saveCard(CARD);
  const { estimate } = await newEstimate('delete-victim', ROWS);

  await saveCard({ ...CARD, labourSections: [CARD.labourSections[1]] });

  const reread = await api(`/api/estimates/${estimate.id}`).then((r) => r.json());
  const html = buildEstimateHtml(reread.estimate, await pricingNow(), {});
  assert.match(html, /Production/);
  assert.doesNotMatch(html, /Archived Services/);
});

/* Saving is re-quoting: the client fields are re-snapshotted from the form on
   the same request, so the headings should agree with them rather than stay
   frozen at whatever the first save saw. */
test('re-saving an estimate adopts the rate card as it stands now', async () => {
  await saveCard(CARD);
  const { estimate } = await newEstimate('resave', ROWS);

  await saveCard({
    ...CARD,
    labourSections: [
      { id: 'prod', label: 'Filming', rows: [{ name: 'Video Capture', rate: 100, mu: 140 }] },
    ],
  });

  const updated = await api(`/api/estimates/${estimate.id}`, {
    method: 'PUT',
    body: JSON.stringify({ upid: estimate.upid, name: estimate.name, activeRows: ROWS }),
  }).then((r) => r.json());

  assert.deepEqual(updated.estimate.sectionLabels, { prod: 'Filming' });
});

/* ...but a category that is gone from the card has no current name to adopt,
   and the estimate holds the only remaining record of it. Editing an old
   estimate must not be what finally erases it. */
test('editing an estimate keeps the label of a category since deleted', async () => {
  await saveCard(CARD);
  const { estimate } = await newEstimate('edit-after-delete', ROWS);

  await saveCard({ ...CARD, labourSections: [CARD.labourSections[1]] });

  const updated = await api(`/api/estimates/${estimate.id}`, {
    method: 'PUT',
    body: JSON.stringify({ upid: estimate.upid, name: 'renamed job', activeRows: ROWS }),
  }).then((r) => r.json());

  assert.deepEqual(updated.estimate.sectionLabels, { prod: 'Production' });
});

test('a duplicate inherits the original document’s headings', async () => {
  await saveCard(CARD);
  const { estimate } = await newEstimate('to-duplicate', ROWS);

  await saveCard({
    ...CARD,
    labourSections: [
      { id: 'prod', label: 'Filming', rows: [{ name: 'Video Capture', rate: 100, mu: 140 }] },
    ],
  });

  const copy = await api(`/api/estimates/${estimate.id}/duplicate`, { method: 'POST' })
    .then((r) => r.json());
  assert.deepEqual(copy.estimate.sectionLabels, { prod: 'Production' });
});

/* Estimates written before the migration carry '{}'. They must keep rendering
   exactly as they did, which means falling back to the live card. */
test('an estimate saved before the snapshot existed still reads the live card', () => {
  const legacy = {
    name: 'pre-migration',
    docType: 'estimate',
    client: {},
    activeRows: ROWS,
    sectionLabels: {},
    totals: { totalIncGst: 280 },
  };
  const html = buildEstimateHtml(legacy, CARD, {});
  assert.match(html, /Production/);
});

/* The snapshot was reaching the API and not the PDF, because routes/pdf.js kept
   its own row mapper that predated the column. Both routes now read a row
   through src/estimate.js; this pins the field to that one definition, since a
   mapper that drops it renders a document with the wrong headings and nothing
   else fails. */
test('the shared row mapper carries the snapshot every route reads', async () => {
  await saveCard(CARD);
  const { estimate } = await newEstimate('mapper', ROWS);
  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimate.id);
  assert.deepEqual(loadEstimate(row).sectionLabels, { prod: 'Production' });
});

test('sectionLabelsFor ignores empty categories and unknown ids without a label', () => {
  assert.deepEqual(sectionLabelsFor({ prod: [] }, CARD, null), {});
  assert.deepEqual(sectionLabelsFor({ ghost: [{ name: 'x' }] }, CARD, null), {});
  assert.deepEqual(sectionLabelsFor({ ghost: [{ name: 'x' }] }, CARD, { ghost: 'Old Name' }), {
    ghost: 'Old Name',
  });
  assert.deepEqual(sectionLabelsFor(null, CARD, null), {});
});

function pricingNow() {
  return api('/api/pricing').then((r) => r.json()).then((r) => r.pricing);
}
