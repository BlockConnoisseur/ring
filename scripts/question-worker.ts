import { readStore, transact } from "../src/lib/store";
import { targetFor } from "../src/lib/game";
import { acquireLease } from "../src/lib/operations";
import {
  fetchQuestionBatch,
  fetchScienceQuestions,
  importQuestions,
} from "../src/lib/questions";
let running = false;
async function tick() {
  if (running || process.env.RING_LIVE !== "true") return;
  const state = readStore();
  if (
    state.questions.filter((q) => !q.used).length >=
    Math.max(100, targetFor(state.wins) * 10)
  )
    return;
  if (Date.now() - (state.questionFeed?.lastSync || 0) < 300_000) return;
  const lease = acquireLease("questions", 180000);
  if (!lease) return;
  running = true;
  try {
    const offset = state.questionFeed?.offset || 0;
    const science = offset === 0 ? await fetchScienceQuestions() : [];
    let count = transact((s) => importQuestions(s, science));
    const art = await fetchQuestionBatch("paintings", offset);
    count += transact((s) => importQuestions(s, art));
    lease.renew();
    const novels = await fetchQuestionBatch("novels", offset);
    lease.renew();
    count += transact((s) => {
      const count = importQuestions(s, novels);
      s.questionFeed = { offset: offset + 300, lastSync: Date.now() };
      return count;
    });
    console.log(`Ring added ${count} fresh questions.`);
  } catch {
    transact((s) => {
      s.questionFeed = {
        offset: s.questionFeed?.offset || 0,
        lastSync: Date.now(),
        error: "Question source unavailable; retrying in five minutes.",
      };
    });
    console.warn(
      "Question import pending. Used questions will not be recycled.",
    );
  } finally {
    running = false;
    lease.release();
  }
}
void tick();
setInterval(() => void tick(), 60_000);
