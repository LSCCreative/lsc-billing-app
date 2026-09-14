'use strict';

/* The Invoice Settings modal — the business identity, GST configuration and
 * payment details that print on an invoice.
 *
 * Ported from openInvoiceSettingsModal in the desktop app, which read and wrote
 * a flat object in localStorage['lsc-invoice-settings']. Three things changed.
 *
 * WHERE IT LIVES
 * GET/PUT /api/settings. The desktop copy was one browser-data wipe from gone
 * (DESIGN_BRIEF.md's opening paragraph) and it was per-machine, so the same
 * bank details had to be retyped on any other computer.
 *
 * THE SHAPE CHANGED
 * The old flat { bankName, accountName, bsb, accountNumber, paymentTerms } now
 * lives under settings.payment, where `paymentTerms` is called `terms`. The PDF
 * reads the nested form (the payment block in server/src/pdf.js), so this screen
 * writes that shape and not the old one — the same translation the client
 * snapshot needed.
 *
 * GST IS HERE BECAUSE NOTHING ELSE COULD SET IT
 * calc.js reads settings.gst on every estimate: whether GST is added on top,
 * backed out of a GST-inclusive price, or absent entirely. No screen could
 * change it, so the app was pinned to the `registered: false` default and the
 * GST half of the money model was unreachable. The desktop modal had no GST
 * because the desktop app had no GST.
 *
 * SAVING MERGES, IT DOES NOT REPLACE
 * PUT /api/settings writes the request body over the whole settings row. This
 * modal owns `gst` and `payment` and nothing else, so it PUTs those merged onto
 * a freshly-read copy of the rest. Sending only the two would silently drop the
 * others — and dropping `gst` would change the money on every estimate saved
 * afterwards, from a screen that never mentions it. (It now owns `business`
 * too, since a tax invoice has to print the ABN — but still not `paths`.)
 *
 * That is also why it reads fresh on open rather than from LSCData's cache: the
 * merge is only as good as what it merges onto, and the cache holds a snapshot
 * from boot. The Pricing screen can edit from the cache safely because it owns
 * every key it writes; this one does not.
 */

const SettingsView = (() => {
  const { esc, num, abnDigits, abnValid, abnFormat } = LSCUtil;

  let overlay = null;
  let handlers = null;
  let loaded = null; // settings as the server last gave them — the merge base
  let form = null; // the working copy this modal edits
  let saving = false;
  let baseline = ''; // form as it was loaded, for the unsaved-edit check
  let unwatch = null; // LSCApi.subscribe handle, live only while open
  let opener = null; // the control that opened it, to hand focus back to

  const $ = (id) => overlay.querySelector('#' + id);

  /* The stored rate is a fraction and the field shows a percent. Snapped for the
     same reason the Pricing screen snaps its tax rate: a plain ×100 puts the
     float error on screen, rendering 0.07 as 7.000000000000001. */
  const toPercent = (rate) => String(Math.round(num(rate) * 1e8) / 1e6);

  /* The working copy as it stands, for the unsaved-edit check. `form` holds
     exactly what the fields show, untrimmed, so this compares what the user
     typed rather than what a save would send. */
  const snapshot = () => JSON.stringify(form);

  // ── Markup ────────────────────────────────────────────────────────────────

  function shell(body) {
    return (
      '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="settings-title">' +
      '<div class="modal-title" id="settings-title">Invoice Settings</div>' +
      body +
      '</div>'
    );
  }

  function formMarkup() {
    const gstOff = !form.registered;

    return shell(
      '<div class="set-group">' +
        '<div class="set-group-head">Business</div>' +
        '<p class="set-hint">Printed under the logo on quotes and invoices. A tax invoice must show ' +
        'your ABN, so an invoice that charges GST won’t export without one.</p>' +
        '<div class="form-grid">' +
          '<div class="field"><label for="set-biz-name">Legal / Business Name</label>' +
          '<input id="set-biz-name" type="text" placeholder="e.g. Lachlan Sullivan-Carey" value="' +
          esc(form.businessName) + '"></div>' +
          '<div class="field"><label for="set-abn">ABN</label>' +
          '<input id="set-abn" type="text" inputmode="numeric" placeholder="e.g. 51 824 753 556" value="' +
          esc(form.abn) + '"></div>' +
        '</div>' +
      '</div>' +

      '<div class="set-group">' +
        '<div class="set-group-head">GST</div>' +
        '<label class="set-check"><input type="checkbox" id="set-gst-reg"' +
        (form.registered ? ' checked' : '') +
        '><span>Registered for GST</span></label>' +
        '<p class="set-hint">Off means invoices show no GST line at all, exactly as the desktop app behaved.</p>' +
        '<div class="set-row' + (gstOff ? ' set-row-off' : '') + '" id="set-gst-detail">' +
          '<div class="field"><label for="set-gst-rate">GST Rate (%)</label>' +
          '<input type="number" id="set-gst-rate" min="0" max="100" step="0.5" value="' +
          esc(form.rateRaw) + '"' + (gstOff ? ' disabled' : '') + '></div>' +
          '<label class="set-check"><input type="checkbox" id="set-gst-inc"' +
          (form.pricesIncludeGst ? ' checked' : '') + (gstOff ? ' disabled' : '') +
          '><span>The rates I enter already include GST</span></label>' +
        '</div>' +
        '<p class="set-hint">Leave that unticked if your rate card is GST-exclusive — GST is then added on ' +
        'top of the client price. Ticked, it is backed out of the rates instead, and the client total ' +
        'stays what the rate card says.</p>' +
      '</div>' +

      '<div class="set-group">' +
        '<div class="set-group-head">Payment Details</div>' +
        '<p class="set-hint">Printed on invoices only. A quote never shows them, and a block left ' +
        'blank is left off the document entirely.</p>' +
        '<div class="form-grid">' +
          '<div class="field"><label for="set-bank-name">Bank Name</label>' +
          '<input id="set-bank-name" type="text" placeholder="e.g. Commonwealth Bank" value="' +
          esc(form.bankName) + '"></div>' +
          '<div class="field"><label for="set-account-name">Account Name</label>' +
          '<input id="set-account-name" type="text" placeholder="e.g. LSC Creative Pty Ltd" value="' +
          esc(form.accountName) + '"></div>' +
          '<div class="field"><label for="set-bsb">BSB</label>' +
          '<input id="set-bsb" type="text" placeholder="e.g. 062-000" value="' + esc(form.bsb) + '"></div>' +
          '<div class="field"><label for="set-account-num">Account Number</label>' +
          '<input id="set-account-num" type="text" placeholder="e.g. 12345678" value="' +
          esc(form.accountNumber) + '"></div>' +
          '<div class="field full"><label for="set-terms">Payment Terms</label>' +
          '<textarea id="set-terms" placeholder="e.g. Strictly 14 Days — EFT only. Please reference invoice number.">' +
          esc(form.terms) + '</textarea></div>' +
        '</div>' +
      '</div>' +

      '<div id="settings-error" role="alert"></div>' +
      '<div class="modal-actions">' +
        '<span class="saved-msg" id="settings-saved">✓ Settings saved</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="set-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-accent" id="set-save" data-write>' +
        '<span class="spinner" id="set-spin"></span><span id="set-save-label">Save Details</span>' +
        '</button>' +
      '</div>'
    );
  }

  // ── Errors and connection state ───────────────────────────────────────────

  function showError(message) {
    const el = $('settings-error');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    const el = $('settings-error');
    if (!el) return;
    el.textContent = '';
    el.classList.remove('show');
  }

  /* The connection banner is sticky under the app header at z-index 99, and this
     overlay sits at 9000 — so while the modal is open the banner is behind it and
     the user cannot see why Save went dead (connection.js blocks [data-write] in
     the capture phase, so the click never reaches a handler that could explain
     itself). Watching the same signal the banner watches is the documented way to
     do this; see the subscribe() note in web/README.md. */
  function watchConnection() {
    unwatch = LSCApi.subscribe((event) => {
      if (!overlay.classList.contains('open')) return;
      if (event.ok || (event.kind !== 'network' && event.kind !== 'server')) {
        if ($('settings-error') && $('settings-error').dataset.source === 'connection') clearError();
        return;
      }
      const el = $('settings-error');
      if (!el) return;
      el.dataset.source = 'connection';
      showError(
        event.kind === 'network'
          ? 'Can’t reach the server, so these can’t be saved yet. Your edits are still here — try again once it’s back.'
          : 'The server ran into a problem, so these can’t be saved yet. Your edits are still here.'
      );
    });
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  /* Field edits write straight to the working copy rather than re-rendering, so
     typing never loses focus mid-word — the same rule the Pricing screen follows.
     Toggling GST off only enables or disables two controls, which is a targeted
     change, not a reason to rebuild the form and discard what is in it. */
  function bind() {
    const text = {
      'set-biz-name': 'businessName',
      'set-abn': 'abn',
      'set-bank-name': 'bankName',
      'set-account-name': 'accountName',
      'set-bsb': 'bsb',
      'set-account-num': 'accountNumber',
      'set-terms': 'terms',
    };
    Object.keys(text).forEach((id) => {
      $(id).addEventListener('input', function () {
        form[text[id]] = this.value;
      });
    });

    $('set-gst-rate').addEventListener('input', function () {
      form.rateRaw = this.value;
    });

    $('set-gst-inc').addEventListener('change', function () {
      form.pricesIncludeGst = this.checked;
    });

    $('set-gst-reg').addEventListener('change', function () {
      form.registered = this.checked;
      // Both only mean anything when registered — calc.js gates them on it — so
      // they go dead rather than sitting there looking like they do something.
      $('set-gst-rate').disabled = !this.checked;
      $('set-gst-inc').disabled = !this.checked;
      $('set-gst-detail').classList.toggle('set-row-off', !this.checked);
    });

    $('set-cancel').addEventListener('click', dismiss);
    $('set-save').addEventListener('click', save);
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  function problems() {
    const found = [];
    const abn = abnDigits(form.abn);
    if (abn && !abnValid(abn)) {
      found.push('That ABN doesn’t check out — it should be 11 digits, as shown on the ABN Lookup.');
    }
    // Registration without an ABN can't happen, and every GST-bearing invoice
    // would then refuse to export. Better to say so here than at export time.
    if (form.registered && !abn) {
      found.push('GST registration needs your ABN — add it under Business.');
    }
    // Only when it is switched on. A blank rate on an unregistered business is
    // an inert field, and blocking a save on it would be nagging about nothing.
    if (form.registered) {
      const percent = parseFloat(form.rateRaw);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        found.push('The GST rate must be a number between 0 and 100.');
      }
    }
    return found;
  }

  /* Merged onto `loaded` rather than sent alone: PUT /api/settings replaces the
     whole row, and this modal does not show every key in it. */
  function payload() {
    const percent = parseFloat(form.rateRaw);
    const usable = Number.isFinite(percent) && percent >= 0 && percent <= 100;

    return Object.assign({}, loaded, {
      business: Object.assign({}, loaded.business, {
        name: form.businessName.trim(),
        // Stored as bare digits; the PDF formats it for print.
        abn: abnDigits(form.abn),
      }),
      gst: Object.assign({}, loaded.gst, {
        registered: form.registered,
        // Not `parseFloat(v)/100 || 0.1`: 0 is falsy, so that idiom turns a
        // deliberate zero into ten percent. It is the bug the tax set-aside rate
        // had on the Pricing screen. An unusable value can only reach here while
        // unregistered, where it is inert, and keeping what was stored is more
        // honest than inventing a rate nobody typed.
        rate: usable ? percent / 100 : num(loaded.gst && loaded.gst.rate),
        pricesIncludeGst: form.pricesIncludeGst,
      }),
      payment: Object.assign({}, loaded.payment, {
        // Trimmed on the way out only — trimming as the user types eats the
        // space between two words the moment it is pressed.
        bankName: form.bankName.trim(),
        accountName: form.accountName.trim(),
        bsb: form.bsb.trim(),
        accountNumber: form.accountNumber.trim(),
        terms: form.terms.trim(),
      }),
    });
  }

  function setSaving(next) {
    saving = next;
    $('set-save').disabled = next;
    $('set-cancel').disabled = next;
    $('set-spin').style.display = next ? 'inline-block' : 'none';
    $('set-save-label').textContent = next ? 'Saving…' : 'Save Details';
  }

  async function save() {
    if (saving) return;
    clearError();

    const found = problems();
    if (found.length) {
      showError(found.join(' '));
      return;
    }

    const body = payload();
    setSaving(true);
    Toast.working('Saving settings…');

    try {
      const reply = await LSCApi.put('/api/settings', body);
      // Only now is this what estimates are priced against.
      LSCData.setSettings(reply.settings);
      loaded = reply.settings;
      // Nothing here is unsaved any more. close() prunes the watcher a moment
      // later anyway; this keeps the two from disagreeing in between.
      baseline = snapshot();
      Toast.ok('Invoice settings saved.');
      // An estimate open behind this modal computed its totals from the old GST
      // configuration and only recomputes on the next keystroke, so until the
      // user touched something it would sit there showing a total that no longer
      // matches what a save would store.
      EstimateEditor.refreshTotals();
      // And the estimates empty state, whose first-run checklist may still be
      // listing the invoice details this save has just filled in.
      EstimateList.refreshFirstRun();
      saving = false;
      close();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      // Left open: it sits inside #app-view, so it hides with the rest of the
      // app and comes back, edits intact, when the user signs in again.
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(
        err.kind === 'network'
          ? 'Couldn’t save — the server is unreachable. Your changes are still here; try again once it’s back.'
          : 'Couldn’t save: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  // ── Opening and closing ───────────────────────────────────────────────────

  /* Every element in the box a keyboard user can land on, in DOM order. Called
     fresh on each Tab rather than cached, because disabling the GST fields
     changes this set while the modal is open (registered ↔ unregistered). */
  function focusable() {
    return Array.prototype.filter.call(
      overlay.querySelectorAll('input, textarea, button, [tabindex]'),
      (el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null
    );
  }

  /* The focus trap: Tab and Shift+Tab wrap inside the box instead of escaping
     to whatever #main happens to render behind it. Without this, a keyboard
     user tabbing off the last field lands on the estimate editor underneath —
     reachable and even usable, invisibly, while a modal dialog is supposedly
     on screen. Escape-to-close and focus-return already existed; this is the
     rest of what TASKS.md's accessibility pass calls a real focus trap. */
  function trapTab(event) {
    if (event.key !== 'Tab') return;
    const els = focusable();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !overlay.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !overlay.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKeydown(event) {
    // Hidden behind the login screen after a lost session: Escape there must
    // not throw away the edits being kept for after sign-in, and Tab has
    // nothing in the modal to trap focus into anyway.
    if (overlay.closest('[hidden]')) return;
    // Escape closes, but not out from under a save that is already in flight.
    if (event.key === 'Escape' && !saving) return dismiss();
    trapTab(event);
  }

  /* The three ways a user throws this modal away: Cancel, Escape, and a click
     on the backdrop. close() itself stays unguarded, because a successful save
     calls it too and there is nothing to ask about then. */
  function dismiss() {
    if (!LSCUnsaved.confirmLeave('Closing this window')) return;
    close();
  }

  function close() {
    if (saving) return;
    overlay.classList.remove('open');
    overlay.innerHTML = '';
    document.removeEventListener('keydown', onKeydown);
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
    // Focus would otherwise land on <body>, leaving a keyboard user to tab from
    // the top of the document.
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  }

  async function open(viewHandlers, openedBy) {
    handlers = viewHandlers;
    opener = openedBy || null;
    saving = false;

    overlay.innerHTML = shell('<p class="set-loading">Loading your settings…</p>');
    overlay.classList.add('open');
    document.addEventListener('keydown', onKeydown);

    let settings;
    try {
      const reply = await LSCApi.get('/api/settings');
      settings = reply.settings || {};
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') {
        close();
        return handlers.onAuthLost();
      }
      // Opening on a stale cache would mean saving a merge onto figures that are
      // not what the server holds, which is the one thing this screen must not
      // do. Better to not open than to open wrong.
      overlay.innerHTML = shell(
        '<p class="set-loading">' +
          (err.kind === 'network'
            ? 'Couldn’t load your settings — the server is unreachable.'
            : 'Couldn’t load your settings: ' + esc(err.message || 'the server refused the request.')) +
          '</p><div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="set-cancel">Close</button></div>'
      );
      $('set-cancel').addEventListener('click', close);
      $('set-cancel').focus();
      return;
    }

    // Closed while the request was in flight.
    if (!overlay.classList.contains('open')) return;

    loaded = settings;
    const gst = settings.gst || {};
    const payment = settings.payment || {};
    const business = settings.business || {};
    form = {
      businessName: business.name || '',
      abn: abnFormat(business.abn),
      registered: gst.registered === true,
      rateRaw: toPercent(gst.rate),
      pricesIncludeGst: gst.pricesIncludeGst === true,
      bankName: payment.bankName || '',
      accountName: payment.accountName || '',
      bsb: payment.bsb || '',
      accountNumber: payment.accountNumber || '',
      terms: payment.terms || '',
    };

    baseline = snapshot();
    overlay.innerHTML = formMarkup();
    bind();
    watchConnection();
    LSCUnsaved.watch('invoice-settings', {
      label: 'your invoice settings',
      onScreen: () => Boolean(overlay && overlay.querySelector('#set-save')),
      dirty: () => snapshot() !== baseline,
    });
    $('set-biz-name').focus();
  }

  function init() {
    overlay = document.getElementById('modal-invoice-settings');
    // Clicking the backdrop closes, as it did on the desktop. The check keeps a
    // click that started inside the box from counting.
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });
  }

  return { init, open };
})();
