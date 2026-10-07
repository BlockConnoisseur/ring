import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  StateService,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { claimTransaction } from "../src/lib/meteora";

test("DBC builder pays only creator trading fees directly to recipient ATAs, without unwrap or authority transfers", async () => {
  const owner = Keypair.generate().publicKey,
    recipient = Keypair.generate().publicKey,
    mint = Keypair.generate().publicKey,
    pool = Keypair.generate().publicKey;
  process.env.RING_TOKEN_MINT = mint.toBase58();
  process.env.RING_DBC_POOL = pool.toBase58();
  const originalPool = StateService.prototype.getPool,
    originalConfig = StateService.prototype.getPoolConfig;
  StateService.prototype.getPool = async () =>
    ({
      poolState: {
        baseMint: mint,
        creator: owner,
        config: Keypair.generate().publicKey,
        creatorBaseFee: new BN(2),
        creatorQuoteFee: new BN(3),
        baseVault: Keypair.generate().publicKey,
        quoteVault: Keypair.generate().publicKey,
      },
    }) as Awaited<ReturnType<typeof originalPool>>;
  StateService.prototype.getPoolConfig = async () =>
    ({ tokenType: 0, quoteTokenFlag: 0, quoteMint: NATIVE_MINT }) as Awaited<
      ReturnType<typeof originalConfig>
    >;
  try {
    const tx = await claimTransaction(
      new Connection("http://127.0.0.1:8899"),
      owner,
      recipient,
      { kind: "dbc", pool: pool.toBase58() },
    );
    assert.ok(tx);
    assert.equal(tx.instructions.length, 3);
    assert.ok(tx.instructions[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    assert.ok(tx.instructions[1].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    const claim = tx.instructions[2];
    assert.ok(claim.programId.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID));
    for (const token of [mint, NATIVE_MINT])
      assert.ok(
        claim.keys.some((k) =>
          k.pubkey.equals(
            getAssociatedTokenAddressSync(
              token,
              recipient,
              true,
              TOKEN_PROGRAM_ID,
            ),
          ),
        ),
      );
    assert.deepEqual(
      claim.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()),
      [owner.toBase58()],
    );
    assert.ok(
      tx.instructions.every((ix) => !ix.programId.equals(TOKEN_PROGRAM_ID)),
      "no token transfer/close instructions",
    );
    await assert.rejects(
      claimTransaction(
        new Connection("http://127.0.0.1:8899"),
        owner,
        recipient,
        { kind: "dbc", pool: PublicKey.default.toBase58() },
      ),
      /Unconfigured/,
    );
    await assert.rejects(
      claimTransaction(
        new Connection("http://127.0.0.1:8899"),
        recipient,
        recipient,
        { kind: "dbc", pool: pool.toBase58() },
      ),
      /authority/,
    );
  } finally {
    StateService.prototype.getPool = originalPool;
    StateService.prototype.getPoolConfig = originalConfig;
  }
});

test("DAMM v2 builder directs owned position fees to the recipient without removing liquidity", async () => {
  const owner = Keypair.generate().publicKey,
    recipient = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey,
    pool = Keypair.generate().publicKey,
    position = Keypair.generate().publicKey;
  process.env.RING_TOKEN_MINT = mint.toBase58();
  process.env.RING_DAMM_POOL = pool.toBase58();
  const originalPool = CpAmm.prototype.fetchPoolState,
    originalPosition = CpAmm.prototype.fetchPositionState;
  CpAmm.prototype.fetchPoolState = async () =>
    ({
      tokenAMint: mint,
      tokenBMint: NATIVE_MINT,
      tokenAVault: Keypair.generate().publicKey,
      tokenBVault: Keypair.generate().publicKey,
      tokenAFlag: 0,
      tokenBFlag: 0,
      feeAPerLiquidity: Array(32).fill(0),
      feeBPerLiquidity: Array(32).fill(0),
      rewardInfos: [],
    }) as unknown as Awaited<ReturnType<typeof originalPool>>;
  CpAmm.prototype.fetchPositionState = async () =>
    ({
      pool,
      unlockedLiquidity: new BN(0),
      vestedLiquidity: new BN(0),
      permanentLockedLiquidity: new BN(0),
      feeAPerTokenCheckpoint: Array(32).fill(0),
      feeBPerTokenCheckpoint: Array(32).fill(0),
      feeAPending: new BN(5),
      feeBPending: new BN(6),
      rewardInfos: [],
    }) as unknown as Awaited<ReturnType<typeof originalPosition>>;
  try {
    const tx = await claimTransaction(
      new Connection("http://127.0.0.1:8899"),
      owner,
      recipient,
      {
        kind: "damm",
        pool: pool.toBase58(),
        position: position.toBase58(),
        nftAccount: Keypair.generate().publicKey.toBase58(),
      },
    );
    assert.ok(tx);
    assert.equal(tx.instructions.length, 3);
    const cp = new CpAmm(new Connection("http://127.0.0.1:8899"));
    const claim = tx.instructions[2];
    assert.deepEqual(
      claim.data,
      cp._program.coder.instruction.encode("claimPositionFee", {}),
    );
    assert.deepEqual(
      claim.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()),
      [owner.toBase58()],
    );
    assert.ok(
      claim.keys.some((k) =>
        k.pubkey.equals(getAssociatedTokenAddressSync(NATIVE_MINT, recipient)),
      ),
    );
    assert.ok(
      tx.instructions.every((ix) => !ix.programId.equals(TOKEN_PROGRAM_ID)),
    );
  } finally {
    CpAmm.prototype.fetchPoolState = originalPool;
    CpAmm.prototype.fetchPositionState = originalPosition;
  }
});
