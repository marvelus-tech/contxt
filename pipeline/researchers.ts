import { dirname, join } from "node:path";
import { isCitedFact } from "./stages.js";
import { FixtureResearcher } from "./stages.js";
import type { Claim, Fact, Researcher, Topic } from "./types.js";
import type { ResearcherStatus } from "./types.js";

export type ResearcherMode =
  | "fixture"
  | "live"
  | "tavily"
  | "factcheck"
  | "web"
  | "composite";

export type FetchLike = typeof fetch;

const QUERY_MAX = 400;
const SNIPPET_MAX = 280;
const MAX_RESULTS = 3;
const DEFAULT_TIMEOUT_MS = 8_000;
const CACHE_FILENAME = "research-cache.json";

export interface ResearcherStats {
  requests: number;
  cacheHits: number;
  claimsResearched: number;
  claimsSkippedNonCheckable: number;
}

export interface ResearcherHandle {
  readonly id: string;
  researcher: Researcher;
  status(): Promise<{ status: ResearcherStatus; reason?: string }>;
  stats(): ResearcherStats;
  flush?(): Promise<void>;
}

type CacheStore = Record<string, Fact[]>;

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildCompositeResearchQuery(claim: Claim, topic: Topic): string {
  const parts: string[] = [claim.text.trim()];
  if (claim.speaker?.trim()) parts.push(claim.speaker.trim());
  const title = topic.title.trim();
  if (title && !claim.text.toLowerCase().includes(title.toLowerCase())) {
    parts.push(title);
  }
  const query = parts.join(" ");
  return query.length > QUERY_MAX ? `${query.slice(0, QUERY_MAX - 1)}…` : query;
}

export function normalizeSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    let href = parsed.href;
    if (href.endsWith("/") && parsed.pathname.length > 1) {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return url.trim();
  }
}

function factTextFromTavily(title: string | undefined, content: string | undefined): string {
  const body = (content ?? "").trim();
  const head = (title ?? "").trim();
  if (body) return truncate(body, SNIPPET_MAX);
  if (head) return truncate(head, SNIPPET_MAX);
  return "";
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("research timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`);
}

function resolveCacheFile(cacheDir: string | undefined): string | undefined {
  if (!cacheDir) return undefined;
  return cacheDir.endsWith(".json") ? cacheDir : join(cacheDir, CACHE_FILENAME);
}

function mergeDeduplicatedFacts(lists: Fact[][]): Fact[] {
  const seen = new Set<string>();
  const merged: Fact[] = [];
  for (const list of lists) {
    for (const fact of list) {
      if (!isCitedFact(fact)) continue;
      const key = normalizeSourceUrl(fact.sourceUrl);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...fact, sourceUrl: key });
    }
  }
  return merged;
}

export class TavilyResearcher {
  readonly id = "tavily";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async search(query: string): Promise<Fact[]> {
    if (!this.apiKey) return [];
    const response = await withTimeout(
      this.fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: MAX_RESULTS,
          include_answer: false,
        }),
      }),
      this.timeoutMs,
    );
    if (!response.ok) return [];
    const body = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        published_date?: string;
      }>;
    };
    const facts: Fact[] = [];
    for (const row of body.results ?? []) {
      if (!row.url) continue;
      const text = factTextFromTavily(row.title, row.content);
      if (!text) continue;
      facts.push({
        text,
        sourceUrl: row.url,
        ...(row.title ? { sourceTitle: row.title.trim() } : {}),
        provider: "tavily",
        ...(row.published_date ? { publishedDate: row.published_date } : {}),
      });
    }
    return facts.filter(isCitedFact);
  }
}

export class GoogleFactCheckResearcher {
  readonly id = "google-fact-check";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async search(query: string): Promise<Fact[]> {
    if (!this.apiKey) return [];
    const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
    url.searchParams.set("query", query);
    url.searchParams.set("pageSize", String(MAX_RESULTS));
    url.searchParams.set("languageCode", "en");
    url.searchParams.set("key", this.apiKey);

    const response = await withTimeout(this.fetchImpl(url.toString()), this.timeoutMs);
    if (!response.ok) return [];
    const body = (await response.json()) as {
      claims?: Array<{
        text?: string;
        claimReview?: Array<{
          publisher?: { name?: string; site?: string };
          url?: string;
          title?: string;
          textualRating?: string;
        }>;
      }>;
    };

    const facts: Fact[] = [];
    for (const claim of body.claims ?? []) {
      const claimText = (claim.text ?? "").trim();
      for (const review of claim.claimReview ?? []) {
        if (!review.url) continue;
        const publisher = review.publisher?.name?.trim();
        const title = (review.title ?? "").trim();
        const primary = claimText || title;
        if (!primary) continue;
        facts.push({
          text: truncate(primary, SNIPPET_MAX),
          sourceUrl: review.url,
          ...(title ? { sourceTitle: title } : {}),
          ...(publisher ? { publisher } : {}),
          ...(review.textualRating ? { rating: review.textualRating.trim() } : {}),
          provider: "google-fact-check",
        });
      }
    }
    return facts.filter(isCitedFact);
  }
}

export interface CompositeResearcherOptions {
  tavily?: TavilyResearcher;
  factCheck?: GoogleFactCheckResearcher;
  cachePath?: string;
  maxClaims?: number;
  stats?: ResearcherStats;
  fetchImpl?: FetchLike;
}

export class CompositeResearcher implements Researcher {
  readonly id = "live";
  private cache: CacheStore = {};
  private cacheLoaded = false;
  private dirty = false;

  constructor(private readonly options: CompositeResearcherOptions) {}

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
    if (claim.checkable !== true) {
      if (this.options.stats) this.options.stats.claimsSkippedNonCheckable += 1;
      return [];
    }
    if (
      this.options.maxClaims !== undefined &&
      this.options.stats &&
      this.options.stats.claimsResearched >= this.options.maxClaims
    ) {
      return [];
    }

    await this.ensureCache();
    const key = claim.normalized;
    if (key in this.cache) {
      this.recordCacheHit();
      return this.cache[key] ?? [];
    }

    if (this.options.stats) this.options.stats.claimsResearched += 1;
    const query = buildCompositeResearchQuery(claim, topic);

    const tasks: Promise<Fact[]>[] = [];
    if (this.options.factCheck) {
      tasks.push(
        (async () => {
          this.recordRequest();
          return this.options.factCheck!.search(query).catch(() => [] as Fact[]);
        })(),
      );
    }
    if (this.options.tavily) {
      tasks.push(
        (async () => {
          this.recordRequest();
          return this.options.tavily!.search(query).catch(() => [] as Fact[]);
        })(),
      );
    }

    const parts = tasks.length > 0 ? await Promise.all(tasks) : [];
    const facts = mergeDeduplicatedFacts(parts);
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

class SingleProviderResearcher implements Researcher {
  constructor(
    readonly id: string,
    private readonly provider: { search(query: string): Promise<Fact[]> },
    private readonly cachePath: string | undefined,
    private readonly stats: ResearcherStats,
    private readonly maxClaims?: number,
  ) {}

  private cache: CacheStore = {};
  private cacheLoaded = false;
  private dirty = false;

  private async ensureCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cache = await loadCache(this.cachePath);
    this.cacheLoaded = true;
  }

  async research(claim: Claim, topic: Topic): Promise<Fact[]> {
    if (claim.checkable !== true) {
      this.stats.claimsSkippedNonCheckable += 1;
      return [];
    }
    if (this.maxClaims !== undefined && this.stats.claimsResearched >= this.maxClaims) {
      return [];
    }

    await this.ensureCache();
    const key = claim.normalized;
    if (key in this.cache) {
      this.stats.cacheHits += 1;
      return this.cache[key] ?? [];
    }

    this.stats.claimsResearched += 1;
    this.stats.requests += 1;
    const query = buildCompositeResearchQuery(claim, topic);
    let facts: Fact[] = [];
    try {
      facts = await this.provider.search(query);
    } catch {
      facts = [];
    }
    facts = mergeDeduplicatedFacts([facts]);
    this.cache[key] = facts;
    this.dirty = true;
    await saveCache(this.cachePath, this.cache);
    return facts;
  }

  async flushCache(): Promise<void> {
    if (this.dirty && this.cachePath) {
      await saveCache(this.cachePath, this.cache);
    }
  }
}

export interface CreateResearcherOptions {
  mode: ResearcherMode;
  fixturePath: string;
  cachePath?: string;
  cacheDir?: string;
  tavilyApiKey?: string;
  googleFactCheckApiKey?: string;
  maxClaims?: number;
  fetchImpl?: FetchLike;
}

export async function createResearcher(
  options: CreateResearcherOptions,
): Promise<ResearcherHandle> {
  const stats: ResearcherStats = {
    requests: 0,
    cacheHits: 0,
    claimsResearched: 0,
    claimsSkippedNonCheckable: 0,
  };

  const mode = normalizeMode(options.mode);
  const cachePath =
    resolveCacheFile(options.cacheDir) ?? options.cachePath;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tavilyKey = options.tavilyApiKey ?? readEnv("TAVILY_API_KEY") ?? "";
  const googleKey =
    options.googleFactCheckApiKey ?? readEnv("GOOGLE_FACT_CHECK_API_KEY") ?? "";

  const fixture = await FixtureResearcher.fromFile(options.fixturePath);

  if (mode === "fixture") {
    return {
      id: "fixture",
      researcher: fixture,
      async status() {
        return { status: "ok" };
      },
      stats: () => stats,
    };
  }

  if (mode === "composite") {
    const legacyTavily = tavilyKey ? new TavilyResearcher(tavilyKey, fetchImpl) : undefined;
    const composite = new CompositeResearcher({
      ...(legacyTavily ? { tavily: legacyTavily } : {}),
      cachePath,
      stats,
      maxClaims: options.maxClaims,
    });
    const fallback = new FixtureThenLiveResearcher(fixture, composite);
    return {
      id: "composite",
      researcher: fallback,
      async status() {
        if (!tavilyKey) {
          return { status: "ok", reason: "TAVILY_API_KEY is not set; fixture only" };
        }
        return { status: "ok" };
      },
      stats: () => stats,
      flush: () => composite.flushCache(),
    };
  }

  if (mode === "tavily" || mode === "web") {
    const tavily = new TavilyResearcher(tavilyKey, fetchImpl);
    const researcher = new SingleProviderResearcher(
      "tavily",
      tavily,
      cachePath,
      stats,
      options.maxClaims,
    );
    return {
      id: "tavily",
      researcher,
      async status() {
        if (!tavilyKey) {
          return { status: "skipped", reason: "TAVILY_API_KEY is not set" };
        }
        return { status: "ok" };
      },
      stats: () => stats,
      flush: () => researcher.flushCache(),
    };
  }

  if (mode === "factcheck") {
    const google = new GoogleFactCheckResearcher(googleKey, fetchImpl);
    const researcher = new SingleProviderResearcher(
      "google-fact-check",
      google,
      cachePath,
      stats,
      options.maxClaims,
    );
    return {
      id: "google-fact-check",
      researcher,
      async status() {
        if (!googleKey) {
          return {
            status: "skipped",
            reason: "GOOGLE_FACT_CHECK_API_KEY is not set",
          };
        }
        return { status: "ok" };
      },
      stats: () => stats,
      flush: () => researcher.flushCache(),
    };
  }

  const tavily = tavilyKey ? new TavilyResearcher(tavilyKey, fetchImpl) : undefined;
  const factCheck = googleKey
    ? new GoogleFactCheckResearcher(googleKey, fetchImpl)
    : undefined;

  const composite = new CompositeResearcher({
    ...(tavily ? { tavily } : {}),
    ...(factCheck ? { factCheck } : {}),
    cachePath,
    stats,
    maxClaims: options.maxClaims,
    fetchImpl,
  });

  return {
    id: composite.id,
    researcher: composite,
    async status() {
      if (!tavilyKey && !googleKey) {
        return {
          status: "skipped",
          reason: "TAVILY_API_KEY and GOOGLE_FACT_CHECK_API_KEY are not set",
        };
      }
      const reasons: string[] = [];
      if (!tavilyKey) reasons.push("TAVILY_API_KEY is not set");
      if (!googleKey) reasons.push("GOOGLE_FACT_CHECK_API_KEY is not set");
      if (reasons.length > 0) {
        return { status: "ok", reason: reasons.join("; ") };
      }
      return { status: "ok" };
    },
    stats: () => stats,
    flush: () => composite.flushCache(),
  };
}

function normalizeMode(mode: ResearcherMode): ResearcherMode {
  if (mode === "web") return "tavily";
  return mode;
}

class FixtureThenLiveResearcher implements Researcher {
  constructor(
    private readonly fixture: FixtureResearcher,
    private readonly live: CompositeResearcher,
  ) {}

  async research(claim: Claim, topic: Topic): Promise<Fact[]> {
    const fixtureFacts = await this.fixture.research(claim, topic);
    if (fixtureFacts.length > 0) return fixtureFacts;
    return this.live.research(claim, topic);
  }
}