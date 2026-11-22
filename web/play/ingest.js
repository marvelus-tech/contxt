/**
 * Browser ingest boundary. Mirrors pipeline/ingest.ts.
 * Preloaded debate and live microphone are real. File upload stays deferred.
 */

export const DEFERRED_INGEST_MESSAGE = {
  "file-upload":
    "File upload is a deferred ingest adapter. Use the microphone, or open the 1992 debate.",
};

function assertPublicDemoIsOffline(meta) {
  if (meta?.researcher !== "fixture") {
    throw new Error("public demo researcher must be fixture");
  }
  if ((meta?.researchRequests ?? 0) !== 0) {
    throw new Error("public demo must make 0 Tavily requests");
  }
}

export async function loadPreloadedSession() {
  const [session, pages, timeline, meta] = await Promise.all([
    fetch("session.json").then((response) => {
      if (!response.ok) throw new Error("session");
      return response.json();
    }),
    fetch("pages.json").then((response) => {
      if (!response.ok) throw new Error("pages");
      return response.json();
    }),
    fetch("timeline.json").then((response) => {
      if (!response.ok) throw new Error("timeline");
      return response.json();
    }),
    fetch("meta.json").then((response) => {
      if (!response.ok) throw new Error("meta");
      return response.json();
    }),
  ]);
  assertPublicDemoIsOffline(session);
  assertPublicDemoIsOffline(meta);
  return { session, pages, timeline, meta };
}

export function startDeferredIngest(kind) {
  if (kind === "microphone") {
    return {
      ok: false,
      kind,
      message: "The microphone is live on this page. Use the microphone button.",
    };
  }
  const message = DEFERRED_INGEST_MESSAGE[kind];
  if (!message) return { ok: false, kind, message: "Unknown ingest source." };
  return { ok: false, kind, message };
}
