'use strict';

const { nowIso } = require('../db');
const { annualBillableHours } = require('../calc');

// The reference defaults migration v5 seeds onto every pre-existing goals row
// (8 / 5 / 30 / 8 — see db.js). Used here only for a goals row that is being
// INSERTed for the very first time by a caller that predates the Capacity
// screen and so never sends these five fields; an UPDATE falls back to
// whatever is already stored, never to these.
const CAPACITY_DEFAULTS = {
  billableHoursPerDay: 8,
  workingDaysPerWeek: 5,
  leaveDaysPerYear: 30,
  sickDaysPerYear: 8,
};

function loadGoals(row) {
  if (!row) {
    return {
      desiredNetIncome: null,
      targetProfitMarginPct: null,
      billableCapacityHrsPerWeek: null,
      billableHoursPerDay: null,
      workingDaysPerWeek: null,
      leaveDaysPerYear: null,
      sickDaysPerYear: null,
      iawoThreshold: null,
      capacityConfirmedAt: null,
      superPct: null,
      badDebtPct: null,
    };
  }
  return {
    desiredNetIncome: row.desired_net_income,
    targetProfitMarginPct: row.target_profit_margin_pct,
    billableCapacityHrsPerWeek: row.billable_capacity_hrs_per_week,
    billableHoursPerDay: row.billable_hours_per_day,
    workingDaysPerWeek: row.working_days_per_week,
    leaveDaysPerYear: row.leave_days_per_year,
    sickDaysPerYear: row.sick_days_per_year,
    iawoThreshold: row.iawo_threshold,
    capacityConfirmedAt: row.capacity_confirmed_at,
    superPct: row.super_pct === undefined ? null : row.super_pct,
    badDebtPct: row.bad_debt_pct === undefined ? null : row.bad_debt_pct,
  };
}

/**
 * Resolves super_pct or bad_debt_pct for a PUT (migration v7): the body's
 * value when sent (null or '' clears it), otherwise what is stored, otherwise
 * null. Unset reads as 0% everywhere, and the screen says so.
 * @returns {{value:number|null}|{error:string}}
 */
function resolvePct(body, existing, key, column, max) {
  if (body[key] === undefined) return { value: existing && existing[column] !== undefined ? existing[column] : null };
  if (body[key] === null || body[key] === '') return { value: null };
  const n = Number(body[key]);
  if (!Number.isFinite(n) || n < 0 || n >= max) return { error: column + '_out_of_range' };
  return { value: n };
}

// The four fields only the Capacity screen sends together. A PUT carrying all
// four is that screen's save, and is what confirms the v5-seeded defaults.
const CAPACITY_KEYS = ['billableHoursPerDay', 'workingDaysPerWeek', 'leaveDaysPerYear', 'sickDaysPerYear'];

/**
 * Resolves desiredNetIncome or targetProfitMarginPct for a PUT: the body's
 * value when the caller sent it, otherwise what is already stored, otherwise
 * NULL — never 0.
 *
 * WHY: this row has two writers since the Capacity screen shipped, and each
 * sends only its own fields. This used to be `Number(body.x) || 0` for both,
 * which meant a Capacity save silently zeroed the income target and the profit
 * margin — and a 0% margin is not an empty state, it is a break-even floor that
 * minimumJobPrice() prices every job against. Migration v6 made both columns
 * nullable so that a Capacity save onto a row that doesn't exist yet can leave
 * them unset instead of inventing a number.
 *
 * A value that IS sent keeps the old coercion exactly (`Number(x) || 0`), so
 * the Goals screen's saves behave as before.
 */
function resolveGoalField(body, existing, key, column) {
  if (body[key] !== undefined) return Number(body[key]) || 0;
  if (existing && existing[column] !== undefined) return existing[column];
  return null;
}

/**
 * Resolves one capacity field for a PUT: the body's value when the caller
 * sent it, otherwise the value already on the row, otherwise the reference
 * default.
 *
 * WHY THIS MATTERS: the Capacity screen is the only UI that sends these
 * fields. `views/goals.js` PUTs only desiredNetIncome / targetProfitMarginPct /
 * billableCapacityHrsPerWeek — and this route's INSERT ... ON CONFLICT DO
 * UPDATE writes every column on every save. Without this fallback, a Goals
 * save would silently zero out the capacity the Capacity screen set, or (on a
 * brand new row) write zeros instead of the seeded defaults. Falling back to
 * "whatever is stored" rather than "the default" for an UPDATE also means a
 * user's own edited values are never quietly reset to 8/5/30/8 by an
 * old-shaped request.
 */
function resolveCapacityField(body, existing, key, column, fallback) {
  if (body[key] !== undefined) return Number(body[key]);
  if (existing && existing[column] !== null && existing[column] !== undefined) return existing[column];
  return fallback;
}

/**
 * @returns {string|null} an error code, or null when the assembled capacity is
 *   valid. Runs on the RESOLVED values (body, or fallback) — not just on
 *   whatever the caller happened to send — so a bad value already sitting on
 *   the row from some earlier, looser write cannot survive untouched forever.
 */
function validateCapacity(v) {
  if (!Number.isFinite(v.workingDaysPerWeek) || v.workingDaysPerWeek < 1 || v.workingDaysPerWeek > 7) {
    return 'working_days_per_week_out_of_range';
  }
  if (!Number.isFinite(v.billableHoursPerDay) || v.billableHoursPerDay < 0 || v.billableHoursPerDay > 24) {
    return 'billable_hours_per_day_out_of_range';
  }
  if (!Number.isFinite(v.leaveDaysPerYear) || v.leaveDaysPerYear < 0) {
    return 'leave_days_per_year_invalid';
  }
  if (!Number.isFinite(v.sickDaysPerYear) || v.sickDaysPerYear < 0) {
    return 'sick_days_per_year_invalid';
  }
  if (v.iawoThreshold !== null && (!Number.isFinite(v.iawoThreshold) || v.iawoThreshold < 0)) {
    return 'iawo_threshold_invalid';
  }
  // Same '>=' as calc.js's annualBillableHours — exactly-equal is zero
  // billable hours, which divides into an infinite rate.
  const workingDaysPerYear = v.workingDaysPerWeek * 52;
  if (v.leaveDaysPerYear + v.sickDaysPerYear >= workingDaysPerYear) {
    return 'leave_and_sick_exceed_working_year';
  }
  return null;
}

function registerGoalsRoutes(app, db) {
  // Singleton with no seeded row — same "a never-saved row is not an empty
  // one" convention as pricing/settings. Unlike those, there is no sensible
  // guessed default for an income target, so the unsaved shape is nulls
  // (the same "cannot compute yet" signal calc.js's functions use), not a
  // real-looking number.
  app.get('/api/goals', (_req, res) => {
    const row = db.prepare('SELECT * FROM goals WHERE id = 1').get();
    res.json({ ok: true, goals: loadGoals(row), updatedAt: row ? row.updated_at : null });
  });

  app.put('/api/goals', (req, res) => {
    const body = req.body || {};
    const existing = db.prepare('SELECT * FROM goals WHERE id = 1').get();

    const capacity = {
      billableHoursPerDay: resolveCapacityField(
        body, existing, 'billableHoursPerDay', 'billable_hours_per_day', CAPACITY_DEFAULTS.billableHoursPerDay
      ),
      workingDaysPerWeek: resolveCapacityField(
        body, existing, 'workingDaysPerWeek', 'working_days_per_week', CAPACITY_DEFAULTS.workingDaysPerWeek
      ),
      leaveDaysPerYear: resolveCapacityField(
        body, existing, 'leaveDaysPerYear', 'leave_days_per_year', CAPACITY_DEFAULTS.leaveDaysPerYear
      ),
      sickDaysPerYear: resolveCapacityField(
        body, existing, 'sickDaysPerYear', 'sick_days_per_year', CAPACITY_DEFAULTS.sickDaysPerYear
      ),
      // No numeric fallback — see migration v5: NULL means "not confirmed",
      // and a 0 default would be worse than NULL.
      iawoThreshold: body.iawoThreshold !== undefined
        ? (body.iawoThreshold === null || body.iawoThreshold === '' ? null : Number(body.iawoThreshold))
        : (existing ? existing.iawo_threshold : null),
    };

    const err = validateCapacity(capacity);
    if (err) return res.status(400).json({ error: err });

    // Super is a share of pay (under 100% keeps it a contribution, not a
    // second salary); bad debt under 100% or the revenue target divides by 0.
    const superPct = resolvePct(body, existing, 'superPct', 'super_pct', 100);
    if (superPct.error) return res.status(400).json({ error: superPct.error });
    const badDebtPct = resolvePct(body, existing, 'badDebtPct', 'bad_debt_pct', 100);
    if (badDebtPct.error) return res.status(400).json({ error: badDebtPct.error });

    // A markup can't be negative (hourlyFloor reads that as unset).
    if (body.targetProfitMarginPct !== undefined && body.targetProfitMarginPct !== null && Number(body.targetProfitMarginPct) < 0) {
      return res.status(400).json({ error: 'markup_negative' });
    }

    // LEGACY, DISPLAY-ONLY — see migration v5. Recomputed here on every save
    // so it can never drift from the four real fields; nothing downstream
    // reads it as an input any more. annualBillableHours cannot return null
    // for values that already passed validateCapacity above.
    const annualHours = annualBillableHours(capacity);
    const legacyHrsPerWeek = annualHours === null ? 0 : Math.round((annualHours / 52) * 100) / 100;

    const now = nowIso();
    // Stamped by a save that carries all four capacity fields — the Capacity
    // screen's — and otherwise carried forward. See migration v6.
    const confirmsCapacity = CAPACITY_KEYS.every((key) => body[key] !== undefined);
    const capacityConfirmedAt = confirmsCapacity ? now : (existing ? existing.capacity_confirmed_at : null);

    db.prepare(`
      INSERT INTO goals (
        id, desired_net_income, target_profit_margin_pct, billable_capacity_hrs_per_week,
        billable_hours_per_day, working_days_per_week, leave_days_per_year, sick_days_per_year,
        iawo_threshold, capacity_confirmed_at, super_pct, bad_debt_pct, created_at, updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        desired_net_income = excluded.desired_net_income,
        target_profit_margin_pct = excluded.target_profit_margin_pct,
        billable_capacity_hrs_per_week = excluded.billable_capacity_hrs_per_week,
        billable_hours_per_day = excluded.billable_hours_per_day,
        working_days_per_week = excluded.working_days_per_week,
        leave_days_per_year = excluded.leave_days_per_year,
        sick_days_per_year = excluded.sick_days_per_year,
        iawo_threshold = excluded.iawo_threshold,
        capacity_confirmed_at = excluded.capacity_confirmed_at,
        super_pct = excluded.super_pct,
        bad_debt_pct = excluded.bad_debt_pct,
        updated_at = excluded.updated_at
    `).run(
      resolveGoalField(body, existing, 'desiredNetIncome', 'desired_net_income'),
      resolveGoalField(body, existing, 'targetProfitMarginPct', 'target_profit_margin_pct'),
      legacyHrsPerWeek,
      capacity.billableHoursPerDay,
      capacity.workingDaysPerWeek,
      capacity.leaveDaysPerYear,
      capacity.sickDaysPerYear,
      capacity.iawoThreshold,
      capacityConfirmedAt,
      superPct.value,
      badDebtPct.value,
      now,
      now
    );
    const row = db.prepare('SELECT * FROM goals WHERE id = 1').get();
    res.json({ ok: true, goals: loadGoals(row), updatedAt: row.updated_at });
  });
}

module.exports = { registerGoalsRoutes };
