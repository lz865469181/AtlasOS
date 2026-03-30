import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AgentId } from 'atlas-agent';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  chatId: string;
  agentId: AgentId;
  model?: string;
  permissionMode: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface SessionManager {
  getOrCreate(chatId: string, agentId?: AgentId): Promise<SessionInfo>;
  get(chatId: string): SessionInfo | undefined;
  destroy(chatId: string): Promise<void>;
  switchAgent(chatId: string, agentId: AgentId): Promise<SessionInfo>;
  setModel(chatId: string, model: string): void;
  setPermissionMode(chatId: string, mode: string): void;
  listActive(): SessionInfo[];
  persist(): Promise<void>;
  restore(): Promise<void>;
}

export interface SerializedSessionStore {
  sessions: SessionInfo[];
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_AGENT_ID: AgentId = 'claude';
const DEFAULT_PERMISSION_MODE = 'normal';

// ── Implementation ─────────────────────────────────────────────────────────

export class SessionManagerImpl implements SessionManager {
  private sessions = new Map<string, SessionInfo>();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), '.atlasOS', 'sessions', 'sessions.json');
  }

  async getOrCreate(chatId: string, agentId?: AgentId): Promise<SessionInfo> {
    const existing = this.sessions.get(chatId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      return existing;
    }

    const session: SessionInfo = {
      sessionId: randomUUID(),
      chatId,
      agentId: agentId ?? DEFAULT_AGENT_ID,
      permissionMode: DEFAULT_PERMISSION_MODE,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessions.set(chatId, session);
    return session;
  }

  get(chatId: string): SessionInfo | undefined {
    return this.sessions.get(chatId);
  }

  async destroy(chatId: string): Promise<void> {
    this.sessions.delete(chatId);
  }

  async switchAgent(chatId: string, agentId: AgentId): Promise<SessionInfo> {
    await this.destroy(chatId);
    return this.getOrCreate(chatId, agentId);
  }

  setModel(chatId: string, model: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    session.model = model;
    session.lastActiveAt = Date.now();
  }

  setPermissionMode(chatId: string, mode: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    session.permissionMode = mode;
    session.lastActiveAt = Date.now();
  }

  listActive(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  async persist(): Promise<void> {
    const dir = join(this.filePath, '..');
    await mkdir(dir, { recursive: true });

    const data: SerializedSessionStore = {
      sessions: Array.from(this.sessions.values()),
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
      this.sessions.set(session.chatId, session);
    }
  }
}
