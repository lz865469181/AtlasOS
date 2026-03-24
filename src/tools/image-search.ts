import type { ImageResult } from "./types.js";

const DUCKDUCKGO_URL = "https://duckduckgo.com";

/**
 * DuckDuckGo image search — no API key required.
 * Uses the DuckDuckGo HTML API to fetch image results.
 */
export async function imageSearch(query: string, maxResults = 5): Promise<ImageResult[]> {
  // Step 1: Get the vqd token required by DDG
  const tokenRes = await fetch(`${DUCKDUCKGO_URL}/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenRes.ok) throw new Error(`DuckDuckGo token request failed: ${tokenRes.status}`);

  const html = await tokenRes.text();
  const vqdMatch = html.match(/vqd=["']([^"']+)/);
  if (!vqdMatch) throw new Error("Failed to extract DuckDuckGo vqd token");

  const vqd = vqdMatch[1];

  // Step 2: Fetch image results
  const params = new URLSearchParams({
    l: "wt-wt",
    o: "json",
    q: query,
    vqd: vqd!,
    f: ",,,,,",
    p: "1",
  });

  const imgRes = await fetch(`${DUCKDUCKGO_URL}/i.js?${params}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!imgRes.ok) throw new Error(`DuckDuckGo image search failed: ${imgRes.status}`);

  const data = await imgRes.json() as any;
  const results: ImageResult[] = (data.results ?? []).slice(0, maxResults).map((r: any) => ({
    title: r.title ?? "",
    image_url: r.image ?? r.thumbnail ?? "",
    thumbnail_url: r.thumbnail ?? r.image ?? "",
  }));

  return results;
}
