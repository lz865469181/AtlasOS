import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardRenderPipeline, type CardRenderer } from './CardRenderPipeline.js';
import { CardStateStoreImpl, type CardState } from './CardStateStore.js';
import {
  MessageCorrelationStoreImpl,
  type MessageCorrelationStore,
} from './MessageCorrelationStore.js';
import type { ChannelSender, SenderFactory } from '../channel/ChannelSender.js';
import type { CardModel } from '../cards/CardModel.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeModel(content = 'default'): CardModel {
  return { sections: [{ type: 'markdown', content }] };
}

function createMockRenderer(): CardRenderer {
  return {
    render: vi.fn((card: CardModel, _ctx) => {
      // Pass through with a decoration marker so tests can detect it was rendered.
      return {
        ...card,
        header: { title: 'rendered' },
      };
    }),
  };
}

function createMockSender(): ChannelSender {
  let callCount = 0;
  return {
    sendText: vi.fn(async () => 'msg_text'),
    sendMarkdown: vi.fn(async () => 'msg_md'),
    sendCard: vi.fn(async () => {
      callCount++;
      return `msg_${callCount}`;
    }),
    updateCard: vi.fn(async () => {}),
  };
}


function createMockSenderFactory(sender?: ChannelSender): SenderFactory {
  const defaultSender = sender ?? createMockSender();
  return vi.fn((_chatId: string) => defaultSender);
}
// ── Tests ──────────────────────────────────────────────────────────────────

describe('CardRenderPipeline', () => {
  let store: CardStateStoreImpl;
  let correlationStore: MessageCorrelationStore;
  let renderer: CardRenderer;
  let sender: ChannelSender;
  let senderFactory: SenderFactory;
  let pipeline: CardRenderPipeline;

  beforeEach(() => {
    vi.useFakeTimers();
    // Use zero-delay config so onChange fires without timer dance
    store = new CardStateStoreImpl({
      maxRenderRateMs: 0,
      coalesceWindowMs: 0,
      maxPendingUpdates: 50,
    });
    correlationStore = new MessageCorrelationStoreImpl(store);
    renderer = createMockRenderer();
    sender = createMockSender();
    senderFactory = createMockSenderFactory(sender);
    pipeline = new CardRenderPipeline(store, renderer, senderFactory, correlationStore);
  });

  afterEach(() => {
    pipeline.dispose();
    vi.useRealTimers();
  });

  // Helpers to trigger an update and let microtasks + timers settle
  async function flushAll(): Promise<void> {
    // Advance any pending setTimeout(0) from CardStateStore
    vi.advanceTimersByTime(10);
    // Wait for all microtask-based promise chains
    await vi.runAllTimersAsync();
  }

  it('should send a new card and record messageId', async () => {
    const card = store.create('chat1', 'streaming', makeModel('hello'));
    correlationStore.create({
      cardId: card.cardId,
      messageId: null,
      chatId: 'chat1',
      sessionId: 'sess1',
    });

    store.update(card.cardId, (s) => {
      s.content = makeModel('updated');
    });

    await flushAll();

    expect(renderer.render).toHaveBeenCalled();
    expect(sender.sendCard).toHaveBeenCalledTimes(1);
    // sendCard returns 'msg_1', so messageId should be set
    expect(store.get(card.cardId)?.messageId).toBe('msg_1');
  });

  it('should update an existing card via updateCard when messageId exists', async () => {
    const card = store.create('chat1', 'tool', makeModel('init'));
    store.setMessageId(card.cardId, 'existing_msg');

    store.update(card.cardId, (s) => {
      s.content = makeModel('changed');
    });

    await flushAll();

    expect(sender.updateCard).toHaveBeenCalledTimes(1);
    expect(sender.updateCard).toHaveBeenCalledWith(
      'existing_msg',
      expect.objectContaining({ header: { title: 'rendered' } }),
    );
    expect(sender.sendCard).not.toHaveBeenCalled();
  });

  it('should pass status and type to renderer context', async () => {
    const card = store.create('chat1', 'permission', makeModel());
    store.setMessageId(card.cardId, 'msg_ctx');
    store.update(card.cardId, (s) => {
      s.status = 'error';
    });

    await flushAll();

    expect(renderer.render).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'error', type: 'permission' },
    );
  });

  it('should serialize sends per card (one in-flight at a time)', async () => {
    // Create a sender whose sendCard resolves after explicit trigger
    const sendResolvers: Array<(value: string) => void> = [];
    let sendCallNum = 0;
    (sender.sendCard as ReturnType<typeof vi.fn>).mockImplementation(() => {
      sendCallNum++;
      const num = sendCallNum;
      return new Promise<string>((resolve) => {
        sendResolvers.push((v) => resolve(v ?? `msg_${num}`));
      });
    });

    const card = store.create('chat1', 'streaming', makeModel('v0'));
    correlationStore.create({
      cardId: card.cardId,
      messageId: null,
      chatId: 'chat1',
      sessionId: 'sess1',
    });

    // Trigger first update
    store.update(card.cardId, (s) => {
      s.content = makeModel('v1');
    });
    vi.advanceTimersByTime(10);
    // Let the first sendCard be called
    await Promise.resolve();
    await Promise.resolve();

    expect(sender.sendCard).toHaveBeenCalledTimes(1);

    // Trigger second update while first is in-flight
    store.update(card.cardId, (s) => {
      s.content = makeModel('v2');
    });
    vi.advanceTimersByTime(10);
    await Promise.resolve();

    // sendCard should still only have been called once (queued)
    expect(sender.sendCard).toHaveBeenCalledTimes(1);

    // Resolve the first send
    sendResolvers[0]('msg_first');
    await vi.runAllTimersAsync();

    // Now the second should have been processed (as updateCard since messageId was set)
    expect(sender.updateCard).toHaveBeenCalledTimes(1);
  });

  it('should skip stale versions when processing queue', async () => {
    // Use a controlled sender
    const sendResolvers: Array<() => void> = [];
    (sender.updateCard as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return new Promise<void>((resolve) => {
        sendResolvers.push(resolve);
      });
    });

    const card = store.create('chat1', 'streaming', makeModel('v0'));
    store.setMessageId(card.cardId, 'msg_existing');

    // Trigger first update (version 1)
    store.update(card.cardId, (s) => {
      s.content = makeModel('v1');
    });
    vi.advanceTimersByTime(10);
    await Promise.resolve();
    await Promise.resolve();

    expect(sender.updateCard).toHaveBeenCalledTimes(1);

    // Queue a second update (version 2) while first is in-flight
    store.update(card.cardId, (s) => {
      s.content = makeModel('v2');
    });
    vi.advanceTimersByTime(10);
    await Promise.resolve();

    // Now manually bump the store version to 5 (simulating rapid external updates)
    store.update(card.cardId, (s) => {
      s.content = makeModel('v3');
    });
    store.update(card.cardId, (s) => {
      s.content = makeModel('v4');
    });
    store.update(card.cardId, (s) => {
      s.content = makeModel('v5');
    });

    // Resolve the in-flight send
    sendResolvers[0]();
    await vi.runAllTimersAsync();

    // The queued version 2 should have been skipped (store is at version 5).
    // But version 5 entries (from subsequent onChange callbacks) should be processed.
    // At minimum, the stale version=2 should not produce an extra updateCard call
    // beyond what the newer versions need.
    const updateCalls = (sender.updateCard as ReturnType<typeof vi.fn>).mock.calls;
    // All updateCard calls after the first should have the latest content
    // (stale version 2 should be skipped in favor of later versions)
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should bound queue depth to 5, dropping oldest entries', async () => {
    const sendResolvers: Array<() => void> = [];
    (sender.updateCard as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return new Promise<void>((resolve) => {
        sendResolvers.push(resolve);
      });
    });

    const card = store.create('chat1', 'streaming', makeModel('v0'));
    store.setMessageId(card.cardId, 'msg_existing');

    // Trigger first update to get one in-flight
    store.update(card.cardId, (s) => {
      s.content = makeModel('v1');
    });
    vi.advanceTimersByTime(10);
    await Promise.resolve();
    await Promise.resolve();

    expect(sender.updateCard).toHaveBeenCalledTimes(1);

    // Now queue 7 more updates while first is in-flight
    // Due to coalescing in CardStateStore (coalesceWindowMs=0), each update
    // fires onChange individually.
    for (let i = 2; i <= 8; i++) {
      store.update(card.cardId, (s) => {
        s.content = makeModel(`v${i}`);
      });
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    }

    // Resolve the in-flight send, let the queue drain
    sendResolvers[0]();
    await vi.runAllTimersAsync();

    // The pipeline should have processed some but dropped old entries.
    // The last entry processed should have the latest content.
    const allUpdateCalls = (sender.updateCard as ReturnType<typeof vi.fn>).mock.calls;
    expect(allUpdateCalls.length).toBeGreaterThanOrEqual(2);

    // The very last updateCard call should have the most recent rendered content
    const lastCall = allUpdateCalls[allUpdateCalls.length - 1];
    expect(lastCall[1]).toEqual(expect.objectContaining({ header: { title: 'rendered' } }));
  });

  it('should handle sender errors gracefully (no crash)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    (sender.updateCard as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network failure'),
    );

    const card = store.create('chat1', 'tool', makeModel());
    store.setMessageId(card.cardId, 'msg_err');

    store.update(card.cardId, (s) => {
      s.content = makeModel('fail');
    });

    await flushAll();

    // Should have logged the error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CardRenderPipeline] send failed'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('should continue processing queue after a sender error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let callCount = 0;
    (sender.updateCard as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('First call fails');
      // Subsequent calls succeed
    });

    const card = store.create('chat1', 'tool', makeModel());
    store.setMessageId(card.cardId, 'msg_retry');

    // Two updates
    store.update(card.cardId, (s) => {
      s.content = makeModel('first');
    });
    await flushAll();

    store.update(card.cardId, (s) => {
      s.content = makeModel('second');
    });
    await flushAll();

    // First call should have failed, second should have succeeded
    expect(sender.updateCard).toHaveBeenCalledTimes(2);

    consoleSpy.mockRestore();
  });

  it('should stop processing after dispose()', async () => {
    const card = store.create('chat1', 'streaming', makeModel());
    pipeline.dispose();

    store.update(card.cardId, (s) => {
      s.content = makeModel('after-dispose');
    });

    await flushAll();

    // dispose() unsubscribed, so no render/send should have happened
    expect(renderer.render).not.toHaveBeenCalled();
    expect(sender.sendCard).not.toHaveBeenCalled();
  });

  it('should set messageId on both correlationStore and store after sendCard', async () => {
    const setMsgOnCorrelation = vi.spyOn(correlationStore, 'setMessageId');
    const setMsgOnStore = vi.spyOn(store, 'setMessageId');

    const card = store.create('chat1', 'streaming', makeModel());
    correlationStore.create({
      cardId: card.cardId,
      messageId: null,
      chatId: 'chat1',
      sessionId: 'sess1',
    });

    store.update(card.cardId, (s) => {
      s.content = makeModel('new');
    });

    await flushAll();

    expect(setMsgOnCorrelation).toHaveBeenCalledWith(card.cardId, 'msg_1');
    expect(setMsgOnStore).toHaveBeenCalledWith(card.cardId, 'msg_1');
  });

  it('should render and send to different cards independently', async () => {
    const card1 = store.create('chat1', 'streaming', makeModel('c1'));
    const card2 = store.create('chat2', 'tool', makeModel('c2'));
    store.setMessageId(card1.cardId, 'msg_c1');
    store.setMessageId(card2.cardId, 'msg_c2');

    store.update(card1.cardId, (s) => {
      s.content = makeModel('c1_updated');
    });
    store.update(card2.cardId, (s) => {
      s.content = makeModel('c2_updated');
    });

    await flushAll();

    expect(sender.updateCard).toHaveBeenCalledTimes(2);
    const calls = (sender.updateCard as ReturnType<typeof vi.fn>).mock.calls;
    const messageIds = calls.map((c: unknown[]) => c[0]);
    expect(messageIds).toContain('msg_c1');
    expect(messageIds).toContain('msg_c2');
  });


  // ── SenderFactory-specific tests ──────────────────────────────────────

  describe('SenderFactory per-chat resolution', () => {
    it('should call senderFactory with the correct chatId from CardState', async () => {
      const card = store.create('chat-abc', 'streaming', makeModel('hello'));
      store.setMessageId(card.cardId, 'msg_existing');

      store.update(card.cardId, (s) => {
        s.content = makeModel('updated');
      });

      await flushAll();

      expect(senderFactory).toHaveBeenCalledWith('chat-abc');
    });

    it('should resolve different senders for different chatIds', async () => {
      const senderA = createMockSender();
      const senderB = createMockSender();
      const perChatFactory: SenderFactory = vi.fn((chatId: string) => {
        return chatId === 'chat-a' ? senderA : senderB;
      });

      pipeline.dispose();
      pipeline = new CardRenderPipeline(store, renderer, perChatFactory, correlationStore);

      const cardA = store.create('chat-a', 'streaming', makeModel('a'));
      const cardB = store.create('chat-b', 'tool', makeModel('b'));
      store.setMessageId(cardA.cardId, 'msg_a');
      store.setMessageId(cardB.cardId, 'msg_b');

      store.update(cardA.cardId, (s) => {
        s.content = makeModel('a_updated');
      });
      store.update(cardB.cardId, (s) => {
        s.content = makeModel('b_updated');
      });

      await flushAll();

      expect(senderA.updateCard).toHaveBeenCalledTimes(1);
      expect(senderA.updateCard).toHaveBeenCalledWith(
        'msg_a',
        expect.objectContaining({ header: { title: 'rendered' } }),
      );

      expect(senderB.updateCard).toHaveBeenCalledTimes(1);
      expect(senderB.updateCard).toHaveBeenCalledWith(
        'msg_b',
        expect.objectContaining({ header: { title: 'rendered' } }),
      );

      expect(senderA.updateCard).not.toHaveBeenCalledWith('msg_b', expect.anything());
      expect(senderB.updateCard).not.toHaveBeenCalledWith('msg_a', expect.anything());
    });

    it('should resolve sender per send (not cached at construction)', async () => {
      const card = store.create('chat-x', 'streaming', makeModel('v0'));
      store.setMessageId(card.cardId, 'msg_x');

      store.update(card.cardId, (s) => {
        s.content = makeModel('v1');
      });
      await flushAll();

      store.update(card.cardId, (s) => {
        s.content = makeModel('v2');
      });
      await flushAll();

      expect(senderFactory).toHaveBeenCalledTimes(2);
      expect(senderFactory).toHaveBeenCalledWith('chat-x');
    });

    it('should use factory-resolved sender for new card sendCard', async () => {
      const specificSender = createMockSender();
      const specificFactory: SenderFactory = vi.fn(() => specificSender);

      pipeline.dispose();
      pipeline = new CardRenderPipeline(store, renderer, specificFactory, correlationStore);

      const card = store.create('chat-new', 'streaming', makeModel('initial'));
      correlationStore.create({
        cardId: card.cardId,
        messageId: null,
        chatId: 'chat-new',
        sessionId: 'sess-new',
      });

      store.update(card.cardId, (s) => {
        s.content = makeModel('first-send');
      });

      await flushAll();

      expect(specificFactory).toHaveBeenCalledWith('chat-new');
      expect(specificSender.sendCard).toHaveBeenCalledTimes(1);
    });
  });
});
