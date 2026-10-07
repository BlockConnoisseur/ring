import { executorTick } from "../src/lib/executor";
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await executorTick();
  } catch {
    console.warn("Ring execution pending. Run npm run doctor for diagnostics.");
  } finally {
    running = false;
  }
}
void tick();
setInterval(() => void tick(), 5000);
