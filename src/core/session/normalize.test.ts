import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { normalizeWorkspacePath } from "./normalize.js";

describe("normalizeWorkspacePath", () => {
  it("resolves a relative path to absolute", () => {
    const result = normalizeWorkspacePath("foo/bar");
    expect(result).toBe(resolve("foo/bar"));
    expect(result).toMatch(/^[A-Z]:\\/i); // absolute on Windows
  });

  it("removes trailing slashes", () => {
    const abs = resolve(".");
    // resolve() already strips trailing slashes, so the result should match
    const result = normalizeWorkspacePath(abs + "/");
    expect(result).not.toMatch(/[/\\]$/);
  });

  it("cleans .. segments", () => {
    const base = resolve(".");
    const input = base + "/src/../src";
    const result = normalizeWorkspacePath(input);
    expect(result).not.toContain("..");
  });

  it("returns an already-clean absolute path unchanged", () => {
    const abs = resolve(".");
    const result = normalizeWorkspacePath(abs);
    expect(result).toBe(abs);
  });

  it("falls back to resolve for non-existent paths (no throw)", () => {
    const input = "/this/path/does/not/exist/at/all";
    expect(() => normalizeWorkspacePath(input)).not.toThrow();
    const result = normalizeWorkspacePath(input);
    expect(result).toBe(resolve(input));
  });
});
