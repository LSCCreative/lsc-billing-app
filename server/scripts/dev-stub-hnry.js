'use strict';

/**
 * A development server whose Hnry is pretend: the app as `npm start` runs it,
 * but invoices are "made in Hnry" by an in-memory fake (server/test/fake-hnry.js,
 * the one the tests use) instead of through Zapier. For checking the project
 * page's and the invoice page's Hnry states in the browser against a scratch
 * database (launch.json "api-scratch-hnry") without a Zapier credential.
 *
 * A small control server on :8081 puts Hnry in the state you want to look at:
 *
 *   POST /fail {"name":"createInvoice","times":1,"after":0}   the next calls to
 *        that action throw (findOrCreateClient, createInvoice, addItem, findInvoice)
 *   POST /reset                                               forget every draft and failure
 *   GET  /drafts                                              what "Hnry" holds, with each draft's lines
 *
 * Never for the NAS: it would tell the app its invoices are in Hnry when they are not.
 */

const http = require('node:http');
const { config, ensureDataDirs } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createHnry } = require('../src/hnry');
const { fakeHnry } = require('../test/fake-hnry');

ensureDataDirs();
let fake = fakeHnry();
const transport = {
  async run(spec, inputs) {
    console.log(`[stub-hnry] ${spec.name} ${JSON.stringify(inputs)}`);
    return fake.run(spec, inputs);
  },
};
const db = openDatabase(config.dbFile);
const app = createApp(db, { hnry: createHnry({}, transport), appUrl: config.appUrl || 'http://localhost:5173/' });
app.listen(config.port, () => console.log(`[stub-hnry] dev server on :${config.port}; Hnry is pretend (control on :8081)`));

http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body, null, 2)); };
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.method === 'GET' && req.url === '/drafts') {
      return send(200, fake.invoices.map((i) => ({ number: i.invoiceNumber, po: i.poNumber, status: i.status, lines: i.items, total: fake.total(i.id) / 100 })));
    }
    if (req.method === 'POST' && req.url === '/reset') { fake = fakeHnry(); return send(200, { ok: true }); }
    if (req.method === 'POST' && req.url === '/fail') {
      try {
        const b = JSON.parse(raw || '{}');
        fake.fail(b.name, b.times || 1, { after: b.after || 0, message: b.message });
        return send(200, { ok: true, ...b });
      } catch (err) {
        return send(400, { error: 'bad_body' });
      }
    }
    return send(404, { error: 'not_found' });
  });
}).listen(8081, '127.0.0.1');
