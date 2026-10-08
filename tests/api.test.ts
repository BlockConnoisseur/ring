process.env.RING_STORAGE = "sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { POST, GET } from "../src/app/api/[...path]/route";
import { holdsRing } from "../src/lib/solana";
import { readStore, transact } from "../src/lib/store";
process.env.RING_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ring-api-")),
  "test.sqlite",
);
process.env.APP_ORIGIN = "http://127.0.0.1:3320";
delete process.env.RING_TOKEN_MINT;
process.env.RING_LIVE = "false";
async function post(
  path: string,
  body: unknown,
  origin = "http://127.0.0.1:3320",
  cookie = "",
) {
  return POST(
    new NextRequest(`http://127.0.0.1:3320/api/${path}`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
}
test("signed wallet login rejects forged signatures and replay", async () => {
  const key = nacl.sign.keyPair();
  const wallet = bs58.encode(key.publicKey);
  const challenge = await (await post("auth/challenge", { wallet })).json();
  const wrong = nacl.sign.keyPair();
  const forged = await post("auth/verify", {
    id: challenge.id,
    signature: bs58.encode(
      nacl.sign.detached(
        new TextEncoder().encode(challenge.message),
        wrong.secretKey,
      ),
    ),
  });
  assert.equal(forged.status, 400);
  const payload = {
    id: challenge.id,
    signature: bs58.encode(
      nacl.sign.detached(
        new TextEncoder().encode(challenge.message),
        key.secretKey,
      ),
    ),
  };
  const valid = await post("auth/verify", payload);
  assert.equal(valid.status, 200);
  const cookie = valid.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=strict/i);
  assert.equal((await post("auth/verify", payload)).status, 400);
  const state = await GET(
    new NextRequest("http://127.0.0.1:3320/api/state", { headers: { cookie } }),
    { params: Promise.resolve({ path: ["state"] }) },
  );
  const data = await state.json();
  assert.equal(data.session.wallet, wallet);
  assert.equal(data.live, false);
  assert.equal(data.session.eligible, null);
  assert.equal("questions" in data, false);
  assert.equal("sessions" in data, false);
  assert.equal(
    (await post("proposals", { title: "A proposal" }, undefined, cookie))
      .status,
    400,
  );
});
test("cross-origin requests are rejected before wallet processing", async () => {
  assert.equal(
    (await post("auth/challenge", {}, "https://attacker.example")).status,
    403,
  );
});
test("anonymous users cannot join a queue or publish", async () => {
  assert.equal((await post("queue", { proposalId: "missing" })).status, 400);
  assert.equal((await post("proposals", {})).status, 400);
});
test("holding checks use raw integers, accept fractional tokens, and reject wrong mints", async () => {
  const original = globalThis.fetch;
  const wallet = bs58.encode(nacl.sign.keyPair().publicKey);
  const mint = bs58.encode(nacl.sign.keyPair().publicKey);
  process.env.RING_TOKEN_MINT = mint;
  let amount = "1",
    returnedMint = mint;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        result: {
          value: [
            {
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: returnedMint,
                      owner: wallet,
                      tokenAmount: { amount },
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
  try {
    assert.equal(await holdsRing(wallet), true);
    amount = "0";
    assert.equal(await holdsRing(wallet), false);
    amount = "1";
    returnedMint = wallet;
    assert.equal(await holdsRing(wallet), false);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "RPC unavailable" } }));
    await assert.rejects(holdsRing(wallet), /unavailable/);
  } finally {
    globalThis.fetch = original;
    delete process.env.RING_TOKEN_MINT;
  }
});

test("holder signs in, posts all change types, comments, queues, recovers code, and cancels", async () => {
  const original = globalThis.fetch;
  const env = { ...process.env };
  const key = nacl.sign.keyPair(),
    wallet = bs58.encode(key.publicKey),
    mint = bs58.encode(nacl.sign.keyPair().publicKey);
  let amount = "1";
  Object.assign(process.env, {
    RING_TOKEN_MINT: mint,
    RING_LIVE: "true",
    RING_PHONE_NUMBER: "+12025550123",
    TWILIO_ACCOUNT_SID: "test",
    TWILIO_AUTH_TOKEN: "test",
    VOICE_PUBLIC_URL: "https://test.example",
    DEEPGRAM_API_KEY: "test",
    RING_AUTHORITY_KEYPAIR: "test",
    RING_DBC_POOL: mint,
    RING_INITIAL_FEE_RECIPIENT: wallet,
  });
  globalThis.fetch = async () =>
    Response.json({
      result: {
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: {
                    mint,
                    owner: wallet,
                    tokenAmount: { amount },
                  },
                },
              },
            },
          },
        ],
      },
    });
  try {
    const challenge = await (await post("auth/challenge", { wallet })).json();
    const res = await post("auth/verify", {
      id: challenge.id,
      signature: bs58.encode(
        nacl.sign.detached(
          new TextEncoder().encode(challenge.message),
          key.secretKey,
        ),
      ),
    });
    const cookie = res.headers.get("set-cookie")!;
    const payload = {
      title: "Change the description",
      kind: "description",
      value: "Call the coin.",
      note: "A test proposal",
      username: "signed_caller",
    };
    amount = "0";
    assert.equal(
      (await post("proposals", payload, undefined, cookie)).status,
      400,
    );
    amount = "1";
    const created = await post("proposals", payload, undefined, cookie);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal(
      (
        await post(
          "proposals",
          { ...payload, kind: "fees", value: "invalid" },
          undefined,
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "proposals",
          { ...payload, kind: "fees", value: wallet },
          undefined,
          cookie,
        )
      ).status,
      201,
    );
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    assert.equal(
      (
        await post(
          "proposals",
          { ...payload, kind: "picture", image },
          undefined,
          cookie,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await post(
          `proposals/${id}/comments`,
          { text: "On the board." },
          undefined,
          cookie,
        )
      ).status,
      201,
    );
    assert.equal(
      (await post("queue", { proposalId: id }, undefined, cookie)).status,
      400,
      "no questions or executor available",
    );
    await transact((s) => {
      s.worker = { heartbeat: Date.now() };
      s.voiceHeartbeat = Date.now();
      s.questions = Array.from({ length: 10 }, (_, i) => ({
        id: `api${i}`,
        fact: `api${i}`,
        text: "Test question",
        choices: ["A", "B", "C", "D"],
        correct: 0,
        source: "https://example.com",
        used: false,
      }));
    });
    const queued = await post("queue", { proposalId: id }, undefined, cookie);
    assert.equal(queued.status, 200);
    const before = await queued.json();
    assert.match(before.code, /^[1-9]\d{3}$/);
    const replaced = await (
      await post("queue/code", {}, undefined, cookie)
    ).json();
    assert.notEqual(replaced.code, before.code);
    assert.equal(replaced.expiresAt, before.expiresAt);
    assert.equal(
      (await post("queue/cancel", {}, undefined, cookie)).status,
      200,
    );
    assert.equal(
      (await readStore()).proposals.find((p) => p.id === id)?.status,
      "open",
    );
    // The next ready post issues a private code without a separate queue request.
    for (const [kind, value] of [
      ["name", "Ring Again"],
      ["symbol", "DIAL"],
      ["website", "https://ringai.dev/about"],
    ]) {
      await transact((s) => {
        delete s.limits[`proposal:${wallet}`];
      });
      const posted = await post(
        "proposals",
        { ...payload, kind, value },
        undefined,
        cookie,
      );
      assert.equal(posted.status, 201);
      const result = await posted.json();
      assert.match(result.call.code, /^[1-9]\d{3}$/);
      const data = await readStore();
      assert.equal(
        data.queue.find((q) => q.wallet === wallet && q.status === "waiting")
          ?.proposalId,
        result.id,
      );
      const publicResult = await GET(
        new NextRequest("http://127.0.0.1:3320/api/state"),
        { params: Promise.resolve({ path: ["state"] }) },
      );
      assert.equal((await publicResult.json()).queue, null);
      await post("queue/cancel", {}, undefined, cookie);
    }
    assert.equal(
      (
        await post(
          "proposals",
          { ...payload, kind: "name", value: "😀".repeat(9) },
          undefined,
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "proposals",
          { ...payload, kind: "website", value: "javascript:alert(1)" },
          undefined,
          cookie,
        )
      ).status,
      400,
    );
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env))
      if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
