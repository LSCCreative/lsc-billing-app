'use strict';

/* The Overhead screen — every recurring cost of running the business, and the
 * annual total the Pricing rate card is computed from.
 *
 * WHY THIS SCREEN EXISTS
 * Nothing in the app knew what it cost to keep the business open. The rate card
 * carried per-row numbers somebody had typed once and never revisited, and
 * there was no way to answer "am I charging enough to cover the year." This is
 * the input side of that: expenses in, one annual total out, which
 * overheadRatePerHour() divides by billable capacity to produce the rate every
 * labour row on Pricing now shows.
 *
 * COSTS ARE ENTERED GST-EXCLUSIVE
 * By stated convention and a hint on the Cost field, not by a registered-toggle
 * plus a conversion formula. A GST-registered business claims GST on expenses
 * back as an input tax credit, so it is not a real cost, and including it would
 * overstate the annual total — and therefore the rate, and the minimum job
 * price — by the GST component. A GST-inclusive figure typed in regardless is
 * an accepted risk of the hint-only approach (reconfirmed in the accounting
 * review on 2026-09-15), not an oversight to quietly correct with arithmetic
 * nobody asked for.
 *
 * CATEGORY AND FREQUENCY ARE FIXED ENUMS
 * The database CHECK-constrains both, so the option values below are not a
 * presentation choice — they are the on-the-wire spellings, and a write with
 * anything else fails its constraint. The user-facing labels are separate from
 * them for exactly that reason.
 *
 * EVERY WRITE RE-READS BOTH LISTS
 * POST and PUT answer with the one item they touched and DELETE answers with
 * nothing, but the server also appends an overhead_snapshots row on every one
 * of them and returns the item list in its own sort order. Rather than
 * replicate that sort and that append in the browser — two things that would
 * then have to stay in step with the server forever — a write re-reads both
 * lists and puts them in LSCData. That also keeps the promise resolved decision
 * 19 depends on: the Pricing tab computes its rate from this cache at mount, so
 * a cache left stale here shows a stale rate one click away.
 *
 * TWO INNER TABS: OPERATING COSTS AND DEPRECIATION (2026-09-27)
 * A horizontal .nav-link row under the page head — the pattern the Finance &
 * Price rail vacated, so the area has one navigation idea, not two (IA doc,
 * "Tertiary navigation"). Operating Costs is everything this file already was,
 * unchanged. Depreciation is the capital-asset register in views/depreciation.js
 * (DepreciationView), which renders into #oh-inner and owns its own modal.
 * The page-head button follows the tab: "+ Add Expense" or "+ Add Asset".
 *
 * `handlers.inner` picks the tab on mount: 'depreciation' lands on it — the
 * Dashboard's Replacement reserve link sends exactly that through FinanceView's
 * selectTab(id, opts) — and anything else lands on Operating Costs.
 *
 * THE DOUBLE-COUNT HINT (2026-09-27)
 * A camera entered here as a one-off expense AND on the Depreciation register
 * is counted twice in annualBusinessCost(), inflating every rate, and nothing
 * structural prevents it (IA doc §6). So the Add Expense form says so, softly:
 * a one-off costing more than the user's instant asset write-off threshold
 * (goals.iawoThreshold, owned by the Depreciation tab) shows "this looks like a
 * capital asset", with a way across to Depreciation and a Dismiss.
 *   - A HINT, NOT A RULE. Save is never blocked and problems() doesn't know it
 *     exists — a large one-off that isn't gear (a legal bill, a rebrand) is
 *     real, and the user is the judge.
 *   - NO THRESHOLD, NO HINT. The threshold moves with the federal budget and is
 *     deliberately never built in, so with none saved there is nothing to
 *     compare against; the Depreciation tab's threshold copy says that's what
 *     it's used for.
 *   - ADD ONLY. Editing an existing expense doesn't show it: it was offered when
 *     the expense was added, and "track it in Depreciation" from an edit would
 *     leave the saved expense behind — two records, the exact problem.
 *   - "Track it in Depreciation" discards this unsaved expense without the
 *     usual confirm (choosing to move it IS the answer to that question),
 *     switches to the Depreciation tab and opens Add Asset with the name carried
 *     over — only the name, see DepreciationView.openAdd.
 */

const OverheadView = (() => {
  const { esc, fmt, num } = LSCUtil;
  const { annualisedCost, annualOverheadTotal } = LSCCalc;

  /* value: the spelling the database CHECK accepts. label: what a person reads.
     Keep them apart — the temptation to derive one from the other is how
     'admin_legal' ends up written to the column as 'Admin / Legal'.

     The list order is the dropdown's and the donut's tie-break order. Four
     values joined, and 'marketing' was relabelled, on 2026-09-28 (migration
     v8 widened the CHECK to match): Advertising and marketing is the old
     Marketing, not a second category beside it. Other stays last. */
  const CATEGORIES = [
    { value: 'software', label: 'Software' },
    { value: 'hosting', label: 'Hosting' },
    { value: 'phone_internet', label: 'Mobile phone and internet' },
    { value: 'admin_legal', label: 'Admin / Legal' },
    { value: 'marketing', label: 'Advertising and marketing' },
    { value: 'motor_vehicle', label: 'Motor vehicle expenses' },
    { value: 'home_office', label: 'Home office' },
    { value: 'training', label: 'Training and education' },
    { value: 'tax', label: 'Tax' },
    { value: 'other', label: 'Other' },
  ];
  const FREQUENCIES = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'annual', label: 'Annual' },
    { value: 'one_off', label: 'One-off' },
  ];

  const labelOf = (list, value) => {
    const found = list.find((entry) => entry.value === value);
    // An unrecognised stored value is shown as itself rather than blanked: it
    // means the database holds something this list doesn't know about, and
    // hiding that makes it unfindable.
    return found ? found.label : String(value || '—');
  };

  let root = null;
  let handlers = null;
  let overlay = null;
  let innerTab = 'operating'; // 'operating' | 'depreciation'

  const INNER_TABS = [
    { id: 'operating', label: 'Operating Costs' },
    { id: 'depreciation', label: 'Depreciation' },
  ];

  // Modal state, live only while it is open.
  let form = null;
  let editingId = null; // null = adding
  let saving = false;
  let baseline = '';
  let opener = null; // the control that opened it, to hand focus back to
  let hintDismissed = false; // the double-count hint, for this modal only

  const $ = (id) => root.querySelector('#' + id);
  const $m = (id) => overlay.querySelector('#' + id);
  const items = () => LSCData.overheadItems();
  const snapshots = () => LSCData.overheadSnapshots();

  const failureText = (err, action) =>
    err.kind === 'network'
      ? 'Couldn’t ' + action + ' — the server is unreachable.'
      : 'Couldn’t ' + action + ': ' + (err.message || 'the server refused the request.');

  /* Is this screen still in the page? Writes are async and the sub-tab row
     doesn't wait for them, so an outcome can land after the user has moved on —
     at which point re-rendering would put the expense table back on top of
     whatever replaced it. Asked of the document rather than of `root`, for the
     same reason pricing.js's sentinel is: leaving Finance takes #finance-sub
     out of the document with this screen still inside it, and a detached node
     would still answer its own querySelector. */
  const onScreen = () => Boolean(document.getElementById('oh-table-block'));

  // ── Markup ────────────────────────────────────────────────────────────────

  /* The Summary Card is a .proj-card with its navigation affordances removed —
     no hover accent sweep, no cursor:pointer, no tabindex — because nothing
     happens when you click it. It is a stat display wearing the card's surface
     and border, per the IA doc's Component Reuse Map, not a tile. */
  function summaryMarkup() {
    const annual = annualOverheadTotal(items());
    return (
      '<div class="proj-card oh-summary">' +
      '<div class="oh-stat"><div class="sum-label">Monthly Total</div>' +
      '<div class="oh-stat-value">' + fmt(annual / 12) + '</div></div>' +
      '<div class="oh-stat"><div class="sum-label">Annual Total</div>' +
      '<div class="oh-stat-value">' + fmt(annual) + '</div></div>' +
      '</div>'
    );
  }

  /* data-label on every cell: this is an .est-table, and below 768px
     css/responsive.css hides the head row and prints these beside the values
     instead. Same arrangement as clients.js's history table. */
  function tableMarkup() {
    const list = items();
    const head =
      '<div class="est-block-head"><h2 class="est-block-label">Recurring Costs</h2>' +
      '<span class="est-block-sum" style="color:var(--muted)">' +
      list.length + ' expense' + (list.length !== 1 ? 's' : '') + '</span></div>';

    if (!list.length) {
      return (
        '<div class="est-block" id="oh-table-block">' + head +
        '<p class="oh-empty">No expenses yet. Add the things you pay for whether or not you book ' +
        'work this month — software, insurance, your accountant, hosting — and the annual total ' +
        'above becomes the basis for every rate on your card.</p></div>'
      );
    }

    const rows = list
      .map(
        (item) =>
          '<tr data-id="' + esc(item.id) + '">' +
          '<td data-label="Expense">' + esc(item.name || 'Untitled') + '</td>' +
          '<td class="muted-td" data-label="Category">' + esc(labelOf(CATEGORIES, item.category)) + '</td>' +
          '<td class="right" data-label="Cost">' + fmt(item.cost) + '</td>' +
          '<td class="muted-td" data-label="Frequency">' + esc(labelOf(FREQUENCIES, item.frequency)) + '</td>' +
          '<td class="right" data-label="Monthly Equivalent">' + fmt(annualisedCost(item) / 12) + '</td>' +
          '<td class="oh-act" data-label="">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(item.id) + '"' +
          ' aria-label="Edit ' + esc(item.name || 'this expense') + '">Edit</button>' +
          '<button type="button" class="del-btn" data-del="' + esc(item.id) + '"' +
          ' title="Delete this expense" aria-label="Delete ' + esc(item.name || 'this expense') + '">×</button>' +
          '</td></tr>'
      )
      .join('');

    return (
      '<div class="est-block" id="oh-table-block">' + head +
      '<table class="est-table oh-table"><thead><tr><th>Expense</th><th>Category</th>' +
      '<th class="right">Cost</th><th>Frequency</th>' +
      '<th class="right">Monthly Equivalent</th><th></th></tr></thead><tbody>' +
      rows + '</tbody></table></div>'
    );
  }

  /* Not role="tablist", for the reason finance.js gives for its rail: these
     swap a screen's content, they don't implement ARIA tab keyboarding. */
  function innerNavMarkup() {
    return (
      '<nav class="oh-inner-tabs" aria-label="Overhead sections">' +
      INNER_TABS.map(
        (t) =>
          '<button type="button" class="nav-link' + (t.id === innerTab ? ' active" aria-current="page' : '') +
          '" data-inner-tab="' + t.id + '">' + t.label + '</button>'
      ).join('') +
      '</nav>'
    );
  }

  function headMarkup() {
    const asset = innerTab === 'depreciation';
    return (
      '<div class="page-head"><div><h1 class="page-title">Overhead</h1>' +
      '<div class="page-sub">' +
      (asset
        ? 'The gear the business earns with, and what it costs to keep replacing it'
        : 'What it costs to keep the business open, before any job') +
      '</div></div>' +
      '<button type="button" class="btn btn-accent" id="oh-add" data-write>' +
      (asset ? '+ Add Asset' : '+ Add Expense') + '</button></div>' +
      innerNavMarkup()
    );
  }

  function markup() {
    if (innerTab === 'depreciation') return headMarkup() + '<div id="oh-inner"></div>';
    return (
      headMarkup() +
      summaryMarkup() +
      '<p class="oh-note">Enter costs GST-exclusive. The app assumes you claim GST back on business ' +
      'expenses, so including it would overstate every rate computed from this total.</p>' +
      '<div id="overhead-error" role="alert"></div>' +
      tableMarkup() +
      /* Between the table and the trend, per the IA doc's content order:
         "what's costing me" above "is it getting better or worse", the most
         retrospective content last. CATEGORIES is handed over rather than
         copied into the charts module — these are the spellings the database
         CHECK-constrains, and a second list of them is a second thing to keep
         in step with the migration. */
      OverheadCharts.donutMarkup(items(), CATEGORIES) +
      OverheadCharts.trendMarkup(snapshots())
    );
  }

  // ── Errors on the screen behind the modal ─────────────────────────────────

  function showError(message) {
    const el = $('overhead-error');
    if (!el) return; // left while the request was in flight
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    LSCUtil.clearFieldErrors($('overhead-error'));
  }

  // ── Reading the server back ───────────────────────────────────────────────

  /* Both lists, because every write appends a snapshot as well as changing an
     item — see the header note. Snapshots are set alongside items rather than
     left for the trend chart to fetch itself, because the server wrote them in
     the same transaction: they are one update, not two. */
  async function refreshCache() {
    const [itemsReply, snapshotsReply] = await Promise.all([
      LSCApi.get('/api/overhead-items'),
      LSCApi.get('/api/overhead-snapshots'),
    ]);
    LSCData.setOverheadItems(itemsReply.items || []);
    LSCData.setOverheadSnapshots(snapshotsReply.snapshots || []);
  }

  // ── Deleting ──────────────────────────────────────────────────────────────

  async function remove(id) {
    const item = items().find((entry) => entry.id === id);
    if (!item) return;
    if (
      !window.confirm(
        'Delete “' + (item.name || 'this expense') + '”?\n\n' +
          'Your overhead total drops by ' + fmt(annualisedCost(item)) + ' a year, which changes ' +
          'every rate on your card. Estimates already saved keep the figures they were quoted at.'
      )
    ) return;

    clearError();
    Toast.working('Deleting…');
    try {
      await LSCApi.del('/api/overhead-items/' + encodeURIComponent(id));
      await refreshCache();
      Toast.ok('Expense deleted.');
      if (!onScreen()) return;
      render();
      // The row, and the × that was focused, are gone; see saveItem().
      const again = $('oh-add');
      if (again) again.focus();
    } catch (err) {
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(failureText(err, 'delete that expense'));
    }
  }

  // ── The double-count hint ─────────────────────────────────────────────────

  /* The saved threshold, or null when there isn't one (see the header). */
  function writeOffThreshold() {
    const t = LSCCalc.numOrNull(LSCData.goals().iawoThreshold);
    return t === null || t < 0 ? null : t;
  }

  function assetHintApplies() {
    if (!form || editingId || hintDismissed || form.frequency !== 'one_off') return false;
    const threshold = writeOffThreshold();
    const cost = parseFloat(form.cost);
    return threshold !== null && Number.isFinite(cost) && cost > threshold;
  }

  function assetHintMarkup() {
    if (!assetHintApplies()) return '';
    return (
      '<div class="oh-asset-hint">' +
      '<p><strong>This looks like a capital asset — track it in Depreciation instead?</strong> It’s a one-off ' +
      'over your ' + fmt(writeOffThreshold()) + ' write-off threshold. Gear bought outright belongs on the ' +
      'Depreciation register, where it’s counted once, as a replacement reserve. Entered here as well, it’s ' +
      'counted twice and every rate on your card goes up. If it isn’t gear, carry on — this is only a hint.</p>' +
      '<div class="oh-asset-hint-actions">' +
      '<button type="button" class="btn btn-ghost btn-xs" id="oh-to-asset">Track it in Depreciation</button>' +
      '<button type="button" class="btn btn-ghost btn-xs" id="oh-hint-dismiss">Dismiss</button>' +
      '</div></div>'
    );
  }

  /* Rewritten on each cost keystroke and frequency change. Only this box: the
     fields keep their focus and caret. */
  function refreshAssetHint() {
    const box = $m('oh-asset-hint');
    if (!box) return;
    const next = assetHintMarkup();
    // Unchanged markup is left alone, so the live region doesn't re-announce
    // the same hint on every digit typed.
    if (box.innerHTML !== next) box.innerHTML = next;
  }

  /* The hint's way across. No confirmLeave: choosing to move this expense to
     the register is the answer to "discard it?". The name goes with it. */
  function trackAsAsset() {
    if (saving) return; // closeModal() won't close under an in-flight save
    const name = String(form.name || '').trim();
    closeModal();
    if (!onScreen()) return;
    innerTab = 'depreciation';
    render();
    DepreciationView.openAdd($('oh-add'), name ? { name } : undefined);
  }

  // ── The Add / Edit modal ──────────────────────────────────────────────────

  const snapshot = () => JSON.stringify(form);

  function optionsMarkup(list, selected) {
    return list
      .map(
        (entry) =>
          '<option value="' + esc(entry.value) + '"' +
          (entry.value === selected ? ' selected' : '') + '>' + esc(entry.label) + '</option>'
      )
      .join('');
  }

  function modalMarkup() {
    const title = editingId ? 'Edit Expense' : 'Add Expense';
    return (
      '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="oh-modal-title">' +
      '<h2 class="modal-title" id="oh-modal-title">' + title + '</h2>' +
      '<div class="form-grid">' +
        '<div class="field full"><label for="oh-name">Expense Name</label>' +
        '<input id="oh-name" type="text" placeholder="e.g. Adobe Creative Cloud" value="' +
        esc(form.name) + '"></div>' +
        '<div class="field"><label for="oh-category">Category</label>' +
        '<select id="oh-category">' +
        /* A real placeholder rather than a defaulted first option. Frequency
           below defaults to Monthly because that is what most overhead
           genuinely is and a wrong guess there is visible in the Monthly
           Equivalent column — but there is no majority category, and a silent
           default would file the studio rent under Software for anyone who
           tabbed past it. So this one has to be chosen, and problems() says so
           if it isn't. */
        '<option value="" disabled' + (form.category ? '' : ' selected') + '>Choose a category</option>' +
        optionsMarkup(CATEGORIES, form.category) + '</select></div>' +
        '<div class="field"><label for="oh-frequency">Frequency</label>' +
        '<select id="oh-frequency">' + optionsMarkup(FREQUENCIES, form.frequency) + '</select></div>' +
        '<div class="field full"><label for="oh-cost">Cost ($)</label>' +
        '<input id="oh-cost" type="number" min="0" step="0.01" inputmode="decimal" ' +
        'aria-describedby="oh-cost-hint" placeholder="e.g. 99.00" value="' + esc(form.cost) + '">' +
        '<p class="oh-hint" id="oh-cost-hint">Enter the GST-exclusive amount — the app assumes you ' +
        'claim GST back on business expenses.</p></div>' +
      '</div>' +
      /* Always in the DOM, empty until it applies, so the live region exists
         before its first announcement — a region inserted with its text
         already in it is often not read out. */
      '<div id="oh-asset-hint" aria-live="polite">' + assetHintMarkup() + '</div>' +
      '<div id="oh-modal-error" role="alert"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" id="oh-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-accent" id="oh-save" data-write>' +
        '<span class="spinner" id="oh-spin"></span>' +
        '<span id="oh-save-label">' + (editingId ? 'Save Changes' : 'Add Expense') + '</span>' +
      '</button></div></div>'
    );
  }

  function showModalError(message) {
    const el = $m('oh-modal-error');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
  }

  function clearModalError() {
    LSCUtil.clearFieldErrors($m('oh-modal-error'));
  }

  function problems() {
    const found = [];
    if (!String(form.name || '').trim()) found.push({ msg: 'Give the expense a name.', field: $m('oh-name') });
    if (!form.category) found.push({ msg: 'Pick a category.', field: $m('oh-category') });
    const cost = parseFloat(form.cost);
    // Checked rather than coerced: Number('') is 0, so an empty Cost field would
    // otherwise save as a free expense and quietly drag the annual total down.
    if (!Number.isFinite(cost) || cost < 0) {
      found.push({ msg: 'Cost must be a number of dollars, 0 or more.', field: $m('oh-cost') });
    }
    return found;
  }

  function setSaving(next) {
    saving = next;
    if (!$m('oh-save')) return;
    $m('oh-save').disabled = next;
    $m('oh-cancel').disabled = next;
    $m('oh-spin').style.display = next ? 'inline-block' : 'none';
    $m('oh-save-label').textContent = next
      ? 'Saving…'
      : editingId ? 'Save Changes' : 'Add Expense';
  }

  async function saveItem() {
    if (saving) return;
    clearModalError();

    const found = problems();
    if (found.length) {
      LSCUtil.showFieldErrors($m('oh-modal-error'), found);
      return;
    }

    const body = {
      // Trimmed on the way out only: trimming as the user types eats the space
      // between two words the moment it is pressed.
      name: String(form.name).trim(),
      category: form.category,
      cost: parseFloat(form.cost),
      frequency: form.frequency,
    };

    setSaving(true);
    Toast.working(editingId ? 'Saving expense…' : 'Adding expense…');

    try {
      if (editingId) await LSCApi.put('/api/overhead-items/' + encodeURIComponent(editingId), body);
      else await LSCApi.post('/api/overhead-items', body);
      await refreshCache();
      // Nothing is unsaved any more. close() drops the watcher a moment later
      // anyway; this keeps the two from disagreeing in between.
      baseline = snapshot();
      Toast.ok(editingId ? 'Expense saved.' : 'Expense added.');
      const savedId = editingId; // closeModal() clears it
      saving = false;
      closeModal();
      if (!onScreen()) return;
      render();
      /* render() replaced the button closeModal() just focused — the whole
         screen, "+ Add Expense" included. Back onto that row's Edit, else the
         Add button; never <body>, which drops a keyboard user at the top of
         the page. The same rule as the Dispose dialog in depreciation.js. */
      const again = (savedId && root.querySelector('[data-edit="' + savedId + '"]')) || $('oh-add');
      if (again) again.focus();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      // Left open, edits intact: it lives inside #app-view, so it hides with the
      // rest of the app and comes back when the user signs in again.
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showModalError(failureText(err, editingId ? 'save that expense' : 'add that expense'));
    }
  }

  function onKeydown(event) {
    // Hidden behind the login screen after a lost session: Escape there must not
    // throw away edits being kept for after sign-in, and there is nothing
    // on-screen to trap focus into anyway.
    if (overlay.closest('[hidden]')) return;
    if (event.key === 'Escape' && !saving) return dismissModal();
    LSCModal.trapTab(overlay, event);
  }

  function onOverlayClick(event) {
    // A click that started inside the box and ended on the backdrop doesn't count.
    if (event.target === overlay) dismissModal();
  }

  /* The three ways the modal gets thrown away: Cancel, Escape, and the
     backdrop. closeModal() itself stays unguarded, because a successful save
     calls it too and there is nothing to ask about then. */
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
    editingId = null;
    // Focus would otherwise land on <body>, leaving a keyboard user to tab from
    // the top of the document.
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  }

  function openModal(item, openedBy) {
    editingId = item ? item.id : null;
    opener = openedBy || null;
    saving = false;
    hintDismissed = false;
    form = {
      name: item ? item.name || '' : '',
      category: item ? item.category || '' : '',
      // Held as the string the field shows, not a number: num() would turn a
      // half-typed "1." into 1 under the user's cursor, and an empty field into
      // a 0 that problems() could no longer tell from a deliberate zero.
      cost: item ? String(num(item.cost)) : '',
      frequency: item ? item.frequency || 'monthly' : 'monthly',
    };
    baseline = snapshot();

    overlay.innerHTML = modalMarkup();
    overlay.classList.add('open');
    document.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', onOverlayClick);

    $m('oh-name').addEventListener('input', function () {
      form.name = this.value;
    });
    $m('oh-cost').addEventListener('input', function () {
      form.cost = this.value;
      refreshAssetHint();
    });
    $m('oh-category').addEventListener('change', function () {
      form.category = this.value;
    });
    $m('oh-frequency').addEventListener('change', function () {
      form.frequency = this.value;
      refreshAssetHint();
    });
    // Delegated: the hint's buttons come and go with refreshAssetHint().
    $m('oh-asset-hint').addEventListener('click', (event) => {
      if (event.target.closest('#oh-to-asset')) return trackAsAsset();
      if (event.target.closest('#oh-hint-dismiss')) {
        hintDismissed = true;
        refreshAssetHint();
        // The button that had focus has just gone; the field the hint was about is next.
        $m('oh-cost').focus();
      }
    });
    $m('oh-cancel').addEventListener('click', dismissModal);
    $m('oh-save').addEventListener('click', saveItem);

    /* The sub-tab itself registers no watcher — the IA doc is explicit that
       Overhead's edits live in a modal that resolves on its own close — but the
       modal registers one while it is open, exactly as Invoice Settings does,
       so Cancel/Escape/backdrop ask before discarding a half-filled form. */
    LSCUnsaved.watch('overhead-item', {
      label: editingId ? 'this expense' : 'this new expense',
      onScreen: () => Boolean(overlay && overlay.querySelector('#oh-save')),
      dirty: () => snapshot() !== baseline,
    });

    $m('oh-name').focus();
  }

  // ── Mounting ──────────────────────────────────────────────────────────────

  /* Switching inner tabs replaces the content below the row, so it asks the
     same question every other screen swap does — the Depreciation tab's
     write-off threshold field registers a watcher. Re-selecting the current
     tab does nothing. */
  function selectInner(id) {
    if (id === innerTab || !INNER_TABS.some((t) => t.id === id)) return;
    if (!LSCUnsaved.confirmLeave()) return;
    innerTab = id;
    render();
    const btn = root.querySelector('[data-inner-tab="' + id + '"]');
    if (btn) btn.focus();
  }

  function bind() {
    root.querySelectorAll('[data-inner-tab]').forEach((btn) => {
      btn.addEventListener('click', () => selectInner(btn.dataset.innerTab));
    });
    if (innerTab === 'depreciation') {
      $('oh-add').addEventListener('click', (event) => DepreciationView.openAdd(event.currentTarget));
      return;
    }
    $('oh-add').addEventListener('click', (event) => openModal(null, event.currentTarget));
    root.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = items().find((entry) => entry.id === btn.dataset.edit);
        if (item) openModal(item, btn);
      });
    });
    root.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => remove(btn.dataset.del));
    });
  }

  function render() {
    root.innerHTML = markup();
    if (innerTab === 'depreciation') {
      DepreciationView.mount($('oh-inner'), handlers);
      bind();
      return;
    }
    // After the markup is in the document, not before: the chart is drawn at
    // the container's measured pixel width, which a detached div doesn't have.
    OverheadCharts.drawTrend(snapshots());
    bind();
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    overlay = document.getElementById('modal-overhead-item');
    saving = false;
    innerTab = handlers.inner === 'depreciation' ? 'depreciation' : 'operating';
    // Reads the cache when it fires rather than closing over today's list, so a
    // resize after a write redraws the chart the screen is actually showing.
    OverheadCharts.bindResize(snapshots);
    render();
  }

  return { mount };
})();
