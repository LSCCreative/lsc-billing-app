'use strict';

/**
 * The Hnry module (hnry-invoicing H1). A fake stands in for Hnry, and a stub SDK
 * for Zapier, so these pin what is asked of Hnry and how its answers and
 * failures read, not the network. The real transport is checked once against
 * the user's own client in H9.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { createHnry, zapierTransport, HnryError, ACTIONS, PO_QUERY_FIELD } = require('../src/hnry');
const { fakeHnry } = require('./fake-hnry');

const SECRET = 'zap_secret_0123456789';

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof HnryError, `an HnryError, got ${err && err.name}`);
    assert.equal(err.code, code);
    assert.ok(!String(err.message).includes(SECRET), 'no credential in a message');
    return true;
  });
}

function setup() {
  const fake = fakeHnry();
  const hnry = createHnry({ hnry: { clientId: 'id', clientSecret: SECRET } }, fake);
  return { fake, hnry };
}

/* ── Configured or not ────────────────────────────────────────────────── */

test('without credentials Hnry is "not set up": no throw at creation, every call says so', async () => {
  for (const cfg of [{}, { hnry: {} }, { hnry: { clientId: 'id', clientSecret: '' } }, { hnry: { clientId: '', clientSecret: 's' } }]) {
    const hnry = createHnry(cfg);
    assert.equal(hnry.enabled, false);
    await rejects(hnry.findOrCreateClient({ name: 'A' }), 'not_configured');
    await rejects(hnry.createInvoice({ clientId: 'c', poNumber: 'P', description: 'd', price: 1 }), 'not_configured');
  }
  assert.equal(createHnry({ hnry: { clientId: 'id', clientSecret: 's' } }).enabled, true);
});

test('creating the client never loads the SDK: nothing can fail until a call is made', async () => {
  let imports = 0;
  const t = zapierTransport({ clientId: 'id', clientSecret: SECRET }, { importSdk: async () => { imports += 1; throw new Error('boom'); } });
  const hnry = createHnry({}, t);
  assert.equal(hnry.enabled, true);
  assert.equal(imports, 0);
  await rejects(hnry.findOrCreateClient({ name: 'A' }), 'zapier_error');
  assert.equal(imports, 1);
});

/* ── Clients, invoices, lines ─────────────────────────────────────────── */

test('a client is found by name the second time, whatever its case', async () => {
  const { fake, hnry } = setup();
  const a = await hnry.findOrCreateClient({ name: 'Acme Pty Ltd', email: 'a@acme.test' });
  const b = await hnry.findOrCreateClient({ name: 'ACME pty ltd' });
  assert.equal(a.id, b.id);
  assert.equal(fake.clients.length, 1);
  assert.deepEqual(fake.calls[0].inputs, { name: 'Acme Pty Ltd', email: 'a@acme.test' });
  assert.deepEqual(fake.calls[1].inputs, { name: 'ACME pty ltd' }, 'no email key when there is none');
});

test('createInvoice makes one DRAFT line and hands back Hnry\'s id and number', async () => {
  const { fake, hnry } = setup();
  const c = await hnry.findOrCreateClient({ name: 'Acme' });
  const inv = await hnry.createInvoice({
    clientId: c.id, poNumber: 'INV-UP-1-D', description: 'Deposit invoice (50%): Brand film', price: 2750.505, dueDate: '2026-11-11',
  });
  assert.match(inv.id, /^[A-Za-z0-9+/=]+$/);
  assert.match(inv.number, /^INV-\d+$/);
  assert.equal(inv.status, 'DRAFT');
  assert.equal(inv.poNumber, 'INV-UP-1-D');
  const sent = fake.calls.at(-1).inputs;
  assert.equal(inv.clientId, c.id);
  assert.deepEqual(Object.keys(sent).sort(), ['clientId', 'dueDate', 'invoiceItems', 'poNumber'], 'the line goes in invoiceItems, as Hnry\'s Create Invoice takes it');
  const [line] = sent.invoiceItems;
  assert.equal(sent.invoiceItems.length, 1);
  assert.equal(line.description, 'Deposit invoice (50%): Brand film');
  assert.equal(line.price, 2750.51, 'to the cent');
  assert.equal(line.quantity, 1, 'quantity defaults to 1');
  assert.equal(sent.dueDate, '2026-11-11');
  assert.ok(!('invoiceDate' in sent), 'a date left out is left to Hnry');
  assert.equal(fake.total(inv.id), 275051);
});

test('a final adds its extras and a negative "less deposit" line, and the draft sums to the cent', async () => {
  const { fake, hnry } = setup();
  const c = await hnry.findOrCreateClient({ name: 'Acme' });
  const inv = await hnry.createInvoice({ clientId: c.id, poNumber: 'INV-UP-1-F', description: 'Final invoice: Brand film', price: 5000.5 });
  await hnry.addItem({ invoiceId: inv.id, description: 'Extra day', quantity: 1, price: 250.25 });
  await hnry.addItem({ invoiceId: inv.id, description: 'Less deposit (INV-10670001)', price: -2500.25 });
  assert.equal(fake.total(inv.id), 275050, '5000.50 + 250.25 - 2500.25');
});

test('findByPo returns the draft for that client and reference, null for a miss; another client\'s is never adopted', async () => {
  const { hnry } = setup();
  const a = await hnry.findOrCreateClient({ name: 'A' });
  const b = await hnry.findOrCreateClient({ name: 'B' });
  const made = await hnry.createInvoice({ clientId: a.id, poNumber: 'REF-1', description: 'd', price: 10 });
  assert.deepEqual(await hnry.findByPo({ clientId: a.id, poNumber: 'REF-1' }), made);
  assert.equal(await hnry.findByPo({ clientId: a.id, poNumber: 'REF-2' }), null);
  await rejects(hnry.findByPo({ clientId: b.id, poNumber: 'REF-1' }), 'po_in_use');
});

test('findByPo searches by the reference alone, as Hnry\'s reference search takes no client', async () => {
  const { fake, hnry } = setup();
  const a = await hnry.findOrCreateClient({ name: 'A' });
  await hnry.findByPo({ clientId: a.id, poNumber: 'REF-1' });
  assert.deepEqual(fake.calls.at(-1), { name: 'findInvoice', inputs: { queryField: PO_QUERY_FIELD, poNumber: 'REF-1' } });
  assert.equal(PO_QUERY_FIELD, 'PO Number or Reference', 'the option value the SDK lists');
  assert.equal(ACTIONS.findInvoice.action, 'search_invoice');
  assert.equal(ACTIONS.findOrCreateClient.action, 'search_client');
});

/* ── Nothing unclean goes out ─────────────────────────────────────────── */

test('a bad value is refused as bad_input before any call is made', async () => {
  const { fake, hnry } = setup();
  const ok = { clientId: 'c', poNumber: 'P', description: 'd', price: 10 };
  const bad = [
    { ...ok, price: 0 }, { ...ok, price: NaN }, { ...ok, price: '10' }, { ...ok, price: Infinity }, { ...ok, price: 1e7 },
    { ...ok, quantity: 0 }, { ...ok, quantity: -1 }, { ...ok, quantity: '1' },
    { ...ok, poNumber: '  ' }, { ...ok, description: '' }, { ...ok, description: 'x'.repeat(501) }, { ...ok, clientId: '' },
    { ...ok, dueDate: '11/11/2026' }, { ...ok, invoiceDate: '2026-1-1' },
  ];
  for (const b of bad) await rejects(hnry.createInvoice(b), 'bad_input');
  await rejects(hnry.addItem({ invoiceId: 'i', description: 'd', price: 0 }), 'bad_input');
  await rejects(hnry.addItem({ invoiceId: '', description: 'd', price: 5 }), 'bad_input');
  await rejects(hnry.findOrCreateClient({ name: '   ' }), 'bad_input');
  await rejects(hnry.findByPo({ clientId: 'c', poNumber: '' }), 'bad_input');
  assert.equal(fake.calls.length, 0, 'nothing reached Hnry');
});

/* ── Failures ─────────────────────────────────────────────────────────── */

test('a failure reads as timeout or zapier_error, keeps the cause, and never carries the secret', async () => {
  const mk = (message) => createHnry({}, { run: async () => { throw new Error(message); } });
  const input = { clientId: 'c', poNumber: 'P', description: 'd', price: 5 };
  await rejects(mk('ETIMEDOUT connecting').createInvoice(input), 'timeout');
  await rejects(mk('The action timed out after 60s').createInvoice(input), 'timeout');
  // Zapier echoing the secret back is cut out of the message (and `rejects` checks it is gone).
  const echoed = createHnry({ hnry: { clientId: 'client_abcdef', clientSecret: SECRET } },
    { run: async () => { throw new Error(`Bad credentials ${SECRET} for client_abcdef`); } });
  const leak = await echoed.createInvoice(input).catch((e) => e);
  assert.equal(leak.message, 'Bad credentials [redacted] for [redacted]');
  await rejects(echoed.createInvoice(input), 'zapier_error');
  const err = await mk('Hnry says no').createInvoice(input).catch((e) => e);
  assert.equal(err.code, 'zapier_error');
  assert.equal(err.message, 'Hnry says no');
  assert.ok(err.cause instanceof Error);
});

test('an answer with no id and number is unexpected_shape, never a half-saved invoice', async () => {
  const input = { clientId: 'c', poNumber: 'P', description: 'd', price: 5 };
  for (const rows of [[], [{}], [{ id: 'x' }], [{ invoiceNumber: 'INV-1' }], [{ id: 7, invoiceNumber: 'INV-1' }]]) {
    await rejects(createHnry({}, { run: async () => rows }).createInvoice(input), 'unexpected_shape');
  }
  await rejects(createHnry({}, { run: async () => [] }).findOrCreateClient({ name: 'A' }), 'unexpected_shape');
});

test('an answer under Zapier\'s display names reads the same as one under the field names', async () => {
  const labelled = createHnry({}, { run: async () => [{ ID: 'gid1', 'Invoice Number': 'INV-9', Status: 'draft', 'Po Number': 'P' }] });
  assert.deepEqual(await labelled.createInvoice({ clientId: 'c', poNumber: 'P', description: 'd', price: 5 }),
    { id: 'gid1', number: 'INV-9', status: 'DRAFT', poNumber: 'P', clientId: null });
});

test('a search that finds nothing is null whether Zapier says so with no rows or with a halted step', async () => {
  const none = createHnry({}, { run: async () => [] });
  assert.equal(await none.findByPo({ clientId: 'c', poNumber: 'P' }), null);
  const halted = createHnry({}, { run: async () => { throw new Error('Error from halted execution: Nothing could be found for the search.'); } });
  assert.equal(await halted.findByPo({ clientId: 'c', poNumber: 'P' }), null);
  // ...but the same words on a write are a failure, not "none".
  const write = createHnry({}, { run: async () => { throw new Error('Nothing could be found for the search.'); } });
  await rejects(write.createInvoice({ clientId: 'c', poNumber: 'P', description: 'd', price: 5 }), 'zapier_error');
});

/* ── The Zapier transport ─────────────────────────────────────────────── */

function stubSdk(behaviour = {}) {
  const log = { created: [], connections: 0, runs: [] };
  const sdk = {
    async findFirstConnection(args) {
      log.connections += 1;
      log.connectionArgs = args;
      if (behaviour.noConnection) return { data: null };
      return { data: { id: 'conn_1' } };
    },
    async runAction(args) {
      log.runs.push(args);
      if (behaviour.failRuns && behaviour.failRuns > 0) { behaviour.failRuns -= 1; throw new Error('Zapier down'); }
      return { data: behaviour.data === undefined ? [{ id: 'gid', invoiceNumber: 'INV-1', status: 'DRAFT' }] : behaviour.data };
    },
  };
  return { log, importSdk: async () => ({ createZapierSdk: (opts) => { log.created.push(opts); return sdk; } }) };
}

test('the transport signs in with the credentials, finds the Hnry connection once, and runs the action as documented', async () => {
  const { log, importSdk } = stubSdk();
  const hnry = createHnry({}, zapierTransport({ clientId: 'cid', clientSecret: SECRET, timeoutSeconds: 45 }, { importSdk }));
  const input = { clientId: 'c', poNumber: 'P', description: 'd', price: 12.5 };
  await hnry.createInvoice(input);
  await hnry.createInvoice(input);
  assert.deepEqual(log.created, [{ credentials: { clientId: 'cid', clientSecret: SECRET } }], 'one SDK, with the credentials');
  assert.deepEqual(log.connectionArgs, { app: 'hnry', owner: 'me' });
  assert.equal(log.connections, 1, 'the connection is looked up once');
  assert.deepEqual(log.runs[0], {
    app: 'hnry', actionType: ACTIONS.createInvoice.actionType, action: ACTIONS.createInvoice.action, connection: 'conn_1',
    inputs: { clientId: 'c', poNumber: 'P', invoiceItems: [{ description: 'd', quantity: 1, price: 12.5 }] }, timeoutSeconds: 45,
  });
});

test('after a failure the transport starts clean: it signs in and finds the connection again', async () => {
  const stub = stubSdk({ failRuns: 1 });
  const hnry = createHnry({}, zapierTransport({ clientId: 'cid', clientSecret: SECRET }, { importSdk: stub.importSdk }));
  const input = { clientId: 'c', poNumber: 'P', description: 'd', price: 5 };
  await rejects(hnry.createInvoice(input), 'zapier_error');
  await hnry.createInvoice(input);
  assert.equal(stub.log.created.length, 2);
  assert.equal(stub.log.connections, 2);
});

test('no Hnry connection in Zapier is a clear failure; a lone row or no rows are handled', async () => {
  const none = createHnry({}, zapierTransport({ clientId: 'c', clientSecret: SECRET }, { importSdk: stubSdk({ noConnection: true }).importSdk }));
  await rejects(none.findOrCreateClient({ name: 'A' }), 'zapier_error');

  const lone = createHnry({}, zapierTransport({ clientId: 'c', clientSecret: SECRET }, { importSdk: stubSdk({ data: { id: 'g', invoiceNumber: 'INV-2' } }).importSdk }));
  assert.equal((await lone.createInvoice({ clientId: 'c', poNumber: 'P', description: 'd', price: 5 })).number, 'INV-2');

  const empty = createHnry({}, zapierTransport({ clientId: 'c', clientSecret: SECRET }, { importSdk: stubSdk({ data: [] }).importSdk }));
  assert.equal(await empty.findByPo({ clientId: 'c', poNumber: 'P' }), null);
});

/* ── Review fixes (2026-10-22) ────────────────────────────────────────── */

test('findByPo adopts only a draft carrying exactly this reference; a sent one with it is po_in_use', async () => {
  const rowsOf = (rows) => createHnry({}, { run: async () => rows });
  const ask = { clientId: 'c', poNumber: 'INV-X-D' };
  // A search that matched the reference inside a longer one is no match.
  assert.equal(await rowsOf([{ id: 'g2', invoiceNumber: 'INV-2', status: 'DRAFT', poNumber: 'INV-X-D2' }]).findByPo(ask), null);
  // The exact one is found among others, wherever it is in the list.
  const among = await rowsOf([
    { id: 'g2', invoiceNumber: 'INV-2', status: 'DRAFT', poNumber: 'INV-X-D2' },
    { id: 'g1', invoiceNumber: 'INV-1', status: 'DRAFT', poNumber: 'INV-X-D' },
  ]).findByPo(ask);
  assert.equal(among.id, 'g1');
  // No status reads as a draft; no PO is no match.
  assert.equal((await rowsOf([{ id: 'g1', invoiceNumber: 'INV-1', poNumber: 'INV-X-D' }]).findByPo(ask)).id, 'g1');
  assert.equal(await rowsOf([{ id: 'g1', invoiceNumber: 'INV-1', status: 'DRAFT' }]).findByPo(ask), null);
  // Sent or paid in Hnry: never adopted, never added to.
  for (const status of ['SENT', 'PAID']) {
    await rejects(rowsOf([{ id: 'g1', invoiceNumber: 'INV-1', status, poNumber: 'INV-X-D' }]).findByPo(ask), 'po_in_use');
  }
});

test('a call that never answers is a timeout, at twice the action\'s own limit', async () => {
  const hung = createHnry({ hnry: { timeoutSeconds: 0.02 } }, { run: () => new Promise(() => {}) });
  const started = Date.now();
  await rejects(hung.createInvoice({ clientId: 'c', poNumber: 'P', description: 'd', price: 5 }), 'timeout');
  const took = Date.now() - started;
  assert.ok(took >= 35 && took < 1000, `took ${took}ms`);
});

test('a search that finds nothing keeps the transport signed in: no second sign-in or connection lookup', async () => {
  const log = { created: 0, connections: 0 };
  const sdk = {
    async findFirstConnection() { log.connections += 1; return { data: { id: 'conn_1' } }; },
    async runAction(args) {
      if (args.action === ACTIONS.findInvoice.action) throw new Error('Error from halted execution: Nothing could be found for the search.');
      return { data: [{ id: 'gid', invoiceNumber: 'INV-1', status: 'DRAFT' }] };
    },
  };
  const importSdk = async () => ({ createZapierSdk: () => { log.created += 1; return sdk; } });
  const hnry = createHnry({}, zapierTransport({ clientId: 'cid', clientSecret: SECRET }, { importSdk }));
  assert.equal(await hnry.findByPo({ clientId: 'c', poNumber: 'P' }), null);
  await hnry.createInvoice({ clientId: 'c', poNumber: 'P', description: 'd', price: 5 });
  assert.deepEqual(log, { created: 1, connections: 1 });
});

/* ── Settings' connection check (H7) ──────────────────────────────────── */

test('check signs in and looks the Hnry connection up afresh, and runs no Hnry action', async () => {
  const stub = stubSdk();
  const hnry = createHnry({}, zapierTransport({ clientId: 'cid', clientSecret: SECRET }, { importSdk: stub.importSdk }));
  assert.deepEqual(await hnry.check(), { connected: true });
  assert.deepEqual(await hnry.check(), { connected: true });
  assert.equal(stub.log.connections, 2, 'each check looks again: a connection removed in Zapier shows');
  assert.deepEqual(stub.log.runs, [], 'nothing read or made in Hnry');
  assert.deepEqual(stub.log.created, [{ credentials: { clientId: 'cid', clientSecret: SECRET } }]);
});

test('check says why it isn\'t connected, without the secret, and starts clean next time', async () => {
  await rejects(createHnry({}).check(), 'not_configured');
  const none = stubSdk({ noConnection: true });
  await rejects(createHnry({}, zapierTransport({ clientId: 'c', clientSecret: SECRET }, { importSdk: none.importSdk })).check(), 'zapier_error');

  let fail = true;
  let made = 0;
  const importSdk = async () => ({
    createZapierSdk: () => {
      made += 1;
      return { async findFirstConnection() { if (fail) throw new Error(`bad credentials ${SECRET}`); return { data: { id: 'conn_1' } }; } };
    },
  });
  const hnry = createHnry({ hnry: { clientId: 'cid', clientSecret: SECRET } }, zapierTransport({ clientId: 'cid', clientSecret: SECRET }, { importSdk }));
  await rejects(hnry.check(), 'zapier_error');
  fail = false;
  assert.deepEqual(await hnry.check(), { connected: true });
  assert.equal(made, 2, 'a failed check drops the signed-in client');

  const hung = createHnry({ hnry: { timeoutSeconds: 0.02 } }, { run: async () => [], check: () => new Promise(() => {}) });
  await rejects(hung.check(), 'timeout');
  assert.deepEqual(await createHnry({}, { run: async () => [] }).check(), { connected: true }, 'a fake with no check of its own');
});

test('a check that fails while a push is looking Hnry up never takes the connection from under the push', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  let lookups = 0;
  const runs = [];
  const sdk = {
    async findFirstConnection() {
      lookups += 1;
      if (lookups === 1) { await held; return { data: { id: 'conn_1' } }; }
      throw new Error('Zapier down');
    },
    async runAction(args) { runs.push(args); return { data: [{ id: 'gid', invoiceNumber: 'INV-1', status: 'DRAFT' }] }; },
  };
  const importSdk = async () => ({ createZapierSdk: () => sdk });
  const hnry = createHnry({}, zapierTransport({ clientId: 'cid', clientSecret: SECRET }, { importSdk }));
  const push = hnry.createInvoice({ clientId: 'c', poNumber: 'P', description: 'd', price: 5 });
  await new Promise((r) => setImmediate(r));
  const check = hnry.check();
  release();
  await rejects(check, 'zapier_error');
  assert.equal((await push).number, 'INV-1');
  assert.equal(runs[0].connection, 'conn_1');
});

test('the check has its own short deadline, whatever the push limit is', async () => {
  const hnry = createHnry({ hnry: { timeoutSeconds: 600 } }, { run: async () => [], check: () => new Promise(() => {}) });
  const realSetTimeout = global.setTimeout;
  const asked = [];
  global.setTimeout = (fn, ms, ...rest) => { asked.push(ms); return realSetTimeout(fn, 0, ...rest); };
  try {
    await rejects(hnry.check(), 'timeout');
  } finally {
    global.setTimeout = realSetTimeout;
  }
  assert.deepEqual(asked, [15000]);
});
