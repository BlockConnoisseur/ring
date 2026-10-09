import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

function transactionFromBase64(value: string) {
  // A Solana wire transaction must fit in one 1,232-byte packet.
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 1644 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid claim transaction encoding.");
  const raw = Buffer.from(value, "base64");
  if (raw.length > 1232 || raw.toString("base64") !== value)
    throw new Error("Invalid claim transaction encoding.");
  try {
    return Transaction.from(raw);
  } catch {
    throw new Error("Invalid legacy claim transaction.");
  }
}

/** Verify a wallet signed exactly the transaction prepared by the server. */
export function validateSignedClaim(
  expectedUnsignedBase64: string,
  signedBase64: string,
  wallet: string | PublicKey,
): { raw: string; signature: string } {
  const owner = new PublicKey(wallet);
  const expected = transactionFromBase64(expectedUnsignedBase64);
  const signed = transactionFromBase64(signedBase64);
  if (!expected.feePayer?.equals(owner) || !signed.feePayer?.equals(owner))
    throw new Error("Claim transaction has the wrong fee payer.");
  if (!expected.serializeMessage().equals(signed.serializeMessage()))
    throw new Error("The signed claim transaction message changed.");
  if (!signed.signature || !signed.verifySignatures())
    throw new Error("Claim transaction signature is missing or invalid.");
  const raw = signed.serialize().toString("base64");
  if (raw !== signedBase64)
    throw new Error("Invalid claim transaction serialization.");
  return { raw, signature: bs58.encode(signed.signature) };
}

export type FeeClaimStatus = "pending" | "finalized" | "failed" | "expired";

type SignatureStatus = {
  err: unknown;
  confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
};

export interface FeeClaimStatusConnection {
  getSignatureStatuses(
    signatures: string[],
    config: { searchTransactionHistory: true },
  ): Promise<{ value: (SignatureStatus | null)[] }>;
  getBlockHeight(commitment: "finalized"): Promise<number>;
}

function receiptStatus(status: SignatureStatus): FeeClaimStatus {
  // Even an error can be on a fork. Do not allow replacement until finality.
  if (status.confirmationStatus !== "finalized") return "pending";
  return status.err != null ? "failed" : "finalized";
}

/** A timeout or a processed receipt never proves a transaction expired. */
export async function checkFeeClaimStatus(
  connection: FeeClaimStatusConnection,
  claim: { signature: string; lastValidBlockHeight: number },
): Promise<FeeClaimStatus> {
  if (
    !Number.isSafeInteger(claim.lastValidBlockHeight) ||
    claim.lastValidBlockHeight < 0
  )
    throw new Error("Invalid claim transaction expiry.");
  if (bs58.decode(claim.signature).length !== 64)
    throw new Error("Invalid claim transaction signature.");
  const readStatus = async () => {
    const result = await connection.getSignatureStatuses([claim.signature], {
      searchTransactionHistory: true,
    });
    if (result.value.length !== 1 || result.value[0] === undefined)
      throw new Error("Claim transaction status is unavailable.");
    return result.value[0];
  };
  const initial = await readStatus();
  if (initial) return receiptStatus(initial);
  const height = await connection.getBlockHeight("finalized");
  if (!Number.isSafeInteger(height) || height < 0)
    throw new Error("Finalized block height is unavailable.");
  if (height <= claim.lastValidBlockHeight) return "pending";
  // Read history again after finalized height proves that the blockhash expired.
  const final = await readStatus();
  return final ? receiptStatus(final) : "expired";
}
