# Deploy live microphone (CNT-9)

GitHub Pages cannot hold a Deepgram API key. The browser opens Deepgram with a short-lived JWT from your Worker.

## Prerequisites

- Deepgram API key with **Member** role or higher (required to mint grants).
- Cloudflare account and `npx wrangler login`.

## Local

1. Copy `.env.example` to `.env` and set `DEEPGRAM_API_KEY`.
2. `npm run mic:serve` — serves play UI and `GET /api/mic/token`.
3. Open `http://127.0.0.1:8787/`.

## Production Worker

1. From repo root: `npx wrangler secret put DEEPGRAM_API_KEY`
2. `npx wrangler deploy`
3. Set `tokenUrl` in github.io:
   - `cntxt/sessions/record/mic-config.json`
   - `cntxt/sessions/mic-config.json` (optional alias)
   Example: `"tokenUrl": "https://contxt-mic.<account>.workers.dev/api/mic/token"`

## Sessions hub

After `tokenUrl` is set, **Record** on `/cntxt/sessions/` opens `/cntxt/sessions/record/?name=...` with live speech.

Publishing a **named static session** after recording still requires `npm run bake:session` or hosted storage (see `docs/session-publish.md`).