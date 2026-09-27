'use strict';

/* Finance & Price: the Dashboard, Rate Card, Overhead, Capacity and Profit
 * Goals behind one nav item, reached through a left rail.
 *
 * WHY A ROUTER AND NOT FIVE NAV ITEMS
 * Five more entries in #hdr-right would have made nine, and the header
 * already shrinks its labels at ~865px and collapses into a panel at 768px
 * (css/responsive.css). One "Finance & Price" item that opens an area with its
 * own rail keeps the header where it is, and the screens underneath genuinely
 * belong together: Overhead, Capacity and Profit Goals exist to produce the
 * numbers the Rate Card and the Dashboard show.
 *
 * WHY A RAIL AND NOT THE OLD TAB ROW
 * Three horizontal tabs read as a short list; five do not, and the Dashboard
 * is a summary that deep-links into every other screen, which a vertical list
 * of its destinations makes legible at a glance. Below 768px the rail reverts
 * to the horizontal row it replaced (css/responsive.css) — a collapsed
 * rail-as-hamburger would hide the whole structure behind a tap.
 *
 * WHAT THIS MODULE IS
 * A thin router, nothing else. It owns the rail and #finance-sub, and mounts a
 * child view into that container exactly as app.js mounts a top-level view
 * into #main. No child view knows it is inside Finance — PricingView is
 * mounted here unmodified, having only been handed a smaller container than it
 * used to get.
 *
 * THE RAIL IS NAVIGATION, NOT role="tablist"
 * Its items are the header's own .nav-link markup and .active convention,
 * moved into #main. ARIA tabs would promise arrow-key navigation between them
 * and a labelled tabpanel; this is a nav list that replaces a screen, so it
 * says so — <nav> plus aria-current, which is true without implying keyboard
 * behaviour that isn't implemented. If these ever grow into real tabs, that is
 * a deliberate change with roving tabindex attached, not a class rename.
 *
 * UNSAVED EDITS
 * Switching rail items discards a screen exactly as switching nav items does,
 * so it asks the same question, through the same LSCUnsaved.confirmLeave() —
 * the precedent is toFinance() in app.js, which does this one level up.
 * Overhead's own edits live in a modal that resolves on close, so only the Rate
 * Card and Profit Goals register watchers today; Capacity will be the third.
 */

const FinanceView = (() => {
  /* Ids are router state and stay as they were when the screens were named
     Pricing and Goals: data-go-tab="pricing" / "goals" links already exist in
     both screens, and app.js's first-run step asks for 'pricing'. The label is
     what the person reads; the id is what the code asks for. */
  const TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'pricing', label: 'Rate Card' },
    { id: 'overhead', label: 'Overhead' },
    { id: 'capacity', label: 'Capacity' },
    { id: 'goals', label: 'Profit Goals' },
  ];

  /* What a screen that hasn't shipped yet says instead. The Dashboard is the
     landing tab, so until it is built the header item lands here — the button
     is what keeps that from being a dead end. */
  const PENDING = {
    dashboard: 'The cost-to-rate summary — your floors against the rate card — is still to come.',
    capacity: 'Working days, leave and billable hours per day get their own screen next.',
  };

  let root = null; // #main
  let sub = null; // #finance-sub, where the child view is mounted
  let handlers = null;
  let activeTab = TABS[0].id;

  const isTab = (id) => TABS.some((tab) => tab.id === id);
  const labelFor = (id) => (TABS.find((tab) => tab.id === id) || TABS[0]).label;

  /* typeof rather than a bare reference: each view is a top-level `const` in
     its own <script>, which puts it in the shared global lexical scope and NOT
     on `window` — so `window.OverheadView` would read undefined even after the
     file exists, and a bare `OverheadView` throws a ReferenceError until it
     does. typeof is the one form that answers honestly in both states, which
     is what lets this router ship ahead of the Dashboard and Capacity views. */
  function resolveView(id) {
    if (id === 'dashboard') return typeof FinanceDashboardView === 'undefined' ? null : FinanceDashboardView;
    if (id === 'pricing') return typeof PricingView === 'undefined' ? null : PricingView;
    if (id === 'overhead') return typeof OverheadView === 'undefined' ? null : OverheadView;
    if (id === 'capacity') return typeof CapacityView === 'undefined' ? null : CapacityView;
    if (id === 'goals') return typeof GoalsView === 'undefined' ? null : GoalsView;
    return null;
  }

  function markup() {
    let items = '';
    TABS.forEach((tab) => {
      items +=
        '<button type="button" class="nav-link" data-tab="' + tab.id + '">' + tab.label + '</button>';
    });
    return (
      '<div class="finance-shell">' +
      '<nav class="finance-rail" aria-label="Finance sections">' + items + '</nav>' +
      '<div id="finance-sub"></div>' +
      '</div>'
    );
  }

  function syncRail() {
    root.querySelectorAll('.finance-rail .nav-link').forEach((btn) => {
      const on = btn.dataset.tab === activeTab;
      btn.classList.toggle('active', on);
      // aria-current, not aria-selected: these are nav links to screens, and
      // "page" is what a screen-reader user is actually being told here.
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    /* Below 768px the rail is a horizontal row that scrolls, and Profit Goals
       starts off-screen at 375px — landing there from a deep link must not
       leave the active item out of view. inline:'nearest' does nothing when it
       is already visible, which is every width where the rail is vertical. */
    const current = root.querySelector('.finance-rail .nav-link.active');
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function mountPending() {
    sub.innerHTML =
      '<div class="empty-state"><h3>' +
      labelFor(activeTab) +
      ' isn’t built yet</h3><p>' +
      (PENDING[activeTab] || 'This screen is still to come.') +
      '</p><button type="button" class="btn finance-pending-go" data-go-tab="pricing">Open Rate Card</button></div>';
    sub.querySelector('[data-go-tab]').addEventListener('click', () => selectTab('pricing'));
  }

  /* opts: the optional second argument of selectTab, handed to the child's
     mount alongside the router's own handlers. The one caller planned is the
     Dashboard's deep link into Overhead's Depreciation inner tab —
     onGoTab('overhead', { inner: 'depreciation' }) — and a child that doesn't
     read a key simply ignores it. The router's own keys are assigned last so
     that nothing in opts can replace onAuthLost or onGoTab. */
  function mountChild(opts) {
    /* A fresh #finance-sub for every screen. Children bind delegated click
       listeners on the container they are handed (goals.js does, and so does
       the Dashboard), and innerHTML replaces a container's content, not its
       listeners — so they piled up across visits, and a stale Goals listener
       would handle a later Dashboard link first, navigating without its opts
       and dropping the Overhead → Depreciation deep link. Replacing the node
       drops every old listener at once. Nothing holds the old node: each view
       is handed the new one, and every onScreen() sentinel asks the document. */
    const fresh = sub.cloneNode(false);
    sub.replaceWith(fresh);
    sub = fresh;

    const View = resolveView(activeTab);
    if (!View) {
      mountPending();
      return;
    }
    /* onGoTab is selectTab, which is the in-router equivalent of app.js's
       toFinance(tab): same destination, same LSCUnsaved.confirmLeave() guard,
       without tearing down and rebuilding this router to land one div lower.
       Wrapped rather than passed by reference so a child that ever hands it a
       click event doesn't have that event read as a tab id (selectTab's own
       isTab() check is the second half of that belt). */
    View.mount(
      sub,
      Object.assign({}, opts, {
        onAuthLost: handlers.onAuthLost,
        onGoTab: (id, next) => selectTab(id, next),
      })
    );
  }

  /* A plain options object or nothing. A child wiring onGoTab straight to a
     listener would pass (event) as the first argument, which isTab() rejects;
     this is the same guard for the second. */
  function plainOpts(opts) {
    return opts && Object.getPrototypeOf(opts) === Object.prototype ? opts : undefined;
  }

  function selectTab(id, opts) {
    // Re-clicking the item you are on is not leaving a screen, so it must not
    // ask about unsaved edits — and re-mounting would throw away the edits it
    // just declined to ask about. Moving between a screen's own inner tabs is
    // that screen's job, not the router's.
    if (id === activeTab || !isTab(id)) return;
    if (!LSCUnsaved.confirmLeave()) return;
    activeTab = id;
    syncRail();
    window.scrollTo(0, 0);
    mountChild(plainOpts(opts));
  }

  function bindRail() {
    root.querySelector('.finance-rail').addEventListener('click', (event) => {
      const btn = event.target.closest('.nav-link');
      if (btn) selectTab(btn.dataset.tab);
    });
  }

  /* initialTab: which screen to open on. The header's Finance & Price item
     passes nothing and lands on the Dashboard — it answers "is my pricing
     right?", which is the question the area exists for. (It used to land on
     Pricing so nobody's muscle memory broke in the move into Finance; that was
     written when Pricing was the only built screen.) Callers that mean the rate
     card specifically — the first-run setup step — say 'pricing'. An unknown
     value falls back to the Dashboard rather than mounting nothing. */
  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    activeTab = isTab(handlers.initialTab) ? handlers.initialTab : TABS[0].id;

    root.innerHTML = markup();
    sub = root.querySelector('#finance-sub');
    syncRail();
    bindRail();
    mountChild();
  }

  return { mount };
})();
