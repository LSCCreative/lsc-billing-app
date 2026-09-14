'use strict';

/* The focus trap every modal in this app shares.
 *
 * WHY IT MOVED HERE
 * It was written and verified inside views/settings.js, where it was the only
 * modal in the app. The Overhead screen's Add/Edit Expense dialog is the
 * second, and TASKS.md's cost-breakdown modal will be the third. TASKS.md's
 * accessibility pass asks every new modal to "reuse the exact focus-trap
 * implementation in web/js/views/settings.js" rather than re-derive one —
 * three copies would be three chances for them to disagree about what counts
 * as focusable, which is exactly the kind of drift that makes a keyboard user's
 * experience differ per dialog for no stated reason.
 *
 * WHAT CHANGED IN THE MOVE
 * Two things, both deliberate:
 *   1. The container is an argument now instead of a closed-over module-level
 *      `overlay`. That is the whole reason it can be shared.
 *   2. `select` joined the focusable selector. Invoice Settings has no <select>
 *      so this is inert there, but Overhead's modal has two (category and
 *      frequency) and they have to be able to act as trap boundaries.
 * The trapping logic itself is byte-for-byte the behaviour settings.js shipped.
 */

const LSCModal = (() => {
  /* Every element in the box a keyboard user can land on, in DOM order.
     Recomputed on each Tab rather than cached, because a modal can enable or
     disable controls while it is open — Invoice Settings does exactly that on
     the GST toggle — and that changes this set. offsetParent screens out
     anything hidden by a collapsed section or display:none. */
  function focusable(container) {
    return Array.prototype.filter.call(
      container.querySelectorAll('input, textarea, select, button, [tabindex]'),
      (el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null
    );
  }

  /* Tab and Shift+Tab wrap inside the box instead of escaping to whatever
     #main happens to render behind it. Without this, a keyboard user tabbing
     off the last field lands on the screen underneath — reachable and even
     usable, invisibly, while a modal dialog is supposedly on screen.

     The `!container.contains(active)` arm catches focus that is already outside
     the box (the browser put it on <body>, or something else moved it) and
     pulls it back in on the next Tab rather than letting it walk the page. */
  function trapTab(container, event) {
    if (event.key !== 'Tab') return;
    const els = focusable(container);
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  return { focusable, trapTab };
})();
