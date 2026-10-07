import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAuthority,
  U64_MAX,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  CpAmm,
  derivePoolAuthority,
  getUnClaimLpFee,
} from "@meteora-ag/cp-amm-sdk";
import { ringMint } from "./chain";

export type FeeSource =
  | { kind: "dbc"; pool: string }
  | { kind: "damm"; pool: string; position: string; nftAccount: string };

function tokenProgram(flag: number) {
  if (flag !== 0 && flag !== 1) throw new Error("Unsupported token type.");
  return flag === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
}
function accounts(
  payer: PublicKey,
  recipient: PublicKey,
  mints: PublicKey[],
  programs: PublicKey[],
) {
  const atas = mints.map((mint, i) =>
    getAssociatedTokenAddressSync(mint, recipient, true, programs[i]),
  );
  const instructions = atas.map((ata, i) =>
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      recipient,
      mints[i],
      programs[i],
    ),
  );
  return { atas, instructions };
}

export async function feeSources(
  connection: Connection,
  owner: PublicKey,
): Promise<FeeSource[]> {
  const pool = new PublicKey(process.env.RING_DBC_POOL || "");
  const dbc = new DynamicBondingCurveClient(connection, "finalized");
  const state = (await dbc.state.getPool(pool))?.poolState;
  if (
    !state ||
    !state.baseMint.equals(ringMint()) ||
    !state.creator.equals(owner)
  )
    throw new Error(
      "DBC pool must belong to Ring and the configured creator authority.",
    );
  const sources: FeeSource[] = [{ kind: "dbc", pool: pool.toBase58() }];
  if (state.isMigrated) {
    if (!process.env.RING_DAMM_POOL)
      throw new Error(
        "Configure Ring's migrated DAMM v2 pool before claiming migrated fees.",
      );
    const cp = new CpAmm(connection);
    const migratedPool = new PublicKey(process.env.RING_DAMM_POOL);
    const migrated = await cp.fetchPoolState(migratedPool);
    if (
      ![migrated.tokenAMint, migrated.tokenBMint].some((m) =>
        m.equals(ringMint()),
      )
    )
      throw new Error("DAMM pool does not contain Ring.");
    const positions = await cp.getUserPositionByPool(migratedPool, owner);
    if (!positions.length)
      throw new Error(
        "Ring authority has no fee-bearing position in the migrated pool.",
      );
    for (const p of positions)
      sources.push({
        kind: "damm",
        pool: migratedPool.toBase58(),
        position: p.position.toBase58(),
        nftAccount: p.positionNftAccount.toBase58(),
      });
  }
  return sources;
}

// Claim only creator/owned-position trading fees. No withdrawal, transfer of
// authority, reward harvest, swap, or liquidity-removal instructions are built.
// SOL fees stay wrapped in the recipient's own ATA; never close a treasury ATA.
export async function claimTransaction(
  connection: Connection,
  owner: PublicKey,
  recipient: PublicKey,
  source: FeeSource,
) {
  const pool = new PublicKey(source.pool);
  if (source.kind === "dbc") {
    if (source.pool !== process.env.RING_DBC_POOL)
      throw new Error("Unconfigured DBC pool.");
    const dbc = new DynamicBondingCurveClient(connection, "finalized");
    const state = (await dbc.state.getPool(pool))?.poolState;
    if (
      !state ||
      !state.baseMint.equals(ringMint()) ||
      !state.creator.equals(owner)
    )
      throw new Error("Invalid Ring pool authority.");
    const config = await dbc.state.getPoolConfig(state.config);
    if (!config) throw new Error("Missing DBC config.");
    if (state.creatorBaseFee.isZero() && state.creatorQuoteFee.isZero())
      return null;
    const programs = [
      tokenProgram(config.tokenType),
      tokenProgram(config.quoteTokenFlag),
    ];
    const a = accounts(
      owner,
      recipient,
      [state.baseMint, config.quoteMint],
      programs,
    );
    const ix = await dbc.creator.program.methods
      .claimCreatorTradingFee(U64_MAX, U64_MAX)
      .accountsPartial({
        creator: owner,
        pool,
        poolAuthority: deriveDbcPoolAuthority(),
        tokenAAccount: a.atas[0],
        tokenBAccount: a.atas[1],
        baseVault: state.baseVault,
        quoteVault: state.quoteVault,
        baseMint: state.baseMint,
        quoteMint: config.quoteMint,
        tokenBaseProgram: programs[0],
        tokenQuoteProgram: programs[1],
      })
      .instruction();
    return new Transaction().add(...a.instructions, ix);
  }
  if (source.pool !== process.env.RING_DAMM_POOL)
    throw new Error("Unconfigured DAMM pool.");
  const cp = new CpAmm(connection);
  const state = await cp.fetchPoolState(pool);
  if (![state.tokenAMint, state.tokenBMint].some((m) => m.equals(ringMint())))
    throw new Error("Invalid Ring DAMM pool.");
  const position = new PublicKey(source.position);
  const p = await cp.fetchPositionState(position);
  if (!p.pool.equals(pool))
    throw new Error("Position belongs to another pool.");
  const fees = getUnClaimLpFee(state, p);
  if (fees.feeTokenA.isZero() && fees.feeTokenB.isZero()) return null;
  const programs = [
    tokenProgram(state.tokenAFlag),
    tokenProgram(state.tokenBFlag),
  ];
  const a = accounts(
    owner,
    recipient,
    [state.tokenAMint, state.tokenBMint],
    programs,
  );
  const ix = await cp._program.methods
    .claimPositionFee()
    .accountsPartial({
      signer: owner,
      pool,
      position,
      poolAuthority: derivePoolAuthority(),
      positionNftAccount: new PublicKey(source.nftAccount),
      tokenAAccount: a.atas[0],
      tokenBAccount: a.atas[1],
      tokenAMint: state.tokenAMint,
      tokenBMint: state.tokenBMint,
      tokenAVault: state.tokenAVault,
      tokenBVault: state.tokenBVault,
      tokenAProgram: programs[0],
      tokenBProgram: programs[1],
    })
    .instruction();
  return new Transaction().add(...a.instructions, ix);
}
