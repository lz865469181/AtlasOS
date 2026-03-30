import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EngineImpl } from './Engine.js';
import type { EngineDeps, CardActionEvent, OnPromptCallback } from './Engine.js';
import type { ChannelEvent } from '../channel/channelEvent.js';
import type { ChannelSender } from '../channel/ChannelSender.js';
import type { CardModel } from '../cards/CardModel.js';
import type { CardStateStoreImpl } from './CardStateStore.js';
import type { MessageCorrelationStoreImpl } from './MessageCorrelationStore.js';
import type { CardRenderPipeline } from './CardRenderPipeline.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { SessionManagerImpl, SessionInfo } from './SessionManager.js';
import type { CommandRegistryImpl, Command } from './CommandRegistry.js';
import type { PermissionPayloadValidatorImpl, PermissionActionPayload } from './PermissionCard.js';

// ── Mock Factories ──────────────────────────────────────────────────────────

function mockSender(): ChannelSender {
  return {
    sendText: vi.fn().mockResolvedValue('msg-1'),
    sendMarkdown: vi.fn().mockResolvedValue('msg-2'),
    sendCard: vi.fn().mockResolvedValue('msg-3'),
    updateCard: vi.fn().mockResolvedValue(undefined),
  };
}

function mockSessionManager(): SessionManagerImpl {
  const sessions = new Map<string, SessionInfo>();

  return {
    getOrCreate: vi.fn(async (chatId: string) => {
      if (sessions.has(chatId)) {
        return sessions.get(chatId)!;
      }
      const session: SessionInfo = {
        sessionId: `session-${chatId}`,
        chatId,
        agentId: 'claude',
        permissionMode: 'normal',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      sessions.set(chatId, session);
      return session;
    }),
    get: vi.fn((chatId: string) => sessions.get(chatId)),
    destroy: vi.fn(async () => {}),
    switchAgent: vi.fn(async () => ({} as SessionInfo)),
    setModel: vi.fn(),
    setPermissionMode: vi.fn(),
    listActive: vi.fn(() => []),
    persist: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
  } as unknown as SessionManagerImpl;
}

function mockCommandRegistry(
  resolveResult: { command: Command; args: string } | null = null,
): CommandRegistryImpl {
  return {
    register: vi.fn(),
    resolve: vi.fn().mockReturnValue(resolveResult),
    listCommands: vi.fn().mockReturnValue([]),
  } as unknown as CommandRegistryImpl;
}

function mockCardEngine(): CardEngineImpl {
  return {
    handleMessage: vi.fn(),
    handlePermissionResponse: vi.fn(),
    getStreamingState: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CardEngineImpl;
}

function mockPipeline(): CardRenderPipeline {
  return {
    dispose: vi.fn(),
  } as unknown as CardRenderPipeline;
}

function mockPermissionValidator(
  validateResult: { ok: true; data: PermissionActionPayload } | { ok: false; error: string } = {
    ok: false,
    error: 'invalid',
  },
): PermissionPayloadValidatorImpl {
  return {
    validate: vi.fn().mockReturnValue(validateResult),
    createPayload: vi.fn(),
    cleanup: vi.fn(),
  } as unknown as PermissionPayloadValidatorImpl;
}

function createDeps(overrides?: Partial<EngineDeps>): EngineDeps {
  return {
    cardStore: {} as CardStateStoreImpl,
    correlationStore: {} as MessageCorrelationStoreImpl,
    pipeline: mockPipeline(),
    cardEngine: mockCardEngine(),
    sessionManager: mockSessionManager(),
    commandRegistry: mockCommandRegistry(),
    permissionPayloadValidator: mockPermissionValidator(),
    sender: mockSender(),
    ...overrides,
  };
}

function textEvent(text: string, overrides?: Partial<ChannelEvent>): ChannelEvent {
  return {
    channelId: 'ch-1',
    chatId: 'chat-1',
    userId: 'user-1',
    userName: 'Test User',
    messageId: 'msg-evt-1',
    content: { type: 'text', text },
    timestamp: Date.now(),
    ...overrides,
  };
}

function imageEvent(overrides?: Partial<ChannelEvent>): ChannelEvent {
  return {
    channelId: 'ch-1',
    chatId: 'chat-1',
    userId: 'user-1',
    userName: 'Test User',
    messageId: 'msg-evt-img',
    content: { type: 'image', url: 'https://example.com/img.png' },
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Engine', () => {
  let deps: EngineDeps;
  let engine: EngineImpl;

  beforeEach(() => {
    deps = createDeps();
    engine = new EngineImpl(deps);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  describe('start()', () => {
    it('restores session manager', async () => {
      await engine.start();
      expect(deps.sessionManager.restore).toHaveBeenCalledOnce();
    });
  });

  describe('stop()', () => {
    it('persists session manager and disposes pipeline', async () => {
      await engine.stop();
      expect(deps.sessionManager.persist).toHaveBeenCalledOnce();
      expect(deps.pipeline.dispose).toHaveBeenCalledOnce();
    });
  });

  // ── handleChannelEvent ────────────────────────────────────────────────

  describe('handleChannelEvent', () => {
    it('resolves slash command and sends text response', async () => {
      const cmd: Command = {
        name: 'help',
        description: 'Show help',
        execute: vi.fn().mockResolvedValue('Help text'),
      };

      deps = createDeps({
        commandRegistry: mockCommandRegistry({ command: cmd, args: '' }),
      });
      engine = new EngineImpl(deps);

      const event = textEvent('/help');
      await engine.handleChannelEvent(event);

      expect(deps.commandRegistry.resolve).toHaveBeenCalledWith('/help');
      expect(cmd.execute).toHaveBeenCalledWith('', expect.objectContaining({
        chatId: 'chat-1',
        userId: 'user-1',
      }));
      expect(deps.sender.sendText).toHaveBeenCalledWith('Help text', 'msg-evt-1');
    });

    it('resolves slash command and sends card response', async () => {
      const cardResult: CardModel = {
        header: { title: 'Status' },
        sections: [{ type: 'markdown', content: 'Running' }],
      };
      const cmd: Command = {
        name: 'status',
        description: 'Show status',
        execute: vi.fn().mockResolvedValue(cardResult),
      };

      deps = createDeps({
        commandRegistry: mockCommandRegistry({ command: cmd, args: '' }),
      });
      engine = new EngineImpl(deps);

      const event = textEvent('/status');
      await engine.handleChannelEvent(event);

      expect(deps.sender.sendCard).toHaveBeenCalledWith(cardResult, 'msg-evt-1');
      expect(deps.sender.sendText).not.toHaveBeenCalled();
    });

    it('passes command args to execute', async () => {
      const cmd: Command = {
        name: 'agent',
        description: 'Switch agent',
        execute: vi.fn().mockResolvedValue('Switched'),
      };

      deps = createDeps({
        commandRegistry: mockCommandRegistry({ command: cmd, args: 'claude-acp' }),
      });
      engine = new EngineImpl(deps);

      const event = textEvent('/agent claude-acp');
      await engine.handleChannelEvent(event);

      expect(cmd.execute).toHaveBeenCalledWith('claude-acp', expect.anything());
    });

    it('does not call sessionManager or onPrompt when command resolves', async () => {
      const cmd: Command = {
        name: 'help',
        description: 'Help',
        execute: vi.fn().mockResolvedValue('ok'),
      };
      const onPrompt = vi.fn();

      deps = createDeps({
        commandRegistry: mockCommandRegistry({ command: cmd, args: '' }),
        onPrompt,
      });
      engine = new EngineImpl(deps);

      await engine.handleChannelEvent(textEvent('/help'));

      expect(deps.sessionManager.getOrCreate).not.toHaveBeenCalled();
      expect(onPrompt).not.toHaveBeenCalled();
    });

    it('falls through to session when slash command does not resolve', async () => {
      const onPrompt = vi.fn();
      deps = createDeps({ onPrompt });
      engine = new EngineImpl(deps);

      // commandRegistry.resolve returns null (default mock)
      const event = textEvent('/unknown-cmd');
      await engine.handleChannelEvent(event);

      expect(deps.commandRegistry.resolve).toHaveBeenCalledWith('/unknown-cmd');
      expect(deps.sessionManager.getOrCreate).toHaveBeenCalledWith('chat-1');
      expect(onPrompt).toHaveBeenCalled();
    });

    it('creates session and calls onPrompt for regular text', async () => {
      const onPrompt = vi.fn();
      deps = createDeps({ onPrompt });
      engine = new EngineImpl(deps);

      const event = textEvent('Hello, AI!');
      await engine.handleChannelEvent(event);

      expect(deps.commandRegistry.resolve).not.toHaveBeenCalled();
      expect(deps.sessionManager.getOrCreate).toHaveBeenCalledWith('chat-1');
      expect(onPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-chat-1', chatId: 'chat-1' }),
        event,
      );
    });

    it('handles non-text events (image) by going to session flow', async () => {
      const onPrompt = vi.fn();
      deps = createDeps({ onPrompt });
      engine = new EngineImpl(deps);

      const event = imageEvent();
      await engine.handleChannelEvent(event);

      expect(deps.commandRegistry.resolve).not.toHaveBeenCalled();
      expect(deps.sessionManager.getOrCreate).toHaveBeenCalledWith('chat-1');
      expect(onPrompt).toHaveBeenCalled();
    });

    it('works without onPrompt callback', async () => {
      // deps has no onPrompt by default
      const event = textEvent('Hello');
      await engine.handleChannelEvent(event);

      expect(deps.sessionManager.getOrCreate).toHaveBeenCalledWith('chat-1');
      // Should not throw
    });

    it('provides correct CommandContext to command', async () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        execute: vi.fn().mockResolvedValue('ok'),
      };

      deps = createDeps({
        commandRegistry: mockCommandRegistry({ command: cmd, args: '' }),
      });
      engine = new EngineImpl(deps);

      await engine.handleChannelEvent(textEvent('/test'));

      expect(cmd.execute).toHaveBeenCalledWith('', {
        chatId: 'chat-1',
        userId: 'user-1',
        sessionManager: deps.sessionManager,
        sender: deps.sender,
      });
    });
  });

  // ── handleCardAction ──────────────────────────────────────────────────

  describe('handleCardAction', () => {
    it('validates payload and routes to cardEngine on success', async () => {
      const validPayload: PermissionActionPayload = {
        v: 1,
        nonce: '00000000-0000-0000-0000-000000000001',
        iat: Date.now(),
        exp: Date.now() + 300_000,
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
      };

      deps = createDeps({
        permissionPayloadValidator: mockPermissionValidator({
          ok: true,
          data: validPayload,
        }),
      });
      engine = new EngineImpl(deps);

      const action: CardActionEvent = {
        messageId: 'msg-card-1',
        chatId: 'chat-1',
        userId: 'user-1',
        value: validPayload as unknown as Record<string, unknown>,
      };

      await engine.handleCardAction(action);

      expect(deps.permissionPayloadValidator.validate).toHaveBeenCalledWith(validPayload);
      expect(deps.cardEngine.handlePermissionResponse).toHaveBeenCalledWith(
        'sess-1',
        validPayload,
      );
    });

    it('ignores card action when validation fails', async () => {
      deps = createDeps({
        permissionPayloadValidator: mockPermissionValidator({
          ok: false,
          error: 'Payload expired',
        }),
      });
      engine = new EngineImpl(deps);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const action: CardActionEvent = {
        messageId: 'msg-card-2',
        chatId: 'chat-1',
        userId: 'user-1',
        value: { invalid: true },
      };

      await engine.handleCardAction(action);

      expect(deps.cardEngine.handlePermissionResponse).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Engine] Invalid card action payload:',
        'Payload expired',
      );

      consoleSpy.mockRestore();
    });

    it('handles deny action correctly', async () => {
      const denyPayload: PermissionActionPayload = {
        v: 1,
        nonce: '00000000-0000-0000-0000-000000000002',
        iat: Date.now(),
        exp: Date.now() + 300_000,
        action: 'deny',
        sessionId: 'sess-2',
        requestId: 'req-2',
        toolName: 'Write',
        toolCallId: 'tc-2',
        agentType: 'claude',
      };

      deps = createDeps({
        permissionPayloadValidator: mockPermissionValidator({
          ok: true,
          data: denyPayload,
        }),
      });
      engine = new EngineImpl(deps);

      const action: CardActionEvent = {
        messageId: 'msg-card-3',
        chatId: 'chat-1',
        userId: 'user-1',
        value: denyPayload as unknown as Record<string, unknown>,
      };

      await engine.handleCardAction(action);

      expect(deps.cardEngine.handlePermissionResponse).toHaveBeenCalledWith(
        'sess-2',
        denyPayload,
      );
    });

    it('handles abort action correctly', async () => {
      const abortPayload: PermissionActionPayload = {
        v: 1,
        nonce: '00000000-0000-0000-0000-000000000003',
        iat: Date.now(),
        exp: Date.now() + 300_000,
        action: 'abort',
        sessionId: 'sess-3',
        requestId: 'req-3',
        toolName: 'Bash',
        toolCallId: 'tc-3',
        agentType: 'codex',
      };

      deps = createDeps({
        permissionPayloadValidator: mockPermissionValidator({
          ok: true,
          data: abortPayload,
        }),
      });
      engine = new EngineImpl(deps);

      await engine.handleCardAction({
        messageId: 'msg-card-4',
        chatId: 'chat-1',
        userId: 'user-1',
        value: abortPayload as unknown as Record<string, unknown>,
      });

      expect(deps.cardEngine.handlePermissionResponse).toHaveBeenCalledWith(
        'sess-3',
        abortPayload,
      );
    });
  });

  // ── Integration-like scenarios ────────────────────────────────────────

  describe('full lifecycle', () => {
    it('start -> handleChannelEvent -> stop', async () => {
      const onPrompt = vi.fn();
      deps = createDeps({ onPrompt });
      engine = new EngineImpl(deps);

      await engine.start();
      expect(deps.sessionManager.restore).toHaveBeenCalledOnce();

      await engine.handleChannelEvent(textEvent('Hello'));
      expect(deps.sessionManager.getOrCreate).toHaveBeenCalled();
      expect(onPrompt).toHaveBeenCalled();

      await engine.stop();
      expect(deps.sessionManager.persist).toHaveBeenCalledOnce();
      expect(deps.pipeline.dispose).toHaveBeenCalledOnce();
    });

    it('handles multiple events in sequence', async () => {
      const onPrompt = vi.fn();
      deps = createDeps({ onPrompt });
      engine = new EngineImpl(deps);

      await engine.handleChannelEvent(textEvent('First message', { chatId: 'chat-a' }));
      await engine.handleChannelEvent(textEvent('Second message', { chatId: 'chat-b' }));

      expect(deps.sessionManager.getOrCreate).toHaveBeenCalledWith('chat-a');
      expect(deps.sessionManager.getOrCreate).toHaveBeenCalledWith('chat-b');
      expect(onPrompt).toHaveBeenCalledTimes(2);
    });
  });
});
