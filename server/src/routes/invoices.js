'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const { newId, nowIso } = require('../db');
const { readPricing, readSettings } = require('../ratecard');
const { depositAmount } = require('../calc');
const {
  buildInvoiceDocHtml, invoiceFilename, invoiceBlocker, buildCostBreakdownHtml, costBreakdownBlocker,
  costBreakdownFilename, renderPdfBuffer,
} = require('../pdf');
const {
  EXTRAS_SECTION, parseExtras, billTotals, liveDeposit, replacementNumber, cannotEdit, voidReason,
  invoiceJson, parseJson,
} = require('../invoices');
const { readFolder, logActivity, todayOf, isYmd } = require('./projects');
const { sendRequest, addSend, cancelPending, sydneyDate } = require('../sends');
const { newToken } = require('../public');

const PAID_VIA = ['bank', 'card'];

/**
 * One invoice (production-booking task 20; IA "Invoice", D35–D37, D100).
 *
 *   GET  /api/invoices/:id?today=       the invoice whole (invoices.js
 *                                       invoiceJson), with its project's
 *                                       summary and the project's invoices.
 *   PUT  /api/invoices/:id              a draft, edited in place (D100):
 *                                       { extras: [...] } on a final or single
 *                                       (D35); { depositPct } on a deposit,
 *                                       until its final has gone out.
 *   POST /api/invoices/:id/sent         { issuedAt, dueAt } — Mark sent, Stage
 *                                       D's stand-in for sending, with any
 *                                       issue date. From draft. The app now
 *                                       sends through /send.
 *   POST /api/invoices/:id/send         the send panel (task 29, D43), from
 *                                       draft: { by: 'email', to, message?,
 *                                       scheduledFor?, dueAt } becomes
 *                                       `scheduled` with its dates and link,
 *                                       and `sent` when the email goes
 *                                       (sends.js); { by: 'link', dueAt } is
 *                                       "Copy link": `sent` now, no email.
 *                                       Issued the day it goes.
 *   POST /api/invoices/:id/paid         { paidAt, via: bank|card } — from any
 *                                       unpaid, unvoided invoice, an old-way
 *                                       one included (its stage line reads
 *                                       invoiced until then).
 *   POST /api/invoices/:id/void         { reason } — a sent, unpaid invoice is
 *                                       voided (dated today, kept with its
 *                                       number) and a draft replacement made
 *                                       with the next free suffix (D100). A
 *                                       draft is edited instead; a paid one is
 *                                       never voided.
 *   POST /api/invoices/:id/pdf          { issuedAt?, dueAt? } — the PDF. A draft
 *                                       has no dates yet: the ones given (Mark
 *                                       sent's dialog passes its fields), else
 *                                       issued today.
 *   POST /api/invoices/:id/cost-breakdown  the estimate's Cost Breakdown, with
 *                                       what this invoice bills (D8).
 *
 * Every write answers as GET does, logs an `activity` row and touches the
 * project, so the folder's list and its Activity move with it.
 */
function registerInvoiceRoutes(app, db) {
  const rowOf = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);

  function reply(req, res, id, extra) {
    const today = todayOf(req);
    if (!today) return res.status(400).json({ error: 'today_invalid' });
    const row = rowOf(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const folder = readFolder(db, row.project_id, today);
    // Its link and newest email (task 29) as the folder's row has them.
    const listed = folder.invoices.find((i) => i.id === row.id) || {};
    const invoice = { ...invoiceJson(db, row), publicToken: listed.publicToken || null, send: listed.send || null };
    return res.json({ ok: true, invoice, project: folder.project, invoices: folder.invoices, ...(extra || {}) });
  }

  /* The invoice behind an action, or null once a 404 has been sent. A bad
     `today` is refused before anything is written. */
  function invoiceFor(req, res) {
    if (!todayOf(req)) {
      res.status(400).json({ error: 'today_invalid' });
      return null;
    }
    const row = rowOf(req.params.id);
    if (!row) res.status(404).json({ error: 'not_found' });
    return row || null;
  }

  const touch = (row, now) => {
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, row.project_id);
  };

  /* A final re-priced against its deposit's stored totals, keeping the extras
     block it has (invoices.js: never priced twice). */
  function repriceFinal(final, deposit, now) {
    const snapshot = parseJson(final.estimate_snapshot_json, {});
    const totals = billTotals('final', snapshot, parseJson(final.totals_json, {}).extras, parseJson(deposit.totals_json, {}));
    db.prepare('UPDATE invoices SET totals_json = ?, less_invoice_id = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(totals), deposit.id, now, final.id);
  }

  app.get('/api/invoices/:id', (req, res) => reply(req, res, req.params.id));

  app.put('/api/invoices/:id', (req, res) => {
    const row = invoiceFor(req, res);
    if (!row) return undefined;
    const refusal = cannotEdit(row);
    if (refusal) return res.status(409).json(refusal);
    const body = req.body || {};
    const snapshot = parseJson(row.estimate_snapshot_json, {});
    const now = nowIso();

    if (row.kind === 'deposit') {
      const pct = Number(body.depositPct);
      if (body.depositPct === undefined || body.depositPct === null || body.depositPct === '' ||
          !Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return res.status(400).json({ error: 'deposit_pct_invalid', message: 'The deposit must be more than 0% and at most 100%.' });
      }
      const finals = db.prepare("SELECT * FROM invoices WHERE less_invoice_id = ? AND kind = 'final' AND status <> 'void'").all(row.id);
      if (finals.some((f) => f.status !== 'draft')) {
        return res.status(409).json({
          error: 'final_sent',
          message: 'The final invoice has gone out with this deposit taken off it, so the deposit can’t change now.',
        });
      }
      const deposit = depositAmount(snapshot.totals, pct);
      db.transaction(() => {
        db.prepare('UPDATE invoices SET pct = ?, totals_json = ?, updated_at = ? WHERE id = ?')
          .run(pct, JSON.stringify(deposit), now, row.id);
        finals.forEach((f) => repriceFinal(f, { id: row.id, totals_json: JSON.stringify(deposit) }, now));
        // The project's deposit % follows its deposit invoice (D33).
        db.prepare('UPDATE projects SET deposit_pct = ?, updated_at = ? WHERE id = ?').run(pct, now, row.project_id);
        logActivity(db, row.project_id, 'invoice_edited', {
          invoiceId: row.id, number: row.number, depositPct: pct, amountDue: deposit.totalIncGst,
        }, now);
      })();
      return reply(req, res, row.id);
    }

    const parsed = parseExtras(body.extras);
    if (parsed.error) return res.status(400).json(parsed);
    const deposit = row.kind === 'final'
      ? (row.less_invoice_id && rowOf(row.less_invoice_id)) || liveDeposit(db, row.project_id)
      : null;
    if (row.kind === 'final' && !deposit) return res.status(409).json({ error: 'no_deposit' });
    const totals = billTotals(row.kind, snapshot, parsed.rows, deposit && parseJson(deposit.totals_json, {}),
      readPricing(db), readSettings(db));
    db.transaction(() => {
      db.prepare('UPDATE invoices SET extras_json = ?, totals_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify({ [EXTRAS_SECTION]: parsed.rows }), JSON.stringify(totals), now, row.id);
      touch(row, now);
      logActivity(db, row.project_id, 'invoice_edited', {
        invoiceId: row.id, number: row.number, extras: parsed.rows.length, amountDue: totals.balanceDue,
      }, now);
    })();
    return reply(req, res, row.id);
  });

  app.post('/api/invoices/:id/sent', (req, res) => {
    const row = invoiceFor(req, res);
    if (!row) return undefined;
    const refusal = cannotEdit(row);
    if (refusal) return res.status(409).json(refusal);
    const { issuedAt, dueAt } = req.body || {};
    if (!isYmd(issuedAt)) return res.status(400).json({ error: 'issued_at_invalid', message: 'Choose the date it was issued.' });
    if (!isYmd(dueAt) || dueAt < issuedAt) {
      return res.status(400).json({ error: 'due_at_invalid', message: 'The due date can’t be before the issue date.' });
    }
    const now = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE invoices SET status = 'sent', issued_at = ?, due_at = ?, updated_at = ? WHERE id = ?")
        .run(issuedAt, dueAt, now, row.id);
      touch(row, now);
      logActivity(db, row.project_id, 'invoice_sent', { invoiceId: row.id, number: row.number, issuedAt, dueAt }, now);
    })();
    return reply(req, res, row.id);
  });

  app.post('/api/invoices/:id/send', (req, res) => {
    const row = invoiceFor(req, res);
    if (!row) return undefined;
    const refusal = cannotEdit(row);
    if (refusal) return res.status(409).json(refusal);
    const now = nowIso();
    const ask = sendRequest(req.body, now);
    if (ask.error) return res.status(400).json(ask);
    if (ask.by === 'email' && !(app.locals.mailer && app.locals.mailer.configured)) {
      return res.status(409).json({ error: 'not_configured', message: 'Email isn’t set up yet. Copy the link and send it yourself.' });
    }
    const issuedAt = ask.later ? sydneyDate(ask.scheduledFor) : todayOf(req);
    const { dueAt } = req.body || {};
    if (!isYmd(dueAt) || dueAt < issuedAt) {
      return res.status(400).json({ error: 'due_at_invalid', message: 'The due date can’t be before the day it’s sent.' });
    }
    db.transaction(() => {
      // Its link is made now, not when the email goes, so Copy link works
      // while it waits (IA: made the first time it's sent, and kept).
      db.prepare(`
        UPDATE invoices SET status = ?, issued_at = ?, due_at = ?, public_token = COALESCE(public_token, ?), updated_at = ?
         WHERE id = ?
      `).run(ask.by === 'email' ? 'scheduled' : 'sent', issuedAt, dueAt, newToken(), now, row.id);
      touch(row, now);
      if (ask.by === 'email') {
        addSend(db, {
          docKind: 'invoice', docId: row.id, toEmail: ask.to, message: ask.message, scheduledFor: ask.scheduledFor,
        }, now);
      } else {
        logActivity(db, row.project_id, 'invoice_sent', { invoiceId: row.id, number: row.number, issuedAt, dueAt, by: 'link' }, now);
      }
    })();
    if (ask.by === 'email' && !ask.later && app.locals.outbox) app.locals.outbox.kick();
    return reply(req, res, row.id);
  });

  app.post('/api/invoices/:id/paid', (req, res) => {
    const row = invoiceFor(req, res);
    if (!row) return undefined;
    if (row.status === 'paid') return reply(req, res, row.id, { already: true });
    if (row.status === 'void') {
      return res.status(409).json({ error: 'invoice_void', message: 'This invoice is void. Mark its replacement paid.' });
    }
    const { paidAt, via } = req.body || {};
    if (!isYmd(paidAt)) return res.status(400).json({ error: 'paid_at_invalid', message: 'Choose the date it was paid.' });
    if (paidAt > todayOf(req)) return res.status(400).json({ error: 'paid_at_future', message: 'The payment date can’t be after today.' });
    if (!PAID_VIA.includes(via)) return res.status(400).json({ error: 'paid_via_invalid', message: 'Choose how it was paid.' });
    const now = nowIso();
    db.transaction(() => {
      // One the client never got (a draft, or one whose email hadn't gone)
      // is issued the day it was paid (C4): a tax invoice carries a date, and
      // one issued after its own payment would read wrong. A sent one keeps
      // the dates it went out with.
      const unsent = row.status === 'draft' || row.status === 'scheduled';
      db.prepare(`
        UPDATE invoices SET status = 'paid', paid_at = ?, paid_via = ?, updated_at = ?,
               issued_at = CASE WHEN ? AND (issued_at IS NULL OR issued_at > ?) THEN ? ELSE issued_at END,
               due_at = CASE WHEN ? AND due_at IS NULL THEN ? ELSE due_at END
         WHERE id = ?
      `).run(paidAt, via, now, unsent ? 1 : 0, paidAt, paidAt, unsent ? 1 : 0, paidAt, row.id);
      // Paid before its scheduled email went: the email would ask for money already in.
      cancelPending(db, 'invoice', [row.id], now);
      touch(row, now);
      logActivity(db, row.project_id, 'invoice_paid', {
        invoiceId: row.id, number: row.number, paidAt, via, amount: invoiceJson(db, row).amountDue,
      }, now);
    })();
    return reply(req, res, row.id);
  });

  app.post('/api/invoices/:id/void', (req, res) => {
    const row = invoiceFor(req, res);
    if (!row) return undefined;
    if (row.kind === 'legacy') {
      return res.status(409).json({ error: 'legacy_invoice', message: 'This invoice was made the old way, so it can’t be voided here.' });
    }
    if (row.status === 'paid') {
      return res.status(409).json({ error: 'invoice_paid', message: 'A paid invoice is never voided. Correct it with a credit note.' });
    }
    if (row.status === 'void') return res.status(409).json({ error: 'invoice_void', message: 'This invoice is already void.' });
    if (row.status === 'draft') {
      return res.status(409).json({ error: 'not_sent', message: 'This invoice hasn’t been sent, so edit it instead.' });
    }
    const why = voidReason((req.body || {}).reason);
    if (why.error) return res.status(400).json(why);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id);
    const number = project && project.upid ? replacementNumber(db, project.upid, row.kind) : null;
    if (!number) return res.status(409).json({ error: 'upid_missing', message: 'This project has no UPID to number a replacement with.' });

    const today = todayOf(req);
    const now = nowIso();
    const id = newId('inv');
    db.transaction(() => {
      db.prepare("UPDATE invoices SET status = 'void', voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?")
        .run(today, why.reason, now, row.id);
      // An email of it still waiting would send a void invoice.
      cancelPending(db, 'invoice', [row.id], now);
      // The replacement: the same estimate as accepted, the same extras and %,
      // a draft again with no dates. A final takes off the deposit standing now.
      let totals = parseJson(row.totals_json, {});
      let lessId = row.less_invoice_id || null;
      if (row.kind === 'final') {
        const deposit = liveDeposit(db, row.project_id);
        if (deposit) {
          lessId = deposit.id;
          totals = billTotals('final', parseJson(row.estimate_snapshot_json, {}), totals.extras, parseJson(deposit.totals_json, {}));
        }
      }
      db.prepare(`
        INSERT INTO invoices
          (id, project_id, estimate_id, kind, number, status, pct, estimate_snapshot_json, extras_json,
           totals_json, less_invoice_id, replaces_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, row.project_id, row.estimate_id, row.kind, number, row.pct, row.estimate_snapshot_json,
        row.extras_json, JSON.stringify(totals), lessId, row.id, now, now);
      // A deposit's replacement is the one its drafted final now takes off
      // ("names the deposit actually paid", D100). A final already sent keeps
      // the one it printed: its screen says to void and remake it too.
      if (row.kind === 'deposit') {
        db.prepare("SELECT * FROM invoices WHERE less_invoice_id = ? AND kind = 'final' AND status = 'draft'").all(row.id)
          .forEach((f) => repriceFinal(f, rowOf(id), now));
      }
      touch(row, now);
      logActivity(db, row.project_id, 'invoice_voided', {
        invoiceId: row.id, number: row.number, reason: why.reason, replacementId: id, replacement: number,
      }, now);
    })();
    return reply(req, res, id, { voided: row.id });
  });

  /* Renders `html` and sends it as a download, keeping a copy in exportDir
     as the estimate PDFs do (routes/pdf.js). */
  async function sendPdf(res, next, html, filename) {
    let buffer;
    try {
      buffer = await renderPdfBuffer(html);
    } catch (err) {
      if (err.code === 'pdf_unavailable') return res.status(503).json({ error: 'pdf_unavailable' });
      return next(err);
    }
    fs.mkdirSync(config.exportDir, { recursive: true });
    fs.writeFileSync(path.join(config.exportDir, filename), buffer);
    res.attachment(filename);
    return res.send(buffer);
  }

  /* The invoice as the PDF prints it. A draft's dates are the ones asked for
     (or issued today, no due date); once sent, the stored ones. */
  function printable(req, row) {
    const doc = invoiceJson(db, row);
    if (row.status === 'draft') {
      const { issuedAt, dueAt } = req.body || {};
      doc.issuedAt = isYmd(issuedAt) ? issuedAt : todayOf(req);
      doc.dueAt = isYmd(dueAt) && dueAt >= doc.issuedAt ? dueAt : null;
    }
    return doc;
  }

  app.post('/api/invoices/:id/pdf', async (req, res, next) => {
    const row = invoiceFor(req, res);
    if (!row) return undefined;
    if (row.kind === 'legacy') {
      // An old-way invoice prints from its estimate row, as it always did.
      return res.status(409).json({ error: 'legacy_invoice', estimateId: row.estimate_id || null });
    }
    const settings = readSettings(db);
    const doc = printable(req, row);
    const blocker = invoiceBlocker(doc, settings);
    if (blocker) return res.status(422).json(blocker);
    return sendPdf(res, next, buildInvoiceDocHtml(doc, readPricing(db), settings), invoiceFilename(doc));
  });

  // Owner-only, like the estimate's (D8, D13). Stage E must not expose it.
  app.post('/api/invoices/:id/cost-breakdown', async (req, res, next) => {
    const row = invoiceFor(req, res);
    if (!row) return undefined;
    if (row.kind === 'legacy') return res.status(409).json({ error: 'legacy_invoice' });
    const doc = invoiceJson(db, row);
    const estimate = doc.estimate || {};
    const pricing = readPricing(db);
    const blocker = costBreakdownBlocker(estimate, pricing);
    if (blocker) return res.status(409).json(blocker);
    return sendPdf(res, next, buildCostBreakdownHtml(estimate, pricing, readSettings(db), doc),
      costBreakdownFilename(estimate, doc));
  });
}

module.exports = { registerInvoiceRoutes };
