import { readStore } from "../src/lib/store";
import { executeWin } from "../src/lib/executor";
if (!process.env.RING_EXECUTOR_URL || !process.env.RING_EXECUTOR_SECRET)
  throw new Error("Configure the token execution adapter first.");
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const first = readStore().executions.find((e) => e.status !== "applied");
    if (first) await executeWin(first.gameId);
  } catch {
    console.warn("Execution pending. Retrying the same idempotency key.");
  } finally {
    running = false;
  }
}
void tick();
setInterval(() => void tick(), 15000);
