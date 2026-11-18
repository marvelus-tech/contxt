import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CHUNK_MS = 1_500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function fixtureDuration(path: string): Promise<number> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    segments?: Array<{ endMs: number }>;
  };
  return Math.max(0, ...(parsed.segments ?? []).map((segment) => segment.endMs));
}

export async function wavDuration(path: string): Promise<number> {
  const data = await readFile(path);
  if (
    data.length < 12 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Invalid WAV file");
  }
  let byteRate = 0;
  let audioBytes = 0;
  for (let offset = 12; offset + 8 <= data.length; ) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > data.length) throw new Error("Invalid WAV chunk");
    if (id === "fmt " && size >= 16) byteRate = data.readUInt32LE(body + 8);
    if (id === "data") audioBytes += size;
    offset = body + size + (size % 2);
  }
  if (!byteRate || !audioBytes) {
    throw new Error("WAV duration metadata is missing");
  }
  return (audioBytes / byteRate) * 1_000;
}

export async function mediaDuration(path: string): Promise<number> {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return fixtureDuration(path);
  if (extension === ".wav") return wavDuration(path);
  if ([".mp3", ".opus", ".ogg", ".webm", ".m4a", ".flac"].includes(extension)) {
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
      ]);
      return Number.parseFloat(stdout) * 1_000;
    } catch {
      throw new Error(
        `${extension.slice(1).toUpperCase()} input needs ffprobe to determine duration`,
      );
    }
  }
  throw new Error(
    "Input must be a WAV, MP3, Opus, OGG, WebM, M4A or FLAC file, or a transcript JSON file",
  );
}

export function runIdentifier(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${stamp}-${Math.random().toString(16).slice(2, 6)}`;
}