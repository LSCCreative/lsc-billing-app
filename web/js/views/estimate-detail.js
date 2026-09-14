'use strict';

/* The read-only estimate view, ported from renderEstimate in the desktop app.
 *
 * Two changes from the original, both required by decisions already made:
 *
 *  - The totals card shows the corrected money model (BILLING_APP_PLAN.md
 *    §1.2): Client Price / GST / Total (inc GST) / Tax set-aside / Est.
 *    take-home, replacing "Net Invoice" / "Internal Tax" / "Gross Profit".
 *    The figures are read straight off `estimate.totals` as the server computed
 *    and stored them — this screen never does its own arithmetic on the
 *    headline numbers.
 *  - The client block reads the snapshot object (`client.businessName`,
 *    `client.contactName`, `client.email`) instead of the old flat fields.
 *
 * Export renders on the server (POST /api/estimates/:id/pdf) and arrives as a
 * browser download. The desktop app's "Open in Finder" link is gone: there is
 * no local folder to open, and the server keeps its own copy in /data/exports.
 * Export carries no data-write — it never changes the record, and a failed
 * export loses nothing, so the connection banner has no reason to block it.
 */

const EstimateDetail = (() => {
  const { fmt, esc } = LSCUtil;
  const { sectionsFor, labourDef, travelDef, labourBill, travelBill, costBill } = LSCRows;

  function headerMarkup(estimate) {
    const client = estimate.client || {};
    const invoiceBadge =
      estimate.docType === 'invoice'
        ? ' &nbsp;<span style="font-size:9px;padding:2px 7px;border:1px solid var(--accent);color:var(--accent);letter-spacing:.05em">INVOICE ' +
          esc(estimate.invoiceNumber || '—') +
          '</span>'
        : '';

    return (
      '<div class="est-header"><div>' +
      '<div class="est-upid">' + esc(estimate.upid || '—') + invoiceBadge + '</div>' +
      '<div style="color:var(--muted);font-size:11px;margin-bottom:4px">' + esc(estimate.date || '') + '</div>' +
      '<div class="est-name">' + esc(estimate.name) + '</div>' +
      (client.businessName ? '<div class="est-client">' + esc(client.businessName) + '</div>' : '') +
      (client.contactName
        ? '<div class="est-client" style="margin-top:2px">' + esc(client.contactName) +
          (client.email
            ? ' &nbsp;&middot;&nbsp; <span style="color:var(--accent)">' + esc(client.email) + '</span>'
            : '') +
          '</div>'
        : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<button class="btn btn-ghost btn-sm" id="js-edit">Edit</button>' +
      '<button class="btn btn-ghost btn-sm" id="js-duplicate" data-write>' +
      '<span class="spinner" id="dup-spin"></span>Duplicate</button>' +
      '<button class="btn btn-accent btn-sm" id="js-export">' +
      '<span class="spinner" id="exp-spin"></span>↑ ' +
      (estimate.docType === 'invoice' ? 'Export Client Invoice' : 'Export Quote PDF') +
      '</button>' +
      '</div></div>' +
      '<div id="export-error" role="alert"></div>'
    );
  }

  /* Every <td> in the four table shapes below carries data-label, matching its
     own <th>. Below 768px css/responsive.css hides the head row and prints
     those labels beside the values, because these tables cannot fit a phone:
     .est-block is overflow:hidden, and with real money in them — five columns,
     three of them figures — the Bill column was being cut off rather than
     scrolled to. The scratch data tops out at $560, which is why it took
     substituting a seven-figure total to see it. Inert above 768px. */

  /* A line whose service is no longer on the rate card carries no price — see
     the header comment in rows.js. It is still listed, so the estimate reads as
     the record of what was quoted. */
  function labourBlocks(estimate, pricing) {
    const activeRows = estimate.activeRows || {};
    let html = '';

    // asDocument: this screen is the read of what was quoted, so it uses the
    // headings the estimate carries — the same ones its PDF prints.
    sectionsFor(activeRows, pricing, estimate.sectionLabels, { asDocument: true }).forEach((section) => {
      const lines = (activeRows[section.id] || []).filter((line) => (line.qty || 0) > 0);
      if (!lines.length) return;

      let subtotal = 0;
      const rows = lines
        .map((line) => {
          const def = labourDef(section, line);
          const bill = labourBill(def, line);
          if (bill !== null) subtotal += bill;
          return (
            '<tr><td data-label="Service">' + esc(line.name) + '</td>' +
            '<td class="right muted-td" data-label="Hours">' + esc(line.qty) + '</td>' +
            '<td class="right muted-td" data-label="Rate">' + (def && def.rate > 0 ? fmt(def.rate) : '—') + '</td>' +
            '<td class="right muted-td" data-label="Mark-Up">' + (def ? fmt(def.mu) : '—') + '</td>' +
            '<td class="right bill" data-label="Bill">' + (bill === null ? '—' : fmt(bill)) + '</td></tr>'
          );
        })
        .join('');

      html +=
        '<div class="est-block"><div class="est-block-head">' +
        '<span class="est-block-label">' + esc(section.label) + '</span>' +
        '<span class="est-block-sum">' + fmt(subtotal) + '</span></div>' +
        '<table class="est-table"><thead><tr><th>Service</th><th class="right">Hours</th>' +
        '<th class="right">Rate</th><th class="right">Mark-Up</th><th class="right">Bill</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    });

    return html;
  }

  function costBlock(label, lines, nameKey, nameFallback, columns) {
    if (!lines.length) return '';
    const subtotal = lines.reduce((acc, line) => acc + costBill(line), 0);
    const rows = lines
      .map(
        (line) =>
          '<tr><td data-label="' + columns[0] + '">' + esc(line[nameKey] || nameFallback) + '</td>' +
          '<td class="right muted-td" data-label="' + columns[1] + '">' + esc(line.days || 0) + '</td>' +
          '<td class="right muted-td" data-label="' + columns[2] + '">' + fmt(line.cost) + '</td>' +
          '<td class="right bill" data-label="Total">' + fmt(costBill(line)) + '</td></tr>'
      )
      .join('');

    return (
      '<div class="est-block"><div class="est-block-head">' +
      '<span class="est-block-label">' + label + '</span>' +
      '<span class="est-block-sum">' + fmt(subtotal) + '</span></div>' +
      '<table class="est-table"><thead><tr><th>' + columns[0] + '</th>' +
      '<th class="right">' + columns[1] + '</th><th class="right">' + columns[2] + '</th>' +
      '<th class="right">Total</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    );
  }

  function travelBlock(activeRows, pricing) {
    const lines = (activeRows.travel || []).filter((line) => (line.qty || 0) > 0);
    if (!lines.length) return '';

    let subtotal = 0;
    const rows = lines
      .map((line) => {
        const def = travelDef(line, pricing);
        const bill = travelBill(def, line);
        if (bill !== null) subtotal += bill;
        return (
          '<tr><td data-label="Service">' + esc(line.name) + '</td>' +
          '<td class="right muted-td" data-label="Qty">' + esc(line.qty) + '</td>' +
          '<td class="right muted-td" data-label="Rate">' + (def && !def.directCost ? fmt(def.mu) : '—') + '</td>' +
          '<td class="right bill" data-label="Bill">' + (bill === null ? '—' : fmt(bill)) + '</td></tr>'
        );
      })
      .join('');

    return (
      '<div class="est-block"><div class="est-block-head">' +
      '<span class="est-block-label">Travel &amp; Accommodation</span>' +
      '<span class="est-block-sum">' + fmt(subtotal) + '</span></div>' +
      '<table class="est-table"><thead><tr><th>Service</th><th class="right">Qty</th>' +
      '<th class="right">Rate</th><th class="right">Bill</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>'
    );
  }

  function deliverablesBlock(activeRows) {
    const lines = (activeRows.deliverables || []).filter((d) => d.name);
    if (!lines.length) return '';
    return (
      '<div class="est-block"><div class="est-block-head">' +
      '<span class="est-block-label">Deliverables</span>' +
      '<span class="est-block-sum" style="color:var(--muted)">' +
      lines.length + ' item' + (lines.length !== 1 ? 's' : '') + '</span></div>' +
      '<table class="est-table"><thead><tr><th>Deliverable</th><th class="right">Format</th>' +
      '<th class="right">Duration</th><th class="right">Qty</th></tr></thead><tbody>' +
      lines
        .map(
          (d) =>
            '<tr><td data-label="Deliverable">' + esc(d.name) + '</td>' +
            '<td class="right muted-td" data-label="Format">' + esc(d.format || '—') + '</td>' +
            '<td class="right muted-td" data-label="Duration">' + esc(d.duration || '—') + '</td>' +
            '<td class="right muted-td" data-label="Qty">' + esc(String(d.qty || 1)) + '</td></tr>'
        )
        .join('') +
      '</tbody></table></div>'
    );
  }

  function totalsMarkup(estimate) {
    const t = estimate.totals || {};
    const notes = estimate.notes;
    // Classified exactly as the PDF classifies it, so this screen and the
    // exported document never disagree about whether GST was charged.
    const gstFree = LSCCalc.gstTreatment(t, estimate) === 'free';
    return (
      '<div class="est-totals">' +
      '<div class="totals-card"><table>' +
      '<tr><td class="tl">Labour Subtotal</td><td class="tv">' + fmt(t.labourTotal) + '</td></tr>' +
      '<tr><td class="tl">Expenses Subtotal</td><td class="tv">' + fmt(t.expenseTotal) + '</td></tr>' +
      '<tr><td class="tl">Pass-through Cost</td><td class="tv">' + fmt(t.passThroughCost) + '</td></tr>' +
      '<tr><td class="tl">Client Price (ex GST)</td><td class="tv">' + fmt(t.clientPriceExGst) + '</td></tr>' +
      '<tr><td class="tl">GST</td><td class="tv">' + (gstFree ? 'GST-free' : fmt(t.gst)) + '</td></tr>' +
      '<tr class="net-row"><td>Total (inc GST)</td><td class="tv">' + fmt(t.totalIncGst) + '</td></tr>' +
      '<tr><td class="tl">Tax Set-Aside</td><td class="tv">' + fmt(t.taxSetAside) + '</td></tr>' +
      '<tr><td class="tl" style="color:#6fcf6f">Est. Take-Home</td>' +
      '<td class="tv" style="color:#6fcf6f">' + fmt(t.estTakeHome) + '</td></tr>' +
      '<tr><td class="tl">Total Hours</td><td class="tv">' + esc(t.totalHours || 0) + '</td></tr>' +
      '</table></div>' +
      '<div class="notes-card"><h4>Internal Notes</h4><p>' +
      (notes ? esc(notes) : '<em style="color:var(--muted2)">No notes added.</em>') +
      '</p></div></div>'
    );
  }

  function markup(estimate, pricing) {
    const activeRows = estimate.activeRows || {};
    const equip = (activeRows.equip || []).filter((e) => costBill(e) > 0 || e.vendor);
    const crew = (activeRows.crew || []).filter((c) => costBill(c) > 0 || c.role);

    return (
      '<button class="back-btn" id="js-back">← Back</button>' +
      headerMarkup(estimate) +
      labourBlocks(estimate, pricing) +
      costBlock('Equipment Hire', equip, 'vendor', 'Equipment', ['Vendor / Item', 'Days', 'Cost/Day']) +
      travelBlock(activeRows, pricing) +
      costBlock('External Crew &amp; Contracts', crew, 'role', 'Crew', ['Role / Name', 'Days', 'Day Rate']) +
      deliverablesBlock(activeRows) +
      totalsMarkup(estimate)
    );
  }

  async function duplicate(estimate, els, handlers) {
    els.duplicate.disabled = true;
    els.dupSpinner.style.display = 'inline-block';
    Toast.working('Duplicating…');
    try {
      const reply = await LSCApi.post('/api/estimates/' + encodeURIComponent(estimate.id) + '/duplicate');
      Toast.ok('Duplicated — opening the copy.');
      handlers.onOpen(reply.estimate.id);
    } catch (err) {
      els.duplicate.disabled = false;
      els.dupSpinner.style.display = 'none';
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      Toast.error(
        err.kind === 'network'
          ? 'Couldn’t duplicate — the server is unreachable.'
          : 'Couldn’t duplicate: ' + (err.message || 'the server refused.')
      );
    }
  }

  function saveFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking in the same tick can cancel the download in Safari and Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* Failures are explained inline under the header rather than in the toast:
     the ABN one needs a way to act on it, and every one of them should still be
     readable after the toast has gone. */
  function showExportError(els, message, withSettingsLink, handlers) {
    els.exportError.textContent = message;
    if (withSettingsLink) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-ghost btn-xs';
      open.textContent = 'Open Invoice Settings';
      open.addEventListener('click', () => SettingsView.open({ onAuthLost: handlers.onAuthLost }, open));
      els.exportError.append(' ', open);
    }
    els.exportError.classList.add('show');
  }

  async function exportPdf(estimate, els, handlers) {
    const label = estimate.docType === 'invoice' ? 'Invoice' : 'Quote';
    els.export.disabled = true;
    els.expSpinner.style.display = 'inline-block';
    els.exportError.classList.remove('show');
    els.exportError.textContent = '';
    Toast.working('Generating PDF…');
    try {
      const reply = await LSCApi.postPdf('/api/estimates/' + encodeURIComponent(estimate.id) + '/pdf');
      const fallback = (estimate.docType === 'invoice' ? estimate.invoiceNumber : estimate.upid) || 'estimate';
      saveFile(reply.blob, reply.filename || fallback + '.pdf');
      Toast.ok(label + ' PDF downloaded.');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      Toast.hide();
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      if (err.code === 'abn_required') {
        showExportError(els, err.message, true, handlers);
      } else if (err.code === 'pdf_unavailable') {
        showExportError(els, 'Couldn’t export — the server has no PDF renderer. Check Chromium is installed in the container.');
      } else if (err.status === 404) {
        showExportError(els, 'Couldn’t export — this estimate no longer exists on the server.');
      } else if (err.kind === 'network') {
        showExportError(els, 'Couldn’t export — the server is unreachable. Try again once it’s back.');
      } else {
        showExportError(els, 'Couldn’t export: ' + (err.message || 'the server refused.'));
      }
    } finally {
      els.export.disabled = false;
      els.expSpinner.style.display = 'none';
    }
  }

  function mount(root, estimate, handlers) {
    root.innerHTML = markup(estimate, LSCData.pricing());

    const els = {
      duplicate: root.querySelector('#js-duplicate'),
      dupSpinner: root.querySelector('#dup-spin'),
      export: root.querySelector('#js-export'),
      expSpinner: root.querySelector('#exp-spin'),
      exportError: root.querySelector('#export-error'),
    };

    root.querySelector('#js-back').addEventListener('click', () => handlers.onBack());
    root.querySelector('#js-edit').addEventListener('click', () => handlers.onEdit(estimate));
    els.duplicate.addEventListener('click', () => duplicate(estimate, els, handlers));
    els.export.addEventListener('click', () => exportPdf(estimate, els, handlers));
  }

  return { mount };
})();
