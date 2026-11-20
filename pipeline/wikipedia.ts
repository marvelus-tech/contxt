import type { SearchHit, SearchProvider } from "./research.js";

type FetchLike = typeof fetch;

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Free encyclopedia search. The browser can call it directly (origin=*).
 * Live microphone citations use this so the page never needs a Tavily key.
 */
export class WikipediaSearchProvider implements SearchProvider {
  readonly id = "wikipedia";

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async search(query: string, maxResults: number): Promise<SearchHit[]> {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", query.slice(0, 300));
    url.searchParams.set("srlimit", String(Math.min(Math.max(maxResults, 1), 5)));
    url.searchParams.set("srprop", "snippet");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    url.searchParams.set("utf8", "1");
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Wikipedia search failed: HTTP ${response.status}`);
    const body = (await response.json()) as {
      query?: { search?: Array<{ title?: string; snippet?: string }> };
    };
    return (body.query?.search ?? [])
      .filter((row) => row.title)
      .map((row) => {
        const title = row.title!.replace(/ /g, "_");
        return {
          title: row.title,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
          content: stripHtml(row.snippet ?? ""),
        };
      });
  }
}
