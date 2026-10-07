import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioWindow } from "../src/lib/audio-window";
import {
  emptyStore,
  enqueue,
  refreshCode,
  cancelQueue,
  hash,
} from "../src/lib/game";
import { importQuestions, questionsFromFacts } from "../src/lib/questions";

test("audio clips at eight seconds and repeated frames cannot fake coverage", () => {
  const window = new AudioWindow(1000);
  window.add(500, Buffer.alloc(8000, 42));
  assert.equal(window.covered, 4000);
  window.add(500, Buffer.alloc(8000, 42));
  assert.equal(window.covered, 4000);
  window.add(8500, Buffer.alloc(8000, 43));
  assert.equal(window.covered, 8000);
  window.add(9000, Buffer.alloc(8000, 44));
  assert.equal(window.covered, 8000);
  assert.equal(window.audio[63999], 43);
  window.clear();
  assert.equal(window.covered, 0);
});

test("canonical fact keys retire reworded imports and reject ambiguous source facts", () => {
  const s = emptyStore();
  const q = {
    fact: "wikidata:Q1:P170",
    text: "Who painted this painting?",
    choices: ["A", "B", "C", "D"],
    correct: 0,
    source: "https://www.wikidata.org/wiki/Q1",
  };
  assert.equal(importQuestions(s, [q]), 1);
  s.questions[0].used = true;
  assert.equal(
    importQuestions(s, [{ ...q, text: "Which artist created this painting?" }]),
    0,
  );
  assert.equal(s.questions[0].used, true);
  const rows = Array.from({ length: 5 }, (_, i) => ({
    item: { value: `https://wikidata.org/entity/Q${i}` },
    itemLabel: { value: `Painting ${i}` },
    answer: { value: `https://wikidata.org/entity/A${i}` },
    answerLabel: { value: `Artist ${i}` },
  }));
  rows.push({
    ...rows[0],
    answer: { value: "other" },
    answerLabel: { value: "Someone else" },
  });
  const generated = questionsFromFacts(
    rows,
    "P170",
    (name) => `Who painted ${name}?`,
  );
  assert.equal(generated.length, 4);
  assert.ok(generated.every((q) => q.fact !== "wikidata:Q0:P170"));
});

test("lost call code can be replaced without extending expiry or consuming an attempt", () => {
  const s = emptyStore();
  s.wallets.wallet = { username: "caller", cooldownUntil: 0 };
  s.proposals.push({
    id: "p",
    wallet: "wallet",
    username: "caller",
    title: "Picture",
    kind: "picture",
    value: "",
    note: "",
    status: "open",
    createdAt: 0,
    comments: 0,
  });
  const before = enqueue(s, "wallet", "p", 0),
    after = refreshCode(s, "wallet", 1000);
  assert.notEqual(before.code, after.code);
  assert.equal(after.expiresAt, before.expiresAt);
  assert.equal(s.queue[0].codeHash, hash(after.code));
  assert.equal(s.wallets.wallet.cooldownUntil, 0);
  cancelQueue(s, "wallet");
  assert.equal(s.proposals[0].status, "open");
  assert.equal(s.queue[0].status, "done");
});
