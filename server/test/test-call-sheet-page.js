'use strict';

/**
 * The call sheet's markup (trip-planner task 10): one pure function drawn by
 * the app, the crew's page and the PDF. These tests hold the function itself:
 * that the browser's copy is the server's, that it runs with no DOM, that it
 * escapes everything and trusts no link or image it wasn't built to, and that
 * it says what the schedule needs said. The routes and the PDF are in
 * test-call-sheet.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { markup, title, updatedText, durationText, kmText, clock12, dayTitle } = require('../src/call-sheet');
const { buildCallSheetHtml, callSheetFilename } = require('../src/pdf');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* What public.js callSheetView hands over, for a two-day trip. */
function view(extra) {
  const stops = [
    { role: 'start', n: null, mapLabel: 'S', address: '1 Home St, Marrickville NSW', lat: -33.91, lng: 151.15, mapsUrl: 'https://www.google.com/maps/search/?api=1&query=1%20Home%20St', arriveAt: null, leaveAt: '07:00' },
    {
      role: 'stop', n: 1, mapLabel: '1', address: 'Bondi Pavilion, Queen Elizabeth Dr, Bondi Beach NSW', lat: -33.89, lng: 151.27,
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Bondi%20Pavilion&query_place_id=p_s1', arriveAt: '07:31', leaveAt: '09:01',
      minutesOnSite: 90, details: { capture: 'Wide of the pool,\nthen the sunrise', description: 'Car park level 2' },
    },
    {
      role: 'stop', n: 2, mapLabel: '2', address: 'Eveleigh Works, 243 Edward St, Eveleigh NSW', lat: -33.89, lng: 151.19,
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Eveleigh', arriveAt: '09:25', leaveAt: '09:55',
      minutesOnSite: 30, details: { access: 'Gate code 4417' },
    },
    { role: 'return', n: null, mapLabel: 'S', address: '1 Home St, Marrickville NSW', lat: -33.91, lng: 151.15, mapsUrl: 'https://www.google.com/maps/search/?api=1&query=1%20Home%20St', arriveAt: '10:12', leaveAt: null },
  ];
  const legs = [
    { km: 14.2, minutes: 31, departAt: '07:00', arriveAt: '07:31' },
    { km: 9.8, minutes: 24, departAt: '09:01', arriveAt: '09:25' },
    { km: 6.1, minutes: 17, departAt: '09:55', arriveAt: '10:12' },
  ];
  const day = (date, map) => ({ date, startTime: '07:00', routed: true, totals: { km: 30.1, minutes: 72 }, legs, stops, map });
  return {
    kind: 'call-sheet',
    upid: 'ABC-123',
    name: 'Harbour shoot',
    client: { businessName: 'Saltwater Co.' },
    business: { name: 'LSC Creative', email: 'hello@lsc.example', phone: '0412 000 000' },
    updatedAt: '2026-10-08T04:41:00.000Z',
    summary: { days: 2, km: 60 },
    days: [day('2026-11-03', PNG), day(null, null)],
    ...(extra || {}),
  };
}

test('web/js/call-sheet.js is a byte-identical copy of the server file', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'src', 'call-sheet.js'));
  const web = fs.readFileSync(path.join(ROOT, 'web', 'js', 'call-sheet.js'));
  assert.ok(
    server.equals(web),
    'server/src/call-sheet.js and web/js/call-sheet.js have drifted. Re-copy the server file over the web ' +
    'one: cp server/src/call-sheet.js web/js/call-sheet.js',
  );
});

test('the browser copy loads as a plain script with no DOM, beside names it must not disturb', () => {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext('const MONTHS = 1; const esc = 2; const dayTitle = 3;', ctx);
  vm.runInContext(read('web', 'js', 'call-sheet.js'), ctx);
  assert.equal(typeof sandbox.LSCCallSheet.markup, 'function');
  // The same document either way.
  assert.equal(sandbox.LSCCallSheet.markup(view()), markup(view()));
});

test('the pages load it: the app before the screen that draws it, the crew\'s page before c.js', () => {
  const app = read('web', 'index.html');
  assert.ok(app.indexOf('js/call-sheet.js') > 0, 'index.html loads call-sheet.js');
  assert.ok(app.indexOf('js/call-sheet.js') < app.indexOf('views/call-sheet-page.js'));
  assert.ok(app.indexOf('css/call-sheet.css') > 0, 'index.html loads call-sheet.css');
  const c = read('web', 'c', 'index.html');
  assert.ok(c.indexOf('src="../js/call-sheet.js"') > 0, 'c/index.html loads ../js/call-sheet.js');
  assert.ok(c.indexOf('../js/call-sheet.js') < c.indexOf('src="c.js"'));
  assert.ok(c.indexOf('href="../css/call-sheet.css"') > 0, 'c/index.html loads ../css/call-sheet.css');
});

test('the document: who it is for, how long it covers, when it was last saved (Sydney time), and a section a day', () => {
  const html = markup(view());
  assert.match(html, /<h1 class="cs-title" id="cs-title">Harbour shoot<\/h1>/);
  assert.match(html, /<dt>For<\/dt><dd>Saltwater Co\.<\/dd>/);
  assert.match(html, /<dt>Reference<\/dt><dd>ABC-123<\/dd>/);
  assert.match(html, /<dt>Covers<\/dt><dd>2 days · 60 km<\/dd>/);
  // 04:41 UTC on 8 Oct is 3:41 pm in Sydney (AEDT, UTC+11).
  assert.match(html, /<time datetime="2026-10-08T04:41:00\.000Z">8 Oct 2026, 3:41 pm<\/time>/);
  assert.equal((html.match(/class="cs-day"/g) || []).length, 2);
  assert.match(html, /<h2 class="cs-day-title" id="cs-day-1">Tuesday 3 November 2026<\/h2>/);
  assert.match(html, /<h2 class="cs-day-title" id="cs-day-2">Date to be confirmed<\/h2>/);
  assert.match(html, /Starts 7:00am/);
  assert.match(html, /30 km/);
  assert.match(html, /1 h 12 min driving/);
});

test('the schedule: the leg into each stop, arrive and leave times, time on location, the details in full', () => {
  const html = markup(view());
  const first = html.slice(html.indexOf('cs-day"'), html.indexOf('id="cs-day-2"'));
  assert.equal((first.match(/class="cs-stop /g) || []).length, 4, 'start, two stops, return');
  assert.deepEqual([...first.matchAll(/Drive ([^<]+)</g)].map((m) => m[1]), ['14 km · 31 min', '10 km · 24 min', '6 km · 17 min']);
  assert.match(first, /<span class="cs-time-label">Depart<\/span> <time class="cs-clock" datetime="07:00">7:00am<\/time>/);
  assert.match(first, /<span class="cs-time-label">Arrive<\/span> <time class="cs-clock" datetime="07:31">7:31am<\/time><\/span><span class="cs-time"><span class="cs-time-label">Leave<\/span> <time class="cs-clock" datetime="09:01">9:01am<\/time>/);
  assert.match(first, /1 h 30 min on location/);
  assert.match(first, /30 min on location/);
  assert.match(first, /<dt>Capture details<\/dt><dd>Wide of the pool,\nthen the sunrise<\/dd>/);
  assert.match(first, /<dt>Location description<\/dt><dd>Car park level 2<\/dd>/);
  assert.match(first, /<dt>Access details<\/dt><dd>Gate code 4417<\/dd>/);
  assert.match(first, /<p class="cs-role">Return<\/p>/);
  // The return closes the day: arrival only.
  const ret = first.slice(first.indexOf('cs-stop-return'));
  assert.match(ret, /Arrive<\/span> <time class="cs-clock" datetime="10:12">10:12am/);
  assert.doesNotMatch(ret, /Leave|Depart/);
  // A link per stop, to Google, in a new tab, with the stop named for a screen reader.
  assert.equal((first.match(/href="https:\/\/www\.google\.com\/maps\//g) || []).length, 4);
  assert.match(first, /target="_blank" rel="noopener noreferrer">Open in Google Maps<span class="cs-vh">, stop 1\. Opens in a new tab\.<\/span>/);
});

test('a day with no start time, or whose route is out of step, has stops and no times', () => {
  const v = view();
  const bare = { ...v.days[0], startTime: null, routed: false, legs: [], totals: { km: 0, minutes: 0 },
    stops: v.days[0].stops.map((s) => ({ ...s, arriveAt: null, leaveAt: null })) };
  const html = markup({ ...v, days: [bare] });
  assert.doesNotMatch(html, /cs-time"|cs-clock|Drive |Starts|driving/);
  assert.match(html, /2 stops/);
  assert.match(html, /Eveleigh Works/);
});

test('destinations past the ninth are lettered as the map pins are, and the schedule says so', () => {
  const v = view();
  v.days[0].stops[2] = { ...v.days[0].stops[2], n: 10, mapLabel: 'A' };
  const html = markup(v);
  assert.match(html, /<span class="cs-pin" aria-hidden="true">A<\/span>[\s\S]*?Stop 10<span class="cs-role-pin"> · map pin A<\/span>/);
});

test('every string is escaped, whatever the crew\'s notes or a client\'s name hold', () => {
  const v = view({ name: '<img src=x onerror=alert(1)> & "Co"', client: { businessName: '</h1><script>1</script>' } });
  v.days[0].stops[1] = { ...v.days[0].stops[1], address: '<b>Gate</b> & "Back" Rd', details: { access: '<script>steal()</script>\n&amp;' } };
  const html = markup(v);
  assert.doesNotMatch(html, /<script|<img src=x|<b>Gate|onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;Co&quot;/);
  assert.match(html, /&lt;script&gt;steal\(\)&lt;\/script&gt;\n&amp;amp;/);
});

test('a link that isn\'t Google Maps, and an image that isn\'t a PNG data URI, are left out rather than drawn', () => {
  const v = view();
  v.days[0].stops[1] = { ...v.days[0].stops[1], mapsUrl: 'javascript:alert(1)' };
  v.days[0].stops[2] = { ...v.days[0].stops[2], mapsUrl: 'https://evil.example/maps/x' };
  v.days[0].map = 'https://tracker.example/pixel.png';
  v.days[1].map = 'data:text/html;base64,PHNjcmlwdD4=';
  const html = markup(v);
  assert.doesNotMatch(html, /javascript:|evil\.example|tracker\.example|data:text/);
  assert.doesNotMatch(html, /<img/);
  // The stops are still all listed.
  assert.match(html, /Bondi Pavilion/);
  assert.match(html, /Eveleigh Works/);
});

test('the route image sits above the schedule with a description, and a day without one just has the schedule', () => {
  const html = markup(view());
  const first = html.slice(html.indexOf('cs-day"'), html.indexOf('id="cs-day-2"'));
  assert.ok(first.indexOf('<figure class="cs-map">') < first.indexOf('<ol class="cs-stops">'));
  assert.match(first, /<img src="data:image\/png;base64,[^"]+" width="1280" height="720" alt="Route for Tuesday 3 November 2026, with each stop pinned as numbered below\.">/);
  const second = html.slice(html.indexOf('id="cs-day-2"'));
  assert.doesNotMatch(second.slice(0, second.indexOf('cs-foot')), /<img|<figure/);
});

test('no trips: one line saying so, and the footer still there', () => {
  const html = markup(view({ days: [], summary: { days: 0, km: 0 } }));
  assert.match(html, /There are no trips on this call sheet yet\./);
  assert.doesNotMatch(html, /Covers/);
  assert.match(html, /cs-foot/);
  assert.doesNotThrow(() => markup(null));
  assert.doesNotThrow(() => markup({}));
});

test('the footer: the business\'s name, email and phone, as links, and only what is set', () => {
  const html = markup(view());
  assert.match(html, /<footer class="cs-foot">/);
  assert.match(html, /<p class="cs-foot-name">LSC Creative<\/p>/);
  assert.match(html, /href="mailto:hello@lsc\.example"/);
  assert.match(html, /href="tel:0412000000">0412 000 000</);
  const none = markup(view({ business: { name: '', email: '', phone: '' } }));
  assert.doesNotMatch(none, /cs-foot/);
  const nameOnly = markup(view({ business: { name: 'LSC Creative', email: '', phone: '' } }));
  assert.doesNotMatch(nameOnly, /mailto|tel:/);
});

test('the title and the helpers', () => {
  assert.equal(title(view()), 'Call sheet · ABC-123 · Harbour shoot');
  assert.equal(title({ name: 'Harbour shoot' }), 'Call sheet · Harbour shoot');
  assert.equal(title(null), 'Call sheet');
  assert.deepEqual([0, 12, 48, 60, 72, 120, 125].map(durationText), ['0 min', '12 min', '48 min', '1 h', '1 h 12 min', '2 h', '2 h 5 min']);
  assert.deepEqual([0, 0.2, 14.2, 14.5, 186.4].map(kmText), ['0 km', '1 km', '14 km', '15 km', '186 km']);
  assert.deepEqual(['07:00', '13:05', '00:30', '12:00', null, 'x'].map(clock12), ['7:00am', '1:05pm', '12:30am', '12:00pm', '', '']);
  assert.equal(dayTitle('2026-12-25'), 'Friday 25 December 2026');
  assert.equal(dayTitle(null), 'Date to be confirmed');
  // The business's clock: a summer and a winter time, and nothing for junk.
  assert.equal(updatedText('2026-01-15T23:30:00.000Z'), '16 Jan 2026, 10:30 am');
  assert.equal(updatedText('2026-07-15T23:30:00.000Z'), '16 Jul 2026, 9:30 am');
  assert.equal(updatedText('not a date'), '');
  assert.equal(updatedText(''), '');
});

test('the PDF wraps that same markup: a letterhead, a page a day, the project\'s name for the file', () => {
  const v = view();
  const html = buildCallSheetHtml(v);
  assert.ok(html.includes(markup(v)), 'the PDF carries the page\'s own document');
  assert.match(html, /^<!DOCTYPE html><html lang="en-AU"><head><meta charset="UTF-8"><title>Call sheet · ABC-123 · Harbour shoot<\/title>/);
  assert.match(html, /LSC CREATIVE[\s\S]*CALL SHEET <span[^>]*>ABC-123<\/span>/);
  assert.match(html, /\.cs-day\+\.cs-day\{break-before:page/);
  assert.match(html, /\.cs-stop\{break-inside:avoid\}/);
  assert.equal(callSheetFilename(v), 'Call sheet - ABC-123 - Harbour shoot.pdf');
  assert.equal(callSheetFilename({ upid: 'A/B', name: 'Q: "x" <y>' }), 'Call sheet - A-B - Q- -x- -y-.pdf');
  assert.equal(callSheetFilename(null), 'Call sheet.pdf');
  // A letterhead for a blank sheet is still a document, not an exception.
  assert.doesNotThrow(() => buildCallSheetHtml(null));
});
