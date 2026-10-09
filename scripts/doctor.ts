import { readStore } from "../src/lib/store";
import { authority, chain } from "../src/lib/chain";
import { verifyMetadataAuthority } from "../src/lib/token-metadata";
import { targetFor } from "../src/lib/game";
import twilio from "twilio";
import { closeDatabase, usesPostgres } from "../src/lib/database";
import { signerVariables, signerProvider } from "../src/lib/signer-config";

async function main() {
  const required = [
    "APP_ORIGIN",
    "RING_TOKEN_MINT",
    ...signerVariables(),
    "RING_PHONE_NUMBER",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "VOICE_PUBLIC_URL",
    "DEEPGRAM_API_KEY",
  ];
  let failures = 0;
  console.log(`SIGNER ${signerProvider()}`);
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
    signer = authority();
  await verifyMetadataAuthority(connection, signer);
  console.log(`OK metadata authority: ${signer.publicKey.toBase58()}`);
  if ((await connection.getBalance(signer.publicKey)) < 10_000_000)
    throw new Error(
      "Signer needs at least 0.01 SOL for transactions and token-account rent.",
    );
  console.log(
    "POLICY trading fees stay with the project owner; Ring edits metadata only",
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
