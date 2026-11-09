#!/usr/bin/env bash
# Re-run the transcription bakeoff end to end on the debate clip.
# Needs ASSEMBLYAI_API_KEY and DEEPGRAM_API_KEY in the environment (or a .env file).
# Cost: about $0.07 per provider per run.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
AUDIO=samples/audio/debate1992.opus
[ -s "$AUDIO" ] || scripts/fetch_debate1992.sh
mkdir -p out/bakeoff
npm run --silent transcribe -- "$AUDIO" --provider deepgram --out out/bakeoff/deepgram.json --raw out/bakeoff/deepgram.raw.json
npm run --silent transcribe -- "$AUDIO" --provider assemblyai --out out/bakeoff/assemblyai.json --raw out/bakeoff/assemblyai.raw.json
python3 bakeoff/score.py "Deepgram nova-3=out/bakeoff/deepgram.raw.json" "AssemblyAI universal-3-5-pro=out/bakeoff/assemblyai.raw.json"
