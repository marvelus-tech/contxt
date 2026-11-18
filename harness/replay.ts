import { mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createResearcher,
  type ResearcherHandle,
  type ResearcherMode,
} from "../pipeline/research.js";
import {
  HeuristicClaimExtractor,
  HeuristicTopicGrouper,
  HtmlPageBuilder,
} from "../pipeline/stages.js";
import { createTranscriber } from "../pipeline/transcribers.js";
import type {
  ClaimExtractor,
  Page,
  PageBuilder,
  Researcher,
  Scorecard,
  TimelineEvent,
  TopicGrouper,
  Transcriber,
} from "../pipeline/types.js";
import { CHUNK_MS, mediaDuration, runIdentifier, sleep } from "./media.js";
import { createPipelineSession, type PipelineRunArtifacts } from "./pipeline.js";

export interface ReplayStages {
  transcriber?: Transcriber;
  claimExtractor?: ClaimExtractor;
  topicGrouper?: TopicGrouper;
  researcher?: Researcher;
  pageBuilder?: PageBuilder;
}

export interface ReplayOptions {
  inputPath: string;
  speed?: number;
  transcriber?: "fixture" | "whisper" | "assemblyai" | "deepgram";
  modelPath?: string;
  cloudModel?: string;
  keyterms?: string[];
  speakerHints?: string[];
  researcher?: ResearcherMode;
  researchFixture?: string;
  outRoot?: string;
  runId?: string;
  stages?: ReplayStages;
  onSummary?: (summary: string) => void;
}

export type ReplayResult = PipelineRunArtifacts;

export function formatScorecard(scorecard: Scorecard): string {
  const label = scorecard.ingestionMode === "live" ? "live" : "replay";
  const stages = Object.entries(scorecard.latencyByStageMs)
    .map(
      ([stage, latency]) =>
        `  ${stage}: ${latency.averageMs.toFixed(2)} ms average`,
    )
    .join("\n");
  const claims = scorecard.claimToPageSeconds
    .map(
      (metric) =>
        `  ${metric.claimId}${metric.speaker ? ` (${metric.speaker})` : ""} -> ${metric.pageId}: ${metric.action} in ${metric.seconds.toFixed(3)} seconds`,
    )
    .join("\n");
  return `CONTXT ${label} scorecard
ingestion: ${scorecard.ingestionMode ?? "replay"}
transcriber: ${scorecard.transcriber} (${scorecard.transcriberStatus})
researcher: ${scorecard.researcher ?? "n/a"} (${scorecard.researcherStatus ?? "n/a"})${
    scorecard.researchRequests !== undefined
      ? ` | requests ${scorecard.researchRequests} cache hits ${scorecard.researchCacheHits ?? 0}`
      : ""
  }
claims extracted: ${scorecard.claimStats?.claimsExtracted ?? scorecard.claimToPageSeconds.length}
unique claims: ${scorecard.claimStats?.uniqueClaims ?? "n/a"} (checkable ${scorecard.claimStats?.checkableUnique ?? "n/a"})
claim types: ${Object.entries(scorecard.claimStats?.uniqueByType ?? {})
    .map(([type, count]) => `${type} ${count}`)
    .join(", ") || "none"}
sentences dropped: ${Object.entries(scorecard.claimStats?.dropped ?? {})
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ") || "none"}
claims by speaker: ${Object.entries(scorecard.claimsBySpeaker ?? {})
    .map(([speaker, count]) => `${speaker} ${count}`)
    .join(", ") || "none"}
pages created: ${scorecard.pagesCreated}
pages updated: ${scorecard.pagesUpdated}
duplicates merged: ${scorecard.duplicatesMerged}
facts proposed: ${scorecard.factsProposed}
facts dropped for no source: ${scorecard.factsDroppedForNoSource}
facts on pages cited: ${scorecard.factsOnPagesCitedPercent.toFixed(1)}%
stage latency:
${stages || "  no stage samples"}
claim to page:
${claims || "  no claims"}`;
}

export async function runReplay(options: ReplayOptions): Promise<ReplayResult> {
  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error("Speed must be a finite number greater than zero");
  }

  const inputPath = resolve(options.inputPath);
  const durationMs = await mediaDuration(inputPath);
  const kind =
    options.transcriber ??
    (extname(inputPath).toLowerCase() === ".json" ? "fixture" : "whisper");
  const transcriber =
    options.stages?.transcriber ??
    (await createTranscriber(kind, inputPath, options.modelPath, {
      ...(options.cloudModel ? { model: options.cloudModel } : {}),
      ...(options.keyterms?.length ? { keyterms: options.keyterms } : {}),
      ...(options.speakerHints?.length ? { speakerHints: options.speakerHints } : {}),
    }));
  const extractor =
    options.stages?.claimExtractor ?? new HeuristicClaimExtractor();
  const grouper = options.stages?.topicGrouper ?? new HeuristicTopicGrouper();
  const runId = options.runId ?? runIdentifier();
  const runDir = resolve(options.outRoot ?? "out", runId);
  await mkdir(runDir, { recursive: true });
  const researchHandle: ResearcherHandle =
    options.stages?.researcher !== undefined
      ? {
          id: "custom",
          researcher: options.stages.researcher,
          status: async () => ({ status: "ok" as const }),
          stats: () => ({ requests: 0, cacheHits: 0 }),
        }
      : await createResearcher({
          mode: options.researcher ?? "fixture",
          fixturePath: resolve(options.researchFixture ?? "samples/research.json"),
          cachePath: join(runDir, "research-cache.json"),
        });
  const pageBuilder = options.stages?.pageBuilder ?? new HtmlPageBuilder();

  const session = createPipelineSession({
    runId,
    runDir,
    speed,
    chunkMs: CHUNK_MS,
    durationMs,
    ingestionMode: "replay",
    transcriberId: transcriber.id,
    researchHandle,
    extractor,
    grouper,
    researcher: researchHandle.researcher,
    pageBuilder,
  });

  const availability = await transcriber.status();
  if (availability.status === "ok") {
    const started = performance.now();
    const chunkCount = Math.ceil(durationMs / CHUNK_MS);
    for (let index = 0; index < chunkCount; index += 1) {
      const startMs = index * CHUNK_MS;
      const endMs = Math.min(durationMs, startMs + CHUNK_MS);
      const targetElapsedMs = startMs / speed;
      const remainingDelayMs = targetElapsedMs - (performance.now() - started);
      if (remainingDelayMs > 0) await sleep(remainingDelayMs);
      session.record(startMs, "harness", "chunk", `Chunk ${index + 1}`);
      const segments = await session.timed("transcriber", () =>
        transcriber.transcribe({
          index,
          startMs,
          endMs,
          sourcePath: inputPath,
        }),
      );
      await session.processSegments(segments, endMs);
    }
    await session.flushExtractor(durationMs);
  } else {
    session.record(0, "transcriber", availability.status, availability.reason ?? "");
  }

  const result = await session.finalize(
    availability.status,
    availability.reason,
  );
  options.onSummary?.(formatScorecard(result.scorecard));
  return result;
}