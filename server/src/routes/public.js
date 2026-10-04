'use strict';

/**
 * The client's routes (production-booking stage E): no login, no cookies,
 * reached by an unguessable link (IA "Server routes"). Mounted in app.js
 * BEFORE the /api session gate and outside /api altogether, so nothing here
 * can inherit an owner route by accident, and nothing owner-only is mounted
 * under /public.
 *
 * Every reply is built from public.js's client view. 404s are one shape
 * whatever went wrong (no such link, a malformed one, one never sent), so a
 * reply never says which.
 */

const { config } = require('../config');
const { buildEstimateHtml, exportFilename, renderPdfBuffer } = require('../pdf');
const { nowIso } = require('../db');
const { publicEstimate, publicPdfSource, logOpened } = require('../public');
const { localToday } = require('./projects');

/* CORS for the Pages origin, without credentials: a client page has no
   session and must never be sent one. */
function publicCors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  // Nothing here is cacheable, indexable or worth a Referer.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return next();
}

/**
 * Who a request is from, for the rate limit. Behind the Cloudflare tunnel
 * (TRUST_PROXY on), `req.ip` is the leftmost X-Forwarded-For entry, which a
 * client can write themselves; CF-Connecting-IP is set by Cloudflare over
 * anything the client sent. The API is reachable only through the tunnel, so
 * the header can't be forged from outside it.
 */
function clientIp(req) {
  const cf = config.trustProxy ? req.headers['cf-connecting-ip'] : '';
  return (typeof cf === 'string' && cf.trim()) || req.ip || req.socket.remoteAddress || '';
}

/**
 * A fixed-window count per IP. In memory: one process, and a restart
 * forgetting the counts is harmless. A 256-bit token can't be guessed at any
 * rate; this is here for a runaway client or a script hammering the PDF
 * renderer, which is the expensive route.
 */
function rateLimit({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return (req, res, next) => {
    const t = now();
    if (hits.size > 10000) {
      hits.forEach((v, k) => {
        if (v.resetAt <= t) hits.delete(k);
      });
    }
    const key = clientIp(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - t) / 1000)));
      return res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' });
    }
    return next();
  };
}

const notFound = (res) => res.status(404).json({ error: 'not_found' });

/**
 * @param {object} opts
 * @param {object} [opts.publicLimits]  { all: {max, windowMs}, pdf: {max, windowMs} }, for tests
 * @param {function} [opts.today]       'YYYY-MM-DD' now; never from the request, or a
 *                                      client could ask for an expired estimate to be open
 * @param {function} [opts.now]         ISO time now, for the `opened` log
 */
function registerPublicRoutes(app, db, opts = {}) {
  const limits = Object.assign({
    all: { max: 120, windowMs: 10 * 60 * 1000 },
    pdf: { max: 12, windowMs: 10 * 60 * 1000 },
  }, opts.publicLimits || {});
  const today = opts.today || localToday;
  const now = opts.now || nowIso;

  app.use('/public', publicCors, rateLimit(limits.all));

  app.get('/public/estimates/:token', (req, res) => {
    const reply = publicEstimate(db, req.params.token, today());
    if (!reply) return notFound(res);
    res.json({ estimate: reply });
    // After the reply has gone, so a found link answers no slower than a
    // wrong one, and a failed log can't cost the client their page.
    try {
      logOpened(db, req.params.token, now());
    } catch (err) {
      console.error('[public] could not log opened:', err.message);
    }
    return undefined;
  });

  app.get('/public/estimates/:token/pdf', rateLimit(limits.pdf), async (req, res, next) => {
    const src = publicPdfSource(db, req.params.token);
    if (!src) return notFound(res);
    let buffer;
    try {
      buffer = await renderPdfBuffer(buildEstimateHtml(src.estimate, src.pricing, { business: src.business }));
    } catch (err) {
      if (err.code === 'pdf_unavailable') return res.status(503).json({ error: 'pdf_unavailable' });
      return next(err);
    }
    // Not kept in exportDir as the owner's exports are: a client's downloads
    // would fill it.
    res.attachment(exportFilename(src.estimate));
    res.type('application/pdf');
    return res.send(buffer);
  });

  // Anything else under /public is a 404 in the same shape.
  app.use('/public', (_req, res) => notFound(res));
}

module.exports = { registerPublicRoutes, rateLimit, clientIp };
