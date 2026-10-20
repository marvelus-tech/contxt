# CONTXT replay harness

CONTXT is a live context companion for anything spoken. This first step replays a recording through pluggable pipeline stages and measures how claims become cited topic pages.

This repository contains the harness only. Research is fixture-backed, and the AssemblyAI and Deepgram adapters are interface stubs. It does not rank speakers or pick winners.

## Requirements

- Node.js 22 or newer
- npm
- For local audio transcription, either `whisper-cli` from whisper.cpp or a `faster-whisper` CLI
- For MP3 duration detection, `ffprobe`

Install:

```bash
npm install
```

## Run the offline demo

```bash
npm run replay -- --fixture samples/demo.json
```

Speed up the replay:

```bash
npm run replay -- --fixture samples/demo.json --speed 4
```

Every run creates:

```text
out/<run-id>/deck.html
out/<run-id>/timeline.json
out/<run-id>/scorecard.json
```

The deck uses one section per topic, previous and next controls, and a chronological timeline. A repeated claim updates its existing topic page. Facts without a valid HTTP or HTTPS source URL are discarded.

## Add a recording

Put a WAV or MP3 file anywhere outside `out/`, then run:

```bash
npm run replay -- recordings/talk.wav --speed 4
```

Audio defaults to the free local Whisper adapter. Set a model path when using whisper.cpp:

```bash
WHISPER_MODEL=models/ggml-base.en.bin npm run replay -- recordings/talk.wav
```

You can also set `WHISPER_BIN` when the whisper.cpp executable has a different name.

## Transcript fixture format

A fixture keeps CI and agent runs independent of audio models:

```json
{
  "segments": [
    {
      "startMs": 200,
      "endMs": 1200,
      "text": "A complete claim is written here."
    }
  ]
}
```

Run it with `--fixture path/to/transcript.json`. Fixture research lives in `samples/research.json`, keyed by the normalized claim text.

## Compare transcribers on one recording

Run each adapter against the same file and speed, then compare the generated scorecards:

```bash
npm run replay -- recordings/talk.mp3 --speed 4 --transcriber whisper
ASSEMBLYAI_API_KEY=your-key npm run replay -- recordings/talk.mp3 --speed 4 --transcriber assemblyai
DEEPGRAM_API_KEY=your-key npm run replay -- recordings/talk.mp3 --speed 4 --transcriber deepgram
```

In step 1, the cloud adapters intentionally return no transcript. If a key is missing, the run exits successfully with `skipped` in the scorecard. Real cloud transcription belongs to a later step.

## Agent API

Agents can import `runReplay()`:

```ts
import { runReplay } from "contxt-replay-harness";

const result = await runReplay({
  inputPath: "samples/demo.json",
  speed: 4,
});
```

Each pipeline stage has an exported TypeScript interface: `Transcriber`, `ClaimExtractor`, `TopicGrouper`, `Researcher`, and `PageBuilder`. Pass replacements through `stages` in `ReplayOptions`.

See `llms.txt` for the compact command reference.

## Verify

```bash
npm test
npm run ci:replay
```
