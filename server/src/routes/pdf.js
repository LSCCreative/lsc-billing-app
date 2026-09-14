'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const { buildEstimateHtml, exportBlocker, exportFilename, renderPdfBuffer } = require('../pdf');
const { readPricing, readSettings } = require('../ratecard');
const { loadEstimate } = require('../estimate');

function registerPdfRoutes(app, db) {
  app.post('/api/estimates/:id/pdf', async (req, res, next) => {
    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    const estimate = loadEstimate(row);
    const settings = readSettings(db);
    const blocker = exportBlocker(estimate, settings);
    if (blocker) return res.status(422).json(blocker);

    const html = buildEstimateHtml(estimate, readPricing(db), settings);

    let buffer;
    try {
      buffer = await renderPdfBuffer(html);
    } catch (err) {
      if (err.code === 'pdf_unavailable') {
        return res.status(503).json({ error: 'pdf_unavailable' });
      }
      return next(err);
    }

    const filename = exportFilename(estimate);
    fs.mkdirSync(config.exportDir, { recursive: true });
    fs.writeFileSync(path.join(config.exportDir, filename), buffer);

    // attachment() encodes the name per RFC 6266. A hand-built header 500s on
    // any character outside Latin-1 — a curly apostrophe in a client's name.
    res.attachment(filename);
    res.send(buffer);
  });
}

module.exports = { registerPdfRoutes };
