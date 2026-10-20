import { readFile } from "node:fs/promises";
import type {
  BuildPageInput,
  BuildPageResult,
  Claim,
  ClaimExtractor,
  Fact,
  Page,
  PageBuilder,
  Researcher,
  StageContext,
  TimelineEvent,
  Topic,
  TopicGrouper,
  TranscriptSegment,
} from "./types.js";

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "in",
  "is",
  "of",
  "on",
  "the",
  "to",
  "was",
  "were",
]);

export function normalizeClaim(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(text: string): string[] {
  return normalizeClaim(text)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

export class HeuristicClaimExtractor implements ClaimExtractor {
  private carry = "";
  private nextId = 1;
  private readonly sentenceSegmenter = new Intl.Segmenter("en", {
    granularity: "sentence",
  });

  async extract(
    segments: TranscriptSegment[],
    _context: StageContext,
  ): Promise<Claim[]> {
    const claims: Claim[] = [];
    for (const segment of segments) {
      const combined = `${this.carry} ${segment.text}`.trim();
      const sentences = [...this.sentenceSegmenter.segment(combined)];
      const complete = sentences
        .map(({ segment: sentence }) => sentence.trim())
        .filter((sentence) => /[.!?]["')\]]?$/.test(sentence));
      this.carry =
        sentences
          .map(({ segment: sentence }) => sentence.trim())
          .filter((sentence) => !/[.!?]["')\]]?$/.test(sentence))
          .at(-1) ?? "";

      for (const sentence of complete) {
        const claim = this.toClaim(sentence.trim(), segment);
        if (claim) claims.push(claim);
      }
    }
    return claims;
  }

  async flush(context: StageContext): Promise<Claim[]> {
    if (!this.carry) return [];
    const text = this.carry;
    this.carry = "";
    const claim = this.toClaim(text, {
      startMs: context.mediaTimeMs,
      endMs: context.mediaTimeMs,
      text,
    });
    return claim ? [claim] : [];
  }

  private toClaim(text: string, segment: TranscriptSegment): Claim | undefined {
    const words = text.match(/\b[\p{L}\p{N}]+\b/gu) ?? [];
    const cue = /\b(is|are|was|were|hit|approved|planned|announced|costs?)\b/i;
    if (words.length < 4 || (!/\d/.test(text) && !cue.test(text))) {
      return undefined;
    }
    return {
      id: `claim-${this.nextId++}`,
      text,
      normalized: normalizeClaim(text),
      startMs: segment.startMs,
      endMs: segment.endMs,
    };
  }
}

export class HeuristicTopicGrouper implements TopicGrouper {
  async group(claim: Claim, topics: Topic[]): Promise<Topic> {
    const tokens = [...new Set(contentTokens(claim.text))];
    let best: { topic: Topic; score: number } | undefined;

    for (const topic of topics) {
      const union = new Set([...tokens, ...topic.tokens]);
      const overlap = tokens.filter((token) => topic.tokens.includes(token));
      const score = union.size ? overlap.length / union.size : 0;
      if (!best || score > best.score) best = { topic, score };
    }

    if (best && best.score >= 0.34) {
      best.topic.claimIds.push(claim.id);
      best.topic.tokens = [...new Set([...best.topic.tokens, ...tokens])];
      return best.topic;
    }

    const topic: Topic = {
      id: `topic-${topics.length + 1}`,
      title: tokens
        .slice(0, 3)
        .map((token) => token[0]?.toUpperCase() + token.slice(1))
        .join(" "),
      tokens,
      claimIds: [claim.id],
    };
    topics.push(topic);
    return topic;
  }
}

export class FixtureResearcher implements Researcher {
  private constructor(private readonly facts: Record<string, Fact[]>) {}

  static async fromFile(path: string): Promise<FixtureResearcher> {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      facts: Record<string, Fact[]>;
    };
    return new FixtureResearcher(parsed.facts ?? {});
  }

  async research(claim: Claim): Promise<Fact[]> {
    return this.facts[claim.normalized] ?? [];
  }
}

export function isCitedFact(
  fact: Fact,
): fact is Fact & { sourceUrl: string } {
  if (!fact.sourceUrl) return false;
  try {
    const url = new URL(fact.sourceUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export class HtmlPageBuilder implements PageBuilder {
  async build(input: BuildPageInput): Promise<BuildPageResult> {
    const facts = input.facts.filter(isCitedFact);
    const page: Page = input.existingPage
      ? {
          ...input.existingPage,
          currentClaim: input.claim.text,
          claimIds: [...input.existingPage.claimIds, input.claim.id],
          facts: [...input.existingPage.facts, ...facts].filter(
            (fact, index, all) =>
              all.findIndex(
                (candidate) =>
                  candidate.text === fact.text &&
                  candidate.sourceUrl === fact.sourceUrl,
              ) === index,
          ),
          updatedAtMs: input.claim.endMs,
        }
      : {
          id: `page-${input.topic.id}`,
          topicId: input.topic.id,
          title: input.topic.title,
          currentClaim: input.claim.text,
          claimIds: [input.claim.id],
          facts,
          createdAtMs: input.claim.endMs,
          updatedAtMs: input.claim.endMs,
        };
    return {
      page,
      offeredFacts: input.facts.length,
      citedFacts: facts.length,
    };
  }

  render(pages: Page[], timeline: TimelineEvent[]): string {
    const sections = pages
      .map(
        (page, index) => `<section id="${escapeHtml(page.id)}" class="page">
  <p class="eyebrow">Topic ${index + 1} of ${pages.length}</p>
  <h1>${escapeHtml(page.title)}</h1>
  <p class="claim">${escapeHtml(page.currentClaim)}</p>
  <h2>Cited facts</h2>
  <ul>${page.facts
    .slice(0, 5)
    .map(
      (fact) =>
        `<li>${escapeHtml(fact.text)} <a href="${escapeHtml(fact.sourceUrl)}">Source</a></li>`,
    )
    .join("")}</ul>
  <h2>Why it matters</h2>
  <p>This topic was selected because it contains a concrete claim worth checking.</p>
</section>`,
      )
      .join("\n");
    const markers = timeline
      .filter((event) => event.type.startsWith("page-"))
      .map(
        (event) =>
          `<li><time>${(event.mediaMs / 1000).toFixed(1)}s</time> ${escapeHtml(event.detail)}</li>`,
      )
      .join("");

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>CONTXT replay deck</title><style>
:root{color:#24211d;background:#f7f0e4;font:18px/1.55 system-ui,sans-serif}body{margin:0}
nav{position:fixed;inset:auto 0 0;display:flex;justify-content:center;gap:1rem;padding:1rem;background:#f7f0e4e8}
.page{min-height:82vh;padding:8vh max(8vw,2rem);scroll-snap-align:start}.claim{font-size:1.5rem;max-width:50rem}
.eyebrow,time{color:#6d5843}a{color:#714214}main{scroll-snap-type:y mandatory}
.timeline{padding:3rem max(8vw,2rem) 7rem}li{margin:.7rem 0}
</style></head><body><main>${sections || '<section class="page"><h1>No topics yet</h1></section>'}
<section class="timeline"><h1>Chronological timeline</h1><ol>${markers}</ol></section></main>
<nav><button type="button" onclick="move(-1)">Previous</button><button type="button" onclick="move(1)">Next</button></nav>
<script>const pages=[...document.querySelectorAll(".page")];let current=0;function move(step){current=Math.max(0,Math.min(pages.length-1,current+step));pages[current]?.scrollIntoView({behavior:"smooth"})}</script>
</body></html>`;
  }
}
