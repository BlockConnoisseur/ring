import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestGate } from "../src/lib/capacity";

test("100 speech requests respect provider concurrency and FIFO order", async () => {
  const gate = new RequestGate(12, 100);
  let active = 0,
    peak = 0;
  const order: number[] = [];
  await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      gate.run(async () => {
        order.push(i);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      }),
    ),
  );
  assert.equal(peak, 12);
  assert.deepEqual(
    order,
    Array.from({ length: 100 }, (_, i) => i),
  );
});

test("failed, overflowing and timed-out speech jobs do not leak slots", async () => {
  const gate = new RequestGate(1, 1);
  let release!: () => void;
  const first = gate.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const expired = gate.run(
    async () => assert.fail("expired work must not run"),
    10,
  );
  await assert.rejects(
    gate.run(async () => {}),
    /busy/,
  );
  await assert.rejects(expired, /timed out/);
  release();
  await first;
  await assert.rejects(
    gate.run(async () => {
      throw new Error("provider failed");
    }),
    /provider failed/,
  );
  assert.equal(await gate.run(async () => "healthy"), "healthy");
});
