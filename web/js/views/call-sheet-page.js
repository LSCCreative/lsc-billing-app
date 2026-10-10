'use strict';

/* The call sheet in the app (trip-planner task 10; T12, T13, T18).
 *
 *   #/projects/<id>/estimate[/<eid>]/call-sheet
 *
 * The owner's look at what crew see: the same allow-listed document the
 * public link and the PDF draw, from js/call-sheet.js, under this screen's
 * own actions. Nothing is computed here. The server builds the schedule from
 * the saved trips every time it is asked, so this page is always the latest
 * (T18), and "Edit trips" is the way to change it.
 *
 * Share… (task 11) opens the same dialog as the Project page's row
 * (CallSheetShare): the link, Copy link and email. The bar says whether the
 * link is on, and that line alone is redrawn when the dialog changes it.
 */

const CallSheetPage = (() => {
  const { esc } = LSCUtil;

  function shell(inner) {
    return '<button class="back-btn" id="csp-back" type="button">← Back</button>' + inner;
  }

  function placeholder(title, body, retry) {
    return shell(
      '<div class="empty-state"><h3>' + esc(title) + '</h3><p>' + esc(body) + '</p>' +
      (retry ? '<button type="button" class="btn" id="csp-retry" style="margin-top:16px">Try again</button>' : '') +
      '</div>'
    );
  }

  /* An inline explanation under the actions: it has to outlive a toast. */
  function pdfErrorText(err) {
    if (err.code === 'pdf_unavailable') {
      return 'Couldn’t make the PDF: the server has no PDF renderer. Check Chromium is installed in the container.';
    }
    if (err.status === 404) return 'Couldn’t make the PDF: this estimate no longer exists on the server.';
    if (err.kind === 'network') return 'Couldn’t make the PDF: the server is unreachable. Try again once it’s back.';
    return 'Couldn’t make the PDF: ' + (err.message || 'the server refused.');
  }

  /* The link's state, beside the actions: the Project page row's words. */
  function linkMarkup(link) {
    const on = Boolean(link && link.on);
    const chip = on ? 'Link on' : link && link.token ? 'Link off' : 'Not shared';
    return '<span class="pf-chip ' + (on ? 'is-info' : 'is-neutral') + '">' + chip + '</span>' +
      '<span class="csp-link-text">' + (on ? 'Anyone with the link can open it.' : 'Crew can’t open it until the link is on.') + '</span>';
  }

  async function downloadPdf(estimate, els, handlers) {
    els.pdf.disabled = true;
    els.spin.style.display = 'inline-block';
    els.error.textContent = '';
    Toast.working('Preparing the call sheet PDF…');
    try {
      const reply = await LSCApi.getPdf('/api/estimates/' + encodeURIComponent(estimate.id) + '/call-sheet/pdf');
      LSCUtil.saveFile(reply.blob, reply.filename || 'Call sheet.pdf');
      Toast.ok('Call sheet PDF downloaded.');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      Toast.hide();
      if (err.kind === 'auth') {
        handlers.onAuthLost({ keepScreen: true });
        return;
      }
      els.error.textContent = pdfErrorText(err);
    } finally {
      els.pdf.disabled = false;
      els.spin.style.display = 'none';
    }
  }

  /**
   * @param {HTMLElement} root  #main
   * @param {object} estimate   the estimate whose trips these are
   * @param {object} project    { id, estimateId }, for the paths
   * @param {{onBack:function, onAuthLost:function}} handlers
   */
  async function mount(root, estimate, project, handlers) {
    const ticket = LSCRouter.ticket();
    const alive = () => LSCRouter.isCurrent(ticket) && root.isConnected;
    const retry = () => mount(root, estimate, project, handlers);

    document.title = 'Call sheet — LSC Billing';
    root.innerHTML = shell('<p class="csp-note" role="status">Loading the call sheet…</p>');
    root.querySelector('#csp-back').addEventListener('click', handlers.onBack);

    let reply;
    try {
      reply = await LSCApi.get('/api/estimates/' + encodeURIComponent(estimate.id) + '/call-sheet');
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!alive()) return;
      if (err.kind === 'auth') {
        handlers.onAuthLost();
        return;
      }
      root.innerHTML = err.status === 404
        ? placeholder('That estimate was deleted', 'Your other projects are in the list.')
        : placeholder(
          'Couldn’t open the call sheet',
          err.kind === 'network' ? 'The server is unreachable.' : err.message || 'The server refused.',
          true
        );
      root.querySelector('#csp-back').addEventListener('click', handlers.onBack);
      const again = root.querySelector('#csp-retry');
      if (again) again.addEventListener('click', retry);
      return;
    }
    if (!alive()) return;

    const sheet = reply.callSheet;
    const hasDays = Array.isArray(sheet.days) && sheet.days.length > 0;
    document.title = LSCCallSheet.title(sheet) + ' — LSC Billing';
    let link = reply.link || { on: false, token: null };
    root.innerHTML = shell(
      '<div class="csp-bar">' +
        (hasDays ? '<p class="csp-link" id="csp-link">' + linkMarkup(link) + '</p>' : '') +
        '<button type="button" class="btn btn-ghost" id="csp-edit">Edit trips</button>' +
        (hasDays
          ? '<button type="button" class="btn" id="csp-share">Share…</button>' +
            '<button type="button" class="btn btn-accent" id="csp-pdf"><span class="spinner" id="csp-spin"></span>Download PDF</button>'
          : '') +
      '</div>' +
      '<p class="csp-error" id="csp-error" role="alert"></p>' +
      LSCCallSheet.markup(sheet)
    );

    root.querySelector('#csp-back').addEventListener('click', handlers.onBack);
    // The editor opens on the first day with a trip; none yet, it just opens.
    root.querySelector('#csp-edit').addEventListener('click', () => {
      const path = ProjectFolder.estimatePath(project, estimate, false);
      LSCRouter.go(path + (reply.editDay ? '?trip=' + encodeURIComponent(reply.editDay) : ''));
    });
    const share = root.querySelector('#csp-share');
    if (share) {
      share.addEventListener('click', () => CallSheetShare.open(share, {
        estimateId: estimate.id,
        link,
        onClose: (out) => {
          if (!out.changed || !alive()) return;
          link = out.link;
          const line = root.querySelector('#csp-link');
          if (line) line.innerHTML = linkMarkup(link);
        },
        onAuthLost: () => handlers.onAuthLost({ keepScreen: true }),
      }));
    }
    const pdf = root.querySelector('#csp-pdf');
    if (pdf) {
      const els = { pdf, spin: root.querySelector('#csp-spin'), error: root.querySelector('#csp-error') };
      pdf.addEventListener('click', () => downloadPdf(estimate, els, handlers));
    }
  }

  return { mount };
})();
