# Concurrent calls

Ring supports concurrent games on one phone number. `RING_MAX_ACTIVE_CALLS` defaults to 100; it is an application admission ceiling, not a claim of approved carrier capacity. One voice process multiplexes the calls, with independent audio buffers, deadlines, codes, holdings checks and cooldowns. A wallet cannot start another call while its previous game is active, even after ten minutes.

The question target locks atomically when each game starts. Each win increases the target for future games by two. If two callers start at three and both win, both wins count; the next game needs seven. Questions are reserved globally and never shared or recycled. Token changes execute serially in recorded win order, including fee settlement before switching recipients. A winner awaiting holdings or finality can delay later token changes.

At capacity, a new game is rejected before any question reservation or cooldown. Its private code remains valid until expiry. Codes are visible to all queued holders; queue position no longer controls who can dial. The website reports active games and the configured capacity.

## Provider and hosting requirements

- Twilio: an upgraded active account and sufficient approved Voice concurrency. Newly upgraded accounts may still need an approved Business Primary Customer Profile. Check the account limit for at least 100 calls; buying a number alone does not establish this. [Twilio concurrency guidance](https://help.twilio.com/articles/223180028-How-fast-can-I-place-or-receive-phone-calls-with-Twilio).
- Deepgram: Ring uses individual Aura-2 REST synthesis and Nova-3 prerecorded transcription requests. It does not keep one Voice Agent connection per caller. Current published pay-as-you-go REST limits are 15 concurrent TTS and 50 STT requests. Ring defaults to 12 TTS / 40 STT requests, queuing bursts FIFO within the same project quota. The eight-second answer window begins after question playback and is independent of time spent waiting for synthesis or grading. Shared project traffic needs additional headroom. Queue exhaustion/timeouts void the game, clear its cooldown and keep questions retired. [Deepgram limits](https://developers.deepgram.com/reference/api-rate-limits).
- Hosting: one always-on voice instance with HTTPS/WebSockets, close to Supabase, plus the separate website/executor/question workers. Do not horizontally replicate voice processes yet: the singleton lease intentionally prevents two recovery owners. Increasing replicas without per-call worker ownership is unsupported. A $7 starter server is not a demonstrated 60-call production sizing result. Measure the actual hosted instance before launch, including CPU, memory, event-loop delays, database latency and provider delays.
- Question supply: admission requires a complete unused set. For 100 simultaneous new games at target 3, reserve at least 300 unused questions (600 for two waves). After 100 wins the target becomes 203: a full 100-call wave then needs 20,300 unused questions. The importer begins refilling below two waves, but source availability and throughput are not guaranteed. Question exhaustion closes new games without recycling facts.

## Verification and launch gate

`npm run test:phone-load` runs 60 real local HTTP/WebSocket sessions against simulated speech/RPC providers. Set `RING_LOAD_CALLERS=100` for the upper tested count. It validates independent game completion, unique question sets, eight-second windows, cooldowns, and one execution per win. It never places external calls or changes a token.

`npm run test:postgres` exercises 100 concurrent admissions, 300 answers and 100 replays through real Postgres transactions on a disposable local database. The production state is still stored as one JSONB document under a row lock; this ensures atomic reservations and wins, but sustained history growth increases write cost. Website polling uses unlocked reads. A hosted soak test with realistic accumulated data remains required; these local tests do not establish live carrier, cloud database, or provider capacity.

Keep Ring in prelaunch until account limits, hosting, token authorities, adequate question inventory, and an end-to-end load test are verified. The proposed 100-call limit can be lowered without code changes if the measured instance or approved provider capacity is smaller.
