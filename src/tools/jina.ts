import type { FetchResult } from "./types.js";
import { getApiKey } from "./types.js";

const ENV_KEY = "JINA_API_KEY";
const READER_URL = "https://r.jina.ai/";

/**
 * Jina AI web page reader — converts URL to clean markdown.
 * API key is optional but recommended for higher rate limits.
 * @see https://jina.ai/reader
 */
export async function jinaFetch(url: string, timeout = 10): Promise<FetchResult> {
  const apiKey = getApiKey(ENV_KEY);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Return-Format": "markdown",
    "X-Timeout": String(timeout),
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(READER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
  });

  if (!res.ok) throw new Error(`Jina fetch failed: ${res.status} ${await res.text()}`);

  const content = await res.text();
  if (!content) throw new Error("Jina fetch: empty response");

  // Extract title from first markdown heading if present
  const titleMatch = content.match(/^#\s+(.+)/m);
  const title = titleMatch?.[1] ?? "";

  return {
    title,
    content: content.slice(0, 4096),
    url,
  };
}
