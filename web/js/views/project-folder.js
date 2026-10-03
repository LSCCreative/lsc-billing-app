'use strict';

/* #/projects/<id> — the project folder (production-booking task 18; D28, D31,
 * D58; IA "Project folder"). Everything one job holds, in four in-page
 * sections rather than tabs, so the stage is always in sight:
 *
 *   Overview         UPID, name, client, the stage line, and the ONE next
 *                    action as the primary button; the quiet actions under it.
 *   Production days  a compact, read-only list; each row opens the editor at
 *                    that day's card.
 *   Documents        the estimate, its Cost Breakdown, and the invoices.
 *   Activity         this project's log, newest first.
 *
 * It is one read, GET /api/projects/:id, and every action answers with the
 * folder as it then stands, so the screen redraws from that reply rather than
 * patching itself. The stage line is ProjectCard.stageMarkup over the same
 * summary the Projects list prints, so the two can't disagree.
 *
 * STAGE D'S STAND-INS. "Mark sent" records a send the owner made by email
 * (Stage E sends from the app). Accepting and invoices are task 19's and 20's:
 * their actions join nextAction() and the Documents rows then.
 */

const ProjectFolder = (() => {
  const { esc, fmt } = LSCUtil;
  const C = LSCCalendar;

  // A sent estimate is valid this long by default (D44); Settings makes it a
  // setting at task 21.
  const VALID_DAYS = 30;

  let root = null;
  let handlers = null;
  let folder = null; // the reply on screen
  let busy = false; // an action in flight: every action button waits on it

  const $ = (id) => root.querySelector('#' + id);
  const onScreen = () => Boolean(root && root.querySelector('#project-folder'));
  const pathOf = (id) => '/projects/' + encodeURIComponent(id);
  const lead = () => (folder && folder.estimates[0]) || null;

  /* Where one estimate's editor or read-only view is. The lead (the one the
     project is named by) is plain `estimate`; another estimate of a group
     the fix-up kept together carries its id. */
  function estimatePath(project, estimate, view) {
    return pathOf(project.id) + '/estimate' +
      (estimate.id === project.estimateId ? '' : '/' + encodeURIComponent(estimate.id)) +
      (view ? '/view' : '');
  }

  function failureText(err) {
    return err.kind === 'network' ? 'the server is unreachable.' : (err.message || 'the server refused.');
  }

  // ── Overview ────────────────────────────────────────────────────────────

  const hasLiveInvoice = () => folder.invoices.some((i) => i.status !== 'void');

  /* The one next action (IA: it changes with the stage). Accepting (task 19)
     and invoices (task 20) arrive here. */
  function nextAction(project) {
    switch (project.stage) {
      case 'draft': return { id: 'edit', label: 'Edit estimate' };
      case 'sent': return { id: 'edit', label: 'Edit estimate' };
      case 'declined': return { id: 'reopen', label: 'Reopen' };
      default: return { id: 'view', label: 'View estimate' };
    }
  }

  /* Forward actions beside the primary one. */
  function moreActions(project) {
    if (project.stage === 'draft') return [{ id: 'sent', label: 'Mark sent…' }];
    if (project.stage === 'sent') return [{ id: 'sent', label: 'Mark sent again…' }];
    return [];
  }

  function headMarkup(project, today) {
    const client = project.client || {};
    const upid = project.upid
      ? esc(project.upid)
      : project.needsUpid ? 'UPID needed' : 'No UPID yet';
    const next = project.nextDay;
    const facts = [
      ['Total (inc GST)', fmt(project.totalIncGst)],
      next && C.isDate(next.date)
        ? ['Next production day', C.statusChip(next.status) + '<span>' +
          esc(next.date === today ? 'Today' : C.longDate(next.date, today)) + '</span>']
        : null,
      project.estimateCount > 1 ? ['Estimates', String(project.estimateCount)] : null,
    ].filter(Boolean);
    return (
      '<div class="pf-overview">' +
      '<div class="est-upid' + (project.upid ? '' : ' pf-upid-missing') + '">' + upid + '</div>' +
      '<h1 class="est-name">' + esc(project.name || 'Untitled') + '</h1>' +
      (client.businessName || client.contactName
        ? '<div class="est-client">' + esc([client.businessName, client.contactName].filter(Boolean).join(' · ')) + '</div>'
        : '') +
      '<div class="pf-stage">' + ProjectCard.stageMarkup(project, today) + '</div>' +
      '<dl class="pf-facts">' + facts.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>' +
      '</div>'
    );
  }

  function actionsMarkup(project) {
    const primary = nextAction(project);
    const quiet = [];
    if (project.stage !== 'declined' && !hasLiveInvoice()) quiet.push({ id: 'decline', label: 'Decline…' });
    if (lead()) quiet.push({ id: 'duplicate', label: 'Duplicate as new project' });
    quiet.push({ id: 'delete', label: 'Delete…', danger: true });
    const btn = (a, cls) =>
      '<button type="button" class="btn ' + cls + '" data-act="' + a.id + '" data-write>' +
      '<span class="spinner"></span>' + esc(a.label) + '</button>';
    return (
      '<div class="pf-actions">' +
      '<div class="pf-actions-main">' +
      btn(primary, 'btn-accent') +
      moreActions(project).map((a) => btn(a, 'btn-ghost')).join('') +
      '</div>' +
      '<div class="pf-actions-quiet">' +
      quiet.map((a) => btn(a, (a.danger ? 'btn-danger' : 'btn-ghost') + ' btn-sm')).join('') +
      '</div>' +
      '</div>' +
      '<div class="pf-action-error" id="pf-action-error" role="alert"></div>'
    );
  }

  function noticeMarkup(project, today) {
    let html = '';
    if (project.needsUpid) {
      html +=
        '<div class="upid-banner" role="note"><p><strong>This project needs a UPID</strong> before invoicing ' +
        'can be used. It shares one with another estimate, or has none.</p>' +
        '<button type="button" class="btn btn-sm" id="js-fix-upid">Fix now</button></div>';
    }
    if (project.stage === 'declined') {
      html +=
        '<p class="pf-notice">Declined' + (project.declinedAt ? ' on ' + esc(C.longDate(ProjectCard.localDate(project.declinedAt), today)) : '') +
        '. Its production days are off every calendar and lock no dates. Reopen it to put them back.</p>';
    }
    return html;
  }

  // ── Production days ─────────────────────────────────────────────────────

  /* Every estimate's days in one list, dated ones in order and Date TBC
     last, each with the production items on it (as the calendar tiles list
     them). */
  function daysMarkup(project, today) {
    const rows = [];
    folder.estimates.forEach((estimate) => {
      const prod = (estimate.activeRows && estimate.activeRows.prod) || [];
      (estimate.days || []).forEach((day, i) => rows.push({
        estimate, day, i,
        items: prod.filter((l) => l && l.dayId === day.id).map((l) => String(l.name || '').trim()).filter(Boolean),
      }));
    });
    rows.sort((a, b) =>
      (a.day.date === null) - (b.day.date === null) ||
      String(a.day.date || '').localeCompare(String(b.day.date || '')) ||
      String(a.day.startTime || '').localeCompare(String(b.day.startTime || '')) ||
      a.i - b.i);
    const declined = project.stage === 'declined';
    const head =
      '<div class="pf-section-head"><h2 class="pf-h2" id="pf-days-h">Production days</h2>' +
      (rows.length ? '<span class="pf-count">' + rows.length + '</span>' : '') + '</div>';
    if (!rows.length) {
      return head + '<p class="pf-empty">None booked. Book days in the estimate’s Production Booking.</p>';
    }
    const many = folder.estimates.length > 1;
    return head +
      (declined ? '<p class="pf-hint">Off every calendar while the project is declined.</p>' : '') +
      '<ol class="pf-days' + (declined ? ' is-declined' : '') + '">' + rows.map(({ estimate, day, i, items }) => {
        const when = day.date ? C.longDate(day.date, today) : 'Day ' + (i + 1) + ' — date TBC';
        const times = day.startTime || day.endTime ? C.timeText(day) : '';
        return (
          '<li><button type="button" class="pf-day" data-estimate="' + esc(estimate.id) + '" data-day="' + esc(day.id) + '">' +
          '<span class="pf-day-when">' + C.statusChip(day.status) + '<span class="pf-day-date">' + esc(when) + '</span>' +
          (times ? '<span class="pf-day-time">' + esc(times) + '</span>' : '') + '</span>' +
          '<span class="pf-day-items">' +
          (items.length ? esc(items.join(', ')) : '<span class="pf-muted">No production items yet</span>') +
          (many ? '<span class="pf-muted"> · ' + esc(estimate.name || 'Untitled') + '</span>' : '') +
          (day.overrideNote ? '<span class="pf-day-note">Note: ' + esc(day.overrideNote) + '</span>' : '') +
          '</span>' +
          '<span class="pf-day-go" aria-hidden="true">Edit →</span>' +
          '</button></li>'
        );
      }).join('') + '</ol>';
  }

  // ── Documents ───────────────────────────────────────────────────────────

  const ESTIMATE_STATUS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' };
  const INVOICE_KIND = { deposit: 'Deposit invoice', final: 'Final invoice', single: 'Invoice', legacy: 'Invoice' };
  const INVOICE_STATUS = { draft: 'Not sent', scheduled: 'Scheduled', sent: 'Sent', paid: 'Paid', void: 'Void' };

  function docRow(doc) {
    return (
      '<li class="pf-doc">' +
      '<div class="pf-doc-main">' +
      '<span class="pf-doc-name">' + doc.name + '</span>' +
      (doc.meta ? '<span class="pf-doc-meta">' + doc.meta + '</span>' : '') +
      '</div>' +
      (doc.amount !== undefined ? '<span class="pf-doc-amount">' + doc.amount + '</span>' : '') +
      '<div class="pf-doc-acts">' + doc.actions.map((a) =>
        '<button type="button" class="btn btn-ghost btn-xs" data-doc="' + a.id + '" data-id="' + esc(a.target) + '"' +
        (a.label2 ? ' aria-label="' + esc(a.label2) + '"' : '') + '>' +
        '<span class="spinner"></span>' + esc(a.label) + '</button>').join('') +
      '</div></li>'
    );
  }

  function documentsMarkup(project, today) {
    const many = folder.estimates.length > 1;
    const docs = [];
    folder.estimates.forEach((e) => {
      const title = 'Estimate' + (many ? ' — ' + esc(e.name || 'Untitled') : '');
      docs.push({
        name: title,
        meta: esc(ESTIMATE_STATUS[e.status] || e.status) + ' · changed ' + esc(ProjectCard.dayMonth(e.updatedAt, today)),
        amount: fmt((e.totals || {}).totalIncGst),
        actions: [
          { id: 'view', label: 'View', target: e.id, label2: 'View the estimate' + (many ? ' ' + (e.name || '') : '') },
          { id: 'edit', label: 'Edit', target: e.id, label2: 'Edit the estimate' + (many ? ' ' + (e.name || '') : '') },
          { id: 'pdf', label: '↓ PDF', target: e.id, label2: 'Download the estimate PDF' },
        ],
      });
      docs.push({
        name: 'Cost Breakdown' + (many ? ' — ' + esc(e.name || 'Untitled') : ''),
        meta: 'For you only: how the price is made up',
        actions: [{ id: 'breakdown', label: '↓ PDF', target: e.id, label2: 'Download the Cost Breakdown PDF' }],
      });
    });
    folder.invoices.forEach((inv) => {
      const legacy = inv.kind === 'legacy';
      docs.push({
        name: esc(INVOICE_KIND[inv.kind] || 'Invoice') + (inv.number ? ' <span class="pf-doc-num">' + esc(inv.number) + '</span>' : ''),
        meta: legacy
          ? (inv.status === 'paid' ? 'Paid · ' : '') + 'Made the old way'
          : esc(INVOICE_STATUS[inv.status] || inv.status) +
            (inv.status === 'paid' && inv.paidAt ? ' ' + esc(ProjectCard.dayMonth(inv.paidAt, today)) : ''),
        amount: fmt(inv.totalIncGst),
        // An old invoice prints from the estimate row it was made from, as it always did.
        actions: legacy && inv.estimateId
          ? [{ id: 'legacy-pdf', label: '↓ PDF', target: inv.estimateId, label2: 'Download invoice ' + (inv.number || '') + ' PDF' }]
          : [],
      });
    });
    return (
      '<div class="pf-section-head"><h2 class="pf-h2" id="pf-docs-h">Documents</h2></div>' +
      '<ul class="pf-docs">' + docs.map(docRow).join('') + '</ul>' +
      '<div class="pf-doc-error" id="pf-doc-error" role="alert"></div>'
    );
  }

  // ── Activity ────────────────────────────────────────────────────────────

  function activityText(entry, today) {
    const d = entry.detail || {};
    switch (entry.kind) {
      case 'sent': return 'Marked sent' + (C.isDate(d.validUntil) ? ', valid until ' + ProjectCard.dayMonth(d.validUntil, today) : '');
      case 'declined': return 'Declined';
      case 'reopened': return 'Reopened';
      default: return entry.kind.charAt(0).toUpperCase() + entry.kind.slice(1).replace(/_/g, ' ');
    }
  }

  /* When it happened, on this browser's clock: `at` is UTC, and an evening
     here is the next morning there. */
  function whenText(at, today) {
    const local = new Date(at);
    if (!Number.isFinite(local.getTime())) return '';
    return ProjectCard.dayMonth(at, today) + ', ' +
      local.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  }

  function activityMarkup(today) {
    const head = '<div class="pf-section-head"><h2 class="pf-h2" id="pf-activity-h">Activity</h2></div>';
    if (!folder.activity.length) {
      return head + '<p class="pf-empty">Nothing recorded yet. Marking it sent, declining and reopening show here.</p>';
    }
    return head + '<ol class="pf-activity">' + folder.activity.map((a) =>
      '<li><span class="pf-act-when">' + esc(whenText(a.at, today)) + '</span>' +
      '<span class="pf-act-what">' + esc(activityText(a, today)) + '</span></li>').join('') + '</ol>';
  }

  // ── The screen ──────────────────────────────────────────────────────────

  function draw() {
    const today = LSCUtil.today();
    const project = folder.project;
    root.innerHTML =
      '<div id="project-folder" class="project-folder">' +
      '<button class="back-btn" id="js-back">← All Projects</button>' +
      '<section class="pf-head" aria-label="Overview">' +
      headMarkup(project, today) + actionsMarkup(project) +
      '</section>' +
      noticeMarkup(project, today) +
      '<div class="pf-body">' +
      '<section class="pf-days-section" aria-labelledby="pf-days-h">' + daysMarkup(project, today) + '</section>' +
      '<section class="pf-docs-section" aria-labelledby="pf-docs-h">' + documentsMarkup(project, today) + '</section>' +
      '<section class="pf-activity-section" aria-labelledby="pf-activity-h">' + activityMarkup(today) + '</section>' +
      '</div></div>';
    document.title = (project.upid ? project.upid + ' · ' : '') + (project.name || 'Project') + ' — LSC Billing';
    bind();
  }

  function bind() {
    $('js-back').addEventListener('click', () => LSCRouter.leaveTo('/projects'));
    const fix = $('js-fix-upid');
    if (fix) fix.addEventListener('click', () => LSCRouter.go('/setup/upids'));
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act, b)));
    root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => runDoc(b.dataset.doc, b.dataset.id, b)));
    root.querySelectorAll('.pf-day').forEach((b) => b.addEventListener('click', () => {
      const estimate = folder.estimates.find((e) => e.id === b.dataset.estimate);
      if (estimate) openEstimate(estimate, false, { focusDay: b.dataset.day });
    }));
  }

  function openEstimate(estimate, view, extra) {
    const project = folder.project;
    LSCRouter.go(estimatePath(project, estimate, view), {
      state: Object.assign({ estimate, project }, extra || {}),
    });
  }

  /* While an action is in flight its button spins and every other action
     waits, so two can't cross. */
  function setBusy(button, on) {
    busy = on;
    if (!onScreen()) return;
    root.querySelectorAll('[data-act]').forEach((b) => {
      b.disabled = on;
    });
    if (button && button.isConnected) {
      const spin = button.querySelector('.spinner');
      if (spin) spin.style.display = on ? 'inline-block' : 'none';
    }
  }

  function showActionError(message, extra) {
    const box = $('pf-action-error');
    if (!box) return;
    box.textContent = message;
    if (extra) box.append(' ', extra);
    box.classList.add('show');
  }

  function clearActionError() {
    const box = $('pf-action-error');
    if (!box) return;
    box.textContent = '';
    box.classList.remove('show');
  }

  /* An action's POST, then the folder it answers with. `ok` says what
     happened, in the toast. Returns the reply, or null when it failed. */
  async function post(action, body, button, working, ok) {
    if (busy) return null;
    const id = folder.project.id;
    clearActionError();
    setBusy(button, true);
    Toast.working(working);
    try {
      const reply = await LSCApi.post('/api/projects/' + encodeURIComponent(id) + '/' + action +
        '?today=' + LSCUtil.today(), body);
      setBusy(button, false);
      Toast.ok(typeof ok === 'function' ? ok(reply) : ok);
      if (onScreen() && folder.project.id === id) {
        folder = reply;
        draw();
        const again = root.querySelector('[data-act]');
        if (again) again.focus();
      }
      return reply;
    } catch (err) {
      setBusy(button, false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') {
        handlers.onAuthLost({ keepScreen: true });
        return null;
      }
      if (err.status === 404) {
        showMissing();
        return null;
      }
      return Promise.reject(err);
    }
  }

  async function runAction(id, button) {
    if (busy) return;
    const estimate = lead();
    if (id === 'edit' && estimate) return openEstimate(estimate, false);
    if (id === 'view' && estimate) return openEstimate(estimate, true);
    if (id === 'sent') return openMarkSent(button);
    if (id === 'decline') return openConfirm(button, {
      title: 'Decline this project?',
      body: 'Its production days come off every calendar and stop locking their dates. You can reopen it later; ' +
        'the days then go back through the clash check.',
      confirm: 'Decline',
      danger: true,
      run: (b) => post('decline', undefined, b, 'Declining…', 'Declined. Its days are off the calendars.'),
    });
    if (id === 'reopen') return reopen(button);
    if (id === 'duplicate') return duplicate(button);
    if (id === 'delete') return openConfirm(button, {
      title: 'Delete this project?',
      body: 'This deletes ' + describeContents() + '. It can’t be undone.',
      confirm: 'Delete project',
      danger: true,
      run: remove,
    });
    return undefined;
  }

  function describeContents() {
    const n = folder.estimates.length;
    const parts = [n === 1 ? 'its estimate' : 'its ' + n + ' estimates'];
    const days = folder.estimates.reduce((sum, e) => sum + (e.days || []).length, 0);
    if (days) parts.push(days === 1 ? 'its production day' : 'its ' + days + ' production days');
    if (folder.invoices.length) parts.push(folder.invoices.length === 1 ? 'its invoice' : 'its ' + folder.invoices.length + ' invoices');
    if (folder.activity.length) parts.push('its activity log');
    return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  async function reopen(button) {
    try {
      await post('reopen', undefined, button, 'Reopening…', (reply) => {
        const soft = reply.pencilled || [];
        return soft.length
          ? 'Reopened. ' + soft.map((c) => C.shortDate(c.date)).join(', ') + ' ' + (soft.length === 1 ? 'is' : 'are') +
            ' also pencilled for ' + (soft[0].upid || 'another project') + '.'
          : 'Reopened. Its days are back on the calendars.';
      });
    } catch (err) {
      if (err.code === 'date_locked') {
        /* A date confirmed meanwhile by another project: moving the day, or a
           specification note on it (D16), lets the reopen through. */
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn btn-ghost btn-xs';
        open.textContent = 'Open the estimate';
        const clash = ((err.data && err.data.clashes) || [])[0];
        open.addEventListener('click', () => {
          const owner = clash && folder.estimates.find((e) => (e.days || []).some((d) => d.date === clash.date));
          const day = owner && owner.days.find((d) => d.date === clash.date);
          openEstimate(owner || lead(), false, day ? { focusDay: day.id } : null);
        });
        const all = (err.data && err.data.clashes) || [];
        const more = all.length - 1;
        showActionError(clash
          ? C.shortDate(clash.date) + ' is now confirmed for ' + (clash.upid || clash.name || 'another project') +
            (more > 0 ? ' (and ' + more + ' more date' + (more === 1 ? '' : 's') + ')' : '') +
            '. Move that day, or add a specification note to it, then reopen.'
          : err.message, open);
      } else {
        showActionError('Couldn’t reopen: ' + failureText(err));
      }
    }
  }

  async function duplicate(button) {
    const estimate = lead();
    if (!estimate || busy) return;
    clearActionError();
    setBusy(button, true);
    Toast.working('Duplicating…');
    try {
      const reply = await LSCApi.post('/api/estimates/' + encodeURIComponent(estimate.id) + '/duplicate');
      setBusy(button, false);
      /* A copy has no days (D60), so any day and time rates the original
         carried are gone until its items are booked again. Said, not hidden. */
      Toast.ok(reply.unbooked
        ? 'Duplicated. Its ' + reply.unbooked + ' production ' + (reply.unbooked === 1 ? 'item is' : 'items are') +
          ' off their days and priced at the standard rate until you book ' + (reply.unbooked === 1 ? 'it' : 'them') + '.'
        : 'Duplicated — give the copy its own UPID.');
      handlers.onEditCopy(reply.estimate, { upid: estimate.upid, name: estimate.name });
    } catch (err) {
      setBusy(button, false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showActionError('Couldn’t duplicate: ' + failureText(err));
    }
    return undefined;
  }

  async function remove(button) {
    const id = folder.project.id;
    if (busy) return false;
    setBusy(button, true);
    Toast.working('Deleting…');
    try {
      await LSCApi.del('/api/projects/' + encodeURIComponent(id));
      setBusy(button, false);
      Toast.ok('Project deleted.');
      closeDialog(false);
      if (onScreen() && folder.project.id === id) LSCRouter.go('/projects', { replace: true, skipGuard: true });
      return true;
    } catch (err) {
      setBusy(button, false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') {
        handlers.onAuthLost({ keepScreen: true });
        return null;
      }
      if (err.status === 404) {
        showMissing();
        return null;
      }
      return Promise.reject(err);
    }
  }

  // ── The dialog (Mark sent, Decline, Delete) ─────────────────────────────

  const dlg = { overlay: null, opener: null, run: null, working: false };

  function onDlgKeydown(event) {
    if (dlg.overlay.closest('[hidden]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!dlg.working) closeDialog(true);
      return;
    }
    LSCModal.trapTab(dlg.overlay, event);
  }
  function onDlgClick(event) {
    if (event.target === dlg.overlay && !dlg.working) closeDialog(true);
  }

  function closeDialog(returnFocus) {
    const o = dlg.overlay;
    if (!o || !o.classList.contains('open')) return;
    o.classList.remove('open');
    o.innerHTML = '';
    document.removeEventListener('keydown', onDlgKeydown);
    o.removeEventListener('click', onDlgClick);
    if (returnFocus && dlg.opener && dlg.opener.isConnected) dlg.opener.focus();
    dlg.opener = null;
    dlg.working = false;
  }

  /* body: the dialog's own markup between its title and actions. run(button)
     resolves when done (null: a 401 or 404 already dealt with, which closes
     it too); a rejection's message is shown in the dialog, which stays. */
  function openDialog(opener, opts) {
    dlg.overlay = document.getElementById('modal-project');
    if (!dlg.overlay) return;
    closeDialog(false);
    dlg.opener = opener || null;
    dlg.overlay.innerHTML =
      '<div class="modal-box pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pfd-title"' +
      (opts.describe ? ' aria-describedby="pfd-body"' : '') + '>' +
      '<h2 class="modal-title" id="pfd-title">' + esc(opts.title) + '</h2>' +
      '<div id="pfd-body" class="pfd-body">' + opts.body + '</div>' +
      '<div class="pfd-error" id="pfd-error" role="alert"></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="pfd-cancel">Cancel</button>' +
      '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-accent') + '" id="pfd-ok">' +
      '<span class="spinner" id="pfd-spin"></span>' + esc(opts.confirm) + '</button>' +
      '</div></div>';
    dlg.overlay.classList.add('open');
    document.addEventListener('keydown', onDlgKeydown);
    dlg.overlay.addEventListener('click', onDlgClick);
    const q = (id) => dlg.overlay.querySelector('#' + id);
    q('pfd-cancel').addEventListener('click', () => closeDialog(true));
    q('pfd-ok').addEventListener('click', async () => {
      if (dlg.working) return;
      const error = q('pfd-error');
      error.textContent = '';
      const ok = q('pfd-ok');
      dlg.working = true;
      ok.disabled = true;
      q('pfd-cancel').disabled = true;
      q('pfd-spin').style.display = 'inline-block';
      try {
        await opts.run(ok);
        closeDialog(false);
        // The screen was redrawn: focus is on its first action (post), or it left.
      } catch (err) {
        dlg.working = false;
        if (!dlg.overlay.classList.contains('open')) return;
        ok.disabled = false;
        q('pfd-cancel').disabled = false;
        q('pfd-spin').style.display = 'none';
        if (err && err.message) error.textContent = err instanceof LSCApi.ApiError ? failureText(err) : err.message;
      }
    });
    if (opts.onOpen) opts.onOpen(q);
    (opts.focus ? q(opts.focus) : q('pfd-cancel')).focus();
  }

  function openConfirm(opener, opts) {
    openDialog(opener, {
      title: opts.title,
      body: '<p class="pfd-text">' + esc(opts.body) + '</p>',
      describe: true,
      confirm: opts.confirm,
      danger: opts.danger,
      run: opts.run,
    });
  }

  /* Mark sent (Stage D): the owner emailed the PDF themselves, and records
     it here with the date it's valid until (D44, 30 days by default). */
  function openMarkSent(opener) {
    const today = LSCUtil.today();
    const stage = folder.project.stage;
    const until = C.addDays(today, VALID_DAYS);
    openDialog(opener, {
      title: stage === 'sent' ? 'Mark sent again' : 'Mark sent',
      body:
        '<p class="pfd-text" id="pfd-desc">Download the estimate’s PDF and email it to the client, then record it ' +
        'here. Sending from the app comes later.</p>' +
        '<p class="pfd-pdf"><button type="button" class="btn btn-ghost btn-sm" id="pfd-pdf">' +
        '<span class="spinner"></span>↓ Estimate PDF</button></p>' +
        '<div class="field"><label for="pfd-until">Valid until</label>' +
        '<input id="pfd-until" type="date" value="' + esc(until) + '" min="' + esc(today) + '" aria-describedby="pfd-until-hint">' +
        '<p class="pfd-hint" id="pfd-until-hint">After this date the estimate reads as expired.</p></div>',
      describe: true,
      confirm: 'Mark sent',
      focus: 'pfd-until',
      onOpen: (q) => {
        const pdf = q('pfd-pdf');
        pdf.addEventListener('click', () => {
          const estimate = lead();
          if (estimate) download('pdf', estimate.id, pdf, (msg) => { q('pfd-error').textContent = msg; });
        });
      },
      run: async (b) => {
        const field = dlg.overlay.querySelector('#pfd-until');
        const value = field.value;
        if (!C.isDate(value)) {
          field.focus();
          throw new Error('Choose the date it’s valid until.');
        }
        if (value < today) {
          field.focus();
          throw new Error('Valid until can’t be before today.');
        }
        return post('sent', { validUntil: value }, b, 'Saving…',
          'Marked sent, valid until ' + ProjectCard.dayMonth(value, today) + '.');
      },
    });
  }

  // ── Downloads ───────────────────────────────────────────────────────────

  async function runDoc(kind, id, button) {
    const estimate = folder.estimates.find((e) => e.id === id);
    if (kind === 'view' && estimate) return openEstimate(estimate, true);
    if (kind === 'edit' && estimate) return openEstimate(estimate, false);
    return download(kind, id, button, showDocError);
  }

  function showDocError(message, withSettings) {
    const box = $('pf-doc-error');
    if (!box) return;
    box.textContent = message;
    if (withSettings) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-ghost btn-xs';
      open.textContent = 'Open Invoice Settings';
      open.addEventListener('click', () => SettingsView.open({ onAuthLost: handlers.onAuthLost }, open));
      box.append(' ', open);
    }
    box.classList.add('show');
  }

  /* `kind`: pdf (the estimate, printed as an estimate even if it is an old
     invoice-typed row: D62), breakdown (its Cost Breakdown), legacy-pdf (that
     old row printed as the invoice it was made as). */
  async function download(kind, estimateId, button, report) {
    if (button.disabled) return;
    const spin = button.querySelector('.spinner');
    button.disabled = true;
    if (spin) spin.style.display = 'inline-block';
    const box = $('pf-doc-error');
    if (box) {
      box.textContent = '';
      box.classList.remove('show');
    }
    const breakdown = kind === 'breakdown';
    const what = breakdown ? 'the Cost Breakdown' : kind === 'legacy-pdf' ? 'the invoice PDF' : 'the PDF';
    Toast.working(breakdown ? 'Generating the Cost Breakdown…' : 'Generating PDF…');
    try {
      const base = '/api/estimates/' + encodeURIComponent(estimateId);
      const reply = breakdown
        ? await LSCApi.postPdf(base + '/cost-breakdown')
        : await LSCApi.postPdf(base + '/pdf', kind === 'pdf' ? { as: 'estimate' } : undefined);
      const estimate = folder.estimates.find((e) => e.id === estimateId) || {};
      const fallback = breakdown
        ? 'Cost Breakdown_' + (estimate.upid || 'EST') + '.pdf'
        : (kind === 'legacy-pdf' ? estimate.invoiceNumber || 'invoice' : estimate.upid || 'estimate') + '.pdf';
      LSCUtil.saveFile(reply.blob, reply.filename || fallback);
      Toast.ok(breakdown ? 'Cost Breakdown downloaded.' : 'PDF downloaded.');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      Toast.hide();
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      if (err.code === 'abn_required') report(err.message, true);
      else if (err.code === 'breakdown_stale') report(err.message);
      else if (err.code === 'pdf_unavailable') report('Couldn’t make ' + what + ' — the server has no PDF renderer. Check Chromium is installed in the container.');
      else if (err.status === 404) report('Couldn’t make ' + what + ' — that estimate no longer exists on the server.');
      else report('Couldn’t make ' + what + ': ' + failureText(err));
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        if (spin) spin.style.display = 'none';
      }
    }
    return undefined;
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  function placeholder(body) {
    folder = null;
    root.innerHTML =
      '<button class="back-btn" id="js-back">← All Projects</button>' +
      '<div class="empty-state">' + body + '</div>';
    root.querySelector('#js-back').addEventListener('click', () => LSCRouter.leaveTo('/projects'));
  }

  /* A project that's gone says so where it was asked for (IA, router rules). */
  function showMissing() {
    closeDialog(false);
    placeholder('<h3>That project was deleted</h3><p>Your other projects are in the list.</p>');
  }

  async function load(id) {
    const ticket = LSCRouter.ticket();
    window.scrollTo(0, 0);
    placeholder('<h3>Loading…</h3>');
    try {
      const reply = await LSCApi.get('/api/projects/' + encodeURIComponent(id) + '?today=' + LSCUtil.today());
      if (!LSCRouter.isCurrent(ticket)) return;
      folder = reply;
      busy = false;
      draw();
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket)) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      if (err.status === 404) return showMissing();
      placeholder('<h3>Couldn’t open that project</h3><p>' + esc(failureText(err)) + '</p>' +
        '<button type="button" class="btn" id="js-retry" style="margin-top:16px">Try Again</button>');
      root.querySelector('#js-retry').addEventListener('click', () => load(id));
    }
    return undefined;
  }

  return {
    /* Once per sign-in. handlers: { onAuthLost, onEditCopy(copy, from) }. */
    init(container, options) {
      root = container;
      handlers = options;
    },

    /* The router's way in, with the project id. */
    show(id) {
      closeDialog(false);
      load(id);
      return true;
    },

    estimatePath,
    closeDialog,
  };
})();
