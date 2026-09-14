'use strict';

const { config, ensureDataDirs } = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { scheduleNightlyBackups } = require('./backup');

function main() {
  ensureDataDirs();

  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    console.error(
      'SESSION_SECRET is missing or too short (needs 32+ characters).\n' +
      'Generate one with:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    process.exit(1);
  }

  const db = openDatabase(config.dbFile);
  const app = createApp(db);
  const backupSchedule = scheduleNightlyBackups(db, config.backupDir);

  const server = app.listen(config.port, () => {
    console.log(`LSC Billing server listening on :${config.port}`);
    console.log(`Data directory: ${config.dataDir}`);
  });

  // Close the database cleanly so WAL is checkpointed rather than left for
  // recovery on next boot.
  function shutdown(signal) {
    console.log(`\n${signal} received, shutting down.`);
    backupSchedule.stop();
    server.close(() => {
      try { db.close(); } catch (_) { /* already closed */ }
      process.exit(0);
    });
    // Don't hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
