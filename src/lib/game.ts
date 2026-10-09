import { randomInt, randomUUID, createHash } from "node:crypto";
import type { Proposal } from "./types";
import type { FeeSource } from "./meteora";
import type { FeeClaimRecord } from "./fee-claim-service";
import { callCapacity } from "./capacity";
export const COOLDOWN_MS = 600_000;
export const ANSWER_MS = 8_000;
export const CALL_CODE_DIGITS = 4;
export const targetFor = (wins: number) => 3 + wins * 2;
export type Question = {
  id: string;
  fact: string;
  text: string;
  choices: [string, string, string, string];
  correct: number;
  source: string;
  used: boolean;
};
export type Game = {
  id: string;
  wallet: string;
  proposalId: string;
  callSid: string;
  streamSid?: string;
  attemptStartedAt?: number;
  target: number;
  questions: Question[];
  index: number;
  status: "playing" | "won" | "lost" | "void";
  startedAt: number;
  opensAt: number | null;
  deadline: number | null;
  answers: { questionId: string; choice: number; at: number }[];
};
export type QueueEntry = {
  wallet: string;
  proposalId: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  status: "waiting" | "playing" | "done";
};
export type Execution = {
  id: string;
  gameId: string;
  proposalId: string;
  status: "pending" | "applied" | "holding_required";
  transaction?: string;
  settlement?: FeeCycle;
  error?: string;
};
export type FeeCycle = {
  id: string;
  recipient: string;
  sources: FeeSource[];
  completed: Record<string, string>;
  createdAt: number;
};
export type Store = {
  tokenMint?: string;
  wins: number;
  wallets: Record<string, { username: string; cooldownUntil: number }>;
  challenges: Record<
    string,
    { wallet: string; message: string; expiresAt: number }
  >;
  sessions: Record<string, { wallet: string; expiresAt: number }>;
  proposals: Proposal[];
  comments: {
    id: string;
    proposalId: string;
    wallet: string;
    text: string;
    createdAt: number;
  }[];
  questions: Question[];
  queue: QueueEntry[];
  games: Game[];
  executions: Execution[];
  limits: Record<string, { count: number; expiresAt: number }>;
  fees?: {
    recipient: string;
    since: number;
    proposalId?: string;
    lastClaimAt: number;
    cycle?: FeeCycle;
    receipts: { recipient: string; transaction: string; at: number }[];
  };
  worker?: { heartbeat: number; error?: string };
  voiceHeartbeat?: number;
  questionFeed?: { offset: number; lastSync: number; error?: string };
  triviaFeed?: { token?: string; nextSync: number; error?: string };
  feeClaims?: Record<string, FeeClaimRecord>;
};
export function bindMint(s: Store, mint: string) {
  if (s.tokenMint && s.tokenMint !== mint)
    throw new Error("This database belongs to a different token mint.");
  s.tokenMint = mint;
}
export const emptyStore = (): Store => ({
  wins: 0,
  wallets: {},
  challenges: {},
  sessions: {},
  proposals: [],
  comments: [],
  questions: [],
  queue: [],
  games: [],
  executions: [],
  limits: {},
});
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function rateLimit(
  s: Store,
  key: string,
  now = Date.now(),
  max = 10,
  window = 60_000,
) {
  const item = s.limits[key];
  if (!item || item.expiresAt <= now)
    s.limits[key] = { count: 1, expiresAt: now + window };
  else {
    if (item.count >= max)
      throw new Error("Too many requests. Try again shortly.");
    item.count++;
  }
  for (const [k, v] of Object.entries(s.limits))
    if (v.expiresAt <= now) delete s.limits[k];
}
function newCallCode(s: Store, now: number, previous?: string) {
  const reserved = new Set(
    s.queue
      .filter(
        (q) =>
          q.status === "playing" ||
          (q.status === "waiting" && q.expiresAt > now),
      )
      .map((q) => q.codeHash),
  );
  if (previous) reserved.add(previous);
  const start = randomInt(9000);
  for (let offset = 0; offset < 9000; offset++) {
    const code = String(1000 + ((start + offset) % 9000));
    if (!reserved.has(hash(code))) return code;
  }
  throw new Error("All private call codes are reserved. Try again shortly.");
}
export function enqueue(
  s: Store,
  wallet: string,
  proposalId: string,
  now = Date.now(),
) {
  if ((s.wallets[wallet]?.cooldownUntil || 0) > now)
    throw new Error("Your ten-minute cooldown is still running.");
  if (s.games.some((g) => g.wallet === wallet && g.status === "playing"))
    throw new Error("This wallet already has an active call.");
  const p = s.proposals.find((p) => p.id === proposalId && p.wallet === wallet);
  if (!p || p.status !== "open")
    throw new Error("Choose one of your open proposals.");
  if (
    s.queue.some(
      (q) => q.wallet === wallet && q.status !== "done" && q.expiresAt > now,
    )
  )
    throw new Error("This wallet is already in the queue.");
  const code = newCallCode(s, now);
  const q: QueueEntry = {
    wallet,
    proposalId,
    codeHash: hash(code),
    createdAt: now,
    expiresAt: now + 10 * 60_000,
    status: "waiting",
  };
  p.status = "queued";
  s.queue.push(q);
  return {
    code,
    expiresAt: q.expiresAt,
    position: s.queue.filter((e) => e.status !== "done" && e.expiresAt > now)
      .length,
  };
}
export function beginGame(
  s: Store,
  code: string,
  callSid: string,
  now = Date.now(),
) {
  const existing = s.games.find((g) => g.callSid === callSid);
  if (existing) return existing;
  const first = s.queue.find(
    (q) =>
      q.status === "waiting" && q.expiresAt > now && q.codeHash === hash(code),
  );
  if (!first) throw new Error("The code is invalid or expired.");
  if (s.games.filter((g) => g.status === "playing").length >= callCapacity())
    throw new Error(
      "All call slots are busy. Your code is still valid; try again shortly. No attempt was used.",
    );
  if (s.games.some((g) => g.wallet === first.wallet && g.status === "playing"))
    throw new Error("This wallet already has an active call.");
  if ((s.wallets[first.wallet]?.cooldownUntil || 0) > now)
    throw new Error("Your cooldown is still running.");
  const target = targetFor(s.wins);
  const unused = s.questions.filter((q) => !q.used);
  if (unused.length < target)
    throw new Error(
      "The next set of questions is being prepared. No attempt was used.",
    );
  // Reserve globally in the same transaction as starting the game. Never return these to the pool.
  const questions: Question[] = [];
  for (let i = 0; i < target; i++) {
    const q = unused.splice(randomInt(unused.length), 1)[0];
    q.used = true;
    const indices = [0, 1, 2, 3];
    for (let j = 3; j > 0; j--) {
      const k = randomInt(j + 1);
      [indices[j], indices[k]] = [indices[k], indices[j]];
    }
    questions.push({
      ...q,
      choices: indices.map((k) => q.choices[k]) as Question["choices"],
      correct: indices.indexOf(q.correct),
    });
  }
  const g: Game = {
    id: randomUUID(),
    wallet: first.wallet,
    proposalId: first.proposalId,
    callSid,
    target,
    questions,
    index: 0,
    status: "playing",
    startedAt: now,
    opensAt: null,
    deadline: null,
    answers: [],
  };
  s.games.push(g);
  first.status = "playing";
  first.expiresAt = now + 60 * 60_000;
  return g;
}
export function refreshCode(s: Store, wallet: string, now = Date.now()) {
  const q = s.queue.find(
    (q) => q.wallet === wallet && q.status === "waiting" && q.expiresAt > now,
  );
  if (!q) throw new Error("No waiting proposal. Join the queue first.");
  const code = newCallCode(s, now, q.codeHash);
  q.codeHash = hash(code);
  return {
    code,
    expiresAt: q.expiresAt,
    position:
      s.queue
        .filter((q) => q.status !== "done" && q.expiresAt > now)
        .indexOf(q) + 1,
  };
}
export function cancelQueue(s: Store, wallet: string) {
  const q = s.queue.find((q) => q.wallet === wallet && q.status === "waiting");
  if (!q) throw new Error("Only a waiting attempt can be canceled.");
  q.status = "done";
  const p = s.proposals.find((p) => p.id === q.proposalId);
  if (p?.status === "queued") p.status = "open";
}
export function startQuestionPlayback(
  s: Store,
  gameId: string,
  now = Date.now(),
) {
  const g = getGame(s, gameId);
  if (g.status === "playing" && g.attemptStartedAt === undefined) {
    g.attemptStartedAt = now;
    s.wallets[g.wallet].cooldownUntil = now + COOLDOWN_MS;
  }
  return g;
}
export function attachStream(s: Store, gameId: string, streamSid: string) {
  const g = getGame(s, gameId);
  if (g.status !== "playing" || g.streamSid)
    throw new Error("This game already has a phone connection.");
  g.streamSid = streamSid;
  return g;
}
export function openQuestion(s: Store, gameId: string, now = Date.now()) {
  const g = getGame(s, gameId);
  if (g.status !== "playing" || g.deadline !== null) return g;
  startQuestionPlayback(s, gameId, now);
  g.opensAt = now;
  g.deadline = now + ANSWER_MS;
  return g;
}
export function getGame(s: Store, id: string) {
  const g = s.games.find((g) => g.id === id);
  if (!g) throw new Error("Game not found.");
  return g;
}
export function answer(s: Store, id: string, choice: number, at = Date.now()) {
  const g = getGame(s, id);
  if (g.status !== "playing" || g.deadline === null || g.opensAt === null)
    return g;
  if (at < g.opensAt) return g;
  if (!Number.isInteger(choice) || choice < 0 || choice > 3)
    throw new Error("Choose A, B, C, or D.");
  g.answers.push({ questionId: g.questions[g.index].id, choice, at });
  if (at > g.deadline || choice !== g.questions[g.index].correct) {
    finish(s, g, "lost");
    return g;
  }
  g.index++;
  g.deadline = null;
  g.opensAt = null;
  if (g.index === g.target) {
    finish(s, g, "won");
    s.wins++;
    const p = s.proposals.find((p) => p.id === g.proposalId)!;
    p.status = "won";
    s.executions.push({
      id: randomUUID(),
      gameId: g.id,
      proposalId: g.proposalId,
      status: "pending",
    });
  }
  return g;
}
export function timeout(s: Store, id: string, now = Date.now()) {
  const g = getGame(s, id);
  if (g.status === "playing" && g.deadline !== null && now >= g.deadline)
    finish(s, g, "lost");
  return g;
}
export function finish(s: Store, g: Game, status: Game["status"]) {
  if (g.status !== "playing") return;
  g.status = status;
  g.deadline = null;
  g.opensAt = null;
  s.queue
    .filter((q) => q.wallet === g.wallet && q.status === "playing")
    .forEach((q) => (q.status = "done"));
  const p = s.proposals.find((p) => p.id === g.proposalId);
  if (p && status !== "won") p.status = "open";
}
export function expireQueue(s: Store, now = Date.now()) {
  for (const q of s.queue) {
    if (q.status === "waiting" && q.expiresAt <= now) {
      q.status = "done";
      const p = s.proposals.find((p) => p.id === q.proposalId);
      if (p?.status === "queued") p.status = "open";
    }
  }
}
export function firstSpokenChoice(text: string): number | null {
  const aliases: Record<string, number> = {
    a: 0,
    ay: 0,
    alpha: 0,
    b: 1,
    bee: 1,
    bravo: 1,
    c: 2,
    see: 2,
    charlie: 2,
    d: 3,
    dee: 3,
    delta: 3,
    one: 0,
    two: 1,
    three: 2,
    four: 3,
    "1": 0,
    "2": 1,
    "3": 2,
    "4": 3,
  };
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/);
  for (const w of words) {
    if (w in aliases) return aliases[w];
  }
  return null;
}
