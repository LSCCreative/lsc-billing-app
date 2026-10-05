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
 *   agreement: { text, faqUrl }
 * A database saved before task 21 has none of them, so every reader goes
 * through docSettings(), which fills what's missing from DOC_DEFAULTS. A
 * message or FAQ URL cleared on purpose is kept cleared: '' is a choice
 * (D55: a cleared FAQ URL hides the button), only a missing one is a default.
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
    agreementText: '',
  });

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
   *            faqUrl:string, agreementText:string}}
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
      agreementText: typeof agr.text === 'string' ? agr.text : DOC_DEFAULTS.agreementText,
    };
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
   * @param {object} input.business     settings.business ({ name, abn })
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
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.LSCDocuments = api;
}());
