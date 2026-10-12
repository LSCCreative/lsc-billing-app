'use strict';

/**
 * Sharing the call sheet (.design/trip-planner/ task 11; T12, T13): the
 * Project page's row facts on the folder reply, the email route, and the
 * email crew get. A stub transport stands in for SMTP; Google is never called
 * (the email needs no map).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-cs-share-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'https://pages.example';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { PRICING_SHAPE, tripLineQty } = require('../src/calc');
const { createMailer, callSheetEmail } = require('../src/mail');
const { markup } = require('../src/call-sheet');
const { buildCallSheetHtml } = require('../src/pdf');

const PASSWORD = 'correct-horse-battery-staple';
const APP_URL = 'https://pages.example/lsc/';
const MAIL_CFG = { smtp: { host: 'smtp.example', port: 587, user: 'u', pass: 'SMTP-KEY-NEVER-SHOWN' }, mailFrom: 'LSC <hi@lsc.example>' };

let db;
let cookie;
let base; // email connected
let offline; // email not set up
let noUrl; // email connected, no APP_URL
const servers = [];
const mail = [];
let refuse = null; // an address the stub provider refuses

const transport = {
  async sendMail(m) {
    if (refuse && m.to === refuse) throw new Error('550 mailbox unavailable');
    mail.push(m);
    return { messageId: '<x@test>' };
  },
};

async function start(opts) {
  const app = createApp(db, { mapsKey: '', ...opts });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`INSERT INTO account (id, username, password_hash, created_at, updated_at) VALUES (1, 'lachlan', ?, ?, ?)`)
    .run(await hashPassword(PASSWORD), nowIso(), nowIso());
  const mailer = createMailer(MAIL_CFG, { transport });
  base = await start({ appUrl: APP_URL, mailer });
  offline = await start({ appUrl: APP_URL });
  noUrl = await start({ appUrl: '', mailer });
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
  await api('/api/pricing/reset', { method: 'POST' });
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ business: { name: 'LSC Creative', abn: '12345678901', email: 'hello@lsc.example', phone: '0412 000 000' } }),
  });
});

test.after(() => {
  servers.forEach((s) => s.close());
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function api(pathname, opts = {}, url = base) {
  let body = opts.body;
  if (body && /^\/api\/estimates(\/[^/]+)?$/.test(pathname)) body = JSON.stringify({ pricingShape: PRICING_SHAPE, ...JSON.parse(body) });
  const res = await fetch(`${url}${pathname}`, { ...opts, body, headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const link = (id, on) => api(`/api/estimates/${id}/call-sheet/link`, { method: 'POST', body: JSON.stringify({ on }) });
const email = (id, body, url = base) => api(`/api/estimates/${id}/call-sheet/email`, { method: 'POST', body: JSON.stringify(body) }, url);
const folder = (projectId) => api(`/api/projects/${projectId}?today=2026-10-10`);

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const HOME = { address: '1 Home St, Marrickville NSW', lat: -33.91, lng: 151.15, placeId: 'p_home' };
const trip = (km) => ({
  stops: [
    { id: 's0', role: 'start', ...HOME },
    { id: 's1', role: 'stop', address: 'Bondi Pavilion, Bondi Beach NSW', lat: -33.8915, lng: 151.2767, details: { access: 'Gate code 4417' } },
    { id: 's2', role: 'return' },
  ],
  legs: [
    { km: km / 2, minutes: 31, departAt: '07:00', arriveAt: '07:31' },
    { km: km / 2, minutes: 31, departAt: '09:00', arriveAt: '09:31' },
  ],
  totals: { km, minutes: 62 },
  polyline: '',
  routedFor: { date: '2026-11-03', startTime: '07:00', traffic: true },
});
const day = (id, date, t) => ({
  id, date, status: 'pencilled', startTime: date ? '07:00' : null, endTime: date ? '17:00' : null, overrideNote: '',
  ...(t === undefined ? {} : { trip: t }),
});

let counter = 0;
async function create(days) {
  counter += 1;
  const res = await api('/api/estimates', {
    method: 'POST',
    body: JSON.stringify({
      name: `Harbour shoot ${counter}`,
      upid: `CSS-${counter}`,
      client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' },
      activeRows: {},
      days,
    }),
  });
  assert.equal(res.status, 201, res.text);
  return res.body.estimate;
}

/* ── The folder's row facts ───────────────────────────────────────────────── */

test('the folder gives each estimate its call sheet facts: null with no trip, else days, km and the link', async () => {
  const none = await create([day('ns_a', '2026-11-03')]);
  let f = await folder(none.projectId);
  assert.equal(f.status, 200, f.text);
  assert.equal(f.body.estimates[0].callSheet, null);

  // A start alone is no trip.
  const startOnly = await create([day('so_a', '2026-11-03', { stops: [{ id: 's0', role: 'start', ...HOME }] })]);
  f = await folder(startOnly.projectId);
  assert.equal(f.body.estimates[0].callSheet, null);

  // Each day as its km line bills it (31, 82), added up: 113, not 111.7 rounded.
  const est = await create([day('fs_a', '2026-11-03', trip(30.4)), day('fs_b', '2026-11-04', trip(81.3)), day('fs_c', '2026-11-05')]);
  f = await folder(est.projectId);
  assert.deepEqual(f.body.estimates[0].callSheet, { days: 2, km: 113, on: false, token: null });

  const on = await link(est.id, true);
  f = await folder(est.projectId);
  assert.deepEqual(f.body.estimates[0].callSheet, { days: 2, km: 113, on: true, token: on.body.token });

  // Off keeps the token, and on again gives the same one.
  await link(est.id, false);
  f = await folder(est.projectId);
  assert.deepEqual(f.body.estimates[0].callSheet, { days: 2, km: 113, on: false, token: on.body.token });
  const again = await link(est.id, true);
  assert.equal(again.body.token, on.body.token);
});

test('one km rule on every surface: each day as its line bills it, the sheet\'s total their sum (task 17 should-fix)', async () => {
  // The design review's days: 108.778 km and 32.717 km once said 109 and 33
  // on the days but 141 on the sheet (141.495 rounded).
  const a = trip(108.778);
  const b = trip(32.717);
  assert.deepEqual([tripLineQty(a, 'km'), tripLineQty(b, 'km')], [109, 33], 'what the km lines bill');
  const est = await create([day('kr_a', '2026-11-03', a), day('kr_b', '2026-11-04', b)]);
  const f = await folder(est.projectId);
  assert.equal(f.body.estimates[0].callSheet.km, 142, 'the Project page\'s Call sheet row');

  const owner = await api(`/api/estimates/${est.id}/call-sheet`);
  const cs = owner.body.callSheet;
  assert.deepEqual(cs.days.map((d) => d.totals.km), [109, 33], 'each day on the sheet');
  assert.deepEqual(cs.summary, { days: 2, km: 142 });
  const on = await link(est.id, true);
  const pub = await api(`/public/call-sheets/${on.body.token}`);
  assert.deepEqual(pub.body.callSheet.summary, { days: 2, km: 142 }, 'the public page');

  // The page and the PDF draw those figures as they are.
  for (const html of [markup(cs), buildCallSheetHtml(cs)]) {
    assert.match(html, /2 days · 142 km/);
    assert.match(html, /\b109 km\b/);
    assert.match(html, /\b33 km\b/);
    assert.doesNotMatch(html, /141 km/);
  }
});

/* ── The email route ──────────────────────────────────────────────────────── */

test('emailing sends each person their own copy of the link, and the folder logs who it reached', async () => {
  const est = await create([day('em_a', '2026-11-03', trip(30)), day('em_b', null, trip(12))]);
  const on = await link(est.id, true);
  mail.length = 0;

  const res = await email(est.id, { to: [' crew@one.example ', 'Crew@One.example', 'grip@two.example'], note: 'Call time 6:30.\n\nBring the long lens.' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.sent, ['crew@one.example', 'grip@two.example'], 'trimmed, and a repeat in another case dropped');
  assert.deepEqual(res.body.failed, []);
  assert.equal(mail.length, 2);
  assert.deepEqual(mail.map((m) => m.to), ['crew@one.example', 'grip@two.example'], 'one email each: no one sees the others');

  const m = mail[0];
  const url = `${APP_URL}c/#s/${on.body.token}`;
  assert.equal(m.subject, `Call sheet · CSS-${counter} · Harbour shoot ${counter}`);
  assert.ok(m.text.includes(url) && m.html.includes(url), 'the link is in both parts');
  assert.ok(m.text.includes('Tue 3 Nov and 1 day still to be dated'), m.text);
  assert.ok(m.text.includes('Bring the long lens.'));
  assert.ok(m.html.includes('Call time 6:30.') && m.html.includes('View the call sheet'));
  assert.ok(!/\$\d/.test(m.text + m.html), 'never a price');
  assert.ok(!(m.text + m.html).includes('SMTP-KEY'), 'never the key');

  const f = await folder(est.projectId);
  const logged = f.body.activity.find((a) => a.kind === 'call_sheet_sent');
  assert.ok(logged, 'logged in the folder');
  assert.deepEqual(logged.detail.to, ['crew@one.example', 'grip@two.example']);
});

test('one address the provider refuses doesn’t stop the rest; the reply says which', async () => {
  const est = await create([day('pf_a', '2026-11-03', trip(30))]);
  await link(est.id, true);
  mail.length = 0;
  refuse = 'bounce@bad.example';
  try {
    const res = await email(est.id, { to: ['bounce@bad.example', 'ok@good.example'] });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.sent, ['ok@good.example']);
    assert.equal(res.body.failed.length, 1);
    assert.equal(res.body.failed[0].to, 'bounce@bad.example');
    assert.match(res.body.failed[0].message, /550/);
  } finally {
    refuse = null;
  }

  // Nothing reached anyone: nothing logged.
  refuse = 'only@bad.example';
  try {
    const before = (await folder(est.projectId)).body.activity.filter((a) => a.kind === 'call_sheet_sent').length;
    const res = await email(est.id, { to: ['only@bad.example'] });
    assert.deepEqual(res.body.sent, []);
    const after = (await folder(est.projectId)).body.activity.filter((a) => a.kind === 'call_sheet_sent').length;
    assert.equal(after, before);
  } finally {
    refuse = null;
  }
});

test('the email route refuses what it can’t send, and sends nothing', async () => {
  const est = await create([day('rf_a', '2026-11-03', trip(30))]);
  mail.length = 0;

  assert.equal((await email('est_nope', { to: ['a@b.example'] })).status, 404);

  let res = await email(est.id, { to: ['a@b.example'] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'link_off', 'never shared');

  await link(est.id, true);
  res = await email(est.id, { to: ['a@b.example'] }, offline);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'not_configured');

  res = await email(est.id, { to: ['a@b.example'] }, noUrl);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'no_app_url');

  for (const [body, code] of [
    [{}, 'bad_recipient'],
    [{ to: [] }, 'bad_recipient'],
    [{ to: 'a@b.example' }, 'bad_recipient'],
    [{ to: ['  '] }, 'bad_recipient'],
    [{ to: ['a@b.example', 'not-an-address'] }, 'bad_recipient'],
    [{ to: Array.from({ length: 21 }, (_, i) => `p${i}@crew.example`) }, 'too_many_recipients'],
    [{ to: ['a@b.example'], note: 7 }, 'note_invalid'],
    [{ to: ['a@b.example'], note: 'x'.repeat(2001) }, 'note_invalid'],
  ]) {
    res = await email(est.id, body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(res.body.error, code);
  }
  res = await email(est.id, { to: ['a@b.example', 'not-an-address'] });
  assert.match(res.body.message, /not-an-address/, 'names the bad one');

  // Turned off again: refused, though the token is kept.
  await link(est.id, false);
  assert.equal((await email(est.id, { to: ['a@b.example'] })).body.error, 'link_off');

  // On, but its trips were cleared meanwhile.
  await link(est.id, true);
  const put = await api(`/api/estimates/${est.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: est.name, upid: est.upid, client: est.client, activeRows: {}, days: [day('rf_a', '2026-11-03', null)] }),
  });
  assert.equal(put.status, 200, put.text);
  assert.equal((await email(est.id, { to: ['a@b.example'] })).body.error, 'no_trips');

  assert.equal(mail.length, 0, 'nothing went');
});

/* ── The template ─────────────────────────────────────────────────────────── */

test('the call sheet email names the days in plain words and keeps the note as text', () => {
  const m = callSheetEmail({
    businessName: 'LSC Creative', upid: 'AB-1', projectName: 'Shoot <b>', note: '<script>x</script>',
    link: 'https://x.example/c/#s/t', dates: ['2026-11-03', '2026-11-04', null, null],
  });
  assert.equal(m.subject, 'Call sheet · AB-1 · Shoot <b>');
  assert.ok(m.text.includes('Tue 3 Nov, Wed 4 Nov and 2 days still to be dated'), m.text);
  assert.ok(!m.html.includes('<script>') && m.html.includes('&lt;script&gt;'), 'the note is escaped');
  assert.ok(!m.html.includes('Shoot <b>'), 'so is the project name');

  const bare = callSheetEmail({ link: 'https://x.example/c/#s/t', dates: ['2026-11-03'] });
  assert.equal(bare.subject, 'Call sheet');
  assert.ok(bare.text.startsWith('LSC Creative has shared the call sheet: Tue 3 Nov.'), bare.text);
});
