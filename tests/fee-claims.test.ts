import { test } from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  type AccountInfo,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MintLayout,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  decodeCloseAccountInstruction,
  decodeInitializeAccount3Instruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  createDbcProgram,
  deriveDbcTokenVaultAddress,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  buildFeeClaimTransaction,
  getFeeClaimStatus,
  FEE_CLAIM_CONFIG,
  FEE_CLAIM_MINT,
  FEE_CLAIM_POOL,
  FEE_CLAIM_WALLET,
} from "../src/lib/fee-claims";

const rpc = new Connection("http://127.0.0.1:1", "confirmed");
const program = createDbcProgram(rpc, "confirmed").program;
const wallet = new PublicKey(FEE_CLAIM_WALLET);
const mint = new PublicKey(FEE_CLAIM_MINT);
const pool = new PublicKey(FEE_CLAIM_POOL);
const rent = 2_039_280;

function blank(name: "poolConfig" | "virtualPool") {
  const data = Buffer.alloc(program.coder.accounts.size(name));
  Buffer.from(
    program.idl.accounts.find((account) => account.name === name)!
      .discriminator,
  ).copy(data);
  return program.coder.accounts.decode(name, data);
}

function encodeFixture(name: "poolConfig" | "virtualPool", value: unknown) {
  // Anchor's public encode uses a 1,000-byte scratch buffer; this SDK's config
  // is 1,048 bytes. Use its same IDL layout with a correctly sized test buffer.
  const layouts = (
    program.coder.accounts as unknown as {
      accountLayouts: Map<
        string,
        {
          discriminator: number[];
          layout: { encode(value: unknown, buffer: Buffer): number };
        }
      >;
    }
  ).accountLayouts;
  const layout = layouts.get(name)!;
  const buffer = Buffer.alloc(program.coder.accounts.size(name));
  Buffer.from(layout.discriminator).copy(buffer);
  layout.layout.encode(value, buffer.subarray(layout.discriminator.length));
  return buffer;
}

async function fixture(
  options: {
    migrated?: number;
    quote?: string;
    base?: string;
    feeClaimer?: PublicKey;
    config?: PublicKey;
    poolOwner?: PublicKey;
    mintOwner?: PublicKey;
    quoteVault?: PublicKey;
    existingBaseAta?: boolean;
  } = {},
) {
  const poolData = encodeFixture("virtualPool", {
    poolState: {
      ...blank("virtualPool").poolState,
      baseMint: mint,
      config: options.config ?? new PublicKey(FEE_CLAIM_CONFIG),
      baseVault: deriveDbcTokenVaultAddress(pool, mint),
      quoteVault:
        options.quoteVault ?? deriveDbcTokenVaultAddress(pool, NATIVE_MINT),
      isMigrated: options.migrated ?? 0,
      partnerBaseFee: new BN(options.base ?? "1500001"),
      partnerQuoteFee: new BN(options.quote ?? "5050123456"),
    },
  });
  const configData = encodeFixture("poolConfig", {
    ...blank("poolConfig"),
    feeClaimer: options.feeClaimer ?? wallet,
    quoteMint: NATIVE_MINT,
    tokenDecimal: 6,
    tokenType: 0,
    quoteTokenFlag: 0,
  });
  const mintData = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: BigInt("1000000000000000"),
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mintData,
  );
  const info = (data: Buffer, owner: PublicKey): AccountInfo<Buffer> => ({
    data,
    owner,
    executable: false,
    lamports: rent,
    rentEpoch: 0,
  });
  const mock = new Connection("http://127.0.0.1:1", "confirmed");
  mock.getMultipleAccountsInfoAndContext = async (keys) => {
    assert.deepEqual(
      keys.map((key) => key.toBase58()),
      [FEE_CLAIM_POOL, FEE_CLAIM_CONFIG, FEE_CLAIM_MINT],
    );
    return {
      context: { slot: 100 },
      value: [
        info(poolData, options.poolOwner ?? DYNAMIC_BONDING_CURVE_PROGRAM_ID),
        info(configData, DYNAMIC_BONDING_CURVE_PROGRAM_ID),
        info(mintData, options.mintOwner ?? TOKEN_PROGRAM_ID),
      ],
    };
  };
  mock.getAccountInfo = async (key) => {
    assert.equal(
      key.toBase58(),
      getAssociatedTokenAddressSync(mint, wallet).toBase58(),
    );
    return options.existingBaseAta
      ? info(Buffer.alloc(ACCOUNT_SIZE), TOKEN_PROGRAM_ID)
      : null;
  };
  mock.getLatestBlockhash = async () => ({
    blockhash: PublicKey.default.toBase58(),
    lastValidBlockHeight: 1234,
  });
  mock.getMinimumBalanceForRentExemption = async (size) => {
    assert.equal(size, ACCOUNT_SIZE);
    return rent;
  };
  mock.getFeeForMessage = async (message) => {
    // The price shown to the user must be requested for the complete message,
    // including the preselected priority fee, before it goes to the wallet.
    if (message.version !== "legacy")
      throw new Error("The claim builder must estimate the legacy message.");
    const [limit, price] = Transaction.populate(message).instructions;
    assert.equal(
      ComputeBudgetInstruction.decodeSetComputeUnitLimit(limit).units,
      100_000,
    );
    assert.equal(
      ComputeBudgetInstruction.decodeSetComputeUnitPrice(price).microLamports,
      10_000n,
    );
    return { context: { slot: 100 }, value: 6000 };
  };
  mock.sendRawTransaction = async () => {
    throw new Error("Must never broadcast from the builder.");
  };
  return mock;
}

test("reads exact partner amounts, including one raw unit and remaining fees after migration", async () => {
  const status = await getFeeClaimStatus(
    await fixture({ migrated: 1, base: "1" }),
  );
  assert.equal(status.baseAmount, "0.000001");
  assert.equal(status.quoteAmount, "5.050123456");
  assert.equal(status.quoteAmountRaw, "5050123456");
  assert.equal(status.canClaim, true);
  assert.equal(status.migrated, true);
  assert.match(status.notice, /after migration.*not included/);
  assert.equal(status.feeClaimer, FEE_CLAIM_WALLET);
});

test("rejects wrong wallet before RPC, and unowned or mismatched on-chain accounts", async () => {
  await assert.rejects(
    buildFeeClaimTransaction(PublicKey.default.toBase58(), rpc),
    /fee-claim wallet/,
  );
  for (const options of [
    { poolOwner: SystemProgram.programId },
    { mintOwner: SystemProgram.programId },
    { feeClaimer: PublicKey.default },
    { config: PublicKey.default },
    { quoteVault: PublicKey.default },
  ]) {
    await assert.rejects(
      buildFeeClaimTransaction(FEE_CLAIM_WALLET, await fixture(options)),
      /unexpected owner|does not match/,
    );
  }
  const empty = await fixture({ base: "0", quote: "0" });
  assert.equal((await getFeeClaimStatus(empty)).canClaim, false);
  await assert.rejects(
    buildFeeClaimTransaction(FEE_CLAIM_WALLET, empty),
    /no unclaimed/,
  );
});

test("claims only current accrued fees, never touches existing wSOL, and only owner signs", async () => {
  const prepared = await buildFeeClaimTransaction(
    FEE_CLAIM_WALLET,
    await fixture(),
  );
  const transaction = Transaction.from(
    Buffer.from(prepared.transaction, "base64"),
  );
  assert.equal(transaction.instructions.length, 7);
  assert.equal(transaction.feePayer?.toBase58(), FEE_CLAIM_WALLET);
  assert.equal(transaction.recentBlockhash, prepared.blockhash);
  assert.equal(prepared.lastValidBlockHeight, 1234);
  assert.deepEqual(
    transaction.signatures.map((signature) => signature.publicKey.toBase58()),
    [FEE_CLAIM_WALLET],
  );
  assert.ok(
    transaction.signatures.every((signature) => signature.signature === null),
  );
  const [limit, price, ata, create, initialize, claim, close] =
    transaction.instructions;
  assert.ok(limit.programId.equals(ComputeBudgetProgram.programId));
  assert.ok(price.programId.equals(ComputeBudgetProgram.programId));
  assert.equal(
    ComputeBudgetInstruction.decodeSetComputeUnitLimit(limit).units,
    100_000,
  );
  assert.equal(
    ComputeBudgetInstruction.decodeSetComputeUnitPrice(price).microLamports,
    10_000n,
  );
  assert.ok(ata.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.equal(ata.data[0], 1);
  assert.ok(ata.keys[0].pubkey.equals(wallet));
  assert.ok(ata.keys[2].pubkey.equals(wallet));
  assert.ok(ata.keys[3].pubkey.equals(mint));

  const creation = SystemInstruction.decodeCreateWithSeed(create);
  assert.ok(creation.fromPubkey.equals(wallet));
  assert.ok(creation.basePubkey.equals(wallet));
  assert.ok(creation.programId.equals(TOKEN_PROGRAM_ID));
  assert.equal(creation.lamports, rent);
  assert.equal(creation.space, ACCOUNT_SIZE);
  assert.ok(
    creation.newAccountPubkey.equals(
      await PublicKey.createWithSeed(wallet, creation.seed, TOKEN_PROGRAM_ID),
    ),
  );
  const init = decodeInitializeAccount3Instruction(initialize);
  assert.ok(init.keys.account.pubkey.equals(creation.newAccountPubkey));
  assert.ok(init.keys.mint.pubkey.equals(NATIVE_MINT));
  assert.ok(init.data.owner.equals(wallet));

  assert.ok(claim.programId.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID));
  assert.equal(claim.data.subarray(0, 8).toString("hex"), "08ec5931987db151");
  assert.equal(
    claim.data.readBigUInt64LE(8),
    BigInt(prepared.status.baseAmountRaw),
  );
  assert.equal(
    claim.data.readBigUInt64LE(16),
    BigInt(prepared.status.quoteAmountRaw),
  );
  assert.equal(claim.keys[1].pubkey.toBase58(), FEE_CLAIM_CONFIG);
  assert.equal(claim.keys[2].pubkey.toBase58(), FEE_CLAIM_POOL);
  assert.ok(
    claim.keys[3].pubkey.equals(getAssociatedTokenAddressSync(mint, wallet)),
  );
  assert.ok(claim.keys[4].pubkey.equals(creation.newAccountPubkey));
  assert.equal(claim.keys[9].pubkey.toBase58(), FEE_CLAIM_WALLET);
  assert.equal(claim.keys[9].isSigner, true);
  const closure = decodeCloseAccountInstruction(close);
  assert.ok(closure.keys.account.pubkey.equals(creation.newAccountPubkey));
  assert.ok(closure.keys.destination.pubkey.equals(wallet));
  assert.ok(closure.keys.authority.pubkey.equals(wallet));
  const existingWsol = getAssociatedTokenAddressSync(NATIVE_MINT, wallet);
  assert.ok(
    transaction.instructions.every((instruction) =>
      instruction.keys.every((key) => !key.pubkey.equals(existingWsol)),
    ),
  );
  assert.equal(prepared.estimatedNetworkFeeLamports, 6000);
  assert.equal(prepared.refundableRentLamports, rent);
  assert.equal(prepared.rentDepositLamports, rent * 2);
  const second = await buildFeeClaimTransaction(
    FEE_CLAIM_WALLET,
    await fixture({ existingBaseAta: true }),
  );
  const nextCreation = SystemInstruction.decodeCreateWithSeed(
    Transaction.from(Buffer.from(second.transaction, "base64")).instructions[3],
  );
  assert.notEqual(
    nextCreation.newAccountPubkey.toBase58(),
    creation.newAccountPubkey.toBase58(),
  );
  assert.equal(second.rentDepositLamports, rent);
});
