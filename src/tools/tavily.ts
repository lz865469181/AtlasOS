import type { SearchResult, FetchResult } from "./types.js";
import { getApiKey } from "./types.js";

const ENV_KEY = "TAVILY_API_KEY";
const BASE_URL = "https://api.tavily.com";

/**
 * Tavily web search.
 * @see https://docs.tavily.com/docs/rest-api/api-reference
 */
export async function tavilySearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const apiKey = getApiKey(ENV_KEY);
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch(`${BASE_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);

  const data = await res.json() as any;
  const results: SearchResult[] = (data.results ?? []).map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));

  return results;
}

/**
 * Tavily web page extraction (fetch).
 */
export async function tavilyFetch(url: string): Promise<FetchResult> {
  const apiKey = getApiKey(ENV_KEY);
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch(`${BASE_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      urls: [url],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Tavily fetch failed: ${res.status} ${await res.text()}`);

  const data = await res.json() as any;

  if (data.failed_results?.length > 0) {
    throw new Error(`Tavily extract failed: ${data.failed_results[0].error}`);
  }

  const result = data.results?.[0];
  if (!result) throw new Error("Tavily extract: no results");

  return {
    title: result.title ?? "",
    content: (result.raw_content ?? "").slice(0, 4096),
    url,
  };
}
