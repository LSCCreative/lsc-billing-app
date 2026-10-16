'use strict';

/* The multi-year accountant CSV (own-kit K7, K-D11). Its own database, not
   test-api.js's shared one, because what a lodged year exports depends on
   exactly which years are locked and what changed after. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-depcsv-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-0123456789';
process.env.COOKIE_SECURE = '0';
process.env.NODE_ENV = 'test';

const { openDatabase, nowIso } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { currentFinancialYear, fyBounds } = require('../src/calc');

const PASSWORD = 'correct-horse-battery-staple';
let server;
let baseUrl;
let db;
let cookie;

test.before(async () => {
  db = openDatabase(path.join(TMP, 'billing.db'));
  db.prepare(`
    INSERT INTO account (id, username, password_hash, created_at, updated_at)
    VALUES (1, 'lachlan', ?, ?, ?)
  `).run(await hashPassword(PASSWORD), nowIso(), nowIso());
  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'lachlan', password: PASSWORD }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
});

test.after(() => {
  if (server) server.close();
  if (db) db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function api(pathname, opts = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...opts,
    headers: { 'content-type': 'application/json', cookie, ...(opts.headers || {}) },
  });
}

const json = (pathname, opts) => api(pathname, opts).then((r) => r.json());

function asset(overrides = {}) {
  return {
    name: 'Camera Body',
    category: 'camera',
    purchaseDate: '2024-07-01',
    startDate: '2024-07-01',
    costIncGst: 1100,
    gstAmount: 100,
    gstCreditClaimed: true,
    method: 'prime_cost',
    effectiveLifeYears: 5,
    businessUsePct: 100,
    ...overrides,
  };
}

const create = (overrides) =>
  json('/api/depreciation-assets', { method: 'POST', body: JSON.stringify(asset(overrides)) }).then((r) => r.asset);
const update = (id, overrides) =>
  json(`/api/depreciation-assets/${id}`, { method: 'PUT', body: JSON.stringify(asset(overrides)) });

/* RFC 4180 enough for these files: quoted fields, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\r') { /* CRLF */ } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* The CSV as objects keyed by heading, BOM checked and removed. */
async function csvTable(pathname) {
  const res = await api(pathname);
  assert.equal(res.status, 200, pathname);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 with a BOM');
  const [header, ...rows] = parseCsv(bytes.subarray(3).toString('utf8'));
  return {
    res,
    header,
    rows: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))),
  };
}

const ids = {};

test('fixtures: a full year, a part year, a part-personal asset, a disposal, a pool and a deleted asset', async () => {
  ids.full = (await create({ name: 'Full Year Camera' })).id;
  ids.part = (await create({
    name: 'Part Year Lens', purchaseDate: '2024-10-01', startDate: '2024-10-15',
    costIncGst: 2200, gstAmount: 200, gstCreditClaimed: false, method: 'diminishing_value', effectiveLifeYears: 4,
  })).id;
  ids.shared = (await create({
    name: 'Shared Laptop', category: 'computer', costIncGst: 3300, gstAmount: 300,
    effectiveLifeYears: 3, businessUsePct: 60,
  })).id;
  ids.sold = (await create({ name: 'Sold Drone', disposalDate: '2026-03-12', disposalProceeds: 800 })).id;
  ids.pooled = (await create({ name: 'Pooled Tripod', startDate: '2024-08-01', purchaseDate: '2024-08-01', method: 'small_business_pool', effectiveLifeYears: null })).id;
  ids.gone = (await create({ name: 'Deleted Monitor', costIncGst: 550, gstAmount: 50 })).id;
  for (const id of Object.values(ids)) assert.ok(id);

  // Lodge FY2024-25, then change three things it covered: the camera's life
  // (moves its figures), the laptop's business use (moves its claim and the
  // input the lodged row carries) and the monitor (deleted).
  const lock = await api('/api/depreciation-locks', { method: 'POST', body: JSON.stringify({ fy: 'FY2024-25' }) });
  assert.equal(lock.status, 201);
  await update(ids.full, { name: 'Full Year Camera', effectiveLifeYears: 10 });
  await update(ids.shared, {
    name: 'Shared Laptop', category: 'computer', costIncGst: 3300, gstAmount: 300,
    effectiveLifeYears: 3, businessUsePct: 50,
  });
  assert.equal((await api(`/api/depreciation-assets/${ids.gone}`, { method: 'DELETE' })).status, 200);
});

test('multi-year CSV: headings, file name, and each FY lodged or live', async () => {
  const { res, header } = await csvTable('/api/depreciation-schedule-multi.csv?from=FY2024-25&to=FY2025-26');
  assert.match(res.headers.get('content-type') || '', /^text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition') || '', /depreciation-schedule-FY2024-25-to-FY2025-26\.csv/);
  assert.deepEqual(header, [
    'Asset Description', 'Date Purchased', 'Purchase Price (AUD)', 'Business Use %',
    'Taxable Cost Base', 'Depreciation Method', 'Effective Life (Yrs)',
    'FY2024-25 Opening Value (lodged)', 'FY2024-25 Claim (lodged)', 'FY2024-25 Closing Value (lodged)',
    'FY2025-26 Opening Value', 'FY2025-26 Claim', 'FY2025-26 Closing Value',
    'Disposal Date', 'Disposal Proceeds', 'Balancing Adjustment', 'Notes',
  ]);
});

test('multi-year CSV: every FY reconciles with that year’s single-FY export, row by row and in total', async () => {
  const multi = await csvTable('/api/depreciation-schedule-multi.csv?from=FY2024-25&to=FY2025-26');
  const byName = new Map(multi.rows.map((r) => [r['Asset Description'], r]));

  for (const fy of ['FY2024-25', 'FY2025-26']) {
    const tag = fy === 'FY2024-25' ? ' (lodged)' : '';
    const single = await csvTable(`/api/depreciation-schedule.csv?fy=${fy}`);
    assert.ok(single.rows.length >= 4, `${fy} has rows to compare`);
    const inSingle = new Set();
    let claims = 0;
    for (const s of single.rows) {
      inSingle.add(s.Name);
      const m = byName.get(s.Name);
      assert.ok(m, `${s.Name} is in the multi-year file`);
      assert.equal(m[`${fy} Opening Value${tag}`], s['Opening Adjustable Value'], `${s.Name} ${fy} opening`);
      assert.equal(m[`${fy} Claim${tag}`], s.Deductible, `${s.Name} ${fy} claim`);
      assert.equal(m[`${fy} Closing Value${tag}`], s['Closing Adjustable Value'], `${s.Name} ${fy} closing`);
      claims += Number(s.Deductible);
    }
    // A row the single-FY file doesn't have is blank for that year.
    for (const m of multi.rows) {
      if (m['Asset Description'] === 'Total' || inSingle.has(m['Asset Description'])) continue;
      assert.equal(m[`${fy} Claim${tag}`], '', `${m['Asset Description']} has nothing in ${fy}`);
    }
    // The totals row is the year's total deductible, as lodged or as live.
    const reply = await json(`/api/depreciation-schedule?fy=${fy}`);
    const total = reply.locked ? reply.lockedFigures.totalDeductible : reply.schedule.totalDeductible;
    assert.equal(byName.get('Total')[`${fy} Claim${tag}`], total.toFixed(2));
    assert.equal(Math.round(claims * 100), Math.round(total * 100));
  }
});

test('multi-year CSV: a lodged year is frozen, the next is live', async () => {
  const { rows } = await csvTable('/api/depreciation-schedule-multi.csv?from=FY2024-25&to=FY2025-26');
  const camera = rows.find((r) => r['Asset Description'] === 'Full Year Camera');
  // Lodged at life 5: 1000 → 800, claim 200. Live at life 10: FY2025-26
  // opens at 900 (life 10 retroactively), claims 100, closes at 800.
  assert.deepEqual(
    [camera['FY2024-25 Opening Value (lodged)'], camera['FY2024-25 Claim (lodged)'], camera['FY2024-25 Closing Value (lodged)']],
    ['1000.00', '200.00', '800.00']
  );
  assert.deepEqual(
    [camera['FY2025-26 Opening Value'], camera['FY2025-26 Claim'], camera['FY2025-26 Closing Value']],
    ['900.00', '100.00', '800.00']
  );
  assert.equal(camera['Effective Life (Yrs)'], '10');
  assert.equal(camera['Depreciation Method'], 'Prime cost');

  // Deleted after lodging: still listed, from the snapshot, for its year only.
  const monitor = rows.find((r) => r['Asset Description'] === 'Deleted Monitor');
  assert.ok(monitor, 'a deleted asset that was lodged keeps its row');
  assert.equal(monitor['FY2024-25 Claim (lodged)'], '100.00');
  assert.equal(monitor['FY2025-26 Claim'], '');
  assert.equal(monitor['Date Purchased'], '');
  assert.match(monitor.Notes, /No longer in the register: figures are as lodged\./);
});

test('multi-year CSV: part-personal, part-year and disposal rows', async () => {
  const { rows } = await csvTable('/api/depreciation-schedule-multi.csv?from=FY2024-25&to=FY2025-26');
  const row = (name) => rows.find((r) => r['Asset Description'] === name);

  // Part-personal: cost base 3000 × 50% today = 1500. Lodged at 60%: claim
  // 1000 × 60% = 600. Live FY2025-26 at 50%: 500, and the adjustable value
  // falls by the FULL 1000 either way (2000 → 1000).
  const laptop = row('Shared Laptop');
  assert.equal(laptop['Business Use %'], '50');
  assert.equal(laptop['Taxable Cost Base'], '1500.00');
  assert.equal(laptop['FY2024-25 Claim (lodged)'], '600.00');
  assert.equal(laptop['FY2025-26 Claim'], '500.00');
  assert.equal(laptop['FY2025-26 Closing Value'], '1000.00');
  assert.match(laptop.Notes, /FY2024-25 was lodged at 60% business use\./);

  // Part year: first used 15 Oct 2024, so 259 days of FY2024-25. GST not
  // claimed, so the cost base keeps it: 2200.
  const lens = row('Part Year Lens');
  assert.equal(lens['Taxable Cost Base'], '2200.00');
  assert.equal(lens['Depreciation Method'], 'Diminishing value');
  assert.match(lens.Notes, /First used 15\/10\/2024\./);
  assert.match(lens.Notes, /Part year in FY2024-25: 259 days held\./);
  assert.doesNotMatch(lens.Notes, /FY2025-26: \d+ days/);

  // Disposed 12 Mar 2026 for 800: held 255 days of FY2025-26, decline
  // 1000 × 255/365 × 20% = 139.73, adjustable value 800 − 139.73 = 660.27,
  // balancing adjustment 800 − 660.27 = +139.73.
  const drone = row('Sold Drone');
  assert.equal(drone['FY2025-26 Claim'], '139.73');
  assert.equal(drone['FY2025-26 Closing Value'], '660.27');
  assert.equal(drone['Disposal Date'], '2026-03-12');
  assert.equal(drone['Disposal Proceeds'], '800.00');
  assert.equal(drone['Balancing Adjustment'], '139.73');
  assert.match(drone.Notes, /Disposed 12\/03\/2026 for \$800\.00: balancing adjustment \$139\.73\./);
  assert.doesNotMatch(drone.Notes, /Part year/, 'the disposal sentence covers the disposal year');

  // A disposal after the range is named, not left out.
  const early = await csvTable('/api/depreciation-schedule-multi.csv?from=FY2024-25&to=FY2024-25');
  const droneEarly = early.rows.find((r) => r['Asset Description'] === 'Sold Drone');
  assert.equal(droneEarly['Disposal Date'], '');
  assert.match(droneEarly.Notes, /Disposed 12\/03\/2026, after this range\./);
  assert.match(early.res.headers.get('content-disposition') || '', /depreciation-schedule-FY2024-25\.csv/);
});

test('multi-year CSV: the pool is a row and the totals row sums cost base and claims', async () => {
  const { rows } = await csvTable('/api/depreciation-schedule-multi.csv?from=FY2024-25&to=FY2025-26');
  const pool = rows.find((r) => r['Asset Description'] === 'Small Business Pool');
  assert.ok(pool, 'the pool has a row');
  assert.equal(pool['Depreciation Method'], 'Small business pool');
  assert.equal(pool['Taxable Cost Base'], '');
  assert.match(pool.Notes, /FY2024-25 additions \$1,000\.00 \(business share\)\./);
  assert.equal(rows.some((r) => r['Asset Description'] === 'Pooled Tripod'), false, 'a pooled asset has no row of its own');

  // Totals: last row. Cost base 1000 + 2200 + 1500 + 1000 (the deleted
  // monitor has none: it isn't in the register).
  const total = rows[rows.length - 1];
  assert.equal(total['Asset Description'], 'Total');
  assert.equal(total['Taxable Cost Base'], '5700.00');
  assert.equal(total['FY2024-25 Opening Value (lodged)'], '');
});

test('multi-year CSV: defaults to the prior and current FY; refuses a bad range', async () => {
  const current = fyBounds(currentFinancialYear());
  const prior = fyBounds(`FY${current.startYear - 1}-${String(current.startYear % 100).padStart(2, '0')}`);
  const { header } = await csvTable('/api/depreciation-schedule-multi.csv');
  const years = header.filter((h) => / Claim/.test(h)).map((h) => h.split(' ')[0]);
  assert.deepEqual(years, [prior.label, current.label]);

  const refused = async (query, error) => {
    const res = await api(`/api/depreciation-schedule-multi.csv?${query}`);
    assert.equal(res.status, 400, query);
    assert.equal((await res.json()).error, error, query);
  };
  await refused('from=2025&to=FY2025-26', 'invalid_fy');
  await refused('from=FY2025-26&to=FY2024-25', 'fy_range_invalid');
  await refused('from=FY2014-15&to=FY2025-26', 'fy_range_too_long');
});

test('multi-year CSV: a name a spreadsheet would run as a formula is defused', async () => {
  const id = (await create({ name: '=HYPERLINK("x")' })).id;
  const res = await api('/api/depreciation-schedule-multi.csv?from=FY2025-26&to=FY2025-26');
  assert.match(await res.text(), /\r\n"'=HYPERLINK\(""x""\)",2024-07-01,/);
  await api(`/api/depreciation-assets/${id}`, { method: 'DELETE' });
});
