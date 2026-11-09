// Milestone 2 evaluation: speaker naming accuracy and claim metrics on real
// provider output with generic labels (no reference names given).
//
//   npm run build && node bakeoff/eval_claims.mjs [--hints]
//
// Writes out/eval/<run>.fixture.json (generic labels), runs the harness on each,
// and writes bakeoff/eval_claims.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runReplay } from "../dist/harness/replay.js";
import { assemblyAiToSegments, deepgramToSegments } from "../dist/pipeline/cloud.js";
import { nameSpeakers } from "../dist/pipeline/speakers.js";
import { claimSimilarity, matchTokens } from "../dist/pipeline/claims.js";
import { extractFigures } from "../dist/pipeline/numbers.js";

const HINTS = ["Jim Lehrer", "Ross Perot", "Bill Clinton", "George H. W. Bush", "Ann Compton"];
const RUNS = [
  ["Deepgram nova-3", "deepgram_nova3"],
  ["AssemblyAI universal-3-pro", "assemblyai_u3pro"],
  ["AssemblyAI universal-3-5-pro", "assemblyai_u35pro"],
  ["AssemblyAI universal-3-5-pro (opus)", "assemblyai_u35pro_opus"],
  ["Deepgram nova-3 + keyterms (opus)", "deepgram_nova3_keyterms_opus"],
];

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
const surname = (name) => name.replace(/\(.*?\)/g, "").trim().split(/\s+/).at(-1).toLowerCase();

const scores = JSON.parse(await readFile("bakeoff/scores.json", "utf8"));
const refMapping = Object.fromEntries(scores.results.map((r) => [r.provider, r.mapping]));
await mkdir("out/eval", { recursive: true });
const report = [];
for (const [provider, file] of RUNS) {
  const raw = JSON.parse(await readFile(`bakeoff/raw/${file}.json`, "utf8"));
  const isDeepgram = Boolean(raw.results);
  const segments = isDeepgram ? deepgramToSegments(raw) : assemblyAiToSegments(raw);
  const toRefLabel = (label) => (isDeepgram ? label.replace("Speaker ", "S") : label.replace("Speaker ", ""));
  const words = new Map();
  for (const s of segments) words.set(s.speaker, (words.get(s.speaker) ?? 0) + s.text.split(/\s+/).length);
  const totalWords = [...words.values()].reduce((a, b) => a + b, 0);

  const naming = {};
  for (const mode of ["no hints", "with hints"]) {
    const result = nameSpeakers(segments, { hints: mode === "with hints" ? HINTS : [] });
    let exact = 0, lenient = 0, wordsRight = 0;
    const rows = result.speakers.map((s) => {
      const truth = refMapping[provider]?.[toRefLabel(s.label)]?.toLowerCase();
      const got = s.named ? surname(s.name) : null;
      const isExact = got === truth;
      // "Right person": the label went to the right speaker, allowing ASR misspellings such as "Lara" for Lehrer.
      const isLenient = isExact || (got && truth && levenshtein(got, truth) <= Math.ceil(truth.length * 0.67));
      if (isExact) exact += 1;
      if (isLenient) { lenient += 1; wordsRight += words.get(s.label) ?? 0; }
      return { label: s.label, name: s.name, confidence: s.confidence, named: s.named, truth, correct: isExact, rightPerson: Boolean(isLenient) };
    });
    naming[mode] = {
      labels: rows.length,
      exactCorrect: exact,
      rightPerson: lenient,
      wordWeightedAccuracy: Number((wordsRight / totalWords).toFixed(4)),
      speakers: rows,
    };
  }

  const fixturePath = `out/eval/${file}.fixture.json`;
  await writeFile(fixturePath, JSON.stringify({ segments }, null, 1));
  const replay = await runReplay({ inputPath: fixturePath, speed: 1e6, outRoot: "out/eval", runId: file, researchFixture: "samples/research.json" });
  const claims = JSON.parse(await readFile(replay.claimsPath, "utf8"));
  report.push({ provider, file, naming, claimStats: replay.scorecard.claimStats, claimsBySpeaker: replay.scorecard.claimsBySpeaker, sampleClaims: claims.slice(0, 5) });
  const n = naming["no hints"], h = naming["with hints"], c = replay.scorecard.claimStats;
  console.log(`${provider}: naming (no hints) ${n.exactCorrect}/${n.labels} exact, ${n.rightPerson}/${n.labels} right person, ${(n.wordWeightedAccuracy * 100).toFixed(1)}% of words; with hints ${h.exactCorrect}/${h.labels}`);
  console.log(`  ${n.speakers.map((s) => `${s.label}=${s.name}(${s.confidence})${s.correct ? "" : s.rightPerson ? "~" : "x"}`).join(", ")}`);
  console.log(`  claims: sentences ${c.sentences}, dropped ${JSON.stringify(c.dropped)}, extracted ${c.claimsExtracted}, unique ${c.uniqueClaims}, repeats merged ${c.repeatsMerged}, checkable ${c.checkableUnique}, types ${JSON.stringify(c.uniqueByType)}`);
}
await writeFile("bakeoff/eval_claims.json", `${JSON.stringify(report, null, 1)}\n`);

// Cross-provider agreement: how many checkable claims from one run have a
// matching checkable claim in the other (same claim, said the same way).
const load = async (file) =>
  JSON.parse(await readFile(`out/eval/${file}/claims.json`, "utf8"))
    .filter((c) => c.checkable)
    .map((c) => ({ ...c, tokens: matchTokens(c.text), figures: extractFigures(c.text).filter((f) => f !== "1") }));
const pairsToCompare = [["deepgram_nova3", "assemblyai_u35pro"], ["deepgram_nova3_keyterms_opus", "assemblyai_u35pro_opus"]];
const agreement = [];
for (const [a, b] of pairsToCompare) {
  const [left, right] = [await load(a), await load(b)];
  const matched = (xs, ys) => xs.filter((x) => ys.some((y) => claimSimilarity(x, y) >= 0.5)).length;
  const row = { a, b, aCheckable: left.length, bCheckable: right.length, aFoundInB: matched(left, right), bFoundInA: matched(right, left) };
  agreement.push(row);
  console.log(`agreement ${a} vs ${b}: ${row.aFoundInB}/${row.aCheckable} of A in B, ${row.bFoundInA}/${row.bCheckable} of B in A`);
}
const saved = JSON.parse(await readFile("bakeoff/eval_claims.json", "utf8"));
await writeFile("bakeoff/eval_claims.json", `${JSON.stringify({ runs: saved, agreement }, null, 1)}\n`);
