'use strict';

const fs = require('fs');
const path = require('path');

// Two kinds of backup share one directory, told apart by filename prefix.
// 'nightly' is the daily safety net; 'prewrite' is the snapshot taken just
// before each mutating request, so a single bad write is always one file
// away from undone. Kept short since pre-write snapshots pile up fast under
// normal use — the point is a recent recovery point, not a full history.
const RETENTION = { nightly: 14, prewrite: 10 };
const AUTOSAVE_WINDOW_MS = 10 * 60 * 1000;
const NIGHTLY_HOUR = 2; // low-traffic window for a single-user app

function timestampSlug(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * The timestamp only resolves to the millisecond, so two backups taken inside
 * the same one would land on a single filename and the second would overwrite
 * the first — costing a recovery point without saying so. Two pre-write
 * snapshots that close together is exactly what a burst of writes produces.
 */
function uniquePath(backupDir, kind, date) {
  const stem = `${kind}-${timestampSlug(date)}`;
  let candidate = path.join(backupDir, `${stem}.db`);
  for (let n = 1; fs.existsSync(candidate); n += 1) {
    candidate = path.join(backupDir, `${stem}-${n}.db`);
  }
  return candidate;
}

/**
 * Takes a live backup of `db` into `backupDir` using SQLite's Online Backup
 * API (safe to run against a database that's being written to concurrently),
 * then prunes older backups of the same kind past the retention limit.
 */
async function createBackup(db, backupDir, kind) {
  fs.mkdirSync(backupDir, { recursive: true });
  const file = uniquePath(backupDir, kind, new Date());
  await db.backup(file);
  pruneBackups(backupDir, kind);
  return file;
}

function pruneBackups(backupDir, kind) {
  const prefix = `${kind}-`;
  const keep = RETENTION[kind];
  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.db'))
    .sort(); // timestamp is embedded in the name, so lexical sort is chronological
  for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
    fs.unlinkSync(path.join(backupDir, stale));
  }
}

/**
 * Express middleware: snapshots the database before letting a mutating
 * request through. A failed snapshot is logged but does not block the
 * write — this is a single-user app, and refusing writes because the
 * safety net itself failed would be worse than the risk it guards against.
 */
function preWriteBackup(db, backupDir, { now = Date.now } = {}) {
  const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
  // Editor autosave (trip-planner I2): a PUT to one estimate carrying
  // `X-LSC-Autosave: 1` snapshots on the first request of a new
  // `X-LSC-Session` (the editor opening), then at most once per window per
  // estimate, so autosaves can't push real recovery points out of the 10
  // kept. Every other write snapshots as before. In memory: a restart just
  // means one extra snapshot.
  const seen = new Map(); // estimate id -> { at, sessions: Set }
  function autosaveSkips(req) {
    if (req.method !== 'PUT' || !req.get || req.get('X-LSC-Autosave') !== '1') return false;
    const match = /^\/estimates\/([^/]+)\/?$/.exec(req.path || '');
    if (!match) return false;
    const session = req.get('X-LSC-Session') || '';
    const t = now();
    const entry = seen.get(match[1]);
    if (entry && (!session || entry.sessions.has(session)) && t - entry.at < AUTOSAVE_WINDOW_MS) return true;
    const sessions = entry ? entry.sessions : new Set();
    if (sessions.size > 50) sessions.clear();
    if (session) sessions.add(session);
    seen.set(match[1], { at: t, sessions });
    return false;
  }
  return (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    if (autosaveSkips(req)) return next();
    createBackup(db, backupDir, 'prewrite').then(
      () => next(),
      (err) => {
        console.error('[backup] pre-write snapshot failed:', err.message);
        next();
      }
    );
  };
}

/**
 * Runs one nightly backup at `hour` (local time) and every 24h after that.
 * Returns a handle to stop the schedule (used on shutdown and in tests).
 */
function scheduleNightlyBackups(db, backupDir, { hour = NIGHTLY_HOUR } = {}) {
  let timer;

  function msUntilNextRun() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  function runAndReschedule() {
    createBackup(db, backupDir, 'nightly').catch((err) => {
      console.error('[backup] nightly snapshot failed:', err.message);
    });
    timer = setTimeout(runAndReschedule, 24 * 60 * 60 * 1000);
    timer.unref();
  }

  timer = setTimeout(runAndReschedule, msUntilNextRun());
  timer.unref();

  return { stop: () => clearTimeout(timer) };
}

module.exports = { createBackup, pruneBackups, preWriteBackup, scheduleNightlyBackups, RETENTION, AUTOSAVE_WINDOW_MS };
