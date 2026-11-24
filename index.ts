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
  TavilySearchProvider,
  WebResearcher,
  hitsToFacts,
} from "./pipeline/research.js";
export {
  buildCompositeResearchQuery,
  createResearcher,
  CompositeResearcher,
  GoogleFactCheckResearcher,
  TavilyResearcher,
} from "./pipeline/researchers.js";
export type { ResearcherMode, ResearcherHandle } from "./pipeline/researchers.js";
export {
  KeywordContextResearcher,
  createOfflineDemoResearcher,
} from "./pipeline/context-research.js";
export {
  PreloadedPresentationAdapter,
  FileUploadIngestAdapter,
  MicrophoneIngestAdapter,
  MicrophoneBrowserError,
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
export {
  browserListenProtocols,
  deepgramBrowserListenUrl,
  describeMicFailure,
  isSafeTokenUrl,
  readDeepgramListenEvent,
} from "./pipeline/mic.js";
export { handleMicGrantRequest, isGrantOriginAllowed } from "./pipeline/mic-grant.js";
export { WikipediaSearchProvider } from "./pipeline/wikipedia.js";
export { createMicrophonePipeline } from "./web/mic/browser.js";
