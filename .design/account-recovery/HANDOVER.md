# Handover: Account recovery

The user's request (2026-10-07): "Forgot password?" on the sign-in screen that emails a reset link
through Resend, a reset page the link opens, an email on the login, and Settings → Account to
change the username, email and password. **Opus, effort high** (auth/session code). **Frontend task.**

## State

**Deployed 2026-10-07**: NAS first (backup `data/exports/pre-v15-20261007-082523.db`, boot log
`migrated to v15`, the routes answer through the tunnel), then Pages (`main`). The live login's
email is set to lachlan@creativelsc.com. Schema **v15**.

- `server/src/routes/account.js`: `POST /api/password/forgot` (username or email), `GET|POST
  /api/password/reset` (before the session gate), `GET|PUT /api/account` (behind it).
  `test/test-account.js` covers it.
- v15: `account.email` (`''` = none) and `password_resets` (token HMAC, 30-minute, one use).
- `mail.js` `passwordResetEmail`. Link is `${APP_URL}#/reset/<token>`.
- `scripts/set-account-email.js` (`npm run set-email -- you@example.com`; on the NAS:
  `docker exec -w /app lsc-billing npm run set-email -- …`).
- Web: `login.js` is one card with five states (sign in, forgot, sent, new password, link
  expired); `app.js` answers `#/reset/<token>` before the session check; Settings gains
  **Account** (its own form and Update Account button, outside Save Settings).

## Decisions (mine, built in; the user can overturn them)

1. Forgot replies identically for any login and sends after replying, so it never says whether a
   username exists. It refuses plainly (503) only when the server can't send email at all.
2. The email signs in as well as the username, so the username can't contain `@`.
3. A link works once, for 30 minutes; asking again retires the earlier one. At most one reset
   email a minute, and 5 asks per address per 15 minutes.
4. A reset signs every session out. Changing the password in Settings signs out every *other*
   browser. Every Account change asks for the current password (the email decides where reset
   links go). A wrong one is 403, never 401, so the app doesn't treat it as signed out.
5. Passwords need 12+ characters (the seed script's rule).

## Next

The user's end-to-end test: "Forgot password?" on the live sign-in, the Resend email, the reset
page. Then a VoiceOver pass by a person. Nothing else queued.

Merging `ui-clarity` later will touch `settings.js` / `settings.css` / `login.css`. These changes
are additive, in their own blocks.
