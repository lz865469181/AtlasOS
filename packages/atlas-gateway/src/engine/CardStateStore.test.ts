import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardStateStoreImpl, type CardState } from './CardStateStore.js';

describe('CardStateStore', () => {
  let store: CardStateStoreImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new CardStateStoreImpl({
      maxRenderRateMs: 500,
      coalesceWindowMs: 100,
      maxPendingUpdates: 50,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create a card state', () => {
    const card = store.create('chat1', 'tool', { sections: [] });
    expect(card.cardId).toBeDefined();
    expect(card.chatId).toBe('chat1');
    expect(card.type).toBe('tool');
    expect(card.status).toBe('active');
    expect(card.version).toBe(0);
    expect(card.messageId).toBeNull();
  });

  it('should get card by id', () => {
    const card = store.create('chat1', 'streaming', { sections: [] });
    const retrieved = store.get(card.cardId);
    expect(retrieved).toBe(card);
  });

  it('should get active cards by chatId', () => {
    store.create('chat1', 'tool', { sections: [] });
    store.create('chat1', 'streaming', { sections: [] });
    store.create('chat2', 'tool', { sections: [] });
    expect(store.getActiveByChatId('chat1')).toHaveLength(2);
    expect(store.getActiveByChatId('chat2')).toHaveLength(1);
  });

  it('should update card and increment version', () => {
    const card = store.create('chat1', 'tool', { sections: [] });
    const updated = store.update(card.cardId, (state) => {
      state.content = { sections: [{ type: 'markdown' as const, content: 'hello' }] };
    });
    expect(updated.version).toBe(1);
    expect(updated.content.sections).toHaveLength(1);
  });

  it('should transition card status', () => {
    const card = store.create('chat1', 'tool', { sections: [] });
    const transitioned = store.transition(card.cardId, 'completed');
    expect(transitioned.status).toBe('completed');
  });

  it('should set messageId', () => {
    const card = store.create('chat1', 'tool', { sections: [] });
    store.setMessageId(card.cardId, 'msg_123');
    expect(store.get(card.cardId)?.messageId).toBe('msg_123');
  });

  it('should get by messageId', () => {
    const card = store.create('chat1', 'tool', { sections: [] });
    store.setMessageId(card.cardId, 'msg_123');
    expect(store.getByMessageId('msg_123')?.cardId).toBe(card.cardId);
  });

  it('should dispose card', () => {
    const card = store.create('chat1', 'tool', { sections: [] });
    store.dispose(card.cardId);
    expect(store.get(card.cardId)).toBeUndefined();
  });

  it('should coalesce rapid updates into single onChange', () => {
    const handler = vi.fn();
    store.onChange(handler);

    const card = store.create('chat1', 'tool', { sections: [] });
    // Rapid updates within coalesce window
    store.update(card.cardId, (s) => { s.metadata.a = 1; });
    store.update(card.cardId, (s) => { s.metadata.b = 2; });
    store.update(card.cardId, (s) => { s.metadata.c = 3; });

    // Before coalesce fires, no onChange yet
    expect(handler).not.toHaveBeenCalled();

    // Advance past coalesce window + rate limit
    vi.advanceTimersByTime(600);

    // Should fire exactly once with latest state
    expect(handler).toHaveBeenCalledTimes(1);
    const [cardId, state] = handler.mock.calls[0];
    expect(cardId).toBe(card.cardId);
    expect(state.version).toBe(3);
    expect(state.metadata.c).toBe(3);
  });

  it('should rate-limit onChange per card', () => {
    const handler = vi.fn();
    store.onChange(handler);
    const card = store.create('chat1', 'tool', { sections: [] });

    // First update
    store.update(card.cardId, (s) => { s.metadata.x = 1; });
    vi.advanceTimersByTime(600);
    expect(handler).toHaveBeenCalledTimes(1);

    // Second update immediately after
    store.update(card.cardId, (s) => { s.metadata.x = 2; });
    vi.advanceTimersByTime(100);
    // Should not fire yet (rate limited)
    expect(handler).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    // Now it should fire
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should unsubscribe onChange', () => {
    const handler = vi.fn();
    const unsub = store.onChange(handler);
    const card = store.create('chat1', 'tool', { sections: [] });

    unsub();
    store.update(card.cardId, (s) => { s.metadata.x = 1; });
    vi.advanceTimersByTime(600);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should throw on update of nonexistent card', () => {
    expect(() => store.update('nonexistent', () => {})).toThrow('Card not found');
  });

  it('should snapshot and restore', () => {
    const card = store.create('chat1', 'tool', { sections: [] });
    store.setMessageId(card.cardId, 'msg_abc');
    store.update(card.cardId, (s) => { s.metadata.key = 'val'; });
    vi.advanceTimersByTime(600);

    const snapshot = store.snapshot();
    const store2 = new CardStateStoreImpl();
    store2.restore(snapshot);

    const restored = store2.get(card.cardId);
    expect(restored?.messageId).toBe('msg_abc');
    expect(restored?.metadata.key).toBe('val');
    expect(restored?.version).toBe(1);
  });
});
