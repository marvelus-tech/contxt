#!/usr/bin/env node
/**
 * Bake a static play demo from samples/debate1992.json (fixture research, no Tavily).
 * Output: timeline.json, claims.json, deck.html, scorecard.json, meta.json, pages.json
 *
 * Usage:
 *   npm run bake:play
 *   PAGES_PLAY_DIR=/path/to/marvelus-tech.github.io/contxt/play npm run bake:play
 */
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runReplay } from "../dist/harness/replay.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "samples/debate1992.json");
const audioSrc = join(root, "samples/audio/debate1992.opus");
const staging = join(root, "export/play-demo");
const outDir = process.env.PAGES_PLAY_DIR
  ? resolve(process.env.PAGES_PLAY_DIR)
  : staging;

await mkdir(staging, { recursive: true });
if (outDir !== staging) await mkdir(outDir, { recursive: true });

const result = await runReplay({
  inputPath: fixture,
  speed: 1000,
  researcher: "fixture",
  researchFixture: "samples/research.json",
  outRoot: join(root, "export"),
  runId: "play-demo",
});

await cp(audioSrc, join(staging, "debate1992.opus"));

if (outDir !== staging) {
  const files = [
    "deck.html",
    "timeline.json",
    "claims.json",
    "scorecard.json",
    "meta.json",
    "pages.json",
  ];
  for (const file of files) {
    const src = join(staging, file);
    if (file === "meta.json" || file === "pages.json") continue;
    await cp(join(result.runDir, file), join(outDir, file));
  }
  await cp(audioSrc, join(outDir, "debate1992.opus"));
}

const meta = {
  bakedAt: new Date().toISOString(),
  fixture: "samples/debate1992.json",
  researcher: result.scorecard.researcher,
  researcherStatus: result.scorecard.researcherStatus,
  researchRequests: result.scorecard.researchRequests ?? 0,
  pagesCreated: result.scorecard.pagesCreated,
  uniqueClaims: result.scorecard.claimStats?.uniqueClaims,
  clip: "samples/debate1992.clip.json",
};

const pagesJson = `${JSON.stringify(
  result.pages.map((p) => ({
    id: p.id,
    title: p.title,
    topicId: p.topicId,
  })),
  null,
  2,
)}\n`;
const metaJson = `${JSON.stringify(meta, null, 2)}\n`;

for (const dir of new Set([staging, outDir])) {
  await writeFile(join(dir, "meta.json"), metaJson);
  await writeFile(join(dir, "pages.json"), pagesJson);
}

console.log(`bake:play → ${outDir}`);
console.log(
  `researcher=${meta.researcher} researchRequests=${meta.researchRequests} pages=${meta.pagesCreated}`,
);