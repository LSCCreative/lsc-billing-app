'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, newId, nowIso } = require('../src/db');
const { createBackup, pruneBackups, preWriteBackup, RETENTION } = require('../src/backup');

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `lsc-backup-${label}-`));
}

test('createBackup writes a restorable snapshot and prunes past retention', async () => {
  const dir = tempDir('create');
  const db = openDatabase(path.join(dir, 'billing.db'));
  const backupDir = path.join(dir, 'backups');

  db.prepare('INSERT INTO clients (id, business_name, created_at, updated_at) VALUES (?,?,?,?)')
    .run(newId('cl'), 'Acme Pty Ltd', nowIso(), nowIso());

  const file = await createBackup(db, backupDir, 'nightly');
  assert.ok(fs.existsSync(file));

  const restored = openDatabase(file, { migrate: false });
  const clients = restored.prepare('SELECT business_name FROM clients').all();
  assert.equal(clients.length, 1);
  assert.equal(clients[0].business_name, 'Acme Pty Ltd');
  restored.close();

  // Beyond the retention count, the oldest backups of that kind are removed.
  for (let i = 0; i < RETENTION.nightly + 3; i++) {
    await createBackup(db, backupDir, 'nightly');
  }
  const kept = fs.readdirSync(backupDir).filter((f) => f.startsWith('nightly-'));
  assert.equal(kept.length, RETENTION.nightly);

  db.close();
});

test('pruneBackups only touches files of the requested kind', () => {
  const dir = tempDir('prune-kinds');
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  for (let i = 0; i < RETENTION.prewrite + 5; i++) {
    fs.writeFileSync(path.join(backupDir, `prewrite-2026-01-01T00-00-0${i}-000Z.db`), 'x');
  }
  fs.writeFileSync(path.join(backupDir, 'nightly-2026-01-01T00-00-00-000Z.db'), 'x');

  pruneBackups(backupDir, 'prewrite');

  const files = fs.readdirSync(backupDir);
  assert.equal(files.filter((f) => f.startsWith('prewrite-')).length, RETENTION.prewrite);
  assert.equal(files.filter((f) => f.startsWith('nightly-')).length, 1);
});

test('preWriteBackup snapshots before a mutating request and skips reads', async () => {
  const dir = tempDir('middleware');
  const db = openDatabase(path.join(dir, 'billing.db'));
  const backupDir = path.join(dir, 'backups');

  const calls = [];
  const middleware = preWriteBackup(db, backupDir);
  const respond = () => {};

  await new Promise((resolve) => middleware({ method: 'GET' }, respond, () => { calls.push('GET'); resolve(); }));
  assert.equal(fs.existsSync(backupDir), false, 'a read must not trigger a snapshot');

  await new Promise((resolve) => middleware({ method: 'POST' }, respond, () => { calls.push('POST'); resolve(); }));
  assert.deepEqual(calls, ['GET', 'POST']);
  const files = fs.readdirSync(backupDir).filter((f) => f.startsWith('prewrite-'));
  assert.equal(files.length, 1);

  db.close();
});
