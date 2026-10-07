import postgres, { type Sql } from "postgres";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

let local: DatabaseSync | undefined;
let remote: Sql | undefined;
export const usesPostgres = () => {
  const mode = process.env.RING_STORAGE;
  if (mode && !["sqlite", "postgres"].includes(mode))
    throw new Error("RING_STORAGE must be sqlite or postgres.");
  return (
    mode === "postgres" ||
    (mode !== "sqlite" && Boolean(process.env.RING_DATABASE_URL))
  );
};

export function pg() {
  if (!remote) {
    const uri = process.env.RING_DATABASE_URL;
    if (!uri) throw new Error("Configure the server-only RING_DATABASE_URL.");
    const url = new URL(uri);
    const isLocal = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      !isLocal &&
      /^(disable|allow|prefer|require|no-verify)$/.test(
        url.searchParams.get("sslmode") || "",
      )
    )
      throw new Error(
        "Remote database connections require certificate verification; remove sslmode or use verify-full.",
      );
    // Explicit TLS verification, small process pool, and no prepared statements
    // so the same adapter works with Supavisor transaction pooling.
    remote = postgres(uri, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: isLocal
        ? false
        : {
            rejectUnauthorized: true,
            ...(process.env.RING_DATABASE_CA
              ? { ca: readFileSync(process.env.RING_DATABASE_CA, "utf8") }
              : {}),
          },
      connection: {
        application_name: "ring",
        statement_timeout: 15000,
        idle_in_transaction_session_timeout: 15000,
      },
      onnotice: () => {},
    });
  }
  return remote;
}

export function sqlite() {
  if (!local) {
    const path = resolve(
      /* turbopackIgnore: true */ process.env.RING_DB_PATH ||
        ".data/ring.sqlite",
    );
    mkdirSync(dirname(path), { recursive: true });
    local = new DatabaseSync(path);
    local.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS ring_state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, intent TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_leases(name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  return local;
}

export async function closeDatabase() {
  if (remote) {
    await remote.end({ timeout: 5 });
    remote = undefined;
  }
  if (local) {
    local.close();
    local = undefined;
  }
}

export async function loadOperation(
  id: string,
): Promise<{ intent: string; body: string } | undefined> {
  if (usesPostgres()) {
    const [row] =
      await pg()`select intent, body::text from ring.operations where id=${id}`;
    return row as { intent: string; body: string } | undefined;
  }
  return sqlite()
    .prepare("SELECT intent,body FROM operations WHERE id=?")
    .get(id) as { intent: string; body: string } | undefined;
}
export async function insertOperation(
  id: string,
  intent: string,
  body: string,
) {
  if (usesPostgres())
    await pg()`insert into ring.operations(id,intent,body) values (${id},${intent},${body}::text::jsonb) on conflict(id) do nothing`;
  else
    sqlite()
      .prepare("INSERT OR IGNORE INTO operations(id,intent,body) VALUES(?,?,?)")
      .run(id, intent, body);
}
export async function updateOperation(
  id: string,
  intent: string,
  body: string,
) {
  if (usesPostgres())
    await pg()`update ring.operations set body=${body}::text::jsonb where id=${id} and intent=${intent}`;
  else
    sqlite()
      .prepare("UPDATE operations SET body=? WHERE id=? AND intent=?")
      .run(body, id, intent);
}
export async function deleteOperation(id: string, signature: string) {
  // Compare the signature as well as the ID: an expired worker cannot delete a replacement.
  if (usesPostgres())
    await pg()`delete from ring.operations where id=${id} and body->>'signature'=${signature} and body->>'status'='signed'`;
  else
    sqlite()
      .prepare(
        "DELETE FROM operations WHERE id=? AND json_extract(body,'$.signature')=? AND json_extract(body,'$.status')='signed'",
      )
      .run(id, signature);
}
export async function putAsset(id: string, mime: string, bytes: Buffer) {
  if (usesPostgres())
    await pg()`insert into ring.assets(id,mime,bytes) values (${id},${mime},${bytes}) on conflict(id) do nothing`;
  else
    sqlite()
      .prepare("INSERT OR IGNORE INTO assets(id,mime,bytes) VALUES(?,?,?)")
      .run(id, mime, bytes);
}
export async function loadAsset(
  id: string,
): Promise<{ mime: string; bytes: Uint8Array } | undefined> {
  if (usesPostgres()) {
    const [row] = await pg()`select mime,bytes from ring.assets where id=${id}`;
    return row as { mime: string; bytes: Uint8Array } | undefined;
  }
  return sqlite()
    .prepare("SELECT mime,bytes FROM assets WHERE id=?")
    .get(id) as { mime: string; bytes: Uint8Array } | undefined;
}
export async function claimLease(
  name: string,
  owner: string,
  milliseconds: number,
) {
  if (usesPostgres()) {
    const rows =
      await pg()`insert into ring.worker_leases(name,owner,expires_at)
      values (${name},${owner},clock_timestamp() + ${milliseconds} * interval '1 millisecond')
      on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at
      where ring.worker_leases.expires_at < clock_timestamp() returning name`;
    return rows.length > 0;
  }
  const now = Date.now();
  return !!sqlite()
    .prepare(
      `INSERT INTO worker_leases(name,owner,expires) VALUES(?,?,?)
    ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE worker_leases.expires < ?`,
    )
    .run(name, owner, now + milliseconds, now).changes;
}
export async function renewLease(
  name: string,
  owner: string,
  milliseconds: number,
) {
  if (usesPostgres()) {
    const rows =
      await pg()`update ring.worker_leases set expires_at=clock_timestamp()+${milliseconds} * interval '1 millisecond'
      where name=${name} and owner=${owner} and expires_at > clock_timestamp() returning name`;
    return rows.length > 0;
  }
  return !!sqlite()
    .prepare(
      "UPDATE worker_leases SET expires=? WHERE name=? AND owner=? AND expires>?",
    )
    .run(Date.now() + milliseconds, name, owner, Date.now()).changes;
}
export async function releaseLease(name: string, owner: string) {
  if (usesPostgres())
    await pg()`delete from ring.worker_leases where name=${name} and owner=${owner}`;
  else
    sqlite()
      .prepare("DELETE FROM worker_leases WHERE name=? AND owner=?")
      .run(name, owner);
}
