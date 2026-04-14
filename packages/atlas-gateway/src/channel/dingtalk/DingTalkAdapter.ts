import type { ChannelAdapter, MessageHandler } from '../ChannelAdapter.js';
import type { ChannelSender } from '../ChannelSender.js';
import type { ChannelEvent } from '../channelEvent.js';
import type { CardModel } from '../../cards/CardModel.js';
import { parseCardActionValue } from '../../cards/CardActionValue.js';
import type { CardActionEvent } from '../../engine/Engine.js';
import type { DingTalkClient, DingTalkActionCard } from './DingTalkClient.js';
import type { DingTalkMessageEvent, DingTalkCardActionEvent } from './types.js';
import { DingTalkCardRenderer } from './DingTalkCardRenderer.js';
import { DedupSet, isStaleMessage } from '../DedupSet.js';

// ── Configuration ────────────────────────────────────────────────────────────

export interface DingTalkAdapterConfig {
  appKey: string;
  appSecret: string;
  /** Use Stream mode (real-time) or HTTP callback mode. */
  mode: 'stream' | 'webhook';
  /** Max dedup set size. Defaults to 1000. */
  dedupMax?: number;
  /** Max age (ms) for incoming messages. Defaults to 120000 (2 min). */
  maxAgeMs?: number;
}

// ── Session webhook cache ────────────────────────────────────────────────────

interface WebhookEntry {
  url: string;
  expiresAt: number;
}

// ── Stream client abstraction ────────────────────────────────────────────────

/** Minimal interface for DingTalk Stream client. */
export interface DingTalkStreamClient {
  start(handlers: Record<string, (data: unknown) => Promise<unknown>>): Promise<void>;
  close(): void;
}

/** Factory that creates a DingTalk Stream client. */
export type DingTalkStreamClientFactory = (
  appKey: string,
  appSecret: string,
) => DingTalkStreamClient;

// ── Logging helper ───────────────────────────────────────────────────────────

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

// ── Pure utility functions (exported for testing) ────────────────────────────

/**
 * Parse text content from a DingTalk message event.
 * Returns { text } or null if unsupported.
 */
export function parseDingTalkContent(
  event: DingTalkMessageEvent,
): { text: string; contentType: ChannelEvent['content']['type'] } | null {
  if (event.msgtype === 'text' && event.text?.content) {
    return { text: event.text.content, contentType: 'text' };
  }
  // DingTalk robot callbacks primarily receive text; other types can be added later.
  return null;
}

/**
 * Strip @mention text from DingTalk message content.
 * DingTalk adds @botName at the start or end of the text.
 */
export function stripDingTalkMentions(text: string): string {
  // DingTalk @mentions are typically at the beginning or end and may include extra whitespace
  return text.replace(/@\S+/g, '').trim();
}

// ── DingTalkChannelSender ────────────────────────────────────────────────────

export class DingTalkChannelSender implements ChannelSender {
  private readonly client: DingTalkClient;
  private readonly chatId: string;
  private readonly renderer: DingTalkCardRenderer;
  private readonly sessionWebhook?: WebhookEntry;

  constructor(
    client: DingTalkClient,
    chatId: string,
    renderer?: DingTalkCardRenderer,
    sessionWebhook?: WebhookEntry,
  ) {
    this.client = client;
    this.chatId = chatId;
    this.renderer = renderer ?? new DingTalkCardRenderer();
    this.sessionWebhook = sessionWebhook;
  }

  async sendText(text: string, _replyTo?: string): Promise<string> {
    // Prefer session webhook for fast reply when available and not expired
    if (this.sessionWebhook && Date.now() < this.sessionWebhook.expiresAt) {
      try {
        await this.client.sendViaWebhook(this.sessionWebhook.url, {
          msgtype: 'text',
          text: { content: text },
        });
        return '';
      } catch {
        // Fall through to OpenAPI
      }
    }

    try {
      return await this.client.sendText(this.chatId, text);
    } catch (err) {
      log('error', 'Failed to send text', { chatId: this.chatId, error: String(err) });
      throw err;
    }
  }

  async sendMarkdown(md: string, _replyTo?: string): Promise<string> {
    // Prefer session webhook for fast reply
    if (this.sessionWebhook && Date.now() < this.sessionWebhook.expiresAt) {
      try {
        await this.client.sendViaWebhook(this.sessionWebhook.url, {
          msgtype: 'markdown',
          markdown: { title: 'Message', text: md },
        });
        return '';
      } catch {
        // Fall through to OpenAPI
      }
    }

    try {
      return await this.client.sendMarkdown(this.chatId, 'Message', md);
    } catch (err) {
      log('error', 'Failed to send markdown', { chatId: this.chatId, error: String(err) });
      throw err;
    }
  }

  async sendCard(card: CardModel, _replyTo?: string): Promise<string> {
    const actionCard = this.renderer.toActionCard(card);

    // Prefer session webhook for fast reply
    if (this.sessionWebhook && Date.now() < this.sessionWebhook.expiresAt) {
      try {
        await this.client.sendViaWebhook(this.sessionWebhook.url, {
          msgtype: 'actionCard',
          actionCard,
        });
        return '';
      } catch {
        // Fall through to OpenAPI
      }
    }

    try {
      return await this.client.sendActionCard(this.chatId, actionCard);
    } catch (err) {
      log('error', 'Failed to send card', { chatId: this.chatId, error: String(err) });
      throw err;
    }
  }

  async updateCard(messageId: string, card: CardModel): Promise<void> {
    const actionCard = this.renderer.toActionCard(card);
    try {
      await this.client.updateCard(messageId, actionCard);
    } catch (err) {
      log('warn', 'Failed to update card', { messageId, error: String(err) });
    }
  }
}

// ── DingTalkAdapter ──────────────────────────────────────────────────────────

export class DingTalkAdapter implements ChannelAdapter {
  readonly id = 'dingtalk';

  private readonly config: DingTalkAdapterConfig;
  private readonly client: DingTalkClient;
  private readonly streamClientFactory?: DingTalkStreamClientFactory;
  private readonly renderer: DingTalkCardRenderer;
  private readonly dedup: DedupSet;
  private readonly maxAgeMs: number;
  private readonly onCardAction?: (event: CardActionEvent) => Promise<void>;

  /** Cache of session webhooks per conversationId. */
  private readonly webhookCache = new Map<string, WebhookEntry>();
  private streamClient: DingTalkStreamClient | null = null;

  constructor(opts: {
    config: DingTalkAdapterConfig;
    client: DingTalkClient;
    streamClientFactory?: DingTalkStreamClientFactory;
    renderer?: DingTalkCardRenderer;
    onCardAction?: (event: CardActionEvent) => Promise<void>;
  }) {
    this.config = opts.config;
    this.client = opts.client;
    this.streamClientFactory = opts.streamClientFactory;
    this.renderer = opts.renderer ?? new DingTalkCardRenderer();
    this.dedup = new DedupSet(opts.config.dedupMax ?? 1000);
    this.maxAgeMs = opts.config.maxAgeMs ?? 2 * 60 * 1000;
    this.onCardAction = opts.onCardAction;
  }

  async start(handler: MessageHandler): Promise<void> {
    if (this.config.mode === 'stream' && this.streamClientFactory) {
      const handlers: Record<string, (data: unknown) => Promise<unknown>> = {
        'robot_message': async (data: unknown) => {
          try {
            await this.handleMessageEvent(data as DingTalkMessageEvent, handler);
          } catch (err) {
            log('error', 'Error handling DingTalk message', { error: String(err) });
          }
        },
      };

      if (this.onCardAction) {
        handlers['card_action'] = async (data: unknown) => {
          try {
            const cardEvent = this.toCardActionEvent(data as DingTalkCardActionEvent);
            if (cardEvent && this.onCardAction) {
              await this.onCardAction(cardEvent);
            }
          } catch (err) {
            log('error', 'Error handling DingTalk card action', { error: String(err) });
          }
        };
      }

      this.streamClient = this.streamClientFactory(this.config.appKey, this.config.appSecret);
      log('info', 'Starting DingTalk Stream connection');
      await this.streamClient.start(handlers);
      log('info', 'DingTalk adapter started (stream mode)');
    } else {
      log('info', 'DingTalk adapter started (webhook mode — awaiting external HTTP handler)');
    }
  }

  async stop(): Promise<void> {
    log('info', 'DingTalk adapter stopping');
    if (this.streamClient) {
      this.streamClient.close();
      this.streamClient = null;
    }
    this.dedup.clear();
    this.webhookCache.clear();
  }

  getSender(chatId: string): ChannelSender {
    const webhook = this.webhookCache.get(chatId);
    return new DingTalkChannelSender(this.client, chatId, this.renderer, webhook);
  }

  // ── Public handler for external webhook mode ──────────────────────────────

  /** Handle an incoming message from DingTalk webhook callback. */
  async handleMessageEvent(data: DingTalkMessageEvent, handler: MessageHandler): Promise<void> {
    const msgId = data.msgId;

    // Dedup
    if (msgId && this.dedup.has(msgId)) {
      log('debug', 'Skipping duplicate DingTalk message', { messageID: msgId });
      return;
    }

    // Stale message filter
    const createTimeMs = data.createAt;
    if (createTimeMs && isStaleMessage(createTimeMs, this.maxAgeMs)) {
      log('info', 'Skipping stale DingTalk message', {
        messageID: msgId,
        ageSeconds: Math.round((Date.now() - createTimeMs) / 1000),
      });
      return;
    }

    // Cache session webhook
    if (data.sessionWebhook && data.sessionWebhookExpiredTime) {
      this.webhookCache.set(data.conversationId, {
        url: data.sessionWebhook,
        expiresAt: data.sessionWebhookExpiredTime,
      });
    }

    // Parse the event into a ChannelEvent
    const event = this.toChannelEvent(data);
    if (!event) return;

    // Mark as processed
    if (msgId) {
      this.dedup.add(msgId);
    }

    await handler(event);
  }

  // ── Internal event conversion ─────────────────────────────────────────────

  /**
   * Convert a raw DingTalk card action event into a CardActionEvent.
   * Returns null if required fields are missing.
   */
  toCardActionEvent(data: DingTalkCardActionEvent): CardActionEvent | null {
    const messageId = data.msgId;
    const chatId = data.conversationId;
    const userId = data.senderStaffId;
    const value = parseCardActionValue(data.value);
    if (!messageId || !chatId || !userId || !value) return null;
    return { messageId, chatId, userId, value };
  }

  /**
   * Convert a raw DingTalk message event into a ChannelEvent.
   * Returns null if the message cannot be parsed or is empty.
   */
  toChannelEvent(data: DingTalkMessageEvent): ChannelEvent | null {
    const chatId = data.conversationId;
    const messageId = data.msgId;
    const userId = data.senderStaffId ?? 'unknown';
    const userName = data.senderNick ?? '';
    const timestamp = data.createAt ?? Date.now();

    const parsed = parseDingTalkContent(data);
    if (!parsed) return null;

    let { text } = parsed;

    // Strip @mentions in group chats
    if (data.conversationType === '2') {
      text = stripDingTalkMentions(text);
    }

    if (!text.trim()) return null;

    return {
      channelId: 'dingtalk',
      chatId,
      userId,
      userName,
      messageId,
      content: { type: 'text', text: text.trim() },
      timestamp,
    };
  }
}
