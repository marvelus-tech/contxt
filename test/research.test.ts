import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  WebResearcher,
  TavilySearchProvider,
  buildResearchQuery,
  hitsToFacts,
  type SearchHit,
} from "../pipeline/research.js";
import { createResearcher } from "../pipeline/researchers.js";
import { normalizeClaim } from "../pipeline/stages.js";
import type { Claim, Topic } from "../pipeline/types.js";

const solarClaim: Claim = {
  id: "claim-1",
  text: "Solar output supplied 40 percent of Spain's electricity at midday.",
  normalized: normalizeClaim(
    "Solar output supplied 40 percent of Spain's electricity at midday.",
  ),
  startMs: 200,
  endMs: 1200,
  checkable: true,
  type: "statistic",
};
const solarTopic: Topic = {
  id: "topic-1",
  title: "Solar Output",
  tokens: ["solar", "output"],
  claimIds: ["claim-1"],
};

test("buildResearchQuery keeps claim text and adds topic title when useful", () => {
  const query = buildResearchQuery(solarClaim, solarTopic);
  assert.match(query, /Solar output/);
  const harborTopic: Topic = {
    id: "topic-2",
    title: "Harbor Bond",
    tokens: ["harbor", "bond"],
    claimIds: [],
  };
  const harborClaim: Claim = {
    ...solarClaim,
    text: "The city council approved the harbor resilience bond.",
    normalized: normalizeClaim(
      "The city council approved the harbor resilience bond.",
    ),
  };
  assert.match(buildResearchQuery(harborClaim, harborTopic), /Harbor Bond/);
});

test("hitsToFacts deduplicates URLs and caps count", () => {
  const hits: SearchHit[] = [
    { url: "https://example.com/a", content: "First", title: "A" },
    { url: "https://example.com/a", content: "Duplicate" },
    { url: "https://example.com/b", content: "Second" },
    { url: "https://example.com/c", content: "Third" },
  ];
  const facts = hitsToFacts(hits, 2);
  assert.equal(facts.length, 2);
  assert.equal(facts[0]?.sourceUrl, "https://example.com/a");
  assert.equal(facts[1]?.sourceUrl, "https://example.com/b");
});

test("TavilySearchProvider maps JSON results", async () => {
  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "Solar in Spain",
            url: "https://www.ree.es/en",
            content: "Generation records are published daily.",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  const provider = new TavilySearchProvider("test-key", mockFetch as typeof fetch);
  const hits = await provider.search("solar spain", 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.url, "https://www.ree.es/en");
});

test("WebResearcher caches by normalized claim key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "contxt-research-"));
  const cachePath = join(dir, "research-cache.json");
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        results: [
          {
            url: "https://example.com/source",
            content: "Cached fact body.",
          },
        ],
      }),
      { status: 200 },
    );
  };
  const stats = { requests: 0, cacheHits: 0 };
  const researcher = new WebResearcher({
    provider: new TavilySearchProvider("key", mockFetch as typeof fetch),
    cachePath,
    maxFacts: 3,
    stats,
  });
  const first = await researcher.research(solarClaim, solarTopic);
  const second = await researcher.research(solarClaim, solarTopic);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(calls, 1);
  assert.equal(stats.requests, 1);
  assert.equal(stats.cacheHits, 1);
  const disk = JSON.parse(await readFile(cachePath, "utf8")) as Record<string, unknown>;
  assert.ok(disk[solarClaim.normalized]);
  await rm(dir, { recursive: true, force: true });
});

test("createResearcher web mode skips when API key missing", async () => {
  const previous = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    const handle = await createResearcher({
      mode: "web",
      fixturePath: "samples/research.json",
    });
    const status = await handle.status();
    assert.equal(status.status, "skipped");
    assert.match(status.reason ?? "", /TAVILY_API_KEY/);
  } finally {
    if (previous) process.env.TAVILY_API_KEY = previous;
  }
});