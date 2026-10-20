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
}

export interface Claim {
  id: string;
  text: string;
  normalized: string;
  startMs: number;
  endMs: number;
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
  claimIds: string[];
  facts: Array<Required<Fact>>;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface StageContext {
  mediaTimeMs: number;
}

export interface Transcriber {
  readonly id: string;
  status(): Promise<{ status: TranscriberStatus; reason?: string }>;
  transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]>;
}

export interface ClaimExtractor {
  extract(segments: TranscriptSegment[], context: StageContext): Promise<Claim[]>;
  flush(context: StageContext): Promise<Claim[]>;
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
  factsOffered: number;
  factsCited: number;
  percentFactsCited: number;
  latencyByStageMs: Record<string, StageLatency>;
  claimToPageSeconds: ClaimToPageMetric[];
  skipReason?: string;
}
