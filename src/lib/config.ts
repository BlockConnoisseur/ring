export function liveReady() {
  return (
    process.env.RING_LIVE === "true" &&
    Boolean(
      process.env.RING_TOKEN_MINT &&
      process.env.RING_PHONE_NUMBER &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.VOICE_PUBLIC_URL &&
      process.env.DEEPGRAM_API_KEY &&
      process.env.RING_EXECUTOR_URL &&
      process.env.RING_EXECUTOR_SECRET,
    )
  );
}
export function requireLive() {
  if (!liveReady())
    throw new Error(
      "Ring is in prelaunch. Save your proposal as a draft for now.",
    );
}
export function origin() {
  return process.env.APP_ORIGIN || "http://127.0.0.1:3320";
}
