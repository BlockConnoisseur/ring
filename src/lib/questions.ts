import { z } from "zod";
import { randomInt } from "node:crypto";
import { hash, type Store } from "./game";

export const questionsSchema = z.array(
  z.object({
    fact: z.string().trim().min(5).max(200),
    text: z.string().trim().min(10).max(300),
    choices: z.tuple([
      z.string().min(1).max(100),
      z.string().min(1).max(100),
      z.string().min(1).max(100),
      z.string().min(1).max(100),
    ]),
    correct: z.number().int().min(0).max(3),
    source: z.url(),
  }),
);
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function importQuestions(s: Store, input: unknown) {
  const questions = questionsSchema.parse(input);
  let imported = 0;
  const facts = new Set(s.questions.map((q) => normalize(q.fact)));
  const texts = new Set(s.questions.map((q) => normalize(q.text)));
  for (const q of questions) {
    const fact = normalize(q.fact),
      text = normalize(q.text);
    if (facts.has(fact) || texts.has(text)) continue;
    if (new Set(q.choices.map(normalize)).size !== 4)
      throw new Error("Four distinct choices are required.");
    s.questions.push({ ...q, fact, id: hash(fact), used: false });
    facts.add(fact);
    texts.add(text);
    imported++;
  }
  return imported;
}

type Binding = {
  item: { value: string };
  itemLabel: { value: string };
  answer: { value: string };
  answerLabel: { value: string };
};
// One canonical entity/property key for each fact. The same fact is never
// reimported under new wording. Ambiguous, multi-answer items are excluded.
export function questionsFromFacts(
  rows: Binding[],
  property: string,
  prompt: (label: string) => string,
) {
  const groups = new Map<string, Binding[]>();
  for (const row of rows)
    groups.set(row.item.value, [...(groups.get(row.item.value) || []), row]);
  const labels = new Map<string, Set<string>>();
  for (const row of rows) {
    const label = normalize(row.itemLabel.value);
    if (!labels.has(label)) labels.set(label, new Set());
    labels.get(label)!.add(row.item.value);
  }
  const single = [...groups.values()]
    .filter((rows) => new Set(rows.map((r) => r.answer.value)).size === 1)
    .map((rows) => rows[0])
    .filter((r) => labels.get(normalize(r.itemLabel.value))!.size === 1)
    .filter(
      (r) =>
        r.itemLabel.value.length < 100 &&
        r.answerLabel.value.length < 80 &&
        !/^Q\d+$/.test(r.itemLabel.value) &&
        !/^Q\d+$/.test(r.answerLabel.value),
    );
  const answers = [...new Set(single.map((r) => r.answerLabel.value))];
  if (answers.length < 4) return [];
  return single
    .map((r) => {
      const alternatives = answers.filter(
        (a) => normalize(a) !== normalize(r.answerLabel.value),
      );
      const wrong: string[] = [];
      while (wrong.length < 3 && alternatives.length)
        wrong.push(alternatives.splice(randomInt(alternatives.length), 1)[0]);
      return {
        fact: `wikidata:${r.item.value.split("/").pop()}:${property}`,
        text: prompt(r.itemLabel.value),
        choices: [r.answerLabel.value, ...wrong],
        correct: 0,
        source: r.item.value.replace("http:", "https:"),
      };
    })
    .filter((q) => new Set(q.choices.map(normalize)).size === 4);
}

export async function fetchScienceQuestions() {
  const source = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON";
  const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("PubChem question source is unavailable.");
  const data = (await response.json()) as {
    Table: { Columns: { Column: string[] }; Row: { Cell: string[] }[] };
  };
  const columns = data.Table.Columns.Column;
  const elements = data.Table.Row.map((row) => ({
    name: row.Cell[columns.indexOf("Name")],
    number: row.Cell[columns.indexOf("AtomicNumber")],
  }));
  return elements.map((element) => {
    const pool = elements.filter((e) => e.number !== element.number),
      wrong: string[] = [];
    while (wrong.length < 3)
      wrong.push(pool.splice(randomInt(pool.length), 1)[0].name);
    return {
      fact: `pubchem:element:${element.number}:atomic-number`,
      text: `This element has atomic number ${element.number}. Which element is it?`,
      choices: [element.name, ...wrong],
      correct: 0,
      source,
    };
  });
}

export async function fetchQuestionBatch(
  category: "paintings" | "novels",
  offset = 0,
) {
  const property = category === "paintings" ? "P170" : "P50";
  const kind = category === "paintings" ? "Q3305213" : "Q8261";
  // Grouping happens before LIMIT so an item's second author cannot be cut off.
  const query = `SELECT ?item ?itemLabel ?answer ?answerLabel WHERE {
    { SELECT ?item (SAMPLE(?creator) AS ?answer) WHERE {
      ?item wdt:P31 wd:${kind}; wdt:${property} ?creator.
      ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>.
    } GROUP BY ?item HAVING(COUNT(DISTINCT ?creator) = 1) ORDER BY ?item LIMIT 300 OFFSET ${Math.max(0, Math.floor(offset))} }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  const result = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent":
        "RingTrivia/1.0 (question import; github.com/BlockConnoisseur/H)",
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!result.ok)
    throw new Error(
      `Question source unavailable (${result.status}); existing questions remain available.`,
    );
  const data = await result.json();
  return questionsFromFacts(data.results.bindings, property, (label) =>
    category === "paintings"
      ? `Which artist painted ${label}?`
      : `Who wrote the novel ${label}?`,
  );
}
