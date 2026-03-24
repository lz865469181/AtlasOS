import type { SearchResult, FetchResult } from "./types.js";
import { getApiKey } from "./types.js";

const ENV_KEY = "FIRECRAWL_API_KEY";
const BASE_URL = "https://api.firecrawl.dev/v1";

/**
 * Firecrawl web search.
 * @see https://docs.firecrawl.dev/features/search
 */
export async function firecrawlSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const apiKey = getApiKey(ENV_KEY);
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const res = await fetch(`${BASE_URL}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, limit: maxResults }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Firecrawl search failed: ${res.status} ${await res.text()}`);

  const data = await res.json() as any;
  const results: SearchResult[] = (data.data ?? []).map((r: any) => ({
    title: r.title ?? r.metadata?.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? r.markdown?.slice(0, 200) ?? "",
  }));

  return results;
}

/**
 * Firecrawl web page scrape to markdown.
 */
export async function firecrawlFetch(url: string): Promise<FetchResult> {
  const apiKey = getApiKey(ENV_KEY);
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const res = await fetch(`${BASE_URL}/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Firecrawl scrape failed: ${res.status} ${await res.text()}`);

  const data = await res.json() as any;
  const result = data.data;
  if (!result) throw new Error("Firecrawl scrape: no data");

  return {
    title: result.metadata?.title ?? "",
    content: (result.markdown ?? "").slice(0, 4096),
    url,
  };
}
