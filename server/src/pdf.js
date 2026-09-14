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
const { gstTreatment } = require('./calc');

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

function serviceItemsHtml(activeRows, labourSections, sectionLabels) {
  const ar = activeRows || {};
  let html = '';

  sectionsFor(ar, labourSections, sectionLabels).forEach((sec) => {
    const rows = (ar[sec.id] || []).filter((s) => (s.qty || 0) > 0);
    if (!rows.length) return;
    html += '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0">' +
      '<div style="font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#B85444;font-weight:700;margin-bottom:5px">' + esc(sec.label) + '</div>';
    rows.forEach((s) => {
      html += '<div style="font-size:10.5pt;font-weight:600;color:#181818;margin-bottom:3px">' + esc(s.name) + '</div>';
    });
    html += '</div>';
  });

  const eqActive = (ar.equip || []).filter((e) => e.vendor || (e.days && e.cost));
  if (eqActive.length) {
    html += '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0"><div style="font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#B85444;font-weight:700;margin-bottom:5px">Equipment Hire</div>' +
      eqActive.map((e) => '<div style="font-size:10pt;color:#181818;margin-bottom:2px">' + esc(e.vendor || 'Equipment') + '</div>').join('') + '</div>';
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

function buildQuoteHtml(estimate, labourSections, business) {
  const client = estimate.client || {};
  const serviceItems = serviceItemsHtml(estimate.activeRows, labourSections, estimate.sectionLabels);
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
    '<div style="margin-bottom:28px"><div class="sh">What Goes Into This Project</div>' + serviceItems + '</div>' +
    '<div style="margin-bottom:28px"><div class="sh">Your Investment</div>' +
      totalsBoxHtml('Total Investment', estimate.totals, treatment) +
      '<div style="margin-top:10px;font-size:8.5pt;color:#aaa">' + gstNote(treatment, 'quote') + ' Quote valid for 30 days from issue date.</div></div>' +
    '<div style="margin-top:36px;padding-top:20px;border-top:1px solid #e8e8e8">' +
      '<div style="font-size:10.5pt;color:#333;line-height:2.1">If you have any questions or want to chat through this estimate, please reach out.<br><br>' +
      '<strong>Lachlan Sullivan-Carey</strong><br>lachlan@creativelsc.com<br>04 12 710 836</div>' +
    '</div></body></html>';
}

function buildInvoiceHtml(estimate, labourSections, settings) {
  const client = estimate.client || {};
  const serviceItems = serviceItemsHtml(estimate.activeRows, labourSections, estimate.sectionLabels);
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
    '<div style="margin-bottom:28px"><div class="sh">What Goes Into This Project</div>' + serviceItems + '</div>' +
    '<div style="margin-bottom:0"><div class="sh">Invoice Total</div>' +
      totalsBoxHtml('Total Due', estimate.totals, treatment) +
      '<div style="margin-top:10px;font-size:8.5pt;color:#aaa">' + gstNote(treatment, 'invoice') + '</div></div>' +
    payBlock +
    '</body></html>';
}

/** Picks the quote or invoice template by the estimate's `docType`. */
function buildEstimateHtml(estimate, pricing, settings) {
  const labourSections = (pricing && pricing.labourSections) || [];
  return estimate.docType === 'invoice'
    ? buildInvoiceHtml(estimate, labourSections, settings)
    : buildQuoteHtml(estimate, labourSections, (settings && settings.business) || {});
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

module.exports = { buildEstimateHtml, exportBlocker, exportFilename, renderPdfBuffer, resolveExecutablePath };
