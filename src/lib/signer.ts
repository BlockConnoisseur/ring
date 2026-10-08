import { readFileSync } from "node:fs";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Turnkey } from "@turnkey/sdk-server";
import { TurnkeySigner } from "@turnkey/solana";
import { signerProvider, signerVariables } from "./signer-config";

export type Authority = {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
};

export function turnkeyAuthority(
  address: string,
  remote: Pick<TurnkeySigner, "signTransaction">,
): Authority {
  const publicKey = new PublicKey(address);
  return {
    publicKey,
    async signTransaction(transaction) {
      // Use Turnkey's parsed transaction endpoint so Solana policies can inspect it.
      // Never use raw-payload signing or Turnkey's broadcast endpoint.
      const signed = await remote.signTransaction(
        transaction,
        publicKey.toBase58(),
      );
      if (!(signed instanceof Transaction))
        throw new Error("Unexpected Turnkey transaction format.");
      return signed;
    },
  };
}

export function authority(): Authority {
  for (const variable of signerVariables())
    if (!process.env[variable])
      throw new Error(`Configure ${variable} for the Ring signer.`);
  if (signerProvider() === "turnkey") {
    const organizationId = process.env.TURNKEY_ORGANIZATION_ID!;
    const sdk = new Turnkey({
      apiBaseUrl: "https://api.turnkey.com",
      defaultOrganizationId: organizationId,
      apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
      apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    });
    return turnkeyAuthority(
      process.env.TURNKEY_SIGNER_ADDRESS!,
      new TurnkeySigner({ organizationId, client: sdk.apiClient() }),
    );
  }
  const bytes = JSON.parse(
    readFileSync(process.env.RING_AUTHORITY_KEYPAIR!, "utf8"),
  );
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
  )
    throw new Error("Invalid authority keypair file.");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  return {
    publicKey: keypair.publicKey,
    async signTransaction(transaction) {
      transaction.sign(keypair);
      return transaction;
    },
  };
}
