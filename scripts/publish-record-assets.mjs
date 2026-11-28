#!/usr/bin/env node
/**
 * Copy record page + mic bundles for GitHub Pages.
 *
 * Usage:
 *   npm run build && node scripts/publish-record-assets.mjs
 *   PAGES_RECORD_DIR=/path/to/marvelus-tech.github.io/cntxt/sessions/record node scripts/publish-record-assets.mjs
 */
import { cp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, "export/record-pages");
const outDir = process.env.PAGES_RECORD_DIR ? resolve(process.env.PAGES_RECORD_DIR) : staging;

const fromPlay = join(root, "web/play");
const fromRecord = join(root, "web/record");
const fromSession = join(root, "web/session");
const fromLive = join(root, "web/live");

const micAssets = ["mic-engine.js", "mic-worklet.js", "mic.js"];
const recordAssets = [
  "index.html",
  "record.js",
  "record.css",
  "mic-config.json",
  "mic-config.example.json",
];
const sharedAssets = [
  { src: join(fromSession, "session.css"), dest: "session.css" },
  { src: join(fromLive, "insight-workspace.js"), dest: "insight-workspace.js" },
];

for (const dir of new Set([staging, outDir])) {
  await mkdir(dir, { recursive: true });
  for (const file of micAssets) {
    await cp(join(fromPlay, file), join(dir, file));
  }
  for (const file of recordAssets) {
    await cp(join(fromRecord, file), join(dir, file));
  }
  for (const { src, dest } of sharedAssets) {
    await cp(src, join(dir, dest));
  }
}

console.log(`publish-record-assets → ${outDir}`);
if (outDir === staging) {
  console.log("Set PAGES_RECORD_DIR to sync marvelus-tech.github.io/cntxt/sessions/record/");
}