'use strict';

/* The estimate and invoice settings and the service agreement's fill-in
 * fields (production-booking task 21): src/documents.js, and its browser copy,
 * which the Settings screen previews an agreement through. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const {
  DOC_DEFAULTS, MESSAGE_KINDS, docSettings, AGREEMENT_FIELDS, agreementValues, fillAgreement,
} = require('../src/documents');
const { buildEstimateHtml } = require('../src/pdf');

// ── The copy discipline ─────────────────────────────────────────────────────

test('web/js/documents.js is a byte-identical copy of the server file', () => {
  const server = readFileSync(join(__dirname, '..', 'src', 'documents.js'));
  const web = readFileSync(join(__dirname, '..', '..', 'web', 'js', 'documents.js'));
  assert.ok(
    server.equals(web),
    'server/src/documents.js and web/js/documents.js have drifted. Re-copy the server file over ' +
    'the web one; the Settings preview must fill an agreement exactly as signing will.',
  );
});

test('the browser copy loads as a plain script, before the screens that read it', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
  const at = (f) => html.indexOf('js/' + f);
  assert.ok(at('documents.js') > 0);
  for (const reader of ['views/project-folder.js', 'views/invoice.js', 'views/settings.js']) {
    assert.ok(at('documents.js') < at(reader), 'documents.js must load before ' + reader);
  }
  // Loaded beside another script that declares the same names, as the
  // browser's one global scope would have them: the wrapper keeps its own.
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext('const MONTHS = 1; const dayDate = 2;', ctx);
  vm.runInContext(readFileSync(join(__dirname, '..', '..', 'web', 'js', 'documents.js'), 'utf8'), ctx);
  assert.equal(typeof sandbox.LSCDocuments.fillAgreement, 'function');
});

// ── docSettings ─────────────────────────────────────────────────────────────

test('a settings row from before task 21 reads as the defaults', () => {
  for (const settings of [null, {}, { business: { name: 'LSC' }, gst: { registered: true } }]) {
    const d = docSettings(settings);
    assert.equal(d.depositPct, 50);
    assert.equal(d.validDays, 30);
    assert.equal(d.dueDays, 14);
    assert.equal(d.faqUrl, 'https://lsccreative.studio/faq.html');
    assert.equal(d.agreementText, '');
    assert.deepEqual(Object.keys(d.messages), MESSAGE_KINDS);
    for (const k of MESSAGE_KINDS) assert.equal(d.messages[k], DOC_DEFAULTS.messages[k]);
  }
});

test('stored values win, and a cleared message or FAQ link stays cleared', () => {
  const d = docSettings({
    invoicing: { depositPct: 33.5, validDays: 7, dueDays: 0 },
    messages: { estimate: 'Hi!', deposit: '' },
    agreement: { text: 'Terms', faqUrl: '' },
  });
  assert.equal(d.depositPct, 33.5);
  assert.equal(d.validDays, 7);
  assert.equal(d.dueDays, 0); // due on the day it's issued
  assert.equal(d.messages.estimate, 'Hi!');
  assert.equal(d.messages.deposit, ''); // a choice, not a gap
  assert.equal(d.messages.final, DOC_DEFAULTS.messages.final);
  assert.equal(d.faqUrl, ''); // D55: the button hides
  assert.equal(d.agreementText, 'Terms');
});

test('unusable stored values fall back to the default', () => {
  const bad = [
    [{ depositPct: 0 }, 'depositPct', 50], // 0% is a single invoice, not a deposit
    [{ depositPct: 101 }, 'depositPct', 50],
    [{ depositPct: '40' }, 'depositPct', 50],
    [{ depositPct: NaN }, 'depositPct', 50],
    [{ validDays: 0 }, 'validDays', 30], // would expire as it was sent
    [{ validDays: 2.5 }, 'validDays', 30],
    [{ validDays: 366 }, 'validDays', 30],
    [{ dueDays: -1 }, 'dueDays', 14],
    [{ dueDays: '14' }, 'dueDays', 14],
  ];
  for (const [invoicing, key, want] of bad) {
    assert.equal(docSettings({ invoicing })[key], want, JSON.stringify(invoicing));
  }
  assert.equal(docSettings({ invoicing: { depositPct: 100 } }).depositPct, 100);
  assert.equal(docSettings({ invoicing: { validDays: 365, dueDays: 365 } }).validDays, 365);
  assert.equal(docSettings({ messages: { final: 7 } }).messages.final, DOC_DEFAULTS.messages.final);
});

// ── The agreement ───────────────────────────────────────────────────────────

const PROJECT = {
  client: { businessName: 'Acme Pty Ltd', contactName: 'Sam Lee', abn: '51824753556' },
  upid: 'B210',
  projectName: 'Spring campaign',
  totalIncGst: 12345.6,
  depositPct: 40,
  days: [
    { date: null, status: 'proposed', startTime: '', endTime: '' },
    { date: '2026-10-16', status: 'pencilled', startTime: '18:00', endTime: '02:00' },
    { date: '2026-10-14', status: 'confirmed', startTime: '07:00', endTime: '17:00' },
  ],
  business: { name: 'Lachlan Sullivan-Carey', abn: '12 345 678 901' },
  today: '2026-10-04',
};

test('every field has a value, in the words the client PDF uses', () => {
  const v = agreementValues(PROJECT);
  assert.deepEqual(Object.keys(v).sort(), AGREEMENT_FIELDS.map((f) => f.key).sort());
  assert.equal(v.client_business, 'Acme Pty Ltd');
  assert.equal(v.client_contact, 'Sam Lee');
  assert.equal(v.client_abn, '51 824 753 556');
  assert.equal(v.upid, 'B210');
  assert.equal(v.project_name, 'Spring campaign');
  assert.equal(v.total, '$12,345.60');
  assert.equal(v.deposit_pct, '40%');
  assert.equal(v.business_name, 'Lachlan Sullivan-Carey');
  assert.equal(v.business_abn, '12 345 678 901');
  assert.equal(v.date, '4 October 2026');
  // Dated days first, in date order; a day with no date last.
  assert.equal(v.production_days, [
    'Wednesday 14 October 2026 · Confirmed · 7:00am–5:00pm',
    'Friday 16 October 2026 · Pencilled · 6:00pm–2:00am (ends next day)',
    'Date TBC · Proposed',
  ].join('\n'));
});

test('a day reads as it does on the client PDF', () => {
  const estimate = {
    upid: 'B210', name: 'Spring campaign', date: '2026-10-04', client: PROJECT.client, activeRows: {},
    totals: { totalIncGst: 0 }, days: [{ id: 'd1', date: '2026-10-16', status: 'pencilled', startTime: '18:00', endTime: '02:00' }],
  };
  const html = buildEstimateHtml(estimate, { labourSections: [] }, {});
  const line = agreementValues({ days: estimate.days }).production_days;
  const [date, word, times] = line.split(' · ');
  assert.ok(html.includes(date), 'the PDF prints the date as ' + date);
  assert.ok(html.includes(word + ' &middot; ' + times), 'the PDF prints the status and times as ' + word + ' · ' + times);
});

test('missing inputs give blanks, never "undefined"', () => {
  const v = agreementValues({});
  for (const f of AGREEMENT_FIELDS) assert.equal(v[f.key], '', f.key);
  // A single invoice has no deposit.
  assert.equal(agreementValues({ depositPct: null }).deposit_pct, '');
  assert.equal(agreementValues({ totalIncGst: 0 }).total, '$0.00');
});

test('fillAgreement fills known fields and reports the rest', () => {
  const values = agreementValues(Object.assign({}, PROJECT, { client: { businessName: 'Acme Pty Ltd' } }));
  const r = fillAgreement(
    'Between {business_name} and {client_business} (ABN {client_abn}).\n' +
    'Project {UPID}: { project_name }, {total}, deposit {deposit_pct}.\n' +
    'Ref {clinet_business} and {client_business} again. {not a field}',
    values,
  );
  assert.equal(r.text,
    'Between Lachlan Sullivan-Carey and Acme Pty Ltd (ABN ).\n' +
    'Project B210: Spring campaign, $12,345.60, deposit 40%.\n' +
    'Ref {clinet_business} and Acme Pty Ltd again. {not a field}');
  assert.deepEqual(r.unknown, ['{clinet_business}']);
  assert.deepEqual(r.blank, ['client_abn']);
});

test('fillAgreement on empty text, and a value is never re-read as a field', () => {
  assert.deepEqual(fillAgreement('', {}), { text: '', unknown: [], blank: [] });
  assert.deepEqual(fillAgreement(null, {}), { text: '', unknown: [], blank: [] });
  const r = fillAgreement('{client_business} / {upid}', { client_business: '{upid}', upid: 'B1' });
  assert.equal(r.text, '{upid} / B1');
});
