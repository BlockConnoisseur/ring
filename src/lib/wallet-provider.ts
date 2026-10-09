import type { Transaction } from "@solana/web3.js";

export type WalletProvider = {
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(
    message: Uint8Array,
    encoding?: string,
  ): Promise<{ signature: Uint8Array }>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  disconnect?: () => Promise<void>;
};
declare global {
  interface Window {
    phantom?: { solana?: WalletProvider };
    solflare?: WalletProvider;
  }
}
