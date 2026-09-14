'use strict';

/* Boot and top-level view switching.
 *
 * On load the app asks GET /api/session, which answers 200 or 401 without
 * touching any data — so an expired session lands on the login screen instead
 * of firing a request that 401s halfway through rendering the estimates list.
 */

(() => {
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const main = document.getElementById('main');
  const signOutBtn = document.getElementById('nav-sign-out');
  const hdrRight = document.getElementById('hdr-right');
  const menuBtn = document.getElementById('nav-menu-btn');

  // True once a screen has been mounted on #main since the last sign-in.
  let appMounted = false;
  // Set when a session expires under a screen worth coming back to; the next
  // sign-in un-hides it as it was instead of re-mounting the estimates list.
  let resumeOnSignIn = false;

  function showLogin(initialError) {
    // The login screen reports its own failures inline, and does it better than
    // the banner can — it distinguishes a bad password from a throttle.
    ConnectionBanner.disable();
    Toast.hide();
    // The panel lives inside #app-view, so hiding that takes it off the screen
    // but leaves .open set — and the login screen has no toggle to close it.
    closeMenu(false);
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
   * finished drawing (a list that 401'd while loading) pass nothing and get a
   * fresh estimates list after sign-in. Opt-in, so a new caller that forgets
   * gets today's behaviour rather than a stranded "Loading…".
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

    if (resumeOnSignIn) {
      resumeOnSignIn = false;
      Toast.ok('Signed back in. Anything you hadn’t saved is still here.');
      return;
    }

    // The rate card and GST settings price every estimate, so the app view
    // cannot render an estimate before they arrive.
    if (!LSCData.loaded()) {
      main.innerHTML = '<div class="empty-state"><h3>Loading…</h3></div>';
      try {
        await LSCData.load();
      } catch (err) {
        if (err instanceof LSCApi.ApiError && err.kind === 'auth') return onAuthLost();
        main.innerHTML =
          '<div class="empty-state"><h3>Couldn’t load your rate card</h3>' +
          '<p>Estimates can’t be priced without it. Once the server is back, reload the page.</p></div>';
        return;
      }
    }

    setNav('estimates');
    EstimatesView.mount(main, { onAuthLost, onGoPricing: toPricing, onOpenSettings: openSettings });
    appMounted = true;
  }

  function setNav(active) {
    document.getElementById('nav-estimates').classList.toggle('active', active === 'estimates');
    document.getElementById('nav-clients').classList.toggle('active', active === 'clients');
    document.getElementById('nav-pricing').classList.toggle('active', active === 'pricing');
  }

  /* The header is no longer the only way to either of these: the estimates
     list's first-run setup steps open them too, so they sit here rather than
     inside bindNav's closure where only the header could reach them. */
  function toPricing() {
    if (appView.hidden) return;
    if (!LSCUnsaved.confirmLeave()) return;
    setNav('pricing');
    window.scrollTo(0, 0);
    PricingView.mount(main, { onAuthLost });
  }

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
    /* Every nav item replaces what is on #main, so each one asks first if the
       screen it is about to overwrite has unsaved edits in it. The check is
       here rather than inside each screen because the screen being left doesn't
       know it is being left — the nav never tells it. */
    const toEstimates = () => {
      if (appView.hidden) return;
      if (!LSCUnsaved.confirmLeave()) return;
      setNav('estimates');
      EstimatesView.showList();
    };
    const toClients = () => {
      if (appView.hidden) return;
      if (!LSCUnsaved.confirmLeave()) return;
      setNav('clients');
      ClientsView.mount(main, {
        onAuthLost,
        onOpenEstimate: (id) => {
          setNav('estimates');
          EstimatesView.showDetail(id);
        },
      });
    };
    /* Invoice Settings is a modal, not a screen: it opens over whatever is on
       #main and leaves it mounted, so the nav's active state stays where it is
       and an estimate being edited is still there afterwards. */
    const settingsBtn = document.getElementById('nav-invoice-settings');
    settingsBtn.addEventListener('click', () => openSettings(settingsBtn));

    document.getElementById('logo-btn').addEventListener('click', toEstimates);
    document.getElementById('nav-estimates').addEventListener('click', toEstimates);
    document.getElementById('nav-clients').addEventListener('click', toClients);
    document.getElementById('nav-pricing').addEventListener('click', toPricing);
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
