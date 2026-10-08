export function signerProvider() {
  const provider = process.env.RING_SIGNER || "keypair";
  if (provider !== "turnkey" && provider !== "keypair")
    throw new Error("RING_SIGNER must be turnkey or keypair.");
  return provider;
}

export function signerVariables() {
  return signerProvider() === "turnkey"
    ? [
        "TURNKEY_ORGANIZATION_ID",
        "TURNKEY_API_PUBLIC_KEY",
        "TURNKEY_API_PRIVATE_KEY",
        "TURNKEY_SIGNER_ADDRESS",
      ]
    : ["RING_AUTHORITY_KEYPAIR"];
}

// The public app needs the authority address, not the executor's API credential.
export function signerSelected() {
  try {
    return signerProvider() === "turnkey"
      ? Boolean(process.env.TURNKEY_SIGNER_ADDRESS)
      : Boolean(process.env.RING_AUTHORITY_KEYPAIR);
  } catch {
    return false;
  }
}
