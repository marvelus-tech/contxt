import { readFile as readFileAsync } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { CHUNK_MS, fixtureDuration, sleep, wavDuration } from "../harness/media.js";
import { FixtureTranscriber } from "./transcribers.js";
import {
  deepgramToSegments,
  deepgramUrl,
  type DeepgramOptions,
} from "./cloud.js";
import { applySpeakerNames, nameSpeakers } from "./speakers.js";
import type { IngestBatch, TranscriptSegment, TranscriberStatus } from "./types.js";

export interface SegmentSource {
  readonly id: string;
  status(): Promise<{ status: TranscriberStatus; reason?: string }>;
  durationMs(): Promise<number>;
  batches(speed: number): AsyncIterable<IngestBatch>;
}

export interface FixtureLiveOptions {
  path: string;
  chunkMs?: number;
  speakerHints?: string[];
}

/** Feeds transcript segments on a wall-clock schedule aligned to CHUNK_MS media windows. */
export class FixtureLiveSource implements SegmentSource {
  readonly id = "fixture";
  private readonly path: string;
  private readonly fixture: FixtureTranscriber;
  private readonly duration: number;
  private readonly chunkMs: number;

  private constructor(
    path: string,
    fixture: FixtureTranscriber,
    durationMs: number,
    chunkMs: number,
  ) {
    this.path = path;
    this.fixture = fixture;
    this.duration = durationMs;
    this.chunkMs = chunkMs;
  }

  static async open(options: FixtureLiveOptions): Promise<FixtureLiveSource> {
    const fixture = await FixtureTranscriber.fromFile(
      options.path,
      options.speakerHints ?? [],
    );
    const durationMs = await fixtureDuration(options.path);
    return new FixtureLiveSource(
      options.path,
      fixture,
      durationMs,
      options.chunkMs ?? CHUNK_MS,
    );
  }

  async status(): Promise<{ status: TranscriberStatus }> {
    return { status: "ok" };
  }

  async durationMs(): Promise<number> {
    return this.duration;
  }

  async *batches(speed: number): AsyncIterable<IngestBatch> {
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error("Speed must be a finite number greater than zero");
    }
    const started = performance.now();
    const chunkCount = Math.ceil(this.duration / this.chunkMs);
    for (let index = 0; index < chunkCount; index += 1) {
      const startMs = index * this.chunkMs;
      const endMs = Math.min(this.duration, startMs + this.chunkMs);
      const targetElapsedMs = startMs / speed;
      const remainingDelayMs = targetElapsedMs - (performance.now() - started);
      if (remainingDelayMs > 0) await sleep(remainingDelayMs);
      const segments = await this.fixture.transcribe({
        index,
        startMs,
        endMs,
        sourcePath: this.path,
      });
      yield { index, startMs, endMs, segments };
    }
  }
}

export interface DeepgramLiveWebSocket {
  connect(url: string, headers: Record<string, string>): Promise<void>;
  send(data: string | Buffer): Promise<void>;
  close(): Promise<void>;
  onMessage(handler: (data: string | Buffer) => void): void;
  onError(handler: (error: Error) => void): void;
}

export class NodeDeepgramWebSocket implements DeepgramLiveWebSocket {
  private socket: import("ws").WebSocket | undefined;
  private messageHandler: ((data: string | Buffer) => void) | undefined;
  private errorHandler: ((error: Error) => void) | undefined;

  async connect(url: string, headers: Record<string, string>): Promise<void> {
    const { default: WS } = await import("ws");
    await new Promise<void>((resolve, reject) => {
      const socket = new WS(url, { headers });
      this.socket = socket;
      socket.once("open", () => resolve());
      socket.once("error", (error) => reject(error));
      socket.on("message", (payload) => {
        if (typeof payload === "string" || Buffer.isBuffer(payload)) {
          this.messageHandler?.(payload);
        }
      });
      socket.on("error", (error) => this.errorHandler?.(error));
    });
  }

  async send(data: string | Buffer): Promise<void> {
    this.socket?.send(data);
  }

  async close(): Promise<void> {
    this.socket?.close();
    this.socket = undefined;
  }

  onMessage(handler: (data: string | Buffer) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
}

export interface DeepgramLiveOptions extends DeepgramOptions {
  apiKey?: string;
  speakerHints?: string[];
  chunkMs?: number;
  /** Milliseconds of audio per websocket frame (default 100). */
  frameMs?: number;
  webSocket?: DeepgramLiveWebSocket;
  /** Fixed media duration for tests (skips reading WAV). */
  mockDurationMs?: number;
  /** Inject transcripts for tests without a network. */
  mockHandler?: (
    emit: (payload: unknown) => void,
    audioDurationMs: number,
  ) => Promise<void>;
}

interface DeepgramLiveMessage {
  type?: string;
  channel?: {
    alternatives?: Array<{ words?: Array<{
      word: string;
      punctuated_word?: string;
      start: number;
      end: number;
      speaker?: number;
    }> }>;
  };
  metadata?: { duration?: number };
}

function pcmFromWav(buffer: Buffer): { samples: Buffer; sampleRate: number; channels: number } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF") throw new Error("Invalid WAV file");
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioOffset = 0;
  let audioSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && size >= 16) {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    }
    if (id === "data") {
      audioOffset = body;
      audioSize = size;
    }
    offset = body + size + (size % 2);
  }
  if (!sampleRate || !audioSize || bitsPerSample !== 16) {
    throw new Error("Deepgram live streaming requires 16-bit PCM WAV");
  }
  return {
    samples: buffer.subarray(audioOffset, audioOffset + audioSize),
    sampleRate,
    channels,
  };
}

/** Streams a WAV file to Deepgram listen WebSocket at ~1x wall clock (divided by speed). */
export class DeepgramLiveSource implements SegmentSource {
  readonly id = "deepgram-live";
  private readonly path: string;
  private readonly options: DeepgramLiveOptions;
  private readonly chunkMs: number;

  constructor(path: string, options: DeepgramLiveOptions = {}) {
    this.path = path;
    this.options = options;
    this.chunkMs = options.chunkMs ?? CHUNK_MS;
  }

  async status(): Promise<{ status: TranscriberStatus; reason?: string }> {
    if (!this.options.apiKey && !process.env.DEEPGRAM_API_KEY) {
      return { status: "skipped", reason: "Missing DEEPGRAM_API_KEY" };
    }
    return { status: "ok" };
  }

  async durationMs(): Promise<number> {
    if (this.options.mockDurationMs !== undefined) return this.options.mockDurationMs;
    return wavDuration(this.path);
  }

  async *batches(speed: number): AsyncIterable<IngestBatch> {
    const availability = await this.status();
    if (availability.status !== "ok") return;

    const apiKey = this.options.apiKey ?? process.env.DEEPGRAM_API_KEY!;
    const model = this.options.model ?? process.env.DEEPGRAM_MODEL ?? "nova-3";
    const keyterms = this.options.keyterms ?? [];
    const ws = this.options.webSocket ?? new NodeDeepgramWebSocket();
    const url = deepgramUrl(model, keyterms, this.options.baseUrl ?? "https://api.deepgram.com").replace(
      "https://",
      "wss://",
    );

    const pendingSegments: TranscriptSegment[] = [];
    const ingestMessage = (raw: string | Buffer): void => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const message = JSON.parse(text) as DeepgramLiveMessage;
      if (message.type !== "Results" || !message.channel?.alternatives?.[0]) return;
      const batch = deepgramToSegments({
        results: { channels: [{ alternatives: [message.channel.alternatives[0]] }] },
      });
      pendingSegments.push(...batch);
    };
    ws.onMessage(ingestMessage);

    let durationMs = await this.durationMs();
    if (this.options.mockHandler) {
      await ws.connect(url, { authorization: `Token ${apiKey}` });
      await this.options.mockHandler(
        (payload) => ingestMessage(JSON.stringify(payload)),
        durationMs,
      );
      await ws.close();
    } else {
      const wav = await readFileAsync(this.path);
      const { samples, sampleRate, channels } = pcmFromWav(wav);
      durationMs = (samples.length / (sampleRate * channels * 2)) * 1_000;
      const bytesPerMs = (sampleRate * channels * 2) / 1_000;
      const frameMs = this.options.frameMs ?? 100;
      const errors: Error[] = [];
      ws.onError((error) => errors.push(error));

      await ws.connect(url, { authorization: `Token ${apiKey}` });
      const started = performance.now();
      for (let offsetMs = 0; offsetMs < durationMs; offsetMs += frameMs) {
        const targetElapsed = offsetMs / speed;
        const delay = targetElapsed - (performance.now() - started);
        if (delay > 0) await sleep(delay);
        const byteOffset = Math.floor(offsetMs * bytesPerMs);
        const byteEnd = Math.min(samples.length, Math.floor((offsetMs + frameMs) * bytesPerMs));
        if (byteEnd > byteOffset) {
          await ws.send(samples.subarray(byteOffset, byteEnd));
        }
      }
      await ws.send(JSON.stringify({ type: "CloseStream" }));
      await ws.close();
      if (errors.length) throw errors[0]!;
    }

    let named = pendingSegments;
    if (this.options.speakerHints?.length) {
      const naming = nameSpeakers(pendingSegments, { hints: this.options.speakerHints });
      named = applySpeakerNames(pendingSegments, naming);
    }

    const chunkCount = Math.ceil(durationMs / this.chunkMs);
    for (let index = 0; index < chunkCount; index += 1) {
      const startMs = index * this.chunkMs;
      const endMs = Math.min(durationMs, startMs + this.chunkMs);
      const segments = named.filter(
        (segment) => segment.startMs >= startMs && segment.startMs < endMs,
      );
      yield { index, startMs, endMs, segments };
    }
  }
}

export async function createLiveSource(
  inputPath: string,
  transcriber: "fixture" | "deepgram-live",
  options: {
    chunkMs?: number;
    speakerHints?: string[];
    deepgram?: DeepgramLiveOptions;
  } = {},
): Promise<SegmentSource> {
  if (transcriber === "fixture") {
    return FixtureLiveSource.open({
      path: inputPath,
      chunkMs: options.chunkMs,
      speakerHints: options.speakerHints,
    });
  }
  return new DeepgramLiveSource(inputPath, {
    ...options.deepgram,
    speakerHints: options.speakerHints,
    chunkMs: options.chunkMs,
  });
}