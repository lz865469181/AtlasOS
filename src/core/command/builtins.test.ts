import { describe, it, expect, vi } from "vitest";
import { createSessionsCommand, createResumeCommand } from "./builtins.js";
import { ParkedSessionStore } from "../session/parked.js";
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

describe("/sessions command", () => {
  it("replies with empty message when no parked sessions", async () => {
    const store = new ParkedSessionStore();
    const cmd = createSessionsCommand(store);
    const ctx = mockCtx();
    await cmd.handler(ctx);
    expect(ctx.replies.length + ctx.cards.length).toBeGreaterThan(0);
    const all = [...ctx.replies, ...ctx.cards].join(" ");
    expect(all).toContain("No parked sessions");
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
