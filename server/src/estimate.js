'use strict';

/**
 * One estimates-row → object mapper, for every route that reads one.
 *
 * There used to be two: `loadJson` in routes/estimates.js and `loadEstimate` in
 * routes/pdf.js. Each new column had to be remembered in both, and twice now it
 * wasn't — first the rate-card lookup (see the note in ratecard.js), then
 * `sectionLabels`, which the API returned and the PDF silently dropped, so a
 * renamed category still re-headed the client's document even though the
 * snapshot fixing that was sitting in the row.
 *
 * The PDF needs fewer fields than the API does, but carrying a couple of spare
 * ones costs nothing and is worth not having a second definition of what an
 * estimate is.
 */
function loadEstimate(row) {
  return {
    id: row.id,
    upid: row.upid,
    name: row.name,
    date: row.date,
    status: row.status,
    docType: row.doc_type,
    invoiceNumber: row.invoice_number,
    clientId: row.client_id,
    client: JSON.parse(row.client_json || '{}'),
    notes: row.notes,
    activeRows: JSON.parse(row.active_rows_json || '{}'),
    // What each labour category was called when this estimate was saved. The
    // PDF and the detail view prefer it over the live rate card so a renamed or
    // deleted category doesn't rewrite a document that has already gone out.
    sectionLabels: JSON.parse(row.section_labels_json || '{}'),
    // Whether GST applies to this estimate at all. Stored per estimate because
    // being registered doesn't make every job GST-bearing, and because the tax
    // treatment of a sent document must not move — see calc.js's header.
    gstFree: row.gst_free === 1,
    totals: JSON.parse(row.totals_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { loadEstimate };
