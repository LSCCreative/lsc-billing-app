'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, newId, nowIso } = require('../src/db');
const { createBackup, pruneBackups, preWriteBackup, RETENTION, AUTOSAVE_WINDOW_MS } = require('../src/backup');

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

/* Editor autosave (trip-planner task 7, I2): an autosave PUT snapshots on the
   first request of a new X-LSC-Session, then at most once per 10 minutes per
   estimate. Every other write keeps a snapshot each. */
test('preWriteBackup throttles autosave snapshots per session and per estimate', async () => {
  const dir = tempDir('autosave');
  const db = openDatabase(path.join(dir, 'billing.db'));
  const backupDir = path.join(dir, 'backups');

  let clock = Date.parse('2026-10-10T00:00:00.000Z');
  const middleware = preWriteBackup(db, backupDir, { now: () => clock });
  const count = () => (fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter((f) => f.startsWith('prewrite-')).length : 0);
  const send = (method, reqPath, headers = {}) => new Promise((resolve) => {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req = { method, path: reqPath, get: (name) => lower[name.toLowerCase()] };
    middleware(req, {}, resolve);
  });
  // Snapshot file names are timestamped to the millisecond; keep them apart.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
  const auto = (id, session) => ({ 'X-LSC-Autosave': '1', 'X-LSC-Session': session });

  await send('PUT', '/estimates/est_a', auto('est_a', 's1'));
  assert.equal(count(), 1, 'the first autosave of a session snapshots');
  await tick();

  clock += 60 * 1000;
  await send('PUT', '/estimates/est_a', auto('est_a', 's1'));
  await send('PUT', '/estimates/est_a', auto('est_a', 's1'));
  assert.equal(count(), 1, 'later autosaves in the window do not');

  await send('PUT', '/estimates/est_a', {});
  assert.equal(count(), 2, 'a manual save still snapshots every time');
  await tick();
  await send('POST', '/estimates', auto('est_a', 's1'));
  assert.equal(count(), 3, 'only a PUT to one estimate is an autosave');
  await tick();

  await send('PUT', '/estimates/est_b', auto('est_b', 's1'));
  assert.equal(count(), 4, 'the window is per estimate');
  await tick();

  await send('PUT', '/estimates/est_a', auto('est_a', 's2'));
  assert.equal(count(), 5, 'a new session (the editor reopened) snapshots at once');
  await tick();
  await send('PUT', '/estimates/est_a', auto('est_a', 's1'));
  assert.equal(count(), 5, 'an earlier session in the window does not');

  clock += AUTOSAVE_WINDOW_MS;
  await send('PUT', '/estimates/est_a', auto('est_a', 's2'));
  assert.equal(count(), 6, 'ten minutes on, the same session snapshots again');
  await tick();
  clock += AUTOSAVE_WINDOW_MS - 1;
  await send('PUT', '/estimates/est_a', auto('est_a', 's2'));
  assert.equal(count(), 6, 'and not again until the next ten minutes are up');

  await send('PUT', '/estimates/est_a', { 'X-LSC-Autosave': '0', 'X-LSC-Session': 's2' });
  assert.equal(count(), 7, 'any other header value is an ordinary write');

  db.close();
});
