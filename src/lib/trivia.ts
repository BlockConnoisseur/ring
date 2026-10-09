import { z } from "zod";
import { hash } from "./game";
import { questionsSchema } from "./questions";

const encoded = z
  .string()
  .min(4)
  .max(4096)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const rowSchema = z.object({
  question: encoded,
  correct_answer: encoded,
  incorrect_answers: z.array(encoded).length(3),
});
const normalize = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]/g, "");

// Source data is CC BY-SA 4.0. Keep attribution in the rules and documentation.
// Stable keys survive token expiration; importQuestions also checks all retired text.
export function parseTrivia(input: unknown) {
  const response = z
    .object({
      response_code: z.number().int(),
      results: z.array(z.unknown()).optional(),
    })
    .parse(input);
  const questions: z.infer<typeof questionsSchema> = [];
  if (response.response_code !== 0)
    return { code: response.response_code, questions };
  if (!response.results)
    throw new Error("Trivia source returned no results array.");
  for (const raw of response.results) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) continue;
    const decode = (value: string) =>
      Buffer.from(value, "base64").toString("utf8").trim();
    const text = decode(row.data.question);
    const choices = [
      row.data.correct_answer,
      ...row.data.incorrect_answers,
    ].map(decode);
    if ([text, ...choices].some((value) => /[\u0000-\u001f\ufffd]/.test(value)))
      continue;
    if (new Set(choices.map(normalize)).size !== 4) continue;
    const parsed = questionsSchema.safeParse([
      {
        fact: `opentdb:${hash(normalize(text))}`,
        text,
        choices,
        correct: 0,
        source: "https://opentdb.com/",
      },
    ]);
    if (parsed.success) questions.push(...parsed.data);
  }
  return { code: 0, questions };
}

export async function requestTrivia(token?: string) {
  const url = new URL(
    token ? "https://opentdb.com/api.php" : "https://opentdb.com/api_token.php",
  );
  url.search = token
    ? new URLSearchParams({
        amount: "50",
        type: "multiple",
        encode: "base64",
        token,
      }).toString()
    : "command=request";
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Trivia source unavailable.");
  const data: unknown = await response.json();
  if (token) return { ...parseTrivia(data), token };
  const issued = z
    .object({
      response_code: z.literal(0),
      token: z.string().regex(/^[a-zA-Z0-9]{16,256}$/),
    })
    .parse(data);
  return { code: 0, token: issued.token, questions: [] };
}
