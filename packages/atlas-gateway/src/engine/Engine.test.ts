import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineImpl } from './Engine.js';
import type { CardActionEvent, EngineDeps } from './Engine.js';
import type { ChannelEvent } from '../channel/channelEvent.js';
import type { ChannelSender, SenderFactory } from '../channel/ChannelSender.js';
import type { CardModel } from '../cards/CardModel.js';
import type { CardStateStoreImpl } from './CardStateStore.js';
import type { MessageCorrelationStoreImpl } from './MessageCorrelationStore.js';
import type { CardRenderPipeline } from './CardRenderPipeline.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { CommandRegistryImpl, Command } from './CommandRegistry.js';
import type { PermissionService } from './PermissionService.js';
import { BindingStoreImpl } from '../runtime/BindingStore.js';
import type { RuntimeRouterImpl } from '../runtime/RuntimeRouter.js';
import type { RuntimeBridgeImpl } from '../runtime/RuntimeBridge.js';
import type { RuntimeRegistryImpl } from '../runtime/RuntimeRegistry.js';
import type { AgentMessage } from 'codelink-agent';

function mockSender(): ChannelSender {
  return {
    sendText: vi.fn().mockResolvedValue('msg-1'),
    sendMarkdown: vi.fn().mockResolvedValue('msg-2'),
    sendCard: vi.fn().mockResolvedValue('msg-3'),
    updateCard: vi.fn().mockResolvedValue(undefined),
  };
}

function mockSenderFactory(): { factory: SenderFactory; lastSender: () => ChannelSender } {
  let last: ChannelSender;
  const factory = vi.fn((_chatId: string, _channelIdHint?: string) => {
    last = mockSender();
    return last;
  }) as unknown as SenderFactory;
  return { factory, lastSender: () => last };
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
    setReplyTarget: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CardEngineImpl;
}

function mockPipeline(): CardRenderPipeline {
  return {
    dispose: vi.fn(),
  } as unknown as CardRenderPipeline;
}

function mockPermissionService(): PermissionService {
  return {
    handleAction: vi.fn().mockResolvedValue(undefined),
  } as unknown as PermissionService;
}

function mockRuntimeRegistry(): RuntimeRegistryImpl {
  return {
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    update: vi.fn(),
    persist: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
  } as unknown as RuntimeRegistryImpl;
}

function mockRuntimeRouter(kind: 'missing' | 'runtime' = 'missing'): RuntimeRouterImpl {
  return {
    resolveTarget: vi.fn().mockResolvedValue(
      kind === 'runtime'
        ? { kind: 'runtime', bindingId: 'ch-1:chat-1:chat-1', runtimeId: 'runtime-1' }
        : { kind: 'missing', bindingId: 'ch-1:chat-1:chat-1' },
    ),
  } as unknown as RuntimeRouterImpl;
}

function mockRuntimeBridge(): RuntimeBridgeImpl {
  return {
    sendPrompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as RuntimeBridgeImpl;
}

function createDeps(overrides?: Partial<EngineDeps>): EngineDeps {
  const { factory } = mockSenderFactory();
  return {
    cardStore: {} as CardStateStoreImpl,
    correlationStore: {} as MessageCorrelationStoreImpl,
    pipeline: mockPipeline(),
    cardEngine: mockCardEngine(),
    runtimeRegistry: mockRuntimeRegistry(),
    bindingStore: new BindingStoreImpl(),
    runtimeRouter: mockRuntimeRouter(),
    runtimeBridge: mockRuntimeBridge(),
    commandRegistry: mockCommandRegistry(),
    permissionService: mockPermissionService(),
    senderFactory: factory,
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

describe('Engine', () => {
  let deps: EngineDeps;
  let engine: EngineImpl;

  beforeEach(() => {
    deps = createDeps();
    engine = new EngineImpl(deps);
  });

  describe('start()', () => {
    it('restores runtime registry and binding store', async () => {
      const restoreSpy = vi.spyOn(deps.bindingStore, 'restore');
      await engine.start();
      expect(deps.runtimeRegistry.restore).toHaveBeenCalledOnce();
      expect(restoreSpy).toHaveBeenCalledOnce();
    });
  });

  describe('stop()', () => {
    it('persists runtime registry and binding store, then disposes pipeline', async () => {
      const persistSpy = vi.spyOn(deps.bindingStore, 'persist');
      await engine.stop();
      expect(deps.runtimeRegistry.persist).toHaveBeenCalledOnce();
      expect(persistSpy).toHaveBeenCalledOnce();
      expect(deps.pipeline.dispose).toHaveBeenCalledOnce();
    });
  });

  describe('handleChannelEvent', () => {
    it('resolves slash command and sends text response via senderFactory', async () => {
      const cmd: Command = {
        name: 'help',
        description: 'Show help',
        execute: vi.fn().mockResolvedValue('Help text'),
      };

      const { factory, lastSender } = mockSenderFactory();
      const bindingStore = new BindingStoreImpl();
      deps = createDeps({
        commandRegistry: mockCommandRegistry({ command: cmd, args: '' }),
        bindingStore,
        senderFactory: factory,
      });
      engine = new EngineImpl(deps);

      const event = textEvent('/help');
      await engine.handleChannelEvent(event);

      expect(factory).toHaveBeenCalledWith('chat-1', 'ch-1');
      expect(deps.commandRegistry.resolve).toHaveBeenCalledWith('/help');
      expect(cmd.execute).toHaveBeenCalledWith('', expect.objectContaining({
        binding: bindingStore.getOrCreate('ch-1', 'chat-1', 'chat-1'),
        runtimeRegistry: deps.runtimeRegistry,
        bindingStore,
        runtimeBridge: deps.runtimeBridge,
      }));
      expect(lastSender().sendText).toHaveBeenCalledWith('Help text', 'msg-evt-1');
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

      const { factory, lastSender } = mockSenderFactory();
      deps = createDeps({
        commandRegistry: mockCommandRegistry({ command: cmd, args: '' }),
        senderFactory: factory,
      });
      engine = new EngineImpl(deps);

      await engine.handleChannelEvent(textEvent('/status'));

      expect(lastSender().sendCard).toHaveBeenCalledWith(cardResult, 'msg-evt-1');
      expect(lastSender().sendText).not.toHaveBeenCalled();
    });

    it('routes regular text to the resolved runtime', async () => {
      const runtimeRouter = mockRuntimeRouter('runtime');
      const runtimeBridge = mockRuntimeBridge();
      const cardEngine = mockCardEngine();
      const idleWatcher = { touch: vi.fn(), remove: vi.fn(), dispose: vi.fn() };

      deps = createDeps({
        runtimeRouter,
        runtimeBridge,
        cardEngine,
        idleWatcher: idleWatcher as never,
      });
      engine = new EngineImpl(deps);

      const event = textEvent('Hello, AI!');
      await engine.handleChannelEvent(event);

      expect(runtimeRouter.resolveTarget).toHaveBeenCalledWith(event);
      expect(cardEngine.setReplyTarget).toHaveBeenCalledWith('runtime-1', 'msg-evt-1');
      expect(runtimeBridge.sendPrompt).toHaveBeenCalledWith('runtime-1', event);
      expect(idleWatcher.touch).toHaveBeenCalledWith('runtime-1', 'chat-1');
    });

    it('sends a no-runtime hint when routing cannot resolve a runtime', async () => {
      const { factory, lastSender } = mockSenderFactory();
      deps = createDeps({
        senderFactory: factory,
        runtimeRegistry: {
          ...mockRuntimeRegistry(),
          list: vi.fn().mockReturnValue([]),
        } as unknown as RuntimeRegistryImpl,
      });
      engine = new EngineImpl(deps);

      await engine.handleChannelEvent(textEvent('Hello, AI!'));

      expect(lastSender().sendText).toHaveBeenCalledWith(
        expect.stringContaining('No runtime attached to this thread'),
        'msg-evt-1',
      );
      expect(lastSender().sendText).toHaveBeenCalledWith(
        expect.stringContaining('/new'),
        'msg-evt-1',
      );
    });

    it('surfaces runtime bridge errors back to the user', async () => {
      const { factory, lastSender } = mockSenderFactory();
      const runtimeBridge = {
        ...mockRuntimeBridge(),
        sendPrompt: vi.fn().mockRejectedValue(new Error('boom')),
      } as unknown as RuntimeBridgeImpl;

      deps = createDeps({
        senderFactory: factory,
        runtimeRouter: mockRuntimeRouter('runtime'),
        runtimeBridge,
      });
      engine = new EngineImpl(deps);

      await engine.handleChannelEvent(textEvent('Hello, AI!'));

      expect(lastSender().sendText).toHaveBeenCalledWith('Error: boom');
    });
  });

  describe('handleCardAction', () => {
    it('delegates to permissionService.handleAction', async () => {
      const permissionService = mockPermissionService();
      deps = createDeps({ permissionService });
      engine = new EngineImpl(deps);

      const action: CardActionEvent = {
        messageId: 'msg-card-1',
        chatId: 'chat-1',
        userId: 'user-1',
        value: { v: 1, action: 'approve', sessionId: 'runtime-1' },
      };

      await engine.handleCardAction(action);

      expect(permissionService.handleAction).toHaveBeenCalledWith(action);
    });
  });

  describe('handleRuntimeMessage', () => {
    it('accumulates unread summary for the watching runtime without sending a notification for normal output', async () => {
      const { factory, lastSender } = mockSenderFactory();
      const bindingStore = new BindingStoreImpl();
      const binding = bindingStore.getOrCreate('ch-1', 'chat-1', 'chat-1');
      bindingStore.attach(binding.bindingId, 'runtime-watch-1');
      bindingStore.setWatching(binding.bindingId, 'runtime-watch-1');

      deps = createDeps({
        bindingStore,
        senderFactory: factory,
      });
      engine = new EngineImpl(deps);

      await engine.handleRuntimeMessage('runtime-watch-1', {
        type: 'terminal-output',
        data: 'line 1\nline 2',
      });

      expect(binding.watchState['runtime-watch-1']).toMatchObject({
        unreadCount: 1,
        lastSummary: 'line 2',
      });
      expect(lastSender().sendText).not.toHaveBeenCalled();
    });

    it('notifies the thread when a watching runtime completes', async () => {
      const { factory, lastSender } = mockSenderFactory();
      const bindingStore = new BindingStoreImpl();
      const binding = bindingStore.getOrCreate('ch-1', 'chat-1', 'chat-1');
      bindingStore.attach(binding.bindingId, 'runtime-watch-1');
      bindingStore.setWatching(binding.bindingId, 'runtime-watch-1');

      deps = createDeps({
        bindingStore,
        senderFactory: factory,
      });
      engine = new EngineImpl(deps);

      await engine.handleRuntimeMessage('runtime-watch-1', {
        type: 'status',
        status: 'running',
      });
      await engine.handleRuntimeMessage('runtime-watch-1', {
        type: 'status',
        status: 'idle',
      });

      expect(binding.watchState['runtime-watch-1']).toMatchObject({
        lastStatus: 'idle',
      });
      expect(lastSender().sendText).toHaveBeenCalledWith(
        expect.stringContaining('watching runtime'),
        undefined,
      );
      expect(lastSender().sendText).toHaveBeenCalledWith(
        expect.stringContaining('completed'),
        undefined,
      );
    });

    it('notifies the thread when a watching runtime needs approval', async () => {
      const { factory, lastSender } = mockSenderFactory();
      const bindingStore = new BindingStoreImpl();
      const binding = bindingStore.getOrCreate('ch-1', 'chat-1', 'chat-1');
      bindingStore.attach(binding.bindingId, 'runtime-watch-1');
      bindingStore.setWatching(binding.bindingId, 'runtime-watch-1');

      deps = createDeps({
        bindingStore,
        senderFactory: factory,
      });
      engine = new EngineImpl(deps);

      await engine.handleRuntimeMessage('runtime-watch-1', {
        type: 'permission-request',
        id: 'perm-1',
        reason: 'Allow npm install?',
        payload: {},
      } satisfies AgentMessage);

      expect(binding.watchState['runtime-watch-1']).toMatchObject({
        unreadCount: 1,
        lastSummary: 'Allow npm install?',
      });
      expect(lastSender().sendText).toHaveBeenCalledWith(
        expect.stringContaining('needs approval'),
        undefined,
      );
    });
  });
});
