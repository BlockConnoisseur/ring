import { emptyStore, expireQueue, type Store } from "./game";
import { pg, sqlite, usesPostgres } from "./database";

function localState(): Store {
  const db = sqlite();
  db.prepare("INSERT OR IGNORE INTO ring_state(id,body) VALUES(1,?)").run(
    JSON.stringify(emptyStore()),
  );
  return JSON.parse(
    (
      db.prepare("SELECT body FROM ring_state WHERE id=1").get() as {
        body: string;
      }
    ).body,
  );
}
export async function readStore(): Promise<Store> {
  if (!usesPostgres()) return localState();
  const sql = pg();
  const [row] = await sql`select body from ring.state where id=1`;
  if (row) return row.body as Store;
  await sql`insert into ring.state(id,body) values (1,${JSON.stringify(emptyStore())}::text::jsonb) on conflict(id) do nothing`;
  const [created] = await sql`select body from ring.state where id=1`;
  return created.body as Store;
}
function mutate<T>(state: Store, fn: (s: Store) => T) {
  expireQueue(state);
  const result = fn(state);
  if (result && typeof (result as { then?: unknown }).then === "function")
    throw new Error(
      "Store transactions must be synchronous; perform network calls outside the lock.",
    );
  return result;
}
export async function transact<T>(fn: (s: Store) => T): Promise<T> {
  if (usesPostgres()) {
    const sql = pg();
    // Row locking preserves atomic question reservation, target increments,
    // cooldowns and queue order across separately hosted workers.
    const result = await sql.begin(async (tx) => {
      await tx`insert into ring.state(id,body) values (1,${JSON.stringify(emptyStore())}::text::jsonb) on conflict(id) do nothing`;
      const [row] = await tx`select body from ring.state where id=1 for update`;
      const state = row.body as Store,
        result = mutate(state, fn);
      await tx`update ring.state set body=${JSON.stringify(state)}::text::jsonb,updated_at=clock_timestamp() where id=1`;
      return { value: result };
    });
    return result.value;
  }
  const db = sqlite();
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = localState(),
      result = mutate(state, fn);
    db.prepare("UPDATE ring_state SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
