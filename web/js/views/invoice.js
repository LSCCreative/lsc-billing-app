'use strict';

/* #/projects/<id>/invoices/<invoiceId> — one invoice (production-booking
 * task 20; IA "Invoice", D35–D37, D100; reworked in ui-clarity task 10).
 *
 *   Header    the number as a mono eyebrow, the kind, project · client, the
 *             status chip, dates; the amount due as the screen's one big
 *             figure; then one primary button, Actions ▾ and Documents ▾
 *             (IA "Invoice row and Invoice screen"). Paid and void have no
 *             primary: there is nothing left to do but read and download.
 *   Notices   void, replaces, a voided deposit, legacy.
 *   Panels    by kind (U2):
 *               deposit  Deposit (D37: the %, editable while it is a draft
 *                        and its final hasn't gone out) and Production days
 *                        booked; the sum beside them.
 *               final    The accepted estimate (collapsed), Extras
 *                        (Additional work, D14, D35; editable while a draft,
 *                        Save extras in its foot); the Balance beside them:
 *                        estimate, extras, total, less the deposit, the
 *                        balance due.
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
  let estimateOpen = false; // The accepted estimate's panel, kept open across redraws of one invoice

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

  /* ── Header ────────────────────────────────────────────────────────────── */

  /* The chip's tone, as the Project page's rows: the word carries the
     meaning, the tint only echoes it. */
  const TONE = { draft: 'neutral', scheduled: 'info', sent: 'info', paid: 'ok', void: 'void', overdue: 'alert', legacy: 'neutral' };

  function statusMarkup(inv) {
    const s = inv.status;
    const overdue = s === 'sent' && inv.dueAt && inv.dueAt < today();
    let note = '';
    if (s === 'paid') note = inv.paidAt ? 'paid ' + when(inv.paidAt) + (inv.paidVia ? ', by ' + VIA_WORD[inv.paidVia] : '') : '';
    else if (s === 'void') note = inv.voidedAt ? 'voided ' + when(inv.voidedAt) : '';
    else if (s === 'sent' && inv.dueAt) note = (overdue ? 'was due ' : 'due ') + when(inv.dueAt);
    else if (s === 'scheduled' && inv.dueAt) note = 'due ' + when(inv.dueAt);
    else if (s === 'draft' && inv.kind === 'final') note = 'add any extras, then send it';
    if (inv.kind === 'legacy' && s !== 'paid') note = 'made the old way';
    const word = inv.kind === 'legacy' && s !== 'paid' ? 'Legacy' : overdue ? 'Overdue' : STATUS_WORD[s] || s;
    const tone = inv.kind === 'legacy' && s !== 'paid' ? 'legacy' : overdue ? 'overdue' : s;
    return '<p class="inv-status"><span class="pf-chip is-' + (TONE[tone] || 'neutral') + '">' + esc(word) + '</span>' +
      (note ? '<span class="inv-status-note' + (overdue ? ' is-alert' : '') + '">' + esc(note) + '</span>' : '') + '</p>' +
      (inv.kind === 'legacy' ? '' : SendPanel.statusMarkup(inv.send, inv.number || 'this invoice'));
  }

  /* The header's one primary, Actions ▾ and Documents ▾ (IA "Invoice row and
     Invoice screen", the Invoice-screen column). What each state offers is
     today's rule; the menus only hold it. Paid and void have no primary. */
  function actionsFor(inv) {
    const unpaid = inv.status !== 'paid' && inv.status !== 'void';
    const out = inv.status === 'sent' || inv.status === 'scheduled';
    if (inv.kind === 'legacy') {
      return {
        primary: unpaid ? { id: 'paid', label: 'Mark paid…', write: true } : null,
        actions: [],
        // An old invoice prints from the estimate it was made as.
        files: [inv.estimateId ? { id: 'legacy-pdf', label: 'Invoice PDF', hint: 'From its estimate' } : null],
      };
    }
    return {
      primary: inv.status === 'draft' ? { id: 'send', label: 'Send…', write: true }
        : out ? { id: 'paid', label: 'Mark paid…', write: true } : null,
      actions: [
        inv.publicToken && ['scheduled', 'sent', 'paid'].includes(inv.status) ? { id: 'copy', label: 'Copy link' } : null,
        inv.status === 'draft' ? { id: 'paid', label: 'Mark paid…', write: true } : null,
        inv.status === 'void' && inv.replacedBy
          ? { go: inv.replacedBy.id, label: 'Open the replacement', hint: inv.replacedBy.number || '' } : null,
        out ? { id: 'void', label: 'Void and remake…', danger: true, write: true } : null,
      ],
      files: [
        { id: 'pdf', label: 'Invoice PDF' },
        inv.status !== 'void' ? { id: 'breakdown', label: 'Cost Breakdown', hint: 'For you only' } : null,
      ],
    };
  }

  /* An action as a menu item: the same data-act a button carries, so
     runAction can't tell them apart. */
  function menuItem(a) {
    if (!a) return null;
    const attrs = a.go ? { 'data-go': a.go } : { 'data-act': a.id };
    if (a.write) attrs['data-write'] = '';
    return { text: a.label, hint: a.hint, danger: a.danger, attrs };
  }

  function actionsMarkup(inv) {
    const { primary, actions, files } = actionsFor(inv);
    const named = inv.number || 'this invoice';
    return (
      '<div class="inv-acts">' +
      (primary
        ? '<button type="button" class="btn btn-primary" id="inv-primary" data-act="' + primary.id + '"' +
          (primary.write ? ' data-write' : '') + '><span class="spinner"></span>' + esc(primary.label) + '</button>'
        : '') +
      LSCMenu.markup({ id: 'inv-menu-act', label: 'Actions', ariaLabel: 'Actions for ' + named, btnClass: 'btn', items: actions.map(menuItem) }) +
      LSCMenu.markup({ id: 'inv-menu-doc', label: 'Documents', ariaLabel: 'Documents for ' + named, btnClass: 'btn', items: files.map(menuItem) }) +
      '</div>'
    );
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
      '<header class="inv-head" aria-label="Invoice ' + esc(inv.number || '') + '">' +
      '<div class="inv-overview">' +
      '<p class="eyebrow inv-number">' + esc(inv.number || 'No number') + '</p>' +
      '<h1 class="inv-title">' + esc(KIND_TITLE[inv.kind] || 'Invoice') + '</h1>' +
      '<p class="inv-client">' + esc([project.name || 'Untitled', client.businessName].filter(Boolean).join(' · ')) + '</p>' +
      statusMarkup(inv) +
      (facts.length ? '<dl class="pf-facts">' + facts.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' : '') +
      '</div>' +
      '<div class="inv-due' + (inv.status === 'void' ? ' is-void' : '') + '" id="inv-due">' +
      '<span class="eyebrow inv-due-label">' + label + '</span>' +
      '<span class="inv-due-figure" id="inv-due-figure">' + fmt(due) + '</span>' +
      (treatment === 'taxable' || treatment === 'free'
        ? '<span class="inv-due-note">' + (treatment === 'taxable' ? 'inc. GST' : 'GST-free') + '</span>' : '') +
      '</div>' +
      actionsMarkup(inv) +
      '</header>'
    );
  }

  /* What the owner needs to know before anything else: it's void, it replaced
     one, or (a final) it takes off a deposit that has since been voided. */
  function noticesMarkup(inv) {
    let html = '';
    if (inv.status === 'void') {
      html += '<div class="pf-notice inv-notice" role="note"><p><strong>Void' +
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
      html += '<p class="pf-notice is-alert" role="note"><strong>The deposit this takes off, ' + esc(inv.less.number || '') +
        ', was voided.</strong> ' + (inv.status === 'draft'
        ? 'Reopen the folder to see the deposit that stands now.'
        : 'Void this final and make a replacement: the replacement takes off the deposit that stands now.') + '</p>';
    }
    if (inv.kind === 'legacy') {
      html += '<p class="pf-notice">Made the old way, before projects: its PDF prints from the estimate it was made as, and nothing ' +
        'about it can change here.' + (inv.status === 'paid' ? '' : ' Mark it paid when the money is in.') + '</p>';
    }
    return html ? '<div class="pf-notices">' + html + '</div>' : '';
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
    /* A void invoice owes nothing: its last line is what it asked for, muted.
       A paid one says so, as the client page does (task 33 DR8). */
    const owed = (word) => (inv.status === 'void' ? 'Was due' : inv.status === 'paid' ? word.replace(/ due$/, ' paid') : word);
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
    const head = '<div class="panel-head"><h2 class="panel-title" id="inv-days-h">Production days booked' +
      (days.length ? '<span class="panel-count">' + days.length + '</span>' : '') + '</h2></div>';
    if (!days.length) return head + '<div class="panel-body"><p class="pf-empty">No production days booked.</p></div>';
    return head + '<div class="panel-body is-flush"><ol class="inv-days">' + days.map((d, i) => {
      const date = C.isDate(d.date) ? C.longDate(d.date, today()) : 'Day ' + (i + 1) + ' — date TBC';
      const times = d.startTime || d.endTime ? C.timeText(d) : '';
      return '<li>' + C.statusChip(d.status) + '<span class="inv-day-date">' + esc(date) + '</span>' +
        (times ? '<span class="inv-day-time">' + esc(times) + '</span>' : '') + '</li>';
    }).join('') + '</ol></div>';
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

  /* The sum, beside the panels it adds up (U2): Balance, Total or Amount. */
  function sumMarkup(inv, totals, title) {
    return (
      '<section class="panel inv-sum-panel" aria-labelledby="inv-sum-h">' +
      '<div class="panel-head"><h2 class="panel-title" id="inv-sum-h">' + title + '</h2>' +
      '<span class="inv-preview" id="inv-preview" hidden>Preview, not saved</span></div>' +
      '<div class="panel-body">' + ledgerMarkup(inv, totals) + '</div>' +
      '</section>'
    );
  }

  function depositMarkup(inv, totals) {
    const estimate = inv.estimate || {};
    const pctField = inv.depositEditable
      ? '<div class="inv-pct">' +
        '<div class="field"><label for="inv-pct">Deposit %</label>' +
        '<input id="inv-pct" type="number" inputmode="decimal" min="1" max="100" step="any" value="' + esc(String(inv.pct)) + '"' +
        ' aria-describedby="inv-pct-hint"></div>' +
        '<button type="button" class="btn" id="inv-pct-save" data-write><span class="spinner"></span>Save %</button>' +
        '<p class="pfd-hint" id="inv-pct-hint" aria-live="polite">' + pctHint(inv, inv.pct) + '</p>' +
        '</div>'
      : '';
    return {
      main:
        '<section class="panel" aria-labelledby="inv-dep-h">' +
        '<div class="panel-head"><h2 class="panel-title" id="inv-dep-h">Deposit<span class="panel-count">' + esc(String(inv.pct)) + '%</span></h2></div>' +
        '<div class="panel-body inv-panel-body">' +
        '<p class="pf-hint">' + esc(String(inv.pct)) + '% to secure your booking, for estimate ' + esc(estimate.upid || '—') +
        (estimate.name ? ' · ' + esc(estimate.name) : '') +
        '. A summary, not an itemised bill: the accepted estimate is the itemised document.</p>' +
        pctField +
        '</div></section>' +
        '<section class="panel" aria-labelledby="inv-days-h">' + daysMarkup(estimate) + '</section>',
      side: sumMarkup(inv, totals, 'Amount'),
    };
  }

  /* ── Final and single: the estimate, then the Extras ──────────────────── */

  /* Collapsed on arrival (IA); open stays open while this invoice redraws. */
  function estimateMarkup(inv) {
    const estimate = inv.estimate || {};
    const open = estimateOpen;
    return (
      '<section class="panel inv-est-panel' + (open ? '' : ' is-collapsed') + '" id="inv-est-panel" aria-labelledby="inv-est-h">' +
      '<div class="panel-head"><h2 class="panel-title" id="inv-est-h">' +
      '<button type="button" class="panel-toggle" aria-expanded="' + open + '" aria-controls="inv-est-body">' +
      '<span class="panel-chev" aria-hidden="true"></span>' +
      '<span class="panel-name">The accepted estimate</span>' +
      '<span class="panel-sum">' + (estimate.upid ? '<span class="ref">' + esc(estimate.upid) + '</span> · ' : '') +
      '<span class="fig">' + fmt((estimate.totals || {}).totalIncGst) + '</span></span>' +
      '</button></h2></div>' +
      '<div class="panel-body inv-panel-body inv-est-body" id="inv-est-body"' + (open ? '' : ' hidden') + '>' +
      '<p class="pf-hint">As the client accepted it. Editing the estimate now changes no invoice.</p>' +
      EstimateDetail.itemsMarkup(estimate, LSCData.pricing()) +
      '</div></section>'
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
      '<button type="button" class="btn btn-sm" id="inv-add">+ Add</button></div>'
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
      '<div class="right muted-td" data-label="Price"><span class="fig">' + fmt(line.mu) + '</span></div>' +
      '<div class="right" data-label="Bill"><span class="bill-cell fig" data-bill="' + i + '">' + fmt(billOf(line)) + '</span>' + custom + '</div>' +
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

  /* The Extras panel: Save extras in its foot (IA). It keeps .billing-block
     for the editor's line grid: the tablet floor and the phone's stacked
     label/value rows (responsive.css). */
  function extrasMarkup(inv) {
    const editable = inv.editable;
    const subtotal = lines.reduce((sum, l) => sum + billOf(l), 0);
    return (
      '<section class="panel billing-block inv-extras" aria-labelledby="inv-extras-h">' +
      '<div class="panel-head"><h2 class="panel-title" id="inv-extras-h">Extras<span class="bb-label-tag">Additional work</span></h2>' +
      '<span class="panel-sum">Subtotal <span class="fig" id="inv-extras-sum">' + fmt(subtotal) + '</span></span></div>' +
      (editable ? pickerMarkup() : '') +
      '<div class="gt-head labour-grid"><div>Service</div><div class="right">Qty</div>' +
      '<div class="right">Price</div><div class="right">Bill</div><div></div></div>' +
      '<div class="gt-body" id="inv-extras-body">' + extrasRowsMarkup(editable) + '</div>' +
      '<div class="panel-foot inv-extras-foot">' +
      '<p class="inv-extras-hint">' + (editable
        ? 'Billed at the standard rate: no day or time rate applies to extras. Editable until the invoice is sent.'
        : inv.status === 'void' ? 'This invoice is void.' : 'Sent invoices don’t change. To correct one, void it and make a replacement.') + '</p>' +
      (editable
        ? '<div class="inv-save"><span class="inv-save-state" id="inv-save-state" aria-live="polite"></span>' +
          '<button type="button" class="btn" id="inv-save" data-write disabled><span class="spinner"></span>Save extras</button></div>'
        : '') +
      '</div></section>'
    );
  }

  function billMarkup(inv, totals) {
    return {
      main: estimateMarkup(inv) + extrasMarkup(inv),
      side: sumMarkup(inv, totals, inv.kind === 'final' ? 'Balance' : 'Total'),
    };
  }

  function legacyMarkup(inv) {
    return {
      main: '<section class="panel inv-sum-panel" aria-labelledby="inv-sum-h">' +
        '<div class="panel-head"><h2 class="panel-title" id="inv-sum-h">Amount</h2></div>' +
        '<div class="panel-body"><dl class="inv-ledger">' + ledgerRow('Total', fmt(inv.amountDue), 'is-due') + '</dl></div></section>',
      side: '',
    };
  }

  // ── The screen ──────────────────────────────────────────────────────────

  function draw() {
    const inv = data.invoice;
    const project = data.project;
    const totals = totalsNow();
    const body = inv.kind === 'deposit' ? depositMarkup(inv, totals) : inv.kind === 'legacy' ? legacyMarkup(inv) : billMarkup(inv, totals);
    LSCMenu.close(false);
    root.innerHTML =
      '<div id="invoice-screen" class="inv-screen">' +
      '<button class="back-btn" id="js-back">← ' + esc([project.upid, project.name].filter(Boolean).join(' · ') || 'Project') + '</button>' +
      headMarkup(inv, project, totals) +
      '<div class="pf-action-error" id="inv-error" role="alert"></div>' +
      noticesMarkup(inv) +
      '<div class="inv-body' + (body.side ? ' has-side' : '') + '">' +
      '<div class="inv-main">' + body.main + '</div>' +
      (body.side ? '<div class="inv-side">' + body.side + '</div>' : '') +
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
    // Buttons and closed menus' items alike: menu.js clicks a chosen item in place.
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
    const est = $('inv-est-panel');
    if (est) est.addEventListener('lsc:panel', (e) => { estimateOpen = e.detail.open; });
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
    // Quiet until there is something to save, then the screen's call to action:
    // it takes the terracotta from the header's primary (Send…, Mark paid…)
    // while the extras are unsaved, so the view still has one.
    save.classList.toggle('btn-primary', changed);
    const primary = $('inv-primary');
    if (primary) primary.classList.toggle('btn-primary', !changed);
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
      // Save extras is disabled once saved, so the picker, to add another.
      const again = $('inv-svc');
      if (again) again.focus();
      else focusHead();
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
      focusHead();
      return reply;
    } catch (err) {
      setBusy(button, false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (handled(err)) return null;
      return Promise.reject(err);
    }
  }

  /* What a dialog or panel opened from a menu item gives focus back to: the
     item is hidden again by then, so its menu's button. */
  function openerOf(el) {
    const menu = el && el.closest('.menu');
    return (menu && menu.querySelector('.menu-btn')) || el;
  }

  /* After a redraw: the header's primary, else its first menu. */
  function focusHead() {
    const target = $('inv-primary') || root.querySelector('.inv-acts .menu-btn');
    if (target) target.focus();
  }

  function runAction(id, el) {
    if (busy) return undefined;
    const button = openerOf(el);
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
        focusHead();
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
    estimateOpen = false;
    draw();
    LSCUtil.landFocus(root);
    LSCUnsaved.watch('invoice-extras', {
      label: 'the extras on ' + (reply.invoice.number || 'this invoice'),
      onScreen: () => onScreen() && data && data.invoice.id === reply.invoice.id,
      dirty,
    });
    // The folder's row menus hand over Mark paid… and Void and remake….
    if (then === 'paid' || then === 'void') {
      // Only while this state still offers it (the primary, or an Actions item).
      const el = root.querySelector('.inv-acts [data-act="' + then + '"]');
      if (el) (then === 'paid' ? openMarkPaid : openVoid)(openerOf(el));
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
        '<button type="button" class="btn" id="js-retry" style="margin-top:16px">Try again</button>');
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
       'paid' opens Mark paid once drawn (the folder's "Mark deposit paid…"),
       'void' its Void and remake (the folder's row menu). */
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
