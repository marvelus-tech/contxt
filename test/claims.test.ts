import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runReplay } from "../harness/replay.js";
import { ClaimIndex, classifyClaim } from "../pipeline/claims.js";
import { assemblyAiToSegments, deepgramToSegments } from "../pipeline/cloud.js";
import { digitizeNumbers, hasNumber } from "../pipeline/numbers.js";
import { applySpeakerNames, nameSpeakers } from "../pipeline/speakers.js";
import type { TranscriptSegment } from "../pipeline/types.js";

test("spelled-out and written numbers normalise to the same digits", () => {
  assert.equal(digitizeNumbers("a four trillion dollar debt"), "a 4000000000000 dollar debt");
  assert.equal(digitizeNumbers("a $4 trillion debt"), "a 4000000000000 dollars debt");
  assert.equal(digitizeNumbers("a $4,000,000,000,000 debt"), "a 4000000000000 dollars debt");
  assert.equal(digitizeNumbers("five and a half million people"), "5500000 people");
  assert.equal(digitizeNumbers("Russia in nineteen sixty nine"), "Russia in 1969");
  assert.equal(digitizeNumbers("from first to thirteenth"), "from 1st to 13th");
  assert.equal(digitizeNumbers("the late seventies"), "the late 70s");
  assert.equal(digitizeNumbers("a hundred and fifty billion dollars"), "150000000000 dollars");
});

test("lone 'one' and 'first' are not figures", () => {
  assert.equal(hasNumber("That is one of the best things."), false);
  assert.equal(hasNumber("The first thing I would do."), false);
  assert.equal(hasNumber("We are down thirty five thousand jobs."), true);
});

test("classifier drops greetings, procedure, questions and filler", () => {
  assert.equal(classifyClaim("Good evening, Jim.").reason, "greeting");
  assert.equal(classifyClaim("Governor Clinton, a one minute response.").reason, "procedural");
  assert.equal(classifyClaim("President Bush, 1 minute to respond.").reason, "procedural");
  assert.equal(classifyClaim("The first question goes to Mr. Perot.").reason, "procedural");
  assert.equal(classifyClaim("So there will be no tax increases below 200,000?").reason, "question");
  assert.equal(classifyClaim("I'll talk about that a little bit later.").reason, "filler");
});

test("classifier tags claim types and only statistic and factual are checkable", () => {
  const cases: Array<[string, string, boolean]> = [
    ["I don't have any experience in running up a four trillion dollar debt.", "statistic", true],
    ["We're down 35,000 jobs in the private sector.", "statistic", true],
    ["Your father was right to stand up to Joe McCarthy.", "factual", true],
    ["I want to give people permanent incentives on investment.", "promise", false],
    ["Many people will trade for it.", "prediction", false],
    ["I think character is a very important question.", "opinion", false],
  ];
  for (const [text, type, checkable] of cases) {
    const verdict = classifyClaim(text);
    assert.equal(verdict.type, type, text);
    assert.equal(verdict.checkable, checkable, text);
  }
});

test("repeated claims merge across the recording and keep every occurrence", () => {
  const index = new ClaimIndex();
  index.add({ claimId: "c1", startMs: 1000, endMs: 2000, speaker: "Ross Perot", text: "We have a $4 trillion debt." });
  index.add({ claimId: "c2", startMs: 5000, endMs: 6000, speaker: "Bill Clinton", text: "Unemployment rose in 1991." });
  const repeat = index.add({
    claimId: "c3",
    startMs: 900000,
    endMs: 901000,
    speaker: "Ross Perot",
    text: "We have a four trillion dollar debt.",
  });
  assert.equal(repeat.isRepeat, true);
  assert.equal(index.merged.length, 2);
  assert.deepEqual(repeat.merged.occurrences.map((o) => o.startMs), [1000, 900000]);
  // Same figure alone is not enough.
  const different = index.add({ claimId: "c4", startMs: 1, endMs: 2, text: "For 4 years nothing happened in Washington at all." });
  assert.equal(different.isRepeat, false);
});

test("speaker naming uses introductions and address cues", () => {
  const segments: TranscriptSegment[] = [
    { startMs: 0, endMs: 1, speaker: "Speaker A", text: "Good evening. I am Jane Moderator of Channel Nine, and I will be the moderator tonight. The first question goes to Senator Smith. Senator Smith, what is your plan?" },
    { startMs: 1, endMs: 2, speaker: "Speaker B", text: "Thank you, Jane. My plan cuts the deficit in half by 1996." },
    { startMs: 2, endMs: 3, speaker: "Speaker A", text: "Governor Jones, one minute." },
    { startMs: 3, endMs: 4, speaker: "Speaker C", text: "Senator Smith has voted for 12 tax increases." },
    { startMs: 4, endMs: 5, speaker: "Speaker D", text: "Hmm." },
  ];
  const result = nameSpeakers(segments);
  const names = Object.fromEntries(result.speakers.map((s) => [s.label, s.name]));
  assert.equal(names["Speaker A"], "Jane Moderator");
  assert.equal(names["Speaker B"], "Smith");
  assert.equal(names["Speaker C"], "Jones");
  assert.equal(names["Speaker D"], "Speaker D");
  assert.equal(result.byLabel.get("Speaker A")?.role, "moderator");
  assert.equal(result.byLabel.get("Speaker D")?.named, false);
  const hinted = nameSpeakers(segments, { hints: ["Jane Moderator", "Pat Smith", "Lee Jones"] });
  assert.equal(hinted.byLabel.get("Speaker B")?.name, "Pat Smith");
  const applied = applySpeakerNames(segments, result);
  assert.equal(applied[0]?.speaker, "Jane Moderator");
  assert.equal(typeof applied[0]?.speakerConfidence, "number");
});

test("speaker naming on real AssemblyAI and Deepgram output, no names given", async () => {
  const expected = ["lehrer", "perot", "clinton", "bush", "compton"];
  for (const file of ["assemblyai_u3pro", "deepgram_nova3_keyterms_opus"]) {
    const raw = JSON.parse(await readFile(resolve(`bakeoff/raw/${file}.json`), "utf8"));
    const segments = raw.results ? deepgramToSegments(raw) : assemblyAiToSegments(raw);
    const result = nameSpeakers(segments);
    const surnames = result.speakers.filter((s) => s.named).map((s) => s.name.split(" ").at(-1)!.toLowerCase());
    assert.deepEqual([...surnames].sort(), [...expected].sort(), file);
  }
});

test("replay sends only checkable claims to pages and lists all claims with types", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contxt-claims-"));
  try {
    const fixture = join(directory, "talk.json");
    await writeFile(
      fixture,
      JSON.stringify({
        segments: [
          { startMs: 0, endMs: 1000, speaker: "Speaker A", text: "Good evening and welcome." },
          { startMs: 1000, endMs: 2000, speaker: "Speaker B", text: "Our debt reached four trillion dollars this year." },
          { startMs: 2000, endMs: 3000, speaker: "Speaker B", text: "I think that is a disgrace for this country." },
          { startMs: 3000, endMs: 4000, speaker: "Speaker C", text: "The debt reached $4 trillion this year, yes." },
        ],
      }),
    );
    const result = await runReplay({
      inputPath: fixture,
      researchFixture: resolve("samples/research.json"),
      speed: 100_000,
      outRoot: directory,
      runId: "claims",
    });
    const claims = JSON.parse(await readFile(result.claimsPath, "utf8")) as Array<{
      type: string;
      checkable: boolean;
      occurrences: unknown[];
    }>;
    assert.deepEqual(claims.map((c) => [c.type, c.checkable, c.occurrences.length]), [
      ["statistic", true, 2],
      ["opinion", false, 1],
    ]);
    assert.equal(result.pages.length, 1);
    assert.equal(result.scorecard.claimStats?.dropped?.greeting, 1);
    assert.equal(result.scorecard.claimStats?.checkableUnique, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
