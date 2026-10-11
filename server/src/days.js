'use strict';

const { dayKind, lineDef, tripKindOf, tripLineQty } = require('./calc');

/**
 * Production days (v11, .design/production-booking/ task 2): an estimate's
 * booked days, read, checked and replaced in one place for the estimate routes
 * and the calendar.
 *
 * A day travels as { id, date, status, startTime, endTime, overrideNote }.
 * The id is made by the browser, because the editor's production lines point
 * at their day (`dayId`) before the estimate has ever been saved.
 *
 * Since v16 (.design/trip-planner/ task 1) a day may also carry `trip`, its
 * planned drive (parseTrip), or null for none.
 */

const DAY_STATUSES = ['confirmed', 'pencilled', 'proposed'];
const DAY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MAX_DAYS = 200;
const MAX_NOTE = 500;

/* A trip's limits (trip-planner task 1). 23 destinations is Google's waypoint
   limit (the brief's default), plus the start and the return. The caps on
   figures are sanity bounds, not policy: nothing real comes near them. */
const MAX_TRIP_DESTINATIONS = 23;
const MAX_TRIP_TEXT = 2000;
const MAX_ADDRESS = 300;
const MAX_PLACE_ID = 300;
const MAX_POLYLINE = 50000;
const MAX_TRIP_KM = 100000;
const MAX_TRIP_MINUTES = 100000;
const ROUTE_SIG = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MINUTES_ON_SITE = 24 * 60;
const MAX_STAMP = 40;
const DETAIL_KEYS = ['capture', 'description', 'access'];

function dayFromRow(r) {
  return {
    id: r.id,
    date: r.date || null,
    status: r.status,
    startTime: r.start_time || null,
    endTime: r.end_time || null,
    overrideNote: r.override_note || '',
    trip: r.trip_json ? JSON.parse(r.trip_json) : null,
  };
}

/** One estimate's days, in the order the editor saved them. */
function readDays(db, estimateId) {
  return db.prepare('SELECT * FROM production_days WHERE estimate_id = ? ORDER BY sort, id')
    .all(estimateId).map(dayFromRow);
}

/** Every estimate's days, keyed by estimate id — one query for a list. */
function readDaysByEstimate(db) {
  const out = new Map();
  for (const r of db.prepare('SELECT * FROM production_days ORDER BY estimate_id, sort, id').all()) {
    if (!out.has(r.estimate_id)) out.set(r.estimate_id, []);
    out.get(r.estimate_id).push(dayFromRow(r));
  }
  return out;
}

/** The holiday list, as calc.js dayKind reads it. */
function readHolidays(db) {
  return db.prepare('SELECT date, hidden FROM holidays').all();
}

/* 'HH:MM', or null for blank. A time input may send seconds; they're dropped. */
function clockOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = String(v).trim();
  return CLOCK.test(t) ? t.slice(0, 5) : undefined;
}

/* A finite number in [lo, hi], or undefined. */
function numberIn(v, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}

/* An optional short stamp (a leg's clock time, routedAt): a string up to
   MAX_STAMP, or null. Undefined for anything else. */
function stampOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  return typeof v === 'string' && v.length <= MAX_STAMP ? v : undefined;
}

/**
 * A day's `trip` (IA "Data & API" appendix), checked and normalised: the
 * fields it names and no others. Null or an empty stop list is no trip.
 *
 * STOPS run START, then up to 23 destinations ('stop'), then an optional
 * RETURN, which needs a destination before it. A RETURN has no place of its
 * own: it always mirrors START, so whatever it was sent with is replaced by
 * START's address, coordinates and place id here. Only destinations carry
 * `minutesOnSite` and `details` (a details key present means its field is
 * shown, even blank).
 *
 * UNLINKED (optional) lists the kinds of line the owner took off the trip.
 *
 * LEGS are stored as sent: they come from the last good route, and after a
 * failed re-route the browser keeps the last good figures (task 4), so the
 * leg count needn't match the stops. TOTALS are what bills (calc.js
 * tripLineQty), so they are the legs' sum, worked out here (task 16).
 *
 * @returns {{trip:object|null}|{error:string}}
 */
function parseTrip(raw) {
  if (raw === null) return { trip: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.stops)) return { error: 'trip_invalid' };
  if (!raw.stops.length) return { trip: null };
  if (raw.stops.filter((s) => s && s.role === 'stop').length > MAX_TRIP_DESTINATIONS) return { error: 'trip_too_many_stops' };
  if (raw.stops.length > MAX_TRIP_DESTINATIONS + 2) return { error: 'trip_invalid' };

  const ids = new Set();
  const stops = [];
  for (let i = 0; i < raw.stops.length; i += 1) {
    const s = raw.stops[i];
    if (!s || typeof s !== 'object') return { error: 'trip_invalid' };
    const last = i === raw.stops.length - 1;
    // START first and only first; RETURN last, never straight after START.
    const roleOk = i === 0 ? s.role === 'start'
      : s.role === 'stop' || (s.role === 'return' && last && i >= 2);
    if (!roleOk) return { error: 'trip_invalid' };
    if (typeof s.id !== 'string' || !DAY_ID.test(s.id) || ids.has(s.id)) return { error: 'trip_invalid' };
    ids.add(s.id);
    if (s.role === 'return') {
      const start = stops[0];
      stops.push({ id: s.id, role: 'return', address: start.address, lat: start.lat, lng: start.lng, placeId: start.placeId });
      continue;
    }

    if (typeof s.address !== 'string') return { error: 'trip_invalid' };
    const address = s.address.trim();
    if (address.length > MAX_ADDRESS) return { error: 'trip_text_too_long' };
    const lat = numberIn(s.lat, -90, 90);
    const lng = numberIn(s.lng, -180, 180);
    if (lat === undefined || lng === undefined) return { error: 'trip_invalid' };
    const placeId = s.placeId === undefined || s.placeId === null ? '' : s.placeId;
    if (typeof placeId !== 'string' || placeId.length > MAX_PLACE_ID) return { error: 'trip_invalid' };
    const stop = { id: s.id, role: s.role, address, lat, lng, placeId };

    if (s.role === 'stop') {
      if (s.minutesOnSite !== undefined && s.minutesOnSite !== null) {
        const m = numberIn(s.minutesOnSite, 0, MAX_MINUTES_ON_SITE);
        if (m === undefined || !Number.isInteger(m)) return { error: 'trip_invalid' };
        stop.minutesOnSite = m;
      }
      if (s.details !== undefined && s.details !== null) {
        if (typeof s.details !== 'object' || Array.isArray(s.details)) return { error: 'trip_invalid' };
        const details = {};
        for (const key of DETAIL_KEYS) {
          if (s.details[key] === undefined) continue;
          if (typeof s.details[key] !== 'string') return { error: 'trip_invalid' };
          if (s.details[key].length > MAX_TRIP_TEXT) return { error: 'trip_text_too_long' };
          details[key] = s.details[key];
        }
        stop.details = details;
      }
    }
    stops.push(stop);
  }

  const rawLegs = raw.legs === undefined || raw.legs === null ? [] : raw.legs;
  if (!Array.isArray(rawLegs) || rawLegs.length > MAX_TRIP_DESTINATIONS + 1) return { error: 'trip_invalid' };
  const legs = [];
  for (const l of rawLegs) {
    if (!l || typeof l !== 'object') return { error: 'trip_invalid' };
    const km = numberIn(l.km, 0, MAX_TRIP_KM);
    const minutes = numberIn(l.minutes, 0, MAX_TRIP_MINUTES);
    const departAt = stampOrNull(l.departAt);
    const arriveAt = stampOrNull(l.arriveAt);
    if (km === undefined || minutes === undefined || departAt === undefined || arriveAt === undefined) return { error: 'trip_invalid' };
    const leg = { km, minutes };
    if (departAt !== null) leg.departAt = departAt;
    if (arriveAt !== null) leg.arriveAt = arriveAt;
    legs.push(leg);
  }

  // The totals sent are checked, then replaced by the sum of the legs: they
  // bill (tripLineQty), so the server works them out rather than taking the
  // browser's word. Legs and totals always come from the same route (the last
  // good one), and the sum runs in the browser's order, so an honest trip's
  // figures come out the same to the last bit.
  const rawTotals = raw.totals === undefined || raw.totals === null ? { km: 0, minutes: 0 } : raw.totals;
  if (typeof rawTotals !== 'object') return { error: 'trip_invalid' };
  if (numberIn(rawTotals.km, 0, MAX_TRIP_KM) === undefined || numberIn(rawTotals.minutes, 0, MAX_TRIP_MINUTES) === undefined) {
    return { error: 'trip_invalid' };
  }
  const totals = {
    km: legs.reduce((sum, l) => sum + l.km, 0),
    minutes: legs.reduce((sum, l) => sum + l.minutes, 0),
  };
  if (totals.km > MAX_TRIP_KM || totals.minutes > MAX_TRIP_MINUTES) return { error: 'trip_invalid' };

  const polyline = raw.polyline === undefined || raw.polyline === null ? '' : raw.polyline;
  if (typeof polyline !== 'string' || polyline.length > MAX_POLYLINE) return { error: 'trip_invalid' };

  let routedFor = null;
  if (raw.routedFor !== undefined && raw.routedFor !== null) {
    const f = raw.routedFor;
    if (typeof f !== 'object') return { error: 'trip_invalid' };
    const date = f.date === undefined || f.date === null || f.date === '' ? null : String(f.date);
    if (date !== null && dayKind(date, {}, []) === null) return { error: 'trip_invalid' };
    const startTime = clockOrNull(f.startTime);
    if (startTime === undefined || typeof f.traffic !== 'boolean') return { error: 'trip_invalid' };
    routedFor = { date, startTime, traffic: f.traffic };
    // Which stops the route was worked out for (trip-planner task 4): a short
    // signature the browser makes, so a trip saved after a failed re-route
    // reads as out of date when it is reopened. Optional; never interpreted here.
    if (f.stops !== undefined && f.stops !== null && f.stops !== '') {
      if (typeof f.stops !== 'string' || !ROUTE_SIG.test(f.stops)) return { error: 'trip_invalid' };
      routedFor.stops = f.stops;
    }
  }
  const routedAt = stampOrNull(raw.routedAt);
  if (routedAt === undefined || (routedAt !== null && Number.isNaN(Date.parse(routedAt)))) return { error: 'trip_invalid' };

  const trip = { stops, legs, totals, polyline, routedFor, routedAt };
  /* The kinds of line the owner unlinked from this trip (task 6, T4): the
     trip then stops writing a line of that kind on its day, so an unlinked
     line isn't joined by a fresh linked one on the next route. Stored only
     when there is one. */
  if (raw.unlinked !== undefined && raw.unlinked !== null) {
    if (!Array.isArray(raw.unlinked)) return { error: 'trip_invalid' };
    const kinds = new Set();
    for (const k of raw.unlinked) {
      if (k !== 'km' && k !== 'hours') return { error: 'trip_invalid' };
      kinds.add(k);
    }
    if (kinds.size) trip.unlinked = ['km', 'hours'].filter((k) => kinds.has(k));
  }
  return { trip };
}

/**
 * A request's `days`, checked and normalised.
 *
 * A day sent with no `trip` key keeps the trip its id had (`storedDays`),
 * and `trip: null` removes it. Every save replaces the days whole, and a
 * browser built before trips existed (a cached Pages copy) sends none: losing
 * a planned trip is the expensive direction, as losing days is
 * (routes/estimates.js prepareWrite).
 *
 * @param {Array<object>} [storedDays] — the estimate's days as stored.
 * @returns {{days:Array<object>}|{error:string}}
 */
function parseDays(raw, storedDays) {
  if (!Array.isArray(raw)) return { error: 'days_not_a_list' };
  if (raw.length > MAX_DAYS) return { error: 'too_many_days' };
  const stored = new Map((storedDays || []).map((d) => [d.id, d]));
  const seen = new Set();
  const days = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object') return { error: 'day_invalid' };
    const id = typeof d.id === 'string' ? d.id : '';
    if (!DAY_ID.test(id)) return { error: 'day_id_invalid' };
    if (seen.has(id)) return { error: 'day_id_duplicate' };
    seen.add(id);

    const blankDate = d.date === null || d.date === undefined || d.date === '';
    const date = blankDate ? null : String(d.date).trim();
    // dayKind answers null for anything that isn't a real calendar date.
    if (date !== null && dayKind(date, {}, []) === null) return { error: 'day_date_invalid' };

    if (DAY_STATUSES.indexOf(d.status) === -1) return { error: 'day_status_invalid' };

    const startTime = clockOrNull(d.startTime);
    const endTime = clockOrNull(d.endTime);
    if (startTime === undefined || endTime === undefined) return { error: 'day_time_invalid' };

    const note = typeof d.overrideNote === 'string' ? d.overrideNote.trim() : '';
    if (note.length > MAX_NOTE) return { error: 'day_note_too_long' };

    let trip = null;
    if (d.trip === undefined) {
      trip = stored.has(id) ? stored.get(id).trip || null : null;
    } else {
      const parsed = parseTrip(d.trip);
      if (parsed.error) return { error: parsed.error };
      trip = parsed.trip;
    }

    days.push({ id, date, status: d.status, startTime, endTime, overrideNote: note, trip });
  }
  return { days };
}

/* The sections whose lines may sit on a day (D74): Production, and since B2
   the travel, crew and gear booked for it. Only `prod` is ever surcharged
   (D3, D24; calc.js computeTotals), wherever the others sit. */
const ON_SET_KEYS = ['prod', 'travel', 'crew', 'equip'];

/**
 * Lines pointing at days that don't fit: a `dayId` outside the on-set
 * sections (ON_SET_KEYS), or one naming no day of this estimate. Either would
 * be a line whose stored price and printed day disagree. The first code keeps
 * its pre-B2 name: it now means "not an on-set line".
 * @returns {string|null} an error code.
 */
function lineDayProblem(activeRows, days) {
  const ids = new Set(days.map((d) => d.id));
  const rows = activeRows || {};
  for (const key of Object.keys(rows)) {
    if (!Array.isArray(rows[key])) continue;
    for (const line of rows[key]) {
      if (!line || line.dayId === undefined || line.dayId === null || line.dayId === '') continue;
      if (ON_SET_KEYS.indexOf(key) === -1) return 'day_on_non_production_line';
      if (!ids.has(String(line.dayId))) return 'line_day_unknown';
    }
  }
  return null;
}

/**
 * The travel lines a trip sets (trip-planner task 1, T3, T4; calc.js A DAY'S
 * TRIP): a copy of `activeRows` in which each line marked `fromTrip` takes its
 * quantity from its day's trip (calc.js tripLineQty), whatever quantity was
 * sent.
 *
 * `fromTrip` is dropped, leaving the line as an ordinary one at the quantity
 * sent, from a line that:
 *   - isn't in Travel;
 *   - sits on no day, or on a day with no trip;
 *   - names a kind other than 'km' or 'hours', or one its own snapshot isn't
 *     (calc.js tripKindOf: a km figure never lands on an hourly line);
 *   - is a second line of the same kind on the same day: one trip bills its
 *     road once.
 *
 * Call after lineDayProblem has passed, with the days being saved.
 */
function applyTripLines(activeRows, days, pricing) {
  const rows = activeRows || {};
  const trips = new Map(days.filter((d) => d.trip).map((d) => [d.id, d.trip]));
  const travelDefs = (pricing && pricing.travelRows) || [];
  const linked = new Set();
  const out = {};
  for (const key of Object.keys(rows)) {
    if (!Array.isArray(rows[key])) {
      out[key] = rows[key];
      continue;
    }
    out[key] = rows[key].map((line) => {
      if (!line || typeof line !== 'object' || !Object.prototype.hasOwnProperty.call(line, 'fromTrip')) return line;
      const { fromTrip, ...rest } = line;
      if (key !== 'travel' || (fromTrip !== 'km' && fromTrip !== 'hours')) return rest;
      const dayId = line.dayId === undefined || line.dayId === null ? '' : String(line.dayId);
      const trip = trips.get(dayId);
      if (!trip || tripKindOf(lineDef(travelDefs, line, pricing)) !== fromTrip) return rest;
      const slot = `${dayId} ${fromTrip}`;
      if (linked.has(slot)) return rest;
      linked.add(slot);
      return Object.assign(rest, { qty: tripLineQty(trip, fromTrip), fromTrip });
    });
  }
  return out;
}

/**
 * The post-production planner's links (B2-2, D95): each deliverable's `id`,
 * and the post line that names it with `deliverableId`. A deliverable saved
 * before B2 has no id and is fine. One with an id must have a usable, unique
 * one, and a `deliverableId` must sit on a `post` line and name one of them —
 * otherwise the line's tag on the client's document would name nothing, or the
 * wrong thing.
 * @returns {string|null} an error code.
 */
function lineDeliverableProblem(activeRows) {
  const rows = activeRows || {};
  const ids = new Set();
  for (const d of Array.isArray(rows.deliverables) ? rows.deliverables : []) {
    if (!d || d.id === undefined || d.id === null || d.id === '') continue;
    if (typeof d.id !== 'string' || !DAY_ID.test(d.id)) return 'deliverable_id_invalid';
    if (ids.has(d.id)) return 'deliverable_id_duplicate';
    ids.add(d.id);
  }
  for (const key of Object.keys(rows)) {
    if (!Array.isArray(rows[key])) continue;
    for (const line of rows[key]) {
      if (!line || line.deliverableId === undefined || line.deliverableId === null || line.deliverableId === '') continue;
      if (key !== 'post') return 'deliverable_on_non_post_line';
      if (!ids.has(String(line.deliverableId))) return 'line_deliverable_unknown';
    }
  }
  return null;
}

/** A day id already used by another estimate, or null. */
function dayIdTakenElsewhere(db, estimateId, days) {
  const owner = db.prepare('SELECT estimate_id FROM production_days WHERE id = ?');
  for (const d of days) {
    const row = owner.get(d.id);
    if (row && row.estimate_id !== estimateId) return d.id;
  }
  return null;
}

/**
 * The first day that may not be saved because another estimate has CONFIRMED
 * its date (D15, D16), or null.
 *
 * A day carrying a specification note is let through: the note is the
 * override. Another estimate's pencilled or proposed day never blocks.
 *
 * Only a day that is new, has moved date, or has just become confirmed is
 * checked. A day already saved where it is stays saveable: otherwise an
 * estimate that pencilled a date first could never be edited again once
 * another confirmed it — the clash is for the user to sort out, and accepting
 * flags it (D18) rather than refusing.
 *
 * A declined estimate's days leave every calendar (D22), so they lock
 * nothing; reopening re-runs this check (task 18).
 *
 * @returns {{date, estimateId, upid, name}|null}
 */
function lockedDay(db, estimateId, days, storedDays) {
  const before = new Map((storedDays || []).map((d) => [d.id, d]));
  const confirmedElsewhere = db.prepare(`
    SELECT e.id AS estimate_id, e.upid, e.name
      FROM production_days d JOIN estimates e ON e.id = d.estimate_id
     WHERE d.date = ? AND d.status = 'confirmed' AND d.estimate_id <> ? AND e.status <> 'declined'
     ORDER BY e.upid, e.id LIMIT 1
  `);
  for (const d of days) {
    if (d.date === null || d.overrideNote) continue;
    const was = before.get(d.id);
    const changed = !was || was.date !== d.date || (d.status === 'confirmed' && was.status !== 'confirmed');
    if (!changed) continue;
    const hit = confirmedElsewhere.get(d.date, estimateId || '');
    if (hit) return { date: d.date, estimateId: hit.estimate_id, upid: hit.upid, name: hit.name };
  }
  return null;
}

/**
 * Replaces an estimate's days with `days`, in their order. Call inside the
 * save's transaction.
 *
 * The "clash, rebook" flag (v13, task 19, D18) is the server's, never the
 * browser's: a day keeps it while it stays on the same date with no
 * specification note. Moving it, or noting why it may share the date (D16),
 * is the owner sorting the clash out, and clears it.
 */
function replaceDays(db, estimateId, days, now) {
  const stored = new Map();
  for (const r of db.prepare('SELECT * FROM production_days WHERE estimate_id = ?').all(estimateId)) {
    stored.set(r.id, r);
  }
  // A day that had a trip and has it no more (removed, or its trip cleared)
  // takes its stamp with it, so the call sheet's "Updated" (public.js
  // callSheetUpdatedAt, the newest of the days with a trip) wouldn't move.
  // The days that still have one are stamped instead (task 16).
  const kept = new Map(days.map((d) => [d.id, d]));
  const tripGone = [...stored.values()].some((was) => was.trip_json && !(kept.get(was.id) || {}).trip);
  db.prepare('DELETE FROM production_days WHERE estimate_id = ?').run(estimateId);
  const insert = db.prepare(`
    INSERT INTO production_days
      (id, estimate_id, date, status, start_time, end_time, override_note, sort, rebook, trip_json, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  days.forEach((d, i) => {
    const was = stored.get(d.id);
    const rebook = was && was.rebook === 1 && was.date === d.date && !d.overrideNote ? 1 : 0;
    const tripJson = d.trip ? JSON.stringify(d.trip) : null;
    // A day saved as it already was keeps its `updated_at`. Every save
    // replaces the days whole, so without this each autosave of anything would
    // restamp them, and the call sheet's "Updated" (public.js
    // callSheetUpdatedAt, T18) would move on an edit to a price.
    const unchanged = was && was.date === d.date && was.status === d.status && was.start_time === d.startTime &&
      was.end_time === d.endTime && was.override_note === d.overrideNote && was.sort === i &&
      was.rebook === rebook && was.trip_json === tripJson && !(tripGone && tripJson);
    insert.run(d.id, estimateId, d.date, d.status, d.startTime, d.endTime, d.overrideNote, i, rebook,
      tripJson, (was && was.created_at) || now, unchanged ? was.updated_at : now);
  });
}

module.exports = {
  DAY_STATUSES,
  readDays,
  readDaysByEstimate,
  readHolidays,
  parseDays,
  parseTrip,
  ON_SET_KEYS,
  lineDayProblem,
  applyTripLines,
  lineDeliverableProblem,
  dayIdTakenElsewhere,
  lockedDay,
  replaceDays,
};
