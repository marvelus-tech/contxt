import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runReplay } from "../harness/replay.js";
import {
  CloudTranscriber,
  assemblyAiToSegments,
  deepgramToSegments,
  deepgramUrl,
  wordsToSegments,
} from "../pipeline/cloud.js";
import { HeuristicClaimExtractor } from "../pipeline/stages.js";

test("claims keep the speaker of their segment", async () => {
  const extractor = new HeuristicClaimExtractor();
  const claims = await extractor.extract(
    [
      { startMs: 0, endMs: 900, speaker: "Ross Perot", text: "The debt is 4 trillion" },
      { startMs: 900, endMs: 1500, speaker: "Ross Perot", text: "dollars today." },
      { startMs: 1600, endMs: 2500, speaker: "Bill Clinton", text: "My state is first in job growth." },
    ],
    { mediaTimeMs: 2500 },
  );
  assert.deepEqual(
    claims.map((claim) => [claim.speaker, claim.text, claim.startMs]),
    [
      ["Ross Perot", "The debt is 4 trillion dollars today.", 0],
      ["Bill Clinton", "My state is first in job growth.", 1600],
    ],
  );
});

test("unfinished text is closed out when the speaker changes", async () => {
  const extractor = new HeuristicClaimExtractor();
  const claims = await extractor.extract(
    [
      { startMs: 0, endMs: 900, speaker: "A", text: "Unemployment was 7 percent and" },
      { startMs: 1000, endMs: 2000, speaker: "B", text: "Inflation was 3 percent." },
    ],
    { mediaTimeMs: 2000 },
  );
  assert.deepEqual(
    claims.map((claim) => claim.speaker),
    ["A", "B"],
  );
});

test("words become one-speaker sentence segments", () => {
  const segments = wordsToSegments([
    { text: "We", startMs: 0, endMs: 100, speaker: "A" },
    { text: "owe", startMs: 100, endMs: 200, speaker: "A" },
    { text: "four", startMs: 200, endMs: 300, speaker: "A" },
    { text: "trillion.", startMs: 300, endMs: 400, speaker: "A" },
    { text: "Not", startMs: 500, endMs: 600, speaker: "B" },
    { text: "so.", startMs: 600, endMs: 700, speaker: "B" },
  ]);
  assert.deepEqual(segments, [
    { startMs: 0, endMs: 400, text: "We owe four trillion.", speaker: "A" },
    { startMs: 500, endMs: 700, text: "Not so.", speaker: "B" },
  ]);
});

test("provider responses map to the harness segment format", () => {
  const aai = assemblyAiToSegments({
    words: [
      { text: "Good", start: 640, end: 900, speaker: "A" },
      { text: "evening.", start: 900, end: 1200, speaker: "A" },
    ],
  });
  assert.deepEqual(aai, [
    { startMs: 640, endMs: 1200, text: "Good evening.", speaker: "Speaker A" },
  ]);
  const dg = deepgramToSegments({
    results: {
      channels: [
        {
          alternatives: [
            {
              words: [
                { word: "good", punctuated_word: "Good", start: 0.64, end: 0.9, speaker: 0 },
                { word: "evening", punctuated_word: "evening.", start: 0.9, end: 1.2, speaker: 0 },
              ],
            },
          ],
        },
      ],
    },
  });
  assert.deepEqual(dg, [
    { startMs: 640, endMs: 1200, text: "Good evening.", speaker: "Speaker 0" },
  ]);
});

test("deepgram request turns on diarization and passes keyterms", () => {
  const url = new URL(deepgramUrl("nova-3", ["Perot", "Lehrer"]));
  assert.equal(url.searchParams.get("model"), "nova-3");
  assert.equal(url.searchParams.get("diarize"), "true");
  assert.equal(url.searchParams.get("smart_format"), "true");
  assert.equal(url.searchParams.get("utterances"), "true");
  assert.deepEqual(url.searchParams.getAll("keyterm"), ["Perot", "Lehrer"]);
});

test("cloud transcriber skips without a key", async () => {
  const saved = process.env.ASSEMBLYAI_API_KEY;
  delete process.env.ASSEMBLYAI_API_KEY;
  try {
    const status = await new CloudTranscriber("assemblyai").status();
    assert.equal(status.status, "skipped");
  } finally {
    if (saved !== undefined) process.env.ASSEMBLYAI_API_KEY = saved;
  }
});

test("assemblyai adapter uploads once, requests speaker labels, and serves chunks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contxt-cloud-"));
  const audio = join(directory, "a.wav");
  await writeFile(audio, Buffer.from("RIFF"));
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      url: href,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), { status: 200 });
    if (href.endsWith("/v2/upload")) return json({ upload_url: "https://cdn.example/a" });
    if (href.endsWith("/v2/transcript")) return json({ id: "t1" });
    return json({
      status: "completed",
      audio_duration: 3,
      speech_model_used: "universal-3-5-pro",
      words: [
        { text: "First", start: 100, end: 200, speaker: "A" },
        { text: "claim", start: 200, end: 300, speaker: "A" },
        { text: "is", start: 300, end: 400, speaker: "A" },
        { text: "here.", start: 400, end: 500, speaker: "A" },
        { text: "Second", start: 2000, end: 2100, speaker: "B" },
        { text: "claim", start: 2100, end: 2200, speaker: "B" },
        { text: "is", start: 2200, end: 2300, speaker: "B" },
        { text: "here.", start: 2300, end: 2400, speaker: "B" },
      ],
    });
  }) as typeof fetch;
  try {
    const transcriber = new CloudTranscriber("assemblyai", {
      apiKey: "test-key",
      fetchImpl: fakeFetch,
      pollIntervalMs: 1,
    });
    assert.equal((await transcriber.status()).status, "ok");
    const first = await transcriber.transcribe({ index: 0, startMs: 0, endMs: 1500, sourcePath: audio });
    const second = await transcriber.transcribe({ index: 1, startMs: 1500, endMs: 3000, sourcePath: audio });
    assert.deepEqual(first.map((s) => s.speaker), ["Speaker A"]);
    assert.deepEqual(second.map((s) => s.speaker), ["Speaker B"]);
    assert.equal(calls.filter((call) => call.url.endsWith("/v2/upload")).length, 1);
    const submit = calls.find((call) => call.url.endsWith("/v2/transcript"))?.body as {
      speaker_labels: boolean;
      speech_models: string[];
    };
    assert.equal(submit.speaker_labels, true);
    assert.deepEqual(submit.speech_models, ["universal-3-5-pro"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("debate fixture replay attributes claims to named speakers", async () => {
  const outRoot = await mkdtemp(join(tmpdir(), "contxt-debate-"));
  try {
    const result = await runReplay({
      inputPath: resolve("samples/debate1992.json"),
      researchFixture: resolve("samples/research.json"),
      speed: 100_000,
      outRoot,
      runId: "debate-test",
    });
    const claims = JSON.parse(await readFile(result.claimsPath, "utf8")) as Array<{
      speaker: string | null;
      text: string;
    }>;
    assert.ok(claims.length > 50);
    assert.ok(claims.every((claim) => claim.speaker));
    const speakers = new Set(claims.map((claim) => claim.speaker));
    for (const name of ["Ross Perot", "Bill Clinton", "George H. W. Bush"]) {
      assert.ok(speakers.has(name), `missing claims from ${name}`);
    }
    const trillion = claims.find((claim) => /\$4 trillion debt/.test(claim.text));
    assert.equal(trillion?.speaker, "Ross Perot");
    const deck = await readFile(result.deckPath, "utf8");
    assert.match(deck, /Said by Ross Perot/);
    assert.ok(result.scorecard.claimsBySpeaker?.["Ross Perot"]);
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
});
