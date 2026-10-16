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

/* The trip planner's Google Maps (Project build archive/tracks/trip-planner/). Optional: without a
 * key the travel view says Google Maps isn't set up. The key is the "LSC
 * Billing — browser" key, website-restricted to the Pages origin and
 * http://localhost:5173 (so preview locally on that port). The Map ID is what
 * numbered map pins need. Values: .credentials.local.md, never a tracked file.
 */
window.LSC_MAPS_KEY = '';
window.LSC_MAPS_ID = '';
