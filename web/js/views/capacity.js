'use strict';

/* The Capacity screen — how many hours the year can actually be billed for.
 *
 * WHY THIS SCREEN EXISTS
 * Annual billable hours are the divisor behind every overhead-derived rate:
 * overheadRatePerHour() is annual cost ÷ these hours, and the Rate Card's rate
 * column, the estimate editor's Minimum Job Price and (later) every Dashboard
 * floor all read it. They used to come from one "hours per week" figure times
 * an assumed 48-week year. They now come from five things the user actually
 * knows — see calc.js's header, decision 2, for why the 48 died and the ~8% it
 * added to every rate, knowingly.
 *
 * HOURS WORKED × THE SHARE YOU CAN BILL (pricing-floor P1, schema v18)
 * The day is the hours actually worked, admin and email included, and a
 * separate share says how much of that a client pays for. Until v18 one
 * "billable hours per day" field had to carry both, and in practice it was
 * typed as the whole working day, so every hour worked was priced as billed
 * and the income floor came out ~35% low. The share is its own field, last,
 * because it applies to the year the four above it add up to, and the working
 * under the annual figure reads in the same order.
 *
 * LEAVE AND SICK DAYS ARE WORKING DAYS
 * Four weeks off is 20 working days, not 28 calendar days, and the difference
 * is eight days of capacity that would otherwise be sold twice. Nothing in the
 * arithmetic can tell the two apart, so the labels and hints carry it.
 *
 * "THESE ARE DEFAULTS — CONFIRM THEY'RE YOURS"
 * Migration v5 seeded 8 / 5 / 30 / 8 onto every goals row, because leave and
 * sick days cannot be recovered from the old single weekly figure. Those
 * numbers are the reference spreadsheet's, not necessarily the user's, and they
 * already drive every rate on the live card. So until this screen has been
 * saved once, it says so. The signal is goals.capacityConfirmedAt (migration
 * v6), stamped by the server when a PUT carries all four fields — which only
 * this screen sends. Not "do the fields equal 8/5/30/8": those can genuinely be
 * someone's week, and that person would be nagged forever.
 *
 * SAVING MOVES EVERY RATE, SO IT ASKS FIRST
 * When the save changes annual billable hours, a confirm states the before and
 * after hours and the overhead cost per hour they produce, in plain words,
 * before anything is written. A save that leaves the hours where they were
 * (confirming the defaults as they stand, or trading a leave day for a sick
 * day) moves no rate, so it doesn't ask. The rate in the confirm is computed
 * exactly as pricing.js computes its rate column today, so the number in the
 * dialog is the number the Rate Card will show.
 *
 * ONLY THE FIVE FIELDS GO ON THE WIRE
 * PUT /api/goals resolves every field the caller doesn't send to what is
 * already stored (routes/goals.js — resolveGoalField / resolveCapacityField),
 * so this screen sends its five and nothing else. The four time fields are
 * what confirm the defaults (CAPACITY_KEYS); the share is deliberately not one
 * of them, so a tab from before v18 still confirms. It must NOT echo the income
 * and margin back from the cache: the Goals screen owns those, and a stale
 * echo is how two writers of one row overwrite each other.
 */

const CapacityView = (() => {
  const { esc, fmt } = LSCUtil;
  const { annualBillableHours, incomeFloorPerHour } = LSCCalc;

  /* What a goals row that has never been written shows. The figures migration
     v5 seeded (and v18 the share) and routes/goals.js falls back to — so a
     first-ever visit and a migrated row start from the same place, and both
     carry the "defaults" flag until saved. */
  const REFERENCE = { hoursPerDay: '8', daysPerWeek: '5', leave: '30', sick: '8', share: '65' };

  const FIELDS = {
    'cap-hours': 'hoursPerDay',
    'cap-days': 'daysPerWeek',
    'cap-leave': 'leave',
    'cap-sick': 'sick',
    'cap-share': 'share',
  };

  let root = null;
  let handlers = null;
  let saving = false;
  let form = null; // the five fields exactly as typed
  let saved = null; // the same five, as the server last confirmed them
  let confirmed = false; // has this screen ever been saved? see the header

  const $ = (id) => root.querySelector('#' + id);

  /* Still in the page? Asked of the document, not of `root` — see goals.js's
     onScreen() for the stale-watcher bug that asking a detached root caused.
     The id is this screen's own; no other screen may reuse it. */
  const onScreen = () => Boolean(document.getElementById('capacity-save-bar'));

  const toField = (v, fallback) => (v === null || v === undefined || v === '' ? fallback : String(v));

  const snapshot = () => JSON.stringify(form);
  const dirty = () => snapshot() !== JSON.stringify(saved);

  // 1776 → "1,776"; 1645.5 → "1,645.5". Hours, so no currency and no padding.
  const hrs = (n) => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });

  const failureText = (err, action) =>
    err.kind === 'network'
      ? 'Couldn’t ' + action + ' — the server is unreachable. Your changes are still here; try again once it’s back.'
      : 'Couldn’t ' + action + ': ' + (err.message || 'the server refused the request.');

  function readSaved() {
    const goals = LSCData.goals();
    return {
      hoursPerDay: toField(goals.billableHoursPerDay, REFERENCE.hoursPerDay),
      daysPerWeek: toField(goals.workingDaysPerWeek, REFERENCE.daysPerWeek),
      leave: toField(goals.leaveDaysPerYear, REFERENCE.leave),
      sick: toField(goals.sickDaysPerYear, REFERENCE.sick),
      share: toField(goals.utilisationPct, REFERENCE.share),
    };
  }

  /* The form in the shape calc.js and the route both read. parseFloat on a
     half-typed or empty field gives NaN, which annualBillableHours reads as
     "not set" and answers with null — never a zero that looks like a figure. */
  function capacityOf(f) {
    return {
      billableHoursPerDay: parseFloat(f.hoursPerDay),
      workingDaysPerWeek: parseFloat(f.daysPerWeek),
      leaveDaysPerYear: parseFloat(f.leave),
      sickDaysPerYear: parseFloat(f.sick),
      utilisationPct: parseFloat(f.share),
    };
  }

  /* The income floor a given number of annual hours produces — the same
     break-even LSCData.incomeFloor() divides, over the hours being asked about,
     so the confirm quotes the figure every auto price follows (pricing-floor
     PF10; it quoted the overhead rate, which no price follows since PF1). */
  const floorFor = (hours) => incomeFloorPerHour((LSCData.revenueTarget() || {}).breakEven, hours);

  // ── Validation ────────────────────────────────────────────────────────────

  /* Mirrors routes/goals.js's validateCapacity, with one deliberate difference:
     0 billable hours a day is refused here though the route would store it.
     annualBillableHours() answers null for it, so saving it would turn every
     rate on the card into an em dash under a note pointing back to this
     screen — the Goals screen refuses a zero capacity for the same reason. */
  function problems() {
    const c = capacityOf(form);
    const found = [];

    if (!Number.isFinite(c.billableHoursPerDay) || c.billableHoursPerDay <= 0 || c.billableHoursPerDay > 24) {
      found.push({ msg: 'Hours worked per day must be more than 0 and no more than 24.', field: $('cap-hours') });
    }
    if (!Number.isFinite(c.workingDaysPerWeek) || c.workingDaysPerWeek < 1 || c.workingDaysPerWeek > 7) {
      found.push({ msg: 'Working days per week must be between 1 and 7.', field: $('cap-days') });
    }
    if (!Number.isFinite(c.leaveDaysPerYear) || c.leaveDaysPerYear < 0) {
      found.push({ msg: 'Leave and public holidays must be a number of working days, 0 or more.', field: $('cap-leave') });
    }
    if (!Number.isFinite(c.sickDaysPerYear) || c.sickDaysPerYear < 0) {
      found.push({ msg: 'Sick and miscellaneous days must be a number of working days, 0 or more.', field: $('cap-sick') });
    }
    if (!Number.isFinite(c.utilisationPct) || c.utilisationPct < 1 || c.utilisationPct > 100) {
      found.push({ msg: 'Share you can bill must be a percentage from 1 to 100.', field: $('cap-share') });
    }

    /* Only once the fields it depends on are individually valid, so it never
       stacks a second sentence onto a field that is already wrong. Same '>='
       as calc.js and the route: exactly equal leaves zero hours to bill. */
    if (!found.length) {
      const workingDays = c.workingDaysPerWeek * 52;
      const off = c.leaveDaysPerYear + c.sickDaysPerYear;
      if (off >= workingDays) {
        found.push({
          msg:
            'Leave and sick days add up to ' + hrs(off) + ', which uses the whole working year of ' +
            hrs(workingDays) + ' days — there would be no hours left to bill.',
          fields: [$('cap-leave'), $('cap-sick')],
        });
      }
    }
    return found;
  }

  // ── Annual billable hours ─────────────────────────────────────────────────

  /* The working, spelled out under the figure, because this is the number the
     whole rate card divides by and "1,154.4" alone asks to be taken on trust.
     Its last figure is annualBillableHours() itself, not this sum redone, so
     the sentence can never end on a number the figure above it doesn't show.
     A capacity with no share (a pre-v18 payload) is every hour billed, as
     calc.js reads it, and the sentence stops at the hours worked. */
  function derivation(c) {
    const workingDays = c.workingDaysPerWeek * 52;
    const daysWorked = workingDays - c.leaveDaysPerYear - c.sickDaysPerYear;
    const worked = daysWorked * c.billableHoursPerDay;
    const head =
      hrs(c.workingDaysPerWeek) + ' days × 52 weeks = ' + hrs(workingDays) + ' working days, less ' +
      hrs(c.leaveDaysPerYear) + ' leave and ' + hrs(c.sickDaysPerYear) + ' sick = ' +
      hrs(daysWorked) + ' days worked × ' + hrs(c.billableHoursPerDay) + ' hrs = ' + hrs(worked) + ' hrs worked';
    if (!Number.isFinite(c.utilisationPct)) return head + '.';
    return head + ' × ' + hrs(c.utilisationPct) + '% = ' + hrs(annualBillableHours(c)) + ' billable hrs.';
  }

  function missingReason(c) {
    const valid = (n) => Number.isFinite(n);
    const fields = [c.billableHoursPerDay, c.workingDaysPerWeek, c.leaveDaysPerYear, c.sickDaysPerYear, c.utilisationPct];
    if (!fields.every(valid)) {
      return 'Fill in all five fields below and this works itself out.';
    }
    if (c.leaveDaysPerYear + c.sickDaysPerYear >= c.workingDaysPerWeek * 52) {
      return 'Leave and sick days use up the whole working year, so there are no hours left to bill.';
    }
    return 'Hours worked per day must be more than 0 and up to 24, working days per week between 1 and 7, ' +
      'and the share you can bill from 1 to 100%.';
  }

  /* Value and working replaced in place, never the form — a re-render on every
     keystroke would take focus out of the field being typed into. */
  function refreshOutcome() {
    const valueEl = $('cap-annual-value');
    if (!valueEl) return;
    const c = capacityOf(form);
    const annual = annualBillableHours(c);
    valueEl.textContent = annual === null ? '—' : hrs(annual);
    valueEl.classList.toggle('is-empty', annual === null);
    $('cap-annual-note').textContent = annual === null ? missingReason(c) : derivation(c);
  }

  // ── Markup ────────────────────────────────────────────────────────────────

  function fieldMarkup(id, label, hint, attrs, extraClass) {
    return (
      '<div class="field' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<label for="' + id + '">' + label + '</label>' +
      '<input type="number" id="' + id + '" ' + attrs + ' aria-describedby="' + id + '-hint" value="' +
      esc(form[FIELDS[id]]) + '">' +
      '<p class="goals-hint" id="' + id + '-hint">' + hint + '</p>' +
      '</div>'
    );
  }

  function defaultsNote() {
    if (confirmed) return '';
    return (
      '<div class="cap-defaults" id="cap-defaults" role="note">' +
      '<div class="sum-label">Defaults — confirm these are yours</div>' +
      '<p>These figures are the reference defaults, filled in when capacity moved to this screen: ' +
      'the single weekly figure it replaced couldn’t say how much leave or sick time it assumed. ' +
      'They are already pricing your rate card. Change any that aren’t yours, then save to confirm them.</p>' +
      '</div>'
    );
  }

  function markup() {
    return (
      '<div class="page-head"><div><h1 class="page-title">Capacity</h1>' +
      '<div class="page-sub">The hours you can actually sell in a year — the divisor behind every rate on your card</div>' +
      '</div></div>' +

      defaultsNote() +

      /* First, above the fields: the IA doc's order, because it is the output
         people come to this screen for. Not itself a live region — it
         repaints per keystroke; #cap-annual-live speaks it once typing
         pauses (LSCUtil.announce). */
      '<div class="proj-card goals-outcome">' +
      '<div class="sum-label">Annual billable hours</div>' +
      '<div class="goals-outcome-value" id="cap-annual-value"></div>' +
      '<p class="goals-outcome-note" id="cap-annual-note"></p>' +
      '</div>' +
      '<p class="sr-only" id="cap-annual-live" aria-live="polite"></p>' +

      '<div class="form-grid cap-grid">' +
      fieldMarkup(
        'cap-hours',
        'Hours worked per day',
        'A normal working day, start to finish — admin, quoting and email included. The share you can bill, below, takes out the part no client pays for.',
        'min="0" max="24" step="0.5"'
      ) +
      fieldMarkup(
        'cap-days',
        'Working days per week',
        'Days a week the business is working, whether or not every one of them is billed.',
        'min="1" max="7" step="0.5"'
      ) +
      fieldMarkup(
        'cap-leave',
        'Leave + public holidays (working days / year)',
        'Counted in working days, not calendar days: four weeks off is 20, not 28. Include public holidays you don’t work.',
        'min="0" step="1"'
      ) +
      fieldMarkup(
        'cap-sick',
        'Sick + miscellaneous (working days / year)',
        'Sick days, plus working days that won’t be billed at all — gear days, training, the odd dead week. Working days, not calendar days.',
        'min="0" step="1"'
      ) +
      /* Last and on its own row: it applies to the whole year the four above
         add up to, which is also where the working under the figure puts it. */
      fieldMarkup(
        'cap-share',
        'Share you can bill (%)',
        'Of the hours you work, the part a client pays for. The rest is admin, quoting, email, marketing and quiet patches. Most solo businesses bill 55–70%.',
        'min="1" max="100" step="1" inputmode="decimal"',
        'full cap-share'
      ) +
      '</div>' +

      '<div id="capacity-error" role="alert"></div>' +

      '<div class="pricing-save-bar" id="capacity-save-bar">' +
      '<p>Saving moves your income floor, and every auto price on your Rate Card with it: break-even is divided across ' +
      'these hours. Prices you’ve typed, and estimates already saved, keep their figures.</p>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<span class="saved-msg" id="capacity-saved-msg">✓ Capacity saved</span>' +
      '<button type="button" class="btn btn-accent" id="capacity-save" data-write>' +
      '<span class="spinner" id="capacity-spin"></span><span id="capacity-save-label">Save capacity</span></button>' +
      '</div></div>' +

      /* Last: a pointer, not a figure. Since service rate tiers (2026-09-28) the
         hours in a day sold on a job are the Rate Card's own Service Day, which
         is deliberately NOT this screen's hours worked per day — that one is a
         normal working day, and a shoot day runs longer. Repeating a day length
         here would put two numbers for "a day" on two screens. */
      '<div class="cap-fullday">' +
      '<div class="sum-label">Days sold on a job</div>' +
      '<p class="goals-hint">A full or half day on an estimate takes its hours from the Rate Card’s Service Day ' +
      'setting, not from here. Hours worked per day and the share you can bill above only set your hourly floor.</p>' +
      '</div>'
    );
  }

  // ── Errors ────────────────────────────────────────────────────────────────

  function showError(message) {
    const el = $('capacity-error');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  function setSaving(next) {
    saving = next;
    if (!onScreen()) return;
    $('capacity-save').disabled = next;
    $('capacity-spin').style.display = next ? 'inline-block' : 'none';
    $('capacity-save-label').textContent = next ? 'Saving…' : 'Save capacity';
  }

  function flashSaved() {
    const msg = $('capacity-saved-msg');
    if (!msg) return;
    msg.style.display = 'inline';
    setTimeout(() => {
      if (msg.isConnected) msg.style.display = 'none';
    }, 2500);
  }

  /* The before/after question, or null when there is nothing to ask. Before is
     what the card prices against right now — the cached goals, not the form's
     starting values, which for a never-written row are only placeholders. */
  function moveWarning(capacity, afterHours) {
    const beforeHours = annualBillableHours(LSCData.goals());
    if (beforeHours === null || beforeHours === afterHours) return null;

    const before = floorFor(beforeHours);
    const after = floorFor(afterHours);
    const direction = afterHours < beforeHours ? 'rises' : 'falls';
    /* The after figure with its two parts, because a change to the share alone
       moves the hours as much as a week's leave and nothing else on the form
       says so. Hours worked is the share at 100%, through calc.js. */
    const worked = annualBillableHours(Object.assign({}, capacity, { utilisationPct: 100 }));
    let text =
      'Annual billable hours go from ' + hrs(beforeHours) + ' to ' + hrs(afterHours) +
      ' (' + hrs(worked) + ' hrs worked × ' + hrs(capacity.utilisationPct) + '% you can bill).\n\n';
    text +=
      before !== null && after !== null
        ? 'Your income floor ' + direction + ' from ' + fmt(before) + ' to ' + fmt(after) + ' an hour, and every ' +
          'auto price on your Rate Card and the Minimum Job Price on new estimates move with it. Prices you’ve typed don’t move.'
        : 'Your income floor and every auto price on your Rate Card move with this, once Overhead and Profit Goals are set up.';
    text += '\n\nEstimates already saved keep the figures they were quoted at.\n\nSave these hours?';
    return text;
  }

  async function save() {
    if (saving) return;
    LSCUtil.clearFieldErrors($('capacity-error'));

    const found = problems();
    if (found.length) {
      LSCUtil.showFieldErrors($('capacity-error'), found, 'Fix this before saving:');
      return;
    }

    const capacity = capacityOf(form);
    const afterHours = annualBillableHours(capacity);
    const warning = moveWarning(capacity, afterHours);
    if (warning && !window.confirm(warning)) return;

    setSaving(true);
    Toast.working('Saving capacity…');

    let reply;
    try {
      // The five fields only — see the header. Sending the four time fields is
      // also what tells the server this capacity has now been confirmed.
      reply = await LSCApi.put('/api/goals', capacity);
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(failureText(err, 'save your capacity'));
      return;
    }

    /* Before anything else can read it: the Rate Card and the estimate editor
       both compute from this cache at mount, so leaving it stale would show
       yesterday's rate one click away. */
    LSCData.setGoals(reply.goals);
    saved = readSaved();
    confirmed = Boolean(reply.goals.capacityConfirmedAt);

    Toast.ok('Capacity saved — your rates now use ' + hrs(annualBillableHours(reply.goals)) + ' billable hours a year.');
    setSaving(false);
    if (!onScreen()) return;

    form = Object.assign({}, saved);
    Object.keys(FIELDS).forEach((id) => {
      const input = $(id);
      if (input && input.value !== form[FIELDS[id]]) input.value = form[FIELDS[id]];
    });
    if (confirmed && $('cap-defaults')) $('cap-defaults').remove();
    refreshOutcome();
    flashSaved();
  }

  // ── Binding ───────────────────────────────────────────────────────────────

  /* Held as typed, not parsed on the way in — parsing "7." mid-keystroke turns
     it into 7 while the user is still typing 7.5, and parsing "" turns a blank
     into a 0 that validation can no longer tell from a real one. */
  function bind() {
    Object.keys(FIELDS).forEach((id) => {
      $(id).addEventListener('input', function () {
        form[FIELDS[id]] = this.value;
        refreshOutcome();
        const c = capacityOf(form);
        const annual = annualBillableHours(c);
        LSCUtil.announce(
          $('cap-annual-live'),
          annual === null
            ? 'Annual billable hours: not set. ' + missingReason(c)
            : 'Annual billable hours: ' + hrs(annual) + '.'
        );
      });
    });
    $('capacity-save').addEventListener('click', save);
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    saving = false;

    confirmed = Boolean(LSCData.goals().capacityConfirmedAt);
    saved = readSaved();
    form = Object.assign({}, saved);

    root.innerHTML = markup();
    refreshOutcome();
    bind();

    LSCUnsaved.watch('capacity', {
      label: 'your capacity',
      onScreen,
      dirty,
    });
  }

  /* derivation() is exported for Profit Goals, which shows the same annual
     figure read-only with the same working under it — one sentence, so the
     two screens can't explain the number differently. */
  return { mount, derivation };
})();
