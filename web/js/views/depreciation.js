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
 */

const DepreciationView = (() => {
  const { esc, fmt, num } = LSCUtil;
  const { replacementReserveTotal, currentFinancialYear, fyDisplay } = LSCCalc;

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
      '<table class="est-table oh-table dep-table"><thead><tr><th>Asset</th><th>Category</th>' +
      '<th>Start date</th><th class="right">Cost (inc GST)</th><th>Method</th>' +
      '<th class="right">Business use</th><th class="right">Replacement reserve / yr</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>'
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

  function markup() {
    return (
      summaryMarkup() +
      '<div id="dep-error" role="alert"></div>' +
      registerMarkup() +
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
  }

  function render() {
    root.innerHTML = markup();
    bind();
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    overlay = document.getElementById('modal-depreciation-asset');
    iawoSaved = toField(LSCData.goals().iawoThreshold);
    iawoRaw = iawoSaved;
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
