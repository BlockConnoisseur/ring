import { createServer, type IncomingMessage } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import twilio from "twilio";
import { readStore, transact } from "../src/lib/store";
import {
  answer,
  bindMint,
  attachStream,
  beginGame,
  finish,
  firstSpokenChoice,
  getGame,
  hash,
  openQuestion,
  rateLimit,
  startQuestionPlayback,
  timeout,
  type Game,
} from "../src/lib/game";
import { requireHolding } from "../src/lib/solana";
import { liveReady } from "../src/lib/config";
import { AudioWindow } from "../src/lib/audio-window";
import { acquireLease } from "../src/lib/operations";

const base = (process.env.VOICE_PUBLIC_URL || "").replace(/\/$/, "");
const auth = process.env.TWILIO_AUTH_TOKEN || "";
const account = process.env.TWILIO_ACCOUNT_SID || "";
const voiceKey = process.env.DEEPGRAM_API_KEY || "";
if (!base.startsWith("https://") || !auth || !account || !voiceKey)
  throw new Error(
    "Configure HTTPS VOICE_PUBLIC_URL, Twilio account credentials, and DEEPGRAM_API_KEY before starting the voice worker.",
  );
const tokenFor = (g: Game) =>
  createHmac("sha256", auth).update(`${g.id}:${g.callSid}`).digest("hex");
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function readForm(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > 16000) throw new Error("Body too large");
  }
  return Object.fromEntries(new URLSearchParams(body));
}
function signed(
  req: IncomingMessage,
  path: string,
  data: Record<string, string>,
) {
  return (
    twilio.validateRequest(
      auth,
      String(req.headers["x-twilio-signature"] || ""),
      base + path,
      data,
    ) && data.AccountSid === account
  );
}
function message(text: string) {
  const xml = new twilio.twiml.VoiceResponse();
  xml.say(text);
  xml.hangup();
  return xml.toString();
}
const server = createServer(async (req, res) => {
  try {
    if (
      req.method !== "POST" ||
      !["/incoming", "/code", "/status"].includes(req.url || "")
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    const path = req.url!;
    const form = await readForm(req);
    if (!signed(req, path, form)) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/xml");
    if (path === "/status") {
      if (
        ["completed", "failed", "busy", "no-answer", "canceled"].includes(
          form.CallStatus,
        )
      )
        await transact((s) => {
          const g = s.games.find((g) => g.callSid === form.CallSid);
          if (g?.status === "playing") finish(s, g, "lost");
        });
      res.end("<Response/>");
      return;
    }
    if (!liveReady()) {
      res.end(
        message(
          "You reached Ring. The line is not open yet. Visit the website to prepare your proposal.",
        ),
      );
      return;
    }
    if (path === "/incoming") {
      const xml = new twilio.twiml.VoiceResponse();
      xml.say(
        "This is Ring, your A I trivia host. Your answers are processed to score the game. We do not save call recordings.",
      );
      const gather = xml.gather({
        input: ["dtmf"],
        numDigits: 6,
        timeout: 10,
        action: base + "/code",
        method: "POST",
        actionOnEmptyResult: true,
      });
      gather.say("Enter the six digit private code from your proposal page.");
      res.end(xml.toString());
      return;
    }
    await transact((s) =>
      rateLimit(s, `pin:${form.CallSid}`, Date.now(), 3, 3600_000),
    );
    const currentState = await readStore();
    const previous = currentState.games.find((g) => g.callSid === form.CallSid);
    const queue = currentState.queue.find(
      (q) =>
        (q.status === "waiting" ||
          (q.status === "playing" && previous?.wallet === q.wallet)) &&
        q.codeHash === hash(form.Digits || "") &&
        q.expiresAt > Date.now(),
    );
    if (!queue) {
      res.end(
        message(
          "That code is invalid or expired. Return to the website to check your place in line.",
        ),
      );
      return;
    }
    await requireHolding(queue.wallet);
    const game = await transact((s) => {
      bindMint(s, process.env.RING_TOKEN_MINT!);
      return beginGame(s, form.Digits, form.CallSid);
    });
    if (game.status !== "playing") {
      res.end(
        message(
          "This attempt has already ended. Check the website for your result.",
        ),
      );
      return;
    }
    const xml = new twilio.twiml.VoiceResponse();
    const stream = xml
      .connect()
      .stream({ url: base.replace(/^https:/, "wss:") + "/stream" });
    stream.parameter({ name: "gameId", value: game.id });
    stream.parameter({ name: "token", value: tokenFor(game) });
    res.end(xml.toString());
  } catch (e) {
    res.setHeader("Content-Type", "text/xml");
    res.end(
      message(
        e instanceof Error
          ? e.message
          : "The line was interrupted. Check the website before trying again.",
      ),
    );
  }
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const signature = String(req.headers["x-twilio-signature"] || "");
  const valid =
    req.url === "/stream" &&
    [base + "/stream", base.replace(/^https:/, "wss:") + "/stream"].some(
      (url) => twilio.validateRequest(auth, signature, url, {}),
    );
  if (!valid) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) =>
    sockets.emit("connection", ws),
  );
});

async function speech(text: string) {
  const res = await fetch(
    "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mulaw&sample_rate=8000&container=none",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${voiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error("Voice synthesis unavailable");
  return Buffer.from(await res.arrayBuffer());
}
// 160ms of a quiet 880Hz telephone beep, encoded as G.711 mu-law.
function beep() {
  const out = Buffer.alloc(1280);
  for (let i = 0; i < out.length; i++) {
    let x = Math.round(Math.sin((2 * Math.PI * 880 * i) / 8000) * 5500);
    const sign = x < 0 ? 128 : 0;
    x = Math.min(Math.abs(x), 32635) + 132;
    let exponent = 7;
    for (
      let mask = 16384;
      (x & mask) === 0 && exponent > 0;
      exponent--, mask >>= 1
    ) {}
    const mantissa = (x >> (exponent + 3)) & 15;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 255;
  }
  return out;
}
type Word = { word: string; start: number; end: number; confidence: number };
async function recognize(audio: Buffer) {
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&encoding=mulaw&sample_rate=8000&channels=1&punctuate=false",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${voiceKey}`,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error("Speech recognition unavailable");
  const result = await res.json();
  return (result.results?.channels?.[0]?.alternatives?.[0]?.words ||
    []) as Word[];
}
sockets.on("connection", (ws) => {
  let gameId = "",
    streamSid = "",
    latestMedia = 0,
    windowStart: number | null = null,
    openedAt = 0,
    expectedMark = "",
    ending = false,
    closed = false,
    starting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let key: { choice: number; offset: number } | null = null;
  let capture = new AudioWindow(0);
  const send = (data: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }
  async function say(text: string, mark: string, withBeep = false) {
    expectedMark = mark;
    const buffer = await speech(text);
    if (closed) return;
    if (withBeep) await transact((s) => startQuestionPlayback(s, gameId));
    send({
      event: "media",
      streamSid,
      media: { payload: buffer.toString("base64") },
    });
    if (withBeep)
      send({
        event: "media",
        streamSid,
        media: { payload: beep().toString("base64") },
      });
    send({ event: "mark", streamSid, mark: { name: mark } });
    clearTimer();
    timer = setTimeout(
      () => {
        if (ending) ws.close();
        else void infrastructureFailure();
      },
      Math.max(30000, buffer.length / 8 + 15000),
    );
  }
  async function infrastructureFailure() {
    if (ending || closed) return;
    ending = true;
    clearTimer();
    windowStart = null;
    try {
      if (gameId)
        await transact((s) => {
          const g = getGame(s, gameId);
          if (g.status === "playing") {
            finish(s, g, "void");
            s.wallets[g.wallet].cooldownUntil = 0;
          }
        });
      await say(
        "The line had a technical problem. Your attempt is void. Your questions stay retired. Please try a fresh call from the website.",
        "end",
      );
    } catch {
      ws.close();
    }
  }
  async function ask() {
    const g = getGame(await readStore(), gameId);
    if (g.status !== "playing") {
      ws.close();
      return;
    }
    const q = g.questions[g.index];
    const intro =
      g.index === 0
        ? `You're playing for a token change. You need ${g.target} right answers in a row. Say only A, B, C, or D, or press one, two, three, or four. You have eight seconds after the beep. `
        : `Correct. ${g.index} down. `;
    await say(
      `${intro}Question ${g.index + 1}. ${q.text} A. ${q.choices[0]}. B. ${q.choices[1]}. C. ${q.choices[2]}. D. ${q.choices[3]}.`,
      `question:${g.index}`,
      true,
    );
  }
  async function grade() {
    if (windowStart === null || closed) return;
    windowStart = null;
    clearTimer();
    try {
      if (capture.covered < 32000) throw new Error("Incomplete answer audio");
      const words = await recognize(capture.audio);
      if (closed) return;
      let choice = key;
      for (const word of words) {
        const parsed = firstSpokenChoice(word.word);
        if (
          parsed === null ||
          word.end > 8 ||
          word.start < 0 ||
          word.confidence < 0.6
        )
          continue;
        const offset = Math.ceil(word.end * 1000);
        if (!choice || offset < choice.offset)
          choice = { choice: parsed, offset };
        break;
      }
      const result = await transact((s) =>
        choice
          ? answer(s, gameId, choice.choice, openedAt + choice.offset)
          : timeout(s, gameId, openedAt + 8000),
      );
      capture.clear();
      if (result.status === "won") {
        ending = true;
        await say(
          `That's ${result.target} in a row. You won. Your locked proposal is queued for execution. The next caller needs ${result.target + 2}. Check the website for confirmation.`,
          "end",
        );
      } else if (result.status === "lost") {
        ending = true;
        await say(
          choice
            ? "That is not the answer. Your run ends here. Check the website for your next attempt."
            : "Time is up. Your run ends here. Check the website for your next attempt.",
          "end",
        );
      } else await ask();
    } catch {
      await infrastructureFailure();
    }
  }
  ws.on("message", async (raw) => {
    try {
      const event = JSON.parse(raw.toString());
      if (event.event === "start") {
        if (gameId || starting) {
          ws.close();
          return;
        }
        starting = true;
        const params = event.start?.customParameters;
        const g = getGame(await readStore(), String(params?.gameId || ""));
        if (
          event.start.callSid !== g.callSid ||
          event.start.accountSid !== account ||
          !same(String(params?.token || ""), tokenFor(g)) ||
          g.status !== "playing"
        ) {
          ws.close();
          return;
        }
        try {
          await transact((s) => attachStream(s, g.id, event.start.streamSid));
        } catch {
          ws.close();
          return;
        }
        gameId = g.id;
        streamSid = event.start.streamSid;
        if (closed) {
          await transact((s) => {
            const interrupted = getGame(s, gameId);
            if (interrupted.status === "playing")
              finish(s, interrupted, "lost");
          });
          return;
        }
        await ask();
      } else if (event.event === "media") {
        const timestamp = Number(event.media.timestamp);
        if (!Number.isFinite(timestamp)) return;
        const bytes = Buffer.from(event.media.payload, "base64");
        latestMedia = Math.max(latestMedia, timestamp + bytes.length / 8);
        if (windowStart !== null) {
          capture.add(timestamp, bytes);
        }
      } else if (event.event === "mark" && event.mark.name === expectedMark) {
        clearTimer();
        if (expectedMark === "end") {
          ws.close();
          return;
        }
        if (!expectedMark.startsWith("question:")) return;
        expectedMark = "";
        capture = new AudioWindow(latestMedia);
        key = null;
        windowStart = latestMedia;
        openedAt = Date.now();
        await transact((s) => openQuestion(s, gameId, openedAt));
        if (!closed)
          timer = setTimeout(
            () => void grade(),
            Math.max(0, 8500 - (Date.now() - openedAt)),
          );
      } else if (event.event === "dtmf" && windowStart !== null && !key) {
        const offset = Date.now() - openedAt;
        const digit = String(event.dtmf?.digit || "");
        if (/^[1-4]$/.test(digit) && offset >= 0 && offset <= 8000)
          key = { choice: Number(digit) - 1, offset };
      } else if (event.event === "stop") ws.close();
    } catch {
      await infrastructureFailure();
    }
  });
  ws.on("close", () => {
    closed = true;
    clearTimer();
    capture.clear();
    if (gameId)
      void transact((s) => {
        const g = getGame(s, gameId);
        if (g.status === "playing") finish(s, g, "lost");
      }).catch(() =>
        console.error(
          "Could not record call disconnect; startup recovery will void the interrupted game.",
        ),
      );
  });
  ws.on("error", () => void infrastructureFailure());
  timer = setTimeout(() => ws.close(), 15000);
});
async function main() {
  // Acquire ownership BEFORE recovery so another host cannot void a live call.
  const lease = await acquireLease("voice", 45000);
  if (!lease)
    throw new Error(
      "A voice worker already owns this database. Wait for its lease to expire before restarting.",
    );
  await transact((s) => {
    s.voiceHeartbeat = Date.now();
    for (const g of s.games)
      if (g.status === "playing") {
        finish(s, g, "void");
        s.wallets[g.wallet].cooldownUntil = 0;
      }
  });
  let renewing = false;
  setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      await lease.renew();
      await transact((s) => {
        s.voiceHeartbeat = Date.now();
      });
    } catch {
      console.error(
        "Voice worker lost database ownership; stopping for recovery.",
      );
      process.exit(1);
    } finally {
      renewing = false;
    }
  }, 15000);
  server.listen(
    Number(process.env.VOICE_PORT || 3321),
    process.env.VOICE_HOST || "127.0.0.1",
    () =>
      console.log("Ring voice worker ready behind the HTTPS reverse proxy."),
  );
}
void main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
