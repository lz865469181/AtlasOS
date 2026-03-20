import { Session } from "./session.js";

export class SessionManager {
  private sessions = new Map<string, Session>();
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
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
      }
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }
}
