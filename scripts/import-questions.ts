import { readFileSync } from "node:fs";
import { transact } from "../src/lib/store";
import { closeDatabase } from "../src/lib/database";
import {
  importQuestions,
  fetchQuestionBatch,
  fetchScienceQuestions,
} from "../src/lib/questions";
async function main() {
  const input = process.argv[2];
  if (input === "--sync") {
    const science = await fetchScienceQuestions();
    console.log(
      `science: imported ${await transact((s) => importQuestions(s, science))} new facts.`,
    );
    const offset = Number(process.argv[3] || 0);
    for (const category of ["paintings", "novels"] as const) {
      const questions = await fetchQuestionBatch(category, offset);
      console.log(
        `${category}: imported ${await transact((s) => importQuestions(s, questions))} new facts.`,
      );
    }
  } else {
    if (!input)
      throw new Error(
        "Pass a reviewed question JSON file, or --sync [offset] to import sourced Wikidata questions.",
      );
    console.log(
      `Imported ${await transact((s) => importQuestions(s, JSON.parse(readFileSync(input, "utf8"))))} fresh questions.`,
    );
  }
}
void main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
