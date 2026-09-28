'use strict';

const { newId, nowIso } = require('../db');
const { computeTotals, PRICING_SHAPE } = require('../calc');
const { readPricing, readSettings, sectionLabelsFor, readOverheadRate, negativeLineField } = require('../ratecard');
const { loadEstimate: loadJson } = require('../estimate');

/**
 * pricing_shape_outdated, for estimate writes (v9, .design/service-rate-tiers/).
 * A browser still running the web build from before v9 — a cached Pages copy, a
 * tab left open over the deploy — snapshots every labour line it adds at $0,
 * and its "Update to current rates" re-prices every labour line to $0: its
 * lineSnapshot reads a price from `mu`, which v9 rows no longer have. Each such
 * line is a valid snapshot as far as computeTotals can tell, so nothing past
 * this point could catch it. Every write from a v9 build carries
 * `pricingShape` (calc.js PRICING_SHAPE); one without it is refused, checked
 * FIRST, as the rate card's is, so an old build always gets this code.
 *
 * `message` is what the old build shows: it prints the server's message and
 * knows no codes from after it was built.
 */
const OUTDATED = {
  error: 'pricing_shape_outdated',
  message:
    'This page is out of date — the rate card has changed shape since it was opened, and saving from it ' +
    'would price new work at $0. Copy anything you need from the form, reload the page, and make your ' +
    'changes again.',
};
const outdated = (body) => body.pricingShape !== PRICING_SHAPE;

function registerEstimateRoutes(app, db) {
  app.get('/api/estimates', (_req, res) => {
    const rows = db.prepare('SELECT * FROM estimates ORDER BY updated_at DESC').all();
    res.json({ ok: true, estimates: rows.map(loadJson) });
  });

  app.get('/api/estimates/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, estimate: loadJson(row) });
  });

  app.post('/api/estimates', (req, res) => {
    const body = req.body || {};
    const id = newId('est');
    const now = nowIso();
    const pricing = readPricing(db);
    const gstFree = body.gstFree === true;
    if (outdated(body)) return res.status(400).json(OUTDATED);
    const negative = negativeLineField(body.activeRows);
    if (negative) return res.status(400).json({ error: 'negative_line_value', field: negative });
    const totals = computeTotals(body.activeRows || {}, pricing, readSettings(db), {
      gstFree,
      overheadRate: readOverheadRate(db),
    });
    const sectionLabels = sectionLabelsFor(body.activeRows, pricing, null);

    db.prepare(`
      INSERT INTO estimates
        (id, upid, name, date, status, doc_type, invoice_number, client_id,
         client_json, notes, active_rows_json, section_labels_json, gst_free,
         totals_json, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, body.upid || '', body.name || '', body.date || '',
      body.status || 'draft', body.docType || 'estimate', body.invoiceNumber || '',
      body.clientId || null, JSON.stringify(body.client || {}), body.notes || '',
      JSON.stringify(body.activeRows || {}), JSON.stringify(sectionLabels),
      gstFree ? 1 : 0, JSON.stringify(totals), now, now
    );

    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(id);
    res.status(201).json({ ok: true, estimate: loadJson(row) });
  });

  app.put('/api/estimates/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const body = req.body || {};
    const now = nowIso();
    const pricing = readPricing(db);
    // Absent means false, matching every other field here: a PUT that omits it
    // is a save from a screen that decided the estimate is GST-bearing.
    const gstFree = body.gstFree === true;
    if (outdated(body)) return res.status(400).json(OUTDATED);
    const negative = negativeLineField(body.activeRows);
    if (negative) return res.status(400).json({ error: 'negative_line_value', field: negative });
    const totals = computeTotals(body.activeRows || {}, pricing, readSettings(db), {
      gstFree,
      overheadRate: readOverheadRate(db),
    });
    const sectionLabels = sectionLabelsFor(
      body.activeRows,
      pricing,
      JSON.parse(existing.section_labels_json || '{}')
    );

    db.prepare(`
      UPDATE estimates SET
        upid = ?, name = ?, date = ?, status = ?, doc_type = ?, invoice_number = ?,
        client_id = ?, client_json = ?, notes = ?, active_rows_json = ?,
        section_labels_json = ?, gst_free = ?, totals_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      body.upid || '', body.name || '', body.date || '', body.status || 'draft',
      body.docType || 'estimate', body.invoiceNumber || '', body.clientId || null,
      JSON.stringify(body.client || {}), body.notes || '',
      JSON.stringify(body.activeRows || {}), JSON.stringify(sectionLabels),
      gstFree ? 1 : 0, JSON.stringify(totals), now,
      req.params.id
    );

    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    res.json({ ok: true, estimate: loadJson(row) });
  });

  app.delete('/api/estimates/:id', (req, res) => {
    const result = db.prepare('DELETE FROM estimates WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  app.post('/api/estimates/:id/duplicate', (req, res) => {
    const existing = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const id = newId('est');
    const now = nowIso();
    // A duplicate is a copy of the document, headings and tax treatment included
    // — it inherits the original's labels and GST-free flag rather than
    // re-deriving them from a rate card or a settings row that may have moved on
    // since. Its totals are copied for the same reason. Saving the copy
    // re-snapshots all of it, like any other edit.
    db.prepare(`
      INSERT INTO estimates
        (id, upid, name, date, status, doc_type, invoice_number, client_id,
         client_json, notes, active_rows_json, section_labels_json, gst_free,
         totals_json, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, existing.upid, `${existing.name} (copy)`, existing.date, 'draft',
      existing.doc_type, '', existing.client_id, existing.client_json,
      existing.notes, existing.active_rows_json, existing.section_labels_json,
      existing.gst_free, existing.totals_json, now, now
    );

    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(id);
    res.status(201).json({ ok: true, estimate: loadJson(row) });
  });
}

module.exports = { registerEstimateRoutes };
