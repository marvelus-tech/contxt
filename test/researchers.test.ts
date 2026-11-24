import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CompositeResearcher,
  GoogleFactCheckResearcher,
  TavilyResearcher,
  buildCompositeResearchQuery,
  createResearcher,
} from "../pipeline/researchers.js";
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
  speaker: "Analyst",
};

const opinionClaim: Claim = {
  ...solarClaim,
  id: "claim-2",
  text: "That plan sounds risky to me.",
  normalized: normalizeClaim("That plan sounds risky to me."),
  checkable: false,
  type: "opinion",
};

const solarTopic: Topic = {
  id: "topic-1",
  title: "Solar Output",
  tokens: ["solar", "output"],
  claimIds: ["claim-1"],
};

function googleResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function tavilyResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("non-checkable claims are skipped without fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return tavilyResponse({ results: [] });
  };
  const stats = {
    requests: 0,
    cacheHits: 0,
    claimsResearched: 0,
    claimsSkippedNonCheckable: 0,
  };
  const composite = new CompositeResearcher({
    tavily: new TavilyResearcher("t-key", fetchImpl as typeof fetch),
    factCheck: new GoogleFactCheckResearcher("g-key", fetchImpl as typeof fetch),
    stats,
  });
  const facts = await composite.research(opinionClaim, solarTopic);
  assert.deepEqual(facts, []);
  assert.equal(calls, 0);
  assert.equal(stats.claimsSkippedNonCheckable, 1);
});

test("Google Fact Check parsing maps rating, publisher, and URL", async () => {
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.match(url, /factchecktools\.googleapis\.com/);
    return googleResponse({
      claims: [
        {
          text: "Spain got 40% of power from solar at noon.",
          claimReview: [
            {
              publisher: { name: "Reuters Fact Check" },
              url: "https://www.reuters.com/fact-check/solar-spain",
              title: "Solar share in Spain",
              textualRating: "Partly false",
            },
          ],
        },
      ],
    });
  };
  const researcher = new GoogleFactCheckResearcher("g-key", fetchImpl as typeof fetch);
  const facts = await researcher.search(
    buildCompositeResearchQuery(solarClaim, solarTopic),
  );
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.provider, "google-fact-check");
  assert.equal(facts[0]?.publisher, "Reuters Fact Check");
  assert.equal(facts[0]?.rating, "Partly false");
  assert.equal(facts[0]?.sourceUrl, "https://www.reuters.com/fact-check/solar-spain");
  assert.match(facts[0]?.text ?? "", /Spain got 40%/);
});

test("Tavily parsing maps title, snippet, and URL", async () => {
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>)?.Authorization, "Bearer t-key");
    return tavilyResponse({
      results: [
        {
          title: "Solar in Spain",
          url: "https://www.ree.es/en",
          content: "Spain publishes generation statistics daily.",
          published_date: "2024-06-01",
        },
      ],
    });
  };
  const researcher = new TavilyResearcher("t-key", fetchImpl as typeof fetch);
  const facts = await researcher.search(buildCompositeResearchQuery(solarClaim, solarTopic));
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.provider, "tavily");
  assert.equal(facts[0]?.sourceTitle, "Solar in Spain");
  assert.equal(facts[0]?.sourceUrl, "https://www.ree.es/en");
  assert.match(facts[0]?.text ?? "", /generation statistics/);
  assert.equal(facts[0]?.publishedDate, "2024-06-01");
});

test("CompositeResearcher merges providers, dedupes URLs, and drops unsourced facts", async () => {
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("tavily.com")) {
      return tavilyResponse({
        results: [
          {
            url: "https://example.com/shared",
            content: "Shared source body.",
          },
          {
            url: "ftp://bad.example/file",
            content: "Should drop",
          },
        ],
      });
    }
    return googleResponse({
      claims: [
        {
          text: "Shared claim",
          claimReview: [
            {
              publisher: { name: "FactLab" },
              url: "https://example.com/shared/",
              textualRating: "True",
            },
          ],
        },
      ],
    });
  };
  const composite = new CompositeResearcher({
    tavily: new TavilyResearcher("t-key", fetchImpl as typeof fetch),
    factCheck: new GoogleFactCheckResearcher("g-key", fetchImpl as typeof fetch),
  });
  const facts = await composite.research(solarClaim, solarTopic);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.sourceUrl, "https://example.com/shared");
});

test("CompositeResearcher continues when one provider errors", async () => {
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("tavily.com")) throw new Error("tavily down");
    return googleResponse({
      claims: [
        {
          text: "Fallback fact",
          claimReview: [
            {
              publisher: { name: "Checker" },
              url: "https://example.com/only-google",
              textualRating: "Mixed",
            },
          ],
        },
      ],
    });
  };
  const composite = new CompositeResearcher({
    tavily: new TavilyResearcher("t-key", fetchImpl as typeof fetch),
    factCheck: new GoogleFactCheckResearcher("g-key", fetchImpl as typeof fetch),
  });
  const facts = await composite.research(solarClaim, solarTopic);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.sourceUrl, "https://example.com/only-google");
});

test("CompositeResearcher with missing provider key skips that provider", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return tavilyResponse({
      results: [{ url: "https://example.com/tavily-only", content: "From Tavily." }],
    });
  };
  const composite = new CompositeResearcher({
    tavily: new TavilyResearcher("t-key", fetchImpl as typeof fetch),
  });
  const facts = await composite.research(solarClaim, solarTopic);
  assert.equal(facts.length, 1);
  assert.equal(calls, 1);
});

test("disk cache hit on repeat run avoids second fetch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "contxt-researchers-"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return tavilyResponse({
      results: [{ url: "https://example.com/cached", content: "Cached fact." }],
    });
  };
  const stats = {
    requests: 0,
    cacheHits: 0,
    claimsResearched: 0,
    claimsSkippedNonCheckable: 0,
  };
  const composite = new CompositeResearcher({
    tavily: new TavilyResearcher("t-key", fetchImpl as typeof fetch),
    cachePath: join(dir, "research-cache.json"),
    stats,
  });
  const first = await composite.research(solarClaim, solarTopic);
  const second = await composite.research(solarClaim, solarTopic);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(calls, 1);
  assert.equal(stats.cacheHits, 1);
  const disk = JSON.parse(await readFile(join(dir, "research-cache.json"), "utf8")) as Record<
    string,
    unknown
  >;
  assert.ok(disk[solarClaim.normalized]);
  await rm(dir, { recursive: true, force: true });
});

test("createResearcher tavily mode reports skipped when key missing", async () => {
  const previous = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    const handle = await createResearcher({
      mode: "tavily",
      fixturePath: "samples/research.json",
    });
    const status = await handle.status();
    assert.equal(status.status, "skipped");
    assert.match(status.reason ?? "", /TAVILY_API_KEY/);
  } finally {
    if (previous) process.env.TAVILY_API_KEY = previous;
  }
});