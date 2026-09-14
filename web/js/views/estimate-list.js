'use strict';

/* The estimates list — the app's landing screen.
 *
 * Ported from renderList in the desktop app. The card markup is unchanged
 * except for the headline figure: the old card showed `p.net` under "Net
 * Invoice", which was the pre-GST billed figure wearing a label that suggested
 * otherwise. It now shows what the client actually pays.
 *
 * `var projects = []` is gone. The list is whatever GET /api/estimates returns,
 * newest-updated first (the server orders it), and is re-fetched on every
 * mount rather than cached, so a save made in the editor is reflected here
 * without this screen having to be told about it.
 */

const EstimateList = (() => {
  const { fmt, esc } = LSCUtil;

  // Retained so refreshFirstRun() can redraw the checklist where it stands.
  let mountedRoot = null;
  let mountedHandlers = null;

  function cardMarkup(estimate) {
    const client = estimate.client || {};
    const totals = estimate.totals || {};
    const isInvoice = estimate.docType === 'invoice';
    const badge = isInvoice
      ? '<span style="font-size:9px;padding:2px 7px;border:1px solid var(--accent);color:var(--accent);letter-spacing:.05em">INVOICE</span>'
      : '<span style="font-size:9px;padding:2px 7px;border:1px solid var(--border);color:var(--muted);letter-spacing:.05em">ESTIMATE</span>';

    return (
      '<div class="proj-card" data-id="' + esc(estimate.id) + '" role="listitem" tabindex="0">' +
      '<div class="card-num">' + esc(estimate.upid || '—') + '</div>' +
      '<div class="card-name">' + esc(estimate.name) + '</div>' +
      '<div class="card-client">' + esc(client.businessName || '—') + '</div>' +
      '<div style="margin-bottom:8px">' + badge + '</div>' +
      '<div class="card-gross-label">Total (inc GST)</div>' +
      '<div class="card-gross">' + fmt(totals.totalIncGst) + '</div>' +
      '<div class="card-foot"><div class="card-date">' + esc(estimate.date || '—') + '</div>' +
      '<div class="tag">' + esc(client.contactName || '—') + '</div></div>' +
      '</div>'
    );
  }

  /* What a fresh account still has to set up, and only ever on the empty state.
     Both are read from LSCData's updatedAt flags rather than from the contents:
     the rate card answers GET /api/pricing with a full set of built-in defaults
     whether or not anyone has saved it, so "is it empty" is not the question —
     "has it ever been written" is. A step that is done is not rendered, so once
     both are, this falls back to the plain empty state below. */
  function setupSteps() {
    const steps = [];
    if (!LSCData.pricingConfigured()) {
      steps.push({
        id: 'pricing',
        title: 'Check your rate card',
        body:
          'Every estimate is priced from it. What’s in there now is the built-in default ' +
          'card — open it, change anything that’s out of date, and save once to make it yours.',
        action: 'Open Pricing',
      });
    }
    if (!LSCData.settingsConfigured()) {
      steps.push({
        id: 'settings',
        title: 'Add your invoice details',
        body:
          'Your business name, ABN and bank details. Until they’re saved an invoice prints ' +
          'no payment block at all, and one that charges GST won’t export without an ABN.',
        action: 'Open Invoice Settings',
      });
    }
    return steps;
  }

  function stepMarkup(step) {
    return (
      '<li class="first-run-step">' +
      '<div class="first-run-step-text"><div class="first-run-step-title">' +
      esc(step.title) + '</div><p>' + esc(step.body) + '</p></div>' +
      // Navigation, not a write — so deliberately no data-write: the connection
      // banner has no reason to block opening a screen.
      '<button class="btn btn-sm" data-setup="' + esc(step.id) + '">' + esc(step.action) + '</button>' +
      '</li>'
    );
  }

  function emptyMarkup() {
    const steps = setupSteps();
    if (!steps.length) {
      return (
        '<div class="empty-state"><h3>No estimates yet</h3>' +
        '<p>Click <strong>New Estimate</strong> to get started.</p></div>'
      );
    }
    return (
      '<div class="empty-state first-run"><h3>No estimates yet</h3>' +
      '<p>' +
      (steps.length === 1
        ? 'One thing is worth setting up before your first invoice.'
        : 'Two things are worth setting up before your first invoice.') +
      '</p><ol class="first-run-steps">' + steps.map(stepMarkup).join('') + '</ol>' +
      '<p class="first-run-skip">You can start an estimate now and come back to these — ' +
      'they only change what a new estimate is priced and printed from.</p></div>'
    );
  }

  function markup(estimates) {
    const count = estimates.length;
    let html =
      '<div class="page-head"><div><div class="page-title">Estimates</div>' +
      '<div class="page-sub">' +
      (count ? count + ' estimate' + (count !== 1 ? 's' : '') : 'No estimates yet') +
      '</div></div>' +
      '<button class="btn btn-accent" id="js-new">+ New Estimate</button></div>';

    if (!count) {
      html += emptyMarkup();
    } else {
      html +=
        '<div class="cards-grid" role="list">' +
        estimates.map(cardMarkup).join('') +
        '</div>';
    }
    return html;
  }

  function loadingMarkup() {
    return (
      '<div class="page-head"><div><div class="page-title">Estimates</div>' +
      '<div class="page-sub">Loading…</div></div></div>'
    );
  }

  function failureMarkup(message) {
    return (
      '<div class="page-head"><div><div class="page-title">Estimates</div>' +
      '<div class="page-sub">Could not load</div></div>' +
      '<button class="btn btn-ghost" id="js-retry">Try Again</button></div>' +
      '<div class="empty-state"><h3>Couldn’t load your estimates</h3><p>' +
      esc(message) +
      '</p></div>'
    );
  }

  /* The setup steps' wiring, factored out because refreshFirstRun() has to
     re-attach it after replacing the block. */
  function bindSetup(container, viewHandlers) {
    container.querySelectorAll('[data-setup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        // The button itself goes to onOpenSettings, so the modal can hand focus
        // back to it when it closes.
        if (btn.dataset.setup === 'pricing') viewHandlers.onGoPricing();
        else viewHandlers.onOpenSettings(btn);
      });
    });
  }

  /* The Invoice Settings modal opens over this screen without unmounting it, so
     a save there would otherwise leave the checklist still listing the step it
     had just satisfied — telling the user their work didn't land when it did.
     Same reason EstimateEditor.refreshTotals exists, and the same shape: a
     no-op unless the block it redraws is actually on screen. The Pricing step
     needs no equivalent, because opening Pricing replaces this screen and
     coming back re-mounts it. */
  function refreshFirstRun() {
    if (!mountedRoot || !mountedRoot.isConnected) return;
    const block = mountedRoot.querySelector('.empty-state.first-run');
    if (!block) return;
    const holder = document.createElement('div');
    holder.innerHTML = emptyMarkup();
    block.replaceWith(holder.firstElementChild);
    bindSetup(mountedRoot, mountedHandlers);
  }

  async function mount(root, handlers) {
    mountedRoot = root;
    mountedHandlers = handlers;
    root.innerHTML = loadingMarkup();

    let estimates;
    try {
      const reply = await LSCApi.get('/api/estimates');
      estimates = reply.estimates || [];
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost();
      // 'network' and 'server' also raise the connection banner; this screen
      // still needs to say something in place of the cards it can't draw.
      root.innerHTML = failureMarkup(
        err.kind === 'network'
          ? 'The server could not be reached.'
          : err.message || 'The server had a problem.'
      );
      root.querySelector('#js-retry').addEventListener('click', () => mount(root, handlers));
      return;
    }

    root.innerHTML = markup(estimates);
    root.querySelector('#js-new').addEventListener('click', () => handlers.onNew());
    bindSetup(root, handlers);

    root.querySelectorAll('.proj-card').forEach((card) => {
      const open = () => handlers.onOpen(card.dataset.id);
      card.addEventListener('click', open);
      // The cards were div-only in the desktop app, where a mouse was the only
      // input. On the web they are the sole route into an estimate, so they
      // answer the keyboard too.
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });
  }

  return { mount, refreshFirstRun };
})();
