'use strict';

/* Per-row and per-section figures for the estimate screens.
 *
 * calc.js owns the totals and is the only thing allowed to produce them. What
 * it does not produce is the breakdown a human reads: what one line bills, what
 * a section subtotals to. Those are computed here, and they must follow calc.js
 * line for line or the rows on screen will not add up to the total beneath them.
 *
 * The rule that keeps them agreeing is the lookup, and it is calc.js's own
 * LSCCalc.lineDef — called, not copied. Since 2026-09-28 a saved line carries
 * its own price snapshot and prices from that; only a line saved before then
 * falls back to the live card (by row id, then name), and one whose service is
 * gone from the card bills nothing and renders as “—”, as calc.js believes.
 * The bills clamp negatives to zero for the same reason calc.js does.
 *
 * `sectionsFor` keeps a deleted category's rows visible, so they can be read
 * and removed rather than silently vanishing. A snapshotted row there still
 * prices; a legacy one doesn't.
 */

const LSCRows = (() => {
  const { num } = LSCUtil;
  const nonNeg = (v) => Math.max(0, num(v));

  const RESERVED_SECTION_IDS = { travel: 1, equip: 1, crew: 1, deliverables: 1 };

  /* The labour categories to render for an estimate: every category on the live
     rate card, plus any the estimate itself used that is no longer on it.

     `sectionLabels` is the estimate's own record of what its categories were
     called when it was saved. A deleted category has no live name left, so it
     always falls back to the snapshot. A *renamed* one has two valid answers,
     and which is right depends on the screen:

       asDocument: true   what this estimate says — the heading the client was
                          sent, matching the PDF. The detail view uses it.
       asDocument: false  what the rate card says now. The editor uses it,
                          because its picker offers the live category's services
                          and saving re-snapshots the live name: showing the old
                          heading over a live picker would be a preview of
                          something that is about to stop being true. */
  function sectionsFor(activeRows, pricing, sectionLabels, options) {
    const labels = sectionLabels || {};
    const asDocument = !!(options && options.asDocument);
    const live = (pricing && pricing.labourSections) || [];
    const out = live.map((s) =>
      asDocument && labels[s.id] && labels[s.id] !== s.label
        ? Object.assign({}, s, { label: labels[s.id] })
        : s
    );
    const known = new Set(Object.keys(RESERVED_SECTION_IDS));
    live.forEach((s) => known.add(s.id));

    Object.keys(activeRows || {}).forEach((key) => {
      if (known.has(key)) return;
      const lines = activeRows[key];
      if (!Array.isArray(lines) || lines.length === 0) return;
      out.push({
        id: key,
        archived: true,
        label: labels[key] || 'Archived Services',
        rows: [],
      });
    });
    return out;
  }

  /* Null means "no price known" — the caller renders “—” and leaves it out of
     the subtotal, matching what calc.js counted. `pricing` is the whole card,
     passed on so a legacy line's fallback reads its Service Day, as
     computeTotals's does. No price context, deliberately: the server has none,
     so an auto unit prices at nothing here exactly as it does there. */
  function labourDef(section, line, pricing) {
    return LSCCalc.lineDef(section && !section.archived ? section.rows : [], line, pricing);
  }

  function travelDef(line, pricing) {
    return LSCCalc.lineDef((pricing && pricing.travelRows) || [], line);
  }

  function labourBill(def, line) {
    if (!def) return null;
    const override = nonNeg(line.override);
    return override > 0 ? override : nonNeg(line.qty) * nonNeg(def.mu);
  }

  function travelBill(def, line) {
    if (!def) return null;
    return def.directCost ? nonNeg(line.qty) : nonNeg(line.qty) * nonNeg(def.mu);
  }

  function costBill(line) {
    return nonNeg(line.days) * nonNeg(line.cost);
  }

  /* ── What a labour row's quantity counts ──────────────────────────────────
     Added 2026-09-27 (.design/price-calculator/). A labour row used to be
     priced by the hour, full stop, so both estimate screens headed the quantity
     column "Hours". Day rows broke that: a 2 on a full-day row is two shoot
     days. These say which unit a line sells in, by the same rule calc.js's
     labourHoursBreakdown uses — `dayUnit` marks a day (never its name), and
     hours other than one without a marker are a generic "unit" rather than
     being passed off as hours. Since service rate tiers (2026-09-28) every
     service sells at three units, so both screens head the column "Qty" in
     every labour category and spell each line's unit; the old per-category
     test (sectionHasUnits) is gone. */
  const UNIT_WORDS = {
    hour: ['hour', 'hours'],
    full: ['full day', 'full days'],
    half: ['half day', 'half days'],
    unit: ['unit', 'units'],
  };

  function labourUnit(def) {
    const hoursPerUnit = LSCCalc.hoursPerUnitOf(def);
    const dayUnit = def && (def.dayUnit === 'full' || def.dayUnit === 'half') ? def.dayUnit : null;
    if (!dayUnit && hoursPerUnit === 1) return { kind: 'hour', hoursPerUnit: 1 };
    return { kind: dayUnit || 'unit', hoursPerUnit };
  }

  /* The quantity's name where there is no column heading to lean on — the
     stacked mobile label, and the input's accessible name. */
  const QTY_LABELS = { hour: 'Hours', full: 'Full days', half: 'Half days', unit: 'Units' };
  const qtyLabel = (kind) => QTY_LABELS[kind] || QTY_LABELS.unit;

  function unitWord(kind, qty) {
    const words = UNIT_WORDS[kind] || UNIT_WORDS.unit;
    return num(qty) === 1 ? words[0] : words[1];
  }

  /* ── Why a production line costs more (production-booking tasks 7–8) ──────
     The owner-only note under a surcharged line's price — "incl. weekend ×1.5",
     "after hours ×1.25 on 2 of 10 hrs", "short notice ×2" — in the editor and
     the estimate detail alike. Worded from calc.js surchargeAttribution under
     the estimate's own snapshot; nothing here multiplies. Never on anything a
     client sees (D8, D12). */
  const SUR_WORD = { weekend: 'weekend', holiday: 'public holiday', afterHours: 'after hours', shortNotice: 'short notice' };

  // A day's booked hours: calc.js's own reading, so every screen agrees.
  const bookedHours = (day) => LSCCalc.bookedHoursOf(day);

  const hrsText = (n) => {
    const r = Math.round(n * 100) / 100;
    return r + (r === 1 ? ' hr' : ' hrs');
  };

  /**
   * @param {number} base — the line's price before surcharges.
   * @param {object} day — the line's day, with its snapshotted `kind` and
   *   `nextKind`.
   * @param {object} surcharges — the estimate's snapshot ({ settings, days, nextDays }).
   * @param {boolean} shortNotice — the estimate's tick.
   * @param {number} [lineHours] — the line's own hours (qty × hours per unit),
   *   which decide the stretch of the day it covers (calc.js coveredWindow).
   * @returns {string} '' when nothing applies.
   */
  function surchargeNote(base, day, surcharges, shortNotice, lineHours) {
    const card = { surcharges: (surcharges || {}).settings };
    const att = LSCCalc.surchargeAttribution(base, day, card, shortNotice, undefined, lineHours);
    if (!(att.surcharge > 0)) return '';
    const parts = att.rows.map((r) => {
      const of = att.hours > 0 && r.type !== 'shortNotice' && (r.carry || r.share < 1 - 1e-9)
        ? ' on ' + hrsText(r.hours).replace(/ hrs?$/, '') + ' of ' + hrsText(att.hours)
        : '';
      return SUR_WORD[r.type] + ' ×' + r.multiplier + (r.carry ? ' after midnight' : '') + of;
    });
    return 'incl. ' + parts.join(', ');
  }

  return {
    RESERVED_SECTION_IDS,
    sectionsFor,
    labourDef,
    travelDef,
    labourBill,
    travelBill,
    costBill,
    labourUnit,
    unitWord,
    qtyLabel,
    bookedHours,
    hrsText,
    surchargeNote,
  };
})();
