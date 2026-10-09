import { readStore, transact } from "./store";
import { holdsRing } from "./solana";
import {
  authority,
  chain,
  ringMint,
  signTransaction,
  transport,
} from "./chain";
import { acquireLease, operation, runOperation } from "./operations";
import { metadataTransaction, verifyMetadataAuthority } from "./token-metadata";
import { bindMint, type Store } from "./game";
import { validateProposalValue } from "./proposal-value";

let signingCheck: { key: string; expiresAt: number } | undefined;

export function applyExecution(s: Store, gameId: string, signature: string) {
  const job = s.executions.find((e) => e.gameId === gameId);
  const game = s.games.find((g) => g.id === gameId);
  if (!job || !game || game.status !== "won")
    throw new Error("No verified win.");
  const proposal = s.proposals.find((p) => p.id === job.proposalId);
  if (!proposal || proposal.wallet !== game.wallet)
    throw new Error("No verified proposal.");
  // Also reject legacy fee requests already present in the execution queue.
  validateProposalValue(proposal.kind, proposal.value);
  if (job.status === "applied") return;
  job.status = "applied";
  job.transaction = signature;
  delete job.error;
  proposal.status = "applied";
  proposal.transaction = signature;
}

export async function executorTick() {
  if (process.env.RING_LIVE !== "true") return;
  const lease = await acquireLease("executor");
  if (!lease) return;
  let leaseLost = false;
  const renew = setInterval(async () => {
    try {
      await lease.renew();
    } catch {
      leaseLost = true;
    }
  }, 30_000);
  const guard = async () => {
    if (leaseLost) throw new Error("Worker lease lost.");
    await lease.renew();
  };
  try {
    const connection = chain(),
      signer = authority(),
      rpc = transport(connection);
    const mint = ringMint().toBase58();
    const readinessTransaction = await verifyMetadataAuthority(
      connection,
      signer,
    );
    if ((await connection.getBalance(signer.publicKey)) < 10_000_000)
      throw new Error(
        "Ring metadata signer needs at least 0.01 SOL for transaction fees.",
      );
    const signingKey = `${mint}:${signer.publicKey.toBase58()}`;
    if (
      signingCheck?.key !== signingKey ||
      signingCheck.expiresAt <= Date.now()
    ) {
      // Prove the runtime user can sign the exact metadata instruction shape.
      // This no-op readiness transaction is never broadcast or queued.
      await signTransaction(connection, signer, readinessTransaction);
      signingCheck = { key: signingKey, expiresAt: Date.now() + 600_000 };
    }
    await guard();
    await transact((s) => {
      bindMint(s, mint);
      s.worker = { heartbeat: Date.now() };
    });
    const state = await readStore();
    const job = state.executions.find((e) => e.status !== "applied");
    if (!job) return;
    const game = state.games.find((g) => g.id === job.gameId);
    const proposal = state.proposals.find((p) => p.id === job.proposalId);
    if (
      !game ||
      game.status !== "won" ||
      !proposal ||
      proposal.wallet !== game.wallet
    )
      throw new Error("No verified win.");
    validateProposalValue(proposal.kind, proposal.value);
    // Recover signed operations even if holdings change after signing.
    if (!(await operation(job.id)) && (await holdsRing(game.wallet)) !== true) {
      await guard();
      await transact((s) => {
        s.executions.find((e) => e.id === job.id)!.status = "holding_required";
      });
      return;
    }
    const intent = {
      mint,
      id: proposal.id,
      wallet: proposal.wallet,
      kind: proposal.kind,
      value: proposal.value,
      image: proposal.image,
    };
    const signature = await runOperation(job.id, intent, rpc, async () => {
      const tx = await metadataTransaction(connection, signer, proposal);
      if ((await holdsRing(game.wallet)) !== true)
        throw new Error("Winner must still hold Ring before signing.");
      await guard();
      return signTransaction(connection, signer, tx);
    });
    if (signature) {
      await guard();
      await transact((s) => applyExecution(s, job.gameId, signature));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Execution failed.";
    if (!leaseLost)
      await transact((s) => {
        s.worker = { heartbeat: Date.now(), error: message };
        const job = s.executions.find((e) => e.status !== "applied");
        if (job) job.error = message;
      });
    throw error;
  } finally {
    clearInterval(renew);
    await lease.release();
  }
}
