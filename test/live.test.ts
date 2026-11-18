import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { runLive } from "../harness/live.js";
import {
  DeepgramLiveSource,
  type DeepgramLiveWebSocket,
} from "../pipeline/live.js";

test("fixture live matches replay scorecard shape on demo", async () => {
  const outRoot = await mkdtemp(join(tmpdir(), "contxt-live-"));
  try {
    const result = await runLive({
      inputPath: resolve("samples/demo.json"),
      researchFixture: resolve("samples/research.json"),
      speed: 1000,
      outRoot,
      runId: "live-fixture-test",
    });

    assert.equal(result.scorecard.ingestionMode, "live");
    assert.equal(result.scorecard.pagesCreated, 3);
    assert.equal(result.scorecard.pagesUpdated, 1);
    assert.equal(result.scorecard.transcriber, "fixture");
    assert.equal(result.scorecard.transcriberStatus, "ok");
    assert.equal(result.pages.length, 3);
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
});

test("fixture live feeds chunks on a timer at speed 1", async () => {
  const outRoot = await mkdtemp(join(tmpdir(), "contxt-live-"));
  try {
    const started = performance.now();
    const result = await runLive({
      inputPath: resolve("samples/demo.json"),
      researchFixture: resolve("samples/research.json"),
      speed: 1,
      outRoot,
      runId: "live-timer-test",
    });
    const elapsed = performance.now() - started;
  const chunkEvents = result.timeline.filter((event) => event.type === "chunk");
    assert.ok(chunkEvents.length >= 2);
    const deltas = chunkEvents
      .slice(1)
      .map((event, index) => event.atMs - chunkEvents[index]!.atMs);
    assert.ok(deltas.some((delta) => delta >= 400), "chunks should not arrive instantly");
    assert.ok(elapsed >= 400);
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
});

class MockDeepgramSocket implements DeepgramLiveWebSocket {
  private handler: ((data: string | Buffer) => void) | undefined;

  async connect(): Promise<void> {}

  async send(): Promise<void> {}

  async close(): Promise<void> {}

  onMessage(handler: (data: string | Buffer) => void): void {
    this.handler = handler;
  }

  onError(): void {}
}

test("deepgram live without key is skipped", async () => {
  const prior = process.env.DEEPGRAM_API_KEY;
  delete process.env.DEEPGRAM_API_KEY;
  try {
    const source = new DeepgramLiveSource("unused.wav", { mockDurationMs: 1000 });
    const status = await source.status();
    assert.equal(status.status, "skipped");
    assert.match(status.reason ?? "", /DEEPGRAM_API_KEY/);
  } finally {
    if (prior !== undefined) process.env.DEEPGRAM_API_KEY = prior;
  }
});

test("deepgram live mock websocket produces segments", async () => {
  const outRoot = await mkdtemp(join(tmpdir(), "contxt-live-"));
  const socket = new MockDeepgramSocket();
  const source = new DeepgramLiveSource(resolve("samples/demo.json"), {
    apiKey: "test-key",
    mockDurationMs: 4500,
    webSocket: socket,
    mockHandler: async (emit) => {
      emit({
        type: "Results",
        channel: {
          alternatives: [
            {
              words: [
                {
                  word: "solar",
                  punctuated_word: "Solar",
                  start: 0.2,
                  end: 0.5,
                },
                {
                  word: "output",
                  punctuated_word: "output",
                  start: 0.5,
                  end: 0.9,
                },
                {
                  word: "supplied",
                  punctuated_word: "supplied",
                  start: 0.9,
                  end: 1.1,
                },
                {
                  word: "forty",
                  punctuated_word: "40",
                  start: 1.1,
                  end: 1.3,
                },
                {
                  word: "percent",
                  punctuated_word: "percent.",
                  start: 1.3,
                  end: 1.5,
                },
              ],
            },
          ],
        },
      });
    },
  });

  try {
    const batches: Array<{ segments: { text: string }[] }> = [];
    for await (const batch of source.batches(1000)) {
      batches.push(batch);
    }
    const text = batches.flatMap((batch) => batch.segments.map((segment) => segment.text)).join(" ");
    assert.match(text, /Solar/i);
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
});