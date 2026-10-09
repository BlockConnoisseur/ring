import { randomBytes } from "node:crypto";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createInitializeAccount3Instruction,
  getAssociatedTokenAddressSync,
  unpackMint,
} from "@solana/spl-token";
import {
  createDbcProgram,
  deriveDbcEventAuthority,
  deriveDbcPoolAddress,
  deriveDbcPoolAuthority,
  deriveDbcTokenVaultAddress,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  type PoolConfig,
  type VirtualPool,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

// This page only claims this deployment's partner fees. None of these addresses
// or the recipient can be supplied by an HTTP request or a winning proposal.
export const FEE_CLAIM_MINT = "GuT6mfBehxBXiT1UqyoDEdX8yPLE8xwB5zzSAUm8DCxZ";
export const FEE_CLAIM_CONFIG = "9yV6Ky6PtkZCoNZeKGdTGbEySK5szTTgj2k4ELyUv9d3";
export const FEE_CLAIM_POOL = "C7aRnpgNcBrBsdy2T5YZujx4xPuyxeKDo2XtKnFrXQAc";
export const FEE_CLAIM_WALLET = "6n3erAFxnvfjsAfbPdabwnpvfGpi2RW5Z8Yk1AYspzXs";

const mint = new PublicKey(FEE_CLAIM_MINT);
const config = new PublicKey(FEE_CLAIM_CONFIG);
const pool = new PublicKey(FEE_CLAIM_POOL);
const wallet = new PublicKey(FEE_CLAIM_WALLET);

export type FeeClaimStatus = {
  mint: string;
  pool: string;
  config: string;
  feeClaimer: string;
  migrated: boolean;
  canClaim: boolean;
  baseAmountRaw: string;
  quoteAmountRaw: string;
  baseAmount: string;
  quoteAmount: string;
  baseDecimals: 6;
  quoteDecimals: 9;
  payout: "SOL";
  scope: "dbc_partner";
  notice: string;
  slot: number;
};

export type PreparedFeeClaim = {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  status: FeeClaimStatus;
  estimatedNetworkFeeLamports: number;
  rentDepositLamports: number;
  refundableRentLamports: number;
};

function connection() {
  return new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
}

function amount(raw: BN, decimals: number) {
  const digits = raw.toString(10).padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

async function readVerifiedPool(rpc: Connection) {
  const program = createDbcProgram(rpc, "confirmed").program;
  const { context, value } = await rpc.getMultipleAccountsInfoAndContext(
    [pool, config, mint],
    "confirmed",
  );
  const [poolInfo, configInfo, mintInfo] = value;
  if (!poolInfo || !configInfo || !mintInfo)
    throw new Error(
      "Ring's Meteora pool or token was not found on this network.",
    );
  if (
    !poolInfo.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID) ||
    !configInfo.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID) ||
    !mintInfo.owner.equals(TOKEN_PROGRAM_ID)
  )
    throw new Error("Ring's pool, config, or token has an unexpected owner.");

  const poolState = program.coder.accounts.decode<VirtualPool>(
    "virtualPool",
    poolInfo.data,
  ).poolState;
  const configState = program.coder.accounts.decode<PoolConfig>(
    "poolConfig",
    configInfo.data,
  );
  const mintState = unpackMint(mint, mintInfo, TOKEN_PROGRAM_ID);
  if (
    !poolState.baseMint.equals(mint) ||
    !poolState.config.equals(config) ||
    !configState.quoteMint.equals(NATIVE_MINT) ||
    !configState.feeClaimer.equals(wallet) ||
    configState.tokenType !== 0 ||
    configState.quoteTokenFlag !== 0 ||
    configState.tokenDecimal !== 6 ||
    mintState.decimals !== 6 ||
    !mintState.isInitialized ||
    !deriveDbcPoolAddress(NATIVE_MINT, mint, config).equals(pool) ||
    !deriveDbcTokenVaultAddress(pool, mint).equals(poolState.baseVault) ||
    !deriveDbcTokenVaultAddress(pool, NATIVE_MINT).equals(poolState.quoteVault)
  )
    throw new Error(
      "Ring's on-chain fee configuration does not match this claim page.",
    );

  const base = poolState.partnerBaseFee;
  const quote = poolState.partnerQuoteFee;
  if (
    base.isNeg() ||
    quote.isNeg() ||
    base.bitLength() > 64 ||
    quote.bitLength() > 64
  )
    throw new Error("Invalid on-chain fee amounts.");
  const migrated = poolState.isMigrated !== 0;
  const status: FeeClaimStatus = {
    mint: FEE_CLAIM_MINT,
    pool: FEE_CLAIM_POOL,
    config: FEE_CLAIM_CONFIG,
    feeClaimer: FEE_CLAIM_WALLET,
    migrated,
    canClaim: !base.isZero() || !quote.isZero(),
    baseAmountRaw: base.toString(10),
    quoteAmountRaw: quote.toString(10),
    baseAmount: amount(base, 6),
    quoteAmount: amount(quote, 9),
    baseDecimals: 6,
    quoteDecimals: 9,
    payout: "SOL",
    scope: "dbc_partner",
    notice: migrated
      ? "These are remaining bonding-curve partner fees. Fees earned after migration belong to the DAMM liquidity position and are not included here."
      : "Claim accrued Meteora bonding-curve partner fees to the project's fee wallet.",
    slot: context.slot,
  };
  return { program, poolState, status };
}

export async function getFeeClaimStatus(
  rpc: Connection = connection(),
): Promise<FeeClaimStatus> {
  return (await readVerifiedPool(rpc)).status;
}

export async function buildFeeClaimTransaction(
  requestingWallet: string,
  rpc: Connection = connection(),
): Promise<PreparedFeeClaim> {
  if (requestingWallet !== FEE_CLAIM_WALLET)
    throw new Error(
      "Connect the project's fee-claim wallet to claim these fees.",
    );
  const { program, poolState, status } = await readVerifiedPool(rpc);
  if (!status.canClaim)
    throw new Error("There are no unclaimed bonding-curve partner fees.");

  const baseAccount = getAssociatedTokenAddressSync(mint, wallet);
  const [latest, rent, baseAccountInfo] = await Promise.all([
    rpc.getLatestBlockhash("confirmed"),
    rpc.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed"),
    rpc.getAccountInfo(baseAccount, "confirmed"),
  ]);

  // The SDK's convenience method closes the fee wallet's existing wSOL ATA.
  // Build its same claimTradingFee instruction with a fresh, seeded token
  // account instead. The wallet alone signs its creation and closure; neither
  // a server signer nor any pre-existing wSOL balance is involved.
  const seed = `ring-fees-${randomBytes(11).toString("hex")}`;
  const quoteAccount = await PublicKey.createWithSeed(
    wallet,
    seed,
    TOKEN_PROGRAM_ID,
  );
  const claim = await program.methods
    .claimTradingFee(
      new BN(status.baseAmountRaw),
      new BN(status.quoteAmountRaw),
    )
    .accountsStrict({
      poolAuthority: deriveDbcPoolAuthority(),
      config,
      pool,
      tokenAAccount: baseAccount,
      tokenBAccount: quoteAccount,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: mint,
      quoteMint: NATIVE_MINT,
      feeClaimer: wallet,
      tokenBaseProgram: TOKEN_PROGRAM_ID,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      eventAuthority: deriveDbcEventAuthority(),
      program: DYNAMIC_BONDING_CURVE_PROGRAM_ID,
    })
    .instruction();
  const transaction = new Transaction({
    feePayer: wallet,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }).add(
    // Set the budget before wallet approval: Phantom otherwise inserts its own
    // priority-fee instructions at signing, invalidating our exact-message check.
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet,
      baseAccount,
      wallet,
      mint,
    ),
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      basePubkey: wallet,
      newAccountPubkey: quoteAccount,
      seed,
      lamports: rent,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccount3Instruction(quoteAccount, NATIVE_MINT, wallet),
    claim,
    createCloseAccountInstruction(quoteAccount, wallet, wallet),
  );
  const message = transaction.compileMessage();
  if (
    message.header.numRequiredSignatures !== 1 ||
    !message.accountKeys[0].equals(wallet)
  )
    throw new Error("Unexpected signer in fee-claim transaction.");
  const estimatedFee = await rpc.getFeeForMessage(message, "confirmed");
  if (estimatedFee.value === null)
    throw new Error(
      "The transaction blockhash expired. Refresh the claim and try again.",
    );
  return {
    transaction: transaction
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
    ...latest,
    status,
    estimatedNetworkFeeLamports: estimatedFee.value,
    rentDepositLamports: rent * (baseAccountInfo ? 1 : 2),
    refundableRentLamports: rent,
  };
}
