'use strict';

/**
 * Every email template, written out as an .html file to open in a browser
 * (ui-clarity task 16): the shell at a glance, without sending anything.
 *
 *   node scripts/preview-mail.js [outDir] [appUrl]
 *
 * outDir defaults to a fresh folder in the system temp directory; appUrl
 * (where the logo is served from) to the local web server,
 * http://localhost:5173/. The sample business and project are made up.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mail = require('../src/mail');

const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-mail-preview-'));
const appUrl = process.argv[3] || 'http://localhost:5173/';
const brand = {
  business: { name: 'LSC Creative', abn: '12345678901', email: 'hello@lsccreative.studio', phone: '0400 123 456' },
  appUrl,
};
const link = (hash) => `${appUrl}c/#${hash}/Xq7cT2bVvS9kP4mN0wRj8LzYhG3fA6dE1uIoKtQsB5n`;
const message = 'Hi Priya,\n\nHere’s the quote for the harbour shoot: two days on set and the edit after.\nLet me know if the dates still suit.\n\nThanks,\nLachlan';

const emails = {
  'quote': mail.documentEmail({ ...brand, kind: 'estimate', upid: 'AUD-B', projectName: 'Harbour launch film', message, link: link('e') }),
  'deposit-invoice': mail.documentEmail({ ...brand, kind: 'deposit', upid: 'AUD-B', number: 'INV-AUD-B-D', projectName: 'Harbour launch film', message: 'Hi Priya,\n\nThe deposit invoice is below. It locks in the shoot days.', link: link('i') }),
  'quote-update': mail.documentEmail({ ...brand, kind: 'estimate', update: true, upid: 'AUD-B', projectName: 'Harbour launch film', message: 'Moved the second day to Friday, as we discussed.', link: link('e') }),
  'invoice-update': mail.documentEmail({ ...brand, kind: 'final', update: true, replaces: 'INV-AUD-B-F', number: 'INV-AUD-B-F2', upid: 'AUD-B', projectName: 'Harbour launch film', message: '', link: link('i') }),
  'signed-copy': mail.signedCopyEmail({ ...brand, contactName: 'Priya Nair', upid: 'AUD-B', projectName: 'Harbour launch film' }),
  'call-sheet': mail.callSheetEmail({ ...brand, upid: 'AUD-B', projectName: 'Harbour launch film', note: 'Parking is on Pier St. Bring the long lens.', link: link('s'), dates: ['2026-11-03', '2026-11-04', null] }),
  'test': mail.testEmail(brand),
  'owner-signed': mail.ownerSignedEmail({ ...brand, clientName: 'Saltwater Co.', signedBy: 'Priya Nair', role: 'Director', upid: 'AUD-B', projectName: 'Harbour launch film', rebook: ['2026-11-04'], link: `${appUrl}#/projects/prj_4eaa776d` }),
  'password-reset': mail.passwordResetEmail({ ...brand, username: 'lachlan', minutes: 30, link: `${appUrl}#/reset/Xq7cT2bVvS9kP4mN0wRj8LzYhG3fA6dE1uIoKtQsB5n` }),
  'no-details': mail.documentEmail({ business: { name: '' }, appUrl: '', kind: 'single', number: 'INV-0042', projectName: '', message: 'Thanks for the work this month.', link: link('i') }),
};

fs.mkdirSync(out, { recursive: true });
for (const [name, m] of Object.entries(emails)) {
  fs.writeFileSync(path.join(out, `${name}.html`), m.html);
  fs.writeFileSync(path.join(out, `${name}.txt`), `Subject: ${m.subject}\n\n${m.text}\n`);
}
console.log(`${Object.keys(emails).length} emails written to ${out}`);
