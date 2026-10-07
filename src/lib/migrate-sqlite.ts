import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { emptyStore, type Store } from "./game";
import { pg, usesPostgres } from "./database";

export async function migrateSqlite(file: string, apply = false) {
  if (!usesPostgres())
    throw new Error(
      "Select RING_STORAGE=postgres and configure RING_DATABASE_URL first.",
    );
  const source = new DatabaseSync(resolve(file), { readOnly: true });
  let state: Store;
  let operations: { id: string; intent: string; body: string }[];
  let assets: { id: string; mime: string; bytes: Uint8Array }[];
  try {
    source.exec("BEGIN");
    const row = source
      .prepare("SELECT body FROM ring_state WHERE id=1")
      .get() as { body: string } | undefined;
    if (!row)
      throw new Error(
        "Source has no Ring state. Start Ring locally before migrating.",
      );
    state = JSON.parse(row.body);
    operations = source
      .prepare("SELECT id,intent,body FROM operations")
      .all() as typeof operations;
    assets = source
      .prepare("SELECT id,mime,bytes FROM assets")
      .all() as typeof assets;
    source.exec("COMMIT");
  } finally {
    source.close();
  }
  if (
    state.games.some((g) => g.status === "playing") ||
    state.queue.some((q) => q.status !== "done" && q.expiresAt > Date.now())
  )
    throw new Error(
      "Drain the local call queue and stop all Ring processes before migrating.",
    );
  const summary = {
    questions: state.questions.length,
    retired: state.questions.filter((q) => q.used).length,
    proposals: state.proposals.length,
    operations: operations.length,
    assets: assets.length,
    applied: apply,
  };
  if (!apply) return summary;
  const sql = pg();
  await sql.begin(async (tx) => {
    await tx`insert into ring.state(id,body) values(1,${JSON.stringify(emptyStore())}::text::jsonb) on conflict(id) do nothing`;
    const [current] =
      await tx`select body from ring.state where id=1 for update`;
    const [counts] = await tx`select
      (select count(*)::int from ring.operations) as operations,
      (select count(*)::int from ring.assets) as assets,
      (select count(*)::int from ring.worker_leases where expires_at > clock_timestamp()) as leases`;
    if (
      !isDeepStrictEqual(current.body, emptyStore()) ||
      counts.operations ||
      counts.assets ||
      counts.leases
    )
      throw new Error(
        "Destination is not empty or a worker is running. Nothing was imported.",
      );
    // Preserve retired questions, cooldowns and transaction journals; remove only stale readiness signals.
    delete state.voiceHeartbeat;
    delete state.worker;
    for (const row of operations)
      await tx`insert into ring.operations(id,intent,body) values(${row.id},${row.intent},${row.body}::text::jsonb)`;
    for (const row of assets)
      await tx`insert into ring.assets(id,mime,bytes) values(${row.id},${row.mime},${Buffer.from(row.bytes)})`;
    await tx`update ring.state set body=${JSON.stringify(state)}::text::jsonb,updated_at=clock_timestamp() where id=1`;
  });
  return summary;
}
