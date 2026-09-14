# LSC Billing — server

The NAS-hosted replacement for the Electron app. Node + Express + SQLite in one
Docker container. Runs identically on the Mac today and on the DXP4800 Pro when
it arrives — the only thing that changes is where `DATA_DIR` points.

See `.design/nas-hosted-billing/DESIGN_BRIEF.md` for the why.

## Running it locally

```bash
cp .env.example .env          # then set SESSION_SECRET
npm install
npm run seed                  # creates the one login account
npm start                     # http://localhost:8080
```

Or the way it will actually run in production:

```bash
docker compose up --build
```

Both write to the same place: `./data` on the host, mounted at `/data` inside
the container. Stopping one and starting the other picks up exactly where it
left off.

## Layout

```
src/
  index.js     boot: check config, open the db, listen, shut down cleanly
  app.js       the Express app — route mounting and the auth gate live here
  config.js    environment → config, and the data directories
  db.js        SQLite open + verify + migrations
  auth.js      password hashing, sessions, login throttling, requireAuth
  calc.js      the money model — pure, no I/O
  defaults.js  the starting rate card and settings
scripts/
  seed-account.js
test/          node --test, no test framework to install
data/          created at runtime; billing.db, backups/, exports/ (never committed)
```

## The pieces that carry the risk

**`billing.db` is the system of record.** It is opened with WAL, foreign keys
on, and a `quick_check` at boot. A file that fails that check stops the server
rather than getting written over — the copy in `data/backups/` is the way back,
not a half-repaired database.

**Schema changes go in `src/db.js` as a new migration.** Never edit one that has
already run against a real database; add the next version. `schema_version`
records what has been applied, and the server refuses to open a file written by
a newer build than itself.

**Client details are snapshotted onto estimates.** `estimates.client_json` holds
the client as they were when the estimate was saved. Deleting a client nulls
`client_id` and leaves the estimate — and its PDF — unchanged. That is
deliberate: an invoice sent last year must not change because an address was
updated today.

**Sessions are stored hashed.** The cookie holds a random token; the database
holds its HMAC. `SESSION_SECRET` lives in the environment, not the file, so a
copy of `billing.db` grants nobody a session, and rotating the secret logs
everything out.

**Nothing except `/health` and `/api/login` is reachable without a session.**
The gate is one `app.use('/api', requireAuth(db))` in `app.js`; any route
mounted after that line inherits it. Mount new API routes *below* it.

## Tests

```bash
npm test
```

Covers the money model (including the GST-inclusive split and the corrected
take-home figure), the schema and its guard rails, and the full login /
session / logout / throttle path against a live server on an ephemeral port.
No UI is needed for any of it.

## Not done yet

Estimates, clients, pricing and settings APIs; backups; server-side PDF; the
whole UI port. See `.design/nas-hosted-billing/TASKS.md`.
