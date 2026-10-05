'use strict';

/**
 * The send panel's routes (production-booking task 29, D43, D47): an estimate
 * or invoice emailed now or later, or made live for "Copy link", and what
 * that does to the document. A stub transport stands in for SMTP.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-send-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { createMailer } = require('../src/mail');
const { PRICING_SHAPE } = require('../src/calc');
const { sydneyDate } = require('../src/sends');

const PASSWORD = 'correct-horse-battery-staple';
const MAIL_CFG = { smtp: { host: 'h', port: 465, user: 'resend', pass: 're_KEY' }, mailFrom: 'admin@lsccreative.studio', mailReplyTo: 'owner@example.com' };
let db;
let cookie;
let base; // email connected, through `mail`
let offline; // email not set up
const servers = [];
const mail = [];
let failing = false;
const transport = {
  async sendMail(m) {
    if (failing) throw new Error('connect ECONNREFUSED');
    mail.push(m);
    return { messageId: '<x@test>' };
  },
};

async function start(opts) {
  const app = createApp(db, opts);
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
  base = await start({ appUrl: 'https://pages.example/app/', mailer: createMailer(MAIL_CFG, { transport }) });
  offline = await start({});
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

function api(pathname, opts = {}, url = base) {
  let body = opts.body;
  if (body && /^\/api\/estimates$/.test(pathname)) body = JSON.stringify({ pricingShape: PRICING_SHAPE, ...JSON.parse(body) });
  return fetch(`${url}${pathname}`, { ...opts, body, headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) } });
}
const json = async (r) => ({ status: r.status, body: await r.json() });
const post = (p, b, url) => api(p, { method: 'POST', body: JSON.stringify(b || {}) }, url).then(json);
const put = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b || {}) }).then(json);
const settle = async (check) => { for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 10)); };

const DAY = 86400e3;
const dayIn = (k) => sydneyDate(new Date(Date.now() + k * DAY).toISOString());
const at = (k) => new Date(Date.now() + k * DAY).toISOString();
const today = dayIn(0);

let n = 0;
async function estimate() {
  n += 1;
  const r = await post('/api/estimates', {
    name: 'Harbour ' + n,
    upid: 'SND-' + n,
    client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' },
    activeRows: { post: [{ name: 'Edit', qty: 1, mu: 900, dayUnit: 'full', hoursPerUnit: 8 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.estimate;
}
const send = (est, body, url) => post(`/api/projects/${est.projectId}/send?today=${today}`, body, url);
const email = (extra) => ({ by: 'email', to: 'priya@salt.example', message: 'Hi Priya', validUntil: dayIn(30), ...(extra || {}) });
const rowsOf = (docId) => db.prepare("SELECT * FROM sends WHERE doc_id = ? AND purpose = 'document' ORDER BY created_at, id").all(docId);

test('estimate, now: confirming freezes v1, queues the email and sends it with the link and message', async () => {
  const est = await estimate();
  mail.length = 0;
  const r = await send(est, email());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent.version, 1);
  assert.match(r.body.sent.token, /^[A-Za-z0-9_-]{43}$/);
  const mine = r.body.estimates.find((e) => e.id === est.id);
  assert.deepEqual([mine.status, mine.versions.length, mine.versions[0].validUntil], ['sent', 1, dayIn(30)]);
  assert.equal(r.body.project.stage, 'sent');
  const logged = r.body.activity[0];
  assert.deepEqual([logged.kind, logged.detail.by, logged.detail.to, logged.detail.version, logged.detail.scheduledFor],
    ['sent', 'email', 'priya@salt.example', 1, undefined]);

  await settle(() => mail.length === 1);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'priya@salt.example');
  assert.match(mail[0].text, /Hi Priya/);
  assert.match(mail[0].text, new RegExp(`https://pages\\.example/app/c/#e/${r.body.sent.token}`));
  const [row] = rowsOf(est.id);
  assert.equal(row.status, 'sent');
  assert.ok(row.version_id, 'the send names the version it sends');
  const folder = await api(`/api/projects/${est.projectId}?today=${today}`).then(json);
  assert.deepEqual([folder.body.estimates[0].send.status, folder.body.estimates[0].send.late, folder.body.estimates[0].send.version], ['sent', false, 1]);
});

test('estimate, later: it waits; nothing else can be sent until it is changed or cancelled (D47)', async () => {
  const est = await estimate();
  mail.length = 0;
  const when = at(2);
  const r = await send(est, email({ scheduledFor: when, validUntil: dayIn(32) }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.activity[0].detail.scheduledFor, when);
  // Issued, and valid from, the day it goes.
  const version = db.prepare('SELECT client_view_json FROM estimate_versions WHERE estimate_id = ?').get(est.id);
  assert.equal(JSON.parse(version.client_view_json).issuedOn, dayIn(2));
  const [row] = rowsOf(est.id);
  assert.equal(row.status, 'scheduled');
  await new Promise((res) => setTimeout(res, 40));
  assert.equal(mail.length, 0, 'not yet');

  const again = await send(est, email());
  assert.deepEqual([again.status, again.body.error, again.body.sendId], [409, 'send_pending', row.id]);
  assert.equal((await send(est, { by: 'link', validUntil: dayIn(30) })).body.error, 'send_pending');

  // A version can't go out after it expires: moving the send past it is refused.
  const late = await put(`/api/sends/${row.id}`, { scheduledFor: at(40) });
  assert.deepEqual([late.status, late.body.error], [400, 'after_valid_until']);
  assert.match(late.body.message, /^v1 is valid until \d+ \w+,/);
  const moved = await put(`/api/sends/${row.id}`, { scheduledFor: at(3), message: 'Changed' });
  assert.deepEqual([moved.status, moved.body.send.message], [200, 'Changed']);

  // Cancelled: the email never goes, but v1 stands (it may have been shared).
  const cancelled = await post(`/api/sends/${row.id}/cancel`);
  assert.equal(cancelled.body.send.status, 'cancelled');
  const folder = await api(`/api/projects/${est.projectId}?today=${today}`).then(json);
  assert.deepEqual([folder.body.estimates[0].status, folder.body.estimates[0].send.status], ['sent', 'cancelled']);
  const v2 = await send(est, email());
  assert.deepEqual([v2.status, v2.body.sent.version, v2.body.sent.token], [200, 2, r.body.sent.token], 'v2, same link');
});

test('Copy link: the estimate goes live with no email; email not set up refuses only email', async () => {
  const est = await estimate();
  const off = await send(est, email(), offline);
  assert.deepEqual([off.status, off.body.error], [409, 'not_configured']);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM estimate_versions WHERE estimate_id = ?').get(est.id).c, 0, 'refused before freezing');
  const r = await send(est, { by: 'link', validUntil: dayIn(30) }, offline);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.sent.version, r.body.activity[0].detail.by], [1, 'link']);
  assert.equal(rowsOf(est.id).length, 0);
  const page = await fetch(`${base}/public/estimates/${r.body.sent.token}`).then(json);
  assert.equal(page.body.estimate.state, 'open');
});

test('what a send must say: how, to whom, when, and a valid-until from the day it goes', async () => {
  const est = await estimate();
  const refuse = async (body, code) => {
    const r = await send(est, body);
    assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body));
  };
  await refuse({ validUntil: dayIn(30) }, 'by_invalid');
  await refuse(email({ to: 'nope' }), 'bad_recipient');
  await refuse(email({ to: undefined }), 'bad_recipient');
  await refuse(email({ scheduledFor: 'Tuesday' }), 'scheduled_for_invalid');
  await refuse(email({ scheduledFor: at(400) }), 'scheduled_for_invalid');
  await refuse(email({ message: 'x'.repeat(5001) }), 'message_invalid');
  await refuse(email({ validUntil: dayIn(-1) }), 'valid_until_invalid');
  await refuse(email({ scheduledFor: at(10), validUntil: dayIn(5) }), 'valid_until_invalid');
  // A time already past is now, not refused.
  const r = await send(est, email({ scheduledFor: at(-1) }));
  assert.equal(r.status, 200);
  assert.equal(r.body.activity[0].detail.scheduledFor, undefined);
  assert.equal((await post(`/api/projects/prj_nope/send?today=${today}`, email())).status, 404);
});

test('declining or accepting cancels an estimate email still waiting; deleting removes it', async () => {
  const a = await estimate();
  await send(a, email({ scheduledFor: at(2) }));
  await post(`/api/projects/${a.projectId}/decline?today=${today}`);
  assert.equal(rowsOf(a.id)[0].status, 'cancelled');

  const b = await estimate();
  await send(b, email({ scheduledFor: at(2) }));
  const ok = await post(`/api/projects/${b.projectId}/accept?today=${today}`, { invoicing: 'single' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(rowsOf(b.id)[0].status, 'cancelled');

  const c = await estimate();
  await send(c, email({ scheduledFor: at(2) }));
  assert.equal((await api(`/api/projects/${c.projectId}`, { method: 'DELETE' })).status, 200);
  assert.equal(rowsOf(c.id).length, 0);
});

/* An accepted project's deposit invoice, a draft. */
async function deposit() {
  const est = await estimate();
  const r = await post(`/api/projects/${est.projectId}/accept?today=${today}`, { invoicing: 'pair', depositPct: 40 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.invoices.find((i) => i.kind === 'deposit');
}
const sendInvoice = (inv, body) => post(`/api/invoices/${inv.id}/send?today=${today}`, body);
const invRow = (id) => db.prepare('SELECT status, issued_at, due_at, public_token FROM invoices WHERE id = ?').get(id);

test('invoice, later: scheduled with its dates and link, and its time and due date can move', async () => {
  const dep = await deposit();
  const r = await sendInvoice(dep, { by: 'email', to: 'priya@salt.example', message: 'Deposit', scheduledFor: at(3), dueAt: dayIn(10) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.invoice.status, r.body.invoice.issuedAt, r.body.invoice.dueAt], ['scheduled', dayIn(3), dayIn(10)]);
  assert.match(r.body.invoice.publicToken, /^[A-Za-z0-9_-]{43}$/, 'the link exists while it waits, for Copy link');
  assert.equal(r.body.invoice.send.status, 'scheduled');
  assert.equal(r.body.project.stageDetail.step, 'deposit_scheduled');
  // A scheduled invoice can't be edited or sent twice.
  assert.equal((await sendInvoice(dep, { by: 'link', dueAt: dayIn(10) })).body.error, 'not_draft');

  const sendId = r.body.invoice.send.id;
  assert.equal((await put(`/api/sends/${sendId}`, { scheduledFor: at(12) })).body.error, 'due_at_invalid', 'due before it goes');
  const moved = await put(`/api/sends/${sendId}`, { scheduledFor: at(5), dueAt: dayIn(20) });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual([invRow(dep.id).issued_at, invRow(dep.id).due_at], [dayIn(5), dayIn(20)]);

  // Cancelled: a draft again, no dates, the link kept.
  const token = invRow(dep.id).public_token;
  await post(`/api/sends/${sendId}/cancel`);
  assert.deepEqual(invRow(dep.id), { status: 'draft', issued_at: null, due_at: null, public_token: token });
});

test('invoice, now: sent when the email goes, logged for Home; a failed one can be retried or given up', async () => {
  const dep = await deposit();
  mail.length = 0;
  const r = await sendInvoice(dep, { by: 'email', to: 'priya@salt.example', dueAt: dayIn(7) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invoice.issuedAt, today);
  await settle(() => invRow(dep.id).status === 'sent');
  assert.equal(invRow(dep.id).status, 'sent');
  assert.match(mail[0].text, new RegExp(`c/#i/${invRow(dep.id).public_token}`));
  const folder = await api(`/api/projects/${r.body.invoice.projectId}?today=${today}`).then(json);
  const logged = folder.body.activity.find((x) => x.kind === 'invoice_sent');
  assert.deepEqual([logged.detail.by, logged.detail.late, logged.detail.dueAt], ['email', false, dayIn(7)]);

  // Failed: the invoice stays scheduled (it never reached the client), the
  // owner retries or cancels, and cancelling makes it a draft again.
  const other = await deposit();
  failing = true;
  const f = await sendInvoice(other, { by: 'email', to: 'priya@salt.example', dueAt: dayIn(7) });
  await settle(() => rowsOf(other.id)[0].status === 'failed');
  failing = false;
  assert.deepEqual([rowsOf(other.id)[0].status, invRow(other.id).status], ['failed', 'scheduled']);
  const cancelled = await post(`/api/sends/${f.body.invoice.send.id}/cancel`);
  assert.equal(cancelled.body.send.status, 'cancelled');
  assert.equal(invRow(other.id).status, 'draft');
});

test('invoice, Copy link: sent now with no email; voiding or paying cancels a waiting email', async () => {
  const dep = await deposit();
  const r = await sendInvoice(dep, { by: 'link', dueAt: dayIn(7) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([invRow(dep.id).status, rowsOf(dep.id).length], ['sent', 0]);
  const folder = await api(`/api/projects/${r.body.invoice.projectId}?today=${today}`).then(json);
  assert.equal(folder.body.activity.find((x) => x.kind === 'invoice_sent').detail.by, 'link');
  assert.equal((await post(`/api/invoices/${dep.id}/send?today=${today}`, { by: 'link', dueAt: dayIn(-1) })).body.error, 'not_draft');

  const v = await deposit();
  await sendInvoice(v, { by: 'email', to: 'priya@salt.example', scheduledFor: at(2), dueAt: dayIn(9) });
  const voided = await post(`/api/invoices/${v.id}/void?today=${today}`, { reason: 'Wrong amount' });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(rowsOf(v.id)[0].status, 'cancelled');

  const p = await deposit();
  await sendInvoice(p, { by: 'email', to: 'priya@salt.example', scheduledFor: at(2), dueAt: dayIn(9) });
  await post(`/api/invoices/${p.id}/paid?today=${today}`, { paidAt: today, via: 'bank' });
  assert.equal(rowsOf(p.id)[0].status, 'cancelled');
  // Its email never went, so it's issued the day it was paid, not the day it was to go (C4).
  assert.deepEqual([invRow(p.id).issued_at, invRow(p.id).due_at], [today, dayIn(9)]);

  const d = await deposit();
  assert.equal((await sendInvoice(d, { by: 'email', to: 'priya@salt.example', dueAt: dayIn(-1) })).body.error, 'due_at_invalid');
  assert.equal((await post(`/api/invoices/${d.id}/send?today=${today}`, { by: 'email', to: 'p@s.co', dueAt: dayIn(7) }, offline)).body.error, 'not_configured');
  assert.equal(invRow(d.id).status, 'draft');
});

/* ── Saving a changed sent quote (task 33 C2, C3) ─────────────────────── */

const edit = (est, change, resend, url = base) => api(`/api/estimates/${est.id}`, {
  method: 'PUT',
  body: JSON.stringify({
    pricingShape: PRICING_SHAPE, name: est.name, upid: est.upid, client: est.client, activeRows: est.activeRows,
    days: est.days, rentals: est.rentals, ...(change || {}), ...(resend ? { resend } : {}),
  }),
}, url).then(json);
const versionsOf = (id) => db.prepare('SELECT n, valid_until FROM estimate_versions WHERE estimate_id = ? ORDER BY n').all(id);
const dearer = (est) => ({ activeRows: { post: [{ ...est.activeRows.post[0], qty: 2 }] } });

test('a sent quote: a change the client would see can’t be saved without sending it; nothing is stored until it is', async () => {
  const est = await estimate();
  await send(est, email());
  // Nothing the client reads changed (the contact's name is on no client
  // document): saved as before, no new version.
  const quiet = await edit(est, { client: { ...est.client, contactName: 'Priya N.' } });
  assert.equal(quiet.status, 200, JSON.stringify(quiet.body));
  assert.equal(quiet.body.resent, undefined);
  assert.equal(versionsOf(est.id).length, 1);

  const before = db.prepare('SELECT totals_json FROM estimates WHERE id = ?').get(est.id).totals_json;
  const refused = await edit(est, dearer(est));
  assert.equal(refused.status, 409);
  assert.deepEqual(
    [refused.body.error, refused.body.version, refused.body.to, refused.body.emailReady, refused.body.waiting, refused.body.validUntil],
    ['resend_required', 1, 'priya@salt.example', true, null, dayIn(30)],
  );
  assert.equal(db.prepare('SELECT totals_json FROM estimates WHERE id = ?').get(est.id).totals_json, before, 'rolled back');
  assert.equal(versionsOf(est.id).length, 1);
  assert.equal((await edit(est, dearer(est), { by: 'email', to: 'nope', validUntil: dayIn(30) })).body.error, 'bad_recipient');
  assert.equal((await edit(est, dearer(est), { by: 'email', to: 'priya@salt.example', validUntil: dayIn(-1) })).body.error, 'valid_until_invalid');
  assert.equal(versionsOf(est.id).length, 1);
});

test('a sent quote: Save and send makes the next version and emails a “Quote update” to the same link', async () => {
  const est = await estimate();
  const first = await send(est, email());
  await settle(() => mail.length && rowsOf(est.id)[0].status === 'sent');
  mail.length = 0;
  const r = await edit(est, dearer(est), { by: 'email', to: 'priya@salt.example', message: 'Two days now.', validUntil: dayIn(40) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.resent, { version: 2, by: 'email', token: first.body.sent.token });
  assert.deepEqual(versionsOf(est.id), [{ n: 1, valid_until: dayIn(30) }, { n: 2, valid_until: dayIn(40) }]);
  await settle(() => mail.length === 1);
  assert.equal(mail[0].subject, `Quote update: ${est.name} (${est.upid})`);
  assert.match(mail[0].text, /has updated your quote for Harbour/);
  assert.match(mail[0].text, /Two days now\./);
  assert.match(mail[0].text, new RegExp(`c/#e/${first.body.sent.token}`));

  // The client's page is the new version, and the live estimate is exactly
  // it: what a signature or Mark accepted bills is what they were sent.
  const page = (await fetch(`${base}/public/estimates/${first.body.sent.token}`).then((x) => x.json())).estimate;
  assert.deepEqual([page.version, page.state, page.totals.total], [2, 'open', r.body.estimate.totals.totalIncGst]);
  const { liveVersion, changedSince } = require('../src/public');
  assert.equal(changedSince(db, est.id, liveVersion(db, est.id)), false);
  const folder = await api(`/api/projects/${est.projectId}?today=${today}`).then(json);
  const logged = folder.body.activity.find((a) => a.kind === 'sent');
  assert.deepEqual([logged.detail.update, logged.detail.version, logged.detail.by], [true, 2, 'email']);
});

test('a sent quote: an email still waiting carries the new version; without email, the link updates alone', async () => {
  const est = await estimate();
  await send(est, email({ scheduledFor: at(2), validUntil: dayIn(32) }));
  const asked = await edit(est, dearer(est));
  assert.deepEqual([asked.body.waiting.to, asked.body.validUntil], ['priya@salt.example', dayIn(32)]);
  const r = await edit(est, dearer(est), { by: 'link', validUntil: dayIn(32) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.resent.by, 'waiting');
  const rows = rowsOf(est.id);
  assert.equal(rows.length, 1, 'no second email');
  assert.equal(db.prepare('SELECT n FROM estimate_versions WHERE id = ?').get(rows[0].version_id).n, 2);

  const off = await estimate();
  await send(off, { by: 'link', validUntil: dayIn(30) });
  const no = await edit(off, dearer(off), { by: 'email', to: 'priya@salt.example', validUntil: dayIn(30) }, offline);
  assert.equal(no.body.error, 'not_configured');
  assert.equal((await edit(off, dearer(off), null, offline)).body.emailReady, false);
  const linked = await edit(off, dearer(off), { by: 'link', validUntil: dayIn(30) }, offline);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.deepEqual([linked.body.resent.by, versionsOf(off.id).length, rowsOf(off.id).length], ['link', 2, 0]);
});

test('a quote not live with the client saves as before: a draft, and an accepted project', async () => {
  const draft = await estimate();
  assert.equal((await edit(draft, dearer(draft))).status, 200);
  const est = await estimate();
  await send(est, { by: 'link', validUntil: dayIn(30) });
  await post(`/api/projects/${est.projectId}/accept?today=${today}`, { invoicing: 'single' });
  const r = await edit(est, dearer(est));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(versionsOf(est.id).length, 1);
});

test('an invoice that replaces a voided one is emailed as an “Invoice update” naming the one it replaces', async () => {
  const dep = await deposit();
  await sendInvoice(dep, { by: 'link', dueAt: dayIn(7) });
  const voided = await post(`/api/invoices/${dep.id}/void?today=${today}`, { reason: 'Wrong amount' });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  const remade = db.prepare('SELECT id, number FROM invoices WHERE replaces_id = ?').get(dep.id);
  mail.length = 0;
  const r = await sendInvoice({ id: remade.id }, { by: 'email', to: 'priya@salt.example', dueAt: dayIn(7) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle(() => mail.length === 1);
  const number = db.prepare('SELECT number FROM invoices WHERE id = ?').get(dep.id).number;
  assert.match(mail[0].subject, new RegExp(`^Invoice update: .* \\(${remade.number}\\)$`));
  assert.match(mail[0].text, new RegExp(`It replaces ${number}, which no longer needs paying`));
});

test('a failed email is cancelled when its document moves on, and can’t be retried once it has (C8)', async () => {
  // Accepted after the quote's email failed: the failed row goes, so no retry asks them to accept again.
  const est = await estimate();
  failing = true;
  await send(est, email());
  await settle(() => rowsOf(est.id)[0].status === 'failed');
  failing = false;
  await post(`/api/projects/${est.projectId}/accept?today=${today}`, { invoicing: 'single' });
  const [row] = rowsOf(est.id);
  assert.equal(row.status, 'cancelled');
  assert.equal((await post(`/api/sends/${row.id}/retry`)).body.error, 'not_failed');

  // Expired since it failed: the retry is refused, and says to send it again.
  const old = await estimate();
  failing = true;
  await send(old, email());
  await settle(() => rowsOf(old.id)[0].status === 'failed');
  failing = false;
  db.prepare('UPDATE estimate_versions SET valid_until = ? WHERE estimate_id = ?').run(dayIn(-1), old.id);
  const expired = await post(`/api/sends/${rowsOf(old.id)[0].id}/retry`);
  assert.deepEqual([expired.status, expired.body.error], [409, 'doc_expired']);
  assert.match(expired.body.message, /Send the quote again/);
  assert.equal(rowsOf(old.id)[0].status, 'failed');

  // Moved on with no cancel (a row from before this fix): refused as it is sent, not mailed.
  const moved = await estimate();
  failing = true;
  await send(moved, email());
  await settle(() => rowsOf(moved.id)[0].status === 'failed');
  failing = false;
  db.prepare("UPDATE estimates SET status = 'declined' WHERE id = ?").run(moved.id);
  assert.equal((await post(`/api/sends/${rowsOf(moved.id)[0].id}/retry`)).body.error, 'doc_moved_on');
  db.prepare("UPDATE sends SET status = 'scheduled' WHERE id = ?").run(rowsOf(moved.id)[0].id);
  mail.length = 0;
  await send(await estimate(), email()); // its kick runs every due send
  await settle(() => rowsOf(moved.id)[0].status !== 'scheduled');
  assert.equal(rowsOf(moved.id)[0].status, 'failed');
  assert.match(rowsOf(moved.id)[0].error, /won’t be sent/);
  assert.equal(mail.filter((m) => m.subject.includes(moved.upid)).length, 0);

  // Paid after the invoice's email failed: cancelled, so no retry asks for money already in.
  const dep = await deposit();
  failing = true;
  await sendInvoice(dep, { by: 'email', to: 'priya@salt.example', dueAt: dayIn(7) });
  await settle(() => rowsOf(dep.id)[0].status === 'failed');
  failing = false;
  await post(`/api/invoices/${dep.id}/paid?today=${today}`, { paidAt: today, via: 'bank' });
  assert.equal(rowsOf(dep.id)[0].status, 'cancelled');
});

test('Stage D’s Mark sent routes exist for the tests only: a server not in test mode answers 404 (C13)', async () => {
  const url = await start({ markSentRoutes: false });
  const est = await estimate();
  const r1 = await post(`/api/projects/${est.projectId}/sent`, { validUntil: dayIn(30) }, url);
  const dep = await deposit();
  const r2 = await post(`/api/invoices/${dep.id}/sent`, { issuedAt: today, dueAt: today }, url);
  assert.deepEqual([r1.status, r2.status], [404, 404]);
  assert.equal(invRow(dep.id).status, 'draft');
  assert.equal(db.prepare('SELECT status FROM estimates WHERE id = ?').get(est.id).status, 'draft');
  // The app's own send still works there.
  assert.equal((await send(est, { by: 'link', validUntil: dayIn(30) }, url)).status, 200);
});

test('changing a scheduled invoice email refuses a due date that isn’t a real day (C14)', async () => {
  const dep = await deposit();
  const r = await sendInvoice(dep, { by: 'email', to: 'priya@salt.example', scheduledFor: at(2), dueAt: dayIn(9) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.invoice.send.id;
  const year = Number(dayIn(9).slice(0, 4)) + 1;
  for (const dueAt of [`${year}-02-30`, `${year}-13-01`, `${year}-04-31`]) {
    const bad = await put(`/api/sends/${id}`, { dueAt });
    assert.deepEqual([bad.status, bad.body.error], [400, 'due_at_invalid'], dueAt);
  }
  assert.equal(invRow(dep.id).due_at, dayIn(9));
  assert.equal((await put(`/api/sends/${id}`, { dueAt: `${year}-02-28` })).status, 200);
  assert.equal(invRow(dep.id).due_at, `${year}-02-28`);
});
