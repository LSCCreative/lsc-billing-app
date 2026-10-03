'use strict';

/* Hash routes (D59): every screen gets an address.
 *
 * Until Stage C each screen was mounted in place by whatever was clicked, so
 * Back left the app, a reload always landed on the estimates list, and nothing
 * could be linked to. This keeps the mechanics — history, the unsaved guard,
 * modals — and app.js keeps the route table, so a screen never has to know
 * about history and this file never has to know about screens.
 *
 * ONE WAY ONTO A SCREEN
 * Every navigation, a click or Back or a typed URL, ends in render(route),
 * which app.js supplies. In-app clicks call go(), which asks the unsaved guard
 * first and then pushes the entry itself (pushState fires no hashchange, so
 * nothing renders twice). Back, Forward and a typed hash arrive as hashchange,
 * after the address has already moved — so a refusal there has to put it back.
 *
 * PUTTING THE ADDRESS BACK
 * Every entry this page makes is stamped with its place in the history
 * (history.state.lscIdx). A refused Back or Forward is undone by going the same
 * distance the other way, which keeps the entries on both sides; replacing the
 * entry instead would have lost the one the user tried to reach. An unstamped
 * entry is one the browser just pushed for a typed or clicked hash, so stepping
 * back off it is the undo. Landing on the path already on screen renders
 * nothing, which is what makes the undo silent.
 *
 * MODALS ARE NOT ROUTES
 * Back while a dialog is open closes the dialog and stays put. Each modal's own
 * Escape handling does the closing, so a dialog with edits in it asks about them
 * exactly as Escape does, and a save in flight is not interrupted.
 */

const LSCRouter = (() => {
  let render = null; // app.js's (route, state) => void
  let active = false; // false while the login screen is up
  let rendered = null; // the path of the screen on #main, or null
  let index = 0; // this entry's lscIdx
  // lscIdx -> path for the entries made since the page loaded, so leaveTo() can
  // tell whether the screen it means is one Back away.
  const trail = new Map();
  let skipGuardOnce = false;
  let pending = null; // in-memory state handed to the next render only
  let ticket = 0;

  /* '#/estimates/est_1a2b?q=x' -> { path: '/estimates/est_1a2b', segments,
     query }. The area is lowercased (the IA's URLs are lowercase); ids keep
     their case. A trailing slash and an empty hash both normalise away. */
  function parse(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    const q = raw.indexOf('?');
    const pathPart = q === -1 ? raw : raw.slice(0, q);
    const segments = pathPart.split('/').filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s);
      } catch (_) {
        return s;
      }
    });
    if (segments.length) segments[0] = segments[0].toLowerCase();
    const query = new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
    return { path: '/' + segments.map(encodeURIComponent).join('/'), segments, query };
  }

  const here = () => parse(location.hash).path;
  const stampedIdx = () => {
    const st = history.state;
    return st && typeof st.lscIdx === 'number' ? st.lscIdx : null;
  };

  function forgetForward() {
    for (const key of trail.keys()) if (key > index) trail.delete(key);
  }

  function show(path) {
    ticket += 1;
    rendered = path;
    const state = pending;
    pending = null;
    render(parse(path), state);
  }

  /* A modal open over #main, closed through its own Escape handler. True when
     there was one, whether or not it agreed to close (a dirty dialog may ask;
     a save in flight ignores Escape) — either way Back has been answered. */
  function closeOpenModal() {
    const overlay = document.querySelector('#app-view .modal-overlay.open');
    if (!overlay) return false;
    const inside = overlay.contains(document.activeElement) ? document.activeElement : null;
    const target = inside || overlay.querySelector('[role="dialog"]') || overlay;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }

  function undo(newIdx) {
    if (newIdx === null) return history.back();
    const delta = index - newIdx;
    // go(0) would reload the page; an entry re-stamped in place just gets its
    // old address back.
    if (delta === 0) return history.replaceState({ lscIdx: index }, '', '#' + rendered);
    history.go(delta);
  }

  /* The entry the browser is now on: an unstamped one (a typed or clicked
     hash) gets the next index and drops the old forward entries, as a push
     would; a stamped one is where Back or Forward landed. */
  function record(path, newIdx) {
    if (newIdx === null) {
      index += 1;
      history.replaceState({ lscIdx: index }, '', location.hash);
      forgetForward();
    } else {
      index = newIdx;
    }
    trail.set(index, path);
  }

  /* Arrived somewhere with nothing to render: only the bookkeeping moves, and
     a leaveTo() waiting on this move has had it. */
  function settle(path, newIdx) {
    skipGuardOnce = false;
    pending = null;
    record(path, newIdx);
  }

  function onHashChange() {
    const path = here();
    const newIdx = stampedIdx();

    if (!active || path === rendered) {
      /* Signed out (the route is shown after sign-in), or back on the screen
         already showing — the far end of an undo. */
      settle(path, newIdx);
      return;
    }

    if (skipGuardOnce) {
      skipGuardOnce = false; // leaveTo() already asked
    } else if (closeOpenModal() || !LSCUnsaved.confirmLeave()) {
      undo(newIdx);
      return;
    }

    record(path, newIdx);
    show(path);
  }

  /* Back or Forward between two entries with the same address fires popstate
     and no hashchange. A replace can leave such a pair: a deleted client's
     entry becomes the list beside the list's own, an unknown address becomes
     Home beside Home. Nothing renders, but the index must follow, or the next
     refused Back is undone by the wrong distance and a leaveTo() waiting on a
     hashchange keeps its skipped guard for the next one. A move to a
     different address is hashchange's, which comes after. */
  function onPopState() {
    const newIdx = stampedIdx();
    if (newIdx === null || newIdx === index || here() !== rendered) return;
    settle(here(), newIdx);
  }

  /* Go to `path` ('/clients/cli_1a2b'). options:
       replace   — take this entry's place rather than adding one (canonical
                   rewrites, and a new record's first save);
       skipGuard — the screen being left has nothing to lose, or has already
                   asked (a save, a delete);
       state     — handed to that render only: never in the address, so never
                   there on Back or reload (a deep-link focus, a record the
                   caller already holds).
     Going to the path already showing re-renders it in place — the nav item
     you are on refreshes, as it always has. False if the user declined. */
  function go(path, options) {
    const opts = options || {};
    if (!active) return false;
    if (!opts.skipGuard && !LSCUnsaved.confirmLeave()) return false;
    pending = opts.state || null;
    if (opts.replace || path === here()) {
      history.replaceState({ lscIdx: index }, '', '#' + path);
    } else {
      index += 1;
      history.pushState({ lscIdx: index }, '', '#' + path);
      forgetForward();
    }
    trail.set(index, path);
    show(path);
    return true;
  }

  /* "Back to the list": Back itself when the list is the entry behind this
     one, so Back afterwards doesn't return to the screen just left; go() to
     it otherwise (a deep link, or after a reload), where `replace` decides
     whether the screen being left keeps its entry. */
  function leaveTo(path, options) {
    const opts = options || {};
    if (!active) return false;
    if (trail.get(index - 1) !== path) return go(path, opts);
    if (!opts.skipGuard && !LSCUnsaved.confirmLeave()) return false;
    skipGuardOnce = true;
    pending = opts.state || null;
    history.back();
    return true;
  }

  return {
    parse,

    /* Once, at boot. hashchange is listened for from the start so entries made
       while signed out are stamped too. */
    init(renderRoute) {
      render = renderRoute;
      const idx = stampedIdx();
      if (idx === null) history.replaceState({ lscIdx: 0 }, '', location.hash || '#/');
      index = idx === null ? 0 : idx;
      trail.set(index, here());
      window.addEventListener('hashchange', onHashChange);
      window.addEventListener('popstate', onPopState);
    },

    /* Signed in. `force` renders the address whatever is on #main (a fresh
       sign-in, or a screen that never finished drawing). Without it, a screen
       kept behind the login card after a lost session stays — unless the
       address moved while the login was up, when its edits are asked about
       like any other exit, and a refusal puts the address back. False when it
       didn't render. */
    start(force) {
      active = true;
      if (!force && rendered !== null) {
        if (here() === rendered) return false;
        if (!LSCUnsaved.confirmLeave()) {
          history.replaceState({ lscIdx: index }, '', '#' + rendered);
          trail.set(index, rendered);
          return false;
        }
      }
      show(here());
      return true;
    },

    /* The login screen is up. `forget` when #main was emptied (sign-out), so
       the next start() renders even the same address again. */
    stop(forget) {
      active = false;
      if (forget) rendered = null;
    },

    go,
    leaveTo,

    /* An async screen captures one of these before it awaits and checks it
       after, so a slow fetch can't mount over the screen the user moved on
       to. */
    ticket: () => ticket,
    isCurrent: (t) => t === ticket,
  };
})();
