import { ClaimIndex } from "../pipeline/claims.js";
import type { ResearcherHandle } from "../pipeline/researchers.js";
import { isCitedFact } from "../pipeline/stages.js";
import type {
  Claim,
  ClaimExtractor,
  ClaimToPageMetric,
  Fact,
  IngestionMode,
  Page,
  PageBuilder,
  Researcher,
  Scorecard,
  StageLatency,
  TimelineEvent,
  Topic,
  TopicGrouper,
  TranscriptSegment,
  TranscriberStatus,
} from "../pipeline/types.js";

export interface PipelineSessionConfig {
  runId: string;
  runDir: string;
  speed: number;
  chunkMs: number;
  durationMs: number;
  ingestionMode: IngestionMode;
  transcriberId: string;
  researchHandle: ResearcherHandle;
  extractor: ClaimExtractor;
  grouper: TopicGrouper;
  researcher: Researcher;
  pageBuilder: PageBuilder;
  /** When false, finalize keeps artifacts in memory and does not touch disk. */
  persist?: boolean;
}

export interface PipelineSnapshot {
  timeline: TimelineEvent[];
  pages: Page[];
  pagesCreated: number;
  pagesUpdated: number;
  factsProposed: number;
  researchRequests: number;
}

export interface PipelineSession extends PipelineSessionConfig {
  readonly started: number;
  record(
    mediaMs: number,
    stage: string,
    type: string,
    detail: string,
    refId?: string,
    latencyMs?: number,
    claim?: Claim,
  ): void;
  timed<T>(stage: string, work: () => Promise<T>): Promise<T>;
  processSegments(segments: TranscriptSegment[], mediaTimeMs: number): Promise<void>;
  processClaim(claim: Claim): Promise<void>;
  flushExtractor(mediaTimeMs: number): Promise<void>;
  snapshot(): PipelineSnapshot;
  finalize(
    transcriberStatus: TranscriberStatus,
    skipReason?: string,
  ): Promise<PipelineRunArtifacts>;
}

export interface PipelineRunArtifacts {
  runDir: string;
  deckPath: string;
  timelinePath: string;
  scorecardPath: string;
  claimsPath: string;
  scorecard: Scorecard;
  timeline: TimelineEvent[];
  pages: Page[];
}

function summarizeLatency(
  samples: Record<string, number[]>,
): Record<string, StageLatency> {
  return Object.fromEntries(
    Object.entries(samples).map(([stage, values]) => [
      stage,
      {
        count: values.length,
        totalMs: Number(values.reduce((sum, value) => sum + value, 0).toFixed(3)),
        averageMs: Number(
          (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3),
        ),
        maxMs: Number(Math.max(...values).toFixed(3)),
      },
    ]),
  );
}

export function createPipelineSession(config: PipelineSessionConfig): PipelineSession {
  const started = globalThis.performance.now();
  const timeline: TimelineEvent[] = [];
  const topics: Topic[] = [];
  const pages = new Map<string, Page>();
  const claimIndex = new ClaimIndex();
  const topicByMergedClaim = new Map<string, string>();
  const latencySamples: Record<string, number[]> = {
    transcriber: [],
    claimExtractor: [],
    topicGrouper: [],
    researcher: [],
    pageBuilder: [],
  };
  const claimToPageSeconds: ClaimToPageMetric[] = [];
  const claimsSeen: Claim[] = [];
  let pagesCreated = 0;
  let pagesUpdated = 0;
  let duplicatesMerged = 0;
  let factsProposed = 0;
  let factsDroppedForNoSource = 0;

  const record = (
    mediaMs: number,
    stage: string,
    type: string,
    detail: string,
    refId?: string,
    latencyMs?: number,
    claim?: Claim,
  ): void => {
    timeline.push({
      atMs: Number((globalThis.performance.now() - started).toFixed(3)),
      mediaMs,
      stage,
      type,
      detail,
      refId,
      latencyMs,
      ...(claim?.speaker ? { speaker: claim.speaker } : {}),
      ...(claim ? { claim: claim.text } : {}),
    });
  };

  const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    const before = globalThis.performance.now();
    const result = await work();
    latencySamples[stage]!.push(globalThis.performance.now() - before);
    return result;
  };

  const processClaim = async (claim: Claim): Promise<void> => {
    const claimReceived = globalThis.performance.now();
    claimsSeen.push(claim);
    const { merged, isRepeat } = claimIndex.add({
      claimId: claim.id,
      startMs: claim.startMs,
      endMs: claim.endMs,
      text: claim.text,
      ...(claim.speaker ? { speaker: claim.speaker } : {}),
    });
    if (isRepeat) duplicatesMerged += 1;
    if (claim.checkable === false) {
      record(
        claim.endMs,
        "claimExtractor",
        isRepeat ? "repeat-not-checkable" : "claim-not-checkable",
        claim.type ?? "not checkable",
        merged.id,
        undefined,
        claim,
      );
      return;
    }
    const priorTopicId = topicByMergedClaim.get(merged.id);
    const priorTopic = priorTopicId
      ? topics.find((candidate) => candidate.id === priorTopicId)
      : undefined;
    const topic =
      priorTopic ??
      (await timed("topicGrouper", () => config.grouper.group(claim, topics)));
    if (priorTopic) priorTopic.claimIds.push(claim.id);
    topicByMergedClaim.set(merged.id, topic.id);
    record(claim.endMs, "topicGrouper", "topic-grouped", topic.title, topic.id, undefined, claim);

    const existingPage = pages.get(topic.id);
    let facts: Fact[] = [];
    if (priorTopic) {
      record(
        claim.endMs,
        "dedupe",
        "duplicate-merged",
        claim.text,
        existingPage?.id,
        undefined,
        claim,
      );
    } else {
      const proposedFacts = await timed("researcher", () =>
        config.researcher.research(claim, topic),
      );
      factsProposed += proposedFacts.length;
      facts = proposedFacts.filter(isCitedFact);
      factsDroppedForNoSource += proposedFacts.length - facts.length;
    }

    const built = await timed("pageBuilder", () =>
      config.pageBuilder.build({ claim, topic, facts, existingPage }),
    );
    pages.set(topic.id, built.page);
    const action = existingPage ? "updated" : "created";
    if (existingPage) pagesUpdated += 1;
    else pagesCreated += 1;
    const seconds = (globalThis.performance.now() - claimReceived) / 1_000;
    claimToPageSeconds.push({
      claimId: claim.id,
      pageId: built.page.id,
      action,
      seconds: Number(seconds.toFixed(6)),
      ...(claim.speaker ? { speaker: claim.speaker } : {}),
    });
    record(
      claim.endMs,
      "pageBuilder",
      `page-${action}`,
      `${action === "created" ? "Created" : "Updated"} ${built.page.title}`,
      built.page.id,
      seconds * 1_000,
      claim,
    );
  };

  const processSegments = async (
    segments: TranscriptSegment[],
    mediaTimeMs: number,
  ): Promise<void> => {
    const claims = await timed("claimExtractor", () =>
      config.extractor.extract(segments, { mediaTimeMs }),
    );
    for (const claim of claims) await processClaim(claim);
  };

  const flushExtractor = async (mediaTimeMs: number): Promise<void> => {
    const remaining = await timed("claimExtractor", () =>
      config.extractor.flush({ mediaTimeMs }),
    );
    for (const claim of remaining) await processClaim(claim);
  };

  const snapshot = (): PipelineSnapshot => ({
    timeline: timeline.map((event) => ({ ...event })),
    pages: [...pages.values()].map((page) => ({
      ...page,
      claimIds: [...page.claimIds],
      claims: page.claims.map((claim) => ({ ...claim })),
      facts: page.facts.map((fact) => ({ ...fact })),
    })),
    pagesCreated,
    pagesUpdated,
    factsProposed,
    researchRequests: config.researchHandle.stats().requests,
  });

  const finalize = async (
    transcriberStatus: TranscriberStatus,
    skipReason?: string,
  ): Promise<PipelineRunArtifacts> => {
    for (const [stage, values] of Object.entries(latencySamples)) {
      if (values.length === 0) delete latencySamples[stage];
    }
    const claimById = new Map(claimsSeen.map((claim) => [claim.id, claim]));
    const pageList = [...pages.values()];
    const factsOnPages = pageList.flatMap((page) => page.facts);
    const factsOnPagesCited = factsOnPages.filter(isCitedFact).length;
    const researchStats = config.researchHandle.stats();
    const researchAvailability = await config.researchHandle.status();
    const scorecard: Scorecard = {
      runId: config.runId,
      ingestionMode: config.ingestionMode,
      transcriber: config.transcriberId,
      transcriberStatus,
      researcher: config.researchHandle.id,
      researcherStatus: researchAvailability.status,
      researchRequests: researchStats.requests,
      researchCacheHits: researchStats.cacheHits,
      claimsResearched: researchStats.claimsResearched,
      claimsSkippedNonCheckable: researchStats.claimsSkippedNonCheckable,
      speed: config.speed,
      chunkMs: config.chunkMs,
      durationMs: config.durationMs,
      pagesCreated,
      pagesUpdated,
      duplicatesMerged,
      factsProposed,
      factsDroppedForNoSource,
      factsOnPagesCitedPercent: factsOnPages.length
        ? (factsOnPagesCited / factsOnPages.length) * 100
        : 100,
      latencyByStageMs: summarizeLatency(latencySamples),
      claimToPageSeconds,
      claimStats: {
        ...(config.extractor.stats?.() ?? {}),
        claimsExtracted: claimsSeen.length,
        uniqueClaims: claimIndex.merged.length,
        repeatsMerged: claimsSeen.length - claimIndex.merged.length,
        checkableUnique: claimIndex.merged.filter(
          (merged) => claimById.get(merged.id)?.checkable !== false,
        ).length,
        uniqueByType: claimIndex.merged.reduce<Record<string, number>>((counts, merged) => {
          const type = claimById.get(merged.id)?.type ?? "untyped";
          counts[type] = (counts[type] ?? 0) + 1;
          return counts;
        }, {}),
      },
      claimsBySpeaker: Object.fromEntries(
        [...new Set(claimsSeen.map((claim) => claim.speaker ?? "unknown"))].map(
          (speaker) => [
            speaker,
            claimsSeen.filter((claim) => (claim.speaker ?? "unknown") === speaker).length,
          ],
        ),
      ),
      ...(skipReason ? { skipReason } : {}),
    };

    await config.researchHandle.flush?.();
    if (config.persist === false) {
      return {
        runDir: config.runDir,
        deckPath: "",
        timelinePath: "",
        scorecardPath: "",
        claimsPath: "",
        scorecard,
        timeline,
        pages: pageList,
      };
    }
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const deckPath = join(config.runDir, "deck.html");
    const timelinePath = join(config.runDir, "timeline.json");
    const scorecardPath = join(config.runDir, "scorecard.json");
    const claimsPath = join(config.runDir, "claims.json");
    const claimsOut = claimIndex.merged.map((merged) => {
      const first = claimById.get(merged.id)!;
      return {
        id: merged.id,
        type: first.type ?? null,
        checkable: first.checkable ?? true,
        speaker: first.speaker ?? null,
        ...(first.speakerConfidence !== undefined
          ? { speakerConfidence: first.speakerConfidence }
          : {}),
        startMs: first.startMs,
        endMs: first.endMs,
        text: first.text,
        topicId: topicByMergedClaim.get(merged.id) ?? null,
        occurrences: merged.occurrences,
      };
    });

    await Promise.all([
      writeFile(claimsPath, `${JSON.stringify(claimsOut, null, 2)}\n`),
      writeFile(deckPath, config.pageBuilder.render(pageList, timeline)),
      writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`),
      writeFile(scorecardPath, `${JSON.stringify(scorecard, null, 2)}\n`),
    ]);

    return {
      runDir: config.runDir,
      deckPath,
      timelinePath,
      scorecardPath,
      claimsPath,
      scorecard,
      timeline,
      pages: pageList,
    };
  };

  return {
    ...config,
    started,
    record,
    timed,
    processClaim,
    processSegments,
    flushExtractor,
    snapshot,
    finalize,
  };
}
