import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { TransactionTransport } from "./operations";
import type { Authority } from "./signer";
export { authority } from "./signer";

export function chain() {
  return new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "finalized",
  );
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
  signer: Authority,
  transaction: Transaction,
) {
  const latest = await connection.getLatestBlockhash("finalized");
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  const message = Buffer.from(transaction.serializeMessage());
  const signed = await signer.signTransaction(transaction);
  if (!message.equals(Buffer.from(signed.serializeMessage())))
    throw new Error("Signer changed the transaction message.");
  if (
    !signed.feePayer?.equals(signer.publicKey) ||
    !signed.signature ||
    !signed.verifySignatures()
  )
    throw new Error("Signer returned an invalid transaction signature.");
  return {
    raw: signed.serialize().toString("base64"),
    signature: bs58.encode(signed.signature),
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}
