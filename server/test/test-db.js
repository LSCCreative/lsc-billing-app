'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, migrate, newId, nowIso, LATEST_VERSION } = require('../src/db');

function tempDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lsc-db-${label}-`));
  return path.join(dir, 'billing.db');
}

test('creates a fresh database with every table the app needs', () => {
  const file = tempDbPath('fresh');
  const db = openDatabase(file);

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).all().map((r) => r.name);

  for (const expected of
    ['account', 'clients', 'estimates', 'pricing', 'schema_version', 'sessions', 'settings']) {
    assert.ok(tables.includes(expected), `missing table: ${expected}`);
  }

  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
});

test('re-running migrations against an existing database changes nothing', () => {
  const file = tempDbPath('idempotent');

  const first = openDatabase(file);
  first.prepare(`
    INSERT INTO clients (id, business_name, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(newId('cl'), 'Acme Pty Ltd', nowIso(), nowIso());
  first.close();

  // Second open on the same file: the data survives and no migration re-runs.
  const second = openDatabase(file);
  const result = migrate(second);
  assert.equal(result.applied, 0);
  assert.equal(result.to, LATEST_VERSION);

  const clients = second.prepare('SELECT business_name FROM clients').all();
  assert.equal(clients.length, 1);
  assert.equal(clients[0].business_name, 'Acme Pty Ltd');

  const versions = second.prepare('SELECT COUNT(*) AS n FROM schema_version').get();
  assert.equal(versions.n, LATEST_VERSION);
  second.close();
});

test('refuses to run against a database built by a newer version of the app', () => {
  const file = tempDbPath('future');
  const db = openDatabase(file);
  db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
    .run(LATEST_VERSION + 5, nowIso());
  db.close();

  assert.throws(() => openDatabase(file), /newer database/);
});

test('a corrupt file is refused rather than overwritten', () => {
  const file = tempDbPath('corrupt');
  // Not a database at all — the shape a truncated copy or a bad restore takes.
  fs.writeFileSync(file, 'this is not a sqlite file, but it is the only copy');
  const before = fs.readFileSync(file);

  assert.throws(() => openDatabase(file));

  // The point of the check: whatever was in there is still in there.
  assert.deepEqual(fs.readFileSync(file), before);
});

test('only one account row can ever exist', () => {
  const file = tempDbPath('account');
  const db = openDatabase(file);

  db.prepare(`
    INSERT INTO account (id, username, password_hash, created_at, updated_at)
    VALUES (1, 'lachlan', 'hash', ?, ?)
  `).run(nowIso(), nowIso());

  assert.throws(() => {
    db.prepare(`
      INSERT INTO account (id, username, password_hash, created_at, updated_at)
      VALUES (2, 'someone-else', 'hash', ?, ?)
    `).run(nowIso(), nowIso());
  }, /CHECK constraint failed/);

  db.close();
});

test('deleting a client leaves their estimates intact, snapshot and all', () => {
  const file = tempDbPath('snapshot');
  const db = openDatabase(file);

  const clientId = newId('cl');
  db.prepare('INSERT INTO clients (id, business_name, created_at, updated_at) VALUES (?,?,?,?)')
    .run(clientId, 'Acme Pty Ltd', nowIso(), nowIso());

  const estimateId = newId('est');
  db.prepare(`
    INSERT INTO estimates (id, upid, name, client_id, client_json, totals_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    estimateId, 'UPID-001', 'Brand film', clientId,
    JSON.stringify({ businessName: 'Acme Pty Ltd', email: 'accounts@acme.example' }),
    JSON.stringify({ totalIncGst: 3916 }),
    nowIso(), nowIso()
  );

  db.prepare('DELETE FROM clients WHERE id = ?').run(clientId);

  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  assert.ok(row, 'the estimate must survive its client being deleted');
  assert.equal(row.client_id, null);
  assert.equal(JSON.parse(row.client_json).businessName, 'Acme Pty Ltd');

  db.close();
});

test('total_inc_gst tracks totals_json without being stored twice', () => {
  const file = tempDbPath('generated');
  const db = openDatabase(file);

  const id = newId('est');
  db.prepare(`
    INSERT INTO estimates (id, totals_json, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(id, JSON.stringify({ totalIncGst: 3916 }), nowIso(), nowIso());

  assert.equal(db.prepare('SELECT total_inc_gst AS t FROM estimates WHERE id = ?').get(id).t, 3916);

  db.prepare('UPDATE estimates SET totals_json = ? WHERE id = ?')
    .run(JSON.stringify({ totalIncGst: 100.5 }), id);

  assert.equal(db.prepare('SELECT total_inc_gst AS t FROM estimates WHERE id = ?').get(id).t, 100.5);
  db.close();
});

test('an estimate cannot be saved with a status the pipeline does not have', () => {
  const file = tempDbPath('status');
  const db = openDatabase(file);

  assert.throws(() => {
    db.prepare('INSERT INTO estimates (id, status, created_at, updated_at) VALUES (?,?,?,?)')
      .run(newId('est'), 'archived', nowIso(), nowIso());
  }, /CHECK constraint failed/);

  db.close();
});
