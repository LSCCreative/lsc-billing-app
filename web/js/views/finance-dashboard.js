'use strict';

/* The Finance & Price Dashboard — the whole cost-to-rate chain on one screen.
 *
 * WHAT IT ANSWERS
 * "Is my pricing right?" The least an hour, a half day and a full day can sell
 * for, whether each row on the rate card clears that, and the chain of numbers
 * the floors come from, each linked to the screen that owns it.
 *
 * READ-ONLY, AND IT OWNS NO NUMBER
 * Nothing here is stored and nothing here is editable, so there is no save and
 * no LSCUnsaved watcher. Every figure is derived on mount from the LSCData
 * cache (and, for jobs needed, the estimates list), through calc.js — the same
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
 *   5. jobs needed per year, beside the average job it was divided by.
 * Still to come, each its own task: the post-ratio readout (6) and the GST
 * mirror (7) go below these. The comparison's explanation lives in its info
 * control (js/info.js), beside the section heading, not in a note under it.
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
  const { esc, fmt } = LSCUtil;
  const {
    annualOverheadTotal,
    replacementReserveTotal,
    annualBillableHours,
    hourlyFloor,
    labourFloorComparison,
    targetAnnualRevenue,
    averageJobValue,
    jobsNeededPerYear,
    round2,
  } = LSCCalc;

  let root = null;
  let handlers = null;
  let mountId = 0; // guards the async estimates fetch against a re-mount

  const hrs = (n) => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });

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

    const body = rows
      .map(
        (r) =>
          '<tr' + (r.belowFloor ? ' class="dash-below"' : '') + '>' +
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
        ? '<table class="est-table dash-table"><thead><tr><th>Service</th><th>Section</th>' +
          '<th class="right">Hrs / unit</th><th class="right">You charge (ex-GST)</th>' +
          '<th class="right">Floor</th><th class="right">Against floor</th></tr></thead><tbody>' +
          body + '</tbody></table>'
        : '<p class="dash-empty">No labour services on the rate card yet. Add them on the ' +
          link('pricing', 'Rate Card') + '.</p>') +
      '</div>' +
      '</section>'
    );
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

  // ── Mount ─────────────────────────────────────────────────────────────────

  function markup(f) {
    return (
      '<div class="page-head"><div><h1 class="page-title">Dashboard</h1>' +
      '<div class="page-sub">What an hour, a half day and a full day must sell for — and whether your rate card does</div>' +
      '</div></div>' +
      floorsMarkup(f) +
      comparisonMarkup(f) +
      chainMarkup(f) +
      targetsMarkup(f)
    );
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    mountId += 1;

    const f = figures();
    root.innerHTML = markup(f);

    /* Delegated: the jobs panel is rewritten when the estimates arrive, and a
       listener on each button would be lost with it. */
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-go-tab]');
      if (!btn || !handlers.onGoTab) return;
      const inner = btn.getAttribute('data-inner');
      handlers.onGoTab(btn.getAttribute('data-go-tab'), inner ? { inner } : undefined);
    });

    loadJobs(f, mountId);
  }

  return { mount };
})();
