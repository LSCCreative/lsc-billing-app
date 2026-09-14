'use strict';

const { newId, nowIso } = require('../db');
const { computeTotals } = require('../calc');
const { readPricing, readSettings, sectionLabelsFor } = require('../ratecard');
const { loadEstimate: loadJson } = require('../estimate');

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
    const totals = computeTotals(body.activeRows || {}, pricing, readSettings(db), { gstFree });
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
    const totals = computeTotals(body.activeRows || {}, pricing, readSettings(db), { gstFree });
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
