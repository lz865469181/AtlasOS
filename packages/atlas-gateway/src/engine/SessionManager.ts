import { randomUUID } from 'node:crypto';
import type { AgentId } from 'atlas-agent';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

export interface SessionOwner {
  type: 'thread' | 'local';
  id: string;
}

export interface SessionInfo {
  sessionId: string;
  chatId: string;
  threadKey?: string;
  channelId: string;
  agentId: AgentId;
  model?: string;
  permissionMode: string;
  createdAt: number;
  lastActiveAt: number;
  lastPrompt?: string;
  chatHistory?: ChatEntry[];
  displayName?: string;
  owner?: SessionOwner;
}

export interface SessionManager {
  getOrCreate(chatId: string, threadKey?: string, agentId?: AgentId, channelId?: string): Promise<SessionInfo>;
  get(chatId: string, threadKey?: string): SessionInfo | undefined;
  destroy(chatId: string, threadKey?: string): Promise<void>;
  switchAgent(chatId: string, threadKey: string | undefined, agentId: AgentId): Promise<SessionInfo>;
  setModel(chatId: string, threadKey: string | undefined, model: string): void;
  setPermissionMode(chatId: string, threadKey: string | undefined, mode: string): void;
  listActive(): SessionInfo[];
  listByChatId(chatId: string): SessionInfo[];
  appendChat(chatId: string, threadKey: string | undefined, entry: ChatEntry): void;
  persist(): Promise<void>;
  restore(): Promise<void>;
  registerExternal(opts: { sessionId: string; chatId: string; channelId: string; agentId: AgentId; displayName?: string }): SessionInfo;
  removeBySessionId(sessionId: string): boolean;
  setOwner(sessionId: string, owner: SessionOwner | undefined): void;
  findByPrefix(prefix: string): SessionInfo | null;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_AGENT_ID: AgentId = 'claude';
const DEFAULT_PERMISSION_MODE = 'normal';
const DEFAULT_CHANNEL_ID = 'feishu';

// ── Implementation ─────────────────────────────────────────────────────────

export class SessionManagerImpl implements SessionManager {
  private sessions = new Map<string, SessionInfo>();

  constructor() {
  }

  private sessionLookupKey(chatId: string, threadKey?: string): string {
    return threadKey ? `${chatId}:${threadKey}` : chatId;
  }

  async getOrCreate(chatId: string, threadKey?: string, agentId?: AgentId, channelId?: string): Promise<SessionInfo> {
    const key = this.sessionLookupKey(chatId, threadKey);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastActiveAt = Date.now();
      return existing;
    }

    const session: SessionInfo = {
      sessionId: randomUUID(),
      chatId,
      threadKey,
      channelId: channelId ?? DEFAULT_CHANNEL_ID,
      agentId: agentId ?? DEFAULT_AGENT_ID,
      permissionMode: DEFAULT_PERMISSION_MODE,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessions.set(key, session);
    return session;
  }

  get(chatId: string, threadKey?: string): SessionInfo | undefined {
    const key = this.sessionLookupKey(chatId, threadKey);
    return this.sessions.get(key);
  }

  async destroy(chatId: string, threadKey?: string): Promise<void> {
    const key = this.sessionLookupKey(chatId, threadKey);
    this.sessions.delete(key);
  }

  async switchAgent(chatId: string, threadKey: string | undefined, agentId: AgentId): Promise<SessionInfo> {
    await this.destroy(chatId, threadKey);
    return this.getOrCreate(chatId, threadKey, agentId);
  }

  setModel(chatId: string, threadKey: string | undefined, model: string): void {
    const key = this.sessionLookupKey(chatId, threadKey);
    const session = this.sessions.get(key);
    if (!session) return;
    session.model = model;
    session.lastActiveAt = Date.now();
  }

  setPermissionMode(chatId: string, threadKey: string | undefined, mode: string): void {
    const key = this.sessionLookupKey(chatId, threadKey);
    const session = this.sessions.get(key);
    if (!session) return;
    session.permissionMode = mode;
    session.lastActiveAt = Date.now();
  }

  listActive(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  listByChatId(chatId: string): SessionInfo[] {
    return Array.from(this.sessions.values()).filter(s => s.chatId === chatId);
  }

  appendChat(chatId: string, threadKey: string | undefined, entry: ChatEntry): void {
    const key = this.sessionLookupKey(chatId, threadKey);
    const session = this.sessions.get(key);
    if (!session) return;

    // Truncate text to 100 chars for storage efficiency
    const truncated: ChatEntry = {
      ...entry,
      text: entry.text.length > 100 ? entry.text.slice(0, 100) + '...' : entry.text,
    };

    if (!session.chatHistory) {
      session.chatHistory = [];
    }

    session.chatHistory.push(truncated);

    // Ring buffer: keep at most 10 entries
    if (session.chatHistory.length > 10) {
      session.chatHistory.shift();
    }

    session.lastActiveAt = Date.now();
  }

  registerExternal(opts: { sessionId: string; chatId: string; channelId: string; agentId: AgentId; displayName?: string }): SessionInfo {
    // Use sessionId as key so multiple external sessions with same name coexist
    const key = `ext:${opts.sessionId}`;
    const session: SessionInfo = {
      sessionId: opts.sessionId,
      chatId: opts.chatId,
      channelId: opts.channelId,
      agentId: opts.agentId,
      permissionMode: DEFAULT_PERMISSION_MODE,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      displayName: opts.displayName,
    };
    this.sessions.set(key, session);
    return session;
  }

  removeBySessionId(sessionId: string): boolean {
    for (const [key, session] of this.sessions) {
      if (session.sessionId === sessionId) {
        this.sessions.delete(key);
        return true;
      }
    }
    return false;
  }

  setOwner(sessionId: string, owner: SessionOwner | undefined): void {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        session.owner = owner;
        return;
      }
    }
  }

  findByPrefix(prefix: string): SessionInfo | null {
    const lower = prefix.toLowerCase();
    const active = this.listActive();

    // 1. Exact displayName match (highest priority)
    const exactName = active.find(s => s.displayName?.toLowerCase() === lower);
    if (exactName) return exactName;

    // 2. displayName prefix match
    const nameMatches = active.filter(s => s.displayName?.toLowerCase().startsWith(lower));
    if (nameMatches.length === 1) return nameMatches[0];

    // 3. sessionId prefix match
    const idMatches = active.filter(s => s.sessionId.toLowerCase().startsWith(lower));
    if (idMatches.length === 1) return idMatches[0];

    // Ambiguous or no match
    return null;
  }

  async persist(): Promise<void> {
    // Sessions are ephemeral — no persistence needed
  }

  async restore(): Promise<void> {
    // Sessions are ephemeral — no persistence needed
  }
}
