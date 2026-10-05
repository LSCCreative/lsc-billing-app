'use strict';

const { extrasTotals, finalInvoiceTotals, singleInvoiceTotals } = require('./calc');

/**
 * Invoices after they are made (production-booking task 20; D35–D37, D100).
 * Task 19 makes them (routes/projects.js createInvoices); this is what reads,
 * edits, numbers and prices them afterwards. The routes are
 * routes/invoices.js, the PDFs pdf.js.
 *
 * THE AMOUNTS NEVER COME FROM THE LIVE ESTIMATE. Every invoice prints from
 * `estimate_snapshot_json`, the estimate as it was accepted, and its stored
 * totals (calc.js task 14):
 *   - a deposit is depositAmount(snapshot totals, pct), stored, and passed
 *     on whole to its final: never recomputed from a percent later;
 *   - a final is finalInvoiceTotals(snapshot totals, extras, its deposit's
 *     STORED totals_json), where the deposit is the one `less_invoice_id`
 *     names;
 *   - a single is singleInvoiceTotals(snapshot totals, extras).
 * Extras (Overtime, an extra revision round: D14, D35) are priced once, when
 * a draft is saved, from the prices the lines carry (each line's own `mu`
 * snapshot, as on an estimate), so a later Rate Card change can't move them.
 * Anything that only re-links a final to another deposit reuses the extras
 * block already stored rather than pricing the lines again.
 */

/* The order invoices are listed and worked through in (projects.js
   projectStage reads the same order). */
const KIND_ORDER = ['deposit', 'final', 'single', 'legacy'];

/* The section an extra comes from (D14): Additional work, id `additional`. */
const EXTRAS_SECTION = 'additional';

const MAX_EXTRAS = 100;
const MAX_NAME = 200;
const MAX_REASON = 500;

const parseJson = (json, fallback) => {
  try {
    const value = JSON.parse(json || '');
    return value === null || value === undefined ? fallback : value;
  } catch (_) {
    return fallback; // a bad row reads as empty, as everywhere else
  }
};

/* What an invoice asks the client to pay: a deposit or old-way invoice its
   total, a final or single invoice its balance (calc.js invoiceTotals). */
function amountDue(kind, totals) {
  const t = totals || {};
  const due = kind === 'final' || kind === 'single' ? t.balanceDue : t.totalIncGst;
  return Number(due) || 0;
}

const finiteNonNeg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * The extras a draft final or single invoice is saved with, checked and cut
 * down to what prices a line: its name, quantity, a custom amount when the
 * service takes one, and the price snapshot it was added with (calc.js
 * lineSnapshot's fields). A line must carry its price (`mu`): an extra is
 * never priced from the live card on the server, so what the owner saw in
 * the picker is what is billed.
 *
 * @returns {{rows: object[]}|{error: string, index?: number}}
 */
function parseExtras(list) {
  if (!Array.isArray(list)) return { error: 'extras_invalid' };
  if (list.length > MAX_EXTRAS) return { error: 'extras_too_many' };
  const rows = [];
  for (let i = 0; i < list.length; i += 1) {
    const line = list[i];
    if (!line || typeof line !== 'object') return { error: 'extra_invalid', index: i };
    const name = typeof line.name === 'string' ? line.name.trim() : '';
    if (!name || name.length > MAX_NAME) return { error: 'extra_name_invalid', index: i };
    const qty = Number(line.qty === '' || line.qty === null || line.qty === undefined ? 0 : line.qty);
    if (!finiteNonNeg(qty)) return { error: 'extra_qty_invalid', index: i };
    const mu = line.mu === '' || line.mu === null || line.mu === undefined ? NaN : Number(line.mu);
    if (!finiteNonNeg(mu)) return { error: 'extra_price_missing', index: i };
    const out = { name, qty, mu };
    if (typeof line.rowId === 'string' && line.rowId) out.rowId = line.rowId;
    if (line.hoursPerUnit !== undefined && line.hoursPerUnit !== null && line.hoursPerUnit !== '') {
      const h = Number(line.hoursPerUnit);
      if (!(Number.isFinite(h) && h > 0)) return { error: 'extra_hours_invalid', index: i };
      out.hoursPerUnit = h;
    }
    if (line.dayUnit === 'full' || line.dayUnit === 'half') out.dayUnit = line.dayUnit;
    if (line.rate !== undefined && line.rate !== null && line.rate !== '') {
      const rate = Number(line.rate);
      if (!finiteNonNeg(rate)) return { error: 'extra_rate_invalid', index: i };
      out.rate = rate;
    }
    if (line.customBill === true) {
      out.customBill = true;
      const override = Number(line.override === '' || line.override === null || line.override === undefined ? 0 : line.override);
      if (!finiteNonNeg(override)) return { error: 'extra_amount_invalid', index: i };
      if (override > 0) out.override = override;
    }
    rows.push(out);
  }
  return { rows };
}

/* The stored extras as lines. extras_json is activeRows-shaped,
   `{ additional: [...] }`, so calc.js prices it like any estimate's rows. */
function extrasRows(row) {
  const rows = parseJson(row && row.extras_json, {})[EXTRAS_SECTION];
  return Array.isArray(rows) ? rows : [];
}

/**
 * A final or single invoice's totals, from its snapshot, its extras and (a
 * final) its deposit's stored totals. `extras` is either the lines, priced
 * here through calc.js extrasTotals (a draft being saved), or an extras block
 * already stored ({ clientPriceExGst, gst, totalIncGst }), reused as it is.
 */
function billTotals(kind, snapshot, extras, depositTotals, pricing, settings) {
  const job = (snapshot && snapshot.totals) || {};
  let add = null;
  if (Array.isArray(extras)) {
    add = extras.length
      ? extrasTotals({ [EXTRAS_SECTION]: extras }, pricing, settings, snapshot && snapshot.gstFree === true, job)
      : null;
  } else if (extras && Number(extras.totalIncGst)) {
    add = extras;
  }
  return kind === 'final' ? finalInvoiceTotals(job, add, depositTotals || {}) : singleInvoiceTotals(job, add);
}

/* The deposit a final takes off: the one it names, or (when that one was
   voided and replaced) the deposit actually standing — a paid one first,
   then the newest. Null when the project has none. */
function liveDeposit(db, projectId) {
  return db.prepare(`
    SELECT * FROM invoices WHERE project_id = ? AND kind = 'deposit' AND status <> 'void'
     ORDER BY (status = 'paid') DESC, created_at DESC, id DESC LIMIT 1
  `).get(projectId) || null;
}

/**
 * The number a replacement takes (D100): the next free suffix after the
 * kind's own — `INV-<UPID>-D2`, `-F2`, or `INV-<UPID>-2` for a single — then
 * 3, 4… A number another invoice holds (case aside; old-way invoices were
 * numbered by hand and don't count, as at creation) is skipped.
 */
function replacementNumber(db, upid, kind) {
  const base = kind === 'deposit' ? `INV-${upid}-D` : kind === 'final' ? `INV-${upid}-F` : `INV-${upid}-`;
  const taken = db.prepare(`
    SELECT 1 FROM invoices WHERE number = ? COLLATE NOCASE AND kind <> 'legacy' LIMIT 1
  `);
  for (let n = 2; n < 10000; n += 1) {
    const number = base + n;
    if (!taken.get(number)) return number;
  }
  return null;
}

/* Why this invoice can't be edited, as a reply body; or null. Only an app-made
   draft edits in place (D100). */
function cannotEdit(row) {
  if (row.kind === 'legacy') {
    return { error: 'legacy_invoice', message: 'This invoice was made the old way, so it can’t be changed here.' };
  }
  if (row.status === 'draft') return null;
  const message = {
    scheduled: 'This invoice is scheduled to send. Cancel the send first.',
    sent: 'This invoice has gone to the client. To correct it, void it and make a replacement.',
    paid: 'This invoice is paid, so it can’t change.',
    void: 'This invoice is void. Its replacement is the one to edit.',
  }[row.status] || 'This invoice can’t be changed.';
  return { error: 'not_draft', status: row.status, message };
}

/* A reason for voiding: required, trimmed, one paragraph at most. */
function voidReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason) return { error: 'void_reason_required', message: 'Say why it’s being voided.' };
  if (reason.length > MAX_REASON) return { error: 'void_reason_too_long', message: 'Keep the reason under 500 characters.' };
  return { reason };
}

/**
 * One invoice whole, for its own screen. Owner-only: `estimate` is the
 * snapshot as accepted, totals and internal figures included — a public
 * invoice page (Stage E) must print from it through the client PDF's fields,
 * never send it whole.
 *
 * `less` is the deposit a final takes off, `replaces` / `replacedBy` the
 * void-and-remake chain (D100). `editable` says whether it edits in place;
 * `depositEditable`, for a deposit, whether its % can still change — not
 * once its final has gone out with that deposit taken off it.
 */
function invoiceJson(db, row) {
  const byId = db.prepare('SELECT id, kind, number, status, totals_json, paid_at, voided_at FROM invoices WHERE id = ?');
  const brief = (r) => (r ? { id: r.id, kind: r.kind, number: r.number || null, status: r.status, paidAt: r.paid_at || null } : null);
  const totals = parseJson(row.totals_json, {});
  const legacy = row.kind === 'legacy';
  const less = row.less_invoice_id ? byId.get(row.less_invoice_id) : null;
  const replacedBy = db.prepare('SELECT id, kind, number, status, paid_at FROM invoices WHERE replaces_id = ? ORDER BY created_at, id LIMIT 1')
    .get(row.id);
  const finals = row.kind === 'deposit'
    ? db.prepare("SELECT status FROM invoices WHERE less_invoice_id = ? AND kind = 'final' AND status <> 'void'").all(row.id)
    : [];
  return {
    id: row.id,
    projectId: row.project_id,
    estimateId: row.estimate_id || null,
    kind: row.kind,
    number: row.number || null,
    status: row.status,
    pct: row.pct === null || row.pct === undefined ? null : row.pct,
    // A legacy invoice's snapshot is the old estimates row, not an estimate:
    // its screen reads only the number and the amount.
    estimate: legacy ? null : parseJson(row.estimate_snapshot_json, null),
    extras: extrasRows(row),
    totals,
    amountDue: amountDue(row.kind, totals),
    less: less ? Object.assign(brief(less), { voidedAt: less.voided_at || null, totals: parseJson(less.totals_json, {}) }) : null,
    replaces: row.replaces_id ? brief(byId.get(row.replaces_id)) : null,
    replacedBy: brief(replacedBy),
    issuedAt: row.issued_at || null,
    dueAt: row.due_at || null,
    paidAt: row.paid_at || null,
    paidVia: row.paid_via || null,
    voidedAt: row.voided_at || null,
    voidReason: row.void_reason || null,
    editable: !cannotEdit(row),
    depositEditable: row.kind === 'deposit' && row.status === 'draft' && finals.every((f) => f.status === 'draft'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  KIND_ORDER,
  EXTRAS_SECTION,
  amountDue,
  parseExtras,
  extrasRows,
  billTotals,
  liveDeposit,
  replacementNumber,
  cannotEdit,
  voidReason,
  invoiceJson,
  parseJson,
};
