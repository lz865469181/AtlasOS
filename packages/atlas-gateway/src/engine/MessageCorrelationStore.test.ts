import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageCorrelationStoreImpl } from './MessageCorrelationStore.js';
import { CardStateStoreImpl } from './CardStateStore.js';
import type { PermissionActionPayload } from './MessageCorrelationStore.js';

describe('MessageCorrelationStore', () => {
  let cardStore: CardStateStoreImpl;
  let store: MessageCorrelationStoreImpl;

  beforeEach(() => {
    cardStore = new CardStateStoreImpl();
    store = new MessageCorrelationStoreImpl(cardStore);
  });

  // ── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates an entry with active status and timestamp', () => {
      const cardId = store.create({
        cardId: 'card-1',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-1',
      });

      expect(cardId).toBe('card-1');
      const entry = store.getByCardId('card-1');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('active');
      expect(entry!.createdAt).toBeGreaterThan(0);
      expect(entry!.chatId).toBe('chat-1');
      expect(entry!.sessionId).toBe('session-1');
    });

    it('indexes by toolCallId on create', () => {
      store.create({
        cardId: 'card-1',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-1',
      });

      const entry = store.getByToolCallId('session-1', 'tc-1');
      expect(entry).toBeDefined();
      expect(entry!.cardId).toBe('card-1');
    });

    it('indexes by permissionRequestId on create', () => {
      store.create({
        cardId: 'card-2',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        permissionRequestId: 'perm-1',
      });

      const entry = store.getByPermissionId('session-1', 'perm-1');
      expect(entry).toBeDefined();
      expect(entry!.cardId).toBe('card-2');
    });

    it('indexes by messageId if provided on create', () => {
      store.create({
        cardId: 'card-3',
        messageId: 'msg-1',
        chatId: 'chat-1',
        sessionId: 'session-1',
      });

      const entry = store.getByMessageId('msg-1');
      expect(entry).toBeDefined();
      expect(entry!.cardId).toBe('card-3');
    });
  });

  // ── getByCardId ───────────────────────────────────────────────────────

  describe('getByCardId', () => {
    it('returns undefined for nonexistent cardId', () => {
      expect(store.getByCardId('nope')).toBeUndefined();
    });
  });

  // ── getByMessageId ────────────────────────────────────────────────────

  describe('getByMessageId', () => {
    it('returns undefined when no entry has that messageId', () => {
      expect(store.getByMessageId('nope')).toBeUndefined();
    });
  });

  // ── getByToolCallId ───────────────────────────────────────────────────

  describe('getByToolCallId', () => {
    it('different sessions with same toolCallId do not collide', () => {
      store.create({
        cardId: 'card-a',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-same',
      });
      store.create({
        cardId: 'card-b',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-2',
        toolCallId: 'tc-same',
      });

      expect(store.getByToolCallId('session-1', 'tc-same')!.cardId).toBe('card-a');
      expect(store.getByToolCallId('session-2', 'tc-same')!.cardId).toBe('card-b');
    });

    it('returns undefined for unmatched session/toolCallId combo', () => {
      store.create({
        cardId: 'card-a',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-1',
      });

      expect(store.getByToolCallId('session-1', 'tc-other')).toBeUndefined();
      expect(store.getByToolCallId('other-session', 'tc-1')).toBeUndefined();
    });
  });

  // ── getByPermissionId ─────────────────────────────────────────────────

  describe('getByPermissionId', () => {
    it('different sessions with same requestId do not collide', () => {
      store.create({
        cardId: 'card-a',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        permissionRequestId: 'pr-same',
      });
      store.create({
        cardId: 'card-b',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-2',
        permissionRequestId: 'pr-same',
      });

      expect(store.getByPermissionId('session-1', 'pr-same')!.cardId).toBe('card-a');
      expect(store.getByPermissionId('session-2', 'pr-same')!.cardId).toBe('card-b');
    });
  });

  // ── setMessageId ──────────────────────────────────────────────────────

  describe('setMessageId', () => {
    it('sets messageId and makes entry findable by messageId', () => {
      store.create({
        cardId: 'card-1',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
      });

      store.setMessageId('card-1', 'msg-100');

      const entry = store.getByMessageId('msg-100');
      expect(entry).toBeDefined();
      expect(entry!.cardId).toBe('card-1');
      expect(entry!.messageId).toBe('msg-100');
    });

    it('replaces old messageId index when updating', () => {
      store.create({
        cardId: 'card-1',
        messageId: 'msg-old',
        chatId: 'chat-1',
        sessionId: 'session-1',
      });

      store.setMessageId('card-1', 'msg-new');

      expect(store.getByMessageId('msg-old')).toBeUndefined();
      expect(store.getByMessageId('msg-new')!.cardId).toBe('card-1');
    });

    it('is a no-op for nonexistent cardId', () => {
      store.setMessageId('nonexistent', 'msg-1');
      expect(store.getByMessageId('msg-1')).toBeUndefined();
    });
  });

  // ── resolveCardAction ─────────────────────────────────────────────────

  describe('resolveCardAction', () => {
    const makePayload = (): PermissionActionPayload => ({
      v: 1,
      nonce: 'test-nonce',
      iat: Date.now(),
      exp: Date.now() + 300000,
      action: 'approve',
      sessionId: 'session-1',
      requestId: 'perm-1',
      toolName: 'Bash',
      toolCallId: 'tc-1',
      agentType: 'claude',
    });

    it('returns card and entry for active entry with matching messageId', () => {
      const card = cardStore.create('chat-1', 'permission', {
        sections: [{ type: 'markdown', content: 'test' }],
      });
      store.create({
        cardId: card.cardId,
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        permissionRequestId: 'perm-1',
      });
      store.setMessageId(card.cardId, 'msg-1');

      const result = store.resolveCardAction('msg-1', makePayload());
      expect(result).not.toBeNull();
      expect(result!.card.cardId).toBe(card.cardId);
      expect(result!.entry.cardId).toBe(card.cardId);
    });

    it('returns null for completed entry', () => {
      const card = cardStore.create('chat-1', 'permission', {
        sections: [{ type: 'markdown', content: 'test' }],
      });
      store.create({
        cardId: card.cardId,
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
      });
      store.setMessageId(card.cardId, 'msg-1');
      store.complete(card.cardId);

      expect(store.resolveCardAction('msg-1', makePayload())).toBeNull();
    });

    it('returns null when card not found in CardStateStore', () => {
      store.create({
        cardId: 'orphan-card',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
      });
      store.setMessageId('orphan-card', 'msg-1');

      // orphan-card is not in cardStore
      expect(store.resolveCardAction('msg-1', makePayload())).toBeNull();
    });

    it('returns null for nonexistent messageId', () => {
      expect(store.resolveCardAction('nonexistent', makePayload())).toBeNull();
    });
  });

  // ── complete ──────────────────────────────────────────────────────────

  describe('complete', () => {
    it('transitions entry status to completed', () => {
      store.create({
        cardId: 'card-1',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-1',
      });

      store.complete('card-1');

      const entry = store.getByCardId('card-1');
      expect(entry!.status).toBe('completed');
    });

    it('keeps indexes intact after completion (entry still findable)', () => {
      store.create({
        cardId: 'card-1',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-1',
      });
      store.setMessageId('card-1', 'msg-1');
      store.complete('card-1');

      expect(store.getByMessageId('msg-1')!.status).toBe('completed');
      expect(store.getByToolCallId('session-1', 'tc-1')!.status).toBe('completed');
    });

    it('is a no-op for nonexistent cardId', () => {
      store.complete('nonexistent'); // should not throw
    });
  });

  // ── expire ────────────────────────────────────────────────────────────

  describe('expire', () => {
    it('expires active entries older than threshold', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      store.create({
        cardId: 'old-card',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-old',
      });

      vi.setSystemTime(60_000); // 59 seconds later

      store.create({
        cardId: 'new-card',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-new',
      });

      const count = store.expire(30_000); // expire entries older than 30s
      expect(count).toBe(1);

      expect(store.getByCardId('old-card')!.status).toBe('expired');
      expect(store.getByCardId('new-card')!.status).toBe('active');

      vi.useRealTimers();
    });

    it('cleans up indexes for expired entries', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      store.create({
        cardId: 'card-1',
        messageId: 'msg-1',
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        permissionRequestId: 'pr-1',
      });
      store.setMessageId('card-1', 'msg-1');

      vi.setSystemTime(60_000);
      store.expire(30_000);

      expect(store.getByMessageId('msg-1')).toBeUndefined();
      expect(store.getByToolCallId('session-1', 'tc-1')).toBeUndefined();
      expect(store.getByPermissionId('session-1', 'pr-1')).toBeUndefined();

      vi.useRealTimers();
    });

    it('does not expire completed entries', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      store.create({
        cardId: 'card-1',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
      });
      store.complete('card-1');

      vi.setSystemTime(60_000);
      const count = store.expire(30_000);
      expect(count).toBe(0);
      expect(store.getByCardId('card-1')!.status).toBe('completed');

      vi.useRealTimers();
    });
  });

  // ── snapshot / restore ────────────────────────────────────────────────

  describe('snapshot / restore', () => {
    it('round-trips data correctly', () => {
      store.create({
        cardId: 'card-1',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-1',
      });
      store.setMessageId('card-1', 'msg-1');

      const snap = store.snapshot();
      const newStore = new MessageCorrelationStoreImpl(cardStore);
      newStore.restore(snap);

      expect(newStore.getByCardId('card-1')).toBeDefined();
      expect(newStore.getByMessageId('msg-1')!.cardId).toBe('card-1');
      expect(newStore.getByToolCallId('session-1', 'tc-1')!.cardId).toBe('card-1');
    });

    it('does not rebuild indexes for expired entries', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      store.create({
        cardId: 'card-1',
        messageId: 'msg-1',
        chatId: 'chat-1',
        sessionId: 'session-1',
        toolCallId: 'tc-1',
      });

      vi.setSystemTime(60_000);
      store.expire(30_000);

      const snap = store.snapshot();
      const newStore = new MessageCorrelationStoreImpl(cardStore);
      newStore.restore(snap);

      // Entry exists but indexes are not rebuilt for expired
      expect(newStore.getByCardId('card-1')!.status).toBe('expired');
      expect(newStore.getByMessageId('msg-1')).toBeUndefined();
      expect(newStore.getByToolCallId('session-1', 'tc-1')).toBeUndefined();

      vi.useRealTimers();
    });

    it('snapshot creates deep copies', () => {
      store.create({
        cardId: 'card-1',
        messageId: null,
        chatId: 'chat-1',
        sessionId: 'session-1',
      });

      const snap = store.snapshot();
      snap.entries[0]!.chatId = 'modified';

      expect(store.getByCardId('card-1')!.chatId).toBe('chat-1');
    });
  });
});
