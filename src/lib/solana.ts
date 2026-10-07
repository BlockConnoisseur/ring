import bs58 from "bs58";
export function validWallet(value: string) {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}
export async function holdsRing(wallet: string): Promise<boolean | null> {
  const mint = process.env.RING_TOKEN_MINT;
  if (!mint) return null;
  if (!validWallet(wallet) || !validWallet(mint))
    throw new Error("The token or wallet address is invalid.");
  const res = await fetch(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          wallet,
          { mint },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ],
      }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    },
  );
  if (!res.ok)
    throw new Error("The holding check is unavailable. Please try again.");
  const data = await res.json();
  if (data.error || !Array.isArray(data.result?.value))
    throw new Error("The holding check is unavailable. Please try again.");
  return data.result.value.some(
    (entry: {
      account: {
        data: {
          parsed: {
            info: {
              mint: string;
              owner: string;
              tokenAmount: { amount: string };
            };
          };
        };
      };
    }) => {
      const info = entry.account.data.parsed.info;
      return (
        info.mint === mint &&
        info.owner === wallet &&
        /^\d+$/.test(info.tokenAmount.amount) &&
        BigInt(info.tokenAmount.amount) > 0n
      );
    },
  );
}
export async function requireHolding(wallet: string) {
  if ((await holdsRing(wallet)) !== true)
    throw new Error(
      "This wallet must hold a positive amount of Ring to continue.",
    );
}
