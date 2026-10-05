'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const {
  buildEstimateHtml, buildCostBreakdownHtml, costBreakdownBlocker, exportBlocker, exportFilename, costBreakdownFilename,
  renderPdfBuffer,
} = require('../pdf');
const { readPricing, readSettings } = require('../ratecard');
const { loadEstimate } = require('../estimate');
const { readDays } = require('../days');
const { docSettings } = require('../documents');
const { quoteDates } = require('../public');
const { todayOf } = require('./projects');

function registerPdfRoutes(app, db) {
  /* Renders `html`, keeps a copy in exportDir and sends it as a download. */
  async function sendPdf(res, next, html, filename) {
    let buffer;
    try {
      buffer = await renderPdfBuffer(html);
    } catch (err) {
      if (err.code === 'pdf_unavailable') {
        return res.status(503).json({ error: 'pdf_unavailable' });
      }
      return next(err);
    }

    fs.mkdirSync(config.exportDir, { recursive: true });
    fs.writeFileSync(path.join(config.exportDir, filename), buffer);

    // attachment() encodes the name per RFC 6266. A hand-built header 500s on
    // any character outside Latin-1 — a curly apostrophe in a client's name.
    res.attachment(filename);
    return res.send(buffer);
  }

  // The estimate with its production days, which live in their own table.
  const load = (id) => {
    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(id);
    return row ? loadEstimate(row, readDays(db, row.id)) : null;
  };

  /* `{ as: 'estimate' }` prints an old invoice-typed row (D62) as the estimate
     it started as: the project folder lists that row twice, as its estimate
     and as the invoice made the old way, and each downloads as what it is.
     Without it the row prints as its retired doc type says. */
  app.post('/api/estimates/:id/pdf', async (req, res, next) => {
    const loaded = load(req.params.id);
    if (!loaded) return res.status(404).json({ error: 'not_found' });
    const estimate = (req.body || {}).as === 'estimate' ? { ...loaded, docType: 'estimate' } : loaded;

    const today = todayOf(req);
    if (!today) return res.status(400).json({ error: 'today_invalid' });
    const settings = readSettings(db);
    const blocker = exportBlocker(estimate, settings);
    if (blocker) return res.status(422).json(blocker);

    // The quote's issue and valid-until dates: the version the client has, or
    // today's for one not sent yet (public.js quoteDates, D103).
    const dates = quoteDates(db, loaded.id, today, docSettings(settings).validDays);
    return sendPdf(res, next, buildEstimateHtml(estimate, readPricing(db), settings, dates), exportFilename(estimate));
  });

  // The owner's Cost Breakdown (D8, D13). Owner-only: it sits behind the
  // sign-in like every /api route, and stage E must not expose it publicly.
  app.post('/api/estimates/:id/cost-breakdown', async (req, res, next) => {
    const estimate = load(req.params.id);
    if (!estimate) return res.status(404).json({ error: 'not_found' });

    const pricing = readPricing(db);
    // Totals that no longer match the lines are refused, never printed as "rounding".
    const blocker = costBreakdownBlocker(estimate, pricing);
    if (blocker) return res.status(409).json(blocker);
    const html = buildCostBreakdownHtml(estimate, pricing, readSettings(db));
    return sendPdf(res, next, html, costBreakdownFilename(estimate));
  });
}

module.exports = { registerPdfRoutes };
