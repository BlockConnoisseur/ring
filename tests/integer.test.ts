import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toBigIntBE,
  toBigIntLE,
  toBufferBE,
  toBufferLE,
} from "../vendor/bigint-buffer/index.cjs";
test("unsigned integer codec handles u64/u128 boundaries without native memory access or truncation", () => {
  assert.equal(toBigIntLE(Buffer.from([255, 1])), 511n);
  assert.equal(toBigIntBE(Buffer.from([255, 1])), 65281n);
  for (const width of [1, 8, 16, 32]) {
    const max = (1n << BigInt(width * 8)) - 1n;
    assert.equal(toBigIntLE(toBufferLE(max, width)), max);
    assert.equal(toBigIntBE(toBufferBE(max, width)), max);
    assert.throws(() => toBufferLE(max + 1n, width), /overflow/);
  }
  assert.throws(() => toBufferBE(-1n, 8), /unsigned/);
  assert.throws(() => toBufferBE(1n, -1), /width/);
  assert.equal(toBigIntBE(Buffer.alloc(0)), 0n);
  assert.equal(toBufferBE(0n, 0).length, 0);
  const original = Buffer.from([1, 2, 3]);
  toBigIntLE(original);
  assert.deepEqual(original, Buffer.from([1, 2, 3]));
});
