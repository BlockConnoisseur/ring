import type { ProposalKind } from "./types";

// Shared by publishing and execution; byte limits match Metaplex metadata.
export function validateProposalValue(kind: ProposalKind, input: string) {
  if (kind === "fees")
    throw new Error(
      "Fee routing is fixed to the project owner's wallet and cannot be changed by a proposal.",
    );
  const value = input.trim();
  if (
    kind === "name" &&
    (!value || Buffer.byteLength(value) > 32 || /[\x00-\x1f\x7f]/.test(value))
  )
    throw new Error(
      "Use a coin name between 1 and 32 UTF-8 bytes, without control characters.",
    );
  if (kind === "symbol" && !/^[A-Za-z0-9]{1,10}$/.test(value))
    throw new Error(
      "Use 1–10 letters or numbers for the ticker, without a dollar sign.",
    );
  if (kind === "description" && (value.length < 5 || value.length > 500))
    throw new Error("Write a description between 5 and 500 characters.");
  if (kind === "website") {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Enter a full HTTPS website link.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      value.length > 500
    )
      throw new Error(
        "Enter a full HTTPS website link without embedded credentials.",
      );
  }
  return value;
}
