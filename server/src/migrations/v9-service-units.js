'use strict';

/**
 * Schema v9 (2026-09-28, .design/service-rate-tiers/): a labour service carries
 * three prices — `prices: { hour, half, full }`, a number set by the user or
 * null for auto — instead of one `mu` with `hoursPerUnit` / `dayUnit`, and the
 * card gains `serviceDay: { fullHours: 8, halfHours: 4 }`.
 *
 * Kept in its own file so each step can be tested on its own; db.js's v9 entry
 * is the only caller. Like every migration, this has shipped once it has run on
 * the NAS: never edit it afterwards.
 *
 * THE ORDER IS THE POINT. Step 1 snapshots every saved line that still prices
 * from the card, against the card AS IT WAS. Step 2 then reshapes the card. The
 * other way round, a legacy line would look its price up on the new card, find
 * an auto unit the server cannot price (calc.js, SERVICE UNITS decision 4), and
 * every quote saved before 2026-09-28 would silently lose its labour.
 */

const { lineDef, lineSnapshot, hoursPerUnitOf, numOrNull, unitHours } = require('../calc');

/**
 * The rate card a database with no `pricing` row priced from until v9: v8's
 * DEFAULT_PRICING, frozen here. defaults.js now holds the new shape, so it can
 * no longer stand in for "the card these estimates were priced against".
 */
const V8_DEFAULT_PRICING = Object.freeze({
  labourSections: [
    {
      id: 'preprod',
      label: 'Pre-Production',
      rows: [
        { name: 'Pre-Production Meeting with Client', rate: 40, mu: 56 },
        { name: 'Pre-Production Development & Admin', rate: 30, mu: 42 },
      ],
    },
    {
      id: 'prod',
      label: 'Production',
      rows: [
        { name: 'Video Capture', rate: 100, mu: 140 },
        { name: 'Photo Capture', rate: 80, mu: 112 },
        { name: 'Drone Aerial Capture', rate: 60, mu: 84 },
        { name: 'Video Capture — Full Day', rate: 800, mu: 1120, hoursPerUnit: 8, dayUnit: 'full' },
        { name: 'Video Capture — Half Day', rate: 400, mu: 640, hoursPerUnit: 4, dayUnit: 'half' },
        { name: 'Overtime — per hour', rate: 150, mu: 210 },
      ],
    },
    {
      id: 'post',
      label: 'Post-Production',
      rows: [
        { name: 'Video Editor — Project Setup', rate: 35, mu: 49 },
        { name: 'Video Editor — B-Roll Offline Edit', rate: 45, mu: 63 },
        { name: 'Video Editor — A-Roll Offline Edit', rate: 45, mu: 63 },
        { name: 'Video Editor — A-Roll RC', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform RC', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform AC', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform Draft', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform Colour', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform Sound Mix/Master', rate: 100, mu: 140 },
        { name: 'Video Editor — Socials', rate: 90, mu: 126 },
        { name: 'Processed Footage Handover [Over Cloud]', rate: 35, mu: 49 },
        { name: 'Raw Footage Handover [on HDD]', rate: 70, mu: 98, customBill: true },
        { name: 'Photo Editor', rate: 110, mu: 154 },
      ],
    },
  ],
  travelRows: [
    { name: 'Fuel & Tolls', rate: 1, mu: 1, directCost: true },
    { name: 'Crew Meals', rate: 30, mu: 30, unit: 'meals' },
    { name: 'Transport & Logistics Hrs', rate: 25, mu: 35 },
    { name: 'Flights & Public Transport', rate: 0, mu: 0, directCost: true },
    { name: 'Crew Accommodation', rate: 0, mu: 0, directCost: true },
  ],
  taxSetAsideRate: 0.35,
});

/** activeRows keys that hold no card-priced lines (crew and equipment carry their own costs). */
const NOT_CARD_PRICED = { equip: 1, crew: 1, deliverables: 1 };

/**
 * Step 1. Gives every saved labour and travel line that has no price of its
 * own the snapshot it would have been given had it been added after
 * 2026-09-28: lineSnapshot of the row it prices from today. Found the same way
 * computeTotals finds it — lineDef, by rowId then name, within the line's own
 * category — so the line's total cannot move. A line whose service has already
 * left the card is left alone: it prices at nothing now and still will.
 *
 * @param {object} activeRows — an estimate's saved lines; not modified.
 * @param {object} card — the rate card BEFORE v9.
 * @returns {{ activeRows: object, snapshotted: number }}
 */
function snapshotLegacyLines(activeRows, card) {
  const out = JSON.parse(JSON.stringify(activeRows || {}));
  const sections = (card && card.labourSections) || [];
  let snapshotted = 0;

  for (const key of Object.keys(out)) {
    if (NOT_CARD_PRICED[key] || !Array.isArray(out[key])) continue;
    const defs = key === 'travel'
      ? (card && card.travelRows) || []
      : ((sections.find((s) => s.id === key) || {}).rows || []);
    out[key] = out[key].map((line) => {
      const def = lineDef(defs, line);
      if (!def || def === line) return line; // lost, or already carries its price
      snapshotted++;
      return { ...line, ...lineSnapshot(def) };
    });
  }
  return { activeRows: out, snapshotted };
}

/**
 * Step 2. The card in the new shape, and a note for every row whose unit of
 * work changed length on the way.
 *
 * Each labour row's one price goes into one slot: its `dayUnit` when it has
 * one; otherwise a row of 8 hours a unit is a full day and one of 4 a half day
 * (matching the new service day); anything else is an hour. The other two
 * slots are null (auto). Nothing is merged by name: "Video Capture — Full Day"
 * becomes a service of its own with a set-by-you full day, for the user to fold
 * into "Video Capture" by hand. Travel rows are untouched.
 *
 * A row that was already reshaped (it has `prices`) is left as it is, so the
 * step is safe to repeat.
 *
 * @param {object} card — the rate card before v9; not modified.
 * @returns {{ card: object, notes: string[] }}
 */
function reshapeCard(card) {
  const out = JSON.parse(JSON.stringify(card || {}));
  const notes = [];
  if (!out.serviceDay) out.serviceDay = { fullHours: 8, halfHours: 4 };

  for (const section of out.labourSections || []) {
    const where = section.label || section.id;
    section.rows = (section.rows || []).map((row) => {
      if (!row || row.prices) return row;
      const oldHours = hoursPerUnitOf(row);
      const slot = row.dayUnit === 'full' || row.dayUnit === 'half'
        ? row.dayUnit
        : oldHours === 8 ? 'full' : oldHours === 4 ? 'half' : 'hour';
      const mu = numOrNull(row.mu);
      const price = mu === null ? null : Math.max(0, mu);

      const { mu: _mu, hoursPerUnit: _h, dayUnit: _d, ...rest } = row;
      const next = { ...rest, prices: { hour: null, half: null, full: null } };
      next.prices[slot] = price;

      const unitName = { hour: 'an hour', half: 'a half day', full: 'a full day' }[slot];
      const newHours = unitHours(out, slot);
      if (oldHours !== newHours) {
        notes.push(`${where} › ${row.name}: was ${oldHours} hrs a unit, now ${unitName} of ${newHours} hrs. ` +
          (price === null ? 'It had no price; that unit is now auto.' : `Price kept ($${price}).`));
      } else if (price === null) {
        notes.push(`${where} › ${row.name}: had no price; ${unitName} is now auto.`);
      } else if (mu !== price) {
        notes.push(`${where} › ${row.name}: a negative price (${mu}) became $0.`);
      }
      return next;
    });
  }
  return { card: out, notes };
}

/**
 * The whole migration, against an open database inside db.js's transaction.
 * Neither step touches `updated_at` — a migration is not an edit, and the
 * pricing row's updated_at is what tells the browser a card has ever been saved.
 *
 * @returns {{ snapshotted: number, estimates: number, notes: string[] }}
 */
function migrateV9(db) {
  const pricingRow = db.prepare('SELECT data_json FROM pricing WHERE id = 1').get();
  const oldCard = pricingRow ? JSON.parse(pricingRow.data_json) : V8_DEFAULT_PRICING;

  // 1. Snapshot first, against the old card.
  const update = db.prepare('UPDATE estimates SET active_rows_json = ? WHERE id = ?');
  let snapshotted = 0;
  let estimates = 0;
  for (const est of db.prepare('SELECT id, active_rows_json FROM estimates').all()) {
    const result = snapshotLegacyLines(JSON.parse(est.active_rows_json || '{}'), oldCard);
    if (result.snapshotted === 0) continue;
    update.run(JSON.stringify(result.activeRows), est.id);
    snapshotted += result.snapshotted;
    estimates++;
  }

  // 2. Reshape second — only a card that was saved. A database with no pricing
  //    row reads the new DEFAULT_PRICING from here on.
  let notes = [];
  if (pricingRow) {
    const reshaped = reshapeCard(oldCard);
    notes = reshaped.notes;
    db.prepare('UPDATE pricing SET data_json = ? WHERE id = 1').run(JSON.stringify(reshaped.card));
  }

  // 3. Say what moved, for the boot log and the handover.
  if (snapshotted) console.log(`[db] v9: snapshotted ${snapshotted} line(s) on ${estimates} estimate(s) against the old card`);
  for (const note of notes) console.log(`[db] v9: ${note}`);
  return { snapshotted, estimates, notes };
}

module.exports = { migrateV9, snapshotLegacyLines, reshapeCard, V8_DEFAULT_PRICING };
