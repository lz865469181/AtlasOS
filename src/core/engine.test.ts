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
});
