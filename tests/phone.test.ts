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
  mkdtempSync(join(tmpdir(), "ring-phone-")),
  "test.sqlite",
);

test(
  "signed phone call plays 3 timed questions, accepts keypad and speech, and records one win",
  { timeout: 50000 },
  async () => {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const wallet = Keypair.generate().publicKey.toBase58(),
      mint = Keypair.generate().publicKey.toBase58();
    const code = transact((s) => {
      s.wallets[wallet] = { username: "caller", cooldownUntil: 0 };
      s.proposals.push({
        id: "proposal",
        title: "A new description",
        kind: "description",
        value: "Ring",
        note: "",
        username: "caller",
        wallet,
        status: "open",
        comments: 0,
        createdAt: Date.now(),
      });
      s.questions = Array.from({ length: 12 }, (_, i) => ({
        id: `q${i}`,
        fact: `fact${i}`,
        text: `Test-only question ${i}?`,
        choices: ["One", "Two", "Three", "Four"],
        correct: i % 4,
        source: "https://example.com",
        used: false,
      }));
      return enqueue(s, wallet, "proposal").code;
    });
    const auth = "test-only-secret",
      sid = "AC" + "1".repeat(32),
      callSid = "CA" + "2".repeat(32),
      streamSid = "MZ" + "3".repeat(32),
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
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          VOICE_PORT: String(port),
          VOICE_PUBLIC_URL: base,
          TWILIO_AUTH_TOKEN: auth,
          TWILIO_ACCOUNT_SID: sid,
          DEEPGRAM_API_KEY: "test-only",
          RING_LIVE: "true",
          RING_TOKEN_MINT: mint,
          SOLANA_RPC_URL: "http://rpc.test",
          RING_PHONE_NUMBER: "+12025550123",
          RING_AUTHORITY_KEYPAIR: "test-only",
          RING_DBC_POOL: mint,
          RING_INITIAL_FEE_RECIPIENT: wallet,
          APP_ORIGIN: "https://ring.test",
        },
      },
    );
    let ws: WebSocket | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Voice worker did not start")),
          8000,
        );
        child.stdout.on("data", (data) => {
          if (String(data).includes("worker ready")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Worker exited ${code}`));
        });
      });
      async function post(
        path: string,
        extra: Record<string, string> = {},
        valid = true,
      ) {
        const form = { AccountSid: sid, CallSid: callSid, ...extra };
        return fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Twilio-Signature": valid
              ? twilio.getExpectedTwilioSignature(auth, base + path, form)
              : "forged",
          },
          body: new URLSearchParams(form),
        });
      }
      assert.equal((await post("/incoming", {}, false)).status, 403);
      assert.match(await (await post("/incoming")).text(), /numDigits="6"/);
      assert.match(
        await (await post("/code", { Digits: "000000" })).text(),
        /invalid or expired/,
      );
      const xml = await (await post("/code", { Digits: code })).text();
      assert.match(xml, /<Stream/);
      const game = readStore().games[0];
      assert.equal(game.target, 3);
      ws = new WebSocket(`ws://127.0.0.1:${port}/stream`, {
        headers: {
          "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
            auth,
            `${base}/stream`,
            {},
          ),
        },
      });
      const finished = new Promise<void>((resolve, reject) => {
        ws!.on("close", () => resolve());
        ws!.on("error", reject);
      });
      let start = 0,
        questions = 0;
      ws.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.event !== "mark") return;
        ws!.send(
          JSON.stringify({ event: "mark", streamSid, mark: event.mark }),
        );
        if (event.mark.name === "end") return;
        const index = Number(event.mark.name.split(":")[1]);
        questions++;
        const correct = game.questions[index].correct;
        for (let second = 0; second < 8; second++)
          ws!.send(
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
        if (index === 1)
          setTimeout(
            () =>
              ws!.send(
                JSON.stringify({
                  event: "dtmf",
                  streamSid,
                  dtmf: { digit: String(((correct + 1) % 4) + 1) },
                }),
              ),
            1000,
          );
        else
          ws!.send(
            JSON.stringify({
              event: "dtmf",
              streamSid,
              dtmf: { digit: String(correct + 1) },
            }),
          );
      });
      await once(ws, "open");
      const token = createHmac("sha256", auth)
        .update(`${game.id}:${callSid}`)
        .digest("hex");
      ws.send(
        JSON.stringify({
          event: "start",
          start: {
            callSid,
            accountSid: sid,
            streamSid,
            customParameters: { gameId: game.id, token },
          },
        }),
      );
      await finished;
      assert.equal(questions, 3);
      const result = readStore();
      assert.equal(result.games[0].status, "won");
      assert.equal(result.wins, 1);
      assert.equal(result.executions.length, 1);
      assert.equal(
        result.games[0].answers[1].choice,
        game.questions[1].correct,
        "speech at 500ms wins ahead of the later wrong keypad",
      );
      assert.ok(
        result.games[0].answers[1].at - result.games[0].answers[0].at >= 8000,
      );
      assert.ok(result.wallets[wallet].cooldownUntil > Date.now());
      await post("/status", { CallStatus: "completed" });
      await post("/status", { CallStatus: "completed" });
      assert.equal(readStore().executions.length, 1);
    } finally {
      ws?.terminate();
      child.kill();
      await once(child, "exit").catch(() => {});
    }
  },
);
