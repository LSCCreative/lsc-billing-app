'use strict';

/**
 * The send queue (production-booking task 28; D43, D47).
 *
 * Every email the app sends goes through a `sends` row: the estimate or
 * invoice going to a client (now or scheduled), and the two signing emails
 * (the owner's notice, the client's signed copy). A row moves
 *
 *     scheduled → sending → sent
 *                        ↘ failed → (retry) → scheduled
 *     scheduled → cancelled
 *
 * NO SEND GOES TWICE. A row is claimed (`scheduled` → `sending`) in one
 * synchronous transaction before anything touches the network, and only a
 * row that was still `scheduled` can be claimed, so two overlapping ticks (or
 * a tick and a kick) can't both take it. A row still `sending` when the
 * server boots was being sent when it stopped: nobody can say whether the
 * mail left, so it's marked `failed` with that said, for the owner to retry or
 * not. A resend by hand is a choice, a double send is a surprise.
 *
 * LATE (D47). A scheduled send missed because the server was down goes out
 * when it's back, and is marked `late` so the folder can say "Sent late at
 * 11:42 (scheduled 9:00)". Anything sent more than LATE_AFTER_MS after its time
 * counts: the scheduler's own one-minute grain is well inside that.
 *
 * FAILURES are stored in `error` (text safe to show; mail.js scrubs the key)
 * and the row stays `failed` until it's retried or left. Nothing is swallowed.
 */

const { newId, nowIso } = require('./db');
const { newToken, signatureRow, signaturePdf } = require('./public');
const { readSettings } = require('./ratecard');
const { documentEmail, ownerSignedEmail, signedCopyEmail } = require('./mail');
const { agreementFilename } = require('./pdf');

const LATE_AFTER_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000;

const fail = (code, message) => Object.assign(new Error(message), { code, status: 409, expose: true });

const INVOICE_KINDS = ['deposit', 'final', 'single'];

/**
 * Puts a send in the queue.
 *
 * @param {object} s  { docKind: 'estimate'|'invoice', docId, purpose?, versionId?,
 *                      toEmail, message?, scheduledFor: ISO }
 * @param {string} [now]  ISO
 * @returns {object} the row
 */
function addSend(db, s, now = nowIso()) {
  const id = newId('snd');
  db.prepare(`
    INSERT INTO sends (id, doc_kind, doc_id, purpose, version_id, to_email, message, scheduled_for,
                       status, late, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0, ?, ?)
  `).run(id, s.docKind, s.docId, s.purpose || 'document', s.versionId || null,
    String(s.toEmail || '').trim(), String(s.message || ''), s.scheduledFor, now, now);
  return getSend(db, id);
}

function getSend(db, id) {
  return db.prepare('SELECT * FROM sends WHERE id = ?').get(String(id)) || null;
}

/** A document's sends, newest first (the folder's rows read the first). */
function sendsFor(db, docKind, docId) {
  return db.prepare(`
    SELECT * FROM sends WHERE doc_kind = ? AND doc_id = ? AND purpose = 'document'
     ORDER BY scheduled_for DESC, created_at DESC, id DESC
  `).all(docKind, String(docId));
}

/** Changes a scheduled send's time, message or recipient. Only while it's `scheduled`. */
function editSend(db, id, patch, now = nowIso()) {
  return db.transaction(() => {
    const row = getSend(db, id);
    if (!row) throw Object.assign(new Error('not found'), { code: 'not_found', status: 404 });
    if (row.status !== 'scheduled') {
      throw fail('not_scheduled', 'This send has already gone out or been cancelled, so it can’t be changed.');
    }
    db.prepare(`
      UPDATE sends SET scheduled_for = ?, message = ?, to_email = ?, updated_at = ?
       WHERE id = ? AND status = 'scheduled'
    `).run(
      patch.scheduledFor !== undefined ? patch.scheduledFor : row.scheduled_for,
      patch.message !== undefined ? String(patch.message) : row.message,
      patch.toEmail !== undefined ? String(patch.toEmail).trim() : row.to_email,
      now, row.id,
    );
    return getSend(db, row.id);
  })();
}

/** Cancels a scheduled send. A send that's already gone, or is going, can't be called back. */
function cancelSend(db, id, now = nowIso()) {
  return db.transaction(() => {
    const row = getSend(db, id);
    if (!row) throw Object.assign(new Error('not found'), { code: 'not_found', status: 404 });
    if (row.status === 'cancelled') return row;
    const { changes } = db.prepare(`
      UPDATE sends SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'scheduled'
    `).run(now, row.id);
    if (!changes) throw fail('not_scheduled', 'This send has already gone out, so it can’t be cancelled.');
    return getSend(db, row.id);
  })();
}

/** A failed send, queued to go again now. Not "late": it was a retry. */
function retrySend(db, id, now = nowIso()) {
  return db.transaction(() => {
    const row = getSend(db, id);
    if (!row) throw Object.assign(new Error('not found'), { code: 'not_found', status: 404 });
    const { changes } = db.prepare(`
      UPDATE sends SET status = 'scheduled', scheduled_for = ?, error = NULL, late = 0, updated_at = ?
       WHERE id = ? AND status = 'failed'
    `).run(now, now, row.id);
    if (!changes) throw fail('not_failed', 'Only a send that failed can be retried.');
    return getSend(db, row.id);
  })();
}

/**
 * Takes every due send for itself. One transaction, and each row is moved
 * only if it is still `scheduled`, so a row can be claimed once.
 *
 * @returns {object[]} the rows claimed, as they were when claimed
 */
function claimDue(db, now = nowIso()) {
  return db.transaction(() => {
    const due = db.prepare(`
      SELECT * FROM sends WHERE status = 'scheduled' AND scheduled_for <= ?
       ORDER BY scheduled_for, created_at, id
    `).all(now);
    const claim = db.prepare("UPDATE sends SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'scheduled'");
    return due.filter((row) => claim.run(now, row.id).changes === 1);
  })();
}

/**
 * Whatever was `sending` when the server last stopped. Run once at boot,
 * before the first tick.
 *
 * @returns {number} how many rows
 */
function recoverInterrupted(db, now = nowIso()) {
  return db.prepare(`
    UPDATE sends SET status = 'failed', updated_at = ?,
           error = 'The server stopped while this was being sent, so it may or may not have gone out. Check with the client before sending it again.'
     WHERE status = 'sending'
  `).run(now).changes;
}

/* ── Building what a row sends ─────────────────────────────────────────── */

const businessOf = (db) => (readSettings(db).business || {});

/* The estimate or invoice a row is about, with what the email needs. */
function documentContext(db, row) {
  if (row.doc_kind === 'estimate') {
    const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(row.doc_id);
    if (!est) throw fail('doc_gone', 'The estimate this was for has been deleted.');
    const version = row.version_id ? db.prepare('SELECT * FROM estimate_versions WHERE id = ?').get(row.version_id) : null;
    const snap = version ? JSON.parse(version.snapshot_json) : null;
    const estimate = snap ? snap.estimate : null;
    const project = est.project_id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(est.project_id) : null;
    return {
      kind: 'estimate',
      token: est.public_token,
      upid: (project && project.upid) || est.upid || '',
      projectName: (estimate && estimate.name) || est.name || '',
      client: (estimate && estimate.client) || {},
      project,
      est,
      version,
    };
  }
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(row.doc_id);
  if (!inv) throw fail('doc_gone', 'The invoice this was for has been deleted.');
  if (!INVOICE_KINDS.includes(inv.kind)) throw fail('not_sendable', 'A legacy invoice can’t be emailed.');
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(inv.project_id);
  const estimate = inv.estimate_snapshot_json ? (JSON.parse(inv.estimate_snapshot_json) || {}) : {};
  return {
    kind: inv.kind,
    inv,
    token: inv.public_token,
    number: inv.number || '',
    upid: (project && project.upid) || '',
    projectName: estimate.name || '',
    client: estimate.client || {},
    project,
  };
}

/**
 * The email a row sends, or throws a `fail` the row will store.
 *
 * @returns {Promise<{to:string, mail:object, projectId:string|null}>}
 */
async function buildMail(db, row, ctx) {
  const business = businessOf(db);
  const appUrl = ctx.appUrl;

  if (row.purpose === 'document') {
    const doc = documentContext(db, row);
    if (doc.kind !== 'estimate' && doc.inv.status === 'void') throw fail('doc_void', 'This invoice was voided, so it won’t be sent.');
    if (!appUrl) throw fail('no_app_url', 'The server doesn’t know the app’s web address (APP_URL), so it can’t make the link.');
    let token = doc.token;
    if (!token && doc.kind === 'estimate') throw fail('no_link', 'This estimate has no client link yet (it hasn’t been sent as a version).');
    if (!token) {
      // An invoice's link is made the first time it's sent and kept (IA).
      token = newToken();
      db.prepare('UPDATE invoices SET public_token = ? WHERE id = ? AND public_token IS NULL').run(token, doc.inv.id);
      token = db.prepare('SELECT public_token FROM invoices WHERE id = ?').get(doc.inv.id).public_token;
    }
    const to = row.to_email || String(doc.client.email || '').trim();
    return {
      to,
      projectId: doc.project ? doc.project.id : null,
      mail: documentEmail({
        kind: doc.kind,
        businessName: business.name,
        upid: doc.upid,
        projectName: doc.projectName,
        number: doc.number,
        message: row.message,
        link: `${appUrl}c/#${doc.kind === 'estimate' ? 'e' : 'i'}/${token}`,
      }),
    };
  }

  // The two signing emails belong to one signature (the signed version's).
  const sig = db.prepare('SELECT id FROM signatures WHERE version_id = ?').get(row.version_id);
  const sigRow = sig ? signatureRow(db, sig.id) : null;
  if (!sigRow) throw fail('no_signature', 'The signature this was for can’t be found.');
  const doc = documentContext(db, row);
  if (row.purpose === 'owner_signed') {
    if (!appUrl) throw fail('no_app_url', 'The server doesn’t know the app’s web address (APP_URL), so it can’t make the link.');
    const logged = db.prepare("SELECT detail_json FROM activity WHERE project_id = ? AND kind = 'signed' ORDER BY at DESC LIMIT 1")
      .get(sigRow.project_id);
    const detail = logged ? JSON.parse(logged.detail_json || '{}') : {};
    return {
      to: row.to_email,
      projectId: sigRow.project_id,
      mail: ownerSignedEmail({
        clientName: doc.client.businessName,
        signedBy: sigRow.full_name,
        role: sigRow.role,
        upid: doc.upid,
        projectName: doc.projectName,
        invoiceProblem: detail.invoiceProblem,
        link: `${appUrl}#/projects/${sigRow.project_id}`,
      }),
    };
  }
  const pdf = await signaturePdf(db, sigRow, ctx.render);
  return {
    to: row.to_email || String(doc.client.email || '').trim(),
    projectId: sigRow.project_id,
    mail: {
      ...signedCopyEmail({
        businessName: business.name,
        contactName: doc.client.contactName,
        upid: doc.upid,
        projectName: doc.projectName,
      }),
      attachments: [{ filename: agreementFilename(sigRow), content: pdf, contentType: 'application/pdf' }],
    },
  };
}

/* ── The outbox: the tick, the kick, the boot sweep ────────────────────── */

/**
 * @param {object} db
 * @param {{send:function}} mailer   mail.js createMailer()
 * @param {object} [opts]
 * @param {function} [opts.now]      ISO time now
 * @param {string} [opts.appUrl]     where the pages are served, trailing slash
 * @param {function} [opts.render]   html → PDF buffer (for a signed copy made late)
 * @param {number} [opts.tickMs]
 */
function createOutbox(db, mailer, opts = {}) {
  const now = opts.now || nowIso;
  const ctx = { appUrl: opts.appUrl || '', render: opts.render };
  let timer = null;
  let running = Promise.resolve();

  async function deliver(row) {
    let outcome;
    try {
      const built = await buildMail(db, row, ctx);
      await mailer.send({ to: built.to, ...built.mail });
      outcome = { status: 'sent' };
    } catch (err) {
      outcome = { status: 'failed', error: String((err && err.message) || err).slice(0, 300) };
      console.error(`[mail] send ${row.id} (${row.purpose}) failed: ${err && err.code ? err.code : 'error'}`);
    }
    const at = now();
    if (outcome.status === 'sent') {
      const late = Date.parse(at) - Date.parse(row.scheduled_for) > LATE_AFTER_MS ? 1 : 0;
      db.prepare("UPDATE sends SET status = 'sent', sent_at = ?, late = ?, error = NULL, updated_at = ? WHERE id = ?")
        .run(at, late, at, row.id);
    } else {
      db.prepare("UPDATE sends SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(outcome.error, at, row.id);
    }
    return outcome.status;
  }

  /** Sends everything due now. Resolves to how many went out and how many failed. */
  function runDue() {
    // One pass at a time in this process; the claim makes overlap harmless
    // anyway, this just keeps a slow SMTP call from stacking ticks.
    const pass = running.then(async () => {
      const claimed = claimDue(db, now());
      const result = { sent: 0, failed: 0 };
      for (const row of claimed) {
        const status = await deliver(row);
        if (status === 'sent') result.sent += 1; else result.failed += 1;
      }
      return result;
    });
    running = pass.catch(() => {});
    return pass;
  }

  /** Fire and forget: for after a signing, where the email must not hold the reply. */
  function kick() {
    runDue().catch((err) => console.error('[mail] send pass failed:', err.message));
  }

  return {
    runDue,
    kick,
    /** The boot sweep, then a tick a minute. */
    start() {
      const recovered = recoverInterrupted(db, now());
      if (recovered) console.log(`[mail] ${recovered} send(s) were interrupted by the last shutdown and are marked failed`);
      kick();
      timer = setInterval(kick, opts.tickMs || TICK_MS);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/* ── Queuing the signing emails ────────────────────────────────────────── */

/**
 * Queues the owner's notice and the client's signed copy for one signature,
 * due now. Called inside signing's transaction, so they exist if and only if
 * the signature does; the caller kicks the outbox after it commits.
 *
 * @param {object} p  { estimateId, versionId, ownerEmail, clientEmail }
 */
function queueSigningEmails(db, p, now) {
  if (p.ownerEmail) {
    addSend(db, {
      docKind: 'estimate', docId: p.estimateId, purpose: 'owner_signed', versionId: p.versionId,
      toEmail: p.ownerEmail, scheduledFor: now,
    }, now);
  }
  if (p.clientEmail) {
    addSend(db, {
      docKind: 'estimate', docId: p.estimateId, purpose: 'client_signed_copy', versionId: p.versionId,
      toEmail: p.clientEmail, scheduledFor: now,
    }, now);
  }
}

module.exports = {
  addSend, getSend, sendsFor, editSend, cancelSend, retrySend, claimDue, recoverInterrupted,
  createOutbox, queueSigningEmails, LATE_AFTER_MS, TICK_MS,
};
