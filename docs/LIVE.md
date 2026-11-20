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

## Out of scope for v1

- Microphone capture (pipe `ffmpeg` or `sox` into a WAV file, then use Deepgram live). The play UI exposes a deferred `microphone` ingest adapter (`pipeline/ingest.ts`) so that work has a typed boundary.
- File upload in the browser (deferred `file-upload` adapter; the hosted demo auto-loads the 1992 debate instead)
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