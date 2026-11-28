import { classifyClaim } from "./claims.js";
import type {
  BuildPageInput,
  BuildPageResult,
  Claim,
  ClaimExtractor,
  ClaimExtractorStats,
  Fact,
  Page,
  PageBuilder,
  PageClaim,
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

// The sentence segmenter splits after titles such as "Mr." when a capital follows.
const TRAILING_ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Sr|Jr|Gov|Sen|Rep|Gen|Lt|Col|Prof|Mt|vs)\.$/i;

function joinAbbreviations(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts.filter(Boolean)) {
    const last = out.at(-1);
    if (last !== undefined && TRAILING_ABBREVIATION.test(last)) out[out.length - 1] = `${last} ${part}`;
    else out.push(part);
  }
  return out;
}

export class HeuristicClaimExtractor implements ClaimExtractor {
  private carry = "";
  private carrySegment: TranscriptSegment | undefined;
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
      // A sentence never spans two speakers. If the speaker changes, the
      // unfinished text belongs to the previous speaker and is closed out.
      if (
        this.carry &&
        this.carrySegment &&
        this.carrySegment.speaker !== segment.speaker
      ) {
        const claim = this.toClaim(this.carry, this.carrySegment);
        if (claim) claims.push(claim);
        this.carry = "";
        this.carrySegment = undefined;
      }
      const startSegment = this.carry && this.carrySegment ? this.carrySegment : segment;
      const combined = `${this.carry} ${segment.text}`.trim();
      const sentences = joinAbbreviations(
        [...this.sentenceSegmenter.segment(combined)].map(({ segment: sentence }) => sentence.trim()),
      );
      const complete = sentences.filter((sentence) => /[.!?]["')\]]?$/.test(sentence));
      this.carry = sentences.filter((sentence) => !/[.!?]["')\]]?$/.test(sentence)).at(-1) ?? "";
      this.carrySegment = this.carry ? segment : undefined;

      for (const sentence of complete) {
        const claim = this.toClaim(sentence.trim(), {
          ...segment,
          startMs: Math.min(startSegment.startMs, segment.startMs),
        });
        if (claim) claims.push(claim);
      }
    }
    return claims;
  }

  async flush(context: StageContext): Promise<Claim[]> {
    if (!this.carry) return [];
    const text = this.carry;
    const speaker = this.carrySegment?.speaker;
    this.carry = "";
    this.carrySegment = undefined;
    const claim = this.toClaim(text, {
      startMs: context.mediaTimeMs,
      endMs: context.mediaTimeMs,
      text,
      speaker,
    });
    return claim ? [claim] : [];
  }

  private readonly counts: ClaimExtractorStats = { sentences: 0, dropped: {} };

  stats(): ClaimExtractorStats {
    return { sentences: this.counts.sentences, dropped: { ...this.counts.dropped } };
  }

  private toClaim(text: string, segment: TranscriptSegment): Claim | undefined {
    this.counts.sentences += 1;
    const verdict = classifyClaim(text, { moderator: segment.speakerRole === "moderator" });
    if (!verdict.keep) {
      const reason = verdict.reason ?? "other";
      this.counts.dropped[reason] = (this.counts.dropped[reason] ?? 0) + 1;
      return undefined;
    }
    return {
      id: `claim-${this.nextId++}`,
      text,
      normalized: normalizeClaim(text),
      startMs: segment.startMs,
      endMs: segment.endMs,
      ...(segment.speaker ? { speaker: segment.speaker } : {}),
      ...(segment.speakerConfidence !== undefined
        ? { speakerConfidence: segment.speakerConfidence }
        : {}),
      type: verdict.type!,
      checkable: verdict.checkable,
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
    // Loaded only when a Node replay asks for the fixture file. The browser
    // bundle never calls this, so it does not need the filesystem.
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      facts: Record<string, Fact[]>;
    };
    return new FixtureResearcher(parsed.facts ?? {});
  }

  async research(claim: Claim, _topic?: Topic): Promise<Fact[]> {
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

function pageClaim(claim: Claim): PageClaim {
  return {
    id: claim.id,
    text: claim.text,
    startMs: claim.startMs,
    ...(claim.speaker ? { speaker: claim.speaker } : {}),
  };
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export class HtmlPageBuilder implements PageBuilder {
  async build(input: BuildPageInput): Promise<BuildPageResult> {
    const facts = input.facts.filter(isCitedFact);
    const page: Page = input.existingPage
      ? {
          ...input.existingPage,
          currentClaim: input.claim.text,
          currentSpeaker: input.claim.speaker,
          claimIds: [...input.existingPage.claimIds, input.claim.id],
          claims: [...input.existingPage.claims, pageClaim(input.claim)],
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
          currentSpeaker: input.claim.speaker,
          claimIds: [input.claim.id],
          claims: [pageClaim(input.claim)],
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
        (page, index) => `<section id="${escapeHtml(page.id)}" class="deck-page page">
  <p class="eyebrow">Topic ${index + 1} of ${pages.length}</p>
  <h1>${escapeHtml(page.title)}</h1>
  <p class="claim">${escapeHtml(page.currentClaim)}</p>${
    page.currentSpeaker
      ? `\n  <p class="speaker">Said by ${escapeHtml(page.currentSpeaker)}</p>`
      : ""
  }${
    page.claims.length > 1
      ? `\n  <h2>Claims on this topic</h2>\n  <ol class="claims">${page.claims
          .map(
            (claim) =>
              `<li><time>${formatClock(claim.startMs)}</time> ${
                claim.speaker
                  ? `<strong>${escapeHtml(claim.speaker)}:</strong> `
                  : ""
              }${escapeHtml(claim.text)}</li>`,
          )
          .join("")}</ol>`
      : ""
  }
  <h2>Cited facts</h2>
  <ul>${page.facts
    .slice(0, 5)
    .map((fact) => {
      const meta: string[] = [];
      if (fact.publisher) meta.push(escapeHtml(fact.publisher));
      if (fact.sourceTitle && !fact.publisher) meta.push(escapeHtml(fact.sourceTitle));
      if (fact.rating) meta.push(`Rating: ${escapeHtml(fact.rating)}`);
      const metaHtml =
        meta.length > 0
          ? ` <span class="source-meta">(${meta.join(", ")})</span>`
          : "";
      const label = fact.provider === "google-fact-check" ? "Fact check" : "Source";
      return `<li>${escapeHtml(fact.text)}${metaHtml} <a href="${escapeHtml(fact.sourceUrl)}">${label}</a></li>`;
    })
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
          `<li><time>${(event.mediaMs / 1000).toFixed(1)}s</time> ${escapeHtml(event.detail)}${
            event.claim
              ? `<br><span class="said">${
                  event.speaker
                    ? `<strong>${escapeHtml(event.speaker)}:</strong> `
                    : ""
                }${escapeHtml(event.claim)}</span>`
              : ""
          }</li>`,
      )
      .join("");

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CNTXT | Presentation deck</title>
<link rel="stylesheet" href="../../shared.css">
<style>
  body.deck-shell { min-height: 100vh; font-size: 1.0625rem; line-height: 1.55; }
  .deck-main { scroll-snap-type: y mandatory; padding: 1rem 0 6rem; }
  .deck-page {
    min-height: 80vh;
    padding: 2.5rem var(--cntxt-gutter) 4rem;
    scroll-snap-align: start;
    max-width: var(--cntxt-measure);
    margin: 0 auto;
    box-sizing: border-box;
  }
  .deck-page h1 { font-size: clamp(1.35rem, 3vw, 1.75rem); font-weight: 700; letter-spacing: -0.02em; margin: 0.35rem 0 0.75rem; }
  .deck-page h2 { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 1.35rem 0 0.5rem; font-weight: 650; }
  .deck-page .claim { font-size: clamp(1.15rem, 2.5vw, 1.45rem); max-width: 40rem; line-height: 1.4; }
  .deck-page .eyebrow { font-family: var(--mono); font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .deck-page .speaker { color: var(--muted); font-weight: 600; margin-top: 0.35rem; }
  .deck-page ul, .deck-page ol { padding-left: 1.15rem; margin: 0.35rem 0; }
  .deck-page li { margin: 0.45rem 0; }
  .deck-page time, .deck-timeline .said { color: var(--muted); font-size: 0.92rem; }
  .deck-page a { color: #714214; }
  .deck-timeline { padding: 2rem var(--cntxt-gutter) 5rem; max-width: var(--cntxt-measure); margin: 0 auto; border-top: 1px solid var(--line); }
  .deck-timeline h1 { font-size: 1.15rem; font-weight: 650; margin-bottom: 0.85rem; }
  .deck-nav {
    position: fixed; inset: auto 0 0; z-index: 25;
    display: flex; justify-content: center; gap: 0.65rem;
    padding: 0.85rem var(--cntxt-gutter);
    border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 94%, transparent);
    backdrop-filter: blur(8px);
  }
  .deck-nav button { font: inherit; font-weight: 650; min-height: 2.75rem; padding: 0.55rem 1.1rem; border: 1px solid var(--line); background: var(--paper); cursor: pointer; }
  .deck-nav button:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .deck-back { font-size: 0.72rem; }
</style></head>
<body class="cntxt-shell deck-shell">
<header class="cntxt-top">
  <div class="cntxt-top__inner">
    <a class="cntxt-brand" href="../../">CNTXT</a>
    <nav aria-label="Deck">
      <ul class="cntxt-top__nav">
        <li><a class="cntxt-link deck-back" href="index.html">← Workspace</a></li>
      </ul>
    </nav>
  </div>
</header>
<main class="cntxt-main deck-main">${sections || '<section class="deck-page page"><h1>No topics yet</h1></section>'}
<section class="deck-timeline timeline" aria-labelledby="timeline-heading"><h1 id="timeline-heading">Chronological timeline</h1><ol>${markers}</ol></section></main>
<nav class="deck-nav" aria-label="Slide navigation"><button type="button" onclick="move(-1)">Previous</button><button type="button" onclick="move(1)">Next</button></nav>
<script>const pages=[...document.querySelectorAll(".deck-page")];let current=0;function move(step){current=Math.max(0,Math.min(pages.length-1,current+step));pages[current]?.scrollIntoView({behavior:"smooth"})}</script>
</body></html>`;
  }
}
