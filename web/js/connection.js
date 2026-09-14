'use strict';

/* The connection-lost banner.
 *
 * The app is online-only and fails loudly (DESIGN_BRIEF.md, "Offline
 * behaviour"): when the server can't be reached, the user is told, writes are
 * blocked, and nothing is half-saved behind their back.
 *
 * It subscribes to LSCApi rather than being called by each screen, so a screen
 * added later is covered without doing anything.
 *
 * WHAT COUNTS AS LOST
 * The banner tracks one question — is the server reachable and healthy? — and
 * not "did the last request succeed". Those are different, and conflating them
 * makes the banner lie:
 *
 *   network  → shown. Nothing got through.
 *   server   → shown. It answered, but with a 5xx or a reply we couldn't read;
 *              a save against that is not a save.
 *   auth / client / throttled → HIDDEN. A 401, a 400 or a 429 is a healthy
 *              server disagreeing with one specific request. Those belong to
 *              the caller, inline, and are positive evidence the connection is
 *              fine — so they clear the banner rather than raise it.
 *
 * This also means the Try Again button needs no special case: it makes an
 * ordinary request, and the rule above resolves it either way.
 */

const ConnectionBanner = (() => {
  let els = null;
  let showing = false;
  // The login screen owns its own error messaging (including the throttle
  // countdown, which this banner can't express), so the banner stays out of the
  // way until the app view is up.
  let enabled = false;
  let checking = false;

  const MESSAGES = {
    network: 'Can’t reach the server. Your changes can’t be saved until it’s back.',
    server: 'The server ran into a problem. Your changes can’t be saved until it recovers.',
  };

  function show(kind) {
    els.message.textContent = MESSAGES[kind] || MESSAGES.network;
    if (showing) return;
    showing = true;
    els.root.classList.add('show');
    document.body.dataset.connection = 'lost';
  }

  function hide() {
    if (!showing) return;
    showing = false;
    els.root.classList.remove('show');
    delete document.body.dataset.connection;
    setChecking(false);
  }

  function setChecking(next) {
    checking = next;
    els.retry.disabled = next;
    els.retry.textContent = next ? 'Checking…' : 'Try Again';
  }

  async function retry() {
    if (checking) return;
    setChecking(true);
    try {
      // Cheapest authenticated round-trip that touches no data. Whatever it
      // throws, the subscriber below decides what it means.
      await LSCApi.get('/api/session');
    } catch (_) {
      /* handled by the subscriber */
    }
    setChecking(false);
  }

  /* Writes are blocked here rather than by disabling buttons, because the
     screens that own those buttons are rendered later and manage `disabled`
     for their own reasons (a save already in flight, an incomplete form).
     Flipping it from outside would re-enable buttons that were meant to stay
     off. A capture-phase block covers markup that doesn't exist yet and gives
     the button back untouched when the connection returns.

     Keyboard activation needs no separate case: Enter and Space on a focused
     button dispatch a click. */
  function blockWrites(event) {
    if (!showing) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-write]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onApiEvent(event) {
    if (!enabled) return;
    if (event.ok || (event.kind !== 'network' && event.kind !== 'server')) {
      hide();
      return;
    }
    show(event.kind);
  }

  function init() {
    const root = document.getElementById('connection-banner');
    els = {
      root,
      message: root.querySelector('#connection-banner-message'),
      retry: root.querySelector('#connection-banner-retry'),
    };
    els.retry.addEventListener('click', retry);
    document.addEventListener('click', blockWrites, true);
    document.addEventListener('submit', blockWrites, true);
    LSCApi.subscribe(onApiEvent);
  }

  return {
    init,
    enable() {
      enabled = true;
    },
    disable() {
      enabled = false;
      hide();
    },
  };
})();
