import { readFileSync } from "node:fs";
import { z } from "zod";
import { hash } from "../src/lib/game";
import { transact } from "../src/lib/store";
const schema = z.array(
  z.object({
    fact: z.string().trim().min(5),
    text: z.string().trim().min(10),
    choices: z.tuple([z.string(), z.string(), z.string(), z.string()]),
    correct: z.number().int().min(0).max(3),
    source: z.url(),
  }),
);
const file = process.argv[2];
if (!file)
  throw new Error(
    "Usage: npx tsx scripts/import-questions.ts path/to/reviewed-questions.json",
  );
const questions = schema.parse(JSON.parse(readFileSync(file, "utf8")));
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const count = transact((s) => {
  let imported = 0;
  for (const q of questions) {
    const fact = normalize(q.fact);
    if (
      s.questions.some(
        (old) =>
          normalize(old.fact) === fact ||
          normalize(old.text) === normalize(q.text),
      )
    )
      continue;
    if (new Set(q.choices.map(normalize)).size !== 4)
      throw new Error("Each question must have four different choices.");
    s.questions.push({ ...q, fact, id: hash(fact), used: false });
    imported++;
  }
  return imported;
});
console.log(
  `Imported ${count} new questions. Exact wording and fact-key duplicates were skipped. Human review must catch semantic rewordings.`,
);
