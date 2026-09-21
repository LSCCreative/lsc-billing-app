'use strict';

/* The Goals screen — what the business needs to earn, and the hours it has to
 * earn it in.
 *
 * WHY THIS SCREEN EXISTS
 * The Overhead screen answers "what does the year cost." This one answers the
 * two questions that turn that into a rate: how many hours are actually
 * billable in a week, and how much is meant to be left over. Billable Capacity
 * is the divisor in overheadRatePerHour(), so every labour rate on the Pricing
 * card moves the moment it is saved here; Target Profit Margin is the margin
 * minimumJobPrice() adds; Desired Net Income is a planning figure only.
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
  const { annualOverheadTotal, targetAnnualRevenue } = LSCCalc;

  let root = null;
  let handlers = null;
  let saving = false;
  let form = null; // the four fields exactly as typed
  let saved = null; // the same four, as the server last confirmed them

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
      capacity: toField(goals.billableCapacityHrsPerWeek),
      // The one field on this screen that is converted: stored as a fraction.
      tax: toPercent(LSCData.pricing().taxSetAsideRate),
    };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /* Every field is required. A goals row is not usefully half-filled: the
     route coerces a blank with `Number(x) || 0`, so saving an empty Billable
     Capacity would store a 0, and overheadRatePerHour() returns null on a zero
     divisor — which means every labour rate on the Pricing card would go back
     to an em dash under a note telling you to come here and set it, having
     just come here and set it. Blocking the save is the honest version of
     that. */
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

    /* Upper bound of 168 because these are hours inside one week and there are
       168 of them. It is not pedantry: a year's worth of hours typed into a
       weekly field (960, say) is an easy slip that divides the annual overhead
       by fifty times too many hours, quietly under-recovering it on every job
       from then on, with nothing on any screen looking wrong. */
    const capacity = parseFloat(form.capacity);
    if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 168) {
      found.push({
        msg: 'Billable Capacity is hours in one week: more than 0, and no more than 168.',
        field: $('goals-capacity'),
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
    return targetAnnualRevenue(
      annualOverheadTotal(LSCData.overheadItems()),
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
    const annual = annualOverheadTotal(LSCData.overheadItems());
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
      'Your overhead of ' + fmt(annualOverheadTotal(LSCData.overheadItems())) +
      ' a year plus the income you want, grossed up so the tax reserve comes out of it. ' +
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

  function markup() {
    const value = computeTarget();

    return (
      '<div class="page-head"><div><h1 class="page-title">Goals</h1>' +
      '<div class="page-sub">What the business needs to earn, and the hours you have to earn it in</div>' +
      '</div></div>' +

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
      fieldMarkup(
        'goals-capacity',
        'Billable Capacity (hrs / week)',
        form.capacity,
        'Hours you can actually bill in a working week — annualised over 48 weeks, so leave and downtime don’t flatter the rate. This is the divisor behind every rate on your card.',
        'min="0" max="168" step="0.5"'
      ) +
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
      '<p>Saving changes every labour rate on your card from here on. Estimates already saved keep the figures they were quoted at.</p>' +
      '<div style="display:flex;align-items:center;gap:12px">' +
      '<span class="saved-msg" id="goals-saved-msg">✓ Goals saved</span>' +
      '<button type="button" class="btn btn-accent" id="goals-save" data-write>' +
      '<span class="spinner" id="goals-spin"></span><span id="goals-save-label">Save Goals</span></button>' +
      '</div></div>' +

      /* Below the save bar, not among the fields: it is an output, and the IA
         doc asks for it to be separated from everything editable. The bar is
         what does the separating — there is no second rule to draw. */
      '<div class="proj-card goals-outcome">' +
      '<div class="sum-label">Target Annual Revenue</div>' +
      '<div class="goals-outcome-value' + (value === null ? ' is-empty' : '') + '" id="goals-tar-value">' +
      (value === null ? '—' : fmt(value)) + '</div>' +
      '<p class="goals-outcome-note" id="goals-tar-note">' + outcomeNote(value) + '</p>' +
      '</div>'
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
    const map = { 'goals-net': 'net', 'goals-margin': 'margin', 'goals-capacity': 'capacity', 'goals-tax-inp': 'tax' };
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
        billableCapacityHrsPerWeek: parseFloat(form.capacity),
      });
      /* Before anything else can read it: the Pricing tab one click away
         computes its whole rate column from this cache at mount, so a cache
         left stale here shows a stale rate with no way to tell. */
      LSCData.setGoals(reply.goals);
      saved.net = toField(reply.goals.desiredNetIncome);
      saved.margin = toField(reply.goals.targetProfitMarginPct);
      saved.capacity = toField(reply.goals.billableCapacityHrsPerWeek);
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
      'goals-capacity': 'capacity',
      'goals-tax-inp': 'tax',
    };
    Object.keys(fields).forEach((id) => {
      $(id).addEventListener('input', function () {
        form[fields[id]] = this.value;
        refreshOutcome();
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
