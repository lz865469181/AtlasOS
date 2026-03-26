import { describe, it, expect, vi, beforeEach } from "vitest";
import { Engine } from "./engine.js";
import type { Agent, AgentSession, AgentEvent, MessageEvent, PlatformSender, PlatformAdapter } from "./interfaces.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockSender(): PlatformSender {
  return {
    sendText: vi.fn().mockResolvedValue(undefined),
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
    sendInteractiveCard: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPlatform(name = "test"): PlatformAdapter & { handler?: any } {
  let handler: any;
  return {
    name,
    handler: undefined,
    start: vi.fn(async (h) => { handler = h; }),
    stop: vi.fn().mockResolvedValue(undefined),
    getSender: vi.fn(() => createMockSender()),
    get _handler() { return handler; },
  } as any;
}

function createMockAgent(events: AgentEvent[] = []): Agent {
  const mockSession: AgentSession = {
    send: vi.fn().mockResolvedValue(undefined),
    events: vi.fn(async function* () {
      for (const ev of events) yield ev;
    }),
    respondPermission: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    name: "mock",
    startSession: vi.fn().mockResolvedValue(mockSession),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function createMessageEvent(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    platform: "test",
    messageID: `msg-${Date.now()}-${Math.random()}`,
    chatID: "chat-1",
    chatType: "p2p",
    userID: "user-1",
    text: "hello",
    isMention: true,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Engine", () => {
  it("creates with required config", () => {
    const agent = createMockAgent();
    const engine = new Engine(agent, {
      project: "test",
      dataDir: "/tmp/test",
      sessionTtlMs: 3600_000,
    });
    expect(engine.project).toBe("test");
    expect(engine.agent).toBe(agent);
  });

  it("adds platforms", () => {
    const agent = createMockAgent();
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const platform = createMockPlatform("feishu");
    engine.addPlatform(platform);
    expect(engine.platforms).toHaveLength(1);
    expect(engine.platforms[0]!.name).toBe("feishu");
  });

  it("starts all platforms", async () => {
    const agent = createMockAgent();
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const p1 = createMockPlatform("feishu");
    const p2 = createMockPlatform("telegram");
    engine.addPlatform(p1);
    engine.addPlatform(p2);
    await engine.start();
    expect(p1.start).toHaveBeenCalledOnce();
    expect(p2.start).toHaveBeenCalledOnce();
    await engine.stop();
  });

  it("deduplicates messages", async () => {
    const agent = createMockAgent([{ type: "result", content: "reply" }]);
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    const event = createMessageEvent({ messageID: "dup-1" });
    await engine.handleMessage(event, sender, platform);
    await engine.handleMessage(event, sender, platform); // duplicate

    // Agent should only be called once
    expect(agent.startSession).toHaveBeenCalledOnce();
    await engine.stop();
  });

  it("dispatches slash commands", async () => {
    const agent = createMockAgent();
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    const handler = vi.fn();
    engine.commands.register({ name: "ping", description: "Ping", handler });

    const event = createMessageEvent({ text: "/ping hello" });
    await engine.handleMessage(event, sender, platform);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].args).toBe("hello");

    // Agent should NOT be called for commands
    expect(agent.startSession).not.toHaveBeenCalled();
    await engine.stop();
  });

  it("sends result to chat via sender", async () => {
    const agent = createMockAgent([
      { type: "text", content: "Hello " },
      { type: "text", content: "world!" },
      { type: "result", content: "Hello world!" },
    ]);
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    await engine.handleMessage(createMessageEvent(), sender, platform);

    // Should send final result via markdown
    expect(sender.sendMarkdown).toHaveBeenCalled();
    await engine.stop();
  });

  it("sends tool use notification", async () => {
    const agent = createMockAgent([
      { type: "tool_use", tool: "bash", input: "ls" },
      { type: "result", content: "done" },
    ]);
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    await engine.handleMessage(createMessageEvent(), sender, platform);

    // Should send tool notification
    const textCalls = (sender.sendText as any).mock.calls;
    expect(textCalls.some((c: any[]) => c[1].includes("bash"))).toBe(true);
    await engine.stop();
  });

  it("handles errors from agent", async () => {
    const agent = createMockAgent([
      { type: "error", message: "something broke" },
    ]);
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    await engine.handleMessage(createMessageEvent(), sender, platform);

    const textCalls = (sender.sendText as any).mock.calls;
    expect(textCalls.some((c: any[]) => c[1].includes("something broke"))).toBe(true);
    await engine.stop();
  });

  it("handles permission request with auto-approve", async () => {
    // First message triggers permission request
    let permissionCallback: ((allowed: boolean, msg?: string) => void) | undefined;
    const mockSession: AgentSession = {
      send: vi.fn().mockResolvedValue(undefined),
      events: vi.fn(async function* () {
        yield {
          type: "permission_request" as const,
          id: "perm-1",
          tool: "bash",
          input: "echo hello",
        };
        yield { type: "result" as const, content: "done" };
      }),
      respondPermission: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const agent: Agent = {
      name: "mock",
      startSession: vi.fn().mockResolvedValue(mockSession),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    // First message - triggers permission prompt
    await engine.handleMessage(createMessageEvent({ messageID: "m1" }), sender, platform);

    // Permission card should have been sent
    expect(sender.sendInteractiveCard).toHaveBeenCalled();

    await engine.stop();
  });

  it("stops cleanly", async () => {
    const agent = createMockAgent();
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const platform = createMockPlatform();
    engine.addPlatform(platform);
    await engine.start();
    await engine.stop();
    expect(platform.stop).toHaveBeenCalledOnce();
    expect(agent.stop).toHaveBeenCalledOnce();
  });

  it("exposes parkedSessions store", () => {
    const agent = createMockAgent();
    const engine = new Engine(agent, {
      project: "test",
      dataDir: "/tmp/test",
      sessionTtlMs: 3600_000,
    });
    expect(engine.parkedSessions).toBeDefined();
    expect(engine.parkedSessions.list()).toEqual([]);
  });

  it("resumes a parked session with sessionId", async () => {
    const agent = createMockAgent([{ type: "result", content: "resumed!" }]);
    const engine = new Engine(agent, {
      project: "test",
      dataDir: "/tmp/test",
      sessionTtlMs: 3600_000,
    });
    const sender = createMockSender();
    const platform = createMockPlatform();

    engine.parkedSessions.park({
      name: "my-task",
      cliSessionId: "real-claude-id-123",
      parkedAt: Date.now(),
    });

    engine.commands.register({
      name: "resume",
      description: "Resume parked session",
      handler: async (ctx) => {
        const name = ctx.args.trim();
        const parked = engine.parkedSessions.get(name);
        if (!parked) {
          await ctx.reply("not found");
          return;
        }
        await ctx.reply(`Resuming '${name}'...`);
      },
    });

    const event = createMessageEvent({ text: "/resume my-task" });
    await engine.handleMessage(event, sender, platform);
    const textCalls = (sender.sendText as any).mock.calls;
    expect(textCalls.some((c: any[]) => c[1].includes("Resuming"))).toBe(true);
    await engine.stop();
  });

  it("appends context consumption indicator when usage is present", async () => {
    const agent = createMockAgent([
      { type: "text", content: "Hello!" },
      { type: "result", content: "Hello!", usage: { inputTokens: 50_000, outputTokens: 1_000 } },
    ]);
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    await engine.handleMessage(createMessageEvent(), sender, platform);

    const mdCalls = (sender.sendMarkdown as any).mock.calls;
    expect(mdCalls.length).toBeGreaterThan(0);
    const sentText: string = mdCalls[0][1];
    // 50000 / 200000 = 25%
    expect(sentText).toContain("[ctx: 25%]");
    await engine.stop();
  });

  it("does not append context indicator when no usage", async () => {
    const agent = createMockAgent([
      { type: "result", content: "No usage info" },
    ]);
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    await engine.handleMessage(createMessageEvent(), sender, platform);

    const mdCalls = (sender.sendMarkdown as any).mock.calls;
    expect(mdCalls.length).toBeGreaterThan(0);
    const sentText: string = mdCalls[0][1];
    expect(sentText).not.toContain("[ctx:");
    await engine.stop();
  });

  it("uses agent contextWindowSize for percentage calculation", async () => {
    const agent = createMockAgent([
      { type: "result", content: "Done", usage: { inputTokens: 80_000, outputTokens: 500 } },
    ]);
    (agent as any).contextWindowSize = 100_000;
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    await engine.handleMessage(createMessageEvent(), sender, platform);

    const mdCalls = (sender.sendMarkdown as any).mock.calls;
    const sentText: string = mdCalls[0][1];
    // 80000 / 100000 = 80%
    expect(sentText).toContain("[ctx: 80%]");
    await engine.stop();
  });

  it("rounds context percentage correctly", async () => {
    const agent = createMockAgent([
      { type: "result", content: "Done", usage: { inputTokens: 33_333, outputTokens: 100 } },
    ]);
    const engine = new Engine(agent, { project: "test", dataDir: "/tmp", sessionTtlMs: 60_000 });
    const sender = createMockSender();
    const platform = createMockPlatform();

    await engine.handleMessage(createMessageEvent(), sender, platform);

    const mdCalls = (sender.sendMarkdown as any).mock.calls;
    const sentText: string = mdCalls[0][1];
    // 33333 / 200000 = 16.6665 => 17%
    expect(sentText).toContain("[ctx: 17%]");
    await engine.stop();
  });

  it("full beam-flow cycle: park → list → resume", async () => {
    const agent = createMockAgent([{ type: "result", content: "I remember!" }]);
    const engine = new Engine(agent, {
      project: "test",
      dataDir: "/tmp/test",
      sessionTtlMs: 3600_000,
    });

    // 1. Park a session
    engine.parkedSessions.park({
      name: "debug-issue",
      cliSessionId: "real-session-uuid-456",
      parkedAt: Date.now(),
    });

    // 2. List should show it
    expect(engine.parkedSessions.list()).toHaveLength(1);
    expect(engine.parkedSessions.get("debug-issue")?.cliSessionId).toBe("real-session-uuid-456");

    // 3. Resume
    const sender = createMockSender();
    await engine.resumeSession("real-session-uuid-456", {
      platform: "feishu",
      chatID: "chat-1",
      chatType: "p2p",
      userID: "user-1",
      messageID: "msg-resume",
    });

    // 4. Verify agent was called with sessionId
    expect(agent.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "real-session-uuid-456" }),
    );

    // 5. Remove from parked
    engine.parkedSessions.remove("debug-issue");
    expect(engine.parkedSessions.list()).toHaveLength(0);

    await engine.stop();
  });

  describe("session resume fallback", () => {
    it("retries with fresh session when resume fails in resumeSession", async () => {
      const freshSession: AgentSession = {
        sessionId: "fresh-id",
        send: vi.fn().mockResolvedValue(undefined),
        events: vi.fn(async function* () {
          yield { type: "result" as const, content: "ok" };
        }),
        respondPermission: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const agent: Agent = {
        name: "mock",
        startSession: vi.fn()
          .mockRejectedValueOnce(new Error("session too large"))
          .mockResolvedValueOnce(freshSession),
        stop: vi.fn().mockResolvedValue(undefined),
      };

      const engine = new Engine(agent, {
        project: "test",
        dataDir: "/tmp/test",
        sessionTtlMs: 3600_000,
      });

      await engine.resumeSession("old-session-id", {
        platform: "test",
        chatID: "chat-1",
        chatType: "p2p",
        userID: "user-1",
      });

      // First call with sessionId should have failed, second without
      expect(agent.startSession).toHaveBeenCalledTimes(2);
      expect(agent.startSession).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ sessionId: "old-session-id" }),
      );
      expect(agent.startSession).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ workDir: expect.any(String) }),
      );
      // Second call should NOT have sessionId
      const secondCallOpts = (agent.startSession as any).mock.calls[1][0];
      expect(secondCallOpts.sessionId).toBeUndefined();

      await engine.stop();
    });

    it("retries with fresh session when resume fails in processMessage", async () => {
      const freshSession: AgentSession = {
        sessionId: "fresh-id",
        send: vi.fn().mockResolvedValue(undefined),
        events: vi.fn(async function* () {
          yield { type: "result" as const, content: "fresh reply" };
        }),
        respondPermission: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const agent: Agent = {
        name: "mock",
        startSession: vi.fn()
          .mockRejectedValueOnce(new Error("context too large"))
          .mockResolvedValueOnce(freshSession),
        stop: vi.fn().mockResolvedValue(undefined),
      };

      const engine = new Engine(agent, {
        project: "test",
        dataDir: "/tmp/test",
        sessionTtlMs: 3600_000,
        persistPath: "/tmp/test-sessions.json",
      });

      // Seed a session meta with a saved cliSessionId
      const meta = (engine as any).sessions.getOrCreate("test:user-1", "user-1", "mock");
      meta.cliSessionId = "saved-session-id";

      const sender = createMockSender();
      const platform = createMockPlatform();

      await engine.handleMessage(
        createMessageEvent({ userID: "user-1" }),
        sender,
        platform,
      );

      // Should have retried
      expect(agent.startSession).toHaveBeenCalledTimes(2);
      // First call should have the saved sessionId
      expect(agent.startSession).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ sessionId: "saved-session-id" }),
      );
      // Second call should NOT have sessionId
      const secondCallOpts = (agent.startSession as any).mock.calls[1][0];
      expect(secondCallOpts.sessionId).toBeUndefined();

      // Should have notified user about fallback
      const textCalls = (sender.sendText as any).mock.calls;
      expect(textCalls.some((c: any[]) => c[1].includes("starting fresh"))).toBe(true);

      // cliSessionId should be cleared
      expect(meta.cliSessionId).toBeUndefined();

      await engine.stop();
    });

    it("throws normally when startSession fails without a saved session ID", async () => {
      const agent: Agent = {
        name: "mock",
        startSession: vi.fn().mockRejectedValue(new Error("auth failed")),
        stop: vi.fn().mockResolvedValue(undefined),
      };

      const engine = new Engine(agent, {
        project: "test",
        dataDir: "/tmp/test",
        sessionTtlMs: 3600_000,
      });

      const sender = createMockSender();
      const platform = createMockPlatform();

      await expect(
        engine.handleMessage(createMessageEvent(), sender, platform),
      ).rejects.toThrow("auth failed");

      // Should only have tried once
      expect(agent.startSession).toHaveBeenCalledTimes(1);

      await engine.stop();
    });
  });

  // ─── Multi-workspace tests ─────────────────────────────────────────────

  describe("multi-workspace mode", () => {
    it("in single mode (default), resolveAgentForMessage returns the default agent", () => {
      const agent = createMockAgent();
      const engine = new Engine(agent, {
        project: "test",
        dataDir: "/tmp/test",
        sessionTtlMs: 60_000,
      });

      const event = createMessageEvent();
      const resolved = engine.resolveAgentForMessage(event);
      expect(resolved.agent).toBe(agent);
      expect(resolved.workspace).toBeUndefined();
    });

    it("in multi-workspace mode with a bound channel, resolveAgentForMessage returns pool agent", () => {
      const defaultAgent = createMockAgent();
      const poolAgent = createMockAgent();

      const engine = new Engine(defaultAgent, {
        project: "test",
        dataDir: "/tmp/test-mw",
        sessionTtlMs: 60_000,
        mode: "multi-workspace",
        baseDir: "/tmp/workspaces",
        createAgent: () => poolAgent,
      });

      expect(engine.isMultiWorkspace).toBe(true);
      expect(engine.bindings).toBeDefined();
      expect(engine.pool).toBeDefined();
      expect(engine.workspaceBaseDir).toBeDefined();

      // Set up a binding
      engine.bindings!.set("test:chat-1", {
        channelName: "chat-1",
        workspace: "/tmp/workspaces/my-project",
        boundAt: new Date().toISOString(),
      });

      const event = createMessageEvent({ platform: "test", chatID: "chat-1" });
      const resolved = engine.resolveAgentForMessage(event);
      expect(resolved.agent).toBe(poolAgent);
      expect(resolved.workspace).toBeDefined();

      engine.stop();
    });

    it("in multi-workspace mode without binding, resolveAgentForMessage throws NO_WORKSPACE_BOUND", () => {
      const defaultAgent = createMockAgent();

      const engine = new Engine(defaultAgent, {
        project: "test",
        dataDir: "/tmp/test-mw2",
        sessionTtlMs: 60_000,
        mode: "multi-workspace",
        baseDir: "/tmp/workspaces",
        createAgent: () => createMockAgent(),
      });

      const event = createMessageEvent({ platform: "test", chatID: "unbound-chat" });
      try {
        engine.resolveAgentForMessage(event);
        expect.unreachable("should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("NO_WORKSPACE_BOUND");
        expect(err.message).toContain("No workspace bound");
      }

      engine.stop();
    });

    it("handleMessage sends guidance text when no workspace is bound and message is not a command", async () => {
      const defaultAgent = createMockAgent();

      const engine = new Engine(defaultAgent, {
        project: "test",
        dataDir: "/tmp/test-mw3",
        sessionTtlMs: 60_000,
        mode: "multi-workspace",
        baseDir: "/tmp/workspaces",
        createAgent: () => createMockAgent(),
      });

      const sender = createMockSender();
      const platform = createMockPlatform();

      const event = createMessageEvent({ text: "hello", chatID: "unbound" });
      await engine.handleMessage(event, sender, platform);

      const textCalls = (sender.sendText as any).mock.calls;
      expect(textCalls.length).toBeGreaterThan(0);
      expect(textCalls[0][1]).toContain("No workspace bound");

      // Agent should NOT be called
      expect(defaultAgent.startSession).not.toHaveBeenCalled();

      await engine.stop();
    });

    it("handleMessage allows slash commands through even without a workspace binding", async () => {
      const defaultAgent = createMockAgent();
      const handler = vi.fn();

      const engine = new Engine(defaultAgent, {
        project: "test",
        dataDir: "/tmp/test-mw4",
        sessionTtlMs: 60_000,
        mode: "multi-workspace",
        baseDir: "/tmp/workspaces",
        createAgent: () => createMockAgent(),
      });

      engine.commands.register({ name: "workspace", description: "Workspace mgmt", handler });

      const sender = createMockSender();
      const platform = createMockPlatform();

      const event = createMessageEvent({ text: "/workspace bind my-project", chatID: "unbound" });
      await engine.handleMessage(event, sender, platform);

      // Command handler should have been called
      expect(handler).toHaveBeenCalledOnce();

      await engine.stop();
    });

    it("stop() cleans up workspace pool and bindings", async () => {
      const defaultAgent = createMockAgent();
      const poolAgent = createMockAgent();

      const engine = new Engine(defaultAgent, {
        project: "test",
        dataDir: "/tmp/test-mw5",
        sessionTtlMs: 60_000,
        mode: "multi-workspace",
        baseDir: "/tmp/workspaces",
        createAgent: () => poolAgent,
      });

      // Set up a binding and create a pool entry
      engine.bindings!.set("test:chat-1", {
        channelName: "chat-1",
        workspace: "/tmp/workspaces/proj",
        boundAt: new Date().toISOString(),
      });
      engine.pool!.getOrCreate("/tmp/workspaces/proj");

      await engine.stop();

      // Pool should be empty after stop
      expect(engine.pool!.size).toBe(0);
      expect(poolAgent.stop).toHaveBeenCalled();
    });

    it("uses workspace-scoped session keys in multi-workspace mode", async () => {
      const defaultAgent = createMockAgent([{ type: "result", content: "ok" }]);
      const poolAgent = createMockAgent([{ type: "result", content: "ok from pool" }]);

      const engine = new Engine(defaultAgent, {
        project: "test",
        dataDir: "/tmp/test-mw6",
        sessionTtlMs: 60_000,
        mode: "multi-workspace",
        baseDir: "/tmp/workspaces",
        createAgent: () => poolAgent,
      });

      engine.bindings!.set("test:chat-1", {
        channelName: "chat-1",
        workspace: "/tmp/workspaces/proj-a",
        boundAt: new Date().toISOString(),
      });

      const sender = createMockSender();
      const platform = createMockPlatform();

      await engine.handleMessage(
        createMessageEvent({ platform: "test", chatID: "chat-1", userID: "user-1" }),
        sender,
        platform,
      );

      // Pool agent should have been used, not the default
      expect(poolAgent.startSession).toHaveBeenCalled();
      expect(defaultAgent.startSession).not.toHaveBeenCalled();

      await engine.stop();
    });

    it("public getters return undefined in single mode", () => {
      const agent = createMockAgent();
      const engine = new Engine(agent, {
        project: "test",
        dataDir: "/tmp/test",
        sessionTtlMs: 60_000,
      });

      expect(engine.isMultiWorkspace).toBe(false);
      expect(engine.bindings).toBeUndefined();
      expect(engine.pool).toBeUndefined();
      expect(engine.workspaceBaseDir).toBeUndefined();
    });
  });
});
