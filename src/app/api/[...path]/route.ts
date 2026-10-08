import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";
import { readStore, transact } from "@/lib/store";
import {
  enqueue,
  hash,
  rateLimit,
  targetFor,
  refreshCode,
  cancelQueue,
  bindMint,
  expireQueue,
} from "@/lib/game";
import { holdsRing, requireHolding, validWallet } from "@/lib/solana";
import { acceptingCalls, canPost, origin, requireLive } from "@/lib/config";
import { getAsset, publishImage } from "@/lib/assets";
import { callCapacity } from "@/lib/capacity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function session(req: NextRequest) {
  const token = req.cookies.get("ring_session")?.value;
  const s = token ? (await readStore()).sessions[hash(token)] : undefined;
  return s && s.expiresAt > Date.now() ? s.wallet : null;
}
async function requireSession(req: NextRequest) {
  const wallet = await session(req);
  if (!wallet) throw new Error("Connect your wallet to continue.");
  return wallet;
}
const proposalSchema = z.object({
  kind: z.enum(["picture", "description", "fees"]),
  title: z.string().trim().min(5).max(100),
  username: z.string().regex(/^[A-Za-z0-9_]{3,24}$/),
  value: z.string().max(500),
  note: z.string().trim().max(500),
  image: z.string().max(2_800_000).optional(),
});
function checkImage(image: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    image,
  );
  if (!match) throw new Error("Use a PNG, JPEG, or WebP image.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 2 * 1024 * 1024)
    throw new Error("Images must be under 2 MB.");
  const format = match[1];
  if (!(
    (format === "png" &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (format === "jpeg" &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255) ||
    (format === "webp" &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP")
  ))
    throw new Error("The image file is invalid.");
}
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await params).path.join("/");
    if (path.startsWith("assets/")) {
      const asset = await getAsset(path.slice(7));
      if (!asset) return json({ error: "Asset not found." }, 404);
      return new NextResponse(new Uint8Array(asset.bytes), {
        headers: {
          "Content-Type": asset.mime,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const s = await readStore();
    // Reflect expired reservations without rewriting the shared state on each poll.
    expireQueue(s);
    const wallet = await session(req);
    if (path === "state") {
      const waiting = s.queue.filter(
        (q) => q.status !== "done" && q.expiresAt > Date.now(),
      );
      const qi = waiting.findIndex((q) => q.wallet === wallet);
      const lastGame = wallet
        ? s.games.findLast((g) => g.wallet === wallet)
        : undefined;
      return json({
        live: acceptingCalls(s),
        canPost: canPost(),
        feePolicy:
          "Creator fees go to the winning wallet until the next fee proposal is applied. Existing fees settle to the previous recipient. SOL fees arrive as wrapped SOL.",
        feeRecipient:
          s.fees?.recipient || process.env.RING_INITIAL_FEE_RECIPIENT || null,
        lastGame: lastGame
          ? {
              status: lastGame.status,
              correct: lastGame.index,
              target: lastGame.target,
              execution:
                s.executions.find((e) => e.gameId === lastGame.id)?.status ||
                null,
            }
          : null,
        required: targetFor(s.wins),
        calls: {
          active: s.games.filter((g) => g.status === "playing").length,
          capacity: callCapacity(),
        },
        wins: s.wins,
        phone: process.env.RING_PHONE_NUMBER || null,
        mint: process.env.RING_TOKEN_MINT || null,
        proposals: [...s.proposals].reverse().slice(0, 100),
        session: wallet
          ? {
              wallet,
              eligible: await holdsRing(wallet),
              cooldownUntil: s.wallets[wallet]?.cooldownUntil || 0,
            }
          : null,
        queue:
          qi >= 0
            ? { position: qi + 1, expiresAt: waiting[qi].expiresAt }
            : null,
      });
    }
    if (/^proposals\/[a-f0-9-]+$/.test(path)) {
      const id = path.split("/")[1];
      const p = s.proposals.find((p) => p.id === id);
      if (!p) return json({ error: "Proposal not found." }, 404);
      return json({
        proposal: p,
        comments: s.comments.filter((c) => c.proposalId === id),
      });
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Request failed." },
      503,
    );
  }
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    if (req.headers.get("origin") !== origin())
      return json({ error: "This request must come from Ring." }, 403);
    const path = (await params).path.join("/");
    if (Number(req.headers.get("content-length") || 0) > 3_000_000)
      return json({ error: "Request is too large." }, 413);
    const raw = await req.text();
    if (raw.length > 3_000_000)
      return json({ error: "Request is too large." }, 413);
    const body = JSON.parse(raw);
    if (path === "auth/challenge") {
      const { wallet } = z
        .object({ wallet: z.string().max(44).refine(validWallet) })
        .parse(body);
      const id = randomUUID();
      const message = `Sign in to Ring\nOrigin: ${origin()}\nWallet: ${wallet}\nNonce: ${id}\nIssued: ${new Date().toISOString()}\nThis does not authorize a transaction.`;
      await transact((s) => {
        rateLimit(s, `challenge:${wallet}`);
        for (const [k, v] of Object.entries(s.challenges))
          if (v.expiresAt <= Date.now()) delete s.challenges[k];
        s.challenges[id] = { wallet, message, expiresAt: Date.now() + 300_000 };
      });
      return json({ id, message });
    }
    if (path === "auth/verify") {
      const { id, signature } = z
        .object({ id: z.uuid(), signature: z.string().max(100) })
        .parse(body);
      const token = randomBytes(32).toString("hex");
      await transact((s) => {
        const c = s.challenges[id];
        if (!c || c.expiresAt <= Date.now())
          throw new Error("Sign-in expired. Reconnect your wallet.");
        if (
          !nacl.sign.detached.verify(
            new TextEncoder().encode(c.message),
            bs58.decode(signature),
            bs58.decode(c.wallet),
          )
        )
          throw new Error("The wallet signature is invalid.");
        delete s.challenges[id];
        s.wallets[c.wallet] ??= { username: "", cooldownUntil: 0 };
        s.sessions[hash(token)] = {
          wallet: c.wallet,
          expiresAt: Date.now() + 86400_000,
        };
        for (const [k, v] of Object.entries(s.sessions))
          if (v.expiresAt <= Date.now()) delete s.sessions[k];
      });
      const res = json({ ok: true });
      res.cookies.set("ring_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: origin().startsWith("https:"),
        path: "/",
        maxAge: 86400,
      });
      return res;
    }
    if (path === "auth/logout") {
      const token = req.cookies.get("ring_session")?.value;
      if (token)
        await transact((s) => {
          delete s.sessions[hash(token)];
        });
      const res = json({ ok: true });
      res.cookies.delete("ring_session");
      return res;
    }
    const wallet = await requireSession(req);
    if (path === "proposals") {
      if (!canPost())
        throw new Error(
          "The Ring token must be configured before proposals open.",
        );
      await requireHolding(wallet);
      const value = proposalSchema.parse(body);
      if (value.kind === "fees" && !validWallet(value.value))
        throw new Error("Enter a valid Solana recipient wallet.");
      if (value.kind === "picture") checkImage(value.image || "");
      if (value.kind === "picture")
        value.image = await publishImage(value.image!);
      if (value.kind === "description" && value.value.trim().length < 5)
        throw new Error("Write a description of at least five characters.");
      const id = randomUUID();
      await transact((s) => {
        bindMint(s, process.env.RING_TOKEN_MINT!);
        rateLimit(s, `proposal:${wallet}`, Date.now(), 5, 3600_000);
        if (
          Object.entries(s.wallets).some(
            ([key, w]) =>
              key !== wallet &&
              w.username.toLowerCase() === value.username.toLowerCase(),
          )
        )
          throw new Error("That forum name is already taken.");
        s.wallets[wallet].username = value.username;
        s.proposals.push({
          ...value,
          id,
          wallet,
          status: "open",
          createdAt: Date.now(),
          comments: 0,
        });
      });
      return json({ id }, 201);
    }
    if (path === "queue") {
      requireLive();
      await requireHolding(wallet);
      const { proposalId } = z.object({ proposalId: z.uuid() }).parse(body);
      return json(
        await transact((s) => {
          bindMint(s, process.env.RING_TOKEN_MINT!);
          if (s.questions.filter((q) => !q.used).length < targetFor(s.wins))
            throw new Error(
              "Fresh questions are being prepared. No attempt was used.",
            );
          if (
            !s.worker ||
            Date.now() - s.worker.heartbeat > 120000 ||
            s.worker.error
          )
            throw new Error(
              "The token executor is offline. No attempt was used.",
            );
          if (Date.now() - (s.voiceHeartbeat || 0) > 45000)
            throw new Error("The phone host is offline. No attempt was used.");
          return enqueue(s, wallet, proposalId);
        }),
      );
    }
    if (path === "queue/code")
      return json(
        await transact((s) => {
          rateLimit(s, `code:${wallet}`, Date.now(), 5);
          return refreshCode(s, wallet);
        }),
      );
    if (path === "queue/cancel") {
      await transact((s) => cancelQueue(s, wallet));
      return json({ ok: true });
    }
    if (/^proposals\/[a-f0-9-]+\/comments$/.test(path)) {
      const proposalId = path.split("/")[1];
      const { text } = z
        .object({ text: z.string().trim().min(1).max(500) })
        .parse(body);
      await transact((s) => {
        rateLimit(s, `comments:${wallet}`, Date.now(), 5);
        const p = s.proposals.find((p) => p.id === proposalId);
        if (!p) throw new Error("Proposal not found.");
        s.comments.push({
          id: randomUUID(),
          wallet,
          proposalId,
          text,
          createdAt: Date.now(),
        });
        p.comments++;
      });
      return json({ ok: true }, 201);
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    return json(
      {
        error:
          e instanceof z.ZodError
            ? "Check the form fields and try again."
            : e instanceof Error
              ? e.message
              : "Request failed.",
      },
      400,
    );
  }
}
