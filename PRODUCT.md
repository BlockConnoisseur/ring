# Ring

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users and purpose

Confirmed in the owner's project brief: Ring token holders propose changes to the coin, then call a real phone number to earn execution by answering a trivia streak. Any positive balance qualifies; users sign in with a connected Solana wallet.

## Workflow and constraints

Posts choose one change from a dropdown: name, ticker, picture, description, website or creator-fee recipient. An eligible post receives a private four-digit code linking its wallet and immutable proposal to the call. Each question has four options and an eight-second answer window. The target starts at three, increases by two after every win, and is locked at each game's start. Attempts are ten minutes apart per wallet. Questions must be unique across callers. The requested capacity is 30–60 or more simultaneous callers; synthetic tests are not live capacity certification.

The current site is prelaunch. Mint/pool configuration, signing permissions, remaining workers and live capacity verification are still required. Do not invent active calls, posts, wins or launched token claims.

## Brand commitments

The user chose Ring, a red landline, black/white/red, and supplied a handset-and-signal brand mark with a red I in the uppercase wordmark. The latest request explicitly adds a floating pill header, dark mode, separate pages and a hotline number that fits on one line. These user choices take precedence over generic style restrictions.

## Existing implementation

Next.js website on Vercel at ringai.dev; restricted Supabase database; persistent Twilio/Deepgram phone worker on Render; Turnkey signing integration. Functional permissions and game rules are enforced by the server, independently of visual themes or routes.
