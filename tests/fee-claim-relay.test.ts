import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  checkFeeClaimStatus,
  validateSignedClaim,
  type FeeClaimStatusConnection,
} from "../src/lib/fee-claim-relay";

const owner = Keypair.generate();
const other = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();
const wallet = owner.publicKey.toBase58();

function prepared(payer = owner) {
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: other.publicKey,
      lamports: 1,
    }),
  );
  const unsigned = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  tx.sign(payer);
  return { unsigned, signed: tx.serialize().toString("base64"), tx };
}

test("valid signed legacy bytes and their signature are returned unchanged", () => {
  const { unsigned, signed, tx } = prepared();
  assert.deepEqual(validateSignedClaim(unsigned, signed, wallet), {
    raw: signed,
    signature: bs58.encode(tx.signature!),
  });
});

test("a valid signature over a changed transaction message is rejected", () => {
  const { unsigned, tx } = prepared();
  tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
  tx.sign(owner);
  assert.throws(
    () =>
      validateSignedClaim(unsigned, tx.serialize().toString("base64"), wallet),
    /message changed/,
  );
});

test("a changed recipient is rejected even when signed by the expected wallet", () => {
  const { unsigned, tx } = prepared();
  tx.instructions[0].keys[1].pubkey = Keypair.generate().publicKey;
  tx.sign(owner);
  assert.throws(
    () =>
      validateSignedClaim(unsigned, tx.serialize().toString("base64"), wallet),
    /message changed/,
  );
});

test("the expected and signed fee payer must match the authenticated wallet", () => {
  const own = prepared();
  const wrong = prepared(other);
  assert.throws(
    () => validateSignedClaim(own.unsigned, wrong.signed, wallet),
    /wrong fee payer/,
  );
  assert.throws(
    () => validateSignedClaim(wrong.unsigned, wrong.signed, wallet),
    /wrong fee payer/,
  );
});

test("another key cannot sign the expected wallet's unchanged message", () => {
  const { unsigned, tx } = prepared();
  tx.addSignature(
    owner.publicKey,
    Buffer.from(nacl.sign.detached(tx.serializeMessage(), other.secretKey)),
  );
  const signed = tx.serialize({ verifySignatures: false }).toString("base64");
  assert.throws(
    () => validateSignedClaim(unsigned, signed, wallet),
    /signature is missing or invalid/,
  );
});

test("missing or tampered signatures are rejected", () => {
  const { unsigned, signed } = prepared();
  assert.throws(
    () => validateSignedClaim(unsigned, unsigned, wallet),
    /signature is missing or invalid/,
  );
  const bytes = Buffer.from(signed, "base64");
  bytes[1] ^= 1;
  assert.throws(
    () => validateSignedClaim(unsigned, bytes.toString("base64"), wallet),
    /signature is missing or invalid/,
  );
});

test("malformed encodings and trailing wire bytes are rejected", () => {
  const { unsigned, signed } = prepared();
  assert.throws(
    () => validateSignedClaim(unsigned, `${signed}\n`, wallet),
    /encoding/,
  );
  const trailing = Buffer.concat([
    Buffer.from(signed, "base64"),
    Buffer.from([0]),
  ]);
  assert.throws(() =>
    validateSignedClaim(unsigned, trailing.toString("base64"), wallet),
  );
});

type Receipt = Awaited<
  ReturnType<FeeClaimStatusConnection["getSignatureStatuses"]>
>["value"][number];
const claim = {
  signature: bs58.encode(Buffer.alloc(64, 1)),
  lastValidBlockHeight: 100,
};
function rpc(receipts: Receipt[], height = 101) {
  const calls: string[] = [];
  const connection: FeeClaimStatusConnection = {
    async getSignatureStatuses(signatures, config) {
      assert.deepEqual(signatures, [claim.signature]);
      assert.deepEqual(config, { searchTransactionHistory: true });
      calls.push("history");
      assert.ok(receipts.length, "Unexpected extra status query");
      return { value: [receipts.shift()!] };
    },
    async getBlockHeight(commitment) {
      assert.equal(commitment, "finalized");
      calls.push("height");
      return height;
    },
  };
  return { connection, calls };
}

test("processed and confirmed transactions remain pending after blockhash expiry", async () => {
  for (const confirmationStatus of ["processed", "confirmed"] as const) {
    const { connection, calls } = rpc([{ err: null, confirmationStatus }]);
    assert.equal(await checkFeeClaimStatus(connection, claim), "pending");
    assert.deepEqual(calls, ["history"]);
  }
});

test("non-finalized errors remain pending and cannot unlock replacement", async () => {
  for (const confirmationStatus of [
    "processed",
    "confirmed",
    null,
    undefined,
  ] as const) {
    const { connection, calls } = rpc([
      { err: { InstructionError: [0, "InvalidArgument"] }, confirmationStatus },
    ]);
    assert.equal(await checkFeeClaimStatus(connection, claim), "pending");
    assert.deepEqual(calls, ["history"]);
  }
});

test("only finalized success and finalized failure are terminal", async () => {
  const success = rpc([{ err: null, confirmationStatus: "finalized" }]);
  assert.equal(
    await checkFeeClaimStatus(success.connection, claim),
    "finalized",
  );
  const failed = rpc([
    {
      err: { InstructionError: [0, "InvalidArgument"] },
      confirmationStatus: "finalized",
    },
  ]);
  assert.equal(await checkFeeClaimStatus(failed.connection, claim), "failed");
  assert.deepEqual(success.calls, ["history"]);
  assert.deepEqual(failed.calls, ["history"]);
});

test("missing transactions are still pending at the last valid block height", async () => {
  const { connection, calls } = rpc([null], 100);
  assert.equal(await checkFeeClaimStatus(connection, claim), "pending");
  assert.deepEqual(calls, ["history", "height"]);
});

test("expiry requires two history absences separated by a finalized height check", async () => {
  const { connection, calls } = rpc([null, null]);
  assert.equal(await checkFeeClaimStatus(connection, claim), "expired");
  assert.deepEqual(calls, ["history", "height", "history"]);
});

test("a receipt found on the second history check prevents false expiry", async () => {
  for (const [receipt, expected] of [
    [{ err: null, confirmationStatus: "processed" }, "pending"],
    [{ err: null, confirmationStatus: "finalized" }, "finalized"],
    [{ err: "failure", confirmationStatus: "processed" }, "pending"],
    [{ err: "failure", confirmationStatus: "confirmed" }, "pending"],
    [{ err: "failure", confirmationStatus: "finalized" }, "failed"],
  ] as const) {
    const { connection, calls } = rpc([null, receipt]);
    assert.equal(await checkFeeClaimStatus(connection, claim), expected);
    assert.deepEqual(calls, ["history", "height", "history"]);
  }
});

test("RPC failure and malformed status responses never become expired", async () => {
  const initial = rpc([null]);
  initial.connection.getBlockHeight = async () => {
    throw new Error("RPC timeout");
  };
  await assert.rejects(
    checkFeeClaimStatus(initial.connection, claim),
    /RPC timeout/,
  );
  const missing = rpc([null]);
  missing.connection.getSignatureStatuses = async () => ({ value: [] });
  await assert.rejects(
    checkFeeClaimStatus(missing.connection, claim),
    /status is unavailable/,
  );
});
