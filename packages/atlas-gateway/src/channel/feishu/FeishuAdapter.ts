import type { ChannelAdapter, MessageHandler } from '../ChannelAdapter.js';
import type { ChannelSender } from '../ChannelSender.js';
import type { ChannelEvent } from '../channelEvent.js';
import type { CardModel } from '../../cards/CardModel.js';
import { parseCardActionValue } from '../../cards/CardActionValue.js';
import type { CardActionEvent } from '../../engine/Engine.js';
import { FeishuCardRenderer } from './FeishuCardRenderer.js';

// ── Configuration ────────────────────────────────────────────────────────

export interface FeishuAdapterConfig {
  appId: string;
  appSecret: string;
  /** Optional verification token for webhook callbacks. */
  verificationToken?: string;
  /** Max dedup set size. Defaults to 1000. */
  dedupMax?: number;
  /** Max age (ms) for incoming messages. Defaults to 120000 (2 min). */
  maxAgeMs?: number;
}

// ── Lark SDK abstraction (injectable for testing) ────────────────────────

/** Minimal shape of the Lark/Feishu IM message API we use. */
export interface LarkImMessage {
  create(params: {
    params: { receive_id_type: string };
    data: { receive_id: string; msg_type: string; content: string };
  }): Promise<{ data?: { message_id?: string } }>;

  reply(params: {
    path: { message_id: string };
    data: { content: string; msg_type: string };
  }): Promise<{ data?: { message_id?: string } }>;

  patch(params: {
    path: { message_id: string };
    data: { content: string };
  }): Promise<unknown>;
}

export interface LarkImReaction {
  create(params: {
    path: { message_id: string };
    data: { reaction_type: { emoji_type: string } };
  }): Promise<unknown>;
}

/**
 * Minimal interface over the parts of `@larksuiteoapi/node-sdk` we consume.
 * In production, provide the real `lark.Client`; in tests, provide a mock.
 */
export interface LarkClient {
  im: {
    message: LarkImMessage;
    messageReaction?: LarkImReaction;
  };
}

/** Minimal interface for WSClient. */
export interface LarkWSClient {
  start(opts: { eventDispatcher: unknown }): Promise<void>;
  close(): void;
}

/** Factory that creates a WSClient from appId/appSecret. */
export type WSClientFactory = (appId: string, appSecret: string) => LarkWSClient;

/** Factory that creates an EventDispatcher and registers handlers. */
export type EventDispatcherFactory = (handlers: Record<string, (data: unknown) => Promise<unknown>>) => unknown;

// ── Feishu message event shape ───────────────────────────────────────────

export interface FeishuMessageEvent {
  sender: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string; union_id?: string };
      name: string;
      tenant_key?: string;
    }>;
  };
}

// ── Card action event shape ──────────────────────────────────────────────

export interface FeishuCardActionEvent {
  operator: { open_id?: string };
  action: { value: unknown; tag?: string };
  token?: string;
  open_message_id?: string;
  open_chat_id?: string;
}

// ── Logging helper ───────────────────────────────────────────────────────

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

// Re-export shared utilities for backward compatibility
export { DedupSet, isStaleMessage } from '../DedupSet.js';
import { DedupSet, isStaleMessage } from '../DedupSet.js';

// ── Pure utility functions (exported for testing) ────────────────────────

/**
 * Parse text content from a Feishu message event.
 * Returns { text, contentType } or null if unsupported.
 */
export function parseMessageContent(
  messageType: string,
  contentJson: string,
): { text: string; contentType: ChannelEvent['content']['type'] } | null {
  switch (messageType) {
    case 'text': {
      try {
        const content = JSON.parse(contentJson);
        return { text: content.text ?? '', contentType: 'text' };
      } catch {
        return { text: contentJson ?? '', contentType: 'text' };
      }
    }
    case 'image': {
      try {
        const content = JSON.parse(contentJson);
        const imageKey = content.image_key;
        if (imageKey) {
          return { text: imageKey, contentType: 'image' };
        }
      } catch {
        // fall through
      }
      return null;
    }
    case 'file': {
      try {
        const content = JSON.parse(contentJson);
        const fileKey = content.file_key;
        const fileName = content.file_name ?? 'file';
        if (fileKey) {
          return { text: `${fileKey}:${fileName}`, contentType: 'file' };
        }
      } catch {
        // fall through
      }
      return null;
    }
    case 'audio': {
      try {
        const content = JSON.parse(contentJson);
        const fileKey = content.file_key;
        if (fileKey) {
          return { text: fileKey, contentType: 'audio' };
        }
      } catch {
        // fall through
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Strip @mention placeholders from text.
 * Feishu uses keys like `@_user_1` in the text content.
 */
export function stripMentions(
  text: string,
  mentions: Array<{ key: string; name: string }>,
): string {
  let result = text;
  for (const mention of mentions) {
    if (mention.key) {
      result = result.replace(mention.key, '');
    }
  }
  // Strip zero-width / invisible Unicode characters that Feishu may inject,
  // then collapse whitespace and trim.
  result = result.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
  return result.trim();
}

// ── FeishuChannelSender ──────────────────────────────────────────────────

export class FeishuChannelSender implements ChannelSender {
  private readonly larkClient: LarkClient;
  private readonly chatId: string;
  private readonly renderer: FeishuCardRenderer;

  constructor(larkClient: LarkClient, chatId: string, renderer?: FeishuCardRenderer) {
    this.larkClient = larkClient;
    this.chatId = chatId;
    this.renderer = renderer ?? new FeishuCardRenderer();
  }

  async sendText(text: string, replyTo?: string): Promise<string> {
    console.log(`[FeishuSender] sendText len=${text.length} replyTo=${replyTo} text="${text.slice(0, 80)}"`);
    console.trace('[FeishuSender] sendText stack');
    const content = JSON.stringify({ text });
    try {
      if (replyTo) {
        const resp = await this.larkClient.im.message.reply({
          path: { message_id: replyTo },
          data: { content, msg_type: 'text' },
        });
        return resp?.data?.message_id ?? '';
      }
      const resp = await this.larkClient.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: this.chatId, msg_type: 'text', content },
      });
      return resp?.data?.message_id ?? '';
    } catch (err) {
      log('error', 'Failed to send text', { chatId: this.chatId, error: String(err) });
      throw err;
    }
  }

  async sendMarkdown(md: string, replyTo?: string): Promise<string> {
    const card = {
      config: { wide_screen_mode: true },
      elements: [{ tag: 'markdown' as const, content: md }],
    };
    const content = JSON.stringify(card);
    try {
      if (replyTo) {
        const resp = await this.larkClient.im.message.reply({
          path: { message_id: replyTo },
          data: { content, msg_type: 'interactive' },
        });
        return resp?.data?.message_id ?? '';
      }
      const resp = await this.larkClient.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: this.chatId, msg_type: 'interactive', content },
      });
      return resp?.data?.message_id ?? '';
    } catch (err) {
      log('error', 'Failed to send markdown', { chatId: this.chatId, error: String(err) });
      throw err;
    }
  }

  async sendCard(card: CardModel, replyTo?: string): Promise<string> {
    const content = this.renderer.toFeishuJsonString(card);
    try {
      if (replyTo) {
        const resp = await this.larkClient.im.message.reply({
          path: { message_id: replyTo },
          data: { content, msg_type: 'interactive' },
        });
        return resp?.data?.message_id ?? '';
      }
      const resp = await this.larkClient.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: this.chatId, msg_type: 'interactive', content },
      });
      return resp?.data?.message_id ?? '';
    } catch (err) {
      log('error', 'Failed to send card', { chatId: this.chatId, error: String(err) });
      throw err;
    }
  }

  async updateCard(messageId: string, card: CardModel): Promise<void> {
    const content = this.renderer.toFeishuJsonString(card);
    try {
      await this.larkClient.im.message.patch({
        path: { message_id: messageId },
        data: { content },
      });
    } catch (err) {
      log('warn', 'Failed to update card', { messageId, error: String(err) });
    }
  }

  async addReaction(messageId: string, emoji: string): Promise<void> {
    if (!this.larkClient.im.messageReaction) return;
    try {
      await this.larkClient.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emoji } },
      });
    } catch (err) {
      log('warn', 'Failed to add reaction', { messageId, emoji, error: String(err) });
    }
  }
}

// ── FeishuAdapter ────────────────────────────────────────────────────────

export class FeishuAdapter implements ChannelAdapter {
  readonly id = 'feishu';

  private readonly config: FeishuAdapterConfig;
  private readonly larkClient: LarkClient;
  private readonly wsClientFactory?: WSClientFactory;
  private readonly eventDispatcherFactory?: EventDispatcherFactory;
  private readonly renderer: FeishuCardRenderer;
  private readonly dedup: DedupSet;
  private readonly maxAgeMs: number;
  private readonly onCardAction?: (event: CardActionEvent) => Promise<void>;

  private wsClient: LarkWSClient | null = null;

  constructor(opts: {
    config: FeishuAdapterConfig;
    larkClient: LarkClient;
    wsClientFactory?: WSClientFactory;
    eventDispatcherFactory?: EventDispatcherFactory;
    renderer?: FeishuCardRenderer;
    onCardAction?: (event: CardActionEvent) => Promise<void>;
  }) {
    this.config = opts.config;
    this.larkClient = opts.larkClient;
    this.wsClientFactory = opts.wsClientFactory;
    this.eventDispatcherFactory = opts.eventDispatcherFactory;
    this.renderer = opts.renderer ?? new FeishuCardRenderer();
    this.dedup = new DedupSet(opts.config.dedupMax ?? 1000);
    this.maxAgeMs = opts.config.maxAgeMs ?? 2 * 60 * 1000;
    this.onCardAction = opts.onCardAction;
  }

  async start(handler: MessageHandler): Promise<void> {
    const handlers: Record<string, (data: unknown) => Promise<unknown>> = {
      'im.message.receive_v1': async (data: unknown) => {
        try {
          await this.handleMessageEvent(data as FeishuMessageEvent, handler);
        } catch (err) {
          log('error', 'Error handling Feishu message', { error: String(err) });
        }
      },
    };

    if (this.onCardAction) {
      handlers['card.action.trigger'] = async (data: unknown) => {
        try {
          const cardEvent = this.toCardActionEvent(data as FeishuCardActionEvent);
          if (cardEvent && this.onCardAction) {
            await this.onCardAction(cardEvent);
          }
        } catch (err) {
          log('error', 'Error handling card action', { error: String(err) });
        }
      };
    }

    // Create event dispatcher
    let eventDispatcher: unknown;
    if (this.eventDispatcherFactory) {
      eventDispatcher = this.eventDispatcherFactory(handlers);
    } else {
      // In production, we would use `new lark.EventDispatcher({}).register(handlers)`
      // but the SDK is injected, so the factory must be provided.
      log('warn', 'No eventDispatcherFactory provided; start() will not connect to WS');
      return;
    }

    // Create and start WSClient
    if (this.wsClientFactory) {
      this.wsClient = this.wsClientFactory(this.config.appId, this.config.appSecret);
      log('info', 'Starting Feishu WebSocket connection');
      await this.wsClient.start({ eventDispatcher });
      log('info', 'Feishu adapter started');
    } else {
      log('warn', 'No wsClientFactory provided; adapter started without WS connection');
    }
  }

  async stop(): Promise<void> {
    log('info', 'Feishu adapter stopping');
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.dedup.clear();
  }

  getSender(chatId: string): ChannelSender {
    return new FeishuChannelSender(this.larkClient, chatId, this.renderer);
  }

  // ── Internal event handling ──────────────────────────────────────────

  /**
   * Process an incoming message event from the Feishu WS connection.
   * Exported as a method (not private) so the class can be tested,
   * but prefixed with 'handle' to indicate it's internal.
   */
  async handleMessageEvent(data: FeishuMessageEvent, handler: MessageHandler): Promise<void> {
    const msgId = data.message?.message_id;

    // Dedup
    if (msgId && this.dedup.has(msgId)) {
      log('debug', 'Skipping duplicate message', { messageID: msgId });
      return;
    }

    // Stale message filter
    const createTimeMs = Number(data.message?.create_time);
    if (createTimeMs && isStaleMessage(createTimeMs, this.maxAgeMs)) {
      log('info', 'Skipping stale message', {
        messageID: msgId,
        ageSeconds: Math.round((Date.now() - createTimeMs) / 1000),
      });
      return;
    }

    // Parse the event into a ChannelEvent
    console.log('[FeishuAdapter] handleMessageEvent message_type=%s content=%s root_id=%s',
      data.message?.message_type, data.message?.content, data.message?.root_id);
    const event = this.toChannelEvent(data);
    if (!event) {
      console.log('[FeishuAdapter] toChannelEvent returned null — message dropped');
      return;
    }

    // Mark as processed
    if (msgId) {
      this.dedup.add(msgId);
    }

    await handler(event);
  }

  /**
   * Convert a raw Feishu card action event into a CardActionEvent.
   * Returns null if required fields are missing or value is not an object.
   */
  toCardActionEvent(data: FeishuCardActionEvent): CardActionEvent | null {
    const messageId = data.open_message_id;
    const chatId = data.open_chat_id;
    const userId = data.operator?.open_id;
    const value = parseCardActionValue(data.action?.value);
    if (!messageId || !chatId || !userId || !value) return null;
    return { messageId, chatId, userId, value };
  }

  /**
   * Convert a raw Feishu message event into a ChannelEvent.
   * Returns null if the message cannot be parsed or is empty.
   */
  toChannelEvent(data: FeishuMessageEvent): ChannelEvent | null {
    const { message, sender } = data;

    const chatId = message.chat_id;
    const messageId = message.message_id;
    const userId = sender.sender_id?.open_id ?? 'unknown';
    // Feishu doesn't provide userName directly in message events;
    // use mentions or a default
    const userName = '';
    const timestamp = Number(message.create_time) || Date.now();

    const parsed = parseMessageContent(message.message_type, message.content);
    if (!parsed) return null;

    let { text } = parsed;
    const { contentType } = parsed;

    // Strip mentions in group chats
    const mentions = message.mentions ?? [];
    console.log('[FeishuAdapter] toChannelEvent raw text=%j mentions=%j root_id=%s message_id=%s', text, mentions.map(m => ({ key: m.key, name: m.name })), message.root_id, message.message_id);
    if (mentions.length > 0 && contentType === 'text') {
      text = stripMentions(text, mentions);
    }
    console.log('[FeishuAdapter] after stripMentions text=%j startsWith(/)=%s', text, text.startsWith('/'));

    // Build content based on type
    let content: ChannelEvent['content'];
    switch (contentType) {
      case 'text':
        if (!text.trim()) return null;
        content = { type: 'text', text: text.trim() };
        break;
      case 'image':
        content = { type: 'image', url: text, mimeType: 'image/png' };
        break;
      case 'file': {
        const [fileKey, ...nameParts] = text.split(':');
        const filename = nameParts.join(':') || 'file';
        content = { type: 'file', url: fileKey ?? '', filename };
        break;
      }
      case 'audio':
        content = { type: 'audio', url: text };
        break;
      default:
        return null;
    }

    const threadId = message.root_id && message.root_id !== message.message_id
      ? message.root_id
      : undefined;

    return {
      channelId: 'feishu',
      chatId,
      userId,
      userName,
      messageId,
      threadId,
      content,
      timestamp,
      replyToId: message.parent_id,
    };
  }
}
