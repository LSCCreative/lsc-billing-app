'use strict';

/**
 * Hnry, through Zapier (hnry-invoicing H1). This is the ONLY file that knows
 * Zapier exists: everything else asks `createHnry(...)` for a client, an invoice
 * or a line, so if Zapier's SDK stops being free (it is "free during early
 * access") the transport below is the one thing that changes.
 *
 * What Hnry can do here is what Zapier's Hnry app exposes, no more (read
 * 2026-10-22 from the Zap editor, see the brief):
 *   - Create Invoice: ONE line (description, quantity, price). Always a DRAFT:
 *     the user sends it from Hnry. No GST, no comments, no send, no card toggle
 *     (card payment is on by default in Hnry).
 *   - Add Item to Existing Invoice: one more line, onto a draft.
 *   - Find Invoice: by client or by PO/reference; sees drafts.
 *   - Find or Create Client: by name.
 *   There is no trigger and no "paid" signal, so paid stays manual.
 *
 * A call returns a small plain object or throws an HnryError with a short
 * `code` the screens can turn into words:
 *   not_configured  no credentials (Hnry "isn't set up"; never thrown at boot)
 *   bad_input       something we were about to send is not a clean value
 *   timeout         Hnry/Zapier took longer than config.hnry.timeoutSeconds (the
 *                   action itself), or twice that for the whole call (signing
 *                   in and finding the connection included): a call never hangs
 *   zapier_error    Zapier or Hnry refused or failed
 *   unexpected_shape  it answered, but not with an id and an invoice number
 *   po_in_use       findByPo: Hnry holds this reference on an invoice that is no
 *                   longer a draft, so it is neither adopted nor made again
 * Nothing here retries and nothing here logs a credential: the caller decides.
 *
 * THE ACTION TABLE is the part to verify against the real account (H9): the
 * input names are the ones the Zap editor showed, but the `action` keys and
 * `actionType` strings are the SDK's, and `findByPo`'s `queryField` value is
 * the option id the editor listed ("PO Number or Reference").
 */

class HnryError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'HnryError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

const ACTIONS = {
  findOrCreateClient: { name: 'findOrCreateClient', actionType: 'search_or_write', action: 'find_or_create_client' },
  createInvoice: { name: 'createInvoice', actionType: 'write', action: 'create_invoice' },
  addItem: { name: 'addItem', actionType: 'write', action: 'add_item_to_existing_invoice' },
  findInvoice: { name: 'findInvoice', actionType: 'search', action: 'find_invoice' },
};

const PO_QUERY_FIELD = 'PO Number or Reference';

/* ── Clean values ─────────────────────────────────────────────────────── */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function text(value, what, max) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new HnryError('bad_input', `${what} is empty.`);
  if (s.length > max) throw new HnryError('bad_input', `${what} is too long.`);
  return s;
}

/* A price in dollars: a finite number, to the cent. Negative is allowed (a
   "less deposit" line); zero is not, because a $0 line is a mistake. */
function money(value, what) {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) >= 1e7) {
    throw new HnryError('bad_input', `${what} is not a usable amount.`);
  }
  return round2(n);
}

function qty(value) {
  const n = value === undefined ? 1 : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n >= 1e6) {
    throw new HnryError('bad_input', 'The quantity is not usable.');
  }
  return n;
}

function ymd(value, what) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HnryError('bad_input', `${what} must be YYYY-MM-DD.`);
  }
  return value;
}

/* ── Reading what Zapier hands back ───────────────────────────────────── */

/* The first of these keys that holds a value. Zapier returns Hnry's fields
   under their own names, and a display label ("Invoice Number") in some
   views, so every field is read by a short list rather than one spelling. */
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

function toInvoice(raw) {
  const id = pick(raw, ['id', 'ID', 'Id', 'invoiceId', 'invoice_id']);
  const number = pick(raw, ['invoiceNumber', 'Invoice Number', 'invoice_number', 'number']);
  if (typeof id !== 'string' || typeof number !== 'string') {
    throw new HnryError('unexpected_shape', 'Hnry answered without an invoice id and number.');
  }
  const poNumber = pick(raw, ['poNumber', 'Po Number', 'PO Number', 'po_number']);
  const status = pick(raw, ['status', 'Status']);
  return {
    id,
    number,
    status: typeof status === 'string' ? status.toUpperCase() : null,
    poNumber: typeof poNumber === 'string' ? poNumber : null,
  };
}

function toClient(raw) {
  const id = pick(raw, ['id', 'ID', 'Id', 'clientId', 'client_id']);
  const name = pick(raw, ['name', 'Name', 'clientName', 'Client Name']);
  if (typeof id !== 'string') throw new HnryError('unexpected_shape', 'Hnry answered without a client id.');
  return { id, name: typeof name === 'string' ? name : null };
}

/* A search that found nothing comes back either as no rows or as a halted
   step, depending on the SDK; both mean "none". */
const NOTHING_FOUND = /nothing could be found|no results|not found/i;

/* ── The Zapier transport ─────────────────────────────────────────────── */

/**
 * `run(spec, inputs)` resolves to the action's rows (an array). The SDK is an
 * ES module, so it is imported on first use: nothing loads, and nothing can
 * fail, until a Hnry call is actually made. `deps.importSdk` is for tests.
 */
function zapierTransport(cfg, deps = {}) {
  let sdk = null;
  let connection = null;
  const importSdk = deps.importSdk || (() => import('@zapier/zapier-sdk'));

  async function client() {
    if (!sdk) {
      const mod = await importSdk();
      sdk = mod.createZapierSdk({ credentials: { clientId: cfg.clientId, clientSecret: cfg.clientSecret } });
    }
    return sdk;
  }

  return {
    async run(spec, inputs) {
      try {
        const zapier = await client();
        if (!connection) {
          const found = await zapier.findFirstConnection({ app: 'hnry', owner: 'me' });
          connection = found && found.data;
          if (!connection || !connection.id) throw new Error('No Hnry connection in Zapier.');
        }
        const out = await zapier.runAction({
          app: 'hnry',
          actionType: spec.actionType,
          action: spec.action,
          connection: connection.id,
          inputs,
          timeoutSeconds: cfg.timeoutSeconds || 60,
        });
        const rows = out && out.data;
        return Array.isArray(rows) ? rows : (rows ? [rows] : []);
      } catch (err) {
        // A stale connection or a half-made client must not stick: start clean next
        // time. A search that found nothing is an answer, not a failure: keep both,
        // or every first push would sign in and look the connection up twice.
        if (!NOTHING_FOUND.test(String((err && err.message) || ''))) {
          sdk = null;
          connection = null;
        }
        throw err;
      }
    },
  };
}

/* ── The Hnry client ──────────────────────────────────────────────────── */

/**
 * @param {object} config  `config.hnry`: { clientId, clientSecret, timeoutSeconds }
 * @param {object} [transport]  `{ run(spec, inputs) -> rows[] }`; tests pass a fake.
 *   Omitted, the Zapier transport is used when both credentials are set.
 */
function createHnry(config = {}, transport) {
  const cfg = config.hnry || config;
  const impl = transport || (cfg.clientId && cfg.clientSecret ? zapierTransport(cfg) : null);
  const enabled = Boolean(impl);
  // The longest one whole call may take: twice the action's own limit, since
  // signing in and finding the connection come first and have none of their
  // own. Past it the call is a timeout, so a push (and the Retry that shares
  // it) always finishes, whatever the SDK does.
  const seconds = Number(cfg.timeoutSeconds) > 0 ? Number(cfg.timeoutSeconds) : 60;
  const callLimitMs = seconds * 2000;

  async function call(spec, inputs) {
    if (!impl) throw new HnryError('not_configured', 'Hnry isn’t set up on this server.');
    let timer = null;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new HnryError('timeout', 'Hnry took too long to answer.')), callLimitMs);
    });
    try {
      return await Promise.race([impl.run(spec, inputs), deadline]);
    } catch (err) {
      if (err instanceof HnryError) throw err;
      let msg = err && err.message ? String(err.message) : 'Hnry failed.';
      // Whatever Zapier echoes back, the credentials are never kept or shown.
      for (const secret of [cfg.clientSecret, cfg.clientId]) {
        if (secret && secret.length >= 6) msg = msg.split(secret).join('[redacted]');
      }
      if (NOTHING_FOUND.test(msg) && spec.name === 'findInvoice') return [];
      if (/time(d)?\s*out|timeout|ETIMEDOUT|aborted/i.test(msg)) {
        throw new HnryError('timeout', 'Hnry took too long to answer.', err);
      }
      // The reason, never a credential: only the message is kept.
      throw new HnryError('zapier_error', msg.slice(0, 300), err);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    enabled,

    /** The Hnry client for this name, made if there isn't one. Resolves { id, name }. */
    async findOrCreateClient({ name, email } = {}) {
      const inputs = { name: text(name, 'The client name', 200) };
      if (email) inputs.email = text(email, 'The client email', 320);
      const rows = await call(ACTIONS.findOrCreateClient, inputs);
      if (!rows.length) throw new HnryError('unexpected_shape', 'Hnry returned no client.');
      return toClient(rows[0]);
    },

    /**
     * A DRAFT invoice with one line. `price` is the line's amount in dollars
     * (ex GST: Hnry adds none for an unregistered user). Resolves { id, number,
     * status, poNumber }.
     */
    async createInvoice({ clientId, invoiceDate, dueDate, poNumber, description, quantity, price } = {}) {
      const inputs = {
        clientId: text(clientId, 'The Hnry client', 200),
        poNumber: text(poNumber, 'The reference', 100),
        description: text(description, 'The description', 500),
        quantity: qty(quantity),
        price: money(price, 'The price'),
      };
      const inv = ymd(invoiceDate, 'The invoice date');
      const due = ymd(dueDate, 'The due date');
      if (inv) inputs.invoiceDate = inv;
      if (due) inputs.dueDate = due;
      const rows = await call(ACTIONS.createInvoice, inputs);
      if (!rows.length) throw new HnryError('unexpected_shape', 'Hnry returned no invoice.');
      return toInvoice(rows[0]);
    },

    /** One more line on a draft. A negative price is a deduction. Resolves { ok: true }. */
    async addItem({ invoiceId, description, quantity, price } = {}) {
      const inputs = {
        invoiceId: text(invoiceId, 'The Hnry invoice', 200),
        description: text(description, 'The description', 500),
        quantity: qty(quantity),
        price: money(price, 'The price'),
      };
      await call(ACTIONS.addItem, inputs);
      return { ok: true };
    },

    /**
     * The DRAFT carrying exactly this reference for this client, or null. What
     * the search hands back is checked, not trusted: a row whose PO is another
     * reference (a search that matches "INV-X-D" inside "INV-X-D2") is no match,
     * and one with this reference that Hnry has sent or paid is never adopted
     * and lines added to it: that is `po_in_use`. A row with no status is read as
     * a draft (the search sees drafts only, so far); one with no PO is no match,
     * so the worst a missing field can do is make a second draft, never touch
     * the wrong invoice.
     */
    async findByPo({ clientId, poNumber } = {}) {
      const want = text(poNumber, 'The reference', 100);
      const rows = await call(ACTIONS.findInvoice, {
        queryField: PO_QUERY_FIELD,
        clientId: text(clientId, 'The Hnry client', 200),
        poNumber: want,
      });
      const same = rows.map(toInvoice).filter((i) => i.poNumber !== null && i.poNumber.trim() === want);
      const draft = same.find((i) => i.status === null || i.status === 'DRAFT');
      if (draft) return draft;
      if (same.length) {
        throw new HnryError('po_in_use', `Hnry already has an invoice for ${want} that is no longer a draft, so it isn’t made again.`);
      }
      return null;
    },
  };
}

module.exports = { createHnry, zapierTransport, HnryError, ACTIONS, PO_QUERY_FIELD };
