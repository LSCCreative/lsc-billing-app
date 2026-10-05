'use strict';

/**
 * Sent versions and the client's view of them (production-booking task 25;
 * D34, D41, D44; IA "Stage E (v14)").
 *
 * Sending an estimate freezes it as version n of that estimate. Two things are
 * stored: the whole estimate as sent (`snapshot_json`, owner-only, for the
 * folder and for printing the PDF the client was sent) and the client's view
 * (`client_view_json`), built here, once, at send time. A public route only
 * ever reads the client view, plus a state worked out live.
 *
 * THE CLIENT VIEW IS AN ALLOW-LIST. `clientView` names every field it copies;
 * nothing is spread or passed through whole. That is the guard against the
 * internal figures (floors, tax set-aside, take-home, the surcharge snapshot,
 * the Cost Breakdown) reaching a client: they live on `estimate.totals` and
 * `estimate.surcharges`, and neither is ever read here except for the three
 * client-facing totals. test-public.js's leak test holds it to that.
 */

const crypto = require('crypto');
const { newId } = require('./db');
const { gstTreatment } = require('./calc');
const { loadEstimate } = require('./estimate');
const { readDays } = require('./days');
const { readRentals } = require('./rentals');
const { readPricing, readSettings } = require('./ratecard');
const { docSettings } = require('./documents');
const { invoiceJson } = require('./invoices');
const {
  serviceGroups, daysWithItems, qtyText, dayIdsOf, hasProposedDay, PROPOSED_DISCLAIMER,
  buildAgreementHtml, renderPdfBuffer, invoiceTreatment, extraItems, acceptedEstimate,
} = require('./pdf');

/* 32 random bytes, base64url: 43 characters, 256 bits. It travels in the
   page address's fragment, so it never reaches a server log or a Referer. */
const newToken = () => crypto.randomBytes(32).toString('base64url');

const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * What the client page shows for one sent version. Every field is named.
 *
 * Days and their items are the client PDF's (pdf.js daysWithItems): stored,
 * surcharge-folded prices, never re-priced and never explained (D8). Services
 * off a day are the PDF's "What goes into this project" (serviceGroups), as
 * names only.
 *
 * @param {object} estimate  loadEstimate's object, as sent
 * @param {object} pricing   the rate card as sent
 * @param {object} business  settings.business as sent
 * @param {{n:number, issuedOn:string, validUntil:string}} sent
 */
/* The pieces an estimate and an invoice page share, each an allow-list. */
const clientBusiness = (b) => ({ name: str(b && b.name), abn: str(b && b.abn), email: str(b && b.email), phone: str(b && b.phone) });

function clientDeliverables(rows) {
  return (Array.isArray(rows && rows.deliverables) ? rows.deliverables : [])
    .filter((d) => d && str(d.name).trim())
    .map((d) => ({
      name: str(d.name).trim(),
      format: str(d.format),
      duration: str(d.duration),
      qty: Number.isInteger(Number(d.qty)) && Number(d.qty) > 0 ? Number(d.qty) : 1,
    }));
}

const clientDay = (day, items) => ({
  date: day.date || null,
  status: ['confirmed', 'pencilled', 'proposed'].includes(day.status) ? day.status : 'proposed',
  startTime: day.startTime || null,
  endTime: day.endTime || null,
  items: items.map((it) => ({ name: str(it.name), qty: qtyText(it.qty, it.unit), price: money(it.price) })),
});

const clientDays = (estimate, pricing) => daysWithItems(estimate, pricing).map(({ day, items }) => clientDay(day, items));

function clientSections(estimate, pricing) {
  return serviceGroups(estimate.activeRows || {}, (pricing && pricing.labourSections) || [], estimate.sectionLabels, dayIdsOf(estimate))
    .map((g) => ({ label: str(g.label), items: g.items.map((it) => ({ name: str(it.name), tag: str(it.tag) })) }));
}

function clientView(estimate, pricing, business, sent) {
  const client = estimate.client || {};
  const totals = estimate.totals || {};
  return {
    kind: 'estimate',
    version: sent.n,
    upid: str(estimate.upid),
    name: str(estimate.name),
    client: { businessName: str(client.businessName) },
    issuedOn: str(sent.issuedOn),
    validUntil: str(sent.validUntil),
    business: clientBusiness(business),
    deliverables: clientDeliverables(estimate.activeRows),
    days: clientDays(estimate, pricing),
    sections: clientSections(estimate, pricing),
    totals: {
      treatment: gstTreatment(totals, estimate),
      exGst: money(totals.clientPriceExGst),
      gst: money(totals.gst),
      total: money(totals.totalIncGst),
    },
    disclaimer: hasProposedDay(estimate) ? PROPOSED_DISCLAIMER : '',
  };
}

/**
 * Freezes an estimate as its next version (D34): the client view, the
 * snapshot, the link (made on the first send and kept for every later one,
 * IA), and every earlier version in the project superseded. Runs inside the
 * caller's transaction.
 *
 * @returns {{versionId:string, n:number, token:string}}
 */
function freezeVersion(db, estimateId, { issuedOn, validUntil, now }) {
  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  const estimate = loadEstimate(row, readDays(db, row.id), readRentals(db, row.id));
  const pricing = readPricing(db);
  const business = readSettings(db).business || {};
  const n = (db.prepare('SELECT MAX(n) AS n FROM estimate_versions WHERE estimate_id = ?').get(estimateId).n || 0) + 1;
  const token = row.public_token || newToken();
  if (!row.public_token) db.prepare('UPDATE estimates SET public_token = ? WHERE id = ?').run(token, estimateId);

  // The client's link always shows the newest send in the project: an older
  // version, of this estimate or of another in the same project, is superseded.
  db.prepare(`
    UPDATE estimate_versions SET superseded_at = ?
     WHERE superseded_at IS NULL AND estimate_id IN (SELECT id FROM estimates WHERE project_id = ?)
  `).run(now, row.project_id);

  const versionId = newId('ver');
  db.prepare(`
    INSERT INTO estimate_versions (id, estimate_id, n, snapshot_json, client_view_json, sent_at, valid_until)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, estimateId, n,
    JSON.stringify({ estimate, pricing, business }),
    JSON.stringify(clientView(estimate, pricing, business, { n, issuedOn, validUntil })),
    now, validUntil,
  );
  return { versionId, n, token };
}

/**
 * The version a client is looking at for this estimate, while the owner can
 * still change it under them: the newest, on an estimate that is `sent`, with
 * nothing newer sent in the project and the project neither accepted nor
 * declined. Null otherwise (a draft, or a project that has moved on).
 */
function liveVersion(db, estimateId) {
  const row = db.prepare('SELECT id, status, project_id FROM estimates WHERE id = ?').get(estimateId);
  if (!row || row.status !== 'sent') return null;
  const version = db.prepare('SELECT * FROM estimate_versions WHERE estimate_id = ? ORDER BY n DESC LIMIT 1').get(row.id);
  if (!version || version.superseded_at) return null;
  const project = row.project_id
    ? db.prepare('SELECT accepted_at, declined_at FROM projects WHERE id = ?').get(row.project_id)
    : null;
  return project && (project.accepted_at || project.declined_at) ? null : version;
}

/* What a client reads of an estimate: the client view, and the client details
   the quote PDF, the agreement and the invoices print (the contact's name is on
   none of them). */
function clientFacing(estimate, pricing, business, n) {
  const client = { ...(estimate.client || {}) };
  delete client.contactName;
  return JSON.stringify([clientView(estimate, pricing, business, { n, issuedOn: '', validUntil: '' }), client]);
}

/**
 * Whether the estimate as stored now reads differently to the client from
 * `version` (C2, C3; the user's rule of 2026-10-05: a sent quote can't be
 * changed without the client being sent the change). Both sides are read by
 * today's code with the version's own rate card and business details, so only
 * a change to the estimate counts: a renamed rate-card section or new Settings
 * details don't, and neither does anything owner-only (rentals, the surcharge
 * reasons, the contact's name).
 */
function changedSince(db, estimateId, version) {
  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  const snap = JSON.parse(version.snapshot_json);
  const live = loadEstimate(row, readDays(db, row.id), readRentals(db, row.id));
  return clientFacing(live, snap.pricing, snap.business, version.n) !==
    clientFacing(snap.estimate || {}, snap.pricing, snap.business, version.n);
}

/**
 * Each estimate's sent versions, oldest first, for the owner's screens (the
 * folder lists them, D34; the editor warns when editing after a send). No
 * client view and no snapshot: just when, how long for, and whether newer
 * went out since.
 *
 * @returns {Map<string, Array<{n, sentAt, validUntil, supersededAt}>>}
 */
function versionsOf(db, estimateIds) {
  const out = new Map();
  if (!estimateIds.length) return out;
  db.prepare(`
    SELECT estimate_id, n, sent_at, valid_until, superseded_at FROM estimate_versions
     WHERE estimate_id IN (SELECT value FROM json_each(?)) ORDER BY estimate_id, n
  `).all(JSON.stringify(estimateIds)).forEach((v) => {
    if (!out.has(v.estimate_id)) out.set(v.estimate_id, []);
    out.get(v.estimate_id).push({ n: v.n, sentAt: v.sent_at, validUntil: v.valid_until || null, supersededAt: v.superseded_at || null });
  });
  return out;
}

/**
 * Where a client's link stands, worked out now, not stored:
 *
 * - `accepted`: this estimate was accepted.
 * - `declined`: the project, or this estimate, was declined (D22).
 * - `superseded`: something newer was sent in the project (D34), or the
 *   project moved on without this version: another estimate accepted, or a
 *   declined project reopened (its estimates go back to draft until the
 *   owner sends again).
 * - `expired`: past its valid-until date (D44).
 * - `taken`: a proposed day's date has since been confirmed by another live
 *   project (D41). Those days come back marked `unavailable`.
 * - `open`: none of the above; Accept is on offer.
 */
function stateOf(db, row, version, project, today) {
  if (row.status === 'accepted') return 'accepted';
  if ((project && project.declined_at) || row.status === 'declined') return 'declined';
  if (version.superseded_at || row.status !== 'sent' || (project && project.accepted_at)) return 'superseded';
  if (version.valid_until && today > version.valid_until) return 'expired';
  return 'open';
}

const takenSql = `
  SELECT 1 FROM production_days d JOIN estimates e ON e.id = d.estimate_id
   WHERE d.date = ? AND d.status = 'confirmed' AND e.status <> 'declined'
     AND (e.project_id IS NULL OR e.project_id <> ?)
   LIMIT 1`;

/**
 * For the owner (C6): each project's sent quote's proposed dates that another
 * live project has since confirmed, the same test as the client's page (D41,
 * `takenSql`), so the owner learns of it when the client does: their Accept is
 * paused until new dates are sent. Only a quote still with the client (its
 * newest version, on a `sent` estimate, in a project neither accepted nor
 * declined) counts.
 *
 * @param {string|null} projectId  one project, or null for every one
 * @returns {Map<string, Array<{date, upid, name}>>} by project id, dates in order
 */
function takenDays(db, projectId = null) {
  const rows = db.prepare(`
    SELECT e.project_id, json_extract(j.value, '$.date') AS date, o.upid, o.name
      FROM estimates e
      JOIN projects p ON p.id = e.project_id AND p.accepted_at IS NULL AND p.declined_at IS NULL
      JOIN estimate_versions v ON v.estimate_id = e.id AND v.superseded_at IS NULL
       AND v.n = (SELECT MAX(n) FROM estimate_versions x WHERE x.estimate_id = e.id)
      JOIN json_each(v.client_view_json, '$.days') j
      JOIN production_days d ON d.date = json_extract(j.value, '$.date') AND d.status = 'confirmed'
      JOIN estimates o ON o.id = d.estimate_id AND o.status <> 'declined'
       AND (o.project_id IS NULL OR o.project_id <> e.project_id)
     WHERE e.status = 'sent' AND json_extract(j.value, '$.status') = 'proposed'
       AND (? IS NULL OR e.project_id = ?)
     ORDER BY date, o.upid
  `).all(projectId, projectId);
  const out = new Map();
  rows.forEach((r) => {
    if (!out.has(r.project_id)) out.set(r.project_id, []);
    const list = out.get(r.project_id);
    if (!list.some((t) => t.date === r.date)) list.push({ date: r.date, upid: r.upid || '', name: r.name || '' });
  });
  return out;
}

/* The business's date for an instant (as sends.js sydneyDate, which can't be
   required here: sends.js requires this file). */
const sydneyDay = (iso) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso));

/**
 * The client's reply for a link, or null when there is no such link (or it
 * was never sent). Everything comes from the frozen client view; the state,
 * the taken days, the newer link and the FAQ address are the only live parts.
 */
function publicEstimate(db, token, today) {
  // Looked up as given, whatever its length or shape: a malformed token takes
  // the same path as a well-formed wrong one, so the reply can't tell them apart.
  const row = db.prepare('SELECT id, project_id, status FROM estimates WHERE public_token = ?').get(String(token));
  const version = row
    ? db.prepare('SELECT * FROM estimate_versions WHERE estimate_id = ? ORDER BY n DESC LIMIT 1').get(row.id)
    : null;
  if (!version) return null;
  const project = row.project_id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id) : null;
  const view = JSON.parse(version.client_view_json);
  // Versions frozen before contact names left the client view still hold one.
  if (view.client) delete view.client.contactName;
  // And before D103 their disclaimer said "estimate": the words are today's.
  if (view.disclaimer) view.disclaimer = PROPOSED_DISCLAIMER;

  let state = stateOf(db, row, version, project, today);
  if (state === 'open' || state === 'expired') {
    const taken = db.prepare(takenSql);
    let any = false;
    view.days.forEach((d) => {
      if (d.status === 'proposed' && d.date && taken.get(d.date, row.project_id || '')) {
        d.unavailable = true;
        any = true;
      }
    });
    if (any && state === 'open') state = 'taken';
  }

  // Accepted (D18): every dated day is now confirmed, so the page says so
  // rather than showing them as they were sent. Date TBC days are untouched,
  // and the "proposed dates aren't locked in" warning no longer applies.
  if (state === 'accepted') {
    view.days.forEach((d) => {
      if (d.date) d.status = 'confirmed';
    });
    view.disclaimer = '';
  }

  let latestToken = null;
  if (state === 'superseded' && project) {
    const newest = db.prepare(`
      SELECT e.public_token FROM estimate_versions v JOIN estimates e ON e.id = v.estimate_id
       WHERE e.project_id = ? AND v.superseded_at IS NULL AND e.status <> 'declined'
       ORDER BY v.sent_at DESC LIMIT 1
    `).get(project.id);
    if (newest && newest.public_token && newest.public_token !== token) latestToken = newest.public_token;
  }

  return Object.assign(view, {
    state,
    validUntil: version.valid_until || '',
    // An accepted page reads "Accepted 5 October 2026", not its old valid-until (task 33 DR14).
    acceptedOn: state === 'accepted' && project && project.accepted_at ? sydneyDay(project.accepted_at) : '',
    unavailableDays: view.days.filter((d) => d.unavailable).map((d) => d.date),
    latestToken,
    faqUrl: docSettings(readSettings(db)).faqUrl,
    // Whether this version was signed here (task 27): the thank-you then
    // offers the signed agreement. One accepted in the app never was.
    signed: Boolean(db.prepare('SELECT 1 FROM signatures WHERE version_id = ?').get(version.id)),
  });
}

/* "Opened" (D52, IA "The client accepts" 1): logged by the page's GET, which
   only a browser running the page makes, so a mail scanner fetching the link
   logs nothing. At most once a day per sent version: a client reloading or
   coming back to it the same day is one event on Home, not ten. */
const OPENED_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Logs an `opened` activity for the link's newest version, unless one was
 * logged for it in the last day. Returns whether it logged.
 *
 * @param {string} now  ISO time, the activity's `at`
 */
function logOpened(db, token, now) {
  const row = db.prepare('SELECT id, project_id FROM estimates WHERE public_token = ?').get(String(token));
  const version = row
    ? db.prepare('SELECT n FROM estimate_versions WHERE estimate_id = ? ORDER BY n DESC LIMIT 1').get(row.id)
    : null;
  if (!version || !row.project_id) return false;
  const since = new Date(Date.parse(now) - OPENED_EVERY_MS).toISOString();
  const recent = db.prepare(`
    SELECT 1 FROM activity
     WHERE project_id = ? AND kind = 'opened' AND at > ?
       AND json_extract(detail_json, '$.estimateId') = ? AND json_extract(detail_json, '$.version') = ?
     LIMIT 1
  `).get(row.project_id, since, row.id, version.n);
  if (recent) return false;
  db.prepare('INSERT INTO activity (id, project_id, at, kind, detail_json) VALUES (?, ?, ?, ?, ?)')
    .run(newId('act'), row.project_id, now, 'opened', JSON.stringify({ estimateId: row.id, version: version.n }));
  return true;
}

/* A version's quote dates, as its client page shows them (D44, D103). */
function versionDates(version) {
  let view = {};
  try {
    view = JSON.parse(version.client_view_json || '{}') || {};
  } catch (_) {
    view = {}; // an unreadable view still has its valid-until column
  }
  return { issuedOn: str(view.issuedOn), validUntil: str(version.valid_until), version: version.n };
}

/** The version a link's PDF prints: the frozen estimate, rate card and business. */
function publicPdfSource(db, token) {
  const row = db.prepare('SELECT id FROM estimates WHERE public_token = ?').get(String(token));
  const version = row
    ? db.prepare('SELECT n, snapshot_json, client_view_json, valid_until FROM estimate_versions WHERE estimate_id = ? ORDER BY n DESC LIMIT 1').get(row.id)
    : null;
  if (!version) return null;
  const snap = JSON.parse(version.snapshot_json);
  // Printed as the quote it was sent as, whatever its retired doc type (D62).
  return {
    n: version.n,
    estimate: { ...snap.estimate, docType: 'estimate' },
    pricing: snap.pricing,
    business: snap.business || {},
    dates: versionDates(version),
  };
}

const plusDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * The dates the owner's own download of a quote prints (routes/pdf.js). While
 * the newest version sent is still the live one and the estimate hasn't been
 * changed since in anything the client reads, it is that version, so a PDF attached by hand agrees with the
 * client's link. Otherwise it's a quote not yet sent: issued today, valid for
 * the Settings' number of days (D44), with no version number.
 *
 * @param {string} today      'YYYY-MM-DD'
 * @param {number} validDays  documents.js docSettings(...).validDays
 */
function quoteDates(db, estimateId, today, validDays) {
  const row = db.prepare('SELECT id FROM estimates WHERE id = ?').get(estimateId);
  const version = row
    ? db.prepare('SELECT * FROM estimate_versions WHERE estimate_id = ? ORDER BY n DESC LIMIT 1').get(estimateId)
    : null;
  // Edited only where the client would see it (changedSince): a sent quote's
  // own save sends such a change (C2), so this is a draft after a decline or a
  // reopen, or an accepted estimate edited since.
  if (version && !version.superseded_at && !changedSince(db, estimateId, version)) return versionDates(version);
  return { issuedOn: today, validUntil: plusDays(today, validDays), version: null };
}

/**
 * A signature with what its PDF and the folder print: the version's number,
 * the estimate's UPID and project. By the signature's id, or (for a client's
 * link) by the link's newest version.
 */
const SIGNATURE_SQL = `
  SELECT s.*, v.n, v.estimate_id, e.project_id, e.upid FROM signatures s
    JOIN estimate_versions v ON v.id = s.version_id
    JOIN estimates e ON e.id = v.estimate_id`;

function signatureRow(db, id) {
  return db.prepare(SIGNATURE_SQL + ' WHERE s.id = ?').get(String(id)) || null;
}

function signatureOfLink(db, token) {
  return db.prepare(SIGNATURE_SQL + `
     WHERE e.public_token = ?
       AND v.n = (SELECT MAX(n) FROM estimate_versions WHERE estimate_id = e.id)
  `).get(String(token)) || null;
}

/**
 * The signed agreement's PDF bytes (D66). Signing stores them; if the
 * renderer was down then, they're made now from the stored text (which is
 * the record; the PDF is its print) and kept, so the next download is
 * instant and never differs.
 */
async function signaturePdf(db, sig, render = renderPdfBuffer) {
  if (sig.pdf_blob) return Buffer.from(sig.pdf_blob);
  const buffer = await render(buildAgreementHtml(sig));
  db.prepare('UPDATE signatures SET pdf_blob = ? WHERE id = ? AND pdf_blob IS NULL').run(buffer, sig.id);
  return buffer;
}

/* ── Invoices (task 30, D46, IA "Client invoice page") ──────────────────────
   An invoice's page is worked out live, not frozen: an invoice can't change
   once it's sent (D100: it is voided and replaced instead), so its stored
   snapshot and totals are already fixed. What does change is whether it's
   paid, overdue or void.

   THE SNAPSHOT IS OWNER-ONLY. invoiceJson's `estimate` is the whole estimate
   as accepted, its internal totals included; `invoiceView` reads from it only
   what the invoice PDF prints (buildInvoiceDocHtml), field by field. */

const INVOICE_KINDS = ['deposit', 'final', 'single'];
const INVOICE_LIVE = ['scheduled', 'sent', 'paid', 'void'];

/* The invoice behind a link, or null. A draft (a cancelled send leaves its
   link on one) and an old-way invoice have no page. Looked up as given, like
   an estimate's link, so a malformed token takes the same path. */
function invoiceOfLink(db, token) {
  const row = db.prepare('SELECT * FROM invoices WHERE public_token = ?').get(String(token));
  if (!row || !INVOICE_KINDS.includes(row.kind) || !INVOICE_LIVE.includes(row.status)) return null;
  return row;
}

const three = (t) => ({ exGst: money(t && t.clientPriceExGst), gst: money(t && t.gst), total: money(t && t.totalIncGst) });

/**
 * What the client page shows for one invoice. Every field is named.
 *
 * `state`: `paid`, `void`, `overdue` (past its due date, unpaid) or `due`.
 * `due` is the block the invoice asks for (a deposit's own totals, a final's
 * balance, a single's total), as the PDF's dark bar prints it. The bank
 * details go only while there's something to pay, as on the PDF.
 */
function invoiceView(db, row, today) {
  const doc = invoiceJson(db, row);
  const estimate = acceptedEstimate(doc.estimate || {});
  const settings = readSettings(db);
  const client = estimate.client || {};
  const t = doc.totals || {};
  const kind = doc.kind;
  const bill = kind !== 'deposit';
  const treatment = invoiceTreatment(doc);

  let state = 'due';
  if (doc.status === 'paid') state = 'paid';
  else if (doc.status === 'void') state = 'void';
  else if (doc.dueAt && today > doc.dueAt) state = 'overdue';

  let replacement = null;
  if (state === 'void' && doc.replacedBy) {
    const next = db.prepare('SELECT number, status, public_token FROM invoices WHERE id = ?').get(doc.replacedBy.id);
    replacement = {
      number: str(next && next.number),
      // Only a replacement the client can open: a draft has no page yet.
      token: next && next.public_token && INVOICE_LIVE.includes(next.status) ? next.public_token : null,
    };
  }

  const p = settings.payment || {};
  const payable = state === 'due' || state === 'overdue';
  const less = kind === 'final' && t.deposit
    ? { number: str(doc.less && doc.less.number), paid: Boolean(doc.less && doc.less.status === 'paid'), amount: money(t.deposit.totalIncGst) }
    : null;

  return {
    kind: 'invoice',
    invoiceKind: kind,
    number: str(doc.number),
    taxInvoice: treatment === 'taxable',
    state,
    upid: str(estimate.upid),
    name: str(estimate.name),
    client: { businessName: str(client.businessName), abn: str(client.abn) },
    issuedOn: str(doc.issuedAt),
    dueOn: str(doc.dueAt),
    paidOn: state === 'paid' ? str(doc.paidAt) : '',
    business: clientBusiness(settings.business),
    payment: payable
      ? { bankName: str(p.bankName), accountName: str(p.accountName), bsb: str(p.bsb), accountNumber: str(p.accountNumber), terms: str(p.terms) }
      : null,
    // A deposit is a summary (D37): its %, the estimate's total and the days
    // booked, with no items. A final or single bills every item (D35).
    deposit: kind === 'deposit'
      ? { pct: Number(doc.pct) || 0, estimateTotal: money((estimate.totals || t.job || {}).totalIncGst) }
      : null,
    deliverables: bill ? clientDeliverables(estimate.activeRows) : [],
    days: bill
      ? clientDays(estimate, readPricing(db))
      : (estimate.days || []).filter((d) => d && d.id).map((d) => clientDay(d, [])),
    sections: bill ? clientSections(estimate, readPricing(db)) : [],
    extras: bill ? extraItems(doc.extras).map((it) => ({ name: str(it.name), qty: qtyText(it.qty, it.unit), price: money(it.price) })) : [],
    totals: {
      treatment,
      estimateTotal: bill ? money((t.job || {}).totalIncGst) : 0,
      extras: bill ? money((t.extras || {}).totalIncGst) : 0,
      total: bill ? money((t.total || {}).totalIncGst) : 0,
      lessDeposit: less,
      due: three(kind === 'deposit' ? t : kind === 'final' ? t.balance : t.total),
    },
    amountDue: money(doc.amountDue),
    void: state === 'void'
      ? { on: str(doc.voidedAt), reason: str(doc.voidReason), replacement }
      : null,
  };
}

/** The client's reply for an invoice link, or null when it has no page. */
function publicInvoice(db, token, today) {
  const row = invoiceOfLink(db, token);
  return row ? invoiceView(db, row, today) : null;
}

/** The invoice a link's PDF prints (invoiceJson, owner-only: it goes only to
    buildInvoiceDocHtml, never into a reply), or null. */
function publicInvoicePdfSource(db, token) {
  const row = invoiceOfLink(db, token);
  return row ? invoiceJson(db, row) : null;
}

module.exports = {
  publicInvoice, publicInvoicePdfSource, invoiceOfLink,
  newToken, clientView, freezeVersion, liveVersion, changedSince, takenDays, versionsOf, publicEstimate, publicPdfSource, quoteDates, logOpened, OPENED_EVERY_MS,
  signatureRow, signatureOfLink, signaturePdf,
};
