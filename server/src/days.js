'use strict';

const { dayKind } = require('./calc');

/**
 * Production days (v11, .design/production-booking/ task 2): an estimate's
 * booked days, read, checked and replaced in one place for the estimate routes
 * and the calendar.
 *
 * A day travels as { id, date, status, startTime, endTime, overrideNote }.
 * The id is made by the browser, because the editor's production lines point
 * at their day (`dayId`) before the estimate has ever been saved.
 */

const DAY_STATUSES = ['confirmed', 'pencilled', 'proposed'];
const DAY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MAX_DAYS = 200;
const MAX_NOTE = 500;

function dayFromRow(r) {
  return {
    id: r.id,
    date: r.date || null,
    status: r.status,
    startTime: r.start_time || null,
    endTime: r.end_time || null,
    overrideNote: r.override_note || '',
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

/**
 * A request's `days`, checked and normalised.
 * @returns {{days:Array<object>}|{error:string}}
 */
function parseDays(raw) {
  if (!Array.isArray(raw)) return { error: 'days_not_a_list' };
  if (raw.length > MAX_DAYS) return { error: 'too_many_days' };
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

    days.push({ id, date, status: d.status, startTime, endTime, overrideNote: note });
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
  for (const r of db.prepare('SELECT id, date, rebook, created_at FROM production_days WHERE estimate_id = ?').all(estimateId)) {
    stored.set(r.id, r);
  }
  db.prepare('DELETE FROM production_days WHERE estimate_id = ?').run(estimateId);
  const insert = db.prepare(`
    INSERT INTO production_days
      (id, estimate_id, date, status, start_time, end_time, override_note, sort, rebook, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  days.forEach((d, i) => {
    const was = stored.get(d.id);
    const rebook = was && was.rebook === 1 && was.date === d.date && !d.overrideNote ? 1 : 0;
    insert.run(d.id, estimateId, d.date, d.status, d.startTime, d.endTime, d.overrideNote, i, rebook,
      (was && was.created_at) || now, now);
  });
}

module.exports = {
  DAY_STATUSES,
  readDays,
  readDaysByEstimate,
  readHolidays,
  parseDays,
  ON_SET_KEYS,
  lineDayProblem,
  lineDeliverableProblem,
  dayIdTakenElsewhere,
  lockedDay,
  replaceDays,
};
