#!/usr/bin/env node
import { runReplay, type ReplayOptions } from "./replay.js";

function usage(): string {
  return `Usage:
  contxt-replay --fixture samples/demo.json [--speed 4]
  contxt-replay recording.wav [--speed 4] [--transcriber whisper]
  contxt-replay recording.mp3 --transcriber assemblyai

Transcribers: fixture, whisper, assemblyai, deepgram`;
}

function parseArgs(args: string[]): ReplayOptions {
  let inputPath: string | undefined;
  let speed = 1;
  let transcriber: ReplayOptions["transcriber"];
  let modelPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--fixture") {
      inputPath = args[++index];
      transcriber = "fixture";
      continue;
    }
    if (argument === "--speed") {
      speed = Number(args[++index]);
      continue;
    }
    if (argument === "--transcriber") {
      transcriber = args[++index] as ReplayOptions["transcriber"];
      continue;
    }
    if (argument === "--model") {
      modelPath = args[++index];
      continue;
    }
    if (!argument.startsWith("-") && !inputPath) {
      inputPath = argument;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!inputPath) throw new Error("An audio file or --fixture is required");
  if (
    transcriber &&
    !["fixture", "whisper", "assemblyai", "deepgram"].includes(transcriber)
  ) {
    throw new Error(`Unknown transcriber: ${transcriber}`);
  }
  return { inputPath, speed, transcriber, modelPath };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await runReplay({
    ...options,
    onSummary: (summary) => console.log(summary),
  });
  console.log(`output: ${result.runDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}
