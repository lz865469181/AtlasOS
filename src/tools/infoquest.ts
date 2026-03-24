import type { SearchResult, FetchResult } from "./types.js";
import { getApiKey } from "./types.js";

const ENV_KEY = "INFOQUEST_API_KEY";
const SEARCH_URL = "https://search.infoquest.bytepluses.com";
const READER_URL = "https://reader.infoquest.bytepluses.com";

/**
 * InfoQuest (BytePlus) web search.
 */
export async function infoquestSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const apiKey = getApiKey(ENV_KEY);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ format: "JSON", query }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`InfoQuest search failed: ${res.status} ${await res.text()}`);

  const data = await res.json() as any;
  const searchResult = data.search_result;
  if (!searchResult) throw new Error("InfoQuest search: no search_result in response");

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const group of searchResult.results ?? []) {
    const content = group.content?.results ?? {};

    // Organic results
    for (const item of content.organic ?? []) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      results.push({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.desc ?? "",
      });
    }

    // Top stories
    for (const item of content.top_stories?.items ?? []) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      results.push({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.source ?? "",
      });
    }
  }

  return results.slice(0, maxResults);
}

/**
 * InfoQuest (BytePlus) web page reader.
 */
export async function infoquestFetch(url: string, timeout = 10): Promise<FetchResult> {
  const apiKey = getApiKey(ENV_KEY);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const body: Record<string, any> = { url, format: "HTML" };
  if (timeout > 0) body["timeout"] = timeout;

  const res = await fetch(READER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`InfoQuest fetch failed: ${res.status} ${await res.text()}`);

  let content: string;
  try {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      content = data.reader_result ?? data.content ?? JSON.stringify(data);
    } catch {
      content = text;
    }
  } catch {
    content = "";
  }

  // Extract title from first heading if HTML/markdown
  const titleMatch = content.match(/<title>([^<]+)<\/title>/i) ?? content.match(/^#\s+(.+)/m);
  const title = titleMatch?.[1] ?? "";

  return {
    title,
    content: content.slice(0, 4096),
    url,
  };
}
