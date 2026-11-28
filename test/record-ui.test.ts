import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function readRecord(name: string): Promise<string> {
  return readFile(resolve(name), "utf8");
}

test("record page has unique SEO, no em dashes, and flat deploy imports", async () => {
  const html = await readRecord("web/record/index.html");
  assert.equal(html.includes("\u2014") || html.includes("\u2013"), false);
  const desc = html.match(/name="description" content="([^"]+)"/)?.[1] ?? "";
  assert.ok(desc.length >= 100 && desc.length <= 160, `description length ${desc.length}`);
  assert.match(html, /id="workspace"/);
  assert.match(html, /id="insight-stage"/);
  assert.match(html, /href="session\.css"/);
  assert.match(html, /id="btn-mic"/);
  assert.doesNotMatch(html, /deck\.html/);

  const recordJs = await readRecord("web/record/record.js");
  assert.match(recordJs, /createInsightWorkspace/);
  assert.match(recordJs, /onSnapshot/);
  assert.match(recordJs, /mode:\s*"live"/);

  const workspace = await readRecord("web/live/insight-workspace.js");
  assert.match(workspace, /applySnapshot/);
  assert.match(workspace, /present-link/);
});