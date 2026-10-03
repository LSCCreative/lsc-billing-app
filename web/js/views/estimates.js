'use strict';

/* The estimate screens inside #main, behind the routes app.js gives them. Since
 * task 18 they live in their project (IA, Site Map):
 *
 *   #/projects/new                       a new project's editor
 *   #/projects/<id>/estimate             the editor of the project's estimate
 *   #/projects/<id>/estimate/view        its read-only view
 *   #/projects/<id>/estimate/<eid>[/view] the same, for another estimate of a
 *                                        group the fix-up kept together
 *
 * and #/estimates/<eid>[/edit], their addresses before the folder, find the
 * estimate's project and take its place. Back and Cancel return to the folder;
 * the list is Projects (task 17, D58).
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
  const folderPath = (projectId) => '/projects/' + encodeURIComponent(projectId);
  // A project as far as these paths need it: its id and its lead estimate.
  const projectOf = (estimate) => ({ id: estimate.projectId, estimateId: estimate.id });

  function handlers(project) {
    const back = project ? folderPath(project.id) : LIST;
    return {
      onAuthLost,
      onEdit: (estimate) => LSCRouter.go(ProjectFolder.estimatePath(project, estimate, false), { state: { estimate, project } }),
      /* Duplicate (D60): straight into the copy's editor, its UPID blank and
         focused, with what it was copied from said beside the field. */
      onEditCopy: (copy, from) => LSCRouter.go(ProjectFolder.estimatePath(projectOf(copy), copy, false), {
        state: { estimate: copy, project: projectOf(copy), copiedFrom: from },
      }),
      onBack: () => LSCRouter.leaveTo(back),
      // The editor's Back and Cancel. Off a deep link the editor's entry gives
      // way to the folder, so Back afterwards doesn't reopen an abandoned form.
      onCancel: () => LSCRouter.leaveTo(back, { replace: true }),
      /* Saved from the editor: back to the folder it was opened from when that
         is one Back away, so Back afterwards doesn't reopen the editor; a new
         project's editor entry becomes its folder instead. The form was just
         saved, so there is nothing for the guard to ask about. */
      onSaved: (estimate) => LSCRouter.leaveTo(folderPath(estimate.projectId), { skipGuard: true, replace: true }),
      // Its folder may be gone too (a project's last estimate takes it), so
      // this replaces rather than going Back to it.
      onDeleted: () => LSCRouter.go(LIST, { replace: true, skipGuard: true }),
    };
  }

  /* In place of a screen that can't be drawn. A deleted project says so where
     it was asked for (D59) rather than bouncing to the list with a toast, so a
     stale link or a Back onto it explains itself. */
  function showMissing(title, message, retry, back) {
    showPlaceholder(
      '<h3>' + esc(title) + '</h3><p>' + esc(message) + '</p>' +
      (retry ? '<button type="button" class="btn" id="js-retry" style="margin-top:16px">Try Again</button>' : ''),
      back
    );
    if (retry) root.querySelector('#js-retry').addEventListener('click', retry);
  }

  function showPlaceholder(body, back) {
    const to = back || LIST;
    root.innerHTML =
      '<button class="back-btn" id="js-back">' + (to === LIST ? '← All Projects' : '← Back') + '</button>' +
      '<div class="empty-state">' + body + '</div>';
    root.querySelector('#js-back').addEventListener('click', () => LSCRouter.leaveTo(to));
  }

  /* A GET behind a route, or null once the failure has been dealt with
     (shown in place, or handed to onAuthLost). Also null when the user moved
     on while it loaded: the screen they went to is not this one's to replace.
     The screen being left goes at once: the router has already asked about
     its edits, so anything typed into it while this loads would be lost
     without a question. */
  async function fetchFor(path, what, retry) {
    const ticket = LSCRouter.ticket();
    showPlaceholder('<h3>Loading…</h3>');
    try {
      const reply = await LSCApi.get(path);
      return LSCRouter.isCurrent(ticket) ? reply : null;
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket)) return null;
      if (err.kind === 'auth') {
        onAuthLost();
        return null;
      }
      if (err.status === 404) {
        showMissing('That ' + what + ' was deleted', 'Your other projects are in the list.');
      } else {
        showMissing(
          'Couldn’t open that ' + what,
          err.kind === 'network' ? 'The server is unreachable.' : err.message || 'The server refused.',
          retry
        );
      }
      return null;
    }
  }

  /* The estimate a project route means, and the project: from the route's
     state when the folder (or Duplicate) handed it over, else read. `eid`
     null means the project's lead. */
  async function resolve(projectId, eid, state, retry) {
    const held = state && state.estimate;
    if (held && state.project && state.project.id === projectId &&
      (eid ? held.id === eid : held.id === state.project.estimateId)) {
      return { estimate: held, project: state.project, held: true };
    }
    const reply = await fetchFor(
      '/api/projects/' + encodeURIComponent(projectId) + '?today=' + LSCUtil.today(), 'project', retry
    );
    if (!reply) return null;
    const estimate = eid ? reply.estimates.find((e) => e.id === eid) : reply.estimates[0];
    if (!estimate) {
      showMissing('That estimate isn’t in this project', 'It may have been deleted.', null, folderPath(projectId));
      return null;
    }
    return { estimate, project: reply.project, held: false };
  }

  async function showDetail(projectId, eid, state) {
    window.scrollTo(0, 0);
    const found = await resolve(projectId, eid, state, () => showDetail(projectId, eid));
    if (found) EstimateDetail.mount(root, found.estimate, handlers(found.project));
  }

  /* projectId null for a new project. A held estimate (the folder's, or the
     copy Duplicate just made) is used as it is, so Edit doesn't wait on a
     second fetch of what is on screen; a reload or a deep link reads it. */
  async function showEditor(projectId, eid, state) {
    window.scrollTo(0, 0);
    if (!projectId) {
      EstimateEditor.mount(root, null, handlers(null), {});
      return;
    }
    const found = await resolve(projectId, eid, state, () => showEditor(projectId, eid));
    if (!found) return;
    // Only for the copy Duplicate just made: a reload of its editor is an
    // ordinary edit, and the blank UPID still can't be saved.
    const copiedFrom = found.held ? state.copiedFrom || null : null;
    const focusDay = found.held ? state.focusDay || null : null;
    EstimateEditor.mount(root, found.estimate, handlers(found.project), { copiedFrom, focusDay });
  }

  /* #/estimates/<eid>[/edit] from before the folder: an old bookmark, or an
     email. Its project's folder (or the estimate's editor) takes the entry's
     place. */
  async function redirect(eid, edit) {
    const reply = await fetchFor('/api/estimates/' + encodeURIComponent(eid), 'estimate', () => redirect(eid, edit));
    if (!reply) return;
    const estimate = reply.estimate;
    if (!estimate.projectId) {
      showMissing('That estimate isn’t in a project', 'Reload the page to try again.');
      return;
    }
    const target = edit
      ? folderPath(estimate.projectId) + '/estimate/' + encodeURIComponent(estimate.id)
      : folderPath(estimate.projectId);
    LSCRouter.go(target, { replace: true, skipGuard: true });
  }

  return {
    /* Once per sign-in: where to draw. */
    init(container, options) {
      root = container;
      onAuthLost = options.onAuthLost;
    },

    /* #/projects/new: a new project starts as its estimate's editor (IA flow
       1); the project is made on its first save. */
    showNew() {
      showEditor(null, null, null);
      return true;
    },

    /* #/projects/<id>/estimate/…: `rest` is the route after 'estimate'. False
       for a shape this area doesn't have, which app.js treats as unknown. */
    showInProject(projectId, rest, state) {
      const [a, b, extra] = rest;
      if (extra !== undefined) return false;
      if (a === undefined) showEditor(projectId, null, state);
      else if (a === 'view' && b === undefined) showDetail(projectId, null, state);
      else if (b === undefined) showEditor(projectId, a, state);
      else if (b === 'view') showDetail(projectId, a, state);
      else return false;
      return true;
    },

    /* #/estimates/<eid>[/edit], the addresses before the folder. */
    showOld(segments) {
      const [eid, sub, extra] = segments;
      if (eid === undefined || extra !== undefined || (sub !== undefined && sub !== 'edit')) return false;
      redirect(eid, sub === 'edit');
      return true;
    },
  };
})();
