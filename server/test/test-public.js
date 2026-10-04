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
  // Issued on the day it was marked sent: the server's (Sydney) date, as the
  // send carried no `today`; not the test's fixed one.
  const { localToday } = require('../src/routes/projects');
  assert.deepEqual([e.kind, e.state, e.version, e.upid, e.name, e.issuedOn, e.validUntil],
    ['estimate', 'open', 1, est.upid, est.name, localToday(), '2026-11-03']);
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
  e = (await pub(token)).body.estimate;
  assert.equal(e.state, 'accepted');
  assert.deepEqual(e.days.map((d) => d.status), ['confirmed', 'confirmed'], 'accepted in the app reads the same');
  // The stored client view is untouched: it's the version as sent.
  const stored = JSON.parse(db.prepare('SELECT client_view_json FROM estimate_versions v JOIN estimates x ON x.id = v.estimate_id WHERE x.public_token = ? ORDER BY n DESC LIMIT 1').get(token).client_view_json);
  assert.deepEqual(stored.days.map((d) => d.status), ['pencilled', 'proposed']);
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

// ── Signing (task 27) ───────────────────────────────────────────────────────

const crypto = require('node:crypto');
const LIMITS = { all: { max: 10000, windowMs: 60000 }, pdf: { max: 10000, windowMs: 60000 }, sign: { max: 10000, windowMs: 60000 } };
/* A stand-in renderer: the HTML behind a PDF header, so a test can read what
   the PDF would say without Chromium. `renders` counts the calls. */
let renders = 0;
let renderFails = false;
let midRender = null;
const fakeRender = async (html) => {
  renders += 1;
  // A real render takes a while: long enough for a second submit, or another
  // project's booking, to arrive while it runs.
  await new Promise((resolve) => setTimeout(resolve, 25));
  if (midRender) midRender();
  if (renderFails) throw Object.assign(new Error('no chromium'), { code: 'pdf_unavailable' });
  return Buffer.from('%PDF-fake\n' + html);
};
let signUrl;
async function signer() {
  if (!signUrl) signUrl = await start({ renderPdf: fakeRender, publicLimits: LIMITS });
  return signUrl;
}
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const sign = async (token, body, headers = {}) => fetch(`${await signer()}/public/estimates/${token}/accept`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
}).then(json);
/* What the page sends: the agreement it was given, the version it shows. */
async function offer(token) {
  const e = (await pub(token, await signer())).body.estimate;
  return { e, body: { fullName: 'Priya Nair', role: 'Marketing lead', agree: true, version: e.version, key: e.agreement && e.agreement.key } };
}
const AGREEMENT = 'SERVICE AGREEMENT\nClient: {client_business} (ABN {client_abn})\nSignatory: {client_contact}, {signatory_role}\n' +
  'Total {total}. Deposit ({deposit_pct}): {deposit_amount}. Balance {balance_amount}, due {due_days} days.\nDays:\n{production_days}\n' +
  'Signed as {signatory_role} on {date}.';
const setAgreement = (text, extra = {}) => api('/api/settings', {
  method: 'PUT', body: JSON.stringify({ business: { name: 'LSC Creative', abn: '12345678901' }, agreement: { text }, ...extra }),
});

test('signing: the agreement is offered while open, signed as shown, and accepts the estimate (D39, D40, D18)', async () => {
  await setAgreement(AGREEMENT, { invoicing: { depositPct: 40 } });
  const est = await shoot();
  const { token } = await sent(est);
  // Edited after sending, not re-sent: the client signs, and is billed for, v1.
  await api(`/api/estimates/${est.id}`, { method: 'PUT', body: JSON.stringify({ ...est, name: 'Edited after', shortNotice: false }) });

  const { e, body } = await offer(token);
  assert.equal(e.state, 'open');
  assert.equal(e.signed, false);
  const { parts, key } = e.agreement;
  assert.equal(parts.length, 3, 'two gaps for the role');
  const shown = parts.join(body.role);
  assert.match(shown, /Signatory: Priya Nair, Marketing lead\n/);
  assert.match(shown, /Client: Saltwater Co\. \(ABN 51 824 753 556\)/);
  assert.match(shown, /Deposit \(40%\): \$[\d,]+\.\d\d\. Balance \$[\d,]+\.\d\d, due 14 days/);
  assert.match(shown, /Signed as Marketing lead on 4 October 2026\./);
  assert.match(key, /^[0-9a-f]{64}$/);

  renders = 0;
  const r = await sign(token, body, { 'user-agent': 'TestBrowser/1.0' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.estimate.state, r.body.estimate.signed, r.body.estimate.agreement], ['accepted', true, undefined]);
  // Sent as pencilled and proposed; accepted, the page reads them confirmed.
  assert.deepEqual(e.days.map((d) => d.status), ['pencilled', 'proposed']);
  assert.deepEqual(r.body.estimate.days.map((d) => d.status), ['confirmed', 'confirmed']);
  assert.equal(r.body.estimate.disclaimer, '');
  assert.equal(renders, 1);

  // The stored text is exactly what was shown, with its hash and the PDF of it.
  const s = db.prepare(`SELECT s.* FROM signatures s JOIN estimate_versions v ON v.id = s.version_id WHERE v.estimate_id = ?`).all(est.id);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].full_name, s[0].role, s[0].agreement_text, s[0].agreement_sha256, s[0].user_agent],
    ['Priya Nair', 'Marketing lead', shown, sha(shown), 'TestBrowser/1.0']);
  assert.ok(s[0].ip, 'the IP is recorded');
  const pdf = Buffer.from(s[0].pdf_blob).toString();
  assert.ok(pdf.startsWith('%PDF'));
  assert.ok(pdf.includes('Signatory: Priya Nair, Marketing lead'), 'the PDF prints the signed text');
  assert.ok(pdf.includes(sha(shown)));

  // The accept: the estimate accepted, every dated day confirmed, the pair at
  // the setting's 40% made from v1's totals, not the edit's.
  const f = (await folder(est.projectId)).body;
  const mine = f.estimates.find((x) => x.id === est.id);
  assert.equal(mine.status, 'accepted');
  assert.deepEqual(mine.days.map((d) => d.status), ['confirmed', 'confirmed']);
  assert.deepEqual(f.invoices.map((i) => [i.kind, i.number, i.status, i.pct]),
    [['deposit', `INV-${est.upid}-D`, 'draft', 40], ['final', `INV-${est.upid}-F`, 'draft', null]]);
  const snap = JSON.parse(db.prepare('SELECT estimate_snapshot_json FROM invoices WHERE project_id = ? AND kind = ?').get(est.projectId, 'deposit').estimate_snapshot_json);
  assert.deepEqual([snap.name, snap.totals.totalIncGst], [est.name, est.totals.totalIncGst], 'billed as sent');
  const dep = f.invoices.find((i) => i.kind === 'deposit');
  assert.ok(shown.includes('$' + dep.amountDue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')), 'the agreement’s deposit is the invoice’s');

  // One activity row, on Home too, and the signature in the folder.
  const log = f.activity.filter((a) => a.kind === 'signed');
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].detail, {
    estimateId: est.id, invoicing: 'pair', depositPct: 40, invoices: [`INV-${est.upid}-D`, `INV-${est.upid}-F`], rebook: [],
    version: 1, signatureId: s[0].id, signedBy: 'Priya Nair', role: 'Marketing lead',
  });
  assert.equal(f.activity.filter((a) => a.kind === 'accepted').length, 0);
  const home = (await api('/api/activity?limit=50').then(json)).body.activity;
  assert.ok(home.some((a) => a.kind === 'signed' && a.project.id === est.projectId));
  assert.deepEqual(f.signatures.map((x) => [x.id, x.version, x.fullName, x.role, x.estimateId]),
    [[s[0].id, 1, 'Priya Nair', 'Marketing lead', est.id]]);

  // The PDF opens for the owner and the client, the same bytes.
  const owner = await api(`/api/projects/${est.projectId}/agreements/${s[0].id}/pdf`);
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get('content-type'), 'application/pdf');
  assert.match(owner.headers.get('content-disposition'), /Service Agreement - PUB-\d+ v1 - Priya Nair\.pdf/);
  const client = await fetch(`${await signer()}/public/estimates/${token}/agreement`);
  assert.equal(client.status, 200);
  assert.deepEqual(Buffer.from(await client.arrayBuffer()), Buffer.from(await owner.arrayBuffer()));
  assert.equal((await api(`/api/projects/${est.projectId}x/agreements/${s[0].id}/pdf`)).status, 404, 'only under its own project');
  await setAgreement('');
});

test('signing: two submits at once make one signature and one set of invoices', async () => {
  const est = await shoot();
  const { token } = await sent(est);
  const { body } = await offer(token);
  const [a, b] = await Promise.all([sign(token, body), sign(token, body)]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.deepEqual([a.body.already, b.body.already].filter(Boolean), [true], 'one of them was the first');
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM signatures s JOIN estimate_versions v ON v.id = s.version_id WHERE v.estimate_id = ?`).get(est.id).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE project_id = ?').get(est.projectId).c, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM activity WHERE project_id = ? AND kind = 'signed'`).get(est.projectId).c, 1);
  // And again later: still the one signature, answered as accepted.
  const again = await sign(token, body);
  assert.deepEqual([again.status, again.body.already, again.body.estimate.state], [200, true, 'accepted']);
});

test('signing: refused once a proposed date is taken, or in any state but open (D41)', async () => {
  const est = await shoot();
  const { token } = await sent(est);
  const { body } = await offer(token);
  // While the client reads, another project confirms the proposed Tuesday.
  const other = await shoot({ days: [day('d_take', est.days[1].date, 'confirmed')], activeRows: { prod: [capture('d_take')] } });
  const r = await sign(token, body);
  assert.deepEqual([r.status, r.body.error, r.body.state], [409, 'not_open', 'taken']);
  const nothing = () => [
    db.prepare(`SELECT COUNT(*) AS c FROM signatures s JOIN estimate_versions v ON v.id = s.version_id WHERE v.estimate_id = ?`).get(est.id).c,
    db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE project_id = ?').get(est.projectId).c,
    db.prepare('SELECT status FROM estimates WHERE id = ?').get(est.id).status,
  ];
  assert.deepEqual(nothing(), [0, 0, 'sent']);
  assert.equal((await pub(token)).body.estimate.agreement, null, 'no agreement offered while taken');
  await act(other.projectId, 'decline');

  // Taken while the signed PDF was being made: checked again before storing.
  const fresh = (await offer(token)).body;
  midRender = () => db.prepare("UPDATE estimates SET status = 'sent' WHERE id = ?").run(other.id);
  const late = await sign(token, fresh);
  midRender = null;
  assert.deepEqual([late.status, late.body.state], [409, 'taken']);
  assert.deepEqual(nothing(), [0, 0, 'sent']);
  db.prepare("UPDATE estimates SET status = 'declined' WHERE id = ?").run(other.id);

  // Expired, declined: the same refusal.
  today = '2026-11-04';
  assert.deepEqual([(await sign(token, body)).body.state], ['expired']);
  today = '2026-10-04';
  await act(est.projectId, 'decline');
  assert.deepEqual([(await sign(token, body)).body.state], ['declined']);
  assert.deepEqual(nothing(), [0, 0, 'declined']);
  // Accepted in the app: no signature to offer, and nothing to sign.
  await act(est.projectId, 'reopen');
  await sent(est);
  await act(est.projectId, 'accept', { invoicing: 'single' });
  const after = await sign(token, (await offer(token)).body);
  assert.deepEqual([after.status, after.body.state], [409, 'accepted']);
  assert.equal((await pub(token)).body.estimate.signed, false);
  assert.equal((await fetch(`${await signer()}/public/estimates/${token}/agreement`)).status, 404);
});

test('signing: what must be typed, and a changed version or agreement asks for a re-read', async () => {
  const est = await shoot();
  const { token } = await sent(est);
  const { e, body } = await offer(token);
  const codes = async (patch) => {
    const r = await sign(token, { ...body, ...patch });
    return [r.status, r.body.error];
  };
  assert.deepEqual(await codes({ fullName: '  ' }), [400, 'name_required']);
  assert.deepEqual(await codes({ role: '' }), [400, 'role_required']);
  assert.deepEqual(await codes({ agree: 'yes' }), [400, 'agree_required']);
  assert.deepEqual(await codes({ fullName: 'x'.repeat(101) }), [400, 'too_long']);
  assert.deepEqual(await codes({ key: 'nope' }), [409, 'agreement_changed']);
  assert.deepEqual(await codes({ version: 0 }), [409, 'version_changed']);
  assert.equal((await sign('x'.repeat(43), body)).status, 404);

  // The owner edits the agreement while the client reads it: the client gets
  // the new text to read, and its key signs.
  await setAgreement('New terms for {client_business}, signed by {signatory_role}.');
  const r = await sign(token, body);
  assert.deepEqual([r.status, r.body.error], [409, 'agreement_changed']);
  assert.deepEqual(r.body.agreement.parts, ['New terms for Saltwater Co., signed by ', '.']);
  assert.notEqual(r.body.agreement.key, e.agreement.key);
  // A re-send while they read: a new version to look at first.
  await sent(est, '2026-11-21');
  const v = await sign(token, { ...body, key: r.body.agreement.key });
  assert.deepEqual([v.status, v.body.error], [409, 'version_changed']);
  const fresh = await offer(token);
  // Control characters and runs of spaces in what's typed come out as one space.
  const ok = await sign(token, { ...fresh.body, fullName: ' Priya \u0000 Nair\n', role: 'Head\tof  brand' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const s = db.prepare(`SELECT s.full_name, s.role, s.agreement_text FROM signatures s JOIN estimate_versions v ON v.id = s.version_id WHERE v.estimate_id = ?`).get(est.id);
  assert.deepEqual(s, { full_name: 'Priya Nair', role: 'Head of brand', agreement_text: 'New terms for Saltwater Co., signed by Head of brand.' });
  await setAgreement('');
});

test('signing: with no agreement written, the client accepts the estimate itself; nothing internal leaks', async () => {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({}) });
  const est = await shoot();
  const { token } = await sent(est);
  const raw = await (await fetch(`${await signer()}/public/estimates/${token}`)).text();
  assert.doesNotMatch(raw, FORBIDDEN);
  const { e, body } = await offer(token);
  assert.match(e.agreement.parts.join('Director'), new RegExp(`Saltwater Co\\. accepts estimate ${est.upid}, Harbour \\d+, for \\$[\\d,.]+, as set out in the estimate\\.[\\s\\S]*Priya Nair, Director, on 4 October 2026\\.`));
  const r = await fetch(`${await signer()}/public/estimates/${token}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: PAGES }, body: JSON.stringify(body),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), PAGES);
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
  const text = await r.text();
  assert.doesNotMatch(text, FORBIDDEN);
  keysOf(JSON.parse(text)).forEach((k) => assert.doesNotMatch(k, FORBIDDEN, k));
});

test('signing: the PDF renderer being down doesn\'t stop a signature; the PDF is made on first download', async () => {
  const est = await shoot();
  const { token } = await sent(est);
  renderFails = true;
  const r = await sign(token, (await offer(token)).body);
  renderFails = false;
  assert.equal(r.status, 200);
  const blob = () => db.prepare(`SELECT s.pdf_blob FROM signatures s JOIN estimate_versions v ON v.id = s.version_id WHERE v.estimate_id = ?`).get(est.id).pdf_blob;
  assert.equal(blob(), null);
  renders = 0;
  const pdf = await fetch(`${await signer()}/public/estimates/${token}/agreement`);
  assert.equal(pdf.status, 200);
  assert.ok(Buffer.from(await pdf.arrayBuffer()).toString().startsWith('%PDF'));
  assert.ok(blob(), 'kept');
  await fetch(`${await signer()}/public/estimates/${token}/agreement`);
  assert.equal(renders, 1, 'made once');
});

test('signing: a project that can\'t be invoiced yet is still accepted, with no invoices', async () => {
  const est = await shoot();
  const { token } = await sent(est);
  // An invoice number another invoice already holds (D36).
  db.prepare(`INSERT INTO invoices (id, project_id, kind, number, status, created_at, updated_at) VALUES ('inv_clash', ?, 'single', ?, 'draft', ?, ?)`)
    .run(est.projectId, `INV-${est.upid}-D`, nowIso(), nowIso());
  const r = await sign(token, (await offer(token)).body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  db.prepare("DELETE FROM invoices WHERE id = 'inv_clash'").run();
  const f = (await folder(est.projectId)).body;
  assert.deepEqual([f.project.acceptedAt !== null, f.invoices.length], [true, 0]);
  const log = f.activity.find((a) => a.kind === 'signed');
  assert.deepEqual([log.detail.invoices, log.detail.invoiceProblem], [[], 'invoice_number_taken']);
  // The owner then makes them as for any accepted project.
  assert.equal((await act(est.projectId, 'invoices', {})).status, 200);
});

test('signing: the real renderer makes a PDF that opens', async () => {
  const url = await start({ publicLimits: LIMITS });
  const est = await shoot();
  const { token } = await sent(est);
  const e = (await pub(token, url)).body.estimate;
  const r = await fetch(`${url}/public/estimates/${token}/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Priya Nair', role: 'Director', agree: true, version: e.version, key: e.agreement.key }),
  });
  assert.equal(r.status, 200);
  const pdf = await fetch(`${url}/public/estimates/${token}/agreement`);
  if (pdf.status === 503) return; // no Chromium on this machine
  assert.equal(pdf.status, 200);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 1000);
});

test('"today" on the client\'s pages is Sydney\'s, not the server\'s UTC', () => {
  const { localToday } = require('../src/routes/projects');
  // 7am on the 5th in Sydney (AEDT, UTC+11) is still the 4th in UTC.
  assert.equal(localToday(new Date('2026-10-04T20:00:00Z')), '2026-10-05');
  assert.equal(localToday(new Date('2026-10-04T12:59:00Z')), '2026-10-04');
  // Winter (AEST, UTC+10).
  assert.equal(localToday(new Date('2026-06-30T14:00:00Z')), '2026-07-01');
});
