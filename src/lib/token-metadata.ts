import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getMint,
  getTokenMetadata,
  getMetadataPointerState,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createUpdateFieldInstruction } from "@solana/spl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createNoopSigner,
  signerIdentity,
  publicKey,
} from "@metaplex-foundation/umi";
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
  updateV1,
} from "@metaplex-foundation/mpl-token-metadata";
import { toWeb3JsInstruction } from "@metaplex-foundation/umi-web3js-adapters";
import { getAsset, publishAsset, publishImage } from "./assets";
import { ringMint } from "./chain";
import type { Proposal } from "./types";
import { validateProposalValue } from "./proposal-value";

export function nextMetadata(
  previous: Record<string, unknown>,
  proposal: Proposal,
  image?: string,
  imageMime?: string,
) {
  const value = validateProposalValue(proposal.kind, proposal.value);
  if (proposal.kind === "name" || proposal.kind === "symbol")
    return { ...previous, [proposal.kind]: value };
  if (proposal.kind === "website") return { ...previous, external_url: value };
  if (proposal.kind === "description")
    return { ...previous, description: value };
  if (proposal.kind !== "picture" || !image)
    throw new Error("Unsupported metadata action.");
  const properties =
    typeof previous.properties === "object" && previous.properties !== null
      ? (previous.properties as Record<string, unknown>)
      : {};
  const files = Array.isArray(properties.files)
    ? properties.files.filter(
        (f) =>
          typeof f === "object" &&
          f &&
          !(
            String(f.type || "").startsWith("image/") ||
            f.uri === previous.image
          ),
      )
    : [];
  return {
    ...previous,
    image,
    properties: {
      ...properties,
      files: [
        ...files,
        {
          uri: image,
          type: proposal.image?.startsWith("data:")
            ? proposal.image.split(";")[0].slice(5)
            : imageMime,
        },
      ],
    },
  };
}

async function loadJson(uri: string) {
  if (uri.startsWith("ipfs://")) uri = `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri.startsWith("ar://")) uri = `https://arweave.net/${uri.slice(5)}`;
  const url = new URL(uri);
  const allowed = new Set([
    "arweave.net",
    "ipfs.io",
    "gateway.pinata.cloud",
    ...[process.env.APP_ORIGIN, process.env.RING_ASSET_ORIGIN]
      .filter(Boolean)
      .map((v) => new URL(v!).hostname),
    ...(process.env.RING_METADATA_HOSTS || "").split(",").filter(Boolean),
  ]);
  if (
    !allowed.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && url.hostname !== "127.0.0.1")
  )
    throw new Error(
      "Add the existing metadata host to RING_METADATA_HOSTS after reviewing it.",
    );
  const res = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok || !res.body)
    throw new Error("Current token metadata is unavailable.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  const reader = res.body.getReader();
  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    bytes += chunk.length;
    if (bytes > 262144) {
      await reader.cancel();
      throw new Error("Metadata exceeds 256 KB.");
    }
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || Array.isArray(data) || typeof data !== "object")
    throw new Error("Invalid token metadata JSON.");
  return data as Record<string, unknown>;
}

export async function verifyMetadataAuthority(
  connection: Connection,
  signer: { publicKey: PublicKey },
) {
  const mint = ringMint();
  const account = await connection.getAccountInfo(mint, "finalized");
  if (!account) throw new Error("Ring mint does not exist.");
  if (account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const state = await getMint(
      connection,
      mint,
      "finalized",
      TOKEN_2022_PROGRAM_ID,
    );
    if (!getMetadataPointerState(state)?.metadataAddress?.equals(mint))
      throw new Error("Ring requires metadata stored on the Token-2022 mint.");
    const metadata = await getTokenMetadata(connection, mint, "finalized");
    if (!metadata?.updateAuthority?.equals(signer.publicKey))
      throw new Error("Ring signer is not the metadata authority.");
    await loadJson(metadata.uri.replace(/\0/g, "").trim());
    return new Transaction().add(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: signer.publicKey,
        field: "Name",
        value: metadata.name,
      }),
    );
  }
  if (!account.owner.equals(TOKEN_PROGRAM_ID))
    throw new Error("Unsupported Ring token program.");
  const metadata = await fetchMetadataFromSeeds(
    createUmi(connection.rpcEndpoint).use(mplTokenMetadata()),
    { mint: publicKey(mint.toBase58()) },
  );
  if (
    !metadata.isMutable ||
    metadata.updateAuthority !== signer.publicKey.toBase58()
  )
    throw new Error("Ring needs mutable metadata and its update authority.");
  await loadJson(metadata.uri.replace(/\0/g, "").trim());
  const umi = createUmi(connection.rpcEndpoint).use(mplTokenMetadata());
  const identity = createNoopSigner(publicKey(signer.publicKey.toBase58()));
  umi.use(signerIdentity(identity));
  const builder = updateV1(umi, {
    mint: publicKey(mint.toBase58()),
    authority: identity,
    data: {
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
      creators: metadata.creators,
    },
  });
  return new Transaction().add(
    ...builder.getInstructions().map(toWeb3JsInstruction),
  );
}

export async function metadataTransaction(
  connection: Connection,
  signer: { publicKey: PublicKey },
  proposal: Proposal,
) {
  const value = validateProposalValue(proposal.kind, proposal.value);
  const mint = ringMint();
  const account = await connection.getAccountInfo(mint, "finalized");
  if (!account) throw new Error("Ring mint does not exist.");
  const image =
    proposal.kind === "picture"
      ? await publishImage(proposal.image || "")
      : undefined;
  const publish = async (oldUri: string) =>
    publishAsset(
      Buffer.from(
        JSON.stringify(
          nextMetadata(
            await loadJson(oldUri.replace(/\0/g, "").trim()),
            proposal,
            image,
            image ? (await getAsset(image.split("/").pop()!))?.mime : undefined,
          ),
        ),
      ),
      "application/json",
    );

  if (account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const mintState = await getMint(
      connection,
      mint,
      "finalized",
      TOKEN_2022_PROGRAM_ID,
    );
    const pointer = getMetadataPointerState(mintState);
    if (!pointer?.metadataAddress?.equals(mint))
      throw new Error("Ring requires metadata stored on the Token-2022 mint.");
    const metadata = await getTokenMetadata(connection, mint, "finalized");
    if (!metadata || !metadata.updateAuthority?.equals(signer.publicKey))
      throw new Error("Ring signer is not the metadata authority.");
    const uri = await publish(metadata.uri);
    const transaction = new Transaction();
    const growth =
      Math.max(0, Buffer.byteLength(uri) - Buffer.byteLength(metadata.uri)) +
      (proposal.kind === "name" || proposal.kind === "symbol"
        ? Math.max(
            0,
            Buffer.byteLength(value) -
              Buffer.byteLength(metadata[proposal.kind]),
          )
        : 0);
    const rent = await connection.getMinimumBalanceForRentExemption(
      account.data.length + growth,
    );
    if (rent > account.lamports)
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: mint,
          lamports: rent - account.lamports,
        }),
      );
    if (proposal.kind === "name" || proposal.kind === "symbol")
      transaction.add(
        createUpdateFieldInstruction({
          programId: TOKEN_2022_PROGRAM_ID,
          metadata: mint,
          updateAuthority: signer.publicKey,
          field: proposal.kind === "name" ? "Name" : "Symbol",
          value,
        }),
      );
    transaction.add(
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: signer.publicKey,
        field: "Uri",
        value: uri,
      }),
    );
    return transaction;
  }
  if (!account.owner.equals(TOKEN_PROGRAM_ID))
    throw new Error("Unsupported Ring token program.");
  const umi = createUmi(connection.rpcEndpoint).use(mplTokenMetadata());
  // Build instructions using the authority address. The complete transaction
  // is signed later by Turnkey or the local signer, then journaled before send.
  const identity = createNoopSigner(publicKey(signer.publicKey.toBase58()));
  umi.use(signerIdentity(identity));
  const metadata = await fetchMetadataFromSeeds(umi, {
    mint: publicKey(mint.toBase58()),
  });
  if (metadata.updateAuthority !== identity.publicKey || !metadata.isMutable)
    throw new Error("Ring needs mutable metadata and its update authority.");
  const uri = await publish(metadata.uri);
  if (Buffer.byteLength(uri) > 200)
    throw new Error("Metadata URL exceeds Metaplex's 200-byte limit.");
  const builder = updateV1(umi, {
    mint: publicKey(mint.toBase58()),
    authority: identity,
    data: {
      name: proposal.kind === "name" ? value : metadata.name,
      symbol: proposal.kind === "symbol" ? value : metadata.symbol,
      uri,
      sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
      creators: metadata.creators,
    },
  });
  return new Transaction().add(
    ...builder.getInstructions().map(toWeb3JsInstruction),
  );
}
