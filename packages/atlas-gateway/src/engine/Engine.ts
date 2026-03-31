import type { ChannelEvent } from '../channel/channelEvent.js';
import type { ChannelSender, SenderFactory } from '../channel/ChannelSender.js';
import type { CardModel } from '../cards/CardModel.js';
import type { CardStateStoreImpl } from './CardStateStore.js';
import type { MessageCorrelationStoreImpl } from './MessageCorrelationStore.js';
import type { CardRenderPipeline } from './CardRenderPipeline.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { SessionManagerImpl, SessionInfo } from './SessionManager.js';
import type { CommandRegistryImpl, CommandContext } from './CommandRegistry.js';
import type { PermissionService } from './PermissionService.js';

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
    this.onPrompt = deps.onPrompt;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.sessionManager.restore();
  }

  async stop(): Promise<void> {
    await this.sessionManager.persist();
    this.pipeline.dispose();
  }

  // ── Channel Events ──────────────────────────────────────────────────────

  async handleChannelEvent(event: ChannelEvent): Promise<void> {
    // 1. Extract text from event
    const text = event.content.type === 'text' ? event.content.text : null;

    // 2. If text starts with '/', try command resolution
    if (text && text.startsWith('/')) {
      const resolved = this.commandRegistry.resolve(text);
      if (resolved) {
        const sender = this.senderFactory(event.chatId);
        const context: CommandContext = {
          chatId: event.chatId,
          userId: event.userId,
          sessionManager: this.sessionManager,
          sender,
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

    // 3. Get or create session
    const session = await this.sessionManager.getOrCreate(event.chatId);

    // 4. Invoke the onPrompt callback to let callers wire the agent
    if (this.onPrompt) {
      await this.onPrompt(session, event);
    }
  }

  // ── Card Actions ────────────────────────────────────────────────────────

  async handleCardAction(event: CardActionEvent): Promise<void> {
    await this.permissionService.handleAction(event);
  }
}
