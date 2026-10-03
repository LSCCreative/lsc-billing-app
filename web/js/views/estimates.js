'use strict';

/* The estimate screens inside #main, behind the routes app.js gives them:
 * #/estimates/<id> (the detail), and #/projects/new and #/estimates/<id>/edit
 * (the editor). The list they return to is Projects (task 17, D58); the
 * project folder takes these in at task 18.
 *
 * The desktop app kept `view`, `editProj` and `viewingId` as module globals and
 * called a single render() that read them. The address holds that state now
 * (D59): the screens' own buttons ask the router for a route, and the router
 * calls back in here to draw it. The estimate itself is fetched rather than
 * plucked out of an in-memory array — the server is the record, so opening an
 * estimate reads it fresh instead of trusting whatever the list was holding.
 */

const EstimatesView = (() => {
  const { esc } = LSCUtil;

  let root = null;
  let onAuthLost = null;

  const LIST = '/projects';
  const detailPath = (id) => '/estimates/' + encodeURIComponent(id);

  function handlers() {
    return {
      onAuthLost,
      onEdit: (estimate) => LSCRouter.go(detailPath(estimate.id) + '/edit', { state: { estimate } }),
      /* Duplicate (D60): straight into the copy's editor, its UPID blank and
         focused, with what it was copied from said beside the field. */
      onEditCopy: (copy, from) => LSCRouter.go(detailPath(copy.id) + '/edit', { state: { estimate: copy, copiedFrom: from } }),
      onBack: () => LSCRouter.leaveTo(LIST),
      // The editor's Back and Cancel. Off a deep link the editor's entry gives
      // way to the list, so Back afterwards doesn't reopen an abandoned form.
      onCancel: () => LSCRouter.leaveTo(LIST, { replace: true }),
      /* Saved from the editor: back to the detail it was opened from when that
         is one Back away, so Back afterwards doesn't reopen the editor; a new
         estimate's editor entry becomes its detail instead. The form was just
         saved, so there is nothing for the guard to ask about. */
      onSaved: (estimate) => LSCRouter.leaveTo(detailPath(estimate.id), { skipGuard: true, replace: true }),
      // Its detail is gone too, so this replaces rather than going Back to it.
      onDeleted: () => LSCRouter.go(LIST, { replace: true, skipGuard: true }),
    };
  }

  /* In place of a screen that can't be drawn. A deleted estimate says so where
     it was asked for (D59) rather than bouncing to the list with a toast, so a
     stale link or a Back onto it explains itself. */
  function showMissing(title, message, retry) {
    showPlaceholder(
      '<h3>' + esc(title) + '</h3><p>' + esc(message) + '</p>' +
      (retry ? '<button type="button" class="btn" id="js-retry" style="margin-top:16px">Try Again</button>' : '')
    );
    if (retry) root.querySelector('#js-retry').addEventListener('click', retry);
  }

  function showPlaceholder(body) {
    root.innerHTML =
      '<button class="back-btn" id="js-back">← All Projects</button>' +
      '<div class="empty-state">' + body + '</div>';
    root.querySelector('#js-back').addEventListener('click', () => LSCRouter.leaveTo(LIST));
  }

  /* The estimate behind a route, or null once the failure has been dealt with
     (shown in place, or handed to onAuthLost). Also null when the user moved
     on while it loaded: the screen they went to is not this one's to replace.
     The screen being left goes at once: the router has already asked about
     its edits, so anything typed into it while this loads would be lost
     without a question. */
  async function load(id, retry) {
    const ticket = LSCRouter.ticket();
    showPlaceholder('<h3>Loading…</h3>');
    try {
      const reply = await LSCApi.get('/api/estimates/' + encodeURIComponent(id));
      return LSCRouter.isCurrent(ticket) ? reply.estimate : null;
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket)) return null;
      if (err.kind === 'auth') {
        onAuthLost();
        return null;
      }
      if (err.status === 404) {
        showMissing('That estimate doesn’t exist any more', 'It may have been deleted. Your other projects are in the list.');
      } else {
        showMissing(
          'Couldn’t open that estimate',
          err.kind === 'network' ? 'The server is unreachable.' : err.message || 'The server refused.',
          retry
        );
      }
      return null;
    }
  }

  async function showDetail(id) {
    window.scrollTo(0, 0);
    const estimate = await load(id, () => showDetail(id));
    if (estimate) EstimateDetail.mount(root, estimate, handlers());
  }

  /* id null for a new estimate. `held` is the estimate the detail screen
     already fetched (or Duplicate just made), handed through the route's state
     so Edit doesn't wait on a second fetch of what is on screen; a reload or a
     deep link has none and reads it. */
  async function showEditor(id, state) {
    window.scrollTo(0, 0);
    const held = state && state.estimate;
    let estimate = null;
    if (id) {
      estimate = held && held.id === id ? held : await load(id, () => showEditor(id));
      if (!estimate) return;
    }
    // Only for the copy Duplicate just made: a reload of its editor is an
    // ordinary edit, and the blank UPID still can't be saved.
    const copiedFrom = estimate && held === estimate ? state.copiedFrom : null;
    EstimateEditor.mount(root, estimate, handlers(), { copiedFrom });
  }

  return {
    /* Once per sign-in: where to draw. */
    init(container, options) {
      root = container;
      onAuthLost = options.onAuthLost;
    },

    /* The router's way in: ['new'] for a new project's editor, or the route
       after 'estimates'. False for a shape this area doesn't have, which
       app.js treats as an unknown route. */
    show(segments, state) {
      const [id, sub, extra] = segments;
      if (id === undefined || extra !== undefined) return false;
      if (id === 'new' && sub === undefined) showEditor(null);
      else if (sub === undefined) showDetail(id);
      else if (sub === 'edit') showEditor(id, state);
      else return false;
      return true;
    },
  };
})();
