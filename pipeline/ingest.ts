import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Scorecard, TimelineEvent } from "./types.js";

/**
 * Browser/file ingest kinds for a presentation session.
 * `preloaded` is the MVP path. `file-upload` and `microphone` stay
 * typed so a later adapter can drop in without rewriting the play UI.
 */
export type PresentationIngestKind = "preloaded" | "file-upload" | "microphone";

export class IngestDeferredError extends Error {
  readonly kind: PresentationIngestKind;

  constructor(kind: PresentationIngestKind, message: string) {
    super(message);
    this.name = "IngestDeferredError";
    this.kind = kind;
  }
}

export const DEFERRED_INGEST_MESSAGE: Record<
  Exclude<PresentationIngestKind, "preloaded">,
  string
> = {
  "file-upload":
    "File upload is a deferred ingest adapter. This MVP auto-loads the 1992 debate presentation.",
  microphone:
    "Microphone capture is a deferred ingest adapter. This MVP auto-loads the 1992 debate presentation.",
};

export interface PresentationSource {
  id: string;
  kind: PresentationIngestKind;
  title: string;
  filename: string;
  durationMs: number;
  speakers: string[];
  license?: string;
  sourcePage?: string;
}

export interface PlaySessionMeta {
  id: string;
  ingest: PresentationSource;
  researcher: string;
  researcherStatus?: string;
  researchRequests: number;
  pagesCreated: number;
  uniqueClaims?: number;
  factsProposed?: number;
}

export interface LoadedPresentation {
  source: PresentationSource;
  researcher: string;
  researchRequests: number;
  pages: Page[];
  timeline: TimelineEvent[];
  scorecard?: Pick<
    Scorecard,
    "researcher" | "researchRequests" | "pagesCreated" | "factsProposed"
  >;
  session: PlaySessionMeta;
}

export interface PresentationIngestAdapter {
  readonly kind: PresentationIngestKind;
  available(): boolean;
  load(): Promise<LoadedPresentation>;
}

export function assertPublicDemoIsOffline(meta: {
  researcher?: string;
  researchRequests?: number;
}): void {
  if (meta.researcher !== "fixture") {
    throw new Error(
      `public demo researcher must be fixture, got ${meta.researcher ?? "missing"}`,
    );
  }
  if ((meta.researchRequests ?? 0) !== 0) {
    throw new Error(
      `public demo must make 0 Tavily requests, got ${meta.researchRequests}`,
    );
  }
}

/** Loads a baked play folder (session.json + pages.json + timeline.json). */
export class PreloadedPresentationAdapter implements PresentationIngestAdapter {
  readonly kind = "preloaded" as const;

  constructor(private readonly dir: string) {}

  available(): boolean {
    return true;
  }

  async load(): Promise<LoadedPresentation> {
    const session = JSON.parse(
      await readFile(join(this.dir, "session.json"), "utf8"),
    ) as PlaySessionMeta;
    const pages = JSON.parse(
      await readFile(join(this.dir, "pages.json"), "utf8"),
    ) as Page[];
    const timeline = JSON.parse(
      await readFile(join(this.dir, "timeline.json"), "utf8"),
    ) as TimelineEvent[];
    assertPublicDemoIsOffline(session);
    return {
      source: session.ingest,
      researcher: session.researcher,
      researchRequests: session.researchRequests,
      pages,
      timeline,
      session,
    };
  }
}

export class FileUploadIngestAdapter implements PresentationIngestAdapter {
  readonly kind = "file-upload" as const;

  available(): boolean {
    return false;
  }

  async load(): Promise<LoadedPresentation> {
    throw new IngestDeferredError("file-upload", DEFERRED_INGEST_MESSAGE["file-upload"]);
  }
}

export class MicrophoneIngestAdapter implements PresentationIngestAdapter {
  readonly kind = "microphone" as const;

  available(): boolean {
    return false;
  }

  async load(): Promise<LoadedPresentation> {
    throw new IngestDeferredError("microphone", DEFERRED_INGEST_MESSAGE.microphone);
  }
}

export function ingestAdapterFor(
  kind: PresentationIngestKind,
  preloadedDir?: string,
): PresentationIngestAdapter {
  if (kind === "preloaded") {
    if (!preloadedDir) {
      throw new Error("preloaded ingest needs a baked play directory");
    }
    return new PreloadedPresentationAdapter(preloadedDir);
  }
  if (kind === "file-upload") return new FileUploadIngestAdapter();
  return new MicrophoneIngestAdapter();
}
