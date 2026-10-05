/**
 * The client's estimate and invoice pages (production-booking stage E,
 * D46, D50–D56). The client is never shown the word "estimate": to them it
 * is a quote (D103), on this page, its PDF and its emails.
 *
 * A separate page on the same Pages site: it loads none of the app's CSS or JS,
 * keeps nothing in localStorage and runs no analytics. The address is
 * `c/#e/<token>` for an estimate and `c/#i/<token>` for an invoice; the token
 * stays in the fragment so it never reaches a server log or a Referer header.
 *
 * It reads GET /public/estimates/:token (task 25's client view, with a live
 * state) from the API named in ../js/config.js, without credentials: the
 * client has no session and is never offered one. That GET is also what logs
 * "opened" for the owner (task 26), at most once a day per version.
 *
 * Accept opens the signing dialog (task 27, D40): the agreement the GET
 * carried while the estimate is open, a full name, a role and the "I agree"
 * tick. The agreement arrives as `parts`, the text with a gap wherever the
 * signatory's name or role goes (`slots` says which); the dialog fills them as
 * they're typed, and the server fills the same gaps the same way to store, so
 * what is signed is exactly what was on screen.
 */
(function () {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const STATUS_WORD = { confirmed: 'Confirmed', pencilled: 'Pencilled', proposed: 'Proposed' };
  const API = String(globalThis.LSC_API_BASE || '').replace(/\/+$/, '');

  const doc = document.getElementById('doc');
  const live = document.getElementById('c-status');

  /* Says something to a screen reader. Cleared first, so the same words
     twice are still read twice. */
  function say(text) {
    live.textContent = '';
    setTimeout(() => {
      live.textContent = text;
    }, 50);
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Dates arrive as 'YYYY-MM-DD' and are read as text, never through local
     Date getters, so a client in another timezone sees the same day. */
  function parts(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return { y, mo, d, wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
  }
  const longDate = (ymd) => {
    const p = parts(ymd);
    return p ? p.d + ' ' + MONTHS[p.mo - 1] + ' ' + p.y : '';
  };
  const dayDate = (ymd) => {
    const p = parts(ymd);
    return p ? WEEKDAYS[p.wd] + ' ' + p.d + ' ' + MONTHS[p.mo - 1] + ' ' + p.y : 'Date to be confirmed';
  };

  function clock12(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    if (!m) return '';
    const h = Number(m[1]);
    return (h % 12 || 12) + ':' + m[2] + (h < 12 ? 'am' : 'pm');
  }
  function dayTimes(day) {
    const a = clock12(day.startTime);
    const b = clock12(day.endTime);
    if (a && b) return a + ' to ' + b + (String(day.endTime) < String(day.startTime) ? ' the next day' : '');
    if (a) return 'From ' + a;
    if (b) return 'Until ' + b;
    return '';
  }

  /* "51 824 753 556", as the PDF prints an ABN; anything else as typed. */
  const abnText = (abn) => {
    const d = String(abn || '').replace(/\s+/g, '');
    return /^\d{11}$/.test(d) ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : String(abn || '');
  };

  const money = (n) => '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function gstNote(treatment, word) {
    if (treatment === 'taxable') return 'All prices are in AUD and include GST.';
    if (treatment === 'free') return 'All prices are in AUD. This ' + (word || 'quote') + ' is GST-free.';
    return 'All prices are in AUD. No GST is charged.';
  }

  // ── Pieces ────────────────────────────────────────────────────────────────

  function chip(status, unavailable) {
    if (unavailable) return '<span class="chip chip-gone">No longer available</span>';
    return '<span class="chip chip-' + esc(status) + '">' + esc(STATUS_WORD[status] || 'Proposed') + '</span>';
  }

  /* Letterhead, then who it's for and its dates, then the job and the note.
     The client is a business (B2B): no contact person's name is printed. */
  function masthead(e) {
    return '<header class="mast">' +
        '<p class="wordmark" aria-label="LSC Creative">LSC <span>Creative.</span></p>' +
        '<p class="kicker">Quote' + (e.version > 1 ? ', version ' + esc(e.version) : '') + '</p>' +
      '</header>' +
      '<dl class="meta">' +
        metaRow('For', e.client && e.client.businessName) +
        metaRow('Reference', e.upid) +
        metaRow('Issued', longDate(e.issuedOn)) +
        metaRow('Valid until', longDate(e.validUntil)) +
      '</dl>' +
      '<h1 class="title">' + esc(e.name) + '</h1>' +
      (e.state === 'open'
        ? '<p class="lede">Here’s your quote. If it looks right, press the Accept quote button below.</p>'
        : '');
  }

  function metaRow(term, value) {
    if (!value) return '';
    return '<div><dt>' + esc(term) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function sectionHead(id, text) {
    return '<h2 class="sec" id="' + id + '">' + esc(text) + '</h2>';
  }

  /* "16:9", "9x16", "4 × 5" → a CSS aspect ratio for the tile's frame. Any
     other format ("Photo set") gets a square. */
  function ratioOf(format) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(format || ''));
    return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? m[1] + ' / ' + m[2] : '1 / 1';
  }

  /* Each deliverable is its own tile, drawn in its own frame shape, so the
     client can find what they're getting at a glance. A quantity over one
     stacks the frame (up to three deep). */
  function deliverables(e) {
    const rows = (e.deliverables || []).filter((d) => d && d.name);
    if (!rows.length) return '';
    return '<section class="block" aria-labelledby="h-deliv">' + sectionHead('h-deliv', 'Deliverables') +
      '<ul class="deliv">' + rows.map((d) => {
        const qty = Math.max(1, Math.round(Number(d.qty) || 1));
        return '<li class="deliv-item">' +
          '<span class="deliv-frame deliv-stack-' + Math.min(qty, 3) + '" style="aspect-ratio:' + ratioOf(d.format) + '" aria-hidden="true"></span>' +
          '<h3 class="deliv-name">' + esc(d.name) + '</h3>' +
          '<dl class="deliv-spec">' +
            (d.format ? '<div><dt>Format</dt><dd>' + esc(d.format) + '</dd></div>' : '') +
            (d.duration ? '<div><dt>Length</dt><dd>' + esc(d.duration) + '</dd></div>' : '') +
            '<div><dt>Quantity</dt><dd>' + qty + '</dd></div>' +
          '</dl></li>';
      }).join('') + '</ul></section>';
  }

  function days(e, heading) {
    const list = e.days || [];
    if (!list.length) return '';
    const anyProposed = list.some((d) => d.status === 'proposed');
    return '<section class="block" aria-labelledby="h-days">' + sectionHead('h-days', heading || 'Production days') +
      list.map((d, i) => {
        const id = 'day-' + i;
        const times = dayTimes(d);
        const items = d.items || [];
        const p = parts(d.date);
        return '<section class="day' + (d.unavailable ? ' is-gone' : '') + '" aria-labelledby="' + id + '">' +
          // The gutter is the date drawn large; the heading says it in full.
          '<div class="day-when" aria-hidden="true">' +
            (p
              ? '<span class="day-num">' + p.d + '</span><span class="day-wd">' + WEEKDAYS[p.wd].slice(0, 3) +
                '</span><span class="day-mo">' + MONTHS[p.mo - 1].slice(0, 3) + '</span>'
              : '<span class="day-num day-tbc">TBC</span>') +
          '</div>' +
          '<div class="day-body">' +
          '<div class="day-head">' +
            '<h3 class="day-date" id="' + id + '">' + esc(dayDate(d.date)) + '</h3>' +
            chip(d.status, d.unavailable) +
          '</div>' +
          (times ? '<p class="day-times">' + esc(times) + '</p>' : '') +
          (items.length
            ? '<table class="lines"><caption class="visually-hidden">Items on ' + esc(dayDate(d.date)) + '</caption>' +
              '<thead class="visually-hidden"><tr><th scope="col">Item</th><th scope="col">Price</th></tr></thead><tbody>' +
              items.map((it) =>
                '<tr><th scope="row"><span class="line-name">' + esc(it.name) + '</span>' +
                (it.qty ? '<span class="line-qty">' + esc(it.qty) + '</span>' : '') + '</th>' +
                '<td class="fig">' + money(it.price) + '</td></tr>').join('') +
              '</tbody></table>'
            : '') +
        '</div></section>';
      }).join('') +
      (anyProposed && e.disclaimer ? '<p class="note">' + esc(e.disclaimer) + '</p>' : '') +
    '</section>';
  }

  function included(e) {
    const secs = (e.sections || []).filter((s) => s && s.items && s.items.length);
    if (!secs.length) return '';
    return '<section class="block" aria-labelledby="h-incl">' + sectionHead('h-incl', 'Also included') +
      '<div class="incl">' + secs.map((s) =>
        '<div class="incl-group"><h3 class="incl-label">' + esc(s.label) + '</h3>' +
        '<ul>' + s.items.map((it) => '<li>' + esc(it.name) +
          (it.tag ? '<span class="incl-tag"> · ' + esc(it.tag) + '</span>' : '') + '</li>').join('') + '</ul></div>').join('') +
      '</div></section>';
  }

  function investment(e) {
    const t = e.totals || {};
    const taxed = t.treatment === 'taxable' && t.gst > 0;
    return '<section class="block" aria-labelledby="h-total">' + sectionHead('h-total', 'Production total') +
      (taxed
        ? '<dl class="sums"><div><dt>Subtotal</dt><dd class="fig">' + money(t.exGst) + '</dd></div>' +
          '<div><dt>GST</dt><dd class="fig">' + money(t.gst) + '</dd></div></dl>'
        : '') +
      '<p class="total"><span class="total-label">Total</span><span class="total-fig">' + money(t.total) + '</span></p>' +
      '<p class="fine">' + esc(gstNote(t.treatment)) +
        (e.validUntil ? ' Valid until ' + esc(longDate(e.validUntil)) + '.' : '') + '</p>' +
    '</section>';
  }

  /* The accept panel, or the notice that replaces it (brief, Key Interactions 6). */
  function action(e) {
    const contact = e.business && e.business.email
      ? '<a href="mailto:' + esc(e.business.email) + '">' + esc(e.business.email) + '</a>'
      : 'us';
    switch (e.state) {
      case 'open':
        return '<section class="panel" aria-labelledby="h-accept">' +
          '<h2 class="panel-title" id="h-accept">Ready to go ahead?</h2>' +
          '<p>Accepting opens our service agreement. Read it through, add your name and role, and sign. ' +
          'It takes a couple of minutes.</p>' +
          '<button type="button" class="btn btn-primary" data-act="accept" id="accept-main">Accept quote</button>' +
          (e.faqUrl ? '<p class="panel-aside"><a href="' + esc(e.faqUrl) + '" target="_blank" rel="noopener">Questions about the agreement? Read our FAQ<span class="visually-hidden"> (opens in a new tab)</span></a></p>' : '') +
        '</section>';
      case 'taken':
        return notice('Some proposed dates are no longer available',
          'Another booking has taken one of the proposed dates, marked above. We’ll send you an updated quote with new dates.');
      case 'expired':
        return notice('This quote has expired',
          'It was valid until ' + esc(longDate(e.validUntil)) + '. Contact ' + contact + ' and we’ll send you an updated one.');
      case 'superseded':
        // No newer link means nothing newer has gone out yet: the project was
        // reopened, or is being reworked, and this version is off the table.
        return e.latestToken
          ? notice('This quote has been updated',
            'We’ve sent a newer version. <a href="#e/' + esc(e.latestToken) + '">See the latest quote</a>.')
          : notice('We’re revising this quote',
            'It’s no longer open to accept. We’ll send you the updated version when it’s ready. In the meantime, contact ' + contact + ' with any questions.');
      case 'declined':
        return notice('This quote was declined',
          'If that’s changed, contact ' + contact + ' and we’ll put together a new one.');
      case 'accepted':
        // An estimate accepted in the app was never signed here: no agreement
        // to offer until signing (task 27) says there is one.
        return notice('Thank you',
          'We’ll be in touch to confirm the details.',
          e.signed
            ? '<button type="button" class="btn btn-quiet" data-act="agreement">Download signed agreement</button>' +
              '<p class="panel-msg" id="ag-msg" role="status"></p>'
            : '', 'done');
      default:
        return '';
    }
  }

  function notice(title, body, extra, tone) {
    return '<section class="panel panel-notice' + (tone ? ' panel-' + tone : '') + '" role="region" aria-labelledby="h-notice">' +
      '<h2 class="panel-title" id="h-notice">' + esc(title) + '</h2>' +
      '<p>' + body + '</p>' + (extra || '') + '</section>';
  }

  function footer(e) {
    const b = e.business || {};
    const tel = String(b.phone || '').replace(/[^\d+]/g, '');
    return '<footer class="foot">' +
      '<p class="foot-ask">Questions, or want to talk something through? We’re happy to.</p>' +
      '<p class="foot-who"><span class="foot-name">' + esc(b.contactName || b.name) + '</span>' +
        (b.email ? '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' : '') +
        (b.phone ? '<a href="tel:' + esc(tel) + '">' + esc(b.phone) + '</a>' : '') +
      '</p>' +
      '<button type="button" class="btn btn-quiet" data-act="pdf">Download PDF</button>' +
      '<p class="foot-msg" id="pdf-msg" role="status"></p>' +
      '<p class="foot-legal">' + [b.name, b.abn ? 'ABN ' + abnText(b.abn) : ''].filter(Boolean).map((x) => '<span>' + esc(x) + '</span>').join('') + '</p>' +
    '</footer>';
  }

  let current = null; // the estimate on screen

  /* On a phone the Accept panel is a long scroll away, so while it's still
     below the screen a bar pinned to the bottom carries the total and the
     same button. It steps aside once the panel itself is in view (or has been
     passed), so there's never two on screen. Hidden from 768px by the CSS. */
  function dock(e) {
    if (e.state !== 'open') return '';
    const t = e.totals || {};
    return '<div class="dock" id="dock" inert>' +
        '<p class="dock-total"><span class="dock-label">Total</span><span class="dock-fig">' + money(t.total) + '</span></p>' +
        '<button type="button" class="btn btn-primary dock-btn" data-act="accept">Accept quote</button>' +
      '</div>';
  }

  let dockWatch = null;
  function watchDock() {
    if (dockWatch) { dockWatch.disconnect(); dockWatch = null; }
    document.body.classList.remove('has-dock');
    const bar = document.getElementById('dock');
    const target = document.getElementById('accept-main');
    if (!bar || !target || !('IntersectionObserver' in window)) return;
    document.body.classList.add('has-dock');
    dockWatch = new IntersectionObserver(([entry]) => {
      const below = !entry.isIntersecting && entry.boundingClientRect.top > 0;
      bar.classList.toggle('is-shown', below);
      bar.inert = !below;
      // Focus never stays on a bar that's leaving.
      if (!below && bar.contains(document.activeElement) && !(dlg && dlg.open)) target.focus({ preventScroll: true });
    });
    dockWatch.observe(target);
  }

  function render(e) {
    current = e;
    doc.innerHTML = masthead(e) + deliverables(e) + days(e) + included(e) + investment(e) + action(e) + footer(e) + dock(e);
    doc.removeAttribute('aria-busy');
    document.title = (e.name ? e.name + ' — ' : '') + 'Quote — LSC Creative';
    watchDock();
  }

  // ── The invoice (task 30, D35–D37, D46) ───────────────────────────────────

  const KIND_WORD = { deposit: 'deposit invoice', final: 'final invoice', single: 'invoice' };
  const DUE_LABEL = { deposit: 'Deposit due', final: 'Balance due', single: 'Total due' };
  const PAID_LABEL = { deposit: 'Deposit paid', final: 'Balance paid', single: 'Total paid' };

  /* What the invoice is and where it stands, in one or two plain sentences. */
  function invoiceLede(v) {
    if (v.state === 'void') return '';
    const what = v.invoiceKind === 'deposit'
      ? 'Here’s the deposit invoice to secure your booking'
      : 'Here’s the ' + (v.invoiceKind === 'final' ? 'final invoice' : 'invoice') + ' for the job';
    const amount = money(v.amountDue);
    let then = '';
    if (v.state === 'paid') then = 'It was paid' + (v.paidOn ? ' on ' + longDate(v.paidOn) : '') + '. Thank you.';
    else if (v.state === 'overdue') then = 'Payment of ' + amount + ' was due on ' + dayDate(v.dueOn) + '. If you’ve already paid, thank you.';
    else if (v.dueOn) then = 'Please pay ' + amount + ' by ' + dayDate(v.dueOn) + '.';
    else then = 'The amount due is ' + amount + '.';
    return '<p class="lede">' + esc(what + '. ' + then) + '</p>';
  }

  function invoiceHead(v) {
    const c = v.client || {};
    return '<header class="mast">' +
        '<p class="wordmark" aria-label="LSC Creative">LSC <span>Creative.</span></p>' +
        '<p class="kicker">' + (v.taxInvoice ? 'Tax invoice' : 'Invoice') + '</p>' +
      '</header>' +
      '<dl class="meta">' +
        (c.businessName
          ? '<div><dt>For</dt><dd>' + esc(c.businessName) +
            (c.abn ? '<span class="meta-sub">ABN ' + esc(abnText(c.abn)) + '</span>' : '') + '</dd></div>'
          : '') +
        metaRow('Invoice number', v.number) +
        metaRow('Issued', longDate(v.issuedOn)) +
        (v.state === 'paid' ? metaRow('Paid', longDate(v.paidOn)) : metaRow('Due', longDate(v.dueOn))) +
      '</dl>' +
      '<h1 class="title">' + esc(v.name || 'Invoice') + '</h1>' +
      invoiceLede(v);
  }

  /* A void invoice stays readable as a record, with the notice first (D100). */
  function voidNotice(v) {
    if (v.state !== 'void') return '';
    const x = v.void || {};
    const r = x.replacement;
    const contact = v.business && v.business.email
      ? '<a href="mailto:' + esc(v.business.email) + '">' + esc(v.business.email) + '</a>'
      : 'us';
    const next = r && r.token
      ? ' <a href="#i/' + esc(r.token) + '">See the replacement invoice' + (r.number ? ', ' + esc(r.number) : '') + '</a>.'
      : r && r.number
        ? ' We’ll send you its replacement, ' + esc(r.number) + '.'
        : ' Contact ' + contact + ' with any questions.';
    return notice('This invoice was voided',
      (x.on ? 'It was voided on ' + esc(longDate(x.on)) + (x.reason ? ': ' + esc(x.reason) : '') + '. ' : '') +
      'Nothing is owed on it.' + next);
  }

  /* A deposit is a summary (D37): what it's a share of, then the days it secures. */
  function depositSummary(v) {
    const d = v.deposit || {};
    return '<section class="block" aria-labelledby="h-dep">' + sectionHead('h-dep', 'Deposit') +
      '<p class="block-text">' + esc((Math.round((Number(d.pct) || 0) * 100) / 100) + '% of the quote total of ' +
        money(d.estimateTotal) + ', to secure your booking.') + '</p>' +
    '</section>';
  }

  function extras(v) {
    const list = v.extras || [];
    if (!list.length) return '';
    return '<section class="block" aria-labelledby="h-extras">' + sectionHead('h-extras', 'Extras') +
      '<table class="lines"><caption class="visually-hidden">Extras</caption>' +
      '<thead class="visually-hidden"><tr><th scope="col">Item</th><th scope="col">Price</th></tr></thead><tbody>' +
      list.map((it) =>
        '<tr><th scope="row"><span class="line-name">' + esc(it.name) + '</span>' +
        (it.qty ? '<span class="line-qty">' + esc(it.qty) + '</span>' : '') + '</th>' +
        '<td class="fig">' + money(it.price) + '</td></tr>').join('') +
      '</tbody></table></section>';
  }

  /* The sum, as the PDF's totals box: the estimate, the extras and the
     deposit taken off (a final or single), then GST, then the bar. */
  function invoiceTotal(v) {
    const t = v.totals || {};
    const due = t.due || {};
    const taxed = t.treatment === 'taxable' && due.gst > 0;
    const inc = t.treatment === 'taxable' ? ' <span class="sums-q">inc. GST</span>' : '';
    const row = (label, value, cls) => '<div' + (cls ? ' class="' + cls + '"' : '') + '><dt>' + label + '</dt><dd class="fig">' + value + '</dd></div>';
    const rows = [];
    if (v.invoiceKind !== 'deposit' && (t.extras > 0 || t.lessDeposit)) {
      rows.push(row('Quote total' + inc, money(t.estimateTotal)));
      if (t.extras > 0) {
        rows.push(row('Extras' + inc, money(t.extras)));
        rows.push(row('Total' + inc, money(t.total), 'sums-strong'));
      }
      if (t.lessDeposit) {
        const l = t.lessDeposit;
        rows.push(row((l.paid ? 'Less deposit paid' : 'Less deposit invoiced') + (l.number ? ' (' + esc(l.number) + ')' : ''),
          '−' + money(l.amount)));
      }
    }
    if (taxed) {
      rows.push(row('Subtotal (ex GST)', money(due.exGst)));
      rows.push(row('GST', money(due.gst)));
    }
    return '<section class="block" aria-labelledby="h-total">' +
      sectionHead('h-total', v.invoiceKind !== 'deposit' ? 'Invoice total' : v.state === 'paid' ? 'Amount paid' : 'Amount due') +
      (rows.length ? '<dl class="sums">' + rows.join('') + '</dl>' : '') +
      '<p class="total' + (v.state === 'void' ? ' is-void' : '') + '"><span class="total-label">' +
        esc(v.state === 'void' ? 'Total (void)' : (v.state === 'paid' ? PAID_LABEL : DUE_LABEL)[v.invoiceKind] || 'Total due') + '</span>' +
        '<span class="total-fig">' + money(due.total) + '</span></p>' +
      '<p class="fine">' + esc(gstNote(t.treatment, 'invoice')) + '</p>' +
    '</section>';
  }

  /* The payment slip: the bank details to type into a banking app, each one
     copyable, behind a tear-off rule as on a paper invoice. Only while
     there's something to pay (the server sends `payment` only then). */
  function slip(v) {
    const p = v.payment;
    if (!p) return '';
    const amount = money(v.amountDue);
    const rows = [
      ['Bank', p.bankName, ''],
      ['Account name', p.accountName, p.accountName],
      ['BSB', p.bsb, p.bsb],
      ['Account number', p.accountNumber, p.accountNumber],
      ['Reference', v.number, v.number],
      ['Amount', amount, (Number(v.amountDue) || 0).toFixed(2)],
    ].filter((r) => r[1]);
    const contact = v.business && v.business.email
      ? '<a href="mailto:' + esc(v.business.email) + '">' + esc(v.business.email) + '</a>'
      : 'us';
    const banked = p.accountName || p.bsb || p.accountNumber;
    return '<hr class="perf">' +
      '<section class="slip" aria-labelledby="h-pay">' +
        '<h2 class="slip-title" id="h-pay">How to pay</h2>' +
        (banked
          ? '<p class="slip-how">' + esc('Transfer ' + amount + (v.dueOn && v.state !== 'overdue' ? ' by ' + longDate(v.dueOn) : '') +
              ', with ' + (v.number || 'the invoice number') + ' as the reference.') + '</p>' +
            '<dl class="slip-rows">' + rows.map(([label, shown, copy]) =>
              '<div class="slip-row"><dt>' + esc(label) + '</dt>' +
              '<dd><span class="slip-val">' + esc(shown) + '</span>' +
              (copy
                ? '<button type="button" class="copy" data-copy="' + esc(copy) + '" data-label="' + esc(label) + '">Copy<span class="visually-hidden"> ' +
                  esc(label === 'BSB' ? label : label.toLowerCase()) + '</span></button>'
                : '') + '</dd></div>'
            ).join('') + '</dl>'
          : '<p class="slip-how">Contact ' + contact + ' for our bank details.</p>') +
        (p.terms ? '<p class="slip-terms">' + esc(p.terms) + '</p>' : '') +
      '</section>';
  }

  function renderInvoice(v) {
    current = v;
    const bill = v.invoiceKind !== 'deposit';
    doc.innerHTML = invoiceHead(v) + voidNotice(v) +
      (bill
        ? deliverables(v) + days(v) + included(v) + extras(v)
        : depositSummary(v) + days(v, 'Production days booked')) +
      invoiceTotal(v) + slip(v) + footer(v);
    doc.removeAttribute('aria-busy');
    document.title = (v.number ? v.number + ' — ' : '') + (v.taxInvoice ? 'Tax invoice' : 'Invoice') + ' — LSC Creative';
    watchDock();
  }

  /* A page with no estimate on it: a bad link, or the server out of reach. */
  function renderNotice(title, body, retry) {
    doc.innerHTML = '<header class="mast"><p class="wordmark" aria-label="LSC Creative">LSC <span>Creative.</span></p></header>' +
      '<h1 class="title">' + esc(title) + '</h1>' +
      '<p class="lede">' + esc(body) + '</p>' +
      (retry ? '<button type="button" class="btn btn-quiet lede-btn" data-act="retry">Try again</button>' : '');
    doc.removeAttribute('aria-busy');
    document.title = title + ' — LSC Creative';
    watchDock();
  }

  const renderMissing = () => renderNotice('We couldn’t find this ' + WORD[kind],
    'The link may be incomplete. Check it against the email we sent, or ask us for a new one.');

  // ── Loading ───────────────────────────────────────────────────────────────

  /* `e` an estimate, `i` an invoice: which page, which route. */
  const WORD = { e: 'quote', i: 'invoice' };
  const ROUTE = { e: '/public/estimates/', i: '/public/invoices/' };

  /* The owner looking at their own link (task 33 C15): the app, on this same
     origin, marks the browser it's signed in on, and the server then doesn't
     log the look as "client opened". */
  function ownerBrowser() {
    try {
      return localStorage.getItem('lsc-owner-browser') === '1';
    } catch (_) {
      return false;
    }
  }
  let kind = 'e';
  let token = '';
  let ticket = 0;

  function linkOf(hash) {
    const m = /^#([ei])\/([A-Za-z0-9_-]+)$/.exec(hash);
    return m ? { kind: m[1], token: m[2] } : { kind: /^#i\//.test(hash) ? 'i' : 'e', token: '' };
  }

  async function load() {
    const mine = ++ticket;
    ({ kind, token } = linkOf(location.hash));
    document.querySelector('.skip').textContent = 'Skip to the ' + WORD[kind];
    if (!token || !API) return renderMissing();
    if (!doc.querySelector('.loading')) doc.innerHTML = '<p class="loading">Loading…</p>';
    doc.querySelector('.loading').textContent = 'Loading your ' + WORD[kind] + '…';
    doc.setAttribute('aria-busy', 'true');
    let res;
    let body = null;
    try {
      res = await fetch(API + ROUTE[kind] + encodeURIComponent(token) + (ownerBrowser() ? '?owner=1' : ''), {
        credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' },
      });
      body = await res.json().catch(() => null);
    } catch (_err) {
      res = null;
    }
    if (mine !== ticket) return undefined;  // the address changed while this was on its way
    if (res && res.ok && body && kind === 'e' && body.estimate) {
      render(body.estimate);
      return undefined;
    }
    if (res && res.ok && body && kind === 'i' && body.invoice) {
      renderInvoice(body.invoice);
      return undefined;
    }
    if (res && res.status === 404) return renderMissing();
    if (res && res.status === 429) {
      return renderNotice('Please wait a moment',
        'This page has been opened a lot in the last few minutes. Wait a minute, then try again.', true);
    }
    return renderNotice('We couldn’t load your ' + WORD[kind],
      res ? 'Something went wrong on our side. Try again in a moment.' : 'Check your connection, then try again.', true);
  }

  // ── The PDF ───────────────────────────────────────────────────────────────

  function filenameOf(disposition, fallback) {
    const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition || '');
    if (star) {
      try {
        return decodeURIComponent(star[1]);
      } catch (_err) { /* fall through to the plain name */ }
    }
    const plain = /filename="?([^";]+)"?/i.exec(disposition || '');
    return plain ? plain[1] : fallback;
  }

  /* The estimate's or invoice's PDF (`/pdf`, status in #pdf-msg) or, once
     signed, the signed agreement (`/agreement`, status in #ag-msg). */
  async function downloadPdf(btn, what) {
    const agreement = what === 'agreement';
    const msg = document.getElementById(agreement ? 'ag-msg' : 'pdf-msg');
    const show = (text) => {
      if (msg) msg.textContent = text;
    };
    const label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Preparing PDF…';
    show('');
    try {
      const res = await fetch(API + ROUTE[kind] + encodeURIComponent(token) + (agreement ? '/agreement' : '/pdf'),
        { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) throw res.status;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameOf(res.headers.get('Content-Disposition'), agreement ? 'Service Agreement.pdf' : kind === 'i' ? 'Invoice.pdf' : 'Quote.pdf');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      show('Your PDF has downloaded.');
    } catch (status) {
      show(status === 429
        ? 'That’s a lot of downloads in a short time. Try again in a few minutes.'
        : status === 404
          ? (agreement ? 'We couldn’t find the signed agreement. Ask us for a copy.' : 'This ' + WORD[kind] + ' is no longer available. Ask us for a copy.')
          : typeof status === 'number'
            ? 'We couldn’t make the PDF just now. Try again shortly, or ask us for a copy.'
            : 'Check your connection, then try again.');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = label;
    }
  }

  // ── Signing (task 27) ─────────────────────────────────────────────────────

  /* One dialog for the page's life, so a client who closes it to look
     something up finds what they typed when they come back. Native <dialog>:
     showModal makes the page behind it inert, holds focus inside, and closes
     on Escape. */
  let dlg = null;
  let agreement = null; // { parts, slots, key } as last given by the server
  let signing = false;
  let opener = null;

  const field = (id) => dlg.querySelector('#' + id);
  const cleanRole = () => field('sg-role').value.replace(/\s+/g, ' ').trim();

  function buildDialog() {
    dlg = document.createElement('dialog');
    dlg.className = 'sign';
    dlg.setAttribute('aria-labelledby', 'sg-title');
    dlg.setAttribute('aria-describedby', 'sg-intro');
    dlg.innerHTML =
      '<form class="sign-form" id="sg-form" novalidate>' +
        '<div class="sign-head">' +
          '<h2 class="sign-title" id="sg-title">Sign the service agreement</h2>' +
          '<button type="button" class="sign-close" data-sign="close" aria-label="Close">' +
            '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>' +
          '</button>' +
        '</div>' +
        '<p class="sign-intro" id="sg-intro">Read it through, then sign with your full name and role.</p>' +
        '<div class="sign-text" id="sg-text" tabindex="0" role="region" aria-label="Service agreement"></div>' +
        '<p class="sign-faq" id="sg-faq"></p>' +
        '<div class="sign-fields">' +
          '<div class="sign-field"><label for="sg-name">Full name</label>' +
            '<input id="sg-name" name="fullName" type="text" autocomplete="name" maxlength="100" required></div>' +
          '<div class="sign-field"><label for="sg-role">Role</label>' +
            '<input id="sg-role" name="role" type="text" autocomplete="organization-title" maxlength="100" required></div>' +
        '</div>' +
        '<label class="sign-agree"><input id="sg-agree" type="checkbox"> <span>I agree to the service agreement</span></label>' +
        '<p class="sign-msg" id="sg-msg" role="alert"></p>' +
        '<button type="submit" class="btn btn-primary" id="sg-submit" aria-describedby="sg-hint" disabled>Sign &amp; submit</button>' +
        '<p class="sign-hint" id="sg-hint"></p>' +
      '</form>';
    document.body.appendChild(dlg);

    field('sg-form').addEventListener('input', () => {
      if (field('sg-msg').dataset.kind === 'input') showMsg('');
      fillSlots();
      readiness();
    });
    field('sg-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      submit();
    });
    dlg.querySelector('[data-sign="close"]').addEventListener('click', () => closeSigning());
    // Escape: not while a signature is on its way.
    dlg.addEventListener('cancel', (ev) => {
      if (signing) ev.preventDefault();
    });
    dlg.addEventListener('close', () => {
      document.documentElement.classList.remove('is-signing');
      if (opener && opener.isConnected) opener.focus();
    });
  }

  /* The agreement, with the typed name and role (or a marked gap until there
     is one) in each place they go. Text nodes throughout: nothing in it is markup. */
  function showAgreement() {
    const box = field('sg-text');
    box.textContent = '';
    agreement.parts.forEach((part, i) => {
      box.appendChild(document.createTextNode(part));
      if (i < agreement.parts.length - 1) {
        const slot = document.createElement('span');
        slot.className = 'sign-slot';
        slot.dataset.slot = agreement.slots[i];
        box.appendChild(slot);
      }
    });
    fillSlots();
  }

  function fillSlots() {
    const typed = { name: field('sg-name').value.replace(/\s+/g, ' ').trim(), role: cleanRole() };
    dlg.querySelectorAll('.sign-slot').forEach((slot) => {
      const kind = slot.dataset.slot === 'name' ? 'name' : 'role';
      slot.textContent = typed[kind] || (kind === 'name' ? 'your name' : 'your role');
      slot.classList.toggle('is-empty', !typed[kind]);
    });
  }

  function ready() {
    return Boolean(field('sg-name').value.trim() && cleanRole() && field('sg-agree').checked);
  }

  /* Sign & submit stays disabled until all three are done (D40); the line
     under it says what's still missing, so a disabled button is never a
     mystery. */
  function readiness() {
    const missing = [];
    if (!field('sg-name').value.trim()) missing.push('your full name');
    if (!cleanRole()) missing.push('your role');
    if (!field('sg-agree').checked) missing.push('the “I agree” tick');
    field('sg-submit').disabled = signing || missing.length > 0;
    field('sg-hint').textContent = signing ? '' : missing.length
      ? 'Still needed: ' + missing.slice(0, -1).join(', ') + (missing.length > 1 ? ' and ' : '') + missing[missing.length - 1] + '.'
      : 'Signing accepts the quote and confirms its dates.';
  }

  function showMsg(text, kind) {
    const msg = field('sg-msg');
    msg.textContent = text;
    msg.dataset.kind = kind || '';
  }

  function openSigning(btn) {
    if (!current || current.state !== 'open' || !current.agreement) {
      say('This quote can’t be accepted just now. Reload the page to see why.');
      return;
    }
    if (!dlg) buildDialog();
    opener = btn;
    // A newer agreement than the one in the dialog (the page was reloaded,
    // or a newer version opened): show it from the top.
    if (!agreement || agreement.key !== current.agreement.key) {
      agreement = current.agreement;
      showAgreement();
      field('sg-agree').checked = false;
      field('sg-text').scrollTop = 0;
      showMsg('');
    }
    const faq = field('sg-faq');
    faq.innerHTML = current.faqUrl
      ? '<a href="' + esc(current.faqUrl) + '" target="_blank" rel="noopener">Service agreement FAQ<span class="visually-hidden"> (opens in a new tab)</span></a>'
      : '';
    readiness();
    document.documentElement.classList.add('is-signing');
    dlg.showModal();
    // The agreement first: it's what to read.
    field('sg-text').focus();
  }

  function closeSigning() {
    if (signing || !dlg || !dlg.open) return;
    dlg.close();
  }

  async function submit() {
    if (signing || !ready()) return readiness();
    signing = true;
    const btn = field('sg-submit');
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Signing…';
    showMsg('');
    readiness();
    let res = null;
    let body = null;
    try {
      res = await fetch(API + '/public/estimates/' + encodeURIComponent(token) + '/accept', {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          fullName: field('sg-name').value,
          role: field('sg-role').value,
          agree: field('sg-agree').checked,
          version: current.version,
          key: agreement.key,
        }),
      });
      body = await res.json().catch(() => null);
    } catch (_err) {
      res = null;
    }
    signing = false;
    btn.removeAttribute('aria-busy');
    btn.innerHTML = 'Sign &amp; submit';
    readiness();

    if (res && res.ok && body && body.estimate) {
      // Signed: the page becomes the thank-you, read from the server's reply.
      opener = null;
      dlg.close();
      render(body.estimate);
      const thanks = doc.querySelector('#h-notice');
      if (thanks) {
        thanks.setAttribute('tabindex', '-1');
        thanks.scrollIntoView({ block: 'center' });
        thanks.focus({ preventScroll: true });
      }
      say('Signed. Thank you, we’ll be in touch to confirm the details.');
      return undefined;
    }
    const code = body && body.error;
    if (res && res.status === 409 && code === 'agreement_changed' && body.agreement) {
      // The text changed while it was being read: the new one, from the top,
      // and the tick asked for again.
      agreement = body.agreement;
      showAgreement();
      field('sg-agree').checked = false;
      field('sg-text').scrollTop = 0;
      readiness();
      showMsg(body.message || 'The agreement has just been updated. Read it through again before you sign.');
      field('sg-text').focus();
      return undefined;
    }
    if (res && (res.status === 409 || res.status === 404)) {
      // Something about the estimate changed (a newer version, a date taken,
      // it expired): the page shows where it now stands.
      opener = null;
      dlg.close();
      await load();
      doc.focus({ preventScroll: true });
      say(code === 'version_changed'
        ? 'We’ve just sent a newer version of this quote. Look it over before you sign.'
        : 'This quote changed while you were signing, so it wasn’t signed. The page now shows where it stands.');
      return undefined;
    }
    if (res && res.status === 400) {
      showMsg((body && body.message) || 'Check your name, role and the tick, then try again.', 'input');
    } else if (res && res.status === 429) {
      showMsg('That’s a lot of attempts in a short time. Wait a few minutes, then try again.');
    } else {
      showMsg(res
        ? 'Something went wrong on our side, and it wasn’t signed. Try again in a moment.'
        : 'We couldn’t reach our server, so it wasn’t signed. Check your connection, then try again.');
    }
    btn.focus();
    return undefined;
  }

  // ── Copying a bank detail (the payment slip) ──────────────────────────────

  /* Selects the value on screen, so it can be copied by hand when the
     clipboard is refused. */
  function selectValue(btn) {
    const val = btn.parentNode.querySelector('.slip-val');
    const range = document.createRange();
    range.selectNodeContents(val);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function copyDetail(btn) {
    const text = btn.dataset.copy;
    const label = btn.dataset.label;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_err) {
      ok = false;
    }
    if (!ok) {
      selectValue(btn);
      say(label + ' selected. Copy it from your device’s menu.');
      return;
    }
    // The button says so for a moment; a screen reader hears it once.
    doc.querySelectorAll('.copy.is-copied').forEach((b) => {
      b.classList.remove('is-copied');
      b.firstChild.textContent = 'Copy';
    });
    btn.classList.add('is-copied');
    btn.firstChild.textContent = 'Copied';
    say(label + ' copied.');
    clearTimeout(btn._reset);
    btn._reset = setTimeout(() => {
      btn.classList.remove('is-copied');
      btn.firstChild.textContent = 'Copy';
    }, 2000);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  doc.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'pdf') return void downloadPdf(btn, 'pdf');
    if (act === 'agreement') return void downloadPdf(btn, 'agreement');
    if (act === 'retry') return void load();
    if (act === 'accept') return void openSigning(btn);
    return undefined;
  });
  doc.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button.copy');
    if (btn) copyDetail(btn);
  });

  window.addEventListener('hashchange', () => {
    // A link to the newer version (or a void invoice's replacement): start
    // at the top of it, with a screen reader's focus there too.
    window.scrollTo(0, 0);
    load().then(() => doc.focus({ preventScroll: true }));
  });
  load();
}());
