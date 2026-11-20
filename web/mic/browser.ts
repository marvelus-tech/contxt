import { createPipelineSession } from "../../harness/pipeline.js";
import {
  browserListenProtocols,
  deepgramBrowserListenUrl,
  describeMicFailure,
  downsampleBox,
  floatToInt16,
  isSafeTokenUrl,
  micNotice,
  readDeepgramListenEvent,
} from "../../pipeline/mic.js";
import { WebResearcher } from "../../pipeline/research.js";
import {
  HeuristicClaimExtractor,
  HeuristicTopicGrouper,
  HtmlPageBuilder,
} from "../../pipeline/stages.js";
import { WikipediaSearchProvider } from "../../pipeline/wikipedia.js";

export {
  browserListenProtocols,
  deepgramBrowserListenUrl,
  describeMicFailure,
  downsampleBox,
  floatToInt16,
  isSafeTokenUrl,
  micNotice,
  readDeepgramListenEvent,
};

/**
 * Same claim, topic, research and page stages as replay and live.
 * Citations come from Wikipedia in the browser, so no search key ships in the page.
 */
export function createMicrophonePipeline(fetchImpl: typeof fetch = fetch) {
  const stats = { requests: 0, cacheHits: 0 };
  const researcher = new WebResearcher({
    provider: new WikipediaSearchProvider(fetchImpl),
    maxFacts: 3,
    stats,
  });
  const session = createPipelineSession({
    runId: "microphone",
    runDir: "memory",
    speed: 1,
    chunkMs: 0,
    durationMs: 0,
    ingestionMode: "live",
    transcriberId: "deepgram-browser",
    persist: false,
    researchHandle: {
      id: "wikipedia",
      researcher,
      async status() {
        return { status: "ok" as const };
      },
      stats: () => stats,
      flush: () => researcher.flushCache(),
    },
    extractor: new HeuristicClaimExtractor(),
    grouper: new HeuristicTopicGrouper(),
    researcher,
    pageBuilder: new HtmlPageBuilder(),
  });
  return { session, stats, researcherId: "wikipedia" as const };
}
