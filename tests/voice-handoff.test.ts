process.env.RING_STORAGE = "sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import twilio from "twilio";
import { acquireLease } from "../src/lib/operations";
import { readStore, transact } from "../src/lib/store";

process.env.RING_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ring-handoff-")),
  "test.sqlite",
);

test(
  "standby rejects callbacks and leaves games untouched until previous ownership is released",
  { timeout: 20000 },
  async () => {
    const previous = await acquireLease("voice", 45000);
    assert.ok(previous);
    await transact((s) => {
      s.wallets.caller = {
        username: "caller",
        cooldownUntil: Date.now() + 600000,
      };
      s.games.push({
        id: "interrupted",
        wallet: "caller",
        proposalId: "proposal",
        callSid: "CAold",
        target: 3,
        questions: [],
        index: 0,
        status: "playing",
        startedAt: Date.now(),
        opensAt: null,
        deadline: null,
        answers: [],
      });
    });
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const auth = "test-secret",
      account = "AC" + "1".repeat(32),
      base = "https://voice.ring.test";
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/voice-server.ts"],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          VOICE_PORT: String(port),
          VOICE_HOST: "127.0.0.1",
          VOICE_PUBLIC_URL: base,
          TWILIO_AUTH_TOKEN: auth,
          TWILIO_ACCOUNT_SID: account,
          DEEPGRAM_API_KEY: "test",
          RING_LIVE: "false",
        },
      },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += String(data);
    });
    child.stderr.on("data", (data) => {
      output += String(data);
    });
    async function waitFor(text: string) {
      const deadline = Date.now() + 10000;
      while (!output.includes(text)) {
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error(output || "Startup timeout");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    async function callback(path: string) {
      const form = {
        AccountSid: account,
        CallSid: "CAold",
        CallStatus: "completed",
      };
      return fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        body: new URLSearchParams(form),
        headers: {
          "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
            auth,
            base + path,
            form,
          ),
        },
      });
    }
    try {
      await waitFor("listener started");
      assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 503);
      assert.equal((await callback("/incoming")).status, 503);
      assert.equal((await callback("/status")).status, 503);
      assert.equal((await readStore()).games[0].status, "playing");
      await previous.release();
      await waitFor("worker ready");
      const ready = await fetch(`http://127.0.0.1:${port}/ready`);
      assert.equal(ready.status, 200);
      assert.deepEqual(await ready.json(), { ready: true, codeDigits: 4 });
      const state = await readStore();
      assert.equal(state.games[0].status, "void");
      assert.equal(state.wallets.caller.cooldownUntil, 0);
      assert.equal(await acquireLease("voice"), null);
      assert.match(await (await callback("/incoming")).text(), /not open yet/);
    } finally {
      child.kill();
      await once(child, "exit").catch(() => {});
      await previous.release();
    }
  },
);
