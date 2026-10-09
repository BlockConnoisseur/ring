import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { readStore, transact } from "../src/lib/store";
import {
  latestFeeClaim,
  prepareFeeClaim,
  retryFeeClaim,
  submitFeeClaim,
  type FeeClaimRecord,
} from "../src/lib/fee-claim-service";

process.env.RING_STORAGE = "sqlite";
process.env.RING_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ring-fee-service-")),
  "test.sqlite",
);
process.env.SOLANA_RPC_URL = "http://127.0.0.1:9";

async function fixture() {
  const signer = Keypair.generate();
  const wallet = signer.publicKey.toBase58();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const transaction = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  const unsigned = transaction
    .serialize({ requireAllSignatures: false })
    .toString("base64");
  transaction.sign(signer);
  const signed = transaction.serialize().toString("base64");
  const signature = bs58.encode(transaction.signature!);
  const record: FeeClaimRecord = {
    id: randomUUID(),
    wallet,
    createdAt: Date.now(),
    prepared: {
      transaction: unsigned,
      blockhash,
      lastValidBlockHeight: 100,
      estimatedNetworkFeeLamports: 5000,
      rentDepositLamports: 0,
      refundableRentLamports: 0,
      status: {
        mint: wallet,
        pool: wallet,
        config: wallet,
        feeClaimer: wallet,
        migrated: false,
        canClaim: true,
        baseAmountRaw: "0",
        quoteAmountRaw: "1000",
        baseAmount: "0",
        quoteAmount: "0.000001",
        baseDecimals: 6,
        quoteDecimals: 9,
        payout: "SOL",
        scope: "dbc_partner",
        notice: "Test fixture",
        slot: 1,
      },
    },
  };
  await transact((s) => {
    s.feeClaims ??= {};
    s.feeClaims[wallet] = record;
  });
  return { wallet, record, signed, signature, transaction, signer };
}

test("ambiguous submission persists signed bytes before send and retries the identical transaction", async (t) => {
  const f = await fixture();
  t.mock.method(
    Connection.prototype,
    "getSignatureStatuses",
    async function (this: Connection) {
      // web3.js defines getBlockHeight as an instance field, not a prototype method.
      this.getBlockHeight = async (commitment) => {
        assert.equal(commitment, "finalized");
        return 99;
      };
      return { context: { slot: 1 }, value: [null] };
    },
  );
  const sends: string[] = [];
  t.mock.method(
    Connection.prototype,
    "sendRawTransaction",
    async (bytes: Uint8Array) => {
      const persisted = (await readStore()).feeClaims![f.wallet];
      assert.equal(persisted.signature, f.signature);
      assert.equal(persisted.signed, f.signed);
      sends.push(Buffer.from(bytes).toString("base64"));
      throw new Error("Connection dropped after broadcast");
    },
  );
  const first = await submitFeeClaim(f.wallet, f.record.id, f.signed);
  assert.equal(first.status, "pending");
  assert.equal(first.signature, f.signature);
  const retry = await retryFeeClaim(f.wallet, f.record.id);
  assert.equal(retry.status, "pending");
  assert.deepEqual(sends, [f.signed, f.signed]);
  assert.equal((await readStore()).feeClaims![f.wallet].terminal, undefined);
});

test("finalized success and failure stay terminal when RPC history later disappears", async (t) => {
  for (const [err, expected] of [
    [null, "finalized"],
    [{ InstructionError: [0, "InvalidArgument"] }, "failed"],
  ] as const) {
    const f = await fixture();
    await transact((s) => {
      s.feeClaims![f.wallet].signature = f.signature;
      s.feeClaims![f.wallet].signed = f.signed;
    });
    let statusCalls = 0;
    const getStatus = t.mock.method(
      Connection.prototype,
      "getSignatureStatuses",
      async () => {
        statusCalls++;
        return {
          context: { slot: 1 },
          value: [
            {
              err,
              confirmationStatus: "finalized",
              confirmations: null,
              slot: 1,
            },
          ],
        };
      },
    );
    const first = await latestFeeClaim(f.wallet);
    assert.equal(first?.status, expected);
    assert.equal((await readStore()).feeClaims![f.wallet].terminal, expected);
    getStatus.mock.mockImplementation(async () => {
      throw new Error("RPC history unavailable");
    });
    assert.equal((await latestFeeClaim(f.wallet))?.status, expected);
    assert.equal(statusCalls, 1);
    getStatus.mock.restore();
  }
});

test("an error before finality stays pending and preparation reuses that operation", async (t) => {
  const f = await fixture();
  await transact((s) => {
    s.feeClaims![f.wallet].signature = f.signature;
    s.feeClaims![f.wallet].signed = f.signed;
  });
  t.mock.method(
    Connection.prototype,
    "getSignatureStatuses",
    async function (this: Connection) {
      this.getBlockHeight = async () => {
        throw new Error("Existing receipt must not be expired");
      };
      return {
        context: { slot: 1 },
        value: [
          {
            err: { InstructionError: [0, "InvalidArgument"] },
            confirmationStatus: "confirmed",
            confirmations: 1,
            slot: 1,
          },
        ],
      };
    },
  );
  t.mock.method(Connection.prototype, "sendRawTransaction", async () => {
    throw new Error("Preparation must not broadcast");
  });
  const current = await prepareFeeClaim(f.wallet);
  assert.equal(current.id, f.record.id);
  assert.equal(current.status, "pending");
  assert.equal((await readStore()).feeClaims![f.wallet].terminal, undefined);
});

test("wrong wallet, stale operation id, and altered messages cannot change the stored operation", async (t) => {
  const f = await fixture();
  let sends = 0;
  t.mock.method(Connection.prototype, "sendRawTransaction", async () => {
    sends++;
    throw new Error("Must not broadcast");
  });
  await assert.rejects(
    submitFeeClaim(
      Keypair.generate().publicKey.toBase58(),
      f.record.id,
      f.signed,
    ),
    /preparation expired/,
  );
  await assert.rejects(
    submitFeeClaim(f.wallet, randomUUID(), f.signed),
    /preparation expired/,
  );
  f.transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
  f.transaction.sign(f.signer);
  await assert.rejects(
    submitFeeClaim(
      f.wallet,
      f.record.id,
      f.transaction.serialize().toString("base64"),
    ),
    /message changed/,
  );
  assert.equal(sends, 0);
  assert.deepEqual((await readStore()).feeClaims![f.wallet], f.record);
});
