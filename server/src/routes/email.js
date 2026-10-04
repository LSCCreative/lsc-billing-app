'use strict';

/**
 * Email's owner routes (production-booking task 28): Settings → Email's status
 * and test, and the send queue's edit / cancel / retry that task 29's panel
 * calls. Creating a send belongs to that panel (it freezes the version).
 *
 * Never returns the SMTP key, or anything it could be read from.
 */

const { config } = require('../config');
const { readSettings } = require('../ratecard');
const { isEmail, testEmail } = require('../mail');
const { editSend, cancelSend, retrySend, getSend, sendsFor } = require('../sends');
const { nowIso } = require('../db');

const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);

/* Status and test: no database write, so mounted ahead of the pre-write
   snapshot, as the PDF routes are. */
function registerEmailRoutes(app, db, { mailer }) {
  app.get('/api/email/status', (_req, res) => {
    const failed = db.prepare("SELECT COUNT(*) AS n FROM sends WHERE status = 'failed'").get().n;
    const last = failed
      ? db.prepare("SELECT error, updated_at FROM sends WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 1").get()
      : null;
    res.json({
      ok: true,
      configured: mailer.configured,
      from: mailer.from,
      replyTo: mailer.replyTo,
      appUrl: config.appUrl,
      failed,
      lastError: last ? { message: last.error, at: last.updated_at } : null,
    });
  });

  // Sent straight away (not queued): the point is to see now whether the
  // connection works. To the Reply-To address unless one is given. The
  // provider refusing it is the test's answer, not a server fault: it replies
  // 200 { ok: false, message }, so the app's "the server ran into a problem"
  // banner (which any 5xx raises) stays down.
  app.post('/api/email/test', async (req, res, next) => {
    const to = String((req.body || {}).to || mailer.replyTo || '').trim();
    if (!mailer.configured) {
      return res.status(409).json({ error: 'not_configured', message: 'Email isn’t set up yet: the SMTP key and From address are missing from the server’s settings.' });
    }
    if (!isEmail(to)) return res.status(400).json({ error: 'bad_recipient', message: 'Type an email address to send the test to.' });
    try {
      await mailer.send({ to, ...testEmail({ businessName: (readSettings(db).business || {}).name }) });
      return res.json({ ok: true, to });
    } catch (err) {
      if (err.code === 'bad_recipient') return res.status(400).json({ error: err.code, message: err.message });
      if (err.code === 'send_failed' || err.code === 'not_configured') {
        return res.json({ ok: false, error: 'send_failed', message: err.message });
      }
      return next(err);
    }
  });
}

/* The queue's rows: writes, so after the snapshot. */
function registerSendRoutes(app, db, { outbox }) {
  const row = (req, res) => {
    const found = getSend(db, req.params.id);
    if (!found) {
      res.status(404).json({ error: 'not_found' });
      return null;
    }
    return found;
  };
  const shown = (s) => ({
    id: s.id, docKind: s.doc_kind, docId: s.doc_id, purpose: s.purpose, to: s.to_email, message: s.message,
    scheduledFor: s.scheduled_for, status: s.status, sentAt: s.sent_at, late: Boolean(s.late), error: s.error,
  });
  const refuse = (res, err) => {
    if (err.status) return res.status(err.status).json({ error: err.code || 'refused', message: err.message });
    throw err;
  };

  app.get('/api/sends', (req, res) => {
    const { docKind, docId } = req.query;
    if (!['estimate', 'invoice'].includes(docKind) || !docId) return res.status(400).json({ error: 'doc_required' });
    return res.json({ ok: true, sends: sendsFor(db, docKind, docId).map(shown) });
  });

  app.put('/api/sends/:id', (req, res) => {
    if (!row(req, res)) return undefined;
    const b = req.body || {};
    const patch = {};
    if (b.scheduledFor !== undefined) {
      if (!isIso(b.scheduledFor)) return res.status(400).json({ error: 'scheduled_for_invalid' });
      patch.scheduledFor = new Date(b.scheduledFor).toISOString();
    }
    if (b.message !== undefined) {
      if (typeof b.message !== 'string' || b.message.length > 5000) return res.status(400).json({ error: 'message_invalid' });
      patch.message = b.message;
    }
    if (b.to !== undefined) {
      if (!isEmail(b.to)) return res.status(400).json({ error: 'bad_recipient', message: 'That email address isn’t valid.' });
      patch.toEmail = b.to;
    }
    try {
      const out = editSend(db, req.params.id, patch, nowIso());
      outbox.kick();
      return res.json({ ok: true, send: shown(out) });
    } catch (err) {
      return refuse(res, err);
    }
  });

  app.post('/api/sends/:id/cancel', (req, res) => {
    if (!row(req, res)) return undefined;
    try {
      return res.json({ ok: true, send: shown(cancelSend(db, req.params.id, nowIso())) });
    } catch (err) {
      return refuse(res, err);
    }
  });

  app.post('/api/sends/:id/retry', (req, res) => {
    if (!row(req, res)) return undefined;
    try {
      const out = retrySend(db, req.params.id, nowIso());
      outbox.kick();
      return res.json({ ok: true, send: shown(out) });
    } catch (err) {
      return refuse(res, err);
    }
  });
}

module.exports = { registerEmailRoutes, registerSendRoutes };
