import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FeishuAdapter,
  FeishuChannelSender,
  DedupSet,
  parseMessageContent,
  stripMentions,
  isStaleMessage,
  type FeishuAdapterConfig,
  type FeishuMessageEvent,
  type FeishuCardActionEvent,
  type LarkClient,
  type LarkWSClient,
} from './FeishuAdapter.js';
import type { ChannelEvent } from '../channelEvent.js';
import type { CardModel } from '../../cards/CardModel.js';
import type { CardActionEvent } from '../../engine/Engine.js';

// ── Mock helpers ─────────────────────────────────────────────────────────

function createMockLarkClient(): LarkClient {
  return {
    im: {
      message: {
        create: vi.fn().mockResolvedValue({ data: { message_id: 'msg_created_001' } }),
        reply: vi.fn().mockResolvedValue({ data: { message_id: 'msg_reply_001' } }),
        patch: vi.fn().mockResolvedValue({}),
      },
      messageReaction: {
        create: vi.fn().mockResolvedValue({}),
      },
    },
  };
}

function makeMessageEvent(overrides?: Partial<{
  messageId: string;
  chatId: string;
  chatType: string;
  messageType: string;
  content: string;
  createTime: string;
  openId: string;
  mentions: FeishuMessageEvent['message']['mentions'];
  parentId: string;
  rootId: string;
}>): FeishuMessageEvent {
  const now = Date.now();
  return {
    sender: {
      sender_id: { open_id: overrides?.openId ?? 'ou_user123' },
      sender_type: 'user',
    },
    message: {
      message_id: overrides?.messageId ?? `msg_${now}`,
      chat_id: overrides?.chatId ?? 'oc_chat123',
      chat_type: overrides?.chatType ?? 'p2p',
      message_type: overrides?.messageType ?? 'text',
      content: overrides?.content ?? JSON.stringify({ text: 'hello world' }),
      create_time: overrides?.createTime ?? String(now),
      mentions: overrides?.mentions,
      parent_id: overrides?.parentId,
      root_id: overrides?.rootId,
    },
  };
}

// ── parseMessageContent ──────────────────────────────────────────────────

describe('parseMessageContent', () => {
  it('parses text messages from JSON content', () => {
    const result = parseMessageContent('text', JSON.stringify({ text: 'hello' }));
    expect(result).toEqual({ text: 'hello', contentType: 'text' });
  });

  it('handles malformed JSON in text message gracefully', () => {
    const result = parseMessageContent('text', 'raw text');
    expect(result).toEqual({ text: 'raw text', contentType: 'text' });
  });

  it('parses text with empty text field', () => {
    const result = parseMessageContent('text', JSON.stringify({ text: '' }));
    expect(result).toEqual({ text: '', contentType: 'text' });
  });

  it('parses image messages', () => {
    const result = parseMessageContent('image', JSON.stringify({ image_key: 'img_key_123' }));
    expect(result).toEqual({ text: 'img_key_123', contentType: 'image' });
  });

  it('returns null for image message without image_key', () => {
    const result = parseMessageContent('image', JSON.stringify({}));
    expect(result).toBeNull();
  });

  it('parses file messages with file_key and file_name', () => {
    const result = parseMessageContent('file', JSON.stringify({ file_key: 'fk_001', file_name: 'doc.pdf' }));
    expect(result).toEqual({ text: 'fk_001:doc.pdf', contentType: 'file' });
  });

  it('uses default filename when file_name is missing', () => {
    const result = parseMessageContent('file', JSON.stringify({ file_key: 'fk_002' }));
    expect(result).toEqual({ text: 'fk_002:file', contentType: 'file' });
  });

  it('parses audio messages', () => {
    const result = parseMessageContent('audio', JSON.stringify({ file_key: 'audio_key_1' }));
    expect(result).toEqual({ text: 'audio_key_1', contentType: 'audio' });
  });

  it('returns null for unsupported message types', () => {
    expect(parseMessageContent('sticker', '{}')).toBeNull();
    expect(parseMessageContent('video', '{}')).toBeNull();
    expect(parseMessageContent('location', '{}')).toBeNull();
  });

  it('returns null for image with malformed JSON', () => {
    const result = parseMessageContent('image', 'not-json');
    expect(result).toBeNull();
  });
});

// ── stripMentions ────────────────────────────────────────────────────────

describe('stripMentions', () => {
  it('removes mention keys from text', () => {
    const result = stripMentions('@_user_1 hello there', [
      { key: '@_user_1', name: 'Bot' },
    ]);
    expect(result).toBe('hello there');
  });

  it('removes multiple mention keys', () => {
    const result = stripMentions('@_user_1 @_user_2 task for you', [
      { key: '@_user_1', name: 'Bot' },
      { key: '@_user_2', name: 'Alice' },
    ]);
    expect(result).toBe('task for you');
  });

  it('handles empty mentions array', () => {
    const result = stripMentions('hello world', []);
    expect(result).toBe('hello world');
  });

  it('handles text with no matching keys', () => {
    const result = stripMentions('hello world', [
      { key: '@_user_99', name: 'Nobody' },
    ]);
    expect(result).toBe('hello world');
  });

  it('trims whitespace after stripping', () => {
    const result = stripMentions('  @_user_1  hello  ', [
      { key: '@_user_1', name: 'Bot' },
    ]);
    expect(result).toBe('hello');
  });

  it('returns empty string when only mention remains', () => {
    const result = stripMentions('@_user_1', [
      { key: '@_user_1', name: 'Bot' },
    ]);
    expect(result).toBe('');
  });
});

// ── isStaleMessage ───────────────────────────────────────────────────────

describe('isStaleMessage', () => {
  const TWO_MIN = 2 * 60 * 1000;

  it('returns false for a fresh message', () => {
    const now = 1000000;
    expect(isStaleMessage(now - 1000, TWO_MIN, now)).toBe(false);
  });

  it('returns false for a message exactly at the boundary', () => {
    const now = 1000000;
    expect(isStaleMessage(now - TWO_MIN, TWO_MIN, now)).toBe(false);
  });

  it('returns true for a message older than maxAge', () => {
    const now = 1000000;
    expect(isStaleMessage(now - TWO_MIN - 1, TWO_MIN, now)).toBe(true);
  });

  it('returns true for a very old message', () => {
    const now = Date.now();
    expect(isStaleMessage(now - 10 * 60 * 1000, TWO_MIN, now)).toBe(true);
  });
});

// ── DedupSet ─────────────────────────────────────────────────────────────

describe('DedupSet', () => {
  it('tracks added IDs', () => {
    const ds = new DedupSet(5);
    ds.add('a');
    ds.add('b');
    expect(ds.has('a')).toBe(true);
    expect(ds.has('b')).toBe(true);
    expect(ds.has('c')).toBe(false);
  });

  it('evicts oldest entry when exceeding max', () => {
    const ds = new DedupSet(3);
    ds.add('a');
    ds.add('b');
    ds.add('c');
    expect(ds.size).toBe(3);

    ds.add('d'); // should evict 'a'
    expect(ds.size).toBe(3);
    expect(ds.has('a')).toBe(false);
    expect(ds.has('b')).toBe(true);
    expect(ds.has('d')).toBe(true);
  });

  it('does not evict when at exactly max', () => {
    const ds = new DedupSet(3);
    ds.add('a');
    ds.add('b');
    ds.add('c');
    expect(ds.size).toBe(3);
    expect(ds.has('a')).toBe(true);
  });

  it('clear() resets the set', () => {
    const ds = new DedupSet(10);
    ds.add('x');
    ds.add('y');
    ds.clear();
    expect(ds.size).toBe(0);
    expect(ds.has('x')).toBe(false);
  });

  it('defaults to max 1000', () => {
    const ds = new DedupSet();
    // Just verify it works; we won't add 1001 entries in this test
    ds.add('test');
    expect(ds.has('test')).toBe(true);
  });
});

// ── FeishuChannelSender ──────────────────────────────────────────────────

describe('FeishuChannelSender', () => {
  let mockClient: LarkClient;
  let sender: FeishuChannelSender;

  beforeEach(() => {
    mockClient = createMockLarkClient();
    sender = new FeishuChannelSender(mockClient, 'oc_test_chat');
  });

  describe('sendText', () => {
    it('sends text message to chat via create', async () => {
      const msgId = await sender.sendText('Hello!');
      expect(msgId).toBe('msg_created_001');
      expect(mockClient.im.message.create).toHaveBeenCalledWith({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: 'oc_test_chat',
          msg_type: 'text',
          content: JSON.stringify({ text: 'Hello!' }),
        },
      });
    });

    it('replies to a message when replyTo is provided', async () => {
      const msgId = await sender.sendText('Reply!', 'msg_original');
      expect(msgId).toBe('msg_reply_001');
      expect(mockClient.im.message.reply).toHaveBeenCalledWith({
        path: { message_id: 'msg_original' },
        data: {
          content: JSON.stringify({ text: 'Reply!' }),
          msg_type: 'text',
        },
      });
    });
  });

  describe('sendMarkdown', () => {
    it('sends markdown as interactive card', async () => {
      await sender.sendMarkdown('**bold**');
      expect(mockClient.im.message.create).toHaveBeenCalled();
      const call = vi.mocked(mockClient.im.message.create).mock.calls[0]![0];
      expect(call.data.msg_type).toBe('interactive');
      const content = JSON.parse(call.data.content);
      expect(content.elements[0].tag).toBe('markdown');
      expect(content.elements[0].content).toBe('**bold**');
    });
  });

  describe('sendCard', () => {
    it('sends card via FeishuCardRenderer', async () => {
      const card: CardModel = {
        header: { title: 'Test Card' },
        sections: [{ type: 'markdown', content: 'Body text' }],
      };
      const msgId = await sender.sendCard(card);
      expect(msgId).toBe('msg_created_001');
      expect(mockClient.im.message.create).toHaveBeenCalled();
      const call = vi.mocked(mockClient.im.message.create).mock.calls[0]![0];
      expect(call.data.msg_type).toBe('interactive');
      const content = JSON.parse(call.data.content);
      expect(content.config.wide_screen_mode).toBe(true);
      expect(content.header.title.content).toBe('Test Card');
    });

    it('replies with card when replyTo is provided', async () => {
      const card: CardModel = {
        sections: [{ type: 'markdown', content: 'hi' }],
      };
      await sender.sendCard(card, 'msg_parent');
      expect(mockClient.im.message.reply).toHaveBeenCalled();
    });
  });

  describe('updateCard', () => {
    it('patches existing message with new card content', async () => {
      const card: CardModel = {
        sections: [{ type: 'markdown', content: 'updated' }],
      };
      await sender.updateCard('msg_to_update', card);
      expect(mockClient.im.message.patch).toHaveBeenCalledWith({
        path: { message_id: 'msg_to_update' },
        data: { content: expect.any(String) },
      });
    });
  });

  describe('addReaction', () => {
    it('adds emoji reaction', async () => {
      await sender.addReaction('msg_123', 'THUMBSUP');
      expect(mockClient.im.messageReaction!.create).toHaveBeenCalledWith({
        path: { message_id: 'msg_123' },
        data: { reaction_type: { emoji_type: 'THUMBSUP' } },
      });
    });

    it('does not throw when messageReaction is undefined', async () => {
      const client: LarkClient = {
        im: {
          message: mockClient.im.message,
          // no messageReaction
        },
      };
      const s = new FeishuChannelSender(client, 'oc_chat');
      await expect(s.addReaction('msg_1', 'OK')).resolves.toBeUndefined();
    });
  });
});

// ── FeishuAdapter ────────────────────────────────────────────────────────

describe('FeishuAdapter', () => {
  let mockClient: LarkClient;
  let adapter: FeishuAdapter;
  const config: FeishuAdapterConfig = {
    appId: 'test_app_id',
    appSecret: 'test_secret',
    dedupMax: 5,
    maxAgeMs: 2 * 60 * 1000,
  };

  beforeEach(() => {
    mockClient = createMockLarkClient();
    adapter = new FeishuAdapter({
      config,
      larkClient: mockClient,
    });
  });

  describe('id', () => {
    it('returns "feishu"', () => {
      expect(adapter.id).toBe('feishu');
    });
  });

  describe('getSender', () => {
    it('returns a FeishuChannelSender for the given chatId', () => {
      const sender = adapter.getSender('oc_chat_abc');
      expect(sender).toBeInstanceOf(FeishuChannelSender);
    });
  });

  describe('toChannelEvent', () => {
    it('parses a text message into a ChannelEvent', () => {
      const data = makeMessageEvent({
        content: JSON.stringify({ text: 'hello' }),
        chatId: 'oc_chat1',
        openId: 'ou_user1',
      });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.channelId).toBe('feishu');
      expect(event!.chatId).toBe('oc_chat1');
      expect(event!.userId).toBe('ou_user1');
      expect(event!.content).toEqual({ type: 'text', text: 'hello' });
    });

    it('strips mentions from group chat text', () => {
      const data = makeMessageEvent({
        chatType: 'group',
        content: JSON.stringify({ text: '@_user_1 do something' }),
        mentions: [
          { key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'Bot', tenant_key: 'tk' },
        ],
      });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.content).toEqual({ type: 'text', text: 'do something' });
    });

    it('returns null for empty text after mention stripping', () => {
      const data = makeMessageEvent({
        content: JSON.stringify({ text: '@_user_1' }),
        mentions: [
          { key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'Bot', tenant_key: 'tk' },
        ],
      });
      const event = adapter.toChannelEvent(data);
      expect(event).toBeNull();
    });

    it('returns null for unsupported message types', () => {
      const data = makeMessageEvent({ messageType: 'sticker', content: '{}' });
      const event = adapter.toChannelEvent(data);
      expect(event).toBeNull();
    });

    it('parses image messages', () => {
      const data = makeMessageEvent({
        messageType: 'image',
        content: JSON.stringify({ image_key: 'img_abc' }),
      });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.content).toEqual({ type: 'image', url: 'img_abc', mimeType: 'image/png' });
    });

    it('parses file messages', () => {
      const data = makeMessageEvent({
        messageType: 'file',
        content: JSON.stringify({ file_key: 'fk_123', file_name: 'report.pdf' }),
      });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.content).toEqual({ type: 'file', url: 'fk_123', filename: 'report.pdf' });
    });

    it('parses audio messages', () => {
      const data = makeMessageEvent({
        messageType: 'audio',
        content: JSON.stringify({ file_key: 'aud_001' }),
      });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.content).toEqual({ type: 'audio', url: 'aud_001' });
    });

    it('includes replyToId from parent_id', () => {
      const data = makeMessageEvent({ parentId: 'msg_parent_1' });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.replyToId).toBe('msg_parent_1');
    });

    it('uses "unknown" when sender open_id is missing', () => {
      const data = makeMessageEvent();
      data.sender.sender_id = undefined;
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.userId).toBe('unknown');
    });

    it('sets threadId from root_id when present and different from message_id', () => {
      const data = makeMessageEvent({
        messageId: 'msg_reply',
        rootId: 'msg_root',
        parentId: 'msg_parent',
        chatType: 'group',
      });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.threadId).toBe('msg_root');
    });

    it('does not set threadId when root_id equals message_id', () => {
      const data = makeMessageEvent({ messageId: 'msg_root', rootId: 'msg_root' });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.threadId).toBeUndefined();
    });

    it('does not set threadId when root_id is absent', () => {
      const data = makeMessageEvent();
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.threadId).toBeUndefined();
    });
  });

  it('preserves slash command in thread reply with mention', () => {
      const data = makeMessageEvent({
        messageId: 'msg_reply_1',
        rootId: 'msg_root_1',
        chatType: 'group',
        content: JSON.stringify({ text: '@_user_1 /attach 1' }),
        mentions: [
          { key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'Bot', tenant_key: 'tk' },
        ],
      });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.content).toEqual({ type: 'text', text: '/attach 1' });
      expect(event!.threadId).toBe('msg_root_1');
    });

    it('handles slash command with newline after mention in thread reply', () => {
      const data = makeMessageEvent({
        messageId: 'msg_reply_2',
        rootId: 'msg_root_2',
        chatType: 'group',
        content: JSON.stringify({ text: '@_user_1\n/attach 1' }),
        mentions: [
          { key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'Bot', tenant_key: 'tk' },
        ],
      });
      const event = adapter.toChannelEvent(data);
      expect(event).not.toBeNull();
      expect(event!.content).toEqual({ type: 'text', text: '/attach 1' });
    });

  describe('handleMessageEvent', () => {
    it('calls handler with parsed ChannelEvent', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const data = makeMessageEvent({ messageId: 'msg_100' });
      await adapter.handleMessageEvent(data, handler);
      expect(handler).toHaveBeenCalledTimes(1);
      const event: ChannelEvent = handler.mock.calls[0]![0];
      expect(event.channelId).toBe('feishu');
    });

    it('deduplicates messages with the same ID', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const data = makeMessageEvent({ messageId: 'msg_dup' });

      await adapter.handleMessageEvent(data, handler);
      await adapter.handleMessageEvent(data, handler);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('skips stale messages', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const oldTime = String(Date.now() - 3 * 60 * 1000); // 3 minutes ago
      const data = makeMessageEvent({
        messageId: 'msg_stale',
        createTime: oldTime,
      });

      await adapter.handleMessageEvent(data, handler);
      expect(handler).not.toHaveBeenCalled();
    });

    it('processes fresh messages within maxAge', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const freshTime = String(Date.now() - 30_000); // 30 seconds ago
      const data = makeMessageEvent({
        messageId: 'msg_fresh',
        createTime: freshTime,
      });

      await adapter.handleMessageEvent(data, handler);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('skips unsupported message types without calling handler', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const data = makeMessageEvent({
        messageType: 'video',
        content: '{}',
      });

      await adapter.handleMessageEvent(data, handler);
      expect(handler).not.toHaveBeenCalled();
    });

    it('respects dedup max size (evicts oldest)', async () => {
      const adapterSmall = new FeishuAdapter({
        config: { ...config, dedupMax: 3 },
        larkClient: mockClient,
      });
      const handler = vi.fn().mockResolvedValue(undefined);

      // Add 4 unique messages (max=3, so first should be evicted)
      for (let i = 0; i < 4; i++) {
        await adapterSmall.handleMessageEvent(
          makeMessageEvent({ messageId: `msg_${i}` }),
          handler,
        );
      }

      expect(handler).toHaveBeenCalledTimes(4);

      // msg_0 should have been evicted, so sending it again should work
      handler.mockClear();
      await adapterSmall.handleMessageEvent(
        makeMessageEvent({ messageId: 'msg_0' }),
        handler,
      );
      expect(handler).toHaveBeenCalledTimes(1);

      // After re-adding msg_0, the set is {msg_2, msg_3, msg_0} (msg_1 evicted).
      // msg_2 should still be in dedup.
      handler.mockClear();
      await adapterSmall.handleMessageEvent(
        makeMessageEvent({ messageId: 'msg_2' }),
        handler,
      );
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('start / stop', () => {
    it('starts with WSClient and EventDispatcher factories', async () => {
      const mockWsClient: LarkWSClient = {
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };

      const adapterWithFactories = new FeishuAdapter({
        config,
        larkClient: mockClient,
        wsClientFactory: () => mockWsClient,
        eventDispatcherFactory: (handlers) => handlers,
      });

      const handler = vi.fn();
      await adapterWithFactories.start(handler);
      expect(mockWsClient.start).toHaveBeenCalled();
    });

    it('stop closes the WS client', async () => {
      const mockWsClient: LarkWSClient = {
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };

      const adapterWithFactories = new FeishuAdapter({
        config,
        larkClient: mockClient,
        wsClientFactory: () => mockWsClient,
        eventDispatcherFactory: (handlers) => handlers,
      });

      const handler = vi.fn();
      await adapterWithFactories.start(handler);
      await adapterWithFactories.stop();
      expect(mockWsClient.close).toHaveBeenCalled();
    });

    it('stop is safe to call when not started', async () => {
      await expect(adapter.stop()).resolves.toBeUndefined();
    });

    it('start without factories logs warning and returns', async () => {
      const handler = vi.fn();
      await expect(adapter.start(handler)).resolves.toBeUndefined();
    });
  });

  describe('card action handling', () => {
    function makeCardActionEvent(overrides?: Partial<FeishuCardActionEvent>): FeishuCardActionEvent {
      return {
        operator: { open_id: overrides?.operator?.open_id ?? 'ou_actor1' },
        action: overrides?.action ?? { value: { action: 'approve', requestId: 'r1' }, tag: 'button' },
        token: overrides?.token ?? 'tok_123',
        open_message_id: overrides?.open_message_id ?? 'om_msg_001',
        open_chat_id: overrides?.open_chat_id ?? 'oc_chat_001',
      };
    }

    it('registers card.action.trigger in EventDispatcher', async () => {
      let capturedHandlers: Record<string, (data: unknown) => Promise<unknown>> = {};
      const onCardAction = vi.fn().mockResolvedValue(undefined);

      const adapterWithCard = new FeishuAdapter({
        config,
        larkClient: mockClient,
        wsClientFactory: () => ({
          start: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
        }),
        eventDispatcherFactory: (handlers) => {
          capturedHandlers = handlers;
          return handlers;
        },
        onCardAction,
      });

      await adapterWithCard.start(vi.fn());
      expect(capturedHandlers).toHaveProperty('card.action.trigger');
    });

    it('converts FeishuCardActionEvent to CardActionEvent and calls onCardAction', async () => {
      let capturedHandlers: Record<string, (data: unknown) => Promise<unknown>> = {};
      const onCardAction = vi.fn().mockResolvedValue(undefined);

      const adapterWithCard = new FeishuAdapter({
        config,
        larkClient: mockClient,
        wsClientFactory: () => ({
          start: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
        }),
        eventDispatcherFactory: (handlers) => {
          capturedHandlers = handlers;
          return handlers;
        },
        onCardAction,
      });

      await adapterWithCard.start(vi.fn());

      const feishuEvent = makeCardActionEvent();
      await capturedHandlers['card.action.trigger']!(feishuEvent);

      expect(onCardAction).toHaveBeenCalledTimes(1);
      expect(onCardAction).toHaveBeenCalledWith({
        messageId: 'om_msg_001',
        chatId: 'oc_chat_001',
        userId: 'ou_actor1',
        value: { action: 'approve', requestId: 'r1' },
      } satisfies CardActionEvent);
    });

    it('parses JSON string card values into objects before forwarding', async () => {
      let capturedHandlers: Record<string, (data: unknown) => Promise<unknown>> = {};
      const onCardAction = vi.fn().mockResolvedValue(undefined);

      const adapterWithCard = new FeishuAdapter({
        config,
        larkClient: mockClient,
        wsClientFactory: () => ({
          start: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
        }),
        eventDispatcherFactory: (handlers) => {
          capturedHandlers = handlers;
          return handlers;
        },
        onCardAction,
      });

      await adapterWithCard.start(vi.fn());

      const feishuEvent = makeCardActionEvent({
        action: { value: JSON.stringify({ action: 'focus', runtimeId: 'runtime-1' }), tag: 'button' },
      });
      await capturedHandlers['card.action.trigger']!(feishuEvent);

      expect(onCardAction).toHaveBeenCalledWith({
        messageId: 'om_msg_001',
        chatId: 'oc_chat_001',
        userId: 'ou_actor1',
        value: { action: 'focus', runtimeId: 'runtime-1' },
      } satisfies CardActionEvent);
    });

    it('ignores card action with missing fields', async () => {
      let capturedHandlers: Record<string, (data: unknown) => Promise<unknown>> = {};
      const onCardAction = vi.fn().mockResolvedValue(undefined);

      const adapterWithCard = new FeishuAdapter({
        config,
        larkClient: mockClient,
        wsClientFactory: () => ({
          start: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
        }),
        eventDispatcherFactory: (handlers) => {
          capturedHandlers = handlers;
          return handlers;
        },
        onCardAction,
      });

      await adapterWithCard.start(vi.fn());

      // Missing open_chat_id
      const incompleteEvent = makeCardActionEvent();
      delete (incompleteEvent as Record<string, unknown>).open_chat_id;
      await capturedHandlers['card.action.trigger']!(incompleteEvent);

      expect(onCardAction).not.toHaveBeenCalled();
    });

    it('does not register card.action.trigger when onCardAction is not provided', async () => {
      let capturedHandlers: Record<string, (data: unknown) => Promise<unknown>> = {};

      const adapterNoCard = new FeishuAdapter({
        config,
        larkClient: mockClient,
        wsClientFactory: () => ({
          start: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
        }),
        eventDispatcherFactory: (handlers) => {
          capturedHandlers = handlers;
          return handlers;
        },
      });

      await adapterNoCard.start(vi.fn());
      expect(capturedHandlers).not.toHaveProperty('card.action.trigger');
    });

    it('toCardActionEvent returns null when value is not an object', () => {
      const event: FeishuCardActionEvent = {
        operator: { open_id: 'ou_1' },
        action: { value: 'string_value' },
        open_message_id: 'om_1',
        open_chat_id: 'oc_1',
      };
      const result = adapter.toCardActionEvent(event);
      expect(result).toBeNull();
    });
  });
});
