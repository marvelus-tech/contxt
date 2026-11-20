# Step 4: Real web research

## What this does

Checkable claims (statistic and factual) on **new topics** call a pluggable `Researcher`. The default is still the offline fixture (`samples/research.json`) so CI stays keyless.

Three modes:

| Mode | Behaviour |
|------|-----------|
| `fixture` | Lookup by `claim.normalized` in the JSON fixture only. |
| `web` | Tavily search per claim; results cached under `out/<run-id>/research-cache.json`. |
| `composite` | Fixture first; Tavily only when the fixture returns no facts. |

Facts must carry a valid `http:` or `https:` `sourceUrl` or the page builder drops them (unchanged from Step 1).

## Setup

```bash
cp .env.example .env
# edit .env: TAVILY_API_KEY=...
set -a; . ./.env; set +a
```

Optional: `RESEARCH_MAX_FACTS` (default 5).

## Commands

```bash
# offline (default)
npm run replay -- --fixture samples/demo.json

# fixture + web fallback (recommended for real recordings)
npm run replay -- --fixture samples/debate1992.json --speed 1000 --researcher composite

# web only
npm run replay -- --fixture samples/demo.json --researcher web
```

Offline eval on a recorded Tavily response (no network):

```bash
npm run eval:research
```

## Acceptance checks

- `researcher.research(claim, topic)` returns cited facts or `[]` on failure.
- Missing `TAVILY_API_KEY`: `researcherStatus` is `skipped` in web mode; run continues.
- `npm test`, `npm run ci:replay`, `npm run ci:debate` pass without keys.
- Scorecard includes `researcher`, `researcherStatus`, `researchRequests`, `researchCacheHits`.

## Cost and latency

- One Tavily request per **new topic** (repeats skip research, same as fixture mode).
- Cache is keyed by normalized claim text; replays of the same run reuse `research-cache.json`.
- v1 uses search snippets only — no LLM synthesis or fact-check verdict.

## Public demos and Firecrawl Local

Use **`fixture`** for GitHub Pages, CI, and any shipped interactive demo: it costs **no Tavily credits** and matches `samples/research.json`. The play bake (`npm run bake:play`) keeps the scorecard researcher as `fixture` with **0 Tavily requests**, then fills debate gaps from `samples/research-context.json` (offline keyword packs). Use **`composite`** on your machine when a claim is missing from the fixture; Tavily runs only on those gaps if `TAVILY_API_KEY` is set. **Firecrawl Local** (scrape, crawl, map on your laptop) does **not** replace Tavily for discovering sources; cloud `/search` still uses Firecrawl credits. A later optional step is local **scrape** of URLs you already have from fixture or Tavily to enrich fact text, not to avoid fixture mode.

Presentation ingest for the hosted demo is **preloaded** (`pipeline/ingest.ts`). File upload and microphone adapters exist as types and throw `IngestDeferredError` until a later step.

## Out of scope

- Claim true/false adjudication.
- Live microphone ingestion.
- Live Tavily calls in GitHub Actions.