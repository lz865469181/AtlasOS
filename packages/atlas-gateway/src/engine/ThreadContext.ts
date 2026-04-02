// ── Types ──────────────────────────────────────────────────────────────────

export interface ThreadContext {
  chatId: string;
  threadKey: string;
  activeSessionId: string | null;
  attachedSessions: string[];   // MRU order, first = most recent
  defaultSessionId: string | null;
}

export interface ThreadContextStore {
  get(chatId: string, threadKey: string): ThreadContext | undefined;
  getOrCreate(chatId: string, threadKey: string): ThreadContext;
  setActive(chatId: string, threadKey: string, sessionId: string | null): void;
  attach(chatId: string, threadKey: string, sessionId: string): void;
  detach(chatId: string, threadKey: string, sessionId: string): void;
  setDefault(chatId: string, threadKey: string, sessionId: string): void;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class ThreadContextStoreImpl implements ThreadContextStore {
  private contexts = new Map<string, ThreadContext>();

  private key(chatId: string, threadKey: string): string {
    return `${chatId}:${threadKey}`;
  }

  get(chatId: string, threadKey: string): ThreadContext | undefined {
    return this.contexts.get(this.key(chatId, threadKey));
  }

  getOrCreate(chatId: string, threadKey: string): ThreadContext {
    const k = this.key(chatId, threadKey);
    const existing = this.contexts.get(k);
    if (existing) return existing;

    const ctx: ThreadContext = {
      chatId,
      threadKey,
      activeSessionId: null,
      attachedSessions: [],
      defaultSessionId: null,
    };
    this.contexts.set(k, ctx);
    return ctx;
  }

  setActive(chatId: string, threadKey: string, sessionId: string | null): void {
    const ctx = this.getOrCreate(chatId, threadKey);
    ctx.activeSessionId = sessionId;
  }

  attach(chatId: string, threadKey: string, sessionId: string): void {
    const ctx = this.getOrCreate(chatId, threadKey);
    // Remove if already present, then push to front (MRU)
    ctx.attachedSessions = ctx.attachedSessions.filter(id => id !== sessionId);
    ctx.attachedSessions.unshift(sessionId);
  }

  detach(chatId: string, threadKey: string, sessionId: string): void {
    const ctx = this.getOrCreate(chatId, threadKey);
    ctx.attachedSessions = ctx.attachedSessions.filter(id => id !== sessionId);
    if (ctx.activeSessionId === sessionId) {
      ctx.activeSessionId = null;
    }
  }

  setDefault(chatId: string, threadKey: string, sessionId: string): void {
    const ctx = this.getOrCreate(chatId, threadKey);
    ctx.defaultSessionId = sessionId;
  }
}
