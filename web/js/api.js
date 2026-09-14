'use strict';

/* The single place this app talks to the NAS API.
 *
 * Every call goes out with `credentials: 'include'` — the session cookie is
 * cross-site (GitHub Pages -> NAS) and is not sent otherwise.
 *
 * Failures are classified rather than thrown as bare Errors, because the UI
 * treats them very differently:
 *
 *   'network'   the server could not be reached at all. Drives the
 *               connection-lost banner. Never a reason to log the user out.
 *   'auth'      401. The session is gone; show the login screen.
 *   'throttled' 429 from /api/login, carrying retryAfterMs.
 *   'client'    any other 4xx — a bad request this call made.
 *   'server'    5xx, or a reply that wasn't JSON when JSON was expected.
 *
 * The server is deliberately built to make this distinction possible: see the
 * requireAuth comment in server/src/auth.js.
 *
 * Every call also reports its outcome to subscribe()rs. That exists so the
 * connection banner can watch the app's whole traffic from one place instead of
 * every caller remembering to tell it — see js/connection.js.
 */

const LSCApi = (() => {
  const listeners = new Set();

  function announce(event) {
    for (const listener of listeners) {
      // A broken observer must not turn a successful request into a failed one.
      try {
        listener(event);
      } catch (err) {
        console.error('[api] subscriber threw', err);
      }
    }
  }

  class ApiError extends Error {
    constructor(kind, message, details) {
      super(message);
      this.name = 'ApiError';
      this.kind = kind;
      Object.assign(this, details || {});
    }
  }

  function base() {
    const configured = window.LSC_API_BASE;
    if (typeof configured !== 'string' || configured === '') {
      throw new ApiError(
        'server',
        'No API address configured. Copy js/config.example.js to js/config.js.'
      );
    }
    return configured.replace(/\/+$/, '');
  }

  /* RFC 6266: filename* carries the real (UTF-8) name, filename an ASCII
     fallback. null if neither is readable — cross-origin, the header is only
     visible because the API lists it in Access-Control-Expose-Headers. */
  function filenameFrom(disposition) {
    if (!disposition) return null;
    const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
    if (encoded) {
      try {
        return decodeURIComponent(encoded[1].trim());
      } catch (_) {
        // Malformed escapes: fall through to the plain parameter.
      }
    }
    const plain = /filename\s*=\s*"([^"]*)"/i.exec(disposition);
    return plain ? plain[1] : null;
  }

  // `expect` is 'json' (default) or 'pdf'. Errors are JSON either way, so only
  // a successful PDF reply takes the binary path.
  async function perform(method, path, body, expect) {
    // Resolved before the try: base() throws when config.js is missing, and
    // inside the try that would be caught and relabelled 'network' — telling a
    // fresh deploy the NAS is down when the real fault is an unwritten config.
    const url = base() + path;

    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'include',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // fetch only rejects when the request never got an answer: DNS failure,
      // refused connection, TLS problem, offline, or CORS blocking the reply.
      throw new ApiError('network', 'Could not reach the server.', { cause: err });
    }

    if (res.ok && expect === 'pdf') {
      if (!/^application\/pdf\b/i.test(res.headers.get('Content-Type') || '')) {
        throw new ApiError('server', 'The server sent a reply this app could not read.');
      }
      let blob;
      try {
        blob = await res.blob();
      } catch (err) {
        // The connection dropped partway through the file.
        throw new ApiError('network', 'Could not reach the server.', { cause: err });
      }
      return { blob, filename: filenameFrom(res.headers.get('Content-Disposition')) };
    }

    // 204 and other empty bodies are legitimate; don't try to parse them.
    const text = await res.text();
    let payload = null;
    if (text !== '') {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        if (res.ok) {
          throw new ApiError('server', 'The server sent a reply this app could not read.');
        }
      }
    }

    if (res.ok) return payload;

    const code = (payload && payload.error) || '';
    if (res.status === 401) {
      throw new ApiError('auth', 'Your session has expired.', { status: res.status, code });
    }
    if (res.status === 429) {
      throw new ApiError('throttled', 'Too many attempts.', {
        status: res.status,
        code,
        retryAfterMs: (payload && payload.retryAfterMs) || 0,
      });
    }
    throw new ApiError(
      res.status >= 500 ? 'server' : 'client',
      (payload && payload.message) || 'The server rejected that request.',
      { status: res.status, code }
    );
  }

  async function request(method, path, body, expect) {
    let payload;
    try {
      payload = await perform(method, path, body, expect);
    } catch (err) {
      announce({ ok: false, kind: err instanceof ApiError ? err.kind : 'server' });
      throw err;
    }
    announce({ ok: true });
    return payload;
  }

  return {
    ApiError,
    /* Called with { ok: true } or { ok: false, kind } after every request.
       Returns an unsubscribe function. */
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
    /* Resolves to { blob, filename }; filename is null if the reply didn't
       name the file. */
    postPdf: (path) => request('POST', path, undefined, 'pdf'),
  };
})();
