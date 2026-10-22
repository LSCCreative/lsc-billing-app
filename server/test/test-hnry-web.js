'use strict';

/**
 * What the screens say about an invoice and Hnry (hnry-invoicing H6): web/js/hnry.js,
 * loaded in a sandbox the way the browser runs it, called state by state. Pure
 * logic only; how it looks is checked in the browser.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'js', 'hnry.js'), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const calls = [];
const sandbox = {
  LSCUtil: { esc, today: () => '2026-10-22' },
  LSCApi: { get: async (u) => { calls.push(['GET', u]); return { enabled: true }; }, post: async (u, b) => { calls.push(['POST', u, b]); return {}; } },
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
};
const H = vm.runInNewContext(SRC + '\nLSCHnry', sandbox);
/* What the sandbox hands back, as plain objects of this realm (deepEqual compares prototypes). */
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const D = (i, c) => plain(H.describe(i, c));

const gid = (n) => Buffer.from(`gid://hnry/Invoice/${n}`).toString('base64');
const inv = (o = {}) => ({
  kind: 'deposit', status: 'draft', number: 'INV-X-D', hnryInvoiceId: null, hnryNumber: null, hnryPushedAt: null, hnryLinesDone: null, hnryError: null, ...o,
});
const inHnry = (o = {}) => inv({ hnryInvoiceId: gid(8890452), hnryNumber: 'INV-10670000', hnryPushedAt: '2026-10-22T01:00:00.000Z', hnryLinesDone: 1, ...o });
const ON = { enabled: true, depositInHnry: true };

test('Hnry has nothing to say about an invoice it has no part in', () => {
  assert.equal(D(inv({ kind: 'legacy' }), ON), null);
  assert.equal(D(inv({ status: 'void' }), ON), null);
  assert.equal(D(inv(), { enabled: false }), null, 'Hnry not set up and the invoice not in it');
  assert.equal(D(inv({ status: 'sent' }), ON), null, 'one the app sent');
  assert.equal(D(inv({ status: 'paid' }), ON), null);
  assert.equal(D(null, ON), null);
});

test('an old failed push on an invoice the app has since sent is not shown (nothing to retry)', () => {
  for (const status of ['sent', 'scheduled', 'paid']) {
    assert.equal(D(inv({ status, hnryError: 'zapier_error' }), ON), null, status);
  }
  assert.equal(D(inv({ status: 'draft', hnryError: 'zapier_error' }), ON).chip, 'Hnry error');
});

test('a whole draft in Hnry: check it there, send it from there, then mark it sent here', () => {
  const d = D(inHnry(), ON);
  assert.deepEqual([d.chip, d.tone, d.line, d.open, d.markSent], ['In Hnry', 'info', 'ok', true, true]);
  assert.deepEqual(d.primary, { id: 'hnry-open', label: 'Open in Hnry' });
  assert.match(d.text, /Check it there, send it from Hnry, then mark it sent here/);
  // Still described when Hnry is switched off on this server: the invoice is in it.
  assert.equal(D(inHnry(), { enabled: false }).chip, 'In Hnry');
});

test('once sent or paid the app\'s own words take over, and Hnry stays one click away', () => {
  const sent = D(inHnry({ status: 'sent' }), ON);
  assert.deepEqual([sent.chip, sent.text, sent.primary, sent.open, sent.markSent], [null, 'Sent from Hnry.', null, true, false]);
  const paid = D(inHnry({ status: 'paid' }), ON);
  assert.deepEqual([paid.chip, paid.text, paid.open, paid.markSent], [null, '', true, false]);
});

test('part-way: says how far, warns to look at the draft first, and offers Retry', () => {
  const d = D(inv({ kind: 'final', hnryInvoiceId: gid(1), hnryNumber: 'INV-2', hnryLinesDone: 2, hnryError: 'timeout' }), ON);
  assert.deepEqual([d.chip, d.tone, d.line, d.open, d.markSent], ['Part in Hnry', 'alert', 'err', true, false]);
  assert.deepEqual(d.primary, { id: 'hnry-push', label: 'Retry in Hnry' });
  assert.match(d.text, /Hnry took too long to answer/);
  assert.match(d.text, /2 lines so far/);
  assert.match(d.text, /look at it in Hnry before you retry/);
  assert.match(D(inv({ hnryInvoiceId: gid(1), hnryLinesDone: 1 }), ON).text, /1 line so far/);
});

test('a failure says why; Retry only where trying again could help', () => {
  for (const code of ['timeout', 'zapier_error', 'unexpected_shape', 'internal']) {
    const d = D(inv({ hnryError: code }), ON);
    assert.deepEqual([d.chip, d.line, d.primary && d.primary.id], ['Hnry error', 'err', 'hnry-push'], code);
  }
  for (const code of ['gst_registered', 'zero_amount', 'amount_mismatch', 'no_client', 'deposit_not_in_hnry', 'bad_input']) {
    const d = D(inv({ hnryError: code }), ON);
    assert.deepEqual([d.chip, d.primary], ['Hnry error', null], code);
    assert.ok(d.text.length > 10);
  }
  assert.match(D(inv({ hnryError: 'gst_registered' }), ON).text, /GST/);
  assert.equal(D(inv({ hnryError: 'a_new_code' }), ON).primary.id, 'hnry-push', 'an unknown code can be retried');
});

test('every failure code the server can record has its own words', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'hnry-push.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'hnry.js'), 'utf8');
  // `not_configured` is never recorded on an invoice: with Hnry off, nothing is pushed and nothing is written.
  const codes = new Set([...server.matchAll(/(?:PlanError|HnryError)\('([a-z_]+)'/g)].map((m) => m[1]).concat(['gst_registered', 'hnry_changed']));
  codes.delete('not_configured');
  for (const code of codes) assert.ok(H.WORDS[code], `${code} has words`);
});

test('not in Hnry yet: a deposit or single just goes; a final asks first; a final waits for its deposit', () => {
  const dep = D(inv(), ON);
  assert.deepEqual([dep.chip, dep.primary], ['Not in Hnry', { id: 'hnry-push', label: 'Create in Hnry' }]);
  assert.equal(dep.defer, undefined);
  const fin = D(inv({ kind: 'final' }), ON);
  assert.deepEqual(fin.primary, { id: 'hnry-push', label: 'Create in Hnry…', confirm: true });
  assert.match(fin.text, /Add any extras, then create it in Hnry/);
  const early = D(inv({ kind: 'final' }), { enabled: true, depositInHnry: false });
  assert.deepEqual([early.primary, early.defer], [null, true]);
  assert.match(early.text, /Create the deposit invoice in Hnry first/);
});

test('a final whose deposit the app sent itself stays on the old path: Hnry says nothing', () => {
  const final = inv({ kind: 'final' });
  assert.equal(D(final, { enabled: true, depositInHnry: false, depositByApp: true }), null);
  assert.ok(D(final, { enabled: true, depositInHnry: false, depositByApp: false }), 'still Hnry\'s when no deposit went out the old way');
});

test('a project\'s Hnry address: a draft opens in Hnry\'s editor, the rest go to its invoice list', () => {
  assert.equal(H.urlOf(inHnry()), 'https://app.hnry.io/invoices/8890452/edit');
  assert.equal(H.urlOf(inHnry({ status: 'sent' })), 'https://app.hnry.io/invoices');
  assert.equal(H.urlOf(inv({ hnryInvoiceId: '!!not base64!!' })), 'https://app.hnry.io/invoices');
  assert.equal(H.urlOf(inv({ hnryInvoiceId: Buffer.from('gid://hnry/Client/5').toString('base64') })), 'https://app.hnry.io/invoices', 'not an invoice id');
  assert.equal(H.urlOf(inv()), null);
  assert.equal(H.numericId(inHnry()), '8890452');
});

test('Hnry\'s own date defaults: issued today, due in 20 days, across months and a leap year', () => {
  assert.deepEqual(plain(H.defaultDates('2026-10-22')), { issuedAt: '2026-10-22', dueAt: '2026-11-11' });
  assert.equal(H.defaultDates('2026-12-20').dueAt, '2027-01-09');
  assert.equal(H.defaultDates('2028-02-15').dueAt, '2028-03-06');
});

test('the status line is one escaped paragraph in the email line\'s own shape, or nothing', () => {
  assert.equal(H.lineMarkup(null, 'x'), '');
  assert.equal(H.lineMarkup({ text: '', line: '' }, 'x'), '');
  const m = H.lineMarkup({ text: 'A <b>draft</b> & more', line: 'ok' }, 'invoice "A"');
  assert.match(m, /^<p class="send-status hnry-status is-ok" data-hnry-for="invoice &quot;A&quot;">/);
  assert.match(m, /A &lt;b&gt;draft&lt;\/b&gt; &amp; more/);
  assert.ok(!/<b>/.test(m));
  assert.match(H.lineMarkup({ text: 't', line: '' }, 'x'), /class="send-status hnry-status"/);
});

test('whether Hnry is set up is asked once, and a failed ask reads as "not set up" without being remembered', async () => {
  calls.length = 0;
  assert.equal(H.enabled(), false, 'unknown until asked');
  const s = plain(await H.ready());
  assert.equal(s.enabled, true);
  assert.equal(H.enabled(), true);
  await H.ready();
  assert.deepEqual(calls.filter((c) => c[0] === 'GET'), [['GET', '/api/hnry/status']], 'asked once');

  let asked = 0;
  const down = vm.runInNewContext(SRC + '\nLSCHnry', { ...sandbox, LSCApi: { get: async () => { asked += 1; throw new Error('offline'); } } });
  assert.deepEqual(plain(await down.ready()), { enabled: false });
  assert.equal(down.enabled(), false);
  await down.ready();
  assert.equal(asked, 2, 'a failed ask is asked again, not remembered');
});

test('a whole draft changed here since it went to Hnry says so: out of date, open it there, then mark it sent', () => {
  const d = D(inHnry({ kind: 'final', hnryError: 'hnry_changed' }), ON);
  assert.deepEqual([d.chip, d.tone, d.line, d.open, d.markSent], ['Hnry out of date', 'alert', 'err', true, true]);
  assert.deepEqual(d.primary, { id: 'hnry-open', label: 'Open in Hnry' });
  assert.match(d.text, /out of date/);
  // Part-way and changed: no Retry on top of the old lines.
  const part = D(inv({ kind: 'final', hnryInvoiceId: gid(1), hnryLinesDone: 2, hnryError: 'hnry_changed' }), ON);
  assert.deepEqual(part.primary, { id: 'hnry-open', label: 'Open in Hnry' });
  assert.doesNotMatch(part.text, /before you retry/);
  // Once sent, the app's own words again.
  assert.equal(D(inHnry({ status: 'sent', hnryError: 'hnry_changed' }), ON).chip, null);
});

test('both screens build describe()\'s context the same way from the project\'s invoices', () => {
  const c = (list) => { const x = plain(H.contextFor(list)); delete x.enabled; return x; };
  const none = { depositInHnry: false, depositByApp: false };
  assert.deepEqual(c(undefined), none);
  assert.deepEqual(c([]), none);
  assert.deepEqual(c([inHnry()]), { depositInHnry: true, depositByApp: false });
  assert.deepEqual(c([inHnry({ status: 'void' })]), none);
  assert.deepEqual(c([inv({ status: 'sent' })]), { depositInHnry: false, depositByApp: true });
  assert.deepEqual(c([inv({ kind: 'final', status: 'sent' })]), none, 'only a deposit counts');
});

test('the push toast, and Open in Hnry in a new tab (nothing for an invoice not in it)', () => {
  assert.equal(H.pushedText({ hnry: { ok: true, already: true } }), 'It’s already in Hnry.');
  assert.equal(H.pushedText({ hnry: { ok: true, hnryNumber: 'INV-1' } }), 'In Hnry as INV-1. Check the draft there before you send it.');
  const opened = [];
  sandbox.window = { open: (...a) => opened.push(a) };
  H.open(inHnry());
  H.open(inv());
  H.open(undefined);
  assert.deepEqual(plain(opened), [['https://app.hnry.io/invoices/8890452/edit', '_blank', 'noopener']]);
});
