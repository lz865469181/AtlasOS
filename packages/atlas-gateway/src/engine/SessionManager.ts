import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AgentId } from 'atlas-agent';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
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
}

export interface SerializedSessionStore {
  sessions: SessionInfo[];
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_AGENT_ID: AgentId = 'claude';
const DEFAULT_PERMISSION_MODE = 'normal';
const DEFAULT_CHANNEL_ID = 'feishu';

// ── Implementation ─────────────────────────────────────────────────────────

export class SessionManagerImpl implements SessionManager {
  private sessions = new Map<string, SessionInfo>();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), '.atlasOS', 'sessions', 'sessions.json');
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
    const key = this.sessionLookupKey(opts.chatId);
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

  async persist(): Promise<void> {
    const dir = join(this.filePath, '..');
    await mkdir(dir, { recursive: true });

    const data: SerializedSessionStore = {
      // Skip ephemeral beam sessions
      sessions: Array.from(this.sessions.values()).filter(s => s.channelId !== 'beam'),
    };

    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async restore(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch {
      // File doesn't exist yet — nothing to restore
      return;
    }

    const data: SerializedSessionStore = JSON.parse(raw);
    this.sessions.clear();

    for (const session of data.sessions) {
      const key = this.sessionLookupKey(session.chatId, session.threadKey);
      this.sessions.set(key, session);
    }
  }
}
