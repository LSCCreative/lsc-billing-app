'use strict';

/* The send panel (production-booking task 29; D43, D47; IA "Sending UI").
 *
 * One panel for every document a client is sent: the estimate, and the
 * deposit, final or single invoice. It asks who, when (now, or a date and
 * time), the document's date (an estimate's valid-until, an invoice's due
 * date, both counted from the day it goes) and the message, pre-filled per
 * kind from Settings. Then:
 *
 *   Confirm to send   the document's own route (POST …/send, by: 'email')
 *                     changes the document and queues the email in one go;
 *                     the server's outbox sends it (server/src/sends.js).
 *   Copy link         off to the side, for sending another way (D43): the
 *                     same route with by: 'link' makes the document live
 *                     with no email, and its client link is copied.
 *
 * NOTHING GOES WITHOUT A BUTTON (brief, principle 2): confirming is the only
 * way an email is queued, and a scheduled one can be changed or cancelled
 * until it goes (D47). The panel says so before it's pressed.
 *
 * The rows' status line ("Email scheduled Tue 8 Oct, 9:00 am · Change ·
 * Cancel", "Sent late at 11:42 am (scheduled 9:00 am)", "Email failed: … ·
 * Retry") is here too, so the folder and the invoice screen word a send the
 * same way.
 *
 * COPYING AFTER A REQUEST. Safari lets a page write the clipboard only inside
 * the click, but the link of a first send doesn't exist until the server has
 * made it. So the write starts in the click with a promise of the text
 * (ClipboardItem), and falls back to writeText; if both are refused, the
 * panel shows the link selected, to copy by hand.
 */

const SendPanel = (() => {
  const { esc } = LSCUtil;
  const C = LSCCalendar;
  const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/; // as server/src/mail.js
  const YEAR_MS = 365 * 86400000;

  const panel = { overlay: null, opener: null, working: false, opts: null };

  // ── Words ───────────────────────────────────────────────────────────────

  const pad = (n) => String(n).padStart(2, '0');
  const ymdOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const timeOf = (d) => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

  /* "today, 3:00 pm", "tomorrow, 9:00 am", "Tue 8 Oct, 9:00 am": an instant
     on this browser's clock, the year only when it isn't this one. */
  function whenText(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const ymd = ymdOf(d);
    const today = LSCUtil.today();
    const day = ymd === today ? 'today'
      : ymd === C.addDays(today, 1) ? 'tomorrow'
        : WEEKDAY[d.getDay()] + ' ' + d.getDate() + ' ' + C.MONTHS[d.getMonth()].slice(0, 3) +
          (ymd.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + d.getFullYear());
    return day + ', ' + timeOf(d);
  }

  /* A day as the fields' hints say it: "Tue 4 Nov". */
  const dayText = (ymd) => (C.isDate(ymd) ? C.shortDate(ymd) : '');

  /* The client's page for a document, beside the app: c/#e/<token> or
     c/#i/<token>. The email's link is built from the server's APP_URL, the
     same site. */
  function linkFor(docKind, token) {
    return new URL('c/', window.location.href).href + '#' + (docKind === 'estimate' ? 'e' : 'i') + '/' + token;
  }

  /**
   * A document's newest email as its row says it (D47): { text, tone, acts },
   * or null when it has never been emailed. `acts` are what can still be done
   * about it: change and cancel a waiting one, retry or give up a failed one.
   */
  function statusOf(send) {
    if (!send) return null;
    // An estimate's email names its version: a later one may have gone by link.
    const of = send.version ? ' of v' + send.version : '';
    const v = send.version ? 'v' + send.version + ' ' : '';
    const to = send.to ? ' to ' + send.to : '';
    switch (send.status) {
      case 'scheduled':
        // Due already: the outbox is about to take it (a send for "Now").
        if (Date.parse(send.scheduledFor) <= Date.now()) return { text: 'Sending the email' + of + ' now…', tone: 'wait', acts: [] };
        return { text: 'Email' + of + ' scheduled ' + whenText(send.scheduledFor) + to, tone: 'wait', acts: ['edit', 'cancel'] };
      case 'sending':
        return { text: 'Sending the email' + of + ' now…', tone: 'wait', acts: [] };
      case 'sent': {
        if (!send.late) return { text: (v ? v + 'emailed ' : 'Emailed ') + whenText(send.sentAt) + to, tone: 'ok', acts: [] };
        const sent = new Date(send.sentAt);
        const planned = new Date(send.scheduledFor);
        const sameDay = ymdOf(sent) === ymdOf(planned);
        return {
          text: (v ? v + 'sent' : 'Sent') + ' late at ' + (sameDay ? timeOf(sent) : whenText(send.sentAt)) +
            ' (scheduled ' + (sameDay ? timeOf(planned) : whenText(send.scheduledFor)) + ')',
          tone: 'late',
          acts: [],
        };
      }
      case 'failed':
        return { text: 'Email' + of + ' failed' + (send.error ? ': ' + send.error : ''), tone: 'err', acts: ['retry', 'cancel'] };
      case 'cancelled':
        return { text: 'Email' + of + ' cancelled', tone: '', acts: [] };
      default:
        return null;
    }
  }

  const ACT_LABEL = { edit: 'Change', cancel: 'Cancel email', retry: 'Retry' };

  /* The status line under a document, with its buttons. `what` names the
     document for a screen reader ("the estimate", "INV-AUD-B-D"). */
  function statusMarkup(send, what) {
    const s = statusOf(send);
    if (!s) return '';
    return (
      '<p class="send-status' + (s.tone ? ' is-' + s.tone : '') + '">' +
      '<span class="send-status-text">' + esc(s.text) + '</span>' +
      s.acts.map((a) =>
        '<button type="button" class="send-status-act" data-send-act="' + a + '" data-send="' + esc(send.id) + '"' +
        ' aria-label="' + esc(ACT_LABEL[a] + ' — ' + (a === 'edit' ? 'the scheduled email of ' : 'the email of ') + what) + '">' +
        esc(ACT_LABEL[a]) + '</button>').join('') +
      '</p>'
    );
  }

  // ── The clipboard ───────────────────────────────────────────────────────

  /* Copies `text`, a string or a promise of one. Resolves true when it's on
     the clipboard. Called inside the click (see the header). */
  function copyText(text) {
    const clip = navigator.clipboard;
    const later = Promise.resolve(text);
    if (!clip) return Promise.resolve(false);
    const plain = () => later.then((t) => clip.writeText(t)).then(() => true, () => false);
    if (typeof text !== 'string' && window.ClipboardItem && clip.write) {
      let item;
      try {
        item = new ClipboardItem({ 'text/plain': later.then((t) => new Blob([t], { type: 'text/plain' })) });
      } catch (_) {
        return plain();
      }
      return clip.write([item]).then(() => true, plain);
    }
    return plain();
  }

  // ── The overlay ─────────────────────────────────────────────────────────

  function onKeydown(event) {
    if (!panel.overlay || !panel.overlay.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!panel.working) close(true);
      return;
    }
    LSCModal.trapTab(panel.overlay, event);
  }
  function onOverlayClick(event) {
    if (event.target === panel.overlay && !panel.working) close(true);
  }

  function close(returnFocus) {
    const o = panel.overlay;
    if (!o || !o.classList.contains('open')) return;
    o.classList.remove('open');
    o.innerHTML = '';
    document.removeEventListener('keydown', onKeydown);
    o.removeEventListener('click', onOverlayClick);
    if (returnFocus && panel.opener && panel.opener.isConnected) panel.opener.focus();
    panel.opener = null;
    panel.working = false;
    panel.opts = null;
  }

  function mount(opener, html) {
    panel.overlay = document.getElementById('modal-send');
    if (!panel.overlay) return null;
    close(false);
    panel.opener = opener || null;
    panel.overlay.innerHTML = html;
    panel.overlay.classList.add('open');
    document.addEventListener('keydown', onKeydown);
    panel.overlay.addEventListener('click', onOverlayClick);
    return (id) => panel.overlay.querySelector('#' + id);
  }

  /* The link, selected, when the clipboard refused it: the document is
     already live, so the panel turns into the link to copy by hand. */
  function showLink(opener, url, said) {
    const q = mount(opener,
      '<div class="modal-box send-panel" role="dialog" aria-modal="true" aria-labelledby="sp-title" aria-describedby="sp-desc">' +
      '<h2 class="modal-title" id="sp-title">Copy the link</h2>' +
      '<p class="sp-intro" id="sp-desc">' + esc(said || '') + ' This browser didn’t let the app copy it, so select it and copy it here.</p>' +
      '<div class="field"><label for="sp-link">Client link</label><input id="sp-link" type="text" readonly value="' + esc(url) + '"></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-accent" id="sp-done">Done</button></div></div>');
    if (!q) return;
    q('sp-done').addEventListener('click', () => close(true));
    const field = q('sp-link');
    field.focus();
    field.select();
  }

  /** A row's "Copy link", for a document already live. */
  async function copyLink(docKind, token, opener) {
    const url = linkFor(docKind, token);
    if (await copyText(url)) Toast.ok('Link copied.');
    else showLink(opener, url, '');
  }

  // ── The panel ───────────────────────────────────────────────────────────

  /* Local date and time fields as an instant. */
  function instantOf(ymd, hm) {
    if (!C.isDate(ymd) || !/^\d{2}:\d{2}$/.test(hm || '')) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    const [h, mi] = hm.split(':').map(Number);
    const t = new Date(y, m - 1, d, h, mi);
    return Number.isFinite(t.getTime()) ? t : null;
  }

  /* Tomorrow at 9: where "Later" starts. */
  function laterDefault() {
    return { date: C.addDays(LSCUtil.today(), 1), time: '09:00' };
  }

  /**
   * Opens the panel to send a document, or to change a scheduled email.
   *
   * @param {HTMLElement} opener   focus goes back here on close
   * @param {object} o
   *   docKind   'estimate' | 'invoice'
   *   title     "Send v2", "Send INV-AUD-B-D"
   *   intro     the opening sentence: what the client gets
   *   to        the client's email, pre-filled
   *   message   the kind's message from Settings
   *   date      { key: 'validUntil' | 'dueAt', label, days, hint(sendDay, value) }
   *             a date counted from the day it goes; `fixed` (with
   *             `value`) shows it read-only instead
   *   linkHint  what Copy link does, said under it
   *   send(body)     → Promise of the route's reply (rejects with LSCApi.ApiError)
   *   tokenOf(reply) → the document's link token in that reply
   *   done(reply, how)   redraws the screen; how is 'email' or 'link'; it
   *                  returns the toast's words
   *   edit      a scheduled send (from statusOf's row): the panel changes it
   *             through save(patch) instead, with no Copy link
   *   save(patch)    → Promise (PUT /api/sends/:id)
   */
  function open(opener, o) {
    const editing = Boolean(o.edit);
    const later = editing ? null : laterDefault();
    let startDate = later ? later.date : '';
    let startTime = later ? later.time : '';
    if (editing) {
      const at = new Date(o.edit.scheduledFor);
      startDate = ymdOf(at);
      startTime = pad(at.getHours()) + ':' + pad(at.getMinutes());
    }
    const today = LSCUtil.today();
    const date = o.date;
    const dateValue = date.value || C.addDays(today, date.days);
    const dateField = date.fixed
      ? '<div class="sp-row"><span class="sp-label">' + esc(date.label) + '</span>' +
        '<p class="sp-fixed">' + esc(dayText(date.value)) + '<span class="sp-hint"> ' + esc(date.fixedNote || '') + '</span></p></div>'
      : '<div class="sp-row field"><label class="sp-label" for="sp-date">' + esc(date.label) + '</label>' +
        '<div><input id="sp-date" type="date" value="' + esc(dateValue) + '" min="' + esc(today) + '" aria-describedby="sp-date-hint">' +
        '<p class="sp-hint" id="sp-date-hint"></p></div></div>';

    const q = mount(opener,
      '<div class="modal-box send-panel" role="dialog" aria-modal="true" aria-labelledby="sp-title" aria-describedby="sp-desc">' +
      '<h2 class="modal-title" id="sp-title">' + esc(editing ? 'Change the scheduled email' : o.title) + '</h2>' +
      '<p class="sp-intro" id="sp-desc">' + esc(editing ? 'It goes at the new time instead. Until then you can change or cancel it again.' : o.intro) + '</p>' +
      '<div class="sp-fields">' +
      '<div class="sp-row field"><label class="sp-label" for="sp-to">To</label>' +
      '<div><input id="sp-to" type="email" autocomplete="off" spellcheck="false" value="' + esc(editing ? o.edit.to : o.to || '') + '"' +
      ' aria-describedby="sp-to-hint"><p class="sp-hint" id="sp-to-hint">' +
      (o.to || editing ? 'Replies go to your own address.' : 'This client has no email saved. Type the one to send to.') + '</p></div></div>' +
      '<fieldset class="sp-row sp-when"><legend class="sp-label">When</legend><div>' +
      '<div class="sp-seg" role="radiogroup" aria-label="When">' +
      '<label><input type="radio" name="sp-when" value="now"' + (editing ? '' : ' checked') + '><span>Now</span></label>' +
      '<label><input type="radio" name="sp-when" value="later"' + (editing ? ' checked' : '') + '><span>Later</span></label>' +
      '</div>' +
      '<div class="sp-at" id="sp-at"' + (editing ? '' : ' hidden') + '>' +
      '<div class="field"><label for="sp-day">Date</label><input id="sp-day" type="date" value="' + esc(startDate) + '" min="' + esc(today) + '"></div>' +
      '<div class="field"><label for="sp-time">Time</label><input id="sp-time" type="time" step="300" value="' + esc(startTime) + '"></div>' +
      '</div></div></fieldset>' +
      dateField +
      '<div class="sp-row field"><label class="sp-label" for="sp-msg">Message</label>' +
      '<div><textarea id="sp-msg" rows="5" maxlength="5000" aria-describedby="sp-msg-hint">' + esc(editing ? o.edit.message : o.message || '') + '</textarea>' +
      '<p class="sp-hint" id="sp-msg-hint">Above the link in the email. The starting text is in Settings → Estimates &amp; invoices.</p></div></div>' +
      '</div>' +
      '<p class="sp-email-off" id="sp-email-off" role="note" hidden></p>' +
      '<p class="sp-summary" id="sp-summary" aria-live="polite"></p>' +
      '<div class="pfd-error" id="sp-error" role="alert"></div>' +
      '<div class="modal-actions sp-actions">' +
      (editing ? '' :
        '<div class="sp-aside"><button type="button" class="btn btn-ghost" id="sp-copy" aria-describedby="sp-copy-hint">' +
        '<span class="spinner" id="sp-copy-spin"></span>Copy link</button>' +
        '<p class="sp-hint" id="sp-copy-hint">' + esc(o.linkHint) + '</p></div>') +
      '<button type="button" class="btn btn-ghost" id="sp-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-accent" id="sp-ok"><span class="spinner" id="sp-spin"></span>' +
      (editing ? 'Save changes' : 'Confirm to send') + '</button>' +
      '</div></div>');
    if (!q) return;
    panel.opts = o;

    let emailOn = true; // until the status says otherwise
    let dateTouched = editing; // a scheduled invoice keeps the due date it has
    const when = () => panel.overlay.querySelector('input[name="sp-when"]:checked').value;

    /* The day it goes, and the instant (null for now). */
    function goes() {
      if (when() === 'now') return { day: LSCUtil.today(), at: null };
      const at = instantOf(q('sp-day').value, q('sp-time').value);
      return { day: at ? ymdOf(at) : q('sp-day').value, at };
    }

    function refresh() {
      q('sp-at').hidden = when() === 'now';
      const g = goes();
      const field = q('sp-date');
      if (field && C.isDate(g.day)) {
        field.min = g.day;
        if (!dateTouched) field.value = C.addDays(g.day, date.days);
        q('sp-date-hint').textContent = date.hint(g.day, field.value);
      }
      const to = q('sp-to').value.trim();
      const goesAt = g.at ? whenText(g.at.toISOString()) : 'now';
      q('sp-summary').textContent = !emailOn && !editing ? ''
        : (g.at || when() === 'now') && to
          ? 'Goes ' + goesAt + ' to ' + to + '.' + (g.at ? ' You can change or cancel it until then.' : '')
          : '';
    }

    function setWorking(button, spin, on) {
      panel.working = on;
      ['sp-ok', 'sp-cancel', 'sp-copy'].forEach((id) => {
        const b = q(id);
        if (b) b.disabled = on || (id === 'sp-ok' && !emailOn && !editing);
      });
      if (spin) spin.style.display = on ? 'inline-block' : 'none';
    }

    function fail(message, fieldId) {
      q('sp-error').textContent = message;
      if (fieldId && q(fieldId)) q(fieldId).focus();
    }

    function refusal(err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') {
        close(false);
        return null;
      }
      return err.kind === 'network' ? 'The server is unreachable. Nothing was sent.' : (err.message || 'The server refused.');
    }

    /* What the form says, checked, or null with the reason shown. */
    function read() {
      q('sp-error').textContent = '';
      const to = q('sp-to').value.trim();
      if (!EMAIL_RE.test(to)) return fail(to ? 'That email address isn’t valid.' : 'Type the client’s email address.', 'sp-to');
      const g = goes();
      if (when() === 'later') {
        if (!g.at) return fail('Choose the date and time to send it.', C.isDate(q('sp-day').value) ? 'sp-time' : 'sp-day');
        if (g.at.getTime() <= Date.now()) return fail('That time has passed. Choose a later one, or Now.', 'sp-time');
        if (g.at.getTime() - Date.now() > YEAR_MS) return fail('Schedule it within a year.', 'sp-day');
      }
      const body = { to, message: q('sp-msg').value };
      if (g.at) body.scheduledFor = g.at.toISOString();
      const field = q('sp-date');
      if (field) {
        if (!C.isDate(field.value)) return fail('Choose the ' + date.label.toLowerCase() + ' date.', 'sp-date');
        if (field.value < g.day) return fail(date.label + ' can’t be before the day it’s sent.', 'sp-date');
        body[date.key] = field.value;
      }
      return body;
    }

    q('sp-cancel').addEventListener('click', () => close(true));
    panel.overlay.querySelectorAll('input[name="sp-when"]').forEach((r) => r.addEventListener('change', () => {
      refresh();
      if (when() === 'later') q('sp-day').focus();
    }));
    ['sp-day', 'sp-time', 'sp-to'].forEach((id) => q(id).addEventListener('input', refresh));
    if (q('sp-date')) q('sp-date').addEventListener('input', () => { dateTouched = true; refresh(); });

    q('sp-ok').addEventListener('click', async () => {
      if (panel.working) return;
      const body = read();
      if (!body) return;
      setWorking(q('sp-ok'), q('sp-spin'), true);
      try {
        if (editing) {
          const patch = { to: body.to, message: body.message, scheduledFor: body.scheduledFor || new Date().toISOString() };
          if (body[date.key] !== undefined) patch[date.key] = body[date.key];
          const reply = await o.save(patch);
          close(true);
          Toast.ok(body.scheduledFor ? 'Changed. It goes ' + whenText(body.scheduledFor) + '.' : 'Sending now.');
          o.done(reply, 'edit');
        } else {
          const reply = await o.send(Object.assign({ by: 'email' }, body));
          close(false);
          Toast.ok(o.done(reply, 'email') || (body.scheduledFor ? 'Scheduled for ' + whenText(body.scheduledFor) + '.' : 'Sending now.'));
        }
      } catch (err) {
        const message = refusal(err);
        if (message === null) return;
        setWorking(q('sp-ok'), q('sp-spin'), false);
        fail(message);
      }
    });

    const copy = q('sp-copy');
    if (copy) {
      copy.addEventListener('click', () => {
        if (panel.working) return;
        q('sp-error').textContent = '';
        const field = q('sp-date');
        const body = { by: 'link' };
        if (field) {
          if (!C.isDate(field.value) || field.value < LSCUtil.today()) return fail(date.label + ' can’t be before today.', 'sp-date');
          body[date.key] = field.value;
        }
        setWorking(copy, q('sp-copy-spin'), true);
        const request = o.send(body);
        // In the click, before anything is awaited (the header says why).
        const copied = copyText(request.then((reply) => linkFor(o.docKind, o.tokenOf(reply))));
        request.then(async (reply) => {
          const ok = await copied;
          const said = o.done(reply, 'link') || 'It’s live.';
          if (ok) {
            close(false);
            Toast.ok('Link copied. ' + said);
          } else {
            showLink(panel.opener, linkFor(o.docKind, o.tokenOf(reply)), said);
          }
        }, (err) => {
          const message = refusal(err);
          if (message === null) return;
          setWorking(copy, q('sp-copy-spin'), false);
          fail(message);
        });
        return undefined;
      });
    }

    refresh();
    q('sp-to').focus();
    if (!editing) {
      // Email that isn't set up would fail at the server: say so now, and
      // leave Copy link as the way to send it.
      LSCApi.get('/api/email/status').then((status) => {
        if (panel.opts !== o || status.configured) return;
        emailOn = false;
        const note = q('sp-email-off');
        note.hidden = false;
        note.innerHTML = 'Email isn’t set up yet, so it can’t be sent from here. Copy the link and send it yourself, or connect email in ' +
          '<button type="button" class="sp-inline-link" id="sp-settings">Settings → Email</button>.';
        q('sp-settings').addEventListener('click', () => {
          close(false);
          LSCRouter.go('/settings/email');
        });
        q('sp-ok').disabled = true;
        refresh();
      }, () => {}); // unknown: the server still refuses if it isn't
    }
  }

  /**
   * Binds a container's status-line buttons (Change, Cancel email, Retry).
   * `edit(sendId, button)` opens the panel to change it; cancel and retry go
   * straight to the queue, and `changed()` then redraws.
   */
  function bindStatus(container, handlers) {
    container.querySelectorAll('[data-send-act]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.send;
      const act = b.dataset.sendAct;
      if (act === 'edit') return handlers.edit(id, b);
      if (b.disabled) return undefined;
      b.disabled = true;
      Toast.working(act === 'retry' ? 'Sending again…' : 'Cancelling the email…');
      try {
        await LSCApi.post('/api/sends/' + encodeURIComponent(id) + '/' + act);
        Toast.ok(act === 'retry' ? 'Sending again now.' : 'Email cancelled.' + (handlers.cancelled ? ' ' + handlers.cancelled : ''));
        handlers.changed();
      } catch (err) {
        if (!(err instanceof LSCApi.ApiError)) throw err;
        Toast.hide();
        if (err.kind === 'auth') return handlers.authLost();
        // Gone out, or going, meanwhile: the redraw shows where it got to.
        handlers.error(err.kind === 'network' ? 'The server is unreachable.' : err.message);
        handlers.changed();
      } finally {
        if (b.isConnected) b.disabled = false;
      }
      return undefined;
    }));
  }

  /* An email due now or going: the outbox sends it within seconds, so the
     screen looks again shortly instead of reading "scheduled" until it is
     next drawn. */
  const settling = (sends) => sends.some((s) => s && (s.status === 'sending' ||
    (s.status === 'scheduled' && Date.parse(s.scheduledFor) <= Date.now() + 10000)));

  /**
   * Calls `refresh` again in a moment while any of `sends` is settling, up to
   * five times (an SMTP server that hangs mustn't keep it polling). Returns
   * the follow-up's timer, which the caller clears when it draws again.
   */
  function follow(sends, refresh, tries) {
    if (!settling(sends) || tries >= 5) return null;
    return setTimeout(() => {
      // Not under an open dialog: its opener would be drawn away.
      if (!document.querySelector('#app-view .modal-overlay.open')) refresh(tries + 1);
    }, 2000);
  }

  return { open, close, copyLink, statusOf, statusMarkup, bindStatus, whenText, linkFor, follow };
})();
