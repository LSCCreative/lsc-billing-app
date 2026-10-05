'use strict';

/**
 * Outgoing email (production-booking task 28; D43, D47, D102).
 *
 * Plain SMTP through nodemailer, configured from .env (config.js): Resend
 * today, and a provider change is an .env edit. The API key is `smtp.pass`. It
 * is never logged, never stored in the database, and scrubbed out of any error
 * text that leaves this file.
 *
 * `createMailer(config, { transport })` takes a transport so tests and the
 * scratch server can stand one in; with none it builds the real SMTP one the
 * first time something is sent.
 *
 * The templates at the bottom are pure: they take plain values and return
 * { subject, text, html }, so a test can read exactly what a client is sent.
 */

const nodemailer = require('nodemailer');

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim());

/** What the owner is told when email isn't connected. */
const NOT_CONFIGURED = 'Email isn’t set up yet: the SMTP key and From address are missing from the server’s settings.';

function createMailer(cfg, { transport } = {}) {
  const smtp = (cfg && cfg.smtp) || {};
  const from = (cfg && cfg.mailFrom) || '';
  const replyTo = (cfg && cfg.mailReplyTo) || '';
  const configured = Boolean(transport || (smtp.pass && from));
  let live = transport || null;

  function transporter() {
    if (!live) {
      live = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        // 465 is implicit TLS; the other ports (587, 2587) upgrade with STARTTLS.
        secure: Number(smtp.port) === 465,
        auth: { user: smtp.user, pass: smtp.pass },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
      });
    }
    return live;
  }

  /* An error's text with the key taken out, and short enough to store. */
  function safeError(err) {
    let text = String((err && err.message) || err || 'The email could not be sent.');
    if (smtp.pass) text = text.split(smtp.pass).join('…');
    return text.replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  return {
    configured,
    from,
    replyTo,
    /**
     * @param {{to:string, subject:string, text:string, html:string,
     *          attachments?:{filename:string, content:Buffer, contentType?:string}[]}} mail
     * @returns {Promise<{messageId:string}>}
     * @throws an Error whose `.message` is safe to store and show
     */
    async send(mail) {
      if (!configured) {
        const err = new Error(NOT_CONFIGURED);
        err.code = 'not_configured';
        throw err;
      }
      if (!isEmail(mail.to)) {
        const err = new Error('The recipient’s email address isn’t valid.');
        err.code = 'bad_recipient';
        throw err;
      }
      try {
        const info = await transporter().sendMail({
          from,
          to: mail.to.trim(),
          ...(replyTo ? { replyTo } : {}),
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          attachments: mail.attachments || [],
        });
        return { messageId: String((info && info.messageId) || '') };
      } catch (err) {
        const out = new Error(safeError(err));
        out.code = 'send_failed';
        throw out;
      }
    },
  };
}

/* ── Templates ─────────────────────────────────────────────────────────── */

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* The user's message is plain text: its line breaks stay, nothing in it is
   markup. */
const paragraphs = (text) => String(text || '').split(/\n{2,}/)
  .map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

/* One shell for every email: plain, readable on a phone, no images to load. */
function shell({ heading, bodyHtml, button, footer }) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2">' +
    '<div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1d1d1b">' +
    `<h1 style="font-size:20px;line-height:1.3;margin:0 0 18px">${esc(heading)}</h1>` +
    bodyHtml +
    (button
      ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#1d1d1b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">${esc(button.label)}</a></p>` +
        `<p style="margin:0 0 14px;font-size:13px;color:#666">Or paste this address into your browser:<br>${esc(button.url)}</p>`
      : '') +
    (footer ? `<p style="margin:26px 0 0;font-size:13px;color:#666">${esc(footer)}</p>` : '') +
    '</div></body></html>';
}

/* What the client is told it is: an estimate is a "quote" to them (D103). */
const KIND_WORDS = {
  estimate: { noun: 'Quote', button: 'View the quote' },
  deposit: { noun: 'Deposit invoice', button: 'View the invoice' },
  final: { noun: 'Final invoice', button: 'View the invoice' },
  single: { noun: 'Invoice', button: 'View the invoice' },
};

/**
 * The estimate or invoice going to the client, with the owner's message.
 *
 * @param {{kind:'estimate'|'deposit'|'final'|'single', businessName:string,
 *          upid:string, projectName:string, number?:string, message:string,
 *          link:string}} v
 */
function documentEmail(v) {
  if (v.update) return updateEmail(v);
  const words = KIND_WORDS[v.kind] || KIND_WORDS.single;
  const label = v.kind === 'estimate' ? (v.upid || '') : (v.number || v.upid || '');
  const business = v.businessName || 'LSC Creative';
  const subject = `${words.noun}${label ? ` ${label}` : ''}${v.projectName ? `: ${v.projectName}` : ''} · ${business}`;
  const text = [
    String(v.message || '').trim(),
    `${words.button}: ${v.link}`,
    business,
  ].filter(Boolean).join('\n\n');
  const html = shell({
    heading: `${words.noun}${label ? ` ${label}` : ''}`,
    bodyHtml: (v.projectName ? `<p style="margin:0 0 14px;color:#666">${esc(v.projectName)}</p>` : '') + paragraphs(v.message),
    button: { label: words.button, url: v.link },
    footer: business,
  });
  return { subject, text, html };
}

/**
 * A document the client already had, changed (task 33 C2; the user's rule of
 * 2026-10-05): a quote's second or later version, or an invoice made to
 * replace a voided one. "Quote update: <project> (<UPID>)". It says what
 * happened before the owner's message, and that the earlier link leads to the
 * new one too: a quote's link always opens its newest version, and a voided
 * invoice's page points to its replacement.
 *
 * @param {object} v  documentEmail's, plus `update: true` and, for an
 *                    invoice, `replaces` (the voided invoice's number)
 */
function updateEmail(v) {
  const quote = v.kind === 'estimate';
  const noun = quote ? 'quote' : 'invoice';
  const business = v.businessName || 'LSC Creative';
  const ref = quote ? v.upid : (v.number || v.upid);
  const title = `${quote ? 'Quote' : 'Invoice'} update`;
  const subject = `${title}${v.projectName ? `: ${v.projectName}` : ''}${ref ? ` (${ref})` : ''}`;
  const said = [
    `${business} has updated your ${noun}${v.projectName ? ` for ${v.projectName}` : ''}.`,
    quote
      ? 'The button below opens the updated quote, and so does the link in any earlier email about it.'
      : `It replaces ${v.replaces || 'the earlier invoice'}, which no longer needs paying. The button below opens it, and the earlier invoice’s page links to it too.`,
  ].join(' ');
  const button = `View the updated ${noun}`;
  const text = [said, String(v.message || '').trim(), `${button}: ${v.link}`, business].filter(Boolean).join('\n\n');
  const html = shell({
    heading: title,
    bodyHtml: (v.projectName ? `<p style="margin:0 0 14px;color:#666">${esc(v.projectName)}${ref ? ` · ${esc(ref)}` : ''}</p>` : '') +
      paragraphs(said) + paragraphs(v.message),
    button: { label: button, url: v.link },
    footer: business,
  });
  return { subject, text, html };
}

/**
 * The owner's notice that a client signed (D41).
 *
 * @param {{clientName:string, signedBy:string, role:string, upid:string,
 *          projectName:string, link:string, invoiceProblem?:string}} v
 */
function ownerSignedEmail(v) {
  const who = v.clientName || v.signedBy;
  const subject = `${who} signed ${v.upid || 'an estimate'}${v.projectName ? `: ${v.projectName}` : ''}`;
  const lines = [
    `${v.signedBy}${v.role ? `, ${v.role},` : ''} signed and accepted the estimate for ${v.projectName || v.upid}.`,
    v.invoiceProblem
      ? 'The invoices weren’t made (the project needs a UPID or its invoice numbers are taken). Open the project and use Create invoices.'
      : 'The days are confirmed and the invoices are made.',
  ];
  const html = shell({
    heading: `${who} signed the estimate`,
    bodyHtml: lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join(''),
    button: { label: 'Open the project', url: v.link },
  });
  return { subject, text: `${lines.join('\n\n')}\n\nOpen the project: ${v.link}`, html };
}

/**
 * The client's copy of what they signed, the PDF attached (D41, D66).
 *
 * @param {{businessName:string, contactName:string, upid:string,
 *          projectName:string}} v
 */
function signedCopyEmail(v) {
  const business = v.businessName || 'LSC Creative';
  const hello = v.contactName ? `Hi ${v.contactName},` : 'Hi,';
  const lines = [
    hello,
    `Thanks for accepting the quote${v.projectName ? ` for ${v.projectName}` : ''}. Your signed service agreement is attached for your records.`,
    'We’ll be in touch about the next steps. Reply to this email if you have any questions.',
  ];
  return {
    subject: `Your signed agreement${v.upid ? ` ${v.upid}` : ''}${v.projectName ? `: ${v.projectName}` : ''} · ${business}`,
    text: `${lines.join('\n\n')}\n\n${business}`,
    html: shell({
      heading: 'Your signed agreement',
      bodyHtml: lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join(''),
      footer: business,
    }),
  };
}

/** Settings → Email's "Send a test email". */
function testEmail({ businessName } = {}) {
  const business = businessName || 'LSC Creative';
  const text = 'This is a test email from the billing app. If you can read it, email is connected.';
  return {
    subject: `Test email · ${business}`,
    text,
    html: shell({ heading: 'Email is connected', bodyHtml: paragraphs(text), footer: business }),
  };
}

module.exports = {
  createMailer, isEmail, NOT_CONFIGURED,
  documentEmail, ownerSignedEmail, signedCopyEmail, testEmail,
};
