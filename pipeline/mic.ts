import { deepgramToSegments, type DeepgramTranscript } from "./words.js";
import type { TranscriptSegment } from "./types.js";

/** Browser listen socket. The grant JWT is a subprotocol, never a query param. */
export const DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen";

export type MicPhase =
  | "idle"
  | "requesting-permission"
  | "denied"
  | "no-device"
  | "insecure"
  | "connecting"
  | "live"
  | "reconnecting"
  | "token-missing"
  | "token-error"
  | "stopped"
  | "error";

export interface MicNotice {
  phase: MicPhase;
  message: string;
}

const PHASE_COPY: Record<MicPhase, string> = {
  idle: "Microphone is idle. Start it when you are ready to speak.",
  "requesting-permission": "Waiting for microphone permission.",
  denied:
    "The browser blocked the microphone. Allow microphone access for this site in the address bar, then try again.",
  "no-device": "No microphone was found. Connect one and try again.",
  insecure: "The microphone needs a secure page. Open this site over HTTPS, or on localhost.",
  connecting: "Connecting to live speech.",
  live: "Listening. Speak in full sentences.",
  reconnecting: "Connection dropped. Reconnecting.",
  "token-missing":
    "Live speech is not connected on this site yet. The microphone needs a token server before it can start.",
  "token-error":
    "The speech token server did not respond. Check the server configuration, then try again.",
  stopped: "Microphone stopped.",
  error: "The microphone could not start. Try again.",
};

export function micNotice(phase: MicPhase, message?: string): MicNotice {
  return { phase, message: message ?? PHASE_COPY[phase] };
}

export function describeMicFailure(error: { name?: string; message?: string }): MicNotice {
  const name = error.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return micNotice("denied");
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return micNotice("no-device");
  if (name === "NotReadableError" || name === "TrackStartError") {
    return micNotice("error", "The microphone is busy in another app. Close that app and try again.");
  }
  if (name === "SecurityError") return micNotice("insecure");
  if (name === "OverconstrainedError") {
    return micNotice("error", "This browser could not open a single-channel microphone. Try another browser.");
  }
  return micNotice("error");
}

/** Rejects URLs that would put a permanent key in the page or the address bar. */
export function isSafeTokenUrl(tokenUrl: string): boolean {
  const value = tokenUrl.trim();
  if (!value || value.length > 500) return false;
  if (/api[_-]?key|access_token|secret|password|bearer/i.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "http:" && local;
  } catch {
    return false;
  }
}

export interface ListenUrlOptions {
  model?: string;
  sampleRate?: number;
}

/** Query string for browser PCM. No credential belongs here. */
export function deepgramBrowserListenUrl(options: ListenUrlOptions = {}): string {
  const params = new URLSearchParams({
    model: options.model ?? "nova-3",
    language: "en",
    encoding: "linear16",
    sample_rate: String(options.sampleRate ?? 16_000),
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    vad_events: "true",
    endpointing: "300",
    utterance_end_ms: "1000",
  });
  return `${DEEPGRAM_LISTEN_URL}?${params.toString()}`;
}

/**
 * Browsers cannot set Authorization on a WebSocket. Deepgram accepts the
 * short-lived grant as the second Sec-WebSocket-Protocol value: bearer, <jwt>.
 */
export function browserListenProtocols(accessToken: string): [string, string] {
  const token = accessToken.trim();
  if (!token || token.length > 4096) throw new Error("Speech token is missing");
  if (/[\s,]/.test(token)) throw new Error("Speech token cannot travel in a WebSocket subprotocol");
  return ["bearer", token];
}

export interface ListenRead {
  kind: "partial" | "final" | "utterance_end" | "speech_started" | "ignore";
  text?: string;
  segments?: TranscriptSegment[];
}

interface ListenAlternative {
  transcript?: string;
  words?: Array<{
    word: string;
    punctuated_word?: string;
    start: number;
    end: number;
    speaker?: number;
  }>;
}

interface ListenMessage {
  type?: string;
  is_final?: boolean;
  start?: number;
  duration?: number;
  channel?: { alternatives?: ListenAlternative[] };
}

/** Partials stay on screen. Only is_final rows enter the claim pipeline. */
export function readDeepgramListenEvent(payload: unknown): ListenRead {
  let message: ListenMessage;
  try {
    message = (typeof payload === "string" ? JSON.parse(payload) : payload) as ListenMessage;
  } catch {
    return { kind: "ignore" };
  }
  if (!message || typeof message !== "object") return { kind: "ignore" };
  if (message.type === "UtteranceEnd") return { kind: "utterance_end" };
  if (message.type === "SpeechStarted") return { kind: "speech_started" };
  if (message.type !== "Results") return { kind: "ignore" };
  const alternative = message.channel?.alternatives?.[0];
  const text = (alternative?.transcript ?? "").trim();
  if (!text) return { kind: "ignore" };
  if (!message.is_final) return { kind: "partial", text };
  const wrapped: DeepgramTranscript = {
    results: { channels: [{ alternatives: [alternative ?? {}] }] },
  };
  let segments = deepgramToSegments(wrapped);
  if (segments.length === 0) {
    const startMs = Math.round(Number(message.start ?? 0) * 1000);
    const endMs = startMs + Math.round(Number(message.duration ?? 0) * 1000);
    segments = [{ startMs, endMs: endMs || startMs, text }];
  }
  return { kind: "final", text, segments };
}

/** Box-filter downsample. Matches the AudioWorklet so tests cover the same math. */
export function downsampleBox(samples: ArrayLike<number>, fromRate: number, toRate = 16_000): Float32Array {
  if (fromRate <= 0 || toRate <= 0) throw new Error("Sample rates must be positive");
  if (fromRate === toRate) return Float32Array.from(samples);
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  let bucket = 0;
  let count = 0;
  let index = 0;
  for (let i = 0; i < samples.length; i += 1) {
    bucket += samples[i] ?? 0;
    count += 1;
    if (count >= ratio) {
      if (index < out.length) out[index] = bucket / count;
      index += 1;
      bucket = 0;
      count = 0;
    }
  }
  return out.subarray(0, index);
}

export function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
}
