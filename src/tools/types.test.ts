import { describe, it, expect } from "vitest";
import { TOOL_API_KEY_ENV, getApiKey } from "./types.js";

describe("TOOL_API_KEY_ENV", () => {
  it("has entries for all 4 providers", () => {
    expect(Object.keys(TOOL_API_KEY_ENV)).toEqual([
      "tavily_api_key",
      "firecrawl_api_key",
      "jina_api_key",
      "infoquest_api_key",
    ]);
  });

  it("maps to correct env var names", () => {
    expect(TOOL_API_KEY_ENV.tavily_api_key).toBe("TAVILY_API_KEY");
    expect(TOOL_API_KEY_ENV.firecrawl_api_key).toBe("FIRECRAWL_API_KEY");
    expect(TOOL_API_KEY_ENV.jina_api_key).toBe("JINA_API_KEY");
    expect(TOOL_API_KEY_ENV.infoquest_api_key).toBe("INFOQUEST_API_KEY");
  });
});

describe("getApiKey", () => {
  it("returns undefined for unset env var", () => {
    delete process.env.TEST_NONEXISTENT_KEY;
    expect(getApiKey("TEST_NONEXISTENT_KEY")).toBeUndefined();
  });

  it("returns value for set env var", () => {
    process.env.TEST_TOOL_KEY = "my-key-123";
    expect(getApiKey("TEST_TOOL_KEY")).toBe("my-key-123");
    delete process.env.TEST_TOOL_KEY;
  });

  it("returns undefined for empty string", () => {
    process.env.TEST_EMPTY_KEY = "";
    expect(getApiKey("TEST_EMPTY_KEY")).toBeUndefined();
    delete process.env.TEST_EMPTY_KEY;
  });
});
