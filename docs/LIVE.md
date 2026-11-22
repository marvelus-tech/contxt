# Live ingestion (step 5)

Live mode runs the same claim, topic, research and page stages as replay, but feeds transcript segments on a **wall-clock timer** (~`CHUNK_MS`, default 1500 ms of media time per chunk) instead of dumping an entire fixture instantly.

## CLI

```bash
npm run live -- --fixture samples/demo.json
npm run live -- recording.wav --transcriber deepgram-live
```

`npm run ci:live` is a keyless CI smoke test: fixture demo at `--speed 1000`.

Binaries:

- `contxt-live` (after `npm run build`)

## Fixture live

JSON fixtures behave like replay transcriber `fixture`, but ingestion mode is `live` and scorecards include `ingestionMode: "live"`. With `--speed 1`, chunk events in `timeline.json` are spaced by real time.

## Deepgram live (optional)

`--transcriber deepgram-live` streams a **16-bit PCM WAV** to the Deepgram listen WebSocket at about 1× wall clock (divided by `--speed`). Diarization and smart format match batch Deepgram.

```bash
export DEEPGRAM_API_KEY=...
npm run live -- samples/recording.wav --transcriber deepgram-live
```

If `DEEPGRAM_API_KEY` is missing, the run completes with `transcriberStatus: "skipped"` like other cloud adapters.

## Browser microphone

The play page captures the microphone, shows Deepgram partials immediately, and feeds each final line into the same claim, topic, research and page session as `runLive`. Citations for live speech come from Wikipedia in the browser. The baked 1992 debate stays on the page and still uses fixture research with zero Tavily calls. File upload stays deferred.

The browser never sees `DEEPGRAM_API_KEY`. A server calls `POST https://api.deepgram.com/v1/auth/grant` and returns only a short-lived JWT. The page opens `wss://api.deepgram.com/v1/listen` with the WebSocket subprotocols `bearer` and that JWT.

```bash
npm run mic:serve
# http://127.0.0.1:8787/  needs DEEPGRAM_API_KEY in the environment or .env
```

GitHub Pages cannot mint tokens. The smallest host for the page and the token route together is the Cloudflare Worker in `wrangler.jsonc`:

```bash
npx wrangler secret put DEEPGRAM_API_KEY
npx wrangler deploy
```

The key needs Member permission or higher. After deploy, set `web/play/mic-config.json` `tokenUrl` to `https://<worker>/api/mic/token` if the page is not served by that same Worker. Leave `tokenUrl` empty when the page and the token route share an origin.

## Out of scope

- File upload in the browser (deferred `file-upload` adapter)
- AssemblyAI streaming
- React UI

## Agent API

```ts
import { runLive } from "contxt-replay-harness";

const result = await runLive({
  inputPath: "samples/demo.json",
  speed: 4,
});
```

Shared pipeline logic lives in `harness/pipeline.ts` (`createPipelineSession`). Replay and live both call it.