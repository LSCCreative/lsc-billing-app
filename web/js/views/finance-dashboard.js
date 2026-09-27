'use strict';

/* The Finance & Price Dashboard — the whole cost-to-rate chain on one screen.
 *
 * WHAT IT ANSWERS
 * "Is my pricing right?" The least an hour, a half day and a full day can sell
 * for, whether each row on the rate card clears that, and the chain of numbers
 * the floors come from, each linked to the screen that owns it.
 *
 * READ-ONLY, BAR ONE MIRROR, AND IT OWNS NO NUMBER
 * Nothing in sections 1–5 is stored or editable (the GST mirror, section 7,
 * edits a number Invoice Settings owns — see below). Every figure is derived
 * on mount from the LSCData cache (and, for jobs needed, the estimates list),
 * through calc.js — the same
 * functions the Rate Card, the estimate editor, Capacity and Profit Goals use —
 * so this screen cannot show a number another screen disagrees with. The one
 * computation more than one screen needs, overhead cost per hour, comes from
 * LSCData.overheadRate() for exactly that reason. Leave and come back to see a
 * change made elsewhere: FinanceView re-mounts this view on every visit.
 *
 * ORDER IS THE IA DOC'S HIERARCHY, NOT A STYLING CHOICE
 *   1. the three floors, largest type on the page;
 *   2. the rate card measured against them;
 *   3. the cost-to-rate chain, costs left and capacity right, like the
 *      reference spreadsheet — business cost ALWAYS split Operating +
 *      Replacement reserve, because that split is the only place a camera
 *      entered both as an expense and as an asset becomes visible;
 *   4. target annual revenue, with per-month and per-week averages;
 *   5. jobs needed per year, beside the average job it was divided by;
 *   6. the post-ratio readout — a what-if, below the fold;
 *   7. the GST mirror — last, because it changes rarely and is currently off.
 * The comparison's explanation lives in its info control (js/info.js), beside
 * the section heading, not in a note under it.
 *
 * THE POST-RATIO READOUT SAVES NOTHING
 * Section 6 has two inputs — shoot days a month, edit days per shoot day —
 * and a sentence saying how much of a month's capacity they use
 * (postRatioReadout in calc.js does the arithmetic). Both are what-ifs held in
 * this module and reset to the defaults on every mount: no route, no
 * LSCUnsaved watcher (there is nothing to lose), and nothing prices against
 * them. It is deliberately not a cap — brief decision 9 — so an over-full
 * month reads as a warning in the sentence, never as a validation error.
 *
 * THE GST MIRROR IS AN EDITABLE MIRROR, NOT A COPY
 * Section 7 edits settings.gst — the same stored object the Invoice Settings
 * modal edits, through the same PUT /api/settings — exactly as Profit Goals
 * mirrors the rate card's tax set-aside rate, and its copy says so. Three
 * rules carried over from settings.js on purpose, because two screens writing
 * one field must not disagree about it:
 *   - The save MERGES. PUT /api/settings replaces the whole row, and this
 *     block owns `gst` only, so it reads the row fresh at save time and swaps
 *     `gst` into that — never into LSCData's boot-time copy, which could be
 *     missing an ABN or bank details saved since. Sending { gst } alone would
 *     delete the payment block off every invoice.
 *   - Same validation: registering needs an ABN, and the rate is 0–100 only
 *     while registered (an inert field on an unregistered business isn't
 *     worth blocking a save over, and an unusable one keeps what's stored).
 *   - If the stored GST changed since this block loaded (another device, or
 *     the modal while this block had unsaved edits), nothing is written: the
 *     block shows what is stored and says so, rather than silently reverting
 *     someone's change. SettingsView calls refreshGst() after its own save so
 *     the ordinary same-tab case just updates in place.
 * The block has its own Save and its own LSCUnsaved watcher; nothing else on
 * the page is saved. It changes no figure in sections 1–5 while the card is
 * GST-exclusive: the comparison is the only GST-aware part (priceExGst backs
 * GST out of a GST-inclusive card), so that section alone is redrawn on save.
 *
 * THE HEADLINE DAY FLOORS USE CAPACITY'S FULL-DAY HOURS
 * The IA doc writes fullDayFloor = hourlyFloor × (Full Day row's hoursPerUnit).
 * Day rows are now marked (`dayUnit: 'full' | 'half'`, set by the Rate Card's
 * unit select), but there is no single "Full Day row": a card can have a video
 * full day and a photo full day at different lengths, and an old card has
 * none. So the headline half/full-day floors stay hourlyFloor × Capacity's
 * billable hours per day (and half that) — a standard day, the figure every
 * new day row is prefilled from — and each tile says "at N hrs". Every actual
 * row is compared at its OWN hoursPerUnit in section 2, so a day row the user
 * lengthened to 10 hrs shows its own, higher floor there.
 *
 * NULL IS AN EM DASH AND A REASON, NEVER $0.00
 * No capacity, no cost or no margin makes the floors null. They render as an
 * em dash with a sentence naming what is missing, linked to where to fix it.
 * A $0.00 floor would read as "anything you charge is fine".
 */

const FinanceDashboardView = (() => {
  const { esc, fmt, num } = LSCUtil;
  const {
    annualOverheadTotal,
    replacementReserveTotal,
    annualBillableHours,
    hourlyFloor,
    labourFloorComparison,
    targetAnnualRevenue,
    averageJobValue,
    jobsNeededPerYear,
    postRatioReadout,
    round2,
  } = LSCCalc;

  let root = null;
  let handlers = null;
  let mountId = 0; // guards the async estimates fetch against a re-mount

  // The GST mirror (section 7): the fields as typed, and as the server last
  // confirmed them. Same shape as the Invoice Settings modal's GST fields.
  let gstForm = null;
  let gstSaved = null;
  let gstSaving = false;

  /* The post-ratio what-ifs (section 6), as typed. Module state only, reset on
     mount: a typical corporate month to start from — the user moves them. */
  const POST_DEFAULTS = { shoot: '4', ratio: '1' };
  let post = null;

  /* Whether the comparison shows every row on a phone. Below 768px the table
     stacks into one card per service — 21 cards and ~3,500px on the default
     card, between the floors and every panel under them — so it opens showing
     only the rows below their floor, the ones that need doing something about,
     with a button for the rest. Above 768px the button is hidden and every row
     always shows (responsive.css). Kept across a GST redraw; reset on mount. */
  let showAllRows = false;

  /* FRACTION -> PERCENT for the rate field, verbatim from settings.js
     (including the snap that keeps 0.07 from rendering as 7.000000000000001). */
  const toPercent = (rate) => String(Math.round(num(rate) * 1e8) / 1e6);

  const hrs =(n) => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });

  /* A figure's label as a link to the screen that owns it. A button, not an
     anchor: navigation inside the router, never a page load. data-inner rides
     through selectTab's opts to the child's mount — the one deep link into an
     inner tab, Overhead → Depreciation, which that screen will honour once its
     inner tabs exist and simply ignores until then. */
  function link(tab, text, inner) {
    return (
      '<button type="button" class="dash-link" data-go-tab="' + tab + '"' +
      (inner ? ' data-inner="' + inner + '"' : '') + '>' + text + '</button>'
    );
  }

  // ── The numbers ───────────────────────────────────────────────────────────

  function figures() {
    const goals = LSCData.goals();
    const pricing = LSCData.pricing();
    const operating = annualOverheadTotal(LSCData.overheadItems());
    const reserve = replacementReserveTotal(LSCData.depreciationAssets());
    const businessCost = LSCData.businessCost();
    const hours = annualBillableHours(goals);
    const rate = LSCData.overheadRate();
    const margin = goals.targetProfitMarginPct;
    const perHour = hourlyFloor(rate, margin);

    const perDay = parseFloat(goals.billableHoursPerDay);
    const dayHours = Number.isFinite(perDay) && perDay > 0 && perDay <= 24 ? perDay : null;

    return {
      goals,
      operating,
      reserve,
      businessCost,
      hours,
      rate,
      margin,
      perHour,
      dayHours,
      halfDay: perHour === null || dayHours === null ? null : round2(perHour * (dayHours / 2)),
      fullDay: perHour === null || dayHours === null ? null : round2(perHour * dayHours),
      rows: labourFloorComparison(pricing, LSCData.settings(), perHour),
      target: targetAnnualRevenue(businessCost, goals.desiredNetIncome, pricing.taxSetAsideRate),
      taxRate: pricing.taxSetAsideRate,
    };
  }

  /* What is stopping the floors, in the order the arithmetic needs them, each
     linked to the screen that sets it. */
  function floorBlockers(f) {
    const missing = [];
    if (f.hours === null) missing.push(link('capacity', 'your capacity'));
    if (!(f.businessCost > 0)) missing.push(link('overhead', 'what the business costs to run'));
    const m = parseFloat(f.margin);
    if (!Number.isFinite(m) || m < 0) missing.push(link('goals', 'a target profit margin'));
    return missing;
  }

  const joinAnd = (parts) =>
    parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];

  // ── 1. Floors ─────────────────────────────────────────────────────────────

  function floorTile(label, value, sub) {
    return (
      '<div class="proj-card dash-floor">' +
      '<div class="sum-label">' + label + '</div>' +
      '<div class="dash-floor-value' + (value === null ? ' is-empty' : '') + '">' +
      (value === null ? '—' : fmt(value)) + '</div>' +
      '<div class="dash-floor-sub">' + sub + '</div>' +
      '</div>'
    );
  }

  function floorsMarkup(f) {
    const dayNote = (n) =>
      f.dayHours === null
        ? 'set your full-day hours on ' + link('capacity', 'Capacity')
        : 'at ' + hrs(n) + ' hrs';
    const blockers = floorBlockers(f);

    return (
      '<section class="dash-section" aria-labelledby="dash-floors-h">' +
      '<h2 class="dash-h" id="dash-floors-h">Your floors</h2>' +
      '<div class="dash-floors">' +
      floorTile('Hourly', f.perHour, 'per billable hour') +
      floorTile('Half day', f.halfDay, dayNote(f.dayHours === null ? 0 : f.dayHours / 2)) +
      floorTile('Full day', f.fullDay, dayNote(f.dayHours)) +
      '</div>' +
      (blockers.length
        ? '<p class="dash-note">Set up ' + joinAnd(blockers) + ' to see your floors.</p>'
        : '<p class="dash-note">The least each can sell for and still cover the business’s running costs and your ' +
          esc(String(f.margin)) + '% margin. Ex-GST. Crew, hire, travel, flights and accommodation are added to a ' +
          'job at cost on top, so they aren’t part of any floor.</p>') +
      '</section>'
    );
  }

  // ── 2. The rate card against its floors ───────────────────────────────────

  function statusCell(row) {
    if (row.belowFloor === null) return '<td class="right muted-td" data-label="Against floor">—</td>';
    if (row.belowFloor) {
      return (
        '<td class="right" data-label="Against floor"><span class="dash-badge">Below by ' +
        fmt(row.gap) + '</span></td>'
      );
    }
    return (
      '<td class="right muted-td" data-label="Against floor">' +
      (row.muExGst === row.floor ? 'At floor' : fmt(round2(row.muExGst - row.floor)) + ' over') +
      '</td>'
    );
  }

  /* Brief decision 7 and the "rate falls below its floor" state: the floor is
     measured against the marked-up price because that is what recovers
     overhead, pass-throughs are excluded, and a below-floor row is a warning
     the user acts on at the Rate Card — this explains, it doesn't fix. */
  function compareInfo() {
    return LSCInfo.markup({
      id: 'dash-compare',
      label: 'How the floor comparison works',
      title: 'The floor comparison',
      paragraphs: [
        'Each service’s floor is your hourly floor — overhead per billable hour, plus your margin — times the ' +
          'hours one unit of it takes.',
        'It’s measured against <strong>what the client is charged</strong>: the Mark-Up price, ex-GST. Not your ' +
          'internal rate — the marked-up price is what actually recovers overhead.',
        'Crew, hire, travel, flights and accommodation aren’t compared. They’re passed through at cost on top of ' +
          'the labour, so they recover no overhead either way.',
        'Below floor means that price doesn’t cover the business’s costs and your margin at your current capacity. ' +
          'It’s a warning, not a rule — change it on the Rate Card if you agree.',
      ],
    });
  }

  function comparisonMarkup(f) {
    const rows = f.rows;
    const below = rows.filter((r) => r.belowFloor).length;
    const known = rows.length && rows[0].floor !== null;
    const summary = !rows.length
      ? 'No services'
      : !known
        ? 'Floors not set up'
        : below
          ? below + ' of ' + rows.length + ' below floor'
          : 'All ' + rows.length + ' clear their floor';

    const clear = rows.length - below;
    const body = rows
      .map(
        (r) =>
          '<tr class="' + (r.belowFloor ? 'dash-below' : 'dash-clear') + '">' +
          '<td data-label="Service">' + esc(r.name || 'Untitled') + '</td>' +
          '<td class="muted-td" data-label="Section">' + esc(r.sectionLabel || '') + '</td>' +
          '<td class="right muted-td" data-label="Hours per unit">' + hrs(r.hoursPerUnit) + '</td>' +
          '<td class="right" data-label="You charge (ex-GST)">' + fmt(r.muExGst) + '</td>' +
          '<td class="right" data-label="Floor">' + (r.floor === null ? '—' : fmt(r.floor)) + '</td>' +
          statusCell(r) +
          '</tr>'
      )
      .join('');

    return (
      '<section class="dash-section" aria-labelledby="dash-compare-h">' +
      '<div class="est-block">' +
      /* The info control sits BESIDE the <h2>, not in it: inside, its name
         would be read as part of the heading ("Rate card against its floors
         How the floor comparison works"). */
      '<div class="est-block-head"><div class="dash-block-title"><h2 class="est-block-label" id="dash-compare-h">' +
      link('pricing', 'Rate card against its floors') + '</h2>' + compareInfo() + '</div>' +
      '<span class="est-block-sum' + (below ? ' dash-sum-below' : '') + '">' + summary + '</span></div>' +
      (rows.length
        ? '<table class="est-table dash-table' + (showAllRows ? ' dash-table-all' : '') +
          '" id="dash-compare-table"><thead><tr><th>Service</th><th>Section</th>' +
          '<th class="right">Hrs / unit</th><th class="right">You charge (ex-GST)</th>' +
          '<th class="right">Floor</th><th class="right">Against floor</th></tr></thead><tbody>' +
          body + '</tbody></table>' +
          (clear
            ? '<div class="dash-show-all-row"><button type="button" class="btn btn-ghost btn-sm dash-show-all" ' +
              'aria-controls="dash-compare-table" aria-expanded="' + showAllRows + '" ' +
              'data-rows="' + rows.length + '" data-below="' + below + '">' +
              showAllLabel(rows.length, below) + '</button></div>'
            : '')
        : '<p class="dash-empty">No labour services on the rate card yet. Add them on the ' +
          link('pricing', 'Rate Card') + '.</p>') +
      '</div>' +
      '</section>'
    );
  }

  function showAllLabel(total, below) {
    if (!showAllRows) return 'Show all ' + total + ' services';
    return below ? 'Show only the ' + below + ' below floor' : 'Hide the services that clear their floor';
  }

  /* In place rather than through redrawComparison(): re-rendering would drop
     focus off the button the reader just pressed. */
  function toggleAllRows(btn) {
    showAllRows = !showAllRows;
    const table = root.querySelector('#dash-compare-table');
    if (table) table.classList.toggle('dash-table-all', showAllRows);
    btn.setAttribute('aria-expanded', String(showAllRows));
    btn.textContent = showAllLabel(Number(btn.dataset.rows), Number(btn.dataset.below));
  }

  // ── 3. The chain ──────────────────────────────────────────────────────────

  function line(label, value, opts) {
    const o = opts || {};
    return (
      '<div class="dash-line' + (o.total ? ' dash-line-total' : '') + '">' +
      '<span class="dash-line-label">' + label + '</span>' +
      '<span class="dash-line-value' + (value === null ? ' is-empty' : '') + '">' +
      (value === null ? '—' : value) + '</span></div>'
    );
  }

  function chainMarkup(f) {
    const marginOk = Number.isFinite(parseFloat(f.margin)) && parseFloat(f.margin) >= 0;
    return (
      '<section class="dash-section" aria-labelledby="dash-chain-h">' +
      '<h2 class="dash-h" id="dash-chain-h">How the floor is built</h2>' +
      '<div class="dash-panels">' +

      '<div class="dash-panel">' +
      '<h3 class="dash-panel-h">' + link('overhead', 'Cost of the business') + '</h3>' +
      line(link('overhead', 'Operating costs'), fmt(f.operating)) +
      line(link('overhead', 'Replacement reserve', 'depreciation'), fmt(f.reserve)) +
      line('Annual business cost', fmt(f.businessCost), { total: true }) +
      '<p class="dash-panel-note">Running costs, plus what to set aside each year to replace your gear. ' +
      'Shown apart so a camera entered as both an expense and an asset stands out.</p>' +
      '</div>' +

      '<div class="dash-panel">' +
      '<h3 class="dash-panel-h">' + link('capacity', 'Capacity') + '</h3>' +
      line(link('capacity', 'Annual billable hours'), f.hours === null ? null : hrs(f.hours)) +
      line('Overhead cost per hour', f.rate === null ? null : fmt(f.rate)) +
      line(link('goals', 'Target profit margin'), marginOk ? esc(String(f.margin)) + '%' : null) +
      line('Hourly floor', f.perHour === null ? null : fmt(f.perHour), { total: true }) +
      '<p class="dash-panel-note">Business cost ÷ billable hours is what an hour must earn to break even; ' +
      'the margin goes on top.</p>' +
      '</div>' +

      '</div></section>'
    );
  }

  // ── 4. Targets ────────────────────────────────────────────────────────────

  function targetReason(f) {
    if (!(f.businessCost > 0)) return 'Add what the business costs to run on ' + link('overhead', 'Overhead') + '.';
    const net = parseFloat(f.goals.desiredNetIncome);
    if (!Number.isFinite(net) || net < 0) return 'Set a desired net income on ' + link('goals', 'Profit Goals') + '.';
    return 'Set a tax reserve below 100% on ' + link('goals', 'Profit Goals') + '.';
  }

  function targetsMarkup(f) {
    const t = f.target;
    return (
      '<section class="dash-section dash-targets" aria-labelledby="dash-targets-h">' +
      '<div class="dash-panel">' +
      '<h2 class="dash-panel-h" id="dash-targets-h">' + link('goals', 'Target annual revenue') + '</h2>' +
      '<div class="dash-big' + (t === null ? ' is-empty' : '') + '">' + (t === null ? '—' : fmt(t)) + '</div>' +
      (t === null
        ? '<p class="dash-panel-note">' + targetReason(f) + '</p>'
        : line('Per month, on average', fmt(t / 12)) +
          line('Per week, on average', fmt(t / 52)) +
          '<p class="dash-panel-note">Business cost plus your desired net income, grossed up for the tax reserve. ' +
          'Averages — real months won’t be even.</p>') +
      '</div>' +

      '<div class="dash-panel" id="dash-jobs">' + jobsMarkup(f, undefined) + '</div>' +
      '</section>'
    );
  }

  // ── 5. Jobs needed ────────────────────────────────────────────────────────

  /* avg: undefined while the estimates are loading, null when none qualify,
     false when they couldn't be loaded, else { average, count }. */
  function jobsMarkup(f, avg) {
    let value = null;
    let note;
    if (avg === undefined) {
      note = 'Working out your average job…';
    } else if (avg === false) {
      note = 'Couldn’t load your estimates to average. Reload once the server is back.';
    } else if (avg === null) {
      note =
        'No approved, invoiced or paid jobs in the last 12 months to average, so there’s nothing to divide ' +
        'the target by yet.';
    } else if (f.target === null) {
      note = 'Needs a target annual revenue first. Your average job is ' + fmt(avg.average) + '.';
    } else {
      value = jobsNeededPerYear(f.target, avg.average);
      note =
        'At your average job of ' + fmt(avg.average) + ' ex-GST — ' + avg.count + ' job' +
        (avg.count === 1 ? '' : 's') + ' approved, invoiced or paid in the last 12 months. Rounded up.';
    }
    return (
      '<h2 class="dash-panel-h">Jobs needed per year</h2>' +
      '<div class="dash-big' + (value === null ? ' is-empty' : '') + '">' + (value === null ? '—' : hrs(value)) + '</div>' +
      '<p class="dash-panel-note">' + note + '</p>'
    );
  }

  async function loadJobs(f, id) {
    let avg;
    try {
      const reply = await LSCApi.get('/api/estimates');
      avg = averageJobValue(reply.estimates || [], LSCUtil.today());
    } catch (err) {
      if (err instanceof LSCApi.ApiError && err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      avg = false;
    }
    // Left, or re-mounted, while the request was in flight.
    const box = document.getElementById('dash-jobs');
    if (id !== mountId || !box) return;
    box.innerHTML = jobsMarkup(f, avg);
  }

  // ── 6. Post against capacity ──────────────────────────────────────────────

  const b = (text) => '<strong>' + text + '</strong>';
  const hrsOf = (n) => hrs(Math.abs(n)) + ' hr' + (Math.abs(n) === 1 ? '' : 's');

  /* The sentence for the current inputs. Rewritten on every keystroke inside
     an aria-live region, so it is announced as it changes — the same way
     Profit Goals announces its target revenue. */
  function postOutcome() {
    const goals = LSCData.goals();
    if (annualBillableHours(goals) === null) {
      return (
        '<p class="dash-post-sentence is-empty">—</p>' +
        '<p class="dash-panel-note">Set your ' + link('capacity', 'capacity') +
        ' to see how shooting and post fit into a month.</p>'
      );
    }
    const r = postRatioReadout(goals, post.shoot, post.ratio);
    if (r === null) {
      return (
        '<p class="dash-post-sentence is-empty">—</p>' +
        '<p class="dash-panel-note">Enter shoot days and edit days — each 0 or more.</p>'
      );
    }

    const days = parseFloat(post.shoot);
    const lead = 'At ' + b(hrs(days)) + ' shoot day' + (days === 1 ? '' : 's') + ' a month, ';
    const postPart = r.postHours === 0
      ? 'with no post, shooting takes ' + b(hrsOf(r.shootHours)) + ' — '
      : 'post takes ' + b(hrsOf(r.postHours)) + ' — ';
    let tail;
    let over = false;
    if (r.unsoldHours > 0) {
      tail = 'leaving ' + b(hrsOf(r.unsoldHours)) + ' of billable time unsold.';
    } else if (r.unsoldHours === 0) {
      tail = 'which fills the month exactly.';
    } else {
      over = true;
      // The excess is shooting AND post, so the sentence says "with shooting".
      tail = (r.postHours === 0 ? '' : 'with shooting, that’s ') + b(hrsOf(r.unsoldHours) + ' more than the month has') + '.';
    }
    const ceiling = parseFloat(post.ratio) === 0
      ? 'With no post, your capacity fits at most ' + b(hrs(r.maxShootDays)) + ' shoot days a month.'
      : 'At this ratio your capacity fits at most ' + b(hrs(r.maxShootDays)) + ' shoot days a month.';

    return (
      '<p class="dash-post-sentence' + (over ? ' is-over' : '') + '">' + lead + postPart + tail + '</p>' +
      '<p class="dash-post-detail">Shooting ' + hrs(r.shootHours) + ' + post ' + hrs(r.postHours) + ' of ' +
      hrs(r.monthlyHours) + ' billable hrs a month, on average.</p>' +
      '<p class="dash-post-detail">' + ceiling + '</p>'
    );
  }

  function postMarkup() {
    const dayHours = parseFloat(LSCData.goals().billableHoursPerDay);
    const dayText = Number.isFinite(dayHours) && dayHours > 0 ? hrs(dayHours) + ' hrs' : 'your Capacity day';
    return (
      '<section class="dash-section" aria-labelledby="dash-post-h">' +
      '<div class="dash-panel dash-post">' +
      '<h2 class="dash-panel-h" id="dash-post-h">Shooting and post against ' + link('capacity', 'capacity') + '</h2>' +
      '<div class="dash-post-inputs">' +
      '<div class="field"><label for="dash-post-shoot">Shoot days / month</label>' +
      '<input type="number" id="dash-post-shoot" min="0" step="1" inputmode="decimal" value="' + esc(post.shoot) + '"></div>' +
      '<div class="field"><label for="dash-post-ratio">Edit days per shoot day</label>' +
      '<input type="number" id="dash-post-ratio" min="0" step="0.5" inputmode="decimal" value="' + esc(post.ratio) + '"></div>' +
      '</div>' +
      '<div id="dash-post-out" aria-live="polite">' + postOutcome() + '</div>' +
      '<p class="dash-panel-note">A what-if — nothing here is saved, and it resets when you leave. A shoot day and ' +
      'an edit day are each ' + dayText + ', your Capacity day. Post can run from about one edit day per shoot ' +
      'day (a corporate interview) to three (a wedding), so nothing here caps how many shoot days you sell.</p>' +
      '</div></section>'
    );
  }

  function bindPost() {
    root.addEventListener('input', (event) => {
      const id = event.target.id;
      if (id !== 'dash-post-shoot' && id !== 'dash-post-ratio') return;
      post[id === 'dash-post-shoot' ? 'shoot' : 'ratio'] = event.target.value;
      const out = document.getElementById('dash-post-out');
      if (out) out.innerHTML = postOutcome();
    });
  }

  // ── 7. The GST mirror ─────────────────────────────────────────────────────

  /* The three GST fields as the settings object stores them, read the way
     calc.js reads them: registered and pricesIncludeGst strictly === true. */
  function gstFields(settings) {
    const gst = (settings && settings.gst) || {};
    return {
      registered: gst.registered === true,
      rateRaw: toPercent(gst.rate),
      pricesIncludeGst: gst.pricesIncludeGst === true,
    };
  }

  const gstDirty = () => JSON.stringify(gstForm) !== JSON.stringify(gstSaved);
  const gstOnScreen = () => Boolean(document.getElementById('dash-gst-save'));

  /* What the stored setting does today, in one sentence — the status line
     reads the SAVED values, not the half-edited form, so it never describes a
     configuration that isn't in force. */
  function gstStatus(g) {
    if (!g.registered) {
      return 'You’re not registered, so quotes and invoices carry no GST at all.';
    }
    return (
      'You’re registered at ' + esc(g.rateRaw) + '%. ' +
      (g.pricesIncludeGst
        ? 'Your rate card’s prices already include it, so GST is backed out of them and the client total stays the card’s price.'
        : 'Your rate card is ex-GST, so GST is added on top of the client price.')
    );
  }

  function gstInnerMarkup() {
    const off = !gstForm.registered;
    return (
      '<div class="dash-gst-copy">' +
      '<div class="sum-label" style="margin-bottom:4px">GST registration</div>' +
      '<p class="dash-gst-note">The same setting as <strong>Invoice Settings</strong> — change it here and it ' +
      'changes there. It decides whether quotes and invoices charge GST. ' +
      '<span id="dash-gst-status">' + gstStatus(gstSaved) + '</span></p>' +
      '<p class="dash-gst-note">Every figure on this page stays <strong>ex-GST</strong> either way: GST is ' +
      'collected for the ATO, not earned, so it is never part of a floor, a cost or a target.</p>' +
      '<p class="dash-gst-note">Registering changes the cost base of gear bought from then on — a GST credit you ' +
      'claim back comes off the asset’s cost. Gear already on the ' + link('overhead', 'depreciation register', 'depreciation') +
      ' keeps its own “GST credit claimed” tick, because that was settled when you bought it.</p>' +
      '</div>' +
      '<div class="dash-gst-ctl">' +
      '<label class="set-check"><input type="checkbox" id="dash-gst-reg"' + (gstForm.registered ? ' checked' : '') +
      '><span>Registered for GST</span></label>' +
      '<div class="dash-gst-detail' + (off ? ' set-row-off' : '') + '" id="dash-gst-detail">' +
      '<label class="dash-gst-rate" for="dash-gst-rate">Rate (%)</label>' +
      '<input type="number" id="dash-gst-rate" min="0" max="100" step="0.5" value="' + esc(gstForm.rateRaw) + '"' +
      (off ? ' disabled' : '') + '>' +
      '<label class="set-check"><input type="checkbox" id="dash-gst-inc"' +
      (gstForm.pricesIncludeGst ? ' checked' : '') + (off ? ' disabled' : '') +
      '><span>Prices include GST</span></label>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="dash-gst-save" data-write>' +
      '<span class="spinner" id="dash-gst-spin"></span><span id="dash-gst-save-label">Save GST</span></button>' +
      '</div>'
    );
  }

  function gstMarkup() {
    return (
      '<section class="dash-section" aria-labelledby="dash-gst-h">' +
      '<h2 class="dash-h" id="dash-gst-h">GST</h2>' +
      '<div id="dash-gst-error" role="alert"></div>' +
      '<div class="tax-setting dash-gst" id="dash-gst">' + gstInnerMarkup() + '</div>' +
      '</section>'
    );
  }

  /* Rebuild the block's contents from gstForm/gstSaved — after a save, after a
     conflict, or when Invoice Settings changed the stored value. Only the
     block: the rest of the page doesn't depend on the form. */
  function redrawGst() {
    const box = document.getElementById('dash-gst');
    if (!box) return;
    box.innerHTML = gstInnerMarkup();
  }

  /* The one GST-aware part of sections 1–5: labourFloorComparison takes GST
     out of a GST-inclusive card's `mu` (priceExGst). Redrawn in place from the
     updated cache so it can't disagree with the setting shown below it. */
  function redrawComparison() {
    const section = root && root.querySelector('section[aria-labelledby="dash-compare-h"]');
    if (!section || !section.isConnected) return;
    const holder = document.createElement('div');
    holder.innerHTML = comparisonMarkup(figures());
    section.replaceWith(holder.firstElementChild);
  }

  function showGstError(message, withSettingsButton) {
    const el = document.getElementById('dash-gst-error');
    if (!el) return;
    el.textContent = message;
    /* The fix lives on another screen, so offer the way there — the same
       button estimate-detail.js puts beside its missing-ABN export error. */
    if (withSettingsButton) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-ghost btn-xs';
      open.textContent = 'Open Invoice Settings';
      open.addEventListener('click', () => SettingsView.open({ onAuthLost: handlers.onAuthLost }, open));
      el.append(' ', open);
    }
    el.classList.add('show');
  }

  function clearGstError() {
    const el = document.getElementById('dash-gst-error');
    if (el) LSCUtil.clearFieldErrors(el);
  }

  function setGstSaving(next) {
    gstSaving = next;
    if (!gstOnScreen()) return;
    document.getElementById('dash-gst-save').disabled = next;
    document.getElementById('dash-gst-spin').style.display = next ? 'inline-block' : 'none';
    document.getElementById('dash-gst-save-label').textContent = next ? 'Saving…' : 'Save GST';
  }

  async function saveGst() {
    if (gstSaving) return;
    clearGstError();

    /* Only while registered — calc.js ignores the rate otherwise, and so does
       the Invoice Settings modal's check, word for word. */
    const percent = parseFloat(gstForm.rateRaw);
    const usable = Number.isFinite(percent) && percent >= 0 && percent <= 100;
    if (gstForm.registered && !usable) {
      LSCUtil.showFieldErrors(document.getElementById('dash-gst-error'), [
        { msg: 'The GST rate must be a number between 0 and 100.', field: document.getElementById('dash-gst-rate') },
      ]);
      return;
    }

    setGstSaving(true);
    Toast.working('Saving GST…');

    try {
      /* Fresh, not LSCData's copy: this is the merge base for a whole-row
         write, and the modal's header explains why a stale one is dangerous. */
      const fresh = (await LSCApi.get('/api/settings')).settings || {};

      /* Changed somewhere else since this block loaded — don't overwrite it
         with a form built on the old value. */
      if (JSON.stringify(gstFields(fresh)) !== JSON.stringify(gstSaved)) {
        LSCData.setSettings(fresh);
        gstSaved = gstFields(fresh);
        gstForm = Object.assign({}, gstSaved);
        setGstSaving(false);
        Toast.hide();
        redrawGst();
        redrawComparison();
        showGstError(
          'GST was changed somewhere else since this page loaded — Invoice Settings, or another window — so ' +
            'nothing was saved. This now shows ' +
            'what’s stored — make your change again if you still want it.'
        );
        return;
      }

      // Registration without an ABN can't happen — every GST-bearing invoice
      // would then refuse to export. The modal refuses it too.
      if (gstForm.registered && !LSCUtil.abnDigits(fresh.business && fresh.business.abn)) {
        setGstSaving(false);
        Toast.hide();
        showGstError('GST registration needs your ABN — add it in Invoice Settings first.', true);
        return;
      }

      const body = Object.assign({}, fresh, {
        gst: Object.assign({}, fresh.gst, {
          registered: gstForm.registered,
          // An unusable rate only gets here while unregistered, where it's
          // inert: keep what's stored rather than invent one (settings.js).
          rate: usable ? percent / 100 : num(fresh.gst && fresh.gst.rate),
          pricesIncludeGst: gstForm.pricesIncludeGst,
        }),
      });
      const reply = await LSCApi.put('/api/settings', body);
      // From here on, every estimate is priced against this.
      LSCData.setSettings(reply.settings);
      gstSaved = gstFields(reply.settings);
      gstForm = Object.assign({}, gstSaved);
      Toast.ok('GST settings saved.');
      setGstSaving(false);
      if (!gstOnScreen()) return;
      redrawGst();
      redrawComparison();
      const btn = document.getElementById('dash-gst-save');
      if (btn) btn.focus();
    } catch (err) {
      setGstSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showGstError(
        err.kind === 'network'
          ? 'Couldn’t save — the server is unreachable. Your changes are still here; try again once it’s back.'
          : 'Couldn’t save: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  /* Delegated on root, because redrawGst() replaces the controls. Field edits
     write straight to the form with no redraw, so typing never loses focus;
     the registration toggle only enables or disables the two fields that mean
     nothing without it, as the modal does. */
  function bindGst() {
    root.addEventListener('input', (event) => {
      if (event.target.id === 'dash-gst-rate') gstForm.rateRaw = event.target.value;
    });
    root.addEventListener('change', (event) => {
      const t = event.target;
      if (t.id === 'dash-gst-inc') gstForm.pricesIncludeGst = t.checked;
      if (t.id === 'dash-gst-reg') {
        gstForm.registered = t.checked;
        document.getElementById('dash-gst-rate').disabled = !t.checked;
        document.getElementById('dash-gst-inc').disabled = !t.checked;
        document.getElementById('dash-gst-detail').classList.toggle('set-row-off', !t.checked);
      }
    });
    root.addEventListener('click', (event) => {
      if (event.target.closest('#dash-gst-save')) saveGst();
    });
  }

  /* Called by SettingsView after the Invoice Settings modal saves, which can
     happen with this screen open behind it. With no unsaved edits here the
     block (and the GST-aware comparison) simply follows the new setting. With
     edits, the block is left exactly as it is — including gstSaved, which is
     what saveGst()'s conflict check compares against: moving it forward here
     would let a form built on the old value overwrite the modal's change. */
  function refreshGst() {
    if (!gstOnScreen() || gstSaving) return;
    if (!gstDirty()) {
      gstSaved = gstFields(LSCData.settings());
      gstForm = Object.assign({}, gstSaved);
      redrawGst();
    }
    redrawComparison();
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  function markup(f) {
    return (
      '<div class="page-head"><div><h1 class="page-title">Dashboard</h1>' +
      '<div class="page-sub">What an hour, a half day and a full day must sell for — and whether your rate card does</div>' +
      '</div></div>' +
      floorsMarkup(f) +
      comparisonMarkup(f) +
      chainMarkup(f) +
      targetsMarkup(f) +
      postMarkup() +
      gstMarkup()
    );
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    mountId += 1;
    gstSaving = false;
    post = Object.assign({}, POST_DEFAULTS);
    showAllRows = false;
    gstSaved = gstFields(LSCData.settings());
    gstForm = Object.assign({}, gstSaved);

    const f = figures();
    root.innerHTML = markup(f);

    /* Delegated: the jobs panel is rewritten when the estimates arrive, and a
       listener on each button would be lost with it. */
    root.addEventListener('click', (event) => {
      const more = event.target.closest('.dash-show-all');
      if (more) return toggleAllRows(more);
      const btn = event.target.closest('[data-go-tab]');
      if (!btn || !handlers.onGoTab) return;
      const inner = btn.getAttribute('data-inner');
      handlers.onGoTab(btn.getAttribute('data-go-tab'), inner ? { inner } : undefined);
    });

    bindPost();
    bindGst();
    LSCUnsaved.watch('dashboard-gst', {
      label: 'the GST settings',
      onScreen: gstOnScreen,
      dirty: gstDirty,
    });

    loadJobs(f, mountId);
  }

  return { mount, refreshGst };
})();
