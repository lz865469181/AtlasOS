import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentBridge } from './AgentBridge.js';
import type { AgentBackend, AgentMessageHandler, AgentMessage, AgentRegistry, AgentFactoryOptions } from 'atlas-agent';
import type { CardEngineImpl } from './CardEngine.js';
import type { SessionInfo } from './SessionManager.js';
import type { ChannelEvent } from '../channel/channelEvent.js';
import { SessionQueue } from './SessionQueue.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeAgent(overrides?: Partial<AgentBackend>): AgentBackend {
  return {
    startSession: vi.fn().mockResolvedValue({ sessionId: 'agent-sid-1' }),
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    offMessage: vi.fn(),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeRegistry(agent: AgentBackend): AgentRegistry {
  return {
    create: vi.fn().mockReturnValue(agent),
    register: vi.fn(),
    has: vi.fn().mockReturnValue(true),
    list: vi.fn().mockReturnValue(['claude']),
  } as unknown as AgentRegistry;
}

function makeCardEngine(): CardEngineImpl {
  return {
    handleMessage: vi.fn(),
    handlePermissionResponse: vi.fn(),
    getStreamingState: vi.fn(),
    setReplyTarget: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CardEngineImpl;
}

function makeSession(overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: 'gw-session-1',
    chatId: 'chat-1',
    channelId: 'feishu',
    agentId: 'claude',
    permissionMode: 'normal',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<ChannelEvent>): ChannelEvent {
  return {
    channelId: 'ch-1',
    chatId: 'chat-1',
    userId: 'user-1',
    userName: 'Test User',
    messageId: 'msg-1',
    content: { type: 'text', text: 'Hello agent' },
    timestamp: Date.now(),
    ...overrides,
  } as ChannelEvent;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AgentBridge', () => {
  let agent: AgentBackend;
  let registry: AgentRegistry;
  let cardEngine: CardEngineImpl;
  let queue: SessionQueue;
  let bridge: AgentBridge;

  beforeEach(() => {
    agent = makeAgent();
    registry = makeRegistry(agent);
    cardEngine = makeCardEngine();
    queue = new SessionQueue();
    bridge = new AgentBridge({
      registry,
      cardEngine,
      queue,
      agentOpts: { cwd: '/tmp' },
    });
  });

  // 1. Creates agent and starts session on first prompt
  it('creates agent and starts session on first prompt', async () => {
    const session = makeSession();
    const event = makeEvent();

    await bridge.handlePrompt(session, event);

    expect(registry.create).toHaveBeenCalledOnce();
    expect(registry.create).toHaveBeenCalledWith('claude', { cwd: '/tmp' });
    expect(agent.startSession).toHaveBeenCalledOnce();
    expect(agent.onMessage).toHaveBeenCalledOnce();
    expect(agent.sendPrompt).toHaveBeenCalledWith('agent-sid-1', 'Hello agent');
  });

  // 2. Reuses existing agent on subsequent prompts
  it('reuses existing agent on subsequent prompts', async () => {
    const session = makeSession();
    const event1 = makeEvent({ content: { type: 'text', text: 'first' } });
    const event2 = makeEvent({ content: { type: 'text', text: 'second' } });

    await bridge.handlePrompt(session, event1);
    await bridge.handlePrompt(session, event2);

    expect(registry.create).toHaveBeenCalledOnce();
    expect(agent.onMessage).toHaveBeenCalledOnce();
    expect(agent.startSession).toHaveBeenCalledOnce();
    expect(agent.sendPrompt).toHaveBeenCalledTimes(2);
    expect(agent.sendPrompt).toHaveBeenNthCalledWith(1, 'agent-sid-1', 'first');
    expect(agent.sendPrompt).toHaveBeenNthCalledWith(2, 'agent-sid-1', 'second');
  });

  // 3. Skips non-text messages (sendPrompt not called)
  it('skips non-text messages', async () => {
    const session = makeSession();
    const event = makeEvent({
      content: { type: 'image', url: 'https://example.com/img.png' },
    });

    await bridge.handlePrompt(session, event);

    // Agent should still be created (first call), but sendPrompt not called
    expect(agent.sendPrompt).not.toHaveBeenCalled();
  });

  // 4. Routes agent messages to CardEngine.handleMessage
  it('routes agent messages to CardEngine.handleMessage', async () => {
    const session = makeSession();
    const event = makeEvent();

    await bridge.handlePrompt(session, event);

    // Extract the handler that was bound via onMessage
    const onMessageMock = agent.onMessage as ReturnType<typeof vi.fn>;
    const handler: AgentMessageHandler = onMessageMock.mock.calls[0][0];

    const msg: AgentMessage = { type: 'model-output', textDelta: 'hi' };
    handler(msg);

    expect(cardEngine.handleMessage).toHaveBeenCalledWith('gw-session-1', 'chat-1', msg);
  });

  // 5. respondToPermission forwards to agent
  it('respondToPermission forwards to agent', async () => {
    const session = makeSession();
    const event = makeEvent();

    await bridge.handlePrompt(session, event);
    await bridge.respondToPermission('gw-session-1', 'req-1', true);

    expect(agent.respondToPermission).toHaveBeenCalledWith('req-1', true);
  });

  // 6. respondToPermission no-ops for unknown session
  it('respondToPermission no-ops for unknown session', async () => {
    // No agent created — should not throw
    await expect(
      bridge.respondToPermission('unknown-session', 'req-1', true),
    ).resolves.toBeUndefined();
  });

  // 7. dispose disposes all agents
  it('dispose disposes all agents', async () => {
    const session = makeSession();
    const event = makeEvent();

    await bridge.handlePrompt(session, event);
    await bridge.dispose();

    const onMessageMock = agent.onMessage as ReturnType<typeof vi.fn>;
    const handler: AgentMessageHandler = onMessageMock.mock.calls[0][0];

    expect(agent.offMessage).toHaveBeenCalledWith(handler);
    expect(agent.dispose).toHaveBeenCalledOnce();
  });

  // Edge: dispose works when agent lacks offMessage
  it('dispose works when agent lacks offMessage', async () => {
    const agentNoOff = makeAgent({ offMessage: undefined });
    const reg = makeRegistry(agentNoOff);
    const b = new AgentBridge({
      registry: reg,
      cardEngine,
      queue,
      agentOpts: { cwd: '/tmp' },
    });

    const session = makeSession();
    const event = makeEvent();

    await b.handlePrompt(session, event);
    await expect(b.dispose()).resolves.toBeUndefined();
    expect(agentNoOff.dispose).toHaveBeenCalledOnce();
  });

  // Edge: respondToPermission works when agent lacks respondToPermission
  it('respondToPermission no-ops when agent lacks respondToPermission', async () => {
    const agentNoResp = makeAgent({ respondToPermission: undefined });
    const reg = makeRegistry(agentNoResp);
    const b = new AgentBridge({
      registry: reg,
      cardEngine,
      queue,
      agentOpts: { cwd: '/tmp' },
    });

    const session = makeSession();
    const event = makeEvent();

    await b.handlePrompt(session, event);
    await expect(
      b.respondToPermission('gw-session-1', 'req-1', true),
    ).resolves.toBeUndefined();
  });

  // ── cancelSession ──────────────────────────────────────────────────────

  it('cancelSession calls agent.cancel and SM.cancel', async () => {
    const fakeSM = { cancel: vi.fn() };
    (cardEngine.getStreamingState as ReturnType<typeof vi.fn>).mockReturnValue(fakeSM);

    const session = makeSession();
    await bridge.handlePrompt(session, makeEvent());

    await bridge.cancelSession('gw-session-1');

    expect(agent.cancel).toHaveBeenCalledWith('agent-sid-1');
    expect(cardEngine.getStreamingState).toHaveBeenCalledWith('gw-session-1');
    expect(fakeSM.cancel).toHaveBeenCalledOnce();
  });

  it('cancelSession no-ops for unknown session', async () => {
    await expect(bridge.cancelSession('unknown')).resolves.toBeUndefined();
    expect(agent.cancel).not.toHaveBeenCalled();
  });

  it('cancelSession works when no streaming SM exists', async () => {
    (cardEngine.getStreamingState as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const session = makeSession();
    await bridge.handlePrompt(session, makeEvent());

    await expect(bridge.cancelSession('gw-session-1')).resolves.toBeUndefined();
    expect(agent.cancel).toHaveBeenCalledWith('agent-sid-1');
  });

  // ── destroySession ─────────────────────────────────────────────────────

  it('destroySession cancels, removes session, disposes agent', async () => {
    const session = makeSession();
    await bridge.handlePrompt(session, makeEvent());

    await bridge.destroySession('gw-session-1');

    expect(agent.cancel).toHaveBeenCalledWith('agent-sid-1');
    expect(cardEngine.dispose).toHaveBeenCalledWith('gw-session-1');
    expect(agent.offMessage).toHaveBeenCalled();
    expect(agent.dispose).toHaveBeenCalledOnce();

    // Session should be gone — second destroy is a no-op
    await expect(bridge.destroySession('gw-session-1')).resolves.toBeUndefined();
  });

  it('destroySession no-ops for unknown session', async () => {
    await expect(bridge.destroySession('unknown')).resolves.toBeUndefined();
  });

  it('destroySession does not dispose agent when shared by another session', async () => {
    // Create two sessions that share the same agent instance
    const session1 = makeSession({ sessionId: 'gw-1', chatId: 'chat-1' });
    const session2 = makeSession({ sessionId: 'gw-2', chatId: 'chat-2' });

    await bridge.handlePrompt(session1, makeEvent({ chatId: 'chat-1' }));
    await bridge.handlePrompt(session2, makeEvent({ chatId: 'chat-2' }));

    // Destroy first session
    await bridge.destroySession('gw-1');

    // Agent should NOT be disposed — still in use by gw-2
    expect(agent.dispose).not.toHaveBeenCalled();

    // Destroy second session — now agent should be disposed
    await bridge.destroySession('gw-2');
    expect(agent.dispose).toHaveBeenCalledOnce();
  });
});
