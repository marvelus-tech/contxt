import { mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  createResearcher,
  type ResearcherHandle,
  type ResearcherMode,
} from "../pipeline/researchers.js";
import { createLiveSource, type DeepgramLiveOptions } from "../pipeline/live.js";
import {
  HeuristicClaimExtractor,
  HeuristicTopicGrouper,
  HtmlPageBuilder,
} from "../pipeline/stages.js";
import type {
  ClaimExtractor,
  PageBuilder,
  Researcher,
  TopicGrouper,
} from "../pipeline/types.js";
import { CHUNK_MS, mediaDuration, runIdentifier } from "./media.js";
import { createPipelineSession, type PipelineRunArtifacts } from "./pipeline.js";
import { formatScorecard, type ReplayStages } from "./replay.js";

export interface LiveOptions {
  inputPath: string;
  speed?: number;
  transcriber?: "fixture" | "deepgram-live";
  cloudModel?: string;
  keyterms?: string[];
  speakerHints?: string[];
  researcher?: ResearcherMode;
  researchFixture?: string;
  outRoot?: string;
  runId?: string;
  stages?: ReplayStages;
  deepgram?: DeepgramLiveOptions;
  onSummary?: (summary: string) => void;
}

export type LiveResult = PipelineRunArtifacts;

export async function runLive(options: LiveOptions): Promise<LiveResult> {
  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error("Speed must be a finite number greater than zero");
  }

  const inputPath = resolve(options.inputPath);
  const extension = extname(inputPath).toLowerCase();
  const kind =
    options.transcriber ??
    (extension === ".json" ? "fixture" : "deepgram-live");
  if (kind === "deepgram-live" && extension !== ".wav") {
    throw new Error("Deepgram live streaming requires a WAV file in v1");
  }

  const source = await createLiveSource(inputPath, kind, {
    speakerHints: options.speakerHints,
    deepgram: {
      ...(options.deepgram ?? {}),
      ...(options.cloudModel ? { model: options.cloudModel } : {}),
      ...(options.keyterms?.length ? { keyterms: options.keyterms } : {}),
    },
  });

  const durationMs =
    kind === "fixture" ? await source.durationMs() : await mediaDuration(inputPath);

  const extractor =
    options.stages?.claimExtractor ?? new HeuristicClaimExtractor();
  const grouper = options.stages?.topicGrouper ?? new HeuristicTopicGrouper();
  const runId = options.runId ?? runIdentifier();
  const runDir = resolve(options.outRoot ?? "out", runId);
  await mkdir(runDir, { recursive: true });
  const researchHandle: ResearcherHandle =
    options.stages?.researcher !== undefined
      ? {
          id: options.researcher ?? "custom",
          researcher: options.stages.researcher,
          status: async () => ({ status: "ok" as const }),
          stats: () => ({
            requests: 0,
            cacheHits: 0,
            claimsResearched: 0,
            claimsSkippedNonCheckable: 0,
          }),
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
    ingestionMode: "live",
    transcriberId: source.id,
    researchHandle,
    extractor,
    grouper,
    researcher: researchHandle.researcher,
    pageBuilder,
  });

  const availability = await source.status();
  if (availability.status === "ok") {
    for await (const batch of source.batches(speed)) {
      session.record(batch.startMs, "harness", "chunk", `Chunk ${batch.index + 1}`);
      if (batch.segments.length > 0) {
        await session.timed("transcriber", () => Promise.resolve(batch.segments));
        await session.processSegments(batch.segments, batch.endMs);
      }
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