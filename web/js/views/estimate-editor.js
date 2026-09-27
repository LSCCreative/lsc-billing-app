'use strict';

/* The estimate editor, ported from renderForm and its row builders.
 *
 * TOTALS
 * The summary bar is produced by LSCCalc.computeTotals — the same file the
 * server runs (see the note at the bottom of calc.js). The desktop app had its
 * own arithmetic inline here, and it was wrong in the two ways the plan set out
 * to fix: no GST, and a "Gross Profit" that counted pass-through costs as
 * margin. Reproducing it in the browser would have put those bugs back and let
 * the editor disagree with the record the server stores. Nothing in this file
 * computes a headline figure; it collects rows and asks calc.js.
 *
 * Per-row and per-section figures come from rows.js, which follows calc.js's
 * lookup rule so the rows always add up to the total under them.
 *
 * THE MINIMUM JOB PRICE IS ADVISORY AND MUST STAY THAT WAY
 * The floor under the summary bar is a second opinion, never a price. It is
 * computed by LSCCalc.minimumJobPrice() from the current Overhead Rate/hr and
 * Target Profit Margin, it is not persisted with the estimate, and neither it
 * nor its toggle is allowed to move clientPriceExGst or totalIncGst by a cent
 * in either position. Everything it needs is read off the totals computeTotals
 * already returned — it never recomputes a headline figure of its own. The (?)
 * beside it opens the cost breakdown dialog, which shows the three lines that
 * make up that figure and likewise computes nothing of its own.
 *
 * CLIENT FIELDS
 * The estimate carries a client *snapshot* — {businessName, contactName, email,
 * phone, abn, address} — not the desktop app's flat businessName/clientName/
 * clientEmail. All six are on the form (the old one had three), because the
 * invoice prints the client's ABN and nothing should print that this screen
 * didn't show. Business Name is a typeahead over the client list; a pick fills
 * the fields and links the estimate to that record (clientId). Details flow one
 * way — client list into estimate — and are copied at save time, so editing a
 * client later never rewrites a quote already sent.
 */

const EstimateEditor = (() => {
  const { fmt, esc, today, num, abnDigits, abnValid, abnFormat } = LSCUtil;
  const { sectionsFor, labourDef, travelDef, labourBill, travelBill, costBill } = LSCRows;

  let root = null;
  let handlers = null;
  let existing = null; // the estimate being edited, or null for a new one
  let sections = []; // labour categories this form was built from
  let rowCounter = 0;
  let saving = false;
  let link = null; // { id, name } of the client record this estimate points at
  let baseline = ''; // the form as it was at mount, for the unsaved-edit check

  /* The two Finance figures the advisory floor is built from, resolved once at
     mount. Same reasoning as pricing.js's computedRate: nothing reachable from
     this screen can change an overhead item or a goal — the only screens that
     can are the Finance sub-tabs, and getting to one means leaving this editor,
     which re-mounts it on the way back. They are deliberately outside
     payload(), so they are never saved and never make the form look dirty. */
  let overheadRate = null;
  let profitMarginPct = null;

  /* The cost breakdown modal. `breakdown` is the last set of figures the
     Minimum Job Price line painted — see setBreakdown() for why the modal reads
     that rather than working them out again — and is null whenever the floor
     could not be computed, which is also when the (?) is hidden. */
  let breakdownOverlay = null;
  let breakdown = null;
  let breakdownOpener = null; // the control that opened it, to hand focus back to

  const rid = () => 'r' + ++rowCounter;
  const $ = (id) => root.querySelector('#' + id);

  /* Is this editor still the screen on #main? A save or delete is async and the
     nav doesn't wait for it, so its outcome can land after the user has gone
     somewhere else — at which point neither the form's fields nor its error
     region exist any more, and following through would yank them off the screen
     they chose. Same sentinel idea as refreshTotals below. */
  const onScreen = () => Boolean(root && root.querySelector('#f-upid'));

  const gstRegistered = () => ((LSCData.settings().gst || {}).registered === true);

  /* The estimate's own GST treatment. The checkbox only exists when the business
     is registered, so when it is absent the stored value stands rather than
     defaulting to false — switching GST off account-wide should not silently
     erase which jobs were quoted GST-free. */
  const gstFreeNow = () => {
    const box = $('f-gstfree');
    return box ? box.checked : !!(existing && existing.gstFree);
  };

  // ── Row builders ──────────────────────────────────────────────────────────

  /* Every cell carries data-label, matching its column heading in the .gt-head
     above it. Below 768px the grid stops being a table: .gt-head is hidden and
     css/responsive.css prints each cell's data-label beside its value, so a row
     reads as a stacked list instead of six columns squeezed into 335px. The
     labels have to be per cell rather than generated from nth-child, because
     three sections share .expense-grid with different headings (Travel is
     "Qty / Cost", crew is "Days"/"Day Rate", equipment is "Days"/"Cost/Day").
     Inert above 768px: nothing reads the attribute there. */

  /* No Rate column on labour rows (2026-09-21). A row's stored `rate` has been
     inert since the Finance track made the Pricing screen show one computed
     Overhead Rate/hr for every labour row — nothing prices off it — so printing
     it here contradicted Pricing on the same data. Travel rows keep theirs: a
     travel rate is still entered by hand. The same column is gone from
     estimate-detail.js. */
  function buildLabourRow(section, def, line) {
    const tr = document.createElement('div');
    tr.className = 'gt-row labour-grid';
    tr.dataset.rid = rid();
    tr.dataset.section = section.id;
    tr.dataset.name = line.name;

    const custom = def && def.customBill;
    const customCell = custom
      ? '<input class="num-inp custom-bill-inp" type="number" min="0" step="0.01" value="' +
        (line.override || '') + '" title="Override bill ($)" aria-label="Override bill for ' + esc(line.name) + '">'
      : '';

    tr.innerHTML =
      '<div data-label="Service">' + esc(line.name) + '</div>' +
      '<div class="right" data-label="Hours"><input class="num-inp qty-inp" type="number" min="0" step="0.5" value="' +
      (line.qty || '') + '" aria-label="Hours for ' + esc(line.name) + '"></div>' +
      '<div class="right muted-td" data-label="Mark-Up">' + (def ? fmt(def.mu) : '—') + '</div>' +
      '<div class="right" data-label="Client Bill"><span class="bill-cell">—</span>' + customCell + '</div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove ' +
      esc(line.name) + '" aria-label="Remove ' + esc(line.name) + '">×</button></div>';

    bindRow(tr, ['.qty-inp', '.custom-bill-inp']);
    return tr;
  }

  function buildTravelRow(def, line) {
    const tr = document.createElement('div');
    tr.className = 'gt-row expense-grid';
    tr.dataset.rid = rid();
    tr.dataset.name = line.name;

    const rateLabel = !def ? '—' : def.directCost ? 'Direct' : def.rate > 0 ? fmt(def.rate) : '—';
    const muLabel = !def ? '—' : def.directCost ? '—' : def.mu !== def.rate ? fmt(def.mu) : 'None';

    tr.innerHTML =
      '<div data-label="Service">' + esc(line.name) + '</div>' +
      '<div class="right" data-label="Qty / Cost"><input class="num-inp qty-inp" type="number" min="0" step="0.01" value="' +
      (line.qty || '') + '" aria-label="Quantity for ' + esc(line.name) + '"></div>' +
      '<div class="right muted-td" data-label="Rate">' + rateLabel + '</div>' +
      '<div class="right muted-td" data-label="Mark-Up">' + muLabel + '</div>' +
      '<div class="right" data-label="Client Bill"><span class="bill-cell">—</span></div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove ' +
      esc(line.name) + '" aria-label="Remove ' + esc(line.name) + '">×</button></div>';

    bindRow(tr, ['.qty-inp']);
    return tr;
  }

  /* Equipment and crew are the same shape — a free-text name, days, and a cost
     per day — and bill identically. One builder, two labels. */
  function buildCostRow(kind, line) {
    const isEquip = kind === 'equip';
    const nameClass = isEquip ? 'vendor-inp' : 'role-inp';
    const placeholder = isEquip ? 'Vendor / item name' : 'Role / contractor name';
    const label = isEquip ? 'Vendor or item' : 'Role or contractor';
    const value = isEquip ? line.vendor : line.role;
    // Must match costSectionMarkup's `columns` for this kind — the stacked
    // mobile row prints these in place of the headings it hides.
    const nameCol = isEquip ? 'Vendor / Item' : 'Role / Name';
    const costCol = isEquip ? 'Cost/Day' : 'Day Rate';

    const tr = document.createElement('div');
    tr.className = 'gt-row expense-grid';
    tr.dataset.rid = rid();

    tr.innerHTML =
      '<div data-label="' + nameCol + '"><input class="text-inp ' + nameClass + '" type="text" value="' + esc(value || '') +
      '" placeholder="' + placeholder + '" aria-label="' + label + '"></div>' +
      '<div class="right" data-label="Days"><input class="num-inp days-inp" type="number" min="0" step="0.5" value="' +
      (line.days || '') + '" aria-label="Days"></div>' +
      '<div class="right" data-label="' + costCol + '"><input class="num-inp cost-inp" type="number" min="0" step="0.01" value="' +
      (line.cost || '') + '" aria-label="Cost per day"></div>' +
      '<div class="right muted-td mu-cell">—</div>' +
      '<div class="right" data-label="Total"><span class="bill-cell">—</span></div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove" aria-label="Remove row">×</button></div>';

    bindRow(tr, ['.days-inp', '.cost-inp']);
    return tr;
  }

  function buildDeliverableRow(line) {
    const tr = document.createElement('div');
    tr.className = 'gt-row deliv-grid';
    tr.dataset.rid = rid();

    tr.innerHTML =
      '<div data-label="Deliverable Name"><input class="deliv-name-inp text-inp" type="text" placeholder="e.g. Hero Video" value="' +
      esc(line.name || '') + '" aria-label="Deliverable name"></div>' +
      '<div data-label="Format / Aspect Ratio"><input class="deliv-fmt-inp text-inp" type="text" placeholder="e.g. 16:9 4K" value="' +
      esc(line.format || '') + '" aria-label="Format"></div>' +
      '<div data-label="Duration / Length"><input class="deliv-dur-inp text-inp" type="text" placeholder="e.g. 60 sec" value="' +
      esc(line.duration || '') + '" aria-label="Duration"></div>' +
      '<div class="right" data-label="Qty"><input class="deliv-qty-inp num-inp" type="number" min="0" value="' +
      (line.qty || 1) + '" aria-label="Quantity"></div>' +
      '<div class="del-cell"><button type="button" class="del-btn" title="Remove" aria-label="Remove deliverable">×</button></div>';

    bindRow(tr, []);
    return tr;
  }

  function bindRow(tr, inputSelectors) {
    inputSelectors.forEach((selector) => {
      const input = tr.querySelector(selector);
      if (!input) return;
      // Ported from the desktop app: a field showing 0 clears on focus, so the
      // first keystroke doesn't produce "05".
      input.addEventListener('focus', function () {
        if (this.value === '0' || parseFloat(this.value) === 0) this.value = '';
      });
      input.addEventListener('input', recalc);
    });
    tr.querySelector('.del-btn').addEventListener('click', () => removeRow(tr));
  }

  function removeRow(tr) {
    const body = tr.parentNode;
    if (!body) return;
    const emptyText = body.dataset.emptyText;
    tr.remove();
    if (!body.querySelector('[data-rid]')) {
      const empty = document.createElement('div');
      empty.className = 'empty-row';
      empty.textContent = emptyText;
      body.appendChild(empty);
    }
    recalc();
  }

  function injectRow(body, tr) {
    if (!body) return;
    const empty = body.querySelector('.empty-row');
    if (empty) empty.remove();
    body.appendChild(tr);
    recalc();
  }

  // ── Section markup ────────────────────────────────────────────────────────

  function bodyMarkup(id, emptyText) {
    return (
      '<div class="gt-body" id="tbody-' + esc(id) + '" data-empty-text="' + esc(emptyText) + '">' +
      '<div class="empty-row">' + esc(emptyText) + '</div></div>'
    );
  }

  function labourSectionMarkup(section) {
    const options = section.rows.length
      ? section.rows.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + '</option>').join('')
      : '<option value="">No services in this category — add one under Pricing</option>';

    // An archived category has no picker: its services are gone from the rate
    // card, so there is nothing left to add. Existing rows stay visible and
    // removable.
    const picker = section.archived
      ? ''
      : '<div class="bb-picker"><select class="svc-select" id="sel-' + esc(section.id) +
        '" aria-label="Service to add to ' + esc(section.label) + '">' + options + '</select>' +
        '<button type="button" class="btn btn-accent btn-sm" id="add-' + esc(section.id) + '">+ Add Service</button></div>';

    const tag = section.archived
      ? '<span class="bb-label-tag">No longer on the rate card</span>'
      : '<span class="bb-label-tag">Labour</span>';

    return (
      '<div class="billing-block">' +
      '<div class="bb-head"><div><h2 class="bb-label">' + esc(section.label) + '</h2>' + tag + '</div>' +
      '<span class="bb-sum">Subtotal <b id="sum-' + esc(section.id) + '">$0.00</b></span></div>' +
      picker +
      '<div class="gt-head labour-grid"><div>Service</div><div class="right">Hours</div>' +
      '<div class="right">Mark-Up</div><div class="right">Client Bill</div><div></div></div>' +
      bodyMarkup(section.id, 'No services added. Use the selector above to add one.') +
      '</div>'
    );
  }

  function travelSectionMarkup(pricing) {
    const defs = (pricing && pricing.travelRows) || [];
    const options = defs.length
      ? defs.map((r) => '<option value="' + esc(r.name) + '">' + esc(r.name) + '</option>').join('')
      : '<option value="">No items — add one under Pricing</option>';

    return (
      '<div class="billing-block">' +
      '<div class="bb-head"><div><h2 class="bb-label">Travel &amp; Accommodation</h2>' +
      '<span class="bb-label-tag">Expenses</span></div>' +
      '<span class="bb-sum">Subtotal <b id="sum-travel">$0.00</b></span></div>' +
      '<div class="bb-picker"><select class="svc-select" id="sel-travel" aria-label="Travel item to add">' +
      options + '</select>' +
      '<button type="button" class="btn btn-accent btn-sm" id="add-travel">+ Add Item</button></div>' +
      '<div class="gt-head expense-grid"><div>Service</div><div class="right">Qty / Cost</div>' +
      '<div class="right">Rate</div><div class="right">Mark-Up</div><div class="right">Client Bill</div><div></div></div>' +
      bodyMarkup('travel', 'No items added. Use the selector above to add one.') +
      '</div>'
    );
  }

  function costSectionMarkup(kind, label, addLabel, columns, emptyText) {
    return (
      '<div class="billing-block">' +
      '<div class="bb-head"><div><h2 class="bb-label">' + label + '</h2>' +
      '<span class="bb-label-tag">Expenses</span></div>' +
      '<span class="bb-sum">Subtotal <b id="sum-' + kind + '">$0.00</b></span></div>' +
      '<div class="bb-picker"><button type="button" class="btn btn-accent btn-sm" id="add-' + kind + '">' +
      addLabel + '</button></div>' +
      '<div class="gt-head expense-grid"><div>' + columns[0] + '</div><div class="right">' + columns[1] +
      '</div><div class="right">' + columns[2] + '</div><div class="right">—</div>' +
      '<div class="right">Total</div><div></div></div>' +
      bodyMarkup(kind, emptyText) +
      '</div>'
    );
  }

  function deliverablesSectionMarkup() {
    return (
      '<div class="billing-block" id="block-deliverables">' +
      '<div class="bb-head"><div><h2 class="bb-label">Deliverables</h2>' +
      '<span class="bb-label-tag">PROJECT OUTPUT</span></div>' +
      '<button type="button" class="btn btn-accent btn-sm" id="add-deliverables">+ Add Deliverable</button></div>' +
      '<div class="gt-head deliv-grid"><div>Deliverable Name</div><div>Format / Aspect Ratio</div>' +
      '<div>Duration / Length</div><div class="right">Qty</div><div></div></div>' +
      bodyMarkup('deliverables', 'No deliverables added yet — click “+ Add Deliverable” above.') +
      '</div>'
    );
  }

  /* The corrected money model (BILLING_APP_PLAN.md §1.2). The old bar read
     Hours / Labour / Expenses / Net Invoice / Internal Tax, with Gross Profit
     below it; "Net Invoice" was pre-GST and "Gross Profit" counted pass-through
     as margin. Same two-bar shape, honest labels. */
  /* The app's existing switch idiom — a <label> wrapping a checkbox and a
     <span>, exactly as .doc-gst-free and settings' .set-check do it. The brief
     asks for "an inline switch"; building a new sliding-pill control for it
     would be the one place in the app that has one. */
  function overheadToggleMarkup() {
    return (
      '<div class="mjp-toggle-row">' +
      '<label class="mjp-toggle" for="f-include-overhead">' +
      '<input type="checkbox" id="f-include-overhead" checked ' +
      'aria-describedby="mjp-toggle-hint">' +
      '<span>Include Overhead &amp; Profit Margin in Calculation</span></label>' +
      '<span class="mjp-toggle-hint" id="mjp-toggle-hint">Advisory only — it never changes what ' +
      'the client is billed.</span></div>'
    );
  }

  /* Hidden rather than rebuilt when the toggle is off. The brief asks for the
     line to be "removed entirely", and [hidden] takes it out of the
     accessibility tree as well as off the screen — which an opacity or a
     visibility rule would not. estimates.css carries the [hidden] display rule
     it needs, because a display:flex on the class would otherwise beat the
     browser's own [hidden] default. */
  /* The figure and its (?) are wrapped together rather than sitting as two more
     children of .mjp-line, because the row's 12px column gap is the spacing
     between label, figure and note — and the trigger belongs to the figure, not
     beside it at the same distance. The wrapper carries its own 8px instead.

     The trigger starts hidden and paintMinimum() reveals it only for a real
     floor: there is no breakdown to show of a figure that could not be
     computed, and a (?) that opens a modal of em dashes is worse than no (?).
     Per the IA doc's flow, the unset state stays a plain sentence. */
  function minimumLineMarkup() {
    return (
      '<div class="mjp-line" id="mjp-line">' +
      '<span class="mjp-line-label">Minimum Job Price</span>' +
      '<span class="mjp-line-fig">' +
      '<span class="mjp-line-value" id="s-min-price">—</span>' +
      '<button type="button" class="mjp-help" id="mjp-help" hidden ' +
      'aria-haspopup="dialog" aria-label="How the Minimum Job Price is calculated">' +
      '<span aria-hidden="true">?</span></button>' +
      '</span>' +
      '<span class="mjp-line-note" id="s-min-note"></span>' +
      '</div>'
    );
  }

  function summaryMarkup() {
    return (
      overheadToggleMarkup() +
      '<div class="summary-bar">' +
      '<div class="sum-item"><div class="sum-label">Total Hours</div><div class="sum-value" id="s-hours">0</div></div>' +
      '<div class="sum-item"><div class="sum-label">Labour Subtotal</div><div class="sum-value" id="s-labour">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Expenses Subtotal</div><div class="sum-value" id="s-expenses">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Client Price (ex GST)</div><div class="sum-value" id="s-client-price">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">GST</div><div class="sum-value" id="s-gst" style="font-size:15px">$0.00</div></div>' +
      '</div>' +
      '<div class="summary-bar" style="margin-bottom:24px">' +
      /* The two-column spans are a class, not the inline style they used to be:
         the mobile band stacks this bar into one column, and an inline
         grid-column would have needed !important to undo — which would then be
         undoable by nothing. Identical at every other width. */
      '<div class="sum-item sum-span2" style="background:rgba(184,84,68,0.08);border:1px solid rgba(184,84,68,0.3)">' +
      '<div class="sum-label sum-label-strong">Total (inc GST)</div>' +
      '<div class="sum-value accent" id="s-total">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Tax Set-Aside</div>' +
      '<div class="sum-value" id="s-tax" style="font-size:15px">$0.00</div></div>' +
      '<div class="sum-item sum-span2">' +
      '<div class="sum-label">Est. Take-Home <span class="sum-label-note">(labour revenue ex GST, less set-aside — pass-through excluded)</span></div>' +
      '<div class="sum-value" id="s-takehome" style="color:var(--ok)">$0.00</div></div>' +
      '</div>' +
      /* Under the bars, not inside them: a sixth .sum-item would read as one
         more headline figure, and this one is explicitly not that. */
      minimumLineMarkup()
    );
  }

  function formMarkup(estimate, pricing) {
    const client = (estimate && estimate.client) || {};
    const isInvoice = estimate && estimate.docType === 'invoice';

    let html =
      '<button class="back-btn" id="js-back">← Back</button>' +
      '<div class="page-head"><div><h1 class="page-title">' +
      (estimate ? 'Edit Estimate' : 'New Estimate') + '</h1>' +
      '<div class="page-sub">Select services from each category to build your estimate</div></div></div>' +
      '<div class="form-grid">' +
      '<div class="field full"><label for="f-upid" class="label-accent">UPID — Unique Project Identifier *</label>' +
      '<input id="f-upid" type="text" value="' + esc(estimate ? estimate.upid : '') + '"></div>' +
      '<div class="field"><label for="f-name">Project Name *</label>' +
      '<input id="f-name" type="text" value="' + esc(estimate ? estimate.name : '') + '"></div>' +
      '<div class="field"><label for="f-date">Date</label>' +
      '<input id="f-date" type="date" value="' + esc(estimate ? estimate.date : today()) + '"></div>' +
      '<div class="field client-field"><label for="f-business">Business Name</label>' +
      '<input id="f-business" type="text" value="' + esc(client.businessName || '') + '">' +
      '<div class="client-link-status">' +
      '<span id="client-linked" hidden>From your client list</span>' +
      '<label class="client-save-toggle" id="client-save-wrap" hidden>' +
      '<input type="checkbox" id="f-saveclient" checked><span>Save to client list</span></label>' +
      '</div></div>' +
      '<div class="field"><label for="f-contact">Client Name</label>' +
      '<input id="f-contact" type="text" value="' + esc(client.contactName || '') + '"></div>' +
      '<div class="field"><label for="f-email">Client Email</label>' +
      '<input id="f-email" type="email" value="' + esc(client.email || '') + '"></div>' +
      '<div class="field"><label for="f-phone">Client Phone</label>' +
      '<input id="f-phone" type="tel" value="' + esc(client.phone || '') + '"></div>' +
      '<div class="field"><label for="f-abn">Client ABN</label>' +
      '<input id="f-abn" type="text" inputmode="numeric" value="' + esc(abnFormat(client.abn)) + '"></div>' +
      '<div class="field"><label for="f-address">Client Address</label>' +
      '<input id="f-address" type="text" value="' + esc(client.address || '') + '"></div>' +
      '<div class="field full"><label for="f-notes">Internal Notes</label>' +
      '<textarea id="f-notes">' + esc(estimate ? estimate.notes : '') + '</textarea></div>' +
      '</div>' +
      '<div class="doc-type-bar">' +
      '<label class="doc-type-label" for="f-doctype">Document Type</label>' +
      '<select class="doc-type-select" id="f-doctype">' +
      '<option value="estimate"' + (isInvoice ? '' : ' selected') + '>Estimate</option>' +
      '<option value="invoice"' + (isInvoice ? ' selected' : '') + '>Invoice</option>' +
      '</select>' +
      '<div class="inv-num-wrap' + (isInvoice ? ' show' : '') + '" id="inv-num-wrap">' +
      '<label for="f-invnum" class="label-accent" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em">Invoice #</label>' +
      '<input class="inv-num-inp" id="f-invnum" type="text" placeholder="e.g. INV-001" value="' +
      esc((estimate && estimate.invoiceNumber) || '') + '">' +
      '</div>' +
      /* Only offered when the business is registered — for an unregistered one
         GST never applies, so the toggle would be a control that does nothing.
         An estimate's stored flag is preserved rather than cleared when it isn't
         rendered; see payload(). */
      (gstRegistered()
        ? '<label class="doc-gst-free" title="No GST on this job — the rate card is what the client pays">' +
          '<input type="checkbox" id="f-gstfree"' +
          (estimate && estimate.gstFree ? ' checked' : '') + '><span>GST-free job</span></label>'
        : '') +
      '</div>';

    html += deliverablesSectionMarkup();
    sections.forEach((section) => {
      html += labourSectionMarkup(section);
    });
    html += travelSectionMarkup(pricing);
    html += costSectionMarkup('crew', 'External Crew &amp; Contracts', '+ Add Crew Member',
      ['Role / Name', 'Days', 'Day Rate'], 'No crew added. Click above to add a member.');
    html += costSectionMarkup('equip', 'Equipment Hire', '+ Add Equipment Item',
      ['Vendor / Item', 'Days', 'Cost/Day'], 'No equipment added. Click above to add an item.');

    html += summaryMarkup();

    html +=
      '<div id="editor-error" role="alert"></div>' +
      '<div class="form-actions">' +
      (estimate ? '<button type="button" class="btn btn-danger btn-sm" id="js-delete" data-write>Delete</button>' : '') +
      '<button type="button" class="btn btn-ghost" id="js-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-accent" id="js-save" data-write>' +
      '<span class="spinner" id="save-spin"></span><span id="save-label">Save Estimate</span></button>' +
      '</div>';

    return html;
  }

  // ── Reading the form back ─────────────────────────────────────────────────

  function rowsIn(id) {
    const body = $('tbody-' + id);
    return body ? Array.from(body.querySelectorAll('[data-rid]')) : [];
  }

  function inputValue(tr, selector) {
    const input = tr.querySelector(selector);
    return input ? input.value : '';
  }

  function collect() {
    const activeRows = { travel: [], equip: [], crew: [], deliverables: [] };

    sections.forEach((section) => {
      activeRows[section.id] = rowsIn(section.id).map((tr) => ({
        name: tr.dataset.name,
        qty: num(inputValue(tr, '.qty-inp')),
        override: num(inputValue(tr, '.custom-bill-inp')),
      }));
    });

    activeRows.travel = rowsIn('travel').map((tr) => ({
      name: tr.dataset.name,
      qty: num(inputValue(tr, '.qty-inp')),
    }));

    activeRows.crew = rowsIn('crew').map((tr) => ({
      role: inputValue(tr, '.role-inp'),
      days: num(inputValue(tr, '.days-inp')),
      cost: num(inputValue(tr, '.cost-inp')),
    }));

    activeRows.equip = rowsIn('equip').map((tr) => ({
      vendor: inputValue(tr, '.vendor-inp'),
      days: num(inputValue(tr, '.days-inp')),
      cost: num(inputValue(tr, '.cost-inp')),
    }));

    activeRows.deliverables = rowsIn('deliverables').map((tr) => ({
      name: inputValue(tr, '.deliv-name-inp'),
      format: inputValue(tr, '.deliv-fmt-inp'),
      duration: inputValue(tr, '.deliv-dur-inp'),
      qty: num(inputValue(tr, '.deliv-qty-inp')) || 1,
    }));

    return activeRows;
  }

  // ── Live totals ───────────────────────────────────────────────────────────

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function paintRow(tr, bill) {
    const cell = tr.querySelector('.bill-cell');
    if (cell) cell.textContent = bill === null ? '—' : fmt(bill);
    return bill === null ? 0 : bill;
  }

  function recalc() {
    const pricing = LSCData.pricing();

    sections.forEach((section) => {
      let subtotal = 0;
      rowsIn(section.id).forEach((tr) => {
        const line = {
          name: tr.dataset.name,
          qty: num(inputValue(tr, '.qty-inp')),
          override: num(inputValue(tr, '.custom-bill-inp')),
        };
        subtotal += paintRow(tr, labourBill(labourDef(section, line), line));
      });
      setText('sum-' + section.id, fmt(subtotal));
    });

    let travelSubtotal = 0;
    rowsIn('travel').forEach((tr) => {
      const line = { name: tr.dataset.name, qty: num(inputValue(tr, '.qty-inp')) };
      travelSubtotal += paintRow(tr, travelBill(travelDef(line, pricing), line));
    });
    setText('sum-travel', fmt(travelSubtotal));

    ['crew', 'equip'].forEach((kind) => {
      let subtotal = 0;
      rowsIn(kind).forEach((tr) => {
        const line = {
          days: num(inputValue(tr, '.days-inp')),
          cost: num(inputValue(tr, '.cost-inp')),
        };
        subtotal += paintRow(tr, costBill(line));
      });
      setText('sum-' + kind, fmt(subtotal));
    });

    // The headline figures, from the same code the server will run on save.
    const totals = LSCCalc.computeTotals(collect(), pricing, LSCData.settings(), {
      gstFree: gstFreeNow(),
    });
    setText('s-hours', totals.totalHours);
    setText('s-labour', fmt(totals.labourTotal));
    setText('s-expenses', fmt(totals.expenseTotal));
    setText('s-client-price', fmt(totals.clientPriceExGst));
    setText('s-gst', fmt(totals.gst));
    setText('s-total', fmt(totals.totalIncGst));
    setText('s-tax', fmt(totals.taxSetAside));
    setText('s-takehome', fmt(totals.estTakeHome));

    // Reads the totals above rather than recomputing anything of its own.
    paintMinimum(totals);
  }

  const includeOverheadNow = () => {
    const box = $('f-include-overhead');
    // Defaults ON, per the brief — including for the instant before bind() runs.
    return box ? box.checked : true;
  };

  /* The advisory floor. Everything here is display: the arithmetic is
     minimumJobPrice()'s, and the inputs are the totals computeTotals just
     returned. directJobCosts is expenseTotal and estimatedHours is totalHours,
     which is what calc.js's own docblock for this function specifies. */
  function paintMinimum(totals) {
    const line = $('mjp-line');
    if (!line) return; // left mid-edit, or a screen that has no summary bar

    const on = includeOverheadNow();
    line.hidden = !on;
    if (!on) return;

    const floor = LSCCalc.minimumJobPrice(
      totals.expenseTotal,
      totals.totalHours,
      overheadRate,
      profitMarginPct
    );
    setBreakdown(totals, floor);

    /* null is "cannot be computed", and it has to survive the trip to the
       screen as an em dash and a prompt — not as $0.00, which reads as a real
       answer meaning this job could be done for nothing. Per the IA doc there
       is deliberately no link out of here: an in-progress estimate is the wrong
       moment to send somebody to another screen. */
    if (floor === null) {
      setText('s-min-price', '—');
      setText('s-min-note', 'Set up Overhead & Goals to see this.');
      line.classList.add('mjp-unset');
      return;
    }

    setText('s-min-price', fmt(floor));
    setText(
      's-min-note',
      'to cover ' + fmt(overheadRate) + '/hr of overhead across ' + totals.totalHours +
        (totals.totalHours === 1 ? ' hour' : ' hours') + ' and a ' + profitMarginPct + '% margin'
    );
    line.classList.remove('mjp-unset');
  }

  // ── The cost breakdown modal ──────────────────────────────────────────────

  /* WHY THE MODAL DOESN'T COMPUTE ANYTHING OF ITS OWN
     It is handed the figures paintMinimum() just put on the screen, at the
     moment it put them there. Recomputing them on open would be a second route
     to the same number and therefore a second chance to disagree with the line
     the (?) is attached to — the one thing a "here is how that was worked out"
     panel cannot afford to do.

     WHY THE MARGIN LINE IS A REMAINDER RATHER THAN ITS OWN MULTIPLICATION
     The modal's whole claim is that its three rows add up to the figure under
     them, so the arithmetic a reader can do on it has to come out. Direct Job
     Costs arrives already rounded by computeTotals, but the overhead allocation
     is hours x rate and lands on sub-cent values routinely (7.5 x $25.33 =
     $189.975). Rounding all three independently then makes the printed column
     miss the printed total by a cent often enough to notice.

     So the two inputs are shown rounded and the margin is what is left of the
     floor after them. It is never more than a cent from margin% of the two
     lines above, and the column is always exactly right — the same trade the
     donut's largest-remainder percentages make (HANDOVER.md decision 51) to
     keep its legend summing to 100.0. Both prefer the visible sum. */
  function setBreakdown(totals, floor) {
    const help = $('mjp-help');

    if (floor === null) {
      breakdown = null;
      if (help) help.hidden = true;
      return;
    }

    const direct = LSCCalc.round2(totals.expenseTotal);
    const alloc = LSCCalc.round2(totals.totalHours * overheadRate);
    breakdown = {
      direct,
      alloc,
      profit: LSCCalc.round2(floor - direct - alloc),
      floor,
      hours: totals.totalHours,
      rate: overheadRate,
      margin: profitMarginPct,
    };
    if (help) help.hidden = false;
  }

  const $b = (id) => breakdownOverlay.querySelector('#' + id);

  function breakdownRow(label, value, note) {
    return (
      '<div class="cb-row"><div class="cb-row-head">' +
      '<span class="cb-row-label">' + label + '</span>' +
      '<span class="cb-row-value">' + fmt(value) + '</span></div>' +
      '<p class="cb-row-note">' + note + '</p></div>'
    );
  }

  function breakdownMarkup() {
    const b = breakdown;
    const hours = b.hours + (b.hours === 1 ? ' hour' : ' hours');
    const margin = esc(b.margin);
    return (
      '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="cb-title">' +
      '<h2 class="modal-title" id="cb-title">How this is calculated</h2>' +
      '<div class="cb-rows">' +
      breakdownRow(
        'Direct Job Costs',
        b.direct,
        'Expenses as billed — travel, crew and equipment. Labour is not here: it is what the ' +
          'floor is testing, not an input to it.'
      ) +
      breakdownRow(
        'Overhead Allocation',
        b.alloc,
        hours + ' × ' + fmt(b.rate) + '/hr — this job’s share of what the business costs to run.'
      ) +
      breakdownRow('Profit Margin', b.profit, margin + '% on the two lines above.') +
      '</div>' +
      '<div class="cb-total"><span class="cb-total-label">Minimum Job Price</span>' +
      '<span class="cb-total-value">' + fmt(b.floor) + '</span></div>' +
      /* The one place in the app that names the Overhead Rate as a figure of its
         own, per the IA doc's naming table — everywhere else it is just "Rate". */
      '<p class="cb-note">The Overhead Rate of ' + fmt(b.rate) + '/hr and the ' + margin +
      '% margin come from your Overhead and Goals settings. Advisory only — nothing here ' +
      'changes what the client is billed.</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-accent" id="cb-close">Close</button></div></div>'
    );
  }

  function onBreakdownKeydown(event) {
    // Hidden behind the login screen after a lost session: there is nothing on
    // screen to trap focus into, and Escape there belongs to that screen.
    if (breakdownOverlay.closest('[hidden]')) return;
    if (event.key === 'Escape') return closeBreakdown();
    LSCModal.trapTab(breakdownOverlay, event);
  }

  function onBreakdownClick(event) {
    // A click that started inside the box and ended on the backdrop doesn't count.
    if (event.target === breakdownOverlay) closeBreakdown();
  }

  /* No LSCUnsaved watcher, unlike Overhead's Add/Edit dialog: there is nothing
     to type in here and nothing to discard, so closing it can never lose work
     and must not ask as though it could. */
  function closeBreakdown() {
    if (!breakdownOverlay || !breakdownOverlay.classList.contains('open')) return;
    breakdownOverlay.classList.remove('open');
    breakdownOverlay.innerHTML = '';
    document.removeEventListener('keydown', onBreakdownKeydown);
    breakdownOverlay.removeEventListener('click', onBreakdownClick);
    // Focus would otherwise land on <body>, leaving a keyboard user to tab back
    // down the whole form to get where they were.
    if (breakdownOpener && breakdownOpener.isConnected) breakdownOpener.focus();
    breakdownOpener = null;
  }

  function openBreakdown(openedBy) {
    // Defensive: the trigger is hidden whenever this is null, so reaching here
    // without one would mean rendering a dialog of undefineds.
    if (!breakdownOverlay || !breakdown) return;
    breakdownOpener = openedBy || null;

    breakdownOverlay.innerHTML = breakdownMarkup();
    breakdownOverlay.classList.add('open');
    document.addEventListener('keydown', onBreakdownKeydown);
    breakdownOverlay.addEventListener('click', onBreakdownClick);
    $b('cb-close').addEventListener('click', closeBreakdown);

    // The only control in the box, so it is both ends of the focus trap.
    $b('cb-close').focus();
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  function showError(message) {
    const el = $('editor-error');
    if (!el) return; // left while the request was in flight
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    LSCUtil.clearFieldErrors($('editor-error'));
  }

  function fieldError(msg, id) {
    LSCUtil.showFieldErrors($('editor-error'), [{ msg, field: $(id) }]);
  }

  function setSaving(next) {
    // The flag first: it is module state and has to be cleared even when the
    // controls it describes have gone.
    saving = next;
    if (!onScreen()) return;
    $('js-save').disabled = next;
    $('save-spin').style.display = next ? 'inline-block' : 'none';
    $('save-label').textContent = next ? 'Saving…' : 'Save Estimate';
    const del = $('js-delete');
    if (del) del.disabled = next;
  }

  // ── Client link ───────────────────────────────────────────────────────────

  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  /* The estimate links to a client record only while the Business Name still
     says that client's name. Editing it to something else means this is no
     longer that client, so the link lapses; typing the name back restores it. */
  function linkedClientId() {
    return link && sameName($('f-business').value, link.name) ? link.id : null;
  }

  function paintLink() {
    const named = $('f-business').value.trim() !== '';
    const linked = linkedClientId() !== null;
    $('client-linked').hidden = !linked;
    $('client-save-wrap').hidden = linked || !named;
  }

  /* A pick fills every client field, blanks included: picking a client means
     "use this client's details", and leaving a previous pick's phone behind
     under a new business name would be worse than an empty field. */
  function pickClient(client) {
    $('f-business').value = client.businessName || '';
    $('f-contact').value = client.contactName || '';
    $('f-email').value = client.email || '';
    $('f-phone').value = client.phone || '';
    $('f-abn').value = abnFormat(client.abn);
    $('f-address').value = client.address || '';
    link = { id: client.id, name: client.businessName };
    paintLink();
  }

  /* "Save to client list" for a name that isn't linked. An existing record with
     the same name is linked to, never written to: the client list is the
     maintained copy, and an estimate's details (possibly typed in a hurry)
     must not overwrite it. Reads the full list rather than ?q=, which is
     capped at 20 partial matches and could leave the exact one out. */
  async function resolveClient(snapshot) {
    const all = (await LSCApi.get('/api/clients')).clients || [];
    const match = all.find((c) => sameName(c.businessName, snapshot.businessName));
    if (match) {
      link = { id: match.id, name: match.businessName };
      return { id: match.id, created: false };
    }
    const reply = await LSCApi.post('/api/clients', snapshot);
    // Linked before the estimate is saved, so if that save fails a retry
    // reuses this record instead of creating a second one.
    link = { id: reply.client.id, name: reply.client.businessName };
    return { id: reply.client.id, created: true };
  }

  function payload() {
    const client = Object.assign({}, (existing && existing.client) || {}, {
      businessName: $('f-business').value.trim(),
      contactName: $('f-contact').value.trim(),
      email: $('f-email').value.trim(),
      phone: $('f-phone').value.trim(),
      abn: abnDigits($('f-abn').value),
      address: $('f-address').value.trim(),
    });

    return {
      upid: $('f-upid').value.trim(),
      name: $('f-name').value.trim(),
      date: $('f-date').value,
      notes: $('f-notes').value.trim(),
      docType: $('f-doctype').value,
      invoiceNumber: $('f-invnum').value.trim(),
      // Nothing in the UI sets a status yet, but a PUT that omits it would
      // reset the estimate to 'draft'.
      status: (existing && existing.status) || 'draft',
      clientId: linkedClientId(),
      // Same reasoning as status: the server treats an omitted gstFree as false,
      // so it is always sent rather than left to a default.
      gstFree: gstFreeNow(),
      client,
      activeRows: collect(),
    };
  }

  /* The whole form, as it would be saved, in one string. Compared against the
     snapshot taken at mount to answer whether there is anything here worth
     warning about — a comparison rather than a "they typed something" flag, so
     a character typed and deleted again doesn't raise a dialog. Rows count:
     collect() is in the payload, so adding a service or clearing an hours field
     is an unsaved change like any other. */
  const snapshot = () => JSON.stringify(payload());

  async function save() {
    if (saving) return;
    clearError();

    const body = payload();
    if (!body.name) {
      fieldError('Enter a project name before saving.', 'f-name');
      return;
    }
    if (!body.upid) {
      fieldError('Enter a UPID before saving.', 'f-upid');
      return;
    }
    // The client's ABN prints on the invoice.
    if (body.client.abn && !abnValid(body.client.abn)) {
      fieldError('That client ABN doesn’t check out — it should be 11 digits, as shown on the ABN Lookup.', 'f-abn');
      return;
    }

    setSaving(true);
    Toast.working('Saving…');

    try {
      let added = false;
      if (!body.clientId && body.client.businessName && $('f-saveclient').checked) {
        const resolved = await resolveClient({
          businessName: body.client.businessName,
          contactName: body.client.contactName,
          email: body.client.email,
          phone: body.client.phone,
          abn: body.client.abn,
          address: body.client.address,
        });
        body.clientId = resolved.id;
        added = resolved.created;
        paintLink();
      }

      const reply = existing
        ? await LSCApi.put('/api/estimates/' + encodeURIComponent(existing.id), body)
        : await LSCApi.post('/api/estimates', body);
      Toast.ok(added ? 'Estimate saved — ' + body.client.businessName + ' added to your client list.' : 'Estimate saved.');
      // Nothing more to do to a screen the user has already left — and
      // snapshot() reads the form, which is no longer there to read.
      if (!onScreen()) return;
      // What is on screen is now what is stored. onSaved fetches the estimate
      // before replacing this screen, and for that moment the editor is still
      // in the page — without this a reload in the gap would warn about an
      // estimate that had just been saved.
      baseline = snapshot();
      handlers.onSaved(reply.estimate);
    } catch (err) {
      // The form is left exactly as it was: a failed save must never be the
      // reason someone retypes an estimate.
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(
        err.kind === 'network'
          ? 'Couldn’t save — the server is unreachable. Your work is still here; try again once it’s back.'
          : 'Couldn’t save: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  async function remove() {
    if (saving || !existing) return;
    if (!window.confirm('Delete this estimate? This cannot be undone.')) return;

    setSaving(true);
    Toast.working('Deleting…');
    try {
      await LSCApi.del('/api/estimates/' + encodeURIComponent(existing.id));
      Toast.ok('Estimate deleted.');
      if (!onScreen()) return;
      handlers.onDeleted();
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(
        err.kind === 'network'
          ? 'Couldn’t delete — the server is unreachable.'
          : 'Couldn’t delete: ' + (err.message || 'the server refused the request.')
      );
    }
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  function restoreRows(activeRows, pricing) {
    sections.forEach((section) => {
      (activeRows[section.id] || []).forEach((line) => {
        injectRow($('tbody-' + section.id), buildLabourRow(section, labourDef(section, line), line));
      });
    });
    (activeRows.travel || []).forEach((line) => {
      injectRow($('tbody-travel'), buildTravelRow(travelDef(line, pricing), line));
    });
    (activeRows.crew || []).forEach((line) => injectRow($('tbody-crew'), buildCostRow('crew', line)));
    (activeRows.equip || []).forEach((line) => injectRow($('tbody-equip'), buildCostRow('equip', line)));
    (activeRows.deliverables || []).forEach((line) =>
      injectRow($('tbody-deliverables'), buildDeliverableRow(line))
    );
  }

  function bind(pricing) {
    /* Cancel and Back both drop the estimate on the floor. Cancel says so, but
       an hour of work is worth a question either way — and Back sits where the
       browser's own back button would, which is not where anyone expects to
       lose a form. */
    const leave = () => {
      if (!LSCUnsaved.confirmLeave()) return;
      handlers.onCancel();
    };
    $('js-back').addEventListener('click', leave);
    $('js-cancel').addEventListener('click', leave);
    $('js-save').addEventListener('click', save);
    const del = $('js-delete');
    if (del) del.addEventListener('click', remove);

    const business = $('f-business');
    ClientTypeahead.attach(business, { onPick: pickClient });
    business.addEventListener('input', paintLink);

    const docType = $('f-doctype');
    docType.addEventListener('change', function () {
      $('inv-num-wrap').classList.toggle('show', this.value === 'invoice');
    });

    // Changing the tax treatment moves the headline figures, so it recomputes
    // like any other input that feeds them.
    const gstFreeBox = $('f-gstfree');
    if (gstFreeBox) gstFreeBox.addEventListener('change', recalc);

    /* Straight to recalc() like any other input that feeds the bar — not a
       lighter show/hide path. The toggle changes nothing computeTotals reads,
       so running the full pass is the cheap way to be certain of it: if this
       ever did move a headline figure, it would show up here rather than in a
       shortcut that skipped the comparison. */
    $('f-include-overhead').addEventListener('change', recalc);

    $('mjp-help').addEventListener('click', (event) => openBreakdown(event.currentTarget));

    sections.forEach((section) => {
      const add = $('add-' + section.id);
      if (!add) return; // archived categories have no picker
      add.addEventListener('click', () => {
        const select = $('sel-' + section.id);
        const def = section.rows.find((r) => r.name === (select && select.value));
        if (!def) return;
        injectRow($('tbody-' + section.id), buildLabourRow(section, def, { name: def.name, qty: 0 }));
      });
    });

    $('add-travel').addEventListener('click', () => {
      const select = $('sel-travel');
      const defs = (pricing && pricing.travelRows) || [];
      const def = defs.find((r) => r.name === (select && select.value));
      if (!def) return;
      injectRow($('tbody-travel'), buildTravelRow(def, { name: def.name, qty: 0 }));
    });

    $('add-crew').addEventListener('click', () => injectRow($('tbody-crew'), buildCostRow('crew', {})));
    $('add-equip').addEventListener('click', () => injectRow($('tbody-equip'), buildCostRow('equip', {})));
    $('add-deliverables').addEventListener('click', () =>
      injectRow($('tbody-deliverables'), buildDeliverableRow({ qty: 1 }))
    );
  }

  function mount(container, estimate, viewHandlers) {
    root = container;
    handlers = viewHandlers;
    existing = estimate || null;
    rowCounter = 0;
    saving = false;
    breakdownOverlay = document.getElementById('modal-cost-breakdown');
    /* The overlay lives outside `root`, so a re-mount replaces the form under
       an open dialog instead of taking it with it. Nothing in the app can
       currently navigate past the trap to get here, but the dialog would
       outlive the figures it describes if anything ever could. */
    closeBreakdown();
    breakdown = null;
    link =
      estimate && estimate.clientId
        ? { id: estimate.clientId, name: (estimate.client && estimate.client.businessName) || '' }
        : null;

    const pricing = LSCData.pricing();
    /* Resolved once, before the first recalc(). Both stay null when Finance has
       not been set up, and minimumJobPrice() turns either null into a null
       floor, which paintMinimum() renders as the set-up prompt. */
    /* Annual billable hours, not weekly — see the note at the same call in
       pricing.js. Both screens go through annualBillableHoursFromGoals so the
       floor here and the rate there cannot disagree. */
    overheadRate = LSCCalc.overheadRatePerHour(
      LSCCalc.annualOverheadTotal(LSCData.overheadItems()),
      LSCCalc.annualBillableHoursFromGoals(LSCData.goals())
    );
    profitMarginPct = LSCData.goals().targetProfitMarginPct;
    const activeRows = (estimate && estimate.activeRows) || {};
    sections = sectionsFor(activeRows, pricing, estimate && estimate.sectionLabels);

    root.innerHTML = formMarkup(estimate, pricing);
    restoreRows(activeRows, pricing);
    bind(pricing);
    paintLink();
    recalc();

    baseline = snapshot();
    LSCUnsaved.watch('estimate-editor', {
      label: 'this estimate',
      // Hidden still counts as on screen: behind the login card after a 401
      // this form is being kept for after sign-in, and a reload would lose it.
      onScreen: () => Boolean(root && root.querySelector('#f-upid')),
      dirty: () => snapshot() !== baseline,
    });

    $('f-upid').focus();
  }

  return {
    mount,
    /* Re-run the live totals against whatever LSCData now holds. The Invoice
       Settings modal opens over this screen without unmounting it, so changing
       the GST configuration leaves the summary bar showing figures from the old
       one until the next keystroke happens to recompute them.

       The guard is what makes this safe to call blind: `root` stays set after
       another view has replaced the markup inside it, so the sentinel asks
       whether the editor is actually on screen rather than whether it ever was. */
    refreshTotals() {
      if (!root || !root.querySelector('#s-gst')) return;
      recalc();
    },
  };
})();
