"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import bs58 from "bs58";
import type { WalletProvider } from "@/lib/wallet-provider";
import type { FeeClaimStatus } from "@/lib/fee-claims";
import type { FeeClaimReceipt } from "@/lib/fee-claim-service";
import { Card, CardContent, CardHeader } from "./ui/card";

type Pending = {
  id: string;
  signed: string;
  signature: string;
  wallet: string;
};
const key = (wallet: string) => `ring:fee-claim:${wallet}`;
const sol = (lamports: number) =>
  (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 });
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/${path}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The fee service is unavailable. Try again.");
  return data;
}
function saved(wallet: string): Pending | null {
  try {
    return JSON.parse(sessionStorage.getItem(key(wallet)) || "null");
  } catch {
    return null;
  }
}
export default function FeeClaims({
  onAuthenticated,
}: {
  onAuthenticated: () => Promise<void>;
}) {
  const [fees, setFees] = useState<FeeClaimStatus | null>(null);
  const [wallet, setWallet] = useState("");
  const [provider, setProvider] = useState<WalletProvider | null>(null);
  const [claim, setClaim] = useState<FeeClaimReceipt | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const updateFees = useCallback(async () => {
    setFees(await api<FeeClaimStatus>("fees"));
  }, []);
  useEffect(() => {
    void updateFees().catch((e) => setError(e.message));
  }, [updateFees]);

  const receive = useCallback(
    (next: FeeClaimReceipt | null) => {
      const local = wallet ? saved(wallet) : null;
      // A response may have been lost before the server received the signed bytes.
      // Keep them pending locally so retry sends exactly that transaction again.
      if (next?.status === "prepared" && local?.id === next.id) {
        setClaim({ ...next, signature: local.signature, status: "pending" });
      } else {
        setClaim(next);
        if (next && ["finalized", "failed", "expired"].includes(next.status)) {
          try {
            sessionStorage.removeItem(key(next.wallet));
          } catch {}
        }
      }
    },
    [wallet],
  );
  const check = useCallback(async () => {
    const result = await api<{ claim: FeeClaimReceipt | null }>("fees/claim");
    receive(result.claim);
    if (result.claim?.status === "finalized") await updateFees();
  }, [receive, updateFees]);
  useEffect(() => {
    if (claim?.status !== "pending") return;
    const id = setInterval(() => {
      void check().catch(() => {});
    }, 6000);
    return () => clearInterval(id);
  }, [claim?.status, check]);

  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The request could not be completed.",
      );
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function connect(name: "phantom" | "solflare") {
    await run("Connecting wallet…", async () => {
      const next =
        name === "phantom" ? window.phantom?.solana : window.solflare;
      if (!next)
        throw new Error(
          `Open Ring in ${name === "phantom" ? "Phantom" : "Solflare"}'s browser or install its extension.`,
        );
      const connected = (await next.connect()).publicKey.toString();
      if (!fees || connected !== fees.feeClaimer)
        throw new Error(
          "Switch to the fee wallet shown below, then connect again.",
        );
      if (!next.signTransaction)
        throw new Error(
          "This wallet connection cannot sign transactions. Use the Phantom or Solflare browser extension.",
        );
      const challenge = await api<{ id: string; message: string }>(
        "auth/challenge",
        { wallet: connected },
      );
      const signed = await next.signMessage(
        new TextEncoder().encode(challenge.message),
        "utf8",
      );
      await api("auth/verify", {
        id: challenge.id,
        signature: bs58.encode(signed.signature),
      });
      setWallet(connected);
      setProvider(next);
      const current = (
        await api<{ claim: FeeClaimReceipt | null }>("fees/claim")
      ).claim;
      const local = saved(connected);
      setClaim(
        current?.status === "prepared" && local?.id === current.id
          ? { ...current, status: "pending", signature: local.signature }
          : current,
      );
      setNotice(
        "Fee wallet connected. Review the claim before approving a transaction.",
      );
      await onAuthenticated();
    });
  }
  function assertWallet() {
    if (
      !provider ||
      provider.publicKey?.toString() !== wallet ||
      wallet !== fees?.feeClaimer
    )
      throw new Error(
        "Your wallet account changed. Reconnect the authorized fee wallet below.",
      );
  }
  async function review() {
    await run("Preparing claim…", async () => {
      assertWallet();
      receive(
        (await api<{ claim: FeeClaimReceipt }>("fees/prepare", {})).claim,
      );
    });
  }
  async function approve() {
    if (!claim || claim.status !== "prepared") return;
    await run("Approve in your wallet…", async () => {
      assertWallet();
      const latest = (
        await api<{ claim: FeeClaimReceipt | null }>("fees/claim")
      ).claim;
      if (!latest || latest.id !== claim.id || latest.status !== "prepared") {
        receive(latest);
        setNotice(
          "Claim status updated. Review a fresh claim if the previous one expired.",
        );
        return;
      }
      const unsigned = Transaction.from(
        Buffer.from(claim.prepared.transaction, "base64"),
      );
      if (unsigned.feePayer?.toBase58() !== wallet)
        throw new Error("The claim fee payer does not match your wallet.");
      const original = unsigned.serializeMessage();
      const signed = await provider!.signTransaction!(unsigned);
      if (!Buffer.from(signed.serializeMessage()).equals(Buffer.from(original)))
        throw new Error(
          "Your wallet changed the claim transaction. Nothing was submitted. Keep the prepared network fee unchanged and try again.",
        );
      if (!signed.signature)
        throw new Error(
          "Your wallet returned the claim without a signature. Nothing was submitted. Try approving it again.",
        );
      if (!signed.verifySignatures())
        throw new Error(
          "Your wallet's signature could not be verified. Nothing was submitted. Reconnect your wallet and try again.",
        );
      assertWallet();
      const pending: Pending = {
        id: claim.id,
        wallet,
        signed: Buffer.from(signed.serialize()).toString("base64"),
        signature: bs58.encode(signed.signature),
      };
      // Persist before submitting. No new transaction is built on a network error.
      sessionStorage.setItem(key(wallet), JSON.stringify(pending));
      setClaim({ ...claim, status: "pending", signature: pending.signature });
      setBusy("Submitting claim…");
      receive(
        (
          await api<{ claim: FeeClaimReceipt }>("fees/submit", {
            id: pending.id,
            signed: pending.signed,
          })
        ).claim,
      );
    });
  }
  async function retry() {
    if (!claim) return;
    await run("Resending signed claim…", async () => {
      assertWallet();
      const local = saved(wallet);
      receive(
        (
          await api<{ claim: FeeClaimReceipt }>(
            local?.id === claim.id ? "fees/submit" : "fees/retry",
            local?.id === claim.id
              ? { id: claim.id, signed: local.signed }
              : { id: claim.id },
          )
        ).claim,
      );
    });
  }
  const pending = claim?.status === "pending";
  const prepared = claim?.status === "prepared";
  return (
    <section className="fees-page wrap" aria-labelledby="fees-title">
      <div className="fees-heading">
        <p className="eyebrow">RING / OWNER DESK</p>
        <h1 id="fees-title">
          Claim your
          <br />
          <span>fees.</span>
        </h1>
        <p>
          Trading fees belong to your fee wallet. Review the amount, then
          approve the claim in your wallet.
        </p>
      </div>
      <Card className="fees-card">
        <CardHeader>
          <div className="fees-card-top">
            <span>AVAILABLE TO CLAIM</span>
            <button
              className="inline-link"
              disabled={!!busy}
              onClick={() =>
                run("Refreshing…", async () => {
                  await updateFees();
                  if (wallet) await check();
                })
              }
            >
              Refresh
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="fees-amount">
            {fees ? fees.quoteAmount : "—"}
            <span>SOL</span>
          </div>
          {fees && Number(fees.baseAmountRaw) > 0 && (
            <p>Plus {fees.baseAmount} Ring tokens.</p>
          )}
          <p className="fees-caption">Meteora DBC partner trading fees</p>
          {fees?.notice && <p className="fees-caption">{fees.notice}</p>}
          <div className="fees-wallet" id="claim-wallet">
            <span>PAYMENT WALLET</span>
            <a
              href={
                fees
                  ? `https://solscan.io/account/${fees.feeClaimer}`
                  : undefined
              }
              target="_blank"
              rel="noreferrer"
            >
              {fees?.feeClaimer || "Loading fee wallet…"}
            </a>
            <p>
              Only this wallet can approve the claim. You do not need to hold
              Ring to collect your fees.
            </p>
          </div>
          <div className="fees-actions">
            <button
              disabled={!!busy || !fees}
              onClick={() => connect("phantom")}
            >
              Connect Phantom
            </button>
            <button
              disabled={!!busy || !fees}
              onClick={() => connect("solflare")}
            >
              Connect Solflare
            </button>
          </div>
          {wallet && (
            <p className="fees-caption">
              Connected: {wallet.slice(0, 6)}…{wallet.slice(-6)}
            </p>
          )}
          {prepared && (
            <div className="fees-review">
              <h2>Review your claim</h2>
              <dl>
                <div>
                  <dt>Receive</dt>
                  <dd>
                    {claim.prepared.status.quoteAmount} SOL
                    {Number(claim.prepared.status.baseAmountRaw) > 0
                      ? ` + ${claim.prepared.status.baseAmount} Ring`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Estimated network fee</dt>
                  <dd>{sol(claim.prepared.estimatedNetworkFeeLamports)} SOL</dd>
                </div>
                <div>
                  <dt>Account rent needed upfront</dt>
                  <dd>{sol(claim.prepared.rentDepositLamports)} SOL</dd>
                </div>
                <div>
                  <dt>Rent returned in this claim</dt>
                  <dd>{sol(claim.prepared.refundableRentLamports)} SOL</dd>
                </div>
              </dl>
              <p>
                The payment goes to the wallet above. Your liquidity and fee
                rights stay in place.
              </p>
            </div>
          )}
          {pending ? (
            <div className="fees-pending" role="status">
              <h2>Waiting for confirmation</h2>
              <p>
                Your signed claim is saved. Check its status, or resend the same
                transaction without another wallet approval.
              </p>
              <div className="fees-actions">
                <button
                  disabled={!!busy}
                  onClick={() => run("Checking…", check)}
                >
                  Check confirmation
                </button>
                <button disabled={!!busy} onClick={retry}>
                  Resend same claim
                </button>
              </div>
            </div>
          ) : (
            <button
              className="primary-button fees-submit"
              disabled={!!busy || !wallet || (!prepared && !fees?.canClaim)}
              onClick={prepared ? approve : review}
            >
              {busy ||
                (prepared
                  ? "Approve claim in wallet"
                  : fees && !fees.canClaim
                    ? "No fees to claim"
                    : "Review claim")}
            </button>
          )}
          {claim?.status === "finalized" && (
            <p className="fees-success" role="status">
              Claim confirmed. The fees were paid to your wallet.
            </p>
          )}
          {claim?.status === "failed" && (
            <p role="alert">
              The transaction failed on-chain. Refresh and prepare a new claim.
            </p>
          )}
          {claim?.status === "expired" && (
            <p role="status">
              The transaction expired without confirmation. You can prepare a
              new claim.
            </p>
          )}
          {claim?.signature && (
            <a
              className="fees-receipt"
              target="_blank"
              rel="noreferrer"
              href={`https://solscan.io/tx/${claim.signature}`}
            >
              View transaction on Solscan ↗
            </a>
          )}
          {error && (
            <p className="fees-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="fees-caption" role="status">
              {notice}
            </p>
          )}
        </CardContent>
      </Card>
      <div className="fees-details">
        <p>RING TOKEN</p>
        <a
          href={fees ? `https://solscan.io/token/${fees.mint}` : undefined}
          target="_blank"
          rel="noreferrer"
        >
          {fees?.mint || "Loading…"}
        </a>
        <p>
          Claims are separate from the phone game. Trivia winners can change
          token metadata; trading fees stay with the project owner.
        </p>
        {fees && (
          <a
            className="inline-link"
            href={`https://solscan.io/account/${fees.pool}`}
            target="_blank"
            rel="noreferrer"
          >
            View Meteora pool ↗
          </a>
        )}
      </div>
    </section>
  );
}
