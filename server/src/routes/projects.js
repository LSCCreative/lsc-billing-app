'use strict';

const { newId, nowIso } = require('../db');
const { STAGES, projectStage, settledAt, upidLocked } = require('../projects');
const { readDays } = require('../days');
const { readRentals } = require('../rentals');
const { loadEstimate } = require('../estimate');
const { readSettings } = require('../ratecard');
const { depositAmount, finalInvoiceTotals, singleInvoiceTotals } = require('../calc');
const { amountDue } = require('../invoices');
const { docSettings } = require('../documents');
const { freezeVersion, versionsOf, signatureRow, signaturePdf, takenDays } = require('../public');
const { agreementFilename } = require('../pdf');
const { sendRequest, pendingFor, latestFor, cancelPending, addSend, sydneyDate } = require('../sends');

/* A paid or declined project leaves the Active view this long after it got
   there (IA, Content Growth Plan). Its own chip, and a search, still find it. */
const SETTLED_DAYS = 90;
const PAGE = 50;
const MAX_PAGE = 200;

/* What Home's Recent activity shows (task 22): a job moving on — sent,
   accepted, invoiced, paid, or declined. The owner's corrections (reopened,
   an invoice edited or voided) stay in the folder's log only. Stage E adds
   its client events here: opened (task 26), signed (task 27). */
const HOME_KINDS = ['sent', 'opened', 'accepted', 'signed', 'invoices_created', 'invoice_sent', 'invoice_paid', 'declined'];
const HOME_LIMIT = 10;
const HOME_MAX = 50;

/* A real calendar date: '2026-13-01' and '2026-02-30' are not (an invalid
   Date's toISOString throws, so it is checked first). */
const isYmd = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

function addDays(ymd, n) {
  return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/* The business's date, only for a caller that sends no `today` (the client's
   pages, and the date a client signs on). Sydney's, not the server's: the
   container runs on UTC, which is still yesterday until 10 or 11am there. */
function localToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/* `today` from the query, the server's date when absent, or null when bad. */
function todayOf(req) {
  const today = req.query.today === undefined ? localToday() : String(req.query.today);
  return isYmd(today) ? today : null;
}

function groupBy(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const list = map.get(row[key]);
    if (list) list.push(row);
    else map.set(row[key], [row]);
  });
  return map;
}

const latest = (...values) => values.filter(Boolean).sort().pop() || '';

const parseDetail = (json) => {
  try {
    return JSON.parse(json || '{}') || {};
  } catch (_) {
    return {}; // a bad row reads as one with no detail
  }
};

/* The latest `sent` activity row, as projectStage takes it. */
const sendOf = (row) => {
  if (!row) return undefined;
  const detail = parseDetail(row.detail_json);
  return { at: row.at, version: detail.version, validUntil: detail.validUntil };
};

/* The columns summarize() reads from an estimate. */
const ESTIMATE_COLUMNS = 'id, project_id, upid, name, date, status, client_json, total_inc_gst, updated_at';
const INVOICE_COLUMNS = 'project_id, kind, number, status, due_at, paid_at, updated_at';

/* The first booked date from `today` on. Declined estimates' days are on no
   calendar (D22), so they're no one's next day either. */
const NEXT_DAY_SQL = `
  SELECT e.project_id, d.date, d.status
    FROM production_days d JOIN estimates e ON e.id = d.estimate_id
   WHERE d.date IS NOT NULL AND d.date >= ? AND e.status <> 'declined' AND e.project_id IS NOT NULL`;

/**
 * ONE PROJECT, AS EVERY SCREEN SHOWS IT: the list's card, the client's
 * projects and the folder's Overview are all this, so the three can't
 * disagree (IA, "Stage line (new, one function)").
 *
 * A project's NAME, total and client are its lead estimate's: the one most
 * recently changed that isn't declined. Since v13 a project has one estimate;
 * only a group the fix-up kept together has more (`estimateCount`).
 *
 * `own` are its estimates (ESTIMATE_COLUMNS), `bills` its invoices
 * (INVOICE_COLUMNS), and `ctx` what is read across every project at once:
 * { sent, nextDay, client (the clients row), lastActivityAt }.
 */
function summarize(p, own, bills, ctx) {
  const where = projectStage(p, own, bills, ctx.sent);
  const lead = own.slice().sort((a, b) =>
    (a.status === 'declined') - (b.status === 'declined') ||
    (b.updated_at > a.updated_at) - (b.updated_at < a.updated_at) ||
    (a.id < b.id ? -1 : 1))[0] || null;
  const snapshot = lead ? JSON.parse(lead.client_json || '{}') : {};
  const record = ctx.client || null;
  const { stage, ...stageDetail } = where;
  return {
    id: p.id,
    upid: p.upid,
    needsUpid: p.needs_upid === 1,
    name: lead ? lead.name : '',
    client: {
      id: p.client_id || null,
      businessName: snapshot.businessName || (record && record.business_name) || '',
      contactName: snapshot.contactName || (record && record.contact_name) || '',
    },
    stage,
    stageDetail,
    totalIncGst: lead ? lead.total_inc_gst : 0,
    estimateId: lead ? lead.id : null,
    estimateCount: own.length,
    nextDay: ctx.nextDay || null,
    lastActivityAt: latest(p.updated_at, ...own.map((e) => e.updated_at),
      ...bills.map((i) => i.updated_at), ctx.lastActivityAt),
  };
}

/**
 * The project folder in one read (task 18; IA "Project folder"): the summary
 * every screen shares, plus what only the folder shows — each estimate whole
 * (days and rentals included, lead first), the invoices, and the activity log,
 * newest first. Null when there is no such project.
 */
function readFolder(db, id, today) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) return null;
  const own = db.prepare(`SELECT ${ESTIMATE_COLUMNS} FROM estimates WHERE project_id = ?`).all(id);
  const bills = db.prepare(`
    SELECT * FROM invoices WHERE project_id = ?
     ORDER BY CASE kind WHEN 'deposit' THEN 0 WHEN 'final' THEN 1 WHEN 'single' THEN 2 ELSE 3 END, created_at, id
  `).all(id);
  const log = db.prepare('SELECT * FROM activity WHERE project_id = ? ORDER BY at DESC, id DESC').all(id);
  const next = db.prepare(NEXT_DAY_SQL + ' AND e.project_id = ? ORDER BY d.date, d.start_time, d.id LIMIT 1')
    .get(today, id);
  const project = summarize(p, own, bills, {
    sent: sendOf(log.find((a) => a.kind === 'sent')),
    nextDay: next ? { date: next.date, status: next.status } : null,
    client: p.client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(p.client_id) : null,
    lastActivityAt: log.length ? log[0].at : null,
  });
  Object.assign(project, {
    acceptedAt: p.accepted_at || null,
    declinedAt: p.declined_at || null,
    invoicing: p.invoicing || null,
    depositPct: p.deposit_pct === null || p.deposit_pct === undefined ? null : p.deposit_pct,
    // What Mark accepted's deposit % starts at (D33).
    depositPctDefault: depositPctFor(db, p),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  });
  project.upidLocked = upidLocked(db, id);
  // Proposed dates on the quote the client has that another project has since confirmed (C6).
  project.takenDays = takenDays(db, id).get(id) || [];
  const rows = db.prepare('SELECT * FROM estimates WHERE project_id = ?').all(id);
  const flags = rebookFlags(db, rows.map((r) => r.id));
  const sent = versionsOf(db, rows.map((r) => r.id));
  // Each document's newest email (task 29): the rows' "Scheduled Tue 9:00".
  const estimateSends = latestFor(db, 'estimate', rows.map((r) => r.id));
  const invoiceSends = latestFor(db, 'invoice', bills.map((i) => i.id));
  const estimates = rows
    .map((row) => {
      const estimate = loadEstimate(row, readDays(db, row.id), readRentals(db, row.id));
      estimate.upidLocked = project.upidLocked;
      // Owner-only: the client's link (stage E) and what was sent of this one.
      estimate.publicToken = row.public_token || null;
      estimate.versions = sent.get(row.id) || [];
      estimate.send = estimateSends.get(row.id) || null;
      // What bills it (C11), as GET /api/estimates/:id has it: the editor says an edit won't reach them.
      estimate.invoices = bills.filter((i) => i.estimate_id === row.id && i.kind !== 'legacy' && i.status !== 'void')
        .map((i) => ({ number: i.number, kind: i.kind, status: i.status }));
      estimate.days.forEach((d) => {
        if (flags.has(d.id)) d.rebook = flags.get(d.id);
      });
      return estimate;
    })
    .sort((a, b) => (a.id === project.estimateId ? -1 : b.id === project.estimateId ? 1 : 0) ||
      (b.updatedAt > a.updatedAt) - (b.updatedAt < a.updatedAt));
  return {
    project,
    estimates,
    invoices: bills.map((i) => ({
      id: i.id,
      kind: i.kind,
      number: i.number || null,
      status: i.status,
      estimateId: i.estimate_id || null,
      pct: i.pct === null ? null : i.pct,
      amountDue: amountDue(i.kind, parseDetail(i.totals_json)),
      issuedAt: i.issued_at || null,
      dueAt: i.due_at || null,
      paidAt: i.paid_at || null,
      paidVia: i.paid_via || null,
      // Void and remake (task 20, D100): the void date and why, the one it
      // replaced, and the deposit a final takes off.
      voidedAt: i.voided_at || null,
      voidReason: i.void_reason || null,
      replacesId: i.replaces_id || null,
      lessInvoiceId: i.less_invoice_id || null,
      // Its client page (task 30), made the first time it's sent, and its newest email.
      publicToken: i.public_token || null,
      send: invoiceSends.get(i.id) || null,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    })),
    activity: log.map((a) => ({ id: a.id, at: a.at, kind: a.kind, detail: parseDetail(a.detail_json) })),
    // Signed service agreements (task 27, D42): who, when and which version;
    // the PDF opens through GET …/agreements/:id/pdf.
    signatures: db.prepare(`
      SELECT s.id, s.full_name, s.role, s.signed_at, v.n, v.estimate_id FROM signatures s
        JOIN estimate_versions v ON v.id = s.version_id
        JOIN estimates e ON e.id = v.estimate_id
       WHERE e.project_id = ? ORDER BY s.signed_at DESC, s.id
    `).all(id).map((s) => ({
      id: s.id, estimateId: s.estimate_id, version: s.n, fullName: s.full_name, role: s.role, signedAt: s.signed_at,
    })),
  };
}

/**
 * The "clash, rebook" days among these estimates' (D18): flagged when an
 * accept confirmed them on a date another project had confirmed first, and
 * shown only while that is still so. If the other project is declined or
 * moves its day, the clash is over and the flag says nothing, though it stays
 * stored: should that project come back, so does the clash.
 *
 * @returns {Map<string, {upid, name}>} day id → who has the date.
 */
function rebookFlags(db, estimateIds) {
  const out = new Map();
  if (!estimateIds.length) return out;
  const ids = JSON.stringify(estimateIds);
  const flagged = db.prepare(`
    SELECT id, date FROM production_days
     WHERE estimate_id IN (SELECT value FROM json_each(?)) AND rebook = 1 AND date IS NOT NULL
  `).all(ids);
  const holder = confirmedHolder(db);
  flagged.forEach((d) => {
    const hit = holder.get(d.date, ids);
    if (hit) out.set(d.id, { upid: hit.upid || '', name: hit.name || '' });
  });
  return out;
}

/* Another live project's confirmed day on a date: `.get(date, ownIdsJson)`. */
function confirmedHolder(db) {
  return db.prepare(`
    SELECT e.upid, e.name FROM production_days d JOIN estimates e ON e.id = d.estimate_id
     WHERE d.date = ? AND d.status = 'confirmed' AND e.status <> 'declined'
       AND d.estimate_id NOT IN (SELECT value FROM json_each(?))
     ORDER BY e.upid, e.id LIMIT 1
  `);
}

function logActivity(db, projectId, kind, detail, now) {
  db.prepare('INSERT INTO activity (id, project_id, at, kind, detail_json) VALUES (?, ?, ?, ?, ?)')
    .run(newId('act'), projectId, now, kind, JSON.stringify(detail || {}));
}

/* ── Saving a changed sent quote (task 33 C2, C3) ──────────────────────────
   The user's rule (2026-10-05): a quote the client has can't be changed
   without the client being sent the change. So the estimate's save
   (routes/estimates.js PUT) that changes what the client reads (public.js
   changedSince) also freezes it as the next version and emails a "Quote
   update", in the save's own transaction. The live estimate then never
   differs from the version the client is looking at, so a signature and Mark
   accepted bill, and confirm the days of, the same thing. */

/* The scheduled email of this estimate not yet gone, or null. */
const waitingEmail = (db, estimateId) => db.prepare(`
  SELECT * FROM sends WHERE doc_kind = 'estimate' AND purpose = 'document' AND status = 'scheduled' AND doc_id = ?
   ORDER BY scheduled_for LIMIT 1
`).get(estimateId) || null;

/**
 * What the editor's "Save and send" dialog needs, answered with 409
 * `resend_required` when a save would change a sent quote and didn't say how
 * to send the change.
 */
function resendNeeded(db, estimateId, version, today, emailReady) {
  const row = db.prepare('SELECT client_json FROM estimates WHERE id = ?').get(estimateId);
  const lastEmail = db.prepare(`
    SELECT to_email FROM sends WHERE doc_kind = 'estimate' AND purpose = 'document' AND doc_id = ? AND to_email <> ''
     ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(estimateId);
  const waiting = waitingEmail(db, estimateId);
  const validDays = docSettings(readSettings(db)).validDays;
  return {
    error: 'resend_required',
    message: `Your client has v${version.n} of this quote. Saving a change sends them the update.`,
    version: version.n,
    to: (lastEmail && lastEmail.to_email) || String((parseDetail(row.client_json).email) || '').trim(),
    emailReady: Boolean(emailReady),
    waiting: waiting ? { scheduledFor: waiting.scheduled_for, to: waiting.to_email } : null,
    // The version's own date while it hasn't passed; else a fresh term from today.
    validUntil: version.valid_until && version.valid_until >= today ? version.valid_until : addDays(today, validDays),
  };
}

/**
 * Reads the save's `resend` ({ by: 'email', to, message?, validUntil } or
 * { by: 'link', validUntil }). Sent now: an update isn't scheduled.
 *
 * @returns {{by, to, message, validUntil}|{status, body}}
 */
function updateRequest(resend, today, emailReady, now) {
  const ask = sendRequest({ ...(resend || {}), scheduledFor: undefined }, now);
  if (ask.error) return { status: 400, body: ask };
  if (ask.by === 'email' && !emailReady) {
    return { status: 409, body: { error: 'not_configured', message: 'Email isn’t set up yet. Update the page only, and send the link yourself.' } };
  }
  const validUntil = resend.validUntil;
  if (!isYmd(validUntil) || validUntil < today) {
    return { status: 400, body: { error: 'valid_until_invalid', message: 'Valid until can’t be before today.' } };
  }
  return { by: ask.by, to: ask.to, message: ask.message, validUntil };
}

/**
 * Inside the save's transaction, after the estimate is written: the next
 * version, and the email. An email of the quote still waiting to go carries
 * the new version instead (its link opens the newest anyway), so a second one
 * isn't queued.
 *
 * @returns {{versionId, n, token, carried:boolean}}
 */
function sendUpdate(db, estimateId, ask, today, now) {
  const row = db.prepare('SELECT project_id FROM estimates WHERE id = ?').get(estimateId);
  const waiting = waitingEmail(db, estimateId);
  const made = freezeVersion(db, estimateId, { issuedOn: today, validUntil: ask.validUntil, now });
  if (waiting) {
    db.prepare('UPDATE sends SET version_id = ?, updated_at = ? WHERE id = ?').run(made.versionId, now, waiting.id);
  } else if (ask.by === 'email') {
    addSend(db, {
      docKind: 'estimate', docId: estimateId, versionId: made.versionId, toEmail: ask.to, message: ask.message,
      scheduledFor: now,
    }, now);
  }
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, row.project_id);
  logActivity(db, row.project_id, 'sent', {
    validUntil: ask.validUntil, estimateId, version: made.n, update: true,
    ...(waiting
      ? { by: 'email', to: waiting.to_email, scheduledFor: waiting.scheduled_for, carried: true }
      : { by: ask.by, ...(ask.by === 'email' ? { to: ask.to } : {}) }),
  }, now);
  return { ...made, carried: Boolean(waiting) };
}

/* Where a project is, for the actions' own checks: the same projectStage. */
function stageNow(db, p) {
  const own = db.prepare(`SELECT ${ESTIMATE_COLUMNS} FROM estimates WHERE project_id = ?`).all(p.id);
  const bills = db.prepare(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE project_id = ?`).all(p.id);
  return { stage: projectStage(p, own, bills).stage, own, bills };
}

/* Every date another project has confirmed under one of these days, unless
   the day carries a specification note (D16) — the lock lockedDay applies to
   a new day, run over each one, so a refusal can name them all. */
function lockedDates(db, estimateIds) {
  const days = db.prepare(`
    SELECT d.id, d.estimate_id, d.date FROM production_days d
     WHERE d.estimate_id IN (SELECT value FROM json_each(?)) AND d.date IS NOT NULL AND d.override_note = ''
     ORDER BY d.date, d.id
  `).all(JSON.stringify(estimateIds));
  const holder = db.prepare(`
    SELECT e.upid, e.name, d.status FROM production_days d JOIN estimates e ON e.id = d.estimate_id
     WHERE d.date = ? AND d.status = ? AND e.status <> 'declined'
       AND d.estimate_id NOT IN (SELECT value FROM json_each(?))
     ORDER BY e.upid, e.id LIMIT 1
  `);
  const ids = JSON.stringify(estimateIds);
  const out = { confirmed: [], pencilled: [] };
  const seen = new Set();
  days.forEach((d) => {
    if (seen.has(d.date)) return;
    seen.add(d.date);
    const hit = holder.get(d.date, 'confirmed', ids);
    if (hit) return out.confirmed.push({ date: d.date, upid: hit.upid || '', name: hit.name || '' });
    const soft = holder.get(d.date, 'pencilled', ids);
    if (soft) out.pencilled.push({ date: d.date, upid: soft.upid || '', name: soft.name || '' });
  });
  return out;
}

const whoHas = (c) => c.upid || (c.name ? `“${c.name}”` : 'another project');

/* The deposit % a project would be accepted at (D33): its own, if one was set
   before acceptance; else the setting (settings.invoicing.depositPct, task 21);
   else 50 (documents.js docSettings). */
function depositPctFor(db, p) {
  const valid = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100;
  if (valid(p.deposit_pct)) return p.deposit_pct;
  return docSettings(readSettings(db)).depositPct;
}

/**
 * Pair or single, and at what deposit %, from an accept or invoices body:
 * `{ invoicing: 'pair' | 'single', depositPct }`. Both may be left out: a
 * pair (D32) at the project's deposit % (depositPctFor). A pair's % must be
 * above 0 and at most 100 (a 0% deposit is a single invoice); a single
 * invoice has none.
 *
 * @returns {{invoicing:string, pct:number|null}|{error:string, message:string}}
 */
function invoicingChoice(db, p, body) {
  const invoicing = body.invoicing === undefined ? 'pair' : body.invoicing;
  if (invoicing !== 'pair' && invoicing !== 'single') {
    return { error: 'invoicing_invalid', message: 'Choose a deposit + final pair or a single invoice.' };
  }
  if (invoicing === 'single') return { invoicing, pct: null };
  const given = body.depositPct;
  const pct = given === undefined || given === null || given === '' ? depositPctFor(db, p) : Number(given);
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return { error: 'deposit_pct_invalid', message: 'The deposit must be more than 0% and at most 100%.' };
  }
  return { invoicing, pct };
}

/* The numbers a choice makes (D36): INV-<UPID>-D and -F, or INV-<UPID>. */
function invoiceNumbers(upid, invoicing) {
  return invoicing === 'single'
    ? [{ kind: 'single', number: `INV-${upid}` }]
    : [{ kind: 'deposit', number: `INV-${upid}-D` }, { kind: 'final', number: `INV-${upid}-F` }];
}

/**
 * Why this project can't be invoiced yet, as a reply; or null. Invoice
 * numbers carry the UPID (D36), so a project waiting for the fix-up, or with
 * no UPID typed, can't have one; nor can a number another invoice already
 * holds (a UPID like "ABC-D" would make INV-ABC-D, project ABC's deposit).
 */
function cannotInvoice(db, p, numbers) {
  if (p.needs_upid === 1) {
    return { error: 'needs_upid', message: 'This project needs its own UPID before it can be invoiced. Fix it first.' };
  }
  if (!p.upid) {
    return { error: 'upid_missing', message: 'Give the estimate a UPID first: invoice numbers carry it.' };
  }
  const taken = db.prepare(`
    SELECT number FROM invoices WHERE number = ? COLLATE NOCASE AND kind <> 'legacy' LIMIT 1
  `);
  const hit = numbers.find((n) => taken.get(n.number));
  if (hit) {
    return { error: 'invoice_number_taken', number: hit.number, message: `${hit.number} is already another invoice’s number.` };
  }
  return null;
}

/**
 * Makes the invoices for an accepted estimate (D32–D37), inside the caller's
 * transaction. Returns them as { id, kind, number }.
 *
 * Each invoice keeps a SNAPSHOT of the estimate as it was accepted (rows,
 * labels, client, days and stored totals — owner-only, like the estimate
 * itself), so editing the estimate later can't move an invoice. The amounts
 * are task 14's, from the estimate's stored totals, never repriced:
 *   - deposit: depositAmount(totals, pct), stored as its totals_json;
 *   - final: finalInvoiceTotals(totals, no extras yet, that stored deposit),
 *     pointing at the deposit (less_invoice_id) for "Less deposit paid";
 *   - single: singleInvoiceTotals(totals, no extras yet).
 * All start as drafts: nothing is issued, due or sent until task 20 / E.
 *
 * `frozen` is the estimate to bill when it isn't the row as it stands: a
 * client signing a sent version (task 27) is billed for that version, even
 * if the owner has edited the estimate since without sending it again.
 */
function createInvoices(db, p, estimateId, choice, now, frozen) {
  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  const snapshot = frozen || loadEstimate(row, readDays(db, row.id), readRentals(db, row.id));
  const json = JSON.stringify(snapshot);
  const insert = db.prepare(`
    INSERT INTO invoices
      (id, project_id, estimate_id, kind, number, status, pct, estimate_snapshot_json, extras_json,
       totals_json, less_invoice_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, '{}', ?, ?, ?, ?)
  `);
  const made = [];
  const add = (kind, number, pct, totals, lessId) => {
    const id = newId('inv');
    insert.run(id, p.id, row.id, kind, number, pct, json, JSON.stringify(totals), lessId, now, now);
    made.push({ id, kind, number });
    return id;
  };
  const [first, second] = invoiceNumbers(p.upid, choice.invoicing);
  if (choice.invoicing === 'single') {
    add('single', first.number, null, singleInvoiceTotals(snapshot.totals, null), null);
  } else {
    const deposit = depositAmount(snapshot.totals, choice.pct);
    const depositId = add('deposit', first.number, choice.pct, deposit, null);
    add('final', second.number, null, finalInvoiceTotals(snapshot.totals, null, deposit), depositId);
  }
  return made;
}

/**
 * ACCEPTING (D18), inside the caller's transaction: every dated day of the
 * accepted estimate that is pencilled or proposed turns confirmed. One on a
 * date another live project had already confirmed is flagged "clash,
 * rebook" — the accept still goes through — unless it carries a specification
 * note (D16), which is the owner having already said why it may share. Date
 * TBC days and days already confirmed are untouched.
 *
 * @returns {Array<{date, upid, name}>} the flagged days.
 */
function confirmDays(db, estimateId, ownIds, now) {
  const days = db.prepare(`
    SELECT id, date, override_note FROM production_days
     WHERE estimate_id = ? AND date IS NOT NULL AND status <> 'confirmed'
     ORDER BY date, id
  `).all(estimateId);
  const holder = confirmedHolder(db);
  const own = JSON.stringify(ownIds);
  const set = db.prepare("UPDATE production_days SET status = 'confirmed', rebook = ?, updated_at = ? WHERE id = ?");
  const flagged = [];
  days.forEach((d) => {
    const hit = d.override_note ? null : holder.get(d.date, own);
    if (hit) flagged.push({ date: d.date, upid: hit.upid || '', name: hit.name || '' });
    set.run(hit ? 1 : 0, now, d.id);
  });
  return flagged;
}

/**
 * THE ACCEPT (D18, D32; IA flow 3 step 4), inside the caller's transaction,
 * for both ways in: the owner's Mark accepted (task 19) and the client's
 * signature (task 27). The estimate becomes accepted, its dated days are
 * confirmed with any clash flagged (confirmDays), the invoices are made
 * unsent (createInvoices), and the project records the choice and the
 * moment. One activity row says so.
 *
 * @param {object} p        the project row
 * @param {string} lead     the estimate accepted
 * @param {string[]} ownIds every estimate in the project (a date they share isn't a clash)
 * @param {object|null} choice  invoicingChoice's; null makes no invoices (a
 *                          client signing a project that can't be invoiced
 *                          yet: the owner fixes it, then Create invoices)
 * @param {object} [opts]   { frozen: the estimate to bill, kind: the activity
 *                          kind ('accepted'), detail: more for its detail }
 * @returns {{rebook: Array, made: Array}}
 */
function acceptEstimate(db, p, lead, ownIds, choice, now, opts = {}) {
  db.prepare("UPDATE estimates SET status = 'accepted' WHERE id = ?").run(lead);
  // An estimate email still waiting would ask the client to accept again.
  cancelPending(db, 'estimate', ownIds, now);
  const rebook = confirmDays(db, lead, ownIds, now);
  const made = choice ? createInvoices(db, p, lead, choice, now, opts.frozen) : [];
  db.prepare(`
    UPDATE projects SET accepted_at = ?, invoicing = COALESCE(?, invoicing), deposit_pct = COALESCE(?, deposit_pct),
           updated_at = ?
     WHERE id = ?
  `).run(now, choice ? choice.invoicing : null, choice ? choice.pct : null, now, p.id);
  logActivity(db, p.id, opts.kind || 'accepted', {
    estimateId: lead,
    invoicing: choice ? choice.invoicing : null,
    depositPct: choice ? choice.pct : null,
    invoices: made.map((i) => i.number),
    rebook: rebook.map((r) => r.date),
    ...(opts.detail || {}),
  }, now);
  return { rebook, made };
}

/**
 * Projects (production-booking tasks 17, 18; IA "Projects", "Project folder").
 *
 * GET /api/projects — one card per project, newest activity first.
 *
 * Query:
 *   stage   `active` (the default), `all`, or one of projects.js STAGES. Active
 *           is every project except paid and declined ones settled more than
 *           90 days ago, unless `q` is given: a search looks at everything.
 *   q       matched, ignoring case, against the UPID (the project's, and the
 *           old one a project waiting for the fix-up still carries), every
 *           estimate's name, and the client's business and contact name.
 *   client  only that client's projects (the Clients screen's history).
 *   today   the browser's date (YYYY-MM-DD), which the 90 days and "next
 *           production day" are counted from, as every date in the app is.
 *   limit   1–200, default 50; `before` is the reply's `next`, for Show more.
 *
 * Every project is read and filtered here rather than in SQL: the stage comes
 * from its estimates and invoices together (projectStage), and one owner's
 * projects run to hundreds, not millions.
 *
 * GET /api/projects/:id?today= — the folder (readFolder).
 *
 * GET /api/activity?limit= — Home's "Recent activity" (task 22, D52): the
 * latest events of HOME_KINDS across every project, newest first, each with
 * the project it opens ({ id, upid, name, client }, named as its card is).
 * `limit` is 1–50, default 10. The folder still shows a project's whole log.
 *
 * THE FOLDER'S ACTIONS (tasks 18, 19). Each answers with the folder as it
 * now stands, so the screen redraws from one reply, and each logs an
 * `activity` row.
 *
 *   POST /sent     { validUntil } — Mark sent, Stage D's stand-in for sending.
 *                  The app now sends through /send; this stays for the tests
 *                  that freeze a version directly, and is registered only
 *                  for them (`markSent`, C13): production answers 404.
 *                  The lead estimate becomes `sent`, and the
 *                  `sent` row's detail carries validUntil, which the stage line
 *                  reads ("valid until", "expired", D44). No version: nothing
 *                  is frozen until E (D34). Refused once declined or accepted.
 *   POST /send     { by: 'email', to, message?, scheduledFor?, validUntil }
 *                  or { by: 'link', validUntil } — the send panel (task 29,
 *                  D43). The lead estimate becomes `sent` and is frozen as its
 *                  next version (D34), valid from the day it goes; `email`
 *                  queues the link to the client (sends.js), now or at
 *                  scheduledFor; `link` is "Copy link", for sending another
 *                  way. Refused while an email of it is still waiting, and
 *                  with `not_configured` when email isn't set up. The reply's
 *                  `sent` names the version and its link's token.
 *   POST /decline  The owner's no-go (D22): every estimate becomes declined,
 *                  so its days leave the calendars and lock nothing. Refused
 *                  once an invoice exists; a second decline changes nothing.
 *   POST /reopen   Back to draft, days back on the calendars — through the
 *                  clash check again (D22): a date another project has since
 *                  confirmed refuses it, `date_locked`, naming every such
 *                  date, unless that day carries a specification note (D16).
 *                  Pencilled ones are only named in the reply (D15).
 *   POST /accept   { invoicing, depositPct } — "client accepted" (stage D's
 *                  stand-in for E's signing; IA flow 4). In ONE transaction:
 *                  the lead estimate becomes accepted, its dated days confirmed
 *                  with any clash flagged (confirmDays, D18), the deposit +
 *                  final pair or the single invoice made (createInvoices,
 *                  D32–D37) at the deposit % chosen, which is copied onto the
 *                  project (D33), and `accepted` logged. From draft or sent.
 *                  IDEMPOTENT: accepting an accepted project changes nothing
 *                  and answers `already: true`. Refused on a declined project,
 *                  and while invoice numbers can't be made (cannotInvoice).
 *                  The reply's `rebook` lists the flagged days.
 *   POST /invoices { invoicing, depositPct } — the invoices alone, for a
 *                  project accepted without them (v13 mapped every `approved`
 *                  estimate to accepted). Idempotent the same way; refused
 *                  before acceptance and on an old-way invoice's project.
 *   DELETE         The project and everything in it: estimates, days,
 *                  rentals, invoices, activity. Refused while an invoice has
 *                  gone out or been paid (a made-the-old-way one excepted, as
 *                  deleting its estimate always took it).
 */
function registerProjectRoutes(app, db, opts = {}) {
  app.get('/api/activity', (req, res) => {
    const limit = req.query.limit === undefined ? HOME_LIMIT : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > HOME_MAX) {
      return res.status(400).json({ error: 'limit_invalid' });
    }
    const rows = db.prepare(`
      SELECT a.*, p.upid, p.client_id FROM activity a JOIN projects p ON p.id = a.project_id
       WHERE a.kind IN (SELECT value FROM json_each(?))
       ORDER BY a.at DESC, a.id DESC LIMIT ?
    `).all(JSON.stringify(HOME_KINDS), limit);
    // The project's name and client as summarize() picks them: its lead estimate's.
    const leadOf = db.prepare(`
      SELECT name, client_json FROM estimates WHERE project_id = ?
       ORDER BY status = 'declined', updated_at DESC, id LIMIT 1
    `);
    const clientOf = db.prepare('SELECT business_name FROM clients WHERE id = ?');
    const projects = new Map();
    const projectOf = (row) => {
      if (!projects.has(row.project_id)) {
        const lead = leadOf.get(row.project_id);
        const snapshot = lead ? parseDetail(lead.client_json) : {};
        const record = row.client_id ? clientOf.get(row.client_id) : null;
        projects.set(row.project_id, {
          id: row.project_id,
          upid: row.upid,
          name: lead ? lead.name : '',
          client: snapshot.businessName || (record && record.business_name) || '',
        });
      }
      return projects.get(row.project_id);
    };
    res.json({
      activity: rows.map((a) => ({
        id: a.id, at: a.at, kind: a.kind, detail: parseDetail(a.detail_json), project: projectOf(a),
      })),
    });
  });

  app.get('/api/projects', (req, res) => {
    const stage = String(req.query.stage || 'active');
    if (stage !== 'active' && stage !== 'all' && !STAGES.includes(stage)) {
      return res.status(400).json({ error: 'stage_invalid' });
    }
    const today = todayOf(req);
    if (!today) return res.status(400).json({ error: 'today_invalid' });
    const limit = req.query.limit === undefined ? PAGE : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      return res.status(400).json({ error: 'limit_invalid' });
    }
    const q = String(req.query.q || '').trim().toLowerCase();
    const clientId = req.query.client === undefined ? null : String(req.query.client);
    const before = req.query.before === undefined ? null : String(req.query.before);
    const cursor = before === null ? null : before.split('~');
    if (cursor && cursor.length !== 2) return res.status(400).json({ error: 'before_invalid' });

    const projects = clientId === null
      ? db.prepare('SELECT * FROM projects').all()
      : db.prepare('SELECT * FROM projects WHERE client_id = ?').all(clientId);
    const estimates = groupBy(db.prepare(`
      SELECT ${ESTIMATE_COLUMNS} FROM estimates WHERE project_id IS NOT NULL
    `).all(), 'project_id');
    const invoices = groupBy(db.prepare(`SELECT ${INVOICE_COLUMNS} FROM invoices`).all(), 'project_id');
    const lastActivity = new Map(db.prepare(`
      SELECT project_id, MAX(at) AS at FROM activity GROUP BY project_id
    `).all().map((r) => [r.project_id, r.at]));
    const sends = new Map();
    db.prepare("SELECT project_id, at, detail_json FROM activity WHERE kind = 'sent' ORDER BY at, id").all()
      .forEach((r) => sends.set(r.project_id, sendOf(r)));
    const nextDay = new Map();
    db.prepare(NEXT_DAY_SQL + ' ORDER BY d.date, d.start_time, d.id').all(today).forEach((r) => {
      if (!nextDay.has(r.project_id)) nextDay.set(r.project_id, { date: r.date, status: r.status });
    });
    const clients = new Map(db.prepare('SELECT id, business_name, contact_name FROM clients').all()
      .map((c) => [c.id, c]));

    const taken = takenDays(db);
    const cutoff = addDays(today, -SETTLED_DAYS);
    const all = projects.map((p) => {
      const own = estimates.get(p.id) || [];
      const bills = invoices.get(p.id) || [];
      const record = p.client_id ? clients.get(p.client_id) : null;
      const project = summarize(p, own, bills, {
        sent: sends.get(p.id),
        nextDay: nextDay.get(p.id),
        client: record,
        lastActivityAt: lastActivity.get(p.id),
      });
      project.takenDays = taken.get(p.id) || [];
      const settled = settledAt(p, bills, project.stage);
      const lead = own.find((e) => e.id === project.estimateId);
      const snapshot = lead ? JSON.parse(lead.client_json || '{}') : {};
      return {
        project,
        old: Boolean(settled) && settled.slice(0, 10) < cutoff,
        text: [
          p.upid, ...own.map((e) => e.upid), ...own.map((e) => e.name),
          snapshot.businessName, snapshot.contactName,
          record && record.business_name, record && record.contact_name,
        ].filter(Boolean).join('\n').toLowerCase(),
      };
    });

    const searched = q ? all.filter((row) => row.text.includes(q)) : all;
    const inActive = (row) => q || !row.old;
    const counts = { active: searched.filter(inActive).length, all: searched.length };
    STAGES.forEach((s) => {
      counts[s] = searched.filter((row) => row.project.stage === s).length;
    });
    const shown = searched
      .filter((row) => stage === 'all' || (stage === 'active' ? inActive(row) : row.project.stage === stage))
      .map((row) => row.project)
      .sort((a, b) => (b.lastActivityAt > a.lastActivityAt) - (b.lastActivityAt < a.lastActivityAt) ||
        (b.id > a.id) - (b.id < a.id));
    const rest = cursor
      ? shown.filter((p) => p.lastActivityAt < cursor[0] || (p.lastActivityAt === cursor[0] && p.id < cursor[1]))
      : shown;
    const page = rest.slice(0, limit);
    const last = page[page.length - 1];

    res.json({
      ok: true,
      projects: page,
      next: rest.length > limit ? last.lastActivityAt + '~' + last.id : null,
      total: shown.length,
      counts,
      // How many projects still wait for the UPID fix-up (task 16): the banner.
      needsUpid: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE needs_upid = 1').get().n,
    });
  });

  /* The folder, or a 404. Every folder route reads `today` the same way. */
  function folderReply(req, res, extra) {
    const today = todayOf(req);
    if (!today) return res.status(400).json({ error: 'today_invalid' });
    const folder = readFolder(db, req.params.id, today);
    if (!folder) return res.status(404).json({ error: 'not_found' });
    return res.json({ ok: true, ...folder, ...(extra || {}) });
  }

  /* The project behind an action, or null once a 404 has been sent. */
  function projectFor(req, res) {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) res.status(404).json({ error: 'not_found' });
    return p || null;
  }

  app.get('/api/projects/:id', (req, res) => folderReply(req, res));

  if (opts.markSent) app.post('/api/projects/:id/sent', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    const validUntil = (req.body || {}).validUntil;
    if (!isYmd(validUntil)) return res.status(400).json({ error: 'valid_until_invalid' });
    const { stage, own } = stageNow(db, p);
    if (stage === 'declined') {
      return res.status(409).json({ error: 'project_declined', message: 'This project was declined. Reopen it first.' });
    }
    if (stage !== 'draft' && stage !== 'sent') {
      return res.status(409).json({ error: 'project_accepted', message: 'This project has been accepted, so there is nothing to send.' });
    }
    const lead = summarize(p, own, [], {}).estimateId;
    if (!lead) return res.status(409).json({ error: 'no_estimate' });
    const now = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE estimates SET status = 'sent' WHERE id = ?").run(lead);
      // Sending freezes the estimate as its next version (D34, task 25): the
      // client's link shows exactly this until the next send.
      const { n } = freezeVersion(db, lead, { issuedOn: todayOf(req) || localToday(), validUntil, now });
      db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, p.id);
      logActivity(db, p.id, 'sent', { validUntil, estimateId: lead, version: n }, now);
    })();
    return folderReply(req, res);
  });

  app.post('/api/projects/:id/send', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return undefined;
    const today = todayOf(req);
    if (!today) return res.status(400).json({ error: 'today_invalid' });
    const now = nowIso();
    const ask = sendRequest(req.body, now);
    if (ask.error) return res.status(400).json(ask);
    if (ask.by === 'email' && !(app.locals.mailer && app.locals.mailer.configured)) {
      return res.status(409).json({ error: 'not_configured', message: 'Email isn’t set up yet. Copy the link and send it yourself.' });
    }
    // Issued, and valid from, the day it goes: today, or the scheduled day (Sydney's).
    const sendDay = ask.later ? sydneyDate(ask.scheduledFor) : today;
    const validUntil = (req.body || {}).validUntil;
    if (!isYmd(validUntil) || validUntil < sendDay) {
      return res.status(400).json({ error: 'valid_until_invalid', message: 'Valid until can’t be before the day it’s sent.' });
    }
    const { stage, own } = stageNow(db, p);
    if (stage === 'declined') {
      return res.status(409).json({ error: 'project_declined', message: 'This project was declined. Reopen it first.' });
    }
    if (stage !== 'draft' && stage !== 'sent') {
      return res.status(409).json({ error: 'project_accepted', message: 'This project has been accepted, so there is nothing to send.' });
    }
    const lead = summarize(p, own, [], {}).estimateId;
    if (!lead) return res.status(409).json({ error: 'no_estimate' });
    const waiting = pendingFor(db, 'estimate', own.map((e) => e.id));
    if (waiting) {
      return res.status(409).json({
        error: 'send_pending', sendId: waiting.id,
        message: 'An email of this estimate is already waiting to go. Change or cancel it first.',
      });
    }
    let made;
    db.transaction(() => {
      db.prepare("UPDATE estimates SET status = 'sent' WHERE id = ?").run(lead);
      // Confirming freezes the version (D34), whenever the email goes: the
      // email links to exactly this, and so does the link the owner copies.
      made = freezeVersion(db, lead, { issuedOn: sendDay, validUntil, now });
      db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, p.id);
      logActivity(db, p.id, 'sent', {
        validUntil, estimateId: lead, version: made.n, by: ask.by,
        ...(ask.by === 'email' ? { to: ask.to } : {}),
        ...(ask.later ? { scheduledFor: ask.scheduledFor } : {}),
      }, now);
      if (ask.by === 'email') {
        addSend(db, {
          docKind: 'estimate', docId: lead, versionId: made.versionId, toEmail: ask.to, message: ask.message,
          scheduledFor: ask.scheduledFor,
        }, now);
      }
    })();
    if (ask.by === 'email' && !ask.later && app.locals.outbox) app.locals.outbox.kick();
    return folderReply(req, res, { sent: { estimateId: lead, version: made.n, token: made.token } });
  });

  app.post('/api/projects/:id/decline', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    if (p.declined_at) return folderReply(req, res);
    const { bills } = stageNow(db, p);
    if (bills.some((i) => i.status !== 'void')) {
      return res.status(409).json({
        error: 'has_invoices',
        message: 'This project has invoices, so it can’t be declined.',
      });
    }
    const now = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE estimates SET status = 'declined' WHERE project_id = ?").run(p.id);
      cancelPending(db, 'estimate', db.prepare('SELECT id FROM estimates WHERE project_id = ?').all(p.id).map((r) => r.id), now);
      db.prepare('UPDATE projects SET declined_at = ?, updated_at = ? WHERE id = ?').run(now, now, p.id);
      logActivity(db, p.id, 'declined', {}, now);
    })();
    return folderReply(req, res);
  });

  app.post('/api/projects/:id/reopen', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    if (!p.declined_at) {
      return res.status(409).json({ error: 'not_declined', message: 'This project isn’t declined.' });
    }
    const ids = db.prepare('SELECT id FROM estimates WHERE project_id = ?').all(p.id).map((r) => r.id);
    const clash = lockedDates(db, ids);
    if (clash.confirmed.length) {
      const first = clash.confirmed[0];
      const more = clash.confirmed.length - 1;
      return res.status(409).json({
        error: 'date_locked',
        clashes: clash.confirmed,
        message: `${first.date} is now confirmed for ${whoHas(first)}` +
          (more ? ` (and ${more} more date${more === 1 ? '' : 's'})` : '') +
          '. Move that day, or add a specification note to it, then reopen.',
      });
    }
    const now = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE estimates SET status = 'draft' WHERE project_id = ?").run(p.id);
      db.prepare('UPDATE projects SET declined_at = NULL, accepted_at = NULL, updated_at = ? WHERE id = ?')
        .run(now, p.id);
      logActivity(db, p.id, 'reopened', {}, now);
    })();
    return folderReply(req, res, { pencilled: clash.pencilled });
  });

  /* The estimate a project's invoices bill: an accepted one if it has any
     (the lead among them), else the lead. */
  function billedEstimateId(p) {
    const own = db.prepare(`SELECT ${ESTIMATE_COLUMNS} FROM estimates WHERE project_id = ?`).all(p.id);
    const accepted = own.filter((e) => e.status === 'accepted');
    return summarize(p, accepted.length ? accepted : own, [], {}).estimateId;
  }

  app.post('/api/projects/:id/accept', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    const { stage, own } = stageNow(db, p);
    if (stage === 'declined') {
      return res.status(409).json({ error: 'project_declined', message: 'This project was declined. Reopen it first.' });
    }
    if (stage !== 'draft' && stage !== 'sent') return folderReply(req, res, { already: true });
    const choice = invoicingChoice(db, p, req.body || {});
    if (choice.error) return res.status(400).json(choice);
    const refusal = cannotInvoice(db, p, invoiceNumbers(p.upid, choice.invoicing));
    if (refusal) return res.status(409).json(refusal);
    const lead = summarize(p, own, [], {}).estimateId;
    if (!lead) return res.status(409).json({ error: 'no_estimate' });
    let rebook = [];
    db.transaction(() => {
      ({ rebook } = acceptEstimate(db, p, lead, own.map((e) => e.id), choice, nowIso()));
    })();
    return folderReply(req, res, { rebook });
  });

  app.post('/api/projects/:id/invoices', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    const { stage, bills } = stageNow(db, p);
    if (stage === 'declined') {
      return res.status(409).json({ error: 'project_declined', message: 'This project was declined. Reopen it first.' });
    }
    if (bills.some((i) => i.kind !== 'legacy')) return folderReply(req, res, { already: true });
    if (bills.some((i) => i.status !== 'void')) {
      return res.status(409).json({
        error: 'has_legacy_invoice',
        message: 'This project was invoiced the old way, so it has its invoice already.',
      });
    }
    if (stage !== 'accepted') {
      return res.status(409).json({ error: 'not_accepted', message: 'Mark the project accepted first.' });
    }
    const choice = invoicingChoice(db, p, req.body || {});
    if (choice.error) return res.status(400).json(choice);
    const refusal = cannotInvoice(db, p, invoiceNumbers(p.upid, choice.invoicing));
    if (refusal) return res.status(409).json(refusal);
    const estimateId = billedEstimateId(p);
    if (!estimateId) return res.status(409).json({ error: 'no_estimate' });
    const now = nowIso();
    db.transaction(() => {
      const made = createInvoices(db, p, estimateId, choice, now);
      db.prepare(`
        UPDATE projects SET invoicing = ?, deposit_pct = COALESCE(?, deposit_pct), updated_at = ? WHERE id = ?
      `).run(choice.invoicing, choice.pct, now, p.id);
      logActivity(db, p.id, 'invoices_created', {
        estimateId,
        invoicing: choice.invoicing,
        depositPct: choice.pct,
        invoices: made.map((i) => i.number),
      }, now);
    })();
    return folderReply(req, res);
  });

  /* A signed agreement's PDF (D42, D66): the bytes stored at signing, or
     rendered from the stored text now if the renderer was down then. */
  app.get('/api/projects/:id/agreements/:signatureId/pdf', async (req, res, next) => {
    const sig = signatureRow(db, req.params.signatureId);
    if (!sig || sig.project_id !== req.params.id) return res.status(404).json({ error: 'not_found' });
    let buffer;
    try {
      buffer = await signaturePdf(db, sig);
    } catch (err) {
      if (err.code === 'pdf_unavailable') return res.status(503).json({ error: 'pdf_unavailable' });
      return next(err);
    }
    res.attachment(agreementFilename(sig));
    res.type('application/pdf');
    return res.send(buffer);
  });

  app.delete('/api/projects/:id', (req, res) => {
    const p = projectFor(req, res);
    if (!p) return;
    const gone = db.prepare(`
      SELECT number FROM invoices
       WHERE project_id = ? AND kind <> 'legacy' AND status IN ('scheduled', 'sent', 'paid') LIMIT 1
    `).get(p.id);
    if (gone) {
      return res.status(409).json({
        error: 'has_sent_invoices',
        message: `${gone.number || 'An invoice'} has gone out, so this project can’t be deleted.`,
      });
    }
    // Estimates (and through them days and rentals), invoices and activity
    // all hang off the project, ON DELETE CASCADE. Sends name their document
    // by id only, so they go first: a waiting one would email a deleted job.
    db.transaction(() => {
      db.prepare(`
        DELETE FROM sends WHERE (doc_kind = 'estimate' AND doc_id IN (SELECT id FROM estimates WHERE project_id = ?))
                             OR (doc_kind = 'invoice' AND doc_id IN (SELECT id FROM invoices WHERE project_id = ?))
      `).run(p.id, p.id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    })();
    return res.json({ ok: true });
  });
}

module.exports = {
  registerProjectRoutes, summarize, readFolder, logActivity, todayOf, localToday, isYmd,
  // The client's signature (signing.js) accepts through the same pieces.
  acceptEstimate, depositPctFor, invoiceNumbers, cannotInvoice, stageNow,
  // The estimate save that changes a sent quote sends the change (C2, C3).
  resendNeeded, updateRequest, sendUpdate,
};
