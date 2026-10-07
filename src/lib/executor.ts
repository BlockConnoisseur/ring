import { randomUUID } from "node:crypto";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
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
import { metadataTransaction } from "./token-metadata";
import { feeSources, claimTransaction } from "./meteora";
import { bindMint, type FeeCycle, type Store } from "./game";

const memoProgram = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
export function feeMemo(
  signer: PublicKey,
  mint: string,
  proposalId: string,
  recipient: string,
) {
  return new Transaction().add(
    new TransactionInstruction({
      programId: memoProgram,
      keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
      data: Buffer.from(
        JSON.stringify({
          ring: 1,
          mint,
          proposal: proposalId,
          creatorFeeRecipient: recipient,
          policy: "until-next-winner",
        }),
      ),
    }),
  );
}

export function applyExecution(
  s: Store,
  gameId: string,
  signature: string,
  now = Date.now(),
) {
  const job = s.executions.find((e) => e.gameId === gameId),
    game = s.games.find((g) => g.id === gameId);
  if (!job || !game || game.status !== "won")
    throw new Error("No verified win.");
  if (job.status === "applied") return;
  const p = s.proposals.find((p) => p.id === job.proposalId)!;
  if (p.kind === "fees") {
    if (!s.fees) throw new Error("Fee policy is not initialized.");
    s.fees.recipient = p.value;
    s.fees.since = now;
    s.fees.proposalId = p.id;
  }
  job.status = "applied";
  job.transaction = signature;
  delete job.error;
  p.status = "applied";
  p.transaction = signature;
}

export async function executorTick() {
  if (process.env.RING_LIVE !== "true") return;
  const lease = acquireLease("executor");
  if (!lease) return;
  let leaseLost = false;
  const renew = setInterval(() => {
    try {
      lease.renew();
    } catch {
      leaseLost = true;
    }
  }, 30_000);
  const guard = () => {
    if (leaseLost) throw new Error("Worker lease lost.");
    lease.renew();
  };
  try {
    const connection = chain(),
      signer = authority(),
      rpc = transport(connection);
    const mint = ringMint().toBase58();
    const initial = new PublicKey(
      process.env.RING_INITIAL_FEE_RECIPIENT || "",
    ).toBase58();
    transact((s) => {
      bindMint(s, mint);
      s.fees ??= {
        recipient: initial,
        since: Date.now(),
        lastClaimAt: 0,
        receipts: [],
      };
      s.worker = { heartbeat: Date.now() };
    });
    async function settle(
      cycle: FeeCycle,
      save: (s: Store, c: FeeCycle) => void,
    ) {
      for (let index = 0; index < cycle.sources.length; index++) {
        guard();
        const source = cycle.sources[index],
          id = `${cycle.id}:${index}`;
        if (cycle.completed[id]) continue;
        const tx = operation(id)
          ? undefined
          : await claimTransaction(
              connection,
              signer.publicKey,
              new PublicKey(cycle.recipient),
              source,
            );
        if (tx === null) {
          cycle.completed[id] = "empty";
          guard();
          transact((s) => save(s, cycle));
          continue;
        }
        const signature = await runOperation(
          id,
          { mint, source, recipient: cycle.recipient },
          rpc,
          async () => {
            const built =
              tx ||
              (await claimTransaction(
                connection,
                signer.publicKey,
                new PublicKey(cycle.recipient),
                source,
              ));
            guard();
            return signTransaction(
              connection,
              signer,
              built ||
                feeMemo(signer.publicKey, mint, cycle.id, cycle.recipient),
            );
          },
        );
        if (!signature) return false;
        cycle.completed[id] = signature;
        guard();
        transact((s) => {
          save(s, cycle);
          if (!s.fees!.receipts.some((r) => r.transaction === signature))
            s.fees!.receipts.push({
              recipient: cycle.recipient,
              transaction: signature,
              at: Date.now(),
            });
        });
      }
      return true;
    }
    // Finish an already-signed payout before considering a recipient change.
    let state = readStore();
    if (state.fees!.cycle) {
      if (
        !(await settle(state.fees!.cycle, (s, c) => {
          s.fees!.cycle = c;
        }))
      )
        return;
      guard();
      transact((s) => {
        delete s.fees!.cycle;
        s.fees!.lastClaimAt = Date.now();
      });
    }
    state = readStore();
    const job = state.executions.find((e) => e.status !== "applied");
    if (job) {
      const game = state.games.find((g) => g.id === job.gameId),
        proposal = state.proposals.find((p) => p.id === job.proposalId);
      if (
        !game ||
        game.status !== "won" ||
        !proposal ||
        proposal.wallet !== game.wallet
      )
        throw new Error("No verified win.");
      // Recover signed operations even if holdings change after signing.
      if (!operation(job.id) && (await holdsRing(game.wallet)) !== true) {
        guard();
        transact((s) => {
          s.executions.find((e) => e.id === job.id)!.status =
            "holding_required";
        });
        return;
      }
      if (proposal.kind === "fees" && !operation(job.id)) {
        if (!job.settlement) {
          job.settlement = {
            id: `settle:${job.id}`,
            recipient: state.fees!.recipient,
            sources: await feeSources(connection, signer.publicKey),
            completed: {},
            createdAt: Date.now(),
          };
          guard();
          transact((s) => {
            s.executions.find((e) => e.id === job.id)!.settlement =
              job.settlement;
          });
        }
        if (
          !(await settle(job.settlement, (s, c) => {
            s.executions.find((e) => e.id === job.id)!.settlement = c;
          }))
        )
          return;
      }
      guard();
      // Exclude mutable display fields (comment count/status) from the intent hash.
      const intent = {
        mint,
        id: proposal.id,
        wallet: proposal.wallet,
        kind: proposal.kind,
        value: proposal.value,
        image: proposal.image,
      };
      const signature = await runOperation(job.id, intent, rpc, async () => {
        const tx =
          proposal.kind === "fees"
            ? feeMemo(signer.publicKey, mint, proposal.id, proposal.value)
            : await metadataTransaction(connection, signer, proposal);
        if ((await holdsRing(game.wallet)) !== true)
          throw new Error("Winner must still hold Ring before signing.");
        guard();
        return signTransaction(connection, signer, tx);
      });
      if (signature) {
        guard();
        transact((s) => applyExecution(s, job.gameId, signature));
      }
      return;
    }
    state = readStore();
    if (Date.now() - state.fees!.lastClaimAt >= 60_000) {
      const cycle: FeeCycle = {
        id: `payout:${randomUUID()}`,
        recipient: state.fees!.recipient,
        sources: await feeSources(connection, signer.publicKey),
        completed: {},
        createdAt: Date.now(),
      };
      guard();
      transact((s) => {
        s.fees!.cycle = cycle;
      });
      if (
        await settle(cycle, (s, c) => {
          s.fees!.cycle = c;
        })
      ) {
        guard();
        transact((s) => {
          delete s.fees!.cycle;
          s.fees!.lastClaimAt = Date.now();
        });
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Execution failed.";
    if (!leaseLost)
      transact((s) => {
        s.worker = { heartbeat: Date.now(), error: message };
        const job = s.executions.find((e) => e.status !== "applied");
        if (job) job.error = message;
      });
    throw error;
  } finally {
    clearInterval(renew);
    lease.release();
  }
}
