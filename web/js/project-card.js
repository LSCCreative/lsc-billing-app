'use strict';

/* One project, as every screen shows it (production-booking task 17; IA,
 * Component Reuse Map): the stage line, and the project card that carries it.
 *
 * THE STAGE LINE IS ONE FUNCTION. The Projects list, the client's projects and
 * the project folder (task 18) all print stageLine(), so the three can't
 * disagree. Where the project is, its `stage` and `stageDetail.step`, comes
 * from the server (server/src/projects.js projectStage), which also filters
 * and counts by it; this only words it. Dates are read against the browser's
 * today, as everywhere else in the app: a sent estimate past its valid-until
 * reads "expired" (D44, derived, never stored), and an invoice past its due
 * date "overdue".
 *
 * The card is the existing .proj-card (IA: "the stage line where the date
 * sat"), with the next production day under it when there is one.
 */

const ProjectCard = (() => {
  const { fmt, esc } = LSCUtil;
  const C = LSCCalendar;

  // The filter chips, in the order a job moves through them. `active` leaves
  // out paid and declined projects settled more than 90 days ago (IA, Content
  // Growth Plan); each stage's own chip still has them.
  const CHIPS = [
    ['active', 'Active'],
    ['draft', 'Draft'],
    ['sent', 'Sent'],
    ['accepted', 'Accepted'],
    ['invoiced', 'Invoiced'],
    ['paid', 'Paid'],
    ['declined', 'Declined'],
  ];

  /* A date as YYYY-MM-DD. A timestamp (accepted_at, declined_at, a send) is
     UTC, so it is read on this browser's clock: an evening here is the next
     morning in UTC. A plain date is already a calendar day. */
  function localDate(value) {
    const raw = String(value || '');
    if (raw.length <= 10) return raw;
    const t = new Date(raw);
    if (!Number.isFinite(t.getTime())) return raw.slice(0, 10);
    const pad = (n) => String(n).padStart(2, '0');
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  // "14 Oct", with the year when it isn't this one. Takes a date or a timestamp.
  function dayMonth(value, today) {
    const ymd = localDate(value);
    if (!C.isDate(ymd)) return '';
    const [y, m, d] = ymd.split('-').map(Number);
    const s = d + ' ' + C.MONTHS[m - 1].slice(0, 3);
    return today && ymd.slice(0, 4) !== today.slice(0, 4) ? s + ' ' + y : s;
  }

  const KIND = { deposit: 'Deposit', final: 'Final', single: 'Invoice' };

  /* An unpaid invoice that has gone out: due, overdue, or just unpaid. */
  function owing(word, detail, today) {
    const due = String(detail.dueAt || '').slice(0, 10);
    if (!C.isDate(due)) return { word: word + ' sent', note: 'unpaid' };
    if (due < today) return { word: word + ' overdue', note: 'was due ' + dayMonth(due, today), alert: true };
    return { word: word + ' sent', note: 'due ' + dayMonth(due, today) };
  }

  /**
   * The stage line's words: { word, note, alert }. `word` leads ("Sent v2"),
   * `note` follows it after a dot ("valid until 14 Oct"), and `alert` marks a
   * line that needs the owner (expired, overdue).
   */
  function stageLine(project, today) {
    const d = project.stageDetail || {};
    const step = d.step || project.stage;
    const on = (value) => dayMonth(value, today);
    switch (step) {
      case 'sent': {
        const word = d.version ? 'Sent v' + d.version : 'Sent';
        const until = String(d.validUntil || '').slice(0, 10);
        if (C.isDate(until)) {
          return until < today
            ? { word, note: 'expired ' + on(until), alert: true }
            : { word, note: 'valid until ' + on(until) };
        }
        return { word, note: d.at ? on(d.at) : '' };
      }
      case 'accepted': return { word: 'Accepted', note: 'invoices not created' };
      case 'deposit_draft': return { word: 'Accepted', note: 'deposit not sent' };
      case 'final_draft': return { word: 'Accepted', note: 'final not sent' };
      case 'single_draft': return { word: 'Accepted', note: 'invoice not sent' };
      case 'deposit_scheduled': return { word: 'Accepted', note: 'deposit scheduled' };
      case 'single_scheduled': return { word: 'Accepted', note: 'invoice scheduled' };
      case 'final_scheduled': return { word: 'Deposit paid', note: 'final scheduled' };
      case 'deposit_paid': return { word: 'Deposit paid', note: 'final not sent' };
      case 'deposit_sent':
      case 'final_sent':
      case 'single_sent':
        return owing(KIND[step.split('_')[0]], d, today);
      case 'legacy': return { word: 'Invoiced', note: d.number ? d.number + ', made the old way' : 'made the old way' };
      case 'paid': return { word: 'Paid', note: d.at ? on(d.at) : '' };
      case 'declined': return { word: 'Declined', note: d.at ? on(d.at) : '' };
      default: return { word: 'Draft', note: '' };
    }
  }

  /* The line as markup. The square before it is the stage's mark; the word
     beside it says the same thing, so colour is never the only sign. */
  function stageMarkup(project, today) {
    const line = stageLine(project, today);
    const stage = /^[a-z]+$/.test(project.stage || '') ? project.stage : 'draft';
    return (
      '<p class="stage-line is-' + stage + (line.alert ? ' is-alert' : '') + '">' +
      '<span class="stage-word">' + esc(line.word) + '</span>' +
      (line.note ? '<span class="stage-note"> · ' + esc(line.note) + '</span>' : '') +
      '</p>'
    );
  }

  /* Where opening a project goes: its folder (task 18). The one place a card
     opens from, for the list, the client's projects and app.js. */
  const pathOf = (project) => (project && project.id ? '/projects/' + encodeURIComponent(project.id) : null);

  function upidMarkup(project) {
    const more = project.estimateCount > 1 ? ' · ' + project.estimateCount + ' estimates' : '';
    if (project.upid) return '<div class="card-num">' + esc(project.upid) + more + '</div>';
    return (
      '<div class="card-num is-missing' + (project.needsUpid ? ' is-needed' : '') + '">' +
      (project.needsUpid ? 'UPID needed' : 'No UPID yet') + more + '</div>'
    );
  }

  function nextDayMarkup(project, today) {
    const next = project.nextDay;
    if (!next || !C.isDate(next.date)) return '';
    return (
      '<p class="card-next"><span class="card-next-label">Next day</span>' +
      C.statusChip(next.status) +
      '<span class="card-next-date">' + esc(next.date === today ? 'Today' : C.shortDate(next.date)) + '</span></p>'
    );
  }

  function cardMarkup(project, today) {
    const client = project.client || {};
    return (
      '<div class="proj-card project-card" data-id="' + esc(project.id) + '" role="listitem">' +
      upidMarkup(project) +
      '<h2 class="card-name"><button type="button" class="card-open">' + esc(project.name || 'Untitled') + '</button></h2>' +
      '<div class="card-client">' + esc(client.businessName || '—') + '</div>' +
      '<div class="card-gross-label">Total (inc GST)</div>' +
      '<div class="card-gross">' + fmt(project.totalIncGst) + '</div>' +
      '<div class="card-foot project-foot">' + stageMarkup(project, today) + nextDayMarkup(project, today) + '</div>' +
      '</div>'
    );
  }

  /* Cards in a grid, each opening its project: the list and the client's
     projects bind them the same way. The card's title is its <button>
     (.card-open, stretched over the card by estimates.css), so Enter and
     Space arrive here as a click too. */
  function bind(container, projects, onOpen) {
    container.querySelectorAll('.project-card').forEach((card) => {
      const project = projects.find((p) => p.id === card.dataset.id);
      if (project) card.addEventListener('click', () => onOpen(project));
    });
  }

  return { CHIPS, stageLine, stageMarkup, cardMarkup, bind, pathOf, dayMonth, localDate };
})();
