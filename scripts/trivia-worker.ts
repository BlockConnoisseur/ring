import { readStore, transact } from "../src/lib/store";
import { targetFor } from "../src/lib/game";
import { callCapacity } from "../src/lib/capacity";
import { acquireLease } from "../src/lib/operations";
import { importQuestions } from "../src/lib/questions";
import { requestTrivia } from "../src/lib/trivia";

let running = false;
async function tick() {
  if (running || process.env.RING_LIVE !== "true") return;
  running = true;
  let lease: Awaited<ReturnType<typeof acquireLease>> = null;
  try {
    lease = await acquireLease("trivia", 60000);
    if (!lease) return;
    const state = await readStore();
    if (Date.now() < (state.triviaFeed?.nextSync || 0)) return;
    if (
      state.questions.filter((q) => !q.used).length >=
      Math.max(2000, targetFor(state.wins) * callCapacity() * 2)
    )
      return;
    // Persist spacing before requesting, including across restarts/replicas.
    await transact((s) => {
      s.triviaFeed = { ...s.triviaFeed, nextSync: Date.now() + 20000 };
    });
    const result = await requestTrivia(state.triviaFeed?.token);
    await lease.renew();
    const count = await transact((s) => {
      const imported = importQuestions(s, result.questions);
      const exhausted = result.code === 1 || result.code === 4;
      s.triviaFeed = {
        token: result.code === 3 || exhausted ? undefined : result.token,
        nextSync:
          Date.now() +
          (exhausted ? 3600000 : result.code === 0 ? 10000 : 60000),
        error:
          result.code === 0
            ? undefined
            : `Trivia source code ${result.code}; existing questions remain available.`,
      };
      return imported;
    });
    if (count)
      console.log(`Ring added ${count} fresh general trivia questions.`);
  } catch {
    await transact((s) => {
      s.triviaFeed = {
        ...s.triviaFeed,
        nextSync: Date.now() + 60000,
        error: "Trivia source unavailable; retrying in one minute.",
      };
    });
    console.warn(
      "General trivia import pending; retired questions stay retired.",
    );
  } finally {
    running = false;
    if (lease) await lease.release();
  }
}
const run = () =>
  void tick().catch(() =>
    console.warn("Trivia worker could not reach its database."),
  );
run();
setInterval(run, 10000);
