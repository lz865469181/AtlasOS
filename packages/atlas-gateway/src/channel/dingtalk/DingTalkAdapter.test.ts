import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DingTalkAdapter,
  DingTalkChannelSender,
  parseDingTalkContent,
  stripDingTalkMentions,
} from './DingTalkAdapter.js';
import type { DingTalkMessageEvent, DingTalkCardActionEvent } from './types.js';
import type { DingTalkClient } from './DingTalkClient.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockClient(): DingTalkClient {
  return {
    getAccessToken: vi.fn<[], Promise<string>>().mockResolvedValue('mock-token'),
    sendText: vi.fn<[string, string], Promise<string>>().mockResolvedValue('msg-001'),
    sendMarkdown: vi.fn<[string, string, string], Promise<string>>().mockResolvedValue('msg-002'),
    sendActionCard: vi.fn().mockResolvedValue('msg-003'),
    updateCard: vi.fn().mockResolvedValue(undefined),
    sendViaWebhook: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMessageEvent(overrides: Partial<DingTalkMessageEvent> = {}): DingTalkMessageEvent {
  return {
    msgtype: 'text',
    text: { content: 'Hello bot' },
    senderStaffId: 'user-123',
    senderNick: 'Alice',
    conversationId: 'conv-456',
    conversationType: '1',
    sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession/xxx',
    sessionWebhookExpiredTime: Date.now() + 3600_000,
    msgId: 'msg-abc',
    createAt: Date.now(),
    ...overrides,
  };
}

function makeAdapter(clientOverride?: DingTalkClient) {
  const client = clientOverride ?? makeMockClient();
  const adapter = new DingTalkAdapter({
    config: { appKey: 'key', appSecret: 'secret', mode: 'webhook' },
    client,
  });
  return { adapter, client };
}

// ── parseDingTalkContent ─────────────────────────────────────────────────────

describe('parseDingTalkContent', () => {
  it('returns text and contentType for a text message', () => {
    const event = makeMessageEvent({ msgtype: 'text', text: { content: 'hi' } });
    const result = parseDingTalkContent(event);
    expect(result).toEqual({ text: 'hi', contentType: 'text' });
  });

  it('returns null for non-text msgtype', () => {
    const event = makeMessageEvent({ msgtype: 'image', text: undefined });
    expect(parseDingTalkContent(event)).toBeNull();
  });

  it('returns null when text.content is missing', () => {
    const event = makeMessageEvent({ msgtype: 'text', text: undefined });
    expect(parseDingTalkContent(event)).toBeNull();
  });

  it('returns null when text.content is empty string', () => {
    const event = makeMessageEvent({ msgtype: 'text', text: { content: '' } });
    expect(parseDingTalkContent(event)).toBeNull();
  });
});

// ── stripDingTalkMentions ────────────────────────────────────────────────────

describe('stripDingTalkMentions', () => {
  it('strips @mention from the beginning', () => {
    expect(stripDingTalkMentions('@bot hello')).toBe('hello');
  });

  it('strips @mention from the end', () => {
    expect(stripDingTalkMentions('hello @bot')).toBe('hello');
  });

  it('strips multiple @mentions', () => {
    expect(stripDingTalkMentions('@bot @admin please help')).toBe('please help');
  });

  it('trims resulting whitespace', () => {
    expect(stripDingTalkMentions('  @bot  ')).toBe('');
  });

  it('returns original text when no @mentions', () => {
    expect(stripDingTalkMentions('no mentions here')).toBe('no mentions here');
  });
});

// ── toChannelEvent ───────────────────────────────────────────────────────────

describe('DingTalkAdapter.toChannelEvent', () => {
  let adapter: DingTalkAdapter;

  beforeEach(() => {
    ({ adapter } = makeAdapter());
  });

  it('converts P2P text message to a valid ChannelEvent', () => {
    const event = makeMessageEvent({
      conversationType: '1',
      text: { content: 'Hello' },
    });

    // toChannelEvent is public on the class
    const result = (adapter as any).toChannelEvent(event);
    expect(result).toEqual({
      channelId: 'dingtalk',
      chatId: 'conv-456',
      userId: 'user-123',
      userName: 'Alice',
      messageId: 'msg-abc',
      content: { type: 'text', text: 'Hello' },
      timestamp: expect.any(Number),
    });
  });

  it('strips @mentions in group messages', () => {
    const event = makeMessageEvent({
      conversationType: '2',
      text: { content: '@bot what time is it' },
    });
    const result = (adapter as any).toChannelEvent(event);
    expect(result!.content.text).toBe('what time is it');
  });

  it('returns null when text is empty after stripping mentions', () => {
    const event = makeMessageEvent({
      conversationType: '2',
      text: { content: '@bot' },
    });
    const result = (adapter as any).toChannelEvent(event);
    expect(result).toBeNull();
  });

  it('returns null for non-text message', () => {
    const event = makeMessageEvent({ msgtype: 'image', text: undefined });
    const result = (adapter as any).toChannelEvent(event);
    expect(result).toBeNull();
  });
});

// ── handleMessageEvent ───────────────────────────────────────────────────────

describe('DingTalkAdapter.handleMessageEvent', () => {
  let adapter: DingTalkAdapter;
  let client: DingTalkClient;
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ adapter, client } = makeAdapter());
    handler = vi.fn().mockResolvedValue(undefined);
  });

  it('calls handler with correct ChannelEvent', async () => {
    const event = makeMessageEvent();
    await adapter.handleMessageEvent(event, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    const channelEvent = handler.mock.calls[0][0];
    expect(channelEvent.channelId).toBe('dingtalk');
    expect(channelEvent.chatId).toBe('conv-456');
    expect(channelEvent.userId).toBe('user-123');
    expect(channelEvent.content.text).toBe('Hello bot');
  });

  it('deduplicates: second identical msgId is skipped', async () => {
    const event = makeMessageEvent({ msgId: 'dup-1' });
    await adapter.handleMessageEvent(event, handler);
    await adapter.handleMessageEvent(event, handler);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('skips stale messages', async () => {
    const event = makeMessageEvent({
      createAt: Date.now() - 300_000, // 5 min old, default maxAge is 2 min
    });
    await adapter.handleMessageEvent(event, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('caches session webhook', async () => {
    const webhookUrl = 'https://oapi.dingtalk.com/robot/sendBySession/cached';
    const expiresAt = Date.now() + 7200_000;
    const event = makeMessageEvent({
      sessionWebhook: webhookUrl,
      sessionWebhookExpiredTime: expiresAt,
    });
    await adapter.handleMessageEvent(event, handler);

    // Verify webhook is cached by getting a sender and checking it uses webhook
    const sender = adapter.getSender('conv-456') as DingTalkChannelSender;
    await sender.sendText('test');
    expect(client.sendViaWebhook).toHaveBeenCalledWith(webhookUrl, {
      msgtype: 'text',
      text: { content: 'test' },
    });
  });
});

// ── toCardActionEvent ────────────────────────────────────────────────────────

describe('DingTalkAdapter.toCardActionEvent', () => {
  let adapter: DingTalkAdapter;

  beforeEach(() => {
    ({ adapter } = makeAdapter());
  });

  it('converts valid card action event', () => {
    const data: DingTalkCardActionEvent = {
      msgId: 'card-msg-1',
      conversationId: 'conv-789',
      senderStaffId: 'user-42',
      value: { action: 'approve' },
    };
    const result = (adapter as any).toCardActionEvent(data);
    expect(result).toEqual({
      messageId: 'card-msg-1',
      chatId: 'conv-789',
      userId: 'user-42',
      value: { action: 'approve' },
    });
  });

  it('parses JSON string card action values into objects', () => {
    const data: DingTalkCardActionEvent = {
      msgId: 'card-msg-1',
      conversationId: 'conv-789',
      senderStaffId: 'user-42',
      value: JSON.stringify({ action: 'focus', runtimeId: 'runtime-1' }) as unknown as Record<string, unknown>,
    };
    const result = (adapter as any).toCardActionEvent(data);
    expect(result).toEqual({
      messageId: 'card-msg-1',
      chatId: 'conv-789',
      userId: 'user-42',
      value: { action: 'focus', runtimeId: 'runtime-1' },
    });
  });

  it('returns null when msgId is missing', () => {
    const data: DingTalkCardActionEvent = {
      conversationId: 'conv-789',
      senderStaffId: 'user-42',
      value: { action: 'approve' },
    };
    expect((adapter as any).toCardActionEvent(data)).toBeNull();
  });

  it('returns null when conversationId is missing', () => {
    const data: DingTalkCardActionEvent = {
      msgId: 'card-msg-1',
      senderStaffId: 'user-42',
      value: { action: 'approve' },
    };
    expect((adapter as any).toCardActionEvent(data)).toBeNull();
  });

  it('returns null when senderStaffId is missing', () => {
    const data: DingTalkCardActionEvent = {
      msgId: 'card-msg-1',
      conversationId: 'conv-789',
      value: { action: 'approve' },
    };
    expect((adapter as any).toCardActionEvent(data)).toBeNull();
  });

  it('returns null when value is missing', () => {
    const data: DingTalkCardActionEvent = {
      msgId: 'card-msg-1',
      conversationId: 'conv-789',
      senderStaffId: 'user-42',
    };
    expect((adapter as any).toCardActionEvent(data)).toBeNull();
  });
});

// ── DingTalkChannelSender ────────────────────────────────────────────────────

describe('DingTalkChannelSender', () => {
  let client: DingTalkClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('sendText uses session webhook when available and not expired', async () => {
    const webhook = { url: 'https://hook.example.com', expiresAt: Date.now() + 60_000 };
    const sender = new DingTalkChannelSender(client, 'conv-1', undefined, webhook);

    await sender.sendText('hi');

    expect(client.sendViaWebhook).toHaveBeenCalledWith('https://hook.example.com', {
      msgtype: 'text',
      text: { content: 'hi' },
    });
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it('sendText falls back to OpenAPI when webhook is expired', async () => {
    const webhook = { url: 'https://hook.example.com', expiresAt: Date.now() - 1000 };
    const sender = new DingTalkChannelSender(client, 'conv-1', undefined, webhook);

    await sender.sendText('hi');

    expect(client.sendViaWebhook).not.toHaveBeenCalled();
    expect(client.sendText).toHaveBeenCalledWith('conv-1', 'hi');
  });

  it('sendText falls back to OpenAPI when webhook call fails', async () => {
    const webhook = { url: 'https://hook.example.com', expiresAt: Date.now() + 60_000 };
    (client.sendViaWebhook as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    const sender = new DingTalkChannelSender(client, 'conv-1', undefined, webhook);

    await sender.sendText('hi');

    expect(client.sendViaWebhook).toHaveBeenCalled();
    expect(client.sendText).toHaveBeenCalledWith('conv-1', 'hi');
  });

  it('sendCard converts card to ActionCard and sends via webhook', async () => {
    const webhook = { url: 'https://hook.example.com', expiresAt: Date.now() + 60_000 };
    const sender = new DingTalkChannelSender(client, 'conv-1', undefined, webhook);

    const card = {
      header: { title: 'Test Card' },
      sections: [{ type: 'markdown' as const, content: 'body text' }],
    };

    await sender.sendCard(card);

    expect(client.sendViaWebhook).toHaveBeenCalledWith(
      'https://hook.example.com',
      expect.objectContaining({
        msgtype: 'actionCard',
        actionCard: expect.objectContaining({
          title: 'Test Card',
          text: expect.stringContaining('body text'),
        }),
      }),
    );
  });

  it('sendCard falls back to OpenAPI sendActionCard when no webhook', async () => {
    const sender = new DingTalkChannelSender(client, 'conv-1');

    const card = {
      header: { title: 'Test Card' },
      sections: [{ type: 'markdown' as const, content: 'body text' }],
    };

    await sender.sendCard(card);

    expect(client.sendActionCard).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        title: 'Test Card',
        text: expect.stringContaining('body text'),
      }),
    );
  });
});
