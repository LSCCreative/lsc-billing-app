'use strict';

/* Per-row and per-section figures for the estimate screens.
 *
 * calc.js owns the totals and is the only thing allowed to produce them. What
 * it does not produce is the breakdown a human reads: what one line bills, what
 * a section subtotals to. Those are computed here, and they must follow calc.js
 * line for line or the rows on screen will not add up to the total beneath them.
 *
 * The rule that keeps them agreeing is the lookup: calc.js prices a row only if
 * its name is still on the live rate card (`for (const section of
 * labourSections)` — a section or row deleted from the card is skipped, never
 * guessed at from the figures saved on the estimate). So `labourDef` and
 * `travelDef` here look at the live card and nowhere else, and a row they can't
 * find bills nothing and renders as “—”.
 *
 * `sectionsFor` is the deliberate exception, and it is about visibility, not
 * money: an estimate saved against a category that has since been deleted still
 * shows its rows, so they can be read and removed rather than silently
 * vanishing. Those rows carry no price, which is what calc.js already believes.
 */

const LSCRows = (() => {
  const { num } = LSCUtil;

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

  /* Null means "not on the rate card any more" — the caller renders “—” and
     leaves it out of the subtotal, matching what calc.js counted. */
  function labourDef(section, line) {
    if (!section || section.archived) return null;
    return (section.rows || []).find((r) => r.name === line.name) || null;
  }

  function travelDef(line, pricing) {
    const defs = (pricing && pricing.travelRows) || [];
    return defs.find((r) => r.name === line.name) || null;
  }

  function labourBill(def, line) {
    if (!def) return null;
    const override = num(line.override);
    return override > 0 ? override : num(line.qty) * num(def.mu);
  }

  function travelBill(def, line) {
    if (!def) return null;
    return def.directCost ? num(line.qty) : num(line.qty) * num(def.mu);
  }

  function costBill(line) {
    return num(line.days) * num(line.cost);
  }

  return {
    RESERVED_SECTION_IDS,
    sectionsFor,
    labourDef,
    travelDef,
    labourBill,
    travelBill,
    costBill,
  };
})();
