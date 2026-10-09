'use strict';

/* Autosave for the estimate editor (trip-planner task 8; T14–T17, I2).
 *
 * WHEN IT SAVES
 * touch() after every edit restarts a 1.5 s wait (T15); flush() saves now (a
 * field left, another panel opened, Done, the tab hidden). One save is in
 * flight at a time: a save asked for while one is on its way runs once it
 * lands, with whatever the form says then, so edits made mid-flight are
 * never dropped and requests never cross (the server's baseUpdatedAt would
 * refuse the second as "changed elsewhere" if they did).
 *
 * WHAT IT DOESN'T KNOW
 * Anything about estimates. The editor's attempt({ sending }) reads the form,
 * checks it, calls sending() as its request goes out, and resolves the status
 * to show (or null to leave it); it is called even
 * when nothing has changed, and says "saved" then (so a refusal clears once
 * the field is put back). A refused or failed save is tried again on the
 * next edit, never on a timer: a timer would retry a refusal forever.
 *
 * THE STATUS
 * One line in the editor's sticky bar, as { kind, text, field, at }:
 *   saving   "Saving…", while a request is out
 *   saved    "Saved 2:41 pm" (at: ISO time; another day adds the date)
 *   waiting  "Not saved yet: add a project name and UPID", a new estimate
 *   refused  "Not saved: <reason>", a check or the server said no
 *   conflict "Changed in another tab or device · Reload"; autosave stops
 * A status with a `field` is a button that goes to it (onField). Routine
 * saves aren't announced; a save going wrong is, once, and so is the save
 * that puts it right (the live region).
 */

const LSCAutosave = (() => {
  const DELAY_MS = 1500;

  /* "2:41 pm" today, "8 Oct, 2:41 pm" another day; '' for no time. */
  function clock(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(/\s+/g, ' ').toLowerCase();
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? time : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ', ' + time;
  }

  const TROUBLE = new Set(['refused', 'conflict']);

  /* opts:
       attempt()  → Promise<status>: one try (see above). May throw.
       el()       → the status element, or null once the editor has gone.
       live()     → a polite live region, or null.
       onField(status), onReload(): the status's buttons.
       status     the first status to show. */
  function create(opts) {
    let status = opts.status;
    let timer = null;
    let loop = null; // the running save loop's promise
    let again = false;
    let stopped = false;
    let busy = false;

    function paint() {
      const el = opts.el();
      if (!el) return;
      const s = busy ? { kind: 'saving' } : status || {};
      el.dataset.kind = s.kind || '';
      el.textContent = '';
      if (s.kind === 'saving') {
        el.append(spinner(), 'Saving…');
      } else if (s.kind === 'saved') {
        const at = clock(s.at);
        el.textContent = at ? 'Saved ' + at : 'Saved';
      } else if (s.kind === 'conflict') {
        el.append('Changed in another tab or device · ');
        el.append(button('Reload', () => opts.onReload()));
      } else if (s.kind === 'waiting' || s.kind === 'refused') {
        const text = (s.kind === 'waiting' ? 'Not saved yet: ' : 'Not saved: ') + s.text;
        if (s.field) el.append(button(text, () => opts.onField(s)));
        else el.textContent = text;
      }
    }

    function spinner() {
      const s = document.createElement('span');
      s.className = 'spinner ed-autosave-spin';
      s.setAttribute('aria-hidden', 'true');
      return s;
    }

    function button(text, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-autosave-link';
      b.textContent = text;
      b.addEventListener('click', onClick);
      return b;
    }

    /* Said once when a save goes wrong (or the reason changes), and once when
       a save puts it right. */
    function announce(prev, next) {
      const region = opts.live && opts.live();
      if (!region || !next) return;
      const was = prev && TROUBLE.has(prev.kind);
      if (TROUBLE.has(next.kind)) {
        if (was && prev.kind === next.kind && prev.text === next.text) return;
        const el = opts.el();
        region.textContent = el ? el.textContent : '';
      } else if (was && next.kind === 'saved') {
        region.textContent = 'Saved.';
      }
    }

    function set(next) {
      if (!next) return;
      const prev = status;
      status = next;
      if (next.kind === 'conflict') stop();
      paint();
      // After the paint: what's said is what the bar now reads.
      announce(prev, next);
    }

    function run() {
      clearTimeout(timer);
      timer = null;
      if (stopped) return Promise.resolve();
      if (loop) {
        again = true;
        return loop;
      }
      loop = (async () => {
        do {
          again = false;
          let next;
          try {
            // "Saving…" only once a request is going out: most tries (a field
            // left with nothing changed) send nothing, and shouldn't flicker.
            next = await opts.attempt({
              sending: () => {
                busy = true;
                paint();
              },
            });
          } catch (err) {
            console.error('[autosave]', err);
            next = { kind: 'refused', text: 'something went wrong. Your work is still here.' };
          }
          busy = false;
          set(next);
        } while (again && !stopped);
      })().finally(() => {
        loop = null;
        busy = false;
        paint();
      });
      return loop;
    }

    function stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    }

    paint();

    return {
      /* An edit: save once things have been still for DELAY_MS. */
      touch() {
        if (stopped) return;
        clearTimeout(timer);
        timer = setTimeout(run, DELAY_MS);
      },
      /* Save now, and wait for it (and any save already on its way). Resolves
         true when what is on screen is saved. */
      flush() {
        return run().then(() => status && status.kind === 'saved');
      },
      /* Whatever is in flight, landed. Starts nothing. */
      idle() {
        return loop || Promise.resolve();
      },
      // Stops for good: a conflict, Save mode, an Undo or a delete taking over.
      stop,
      stopped: () => stopped,
      busy: () => busy,
      status: () => status,
      set,
      paint,
    };
  }

  return { create, clock, DELAY_MS };
})();
