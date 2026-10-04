'use strict';

/**
 * A development server whose email goes nowhere: the app as `npm start` runs
 * it, but the mailer is a stub that prints each email instead of sending it.
 * For checking the send panel and the queue in the browser against a scratch
 * database (launch.json "api-scratch-mail") without an SMTP key.
 *
 *   STUB_MAIL_FAIL=1   every send fails, to see "Email failed — Retry".
 *
 * Never for the NAS: it would swallow real clients' emails.
 */

const { config, ensureDataDirs } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mail');

ensureDataDirs();
const failing = process.env.STUB_MAIL_FAIL === '1';
const transport = {
  async sendMail(m) {
    if (failing) throw new Error('STUB_MAIL_FAIL is set: the stub refused this email.');
    console.log(`[stub-mail] to ${m.to} · ${m.subject}\n${m.text}\n${(m.attachments || []).map((a) => `  + ${a.filename}`).join('\n')}`);
    return { messageId: `<stub-${Date.now()}@localhost>` };
  },
};
const mailer = createMailer({ ...config, mailFrom: config.mailFrom || 'admin@lsccreative.studio' }, { transport });
const db = openDatabase(config.dbFile);
const app = createApp(db, { mailer, appUrl: config.appUrl || 'http://localhost:5173/' });
app.listen(config.port, () => console.log(`[stub-mail] dev server on :${config.port}, email printed here${failing ? ' (every send fails)' : ''}`));
app.locals.outbox.start();
