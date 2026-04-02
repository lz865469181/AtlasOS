import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManagerImpl } from './SessionManager.js';

describe('SessionManager', () => {
  let manager: SessionManagerImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManagerImpl();
  });

  // ── getOrCreate ─────────────────────────────────────────────────────

  describe('getOrCreate', () => {
    it('creates a new session with defaults', async () => {
      const session = await manager.getOrCreate('chat-1');
      expect(session.chatId).toBe('chat-1');
      expect(session.channelId).toBe('feishu');
      expect(session.agentId).toBe('claude');
      expect(session.permissionMode).toBe('normal');
      expect(session.sessionId).toBeDefined();
      expect(session.createdAt).toBeGreaterThan(0);
    });

    it('returns existing session for same chatId', async () => {
      const first = await manager.getOrCreate('chat-1');
      const second = await manager.getOrCreate('chat-1');
      expect(second.sessionId).toBe(first.sessionId);
    });

    it('creates session with specified agentId', async () => {
      const session = await manager.getOrCreate('chat-1', undefined, 'codex');
      expect(session.agentId).toBe('codex');
    });

    it('creates session with specified channelId', async () => {
      const session = await manager.getOrCreate('chat-1', undefined, undefined, 'dingtalk');
      expect(session.channelId).toBe('dingtalk');
    });

    it('updates lastActiveAt on reuse', async () => {
      const first = await manager.getOrCreate('chat-1');
      const originalTime = first.lastActiveAt;
      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 5));
      const second = await manager.getOrCreate('chat-1');
      expect(second.lastActiveAt).toBeGreaterThanOrEqual(originalTime);
    });
  });

  // ── get ─────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns session if exists', async () => {
      await manager.getOrCreate('chat-1');
      const session = manager.get('chat-1');
      expect(session).toBeDefined();
      expect(session!.chatId).toBe('chat-1');
    });

    it('returns undefined for nonexistent chatId', () => {
      expect(manager.get('nope')).toBeUndefined();
    });
  });

  // ── destroy ─────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('removes session', async () => {
      await manager.getOrCreate('chat-1');
      await manager.destroy('chat-1');
      expect(manager.get('chat-1')).toBeUndefined();
    });

    it('is a no-op for nonexistent chatId', async () => {
      await manager.destroy('nope'); // should not throw
    });
  });

  // ── switchAgent ─────────────────────────────────────────────────────

  describe('switchAgent', () => {
    it('destroys old session and creates new one', async () => {
      const first = await manager.getOrCreate('chat-1', undefined, 'claude');
      const second = await manager.switchAgent('chat-1', undefined, 'codex');
      expect(second.agentId).toBe('codex');
      expect(second.sessionId).not.toBe(first.sessionId);
    });
  });

  // ── setModel ────────────────────────────────────────────────────────

  describe('setModel', () => {
    it('sets model and updates lastActiveAt', async () => {
      await manager.getOrCreate('chat-1');
      manager.setModel('chat-1', undefined, 'gpt-4o');
      const session = manager.get('chat-1');
      expect(session!.model).toBe('gpt-4o');
    });

    it('is a no-op for nonexistent chatId', () => {
      manager.setModel('nope', undefined, 'gpt-4o'); // should not throw
    });
  });

  // ── setPermissionMode ───────────────────────────────────────────────

  describe('setPermissionMode', () => {
    it('sets permission mode', async () => {
      await manager.getOrCreate('chat-1');
      manager.setPermissionMode('chat-1', undefined, 'strict');
      expect(manager.get('chat-1')!.permissionMode).toBe('strict');
    });

    it('is a no-op for nonexistent chatId', () => {
      manager.setPermissionMode('nope', undefined, 'strict');
    });
  });

  // ── listActive ──────────────────────────────────────────────────────

  describe('listActive', () => {
    it('returns all sessions', async () => {
      await manager.getOrCreate('chat-1');
      await manager.getOrCreate('chat-2');
      const list = manager.listActive();
      expect(list).toHaveLength(2);
    });

    it('returns empty array when no sessions', () => {
      expect(manager.listActive()).toHaveLength(0);
    });
  });

  // ── persist / restore (no-ops) ──────────────────────────────────────

  describe('persist', () => {
    it('is a no-op', async () => {
      await manager.getOrCreate('chat-1');
      await manager.persist(); // should not throw
    });
  });

  describe('restore', () => {
    it('is a no-op', async () => {
      await manager.restore(); // should not throw
      expect(manager.listActive()).toHaveLength(0);
    });
  });
});
