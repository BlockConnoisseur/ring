import { createServer } from "node:http";
import "./execution-worker";
import "./question-worker";

// Persistent automation on Render. The public endpoint exposes process health
// only; signing and question imports cannot be triggered through HTTP.
const server = createServer((req, res) => {
  if (req.method !== "GET" || req.url !== "/healthz") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify({ running: true }));
});
server.listen(Number(process.env.PORT || 3322), "0.0.0.0", () => {
  console.log("Ring automation running; game readiness is checked separately.");
});
