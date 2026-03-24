import { readFileSync, writeFileSync } from "node:fs";
import { Session } from "./session.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private persistPath: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce delay for disk writes (ms). */
  private readonly SAVE_DEBOUNCE_MS = 5_000;
  /** Optional callback invoked when a session is removed (for queue cleanup). */
  onSessionRemoved?: (key: string) => void;

  constructor(ttlMs: number, persistPath?: string) {
    this.ttlMs = ttlMs;
    this.persistPath = persistPath ?? null;
    // Cleanup expired sessions every minute
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  private makeKey(agentID: string, userID: string): string {
    return `${agentID}:${userID}`;
  }

  getOrCreate(agentID: string, userID: string): Session {
    const key = this.makeKey(agentID, userID);
    let session = this.sessions.get(key);
    if (!session) {
      session = new Session(key, agentID, userID);
      this.sessions.set(key, session);
      this.scheduleSave();
    }
    session.touch();
    return session;
  }

  get(agentID: string, userID: string): Session | undefined {
    const key = this.makeKey(agentID, userID);
    return this.sessions.get(key);
  }

  delete(agentID: string, userID: string): void {
    const key = this.makeKey(agentID, userID);
    this.sessions.delete(key);
  }

  get size(): number {
    return this.sessions.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastActiveAt > this.ttlMs) {
        this.sessions.delete(key);
        // Notify queue so it can release the chain for this key
        this.onSessionRemoved?.(key);
      }
    }
  }

  /** Load sessions from disk. Discards expired sessions. */
  loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, any>;
      const now = Date.now();
      let loaded = 0;
      let expired = 0;

      for (const [key, sessionData] of Object.entries(data)) {
        if (!sessionData || typeof sessionData !== "object") continue;
        const lastActive = sessionData.lastActiveAt ?? 0;
        if (now - lastActive > this.ttlMs) {
          expired++;
          continue;
        }
        try {
          const session = Session.fromJSON(sessionData);
          this.sessions.set(key, session);
          loaded++;
        } catch {
          // skip corrupt entries
        }
      }

      log("info", "Sessions loaded from disk", { loaded, expired, path: this.persistPath });
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        log("warn", "Failed to load sessions from disk", { error: String(err) });
      }
    }
  }

  /** Save all sessions to disk (synchronous). */
  saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const data: Record<string, unknown> = {};
      for (const [key, session] of this.sessions) {
        data[key] = session.toJSON();
      }
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      log("warn", "Failed to save sessions to disk", { error: String(err) });
    }
  }

  /** Schedule a debounced save to disk. */
  scheduleSave(): void {
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
    // Final save before shutdown
    this.saveToDisk();
    this.sessions.clear();
  }
}
