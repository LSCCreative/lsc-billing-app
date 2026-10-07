'use strict';
// The review dataset for ui-clarity tasks 9–14: one project per state the
// Project page and Invoice screen draw, on the local scratch API.
//   1. Seed a fresh scratch DB (launch.json's api-scratch _comment), start
//      api-scratch-mail, then: node .design/ui-clarity/seed-review.js server
// DRF-001 draft · SNT-002 sent, email scheduled · EXP-003 sent, expired ·
// ACC-004 accepted, no invoices · DEP-005 deposit overdue · DPD-006 signed by
// the client, deposit paid, 14 activity rows · SGL-007 single paid ·
// DCL-008 declined · LEG-009 legacy invoice · VOD-010 voided and remade.
const path = require('node:path');
const SERVER = path.resolve(process.argv[2] || 'server');
const Database = require(path.join(SERVER, 'node_modules/better-sqlite3'));
const { PRICING_SHAPE } = require(path.join(SERVER, 'src/calc'));
const BASE = 'http://localhost:8080';
const db = new Database('/tmp/lsc-billing-scratch/billing.db');

let cookie = '';
async function api(p, method = 'GET', body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:5173' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (r.status >= 400) throw new Error(method + ' ' + p + ' → ' + r.status + ' ' + text.slice(0, 300));
  return json;
}
const DAY = 86400e3;
const ymd = (k) => new Date(Date.now() + k * DAY).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
const today = ymd(0);

async function estimate(upid, name, client, days, extra) {
  const dayList = (days || []).map((d, i) => ({ id: 'd_' + upid.toLowerCase().replace(/\W/g, '') + i, date: d[0], status: d[1] || 'proposed', startTime: d[2] || null, endTime: d[3] || null }));
  const prod = dayList.map((d, i) => ({ name: ['Camera operator', 'Director', 'Sound recordist'][i % 3], qty: 1, mu: 900, dayUnit: 'full', hoursPerUnit: 8, dayId: d.id }));
  const r = await api('/api/estimates', 'POST', Object.assign({
    pricingShape: PRICING_SHAPE,
    name, upid,
    client,
    days: dayList,
    activeRows: { prod, post: [{ name: 'Edit', qty: 2, mu: 900, dayUnit: 'full', hoursPerUnit: 8 }] },
  }, extra || {}));
  return r.estimate;
}
const send = (e, by) => api('/api/projects/' + e.projectId + '/send?today=' + today, 'POST',
  by === 'email'
    ? { by: 'email', to: 'priya@salt.example', message: 'Hi', validUntil: ymd(30) }
    : by === 'later'
      ? { by: 'email', to: 'priya@salt.example', message: 'Hi', validUntil: ymd(32), scheduledFor: new Date(Date.now() + 2 * DAY).toISOString() }
      : { by: 'link', validUntil: ymd(30) });
const accept = (e, invoicing, pct) => api('/api/projects/' + e.projectId + '/accept?today=' + today, 'POST', invoicing === 'single' ? { invoicing } : { invoicing, depositPct: pct || 50 });
const folder = (e) => api('/api/projects/' + e.projectId + '?today=' + today);
const sendInv = (id, dueAt) => api('/api/invoices/' + id + '/send?today=' + today, 'POST', { by: 'link', dueAt: dueAt || ymd(14) });
const paid = (id) => api('/api/invoices/' + id + '/paid?today=' + today, 'POST', { paidAt: today, via: 'bank' });

(async () => {
  const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ username: 'dev', password: 'scratch-dev-password' }) });
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  await api('/api/pricing/reset', 'POST');
  await api('/api/settings', 'PUT', { business: { name: 'LSC Creative', abn: '12345678901', email: 'hello@lsccreative.studio', phone: '0400 000 000', signer: 'Lachlan Sullivan-Carey' } });

  const salt = { businessName: 'Saltwater Co.', contactName: 'Priya Nair', email: 'priya@salt.example' };
  const harbour = { businessName: 'Example Harbour Co', contactName: 'Sam Lee', email: 'sam@harbour.example' };
  const made = {};

  // 1. Draft, ready to send.
  made.draft = await estimate('DRF-001', 'Autumn range launch', salt, [[ymd(20), 'pencilled', '08:00', '17:00'], [ymd(21), 'proposed'], [null, 'proposed']]);
  // 2. Sent, with a scheduled email still waiting.
  made.sent = await estimate('SNT-002', 'Harbour launch film', harbour, [[ymd(25), 'proposed', '07:30', '16:00']]);
  await send(made.sent, 'later');
  // 3. Sent and expired.
  made.expired = await estimate('EXP-003', 'Winter campaign stills', salt, [[ymd(40), 'proposed']]);
  await send(made.expired, 'link');
  db.prepare('UPDATE estimate_versions SET valid_until = ? WHERE estimate_id = ?').run(ymd(-3), made.expired.id);
  // 4. Accepted before invoices were made here (v13's mapping).
  made.needs = await estimate('ACC-004', 'Brand film refresh', harbour, [[ymd(12), 'confirmed']]);
  await send(made.needs, 'link');
  db.prepare("UPDATE estimates SET status = 'accepted' WHERE id = ?").run(made.needs.id);
  // 5. Deposit overdue.
  made.overdue = await estimate('DEP-005', 'Festival recap', salt, [[ymd(9), 'proposed', '09:00', '18:00'], [ymd(10), 'proposed']]);
  await send(made.overdue, 'link');
  let f = await accept(made.overdue, 'pair', 50);
  let dep = f.invoices.find((i) => i.kind === 'deposit');
  await sendInv(dep.id);
  db.prepare('UPDATE invoices SET due_at = ?, issued_at = ? WHERE id = ?').run(ymd(-4), ymd(-18), dep.id);
  // 6. Deposit paid, final not sent; signed by the client on its page.
  made.depPaid = await estimate('DPD-006', 'Product series — six spots', harbour, [[ymd(-6), 'proposed'], [ymd(-5), 'proposed'], [ymd(30), 'proposed']]);
  const s6 = await send(made.depPaid, 'link');
  const pub = (await api('/public/estimates/' + s6.sent.token)).estimate;
  const signed = await fetch(BASE + '/public/estimates/' + s6.sent.token + '/accept', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ fullName: 'Sam Lee', role: 'Head of marketing', agree: true, version: pub.version, key: pub.agreement && pub.agreement.key, invoicing: 'pair' }),
  });
  if (signed.status >= 400) console.warn('sign failed', signed.status, await signed.text());
  f = await folder(made.depPaid);
  dep = f.invoices.find((i) => i.kind === 'deposit');
  if (dep) {
    await sendInv(dep.id);
    await paid(dep.id);
  } else {
    console.warn('no deposit on DPD-006', f.project.stage);
  }
  // 7. Single invoice, paid.
  made.single = await estimate('SGL-007', 'Headshots day', salt, [[ymd(-12), 'proposed', '10:00', '15:00']]);
  await send(made.single, 'email');
  f = await accept(made.single, 'single');
  const one = f.invoices.find((i) => i.kind === 'single');
  await sendInv(one.id);
  await paid(one.id);
  // 8. Declined.
  made.declined = await estimate('DCL-008', 'Trade show loop', harbour, [[ymd(15), 'proposed']]);
  await send(made.declined, 'link');
  await api('/api/projects/' + made.declined.projectId + '/decline?today=' + today, 'POST');
  // 9. Legacy: an invoice made the old way.
  made.legacy = await estimate('LEG-009', 'Annual report video', salt, [[ymd(-60), 'confirmed']]);
  db.prepare("UPDATE estimates SET status = 'accepted' WHERE id = ?").run(made.legacy.id);
  db.prepare("INSERT INTO invoices (id, project_id, estimate_id, kind, number, status, totals_json, created_at, updated_at) VALUES ('inv_leg9', ?, ?, 'legacy', 'INV-OLD-9', 'sent', '{\"totalIncGst\":2475}', ?, ?)")
    .run(made.legacy.projectId, made.legacy.id, new Date().toISOString(), new Date().toISOString());
  // 10. A sent single voided and remade (void row last, replacement draft).
  made.voided = await estimate('VOD-010', 'Podcast set build', harbour, [[ymd(5), 'proposed']]);
  await send(made.voided, 'link');
  f = await accept(made.voided, 'single');
  const v1 = f.invoices.find((i) => i.kind === 'single');
  await sendInv(v1.id);
  await api('/api/invoices/' + v1.id + '/void?today=' + today, 'POST', { reason: 'Wrong billing address' });

  // A long log on DPD-006, for Show all (N).
  const ins = db.prepare("INSERT INTO activity (id, project_id, at, kind, detail_json) VALUES (?, ?, ?, 'opened', ?)");
  for (let i = 0; i < 9; i++) {
    ins.run('act_rv_' + i, made.depPaid.projectId, new Date(Date.now() - (20 + i) * DAY).toISOString(), JSON.stringify({ version: 1 }));
  }

  for (const [k, e] of Object.entries(made)) {
    const ff = await folder(e);
    console.log(k.padEnd(9), e.upid, e.projectId, ff.project.stage, (ff.project.stageDetail || {}).step, 'inv:' + ff.invoices.map((i) => i.kind + '/' + i.status).join(','), 'act:' + ff.activity.length);
  }
})().catch((err) => { console.error(err); process.exit(1); });
