# Publish a static session to GitHub Pages

**Option A (shipped):** bake pipeline output into `marvelus-tech.github.io/cntxt/sessions/<slug>/` and update the manifest.

```bash
cd contxt
npm run bake:session -- \
  --slug my-standup \
  --title "Team standup Nov 22" \
  --fixture path/to/transcript.json \
  --audio path/to/audio.opus \
  --clip path/to/clip.json
```

Defaults target `../marvelus-tech.github.io/cntxt` via `PAGES_ROOT`.

Outputs per slug:

- `session.json`, `pages.json`, `timeline.json`, `deck.html`, `meta.json`, audio
- UI shell from `web/session/` (`index.html`, `session.js`, `session.css`, `ingest.js`)
- Appends row to `sessions/sessions.json`

Commit and push github.io; the hub lists the new session.

**Option B (future):** API + storage so Record/Upload publish without a local bake. See Project store `docs/session-storage-decision.md`.