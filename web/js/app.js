'use strict';

/* Boot, and the route table.
 *
 * On load the app asks GET /api/session, which answers 200 or 401 without
 * touching any data — so an expired session lands on the login screen instead
 * of firing a request that 401s halfway through rendering the estimates list.
 *
 * Which screen is on #main is the address's business (D59, js/router.js):
 * nav items ask for a route, and renderRoute() below is the only place a
 * top-level screen is chosen. A signed-out visit keeps its address through the
 * login screen, so signing in carries on to the page that was asked for, and a
 * reload stays where it was.
 */

(() => {
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const main = document.getElementById('main');
  const signOutBtn = document.getElementById('nav-sign-out');
  const hdrRight = document.getElementById('hdr-right');
  const menuBtn = document.getElementById('nav-menu-btn');

  /* Where #/ and an unknown address land: Home, the production calendar
     (D27, task 12). */
  const LANDING = '/home';

  // True once a screen has been mounted on #main since the last sign-in.
  let appMounted = false;
  // Set when a session expires under a screen worth coming back to; the next
  // sign-in un-hides it as it was instead of drawing the address's route afresh.
  let resumeOnSignIn = false;

  function showLogin(initialError) {
    // The login screen reports its own failures inline, and does it better than
    // the banner can — it distinguishes a bad password from a throttle.
    ConnectionBanner.disable();
    Toast.hide();
    // The panel lives inside #app-view, so hiding that takes it off the screen
    // but leaves .open set — and the login screen has no toggle to close it.
    closeMenu(false);
    LSCRouter.stop(false);
    appView.hidden = true;
    loginView.hidden = false;
    document.title = 'Sign In — LSC Billing';
    LoginView.mount(loginView, {
      onSuccess: (session) => showApp(session),
      initialError: initialError || null,
    });
  }

  /* A 401 from anywhere in the app lands here.
   *
   * showLogin only hides #app-view, so the screen underneath — a half-typed
   * estimate, an unsaved rate card — is still in the page. A caller passes
   * { keepScreen: true } when that screen is complete and worth returning to;
   * every screen resets its own pending state before calling this, so what
   * comes back is a live form, not a stuck spinner. Callers whose screen never
   * finished drawing (a list that 401'd while loading) pass nothing, and
   * after sign-in the router draws whatever the address says, from scratch.
   * Opt-in, so a new caller that forgets gets a fresh screen rather than a
   * stranded "Loading…".
   *
   * A reload on the login screen still loses it — this is in-memory only. */
  function onAuthLost(options) {
    // Several in-flight requests can 401 together. Re-mounting the login
    // screen for each would wipe whatever the user has started typing into it.
    if (!loginView.hidden) return;
    resumeOnSignIn = appMounted && Boolean(options && options.keepScreen);
    showLogin(
      resumeOnSignIn
        ? 'Your session expired. Sign in again — anything you hadn’t saved is still here.'
        : 'Your session expired. Sign in again to continue.'
    );
  }

  function setUser(session) {
    const username = session && session.username;
    signOutBtn.title = username ? 'Signed in as ' + username : '';
  }

  /* Only the server can end the session: the cookie is httpOnly, so the page
     can't clear it. If the request fails the user is still signed in, and
     saying otherwise would be the one lie a sign-out button can tell. */
  async function signOut() {
    if (signOutBtn.disabled) return;
    signOutBtn.disabled = true;
    try {
      await LSCApi.post('/api/logout');
    } catch (err) {
      signOutBtn.disabled = false;
      if (!(err instanceof LSCApi.ApiError)) throw err;
      Toast.error(
        err.kind === 'network'
          ? 'Couldn’t sign out — the server is unreachable, so you’re still signed in.'
          : 'Couldn’t sign out: ' + (err.message || 'the server refused.')
      );
      return;
    }
    signOutBtn.disabled = false;

    // A deliberate sign-out keeps nothing: no screen to resume, no client data
    // left in the DOM behind the login card, no cached rate card.
    appMounted = false;
    resumeOnSignIn = false;
    LSCRouter.stop(true);
    main.innerHTML = '';
    LSCData.clear();
    setUser(null);
    window.scrollTo(0, 0);
    showLogin();
  }

  async function showApp(session) {
    setUser(session);
    loginView.hidden = true;
    loginView.innerHTML = '';
    appView.hidden = false;
    document.title = 'LSC Billing';
    ConnectionBanner.enable();

    /* The kept screen comes back as it was — unless the address moved while
       the login screen was up (Back on the login card), in which case the
       router asks about that screen's edits and goes where the address says. */
    if (resumeOnSignIn) {
      resumeOnSignIn = false;
      if (!LSCRouter.start(false)) Toast.ok('Signed back in. Anything you hadn’t saved is still here.');
      return;
    }

    // The rate card and GST settings price every estimate, and overhead and
    // goals set the rate card's labour rates, so the app view cannot render an
    // estimate before all of them arrive.
    if (!LSCData.loaded()) {
      main.innerHTML = '<div class="empty-state"><h3>Loading…</h3></div>';
      try {
        await LSCData.load();
      } catch (err) {
        if (err instanceof LSCApi.ApiError && err.kind === 'auth') return onAuthLost();
        main.innerHTML =
          '<div class="empty-state"><h3>Couldn’t load your pricing and finance settings</h3>' +
          '<p>Estimates can’t be priced without them. Once the server is back, reload the page.</p></div>';
        return;
      }
    }

    /* onGoPricing keeps its name: the first-run setup step it serves means the
       rate card specifically, so it asks for #/finance/pricing — #/finance
       alone lands on the Dashboard. */
    EstimatesView.init(main, {
      onAuthLost,
      onGoPricing: () => LSCRouter.go('/finance/pricing'),
      onOpenSettings: openSettings,
    });
    HomeView.init(main, { onAuthLost });
    SetupView.init(main, { onAuthLost });
    ClientsView.init(main, {
      onAuthLost,
      onOpenEstimate: (id) => LSCRouter.go('/estimates/' + encodeURIComponent(id)),
    });
    // Whatever the address says, even if it is the screen that was there before
    // a lost session: that screen never finished drawing, or it would have
    // been kept.
    LSCRouter.start(true);
    appMounted = true;
  }

  /* The route table. segments[0] is the area; each area's view reads the rest
     and answers false for a shape it doesn't have. Nothing here checks the
     unsaved guard — the router has, before calling this. */
  function renderRoute(route, state) {
    closeMenu(false);
    const [area, ...rest] = route.segments;
    if (area === undefined) {
      LSCRouter.go(LANDING, { replace: true, skipGuard: true });
      return;
    }
    let shown = false;
    if (area === 'home') {
      setNav('home');
      shown = HomeView.show(rest, state);
    } else if (area === 'estimates') {
      setNav('estimates');
      shown = EstimatesView.show(rest, state);
    } else if (area === 'clients') {
      setNav('clients');
      shown = ClientsView.show(rest, state);
    } else if (area === 'setup') {
      // The UPID fix-up (task 16) is reached from the estimates list.
      setNav('estimates');
      shown = SetupView.show(rest, state);
    } else if (area === 'finance' && rest.length <= 1) {
      setNav('finance');
      shown = FinanceView.show(main, rest[0], state, {
        onAuthLost,
        onNavigate: (tab, opts) => LSCRouter.go('/finance/' + tab, { state: opts }),
      });
    }
    if (!shown) {
      Toast.error('That page doesn’t exist any more.');
      LSCRouter.go(LANDING, { replace: true, skipGuard: true });
    }
  }

  function setNav(active) {
    document.getElementById('logo-btn').classList.toggle('active', active === 'home');
    document.getElementById('nav-estimates').classList.toggle('active', active === 'estimates');
    document.getElementById('nav-clients').classList.toggle('active', active === 'clients');
    document.getElementById('nav-finance').classList.toggle('active', active === 'finance');
  }

  /* The header is no longer the only way to this: the estimates list's
     first-run setup steps open it too, so it sits here rather than inside
     bindNav's closure where only the header could reach it. */
  function openSettings(opener) {
    if (appView.hidden) return;
    SettingsView.open({ onAuthLost }, opener);
  }

  /* ── The compact nav (below 768px) ──────────────────────────────────────
   *
   * There is no second set of nav markup: below 768px css/responsive.css takes
   * #hdr-right out of flow and parks it under the header as a panel, and this
   * opens and closes it. The six buttons are the same elements with the same
   * handlers at every width, so nothing here can drift out of step with the
   * desktop header — including the unsaved-edit guards those handlers run.
   *
   * The panel is display:none while closed, so its buttons leave the tab order
   * and the accessibility tree with it; above 768px the toggle itself is
   * display:none and none of this can be reached.
   */
  function closeMenu(returnFocus) {
    if (menuBtn.getAttribute('aria-expanded') !== 'true') return;
    hdrRight.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) menuBtn.focus();
  }

  function bindCompactNav() {
    menuBtn.addEventListener('click', () => {
      const open = menuBtn.getAttribute('aria-expanded') === 'true';
      if (open) return closeMenu(false);
      hdrRight.classList.add('open');
      menuBtn.setAttribute('aria-expanded', 'true');
    });

    /* Any nav choice closes the panel, including one the unsaved-edit prompt
       then declines: the menu has been answered either way, and leaving it open
       over the screen the user chose to stay on would be the odd outcome. This
       listens on the panel rather than wrapping each handler so a nav item added
       later is covered without being told about the menu. */
    hdrRight.addEventListener('click', (event) => {
      if (event.target.closest('.nav-link')) closeMenu(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu(true);
    });

    /* A tap anywhere else dismisses it. Capture phase, because a screen may
       stop propagation on its own clicks — a menu that only sometimes closes is
       worse than one that never does. */
    document.addEventListener(
      'click',
      (event) => {
        if (event.target.closest('#hdr-right') || event.target.closest('#nav-menu-btn')) return;
        closeMenu(false);
      },
      true
    );

    /* Leaving the band hides the toggle, which would strand the panel open with
       no way to close it — and .open would then be waiting the next time the
       window narrowed. */
    window.addEventListener('resize', () => {
      if (window.matchMedia('(min-width: 768px)').matches) closeMenu(false);
    });
  }

  function bindNav() {
    /* Every nav item replaces what is on #main, so each one is a route: the
       router asks first if the screen it is about to overwrite has unsaved
       edits in it, because the screen being left doesn't know it is being
       left. The router is stopped while the login screen is up, so these do
       nothing then. */
    const to = (path) => () => LSCRouter.go(path);
    /* Invoice Settings is a modal, not a screen: it opens over whatever is on
       #main and leaves it mounted, so the nav's active state stays where it is
       and an estimate being edited is still there afterwards. */
    const settingsBtn = document.getElementById('nav-invoice-settings');
    settingsBtn.addEventListener('click', () => openSettings(settingsBtn));

    document.getElementById('logo-btn').addEventListener('click', to('/home'));
    document.getElementById('nav-estimates').addEventListener('click', to('/estimates'));
    document.getElementById('nav-clients').addEventListener('click', to('/clients'));
    document.getElementById('nav-finance').addEventListener('click', to('/finance'));
    signOutBtn.addEventListener('click', () => {
      if (appView.hidden) return;
      // A sign-out empties #main, so it discards unsaved work exactly as nav
      // does — and unlike nav, there is no going back to the screen afterwards.
      if (!LSCUnsaved.confirmLeave('Signing out')) return;
      signOut();
    });
  }

  async function boot() {
    ConnectionBanner.init();
    Toast.init();
    LSCUnsaved.init();
    SettingsView.init();
    LSCRouter.init(renderRoute);
    bindNav();
    bindCompactNav();
    try {
      showApp(await LSCApi.get('/api/session'));
    } catch (err) {
      if (err instanceof LSCApi.ApiError && err.kind === 'network') {
        showLogin('Could not reach the server. Check that the API is running, then sign in.');
        return;
      }
      // 401, or anything else this early: the login screen is the right place
      // to be, and the user can retry from there.
      showLogin();
    }
  }

  boot();
})();
