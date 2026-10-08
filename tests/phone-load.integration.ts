// Real HTTP/WebSocket worker, synthetic provider audio; never calls real phone numbers.
process.env.RING_STORAGE = "sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import twilio from "twilio";
import { WebSocket } from "ws";
import { Keypair } from "@solana/web3.js";
import { readStore, transact } from "../src/lib/store";
import { enqueue } from "../src/lib/game";

process.env.RING_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ring-load-")),
  "test.sqlite",
);
const callers = Number(process.env.RING_LOAD_CALLERS || 60);
assert.ok(Number.isInteger(callers) && callers >= 2 && callers <= 100);

test(
  `${callers} simultaneous signed calls complete independent timed games`,
  { timeout: 90_000 },
  async (t) => {
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const mint = Keypair.generate().publicKey.toBase58();
    const codes = await transact((s) => {
      s.questions = Array.from({ length: callers * 3 + 3 }, (_, i) => ({
        id: `q${i}`,
        fact: `f${i}`,
        text: `Test question ${i}`,
        choices: ["One", "Two", "Three", "Four"],
        correct: i % 4,
        source: "test",
        used: false,
      }));
      return Array.from({ length: callers }, (_, i) => {
        const wallet = Keypair.generate().publicKey.toBase58();
        s.wallets[wallet] = { username: `caller${i}`, cooldownUntil: 0 };
        s.proposals.push({
          id: wallet,
          wallet,
          username: `caller${i}`,
          title: "A new description",
          kind: "description",
          value: "Ring",
          note: "",
          status: "open",
          comments: 0,
          createdAt: Date.now(),
        });
        return enqueue(s, wallet, wallet).code;
      });
    });
    const auth = "test-secret",
      sid = "AC" + "1".repeat(32),
      base = "https://voice.ring.test";
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        pathToFileURL(resolve("tests/fixtures/providers.ts")).href,
        "scripts/voice-server.ts",
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          VOICE_PORT: String(port),
          VOICE_HOST: "127.0.0.1",
          VOICE_PUBLIC_URL: base,
          TWILIO_AUTH_TOKEN: auth,
          TWILIO_ACCOUNT_SID: sid,
          DEEPGRAM_API_KEY: "test",
          RING_MAX_ACTIVE_CALLS: "100",
          RING_LIVE: "true",
          RING_TOKEN_MINT: mint,
          SOLANA_RPC_URL: "http://rpc.test",
          RING_PHONE_NUMBER: "+12025550123",
          RING_SIGNER: "keypair",
          RING_AUTHORITY_KEYPAIR: "test",
          RING_DBC_POOL: mint,
          RING_INITIAL_FEE_RECIPIENT: mint,
          APP_ORIGIN: "https://ring.test",
        },
      },
    );
    const sockets: WebSocket[] = [];
    let logs = "";
    child.stderr.on("data", (b) => {
      logs += String(b);
    });
    const callSid = (i: number) => "CA" + String(i).padStart(32, "0");
    async function post(path: string, i: number, data: Record<string, string>) {
      const form = { AccountSid: sid, CallSid: callSid(i), ...data };
      return fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
            auth,
            base + path,
            form,
          ),
        },
        body: new URLSearchParams(form),
      });
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Worker startup timeout: ${logs}`)),
          15000,
        );
        child.stdout.on("data", (b) => {
          if (String(b).includes("worker ready")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Worker exited ${code}: ${logs}`));
        });
      });
      const admissionStart = performance.now();
      await Promise.all(
        codes.map(async (code, i) => {
          assert.match(
            await (await post("/code", i, { Digits: code })).text(),
            /<Stream/,
          );
        }),
      );
      const admitted = await readStore();
      assert.equal(admitted.games.length, callers);
      assert.equal(
        new Set(admitted.games.flatMap((g) => g.questions.map((q) => q.id)))
          .size,
        callers * 3,
      );
      t.diagnostic(
        `${callers} admissions: ${Math.round(performance.now() - admissionStart)}ms`,
      );
      await Promise.all(
        codes.map(async (_, i) => {
          const game = admitted.games.find((g) => g.callSid === callSid(i))!;
          const streamSid = "MZ" + String(i).padStart(32, "0");
          const ws = new WebSocket(`ws://127.0.0.1:${port}/stream`, {
            headers: {
              "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
                auth,
                base + "/stream",
                {},
              ),
            },
          });
          sockets.push(ws);
          let start = 0,
            questionCount = 0;
          const done = new Promise<void>((resolve, reject) => {
            ws.on("close", resolve);
            ws.on("error", reject);
          });
          ws.on("message", (raw) => {
            const event = JSON.parse(raw.toString());
            if (event.event !== "mark") return;
            ws.send(
              JSON.stringify({ event: "mark", streamSid, mark: event.mark }),
            );
            if (event.mark.name === "end") return;
            questionCount++;
            const index = Number(event.mark.name.split(":")[1]);
            for (let second = 0; second < 8; second++)
              ws.send(
                JSON.stringify({
                  event: "media",
                  streamSid,
                  media: {
                    timestamp: String(start + second * 1000),
                    payload: Buffer.alloc(8000, 255).toString("base64"),
                  },
                }),
              );
            start += 8000;
            ws.send(
              JSON.stringify({
                event: "dtmf",
                streamSid,
                dtmf: { digit: String(game.questions[index].correct + 1) },
              }),
            );
          });
          await once(ws, "open");
          ws.send(
            JSON.stringify({
              event: "start",
              start: {
                callSid: callSid(i),
                accountSid: sid,
                streamSid,
                customParameters: {
                  gameId: game.id,
                  token: createHmac("sha256", auth)
                    .update(`${game.id}:${callSid(i)}`)
                    .digest("hex"),
                },
              },
            }),
          );
          await done;
          assert.equal(questionCount, 3, `caller ${i}: ${logs}`);
        }),
      );
      const result = await readStore();
      assert.equal(result.wins, callers);
      assert.equal(result.executions.length, callers);
      assert.equal(
        new Set(result.executions.map((e) => e.gameId)).size,
        callers,
      );
      assert.ok(
        result.games.every(
          (g) => g.status === "won" && g.target === 3 && g.answers.length === 3,
        ),
      );
      for (const g of result.games) {
        assert.ok(result.wallets[g.wallet].cooldownUntil > Date.now());
        assert.ok(g.answers[1].at - g.answers[0].at >= 8000);
      }
      await Promise.all(
        codes.map(async (_, i) =>
          post("/status", i, { CallStatus: "completed" }),
        ),
      );
      assert.equal((await readStore()).wins, callers);
      t.diagnostic(
        `Passed ${callers} overlapping real WebSocket sessions with simulated speech/RPC. This is not a live carrier or hosted-capacity test.`,
      );
    } finally {
      sockets.forEach((ws) => ws.terminate());
      child.kill();
      if (child.exitCode === null) await once(child, "exit");
    }
  },
);
