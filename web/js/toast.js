'use strict';

/* The corner toast, ported from the desktop app's showToast.
 *
 * It confirms what happened after a write; it is not where failures are
 * explained. A save that fails also leaves the button in a failed state next to
 * the form the user is still looking at, because a message that disappears
 * after five seconds is not somewhere a lost edit can be recovered from.
 *
 * role="status" rather than "alert": a successful save should not interrupt a
 * screen reader mid-sentence.
 */

const Toast = (() => {
  let els = null;
  let timer = null;

  function init() {
    const root = document.getElementById('export-toast');
    els = { root, dot: root.querySelector('#toast-dot'), msg: root.querySelector('#toast-msg') };
  }

  function show(message, type) {
    if (!els) return;
    els.msg.textContent = message;
    els.root.className = 'export-toast show ' + (type || '');
    els.dot.className = 'toast-dot ' + (type || '');
    clearTimeout(timer);
    // A neutral "working on it" toast stays until its outcome replaces it.
    if (type === 'ok' || type === 'err') {
      timer = setTimeout(() => els.root.classList.remove('show'), 5000);
    }
  }

  function hide() {
    if (!els) return;
    clearTimeout(timer);
    els.root.classList.remove('show');
  }

  return {
    init,
    ok: (message) => show(message, 'ok'),
    error: (message) => show(message, 'err'),
    working: (message) => show(message, ''),
    hide,
  };
})();
