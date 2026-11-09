export type TranscriberStatus = "ok" | "skipped" | "stub";

export interface AudioChunk {
  index: number;
  startMs: number;
  endMs: number;
  sourcePath: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** Display label for who said it, for example "Ross Perot" or "Speaker A". */
  speaker?: string;
  /** 0 to 1 when the speaker name was inferred rather than given. */
  speakerConfidence?: number;
  /** Set for the moderator, whose framing lines are procedural rather than claims. */
  speakerRole?: "moderator";
}

export interface Claim {
  id: string;
  text: string;
  normalized: string;
  startMs: number;
  endMs: number;
  speaker?: string;
  speakerConfidence?: number;
  type?: "statistic" | "factual" | "prediction" | "promise" | "opinion";
  /** Statistic and factual claims are checkable. */
  checkable?: boolean;
}

export interface Topic {
  id: string;
  title: string;
  tokens: string[];
  claimIds: string[];
}

export interface Fact {
  text: string;
  sourceUrl?: string | null;
}

export interface Page {
  id: string;
  topicId: string;
  title: string;
  currentClaim: string;
  currentSpeaker?: string;
  claimIds: string[];
  claims: PageClaim[];
  facts: Array<{ text: string; sourceUrl: string }>;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface PageClaim {
  id: string;
  text: string;
  startMs: number;
  speaker?: string;
}

export interface StageContext {
  mediaTimeMs: number;
}

export interface Transcriber {
  readonly id: string;
  status(): Promise<{ status: TranscriberStatus; reason?: string }>;
  transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]>;
}

export interface ClaimExtractorStats {
  sentences: number;
  dropped: Record<string, number>;
}

export interface ClaimExtractor {
  extract(segments: TranscriptSegment[], context: StageContext): Promise<Claim[]>;
  flush(context: StageContext): Promise<Claim[]>;
  stats?(): ClaimExtractorStats;
}

export interface TopicGrouper {
  group(claim: Claim, topics: Topic[]): Promise<Topic>;
}

export interface Researcher {
  research(claim: Claim, topic: Topic): Promise<Fact[]>;
}

export interface BuildPageInput {
  claim: Claim;
  topic: Topic;
  facts: Fact[];
  existingPage?: Page;
}

export interface BuildPageResult {
  page: Page;
  offeredFacts: number;
  citedFacts: number;
}

export interface PageBuilder {
  build(input: BuildPageInput): Promise<BuildPageResult>;
  render(pages: Page[], timeline: TimelineEvent[]): string;
}

export interface TimelineEvent {
  atMs: number;
  mediaMs: number;
  stage: string;
  type: string;
  detail: string;
  refId?: string;
  latencyMs?: number;
  speaker?: string;
  claim?: string;
}

export interface StageLatency {
  count: number;
  totalMs: number;
  averageMs: number;
  maxMs: number;
}

export interface ClaimToPageMetric {
  claimId: string;
  pageId: string;
  action: "created" | "updated";
  seconds: number;
  speaker?: string;
}

export interface Scorecard {
  runId: string;
  transcriber: string;
  transcriberStatus: TranscriberStatus;
  speed: number;
  chunkMs: number;
  durationMs: number;
  pagesCreated: number;
  pagesUpdated: number;
  duplicatesMerged: number;
  factsProposed: number;
  factsDroppedForNoSource: number;
  factsOnPagesCitedPercent: number;
  latencyByStageMs: Record<string, StageLatency>;
  claimToPageSeconds: ClaimToPageMetric[];
  claimsBySpeaker?: Record<string, number>;
  claimStats?: Partial<ClaimExtractorStats> & {
    claimsExtracted: number;
    uniqueClaims: number;
    repeatsMerged: number;
    checkableUnique: number;
    uniqueByType: Record<string, number>;
  };
  skipReason?: string;
}
