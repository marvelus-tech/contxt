#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recordingPath = join(root, "samples/research-web/tavily-solar.json");

const recording = JSON.parse(await readFile(recordingPath, "utf8"));
const { TavilySearchProvider, hitsToFacts } = await import(
  join(root, "dist/pipeline/research.js")
);

const mockFetch = async (_input, init) => {
  const body = JSON.parse(init?.body ?? "{}");
  if (body.query !== recording.query) {
    console.warn(`query mismatch: expected frozen query, got ${body.query}`);
  }
  return new Response(JSON.stringify({ results: recording.results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const provider = new TavilySearchProvider("offline", mockFetch);
const hits = await provider.search(recording.query, 5);
const facts = hitsToFacts(hits, 5);
const cited = facts.filter((fact) => {
  try {
    const url = new URL(fact.sourceUrl ?? "");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
});

console.log(
  `eval:research — ${cited.length}/${facts.length} facts with valid https sources (offline recording)`,
);
if (cited.length < 2) process.exitCode = 1;