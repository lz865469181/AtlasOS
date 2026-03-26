import { readFileSync, writeFileSync } from "node:fs";
import { log } from "../logger.js";

export interface SessionMeta {
  key: string;
  userID: string;
  agentName: string;
  model?: string;
  cliSessionId?: string;
  lastChatID?: string;
  lastActiveAt: number;
}

export class SessionManager {
  private sessions = new Map<string, SessionMeta>();
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private persistPath: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 5_000;
  onSessionRemoved?: (key: string) => void;

  constructor(ttlMs: number, persistPath?: string) {
    this.ttlMs = ttlMs;
    this.persistPath = persistPath ?? null;
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  getOrCreate(key: string, userID: string, agentName: string): SessionMeta {
    let meta = this.sessions.get(key);
    if (!meta) {
      meta = { key, userID, agentName, lastActiveAt: Date.now() };
      this.sessions.set(key, meta);
      this.scheduleSave();
    }
    meta.lastActiveAt = Date.now();
    return meta;
  }

  get(key: string): SessionMeta | undefined {
    return this.sessions.get(key);
  }

  delete(key: string): void {
    this.sessions.delete(key);
    this.scheduleSave();
  }

  clearAgentSessionId(key: string): void {
    const meta = this.sessions.get(key);
    if (meta) {
      meta.cliSessionId = undefined;
      this.scheduleSave();
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()];
  }

  findMostRecentUserID(): string | undefined {
    let latestTime = 0;
    let latestUserID: string | undefined;
    for (const meta of this.sessions.values()) {
      if (meta.lastActiveAt > latestTime && meta.userID !== "unknown") {
        latestTime = meta.lastActiveAt;
        latestUserID = meta.userID;
      }
    }
    return latestUserID;
  }

  findLastChatID(key: string): string | undefined {
    return this.sessions.get(key)?.lastChatID;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, meta] of this.sessions) {
      if (now - meta.lastActiveAt > this.ttlMs) {
        this.sessions.delete(key);
        this.onSessionRemoved?.(key);
      }
    }
  }

  loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, SessionMeta>;
      const now = Date.now();
      let loaded = 0;
      for (const [key, meta] of Object.entries(data)) {
        if (!meta || typeof meta !== "object") continue;
        if (now - (meta.lastActiveAt ?? 0) > this.ttlMs) continue;
        this.sessions.set(key, meta);
        loaded++;
      }
      log("info", "Sessions loaded from disk", { loaded, path: this.persistPath });
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        log("warn", "Failed to load sessions", { error: String(err) });
      }
    }
  }

  saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const data: Record<string, SessionMeta> = {};
      for (const [key, meta] of this.sessions) {
        data[key] = meta;
      }
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      log("warn", "Failed to save sessions", { error: String(err) });
    }
  }

  private scheduleSave(): void {
    if (!this.persistPath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, this.SAVE_DEBOUNCE_MS);
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveToDisk();
    this.sessions.clear();
  }
}
