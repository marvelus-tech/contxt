import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMicrophonePipeline } from "../web/mic/browser.js";
import {
  browserListenProtocols,
  deepgramBrowserListenUrl,
  describeMicFailure,
  downsampleBox,
  floatToInt16,
  isSafeTokenUrl,
  readDeepgramListenEvent,
} from "../pipeline/mic.js";
import {
  createGrantLimiter,
  handleMicGrantRequest,
  isGrantOriginAllowed,
} from "../pipeline/mic-grant.js";
import { MicrophoneBrowserError, MicrophoneIngestAdapter } from "../pipeline/ingest.js";

const CLIENT_FILES = [
  "web/play/index.html",
  "web/play/play.js",
  "web/play/mic.js",
  "web/play/ingest.js",
  "web/play/play.css",
  "web/play/mic-worklet.js",
  "web/play/mic-engine.js",
  "web/play/mic-config.json",
];

test("browser listen url asks for partials and carries no credential", () => {
  const url = new URL(deepgramBrowserListenUrl());
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/v1/listen");
  assert.equal(url.searchParams.get("interim_results"), "true");
  assert.equal(url.searchParams.get("encoding"), "linear16");
  assert.equal(url.searchParams.get("sample_rate"), "16000");
  assert.equal(url.searchParams.get("model"), "nova-3");
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(url.searchParams.has("access_token"), false);
  assert.equal(url.href.includes("api_key"), false);
});

test("grant jwt travels as a bearer subprotocol", () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
  assert.deepEqual(browserListenProtocols(jwt), ["bearer", jwt]);
  assert.throws(() => browserListenProtocols("not a token"));
});

test("token urls cannot smuggle a permanent key", () => {
  assert.equal(isSafeTokenUrl("/api/mic/token"), true);
  assert.equal(isSafeTokenUrl("https://mic.example.com/token"), true);
  assert.equal(isSafeTokenUrl("http://127.0.0.1:8787/api/mic/token"), true);
  assert.equal(isSafeTokenUrl("http://example.com/token"), false);
  assert.equal(isSafeTokenUrl("https://example.com/?api_key=abc"), false);
  assert.equal(isSafeTokenUrl("https://user:pass@example.com/token"), false);
  assert.equal(isSafeTokenUrl(""), false);
});

test("partials stay partial and finals become segments", () => {
  const partial = readDeepgramListenEvent(JSON.stringify({
    type: "Results",
    is_final: false,
    channel: { alternatives: [{ transcript: "the federal debt" }] },
  }));
  assert.equal(partial.kind, "partial");
  assert.equal(partial.segments, undefined);

  const finalEvent = readDeepgramListenEvent({
    type: "Results",
    is_final: true,
    start: 0,
    duration: 1.6,
    channel: {
      alternatives: [{
        transcript: "The federal debt reached four trillion dollars.",
        words: [
          { word: "the", punctuated_word: "The", start: 0.1, end: 0.2 },
          { word: "federal", punctuated_word: "federal", start: 0.2, end: 0.5 },
          { word: "debt", punctuated_word: "debt", start: 0.5, end: 0.8 },
          { word: "reached", punctuated_word: "reached", start: 0.8, end: 1.0 },
          { word: "four", punctuated_word: "four", start: 1.0, end: 1.2 },
          { word: "trillion", punctuated_word: "trillion", start: 1.2, end: 1.4 },
          { word: "dollars", punctuated_word: "dollars.", start: 1.4, end: 1.6 },
        ],
      }],
    },
  });
  assert.equal(finalEvent.kind, "final");
  assert.match(finalEvent.segments?.[0]?.text ?? "", /federal debt/);
  assert.equal(readDeepgramListenEvent({ type: "UtteranceEnd" }).kind, "utterance_end");
});

test("microphone permission failures map to recoverable phases", () => {
  assert.equal(describeMicFailure({ name: "NotAllowedError" }).phase, "denied");
  assert.equal(describeMicFailure({ name: "NotFoundError" }).phase, "no-device");
  assert.equal(describeMicFailure({ name: "SecurityError" }).phase, "insecure");
  assert.match(describeMicFailure({ name: "NotAllowedError" }).message, /address bar/);
});

test("box downsample and int16 stay in range", () => {
  const down = downsampleBox([0.5, 0.5, 0.5, -1, -1, -1], 48_000, 16_000);
  assert.equal(down.length, 2);
  assert.ok(Math.abs(down[0]! - 0.5) < 0.001);
  assert.equal(floatToInt16(1), 32767);
  assert.equal(floatToInt16(-1), -32768);
});

test("grant handler never returns the permanent key", async () => {
  const apiKey = "permanent-test-key-value";
  let sawAuth = "";
  let sawBody = "";
  const response = await handleMicGrantRequest(
    new Request("http://127.0.0.1:8787/api/mic/token", {
      headers: { origin: "http://127.0.0.1:8787" },
    }),
    {
      apiKey,
      allowMissingOrigin: false,
      limiter: createGrantLimiter(),
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        sawAuth = headers.get("authorization") ?? "";
        sawBody = String(init?.body ?? "");
        return new Response(JSON.stringify({
          access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
          expires_in: 30,
        }), { status: 200 });
      },
    },
  );
  const body = await response.json() as { access_token: string };
  assert.equal(response.status, 200);
  assert.equal(sawAuth, `Token ${apiKey}`);
  assert.match(sawBody, /"ttl_seconds":30/);
  assert.equal(body.access_token.includes(apiKey), false);
  assert.equal(JSON.stringify(body).includes(apiKey), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("grant handler hides upstream failures and blocks other origins", async () => {
  const missing = await handleMicGrantRequest(
    new Request("http://localhost:8787/api/mic/token", {
      headers: { origin: "http://localhost:8787" },
    }),
    { apiKey: "", allowMissingOrigin: true, limiter: createGrantLimiter() },
  );
  const missingBody = await missing.text();
  assert.equal(missing.status, 503);
  assert.match(missingBody, /DEEPGRAM_API_KEY/);
  assert.equal(missingBody.includes("permanent-test-key-value"), false);

  let called = false;
  const blocked = await handleMicGrantRequest(
    new Request("https://mic.example/api/mic/token", {
      headers: { origin: "https://evil.example" },
    }),
    {
      apiKey: "permanent-test-key-value",
      allowMissingOrigin: true,
      limiter: createGrantLimiter(),
      fetchImpl: async () => {
        called = true;
        return new Response("nope", { status: 500 });
      },
    },
  );
  assert.equal(blocked.status, 403);
  assert.equal(called, false);
  assert.equal(isGrantOriginAllowed("https://marvelus-tech.github.io", ["https://marvelus-tech.github.io"], false), true);
  assert.equal(isGrantOriginAllowed("https://evil.example", ["https://marvelus-tech.github.io"], false), false);
});

test("grant handler rate limits a client", async () => {
  const limiter = createGrantLimiter(2, 60_000);
  const config = {
    apiKey: "permanent-test-key-value",
    allowMissingOrigin: true,
    clientKey: "10.0.0.8",
    limiter,
    now: () => 1_000,
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
      expires_in: 30,
    }), { status: 200 }),
  };
  const call = () => handleMicGrantRequest(
    new Request("http://127.0.0.1/api/mic/token"),
    config,
  );
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 429);
});

test("final transcript enters the claim pipeline and cites wikipedia", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const href = String(input);
    assert.match(href, /en\.wikipedia\.org/);
    return new Response(JSON.stringify({
      query: {
        search: [{
          title: "National debt of the United States",
          snippet: "Federal debt was about four trillion dollars in the early 1990s.",
        }],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const { session } = createMicrophonePipeline(fetchImpl);
  await session.processSegments([
    {
      startMs: 200,
      endMs: 1800,
      text: "The federal debt reached four trillion dollars in 1992.",
    },
  ], 1800);
  const snapshot = session.snapshot();
  assert.equal(snapshot.pagesCreated, 1);
  assert.equal(snapshot.researchRequests, 1);
  assert.match(snapshot.pages[0]?.facts[0]?.sourceUrl ?? "", /^https:\/\/en\.wikipedia\.org\/wiki\//);
  assert.ok(snapshot.timeline.some((event) => event.type === "page-created"));
  const finalized = await session.finalize("ok");
  assert.equal(finalized.deckPath, "");
  assert.equal(finalized.scorecard.ingestionMode, "live");
  assert.equal(finalized.scorecard.transcriber, "deepgram-browser");
});

test("microphone adapter is live in the browser and upload stays deferred", async () => {
  const mic = new MicrophoneIngestAdapter();
  assert.equal(mic.available(), true);
  await assert.rejects(() => mic.load(), (error: unknown) => {
    assert.ok(error instanceof MicrophoneBrowserError);
    assert.match(error.message, /short-lived token/);
    return true;
  });
});

test("shipped play files do not contain the permanent credential path", async () => {
  const bundled = CLIENT_FILES.map(async (file) => readFile(file, "utf8"));
  const sources = await Promise.all(bundled);
  const all = sources.join("\n");
  assert.equal(all.includes("\u2014") || all.includes("\u2013"), false);
  assert.equal(all.includes("DEEPGRAM_API_KEY"), false);
  assert.equal(all.includes("/v1/auth/grant"), false);
  assert.match(all, /wss:\/\/api\.deepgram\.com\/v1\/listen/);
  assert.match(all, /en\.wikipedia\.org/);
  assert.match(sources[6] ?? "", /\["bearer", token\]/);
  // Filesystem helpers stay inside functions the microphone path does not call.
  assert.doesNotMatch(sources[6] ?? "", /from ["']node:fs/);
});
