'use strict';
// PM9: does v18 -> v19 leave every saved estimate, invoice and document identical?
//   node .design/post-multipliers/migration-check.js <repo> <v18 tree> <v18 billing.db> <workdir> <username> <password>
// <v18 tree>: `git archive 5f12eeb server | tar -x -C <dir>` with server/node_modules linked
// in from this repo. <v18 billing.db>: a COPY of a live backup (it is only read). The login
// is that database's own; on a live copy, re-seed the account in the copy first.
// Needs pdftotext (poppler). Section 4 saves and sends one estimate on the migrated copy B.
// Copies the database twice (A stays v18, B is migrated by this build), compares
// every table, then the money maths (both calc.js builds), then every owner and
// public read route and every PDF, v18 server on A against this build on B.
// Both servers run with the stub mailer and no Google writes; the copies have
// their Google rows deleted. The original database is only read.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const [REPO, OLD, SRC, WORK] = process.argv.slice(2, 6);
const [USER, PASS] = process.argv.slice(6, 8);
if (!USER || !PASS) throw new Error('usage: <repo> <v18 tree> <v18 billing.db> <workdir> <username> <password>');
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

function dump(file) {
  const db = new Database(file, { readonly: true });
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    out[name] = db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()
      .map((r) => canon(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? 'blob:' + sha(v) : v]))));
  }
  db.close();
  return out;
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  for (const d of ['A', 'B']) fs.mkdirSync(path.join(WORK, d), { recursive: true });
  const fileA = path.join(WORK, 'A/billing.db');
  const fileB = path.join(WORK, 'B/billing.db');
  const src = new Database(SRC, { readonly: true });
  console.log('source schema', src.prepare('SELECT max(version) v FROM schema_version').get().v);
  await src.backup(fileA);
  await src.backup(fileB);
  src.close();
  for (const f of [fileA, fileB]) {
    const db = new Database(f);
    db.exec('DELETE FROM google_event_sync; DELETE FROM google_account;');
    db.close();
  }

  // ── 1. The database itself ────────────────────────────────────────────────
  console.log('\n1. Tables, v18 copy against the migrated copy');
  const before = dump(fileA);
  const { openDatabase } = require(path.join(REPO, 'server/src/db.js'));
  openDatabase(fileB).close();
  const after = dump(fileB);
  for (const t of Object.keys(before)) {
    if (!after[t]) { bad(t, 'table gone'); continue; }
    if (t === 'pricing' || t === 'schema_version') continue;
    const same = before[t].length === after[t].length && before[t].every((r, i) => r === after[t][i]);
    if (same) ok(t.padEnd(20), before[t].length + ' rows identical');
    else bad(t, 'rows differ');
  }
  Object.keys(after).filter((t) => !before[t]).forEach((t) => bad(t, 'new table'));
  const sv = after.schema_version.map((r) => JSON.parse(r).version);
  (sv[sv.length - 1] === 19 && after.schema_version.slice(0, -1).every((r, i) => r === before.schema_version[i]))
    ? ok('schema_version'.padEnd(20), 'one new row: 19') : bad('schema_version', sv.join(','));
  const cardA = JSON.parse(JSON.parse(before.pricing[0]).data_json);
  const cardB = JSON.parse(JSON.parse(after.pricing[0]).data_json);
  const strip = (c) => { const x = { ...c }; delete x.deliverableTypes; return canon(x); };
  strip(cardA) === strip(cardB) ? ok('pricing'.padEnd(20), 'every field but deliverableTypes identical') : bad('pricing', 'other card fields moved');
  (cardA.deliverableTypes || []).forEach((t, i) => {
    const u = (cardB.deliverableTypes || [])[i];
    const want = { ...t, services: (t.services || []).map((n) => ({ name: n, multiplier: 0 })) };
    delete want.multiplier;
    canon(want) === canon(u) ? ok('  type ' + t.name, JSON.stringify(t.services), 'x' + t.multiplier, '->', JSON.stringify(u.services))
      : bad('type', canon(t), '->', canon(u));
  });

  // ── 2. The money maths, both builds, every estimate and every frozen copy ─
  console.log('\n2. calc.js: v18 against this build');
  const dbA = new Database(fileA, { readonly: true });
  const settings = (() => { const r = dbA.prepare('SELECT * FROM settings').all(); return r.length ? JSON.parse(r[0].data_json || '{}') : {}; })();
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
    const tOld = oldCalc.computeTotals(rows, cardA, settings, { gstFree });
    const tNew = newCalc.computeTotals(rows, cardB, settings, { gstFree });
    const pOld = oldCalc.postPlan(rows, cardA);
    const pNew = newCalc.postPlan(rows, cardB);
    const { lines, ...pNewRest } = pNew;
    const totalsSame = canon(tOld) === canon(tNew);
    const planSame = canon(pOld) === canon(pNewRest) && lines.length === 0;
    if (totalsSame && planSame) ok(label.padEnd(34), 'total ' + tNew.totalIncGst + ', post rec ' + pNew.recommended + ' of ' + pNew.onPostLines + ' on lines, capture ' + pNew.captureHours);
    else bad(label, totalsSame ? '' : 'totals ' + tOld.totalIncGst + ' -> ' + tNew.totalIncGst, planSame ? '' : 'plan ' + canon(pOld) + ' -> ' + canon(pNew));
  }

  // ── 3. Every read route and every document, v18 server on A, this build on B ─
  console.log('\n3. Routes and documents: v18 server (A) against this build (B)');
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
    const pdfShown = {};
    const both = async (p, method, body) => {
      const [a, b] = [await get(servers[0], p, method, body), await get(servers[1], p, method, body)];
      if (a.status !== b.status) return bad(p, 'status ' + a.status + ' -> ' + b.status);
      if (a.type.includes('pdf')) {
        const tag = p.replace(/\W+/g, '_');
        const ta = pdfText(a.buf, 'A' + tag); const tb = pdfText(b.buf, 'B' + tag);
        if (ta === tb) { ok(p.padEnd(58), 'pdf text identical (' + ta.length + ' chars)'); pdfShown[p] = tb; } else bad(p, 'pdf text differs');
        return;
      }
      if (a.type.includes('json')) {
        const ja = JSON.parse(a.buf); const jb = JSON.parse(b.buf);
        if (canon(ja) === canon(jb)) ok(p.padEnd(58), a.status + ' json identical');
        else bad(p, 'json differs', firstDiff(ja, jb));
        return b;
      }
      a.buf.equals(b.buf) ? ok(p.padEnd(58), a.status + ' ' + a.type.split(';')[0] + ' identical') : bad(p, 'body differs');
      return b;
    };

    const dbB = new Database(fileB, { readonly: true });
    const ests = dbB.prepare('SELECT id, upid, public_token, call_sheet_token, call_sheet_on FROM estimates').all();
    const invs = dbB.prepare('SELECT id, kind, public_token FROM invoices').all();
    const projs = dbB.prepare('SELECT id FROM projects').all();
    const clients = dbB.prepare('SELECT id FROM clients').all();
    dbB.close();

    const q = '?today=' + TODAY;
    for (const p of ['/api/estimates', '/api/projects' + q, '/api/projects' + q + '&stage=open', '/api/invoices' + q,
      '/api/invoices' + q + '&state=outstanding', '/api/invoices' + q + '&state=paid', '/api/clients', '/api/activity' + q,
      '/api/settings', '/api/sends', '/api/goals', '/api/overhead-items', '/api/calendar?from=2026-01-01&to=2027-12-31']) await both(p);
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

    // ── 4. The new line fields never reach a client ─────────────────────────
    console.log('\n4. postMultiplier / follows on a client route or PDF (this build, B)');
    const B = servers[1];
    const est = JSON.parse((await get(B, '/api/estimates/' + (ests.find((e) => e.upid === 'TYP-015') || ests[0]).id)).buf).estimate;
    if (est) {
      const rows = est.activeRows;
      rows.post = (rows.post || []).map((l, i) => ({ ...l, postMultiplier: 913.37 + i, follows: i % 2 === 0 }));
      const put = await get(B, '/api/estimates/' + est.id, 'PUT', { ...est, pricingShape: newCalc.PRICING_SHAPE, activeRows: rows });
      put.status < 300 ? ok('saved', est.upid, 'with postMultiplier/follows on every post line') : bad('save', put.status, put.buf.toString().slice(0, 200));
      const back = JSON.parse((await get(B, '/api/estimates/' + est.id)).buf).estimate;
      (back.activeRows.post || []).every((l, i) => l.postMultiplier === 913.37 + i && l.follows === (i % 2 === 0))
        ? ok('owner GET keeps both fields on every post line') : bad('owner GET lost a field');
      const send = await get(B, '/api/projects/' + back.projectId + '/send' + q, 'POST', { by: 'link', validUntil: TODAY });
      const tok = (JSON.parse(send.buf).sent || {}).token || back.publicToken;
      const leak = (label, buf) => (/"postMultiplier"|"follows"|91[3-9]\.37/.test(buf.toString()) ? bad(label, 'leaks a planner field') : ok(label.padEnd(58), 'no planner field'));
      if (tok) {
        leak('/public/estimates/<token>', (await get(B, '/public/estimates/' + tok)).buf);
        const pdf = await get(B, '/public/estimates/' + tok + '/pdf');
        leak('/public/estimates/<token>/pdf (text)', Buffer.from(pdfText(pdf.buf, 'Bleak')));
      } else bad('send', send.status, send.buf.toString().slice(0, 200));
      const own = await get(B, '/api/estimates/' + est.id + '/pdf' + q, 'POST', {});
      leak('/api/estimates/<id>/pdf (text)', Buffer.from(pdfText(own.buf, 'Bown')));
      const cb = await get(B, '/api/estimates/' + est.id + '/cost-breakdown' + q, 'POST', {});
      cb.status === 200 ? leak('/api/estimates/<id>/cost-breakdown (text)', Buffer.from(pdfText(cb.buf, 'Bcb'))) : ok('cost breakdown', cb.status);
    }
  } finally {
    servers.forEach((s) => s.proc.kill());
  }
  console.log('\n' + (problems ? problems + ' DIFFERENCE(S)' : 'NO DIFFERENCES') + '  (' + sources.length + ' priced copies, schema ' + sv[sv.length - 1] + ')');
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
