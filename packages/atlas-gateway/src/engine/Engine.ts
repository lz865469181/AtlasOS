import type { ChannelEvent } from '../channel/channelEvent.js';
import type { ChannelSender, SenderFactory } from '../channel/ChannelSender.js';
import type { CardModel } from '../cards/CardModel.js';
import type { AgentMessage } from 'codelink-agent';
import type { BindingStoreImpl } from '../runtime/BindingStore.js';
import type { RuntimeBridgeImpl } from '../runtime/RuntimeBridge.js';
import type { RuntimeSession } from '../runtime/RuntimeModels.js';
import type { RuntimeRegistryImpl } from '../runtime/RuntimeRegistry.js';
import type { RuntimeRouterImpl } from '../runtime/RuntimeRouter.js';
import type { CardStateStoreImpl } from './CardStateStore.js';
import type { MessageCorrelationStoreImpl } from './MessageCorrelationStore.js';
import type { CardRenderPipeline } from './CardRenderPipeline.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { CommandContext, CommandRegistryImpl, LocalRuntimeManager } from './CommandRegistry.js';
import type { PermissionService } from './PermissionService.js';
import type { IdleWatcher } from './IdleWatcher.js';
import { buildWatchNotificationCard, parseWatchControlPayload } from './WatchControl.js';
import { parseCardViewPayload, renderActiveCardView } from './CardViewControl.js';

const WATCH_OUTPUT_PREVIEW_LIMIT = 4000;

export interface CardActionEvent {
  messageId: string;
  chatId: string;
  userId: string;
  value: Record<string, unknown>;
}

export interface EngineDeps {
  cardStore: CardStateStoreImpl;
  correlationStore: MessageCorrelationStoreImpl;
  pipeline: CardRenderPipeline;
  cardEngine: CardEngineImpl;
  runtimeRegistry: RuntimeRegistryImpl;
  bindingStore: BindingStoreImpl;
  runtimeRouter: RuntimeRouterImpl;
  runtimeBridge: RuntimeBridgeImpl;
  commandRegistry: CommandRegistryImpl;
  permissionService: PermissionService;
  senderFactory: SenderFactory;
  localRuntimeManager?: LocalRuntimeManager;
  defaultAgentId?: string;
  defaultPermissionMode?: string;
  idleWatcher?: IdleWatcher;
}

export interface Engine {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleChannelEvent(event: ChannelEvent): Promise<void>;
  handleCardAction(event: CardActionEvent): Promise<void>;
  handleRuntimeMessage(runtimeId: string, message: AgentMessage): Promise<void>;
}

export class EngineImpl implements Engine {
  private readonly cardStore: CardStateStoreImpl;
  private readonly pipeline: CardRenderPipeline;
  private readonly cardEngine: CardEngineImpl;
  private readonly runtimeRegistry: RuntimeRegistryImpl;
  private readonly bindingStore: BindingStoreImpl;
  private readonly runtimeRouter: RuntimeRouterImpl;
  private readonly runtimeBridge: RuntimeBridgeImpl;
  private readonly commandRegistry: CommandRegistryImpl;
  private readonly permissionService: PermissionService;
  private readonly senderFactory: SenderFactory;
  private readonly localRuntimeManager?: LocalRuntimeManager;
  private readonly defaultAgentId?: string;
  private readonly defaultPermissionMode?: string;
  private readonly idleWatcher?: IdleWatcher;

  constructor(deps: EngineDeps) {
    this.cardStore = deps.cardStore;
    this.pipeline = deps.pipeline;
    this.cardEngine = deps.cardEngine;
    this.runtimeRegistry = deps.runtimeRegistry;
    this.bindingStore = deps.bindingStore;
    this.runtimeRouter = deps.runtimeRouter;
    this.runtimeBridge = deps.runtimeBridge;
    this.commandRegistry = deps.commandRegistry;
    this.permissionService = deps.permissionService;
    this.senderFactory = deps.senderFactory;
    this.localRuntimeManager = deps.localRuntimeManager;
    this.defaultAgentId = deps.defaultAgentId;
    this.defaultPermissionMode = deps.defaultPermissionMode;
    this.idleWatcher = deps.idleWatcher;
  }

  async start(): Promise<void> {
    await Promise.all([
      this.runtimeRegistry.restore(),
      this.bindingStore.restore(),
    ]);
  }

  async stop(): Promise<void> {
    this.idleWatcher?.dispose();
    await Promise.all([
      this.runtimeRegistry.persist(),
      this.bindingStore.persist(),
    ]);
    this.pipeline.dispose();
  }

  async handleChannelEvent(event: ChannelEvent): Promise<void> {
    const text = event.content.type === 'text' ? event.content.text : null;
    const threadKey = event.threadId ?? event.chatId;

    if (text && text.startsWith('/')) {
      const resolved = this.commandRegistry.resolve(text);
      if (resolved) {
        const sender = this.senderFactory(event.chatId, event.channelId);
        const binding = this.bindingStore.getOrCreate(
          event.channelId,
          event.chatId,
          threadKey,
        );

        const context: CommandContext = {
          binding,
          runtimeRegistry: this.runtimeRegistry,
          bindingStore: this.bindingStore,
          runtimeBridge: this.runtimeBridge,
          localRuntimeManager: this.localRuntimeManager,
          defaultAgentId: this.defaultAgentId,
          defaultPermissionMode: this.defaultPermissionMode,
          sender,
        };

        const result = await resolved.command.execute(resolved.args, context);
        if (typeof result === 'string') {
          await sender.sendText(result, event.messageId);
        } else {
          await sender.sendCard(result as CardModel, event.messageId);
        }
        return;
      }
    }

    const resolution = await this.runtimeRouter.resolveTarget(event);
    if (resolution.kind === 'runtime') {
      const sender = this.senderFactory(event.chatId, event.channelId);
      this.touchBinding(resolution.bindingId);
      this.cardEngine.setReplyTarget(resolution.runtimeId, event.messageId);
      this.idleWatcher?.touch(resolution.runtimeId, event.chatId);

      try {
        await this.runtimeBridge.sendPrompt(resolution.runtimeId, event);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await sender.sendText(`Error: ${detail}`);
      }
      return;
    }

    const sender = this.senderFactory(event.chatId, event.channelId);
    const availableRuntimes = this.runtimeRegistry.list();
    if (availableRuntimes.length > 0) {
      await sender.sendText(
        'No runtime attached to this thread. Use /attach <id> to connect an existing runtime.\nUse /list to see available runtimes.',
        event.messageId,
      );
      return;
    }

    await sender.sendText(
      'No runtime attached to this thread. Use /new to create one, or register an external runtime and then /attach it.',
      event.messageId,
    );
  }

  async handleCardAction(event: CardActionEvent): Promise<void> {
    const watchControl = parseWatchControlPayload(event.value);
    if (watchControl) {
      await this.handleWatchControlAction(watchControl, event);
      return;
    }

    const cardView = parseCardViewPayload(event.value);
    if (cardView) {
      this.handleActiveCardViewAction(event.messageId, cardView.view);
      return;
    }

    await this.permissionService.handleAction(event);
  }

  async handleRuntimeMessage(runtimeId: string, message: AgentMessage): Promise<void> {
    const bindings = this.bindingStore.list().filter((binding) => binding.watchRuntimeIds.includes(runtimeId));

    for (const binding of bindings) {
      const state = binding.watchState[runtimeId] ?? { unreadCount: 0 };
      const previousStatus = state.lastStatus;
      const summary = this.summaryForMessage(message);
      const outputPreview = this.outputPreviewForMessage(message);

      if (summary) {
        state.lastSummary = summary;
        state.unreadCount += 1;
      }

      if (outputPreview) {
        state.lastOutputPreview = this.appendOutputPreview(state.lastOutputPreview, outputPreview);
      }

      if (message.type === 'status') {
        state.lastStatus = message.status;
      }

      binding.watchState[runtimeId] = state;
      binding.lastActiveAt = Date.now();

      const notification = this.notificationForWatchedMessage(
        binding.bindingId,
        runtimeId,
        message,
        state,
        previousStatus,
      );
      const sender = this.senderFactory(binding.chatId, binding.channelId);
      if (notification) {
        state.lastNotifiedAt = Date.now();
        await sender.sendCard(notification, undefined);
      }
    }
  }

  private handleWatchControlAction(payload: {
    action: 'focus' | 'show-latest-output' | 'view-latest' | 'view-status' | 'unwatch';
    bindingId: string;
    runtimeId: string;
  }, event: CardActionEvent): Promise<void> | void {
    const binding = this.bindingStore.get(payload.bindingId);
    if (!binding) {
      return;
    }

    if (payload.action === 'focus') {
      const previousActiveId = binding.activeRuntimeId;
      this.bindingStore.setActive(binding.bindingId, payload.runtimeId);
      if (previousActiveId && previousActiveId !== payload.runtimeId) {
        this.bindingStore.addWatching(binding.bindingId, previousActiveId);
      }
      return;
    }

    if (
      payload.action === 'show-latest-output'
      || payload.action === 'view-latest'
      || payload.action === 'view-status'
    ) {
      const sender = this.senderFactory(event.chatId, binding.channelId);
      const runtime = this.runtimeRegistry.get(payload.runtimeId);
      const runtimeLabel = runtime?.displayName ?? payload.runtimeId.slice(0, 8);
      const watchState = binding.watchState[payload.runtimeId];
      const view = payload.action === 'view-status' ? 'status' : 'latest';
      return sender.updateCard(event.messageId, buildWatchNotificationCard({
        bindingId: binding.bindingId,
        runtimeId: payload.runtimeId,
        runtimeLabel,
        status: runtime?.status === 'error' ? 'error' : runtime?.status === 'idle' ? 'done' : 'waiting',
        message: `The watching runtime **${runtimeLabel}** needs attention.`,
        watchState: watchState ?? { unreadCount: 0 },
        runtimeStatus: runtime?.status,
        view,
      })).then(() => undefined);
    }

    if (binding.watchRuntimeIds.includes(payload.runtimeId)) {
      this.bindingStore.removeWatching(binding.bindingId, payload.runtimeId);
    }
  }

  private handleActiveCardViewAction(messageId: string, view: 'latest' | 'status'): void {
    const card = this.cardStore.getByMessageId(messageId);
    if (!card) {
      return;
    }

    this.cardStore.update(card.cardId, (state) => {
      state.metadata['selectedView'] = view;
      const rendered = renderActiveCardView(state, view);
      if (!rendered) {
        return;
      }
      state.content = {
        ...state.content,
        sections: rendered.sections,
        actions: rendered.actions,
      };
    });
  }

  private touchBinding(bindingId: string): void {
    const binding = this.bindingStore.get(bindingId);
    if (binding) {
      binding.lastActiveAt = Date.now();
    }
  }

  private summaryForMessage(message: AgentMessage): string | null {
    switch (message.type) {
      case 'model-output':
        return this.compactSummary(message.fullText ?? message.textDelta ?? '');
      case 'terminal-output':
        return this.compactSummary(message.data);
      case 'command-start':
        return this.compactSummary(message.command);
      case 'command-exit':
        return message.exitCode === 0
          ? 'Command finished successfully'
          : `Command exited with code ${message.exitCode}`;
      case 'cwd-change':
        return this.compactSummary(message.cwd);
      case 'permission-request':
        return this.compactSummary(message.reason);
      case 'exec-approval-request':
        return 'Execution approval required';
      case 'status':
        return message.status === 'running' ? null : this.compactSummary(message.detail ?? message.status);
      default:
        return null;
    }
  }

  private outputPreviewForMessage(message: AgentMessage): string | null {
    switch (message.type) {
      case 'terminal-output':
        return message.data;
      case 'model-output':
        return message.fullText ?? message.textDelta ?? '';
      default:
        return null;
    }
  }

  private notificationForWatchedMessage(
    bindingId: string,
    runtimeId: string,
    message: AgentMessage,
    state: {
      unreadCount: number;
      lastSummary?: string;
      lastStatus?: RuntimeSession['status'];
    },
    previousStatus?: RuntimeSession['status'],
  ): CardModel | null {
    const runtime = this.runtimeRegistry.get(runtimeId);
    const label = runtime?.displayName ?? runtimeId.slice(0, 8);

    if (message.type === 'permission-request' || message.type === 'exec-approval-request') {
      return buildWatchNotificationCard({
        bindingId,
        runtimeId,
        runtimeLabel: label,
        status: 'waiting',
        message: `The watching runtime **${label}** needs approval.`,
        watchState: state,
        runtimeStatus: runtime?.status,
      });
    }

    if (message.type === 'status') {
      if (message.status === 'idle' && previousStatus === 'running') {
        return buildWatchNotificationCard({
          bindingId,
          runtimeId,
          runtimeLabel: label,
          status: 'done',
          message: `The watching runtime **${label}** completed and is now idle.`,
          watchState: state,
          runtimeStatus: message.status,
        });
      }
      if (message.status === 'error') {
        const detail = message.detail ? ` ${message.detail}` : '';
        return buildWatchNotificationCard({
          bindingId,
          runtimeId,
          runtimeLabel: label,
          status: 'error',
          message: `The watching runtime **${label}** entered error state.${detail}`,
          watchState: state,
          runtimeStatus: message.status,
        });
      }
    }

    return null;
  }

  private compactSummary(text: string): string | null {
    const line = text
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1);

    if (!line) {
      return null;
    }

    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
  }

  private appendOutputPreview(existing: string | undefined, nextChunk: string): string {
    const combined = `${existing ?? ''}${nextChunk}`;
    if (combined.length <= WATCH_OUTPUT_PREVIEW_LIMIT) {
      return combined;
    }

    return combined.slice(-WATCH_OUTPUT_PREVIEW_LIMIT);
  }
}
