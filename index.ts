export { formatScorecard, runReplay } from "./harness/replay.js";
export type {
  ReplayOptions,
  ReplayResult,
  ReplayStages,
} from "./harness/replay.js";
export { runLive } from "./harness/live.js";
export type { LiveOptions, LiveResult } from "./harness/live.js";
export type {
  ClaimExtractor,
  PageBuilder,
  Researcher,
  TopicGrouper,
  Transcriber,
} from "./pipeline/types.js";
export {
  CloudTranscriber,
  assemblyAiToSegments,
  deepgramToSegments,
  transcribeWithAssemblyAI,
  transcribeWithDeepgram,
  wordsToSegments,
} from "./pipeline/cloud.js";
export type { CloudTranscription, TimedWord } from "./pipeline/cloud.js";
export type { Claim, PageClaim, TranscriptSegment } from "./pipeline/types.js";
export {
  buildResearchQuery,
  createResearcher,
  TavilySearchProvider,
  WebResearcher,
  CompositeResearcher,
} from "./pipeline/research.js";
export type { ResearcherMode, ResearcherHandle } from "./pipeline/research.js";
export {
  KeywordContextResearcher,
  createOfflineDemoResearcher,
} from "./pipeline/context-research.js";
export {
  PreloadedPresentationAdapter,
  FileUploadIngestAdapter,
  MicrophoneIngestAdapter,
  IngestDeferredError,
  ingestAdapterFor,
  assertPublicDemoIsOffline,
  DEFERRED_INGEST_MESSAGE,
} from "./pipeline/ingest.js";
export type {
  PresentationIngestKind,
  PresentationIngestAdapter,
  PresentationSource,
  LoadedPresentation,
  PlaySessionMeta,
} from "./pipeline/ingest.js";
export {
  DeepgramLiveSource,
  FixtureLiveSource,
  NodeDeepgramWebSocket,
  createLiveSource,
} from "./pipeline/live.js";
export type {
  DeepgramLiveOptions,
  DeepgramLiveWebSocket,
  FixtureLiveOptions,
  SegmentSource,
} from "./pipeline/live.js";
