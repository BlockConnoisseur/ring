import { readStore } from "../src/lib/store";
import { authority, chain, ringMint } from "../src/lib/chain";
import { feeSources } from "../src/lib/meteora";
import { targetFor } from "../src/lib/game";
import {
  getMint,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import twilio from "twilio";
import { closeDatabase, usesPostgres } from "../src/lib/database";

async function main() {
  const required = [
    "APP_ORIGIN",
    "RING_TOKEN_MINT",
    "RING_AUTHORITY_KEYPAIR",
    "RING_DBC_POOL",
    "RING_INITIAL_FEE_RECIPIENT",
    "RING_PHONE_NUMBER",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "VOICE_PUBLIC_URL",
    "DEEPGRAM_API_KEY",
  ];
  let failures = 0;
  for (const name of required) {
    const ok = Boolean(process.env[name]);
    console.log(`${ok ? "OK" : "MISSING"} ${name}`);
    if (!ok) failures++;
  }
  const state = await readStore(),
    remaining = state.questions.filter((q) => !q.used).length;
  console.log(
    `OK storage: ${usesPostgres() ? "Supabase/Postgres" : "local SQLite"}`,
  );
  console.log(
    `${remaining >= targetFor(state.wins) ? "OK" : "MISSING"} fresh questions: ${remaining}; next call needs ${targetFor(state.wins)}`,
  );
  if (remaining < targetFor(state.wins)) failures++;
  console.log(
    `MODE ${process.env.RING_LIVE === "true" ? "live" : "prelaunch"}`,
  );
  if (state.worker?.error) console.log(`EXECUTOR ${state.worker.error}`);
  if (failures) {
    process.exitCode = 1;
    return;
  }
  const connection = chain(),
    signer = authority(),
    mint = ringMint();
  const account = await connection.getAccountInfo(mint);
  if (!account) throw new Error("Ring mint does not exist.");
  if (account.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    await getMint(connection, mint, "finalized", TOKEN_2022_PROGRAM_ID);
    const metadata = await getTokenMetadata(connection, mint, "finalized");
    if (!metadata?.updateAuthority?.equals(signer.publicKey))
      throw new Error(
        "Ring signer must own the Token-2022 metadata authority.",
      );
  } else {
    const metadata = await fetchMetadataFromSeeds(
      createUmi(connection.rpcEndpoint).use(mplTokenMetadata()),
      { mint: publicKey(mint.toBase58()) },
    );
    if (
      !metadata.isMutable ||
      metadata.updateAuthority !== signer.publicKey.toBase58()
    )
      throw new Error("Ring signer must own mutable Metaplex metadata.");
  }
  console.log(`OK metadata authority: ${signer.publicKey.toBase58()}`);
  if ((await connection.getBalance(signer.publicKey)) < 10_000_000)
    throw new Error(
      "Signer needs at least 0.01 SOL for transactions and token-account rent.",
    );
  console.log(
    `OK ${(await feeSources(connection, signer.publicKey)).length} verified Meteora fee sources`,
  );
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
  const [phone] = await client.incomingPhoneNumbers.list({
    phoneNumber: process.env.RING_PHONE_NUMBER,
    limit: 1,
  });
  if (!phone?.capabilities.voice)
    throw new Error("Twilio account does not own the configured voice number.");
  const base = process.env.VOICE_PUBLIC_URL!.replace(/\/$/, "");
  if (
    phone.voiceUrl !== `${base}/incoming` ||
    phone.statusCallback !== `${base}/status`
  )
    throw new Error(
      "Run phone:configure to set incoming and completion webhooks.",
    );
  console.log("OK real phone number and Twilio webhooks");
  console.log(
    "Configuration checks passed. Run a real end-to-end call before opening the line publicly.",
  );
}
void main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
