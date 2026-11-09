#!/usr/bin/env bash
# Reproducibly download the public-domain 1992 debate and cut the CONTXT test clip.
# Output: samples/audio/debate1992.wav (16 kHz mono) and samples/audio/debate1992.opus.
# The opus file is already committed; run this to rebuild it or to get the WAV.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC_URL="https://upload.wikimedia.org/wikipedia/commons/transcoded/e/e7/Presidential_Debate_with_George_H._W._Bush%2C_Bill_Clinton_and_Ross_Perot_11_October_1992.webm/Presidential_Debate_with_George_H._W._Bush%2C_Bill_Clinton_and_Ross_Perot_11_October_1992.webm.240p.vp9.webm"
START=126.0   # 00:02:06.0, just before Lehrer's "Good evening, and welcome"
END=1061.4    # 00:17:41.4, after Clinton's "...and that's what I want to do."
CACHE="${CONTXT_CACHE:-.cache}"
mkdir -p "$CACHE" samples/audio
if [ ! -s "$CACHE/debate1992-240p.webm" ]; then
  echo "Downloading source (about 196 MB) from Wikimedia Commons..."
  curl -fL -A "contxt-fetch/1.0 (https://github.com/marvelus-tech/contxt)" -o "$CACHE/debate1992-240p.webm" "$SRC_URL"
fi
ffmpeg -v error -y -ss "$START" -to "$END" -i "$CACHE/debate1992-240p.webm" -vn -ac 1 -ar 16000 -c:a pcm_s16le samples/audio/debate1992.wav
ffmpeg -v error -y -i samples/audio/debate1992.wav -c:a libopus -b:a 32k samples/audio/debate1992.opus
echo "Clip duration: $(ffprobe -v error -show_entries format=duration -of csv=p=0 samples/audio/debate1992.wav) s"
