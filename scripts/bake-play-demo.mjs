#!/usr/bin/env node
/**
 * Bake a static play demo from samples/debate1992.json.
 * Fixture research first, then offline keyword context. Never Tavily.
 *
 * Usage:
 *   npm run bake:play
 *   PAGES_PLAY_DIR=/path/to/marvelus-tech.github.io/contxt/play npm run bake:play
 */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createOfflineDemoResearcher } from "../dist/pipeline/context-research.js";
import { FixtureResearcher } from "../dist/pipeline/stages.js";
import { runReplay } from "../dist/harness/replay.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "samples/debate1992.json");
const audioSrc = join(root, "samples/audio/debate1992.opus");
const clipPath = join(root, "samples/debate1992.clip.json");
const uiDir = join(root, "web/play");
const staging = join(root, "export/play-demo");
const outDir = process.env.PAGES_PLAY_DIR
  ? resolve(process.env.PAGES_PLAY_DIR)
  : staging;

await mkdir(staging, { recursive: true });
if (outDir !== staging) await mkdir(outDir, { recursive: true });

const fixtureResearcher = await FixtureResearcher.fromFile(
  join(root, "samples/research.json"),
);
const researcher = await createOfflineDemoResearcher({
  fixture: fixtureResearcher,
  contextPath: join(root, "samples/research-context.json"),
});

const result = await runReplay({
  inputPath: fixture,
  speed: 1000,
  researcher: "fixture",
  researchFixture: "samples/research.json",
  outRoot: join(root, "export"),
  runId: "play-demo",
  stages: { researcher },
});

if (result.scorecard.researcher !== "fixture") {
  throw new Error(
    `play demo researcher must be fixture, got ${result.scorecard.researcher}`,
  );
}
if ((result.scorecard.researchRequests ?? 0) !== 0) {
  throw new Error(
    `play demo must make 0 Tavily requests, got ${result.scorecard.researchRequests}`,
  );
}

const clip = JSON.parse(await readFile(clipPath, "utf8"));
const session = {
  id: "debate1992",
  ingest: {
    id: "debate1992",
    kind: "preloaded",
    title: clip.title,
    filename: "debate1992.opus",
    durationMs: clip.durationMs,
    speakers: clip.speakers,
    license: "Public domain",
    sourcePage: clip.sourcePage,
  },
  researcher: result.scorecard.researcher,
  researcherStatus: result.scorecard.researcherStatus,
  researchRequests: result.scorecard.researchRequests ?? 0,
  pagesCreated: result.scorecard.pagesCreated,
  uniqueClaims: result.scorecard.claimStats?.uniqueClaims,
  factsProposed: result.scorecard.factsProposed,
};

const pagesJson = `${JSON.stringify(result.pages, null, 2)}\n`;
const meta = {
  bakedAt: new Date().toISOString(),
  fixture: "samples/debate1992.json",
  researcher: result.scorecard.researcher,
  researcherStatus: result.scorecard.researcherStatus,
  researchRequests: result.scorecard.researchRequests ?? 0,
  pagesCreated: result.scorecard.pagesCreated,
  uniqueClaims: result.scorecard.claimStats?.uniqueClaims,
  factsProposed: result.scorecard.factsProposed,
  clip: "samples/debate1992.clip.json",
  ingest: "preloaded",
};
const metaJson = `${JSON.stringify(meta, null, 2)}\n`;
const sessionJson = `${JSON.stringify(session, null, 2)}\n`;

const artifactNames = [
  "deck.html",
  "timeline.json",
  "claims.json",
  "scorecard.json",
];
const uiNames = [
  "index.html",
  "play.css",
  "play.js",
  "ingest.js",
  "mic.js",
  "mic-engine.js",
  "mic-worklet.js",
  "mic-config.json",
];

for (const dir of new Set([staging, outDir])) {
  await mkdir(dir, { recursive: true });
  for (const file of artifactNames) {
    const src = join(result.runDir, file);
    const dest = join(dir, file);
    if (src !== dest) await cp(src, dest);
  }
  await cp(audioSrc, join(dir, "debate1992.opus"));
  for (const file of uiNames) {
    await cp(join(uiDir, file), join(dir, file));
  }
  await writeFile(join(dir, "meta.json"), metaJson);
  await writeFile(join(dir, "pages.json"), pagesJson);
  await writeFile(join(dir, "session.json"), sessionJson);
}

console.log(`bake:play → ${outDir}`);
console.log(
  `researcher=${meta.researcher} researchRequests=${meta.researchRequests} pages=${meta.pagesCreated} factsProposed=${meta.factsProposed}`,
);
