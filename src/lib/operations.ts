import { randomUUID } from "node:crypto";
import { db } from "./store";
import { hash } from "./game";

export type SignedOperation = {
  raw: string;
  signature: string;
  lastValidBlockHeight: number;
  status: "signed" | "finalized";
};
export interface TransactionTransport {
  status(
    signature: string,
  ): Promise<"missing" | "pending" | "finalized" | "failed">;
  finalizedHeight(): Promise<number>;
  send(raw: string): Promise<void>;
}
export function operation(id: string) {
  const row = db()
    .prepare("SELECT intent,body FROM operations WHERE id=?")
    .get(id) as { intent: string; body: string } | undefined;
  return (
    row && { intent: row.intent, ...(JSON.parse(row.body) as SignedOperation) }
  );
}
// Persist signed bytes BEFORE broadcasting. After a crash, resend precisely those bytes.
// Never replace a still-valid or processed transaction, even when an RPC times out.
export async function runOperation(
  id: string,
  intent: unknown,
  transport: TransactionTransport,
  build: () => Promise<Omit<SignedOperation, "status">>,
) {
  const digest = hash(JSON.stringify(intent));
  let current = operation(id);
  if (current && current.intent !== digest)
    throw new Error("Operation intent changed.");
  if (current?.status === "finalized") return current.signature;
  if (current) {
    let status = await transport.status(current.signature);
    if (status === "failed")
      throw new Error(`Transaction failed: ${current.signature}`);
    if (status === "finalized") {
      db()
        .prepare("UPDATE operations SET body=? WHERE id=? AND intent=?")
        .run(JSON.stringify({ ...current, status: "finalized" }), id, digest);
      return current.signature;
    }
    if (
      status === "missing" &&
      (await transport.finalizedHeight()) > current.lastValidBlockHeight
    ) {
      // Check history again AFTER the finalized height proves expiry.
      status = await transport.status(current.signature);
      if (status === "missing") {
        db()
          .prepare("DELETE FROM operations WHERE id=? AND body=?")
          .run(
            id,
            JSON.stringify({
              raw: current.raw,
              signature: current.signature,
              lastValidBlockHeight: current.lastValidBlockHeight,
              status: "signed",
            }),
          );
        current = operation(id);
      }
    }
  }
  if (!current) {
    const signed = await build();
    db()
      .prepare("INSERT OR IGNORE INTO operations(id,intent,body) VALUES(?,?,?)")
      .run(id, digest, JSON.stringify({ ...signed, status: "signed" }));
    current = operation(id)!;
    if (current.intent !== digest) throw new Error("Operation intent changed.");
  }
  await transport.send(current.raw);
  return null; // Only a later finalized receipt applies the proposal.
}

export function acquireLease(name: string, milliseconds = 120_000) {
  const owner = randomUUID();
  const now = Date.now();
  const result = db()
    .prepare(
      `INSERT INTO worker_leases(name,owner,expires) VALUES(?,?,?)
    ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires=excluded.expires
    WHERE worker_leases.expires < ?`,
    )
    .run(name, owner, now + milliseconds, now);
  if (!result.changes) return null;
  return {
    renew() {
      if (
        !db()
          .prepare(
            "UPDATE worker_leases SET expires=? WHERE name=? AND owner=?",
          )
          .run(Date.now() + milliseconds, name, owner).changes
      )
        throw new Error("Worker lease lost.");
    },
    release() {
      db()
        .prepare("DELETE FROM worker_leases WHERE name=? AND owner=?")
        .run(name, owner);
    },
  };
}
