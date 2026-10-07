import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { TransactionTransport } from "./operations";

export function chain() {
  return new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "finalized",
  );
}
export function authority() {
  const file = process.env.RING_AUTHORITY_KEYPAIR;
  if (!file)
    throw new Error("Set RING_AUTHORITY_KEYPAIR to the private signer file.");
  const bytes = JSON.parse(readFileSync(file, "utf8"));
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
  )
    throw new Error("Invalid authority keypair file.");
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
export function ringMint() {
  if (!process.env.RING_TOKEN_MINT)
    throw new Error("Configure RING_TOKEN_MINT.");
  return new PublicKey(process.env.RING_TOKEN_MINT);
}
export function transport(connection: Connection): TransactionTransport {
  return {
    async status(signature) {
      const result = (
        await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (!result) return "missing";
      if (result.err) return "failed";
      return result.confirmationStatus === "finalized"
        ? "finalized"
        : "pending";
    },
    finalizedHeight: () => connection.getBlockHeight("finalized"),
    async send(raw) {
      await connection.sendRawTransaction(Buffer.from(raw, "base64"), {
        skipPreflight: false,
        maxRetries: 2,
        preflightCommitment: "finalized",
      });
    },
  };
}
export async function signTransaction(
  connection: Connection,
  signer: Keypair,
  transaction: Transaction,
) {
  const latest = await connection.getLatestBlockhash("finalized");
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);
  return {
    raw: transaction.serialize().toString("base64"),
    signature: bs58.encode(transaction.signature!),
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}
