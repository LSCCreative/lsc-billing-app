'use strict';

/**
 * A stand-in for Hnry behind `hnry.js` (hnry-invoicing H1), used by every test
 * that pushes an invoice (H3, H4, H5). It behaves the way the real account did
 * on 2026-10-22/23: Create Invoice makes a DRAFT with one line (sent in
 * `invoiceItems`) and a Hnry number, Add Item adds a line to a draft, Find
 * Invoice by reference takes no client, sees drafts only and names each row's
 * client, Find or Create Client matches by name.
 *
 *   const fake = fakeHnry();
 *   const hnry = createHnry({}, fake);
 *   fake.fail('createInvoice', 1)        // the next createInvoice throws once
 *   fake.fail('addItem', 1, { after: 2 }) // ...or after two good addItem calls
 *   fake.fail('check', 1)                 // Settings' connection check fails once (H7)
 *   fake.calls                            // every call, in order: { name, inputs }
 *   fake.total(invoiceId)                 // the sum of that draft's lines, in cents
 *   const release = fake.hold()           // every call waits (Hnry "slow") until release()
 */
function fakeHnry() {
  const clients = [];
  const invoices = [];
  const calls = [];
  const failures = [];
  let nextClient = 1;
  let nextNumber = 10670000;
  const counts = {};
  let gate = null;

  const gid = (kind, n) => Buffer.from(`gid://hnry/${kind}/${n}`).toString('base64');

  function maybeFail(name) {
    counts[name] = (counts[name] || 0) + 1;
    const f = failures.find((x) => x.name === name && x.times > 0 && counts[name] > (x.after || 0));
    if (f) {
      f.times -= 1;
      throw new Error(f.message || 'Zapier error: simulated failure');
    }
  }

  return {
    calls,
    clients,
    invoices,

    /** Make the next `times` calls to `name` throw (after `opts.after` good ones). */
    fail(name, times = 1, opts = {}) {
      failures.push({ name, times, after: opts.after || 0, message: opts.message });
    },

    /** Hold every call until the returned function is called. */
    hold() {
      let release;
      gate = new Promise((resolve) => { release = resolve; });
      return () => { gate = null; release(); };
    },

    total(invoiceId) {
      const inv = invoices.find((i) => i.id === invoiceId);
      if (!inv) throw new Error('no such draft');
      return inv.items.reduce((s, it) => s + Math.round(it.price * 100) * it.quantity, 0);
    },

    /** Settings' connection check (H7): fails like any action, by the name 'check'. */
    async check() {
      calls.push({ name: 'check', inputs: {} });
      if (gate) await gate;
      maybeFail('check');
    },

    async run(spec, inputs) {
      calls.push({ name: spec.name, inputs: { ...inputs } });
      if (gate) await gate;
      maybeFail(spec.name);
      switch (spec.name) {
        case 'findOrCreateClient': {
          let c = clients.find((x) => x.name.toLowerCase() === inputs.name.toLowerCase());
          if (!c) {
            c = { id: gid('Client', nextClient++), name: inputs.name, email: inputs.email || null };
            clients.push(c);
          }
          return [{ id: c.id, name: c.name, email: c.email }];
        }
        case 'createInvoice': {
          if (!clients.some((c) => c.id === inputs.clientId)) throw new Error('Unknown client');
          const line = (inputs.invoiceItems || [])[0];
          if (!line || inputs.description !== undefined) throw new Error('Create Invoice takes its line in invoiceItems');
          const n = nextNumber++;
          const inv = {
            id: gid('Invoice', n),
            clientId: inputs.clientId,
            invoiceNumber: `INV-${n}`,
            status: 'DRAFT',
            poNumber: inputs.poNumber || '',
            items: [{ description: line.description, quantity: line.quantity, price: line.price }],
          };
          invoices.push(inv);
          const c = clients.find((x) => x.id === inv.clientId);
          return [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, poNumber: inv.poNumber, client: { id: c.id, name: c.name } }];
        }
        case 'addItem': {
          const inv = invoices.find((i) => i.id === inputs.invoiceId);
          if (!inv) throw new Error('Unknown invoice');
          if (inv.status !== 'DRAFT') throw new Error('Only a draft takes items');
          inv.items.push({ description: inputs.description, quantity: inputs.quantity, price: inputs.price });
          return [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status }];
        }
        case 'findInvoice': {
          // As the real search by "PO Number or Reference" (2026-10-23): the
          // reference only, no client; drafts only; each row names its client.
          if (inputs.clientId !== undefined) throw new Error('A reference search takes no client');
          return invoices
            .filter((i) => i.poNumber === inputs.poNumber && i.status === 'DRAFT')
            .map((i) => {
              const c = clients.find((x) => x.id === i.clientId);
              return { id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, poNumber: i.poNumber, client: { id: i.clientId, name: c ? c.name : null } };
            });
        }
        default:
          throw new Error(`unknown action ${spec.name}`);
      }
    },
  };
}

module.exports = { fakeHnry };
