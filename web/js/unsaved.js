'use strict';

/* Unsaved-edit warnings.
 *
 * Four screens hold edits that exist only in the page — the estimate editor,
 * the rate card, the Invoice Settings modal and a client record — and any of
 * them can be left with one click: a nav item, Cancel, Back, Sign Out, or a
 * reload. Until now every one of those discarded the work silently, which the
 * desktop app also did; a save that fails is careful never to lose a keystroke
 * (see the catch blocks on every screen), and then a mis-aimed click on
 * "Clients" threw the same work away without a word.
 *
 * NATIVE DIALOGS, BOTH HALVES
 * window.confirm for navigation inside the app, and beforeunload for a reload,
 * a tab close or a typed URL. beforeunload is the only thing that can stop a
 * reload at all, and it is the browser's own dialog — so the in-app half is the
 * browser's too, rather than one screen-shaped modal and one browser dialog
 * asking the same question in two different voices. It also matches the delete
 * confirmations this app already uses. Note that the text of the beforeunload
 * dialog is fixed by the browser: what a page passes is ignored, so the
 * specifics ("changes to the rate card") can only appear in the confirm().
 *
 * WHAT COUNTS AS UNSAVED
 * A screen registers a snapshot comparison, not a "the user typed something"
 * flag. A character typed and then deleted again leaves nothing to warn about,
 * and a warning that fires on a screen the user never really changed is how you
 * teach someone to click through the one that matters.
 *
 * HOW A SCREEN STOPS BEING WATCHED
 * It doesn't have to. Screens are replaced by writing over #main's innerHTML
 * and there is no unmount hook to hang a release() on — so a watcher carries an
 * onScreen() sentinel instead, the same idea as the guard on
 * EstimateEditor.refreshTotals, and is dropped as soon as its screen is no
 * longer in the page. It asks what is on screen rather than holding an element
 * reference, because a screen that re-renders itself (the rate card does, on
 * every structural edit) would otherwise invalidate its own watcher.
 */

const LSCUnsaved = (() => {
  // key -> { label, onScreen, dirty }
  const watchers = new Map();

  /* The labels of every screen that is both still on screen and actually
     changed, pruning the watchers of screens that have been replaced.

     A throwing dirty() counts as clean, deliberately: it means a screen is in a
     state its own check didn't expect, and the alternative — treating it as
     dirty — makes the app unnavigable, asking about changes it can't describe
     and that may not exist. It is logged rather than swallowed. */
  function dirtyLabels() {
    const labels = [];
    for (const [key, watcher] of watchers) {
      let onScreen = false;
      try {
        onScreen = watcher.onScreen();
      } catch (err) {
        console.error('[unsaved] onScreen threw for ' + key, err);
      }
      if (!onScreen) {
        watchers.delete(key);
        continue;
      }
      try {
        if (watcher.dirty()) labels.push(watcher.label);
      } catch (err) {
        console.error('[unsaved] dirty check threw for ' + key, err);
      }
    }
    return labels;
  }

  function phrase(labels) {
    if (labels.length === 1) return labels[0];
    return labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1];
  }

  /* The browser decides whether to show this and what it says. All a page can
     do is ask, by cancelling the event — the returnValue line is the older way
     of asking, kept because some browsers still want it. */
  function onBeforeUnload(event) {
    if (!dirtyLabels().length) return;
    event.preventDefault();
    event.returnValue = '';
  }

  return {
    init() {
      window.addEventListener('beforeunload', onBeforeUnload);
    },

    /* label: a noun phrase that reads after "unsaved changes to" —
       "this estimate", "the rate card".
       onScreen: is this screen still in the page? Hidden counts as on screen: a
       screen kept behind the login card after a 401 is being held for after
       sign-in, and a reload would lose it.
       dirty: has anything changed since the last save? */
    watch(key, watcher) {
      watchers.set(key, watcher);
    },

    // Rarely needed — a watcher whose screen is gone prunes itself. Here for a
    // screen that wants to stop being watched while staying in the page.
    release(key) {
      watchers.delete(key);
    },

    /* True to go ahead — either nothing is unsaved, or the user said to discard
       it. `action` is a capitalised phrase naming what is about to happen, for
       the screens where "leaving" isn't the word ("Signing out", "Closing this
       window"). */
    confirmLeave(action) {
      const labels = dirtyLabels();
      if (!labels.length) return true;
      return window.confirm(
        'You have unsaved changes to ' + phrase(labels) + '.\n\n' +
          (action || 'Leaving this screen') + ' will discard them. Continue?'
      );
    },

    // For anything that wants to know without asking.
    dirty() {
      return dirtyLabels().length > 0;
    },
  };
})();
