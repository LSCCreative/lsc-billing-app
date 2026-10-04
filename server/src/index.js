'use strict';

const { config, ensureDataDirs } = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { scheduleNightlyBackups } = require('./backup');
const { fetchIfNextYearMissing } = require('./holidays');

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

  // The send queue: sweeps what the last shutdown left, sends what's overdue
  // (marked late, D47), then ticks every minute. Without the SMTP key a due
  // send fails visibly instead of waiting silently.
  app.locals.outbox.start();
  console.log(`[mail] ${config.smtp.pass && config.mailFrom ? `connected as ${config.mailFrom}` : 'not set up (no SMTP key / MAIL_FROM)'}`);

  // Top up the public-holiday list in the background. Not awaited and never
  // throws: a source being down must not hold up or stop the server.
  fetchIfNextYearMissing(db).then((r) => {
    if (!r.skipped && !r.error) console.log(`[holidays] fetched, ${r.added} new date(s)`);
  });

  // Close the database cleanly so WAL is checkpointed rather than left for
  // recovery on next boot.
  function shutdown(signal) {
    console.log(`\n${signal} received, shutting down.`);
    backupSchedule.stop();
    app.locals.outbox.stop();
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
