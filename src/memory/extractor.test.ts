import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock node:fs BEFORE importing the module under test
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue(""),
  writeFileSync: vi.fn(),
  statSync: vi.fn().mockReturnValue({ size: 100 }),
}));

// Mock backend
vi.mock("../backend/index.js", () => ({
  ask: vi.fn(),
}));

import { MemoryExtractor } from "./extractor.js";
import { readFileSync, writeFileSync } from "node:fs";
import { ask } from "../backend/index.js";

// Mock workspace
function createMockWorkspace(): any {
  return {
    userMemoryPath: vi.fn().mockReturnValue("/fake/MEMORY.md"),
  };
}

describe("MemoryExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extract", () => {
    it("extracts facts and appends to MEMORY.md", async () => {
      vi.mocked(ask).mockResolvedValueOnce({
        type: "result",
        result: JSON.stringify([
          { fact: "User prefers TypeScript", category: "preference" },
          { fact: "Working on Feishu integration", category: "context" },
        ]),
      });
      vi.mocked(readFileSync).mockReturnValueOnce("# Long-term Memory\n");

      const workspace = createMockWorkspace();
      const extractor = new MemoryExtractor(workspace);
      await extractor.extract("user1", "I love TypeScript", "Great choice!");

      expect(ask).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalled();
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain("[preference] User prefers TypeScript");
      expect(written).toContain("[context] Working on Feishu integration");
      expect(written).toContain("## Extracted");
    });

    it("handles empty extraction gracefully", async () => {
      vi.mocked(ask).mockResolvedValueOnce({ type: "result", result: "[]" });

      const workspace = createMockWorkspace();
      const extractor = new MemoryExtractor(workspace);
      await extractor.extract("user1", "hello", "hi");

      // Should NOT write when no facts extracted
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it("handles LLM returning markdown-wrapped JSON", async () => {
      vi.mocked(ask).mockResolvedValueOnce({
        type: "result",
        result: '```json\n[{"fact": "Uses VS Code", "category": "preference"}]\n```',
      });
      vi.mocked(readFileSync).mockReturnValueOnce("");

      const workspace = createMockWorkspace();
      const extractor = new MemoryExtractor(workspace);
      await extractor.extract("user1", "I use VS Code", "Nice editor!");

      expect(writeFileSync).toHaveBeenCalled();
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain("[preference] Uses VS Code");
    });

    it("does not crash on unparseable LLM response", async () => {
      vi.mocked(ask).mockResolvedValueOnce({ type: "result", result: "not json at all" });

      const workspace = createMockWorkspace();
      const extractor = new MemoryExtractor(workspace);

      await expect(extractor.extract("user1", "test", "test")).resolves.toBeUndefined();
    });

    it("does not crash on ask failure", async () => {
      vi.mocked(ask).mockRejectedValueOnce(new Error("network error"));

      const workspace = createMockWorkspace();
      const extractor = new MemoryExtractor(workspace);

      await expect(extractor.extract("user1", "test", "test")).resolves.toBeUndefined();
    });

    it("handles missing memory file (first-time user)", async () => {
      vi.mocked(ask).mockResolvedValueOnce({
        type: "result",
        result: '[{"fact": "New user", "category": "context"}]',
      });
      vi.mocked(readFileSync).mockImplementationOnce(() => { throw new Error("ENOENT"); });

      const workspace = createMockWorkspace();
      const extractor = new MemoryExtractor(workspace);
      await extractor.extract("newuser", "hello", "welcome!");

      expect(writeFileSync).toHaveBeenCalled();
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain("[context] New user");
    });
  });
});
