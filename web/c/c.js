/**
 * The client's estimate page (production-booking stage E, D50–D56).
 *
 * A separate page on the same Pages site: it loads none of the app's CSS or JS,
 * keeps nothing in localStorage and runs no analytics. The address is
 * `c/#e/<token>`; the token stays in the fragment so it never reaches a server
 * log or a Referer header.
 *
 * It reads GET /public/estimates/:token (task 25's client view, with a live
 * state) from the API named in ../js/config.js, without credentials: the
 * client has no session and is never offered one. That GET is also what logs
 * "opened" for the owner (task 26), at most once a day per version.
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

  const money = (n) => '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function gstNote(treatment) {
    if (treatment === 'taxable') return 'All prices are in AUD and include GST.';
    if (treatment === 'free') return 'All prices are in AUD. This estimate is GST-free.';
    return 'All prices are in AUD. No GST is charged.';
  }

  // ── Pieces ────────────────────────────────────────────────────────────────

  function chip(status, unavailable) {
    if (unavailable) return '<span class="chip chip-gone">No longer available</span>';
    return '<span class="chip chip-' + esc(status) + '">' + esc(STATUS_WORD[status] || 'Proposed') + '</span>';
  }

  function masthead(e) {
    const first = String((e.client && e.client.contactName) || '').trim().split(/\s+/)[0];
    return '<header class="mast">' +
        '<p class="wordmark" aria-label="LSC Creative">LSC <span>Creative.</span></p>' +
        '<p class="kicker">Estimate' + (e.version > 1 ? ', version ' + esc(e.version) : '') + '</p>' +
      '</header>' +
      '<h1 class="title">' + esc(e.name) + '</h1>' +
      (e.state === 'open'
        ? '<p class="lede">Here’s your estimate' + (first ? ', ' + esc(first) : '') +
          '. If it looks right, press the Accept estimate button below.</p>'
        : '') +
      '<dl class="meta">' +
        metaRow('For', e.client && e.client.businessName) +
        metaRow('Reference', e.upid) +
        metaRow('Issued', longDate(e.issuedOn)) +
        metaRow('Valid until', longDate(e.validUntil)) +
      '</dl>';
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

  function days(e) {
    const list = e.days || [];
    if (!list.length) return '';
    const anyProposed = list.some((d) => d.status === 'proposed');
    return '<section class="block" aria-labelledby="h-days">' + sectionHead('h-days', 'Production days') +
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
          '<button type="button" class="btn btn-primary" data-act="accept">Accept estimate</button>' +
          (e.faqUrl ? '<p class="panel-aside"><a href="' + esc(e.faqUrl) + '" target="_blank" rel="noopener">Questions about the agreement? Read our FAQ<span class="visually-hidden"> (opens in a new tab)</span></a></p>' : '') +
        '</section>';
      case 'taken':
        return notice('Some proposed dates are no longer available',
          'Another booking has taken one of the proposed dates, marked above. We’ll send you an updated estimate with new dates.');
      case 'expired':
        return notice('This estimate has expired',
          'It was valid until ' + esc(longDate(e.validUntil)) + '. Contact ' + contact + ' and we’ll send you an updated one.');
      case 'superseded':
        // No newer link means nothing newer has gone out yet: the project was
        // reopened, or is being reworked, and this version is off the table.
        return e.latestToken
          ? notice('This estimate has been updated',
            'We’ve sent a newer version. <a href="#e/' + esc(e.latestToken) + '">See the latest estimate</a>.')
          : notice('We’re revising this estimate',
            'It’s no longer open to accept. We’ll send you the updated version when it’s ready. In the meantime, contact ' + contact + ' with any questions.');
      case 'declined':
        return notice('This estimate was declined',
          'If that’s changed, contact ' + contact + ' and we’ll put together a new one.');
      case 'accepted':
        // An estimate accepted in the app was never signed here: no agreement
        // to offer until signing (task 27) says there is one.
        return notice('Thank you',
          'We’ll be in touch to confirm the details.',
          e.signed ? '<button type="button" class="btn btn-quiet" data-act="agreement">Download signed agreement</button>' : '', 'done');
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
      '<p class="foot-legal">' + [b.name, b.abn ? 'ABN ' + b.abn : ''].filter(Boolean).map((x) => '<span>' + esc(x) + '</span>').join('') + '</p>' +
    '</footer>';
  }

  function render(e) {
    doc.innerHTML = masthead(e) + deliverables(e) + days(e) + included(e) + investment(e) + action(e) + footer(e);
    doc.removeAttribute('aria-busy');
    document.title = (e.name ? e.name + ' — ' : '') + 'Estimate — LSC Creative';
  }

  /* A page with no estimate on it: a bad link, or the server out of reach. */
  function renderNotice(title, body, retry) {
    doc.innerHTML = '<header class="mast"><p class="wordmark" aria-label="LSC Creative">LSC <span>Creative.</span></p></header>' +
      '<h1 class="title">' + esc(title) + '</h1>' +
      '<p class="lede">' + esc(body) + '</p>' +
      (retry ? '<button type="button" class="btn btn-quiet lede-btn" data-act="retry">Try again</button>' : '');
    doc.removeAttribute('aria-busy');
    document.title = title + ' — LSC Creative';
  }

  const renderMissing = () => renderNotice('We couldn’t find this estimate',
    'The link may be incomplete. Check it against the email we sent, or ask us for a new one.');

  // ── Loading ───────────────────────────────────────────────────────────────

  let token = '';
  let ticket = 0;

  function tokenOf(hash) {
    const m = /^#e\/([A-Za-z0-9_-]+)$/.exec(hash);
    return m ? m[1] : '';
  }

  async function load() {
    const mine = ++ticket;
    token = tokenOf(location.hash);
    if (!token || !API) return renderMissing();
    if (!doc.querySelector('.loading')) doc.innerHTML = '<p class="loading">Loading your estimate…</p>';
    doc.setAttribute('aria-busy', 'true');
    let res;
    let body = null;
    try {
      res = await fetch(API + '/public/estimates/' + encodeURIComponent(token), {
        credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' },
      });
      body = await res.json().catch(() => null);
    } catch (_err) {
      res = null;
    }
    if (mine !== ticket) return undefined;  // the address changed while this was on its way
    if (res && res.ok && body && body.estimate) {
      render(body.estimate);
      return undefined;
    }
    if (res && res.status === 404) return renderMissing();
    if (res && res.status === 429) {
      return renderNotice('Please wait a moment',
        'This page has been opened a lot in the last few minutes. Wait a minute, then try again.', true);
    }
    return renderNotice('We couldn’t load your estimate',
      res ? 'Something went wrong on our side. Try again in a moment.' : 'Check your connection, then try again.', true);
  }

  // ── The PDF ───────────────────────────────────────────────────────────────

  function filenameOf(disposition) {
    const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition || '');
    if (star) {
      try {
        return decodeURIComponent(star[1]);
      } catch (_err) { /* fall through to the plain name */ }
    }
    const plain = /filename="?([^";]+)"?/i.exec(disposition || '');
    return plain ? plain[1] : 'Estimate.pdf';
  }

  async function downloadPdf(btn) {
    const msg = document.getElementById('pdf-msg');
    const show = (text) => {
      if (msg) msg.textContent = text;
    };
    const label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Preparing PDF…';
    show('');
    try {
      const res = await fetch(API + '/public/estimates/' + encodeURIComponent(token) + '/pdf', { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) throw res.status;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameOf(res.headers.get('Content-Disposition'));
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      show('Your PDF has downloaded.');
    } catch (status) {
      show(status === 429
        ? 'That’s a lot of downloads in a short time. Try again in a few minutes.'
        : status === 404
          ? 'This estimate is no longer available. Ask us for a copy.'
          : typeof status === 'number'
            ? 'We couldn’t make the PDF just now. Try again shortly, or ask us for a copy.'
            : 'Check your connection, then try again.');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = label;
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  doc.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'pdf') return void downloadPdf(btn);
    if (act === 'retry') return void load();
    // Accept and the signed agreement are task 27 (signing).
    say('Signing online isn’t switched on yet. Reply to our email to accept, and we’ll take it from there.');
  });

  window.addEventListener('hashchange', () => {
    // A link to the newer version: start at the top of it, with a screen
    // reader's focus there too.
    window.scrollTo(0, 0);
    load().then(() => doc.focus({ preventScroll: true }));
  });
  load();
}());
