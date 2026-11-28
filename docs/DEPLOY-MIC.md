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

## Sync record assets to GitHub Pages

From contxt root after `npm run build`:

```bash
PAGES_RECORD_DIR=/path/to/marvelus-tech.github.io/cntxt/sessions/record node scripts/publish-record-assets.mjs
```

Copies `web/record/*`, `session.css`, `insight-workspace.js`, and mic bundles (`mic-engine.js`, `mic-worklet.js`, `mic.js`). Edit `mic-config.json` on github.io with your Worker `tokenUrl` before or after sync.

## Public smoke checklist

Run these after deploy and Pages sync:

1. **Worker health:** `GET https://<worker-host>/health` returns `{ "ok": true, "configured": true }`.
2. **CORS token:** From a browser on `https://marvelus-tech.github.io`, open DevTools and run  
   `fetch('<worker>/api/mic/token').then(r => r.json())`  
   Expect `{ access_token, expires_in }` without CORS errors.
3. **Empty tokenUrl:** Open `/cntxt/sessions/record/` with `tokenUrl` still `""`. Mic button disabled and hint visible.
4. **Record flow:** Set `tokenUrl`, open hub → **Record** with `?name=Smoke`. Start mic, allow permission, speak one checkable factual sentence. Expect partial text, then insight hero with a Wikipedia source and a row in **Moments**.
5. **Carousel:** With two or more insights, **Prev** / **Next** and **Browse moments** match the 1992 session layout at phone and desktop widths.
6. **Export:** Stop mic → **Download snapshot JSON** saves pages and timeline.
7. **Regression:** `npm test` in contxt stays green; 1992 demo session unchanged.

Do not paste Deepgram or Worker secrets into issues, chat, or committed config.