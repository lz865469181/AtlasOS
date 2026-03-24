import { describe, it, expect } from "vitest";
import { Session, DEFAULT_MODEL } from "./session.js";

describe("Session", () => {
  it("creates with correct defaults", () => {
    const s = new Session("id1", "agent1", "user1");
    expect(s.id).toBe("id1");
    expect(s.agentID).toBe("agent1");
    expect(s.userID).toBe("user1");
    expect(s.model).toBe("");
    expect(s.conversation).toHaveLength(0);
    expect(s.contextOverflowCount).toBe(0);
    expect(s.cliSessionId).toBeTruthy();
    expect(s.cliWorkDir).toBeUndefined();
  });

  it("addMessage appends and updates lastActiveAt", () => {
    const s = new Session("id1", "agent1", "user1");
    const before = s.lastActiveAt;

    // Small delay to ensure timestamp difference
    s.addMessage("user", "hello");
    s.addMessage("assistant", "hi there");

    expect(s.conversation).toHaveLength(2);
    expect(s.conversation[0].role).toBe("user");
    expect(s.conversation[0].content).toBe("hello");
    expect(s.conversation[1].role).toBe("assistant");
    expect(s.conversation[1].content).toBe("hi there");
    expect(s.lastActiveAt).toBeGreaterThanOrEqual(before);
  });

  it("getConversationText formats correctly", () => {
    const s = new Session("id1", "agent1", "user1");
    s.addMessage("user", "question");
    s.addMessage("assistant", "answer");

    const text = s.getConversationText();
    expect(text).toContain("[user]: question");
    expect(text).toContain("[assistant]: answer");
  });

  it("getConversationText limits messages", () => {
    const s = new Session("id1", "agent1", "user1");
    for (let i = 0; i < 20; i++) {
      s.addMessage("user", `msg-${i}`);
    }

    const text = s.getConversationText(5);
    expect(text).not.toContain("msg-0");
    expect(text).toContain("msg-19");
    expect(text).toContain("msg-15");
  });

  it("getConversationText returns empty for no messages", () => {
    const s = new Session("id1", "agent1", "user1");
    expect(s.getConversationText()).toBe("");
  });

  it("resetCliSession generates new ID and increments counter", () => {
    const s = new Session("id1", "agent1", "user1");
    const oldId = s.cliSessionId;
    s.cliWorkDir = "/some/path";

    s.resetCliSession();

    expect(s.cliSessionId).not.toBe(oldId);
    expect(s.cliWorkDir).toBeUndefined();
    expect(s.contextOverflowCount).toBe(1);

    s.resetCliSession();
    expect(s.contextOverflowCount).toBe(2);
  });

  it("attachExternalSession / detachExternalSession", () => {
    const s = new Session("id1", "agent1", "user1");
    const originalId = s.cliSessionId;

    s.attachExternalSession("ext-session-123", "/project/dir");
    expect(s.cliSessionId).toBe("ext-session-123");
    expect(s.cliWorkDir).toBe("/project/dir");

    s.detachExternalSession();
    expect(s.cliSessionId).not.toBe("ext-session-123");
    expect(s.cliWorkDir).toBeUndefined();
  });

  describe("toJSON / fromJSON", () => {
    it("round-trips correctly", () => {
      const s = new Session("id1", "agent1", "user1");
      s.model = "claude-sonnet-4-6";
      s.addMessage("user", "hello");
      s.addMessage("assistant", "world");
      s.contextOverflowCount = 2;
      s.cliWorkDir = "/some/dir";

      const json = s.toJSON();
      const restored = Session.fromJSON(json as Record<string, any>);

      expect(restored.id).toBe("id1");
      expect(restored.agentID).toBe("agent1");
      expect(restored.userID).toBe("user1");
      expect(restored.model).toBe("claude-sonnet-4-6");
      expect(restored.contextOverflowCount).toBe(2);
      expect(restored.cliWorkDir).toBe("/some/dir");
      expect(restored.conversation).toHaveLength(2);
      expect(restored.conversation[0].content).toBe("hello");
      expect(restored.conversation[1].content).toBe("world");
    });

    it("handles missing fields with defaults", () => {
      const data = { id: "x", agentID: "a", userID: "u" };
      const s = Session.fromJSON(data);

      expect(s.model).toBe("");
      expect(s.contextOverflowCount).toBe(0);
      expect(s.cliWorkDir).toBeUndefined();
      expect(s.conversation).toHaveLength(0);
      expect(s.cliSessionId).toBeTruthy(); // generates new UUID
    });

    it("skips corrupt conversation entries", () => {
      const data = {
        id: "x", agentID: "a", userID: "u",
        conversation: [
          { role: "user", content: "valid" },
          { bad: "entry" },                     // no role/content
          { role: "assistant", content: "ok" },
        ],
      };
      const s = Session.fromJSON(data);
      expect(s.conversation).toHaveLength(2);
    });
  });

  it("touch updates lastActiveAt", () => {
    const s = new Session("id1", "agent1", "user1");
    const before = s.lastActiveAt;
    s.touch();
    expect(s.lastActiveAt).toBeGreaterThanOrEqual(before);
  });
});
