'use strict';

/* Small shared helpers. `fmt` and `esc` are ported from the desktop app so
 * money and escaped text render character-for-character as they did there. */

const LSCUtil = (() => {
  /* Verbatim from the old index.html: two decimals, thousands separators. */
  function fmt(n) {
    return '$' + (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

  return { fmt, esc, today, num, abnDigits, abnValid, abnFormat };
})();
