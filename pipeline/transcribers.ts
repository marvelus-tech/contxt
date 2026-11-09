import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CloudTranscriber } from "./cloud.js";
import type {
  AudioChunk,
  TranscriptSegment,
  Transcriber,
  TranscriberStatus,
} from "./types.js";

const execFileAsync = promisify(execFile);

interface FixtureFile {
  segments: Array<TranscriptSegment & { speakerLabel?: string }>;
  speakers?: Array<{ id: string; name?: string }>;
}

export class FixtureTranscriber implements Transcriber {
  readonly id = "fixture";
  private constructor(private readonly segments: TranscriptSegment[]) {}

  static async fromFile(path: string): Promise<FixtureTranscriber> {
    const parsed = JSON.parse(await readFile(path, "utf8")) as FixtureFile;
    if (!Array.isArray(parsed.segments)) {
      throw new Error("Fixture must contain a segments array");
    }
    // Optional speakers[] maps a segment's speaker id to a display name.
    const names = new Map(
      (parsed.speakers ?? []).map((speaker) => [speaker.id, speaker.name ?? speaker.id]),
    );
    return new FixtureTranscriber(
      parsed.segments.map((segment) => ({
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        ...(segment.speaker
          ? { speaker: names.get(segment.speaker) ?? segment.speaker }
          : {}),
      })),
    );
  }

  async status(): Promise<{ status: TranscriberStatus }> {
    return { status: "ok" };
  }

  async transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]> {
    return this.segments.filter(
      (segment) =>
        segment.startMs >= chunk.startMs && segment.startMs < chunk.endMs,
    );
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--help"], { timeout: 5_000 });
    return true;
  } catch (error) {
    const candidate = error as { stdout?: string; stderr?: string; code?: string };
    return Boolean(candidate.stdout || candidate.stderr) && candidate.code !== "ENOENT";
  }
}

export class LocalWhisperTranscriber implements Transcriber {
  readonly id = "local-whisper";
  private command: "whisper-cli" | "faster-whisper" | undefined;

  constructor(
    private readonly modelPath =
      process.env.WHISPER_MODEL ?? "models/ggml-base.en.bin",
  ) {}

  async status(): Promise<{ status: TranscriberStatus; reason?: string }> {
    if (await commandExists(process.env.WHISPER_BIN ?? "whisper-cli")) {
      this.command = "whisper-cli";
      return { status: "ok" };
    }
    if (await commandExists("faster-whisper")) {
      this.command = "faster-whisper";
      return { status: "ok" };
    }
    return {
      status: "skipped",
      reason:
        "No local Whisper CLI found. Install whisper-cli or faster-whisper, or use a fixture.",
    };
  }

  async transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]> {
    if (this.command === "faster-whisper") {
      return this.runFasterWhisper(chunk);
    }
    if (this.command !== "whisper-cli") return [];

    const directory = await mkdtemp(join(tmpdir(), "contxt-whisper-"));
    const output = join(directory, "chunk");
    try {
      await execFileAsync(process.env.WHISPER_BIN ?? "whisper-cli", [
        "-m",
        this.modelPath,
        "-f",
        chunk.sourcePath,
        "-oj",
        "-of",
        output,
        "-np",
        "--offset-t",
        String(chunk.startMs),
        "--duration",
        String(chunk.endMs - chunk.startMs),
      ]);
      const parsed = JSON.parse(await readFile(`${output}.json`, "utf8")) as {
        transcription?: Array<{
          text: string;
          offsets?: { from: number; to: number };
        }>;
      };
      return (parsed.transcription ?? []).map((segment) => ({
        startMs: segment.offsets?.from ?? chunk.startMs,
        endMs: segment.offsets?.to ?? chunk.endMs,
        text: segment.text.trim(),
      }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async runFasterWhisper(
    chunk: AudioChunk,
  ): Promise<TranscriptSegment[]> {
    const { stdout } = await execFileAsync("faster-whisper", [
      chunk.sourcePath,
      "--output_format",
      "json",
      "--offset",
      String(chunk.startMs / 1000),
      "--duration",
      String((chunk.endMs - chunk.startMs) / 1000),
    ]);
    const parsed = JSON.parse(stdout) as {
      segments?: Array<{ start: number; end: number; text: string }>;
    };
    return (parsed.segments ?? []).map((segment) => ({
      startMs: chunk.startMs + segment.start * 1000,
      endMs: chunk.startMs + segment.end * 1000,
      text: segment.text.trim(),
    }));
  }
}

export async function createTranscriber(
  kind: "fixture" | "whisper" | "assemblyai" | "deepgram",
  inputPath: string,
  modelPath?: string,
  cloud: { model?: string; keyterms?: string[] } = {},
): Promise<Transcriber> {
  if (kind === "fixture") return FixtureTranscriber.fromFile(inputPath);
  if (kind === "assemblyai") {
    return new CloudTranscriber("assemblyai", cloud);
  }
  if (kind === "deepgram") {
    return new CloudTranscriber("deepgram", cloud);
  }
  return new LocalWhisperTranscriber(modelPath);
}
