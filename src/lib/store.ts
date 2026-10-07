import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { emptyStore, expireQueue, type Store } from "./game";
let connection: DatabaseSync | undefined;
export function db() {
  if (!connection) {
    const path = resolve(
      /* turbopackIgnore: true */ process.env.RING_DB_PATH ||
        ".data/ring.sqlite",
    );
    mkdirSync(dirname(path), { recursive: true });
    connection = new DatabaseSync(path);
    connection.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS ring_state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);",
    );
    connection.exec(`
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, intent TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_leases(name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
    `);
    connection
      .prepare("INSERT OR IGNORE INTO ring_state(id,body) VALUES(1,?)")
      .run(JSON.stringify(emptyStore()));
  }
  return connection;
}
export function readStore(): Store {
  return JSON.parse(
    (
      db().prepare("SELECT body FROM ring_state WHERE id=1").get() as {
        body: string;
      }
    ).body,
  );
}
export function transact<T>(fn: (s: Store) => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const s = readStore();
    expireQueue(s);
    const result = fn(s);
    d.prepare("UPDATE ring_state SET body=? WHERE id=1").run(JSON.stringify(s));
    d.exec("COMMIT");
    return result;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
