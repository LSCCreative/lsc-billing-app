'use strict';

/* The stage line's words (production-booking task 17). The server decides
 * where a project is (src/projects.js projectStage); the browser's
 * web/js/project-card.js stageLine says it, and the Projects list, the
 * client's projects and the project folder all print that one function. This
 * loads it the way the browser does, into one shared scope after util.js and
 * calendar.js, and pins the words for every step the server can return. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { projectStage } = require('../src/projects');

const webDir = join(__dirname, '..', '..', 'web', 'js');
const sandbox = { console, Intl };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
// Same order as index.html. Top-level consts don't land on the sandbox, so
// the card is read back out by name.
for (const file of ['util.js', 'calendar.js', 'project-card.js']) {
  vm.runInContext(readFileSync(join(webDir, file), 'utf8'), ctx, { filename: file });
}
const ProjectCard = vm.runInContext('ProjectCard', ctx);

const TODAY = '2026-10-04';
const say = (stage, detail, today) => {
  const l = ProjectCard.stageLine({ stage, stageDetail: detail }, today || TODAY);
  return l.word + (l.note ? ' · ' + l.note : '') + (l.alert ? ' !' : '');
};

test('project-card.js loads after util.js and calendar.js, as index.html orders them', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
  const at = (f) => html.indexOf('js/' + f);
  assert.ok(at('util.js') < at('calendar.js') && at('calendar.js') < at('project-card.js'));
  assert.ok(at('project-card.js') < at('views/project-list.js') && at('project-card.js') < at('views/clients.js'));
});

test('the stage line words every step', () => {
  assert.equal(say('draft', { step: 'draft' }), 'Draft');
  assert.equal(say('sent', { step: 'sent' }), 'Sent');
  assert.equal(say('sent', { step: 'sent', at: '2026-10-02T03:00:00.000Z' }), 'Sent · 2 Oct');
  assert.equal(say('sent', { step: 'sent', version: 2, validUntil: '2026-10-14' }), 'Sent v2 · valid until 14 Oct');
  // Valid through its last day; expired the day after (D44, derived).
  assert.equal(say('sent', { step: 'sent', version: 1, validUntil: TODAY }), 'Sent v1 · valid until 4 Oct');
  assert.equal(say('sent', { step: 'sent', version: 1, validUntil: '2026-10-03' }), 'Sent v1 · expired 3 Oct !');
  assert.equal(say('accepted', { step: 'accepted' }), 'Accepted · invoices not created');
  assert.equal(say('accepted', { step: 'deposit_draft' }), 'Accepted · deposit not sent');
  assert.equal(say('accepted', { step: 'deposit_scheduled' }), 'Accepted · deposit scheduled');
  assert.equal(say('accepted', { step: 'final_draft' }), 'Accepted · final not sent');
  assert.equal(say('accepted', { step: 'single_draft' }), 'Accepted · invoice not sent');
  assert.equal(say('accepted', { step: 'single_scheduled' }), 'Accepted · invoice scheduled');
  assert.equal(say('invoiced', { step: 'deposit_paid' }), 'Deposit paid · final not sent');
  assert.equal(say('invoiced', { step: 'final_scheduled' }), 'Deposit paid · final scheduled');
  assert.equal(say('invoiced', { step: 'deposit_sent' }), 'Deposit sent · unpaid');
  assert.equal(say('invoiced', { step: 'deposit_sent', dueAt: TODAY }), 'Deposit sent · due 4 Oct');
  assert.equal(say('invoiced', { step: 'deposit_sent', dueAt: '2026-10-03' }), 'Deposit overdue · was due 3 Oct !');
  assert.equal(say('invoiced', { step: 'final_sent', dueAt: '2026-11-01' }), 'Final sent · due 1 Nov');
  assert.equal(say('invoiced', { step: 'single_sent', dueAt: '2027-01-10' }), 'Invoice sent · due 10 Jan 2027');
  assert.equal(say('invoiced', { step: 'legacy', number: 'INV-0042' }), 'Invoiced · INV-0042, made the old way');
  assert.equal(say('invoiced', { step: 'legacy', number: null }), 'Invoiced · made the old way');
  assert.equal(say('paid', { step: 'paid', at: '2026-09-25' }), 'Paid · 25 Sep');
  assert.equal(say('paid', { step: 'paid', at: null }), 'Paid');
  assert.equal(say('declined', { step: 'declined', at: '2025-12-01T00:00:00.000Z' }), 'Declined · 1 Dec 2025');
});

test('every step the server returns has words of its own', () => {
  const inv = (kind, status) => ({ kind, status });
  const cases = [
    [{}, [{ status: 'draft' }], []],
    [{}, [{ status: 'sent' }], []],
    [{}, [{ status: 'accepted' }], []],
    [{ declined_at: 'x' }, [], []],
    ...['draft', 'scheduled', 'sent'].flatMap((st) => [
      [{}, [], [inv('deposit', st)]],
      [{}, [], [inv('deposit', 'paid'), inv('final', st)]],
      [{}, [], [inv('final', st)]],
      [{}, [], [inv('single', st)]],
    ]),
    [{}, [], [inv('legacy', 'draft')]],
    [{}, [], [inv('single', 'paid')]],
  ];
  const steps = new Set();
  for (const [project, estimates, invoices] of cases) {
    const where = projectStage(project, estimates, invoices);
    const { stage, ...detail } = where;
    steps.add(detail.step);
    const line = ProjectCard.stageLine({ stage, stageDetail: detail }, TODAY);
    if (detail.step !== 'draft') assert.notEqual(line.word, 'Draft', `${detail.step} fell through to Draft`);
  }
  assert.equal(steps.size, 16);
});

test('the stage line markup escapes what it prints and marks the stage', () => {
  const html = ProjectCard.stageMarkup({ stage: 'invoiced', stageDetail: { step: 'legacy', number: '<b>1</b>' } }, TODAY);
  assert.match(html, /^<p class="stage-line is-invoiced">/);
  assert.ok(html.includes('&lt;b&gt;1&lt;/b&gt;'));
  assert.match(ProjectCard.stageMarkup({ stage: 'x y', stageDetail: {} }, TODAY), /is-draft/);
  assert.match(ProjectCard.stageMarkup({ stage: 'sent', stageDetail: { step: 'sent', validUntil: '2026-01-01' } }, TODAY), /is-sent is-alert/);
});

test('a timestamp is read on the browser\'s clock, a plain date as it is (task 18)', () => {
  const was = process.env.TZ;
  process.env.TZ = 'Australia/Sydney'; // AEDT, UTC+11 from 4 Oct 2026
  try {
    // 10:13 pm on the 3rd in UTC is 9:13 am on the 4th in Sydney.
    assert.equal(ProjectCard.localDate('2026-10-03T22:13:00.000Z'), '2026-10-04');
    assert.equal(ProjectCard.dayMonth('2026-10-03T22:13:00.000Z', TODAY), '4 Oct');
    assert.equal(say('declined', { step: 'declined', at: '2026-10-03T22:13:00.000Z' }), 'Declined · 4 Oct');
    // A calendar date never moves.
    assert.equal(ProjectCard.localDate('2026-10-03'), '2026-10-03');
    assert.equal(say('paid', { step: 'paid', at: '2026-10-03' }), 'Paid · 3 Oct');
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});

test('the project folder loads after the card it prints', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
  const at = (f) => html.indexOf('js/' + f);
  assert.ok(at('project-card.js') < at('views/project-folder.js') && at('views/estimates.js') < at('views/project-folder.js'));
  assert.ok(at('views/project-folder.js') < at('app.js'));
});

test('activity reads the same in the folder and on Home: one function (task 22)', () => {
  const say22 = (kind, detail) => ProjectCard.activityText({ kind, detail }, TODAY);
  assert.equal(say22('sent', { validUntil: '2026-10-18' }), 'Marked sent, valid until 18 Oct');
  assert.equal(say22('sent', {}), 'Marked sent');
  assert.equal(say22('accepted', { invoicing: 'pair', depositPct: 40, invoices: ['INV-A-D', 'INV-A-F'] }),
    'Marked accepted · INV-A-D, INV-A-F (40% deposit)');
  assert.equal(say22('invoices_created', { invoicing: 'single', invoices: ['INV-A'] }), 'Invoices created · INV-A');
  assert.equal(say22('invoice_sent', { number: 'INV-A-D', dueAt: '2027-01-02' }), 'INV-A-D marked sent, due 2 Jan 2027');
  assert.equal(say22('invoice_paid', { number: 'INV-A-D', amount: 2000, via: 'bank' }), 'INV-A-D paid, $2,000.00 by bank transfer');
  assert.equal(say22('invoice_paid', { amount: 12.5, via: 'card' }), 'Invoice paid, $12.50 by card');
  assert.equal(say22('declined', {}), 'Declined');
  // Signed on the client's page (task 27).
  assert.equal(say22('signed', { version: 1, signedBy: 'Priya Nair', role: 'Producer', invoicing: 'pair', depositPct: 50, invoices: ['INV-A-D', 'INV-A-F'] }),
    'Client signed and accepted · Priya Nair, Producer · INV-A-D, INV-A-F (50% deposit)');
  assert.equal(say22('signed', { version: 2, signedBy: 'Priya Nair', role: 'Producer', invoices: [], invoiceProblem: 'needs_upid' }),
    'Client signed and accepted v2 · Priya Nair, Producer · no invoices made yet');
  assert.equal(ProjectCard.activityText({ kind: 'estimate_opened' }, TODAY), 'Estimate opened');
});

test('a send reads by how it went: emailed now or later, or by link (task 29)', () => {
  const say29 = (kind, detail) => ProjectCard.activityText({ kind, detail }, TODAY);
  assert.equal(say29('sent', { version: 2, validUntil: '2026-11-03', by: 'email', to: 'priya@salt.example' }),
    'Sent v2 by email to priya@salt.example, valid until 3 Nov');
  assert.match(say29('sent', { version: 1, validUntil: '2026-11-03', by: 'email', scheduledFor: '2026-10-07T22:00:00.000Z' }),
    /^Scheduled v1 to email \d+ Oct, \d+:00\s?[ap]m, valid until 3 Nov$/);
  assert.equal(say29('sent', { version: 3, by: 'link' }), 'Sent v3 by link');
  assert.equal(say29('invoice_sent', { number: 'INV-A-D', dueAt: '2026-10-18', by: 'email' }), 'INV-A-D emailed, due 18 Oct');
  assert.equal(say29('invoice_sent', { number: 'INV-A-D', by: 'email', late: true }), 'INV-A-D emailed late');
  assert.equal(say29('invoice_sent', { number: 'INV-A-F', dueAt: '2026-10-18', by: 'link' }), 'INV-A-F sent by link, due 18 Oct');
});

test('a document’s email line: scheduled, going, sent, sent late, failed, cancelled (D47)', () => {
  vm.runInContext(readFileSync(join(webDir, 'send-panel.js'), 'utf8'), ctx, { filename: 'send-panel.js' });
  const SendPanel = vm.runInContext('SendPanel', ctx);
  const local = (h, m, dayOffset = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const base = { id: 'snd_1', to: 'priya@salt.example' };
  const s = (extra) => SendPanel.statusOf({ ...base, ...extra });
  const tomorrow9 = s({ status: 'scheduled', scheduledFor: local(9, 0, 1) });
  assert.match(tomorrow9.text, /^Email scheduled tomorrow, 9:00\s?am to priya@salt\.example$/);
  assert.deepEqual([...tomorrow9.acts], ['edit', 'cancel']);
  assert.match(s({ status: 'scheduled', scheduledFor: local(9, 0, 9) }).text, /^Email scheduled (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w{3}( \d{4})?, 9:00/);
  assert.equal(s({ status: 'sending' }).acts.length, 0);
  assert.match(s({ status: 'sent', sentAt: local(11, 42), scheduledFor: local(11, 41), late: false }).text, /^Emailed today, 11:42\s?am to priya/);
  // D47's own example: the same day reads as times only.
  assert.match(s({ status: 'sent', sentAt: local(11, 42), scheduledFor: local(9, 0), late: true }).text,
    /^Sent late at 11:42\s?am \(scheduled 9:00\s?am\)$/);
  assert.match(s({ status: 'sent', sentAt: local(8, 5), scheduledFor: local(9, 0, -1), late: true }).text,
    /^Sent late at today, 8:05\s?am \(scheduled yesterday|^Sent late at today, 8:05\s?am \(scheduled \w{3} \d+ \w{3}, 9:00/);
  const failed = s({ status: 'failed', error: 'Email isn’t set up yet.' });
  assert.deepEqual([failed.text, failed.tone, [...failed.acts]], ['Email failed: Email isn’t set up yet.', 'err', ['retry', 'cancel']]);
  assert.equal(s({ status: 'cancelled' }).text, 'Email cancelled');
  assert.equal(SendPanel.statusOf(null), null);
  // An estimate's line names the version it sent.
  assert.match(s({ status: 'sent', version: 2, sentAt: local(11, 42), scheduledFor: local(11, 42) }).text, /^v2 emailed today, 11:42/);
  assert.match(s({ status: 'scheduled', version: 3, scheduledFor: local(9, 0, 1) }).text, /^Email of v3 scheduled tomorrow/);
  assert.equal(s({ status: 'scheduled', scheduledFor: local(0, 0, -1) }).text, 'Sending the email now…');
  // The buttons name their document, and nothing in the line is markup.
  const html = SendPanel.statusMarkup({ ...base, status: 'failed', error: '<b>boom</b>' }, 'INV-A-D');
  assert.match(html, /aria-label="Retry — the email of INV-A-D"/);
  assert.doesNotMatch(html, /<b>/);
});

test('Home loads after the card whose words it prints', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
  const at = (f) => html.indexOf('js/' + f);
  assert.ok(at('project-card.js') > 0 && at('project-card.js') < at('views/home.js'));
});
