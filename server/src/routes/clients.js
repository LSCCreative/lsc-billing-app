'use strict';

const { newId, nowIso } = require('../db');

function loadJson(row) {
  return {
    id: row.id,
    businessName: row.business_name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    abn: row.abn,
    address: row.address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function registerClientRoutes(app, db) {
  // Typeahead: GET /api/clients?q=acme — partial, case-insensitive match on
  // business name. No query = the full list, for the Clients screen.
  app.get('/api/clients', (req, res) => {
    const q = String(req.query.q || '').trim();
    const rows = q
      ? db.prepare(`
          SELECT * FROM clients
          WHERE business_name LIKE ? COLLATE NOCASE
          ORDER BY business_name COLLATE NOCASE LIMIT 20
        `).all(`%${q}%`)
      : db.prepare('SELECT * FROM clients ORDER BY business_name COLLATE NOCASE').all();
    res.json({ ok: true, clients: rows.map(loadJson) });
  });

  app.get('/api/clients/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, client: loadJson(row) });
  });

  // A client's estimate history, for the Clients screen.
  app.get('/api/clients/:id/estimates', (req, res) => {
    const rows = db.prepare(`
      SELECT id, upid, name, date, status, total_inc_gst, updated_at
      FROM estimates WHERE client_id = ? ORDER BY updated_at DESC
    `).all(req.params.id);
    res.json({
      ok: true,
      estimates: rows.map((r) => ({
        id: r.id, upid: r.upid, name: r.name, date: r.date, status: r.status,
        totalIncGst: r.total_inc_gst, updatedAt: r.updated_at,
      })),
    });
  });

  function writeFields(body) {
    return [
      body.businessName || '', body.contactName || '', body.email || '',
      body.phone || '', body.abn || '', body.address || '', body.notes || '',
    ];
  }

  app.post('/api/clients', (req, res) => {
    const body = req.body || {};
    const id = newId('cl');
    const now = nowIso();
    db.prepare(`
      INSERT INTO clients
        (id, business_name, contact_name, email, phone, abn, address, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, ...writeFields(body), now, now);
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    res.status(201).json({ ok: true, client: loadJson(row) });
  });

  app.put('/api/clients/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const now = nowIso();
    db.prepare(`
      UPDATE clients SET
        business_name = ?, contact_name = ?, email = ?, phone = ?, abn = ?,
        address = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(...writeFields(req.body || {}), now, req.params.id);
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    res.json({ ok: true, client: loadJson(row) });
  });

  // Upsert-by-business-name — used when an estimate is saved with a client
  // name that doesn't yet exist in the CRM (the "add to client list" flow).
  // Case-insensitive exact match on business name; anything else is a new row.
  app.post('/api/clients/upsert', (req, res) => {
    const body = req.body || {};
    const name = (body.businessName || '').trim();
    if (!name) return res.status(400).json({ error: 'business_name_required' });

    const existing = db.prepare(
      'SELECT * FROM clients WHERE business_name = ? COLLATE NOCASE'
    ).get(name);
    const now = nowIso();

    if (existing) {
      db.prepare(`
        UPDATE clients SET
          business_name = ?, contact_name = ?, email = ?, phone = ?, abn = ?,
          address = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(...writeFields(body), now, existing.id);
      const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(existing.id);
      return res.json({ ok: true, client: loadJson(row), created: false });
    }

    const id = newId('cl');
    db.prepare(`
      INSERT INTO clients
        (id, business_name, contact_name, email, phone, abn, address, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, ...writeFields(body), now, now);
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    res.status(201).json({ ok: true, client: loadJson(row), created: true });
  });

  app.delete('/api/clients/:id', (req, res) => {
    // FK is ON DELETE SET NULL — estimates keep their client_json snapshot.
    const result = db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });
}

module.exports = { registerClientRoutes };
