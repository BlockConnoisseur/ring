# Ring

A memecoin with a phone number. Hold any positive amount of Ring, post a supported token change, then call an AI trivia host. A win earns execution of the exact locked proposal.

## Run

Use Node.js 24 or newer. From `ring-web`:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3320. No credentials are needed to preview the site, compose a proposal, save a private browser draft, or view the rules. Ring is intentionally in prelaunch mode by default. This is a separate application; the existing Halo application is unchanged.

## Implemented

- Original responsive black, white, and red interface with a custom telephone image, proposal board, composer, wallet dialog, and call preparation panel.
- Real Phantom/Solflare message-based sign-in, nonce expiration, signature verification, HTTP-only sessions, and same-origin mutation checks.
- Solana holding checks against the configured exact token mint. Raw integer balances are used, so even the smallest nonzero fraction counts.
- Durable proposal/comment storage, private six-digit call codes, one active contestant, and locked proposal payloads.
- Global target of `3 + 2 × wins`; every question must be correct in the same attempt. One incorrect answer or timeout ends the run.
- One attempt per wallet every ten minutes, starting when the first question is played. Disconnects count. A verified infrastructure failure voids the attempt.
- Globally reserved questions, shuffled choices, and no question reuse. Exhausting the question bank stops new games without consuming an attempt.
- Signed Twilio incoming-call webhooks, authenticated bidirectional streams, Deepgram speech synthesis/recognition, and A/B/C/D or keypad 1–4 input.
- Answer audio is clipped to eight seconds after the playback mark. Recognition latency is outside the answer window. Only captured audio inside the window is graded; raw call recordings are not persisted.
- A durable execution outbox with a stable idempotency key and holding recheck. Global difficulty increments once per verified win, independently of transaction retries.

## What is not live yet

The token has not been launched, a phone number has not been purchased, and no mainnet transaction has been sent. No credentials were added. The following are still needed:

1. The Ring mint and an RPC endpoint, plus the Meteora launch configuration and metadata update authority.
2. A real Twilio number, account credentials, HTTPS/WebSocket routing, and Deepgram credentials. The live provider flow requires a real telephone test before opening it to players.
3. A reviewed, sourced question bank. Import tooling rejects matching fact keys and normalized exact text; a content reviewer must also reject paraphrases, ambiguous answers, and uneven difficulty. No automatic claim of semantic uniqueness is made.
4. A token-specific execution adapter implementing [EXECUTION.md](EXECUTION.md). This repository provides the authenticated boundary and retry worker, **not the on-chain signer or Meteora fee router**.
5. A decision on how long a winner receives fees. Fee proposals can be drafted, but the API rejects their publication until this policy is implemented. There is no implied one-hour term or permanent fee transfer.

Do not set `RING_LIVE=true` until these integrations have been tested. The UI and phone worker also require all configured integrations to be present before allowing play.

## Phone deployment

Copy `.env.example` to `.env.local` and configure it outside Git. Keep secrets on the server.

- Run the Next.js application with `npm run build` then `npm start`.
- Run `npm run voice` as one persistent worker behind an HTTPS reverse proxy that supports WebSocket upgrades.
- Run `npm run execute` as one persistent execution worker after the execution adapter exists.
- All three processes must use the **same absolute `RING_DB_PATH` on persistent local storage**. This initial version uses Node SQLite and a serialized application-state document. It is for a single app host and one active phone contestant, not horizontally scaled serverless instances.
- Set the Twilio number's incoming voice webhook to `VOICE_PUBLIC_URL/incoming` using POST, and call status callback to `VOICE_PUBLIC_URL/status` using POST. The worker uses `/code` and `/stream` internally.
- `APP_ORIGIN` must match the site's real origin exactly. `VOICE_PUBLIC_URL` must be HTTPS with no path suffix. Terminate TLS at the reverse proxy and keep the local worker private.
- Configure reverse-proxy body limits and IP request limits for the public API and inbound calls. App-level wallet/call rate limits are included but do not establish one human per wallet.

The first caller is active; other players wait on the website. Codes expire after ten minutes. Players whose code expires can rejoin; waiting never consumes their cooldown. The definitive target is captured at game start.

## Questions

Import a reviewed JSON file:

```sh
node --env-file-if-exists=.env.local --import tsx scripts/import-questions.ts reviewed-questions.json
```

Each item has this shape (example only, not a bank to repeatedly reuse):

```json
{
  "fact": "unique-canonical-fact-key",
  "text": "An unambiguous question with a verified answer?",
  "choices": ["Choice one", "Choice two", "Choice three", "Choice four"],
  "correct": 0,
  "source": "https://an-authoritative-source.example/page"
}
```

`correct` is zero-based. Reserve enough questions for a full attempt before a call starts. Reserved questions remain retired even when the caller loses or disconnects. Monitor supply; the required number grows without a cap.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests cover game progression, deadlines, callbacks, stream exclusivity, cooldowns, question exhaustion, disjoint question sets, queue order, wallet signatures/replay, origin checks, prelaunch gating, and tiny/zero/wrong-mint balances. Test databases use isolated temporary directories. See [DESIGN.md](DESIGN.md) for the art direction, research, asset prompt, and [VERIFICATION.md](VERIFICATION.md) for observed results.
