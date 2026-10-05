'use strict';

/**
 * The client signs (production-booking task 27; D39–D41, D66; IA "The client
 * accepts" 3–4).
 *
 * The client page asks for the agreement while its estimate is open, shows it,
 * and sends back a full name, a role, the "I agree" tick, and the `key` it was
 * given. The server stores the signature and accepts the estimate in one
 * transaction, through the same acceptEstimate the owner's Mark accepted uses.
 *
 * WHAT IS SIGNED IS WHAT WAS SHOWN. The agreement is the Settings text filled
 * (documents.js, the same call the Settings preview makes) from the FROZEN
 * version the client is looking at, never the estimate as edited since. The
 * two fields the client fills while reading, {client_contact} (the name they
 * sign with: the client is a business, and the contact on file may not be
 * who signs) and {signatory_role}, are left as gaps: the reply carries the
 * text as `parts` with `slots` naming each gap ('name' or 'role'), the page
 * fills them as they're typed, and signing fills the same gaps the same way.
 * `key` is a hash of the version, the parts and the slots; if anything that fills the
 * text changed while the client read it (the owner edited the agreement,
 * the deposit %, or midnight passed), the key no longer matches and the
 * client is shown the new text instead of signing the old one.
 *
 * The money in the text and on the invoices agree because both come from the
 * same frozen totals and the same deposit choice, through calc.js.
 */

const crypto = require('crypto');
const { newId } = require('./db');
const { depositAmount, finalInvoiceTotals } = require('./calc');
const { readSettings } = require('./ratecard');
const { docSettings, agreementValues, fillAgreement } = require('./documents');
const { buildAgreementHtml, renderPdfBuffer } = require('./pdf');
const { publicEstimate } = require('./public');
const { acceptEstimate, depositPctFor, invoiceNumbers, cannotInvoice } = require('./routes/projects');
const { queueSigningEmails } = require('./sends');

/* Where the role goes until it's typed. NUL can't come from a typed role or a
   Settings text (both are stripped of it), so it can't be confused with one. */
const ROLE_SLOT = '\u0000signatory_role\u0000';
const NAME_SLOT = '\u0000client_contact\u0000';
const SLOT_OF = { [ROLE_SLOT]: 'role', [NAME_SLOT]: 'name' };

/* The text with each gap filled from `fill` ({ name, role }). */
function joinAgreement(agreement, fill) {
  return agreement.parts.reduce((text, part, i) =>
    text + (i > 0 ? fill[agreement.slots[i - 1]] : '') + part, '');
}

/* What a client agrees to when the owner hasn't written an agreement yet
   (Settings → Service agreement left empty): only the quote itself. The
   client's word for an estimate is "quote" (D103). */
const FALLBACK_TEXT = 'ACCEPTANCE OF QUOTE\n\n' +
  '{client_business} accepts quote {upid}, {project_name}, for {total}, as set out in the quote.\n\n' +
  'Signed for {client_business} by {client_contact}, {signatory_role}, on {date}.';

const NAME_MAX = 100;

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/* A typed name or role: one line, no control characters, single spaces. */
const clean = (v) => (typeof v === 'string' ? v : '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* The link's estimate, its newest version and its project; null for no link. */
function linkOf(db, token) {
  const row = db.prepare('SELECT * FROM estimates WHERE public_token = ?').get(String(token));
  const version = row
    ? db.prepare('SELECT * FROM estimate_versions WHERE estimate_id = ? ORDER BY n DESC LIMIT 1').get(row.id)
    : null;
  if (!version || !row.project_id) return null;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id);
  return project ? { row, version, project } : null;
}

/* A signature makes the project's invoices as Mark accepted's defaults would:
   a single invoice if the owner already chose one for this project, else the
   pair at the project's deposit % (D32, D33). */
function choiceFor(db, project) {
  return project.invoicing === 'single'
    ? { invoicing: 'single', pct: null }
    : { invoicing: 'pair', pct: depositPctFor(db, project) };
}

/**
 * The agreement for a link's newest version, as the client is to see it.
 *
 * @returns {{parts:string[], slots:string[], key:string, choice:object, frozen:object}}
 */
function agreementOf(db, link, today) {
  const snap = JSON.parse(link.version.snapshot_json);
  const estimate = snap.estimate || {};
  const totals = estimate.totals || {};
  const settings = docSettings(readSettings(db));
  const choice = choiceFor(db, link.project);
  const deposit = choice.pct === null ? null : depositAmount(totals, choice.pct);
  const values = agreementValues({
    client: estimate.client,
    upid: link.project.upid || estimate.upid,
    projectName: estimate.name,
    totalIncGst: totals.totalIncGst,
    depositPct: choice.pct,
    depositTotal: deposit ? deposit.totalIncGst : null,
    balanceTotal: finalInvoiceTotals(totals, null, deposit).balanceDue,
    dueDays: settings.dueDays,
    signatoryRole: '',
    days: estimate.days,
    business: snap.business,
    today,
  });
  values.signatory_role = ROLE_SLOT;
  values.client_contact = NAME_SLOT;
  const template = (settings.agreementText.trim() ? settings.agreementText : FALLBACK_TEXT).replace(/\u0000/g, '');
  const pieces = fillAgreement(template, values).text.split(/(\u0000(?:signatory_role|client_contact)\u0000)/);
  const parts = pieces.filter((_, i) => i % 2 === 0);
  const slots = pieces.filter((_, i) => i % 2 === 1).map((slot) => SLOT_OF[slot]);
  return { parts, slots, key: sha256(JSON.stringify([link.version.n, parts, slots])), choice, frozen: estimate };
}

/** The agreement on offer for a link (the GET adds it while `open`), or null. */
function agreementOffer(db, token, today) {
  const link = linkOf(db, token);
  if (!link) return null;
  const { parts, slots, key } = agreementOf(db, link, today);
  return { parts, slots, key };
}

const reply = (status, body) => ({ status, body });
const NOT_FOUND = reply(404, { error: 'not_found' });

/**
 * Whether this signature can go ahead now. Run before the PDF is made and
 * again inside the transaction, since the PDF is made in between and anything
 * may have changed while it was.
 *
 * @returns {{reply:object}|{link:object, agreement:object}}
 */
function gate(db, token, body, today) {
  const link = linkOf(db, token);
  if (!link) return { reply: NOT_FOUND };
  // A second submit of the same version (a double tap, a retry after a lost
  // reply) is the same signature: it answers as the first did.
  if (db.prepare('SELECT 1 FROM signatures WHERE version_id = ?').get(link.version.id)) {
    return { reply: reply(200, { estimate: publicEstimate(db, token, today), already: true }) };
  }
  const view = publicEstimate(db, token, today);
  if (view.state !== 'open') {
    return {
      reply: reply(409, { error: 'not_open', state: view.state, message: 'This quote can’t be accepted any more.' }),
    };
  }
  if (body.version !== link.version.n) {
    return {
      reply: reply(409, {
        error: 'version_changed',
        message: 'We’ve just sent a newer version of this quote. Look it over before you sign.',
      }),
    };
  }
  const agreement = agreementOf(db, link, today);
  if (body.key !== agreement.key) {
    return {
      reply: reply(409, {
        error: 'agreement_changed',
        message: 'The agreement has just been updated. Read it through again before you sign.',
        agreement: { parts: agreement.parts, slots: agreement.slots, key: agreement.key },
      }),
    };
  }
  return { link, agreement };
}

/**
 * POST /public/estimates/:token/accept. Resolves to { status, body }.
 *
 * @param {object} body  { fullName, role, agree: true, version, key }
 * @param {object} ctx   { ip, userAgent, now: () => ISO, today: () => 'YYYY-MM-DD', render,
 *                         ownerEmail, kick }
 */
async function signEstimate(db, token, body, ctx) {
  const b = body && typeof body === 'object' ? body : {};
  const fullName = clean(b.fullName);
  const role = clean(b.role);
  if (!fullName) return reply(400, { error: 'name_required', message: 'Type your full name.' });
  if (!role) return reply(400, { error: 'role_required', message: 'Type your role.' });
  if (fullName.length > NAME_MAX || role.length > NAME_MAX) {
    return reply(400, { error: 'too_long', message: `Keep your name and role under ${NAME_MAX} characters each.` });
  }
  if (b.agree !== true) return reply(400, { error: 'agree_required', message: 'Tick “I agree to the service agreement”.' });

  const today = ctx.today();
  const first = gate(db, token, b, today);
  if (first.reply) return first.reply;

  // The record: decided once, printed into the PDF, stored as printed.
  const text = joinAgreement(first.agreement, { name: fullName, role });
  const sig = {
    id: newId('sig'),
    version_id: first.link.version.id,
    full_name: fullName,
    role,
    ip: String(ctx.ip || '').slice(0, 64),
    user_agent: String(ctx.userAgent || '').slice(0, 400),
    signed_at: ctx.now(),
    agreement_text: text,
    agreement_sha256: sha256(text),
    n: first.link.version.n,
    upid: first.link.project.upid || first.link.row.upid || '',
  };

  // The PDF before the transaction (rendering is async; a transaction here is
  // not). If the renderer is down, the signature still counts: the text is
  // the record, and the PDF is made from it on its first download.
  let pdf = null;
  try {
    pdf = await (ctx.render || renderPdfBuffer)(buildAgreementHtml(sig));
  } catch (err) {
    console.error('[signing] agreement PDF not made at signing:', err.code || err.message);
  }

  let out = null;
  let queued = false;
  db.transaction(() => {
    const again = gate(db, token, b, ctx.today());
    if (again.reply) {
      out = again.reply;
      return;
    }
    const { link, agreement } = again;
    db.prepare(`
      INSERT INTO signatures
        (id, version_id, full_name, role, ip, user_agent, signed_at, agreement_text, agreement_sha256, pdf_blob)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sig.id, sig.version_id, sig.full_name, sig.role, sig.ip, sig.user_agent, sig.signed_at,
      sig.agreement_text, sig.agreement_sha256, pdf);

    // An invoice number needs the UPID (D36). A project that can't be
    // invoiced yet is still accepted: the client has signed, and the owner
    // fixes the UPID and uses Create invoices.
    const p = link.project;
    const refusal = cannotInvoice(db, p, invoiceNumbers(p.upid, agreement.choice.invoicing));
    const ownIds = db.prepare('SELECT id FROM estimates WHERE project_id = ?').all(p.id).map((r) => r.id);
    acceptEstimate(db, p, link.row.id, ownIds, refusal ? null : agreement.choice, sig.signed_at, {
      frozen: agreement.frozen,
      kind: 'signed',
      detail: {
        version: link.version.n,
        signatureId: sig.id,
        signedBy: sig.full_name,
        role: sig.role,
        ...(refusal ? { invoiceProblem: refusal.error } : {}),
      },
    });
    // The owner's notice and the client's signed copy (task 28), queued in
    // this transaction so they exist exactly when the signature does. They go
    // out after it commits (the kick below); a mail problem never touches the
    // signature, it only leaves a failed row.
    const owner = ctx.ownerEmail || ((readSettings(db).business || {}).email || '');
    queueSigningEmails(db, {
      estimateId: link.row.id,
      versionId: link.version.id,
      ownerEmail: owner,
      clientEmail: String((agreement.frozen.client || {}).email || '').trim(),
    }, sig.signed_at);
    out = reply(200, { estimate: publicEstimate(db, token, ctx.today()) });
    queued = true;
  })();
  if (queued && ctx.kick) ctx.kick();
  return out;
}

module.exports = { signEstimate, agreementOffer, joinAgreement, FALLBACK_TEXT, ROLE_SLOT, NAME_SLOT, NAME_MAX };
