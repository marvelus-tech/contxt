import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const files = [
  "web/play/index.html",
  "web/play/play.js",
  "web/play/ingest.js",
  "web/play/play.css",
];

async function readPlay(name: string): Promise<string> {
  return readFile(resolve(name), "utf8");
}

test("play UI has unique SEO tags, no em dashes, and registered routes", async () => {
  const html = await readPlay("web/play/index.html");
  assert.equal(html.includes("\u2014") || html.includes("\u2013"), false);
  assert.match(html, /rel="canonical" href="https:\/\/marvelus-tech\.github\.io\/contxt\/play\/"/);
  const desc = html.match(/name="description" content="([^"]+)"/)?.[1] ?? "";
  assert.ok(desc.length >= 110 && desc.length <= 160, `description length ${desc.length}`);
  const titles = [...html.matchAll(/<title>([^<]+)<\/title>/g)].map((match) => match[1]);
  assert.equal(titles.length, 1);
  assert.match(html, /href="\/contxt\/"/);
  assert.match(html, /href="\/contxt\/play\/deck\.html"/);
  assert.match(html, /href="\/"/);
  assert.match(html, /id="workspace"/);
  assert.match(html, /id="processing"/);
  assert.match(html, /Upload recording/);
  assert.match(html, /Use microphone/);
  assert.match(html, /id="btn-debate"/);
  assert.match(html, /src="play\.js"/);
  assert.match(html, /href="play\.css"/);
  for (const asset of ["play.js", "play.css", "ingest.js", "mic.js", "mic-engine.js", "mic-worklet.js", "mic-config.json"]) {
    await readPlay(`web/play/${asset}`);
  }
});

test("play scripts keep file upload deferred and the microphone off the permanent key", async () => {
  const all = (await Promise.all(files.map(readPlay))).join("\n");
  assert.equal(all.includes("\u2014") || all.includes("\u2013"), false);
  assert.match(all, /file-upload/);
  assert.match(all, /microphone/);
  assert.match(all, /researchRequests/);
  assert.match(all, /deferred/);
  assert.doesNotMatch(all, /api\.tavily\.com/);
  assert.doesNotMatch(all, /TAVILY_API_KEY/);
  assert.doesNotMatch(all, /DEEPGRAM_API_KEY/);
  assert.doesNotMatch(all, /\/v1\/auth\/grant/);
});
