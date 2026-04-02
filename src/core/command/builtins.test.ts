import { describe, it, expect, vi } from "vitest";
import { createSessionsCommand, createResumeCommand, createListCommand } from "./builtins.js";
import { ParkedSessionStore } from "../session/parked.js";
import { SessionManager } from "../session/manager.js";
import type { CommandContext } from "./registry.js";

function mockCtx(args = ""): CommandContext & { replies: string[]; cards: string[] } {
  const replies: string[] = [];
  const cards: string[] = [];
  return {
    args,
    userID: "user-1",
    chatID: "chat-1",
    chatType: "p2p" as const,
    platform: "feishu",
    reply: vi.fn(async (text: string) => { replies.push(text); }),
    replyCard: vi.fn(async (json: string) => { cards.push(json); }),
    replies,
    cards,
  };
}

function mockEngine(opts?: { parked?: ParkedSessionStore; sessions?: SessionManager }) {
  const parkedSessions = opts?.parked ?? new ParkedSessionStore();
  const sessionMgr = opts?.sessions ?? new SessionManager(3_600_000);
  return { parkedSessions, sessionMgr } as any;
}

describe("/sessions command", () => {
  it("replies with empty message when no parked sessions", async () => {
    const store = new ParkedSessionStore();
    const cmd = createSessionsCommand(store);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    expect(ctx.replies.length + ctx.cards.length).toBeGreaterThan(0);
    const all = [...ctx.replies, ...ctx.cards].join(" ");
    expect(all).toContain("No sessions");
  });

  it("lists parked sessions", async () => {
    const store = new ParkedSessionStore();
    store.park({ name: "fix-bug", cliSessionId: "id1", parkedAt: Date.now() - 60_000 });
    store.park({ name: "refactor", cliSessionId: "id2", parkedAt: Date.now() });
    const cmd = createSessionsCommand(store);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    const all = [...ctx.replies, ...ctx.cards].join(" ");
    expect(all).toContain("fix-bug");
    expect(all).toContain("refactor");
  });
});

describe("/resume command", () => {
  it("replies with error when no name given", async () => {
    const store = new ParkedSessionStore();
    const resumeFn = vi.fn();
    const cmd = createResumeCommand(store, resumeFn);
    const ctx = mockCtx("");
    await cmd.handler(ctx);
    expect(ctx.replies[0]).toContain("Usage");
  });

  it("replies with error when session not found", async () => {
    const store = new ParkedSessionStore();
    const resumeFn = vi.fn();
    const cmd = createResumeCommand(store, resumeFn);
    const ctx = mockCtx("nonexistent");
    await cmd.handler(ctx);
    expect(ctx.replies[0]).toContain("not found");
  });

  it("calls resumeFn and removes parked session on success", async () => {
    const store = new ParkedSessionStore();
    store.park({ name: "my-task", cliSessionId: "abc", parkedAt: Date.now() });
    const resumeFn = vi.fn().mockResolvedValue(undefined);
    const cmd = createResumeCommand(store, resumeFn);
    const ctx = mockCtx("my-task");
    await cmd.handler(ctx);
    expect(resumeFn).toHaveBeenCalledWith("abc", expect.objectContaining({ userID: "user-1" }));
    expect(store.get("my-task")).toBeUndefined();
    expect(ctx.replies.some((r) => r.includes("Resumed"))).toBe(true);
  });
});

describe("/list command", () => {
  it("shows empty message when no sessions exist", async () => {
    const engine = mockEngine();
    const cmd = createListCommand(engine);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    const all = ctx.replies.join(" ");
    expect(all).toContain("No sessions");
  });

  it("shows active sessions with chat history", async () => {
    const sessions = new SessionManager(3_600_000);
    const meta = sessions.getOrCreate("proj:user1", "user1", "claude");
    meta.model = "claude-sonnet-4-6";
    sessions.appendChat("proj:user1", { role: "user", text: "帮我修复登录bug", ts: Date.now() - 5000 });
    sessions.appendChat("proj:user1", { role: "assistant", text: "已修复，问题在于token过期未刷新", ts: Date.now() });

    const engine = mockEngine({ sessions });
    const cmd = createListCommand(engine);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    const all = ctx.replies.join(" ");
    expect(all).toContain("All Sessions");
    expect(all).toContain("proj:user1");
    expect(all).toContain("Active");
    expect(all).toContain("👤");
    expect(all).toContain("🤖");
    expect(all).toContain("帮我修复登录bug");
    expect(all).toContain("已修复");
  });

  it("shows parked sessions alongside active sessions", async () => {
    const sessions = new SessionManager(3_600_000);
    sessions.getOrCreate("proj:user1", "user1", "claude");

    const parked = new ParkedSessionStore();
    parked.park({ name: "refactor", cliSessionId: "id2", status: "parked", startedAt: Date.now() - 7200_000, parkedAt: Date.now() - 3600_000 });

    const engine = mockEngine({ sessions, parked });
    const cmd = createListCommand(engine);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    const all = ctx.replies.join(" ");
    expect(all).toContain("proj:user1");
    expect(all).toContain("refactor");
    expect(all).toContain("Parked");
  });

  it("deduplicates parked sessions that share cliSessionId with active sessions", async () => {
    const sessions = new SessionManager(3_600_000);
    const meta = sessions.getOrCreate("proj:user1", "user1", "claude");
    meta.cliSessionId = "shared-cli-id";

    const parked = new ParkedSessionStore();
    // Same cliSessionId as the active session — should be deduped
    parked.park({ name: "my-project", cliSessionId: "shared-cli-id", status: "running", startedAt: Date.now() - 60_000, parkedAt: Date.now() });
    // Different cliSessionId — should still appear
    parked.park({ name: "other-project", cliSessionId: "other-cli-id", status: "parked", startedAt: Date.now() - 7200_000, parkedAt: Date.now() - 3600_000 });

    const engine = mockEngine({ sessions, parked });
    const cmd = createListCommand(engine);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    const all = ctx.replies.join(" ");
    // Active session should appear
    expect(all).toContain("proj:user1");
    // Parked session with same cliSessionId should NOT appear (deduped)
    expect(all).not.toContain("my-project");
    // Different parked session should appear
    expect(all).toContain("other-project");
  });

  it("truncates long chat messages", async () => {
    const sessions = new SessionManager(3_600_000);
    sessions.getOrCreate("proj:user1", "user1", "claude");
    const longText = "a".repeat(200);
    sessions.appendChat("proj:user1", { role: "user", text: longText, ts: Date.now() });

    const engine = mockEngine({ sessions });
    const cmd = createListCommand(engine);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    const all = ctx.replies.join(" ");
    // Text should be truncated (100 char by appendChat + 80 char display truncation)
    expect(all).toContain("...");
    expect(all).not.toContain("a".repeat(200));
  });

  it("shows only last 4 chat entries per session", async () => {
    const sessions = new SessionManager(3_600_000);
    sessions.getOrCreate("proj:user1", "user1", "claude");
    // Add 6 entries, only last 4 should be displayed
    for (let i = 1; i <= 3; i++) {
      sessions.appendChat("proj:user1", { role: "user", text: `msg${i}`, ts: Date.now() - (6 - 2 * i) * 1000 });
      sessions.appendChat("proj:user1", { role: "assistant", text: `reply${i}`, ts: Date.now() - (5 - 2 * i) * 1000 });
    }

    const engine = mockEngine({ sessions });
    const cmd = createListCommand(engine);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    const all = ctx.replies.join(" ");
    // msg1 should not appear (it's entry 1 of 6, only last 4 shown)
    expect(all).not.toContain("msg1");
    expect(all).not.toContain("reply1");
    // msg2, reply2, msg3, reply3 should appear (last 4)
    expect(all).toContain("msg2");
    expect(all).toContain("reply2");
    expect(all).toContain("msg3");
    expect(all).toContain("reply3");
  });
});
