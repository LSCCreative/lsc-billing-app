'use strict';

/* Finance: Pricing, Overhead and Goals behind one nav item.
 *
 * WHY A ROUTER AND NOT THREE NAV ITEMS
 * Three more entries in #hdr-right would have made seven, and the header
 * already shrinks its labels at ~865px and collapses into a panel at 768px
 * (css/responsive.css). One "Finance" item that opens a screen with its own
 * sub-tab row keeps the header where it is, and the three screens underneath
 * genuinely belong together: Overhead and Goals exist to produce the number
 * the Pricing rate card now shows.
 *
 * WHAT THIS MODULE IS
 * A thin router, nothing else. It owns the sub-tab row and #finance-sub, and
 * mounts a child view into that container exactly as app.js mounts a top-level
 * view into #main. No child view knows it is inside Finance — PricingView is
 * mounted here unmodified, having only been handed a smaller container than it
 * used to get.
 *
 * SUB-TABS ARE NAVIGATION, NOT role="tablist"
 * They are the header's own .nav-link markup and .active convention, moved
 * into #main. ARIA tabs would promise arrow-key navigation between them and a
 * labelled tabpanel; this is a nav row that replaces a screen, so it says so —
 * <nav> plus aria-current, which is true without implying keyboard behaviour
 * that isn't implemented. If these ever grow into real tabs, that is a
 * deliberate change with roving tabindex attached, not a class rename.
 *
 * UNSAVED EDITS
 * Switching sub-tabs discards a screen exactly as switching nav items does, so
 * it asks the same question, through the same LSCUnsaved.confirmLeave() — the
 * precedent is toFinance() in app.js, which does this one level up. Overhead's
 * own edits live in a modal that resolves on close, so only Pricing and (later)
 * Goals register watchers at all.
 */

const FinanceView = (() => {
  const TABS = [
    { id: 'pricing', label: 'Pricing' },
    { id: 'overhead', label: 'Overhead' },
    { id: 'goals', label: 'Goals' },
  ];

  let root = null; // #main
  let sub = null; // #finance-sub, where the child view is mounted
  let handlers = null;
  let activeTab = TABS[0].id;

  const isTab = (id) => TABS.some((tab) => tab.id === id);
  const labelFor = (id) => (TABS.find((tab) => tab.id === id) || TABS[0]).label;

  /* Overhead and Goals are later tasks in this feature's task list; this shell
     ships before them on purpose, so that the nav, the data preload and the
     Pricing relocation can be built and looked at without waiting on two whole
     screens.

     typeof rather than a bare reference: each view is a top-level `const` in
     its own <script>, which puts it in the shared global lexical scope and NOT
     on `window` — so `window.OverheadView` would read undefined even after the
     file exists, and a bare `OverheadView` throws a ReferenceError until it
     does. typeof is the one form that answers honestly in both states. */
  function resolveView(id) {
    if (id === 'pricing') return typeof PricingView === 'undefined' ? null : PricingView;
    if (id === 'overhead') return typeof OverheadView === 'undefined' ? null : OverheadView;
    if (id === 'goals') return typeof GoalsView === 'undefined' ? null : GoalsView;
    return null;
  }

  function markup() {
    let tabs = '';
    TABS.forEach((tab) => {
      tabs +=
        '<button type="button" class="nav-link" data-tab="' + tab.id + '">' + tab.label + '</button>';
    });
    return (
      '<nav class="finance-tabs" aria-label="Finance sections">' + tabs + '</nav>' +
      '<div id="finance-sub"></div>'
    );
  }

  function syncTabs() {
    root.querySelectorAll('.finance-tabs .nav-link').forEach((btn) => {
      const on = btn.dataset.tab === activeTab;
      btn.classList.toggle('active', on);
      // aria-current, not aria-selected: these are nav links to screens, and
      // "page" is what a screen-reader user is actually being told here.
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  function mountChild() {
    const View = resolveView(activeTab);
    if (!View) {
      sub.innerHTML =
        '<div class="empty-state"><h3>' +
        labelFor(activeTab) +
        ' isn’t built yet</h3><p>This screen is still to come. Pricing is the one that works today.</p></div>';
      return;
    }
    /* onGoTab is selectTab, which is the in-router equivalent of app.js's
       toFinance(tab): same destination, same LSCUnsaved.confirmLeave() guard,
       without tearing down and rebuilding this router to land one div lower.
       Pricing's rate-card note is the first caller — its two inline links name
       Overhead and Goals. Wrapped rather than passed by reference so a child
       that ever hands it a click event doesn't have that event read as a tab
       id (selectTab's own isTab() check is the second half of that belt). */
    View.mount(sub, { onAuthLost: handlers.onAuthLost, onGoTab: (id) => selectTab(id) });
  }

  function selectTab(id) {
    // Re-clicking the tab you are on is not leaving a screen, so it must not
    // ask about unsaved edits — and re-mounting would throw away the edits it
    // just declined to ask about.
    if (id === activeTab || !isTab(id)) return;
    if (!LSCUnsaved.confirmLeave()) return;
    activeTab = id;
    syncTabs();
    window.scrollTo(0, 0);
    mountChild();
  }

  function bindTabs() {
    root.querySelector('.finance-tabs').addEventListener('click', (event) => {
      const btn = event.target.closest('.nav-link');
      if (btn) selectTab(btn.dataset.tab);
    });
  }

  /* initialTab: which sub-screen to open on. The header's Finance item passes
     nothing and lands on Pricing — nobody's muscle memory for "click through to
     the rate card" should break in the move. The Pricing screen's own links out
     to Overhead and Goals pass one, so a link that says Overhead opens
     Overhead. An unknown value falls back to Pricing rather than mounting
     nothing. */
  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    activeTab = isTab(handlers.initialTab) ? handlers.initialTab : TABS[0].id;

    root.innerHTML = markup();
    sub = root.querySelector('#finance-sub');
    syncTabs();
    bindTabs();
    mountChild();
  }

  return { mount };
})();
