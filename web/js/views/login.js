'use strict';

/* The login screen. Renders into #login-view, calls POST /api/login, and hands
 * control back through the onSuccess callback it was given.
 *
 * The server answers a bad password and an unknown username identically and in
 * the same time (see server/src/auth.js), so this screen must not be more
 * specific than "those details didn't work" — saying which half was wrong would
 * undo that.
 *
 * GETTING BACK IN (.design/account-recovery/)
 * The same card has four more states, swapped in place:
 *   forgot   "Username or email" → POST /api/password/forgot
 *   sent     check your inbox. Worded "if that matches", because the server
 *            answers the same either way (server/src/routes/account.js)
 *   reset    the emailed link, #/reset/<token>: app.js mounts it with
 *            { token } before it asks about a session. A new password twice →
 *            POST /api/password/reset, then back to sign in with a notice
 *   invalid  the link was used, expired, or never existed
 */

const LoginView = (() => {
  const MIN_PASSWORD = 12; // the server's rule (routes/account.js)

  let root = null;
  let handlers = null;
  let els = null;
  let pending = false;

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* The wordmark and the line under it are the same on every state, so moving
     between them reads as one card changing its question, not a new page. */
  function card(sub, body, id) {
    return `
      <form class="login-card" id="${id}" novalidate>
        <h1 class="login-wordmark">LSC CREATIVE<em>.</em></h1>
        <div class="login-sub">${sub}</div>
        <div id="login-notice" role="status" aria-live="polite"></div>
        ${body}
        <div id="login-error" role="alert" aria-live="assertive"></div>
      </form>
    `;
  }

  function submitButton(label) {
    return `
      <button type="submit" class="btn btn-accent" id="login-submit" data-pending="false">
        <span class="spinner" aria-hidden="true"></span>
        <span id="login-submit-label">${label}</span>
      </button>`;
  }

  function signInMarkup() {
    return card('Project Billing', `
      <div class="login-fields">
        <div class="field">
          <label for="login-username">Username or email</label>
          <input id="login-username" name="username" type="text"
                 autocomplete="username" autocapitalize="none"
                 autocorrect="off" spellcheck="false" required>
        </div>
        <div class="field">
          <div class="login-label-row">
            <label for="login-password">Password</label>
            <button type="button" class="login-link" id="login-forgot">Forgot password?</button>
          </div>
          <input id="login-password" name="password" type="password"
                 autocomplete="current-password" required>
        </div>
      </div>
      ${submitButton('Sign In')}`, 'login-form');
  }

  function forgotMarkup() {
    return card('Forgot Password', `
      <p class="login-intro">Type your username or the email on your account. A link to choose a new password will be emailed to you.</p>
      <div class="login-fields">
        <div class="field">
          <label for="login-username">Username or email</label>
          <input id="login-username" name="username" type="text"
                 autocomplete="username" autocapitalize="none"
                 autocorrect="off" spellcheck="false" required>
        </div>
      </div>
      ${submitButton('Email Me a Reset Link')}
      <button type="button" class="login-link login-back" id="login-back">Back to sign in</button>`, 'login-forgot-form');
  }

  function sentMarkup(login) {
    return card('Check Your Email', `
      <div class="login-sent">
        <span class="login-sent-mark" aria-hidden="true"></span>
        <p class="login-intro">If <strong>${esc(login)}</strong> matches the account, a reset link is on its way to the email address saved with it.</p>
        <p class="login-intro login-quiet">The link works once, for 30 minutes. Nothing there after a minute or two? Check your spam folder, then try again.</p>
      </div>
      <button type="button" class="btn btn-accent login-wide" id="login-back">Back to Sign In</button>
      <button type="button" class="login-link login-back" id="login-again">Send another link</button>`, 'login-sent-form');
  }

  function resetMarkup(username) {
    return card('New Password', `
      <p class="login-intro">Choose a new password for <strong>${esc(username)}</strong>. Any browser still signed in with the old one is signed out.</p>
      <!-- For password managers: saves the new password against this login. -->
      <input type="text" name="username" autocomplete="username" value="${esc(username)}" hidden>
      <div class="login-fields">
        <div class="field">
          <label for="login-new">New password</label>
          <input id="login-new" name="new-password" type="password" autocomplete="new-password"
                 minlength="${MIN_PASSWORD}" aria-describedby="login-new-hint" required>
          <p class="login-hint" id="login-new-hint">At least ${MIN_PASSWORD} characters.</p>
        </div>
        <div class="field">
          <label for="login-confirm">Type it again</label>
          <input id="login-confirm" name="confirm-password" type="password" autocomplete="new-password" required>
        </div>
        <label class="login-check"><input type="checkbox" id="login-show"> Show passwords</label>
      </div>
      ${submitButton('Set New Password')}
      <button type="button" class="login-link login-back" id="login-back">Back to sign in</button>`, 'login-reset-form');
  }

  function invalidMarkup(message) {
    return card('Link Expired', `
      <p class="login-intro">${esc(message || 'This reset link has expired or has already been used.')}</p>
      <p class="login-intro login-quiet">A link works once, for 30 minutes, and asking for a new one retires the one before. Use the newest email.</p>
      <button type="button" class="btn btn-accent login-wide" id="login-again">Send a New Link</button>
      <button type="button" class="login-link login-back" id="login-back">Back to sign in</button>`, 'login-invalid-form');
  }

  function checkingMarkup() {
    return card('New Password', '<p class="login-intro login-checking"><span class="spinner" aria-hidden="true"></span>Checking your link…</p>', 'login-checking-form');
  }

  // ── Shared bits ──────────────────────────────────────────────────────────

  function grab() {
    const q = (id) => root.querySelector('#' + id);
    els = {
      form: root.querySelector('form'),
      username: q('login-username'),
      password: q('login-password'),
      fresh: q('login-new'),
      confirm: q('login-confirm'),
      submit: q('login-submit'),
      submitLabel: q('login-submit-label'),
      error: q('login-error'),
      notice: q('login-notice'),
    };
    // Typing is the user saying "I've dealt with that"; leaving a stale red box
    // above a corrected password reads as a second, unrelated failure.
    [els.username, els.password, els.fresh, els.confirm].forEach((input) => {
      if (input) input.addEventListener('input', clearError);
    });
  }

  function render(markup) {
    pending = false;
    root.innerHTML = markup;
    grab();
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.classList.add('show');
  }

  function clearError() {
    if (!els || !els.error) return;
    els.error.textContent = '';
    els.error.classList.remove('show');
  }

  function showNotice(message) {
    els.notice.textContent = message;
    els.notice.classList.add('show');
  }

  function setPending(next, busyLabel, idleLabel) {
    pending = next;
    if (!els.submit) return;
    els.submit.disabled = next;
    els.submit.dataset.pending = String(next);
    els.submitLabel.textContent = next ? busyLabel : idleLabel;
    root.querySelectorAll('input').forEach((input) => { input.disabled = next; });
  }

  /* A throttled login is the one failure the user can act on precisely, so it
     gets a real number rather than "try again later". */
  function throttleMessage(retryAfterMs) {
    const seconds = Math.ceil((retryAfterMs || 0) / 1000);
    if (seconds <= 0) return 'Too many attempts. Try again in a moment.';
    if (seconds < 60) return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
    if (seconds < 120) return 'Too many attempts. Try again in about a minute.';
    return `Too many attempts. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  }

  const UNREACHABLE = 'Could not reach the server. Check that the API is running and try again.';

  // ── Sign in ──────────────────────────────────────────────────────────────

  async function signIn(event) {
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
    setPending(true, 'Signing In…', 'Sign In');

    try {
      const session = await LSCApi.post('/api/login', { username, password });
      // Deliberately not cleared on failure — a mistyped password shouldn't
      // cost the user the username they typed correctly.
      els.password.value = '';
      handlers.onSuccess(session);
    } catch (err) {
      setPending(false, '', 'Sign In');
      if (!(err instanceof LSCApi.ApiError)) throw err;

      if (err.kind === 'auth') {
        showError('Those details didn’t work. Check them and try again.');
        els.password.value = '';
        els.password.focus();
      } else if (err.kind === 'throttled') {
        showError(throttleMessage(err.retryAfterMs));
      } else if (err.kind === 'network') {
        showError(UNREACHABLE);
      } else if (err.code === 'no_account') {
        showError('No account has been set up on the server yet. Run the seed step on the NAS.');
      } else {
        showError(err.message || 'Something went wrong signing in.');
      }
      return;
    }

    setPending(false, '', 'Sign In');
  }

  function showSignIn(opts) {
    const o = opts || {};
    render(signInMarkup());
    els.form.addEventListener('submit', signIn);
    root.querySelector('#login-forgot').addEventListener('click', () => {
      showForgot(els.username.value.trim());
    });
    setPending(false, '', 'Sign In');
    if (o.username) els.username.value = o.username;
    if (o.notice) showNotice(o.notice);
    // The caller can hand us a reason the app couldn't start — most often that
    // the API was unreachable during the initial session check.
    if (o.error) showError(o.error);
    (o.username ? els.password : els.username).focus();
  }

  // ── Forgot password ──────────────────────────────────────────────────────

  async function askForLink(event) {
    event.preventDefault();
    if (pending) return;
    const login = els.username.value.trim();
    if (!login) {
      showError('Enter your username or email address.');
      els.username.focus();
      return;
    }
    clearError();
    setPending(true, 'Sending…', 'Email Me a Reset Link');
    try {
      await LSCApi.post('/api/password/forgot', { login });
    } catch (err) {
      setPending(false, '', 'Email Me a Reset Link');
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'throttled') showError(throttleMessage(err.retryAfterMs));
      else if (err.kind === 'network') showError(UNREACHABLE);
      else showError(err.message || 'Something went wrong sending the link.');
      els.username.focus();
      return;
    }
    showSent(login);
  }

  function showForgot(login) {
    render(forgotMarkup());
    els.form.addEventListener('submit', askForLink);
    root.querySelector('#login-back').addEventListener('click', () => backToSignIn({ username: els.username.value.trim() }));
    if (login) els.username.value = login;
    els.username.focus();
    if (login) els.username.select();
  }

  function showSent(login) {
    render(sentMarkup(login));
    els.form.addEventListener('submit', (e) => e.preventDefault());
    root.querySelector('#login-back').addEventListener('click', () => backToSignIn({ username: login }));
    root.querySelector('#login-again').addEventListener('click', () => showForgot(login));
    // Focus the card's first action so a screen reader lands on the news.
    root.querySelector('#login-back').focus();
  }

  // ── The emailed link ─────────────────────────────────────────────────────

  async function setPassword(event, token, username) {
    event.preventDefault();
    if (pending) return;
    const password = els.fresh.value;
    const again = els.confirm.value;
    if (password.length < MIN_PASSWORD) {
      showError(`Use at least ${MIN_PASSWORD} characters.`);
      els.fresh.focus();
      return;
    }
    if (password !== again) {
      showError('The two passwords don’t match. Type them again.');
      els.confirm.value = '';
      els.confirm.focus();
      return;
    }
    clearError();
    setPending(true, 'Saving…', 'Set New Password');
    let reply;
    try {
      reply = await LSCApi.post('/api/password/reset', { token, password });
    } catch (err) {
      setPending(false, '', 'Set New Password');
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.code === 'reset_link_invalid') return showInvalid(err.message);
      if (err.kind === 'network') showError(UNREACHABLE);
      else showError(err.message || 'Something went wrong saving the password.');
      return;
    }
    backToSignIn({
      username: (reply && reply.username) || username,
      notice: 'Password changed. Sign in with your new one.',
    });
  }

  async function showReset(token) {
    render(checkingMarkup());
    let info;
    try {
      info = await LSCApi.get('/api/password/reset/' + encodeURIComponent(token));
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.code === 'reset_link_invalid') return showInvalid(err.message);
      render(invalidMarkup(err.kind === 'network'
        ? 'Could not reach the server to check this link. Check that the API is running, then open the link again.'
        : (err.message || 'This link couldn’t be checked.')));
      bindInvalid();
      return;
    }
    render(resetMarkup(info.username));
    els.form.addEventListener('submit', (e) => setPassword(e, token, info.username));
    root.querySelector('#login-back').addEventListener('click', () => backToSignIn({ username: info.username }));
    root.querySelector('#login-show').addEventListener('change', (e) => {
      const type = e.target.checked ? 'text' : 'password';
      els.fresh.type = type;
      els.confirm.type = type;
    });
    els.fresh.focus();
  }

  function bindInvalid() {
    els.form.addEventListener('submit', (e) => e.preventDefault());
    root.querySelector('#login-again').addEventListener('click', () => backToSignIn({ forgot: true }));
    root.querySelector('#login-back').addEventListener('click', () => backToSignIn({}));
    root.querySelector('#login-again').focus();
  }

  function showInvalid(message) {
    render(invalidMarkup(message));
    bindInvalid();
  }

  /* Leaving a reset link's state takes the token out of the address, so a
     reload or a Back doesn't bring a spent link back. */
  function backToSignIn(opts) {
    if (handlers.onLeaveReset) handlers.onLeaveReset();
    if (opts && opts.forgot) return showForgot('');
    showSignIn(opts);
  }

  /**
   * handlers: { onSuccess(session), initialError?, notice?, username?,
   *             token? (a reset link's), onLeaveReset?() }
   */
  function mount(el, h) {
    root = el;
    handlers = h || {};
    if (handlers.token) {
      showReset(handlers.token);
      return;
    }
    showSignIn({ error: handlers.initialError, notice: handlers.notice, username: handlers.username });
  }

  return { mount };
})();
