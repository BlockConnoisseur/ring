# Ring execution

The execution worker reads verified wins directly from the shared database (Supabase Postgres or local SQLite). It accepts no external execution payload and exposes no signing endpoint. It processes wins in order and never accepts caller-provided instructions, program IDs, RPC endpoints or metadata destination URLs.

## Metadata

`src/lib/token-metadata.ts` reads the exact configured mint, checks its token program and update authority, loads its current JSON, preserves unrelated fields and changes only the submitted description or image. Image changes replace the prior image attachment while retaining other media and properties. Images and resulting JSON live at content-addressed `/api/assets/<sha256>` URLs, stored in the shared database and served with immutable caching. Keep this origin and database available permanently.

For SPL tokens, Metaplex `updateV1` preserves name, symbol, creators and royalty settings. Metadata must remain mutable. For Token-2022, Ring supports metadata stored on the mint, updates its URI through the metadata interface, and tops up rent if the URI grows. External metadata-pointer programs and transfer-hook fee claims are not supported. The existing JSON's host must be in the configured allowlist; redirects are rejected and JSON size is bounded.

## Meteora fees

`src/lib/meteora.ts` verifies the DBC pool's base mint and creator authority. It builds only `claimCreatorTradingFee` plus idempotent recipient token-account creation. After migration, set `RING_DAMM_POOL`; the worker verifies it contains Ring and discovers the configured authority's positions in that pool, then builds `claimPositionFee`. A missing migrated pool or position fails closed. DAMM v1 is not implemented.

Both token sides go directly to the selected recipient's associated token accounts. WSOL stays wrapped. No swap, liquidity withdrawal, mint, authority transfer, reward claim, treasury transfer or token-account close instruction is built.

The current fee recipient, settlement plans and payout receipts persist in the private store. A fee win settles the old recipient before a signed memo records the new policy. Following memo finality, a single database transaction changes the recipient and marks the proposal applied. Periodic claims run about once a minute, with five-second receipt/retry checks. This is a server-controlled fee router; the on-chain memo does not independently enforce routing.

## Recovery

`src/lib/operations.ts` stores the signed transaction bytes, signature, intent hash and last valid block height **before** broadcasting. Repeated calls use the same operation ID and bytes. Different intent under that ID is rejected. Applied means finalized, not just submitted.

When a signature is missing, replacement requires a finalized block height beyond its validity and a second history lookup that still shows no signature. A processed/confirmed signature is never replaced. A definitive failed transaction stays pending for operator diagnosis rather than being retried blindly. `npm run doctor` reports the worker's private error. A fresh winning operation requires a positive holding check immediately before signing; after signing, recovery follows the original receipt even if holdings later change.

A missing holding pauses the winning job until the same wallet holds Ring again. Later winning jobs wait behind it. This deliberate ordering prevents an old delayed metadata change from overwriting a later winner. An operator should resolve a permanently abandoned job explicitly before resuming the line; no silent forfeiture rule is built in.

The executor uses a renewable database lease; operation IDs also prevent duplicate broadcasts across retries. Only one voice worker should run per database. The store binds itself to its first configured token mint, preventing accidental reuse for another token.

## Sources checked

- [Meteora DBC creator implementation](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/src/services/creator.ts)
- [Meteora DAMM v2 implementation](https://github.com/MeteoraAg/cp-amm-sdk/blob/main/src/CpAmm.ts)
- [Metaplex metadata updates](https://www.metaplex.com/docs/smart-contracts/token-metadata/update)
- [Twilio Media Stream messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages)
- [Wikidata query examples](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/queries/examples)
- [PubChem periodic table data](https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON)
