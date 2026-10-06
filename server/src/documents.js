/**
 * The estimate and invoice settings, and the service agreement's fill-in
 * fields (production-booking task 21; D33, D39, D43, D44, D55).
 *
 * Sibling of calc.js and subject to the same rule: web/js/documents.js is a
 * byte-identical copy, and test/test-documents.js fails if the two drift. The
 * Settings screen previews an agreement with a project through this file, and
 * stage E's signing fills the text it stores through it too, so a preview can
 * never read differently from what a client signs. Pure: no database, no DOM,
 * no other module.
 *
 * Wrapped in a function so its names (MONTHS, dayDate, …) stay out of the
 * browser's one shared global scope, as depreciation.js is.
 *
 * WHERE THE SETTINGS LIVE
 * Inside the one settings document (GET/PUT /api/settings):
 *   invoicing: { depositPct, validDays, dueDays }
 *   messages:  { estimate, deposit, final, single }
 *   agreement: { intro, clauses, hourlyRate, faqUrl }   (ui-clarity task 4)
 * A database saved before task 21 has none of them, so every reader goes
 * through docSettings(), which fills what's missing from DOC_DEFAULTS. A
 * message or FAQ URL cleared on purpose is kept cleared: '' is a choice
 * (D55: a cleared FAQ URL hides the button), only a missing one is a default.
 *
 * THE AGREEMENT (ui-clarity U9–U14, U22)
 * Clauses are stored in order and never numbered: agreementText() numbers
 * them as it renders, letters their sub-clauses, and puts the fixed header
 * above them. A settings row with no `clauses` reads as the LSC defaults
 * below. The old free-text `agreement.text` is retired; agreements already
 * signed keep the exact text they were signed with and are never re-rendered.
 */

(function () {
  'use strict';

  const DOC_DEFAULTS = Object.freeze({
    depositPct: 50, // D33
    validDays: 30, // D44
    dueDays: 14, // the invoice screen's due date, before task 21 a constant
    messages: Object.freeze({
      estimate: 'Here’s the quote for your project. You can look it over and accept it online from the link below.',
      deposit: 'Here’s the project deposit invoice. Payment details are on the invoice.',
      final: 'Here’s the final invoice for your project. Payment details are on the invoice.',
      single: 'Here’s the invoice for your project. Payment details are on the invoice.',
    }),
    faqUrl: 'https://lsccreative.studio/faq.html', // D55
    agreementIntro: 'This agreement outlines the commitment to provide a professional media production, as detailed in the Quote.',
    hourlyRate: 63, // {hourly_rate}, the $63.00 in the user's Revisions clause (U13)
  });

  /* The user's 12 clauses (U13), verbatim but for two changes: the typed
     "a." / "(i)" prefixes are now sub-clauses, which the render letters, and
     "$63.00" is {hourly_rate}. test-documents.js turns these back into the
     user's original text and compares them, so an edit here is caught. None is
     deposit-only: clause 2 also holds the GST and late-payment terms, which a
     single invoice needs too. */
  const sub = (id, heading, text, indent) => ({ id, heading, text, indent: indent ? 1 : 0 });
  const DEFAULT_CLAUSES = [
    { id: 'c01', title: 'Services and Deliverables', subs: [],
      body: 'The Business will provide the services and deliverables described in the Quote. Where this Agreement and the Quote conflict, this Agreement prevails, except that the Quote governs scope line items and pricing.' },
    { id: 'c02', title: 'Payment', subs: [],
      body: 'A non-refundable deposit of {deposit_pct} is required before the Business commences capture. The balance is due on the date shown on the final invoice. All amounts are in Australian Dollars (AUD). LSC Creative is not currently registered for GST and no GST is charged on this Agreement.\n\nLate payment. Overdue amounts attract interest at 10% per annum from 40 days after the due date. While any amount is overdue, the Business may suspend further work and withhold deliverables. The Client must pay the Business\'s reasonable costs of recovering overdue amounts, including debt-recovery agency and legal costs.' },
    { id: 'c03', title: 'Revisions', subs: [],
      body: 'The Client is entitled to two (2) rounds of minor revisions to the draft video(s). Each round is one consolidated list of changes. Further rounds, or changes that materially alter the agreed scope, are charged at the Business\'s standard hourly rate of AUD {hourly_rate} following Client approval of a quote. Deliverables are deemed approved if no revision request is received within 14 business days of delivery.' },
    { id: 'c04', title: 'Intellectual Property and Usage Rights', body: '', subs: [
      sub('c04a', 'Raw materials', 'All raw footage, project files and other original creative work remain the exclusive property of the Business. They may be supplied on request for a separately agreed fee. The Business retains raw materials for 6 months from final delivery, after which they may be deleted without further notice.'),
      sub('c04b', 'Client licence', 'From the date of delivery the Client may use the final deliverables for its promotional, marketing and internal communication purposes across online platforms, social media, websites and presentations. If the balance is not paid in full within 30 days of delivery, this licence automatically expires and any continued use is unlicensed. On receipt of payment in full the licence becomes perpetual, non-exclusive and irrevocable. It does not include the right to sell the deliverables to third parties.'),
      sub('c04c', 'Portfolio use', 'The Business may use the final video(s), excerpts and behind-the-scenes material for its own archival, portfolio and promotional purposes, including its website, social media and award submissions, unless otherwise agreed in writing before services commence.'),
    ] },
    { id: 'c05', title: 'Client Materials, Releases and Music', subs: [],
      body: 'The Client warrants that all materials it supplies (including logos, music, brand assets and brand messaging) are cleared for the intended use. The Client assumes full responsibility for all content, statements, and brand messaging included in the final media deliverables, and fully indemnifies the Business against any legal claims (including public liability, defamation, or regulatory action) arising from what is said or depicted in the media. Unless the Quote states otherwise, the Client is responsible for location access, permits and location fees, and for obtaining talent and property releases for its people and premises. Licensed music is cleared only for the specified use and not for reuse in other productions.' },
    { id: 'c06', title: 'Delays, Weather and Force Majeure', subs: [],
      body: 'Where the Client, its talent or its locations are unavailable through no fault of the Business, standby time, crew waiting time and reshoots may be charged at the Business\'s standard rates. Neither party is liable for delay caused by events beyond its reasonable control, including severe weather. Outdoor and on-water shoots may be rescheduled on a weather call without penalty to either party.' },
    { id: 'c07', title: 'Cancellation and Postponement', body: '', subs: [
      sub('c07a', 'By the Client', ''),
      sub('c07a1', '', 'If the Client cancels after signing but before capture begins, the deposit is forfeited to cover administrative and pre-production work.', 1),
      sub('c07a2', '', 'If the Client cancels after capture has begun, the full contract price is payable.', 1),
      sub('c07b', 'Postponement', 'The Client must give at least 1 day\'s notice to postpone a shoot. The Business will make reasonable efforts to offer a new date, subject to availability.'),
      sub('c07c', 'By the Business', 'If the Business must cancel due to unforeseen circumstances (for example illness, equipment failure or force majeure), it will notify the Client as soon as reasonably possible and offer either a full refund of monies paid or rescheduling at the earliest mutually convenient date without penalty. The Business has no further liability in that case.'),
    ] },
    { id: 'c08', title: 'Limitation of Liability', subs: [],
      body: 'To the extent permitted by law, the Business\'s total liability under this Agreement is limited to the total fees paid by the Client under it. The Business is not liable for indirect or consequential loss.\n\nAustralian Consumer Law. Where the Client is a "consumer" under the Australian Consumer Law, the consumer guarantees that cannot be excluded apply, and nothing in this Agreement limits them.' },
    { id: 'c09', title: 'Confidentiality', subs: [],
      body: 'Each party must keep the other\'s non-public business information confidential and use it only for this project, except where disclosure is required by law.' },
    { id: 'c10', title: 'Variation and Entire Agreement', subs: [],
      body: 'Changes to scope or fee must be agreed in writing; verbal changes are not binding. This Agreement and the Quote are the entire agreement between the parties on this subject.' },
    { id: 'c11', title: 'Governing Law', subs: [],
      body: 'This Agreement is governed by the laws of the State of New South Wales, Australia, and each party submits to the non-exclusive jurisdiction of the courts of that State.' },
    { id: 'c12', title: 'Acceptance', subs: [],
      body: 'By signing, the Client confirms it has read, understood and agrees to the terms of this Agreement and the Quote. This Agreement may be signed electronically or in hard copy; electronic signatures count as originals for all purposes.' },
  ].map((c) => Object.assign({ depositOnly: false }, c));

  /** The four documents a message is written for (D43), in the order shown. */
  const MESSAGE_KINDS = ['estimate', 'deposit', 'final', 'single'];

  const DAYS_MAX = 365;

  /* As the accept route checks a deposit (routes/projects.js invoicingChoice):
     more than 0 and at most 100. A 0% deposit is a single invoice. */
  const isPct = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100;
  const isDays = (v, min) => Number.isInteger(v) && v >= min && v <= DAYS_MAX;

  /**
   * The settings as every reader should see them: stored values where they are
   * usable, DOC_DEFAULTS where they are missing or unusable.
   *
   * @param {object} settings  the stored settings document (may be null)
   * @returns {{depositPct:number, validDays:number, dueDays:number,
   *            messages:{estimate:string, deposit:string, final:string, single:string},
   *            faqUrl:string,
   *            agreement:{intro:string, clauses:Array, hourlyRate:(number|null)}}}
   */
  function docSettings(settings) {
    const s = settings || {};
    const inv = s.invoicing || {};
    const msg = s.messages || {};
    const agr = s.agreement || {};
    const messages = {};
    MESSAGE_KINDS.forEach((k) => {
      messages[k] = typeof msg[k] === 'string' ? msg[k] : DOC_DEFAULTS.messages[k];
    });
    return {
      depositPct: isPct(inv.depositPct) ? inv.depositPct : DOC_DEFAULTS.depositPct,
      // Valid for 0 days would expire as it was sent; due in 0 days is due on
      // the day it's issued, which is a real term.
      validDays: isDays(inv.validDays, 1) ? inv.validDays : DOC_DEFAULTS.validDays,
      dueDays: isDays(inv.dueDays, 0) ? inv.dueDays : DOC_DEFAULTS.dueDays,
      messages,
      faqUrl: typeof agr.faqUrl === 'string' ? agr.faqUrl : DOC_DEFAULTS.faqUrl,
      agreement: {
        intro: typeof agr.intro === 'string' ? agr.intro : DOC_DEFAULTS.agreementIntro,
        clauses: Array.isArray(agr.clauses) ? cleanClauses(agr.clauses) : cleanClauses(DEFAULT_CLAUSES),
        // null is a rate cleared on purpose (the field is then blank), as '' is
        // for a message; only a missing or unusable one is the default.
        hourlyRate: agr.hourlyRate === null ? null
          : isRate(agr.hourlyRate) ? agr.hourlyRate : DOC_DEFAULTS.hourlyRate,
      },
    };
  }

  const isRate = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const strOf = (v) => (typeof v === 'string' ? v : '');

  /* A clause list as stored, made safe to render and edit: entries that aren't
     objects are dropped, missing strings are '', ids are kept (and a missing or
     repeated one is given a stable stand-in, so the builder can still key it),
     a first sub-clause can't be indented, having nothing to sit under, and
     only a real `true` makes a clause deposit-only.
     Always a fresh copy: nothing a caller does to it reaches the defaults. */
  function cleanClauses(list) {
    const used = {};
    const idFor = (v, stand) => {
      let id = typeof v === 'string' && v && !used[v] ? v : '';
      for (let n = 1; !id; n++) if (!used[stand + n]) id = stand + n;
      used[id] = true;
      return id;
    };
    return list.filter(isObj).map((c) => {
      const subs = (Array.isArray(c.subs) ? c.subs : []).filter(isObj).map((x, i) => ({
        id: idFor(x.id, 'sub'),
        heading: strOf(x.heading),
        text: strOf(x.text),
        indent: x.indent === 1 && i > 0 ? 1 : 0,
      }));
      return { id: idFor(c.id, 'clause'), title: strOf(c.title), body: strOf(c.body), subs, depositOnly: c.depositOnly === true };
    });
  }

  // ── The service agreement's fill-in fields (D39) ────────────────────────────

  /**
   * Every field the agreement text can use, and what it becomes. The Settings
   * screen prints this list as it stands, so a field added here is documented
   * there with no other change.
   */
  const AGREEMENT_FIELDS = Object.freeze([
    { key: 'client_business', says: 'The client’s business name' },
    { key: 'client_contact', says: 'The name of the person who signs (typed when they sign)' },
    { key: 'client_abn', says: 'The client’s ABN' },
    { key: 'client_email', says: 'The client contact’s email' },
    { key: 'client_phone', says: 'The client contact’s phone' },
    { key: 'signatory_role', says: 'The role the client types when signing (blank in a preview)' },
    { key: 'upid', says: 'The project’s UPID' },
    { key: 'project_name', says: 'The project’s name' },
    { key: 'total', says: 'The estimate’s total, as the client sees it' },
    { key: 'deposit_pct', says: 'The deposit percentage, e.g. 50%' },
    { key: 'deposit_amount', says: 'The deposit in dollars' },
    { key: 'balance_amount', says: 'The balance in dollars (the total, with no deposit)' },
    { key: 'due_days', says: 'How many days after it’s issued an invoice is due' },
    { key: 'production_days', says: 'The production days, one per line, with status and times' },
    { key: 'business_name', says: 'Your legal / business name' },
    { key: 'business_abn', says: 'Your ABN' },
    { key: 'business_email', says: 'Your business email' },
    { key: 'business_phone', says: 'Your business phone' },
    { key: 'business_signer', says: 'Who signs for the business' },
    { key: 'hourly_rate', says: 'Your hourly rate for extra work' },
    { key: 'date', says: 'The date it is signed (today, in a preview)' },
  ]);

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const STATUS_WORD = { confirmed: 'Confirmed', pencilled: 'Pencilled', proposed: 'Proposed' };

  /* The client PDF's words for a day (server/src/pdf.js dayDate, dayTimes,
     STATUS_WORD), restated here because this file loads in the browser too and
     pdf.js doesn't. test-documents.js pins them against pdf.js's output. */
  function dayDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return 'Date TBC';
    const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return WEEKDAYS[wd] + ' ' + Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }

  function clock12(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    if (!m) return '';
    const h = Number(m[1]);
    return (h % 12 || 12) + ':' + m[2] + (h < 12 ? 'am' : 'pm');
  }

  function dayTimes(day) {
    const a = clock12(day.startTime);
    const b = clock12(day.endTime);
    if (a && b) return a + '–' + b + (String(day.endTime) < String(day.startTime) ? ' (ends next day)' : '');
    if (a) return 'From ' + a;
    if (b) return 'Until ' + b;
    return '';
  }

  function longDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }

  function money(n) {
    return '$' + (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function abnText(abn) {
    const raw = String(abn || '').trim();
    const digits = raw.replace(/\D/g, '');
    return digits.length === 11 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : raw;
  }

  const isMoney = (n) => typeof n === 'number' && Number.isFinite(n);

  const pctText = (pct) => String(Math.round((Number(pct) || 0) * 100) / 100) + '%';

  /**
   * What each field becomes for one estimate. Explicit inputs rather than a
   * project or folder reply, so the Settings preview and stage E's signing (which
   * fills from a frozen version) can both call it with what they hold.
   *
   * Days print in date order, dated days first, the way the calendar sorts them;
   * a day with no date is "Date TBC". Times and status as on the client PDF.
   *
   * @param {object} input
   * @param {object} input.client       the estimate's client snapshot ({ businessName, contactName, abn })
   * @param {string} input.upid
   * @param {string} input.projectName
   * @param {number} input.totalIncGst  the stored client total
   * @param {number|null} input.depositPct  null for a single invoice: the field is then blank
   * @param {number|null} input.depositTotal  calc.js depositAmount(...).totalIncGst; null for a
   *                                          single invoice. This file does no money maths, so
   *                                          the amounts come from calc.js, as on the invoices.
   * @param {number} input.balanceTotal  calc.js finalInvoiceTotals(...).balanceDue (or the total)
   * @param {number} input.dueDays      docSettings().dueDays
   * @param {string} input.signatoryRole  as typed when signing; '' in a preview
   * @param {Array}  input.days         [{ date, status, startTime, endTime }]
   * @param {object} input.business     settings.business ({ name, abn, email, phone, signer })
   * @param {number|null} input.hourlyRate  docSettings().agreement.hourlyRate
   * @param {string} input.today        'YYYY-MM-DD'
   * @returns {Object<string,string>}
   */
  function agreementValues(input) {
    const i = input || {};
    const client = i.client || {};
    const business = i.business || {};
    const days = (Array.isArray(i.days) ? i.days : [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => {
        const ad = a.date || '';
        const bd = b.date || '';
        if (!ad !== !bd) return ad ? -1 : 1;
        return ad < bd ? -1 : ad > bd ? 1 : String(a.startTime || '').localeCompare(String(b.startTime || ''));
      });
    return {
      client_business: String(client.businessName || '').trim(),
      client_contact: String(client.contactName || '').trim(),
      client_abn: abnText(client.abn),
      client_email: String(client.email || '').trim(),
      client_phone: String(client.phone || '').trim(),
      signatory_role: String(i.signatoryRole || '').trim(),
      upid: String(i.upid || '').trim(),
      project_name: String(i.projectName || '').trim(),
      total: isMoney(i.totalIncGst) ? money(i.totalIncGst) : '',
      deposit_pct: isPct(i.depositPct) ? pctText(i.depositPct) : '',
      deposit_amount: isPct(i.depositPct) && isMoney(i.depositTotal) ? money(i.depositTotal) : '',
      balance_amount: isMoney(i.balanceTotal) ? money(i.balanceTotal) : '',
      due_days: Number.isInteger(i.dueDays) && i.dueDays >= 0 ? String(i.dueDays) : '',
      production_days: days
        .map((d) => [dayDate(d.date), STATUS_WORD[d.status] || 'Proposed', dayTimes(d)].filter(Boolean).join(' · '))
        .join('\n'),
      business_name: String(business.name || '').trim(),
      business_abn: abnText(business.abn),
      business_email: String(business.email || '').trim(),
      business_phone: String(business.phone || '').trim(),
      business_signer: String(business.signer || '').trim(),
      hourly_rate: isRate(i.hourlyRate) ? money(i.hourlyRate) : '',
      date: longDate(i.today),
    };
  }

  /* `{client_business}`, and `{ Client_Business }` too: a space or a capital is
     an easy slip in a long legal text, and leaving it unfilled in a signed
     agreement is worse than reading it generously. */
  const FIELD_RE = /\{\s*([A-Za-z_]+)\s*\}/g;

  /**
   * The agreement text with its fields filled.
   *
   * A field this file doesn't know is left exactly as typed and listed in
   * `unknown`, so a typo shows in the preview instead of vanishing. A known field
   * with nothing to fill it (a client with no ABN) becomes '' and is listed in
   * `blank`.
   *
   * @param {string} text
   * @param {Object<string,string>} values  agreementValues()'s result
   * @returns {{text:string, unknown:string[], blank:string[]}}
   */
  function fillAgreement(text, values) {
    const known = {};
    AGREEMENT_FIELDS.forEach((f) => {
      known[f.key] = true;
    });
    const v = values || {};
    const unknown = [];
    const blank = [];
    const note = (list, key) => {
      if (list.indexOf(key) === -1) list.push(key);
    };
    const out = String(text || '').replace(FIELD_RE, (whole, name) => {
      const key = name.toLowerCase();
      if (!known[key]) {
        note(unknown, whole);
        return whole;
      }
      const value = v[key] === undefined || v[key] === null ? '' : String(v[key]);
      if (!value) note(blank, key);
      return value;
    });
    return { text: out, unknown, blank };
  }

  // ── The agreement as it is signed (ui-clarity task 4; U10, U12, U14, U22) ──

  /* What a client agrees to when there are no clauses (the owner cleared them
     all): only the quote itself. The client's word for an estimate is "quote"
     (D103). */
  const FALLBACK_TEXT = 'ACCEPTANCE OF QUOTE\n\n' +
    '{client_business} accepts quote {upid}, {project_name}, for {total}, as set out in the quote.\n\n' +
    'Signed for {client_business} by {client_contact}, {signatory_role}, on {date}.';

  /* The title and section heads, each on a line of its own. The sign dialog and
     the agreement PDF (task 7) style these lines as heads, purely as
     presentation: the text is the same either way. */
  const AGREEMENT_TITLE = 'SERVICE AGREEMENT';
  const AGREEMENT_HEADS = Object.freeze(['PARTIES', 'PROJECT', 'PAYMENT SCHEDULE', 'SCOPE AND PRODUCTION DAYS', 'TERMS']);

  /* (a)…(z), then (aa), (ab)…; and (i), (ii)… under a lettered one. */
  function letterOf(n) {
    let out = '';
    for (let k = n; k >= 0; k = Math.floor(k / 26) - 1) out = String.fromCharCode(97 + (k % 26)) + out;
    return out;
  }
  function romanOf(n) {
    const table = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
      [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let k = n + 1;
    let out = '';
    table.forEach(([v, s]) => {
      for (; k >= v; k -= v) out += s;
    });
    return out;
  }

  /* Typed text as it is rendered: Windows line ends made plain, NUL removed
     (signing.js marks the name and role gaps with it, so typed text must never
     carry one), and the ends trimmed. Paragraphs are split on blank lines. */
  const tidy = (v) => String(v || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  const paragraphs = (v) => tidy(v).split(/\n[ \t]*\n+/).map((x) => x.trim()).filter(Boolean);
  /* "Heading" → "Heading." unless it already ends a sentence. */
  const asHeading = (h) => (/[.?!:]$/.test(h) ? h : h + '.');

  /**
   * The whole agreement a client signs: the fixed header filled from `values`,
   * then TERMS and the clauses, numbered by their order, then the signing line.
   *
   * The one render. signing.js stores what it returns (with the name and role
   * typed into their gaps) and hashes it; the Settings preview shows it. Empty
   * parts of the header are dropped rather than printed hollow (no "(ABN )"
   * for a client without one). The intro and the clauses are the owner's text:
   * their {fields} are filled by fillAgreement, so an unknown one is left as
   * typed and listed, as before.
   *
   * Format, one block per blank line:
   *   N. Title          then the clause's body paragraphs
   *   (a) Heading. Text a sub-clause; a blank one is skipped and takes no letter
   *   (i) Text          an indented one, under the lettered one above it
   * A clause with no title, body or sub-clauses is skipped and takes no number,
   * and so is a deposit-only clause on a single invoice, which has no deposit.
   * No clauses at all → FALLBACK_TEXT.
   *
   * @param {{intro:string, clauses:Array}} agreement  docSettings().agreement
   * @param {Object<string,string>} values  agreementValues()'s result
   * @param {{single?:boolean}} [opts]  single: the project is billed on one
   *        invoice, so the payment schedule has no Deposit or Balance rows and
   *        deposit-only clauses are left out
   * @returns {{text:string, unknown:string[], blank:string[]}}
   */
  function agreementText(agreement, values, opts) {
    const a = agreement || {};
    const v = values || {};
    const single = Boolean(opts && opts.single);
    const unknown = [];
    const blank = [];
    const fill = (text) => {
      const r = fillAgreement(text, v);
      r.unknown.forEach((x) => { if (unknown.indexOf(x) === -1) unknown.push(x); });
      r.blank.forEach((x) => { if (blank.indexOf(x) === -1) blank.push(x); });
      return r.text;
    };

    const clauses = [];
    (Array.isArray(a.clauses) ? a.clauses : []).forEach((c) => {
      if (!c || typeof c !== 'object' || (single && c.depositOnly === true)) return;
      const title = fill(tidy(c.title)).trim();
      const blocks = paragraphs(c.body).map(fill);
      let letter = -1;
      let roman = -1;
      (Array.isArray(c.subs) ? c.subs : []).forEach((x) => {
        if (!x || typeof x !== 'object') return;
        const heading = fill(tidy(x.heading)).trim();
        const text = fill(tidy(x.text));
        if (!heading && !text) return;
        // Indented, it sits under the lettered one above; with none above, it
        // is lettered itself.
        const under = x.indent === 1 && letter >= 0;
        if (under) roman++;
        else {
          letter++;
          roman = -1;
        }
        const mark = '(' + (under ? romanOf(roman) : letterOf(letter)) + ') ';
        blocks.push(mark + [heading ? asHeading(heading) : '', text].filter(Boolean).join(' '));
      });
      if (!title && !blocks.length) return;
      clauses.push({ title, blocks });
    });
    if (!clauses.length) {
      const fb = fillAgreement(FALLBACK_TEXT, v);
      return { text: fb.text, unknown: fb.unknown, blank: fb.blank };
    }

    const join = (parts, sep) => parts.filter(Boolean).join(sep);
    const abn = (x) => (x ? '(ABN ' + x + ')' : '');
    const party = (name, abnValue, rep, defined) => (name
      ? join([join([name, abn(abnValue)], ' ') + (rep ? ', represented by ' + rep : ''), defined], ' ')
      : '');
    const contact = (email, phone) => join([email, phone], ' · ');

    const sections = [AGREEMENT_TITLE];
    sections.push(join([
      'PARTIES',
      party(v.business_name, v.business_abn, v.business_signer, '(the "Business")'),
      contact(v.business_email, v.business_phone),
      party(v.client_business, v.client_abn, '', '(the "Client")'),
      contact(v.client_email, v.client_phone),
    ], '\n'));
    const intro = paragraphs(a.intro).map(fill);
    if (intro.length) sections.push(intro.join('\n\n'));

    const project = join([v.project_name, v.upid ? '(' + v.upid + ')' : ''], ' ');
    const quote = 'quote' + (v.upid ? ' ' + v.upid : '') + ' (the "Quote")';
    sections.push('PROJECT\n' + (project ? project + ', as set out in ' : 'As set out in ') + quote + '.');

    // U10: a single invoice has no Deposit or Balance row.
    const rows = single
      ? [v.total ? 'Total: ' + v.total + ', on a single invoice' +
        (v.due_days ? ', due ' + v.due_days + ' days after it is issued' : '') : '']
      : [
        v.total ? 'Total: ' + v.total : '',
        v.deposit_amount ? 'Deposit' + (v.deposit_pct ? ' (' + v.deposit_pct + ')' : '') + ': ' + v.deposit_amount : '',
        v.balance_amount ? 'Balance: ' + v.balance_amount : '',
        v.due_days && (v.deposit_amount || v.balance_amount) ? 'Invoices are due ' + v.due_days + ' days after each is issued' : '',
      ];
    if (rows.some(Boolean)) sections.push(join(['PAYMENT SCHEDULE'].concat(rows), '\n'));

    sections.push(join([
      'SCOPE AND PRODUCTION DAYS',
      'The services and deliverables are as set out in the Quote.',
      v.production_days ? 'Production days:\n' + v.production_days : '',
    ], '\n'));

    sections.push('TERMS');
    clauses.forEach((c, i) => {
      sections.push(String(i + 1) + '.' + (c.title ? ' ' + c.title : '') +
        (c.blocks.length ? '\n' + c.blocks.join('\n\n') : ''));
    });

    const who = join([v.client_contact, v.signatory_role], ', ');
    sections.push('Signed' + (v.client_business ? ' for ' + v.client_business : '') +
      (who ? ' by ' + who : '') + (v.date ? (who ? ', on ' : ' on ') + v.date : '') + '.');
    return { text: sections.join('\n\n'), unknown, blank };
  }

  /* Loaded two ways: require()d by the server, and as a plain <script> in the
     browser, where it becomes globalThis.LSCDocuments. */
  const api = {
    DOC_DEFAULTS,
    MESSAGE_KINDS,
    DAYS_MAX,
    docSettings,
    AGREEMENT_FIELDS,
    agreementValues,
    fillAgreement,
    DEFAULT_CLAUSES,
    FALLBACK_TEXT,
    AGREEMENT_TITLE,
    AGREEMENT_HEADS,
    agreementText,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.LSCDocuments = api;
}());
