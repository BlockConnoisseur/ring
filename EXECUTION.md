# Token execution boundary

The website and voice host cannot sign arbitrary token transactions. They send a verified, immutable winning proposal to one deployment-configured adapter. The adapter must be built against the actual Ring mint, retained metadata authority, Meteora pool, and fee policy before live mode is enabled.

`src/lib/executor.ts` sends a POST to `RING_EXECUTOR_URL`. `X-Ring-Signature` is an HMAC-SHA256 over the exact raw JSON body using `RING_EXECUTOR_SECRET`. `Idempotency-Key` matches the persistent execution job ID.

Payload fields: `idempotencyKey`, `gameId`, `proposalId`, `wallet`, `mint`, `action`, `value`, `image`, `timestamp`.

Adapter requirements:

1. Verify HMAC with a timing-safe comparison and reject stale timestamps. Reject unknown fields/actions and mismatched mint addresses.
2. Fetch the authoritative game/proposal record from the private store and verify the completed streak, ownership, exact payload, and execution order. A valid caller-provided JSON blob alone never authorizes a transfer.
3. Recheck the submitting wallet's positive Ring balance immediately before sending. A recipient fee wallet may differ from the player's wallet.
4. For metadata, keep update authority under restricted server/program control. Only the image URI or description should change. Preserve unrelated fields. Do not expose minting, freeze, authority transfer, liquidity withdrawal, or arbitrary transaction capabilities to callers.
5. Store immutable image/metadata versions and verify file/content constraints before the attempt. Token UIs can cache metadata; transaction confirmation does not mean every trading app has refreshed.
6. For fees, settle accrued earnings to the previous recipient before changing future distribution. Cover both DBC and post-graduation DAMM v2 fee claims. Only project-controlled fees are eligible. Define the duration/expiry policy before accepting a fee proposal.
7. Persist the exact signed transaction and its signature before broadcasting. Retries reuse or reconcile that receipt, including ambiguous responses and blockhash expiry; never blindly submit another payment.
8. Return `{ "transaction": "<base58 Solana signature>" }`. Ring independently checks confirmed/finalized status before marking the proposal applied. The adapter remains responsible for proving that the receipt performs the intended action, rather than returning an unrelated confirmed signature.

The execution worker handles jobs in win order. A holding failure pauses that job until the player holds Ring again; it does not silently send a different proposal. Operator resolution for permanently abandoned jobs must be explicit before a production launch.

## Sources checked on 2026-10-07

- [Meteora Dynamic Bonding Curve](https://github.com/MeteoraAg/dynamic-bonding-curve): configurable launch parameters and metadata authority options.
- [Meteora SDK changelog](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/CHANGELOG.md): creator and partner fee claims with custom receivers.
- [Meteora Dynamic Fee Sharing SDK](https://github.com/MeteoraAg/dynamic-fee-sharing-sdk/blob/main/docs.md): fee-vault distribution primitives. Its name alone is not evidence that the required repeated single-winner routing is supported.
- [Metaplex metadata updates](https://www.metaplex.com/docs/smart-contracts/token-metadata/update): mutable metadata and authorized updates.
- [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages): playback marks, inbound timestamps, and DTMF messages.
- [Deepgram raw-audio sample rate](https://developers.deepgram.com/docs/sample-rate/) and [word timing](https://developers.deepgram.com/docs/pre-recorded-audio): bounded audio transcription.
