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
 * thing read, not a surprise found later, and the info control under them
 * (js/info.js) says why in full.
 *
 * MOUNTED BY OverheadView, NOT THE ROUTER
 * Overhead owns the page head and the inner-tab row; this module renders the
 * Depreciation tab's content into the container Overhead hands it and exposes
 * openAdd() for Overhead's page-head button. It has its own modal overlay
 * (#modal-depreciation-asset) and uses the app's one focus trap, LSCModal.
 *
 * EDIT MUST CARRY THE DISPOSAL FIELDS THROUGH
 * PUT /api/depreciation-assets/:id writes every column, and a disposal date
 * that isn't sent is written as NULL — "still held". The Edit modal doesn't
 * edit disposal (the Dispose dialog below does), so an edit that sent only
 * the fields on screen would silently un-dispose a sold asset: it would rejoin
 * the replacement reserve, raise every rate, and drop its balancing adjustment
 * from the disposal year. body() copies them from the stored asset.
 *
 * DISPOSAL IS RECORDED, NOT DELETED (2026-09-27)
 * Each held asset has a Dispose button; a disposed one has Disposal, to
 * correct or undo it. The dialog takes the date, the proceeds and a reason,
 * and says before saving what it will do: the asset leaves the replacement
 * reserve at once (sold gear must stop inflating every rate), while staying
 * on its disposal year's schedule with the balancing adjustment — that year's
 * tax event — previewed from the same LSCDepreciation the server runs. A
 * disposal dated in a year already marked lodged is allowed but warned about:
 * the schedule will show the lodged figures and flag the change, which is an
 * amendment for the accountant, not something this screen quietly rewrites.
 * A disposal before the start date is refused here AND by the route (which
 * is the rule; see disposalProblem in routes/depreciation.js). A future date
 * is refused here only: record a disposal once it has happened.
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
 * because that route is where a lodged year's frozen figures and its
 * line-by-line divergences come from. One reply is cached per selected FY and
 * dropped on every asset write, so ticking "Show disposed" doesn't refetch but
 * adding an asset does.
 *
 * A LODGED YEAR SHOWS WHAT WAS LODGED
 * "Mark FY as lodged" appends a depreciation_locks row freezing that year's
 * figures. From then on the schedule renders the frozen snapshot, never
 * today's recompute, badged as lodged; where the two disagree it lists each
 * line and figure that moved, rather than silently showing new numbers as if
 * they were filed. There is no unlock and no second lodgement from this
 * screen — a wrong lodgement is an amendment, a deliberate act outside the UI.
 * Only a finished FY can be marked (the server refuses the current one).
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
  // The Dispose dialog (shares the overlay, `saving` and `opener` above).
  let disposing = null; // the stored asset being disposed of, or whose disposal is being corrected
  let dform = null;
  let dbaseline = '';
  let lodgedFys = null; // Set of lodged FY labels, fetched when the dialog opens

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
  // The decline curve's picker. null = the first chartable asset.
  let chartAssetId = null;
  let pendingFocus = null; // an id to focus once the next reply renders

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
    // The threshold drives the small business pool's low-pool-value rule.
    const schedule = LSCDepreciation.financialYearSchedule(list, fy, { iawoThreshold: LSCData.goals().iawoThreshold });
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
      '<p class="oh-note dep-split-note">Two numbers from the same gear, on purpose.' + splitInfo() + '</p>'
    );
  }

  /* Brief decision 8, in full: the split is the whole concept of this tab, so
     the long form is one tap away rather than a paragraph everyone scrolls
     past on every visit. */
  function splitInfo() {
    return LSCInfo.markup({
      id: 'dep-split',
      label: 'Why the replacement reserve and the tax deduction differ',
      title: 'Why two numbers',
      paragraphs: [
        '<strong>Replacement reserve</strong> — what your <em>next</em> one will cost, spread evenly over how long ' +
          'you actually keep one, at your business-use share. It’s part of the annual business cost, so it’s in ' +
          'every rate on your card.',
        '<strong>Tax deduction</strong> — the ATO’s decline in value for this financial year, by the method you ' +
          'chose for each asset. It’s for your return and your accountant, and it’s in no rate.',
        'They differ on purpose. Diminishing value front-loads the deduction — large in year one, small by year ' +
          'four — which would swing your day rate 30–40% for gear still in daily use. Pricing wants the steady ' +
          'number; tax wants the ATO’s.',
      ],
    });
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
          '<button type="button" class="btn btn-ghost btn-sm" data-dep-dispose="' + esc(a.id) + '"' +
          ' aria-label="' + (isDisposed(a) ? 'Change or undo the disposal of ' : 'Dispose of ') +
          esc(a.name || 'this asset') + '">' + (isDisposed(a) ? 'Disposal' : 'Dispose') + '</button>' +
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

  /* A row's own business use, disposal date and proceeds — the chain has put
     them on every row since the lodgement-lock task, so a lodged snapshot
     prints the values its figures were computed from. A lock taken before
     that falls back to the asset as it is now; that is all such a lock has. */
  function rowUse(r, asset) {
    if (typeof r.businessUsePct === 'number') return r.businessUsePct;
    return asset && asset.businessUsePct !== undefined ? num(asset.businessUsePct) : null;
  }
  function rowDisposal(r, asset) {
    const a = asset || {};
    return {
      date: r.disposalDate !== undefined ? r.disposalDate : a.disposalDate || null,
      proceeds: r.disposalProceeds !== undefined ? r.disposalProceeds : num(a.disposalProceeds),
    };
  }

  const changedTag = (changed) => (changed ? ' <span class="dep-tag dep-tag-changed">Changed since lodging</span>' : '');

  function assetRowsMarkup(rows, byId, changedIds) {
    let decline = 0;
    let deductible = 0;
    const body = rows
      .map((r) => {
        decline += r.decline;
        deductible += r.deductible;
        const use = rowUse(r, byId.get(r.assetId));
        return (
          '<tr>' +
          '<td data-label="Asset">' + esc(r.name || 'Untitled') +
          (r.disposed ? ' <span class="dep-tag">Disposed</span>' : '') + changedTag(changedIds.has(r.assetId)) + '</td>' +
          '<td class="right muted-td" data-label="Days held">' + esc(String(r.daysHeld)) + '</td>' +
          '<td class="right" data-label="Opening adjustable value">' + fmt(r.openingAdjustableValue) + '</td>' +
          '<td class="right" data-label="Decline in value">' + fmt(r.decline) + '</td>' +
          '<td class="right muted-td" data-label="Business use">' + (use === null ? '—' : esc(use + '%')) + '</td>' +
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
  function poolRowsMarkup(rows, fy, changedIds) {
    const body = rows
      .map((r) => {
        const added = assets()
          .filter((a) => a.method === r.pool && a.startDate && fyLabel(a.startDate) === fy)
          .map((a) => esc(a.name || 'Untitled'));
        return (
          '<tr>' +
          '<td data-label="Pool">' + esc(POOL_LABEL[r.pool] || r.pool) + changedTag(changedIds.has(r.pool)) +
          (added.length ? '<div class="dep-pool-added">Added this year: ' + added.join(', ') + '</div>' : '') + '</td>' +
          '<td class="right" data-label="Opening pool balance">' + fmt(r.openingBalance) + '</td>' +
          '<td class="right" data-label="Additions (business share)">' + fmt(r.additions) + '</td>' +
          '<td class="right dep-strong" data-label="Decline in value (deductible)">' + fmt(r.decline) + '</td>' +
          '<td class="right" data-label="Disposal proceeds">' + (r.disposalProceeds ? fmt(r.disposalProceeds) : '—') + '</td>' +
          '<td class="right" data-label="Closing pool balance">' + fmt(r.closingBalance) +
          (r.assessableIncome
            ? '<div class="dep-pool-added">Below nil by ' + fmt(r.assessableIncome) + ' — assessable income</div>'
            : '') + '</td>' +
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
      'balancing adjustment of its own. If disposals take a pool below nil, the excess is assessable income. A small ' +
      'business pool under your instant write-off threshold is deducted in full.</p></div>'
    );
  }

  /* Balancing adjustments for assets disposed of in this FY. Their own block,
     not a column on the asset table: most years it would be a column of dashes,
     and it is a different line on the return from the decline in value. The
     date and proceeds are shown because an accountant checks the inputs, not
     just the adjustment — read from the row (rowDisposal) so a lodged year
     shows what was lodged. */
  function disposalRowsMarkup(rows, byId) {
    const body = rows
      .map((r) => {
        const asset = byId.get(r.assetId);
        const disposal = rowDisposal(r, asset);
        const use = rowUse(r, asset);
        return (
          '<tr>' +
          '<td data-label="Asset">' + esc(r.name || 'Untitled') + '</td>' +
          '<td class="muted-td" data-label="Disposal date">' + esc(disposal.date || '—') + '</td>' +
          '<td class="right" data-label="Disposal proceeds">' + fmt(disposal.proceeds) + '</td>' +
          '<td class="right" data-label="Adjustable value at disposal">' + fmt(r.closingAdjustableValue) + '</td>' +
          '<td class="right muted-td" data-label="Business use">' + (use === null ? '—' : esc(use + '%')) + '</td>' +
          '<td class="right dep-strong" data-label="Balancing adjustment">' + balancingText(r.balancingAdjustment) +
          (r.capitalGain ? '<div class="dep-pool-added">+ ' + fmt(r.capitalGain) + ' capital gain</div>' : '') + '</td>' +
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
      '<p class="dep-sched-note">(Proceeds, up to cost, − adjustable value) × business use. Positive is assessable ' +
      'income; negative is a further deduction. It belongs to the year of disposal. Anything sold above cost is a ' +
      'capital gain instead, shown under it — a different line on the return.</p></div>'
    );
  }

  // ── Lodgement: the badge, the divergence list, and the foot actions ──────

  const FIELD_LABEL = {
    daysHeld: 'days held',
    businessUsePct: 'business use',
    openingAdjustableValue: 'opening adjustable value',
    decline: 'decline in value',
    deductible: 'deductible',
    closingAdjustableValue: 'closing adjustable value',
    disposalDate: 'disposal date',
    disposalProceeds: 'disposal proceeds',
    balancingAdjustment: 'balancing adjustment',
    capitalGain: 'capital gain',
    assessableIncome: 'pool assessable income',
    openingBalance: 'opening pool balance',
    additions: 'additions',
    closingBalance: 'closing pool balance',
  };

  function fieldValue(field, v) {
    if (v === null || v === undefined) return 'none';
    if (field === 'daysHeld') return String(v);
    if (field === 'businessUsePct') return v + '%';
    if (field === 'disposalDate') return String(v);
    if (field === 'balancingAdjustment') return signedFmt(v);
    return fmt(v);
  }

  /* lockedAt is an ISO timestamp; the date is what the user did it on. */
  function lodgedOn(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function divergenceItem(d) {
    // A pool by this screen's own label, so the list names it as the table does.
    const label = d.kind === 'pool' ? POOL_LABEL[d.id] || d.name : d.name;
    const name = '<strong>' + esc(label || 'Untitled') + '</strong>';
    if (d.change === 'removed') return '<li>' + name + ' — deleted from the register since it was lodged.</li>';
    if (d.change === 'added') {
      return '<li>' + name + ' — now falls in this year, but wasn’t in what was lodged.</li>';
    }
    const parts = d.fields.map(
      (f) =>
        esc(FIELD_LABEL[f.field] || f.field) + ': lodged ' + esc(fieldValue(f.field, f.lodged)) +
        ', now ' + esc(fieldValue(f.field, f.live))
    );
    return '<li>' + name + ' — ' + parts.join('; ') + '.</li>';
  }

  /* tabindex="-1": after "Mark as lodged" the button that had focus is gone,
     so focus is put here — on the statement of what just happened — rather
     than dropped to the top of the document. */
  function lodgedMarkup(reply) {
    const on = lodgedOn(reply.lockedAt);
    const list = reply.divergences || [];
    return (
      '<div class="dep-lodged" id="dep-lodged" tabindex="-1">' +
      '<span class="dep-lodged-badge">Lodged</span>' +
      '<p>Marked as lodged' + (on ? ' on ' + esc(on) : '') + '. These are the figures as lodged, frozen — ' +
      'later changes to your assets don’t rewrite them.</p></div>' +
      (list.length
        ? '<div class="dep-diverge" role="status"><p class="dep-diverge-h">Your assets have changed since ' +
          esc(fyDisplay(selectedFy)) + ' was lodged. The figures below are still what was lodged; recomputed ' +
          'today, ' + (list.length === 1 ? 'one line differs' : list.length + ' lines differ') + ':</p>' +
          '<ul>' + list.map(divergenceItem).join('') + '</ul>' +
          '<p>If an asset was edited by mistake, changing it back clears this. If what was lodged was wrong, ' +
          'that’s an amendment — take this list to your accountant. The app has no way to re-lodge a year, on ' +
          'purpose.</p></div>'
        : '')
    );
  }

  /* 30 June of an FY, for the "not yet" line — from the shared helper, so the
     date and the label can never disagree. */
  function fyEndText(fy) {
    const bounds = fyBounds(fy);
    const end = new Date(bounds.end + 'T00:00:00');
    return end.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* At the foot of the schedule, where an accountant's workflow ends (IA doc):
     download what you're about to hand over, then record that it was handed
     over. The lock button exists only for a finished, unlodged year — there
     is deliberately no unlock and no second lodgement from here. */
  function actionsMarkup(reply, schedule) {
    const fy = selectedFy;
    const shown = esc(fyDisplay(fy));
    let lodge = '';
    if (reply.locked) {
      lodge = '<p class="dep-actions-note">The download is the lodged figures.</p>';
    } else if (!reply.fyEnded) {
      lodge =
        '<p class="dep-actions-note">You can mark ' + shown + ' as lodged once it ends on ' +
        esc(fyEndText(fy)) + '. Until then its figures can still move.</p>';
    } else {
      lodge =
        '<button type="button" class="btn btn-ghost btn-sm" id="dep-lodge" data-write>Mark ' + shown +
        ' as lodged</button>' +
        '<p class="dep-actions-note">Once your return is in. It freezes these figures — ' +
        fmt(schedule.totalDeductible) + ' deductible — as what was filed. There’s no undo.</p>';
    }
    return (
      '<div class="dep-actions">' +
      '<div class="dep-actions-row">' +
      '<button type="button" class="btn btn-accent btn-sm" id="dep-csv">' +
      '<span class="spinner" id="dep-csv-spin"></span><span>Download CSV — ' + shown + '</span></button>' +
      lodge +
      '</div>' +
      '<div id="dep-actions-error" role="alert"></div>' +
      '</div>'
    );
  }

  function showActionError(message) {
    const el = $('dep-actions-error');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
  }

  let downloading = false;
  let lodging = false;

  /* The spreadsheet for the selected FY. Local download only — nothing is
     emailed, uploaded or shared. The server builds it (the frozen figures for
     a lodged year) and names it with the FY. */
  async function downloadCsv() {
    if (downloading) return;
    const fy = selectedFy;
    const btn = $('dep-csv');
    LSCUtil.clearFieldErrors($('dep-actions-error'));
    downloading = true;
    if (btn) btn.disabled = true;
    if ($('dep-csv-spin')) $('dep-csv-spin').style.display = 'inline-block';
    try {
      const reply = await LSCApi.getCsv('/api/depreciation-schedule.csv?fy=' + encodeURIComponent(fy));
      LSCUtil.saveFile(reply.blob, reply.filename || 'depreciation-schedule-' + fy + '.csv');
      Toast.ok(fyDisplay(fy) + ' schedule downloaded.');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showActionError(failureText(err, 'download the CSV'));
    } finally {
      downloading = false;
      const again = $('dep-csv');
      if (again) again.disabled = false;
      if ($('dep-csv-spin')) $('dep-csv-spin').style.display = 'none';
    }
  }

  async function lodge() {
    if (lodging || !sched || sched.fy !== selectedFy) return;
    const fy = selectedFy;
    const s = sched.reply.schedule;
    if (
      !window.confirm(
        'Mark ' + fyDisplay(fy) + ' as lodged?\n\n' +
          'This freezes today’s figures — ' + fmt(s.totalDeductible) + ' deductible' +
          (s.assets.some((r) => r.disposed) ? ', ' + signedFmt(s.totalBalancingAdjustment) + ' in balancing adjustments' : '') +
          ' — as what you filed. Later changes to your assets won’t rewrite them; they’ll be flagged instead.\n\n' +
          'There’s no undo in the app. Only do this once the return has actually been lodged.'
      )
    ) return;

    LSCUtil.clearFieldErrors($('dep-actions-error'));
    lodging = true;
    const btn = $('dep-lodge');
    if (btn) btn.disabled = true;
    Toast.working('Recording the lodgement…');
    try {
      await LSCApi.post('/api/depreciation-locks', { fy });
      dropSchedule();
      Toast.ok(fyDisplay(fy) + ' marked as lodged.');
      pendingFocus = 'dep-lodged';
      renderScheduleBody();
    } catch (err) {
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showActionError(failureText(err, 'mark it as lodged'));
      const again = $('dep-lodge');
      if (again) again.disabled = false;
    } finally {
      lodging = false;
    }
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

    /* A lodged year shows what was LODGED — the frozen snapshot — never
       today's recompute, which may since have moved (an effective life edited
       in 2027 must not rewrite what was filed for 2026). Where the two now
       disagree, lodgedMarkup says so line by line, above the figures. */
    const reply = sched.reply;
    const schedule = reply.locked && reply.lockedFigures ? reply.lockedFigures : reply.schedule;
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
    const changedIds = new Set(
      (reply.divergences || []).filter((d) => d.change === 'changed').map((d) => d.id)
    );

    return (
      (reply.locked ? lodgedMarkup(reply) : '') +
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
      (assetRows.length ? assetRowsMarkup(assetRows, byId, changedIds) : '') +
      (poolRows.length ? poolRowsMarkup(poolRows, fy, changedIds) : '') +
      (disposed.length ? disposalRowsMarkup(disposed, byId) : '') +
      actionsMarkup(reply, schedule) +
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
    bindScheduleBody();
  }

  /* Called from both paths that put the body on screen: renderScheduleBody,
     and render() — which builds it inside markup() when the reply is already
     cached (ticking "Show disposed", or returning from the asset modal). */
  function bindScheduleBody() {
    const csv = $('dep-csv');
    if (csv) csv.addEventListener('click', downloadCsv);
    const lodgeBtn = $('dep-lodge');
    if (lodgeBtn) lodgeBtn.addEventListener('click', lodge);
    if (pendingFocus && $(pendingFocus)) {
      $(pendingFocus).focus();
      pendingFocus = null;
    }
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
      const reply = sched.reply;
      const s = reply.locked && reply.lockedFigures ? reply.lockedFigures : reply.schedule;
      const count = (s.assets || []).length + (s.pools || []).length;
      const changed = (reply.divergences || []).length;
      status.textContent =
        fyDisplay(selectedFy) + (reply.locked ? ', lodged' : '') + ': ' +
        (count ? fmt(s.totalDeductible) + ' deductible across ' + count + (count === 1 ? ' line.' : ' lines.') : 'nothing held.') +
        (changed ? ' ' + changed + (changed === 1 ? ' line has' : ' lines have') + ' changed since lodging.' : '');
    }
    ensureSchedule();
  }

  // ── The decline curve ─────────────────────────────────────────────────────

  /* What the picker offers: the register's own list (so "Show disposed"
     governs both), narrowed to what has a curve — see canChartDecline() in
     overhead-charts.js for why instant write-offs and pools don't. */
  function chartable() {
    const list = showDisposed ? assets() : assets().filter((a) => !isDisposed(a));
    return list.filter(OverheadCharts.canChartDecline);
  }

  function chartAsset() {
    const list = chartable();
    return list.find((a) => a.id === chartAssetId) || list[0] || null;
  }

  /* Why there's no curve, when there isn't one. Names the actual reason:
     "nothing to chart" beside a register full of pooled gear would read as a
     bug. */
  function declineEmptyMessage() {
    const all = assets();
    if (!all.length) return 'Add an asset and its value for tax, year by year, is drawn here.';
    const shown = showDisposed ? all : all.filter((a) => !isDisposed(a));
    if (!shown.length) return 'Everything here has been disposed of. Tick “Show disposed” to chart it.';
    return (
      'Nothing here has a curve to draw. Only diminishing value and prime cost decline year by year — an instant ' +
      'write-off is deducted in full in its first year, and a pooled asset declines as part of its pool (see Pools ' +
      'in the schedule below).'
    );
  }

  function declineMarkup() {
    const list = chartable();
    const current = chartAsset();
    const picker = list.length
      ? '<label class="dep-fy"><span class="sum-label">Asset</span>' +
        '<select id="dep-decline-asset" class="doc-type-select">' +
        list
          .map((a) =>
            '<option value="' + esc(a.id) + '"' + (current && a.id === current.id ? ' selected' : '') + '>' +
            esc(a.name || 'Untitled') + (isDisposed(a) ? ' (disposed)' : '') + '</option>')
          .join('') +
        '</select></label>'
      : '';
    return (
      '<section class="dep-decline" aria-labelledby="dep-decline-h"><div class="dep-sched-head">' +
      '<h2 class="dep-sched-h" id="dep-decline-h">Decline in value</h2>' + picker + '</div>' +
      '<div class="est-block oh-chart-block"><div class="oh-chart" id="dep-decline-canvas"></div></div>' +
      // Spoken when the picker swaps the curve — the chart itself says nothing.
      '<p class="sr-only" id="dep-decline-live" aria-live="polite"></p>' +
      '</section>'
    );
  }

  // After the markup is in the document: the curve is drawn at its measured width.
  function drawDecline() {
    OverheadCharts.drawDecline(chartAsset(), declineEmptyMessage());
  }

  function markup() {
    return (
      summaryMarkup() +
      '<div id="dep-error" role="alert"></div>' +
      registerMarkup() +
      declineMarkup() +
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
      if (!onScreen()) return;
      render();
      // The row, and the × that was focused, are gone; see saveAsset().
      const again = document.getElementById('oh-add');
      if (again) again.focus();
    } catch (err) {
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(failureText(err, 'delete that asset'));
    }
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  /* Stored as the words themselves — disposal_reason is free text, printed
     nowhere that needs a code, and read by a person. */
  const REASONS = ['Sold', 'Traded in', 'Scrapped', 'Lost or stolen', 'Given away', 'Other'];

  const dsnapshot = () => JSON.stringify(dform);

  function isRealDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }

  /* The asset as it would be stored — what the preview runs the chain on. */
  function disposalCandidate() {
    return Object.assign({}, disposing, {
      disposalDate: dform.date,
      disposalProceeds: dform.proceeds === '' ? null : parseFloat(dform.proceeds),
    });
  }

  function disposalProblems() {
    const found = [];
    const start = disposing.startDate;
    if (!isRealDate(dform.date)) {
      found.push({ msg: 'Enter the date it left the business.', field: $m('dep-disp-date') });
    } else if (start && dform.date < start) {
      found.push({
        msg: 'The disposal date can’t be before its start date, ' + start + '.',
        field: $m('dep-disp-date'),
      });
    } else if (dform.date > LSCUtil.today()) {
      found.push({
        msg: 'That date hasn’t happened yet — record a disposal once it has.',
        field: $m('dep-disp-date'),
      });
    }
    const proceeds = dform.proceeds === '' ? NaN : parseFloat(dform.proceeds);
    if (!Number.isFinite(proceeds) || proceeds < 0) {
      found.push({
        msg: 'Enter what you got for it, in dollars — 0 if it was scrapped, lost or given away.',
        field: $m('dep-disp-proceeds'),
      });
    }
    return found;
  }

  /* Proceeds are the ATO's "termination value": for a GST-registered business
     the GST on the sale is excluded, since it goes to the ATO. */
  function proceedsHint() {
    const registered = (LSCData.settings().gst || {}).registered === true;
    return registered
      ? 'What you received. You’re registered for GST, so enter it excluding any GST you charged on the sale.'
      : 'What you received for it. 0 if it was scrapped, lost or given away.';
  }

  /* What saving will do, from the figures as typed. Only once the date and
     proceeds are usable — a preview of a half-typed date would be a guess. */
  function disposalPreviewMarkup() {
    if (!dform || disposalProblems().length) {
      return '<p class="oh-hint">Enter the date and what you got for it to see what this changes.</p>';
    }
    const candidate = disposalCandidate();
    const fy = fyLabel(dform.date);
    const lines = [];

    if (isDisposed(disposing)) {
      lines.push('It’s already out of your replacement reserve.');
    } else {
      const reserve = replacementReserveTotal([Object.assign({}, disposing, { disposalDate: null })]);
      lines.push(
        reserve > 0
          ? 'Your replacement reserve drops by <strong>' + fmt(reserve) + ' a year</strong> from today, and every ' +
              'rate on your card comes down with it.'
          : 'It adds nothing to your replacement reserve, so no rate changes.'
      );
    }

    if (LSCDepreciation.isPooledMethod(disposing.method)) {
      lines.push(
        'It’s in the ' + esc((POOL_LABEL[disposing.method] || 'pool').toLowerCase()) + ', so the business share ' +
          'of what you got comes off the pool’s balance in ' + esc(fyDisplay(fy)) + '. Pooled gear has no balancing ' +
          'adjustment of its own.'
      );
    } else {
      const bal = LSCDepreciation.balancingAdjustment(candidate);
      if (bal) {
        lines.push(
          'It stays on the <strong>' + esc(fyDisplay(bal.fy)) + '</strong> schedule, with an adjustable value at ' +
            'disposal of ' + fmt(bal.adjustableValue) + ' and a balancing adjustment of <strong>' +
            signedFmt(bal.amount) + '</strong>' +
            (bal.amount > 0 ? ' — assessable income' : bal.amount < 0 ? ' — a further deduction' : '') +
            '. Nothing on the schedules after that year.'
        );
      }
    }

    let warn = '';
    if (lodgedFys && lodgedFys.has(fy)) {
      warn =
        '<p class="dep-disp-warn">' + esc(fyDisplay(fy)) + ' is marked as lodged. Recording this changes that ' +
        'year’s figures: its schedule will keep showing what was lodged and flag the difference. That’s an ' +
        'amendment to talk to your accountant about.</p>';
    }
    return lines.map((l) => '<p>' + l + '</p>').join('') + warn;
  }

  /* `speak` for a change the user (or the lodged-years fetch) caused, not the
     preview's first paint as the dialog opens — and only when the preview
     actually moved, so the fetch landing with no lodged year says nothing. */
  function refreshDisposalPreview(speak) {
    const box = $m('dep-disp-preview');
    if (!box) return;
    const before = box.textContent; // text, not innerHTML: entities serialise differently
    const next = disposalPreviewMarkup();
    if (box.innerHTML !== next) box.innerHTML = next;
    if (speak && box.textContent !== before) {
      const text = Array.prototype.map.call(box.children, (p) => p.textContent).join(' ');
      LSCUtil.announce($m('dep-disp-live'), text);
    }
    /* A refusal from the last Save stops being true the moment the figures
       are usable; left up, it would contradict the preview right above it. */
    if (!disposalProblems().length) LSCUtil.clearFieldErrors($m('dep-modal-error'));
  }

  function disposeMarkup() {
    const a = disposing;
    const already = isDisposed(a);
    const name = esc(a.name || 'this asset');
    return (
      '<div class="modal-box dep-modal" role="dialog" aria-modal="true" aria-labelledby="dep-disp-title">' +
      '<h2 class="modal-title" id="dep-disp-title">' + (already ? 'Disposal of ' : 'Dispose of ') + name + '</h2>' +
      '<p class="oh-hint dep-disp-intro">Record it here when it’s sold, traded in, scrapped, lost or given away — ' +
      'not by deleting it. It leaves your replacement reserve straight away, and stays on its disposal year’s ' +
      'depreciation schedule, because that year’s balancing adjustment is a tax figure.</p>' +
      '<div class="form-grid">' +
      field('dep-disp-date', 'Disposal date',
        '<input id="dep-disp-date" type="date" value="' + esc(dform.date) + '"' +
        (a.startDate ? ' min="' + esc(a.startDate) + '"' : '') + ' max="' + esc(LSCUtil.today()) + '"' +
        ' aria-describedby="dep-disp-date-hint">',
        'The day it left the business' + (a.startDate ? ' — on or after its start date, ' + esc(a.startDate) : '') +
          '. It decides which financial year the adjustment belongs to.') +
      field('dep-disp-proceeds', 'Proceeds ($)',
        '<input id="dep-disp-proceeds" type="number" min="0" step="0.01" inputmode="decimal" value="' +
        esc(dform.proceeds) + '" aria-describedby="dep-disp-proceeds-hint">',
        proceedsHint()) +
      field('dep-disp-reason', 'Reason',
        '<select id="dep-disp-reason"><option value=""' + (dform.reason ? '' : ' selected') + '>Choose (optional)</option>' +
        REASONS.map((r) => '<option' + (r === dform.reason ? ' selected' : '') + '>' + esc(r) + '</option>').join('') +
        /* A stored reason not on the list (typed before the list existed) is
           kept as an option rather than silently dropped on the next save. */
        (dform.reason && REASONS.indexOf(dform.reason) === -1
          ? '<option selected>' + esc(dform.reason) + '</option>' : '') +
        '</select>', '', true) +
      '</div>' +
      /* Not a live region itself — it repaints per keystroke of the proceeds;
         #dep-disp-live speaks it once typing pauses (LSCUtil.announce). */
      '<div class="dep-disp-preview" id="dep-disp-preview"></div>' +
      '<p class="sr-only" id="dep-disp-live" aria-live="polite"></p>' +
      '<div id="dep-modal-error" role="alert"></div>' +
      '<div class="modal-actions">' +
      (already
        ? '<button type="button" class="btn btn-ghost btn-sm dep-disp-undo" id="dep-disp-undo" data-write>Undo disposal</button>'
        : '') +
      '<button type="button" class="btn btn-ghost btn-sm" id="dep-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-accent" id="dep-disp-save" data-write>' +
      '<span class="spinner" id="dep-disp-spin"></span>' +
      '<span id="dep-disp-save-label">' + (already ? 'Save Disposal' : 'Record Disposal') + '</span></button>' +
      '</div></div>'
    );
  }

  function setDisposing(next) {
    saving = next;
    if (!$m('dep-disp-save')) return;
    $m('dep-disp-save').disabled = next;
    $m('dep-cancel').disabled = next;
    if ($m('dep-disp-undo')) $m('dep-disp-undo').disabled = next;
    $m('dep-disp-spin').style.display = next ? 'inline-block' : 'none';
    $m('dep-disp-save-label').textContent = next
      ? 'Saving…'
      : isDisposed(disposing) ? 'Save Disposal' : 'Record Disposal';
  }

  /* One write for record, correct and undo: the whole stored asset with only
     the three disposal fields changed. PUT writes every column (see the
     header), so anything not carried from the stored copy would be blanked. */
  async function writeDisposal(fields, doneText) {
    const asset = disposing;
    setDisposing(true);
    Toast.working('Saving…');
    try {
      await LSCApi.put('/api/depreciation-assets/' + encodeURIComponent(asset.id), Object.assign({}, asset, fields));
      await refreshCache();
      dbaseline = dsnapshot();
      /* Land the schedule on the year the adjustment belongs to, so the tax
         half of what just happened is on screen, not one menu away. */
      if (fields.disposalDate) selectedFy = fyLabel(fields.disposalDate);
      Toast.ok(doneText);
      saving = false;
      closeModal();
      if (!onScreen()) return;
      render();
      /* render() replaced the button closeModal() just focused. Back onto that
         row's button when it's still listed, else the filter that now hides it
         — never <body>, which drops a keyboard user at the top of the page. */
      const again = root.querySelector('[data-dep-dispose="' + asset.id + '"]') || $('dep-show-disposed');
      if (again) again.focus();
    } catch (err) {
      setDisposing(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      const el = $m('dep-modal-error');
      if (el) {
        el.textContent = failureText(err, 'save the disposal');
        el.classList.add('show');
      }
    }
  }

  function saveDisposal() {
    if (saving) return;
    LSCUtil.clearFieldErrors($m('dep-modal-error'));
    const found = disposalProblems();
    if (found.length) {
      LSCUtil.showFieldErrors($m('dep-modal-error'), found);
      return;
    }
    const hidden = !showDisposed && !isDisposed(disposing);
    writeDisposal(
      {
        disposalDate: dform.date,
        disposalProceeds: parseFloat(dform.proceeds),
        disposalReason: dform.reason,
      },
      hidden ? 'Disposal recorded. Tick “Show disposed” to see it in the register.' : 'Disposal saved.'
    );
  }

  function undoDisposal() {
    if (saving) return;
    const a = disposing;
    const reserve = replacementReserveTotal([Object.assign({}, a, { disposalDate: null })]);
    if (
      !window.confirm(
        'Undo the disposal of “' + (a.name || 'this asset') + '”?\n\n' +
          'It goes back to being held: ' +
          (reserve > 0 ? 'your replacement reserve rises by ' + fmt(reserve) + ' a year, which raises every rate, and ' : '') +
          'it returns to the schedules after ' + fyDisplay(fyLabel(a.disposalDate)) + ' with no balancing adjustment.'
      )
    ) return;
    writeDisposal({ disposalDate: null, disposalProceeds: null, disposalReason: '' }, 'Disposal undone.');
  }

  function openDispose(asset, openedBy) {
    disposing = asset;
    editing = null;
    form = null;
    opener = openedBy || null;
    saving = false;
    dform = {
      date: toField(asset.disposalDate),
      proceeds: asset.disposalDate ? toField(asset.disposalProceeds === null ? 0 : asset.disposalProceeds) : '',
      reason: toField(asset.disposalReason),
    };
    dbaseline = dsnapshot();
    lodgedFys = null;

    overlay.innerHTML = disposeMarkup();
    overlay.classList.add('open');
    document.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', onOverlayClick);

    const on = (id, event, key) =>
      $m(id).addEventListener(event, function () {
        dform[key] = this.value;
        refreshDisposalPreview(true);
      });
    on('dep-disp-date', 'input', 'date');
    on('dep-disp-date', 'change', 'date');
    on('dep-disp-proceeds', 'input', 'proceeds');
    on('dep-disp-reason', 'change', 'reason');
    $m('dep-cancel').addEventListener('click', dismissModal);
    $m('dep-disp-save').addEventListener('click', saveDisposal);
    if ($m('dep-disp-undo')) $m('dep-disp-undo').addEventListener('click', undoDisposal);
    refreshDisposalPreview();

    LSCUnsaved.watch('depreciation-disposal', {
      label: 'this disposal',
      onScreen: () => Boolean(overlay && overlay.querySelector('#dep-disp-save')),
      dirty: () => dform !== null && dsnapshot() !== dbaseline,
    });

    /* Which years are lodged, for the warning. Not in LSCData — only this
       dialog asks — so fetched here; until it lands (or if it fails) the
       preview simply has no warning to give. */
    const target = asset;
    LSCApi.get('/api/depreciation-locks')
      .then((reply) => {
        if (disposing !== target) return;
        lodgedFys = new Set((reply.locks || []).map((l) => l.fyLabel));
        refreshDisposalPreview(true);
      })
      .catch(() => {});

    $m('dep-disp-date').focus();
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

  /* Financial years an opening value can be dated to: from the asset's first
     FY (or ten years back, before a start date is entered) to the current one,
     newest first. */
  function openingFyOptions() {
    const current = fyBounds(currentFinancialYear()).startYear;
    const first = form.startDate && fyLabel(form.startDate) ? fyBounds(fyLabel(form.startDate)).startYear : current - 10;
    const chosen = form.openingValueFy || currentFinancialYear();
    let html = '';
    for (let y = current; y >= Math.min(first, current); y -= 1) {
      const label = 'FY' + y + '-' + String((y + 1) % 100).padStart(2, '0');
      html += '<option value="' + label + '"' + (label === chosen ? ' selected' : '') + '>' + esc(fyDisplay(label)) + '</option>';
    }
    return html;
  }

  function inputHtml(id, type, key, attrs, hasHint) {
    return (
      '<input id="' + id + '" type="' + type + '" data-key="' + key + '" value="' + esc(form[key]) + '"' +
      (hasHint ? ' aria-describedby="' + id + '-hint"' : '') + ' ' + (attrs || '') + '>'
    );
  }

  /* What the GST block says depends on Settings' current registration
     — stated, not enforced: an asset bought while registered keeps its credit
     after deregistering, which is exactly why the flag is per asset. */
  function gstNote() {
    const registered = (LSCData.settings().gst || {}).registered === true;
    return registered
      ? 'You’re registered for GST (Settings). If you claimed the GST on this purchase back, tick the ' +
          'box and the cost base is the price less the GST.'
      : 'You’re not registered for GST (Settings), so you normally can’t claim it back — leave the box ' +
          'unticked and the full GST-inclusive price is the cost base. Tick it only if you were registered when ' +
          'you bought it and claimed the credit.';
  }

  /* The car is billed per km (Overhead's cost per km, task 6b), which covers
     its wear and replacement: a Vehicle here as well is charged twice, per km
     and again in every rate through the replacement reserve. A hint, never a
     block — the tax deduction side still wants the car on this register, which
     is exactly why this doesn't refuse it. Category is structural (it
     re-renders the box), so the hint follows it without a handler. */
  function kmHintMarkup() {
    const perKm = LSCCalc.numOrNull(LSCData.goals().vehicleCostPerKm);
    if (perKm === null || perKm < 0) return '';
    return (
      '<div class="field full"><div class="oh-asset-hint" role="note">' +
      '<p><strong>Your car is already billed per km.</strong> Overhead has a cost per km of ' +
      esc(LSCUtil.perKm(perKm)) + ', which covers the car’s wear and replacement. A replacement reserve here ' +
      'would charge for that again in every hourly rate. Keep the car on this register for its tax deduction, ' +
      'but leave Replacement cost blank so nothing is reserved for it — or clear the cost per km. This is only ' +
      'a hint.</p></div></div>'
    );
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
        'Only for gear that was already part-depreciated when you entered it here: its written-down value at the ' +
          'start of the year below. Leave blank and it starts at its cost.') +
      field('dep-opening-fy', 'Opening value is at the start of',
        '<select id="dep-opening-fy" data-key="openingValueFy" aria-describedby="dep-opening-fy-hint">' +
          openingFyOptions() + '</select>',
        'The schedule starts from this year, not from when the asset was first used — the years before it are ' +
          'already in the value you entered.') +
      '</div>' +

      '<h3 class="dep-group">For pricing</h3><div class="form-grid">' +
      // Above the replacement fields it is about (task 6b), for a Vehicle only.
      (form.category === 'vehicle' ? kmHintMarkup() : '') +
      field('dep-cycle', 'Replace every (years)',
        inputHtml('dep-cycle', 'number', 'replacementCycleYears', 'min="0" step="0.5"', true),
        'How long you actually keep one before replacing it.') +
      field('dep-replace', 'Replacement cost ($)',
        inputHtml('dep-replace', 'number', 'replacementCostEstimate', 'min="0" step="1"', true),
        'What the next one will cost, not what this one did.') +
      field('dep-resale', 'Expected resale ($) — optional',
        inputHtml('dep-resale', 'number', 'expectedResaleValue', 'min="0" step="1"', true),
        'What you expect this one to sell for when you replace it. Only the difference needs saving up.') +
      '<p class="oh-hint dep-reserve-line full" id="dep-reserve-line"></p>' +
      '</div>' +
      // The reserve line, spoken once typing pauses — see LSCUtil.announce().
      '<p class="sr-only" id="dep-reserve-live" aria-live="polite"></p>' +

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
        expectedResaleValue: parseFloat(form.expectedResaleValue) || 0,
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

    // The route refuses this too (disposal_before_start); said here on the field.
    if (editing && editing.disposalDate && ymd.test(f.startDate || '') && f.startDate > editing.disposalDate) {
      found.push({
        msg: 'It was disposed of on ' + editing.disposalDate + ', so the start date can’t be after that.',
        field: $m('dep-start'),
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
      ['expectedResaleValue', 'dep-resale', 'Expected resale must be 0 or more, or blank.'],
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
      openingValueFy: f.openingAdjustableValue === '' ? null : f.openingValueFy || null,
      carLimit: f.category === 'vehicle' ? numOrNullText(f.carLimit) : null,
      replacementCycleYears: numOrNullText(f.replacementCycleYears),
      replacementCostEstimate: numOrNullText(f.replacementCostEstimate),
      expectedResaleValue: numOrNullText(f.expectedResaleValue),
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
      const savedId = wasEditing ? editing.id : null; // closeModal() clears `editing`
      saving = false;
      closeModal();
      if (!onScreen()) return;
      render();
      /* An Edit button that opened the dialog was inside what render() just
         replaced, so closeModal() focused a detached node. Back onto that row's
         Edit, else Overhead's "+ Add Asset" — never <body>. The same rule as
         writeDisposal(). An Add opened from the page head keeps its focus:
         that button sits outside this view's root. */
      if (!root.contains(document.activeElement) && document.activeElement !== document.getElementById('oh-add')) {
        const again = (savedId && root.querySelector('[data-dep-edit="' + savedId + '"]')) || document.getElementById('oh-add');
        if (again) again.focus();
      }
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
    disposing = null;
    dform = null;
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
        if (key === 'replacementCostEstimate' || key === 'replacementCycleYears' || key === 'businessUsePct' || key === 'expectedResaleValue') {
          refreshReserveLine();
          LSCUtil.announce($m('dep-reserve-live'), $m('dep-reserve-line').textContent);
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

  function openModal(asset, openedBy, prefill) {
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
      openingValueFy: toField(a.openingValueFy) || currentFinancialYear(),
      replacementCycleYears: toField(a.replacementCycleYears),
      replacementCostEstimate: toField(a.replacementCostEstimate),
      expectedResaleValue: toField(a.expectedResaleValue),
      notes: toField(a.notes),
    };
    baseline = snapshot();
    /* A name carried over from the Operating Costs double-count hint (see
       openAdd). Applied AFTER the baseline on purpose: it is something the
       user typed, on the other form, so closing this one without saving must
       still ask before throwing it away. */
    if (!asset && prefill && prefill.name) form.name = String(prefill.name);

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
    root.querySelectorAll('[data-dep-dispose]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const asset = assets().find((a) => a.id === btn.dataset.depDispose);
        if (asset) openDispose(asset, btn);
      });
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
    const pick = $('dep-decline-asset');
    if (pick) {
      pick.addEventListener('change', () => {
        chartAssetId = pick.value;
        drawDecline();
        LSCUtil.announce($('dep-decline-live'), OverheadCharts.declineAnnouncement(chartAsset()));
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
    bindScheduleBody();
    drawDecline();
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

  /* Overhead's page-head "+ Add Asset" button — and the Operating Costs
     double-count hint's "Track it in Depreciation", which passes the expense's
     name as `prefill.name`. Only the name: the expense's cost was entered
     GST-exclusive, and this form's cost is GST-inclusive, so carrying the
     number across would plant a figure on the wrong basis. */
  function openAdd(openedBy, prefill) {
    openModal(null, openedBy, prefill);
  }

  return { mount, openAdd };
})();
