# Get Ring's phone number and voice

As of October 8, 2026, Ring's existing number **+1 (443) 348-9296** is connected to the public voice worker at `https://ring-voice.onrender.com`. Twilio's incoming callback is POST `/incoming`, and its completion callback is POST `/status`; both were read back from Twilio after configuration. Signed HTTPS checks return 200 and the prelaunch greeting, while unsigned requests return 403. A real handset call is still required.

The service runs on one Render Starter instance in Virginia ($7/month base hosting, plus provider usage). Deepgram credentials are configured, and live synthesis/transcription were tested successfully. `RING_LIVE=false`: the number plays a prelaunch message until the token, executor, hosting capacity and provider limits are ready. The website and executor are not deployed by this voice service.

The Twilio account has an individual compliance profile. Its business-only SHAKEN/STIR/branding setup cannot be completed without an eligible business profile; these outbound identity features are separate from routing incoming Ring calls. The account's 60–100 simultaneous-call allowance is **not verified**. Some upgraded accounts retain limits; obtain account-specific confirmation from Twilio before launch. See [Twilio concurrency limits](https://www.twilio.com/docs/api/errors/10004).

## Recreating the integration

A token does not have to exist to open these provider accounts. Keep the game in prelaunch until the token and executor are configured.

1. Create an account at [Twilio](https://www.twilio.com/try-twilio). Complete the account checks and select Programmable Voice. In the console, open **Phone Numbers → Manage → Buy a number** and choose a number with **Voice** capability. Review the displayed monthly and usage charges before purchasing. A physical phone or SIM for Ring is not required.
2. Save the number in international format (`+1…` for the US), the Account SID (`AC…`) and Auth Token. Ring uses the auth token to verify incoming Twilio webhook signatures. Trial accounts have restrictions; complete Twilio's upgrade requirements before inviting public callers.
3. Create an account at [Deepgram](https://console.deepgram.com/), choose/create a project and create an API key named Ring with access to speech recognition and text-to-speech. Ring uses Nova-3 recognition and Aura-2 speech. Review usage/billing in the account before public launch.
4. Put the values in the private server environment or local ignored `.env.local`:

```dotenv
RING_PHONE_NUMBER=+1...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=<private token>
DEEPGRAM_API_KEY=<private API key>
VOICE_PUBLIC_URL=https://<your voice-worker hostname>
```

The voice worker requires persistent HTTPS and WebSocket hosting. Turnkey manages the signing wallet; it does not replace this host. Once the worker is deployed, preview and apply Twilio's callback configuration:

```sh
npm run phone:configure
npm run phone:configure -- --apply
```

This configures the existing number; it does not buy one. Incoming calls go to POST `/incoming`, completion events to POST `/status`, and bidirectional audio uses `/stream`. Test with your own phone before opening the public queue. Do not set `RING_LIVE=true` until the token, executor and provider checks pass.

The Render service has automatic deployment disabled and uses its default TCP startup check. A replacement binds its port in standby, returns 503 to phone callbacks and WebSockets, and waits up to three minutes for the previous worker's singleton database lease to expire. It never recovers games or admits callers until it owns the lease. `/ready` returns 503 during that handoff and 200 once ready; do not configure it as Render's deployment health check, because Render must retire the old process first. Plan a maintenance window with calls closed and active games drained before deployment: this handoff interrupts calls and is not zero-downtime. Keep one voice instance.

References: [Twilio phone-number setup](https://www.twilio.com/docs/voice/tutorials/how-to-make-outbound-phone-calls), [trial limitations](https://help.twilio.com/hc/en-us/articles/360036052753-Twilio-Free-Trial-Limitations), [Deepgram API key](https://developers.deepgram.com/guides/fundamentals/make-your-first-api-request).
