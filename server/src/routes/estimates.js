'use strict';

const { newId, nowIso } = require('../db');
const { computeTotals, surchargeSnapshot, stampSurchargedPrices, PRICING_SHAPE } = require('../calc');
const { readPricing, readSettings, sectionLabelsFor, readOverheadRate, negativeLineField } = require('../ratecard');
const { loadEstimate } = require('../estimate');
const {
  readDays, readDaysByEstimate, readHolidays, parseDays, lineDayProblem, lineDeliverableProblem, dayIdTakenElsewhere,
  lockedDay, replaceDays,
} = require('../days');
const {
  readRentals, readRentalsByEstimate, parseRentals, rentalsWithGear, rentalIdTakenElsewhere, replaceRentals,
} = require('../rentals');
const { planProjectWrite, applyProjectWrite, dropEmptyProject, upidLocked } = require('../projects');
const { versionsOf } = require('../public');

/**
 * pricing_shape_outdated, for estimate writes (v9, .design/service-rate-tiers/).
 * A browser still running the web build from before v9 — a cached Pages copy, a
 * tab left open over the deploy — snapshots every labour line it adds at $0,
 * and its "Update to current rates" re-prices every labour line to $0: its
 * lineSnapshot reads a price from `mu`, which v9 rows no longer have. Each such
 * line is a valid snapshot as far as computeTotals can tell, so nothing past
 * this point could catch it. Every write from a v9 build carries
 * `pricingShape` (calc.js PRICING_SHAPE); one without it is refused, checked
 * FIRST, as the rate card's is, so an old build always gets this code.
 *
 * `message` is what the old build shows: it prints the server's message and
 * knows no codes from after it was built.
 */
const OUTDATED = {
  error: 'pricing_shape_outdated',
  message:
    'This page is out of date — the rate card has changed shape since it was opened, and saving from it ' +
    'would price new work at $0. Copy anything you need from the form, reload the page, and make your ' +
    'changes again.',
};
const outdated = (body) => body.pricingShape !== PRICING_SHAPE;

/**
 * Everything an estimate write stores that the server works out rather than
 * taking from the body: the days (checked), the surcharge snapshot, the lines
 * with their surchargedPrice stamped, and the totals — priced here, never
 * trusted from the browser.
 *
 * DAYS. `days` replaces the estimate's days whole. A PUT without `days`
 * keeps the ones it has, and one without `shortNotice` keeps the tick: unlike
 * every other field here, losing booked days is the expensive direction, and
 * the only screen that saves an estimate sends both.
 *
 * SURCHARGES (production-booking task 2). An estimate with days stores the
 * snapshot it was priced under (calc.js surchargeSnapshot): a re-save keeps
 * the multipliers and each unmoved day's weekend/holiday kind, so a later Rate
 * Card or holiday-list change moves only new estimates. `refreshSurcharges:
 * true` re-snapshots from the live card and holiday list — the surcharge
 * half of "Update to current rates". An estimate with no days and no short
 * notice stores '{}': nothing was surcharged, so nothing is pinned, and its
 * first day takes today's settings.
 *
 * RENTALS (B2-2). `rentals` replaces the estimate's gear rentals whole, in the
 * same transaction as its days; a PUT without it keeps the ones it has, for
 * the same reason as days. Either way a rental whose vendor is on none of the
 * equipment lines being saved is dropped (rentals.js rentalsWithGear).
 *
 * @returns {{status:number, body:object}|{fields:object}} a refusal, or the fields.
 */
function prepareWrite(db, body, existing) {
  if (outdated(body)) return { status: 400, body: OUTDATED };
  const negative = negativeLineField(body.activeRows);
  if (negative) return { status: 400, body: { error: 'negative_line_value', field: negative } };

  const estimateId = existing ? existing.id : null;
  const storedDays = existing ? readDays(db, existing.id) : [];
  let days = storedDays;
  if (body.days !== undefined || !existing) {
    const parsed = parseDays(body.days === undefined ? [] : body.days);
    if (parsed.error) return { status: 400, body: { error: parsed.error } };
    days = parsed.days;
  }
  const lineProblem = lineDayProblem(body.activeRows, days) || lineDeliverableProblem(body.activeRows);
  if (lineProblem) return { status: 400, body: { error: lineProblem } };
  const taken = dayIdTakenElsewhere(db, estimateId, days);
  if (taken) return { status: 400, body: { error: 'day_id_taken', dayId: taken } };

  let rentals = existing ? readRentals(db, existing.id) : [];
  if (body.rentals !== undefined) {
    const parsed = parseRentals(body.rentals);
    if (parsed.error) return { status: 400, body: { error: parsed.error } };
    rentals = parsed.rentals;
  }
  rentals = rentalsWithGear(rentals, body.activeRows);
  const rentalTaken = rentalIdTakenElsewhere(db, estimateId, rentals);
  if (rentalTaken) return { status: 400, body: { error: 'rental_id_taken', rentalId: rentalTaken } };
  const lock = lockedDay(db, estimateId, days, storedDays);
  if (lock) {
    return {
      status: 409,
      body: {
        error: 'date_locked',
        date: lock.date,
        upid: lock.upid,
        estimateId: lock.estimateId,
        message: `${lock.date} is confirmed for ${lock.upid || lock.name || 'another project'}. ` +
          'Add a specification note to book it anyway.',
      },
    };
  }

  const pricing = readPricing(db);
  const gstFree = body.gstFree === true;
  const shortNotice = body.shortNotice === undefined && existing
    ? existing.short_notice === 1
    : body.shortNotice === true;
  const prior = existing && body.refreshSurcharges !== true
    ? { surcharges: JSON.parse(existing.surcharges_json || '{}'), days: storedDays }
    : null;
  // Short notice reaches production lines on no day too (calc.js
  // surchargedPriceOf), so it needs the settings pinned even with no days.
  const surcharges = days.length || shortNotice ? surchargeSnapshot(days, pricing, readHolidays(db), prior) : {};
  const options = { gstFree, overheadRate: readOverheadRate(db), days, surcharges, shortNotice };
  const activeRows = stampSurchargedPrices(body.activeRows || {}, pricing, options);
  const totals = computeTotals(activeRows, pricing, readSettings(db), options);
  const sectionLabels = sectionLabelsFor(
    activeRows,
    pricing,
    existing ? JSON.parse(existing.section_labels_json || '{}') : null
  );
  return { fields: { days, rentals, gstFree, shortNotice, surcharges, activeRows, totals, sectionLabels } };
}

function registerEstimateRoutes(app, db) {
  // `upidLocked` (D36, task 19): the editor shows the UPID read-only once the
  // project has an invoice the app made, as planProjectWrite refuses a change.
  // `versions` (task 25, D34): what of it has been sent, for the editor's
  // "Editing after v2 was sent" banner. Owner-only, like the rest.
  const loadJson = (row) => Object.assign(loadEstimate(row, readDays(db, row.id), readRentals(db, row.id)), {
    upidLocked: upidLocked(db, row.project_id),
    versions: versionsOf(db, [row.id]).get(row.id) || [],
  });

  app.get('/api/estimates', (_req, res) => {
    const rows = db.prepare('SELECT * FROM estimates ORDER BY updated_at DESC').all();
    const days = readDaysByEstimate(db);
    const rentals = readRentalsByEstimate(db);
    // How many projects still wait for the UPID fix-up (task 16): the list's banner.
    const needsUpid = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE needs_upid = 1').get().n;
    res.json({
      ok: true,
      estimates: rows.map((row) => loadEstimate(row, days.get(row.id), rentals.get(row.id))),
      needsUpid,
    });
  });

  app.get('/api/estimates/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, estimate: loadJson(row) });
  });

  app.post('/api/estimates', (req, res) => {
    const body = req.body || {};
    const id = newId('est');
    const now = nowIso();
    const prepared = prepareWrite(db, body, null);
    if (!prepared.fields) return res.status(prepared.status).json(prepared.body);
    const { days, rentals, gstFree, shortNotice, surcharges, activeRows, totals, sectionLabels } = prepared.fields;
    const plan = planProjectWrite(db, body, null);
    if (plan.status) return res.status(plan.status).json(plan.body);

    db.transaction(() => {
      // A new estimate is a new project (v13), and starts as a draft: since
      // v13 a status moves only by the project's own actions (send, accept,
      // decline), never by an estimate save.
      // The retired doc type (D62, task 18) is no longer written: a new row is
      // an estimate with no invoice number, whatever an old build sends.
      const projectId = applyProjectWrite(db, plan, body.clientId, now);
      db.prepare(`
        INSERT INTO estimates
          (id, upid, name, date, status, doc_type, invoice_number, client_id,
           client_json, notes, active_rows_json, section_labels_json, gst_free,
           short_notice, surcharges_json, totals_json, created_at, updated_at, project_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id, plan.upid, body.name || '', body.date || '',
        'draft', 'estimate', '',
        body.clientId || null, JSON.stringify(body.client || {}), body.notes || '',
        JSON.stringify(activeRows), JSON.stringify(sectionLabels),
        gstFree ? 1 : 0, shortNotice ? 1 : 0, JSON.stringify(surcharges), JSON.stringify(totals), now, now,
        projectId
      );
      replaceDays(db, id, days, now);
      replaceRentals(db, id, rentals, now);
    })();

    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(id);
    res.status(201).json({ ok: true, estimate: loadJson(row) });
  });

  app.put('/api/estimates/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const body = req.body || {};
    const now = nowIso();
    // gstFree: absent means false, matching every other field here (days and
    // shortNotice excepted — see prepareWrite): a PUT that omits it is a save
    // from a screen that decided the estimate is GST-bearing.
    const prepared = prepareWrite(db, body, existing);
    if (!prepared.fields) return res.status(prepared.status).json(prepared.body);
    const { days, rentals, gstFree, shortNotice, surcharges, activeRows, totals, sectionLabels } = prepared.fields;
    const plan = planProjectWrite(db, body, existing);
    if (plan.status) return res.status(plan.status).json(plan.body);

    db.transaction(() => {
      // The status is kept as it is (v13): `status` in the body is ignored,
      // because only the project's actions move it. The UPID is the project's
      // (projects.js), copied here. So are the retired doc type and invoice
      // number (D62, task 18): the editor no longer has them, and an old
      // invoice-typed row keeps both, so its project's legacy invoice still
      // prints as it was made.
      const projectId = applyProjectWrite(db, plan, body.clientId, now);
      db.prepare(`
        UPDATE estimates SET
          upid = ?, name = ?, date = ?,
          client_id = ?, client_json = ?, notes = ?, active_rows_json = ?,
          section_labels_json = ?, gst_free = ?, short_notice = ?, surcharges_json = ?,
          totals_json = ?, updated_at = ?, project_id = ?
        WHERE id = ?
      `).run(
        plan.upid, body.name || '', body.date || '', body.clientId || null,
        JSON.stringify(body.client || {}), body.notes || '',
        JSON.stringify(activeRows), JSON.stringify(sectionLabels),
        gstFree ? 1 : 0, shortNotice ? 1 : 0, JSON.stringify(surcharges),
        JSON.stringify(totals), now, projectId,
        req.params.id
      );
      replaceDays(db, req.params.id, days, now);
      replaceRentals(db, req.params.id, rentals, now);
    })();

    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    res.json({ ok: true, estimate: loadJson(row) });
  });

  // A project left with no estimate goes with it (v13), invoices and
  // activity included — as deleting an invoice-typed estimate always took
  // that invoice with it. The folder has its own Delete (DELETE /api/projects/:id).
  app.delete('/api/estimates/:id', (req, res) => {
    const existing = db.prepare('SELECT project_id FROM estimates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    // The project's own Delete refuses once an invoice has gone out (task 18),
    // and so does this, for the estimate an invoice bills or the project's last
    // one, whose deletion takes the project and its invoices with it.
    const gone = db.prepare(`
      SELECT number FROM invoices
       WHERE project_id = ? AND kind <> 'legacy' AND status IN ('scheduled', 'sent', 'paid')
         AND (estimate_id = ? OR (SELECT COUNT(*) FROM estimates WHERE project_id = ?) = 1)
       LIMIT 1
    `).get(existing.project_id, req.params.id, existing.project_id);
    if (gone) {
      return res.status(409).json({
        error: 'has_sent_invoices',
        message: `${gone.number || 'An invoice'} has gone out, so this estimate can’t be deleted.`,
      });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM estimates WHERE id = ?').run(req.params.id);
      dropEmptyProject(db, existing.project_id);
    })();
    res.json({ ok: true });
  });

  app.post('/api/estimates/:id/duplicate', (req, res) => {
    const existing = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const id = newId('est');
    const now = nowIso();
    // A duplicate is a copy of the document, headings and tax treatment included
    // — it inherits the original's labels and GST-free flag rather than
    // re-deriving them from a rate card or a settings row that may have moved on
    // since. Its totals are copied for the same reason. Saving the copy
    // re-snapshots all of it, like any other edit.
    //
    // EXCEPT ITS DAYS (production-booking task 2). Booked days are a claim on
    // the calendar, and a copy that re-claimed them would double-book every
    // date — a confirmed one past its own lock. So the copy gets none
    // (D60 agrees: a duplicate is a new project, with no days), its production
    // lines come off their days, and short notice and the surcharge snapshot
    // go with them. Those lines then price at their base price, so a copy
    // whose original had days is re-totalled rather than copied: copied totals
    // would still hold surcharges its lines no longer carry.
    //
    // That drops every day and time rate the original carried, so the reply
    // says how many items came off a day (`unbooked`) and the detail screen
    // tells the owner, rather than the copy quietly quoting less (money
    // review, 2026-10-02).
    //
    // SINCE B2 (B2-2) the travel, crew and gear booked for a day come off it
    // too, and count in `unbooked`; they price the same on or off a day. The
    // copy gets no gear rentals: its dates are the original's, and a new
    // project has none (D60). Deliverables, their post-line tags and each
    // line's Capture flag are copied as they are — they say what's being
    // made, not when.
    //
    // SINCE v13 (task 15) the copy is a new project with no UPID (D60): UPIDs
    // are unique, so the original's can't come with it. It is an estimate,
    // whatever the original's retired doc type (D62), and a draft.
    const rows = JSON.parse(existing.active_rows_json || '{}');
    let unbooked = false;
    let offDays = 0;
    Object.keys(rows).forEach((key) => {
      if (!Array.isArray(rows[key])) return;
      rows[key] = rows[key].map((line) => {
        if (!line || typeof line !== 'object' || (line.dayId === undefined && line.surchargedPrice === undefined)) return line;
        unbooked = true;
        if (line.dayId !== undefined) offDays += 1;
        const { dayId, surchargedPrice, ...rest } = line;
        return rest;
      });
    });
    const totalsJson = unbooked
      ? JSON.stringify(computeTotals(rows, readPricing(db), readSettings(db), {
        gstFree: existing.gst_free === 1,
        overheadRate: readOverheadRate(db),
      }))
      : existing.totals_json;
    db.transaction(() => {
      const projectId = applyProjectWrite(db, { project: null, upid: '' }, existing.client_id, now);
      db.prepare(`
        INSERT INTO estimates
          (id, upid, name, date, status, doc_type, invoice_number, client_id,
           client_json, notes, active_rows_json, section_labels_json, gst_free,
           totals_json, created_at, updated_at, project_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id, '', `${existing.name} (copy)`, existing.date, 'draft',
        'estimate', '', existing.client_id, existing.client_json,
        existing.notes, unbooked ? JSON.stringify(rows) : existing.active_rows_json,
        existing.section_labels_json, existing.gst_free, totalsJson, now, now, projectId
      );
    })();

    const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(id);
    res.status(201).json({ ok: true, estimate: loadJson(row), unbooked: offDays });
  });
}

module.exports = { registerEstimateRoutes };
