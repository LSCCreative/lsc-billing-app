'use strict';

/* The UPID fix-up, #/setup/upids (production-booking task 16; D61, IA flow 7).
 *
 * v13 gave every estimate whose UPID was shared, or blank, a project of its
 * own that waits here for a UPID. Nothing was guessed. This screen lists them
 * in groups, one per shared UPID and one per blank estimate, and the owner
 * settles each group on its own: a UPID per estimate, or "Keep together" for
 * a group that really is one job (server/src/routes/setup.js has the rules).
 *
 * EACH FIELD STARTS ON THE UPID THE ESTIMATE HAS NOW, so what is on screen is
 * what each estimate will be called: one of a pair can keep the shared UPID
 * while the other is changed, and a group of one (a sibling was since renamed
 * in the editor) is confirmed by saving it as it is.
 *
 * The route lasts only while a group is left (D61). Arriving with none, or
 * settling the last one, goes to the list.
 */

const SetupView = (() => {
  const { fmt, esc } = LSCUtil;

  let root = null;
  let onAuthLost = null;

  const LIST = '/estimates';
  const STATUS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' };

  // Per mount, so ids stay unique however many times the screen is drawn.
  let serial = 0;

  function dateText(ymd) {
    if (!LSCCalendar.isDate(ymd)) return '';
    const [y, m, d] = ymd.split('-').map(Number);
    return d + ' ' + LSCCalendar.MONTHS[m - 1].slice(0, 3) + ' ' + y;
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const countText = (n) => plural(n, 'project needs', 'projects need') + ' a UPID';
  const quoted = (name) => '“' + (name || 'Untitled') + '”';

  function kicker(group) {
    const n = group.estimates.length;
    if (!group.upid) return 'Saved without one';
    if (n === 1) return 'Used by this estimate alone now';
    return 'Shared by ' + n + ' estimates';
  }

  function metaText(e) {
    const bits = [e.client || 'No client', dateText(e.date) || 'No date', STATUS[e.status] || e.status];
    // Made with the retired Document Type switch (D62): it went out as an invoice.
    if (e.docType === 'invoice') bits.push(e.invoiceNumber ? 'Invoice ' + e.invoiceNumber : 'Invoice');
    return bits.filter(Boolean).join(' · ');
  }

  function rowMarkup(e, gid, i) {
    const id = gid + '-in-' + i;
    return (
      '<li class="fix-row" data-estimate="' + esc(e.id) + '">' +
      '<div class="fix-row-main">' +
      '<div class="fix-row-name" id="' + id + '-name">' + esc(e.name || 'Untitled') + '</div>' +
      '<div class="fix-row-meta">' + esc(metaText(e)) + '</div>' +
      '</div>' +
      '<div class="fix-row-total">' + (e.totalIncGst == null ? '—' : fmt(e.totalIncGst)) + '</div>' +
      '<div class="field fix-row-field">' +
      '<label for="' + id + '">UPID<span class="sr-only"> for ' + esc(e.name || 'Untitled') + '</span></label>' +
      '<input id="' + id + '" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" ' +
      'value="' + esc(String(e.upid || '').trim()) + '">' +
      '</div>' +
      '</li>'
    );
  }

  function groupMarkup(group) {
    serial += 1;
    const gid = 'fg' + serial;
    const n = group.estimates.length;
    return (
      '<section class="fix-group" data-key="' + esc(group.key) + '" aria-labelledby="' + gid + '-title">' +
      '<header class="fix-group-head">' +
      '<h2 class="fix-group-upid' + (group.upid ? '' : ' is-blank') + '" id="' + gid + '-title" tabindex="-1">' +
      (group.upid ? esc(group.upid) : 'No UPID') + '</h2>' +
      '<div class="fix-group-kicker">' + esc(kicker(group)) + '</div>' +
      '</header>' +
      '<ol class="fix-rows">' + group.estimates.map((e, i) => rowMarkup(e, gid, i)).join('') + '</ol>' +
      (group.clientsDiffer
        ? '<p class="fix-note">These are for different clients, so they can’t be one project. Give each its own UPID.</p>'
        : '') +
      '<div class="fix-error" id="' + gid + '-err" role="alert"></div>' +
      '<div class="fix-actions">' +
      (group.canKeepTogether
        ? '<button type="button" class="btn btn-ghost" data-act="keep" data-write>Keep together as one project</button>'
        : '') +
      '<button type="button" class="btn btn-accent" data-act="save" data-write>' +
      '<span class="spinner"></span>' + (n === 1 ? 'Save UPID' : 'Save UPIDs') + '</button>' +
      '</div>' +
      '</section>'
    );
  }

  function headMarkup(sub) {
    return (
      '<button class="back-btn" id="js-back">← All Estimates</button>' +
      '<div class="page-head"><div><h1 class="page-title">Give each project its own UPID</h1>' +
      '<div class="page-sub" id="fix-count">' + esc(sub) + '</div></div></div>'
    );
  }

  function markup(listing) {
    return (
      headMarkup(countText(listing.remaining)) +
      '<p class="fix-intro">Invoice numbers are built from the UPID, so from now on every project needs its own. ' +
      'These estimates share one, or have none. Give each estimate its own UPID, or, if a group is really one job, ' +
      'keep it together as one project. Each group saves on its own, and nothing changes until you save it.</p>' +
      '<div class="fix-groups" id="fix-groups">' + listing.groups.map(groupMarkup).join('') + '</div>'
    );
  }

  /* ── Wiring ─────────────────────────────────────────────────────────────── */

  const inputs = (section) => [...section.querySelectorAll('.fix-row input')];
  const rowName = (input) => document.getElementById(input.id + '-name').textContent;

  function setBusy(section, busy) {
    section.querySelectorAll('button, input').forEach((el) => {
      el.disabled = busy;
    });
    const spin = section.querySelector('[data-act="save"] .spinner');
    if (spin) spin.style.display = busy ? 'inline-block' : 'none';
  }

  function errorBox(section) {
    return section.querySelector('.fix-error');
  }

  function showError(section, msg, fields) {
    if (fields && fields.length) LSCUtil.showFieldErrors(errorBox(section), [{ msg, fields }]);
    else {
      LSCUtil.clearFieldErrors(errorBox(section));
      errorBox(section).textContent = msg;
      errorBox(section).classList.add('show');
    }
  }

  /* What the browser can tell before asking: a blank field, or two in the
     group on the same UPID. The server checks both again, and the rest. */
  function localProblem(section) {
    const fields = inputs(section);
    const blank = fields.find((f) => !f.value.trim());
    if (blank) return { msg: 'Give ' + quoted(rowName(blank)) + ' a UPID.', fields: [blank] };
    const seen = new Map();
    for (const f of fields) {
      const key = f.value.trim().toLowerCase();
      if (seen.has(key)) {
        const other = seen.get(key);
        const who = rowName(other) === rowName(f)
          ? 'Two of these estimates'
          : quoted(rowName(other)) + ' and ' + quoted(rowName(f));
        const canKeep = Boolean(section.querySelector('[data-act="keep"]'));
        return {
          msg: who + ' can’t both be ' + f.value.trim() + '. ' +
            (canKeep ? 'Change one, or keep them together if they’re one job.' : 'Change one.'),
          fields: [other, f],
        };
      }
      seen.set(key, f);
    }
    return null;
  }

  const fieldFor = (section, estimateId) => {
    const row = section.querySelector('.fix-row[data-estimate="' + CSS.escape(estimateId || '') + '"]');
    return row ? row.querySelector('input') : null;
  };

  /* A refusal, said beside the field it is about where there is one. */
  function explain(section, err) {
    const data = err.data || {};
    if (err.code === 'group_changed') {
      Toast.error('That group changed since this page loaded, so nothing was saved. Here it is as it stands now.');
      return mount(root);
    }
    if (err.code === 'upid_taken') {
      const field = fieldFor(section, data.estimateId);
      return showError(section, err.message || 'That UPID is already used by another project.', field ? [field] : null);
    }
    if (err.code === 'upid_repeated' || err.code === 'upid_required') {
      const problem = localProblem(section);
      if (problem) return showError(section, problem.msg, problem.fields);
    }
    if (err.code === 'clients_differ') {
      return showError(section, 'These estimates are for different clients, so they can’t be one project. Give each its own UPID.');
    }
    showError(
      section,
      err.kind === 'network'
        ? 'Couldn’t save — the server is unreachable. What you typed is still here.'
        : 'Couldn’t save: ' + (err.message || 'the server refused.')
    );
  }

  async function submit(section, body, label) {
    LSCUtil.clearFieldErrors(errorBox(section));
    setBusy(section, true);
    Toast.working('Saving…');
    let listing;
    try {
      listing = await LSCApi.post('/api/setup/upids', body);
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      Toast.hide();
      if (!section.isConnected) return;
      setBusy(section, false);
      if (err.kind === 'auth') return onAuthLost({ keepScreen: true });
      return explain(section, err);
    }
    if (!section.isConnected) return;
    settled(section, listing, label);
  }

  /* The group is done. Only its section goes, so anything typed in the others
     stays — unless the reply shows the list has moved under this page (a
     second tab), when it is drawn again as it stands. */
  function settled(section, listing, label) {
    const left = listing.remaining;
    if (!listing.groups.length) {
      Toast.ok(label + ' Every project has its own UPID now.');
      LSCRouter.leaveTo(LIST, { replace: true, skipGuard: true });
      return;
    }
    const message = label + ' ' + plural(left, 'project', 'projects') + ' to go.';
    Toast.ok(message);

    const sections = [...root.querySelectorAll('.fix-group')];
    const others = sections.filter((s) => s !== section).map((s) => s.dataset.key);
    const keys = listing.groups.map((g) => g.key);
    if (others.length !== keys.length || others.some((k) => keys.indexOf(k) === -1)) {
      draw(listing);
      root.querySelector('.fix-group-upid').focus();
      return;
    }
    const at = sections.indexOf(section);
    const next = sections[at + 1] || sections[at - 1];
    section.remove();
    // The toast (role="status") says it; a second live region would say it twice.
    root.querySelector('#fix-count').textContent = countText(left);
    next.querySelector('.fix-group-upid').focus();
  }

  function save(section) {
    const problem = localProblem(section);
    if (problem) return showError(section, problem.msg, problem.fields);
    const fields = inputs(section);
    const upids = fields.map((f) => ({ estimateId: f.closest('.fix-row').dataset.estimate, upid: f.value.trim() }));
    const label = fields.length === 1
      ? quoted(rowName(fields[0])) + ' is ' + fields[0].value.trim() + '.'
      : 'Saved ' + fields.map((f) => f.value.trim()).join(', ') + '.';
    submit(section, { key: section.dataset.key, upids }, label);
  }

  function keep(section) {
    const upid = section.querySelector('.fix-group-upid').textContent;
    const n = inputs(section).length;
    const sure = window.confirm(
      'Keep these ' + n + ' estimates together as one project, ' + upid + '?\n\n' +
      'They’ll share one project folder and, later, one set of invoices. ' +
      'There’s no splitting them up again from this screen.'
    );
    if (!sure) return;
    submit(section, { key: section.dataset.key, keepTogether: true }, upid + ' is one project of ' + n + ' estimates.');
  }

  function draw(listing) {
    serial = 0;
    root.innerHTML = markup(listing);
    root.querySelector('#js-back').addEventListener('click', () => LSCRouter.leaveTo(LIST));
    root.querySelectorAll('.fix-group').forEach((section) => {
      section.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-act]');
        if (!btn) return;
        if (btn.dataset.act === 'save') save(section);
        else keep(section);
      });
      // Enter in a field saves its group, as it would submit a form.
      section.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.matches('.fix-row input')) {
          event.preventDefault();
          save(section);
        }
      });
    });
    LSCUnsaved.watch('setup-upids', {
      label: 'the UPIDs you’ve typed',
      onScreen: () => Boolean(root && root.querySelector('#fix-groups')),
      dirty: () => [...root.querySelectorAll('.fix-row input')].some((f) => f.value.trim() !== f.defaultValue.trim()),
    });
  }

  async function mount(container) {
    root = container;
    window.scrollTo(0, 0);
    const ticket = LSCRouter.ticket();
    root.innerHTML = headMarkup('Loading…');
    root.querySelector('#js-back').addEventListener('click', () => LSCRouter.leaveTo(LIST));

    let listing;
    try {
      listing = await LSCApi.get('/api/setup/upids');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket)) return;
      if (err.kind === 'auth') return onAuthLost();
      root.innerHTML =
        headMarkup('Could not load') +
        '<div class="empty-state"><h3>Couldn’t load the estimates that need a UPID</h3><p>' +
        esc(err.kind === 'network' ? 'The server could not be reached.' : err.message || 'The server had a problem.') +
        '</p><button type="button" class="btn" id="js-retry" style="margin-top:16px">Try Again</button></div>';
      root.querySelector('#js-back').addEventListener('click', () => LSCRouter.leaveTo(LIST));
      root.querySelector('#js-retry').addEventListener('click', () => mount(root));
      return;
    }
    if (!LSCRouter.isCurrent(ticket)) return;

    // Nothing left to fix: the route has gone (D61).
    if (!listing.groups.length) {
      Toast.ok('Every project has its own UPID — there’s nothing left to fix.');
      LSCRouter.leaveTo(LIST, { replace: true, skipGuard: true });
      return;
    }
    draw(listing);
  }

  return {
    /* Once per sign-in. */
    init(container, options) {
      root = container;
      onAuthLost = options.onAuthLost;
    },

    /* The router's way in: segments after 'setup'. Only 'upids' exists. */
    show(segments) {
      if (segments.length !== 1 || segments[0] !== 'upids') return false;
      mount(root);
      return true;
    },
  };
})();
