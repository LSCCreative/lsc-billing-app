'use strict';

/* The Rate Card screen — the rate card every estimate is priced from. Titled
 * "Pricing & Services" until 2026-09-28, when its heading was brought in line
 * with the Finance & Price rail item a screen reader user picks it by.
 *
 * Ported from renderPricing in the desktop app. Same layout, same grid, same
 * per-category tables; app.css already carries every rule they use. What
 * changed is where the card lives and what "Save" means.
 *
 * THE FAKE SAVE
 * The desktop button wrote to localStorage and flashed "Services saved" whether
 * or not the write landed — the bug this screen exists to fix. Saving is now
 * PUT /api/pricing, and the confirmation waits for the server to answer.
 *
 * A WORKING COPY, NOT THE CACHE
 * Edits are made against a deep clone of LSCData.pricing(). The cached card is
 * replaced only by what the server echoes back on a successful save, so an
 * abandoned or failed edit can never price an estimate. This matters more than
 * it looks: the editor computes live totals from that cache.
 *
 * THE TAX SET-ASIDE RATE
 * This screen owns the one input to calc.js's tax provision. The desktop app
 * read it as `parseFloat(v)/100 || 0.35`, which quietly turned a deliberate 0%
 * into 35% — 0 is falsy. It is validated here instead, and a blank or
 * out-of-range value blocks the save rather than being guessed at.
 *
 * THE COMPUTED RATE COLUMN
 * Every labour row's Rate ($/hr) is now the one Overhead Rate/hr — Annual
 * Business Cost / Annual Billable Hours — read from Overhead and Capacity via
 * LSCData.overheadRate(), shown
 * read-only, and identical down the whole card. Travel rows are untouched and
 * still manually priced. This collapses the card's old $30-$110 per-row cost
 * differentiation on purpose: it is a standard flat overhead-absorption rate
 * per direct-labour-hour, confirmed against real-world accounting practice
 * before it was built, not a shortcut.
 *
 * It is safe to do this to a field the estimator reads because `rate` feeds no
 * billing calculation anywhere — computeTotals prices labour off `mu` alone.
 * If that ever stops being true, this whole column needs re-examining rather
 * than assuming the argument still holds.
 *
 * NOTHING HERE WRITES THE COMPUTED RATE BACK
 * The displayed figure is derived at mount and never enters the working copy,
 * so payload() still ships each row's own stored `rate` untouched. Persisting
 * it instead would flatten every row's saved rate to one number on the next
 * save of any unrelated edit — irreversible, invisible in the UI (which shows
 * the computed figure either way), and impossible in the empty state, where
 * there is no number to write at all. The stored value is simply inert.
 *
 * DAY ROWS AND hoursPerUnit (2026-09-27, .design/price-calculator/)
 * Under each labour row's name: "per hour / half day / full day". A day row
 * stores `dayUnit: 'full' | 'half'` — the marker, since names are the user's to
 * change — and `hoursPerUnit`, the billable hours one unit consumes, which
 * computeTotals multiplies quantity by for totalHours and so for the estimate
 * editor's Minimum Job Price (calc.js, "Hours and quantity are not the same
 * thing"). Choosing a day unit PREFILLS the hours from Capacity's billable
 * hours per day (half that for a half day), and the hours stay editable: a
 * shoot day genuinely runs longer than an average working day, and forcing
 * them equal would distort one number to fix the other. A half day has its
 * own Mark-Up like any row — there is no 0.5 multiplier anywhere.
 *
 * payload() USED TO DROP BOTH FIELDS. It rebuilt each row from name, rate, mu,
 * customBill and unit only, so a day row would have silently become an hourly
 * one on the next save of any unrelated edit — its hours falling out of every
 * Minimum Job Price with no visible change on the card. Both are carried now,
 * and a blank or out-of-range hours field blocks the save rather than being
 * read as 1.
 *
 * ROW IDS (2026-09-28 audit)
 * Every row carries a stable `id`, assigned at mount to any row that lacks one
 * (every row saved before this) and carried by payload(). Saved estimate lines
 * record it with their own price snapshot, so a renamed service still matches
 * its row for "Update to current rates" and "Use rates from last project".
 * Assigned into the baseline too, so a card whose rows just got ids isn't
 * "unsaved": the ids reach the server on the next real save.
 *
 * YOUR-TIME TRAVEL ROWS (2026-09-28 audit)
 * A travel row ticked "Your time" (ownTime) is the owner's own hours billed as
 * travel: the whole of it is income for the tax set-aside, and its quantity
 * counts as billable hours. Otherwise a non-direct row is bought in and
 * resold, and only its markup above Rate is income (calc.js, Travel).
 *
 * EACH ROW'S FLOOR, UNDER ITS MARK-UP
 * The least one unit of the row can sell for, or "below floor by $X". Computed
 * by LSCCalc.labourFloorComparison — the exact function the Dashboard's
 * comparison table uses — so the two screens cannot disagree about a row. It
 * follows the working copy as you type (Mark-Up and hours), against an hourly
 * floor read once at mount like the rate column above.
 */

const PricingView = (() => {
  const { esc, num } = LSCUtil;
  const RESERVED_SECTION_IDS = LSCRows.RESERVED_SECTION_IDS;

  let root = null;
  let handlers = null;
  let card = null; // the working copy
  let taxRaw = ''; // the percent field exactly as typed
  let usage = null; // saved estimates, for delete warnings. null = unknown
  let saving = false;
  let baseline = ''; // the card as last saved, for the unsaved-edit check

  const $ = (id) => root.querySelector('#' + id);
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /* The working copy as it stands, for the unsaved-edit check. Deliberately not
     payload(): that trims and coerces, so a category renamed only by a trailing
     space would compare equal to the saved card and leaving would discard it
     without asking. */
  const snapshot = () => JSON.stringify({ card, taxRaw });

  /* Is this screen still in the page?
     A save is async and nothing stops the user navigating while it is in
     flight, so its outcome can land after they have moved on — and render()
     writes over its container, which put the whole rate card back on top of
     whatever had replaced it. Verified by delaying the PUT and leaving
     mid-save. The same applies to the failure path, where $('pricing-error') is
     simply gone and the old code threw on it.

     Asked of the document, not of `root`. This used to be root.querySelector,
     which was correct while root was #main — a permanent element that other
     screens write over. Since the Finance move, root is #finance-sub, and a
     nav item that leaves Finance replaces #main wholesale and takes that div
     out of the document with the rate card still inside it: root.querySelector
     would keep finding #tax-inp in the detached tree and answer "still on
     screen" forever. The LSCUnsaved watcher below is the one that makes that
     visible — a stale dirty rate card would then interrupt every later
     navigation to ask about a screen nobody can see. getElementById can't see a
     detached node, which is exactly the question being asked.

     This depends on #tax-inp being unique in the document: the Goals screen
     reuses .tax-setting for the same underlying field and must give its input a
     different id. */
  const onScreen = () => Boolean(document.getElementById('tax-inp'));

  /* The stored rate is a fraction; the field shows a percent. A plain ×100 puts
     the float error on screen — 0.07 renders as 7.000000000000001 — so the
     result is snapped to 6 decimal places, far finer than the field's 0.5 step
     and coarse enough to absorb the artifact without rounding a real value. */
  const toPercent = (rate) => String(Math.round(num(rate) * 1e8) / 1e6);

  /* The Overhead Rate/hr every labour row shows in place of its stored rate.
     null is "not set up yet" — LSCCalc returns null rather than 0 for an empty
     overhead list or an unset billable capacity, and that has to survive all
     the way to the screen: a rate card reading "$0.00" looks like a computed
     answer meaning an hour of your time costs nothing, rather than a question
     nobody has answered.

     Read once per mount, not per render. Nothing on this screen can change an
     overhead item or a goal; the only screens that can are the other two
     Finance sub-tabs, and visiting one and coming back re-mounts this view
     through FinanceView. So it cannot go stale between two renders, and
     mount() is what the brief's "recomputed fresh on every page load" means. */
  let computedRate = null;

  /* The hourly INCOME floor — target annual revenue ÷ billable hours, since
     the 2026-09-28 audit (it was overhead × (1 + markup)) — that each row's
     floor line multiplies by its hours. null when either is unset, which the
     line shows as an em dash rather than a floor of $0. Read once per mount,
     for the same reason computedRate is. */
  let perHourFloor = null;

  /* What a new day row's hours prefill from: Capacity's billable hours per day,
     or the reference 8 when Capacity has no usable figure. Visible and editable
     on the row either way, so the fallback is never silent. */
  function dayHours(unit) {
    const perDay = parseFloat(LSCData.goals().billableHoursPerDay);
    const full = Number.isFinite(perDay) && perDay > 0 && perDay <= 24 ? perDay : 8;
    return unit === 'half' ? full / 2 : full;
  }

  /* A row shows its hours field when it is a day row, or when it already
     carries hours of its own (set some other way) — never hide a number that
     changes the arithmetic. */
  const showsHours = (row) =>
    row.dayUnit === 'full' || row.dayUnit === 'half' ||
    (row.hoursPerUnit !== undefined && row.hoursPerUnit !== 1);

  /* The floor line under a row's Mark-Up. Through labourFloorComparison with a
     one-row card, so the arithmetic — hoursPerUnitOf's fallback, GST taken out
     of an inclusive price, exactly-at-floor not counting as below — is the
     Dashboard's to the cent. */
  function floorLineHtml(row) {
    const [c] = LSCCalc.labourFloorComparison(
      { labourSections: [{ id: '', label: '', rows: [row] }] },
      LSCData.settings(),
      perHourFloor
    );
    if (!c || c.floor === null) return 'floor —';
    if (c.belowFloor) return '<span class="pricing-below">below floor by ' + LSCUtil.fmt(c.gap) + '</span>';
    return 'floor ' + LSCUtil.fmt(c.floor);
  }

  function refreshFloorLine(si, ri) {
    const el = root.querySelector('#pfl-' + si + '-' + ri);
    const row = (card.labourSections[si] || { rows: [] }).rows[ri];
    if (el && row) el.innerHTML = floorLineHtml(row);
  }

  /* A day row's Mark-Up is per half or full day while this column is per
     hour, so on those rows alone the figure carries its unit: "15.12/hr"
     beside "1120" no longer reads as two prices for the same thing (design
     review, should-fix 7). Hourly rows match their column head and stay bare. */
  /* A stable row id — see ROW IDS above. Random rather than derived from the
     name, which is the thing it has to survive a change of. */
  const newRowId = () => 'r_' + Math.random().toString(36).slice(2, 10);

  /* Gives every row an id it doesn't already have. Returns whether any did. */
  function assignRowIds(c) {
    let changed = false;
    c.labourSections.forEach((sec) => sec.rows.forEach((row) => {
      if (!row.id) { row.id = newRowId(); changed = true; }
    }));
    c.travelRows.forEach((row) => {
      if (!row.id) { row.id = newRowId(); changed = true; }
    });
    return changed;
  }

  const rateDisplay = (row) =>
    computedRate === null
      ? '—'
      : computedRate.toFixed(2) + (row && (row.dayUnit === 'full' || row.dayUnit === 'half') ? '/hr' : '');

  function newSectionId(taken) {
    let n = 1;
    let id;
    do {
      id = 'cat' + n;
      n++;
    } while (RESERVED_SECTION_IDS[id] || taken[id]);
    return id;
  }

  function takenSectionIds() {
    const taken = {};
    card.labourSections.forEach((s) => {
      taken[s.id] = 1;
    });
    return taken;
  }

  // ── How many saved estimates a deletion would affect ──────────────────────

  /* The desktop app could count these for free — every project was in memory.
     Here it costs a request, and the answer is advisory: it changes the wording
     of a confirm, never whether the delete is allowed. So a failure to load it
     leaves the count unknown and the note is dropped, rather than claiming a
     reassuring zero. */
  function countUsingSection(sectionId) {
    if (!usage) return null;
    return usage.filter((e) => ((e.activeRows || {})[sectionId] || []).length).length;
  }

  function countUsingRow(sectionId, name) {
    if (!usage) return null;
    return usage.filter((e) =>
      ((e.activeRows || {})[sectionId] || []).some((r) => r.name === name)
    ).length;
  }

  function usedNote(count) {
    if (count === null || count === 0) return '';
    return count === 1
      ? '\n\n1 saved estimate uses it. It keeps the figures it was quoted at.'
      : '\n\n' + count + ' saved estimates use it. They keep the figures they were quoted at.';
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /* Names key everything: computeTotals finds a row by matching its name against
     the card, so a blank or duplicated name makes a service impossible to price.
     Ported from catalogueProblems, plus the tax rate, which the desktop app
     never validated. */
  function problems() {
    const found = [];
    // One sentence per problem, however many inputs share it; every one of
    // those inputs is still flagged.
    const add = (msg, field) => {
      const hit = found.find((p) => p.msg === msg);
      if (hit) hit.fields.push(field);
      else found.push({ msg, fields: [field] });
    };
    const q = (selector) => root.querySelector(selector);

    const percent = parseFloat(taxRaw);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      add('The tax set-aside rate must be a number between 0 and 100.', $('tax-inp'));
    }

    const seenSection = {};
    card.labourSections.forEach((sec, si) => {
      const label = String(sec.label || '').trim();
      const labelInp = q('.pricing-sec-label-inp[data-si="' + si + '"]');
      if (!label) add('A category is missing a name.', labelInp);
      const lower = label.toLowerCase();
      if (lower && seenSection[lower]) add('Two categories are both called “' + label + '”.', labelInp);
      seenSection[lower] = 1;

      const seenRow = {};
      sec.rows.forEach((r, ri) => {
        const name = String(r.name || '').trim();
        const key = name.toLowerCase();
        const nameInp = q('input[data-type="labour"][data-si="' + si + '"][data-ri="' + ri + '"][data-field="name"]');
        if (!key) add('A service in “' + (label || 'a category') + '” is missing a name.', nameInp);
        else if (seenRow[key]) add('“' + name + '” is listed twice in “' + label + '”.', nameInp);
        seenRow[key] = 1;
      });
    });

    /* Hours per unit: a day row needs a real figure. Blank would fall back to
       1 inside calc.js, so a full day would carry one hour of overhead into
       Minimum Job Price — the expensive direction, and invisible. 24 because a
       unit of work can't consume more hours than a day has, and anything a
       person types above it is a slip (a day rate typed into the hours box). */
    card.labourSections.forEach((sec, si) => {
      sec.rows.forEach((r, ri) => {
        if (!showsHours(r)) return;
        const h = parseFloat(r.hoursPerUnit);
        if (!Number.isFinite(h) || h <= 0 || h > 24) {
          add(
            'Billable hours per unit must be more than 0 and no more than 24.',
            q('input[data-si="' + si + '"][data-ri="' + ri + '"][data-field="hoursPerUnit"]')
          );
        }
      });
    });

    const seenTravel = {};
    card.travelRows.forEach((r, ri) => {
      const name = String(r.name || '').trim();
      const key = name.toLowerCase();
      const nameInp = q('input[data-type="travel"][data-ri="' + ri + '"][data-field="name"]');
      if (!key) add('A travel item is missing a name.', nameInp);
      else if (seenTravel[key])
        add('“' + name + '” is listed twice under Travel & Accommodation.', nameInp);
      seenTravel[key] = 1;
    });

    return found;
  }

  // ── Markup ────────────────────────────────────────────────────────────────

  /* Each <td> below carries data-label, matching its own <th> — the same
     arrangement as estimate-editor.js and estimate-detail.js. Below 768px
     css/responsive.css hides the head row and prints those labels beside the
     values. Five columns, four of them fixed, means the service name gets
     whatever is left: 112px at 375px and 45px at 320px, which is not enough of a
     name to edit or even recognise. Inert above 768px. */

  /* The Rate cell is type=text, not a readonly number input: a number input
     cannot render an em dash, and the empty state is an em dash. The only
     alternative would be an empty value with "—" as a placeholder, which is a
     hint rather than a value and is announced as one.

     It also carries no data-si/data-ri/data-field. Those are what bindFieldEdits
     uses to find the row an input writes to, and this one writes to no row —
     leaving them off means that even if the readonly attribute were ever lost,
     there would still be nothing for an edit to land on. */
  function labourSectionMarkup(sec, si) {
    let rows = '';
    if (!sec.rows.length) {
      rows = '<tr><td colspan="5" class="pricing-empty-td">No services yet — add one below.</td></tr>';
    }
    sec.rows.forEach((row, ri) => {
      const unit = row.dayUnit === 'full' || row.dayUnit === 'half' ? row.dayUnit : '';
      const opt = (value, label) =>
        '<option value="' + value + '"' + (unit === value ? ' selected' : '') + '>' + label + '</option>';
      rows +=
        '<tr><td data-label="Service"><input class="pricing-name-inp" type="text" value="' + esc(row.name) +
        '" placeholder="Service name" aria-label="Service name" data-si="' + si + '" data-ri="' + ri +
        '" data-field="name" data-type="labour">' +
        /* The unit line. A select for the three units the business sells in,
           and — for a day row — its billable hours, prefilled and editable. */
        '<div class="pricing-row-meta">per <select class="pricing-unit-sel" data-si="' + si + '" data-ri="' + ri +
        '" aria-label="Unit ' + esc(row.name) + ' is sold in">' +
        opt('', 'hour') + opt('half', 'half day') + opt('full', 'full day') + '</select>' +
        (showsHours(row)
          ? ' <input type="number" class="pricing-hpu-inp" min="0.5" max="24" step="0.5" value="' +
            esc(row.hoursPerUnit === undefined ? '' : String(row.hoursPerUnit)) +
            '" aria-label="Billable hours in one unit of ' + esc(row.name) + '" data-si="' + si + '" data-ri="' + ri +
            '" data-field="hoursPerUnit" data-type="labour"> billable hrs'
          : '') +
        '</div></td>' +
        '<td style="text-align:right" data-label="Rate ($/hr)"><input type="text" readonly' +
        ' aria-readonly="true" aria-describedby="pricing-rate-note" class="pricing-rate-ro' +
        (computedRate === null ? ' pricing-rate-none' : '') + (unit ? ' pricing-rate-day' : '') +
        '" value="' + rateDisplay(row) +
        '" aria-label="Internal rate for ' + esc(row.name) + ', calculated automatically"></td>' +
        '<td style="text-align:right" data-label="Mark-Up ($)"><input type="number" min="0" step="0.01" value="' + num(row.mu) +
        '" aria-label="Client rate for ' + esc(row.name) + '" aria-describedby="pfl-' + si + '-' + ri +
        '" data-si="' + si + '" data-ri="' + ri + '" data-field="mu" data-type="labour">' +
        '<div class="pricing-floor" id="pfl-' + si + '-' + ri + '">' + floorLineHtml(row) + '</div></td>' +
        '<td style="text-align:center" data-label="Custom"><input type="checkbox"' + (row.customBill ? ' checked' : '') +
        ' data-si="' + si + '" data-ri="' + ri + '" data-field="customBill" data-type="labour"' +
        ' aria-label="Allow a custom bill amount for ' + esc(row.name) + '"' +
        ' title="Allow a custom bill amount to override hours × mark-up"></td>' +
        '<td class="pricing-act"><button type="button" class="del-btn" title="Delete this service"' +
        ' aria-label="Delete ' + esc(row.name) + '" data-del-si="' + si + '" data-del-row="' + ri + '">×</button></td></tr>';
    });

    return (
      '<div class="pricing-section"><div class="pricing-sec-head">' +
      '<input class="pricing-sec-label-inp" type="text" value="' + esc(sec.label) +
      '" placeholder="Category name" aria-label="Category name" data-si="' + si + '" data-field="label">' +
      '<button type="button" class="del-btn" title="Delete this category"' +
      ' aria-label="Delete the ' + esc(sec.label) + ' category" data-del-sec="' + si + '">×</button></div>' +
      '<table class="pricing-table"><thead><tr><th>Service</th>' +
      '<th style="text-align:right">Rate ($/hr)</th>' +
      '<th style="text-align:right">Mark-Up ($)</th>' +
      '<th class="pricing-flag-th" title="Let this service take a custom bill amount on the estimate">Custom</th>' +
      '<th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pricing-sec-foot">' +
      '<span class="pricing-hint">' + sec.rows.length + ' service' + (sec.rows.length === 1 ? '' : 's') + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-add-row="' + si + '">+ Add Service</button>' +
      '</div></div>'
    );
  }

  function travelSectionMarkup() {
    let rows = '';
    if (!card.travelRows.length) {
      rows = '<tr><td colspan="6" class="pricing-empty-td">No items yet — add one below.</td></tr>';
    }
    card.travelRows.forEach((row, ri) => {
      rows +=
        '<tr><td data-label="Service"><input class="pricing-name-inp" type="text" value="' + esc(row.name) +
        '" placeholder="Item name" aria-label="Item name" data-ri="' + ri +
        '" data-field="name" data-type="travel"></td>' +
        '<td style="text-align:right" data-label="Rate ($)"><input type="number" min="0" step="0.01" value="' + num(row.rate) +
        '" aria-label="Cost for ' + esc(row.name) + '" data-ri="' + ri + '" data-field="rate" data-type="travel"></td>' +
        '<td style="text-align:right" data-label="Mark-Up ($)"><input type="number" min="0" step="0.01" value="' + num(row.mu) +
        '" aria-label="Client rate for ' + esc(row.name) + '" data-ri="' + ri + '" data-field="mu" data-type="travel"></td>' +
        '<td style="text-align:center" data-label="Direct"><input type="checkbox"' + (row.directCost ? ' checked' : '') +
        ' data-ri="' + ri + '" data-field="directCost" data-type="travel"' +
        ' aria-label="Bill ' + esc(row.name) + ' at cost"' +
        ' title="Billed at cost — the quantity entered is the amount billed"></td>' +
        '<td style="text-align:center" data-label="Your time"><input type="checkbox"' + (row.ownTime ? ' checked' : '') +
        (row.directCost ? ' disabled' : '') +
        ' data-ri="' + ri + '" data-field="ownTime" data-type="travel"' +
        ' aria-label="' + esc(row.name) + ' is your own time"' +
        ' title="Your own hours: all of it is income, and the quantity counts as billable hours"></td>' +
        '<td class="pricing-act"><button type="button" class="del-btn" title="Delete this item"' +
        ' aria-label="Delete ' + esc(row.name) + '" data-del-travel="' + ri + '">×</button></td></tr>';
    });

    return (
      '<div class="pricing-section"><div class="pricing-sec-head">' +
      '<h2 class="pricing-sec-label">Travel &amp; Accommodation</h2>' +
      '<span style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Expenses</span></div>' +
      '<table class="pricing-table"><thead><tr><th>Item</th>' +
      '<th style="text-align:right">Rate ($)</th>' +
      '<th style="text-align:right">Mark-Up ($)</th>' +
      '<th class="pricing-flag-th" title="Billed straight through at cost, with no mark-up">Direct</th>' +
      '<th class="pricing-flag-th" title="Your own hours, not something bought in">Your time</th>' +
      '<th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pricing-sec-foot">' +
      '<span class="pricing-hint">' + card.travelRows.length + ' item' +
      (card.travelRows.length === 1 ? '' : 's') + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="js-add-travel">+ Add Item</button>' +
      '</div></div>'
    );
  }

  function markup() {
    let html =
      '<div class="page-head"><div><h1 class="page-title">Rate Card</h1>' +
      '<div class="page-sub">Add, rename, re-price or remove anything the estimator offers</div></div></div>' +
      '<div class="tax-setting"><div>' +
      '<div class="sum-label" style="margin-bottom:4px">Tax Set-Aside Rate (%)</div>' +
      '<div style="color:var(--muted);font-size:11px">Set aside from each job’s profit — labour, your-time travel ' +
      'and the markup on resold travel, less the overhead its hours carry — before GST. Pass-through costs are exempt.</div></div>' +
      '<input type="number" id="tax-inp" min="0" max="100" step="0.5" value="' + esc(taxRaw) +
      '" aria-label="Tax set-aside rate, percent"></div>' +
      '<div class="pricing-catalogue-bar">' +
      '<span class="pricing-hint">These categories and services are exactly what you pick from when building an estimate.</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="js-add-cat">+ Add Category</button>' +
      '</div>' +
      /* Directly above the tables, so it is read before the first read-only
         field is reached rather than after. #pricing-rate-note is the target of
         every labour rate input's aria-describedby, which makes it a
         document-unique id with the same constraint #tax-inp carries (see
         onScreen above): no other screen may reuse it. */
      '<p class="pricing-rate-note" id="pricing-rate-note">' +
      'Rate is calculated automatically from your Overhead and Capacity settings and can’t be ' +
      /* &nbsp; before the dash so a wrap can't start a line with it — the copy
         is unchanged, the break just moves to after the dash instead. */
      'edited here&nbsp;— update it on the ' +
      '<button type="button" class="pricing-rate-note-link" data-go-tab="overhead">Overhead</button>' +
      ' / ' +
      '<button type="button" class="pricing-rate-note-link" data-go-tab="capacity">Capacity</button>' +
      ' tabs. Mark-Up stays yours to set.</p>' +
      '<p class="sr-only" id="pricing-floor-live" aria-live="polite"></p>' +
      '<div class="pricing-grid">';

    card.labourSections.forEach((sec, si) => {
      html += labourSectionMarkup(sec, si);
    });
    html += travelSectionMarkup();
    html += '</div>';

    html +=
      '<div id="pricing-error" role="alert"></div>' +
      '<div class="pricing-save-bar">' +
      '<p>Changes apply to estimates you build from here on. Estimates already saved keep the figures they were quoted at.</p>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<span class="saved-msg" id="saved-msg">✓ Services saved</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="js-reset" data-write>Reset Defaults</button>' +
      '<button type="button" class="btn btn-accent" id="js-save-pricing" data-write>' +
      '<span class="spinner" id="save-spin"></span><span id="save-label">Save Services</span></button>' +
      '</div></div>';

    return html;
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  function showError(message) {
    const el = $('pricing-error');
    if (!el) return; // left while the request was in flight
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    LSCUtil.clearFieldErrors($('pricing-error'));
  }

  function setSaving(next) {
    // The flag first: it is module state and has to be cleared even when the
    // buttons it describes are no longer in the page.
    saving = next;
    if (!onScreen()) return;
    $('js-save-pricing').disabled = next;
    $('js-reset').disabled = next;
    $('save-spin').style.display = next ? 'inline-block' : 'none';
    $('save-label').textContent = next ? 'Saving…' : 'Save Services';
  }

  function flashSaved() {
    const msg = $('saved-msg');
    if (!msg) return;
    msg.style.display = 'inline';
    setTimeout(() => {
      // The screen may have been re-rendered or left in the meantime.
      if (msg.isConnected) msg.style.display = 'none';
    }, 2500);
  }

  /* Field edits write straight to the working copy without a re-render, so
     typing a name never loses focus mid-word. Structural changes — adding or
     deleting a row or category — re-render, because the data-si/data-ri indices
     every other input carries would otherwise be stale. */
  function bindFieldEdits() {
    /* :not([readonly]) skips the computed rate column. An `input` event never
       fires on a readonly field anyway, so this changes no behaviour — it says
       at the binding site that the field is not part of the working copy,
       instead of leaving it to be inferred from a missing data-field. */
    root.querySelectorAll('.pricing-table input:not([readonly]), .pricing-sec-label-inp').forEach((input) => {
      const event = input.type === 'checkbox' ? 'change' : 'input';
      input.addEventListener(event, () => {
        const field = input.dataset.field;
        if (!field) return;

        if (field === 'label') {
          card.labourSections[parseInt(input.dataset.si, 10)].label = input.value;
          return;
        }

        const target =
          input.dataset.type === 'labour'
            ? (card.labourSections[parseInt(input.dataset.si, 10)] || { rows: [] })
                .rows[parseInt(input.dataset.ri, 10)]
            : card.travelRows[parseInt(input.dataset.ri, 10)];
        if (!target) return;

        if (field === 'name') target.name = input.value;
        else if (field === 'hoursPerUnit') {
          /* Held as '' when blank, not num('') = 0: validation has to be able to
             tell "no hours" from a number, and 0 would fall back to 1 silently. */
          target.hoursPerUnit = input.value === '' ? '' : num(input.value);
        } else if (field === 'customBill' || field === 'directCost' || field === 'ownTime') {
          // Absent rather than false, matching the shape defaults.js ships.
          if (input.checked) target[field] = true;
          else delete target[field];
          /* Direct and your-time are exclusive — a direct row is money passed
             through, not anybody's hours — so ticking Direct clears and
             disables Your time. Structural, so it re-renders. */
          if (field === 'directCost') {
            delete target.ownTime;
            render();
            const again = root.querySelector('input[data-type="travel"][data-ri="' + input.dataset.ri + '"][data-field="directCost"]');
            if (again) again.focus();
          }
        } else target[field] = num(input.value);

        if (input.dataset.type === 'labour' && (field === 'mu' || field === 'hoursPerUnit')) {
          const si = parseInt(input.dataset.si, 10);
          const ri = parseInt(input.dataset.ri, 10);
          refreshFloorLine(si, ri);
          /* The line is the Mark-Up's description, so it is read on focus; this
             is for the change while typing, spoken once typing pauses. */
          const line = root.querySelector('#pfl-' + si + '-' + ri);
          if (line) {
            LSCUtil.announce(
              $('pricing-floor-live'),
              (String(target.name).trim() || 'This service') + ': ' + line.textContent.replace(/^floor —$/, 'no floor yet') + '.'
            );
          }
        }
      });
    });

    /* The unit select. Changing it is structural — the hours field appears or
       goes — so it re-renders, and puts focus back on the select it came from.

       Switching an existing row between hourly and day units changes what its
       QUANTITY means on every estimate edited from then on (8 on an estimate
       stops meaning eight hours and starts meaning eight days). The bill is
       still qty × Mark-Up, so saved figures don't move, but the next edit of
       such an estimate would read differently — so when saved estimates use
       the row, it asks first. */
    root.querySelectorAll('.pricing-unit-sel').forEach((sel) => {
      sel.addEventListener('change', () => {
        const si = parseInt(sel.dataset.si, 10);
        const ri = parseInt(sel.dataset.ri, 10);
        const sec = card.labourSections[si];
        const row = sec && sec.rows[ri];
        if (!row) return;
        const next = sel.value;
        const wasDay = row.dayUnit === 'full' || row.dayUnit === 'half';
        const isDay = next === 'full' || next === 'half';

        if (wasDay !== isDay) {
          const count = countUsingRow(sec.id, row.name);
          if (count) {
            const ok = window.confirm(
              (count === 1 ? '1 saved estimate uses' : count + ' saved estimates use') + ' “' + row.name + '”.\n\n' +
                'If ' + (count === 1 ? 'it is' : 'they are') + ' edited after this, the quantity on ' +
                (count === 1 ? 'it' : 'them') + ' will count as ' + (isDay ? 'days' : 'hours') + ', not ' +
                (isDay ? 'hours' : 'days') + '. What ' + (count === 1 ? 'it was' : 'they were') +
                ' quoted at doesn’t change.\n\nChange the unit?'
            );
            if (!ok) {
              sel.value = row.dayUnit || '';
              return;
            }
          }
        }

        if (isDay) {
          row.dayUnit = next;
          row.hoursPerUnit = dayHours(next);
        } else {
          delete row.dayUnit;
          delete row.hoursPerUnit;
        }
        render();
        const again = root.querySelector('.pricing-unit-sel[data-si="' + si + '"][data-ri="' + ri + '"]');
        if (again) again.focus();
      });
    });

    $('tax-inp').addEventListener('input', function () {
      taxRaw = this.value;
    });
  }

  function bindStructure() {
    $('js-add-cat').addEventListener('click', () => {
      card.labourSections.push({
        id: newSectionId(takenSectionIds()),
        label: 'New Category',
        rows: [{ id: newRowId(), name: 'New Service', rate: 0, mu: 0 }],
      });
      render();
    });

    root.querySelectorAll('[data-add-row]').forEach((btn) => {
      btn.addEventListener('click', () => {
        card.labourSections[parseInt(btn.dataset.addRow, 10)].rows.push({
          id: newRowId(),
          name: 'New Service',
          rate: 0,
          mu: 0,
        });
        render();
      });
    });

    $('js-add-travel').addEventListener('click', () => {
      card.travelRows.push({ id: newRowId(), name: 'New Item', rate: 0, mu: 0 });
      render();
    });

    root.querySelectorAll('[data-del-sec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const si = parseInt(btn.dataset.delSec, 10);
        const sec = card.labourSections[si];
        if (!sec) return;
        const count = sec.rows.length;
        const confirmed = window.confirm(
          'Delete the “' + sec.label + '” category and its ' + count + ' service' +
            (count === 1 ? '' : 's') + '?' + usedNote(countUsingSection(sec.id))
        );
        if (!confirmed) return;
        card.labourSections.splice(si, 1);
        render();
      });
    });

    root.querySelectorAll('[data-del-row]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = card.labourSections[parseInt(btn.dataset.delSi, 10)];
        if (!sec) return;
        const ri = parseInt(btn.dataset.delRow, 10);
        const row = sec.rows[ri];
        if (!row) return;
        if (!window.confirm('Delete “' + row.name + '”?' + usedNote(countUsingRow(sec.id, row.name)))) return;
        sec.rows.splice(ri, 1);
        render();
      });
    });

    root.querySelectorAll('[data-del-travel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ri = parseInt(btn.dataset.delTravel, 10);
        const row = card.travelRows[ri];
        if (!row) return;
        if (!window.confirm('Delete “' + row.name + '”?' + usedNote(countUsingRow('travel', row.name)))) return;
        card.travelRows.splice(ri, 1);
        render();
      });
    });

    /* The note's Overhead / Goals links. onGoTab is FinanceView's selectTab,
       which asks LSCUnsaved before it swaps screens — so following one of these
       from a half-edited rate card offers to save it, exactly as clicking the
       sub-tab itself would. Absent if this view is ever mounted outside
       Finance, in which case the links do nothing rather than throw. */
    root.querySelectorAll('[data-go-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (handlers.onGoTab) handlers.onGoTab(btn.dataset.goTab);
      });
    });

    $('js-save-pricing').addEventListener('click', save);
    $('js-reset').addEventListener('click', reset);
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  /* Trim on the way out only. Trimming as the user types would eat the space
     between two words the moment it was pressed. */
  function payload() {
    return {
      labourSections: card.labourSections.map((sec) => ({
        id: sec.id,
        label: String(sec.label).trim(),
        rows: sec.rows.map((row) => {
          const out = { id: row.id, name: String(row.name).trim(), rate: num(row.rate), mu: num(row.mu) };
          if (row.customBill) out.customBill = true;
          if (row.unit) out.unit = row.unit;
          // Carried through — see "payload() USED TO DROP BOTH FIELDS" above.
          // An hours value of 1 is the default and is left off, like every
          // hourly row already on the card.
          if (row.dayUnit === 'full' || row.dayUnit === 'half') out.dayUnit = row.dayUnit;
          const hours = parseFloat(row.hoursPerUnit);
          if (Number.isFinite(hours) && hours > 0 && hours !== 1) out.hoursPerUnit = hours;
          return out;
        }),
      })),
      travelRows: card.travelRows.map((row) => {
        const out = { id: row.id, name: String(row.name).trim(), rate: num(row.rate), mu: num(row.mu) };
        if (row.directCost) out.directCost = true;
        if (row.ownTime && !row.directCost) out.ownTime = true;
        if (row.unit) out.unit = row.unit;
        return out;
      }),
      taxSetAsideRate: parseFloat(taxRaw) / 100,
    };
  }

  async function save() {
    if (saving) return;
    clearError();

    const found = problems();
    if (found.length) {
      // The desktop app used alert() here. A blocking dialog hides the very
      // fields the message is describing.
      LSCUtil.showFieldErrors($('pricing-error'), found, 'Fix this before saving:');
      return;
    }

    const body = payload();
    setSaving(true);
    Toast.working('Saving rates…');

    try {
      const reply = await LSCApi.put('/api/pricing', body);
      // Only now is this the card estimates are priced against.
      LSCData.setPricing(reply.pricing);
      card = clone(reply.pricing);
      taxRaw = toPercent(reply.pricing.taxSetAsideRate);
      baseline = snapshot();
      Toast.ok('Rates saved.');
      // Cleared before the re-render, not through setSaving: render() replaces
      // the button this would otherwise re-enable. Leaving the flag set is what
      // made every save after the first one a silent no-op.
      saving = false;
      if (!onScreen()) return;
      render();
      flashSaved();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(
        err.kind === 'network'
          ? 'Couldn’t save — the server is unreachable. Your changes are still here; try again once it’s back.'
          : 'Couldn’t save: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  async function reset() {
    if (saving) return;
    const confirmed = window.confirm(
      'Reset every category, service and rate back to the built-in defaults?\n\n' +
        'This replaces the saved rate card immediately. Estimates already saved keep ' +
        'the figures they were quoted at.'
    );
    if (!confirmed) return;

    clearError();
    setSaving(true);
    Toast.working('Restoring defaults…');

    try {
      const reply = await LSCApi.post('/api/pricing/reset');
      LSCData.setPricing(reply.pricing);
      card = clone(reply.pricing);
      taxRaw = toPercent(reply.pricing.taxSetAsideRate);
      baseline = snapshot();
      Toast.ok('Defaults restored.');
      saving = false;
      if (!onScreen()) return;
      render();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(
        err.kind === 'network'
          ? 'Couldn’t restore defaults — the server is unreachable.'
          : 'Couldn’t restore defaults: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  // ── Mounting ──────────────────────────────────────────────────────────────

  function render() {
    const scrollY = window.scrollY;
    root.innerHTML = markup();
    bindFieldEdits();
    bindStructure();
    window.scrollTo(0, scrollY);
  }

  /* Advisory only — it sharpens the delete confirmations. The screen is fully
     usable before it arrives, and stays usable if it never does. */
  async function loadUsage() {
    try {
      const reply = await LSCApi.get('/api/estimates');
      usage = reply.estimates || [];
    } catch (err) {
      if (err instanceof LSCApi.ApiError && err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      usage = null;
    }
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers;
    saving = false;
    usage = null;

    const pricing = LSCData.pricing();
    card = clone({
      labourSections: pricing.labourSections || [],
      travelRows: pricing.travelRows || [],
    });
    taxRaw = toPercent(pricing.taxSetAsideRate);
    assignRowIds(card);
    /* Deliberately outside the working copy and outside snapshot(): this is
       derived, read-only and unsaveable, so it must not make the card look
       dirty or be shipped by payload(). */
    /* Annual business cost (operating costs + gear replacement reserve) ÷
       annual billable hours from Capacity — through LSCData.overheadRate() so
       this column, the estimate editor's floor, the Capacity confirm and the
       Dashboard all use one computation. See data.js. */
    computedRate = LSCData.overheadRate();
    perHourFloor = LSCData.incomeFloor();
    baseline = snapshot();

    render();
    LSCUnsaved.watch('pricing', {
      label: 'the rate card',
      // The module-level sentinel, not a second copy of it: these two had drifted
      // into duplicate expressions asking the same question, and only one of them
      // would have been fixed for the Finance move. Asks what is in the page
      // rather than holding an element, because every structural edit re-renders
      // this screen and would invalidate a stored reference.
      onScreen,
      dirty: () => snapshot() !== baseline,
    });
    loadUsage();
    focusRow(handlers && handlers.focusRow);
  }

  /* The Dashboard's "Below by $X" lands here with { sectionId, index } — the
     row's section id and its position in that section, since names are
     editable and needn't be unique. Focuses that row's Mark-Up, the one field
     the gap is about, and centres it: a Mark-Up in the last category would
     otherwise sit at the bottom edge. A row that has gone (the card changed in
     between) just leaves the screen at the top, as a rail click would. */
  function focusRow(target) {
    if (!target || typeof target !== 'object') return;
    const si = card.labourSections.findIndex((sec) => String(sec.id) === String(target.sectionId));
    if (si < 0) return;
    const inp = root.querySelector(
      'input[data-si="' + si + '"][data-ri="' + Number(target.index) + '"][data-field="mu"]'
    );
    if (!inp) return;
    inp.focus({ preventScroll: true });
    inp.scrollIntoView({ block: 'center' });
  }

  return { mount };
})();
