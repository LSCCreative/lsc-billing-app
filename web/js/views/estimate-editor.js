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
      '<div class="right muted-td" data-label="Rate">' + (def && def.rate > 0 ? fmt(def.rate) : '—') + '</div>' +
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
      '<div class="bb-head"><div><span class="bb-label">' + esc(section.label) + '</span>' + tag + '</div>' +
      '<span class="bb-sum">Subtotal <b id="sum-' + esc(section.id) + '">$0.00</b></span></div>' +
      picker +
      '<div class="gt-head labour-grid"><div>Service</div><div class="right">Hours</div>' +
      '<div class="right">Rate</div><div class="right">Mark-Up</div><div class="right">Client Bill</div><div></div></div>' +
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
      '<div class="bb-head"><div><span class="bb-label">Travel &amp; Accommodation</span>' +
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
      '<div class="bb-head"><div><span class="bb-label">' + label + '</span>' +
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
      '<div class="bb-head"><div><span class="bb-label">Deliverables</span>' +
      '<span class="bb-label-tag">PROJECT OUTPUT</span></div>' +
      '<button type="button" class="btn-accent btn-sm" id="add-deliverables">+ Add Deliverable</button></div>' +
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
  function summaryMarkup() {
    return (
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
      '<div class="sum-label" style="color:var(--accent)">Total (inc GST)</div>' +
      '<div class="sum-value accent" id="s-total">$0.00</div></div>' +
      '<div class="sum-item"><div class="sum-label">Tax Set-Aside</div>' +
      '<div class="sum-value" id="s-tax" style="font-size:15px">$0.00</div></div>' +
      '<div class="sum-item sum-span2">' +
      '<div class="sum-label">Est. Take-Home <span style="font-size:9px;color:var(--muted2)">(labour revenue ex GST, less set-aside — pass-through excluded)</span></div>' +
      '<div class="sum-value" id="s-takehome" style="color:#6fcf6f">$0.00</div></div>' +
      '</div>'
    );
  }

  function formMarkup(estimate, pricing) {
    const client = (estimate && estimate.client) || {};
    const isInvoice = estimate && estimate.docType === 'invoice';

    let html =
      '<button class="back-btn" id="js-back">← Back</button>' +
      '<div class="page-head"><div><div class="page-title">' +
      (estimate ? 'Edit Estimate' : 'New Estimate') + '</div>' +
      '<div class="page-sub">Select services from each category to build your estimate</div></div></div>' +
      '<div class="form-grid">' +
      '<div class="field full"><label for="f-upid" style="color:var(--accent)">UPID — Unique Project Identifier *</label>' +
      '<input id="f-upid" type="text" class="upid-field" value="' + esc(estimate ? estimate.upid : '') + '"></div>' +
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
      '<label for="f-invnum" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--accent)">Invoice #</label>' +
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
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  function showError(message) {
    const el = $('editor-error');
    if (!el) return; // left while the request was in flight
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    const el = $('editor-error');
    if (!el) return;
    el.textContent = '';
    el.classList.remove('show');
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
      showError('Enter a project name before saving.');
      $('f-name').focus();
      return;
    }
    if (!body.upid) {
      showError('Enter a UPID before saving.');
      $('f-upid').focus();
      return;
    }
    // The client's ABN prints on the invoice.
    if (body.client.abn && !abnValid(body.client.abn)) {
      showError('That client ABN doesn’t check out — it should be 11 digits, as shown on the ABN Lookup.');
      $('f-abn').focus();
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
    link =
      estimate && estimate.clientId
        ? { id: estimate.clientId, name: (estimate.client && estimate.client.businessName) || '' }
        : null;

    const pricing = LSCData.pricing();
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
