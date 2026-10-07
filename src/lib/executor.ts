import { createHmac } from "node:crypto";
import { readStore, transact } from "./store";
import { holdsRing } from "./solana";
// This is a narrow authenticated boundary to a separately deployed token authority.
// It never accepts transaction instructions or a destination URL from a caller.
export async function executeWin(gameId: string) {
  const s = readStore();
  const job = s.executions.find((e) => e.gameId === gameId);
  if (!job || job.status === "applied") return;
  const game = s.games.find((g) => g.id === gameId);
  const p = s.proposals.find((p) => p.id === job.proposalId);
  if (!game || game.status !== "won" || !p) throw new Error("No verified win.");
  if ((await holdsRing(game.wallet)) !== true) {
    transact((s) => {
      s.executions.find((e) => e.id === job.id)!.status = "holding_required";
    });
    return;
  }
  // Apply in win order, so a delayed earlier change cannot overwrite a newer winner.
  if (s.executions.find((e) => e.status !== "applied")?.id !== job.id) return;
  const url = process.env.RING_EXECUTOR_URL,
    secret = process.env.RING_EXECUTOR_SECRET;
  if (!url || !secret) return;
  const target = new URL(url);
  if (target.protocol !== "https:" && target.hostname !== "127.0.0.1")
    throw new Error("The execution adapter must use HTTPS.");
  const payload = JSON.stringify({
    idempotencyKey: job.id,
    gameId,
    proposalId: p.id,
    wallet: game.wallet,
    mint: process.env.RING_TOKEN_MINT,
    action: p.kind,
    value: p.value,
    image: p.image || null,
    timestamp: Date.now(),
  });
  const response = await fetch(target, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "X-Ring-Signature": createHmac("sha256", secret)
        .update(payload)
        .digest("hex"),
      "Idempotency-Key": job.id,
    },
    body: payload,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error("Execution is pending; the win is preserved.");
  const result = await response.json();
  if (
    typeof result.transaction !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(result.transaction)
  )
    throw new Error(
      "The execution adapter must return a Solana transaction signature.",
    );
  // Independently confirm the receipt. The adapter must also enforce the exact mint/action and fresh holding check.
  const rpc = await fetch(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[result.transaction], { searchTransactionHistory: true }],
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  const receipt = (await rpc.json()).result?.value?.[0];
  if (
    !receipt ||
    receipt.err ||
    !["confirmed", "finalized"].includes(receipt.confirmationStatus)
  )
    throw new Error("Waiting for transaction confirmation.");
  transact((s) => {
    const current = s.executions.find((e) => e.id === job.id)!;
    current.status = "applied";
    current.transaction = result.transaction;
    const proposal = s.proposals.find((p) => p.id === job.proposalId)!;
    proposal.status = "applied";
    proposal.transaction = result.transaction;
  });
}
