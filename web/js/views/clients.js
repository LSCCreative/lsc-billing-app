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
      '<div class="proj-card" data-id="' + esc(client.id) + '" role="listitem" tabindex="0">' +
      '<div class="card-name">' + esc(client.businessName || '—') + '</div>' +
      '<div class="card-client">' + esc(client.contactName || '—') + '</div>' +
      '<div class="card-foot"><div class="card-date">' + esc(client.email || '—') + '</div>' +
      (client.phone ? '<div class="tag">' + esc(client.phone) + '</div>' : '') +
      '</div></div>'
    );
  }

  function listHead(sub, button) {
    return (
      '<div class="page-head"><div><div class="page-title">Clients</div>' +
      '<div class="page-sub">' + sub + '</div></div>' + (button || '') + '</div>'
    );
  }

  async function showList() {
    window.scrollTo(0, 0);
    root.innerHTML = listHead('Loading…');

    let clients;
    try {
      clients = (await LSCApi.get('/api/clients')).clients || [];
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost();
      root.innerHTML =
        listHead('Could not load', '<button class="btn btn-ghost" id="js-retry">Try Again</button>') +
        '<div class="empty-state"><h3>Couldn’t load your clients</h3><p>' +
        esc(err.kind === 'network' ? 'The server could not be reached.' : err.message || 'The server had a problem.') +
        '</p></div>';
      root.querySelector('#js-retry').addEventListener('click', showList);
      return;
    }

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

    root.querySelector('#js-new').addEventListener('click', () => showEditor(null));
    root.querySelectorAll('.proj-card').forEach((card) => {
      const client = clients.find((c) => c.id === card.dataset.id);
      card.addEventListener('click', () => showEditor(client));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showEditor(client);
        }
      });
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
      '<div class="page-head"><div><div class="page-title">' +
      (client ? esc(c.businessName || 'Client') : 'New Client') + '</div>' +
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
      '<div class="est-block-head"><span class="est-block-label">Estimate History</span>' +
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
      // that may have edits in it — the one nav route out of here that isn't
      // in the header.
      btn.addEventListener('click', () => {
        if (!LSCUnsaved.confirmLeave()) return;
        handlers.onOpenEstimate(btn.closest('tr').dataset.id);
      });
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
    const clearError = () => {
      const el = $('client-error');
      el.textContent = '';
      el.classList.remove('show');
    };
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
        showError('Enter a business name before saving.');
        $('c-business').focus();
        return;
      }
      if (body.abn && !abnValid(body.abn)) {
        showError('That ABN doesn’t check out — it should be 11 digits, as shown on the ABN Lookup.');
        $('c-abn').focus();
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
          showError('There’s already a client called “' + clash.businessName + '”. Edit that one instead, or use a different name.');
          $('c-business').focus();
          return;
        }
        const reply = client
          ? await LSCApi.put('/api/clients/' + encodeURIComponent(client.id), body)
          : await LSCApi.post('/api/clients', body);
        Toast.ok('Client saved.');
        if (!onScreen()) return;
        showEditor(reply.client);
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
        showList();
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
    // re-registers the watcher against a fresh baseline.
    const leave = () => {
      if (!LSCUnsaved.confirmLeave()) return;
      showList();
    };
    $('js-back').addEventListener('click', leave);
    $('js-cancel').addEventListener('click', leave);
    $('js-save').addEventListener('click', save);
    if ($('js-delete')) $('js-delete').addEventListener('click', remove);
    $('c-business').focus();

    if (client) loadHistory(client);
  }

  return {
    mount(container, options) {
      root = container;
      handlers = options;
      showList();
    },
  };
})();
