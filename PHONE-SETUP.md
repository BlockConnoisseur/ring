# Get Ring's phone number and voice

The phone integration is implemented; account credentials and a public voice-worker host are needed to activate it. A token does not have to exist to open these provider accounts. The game remains in prelaunch until the token and executor are configured.

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

References: [Twilio phone-number setup](https://www.twilio.com/docs/voice/tutorials/how-to-make-outbound-phone-calls), [trial limitations](https://help.twilio.com/hc/en-us/articles/360036052753-Twilio-Free-Trial-Limitations), [Deepgram API key](https://developers.deepgram.com/guides/fundamentals/make-your-first-api-request).
