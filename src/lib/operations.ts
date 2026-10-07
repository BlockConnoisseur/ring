import { randomUUID } from "node:crypto";
import {
  loadOperation,
  insertOperation,
  updateOperation,
  deleteOperation,
  claimLease,
  renewLease,
  releaseLease,
} from "./database";
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
export async function operation(id: string) {
  const row = await loadOperation(id);
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
  let current = await operation(id);
  if (current && current.intent !== digest)
    throw new Error("Operation intent changed.");
  if (current?.status === "finalized") return current.signature;
  if (current) {
    let status = await transport.status(current.signature);
    if (status === "failed")
      throw new Error(`Transaction failed: ${current.signature}`);
    if (status === "finalized") {
      await updateOperation(
        id,
        digest,
        JSON.stringify({ ...current, status: "finalized" }),
      );
      return current.signature;
    }
    if (
      status === "missing" &&
      (await transport.finalizedHeight()) > current.lastValidBlockHeight
    ) {
      // Check history again AFTER the finalized height proves expiry.
      status = await transport.status(current.signature);
      if (status === "missing") {
        await deleteOperation(id, current.signature);
        current = await operation(id);
      }
    }
  }
  if (!current) {
    const signed = await build();
    await insertOperation(
      id,
      digest,
      JSON.stringify({ ...signed, status: "signed" }),
    );
    current = (await operation(id))!;
    if (current.intent !== digest) throw new Error("Operation intent changed.");
  }
  await transport.send(current.raw);
  return null; // Only a later finalized receipt applies the proposal.
}

export async function acquireLease(name: string, milliseconds = 120_000) {
  const owner = randomUUID();
  if (!(await claimLease(name, owner, milliseconds))) return null;
  return {
    async renew() {
      if (!(await renewLease(name, owner, milliseconds)))
        throw new Error("Worker lease lost.");
    },
    async release() {
      await releaseLease(name, owner);
    },
  };
}
