import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import {
  FixtureResearcher,
  HeuristicClaimExtractor,
  HeuristicTopicGrouper,
  HtmlPageBuilder,
} from "../pipeline/stages.js";
import { createTranscriber } from "../pipeline/transcribers.js";
import type {
  Claim,
  ClaimExtractor,
  ClaimToPageMetric,
  Fact,
  Page,
  PageBuilder,
  Researcher,
  Scorecard,
  StageLatency,
  TimelineEvent,
  Topic,
  TopicGrouper,
  Transcriber,
} from "../pipeline/types.js";

const execFileAsync = promisify(execFile);
const CHUNK_MS = 1_500;

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
  researchFixture?: string;
  outRoot?: string;
  runId?: string;
  stages?: ReplayStages;
  onSummary?: (summary: string) => void;
}

export interface ReplayResult {
  runDir: string;
  deckPath: string;
  timelinePath: string;
  scorecardPath: string;
  scorecard: Scorecard;
  timeline: TimelineEvent[];
  pages: Page[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fixtureDuration(path: string): Promise<number> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    segments?: Array<{ endMs: number }>;
  };
  return Math.max(0, ...(parsed.segments ?? []).map((segment) => segment.endMs));
}

async function wavDuration(path: string): Promise<number> {
  const data = await readFile(path);
  if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Invalid WAV file");
  }
  const byteRate = data.readUInt32LE(28);
  const dataIndex = data.indexOf(Buffer.from("data"));
  if (!byteRate || dataIndex < 0 || dataIndex + 8 > data.length) {
    throw new Error("WAV duration metadata is missing");
  }
  return (data.readUInt32LE(dataIndex + 4) / byteRate) * 1_000;
}

async function mediaDuration(path: string): Promise<number> {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return fixtureDuration(path);
  if (extension === ".wav") return wavDuration(path);
  if (extension === ".mp3") {
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
      ]);
      return Number.parseFloat(stdout) * 1_000;
    } catch {
      throw new Error("MP3 replay needs ffprobe to determine duration");
    }
  }
  throw new Error("Replay input must be a WAV, MP3, or transcript JSON file");
}

function runIdentifier(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${stamp}-${Math.random().toString(16).slice(2, 6)}`;
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
          (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(
            3,
          ),
        ),
        maxMs: Number(Math.max(...values).toFixed(3)),
      },
    ]),
  );
}

export function formatScorecard(scorecard: Scorecard): string {
  const stages = Object.entries(scorecard.latencyByStageMs)
    .map(
      ([stage, latency]) =>
        `  ${stage}: ${latency.averageMs.toFixed(2)} ms average`,
    )
    .join("\n");
  const claims = scorecard.claimToPageSeconds
    .map(
      (metric) =>
        `  ${metric.claimId} -> ${metric.pageId}: ${metric.action} in ${metric.seconds.toFixed(3)} seconds`,
    )
    .join("\n");
  return `CONTXT replay scorecard
transcriber: ${scorecard.transcriber} (${scorecard.transcriberStatus})
pages created: ${scorecard.pagesCreated}
pages updated: ${scorecard.pagesUpdated}
duplicates merged: ${scorecard.duplicatesMerged}
facts cited: ${scorecard.percentFactsCited.toFixed(1)}%
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
    (await createTranscriber(kind, inputPath, options.modelPath));
  const extractor =
    options.stages?.claimExtractor ?? new HeuristicClaimExtractor();
  const grouper = options.stages?.topicGrouper ?? new HeuristicTopicGrouper();
  const researcher =
    options.stages?.researcher ??
    (await FixtureResearcher.fromFile(
      resolve(options.researchFixture ?? "samples/research.json"),
    ));
  const pageBuilder = options.stages?.pageBuilder ?? new HtmlPageBuilder();

  const runId = options.runId ?? runIdentifier();
  const runDir = resolve(options.outRoot ?? "out", runId);
  await mkdir(runDir, { recursive: true });

  const started = performance.now();
  const timeline: TimelineEvent[] = [];
  const topics: Topic[] = [];
  const pages = new Map<string, Page>();
  const claimPages = new Map<string, Page>();
  const seenClaims = new Map<string, string>();
  const latencySamples: Record<string, number[]> = {
    transcriber: [],
    claimExtractor: [],
    topicGrouper: [],
    researcher: [],
    pageBuilder: [],
  };
  const claimToPageSeconds: ClaimToPageMetric[] = [];
  let pagesCreated = 0;
  let pagesUpdated = 0;
  let duplicatesMerged = 0;
  let factsOffered = 0;
  let factsCited = 0;

  const record = (
    mediaMs: number,
    stage: string,
    type: string,
    detail: string,
    refId?: string,
    latencyMs?: number,
  ): void => {
    timeline.push({
      atMs: Number((performance.now() - started).toFixed(3)),
      mediaMs,
      stage,
      type,
      detail,
      refId,
      latencyMs,
    });
  };

  const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    const before = performance.now();
    const result = await work();
    latencySamples[stage]!.push(performance.now() - before);
    return result;
  };

  const processClaim = async (claim: Claim): Promise<void> => {
    const claimReceived = performance.now();
    const topic = await timed("topicGrouper", () =>
      grouper.group(claim, topics),
    );
    record(claim.endMs, "topicGrouper", "topic-grouped", topic.title, topic.id);

    const priorClaimPageId = seenClaims.get(claim.normalized);
    const existingPage = pages.get(topic.id);
    let facts: Fact[] = [];
    if (priorClaimPageId) {
      duplicatesMerged += 1;
      record(
        claim.endMs,
        "dedupe",
        "duplicate-merged",
        claim.text,
        priorClaimPageId,
      );
    } else {
      seenClaims.set(claim.normalized, existingPage?.id ?? `page-${topic.id}`);
      facts = await timed("researcher", () => researcher.research(claim, topic));
    }

    const built = await timed("pageBuilder", () =>
      pageBuilder.build({ claim, topic, facts, existingPage }),
    );
    factsOffered += built.offeredFacts;
    factsCited += built.citedFacts;
    pages.set(topic.id, built.page);
    claimPages.set(claim.id, built.page);
    const action = existingPage ? "updated" : "created";
    if (existingPage) pagesUpdated += 1;
    else pagesCreated += 1;
    const seconds = (performance.now() - claimReceived) / 1_000;
    claimToPageSeconds.push({
      claimId: claim.id,
      pageId: built.page.id,
      action,
      seconds: Number(seconds.toFixed(6)),
    });
    record(
      claim.endMs,
      "pageBuilder",
      `page-${action}`,
      `${action === "created" ? "Created" : "Updated"} ${built.page.title}`,
      built.page.id,
      seconds * 1_000,
    );
  };

  const availability = await transcriber.status();
  if (availability.status === "ok") {
    const chunkCount = Math.ceil(durationMs / CHUNK_MS);
    for (let index = 0; index < chunkCount; index += 1) {
      const startMs = index * CHUNK_MS;
      const endMs = Math.min(durationMs, startMs + CHUNK_MS);
      if (index > 0) await sleep((endMs - startMs) / speed);
      record(startMs, "harness", "chunk", `Chunk ${index + 1}`);
      const segments = await timed("transcriber", () =>
        transcriber.transcribe({
          index,
          startMs,
          endMs,
          sourcePath: inputPath,
        }),
      );
      const claims = await timed("claimExtractor", () =>
        extractor.extract(segments, { mediaTimeMs: endMs }),
      );
      for (const claim of claims) await processClaim(claim);
    }
    const remaining = await timed("claimExtractor", () =>
      extractor.flush({ mediaTimeMs: durationMs }),
    );
    for (const claim of remaining) await processClaim(claim);
  } else {
    record(0, "transcriber", availability.status, availability.reason ?? "");
  }

  for (const [stage, values] of Object.entries(latencySamples)) {
    if (values.length === 0) delete latencySamples[stage];
  }
  const scorecard: Scorecard = {
    runId,
    transcriber: transcriber.id,
    transcriberStatus: availability.status,
    speed,
    chunkMs: CHUNK_MS,
    durationMs,
    pagesCreated,
    pagesUpdated,
    duplicatesMerged,
    factsOffered,
    factsCited,
    percentFactsCited: factsOffered ? (factsCited / factsOffered) * 100 : 100,
    latencyByStageMs: summarizeLatency(latencySamples),
    claimToPageSeconds,
    ...(availability.reason ? { skipReason: availability.reason } : {}),
  };
  const pageList = [...pages.values()];
  const deckPath = join(runDir, "deck.html");
  const timelinePath = join(runDir, "timeline.json");
  const scorecardPath = join(runDir, "scorecard.json");
  await Promise.all([
    writeFile(deckPath, pageBuilder.render(pageList, timeline)),
    writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`),
    writeFile(scorecardPath, `${JSON.stringify(scorecard, null, 2)}\n`),
  ]);
  options.onSummary?.(formatScorecard(scorecard));
  return {
    runDir,
    deckPath,
    timelinePath,
    scorecardPath,
    scorecard,
    timeline,
    pages: pageList,
  };
}
