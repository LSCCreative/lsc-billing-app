'use strict';

const { dayKind } = require('./calc');

/**
 * Gear rentals (v12, .design/production-booking/ B2-2; IA "Data Model: Stage
 * B2"): when one vendor's hire on an estimate goes out and comes back. Read,
 * checked and replaced in one place for the estimate routes and the calendar,
 * as days.js does for days.
 *
 * A rental travels as { id, vendor, outDate, outMethod, backDate, backMethod,
 * note }. The id is made by the browser, like a day's. A rental belongs to the
 * estimate's equipment lines BY VENDOR NAME (trimmed, case-insensitive); lines
 * carry no rental id (D82). It prices nothing: the hire is billed on its
 * equipment lines, never from these dates (D83).
 */

const OUT_METHODS = ['pickup', 'postage'];
const BACK_METHODS = ['return', 'postage'];
const RENTAL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_RENTALS = 100;
const MAX_VENDOR = 200;
const MAX_NOTE = 500;

/** A vendor as rentals and equipment lines are matched on it. */
const vendorKey = (v) => String(v === undefined || v === null ? '' : v).trim().toLowerCase();

function rentalFromRow(r) {
  return {
    id: r.id,
    vendor: r.vendor,
    outDate: r.out_date || null,
    outMethod: r.out_method || null,
    backDate: r.back_date || null,
    backMethod: r.back_method || null,
    note: r.note || '',
  };
}

/** One estimate's rentals, in the order the editor saved them. */
function readRentals(db, estimateId) {
  return db.prepare('SELECT * FROM rentals WHERE estimate_id = ? ORDER BY sort, id')
    .all(estimateId).map(rentalFromRow);
}

/** Every estimate's rentals, keyed by estimate id — one query for a list. */
function readRentalsByEstimate(db) {
  const out = new Map();
  for (const r of db.prepare('SELECT * FROM rentals ORDER BY estimate_id, sort, id').all()) {
    if (!out.has(r.estimate_id)) out.set(r.estimate_id, []);
    out.get(r.estimate_id).push(rentalFromRow(r));
  }
  return out;
}

/* A date, null for blank, or undefined for one that isn't a real date. */
function dateOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = String(v).trim();
  return dayKind(d, {}, []) === null ? undefined : d;
}

/* A method from `allowed`, null for blank, or undefined for anything else. */
function methodOrNull(v, allowed) {
  if (v === null || v === undefined || v === '') return null;
  return allowed.indexOf(v) === -1 ? undefined : v;
}

/**
 * A request's `rentals`, checked and normalised. Two rentals for one vendor
 * are refused rather than merged: which one's dates would win is the owner's
 * call, not the server's. A rental back before it went out is refused too.
 * @returns {{rentals:Array<object>}|{error:string}}
 */
function parseRentals(raw) {
  if (!Array.isArray(raw)) return { error: 'rentals_not_a_list' };
  if (raw.length > MAX_RENTALS) return { error: 'too_many_rentals' };
  const ids = new Set();
  const vendors = new Set();
  const rentals = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'rental_invalid' };
    const id = typeof r.id === 'string' ? r.id : '';
    if (!RENTAL_ID.test(id)) return { error: 'rental_id_invalid' };
    if (ids.has(id)) return { error: 'rental_id_duplicate' };
    ids.add(id);

    const vendor = typeof r.vendor === 'string' ? r.vendor.trim() : '';
    if (vendor.length > MAX_VENDOR) return { error: 'rental_vendor_too_long' };
    if (vendor && vendors.has(vendorKey(vendor))) return { error: 'rental_vendor_duplicate' };
    if (vendor) vendors.add(vendorKey(vendor));

    const outDate = dateOrNull(r.outDate);
    const backDate = dateOrNull(r.backDate);
    if (outDate === undefined || backDate === undefined) return { error: 'rental_date_invalid' };
    // 'YYYY-MM-DD' compares as text.
    if (outDate && backDate && backDate < outDate) return { error: 'rental_dates_reversed' };

    const outMethod = methodOrNull(r.outMethod, OUT_METHODS);
    const backMethod = methodOrNull(r.backMethod, BACK_METHODS);
    if (outMethod === undefined || backMethod === undefined) return { error: 'rental_method_invalid' };

    const note = typeof r.note === 'string' ? r.note.trim() : '';
    if (note.length > MAX_NOTE) return { error: 'rental_note_too_long' };

    rentals.push({ id, vendor, outDate, outMethod, backDate, backMethod, note });
  }
  return { rentals };
}

/**
 * The rentals that still have gear: those whose vendor is on one of the
 * estimate's equipment lines. A rental with no items left goes (the brief's
 * B2 Key Interactions 1), and so does one with no vendor, which no line can
 * join. Dropped, not refused: removing the last item is how the owner removes
 * a rental.
 */
function rentalsWithGear(rentals, activeRows) {
  const equip = activeRows && Array.isArray(activeRows.equip) ? activeRows.equip : [];
  const onLines = new Set(equip.filter((l) => l && typeof l === 'object').map((l) => vendorKey(l.vendor)));
  onLines.delete('');
  return rentals.filter((r) => onLines.has(vendorKey(r.vendor)));
}

/** A rental id already used by another estimate, or null. */
function rentalIdTakenElsewhere(db, estimateId, rentals) {
  const owner = db.prepare('SELECT estimate_id FROM rentals WHERE id = ?');
  for (const r of rentals) {
    const row = owner.get(r.id);
    if (row && row.estimate_id !== estimateId) return r.id;
  }
  return null;
}

/** Replaces an estimate's rentals with `rentals`, in their order. Call inside the save's transaction. */
function replaceRentals(db, estimateId, rentals, now) {
  const created = new Map();
  for (const r of db.prepare('SELECT id, created_at FROM rentals WHERE estimate_id = ?').all(estimateId)) {
    created.set(r.id, r.created_at);
  }
  db.prepare('DELETE FROM rentals WHERE estimate_id = ?').run(estimateId);
  const insert = db.prepare(`
    INSERT INTO rentals
      (id, estimate_id, vendor, out_date, out_method, back_date, back_method, note, sort, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  rentals.forEach((r, i) => {
    insert.run(r.id, estimateId, r.vendor, r.outDate, r.outMethod, r.backDate, r.backMethod, r.note, i,
      created.get(r.id) || now, now);
  });
}

module.exports = {
  OUT_METHODS,
  BACK_METHODS,
  vendorKey,
  readRentals,
  readRentalsByEstimate,
  parseRentals,
  rentalsWithGear,
  rentalIdTakenElsewhere,
  replaceRentals,
};
