'use strict';

/**
 * Creates or resets the single login account.
 *
 *   npm run seed                       — uses ADMIN_USERNAME / ADMIN_PASSWORD from .env
 *   npm run seed -- --password 'xyz'   — one-off, keeps the password out of .env
 *
 * Safe to re-run: it updates the existing account rather than adding a second
 * one. Changing the password does not log out existing sessions — use
 * `--logout-all` for that.
 */

const readline = require('readline');
const { config, ensureDataDirs } = require('../src/config');
const { openDatabase, nowIso } = require('../src/db');
const { hashPassword } = require('../src/auth');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function main() {
  ensureDataDirs();

  const username = argValue('--username') || config.adminUsername;
  let password = argValue('--password') || config.adminPassword;

  if (!password) {
    password = (await prompt('Password for the billing app: ')).trim();
  }

  if (password.length < 12) {
    console.error('Password must be at least 12 characters. Nothing was changed.');
    process.exit(1);
  }
  if (!username) {
    console.error('No username given (set ADMIN_USERNAME or pass --username). Nothing was changed.');
    process.exit(1);
  }

  const db = openDatabase(config.dbFile);
  const hash = await hashPassword(password);
  const existing = db.prepare('SELECT id FROM account WHERE id = 1').get();

  if (existing) {
    db.prepare('UPDATE account SET username = ?, password_hash = ?, updated_at = ? WHERE id = 1')
      .run(username, hash, nowIso());
    console.log(`Account updated: ${username}`);
  } else {
    db.prepare(`
      INSERT INTO account (id, username, password_hash, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?)
    `).run(username, hash, nowIso(), nowIso());
    console.log(`Account created: ${username}`);
  }

  if (process.argv.includes('--logout-all')) {
    const { changes } = db.prepare('DELETE FROM sessions').run();
    console.log(`Cleared ${changes} session(s).`);
  }

  db.close();
  console.log(`Database: ${config.dbFile}`);
  console.log('Remove ADMIN_PASSWORD from .env now that the account exists.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
