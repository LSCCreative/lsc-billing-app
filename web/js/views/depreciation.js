'use strict';

/* Overhead → Depreciation: the capital-asset register.
 *
 * Not to be confused with web/js/depreciation.js (LSCDepreciation), which is
 * the ATO arithmetic. This is the screen; that is the maths it reads.
 *
 * ONE TABLE, TWO NUMBERS
 * Every asset feeds two figures that are meant to differ (brief decision 4):
 *   - the REPLACEMENT RESERVE — straight-line over the user's own replacement
 *     cycle, at the estimated cost of the NEXT one, apportioned by business use.
 *     This is in annualBusinessCost(), so it is in every rate on the card.
 *   - the TAX DEDUCTION — the ATO decline in value for this financial year,
 *     for the accountant. It is in no rate: diminishing value would swing the
 *     day rate 30–40% a year for gear still in daily use.
 * The two sit side by side at the top of the tab so the difference is the first
 * thing read, not a surprise found later. (The explanatory info button between
 * them is its own task.)
 *
 * MOUNTED BY OverheadView, NOT THE ROUTER
 * Overhead owns the page head and the inner-tab row; this module renders the
 * Depreciation tab's content into the container Overhead hands it and exposes
 * openAdd() for Overhead's page-head button. It has its own modal overlay
 * (#modal-depreciation-asset) and uses the app's one focus trap, LSCModal.
 *
 * EDIT MUST CARRY THE DISPOSAL FIELDS THROUGH
 * PUT /api/depreciation-assets/:id writes every column, and a disposal date
 * that isn't sent is written as NULL — "still held". This modal doesn't edit
 * disposal (that is the Disposal flow's own task), so an edit that sent only
 * the fields on screen would silently un-dispose a sold asset: it would rejoin
 * the replacement reserve, raise every rate, and drop its balancing adjustment
 * from the disposal year. body() copies them from the stored asset.
 *
 * ATO FIGURES ARE THE USER'S TO ENTER
 * Effective lives and the write-off threshold move with the federal budget, so
 * neither is hardcoded (brief decision; HANDOVER "Open seams"). Placeholders
 * show a typical figure and every one says to confirm with the accountant.
 *
 * THE SCHEDULE IS THE SERVER'S ANSWER, NOT A LOCAL ONE
 * The summary card above computes this year's deduction in the browser from
 * the same LSCDepreciation the server runs, which is fine for one headline
 * figure. The schedule is fetched from GET /api/depreciation-schedule instead,
 * because that route is where a lodged year's frozen figures and the
 * "diverges" flag come from (the lodgement lock is the next task) — rendering a
 * local recompute here would have to be torn out the moment a year is locked.
 * One reply is cached per selected FY and dropped on every asset write, so
 * ticking "Show disposed" doesn't refetch but adding an asset does.
 *
 * ATO VOCABULARY IN EVERY COLUMN
 * "Decline in value", "adjustable value", "disposal" — the IA doc's glossary.
 * Not "depreciation", "book value" or "sale": this table sits one scroll below
 * the replacement reserve, and the words are what keep the two numbers apart.
 */

const DepreciationView = (() => {
  const { esc, fmt, num } = LSCUtil;
  const { replacementReserveTotal, currentFinancialYear, fyDisplay, fyLabel, fyBounds } = LSCCalc;

  /* value: the spelling migration v5's CHECK accepts. label: what a person
     reads. Kept apart for the reason overhead.js gives for its own lists. */
  const CATEGORIES = [
    { value: 'camera', label: 'Camera' },
    { value: 'lens', label: 'Lens' },
    { value: 'lighting', label: 'Lighting' },
    { value: 'audio', label: 'Audio' },
    { value: 'computer', label: 'Computer' },
    { value: 'drone', label: 'Drone' },
    { value: 'vehicle', label: 'Vehicle' },
    { value: 'other', label: 'Other' },
  ];
  const METHODS = [
    { value: 'diminishing_value', label: 'Diminishing value' },
    { value: 'prime_cost', label: 'Prime cost' },
    { value: 'instant_writeoff', label: 'Instant asset write-off' },
    { value: 'small_business_pool', label: 'Small business pool' },
    { value: 'low_value_pool', label: 'Low-value pool' },
  ];
  // The two methods whose decline is computed from an effective life.
  const NEEDS_LIFE = { diminishing_value: 1, prime_cost: 1 };

  /* Placeholders only — typical ATO effective lives for the categories where
     one figure is common enough to be a useful hint. Never a default value:
     the user types their own, and the field hint says to confirm it. */
  const LIFE_HINT = { camera: '3', computer: '2', drone: '3', vehicle: '8' };

  const labelOf = (list, value) => {
    const found = list.find((entry) => entry.value === value);
    return found ? found.label : String(value || '—');
  };

  let root = null;
  let handlers = null;
  let overlay = null;
  let showDisposed = false;

  // Modal state, live only while it is open.
  let form = null;
  let editing = null; // the stored asset being edited; null = adding
  let saving = false;
  let baseline = '';
  let opener = null;

  // The write-off threshold field, as typed.
  let iawoRaw = '';
  let iawoSaved = '';
  let iawoSaving = false;

  // The schedule: which FY is selected, and the server's reply for it.
  let selectedFy = null;
  let sched = null; // { fy, reply } — dropped by refreshCache() on any asset write
  let schedError = null;
  let schedLoadingFy = null;
  let schedSeq = 0; // a reply for an FY the user has since moved off is ignored
  let announcePending = false; // set by the FY <select>, spent by renderScheduleBody

  const $ = (id) => root.querySelector('#' + id);
  const $m = (id) => overlay.querySelector('#' + id);
  const assets = () => LSCData.depreciationAssets();
  const isDisposed = (a) => Boolean(a.disposalDate);

  const failureText = (err, action) =>
    err.kind === 'network'
      ? 'Couldn’t ' + action + ' — the server is unreachable.'
      : 'Couldn’t ' + action + ': ' + (err.message || 'the server refused the request.');

  /* Asked of the document: see overhead.js's onScreen() for why a detached
     root must not be allowed to answer. */
  const onScreen = () => Boolean(document.getElementById('dep-register'));

  const toField = (v) => (v === null || v === undefined ? '' : String(v));

  // ── The two numbers ───────────────────────────────────────────────────────

  function summaryMarkup() {
    const list = assets();
    const fy = currentFinancialYear();
    const schedule = LSCDepreciation.financialYearSchedule(list, fy);
    const deduction = schedule ? schedule.totalDeductible : null;
    return (
      '<div class="proj-card oh-summary dep-summary">' +
      '<div class="oh-stat"><div class="sum-label">Replacement reserve / year</div>' +
      '<div class="oh-stat-value">' + fmt(replacementReserveTotal(list)) + '</div>' +
      '<div class="dep-stat-sub">In every rate on your card</div></div>' +
      '<div class="oh-stat"><div class="sum-label">Tax deduction, ' + esc(fyDisplay(fy)) + '</div>' +
      '<div class="oh-stat-value">' + (deduction === null ? '—' : fmt(deduction)) + '</div>' +
      '<div class="dep-stat-sub">For your accountant — in no rate</div></div>' +
      '</div>' +
      '<p class="oh-note">Two numbers from the same gear, on purpose. The replacement reserve spreads the cost ' +
      'of your <em>next</em> camera evenly over how long you keep one, so your rates stay steady. The tax ' +
      'deduction is the ATO’s decline in value for this financial year, which can front-load heavily — useful ' +
      'at tax time, wrong for pricing.</p>'
    );
  }

  // ── The register ──────────────────────────────────────────────────────────

  function reserveOf(asset) {
    const r = replacementReserveTotal([asset]);
    return r > 0 ? fmt(r) : '—';
  }

  function registerMarkup() {
    const all = assets();
    const disposedCount = all.filter(isDisposed).length;
    const list = showDisposed ? all : all.filter((a) => !isDisposed(a));
    const held = all.length - disposedCount;

    const head =
      '<div class="est-block-head"><h2 class="est-block-label">Assets</h2>' +
      '<span class="est-block-sum" style="color:var(--muted)">' +
      held + ' held' + (disposedCount ? ' · ' + disposedCount + ' disposed' : '') + '</span></div>';

    const filter = disposedCount
      ? '<label class="dep-filter"><input type="checkbox" id="dep-show-disposed"' +
        (showDisposed ? ' checked' : '') + '> Show disposed (' + disposedCount + ')</label>'
      : '';

    if (!list.length) {
      return (
        filter +
        '<div class="est-block" id="dep-register">' + head +
        '<p class="oh-empty">' +
        (all.length
          ? 'Everything here has been disposed of. Tick “Show disposed” to see it.'
          : 'No assets yet. Capital purchases — cameras, lenses, lights, computers, a car — belong here, ' +
            'where they’re spread over the years you use them. Running costs like software and insurance ' +
            'belong in Operating Costs.') +
        '</p></div>'
      );
    }

    /* data-label on every cell: below 768px responsive.css stacks .est-table
       rows and prints these as headings. A column without one loses its label. */
    const rows = list
      .map(
        (a) =>
          '<tr data-id="' + esc(a.id) + '"' + (isDisposed(a) ? ' class="dep-disposed"' : '') + '>' +
          '<td data-label="Asset">' + esc(a.name || 'Untitled') +
          (isDisposed(a) ? ' <span class="dep-tag">Disposed ' + esc(a.disposalDate) + '</span>' : '') + '</td>' +
          '<td class="muted-td" data-label="Category">' + esc(labelOf(CATEGORIES, a.category)) + '</td>' +
          '<td class="muted-td" data-label="Start date">' + esc(a.startDate || '—') + '</td>' +
          '<td class="right" data-label="Cost (inc GST)">' + fmt(a.costIncGst) + '</td>' +
          '<td class="muted-td" data-label="Method">' + esc(labelOf(METHODS, a.method)) + '</td>' +
          '<td class="right" data-label="Business use">' + esc(String(num(a.businessUsePct))) + '%</td>' +
          '<td class="right" data-label="Replacement reserve / yr">' + reserveOf(a) + '</td>' +
          '<td class="oh-act" data-label="">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-dep-edit="' + esc(a.id) + '"' +
          ' aria-label="Edit ' + esc(a.name || 'this asset') + '">Edit</button>' +
          '<button type="button" class="del-btn" data-dep-del="' + esc(a.id) + '"' +
          ' title="Delete this asset" aria-label="Delete ' + esc(a.name || 'this asset') + '">×</button>' +
          '</td></tr>'
      )
      .join('');

    return (
      filter +
      '<div class="est-block" id="dep-register">' + head +
      '<div class="dep-scroll"><table class="est-table oh-table dep-table"><thead><tr><th>Asset</th><th>Category</th>' +
      '<th>Start date</th><th class="right">Cost (inc GST)</th><th>Method</th>' +
      '<th class="right">Business use</th><th class="right">Replacement reserve / yr</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>'
    );
  }

  /* The instant asset write-off threshold. Stored on goals (iawo_threshold,
     nullable on purpose — migration v5), owned by this screen per the IA
     doc's read/write map, and read by the Operating Costs double-count hint.
     Its own small save: it is one number and doesn't belong to any asset. */
  function thresholdMarkup() {
    return (
      '<div class="tax-setting dep-iawo"><div>' +
      '<div class="sum-label" style="margin-bottom:4px">Instant asset write-off threshold ($)</div>' +
      '<div style="color:var(--muted);font-size:11px">The per-asset limit for writing gear off in the year you ' +
      'buy it. It changes with the federal budget, so it isn’t built in — confirm the current figure with ' +
      'your accountant. Used to flag large one-off expenses that may belong here instead.</div></div>' +
      '<div class="dep-iawo-ctl"><input type="number" id="dep-iawo" min="0" step="1" placeholder="e.g. 20000"' +
      ' value="' + esc(iawoRaw) + '" aria-label="Instant asset write-off threshold, dollars">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="dep-iawo-save" data-write>Save</button></div></div>'
    );
  }

  // ── The schedule ──────────────────────────────────────────────────────────

  const startYearOf = (label) => fyBounds(label).startYear;

  /* Every FY an asset touched, newest first: from the earliest start date to
     the latest of this FY, any start date, any disposal date. Always includes
     the current FY, so the default is always an option. A year inside the
     range with nothing held renders the empty state rather than being skipped
     — a gap is a fact about the business, not a hole in the list. */
  function fyOptions() {
    const current = startYearOf(currentFinancialYear());
    let lo = current;
    let hi = current;
    assets().forEach((a) => {
      [a.startDate, a.disposalDate].forEach((d) => {
        const label = d ? fyLabel(d) : null;
        if (!label) return;
        lo = Math.min(lo, startYearOf(label));
        hi = Math.max(hi, startYearOf(label));
      });
    });
    const out = [];
    for (let y = hi; y >= lo; y -= 1) out.push(fyLabel(y + '-07-01'));
    return out;
  }

  /* fmt() prints a negative as "$-5.00". A balancing adjustment is signed on
     purpose — positive is assessable income, negative a deduction — so it gets
     a real minus sign and, where it's read, the word as well. */
  const signedFmt = (n) => (n < 0 ? '−' + fmt(-n) : fmt(n));

  function balancingText(amount) {
    if (amount === null || amount === undefined) return '—';
    if (amount === 0) return fmt(0);
    /* One wrapping span: below 768px a stacked .est-table cell is a flex row
       (label, value), and a bare amount beside its tag would be three items. */
    return (
      '<span>' + signedFmt(amount) + ' <span class="dep-bal-kind">' +
      (amount > 0 ? 'assessable' : 'deduction') + '</span></span>'
    );
  }

  /* The rail leaves #finance-sub about 550px between 768px and 1099px, and
     these are the widest tables in the app (the register needs ~760px), so
     .est-block's overflow:hidden was clipping the register's Edit and delete
     buttons out of reach. Each table scrolls inside its block instead, with the
     block head left still. A read-only table has nothing else to focus, so its
     scroller takes a tab stop and a name — otherwise a keyboard can't scroll it. */
  const scrollOpen = (label) =>
    '<div class="dep-scroll" tabindex="0" role="region" aria-label="' + esc(label) + ' schedule">';

  const POOL_LABEL = { small_business_pool: 'Small business pool', low_value_pool: 'Low-value pool' };

  function assetRowsMarkup(rows, byId) {
    let decline = 0;
    let deductible = 0;
    const body = rows
      .map((r) => {
        decline += r.decline;
        deductible += r.deductible;
        const asset = byId.get(r.assetId);
        const use = asset ? num(asset.businessUsePct) + '%' : '—';
        return (
          '<tr>' +
          '<td data-label="Asset">' + esc(r.name || 'Untitled') +
          (r.disposed ? ' <span class="dep-tag">Disposed</span>' : '') + '</td>' +
          '<td class="right muted-td" data-label="Days held">' + esc(String(r.daysHeld)) + '</td>' +
          '<td class="right" data-label="Opening adjustable value">' + fmt(r.openingAdjustableValue) + '</td>' +
          '<td class="right" data-label="Decline in value">' + fmt(r.decline) + '</td>' +
          '<td class="right muted-td" data-label="Business use">' + esc(use) + '</td>' +
          '<td class="right dep-strong" data-label="Deductible">' + fmt(r.deductible) + '</td>' +
          '<td class="right" data-label="Closing adjustable value">' + fmt(r.closingAdjustableValue) + '</td>' +
          '</tr>'
        );
      })
      .join('');
    /* A body row, not <tfoot>: responsive.css stacks .est-table's rows below
       768px and has no rule for a footer group, so a <tfoot> would fall out of
       the card layout. round2 on the sums because each row is already rounded
       to cents and adding floats can still land on …0.0000001. */
    const total =
      '<tr class="dep-total-row">' +
      '<td data-label="">Individual assets</td><td class="dep-blank"></td><td class="dep-blank"></td>' +
      '<td class="right" data-label="Decline in value">' + fmt(LSCCalc.round2(decline)) + '</td>' +
      '<td class="dep-blank"></td>' +
      '<td class="right" data-label="Deductible">' + fmt(LSCCalc.round2(deductible)) + '</td>' +
      '<td class="dep-blank"></td></tr>';
    return (
      '<div class="est-block"><div class="est-block-head"><h3 class="est-block-label">Individual assets</h3>' +
      '<span class="est-block-sum" style="color:var(--muted)">' + rows.length + '</span></div>' +
      scrollOpen('Individual assets') + '<table class="est-table dep-sched-table"><thead><tr><th>Asset</th><th class="right">Days held</th>' +
      '<th class="right">Opening adjustable value</th><th class="right">Decline in value</th>' +
      '<th class="right">Business use</th><th class="right">Deductible</th>' +
      '<th class="right">Closing adjustable value</th></tr></thead><tbody>' + body + (rows.length > 1 ? total : '') +
      '</tbody></table></div></div>'
    );
  }

  /* Pools are pool-level, not asset-level (IA doc, arithmetic step 6): a pooled
     asset has no decline figure of its own, so pretending otherwise per row
     would be a number the ATO never computes. What IS useful beside the pool
     balance is which gear went into it this year — the additions figure is
     otherwise a sum nobody can reconcile. */
  function poolRowsMarkup(rows, fy) {
    const body = rows
      .map((r) => {
        const added = assets()
          .filter((a) => a.method === r.pool && a.startDate && fyLabel(a.startDate) === fy)
          .map((a) => esc(a.name || 'Untitled'));
        return (
          '<tr>' +
          '<td data-label="Pool">' + esc(POOL_LABEL[r.pool] || r.pool) +
          (added.length ? '<div class="dep-pool-added">Added this year: ' + added.join(', ') + '</div>' : '') + '</td>' +
          '<td class="right" data-label="Opening pool balance">' + fmt(r.openingBalance) + '</td>' +
          '<td class="right" data-label="Additions (business share)">' + fmt(r.additions) + '</td>' +
          '<td class="right dep-strong" data-label="Decline in value (deductible)">' + fmt(r.decline) + '</td>' +
          '<td class="right" data-label="Disposal proceeds">' + (r.disposalProceeds ? fmt(r.disposalProceeds) : '—') + '</td>' +
          '<td class="right" data-label="Closing pool balance">' + fmt(r.closingBalance) + '</td>' +
          '</tr>'
        );
      })
      .join('');
    return (
      '<div class="est-block"><div class="est-block-head"><h3 class="est-block-label">Pools</h3>' +
      '<span class="est-block-sum" style="color:var(--muted)">' + rows.length + '</span></div>' +
      scrollOpen('Pools') + '<table class="est-table dep-sched-table"><thead><tr><th>Pool</th><th class="right">Opening pool balance</th>' +
      '<th class="right">Additions (business share)</th><th class="right">Decline in value (deductible)</th>' +
      '<th class="right">Disposal proceeds</th><th class="right">Closing pool balance</th></tr></thead><tbody>' +
      body + '</tbody></table></div>' +
      '<p class="dep-sched-note">A pool’s whole decline in value is deductible: business use was applied when each ' +
      'asset was added, so it isn’t applied again. Gear disposed of from a pool comes off the balance and has no ' +
      'balancing adjustment of its own.</p></div>'
    );
  }

  /* Balancing adjustments for assets disposed of in this FY. Their own block,
     not a column on the asset table: most years it would be a column of dashes,
     and it is a different line on the return from the decline in value. The
     date and proceeds come from the asset itself — the schedule row carries the
     adjustment, not its inputs, and an accountant checks the inputs. */
  function disposalRowsMarkup(rows, byId) {
    const body = rows
      .map((r) => {
        const asset = byId.get(r.assetId) || {};
        const proceeds = asset.disposalProceeds;
        return (
          '<tr>' +
          '<td data-label="Asset">' + esc(r.name || 'Untitled') + '</td>' +
          '<td class="muted-td" data-label="Disposal date">' + esc(asset.disposalDate || '—') + '</td>' +
          '<td class="right" data-label="Disposal proceeds">' +
          (proceeds === null || proceeds === undefined ? fmt(0) : fmt(proceeds)) + '</td>' +
          '<td class="right" data-label="Adjustable value at disposal">' + fmt(r.closingAdjustableValue) + '</td>' +
          '<td class="right muted-td" data-label="Business use">' +
          (asset.businessUsePct === undefined ? '—' : esc(num(asset.businessUsePct) + '%')) + '</td>' +
          '<td class="right dep-strong" data-label="Balancing adjustment">' + balancingText(r.balancingAdjustment) + '</td>' +
          '</tr>'
        );
      })
      .join('');
    return (
      '<div class="est-block"><div class="est-block-head"><h3 class="est-block-label">Disposals</h3>' +
      '<span class="est-block-sum" style="color:var(--muted)">' + rows.length + '</span></div>' +
      scrollOpen('Disposals') + '<table class="est-table dep-sched-table"><thead><tr><th>Asset</th><th>Disposal date</th>' +
      '<th class="right">Disposal proceeds</th><th class="right">Adjustable value at disposal</th>' +
      '<th class="right">Business use</th><th class="right">Balancing adjustment</th></tr></thead><tbody>' +
      body + '</tbody></table></div>' +
      '<p class="dep-sched-note">(Proceeds − adjustable value) × business use. Positive is assessable income; ' +
      'negative is a further deduction. It belongs to the year of disposal.</p></div>'
    );
  }

  function scheduleBodyMarkup() {
    const fy = selectedFy;
    const shown = esc(fyDisplay(fy));
    if (schedError) {
      return (
        '<div class="dep-sched-state" role="alert"><p>' + esc(schedError) + '</p>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="dep-sched-retry">Try again</button></div>'
      );
    }
    if (!sched || sched.fy !== fy) {
      return '<p class="dep-sched-state" aria-busy="true">Working out ' + shown + '…</p>';
    }

    /* The live recompute, even for a lodged year — on purpose, until the
       lodgement-lock task renders reply.lockedFigures with its badge and the
       `diverges` flag. Showing frozen figures without the badge that says so
       would be worse than showing live ones. */
    const schedule = sched.reply.schedule;
    const assetRows = schedule.assets || [];
    const poolRows = schedule.pools || [];
    if (!assetRows.length && !poolRows.length) {
      return (
        '<p class="dep-sched-state">Nothing was held in ' + shown + ', so there’s no decline in value to claim ' +
        'for it. An asset joins the schedule from the financial year of its start date and leaves after the year ' +
        'it’s disposed of.</p>'
      );
    }

    const byId = new Map(assets().map((a) => [a.id, a]));
    const disposed = assetRows.filter((r) => r.disposed);
    const bal = schedule.totalBalancingAdjustment;

    return (
      '<div class="dep-sched-totals">' +
      '<div class="dep-sched-total"><div class="sum-label">Deductible decline in value</div>' +
      '<div class="dep-sched-figure">' + fmt(schedule.totalDeductible) + '</div>' +
      '<div class="dep-stat-sub">Individual assets and pools, ' + shown + '</div></div>' +
      '<div class="dep-sched-total"><div class="sum-label">Balancing adjustments</div>' +
      (disposed.length
        ? '<div class="dep-sched-figure">' + signedFmt(bal) + '</div>' +
          '<div class="dep-stat-sub">' + (bal > 0 ? 'Net assessable income' : bal < 0 ? 'Net further deduction' : 'Nets to nil') +
          ' — a separate line from the decline</div>'
        : '<div class="dep-sched-figure is-empty">—</div><div class="dep-stat-sub">Nothing disposed of this year</div>') +
      '</div></div>' +
      (assetRows.length ? assetRowsMarkup(assetRows, byId) : '') +
      (poolRows.length ? poolRowsMarkup(poolRows, fy) : '') +
      (disposed.length ? disposalRowsMarkup(disposed, byId) : '') +
      '<p class="dep-sched-note dep-sched-foot">Adjustable value falls by the whole decline in value; only the ' +
      'business-use share of it is deductible. Days are counted from each asset’s start date and divided by 365, ' +
      'leap year or not — the ATO’s formula. Figures are to the cent; round on the return, not before.</p>'
    );
  }

  function scheduleMarkup() {
    if (!assets().length) {
      return (
        '<section class="dep-sched" aria-labelledby="dep-sched-h"><div class="dep-sched-head">' +
        '<h2 class="dep-sched-h" id="dep-sched-h">Depreciation schedule</h2></div>' +
        '<p class="dep-sched-state">No assets yet, so there’s no schedule. Once you add one, its decline in value ' +
        'for each financial year appears here, ready for your accountant.</p></section>'
      );
    }
    const options = fyOptions()
      .map((label) =>
        '<option value="' + esc(label) + '"' + (label === selectedFy ? ' selected' : '') + '>' +
        esc(fyDisplay(label)) + (label === currentFinancialYear() ? ' (this year)' : '') + '</option>')
      .join('');
    return (
      '<section class="dep-sched" aria-labelledby="dep-sched-h"><div class="dep-sched-head">' +
      '<h2 class="dep-sched-h" id="dep-sched-h">Depreciation schedule</h2>' +
      '<label class="dep-fy"><span class="sum-label">Financial year</span>' +
      '<select id="dep-fy" class="doc-type-select">' + options + '</select></label></div>' +
      '<p class="dep-live" id="dep-sched-status" aria-live="polite"></p>' +
      '<div id="dep-sched-body">' + scheduleBodyMarkup() + '</div></section>'
    );
  }

  /* Fetch the selected FY unless its reply is cached, already on its way, or
     the last attempt failed (the Try again button clears that). */
  async function ensureSchedule() {
    if (!assets().length || schedError) return;
    if ((sched && sched.fy === selectedFy) || schedLoadingFy === selectedFy) return;
    const fy = selectedFy;
    const seq = ++schedSeq;
    schedLoadingFy = fy;
    try {
      const reply = await LSCApi.get('/api/depreciation-schedule?fy=' + encodeURIComponent(fy));
      if (seq !== schedSeq) return;
      sched = { fy, reply };
    } catch (err) {
      if (seq !== schedSeq) return;
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      schedError = failureText(err, 'load the ' + fyDisplay(fy) + ' schedule');
    } finally {
      if (seq === schedSeq) schedLoadingFy = null;
    }
    renderScheduleBody();
  }

  /* Only the body under the selector, so changing the year keeps focus on the
     <select> the user is operating. When the user changed the year, say what
     arrived, once, in the visually hidden live region — the tables themselves
     aren't live, or a screen reader would read every cell on each change, and
     nothing is announced on first load, which nobody asked for. */
  function renderScheduleBody() {
    const el = document.getElementById('dep-sched-body');
    if (!el || !root.contains(el)) return;
    el.innerHTML = scheduleBodyMarkup();
    const retry = $('dep-sched-retry');
    if (retry) {
      retry.addEventListener('click', () => {
        schedError = null;
        renderScheduleBody();
      });
    }
    const status = $('dep-sched-status');
    if (announcePending && status && sched && sched.fy === selectedFy) {
      announcePending = false;
      const s = sched.reply.schedule;
      const count = (s.assets || []).length + (s.pools || []).length;
      status.textContent =
        fyDisplay(selectedFy) + ': ' +
        (count ? fmt(s.totalDeductible) + ' deductible across ' + count + (count === 1 ? ' line.' : ' lines.') : 'nothing held.');
    }
    ensureSchedule();
  }

  function markup() {
    return (
      summaryMarkup() +
      '<div id="dep-error" role="alert"></div>' +
      registerMarkup() +
      scheduleMarkup() +
      thresholdMarkup()
    );
  }

  // ── Errors, cache ─────────────────────────────────────────────────────────

  function showError(message) {
    const el = $('dep-error');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    LSCUtil.clearFieldErrors($('dep-error'));
  }

  /* Assets and snapshots together: every asset write appends an overhead
     snapshot server-side (the reserve is part of the annual business cost),
     and the trend chart one tab over reads that list. One update, not two. */
  async function refreshCache() {
    const [assetsReply, snapshotsReply] = await Promise.all([
      LSCApi.get('/api/depreciation-assets'),
      LSCApi.get('/api/overhead-snapshots'),
    ]);
    LSCData.setDepreciationAssets(assetsReply.assets || []);
    LSCData.setOverheadSnapshots(snapshotsReply.snapshots || []);
    dropSchedule();
  }

  /* Any asset write can change any year's figures, so the cached reply goes,
     and so does a request still in flight — it was computed before the write. */
  function dropSchedule() {
    sched = null;
    schedError = null;
    schedLoadingFy = null;
    schedSeq += 1;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function remove(id) {
    const asset = assets().find((a) => a.id === id);
    if (!asset) return;
    const reserve = replacementReserveTotal([asset]);
    if (
      !window.confirm(
        'Delete “' + (asset.name || 'this asset') + '”?\n\n' +
          (reserve > 0
            ? 'Your replacement reserve drops by ' + fmt(reserve) + ' a year, which changes every rate on your card. '
            : '') +
          'It also leaves every depreciation schedule, including past years. If you sold or scrapped it, ' +
          'record a disposal instead so that year’s tax figures stay right.'
      )
    ) return;

    clearError();
    Toast.working('Deleting…');
    try {
      await LSCApi.del('/api/depreciation-assets/' + encodeURIComponent(id));
      await refreshCache();
      Toast.ok('Asset deleted.');
      if (onScreen()) render();
    } catch (err) {
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(failureText(err, 'delete that asset'));
    }
  }

  // ── The threshold ─────────────────────────────────────────────────────────

  async function saveThreshold() {
    if (iawoSaving) return;
    clearError();
    const raw = String(iawoRaw).trim();
    const value = raw === '' ? null : parseFloat(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      LSCUtil.showFieldErrors($('dep-error'), [
        { msg: 'The write-off threshold must be a dollar amount, 0 or more — or blank if you haven’t confirmed one.', field: $('dep-iawo') },
      ]);
      return;
    }
    iawoSaving = true;
    Toast.working('Saving threshold…');
    try {
      /* Only this field. The goals route resolves every field it isn't sent
         to what is already stored (routes/goals.js), so income, margin and
         capacity are untouched. */
      const reply = await LSCApi.put('/api/goals', { iawoThreshold: value });
      LSCData.setGoals(reply.goals);
      iawoSaved = toField(reply.goals.iawoThreshold);
      iawoRaw = iawoSaved;
      Toast.ok(value === null ? 'Threshold cleared.' : 'Threshold saved.');
    } catch (err) {
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(failureText(err, 'save the threshold'));
    } finally {
      iawoSaving = false;
    }
  }

  // ── The Add / Edit modal ──────────────────────────────────────────────────

  const snapshot = () => JSON.stringify(form);

  function optionsMarkup(list, selected) {
    return list
      .map(
        (e) => '<option value="' + esc(e.value) + '"' + (e.value === selected ? ' selected' : '') + '>' +
          esc(e.label) + '</option>'
      )
      .join('');
  }

  function field(id, label, input, hint, full) {
    return (
      '<div class="field' + (full ? ' full' : '') + '"><label for="' + id + '">' + label + '</label>' + input +
      (hint ? '<p class="oh-hint" id="' + id + '-hint">' + hint + '</p>' : '') + '</div>'
    );
  }

  function inputHtml(id, type, key, attrs, hasHint) {
    return (
      '<input id="' + id + '" type="' + type + '" data-key="' + key + '" value="' + esc(form[key]) + '"' +
      (hasHint ? ' aria-describedby="' + id + '-hint"' : '') + ' ' + (attrs || '') + '>'
    );
  }

  /* What the GST block says depends on Invoice Settings' current registration
     — stated, not enforced: an asset bought while registered keeps its credit
     after deregistering, which is exactly why the flag is per asset. */
  function gstNote() {
    const registered = (LSCData.settings().gst || {}).registered === true;
    return registered
      ? 'You’re registered for GST (Invoice Settings). If you claimed the GST on this purchase back, tick the ' +
          'box and the cost base is the price less the GST.'
      : 'You’re not registered for GST (Invoice Settings), so you normally can’t claim it back — leave the box ' +
          'unticked and the full GST-inclusive price is the cost base. Tick it only if you were registered when ' +
          'you bought it and claimed the credit.';
  }

  function modalMarkup() {
    const needsLife = Boolean(NEEDS_LIFE[form.method]);
    const lifePlaceholder = LIFE_HINT[form.category] ? 'e.g. ' + LIFE_HINT[form.category] : 'years';
    return (
      '<div class="modal-box dep-modal" role="dialog" aria-modal="true" aria-labelledby="dep-modal-title">' +
      '<h2 class="modal-title" id="dep-modal-title">' + (editing ? 'Edit Asset' : 'Add Asset') + '</h2>' +

      '<div class="form-grid">' +
      field('dep-name', 'Asset name', inputHtml('dep-name', 'text', 'name', 'placeholder="e.g. Sony FX6 body"'), '', true) +
      field('dep-category', 'Category',
        '<select id="dep-category" data-key="category"><option value="" disabled' + (form.category ? '' : ' selected') +
        '>Choose a category</option>' + optionsMarkup(CATEGORIES, form.category) + '</select>') +
      field('dep-supplier', 'Supplier', inputHtml('dep-supplier', 'text', 'supplier', '')) +
      field('dep-serial', 'Serial number', inputHtml('dep-serial', 'text', 'serialNumber', '')) +
      '</div>' +

      '<h3 class="dep-group">Dates</h3><div class="form-grid">' +
      field('dep-purchase', 'Purchase date', inputHtml('dep-purchase', 'date', 'purchaseDate', '', true),
        'When you bought it.') +
      field('dep-start', 'Start date', inputHtml('dep-start', 'date', 'startDate', '', true),
        'When you first used it, or it was set up ready to use — the ATO’s “start time”. Depreciation runs ' +
        'from this date, not the purchase date: bought in June and first used in July is next financial year.') +
      '</div>' +

      '<h3 class="dep-group">Cost and GST</h3><div class="form-grid">' +
      field('dep-cost', 'Cost, including GST ($)',
        inputHtml('dep-cost', 'number', 'costIncGst', 'min="0" step="0.01" inputmode="decimal"')) +
      field('dep-gst', 'GST included ($)',
        inputHtml('dep-gst', 'number', 'gstAmount', 'min="0" step="0.01" inputmode="decimal"', true),
        'Usually the price ÷ 11 when GST was charged; 0 if it wasn’t.') +
      '<div class="field full"><label class="dep-check"><input type="checkbox" id="dep-gst-claimed" data-key="gstCreditClaimed"' +
      (form.gstCreditClaimed ? ' checked' : '') + ' aria-describedby="dep-gst-note"> I claimed this GST back as a credit</label>' +
      '<p class="oh-hint" id="dep-gst-note">' + gstNote() + '</p></div>' +
      '</div>' +

      '<h3 class="dep-group">For tax</h3><div class="form-grid">' +
      field('dep-method', 'ATO method',
        '<select id="dep-method" data-key="method"><option value="" disabled' + (form.method ? '' : ' selected') +
        '>Choose a method</option>' + optionsMarkup(METHODS, form.method) + '</select>') +
      field('dep-use', 'Business use (%)',
        inputHtml('dep-use', 'number', 'businessUsePct', 'min="0" max="100" step="1"', true),
        'The share used for work. A laptop used half personally is 50.') +
      (needsLife
        ? field('dep-life', 'Effective life (years)',
            inputHtml('dep-life', 'number', 'effectiveLifeYears',
              'min="0" step="0.5" placeholder="' + esc(lifePlaceholder) + '"', true),
            'From the ATO’s effective-life tables, which change — confirm the figure with your accountant.')
        : '') +
      (form.category === 'vehicle'
        ? field('dep-car', 'Car cost limit ($)',
            inputHtml('dep-car', 'number', 'carLimit', 'min="0" step="1"', true),
            'The ATO car limit for the financial year you first used it — it caps the cost base. Confirm it ' +
              'with your accountant.')
        : '') +
      field('dep-opening', 'Opening adjustable value ($) — optional',
        inputHtml('dep-opening', 'number', 'openingAdjustableValue', 'min="0" step="0.01"', true),
        'Only for gear that was already part-depreciated when you entered it here. Leave blank and it starts ' +
          'at its cost.', true) +
      '</div>' +

      '<h3 class="dep-group">For pricing</h3><div class="form-grid">' +
      field('dep-cycle', 'Replace every (years)',
        inputHtml('dep-cycle', 'number', 'replacementCycleYears', 'min="0" step="0.5"', true),
        'How long you actually keep one before replacing it.') +
      field('dep-replace', 'Replacement cost ($)',
        inputHtml('dep-replace', 'number', 'replacementCostEstimate', 'min="0" step="1"', true),
        'What the next one will cost, not what this one did.') +
      '<p class="oh-hint dep-reserve-line full" id="dep-reserve-line"></p>' +
      '</div>' +

      '<div class="form-grid">' +
      field('dep-notes', 'Notes', '<textarea id="dep-notes" data-key="notes" rows="2">' + esc(form.notes) + '</textarea>', '', true) +
      '</div>' +

      '<div id="dep-modal-error" role="alert"></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="dep-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-accent" id="dep-save" data-write>' +
      '<span class="spinner" id="dep-spin"></span>' +
      '<span id="dep-save-label">' + (editing ? 'Save Changes' : 'Add Asset') + '</span></button>' +
      '</div></div>'
    );
  }

  /* The reserve this asset will add, live, from the form — the one number in
     the modal that moves every rate on the card. */
  function refreshReserveLine() {
    const el = $m('dep-reserve-line');
    if (!el) return;
    const r = replacementReserveTotal([
      {
        replacementCostEstimate: parseFloat(form.replacementCostEstimate),
        replacementCycleYears: parseFloat(form.replacementCycleYears),
        businessUsePct: form.businessUsePct === '' ? 100 : parseFloat(form.businessUsePct),
        disposalDate: editing ? editing.disposalDate : null,
      },
    ]);
    el.textContent =
      r > 0
        ? 'Adds ' + fmt(r) + ' a year to your replacement reserve — and so to every rate on your card.'
        : 'Leave both blank to track this for tax only; it then adds nothing to your rates.';
  }

  function problems() {
    const found = [];
    const f = form;
    if (!String(f.name || '').trim()) found.push({ msg: 'Give the asset a name.', field: $m('dep-name') });
    if (!f.category) found.push({ msg: 'Pick a category.', field: $m('dep-category') });

    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (!ymd.test(f.purchaseDate || '')) found.push({ msg: 'Enter the purchase date.', field: $m('dep-purchase') });
    if (!ymd.test(f.startDate || '')) found.push({ msg: 'Enter the start date.', field: $m('dep-start') });
    /* Text comparison is correct for 'YYYY-MM-DD'. You can't first use gear
       before you own it; the likelier story is the two fields swapped. */
    if (ymd.test(f.purchaseDate || '') && ymd.test(f.startDate || '') && f.startDate < f.purchaseDate) {
      found.push({
        msg: 'The start date is before the purchase date — it should be the day you first used it, on or after buying it.',
        fields: [$m('dep-start'), $m('dep-purchase')],
      });
    }

    const cost = parseFloat(f.costIncGst);
    if (!Number.isFinite(cost) || cost < 0) found.push({ msg: 'Cost must be a dollar amount, 0 or more.', field: $m('dep-cost') });
    const gst = f.gstAmount === '' ? 0 : parseFloat(f.gstAmount);
    if (!Number.isFinite(gst) || gst < 0) {
      found.push({ msg: 'GST must be a dollar amount, 0 or more.', field: $m('dep-gst') });
    } else if (Number.isFinite(cost) && gst > cost) {
      found.push({ msg: 'The GST can’t be more than the price it was part of.', field: $m('dep-gst') });
    }

    if (!f.method) found.push({ msg: 'Pick an ATO method.', field: $m('dep-method') });
    /* A PERCENT, 0–100 — migration v5 decision 1. 0.6 typed for 60% passes
       this check and is caught by nothing, so the hint says "50" in words. */
    const use = f.businessUsePct === '' ? NaN : parseFloat(f.businessUsePct);
    if (!Number.isFinite(use) || use < 0 || use > 100) {
      found.push({ msg: 'Business use is a percent from 0 to 100.', field: $m('dep-use') });
    }
    if (NEEDS_LIFE[f.method]) {
      const life = parseFloat(f.effectiveLifeYears);
      if (!Number.isFinite(life) || life <= 0) {
        found.push({ msg: 'This method needs an effective life in years.', field: $m('dep-life') });
      }
    }
    const optional = [
      ['openingAdjustableValue', 'dep-opening', 'The opening adjustable value must be 0 or more, or blank.'],
      ['carLimit', 'dep-car', 'The car cost limit must be 0 or more, or blank.'],
      ['replacementCostEstimate', 'dep-replace', 'The replacement cost must be 0 or more, or blank.'],
    ];
    optional.forEach(([key, id, msg]) => {
      if (f[key] === '' || f[key] === undefined) return;
      const v = parseFloat(f[key]);
      if (!Number.isFinite(v) || v < 0) found.push({ msg, field: $m(id) });
    });
    if (f.replacementCycleYears !== '') {
      const c = parseFloat(f.replacementCycleYears);
      if (!Number.isFinite(c) || c <= 0) {
        found.push({ msg: 'Replace every … years must be more than 0, or blank.', field: $m('dep-cycle') });
      }
    }
    return found;
  }

  const numOrNullText = (v) => (v === '' || v === undefined || v === null ? null : parseFloat(v));

  function body() {
    const f = form;
    return {
      name: String(f.name).trim(),
      category: f.category,
      serialNumber: String(f.serialNumber || '').trim(),
      supplier: String(f.supplier || '').trim(),
      purchaseDate: f.purchaseDate,
      startDate: f.startDate,
      costIncGst: parseFloat(f.costIncGst),
      gstAmount: f.gstAmount === '' ? 0 : parseFloat(f.gstAmount),
      gstCreditClaimed: Boolean(f.gstCreditClaimed),
      method: f.method,
      // Only sent for the methods that use it; a stale life left on a pooled
      // asset would be read by nothing but would mislead the next editor.
      effectiveLifeYears: NEEDS_LIFE[f.method] ? numOrNullText(f.effectiveLifeYears) : null,
      businessUsePct: parseFloat(f.businessUsePct),
      openingAdjustableValue: numOrNullText(f.openingAdjustableValue),
      carLimit: f.category === 'vehicle' ? numOrNullText(f.carLimit) : null,
      replacementCycleYears: numOrNullText(f.replacementCycleYears),
      replacementCostEstimate: numOrNullText(f.replacementCostEstimate),
      // Carried through untouched — see "EDIT MUST CARRY THE DISPOSAL FIELDS
      // THROUGH" in the header.
      disposalDate: editing ? editing.disposalDate || null : null,
      disposalProceeds: editing ? editing.disposalProceeds : null,
      disposalReason: editing ? editing.disposalReason || '' : '',
      notes: String(f.notes || ''),
    };
  }

  function setSaving(next) {
    saving = next;
    if (!$m('dep-save')) return;
    $m('dep-save').disabled = next;
    $m('dep-cancel').disabled = next;
    $m('dep-spin').style.display = next ? 'inline-block' : 'none';
    $m('dep-save-label').textContent = next ? 'Saving…' : editing ? 'Save Changes' : 'Add Asset';
  }

  async function saveAsset() {
    if (saving) return;
    LSCUtil.clearFieldErrors($m('dep-modal-error'));
    const found = problems();
    if (found.length) {
      LSCUtil.showFieldErrors($m('dep-modal-error'), found);
      return;
    }
    const wasEditing = Boolean(editing);
    setSaving(true);
    Toast.working(wasEditing ? 'Saving asset…' : 'Adding asset…');
    try {
      if (wasEditing) await LSCApi.put('/api/depreciation-assets/' + encodeURIComponent(editing.id), body());
      else await LSCApi.post('/api/depreciation-assets', body());
      await refreshCache();
      baseline = snapshot();
      Toast.ok(wasEditing ? 'Asset saved.' : 'Asset added.');
      saving = false;
      closeModal();
      if (onScreen()) render();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      const el = $m('dep-modal-error');
      if (el) {
        el.textContent = failureText(err, wasEditing ? 'save that asset' : 'add that asset');
        el.classList.add('show');
      }
    }
  }

  function onKeydown(event) {
    if (overlay.closest('[hidden]')) return;
    if (event.key === 'Escape' && !saving) return dismissModal();
    LSCModal.trapTab(overlay, event);
  }

  function onOverlayClick(event) {
    if (event.target === overlay) dismissModal();
  }

  function dismissModal() {
    if (!LSCUnsaved.confirmLeave('Closing this window')) return;
    closeModal();
  }

  function closeModal() {
    if (saving) return;
    overlay.classList.remove('open');
    overlay.innerHTML = '';
    document.removeEventListener('keydown', onKeydown);
    overlay.removeEventListener('click', onOverlayClick);
    form = null;
    editing = null;
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  }

  /* Structural fields — method and category — change which inputs exist
     (effective life, car limit), so they re-render the box. Focus goes back to
     the control that changed. Everything else writes to the form in place. */
  function bindModal() {
    overlay.querySelectorAll('[data-key]').forEach((el) => {
      const key = el.getAttribute('data-key');
      const structural = key === 'method' || key === 'category';
      const event = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(event, () => {
        form[key] = el.type === 'checkbox' ? el.checked : el.value;
        if (structural) {
          renderModal();
          const again = $m(el.id);
          if (again) again.focus();
          return;
        }
        if (key === 'replacementCostEstimate' || key === 'replacementCycleYears' || key === 'businessUsePct') {
          refreshReserveLine();
        }
      });
    });
    $m('dep-cancel').addEventListener('click', dismissModal);
    $m('dep-save').addEventListener('click', saveAsset);
  }

  function renderModal() {
    overlay.innerHTML = modalMarkup();
    bindModal();
    refreshReserveLine();
  }

  function openModal(asset, openedBy) {
    editing = asset || null;
    opener = openedBy || null;
    saving = false;
    const a = asset || {};
    form = {
      name: toField(a.name),
      category: toField(a.category),
      supplier: toField(a.supplier),
      serialNumber: toField(a.serialNumber),
      purchaseDate: toField(a.purchaseDate),
      startDate: toField(a.startDate),
      costIncGst: asset ? toField(a.costIncGst) : '',
      gstAmount: asset ? toField(a.gstAmount) : '',
      gstCreditClaimed: Boolean(a.gstCreditClaimed),
      method: toField(a.method),
      // New assets start at 100% business use — the column default, and the
      // common case; the hint says what to type when it isn't.
      businessUsePct: asset ? toField(a.businessUsePct) : '100',
      effectiveLifeYears: toField(a.effectiveLifeYears),
      carLimit: toField(a.carLimit),
      openingAdjustableValue: toField(a.openingAdjustableValue),
      replacementCycleYears: toField(a.replacementCycleYears),
      replacementCostEstimate: toField(a.replacementCostEstimate),
      notes: toField(a.notes),
    };
    baseline = snapshot();

    renderModal();
    overlay.classList.add('open');
    document.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', onOverlayClick);

    LSCUnsaved.watch('depreciation-asset', {
      label: editing ? 'this asset' : 'this new asset',
      onScreen: () => Boolean(overlay && overlay.querySelector('#dep-save')),
      dirty: () => form !== null && snapshot() !== baseline,
    });

    $m('dep-name').focus();
  }

  // ── Mounting ──────────────────────────────────────────────────────────────

  function bind() {
    root.querySelectorAll('[data-dep-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const asset = assets().find((a) => a.id === btn.dataset.depEdit);
        if (asset) openModal(asset, btn);
      });
    });
    root.querySelectorAll('[data-dep-del]').forEach((btn) => {
      btn.addEventListener('click', () => remove(btn.dataset.depDel));
    });
    const toggle = $('dep-show-disposed');
    if (toggle) {
      toggle.addEventListener('change', () => {
        showDisposed = toggle.checked;
        render();
        const again = $('dep-show-disposed');
        if (again) again.focus();
      });
    }
    $('dep-iawo').addEventListener('input', function () {
      iawoRaw = this.value;
    });
    $('dep-iawo-save').addEventListener('click', saveThreshold);
    const fySelect = $('dep-fy');
    if (fySelect) {
      fySelect.addEventListener('change', () => {
        selectedFy = fySelect.value;
        schedError = null;
        announcePending = true;
        renderScheduleBody();
      });
    }
  }

  function render() {
    /* Deleting or re-dating the only asset in a year can take that year out
       of the list; fall back to the current FY rather than leave the <select>
       showing an option that no longer exists. */
    if (!fyOptions().includes(selectedFy)) {
      selectedFy = currentFinancialYear();
      schedError = null;
    }
    root.innerHTML = markup();
    bind();
    ensureSchedule();
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    overlay = document.getElementById('modal-depreciation-asset');
    iawoSaved = toField(LSCData.goals().iawoThreshold);
    iawoRaw = iawoSaved;
    /* Every visit opens on the current Australian FY (the shared helper, never
       getFullYear()) and asks the server afresh. */
    selectedFy = currentFinancialYear();
    dropSchedule();
    render();

    LSCUnsaved.watch('depreciation-threshold', {
      label: 'the write-off threshold',
      onScreen: () => Boolean(document.getElementById('dep-iawo')),
      dirty: () => String(iawoRaw).trim() !== String(iawoSaved).trim(),
    });
  }

  /* Overhead's page-head "+ Add Asset" button. */
  function openAdd(openedBy) {
    openModal(null, openedBy);
  }

  return { mount, openAdd };
})();
