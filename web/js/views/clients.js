'use strict';

/* The Clients screen: the saved client list, and one client's record with the
 * estimates linked to it.
 *
 * New in the web build — the desktop app had no client list at all
 * (BILLING_APP_PLAN.md, "A simple Clients screen to view/edit saved clients and
 * see their estimate history").
 *
 * EDITING A CLIENT NEVER TOUCHES AN ESTIMATE
 * Each estimate carries its own snapshot of the client's details, taken when it
 * was saved, so a quote already sent keeps the address it was sent with. The
 * record here is only where the estimate editor's typeahead fills *new* ones
 * from. The same is true of deleting: the server nulls the link and the
 * estimates keep their copy.
 *
 * ONE RECORD PER BUSINESS NAME
 * The estimate editor links an unpicked name to an existing client by a
 * case-insensitive exact match on business name (see resolveClient in
 * estimate-editor.js), so two records with the same name would make that
 * ambiguous. Saving here refuses a name another client already has.
 */

const ClientsView = (() => {
  const { fmt, esc, abnDigits, abnValid, abnFormat } = LSCUtil;

  let root = null;
  let handlers = null;

  const LIST = '/clients';
  const clientPath = (id) => LIST + '/' + encodeURIComponent(id);

  const FIELDS = [
    ['businessName', 'c-business'],
    ['contactName', 'c-contact'],
    ['email', 'c-email'],
    ['phone', 'c-phone'],
    ['abn', 'c-abn'],
    ['address', 'c-address'],
    ['notes', 'c-notes'],
  ];

  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  function failureText(err, action) {
    return err.kind === 'network'
      ? 'Couldn’t ' + action + ' — the server is unreachable.'
      : 'Couldn’t ' + action + ': ' + (err.message || 'the server refused the request.');
  }

  // ── List ──────────────────────────────────────────────────────────────────

  function cardMarkup(client) {
    return (
      '<div class="proj-card" data-id="' + esc(client.id) + '" role="listitem">' +
      '<h2 class="card-name"><button type="button" class="card-open">' +
      esc(client.businessName || '—') + '</button></h2>' +
      '<div class="card-client">' + esc(client.contactName || '—') + '</div>' +
      '<div class="card-foot"><div class="card-date">' + esc(client.email || '—') + '</div>' +
      (client.phone ? '<div class="tag">' + esc(client.phone) + '</div>' : '') +
      '</div></div>'
    );
  }

  function listHead(sub, button) {
    return (
      '<div class="page-head"><div><h1 class="page-title">Clients</h1>' +
      '<div class="page-sub">' + sub + '</div></div>' + (button || '') + '</div>'
    );
  }

  async function showList() {
    window.scrollTo(0, 0);
    root.innerHTML = listHead('Loading…');
    const ticket = LSCRouter.ticket();

    let clients;
    try {
      clients = (await LSCApi.get('/api/clients')).clients || [];
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket)) return; // moved on while it loaded
      if (err.kind === 'auth') return handlers.onAuthLost();
      root.innerHTML =
        listHead('Could not load', '<button class="btn btn-ghost" id="js-retry">Try Again</button>') +
        '<div class="empty-state"><h3>Couldn’t load your clients</h3><p>' +
        esc(err.kind === 'network' ? 'The server could not be reached.' : err.message || 'The server had a problem.') +
        '</p></div>';
      root.querySelector('#js-retry').addEventListener('click', showList);
      return;
    }

    if (!LSCRouter.isCurrent(ticket)) return;
    const count = clients.length;
    root.innerHTML =
      listHead(
        count ? count + ' client' + (count !== 1 ? 's' : '') : 'No clients yet',
        '<button class="btn btn-accent" id="js-new">+ New Client</button>'
      ) +
      (count
        ? '<div class="cards-grid" role="list">' + clients.map(cardMarkup).join('') + '</div>'
        : '<div class="empty-state"><h3>No clients yet</h3>' +
          '<p>Add one with <strong>New Client</strong>, or save an estimate with a business name ' +
          'and tick <strong>Save to client list</strong>.</p></div>');

    root.querySelector('#js-new').addEventListener('click', () => LSCRouter.go(LIST + '/new'));
    root.querySelectorAll('.proj-card').forEach((card) => {
      const client = clients.find((c) => c.id === card.dataset.id);
      // Keyboard activation arrives here too: Enter/Space on the card's own
      // .card-open button dispatch a click, which bubbles to the card. The
      // record rides along so opening it doesn't refetch what the list holds.
      card.addEventListener('click', () => LSCRouter.go(clientPath(client.id), { state: { client } }));
    });
  }

  // ── One client ────────────────────────────────────────────────────────────

  function editorMarkup(client) {
    const c = client || {};
    const field = (id, label, value, extra) =>
      '<div class="field' + (extra && extra.full ? ' full' : '') + '"><label for="' + id + '">' + label + '</label>' +
      (extra && extra.textarea
        ? '<textarea id="' + id + '">' + esc(value) + '</textarea>'
        : '<input id="' + id + '" type="' + ((extra && extra.type) || 'text') + '"' +
          (extra && extra.attrs ? ' ' + extra.attrs : '') + ' value="' + esc(value) + '">') +
      '</div>';

    return (
      '<button class="back-btn" id="js-back">← Clients</button>' +
      '<div class="page-head"><div><h1 class="page-title">' +
      (client ? esc(c.businessName || 'Client') : 'New Client') + '</h1>' +
      '<div class="page-sub">' +
      (client ? 'Changes apply to new estimates — ones already saved keep their own copy' : 'Saved to your client list') +
      '</div></div></div>' +
      '<div class="form-grid">' +
      field('c-business', 'Business Name *', c.businessName || '', { full: true }) +
      field('c-contact', 'Contact Name', c.contactName || '') +
      field('c-email', 'Email', c.email || '', { type: 'email' }) +
      field('c-phone', 'Phone', c.phone || '', { type: 'tel' }) +
      field('c-abn', 'ABN', abnFormat(c.abn), { attrs: 'inputmode="numeric" placeholder="e.g. 51 824 753 556"' }) +
      field('c-address', 'Address', c.address || '', { full: true }) +
      field('c-notes', 'Notes', c.notes || '', { full: true, textarea: true }) +
      '</div>' +
      '<div id="client-error" role="alert"></div>' +
      '<div class="form-actions">' +
      (client ? '<button type="button" class="btn btn-danger btn-sm" id="js-delete" data-write>Delete</button>' : '') +
      '<button type="button" class="btn btn-ghost" id="js-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-accent" id="js-save" data-write>' +
      '<span class="spinner" id="client-spin"></span><span id="client-save-label">Save Client</span></button>' +
      '</div>' +
      (client ? '<div id="client-history"></div>' : '')
    );
  }

  function historyMarkup(estimates) {
    const head =
      '<div class="est-block-head"><h2 class="est-block-label">Estimate History</h2>' +
      '<span class="est-block-sum" style="color:var(--muted)">' +
      estimates.length + ' estimate' + (estimates.length !== 1 ? 's' : '') + '</span></div>';
    if (!estimates.length) {
      return (
        '<div class="est-block">' + head +
        '<p class="client-history-empty">No estimates are linked to this client yet. Pick them from the ' +
        'Business Name field when you create an estimate and they’ll appear here.</p></div>'
      );
    }
    return (
      '<div class="est-block">' + head +
      '<table class="est-table client-history-table"><thead><tr><th>UPID</th><th>Project</th><th>Date</th>' +
      '<th class="right">Total (inc GST)</th></tr></thead><tbody>' +
      estimates
        .map(
          (e) =>
            '<tr data-id="' + esc(e.id) + '">' +
            /* data-label on every cell, as in estimate-detail.js: this table is
               an .est-table, and below 768px css/responsive.css hides the head
               row and prints these beside the values instead. */
            '<td class="muted-td" data-label="UPID">' + esc(e.upid || '—') + '</td>' +
            '<td data-label="Project"><button type="button" class="client-history-link">' + esc(e.name || 'Untitled') + '</button></td>' +
            '<td class="muted-td" data-label="Date">' + esc(e.date || '—') + '</td>' +
            '<td class="right bill" data-label="Total (inc GST)">' + fmt(e.totalIncGst) + '</td></tr>'
        )
        .join('') +
      '</tbody></table></div>'
    );
  }

  async function loadHistory(client) {
    const box = root.querySelector('#client-history');
    box.innerHTML = '<p class="client-history-empty">Loading estimate history…</p>';
    let estimates;
    try {
      estimates = (await LSCApi.get('/api/clients/' + encodeURIComponent(client.id) + '/estimates')).estimates || [];
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost();
      if (!box.isConnected) return;
      box.innerHTML = '<p class="client-history-empty">' + esc(failureText(err, 'load the estimate history')) + '</p>';
      return;
    }
    if (!box.isConnected) return; // navigated away while it loaded
    box.innerHTML = historyMarkup(estimates);
    box.querySelectorAll('.client-history-link').forEach((btn) => {
      // The history sits under the client form, so this link leaves a screen
      // that may have edits in it — the router's guard asks, as for the header.
      btn.addEventListener('click', () => handlers.onOpenEstimate(btn.closest('tr').dataset.id));
    });
  }

  function showEditor(client) {
    window.scrollTo(0, 0);
    root.innerHTML = editorMarkup(client);
    const $ = (id) => root.querySelector('#' + id);
    let saving = false;

    /* Is this record still the screen on #main? A save or delete is async and
       the nav doesn't wait for it, so its outcome can land after the user has
       gone elsewhere — at which point re-rendering would pull them back to a
       client they had left. */
    const onScreen = () => Boolean(root && root.querySelector('#c-business'));

    const showError = (message) => {
      const el = $('client-error');
      if (!el) return; // left while the request was in flight
      el.textContent = message;
      el.classList.add('show');
    };
    const clearError = () => LSCUtil.clearFieldErrors($('client-error'));
    const fieldError = (msg, id) => LSCUtil.showFieldErrors($('client-error'), [{ msg, field: $(id) }]);
    const setSaving = (next) => {
      // The flag first: it has to be cleared even when the controls have gone.
      saving = next;
      if (!onScreen()) return;
      $('js-save').disabled = next;
      $('client-spin').style.display = next ? 'inline-block' : 'none';
      $('client-save-label').textContent = next ? 'Saving…' : 'Save Client';
      if ($('js-delete')) $('js-delete').disabled = next;
    };

    function read() {
      const body = {};
      FIELDS.forEach(([key, id]) => {
        body[key] = $(id).value.trim();
      });
      body.abn = abnDigits(body.abn);
      return body;
    }

    async function save() {
      if (saving) return;
      clearError();
      const body = read();
      if (!body.businessName) {
        fieldError('Enter a business name before saving.', 'c-business');
        return;
      }
      if (body.abn && !abnValid(body.abn)) {
        fieldError('That ABN doesn’t check out — it should be 11 digits, as shown on the ABN Lookup.', 'c-abn');
        return;
      }

      setSaving(true);
      Toast.working('Saving…');
      try {
        // The full list, not ?q= — search is capped at 20 partial matches, which
        // could leave the exact one out.
        const all = (await LSCApi.get('/api/clients')).clients || [];
        const clash = all.find((c) => sameName(c.businessName, body.businessName) && (!client || c.id !== client.id));
        if (clash) {
          setSaving(false);
          Toast.hide();
          fieldError(
            'There’s already a client called “' + clash.businessName + '”. Edit that one instead, or use a different name.',
            'c-business'
          );
          return;
        }
        const reply = client
          ? await LSCApi.put('/api/clients/' + encodeURIComponent(client.id), body)
          : await LSCApi.post('/api/clients', body);
        Toast.ok('Client saved.');
        if (!onScreen()) return;
        // A new client's #/clients/new becomes its own address; an existing
        // one is already there and just redraws from the server's copy.
        if (client) showEditor(reply.client);
        else LSCRouter.go(clientPath(reply.client.id), { replace: true, skipGuard: true, state: { client: reply.client } });
      } catch (err) {
        setSaving(false);
        Toast.hide();
        if (!(err instanceof LSCApi.ApiError)) throw err;
        if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
        showError(failureText(err, 'save') + (err.kind === 'network' ? ' Your changes are still here.' : ''));
      }
    }

    async function remove() {
      if (saving || !client) return;
      if (
        !window.confirm(
          'Delete ' + (client.businessName || 'this client') + ' from your client list?\n\n' +
          'Estimates already saved for them keep their own copy of these details.'
        )
      ) return;

      setSaving(true);
      Toast.working('Deleting…');
      try {
        await LSCApi.del('/api/clients/' + encodeURIComponent(client.id));
        Toast.ok('Client deleted.');
        if (!onScreen()) return;
        // Replaces rather than going Back: the record behind it is gone.
        LSCRouter.go(LIST, { replace: true, skipGuard: true });
      } catch (err) {
        setSaving(false);
        Toast.hide();
        if (!(err instanceof LSCApi.ApiError)) throw err;
        if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
        showError(failureText(err, 'delete'));
      }
    }

    /* read() trims, so this compares what would be saved rather than what is
       literally in the fields — a trailing space typed and left is not worth a
       dialog, since saving would discard it too. */
    const snapshot = () => JSON.stringify(read());
    const baseline = snapshot();
    LSCUnsaved.watch('client-editor', {
      label: client ? 'this client' : 'this new client',
      onScreen: () => Boolean(root && root.querySelector('#c-business')),
      dirty: () => snapshot() !== baseline,
    });

    // A successful save re-mounts this screen with the server's copy, which
    // re-registers the watcher against a fresh baseline. Leaving is a route
    // change, so the router asks about unsaved edits; off a deep link this
    // entry gives way to the list.
    const leave = () => LSCRouter.leaveTo(LIST, { replace: true });
    $('js-back').addEventListener('click', leave);
    $('js-cancel').addEventListener('click', leave);
    $('js-save').addEventListener('click', save);
    if ($('js-delete')) $('js-delete').addEventListener('click', remove);
    $('c-business').focus();

    if (client) loadHistory(client);
  }

  /* #/clients/<id>: the record the list handed over, or a fresh read for a
     reload or a deep link. A deleted one says so in place (D59). */
  async function showClient(id, held) {
    if (held && held.id === id) return showEditor(held);
    const ticket = LSCRouter.ticket();
    let client;
    try {
      client = (await LSCApi.get('/api/clients/' + encodeURIComponent(id))).client;
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket)) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      window.scrollTo(0, 0);
      const gone = err.status === 404;
      root.innerHTML =
        '<button class="back-btn" id="js-back">← Clients</button>' +
        '<div class="empty-state"><h3>' +
        (gone ? 'That client doesn’t exist any more' : 'Couldn’t open that client') + '</h3><p>' +
        esc(gone ? 'They may have been deleted. Estimates saved for them keep their own copy of the details.' : failureText(err, 'load them')) +
        '</p>' + (gone ? '' : '<button type="button" class="btn" id="js-retry" style="margin-top:16px">Try Again</button>') +
        '</div>';
      root.querySelector('#js-back').addEventListener('click', () => LSCRouter.leaveTo(LIST));
      if (!gone) root.querySelector('#js-retry').addEventListener('click', () => showClient(id));
      return;
    }
    if (LSCRouter.isCurrent(ticket)) showEditor(client);
  }

  return {
    /* Once per sign-in. */
    init(container, options) {
      root = container;
      handlers = options;
    },

    /* The router's way in: the route after 'clients'. False for a shape this
       area doesn't have. */
    show(segments, state) {
      const [id, extra] = segments;
      if (extra !== undefined) return false;
      if (id === undefined) showList();
      else if (id === 'new') showEditor(null);
      else showClient(id, state && state.client);
      return true;
    },
  };
})();
