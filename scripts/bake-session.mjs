#!/usr/bin/env node
/**
 * Bake a static CNTXT session into github.io cntxt/sessions/<slug>/.
 * Updates cntxt/sessions/sessions.json manifest when writing to a Pages checkout.
 *
 * Usage:
 *   npm run build && npm run bake:session -- --slug my-talk --title "My talk"
 *   npm run bake:session -- --slug 1992-debate --fixture samples/debate1992.json \\
 *     --audio samples/audio/debate1992.opus --clip samples/debate1992.clip.json
 *
 * Env:
 *   PAGES_ROOT  default ../marvelus-tech.github.io/cntxt
 *
 * Baked sessions assume Pages layout: sessions/<slug>/ with ../../shared.css on github.io.
 */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createOfflineDemoResearcher } from "../dist/pipeline/context-research.js";
import { FixtureResearcher } from "../dist/pipeline/stages.js";
import { runReplay } from "../dist/harness/replay.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = join(root, "web/session");

function parseArgs(argv) {
  const out = {
    slug: "",
    title: "",
    fixture: join(root, "samples/debate1992.json"),
    audio: join(root, "samples/audio/debate1992.opus"),
    clip: join(root, "samples/debate1992.clip.json"),
    kind: "session",
    audioName: "audio.opus",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--slug") out.slug = argv[++i] ?? "";
    else if (a === "--title") out.title = argv[++i] ?? "";
    else if (a === "--fixture") out.fixture = resolve(argv[++i] ?? "");
    else if (a === "--audio") out.audio = resolve(argv[++i] ?? "");
    else if (a === "--clip") out.clip = resolve(argv[++i] ?? "");
    else if (a === "--kind") out.kind = argv[++i] ?? "session";
    else if (a === "--audio-name") out.audioName = argv[++i] ?? "audio.opus";
    else if (a === "--help" || a === "-h") {
      console.log(`bake-session: --slug <id> --title "..." [--fixture] [--audio] [--clip]`);
      process.exit(0);
    }
  }
  if (!out.slug) throw new Error("--slug is required");
  if (!out.title) throw new Error("--title is required");
  return out;
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function durationLabel(ms) {
  const total = Math.round(Number(ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes} min ${String(seconds).padStart(2, "0")} sec`;
}

const args = parseArgs(process.argv);
const pagesRoot = resolve(
  process.env.PAGES_ROOT ?? join(root, "../marvelus-tech.github.io/cntxt"),
);
const sessionDir = join(pagesRoot, "sessions", args.slug);
const manifestPath = join(pagesRoot, "sessions", "sessions.json");

await mkdir(sessionDir, { recursive: true });

const fixtureResearcher = await FixtureResearcher.fromFile(
  join(root, "samples/research.json"),
);
const researcher = await createOfflineDemoResearcher({
  fixture: fixtureResearcher,
  contextPath: join(root, "samples/research-context.json"),
});

const result = await runReplay({
  inputPath: args.fixture,
  speed: 1000,
  researcher: "fixture",
  researchFixture: "samples/research.json",
  outRoot: join(root, "export"),
  runId: `session-${args.slug}`,
  stages: { researcher },
});

const clip = JSON.parse(await readFile(args.clip, "utf8"));
const durationMs = clip.durationMs;
if (!durationMs) throw new Error("clip JSON must include durationMs");

const session = {
  id: slugify(args.slug),
  ingest: {
    id: slugify(args.slug),
    kind: "preloaded",
    title: args.title,
    filename: args.audioName,
    durationMs,
    speakers: clip.speakers ?? [],
    license: clip.license ?? "",
    sourcePage: clip.sourcePage ?? "",
  },
  researcher: result.scorecard.researcher,
  researcherStatus: result.scorecard.researcherStatus,
  researchRequests: result.scorecard.researchRequests ?? 0,
  pagesCreated: result.scorecard.pagesCreated,
  uniqueClaims: result.scorecard.claimStats?.uniqueClaims,
  factsProposed: result.scorecard.factsProposed,
};

const meta = {
  bakedAt: new Date().toISOString(),
  fixture: args.fixture.replace(`${root}/`, ""),
  researcher: result.scorecard.researcher,
  researcherStatus: result.scorecard.researcherStatus,
  researchRequests: result.scorecard.researchRequests ?? 0,
  pagesCreated: result.scorecard.pagesCreated,
  uniqueClaims: result.scorecard.claimStats?.uniqueClaims,
  factsProposed: result.scorecard.factsProposed,
  clip: args.clip.replace(`${root}/`, ""),
  ingest: "preloaded",
  slug: args.slug,
};

const artifactNames = ["deck.html", "timeline.json", "claims.json", "scorecard.json"];
const uiNames = ["index.html", "session.css", "session.js", "ingest.js", "README.txt"];

for (const file of artifactNames) {
  await cp(join(result.runDir, file), join(sessionDir, file));
}
await cp(args.audio, join(sessionDir, args.audioName));

for (const file of uiNames) {
  const src = join(templateDir, file);
  try {
    await cp(src, join(sessionDir, file));
  } catch {
  }
}

await writeFile(join(sessionDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
await writeFile(join(sessionDir, "pages.json"), `${JSON.stringify(result.pages, null, 2)}\n`);
await writeFile(join(sessionDir, "session.json"), `${JSON.stringify(session, null, 2)}\n`);

let manifest = [];
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest)) manifest = [];
} catch {
  manifest = [];
}

const entry = {
  slug: args.slug,
  title: args.title,
  kind: args.kind,
  durationLabel: durationLabel(durationMs),
  topicCount: result.pages.length,
  href: `./${args.slug}/`,
};

const idx = manifest.findIndex((row) => row.slug === args.slug);
if (idx >= 0) manifest[idx] = entry;
else manifest.push(entry);

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`bake:session → ${sessionDir}`);
console.log(`manifest → ${manifestPath}`);
console.log(
  `pages=${result.pages.length} researcher=${meta.researcher} requests=${meta.researchRequests}`,
);