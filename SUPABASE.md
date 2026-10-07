# Supabase deployment

Ring supports Supabase Postgres for shared durable storage. Wallet authentication remains in Ring: the browser signs a nonce and receives an HttpOnly session. The website and workers connect to Postgres from the server. No database password or privileged Supabase key belongs in the browser.

## Cloud setup status

The adapter and migration are implemented and tested against isolated PostgreSQL 17. No Supabase project has been created or changed yet. Project selection and any project cost must be confirmed before cloud provisioning.

## Provision once

1. Create/select the intended project. Apply `supabase/migrations/20261007181502_ring_private_backend.sql` using the Supabase migration tool or linked CLI. This creates only the private `ring` schema and the `ring_backend` group role. Leave `ring` out of the Data API exposed schemas.
2. Create a dedicated database login with a strong generated password and membership in `ring_backend`. The group grants only the required table operations; assets cannot be updated or deleted by the app. Do not run the app as `postgres` or with a service-role key.

```sql
-- Replace the placeholder through a private administrator connection.
create role ring_runtime login password '<generated-secret>'
  nosuperuser nocreatedb nocreaterole inherit connection limit 20;
grant ring_backend to ring_runtime;
```

3. Copy the actual Postgres connection URI from the project's **Connect** dialog. Use `ring_runtime` as the direct-connection username, or `ring_runtime.<project-ref>` with the project's actual Supavisor pooler host. Keep the password URL-encoded. Use the pooler's transaction mode for independently hosted web instances. Ring disables prepared statements and uses at most three connections per process. Verify the project's connection limits before increasing replicas.
4. Store the connection in each server/worker environment:

```dotenv
RING_STORAGE=postgres
RING_DATABASE_URL=<private connection URI>
```

TLS certificate verification is required for remote databases. If the direct database host requires its project CA, download the certificate from Supabase database settings and set `RING_DATABASE_CA` to that local PEM path. Mount the same file in containers when applicable. Do not disable verification. Setting `RING_STORAGE=postgres` with a missing URL fails instead of silently creating a local database.

5. Import the existing local data before starting the cloud-backed website/workers, or run `npm run questions:sync` for a new empty project. Verify with `npm run doctor`. Missing token/phone credentials will still be reported separately. Run Supabase's security and performance advisors after applying the schema.

## Copy existing SQLite data

Drain the queue and stop **all** Ring web/worker processes, including old deployments. Keep a backup of `.data/ring.sqlite` and its WAL or use SQLite's backup facility. Configure the Supabase environment, then run:

```sh
npm run db:migrate-sqlite -- .data/ring.sqlite
npm run db:migrate-sqlite -- .data/ring.sqlite --apply
```

The first command previews counts without writing. The second copies into an empty destination in one transaction. It preserves proposals, wallet sessions, cooldowns, retired questions, fee policy, signed transaction bytes and image/metadata assets. It refuses an occupied destination or an active worker lease. Stale worker readiness timestamps and leases are not imported. The source database is opened read-only and retained. Do not run writers during cutover.

After import, every process must use the same Postgres project. Never run the old SQLite workers alongside the new deployment: they would have different question and execution histories. Preserve `RING_ASSET_ORIGIN` so existing token image and metadata URLs keep working. Once new writes begin, rollback requires migrating that new state; switching back to an old SQLite snapshot is unsafe.

## Storage and hosting

- `ring.state`: the atomic game-state document, including private answers, sessions, proposals, queue, cooldowns, wins and execution state. A row lock serializes transitions for Ring's single active contestant. Network and chain calls happen outside this lock.
- `ring.operations`: transaction intent hashes and signed bytes, written before broadcast and retained for recovery.
- `ring.assets`: immutable images and token metadata, keyed by content hash and served by `/api/assets/…`.
- `ring.worker_leases`: database-clock ownership for the voice, question and execution workers.

All four tables have RLS and server-only policies. `anon` and `authenticated` receive no schema/table privileges. Do not grant public read access to the state document: it contains correct answers and authentication state. Use Ring's filtered API for the public board.

The site can run separately from the workers when using Postgres. The voice worker still needs a persistent process with public HTTPS/WebSocket access for Twilio; moving storage does not make the voice host a serverless function. Its lease prevents a second worker from voiding a live call during startup. Keep one voice worker active. Schedule backups/PITR appropriate to the selected Supabase plan, and retain a recoverable copy of images and transaction journals.

The document model deliberately preserves the existing game engine and transaction boundary. Large forum histories or a high-volume public launch may need normalized forum/session tables to avoid rewriting an expanding state document. This version is designed for a single active phone line, not unlimited parallel contestants.

## Tests

`npm test` uses temporary SQLite databases, regardless of production environment variables. To exercise the Postgres implementation, provision a disposable local PostgreSQL database named `ring_test`, set `RING_TEST_DATABASE_URL` to its administrator URI, and run `npm run test:postgres`. The suite refuses remote hosts and refuses an existing `ring` schema. It applies the real migration, tests a restricted app login, and removes its temporary schema afterward.

Coverage includes concurrent transitions, transaction rollback, duplicate phone callbacks, disjoint question sets, lease takeover, persisted transaction recovery, immutable assets, SQLite cutover, schema grants and anonymous RLS isolation. No test connects to the cloud project or moves funds.

References: [Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
