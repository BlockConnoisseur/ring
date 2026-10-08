import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CallLobby } from "../src/components/call-lobby";
import type { PublicState } from "../src/lib/types";

const state: PublicState = {
  live: true,
  required: 9,
  wins: 3,
  phone: "+14433489296",
  mint: "mint",
  proposals: [],
  session: { wallet: "wallet12345678", eligible: true, cooldownUntil: 0 },
  queue: { position: 1, code: "0123", expiresAt: 2000 },
};
const noop = () => {};
function render(overrides: Partial<PublicState> = {}, cooldown = 0) {
  return renderToStaticMarkup(
    createElement(CallLobby, {
      state: { ...state, ...overrides },
      now: 1000,
      cooldown,
      countdown: "09:00",
      busy: false,
      error: "",
      onConnect: noop,
      onCompose: noop,
      onCode: noop,
      onCancel: noop,
    }),
  );
}
test("call action requires a live eligible session and an unexpired code", () => {
  assert.match(render(), /href="tel:\+14433489296"/);
  for (const variant of [
    { live: false },
    { session: null },
    { session: { ...state.session!, eligible: false } },
    { queue: null },
    { queue: { position: 1, code: "0123", expiresAt: 999 } },
  ]) {
    assert.doesNotMatch(render(variant), /href="tel:/);
  }
  assert.doesNotMatch(render({}, 60000), /href="tel:/);
  assert.match(
    render({ queue: { position: 1, code: "0123", expiresAt: 999 } }),
    /No active call code/,
  );
});
test("active call keeps its locked target and hides the consumed code", () => {
  const html = render({
    lastGame: { status: "playing", correct: 2, target: 3, execution: null },
  });
  assert.match(html, /2 of 3 correct/);
  assert.match(html, /<dd>3<small> correct/);
  assert.doesNotMatch(html, /href="tel:|Private code: 0 1 2 3/);
});
