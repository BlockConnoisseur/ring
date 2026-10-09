# Turnkey signing

Ring supports Turnkey for the token authority wallet. It uses the official pinned `@turnkey/sdk-server` and `@turnkey/solana` packages. The executor asks Turnkey to sign a complete Solana transaction, verifies that the message is unchanged and the signature is valid, persists the signed bytes, and then broadcasts through the configured RPC. Turnkey never receives a request to send the transaction itself.

Player login remains Phantom/Solflare. This integration controls Ring's project authority, not player wallets. The Solana private key remains with Turnkey; the executor needs a separate API authentication key.

## Account setup

1. Sign up at [app.turnkey.com](https://app.turnkey.com/) and create an organization for Ring.
2. Create a wallet named Ring Authority with a Solana account (Ed25519, Solana address format). Keep its public address for `TURNKEY_SIGNER_ADDRESS`. This can be created before the token exists.
3. Create a dedicated **non-root** API user for the executor and an API key pair. Save the organization ID, API public key and API private key in the executor's private environment. Keep organization ownership/recovery with your own account.
4. Before enabling live execution, grant that user signing permission for only the Ring authority wallet and the required transaction shapes. Use parsed Solana transaction policies: Ring calls `signTransaction`, never `signRawPayload`. Policies should restrict metadata updates to the Ring mint and bounded metadata rent top-ups. Do not grant blanket transfers, wallet exports or organization administration. Exact mint restrictions must wait until those addresses exist. Turnkey root quorum can bypass normal policies; test with the non-root runtime user.
5. When launching the token, retain or transfer only metadata update authority to this Turnkey wallet. The project owner keeps all Meteora fee-claim and LP rights. Revoked update authority cannot be restored by this app. Supply the resulting mint/pool addresses and a small SOL balance for fees/rent before going live.

```dotenv
RING_SIGNER=turnkey
TURNKEY_ORGANIZATION_ID=<organization ID>
TURNKEY_SIGNER_ADDRESS=<Solana address>
TURNKEY_API_PUBLIC_KEY=<API public key>
TURNKEY_API_PRIVATE_KEY=<API private key>
```

These are server environment variables, never `NEXT_PUBLIC_` values. The website and voice worker only need `RING_SIGNER` and `TURNKEY_SIGNER_ADDRESS` for readiness; they do not need the API private key. The default Docker Compose stack clears that private key from the website, voice and question containers and passes it only to the executor. No Solana keypair-file mount is required in Turnkey mode.

Run `npm run doctor` after configuration. The doctor checks required values and on-chain authority once the token exists. The executor additionally verifies a real signature on an unbroadcast, no-op metadata transaction before advertising readiness, and repeats that permission check every ten minutes. `RING_LIVE=true` arms the services; admission still requires a healthy signer, voice worker and question stock.

## Local development

Use `RING_SIGNER=keypair` and `RING_AUTHORITY_KEYPAIR=/absolute/path/keypair.json` for an isolated development signer. Unknown providers or missing Turnkey settings fail instead of falling back to a key file. For Docker, use `docker compose -f compose.yaml -f compose.keypair.yaml up --build -d` with the development key at `.secrets/authority.json`.

## Verification

On October 8, 2026, the Ring Authority wallet and its Solana account were created. A separate non-root Ring executor user and API key are configured in the ignored local environment. Live `getWhoami` authentication and `getWalletAccounts` succeeded, and the returned account matches `TURNKEY_SIGNER_ADDRESS`. The Solana private key was not exported.

The reserved mint is `GuT6mfBehxBXiT1UqyoDEdX8yPLE8xwB5zzSAUm8DCxZ`. The user approved the mint-scoped `Ring metadata only - GuT6mf` policy, and a real metadata signature passed cryptographic verification without broadcasting. The policy permits one legacy Metaplex UpdateV1 data instruction for this mint, with the new-authority field absent and fixed account restrictions. It grants no Meteora fee claims, transfers, exports or administration.

The executor and question-refill process are deployed as the separate `ring-automation` Render service. Website and voice configuration use the same reserved mint and Supabase database. At this setup checkpoint the mint had not launched, and the signer held zero SOL. Launch must retain mutable metadata; afterward, the current update authority must approve its transfer to `FoCjYoXoC3ihDSRHWZ3EFPAx3NDF3yQtJeQCmvHt1PoF`, and this signer needs at least 0.01 SOL. Existing metadata hosts must pass the allowlist. Fees remain controlled by `6n3erAFxnvfjsAfbPdabwnpvfGpi2RW5Z8Yk1AYspzXs`. Complete on-chain checks and a real end-to-end call before declaring gameplay ready.

The tests exercise the real Turnkey Solana serializer against a simulated completed signing response, verify Ed25519 signatures, reject altered messages and invalid signatures, propagate policy rejection, and confirm local-signer compatibility.

References: [Solana SDK](https://docs.turnkey.com/sdks/web3/solana), [official example](https://github.com/tkhq/sdk/tree/main/examples/chain-integrations/with-solana), [Solana policies](https://docs.turnkey.com/features/policies/examples/solana).
