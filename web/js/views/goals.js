'use strict';

/* The Profit Goals screen — what the business needs to earn, and what is meant
 * to be left over.
 *
 * WHY THIS SCREEN EXISTS
 * The Overhead screen answers "what does the year cost." This one answers "how
 * much is meant to be left over": Target Profit Margin is the margin
 * minimumJobPrice() and every floor on the Dashboard and Rate Card add, and
 * Desired Net Income is a planning figure only.
 *
 * CAPACITY IS SHOWN HERE, NOT SET HERE (2026-09-27)
 * This screen used to own "Billable Capacity (hrs / week)", annualised over an
 * assumed 48 weeks. Both are gone: capacity is four real fields on the
 * Capacity screen, and annual billable hours are derived from them — one
 * writer per number (IA doc read/write map). What remains here is the annual
 * figure, read-only, with Capacity's own working under it
 * (CapacityView.derivation) and a link to change it there. It is not an input,
 * disabled or otherwise: a greyed-out box reads as "you can't edit this right
 * now", when the truth is "this is edited somewhere else". The save no longer
 * sends the weekly figure; the route recomputes that legacy column from the
 * four fields on every write regardless.
 *
 * DESIRED NET INCOME IS A PLANNING FIGURE, NOT A FLOOR
 * It feeds Target Annual Revenue below and nothing else. Nothing in this
 * feature compares it against a per-row or per-job number, and nothing checks
 * that a rate card's mark-ups add up to it — that is the wage-adequacy gap the
 * accounting review on 2026-09-15 put in front of the user, who chose to keep
 * `mu` fully manual and trusted. Don't wire this into a per-job calculation
 * without asking again; it was declined knowingly.
 *
 * TWO UNITS IN ONE FORM — THE TRAP IN THIS FILE
 * Target Profit Margin is a PERCENT (25 means 25%, and goals.
 * target_profit_margin_pct stores it that way). The tax reserve is a FRACTION
 * on the wire (0.35), shown as a percent in its field, exactly as the Pricing
 * screen does it. So the margin is sent through untouched and the tax is
 * divided by 100 on the way out and multiplied on the way in. Getting these
 * crossed under-prices every job by about 25% and is invisible on screen, so
 * the conversion happens in exactly one place at each boundary, marked below.
 *
 * THE TAX CONTROL WRITES THE WHOLE RATE CARD — READ THIS BEFORE EDITING save()
 * There is no tax column on `goals`: the Tax Reserve Target is
 * pricing.taxSetAsideRate, the same stored number the Pricing screen's own
 * field writes, per the brief's "one number, one truth". But PUT /api/pricing
 * is a WHOLE-DOCUMENT write — server/src/routes/pricing.js replaces
 * pricing.data_json with the request body verbatim, and readPricing() then
 * returns whatever is in there with no merge against DEFAULT_PRICING. Sending
 * { taxSetAsideRate } on its own would therefore not update one field: it
 * would replace the entire rate card with an object that has no
 * labourSections and no travelRows, and computeTotals silently prices every
 * labour and travel line at zero against a card it can't find rows in. So the
 * body below is the whole cached card with one field swapped, and it must stay
 * that way.
 *
 * ONE BUTTON, TWO WRITES, AND AN HONEST FAILURE
 * The brief asks for a single explicit Save, and the tax control is grouped
 * with the other rate-driving inputs rather than given its own. That is one
 * button over two different endpoints, so they run in sequence rather than in
 * parallel: goals first, then the rate card, and only if the tax field
 * actually changed. Sequential because a Promise.all that half-fails can't
 * tell the user which half — and "saved" has to mean saved here for the same
 * reason this whole rewrite exists. If the second write fails, the message
 * says plainly that the goals landed and the tax reserve didn't, and the tax
 * field stays dirty while the other three go clean.
 *
 * TARGET ANNUAL REVENUE RECOMPUTES AS YOU TYPE
 * Unlike the Pricing screen's rate column, which is computed once at mount,
 * this stat follows the fields live. The two are not inconsistent: Pricing's
 * inputs live on another screen and cannot move while you are looking at it,
 * whereas these are three inches above the figure they produce, and a planning
 * number that only appears after a save makes the screen feel broken. It is
 * derived and never persisted either way, so there is nothing for a live
 * figure to disagree with. When it can't be computed it is an em dash with a
 * sentence saying what is missing — never $0, which would read as an answer.
 */

const GoalsView = (() => {
  const { esc, fmt, num } = LSCUtil;
  const { targetAnnualRevenue, annualBillableHours } = LSCCalc;

  const hrs = (n) => Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 });

  let root = null;
  let handlers = null;
  let saving = false;
  let form = null; // the three fields exactly as typed
  let saved = null; // the same three, as the server last confirmed them

  const $ = (id) => root.querySelector('#' + id);

  /* Is this screen still in the page? Saves are async and neither the sub-tab
     row nor the header waits for them, so an outcome can land after the user
     has moved on. Asked of the document rather than of `root`: leaving Finance
     replaces #main wholesale, taking #finance-sub out of the document with
     this screen still inside it, and a detached node would still answer its
     own querySelector — which is what left a stale watcher interrupting every
     later navigation before pricing.js's sentinel was fixed the same way. */
  const onScreen = () => Boolean(document.getElementById('goals-save-bar'));

  /* FRACTION -> PERCENT, the read half of the tax conversion. Verbatim from
     pricing.js, including the 6-decimal snap: a plain ×100 puts the float
     error on screen, where 0.07 renders as 7.000000000000001. */
  const toPercent = (rate) => String(Math.round(num(rate) * 1e8) / 1e6);

  /* An unsaved goals singleton comes back as three nulls (there is no
     non-arbitrary income or capacity to guess), and those have to reach the
     screen as empty fields. String(null) would put the word "null" in the box
     and num(null) would put a 0 there, which reads as a figure somebody
     chose. */
  const toField = (v) => (v === null || v === undefined || v === '' ? '' : String(v));

  const snapshot = () => JSON.stringify(form);
  const dirty = () => snapshot() !== JSON.stringify(saved);

  const failureText = (err, action) =>
    err.kind === 'network'
      ? 'Couldn’t ' + action + ' — the server is unreachable. Your changes are still here; try again once it’s back.'
      : 'Couldn’t ' + action + ': ' + (err.message || 'the server refused the request.');

  /* The saved state, read out of the caches rather than off the wire — the two
     halves of this screen live in two different payloads, both already
     preloaded by LSCData.load(). */
  function readSaved() {
    const goals = LSCData.goals();
    return {
      net: toField(goals.desiredNetIncome),
      // PERCENT in, percent out — target_profit_margin_pct is stored as one.
      margin: toField(goals.targetProfitMarginPct),
      // The one field on this screen that is converted: stored as a fraction.
      tax: toPercent(LSCData.pricing().taxSetAsideRate),
    };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /* Every field is required. A value that IS sent is coerced with
     `Number(x) || 0` by the route, so an empty margin would store a 0% margin —
     which minimumJobPrice() treats as break-even and renders as a real floor,
     not as "not set". Blocking the save is the honest version of that. */
  function problems() {
    const found = [];

    const net = parseFloat(form.net);
    if (!Number.isFinite(net) || net < 0) {
      found.push({ msg: 'Desired Net Income must be a number of dollars, 0 or more.', field: $('goals-net') });
    }

    /* No upper bound, deliberately: minimumJobPrice() accepts any margin from 0
       up, and a 150% margin is a real pricing decision in some businesses. The
       view should not be stricter than the function it feeds. The unit is the
       thing worth saying out loud here, because 0.25 typed for 25% is a valid
       number that silently prices a quarter of one percent. */
    const margin = parseFloat(form.margin);
    if (!Number.isFinite(margin) || margin < 0) {
      found.push({
        msg: 'Target Profit Margin must be a number, 0 or more — it’s a percent, so 25 means 25%.',
        field: $('goals-margin'),
      });
    }

    /* The same 0-100 rule pricing.js applies to the same stored field, on
       purpose — two screens writing one number must not disagree about what a
       valid one is. Note that 100 exactly is accepted here and still leaves
       Target Annual Revenue uncomputable, because targetAnnualRevenue() divides
       by (1 - rate). The stat says so; the save is not blocked for it. */
    const tax = parseFloat(form.tax);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      found.push({ msg: 'The tax reserve target must be a number between 0 and 100.', field: $('goals-tax-inp') });
    }

    return found;
  }

  // ── Target Annual Revenue ─────────────────────────────────────────────────

  /* Recomputed from the live fields, so it answers the question the person is
     in the middle of asking. The overhead half comes from the cache, since
     nothing on this screen can change an expense.

     Note what is passed straight through without coercion: targetAnnualRevenue
     runs every argument through numOrNull, which reads '' and NaN as "not
     set", so an empty field and a half-typed one both fall out as null rather
     than as a zero that would make the arithmetic look answerable. */
  function computeTarget() {
    /* Business cost (operating + gear replacement reserve), the same figure
       the Dashboard's target annual revenue uses — see LSCData.businessCost(). */
    return targetAnnualRevenue(
      LSCData.businessCost(),
      form.net,
      // PERCENT -> FRACTION, the write half of the tax conversion.
      parseFloat(form.tax) / 100
    );
  }

  /* Why the figure can't be computed, in the order targetAnnualRevenue itself
     checks — so the sentence always names the first thing actually blocking it
     rather than the first thing this function happens to test. An em dash with
     no explanation is indistinguishable from a bug. */
  function missingReason() {
    const annual = LSCData.businessCost();
    if (!(annual > 0)) {
      return (
        'Add what the business costs to run on the ' +
        '<button type="button" class="goals-link" data-go-tab="overhead">Overhead tab</button>' +
        ' and this fills in.'
      );
    }
    const net = parseFloat(form.net);
    if (!Number.isFinite(net) || net < 0) {
      return 'Set a Desired Net Income above and this fills in.';
    }
    const tax = parseFloat(form.tax);
    if (!Number.isFinite(tax) || tax < 0) {
      return 'Set a tax reserve target above and this fills in.';
    }
    if (tax >= 100) {
      return 'A tax reserve of 100% leaves nothing to take home, so there is no revenue figure that reaches your target.';
    }
    return 'Fill in the fields above and this fills in.';
  }

  function outcomeNote(value) {
    if (value === null) return missingReason();
    return (
      'What the business costs to run, ' + fmt(LSCData.businessCost()) +
      ' a year, plus the income you want, grossed up so the tax reserve comes out of it. ' +
      'This is what the business needs to invoice in a year — not what any one job should cost.'
    );
  }

  /* The value and its note, replaced in place. The rest of the screen is left
     alone on purpose: re-rendering the form on every keystroke would take the
     focus out of the field being typed into. */
  function refreshOutcome() {
    const valueEl = $('goals-tar-value');
    if (!valueEl) return;
    const value = computeTarget();
    valueEl.textContent = value === null ? '—' : fmt(value);
    valueEl.classList.toggle('is-empty', value === null);
    $('goals-tar-note').innerHTML = outcomeNote(value);
  }

  // ── Markup ────────────────────────────────────────────────────────────────

  function fieldMarkup(id, label, value, hint, attrs) {
    return (
      '<div class="field">' +
      '<label for="' + id + '">' + label + '</label>' +
      '<input type="number" id="' + id + '" ' + attrs + ' aria-describedby="' + id + '-hint" value="' +
      esc(value) + '">' +
      '<p class="goals-hint" id="' + id + '-hint">' + hint + '</p>' +
      '</div>'
    );
  }

  /* Annual billable hours, read-only — see "CAPACITY IS SHOWN HERE" above. */
  function hoursMarkup() {
    const goals = LSCData.goals();
    const hours = annualBillableHours(goals);
    const link = '<button type="button" class="goals-link" data-go-tab="capacity">Capacity screen</button>';
    const working =
      hours === null
        ? null
        : CapacityView.derivation({
            billableHoursPerDay: Number(goals.billableHoursPerDay),
            workingDaysPerWeek: Number(goals.workingDaysPerWeek),
            leaveDaysPerYear: Number(goals.leaveDaysPerYear),
            sickDaysPerYear: Number(goals.sickDaysPerYear),
          });
    return (
      '<div class="field goals-derived">' +
      '<span class="goals-derived-label">Annual billable hours</span>' +
      '<div class="goals-derived-value' + (hours === null ? ' is-empty' : '') + '">' +
      (hours === null ? '—' : hrs(hours) + ' hrs') + '</div>' +
      '<p class="goals-hint">' +
      (hours === null
        ? 'Not set up yet — set your working days, leave and hours on the ' + link + '.'
        : esc(working) + ' Set on the ' + link + ' — change it there.') +
      '</p></div>'
    );
  }

  function markup() {
    const value = computeTarget();

    return (
      '<div class="page-head"><div><h1 class="page-title">Profit Goals</h1>' +
      '<div class="page-sub">What the business needs to earn, and what’s left over once it’s paid for</div>' +
      '</div></div>' +

      /* First, above the fields — where Capacity puts its annual hours, so the
         two sibling screens read the same way: the output people open the
         screen for, then the inputs that move it. The card's own border is
         what separates it from everything editable. This used to sit below
         the save bar, per the overhead-finance IA; moved 2026-09-28 by the
         user's call (Finance & Price design review, should-fix 8). */
      '<div class="proj-card goals-outcome">' +
      '<div class="sum-label">Target Annual Revenue</div>' +
      '<div class="goals-outcome-value' + (value === null ? ' is-empty' : '') + '" id="goals-tar-value">' +
      (value === null ? '—' : fmt(value)) + '</div>' +
      '<p class="goals-outcome-note" id="goals-tar-note">' + outcomeNote(value) + '</p>' +
      '</div>' +
      // Spoken once typing pauses — see LSCUtil.announce().
      '<p class="sr-only" id="goals-tar-live" aria-live="polite"></p>' +

      '<div class="form-grid goals-grid">' +
      fieldMarkup(
        'goals-net',
        'Desired Net Income ($ / year)',
        form.net,
        'What you want left over in a year once overhead and tax are covered. A planning figure — nothing prices a job against it.',
        'min="0" step="1000"'
      ) +
      fieldMarkup(
        'goals-margin',
        'Target Profit Margin (%)',
        form.margin,
        'Added on top of cost when a job’s minimum price is worked out. A percent: enter 25 for 25%, not 0.25.',
        'min="0" step="1"'
      ) +
      hoursMarkup() +
      '</div>' +

      /* .tax-setting verbatim, the same component the Pricing screen uses for
         the same stored number — which is why the copy says so out loud. Its
         input is #goals-tax-inp and NOT #tax-inp: that id is what pricing.js's
         onScreen() sentinel looks for to decide whether the rate card is still
         in the page, so a second one in the document would have Pricing
         answering for this screen's field and keeping a dead watcher alive. */
      '<div class="tax-setting"><div>' +
      '<div class="sum-label" style="margin-bottom:4px">Tax Reserve Target (%)</div>' +
      '<div style="color:var(--muted);font-size:11px">The same setting as the rate card’s Tax Set-Aside Rate — ' +
      'change it here and it changes there. Provisioned against labour revenue only, before GST.</div></div>' +
      '<input type="number" id="goals-tax-inp" min="0" max="100" step="0.5" value="' + esc(form.tax) +
      '" aria-label="Tax reserve target, percent"></div>' +

      '<div id="goals-error" role="alert"></div>' +

      '<div class="pricing-save-bar" id="goals-save-bar">' +
      '<p>Saving moves the floors on your Dashboard and Rate Card, and every new estimate’s minimum job price. Estimates already saved keep the figures they were quoted at.</p>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<span class="saved-msg" id="goals-saved-msg">✓ Goals saved</span>' +
      '<button type="button" class="btn btn-accent" id="goals-save" data-write>' +
      '<span class="spinner" id="goals-spin"></span><span id="goals-save-label">Save Goals</span></button>' +
      '</div></div>'
    );
  }

  // ── Errors ────────────────────────────────────────────────────────────────

  function showError(message) {
    const el = $('goals-error');
    if (!el) return; // left while the request was in flight
    el.textContent = message;
    el.classList.add('show');
  }

  function clearError() {
    LSCUtil.clearFieldErrors($('goals-error'));
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  function setSaving(next) {
    // The flag first: it is module state and has to be cleared even when the
    // button it describes has left the page.
    saving = next;
    if (!onScreen()) return;
    $('goals-save').disabled = next;
    $('goals-spin').style.display = next ? 'inline-block' : 'none';
    $('goals-save-label').textContent = next ? 'Saving…' : 'Save Goals';
  }

  function flashSaved() {
    const msg = $('goals-saved-msg');
    if (!msg) return;
    msg.style.display = 'inline';
    setTimeout(() => {
      if (msg.isConnected) msg.style.display = 'none';
    }, 2500);
  }

  /* The fields put back to what the server confirmed, without rebuilding the
     screen. Pricing re-renders after a save because adding or deleting a row
     invalidates every data-si/data-ri index on the card; nothing here is
     structural, and not re-rendering leaves focus on the Save button the user
     just pressed instead of dropping it to <body>. */
  function syncFields() {
    const map = { 'goals-net': 'net', 'goals-margin': 'margin', 'goals-tax-inp': 'tax' };
    Object.keys(map).forEach((id) => {
      const input = $(id);
      if (input && input.value !== form[map[id]]) input.value = form[map[id]];
    });
  }

  async function save() {
    if (saving) return;
    clearError();

    const found = problems();
    if (found.length) {
      // Inline rather than alert(), which would cover the fields it names.
      LSCUtil.showFieldErrors($('goals-error'), found, 'Fix this before saving:');
      return;
    }

    // Compared as typed, the same comparison dirty() makes, so the two can't
    // disagree about whether this field changed. A re-typed identical value
    // costs one idempotent write of the same document.
    const taxChanged = form.tax !== saved.tax;

    setSaving(true);
    Toast.working('Saving goals…');

    try {
      const reply = await LSCApi.put('/api/goals', {
        desiredNetIncome: parseFloat(form.net),
        // PERCENT on the wire — target_profit_margin_pct stores a percent.
        // Do not divide this by 100.
        targetProfitMarginPct: parseFloat(form.margin),
        // Not billableCapacityHrsPerWeek: Capacity owns hours now, and the
        // route recomputes that legacy column itself on every save.
      });
      /* Before anything else can read it: the Pricing tab one click away
         computes its whole rate column from this cache at mount, so a cache
         left stale here shows a stale rate with no way to tell. */
      LSCData.setGoals(reply.goals);
      saved.net = toField(reply.goals.desiredNetIncome);
      saved.margin = toField(reply.goals.targetProfitMarginPct);
    } catch (err) {
      setSaving(false);
      Toast.hide();
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
      showError(failureText(err, 'save your goals'));
      return;
    }

    if (taxChanged) {
      try {
        /* The WHOLE rate card with one field swapped — see the header note.
           PUT /api/pricing replaces the stored document outright, so a body of
           just { taxSetAsideRate } would delete every category, service and
           travel row on the card. */
        const body = Object.assign({}, LSCData.pricing(), {
          // PERCENT -> FRACTION. taxSetAsideRate is stored as 0.35, not 35.
          taxSetAsideRate: parseFloat(form.tax) / 100,
        });
        const reply = await LSCApi.put('/api/pricing', body);
        LSCData.setPricing(reply.pricing);
        saved.tax = toPercent(reply.pricing.taxSetAsideRate);
      } catch (err) {
        setSaving(false);
        Toast.hide();
        if (!(err instanceof LSCApi.ApiError)) throw err;
        if (err.kind === 'auth') return handlers.onAuthLost({ keepScreen: true });
        /* Half of a two-endpoint save landed. Saying only "couldn't save"
           would be false — the goals are stored, and the three fields above
           are now clean while this one is still dirty. */
        showError(
          'Your goals were saved, but the tax reserve target wasn’t. ' +
            failureText(err, 'save it')
        );
        return;
      }
    }

    Toast.ok('Goals saved.');
    setSaving(false);
    if (!onScreen()) return;
    form = Object.assign({}, saved);
    syncFields();
    refreshOutcome();
    flashSaved();
  }

  // ── Binding ───────────────────────────────────────────────────────────────

  /* Field edits write straight to the working copy with no re-render, so a
     value never reformats itself under the cursor mid-keystroke. Held as the
     string that was typed rather than parsed on the way in, for the reason the
     Pricing screen holds taxRaw the same way: parsing "1." on every keystroke
     turns it into 1 while the user is still typing 1.5, and parsing "" turns a
     blank field into a 0 that validation can no longer tell from a real one. */
  function bind() {
    const fields = {
      'goals-net': 'net',
      'goals-margin': 'margin',
      'goals-tax-inp': 'tax',
    };
    Object.keys(fields).forEach((id) => {
      $(id).addEventListener('input', function () {
        form[fields[id]] = this.value;
        refreshOutcome();
        // The margin field doesn't move this figure, so it announces nothing
        // new — announce() skips text that hasn't changed.
        const value = computeTarget();
        LSCUtil.announce(
          $('goals-tar-live'),
          value === null
            ? 'Target annual revenue: not set. ' + $('goals-tar-note').textContent
            : 'Target annual revenue: ' + fmt(value) + '.'
        );
      });
    });

    /* Delegated, because the Overhead link lives inside the outcome note,
       which refreshOutcome() rewrites on every keystroke — a listener bound to
       the button itself would be thrown away with it. onGoTab is FinanceView's
       selectTab, which asks LSCUnsaved before it swaps screens, so following
       this link from a half-filled form offers to save it first. Absent if
       this view is ever mounted outside Finance, in which case the link does
       nothing rather than throwing. */
    root.addEventListener('click', (event) => {
      const link = event.target.closest('[data-go-tab]');
      if (link && handlers.onGoTab) handlers.onGoTab(link.dataset.goTab);
    });

    $('goals-save').addEventListener('click', save);
  }

  function mount(container, viewHandlers) {
    root = container;
    handlers = viewHandlers || {};
    saving = false;

    saved = readSaved();
    form = Object.assign({}, saved);

    root.innerHTML = markup();
    bind();

    LSCUnsaved.watch('goals', {
      label: 'your goals',
      onScreen,
      dirty,
    });
  }

  return { mount };
})();
