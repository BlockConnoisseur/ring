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
- Persistent proposal board and comments; picture, description and fee-wallet proposals; immutable submitted payloads.
- Private six-digit call codes tied to the wallet/proposal, queue order, code replacement and cancellation.
- Twilio webhook signature verification and authenticated bidirectional Media Streams; Deepgram voice synthesis and transcription.
- Eight seconds of answer audio after the playback mark, A/B/C/D or keypad 1–4, first valid answer wins. Transcription latency never extends the window.
- Global question retirement and randomized option order; sourced question imports and an automatic refill worker. No stock means no new attempt.
- A global target of `3 + 2 × wins`, with durable cooldowns, disconnect handling and duplicate-callback protection.
- **In-repo Solana executor**: mutable Metaplex/SPL metadata and Token-2022 on-mint metadata updates, immutable public image/JSON assets, Meteora DBC creator fee claims and owned DAMM v2 position fee claims after migration.
- Signed transactions are stored before broadcast, retried with identical bytes and reconciled at finality before a proposal is marked applied. Website callers cannot submit arbitrary transaction instructions.
- Live call/result and execution states, confirmed transaction links, worker readiness checks, and a configuration doctor.

## Fee policy

The chosen recipient receives Ring's project-controlled creator trading fees until another fee proposal is applied. Before switching, the worker finishes its current payout and settles fees to the previous recipient. Fees collected in that settlement belong to the old recipient; subsequent collections belong to the new one. The policy change gets a signed Solana memo receipt; individual payouts have their own fee-claim receipts. The database/worker enforces routing; the memo is an audit record, not an on-chain routing contract.

The worker retains the creator/position authority. Protocol fees, another LP's fees, liquidity, token supply and unrelated treasury balances are outside the action set. SOL-denominated fees arrive in the recipient's **wrapped SOL token account**. No treasury token account is closed or swept. This default policy can be changed before launch; no live fee routing has been activated.

## Configure a real deployment

Copy `.env.example` to `.env.local` outside Git. Supply the public mint/pool addresses, RPC URL, Twilio number and credentials, Deepgram key, HTTPS origins and Turnkey signer settings. Follow [PHONE-SETUP.md](PHONE-SETUP.md) for the real number/voice accounts and [TURNKEY.md](TURNKEY.md) for the authority wallet. These accounts can be prepared before the token exists. The signer must be the DBC creator, own its fee-bearing DAMM v2 positions after migration, and retain the token metadata update authority. Keep a small SOL balance for transaction fees, account rent and metadata growth. Ring never asks players for their private keys.

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

Set `RING_LIVE=true` after configuration. The website still closes the queue if workers are unavailable or questions run out. Test a real call before opening publicly. A database lease gives one voice worker ownership of the line; only one contestant plays at a time. Supabase allows the website and persistent workers to run on separate hosts. SQLite requires one host with shared disk. The voice worker always needs a persistent HTTPS/WebSocket host.

Alternatively, the included Docker Compose stack runs the four processes and Caddy TLS proxy. Set `APP_DOMAIN` and `VOICE_DOMAIN` to DNS names pointing to the host, `APP_ORIGIN` and `RING_ASSET_ORIGIN` to the website HTTPS origin, and `VOICE_PUBLIC_URL` to the voice HTTPS origin. Configure Turnkey as described above, then run `docker compose up --build -d`; no Solana private-key file is required. The optional `compose.keypair.yaml` adds a development-only local signer mount. With SQLite, back up the `ring-data` volume, including its live WAL or a consistent SQLite backup. With Supabase, configure database backups on the chosen plan. The database contains questions already used, sessions, proposals, assets, payout policy and transaction receipts; do not reset it on deployments. The default Compose stack passes the Turnkey API private key only to the executor.

## Questions

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

No token was launched, phone number purchased, signer funded, or mainnet transaction sent. Live operation still requires the project's credentials, token configuration and durable HTTPS host. These are setup inputs, not an external execution adapter left to implement.
