import type { SearchResult, FetchResult, ImageResult } from "./types.js";
import { getApiKey, TOOL_API_KEY_ENV } from "./types.js";
import { tavilySearch, tavilyFetch } from "./tavily.js";
import { firecrawlSearch, firecrawlFetch } from "./firecrawl.js";
import { jinaFetch } from "./jina.js";
import { infoquestSearch, infoquestFetch } from "./infoquest.js";
import { imageSearch } from "./image-search.js";

export type SearchProvider = "tavily" | "firecrawl" | "infoquest";
export type FetchProvider = "tavily" | "firecrawl" | "jina" | "infoquest";

/**
 * Unified search/fetch service that picks the best available provider
 * based on which API keys are configured.
 */
export class SearchService {
  /** Get the first available search provider (has API key configured). */
  getAvailableSearchProvider(): SearchProvider | null {
    if (getApiKey(TOOL_API_KEY_ENV.tavily_api_key)) return "tavily";
    if (getApiKey(TOOL_API_KEY_ENV.firecrawl_api_key)) return "firecrawl";
    if (getApiKey(TOOL_API_KEY_ENV.infoquest_api_key)) return "infoquest";
    return null;
  }

  /** Get the first available fetch provider. Jina works without API key. */
  getAvailableFetchProvider(): FetchProvider | null {
    if (getApiKey(TOOL_API_KEY_ENV.tavily_api_key)) return "tavily";
    if (getApiKey(TOOL_API_KEY_ENV.firecrawl_api_key)) return "firecrawl";
    if (getApiKey(TOOL_API_KEY_ENV.jina_api_key)) return "jina";
    if (getApiKey(TOOL_API_KEY_ENV.infoquest_api_key)) return "infoquest";
    // Jina works without API key (lower rate limit)
    return "jina";
  }

  /** List all providers and their availability. */
  getProviderStatus(): Array<{ provider: string; type: string; available: boolean }> {
    return [
      { provider: "tavily", type: "search+fetch", available: !!getApiKey(TOOL_API_KEY_ENV.tavily_api_key) },
      { provider: "firecrawl", type: "search+fetch", available: !!getApiKey(TOOL_API_KEY_ENV.firecrawl_api_key) },
      { provider: "jina", type: "fetch", available: true }, // works without key
      { provider: "infoquest", type: "search+fetch", available: !!getApiKey(TOOL_API_KEY_ENV.infoquest_api_key) },
      { provider: "duckduckgo", type: "image_search", available: true }, // no key needed
    ];
  }

  /** Search using a specific or best-available provider. */
  async search(query: string, provider?: SearchProvider, maxResults = 5): Promise<SearchResult[]> {
    const p = provider ?? this.getAvailableSearchProvider();
    if (!p) throw new Error("No search provider available. Configure an API key in WebUI settings.");

    switch (p) {
      case "tavily": return tavilySearch(query, maxResults);
      case "firecrawl": return firecrawlSearch(query, maxResults);
      case "infoquest": return infoquestSearch(query, maxResults);
      default: throw new Error(`Unknown search provider: ${p}`);
    }
  }

  /** Fetch a URL using a specific or best-available provider. */
  async fetch(url: string, provider?: FetchProvider): Promise<FetchResult> {
    const p = provider ?? this.getAvailableFetchProvider();
    if (!p) throw new Error("No fetch provider available.");

    switch (p) {
      case "tavily": return tavilyFetch(url);
      case "firecrawl": return firecrawlFetch(url);
      case "jina": return jinaFetch(url);
      case "infoquest": return infoquestFetch(url);
      default: throw new Error(`Unknown fetch provider: ${p}`);
    }
  }

  /** Search for images using DuckDuckGo (no API key required). */
  async searchImages(query: string, maxResults = 5): Promise<ImageResult[]> {
    return imageSearch(query, maxResults);
  }
}
