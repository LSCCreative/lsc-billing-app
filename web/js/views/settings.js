'use strict';

/* Settings, #/settings (production-booking task 21; D65, IA "Settings").
 *
 * Until task 21 this was the Invoice Settings pop-up, opened over whatever was
 * on #main. It is a screen now, with seven sections, each linkable as
 * #/settings/<section>: Business, Payment, Estimates & invoices, Service
 * agreement, Email, Card payments and Account. A rail beside them from 1100px, a jump
 * list above them below that. Card payments reads "Not set up yet" (held, D101).
 * Email shows whether the server's SMTP key is connected and sends a test
 * (task 28); the key itself is set on the server, never typed in here.
 * Account (.design/account-recovery/) is the login itself: username, the
 * email a "forgot password" link goes to, and the password. It saves on its
 * own, through PUT /api/account with the current password, never with Save
 * Settings: those fields aren't in `form`, so they don't make the page dirty.
 *
 * WHAT MOVED OVER UNCHANGED
 * The pop-up's fields, their checks and the shape they are stored in:
 * business.name and business.abn (bare digits), gst (registered, rate as a
 * fraction, pricesIncludeGst; the Finance & Price Dashboard edits the same
 * object and must agree on what a valid one is: registering needs an ABN, the
 * rate is 0–100 only while registered), and payment (bankName, accountName,
 * bsb, accountNumber, terms).
 *
 * WHAT IS NEW
 * Stored as server/src/documents.js describes, and read back through its
 * docSettings(), which fills in what a settings row saved before task 21
 * doesn't have:
 *   invoicing.depositPct (D33)  invoicing.validDays (D44)  invoicing.dueDays
 *   messages.{estimate,deposit,final,single} (D43)
 *   agreement.text (D39)  agreement.faqUrl (D55; '' hides the FAQ button)
 *   business.email and .phone (task 33 DR1): the client pages' contact line
 *   and notices, and the estimate PDF's sign-off. Stored before, but only SQL
 *   could set them.
 * The service agreement's "Preview with a project…" fills the text on screen,
 * saved or not, through the same documents.js that stage E's signing will use.
 *
 * SAVING MERGES, IT DOES NOT REPLACE
 * PUT /api/settings writes the body over the whole row, and this screen does
 * not show every key in it (`paths`, for one). So it reads
 * the settings fresh when it opens, never from LSCData's boot-time copy, and
 * saves its own keys merged onto what it read. Sending only its own would drop
 * the rest; dropping `gst` would change the money on every estimate saved
 * afterwards.
 *
 * MOVING BETWEEN SECTIONS KEEPS THE EDITS
 * A rail item changes the address in place (replace, no guard, and a `jump`
 * state), and show() answers a jump on a screen already drawn by scrolling,
 * not redrawing. Any other arrival, the nav item included, draws afresh after
 * the router's unsaved-edit guard has asked.
 */

const SettingsView = (() => {
  const { esc, num, abnDigits, abnValid, abnFormat } = LSCUtil;
  const D = LSCDocuments;

  const SECTIONS = [
    ['business', 'Business'],
    ['payment', 'Payment'],
    ['documents', 'Estimates & invoices'],
    ['agreement', 'Service agreement'],
    ['email', 'Email'],
    ['cards', 'Card payments'],
    ['account', 'Account'],
  ];
  const MESSAGE_LABELS = { estimate: 'Estimate', deposit: 'Deposit invoice', final: 'Final invoice', single: 'Single invoice' };

  /* Text fields: element id -> key in `form`. Each writes straight to `form` on
     input, so typing never redraws and never loses focus, and fill() puts the
     saved values back after a save. */
  const TEXT = [
    ['set-biz-name', 'businessName'],
    ['set-abn', 'abn'],
    ['set-biz-email', 'businessEmail'],
    ['set-biz-phone', 'businessPhone'],
    ['set-gst-rate', 'rateRaw'],
    ['set-bank-name', 'bankName'],
    ['set-account-name', 'accountName'],
    ['set-bsb', 'bsb'],
    ['set-account-num', 'accountNumber'],
    ['set-terms', 'terms'],
    ['set-deposit', 'depositRaw'],
    ['set-valid', 'validRaw'],
    ['set-due', 'dueRaw'],
    ['set-agreement', 'agreementText'],
    ['set-faq', 'faqUrl'],
  ].concat(D.MESSAGE_KINDS.map((k) => ['set-msg-' + k, 'msg_' + k]));
  const CHECKS = [
    ['set-gst-reg', 'registered'],
    ['set-gst-inc', 'pricesIncludeGst'],
  ];

  let root = null;
  let handlers = null;
  let loaded = null; // settings as the server last gave them: the merge base
  let form = null; // what the fields show
  let baseline = ''; // form as loaded, for the unsaved-edit check
  let saving = false;

  const $ = (id) => root.querySelector('#' + id);
  const onScreen = () => Boolean(root && root.querySelector('#set-save'));
  const snapshot = () => JSON.stringify(form);
  const dirty = () => Boolean(form) && snapshot() !== baseline;

  /* The stored GST rate is a fraction and the field shows a percent, snapped:
     a plain ×100 renders 0.07 as 7.000000000000001. */
  const toPercent = (rate) => String(Math.round(num(rate) * 1e8) / 1e6);

  function formFrom(settings) {
    const gst = settings.gst || {};
    const payment = settings.payment || {};
    const business = settings.business || {};
    const docs = D.docSettings(settings);
    const f = {
      businessName: business.name || '',
      abn: abnFormat(business.abn),
      businessEmail: business.email || '',
      businessPhone: business.phone || '',
      registered: gst.registered === true,
      rateRaw: toPercent(gst.rate),
      pricesIncludeGst: gst.pricesIncludeGst === true,
      bankName: payment.bankName || '',
      accountName: payment.accountName || '',
      bsb: payment.bsb || '',
      accountNumber: payment.accountNumber || '',
      terms: payment.terms || '',
      depositRaw: String(docs.depositPct),
      validRaw: String(docs.validDays),
      dueRaw: String(docs.dueDays),
      agreementText: docs.agreementText,
      faqUrl: docs.faqUrl,
    };
    D.MESSAGE_KINDS.forEach((k) => {
      f['msg_' + k] = docs.messages[k];
    });
    return f;
  }

  // ── Markup ────────────────────────────────────────────────────────────────

  const head =
    '<div class="page-head"><div><h1 class="page-title">Settings</h1>' +
    '<div class="page-sub">Your business, how you’re paid, and what estimates and invoices say</div></div></div>';

  function field(id, label, value, opts) {
    const o = opts || {};
    const control = o.textarea
      ? '<textarea id="' + id + '"' + (o.rows ? ' rows="' + o.rows + '"' : '') + (o.attrs || '') + '>' + esc(value) + '</textarea>'
      : '<input id="' + id + '" type="' + (o.type || 'text') + '" value="' + esc(value) + '"' + (o.attrs || '') + '>';
    return '<div class="field' + (o.full ? ' full' : '') + (o.cls ? ' ' + o.cls : '') + '">' +
      '<label for="' + id + '">' + label + '</label>' + control +
      (o.hint ? '<p class="set-hint" id="' + id + '-hint">' + o.hint + '</p>' : '') + '</div>';
  }

  function section(id, title, intro, body) {
    return '<section class="set-section" id="set-sec-' + id + '" aria-labelledby="set-h-' + id + '">' +
      '<h2 class="set-section-head" id="set-h-' + id + '" tabindex="-1">' + title + '</h2>' +
      (intro ? '<p class="set-intro">' + intro + '</p>' : '') + body + '</section>';
  }

  function railMarkup(active) {
    return '<nav class="set-rail" aria-label="Settings sections">' +
      SECTIONS.map(([id, label]) =>
        '<a class="nav-link" href="#/settings/' + id + '" data-section="' + id + '"' +
        (id === active ? ' aria-current="true"' : '') + '>' + esc(label) + '</a>').join('') +
      '</nav>';
  }

  function businessMarkup(f) {
    const off = !f.registered;
    return section('business', 'Business',
      'Printed under the logo on estimates and invoices. A tax invoice must show your ABN, so an invoice that ' +
      'charges GST won’t export without one.',
      '<div class="form-grid">' +
        field('set-biz-name', 'Legal / Business Name', f.businessName, { attrs: ' placeholder="e.g. Lachlan Sullivan-Carey" autocomplete="organization"' }) +
        field('set-abn', 'ABN', f.abn, { attrs: ' inputmode="numeric" placeholder="e.g. 51 824 753 556"' }) +
        field('set-biz-email', 'Email', f.businessEmail, { type: 'email', attrs: ' placeholder="e.g. hello@lsccreative.studio" autocomplete="email" aria-describedby="set-contact-hint"' }) +
        field('set-biz-phone', 'Phone', f.businessPhone, { type: 'tel', attrs: ' placeholder="e.g. 0412 345 678" autocomplete="tel" aria-describedby="set-contact-hint"' }) +
      '</div>' +
      '<p class="set-hint" id="set-contact-hint">How a client reaches you: shown at the foot of every client page, ' +
      'in its notices (“Contact …”), and on the estimate PDF. Left blank, a client page says “contact us” with no address.</p>' +
      '<h3 class="set-group-head">GST</h3>' +
      '<label class="set-check"><input type="checkbox" id="set-gst-reg"' + (f.registered ? ' checked' : '') +
      '><span>Registered for GST</span></label>' +
      '<p class="set-hint">Off means invoices show no GST line at all.</p>' +
      '<div class="set-row' + (off ? ' set-row-off' : '') + '" id="set-gst-detail">' +
        field('set-gst-rate', 'GST Rate (%)', f.rateRaw, { type: 'number', attrs: ' min="0" max="100" step="0.5" inputmode="decimal"' + (off ? ' disabled' : '') }) +
        '<label class="set-check"><input type="checkbox" id="set-gst-inc"' + (f.pricesIncludeGst ? ' checked' : '') +
        (off ? ' disabled' : '') + '><span>The rates I enter already include GST</span></label>' +
      '</div>' +
      '<p class="set-hint">Leave that unticked if your rate card is GST-exclusive: GST is then added on top of the ' +
      'client price. Ticked, it is backed out of the rates instead, and the client total stays what the rate card says.</p>');
  }

  function paymentMarkup(f) {
    return section('payment', 'Payment',
      'Printed on invoices only. An estimate never shows them, and a block left blank is left off the document.',
      '<div class="form-grid">' +
        field('set-bank-name', 'Bank Name', f.bankName, { attrs: ' placeholder="e.g. Commonwealth Bank"' }) +
        field('set-account-name', 'Account Name', f.accountName, { attrs: ' placeholder="e.g. LSC Creative Pty Ltd"' }) +
        field('set-bsb', 'BSB', f.bsb, { attrs: ' inputmode="numeric" placeholder="e.g. 062-000"' }) +
        field('set-account-num', 'Account Number', f.accountNumber, { attrs: ' inputmode="numeric" placeholder="e.g. 12345678"' }) +
        field('set-terms', 'Payment Terms', f.terms, { textarea: true, full: true, attrs: ' placeholder="e.g. Strictly 14 Days — EFT only. Please reference invoice number."' }) +
      '</div>');
  }

  function documentsMarkup(f) {
    const msgs = D.MESSAGE_KINDS.map((k) =>
      '<div class="field set-msg">' +
        '<div class="set-msg-label"><label for="set-msg-' + k + '">' + MESSAGE_LABELS[k] + '</label>' +
        '<button type="button" class="set-link" data-default-msg="' + k + '"' +
        (f['msg_' + k] === D.DOC_DEFAULTS.messages[k] ? ' hidden' : '') + '>Use the default</button></div>' +
        '<textarea id="set-msg-' + k + '" rows="2">' + esc(f['msg_' + k]) + '</textarea>' +
      '</div>').join('');
    return section('documents', 'Estimates & invoices', '',
      '<div class="set-numbers">' +
        field('set-deposit', 'Deposit (%)', f.depositRaw, { type: 'number', attrs: ' min="1" max="100" step="any" inputmode="decimal" aria-describedby="set-deposit-hint"', hint: 'Of the total, on a deposit + final pair. Can be changed on a project before it’s accepted.' }) +
        field('set-valid', 'Estimates valid for (days)', f.validRaw, { type: 'number', attrs: ' min="1" max="' + D.DAYS_MAX + '" step="1" inputmode="numeric" aria-describedby="set-valid-hint"', hint: 'From the day it’s sent. After that the estimate reads as expired.' }) +
        field('set-due', 'Invoices due after (days)', f.dueRaw, { type: 'number', attrs: ' min="0" max="' + D.DAYS_MAX + '" step="1" inputmode="numeric" aria-describedby="set-due-hint"', hint: 'From the issue date. Each invoice can still be given its own.' }) +
      '</div>' +
      '<h3 class="set-group-head">Invoice numbers</h3>' +
      '<p class="set-numbering">Taken from the project’s UPID. For UPID <strong>B210</strong>: ' +
      '<code>INV-B210-D</code> deposit, <code>INV-B210-F</code> final, or <code>INV-B210</code> for a single invoice.</p>' +
      '<h3 class="set-group-head">Default messages</h3>' +
      '<p class="set-hint set-hint-lead">What each email says above its link. You can change it before each send.</p>' +
      '<div class="form-grid set-msgs">' + msgs + '</div>');
  }

  function agreementMarkup(f) {
    const fields = D.AGREEMENT_FIELDS.map((x) =>
      '<li><button type="button" class="set-field-code" data-field="' + x.key + '" aria-label="Insert {' + x.key + '}: ' +
      esc(x.says) + '"><code>{' + x.key + '}</code></button><span>' + esc(x.says) + '</span></li>').join('');
    return section('agreement', 'Service agreement',
      'Your own text, which the client agrees to when they accept an estimate. Each signing keeps the exact text it ' +
      'was signed with, so editing it here never changes an agreement already signed.',
      '<div class="set-agreement">' +
        '<div class="field set-agreement-text">' +
          '<label for="set-agreement">Agreement text</label>' +
          '<textarea id="set-agreement" rows="18" spellcheck="true" aria-describedby="set-agreement-hint" ' +
          'placeholder="Paste your service agreement here. Use the fields beside it for the parts that change per project.">' +
          esc(f.agreementText) + '</textarea>' +
          '<p class="set-hint" id="set-agreement-hint">Fields in curly brackets are filled in per project when it’s signed.</p>' +
          '<p class="set-preview-row"><button type="button" class="btn btn-ghost btn-sm" id="set-preview">Preview with a project…</button></p>' +
        '</div>' +
        '<div class="set-fields">' +
          '<h3 class="set-group-head" id="set-fields-head">Fill-in fields</h3>' +
          '<p class="set-hint set-hint-lead">Click one to put it where the cursor is.</p>' +
          '<div class="set-field-box"><ul class="set-field-list" aria-labelledby="set-fields-head">' + fields + '</ul></div>' +
        '</div>' +
      '</div>' +
      '<div class="set-faq">' +
        field('set-faq', 'Service agreement FAQ', f.faqUrl, { type: 'url', attrs: ' inputmode="url" placeholder="https://" aria-describedby="set-faq-hint"', hint: 'The client page’s “Service agreement FAQ” button opens this. Clear it to hide the button.' }) +
      '</div>');
  }

  function pendingMarkup(id, title, body) {
    return section(id, title, '',
      '<p class="set-status"><span class="set-status-dot" aria-hidden="true"></span>Not set up yet</p>' +
      '<p class="set-hint set-hint-lead">' + body + '</p>');
  }

  /* Email (task 28, D102). The status and any failed sends come from
     GET /api/email/status once the screen is drawn (EmailPanel). Nothing here
     is saved with the settings: the key lives in the server's .env. */
  function emailMarkup() {
    return section('email', 'Email',
      'Estimates, invoices and signed agreements are emailed from your own address through Resend. The key is set on the ' +
      'server, never typed in here.',
      '<p class="set-status" id="set-email-status"><span class="set-status-dot" aria-hidden="true"></span>' +
        '<span id="set-email-status-text">Checking…</span></p>' +
      '<p class="set-hint set-hint-lead" id="set-email-detail"></p>' +
      '<div class="set-email-test">' +
        field('set-email-to', 'Send a test email to', '', { type: 'email', attrs: ' inputmode="email" autocomplete="email" aria-describedby="set-email-result"' }) +
        '<p class="set-preview-row"><button type="button" class="btn btn-ghost btn-sm" id="set-email-send" disabled>Send a test email</button></p>' +
      '</div>' +
      '<p class="set-hint" id="set-email-result" role="status" aria-live="polite"></p>');
  }

  /* Account (account-recovery). A <form> of its own so Enter saves it and a
     password manager sees a username beside a new-password field. Filled by
     AccountPanel once GET /api/account answers. */
  function accountMarkup() {
    return section('account', 'Account',
      'How you sign in, and where a “Forgot password?” link is emailed. These save on their own with the ' +
      'Update Account button, not with Save Settings, and any change needs your current password.',
      '<form id="set-acct-form" novalidate>' +
        '<div class="form-grid">' +
          field('set-acct-username', 'Username', '', { attrs: ' autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"' }) +
          field('set-acct-email', 'Email', '', {
            type: 'email',
            attrs: ' inputmode="email" autocomplete="email" aria-describedby="set-acct-email-hint"',
            hint: 'Where a reset link goes from the sign-in screen. You can sign in with it as well as your username.',
          }) +
        '</div>' +
        '<h3 class="set-group-head">Change password</h3>' +
        '<div class="form-grid">' +
          field('set-acct-new', 'New password', '', {
            type: 'password',
            attrs: ' autocomplete="new-password" aria-describedby="set-acct-new-hint"',
            hint: 'Leave both blank to keep your password. At least 12 characters. Changing it signs out every other browser.',
          }) +
          field('set-acct-confirm', 'Type it again', '', { type: 'password', attrs: ' autocomplete="new-password"' }) +
        '</div>' +
        '<h3 class="set-group-head">Confirm it’s you</h3>' +
        '<div class="form-grid">' +
          field('set-acct-current', 'Current password', '', { type: 'password', attrs: ' autocomplete="current-password"' }) +
        '</div>' +
        '<div id="set-acct-error" role="alert"></div>' +
        '<div class="set-acct-actions">' +
          '<button type="submit" class="btn btn-accent" id="set-acct-save" data-write disabled>' +
          '<span class="spinner" id="set-acct-spin"></span><span id="set-acct-label">Update Account</span></button>' +
          '<p class="set-hint" id="set-acct-state" role="status" aria-live="polite">Loading…</p>' +
        '</div>' +
      '</form>');
  }

  function screenMarkup(f, active) {
    return head +
      '<div class="set-shell">' + railMarkup(active) +
      '<div class="set-body">' +
        businessMarkup(f) +
        paymentMarkup(f) +
        documentsMarkup(f) +
        agreementMarkup(f) +
        emailMarkup() +
        pendingMarkup('cards', 'Card payments',
          'Paying an invoice by card through Stripe, with the card fee passed on to the client, is on hold. Clients pay by bank transfer, as the invoices say.') +
        accountMarkup() +
        '<div id="settings-error" role="alert"></div>' +
        '<div class="pricing-save-bar set-save-bar">' +
          '<p id="set-save-state" aria-live="polite">No unsaved changes.</p>' +
          '<div><button type="button" class="btn btn-accent" id="set-save" data-write>' +
          '<span class="spinner" id="set-spin"></span><span id="set-save-label">Save Settings</span></button></div>' +
        '</div>' +
      '</div></div>';
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  function paintState() {
    const el = $('set-save-state');
    if (el && !saving) el.textContent = dirty() ? 'You have unsaved changes.' : 'No unsaved changes.';
  }

  function paintGst() {
    const off = !form.registered;
    // Both mean nothing unless registered (calc.js gates them on it).
    $('set-gst-rate').disabled = off;
    $('set-gst-inc').disabled = off;
    $('set-gst-detail').classList.toggle('set-row-off', off);
  }

  function paintDefaults() {
    root.querySelectorAll('[data-default-msg]').forEach((btn) => {
      const k = btn.dataset.defaultMsg;
      btn.hidden = form['msg_' + k] === D.DOC_DEFAULTS.messages[k];
    });
  }

  /* The fields from `form`, after a save trimmed what it stored. */
  function fill() {
    TEXT.forEach(([id, key]) => {
      if ($(id).value !== form[key]) $(id).value = form[key];
    });
    CHECKS.forEach(([id, key]) => {
      $(id).checked = form[key];
    });
    paintGst();
    paintDefaults();
  }

  /* A fill-in field goes where the cursor is, replacing any selection, as if
     typed, and the cursor ends up after it. */
  function insertField(key) {
    const box = $('set-agreement');
    const code = '{' + key + '}';
    const start = box.selectionStart === undefined ? box.value.length : box.selectionStart;
    const end = box.selectionEnd === undefined ? start : box.selectionEnd;
    box.focus();
    box.setRangeText(code, start, end, 'end');
    form.agreementText = box.value;
    paintState();
  }

  function bind() {
    TEXT.forEach(([id, key]) => {
      $(id).addEventListener('input', function () {
        form[key] = this.value;
        if (key.startsWith('msg_')) paintDefaults();
        paintState();
      });
    });
    CHECKS.forEach(([id, key]) => {
      $(id).addEventListener('change', function () {
        form[key] = this.checked;
        if (key === 'registered') paintGst();
        paintState();
      });
    });
    root.querySelectorAll('[data-default-msg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.defaultMsg;
        form['msg_' + k] = D.DOC_DEFAULTS.messages[k];
        $('set-msg-' + k).value = form['msg_' + k];
        $('set-msg-' + k).focus();
        paintDefaults();
        paintState();
      });
    });
    root.querySelectorAll('.set-field-code').forEach((btn) => {
      btn.addEventListener('click', () => insertField(btn.dataset.field));
    });
    $('set-preview').addEventListener('click', () => Preview.open($('set-preview')));
    $('set-save').addEventListener('click', save);

    root.querySelector('.set-rail').addEventListener('click', (event) => {
      const link = event.target.closest('[data-section]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      LSCRouter.go('/settings/' + link.dataset.section, { replace: true, skipGuard: true, state: { jump: true } });
    });
  }

  // ── Sections: jumping and the rail's marker ───────────────────────────────

  function markRail(id) {
    root.querySelectorAll('.set-rail [data-section]').forEach((a) => {
      if (a.dataset.section === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  function jumpTo(id, moveFocus) {
    const sec = $('set-sec-' + id);
    if (!sec) return;
    sec.scrollIntoView({ block: 'start' });
    markRail(id);
    // A keyboard user lands on the heading they asked for, not back at the rail.
    if (moveFocus) $('set-h-' + id).focus({ preventScroll: true });
  }

  /* The rail marks the section being read: the last one whose top has passed
     just under the header, or the last section once the page can't scroll
     further (a short last section never reaches the top). */
  let spyQueued = false;
  function onScroll() {
    if (!onScreen()) {
      window.removeEventListener('scroll', onScroll);
      return;
    }
    if (spyQueued) return;
    spyQueued = true;
    requestAnimationFrame(() => {
      spyQueued = false;
      if (!onScreen()) return;
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = SECTIONS[0][0];
      SECTIONS.forEach(([id]) => {
        const sec = $('set-sec-' + id);
        if (sec && sec.getBoundingClientRect().top <= 120) current = id;
      });
      markRail(atEnd ? SECTIONS[SECTIONS.length - 1][0] : current);
    });
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  const wholeIn = (raw, min) => {
    const n = Number(String(raw).trim());
    return String(raw).trim() !== '' && Number.isInteger(n) && n >= min && n <= D.DAYS_MAX ? n : null;
  };
  const pctOf = (raw) => {
    const n = Number(String(raw).trim());
    return String(raw).trim() !== '' && Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
  };
  const urlOk = (raw) => {
    const v = String(raw).trim();
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch (_) {
      return false;
    }
  };

  function problems() {
    const found = [];
    const abn = abnDigits(form.abn);
    if (abn && !abnValid(abn)) {
      found.push({ msg: 'That ABN doesn’t check out. It should be 11 digits, as shown on the ABN Lookup.', field: $('set-abn') });
    }
    const email = form.businessEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      found.push({ msg: 'That email doesn’t look right. It should read like name@example.com.', field: $('set-biz-email') });
    }
    if (form.registered && !abn) {
      found.push({ msg: 'GST registration needs your ABN. Add it under Business.', field: $('set-abn') });
    }
    // Only while registered: a blank rate on an unregistered business is inert.
    if (form.registered) {
      const percent = parseFloat(form.rateRaw);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        found.push({ msg: 'The GST rate must be a number between 0 and 100.', field: $('set-gst-rate') });
      }
    }
    if (pctOf(form.depositRaw) === null) {
      found.push({ msg: 'The deposit must be more than 0% and at most 100%.', field: $('set-deposit') });
    }
    if (wholeIn(form.validRaw, 1) === null) {
      found.push({ msg: 'Estimates must be valid for a whole number of days, from 1 to ' + D.DAYS_MAX + '.', field: $('set-valid') });
    }
    if (wholeIn(form.dueRaw, 0) === null) {
      found.push({ msg: 'Invoices must be due after a whole number of days, from 0 to ' + D.DAYS_MAX + '.', field: $('set-due') });
    }
    if (!urlOk(form.faqUrl)) {
      found.push({ msg: 'The FAQ link must be a web address starting https://, or left blank to hide the button.', field: $('set-faq') });
    }
    return found;
  }

  /* Merged onto `loaded`: the PUT replaces the whole row. Trimmed on the way
     out only; trimming as the user types eats the space between two words. */
  function payload() {
    const percent = parseFloat(form.rateRaw);
    const usable = Number.isFinite(percent) && percent >= 0 && percent <= 100;
    const messages = {};
    D.MESSAGE_KINDS.forEach((k) => {
      messages[k] = form['msg_' + k].trim();
    });
    return Object.assign({}, loaded, {
      business: Object.assign({}, loaded.business, {
        name: form.businessName.trim(),
        abn: abnDigits(form.abn),
        email: form.businessEmail.trim(),
        phone: form.businessPhone.trim(),
      }),
      gst: Object.assign({}, loaded.gst, {
        registered: form.registered,
        // Not `|| 0.1`: that turns a deliberate 0 into ten percent. An unusable
        // value only gets here while unregistered, where it is inert, so the
        // stored rate is kept.
        rate: usable ? percent / 100 : num(loaded.gst && loaded.gst.rate),
        pricesIncludeGst: form.pricesIncludeGst,
      }),
      payment: Object.assign({}, loaded.payment, {
        bankName: form.bankName.trim(),
        accountName: form.accountName.trim(),
        bsb: form.bsb.trim(),
        accountNumber: form.accountNumber.trim(),
        terms: form.terms.trim(),
      }),
      invoicing: Object.assign({}, loaded.invoicing, {
        depositPct: pctOf(form.depositRaw),
        validDays: wholeIn(form.validRaw, 1),
        dueDays: wholeIn(form.dueRaw, 0),
      }),
      messages: Object.assign({}, loaded.messages, messages),
      agreement: Object.assign({}, loaded.agreement, {
        // Line breaks inside are the agreement's own; only the ends are trimmed.
        text: form.agreementText.replace(/^\s+|\s+$/g, ''),
        faqUrl: form.faqUrl.trim(),
      }),
    });
  }

  function setSaving(next) {
    saving = next;
    $('set-save').disabled = next;
    $('set-spin').style.display = next ? 'inline-block' : 'none';
    $('set-save-label').textContent = next ? 'Saving…' : 'Save Settings';
    if (next) $('set-save-state').textContent = 'Saving…';
  }

  async function save() {
    if (saving) return;
    LSCUtil.clearFieldErrors($('settings-error'));
    const found = problems();
    if (found.length) {
      LSCUtil.showFieldErrors($('settings-error'), found);
      return;
    }
    const body = payload();
    setSaving(true);
    Toast.working('Saving settings…');
    try {
      const reply = await LSCApi.put('/api/settings', body);
      // Only now is this what estimates are priced against.
      LSCData.setSettings(reply.settings);
      if (!onScreen()) return;
      loaded = reply.settings;
      form = formFrom(loaded);
      baseline = snapshot();
      setSaving(false);
      fill();
      paintState();
      Toast.ok('Settings saved.');
    } catch (err) {
      Toast.hide();
      if (!onScreen()) return;
      setSaving(false);
      paintState();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      // Kept: #main hides with the app and comes back, edits intact.
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      const box = $('settings-error');
      box.textContent = err.kind === 'network'
        ? 'Couldn’t save: the server is unreachable. Your changes are still here; try again once it’s back.'
        : 'Couldn’t save: ' + (err.message || 'the server refused the request.');
      box.classList.add('show');
    }
  }

  // ── Email: status and the test ─────────────────────────────────────────────

  const EmailPanel = (() => {
    let mail = null; // the last status, or null while unknown

    const failure = (err) => (err.kind === 'network'
      ? 'Couldn’t reach the server. Try again once it’s back.'
      : (err.message || 'The server refused the request.'));

    function paint() {
      const text = $('set-email-status-text');
      if (!text) return; // the screen was left
      const dot = document.querySelector('#set-email-status .set-status-dot');
      const detail = $('set-email-detail');
      const send = $('set-email-send');
      if (!mail) {
        text.textContent = 'Couldn’t check';
        detail.textContent = '';
        send.disabled = true;
        return;
      }
      text.textContent = mail.configured ? 'Connected' : 'Not set up yet';
      if (dot) dot.style.background = mail.configured ? 'var(--ok, currentColor)' : '';
      let line = mail.configured
        ? 'Sent from ' + mail.from + (mail.replyTo ? '; replies go to ' + mail.replyTo + '.' : '.')
        : 'Add the Resend key and a From address to the server’s settings (SMTP_PASS and MAIL_FROM), then restart it.';
      if (mail.failed) {
        line += ' ' + mail.failed + (mail.failed === 1 ? ' email has' : ' emails have') + ' failed to send' +
          (mail.lastError && mail.lastError.message ? ' (the latest: ' + mail.lastError.message + ')' : '') + '.';
      }
      detail.textContent = line;
      send.disabled = !mail.configured;
      const to = $('set-email-to');
      if (to && !to.value && mail.replyTo) to.placeholder = mail.replyTo;
    }

    async function load(ticket) {
      try {
        mail = await LSCApi.get('/api/email/status');
      } catch (err) {
        if (!LSCRouter.isCurrent(ticket)) return;
        if (!(err instanceof LSCApi.ApiError)) throw err;
        if (err.kind === 'auth') { handlers.onAuthLost(); return; }
        mail = null;
      }
      if (LSCRouter.isCurrent(ticket)) paint();
    }

    async function sendTest() {
      const button = $('set-email-send');
      const result = $('set-email-result');
      const to = $('set-email-to').value.trim();
      button.disabled = true;
      result.textContent = 'Sending…';
      try {
        const reply = await LSCApi.post('/api/email/test', to ? { to } : {});
        if (!$('set-email-result')) return;
        $('set-email-result').textContent = reply.ok
          ? 'Sent to ' + reply.to + '. Check that inbox (and its spam folder).'
          : 'The test didn’t send: ' + (reply.message || 'the mail server refused it.');
      } catch (err) {
        if (!(err instanceof LSCApi.ApiError)) throw err;
        if (err.kind === 'auth') { handlers.onAuthLost(); return; }
        if ($('set-email-result')) $('set-email-result').textContent = 'The test didn’t send: ' + failure(err);
      }
      if ($('set-email-send')) $('set-email-send').disabled = !(mail && mail.configured);
    }

    return { load, sendTest, reset() { mail = null; } };
  })();

  // ── Account: the login's own details ───────────────────────────────────────

  const AccountPanel = (() => {
    let account = null; // { username, email } as the server last gave them
    let busy = false;

    const box = () => $('set-acct-error');
    const state = (text) => { if ($('set-acct-state')) $('set-acct-state').textContent = text; };

    function fill() {
      $('set-acct-username').value = account.username;
      $('set-acct-email').value = account.email;
      ['set-acct-new', 'set-acct-confirm', 'set-acct-current'].forEach((id) => { $(id).value = ''; });
      $('set-acct-save').disabled = false;
      state(account.email ? '' : 'No email yet: “Forgot password?” can’t send you a link until one is saved.');
    }

    async function load(ticket) {
      try {
        account = await LSCApi.get('/api/account');
      } catch (err) {
        if (!LSCRouter.isCurrent(ticket)) return;
        if (!(err instanceof LSCApi.ApiError)) throw err;
        if (err.kind === 'auth') { handlers.onAuthLost(); return; }
        account = null;
        state(err.kind === 'network' ? 'Couldn’t reach the server to load your account.' : 'Couldn’t load your account: ' + (err.message || 'the server refused.'));
        return;
      }
      if (LSCRouter.isCurrent(ticket) && $('set-acct-form')) fill();
    }

    function setBusy(next) {
      busy = next;
      $('set-acct-save').disabled = next;
      $('set-acct-spin').style.display = next ? 'inline-block' : 'none';
      $('set-acct-label').textContent = next ? 'Updating…' : 'Update Account';
    }

    async function save(event) {
      event.preventDefault();
      if (busy || !account) return;
      LSCUtil.clearFieldErrors(box());
      const username = $('set-acct-username').value.trim();
      const email = $('set-acct-email').value.trim();
      const fresh = $('set-acct-new').value;
      const again = $('set-acct-confirm').value;
      const current = $('set-acct-current').value;

      const found = [];
      if (username.length < 2) found.push({ msg: 'A username needs at least 2 characters.', field: $('set-acct-username') });
      else if (username.includes('@')) found.push({ msg: 'A username can’t contain @.', field: $('set-acct-username') });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        found.push({ msg: 'That email doesn’t look right. It should read like name@example.com.', field: $('set-acct-email') });
      }
      if (fresh || again) {
        if (fresh.length < 12) found.push({ msg: 'A new password needs at least 12 characters.', field: $('set-acct-new') });
        else if (fresh !== again) found.push({ msg: 'The two new passwords don’t match.', field: $('set-acct-confirm') });
      }
      const changed = username !== account.username || email !== account.email || Boolean(fresh);
      if (!found.length && !changed) {
        state('Nothing has changed.');
        return;
      }
      if (!found.length && !current) found.push({ msg: 'Type your current password to save these changes.', field: $('set-acct-current') });
      if (found.length) {
        LSCUtil.showFieldErrors(box(), found);
        return;
      }

      setBusy(true);
      state('');
      let reply;
      try {
        reply = await LSCApi.put('/api/account', {
          username, email, currentPassword: current, ...(fresh ? { newPassword: fresh } : {}),
        });
      } catch (err) {
        if (!$('set-acct-form')) return;
        setBusy(false);
        if (!(err instanceof LSCApi.ApiError)) throw err;
        if (err.kind === 'auth') { handlers.onAuthLost({ keepScreen: true }); return; }
        const fields = (err.data && err.data.fields) || {};
        const ids = { username: 'set-acct-username', email: 'set-acct-email', newPassword: 'set-acct-new', currentPassword: 'set-acct-current' };
        const named = Object.keys(fields).filter((k) => ids[k]).map((k) => ({ msg: fields[k], field: $(ids[k]) }));
        if (err.code === 'wrong_password') $('set-acct-current').value = '';
        if (named.length) LSCUtil.showFieldErrors(box(), named);
        else {
          box().textContent = err.kind === 'network'
            ? 'Couldn’t update: the server is unreachable. Try again once it’s back.'
            : err.kind === 'throttled'
              ? 'Too many wrong passwords. Wait a minute, then try again.'
              : 'Couldn’t update: ' + (err.message || 'the server refused the request.');
          box().classList.add('show');
        }
        return;
      }
      if (!$('set-acct-form')) return;
      account = { username: reply.username, email: reply.email };
      setBusy(false);
      fill();
      // The header's "Signed in as …" names the login.
      const out = document.getElementById('nav-sign-out');
      if (out) out.title = 'Signed in as ' + reply.username;
      const others = reply.signedOutOthers;
      const said = reply.passwordChanged
        ? 'Account updated, password changed' + (others ? '; ' + others + (others === 1 ? ' other browser was' : ' other browsers were') + ' signed out.' : '.')
        : 'Account updated.';
      state(said);
      Toast.ok(said);
    }

    return {
      load,
      bind() { $('set-acct-form').addEventListener('submit', save); },
      reset() { account = null; busy = false; },
    };
  })();

  // ── Showing ───────────────────────────────────────────────────────────────

  async function draw(sectionId) {
    const ticket = LSCRouter.ticket();
    saving = false;
    form = null;
    Preview.reset();
    EmailPanel.reset();
    AccountPanel.reset();
    root.innerHTML = head + '<div class="empty-state"><h3>Loading…</h3></div>';
    let settings;
    try {
      settings = (await LSCApi.get('/api/settings')).settings || {};
    } catch (err) {
      if (!LSCRouter.isCurrent(ticket)) return;
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost();
      // Never on the boot-time cache: a save would merge onto figures that are
      // not what the server holds.
      root.innerHTML = head + '<div class="empty-state"><h3>Couldn’t load your settings</h3><p>' +
        (err.kind === 'network' ? 'The server is unreachable. Try again once it’s back.' : esc(err.message || 'The server refused the request.')) +
        '</p></div>';
      return;
    }
    if (!LSCRouter.isCurrent(ticket)) return;

    loaded = settings;
    form = formFrom(settings);
    baseline = snapshot();
    root.innerHTML = screenMarkup(form, sectionId || SECTIONS[0][0]);
    bind();
    $('set-email-send').addEventListener('click', EmailPanel.sendTest);
    EmailPanel.load(ticket);
    AccountPanel.bind();
    AccountPanel.load(ticket);
    LSCUtil.landFocus(root);
    LSCUnsaved.watch('settings', { label: 'your settings', onScreen, dirty });
    window.removeEventListener('scroll', onScroll);
    window.addEventListener('scroll', onScroll, { passive: true });
    if (sectionId) jumpTo(sectionId, false);
    else window.scrollTo(0, 0);
  }

  /* #/settings or #/settings/<section>. False for anything else. */
  function show(rest, state) {
    if (rest.length > 1) return false;
    const sectionId = rest[0];
    if (sectionId !== undefined && !SECTIONS.some(([id]) => id === sectionId)) return false;
    document.title = 'Settings — LSC Billing';
    if (state && state.jump && onScreen() && form) {
      jumpTo(sectionId || SECTIONS[0][0], true);
      return true;
    }
    draw(sectionId);
    return true;
  }

  function init(mainEl, viewHandlers) {
    root = mainEl;
    handlers = viewHandlers;
  }

  // ── "Preview with a project…" (D39) ───────────────────────────────────────

  /* A dialog that fills the agreement on screen, saved or not, from one
     project's lead estimate: its client snapshot, stored total and booked days,
     with the deposit % that project would be accepted at and the business
     details on screen. Read-only; it writes nothing. */
  const Preview = (() => {
    let overlay = null;
    let opener = null;
    let projects = null; // the list, once fetched; kept until the screen is drawn again
    let seq = 0;

    const q = (id) => overlay.querySelector('#' + id);

    function onKeydown(event) {
      if (overlay.closest('[hidden]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      LSCModal.trapTab(overlay, event);
    }
    function onBackdrop(event) {
      if (event.target === overlay) close();
    }

    function close() {
      if (!overlay || !overlay.classList.contains('open')) return;
      seq += 1;
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      document.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onBackdrop);
      if (opener && opener.isConnected) opener.focus();
      opener = null;
    }

    const label = (p) => [p.upid || 'No UPID', p.name || 'Untitled', p.client && p.client.businessName].filter(Boolean).join(' · ');

    function notes(html) {
      q('set-pv-notes').innerHTML = html;
    }

    function failure(err) {
      return err.kind === 'network'
        ? 'Couldn’t reach the server. Try again once it’s back.'
        : 'Couldn’t load it: ' + esc(err.message || 'the server refused the request.');
    }

    async function load(projectId) {
      const mine = ++seq;
      const out = q('set-pv-text');
      out.textContent = '';
      out.setAttribute('aria-busy', 'true');
      notes('<p class="set-hint">Loading the project…</p>');
      let folder;
      try {
        folder = await LSCApi.get('/api/projects/' + encodeURIComponent(projectId) + '?today=' + LSCUtil.today());
      } catch (err) {
        if (mine !== seq) return;
        if (!(err instanceof LSCApi.ApiError)) throw err;
        if (err.kind === 'auth') {
          close();
          return handlers.onAuthLost({ keepScreen: true });
        }
        out.removeAttribute('aria-busy');
        notes('<p class="set-pv-warn">' + (err.status === 404 ? 'That project was deleted.' : failure(err)) + '</p>');
        return;
      }
      if (mine !== seq) return;
      out.removeAttribute('aria-busy');
      const project = folder.project || {};
      const estimate = (folder.estimates || [])[0];
      if (!estimate) {
        notes('<p class="set-pv-warn">This project has no estimate to fill the agreement from.</p>');
        return;
      }
      const ownPct = typeof project.depositPct === 'number' ? project.depositPct : null;
      // A single invoice has no deposit. Otherwise the project's own %, or the
      // one on this screen.
      const pct = project.invoicing === 'single' ? null : (ownPct !== null ? ownPct : pctOf(form.depositRaw));
      const totals = estimate.totals && typeof estimate.totals.totalIncGst === 'number'
        ? estimate.totals : { totalIncGst: project.totalIncGst, gst: 0 };
      // The amounts through calc.js, as task 19 makes the invoices.
      const deposit = pct === null ? null : LSCCalc.depositAmount(totals, pct);
      const values = D.agreementValues({
        client: estimate.client,
        upid: project.upid || estimate.upid,
        projectName: estimate.name || project.name,
        totalIncGst: totals.totalIncGst,
        depositPct: pct,
        depositTotal: deposit ? deposit.totalIncGst : null,
        balanceTotal: LSCCalc.finalInvoiceTotals(totals, null, deposit).balanceDue,
        dueDays: wholeIn(form.dueRaw, 0),
        days: estimate.days,
        business: { name: form.businessName, abn: abnDigits(form.abn) },
        today: LSCUtil.today(),
      });
      const filled = D.fillAgreement(form.agreementText, values);
      out.textContent = filled.text;
      const bits = [];
      if (filled.unknown.length) {
        bits.push('<p class="set-pv-warn"><strong>Not a field, left as typed:</strong> ' +
          filled.unknown.map((u) => '<code>' + esc(u) + '</code>').join(', ') + '</p>');
      }
      if (filled.blank.length) {
        bits.push('<p class="set-pv-warn"><strong>Blank for this project:</strong> ' +
          filled.blank.map((b) => '<code>{' + esc(b) + '}</code>').join(', ') + '</p>');
      }
      if (!bits.length) bits.push('<p class="set-hint">Every field is filled.</p>');
      notes(bits.join(''));
    }

    function shell(inner) {
      return '<div class="modal-box set-preview" role="dialog" aria-modal="true" aria-labelledby="set-pv-title">' +
        '<h2 class="modal-title" id="set-pv-title">Preview the service agreement</h2>' + inner +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" id="set-pv-close">Close</button></div></div>';
    }

    function drawPicker() {
      if (!projects.length) {
        q('set-pv-main').innerHTML = '<p class="set-hint set-hint-lead">There are no projects to preview with yet.</p>';
        return;
      }
      q('set-pv-main').innerHTML =
        '<div class="field"><label for="set-pv-project">Project</label><select id="set-pv-project">' +
        projects.map((p) => '<option value="' + esc(p.id) + '">' + esc(label(p)) + '</option>').join('') +
        '</select></div>' +
        '<div id="set-pv-notes" class="set-pv-notes" aria-live="polite"></div>' +
        '<div id="set-pv-text" class="set-pv-text" tabindex="0" role="region" aria-label="The agreement as this project would sign it"></div>';
      const pick = q('set-pv-project');
      pick.addEventListener('change', () => load(pick.value));
      load(pick.value);
    }

    async function open(from) {
      overlay = document.getElementById('modal-agreement-preview');
      opener = from || null;
      overlay.innerHTML = shell(
        form.agreementText.trim()
          ? '<div id="set-pv-main"><p class="set-hint set-hint-lead">Loading projects…</p></div>'
          : '<p class="set-hint set-hint-lead">The agreement is empty. Paste your text in first, then preview it here.</p>');
      overlay.classList.add('open');
      document.addEventListener('keydown', onKeydown);
      overlay.addEventListener('click', onBackdrop);
      q('set-pv-close').addEventListener('click', close);
      q('set-pv-close').focus();
      if (!q('set-pv-main')) return;

      const mine = ++seq;
      if (!projects) {
        try {
          const params = new URLSearchParams({ stage: 'all', limit: '200', today: LSCUtil.today() });
          projects = ((await LSCApi.get('/api/projects?' + params.toString())).projects || [])
            .filter((p) => p.estimateId);
        } catch (err) {
          if (mine !== seq) return;
          if (!(err instanceof LSCApi.ApiError)) throw err;
          if (err.kind === 'auth') {
            close();
            return handlers.onAuthLost({ keepScreen: true });
          }
          q('set-pv-main').innerHTML = '<p class="set-pv-warn">' + failure(err) + '</p>';
          return;
        }
        if (mine !== seq) return;
      }
      drawPicker();
      if (q('set-pv-project')) q('set-pv-project').focus();
    }

    /* A fresh visit to Settings fetches the list again: projects made or
       deleted since would otherwise be missing, or open as deleted. */
    function reset() {
      close();
      projects = null;
    }

    return { open, reset };
  })();

  return { init, show };
})();
