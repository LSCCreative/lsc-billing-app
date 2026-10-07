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
 *
 * AN ACTION (ui-clarity task 5)
 * ok/error/working take an optional { action: { label, run } }, which adds one
 * button to the toast: Undo, after a clause is deleted. A toast with an action
 * stays 10 seconds instead of 5, and never goes while the pointer is over it or
 * focus is in it, so there is time to reach the button. Choosing it hides the
 * toast and calls run(). The next toast replaces the action with its own (or
 * none): an Undo only ever undoes the thing its message names.
 */

const Toast = (() => {
  const PLAIN_MS = 5000;
  const ACTION_MS = 10000;

  let els = null;
  let timer = null;
  let action = null; // the current toast's { label, run }, or null
  let held = false; // pointer over it, or focus in it
  let lasts = 0; // how long the current toast stays once let go of

  function init() {
    const root = document.getElementById('export-toast');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.hidden = true;
    root.appendChild(btn);
    els = { root, dot: root.querySelector('#toast-dot'), msg: root.querySelector('#toast-msg'), btn };

    btn.addEventListener('click', () => {
      const run = action && action.run;
      hide();
      if (run) run();
    });
    const hold = () => {
      held = true;
      clearTimeout(timer);
    };
    const release = () => {
      held = false;
      if (lasts && els.root.classList.contains('show')) arm(lasts);
    };
    root.addEventListener('pointerenter', hold);
    root.addEventListener('pointerleave', () => {
      if (!root.contains(document.activeElement)) release();
    });
    root.addEventListener('focusin', hold);
    root.addEventListener('focusout', (e) => {
      if (!root.contains(e.relatedTarget) && !root.matches(':hover')) release();
    });
  }

  function arm(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!held) hide();
    }, ms);
  }

  function show(message, type, opts) {
    if (!els) return;
    els.msg.textContent = message;
    els.root.className = 'export-toast show ' + (type || '');
    els.dot.className = 'toast-dot ' + (type || '');
    action = (opts && opts.action) || null;
    els.btn.hidden = !action;
    els.btn.textContent = action ? action.label : '';
    clearTimeout(timer);
    // A neutral "working on it" toast stays until its outcome replaces it.
    lasts = type === 'ok' || type === 'err' ? (action ? ACTION_MS : PLAIN_MS) : 0;
    if (lasts && !held) arm(lasts);
  }

  function hide() {
    if (!els) return;
    clearTimeout(timer);
    // Focus on the Undo button would be left on nothing: hand it to the page.
    const hadFocus = els.root.contains(document.activeElement);
    els.root.classList.remove('show');
    action = null;
    els.btn.hidden = true;
    held = false;
    lasts = 0;
    if (hadFocus) document.activeElement.blur();
  }

  return {
    init,
    ok: (message, opts) => show(message, 'ok', opts),
    error: (message, opts) => show(message, 'err', opts),
    working: (message, opts) => show(message, '', opts),
    hide,
  };
})();
