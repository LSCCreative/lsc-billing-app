'use strict';

/* The collapsible panel (ui-clarity task 2; markup in app.css's Panels
 * comment). One delegated listener turns every .panel-toggle in the app: it
 * flips aria-expanded, hides or shows the body it controls, and marks the
 * panel .is-collapsed. The body is hidden, never removed, so its inputs stay
 * in the DOM for a screen's collect() and unsaved-changes guard.
 *
 * A screen that remembers states or opens a panel from elsewhere (the
 * editor's jump rail, task 12) listens for `lsc:panel` on the panel, whose
 * detail is { open }, and calls LSCPanel.setOpen. */

const LSCPanel = (() => {
  function isOpen(toggle) {
    return toggle.getAttribute('aria-expanded') !== 'false';
  }

  function setOpen(target, open) {
    const panel = target.closest('.panel');
    const toggle = target.classList.contains('panel-toggle') ? target : panel && panel.querySelector('.panel-toggle');
    if (!toggle || isOpen(toggle) === open) return;
    toggle.setAttribute('aria-expanded', String(open));
    const body = document.getElementById(toggle.getAttribute('aria-controls'));
    if (body) body.hidden = !open;
    if (panel) {
      panel.classList.toggle('is-collapsed', !open);
      panel.dispatchEvent(new CustomEvent('lsc:panel', { bubbles: true, detail: { open } }));
    }
  }

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.panel-toggle');
    if (toggle) setOpen(toggle, !isOpen(toggle));
  });

  return { setOpen, isOpen };
})();
