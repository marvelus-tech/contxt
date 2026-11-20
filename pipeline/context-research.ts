import { readFile } from "node:fs/promises";
import { isCitedFact, normalizeClaim } from "./stages.js";
import type { Claim, Fact, Researcher, Topic } from "./types.js";

export interface ContextPack {
  id: string;
  keywords: string[];
  facts: Fact[];
}

export interface ContextResearchSpec {
  packs: ContextPack[];
  fallback: Fact[];
}

function haystack(claim: Claim, topic?: Topic): string {
  const title = topic?.title ? ` ${normalizeClaim(topic.title)}` : "";
  return ` ${claim.normalized}${title} `;
}

function packMatches(hay: string, pack: ContextPack): boolean {
  const tokens = hay.trim().split(/\s+/);
  return pack.keywords.some((keyword) => {
    const needle = normalizeClaim(keyword);
    if (needle.length < 3) return false;
    if (needle.includes(" ")) return hay.includes(` ${needle} `);
    return tokens.some(
      (token) => token === needle || token.startsWith(needle),
    );
  });
}

function citedOnly(facts: Fact[]): Fact[] {
  return facts.filter(isCitedFact);
}

/**
 * Offline researcher for public demos. Matches claim text to curated
 * context packs. Never calls Tavily or any other network.
 */
export class KeywordContextResearcher implements Researcher {
  constructor(private readonly spec: ContextResearchSpec) {}

  static async fromFile(path: string): Promise<KeywordContextResearcher> {
    const spec = JSON.parse(await readFile(path, "utf8")) as ContextResearchSpec;
    return new KeywordContextResearcher({
      packs: spec.packs ?? [],
      fallback: spec.fallback ?? [],
    });
  }

  async research(claim: Claim, topic?: Topic): Promise<Fact[]> {
    const hay = haystack(claim, topic);
    const pack = this.spec.packs.find((candidate) => packMatches(hay, candidate));
    const facts = citedOnly(pack?.facts ?? this.spec.fallback);
    return facts.slice(0, 5);
  }
}

export async function createOfflineDemoResearcher(options: {
  fixture: Researcher;
  contextPath: string;
}): Promise<Researcher> {
  const context = await KeywordContextResearcher.fromFile(options.contextPath);
  return {
    async research(claim: Claim, topic: Topic) {
      const fromFixture = await options.fixture.research(claim, topic);
      const cited = citedOnly(fromFixture);
      if (cited.length > 0) return cited;
      return context.research(claim, topic);
    },
  };
}
