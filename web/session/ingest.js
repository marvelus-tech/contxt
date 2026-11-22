/**
 * Browser ingest boundary. Mirrors pipeline/ingest.ts:
 * preloaded is the only live path; upload and microphone stay deferred.
 */

export const DEFERRED_INGEST_MESSAGE = {
  "file-upload":
    "File upload is a deferred ingest adapter. This MVP auto-loads the 1992 debate presentation.",
  microphone:
    "Microphone capture is a deferred ingest adapter. This MVP auto-loads the 1992 debate presentation.",
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
    fetch("session.json").then((r) => r.json()),
    fetch("pages.json").then((r) => r.json()),
    fetch("timeline.json").then((r) => r.json()),
    fetch("meta.json").then((r) => r.json()),
  ]);
  assertPublicDemoIsOffline(session);
  assertPublicDemoIsOffline(meta);
  return { session, pages, timeline, meta };
}

export function startDeferredIngest(kind) {
  const message = DEFERRED_INGEST_MESSAGE[kind];
  if (!message) {
    return { ok: false, kind, message: "Unknown ingest source." };
  }
  return { ok: false, kind, message };
}
