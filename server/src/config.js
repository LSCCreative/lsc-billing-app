'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

const config = {
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'billing.db'),
  backupDir: path.join(DATA_DIR, 'backups'),
  exportDir: path.join(DATA_DIR, 'exports'),
  port: Number(process.env.PORT || 8080),
  sessionSecret: process.env.SESSION_SECRET || '',
  adminUsername: process.env.ADMIN_USERNAME || 'lachlan',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  trustProxy: bool(process.env.TRUST_PROXY, false),
  cookieSecure: bool(process.env.COOKIE_SECURE, true),
  // 'strict' when the UI is served by this same process (the old plan);
  // 'none' when the UI lives on a different origin (GitHub Pages) and the
  // browser needs to send the cookie cross-site. 'none' requires Secure.
  cookieSameSite: process.env.COOKIE_SAMESITE || 'strict',
  // Comma-separated list of origins allowed to call the API with credentials,
  // e.g. "https://lachlan.github.io". Empty = same-origin only (CORS off).
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  isTest: process.env.NODE_ENV === 'test',
};

// The data directory is the whole point of this app — if it can't be created,
// fail at boot rather than half-running and losing writes.
function ensureDataDirs() {
  for (const dir of [config.dataDir, config.backupDir, config.exportDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { config, ensureDataDirs };
