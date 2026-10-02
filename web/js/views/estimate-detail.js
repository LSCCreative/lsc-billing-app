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
        ? ' &nbsp;<span style="font-size:9px;padding:2px 7px;border:1px solid var(--accent);color:var(--accent-text);letter-spacing:.05em">INVOICE ' +
          esc(estimate.invoiceNumber || '—') +
          '</span>'
        : '';

    return (
      '<div class="est-header"><div>' +
      '<div class="est-upid">' + esc(estimate.upid || '—') + invoiceBadge + '</div>' +
      '<div style="color:var(--muted);font-size:11px;margin-bottom:4px">' + esc(estimate.date || '') + '</div>' +
      '<h1 class="est-name">' + esc(estimate.name) + '</h1>' +
      (client.businessName ? '<div class="est-client">' + esc(client.businessName) + '</div>' : '') +
      (client.contactName
        ? '<div class="est-client" style="margin-top:2px">' + esc(client.contactName) +
          (client.email
            ? ' &nbsp;&middot;&nbsp; <span style="color:var(--accent-text)">' + esc(client.email) + '</span>'
            : '') +
          '</div>'
        : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<button class="btn btn-ghost btn-sm" id="js-edit">Edit</button>' +
      '<button class="btn btn-ghost btn-sm" id="js-duplicate" data-write>' +
      '<span class="spinner" id="dup-spin"></span>Duplicate</button>' +
      '<span class="cb-wrap"><button class="btn btn-ghost btn-sm" id="js-cost-breakdown">' +
      '<span class="spinner" id="cb-spin"></span>↓ Cost Breakdown</button>' +
      LSCInfo.markup({
        id: 'cost-breakdown',
        label: 'What the Cost Breakdown is',
        title: 'Cost Breakdown',
        paragraphs: [
          'A PDF for you that shows how this price is made up: each production day’s items at the standard ' +
            'rate, each surcharge with its multiplier and the hours it covered, short notice, then everything ' +
            'else, GST and the total.',
          'It has none of your internal figures (no floors, Minimum Job Price, tax set-aside or take-home), ' +
            'so you can forward it if a client asks why a day costs more. The client’s own quote never ' +
            'mentions a surcharge.',
        ],
      }) + '</span>' +
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
  /* Every section table is four columns (labour lost its Rate column on
     2026-09-21 — see estimate-editor.js's buildLabourRow), and .est-table-4
     gives them one shared set of column edges, so Qty, Mark-Up and Bill line
     up down the page the way a printed rate card does. */
  function labourBlocks(estimate, pricing) {
    const activeRows = estimate.activeRows || {};
    let html = '';

    // asDocument: this screen is the read of what was quoted, so it uses the
    // headings the estimate carries — the same ones its PDF prints.
    sectionsFor(activeRows, pricing, estimate.sectionLabels, { asDocument: true }).forEach((section) => {
      if (section.id === 'prod' && (estimate.days || []).length) {
        html += productionByDay(estimate, section, pricing);
        return;
      }
      const lines = (activeRows[section.id] || []).filter((line) => (line.qty || 0) > 0);
      if (!lines.length) return;

      /* Every labour category heads the column "Qty" and spells each
         quantity's unit — "2 full days", "3 hours" — as the editor does
         (service rate tiers, 2026-09-28: every service now sells at three
         units). The unit is the line's own, from its snapshot, like the
         Mark-Up beside it. A line with no price left says a bare number. */
      let subtotal = 0;
      const rows = lines
        .map((line) => {
          const def = labourDef(section, line, pricing);
          const bill = labourBill(def, line);
          if (bill !== null) subtotal += bill;
          return labourRow(line, def, bill, '');
        })
        .join('');

      html +=
        '<div class="est-block"><div class="est-block-head">' +
        '<h2 class="est-block-label">' + esc(section.label) + '</h2>' +
        '<span class="est-block-sum">' + fmt(subtotal) + '</span></div>' +
        '<table class="est-table est-table-4">' + LABOUR_HEAD + '<tbody>' + rows + '</tbody></table></div>';
    });

    return html;
  }

  const LABOUR_HEAD =
    '<thead><tr><th>Service</th><th class="right">Qty</th>' +
    '<th class="right">Mark-Up</th><th class="right">Bill</th></tr></thead>';

  function labourRow(line, def, bill, note) {
    const unit = LSCRows.labourUnit(def);
    const qty = def ? line.qty + ' ' + LSCRows.unitWord(unit.kind, line.qty) : line.qty;
    return (
      '<tr><td data-label="Service">' + esc(line.name) +
      (note ? '<span class="sur-note est-sur-note">' + esc(note) + '</span>' : '') + '</td>' +
      '<td class="right muted-td" data-label="Qty">' + esc(qty) + '</td>' +
      '<td class="right muted-td" data-label="Mark-Up">' + (def ? fmt(def.mu) : '—') + '</td>' +
      '<td class="right bill" data-label="Bill">' + (bill === null ? '—' : fmt(bill)) + '</td></tr>'
    );
  }

  /* Production on an estimate with booked days (production-booking task 8):
     one group per day, in the estimate's order (by date, Date TBC last), with
     its status, times and any clash note, then its items at the price the
     client pays — the stored `surchargedPrice`, never re-priced here — with
     the owner-only "incl. weekend ×1.5" note beneath. Lines saved before days
     existed follow under "Not on a day" at their base price, as they total. */
  function productionByDay(estimate, section, pricing) {
    const lines = (estimate.activeRows || {}).prod || [];
    const days = estimate.days || [];
    const snap = estimate.surcharges || {};
    const kinds = snap.days || {};
    const dayIds = new Set(days.map((d) => d.id));
    const today = LSCUtil.today();
    let subtotal = 0;

    const priced = (line) => {
      const def = labourDef(section, line, pricing);
      const base = labourBill(def, line);
      const onDay = line.dayId && dayIds.has(line.dayId);
      const bill = base === null ? null : onDay && typeof line.surchargedPrice === 'number' ? line.surchargedPrice : base;
      if (bill !== null) subtotal += bill;
      return { def, base, bill };
    };

    const groups = days.map((day) => {
      const own = lines.filter((line) => line.dayId === day.id);
      const withKind = Object.assign({}, day, { kind: kinds[day.id] });
      const rows = own.map((line) => {
        const { def, base, bill } = priced(line);
        const note = base !== null && bill > base
          ? LSCRows.surchargeNote(base, withKind, snap, estimate.shortNotice === true)
          : '';
        return labourRow(line, def, bill, note);
      }).join('');
      const when = day.date ? LSCCalendar.longDate(day.date, today) : 'Date TBC';
      const times = day.startTime || day.endTime ? LSCCalendar.timeText(day) : '';
      return (
        '<tbody class="est-day">' +
        '<tr class="est-day-head"><th colspan="4" scope="rowgroup">' +
        '<span class="est-day-date">' + esc(when) + '</span>' + LSCCalendar.statusChip(day.status) +
        (times ? '<span class="est-day-time">' + esc(times) + '</span>' : '') +
        (day.overrideNote ? '<span class="est-day-note">Note: ' + esc(day.overrideNote) + '</span>' : '') +
        '</th></tr>' +
        (rows || '<tr class="est-day-empty"><td colspan="4">No production items on this day.</td></tr>') +
        '</tbody>'
      );
    }).join('');

    const loose = lines.filter((line) => !(line.dayId && dayIds.has(line.dayId)) && (line.qty || 0) > 0);
    const looseRows = loose.map((line) => {
      const { def, bill } = priced(line);
      return labourRow(line, def, bill, '');
    }).join('');
    const unassigned = looseRows
      ? '<tbody class="est-day"><tr class="est-day-head"><th colspan="4" scope="rowgroup">' +
        '<span class="est-day-date">Not on a day</span></th></tr>' + looseRows + '</tbody>'
      : '';

    const disclaimer = days.some((d) => d.status === 'proposed')
      ? '<p class="est-day-disclaimer"><span class="est-day-disclaimer-k">On the client’s copy:</span> ' +
        'The proposed dates are not locked in and other project bookings may happen before this estimate is ' +
        'agreed upon.</p>'
      : '';

    return (
      '<div class="est-block est-block-days"><div class="est-block-head">' +
      '<h2 class="est-block-label">' + esc(section.label) + '</h2>' +
      '<span class="est-block-sum">' + fmt(subtotal) + '</span></div>' +
      '<table class="est-table est-table-4">' + LABOUR_HEAD + groups + unassigned + '</table>' +
      disclaimer + '</div>'
    );
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
      '<h2 class="est-block-label">' + label + '</h2>' +
      '<span class="est-block-sum">' + fmt(subtotal) + '</span></div>' +
      '<table class="est-table est-table-4"><thead><tr><th>' + columns[0] + '</th>' +
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
          '<td class="right muted-td" data-label="Rate">' +
            (def && def.perKm ? LSCUtil.perKm(def.mu) : def && !def.directCost ? fmt(def.mu) : '—') + '</td>' +
          '<td class="right bill" data-label="Bill">' + (bill === null ? '—' : fmt(bill)) + '</td></tr>'
        );
      })
      .join('');

    return (
      '<div class="est-block"><div class="est-block-head">' +
      '<h2 class="est-block-label">Travel &amp; Accommodation</h2>' +
      '<span class="est-block-sum">' + fmt(subtotal) + '</span></div>' +
      '<table class="est-table est-table-4"><thead><tr><th>Service</th><th class="right">Qty</th>' +
      '<th class="right">Rate</th><th class="right">Bill</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>'
    );
  }

  function deliverablesBlock(activeRows) {
    const lines = (activeRows.deliverables || []).filter((d) => d.name);
    if (!lines.length) return '';
    return (
      '<div class="est-block"><div class="est-block-head">' +
      '<h2 class="est-block-label">Deliverables</h2>' +
      '<span class="est-block-sum" style="color:var(--muted)">' +
      lines.length + ' item' + (lines.length !== 1 ? 's' : '') + '</span></div>' +
      '<table class="est-table est-table-4"><thead><tr><th>Deliverable</th><th class="right">Format</th>' +
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
    const gstTreatment = LSCCalc.gstTreatment(t, estimate);
    const gstFree = gstTreatment === 'free';
    return (
      '<div class="est-totals">' +
      '<div class="totals-card"><table>' +
      '<tr><td class="tl">Labour Subtotal</td><td class="tv">' + fmt(t.labourTotal) + '</td></tr>' +
      /* Owner-only, like the rest of this card: what surcharges added, already
         inside Labour Subtotal (production-booking task 8). */
      (t.surchargeTotal > 0
        ? '<tr class="sur-total-row"><td class="tl">incl. Surcharges</td><td class="tv">' + fmt(t.surchargeTotal) + '</td></tr>'
        : '') +
      '<tr><td class="tl">Expenses Subtotal</td><td class="tv">' + fmt(t.expenseTotal) + '</td></tr>' +
      /* Ex-GST whenever GST was charged, unlike the as-billed subtotals above
         it: on a GST-exclusive card costs are typed ex-GST, and on an inclusive
         one computeTotals takes the GST out (estimate-accuracy task 3). */
      '<tr><td class="tl">Pass-through Cost' + (gstTreatment === 'taxable' ? ' (ex GST)' : '') +
      '</td><td class="tv">' + fmt(t.passThroughCost) + '</td></tr>' +
      '<tr><td class="tl">Client Price (ex GST)</td><td class="tv">' + fmt(t.clientPriceExGst) + '</td></tr>' +
      '<tr><td class="tl">GST</td><td class="tv">' + (gstFree ? 'GST-free' : fmt(t.gst)) + '</td></tr>' +
      '<tr class="net-row"><td>Total (inc GST)</td><td class="tv">' + fmt(t.totalIncGst) + '</td></tr>' +
      '<tr><td class="tl">Tax Set-Aside</td><td class="tv">' + fmt(t.taxSetAside) + '</td></tr>' +
      '<tr><td class="tl" style="color:var(--ok)">Est. Take-Home</td>' +
      '<td class="tv" style="color:var(--ok)">' + fmt(t.estTakeHome) + '</td></tr>' +
      '<tr><td class="tl">Total Hours</td><td class="tv">' + esc(t.totalHours || 0) + '</td></tr>' +
      '</table></div>' +
      '<div class="notes-card"><h4>Internal Notes</h4><p>' +
      (notes ? esc(notes) : '<em style="color:var(--muted)">No notes added.</em>') +
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
      LSCUtil.saveFile(reply.blob, reply.filename || fallback + '.pdf');
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

  /* The owner's Cost Breakdown PDF (D8, D13). Fails the way the quote's
     export does, inline under the header. */
  async function exportCostBreakdown(estimate, els, handlers) {
    els.costBreakdown.disabled = true;
    els.cbSpinner.style.display = 'inline-block';
    els.exportError.classList.remove('show');
    els.exportError.textContent = '';
    Toast.working('Generating the Cost Breakdown…');
    try {
      const reply = await LSCApi.postPdf('/api/estimates/' + encodeURIComponent(estimate.id) + '/cost-breakdown');
      LSCUtil.saveFile(reply.blob, reply.filename || 'Cost Breakdown_' + (estimate.upid || 'EST') + '.pdf');
      Toast.ok('Cost Breakdown downloaded.');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      Toast.hide();
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      if (err.code === 'pdf_unavailable') {
        showExportError(els, 'Couldn’t make the Cost Breakdown — the server has no PDF renderer. Check Chromium is installed in the container.');
      } else if (err.status === 404) {
        showExportError(els, 'Couldn’t make the Cost Breakdown — this estimate no longer exists on the server.');
      } else if (err.kind === 'network') {
        showExportError(els, 'Couldn’t make the Cost Breakdown — the server is unreachable. Try again once it’s back.');
      } else {
        showExportError(els, 'Couldn’t make the Cost Breakdown: ' + (err.message || 'the server refused.'));
      }
    } finally {
      els.costBreakdown.disabled = false;
      els.cbSpinner.style.display = 'none';
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
      costBreakdown: root.querySelector('#js-cost-breakdown'),
      cbSpinner: root.querySelector('#cb-spin'),
    };

    root.querySelector('#js-back').addEventListener('click', () => handlers.onBack());
    root.querySelector('#js-edit').addEventListener('click', () => handlers.onEdit(estimate));
    els.duplicate.addEventListener('click', () => duplicate(estimate, els, handlers));
    els.export.addEventListener('click', () => exportPdf(estimate, els, handlers));
    els.costBreakdown.addEventListener('click', () => exportCostBreakdown(estimate, els, handlers));
  }

  return { mount };
})();
