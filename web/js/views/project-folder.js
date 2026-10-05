'use strict';

/* #/projects/<id> — the project folder (production-booking task 18; D28, D31,
 * D58; IA "Project folder"). Everything one job holds, in four in-page
 * sections rather than tabs, so the stage is always in sight:
 *
 *   Overview         UPID, name, client, the stage line, and the ONE next
 *                    action as the primary button; the quiet actions under it.
 *   Production days  a compact, read-only list; each row opens the editor at
 *                    that day's card.
 *   Documents        the estimate, its Cost Breakdown, the signed agreement,
 *                    and the invoices.
 *   Activity         this project's log, newest first.
 *
 * It is one read, GET /api/projects/:id, and every action answers with the
 * folder as it then stands, so the screen redraws from that reply rather than
 * patching itself. The stage line is ProjectCard.stageMarkup over the same
 * summary the Projects list prints, so the two can't disagree.
 *
 * SENDING (task 29). "Send v1…" opens the send panel (SendPanel, D43): it
 * emails the client's link now or later, or makes the version live for Copy
 * link. Each document row says where its email is ("Email scheduled Tue 8
 * Oct, 9:00 am · Change · Cancel email", D47) and has its own Send… and Copy
 * link. "Mark accepted" records a yes given outside the client's page (the
 * page's signing is the other way in), which confirms the days and makes the
 * invoices (task 19). Each invoice has its own page (InvoiceView, task 20),
 * where it is sent and marked paid, its extras edited, and a sent one voided
 * and remade; the folder's next action leads there once invoices exist.
 */

const ProjectFolder = (() => {
  const { esc, fmt } = LSCUtil;
  const C = LSCCalendar;

  // A sent estimate is valid this many days by default (D44): Settings →
  // Estimates & invoices (task 21).
  const validDays = () => LSCDocuments.docSettings(LSCData.settings()).validDays;

  let root = null;
  let handlers = null;
  let folder = null; // the reply on screen
  let busy = false; // an action in flight: every action button waits on it
  let following = null; // the follow-up look while an email goes (SendPanel.follow)
  let tries = 0;

  const $ = (id) => root.querySelector('#' + id);
  const onScreen = () => Boolean(root && root.querySelector('#project-folder'));
  const pathOf = (id) => '/projects/' + encodeURIComponent(id);
  const lead = () => (folder && folder.estimates[0]) || null;

  /* An email still waiting to go, or going: one at a time per document. */
  const waiting = (send) => Boolean(send && (send.status === 'scheduled' || send.status === 'sending'));
  const estimateWaiting = () => folder.estimates.some((e) => waiting(e.send));
  /* The version the next send makes ("Send v2…"). */
  const nextVersion = (e) => ((e && e.versions) || []).length + 1;
  /* A version of it is live: its link shows something a client can read. */
  const liveLink = (e) => Boolean(e.publicToken && (e.status === 'sent' || e.status === 'accepted') &&
    (e.versions || []).some((v) => !v.supersededAt));

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

  /* Accepted with no invoices: v13 mapped an old `approved` estimate there,
     and only "Create invoices" moves it on. */
  const needsInvoices = (project) => project.stage === 'accepted' && !folder.invoices.length;

  const INVOICE_ORDER = ['deposit', 'final', 'single', 'legacy'];

  /* The invoice the job is waiting on: the first unpaid one that isn't void,
     in the order projects.js projectStage reads them; null when all are paid. */
  function currentInvoice() {
    return folder.invoices
      .filter((i) => i.status !== 'void' && i.status !== 'paid')
      .sort((a, b) => INVOICE_ORDER.indexOf(a.kind) - INVOICE_ORDER.indexOf(b.kind) ||
        String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  }

  /* Its page, and what to do there (IA: "Mark deposit paid", "Edit final
     invoice"). A draft opens to be checked and sent; one that has gone out
     opens on Mark paid. */
  function invoiceAction(inv) {
    if (inv.kind === 'legacy') return { id: 'invoice', label: 'Mark paid…', target: inv.id, action: 'paid' };
    const word = { deposit: 'deposit', final: 'final', single: '' }[inv.kind];
    if (inv.status === 'draft') {
      return {
        id: 'invoice',
        target: inv.id,
        label: inv.kind === 'final' ? 'Edit final invoice' : inv.kind === 'deposit' ? 'Open deposit invoice' : 'Open invoice',
      };
    }
    return { id: 'invoice', target: inv.id, action: 'paid', label: 'Mark ' + (word ? word + ' ' : '') + 'paid…' };
  }

  /* The one next action (IA: it changes with the stage). */
  function nextAction(project) {
    if (needsInvoices(project)) return { id: 'invoices', label: 'Create invoices…' };
    const inv = project.stage === 'accepted' || project.stage === 'invoiced' ? currentInvoice() : null;
    if (inv) return invoiceAction(inv);
    switch (project.stage) {
      case 'draft': return estimateWaiting() || !lead()
        ? { id: 'edit', label: 'Edit estimate' }
        : { id: 'send', label: 'Send v' + nextVersion(lead()) + '…' };
      case 'sent': return { id: 'accept', label: 'Mark accepted…' };
      case 'declined': return { id: 'reopen', label: 'Reopen' };
      default: return { id: 'view', label: 'View estimate' };
    }
  }

  /* Forward actions beside the primary one. A draft can be accepted without
     being sent from here: the client may have said yes to a PDF. A second
     send waits until the first one's email has gone or been cancelled. */
  function moreActions(project) {
    const again = estimateWaiting() || !lead() ? [] : [{ id: 'send', label: 'Send v' + nextVersion(lead()) + '…' }];
    if (project.stage === 'draft') {
      return (nextAction(project).id === 'send' ? [{ id: 'edit', label: 'Edit estimate' }] : [])
        .concat([{ id: 'accept', label: 'Mark accepted…' }]);
    }
    if (project.stage === 'sent') return [{ id: 'edit', label: 'Edit estimate' }].concat(again);
    if (needsInvoices(project)) return [{ id: 'view', label: 'View estimate' }];
    if (nextAction(project).id === 'invoice') return [{ id: 'view', label: 'View estimate' }];
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
      '<button type="button" class="btn ' + cls + '" data-act="' + a.id + '"' +
      (a.target ? ' data-target="' + esc(a.target) + '"' : '') + (a.action ? ' data-then="' + esc(a.action) + '"' : '') +
      ' data-write><span class="spinner"></span>' + esc(a.label) + '</button>';
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
    // Proposed dates another project has confirmed since the quote went (C6, D41).
    const taken = new Map((project.takenDays || []).map((t) => [t.date, t]));
    const takenHint = taken.size
      ? '<p class="pf-hint pf-hint-alert" role="note">Your client can’t accept until they have new dates: ' +
        (taken.size === 1 ? 'a proposed date has' : taken.size + ' proposed dates have') +
        ' since been confirmed for another project. Move ' + (taken.size === 1 ? 'that day' : 'those days') +
        ' in the estimate and save; the update goes to your client as you save it.</p>'
      : '';
    return head +
      (declined ? '<p class="pf-hint">Off every calendar while the project is declined.</p>' : '') + takenHint +
      '<ol class="pf-days' + (declined ? ' is-declined' : '') + '">' + rows.map(({ estimate, day, i, items }) => {
        const when = day.date ? C.longDate(day.date, today) : 'Day ' + (i + 1) + ' — date TBC';
        const times = day.startTime || day.endTime ? C.timeText(day) : '';
        // Confirmed by accepting on a date another project had confirmed first (D18).
        const took = day.status === 'proposed' && day.date ? taken.get(day.date) : null;
        const rebook = day.rebook && !declined
          ? '<span class="pf-day-rebook">Clash, rebook — also confirmed for ' +
            esc(day.rebook.upid || day.rebook.name || 'another project') + '</span>'
          : took
            ? '<span class="pf-day-rebook">Taken — since confirmed for ' + esc(took.upid || took.name || 'another project') + '</span>'
            : '';
        return (
          '<li><button type="button" class="pf-day" data-estimate="' + esc(estimate.id) + '" data-day="' + esc(day.id) + '">' +
          '<span class="pf-day-when">' + C.statusChip(day.status) + '<span class="pf-day-date">' + esc(when) + '</span>' +
          (times ? '<span class="pf-day-time">' + esc(times) + '</span>' : '') + rebook + '</span>' +
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
      '<li class="pf-doc' + (doc.void ? ' is-void' : '') + '">' +
      '<div class="pf-doc-main">' +
      '<span class="pf-doc-name">' + doc.name + '</span>' +
      (doc.meta ? '<span class="pf-doc-meta">' + doc.meta + '</span>' : '') +
      (doc.status || '') +
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
    const sendable = project.stage === 'draft' || project.stage === 'sent';
    folder.estimates.forEach((e) => {
      const title = 'Estimate' + (many ? ' — ' + esc(e.name || 'Untitled') : '');
      const named = many ? ' ' + (e.name || 'Untitled') : '';
      const live = (e.versions || []).filter((v) => !v.supersededAt).pop();
      const actions = [
        { id: 'view', label: 'View', target: e.id, label2: 'View the estimate' + named },
        { id: 'edit', label: 'Edit', target: e.id, label2: 'Edit the estimate' + named },
        { id: 'pdf', label: '↓ PDF', target: e.id, label2: 'Download the estimate PDF' + (many ? ' for' + named : '') },
      ];
      // Only the lead is sent (the server sends the project's lead estimate).
      if (sendable && e.id === project.estimateId && !estimateWaiting()) {
        actions.push({ id: 'send', label: 'Send v' + nextVersion(e) + '…', target: e.id, label2: 'Send v' + nextVersion(e) + ' of the estimate' + named });
      }
      if (liveLink(e)) actions.push({ id: 'copy', label: 'Copy link', target: e.id, label2: 'Copy the client link to the estimate' + named });
      docs.push({
        name: title + (live ? ' <span class="pf-doc-num">v' + esc(String(live.n)) + '</span>' : ''),
        meta: esc(ESTIMATE_STATUS[e.status] || e.status) +
          (live && live.validUntil && e.status === 'sent' ? ' · valid until ' + esc(ProjectCard.dayMonth(live.validUntil, today)) : '') +
          ' · changed ' + esc(ProjectCard.dayMonth(e.updatedAt, today)),
        status: SendPanel.statusMarkup(e.send, 'the estimate' + named),
        amount: fmt((e.totals || {}).totalIncGst),
        actions,
      });
      docs.push({
        name: 'Cost Breakdown' + (many ? ' — ' + esc(e.name || 'Untitled') : ''),
        meta: 'For you only: how the price is made up',
        actions: [{ id: 'breakdown', label: '↓ PDF', target: e.id, label2: 'Download the Cost Breakdown PDF' + (many ? ' for ' + (e.name || 'Untitled') : '') }],
      });
    });
    // Signed service agreements (task 27, D42): the client's signature, kept
    // as the PDF they signed.
    (folder.signatures || []).forEach((sig) => {
      const v = sig.version > 1 ? ' v' + sig.version : '';
      docs.push({
        name: 'Signed agreement' + esc(v),
        meta: esc(sig.fullName + (sig.role ? ', ' + sig.role : '')) + ' · signed ' + esc(ProjectCard.dayMonth(sig.signedAt, today)),
        actions: [{ id: 'agreement', label: '↓ PDF', target: sig.id, label2: 'Download the signed agreement' + v }],
      });
    });
    const numberOf = (id) => ((folder.invoices.find((i) => i.id === id) || {}).number || '');
    folder.invoices.forEach((inv) => {
      const legacy = inv.kind === 'legacy';
      const label = 'invoice ' + (inv.number || '');
      const replacedBy = inv.status === 'void' ? folder.invoices.find((i) => i.replacesId === inv.id) : null;
      const when = (ymd) => esc(ProjectCard.dayMonth(ymd, today));
      let meta;
      if (legacy) meta = (inv.status === 'paid' ? 'Paid · ' : '') + 'Made the old way';
      else if (inv.status === 'void') {
        meta = 'Void' + (inv.voidedAt ? ' ' + when(inv.voidedAt) : '') + (replacedBy ? ' · replaced by ' + esc(replacedBy.number || '') : '');
      } else {
        meta = esc(INVOICE_STATUS[inv.status] || inv.status) +
          (inv.status === 'paid' && inv.paidAt ? ' ' + when(inv.paidAt) : '') +
          ((inv.status === 'sent' || inv.status === 'scheduled') && inv.dueAt ? ' · due ' + when(inv.dueAt) : '') +
          (inv.replacesId ? ' · replaces ' + esc(numberOf(inv.replacesId)) : '');
      }
      const actions = [{ id: 'invoice', label: 'Open', target: inv.id, label2: 'Open ' + label }];
      if (!legacy && inv.status === 'draft') actions.push({ id: 'send-invoice', label: 'Send…', target: inv.id, label2: 'Send ' + label });
      if (!legacy && inv.publicToken && ['scheduled', 'sent', 'paid'].includes(inv.status)) {
        actions.push({ id: 'copy-invoice', label: 'Copy link', target: inv.id, label2: 'Copy the client link to ' + label });
      }
      // An old invoice prints from the estimate row it was made from, as it always did.
      if (legacy && inv.estimateId) actions.push({ id: 'legacy-pdf', label: '↓ PDF', target: inv.estimateId, label2: 'Download ' + label + ' PDF' });
      if (!legacy) actions.push({ id: 'inv-pdf', label: '↓ PDF', target: inv.id, label2: 'Download ' + label + ' PDF' });
      if (!legacy && inv.status !== 'void') {
        actions.push({ id: 'inv-breakdown', label: '↓ Breakdown', target: inv.id, label2: 'Download the Cost Breakdown for ' + label });
      }
      docs.push({
        name: esc(INVOICE_KIND[inv.kind] || 'Invoice') + (inv.number ? ' <span class="pf-doc-num">' + esc(inv.number) + '</span>' : ''),
        meta,
        amount: inv.status === 'void' ? '<s>' + fmt(inv.amountDue) + '</s>' : fmt(inv.amountDue),
        status: legacy ? '' : SendPanel.statusMarkup(inv.send, label),
        actions,
        void: inv.status === 'void',
      });
    });
    return (
      '<div class="pf-section-head"><h2 class="pf-h2" id="pf-docs-h">Documents</h2></div>' +
      '<ul class="pf-docs">' + docs.map(docRow).join('') + '</ul>' +
      '<div class="pf-doc-error" id="pf-doc-error" role="alert"></div>'
    );
  }

  // ── Activity ────────────────────────────────────────────────────────────

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
      return head + '<p class="pf-empty">Nothing recorded yet. Sending, the client opening and accepting, and your own changes show here.</p>';
    }
    return head + '<ol class="pf-activity">' + folder.activity.map((a) =>
      '<li><span class="pf-act-when">' + esc(whenText(a.at, today)) + '</span>' +
      '<span class="pf-act-what">' + esc(ProjectCard.activityText(a, today)) + '</span></li>').join('') + '</ol>';
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
    clearTimeout(following);
    following = SendPanel.follow(folder.estimates.map((e) => e.send).concat(folder.invoices.map((i) => i.send)),
      (n) => { tries = n; refresh(true); }, tries);
    tries = 0;
  }

  function bind() {
    $('js-back').addEventListener('click', () => LSCRouter.leaveTo('/projects'));
    const fix = $('js-fix-upid');
    if (fix) fix.addEventListener('click', () => LSCRouter.go('/setup/upids'));
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act, b)));
    root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => runDoc(b.dataset.doc, b.dataset.id, b)));
    SendPanel.bindStatus(root, {
      edit: (sendId, b) => openEditSend(sendId, b),
      changed: () => refresh(),
      authLost: () => handlers.onAuthLost({ keepScreen: true }),
      error: (message) => showDocError(message),
    });
    root.querySelectorAll('.pf-day').forEach((b) => b.addEventListener('click', () => {
      const estimate = folder.estimates.find((e) => e.id === b.dataset.estimate);
      if (estimate) openEstimate(estimate, false, { focusDay: b.dataset.day });
    }));
  }

  /* An invoice's page (task 20); `then` 'paid' opens its Mark paid. */
  function openInvoice(invoiceId, then) {
    if (!invoiceId) return;
    LSCRouter.go(InvoiceView.pathOf(folder.project.id, invoiceId), { state: then ? { action: then } : {} });
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
    if (id === 'invoice') return openInvoice(button.dataset.target, button.dataset.then);
    const estimate = lead();
    if (id === 'edit' && estimate) return openEstimate(estimate, false);
    if (id === 'view' && estimate) return openEstimate(estimate, true);
    if (id === 'send') return openSendEstimate(button);
    if (id === 'accept' || id === 'invoices') return openAccept(button, id);
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
      if (button.isConnected) button.focus();
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
      if (button.isConnected) button.focus();
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

  // ── The dialog (Mark sent, Mark accepted, Decline, Delete) ──────────────

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

  /* body: the dialog's own markup between its title and actions; with
     `describe`, its opening sentence is <p id="pfd-desc">, which the dialog is
     described by (not the whole body: its fields would be read out twice).
     run(button)
     resolves when done (null: a 401 or 404 already dealt with, which closes
     it too); a rejection's message is shown in the dialog, which stays. */
  function openDialog(opener, opts) {
    dlg.overlay = document.getElementById('modal-project');
    if (!dlg.overlay) return;
    closeDialog(false);
    dlg.opener = opener || null;
    dlg.overlay.innerHTML =
      '<div class="modal-box pf-dialog" role="dialog" aria-modal="true" aria-labelledby="pfd-title"' +
      (opts.describe ? ' aria-describedby="pfd-desc"' : '') + '>' +
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
      body: '<p class="pfd-text" id="pfd-desc">' + esc(opts.body) + '</p>',
      describe: true,
      confirm: opts.confirm,
      danger: opts.danger,
      run: opts.run,
    });
  }

  // ── Sending (task 29) ───────────────────────────────────────────────────

  const contactOf = () => {
    const c = (lead() && lead().client) || {};
    return { email: String(c.email || '').trim(), name: c.contactName || c.businessName || 'the client' };
  };

  /* Proposed dates still on the estimate that another project has confirmed
     (task 33 DR7): sending them would email a quote the client can't accept. */
  function takenWarning(estimate, project) {
    const proposed = new Set((estimate.days || []).filter((d) => d.status === 'proposed' && d.date).map((d) => d.date));
    const taken = (project.takenDays || []).filter((t) => proposed.has(t.date));
    if (!taken.length) return '';
    return (taken.length === 1
      ? C.shortDate(taken[0].date) + ' is taken.'
      : taken.map((t) => C.shortDate(t.date)).join(', ') + ' are taken.') +
      ' Move ' + (taken.length === 1 ? 'that day' : 'those days') + ' first, or your client still can’t accept.';
  }

  /* The estimate's panel: v(N+1) of the lead, valid from the day it goes
     (D44, Settings' valid-for days). */
  function openSendEstimate(opener) {
    const estimate = lead();
    if (!estimate || busy) return;
    const project = folder.project;
    const v = nextVersion(estimate);
    const who = contactOf();
    SendPanel.open(opener, {
      docKind: 'estimate',
      title: 'Send v' + v,
      intro: 'Emails ' + who.name + ' a link to v' + v + ' of the estimate, where they can read it and accept. ' +
        (v > 1 ? 'The link stays the same and now shows v' + v + '; v' + (v - 1) + ' is kept here, marked superseded. ' : '') +
        'Edits after this need another send.',
      to: who.email,
      message: LSCDocuments.docSettings(LSCData.settings()).messages.estimate,
      date: {
        key: 'validUntil',
        label: 'Valid until',
        days: validDays(),
        hint: (day, value) => (C.isDate(value) ? 'Reads as expired after ' + C.shortDate(value) + '.' : ''),
      },
      linkHint: 'Makes v' + v + ' live without an email, to send your own way.',
      warning: takenWarning(estimate, project),
      send: (body) => LSCApi.post('/api/projects/' + encodeURIComponent(project.id) + '/send?today=' + LSCUtil.today(), body),
      tokenOf: (reply) => reply.sent.token,
      done: (reply, how) => {
        landReply(project.id, reply);
        const send = reply.estimates.find((e) => e.id === reply.sent.estimateId);
        const queued = send && send.send;
        if (how === 'link') return 'v' + reply.sent.version + ' is live.';
        return queued && queued.status === 'scheduled' && Date.parse(queued.scheduledFor) > Date.now() + 60000
          ? 'v' + reply.sent.version + ' made. The email goes ' + SendPanel.whenText(queued.scheduledFor) + '.'
          : 'v' + reply.sent.version + ' made. Sending the email now.';
      },
    });
  }

  /* An invoice's panel, from its row: due a number of days after it goes. */
  function openSendInvoice(inv, opener) {
    if (!inv || busy) return;
    InvoiceView.openSend(opener, inv, {
      to: contactOf().email,
      name: contactOf().name,
      done: () => refresh(),
    });
  }

  /* A row's "Change": the scheduled email of an estimate or an invoice. */
  function openEditSend(sendId, opener) {
    const e = folder.estimates.find((x) => x.send && x.send.id === sendId);
    const inv = folder.invoices.find((x) => x.send && x.send.id === sendId);
    const send = (e || inv || {}).send;
    if (!send) return;
    const live = e ? (e.versions || []).filter((v) => !v.supersededAt).pop() : null;
    SendPanel.open(opener, {
      docKind: e ? 'estimate' : 'invoice',
      edit: send,
      date: e
        ? { key: 'validUntil', label: 'Valid until', fixed: true, value: live && live.validUntil, fixedNote: '(set when v' + (live ? live.n : '') + ' was made)' }
        : { key: 'dueAt', label: 'Due', days: 0, value: inv.dueAt, hint: (day, value) => (C.isDate(value) ? 'Issued ' + C.shortDate(day) + ', due ' + C.shortDate(value) + '.' : '') },
      save: (patch) => LSCApi.put('/api/sends/' + encodeURIComponent(sendId), patch),
      done: () => refresh(),
    });
  }

  /* A reply that is the folder, on screen if it's still this project. */
  function landReply(id, reply) {
    if (!onScreen() || !folder || folder.project.id !== id) return;
    folder = reply;
    draw();
    const again = root.querySelector('[data-act]');
    if (again) again.focus();
  }

  /* The folder again, without the Loading screen: after a send changed
     somewhere the reply didn't cover (an invoice, the queue). Focus goes back
     to the first action, as after any action. */
  async function refresh(quiet) {
    if (!folder) return;
    const id = folder.project.id;
    try {
      const reply = await LSCApi.get('/api/projects/' + encodeURIComponent(id) + '?today=' + LSCUtil.today());
      if (quiet) {
        // A follow-up look: redraw without moving focus, and only when
        // nothing is open over the screen.
        if (!onScreen() || !folder || folder.project.id !== id || busy) return;
        const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-act],[data-doc]');
        const key = keep ? (keep.dataset.act ? '[data-act="' + keep.dataset.act + '"]' : '[data-doc="' + keep.dataset.doc + '"][data-id="' + keep.dataset.id + '"]') : null;
        folder = reply;
        draw();
        const back = key && root.querySelector(key);
        if (back) back.focus();
        return;
      }
      landReply(id, reply);
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      if (err.status === 404) return showMissing();
      showDocError('Couldn’t refresh the folder: ' + failureText(err));
    }
    return undefined;
  }

  /* Mark accepted (Stage D's stand-in for E's signing, IA flow 4), or Create
     invoices for a project accepted before they were made here. Both ask pair
     or single (D32) and, for a pair, the deposit % (D33: the setting, or this
     project's own), and show what each invoice will ask for, worked out as the
     server will (calc.js depositAmount on the stored totals). */
  function openAccept(opener, action) {
    const project = folder.project;
    const estimate = lead();
    const accepting = action === 'accept';
    const totals = (estimate && estimate.totals) || {};
    /* What turns confirmed, counted by status in real words ("2 proposed
       days", "1 pencilled and 2 proposed days"; task 33 DR6). */
    const turning = accepting && estimate
      ? (estimate.days || []).filter((d) => d.date && d.status !== 'confirmed')
      : [];
    const counts = ['pencilled', 'proposed']
      .map((st) => [st, turning.filter((d) => d.status === st).length])
      .filter(([, n]) => n);
    const turningText = counts.map(([st, n], i) =>
      n + ' ' + st + (i === counts.length - 1 ? (turning.length === 1 ? ' day' : ' days') : '')).join(' and ');
    // Dates another project has confirmed since the quote went: accepting confirms them anyway, flagged (D18).
    const taken = accepting ? (project.takenDays || []) : [];
    const takenNote = taken.length
      ? '<p class="pf-hint pf-hint-alert pfd-taken" role="note">' + taken.map((t) =>
        esc(C.shortDate(t.date)) + ' is already confirmed for ' + esc(t.upid || t.name || 'another project') + '.').join(' ') +
        ' ' + (taken.length === 1 ? 'It' : 'They') + ' will be confirmed here too and flagged “clash, rebook”.</p>'
      : '';
    const single = project.invoicing === 'single';
    const pct = project.depositPctDefault;
    const upid = project.upid ? esc(project.upid) : 'its UPID';
    openDialog(opener, {
      title: accepting ? 'Mark accepted' : 'Create invoices',
      body:
        '<p class="pfd-text" id="pfd-desc">' +
        (accepting
          ? 'Record that the client accepted the estimate. ' +
            (turning.length ? 'Its ' + turningText + (turning.length === 1 ? ' turns' : ' turn') +
              ' confirmed, and the' : 'The') + ' invoices are made, ready to send. Nothing goes to the client.'
          : 'This project was accepted before invoices were made here. Make them now, ready to send.') +
        ' Invoice numbers carry the UPID, so ' + upid + ' is then fixed.</p>' + takenNote +
        '<fieldset class="pfd-choice"><legend>Invoicing</legend>' +
        '<label><input type="radio" name="pfd-invoicing" value="pair"' + (single ? '' : ' checked') + '>' +
        '<span>Deposit + final</span></label>' +
        '<label><input type="radio" name="pfd-invoicing" value="single"' + (single ? ' checked' : '') + '>' +
        '<span>Single invoice (no deposit)</span></label></fieldset>' +
        '<div class="field" id="pfd-pct-field"><label for="pfd-pct">Deposit %</label>' +
        '<input id="pfd-pct" type="number" inputmode="decimal" min="1" max="100" step="any" value="' + esc(String(pct)) + '"' +
        ' aria-describedby="pfd-split"></div>' +
        '<p class="pfd-split" id="pfd-split" aria-live="polite"></p>',
      describe: true,
      confirm: accepting ? 'Mark accepted' : 'Create invoices',
      focus: 'pfd-ok',
      onOpen: (q) => {
        const field = q('pfd-pct');
        const split = q('pfd-split');
        const choice = () => dlg.overlay.querySelector('input[name="pfd-invoicing"]:checked').value;
        const refresh = () => {
          const pair = choice() === 'pair';
          q('pfd-pct-field').hidden = !pair;
          if (!pair) {
            split.textContent = 'One invoice, ' + (project.upid ? 'INV-' + project.upid : 'INV-<UPID>') + ', for the whole ' +
              fmt(totals.totalIncGst) + '.';
            return;
          }
          const value = Number(field.value);
          if (!(value > 0 && value <= 100)) {
            split.textContent = 'The deposit must be more than 0% and at most 100%.';
            return;
          }
          const deposit = LSCCalc.depositAmount(totals, value);
          split.textContent = 'Deposit ' + fmt(deposit.totalIncGst) + ' to secure the booking, then the final invoice for the other ' +
            fmt(LSCCalc.finalInvoiceTotals(totals, null, deposit).balanceDue) + ' plus any extras.';
        };
        dlg.overlay.querySelectorAll('input[name="pfd-invoicing"]').forEach((r) => r.addEventListener('change', refresh));
        field.addEventListener('input', refresh);
        refresh();
      },
      run: async (b) => {
        const invoicing = dlg.overlay.querySelector('input[name="pfd-invoicing"]:checked').value;
        const body = { invoicing };
        if (invoicing === 'pair') {
          const field = dlg.overlay.querySelector('#pfd-pct');
          const value = Number(field.value);
          if (field.value === '' || !(value > 0 && value <= 100)) {
            field.focus();
            throw new Error('The deposit must be more than 0% and at most 100%.');
          }
          body.depositPct = value;
        }
        return post(action, body, b, accepting ? 'Accepting…' : 'Creating invoices…', (reply) => {
          const made = invoicing === 'pair' ? 'Deposit and final invoices made.' : 'Invoice made.';
          if (reply.already) return accepting ? 'Already accepted. Nothing changed.' : 'Its invoices were already made.';
          const clash = reply.rebook || [];
          if (!clash.length) return (accepting ? 'Accepted. ' : '') + made;
          return 'Accepted. ' + made + ' ' + clash.map((c) => C.shortDate(c.date)).join(', ') + ' ' +
            (clash.length === 1 ? 'is' : 'are') + ' also confirmed for ' + (clash[0].upid || clash[0].name || 'another project') +
            ': flagged to rebook.';
        });
      },
    });
  }

  // ── Downloads ───────────────────────────────────────────────────────────

  async function runDoc(kind, id, button) {
    if (kind === 'invoice') return openInvoice(id);
    if (kind === 'send') return openSendEstimate(button);
    if (kind === 'send-invoice') return openSendInvoice(folder.invoices.find((i) => i.id === id), button);
    if (kind === 'copy') {
      const e = folder.estimates.find((x) => x.id === id);
      return e && e.publicToken ? SendPanel.copyLink('estimate', e.publicToken, button) : undefined;
    }
    if (kind === 'copy-invoice') {
      const inv = folder.invoices.find((x) => x.id === id);
      return inv && inv.publicToken ? SendPanel.copyLink('invoice', inv.publicToken, button) : undefined;
    }
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
      open.textContent = 'Open Settings';
      open.addEventListener('click', () => LSCRouter.go('/settings/business'));
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
    const breakdown = kind === 'breakdown' || kind === 'inv-breakdown';
    const invoice = kind === 'inv-pdf' || kind === 'inv-breakdown' ? folder.invoices.find((i) => i.id === estimateId) : null;
    const signed = kind === 'agreement' ? (folder.signatures || []).find((x) => x.id === estimateId) : null;
    const what = breakdown ? 'the Cost Breakdown' : signed ? 'the signed agreement'
      : kind === 'legacy-pdf' || invoice ? 'the invoice PDF' : 'the PDF';
    Toast.working(breakdown ? 'Generating the Cost Breakdown…' : 'Generating PDF…');
    try {
      let reply;
      if (signed) {
        // Stored at signing; nothing to generate unless the renderer was down then.
        reply = await LSCApi.getPdf('/api/projects/' + encodeURIComponent(folder.project.id) + '/agreements/' +
          encodeURIComponent(signed.id) + '/pdf');
      } else if (invoice) {
        // An app-made invoice (task 20): its own routes. A draft prints issued today.
        reply = await LSCApi.postPdf('/api/invoices/' + encodeURIComponent(invoice.id) + '/' +
          (breakdown ? 'cost-breakdown' : 'pdf') + '?today=' + LSCUtil.today(), breakdown ? undefined : {});
      } else {
        const base = '/api/estimates/' + encodeURIComponent(estimateId);
        reply = breakdown
          ? await LSCApi.postPdf(base + '/cost-breakdown')
          : await LSCApi.postPdf(base + '/pdf', kind === 'pdf' ? { as: 'estimate' } : undefined);
      }
      const estimate = folder.estimates.find((e) => e.id === estimateId) || {};
      const fallback = signed
        ? 'Service Agreement - ' + (folder.project.upid || 'Estimate') + '.pdf'
        : invoice
        ? (breakdown ? 'Cost Breakdown_' : '') + (invoice.number || 'invoice') + '.pdf'
        : breakdown
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
      else if (err.status === 404) report('Couldn’t make ' + what + ' — that ' + (signed ? 'signature' : invoice ? 'invoice' : 'estimate') + ' no longer exists on the server.');
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
      LSCUtil.landFocus(root);
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
      SendPanel.close(false);
      load(id);
      return true;
    },

    estimatePath,
    closeDialog,
    /* The folder's dialog, for the invoice screen's Mark sent, Mark paid and
       Void (task 20): one overlay, one focus trap, one way of showing a
       refusal. opts as openDialog. */
    dialog: openDialog,
  };
})();
