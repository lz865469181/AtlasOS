import type { ChannelEvent } from '../channel/channelEvent.js';
import type { ChannelSender, SenderFactory } from '../channel/ChannelSender.js';
import type { CardModel } from '../cards/CardModel.js';
import type { CardStateStoreImpl } from './CardStateStore.js';
import type { MessageCorrelationStoreImpl } from './MessageCorrelationStore.js';
import type { CardRenderPipeline } from './CardRenderPipeline.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { SessionManagerImpl, SessionInfo } from './SessionManager.js';
import type { CommandRegistryImpl, CommandContext, BridgeLike, ThreadContextStoreLike } from './CommandRegistry.js';
import type { PermissionService } from './PermissionService.js';
import type { IdleWatcher } from './IdleWatcher.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CardActionEvent {
  messageId: string;
  chatId: string;
  userId: string;
  value: Record<string, unknown>;
}

export type OnPromptCallback = (
  session: SessionInfo,
  event: ChannelEvent,
) => Promise<void>;

export interface EngineDeps {
  cardStore: CardStateStoreImpl;
  correlationStore: MessageCorrelationStoreImpl;
  pipeline: CardRenderPipeline;
  cardEngine: CardEngineImpl;
  sessionManager: SessionManagerImpl;
  commandRegistry: CommandRegistryImpl;
  permissionService: PermissionService;
  senderFactory: SenderFactory;
  bridge?: BridgeLike;
  idleWatcher?: IdleWatcher;
  threadContextStore?: ThreadContextStoreLike;
  onPrompt?: OnPromptCallback;
}

export interface Engine {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleChannelEvent(event: ChannelEvent): Promise<void>;
  handleCardAction(event: CardActionEvent): Promise<void>;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class EngineImpl implements Engine {
  private readonly cardStore: CardStateStoreImpl;
  private readonly correlationStore: MessageCorrelationStoreImpl;
  private readonly pipeline: CardRenderPipeline;
  private readonly cardEngine: CardEngineImpl;
  private readonly sessionManager: SessionManagerImpl;
  private readonly commandRegistry: CommandRegistryImpl;
  private readonly permissionService: PermissionService;
  private readonly senderFactory: SenderFactory;
  private readonly bridge?: BridgeLike;
  private readonly idleWatcher?: IdleWatcher;
  private readonly threadContextStore?: ThreadContextStoreLike;
  private readonly onPrompt?: OnPromptCallback;

  constructor(deps: EngineDeps) {
    this.cardStore = deps.cardStore;
    this.correlationStore = deps.correlationStore;
    this.pipeline = deps.pipeline;
    this.cardEngine = deps.cardEngine;
    this.sessionManager = deps.sessionManager;
    this.commandRegistry = deps.commandRegistry;
    this.permissionService = deps.permissionService;
    this.senderFactory = deps.senderFactory;
    this.bridge = deps.bridge;
    this.idleWatcher = deps.idleWatcher;
    this.threadContextStore = deps.threadContextStore;
    this.onPrompt = deps.onPrompt;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.sessionManager.restore();
  }

  async stop(): Promise<void> {
    this.idleWatcher?.dispose();
    await this.sessionManager.persist();
    this.pipeline.dispose();
  }

  // ── Channel Events ──────────────────────────────────────────────────────

  async handleChannelEvent(event: ChannelEvent): Promise<void> {
    // 1. Extract text from event
    const text = event.content.type === 'text' ? event.content.text : null;

    // 2. Compute threadKey: if user replies in thread → use threadId, else use chatId
    //    (messageId is unique per message — useless as a stable key)
    const threadKey = event.threadId ?? event.chatId;

    // 3. If text starts with '/', try command resolution
    console.log('[Engine] handleChannelEvent text=%j threadId=%s messageId=%s threadKey=%s', text, event.threadId, event.messageId, threadKey);
    if (text && text.startsWith('/')) {
      const resolved = this.commandRegistry.resolve(text);
      if (resolved) {
        const sender = this.senderFactory(event.chatId, event.channelId);
        const noopBridge: BridgeLike = {
          cancelSession: async () => {},
          destroySession: async () => {},
        };
        const context: CommandContext = {
          chatId: event.chatId,
          userId: event.userId,
          threadKey,
          sessionManager: this.sessionManager,
          bridge: this.bridge ?? noopBridge,
          sender,
          threadContextStore: this.threadContextStore,
        };

        const result = await resolved.command.execute(resolved.args, context);

        // Send the command response
        if (typeof result === 'string') {
          await sender.sendText(result, event.messageId);
        } else {
          // result is a CardModel
          await sender.sendCard(result as CardModel, event.messageId);
        }

        return;
      }
    }

    // 4. Check ThreadContext for active session override
    if (this.threadContextStore && threadKey) {
      const threadCtx = this.threadContextStore.get(event.chatId, threadKey);
      if (threadCtx?.activeSessionId) {
        const allSessions = this.sessionManager.listActive();
        const activeSession = allSessions.find(s => s.sessionId === threadCtx.activeSessionId);
        if (activeSession) {
          // Route directly to this session (skip getOrCreate)
          activeSession.lastPrompt = text ?? undefined;
          this.idleWatcher?.touch(activeSession.sessionId, activeSession.chatId);
          if (this.onPrompt) await this.onPrompt(activeSession, event);
          return;
        }
        // Active session gone — clear pointer, fall through to default
        this.threadContextStore.setActive(event.chatId, threadKey, null);
      }
    }

    // 5. Find existing session for this thread (do NOT auto-create)
    const existingSession = this.sessionManager.get(event.chatId, threadKey);
    if (existingSession) {
      // Route to existing session
      if (text) {
        existingSession.lastPrompt = text;
        this.sessionManager.appendChat(event.chatId, threadKey, {
          role: 'user',
          text,
          ts: Date.now(),
        });
      }
      this.idleWatcher?.touch(existingSession.sessionId, existingSession.chatId);
      if (this.onPrompt) {
        try {
          await this.onPrompt(existingSession, event);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          try {
            const sender = this.senderFactory(event.chatId, event.channelId);
            await sender.sendText(`Error: ${detail}`);
          } catch { /* ignore send failure */ }
        }
      }
      return;
    }

    // 6. No existing session — tell user to attach one
    const sender = this.senderFactory(event.chatId, event.channelId);
    const allSessions = this.sessionManager.listActive();
    if (allSessions.length > 0) {
      await sender.sendText(
        `No active session in this thread. Use /attach <number> to connect a session.\nUse /list to see available sessions.`,
        event.messageId,
      );
    } else {
      await sender.sendText(
        `No sessions available. Start a beam session first with \`beam start <name>\`, then use /attach to connect.`,
        event.messageId,
      );
    }
  }

  // ── Card Actions ────────────────────────────────────────────────────────

  async handleCardAction(event: CardActionEvent): Promise<void> {
    await this.permissionService.handleAction(event);
  }
}
