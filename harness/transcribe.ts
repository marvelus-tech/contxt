#!/usr/bin/env node
// Transcribe one audio file with a cloud provider and write a harness fixture.
//
//   npm run transcribe -- samples/audio/debate1992.opus --provider assemblyai \
//     --out out/debate1992.assemblyai.json --raw out/debate1992.assemblyai.raw.json
//
// Keys come from ASSEMBLYAI_API_KEY or DEEPGRAM_API_KEY. They are never printed.
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  transcribeWithAssemblyAI,
  transcribeWithDeepgram,
  type CloudTranscription,
} from "../pipeline/cloud.js";

function usage(): string {
  return `Usage:
  contxt-transcribe <audio> --provider assemblyai|deepgram --out fixture.json
    [--raw raw.json] [--model name] [--keyterm term ...]`;
}

const args = process.argv.slice(2);
let input: string | undefined;
let provider: "assemblyai" | "deepgram" | undefined;
let out: string | undefined;
let raw: string | undefined;
let model: string | undefined;
const keyterms: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]!;
  if (argument === "--provider") provider = args[++index] as typeof provider;
  else if (argument === "--out") out = args[++index];
  else if (argument === "--raw") raw = args[++index];
  else if (argument === "--model") model = args[++index];
  else if (argument === "--keyterm") keyterms.push(args[++index] ?? "");
  else if (argument === "--help" || argument === "-h") {
    console.log(usage());
    process.exit(0);
  } else if (!argument.startsWith("-") && !input) input = argument;
  else {
    console.error(`Unknown argument: ${argument}\n${usage()}`);
    process.exit(1);
  }
}
if (!input || !out || (provider !== "assemblyai" && provider !== "deepgram")) {
  console.error(usage());
  process.exit(1);
}

const options = {
  ...(model ? { model } : {}),
  ...(keyterms.filter(Boolean).length ? { keyterms: keyterms.filter(Boolean) } : {}),
};
try {
  const result: CloudTranscription =
    provider === "assemblyai"
      ? await transcribeWithAssemblyAI(input, options)
      : await transcribeWithDeepgram(input, options);
  const speakers = [...new Set(result.segments.map((segment) => segment.speaker).filter(Boolean))].map(
    (id) => ({ id, name: id }),
  );
  const fixture = {
    meta: {
      source: basename(input),
      provider: result.provider,
      model: result.model,
      durationMs: result.durationMs,
      elapsedMs: Math.round(result.elapsedMs),
      createdAt: new Date().toISOString(),
    },
    speakers,
    segments: result.segments,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(fixture, null, 1)}\n`);
  if (raw) {
    await mkdir(dirname(raw), { recursive: true });
    await writeFile(raw, `${JSON.stringify(result.raw)}\n`);
  }
  console.log(
    `${result.provider} ${result.model}: ${result.segments.length} segments, ${speakers.length} speakers, ` +
      `${(result.durationMs / 1000).toFixed(1)} s audio in ${(result.elapsedMs / 1000).toFixed(1)} s`,
  );
  console.log(`fixture: ${out}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
