'use strict';

/* The charts on the Overhead screen — the trend and the donut on Operating
 * Costs, and the decline curve on its Depreciation tab, which shares their
 * axis helpers and palette (see "The decline curve" below). Hand-rolled
 * inline SVG, no library — this directory ships to GitHub Pages as-is and has no build step, so a chart
 * dependency would be the first one in the app.
 *
 * WHY THIS IS ITS OWN FILE
 * overhead.js is the CRUD screen: a table, a modal, four write paths. The
 * charts are pure presentation over the same cache and share none of that
 * state, so they sit beside it rather than inside it.
 *
 * MARKUP IN, MARKUP OUT — NOTHING HELD
 * OverheadView.render() rewrites root.innerHTML wholesale on every write, so
 * anything built here is torn down and rebuilt with it. Nothing in this module
 * keeps an element reference across a render; drawTrend() re-queries the
 * container every time it runs, including on window resize.
 *
 * TWO CHARTS, TWO SHAPES — ON PURPOSE
 * The trend is trendMarkup() + drawTrend(), because it is drawn at the
 * container's measured pixel width. The donut is donutMarkup() alone, because
 * it is a fixed square with nothing to measure. The reason is written out above
 * donutMarkup(); the split is not a house style to copy for its own sake.
 *
 * THE X AXIS IS EVENT ORDER, NOT ELAPSED TIME
 * overhead_snapshots gets one row per add/edit/delete, whenever those happen —
 * the four rows in the scratch database are twelve milliseconds apart. Plotting
 * those on a true time axis stacks all four on one vertical line; add one edit
 * a year later and it owns the whole width while the rest collapse to a dot.
 * So points are spaced evenly in the order they happened, and the chart says
 * so in its own caption rather than pretending the spacing means something.
 * The dates under the line are where elapsed time is actually readable.
 */

const OverheadCharts = (() => {
  const { esc, fmt } = LSCUtil;
  /* The donut slices by annual cost, not by the cost as typed — see the note
     above donutMarkup(). Same function the Monthly Equivalent column uses. */
  const { annualisedCost } = LSCCalc;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ts is stored UTC (nowIso()), read back with local getters — the same call
     util.js's today() makes, and for the same reason: a write made at 9am in
     Australia is stored as the previous day in UTC, and the date a person
     remembers is the one their own clock showed. */
  function parseTs(ts) {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  /* The year is left off unless the chart actually crosses one. A run from
     January 2025 to February 2026 labelled "12 Jan … 12 Feb" reads as two
     months of the same year and reverses the shape of the story — caught
     against a fourteen-point fixture, not reasoned about. Within one year the
     year is noise, and the full date is in every point's tooltip regardless. */
  const shortDate = (d, withYear) =>
    d
      ? d.getDate() + ' ' + MONTHS[d.getMonth()] + (withYear ? ' ' + String(d.getFullYear()).slice(2) : '')
      : '—';
  const fullDate = (d) =>
    d ? d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() : 'an unknown date';

  // ── Scales ────────────────────────────────────────────────────────────────

  /* A tick step off the 1 / 2 / 2.5 / 5 ladder, so the axis reads in round
     money rather than in whatever a quarter of the largest total happens to be
     ($6,250 ticks for a $24,000 chart, say). */
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const exponent = Math.pow(10, Math.floor(Math.log10(raw)));
    const fraction = raw / exponent;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
    return nice * exponent;
  }

  /* Short enough to live in a 50px gutter. fmt() is right for the tooltip and
     the summary line — the exact dollars and cents — and far too long here:
     "$24,000.00" five times down the side of the chart is more precision than
     an axis is for, and it would push the plot area into the margin. */
  function axisMoney(value) {
    if (!value) return '$0';
    if (Math.abs(value) >= 1000) {
      const thousands = value / 1000;
      const rounded = Math.abs(thousands % 1) > 0.05 ? thousands.toFixed(1) : String(Math.round(thousands));
      return '$' + rounded + 'k';
    }
    return '$' + Math.round(value);
  }

  /* The y axis always starts at zero. A money chart auto-scaled to its own
     minimum turns a 2% rise into a cliff, which is the one thing a trend chart
     must not do to a number somebody prices their work from. */
  function yAxis(maxTotal) {
    // Every snapshot at zero (everything deleted) is a real state, not an
    // error: the line sits flat on the baseline and the axis still reads.
    const step = maxTotal > 0 ? niceStep(maxTotal / 4) : 250;
    const top = maxTotal > 0 ? step * Math.ceil(maxTotal / step) : 1000;
    const ticks = [];
    for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
    return { top, ticks };
  }

  // ── The trend chart ───────────────────────────────────────────────────────

  function trendSvg(points, width) {
    const height = width < 520 ? 200 : 240;
    const axis = yAxis(points.reduce((max, point) => Math.max(max, point.total), 0));
    const labels = axis.ticks.map(axisMoney);
    // Room for the longest tick label rather than a fixed gutter, so "$30k"
    // doesn't get the same 62px "$12.5k" needs.
    const padLeft = 20 + labels.reduce((max, label) => Math.max(max, label.length), 0) * 6.2;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 34;
    const plotLeft = padLeft;
    const plotRight = width - padRight;
    const plotTop = padTop;
    const plotBottom = height - padBottom;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    const xAt = (index) => plotLeft + (plotWidth * index) / (points.length - 1);
    const yAt = (total) => plotBottom - (plotHeight * total) / axis.top;

    const gridlines = axis.ticks
      .map((value) => {
        const y = yAt(value);
        return (
          '<line class="oh-chart-grid" x1="' + plotLeft.toFixed(1) + '" y1="' + y.toFixed(1) +
          '" x2="' + plotRight.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
          '<text class="oh-chart-tick" x="' + (plotLeft - 9).toFixed(1) + '" y="' + y.toFixed(1) +
          '" text-anchor="end" dominant-baseline="middle">' + esc(axisMoney(value)) + '</text>'
        );
      })
      .join('');

    const coords = points.map((point, index) => xAt(index).toFixed(1) + ',' + yAt(point.total).toFixed(1));
    const area =
      'M' + xAt(0).toFixed(1) + ',' + plotBottom.toFixed(1) +
      'L' + coords.join('L') +
      'L' + xAt(points.length - 1).toFixed(1) + ',' + plotBottom.toFixed(1) + 'Z';

    /* Markers are the data; the line between them is only connective tissue.
       They come off once they would collide — years of edits put hundreds of
       points across 600px, and a solid bar of overlapping circles reads as
       noise rather than as detail. The line and the hover targets stay. */
    const spacing = plotWidth / (points.length - 1);
    const showMarkers = points.length <= 40 && spacing >= 14;
    const markers = showMarkers
      ? points
          .map((point, index) => {
            const last = index === points.length - 1;
            return (
              '<circle class="oh-chart-dot' + (last ? ' is-now' : '') + '" cx="' + xAt(index).toFixed(1) +
              '" cy="' + yAt(point.total).toFixed(1) + '" r="3.5"/>'
            );
          })
          .join('')
      : '';

    /* A 3.5px circle is not a hover target. These are transparent, twice the
       radius, drawn last so they sit on top, and they carry the <title> —
       which is what the brief asks the hover to show. fill="transparent" not
       fill="none": "none" means the shape isn't painted and stops receiving
       pointer events, which would make the tooltip unreachable.
       The radius shrinks with the spacing rather than staying 11: overlapping
       targets hand every hover to whichever circle was drawn last, so on a
       dense chart the tooltip would name a point several steps from the one
       under the cursor. */
    const hitRadius = Math.max(4, Math.min(11, spacing / 2));
    const hits = points
      .map(
        (point, index) =>
          '<circle class="oh-chart-hit" cx="' + xAt(index).toFixed(1) + '" cy="' +
          yAt(point.total).toFixed(1) + '" r="' + hitRadius.toFixed(1) + '" fill="transparent"><title>' +
          esc(fullDate(point.date) + ' — ' + fmt(point.total)) + '</title></circle>'
      )
      .join('');

    const xLabels = dateLabels(points, width)
      .map(
        (label) =>
          '<text class="oh-chart-date" x="' + xAt(label.index).toFixed(1) + '" y="' +
          (plotBottom + 21).toFixed(1) + '" text-anchor="' + label.anchor + '">' +
          esc(label.text) + '</text>'
      )
      .join('');

    const first = points[0];
    const last = points[points.length - 1];
    const summary =
      points.length + ' recorded changes, from ' + fmt(first.total) + ' on ' + fullDate(first.date) +
      ' to ' + fmt(last.total) + ' on ' + fullDate(last.date) + '.';

    return (
      '<svg class="oh-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width +
      '" height="' + height + '" role="img" aria-label="' + esc('Overhead trend: ' + summary) + '">' +
      gridlines +
      '<path class="oh-chart-area" d="' + area + '"/>' +
      '<polyline class="oh-chart-line" points="' + coords.join(' ') + '"/>' +
      markers + hits + xLabels +
      '</svg>'
    );
  }

  /* Which dates to print under the line, and where to anchor them so the first
     and last don't hang off the ends of the chart. Consecutive duplicates are
     dropped: a run of edits made in one sitting is several points on the same
     day, and printing "15 Sep" four times says less than printing it once. */
  function dateLabels(points, width) {
    const last = points.length - 1;
    const years = points.filter((point) => point.date).map((point) => point.date.getFullYear());
    const crossesYears = years.length > 1 && years[0] !== years[years.length - 1];
    const texts = points.map((point) => shortDate(point.date, crossesYears));

    // Every point on one day — which is exactly what a first session of data
    // entry produces. One centred label says it better than a repeated one.
    if (texts[0] === texts[last]) {
      return [{ index: last / 2, anchor: 'middle', text: fullDate(points[0].date) }];
    }

    const wanted = Math.max(2, Math.min(5, Math.floor(width / 120)));
    const chosen = [];
    for (let slot = 0; slot < wanted; slot += 1) {
      const index = Math.round((last * slot) / (wanted - 1));
      if (!chosen.includes(index)) chosen.push(index);
    }

    const out = [];
    chosen.forEach((index) => {
      const text = texts[index];
      if (out.length && out[out.length - 1].text === text) return;
      out.push({
        index,
        anchor: index === 0 ? 'start' : index === last ? 'end' : 'middle',
        text,
      });
    });
    return out;
  }

  function trendCaption() {
    return (
      '<p class="oh-chart-caption">One point per change you have recorded. Points are spaced evenly ' +
      'in the order the changes happened, not by how far apart in time they were — the dates under ' +
      'the line are where the elapsed time reads. Hover a point for its exact total.</p>'
    );
  }

  /* The head's right-hand figure answers the question the chart is on the page
     for — is this getting better or worse — in words rather than in a colour,
     which is both the accessible form and the only one this palette has: there
     is no green and no red in it, and inventing a pair for "up" and "down"
     would be a second scoped palette exception on the same screen. */
  function trendHead(points) {
    let note = '';
    if (points.length > 1) {
      const from = points[0];
      const delta = points[points.length - 1].total - from.total;
      const since = ' since ' + fullDate(from.date);
      note =
        delta > 0 ? 'Up ' + fmt(delta) + since
        : delta < 0 ? 'Down ' + fmt(-delta) + since
        : 'No change' + since;
    }
    return (
      '<div class="est-block-head"><h2 class="est-block-label">Overhead Trend</h2>' +
      '<span class="est-block-sum" style="color:var(--muted)">' + esc(note) + '</span></div>'
    );
  }

  /** The block, minus the drawing — drawTrend() fills #oh-trend-canvas once it
   *  is in the document and can be measured. */
  function trendMarkup(snapshots) {
    return (
      '<div class="est-block oh-chart-block" id="oh-trend-block">' +
      trendHead(toPoints(snapshots)) +
      '<div class="oh-chart" id="oh-trend-canvas"></div></div>'
    );
  }

  const toPoints = (snapshots) =>
    (snapshots || []).map((snapshot) => ({
      date: parseTs(snapshot.ts),
      total: Number(snapshot.totalAnnual) || 0,
    }));

  /**
   * Draws (or redraws) the trend chart into the block trendMarkup() left empty.
   *
   * The svg is built at the container's real pixel width, so one user unit is
   * one CSS pixel and an 11px axis label is 11px at every breakpoint. A single
   * fixed viewBox scaled by `width:100%` would render that same label at 15px
   * on a 1000px screen and under 4px at 375px, which is the usual way a
   * hand-rolled SVG chart becomes unreadable on a phone. The CSS keeps
   * `width:100%` as well, so a window dragged between redraws scales smoothly
   * rather than clipping.
   */
  /* The box the svg actually gets, which is not clientWidth: that includes the
     container's own padding, so drawing to it produced an svg 32px wider than
     its box, which `width:100%` then scaled back down — reintroducing the exact
     fractional scaling the measured width exists to avoid. Measured, not
     assumed: the first draft rendered 998 user units into 966 pixels. */
  function contentWidth(element) {
    const style = window.getComputedStyle(element);
    const inner =
      element.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    // A container with no layout at all (hidden tab, zero-width parent) has no
    // width to honour; 720 is a sane desktop default to draw at instead.
    if (!(inner > 0)) return 720;
    // Otherwise take the real width, however small — a floor here is not a
    // safety net, it is a chart drawn wider than its box and scaled back down,
    // which is the fractional scaling this function exists to prevent. At a
    // 375px viewport the box is 309px, and 320 rendered at 96.6%. The 220 is
    // only against a box narrower than the y-axis gutter needs.
    return Math.max(220, Math.round(inner));
  }

  function drawTrend(snapshots) {
    const canvas = document.getElementById('oh-trend-canvas');
    if (!canvas) return; // the screen moved on, or the donut task reordered the block
    const points = toPoints(snapshots);

    if (!points.length) {
      canvas.innerHTML =
        '<p class="oh-chart-empty">No history yet. Every expense you add, edit or delete records a ' +
        'point here, so this line starts as soon as you add your first expense.</p>';
      return;
    }
    // One point is a dot, not a trend. Saying that is more use than drawing an
    // axis around a single value, and it is the state the screen is in for the
    // whole of a first session.
    if (points.length === 1) {
      canvas.innerHTML =
        '<p class="oh-chart-empty">One change recorded so far, on ' + esc(fullDate(points[0].date)) +
        ' — ' + esc(fmt(points[0].total)) + ' a year. The line appears once there is a second point ' +
        'to draw it to.</p>';
      return;
    }

    canvas.innerHTML = trendSvg(points, contentWidth(canvas)) + trendCaption();
  }

  /* One listener for the life of the page. It re-queries the container every
     time rather than closing over it, so it survives the wholesale re-render
     overhead.js does on every write, and does nothing at all when the Overhead
     screen isn't the one on screen. It redraws whichever measured chart is
     showing: the trend on Operating Costs, the decline curve on Depreciation
     (both inner tabs mount through OverheadView, which is what binds this). */
  let resizeBound = false;
  let resizeTimer = null;
  function bindResize(currentSnapshots) {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (document.getElementById('oh-trend-canvas')) drawTrend(currentSnapshots());
        if (document.getElementById('dep-decline-canvas') && lastDecline) {
          drawDecline(lastDecline.asset, lastDecline.emptyMessage);
        }
      }, 150);
    });
  }


  // ── The category donut ────────────────────────────────────────────────────

  /* THIS ONE IS MARKUP ONLY — NO draw() PHASE, DELIBERATELY
     The trend chart is split into trendMarkup() + drawTrend() because it has to
     be measured: its axis labels are text inside the svg, so it is drawn at the
     container's real pixel width to keep an 11px label 11px. The donut has no
     text inside the ring except the total in its hole, and it is a fixed square
     at a fixed size — there is nothing to measure, so there is nothing to defer
     to a second phase. Splitting it anyway would add a draw() that can silently
     no-op when its canvas isn't there, to buy nothing. The legend beside it is
     ordinary HTML and wraps on its own, which is also why the donut is not in
     bindResize(): a resize changes where the legend sits, not what is drawn.

     SIZES ARE ANNUALISED, NOT AS-ENTERED
     A $1,500 monthly rent and a $1,800 annual hosting bill are $18,000 and
     $1,800 of the year. Slicing the ring by the `cost` column as typed would
     draw those two as nearly equal, which is the one wrong answer this chart
     can give. Every figure here runs through annualisedCost(), the same
     function the Monthly Equivalent column and the rate itself are built on. */

  const DONUT_SIZE = 200;
  const DONUT_OUTER = 92;
  const DONUT_INNER = 64;

  /* Annual cost per category, largest first, with a colour rank each.
     The tie-break is the category enum's own order rather than nothing: two
     categories on identical totals would otherwise swap places — and therefore
     swap colours — between two renders of the same data. */
  function byCategory(items, categories) {
    const order = new Map(categories.map((entry, index) => [entry.value, index]));
    const totals = new Map();
    (items || []).forEach((item) => {
      const key = item && item.category ? item.category : 'other';
      totals.set(key, (totals.get(key) || 0) + annualisedCost(item));
    });

    const groups = Array.from(totals, ([value, annual]) => ({
      value,
      label: labelOf(categories, value),
      annual: Math.round(annual * 100) / 100,
      rank: order.has(value) ? order.get(value) : categories.length,
    }));
    groups.sort((a, b) => b.annual - a.annual || a.rank - b.rank);

    const total = groups.reduce((sum, group) => sum + group.annual, 0);
    const shares = sharePercents(groups.map((group) => group.annual), total);
    groups.forEach((group, index) => {
      group.pct = shares[index];
      // 1-based so the class names read as ranks, and so .oh-c1 is always the
      // accent — the largest category, per the brief's scoped exception.
      group.colour = 'oh-c' + Math.min(index + 1, 6);
    });
    return { groups, total };
  }

  /* An unrecognised stored category is shown as itself rather than blanked,
     the same call overhead.js's table makes and for the same reason: it means
     the database holds a value this list doesn't know about, and hiding it
     makes it unfindable. */
  const labelOf = (categories, value) => {
    const found = (categories || []).find((entry) => entry.value === value);
    return found ? found.label : String(value || 'Uncategorised');
  };

  /* Percentages to one decimal place by largest remainder, so the legend adds
     up to exactly 100.0. Rounding each share on its own gives a column that
     sums to 99.9 or 100.1, which on the screen the rate card is computed from
     reads as an arithmetic error rather than as rounding. */
  function sharePercents(values, total) {
    if (!(total > 0)) return values.map(() => 0);
    const tenths = values.map((value) => (value / total) * 1000);
    const floors = tenths.map(Math.floor);
    let spare = 1000 - floors.reduce((sum, value) => sum + value, 0);
    tenths
      .map((value, index) => ({ index, fraction: value - floors[index] }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
      .forEach((entry) => {
        if (spare > 0) {
          floors[entry.index] += 1;
          spare -= 1;
        }
      });
    return floors.map((value) => value / 10);
  }

  const onArc = (radius, angle) => [
    DONUT_SIZE / 2 + radius * Math.cos(angle),
    DONUT_SIZE / 2 + radius * Math.sin(angle),
  ];

  /* An annular sector: out along the outer edge, in, back along the inner one.
     Angles run from -90° (twelve o'clock) and increase clockwise, because
     svg's y grows downwards. */
  function sectorPath(from, to) {
    const large = to - from > Math.PI ? 1 : 0;
    const [x0o, y0o] = onArc(DONUT_OUTER, from);
    const [x1o, y1o] = onArc(DONUT_OUTER, to);
    const [x1i, y1i] = onArc(DONUT_INNER, to);
    const [x0i, y0i] = onArc(DONUT_INNER, from);
    const n = (value) => value.toFixed(2);
    return (
      'M' + n(x0o) + ',' + n(y0o) +
      'A' + DONUT_OUTER + ',' + DONUT_OUTER + ' 0 ' + large + ' 1 ' + n(x1o) + ',' + n(y1o) +
      'L' + n(x1i) + ',' + n(y1i) +
      'A' + DONUT_INNER + ',' + DONUT_INNER + ' 0 ' + large + ' 0 ' + n(x0i) + ',' + n(y0i) + 'Z'
    );
  }

  const segTitle = (group) =>
    '<title>' + esc(group.label + ' — ' + fmt(group.annual) + ' a year, ' +
      group.pct.toFixed(1) + '% of overhead') + '</title>';

  /* One category owning everything is a closed ring, and a sector path can't
     draw one: a 360° arc starts and ends at the same point, which svg reads as
     a zero-length arc and paints nothing. A stroked circle is the ring, and it
     needs no separators because it has no neighbour to be separated from. */
  function wholeRing(group) {
    return (
      '<circle class="oh-ring ' + group.colour + '" cx="' + DONUT_SIZE / 2 + '" cy="' +
      DONUT_SIZE / 2 + '" r="' + (DONUT_OUTER + DONUT_INNER) / 2 + '" stroke-width="' +
      (DONUT_OUTER - DONUT_INNER) + '">' + segTitle(group) + '</circle>'
    );
  }

  /* The figure in the hole is sized to fit it rather than set once and hoped
     for. At 19px, "$24,000.00" measures 119.3px against a 128px hole — four
     pixels of air each side, and a seven-figure overhead ("$1,240,000.00", 13
     characters) would run out over the ring at the same size. Measured in the
     browser rather than guessed, and measured twice: the first reading came
     back 113.4px because the serif had not loaded yet, and Georgia is narrower
     than Delight. 119.3px over ten characters is 0.628em per character for
     these glyphs, which are only digits, commas, a dollar sign and a point.
     116 is the hole's 128 less six pixels of air a side. */
  const CENTRE_EM_PER_CHAR = 0.628;
  const centreSize = (text) =>
    Math.max(11, Math.min(19, Math.floor(116 / (text.length * CENTRE_EM_PER_CHAR))));

  function donutSvg(groups, total) {
    const drawable = groups.filter((group) => group.annual > 0);
    let angle = -Math.PI / 2;
    const segments =
      drawable.length === 1
        ? wholeRing(drawable[0])
        : drawable
            .map((group) => {
              const from = angle;
              angle += (group.annual / total) * Math.PI * 2;
              return (
                '<path class="oh-seg ' + group.colour + '" d="' + sectorPath(from, angle) + '">' +
                segTitle(group) + '</path>'
              );
            })
            .join('');

    /* The hole carries the annual total. The Summary Card at the top of the
       screen says the same number, but it is two blocks and a table away by
       the time this chart is on screen, and a share of an unstated total is
       only half a figure. */
    const money = fmt(total);
    const centre =
      '<text class="oh-donut-total" x="' + DONUT_SIZE / 2 + '" y="' + (DONUT_SIZE / 2 - 2) +
      '" text-anchor="middle" dominant-baseline="middle" font-size="' + centreSize(money) +
      '">' + esc(money) + '</text>' +
      '<text class="oh-donut-total-label" x="' + DONUT_SIZE / 2 + '" y="' + (DONUT_SIZE / 2 + 18) +
      '" text-anchor="middle" dominant-baseline="middle">A YEAR</text>';

    return (
      '<svg class="oh-donut-svg" viewBox="0 0 ' + DONUT_SIZE + ' ' + DONUT_SIZE + '" width="' +
      DONUT_SIZE + '" height="' + DONUT_SIZE + '" role="img" aria-label="' +
      esc('Category breakdown of ' + fmt(total) + ' of annual overhead. Every category and its ' +
        'share is listed beside the chart.') + '">' +
      segments + centre + '</svg>'
    );
  }

  /* The same figures as text, which is what makes the chart readable without
     relying on the colours at all — the scoped palette is an aid to reading the
     ring, never the only place a number lives. Not interactive: there is
     nothing for a click to do here, and a focusable row that does nothing is
     worse for a keyboard user than a plain list. */
  function legendMarkup(groups) {
    const rows = groups
      .map(
        (group) =>
          '<li class="oh-legend-row">' +
          '<span class="oh-swatch ' + group.colour + '" aria-hidden="true"></span>' +
          '<span class="oh-legend-name">' + esc(group.label) + '</span>' +
          '<span class="oh-legend-amt">' + esc(fmt(group.annual)) + '</span>' +
          '<span class="oh-legend-pct">' + group.pct.toFixed(1) + '%</span>' +
          '</li>'
      )
      .join('');
    return '<ul class="oh-legend">' + rows + '</ul>';
  }

  function donutEmpty(message) {
    return '<div class="oh-chart"><p class="oh-chart-empty">' + message + '</p></div>';
  }

  /**
   * The Category Breakdown block, complete — see the note above on why this one
   * has no separate draw phase.
   *
   * @param {Array} items — LSCData.overheadItems().
   * @param {Array<{value:string,label:string}>} categories — the enum, owned by
   *   overhead.js and passed in rather than copied: the database CHECK-constrains
   *   these spellings, and a second list here is a second thing to keep in step.
   */
  function donutMarkup(items, categories) {
    const { groups, total } = byCategory(items, categories);
    const head =
      '<div class="est-block-head"><h2 class="est-block-label">Category Breakdown</h2>' +
      '<span class="est-block-sum" style="color:var(--muted)">' +
      (groups.length ? groups.length + ' categor' + (groups.length === 1 ? 'y' : 'ies') : '') +
      '</span></div>';

    let body;
    if (!groups.length) {
      body = donutEmpty(
        'Nothing to break down yet. Once you have added an expense or two, this shows where ' +
        'the money actually goes — which is usually not where you would guess.'
      );
    } else if (!(total > 0)) {
      // Cost accepts a deliberate 0, so a table with rows and a zero total is a
      // real state rather than a bug. A ring of zero-width slices is not.
      body = donutEmpty(
        'Every expense is recorded at $0 a year, so there are no shares to draw. Give them their ' +
        'real costs and the breakdown appears here.'
      );
    } else {
      body =
        '<div class="oh-chart oh-donut-wrap">' +
        '<div class="oh-donut">' + donutSvg(groups, total) + '</div>' +
        legendMarkup(groups) +
        '<p class="oh-chart-caption oh-donut-caption">Shares of your annual overhead. Costs are ' +
        'annualised first, so a $1,500 monthly rent counts as $18,000 of the year and a $1,800 ' +
        'annual bill counts as $1,800. Hover a segment for its exact figure.</p>' +
        '</div>';
    }

    return '<div class="est-block oh-chart-block" id="oh-donut-block">' + head + body + '</div>';
  }


  // ── The decline curve (Overhead → Depreciation) ───────────────────────────

  /* One asset's adjustable value at the end of each financial year — the
     number the ATO's decline in value is taken from, drawn so "diminishing
     value front-loads the deduction" (the tab's info popover) can be seen
     rather than taken on trust.

     THE SAME ARITHMETIC AS THE SCHEDULE, NOT A SECOND COPY OF IT
     Every point is a closingAdjustableValue from LSCDepreciation's
     assetScheduleRows() — the walk the schedule, the CSV and the lodgement
     snapshots all use. Nothing here computes a decline; it only chooses how
     far to walk and draws what comes back.

     PAST, THIS YEAR, PROJECTED
     Unlike the trend's event-ordered axis, this one IS time: one slot per
     financial year, evenly spaced because financial years are. Years up to the
     current one are what the schedule reports. Years after it are what the
     chain gives if nothing changes — the asset kept, its business use as
     entered — so they are drawn hollow on a dashed line and the caption says
     "projected". The current FY is the one terracotta point (the brief's
     scoped palette exception, on the donut's terms); everything else is the
     ramp's warm grey. A disposed asset's line simply ends at its disposal
     year, because the chain stops walking there.

     WHICH ASSETS HAVE A CURVE
     Diminishing value and prime cost, with an effective life and a start date.
     An instant write-off is one step to $0 in its first year; a pooled asset
     has no value of its own — its cost joins the pool's balance. Neither is a
     curve, and drawing either would be an axis around nothing. The Depreciation
     view lists only what canChartDecline() accepts, so the picker and the
     chart can't disagree. */

  const CURVE_METHODS = { diminishing_value: 1, prime_cost: 1 };

  function canChartDecline(asset) {
    if (!asset || !CURVE_METHODS[asset.method]) return false;
    const life = LSCCalc.numOrNull(asset.effectiveLifeYears);
    return life !== null && life > 0 && LSCCalc.fyLabel(asset.startDate) !== null;
  }

  const fyOfStartYear = (year) => 'FY' + year + '-' + String((year + 1) % 100).padStart(2, '0');
  // "2025–26": the axis form. fyDisplay()'s "FY " prefix, five times along an
  // axis whose every label is a financial year, is noise.
  const fyShort = (label) => String(LSCCalc.fyDisplay(label) || '').replace(/^FY /, '');

  /* The points to draw, or [] when there is no curve. Walks to the end of the
     effective life (a prime-cost asset reaches $0 there; a diminishing-value
     one is at roughly an eighth of its cost — it never reaches zero, so the
     life is the natural place to stop), or to the current FY if the asset has
     outlived it. Past the first $0, further $0 years say nothing and are
     dropped — unless they are the current year or before it, which the
     schedule would report. */
  function declinePoints(asset, nowFy) {
    if (!canChartDecline(asset)) return [];
    const first = LSCCalc.fyBounds(LSCCalc.fyLabel(asset.startDate));
    const now = LSCCalc.fyBounds(nowFy);
    const life = LSCCalc.numOrNull(asset.effectiveLifeYears);
    const lastYear = Math.max(first.startYear + Math.ceil(life), now.startYear);
    const rows = LSCDepreciation.assetScheduleRows(asset, fyOfStartYear(lastYear));

    const points = [];
    for (const row of rows) {
      const year = LSCCalc.fyBounds(row.fy).startYear;
      const previous = points[points.length - 1];
      if (previous && previous.value === 0 && year > now.startYear) break;
      points.push({
        fy: row.fy,
        value: row.closingAdjustableValue,
        opening: row.openingAdjustableValue,
        when: year < now.startYear ? 'past' : year === now.startYear ? 'now' : 'projected',
        disposed: row.disposed,
      });
    }
    return points;
  }

  const pointNote = (point) =>
    point.disposed ? ' — disposed' : point.when === 'now' ? ' — this year' : point.when === 'projected' ? ' — projected' : '';

  /* THE STARTING POINT — the one point that isn't a financial year.
     The first FY's own closing value already has that year's decline taken
     out, and under diminishing value that is the biggest drop the asset will
     ever have (a $8,800 camera on a 3-year life closes its first year near
     $3,000). Starting the line at that closing value would hide exactly what
     the tab's info popover says this method does. So the line starts at the
     value the chain started from — the cost base, or the opening adjustable
     value entered for gear that was already part-depreciated — on the day it
     was first used, drawn as a smaller ring so it reads as an anchor rather
     than as another year. */
  function declineOrigin(asset, points) {
    const entered = LSCCalc.numOrNull(asset.openingAdjustableValue) !== null;
    return {
      value: points[0].opening,
      what: entered ? 'opening adjustable value' : 'cost base',
      date: asset.startDate,
    };
  }

  // "5 Jul 2026" — the trend chart's fullDate(), from a stored 'YYYY-MM-DD'.
  // Split rather than new Date(string), which reads a bare date as UTC.
  const dayDate = (ymd) => {
    const [y, m, d] = String(ymd || '').split('-').map(Number);
    return y && m && d ? fullDate(new Date(y, m - 1, d)) : 'its start date';
  };
  const originText = (origin) => 'First used ' + dayDate(origin.date) + ' — ' + fmt(origin.value) + ' ' + origin.what;

  function declineSummary(name, origin, points) {
    const last = points[points.length - 1];
    const now = points.find((point) => point.when === 'now');
    return (
      name + ': ' + fmt(origin.value) + ' ' + origin.what + ' when first used on ' + dayDate(origin.date) +
      (now && now !== last ? ', ' + fmt(now.value) + ' at the end of this financial year' : '') +
      ', ' + fmt(last.value) + ' by the end of ' + LSCCalc.fyDisplay(last.fy) +
      (last.disposed ? ', when it was disposed of' : last.when === 'projected' ? ', projected' : ' (this year)') + '.'
    );
  }

  /* Which slots to label. Slot 0 is the start ("START"); slots 1… are FYs.
     Every one when they fit (a 64px slot holds "2025–26"), otherwise an even
     spread that always keeps the start, the last year and this year — the one
     the terracotta point needs named. */
  function slotLabelIndexes(slots, plotWidth, nowSlot) {
    const last = slots - 1;
    const step = plotWidth / last;
    const fit = Math.max(2, Math.floor(plotWidth / 64) + 1);
    if (slots <= fit) return Array.from({ length: slots }, (unused, index) => index);
    const keep = new Set([0, last]);
    for (let n = 1; n < fit - 1; n += 1) keep.add(Math.round((last * n) / (fit - 1)));
    if (nowSlot >= 0) {
      Array.from(keep).forEach((index) => {
        if (index !== 0 && index !== last && Math.abs(index - nowSlot) * step < 64) keep.delete(index);
      });
      keep.add(nowSlot);
    }
    return Array.from(keep).sort((a, b) => a - b);
  }

  function declineSvg(name, origin, points, width) {
    const height = width < 520 ? 200 : 240;
    // Slot 0 is the origin, so every series index below is one ahead of `points`.
    const series = [{ value: origin.value, when: 'origin' }].concat(points);
    const axis = yAxis(Math.max(...series.map((point) => point.value)));
    const labels = axis.ticks.map(axisMoney);
    const padLeft = 20 + labels.reduce((max, label) => Math.max(max, label.length), 0) * 6.2;
    // In from both edges by half an FY label, so the first and last centre on
    // their points without running into the tick column or off the svg.
    const plotLeft = padLeft + 26;
    const plotRight = width - 30;
    const plotTop = 18;
    const plotBottom = height - 34;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    const xAt = (index) => plotLeft + (plotWidth * index) / (series.length - 1);
    const yAt = (value) => plotBottom - (plotHeight * value) / axis.top;
    const xy = (index) => xAt(index).toFixed(1) + ',' + yAt(series[index].value).toFixed(1);

    const gridlines = axis.ticks
      .map((value) => {
        const y = yAt(value).toFixed(1);
        return (
          '<line class="oh-chart-grid" x1="' + padLeft.toFixed(1) + '" y1="' + y + '" x2="' + plotRight.toFixed(1) +
          '" y2="' + y + '"/>' +
          '<text class="oh-chart-tick" x="' + (padLeft - 9).toFixed(1) + '" y="' + y +
          '" text-anchor="end" dominant-baseline="middle">' + esc(axisMoney(value)) + '</text>'
        );
      })
      .join('');

    /* Solid from the start through the last reported year, dashed from there
       on. They share that point, so the line is unbroken. When nothing is
       reported yet (first used later this FY… or next), it is dashed from the
       start. */
    let lastReported = 0;
    series.forEach((point, index) => {
      if (point.when === 'past' || point.when === 'now') lastReported = index;
    });
    const indexes = series.map((point, index) => index);
    const solid = indexes.slice(0, lastReported + 1);
    const dashed = indexes.slice(lastReported);
    const polyline = (run, extra) =>
      run.length > 1 ? '<polyline class="dep-decline-line' + extra + '" points="' + run.map(xy).join(' ') + '"/>' : '';

    const area =
      'M' + xAt(0).toFixed(1) + ',' + plotBottom.toFixed(1) + 'L' + indexes.map(xy).join('L') +
      'L' + xAt(series.length - 1).toFixed(1) + ',' + plotBottom.toFixed(1) + 'Z';

    const nowSlot = series.findIndex((point) => point.when === 'now');
    const guide = nowSlot >= 0
      ? '<line class="dep-decline-guide" x1="' + xAt(nowSlot).toFixed(1) + '" y1="' + plotTop.toFixed(1) +
        '" x2="' + xAt(nowSlot).toFixed(1) + '" y2="' + plotBottom.toFixed(1) + '"/>'
      : '';

    const dots = series
      .map((point, index) => {
        const kind = { origin: ' is-origin', now: ' is-now', projected: ' is-projected' }[point.when] || '';
        const r = point.when === 'now' ? 5.5 : point.when === 'origin' ? 3 : 3.5;
        return (
          '<circle class="dep-decline-dot' + kind + '" cx="' + xAt(index).toFixed(1) + '" cy="' +
          yAt(point.value).toFixed(1) + '" r="' + r + '"/>'
        );
      })
      .join('');

    // Same reasoning as the trend's hit targets: transparent, not "none", and
    // no wider than half a slot so neighbours don't steal each other's hover.
    const hitRadius = Math.max(6, Math.min(14, plotWidth / (series.length - 1) / 2));
    const titleOf = (point) =>
      point.when === 'origin' ? originText(origin) : LSCCalc.fyDisplay(point.fy) + ' — ' + fmt(point.value) + pointNote(point);
    const hits = series
      .map(
        (point, index) =>
          '<circle class="oh-chart-hit" cx="' + xAt(index).toFixed(1) + '" cy="' + yAt(point.value).toFixed(1) +
          '" r="' + hitRadius.toFixed(1) + '" fill="transparent"><title>' + esc(titleOf(point)) + '</title></circle>'
      )
      .join('');

    const slotLabels = slotLabelIndexes(series.length, plotWidth, nowSlot)
      .map(
        (index) =>
          '<text class="oh-chart-date' + (index === nowSlot ? ' dep-decline-fy-now' : '') + '" x="' +
          xAt(index).toFixed(1) + '" y="' + (plotBottom + 21).toFixed(1) + '" text-anchor="middle">' +
          esc(index === 0 ? 'Start' : fyShort(series[index].fy)) + '</text>'
      )
      .join('');

    return (
      '<svg class="oh-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' +
      height + '" role="img" aria-label="' + esc(declineSummary(name, origin, points)) + '">' +
      gridlines + '<path class="dep-decline-area" d="' + area + '"/>' + guide +
      polyline(solid, '') + polyline(dashed, ' is-projected') + dots + hits + slotLabels +
      '</svg>'
    );
  }

  /* Every point as a table, for a screen reader — the <title>s are hover-only,
     and the svg's label only gives the start, this year and the last value. */
  function declineTable(name, origin, points) {
    const row = (head, value) => '<tr><th scope="row">' + esc(head) + '</th><td>' + esc(value) + '</td></tr>';
    return (
      '<table class="sr-only"><caption>' + esc(name) + ': adjustable value at the end of each financial year' +
      '</caption><thead><tr><th scope="col">When</th><th scope="col">Adjustable value</th></tr></thead><tbody>' +
      row('First used ' + dayDate(origin.date) + ' (' + origin.what + ')', fmt(origin.value)) +
      points.map((point) => row(LSCCalc.fyDisplay(point.fy) + pointNote(point), fmt(point.value))).join('') +
      '</tbody></table>'
    );
  }

  function declineCaption(origin, points) {
    const last = points[points.length - 1];
    const hasNow = points.some((point) => point.when === 'now');
    const hasProjected = points.some((point) => point.when === 'projected');
    return (
      '<p class="oh-chart-caption">What it’s worth for tax: its ' + origin.what + ' when first used, then one point ' +
      'per financial year at 30 June. The drop to each point is that year’s decline in value; your deduction is ' +
      'that drop at your business-use share. ' +
      (hasNow ? 'The terracotta point is this financial year. ' : '') +
      (hasProjected ? 'Hollow points are projected — they assume you keep it and nothing about it changes. ' : '') +
      (last.disposed ? 'The line ends at ' + esc(LSCCalc.fyDisplay(last.fy)) + ', when it was disposed of. ' : '') +
      'Hover a point for its exact value.</p>'
    );
  }

  /* What the resize listener redraws. Data, not an element — see the header's
     "nothing held": the container is still re-queried on every draw. */
  let lastDecline = null;

  /** Draws (or redraws) one asset's curve into #dep-decline-canvas, measured
   *  like the trend. `asset` null means there is nothing to chart, and
   *  `emptyMessage` — the view's, which knows why — is shown instead. */
  function drawDecline(asset, emptyMessage) {
    lastDecline = { asset, emptyMessage };
    const canvas = document.getElementById('dep-decline-canvas');
    if (!canvas) return;
    const points = asset ? declinePoints(asset, LSCCalc.currentFinancialYear()) : [];
    if (!points.length) {
      canvas.innerHTML = '<p class="oh-chart-empty">' + esc(emptyMessage || 'Nothing to draw yet.') + '</p>';
      return;
    }
    const name = asset.name || 'This asset';
    const origin = declineOrigin(asset, points);
    canvas.innerHTML =
      declineSvg(name, origin, points, contentWidth(canvas)) + declineTable(name, origin, points) +
      declineCaption(origin, points);
  }

  /* The sentence the view announces when the picker changes the chart. */
  function declineAnnouncement(asset) {
    const points = asset ? declinePoints(asset, LSCCalc.currentFinancialYear()) : [];
    return points.length ? declineSummary(asset.name || 'This asset', declineOrigin(asset, points), points) : '';
  }

  return {
    trendMarkup,
    drawTrend,
    donutMarkup,
    bindResize,
    canChartDecline,
    drawDecline,
    declineAnnouncement,
  };
})();
