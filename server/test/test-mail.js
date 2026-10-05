'use strict';

/**
 * Email and the send queue (production-booking task 28). A stub transport
 * stands in for SMTP, so these pin what is sent and when, not Resend.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-mail-'));
process.env.DATA_DIR = TMP;
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createMailer, documentEmail, ownerSignedEmail, signedCopyEmail, isEmail } = require('../src/mail');
const sends = require('../src/sends');

let db;
test.before(() => { db = openDatabase(path.join(TMP, 'billing.db')); });
test.after(() => { db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

const KEY = 're_SECRETKEY_0123456789';
const CFG = { smtp: { host: 'smtp.example', port: 465, user: 'resend', pass: KEY }, mailFrom: 'admin@lsccreative.studio', mailReplyTo: 'owner@example.com' };

/* A transport that records what it was asked to send, and can be told to fail
   or to wait. */
function stub(behaviour = {}) {
  const t = {
    sent: [],
    async sendMail(m) {
      if (behaviour.wait) await behaviour.wait;
      if (behaviour.fail) throw new Error(behaviour.fail);
      t.sent.push(m);
      return { messageId: `<m${t.sent.length}@test>` };
    },
  };
  return t;
}

const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse('2026-10-05T09:00:00Z');

/* An estimate that has been sent (a project, an estimate with a link, a frozen
   version) and the invoice kinds, inserted directly: the queue reads rows, it
   doesn't care how they came to be. */
let seq = 0;
function seedProject() {
  seq += 1;
  const now = iso(T0);
  const pid = `prj_m${seq}`;
  const eid = `est_m${seq}`;
  db.prepare(`INSERT INTO projects (id, client_id, upid, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)`).run(pid, `MAIL-${seq}`, now, now);
  const cols = db.prepare('PRAGMA table_info(estimates)').all().filter((c) => c.notnull && c.dflt_value === null && c.name !== 'id');
  const base = { id: eid, project_id: pid, upid: `MAIL-${seq}`, name: `Harbour ${seq}`, public_token: `tok${seq}`.padEnd(43, 'x') };
  cols.forEach((c) => { if (!(c.name in base)) base[c.name] = c.type.toUpperCase().includes('INT') || c.type.toUpperCase().includes('REAL') ? 0 : (/_at$/.test(c.name) ? now : '{}'); });
  db.prepare(`INSERT INTO estimates (${Object.keys(base).join(',')}) VALUES (${Object.keys(base).map(() => '?').join(',')})`).run(...Object.values(base));
  const vid = `ver_m${seq}`;
  const snap = { estimate: { name: `Harbour ${seq}`, upid: `MAIL-${seq}`, client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' } }, pricing: {}, business: {} };
  db.prepare(`INSERT INTO estimate_versions (id, estimate_id, n, snapshot_json, client_view_json, sent_at) VALUES (?, ?, 1, ?, '{}', ?)`)
    .run(vid, eid, JSON.stringify(snap), now);
  return { pid, eid, vid, token: base.public_token };
}

const outboxFor = (transport, extra = {}) => {
  let clock = T0;
  const box = sends.createOutbox(db, createMailer(CFG, { transport }), { now: () => iso(clock), appUrl: 'https://pages.example/app/', ...extra });
  box.at = (ms) => { clock = ms; };
  return box;
};

// ── mail.js ─────────────────────────────────────────────────────────────────

test('mailer: sends from MAIL_FROM with the owner as Reply-To, to a valid address only', async () => {
  const t = stub();
  const mailer = createMailer(CFG, { transport: t });
  assert.equal(mailer.configured, true);
  await mailer.send({ to: ' priya@salt.example ', subject: 'S', text: 't', html: '<p>h</p>' });
  assert.deepEqual([t.sent[0].from, t.sent[0].to, t.sent[0].replyTo], ['admin@lsccreative.studio', 'priya@salt.example', 'owner@example.com']);
  await assert.rejects(mailer.send({ to: 'not an email', subject: 'S', text: 't', html: 'h' }), { code: 'bad_recipient' });
  assert.equal(t.sent.length, 1);
  ['a@b.co', 'first.last+tag@sub.example.com'].forEach((a) => assert.ok(isEmail(a), a));
  ['', 'a@b', 'a b@c.co', 'a@b.co, c@d.co', '<a@b.co>', null].forEach((a) => assert.ok(!isEmail(a), String(a)));
});

test('mailer: without the key it is "not connected" and says so, rather than trying', async () => {
  const mailer = createMailer({ smtp: { host: 'h', port: 465, user: 'resend', pass: '' }, mailFrom: 'admin@lsccreative.studio' });
  assert.equal(mailer.configured, false);
  await assert.rejects(mailer.send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), { code: 'not_configured' });
  assert.equal(createMailer({ smtp: { pass: KEY }, mailFrom: '' }).configured, false, 'a key with no From address is not enough');
});

test('mailer: an SMTP failure is thrown with the key scrubbed out of it', async () => {
  const mailer = createMailer(CFG, { transport: stub({ fail: `535 bad login for ${KEY} on host` }) });
  await assert.rejects(mailer.send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }), (err) => {
    assert.equal(err.code, 'send_failed');
    assert.doesNotMatch(err.message, /SECRETKEY/);
    assert.match(err.message, /535 bad login/);
    return true;
  });
});

test('templates: the estimate email carries the message, the client link and nothing markup-injectable', () => {
  const m = documentEmail({
    kind: 'estimate', businessName: 'LSC Creative', upid: 'AUD-B', projectName: 'Harbour <script>',
    message: 'Hi Priya,\nHere it is.\n\nThanks <b>', link: 'https://pages.example/app/c/#e/abc',
  });
  // The client's word for an estimate is "quote" (D103).
  assert.equal(m.subject, 'Quote AUD-B: Harbour <script> · LSC Creative');
  assert.match(m.text, /Hi Priya,\nHere it is\.\n\nThanks <b>\n\nView the quote: https:\/\/pages\.example\/app\/c\/#e\/abc/);
  assert.doesNotMatch(m.subject + m.text + m.html, /estimate/i);
  assert.match(m.html, /href="https:\/\/pages\.example\/app\/c\/#e\/abc"/);
  assert.doesNotMatch(m.html, /<script>|<b>/);
  assert.match(m.html, /&lt;script&gt;/);
  assert.match(m.html, /Hi Priya,<br>Here it is\./);
  const inv = documentEmail({ kind: 'deposit', businessName: '', upid: 'AUD-B', number: 'INV-AUD-B-D', projectName: 'Harbour', message: '', link: 'https://x/c/#i/t' });
  assert.equal(inv.subject, 'Deposit invoice INV-AUD-B-D: Harbour · LSC Creative');
});

test('templates: an update says what changed and that the earlier link leads to it (task 33 C2)', () => {
  const q = documentEmail({
    kind: 'estimate', update: true, businessName: 'LSC Creative', upid: 'AUD-B', projectName: 'Harbour <script>',
    message: 'Moved to Friday.', link: 'https://x/c/#e/abc',
  });
  assert.equal(q.subject, 'Quote update: Harbour <script> (AUD-B)');
  assert.match(q.text, /^LSC Creative has updated your quote for Harbour <script>\. The button below opens the updated quote, and so does the link in any earlier email about it\.\n\nMoved to Friday\.\n\nView the updated quote: https:\/\/x\/c\/#e\/abc/);
  assert.doesNotMatch(q.subject + q.text + q.html, /estimate/i);
  assert.doesNotMatch(q.html, /<script>/);
  const inv = documentEmail({
    kind: 'final', update: true, replaces: 'INV-AUD-B-F', businessName: '', number: 'INV-AUD-B-F2', projectName: 'Harbour',
    message: '', link: 'https://x/c/#i/t',
  });
  assert.equal(inv.subject, 'Invoice update: Harbour (INV-AUD-B-F2)');
  assert.match(inv.text, /It replaces INV-AUD-B-F, which no longer needs paying\./);
  assert.match(inv.html, /View the updated invoice/);
});

test('templates: the owner’s notice links to the project, and says when the invoices weren’t made', () => {
  const ok = ownerSignedEmail({ clientName: 'Saltwater Co.', signedBy: 'Priya Nair', role: 'Director', upid: 'AUD-B', projectName: 'Harbour', link: 'https://p/app/#/projects/prj_1' });
  assert.equal(ok.subject, 'Saltwater Co. signed AUD-B: Harbour');
  assert.match(ok.text, /Priya Nair, Director, signed and accepted/);
  assert.match(ok.text, /The days are confirmed\. The invoices are made\./);
  // A day flagged as a clash isn't called confirmed and left at that (C5).
  const one = ownerSignedEmail({ clientName: 'S', signedBy: 'P', role: 'R', upid: 'A', projectName: 'H', link: 'l', rebook: ['2026-10-16'] });
  assert.match(one.text, /The days are confirmed, but 16 Oct was already confirmed by another project: it’s flagged “clash, rebook”\. Sort it out with the client\./);
  const two = ownerSignedEmail({ clientName: 'S', signedBy: 'P', role: 'R', upid: 'A', projectName: 'H', link: 'l', rebook: ['2026-10-16', '2026-10-17', '2026-11-02'] });
  assert.match(two.text, /but 16 Oct, 17 Oct and 2 Nov were already confirmed by another project: they’re flagged/);
  assert.match(two.html, /16 Oct, 17 Oct and 2 Nov/);
  assert.match(ok.text, /#\/projects\/prj_1/);
  const bad = ownerSignedEmail({ clientName: '', signedBy: 'Priya Nair', role: 'Director', upid: '', projectName: 'Harbour', invoiceProblem: 'upid_required', link: 'https://p/' });
  assert.match(bad.text, /Create invoices/);
  assert.match(signedCopyEmail({ businessName: 'LSC', contactName: 'Priya', upid: 'AUD-B', projectName: 'Harbour' }).text, /^Hi Priya,/);
  assert.match(signedCopyEmail({ businessName: 'LSC', contactName: '', upid: 'AUD-B', projectName: 'Harbour' }).text, /Thanks for accepting the quote for Harbour\./);
});

// ── The queue ───────────────────────────────────────────────────────────────

test('queue: a due send goes out once, with the client’s link; a future one waits for its time', async () => {
  const p = seedProject();
  const t = stub();
  const box = outboxFor(t);
  const now = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'priya@salt.example', message: 'Here you go', scheduledFor: iso(T0) }, iso(T0));
  const later = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'priya@salt.example', scheduledFor: iso(T0 + 3600e3) }, iso(T0));
  assert.deepEqual(await box.runDue(), { sent: 1, failed: 0 });
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].to, 'priya@salt.example');
  assert.match(t.sent[0].text, new RegExp(`https://pages\\.example/app/c/#e/${p.token}`));
  assert.match(t.sent[0].subject, /^Quote MAIL-\d+: Harbour \d+ · LSC Creative$|^Quote MAIL-\d+: Harbour \d+ ·/);
  const row = sends.getSend(db, now.id);
  assert.deepEqual([row.status, row.sent_at, row.late, row.error], ['sent', iso(T0), 0, null]);
  assert.equal(sends.getSend(db, later.id).status, 'scheduled');
  // Running again changes nothing: the row is no longer scheduled.
  assert.deepEqual(await box.runDue(), { sent: 0, failed: 0 });
  box.at(T0 + 3600e3);
  assert.deepEqual(await box.runDue(), { sent: 1, failed: 0 });
  assert.equal(t.sent.length, 2);
});

test('queue: two passes at once, and two outboxes, still send a row once', async () => {
  const p = seedProject();
  const t = stub({ wait: new Promise((r) => setTimeout(r, 30)) });
  const a = outboxFor(t);
  const b = outboxFor(t);
  sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0) }, iso(T0));
  const results = await Promise.all([a.runDue(), a.runDue(), b.runDue()]);
  assert.equal(t.sent.length, 1, 'one email');
  assert.equal(results.reduce((n, r) => n + r.sent, 0), 1);
});

test('queue: a restart in the middle of a send doesn’t send it again; it is marked failed to say so', async () => {
  const p = seedProject();
  const row = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0) }, iso(T0));
  // The first process claimed it, then died before it could mark the outcome.
  assert.equal(sends.claimDue(db, iso(T0)).length, 1);
  assert.equal(sends.getSend(db, row.id).status, 'sending');
  assert.equal(sends.claimDue(db, iso(T0)).length, 0, 'it cannot be claimed twice');
  // The new process boots: it sweeps, then ticks.
  const t = stub();
  const box = outboxFor(t);
  box.start();
  box.stop();
  await box.runDue();
  assert.equal(t.sent.length, 0, 'nothing goes out');
  const after = sends.getSend(db, row.id);
  assert.equal(after.status, 'failed');
  assert.match(after.error, /may or may not have gone out/);
});

test('queue: a send missed while the server was down goes out on boot, marked late (D47)', async () => {
  const p = seedProject();
  const t = stub();
  const box = outboxFor(t);
  const missed = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0) }, iso(T0 - 1000));
  const onTime = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0 + 60e3) }, iso(T0 - 1000));
  box.at(T0 + 2 * 3600e3 + 42 * 60e3); // back at 11:42
  box.start();
  box.stop();
  await box.runDue();
  const a = sends.getSend(db, missed.id);
  assert.deepEqual([a.status, a.late, a.sent_at], ['sent', 1, iso(T0 + 2 * 3600e3 + 42 * 60e3)]);
  // The other was also overdue by then.
  assert.equal(sends.getSend(db, onTime.id).late, 1);
  // But one picked up within the tick's own grain is just sent.
  const fresh = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0 + 2 * 3600e3 + 42 * 60e3 - 50e3) }, iso(T0));
  await box.runDue();
  assert.equal(sends.getSend(db, fresh.id).late, 0);
});

test('queue: a scheduled send can be edited and cancelled; one that has gone cannot', async () => {
  const p = seedProject();
  const t = stub();
  const box = outboxFor(t);
  const row = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', message: 'one', scheduledFor: iso(T0 + 3600e3) }, iso(T0));
  const edited = sends.editSend(db, row.id, { scheduledFor: iso(T0 + 7200e3), message: 'two', toEmail: ' c@d.co ' }, iso(T0));
  assert.deepEqual([edited.scheduled_for, edited.message, edited.to_email], [iso(T0 + 7200e3), 'two', 'c@d.co']);
  box.at(T0 + 3600e3);
  await box.runDue();
  assert.equal(t.sent.length, 0, 'the edit moved it later');
  box.at(T0 + 7200e3);
  await box.runDue();
  assert.deepEqual([t.sent.length, t.sent[0].to], [1, 'c@d.co']);
  assert.throws(() => sends.editSend(db, row.id, { message: 'x' }), { code: 'not_scheduled' });
  assert.throws(() => sends.cancelSend(db, row.id), { code: 'not_scheduled' });

  const cancelled = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0 + 7200e3) }, iso(T0));
  assert.equal(sends.cancelSend(db, cancelled.id).status, 'cancelled');
  assert.equal(sends.cancelSend(db, cancelled.id).status, 'cancelled', 'cancelling twice is fine');
  await box.runDue();
  assert.equal(t.sent.length, 1, 'a cancelled send never goes');
  assert.throws(() => sends.editSend(db, cancelled.id, { message: 'x' }), { code: 'not_scheduled' });
  assert.throws(() => sends.cancelSend(db, 'snd_nope'), { code: 'not_found' });
});

test('queue: a failure is stored on the row, with the key scrubbed, and a retry sends it', async () => {
  const p = seedProject();
  const bad = stub({ fail: `connect ECONNREFUSED with ${KEY}` });
  const box = outboxFor(bad);
  const row = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0) }, iso(T0));
  assert.deepEqual(await box.runDue(), { sent: 0, failed: 1 });
  const failed = sends.getSend(db, row.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /ECONNREFUSED/);
  assert.doesNotMatch(failed.error, /SECRETKEY/);
  assert.equal(failed.sent_at, null);
  // It stays failed: no tick retries it behind the owner's back.
  assert.deepEqual(await box.runDue(), { sent: 0, failed: 0 });

  const good = stub();
  const box2 = outboxFor(good);
  box2.at(T0 + 3 * 3600e3);
  const again = sends.retrySend(db, row.id, iso(T0 + 3 * 3600e3));
  assert.deepEqual([again.status, again.error, again.late], ['scheduled', null, 0]);
  await box2.runDue();
  const done = sends.getSend(db, row.id);
  assert.deepEqual([done.status, done.late], ['sent', 0], 'a retry is not "late"');
  assert.equal(good.sent.length, 1);
  assert.throws(() => sends.retrySend(db, row.id), { code: 'not_failed' });
});

test('queue: with no key, a due send fails and says why; a bad address and a deleted estimate fail too', async () => {
  const p = seedProject();
  const box = sends.createOutbox(db, createMailer({}), { now: () => iso(T0), appUrl: 'https://p/' });
  const a = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0) }, iso(T0));
  await box.runDue();
  assert.match(sends.getSend(db, a.id).error, /Email isn’t set up/);

  const t = stub();
  const box2 = outboxFor(t);
  const b = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'nope', scheduledFor: iso(T0) }, iso(T0));
  const c = sends.addSend(db, { docKind: 'estimate', docId: 'est_gone', toEmail: 'a@b.co', scheduledFor: iso(T0) }, iso(T0));
  await box2.runDue();
  assert.match(sends.getSend(db, b.id).error, /isn’t valid/);
  assert.match(sends.getSend(db, c.id).error, /deleted/);
  assert.equal(t.sent.length, 0);
  // No client link, no email: an unsent estimate has none.
  db.prepare('UPDATE estimates SET public_token = NULL WHERE id = ?').run(p.eid);
  const d = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0) }, iso(T0));
  await box2.runDue();
  assert.match(sends.getSend(db, d.id).error, /no client link/);
});

test('queue: an invoice email makes its link the first time and keeps it; a void one is refused', async () => {
  const p = seedProject();
  const t = stub();
  const box = outboxFor(t);
  const now = iso(T0);
  const snap = JSON.stringify({ name: 'Harbour', client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' } });
  db.prepare(`INSERT INTO invoices (id, project_id, kind, number, status, estimate_snapshot_json, created_at, updated_at) VALUES ('inv_m1', ?, 'deposit', 'INV-X-D', 'draft', ?, ?, ?)`).run(p.pid, snap, now, now);
  db.prepare(`INSERT INTO invoices (id, project_id, kind, number, status, estimate_snapshot_json, created_at, updated_at) VALUES ('inv_m2', ?, 'final', 'INV-X-F', 'void', ?, ?, ?)`).run(p.pid, snap, now, now);
  sends.addSend(db, { docKind: 'invoice', docId: 'inv_m1', toEmail: '', message: 'Deposit invoice', scheduledFor: now }, now);
  const voided = sends.addSend(db, { docKind: 'invoice', docId: 'inv_m2', toEmail: 'a@b.co', scheduledFor: now }, now);
  await box.runDue();
  const token = db.prepare("SELECT public_token FROM invoices WHERE id = 'inv_m1'").get().public_token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].to, 'priya@salt.example', 'blank recipient falls back to the client’s email');
  assert.match(t.sent[0].text, new RegExp(`c/#i/${token}`));
  assert.match(t.sent[0].subject, /^Deposit invoice INV-X-D: Harbour/);
  assert.match(sends.getSend(db, voided.id).error, /voided/);
  assert.equal(db.prepare("SELECT public_token FROM invoices WHERE id = 'inv_m2'").get().public_token, null, 'no link made for a refused one');
});

test('APP_URL: only an absolute http(s) address counts; blank or relative fails the send with no_app_url (C7)', async () => {
  const { appUrlOf } = require('../src/config');
  assert.equal(appUrlOf('https://lsc.github.io/billing'), 'https://lsc.github.io/billing/');
  assert.equal(appUrlOf(' https://lsc.github.io/billing/// '), 'https://lsc.github.io/billing/');
  assert.equal(appUrlOf('http://localhost:5173'), 'http://localhost:5173/');
  for (const bad of [undefined, '', '   ', '/', 'lsc.github.io/billing', 'javascript:alert(1)', 'ftp://x.example/']) {
    assert.equal(appUrlOf(bad), '', String(bad));
  }
  for (const appUrl of ['', '/']) {
    const p = seedProject();
    const transport = stub();
    const box = outboxFor(transport, { appUrl });
    const row = sends.addSend(db, { docKind: 'estimate', docId: p.eid, versionId: p.vid, toEmail: 'a@b.co', scheduledFor: iso(T0) }, iso(T0));
    assert.deepEqual(await box.runDue(), { sent: 0, failed: 1 }, JSON.stringify(appUrl));
    assert.match(sends.getSend(db, row.id).error, /APP_URL/);
    assert.equal(transport.sent.length, 0, 'nothing mailed with a relative link');
  }
});
