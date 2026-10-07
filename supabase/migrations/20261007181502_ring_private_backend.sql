-- Server-only state. Wallet clients use the authenticated Ring API, never this schema.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ring_backend') then
    create role ring_backend nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;

create schema ring;
revoke all on schema ring from public, anon, authenticated;
grant usage on schema ring to ring_backend;

-- Ring admits one contestant at a time. A row lock makes the game-state
-- transition atomic across API, phone, question and execution workers.
create table ring.state (
  id smallint primary key check (id = 1),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  updated_at timestamptz not null default clock_timestamp()
);
create table ring.operations (
  id text primary key,
  intent text not null,
  body jsonb not null check (jsonb_typeof(body) = 'object')
);
create table ring.assets (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  mime text not null check (mime in ('image/png','image/jpeg','image/webp','application/json')),
  bytes bytea not null check (octet_length(bytes) <= 2097152)
);
create table ring.worker_leases (
  name text primary key,
  owner text not null,
  expires_at timestamptz not null
);

alter table ring.state enable row level security;
alter table ring.operations enable row level security;
alter table ring.assets enable row level security;
alter table ring.worker_leases enable row level security;
revoke all on all tables in schema ring from public, anon, authenticated;

grant select, insert, update on ring.state to ring_backend;
grant select, insert, update, delete on ring.operations, ring.worker_leases to ring_backend;
grant select, insert on ring.assets to ring_backend;

create policy backend_state on ring.state to ring_backend using (true) with check (true);
create policy backend_operations on ring.operations to ring_backend using (true) with check (true);
create policy backend_assets on ring.assets to ring_backend using (true) with check (true);
create policy backend_leases on ring.worker_leases to ring_backend using (true) with check (true);

comment on schema ring is 'Private Ring backend. Do not expose through the Data API.';
comment on table ring.assets is 'Immutable content-addressed token images and metadata; served through Ring API.';
comment on table ring.operations is 'Signed transactions persisted before broadcast for crash-safe recovery.';
