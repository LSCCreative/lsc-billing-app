/* Copy this file to js/config.js and point it at your API.
 *
 * The frontend is served from GitHub Pages and the API from the NAS, so these
 * are different origins: the API must be HTTPS (the session cookie is
 * SameSite=None; Secure, which browsers refuse over plain HTTP) and its origin
 * must appear in the server's CORS_ORIGINS allow-list.
 *
 * Local development against `npm start` in server/:
 *   window.LSC_API_BASE = 'http://localhost:8080';
 *
 * Deployed, behind a Cloudflare Tunnel:
 *   window.LSC_API_BASE = 'https://billing-api.example.com';
 *
 * No trailing slash.
 */
window.LSC_API_BASE = 'http://localhost:8080';
