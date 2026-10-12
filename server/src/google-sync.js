'use strict';

/**
 * Writing bookings to Google Calendar (.design/trip-planner/ task 14; G1, G4,
 * G5, IA flow 9).
 *
 * WHAT IT DOES
 * Every confirmed or pencilled day with a date, on an estimate that isn't
 * declined, is one event in the connected account's PRIMARY calendar. The app
 * is the source of truth: a day is created, re-written whole when anything the
 * event shows changes, and deleted when the day stops being booked (moved to
 * TBC or proposed, removed, its estimate declined or deleted). An edit made in
 * Google to one of these events is overwritten the next time its day changes.
 * Proposed and Date TBC days, rentals and prices never go.
 *
 * HOW IT STAYS TRUE
 * Not by hooking every write, but by diffing: the wanted event for a day is
 * built from the database (`wantedFor`), hashed, and compared with
 * `google_event_sync.pushed_hash`, the hash of what was last written. Marking
 * (`mark`) records the difference as a `pending` row, synchronously and in the
 * database, so a restart loses nothing; a debounced pass (`pass`, 5 s after
 * the last change, so a run of autosaves makes one write) then calls Google
 * for the pending rows. Because the diff is by day id and re-derived, every
 * call is idempotent and a pass can be repeated or interrupted freely.
 *
 * WHICH ESTIMATES ARE LOOKED AT
 * `touch(ids)` names the estimates a write changed (the routes that book,
 * move, accept, decline or delete). Every pass also re-checks the estimates
 * that already have a row (the safety net: a write that forgot to touch can
 * leave a stale event, never an unmarked one). An estimate with no row yet is
 * written only when touched, or by Sync existing bookings (`syncExisting`):
 * connecting writes nothing by itself.
 *
 * WHICH DAYS
 * A day dated before today that has no event yet is not written (Sync
 * existing says "current" bookings); one that has an event keeps it, and
 * keeps being patched, as time passes.
 *
 * FAILURE
 * Google erroring marks the row `error` and retries it 1, 5 then 30 minutes
 * later; after that only on demand (POST /api/google/sync). Nothing here ever
 * blocks or fails a save: marking is wrapped, and the passes run on their own.
 * A refused connection (`reconnect`) leaves rows pending: nothing is lost, and
 * the next connect runs the pass.
 *
 * NO PRICES, NO TOKENS
 * The event holds names, times, places and links only. Errors are recorded as
 * a short code of ours (`unavailable`, `refused`), never Google's words.
 */

const crypto = require('crypto');
const { nowIso } = require('./db');
const google = require('./google');
const { durationText } = require('./call-sheet');
const { tripLineQty } = require('./calc');

const { ZONE, shiftDate } = google;
const PRIMARY = 'primary';
/* Bumped when the event's shape changes, so every event is written again. */
const FORMAT_VERSION = 1;
const DEBOUNCE_MS = 5000;
/* A debounce restarts on every change; this caps how long a stream of
   autosaves can keep a pass waiting. */
const MAX_WAIT_MS = 30000;
/* First failure → 1 min, second → 5 min, third → 30 min, then on demand. */
const BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000];
const MAX_ITEMS = 40;
const DEFAULT_LENGTH_MIN = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');
const clock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The event's start and end. A day with no start time is all day (Google's
 * all-day end is the next date). With one, times are Sydney wall-clock: an end
 * before the start runs past midnight and ends the next date (D21), and a
 * missing or equal end is an hour long, kept inside the day.
 */
function whenOf(date, startTime, endTime) {
  if (!startTime) return { start: { date }, end: { date: shiftDate(date, 1) } };
  const start = startTime.slice(0, 5);
  let endDate = date;
  let end = endTime ? endTime.slice(0, 5) : '';
  if (!end || end === start) {
    end = clock(Math.min(minutesOf(start) + DEFAULT_LENGTH_MIN, 23 * 60 + 59));
    if (end <= start) end = '23:59';
  } else if (end < start) {
    endDate = shiftDate(date, 1);
  }
  return {
    start: { dateTime: `${date}T${start}:00`, timeZone: ZONE },
    end: { dateTime: `${endDate}T${end}:00`, timeZone: ZONE },
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "5 stops · 109 km · 3 h 27 min driving", or '' for a day with no destination. */
function tripSummary(trip) {
  if (!trip || !Array.isArray(trip.stops)) return '';
  const stops = trip.stops.filter((s) => s && s.role === 'stop').length;
  if (!stops) return '';
  const parts = [plural(stops, 'stop', 'stops')];
  const totals = trip.totals || {};
  // Km as the day's km line bills it (calc.js tripLineQty), as on every other surface.
  if (Number(totals.km) > 0) parts.push(`${tripLineQty(trip, 'km')} km`);
  if (Number(totals.minutes) > 0) parts.push(`${durationText(totals.minutes)} driving`);
  return parts.join(' · ');
}

/** The first destination's address (the event's location), or ''. */
function firstDestination(trip) {
  const stop = trip && Array.isArray(trip.stops) && trip.stops.find((s) => s && s.role === 'stop' && s.address);
  return stop ? String(stop.address).trim() : '';
}

const namesOn = (rows, key, dayId) => (Array.isArray(rows[key]) ? rows[key] : [])
  .filter((line) => line && String(line.dayId) === dayId)
  .map((line) => String(line.name || '').trim())
  .filter(Boolean)
  .slice(0, MAX_ITEMS);

/**
 * One booked day as its Google event (G5). `row` is the day joined with its
 * estimate. Never a price: only names, times, places and links.
 */
function eventFor(row, { appUrl }) {
  const pencilled = row.status === 'pencilled';
  let client = '';
  try {
    client = String(JSON.parse(row.client_json || '{}').businessName || '').trim();
  } catch (_) { /* a damaged snapshot has no client */ }
  const title = [row.name, client, row.upid].map((p) => String(p || '').trim()).filter(Boolean).join(' · ') || 'Booking';

  let lines = {};
  try {
    lines = JSON.parse(row.active_rows_json || '{}') || {};
  } catch (_) { /* no items */ }
  let trip = null;
  try {
    trip = row.trip_json ? JSON.parse(row.trip_json) : null;
  } catch (_) { /* a damaged trip is no trip */ }

  const blocks = [];
  [['prod', 'Items'], ['crew', 'Crew'], ['equip', 'Gear']].forEach(([key, label]) => {
    const names = namesOn(lines, key, row.id);
    if (names.length) blocks.push(`${label}:\n${names.map((n) => `• ${n}`).join('\n')}`);
  });
  const facts = [];
  const trips = tripSummary(trip);
  if (trips) facts.push(`Trip: ${trips}`);
  if (appUrl && row.call_sheet_on === 1 && row.call_sheet_token) facts.push(`Call sheet: ${appUrl}c/#s/${row.call_sheet_token}`);
  if (appUrl && row.project_id) facts.push(`Project: ${appUrl}#/projects/${row.project_id}`);
  if (facts.length) blocks.push(facts.join('\n'));
  blocks.push('Kept up to date by LSC Billing. Change this booking in the app: edits made here are overwritten.');

  const location = firstDestination(trip);
  return {
    summary: `${pencilled ? 'Pencil · ' : ''}${title}`.slice(0, 1000),
    description: blocks.join('\n\n').slice(0, 8000),
    ...(location ? { location: location.slice(0, 1000) } : {}),
    status: pencilled ? 'tentative' : 'confirmed',
    ...whenOf(row.date, row.start_time, row.end_time),
    extendedProperties: { private: { lscDayId: row.id } },
  };
}

const hashOf = (event) => crypto.createHash('sha256').update(`v${FORMAT_VERSION};${JSON.stringify(event)}`).digest('hex');

/* A day's own event id: Google lets the caller choose one (base32hex, so
   0-9 and a-v). A write that timed out and is tried again finds its event
   with this id (409) instead of making a second. */
const eventIdOf = (dayId) => `lscb${crypto.createHash('sha1').update(String(dayId)).digest('hex')}`;

const eventPath = (id) => `/calendars/${PRIMARY}/events/${encodeURIComponent(id)}`;
const CREATE_PATH = `/calendars/${PRIMARY}/events?sendUpdates=none`;
const goneOnGoogle = (err) => err.status === 404 || err.status === 410;

/**
 * @param {object} db
 * @param {object} deps
 * @param {object} deps.oauth     google.js's { clientId, clientSecret, fetchImpl, now }
 * @param {string} [deps.appUrl]  the pages' address with its trailing slash (links in the event)
 * @param {function} [deps.now]   () => ms
 * @param {number} [deps.debounceMs]
 */
function createGoogleSync(db, deps = {}) {
  const oauth = deps.oauth || {};
  const appUrl = deps.appUrl || '';
  const now = deps.now || (() => Date.now());
  const debounceMs = deps.debounceMs !== undefined ? deps.debounceMs : DEBOUNCE_MS;
  const maxWaitMs = deps.maxWaitMs !== undefined ? deps.maxWaitMs : MAX_WAIT_MS;
  const log = deps.log || ((...a) => console.error('[google-sync]', ...a));
  // Off (GOOGLE_CALENDAR_WRITE=0): nothing is marked, scheduled or written.
  const enabled = deps.enabled !== false;

  let timer = null;
  let timerDue = 0; // when the timer will fire, in `now()` terms
  let timerIsRetry = false; // a back-off timer, not a pass that's about to run
  let firstWait = 0; // when the current debounce began
  let running = null; // the pass in flight
  let again = false; // something asked for a pass while one ran
  let stopped = false;
  let holds = 0; // a disconnect under way: no pass starts (hold/release)

  const stamp = () => new Date(now()).toISOString();
  const connected = () => Boolean(db.prepare('SELECT 1 FROM google_account WHERE id = 1').get());

  /* Today in Sydney, as a date. */
  function today() {
    const p = google.sydneyParts(new Date(now()).toISOString());
    return p ? p.date : new Date(now()).toISOString().slice(0, 10);
  }

  // ── What should be in Google ─────────────────────────────────────────────

  const wantedQuery = db.prepare(`
    SELECT d.id, d.estimate_id, d.date, d.status, d.start_time, d.end_time, d.trip_json,
           e.upid, e.name, e.client_json, e.active_rows_json, e.project_id, e.call_sheet_token, e.call_sheet_on
      FROM production_days d JOIN estimates e ON e.id = d.estimate_id
     WHERE d.estimate_id = ? AND d.date IS NOT NULL AND d.status IN ('confirmed', 'pencilled') AND e.status <> 'declined'
     ORDER BY d.date, d.start_time, d.id
  `);
  const rowsOfEstimate = db.prepare('SELECT * FROM google_event_sync WHERE estimate_id = ?');
  const rowOfDay = db.prepare('SELECT * FROM google_event_sync WHERE day_id = ?');

  /**
   * The events one estimate should have: day id → { event, hash }. A day dated
   * before today with no event yet is left out (see WHICH DAYS).
   */
  function wantedFor(estimateId) {
    const have = new Map(rowsOfEstimate.all(estimateId).map((r) => [r.day_id, r]));
    const t = today();
    const out = new Map();
    for (const r of wantedQuery.all(estimateId)) {
      if (!YMD.test(r.date)) continue;
      const row = have.get(r.id) || rowOfDay.get(r.id);
      if (r.date < t && !(row && row.event_id)) continue;
      const event = eventFor(r, { appUrl });
      out.set(r.id, { event, hash: hashOf(event) });
    }
    return out;
  }

  // ── Marking: what differs, recorded as pending ───────────────────────────

  const insertRow = db.prepare(`
    INSERT INTO google_event_sync (day_id, estimate_id, event_id, pushed_hash, state, error, attempts, next_try_at, updated_at)
    VALUES (?, ?, NULL, NULL, 'pending', NULL, 0, NULL, ?)
  `);
  const setState = db.prepare(`
    UPDATE google_event_sync SET estimate_id = ?, state = ?, error = ?, attempts = ?, next_try_at = ?, updated_at = ? WHERE day_id = ?
  `);
  const deleteRow = db.prepare('DELETE FROM google_event_sync WHERE day_id = ?');

  /**
   * Brings one estimate's rows in line with what it should have. `explicit`
   * is a change the owner just made (or Sync existing): it sends a failed row
   * round again at once. The safety net's passes aren't: a row waiting out its
   * back-off keeps waiting.
   */
  function mark(estimateId, { explicit }) {
    const at = stamp();
    const wanted = wantedFor(estimateId);
    const have = new Map(rowsOfEstimate.all(estimateId).map((r) => [r.day_id, r]));
    for (const id of wanted.keys()) {
      if (!have.has(id)) {
        const other = rowOfDay.get(id);
        if (other) have.set(id, other);
      }
    }
    let touched = 0;
    for (const [id, w] of wanted) {
      const row = have.get(id);
      if (!row) {
        insertRow.run(id, estimateId, at);
        touched += 1;
        continue;
      }
      const dirty = !row.event_id || row.pushed_hash !== w.hash;
      if (dirty && (row.state === 'synced' || (row.state === 'error' && explicit))) {
        setState.run(estimateId, 'pending', null, 0, null, at, id);
        touched += 1;
      } else if (dirty && row.estimate_id !== estimateId) {
        setState.run(estimateId, row.state, row.error, row.attempts, row.next_try_at, at, id);
      } else if (!dirty && row.state !== 'synced') {
        // Put back as it was before the push went out: nothing to write.
        setState.run(estimateId, 'synced', null, 0, null, at, id);
      }
    }
    for (const [id, row] of have) {
      if (wanted.has(id) || row.estimate_id !== estimateId) continue;
      if (!row.event_id) {
        deleteRow.run(id);
      } else if (row.state === 'synced' || (row.state === 'error' && explicit)) {
        // No longer booked: its event is to go.
        setState.run(estimateId, 'pending', null, 0, null, at, id);
        touched += 1;
      }
    }
    return touched;
  }

  /** Estimates that have at least one row: the safety net's set. */
  const trackedIds = () => db.prepare('SELECT DISTINCT estimate_id FROM google_event_sync').all().map((r) => r.estimate_id);

  // ── Scheduling ───────────────────────────────────────────────────────────

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
    timerDue = 0;
    timerIsRetry = false;
  }

  /* A pass soon: after a change, a connect or a click. A stream of changes
     restarts the wait but may not hold a pass back past the cap. `retry` is a
     timer for a failed day's back-off: far off, so never capped and never
     shown as "syncing". */
  function schedule(delay, { restart = true, retry = false } = {}) {
    if (stopped) return;
    const t = now();
    if (!timer || timerIsRetry) firstWait = t;
    const wait = Math.max(0, retry ? delay : Math.min(delay, firstWait + maxWaitMs - t));
    if (timer && !restart && timerDue <= t + wait) return;
    if (timer) clearTimeout(timer);
    timerDue = t + wait;
    timerIsRetry = retry;
    timer = setTimeout(() => {
      timer = null;
      timerDue = 0;
      timerIsRetry = false;
      run().catch((err) => log('pass failed', err && err.message));
    }, wait);
    if (timer.unref) timer.unref();
  }

  /**
   * Marks the estimates a write changed, then schedules the push. Never throws:
   * a calendar problem must not fail the save that caused it. Nothing happens
   * while Google isn't connected ("if disconnected → nothing is queued").
   */
  function touch(estimateIds) {
    try {
      if (stopped || !enabled || !connected()) return;
      const ids = [...new Set((Array.isArray(estimateIds) ? estimateIds : [estimateIds]).filter(Boolean))];
      db.transaction(() => ids.forEach((id) => mark(id, { explicit: true })))();
      schedule(debounceMs);
    } catch (err) {
      log('touch failed', err && err.message);
    }
  }

  /** Any write at all: the safety net re-checks the estimates that have events. */
  function noteWrite() {
    try {
      if (stopped || !enabled || !connected()) return;
      if (!db.prepare('SELECT 1 FROM google_event_sync LIMIT 1').get()) return;
      schedule(debounceMs);
    } catch (err) {
      log('noteWrite failed', err && err.message);
    }
  }

  /** The projects' estimates, for the routes that act on a project. */
  const estimatesOfProject = (projectId) =>
    db.prepare('SELECT id FROM estimates WHERE project_id = ?').all(projectId).map((r) => r.id);

  // ── Talking to Google ────────────────────────────────────────────────────

  /* Create, or bring back, a day's event. The deterministic id makes a retry
     after a timeout find the event it already made; an id Google remembers
     from a deleted event is updated back to life. */
  async function create(dayId, event) {
    const id = eventIdOf(dayId);
    try {
      const made = await google.calendarApi(db, oauth, 'POST', CREATE_PATH, { ...event, id });
      return String(made.id || id);
    } catch (err) {
      if (!(err instanceof google.GoogleError) || err.status !== 409) throw err;
    }
    try {
      const back = await google.calendarApi(db, oauth, 'PUT', `${eventPath(id)}?sendUpdates=none`, event);
      return String(back.id || id);
    } catch (err) {
      if (!(err instanceof google.GoogleError) || !goneOnGoogle(err)) throw err;
    }
    const fresh = await google.calendarApi(db, oauth, 'POST', CREATE_PATH, event);
    return String(fresh.id);
  }

  async function write(row, w) {
    if (row.event_id) {
      try {
        const updated = await google.calendarApi(db, oauth, 'PUT', `${eventPath(row.event_id)}?sendUpdates=none`, w.event);
        return String(updated.id || row.event_id);
      } catch (err) {
        // Deleted in Google since: write it afresh.
        if (!(err instanceof google.GoogleError) || !goneOnGoogle(err)) throw err;
      }
    }
    return create(row.day_id, w.event);
  }

  async function remove(row) {
    try {
      await google.calendarApi(db, oauth, 'DELETE', `${eventPath(row.event_id)}?sendUpdates=none`);
    } catch (err) {
      // Already gone from Google is as good as removed.
      if (!(err instanceof google.GoogleError) || !goneOnGoogle(err)) throw err;
    }
  }

  const STOP_CODES = new Set(['reconnect', 'not_configured', 'not_connected']);

  /**
   * One pass: the safety net, then every due row. Returns when done. A refused
   * connection or a Google that isn't answering stops the pass (the rest stay
   * pending); one refused event doesn't. Resolves 'blocked' when the
   * connection itself is refused: nothing is tried again until it is
   * reconnected (`kick`), rather than asking Google for a token every minute.
   */
  async function pass() {
    if (!enabled || !connected() || !google.configured(oauth)) return 'blocked';
    // The safety net, then what is due.
    db.transaction(() => trackedIds().forEach((id) => mark(id, { explicit: false })))();
    const cutoff = stamp();
    const due = db.prepare(`
      SELECT * FROM google_event_sync
       WHERE state = 'pending' OR (state = 'error' AND next_try_at IS NOT NULL AND next_try_at <= ?)
       ORDER BY updated_at, day_id
    `).all(cutoff);

    const wantedCache = new Map();
    const wantedOf = (estimateId) => {
      if (!wantedCache.has(estimateId)) wantedCache.set(estimateId, wantedFor(estimateId));
      return wantedCache.get(estimateId);
    };
    for (const row of due) {
      if (stopped) return;
      const w = wantedOf(row.estimate_id).get(row.day_id);
      const at = stamp();
      try {
        if (!w) {
          if (row.event_id) await remove(row);
          deleteRow.run(row.day_id);
        } else if (row.event_id && row.pushed_hash === w.hash) {
          setState.run(row.estimate_id, 'synced', null, 0, null, at, row.day_id);
        } else {
          const eventId = await write(row, w);
          const kept = db.prepare(`
            UPDATE google_event_sync SET event_id = ?, pushed_hash = ?, state = 'synced', error = NULL,
                   attempts = 0, next_try_at = NULL, updated_at = ? WHERE day_id = ?
          `).run(eventId, w.hash, at, row.day_id);
          if (!kept.changes) {
            // The day stopped being booked while its event was being made
            // (mark dropped the row, which had no event yet). Keep the event's
            // id, pending, so the next pass deletes it rather than leaving it
            // in the calendar with nothing pointing at it (task 16).
            db.prepare(`
              INSERT INTO google_event_sync (day_id, estimate_id, event_id, pushed_hash, state, error, attempts, next_try_at, updated_at)
              VALUES (?, ?, ?, ?, 'pending', NULL, 0, NULL, ?)
            `).run(row.day_id, row.estimate_id, eventId, w.hash, at);
            again = true;
          }
        }
      } catch (err) {
        if (!(err instanceof google.GoogleError)) throw err;
        if (STOP_CODES.has(err.code)) return 'blocked';
        const attempts = (row.attempts || 0) + 1;
        const wait = BACKOFF_MS[attempts - 1];
        setState.run(row.estimate_id, 'error', err.code + (err.status ? ` (${err.status})` : ''), attempts,
          wait ? new Date(now() + wait).toISOString() : null, at, row.day_id);
        if (err.code === 'unavailable') return; // Google isn't answering: don't hammer it
      }
    }
  }

  /** The earliest time something should be tried again, or null. */
  function nextDue() {
    const r = db.prepare("SELECT MIN(next_try_at) AS at FROM google_event_sync WHERE state = 'error' AND next_try_at IS NOT NULL").get();
    const pending = db.prepare("SELECT 1 FROM google_event_sync WHERE state = 'pending' LIMIT 1").get();
    const times = [];
    if (r && r.at) times.push(Date.parse(r.at));
    // Pending rows left over (a pass stopped early): look again in a minute.
    if (pending) times.push(now() + BACKOFF_MS[0]);
    return times.length ? Math.min(...times) : null;
  }

  /** Runs a pass now (or after the one in flight), and whatever it was asked while running. */
  function run() {
    if (holds) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    clearTimer();
    running = (async () => {
      let blocked = false;
      try {
        do {
          again = false;
          // eslint-disable-next-line no-await-in-loop
          blocked = (await pass()) === 'blocked';
        } while (again && !stopped);
      } finally {
        running = null;
        if (!stopped && !blocked && connected()) {
          const next = nextDue();
          if (next !== null) schedule(Math.max(1000, next - now()), { restart: false, retry: true });
        }
      }
    })();
    return running;
  }

  // ── What the routes use ──────────────────────────────────────────────────

  const statusOf = () => {
    const c = db.prepare(`
      SELECT SUM(state = 'pending') AS pending, SUM(state = 'error') AS errors,
             MAX(CASE WHEN state = 'synced' THEN updated_at END) AS last
        FROM google_event_sync
    `).get();
    return {
      enabled,
      pending: c.pending || 0,
      errors: c.errors || 0,
      // Under way, or about to be with something to write (a far-off retry, or
      // a check with nothing waiting, isn't "syncing").
      running: Boolean(running) || (timer !== null && !timerIsRetry && (c.pending || 0) > 0),
      lastSyncedAt: c.last || null,
    };
  };

  return {
    touch,
    touchProject(projectId) {
      try {
        touch(estimatesOfProject(projectId));
      } catch (err) {
        log('touchProject failed', err && err.message);
      }
    },
    noteWrite,
    estimatesOfProject,
    status: statusOf,
    /** Settings → Retry: every failed day goes round again now. */
    retryErrors() {
      if (!enabled) return;
      db.prepare(`
        UPDATE google_event_sync SET state = 'pending', attempts = 0, next_try_at = NULL, updated_at = ? WHERE state = 'error'
      `).run(stamp());
      schedule(0);
    },
    /** Settings → Sync existing bookings: every current booked day, once. */
    syncExisting() {
      if (!enabled) return;
      db.transaction(() => {
        db.prepare("SELECT id FROM estimates WHERE status <> 'declined'").all()
          .forEach((e) => mark(e.id, { explicit: true }));
      })();
      schedule(0);
    },
    /** Connected again: whatever waited on a refused connection goes out in a moment. */
    kick() { if (enabled) schedule(debounceMs, { restart: false }); },
    /** A disconnect is starting: nothing new starts, and the pass in flight
        lands first, so every event it made has its id in a row before the
        rows are read (task 16). Pair with release(). */
    async hold() {
      holds += 1;
      clearTimer();
      if (running) await running.catch(() => {});
    },
    /** The disconnect is over: anything still owed is scheduled again. */
    release() {
      holds = Math.max(0, holds - 1);
      if (holds || stopped || !enabled || !connected()) return;
      const next = nextDue();
      if (next !== null) schedule(Math.max(1000, next - now()), { restart: false, retry: true });
    },
    /** Run now and wait for it, whatever the debounce says (tests, shutdown). */
    async flush() {
      clearTimer();
      await run();
    },
    /** Start-up: rows left pending by a restart go out shortly after boot. */
    start() {
      if (enabled && connected() && db.prepare("SELECT 1 FROM google_event_sync WHERE state <> 'synced' LIMIT 1").get()) schedule(debounceMs);
    },
    stop() {
      stopped = true;
      clearTimer();
    },
    // For tests.
    wantedFor,
    mark,
  };
}

module.exports = {
  createGoogleSync, eventFor, whenOf, tripSummary, eventIdOf, hashOf, BACKOFF_MS, ZONE,
};
