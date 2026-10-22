'use strict';

/**
 * Pushing an invoice to Hnry as a draft (hnry-invoicing H3 and H4).
 *
 * WHEN: a deposit or single invoice goes right after a project is accepted (the
 * owner's Mark accepted, the client's signature, or Create invoices), once the
 * accept has COMMITTED; a final goes when the user asks (`POST
 * /api/invoices/:id/hnry`, which is also Retry for any invoice). The accept
 * never waits for Hnry and never fails because of it: an automatic push runs in
 * the background, and what it did is written on the invoice row (`hnry_*`,
 * schema v20) and in the activity log. Hnry not being set up at all is silent:
 * nothing is pushed and the app behaves as it did before Hnry.
 *
 * WHAT: each invoice becomes one Hnry DRAFT made of LINES, in this order:
 *   deposit  "Deposit invoice (N%): <project>"                    the deposit
 *   single   "Invoice: <project>"                                 the balance
 *   final    "Final invoice: <project>"                           the job's total
 *            one line per extra (or "Additional work" when the pieces can't be
 *            made to add up), then "Less deposit (<the deposit's Hnry number>)"
 *            as a negative line
 * The app's own invoice number rides in Hnry's PO field. The user sends the
 * draft from Hnry.
 *
 * MONEY RULES (the reason this file is Opus work):
 *   - Every price comes from the invoice's STORED totals, never repriced, and
 *     the lines are checked to add up to the cent to what the app asks the
 *     client to pay (amountDue). If they don't, nothing is pushed
 *     (`amount_mismatch`).
 *   - GST: Hnry adds none for an unregistered user, and its handling of a
 *     registered one is unchecked (brief C2). So nothing is pushed if the
 *     invoice carries GST in any figure, or Settings says the business is
 *     registered: the invoice is marked `gst_registered`.
 *   - Idempotent and resumable: an invoice whose lines are all in Hnry is left
 *     alone; one with some (`hnry_lines_done`) continues from the next line, so
 *     a retry after a failure adds only what is missing. Before creating a
 *     draft the push looks for one carrying this invoice's number as its PO, so
 *     a push that died between Hnry and the database can't make a second.
 *     KNOWN LIMIT: a line that timed out may still have landed in Hnry (Zapier
 *     can't read a draft's lines back), so the user checks the draft before
 *     sending it.
 *   - One push per invoice at a time (a retry during the accept's own push
 *     shares it).
 */

const { nowIso } = require('./db');
const { amountDue, parseJson, extrasRows, liveDeposit } = require('./invoices');
const { readSettings, readPricing } = require('./ratecard');
const { extrasTotals } = require('./calc');
const { logActivity } = require('./routes/projects');
const { HnryError } = require('./hnry');

/* Pushed by the app on its own at acceptance; a final waits for the user. */
const AUTO = new Set(['deposit', 'single']);
const PUSHABLE = new Set(['deposit', 'single', 'final']);

const cents = (n) => Math.round((Number(n) || 0) * 100);

/* "50" or "33.3", never "50.0": a percent as a person writes it. */
function pctText(pct) {
  const n = Number(pct);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
}

const nameOf = (projectName) => String(projectName || '').trim().slice(0, 200) || 'Project';

function describe(row, projectName) {
  const name = nameOf(projectName);
  if (row.kind === 'deposit') {
    const pct = pctText(row.pct);
    return `Deposit invoice${pct ? ` (${pct}%)` : ''}: ${name}`;
  }
  if (row.kind === 'final') return `Final invoice: ${name}`;
  return `Invoice: ${name}`;
}

/* Does any figure on the invoice carry GST? (A deposit's totals are flat; a
   final's or single's are blocks.) */
function carriesGst(totals) {
  const t = totals || {};
  return [t.gst, t.job, t.extras, t.deposit, t.total, t.balance]
    .some((v) => Number(v && typeof v === 'object' ? v.gst : v) > 0);
}

class PlanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* The extras as lines. Each is priced on its own through calc.js, as the invoice
   was; if those pieces don't add up to the stored extras figure to the cent
   (a rounding or a rule that works on the whole), one "Additional work" line
   carries the stored figure instead, so the total is exact either way. */
function extraLines(db, row, snapshot, totals) {
  const stored = cents(totals.extras && totals.extras.clientPriceExGst);
  if (stored === 0) return [];
  const rows = extrasRows(row);
  const pricing = readPricing(db);
  const settings = readSettings(db);
  const gstFree = snapshot && snapshot.gstFree === true;
  const job = (snapshot && snapshot.totals) || {};
  const lines = [];
  let sum = 0;
  for (const r of rows) {
    let each = 0;
    try {
      each = cents(extrasTotals({ additional: [r] }, pricing, settings, gstFree, job).clientPriceExGst);
    } catch (_) {
      lines.length = 0;
      sum = -1; // can't price a line on its own: use the combined line
      break;
    }
    sum += each;
    if (each === 0) continue; // a $0 line bills nothing
    const q = Number(r.qty);
    lines.push({
      description: String(r.name || 'Additional work').trim().slice(0, 450) + (q > 0 && q !== 1 ? ` (×${q})` : ''),
      price: each / 100,
    });
  }
  if (sum === stored && lines.length) return lines;
  return [{ description: 'Additional work', price: stored / 100 }];
}

/**
 * The invoice's lines, or throws PlanError. `price`s are in dollars, ex GST
 * (GST has already been refused), and add up to what the app bills.
 */
function planFor(db, row, snapshot, totals) {
  const name = snapshot && snapshot.name;
  // Nothing owed (a 100% deposit leaves a $0 final) is nothing to invoice.
  if (!(cents(amountDue(row.kind, totals)) > 0)) throw new PlanError('zero_amount', 'The invoice has nothing to bill.');
  let lines;
  if (row.kind === 'final') {
    const job = cents(totals.job && totals.job.clientPriceExGst);
    if (job <= 0) throw new PlanError('zero_amount', 'The invoice has nothing to bill.');
    const less = cents(totals.deposit && totals.deposit.totalIncGst);
    let depositRow = null;
    if (less !== 0) {
      depositRow = (row.less_invoice_id && db.prepare("SELECT * FROM invoices WHERE id = ? AND status <> 'void'").get(row.less_invoice_id))
        || liveDeposit(db, row.project_id);
      if (!depositRow || !depositRow.hnry_number) {
        throw new PlanError('deposit_not_in_hnry', 'Create the deposit invoice in Hnry first: the final takes it off by its Hnry number.');
      }
    }
    lines = [{ description: describe(row, name), price: job / 100 }, ...extraLines(db, row, snapshot, totals)];
    if (less !== 0) lines.push({ description: `Less deposit (${depositRow.hnry_number})`, price: -less / 100 });
  } else {
    lines = [{ description: describe(row, name), price: amountDue(row.kind, totals) }];
  }
  const sum = lines.reduce((s, l) => s + cents(l.price), 0);
  if (sum !== cents(amountDue(row.kind, totals)) || lines.some((l) => cents(l.price) === 0)) {
    throw new PlanError('amount_mismatch', 'The lines don’t add up to what the invoice bills, so nothing was sent to Hnry.');
  }
  return lines;
}

function createHnryPusher(db, hnry, opts = {}) {
  const now = opts.now || nowIso;
  const inflight = new Map(); // invoice id -> the promise of its push
  const pending = new Set();

  function fail(row, code, message) {
    const at = now();
    db.prepare('UPDATE invoices SET hnry_error = ?, updated_at = ? WHERE id = ?').run(code, at, row.id);
    logActivity(db, row.project_id, 'hnry_push_failed', { invoiceId: row.id, number: row.number, code, message: message || '' }, at);
    return { ok: false, code, message: message || '' };
  }

  /* The Hnry client for this invoice's client, remembered on the client row.
     `forget` says which client row's remembered id to drop if the push then
     fails: an id Hnry no longer knows (the client was deleted there) would
     otherwise fail every retry. A failure for any other reason costs one extra
     lookup next time, which is cheap. */
  async function clientFor(row, snapshot, forget) {
    const project = db.prepare('SELECT client_id FROM projects WHERE id = ?').get(row.project_id) || {};
    const local = project.client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(project.client_id) : null;
    if (local && local.hnry_client_id) {
      forget.clientRowId = local.id;
      return local.hnry_client_id;
    }
    const snap = (snapshot && snapshot.client) || {};
    const name = String((local && local.business_name) || snap.businessName || (local && local.contact_name) || snap.contactName || '').trim();
    const email = String((local && local.email) || snap.email || '').trim();
    if (!name) throw new HnryError('no_client', 'This project has no client name to invoice.');
    const found = await hnry.findOrCreateClient(email ? { name, email } : { name });
    if (local) db.prepare('UPDATE clients SET hnry_client_id = ? WHERE id = ?').run(found.id, local.id);
    return found.id;
  }

  async function run(invoiceId) {
    let row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    if (!row || !PUSHABLE.has(row.kind)) return { ok: false, skipped: 'not_pushable' };
    if (row.hnry_pushed_at) return { ok: true, already: true, hnryNumber: row.hnry_number };
    // Only a draft is made in Hnry. One the app has already scheduled or sent to
    // the client is out by the old way and stays there; void and paid are done.
    if (row.status !== 'draft') return { ok: false, skipped: row.status };
    if (!hnry.enabled) return { ok: false, skipped: 'not_configured' };

    const totals = parseJson(row.totals_json, {});
    if (carriesGst(totals) || (readSettings(db).gst || {}).registered) {
      return fail(row, 'gst_registered', 'GST handling in Hnry isn’t set up yet.');
    }
    const snapshot = parseJson(row.estimate_snapshot_json, {});
    let lines;
    try {
      lines = planFor(db, row, snapshot, totals);
    } catch (err) {
      if (err instanceof PlanError) return fail(row, err.code, err.message);
      throw err;
    }

    const forget = { clientRowId: null };
    try {
      // 1. The draft, with its first line: made now, or found if an earlier push made it.
      if (!row.hnry_invoice_id) {
        const clientId = await clientFor(row, snapshot, forget);
        let made = await hnry.findByPo({ clientId, poNumber: row.number });
        if (!made) {
          made = await hnry.createInvoice({
            clientId, poNumber: row.number, description: lines[0].description, quantity: 1, price: lines[0].price,
          });
        }
        const at = now();
        db.prepare(`
          UPDATE invoices SET hnry_invoice_id = ?, hnry_number = ?, hnry_lines_done = 1, hnry_error = NULL, updated_at = ?
           WHERE id = ?
        `).run(made.id, made.number, at, row.id);
        row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(row.id);
      }
      // 2. The rest of the lines, from where an earlier push stopped.
      for (let i = Math.max(1, row.hnry_lines_done || 1); i < lines.length; i += 1) {
        await hnry.addItem({ invoiceId: row.hnry_invoice_id, description: lines[i].description, quantity: 1, price: lines[i].price });
        db.prepare('UPDATE invoices SET hnry_lines_done = ?, updated_at = ? WHERE id = ?').run(i + 1, now(), row.id);
      }
      // 3. All of it is in Hnry.
      const at = now();
      db.transaction(() => {
        db.prepare('UPDATE invoices SET hnry_pushed_at = ?, hnry_lines_done = ?, hnry_error = NULL, updated_at = ? WHERE id = ?')
          .run(at, lines.length, at, row.id);
        logActivity(db, row.project_id, 'hnry_pushed', {
          invoiceId: row.id, number: row.number, hnryNumber: row.hnry_number, lines: lines.length, amount: amountDue(row.kind, totals),
        }, at);
      })();
      return { ok: true, hnryNumber: row.hnry_number };
    } catch (err) {
      if (forget.clientRowId) db.prepare('UPDATE clients SET hnry_client_id = NULL WHERE id = ?').run(forget.clientRowId);
      const code = err instanceof HnryError ? err.code : 'zapier_error';
      return fail(row, code, err instanceof HnryError ? err.message : 'Hnry failed.');
    }
  }

  /** Push one invoice. Never rejects; resolves { ok, ... }. Two calls for one invoice share one push. */
  function push(invoiceId) {
    if (inflight.has(invoiceId)) return inflight.get(invoiceId);
    const p = run(invoiceId)
      .catch((err) => {
        // Not reachable by design (run catches); if the DB itself failed, say so and move on.
        console.error('[hnry] push failed unexpectedly:', err && err.message);
        return { ok: false, code: 'internal' };
      })
      .finally(() => {
        inflight.delete(invoiceId);
        pending.delete(p);
      });
    inflight.set(invoiceId, p);
    pending.add(p);
    return p;
  }

  return {
    push,
    /** The deposit / single among `made` ({ id, kind }), in the background: the caller does not wait. */
    pushMade(made) {
      for (const inv of made || []) if (AUTO.has(inv.kind)) push(inv.id);
    },
    /** Resolves once every push begun so far has finished (tests, shutdown). */
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

module.exports = { createHnryPusher, describe, planFor, carriesGst, PlanError, AUTO, PUSHABLE };
