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

/**
 * Lines pointing at days that don't fit: a `dayId` outside the production
 * section (only `prod` is on set, D24), or one naming no day of this estimate.
 * Either would be a line whose stored price and printed day disagree.
 * @returns {string|null} an error code.
 */
function lineDayProblem(activeRows, days) {
  const ids = new Set(days.map((d) => d.id));
  const rows = activeRows || {};
  for (const key of Object.keys(rows)) {
    if (!Array.isArray(rows[key])) continue;
    for (const line of rows[key]) {
      if (!line || line.dayId === undefined || line.dayId === null || line.dayId === '') continue;
      if (key !== 'prod') return 'day_on_non_production_line';
      if (!ids.has(String(line.dayId))) return 'line_day_unknown';
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
 * Declined estimates are excluded once task 15 adds that status; until then
 * every estimate's confirmed days count.
 *
 * @returns {{date, estimateId, upid, name}|null}
 */
function lockedDay(db, estimateId, days, storedDays) {
  const before = new Map((storedDays || []).map((d) => [d.id, d]));
  const confirmedElsewhere = db.prepare(`
    SELECT e.id AS estimate_id, e.upid, e.name
      FROM production_days d JOIN estimates e ON e.id = d.estimate_id
     WHERE d.date = ? AND d.status = 'confirmed' AND d.estimate_id <> ?
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

/** Replaces an estimate's days with `days`, in their order. Call inside the save's transaction. */
function replaceDays(db, estimateId, days, now) {
  const created = new Map();
  for (const r of db.prepare('SELECT id, created_at FROM production_days WHERE estimate_id = ?').all(estimateId)) {
    created.set(r.id, r.created_at);
  }
  db.prepare('DELETE FROM production_days WHERE estimate_id = ?').run(estimateId);
  const insert = db.prepare(`
    INSERT INTO production_days
      (id, estimate_id, date, status, start_time, end_time, override_note, sort, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  days.forEach((d, i) => {
    insert.run(d.id, estimateId, d.date, d.status, d.startTime, d.endTime, d.overrideNote, i,
      created.get(d.id) || now, now);
  });
}

module.exports = {
  DAY_STATUSES,
  readDays,
  readDaysByEstimate,
  readHolidays,
  parseDays,
  lineDayProblem,
  dayIdTakenElsewhere,
  lockedDay,
  replaceDays,
};
