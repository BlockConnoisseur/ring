import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import {
  operation,
  runOperation,
  acquireLease,
  type TransactionTransport,
} from "../src/lib/operations";
import { nextMetadata } from "../src/lib/token-metadata";
import { publishAsset, getAsset } from "../src/lib/assets";
import { applyExecution, feeMemo } from "../src/lib/executor";
import { emptyStore, type Game } from "../src/lib/game";
import type { Proposal } from "../src/lib/types";

process.env.RING_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ring-execution-")),
  "test.sqlite",
);
process.env.RING_ASSET_ORIGIN = "https://ring.example";
const proposal: Proposal = {
  id: "p",
  title: "New description",
  kind: "description",
  value: "The coin is on the line.",
  note: "",
  wallet: "wallet",
  username: "caller",
  status: "won",
  comments: 0,
  createdAt: 0,
};

test("broadcast failure recovers identical persisted transaction; finality applies only once", async () => {
  let status: Awaited<ReturnType<TransactionTransport["status"]>> = "missing",
    sends = 0,
    builds = 0;
  const rpc: TransactionTransport = {
    status: async () => status,
    finalizedHeight: async () => 10,
    send: async (raw) => {
      assert.equal(raw, "signed-bytes");
      assert.equal(operation("retry")?.raw, raw);
      sends++;
      if (sends === 1) throw new Error("timeout after broadcast");
    },
  };
  const build = async () => {
    builds++;
    return {
      raw: "signed-bytes",
      signature: "signature",
      lastValidBlockHeight: 20,
    };
  };
  await assert.rejects(
    runOperation("retry", { recipient: "A" }, rpc, build),
    /timeout/,
  );
  assert.equal(
    await runOperation("retry", { recipient: "A" }, rpc, build),
    null,
  );
  status = "finalized";
  assert.equal(
    await runOperation("retry", { recipient: "A" }, rpc, build),
    "signature",
  );
  assert.equal(
    await runOperation("retry", { recipient: "A" }, rpc, build),
    "signature",
  );
  assert.equal(builds, 1);
  assert.equal(sends, 2);
  await assert.rejects(
    runOperation("retry", { recipient: "B" }, rpc, build),
    /intent changed/,
  );
});

test("expired transaction is replaced only after finalized height and history both prove it missing", async () => {
  let height = 5,
    calls = 0,
    pending = false,
    builds = 0;
  const rpc: TransactionTransport = {
    status: async () => {
      calls++;
      return pending ? "pending" : "missing";
    },
    finalizedHeight: async () => height,
    send: async () => {},
  };
  const build = async () => ({
    raw: `bytes-${++builds}`,
    signature: `sig-${builds}`,
    lastValidBlockHeight: 10,
  });
  await runOperation("expiry", {}, rpc, build);
  await runOperation("expiry", {}, rpc, build);
  assert.equal(builds, 1);
  height = 11;
  pending = true;
  await runOperation("expiry", {}, rpc, build);
  assert.equal(builds, 1);
  pending = false;
  calls = 0;
  await runOperation("expiry", {}, rpc, build);
  assert.equal(builds, 2);
  assert.equal(calls, 2);
});

test("two workers share a lease; release allows a new worker", () => {
  const first = acquireLease("test");
  assert.ok(first);
  assert.equal(acquireLease("test"), null);
  first.renew();
  first.release();
  const second = acquireLease("test");
  assert.ok(second);
  second.release();
});

test("metadata changes preserve unrelated token fields and replace image attachments only", () => {
  const original = {
    name: "Ring",
    symbol: "RING",
    image: "old",
    description: "old description",
    attributes: [{ trait_type: "version", value: 1 }],
    properties: {
      creators: ["keep"],
      files: [
        { uri: "old", type: "image/png" },
        { uri: "movie", type: "video/mp4" },
      ],
    },
  };
  assert.deepEqual(nextMetadata(original, proposal), {
    ...original,
    description: proposal.value,
  });
  const next = nextMetadata(
    original,
    { ...proposal, kind: "picture", image: "data:image/png;base64,AAAA" },
    "new",
  ) as typeof original;
  assert.equal(next.name, "Ring");
  assert.equal(next.description, "old description");
  assert.equal(next.image, "new");
  assert.deepEqual(next.properties.files, [
    { uri: "movie", type: "video/mp4" },
    { uri: "new", type: "image/png" },
  ]);
  assert.deepEqual(next.properties.creators, ["keep"]);
});

test("assets are immutable and content-addressed", () => {
  const uri = publishAsset(Buffer.from("image bytes"), "image/png");
  assert.equal(publishAsset(Buffer.from("image bytes"), "image/png"), uri);
  assert.notEqual(publishAsset(Buffer.from("other bytes"), "image/png"), uri);
  assert.equal(
    Buffer.from(getAsset(uri.split("/").pop()!)!.bytes).toString(),
    "image bytes",
  );
  assert.equal(getAsset("../../keypair"), undefined);
});

test("fee recipient changes exactly once after a verified win and finalized operation", () => {
  const s = emptyStore();
  s.proposals = [{ ...proposal, kind: "fees", value: "new-recipient" }];
  s.games = [{ id: "game", status: "won" } as Game];
  s.executions = [
    { id: "job", gameId: "game", proposalId: "p", status: "pending" },
  ];
  s.fees = {
    recipient: "old-recipient",
    since: 0,
    lastClaimAt: 0,
    receipts: [],
  };
  applyExecution(s, "game", "tx", 100);
  assert.equal(s.fees.recipient, "new-recipient");
  assert.equal(s.proposals[0].transaction, "tx");
  applyExecution(s, "game", "different-tx", 200);
  assert.equal(s.fees.since, 100);
  assert.equal(s.executions[0].transaction, "tx");
  assert.throws(() => applyExecution(s, "forged", "tx"), /verified win/);
  const memo = feeMemo(
    Keypair.generate().publicKey,
    "mint",
    "proposal",
    "recipient",
  );
  assert.equal(memo.instructions.length, 1);
  assert.equal(
    memo.instructions[0].programId.toBase58(),
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  );
});
