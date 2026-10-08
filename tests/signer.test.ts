import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TurnkeySigner } from "@turnkey/solana";
import { Turnkey } from "@turnkey/sdk-server";
import { signTransaction } from "../src/lib/chain";
import { authority, turnkeyAuthority, type Authority } from "../src/lib/signer";
import { signerSelected } from "../src/lib/signer-config";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bs58 from "bs58";

const keypair = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();
const connection = {
  getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 500 }),
} as unknown as Connection;
const transaction = () =>
  new Transaction().add(
    new TransactionInstruction({
      programId: new Keypair().publicKey,
      keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from("test-only memo"),
    }),
  );

test("Turnkey SDK uses parsed Solana signing and produces verifiable journal bytes without broadcasting", async () => {
  const sdk = new Turnkey({
    apiBaseUrl: "https://api.turnkey.com",
    defaultOrganizationId: "test-org",
    apiPublicKey: "test-public",
    apiPrivateKey: "test-private",
  });
  const client = sdk.apiClient();
  let calls = 0;
  client.signTransaction = async (request) => {
    calls++;
    assert.equal(request.type, "TRANSACTION_TYPE_SOLANA");
    assert.equal(request.signWith, keypair.publicKey.toBase58());
    const tx = Transaction.from(
      Buffer.from(request.unsignedTransaction, "hex"),
    );
    assert.equal(tx.recentBlockhash, blockhash);
    tx.sign(keypair);
    return {
      activity: { status: "ACTIVITY_STATUS_COMPLETED" },
      signedTransaction: tx.serialize().toString("hex"),
    } as Awaited<ReturnType<typeof client.signTransaction>>;
  };
  const signer = turnkeyAuthority(
    keypair.publicKey.toBase58(),
    new TurnkeySigner({ organizationId: "test-org", client }),
  );
  const signed = await signTransaction(connection, signer, transaction());
  const decoded = Transaction.from(Buffer.from(signed.raw, "base64"));
  assert.equal(decoded.verifySignatures(), true);
  assert.equal(signed.signature, bs58.encode(decoded.signature!));
  assert.equal(signed.lastValidBlockHeight, 500);
  assert.equal(calls, 1);
});

test("changed transactions and invalid remote signatures are rejected before journaling", async () => {
  const changed: Authority = {
    publicKey: keypair.publicKey,
    async signTransaction(tx) {
      tx.instructions[0].data = Buffer.from("changed");
      tx.sign(keypair);
      return tx;
    },
  };
  await assert.rejects(
    signTransaction(connection, changed, transaction()),
    /changed the transaction/,
  );
  const invalid: Authority = {
    publicKey: keypair.publicKey,
    async signTransaction(tx) {
      tx.addSignature(keypair.publicKey, Buffer.alloc(64, 1));
      return tx;
    },
  };
  await assert.rejects(
    signTransaction(connection, invalid, transaction()),
    /invalid transaction signature/,
  );
  const denied: Authority = {
    publicKey: keypair.publicKey,
    async signTransaction() {
      throw new Error("Turnkey policy denied");
    },
  };
  await assert.rejects(
    signTransaction(connection, denied, transaction()),
    /policy denied/,
  );
});

test("Turnkey cannot silently fall back to a key file; site readiness never requires an API secret", () => {
  const saved = { ...process.env };
  try {
    process.env.RING_SIGNER = "turnkey";
    process.env.TURNKEY_SIGNER_ADDRESS = keypair.publicKey.toBase58();
    delete process.env.TURNKEY_API_PRIVATE_KEY;
    delete process.env.TURNKEY_ORGANIZATION_ID;
    process.env.RING_AUTHORITY_KEYPAIR = "must-not-be-read";
    assert.equal(signerSelected(), true);
    assert.throws(authority, /TURNKEY_ORGANIZATION_ID/);
    process.env.RING_SIGNER = "typo";
    assert.throws(authority, /RING_SIGNER/);
    assert.equal(signerSelected(), false);
  } finally {
    process.env = saved;
  }
});

test("local signer remains available for isolated development", async () => {
  const saved = { ...process.env };
  try {
    const file = join(mkdtempSync(join(tmpdir(), "ring-signer-")), "key.json");
    writeFileSync(file, JSON.stringify([...keypair.secretKey]));
    process.env.RING_SIGNER = "keypair";
    process.env.RING_AUTHORITY_KEYPAIR = file;
    const signed = await signTransaction(
      connection,
      authority(),
      transaction(),
    );
    assert.equal(
      Transaction.from(Buffer.from(signed.raw, "base64")).verifySignatures(),
      true,
    );
  } finally {
    process.env = saved;
  }
});
