'use strict';

/* The info control: a small "i" button that opens a short explanation.
 *
 * Two are required by name (DESIGN_BRIEF, Accessibility): the Dashboard's floor
 * comparison and the Depreciation tab's two-numbers split. Both explanations
 * carry real money meaning, so the contract is:
 *
 *   - A <button>, never a hover target or a title attribute. Hover-only is
 *     unreachable by keyboard and does nothing on touch.
 *   - Its accessible name says what it explains ("How the floor comparison
 *     works"), not "info".
 *   - aria-expanded + aria-controls: this is a disclosure, not a dialog. It
 *     doesn't trap focus or darken the page; it's a note you can open.
 *   - The popover follows the button in the DOM, so it is next in reading order
 *     and Tab moves straight into it (tabindex="0" — while it's `hidden`, it
 *     isn't focusable at all). Escape closes it and puts focus back on the
 *     trigger. Moving focus anywhere else, or clicking elsewhere, closes it.
 *   - Hover (a real mouse only) opens it too, as a convenience: a short delay
 *     in, a slightly longer one out so the pointer can cross the gap to the
 *     popover. A hover-opened popover that is then clicked is pinned open.
 *
 * ALL SPANS, ON PURPOSE
 * The markup is phrasing content from top to bottom — the popover and its
 * paragraphs are <span>s styled as blocks — so the control can sit inside a
 * heading or a sentence (both of today's call sites do) without producing an
 * invalid <div> inside an <h2> or <p>.
 *
 * FIXED, NOT ABSOLUTE
 * Its first home is an .est-block head, and .est-block is overflow:hidden — an
 * absolutely positioned popover would be clipped at the block edge. position:
 * fixed, placed from the button's rect on open and on every scroll or resize
 * while open, escapes that. (It would be caught by a transformed ancestor;
 * nothing in #main has one — keep it that way, or move this to <body>.)
 *
 * One controller for the whole document, installed once at load; views only
 * call markup(). Views re-render with innerHTML all the time, so nothing here
 * holds on to an element past the popover it currently has open, and a
 * popover whose button has left the document is simply forgotten.
 */

const LSCInfo = (() => {
  const { esc } = LSCUtil;

  const HOVER_IN_MS = 150;
  const HOVER_OUT_MS = 250;
  const EDGE = 16; // px kept clear of the viewport edge
  const GAP = 8; // px between the button and the popover

  let open = null; // { btn, pop, mode: 'pinned' | 'peek' }
  let hoverTimer = null;

  /**
   * @param {object} o
   * @param {string} o.id — unique on the page; the popover's id is derived.
   * @param {string} o.label — the button's accessible name, e.g. "How the
   *   floor comparison works". Plain text.
   * @param {string} o.title — the popover's caption. Plain text.
   * @param {string[]} o.paragraphs — HTML, already escaped by the caller
   *   (they may carry <strong>). Rendered as block spans, see ALL SPANS.
   */
  function markup(o) {
    const popId = 'info-' + o.id;
    return (
      '<span class="info">' +
      '<button type="button" class="info-btn" aria-expanded="false" aria-controls="' + esc(popId) + '"' +
      ' aria-label="' + esc(o.label) + '"><span aria-hidden="true">i</span></button>' +
      '<span class="info-pop" id="' + esc(popId) + '" role="region" aria-labelledby="' + esc(popId) + '-t"' +
      ' tabindex="0" hidden>' +
      '<span class="info-pop-t" id="' + esc(popId) + '-t">' + esc(o.title) + '</span>' +
      o.paragraphs.map((p) => '<span class="info-pop-p">' + p + '</span>').join('') +
      '</span></span>'
    );
  }

  const popFor = (btn) => document.getElementById(btn.getAttribute('aria-controls'));

  /* Below the button, left edges roughly aligned, clamped inside the
     viewport. --info-nub-x puts the notch under the button wherever the clamp
     moved the box to.

     Flipped above only when the button sits in the bottom third of the
     viewport and there is room above. It used to flip whenever the popover
     didn't fit below, which on the Dashboard (less than ~340px under the
     comparison's button) opened it upward over the Half Day floor — covering
     the figures it explains (design review, should-fix 6). Below is the
     reading order, and a popover running off the bottom is fine: it is
     re-placed on scroll, so scrolling the page brings the rest into view.

     The side is chosen once, when the popover opens (open.flip), not on every
     scroll: re-deciding as the button crossed the two-thirds line would make
     the popover jump from one side to the other under the reader's eyes. */
  function place() {
    if (!open) return;
    if (!open.btn.isConnected) {
      open = null;
      return;
    }
    const { btn, pop } = open;
    const r = btn.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - EDGE * 2);
    pop.style.width = width + 'px';

    const left = Math.max(EDGE, Math.min(r.left - 14, window.innerWidth - EDGE - width));
    const h = pop.offsetHeight;
    const below = r.bottom + GAP;
    const above = r.top - GAP - h;
    if (open.flip === undefined) open.flip = r.top > (window.innerHeight * 2) / 3 && above >= EDGE;
    const flip = open.flip;

    pop.style.left = left + 'px';
    pop.style.top = (flip ? above : below) + 'px';
    pop.classList.toggle('info-pop-above', flip);
    pop.style.setProperty('--info-nub-x', Math.round(r.left + r.width / 2 - left) + 'px');
  }

  function show(btn, mode) {
    if (open && open.btn === btn) {
      open.mode = mode === 'pinned' ? 'pinned' : open.mode;
      return;
    }
    close(false);
    const pop = popFor(btn);
    if (!pop) return;
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    open = { btn, pop, mode };
    place();
  }

  function close(returnFocus) {
    clearTimeout(hoverTimer);
    if (!open) return;
    const { btn, pop } = open;
    open = null;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus && btn.isConnected) btn.focus();
  }

  const inside = (node) => Boolean(open && node && (open.btn.contains(node) || open.pop.contains(node)));

  function install() {
    document.addEventListener('click', (event) => {
      const btn = event.target.closest && event.target.closest('.info-btn');
      if (btn) {
        // A second click on a pinned popover's button closes it; a click on a
        // hover-opened one pins it, since that's what the click was asking for.
        if (open && open.btn === btn && open.mode === 'pinned') close(false);
        else show(btn, 'pinned');
        return;
      }
      if (open && !inside(event.target)) close(false);
    });

    /* Capture, so a view's own Escape handling can't swallow it first, and
       stopped here only when there was a popover to close — an open modal
       behind it then keeps its own Escape for the next press. */
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        close(true);
      },
      true
    );

    document.addEventListener('focusin', (event) => {
      if (open && !inside(event.target)) close(false);
    });

    document.addEventListener('pointerover', (event) => {
      if (event.pointerType !== 'mouse') return;
      const btn = event.target.closest && event.target.closest('.info-btn');
      if (btn) {
        clearTimeout(hoverTimer);
        if (open && open.btn === btn) return;
        hoverTimer = setTimeout(() => show(btn, 'peek'), HOVER_IN_MS);
        return;
      }
      if (open && open.mode === 'peek' && inside(event.target)) clearTimeout(hoverTimer);
    });

    document.addEventListener('pointerout', (event) => {
      if (event.pointerType !== 'mouse') return;
      const leaving = event.target.closest && event.target.closest('.info-btn');
      // Leaving a button that hasn't opened yet cancels the pending open.
      if (leaving && (!open || open.btn !== leaving)) {
        clearTimeout(hoverTimer);
        return;
      }
      if (!open || open.mode !== 'peek' || !inside(event.target) || inside(event.relatedTarget)) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        if (open && open.mode === 'peek') close(false);
      }, HOVER_OUT_MS);
    });

    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
  }

  install();

  return { markup, close };
})();
