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
