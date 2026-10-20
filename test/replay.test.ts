import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runReplay } from "../harness/replay.js";
import {
  HeuristicClaimExtractor,
  HtmlPageBuilder,
  normalizeClaim,
} from "../pipeline/stages.js";
import type { Claim, Topic } from "../pipeline/types.js";

const solarClaim: Claim = {
  id: "claim-1",
  text: "Solar output supplied 40 percent of Spain's electricity at midday.",
  normalized: normalizeClaim(
    "Solar output supplied 40 percent of Spain's electricity at midday.",
  ),
  startMs: 200,
  endMs: 1200,
};
const solarTopic: Topic = {
  id: "topic-1",
  title: "Solar Output",
  tokens: ["solar", "output"],
  claimIds: ["claim-1"],
};

test("claim extraction normalizes repeated claims for dedupe", async () => {
  const extractor = new HeuristicClaimExtractor();
  const first = await extractor.extract(
    [{ startMs: 0, endMs: 1000, text: solarClaim.text }],
    { mediaTimeMs: 1000 },
  );
  const repeat = await extractor.extract(
    [{ startMs: 1500, endMs: 2500, text: solarClaim.text.toUpperCase() }],
    { mediaTimeMs: 2500 },
  );

  assert.equal(first.length, 1);
  assert.equal(repeat.length, 1);
  assert.equal(first[0]?.normalized, repeat[0]?.normalized);
});

test("claim extraction preserves decimals and abbreviations", async () => {
  const extractor = new HeuristicClaimExtractor();
  const claims = await extractor.extract(
    [
      {
        startMs: 0,
        endMs: 1000,
        text: "The U.S. inflation rate was 3.2 percent last year.",
      },
    ],
    { mediaTimeMs: 1000 },
  );

  assert.equal(claims.length, 1);
  assert.equal(
    claims[0]?.text,
    "The U.S. inflation rate was 3.2 percent last year.",
  );
});

test("page builder drops facts without valid source URLs", async () => {
  const builder = new HtmlPageBuilder();
  const result = await builder.build({
    claim: solarClaim,
    topic: solarTopic,
    facts: [
      { text: "Kept", sourceUrl: "https://example.com/source" },
      { text: "Dropped" },
      { text: "Also dropped", sourceUrl: "javascript:alert(1)" },
    ],
  });

  assert.equal(result.offeredFacts, 3);
  assert.equal(result.citedFacts, 1);
  assert.deepEqual(result.page.facts, [
    { text: "Kept", sourceUrl: "https://example.com/source" },
  ]);
});

test("page builder updates a topic page instead of duplicating it", async () => {
  const builder = new HtmlPageBuilder();
  const created = await builder.build({
    claim: solarClaim,
    topic: solarTopic,
    facts: [{ text: "First fact", sourceUrl: "https://example.com/first" }],
  });
  const updated = await builder.build({
    claim: { ...solarClaim, id: "claim-2", startMs: 5000, endMs: 6000 },
    topic: { ...solarTopic, claimIds: ["claim-1", "claim-2"] },
    facts: [],
    existingPage: created.page,
  });

  assert.equal(updated.page.id, created.page.id);
  assert.equal(updated.page.claimIds.length, 2);
});

test("fixture replay writes a cited three-topic deck and scorecard", async () => {
  const outRoot = await mkdtemp(join(tmpdir(), "contxt-test-"));
  try {
    const result = await runReplay({
      inputPath: resolve("samples/demo.json"),
      researchFixture: resolve("samples/research.json"),
      speed: 1000,
      outRoot,
      runId: "fixture-test",
    });

    assert.equal(result.scorecard.pagesCreated, 3);
    assert.equal(result.scorecard.pagesUpdated, 1);
    assert.equal(result.scorecard.duplicatesMerged, 1);
    assert.equal(result.scorecard.factsOffered, 10);
    assert.equal(result.scorecard.factsCited, 9);
    assert.equal(result.scorecard.percentFactsCited, 90);
    assert.equal(result.pages.length, 3);

    const deck = await readFile(result.deckPath, "utf8");
    assert.match(deck, /Chronological timeline/);
    assert.doesNotMatch(deck, /uncited note/);
    assert.equal(await readFile(result.timelinePath, "utf8").then(JSON.parse) instanceof Array, true);
    assert.equal(
      await readFile(result.scorecardPath, "utf8").then(JSON.parse).then(
        (scorecard: { transcriber: string }) => scorecard.transcriber,
      ),
      "fixture",
    );
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
});
