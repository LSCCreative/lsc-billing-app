'use strict';

const path = require('path');
const express = require('express');
const { config } = require('./config');
const { registerAuthRoutes, requireAuth } = require('./auth');
const { preWriteBackup } = require('./backup');
const { registerEstimateRoutes } = require('./routes/estimates');
const { registerClientRoutes } = require('./routes/clients');
const { registerPricingRoutes } = require('./routes/pricing');
const { registerSettingsRoutes } = require('./routes/settings');
const { registerPdfRoutes } = require('./routes/pdf');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * The UI is served from GitHub Pages, a different origin than this API, so the
 * browser needs an explicit CORS allow-list with credentials — otherwise the
 * session cookie never gets sent. `CORS_ORIGINS` is empty by default (same-
 * origin only); set it once the Pages URL is known.
 */
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Not CORS-safelisted, so without this the page can't read the PDF's filename.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Builds the Express app. Takes an open database handle so tests can pass a
 * throwaway one instead of the real billing.db.
 */
function createApp(db) {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(corsMiddleware);
  app.use(express.json({ limit: '2mb' }));

  // ── /health — the only route besides /login that never requires a session.
  // Deliberately says nothing about the data; it is a liveness probe for
  // Container Manager, not a status page.
  app.get('/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.type('text/plain').status(200).send('ok');
    } catch (err) {
      res.type('text/plain').status(503).send('db unavailable');
    }
  });

  // ── Auth. /api/login, /api/logout and /api/session handle their own session
  // state and must be registered before the gate below.
  registerAuthRoutes(app, db);

  // ── Everything under /api from here down requires a valid session. New API
  // routes mount after this line and inherit the gate for free.
  app.use('/api', requireAuth(db));

  // PDF export is a POST but never writes the database. Mounted ahead of the
  // pre-write snapshot so exporting doesn't rotate real recovery points out
  // of the 10 kept.
  registerPdfRoutes(app, db);

  app.use('/api', preWriteBackup(db, config.backupDir));

  registerEstimateRoutes(app, db);
  registerClientRoutes(app, db);
  registerPricingRoutes(app, db);
  registerSettingsRoutes(app, db);

  // ── Static app shell. Empty until the UI is ported off the Electron build.
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

  // ── Fallbacks. API 404s stay JSON so the client's fetch wrapper can tell a
  // missing route from a missing page.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // eslint-disable-next-line no-unused-vars -- Express identifies error
  // handlers by arity; `next` must stay in the signature.
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', req.method, req.path, err);
    const body = { error: err.code || 'server_error' };
    if (err.expose && err.message) body.message = err.message;
    res.status(status).json(body);
  });

  return app;
}

module.exports = { createApp, PUBLIC_DIR };
