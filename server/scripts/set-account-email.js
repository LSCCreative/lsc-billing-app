'use strict';

/**
 * Sets the email a "forgot password" link is sent to (account-recovery).
 *
 *   npm run set-email -- you@example.com
 *
 * Settings → Account does the same from the app; this is for an account
 * nobody can sign in to, or the first time. Leaves the login and password as
 * they are.
 */

const { config, ensureDataDirs } = require('../src/config');
const { openDatabase, nowIso } = require('../src/db');
const { isEmail } = require('../src/mail');

const email = String(process.argv[2] || '').trim();
if (!isEmail(email)) {
  console.error('Give the email address: npm run set-email -- you@example.com. Nothing was changed.');
  process.exit(1);
}

ensureDataDirs();
const db = openDatabase(config.dbFile);
const { changes } = db.prepare('UPDATE account SET email = ?, updated_at = ? WHERE id = 1').run(email, nowIso());
db.close();
if (!changes) {
  console.error('There is no account yet: run `npm run seed` first.');
  process.exit(1);
}
console.log(`Reset links now go to ${email}.`);
