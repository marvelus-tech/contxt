# CONTXT replay harness

CONTXT is a live context companion for anything spoken. This first step replays a recording through pluggable pipeline stages and measures how claims become cited topic pages.

Research is still fixture-backed. Step 2 adds real transcription through AssemblyAI and Deepgram, with speaker labels carried through to every claim. It does not rank speakers or pick winners.

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
out/<run-id>/claims.json
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
npm run replay -- recordings/talk.mp3 --speed 4 --transcriber assemblyai   # needs ASSEMBLYAI_API_KEY
npm run replay -- recordings/talk.mp3 --speed 4 --transcriber deepgram     # needs DEEPGRAM_API_KEY
```

If a key is missing, the run exits successfully with `skipped` in the scorecard. See "Real audio with speakers" below for setup.

## Real audio with speakers (step 2)

1. Copy the env template and add your keys. `.env` is git-ignored, so never commit it.

   ```bash
   cp .env.example .env
   # edit .env: ASSEMBLYAI_API_KEY=... DEEPGRAM_API_KEY=...
   set -a; . ./.env; set +a
   ```

2. Replay the committed 1992 debate transcript. It's offline, with no keys and no cost.

   ```bash
   npm run ci:debate
   ```

   Every claim carries the speaker who said it:
   - `out/<run-id>/claims.json` lists each claim with its `speaker`, its timestamps and its topic.
   - `deck.html` shows "Said by ..." on each topic, and the timeline names who said each claim.
   - `scorecard.json` has `claimsBySpeaker`.

3. Transcribe real audio through the harness. The whole file is sent once on the first chunk, and the segments are then replayed chunk by chunk.

   ```bash
   npm run replay -- samples/audio/debate1992.opus --transcriber assemblyai --speed 50
   npm run replay -- samples/audio/debate1992.opus --transcriber deepgram --keyterm Perot --keyterm Lehrer
   ```

   - AssemblyAI defaults to `universal-3-5-pro` with `speaker_labels` on.
   - Deepgram defaults to `nova-3` with `diarize`, `smart_format`, `punctuate` and `utterances` on.
   - Override the model with `--cloud-model` or `ASSEMBLYAI_MODEL` / `DEEPGRAM_MODEL`.
   - `--keyterm` (repeatable) or `ASSEMBLYAI_KEYTERMS` / `DEEPGRAM_KEYTERMS` (comma-separated) boosts names and jargon. Both providers bill this as an add-on.
   - Speakers come out as `Speaker A` or `Speaker 0`.
   - WAV, MP3, Opus, OGG, WebM, M4A and FLAC all work. Formats other than WAV need `ffprobe`.

4. Save a transcript as a reusable fixture, plus the raw provider JSON.

   ```bash
   npm run transcribe -- recording.opus --provider assemblyai --out out/rec.json --raw out/rec.raw.json
   npm run replay -- --fixture out/rec.json
   ```

   A fixture segment looks like `{ "startMs", "endMs", "text", "speaker" }`. An optional top-level `speakers: [{ "id", "name" }]` maps speaker ids to display names.

5. Re-run the provider bakeoff. It costs about $0.07 per provider and needs Python 3.

   ```bash
   pip install -r bakeoff/requirements.txt
   bakeoff/run_bakeoff.sh          # transcribes with both providers, then scores
   python3 bakeoff/score.py        # rescores the committed raw responses offline
   ```

   - Results and the recommendation are in [docs/REPORT.md](docs/REPORT.md).
   - The clip comes from `scripts/fetch_debate1992.sh`. It's public domain, from Wikimedia Commons, and runs 00:02:06.0 to 00:17:41.4. Details are in `samples/debate1992.clip.json`.

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
npm run ci:debate
```
