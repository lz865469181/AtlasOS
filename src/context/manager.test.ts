import { describe, it, expect, vi } from "vitest";
import { ContextManager } from "./manager.js";
import { Session } from "../session/session.js";

// Mock the backend ask function
vi.mock("../backend/index.js", () => ({
  ask: vi.fn().mockResolvedValue({ result: "Summary of the conversation." }),
}));

describe("ContextManager", () => {
  describe("estimateTokens", () => {
    it("estimates tokens from conversation length", () => {
      const cm = new ContextManager({ maxTokens: 100_000 });
      const session = new Session("id", "agent", "user");

      // Empty conversation
      expect(cm.estimateTokens(session)).toBe(0);

      // Add messages (350 chars total → ~100 tokens)
      session.addMessage("user", "a".repeat(175));
      session.addMessage("assistant", "b".repeat(175));

      const tokens = cm.estimateTokens(session);
      expect(tokens).toBe(Math.ceil(350 / 3.5)); // 100
    });

    it("grows proportionally with conversation", () => {
      const cm = new ContextManager();
      const session = new Session("id", "agent", "user");

      session.addMessage("user", "x".repeat(1000));
      const t1 = cm.estimateTokens(session);

      session.addMessage("assistant", "y".repeat(1000));
      const t2 = cm.estimateTokens(session);

      expect(t2).toBeGreaterThan(t1);
      expect(t2).toBeCloseTo(t1 * 2, -1);
    });
  });

  describe("maybeSummarize", () => {
    it("does nothing when under threshold", async () => {
      const { ask } = await import("../backend/index.js");
      const cm = new ContextManager({ maxTokens: 100_000 });
      const session = new Session("id", "agent", "user");

      session.addMessage("user", "short message");
      session.addMessage("assistant", "short reply");

      await cm.maybeSummarize(session);

      expect(ask).not.toHaveBeenCalled();
      expect(session.conversation).toHaveLength(2);
    });

    it("summarizes when over threshold", async () => {
      const { ask } = await import("../backend/index.js");
      vi.mocked(ask).mockResolvedValueOnce({ type: "result", result: "Condensed summary of old messages." });

      // Very low threshold to trigger summarization
      const cm = new ContextManager({ maxTokens: 10, preserveRecent: 2 });
      const session = new Session("id", "agent", "user");

      // Add enough messages to exceed threshold
      for (let i = 0; i < 10; i++) {
        session.addMessage("user", `message ${i} with some content`);
        session.addMessage("assistant", `reply ${i} with some content`);
      }

      await cm.maybeSummarize(session);

      expect(ask).toHaveBeenCalled();
      // Should have: 1 summary + 2 recent messages = 3
      expect(session.conversation).toHaveLength(3);
      expect(session.conversation[0].content).toContain("[Context Summary]");
      expect(session.conversation[0].content).toContain("Condensed summary");
    });

    it("does not crash when too few messages", async () => {
      const cm = new ContextManager({ maxTokens: 1, preserveRecent: 10 });
      const session = new Session("id", "agent", "user");

      // Only 2 messages, preserveRecent=10 means nothing to summarize
      session.addMessage("user", "x".repeat(100));
      session.addMessage("assistant", "y".repeat(100));

      await cm.maybeSummarize(session);
      expect(session.conversation).toHaveLength(2); // unchanged
    });

    it("handles ask failure gracefully (non-fatal)", async () => {
      const { ask } = await import("../backend/index.js");
      vi.mocked(ask).mockRejectedValueOnce(new Error("API down"));

      const cm = new ContextManager({ maxTokens: 1, preserveRecent: 2 });
      const session = new Session("id", "agent", "user");

      for (let i = 0; i < 10; i++) {
        session.addMessage("user", `msg ${i}`);
      }

      // Should not throw
      await expect(cm.maybeSummarize(session)).resolves.toBeUndefined();
      // Conversation unchanged on failure
      expect(session.conversation).toHaveLength(10);
    });
  });
});
