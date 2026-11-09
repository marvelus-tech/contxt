import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { performance } from "node:perf_hooks";
import type {
  AudioChunk,
  TranscriptSegment,
  Transcriber,
  TranscriberStatus,
} from "./types.js";

/** One recognised word with its timing and the provider's speaker label. */
export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
}

export interface CloudTranscription {
  provider: "assemblyai" | "deepgram";
  model: string;
  segments: TranscriptSegment[];
  /** Billed or reported audio duration in milliseconds. */
  durationMs: number;
  /** Wall-clock time for upload plus processing, in milliseconds. */
  elapsedMs: number;
  raw: unknown;
}

type FetchLike = typeof fetch;

const SENTENCE_END = /[.?!]["'”’)\]]?$/;

/**
 * Groups words into sentence-sized segments. A new segment starts whenever the
 * speaker changes, so every segment has exactly one speaker.
 */
export function wordsToSegments(
  words: TimedWord[],
  minWords = 4,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TimedWord[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0]!;
    segments.push({
      startMs: first.startMs,
      endMs: current.at(-1)!.endMs,
      text: current.map((word) => word.text).join(" "),
      ...(first.speaker ? { speaker: first.speaker } : {}),
    });
    current = [];
  };
  for (const word of words) {
    if (current.length > 0 && current.at(-1)!.speaker !== word.speaker) flush();
    current.push(word);
    if (SENTENCE_END.test(word.text) && current.length >= minWords) flush();
  }
  flush();
  return segments;
}

interface AssemblyAiResponse {
  status?: string;
  error?: string;
  audio_duration?: number;
  speech_model_used?: string;
  words?: Array<{ text: string; start: number; end: number; speaker?: string | null }>;
}

export function assemblyAiToSegments(response: AssemblyAiResponse): TranscriptSegment[] {
  return wordsToSegments(
    (response.words ?? []).map((word) => ({
      text: word.text,
      startMs: word.start,
      endMs: word.end,
      ...(word.speaker ? { speaker: `Speaker ${word.speaker}` } : {}),
    })),
  );
}

interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        words?: Array<{
          word: string;
          punctuated_word?: string;
          start: number;
          end: number;
          speaker?: number;
        }>;
      }>;
    }>;
  };
}

export function deepgramToSegments(response: DeepgramResponse): TranscriptSegment[] {
  const words = response.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return wordsToSegments(
    words.map((word) => ({
      text: word.punctuated_word ?? word.word,
      startMs: Math.round(word.start * 1000),
      endMs: Math.round(word.end * 1000),
      ...(word.speaker !== undefined ? { speaker: `Speaker ${word.speaker}` } : {}),
    })),
  );
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".flac": "audio/flac",
};

function keytermsFromEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

async function failIfNotOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  const body = (await response.text()).slice(0, 300);
  throw new Error(`${provider} request failed with HTTP ${response.status}: ${body}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export interface AssemblyAiOptions {
  apiKey?: string;
  /** Defaults to ASSEMBLYAI_MODEL, then universal-3-5-pro. */
  model?: string;
  /** Optional keyterm prompting (billed as an add-on). Defaults to ASSEMBLYAI_KEYTERMS. */
  keyterms?: string[];
  baseUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export async function transcribeWithAssemblyAI(
  path: string,
  options: AssemblyAiOptions = {},
): Promise<CloudTranscription> {
  const apiKey = options.apiKey ?? process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("Missing ASSEMBLYAI_API_KEY");
  const model = options.model ?? process.env.ASSEMBLYAI_MODEL ?? "universal-3-5-pro";
  const keyterms = options.keyterms ?? keytermsFromEnv("ASSEMBLYAI_KEYTERMS");
  const baseUrl = options.baseUrl ?? "https://api.assemblyai.com";
  const doFetch = options.fetchImpl ?? fetch;
  const headers = { authorization: apiKey };
  const started = performance.now();

  const upload = await doFetch(`${baseUrl}/v2/upload`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/octet-stream" },
    body: await readFile(path),
  });
  await failIfNotOk(upload, "AssemblyAI upload");
  const { upload_url: audioUrl } = (await upload.json()) as { upload_url: string };

  const submit = await doFetch(`${baseUrl}/v2/transcript`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: [model],
      speaker_labels: true,
      language_code: "en",
      punctuate: true,
      format_text: true,
      ...(keyterms.length ? { keyterms_prompt: keyterms } : {}),
    }),
  });
  await failIfNotOk(submit, "AssemblyAI submit");
  const { id } = (await submit.json()) as { id: string };

  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  let result: AssemblyAiResponse;
  for (;;) {
    const poll = await doFetch(`${baseUrl}/v2/transcript/${id}`, { headers });
    await failIfNotOk(poll, "AssemblyAI poll");
    result = (await poll.json()) as AssemblyAiResponse;
    if (result.status === "completed") break;
    if (result.status === "error") {
      throw new Error(`AssemblyAI transcription failed: ${result.error ?? "unknown error"}`);
    }
    if (Date.now() > deadline) throw new Error("AssemblyAI transcription timed out");
    await sleep(options.pollIntervalMs ?? 3_000);
  }
  return {
    provider: "assemblyai",
    model: result.speech_model_used ?? model,
    segments: assemblyAiToSegments(result),
    durationMs: (result.audio_duration ?? 0) * 1000,
    elapsedMs: performance.now() - started,
    raw: result,
  };
}

export interface DeepgramOptions {
  apiKey?: string;
  /** Defaults to DEEPGRAM_MODEL, then nova-3. */
  model?: string;
  /** Keyterm prompting for names and jargon (nova-3, billed as an add-on). Defaults to DEEPGRAM_KEYTERMS. */
  keyterms?: string[];
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export function deepgramUrl(model: string, keyterms: string[], baseUrl = "https://api.deepgram.com"): string {
  const params = new URLSearchParams({
    model,
    language: "en",
    diarize: "true",
    smart_format: "true",
    punctuate: "true",
    utterances: "true",
  });
  for (const term of keyterms) params.append("keyterm", term);
  return `${baseUrl}/v1/listen?${params.toString()}`;
}

export async function transcribeWithDeepgram(
  path: string,
  options: DeepgramOptions = {},
): Promise<CloudTranscription> {
  const apiKey = options.apiKey ?? process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPGRAM_API_KEY");
  const model = options.model ?? process.env.DEEPGRAM_MODEL ?? "nova-3";
  const keyterms = options.keyterms ?? keytermsFromEnv("DEEPGRAM_KEYTERMS");
  const doFetch = options.fetchImpl ?? fetch;
  const started = performance.now();
  const response = await doFetch(deepgramUrl(model, keyterms, options.baseUrl), {
    method: "POST",
    headers: {
      authorization: `Token ${apiKey}`,
      "content-type": MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? "application/octet-stream",
    },
    body: await readFile(path),
  });
  await failIfNotOk(response, "Deepgram");
  const result = (await response.json()) as DeepgramResponse;
  return {
    provider: "deepgram",
    model,
    segments: deepgramToSegments(result),
    durationMs: (result.metadata?.duration ?? 0) * 1000,
    elapsedMs: performance.now() - started,
    raw: result,
  };
}

/**
 * Harness adapter. The whole file is transcribed once on the first chunk, and
 * each replay chunk then receives the segments that start inside it.
 */
export class CloudTranscriber implements Transcriber {
  private pending: Promise<CloudTranscription> | undefined;
  result: CloudTranscription | undefined;

  constructor(
    readonly id: "assemblyai" | "deepgram",
    private readonly options: AssemblyAiOptions & DeepgramOptions = {},
  ) {}

  private get envName(): string {
    return this.id === "assemblyai" ? "ASSEMBLYAI_API_KEY" : "DEEPGRAM_API_KEY";
  }

  async status(): Promise<{ status: TranscriberStatus; reason?: string }> {
    if (!this.options.apiKey && !process.env[this.envName]) {
      return { status: "skipped", reason: `Missing ${this.envName}` };
    }
    return { status: "ok" };
  }

  async transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]> {
    this.pending ??=
      this.id === "assemblyai"
        ? transcribeWithAssemblyAI(chunk.sourcePath, this.options)
        : transcribeWithDeepgram(chunk.sourcePath, this.options);
    this.result = await this.pending;
    return this.result.segments.filter(
      (segment) => segment.startMs >= chunk.startMs && segment.startMs < chunk.endMs,
    );
  }
}
