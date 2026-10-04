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
const {
  serviceGroups, daysWithItems, qtyText, dayIdsOf, hasProposedDay, PROPOSED_DISCLAIMER,
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
function clientView(estimate, pricing, business, sent) {
  const client = estimate.client || {};
  const totals = estimate.totals || {};
  const rows = estimate.activeRows || {};
  const b = business || {};
  return {
    kind: 'estimate',
    version: sent.n,
    upid: str(estimate.upid),
    name: str(estimate.name),
    client: { businessName: str(client.businessName), contactName: str(client.contactName) },
    issuedOn: str(sent.issuedOn),
    validUntil: str(sent.validUntil),
    business: { name: str(b.name), abn: str(b.abn), email: str(b.email), phone: str(b.phone) },
    deliverables: (Array.isArray(rows.deliverables) ? rows.deliverables : [])
      .filter((d) => d && str(d.name).trim())
      .map((d) => ({
        name: str(d.name).trim(),
        format: str(d.format),
        duration: str(d.duration),
        qty: Number.isInteger(Number(d.qty)) && Number(d.qty) > 0 ? Number(d.qty) : 1,
      })),
    days: daysWithItems(estimate, pricing).map(({ day, items }) => ({
      date: day.date || null,
      status: ['confirmed', 'pencilled', 'proposed'].includes(day.status) ? day.status : 'proposed',
      startTime: day.startTime || null,
      endTime: day.endTime || null,
      items: items.map((it) => ({ name: str(it.name), qty: qtyText(it.qty, it.unit), price: money(it.price) })),
    })),
    sections: serviceGroups(rows, (pricing && pricing.labourSections) || [], estimate.sectionLabels, dayIdsOf(estimate))
      .map((g) => ({ label: str(g.label), items: g.items.map((it) => ({ name: str(it.name), tag: str(it.tag) })) })),
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
    unavailableDays: view.days.filter((d) => d.unavailable).map((d) => d.date),
    latestToken,
    faqUrl: docSettings(readSettings(db)).faqUrl,
  });
}

/** The version a link's PDF prints: the frozen estimate, rate card and business. */
function publicPdfSource(db, token) {
  const row = db.prepare('SELECT id FROM estimates WHERE public_token = ?').get(String(token));
  const version = row
    ? db.prepare('SELECT n, snapshot_json FROM estimate_versions WHERE estimate_id = ? ORDER BY n DESC LIMIT 1').get(row.id)
    : null;
  if (!version) return null;
  const snap = JSON.parse(version.snapshot_json);
  // Printed as the estimate it was sent as, whatever its retired doc type (D62).
  return { n: version.n, estimate: { ...snap.estimate, docType: 'estimate' }, pricing: snap.pricing, business: snap.business || {} };
}

module.exports = { newToken, clientView, freezeVersion, versionsOf, publicEstimate, publicPdfSource };
