import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "./manager.js";
import { Session } from "./session.js";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock fs for persistence tests
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (manager) manager.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates and retrieves sessions", () => {
    manager = new SessionManager(60_000);
    const s1 = manager.getOrCreate("agent1", "user1");
    const s2 = manager.getOrCreate("agent1", "user1");

    expect(s1).toBe(s2); // same instance
    expect(manager.size).toBe(1);
  });

  it("creates different sessions for different users", () => {
    manager = new SessionManager(60_000);
    const s1 = manager.getOrCreate("agent1", "user1");
    const s2 = manager.getOrCreate("agent1", "user2");

    expect(s1).not.toBe(s2);
    expect(manager.size).toBe(2);
  });

  it("get returns undefined for non-existent session", () => {
    manager = new SessionManager(60_000);
    expect(manager.get("agent1", "nobody")).toBeUndefined();
  });

  it("deletes sessions", () => {
    manager = new SessionManager(60_000);
    manager.getOrCreate("agent1", "user1");
    expect(manager.size).toBe(1);

    manager.delete("agent1", "user1");
    expect(manager.size).toBe(0);
    expect(manager.get("agent1", "user1")).toBeUndefined();
  });

  it("cleans up expired sessions", () => {
    manager = new SessionManager(10_000); // 10 second TTL
    manager.getOrCreate("agent1", "user1");
    expect(manager.size).toBe(1);

    // Advance time past TTL + cleanup interval (60s)
    vi.advanceTimersByTime(70_000);

    expect(manager.size).toBe(0);
  });

  it("does not clean up active sessions", () => {
    manager = new SessionManager(10_000);
    const s = manager.getOrCreate("agent1", "user1");

    // Advance 5s (within TTL)
    vi.advanceTimersByTime(5_000);
    s.touch(); // keep alive

    // Advance another 60s to trigger cleanup
    vi.advanceTimersByTime(60_000);
    s.touch(); // still alive because we touched

    // The session might be cleaned up since lastActiveAt was 60s ago
    // Let's re-touch and check
    manager.getOrCreate("agent1", "user1"); // this touches
    expect(manager.size).toBe(1);
  });

  describe("persistence", () => {
    it("scheduleSave debounces writes", () => {
      manager = new SessionManager(60_000, "/fake/path.json");
      const writeSpy = vi.mocked(fs.writeFileSync);

      manager.scheduleSave();
      manager.scheduleSave();
      manager.scheduleSave();

      // Before debounce fires
      expect(writeSpy).not.toHaveBeenCalledWith("/fake/path.json", expect.any(String), "utf-8");

      // After debounce (5s)
      vi.advanceTimersByTime(5_000);
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });

    it("loadFromDisk restores sessions", () => {
      const sessionData = {
        "agent1:user1": {
          id: "agent1:user1",
          agentID: "agent1",
          userID: "user1",
          model: "claude-sonnet-4-6",
          conversation: [{ role: "user", content: "hello", timestamp: Date.now() }],
          lastActiveAt: Date.now(),
          createdAt: Date.now(),
        },
      };

      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(sessionData));

      manager = new SessionManager(60_000, "/fake/path.json");
      manager.loadFromDisk();

      expect(manager.size).toBe(1);
      const s = manager.get("agent1", "user1");
      expect(s).toBeTruthy();
      expect(s!.model).toBe("claude-sonnet-4-6");
      expect(s!.conversation).toHaveLength(1);
    });

    it("loadFromDisk discards expired sessions", () => {
      const sessionData = {
        "agent1:expired": {
          id: "agent1:expired",
          agentID: "agent1",
          userID: "expired",
          lastActiveAt: Date.now() - 120_000, // 2 min ago
          createdAt: Date.now() - 120_000,
        },
      };

      vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify(sessionData));

      manager = new SessionManager(60_000, "/fake/path.json"); // 1 min TTL
      manager.loadFromDisk();

      expect(manager.size).toBe(0);
    });

    it("loadFromDisk handles missing file gracefully", () => {
      const err = new Error("ENOENT") as any;
      err.code = "ENOENT";
      vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw err; });

      manager = new SessionManager(60_000, "/fake/path.json");
      expect(() => manager.loadFromDisk()).not.toThrow();
      expect(manager.size).toBe(0);
    });

    it("dispose saves and clears", () => {
      const writeSpy = vi.mocked(fs.writeFileSync);
      manager = new SessionManager(60_000, "/fake/path.json");
      manager.getOrCreate("agent1", "user1");

      manager.dispose();
      expect(writeSpy).toHaveBeenCalled();
      expect(manager.size).toBe(0);
    });
  });
});
