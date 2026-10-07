# Verification — 2026-10-07

The functional implementation was tested with isolated temporary SQLite databases and a separate PostgreSQL 17 cluster. Production credentials and funds were not used.

Observed results: **34 test cases passed** (33 in the full suite, followed by the added DAMM v2 case and its DBC companion), TypeScript checks passed, the production build passed, and `npm audit` reported **zero known vulnerabilities** after dependency hardening. The later asset-storage refinement also passed its 11 affected API/execution tests and a fresh production build. The local persistent bank contains 405 sourced questions (287 art facts and 118 science facts); one subsequent Wikidata import timed out without changing or recycling existing questions.

Supabase storage work: the full 34-case suite passed again after converting storage calls to async. Seven additional PostgreSQL integration cases passed with the actual migration and a restricted runtime login. They cover concurrent state updates, rollback, SQLite import, callback races and disjoint question sets, lease takeover, reconnect recovery, asset immutability and anonymous access/RLS. The production build and TypeScript checks passed with the new adapter; the dependency audit remains at zero known vulnerabilities. These results validate local PostgreSQL behavior, not a provisioned cloud connection. Cloud project selection is still pending, and no existing Supabase project has been changed.

## Automated coverage

- Signed wallet login rejects forgery, replay and cross-origin mutation. A wallet holding one raw token unit can publish each proposal type, comment, queue, replace its private code and cancel; zero balances cannot publish.
- Game progression enforces 3, 5, 7… consecutive answers, eight-second deadlines, global retirement, ten-minute cooldowns and one active caller.
- The phone integration test starts the real voice server as a child process, sends signed Twilio HTTP callbacks, opens a signed WebSocket, plays three eight-second windows, uses both DTMF and simulated speech, and verifies one win and one execution record. An earlier spoken correct answer beats a later wrong keypad input. Duplicate completion callbacks do not duplicate the win. Twilio and Deepgram responses are test fixtures, not live provider calls.
- Audio tests cover clipping, duplicated frames and coverage checks.
- Transaction journal tests cover a crash/timeout after broadcast, recovery with identical bytes, changed-intent rejection, finality, expiry, and a still-processed signature that must not be replaced.
- Meteora DBC and DAMM v2 instruction tests use the real SDK builders with fixture account state and verify creator/position fee instructions, recipient ATAs, fixed authority, and no liquidity removal or token-account close/treasury transfer.
- Metadata tests verify preservation of unrelated fields and media. Asset tests verify immutable content addressing. Fee application is idempotent.
- Integer conversion tests cover unsigned 64/128/256-bit boundaries, overflow, negative input and input-buffer preservation.

The installed Meteora stack uses web3.js/Anchor. Dependency overrides update Jayson and TOML, and replace the vulnerable native `bigint-buffer` addon with the small bounds-checked JavaScript codec in `vendor/`. No native converter is loaded. Recheck audit results when updating dependencies.

## Limits

The previous turn's desktop/mobile design screenshots remain in `docs/`. This turn's browser check was blocked by the browser tool's URL security policy; the new result/code-recovery UI was not visually rechecked.

No public mint, real phone credentials, authority signer, or HTTPS deployment was supplied. Consequently there has been no real handset call or devnet/mainnet metadata/fee transaction. The tests exercise protocol handling and SDK instruction construction, not actual deployed pool permissions, provider audio latency, token UI cache refresh, or real fund delivery. Docker/Caddy deployment files are supplied but the stack has not been deployed here.

Run `npm run doctor` with the real environment, verify its authority/pool/phone checks, and perform a live acceptance call on the chosen token setup before opening the line publicly.
