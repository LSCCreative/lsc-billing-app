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

/* The look (ui-clarity D2; U7, U8) is the client page's: paper, the logo and
   wordmark over a terracotta rule, a white card, a terracotta button, the
   business's details beneath. Hex rather than tokens, because mail clients
   take inline styles only; the values are tokens.css's light theme. */
const C = {
  paper: '#F0EDE8',  // --lsc-white
  card: '#FFFFFF',
  edge: '#DDD6CC',   // the card's hairline
  ink: '#0E0E0E',    // --lsc-black
  muted: '#625C58',  // light --color-text-secondary: 6.6:1 on the card, 5.6:1 on paper
  mark: '#C0603C',   // --lsc-terra: the rule and the wordmark's "Creative." (24px bold)
  button: '#8C4832', // --lsc-terra-dk: white on it is 6.8:1
};
/* The client page's Delight and CS Felice Mono, loaded from Pages under names
   of their own (an installed copy of either, with its own faces, is never
   picked up instead). Apple Mail shows them; Gmail and Outlook drop the
   @font-face, and Delight, a sans, falls back to Helvetica or Arial. */
const SANS = "'LSC Delight','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'LSC Felice Mono',Menlo,Consolas,'Courier New',monospace";
const SITE = { url: 'https://lsccreative.studio', label: 'lsccreative.studio' };

/* APP_URL, where Pages serves the app, with one trailing slash: the base of
   the logo and fonts. An email has no page to resolve a relative address
   against, so '' (no APP_URL) means none of them: the email goes without,
   and the wordmark still says who sent it. */
const assetsOf = (appUrl) => (/^https?:\/\/\S+$/.test(String(appUrl || '').trim())
  ? `${String(appUrl).trim().replace(/\/+$/, '')}/`
  : '');

/** The emails' logo (web/email/logo.png): a hosted PNG, because Gmail and
    Outlook block SVG and attached images (U7). */
const logoUrlOf = (appUrl) => (assetsOf(appUrl) ? `${assetsOf(appUrl)}email/logo.png` : '');

/* The <head>'s styles: the fonts, and Outlook on Windows told to use Arial
   (it falls back to Times when a stack starts with a font it lacks). */
function headStyles(assets) {
  const face = (name, file, weight) =>
    `@font-face{font-family:'${name}';src:url('${esc(assets)}fonts/${file}') format('woff2');font-weight:${weight};font-style:normal}`;
  return (assets
    ? `<style>${face('LSC Delight', 'Delight-400.woff2', 400)}${face('LSC Delight', 'Delight-700.woff2', 700)}` +
      `${face('LSC Felice Mono', 'CSFeliceMono-Regular.woff2', 400)}</style>`
    : '') +
    '<!--[if mso]><style>body,table,td,p,a,h1,span,div{font-family:Arial,sans-serif !important}</style><![endif]-->';
}

/* settings.business ({ name, abn, email, phone }), or an older caller's bare
   `businessName`. */
function businessOf(v) {
  const b = (v && v.business) || {};
  const s = (x) => String(x == null ? '' : x).trim();
  return { name: s(b.name || (v && v.businessName)) || 'LSC Creative', abn: s(b.abn), email: s(b.email), phone: s(b.phone) };
}

/* "12345678901" → "12 345 678 901", as pdf.js prints it. */
function formatAbn(abn) {
  const digits = abn.replace(/\D/g, '');
  return digits.length === 11 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : abn;
}

const quiet = (href, text) => `<a href="${esc(href)}" style="color:${C.muted};text-decoration:underline">${esc(text)}</a>`;

/* The client footer: name · ABN · email · phone · site, only the parts that
   are set. Each part holds together, so a narrow screen breaks between them. */
function clientFooter(b) {
  const phone = b.phone.replace(/[^\d+]/g, '');
  return [
    esc(b.name),
    b.abn ? `ABN ${esc(formatAbn(b.abn))}` : '',
    b.email ? (isEmail(b.email) ? quiet(`mailto:${b.email}`, b.email) : esc(b.email)) : '',
    b.phone ? (phone ? quiet(`tel:${phone}`, b.phone) : esc(b.phone)) : '',
    quiet(SITE.url, SITE.label),
  ].filter(Boolean).map((part) => `<span style="white-space:nowrap">${part}</span>`).join('&nbsp;&middot; ');
}

/* The inbox's preview line: the card's first words, rather than the logo's
   alt text and the wordmark, which come first in the markup. The padding
   keeps a client from filling the rest of the line with the body. */
function preheader(bodyHtml) {
  let t = bodyHtml.replace(/<br>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > 140) t = `${t.slice(0, 140).replace(/&[^;\s]*$/, '').replace(/\s+\S*$/, '')}…`;
  return t ? t + '&nbsp;&zwnj;'.repeat(40) : '';
}

/**
 * One shell for every email (task 16): tables and inline styles, the way mail
 * clients need them; 560px wide and readable at 320; and readable with
 * images off, since the wordmark is text and the button's address is printed
 * beneath it.
 *
 * @param {{heading:string, sub?:string, bodyHtml:string,
 *          button?:{label:string, url:string}, business:object,
 *          appUrl?:string, owner?:boolean}} v
 *   `sub`: the project line under the heading. `business`: businessOf()'s.
 *   `appUrl`: where the logo and fonts are served (APP_URL).
 *   `owner`: a notice to the owner, without the client footer.
 */
function shell({ heading, sub, bodyHtml, button, business, appUrl, owner }) {
  const b = business || businessOf({});
  const assets = assetsOf(appUrl);
  const logoUrl = logoUrlOf(appUrl);
  const table = (attrs, rows) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${attrs}>${rows}</table>`;
  const logo = logoUrl
    ? `<td valign="middle" style="padding:0 14px 0 0"><img src="${esc(logoUrl)}" width="96" height="56" alt="LSC Creative" ` +
      `style="display:block;width:96px;height:56px;border:0;outline:none;text-decoration:none;font-family:${MONO};font-size:12px;line-height:16px;color:${C.muted}"></td>`
    : '';
  const mast = `<tr><td style="padding:0 0 14px;border-bottom:3px solid ${C.mark}">` +
    table('', `<tr>${logo}<td valign="middle" style="font-family:${SANS};font-size:24px;line-height:28px;font-weight:700;letter-spacing:-0.01em;color:${C.ink}">` +
      `LSC <span style="color:${C.mark}">Creative.</span></td></tr>`) +
    '</td></tr>';
  const cta = button
    ? table(' width="100%" style="margin:10px 0 0"',
      `<tr><td align="center" bgcolor="${C.button}" style="background:${C.button};border-radius:8px">` +
      `<a href="${esc(button.url)}" style="display:block;padding:14px 20px;font-family:${SANS};font-size:17px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px">${esc(button.label)}</a>` +
      '</td></tr>') +
      `<p style="margin:14px 0 0;font-family:${MONO};font-size:13px;line-height:1.5;color:${C.muted}">Or paste this address into your browser:<br>` +
      `<span style="word-break:break-all">${quiet(button.url, button.url)}</span></p>`
    : '';
  const card = '<tr><td style="padding:22px 0 0">' +
    table(` width="100%" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.edge};border-radius:8px"`,
      `<tr><td style="padding:28px 24px ${button ? 26 : 14}px;font-family:${SANS};font-size:17px;line-height:1.55;color:${C.ink};text-align:left">` +
      `<h1 style="margin:0;font-family:${SANS};font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;color:${C.ink}">${esc(heading)}</h1>` +
      (sub ? `<p style="margin:6px 0 0;font-family:${MONO};font-size:14px;line-height:1.45;color:${C.muted}">${esc(sub)}</p>` : '') +
      `<div style="margin:20px 0 0">${bodyHtml}</div>${cta}</td></tr>`) +
    '</td></tr>';
  const foot = `<tr><td style="padding:18px 2px 0;font-family:${MONO};font-size:12px;line-height:1.7;color:${C.muted};text-align:left">` +
    (owner ? `${esc(b.name)} billing app` : clientFooter(b)) + '</td></tr>';
  return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">' +
    `<title>${esc(heading)}</title>${headStyles(assets)}</head>` +
    `<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;text-size-adjust:100%">` +
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader(bodyHtml)}</div>` +
    table(` width="100%" bgcolor="${C.paper}" style="background:${C.paper}"`,
      '<tr><td align="center" style="padding:28px 12px 40px">' +
      // Outlook on Windows ignores max-width: a fixed column for it alone.
      '<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->' +
      table(' width="100%" style="max-width:560px;text-align:left"', mast + card + foot) +
      '<!--[if mso]></td></tr></table><![endif]-->' +
      '</td></tr>') +
    '</body></html>';
}

const line = (...parts) => parts.filter(Boolean).join(' · ');

/* What the client is told it is: an estimate is a "quote" to them (D103). */
const KIND_WORDS = {
  estimate: { noun: 'Quote', button: 'View the quote' },
  deposit: { noun: 'Deposit invoice', button: 'View the invoice' },
  final: { noun: 'Final invoice', button: 'View the invoice' },
  single: { noun: 'Invoice', button: 'View the invoice' },
};

/*
 * Every template takes, besides its own values, `business` (settings.business;
 * a bare `businessName` still works) and `appUrl` (APP_URL, for the logo and
 * fonts).
 */

/**
 * The estimate or invoice going to the client, with the owner's message.
 *
 * @param {{kind:'estimate'|'deposit'|'final'|'single', business:object,
 *          appUrl:string, upid:string, projectName:string, number?:string,
 *          message:string, link:string}} v
 */
function documentEmail(v) {
  if (v.update) return updateEmail(v);
  const words = KIND_WORDS[v.kind] || KIND_WORDS.single;
  const label = v.kind === 'estimate' ? (v.upid || '') : (v.number || v.upid || '');
  const b = businessOf(v);
  const business = b.name;
  const subject = `${words.noun}${label ? ` ${label}` : ''}${v.projectName ? `: ${v.projectName}` : ''} · ${business}`;
  const text = [
    String(v.message || '').trim(),
    `${words.button}: ${v.link}`,
    business,
  ].filter(Boolean).join('\n\n');
  const html = shell({
    heading: `${words.noun}${label ? ` ${label}` : ''}`,
    sub: v.projectName,
    bodyHtml: paragraphs(v.message),
    button: { label: words.button, url: v.link },
    business: b,
    appUrl: v.appUrl,
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
  const b = businessOf(v);
  const business = b.name;
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
    sub: line(v.projectName, ref),
    bodyHtml: paragraphs(said) + paragraphs(v.message),
    button: { label: button, url: v.link },
    business: b,
    appUrl: v.appUrl,
  });
  return { subject, text, html };
}

/* "4 Oct" from 'YYYY-MM-DD'. */
const shortDay = (ymd) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/* What signing did to the days (D18): all confirmed, or which were flagged
   because another project had confirmed that date first (C5). */
function daysLine(rebook) {
  const dates = (Array.isArray(rebook) ? rebook : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)));
  if (!dates.length) return 'The days are confirmed.';
  const list = dates.map(shortDay);
  const named = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `The days are confirmed, but ${named} ${dates.length === 1 ? 'was' : 'were'} already confirmed by another project: ` +
    `${dates.length === 1 ? 'it’s' : 'they’re'} flagged “clash, rebook”. Sort ${dates.length === 1 ? 'it' : 'them'} out with the client.`;
}

/**
 * The owner's notice that a client signed (D41).
 *
 * @param {{clientName:string, signedBy:string, role:string, upid:string,
 *          projectName:string, link:string, invoiceProblem?:string,
 *          rebook?:string[], business:object, appUrl:string}} v
 *          `rebook`: the dates flagged as clashes
 */
function ownerSignedEmail(v) {
  const who = v.clientName || v.signedBy;
  const subject = `${who} signed ${v.upid || 'an estimate'}${v.projectName ? `: ${v.projectName}` : ''}`;
  const lines = [
    `${v.signedBy}${v.role ? `, ${v.role},` : ''} signed and accepted the estimate for ${v.projectName || v.upid}.`,
    daysLine(v.rebook) + ' ' + (v.invoiceProblem
      ? 'The invoices weren’t made (the project needs a UPID or its invoice numbers are taken). Open the project and use Create invoices.'
      : 'The invoices are made.'),
  ];
  const html = shell({
    heading: `${who} signed the estimate`,
    sub: line(v.projectName, v.upid),
    bodyHtml: lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join(''),
    button: { label: 'Open the project', url: v.link },
    business: businessOf(v),
    appUrl: v.appUrl,
    owner: true,
  });
  return { subject, text: `${lines.join('\n\n')}\n\nOpen the project: ${v.link}`, html };
}

/**
 * The client's copy of what they signed, the PDF attached (D41, D66).
 *
 * @param {{business:object, appUrl:string, contactName:string, upid:string,
 *          projectName:string}} v
 */
function signedCopyEmail(v) {
  const b = businessOf(v);
  const business = b.name;
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
      sub: line(v.projectName, v.upid),
      bodyHtml: lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join(''),
      business: b,
      appUrl: v.appUrl,
    }),
  };
}

/* "Tue 3 Nov" from 'YYYY-MM-DD'; a day with no date is "a day still to be dated". */
const crewDay = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))
  ? new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(/,/g, '')
  : null);

/* "Tue 3 Nov", "Tue 3 Nov and Wed 4 Nov", "Tue 3 Nov, Wed 4 Nov and 1 day still to be dated". */
function crewDays(dates) {
  const list = (Array.isArray(dates) ? dates : []).map(crewDay);
  const dated = list.filter(Boolean);
  const tbc = list.length - dated.length;
  const parts = dated.concat(tbc ? [`${tbc} day${tbc === 1 ? '' : 's'} still to be dated`] : []);
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The call sheet, to crew (trip-planner task 11; T13, I4): its link, never a
 * price. Each person gets their own copy, so no one sees who else was sent
 * it. The page always shows the latest saved trips (T18), and the email says
 * so, so an early email is still the one to keep. Crew are outside the
 * business, so it carries the client footer.
 *
 * @param {{business:object, appUrl:string, upid:string, projectName:string,
 *          note:string, link:string, dates:(string|null)[]}} v  `dates`:
 *          each day's 'YYYY-MM-DD', or null for one with no date yet
 */
function callSheetEmail(v) {
  const b = businessOf(v);
  const business = b.name;
  const days = crewDays(v.dates);
  const subject = ['Call sheet', v.upid, v.projectName].filter(Boolean).join(' · ');
  const said = `${business} has shared the call sheet${v.projectName ? ` for ${v.projectName}` : ''}${days ? `: ${days}` : ''}. ` +
    'It has each day’s route, the stops with their times, and the location and access details. ' +
    'The link always shows the latest schedule.';
  const button = 'View the call sheet';
  const text = [said, String(v.note || '').trim(), `${button}: ${v.link}`, business].filter(Boolean).join('\n\n');
  const html = shell({
    heading: 'Call sheet',
    sub: line(v.projectName, v.upid),
    bodyHtml: paragraphs(said) + paragraphs(v.note),
    button: { label: button, url: v.link },
    business: b,
    appUrl: v.appUrl,
  });
  return { subject, text, html };
}

/** Settings → Email's "Send a test email": in the clients' dress, footer and
    all, since checking how they see it is what it's for. */
function testEmail(v = {}) {
  const b = businessOf(v);
  const text = 'This is a test email from the billing app. If you can read it, email is connected.';
  return {
    subject: `Test email · ${b.name}`,
    text,
    html: shell({ heading: 'Email is connected', bodyHtml: paragraphs(text), business: b, appUrl: v.appUrl }),
  };
}

/**
 * "Forgot password" (.design/account-recovery/): the one-time link to the
 * billing app's reset page. Says who asked, how long the link lasts, and that
 * ignoring it changes nothing. It goes to the owner, so no client footer.
 *
 * @param {{username:string, link:string, minutes:number, business?:object,
 *          appUrl?:string}} v
 */
function passwordResetEmail(v) {
  const b = businessOf(v);
  const business = b.name;
  const lines = [
    `Someone asked to reset the password for ${v.username ? `“${v.username}”` : 'your account'} on the billing app.`,
    `The button below lets you choose a new one. It works once, for the next ${v.minutes} minutes.`,
    'If you didn’t ask for this, ignore this email: your password stays as it is.',
  ];
  return {
    subject: `Reset your billing app password · ${business}`,
    text: `${lines.join('\n\n')}\n\nReset your password: ${v.link}\n\n${business}`,
    html: shell({
      heading: 'Reset your password',
      bodyHtml: lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join(''),
      button: { label: 'Reset your password', url: v.link },
      business: b,
      appUrl: v.appUrl,
      owner: true,
    }),
  };
}

module.exports = {
  createMailer, isEmail, NOT_CONFIGURED, logoUrlOf,
  documentEmail, ownerSignedEmail, signedCopyEmail, testEmail, passwordResetEmail, callSheetEmail,
};
