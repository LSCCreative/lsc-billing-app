'use strict';
// H10: does v19 -> v20 (Hnry) leave every saved estimate, invoice and document identical, and does a
// push send Hnry only the client-facing figures it stores?
//   node .design/hnry-invoicing/migration-check.js <repo> <v19 tree> <v19 billing.db> <workdir> <username> <password>
// <v19 tree>: `git archive 0491971 server | tar -x -C <dir>` with server/node_modules linked in from this
// repo. <v19 billing.db>: a COPY of a live backup, or the review dataset (.design/seed-review.js) made with
// that tree (it is only read). The login is that database's own; on a live copy, re-seed the account in
// the copy first. Needs pdftotext (poppler).
// Copies the database three times (A stays v19, B and C are migrated by this build) and checks:
//   1. every table: identical, but for the new hnry_* columns, which must all be empty;
//   2. calc.js: the v19 build against this one, every estimate and every frozen copy;
//   3. every owner and public read route and every PDF, v19 server on A against this build on B (Hnry
//      not set up on either); the only allowed difference is the new hnry* fields, all empty;
//   4. on C, in-process against a FAKE Hnry (never the real one): every invoice pushed as the user's
//      Create/Retry would, and a newly accepted project; each draft adds up to the stored figure to the
//      cent, the stored totals don't move, and nothing internal (floors, tax set-aside, take-home, costs,
//      overhead, hours, surcharges) is in anything sent to Hnry.
// The original database is only read.
// Section 4 runs this build in-process; its config is read once, at the first require.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'h10-check-session-secret-0123456789-0123456789';
process.env.GOOGLE_CALENDAR_WRITE = '0';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const [REPO, OLD, SRC, WORK] = process.argv.slice(2, 6);
// The in-process app (section 4) snapshots its database before every write: keep those in the work dir.
process.env.DATA_DIR = path.resolve(WORK || '.', 'C');
const [USER, PASS] = process.argv.slice(6, 8);
if (!USER || !PASS) throw new Error('usage: <repo> <v19 tree> <v19 billing.db> <workdir> <username> <password>');
const Database = require(path.join(REPO, 'server/node_modules/better-sqlite3'));
const newCalc = require(path.join(REPO, 'server/src/calc.js'));
const oldCalc = require(path.join(OLD, 'server/src/calc.js'));
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

let problems = 0;
const bad = (...a) => { problems += 1; console.log('  DIFF', ...a); };
const ok = (...a) => console.log('  ok  ', ...a);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !Buffer.isBuffer(x)
  ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
const cents = (n) => Math.round((Number(n) || 0) * 100);

/* Every table as canonical rows. `strip` drops the v20 columns from a row, and
   counts any that hold a value: on a migrated copy they must all be empty. */
const HNRY_COLS = { invoices: ['hnry_invoice_id', 'hnry_number', 'hnry_pushed_at', 'hnry_error', 'hnry_lines_done'], clients: ['hnry_client_id'] };
function dump(file, strip) {
  const db = new Database(file, { readonly: true });
  const out = {};
  let filled = 0;
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    out[name] = db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all().map((r) => {
      const row = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? 'blob:' + sha(v) : v]));
      if (strip) {
        for (const c of HNRY_COLS[name] || []) {
          if (row[c] !== null && row[c] !== undefined && !(c === 'hnry_lines_done' && row[c] === 0)) filled += 1;
          delete row[c];
        }
      }
      return canon(row);
    });
  }
  db.close();
  return { out, filled };
}

/* A route's JSON with the v20 hnry* fields taken out wherever they are, and how
   many of them held a value (none may, on a copy nothing was pushed from). */
function withoutHnry(v, seen) {
  if (Array.isArray(v)) return v.map((x) => withoutHnry(x, seen));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^hnry/.test(k)) { if (x !== null && x !== undefined && x !== 0 && x !== false) seen.filled.push(k + '=' + JSON.stringify(x)); continue; }
      o[k] = withoutHnry(x, seen);
    }
    return o;
  }
  return v;
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  for (const d of ['A', 'B', 'C']) fs.mkdirSync(path.join(WORK, d), { recursive: true });
  const file = (d) => path.join(WORK, d, 'billing.db');
  const src = new Database(SRC, { readonly: true });
  console.log('source schema', src.prepare('SELECT max(version) v FROM schema_version').get().v);
  for (const d of ['A', 'B', 'C']) await src.backup(file(d));
  src.close();
  for (const d of ['A', 'B', 'C']) {
    const db = new Database(file(d));
    db.exec('DELETE FROM google_event_sync; DELETE FROM google_account;');
    db.close();
  }

  // ── 1. The database itself ────────────────────────────────────────────────
  console.log('\n1. Tables, v19 copy against the migrated copy');
  const before = dump(file('A')).out;
  const { openDatabase } = require(path.join(REPO, 'server/src/db.js'));
  openDatabase(file('B')).close();
  openDatabase(file('C')).close();
  const { out: after, filled } = dump(file('B'), true);
  for (const t of Object.keys(before)) {
    if (!after[t]) { bad(t, 'table gone'); continue; }
    if (t === 'schema_version') continue;
    const same = before[t].length === after[t].length && before[t].every((r, i) => r === after[t][i]);
    if (same) ok(t.padEnd(20), before[t].length + ' rows identical' + (HNRY_COLS[t] ? ' (but the new empty hnry_* columns)' : ''));
    else bad(t, 'rows differ');
  }
  Object.keys(after).filter((t) => !before[t]).forEach((t) => bad(t, 'new table'));
  filled === 0 ? ok('hnry_* columns'.padEnd(20), 'all empty') : bad('hnry_* columns', filled + ' hold a value');
  const sv = after.schema_version.map((r) => JSON.parse(r).version);
  (sv[sv.length - 1] === 20 && after.schema_version.slice(0, -1).every((r, i) => r === before.schema_version[i]))
    ? ok('schema_version'.padEnd(20), 'one new row: 20') : bad('schema_version', sv.join(','));

  // ── 2. The money maths, both builds, every estimate and every frozen copy ─
  console.log('\n2. calc.js: v19 against this build');
  const dbA = new Database(file('A'), { readonly: true });
  const settings = (() => { const r = dbA.prepare('SELECT * FROM settings').all(); return r.length ? JSON.parse(r[0].data_json || '{}') : {}; })();
  const card = JSON.parse(dbA.prepare('SELECT data_json FROM pricing').get().data_json);
  const sources = [];
  dbA.prepare('SELECT id, upid, active_rows_json, gst_free FROM estimates').all().forEach((e) => sources.push(['estimate ' + e.upid, JSON.parse(e.active_rows_json || '{}'), e.gst_free === 1]));
  dbA.prepare('SELECT id, n, snapshot_json FROM estimate_versions').all().forEach((v) => {
    const s = JSON.parse(v.snapshot_json || '{}');
    sources.push(['version ' + v.id + ' n' + v.n, s.activeRows || {}, s.gstFree === true]);
  });
  dbA.prepare('SELECT id, kind, estimate_snapshot_json FROM invoices').all().forEach((i) => {
    if (!i.estimate_snapshot_json) return;
    const s = JSON.parse(i.estimate_snapshot_json);
    sources.push(['invoice ' + i.kind + ' ' + i.id, s.activeRows || {}, s.gstFree === true]);
  });
  dbA.close();
  for (const [label, rows, gstFree] of sources) {
    const tOld = oldCalc.computeTotals(rows, card, settings, { gstFree });
    const tNew = newCalc.computeTotals(rows, card, settings, { gstFree });
    const same = canon(tOld) === canon(tNew) && canon(oldCalc.postPlan(rows, card)) === canon(newCalc.postPlan(rows, card));
    same ? ok(label.padEnd(34), 'total ' + tNew.totalIncGst) : bad(label, 'totals ' + tOld.totalIncGst + ' -> ' + tNew.totalIncGst);
  }

  // ── 3. Every read route and every document, v19 server on A, this build on B ─
  console.log('\n3. Routes and documents: v19 server (A) against this build (B), Hnry not set up');
  const run = path.join(__dirname, 'migration-check-server.sh');
  const servers = [
    { name: 'A', proc: spawn(run, [path.join(OLD, 'server'), path.join(WORK, 'A'), '8093'], { stdio: ['ignore', fs.openSync(path.join(WORK, 'A.log'), 'w'), 'pipe'] }), base: 'http://localhost:8093' },
    { name: 'B', proc: spawn(run, [path.join(REPO, 'server'), path.join(WORK, 'B'), '8094'], { stdio: ['ignore', fs.openSync(path.join(WORK, 'B.log'), 'w'), 'pipe'] }), base: 'http://localhost:8094' },
  ];
  try {
    for (const s of servers) {
      for (let i = 0; i < 60; i++) {
        try { if ((await fetch(s.base + '/health')).ok) break; } catch {}
        await new Promise((r) => setTimeout(r, 300));
      }
      const r = await fetch(s.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ username: USER, password: PASS }) });
      if (!r.ok) throw new Error(s.name + ' login ' + r.status);
      s.cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    }
    const get = async (s, p, method = 'GET', body) => {
      const r = await fetch(s.base + p, { method, headers: { cookie: s.cookie, origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get('content-type') || '', buf };
    };
    const pdfText = (buf, tag) => {
      const f = path.join(WORK, tag + '.pdf');
      fs.writeFileSync(f, buf);
      return execFileSync('pdftotext', ['-layout', f, '-']).toString();
    };
    const both = async (p, method, body) => {
      const [a, b] = [await get(servers[0], p, method, body), await get(servers[1], p, method, body)];
      if (a.status !== b.status) return bad(p, 'status ' + a.status + ' -> ' + b.status);
      if (a.type.includes('pdf')) {
        const tag = p.replace(/\W+/g, '_');
        const ta = pdfText(a.buf, 'A' + tag); const tb = pdfText(b.buf, 'B' + tag);
        ta === tb ? ok(p.padEnd(58), 'pdf text identical (' + ta.length + ' chars)') : bad(p, 'pdf text differs');
        return;
      }
      if (a.type.includes('json')) {
        const seen = { filled: [] };
        const ja = JSON.parse(a.buf); const jb = withoutHnry(JSON.parse(b.buf), seen);
        if (seen.filled.length) bad(p, 'hnry field with a value', seen.filled.slice(0, 3).join(', '));
        else if (canon(ja) === canon(jb)) ok(p.padEnd(58), a.status + ' json identical');
        else bad(p, 'json differs', firstDiff(ja, jb));
        return;
      }
      a.buf.equals(b.buf) ? ok(p.padEnd(58), a.status + ' ' + a.type.split(';')[0] + ' identical') : bad(p, 'body differs');
    };

    const dbB = new Database(file('B'), { readonly: true });
    const ests = dbB.prepare('SELECT id, upid, public_token, call_sheet_token, call_sheet_on FROM estimates').all();
    const invs = dbB.prepare('SELECT id, kind, public_token FROM invoices').all();
    const projs = dbB.prepare('SELECT id FROM projects').all();
    const clients = dbB.prepare('SELECT id FROM clients').all();
    dbB.close();

    const q = '?today=' + TODAY;
    for (const p of ['/api/estimates', '/api/projects' + q, '/api/projects' + q + '&stage=open', '/api/invoices' + q,
      '/api/invoices' + q + '&state=outstanding', '/api/invoices' + q + '&state=paid', '/api/clients', '/api/activity' + q,
      '/api/settings', '/api/sends', '/api/goals', '/api/overhead-items', '/api/pricing', '/api/calendar?from=2026-01-01&to=2027-12-31']) await both(p);
    for (const e of ests) {
      await both('/api/estimates/' + e.id);
      await both('/api/estimates/' + e.id + '/pdf' + q, 'POST', {});
      await both('/api/estimates/' + e.id + '/cost-breakdown' + q, 'POST', {});
      if (e.call_sheet_on) await both('/api/estimates/' + e.id + '/call-sheet');
    }
    for (const p of projs) await both('/api/projects/' + p.id + q);
    for (const c of clients) await both('/api/clients/' + c.id);
    for (const i of invs) {
      await both('/api/invoices/' + i.id + q);
      await both('/api/invoices/' + i.id + '/pdf' + q, 'POST', {});
      await both('/api/invoices/' + i.id + '/cost-breakdown' + q, 'POST', {});
    }
    // Public last: opening a link writes an "opened" row. The PDF limit is 12 per 10 minutes.
    let pdfs = 0;
    for (const e of ests.filter((x) => x.public_token)) {
      await both('/public/estimates/' + e.public_token);
      if (pdfs++ < 6) await both('/public/estimates/' + e.public_token + '/pdf');
    }
    for (const i of invs.filter((x) => x.public_token)) {
      await both('/public/invoices/' + i.public_token);
      if (pdfs++ < 11) await both('/public/invoices/' + i.public_token + '/pdf');
    }
  } finally {
    servers.forEach((s) => s.proc.kill());
  }

  // ── 4. Pushing to a FAKE Hnry: the stored figures, and nothing internal ───
  console.log('\n4. Pushes on C, this build in-process, a fake Hnry');
  await pushes(file('C'));
  console.log('\n' + (problems ? problems + ' DIFFERENCE(S)' : 'NO DIFFERENCES') + '  (' + sources.length + ' priced copies, schema ' + sv[sv.length - 1] + ')');
  process.exit(problems ? 1 : 0); // the in-process app's timers would otherwise keep it alive
}

async function pushes(fileC) {
  const S = (p) => require(path.join(REPO, 'server', p));
  const { openDatabase } = S('src/db.js');
  const { createApp } = S('src/app.js');
  const { createHnry } = S('src/hnry.js');
  const { amountDue } = S('src/invoices.js');
  const { fakeHnry } = S('test/fake-hnry.js');
  const db = openDatabase(fileC);
  const fake = fakeHnry();
  const app = createApp(db, { hnry: createHnry({}, fake), renderPdf: async () => Buffer.from('%PDF-not-used') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
    if (!login.ok) throw new Error('C login ' + login.status);
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const api = async (p, method = 'GET', body) => {
      const r = await fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const rowOf = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);

    /* Checks one invoice the fake now holds: its lines add up to what the row
       bills, to the cent, and the row's stored totals did not move. */
    const checkDraft = (inv, totalsBefore, label) => {
      const row = rowOf(inv.id);
      if (row.totals_json !== totalsBefore) return bad(label, 'stored totals changed by the push');
      const draft = fake.invoices.find((d) => d.id === row.hnry_invoice_id);
      if (!draft) return bad(label, 'no draft in the fake');
      const due = cents(amountDue(row.kind, JSON.parse(row.totals_json)));
      fake.total(draft.id) === due
        ? ok(label.padEnd(40), 'draft ' + draft.invoiceNumber + ' = $' + (due / 100).toFixed(2) + ' (' + draft.items.length + ' line' + (draft.items.length === 1 ? '' : 's') + '), stored totals unchanged')
        : bad(label, 'draft $' + fake.total(draft.id) / 100 + ' but the invoice bills $' + due / 100);
    };

    // 4a. Every invoice from before v20, as the user's Create in Hnry / Retry would.
    console.log('  4a. Every pre-v20 invoice, Create in Hnry / Retry');
    const old = db.prepare("SELECT i.*, e.upid FROM invoices i LEFT JOIN estimates e ON e.id = i.estimate_id ORDER BY e.upid, i.kind").all();
    for (const inv of old) {
      const label = (inv.upid || '?') + ' ' + inv.kind + '/' + inv.status;
      const totalsBefore = inv.totals_json;
      const r = await api('/api/invoices/' + inv.id + '/hnry', 'POST', {});
      if (r.status === 200) checkDraft(inv, totalsBefore, label);
      else {
        const row = rowOf(inv.id);
        const expected = inv.status !== 'draft' || inv.kind === 'legacy' || (r.body && r.body.error === 'deposit_not_in_hnry');
        (expected && row.totals_json === totalsBefore && !row.hnry_invoice_id)
          ? ok(label.padEnd(40), r.status + ' ' + (r.body && (r.body.error + (r.body.reason ? ':' + r.body.reason : ''))) + ', nothing sent, row unchanged')
          : bad(label, 'unexpected', r.status, JSON.stringify(r.body).slice(0, 160));
      }
    }

    // 4b. A project accepted now, with extras on its final.
    console.log('  4b. A project accepted under this build');
    const est = db.prepare("SELECT * FROM estimates WHERE upid = 'NBK-014'").get() || db.prepare("SELECT * FROM estimates WHERE status = 'draft' LIMIT 1").get();
    if (!est) bad('4b', 'no draft estimate to accept');
    else {
      const acc = await api('/api/projects/' + est.project_id + '/accept', 'POST', { invoicing: 'pair', depositPct: 33.3 });
      if (acc.status !== 200) bad('4b accept', acc.status, JSON.stringify(acc.body).slice(0, 200));
      else {
        await app.locals.hnryPush.idle();
        const rows = db.prepare("SELECT * FROM invoices WHERE project_id = ? AND status <> 'void' ORDER BY kind").all(est.project_id);
        const dep = rows.find((x) => x.kind === 'deposit');
        const fin = rows.find((x) => x.kind === 'final');
        checkDraft(dep, dep.totals_json, est.upid + ' deposit (pushed at accept)');
        const put = await api('/api/invoices/' + fin.id, 'PUT', { extras: [{ name: 'Drone day', qty: 2, mu: 333.33 }, { name: 'Travel', qty: 1, mu: 87.65 }] });
        if (put.status !== 200) bad('4b extras', put.status, JSON.stringify(put.body).slice(0, 200));
        const finBefore = rowOf(fin.id).totals_json;
        const pushed = await api('/api/invoices/' + fin.id + '/hnry', 'POST', {});
        pushed.status === 200 ? checkDraft(fin, finBefore, est.upid + ' final + 2 extras') : bad('4b final', pushed.status, JSON.stringify(pushed.body).slice(0, 200));
        const t = JSON.parse(rowOf(fin.id).totals_json);
        cents(t.balanceDue) === cents(amountDue('final', t)) ? ok('final balanceDue'.padEnd(40), '$' + t.balanceDue + ' is what it bills') : bad('final', 'balanceDue', t.balanceDue, 'amountDue', amountDue('final', t));
      }
    }

    // 4c. What reached the fake: the expected inputs only, and no internal figure.
    console.log('  4c. Everything sent to Hnry');
    const KEYS = {
      findOrCreateClient: ['email', 'name'], findInvoice: ['poNumber', 'queryField'],
      createInvoice: ['clientId', 'dueDate', 'invoiceDate', 'invoiceItems', 'poNumber'], addItem: ['description', 'invoiceId', 'price', 'quantity'],
    };
    const sentNumbers = new Set();
    const sentText = [];
    for (const c of fake.calls) {
      const extra = Object.keys(c.inputs).filter((k) => !(KEYS[c.name] || []).includes(k));
      if (extra.length) bad(c.name, 'sends unexpected inputs', extra.join(', '));
      const walk = (v) => {
        if (typeof v === 'number') sentNumbers.add(cents(v));
        else if (typeof v === 'string') sentText.push(v);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(c.inputs);
    }
    // Client-facing: the figures each pushed draft carries, and quantities.
    const facing = new Set([cents(1)]);
    fake.invoices.forEach((d) => d.items.forEach((it) => facing.add(cents(it.price))));
    const leaks = [];
    const INTERNAL = ['labourTotal', 'surchargeTotal', 'expenseTotal', 'passThroughCost', 'directJobCost', 'incomeExGst', 'overheadShare', 'totalHours', 'taxSetAside', 'estTakeHome'];
    for (const row of db.prepare('SELECT estimate_snapshot_json, totals_json FROM invoices WHERE hnry_invoice_id IS NOT NULL').all()) {
      const snap = JSON.parse(row.estimate_snapshot_json || '{}');
      const tot = snap.totals || {};
      const internal = INTERNAL.map((k) => [k, tot[k]]).filter(([, v]) => typeof v === 'number' && cents(v) !== 0 && !facing.has(cents(v)));
      for (const [k, v] of internal) {
        if (sentNumbers.has(cents(v))) leaks.push(k + ' ' + v + ' as a number');
        const as = [String(v), Number(v).toFixed(2), Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2 })];
        if (sentText.some((s) => as.some((a) => s.includes(a)))) leaks.push(k + ' ' + v + ' in text');
      }
    }
    const WORDS = /floor|set.?aside|take.?home|overhead|surcharge|margin|profit|cost breakdown|\bcost\b/i;
    sentText.filter((s) => WORDS.test(s)).forEach((s) => leaks.push('text "' + s.slice(0, 60) + '"'));
    const strange = [...sentNumbers].filter((n) => !facing.has(n) && !facing.has(-n));
    strange.forEach((n) => leaks.push('a number that is no line price: ' + n / 100));
    leaks.length ? leaks.forEach((l) => bad('sent to Hnry', l)) : ok('sent to Hnry'.padEnd(40), fake.calls.length + ' calls: only names, the reference, ids and line prices; no internal figure');
    const descs = fake.invoices.flatMap((d) => d.items.map((it) => it.description));
    const PATTERN = /^(Deposit invoice( \(\d+(\.\d+)?%\))?|Final invoice|Invoice): .+$|^Less deposit \(INV-\d+\)$|^Additional work$/;
    const extrasNames = /^(Drone day|Travel)( \(×\d+(\.\d+)?\))?$/;
    const odd = descs.filter((d) => !PATTERN.test(d) && !extrasNames.test(d));
    odd.length ? odd.forEach((d) => bad('line text', d)) : ok('line texts'.padEnd(40), descs.length + ' lines, every one a known wording');
  } finally {
    server.close();
    db.close();
  }
}

function firstDiff(a, b, at = '') {
  if (canon(a) === canon(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], at + '.' + k);
      if (d) return d;
    }
  }
  return at + ': ' + JSON.stringify(a).slice(0, 120) + ' -> ' + JSON.stringify(b).slice(0, 120);
}

main().catch((e) => { console.error(e); process.exit(1); });
