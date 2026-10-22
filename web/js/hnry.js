'use strict';

/* Hnry on the screens (hnry-invoicing H6).
 *
 * An invoice here can live in Hnry: the server makes it there as a DRAFT (a
 * deposit or single when a project is accepted, a final when asked) and the
 * user sends it from Hnry. This file is the one place the two invoice screens
 * (the project page's rows and the invoice page) take that from: what state an
 * invoice is in, how to word it, where its Hnry page is, and the three calls
 * (push, Mark sent, status). It draws nothing itself beyond one status line.
 *
 *   describe(inv, ctx)  what to show for one invoice, or null when Hnry has
 *                       nothing to say about it (an old-way invoice, a void
 *                       one, Hnry not set up and not in it, one the app sent).
 *                       Pure: the tests load this file and call it.
 *   ctx                 { enabled, depositInHnry, depositByApp }
 *
 * States, in the order they happen:
 *   not in Hnry yet   Hnry is set up, the invoice is a draft, nothing sent.
 *                     A deposit or single is normally pushed at acceptance, so
 *                     this is "it didn't go yet": Create in Hnry. A final waits
 *                     for the user: add the extras, then Create in Hnry.
 *   error             the push failed or was refused; says why, offers Retry
 *                     when trying again could help.
 *   part-way          some lines are in Hnry and some aren't; Retry adds the
 *                     rest, and the line says to look at the draft first (a
 *                     line that timed out may already be there).
 *   a draft in Hnry   everything is there: check it in Hnry, send it from
 *                     there, then Mark sent here.
 *   sent / paid       Hnry's page stays one click away.
 *
 * Nothing here decides what the server allows: it only reads the invoice's
 * hnry* fields (server/src/invoices.js invoiceJson) and says what they mean.
 */

const LSCHnry = (() => {
  /* What the server says about Hnry, once per sign-in. A failed ask reads as
     "not set up" for now and is asked again next time, never remembered. */
  let status = null;
  let asking = null;

  function ready() {
    if (status) return Promise.resolve(status);
    if (!asking) {
      asking = LSCApi.get('/api/hnry/status')
        .then((reply) => { status = { enabled: reply && reply.enabled === true }; return status; })
        .catch(() => ({ enabled: false }))
        .then((s) => { asking = null; return s; });
    }
    return asking;
  }

  const enabled = () => Boolean(status && status.enabled);
  const forget = () => { status = null; };

  /* ── Where an invoice is in Hnry ─────────────────────────────────────── */

  /* The numeric id inside Hnry's opaque one (a base64 gid), or null. */
  function numericId(inv) {
    const raw = inv && inv.hnryInvoiceId;
    if (typeof raw !== 'string' || !raw) return null;
    try {
      const m = /^gid:\/\/hnry\/Invoice\/(\d+)$/.exec(atob(raw));
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }

  /* A draft opens in Hnry's editor; Hnry has no page of that address once it
     is sent, so those go to the invoice list, where its number finds it. */
  function urlOf(inv) {
    const id = numericId(inv);
    if (id && inv.status === 'draft') return 'https://app.hnry.io/invoices/' + id + '/edit';
    return inv && inv.hnryInvoiceId ? 'https://app.hnry.io/invoices' : null;
  }

  const inHnry = (inv) => Boolean(inv && inv.hnryInvoiceId);
  const complete = (inv) => Boolean(inv && inv.hnryPushedAt);

  /* ── Words ───────────────────────────────────────────────────────────── */

  /* A failure's code (server/src/hnry-push.js, hnry.js) as a sentence, and
     whether trying again could change anything. A refusal that comes from the
     invoice itself (GST, the amounts, no client, a deposit not yet there) is
     fixed elsewhere, so it offers no Retry. */
  const WORDS = {
    gst_registered: { text: 'Nothing was sent: GST handling in Hnry isn’t set up yet.', retry: false },
    deposit_not_in_hnry: { text: 'Create the deposit invoice in Hnry first: the final takes it off by its Hnry number.', retry: false },
    zero_amount: { text: 'Nothing was sent: there is nothing left to bill on this invoice.', retry: false },
    amount_mismatch: { text: 'Nothing was sent: the lines didn’t add up to what this invoice bills.', retry: false },
    no_client: { text: 'Nothing was sent: this project has no client name to invoice. Add one to the estimate.', retry: false },
    timeout: { text: 'Hnry took too long to answer.', retry: true },
    zapier_error: { text: 'Hnry couldn’t be reached through Zapier.', retry: true },
    unexpected_shape: { text: 'Hnry answered in a way the app didn’t expect.', retry: true },
    bad_input: { text: 'Something on this invoice isn’t a value Hnry takes.', retry: false },
    internal: { text: 'Something went wrong on the server.', retry: true },
  };
  const wordsOf = (code) => WORDS[code] || { text: 'Hnry didn’t take it.', retry: true };

  /* ── What to show ────────────────────────────────────────────────────── */

  const CHECK_FIRST = 'A line that timed out may already be in the draft: look at it in Hnry before you retry.';

  /**
   * @returns {null | {
   *   chip: string|null, tone: 'info'|'alert'|'neutral'|null,
   *   text: string, line: 'ok'|'err'|'',
   *   primary: {id: string, label: string, confirm?: boolean}|null,
   *   open: boolean, markSent: boolean, defer?: boolean }}
   *   `chip`/`tone` replace the status chip only while the invoice is a draft
   *   (once sent or paid the app's own words, Sent and Paid, are the better ones).
   *   `primary` is the row's main button; `open` offers Open in Hnry beside it;
   *   `markSent` offers "Mark sent…" (a whole draft in Hnry, not yet marked sent).
   *   `defer`: Hnry has no action yet, so the app's own Send must not be the main button.
   */
  function describe(inv, ctx) {
    if (!inv || inv.kind === 'legacy' || inv.status === 'void') return null;
    const on = Boolean(ctx && ctx.enabled);

    // In Hnry, whole.
    if (inHnry(inv) && complete(inv)) {
      if (inv.status === 'draft') {
        return {
          chip: 'In Hnry', tone: 'info', line: 'ok',
          text: 'A draft is in Hnry. Check it there, send it from Hnry, then mark it sent here.',
          primary: { id: 'hnry-open', label: 'Open in Hnry' }, open: true, markSent: true,
        };
      }
      return {
        chip: null, tone: null, line: '',
        text: inv.status === 'sent' ? 'Sent from Hnry.' : '',
        primary: null, open: true, markSent: false,
      };
    }

    // Started and stopped: some lines are there.
    if (inHnry(inv)) {
      const n = Number(inv.hnryLinesDone) || 0;
      const why = inv.hnryError ? wordsOf(inv.hnryError).text + ' ' : '';
      return {
        chip: 'Part in Hnry', tone: 'alert', line: 'err',
        text: why + 'Only part of this invoice is in Hnry' + (n ? ' (' + n + (n === 1 ? ' line' : ' lines') + ' so far)' : '') + '. ' + CHECK_FIRST,
        primary: { id: 'hnry-push', label: 'Retry in Hnry' }, open: true, markSent: false,
      };
    }

    // Never reached Hnry, and it said why. Only a draft cares: one the app has since sent
    // itself is out by the old way, and an old error on its row is nothing to retry.
    if (inv.hnryError) {
      if (inv.status !== 'draft') return null;
      const w = wordsOf(inv.hnryError);
      return {
        chip: 'Hnry error', tone: 'alert', line: 'err', text: w.text,
        primary: w.retry ? { id: 'hnry-push', label: 'Retry in Hnry' } : null, open: false, markSent: false,
      };
    }

    // Not there yet. Only a draft in a Hnry that is set up; the rest is the app's own.
    if (!on || inv.status !== 'draft') return null;
    if (inv.kind === 'final') {
      // Its deposit went out by the app, the old way: so does this, nothing for Hnry to say.
      if (ctx && ctx.depositByApp) return null;
      const ready = !ctx || ctx.depositInHnry !== false;
      return {
        chip: 'Not in Hnry', tone: 'neutral', line: '',
        text: ready ? 'Add any extras, then create it in Hnry. After that it can’t be edited here.'
          : 'Create the deposit invoice in Hnry first.',
        primary: ready ? { id: 'hnry-push', label: 'Create in Hnry…', confirm: true } : null, open: false, markSent: false,
        // Not ready: the page to work on it (extras) is the main button, not the app's own Send.
        defer: !ready,
      };
    }
    return {
      chip: 'Not in Hnry', tone: 'neutral', line: '',
      text: 'It isn’t in Hnry yet.',
      primary: { id: 'hnry-push', label: 'Create in Hnry' }, open: false, markSent: false,
    };
  }

  /* The one status line, in the same shape as an email's (SendPanel). */
  function lineMarkup(d, what) {
    if (!d || !d.text) return '';
    const { esc } = LSCUtil;
    return '<p class="send-status hnry-status' + (d.line ? ' is-' + d.line : '') + '" data-hnry-for="' + esc(what || '') + '">' +
      '<span class="send-status-text">' + esc(d.text) + '</span></p>';
  }

  /* ── The calls ───────────────────────────────────────────────────────── */

  const q = () => '?today=' + LSCUtil.today();
  const push = (invoiceId) => LSCApi.post('/api/invoices/' + encodeURIComponent(invoiceId) + '/hnry' + q(), {});
  const markSent = (invoiceId, dates) => LSCApi.post('/api/invoices/' + encodeURIComponent(invoiceId) + '/sent' + q(), dates);

  /* Hnry's own defaults for a new invoice: dated today, due in 20 days. */
  function addDays(ymd, n) {
    return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  }
  const defaultDates = (today) => ({ issuedAt: today, dueAt: addDays(today, 20) });

  return { ready, enabled, forget, describe, lineMarkup, urlOf, numericId, inHnry, complete, wordsOf, push, markSent, defaultDates, addDays, WORDS };
})();
