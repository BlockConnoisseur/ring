import type { Store } from "./game";
import { signerSelected } from "./signer-config";
export function liveReady() {
  return (
    process.env.RING_LIVE === "true" &&
    Boolean(
      process.env.RING_TOKEN_MINT &&
      process.env.RING_PHONE_NUMBER &&
      process.env.VOICE_PUBLIC_URL &&
      signerSelected() &&
      process.env.RING_DBC_POOL &&
      process.env.RING_INITIAL_FEE_RECIPIENT &&
      (process.env.RING_ASSET_ORIGIN || process.env.APP_ORIGIN),
    )
  );
}
export const canPost = () => Boolean(process.env.RING_TOKEN_MINT);
export function acceptingCalls(s: Store) {
  return (
    liveReady() &&
    !!s.worker &&
    !s.worker.error &&
    Date.now() - s.worker.heartbeat < 120000 &&
    Date.now() - (s.voiceHeartbeat || 0) < 45000 &&
    s.questions.filter((q) => !q.used).length >= 3 + s.wins * 2
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
