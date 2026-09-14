'use strict';

/* Switches between the three estimate screens inside #main.
 *
 * The desktop app kept `view`, `editProj` and `viewingId` as module globals and
 * called a single render() that read them. The same idea, with the screens split
 * into files and the estimate itself fetched rather than plucked out of an
 * in-memory array — the server is the record now, so opening an estimate reads
 * it fresh instead of trusting whatever the list happened to be holding.
 */

const EstimatesView = (() => {
  let root = null;
  let onAuthLost = null;
  // Routes out of the estimates list that this view doesn't own: the first-run
  // setup steps on the empty state open the Pricing screen and the Invoice
  // Settings modal, both of which belong to js/app.js.
  let onGoPricing = null;
  let onOpenSettings = null;

  function handlers() {
    return {
      onAuthLost,
      onGoPricing: (...args) => onGoPricing(...args),
      onOpenSettings: (...args) => onOpenSettings(...args),
      onNew: () => showEditor(null),
      onOpen: (id) => showDetail(id),
      onEdit: (estimate) => showEditor(estimate),
      onBack: () => showList(),
      onCancel: () => showList(),
      onSaved: (estimate) => showDetail(estimate.id),
      onDeleted: () => showList(),
    };
  }

  function showList() {
    window.scrollTo(0, 0);
    EstimateList.mount(root, handlers());
  }

  async function showDetail(id) {
    window.scrollTo(0, 0);
    let estimate;
    try {
      const reply = await LSCApi.get('/api/estimates/' + encodeURIComponent(id));
      estimate = reply.estimate;
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return onAuthLost({ keepScreen: true });
      // An estimate that can't be opened is not a reason to strand the user on
      // a blank screen; the list is always somewhere to go back to.
      Toast.error(
        err.kind === 'network'
          ? 'Couldn’t open that estimate — the server is unreachable.'
          : 'Couldn’t open that estimate: ' + (err.message || 'the server refused.')
      );
      return showList();
    }
    EstimateDetail.mount(root, estimate, handlers());
  }

  function showEditor(estimate) {
    window.scrollTo(0, 0);
    EstimateEditor.mount(root, estimate, handlers());
  }

  return {
    mount(container, options) {
      root = container;
      onAuthLost = options.onAuthLost;
      onGoPricing = options.onGoPricing;
      onOpenSettings = options.onOpenSettings;
      showList();
    },
    showList,
    // The Clients screen's history opens an estimate straight into its detail.
    showDetail,
  };
})();
