'use strict';

/**
 * Client-facing PDF (quote or invoice), ported verbatim from the Electron
 * app's `buildClientPDF` / `buildClientInvoicePDF` in the old `index.html` —
 * same markup, same inline styles — so a re-export of an existing estimate
 * matches the PDF the desktop app already produced for it. Only the data
 * source changed: `proj.businessName` etc. (flat fields on the old in-memory
 * project) become `estimate.client.businessName` etc. (a snapshot object,
 * per the server's data model).
 */

const { RESERVED_SECTION_IDS } = require('./ratecard');
const { gstTreatment, costBreakdown, lineDef, round2 } = require('./calc');

function fmt(n) {
  return '$' + (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * The labour sections an estimate's rows belong to, and what to call each one.
 *
 * `sectionLabels` is the estimate's own snapshot of the headings, taken when it
 * was saved. It wins over the live rate card: this document may already be with
 * the client, and re-exporting it must reproduce what they were sent, not what
 * the rate card happens to say today. The live card is the fallback for
 * estimates saved before the snapshot existed, and "Archived Services" the last
 * resort for a category that was deleted before either recorded it.
 */
function sectionsFor(activeRows, labourSections, sectionLabels) {
  const labels = sectionLabels || {};
  const out = labourSections.map((s) =>
    labels[s.id] && labels[s.id] !== s.label ? Object.assign({}, s, { label: labels[s.id] }) : s
  );
  const known = new Set(Object.keys(RESERVED_SECTION_IDS));
  labourSections.forEach((s) => known.add(s.id));
  Object.keys(activeRows || {}).forEach((id) => {
    if (known.has(id) || !Array.isArray(activeRows[id]) || !activeRows[id].length) return;
    out.push({ id, label: labels[id] || 'Archived Services', rows: [] });
  });
  return out;
}

/**
 * A post line's deliverable tag (B2-2, D95): the CURRENT name of the
 * deliverable its `deliverableId` names, so a rename follows to the document.
 * Nothing when it names none, or one with no name — a tag that would print
 * blank, or something stale, prints no tag.
 */
function deliverableNames(activeRows) {
  const out = new Map();
  ((activeRows && activeRows.deliverables) || []).forEach((d) => {
    if (d && d.id && String(d.name || '').trim()) out.set(String(d.id), String(d.name).trim());
  });
  return out;
}

function serviceItemsHtml(activeRows, labourSections, sectionLabels, dayIds) {
  const ar = activeRows || {};
  const onDay = (s) => Boolean(dayIds && s.dayId && dayIds.has(String(s.dayId)));
  const tags = deliverableNames(ar);
  const tagOf = (secId, s) => {
    const name = secId === 'post' && s.deliverableId ? tags.get(String(s.deliverableId)) : '';
    return name ? ' <span style="font-weight:400;color:#888">&middot; ' + esc(name) + '</span>' : '';
  };
  let html = '';

  sectionsFor(ar, labourSections, sectionLabels).forEach((sec) => {
    // A production item on a booked day is listed under its day instead.
    const rows = (ar[sec.id] || []).filter((s) => (s.qty || 0) > 0 && !(sec.id === 'prod' && onDay(s)));
    if (!rows.length) return;
    html += '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0">' +
      '<div style="font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#B85444;font-weight:700;margin-bottom:5px">' + esc(sec.label) + '</div>';
    rows.forEach((s) => {
      html += '<div style="font-size:10.5pt;font-weight:600;color:#181818;margin-bottom:3px">' + esc(s.name) + tagOf(sec.id, s) + '</div>';
    });
    html += '</div>';
  });

  /* Since B2 a hire line has a vendor and an Item (D82). The client sees the
     Item; a line saved before B2 has its "vendor / item" text in `vendor`
     only, and prints it as it always did. */
  const eqName = (e) => String(e.item || '').trim() || e.vendor;
  const eqActive = (ar.equip || []).filter((e) => eqName(e) || (e.days && e.cost));
  if (eqActive.length) {
    html += '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0"><div style="font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#B85444;font-weight:700;margin-bottom:5px">Equipment Hire</div>' +
      eqActive.map((e) => '<div style="font-size:10pt;color:#181818;margin-bottom:2px">' + esc(eqName(e) || 'Equipment') + '</div>').join('') + '</div>';
  }

  const tvActive = (ar.travel || []).filter((t) => (t.qty || 0) > 0);
  if (tvActive.length) {
    html += '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0"><div style="font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#B85444;font-weight:700;margin-bottom:5px">Travel &amp; Accommodation</div>' +
      tvActive.map((s) => '<div style="font-size:10pt;color:#181818;margin-bottom:2px">' + esc(s.name) + '</div>').join('') + '</div>';
  }

  const crActive = (ar.crew || []).filter((c) => c.role || (c.days && c.cost));
  if (crActive.length) {
    html += '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0"><div style="font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#B85444;font-weight:700;margin-bottom:5px">External Crew &amp; Contracts</div>' +
      crActive.map((c) => '<div style="font-size:10pt;color:#181818;margin-bottom:2px">' + esc(c.role || 'Crew Member') + '</div>').join('') + '</div>';
  }

  return html;
}

/* ── Production days (production-booking task 8) ─────────────────────────────
   The client's copy lists each booked day with its status word and times, and
   that day's items at the price the client pays: the surcharge is folded into
   the price and never named (D8, D12). The owner's clash note is not printed —
   it is about other projects. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS_WORD = { confirmed: 'Confirmed', pencilled: 'Pencilled', proposed: 'Proposed' };
const UNIT_WORDS = {
  hour: ['hour', 'hours'],
  full: ['full day', 'full days'],
  half: ['half day', 'half days'],
  unit: ['unit', 'units'],
};
const PROPOSED_DISCLAIMER =
  'The proposed dates are not locked in and other project bookings may happen before this estimate is agreed upon.';

/** "Saturday 3 October 2026", or "Date TBC". Read as text: no timezone moves it. */
function dayDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return 'Date TBC';
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return WEEKDAYS[wd] + ' ' + Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

/* '13:00' → '1:00pm'. */
function clock12(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + (h < 12 ? 'am' : 'pm');
}

/** "1:00pm–9:00pm", "6:00pm–2:00am (ends next day)", or '' with no times. */
function dayTimes(day) {
  const a = clock12(day.startTime);
  const b = clock12(day.endTime);
  if (a && b) return a + '–' + b + (String(day.endTime) < String(day.startTime) ? ' (ends next day)' : '');
  if (a) return 'From ' + a;
  if (b) return 'Until ' + b;
  return '';
}

function qtyText(qty, unit) {
  const words = UNIT_WORDS[unit] || UNIT_WORDS.unit;
  return qty + ' ' + (Number(qty) === 1 ? words[0] : words[1]);
}

function unitOfLine(line, def) {
  const dayUnit = (def && def.dayUnit) || line.dayUnit;
  if (dayUnit === 'full' || dayUnit === 'half') return dayUnit;
  const h = parseFloat(def && def.hoursPerUnit);
  return !Number.isFinite(h) || h <= 0 || h === 1 ? 'hour' : 'unit';
}

/** The estimate's day ids, for "is this production line on a day". */
function dayIdsOf(estimate) {
  return new Set((estimate.days || []).filter((d) => d && d.id).map((d) => String(d.id)));
}

const hasProposedDay = (estimate) => (estimate.days || []).some((d) => d && d.status === 'proposed');

/**
 * Each booked day with its production items at their stored client price
 * (`surchargedPrice`, which the server stamps on every save and which is what
 * the totals contain). Nothing is re-priced here. A line saved without one —
 * none should exist — falls back to its base price.
 */
function daysWithItems(estimate, pricing) {
  const prodSection = ((pricing && pricing.labourSections) || []).find((s) => s.id === 'prod');
  const lines = ((estimate.activeRows && estimate.activeRows.prod) || []);
  return (estimate.days || []).filter((d) => d && d.id).map((day) => {
    const items = lines.filter((l) => l && String(l.dayId || '') === String(day.id)).map((line) => {
      const def = lineDef(prodSection ? prodSection.rows : [], line, pricing);
      const override = parseFloat(line.override) > 0 ? parseFloat(line.override) : 0;
      const base = def ? (override || (parseFloat(line.qty) || 0) * (parseFloat(def.mu) || 0)) : 0;
      const price = typeof line.surchargedPrice === 'number' ? line.surchargedPrice : round2(base);
      return { name: line.name, qty: line.qty, unit: unitOfLine(line, def), price };
    // A line with no quantity and no price is left off, as everywhere else on
    // the document; one that's charged (a custom amount) never is.
    }).filter((it) => (parseFloat(it.qty) || 0) > 0 || it.price > 0);
    return { day, items };
  });
}

/* The existing services block. Printed as it always was, empty or not, unless
   every item is already listed under a production day. */
function whatGoesInHtml(serviceItems, estimate) {
  if (!serviceItems && dayIdsOf(estimate).size) return '';
  return '<div style="margin-bottom:28px"><div class="sh">What Goes Into This Project</div>' + serviceItems + '</div>';
}

function productionDaysHtml(estimate, pricing, withDisclaimer) {
  const days = daysWithItems(estimate, pricing);
  if (!days.length) return '';
  const body = days.map(({ day, items }) => {
    const meta = [STATUS_WORD[day.status] || 'Proposed', dayTimes(day)].filter(Boolean).join(' &middot; ');
    return '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:5px">' +
        '<div style="font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#B85444;font-weight:700">' + esc(dayDate(day.date)) + '</div>' +
        '<div style="font-size:8.5pt;color:#555">' + meta + '</div></div>' +
      items.map((it) =>
        '<div style="display:flex;justify-content:space-between;gap:16px;font-size:10.5pt;font-weight:600;color:#181818;margin-bottom:3px">' +
          '<span>' + esc(it.name) + ' <span style="font-weight:400;color:#888">&middot; ' + esc(qtyText(it.qty, it.unit)) + '</span></span>' +
          '<span style="white-space:nowrap">' + fmt(it.price) + '</span></div>'
      ).join('') +
    '</div>';
  }).join('');
  const disclaimer = withDisclaimer && hasProposedDay(estimate)
    ? '<div style="margin-top:8px;padding:10px 14px;background:#f7f7f7;border-left:3px solid #B85444;font-size:9pt;color:#555;line-height:1.5">' +
      PROPOSED_DISCLAIMER + '</div>'
    : '';
  return '<div style="margin-bottom:28px"><div class="sh">Production Days</div>' + body + disclaimer + '</div>';
}

function deliverablesTableHtml(activeRows) {
  const drows = ((activeRows && activeRows.deliverables) || []).filter((d) => d.name);
  if (!drows.length) return '';
  return '<div style="margin-bottom:28px"><div class="sh">Deliverables</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:10pt"><thead><tr style="background:#f7f7f7">' +
      '<th style="text-align:left;padding:8px 12px;font-size:8pt;text-transform:uppercase;color:#888;border-bottom:1px solid #e8e8e8">Deliverable</th>' +
      '<th style="text-align:right;padding:8px 12px;font-size:8pt;text-transform:uppercase;color:#888;border-bottom:1px solid #e8e8e8">Format</th>' +
      '<th style="text-align:right;padding:8px 12px;font-size:8pt;text-transform:uppercase;color:#888;border-bottom:1px solid #e8e8e8">Duration</th>' +
      '<th style="text-align:right;padding:8px 12px;font-size:8pt;text-transform:uppercase;color:#888;border-bottom:1px solid #e8e8e8">Qty</th>' +
    '</tr></thead><tbody>' +
    drows.map((d, i) => {
      const bg = i % 2 === 0 ? '#fff' : '#fafafa';
      return '<tr style="background:' + bg + '"><td style="padding:8px 12px;font-weight:600;color:#181818">' + esc(d.name) + '</td>' +
        '<td style="text-align:right;padding:8px 12px;color:#555">' + esc(d.format || '—') + '</td>' +
        '<td style="text-align:right;padding:8px 12px;color:#555">' + esc(d.duration || '—') + '</td>' +
        '<td style="text-align:right;padding:8px 12px;font-weight:700;color:#B85444">' + esc(String(d.qty || 1)) + '</td></tr>';
    }).join('') +
    '</tbody></table></div>';
}

/** "12345678901" → "12 345 678 901", the way the ATO prints one. */
function formatAbn(abn) {
  const raw = String(abn || '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : raw;
}

/* Who is issuing the document. A tax invoice must identify the seller and show
   their ABN; the logo is a trading name, so the legal name sits beneath it. */
function sellerHtml(business) {
  const parts = [];
  if (business.name) parts.push(esc(business.name));
  if (business.abn) parts.push('ABN ' + esc(formatAbn(business.abn)));
  return parts.length ? '<div style="font-size:8.5pt;color:#555;margin-top:6px">' + parts.join(' &middot; ') + '</div>' : '';
}

/* The dark total bar, with the ex-GST / GST breakdown above it only when GST
   was actually charged. `treatment` comes from calc.js's gstTreatment — the
   stored figures, not today's settings — so a re-export says what the original
   said. */
function totalsBoxHtml(label, totals, treatment) {
  const t = totals || {};
  const cell = 'padding:9px 16px;font-size:10.5pt;border-bottom:1px solid #e8e8e8';
  const line = (name, value) =>
    '<tr><td style="' + cell + ';color:#555">' + name + '</td>' +
    '<td style="' + cell + ';text-align:right;font-weight:600;color:#181818">' + fmt(value) + '</td></tr>';
  const qualifier = treatment === 'taxable' ? 'inc. GST' : treatment === 'free' ? 'GST-free' : 'inc. all services';

  return '<div style="border:1px solid #e8e8e8;display:inline-block;min-width:290px"><table style="width:100%;border-collapse:collapse">' +
    (treatment === 'taxable' ? line('Subtotal (ex GST)', t.clientPriceExGst) + line('GST', t.gst) : '') +
    '<tr style="background:#181818">' +
      '<td style="padding:13px 16px;font-size:13pt;font-weight:800;color:#fff">' + label + ' <span style="font-size:9pt;font-weight:400;color:#aaa">' + qualifier + '</span></td>' +
      '<td style="padding:13px 16px;text-align:right;font-size:15pt;font-weight:900;color:#B85444">' + fmt(t.totalIncGst) + '</td>' +
    '</tr></table></div>';
}

/* Replaces the desktop app's "GST not included", which it printed on every
   document because it had no GST. On a registered business that line contradicts
   the GST it charges; on an unregistered one it implies GST is still to come. */
function gstNote(treatment, docWord) {
  if (treatment === 'taxable') return 'All prices in AUD and include GST.';
  if (treatment === 'free') return 'All prices in AUD. GST-free — no GST is payable on this ' + docWord + '.';
  return 'All prices in AUD. No GST is charged.';
}

const PDF_STYLE = '*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#181818;background:#fff}.sh{font-size:8pt;text-transform:uppercase;letter-spacing:.12em;color:#888;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #181818}';

function buildQuoteHtml(estimate, pricing, business) {
  const client = estimate.client || {};
  const labourSections = (pricing && pricing.labourSections) || [];
  const serviceItems = serviceItemsHtml(estimate.activeRows, labourSections, estimate.sectionLabels, dayIdsOf(estimate));
  const treatment = gstTreatment(estimate.totals, estimate);

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + PDF_STYLE + '</style></head><body>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #181818">' +
      '<div><div style="font-size:22pt;font-weight:900;letter-spacing:.02em">LSC CREATIVE<span style="color:#B85444">.</span></div>' +
      '<div style="font-size:8pt;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-top:4px">Motion Productions</div>' +
      sellerHtml(business) + '</div>' +
      '<div style="text-align:right"><div style="font-size:13pt;font-weight:700;color:#B85444;letter-spacing:.04em">' + esc(estimate.upid || '—') + '</div>' +
      '<div style="font-size:9pt;color:#888;margin-top:2px">' + esc(estimate.date || '') + '</div>' +
      '<div style="font-size:15pt;font-weight:800;color:#181818;margin-top:6px">' + esc(estimate.name) + '</div>' +
      (client.businessName ? '<div style="font-size:10pt;color:#555;margin-top:3px;font-weight:500">' + esc(client.businessName) + '</div>' : '') +
      (client.contactName ? '<div style="font-size:9.5pt;color:#888;margin-top:2px">' + esc(client.contactName) + (client.email ? ' &middot; ' + esc(client.email) : '') + '</div>' : '') +
      '</div></div>' +
    deliverablesTableHtml(estimate.activeRows) +
    productionDaysHtml(estimate, pricing, true) +
    whatGoesInHtml(serviceItems, estimate) +
    '<div style="margin-bottom:28px"><div class="sh">Your Investment</div>' +
      totalsBoxHtml('Total Investment', estimate.totals, treatment) +
      '<div style="margin-top:10px;font-size:8.5pt;color:#aaa">' + gstNote(treatment, 'quote') + ' Quote valid for 30 days from issue date.</div></div>' +
    '<div style="margin-top:36px;padding-top:20px;border-top:1px solid #e8e8e8">' +
      '<div style="font-size:10.5pt;color:#333;line-height:2.1">If you have any questions or want to chat through this estimate, please reach out.<br><br>' +
      '<strong>Lachlan Sullivan-Carey</strong><br>lachlan@creativelsc.com<br>04 12 710 836</div>' +
    '</div></body></html>';
}

function buildInvoiceHtml(estimate, pricing, settings) {
  const client = estimate.client || {};
  const labourSections = (pricing && pricing.labourSections) || [];
  const serviceItems = serviceItemsHtml(estimate.activeRows, labourSections, estimate.sectionLabels, dayIdsOf(estimate));
  const payment = (settings && settings.payment) || {};
  const business = (settings && settings.business) || {};
  // Only a document that charges GST is a tax invoice. A GST-free job, or one
  // from an unregistered business, is a plain invoice and must not claim to be.
  const treatment = gstTreatment(estimate.totals, estimate);
  const title = treatment === 'taxable' ? 'TAX INVOICE' : 'INVOICE';

  let payBlock = '';
  if (payment.bankName || payment.accountName || payment.bsb || payment.accountNumber || payment.terms) {
    payBlock = '<div style="margin-top:28px;padding-top:20px;border-top:2px solid #181818">' +
      '<div style="font-size:8pt;text-transform:uppercase;letter-spacing:.12em;color:#888;font-weight:700;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #181818">Payment Details</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:10.5pt"><tbody>' +
      (payment.bankName ? '<tr><td style="padding:5px 0;color:#888;width:160px">Bank</td><td style="padding:5px 0;font-weight:600;color:#181818">' + esc(payment.bankName) + '</td></tr>' : '') +
      (payment.accountName ? '<tr><td style="padding:5px 0;color:#888">Account Name</td><td style="padding:5px 0;font-weight:600;color:#181818">' + esc(payment.accountName) + '</td></tr>' : '') +
      (payment.bsb ? '<tr><td style="padding:5px 0;color:#888">BSB</td><td style="padding:5px 0;font-weight:600;color:#181818">' + esc(payment.bsb) + '</td></tr>' : '') +
      (payment.accountNumber ? '<tr><td style="padding:5px 0;color:#888">Account Number</td><td style="padding:5px 0;font-weight:600;color:#181818">' + esc(payment.accountNumber) + '</td></tr>' : '') +
      '</tbody></table>' +
      (payment.terms ? '<div style="margin-top:12px;padding:12px 16px;background:#f7f7f7;border-left:3px solid #B85444"><div style="font-size:8pt;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px;font-weight:700">Payment Terms</div><div style="font-size:10pt;color:#181818;line-height:1.6">' + esc(payment.terms) + '</div></div>' : '') +
    '</div>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + PDF_STYLE + '</style></head><body style="padding:40px 32px;max-width:700px;margin:0 auto">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #181818">' +
      '<div><div style="font-size:22pt;font-weight:900;letter-spacing:.02em">LSC CREATIVE<span style="color:#B85444">.</span></div>' +
      '<div style="font-size:8pt;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-top:4px">Motion Productions</div>' +
      sellerHtml(business) + '</div>' +
      '<div style="text-align:right">' +
      '<div style="font-size:16pt;font-weight:900;color:#181818;letter-spacing:.02em">' + title + ' <span style="color:#B85444">' + esc(estimate.invoiceNumber || '—') + '</span></div>' +
      '<div style="font-size:9pt;color:#888;margin-top:2px">' + esc(estimate.date || '') + '</div>' +
      '<div style="font-size:15pt;font-weight:800;color:#181818;margin-top:6px">' + esc(estimate.name) + '</div>' +
      (client.businessName ? '<div style="font-size:10pt;color:#555;margin-top:3px;font-weight:500">' + esc(client.businessName) + '</div>' : '') +
      (client.contactName ? '<div style="font-size:9.5pt;color:#888;margin-top:2px">' + esc(client.contactName) + (client.email ? ' &middot; ' + esc(client.email) : '') + '</div>' : '') +
      (client.abn ? '<div style="font-size:9.5pt;color:#888;margin-top:2px">ABN ' + esc(formatAbn(client.abn)) + '</div>' : '') +
      '</div></div>' +
    deliverablesTableHtml(estimate.activeRows) +
    productionDaysHtml(estimate, pricing, false) +
    whatGoesInHtml(serviceItems, estimate) +
    '<div style="margin-bottom:0"><div class="sh">Invoice Total</div>' +
      totalsBoxHtml('Total Due', estimate.totals, treatment) +
      '<div style="margin-top:10px;font-size:8.5pt;color:#aaa">' + gstNote(treatment, 'invoice') + '</div></div>' +
    payBlock +
    '</body></html>';
}

/* ── The Cost Breakdown (D8, D13) ─────────────────────────────────────────────
   The owner's download that explains the price. Client-safe, so it can be
   forwarded: base prices, each surcharge, short notice, the other lines,
   GST and the total. It never carries a floor, the Minimum Job Price, the tax
   set-aside, take-home or overhead — the figures come from calc.js
   costBreakdown, which doesn't produce them, and nothing here reads totals
   beyond the three client figures. */

const SURCHARGE_WORD = {
  weekend: 'Weekend rate',
  holiday: 'Public holiday rate',
  afterHours: 'After hours',
  shortNotice: 'Short notice',
};

const MODE_SENTENCE = {
  higher: 'Where a weekend or holiday rate and after hours overlap, the higher one applies; short notice is applied on top.',
  multiply: 'Where rates overlap they multiply together, short notice included.',
  highest: 'Only the single highest rate applies to any hour, short notice included.',
};

const hrs = (n) => {
  const r = Math.round(n * 100) / 100;
  return r + (r === 1 ? ' hr' : ' hrs');
};
const hrsBare = (n) => hrs(n).replace(/ hrs?$/, '');

/* Minutes after the start date's midnight → '1:00pm'. */
function clockOf(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return clock12(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
}

/* "all of its 8 hrs", "2 of its 8 hrs": the part of the item's covered hours
   a row applied to. With no booked times the item has no hours to divide. */
function shareText(row, line) {
  if (!line.window) return 'the whole day';
  if (row.share >= 1 - 1e-9) return 'all of its ' + hrs(line.coveredHours);
  return hrsBare(row.hours) + ' of its ' + hrs(line.coveredHours);
}

const multText = (m) => '&times;' + String(Math.round(m * 1000) / 1000);
const perHour = (n) => fmt(n) + '/hr';

function cbRow(label, detail, amount, opts) {
  const o = opts || {};
  const weight = o.strong ? 700 : o.muted ? 400 : 600;
  const colour = o.muted ? '#555' : '#181818';
  const pad = o.indent === 2 ? '28px' : o.indent ? '14px' : '0';
  /* data-cb says what a row is to anyone adding the page up (the tests do):
     'item' rows sum to the 'total' row; a 'subtotal' repeats items above it;
     a 'note' carries no amount. */
  return '<tr data-cb="' + (o.kind || 'item') + '">' +
    '<td style="padding:6px 0 6px ' + pad + ';font-size:10pt;font-weight:' + weight + ';color:' + colour + ';border-bottom:1px solid #f0f0f0">' +
      label + (detail ? ' <span style="font-weight:400;color:#888">&middot; ' + detail + '</span>' : '') + '</td>' +
    '<td style="padding:6px 0;font-size:10pt;text-align:right;white-space:nowrap;font-weight:' + weight + ';color:' + colour + ';border-bottom:1px solid #f0f0f0">' +
      (o.kind === 'note' ? '' : amount < 0 ? '-' + fmt(-amount) : (o.plus ? '+' : '') + fmt(amount)) + '</td></tr>';
}

const cbNote = (text, indent) => cbRow('<span style="font-weight:400;color:#888;font-size:9pt">' + text + '</span>', '', 0, { kind: 'note', indent });

function cbBlock(title, rowsHtml, intro) {
  if (!rowsHtml) return '';
  return '<div style="margin-bottom:22px"><div class="sh">' + title + '</div>' + (intro || '') +
    '<table style="width:100%;border-collapse:collapse"><tbody>' + rowsHtml + '</tbody></table></div>';
}

/* What a production item covers, said once above its rates: why a long day's
   extra hours carry no surcharge, and where the hours after midnight went. */
function coverNote(line, day) {
  if (!line.window) return '';
  const span = clockOf(line.window.start) + '–' + clockOf(line.window.end) + (line.window.end > 1440 ? ' (into the next day)' : '');
  const shorter = day.bookedHours > line.coveredHours + 1e-9;
  if (!line.surcharges.length && !shorter) return '';
  return cbNote('Covers ' + span + ': ' + hrs(line.coveredHours) + ' from the ' + clockOf(line.window.start) + ' start' +
    (shorter ? ', of the ' + hrs(day.bookedHours) + ' booked. The rest of the booking carries no day or time rate' : '') + '.', 1);
}

/* One of an item's own rate rows. A carry-over row is the part of the item
   after midnight on a date with another status: its own sub-line, naming the
   date and the rate it changes to (2026-10-02, the user's design). */
function rateRow(r, line) {
  if (r.carry) {
    const hourly = line.coveredHours > 0 ? line.base / line.coveredHours : 0;
    const change = hourly > 0 ? ', ' + perHour(hourly) + ' &rarr; ' + perHour(hourly * r.multiplier) : '';
    return cbRow('Carry-over into ' + esc(dayDate(line.carryDate)) + ': ' + SURCHARGE_WORD[r.type].toLowerCase() + ' ' + multText(r.multiplier),
      hrsBare(r.hours) + ' of its ' + hrs(line.coveredHours) + ', after midnight' + change, r.amount, { indent: 2, muted: true, plus: true });
  }
  return cbRow(SURCHARGE_WORD[r.type] + ' ' + multText(r.multiplier), shareText(r, line), r.amount, { indent: 1, muted: true, plus: true });
}

/* "Day total": the day's items at the standard rate plus their own rates.
   Short notice is one row for the whole estimate, so it isn't in here. */
function dayTotalBeforeShortNotice(day) {
  let cents = 0;
  day.lines.forEach((l) => {
    cents += Math.round(l.base * 100);
    l.surcharges.forEach((r) => { cents += Math.round(r.amount * 100); });
  });
  return cents / 100;
}

/* The figures for an estimate's Cost Breakdown, from calc.js. */
function breakdownOf(estimate, pricing) {
  return costBreakdown(estimate.activeRows, pricing, {
    days: estimate.days,
    surcharges: estimate.surcharges,
    shortNotice: estimate.shortNotice === true,
    totals: estimate.totals,
    gstFree: estimate.gstFree === true,
  });
}

/**
 * Why this estimate's Cost Breakdown can't be made, or null. Its stored totals
 * no longer match its lines (an estimate saved by an older build): printing it
 * would have to call the gap "rounding", on a document that may go to the
 * client. A re-save brings the two back together.
 */
function costBreakdownBlocker(estimate, pricing) {
  if (!breakdownOf(estimate, pricing).stale) return null;
  return {
    error: 'breakdown_stale',
    message: 'This estimate’s saved total doesn’t match its items — it was last saved by an older version. ' +
      'Open it, check it and save it again, then download the Cost Breakdown.',
  };
}

function buildCostBreakdownHtml(estimate, pricing, settings) {
  const client = estimate.client || {};
  const business = (settings && settings.business) || {};
  const labourSections = (pricing && pricing.labourSections) || [];
  const treatment = gstTreatment(estimate.totals, estimate);
  const b = breakdownOf(estimate, pricing);

  let daysHtml = '';
  b.days.forEach((day) => {
    const meta = [STATUS_WORD[day.status] || 'Proposed', dayTimes(day)].filter(Boolean).join(' &middot; ');
    daysHtml +=
      '<tr data-cb="note"><td colspan="2" style="padding:12px 0 4px;font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#B85444;font-weight:700">' +
        esc(dayDate(day.date)) + ' <span style="text-transform:none;letter-spacing:0;font-weight:400;color:#555">&middot; ' + meta + '</span></td></tr>';
    if (!day.lines.length) {
      daysHtml += cbNote('No items on this day.');
      return;
    }
    day.lines.forEach((l) => {
      daysHtml += cbRow(esc(l.name), esc(qtyText(l.qty, l.unit)) + ', standard rate', l.base) +
        coverNote(l, day) +
        l.surcharges.map((r) => rateRow(r, l)).join('');
    });
    if (day.lines.some((l) => l.surcharges.length)) {
      daysHtml += cbRow('Day total', 'before short notice', dayTotalBeforeShortNotice(day), { strong: true, kind: 'subtotal' });
    }
  });

  /* The explanation the owner asked for (2026-10-02): how day and time rates
     are worked out, in the estimate's own settings, for a client who asks. */
  const s = b.settings;
  const intro = b.days.length && s
    ? '<div style="font-size:9pt;color:#555;line-height:1.6;margin-bottom:10px">' +
      'Each item&rsquo;s day and time rates apply to the hours it covers, counted from the day&rsquo;s booked start: ' +
      'an 8-hour item booked from 9:00am covers 9:00am&ndash;5:00pm. Booked hours beyond an item&rsquo;s length carry no ' +
      'rate of their own; extra time on the day is billed as overtime. After hours is any time outside ' +
      esc(clock12(s.officeStart)) + '&ndash;' + esc(clock12(s.officeEnd)) + ', on any day. Hours after midnight take the next ' +
      'date&rsquo;s rate, shown as a carry-over. ' + MODE_SENTENCE[s.mode] + '</div>'
    : '';

  const shortNoticeHtml = b.shortNotice
    ? cbRow(SURCHARGE_WORD.shortNotice + ' ' + multText(b.shortNotice.multiplier),
      'booked at short notice, on ' + b.shortNotice.items + ' production ' + (b.shortNotice.items === 1 ? 'item' : 'items'),
      b.shortNotice.amount, { plus: true })
    : '';

  const labels = {};
  sectionsFor(estimate.activeRows, labourSections, estimate.sectionLabels).forEach((sec) => { labels[sec.id] = sec.label; });
  const sectionsHtml = b.sections.map((sec) =>
    cbBlock(esc(labels[sec.id] || 'Archived Services') + (sec.id === 'prod' ? ' (not on a day)' : ''),
      sec.lines.map((l) => cbRow(esc(l.name), esc(qtyText(l.qty, l.unit)) + (sec.id === 'prod' ? ', standard rate' : ''), l.amount)).join(''))
  ).join('');

  const travelHtml = cbBlock('Travel &amp; Accommodation', b.travel.map((l) =>
    cbRow(esc(l.name), l.directCost ? '' : l.perKm ? esc(l.qty + ' km') : esc(String(l.qty)), l.amount)).join(''));
  const atCost = (title, list) => cbBlock(title, list.map((l) =>
    cbRow(esc(l.name), esc(l.days + (Number(l.days) === 1 ? ' day' : ' days') + ' at ') + fmt(l.cost), l.amount)).join(''));

  const itemsLabel = treatment === 'taxable'
    ? (b.linesIncludeGst ? 'Items total (inc. GST)' : 'Items total (ex GST)')
    : 'Items total';
  // Only ever cents: a bigger gap is refused (costBreakdownBlocker).
  const roundingHtml = b.adjustment !== 0
    ? cbRow('Rounding', 'each line above is shown to the cent', b.adjustment, { muted: true })
    : '';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + PDF_STYLE + '</style></head><body>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #181818">' +
      '<div><div style="font-size:22pt;font-weight:900;letter-spacing:.02em">LSC CREATIVE<span style="color:#B85444">.</span></div>' +
      '<div style="font-size:8pt;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-top:4px">Motion Productions</div>' +
      sellerHtml(business) + '</div>' +
      '<div style="text-align:right"><div style="font-size:16pt;font-weight:900;color:#181818;letter-spacing:.02em">COST BREAKDOWN</div>' +
      '<div style="font-size:13pt;font-weight:700;color:#B85444;letter-spacing:.04em;margin-top:2px">' + esc(estimate.upid || '—') + '</div>' +
      '<div style="font-size:9pt;color:#888;margin-top:2px">' + esc(estimate.date || '') + '</div>' +
      '<div style="font-size:15pt;font-weight:800;color:#181818;margin-top:6px">' + esc(estimate.name) + '</div>' +
      (client.businessName ? '<div style="font-size:10pt;color:#555;margin-top:3px;font-weight:500">' + esc(client.businessName) + '</div>' : '') +
      '</div></div>' +
    '<div style="font-size:10pt;color:#555;margin-bottom:22px;line-height:1.6">How the price of this estimate is made up: each production day&rsquo;s items at the standard rate, then any rate for the day or time they&rsquo;re booked, then everything else.</div>' +
    cbBlock('Production Days', daysHtml, intro) +
    cbBlock('Short Notice', shortNoticeHtml) +
    sectionsHtml +
    travelHtml +
    atCost('Equipment Hire', b.equip) +
    atCost('External Crew &amp; Contracts', b.crew) +
    '<div style="margin-bottom:22px"><table style="width:100%;border-collapse:collapse"><tbody>' +
      roundingHtml +
      cbRow(itemsLabel, '', b.target, { strong: true, kind: 'total' }) +
    '</tbody></table></div>' +
    '<div style="margin-bottom:28px">' +
      totalsBoxHtml('Total', estimate.totals, treatment) +
      '<div style="margin-top:10px;font-size:8.5pt;color:#aaa">' + gstNote(treatment, 'estimate') + '</div></div>' +
    '</body></html>';
}

/** `Cost Breakdown_<UPID>_<ProjectName>.pdf` (D8), filesystem-safe. */
function costBreakdownFilename(estimate) {
  const base = 'Cost Breakdown_' + (estimate.upid || 'EST') + '_' + (estimate.name || 'Estimate');
  return base.replace(/[/\\:*?"<>|]/g, '-').trim() + '.pdf';
}

/** Picks the quote or invoice template by the estimate's `docType`. */
function buildEstimateHtml(estimate, pricing, settings) {
  return estimate.docType === 'invoice'
    ? buildInvoiceHtml(estimate, pricing, settings)
    : buildQuoteHtml(estimate, pricing, (settings && settings.business) || {});
}

/**
 * Why this estimate can't be exported yet, or null if it can. A tax invoice
 * without the seller's ABN isn't a valid tax invoice — the client can't claim
 * the GST back on it — so refusing is better than issuing one.
 */
function exportBlocker(estimate, settings) {
  const business = (settings && settings.business) || {};
  if (estimate.docType === 'invoice' && gstTreatment(estimate.totals, estimate) === 'taxable' && !String(business.abn || '').trim()) {
    return {
      error: 'abn_required',
      message: 'This invoice charges GST, so it has to show your ABN. Add it in Invoice Settings, then export again.',
    };
  }
  return null;
}

/**
 * A filesystem-safe export filename, following the desktop app's
 * `prefix - business - name` convention from `doExport` in the old client.
 */
function exportFilename(estimate) {
  const isInvoice = estimate.docType === 'invoice';
  const prefix = isInvoice ? (estimate.invoiceNumber || 'INV') : (estimate.upid || 'EST');
  const business = (estimate.client && estimate.client.businessName) || 'Client';
  const base = prefix + ' - ' + business + ' - ' + estimate.name;
  return base.replace(/[/\\:*?"<>|]/g, '-').trim() + '.pdf';
}

let executablePathCache;

/**
 * Where headless Chromium lives. `PUPPETEER_EXECUTABLE_PATH` covers the
 * container (set in the Dockerfile, pointing at the apt-installed
 * `chromium` package) — the macOS fallback is only so this runs un-configured
 * on a dev machine.
 */
function resolveExecutablePath() {
  if (executablePathCache !== undefined) return executablePathCache;
  const fs = require('fs');
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  executablePathCache = candidates.find((p) => fs.existsSync(p)) || null;
  return executablePathCache;
}

/** Renders one HTML document to a PDF buffer via headless Chromium. */
async function renderPdfBuffer(html) {
  const executablePath = resolveExecutablePath();
  if (!executablePath) {
    const err = new Error('no Chromium executable found for PDF rendering');
    err.code = 'pdf_unavailable';
    throw err;
  }

  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}

module.exports = {
  buildEstimateHtml,
  buildCostBreakdownHtml,
  costBreakdownBlocker,
  exportBlocker,
  exportFilename,
  costBreakdownFilename,
  renderPdfBuffer,
  resolveExecutablePath,
  PROPOSED_DISCLAIMER,
};
