// Loaded only by the phone integration test's child process. Production has no
// mock flag, test credentials, alternate provider URL, or wallet bypass.
import { readStore } from "../../src/lib/store";
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/v1/speak"))
    return new Response(new Uint8Array(1280).fill(255));
  if (url.includes("/v1/listen")) {
    const g = (await readStore()).games.find((g) => g.status === "playing");
    const words =
      g?.index === 1
        ? [
            {
              word: ["alpha", "bravo", "charlie", "delta"][
                g.questions[g.index].correct
              ],
              start: 0.2,
              end: 0.5,
              confidence: 0.99,
            },
          ]
        : [];
    return Response.json({
      results: { channels: [{ alternatives: [{ words }] }] },
    });
  }
  if (url === "http://rpc.test") {
    const request = JSON.parse(String(init?.body));
    return Response.json({
      result: {
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: {
                    mint: process.env.RING_TOKEN_MINT,
                    owner: request.params[0],
                    tokenAmount: { amount: "1" },
                  },
                },
              },
            },
          },
        ],
      },
    });
  }
  throw new Error(`Unexpected network request in test: ${url}`);
};
