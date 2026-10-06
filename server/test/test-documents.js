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
  DEFAULT_CLAUSES, FALLBACK_TEXT, agreementText,
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
    assert.deepEqual(d.agreement, { intro: DOC_DEFAULTS.agreementIntro, clauses: DEFAULT_CLAUSES, hourlyRate: 63 });
    assert.equal('agreementText' in d, false, 'the free text is retired');
    assert.deepEqual(Object.keys(d.messages), MESSAGE_KINDS);
    for (const k of MESSAGE_KINDS) assert.equal(d.messages[k], DOC_DEFAULTS.messages[k]);
  }
});

test('stored values win, and a cleared message or FAQ link stays cleared', () => {
  const d = docSettings({
    invoicing: { depositPct: 33.5, validDays: 7, dueDays: 0 },
    messages: { estimate: 'Hi!', deposit: '' },
    agreement: { text: 'Old free text', faqUrl: '', intro: '', hourlyRate: 80, clauses: [{ id: 'x', title: 'Only', body: 'B', subs: [] }] },
  });
  assert.equal(d.depositPct, 33.5);
  assert.equal(d.validDays, 7);
  assert.equal(d.dueDays, 0); // due on the day it's issued
  assert.equal(d.messages.estimate, 'Hi!');
  assert.equal(d.messages.deposit, ''); // a choice, not a gap
  assert.equal(d.messages.final, DOC_DEFAULTS.messages.final);
  assert.equal(d.faqUrl, ''); // D55: the button hides
  assert.deepEqual(d.agreement, { intro: '', hourlyRate: 80, clauses: [{ id: 'x', title: 'Only', body: 'B', subs: [] }] });
  // A rate cleared on purpose stays cleared; an unusable one is the default.
  assert.equal(docSettings({ agreement: { hourlyRate: null } }).agreement.hourlyRate, null);
  for (const bad of ['63', -1, NaN, Infinity]) assert.equal(docSettings({ agreement: { hourlyRate: bad } }).agreement.hourlyRate, 63);
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
  client: { businessName: 'Acme Pty Ltd', contactName: 'Sam Lee', abn: '51824753556', email: ' sam@acme.test ', phone: '0400 000 000' },
  upid: 'B210',
  projectName: 'Spring campaign',
  totalIncGst: 12345.6,
  depositPct: 40,
  depositTotal: 4938.24,
  balanceTotal: 7407.36,
  dueDays: 7,
  signatoryRole: 'Director',
  days: [
    { date: null, status: 'proposed', startTime: '', endTime: '' },
    { date: '2026-10-16', status: 'pencilled', startTime: '18:00', endTime: '02:00' },
    { date: '2026-10-14', status: 'confirmed', startTime: '07:00', endTime: '17:00' },
  ],
  business: { name: 'Lachlan Sullivan-Carey', abn: '12 345 678 901', email: ' studio@lsc.test ', phone: '0412 000 000', signer: 'Lachlan Sullivan-Carey' },
  hourlyRate: 63,
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
  assert.equal(v.deposit_amount, '$4,938.24');
  assert.equal(v.balance_amount, '$7,407.36');
  assert.equal(v.due_days, '7');
  assert.equal(v.client_email, 'sam@acme.test');
  assert.equal(v.client_phone, '0400 000 000');
  assert.equal(v.signatory_role, 'Director');
  assert.equal(v.business_name, 'Lachlan Sullivan-Carey');
  assert.equal(v.business_abn, '12 345 678 901');
  assert.equal(v.business_email, 'studio@lsc.test');
  assert.equal(v.business_phone, '0412 000 000');
  assert.equal(v.business_signer, 'Lachlan Sullivan-Carey');
  assert.equal(v.hourly_rate, '$63.00');
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
  // …and no deposit amount, even if one were passed.
  assert.equal(agreementValues({ depositPct: null, depositTotal: 10 }).deposit_amount, '');
  assert.equal(agreementValues({ dueDays: 0 }).due_days, '0');
  assert.equal(agreementValues({ dueDays: 2.5 }).due_days, '');
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

test('the deposit and balance amounts agree with the invoices calc.js makes', () => {
  const calc = require('../src/calc');
  const totals = { totalIncGst: 12345.6, gst: 0 };
  const deposit = calc.depositAmount(totals, 40);
  const v = agreementValues({
    totalIncGst: totals.totalIncGst, depositPct: 40,
    depositTotal: deposit.totalIncGst,
    balanceTotal: calc.finalInvoiceTotals(totals, null, deposit).balanceDue,
  });
  assert.equal(v.deposit_amount, '$4,938.24');
  assert.equal(v.balance_amount, '$7,407.36');
  // A single invoice: the balance is the whole total.
  assert.equal(agreementValues({ balanceTotal: calc.finalInvoiceTotals(totals, null, null).balanceDue }).balance_amount, '$12,345.60');
});

// ── docSettings: the clauses (ui-clarity task 4) ────────────────────────────

test('stored clauses are cleaned, never trusted: bad entries dropped, ids kept, a first sub never indented', () => {
  const { clauses } = docSettings({ agreement: { clauses: [
    null, 'text', [1],
    { id: 'keep', title: 'A', body: 7, subs: [null, { id: 's1', heading: 'H', text: 'T', indent: 1 }, { text: 'two', indent: 1 }, { id: 's3', indent: 2 }] },
    { title: 'No id' },
    { id: 'keep', title: 'Same id' },
  ] } }).agreement;
  assert.deepEqual(clauses, [
    { id: 'keep', title: 'A', body: '', subs: [
      { id: 's1', heading: 'H', text: 'T', indent: 0 },
      { id: 'sub1', heading: '', text: 'two', indent: 1 },
      { id: 's3', heading: '', text: '', indent: 0 },
    ] },
    { id: 'clause1', title: 'No id', body: '', subs: [] },
    { id: 'clause2', title: 'Same id', body: '', subs: [] },
  ]);
  // An empty list is a choice (the fallback text), not a gap.
  assert.deepEqual(docSettings({ agreement: { clauses: [] } }).agreement.clauses, []);
  assert.equal(docSettings({ agreement: { clauses: 'x' } }).agreement.clauses.length, 12);
});

test('the defaults are a fresh copy each time', () => {
  const a = docSettings({}).agreement;
  a.clauses[0].title = 'Changed';
  a.clauses[3].subs.pop();
  const b = docSettings({}).agreement;
  assert.equal(b.clauses[0].title, 'Services and Deliverables');
  assert.equal(b.clauses[3].subs.length, 3);
});

test('the default clauses are the user\'s 12, verbatim (U13)', () => {
  // test/fixtures/agreement-seed.json is the JSON the user gave (2026-10-05).
  // Put back the way it was typed: sub-clauses as "a. Heading. Text", an
  // indented one inline after its parent as "(i) Text", {hourly_rate} as $63.00.
  const seed = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'agreement-seed.json'), 'utf8'));
  const typed = DEFAULT_CLAUSES.map((c) => {
    const lettered = [];
    let roman = 0;
    c.subs.forEach((x) => {
      if (x.indent) {
        roman += 1;
        lettered[lettered.length - 1] += ' (' + 'i'.repeat(roman) + ') ' + x.text;
      } else {
        roman = 0;
        lettered.push(String.fromCharCode(97 + lettered.length) + '. ' + x.heading + '.' + (x.text ? ' ' + x.text : ''));
      }
    });
    return { title: c.title, body: [c.body].concat(lettered).filter(Boolean).join('\n\n').replace('{hourly_rate}', '$63.00') };
  });
  assert.deepEqual(typed, seed);
  assert.deepEqual(DEFAULT_CLAUSES.map((c) => c.id), ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c11', 'c12']);
});

// ── agreementText: the one render ───────────────────────────────────────────

const VALUES = agreementValues(PROJECT);
const clause = (id, title, body, subs) => ({ id, title, body: body || '', subs: subs || [] });
const termsOf = (text) => text.slice(text.indexOf('\n\nTERMS\n\n') + 9, text.lastIndexOf('\n\nSigned '));

test('clauses are numbered by their order, never by anything stored', () => {
  const clauses = [clause('a', 'One', 'x'), clause('b', 'Two', 'y'), clause('c', 'Three', 'z'), clause('d', 'Four', 'w')];
  clauses[2].number = 9; // a stray stored number is ignored
  assert.equal(termsOf(agreementText({ clauses }, VALUES).text), '1. One\nx\n\n2. Two\ny\n\n3. Three\nz\n\n4. Four\nw');
  // Clause 4 moved to position 2: everything after it renumbers.
  const moved = clauses.slice();
  moved.splice(1, 0, moved.splice(3, 1)[0]);
  assert.equal(termsOf(agreementText({ clauses: moved }, VALUES).text), '1. One\nx\n\n2. Four\nw\n\n3. Two\ny\n\n4. Three\nz');
  // An empty clause takes no number.
  const gap = [clause('a', 'One', 'x'), clause('e', '  ', ' \n '), clause('b', 'Two', 'y')];
  assert.equal(termsOf(agreementText({ clauses: gap }, VALUES).text), '1. One\nx\n\n2. Two\ny');
});

test('sub-clauses letter (a)(b)(c), indent to (i)(ii) under the one above, and restart under the next', () => {
  const sub = (heading, text, indent) => ({ id: heading + text, heading, text, indent: indent ? 1 : 0 });
  const c = clause('k', 'Cancellation', 'Intro text.', [
    sub('By the Client', ''),
    sub('', 'First.', 1),
    sub('', 'Second.', 1),
    sub('Postponement', 'Notice.'),
    sub('', '', 0), // blank: skipped, takes no letter
    sub('Who?', 'Ends a sentence already.'),
    sub('', 'Under (c).', 1),
    sub('', 'No heading.'),
  ]);
  assert.equal(termsOf(agreementText({ clauses: [c] }, VALUES).text), [
    '1. Cancellation\nIntro text.',
    '(a) By the Client.',
    '(i) First.',
    '(ii) Second.',
    '(b) Postponement. Notice.',
    '(c) Who? Ends a sentence already.',
    '(i) Under (c).',
    '(d) No heading.',
  ].join('\n\n'));
  // An indented first row has nothing to sit under: it is lettered.
  const first = clause('f', 'F', '', [sub('', 'Alone.', 1), sub('', 'Then.', 1)]);
  assert.equal(termsOf(agreementText({ clauses: [first] }, VALUES).text), '1. F\n(a) Alone.\n\n(i) Then.');
  // Past (z), and roman numerals past (iii).
  const many = clause('m', 'M', '', Array.from({ length: 28 }, (_, i) => sub('', 'L' + i)));
  const t = termsOf(agreementText({ clauses: [many] }, VALUES).text);
  assert.ok(t.includes('(z) L25.') === false && t.includes('(z) L25') && t.includes('(aa) L26') && t.includes('(ab) L27'));
  const deep = clause('r', 'R', '', [sub('P', '')].concat(Array.from({ length: 9 }, (_, i) => sub('', 'R' + i, 1))));
  const romans = termsOf(agreementText({ clauses: [deep] }, VALUES).text).match(/\(([ivx]+)\) R/g);
  assert.deepEqual(romans, ['(i) R', '(ii) R', '(iii) R', '(iv) R', '(v) R', '(vi) R', '(vii) R', '(viii) R', '(ix) R']);
});

test('the default clause 4 reads (a) Raw materials, (b) Client licence, (c) Portfolio use; clause 7 nests (a)(i)', () => {
  const text = agreementText(docSettings({}).agreement, VALUES).text;
  assert.match(text, /\n\n4\. Intellectual Property and Usage Rights\n\(a\) Raw materials\. All raw footage[^\n]*\n\n\(b\) Client licence\. From the date[^\n]*\n\n\(c\) Portfolio use\. The Business may use[^\n]*\n\n5\. Client Materials/);
  assert.match(text, /\n\n7\. Cancellation and Postponement\n\(a\) By the Client\.\n\n\(i\) If the Client cancels after signing[^\n]*\n\n\(ii\) If the Client cancels after capture[^\n]*\n\n\(b\) Postponement\./);
  assert.match(text, /\n\n12\. Acceptance\nBy signing,[^\n]*\n\nSigned for Acme Pty Ltd by Sam Lee, Director, on 4 October 2026\.$/);
});

test('the header: parties, intro, project, payment, scope and days, with empty parts dropped (U10, U22)', () => {
  const r = agreementText({ intro: 'Welcome, {client_business}.', clauses: [clause('a', 'One', 'x')] }, VALUES);
  assert.equal(r.text.slice(0, r.text.indexOf('\n\nTERMS\n\n')), [
    'SERVICE AGREEMENT',
    'PARTIES\n' +
      'Lachlan Sullivan-Carey (ABN 12 345 678 901), represented by Lachlan Sullivan-Carey (the "Business")\n' +
      'studio@lsc.test · 0412 000 000\n' +
      'Acme Pty Ltd (ABN 51 824 753 556) (the "Client")\n' +
      'sam@acme.test · 0400 000 000',
    'Welcome, Acme Pty Ltd.',
    'PROJECT\nSpring campaign (B210), as set out in quote B210 (the "Quote").',
    'PAYMENT SCHEDULE\nTotal: $12,345.60\nDeposit (40%): $4,938.24\nBalance: $7,407.36\nInvoices are due 7 days after each is issued',
    'SCOPE AND PRODUCTION DAYS\nThe services and deliverables are as set out in the Quote.\nProduction days:\n' +
      'Wednesday 14 October 2026 · Confirmed · 7:00am–5:00pm\n' +
      'Friday 16 October 2026 · Pencilled · 6:00pm–2:00am (ends next day)\nDate TBC · Proposed',
  ].join('\n\n'));

  // A client with no ABN, email or phone; a business with no signer or contact;
  // no intro; no days: nothing hollow is printed.
  const bare = agreementValues(Object.assign({}, PROJECT, {
    client: { businessName: 'Acme Pty Ltd' }, business: { name: 'LSC Creative' }, days: [],
  }));
  const t = agreementText({ intro: ' ', clauses: [clause('a', 'One', 'x')] }, bare).text;
  assert.match(t, /^SERVICE AGREEMENT\n\nPARTIES\nLSC Creative \(the "Business"\)\nAcme Pty Ltd \(the "Client"\)\n\nPROJECT\n/);
  assert.doesNotMatch(t, /\(ABN \)|ABN\s*\)|represented by\s*\(|· \n|Production days/);
  assert.match(t, /\n\nSCOPE AND PRODUCTION DAYS\nThe services and deliverables are as set out in the Quote\.\n\nTERMS\n/);
});

test('a single invoice has no Deposit or Balance row; a pair has both', () => {
  const agreement = { clauses: [clause('a', 'One', 'x')] };
  const single = agreementValues(Object.assign({}, PROJECT, { depositPct: null, depositTotal: null, balanceTotal: 12345.6 }));
  const one = agreementText(agreement, single, { single: true }).text;
  assert.match(one, /\n\nPAYMENT SCHEDULE\nTotal: \$12,345\.60, on a single invoice, due 7 days after it is issued\n\nSCOPE/);
  assert.doesNotMatch(one, /Deposit|Balance/);
  const pair = agreementText(agreement, VALUES).text;
  assert.match(pair, /\nDeposit \(40%\): \$4,938\.24\nBalance: \$7,407\.36\n/);
  assert.doesNotMatch(pair, /single invoice/);
});

test('{fields} fill in the intro, titles, bodies and sub-clauses; an unknown one is left and reported', () => {
  const r = agreementText({
    intro: 'For {client_business}.',
    clauses: [
      clause('a', 'Rate for {upid}', 'A deposit of {deposit_pct}. Extra work at AUD {hourly_rate}.', [
        { id: 's', heading: '{project_name}', text: 'See {clinet_abn} and {client_abn}.', indent: 0 },
      ]),
    ],
  }, Object.assign({}, VALUES, { client_abn: '' }));
  assert.match(r.text, /\n\nFor Acme Pty Ltd\.\n\n/);
  assert.match(r.text, /\n\n1\. Rate for B210\nA deposit of 40%\. Extra work at AUD \$63\.00\.\n\n\(a\) Spring campaign\. See \{clinet_abn\} and \.\n\n/);
  assert.deepEqual(r.unknown, ['{clinet_abn}']);
  assert.deepEqual(r.blank, ['client_abn']);
});

test('no clauses → the fallback text; typed NUL and Windows line ends never reach the text', () => {
  for (const agreement of [{ clauses: [] }, {}, null, { clauses: [clause('a', ' ', '')] }]) {
    assert.equal(agreementText(agreement, VALUES).text, fillAgreement(FALLBACK_TEXT, VALUES).text);
  }
  const t = agreementText({ intro: 'A\u0000B', clauses: [clause('a', 'T\u0000', 'One\r\n\r\nTwo\r\nthree')] }, VALUES).text;
  assert.doesNotMatch(t, /\u0000|\r/);
  assert.match(t, /\n\nAB\n\n/);
  assert.match(t, /\n\n1\. T\nOne\n\nTwo\nthree\n\n/);
});

test('the browser copy renders the same text as the server', () => {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.runInContext(readFileSync(join(__dirname, '..', '..', 'web', 'js', 'documents.js'), 'utf8'), vm.createContext(sandbox));
  const web = sandbox.LSCDocuments;
  const agreement = docSettings({}).agreement;
  assert.equal(web.agreementText(web.docSettings({}).agreement, web.agreementValues(PROJECT)).text,
    agreementText(agreement, agreementValues(PROJECT)).text);
});
