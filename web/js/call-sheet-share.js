'use strict';

/* Sharing the call sheet (trip-planner task 11; T13, IA flow 10).
 *
 * One dialog, opened from the Project page's Call sheet row (Actions ▾ →
 * Share…) and from the in-app call sheet's Share… button:
 *
 *   Link    off: one sentence and Turn on link (the first time makes the
 *           token). On: the link, Copy link, and Turn off link, which keeps
 *           the token, so turning it on again brings back the same link and
 *           anything already sent works again.
 *   Email   only while the link is on, since the email is that link: To, one
 *           or more addresses (comma, semicolon or Enter between them, or a
 *           pasted list), and an optional note. Send goes now, one email per
 *           person (POST …/call-sheet/email). An address the provider
 *           refuses stays in To with the reason; the rest went.
 *
 * The To field is SendPanel's To field made plural: the same check
 * (SendPanel.isEmail) per address, each kept as a removable chip. Copying
 * goes through SendPanel.copyText, so Safari's clipboard rule is handled once.
 *
 * Nothing behind the dialog is redrawn while it's open (its opener would be
 * drawn away): `onClose({ link, changed })` tells the screen what changed,
 * once, as it closes.
 */

const CallSheetShare = (() => {
  const { esc } = LSCUtil;
  const MAX_TO = 20; // as routes/estimates.js CALL_SHEET_RECIPIENTS
  const NOTE_MAX = 2000;

  const s = {
    overlay: null,
    opener: null,
    opts: null,
    link: null, // { on, token }
    to: [], // the chips
    note: '',
    emailOn: null, // unknown until /api/email/status answers
    working: false,
    changed: false,
  };

  /** The crew's page for a token: c/#s/<token>, beside the app. */
  const linkFor = (token) => new URL('c/', window.location.href).href + '#s/' + token;

  const pathOf = (estimateId, rest) => '/api/estimates/' + encodeURIComponent(estimateId) + '/call-sheet/' + rest;

  /** Turns the link on or off: resolves { on, token }. */
  function setLink(estimateId, on) {
    return LSCApi.post(pathOf(estimateId, 'link'), { on }).then((r) => ({ on: r.on, token: r.token }));
  }

  /* "Call sheet sent to jo@crew.com." or "… to 3 people." */
  const sentText = (sent) => 'Call sheet sent to ' + (sent.length === 1 ? sent[0] : sent.length + ' people') + '.';

  // ── The overlay ─────────────────────────────────────────────────────────

  const q = (id) => s.overlay.querySelector('#' + id);
  const isOpen = () => Boolean(s.overlay && s.overlay.classList.contains('open'));

  function onKeydown(event) {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!s.working) close(true);
      return;
    }
    LSCModal.trapTab(s.overlay, event);
  }
  function onOverlayClick(event) {
    if (event.target === s.overlay && !s.working) close(true);
  }

  function close(returnFocus) {
    if (!isOpen()) return;
    s.overlay.classList.remove('open');
    s.overlay.innerHTML = '';
    document.removeEventListener('keydown', onKeydown);
    s.overlay.removeEventListener('click', onOverlayClick);
    const { opener, opts, link, changed } = s;
    s.opener = null;
    s.opts = null;
    s.working = false;
    if (returnFocus && opener && opener.isConnected) opener.focus();
    if (opts && opts.onClose) opts.onClose({ link, changed });
  }

  // ── Markup ──────────────────────────────────────────────────────────────

  function linkMarkup() {
    const { on, token } = s.link;
    const head =
      '<div class="css-head"><h3 class="css-h" id="css-link-h">Link</h3>' +
      '<span class="pf-chip ' + (on ? 'is-info' : 'is-neutral') + '">' + (on ? 'On' : 'Off') + '</span></div>';
    if (!on) {
      return head +
        '<p class="css-text" id="css-link-text">' + (token
          ? 'It’s off: anyone who opens it is told it isn’t active. Turning it on brings back the same link, so the ones already sent work again.'
          : 'Turn it on to copy the link or email it to crew. Anyone with the link can open the call sheet.') + '</p>' +
        '<button type="button" class="btn btn-accent css-on" id="css-on" aria-describedby="css-link-text">' +
        '<span class="spinner" id="css-on-spin"></span>Turn on link</button>';
    }
    return head +
      '<div class="css-url-row">' +
      '<input id="css-url" class="css-url" type="text" readonly value="' + esc(linkFor(token)) + '" aria-label="Call sheet link" aria-describedby="css-url-hint">' +
      '<button type="button" class="btn css-copy" id="css-copy">Copy link</button>' +
      '</div>' +
      '<div class="css-link-foot"><p class="sp-hint" id="css-url-hint">Anyone with the link can open it.</p>' +
      '<button type="button" class="btn btn-quiet css-off" id="css-off">Turn off link</button></div>';
  }

  function chipsMarkup() {
    return s.to.map((addr, i) =>
      '<li class="css-chip"><span class="css-chip-text">' + esc(addr) + '</span>' +
      '<button type="button" class="css-chip-x" data-chip="' + i + '" aria-label="Remove ' + esc(addr) + '">' +
      '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '</button></li>').join('');
  }

  function emailMarkup() {
    if (!s.link.on) return '';
    return (
      '<section class="css-section css-email" aria-labelledby="css-email-h">' +
      '<div class="css-head"><h3 class="css-h" id="css-email-h">Email it</h3></div>' +
      '<div class="sp-fields">' +
      '<div class="sp-row field"><label class="sp-label" for="css-to">To</label>' +
      '<div><div class="css-to" id="css-to-box">' +
      '<ul class="css-chips" id="css-chips" aria-label="Sending to"' + (s.to.length ? '' : ' hidden') + '>' + chipsMarkup() + '</ul>' +
      '<input id="css-to" type="text" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false"' +
      ' aria-describedby="css-to-err css-to-hint">' +
      '</div>' +
      '<p class="css-field-err" id="css-to-err"></p>' +
      '<p class="sp-hint" id="css-to-hint">One or more addresses, with a comma or Enter between them. Each person gets their own email.</p>' +
      '</div></div>' +
      '<div class="sp-row field"><label class="sp-label" for="css-note">Note</label>' +
      '<div><textarea id="css-note" rows="3" maxlength="' + NOTE_MAX + '" aria-describedby="css-note-hint">' + esc(s.note) + '</textarea>' +
      '<p class="sp-hint" id="css-note-hint">Optional. It goes above the link.</p></div></div>' +
      '</div>' +
      '<p class="sp-email-off" id="css-email-off" role="note"' + (s.emailOn === false ? '' : ' hidden') + '>' +
      'Email isn’t set up yet, so it can’t be sent from here. Copy the link and send it yourself, or connect email in ' +
      '<button type="button" class="sp-inline-link" id="css-settings">Settings → Email</button>.</p>' +
      '</section>'
    );
  }

  function boxMarkup() {
    const o = s.opts;
    return (
      '<div class="modal-box send-panel css-panel" role="dialog" aria-modal="true" aria-labelledby="css-title" aria-describedby="css-desc">' +
      '<h2 class="modal-title" id="css-title">' + esc(o.title || 'Share the call sheet') + '</h2>' +
      '<p class="sp-intro" id="css-desc">Crew get a page with each day’s map, the stops and their times, and the location and access details, ' +
      'with a PDF to save. It never shows prices, and always shows the trips as last saved.</p>' +
      '<section class="css-section css-link" aria-labelledby="css-link-h">' + linkMarkup() + '</section>' +
      emailMarkup() +
      '<p class="sr-only" id="css-live" aria-live="polite"></p>' +
      '<div class="pfd-error" id="css-error" role="alert"></div>' +
      '<div class="modal-actions sp-actions css-actions">' +
      '<button type="button" class="btn btn-ghost" id="css-done">Done</button>' +
      (s.link.on
        ? '<button type="button" class="btn btn-accent" id="css-send"' + (s.emailOn === false ? ' disabled' : '') + '>' +
          '<span class="spinner" id="css-send-spin"></span>Send</button>'
        : '') +
      '</div></div>'
    );
  }

  // ── Behaviour ───────────────────────────────────────────────────────────

  const say = (text) => {
    const live = q('css-live');
    if (!live) return;
    // Cleared first, so the same words twice are read twice.
    live.textContent = '';
    setTimeout(() => {
      if (isOpen() && q('css-live')) q('css-live').textContent = text;
    }, 30);
  };

  /* Signed out meanwhile: the dialog goes, and the screen's own handler
     takes over. */
  function authLost() {
    const o = s.opts;
    close(false);
    if (o && o.onAuthLost) o.onAuthLost();
  }

  function fail(message, focusId) {
    q('css-error').textContent = message || '';
    if (focusId && q(focusId)) q(focusId).focus();
  }

  function toError(message) {
    const err = q('css-to-err');
    if (!err) return;
    err.textContent = message || '';
    q('css-to').setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  /* "Jo <jo@crew.com>" and a pasted list alike: the addresses in some text. */
  function addressesIn(text) {
    return String(text || '')
      .replace(/"?[^"<>,;]*"?\s*<([^<>]+)>/g, ' $1 ')
      .split(/[\s,;]+/)
      .map((p) => p.replace(/^[<("']+|[>)"'.]+$/g, ''))
      .filter(Boolean);
  }

  function drawChips() {
    const list = q('css-chips');
    if (!list) return;
    list.innerHTML = chipsMarkup();
    list.hidden = !s.to.length;
    list.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
      const addr = s.to[Number(b.dataset.chip)];
      s.to.splice(Number(b.dataset.chip), 1);
      drawChips();
      toError('');
      q('css-to').focus();
      say('Removed ' + addr + '.');
    }));
  }

  /* Turns typed text into chips. What isn't an address stays in the field,
     said once. Returns false when something was left there. */
  function commit(text) {
    const field = q('css-to');
    if (!field) return true;
    const parts = addressesIn(text);
    const bad = [];
    const added = [];
    const again = [];
    let over = false;
    parts.forEach((p) => {
      if (!SendPanel.isEmail(p)) return bad.push(p);
      if (s.to.some((t) => t.toLowerCase() === p.toLowerCase())) return again.push(p);
      if (s.to.length >= MAX_TO) {
        over = true;
        return bad.push(p);
      }
      s.to.push(p);
      added.push(p);
      return undefined;
    });
    field.value = bad.join(', ');
    if (added.length) drawChips();
    toError(over ? 'Up to ' + MAX_TO + ' people at a time.'
      : bad.length ? '“' + bad[0] + '” isn’t a valid email address.' : '');
    const already = again.length ? ' ' + (again.length === 1 ? again[0] + ' is' : again.length + ' were') + ' already in the list.' : '';
    if (added.length) say((added.length === 1 ? 'Added ' + added[0] + '.' : 'Added ' + added.length + ' addresses.') + already);
    else if (already) say(already.trim());
    return !bad.length;
  }

  function bindTo() {
    const field = q('css-to');
    if (!field) return;
    q('css-to-box').addEventListener('click', (e) => {
      if (e.target === e.currentTarget || e.target.id === 'css-chips') field.focus();
    });
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
        e.preventDefault();
        if (field.value.trim()) commit(field.value);
      } else if (e.key === 'Backspace' && !field.value && s.to.length && field.selectionStart === 0) {
        e.preventDefault();
        const addr = s.to.pop();
        drawChips();
        say('Removed ' + addr + '.');
      }
    });
    // A pasted list, or a space typed after an address: chips up to the last
    // separator, the rest left to finish.
    field.addEventListener('input', () => {
      const v = field.value;
      const cut = Math.max(v.lastIndexOf(','), v.lastIndexOf(';'), v.lastIndexOf(' '), v.lastIndexOf('\n'));
      if (cut < 0) {
        if (q('css-to-err').textContent) toError('');
        return;
      }
      const head = v.slice(0, cut);
      const tail = v.slice(cut + 1);
      if (!head.trim()) {
        field.value = tail;
        return;
      }
      commit(head);
      field.value = (field.value ? field.value + ', ' : '') + tail;
    });
    field.addEventListener('blur', () => {
      if (field.value.trim() && isOpen()) commit(field.value);
    });
    drawChips();
  }

  async function turn(on) {
    if (s.working) return;
    const button = q(on ? 'css-on' : 'css-off');
    s.working = true;
    if (button) button.disabled = true;
    const spin = q('css-on-spin');
    if (on && spin) spin.style.display = 'inline-block';
    fail('');
    try {
      s.link = await setLink(s.opts.estimateId, on);
      s.changed = true;
      s.working = false;
      render(on ? 'css-copy' : 'css-on');
      say(on ? 'Link on. Copy it, or email it below.' : 'Link off. Anyone who opens it is told it isn’t active.');
    } catch (err) {
      s.working = false;
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') {
        authLost();
        return;
      }
      if (button && button.isConnected) button.disabled = false;
      if (spin) spin.style.display = 'none';
      fail(err.kind === 'network' ? 'The server is unreachable. The link didn’t change.'
        : err.message || 'The server refused.');
    }
  }

  async function copy() {
    const url = linkFor(s.link.token);
    const field = q('css-url');
    if (await SendPanel.copyText(url)) {
      Toast.ok('Copied.');
      say('Link copied.');
    } else {
      // Refused by the browser: the link is right there, selected.
      field.focus();
      field.select();
      fail('This browser didn’t let the app copy it. The link is selected: copy it from the field.');
    }
  }

  async function send() {
    if (s.working) return;
    fail('');
    const field = q('css-to');
    if (field.value.trim() && !commit(field.value)) return field.focus();
    if (!s.to.length) {
      toError('Add at least one email address.');
      return field.focus();
    }
    s.note = q('css-note').value;
    s.working = true;
    ['css-send', 'css-done', 'css-copy', 'css-off'].forEach((id) => q(id) && (q(id).disabled = true));
    q('css-send-spin').style.display = 'inline-block';
    let reply;
    try {
      reply = await LSCApi.post(pathOf(s.opts.estimateId, 'email'), { to: s.to.slice(), note: s.note });
    } catch (err) {
      s.working = false;
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') {
        authLost();
        return undefined;
      }
      // Turned off meanwhile (another tab), or email came unset: the dialog
      // redraws as things now are, keeping what was typed.
      if (err.code === 'link_off') s.link = { on: false, token: s.link.token };
      if (err.code === 'not_configured') s.emailOn = false;
      render(err.code === 'bad_recipient' ? 'css-to' : q('css-send') ? 'css-send' : 'css-on');
      fail(err.kind === 'network' ? 'The server is unreachable. Nothing was sent.' : err.message || 'The server refused.');
      return undefined;
    }
    s.working = false;
    const sent = reply.sent || [];
    const failed = reply.failed || [];
    if (sent.length) s.changed = true;
    if (!failed.length) {
      close(true);
      Toast.ok(sentText(sent));
      return undefined;
    }
    // Some went: those leave To; the refused ones stay, with why.
    s.to = failed.map((f) => f.to);
    render('css-to');
    if (sent.length) Toast.ok(sentText(sent));
    fail((sent.length ? 'Sent to ' + sent.length + ' of ' + (sent.length + failed.length) + '. ' : 'Nothing was sent. ') +
      'Couldn’t send to ' + failed.map((f) => f.to).join(', ') + ': ' + (failed[0].message || 'the provider refused it.'));
    return undefined;
  }

  /* Draws the box as things stand, keeping the note and chips, and puts
     focus on `focusId` (null: leaves it to the caller). */
  function render(focusId) {
    const note = q('css-note');
    if (note) s.note = note.value;
    s.overlay.innerHTML = boxMarkup();
    q('css-done').addEventListener('click', () => close(true));
    if (q('css-on')) q('css-on').addEventListener('click', () => turn(true));
    if (q('css-off')) q('css-off').addEventListener('click', () => turn(false));
    if (q('css-copy')) q('css-copy').addEventListener('click', copy);
    if (q('css-send')) q('css-send').addEventListener('click', send);
    if (q('css-settings')) q('css-settings').addEventListener('click', () => {
      close(false);
      LSCRouter.go('/settings/email');
    });
    bindTo();
    if (focusId && q(focusId)) q(focusId).focus();
  }

  /**
   * Opens the dialog.
   *
   * @param {HTMLElement} opener  focus goes back here on close
   * @param {object} o
   *   estimateId
   *   link        { on, token } as it stands
   *   title       optional: "Share the call sheet — Day two"
   *   selectLink  the link field starts selected (Copy link was refused)
   *   onClose({ link, changed })   the screen redraws from this
   *   onAuthLost()
   */
  function open(opener, o) {
    s.overlay = document.getElementById('modal-share');
    if (!s.overlay) return;
    close(false);
    Object.assign(s, {
      opener: opener || null,
      opts: o,
      link: { on: Boolean(o.link && o.link.on), token: (o.link && o.link.token) || null },
      to: [],
      note: '',
      emailOn: null,
      working: false,
      changed: false,
    });
    s.overlay.classList.add('open');
    document.addEventListener('keydown', onKeydown);
    s.overlay.addEventListener('click', onOverlayClick);
    render(null);
    if (o.selectLink && q('css-url')) {
      q('css-url').focus();
      q('css-url').select();
      fail('This browser didn’t let the app copy it. The link is selected: copy it from the field.');
    } else {
      (q('css-on') || q('css-copy')).focus();
    }

    // Email that isn't set up would fail at the server: say so now (SendPanel's rule).
    const mine = o;
    LSCApi.get('/api/email/status').then((status) => {
      if (s.opts !== mine) return;
      s.emailOn = Boolean(status.configured);
      if (s.emailOn) return;
      const note = q('css-email-off');
      if (note) note.hidden = false;
      if (q('css-send')) q('css-send').disabled = true;
    }, () => {}); // unknown: the server still refuses if it isn't
  }

  /**
   * A row's Copy link, for a link already on: copied with a toast, or, if the
   * browser refuses, the dialog opens with the link selected. `o` is open's.
   */
  async function copyLink(opener, o) {
    if (await SendPanel.copyText(linkFor(o.link.token))) Toast.ok('Copied.');
    else open(opener, Object.assign({}, o, { selectLink: true }));
  }

  return { open, close, copyLink, setLink, linkFor, isOpen };
})();
