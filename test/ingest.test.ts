import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FileUploadIngestAdapter,
  IngestDeferredError,
  MicrophoneBrowserError,
  MicrophoneIngestAdapter,
  PreloadedPresentationAdapter,
  assertPublicDemoIsOffline,
  ingestAdapterFor,
} from "../pipeline/ingest.js";

test("preloaded adapter loads a baked session and rejects Tavily", async () => {
  const dir = await mkdtemp(join(tmpdir(), "contxt-ingest-"));
  try {
    const session = {
      id: "debate1992",
      ingest: {
        id: "debate1992",
        kind: "preloaded",
        title: "Test debate",
        filename: "debate1992.opus",
        durationMs: 1000,
        speakers: ["A"],
      },
      researcher: "fixture",
      researchRequests: 0,
      pagesCreated: 1,
    };
    await writeFile(join(dir, "session.json"), JSON.stringify(session));
    await writeFile(
      join(dir, "pages.json"),
      JSON.stringify([
        {
          id: "page-topic-1",
          topicId: "topic-1",
          title: "Debt",
          currentClaim: "The debt is $4 trillion.",
          claims: [],
          facts: [
            {
              text: "Gross federal debt was about $4 trillion during 1992.",
              sourceUrl: "https://fred.stlouisfed.org/series/GFDEBTN",
            },
          ],
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]),
    );
    await writeFile(
      join(dir, "timeline.json"),
      JSON.stringify([
        {
          atMs: 0,
          mediaMs: 10,
          stage: "pageBuilder",
          type: "page-created",
          detail: "Created Debt",
          refId: "page-topic-1",
        },
      ]),
    );

    const loaded = await new PreloadedPresentationAdapter(dir).load();
    assert.equal(loaded.source.kind, "preloaded");
    assert.equal(loaded.researchRequests, 0);
    assert.equal(loaded.pages[0]?.facts[0]?.sourceUrl.startsWith("https://"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preloaded adapter refuses a session that called Tavily", async () => {
  const dir = await mkdtemp(join(tmpdir(), "contxt-ingest-"));
  try {
    await writeFile(
      join(dir, "session.json"),
      JSON.stringify({
        ingest: { kind: "preloaded", id: "x", title: "x", filename: "x", durationMs: 1, speakers: [] },
        researcher: "web",
        researchRequests: 4,
      }),
    );
    await writeFile(join(dir, "pages.json"), "[]");
    await writeFile(join(dir, "timeline.json"), "[]");
    await assert.rejects(
      () => new PreloadedPresentationAdapter(dir).load(),
      /fixture/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload stays deferred and microphone capture is browser-only", async () => {
  const upload = ingestAdapterFor("file-upload");
  const mic = ingestAdapterFor("microphone");
  assert.equal(upload.available(), false);
  assert.equal(mic.available(), true);
  await assert.rejects(
    () => new FileUploadIngestAdapter().load(),
    (error: unknown) => {
      assert.ok(error instanceof IngestDeferredError);
      assert.equal(error.kind, "file-upload");
      return true;
    },
  );
  await assert.rejects(
    () => new MicrophoneIngestAdapter().load(),
    (error: unknown) => {
      assert.ok(error instanceof MicrophoneBrowserError);
      return true;
    },
  );
});

test("assertPublicDemoIsOffline accepts fixture with zero requests", () => {
  assertPublicDemoIsOffline({ researcher: "fixture", researchRequests: 0 });
  assert.throws(() =>
    assertPublicDemoIsOffline({ researcher: "fixture", researchRequests: 1 }),
  );
});
