import { randomUUID } from "node:crypto";
import { buildFeeClaimTransaction, type PreparedFeeClaim } from "./fee-claims";
import { checkFeeClaimStatus, validateSignedClaim } from "./fee-claim-relay";
import { chain } from "./chain";
import { acquireLease } from "./operations";
import { readStore, transact } from "./store";
import { rateLimit } from "./game";

export type FeeClaimRecord = {
  id: string;
  wallet: string;
  prepared: PreparedFeeClaim;
  createdAt: number;
  signature?: string;
  signed?: string;
  terminal?: "finalized" | "failed";
};
export type FeeClaimReceipt = {
  id: string;
  wallet: string;
  prepared: PreparedFeeClaim;
  signature?: string;
  status: "prepared" | "pending" | "finalized" | "failed" | "expired";
};
async function receipt(record: FeeClaimRecord): Promise<FeeClaimReceipt> {
  const connection = chain();
  const status =
    record.terminal ||
    (record.signature
      ? await checkFeeClaimStatus(connection, {
          signature: record.signature,
          lastValidBlockHeight: record.prepared.lastValidBlockHeight,
        })
      : (await connection.getBlockHeight("finalized")) >
          record.prepared.lastValidBlockHeight
        ? "expired"
        : "prepared");
  if (!record.terminal && (status === "finalized" || status === "failed")) {
    await transact((s) => {
      const stored = s.feeClaims?.[record.wallet];
      if (stored?.id === record.id && stored.signature === record.signature)
        stored.terminal = status;
    });
  }
  return {
    id: record.id,
    wallet: record.wallet,
    prepared: record.prepared,
    signature: record.signature,
    status,
  };
}
export async function latestFeeClaim(wallet: string) {
  const record = (await readStore()).feeClaims?.[wallet];
  return record ? receipt(record) : null;
}
export async function prepareFeeClaim(wallet: string) {
  const lease = await acquireLease(`fee-claim:${wallet}`, 60000);
  if (!lease)
    throw new Error(
      "A claim is already being prepared. Check its status in a moment.",
    );
  try {
    const existing = await latestFeeClaim(wallet);
    if (
      existing &&
      (existing.status === "pending" || existing.status === "prepared")
    )
      return existing;
    await transact((s) =>
      rateLimit(s, `fee-prepare:${wallet}`, Date.now(), 5, 60000),
    );
    const prepared = await buildFeeClaimTransaction(wallet);
    await lease.renew();
    const record: FeeClaimRecord = {
      id: randomUUID(),
      wallet,
      prepared,
      createdAt: Date.now(),
    };
    await transact((s) => {
      s.feeClaims ??= {};
      s.feeClaims[wallet] = record;
    });
    return { id: record.id, wallet, prepared, status: "prepared" as const };
  } finally {
    await lease.release();
  }
}
export async function submitFeeClaim(
  wallet: string,
  id: string,
  signed: string,
) {
  const before = (await readStore()).feeClaims?.[wallet];
  if (!before || before.id !== id)
    throw new Error(
      "Claim preparation expired. Check the latest claim status.",
    );
  const validated = validateSignedClaim(
    before.prepared.transaction,
    signed,
    wallet,
  );
  // Save the exact signature and bytes before any network send. A dropped HTTP
  // response can then be recovered across refreshes and Vercel instances.
  const record = await transact((s) => {
    const current = s.feeClaims?.[wallet];
    if (!current || current.id !== id)
      throw new Error("Claim preparation changed.");
    if (current.signature && current.signature !== validated.signature)
      throw new Error("A different signature is already pending.");
    current.signature = validated.signature;
    current.signed = validated.raw;
    return current;
  });
  const current = await receipt(record);
  if (current.status !== "pending") return current;
  try {
    await chain().sendRawTransaction(Buffer.from(record.signed!, "base64"), {
      skipPreflight: false,
      maxRetries: 2,
      preflightCommitment: "confirmed",
    });
  } catch {
    // Ambiguous RPC failures are never labelled as a failed transaction. The
    // user can check confirmation or resend these same bytes, without signing again.
  }
  return current;
}
export async function retryFeeClaim(wallet: string, id: string) {
  const record = (await readStore()).feeClaims?.[wallet];
  if (!record || record.id !== id || !record.signed)
    throw new Error("No signed claim is available to resend.");
  return submitFeeClaim(wallet, id, record.signed);
}
