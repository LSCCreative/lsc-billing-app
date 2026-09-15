'use strict';

/* The charts on the Overhead screen. Hand-rolled inline SVG, no library —
 * this directory ships to GitHub Pages as-is and has no build step, so a chart
 * dependency would be the first one in the app.
 *
 * WHY THIS IS ITS OWN FILE
 * overhead.js is the CRUD screen: a table, a modal, four write paths. The
 * charts are pure presentation over the same cache and share none of that
 * state, so they sit beside it rather than inside it. The Category Breakdown
 * donut is the next task and belongs in here too.
 *
 * MARKUP IN, MARKUP OUT — NOTHING HELD
 * OverheadView.render() rewrites root.innerHTML wholesale on every write, so
 * anything built here is torn down and rebuilt with it. Nothing in this module
 * keeps an element reference across a render; drawTrend() re-queries the
 * container every time it runs, including on window resize.
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
      '<div class="est-block-head"><span class="est-block-label">Overhead Trend</span>' +
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
     screen isn't the one on screen. */
  let resizeBound = false;
  let resizeTimer = null;
  function bindResize(currentSnapshots) {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (document.getElementById('oh-trend-canvas')) drawTrend(currentSnapshots());
      }, 150);
    });
  }

  return { trendMarkup, drawTrend, bindResize };
})();
