'use strict';

/**
 * The client's routes (production-booking task 25): sending freezes a
 * version, and /public/estimates/:token serves its client view with a live
 * state. Its own server, so its rate limits and "today" don't touch
 * test-api.js's.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-public-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';
const PAGES = 'https://pages.example';
process.env.CORS_ORIGINS = PAGES;

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE } = require('../src/calc');

const PASSWORD = 'correct-horse-battery-staple';
let today = '2026-10-04';
let db;
let cookie;
const servers = [];

async function start(opts) {
  const app = createApp(db, { today: () => today, ...opts });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let base;
test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`INSERT INTO account (id, username, password_hash, created_at, updated_at) VALUES (1, 'lachlan', ?, ?, ?)`)
    .run(await hashPassword(PASSWORD), nowIso(), nowIso());
  base = await start({ publicLimits: { all: { max: 10000, windowMs: 60000 }, pdf: { max: 10000, windowMs: 60000 } } });
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
  await api('/api/pricing/reset', { method: 'POST' });
});

test.after(() => {
  servers.forEach((s) => s.close());
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function api(pathname, opts = {}) {
  let body = opts.body;
  if (body && /^\/api\/estimates(\/[^/]+)?$/.test(pathname)) body = JSON.stringify({ pricingShape: PRICING_SHAPE, ...JSON.parse(body) });
  return fetch(`${base}${pathname}`, { ...opts, body, headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) } });
}
const json = async (r) => ({ status: r.status, body: await r.json(), headers: r.headers });
const pub = (token, url = base, headers = {}) => fetch(`${url}/public/estimates/${token}`, { headers }).then(json);
const act = (id, action, body) => api(`/api/projects/${id}/${action}`, { method: 'POST', body: JSON.stringify(body || {}) }).then(json);
const folder = (id) => api(`/api/projects/${id}`).then(json);

/* A shoot with every kind of thing a client sees, and the internal figures a
   client mustn't: a Saturday after-hours day with short notice (so the totals
   carry a surcharge and the estimate a surcharge snapshot), a proposed day, a
   service off any day, a deliverable, gear hire. */
const capture = (dayId, extra) => ({ name: 'Video Capture', qty: 1, mu: 1120, dayUnit: 'full', hoursPerUnit: 8, ...(dayId ? { dayId } : {}), ...(extra || {}) });
const day = (id, date, status, extra) => ({ id, date, status, startTime: null, endTime: null, overrideNote: '', ...(extra || {}) });
let n = 0;
/* Each shoot its own Saturday (from 5 Dec 2026), and a proposed Tuesday after
   it, so an accept or a confirmed day in one test can't lock the next. */
const plusDays = (ymd, k) => new Date(Date.parse(ymd + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);
async function shoot(extra) {
  n += 1;
  const sat = plusDays('2026-12-05', 7 * n);
  const upid = 'PUB-' + n;
  const res = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Harbour ' + n,
      upid,
      client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example', phone: '0400 000 000', abn: '51824753556' },
      shortNotice: true,
      activeRows: {
        deliverables: [{ id: 'dl1', name: 'Brand film', format: '16:9', duration: '2–3 min', qty: 1 }],
        prod: [capture('d_sat_' + n), capture('d_prop_' + n, { name: 'Pick-up' })],
        post: [capture(null, { name: 'Edit', mu: 900, deliverableId: 'dl1' })],
        equip: [{ vendor: 'Hire Co', item: 'Drone package', days: 1, cost: 300 }],
      },
      days: [
        day('d_sat_' + n, sat, 'pencilled', { startTime: '16:00', endTime: '22:00' }),
        day('d_prop_' + n, plusDays(sat, 3), 'proposed'),
      ],
      ...(extra || {}),
    }),
  }).then(json);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.estimate;
}

async function sent(est, validUntil = '2026-11-03') {
  const r = await act(est.projectId, 'sent', { validUntil });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mine = r.body.estimates.find((e) => e.id === est.id);
  return { folder: r.body, token: mine.publicToken, versions: mine.versions };
}

const FORBIDDEN = /surcharge|floor|taxSetAside|overheadShare|estTakeHome|costBreakdown/i;
function keysOf(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.push(k); keysOf(x, out); });
  return out;
}

test('sending freezes v1: a 43-character link, and the client view the page reads', async () => {
  const est = await shoot();
  assert.ok(est.totals.surchargeTotal > 0, 'the fixture carries a surcharge');
  const { token, versions, folder: f } = await sent(est);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(versions.map((v) => [v.n, v.validUntil, v.supersededAt]), [[1, '2026-11-03', null]]);
  assert.deepEqual(f.activity[0].detail, { validUntil: '2026-11-03', estimateId: est.id, version: 1 });
  assert.equal(f.project.stageDetail.version, 1);

  const r = await pub(token);
  assert.equal(r.status, 200);
  const e = r.body.estimate;
  assert.deepEqual([e.kind, e.state, e.version, e.upid, e.name, e.issuedOn, e.validUntil],
    ['estimate', 'open', 1, est.upid, est.name, today, '2026-11-03']);
  assert.deepEqual(e.client, { businessName: 'Saltwater Co.', contactName: 'Priya Nair' }, 'no email, phone or ABN of the client');
  assert.deepEqual(e.deliverables, [{ name: 'Brand film', format: '16:9', duration: '2–3 min', qty: 1 }]);
  assert.deepEqual(e.days.map((d) => [d.date, d.status, d.startTime, d.endTime, d.items.map((i) => i.name)]), [
    [est.days[0].date, 'pencilled', '16:00', '22:00', ['Video Capture']],
    [est.days[1].date, 'proposed', null, null, ['Pick-up']],
  ]);
  // Each item at the price the client pays: the stored, surcharge-folded one.
  const stored = est.activeRows.prod.map((l) => l.surchargedPrice);
  assert.deepEqual(e.days.map((d) => d.items[0].price), stored);
  assert.ok(stored[0] > 1120, 'the Saturday line is dearer, and says nothing about why');
  assert.deepEqual(e.days[0].items[0].qty, '1 full day');
  const postLabel = JSON.parse(db.prepare('SELECT data_json FROM pricing WHERE id = 1').get().data_json)
    .labourSections.find((sec) => sec.id === 'post').label;
  assert.deepEqual(e.sections, [
    { label: postLabel, items: [{ name: 'Edit', tag: 'Brand film' }] },
    { label: 'Equipment Hire', items: [{ name: 'Drone package', tag: '' }] },
  ]);
  assert.deepEqual(e.totals, { treatment: 'none', exGst: est.totals.clientPriceExGst, gst: 0, total: est.totals.totalIncGst });
  assert.match(e.disclaimer, /proposed dates are not locked in/);
  assert.deepEqual([e.unavailableDays, e.latestToken], [[], null]);
  assert.equal(e.faqUrl, 'https://lsccreative.studio/faq.html');
});

test('the leak test: nothing owner-only in any public reply (Ground rules)', async () => {
  const est = await shoot();
  // Internal figures exist on the estimate…
  assert.ok(['floor', 'taxSetAside', 'estTakeHome', 'surchargeTotal'].some((k) => k in est.totals), Object.keys(est.totals).join());
  const { token } = await sent(est);
  const replies = [await fetch(`${base}/public/estimates/${token}`), await fetch(`${base}/public/estimates/nope`), await fetch(`${base}/public/other`)];
  for (const r of replies) {
    const text = await r.text();
    // …and none reach the client, as a key or anywhere in the text.
    assert.doesNotMatch(text, FORBIDDEN, r.url);
    keysOf(JSON.parse(text)).forEach((k) => assert.doesNotMatch(k, FORBIDDEN, k));
    assert.equal(r.headers.get('set-cookie'), null, 'no session is ever offered');
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  }
  // The stored client view is the same allow-list: nothing to leak later either.
  const view = db.prepare('SELECT client_view_json FROM estimate_versions v JOIN estimates e ON e.id = v.estimate_id WHERE e.public_token = ?').get(token);
  assert.doesNotMatch(view.client_view_json, FORBIDDEN);
});

test('a wrong, short or malformed link is the same 404, with nothing to tell them apart', async () => {
  const est = await shoot();
  const { token } = await sent(est);
  const wrong = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  const unsent = await shoot();
  const tries = [wrong, 'x', token.slice(0, 20), token + 'A', '%27%20OR%201%3D1', unsent.id];
  const answers = await Promise.all(tries.map((t) => fetch(`${base}/public/estimates/${t}`)));
  const shape = async (r) => [r.status, r.headers.get('content-type'), r.headers.get('content-length'), r.headers.get('cache-control'), await r.text()];
  const first = await shape(answers[0]);
  assert.deepEqual(first.slice(0, 1).concat(first.slice(4)), [404, '{"error":"not_found"}']);
  for (const r of answers.slice(1)) assert.deepEqual(await shape(r), first);
  // The same for the PDF.
  assert.equal((await fetch(`${base}/public/estimates/${wrong}/pdf`)).status, 404);

  // No timing tell: a malformed token isn't turned away early. Each is looked
  // up as given, so short and well-formed wrong ones take the same path.
  const time = async (t) => {
    const s = process.hrtime.bigint();
    for (let i = 0; i < 40; i += 1) await fetch(`${base}/public/estimates/${t}`).then((r) => r.text());
    return Number(process.hrtime.bigint() - s) / 40;
  };
  const [a, b] = [await time(wrong), await time('x')];
  assert.ok(Math.max(a, b) / Math.min(a, b) < 3, `wrong ${a}ns vs short ${b}ns`);
});

test('a re-send keeps the link: v2 replaces v1, which is kept and marked superseded (D34)', async () => {
  const est = await shoot();
  const one = await sent(est);
  // An edit after sending changes nothing the client sees until it's sent.
  const edited = await api(`/api/estimates/${est.id}`, { method: 'PUT', body: JSON.stringify({ ...est, name: 'Harbour, revised' }) }).then(json);
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.estimate.versions.map((v) => v.n), [1], 'the editor knows v1 went out');
  assert.equal((await pub(one.token)).body.estimate.name, est.name);

  const two = await sent(est, '2026-11-20');
  assert.equal(two.token, one.token, 'the same link');
  assert.deepEqual(two.versions.map((v) => [v.n, v.validUntil, Boolean(v.supersededAt)]), [[1, '2026-11-03', true], [2, '2026-11-20', false]]);
  const e = (await pub(two.token)).body.estimate;
  assert.deepEqual([e.version, e.name, e.validUntil, e.state], [2, 'Harbour, revised', '2026-11-20', 'open']);
  assert.equal(two.folder.activity[0].detail.version, 2);
  assert.equal(two.folder.project.stageDetail.version, 2);
});

test('each state: open, taken, expired, superseded, declined, accepted', async () => {
  // taken (D41): another project confirms a proposed day's date.
  const a = await shoot();
  const { token } = await sent(a);
  assert.equal((await pub(token)).body.estimate.state, 'open');
  const other = await shoot({ days: [day('d_other', a.days[1].date, 'confirmed')], activeRows: { prod: [capture('d_other')] } });
  let e = (await pub(token)).body.estimate;
  assert.deepEqual([e.state, e.unavailableDays], ['taken', [a.days[1].date]]);
  assert.deepEqual(e.days.map((d) => Boolean(d.unavailable)), [false, true]);
  // The other project declined: its confirmed day no longer holds the date.
  await act(other.projectId, 'decline');
  assert.equal((await pub(token)).body.estimate.state, 'open');

  // expired (D44): the day after valid-until. Expiry wins over taken.
  today = '2026-11-04';
  assert.equal((await pub(token)).body.estimate.state, 'expired');
  today = '2026-11-03';
  assert.equal((await pub(token)).body.estimate.state, 'open', 'valid through its last day');
  today = '2026-10-04';

  // declined (D22), then reopened: back to draft until sent again, so the old
  // link no longer offers Accept.
  await act(a.projectId, 'decline');
  assert.equal((await pub(token)).body.estimate.state, 'declined');
  await act(a.projectId, 'reopen');
  e = (await pub(token)).body.estimate;
  assert.deepEqual([e.state, e.latestToken], ['superseded', null]);
  await sent(a);
  assert.equal((await pub(token)).body.estimate.state, 'open');

  // accepted.
  const acc = await act(a.projectId, 'accept', { invoicing: 'single' });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal((await pub(token)).body.estimate.state, 'accepted');
});

test('superseded by another estimate in the project points at the newer link', async () => {
  const a = await shoot();
  const b = await shoot();
  // Two estimates in one project, as the v13 fix-up's "keep together" leaves them.
  db.prepare('UPDATE estimates SET project_id = ?, upid = ? WHERE id = ?').run(a.projectId, a.upid, b.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(b.projectId);
  db.prepare("UPDATE estimates SET updated_at = '2000-01-01' WHERE id = ?").run(b.id);
  const first = await sent(a);
  assert.ok(first.token);
  db.prepare("UPDATE estimates SET updated_at = '2999-01-01' WHERE id = ?").run(b.id);
  const r = await act(a.projectId, 'sent', { validUntil: '2026-11-10' });
  const bToken = r.body.estimates.find((x) => x.id === b.id).publicToken;
  assert.ok(bToken && bToken !== first.token);
  const e = (await pub(first.token)).body.estimate;
  assert.deepEqual([e.state, e.latestToken], ['superseded', bToken]);
  assert.equal((await pub(bToken)).body.estimate.state, 'open');
});

test('CORS for the Pages origin, without credentials; none for any other', async () => {
  const est = await shoot();
  const { token } = await sent(est);
  const ok = await fetch(`${base}/public/estimates/${token}`, { headers: { origin: PAGES } });
  assert.equal(ok.headers.get('access-control-allow-origin'), PAGES);
  assert.equal(ok.headers.get('access-control-allow-credentials'), null);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const pre = await fetch(`${base}/public/estimates/${token}`, { method: 'OPTIONS', headers: { origin: PAGES } });
  assert.deepEqual([pre.status, pre.headers.get('access-control-allow-credentials')], [204, null]);
  const evil = await fetch(`${base}/public/estimates/${token}`, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  // The owner's API keeps its credentialed CORS.
  const owner = await fetch(`${base}/api/session`, { headers: { origin: PAGES } });
  assert.equal(owner.headers.get('access-control-allow-credentials'), 'true');
});

test('rate limiting: past the limit a client gets 429 with Retry-After; the owner is untouched', async () => {
  const limited = await start({ publicLimits: { all: { max: 3, windowMs: 60000 }, pdf: { max: 1, windowMs: 60000 } } });
  const codes = [];
  for (let i = 0; i < 5; i += 1) codes.push((await fetch(`${limited}/public/estimates/nope`)).status);
  assert.deepEqual(codes, [404, 404, 404, 429, 429]);
  const r = await fetch(`${limited}/public/estimates/nope`);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal((await r.json()).error, 'rate_limited');
  assert.equal((await fetch(`${limited}/health`)).status, 200);
});

test('the PDF prints the version that was sent, not today\'s edits', async () => {
  const est = await shoot();
  const { token } = await sent(est);
  await api(`/api/estimates/${est.id}`, { method: 'PUT', body: JSON.stringify({ ...est, name: 'Edited after' }) });
  const { publicPdfSource } = require('../src/public');
  const src = publicPdfSource(db, token);
  assert.deepEqual([src.n, src.estimate.name, src.estimate.docType], [1, est.name, 'estimate']);
  const r = await fetch(`${base}/public/estimates/${token}/pdf`);
  if (r.status === 503) return; // no Chromium on this machine: the route still answered as it should
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
});

test('opening the link logs "opened" once a day per version, and Home shows it (task 26, D52)', async () => {
  let clock = '2026-10-05T01:00:00.000Z';
  const url = await start({ now: () => clock, publicLimits: { all: { max: 10000, windowMs: 60000 }, pdf: { max: 10000, windowMs: 60000 } } });
  const est = await shoot();
  const { token } = await sent(est);
  const opened = () => db.prepare(`SELECT at, detail_json FROM activity WHERE project_id = ? AND kind = 'opened' ORDER BY at`)
    .all(est.projectId).map((r) => [r.at, JSON.parse(r.detail_json)]);
  // The log is written after the reply goes; a beat lets it land.
  const open = async (t = token) => {
    const r = await pub(t, url);
    await new Promise((resolve) => setImmediate(resolve));
    return r;
  };

  assert.equal((await open()).status, 200);
  assert.deepEqual(opened(), [[clock, { estimateId: est.id, version: 1 }]]);
  // Reloads the same day are the same open.
  clock = '2026-10-05T23:30:00.000Z';
  await open();
  await open();
  assert.equal(opened().length, 1);
  // A day after the last one logged, it counts again.
  clock = '2026-10-06T01:00:01.000Z';
  await open();
  assert.equal(opened().length, 2);
  // A new version is a new thing to open, minutes after the last open.
  await sent(est, '2026-11-20');
  clock = '2026-10-06T01:05:00.000Z';
  await open();
  assert.deepEqual(opened().map(([, d]) => d.version), [1, 1, 2]);
  // A wrong link logs nothing anywhere.
  const before = db.prepare(`SELECT COUNT(*) AS c FROM activity WHERE kind = 'opened'`).get().c;
  assert.equal((await open(token.slice(0, -2) + 'zz')).status, 404);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM activity WHERE kind = 'opened'`).get().c, before);

  // Home's Recent activity carries it, opening the project.
  const home = await api('/api/activity?limit=50').then(json);
  const mine = home.body.activity.filter((a) => a.kind === 'opened' && a.project.id === est.projectId);
  assert.deepEqual(mine.map((a) => a.detail.version), [2, 1, 1]);
});
