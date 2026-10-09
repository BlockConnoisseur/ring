import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrivia } from "../src/lib/trivia";
import { importQuestions } from "../src/lib/questions";
import { emptyStore } from "../src/lib/game";

const encode = (text: string) => Buffer.from(text).toString("base64");
const row = (question = "Which planet is known as the red planet?") => ({
  question: encode(question),
  correct_answer: encode("Mars"),
  incorrect_answers: ["Venus", "Earth", "Jupiter"].map(encode),
});
test("trivia imports decode correctly and never revive retired questions after token changes", () => {
  const state = emptyStore();
  const parsed = parseTrivia({ response_code: 0, results: [row()] });
  assert.equal(
    parsed.questions[0].choices[parsed.questions[0].correct],
    "Mars",
  );
  assert.equal(importQuestions(state, parsed.questions), 1);
  state.questions[0].used = true;
  assert.equal(
    importQuestions(
      state,
      parseTrivia({
        response_code: 0,
        results: [row("WHICH planet is known as the red planet?!")],
      }).questions,
    ),
    0,
  );
  assert.equal(state.questions[0].used, true);
});
test("malformed and ambiguous trivia rows are excluded without losing valid rows", () => {
  const invalid = [
    { ...row(), question: "not base64" },
    { ...row(), incorrect_answers: ["MARS", "Venus", "Earth"].map(encode) },
    { ...row(), correct_answer: encode("Mars\u0000") },
    { ...row(), incorrect_answers: [encode("Venus")] },
    row("x".repeat(301)),
  ];
  const parsed = parseTrivia({
    response_code: 0,
    results: [...invalid, row()],
  });
  assert.equal(parsed.questions.length, 1);
});
test("source errors cannot import results and malformed success responses fail", () => {
  for (const code of [1, 2, 3, 4, 5]) {
    assert.deepEqual(parseTrivia({ response_code: code, results: [row()] }), {
      code,
      questions: [],
    });
  }
  assert.throws(() => parseTrivia({ response_code: 0 }));
});
