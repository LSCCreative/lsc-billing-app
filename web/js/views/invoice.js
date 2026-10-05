'use strict';

/* #/projects/<id>/invoices/<invoiceId> — one invoice (production-booking
 * task 20; IA "Invoice", D35–D37, D100).
 *
 *   Head      number, kind, client, status, dates, and the amount due as the
 *             screen's one big figure; the actions under it.
 *   Body      by kind:
 *               deposit  a fixed summary (D37): the %, the estimate total,
 *                        the days booked, the deposit due. Its % edits while
 *                        it is a draft and its final hasn't gone out.
 *               final    the accepted estimate, read-only; the Extras block
 *                        (Additional work, D14, D35), editable while a
 *                        draft; then the ledger: estimate, extras, total,
 *                        less the deposit, the balance due.
 *               single   the same, with nothing taken off.
 *               legacy   read-only, "made the old way" (D62).
 *
 * THE BROWSER PRICES NOTHING IT SAVES. The ledger previews unsaved extras
 * through calc.js (extrasTotals, finalInvoiceTotals: the same file the server
 * runs), but what is stored is what the server prices on Save, and the screen
 * redraws from its reply. Extras are added with a price snapshot from the
 * live card (LSCCalc.lineSnapshot), as an estimate line is, so a later Rate
 * Card change can't move them.
 *
 * SENDING (task 29): "Send…" opens the send panel (SendPanel, D43), which
 * emails the client a link now or later, or marks it sent for Copy link.
 * While its email waits it is `scheduled` (dates set, nothing editable), and
 * the line under its status says when it goes, with Change and Cancel email
 * (D47); cancelling makes it a draft again. "Mark paid" records a payment
 * that came in (card payments, held at D101, would mark their own).
 *
 * CORRECTING ONE (D100): a draft edits in place; a sent, unpaid one is voided
 * with a reason and a draft replacement made, which this screen then opens;
 * a paid one is never voided.
 */

const InvoiceView = (() => {
  const { esc, fmt, num } = LSCUtil;
  const C = LSCCalendar;

  // A due date this many days after the issue date by default: Settings →
  // Estimates & invoices (task 21). The owner can change it per invoice.
  const dueDays = () => LSCDocuments.docSettings(LSCData.settings()).dueDays;
  const EXTRAS_SECTION = 'additional';

  const KIND_TITLE = { deposit: 'Deposit invoice', final: 'Final invoice', single: 'Invoice', legacy: 'Invoice' };
  const STATUS_WORD = { draft: 'Not sent', scheduled: 'Scheduled', sent: 'Sent', paid: 'Paid', void: 'Void' };
  const VIA_WORD = { bank: 'bank transfer', card: 'card' };
  const UNIT_NAMES = { hour: 'Hour', half: 'Half day', full: 'Full day' };

  let root = null;
  let handlers = null;
  let data = null; // the reply on screen: { invoice, project, invoices }
  let lines = []; // the Extras as on screen (a final or single draft)
  let savedLines = '[]'; // what the server last stored, to tell unsaved edits
  let busy = false;
  let following = null; // the follow-up look while its email goes (SendPanel.follow)
  let tries = 0;

  const $ = (id) => root.querySelector('#' + id);
  const onScreen = () => Boolean(root && root.querySelector('#invoice-screen'));
  const pathOf = (projectId, invoiceId) =>
    '/projects/' + encodeURIComponent(projectId) + '/invoices/' + encodeURIComponent(invoiceId);
  const folderPath = (projectId) => '/projects/' + encodeURIComponent(projectId);
  const today = () => LSCUtil.today();
  const dirty = () => Boolean(data && data.invoice.editable && JSON.stringify(lines) !== savedLines);

  function failureText(err) {
    return err.kind === 'network' ? 'the server is unreachable.' : (err.message || 'the server refused.');
  }

  /* "4 Oct", with the year when it isn't this one. */
  const when = (ymd) => ProjectCard.dayMonth(ymd, today());

  /* ── Pricing an extra ─────────────────────────────────────────────────── */

  const section = () =>
    ((LSCData.pricing() || {}).labourSections || []).find((s) => s.id === EXTRAS_SECTION) || null;

  /* A row's price at one unit, as the snapshot an added line carries; null
     when that unit has no price yet (calc.js unitDef, as the editor's picker). */
  function snapFor(row, unit) {
    if (!row) return null;
    if (!row.prices) return null;
    const def = LSCCalc.unitDef(row, unit, LSCData.pricing(), LSCData.priceContext());
    return def && def.mu !== null ? LSCCalc.lineSnapshot(def) : null;
  }

  /* What a line bills, as computeTotals does: its custom amount, else qty ×
     its own price. */
  const billOf = (line) => (line.customBill && num(line.override) > 0 ? num(line.override) : num(line.qty) * num(line.mu));

  const unitText = (line) => {
    const u = LSCRows.labourUnit(line);
    return 'per ' + LSCRows.unitWord(u.kind, 1) +
      (u.kind === 'hour' ? '' : ' · ' + u.hoursPerUnit + ' billable ' + (u.hoursPerUnit === 1 ? 'hr' : 'hrs'));
  };

  /* The invoice's totals with the extras on screen: the stored ones when
     nothing is unsaved, else a preview worked out as the server will. */
  function totalsNow() {
    const inv = data.invoice;
    if (!dirty()) return inv.totals || {};
    const snapshot = inv.estimate || {};
    const job = snapshot.totals || {};
    const add = lines.length
      ? LSCCalc.extrasTotals({ [EXTRAS_SECTION]: lines }, LSCData.pricing(), LSCData.settings(), snapshot.gstFree === true, job)
      : null;
    return inv.kind === 'final'
      ? LSCCalc.finalInvoiceTotals(job, add, (inv.less && inv.less.totals) || {})
      : LSCCalc.singleInvoiceTotals(job, add);
  }

  const treatmentOf = (inv, totals) =>
    LSCCalc.gstTreatment(inv.kind === 'deposit' ? totals : (totals || {}).total, inv.estimate || {});

  /* ── Head ──────────────────────────────────────────────────────────────── */

  function statusMarkup(inv) {
    const s = inv.status;
    let note = '';
    if (s === 'paid') note = inv.paidAt ? when(inv.paidAt) + (inv.paidVia ? ', by ' + VIA_WORD[inv.paidVia] : '') : '';
    else if (s === 'void') note = inv.voidedAt ? 'since ' + when(inv.voidedAt) : '';
    else if (s === 'sent' && inv.dueAt) note = (inv.dueAt < today() ? 'overdue, was due ' : 'due ') + when(inv.dueAt);
    else if (s === 'scheduled' && inv.dueAt) note = 'due ' + when(inv.dueAt);
    else if (s === 'draft' && inv.kind === 'final') note = 'add any extras, then send it';
    const overdue = s === 'sent' && inv.dueAt && inv.dueAt < today();
    const word = inv.kind === 'legacy' ? (s === 'paid' ? 'Paid' : 'Made the old way') : STATUS_WORD[s] || s;
    return '<p class="inv-status"><span class="inv-pill is-' + esc(overdue ? 'overdue' : s) + '">' + esc(word) + '</span>' +
      (note ? '<span class="inv-status-note">' + esc(note) + '</span>' : '') + '</p>' +
      (inv.kind === 'legacy' ? '' : SendPanel.statusMarkup(inv.send, inv.number || 'this invoice'));
  }

  function headMarkup(inv, project, totals) {
    const client = project.client || {};
    const facts = [
      inv.issuedAt ? ['Issued', when(inv.issuedAt)] : null,
      inv.dueAt ? ['Due', when(inv.dueAt)] : null,
      inv.paidAt ? ['Paid', when(inv.paidAt)] : null,
    ].filter(Boolean);
    const due = inv.kind === 'final' || inv.kind === 'single' ? num(totals.balanceDue) : num(totals.totalIncGst);
    const label = inv.status === 'paid' ? 'Paid' : inv.status === 'void' ? 'Was due' : inv.kind === 'final' ? 'Balance due' : 'Amount due';
    const treatment = inv.kind === 'legacy' ? null : treatmentOf(inv, totals);
    return (
      '<div class="inv-overview">' +
      '<div class="est-upid">' + esc(inv.number || 'No number') + '</div>' +
      '<h1 class="est-name">' + esc(KIND_TITLE[inv.kind] || 'Invoice') + '</h1>' +
      '<div class="est-client">' + esc([project.name || 'Untitled', client.businessName].filter(Boolean).join(' · ')) + '</div>' +
      statusMarkup(inv) +
      (facts.length ? '<dl class="pf-facts">' + facts.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>' : '') +
      '</div>' +
      '<div class="inv-due' + (inv.status === 'void' ? ' is-void' : '') + '" id="inv-due">' +
      '<span class="inv-due-label">' + label + '</span>' +
      '<span class="inv-due-figure" id="inv-due-figure">' + fmt(due) + '</span>' +
      '<span class="inv-due-note">' + (treatment === 'taxable' ? 'inc. GST' : treatment === 'free' ? 'GST-free' : '&nbsp;') + '</span>' +
      '</div>'
    );
  }

  function actionsFor(inv) {
    const open = inv.status !== 'paid' && inv.status !== 'void';
    const main = [];
    const quiet = [];
    if (inv.kind === 'legacy') {
      if (open) main.push({ id: 'paid', label: 'Mark paid…', primary: true });
      if (inv.estimateId) main.push({ id: 'legacy-pdf', label: '↓ PDF' });
      return { main, quiet };
    }
    if (inv.status === 'draft') main.push({ id: 'send', label: 'Send…', primary: true });
    if (inv.status === 'sent' || inv.status === 'scheduled') main.push({ id: 'paid', label: 'Mark paid…', primary: true });
    if (inv.publicToken && ['scheduled', 'sent', 'paid'].includes(inv.status)) main.push({ id: 'copy', label: 'Copy link' });
    main.push({ id: 'pdf', label: '↓ PDF' });
    if (inv.status !== 'void') main.push({ id: 'breakdown', label: '↓ Cost Breakdown' });
    if (inv.status === 'draft') quiet.push({ id: 'paid', label: 'Mark paid…' });
    if (inv.status === 'sent' || inv.status === 'scheduled') quiet.push({ id: 'void', label: 'Void and remake…', danger: true });
    return { main, quiet };
  }

  function actionsMarkup(inv) {
    const { main, quiet } = actionsFor(inv);
    const btn = (a, cls) =>
      '<button type="button" class="btn ' + cls + '" data-act="' + a.id + '"' + (a.id === 'pdf' || a.id === 'breakdown' || a.id === 'legacy-pdf' || a.id === 'copy' ? '' : ' data-write') + '>' +
      '<span class="spinner"></span>' + esc(a.label) + '</button>';
    return (
      '<div class="pf-actions">' +
      '<div class="pf-actions-main">' + main.map((a) => btn(a, a.primary ? 'btn-accent' : 'btn-ghost')).join('') + '</div>' +
      (quiet.length ? '<div class="pf-actions-quiet">' + quiet.map((a) => btn(a, (a.danger ? 'btn-danger' : 'btn-ghost') + ' btn-sm')).join('') + '</div>' : '') +
      '</div>'
    );
  }

  /* What the owner needs to know before anything else: it's void, it replaced
     one, or (a final) it takes off a deposit that has since been voided. */
  function noticesMarkup(inv) {
    let html = '';
    if (inv.status === 'void') {
      html += '<div class="inv-notice is-void" role="note"><p><strong>Void' +
        (inv.voidedAt ? ' since ' + esc(when(inv.voidedAt)) : '') + '.</strong> ' +
        (inv.voidReason ? esc(inv.voidReason) + '. ' : '') + 'Nothing is owed on it; it stays here for the record.</p>' +
        (inv.replacedBy ? '<button type="button" class="btn btn-sm" data-go="' + esc(inv.replacedBy.id) + '">Open ' + esc(inv.replacedBy.number || 'the replacement') + ' →</button>' : '') +
        '</div>';
    }
    if (inv.replaces) {
      html += '<p class="pf-notice">Replaces <button type="button" class="inv-link" data-go="' + esc(inv.replaces.id) + '">' +
        esc(inv.replaces.number || 'a voided invoice') + '</button>, which was voided.</p>';
    }
    if (inv.kind === 'final' && inv.less && inv.less.status === 'void' && inv.status !== 'void') {
      html += '<div class="inv-notice" role="note"><p><strong>The deposit this takes off, ' + esc(inv.less.number || '') +
        ', was voided.</strong> ' + (inv.status === 'draft'
        ? 'Reopen the folder to see the deposit that stands now.'
        : 'Void this final and make a replacement: the replacement takes off the deposit that stands now.') + '</p></div>';
    }
    if (inv.kind === 'legacy') {
      html += '<p class="pf-notice">Made the old way, before projects: its PDF prints from the estimate it was made as, and nothing ' +
        'about it can change here. Mark it paid when the money is in.</p>';
    }
    return html;
  }

  /* ── The ledger ────────────────────────────────────────────────────────── */

  function ledgerRow(label, value, cls) {
    return '<div class="inv-row' + (cls ? ' ' + cls : '') + '"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  }

  function lessLabel(less) {
    const paid = less && less.status === 'paid';
    return (paid ? 'Less deposit paid' : 'Less deposit invoiced') +
      (less && less.number ? ' <span class="inv-num">' + esc(less.number) + '</span>' : '');
  }

  /* The sum, top to bottom (D35): the estimate, the extras, the whole job,
     the deposit off it, then the balance with its GST — on the final's tax
     invoice the GST for this supply is the balance's, because the deposit's
     was on its own. */
  function ledgerMarkup(inv, totals) {
    const t = totals || {};
    const treatment = treatmentOf(inv, t);
    const taxable = treatment === 'taxable';
    const inc = taxable ? ' <span class="inv-q">inc. GST</span>' : '';
    // A void invoice owes nothing: its last line is what it asked for, muted.
    const owed = (word) => (inv.status === 'void' ? 'Was due' : word);
    const dueCls = inv.status === 'void' ? 'is-due is-void' : 'is-due';
    if (inv.kind === 'deposit') {
      return '<dl class="inv-ledger" id="inv-ledger">' +
        ledgerRow('Estimate total' + inc, fmt(((inv.estimate || {}).totals || {}).totalIncGst)) +
        (taxable ? ledgerRow('Deposit (ex GST)', fmt(t.clientPriceExGst), 'is-sub') + ledgerRow('GST', fmt(t.gst), 'is-sub') : '') +
        ledgerRow(owed('Deposit due'), fmt(t.totalIncGst), dueCls) + '</dl>';
    }
    const final = inv.kind === 'final';
    const due = (final ? t.balance : t.total) || {};
    const extras = num((t.extras || {}).totalIncGst);
    return '<dl class="inv-ledger" id="inv-ledger">' +
      ledgerRow('Estimate total' + inc, fmt((t.job || {}).totalIncGst)) +
      ledgerRow('Extras' + inc, extras ? fmt(extras) : '<span class="pf-muted">None</span>') +
      (extras ? ledgerRow('Total' + inc, fmt((t.total || {}).totalIncGst), 'is-strong') : '') +
      (final ? ledgerRow(lessLabel(inv.less), '&minus;' + fmt((t.deposit || {}).totalIncGst), 'is-less') : '') +
      (taxable ? ledgerRow((final ? 'Balance' : 'Total') + ' (ex GST)', fmt(due.clientPriceExGst), 'is-sub') + ledgerRow('GST', fmt(due.gst), 'is-sub') : '') +
      ledgerRow(owed(final ? 'Balance due' : 'Total due'), fmt(due.totalIncGst), dueCls) +
      '</dl>';
  }

  /* ── Deposit ───────────────────────────────────────────────────────────── */

  function daysMarkup(estimate) {
    const days = (estimate.days || []).filter((d) => d && d.id);
    if (!days.length) return '<p class="pf-empty">No production days booked.</p>';
    return '<ol class="inv-days">' + days.map((d, i) => {
      const date = C.isDate(d.date) ? C.longDate(d.date, today()) : 'Day ' + (i + 1) + ' — date TBC';
      const times = d.startTime || d.endTime ? C.timeText(d) : '';
      return '<li>' + C.statusChip(d.status) + '<span class="inv-day-date">' + esc(date) + '</span>' +
        (times ? '<span class="inv-day-time">' + esc(times) + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  /* What a deposit % comes to, worked out as the server will (calc.js
     depositAmount on the estimate as accepted). */
  function pctHint(inv, pct) {
    const value = Number(pct);
    if (!(value > 0 && value <= 100)) return 'The deposit must be more than 0% and at most 100%.';
    const deposit = LSCCalc.depositAmount(((inv.estimate || {}).totals) || {}, value);
    return esc(String(value)) + '% is ' + fmt(deposit.totalIncGst) + '. The final invoice takes off whatever this comes to; ' +
      'it’s fixed once either is sent.';
  }

  function depositMarkup(inv, totals) {
    const estimate = inv.estimate || {};
    const pctField = inv.depositEditable
      ? '<div class="inv-pct">' +
        '<div class="field"><label for="inv-pct">Deposit %</label>' +
        '<input id="inv-pct" type="number" inputmode="decimal" min="1" max="100" step="any" value="' + esc(String(inv.pct)) + '"' +
        ' aria-describedby="inv-pct-hint"></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="inv-pct-save" data-write><span class="spinner"></span>Save %</button>' +
        '<p class="pfd-hint" id="inv-pct-hint" aria-live="polite">' + pctHint(inv, inv.pct) + '</p>' +
        '</div>'
      : '';
    return (
      '<section class="inv-section" aria-labelledby="inv-dep-h">' +
      '<div class="pf-section-head"><h2 class="pf-h2" id="inv-dep-h">Deposit — ' + esc(String(inv.pct)) + '% to secure your booking</h2></div>' +
      '<p class="pf-hint">For estimate ' + esc(estimate.upid || '—') + (estimate.name ? ' · ' + esc(estimate.name) : '') +
      '. A summary, not an itemised bill: the accepted estimate is the itemised document.</p>' +
      pctField +
      '<h3 class="inv-h3">Production days booked</h3>' + daysMarkup(estimate) +
      ledgerMarkup(inv, totals) +
      '</section>'
    );
  }

  /* ── Final and single: the estimate, then the Extras ──────────────────── */

  function estimateMarkup(inv) {
    const estimate = inv.estimate || {};
    return (
      '<details class="inv-estimate">' +
      '<summary><span class="inv-est-title">The accepted estimate</span>' +
      '<span class="inv-est-sum">' + esc(estimate.upid || '') + ' · ' + fmt((estimate.totals || {}).totalIncGst) + '</span>' +
      '<span class="inv-est-toggle" aria-hidden="true"></span></summary>' +
      '<div class="inv-est-body">' +
      '<p class="pf-hint">As the client accepted it. Editing the estimate now changes no invoice.</p>' +
      EstimateDetail.itemsMarkup(estimate, LSCData.pricing()) +
      '</div></details>'
    );
  }

  function pickerMarkup() {
    const sec = section();
    if (!sec || !sec.rows.length) {
      return '<p class="inv-empty-card">Your Rate Card has no Additional work services yet. Add Overtime under ' +
        '<button type="button" class="inv-link" id="inv-go-pricing">Rate Card → Additional work</button>, then come back.</p>';
    }
    return (
      '<div class="bb-picker">' +
      '<select class="svc-select" id="inv-svc" aria-label="Additional work to add">' +
      sec.rows.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + '</option>').join('') + '</select>' +
      '<select class="svc-select unit-select" id="inv-unit" aria-label="Unit to add"></select>' +
      '<button type="button" class="btn btn-accent btn-sm" id="inv-add">+ Add</button></div>'
    );
  }

  function lineMarkup(line, i, editable) {
    const name = esc(line.name);
    const u = LSCRows.labourUnit(line);
    const qtyLabel = LSCRows.qtyLabel(u.kind);
    const qty = editable
      ? '<input class="num-inp qty-inp" type="number" min="0" step="0.5" value="' + esc(String(line.qty || '')) + '" data-i="' + i +
        '" aria-label="' + qtyLabel + ' of ' + name + '">'
      : esc(String(line.qty));
    const custom = line.customBill
      ? (editable
        ? '<input class="num-inp custom-bill-inp" type="number" min="0" step="0.01" value="' + esc(String(line.override || '')) + '" data-o="' + i +
          '" title="Custom amount ($)" aria-label="Custom amount for ' + name + '">'
        : '')
      : '';
    return (
      '<div class="gt-row labour-grid" data-line="' + i + '">' +
      '<div data-label="Service" class="lab-svc">' + name + '<div class="lab-unit">' + esc(unitText(line)) + '</div></div>' +
      '<div class="right" data-label="' + qtyLabel + '">' + qty + '</div>' +
      '<div class="right muted-td" data-label="Price">' + fmt(line.mu) + '</div>' +
      '<div class="right" data-label="Bill"><span class="bill-cell" data-bill="' + i + '">' + fmt(billOf(line)) + '</span>' + custom + '</div>' +
      '<div class="del-cell">' + (editable
        ? '<button type="button" class="del-btn" data-del="' + i + '" title="Remove ' + name + '" aria-label="Remove ' + name + '">×</button>'
        : '') + '</div>' +
      '</div>'
    );
  }

  function extrasRowsMarkup(editable) {
    if (!lines.length) {
      return '<div class="empty-row">' + (editable
        ? 'No extras. Add Overtime or an extra revision round from Additional work above.'
        : 'No extras on this invoice.') + '</div>';
    }
    return lines.map((l, i) => lineMarkup(l, i, editable)).join('');
  }

  function extrasMarkup(inv) {
    const editable = inv.editable;
    const subtotal = lines.reduce((sum, l) => sum + billOf(l), 0);
    return (
      '<section class="inv-section" aria-labelledby="inv-extras-h">' +
      '<div class="billing-block inv-extras">' +
      '<div class="bb-head"><div><h2 class="bb-label" id="inv-extras-h">Extras</h2><span class="bb-label-tag">Additional work</span></div>' +
      '<span class="bb-sum">Subtotal <b id="inv-extras-sum">' + fmt(subtotal) + '</b></span></div>' +
      (editable ? pickerMarkup() : '') +
      '<div class="gt-head labour-grid"><div>Service</div><div class="right">Qty</div>' +
      '<div class="right">Price</div><div class="right">Bill</div><div></div></div>' +
      '<div class="gt-body" id="inv-extras-body">' + extrasRowsMarkup(editable) + '</div>' +
      '</div>' +
      (editable
        ? '<div class="inv-save"><span class="inv-save-state" id="inv-save-state" aria-live="polite"></span>' +
          '<button type="button" class="btn btn-accent" id="inv-save" data-write disabled><span class="spinner"></span>Save extras</button></div>'
        : '') +
      '<p class="pf-hint inv-extras-hint">' + (editable
        ? 'Billed at the standard rate: no day or time rate applies to extras. Editable until the invoice is sent.'
        : inv.status === 'void' ? 'This invoice is void.' : 'Sent invoices don’t change. To correct one, void it and make a replacement.') + '</p>' +
      '</section>'
    );
  }

  function billMarkup(inv, totals) {
    return estimateMarkup(inv) + extrasMarkup(inv) +
      '<section class="inv-section inv-sum-section" aria-labelledby="inv-sum-h">' +
      '<div class="pf-section-head"><h2 class="pf-h2" id="inv-sum-h">' + (inv.kind === 'final' ? 'Balance' : 'Total') + '</h2>' +
      '<span class="inv-preview" id="inv-preview" hidden>Preview — not saved</span></div>' +
      ledgerMarkup(inv, totals) +
      '</section>';
  }

  function legacyMarkup(inv) {
    return '<section class="inv-section" aria-label="Amount"><dl class="inv-ledger">' +
      ledgerRow('Total', fmt(inv.amountDue), 'is-due') + '</dl></section>';
  }

  // ── The screen ──────────────────────────────────────────────────────────

  function draw() {
    const inv = data.invoice;
    const project = data.project;
    const totals = totalsNow();
    root.innerHTML =
      '<div id="invoice-screen" class="inv-screen">' +
      '<button class="back-btn" id="js-back">← ' + esc([project.upid, project.name].filter(Boolean).join(' · ') || 'Project') + '</button>' +
      '<section class="inv-head" aria-label="Invoice ' + esc(inv.number || '') + '">' + headMarkup(inv, project, totals) + '</section>' +
      actionsMarkup(inv) +
      '<div class="pf-action-error" id="inv-error" role="alert"></div>' +
      noticesMarkup(inv) +
      '<div class="inv-body">' +
      (inv.kind === 'deposit' ? depositMarkup(inv, totals) : inv.kind === 'legacy' ? legacyMarkup(inv) : billMarkup(inv, totals)) +
      '</div></div>';
    document.title = (inv.number || 'Invoice') + ' · ' + (project.name || 'Project') + ' — LSC Billing';
    bind();
    paintSave();
    clearTimeout(following);
    following = SendPanel.follow([data.invoice.send], (n) => { tries = n; refresh(); }, tries);
    tries = 0;
  }

  function bind() {
    $('js-back').addEventListener('click', () => LSCRouter.leaveTo(folderPath(data.project.id)));
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act, b)));
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () =>
      LSCRouter.go(pathOf(data.project.id, b.dataset.go))));
    const pricingLink = $('inv-go-pricing');
    if (pricingLink) pricingLink.addEventListener('click', () => LSCRouter.go('/finance/pricing'));
    const pct = $('inv-pct-save');
    if (pct) {
      pct.addEventListener('click', () => saveDepositPct(pct));
      $('inv-pct').addEventListener('input', (e) => { $('inv-pct-hint').innerHTML = pctHint(data.invoice, e.target.value); });
    }
    if (data.invoice.editable && data.invoice.kind !== 'deposit') bindExtras();
    SendPanel.bindStatus(root, {
      edit: (sendId, b) => openEditSend(b),
      changed: () => refresh(),
      cancelled: data.invoice.status === 'scheduled' ? 'It’s a draft again.' : '',
      authLost: () => handlers.onAuthLost({ keepScreen: true }),
      error: (message) => showError(message),
    });
  }

  /* ── Editing the extras ───────────────────────────────────────────────── */

  function paintPicker() {
    const svc = $('inv-svc');
    const unitSel = $('inv-unit');
    const add = $('inv-add');
    const sec = section();
    if (!svc || !sec) return;
    const row = sec.rows.find((r) => r.name === svc.value) || null;
    const needs = LSCData.autoPriceBlocker().screen;
    unitSel.innerHTML = LSCCalc.SERVICE_UNITS.map((u) => {
      const snap = snapFor(row, u);
      return '<option value="' + u + '"' + (snap ? '' : ' disabled') + '>' + UNIT_NAMES[u] + ' · ' +
        (snap ? LSCUtil.money(snap.mu) : 'no price yet, needs ' + needs) + '</option>';
    }).join('');
    const open = Array.from(unitSel.options).filter((o) => !o.disabled);
    const pick = open.find((o) => o.value === 'hour') || open[0];
    unitSel.value = pick ? pick.value : 'hour';
    unitSel.disabled = !open.length;
    add.disabled = !pick;
  }

  function bindExtras() {
    const svc = $('inv-svc');
    if (svc) {
      svc.addEventListener('change', paintPicker);
      paintPicker();
      $('inv-add').addEventListener('click', addLine);
    }
    const body = $('inv-extras-body');
    body.addEventListener('input', (e) => {
      const i = e.target.dataset.i !== undefined ? Number(e.target.dataset.i) : Number(e.target.dataset.o);
      if (!lines[i]) return;
      if (e.target.dataset.i !== undefined) lines[i].qty = num(e.target.value);
      else lines[i].override = num(e.target.value);
      const cell = root.querySelector('[data-bill="' + i + '"]');
      if (cell) cell.textContent = fmt(billOf(lines[i]));
      paintTotals();
    });
    body.addEventListener('focusin', (e) => {
      // As the editor: a field showing 0 clears on focus, so typing doesn't make "05".
      if (e.target.matches('.num-inp') && parseFloat(e.target.value) === 0) e.target.value = '';
    });
    body.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (!del) return;
      const i = Number(del.dataset.del);
      const name = lines[i] ? lines[i].name : '';
      lines.splice(i, 1);
      redrawLines();
      const next = root.querySelectorAll('[data-del]')[Math.min(i, lines.length - 1)];
      (next || $('inv-svc') || $('inv-save')).focus();
      LSCUtil.announce($('inv-save-state'), name + ' removed.');
    });
    $('inv-save').addEventListener('click', saveExtras);
  }

  function addLine() {
    const sec = section();
    const row = sec && sec.rows.find((r) => r.name === $('inv-svc').value);
    const snap = snapFor(row, $('inv-unit').value);
    if (!row || !snap) return;
    const line = Object.assign({ name: row.name, qty: 1 }, snap);
    lines.push(line);
    redrawLines();
    const inputs = root.querySelectorAll('.qty-inp');
    const input = inputs[inputs.length - 1];
    if (input) {
      input.focus();
      input.select();
    }
    LSCUtil.announce($('inv-save-state'), row.name + ' added, 1 ' + LSCRows.unitWord(LSCRows.labourUnit(line).kind, 1) +
      ', ' + fmt(billOf(line)) + '. Not saved yet.');
  }

  function redrawLines() {
    $('inv-extras-body').innerHTML = extrasRowsMarkup(true);
    paintTotals();
  }

  /* Everything an extras edit moves: the subtotal, the ledger, the big
     figure, and whether there is anything to save. */
  function paintTotals() {
    const inv = data.invoice;
    const totals = totalsNow();
    $('inv-extras-sum').textContent = fmt(lines.reduce((sum, l) => sum + billOf(l), 0));
    const ledger = $('inv-ledger');
    if (ledger) ledger.outerHTML = ledgerMarkup(inv, totals);
    $('inv-due-figure').textContent = fmt(inv.kind === 'final' || inv.kind === 'single' ? totals.balanceDue : totals.totalIncGst);
    const preview = $('inv-preview');
    if (preview) preview.hidden = !dirty();
    paintSave();
  }

  function paintSave() {
    const save = $('inv-save');
    if (!save) return;
    const changed = dirty();
    save.disabled = busy || !changed;
    // Quiet until there is something to save, then the screen's call to action.
    save.classList.toggle('btn-accent', changed);
    save.classList.toggle('btn-ghost', !changed);
    const state = $('inv-save-state');
    if (state && !busy) state.textContent = changed ? 'Unsaved changes' : '';
  }

  async function saveExtras() {
    if (busy || !dirty()) return;
    clearError();
    const button = $('inv-save');
    const inv = data.invoice;
    setBusy(button, true);
    Toast.working('Saving extras…');
    try {
      const reply = await LSCApi.put('/api/invoices/' + encodeURIComponent(inv.id) + '?today=' + today(), { extras: lines });
      setBusy(button, false);
      if (!onScreen() || data.invoice.id !== inv.id) return;
      accept(reply);
      draw();
      Toast.ok('Extras saved. ' + (reply.invoice.kind === 'final' ? 'Balance due ' : 'Total due ') + fmt(reply.invoice.amountDue) + '.');
      const again = $('inv-save') || $('inv-svc');
      if (again) again.focus();
    } catch (err) {
      setBusy(button, false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (handled(err)) return;
      showError('Couldn’t save the extras: ' + failureText(err) + ' Nothing was lost: they are still on screen.');
    }
  }

  async function saveDepositPct(button) {
    const field = $('inv-pct');
    const value = Number(field.value);
    if (field.value === '' || !(value > 0 && value <= 100)) {
      showError('The deposit must be more than 0% and at most 100%.');
      field.focus();
      return;
    }
    await write('', { depositPct: value }, button, 'Saving the deposit…', (reply) =>
      'Deposit now ' + value + '%: ' + fmt(reply.invoice.amountDue) + '.', 'PUT');
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  function setBusy(button, on) {
    busy = on;
    if (!onScreen()) return;
    root.querySelectorAll('[data-write]').forEach((b) => {
      b.disabled = on || (b.id === 'inv-save' && !dirty());
    });
    if (button && button.isConnected) {
      const spin = button.querySelector('.spinner');
      if (spin) spin.style.display = on ? 'inline-block' : 'none';
    }
  }

  function showError(message) {
    const box = $('inv-error');
    if (!box) return;
    box.textContent = message;
    box.classList.add('show');
  }

  function clearError() {
    const box = $('inv-error');
    if (!box) return;
    box.textContent = '';
    box.classList.remove('show');
  }

  /* A 401 or 404 dealt with here; true if it was one. */
  function handled(err) {
    if (err.kind === 'auth') {
      handlers.onAuthLost({ keepScreen: true });
      return true;
    }
    if (err.status === 404) {
      showMissing();
      return true;
    }
    return false;
  }

  function accept(reply) {
    data = reply;
    lines = JSON.parse(JSON.stringify(reply.invoice.extras || []));
    savedLines = JSON.stringify(lines);
  }

  /* One of the invoice's writes, then the screen it answers with. A
     rejection goes back to the dialog that asked, which shows it. */
  async function write(action, body, button, working, ok, method) {
    if (busy) return null;
    const inv = data.invoice;
    clearError();
    setBusy(button, true);
    Toast.working(working);
    try {
      const url = '/api/invoices/' + encodeURIComponent(inv.id) + (action ? '/' + action : '') + '?today=' + today();
      const reply = method === 'PUT' ? await LSCApi.put(url, body) : await LSCApi.post(url, body);
      setBusy(button, false);
      Toast.ok(typeof ok === 'function' ? ok(reply) : ok);
      if (!onScreen() || data.invoice.id !== inv.id) return reply;
      if (reply.invoice.id !== inv.id) {
        // Void and remake: the replacement is the one to work on now.
        LSCRouter.go(pathOf(reply.invoice.projectId, reply.invoice.id), { replace: true, skipGuard: true, state: { reply } });
        return reply;
      }
      accept(reply);
      draw();
      const again = root.querySelector('[data-act]');
      if (again) again.focus();
      return reply;
    } catch (err) {
      setBusy(button, false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (handled(err)) return null;
      return Promise.reject(err);
    }
  }

  function runAction(id, button) {
    if (busy) return undefined;
    if (id === 'pdf' || id === 'breakdown' || id === 'legacy-pdf') return download(id, button);
    if (id === 'copy') return SendPanel.copyLink('invoice', data.invoice.publicToken, button);
    if (dirty() && (id === 'send' || id === 'paid' || id === 'void')) {
      showError('Save or undo the extras first: the invoice goes out as it is saved.');
      const save = $('inv-save');
      if (save) save.focus();
      return undefined;
    }
    if (id === 'send') return openSendHere(button);
    if (id === 'paid') return openMarkPaid(button);
    if (id === 'void') return openVoid(button);
    return undefined;
  }

  // ── Sending (task 29) ───────────────────────────────────────────────────

  const KIND_WORD = { deposit: 'deposit invoice', final: 'final invoice', single: 'invoice' };

  /**
   * The send panel for an invoice: this screen's Send…, and a folder row's.
   * `o`: { to, name } the client's email and name, done(reply, how) redraws.
   */
  function openSend(opener, inv, o) {
    const word = KIND_WORD[inv.kind] || 'invoice';
    const messages = LSCDocuments.docSettings(LSCData.settings()).messages;
    SendPanel.open(opener, {
      docKind: 'invoice',
      title: 'Send ' + (inv.number || 'the ' + word),
      intro: 'Emails ' + o.name + ' a link to the ' + word + ', with the amount due and how to pay. ' +
        'Once it has gone it can’t be edited: to correct it, void it and make a replacement.',
      to: o.to,
      message: messages[inv.kind] || messages.single,
      date: {
        key: 'dueAt',
        label: 'Due',
        days: dueDays(),
        hint: (day, value) => (C.isDate(value) ? 'Issued ' + C.shortDate(day) + ', due ' + C.shortDate(value) + '.' : ''),
      },
      linkHint: 'Marks it sent now without an email, to send your own way.',
      send: (body) => LSCApi.post('/api/invoices/' + encodeURIComponent(inv.id) + '/send?today=' + today(), body),
      tokenOf: (reply) => reply.invoice.publicToken,
      done: (reply, how) => {
        o.done(reply, how);
        const send = reply.invoice.send;
        if (how === 'link') return (inv.number || 'The invoice') + ' is marked sent.';
        return send && send.status === 'scheduled' && Date.parse(send.scheduledFor) > Date.now() + 60000
          ? 'Scheduled. The email goes ' + SendPanel.whenText(send.scheduledFor) + '.'
          : 'Sending the email now.';
      },
    });
  }

  const clientOf = () => {
    const c = (data.invoice.estimate && data.invoice.estimate.client) || (data.project && data.project.client) || {};
    return { to: String(c.email || '').trim(), name: c.contactName || c.businessName || 'the client' };
  };

  function openSendHere(opener) {
    const id = data.invoice.id;
    openSend(opener, data.invoice, Object.assign(clientOf(), {
      done: (reply) => {
        if (!onScreen() || data.invoice.id !== id) return;
        accept(reply);
        draw();
        const again = root.querySelector('[data-act]');
        if (again) again.focus();
      },
    }));
  }

  /* The status line's Change: the scheduled email's time, recipient, due date
     and message. */
  function openEditSend(opener) {
    const inv = data.invoice;
    if (!inv.send) return;
    SendPanel.open(opener, {
      docKind: 'invoice',
      edit: inv.send,
      date: {
        key: 'dueAt', label: 'Due', days: 0, value: inv.dueAt,
        hint: (day, value) => (C.isDate(value) ? 'Issued ' + C.shortDate(day) + ', due ' + C.shortDate(value) + '.' : ''),
      },
      save: (patch) => LSCApi.put('/api/sends/' + encodeURIComponent(inv.send.id), patch),
      done: () => refresh(),
    });
  }

  /* The invoice again, without the Loading screen (after the queue moved). */
  async function refresh() {
    if (!data) return;
    const id = data.invoice.id;
    try {
      const reply = await LSCApi.get('/api/invoices/' + encodeURIComponent(id) + '?today=' + today());
      if (!onScreen() || data.invoice.id !== id) return;
      if (dirty()) {
        // Unsaved extras stay as typed; only the head and status move.
        const keep = lines;
        accept(reply);
        lines = keep;
      } else {
        accept(reply);
      }
      draw();
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!handled(err)) showError('Couldn’t refresh the invoice: ' + failureText(err));
    }
  }

  function openMarkPaid(opener) {
    const inv = data.invoice;
    const amount = fmt(inv.amountDue);
    ProjectFolder.dialog(opener, {
      title: 'Mark ' + (inv.number || 'invoice') + ' paid',
      body:
        '<p class="pfd-text" id="pfd-desc">Record ' + amount + ' received' + (inv.status === 'draft'
          ? '. It was never marked sent; that’s fine if the client paid from a PDF you emailed.'
          : '.') + '</p>' +
        '<div class="field"><label for="pfd-paid">Paid on</label><input id="pfd-paid" type="date" value="' + today() + '" max="' + today() + '"></div>' +
        '<fieldset class="pfd-choice"><legend>Paid by</legend>' +
        '<label><input type="radio" name="pfd-via" value="bank" checked><span>Bank transfer</span></label>' +
        '<label><input type="radio" name="pfd-via" value="card"><span>Card</span></label></fieldset>',
      describe: true,
      confirm: 'Mark paid',
      focus: 'pfd-paid',
      run: async (b) => {
        const paidAt = dlgValue('pfd-paid');
        if (!C.isDate(paidAt)) throw fieldError('pfd-paid', 'Choose the date it was paid.');
        if (paidAt > today()) throw fieldError('pfd-paid', 'The payment date can’t be after today.');
        const via = document.querySelector('input[name="pfd-via"]:checked').value;
        return write('paid', { paidAt, via }, b, 'Saving…', (reply) =>
          reply.already ? 'It was already marked paid.' : 'Marked paid, ' + amount + ' on ' + when(paidAt) + '.');
      },
    });
  }

  /* The number the replacement will most likely take (the server picks the
     next free one, D100): one past the highest suffix of this kind. */
  function nextNumberGuess(inv) {
    const upid = data.project.upid || '';
    const base = inv.kind === 'deposit' ? 'INV-' + upid + '-D' : inv.kind === 'final' ? 'INV-' + upid + '-F' : 'INV-' + upid + '-';
    let n = 1;
    data.invoices.forEach((i) => {
      const num2 = String(i.number || '');
      if (num2.toLowerCase().indexOf(base.toLowerCase()) !== 0) return;
      const tail = num2.slice(base.length);
      if (/^\d+$/.test(tail)) n = Math.max(n, Number(tail));
    });
    return base + (n + 1);
  }

  function openVoid(opener) {
    const inv = data.invoice;
    ProjectFolder.dialog(opener, {
      title: 'Void ' + (inv.number || 'this invoice') + '?',
      body:
        '<p class="pfd-text" id="pfd-desc">The client has seen this number, so it is never reused. ' + esc(inv.number || 'It') +
        ' stays in the folder marked void, dated today, with your reason, and a draft replacement (' +
        esc(nextNumberGuess(inv)) + ') is made for you to correct and send.' +
        (inv.kind === 'deposit' ? ' A final invoice not yet sent takes off the replacement instead.' : '') + '</p>' +
        '<div class="field"><label for="pfd-reason">Why it’s being voided</label>' +
        '<textarea id="pfd-reason" rows="3" maxlength="500" aria-describedby="pfd-reason-hint"></textarea>' +
        '<p class="pfd-hint" id="pfd-reason-hint">Your client sees this: it’s on the old invoice’s page, which points them to the replacement, and printed on the void copy. Write it for them.</p></div>',
      describe: true,
      confirm: 'Void and make replacement',
      danger: true,
      focus: 'pfd-reason',
      run: async (b) => {
        const reason = dlgValue('pfd-reason').trim();
        if (!reason) throw fieldError('pfd-reason', 'Say why it’s being voided.');
        return write('void', { reason }, b, 'Voiding…', (reply) =>
          (inv.number || 'The invoice') + ' voided. ' + (reply.invoice.number || 'Its replacement') + ' is a draft, ready to correct.');
      },
    });
  }

  const dlgValue = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };

  function fieldError(id, message) {
    const el = document.getElementById(id);
    if (el) el.focus();
    return new Error(message);
  }

  // ── Downloads ───────────────────────────────────────────────────────────

  /* `kind`: pdf, breakdown, or legacy-pdf (an old-way invoice prints from
     its estimate row, as the folder prints it). `dates` (a draft): the
     dates to print. `report`: where a failure is said; the action error
     box by default. */
  async function download(kind, button, dates, report) {
    if (button.disabled) return;
    const say = report || showError;
    const inv = data.invoice;
    const spin = button.querySelector('.spinner');
    button.disabled = true;
    if (spin) spin.style.display = 'inline-block';
    clearError();
    const breakdown = kind === 'breakdown';
    const what = breakdown ? 'the Cost Breakdown' : 'the PDF';
    if (!breakdown && dirty()) {
      button.disabled = false;
      if (spin) spin.style.display = 'none';
      say('Save the extras first: the PDF prints the invoice as saved.');
      return;
    }
    Toast.working(breakdown ? 'Generating the Cost Breakdown…' : 'Generating PDF…');
    try {
      let reply;
      if (kind === 'legacy-pdf') {
        reply = await LSCApi.postPdf('/api/estimates/' + encodeURIComponent(inv.estimateId) + '/pdf');
      } else {
        const url = '/api/invoices/' + encodeURIComponent(inv.id) + '/' + (breakdown ? 'cost-breakdown' : 'pdf') + '?today=' + today();
        reply = await LSCApi.postPdf(url, breakdown ? undefined : dates || {});
      }
      LSCUtil.saveFile(reply.blob, reply.filename || (breakdown ? 'Cost Breakdown_' : '') + (inv.number || 'invoice') + '.pdf');
      Toast.ok(breakdown ? 'Cost Breakdown downloaded.' : 'PDF downloaded.');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      Toast.hide();
      if (err.kind === 'auth') {
        handlers.onAuthLost({ keepScreen: true });
      } else if (err.code === 'abn_required' || err.code === 'breakdown_stale') {
        say(err.message);
      } else if (err.code === 'pdf_unavailable') {
        say('Couldn’t make ' + what + ' — the server has no PDF renderer. Check Chromium is installed in the container.');
      } else if (err.status === 404) {
        say('Couldn’t make ' + what + ' — that invoice no longer exists on the server.');
      } else {
        say('Couldn’t make ' + what + ': ' + failureText(err));
      }
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        if (spin) spin.style.display = 'none';
      }
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  function placeholder(projectId, body) {
    data = null;
    root.innerHTML =
      '<button class="back-btn" id="js-back">← Project</button>' +
      '<div class="empty-state">' + body + '</div>';
    root.querySelector('#js-back').addEventListener('click', () => LSCRouter.leaveTo(folderPath(projectId)));
  }

  function showMissing() {
    ProjectFolder.closeDialog(false);
    const projectId = data ? data.project.id : null;
    placeholder(projectId, '<h3>That invoice no longer exists</h3><p>Its project’s folder lists the ones it has.</p>');
  }

  function shown(reply, projectId, then) {
    if (reply.invoice.projectId !== projectId) {
      // An address with the wrong project: the invoice's own, in place.
      LSCRouter.go(pathOf(reply.invoice.projectId, reply.invoice.id), { replace: true, skipGuard: true, state: { reply } });
      return;
    }
    accept(reply);
    busy = false;
    draw();
    LSCUtil.landFocus(root);
    LSCUnsaved.watch('invoice-extras', {
      label: 'the extras on ' + (reply.invoice.number || 'this invoice'),
      onScreen: () => onScreen() && data && data.invoice.id === reply.invoice.id,
      dirty,
    });
    if (then === 'paid') {
      const button = root.querySelector('[data-act="paid"]');
      if (button) openMarkPaid(button);
    }
  }

  async function load(projectId, invoiceId, state) {
    const ticket = LSCRouter.ticket();
    window.scrollTo(0, 0);
    const then = state && state.action;
    // A reply already in hand (void and remake, a corrected address): no second fetch.
    if (state && state.reply && state.reply.invoice && state.reply.invoice.id === invoiceId) {
      shown(state.reply, projectId, then);
      return;
    }
    placeholder(projectId, '<h3>Loading…</h3>');
    try {
      const reply = await LSCApi.get('/api/invoices/' + encodeURIComponent(invoiceId) + '?today=' + today());
      if (!LSCRouter.isCurrent(ticket)) return;
      shown(reply, projectId, then);
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket)) return;
      if (err.kind === 'auth') {
        handlers.onAuthLost();
        return;
      }
      if (err.status === 404) {
        placeholder(projectId, '<h3>That invoice no longer exists</h3><p>Its project’s folder lists the ones it has.</p>');
        return;
      }
      placeholder(projectId, '<h3>Couldn’t open that invoice</h3><p>' + esc(failureText(err)) + '</p>' +
        '<button type="button" class="btn" id="js-retry" style="margin-top:16px">Try Again</button>');
      root.querySelector('#js-retry').addEventListener('click', () => load(projectId, invoiceId));
    }
  }

  return {
    /* Once per sign-in. handlers: { onAuthLost }. */
    init(container, options) {
      root = container;
      handlers = options;
    },

    /* The router's way in: the project id, then [invoiceId]. `state.action`
       'paid' opens Mark paid once drawn (the folder's "Mark deposit paid…"). */
    show(projectId, rest, state) {
      const [invoiceId, extra] = rest;
      if (invoiceId === undefined || extra !== undefined) return false;
      ProjectFolder.closeDialog(false);
      SendPanel.close(false);
      load(projectId, invoiceId, state);
      return true;
    },

    pathOf,
    openSend,
  };
})();
