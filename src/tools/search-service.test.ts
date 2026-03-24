import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SearchService } from "./search-service.js";
import { TOOL_API_KEY_ENV } from "./types.js";

describe("SearchService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all tool API keys
    for (const envVar of Object.values(TOOL_API_KEY_ENV)) {
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when no search provider has API key", () => {
    const svc = new SearchService();
    expect(svc.getAvailableSearchProvider()).toBeNull();
  });

  it("picks tavily as first search provider when key is set", () => {
    process.env.TAVILY_API_KEY = "test-key";
    const svc = new SearchService();
    expect(svc.getAvailableSearchProvider()).toBe("tavily");
  });

  it("picks firecrawl when only firecrawl key is set", () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const svc = new SearchService();
    expect(svc.getAvailableSearchProvider()).toBe("firecrawl");
  });

  it("picks infoquest when only infoquest key is set", () => {
    process.env.INFOQUEST_API_KEY = "test-key";
    const svc = new SearchService();
    expect(svc.getAvailableSearchProvider()).toBe("infoquest");
  });

  it("always has jina as fallback fetch provider", () => {
    const svc = new SearchService();
    expect(svc.getAvailableFetchProvider()).toBe("jina");
  });

  it("prefers tavily for fetch when key is set", () => {
    process.env.TAVILY_API_KEY = "test-key";
    const svc = new SearchService();
    expect(svc.getAvailableFetchProvider()).toBe("tavily");
  });

  it("getProviderStatus returns all providers", () => {
    const svc = new SearchService();
    const status = svc.getProviderStatus();
    expect(status).toHaveLength(5);
    expect(status.map((s) => s.provider)).toEqual([
      "tavily", "firecrawl", "jina", "infoquest", "duckduckgo",
    ]);
  });

  it("getProviderStatus reflects API key availability", () => {
    process.env.TAVILY_API_KEY = "key";
    const svc = new SearchService();
    const status = svc.getProviderStatus();
    const tavily = status.find((s) => s.provider === "tavily");
    const firecrawl = status.find((s) => s.provider === "firecrawl");
    expect(tavily!.available).toBe(true);
    expect(firecrawl!.available).toBe(false);
  });

  it("jina and duckduckgo always show as available", () => {
    const svc = new SearchService();
    const status = svc.getProviderStatus();
    expect(status.find((s) => s.provider === "jina")!.available).toBe(true);
    expect(status.find((s) => s.provider === "duckduckgo")!.available).toBe(true);
  });

  it("search throws when no provider is available", async () => {
    const svc = new SearchService();
    await expect(svc.search("test")).rejects.toThrow("No search provider available");
  });
});
