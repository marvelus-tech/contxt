import { isCitedFact } from "./stages.js";
import type { Claim, Fact, Researcher, Topic } from "./types.js";

export type { ResearcherStatus } from "./types.js";

export interface SearchHit {
  title?: string;
  url: string;
  content?: string;
}

export interface SearchProvider {
  readonly id: string;
  search(query: string, maxResults: number): Promise<SearchHit[]>;
}

const SNIPPET_MAX = 280;
const QUERY_MAX = 400;

export function buildResearchQuery(claim: Claim, topic: Topic): string {
  const parts = [claim.text.trim()];
  const title = topic.title.trim();
  if (title && !claim.text.toLowerCase().includes(title.toLowerCase())) {
    parts.push(title);
  }
  const query = parts.join(". ");
  return query.length > QUERY_MAX ? `${query.slice(0, QUERY_MAX - 1)}…` : query;
}

function factTextFromHit(hit: SearchHit): string {
  const content = (hit.content ?? "").trim();
  const title = (hit.title ?? "").trim();
  if (content && title && !content.toLowerCase().startsWith(title.toLowerCase())) {
    const combined = `${title}. ${content}`;
    return combined.length > SNIPPET_MAX
      ? `${combined.slice(0, SNIPPET_MAX - 1)}…`
      : combined;
  }
  const primary = content || title || hit.url;
  return primary.length > SNIPPET_MAX
    ? `${primary.slice(0, SNIPPET_MAX - 1)}…`
    : primary;
}

export function hitsToFacts(hits: SearchHit[], maxFacts: number): Fact[] {
  const seen = new Set<string>();
  const facts: Fact[] = [];
  for (const hit of hits) {
    if (!hit.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    const text = factTextFromHit(hit);
    if (!text) continue;
    facts.push({ text, sourceUrl: hit.url });
    if (facts.length >= maxFacts) break;
  }
  return facts;
}

export class TavilySearchProvider implements SearchProvider {
  readonly id = "tavily";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, maxResults: number): Promise<SearchHit[]> {
    const response = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: Math.min(maxResults, 10),
        include_answer: false,
        search_depth: "basic",
      }),
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (body.results ?? [])
      .filter((row) => row.url)
      .map((row) => ({
        title: row.title,
        url: row.url!,
        content: row.content,
      }));
  }
}

type CacheStore = Record<string, Fact[]>;

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

async function loadCache(path: string | undefined): Promise<CacheStore> {
  if (!path) return {};
  try {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(path, "utf8")) as CacheStore;
  } catch {
    return {};
  }
}

async function saveCache(path: string | undefined, cache: CacheStore): Promise<void> {
  if (!path) return;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`);
}

export interface WebResearcherOptions {
  provider: SearchProvider;
  cachePath?: string;
  maxFacts?: number;
  stats?: { requests: number; cacheHits: number };
}

export class WebResearcher implements Researcher {
  readonly id: string;
  private cache: CacheStore = {};
  private cacheLoaded = false;
  private dirty = false;

  constructor(private readonly options: WebResearcherOptions) {
    this.id = `web:${options.provider.id}`;
  }

  private async ensureCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cache = await loadCache(this.options.cachePath);
    this.cacheLoaded = true;
  }

  private recordRequest(): void {
    if (this.options.stats) this.options.stats.requests += 1;
  }

  private recordCacheHit(): void {
    if (this.options.stats) this.options.stats.cacheHits += 1;
  }

  async research(claim: Claim, topic: Topic): Promise<Fact[]> {
    await this.ensureCache();
    const key = claim.normalized;
    if (key in this.cache) {
      this.recordCacheHit();
      return this.cache[key] ?? [];
    }
    this.recordRequest();
    const maxFacts = this.options.maxFacts ?? 5;
    const query = buildResearchQuery(claim, topic);
    let facts: Fact[] = [];
    try {
      const hits = await this.options.provider.search(query, maxFacts);
      facts = hitsToFacts(hits, maxFacts).filter(isCitedFact);
    } catch {
      facts = [];
    }
    this.cache[key] = facts;
    this.dirty = true;
    await saveCache(this.options.cachePath, this.cache);
    return facts;
  }

  async flushCache(): Promise<void> {
    if (this.dirty && this.options.cachePath) {
      await saveCache(this.options.cachePath, this.cache);
    }
  }
}

export async function createLegacyWebResearcher(options: {
  fixturePath: string;
  cachePath?: string;
  apiKey?: string;
  maxFacts?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ researcher: Researcher; flush?: () => Promise<void> }> {
  const apiKey = options.apiKey ?? readEnv("TAVILY_API_KEY") ?? "";
  const provider = new TavilySearchProvider(apiKey, options.fetchImpl ?? fetch);
  const web = new WebResearcher({
    provider,
    cachePath: options.cachePath,
    maxFacts: options.maxFacts,
  });
  return { researcher: web, flush: () => web.flushCache() };
}