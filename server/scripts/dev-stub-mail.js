'use strict';

/**
 * A development server whose email goes nowhere: the app as `npm start` runs
 * it, but the mailer is a stub that prints each email instead of sending it.
 * For checking the send panel and the queue in the browser against a scratch
 * database (launch.json "api-scratch-mail") without an SMTP key. Each email's
 * HTML is also saved to <DATA_DIR>/stub-mail/, to open in a browser.
 *
 *   STUB_MAIL_FAIL=1   every send fails, to see "Email failed — Retry".
 *
 * Never for the NAS: it would swallow real clients' emails.
 */

const fs = require('node:fs');
const path = require('node:path');
const { config, ensureDataDirs } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mail');

ensureDataDirs();
const htmlDir = path.join(config.dataDir, 'stub-mail');
fs.mkdirSync(htmlDir, { recursive: true });
let n = 0;
const failing = process.env.STUB_MAIL_FAIL === '1';
const transport = {
  async sendMail(m) {
    if (failing) throw new Error('STUB_MAIL_FAIL is set: the stub refused this email.');
    n += 1;
    const file = path.join(htmlDir, `${Date.now()}-${n}.html`);
    fs.writeFileSync(file, m.html || '');
    console.log(`[stub-mail] to ${m.to} · ${m.subject}\n${m.text}\n${(m.attachments || []).map((a) => `  + ${a.filename}`).join('\n')}\n  html: ${file}`);
    return { messageId: `<stub-${Date.now()}@localhost>` };
  },
};
const mailer = createMailer({ ...config, mailFrom: config.mailFrom || 'admin@lsccreative.studio' }, { transport });
const db = openDatabase(config.dbFile);
const app = createApp(db, { mailer, appUrl: config.appUrl || 'http://localhost:5173/' });
app.listen(config.port, () => console.log(`[stub-mail] dev server on :${config.port}, email printed here${failing ? ' (every send fails)' : ''}`));
app.locals.outbox.start();
