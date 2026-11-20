import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  KeywordContextResearcher,
  createOfflineDemoResearcher,
} from "../pipeline/context-research.js";
import { FixtureResearcher, normalizeClaim } from "../pipeline/stages.js";
import type { Claim, Topic } from "../pipeline/types.js";

function claim(text: string): Claim {
  return {
    id: "c1",
    text,
    normalized: normalizeClaim(text),
    startMs: 0,
    endMs: 1000,
    checkable: true,
    type: "statistic",
  };
}

function topic(title: string): Topic {
  return { id: "t1", title, tokens: [], claimIds: ["c1"] };
}

test("keyword context cites debt claims from FRED, never Tavily", async () => {
  const researcher = await KeywordContextResearcher.fromFile(
    resolve("samples/research-context.json"),
  );
  const facts = await researcher.research(
    claim("I don't have any experience in running up a $4 trillion debt."),
    topic("Trillion Debt"),
  );
  assert.ok(facts.length >= 1);
  assert.ok(facts.every((fact) => fact.sourceUrl?.startsWith("https://")));
  assert.equal(
    facts.some((fact) => fact.sourceUrl?.includes("tavily.com")),
    false,
  );
  assert.ok(facts.some((fact) => /fred\.stlouisfed\.org/i.test(fact.sourceUrl ?? "")));
});

test("keyword context falls back to the debate transcript", async () => {
  const researcher = await KeywordContextResearcher.fromFile(
    resolve("samples/research-context.json"),
  );
  const facts = await researcher.research(
    claim("I go into this race as their servant, and I belong to them."),
    topic("Race Servant"),
  );
  assert.ok(facts.length >= 1);
  assert.ok(
    facts.some((fact) =>
      (fact.sourceUrl ?? "").includes("debates.org"),
    ),
  );
});

test("offline demo researcher prefers the solar fixture over context packs", async () => {
  const fixture = await FixtureResearcher.fromFile(resolve("samples/research.json"));
  const researcher = await createOfflineDemoResearcher({
    fixture,
    contextPath: resolve("samples/research-context.json"),
  });
  const facts = await researcher.research(
    claim("Solar output supplied 40 percent of Spain's electricity at midday."),
    topic("Solar Output"),
  );
  assert.ok(facts.some((fact) => (fact.sourceUrl ?? "").includes("ree.es")));
});
