'use strict';

/* Small shared helpers. `fmt` and `esc` are ported from the desktop app so
 * money and escaped text render character-for-character as they did there. */

const LSCUtil = (() => {
  /* Verbatim from the old index.html: two decimals, thousands separators. */
  function fmt(n) {
    return '$' + (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* A price in a sentence or an option: whole dollars without the cents
     ("$1,120": every auto hourly price, and most typed ones), anything else to
     the cent, as fmt. The Rate Card's "↺ use $1,120" and the estimator's
     "Full day · $1,120" both read it, so they can't format one price two ways. */
  function money(n) {
    return Number.isInteger(n) ? '$' + n.toLocaleString('en-AU') : fmt(n);
  }

  /* A per-km price (the car's km line, task 6b): to the cent when it is whole
     cents, otherwise exactly — up to four places, as calc.js keeps it — so a
     GST-inclusive $0.968 isn't shown as $0.97 while 120 km bill at $0.968. */
  function perKm(n) {
    const cents = n * 100;
    const whole = Math.abs(cents - Math.round(cents)) < 1e-9;
    return (whole ? fmt(n) : '$' + String(Math.round(n * 1e4) / 1e4)) + '/km';
  }

  /* The desktop version left `'` alone, which was safe only because every
     attribute it built was double-quoted. Escaping it too costs nothing and
     removes the need to remember that. */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Local date, not UTC. The desktop app used toISOString().slice(0,10), which
     in Australian time zones returns yesterday for most of the working day —
     so a new estimate opened in the morning was dated the day before, and that
     date goes onto the invoice. */
  function today() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  const abnDigits = (value) => String(value || '').replace(/\s/g, '');

  /* The ATO's published check: subtract 1 from the first digit, weight, and the
     sum must divide by 89. Catches a transposed or mistyped digit before it is
     printed on an invoice. */
  function abnValid(digits) {
    if (!/^\d{11}$/.test(digits)) return false;
    const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const sum = digits.split('').reduce((acc, d, i) => acc + (Number(d) - (i === 0 ? 1 : 0)) * weights[i], 0);
    return sum % 89 === 0;
  }

  /* Stored as bare digits, shown grouped as the ABN Lookup prints it. */
  function abnFormat(value) {
    const digits = abnDigits(value);
    return /^\d{11}$/.test(digits) ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : digits;
  }

  /* Field-level validation state, shared by every form so they all flag bad
     input the same way. `found` is [{ msg, field }] — field an element (or
     null for a problem no single input owns). Each message becomes its own
     <span id> inside the form's role="alert" box, which reads exactly as the
     old space-joined sentence did, and each named field (or each of `fields`,
     when one sentence covers several inputs) gets
     aria-invalid="true" plus aria-describedby pointing at *its* sentence, so a
     screen reader tabbing back into the form hears why that field is wrong.
     The flag clears on the field's own next edit; the summary stays until the
     next save attempt, like it always has. Focus goes to the first flagged
     field so nobody has to hunt for it. */
  function showFieldErrors(box, found, lead) {
    if (!box) return;
    clearFieldErrors(box);
    box.textContent = lead ? lead + ' ' : '';
    let first = null;
    found.forEach((p, i) => {
      const span = document.createElement('span');
      span.id = box.id + '-' + i;
      span.textContent = p.msg;
      if (i) box.append(' ');
      box.append(span);
      (p.fields || [p.field]).forEach((field) => {
        if (!field) return;
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('data-err-box', box.id);
        const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        if (ids.indexOf(span.id) === -1) ids.push(span.id);
        field.setAttribute('aria-describedby', ids.join(' '));
        field.addEventListener('input', clearField);
        field.addEventListener('change', clearField);
        if (!first) first = field;
      });
    });
    box.classList.add('show');
    if (first) first.focus();
  }

  function unflag(field, boxId) {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('data-err-box');
    field.removeEventListener('input', clearField);
    field.removeEventListener('change', clearField);
    const ids = (field.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id.indexOf(boxId + '-') !== 0);
    if (ids.length) field.setAttribute('aria-describedby', ids.join(' '));
    else field.removeAttribute('aria-describedby');
  }

  function clearField(event) {
    const field = event.currentTarget;
    unflag(field, field.getAttribute('data-err-box') || '');
  }

  /* Clears the box and every field it flagged. Safe to call when neither exists. */
  function clearFieldErrors(box) {
    if (!box) return;
    document.querySelectorAll('[data-err-box="' + box.id + '"]').forEach((f) => unflag(f, box.id));
    box.textContent = '';
    box.classList.remove('show');
  }

  /* Hand a Blob to the browser as a download. Moved here from
     estimate-detail.js when the depreciation CSV became its second caller. */
  function saveFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking in the same tick can cancel the download in Safari and Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* Speak a figure that recomputes as the user types, once typing pauses.
     `region` is a visually hidden aria-live="polite" element (class
     sr-only, a11y.css) that the screen rendered empty with the rest of its
     markup — a live region inserted already holding its text is not reliably
     announced, so each caller owns one from the start rather than this
     creating it on first use.

     Why not aria-live on the visible figure itself: it repaints on every
     keystroke, so typing 1,776 would read out 1, 17, 177 and 1,776 in turn.
     This waits a second after the last call and writes once. The same text
     twice is not a change, so nothing is re-announced when an edit leaves the
     figure where it was. Finance decision 74 named this shape; the Finance &
     Price brief made it a requirement (2026-09-28). */
  const ANNOUNCE_AFTER_MS = 1000;
  const announceTimers = new WeakMap();
  function announce(region, text) {
    if (!region) return;
    clearTimeout(announceTimers.get(region));
    announceTimers.set(
      region,
      setTimeout(() => {
        if (region.isConnected) region.textContent = text;
      }, ANNOUNCE_AFTER_MS)
    );
  }

  return { fmt, money, perKm, esc, today, num, abnDigits, abnValid, abnFormat, showFieldErrors, clearFieldErrors, saveFile, announce };
})();
