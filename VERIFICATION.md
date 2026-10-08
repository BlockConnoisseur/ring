# Verification — 2026-10-08

## Vercel and four-digit proposal flow

`https://ringai.dev` is deployed on Vercel with verified HTTPS. `www.ringai.dev` redirects to the apex. The production `/api/state` returns 200 using the restricted Supabase connection and its bundled CA certificate. GitHub main is connected for future Vercel deployments. The site remains in prelaunch (`RING_LIVE=false`, no mint).

The proposal form has six choices: coin name, ticker, picture, description, website and fee recipient. Eligible live posts automatically reserve a private four-digit code tied to that wallet and immutable proposal; codes expire after ten minutes and only hashes are stored. Callbacks enforce caller-ID rate limits across redials. The updated 45-case application suite, TypeScript and production build passed. Tests cover code collisions/exhaustion, replacement, owner-only access, each proposal type, the complete timed phone game and worker lease handoff. A new 100-call synthetic provider run completed in 28 seconds with admissions in 422ms. This does not certify live hosted/carrier capacity or actual on-chain execution.

The replacement voice process can listen in standby during deployment, but rejects requests and does not recover games until the previous lease is released or expires. The handoff test verifies both sides of that boundary. Deploy with calls closed and drained; this is a maintenance handoff, not zero-downtime.

Commit `d0b53cd` is live on Vercel and Render. After the real Render handoff, `/ready` returned 200 with `ready: true` and `codeDigits: 4`; signed `/incoming` and `/status` returned 200, unsigned `/incoming` returned 403. Twilio API readback confirms the existing number still points to those Render POST endpoints. Desktop and 390px mobile checks verified the conditional form, saved/restored private draft and disabled prelaunch posting. The extra filters initially overflowed on mobile; wrapping now keeps document width within the viewport. The temporary test draft was removed.

Render's dashboard still reports a failed payment requiring the account owner's payment-method update. Other launch blockers remain: mint/pool configuration, restricted signing policies, persistent executor/question-feed hosting, real handset verification and live provider/host concurrency validation. No live games or token changes were enabled.

## Concurrent-call update

The current build allows up to 100 simultaneous games, with a target locked at admission. Verification: 42 application tests passed, eight real local PostgreSQL integration tests passed, TypeScript passed, and the production build passed. A separate load run completed 100 simultaneous authenticated HTTP/WebSocket calls, each with three eight-second answer windows, unique questions, one win and one execution. The 100-call run took about 28 seconds, with admissions in 553ms. Its speech and Solana responses are simulated. The PostgreSQL test performed 100 admissions, 300 answers and 100 duplicate answer replays in 3.25 seconds without lost updates. These are local measurements, not cloud or carrier capacity certification. See [CAPACITY.md](CAPACITY.md).

Provider setup: the supplied Twilio credentials authenticated successfully, the configured number is owned and voice-capable, and the account reports Full/active. A dedicated Deepgram key was created; live authentication, Aura-2 synthesis and Nova-3 transcription returned HTTP 200. The Ring Authority Solana wallet and non-root Ring executor API user are created; live Turnkey authentication and wallet-account verification succeeded. Signing policies await the actual mint and pool addresses. Private credentials remain in ignored local files and the relevant host environment, never Git.

The voice worker is deployed on Render at `https://ring-voice.onrender.com`, connected to the existing restricted Supabase runtime login. Deployment of commit `68edb88` succeeded after repairing missing optional npm lock entries. The phone integration test passed after the dependency update; the Render install reported zero vulnerabilities. Public signed `/incoming` and `/status` checks returned 200, while unsigned `/incoming` returned 403. Twilio number +1 (443) 348-9296 now uses those HTTPS callbacks with POST; API readback confirmed both settings and no overriding application/trunk. Incoming requests produce the prelaunch greeting.

No real handset call, live Turnkey signature, token transaction or 60-person live provider load test has completed. Ring remains in prelaunch. The single $7/month Starter host has not been validated for that concurrency requirement. The account has an individual compliance profile and no registered business, so business-only outbound identity registrations remain incomplete. Its actual carrier concurrency allowance also remains unverified; Full/active status alone does not establish 60–100-call capacity. See [Twilio's account concurrency guidance](https://www.twilio.com/docs/api/errors/10004).

## Earlier verification

The functional implementation was tested with isolated temporary SQLite databases and a separate PostgreSQL 17 cluster. The user-selected Supabase project was subsequently provisioned and verified with a restricted app login. No funds were moved.

Observed results: **34 test cases passed** (33 in the full suite, followed by the added DAMM v2 case and its DBC companion), TypeScript checks passed, the production build passed, and `npm audit` reported **zero known vulnerabilities** after dependency hardening. The later asset-storage refinement also passed its 11 affected API/execution tests and a fresh production build. The local persistent bank contains 405 sourced questions (287 art facts and 118 science facts); one subsequent Wikidata import timed out without changing or recycling existing questions.

Supabase storage work: the full 34-case suite passed after converting storage calls to async. Seven additional PostgreSQL integration cases passed with the actual migration and a restricted runtime login. They cover concurrent state updates, rollback, SQLite import, callback races and disjoint question sets, lease takeover, reconnect recovery, asset immutability and anonymous access/RLS.

Cloud activation: the user-selected Rings project now has the private schema and a restricted runtime login. The app connected through the supplied pooler with certificate and hostname verification using Supabase's official CA. All 405 questions were imported. Anonymous/authenticated roles cannot use the private schema and the runtime role cannot overwrite assets. Supabase security advisors reported no findings for Rings. Performance advisors returned an informational Auth connection-allocation setting, unrelated to Ring's wallet authentication; see [Supabase's deployment guide](https://supabase.com/docs/guides/deployment/going-into-prod). The original application's tables in the earlier project remain intact; the unused empty Ring schema there was removed.

Turnkey: four additional signer tests exercise the official Solana SDK serializer with a simulated completed response, validate signature verification, reject message changes and invalid signatures, propagate policy rejection and verify local-key compatibility. No actual Turnkey account credentials, wallet, or live signing policy have been supplied. All 38 application cases and seven PostgreSQL integration cases passed (45 total). TypeScript and production build pass; npm audit reports zero known vulnerabilities. The local site connected to the configured cloud database and returned HTTP 200 from `/api/state`, correctly reporting prelaunch, no mint and an initial target of three.

## Automated coverage

- Signed wallet login rejects forgery, replay and cross-origin mutation. A wallet holding one raw token unit can publish each proposal type, comment, queue, replace its private code and cancel; zero balances cannot publish.
- Game progression enforces 3, 5, 7… targets locked at admission, eight-second deadlines, global retirement, ten-minute cooldowns, bounded concurrent games and one active game per wallet.
- The phone integration test starts the real voice server as a child process, sends signed Twilio HTTP callbacks, opens a signed WebSocket, plays three eight-second windows, uses both DTMF and simulated speech, and verifies one win and one execution record. An earlier spoken correct answer beats a later wrong keypad input. Duplicate completion callbacks do not duplicate the win. Twilio and Deepgram responses are test fixtures, not live provider calls.
- Audio tests cover clipping, duplicated frames and coverage checks.
- Transaction journal tests cover a crash/timeout after broadcast, recovery with identical bytes, changed-intent rejection, finality, expiry, and a still-processed signature that must not be replaced.
- Meteora DBC and DAMM v2 instruction tests use the real SDK builders with fixture account state and verify creator/position fee instructions, recipient ATAs, fixed authority, and no liquidity removal or token-account close/treasury transfer.
- Metadata tests verify preservation of unrelated fields and media. Asset tests verify immutable content addressing. Fee application is idempotent.
- Integer conversion tests cover unsigned 64/128/256-bit boundaries, overflow, negative input and input-buffer preservation.

The installed Meteora stack uses web3.js/Anchor. Dependency overrides update Jayson and TOML, and replace the vulnerable native `bigint-buffer` addon with the small bounds-checked JavaScript codec in `vendor/`. No native converter is loaded. Recheck audit results when updating dependencies.

## Limits

The previous turn's desktop/mobile design screenshots remain in `docs/`. This turn's browser check was blocked by the browser tool's URL security policy; the new result/code-recovery UI was not visually rechecked.

The public HTTPS voice service and Turnkey API credentials are configured, but there is no Ring mint, Meteora pool or completed signing policy. There has been no real handset call or devnet/mainnet metadata/fee transaction. The tests exercise protocol handling and SDK instruction construction, not actual deployed pool permissions, carrier latency, token UI cache refresh, or real fund delivery. The website, executor and question worker are not hosted by the Render voice service. Docker/Caddy deployment files are supplied but the full stack has not been deployed here.

Run `npm run doctor` with the real environment, verify its authority/pool/phone checks, and perform a live acceptance call on the chosen token setup before opening the line publicly.
