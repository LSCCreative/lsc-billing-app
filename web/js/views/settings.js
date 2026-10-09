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
 *   agreement.faqUrl (D55; '' hides the FAQ button)
 *   business.email and .phone (task 33 DR1): the client pages' contact line
 *   and notices, and the estimate PDF's sign-off. Stored before, but only SQL
 *   could set them.
 *   business.signer (ui-clarity U22): "Signs for the business", the
 *   agreement's "represented by".
 *   business.homeBase (trip-planner T9, task 6): { address, lat, lng, placeId },
 *   picked from a Places search; a trip offers it first for its start. Owner
 *   only: public.js's clientBusiness never passes it on.
 *
 * THE SERVICE AGREEMENT BUILDER (ui-clarity task 5; IA "Settings → Service
 * agreement")
 * agreement.{intro, clauses, hourlyRate} replace the retired free text
 * (agreement.text, still in the row and merged through untouched; nothing
 * reads it). The section is panels: Header (the locked layout with its fields
 * as chips, the Intro, and Missing links for blank Business details), Clauses
 * (cards: open to edit, reorder by drag, Alt+↑/↓ or ⋯, duplicate, delete with
 * an Undo toast), Agreement values, Fields you can use, and Client page.
 * The clauses live in `form.clauses`, edited in place, so the unsaved-edit
 * check and Save settings cover them like any other field; which cards are
 * open is not an edit and lives apart (Clauses.open). Cards are numbered by
 * position, as agreementText() numbers them for a deposit project.
 * "Preview with a project…" fills what is on screen, saved or not, through
 * the same agreementText() signing uses.
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
  /* The agreement header's details that come from Business, each shown in
     the Header panel with "Missing" when blank: [form key, field id, label]. */
  const BIZ_DETAILS = [
    ['businessEmail', 'set-biz-email', 'Email'],
    ['businessPhone', 'set-biz-phone', 'Phone'],
    ['businessSigner', 'set-biz-signer', 'Signs for the business'],
  ];

  /* Text fields: element id -> key in `form`. Each writes straight to `form` on
     input, so typing never redraws and never loses focus, and fill() puts the
     saved values back after a save. */
  const TEXT = [
    ['set-biz-name', 'businessName'],
    ['set-abn', 'abn'],
    ['set-biz-email', 'businessEmail'],
    ['set-biz-phone', 'businessPhone'],
    ['set-biz-signer', 'businessSigner'],
    ['set-home-base', 'homeBaseText'],
    ['set-gst-rate', 'rateRaw'],
    ['set-bank-name', 'bankName'],
    ['set-account-name', 'accountName'],
    ['set-bsb', 'bsb'],
    ['set-account-num', 'accountNumber'],
    ['set-terms', 'terms'],
    ['set-deposit', 'depositRaw'],
    ['set-valid', 'validRaw'],
    ['set-due', 'dueRaw'],
    ['set-agr-intro', 'intro'],
    ['set-agr-rate', 'hourlyRaw'],
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

  /* A stored home base, as the travel view reads it: an address with a spot. */
  function homeBaseOf(business) {
    const hb = business && business.homeBase;
    if (!hb || !hb.address || typeof hb.lat !== 'number' || typeof hb.lng !== 'number') return null;
    return { address: String(hb.address), lat: hb.lat, lng: hb.lng, placeId: String(hb.placeId || '') };
  }

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
      businessSigner: business.signer || '',
      // Where days usually start (trip-planner T9): a place picked from the search, or none.
      homeBase: homeBaseOf(business),
      homeBaseText: (homeBaseOf(business) || {}).address || '',
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
      intro: docs.agreement.intro,
      clauses: docs.agreement.clauses, // a fresh copy: edited in place
      hourlyRaw: docs.agreement.hourlyRate === null ? '' : String(docs.agreement.hourlyRate),
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
      '<div class="form-grid set-signer">' +
        field('set-biz-signer', 'Signs for the business', f.businessSigner, {
          attrs: ' placeholder="e.g. Lachlan Sullivan-Carey" autocomplete="name" aria-describedby="set-biz-signer-hint"',
          hint: 'Named in the service agreement as the person who represents the business.',
        }) +
      '</div>' +
      // Searched like a trip's stops (trip-planner T9), and offered first for a trip's start.
      '<div class="form-grid set-home-base">' +
        field('set-home-base', 'Home base address', f.homeBaseText, {
          attrs: ' placeholder="Search for an address" spellcheck="false" aria-describedby="set-home-base-hint set-home-base-msg"',
          hint: 'Where your shoot days usually start: the studio, or home. A trip offers it first for its start. Never shown to clients.',
        }) +
      '</div>' +
      '<p class="set-hint set-home-base-msg" id="set-home-base-msg" role="status"></p>' +
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
        field('set-bank-name', 'Bank name', f.bankName, { attrs: ' placeholder="e.g. Commonwealth Bank"' }) +
        field('set-account-name', 'Account name', f.accountName, { attrs: ' placeholder="e.g. LSC Creative Pty Ltd"' }) +
        field('set-bsb', 'BSB', f.bsb, { attrs: ' inputmode="numeric" placeholder="e.g. 062-000"' }) +
        field('set-account-num', 'Account number', f.accountNumber, { attrs: ' inputmode="numeric" placeholder="e.g. 12345678"' }) +
        field('set-terms', 'Payment terms', f.terms, { textarea: true, full: true, attrs: ' placeholder="e.g. Strictly 14 Days — EFT only. Please reference invoice number."' }) +
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

  /* The agreement's fixed header, as agreementText() lays it out, with each
     field shown as a chip where its value goes. Only the Intro is typed. */
  const chip = (key) => '<span class="agr-chip">{' + key + '}</span>';

  function headerMarkup(f) {
    const block = (label, lines, cls) => '<div class="agr-block' + (cls ? ' ' + cls : '') + '">' +
      '<p class="agr-label">' + label + '</p>' + lines.map((l) => '<p>' + l + '</p>').join('') + '</div>';
    return '<div class="agr-doc" aria-describedby="set-agr-doc-hint">' +
      '<p class="agr-label agr-title">' + esc(D.AGREEMENT_TITLE) + '</p>' +
      block('PARTIES', [
        chip('business_name') + ' (ABN ' + chip('business_abn') + '), represented by ' + chip('business_signer') + ' (the "Business")',
        chip('business_email') + ' · ' + chip('business_phone'),
        chip('client_business') + ' (ABN ' + chip('client_abn') + ') (the "Client")',
        chip('client_email') + ' · ' + chip('client_phone'),
      ]) +
      '<div class="field agr-intro">' +
        '<label for="set-agr-intro">Intro</label>' +
        '<textarea id="set-agr-intro" rows="3" spellcheck="true" data-agr-text aria-describedby="set-agr-intro-hint">' + esc(f.intro) + '</textarea>' +
        '<p class="set-hint" id="set-agr-intro-hint">The header’s one paragraph of your own words. Leave it empty to go without.</p>' +
      '</div>' +
      block('PROJECT', [chip('project_name') + ' (' + chip('upid') + '), as set out in quote ' + chip('upid') + ' (the "Quote").']) +
      block('PAYMENT SCHEDULE', [
        'Total: ' + chip('total'),
        'Deposit (' + chip('deposit_pct') + '): ' + chip('deposit_amount'),
        'Balance: ' + chip('balance_amount'),
        'Invoices are due ' + chip('due_days') + ' days after each is issued',
        '<span class="agr-alt">On a single invoice, one line: Total: ' + chip('total') + ', on a single invoice, due ' +
          chip('due_days') + ' days after it is issued</span>',
      ]) +
      block('SCOPE AND PRODUCTION DAYS', [
        'The services and deliverables are as set out in the Quote.',
        'Production days:<br>' + chip('production_days'),
      ]) +
      block('TERMS', ['<span class="agr-alt">The clauses below, numbered in their order.</span>']) +
      '<p class="agr-sign">Signed for ' + chip('client_business') + ' by ' + chip('client_contact') + ', ' +
        chip('signatory_role') + ', on ' + chip('date') + '.</p>' +
    '</div>' +
    '<p class="set-hint" id="set-agr-doc-hint">The same on every agreement, filled in from the project. A part with nothing to ' +
      'fill is left out, so a client with no ABN gets no “(ABN )”.</p>' +
    '<div class="agr-biz">' +
      '<p class="agr-biz-lead">From <button type="button" class="set-link agr-goto" data-goto="set-biz-name">Settings → Business</button></p>' +
      '<dl class="agr-biz-list">' +
        BIZ_DETAILS.map(([key, , label]) => '<div><dt>' + label + '</dt><dd data-biz="' + key + '"></dd></div>').join('') +
      '</dl>' +
    '</div>';
  }

  /* (a)…(z), (aa)…; (i), (ii)… under a lettered one, as agreementText()
     letters them, for the card's sub-clause rows (task 6). Unlike the render,
     a blank row is lettered too: a row just added reads (d) at once, while
     its text is still to come. A blank row prints nothing, and payload()
     leaves it out, so the two agree again once saved. Each mark is
     { mark: '(i)', full: '(b)(i)', under: true }. */
  function subMarks(subs) {
    const letter = (n) => {
      let out = '';
      for (let k = n; k >= 0; k = Math.floor(k / 26) - 1) out = String.fromCharCode(97 + (k % 26)) + out;
      return out;
    };
    const roman = (n) => {
      let k = n + 1;
      let out = '';
      [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
        [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']].forEach(([v, sym]) => {
        for (; k >= v; k -= v) out += sym;
      });
      return out;
    };
    let l = -1;
    let r = -1;
    return subs.map((x) => {
      if (x.indent === 1 && l >= 0) {
        const mark = '(' + roman(++r) + ')';
        return { mark, full: '(' + letter(l) + ')' + mark, under: true };
      }
      r = -1;
      const mark = '(' + letter(++l) + ')';
      return { mark, full: mark, under: false };
    });
  }

  const isBlankSub = (x) => !x.heading.trim() && !x.text.trim();
  const subName = (x, m) => (x.heading.trim() ? m.full + ' ' + x.heading.trim() : 'Sub-clause ' + m.full);

  /* A row's ⋯: Indent from the second row on (an indented first row has
     nothing to sit under), Outdent on an indented one. */
  function subMenu(k, n, x, m) {
    return LSCMenu.markup({
      label: 'Actions',
      icon: '⋯',
      ariaLabel: 'Actions for sub-clause ' + m.full,
      btnClass: 'btn btn-quiet btn-sm sub-more',
      items: [
        k > 0 && x.indent !== 1 && { text: 'Indent', attrs: { 'data-sub-act': 'in' } },
        x.indent === 1 && { text: 'Outdent', attrs: { 'data-sub-act': 'out' } },
        k > 0 && { text: 'Move up', attrs: { 'data-sub-act': 'up' } },
        k < n - 1 && { text: 'Move down', attrs: { 'data-sub-act': 'down' } },
        { text: 'Delete', danger: true, attrs: { 'data-sub-act': 'del' } },
      ],
    });
  }

  function subMarkup(x, k, n, m) {
    const id = 'set-sub-' + x.id;
    return '<li class="sub' + (m.under ? ' is-indent' : '') + '" data-sid="' + esc(x.id) + '">' +
      '<button type="button" class="sub-handle" aria-label="Move sub-clause ' + m.full + '" aria-describedby="set-sub-howto" title="Drag to reorder, or Alt+↑ / Alt+↓">' +
        '<span class="clause-grip" aria-hidden="true"></span></button>' +
      '<span class="sub-mark" aria-hidden="true">' + m.mark + '</span>' +
      '<input id="' + id + '-h" class="sub-heading" type="text" value="' + esc(x.heading) + '" data-sub-field="heading" data-agr-text spellcheck="true"' +
        ' placeholder="Heading" aria-label="Sub-clause ' + m.full + ' heading, optional">' +
      '<textarea id="' + id + '-t" class="sub-text" rows="' + rowsFor(x.text, 2) + '" data-sub-field="text" data-agr-text spellcheck="true"' +
        ' placeholder="Text" aria-label="Sub-clause ' + m.full + ' text" aria-describedby="set-cl-text-hint">' + esc(x.text) + '</textarea>' +
      '<span class="sub-menu">' + subMenu(k, n, x, m) + '</span>' +
    '</li>';
  }

  /* The body's label: plain Text, or an optional lead-in once there are
     sub-clauses (with them, the text is often empty). */
  const bodyLabel = (has) => (has ? 'Intro <span class="set-optional">(optional)</span>' : 'Text');

  const clauseName = (c) => c.title.trim() || 'Untitled clause';

  /* A text box tall enough to show its text when a card opens (about 80
     characters a line at the card's width), within reason. */
  function rowsFor(text, min) {
    const lines = String(text).split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 80)), 0);
    return Math.min(14, Math.max(min, lines));
  }

  const menuLabel = (i, c) => 'Actions for clause ' + (i + 1) + ', ' + clauseName(c);
  const handleLabel = (i, c) => 'Move clause ' + (i + 1) + ', ' + clauseName(c);

  function clauseMenu(i, n, c) {
    return LSCMenu.markup({
      label: 'Actions',
      icon: '⋯',
      ariaLabel: menuLabel(i, c),
      btnClass: 'btn btn-quiet btn-sm clause-more',
      items: [
        i > 0 && { text: 'Move up', attrs: { 'data-cl-act': 'up' } },
        i < n - 1 && { text: 'Move down', attrs: { 'data-cl-act': 'down' } },
        { text: 'Duplicate', attrs: { 'data-cl-act': 'dup' } },
        { text: 'Delete', danger: true, attrs: { 'data-cl-act': 'del' } },
      ],
    });
  }

  function clauseMarkup(c, i, total, isOpen) {
    const id = 'set-cl-' + c.id;
    const marks = subMarks(c.subs);
    const n = c.subs.length;
    const subs = '<div class="clause-subs">' +
      '<p class="clause-subs-head" id="' + id + '-subs"' + (n ? '' : ' hidden') + '>Sub-clauses</p>' +
      '<ol class="sub-list" aria-labelledby="' + id + '-subs">' +
        c.subs.map((x, k) => subMarkup(x, k, n, marks[k])).join('') +
      '</ol>' +
      '<div class="sub-add"><button type="button" class="btn btn-quiet btn-sm" data-sub-add>+ Add sub-clause</button></div>' +
    '</div>';
    return '<li class="clause' + (isOpen ? ' is-open' : '') + '" data-id="' + esc(c.id) + '">' +
      '<div class="clause-row">' +
        '<button type="button" class="clause-handle" aria-label="' + esc(handleLabel(i, c)) + '" aria-describedby="set-cl-howto" title="Drag to reorder, or Alt+↑ / Alt+↓">' +
          '<span class="clause-grip" aria-hidden="true"></span></button>' +
        '<h4 class="clause-head"><button type="button" class="clause-toggle" id="' + id + '-toggle" aria-expanded="' + isOpen + '" aria-controls="' + id + '-body">' +
          '<span class="clause-num"><span class="sr-only">Clause </span><span class="clause-n">' + (i + 1) + '</span></span>' +
          '<span class="clause-title">' + esc(clauseName(c)) + '</span>' +
          '<span class="clause-tag"' + (c.depositOnly ? '' : ' hidden') + '>Deposit only</span>' +
          '<span class="panel-chev" aria-hidden="true"></span>' +
        '</button></h4>' +
        '<span class="clause-menu">' + clauseMenu(i, total, c) + '</span>' +
      '</div>' +
      '<div class="clause-body" id="' + id + '-body"' + (isOpen ? '' : ' hidden') + '>' +
        '<div class="field"><label for="' + id + '-title">Title</label>' +
          '<input id="' + id + '-title" type="text" value="' + esc(c.title) + '" data-cl-field="title" data-agr-text spellcheck="true"></div>' +
        // With sub-clauses the text is only their lead-in, often empty.
        '<div class="field"><label for="' + id + '-text" class="clause-body-label">' + bodyLabel(n > 0) + '</label>' +
          '<textarea id="' + id + '-text" rows="' + rowsFor(c.body, n ? 2 : 3) + '" data-cl-field="body" data-agr-text spellcheck="true" aria-describedby="set-cl-text-hint"' +
          (n ? ' placeholder="Text before the sub-clauses"' : '') + '>' + esc(c.body) + '</textarea></div>' +
        subs +
        '<label class="set-check clause-deposit"><input type="checkbox" data-cl-field="depositOnly"' + (c.depositOnly ? ' checked' : '') +
          ' aria-describedby="' + id + '-dep-hint"><span>Deposit projects only</span></label>' +
        '<p class="set-hint clause-dep-hint" id="' + id + '-dep-hint">Left out of an agreement billed on a single invoice, and the clauses after it number on.</p>' +
      '</div>' +
    '</li>';
  }

  function agreementMarkup(f) {
    const fields = D.AGREEMENT_FIELDS.map((x) =>
      '<li><button type="button" class="set-field-code" data-field="' + x.key + '" aria-label="Insert {' + x.key + '}: ' +
      esc(x.says) + '"><code>{' + x.key + '}</code></button><span>' + esc(x.says) + '</span></li>').join('');
    const n = f.clauses.length;
    const panel = (key, title, body, extra, action) => '<section class="panel set-panel" aria-labelledby="set-agr-' + key + '-title">' +
      '<div class="panel-head"><h3 class="panel-title" id="set-agr-' + key + '-title">' + title + (extra || '') + '</h3>' + (action || '') + '</div>' +
      '<div class="panel-body">' + body + '</div></section>';
    return section('agreement', 'Service agreement',
      'What the client signs when they accept a quote: the header below, then your clauses. Each signing keeps the exact ' +
      'text it was signed with, so a change here never alters an agreement already signed.',
      '<p class="set-preview-row set-agr-preview"><button type="button" class="btn btn-sm" id="set-preview">Preview with a project…</button></p>' +
      '<div class="set-agr-panels">' +
        panel('head', 'Header', headerMarkup(f)) +
        panel('clauses', 'Clauses',
          '<p class="set-hint set-cl-lead" id="set-cl-howto">Numbered in this order. Drag a clause by its handle, or focus the handle ' +
            'and press Alt+↑ or Alt+↓. Open one to edit it.</p>' +
          '<p class="sr-only" id="set-cl-text-hint">Paragraphs are separated by a blank line. Fields in curly brackets are filled in per project.</p>' +
          '<p class="sr-only" id="set-sub-howto">Lettered in this order. Drag by the handle, or focus it and press Alt+↑ or Alt+↓.</p>' +
          '<ol class="clause-list" id="set-cl-list">' +
            f.clauses.map((c, i) => clauseMarkup(c, i, n, Clauses.isOpen(c.id))).join('') +
          '</ol>' +
          '<p class="set-cl-empty" id="set-cl-empty"' + (n ? ' hidden' : '') + '>No clauses: the client would sign only an acceptance of the quote.</p>' +
          '<div class="set-cl-add"><button type="button" class="btn btn-sm" id="set-cl-add">+ Add clause</button></div>' +
          '<div class="sr-only" id="set-cl-live" aria-live="polite"></div>',
          '<span class="panel-count" id="set-cl-count">' + n + '</span>',
          '<span class="set-cl-tools">' + LSCMenu.markup({
            label: 'Actions',
            icon: '⋯',
            ariaLabel: 'Clause actions',
            btnClass: 'btn btn-quiet btn-sm',
            items: [{ text: 'Reset to LSC default clauses…', attrs: { 'data-cl-reset': '' } }],
          }) + '</span>') +
        panel('values', 'Agreement values',
          '<div class="set-agr-rate">' +
            field('set-agr-rate', 'Hourly rate for extra work ($)', f.hourlyRaw, {
              type: 'number',
              attrs: ' min="0" step="0.01" inputmode="decimal" placeholder="e.g. 63" aria-describedby="set-agr-rate-hint"',
              hint: 'Fills <code>{hourly_rate}</code>, which the Revisions clause uses. Clear it to leave that blank.',
            }) +
          '</div>') +
        '<section class="panel set-panel is-collapsed" aria-labelledby="set-agr-fields-title">' +
          '<div class="panel-head"><h3 class="panel-title" id="set-agr-fields-title">' +
            '<button type="button" class="panel-toggle" aria-expanded="false" aria-controls="set-agr-fields-body">' +
              '<span class="panel-chev" aria-hidden="true"></span><span class="panel-name">Fields you can use</span>' +
              '<span class="panel-sum">' + D.AGREEMENT_FIELDS.length + ' fields</span>' +
            '</button></h3></div>' +
          '<div class="panel-body" id="set-agr-fields-body" hidden>' +
            '<p class="set-hint set-hint-lead">Each is filled in per project when the agreement is signed. Click one to put it ' +
              'where the cursor last was, in the Intro or a clause.</p>' +
            '<ul class="set-field-list">' + fields + '</ul>' +
          '</div>' +
        '</section>' +
        panel('client', 'Client page',
          '<div class="set-faq">' +
            field('set-faq', 'Service agreement FAQ', f.faqUrl, { type: 'url', attrs: ' inputmode="url" placeholder="https://" aria-describedby="set-faq-hint"', hint: 'The client page’s “Service agreement FAQ” button opens this. Clear it to hide the button.' }) +
          '</div>') +
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
      'Update account button, not with Save settings, and any change needs your current password.',
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
          '<button type="submit" class="btn" id="set-acct-save" data-write disabled>' +
          '<span class="spinner" id="set-acct-spin"></span><span id="set-acct-label">Update account</span></button>' +
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
          '<span class="spinner" id="set-spin"></span><span id="set-save-label">Save settings</span></button></div>' +
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

  /* The agreement header's Business details: each value, or "Missing" as a
     button that takes you to its field. Repainted as those fields are typed
     in, since both are on this page. */
  function paintBiz() {
    BIZ_DETAILS.forEach(([key, fieldId, label]) => {
      const dd = root.querySelector('[data-biz="' + key + '"]');
      if (!dd) return;
      const value = form[key].trim();
      dd.innerHTML = value
        ? '<span class="agr-biz-value">' + esc(value) + '</span>'
        : '<button type="button" class="agr-missing agr-goto" data-goto="' + fieldId + '" aria-label="' + label +
          ' is missing. Add it under Business.">Missing</button>';
    });
  }

  /* To a field elsewhere on the page (a Missing link): scrolled to the middle
     of the window and focused, with the rail marking its section. */
  function goToField(fieldId) {
    const el = $(fieldId);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    const sec = el.closest('.set-section');
    if (sec) markRail(sec.id.replace('set-sec-', ''));
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
    paintBiz();
    Clauses.render();
  }

  /* A fill-in field goes where the cursor last was in the agreement's own text
     (the Intro, or a clause's title or text), replacing any selection, as if
     typed, and the cursor ends up after it. Before any of them has had the
     cursor, it goes at the end of the Intro. */
  let lastText = null; // the id of the agreement text box that last had focus
  function insertField(key) {
    let box = lastText && $(lastText);
    if (!box) box = $('set-agr-intro');
    const card = box.closest('.clause');
    if (card) Clauses.setOpen(card.dataset.id, true);
    const code = '{' + key + '}';
    const start = typeof box.selectionStart === 'number' ? box.selectionStart : box.value.length;
    const end = typeof box.selectionEnd === 'number' ? box.selectionEnd : start;
    box.focus();
    box.setRangeText(code, start, end, 'end');
    // Through the box's own input handler, so `form` and the card's row follow.
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* Home base (trip-planner T9): the travel view's address search without
     the map (Places suggestions through maps.js, in typeahead.js's
     combobox). A pick stores the place; editing the text afterwards means
     another pick is needed, which problems() asks for on save. One search
     session per pick, as Google bills them. */
  function bindHomeBase() {
    const input = $('set-home-base');
    const msg = $('set-home-base-msg');
    let session = null;
    input.addEventListener('input', () => {
      if (!input.value.trim()) form.homeBase = null;
    });
    ClientTypeahead.attach(input, {
      fetch: async (query) => {
        if (query.trim().length < 3) return [];
        try {
          if (!session) session = await LSCMaps.newSession();
          const items = await LSCMaps.suggest(query, { session });
          msg.textContent = '';
          return items;
        } catch (err) {
          msg.textContent = err.message;
          return [];
        }
      },
      label: (s) => s.main || s.label,
      sub: (s) => s.sub,
      debounce: 250,
      onPick: async (s) => {
        msg.textContent = 'Finding ' + s.label + '…';
        try {
          const place = await LSCMaps.place(s);
          session = null;
          if (!onScreen()) return;
          form.homeBase = place;
          form.homeBaseText = place.address;
          input.value = place.address;
          msg.textContent = 'Home base set to ' + place.address + '. Save to keep it.';
          paintState();
        } catch (err) {
          msg.textContent = err.message;
        }
      },
    });
  }

  function bind() {
    TEXT.forEach(([id, key]) => {
      $(id).addEventListener('input', function () {
        form[key] = this.value;
        if (key.startsWith('msg_')) paintDefaults();
        if (BIZ_DETAILS.some(([k]) => k === key)) paintBiz();
        paintState();
      });
    });
    bindHomeBase();
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
    $('set-sec-agreement').addEventListener('focusin', (event) => {
      if (event.target.matches('[data-agr-text]')) lastText = event.target.id;
    });
    root.addEventListener('click', (event) => {
      const go = event.target.closest('.agr-goto');
      if (go) goToField(go.dataset.goto);
    });
    Clauses.bind();
    $('set-preview').addEventListener('click', () => Preview.open($('set-preview')));
    $('set-save').addEventListener('click', save);

    root.querySelector('.set-rail').addEventListener('click', (event) => {
      const link = event.target.closest('[data-section]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      LSCRouter.go('/settings/' + link.dataset.section, { replace: true, skipGuard: true, state: { jump: true } });
    });
  }

  // ── The clause cards (ui-clarity task 5) ──────────────────────────────────

  /* Every change to the list goes through here, and each one changes
     `form.clauses` and the card nodes together: the nodes are moved, added
     and removed, never redrawn, so an open card keeps its cursor and scroll.
     renumber() then puts each card's number, labels and ⋯ items right for
     where it now stands (Move up isn't offered to the first, nor Move down to
     the last).
     Sub-clauses (task 6) follow the same rule one level down: a row's data
     and node change together, and reletter() puts every row's letter,
     indent, labels and ⋯ right afterwards. Each open-able card's row list
     has its own sortable (sortable.js takes direct children only). */
  const Clauses = (() => {
    const open = new Set(); // ids of the open cards; survives a save's redraw
    let sortable = null;
    const subSortables = new Map(); // clause id → its rows' sortable

    const list = () => $('set-cl-list');
    const cards = () => Array.from(list().children);
    const cardOf = (id) => list().querySelector(':scope > [data-id="' + CSS.escape(id) + '"]');
    const indexOf = (id) => form.clauses.findIndex((c) => c.id === id);

    function isOpen(id) {
      return open.has(id);
    }

    /* A short random id, unique among every clause and sub-clause id (IA:
       made in the browser, kept across saves). */
    function newId(prefix) {
      const used = new Set();
      form.clauses.forEach((c) => {
        used.add(c.id);
        c.subs.forEach((x) => used.add(x.id));
      });
      let id;
      do id = prefix + Math.random().toString(36).slice(2, 8); while (used.has(id));
      return id;
    }

    function announce(text) {
      const live = $('set-cl-live');
      if (!live) return;
      live.textContent = '';
      LSCUtil.announce(live, text);
    }

    function renumber() {
      const nodes = cards();
      const n = nodes.length;
      nodes.forEach((node, i) => {
        const c = form.clauses[i];
        node.querySelector('.clause-n').textContent = String(i + 1);
        node.querySelector('.clause-handle').setAttribute('aria-label', handleLabel(i, c));
        node.querySelector('.clause-menu').innerHTML = clauseMenu(i, n, c);
      });
      $('set-cl-count').textContent = String(n);
      $('set-cl-empty').hidden = n > 0;
    }

    function setOpen(id, next) {
      const node = cardOf(id);
      if (!node) return;
      if (next) open.add(id);
      else open.delete(id);
      node.classList.toggle('is-open', next);
      node.querySelector('.clause-toggle').setAttribute('aria-expanded', String(next));
      node.querySelector('.clause-body').hidden = !next;
    }

    /* The list from `form`, after a save trimmed what it stored. */
    function render() {
      const n = form.clauses.length;
      dropSubSortables();
      list().innerHTML = form.clauses.map((c, i) => clauseMarkup(c, i, n, open.has(c.id))).join('');
      cards().forEach(wire);
      renumber();
    }

    // ── Sub-clauses ──
    const clauseOf = (node) => form.clauses[indexOf(node.dataset.id)];
    const subList = (card) => card.querySelector('.sub-list');
    const subRows = (card) => Array.from(subList(card).children).filter((el) => el.matches('.sub'));
    const rowOf = (card, sid) => subList(card).querySelector(':scope > [data-sid="' + CSS.escape(sid) + '"]');

    function wire(card) {
      const id = card.dataset.id;
      subSortables.set(id, LSCSortable.attach(subList(card), {
        item: '.sub',
        handle: '.sub-handle',
        onMove: (from, to) => moveSub(card, from, to),
      }));
    }

    function dropSubSortables() {
      subSortables.forEach((s) => s.cancel());
      subSortables.clear();
    }

    /* Letters, indents, labels and ⋯ for every row, from the data. A row that
       has become the first can't stay indented: it has nothing to sit under. */
    function reletter(card) {
      const c = clauseOf(card);
      if (c.subs.length && c.subs[0].indent === 1) c.subs[0].indent = 0;
      const marks = subMarks(c.subs);
      const n = c.subs.length;
      subRows(card).forEach((row, k) => {
        const x = c.subs[k];
        const m = marks[k];
        row.classList.toggle('is-indent', m.under);
        row.querySelector('.sub-mark').textContent = m.mark;
        row.querySelector('.sub-handle').setAttribute('aria-label', 'Move sub-clause ' + m.full);
        row.querySelector('.sub-heading').setAttribute('aria-label', 'Sub-clause ' + m.full + ' heading, optional');
        row.querySelector('.sub-text').setAttribute('aria-label', 'Sub-clause ' + m.full + ' text');
        row.querySelector('.sub-menu').innerHTML = subMenu(k, n, x, m);
      });
      card.querySelector('.clause-subs-head').hidden = n === 0;
      const body = card.querySelector('[data-cl-field="body"]');
      card.querySelector('.clause-body-label').innerHTML = bodyLabel(n > 0);
      if (n) body.setAttribute('placeholder', 'Text before the sub-clauses');
      else body.removeAttribute('placeholder');
      return marks;
    }

    function focusSub(card, sid, part) {
      const row = rowOf(card, sid);
      if (row) row.querySelector(part).focus();
    }

    /* Drag, Alt+arrow and the row's ⋯ all end here. */
    function moveSub(card, from, to) {
      const c = clauseOf(card);
      const n = c.subs.length;
      if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
      const [x] = c.subs.splice(from, 1);
      c.subs.splice(to, 0, x);
      const row = subRows(card)[from];
      const rest = subRows(card).filter((el) => el !== row);
      subList(card).insertBefore(row, rest[to] || null);
      const marks = reletter(card);
      paintState();
      focusSub(card, x.id, '.sub-handle');
      announce((x.heading.trim() || 'Sub-clause') + ' moved to ' + marks[to].full + ', ' + (to + 1) + ' of ' + n + '.');
    }

    function indentSub(card, k, indent) {
      const c = clauseOf(card);
      const x = c.subs[k];
      if (!x || (indent === 1 && k === 0)) return;
      x.indent = indent;
      const marks = reletter(card);
      paintState();
      focusSub(card, x.id, '.sub-more');
      announce((indent ? 'Indented' : 'Outdented') + ': now ' + marks[k].full + '.');
    }

    function insertSub(card, x, at, part) {
      const c = clauseOf(card);
      c.subs.splice(at, 0, x);
      const holder = document.createElement('ol');
      holder.innerHTML = subMarkup(x, at, c.subs.length, subMarks(c.subs)[at]);
      subList(card).insertBefore(holder.firstChild, subRows(card)[at] || null);
      const marks = reletter(card);
      paintState();
      focusSub(card, x.id, part);
      return marks[indexOfSub(c, x.id)];
    }

    const indexOfSub = (c, sid) => c.subs.findIndex((x) => x.id === sid);

    function addSub(card) {
      const c = clauseOf(card);
      const m = insertSub(card, { id: newId('s'), heading: '', text: '', indent: 0 }, c.subs.length, '.sub-heading');
      announce('Sub-clause ' + m.full + ' added.');
    }

    /* Gone at once, with Undo in the toast (no confirm: a row is small, and
       the Undo puts it back where it was, indent and all). */
    function dropSub(card, k) {
      const c = clauseOf(card);
      const x = c.subs[k];
      if (!x) return;
      const name = subName(x, subMarks(c.subs)[k]);
      c.subs.splice(k, 1);
      rowOf(card, x.id).remove();
      reletter(card);
      paintState();
      // Focus to the row that took its place, or the one above, or Add.
      const next = c.subs[k] || c.subs[k - 1];
      if (next) focusSub(card, next.id, '.sub-more');
      else card.querySelector('[data-sub-add]').focus();
      announce(name + ' deleted.');
      const owner = form;
      const cid = c.id;
      Toast.ok('“' + (x.heading.trim() || 'Sub-clause') + '” deleted.', {
        action: {
          label: 'Undo',
          run: () => {
            const home = form === owner && onScreen() && cardOf(cid);
            const into = home && clauseOf(home);
            if (!into || indexOfSub(into, x.id) >= 0) return;
            setOpen(cid, true);
            const m = insertSub(home, x, Math.min(k, into.subs.length), '.sub-handle');
            announce(subName(x, m) + ' restored.');
          },
        },
      });
    }

    /* The 13 defaults back, in place of whatever is there, after a confirm
       that says how many go; Undo in the toast puts them back. */
    function resetDefaults(opener) {
      const n = form.clauses.length;
      const fresh = D.docSettings({}).agreement.clauses;
      const run = () => {
        const before = form.clauses.slice();
        const wasOpen = new Set(open);
        replaceAll(fresh, []);
        $('set-cl-list').querySelector('.clause-toggle').focus();
        announce('Clauses reset: the ' + fresh.length + ' LSC defaults.');
        const owner = form;
        Toast.ok('Clauses reset to the ' + fresh.length + ' LSC defaults.', {
          action: {
            label: 'Undo',
            run: () => {
              if (form !== owner || !onScreen()) return;
              replaceAll(before, wasOpen);
              announce('Your ' + before.length + ' clause' + (before.length === 1 ? '' : 's') + ' restored.');
            },
          },
        });
      };
      if (!n) {
        run();
        return;
      }
      Confirm.open(opener, {
        title: 'Reset to the LSC default clauses?',
        body: (n === 1 ? 'Your 1 clause is' : 'Your ' + n + ' clauses are') + ' replaced by the ' + fresh.length +
          ' LSC default clauses. You can undo it straight after, and nothing changes for clients until you save.',
        confirm: 'Replace ' + n + ' clause' + (n === 1 ? '' : 's'),
        run,
      });
    }

    function replaceAll(next, openIds) {
      form.clauses.splice(0, form.clauses.length, ...next);
      open.clear();
      openIds.forEach((id) => open.add(id));
      render();
      paintState();
    }

    function focusHandle(id) {
      const node = cardOf(id);
      if (node) node.querySelector('.clause-handle').focus();
    }

    /* The one move: drag, Alt+arrow and the ⋯ menu all end here. */
    function move(from, to) {
      const n = form.clauses.length;
      if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
      const [c] = form.clauses.splice(from, 1);
      form.clauses.splice(to, 0, c);
      const node = cards()[from];
      const rest = cards().filter((el) => el !== node);
      list().insertBefore(node, rest[to] || null);
      renumber();
      paintState();
      focusHandle(c.id);
      announce(clauseName(c) + ' moved to clause ' + (to + 1) + ' of ' + n + '.');
    }

    function insertAt(c, at, focus) {
      form.clauses.splice(at, 0, c);
      const n = form.clauses.length;
      const holder = document.createElement('ol');
      holder.innerHTML = clauseMarkup(c, at, n, open.has(c.id));
      const node = holder.firstChild;
      list().insertBefore(node, cards()[at] || null);
      wire(node);
      renumber();
      paintState();
      if (focus === 'title') {
        const title = node.querySelector('[data-cl-field="title"]');
        title.focus();
        title.select();
      } else node.querySelector('.clause-toggle').focus();
    }

    function add() {
      const c = { id: newId('c'), title: '', body: '', subs: [], depositOnly: false };
      open.add(c.id);
      insertAt(c, form.clauses.length, 'title');
    }

    function duplicate(id) {
      const at = indexOf(id);
      if (at < 0) return;
      const copy = JSON.parse(JSON.stringify(form.clauses[at]));
      copy.id = newId('c');
      copy.subs.forEach((x) => {
        x.id = newId('s');
      });
      copy.title = copy.title.trim() ? copy.title.trim() + ' (copy)' : '';
      open.add(copy.id);
      insertAt(copy, at + 1, 'title');
      announce('Copy added as clause ' + (at + 2) + '.');
    }

    const hasText = (c) => Boolean(c.body.trim()) || c.subs.some((x) => x.heading.trim() || x.text.trim());

    /* Gone at once, with Undo in the toast; a clause with text asks first. */
    function remove(id, opener) {
      const at = indexOf(id);
      if (at < 0) return;
      const c = form.clauses[at];
      if (hasText(c)) {
        Confirm.open(opener, {
          title: 'Delete clause ' + (at + 1) + '?',
          body: '“' + clauseName(c) + '” and its text go from the agreement. You can undo it straight after, and nothing ' +
            'changes for clients until you save.',
          confirm: 'Delete clause',
          run: () => drop(id),
        });
        return;
      }
      drop(id);
    }

    function drop(id) {
      const at = indexOf(id);
      if (at < 0) return;
      const [c] = form.clauses.splice(at, 1);
      const wasOpen = open.has(id);
      open.delete(id);
      cardOf(id).remove();
      subSortables.delete(id);
      renumber();
      paintState();
      // Focus to the card that took its place, or the one above, or Add.
      const next = cards()[at] || cards()[at - 1];
      if (next) next.querySelector('.clause-toggle').focus();
      else $('set-cl-add').focus();
      announce('Clause ' + (at + 1) + ', ' + clauseName(c) + ', deleted.');
      const owner = form; // an Undo after the screen was drawn again does nothing
      Toast.ok('“' + clauseName(c) + '” deleted.', {
        action: {
          label: 'Undo',
          run: () => {
            if (form !== owner || !onScreen() || indexOf(c.id) >= 0) return;
            if (wasOpen) open.add(c.id);
            const back = Math.min(at, form.clauses.length);
            insertAt(c, back);
            announce(clauseName(c) + ' restored as clause ' + (back + 1) + '.');
          },
        },
      });
    }

    function bind() {
      const el = list();
      sortable = LSCSortable.attach(el, { item: '.clause', handle: '.clause-handle', onMove: move });
      cards().forEach(wire); // the cards drawn with the screen

      el.addEventListener('input', (event) => {
        const box = event.target;
        const part = box.dataset.subField;
        if (part === 'heading' || part === 'text') {
          const card = box.closest('.clause');
          const c = clauseOf(card);
          c.subs[indexOfSub(c, box.closest('.sub').dataset.sid)][part] = box.value;
          paintState();
          return;
        }
        const key = box.dataset.clField;
        if (key !== 'title' && key !== 'body') return;
        const node = box.closest('.clause');
        const c = form.clauses[indexOf(node.dataset.id)];
        c[key] = box.value;
        if (key === 'title') {
          const i = indexOf(c.id);
          node.querySelector('.clause-title').textContent = clauseName(c);
          node.querySelector('.clause-handle').setAttribute('aria-label', handleLabel(i, c));
          node.querySelector('.clause-more').setAttribute('aria-label', menuLabel(i, c));
        }
        paintState();
      });

      el.addEventListener('change', (event) => {
        const box = event.target;
        if (box.dataset.clField !== 'depositOnly') return;
        const node = box.closest('.clause');
        form.clauses[indexOf(node.dataset.id)].depositOnly = box.checked;
        node.querySelector('.clause-tag').hidden = !box.checked;
        paintState();
      });

      // The card's own buttons, and its ⋯ items, which menu.js clicks in place.
      el.addEventListener('click', (event) => {
        const subAct = event.target.closest('[data-sub-act]');
        const subAdd = event.target.closest('[data-sub-add]');
        if (subAct || subAdd) {
          const card = event.target.closest('.clause');
          if (subAdd) {
            addSub(card);
            return;
          }
          const c = clauseOf(card);
          const k = indexOfSub(c, subAct.closest('.sub').dataset.sid);
          const verb = subAct.dataset.subAct;
          if (verb === 'up') moveSub(card, k, k - 1);
          else if (verb === 'down') moveSub(card, k, k + 1);
          else if (verb === 'in') indentSub(card, k, 1);
          else if (verb === 'out') indentSub(card, k, 0);
          else if (verb === 'del') dropSub(card, k);
          return;
        }
        const toggle = event.target.closest('.clause-toggle');
        const act = event.target.closest('[data-cl-act]');
        const node = event.target.closest('.clause');
        if (!node || (!toggle && !act)) return;
        const id = node.dataset.id;
        if (toggle) {
          setOpen(id, !open.has(id));
          return;
        }
        const at = indexOf(id);
        const verb = act.dataset.clAct;
        if (verb === 'up') move(at, at - 1);
        else if (verb === 'down') move(at, at + 1);
        else if (verb === 'dup') duplicate(id);
        else if (verb === 'del') remove(id, node.querySelector('.clause-more'));
      });

      $('set-cl-add').addEventListener('click', add);
      // The panel head's ⋯, listened for where its closed list lives.
      const tools = root.querySelector('.set-cl-tools');
      tools.addEventListener('click', (event) => {
        if (event.target.closest('[data-cl-reset]')) resetDefaults(tools.querySelector('.menu-btn'));
      });
    }

    return {
      isOpen,
      setOpen,
      render,
      bind,
      // A fresh visit starts with every card closed (IA), and a drag in
      // progress on the screen being left is let go.
      reset() {
        open.clear();
        if (sortable) sortable.cancel();
        sortable = null;
        dropSubSortables();
      },
    };
  })();

  // ── A confirm dialog (a clause with text, before it's deleted) ─────────────

  const Confirm = (() => {
    let overlay = null;
    let opener = null;

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
        return;
      }
      LSCModal.trapTab(overlay, event);
    }
    function onBackdrop(event) {
      if (event.target === overlay) close(true);
    }

    function close(returnFocus) {
      if (!overlay || !overlay.classList.contains('open')) return;
      overlay.classList.remove('open');
      overlay.innerHTML = '';
      document.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onBackdrop);
      if (returnFocus && opener && opener.isConnected) opener.focus();
      opener = null;
    }

    /* opts: { title, body, confirm, run }. Confirming closes it, then runs
       run(), which puts focus where the result is. */
    function open(from, opts) {
      overlay = document.getElementById('modal-settings-confirm');
      close(false);
      opener = from || null;
      overlay.innerHTML =
        '<div class="modal-box set-confirm" role="dialog" aria-modal="true" aria-labelledby="set-cf-title" aria-describedby="set-cf-body">' +
        '<h2 class="modal-title" id="set-cf-title">' + esc(opts.title) + '</h2>' +
        '<p class="set-cf-body" id="set-cf-body">' + esc(opts.body) + '</p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-quiet" id="set-cf-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-danger" id="set-cf-ok">' + esc(opts.confirm) + '</button>' +
        '</div></div>';
      overlay.classList.add('open');
      document.addEventListener('keydown', onKeydown);
      overlay.addEventListener('click', onBackdrop);
      overlay.querySelector('#set-cf-cancel').addEventListener('click', () => close(true));
      overlay.querySelector('#set-cf-ok').addEventListener('click', () => {
        close(false);
        opts.run();
      });
      overlay.querySelector('#set-cf-cancel').focus();
    }

    return { open, close };
  })();

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
  /* The hourly rate: blank is cleared on purpose (null, and {hourly_rate}
     fills as blank); otherwise dollars, to the cent. undefined: unusable. */
  const rateOf = (raw) => {
    const v = String(raw).trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
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
    const homeText = form.homeBaseText.trim();
    if (homeText && !(form.homeBase && form.homeBase.address === homeText)) {
      found.push({ msg: 'Choose the home base from the address suggestions, so it has a place on the map.', field: $('set-home-base') });
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
    if (rateOf(form.hourlyRaw) === undefined) {
      found.push({ msg: 'The hourly rate for extra work must be a number of dollars, or left blank.', field: $('set-agr-rate') });
    }
    if (!urlOk(form.faqUrl)) {
      found.push({ msg: 'The FAQ link must be a web address starting https://, or left blank to hide the button.', field: $('set-faq') });
    }
    return found;
  }

  /* Merged onto `loaded`: the PUT replaces the whole row. Trimmed on the way
     out only; trimming as the user types eats the space between two words. */
  // Line breaks inside the agreement's text are its own; only the ends go.
  const ends = (v) => String(v).replace(/^\s+|\s+$/g, '');
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
        signer: form.businessSigner.trim(),
        // Only a picked place (problems() refuses typed text): blank removes it.
        homeBase: form.homeBaseText.trim() && form.homeBase ? form.homeBase : undefined,
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
      // The retired agreement.text rides along untouched in loaded.agreement.
      agreement: Object.assign({}, loaded.agreement, {
        intro: ends(form.intro),
        clauses: form.clauses.map((c) => ({
          id: c.id,
          title: c.title.trim(),
          body: ends(c.body),
          // A blank row prints nothing (agreementText skips it), so it isn't
          // kept; the first row left can't be indented.
          subs: c.subs.filter((x) => !isBlankSub(x))
            .map((x, k) => ({ id: x.id, heading: x.heading.trim(), text: ends(x.text), indent: k > 0 && x.indent === 1 ? 1 : 0 })),
          depositOnly: c.depositOnly === true,
        })),
        hourlyRate: rateOf(form.hourlyRaw),
        faqUrl: form.faqUrl.trim(),
      }),
    });
  }

  function setSaving(next) {
    saving = next;
    $('set-save').disabled = next;
    $('set-spin').style.display = next ? 'inline-block' : 'none';
    $('set-save-label').textContent = next ? 'Saving…' : 'Save settings';
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
      $('set-acct-label').textContent = next ? 'Updating…' : 'Update account';
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
    Confirm.close(false);
    Clauses.reset();
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
    lastText = null;
    bind();
    paintBiz();
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

    /* The agreement as the client's sign dialog and the PDF set it
       (documents.js agreementLayout, as c.js showAgreement draws it, minus the
       name/role slots). Text nodes only, and `before`/`tail` go in as text
       between the blocks, so out.textContent is the filled text exactly. */
    const AGREEMENT_TAG = { title: 'h3', head: 'h4', clause: 'h5', p: 'p', sub: 'p', signed: 'p' };
    function drawAgreement(box, text) {
      box.textContent = '';
      const layout = D.agreementLayout(text);
      const add = (into, s) => { if (s) into.appendChild(document.createTextNode(s)); };
      layout.items.forEach((it) => {
        add(box, it.before);
        const el = document.createElement(AGREEMENT_TAG[it.type] || 'p');
        el.className = 'ag-' + it.type + (it.level ? ' ag-l' + it.level : '');
        it.parts.forEach((p) => {
          if (p.role) {
            const span = document.createElement('span');
            span.className = 'ag-' + p.role;
            add(span, p.text);
            el.appendChild(span);
          } else {
            add(el, p.text);
          }
        });
        box.appendChild(el);
      });
      add(box, layout.tail);
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
      // What is on screen, saved or not (D39).
      const rate = rateOf(form.hourlyRaw);
      const docs = { intro: form.intro, clauses: form.clauses, hourlyRate: rate === undefined ? null : rate };
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
        business: Object.assign({}, loaded.business, {
          name: form.businessName, abn: abnDigits(form.abn), email: form.businessEmail, phone: form.businessPhone,
          signer: form.businessSigner,
        }),
        hourlyRate: docs.hourlyRate,
        today: LSCUtil.today(),
      });
      // The one render signing uses (ui-clarity task 4).
      const filled = D.agreementText(docs, values, { single: project.invoicing === 'single' });
      drawAgreement(out, filled.text);
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
        '<div id="set-pv-main"><p class="set-hint set-hint-lead">Loading projects…</p></div>');
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
