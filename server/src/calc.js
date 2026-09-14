'use strict';

/**
 * The money model. Pure — no database, no filesystem, no DOM — so the server,
 * the PDF renderer and the browser can all agree on one set of numbers.
 *
 * Ported from BILLING_APP_PLAN.md §1.2, which corrects two things the desktop
 * app got wrong:
 *
 *   1. "Gross Profit" counted pass-through costs (crew, equipment, direct
 *      travel) as profit. Money that lands in the account and goes straight
 *      back out is not margin. Take-home is now labour revenue only.
 *   2. There was no GST anywhere, so an invoice could not be a valid Australian
 *      tax invoice.
 *
 * Naming follows the plan: `clientPriceExGst` / `gst` / `totalIncGst` /
 * `taxSetAside` / `estTakeHome` replace the old "Net Invoice" / "Internal Tax" /
 * "Gross Profit" labels.
 *
 * GST-FREE ESTIMATES
 * Being GST-registered does not make every job GST-bearing, so an individual
 * estimate can be marked GST-free (`options.gstFree`) and is then priced exactly
 * as an unregistered business would price it: no GST line, and the rate card's
 * figures are what the client pays.
 *
 * That last part is a decision, not a derivation, and it only bites when the
 * rate card is kept GST-inclusive. A service listed at $560 normally splits into
 * $509.09 + $50.91 GST. On a GST-free estimate the client still pays $560 — the
 * listed rate is the price — rather than $509.09. Decided with the user on
 * 2026-09-10: the quoted price should not move depending on the job's tax
 * treatment. It follows that the whole $560 is revenue on such a job, so the tax
 * set-aside is provisioned against all of it, which is what falls out of
 * treating the estimate as unregistered.
 */

/** Money is stored and compared at cent precision, never as raw float sums. */
function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} activeRows  { deliverables, preprod, prod, post, travel, crew, equip }
 *   — the rows saved on the estimate. Labour rows carry { name, qty, override },
 *   travel rows { name, qty }, crew/equip rows { days, cost }.
 * @param {object} pricing     the rate card: { labourSections, travelRows, taxSetAsideRate }
 * @param {object} settings    { gst: { registered, rate, pricesIncludeGst } }
 * @param {object} [options]   the estimate's own tax treatment: { gstFree }.
 *   Named `options` rather than `estimate` or `document` on purpose — this file
 *   is copied verbatim into the browser, where a parameter called `document`
 *   would shadow the global inside this function.
 * @returns {object} totals, every money figure rounded to cents.
 */
function computeTotals(activeRows, pricing, settings, options) {
  const rows = activeRows || {};
  const labourSections = (pricing && pricing.labourSections) || [];
  const travelDefs = (pricing && pricing.travelRows) || [];
  const gstCfg = (settings && settings.gst) || {};

  /* A GST-free estimate prices as though the business were not registered. The
     whole rule is this line; see "GST-free estimates" in the header for why the
     GST-inclusive case resolves the way it does.

     Strictly `=== true`, matching gst.registered below rather than being merely
     truthy: dropping GST off an invoice is the expensive direction to get wrong,
     so a stray 1 or "yes" from a half-populated request body must not do it. */
  const gstFree = (options && options.gstFree) === true;
  const gstRegistered = gstCfg.registered === true && !gstFree;
  const gstRate = gstRegistered ? num(gstCfg.rate) : 0;
  const pricesIncludeGst = gstRegistered && gstCfg.pricesIncludeGst === true;

  // ── Labour ──────────────────────────────────────────────────────────────
  // A row is billed at qty × marked-up rate, unless it carries an explicit
  // override (the "Raw Footage Handover [on HDD]" custom-bill case).
  let labourTotal = 0;
  let totalHours = 0;

  for (const section of labourSections) {
    const saved = rows[section.id] || [];
    for (const line of saved) {
      const def = (section.rows || []).find((r) => r.name === line.name);
      if (!def) continue; // rate removed from the card since this was saved
      const qty = num(line.qty);
      totalHours += qty;
      const override = num(line.override);
      labourTotal += override > 0 ? override : qty * num(def.mu);
    }
  }

  // ── Travel ──────────────────────────────────────────────────────────────
  // Direct-cost rows (fuel, flights, accommodation) are billed at what they
  // cost. Everything else is billed at the marked-up rate.
  let travelTotal = 0;
  let travelPassThrough = 0;

  for (const line of rows.travel || []) {
    const def = travelDefs.find((r) => r.name === line.name);
    if (!def) continue;
    const qty = num(line.qty);
    if (def.directCost) {
      travelTotal += qty;
      travelPassThrough += qty;
    } else {
      travelTotal += qty * num(def.mu);
    }
  }

  // ── Crew and equipment ──────────────────────────────────────────────────
  // Always billed at cost: these are other people's invoices passing through.
  let crewTotal = 0;
  for (const line of rows.crew || []) crewTotal += num(line.days) * num(line.cost);

  let equipTotal = 0;
  for (const line of rows.equip || []) equipTotal += num(line.days) * num(line.cost);

  const expenseTotal = travelTotal + crewTotal + equipTotal;
  const passThroughCost = crewTotal + equipTotal + travelPassThrough;

  // ── GST ─────────────────────────────────────────────────────────────────
  // `billed` is the sum of every line as entered. Whether that figure already
  // contains GST depends on how the rate card is kept, so the split runs one of
  // two ways rather than assuming.
  const billed = labourTotal + expenseTotal;

  let clientPriceExGst;
  let gst;
  let totalIncGst;

  if (!gstRegistered) {
    clientPriceExGst = billed;
    gst = 0;
    totalIncGst = billed;
  } else if (pricesIncludeGst) {
    totalIncGst = billed;
    clientPriceExGst = billed / (1 + gstRate);
    gst = totalIncGst - clientPriceExGst;
  } else {
    clientPriceExGst = billed;
    gst = billed * gstRate;
    totalIncGst = billed + gst;
  }

  // ── Take-home ───────────────────────────────────────────────────────────
  // Income tax is provisioned against labour revenue only, and against the
  // ex-GST figure — GST collected belongs to the ATO, not to the business, so
  // it is never part of the tax-set-aside base.
  const labourExGst = pricesIncludeGst ? labourTotal / (1 + gstRate) : labourTotal;
  const taxSetAsideRate = num(pricing && pricing.taxSetAsideRate);
  const taxSetAside = labourExGst * taxSetAsideRate;
  const estTakeHome = labourExGst - taxSetAside;

  return {
    // What the client sees
    clientPriceExGst: round2(clientPriceExGst),
    gst: round2(gst),
    totalIncGst: round2(totalIncGst),

    // How it breaks down
    labourTotal: round2(labourTotal),
    expenseTotal: round2(expenseTotal),
    passThroughCost: round2(passThroughCost),
    totalHours: round2(totalHours),

    // What it means for the business
    taxSetAside: round2(taxSetAside),
    estTakeHome: round2(estTakeHome),
  };
}

/**
 * How a saved estimate's document should describe GST: 'taxable' (GST charged),
 * 'free' (this job was marked GST-free), or 'none' (no GST charged at all —
 * the business wasn't registered when it was saved).
 *
 * Read from what was stored, never from live settings: whether GST was charged
 * is a fact about a document that may already be with the client, and the
 * stored `gst` figure is the record of it. Switching registration later must not
 * turn an old invoice into a tax invoice, or strip the GST line off one.
 */
function gstTreatment(totals, options) {
  if ((options && options.gstFree) === true) return 'free';
  return num(totals && totals.gst) > 0 ? 'taxable' : 'none';
}

/* This file is the single source of the money model. The server requires it,
 * and web/js/calc.js is a byte-identical copy the browser loads as a plain
 * script, so the editor's live totals cannot disagree with what the server
 * computes and stores. test/test-calc.js fails if the two copies drift. */
if (typeof module === 'object' && module.exports) {
  module.exports = { computeTotals, round2, gstTreatment };
} else {
  globalThis.LSCCalc = { computeTotals, round2, gstTreatment };
}
