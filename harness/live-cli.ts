#!/usr/bin/env node
import { runLive, type LiveOptions } from "./live.js";

function usage(): string {
  return `Usage:
  contxt-live --fixture samples/demo.json [--speed 4]
  contxt-live recording.wav --transcriber deepgram-live

Transcribers: fixture (default for JSON), deepgram-live (default for WAV)
Researchers: fixture, live, tavily, factcheck (default fixture; live queries Google Fact Check and Tavily in parallel)`;
}

function parseArgs(args: string[]): LiveOptions {
  let inputPath: string | undefined;
  let speed = 1;
  let transcriber: LiveOptions["transcriber"];
  let cloudModel: string | undefined;
  const keyterms: string[] = [];
  let speakerHints: string[] = [];
  let researcher: LiveOptions["researcher"];

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
      transcriber = args[++index] as LiveOptions["transcriber"];
      continue;
    }
    if (argument === "--cloud-model") {
      cloudModel = args[++index];
      continue;
    }
    if (argument === "--speakers") {
      speakerHints = (args[++index] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      continue;
    }
    if (argument === "--keyterm") {
      const term = args[++index];
      if (term) keyterms.push(term);
      continue;
    }
    if (argument === "--researcher") {
      researcher = args[++index] as LiveOptions["researcher"];
      continue;
    }
    if (!argument.startsWith("-") && !inputPath) {
      inputPath = argument;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!inputPath) throw new Error("An audio file or --fixture is required");
  if (transcriber && !["fixture", "deepgram-live"].includes(transcriber)) {
    throw new Error(`Unknown transcriber: ${transcriber}`);
  }
  if (
    researcher &&
    !["fixture", "live", "tavily", "factcheck", "web", "composite"].includes(
      researcher,
    )
  ) {
    throw new Error(`Unknown researcher: ${researcher}`);
  }
  return {
    inputPath,
    speed,
    transcriber,
    ...(cloudModel ? { cloudModel } : {}),
    ...(keyterms.length ? { keyterms } : {}),
    ...(speakerHints.length ? { speakerHints } : {}),
    ...(researcher ? { researcher } : {}),
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await runLive({
    ...options,
    onSummary: (summary) => console.log(summary),
  });
  console.log(`output: ${result.runDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}