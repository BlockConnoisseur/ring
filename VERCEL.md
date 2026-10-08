# Ring website on Vercel

The `ring` project is hosted in `yeetrew1-1502s-projects`, using Next.js and Node 24. Production origin and immutable asset origin are `https://ringai.dev`. The `www` domain redirects to the apex.

The web runtime uses the existing restricted Supabase PostgreSQL login with verified TLS. Next.js tracing explicitly includes the public database CA certificate. Only the website's environment is configured on Vercel; Twilio/Deepgram secrets stay with the phone worker and the Turnkey API private key stays with the executor's private local configuration. `.vercelignore` excludes private local files from CLI uploads.

The phone worker stays on Render because it needs persistent bidirectional WebSockets. Vercel serves the website, authenticated proposal API and immutable token assets. The executor and question-feed workers require separate persistent hosting before launch.

`RING_LIVE=false` until a mint, pool, signer policies and worker readiness are verified. Prelaunch visitors can use the change dropdown and save drafts, but cannot bypass the token-holding requirement to post or get a real call code.

When live, an eligible post automatically reserves its four-digit code if the wallet is not cooling down or already in a call/queue. Otherwise the post stays open and its owner can obtain a code later. Codes map to wallet-owned immutable proposals, expire in ten minutes, and are hashed in storage. Caller-ID rate limits persist across redials.
