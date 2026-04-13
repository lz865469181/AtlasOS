import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentBackend, AgentFactoryOptions, AgentMessage, AgentMessageHandler, AgentRegistry } from 'codelink-agent';
import type { CardEngineImpl } from '../../engine/CardEngine.js';
import { SessionQueue } from '../../engine/SessionQueue.js';
import type { RuntimeSession } from '../RuntimeModels.js';
import { AtlasClaudeRuntimeAdapter, ManagedRuntimeAdapter } from './AtlasClaudeRuntimeAdapter.js';

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
    list: vi.fn().mockReturnValue(['claude', 'claude-acp']),
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

function makeRuntime(overrides?: Partial<RuntimeSession>): RuntimeSession {
  return {
    id: 'runtime-1',
    source: 'atlas-managed',
    provider: 'claude',
    transport: 'sdk',
    status: 'idle',
    displayName: 'main',
    capabilities: {
      streaming: true,
      permissionCards: true,
      fileAccess: false,
      imageInput: false,
      terminalOutput: false,
      patchEvents: false,
    },
    metadata: {
      agentId: 'claude',
      permissionMode: 'auto',
    },
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

describe('AtlasClaudeRuntimeAdapter', () => {
  let agent: AgentBackend;
  let registry: AgentRegistry;
  let cardEngine: CardEngineImpl;
  let runtimeRegistry: { update: ReturnType<typeof vi.fn> };
  let adapter: AtlasClaudeRuntimeAdapter;

  beforeEach(() => {
    agent = makeAgent();
    registry = makeRegistry(agent);
    cardEngine = makeCardEngine();
    runtimeRegistry = {
      update: vi.fn(),
    };
    adapter = new AtlasClaudeRuntimeAdapter({
      registry,
      cardEngine,
      queue: new SessionQueue(),
      agentOpts: { cwd: '/tmp' } as AgentFactoryOptions,
      runtimeRegistry,
    });
  });

  it('exports ManagedRuntimeAdapter as the primary class while keeping AtlasClaudeRuntimeAdapter as an alias', () => {
    expect(ManagedRuntimeAdapter).toBe(AtlasClaudeRuntimeAdapter);
  });

  it('creates an agent session on first prompt', async () => {
    const runtime = makeRuntime();

    await adapter.sendPrompt(runtime, {
      text: 'hello',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    expect(registry.create).toHaveBeenCalledWith('claude', { cwd: '/tmp' });
    expect(agent.startSession).toHaveBeenCalledOnce();
    expect(agent.sendPrompt).toHaveBeenCalledWith('agent-sid-1', 'hello');
  });

  it('reuses the managed agent and routes messages into card engine', async () => {
    const runtime = makeRuntime();
    const externalHandler = vi.fn();
    adapter.onMessage(externalHandler);

    await adapter.sendPrompt(runtime, {
      text: 'hello',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    const handler = vi.mocked(agent.onMessage).mock.calls[0][0] as AgentMessageHandler;
    const msg: AgentMessage = { type: 'model-output', textDelta: 'hi' };
    handler(msg);

    await adapter.sendPrompt(runtime, {
      text: 'again',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-2',
    });

    expect(agent.startSession).toHaveBeenCalledOnce();
    expect(agent.sendPrompt).toHaveBeenNthCalledWith(1, 'agent-sid-1', 'hello');
    expect(agent.sendPrompt).toHaveBeenNthCalledWith(2, 'agent-sid-1', 'again');
    expect(cardEngine.handleMessage).toHaveBeenCalledWith('runtime-1', 'chat-1', msg);
    expect(externalHandler).toHaveBeenCalledWith('runtime-1', msg);
  });

  it('forwards permission responses when the agent supports them', async () => {
    const runtime = makeRuntime();
    await adapter.sendPrompt(runtime, {
      text: 'hello',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    await adapter.respondToPermission(runtime, 'req-1', true);

    expect(agent.respondToPermission).toHaveBeenCalledWith('req-1', true);
  });

  it('cancel propagates to the agent and streaming state machine', async () => {
    const fakeSM = { cancel: vi.fn() };
    vi.mocked(cardEngine.getStreamingState).mockReturnValue(fakeSM as never);
    const runtime = makeRuntime();

    await adapter.sendPrompt(runtime, {
      text: 'hello',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });
    await adapter.cancel(runtime);

    expect(agent.cancel).toHaveBeenCalledWith('agent-sid-1');
    expect(cardEngine.getStreamingState).toHaveBeenCalledWith('runtime-1');
    expect(fakeSM.cancel).toHaveBeenCalledOnce();
  });

  it('dispose tears down the managed agent and card state', async () => {
    const runtime = makeRuntime();
    await adapter.sendPrompt(runtime, {
      text: 'hello',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    await adapter.dispose(runtime);

    const handler = vi.mocked(agent.onMessage).mock.calls[0][0];
    expect(agent.offMessage).toHaveBeenCalledWith(handler);
    expect(agent.dispose).toHaveBeenCalledOnce();
    expect(cardEngine.dispose).toHaveBeenCalledWith('runtime-1');
    expect(runtimeRegistry.update).toHaveBeenCalledWith('runtime-1', expect.objectContaining({ status: 'stopped' }));
  });
});
