# Ring

Hold any positive amount of Ring, post a token change, and call its real phone number. Answer three multiple-choice questions correctly in a row to apply your proposal. Every win adds two questions to the next target. Answers close eight seconds after the question/options finish and the beep plays. Each wallet gets one attempt every ten minutes.

## Run locally

Requires Node 24+. This app is separate from the existing Halo application.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3320. The design, proposal composer, local drafts and wallet sign-in work without launch credentials. Real posting opens once the exact mint is configured and a signed-in wallet holds at least one raw unit. The call queue also requires fresh questions, a healthy voice worker and a healthy execution worker.

## Implemented functionality

- Phantom/Solflare signed wallet login, single-use challenges and HttpOnly sessions.
- On-chain holding checks before publishing, queueing, playing and signing a winning change.
- Persistent proposal board and comments; a dropdown for coin name, ticker, profile picture, description and website link; immutable submitted payloads. Name/ticker updates change both the on-chain fields and published JSON.
- Private four-digit call codes tied to the wallet/proposal, issued immediately after a ready holder posts. Code replacement and cancellation are supported. Codes expire after ten minutes and are never included in public board responses. Callers can dial concurrently; there is no first-in-line gate. Phone code entry requires caller ID, with rate limits across redials.
- Twilio webhook signature verification and authenticated bidirectional Media Streams; Deepgram voice synthesis and transcription.
- Eight seconds of answer audio after the playback mark, A/B/C/D or keypad 1–4, first valid answer wins. Transcription latency never extends the window.
- Global question retirement and randomized option order; sourced question imports and an automatic refill worker. No stock means no new attempt.
- A global target of `3 + 2 × wins`, with durable cooldowns, disconnect handling and duplicate-callback protection.
- **In-repo Solana executor**: mutable Metaplex/SPL metadata and Token-2022 on-mint metadata updates and immutable public image/JSON assets. The executor never claims or redirects trading fees.
- Signed transactions are stored before broadcast, retried with identical bytes and reconciled at finality before a proposal is marked applied. Website callers cannot submit arbitrary transaction instructions.
- Live call/result and execution states, confirmed transaction links, worker readiness checks, and a configuration doctor.

## Fee policy

Trading fees and Meteora fee-claim rights stay with the project owner's wallet. Winning callers can change only the token name, ticker, profile picture, description and website. Fee proposals are rejected by the API, metadata builder and executor, including requests stored before this policy changed.

## Configure a real deployment

Copy `.env.example` to `.env.local` outside Git. Supply the public mint/pool addresses, RPC URL, Twilio number and credentials, Deepgram key, HTTPS origins and Turnkey signer settings. Follow [PHONE-SETUP.md](PHONE-SETUP.md) for the real number/voice accounts and [TURNKEY.md](TURNKEY.md) for the authority wallet. These accounts can be prepared before the token exists. The signer must hold the token metadata update authority. The owner keeps the Meteora fee rights; no transfer of fee or LP ownership is required. Keep a small SOL balance for transaction fees, account rent and metadata growth. Ring never asks players for their private keys.

```sh
npm run questions:sync
npm run phone:configure
npm run phone:configure -- --apply
npm run doctor
npm run build
```

`phone:configure` previews the webhook settings; `--apply` sets them on the configured **existing** Twilio number. It never buys a number. Incoming voice is POST `VOICE_PUBLIC_URL/incoming`; completion callback is POST `/status`; the worker handles `/code` and `/stream`. Set `VOICE_PUBLIC_URL` to an HTTPS origin with no path suffix.

Run four processes against the same database. For Supabase, set `RING_STORAGE=postgres` and the server-only `RING_DATABASE_URL` on each process; follow [SUPABASE.md](SUPABASE.md) for the private schema and existing-data migration. For local SQLite, use the **same absolute `RING_DB_PATH`** on durable storage:

```sh
npm start
npm run voice
npm run execute
npm run questions:worker
```

For Render, `npm run automation` combines the executor and question-refill process in a separate persistent service. Its public `GET /healthz` endpoint reports process health only; there are no HTTP signing or import actions. Give only this service the Turnkey API credential. Game readiness also verifies the mint's metadata authority, signer balance, and an unbroadcast signing test before the site or phone admits callers.

Set `RING_LIVE=true` after configuration. The website still closes the queue if workers are unavailable or questions run out. Test a real call before opening publicly. A database lease gives one voice process ownership of recovery; that process multiplexes up to `RING_MAX_ACTIVE_CALLS` independent contestants (default 100). Supabase allows the website and persistent workers to run on separate hosts. SQLite requires one host with shared disk. The voice worker always needs a persistent HTTPS/WebSocket host. See [CAPACITY.md](CAPACITY.md) for provider limits and load verification.

Alternatively, the included Docker Compose stack runs the four processes and Caddy TLS proxy. Set `APP_DOMAIN` and `VOICE_DOMAIN` to DNS names pointing to the host, `APP_ORIGIN` and `RING_ASSET_ORIGIN` to the website HTTPS origin, and `VOICE_PUBLIC_URL` to the voice HTTPS origin. Configure Turnkey as described above, then run `docker compose up --build -d`; no Solana private-key file is required. The optional `compose.keypair.yaml` adds a development-only local signer mount. With SQLite, back up the `ring-data` volume, including its live WAL or a consistent SQLite backup. With Supabase, configure database backups on the chosen plan. The database contains questions already used, sessions, proposals, assets and transaction receipts; do not reset it on deployments. The default Compose stack passes the Turnkey API private key only to the executor.

## Owner fee claims

Open `/fees`, connect the configured fee wallet using Phantom or Solflare, and sign in. Review the SOL payment, network fee and account rent, then approve the transaction in that wallet. The page claims only the original Ring DBC pool's partner fees, including residual DBC fees after migration; post-migration DAMM position fees are explicitly outside this page's scope. The server verifies the fixed mint/config/pool/owner on-chain. It never signs or chooses a different recipient. Native SOL is returned through a fresh temporary wrapped-SOL account; existing wallet wSOL is untouched.

The exact preparation and signed bytes are persisted in the shared store before broadcast. Recovery checks the original signature or resends those same bytes. Terminal finalized outcomes are retained. No new claim is prepared while a submitted transaction remains pending. Claiming does not require token holdings or live trivia services.

## Questions

The persistent automation service also runs an independent Open Trivia DB refill worker. It maintains at least 2,000 unused questions (or twice the configured concurrent-game requirement), spaces requests, persists session tokens, and backs off during source outages. Token expiration never resets Ring's own question retirement. Additional question data is from [Open Trivia DB](https://opentdb.com/), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); encoding is decoded and answer order is shuffled. Attribution also appears on the rules page.

`npm run questions:sync` imports canonical facts from Wikidata paintings/novels and the PubChem periodic table. An optional numeric argument selects the next Wikidata page: `npm run questions:sync -- 300`. `npm run questions:worker` refills low stock, persists its cursor and retries source outages. Sources can be incomplete or disputed; review the generated wording/difficulty for the intended audience. Manually authored questions can be imported with `npm run questions:import -- reviewed.json`:

```json
[{"fact":"unique-entity-property-key","text":"An unambiguous question?","choices":["One","Two","Three","Four"],"correct":0,"source":"https://source.example/fact"}]
```

Fact keys, normalized text and duplicate choices are checked. Sourced questions reuse an entity/property key even if wording changes, preventing that fact from being reintroduced. Manual imports must use consistent fact keys; there is no claim that arbitrary prose paraphrases are perfectly detected. The entire reserved set stays retired even after a loss, disconnect or infrastructure failure.

## Verification and remaining activation

```sh
npm test
npm run typecheck
npm run build
npm audit
```

Tests include an actual local HTTP/WebSocket call through the voice server with simulated providers, plus authenticated API flows, fee instruction construction, deadlines, replay protection, transaction recovery and asset preservation. See [VERIFICATION.md](VERIFICATION.md) and [EXECUTION.md](EXECUTION.md).

The website, phone number and persistent workers are configured for the reserved mint documented in TURNKEY.md. The signing wallet is funded. The token still needs to launch with mutable metadata, and its current authority must authorize the metadata-only handoff before gameplay opens. Complete a real end-to-end call after those on-chain checks pass.
