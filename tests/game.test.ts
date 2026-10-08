import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answer,
  attachStream,
  beginGame,
  COOLDOWN_MS,
  emptyStore,
  enqueue,
  expireQueue,
  firstSpokenChoice,
  finish,
  openQuestion,
  startQuestionPlayback,
  targetFor,
  timeout,
  type Store,
} from "../src/lib/game";
function fixture(): Store {
  const s = emptyStore();
  for (const wallet of ["alice", "bob"]) {
    s.wallets[wallet] = { username: wallet, cooldownUntil: 0 };
    s.proposals.push({
      id: wallet,
      wallet,
      username: wallet,
      title: "Change this description",
      kind: "description",
      value: "A test description",
      note: "",
      status: "open",
      createdAt: 0,
      comments: 0,
    });
  }
  s.questions = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    fact: `fact-${i}`,
    text: `Test question ${i}`,
    choices: ["A", "B", "C", "D"],
    correct: i % 4,
    source: "test fixture",
    used: false,
  }));
  return s;
}
test("global target rises by two without a cap", () => {
  assert.equal(targetFor(0), 3);
  assert.equal(targetFor(1), 5);
  assert.equal(targetFor(10), 23);
});
test("reserving a place does not consume an attempt", () => {
  const s = fixture();
  enqueue(s, "alice", "alice", 1000);
  assert.equal(s.wallets.alice.cooldownUntil, 0);
});
test("a full win increases global target exactly once and enqueues one execution", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const g = beginGame(s, q.code, "call", 1100);
  for (let i = 0; i < 3; i++) {
    openQuestion(s, g.id, 2000 + i * 10000);
    answer(s, g.id, g.questions[i].correct, 2001 + i * 10000);
  }
  assert.equal(g.status, "won");
  assert.equal(s.wins, 1);
  assert.equal(s.executions.length, 1);
  answer(s, g.id, 0, 50000);
  assert.equal(s.wins, 1);
  assert.equal(s.executions.length, 1);
});
test("cooldown starts with first question; a disconnect still counts", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const g = beginGame(s, q.code, "call", 1100);
  assert.equal(s.wallets.alice.cooldownUntil, 0);
  openQuestion(s, g.id, 2000);
  finish(s, g, "lost");
  assert.equal(s.wallets.alice.cooldownUntil, 2000 + COOLDOWN_MS);
  assert.throws(() => enqueue(s, "alice", "alice", 3000), /cooldown/);
  assert.doesNotThrow(() => enqueue(s, "alice", "alice", 2000 + COOLDOWN_MS));
});
test("a wrong answer ends the run without changing difficulty", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const g = beginGame(s, q.code, "call", 1100);
  openQuestion(s, g.id, 2000);
  answer(s, g.id, (g.questions[0].correct + 1) % 4, 2001);
  assert.equal(g.status, "lost");
  assert.equal(s.wins, 0);
});
test("an answer past eight seconds fails, even when correct", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const g = beginGame(s, q.code, "call", 1100);
  openQuestion(s, g.id, 2000);
  answer(s, g.id, g.questions[0].correct, 10001);
  assert.equal(g.status, "lost");
});
test("pre-beep answers cannot be accepted; exact deadline is valid", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const g = beginGame(s, q.code, "call", 1100);
  answer(s, g.id, g.questions[0].correct, 1200);
  assert.equal(g.index, 0);
  openQuestion(s, g.id, 2000);
  answer(s, g.id, g.questions[0].correct, 1999);
  assert.equal(g.index, 0);
  answer(s, g.id, g.questions[0].correct, 10000);
  assert.equal(g.index, 1);
});
test("no answer times out and keeps the cooldown", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const g = beginGame(s, q.code, "call", 1100);
  openQuestion(s, g.id, 2000);
  timeout(s, g.id, 10000);
  assert.equal(g.status, "lost");
  assert.equal(s.wallets.alice.cooldownUntil, 602000);
});
test("every caller reserves a disjoint question set", () => {
  const s = fixture();
  const a = enqueue(s, "alice", "alice", 1000);
  const ga = beginGame(s, a.code, "a", 1100);
  finish(s, ga, "lost");
  const b = enqueue(s, "bob", "bob", 1200);
  const gb = beginGame(s, b.code, "b", 1300);
  assert.equal(
    ga.questions.some((q) => gb.questions.some((other) => other.id === q.id)),
    false,
  );
});
test("insufficient unused questions does not start an attempt", () => {
  const s = fixture();
  s.questions = s.questions.slice(0, 2);
  const q = enqueue(s, "alice", "alice", 1000);
  assert.throws(() => beginGame(s, q.code, "a", 1100), /prepared/);
  assert.equal(s.games.length, 0);
  assert.equal(s.wallets.alice.cooldownUntil, 0);
});
test("callers can start out of queue order and play independently", () => {
  const s = fixture();
  const a = enqueue(s, "alice", "alice", 1000);
  const b = enqueue(s, "bob", "bob", 1001);
  const gb = beginGame(s, b.code, "b", 1100);
  const ga = beginGame(s, a.code, "a", 1200);
  assert.equal(s.games.filter((g) => g.status === "playing").length, 2);
  assert.equal(
    ga.questions.some((q) => gb.questions.some((other) => other.id === q.id)),
    false,
  );
  for (let i = 0; i < ga.target; i++) {
    openQuestion(s, ga.id, 2000 + i * 10000);
    answer(s, ga.id, ga.questions[i].correct, 2001 + i * 10000);
  }
  assert.equal(targetFor(s.wins), 5);
  assert.equal(
    gb.target,
    3,
    "an active caller keeps the target quoted at admission",
  );
  assert.equal(gb.status, "playing");
});

test("capacity rejection preserves the code, question pool and attempt", () => {
  const saved = process.env.RING_MAX_ACTIVE_CALLS;
  process.env.RING_MAX_ACTIVE_CALLS = "1";
  try {
    const s = fixture();
    const a = enqueue(s, "alice", "alice", 1000);
    const b = enqueue(s, "bob", "bob", 1001);
    const ga = beginGame(s, a.code, "a", 1100);
    assert.throws(() => beginGame(s, b.code, "b", 1200), /slots are busy/);
    assert.equal(s.questions.filter((q) => q.used).length, 3);
    assert.equal(s.wallets.bob.cooldownUntil, 0);
    finish(s, ga, "lost");
    assert.equal(beginGame(s, b.code, "b", 1300).status, "playing");
  } finally {
    if (saved === undefined) delete process.env.RING_MAX_ACTIVE_CALLS;
    else process.env.RING_MAX_ACTIVE_CALLS = saved;
  }
});

test("an active game blocks another attempt even after ten minutes", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  beginGame(s, q.code, "a", 1100);
  assert.throws(() => enqueue(s, "alice", "alice", 4_000_000), /active call/);
});
test("a reused provider callback returns the same game", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const a = beginGame(s, q.code, "same-call", 1100);
  assert.equal(beginGame(s, q.code, "same-call", 1200).id, a.id);
  assert.equal(s.games.length, 1);
});
test("expired queue codes release proposals", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  expireQueue(s, q.expiresAt);
  assert.equal(s.proposals[0].status, "open");
  assert.throws(() => beginGame(s, q.code, "a", q.expiresAt), /expired/);
});
test("phone answer vocabulary maps single letters, keypad names, and phonetic forms", () => {
  assert.equal(firstSpokenChoice("Bravo."), 1);
  assert.equal(firstSpokenChoice("D"), 3);
  assert.equal(firstSpokenChoice("three"), 2);
  assert.equal(firstSpokenChoice("banana"), null);
  assert.equal(firstSpokenChoice("B no C"), 1);
});
test("hanging up while the first question is being read consumes the attempt", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const g = beginGame(s, q.code, "call", 1100);
  startQuestionPlayback(s, g.id, 1200);
  openQuestion(s, g.id, 9000);
  assert.equal(s.wallets.alice.cooldownUntil, 601200);
  finish(s, g, "lost");
  assert.throws(() => enqueue(s, "alice", "alice", 10000), /cooldown/);
});
test("a second phone stream cannot attach to an existing game", () => {
  const s = fixture();
  const q = enqueue(s, "alice", "alice", 1000);
  const g = beginGame(s, q.code, "call", 1100);
  attachStream(s, g.id, "stream-one");
  assert.throws(() => attachStream(s, g.id, "stream-two"), /already/);
  assert.equal(g.streamSid, "stream-one");
});
