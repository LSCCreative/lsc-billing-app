'use strict';

/* The login screen. Renders into #login-view, calls POST /api/login, and hands
 * control back through the onSuccess callback it was given.
 *
 * The server answers a bad password and an unknown username identically and in
 * the same time (see server/src/auth.js), so this screen must not be more
 * specific than "those details didn't work" — saying which half was wrong would
 * undo that.
 */

const LoginView = (() => {
  let els = null;
  let onSuccess = null;
  let pending = false;

  function markup() {
    return `
      <form class="login-card" id="login-form" novalidate>
        <div class="login-wordmark">LSC CREATIVE<em>.</em></div>
        <div class="login-sub">Project Billing</div>

        <div class="login-fields">
          <div class="field">
            <label for="login-username">Username</label>
            <input id="login-username" name="username" type="text"
                   autocomplete="username" autocapitalize="none"
                   autocorrect="off" spellcheck="false" required>
          </div>
          <div class="field">
            <label for="login-password">Password</label>
            <input id="login-password" name="password" type="password"
                   autocomplete="current-password" required>
          </div>
        </div>

        <button type="submit" class="btn btn-accent" id="login-submit" data-pending="false">
          <span class="spinner" aria-hidden="true"></span>
          <span id="login-submit-label">Sign In</span>
        </button>

        <div id="login-error" role="alert" aria-live="assertive"></div>
      </form>
    `;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.classList.add('show');
  }

  function clearError() {
    els.error.textContent = '';
    els.error.classList.remove('show');
  }

  function setPending(next) {
    pending = next;
    els.submit.disabled = next;
    els.submit.dataset.pending = String(next);
    els.submitLabel.textContent = next ? 'Signing In…' : 'Sign In';
    els.username.disabled = next;
    els.password.disabled = next;
  }

  /* A throttled login is the one failure the user can act on precisely, so it
     gets a real number rather than "try again later". */
  function throttleMessage(retryAfterMs) {
    const seconds = Math.ceil((retryAfterMs || 0) / 1000);
    if (seconds <= 0) return 'Too many attempts. Try again in a moment.';
    if (seconds < 60) return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
    return 'Too many attempts. Try again in about a minute.';
  }

  async function submit(event) {
    event.preventDefault();
    if (pending) return;

    const username = els.username.value.trim();
    const password = els.password.value;

    if (username === '' || password === '') {
      showError('Enter your username and password.');
      (username === '' ? els.username : els.password).focus();
      return;
    }

    clearError();
    setPending(true);

    try {
      const session = await LSCApi.post('/api/login', { username, password });
      // Deliberately not cleared on failure — a mistyped password shouldn't
      // cost the user the username they typed correctly.
      els.password.value = '';
      onSuccess(session);
    } catch (err) {
      setPending(false);
      if (!(err instanceof LSCApi.ApiError)) throw err;

      if (err.kind === 'auth') {
        showError('Those details didn’t work. Check them and try again.');
        els.password.value = '';
        els.password.focus();
      } else if (err.kind === 'throttled') {
        showError(throttleMessage(err.retryAfterMs));
      } else if (err.kind === 'network') {
        showError('Could not reach the server. Check that the API is running and try again.');
      } else if (err.code === 'no_account') {
        showError('No account has been set up on the server yet. Run the seed step on the NAS.');
      } else {
        showError(err.message || 'Something went wrong signing in.');
      }
      return;
    }

    setPending(false);
  }

  function mount(root, handlers) {
    onSuccess = handlers.onSuccess;
    root.innerHTML = markup();

    els = {
      form: root.querySelector('#login-form'),
      username: root.querySelector('#login-username'),
      password: root.querySelector('#login-password'),
      submit: root.querySelector('#login-submit'),
      submitLabel: root.querySelector('#login-submit-label'),
      error: root.querySelector('#login-error'),
    };

    els.form.addEventListener('submit', submit);
    // Typing is the user saying "I've dealt with that"; leaving a stale red box
    // above a corrected password reads as a second, unrelated failure.
    els.username.addEventListener('input', clearError);
    els.password.addEventListener('input', clearError);

    setPending(false);
    // The caller can hand us a reason the app couldn't start — most often that
    // the API was unreachable during the initial session check.
    if (handlers.initialError) showError(handlers.initialError);
    els.username.focus();
  }

  return { mount };
})();
