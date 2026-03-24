/** Standard search result format across all providers. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Standard image search result. */
export interface ImageResult {
  title: string;
  image_url: string;
  thumbnail_url: string;
}

/** Fetched web page content. */
export interface FetchResult {
  title: string;
  content: string;
  url: string;
}

/** API key configuration for all tool providers. */
export interface ToolApiKeys {
  tavily_api_key?: string;
  firecrawl_api_key?: string;
  jina_api_key?: string;
  infoquest_api_key?: string;
}

/** Env var names used by each provider. */
export const TOOL_API_KEY_ENV: Record<keyof ToolApiKeys, string> = {
  tavily_api_key: "TAVILY_API_KEY",
  firecrawl_api_key: "FIRECRAWL_API_KEY",
  jina_api_key: "JINA_API_KEY",
  infoquest_api_key: "INFOQUEST_API_KEY",
};

/** Get an API key from process.env. */
export function getApiKey(envVar: string): string | undefined {
  return process.env[envVar] || undefined;
}
