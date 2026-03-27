import { readFileSync, writeFileSync } from "node:fs";

export interface ParkedSession {
  name: string;
  cliSessionId: string;
  status: "running" | "parked";
  startedAt: number;
  parkedAt: number;
  parkedBy?: string;
}

/** Stale "running" sessions older than 24h are auto-transitioned to "parked". */
const STALE_RUNNING_MS = 24 * 60 * 60 * 1000;

export class ParkedSessionStore {
  private sessions = new Map<string, ParkedSession>();
  private persistPath: string | null;

  constructor(persistPath?: string) {
    this.persistPath = persistPath ?? null;
  }

  /** Register or update a session (used by both register and park). */
  park(session: ParkedSession): void {
    this.sessions.set(session.name, session);
  }

  /** Update a session's status. Returns false if session not found. */
  updateStatus(name: string, status: "running" | "parked"): boolean {
    const s = this.sessions.get(name);
    if (!s) return false;
    s.status = status;
    if (status === "parked") s.parkedAt = Date.now();
    return true;
  }

  get(name: string): ParkedSession | undefined {
    return this.sessions.get(name);
  }

  remove(name: string): boolean {
    return this.sessions.delete(name);
  }

  list(): ParkedSession[] {
    // Auto-transition stale "running" sessions to "parked"
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.status === "running" && now - s.startedAt > STALE_RUNNING_MS) {
        s.status = "parked";
        s.parkedAt = now;
      }
    }
    return [...this.sessions.values()].sort((a, b) => {
      // Running sessions first, then by most recent
      if (a.status !== b.status) return a.status === "running" ? -1 : 1;
      const aTime = a.status === "running" ? a.startedAt : a.parkedAt;
      const bTime = b.status === "running" ? b.startedAt : b.parkedAt;
      return bTime - aTime;
    });
  }

  loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as ParkedSession[];
      for (const s of data) {
        if (s && s.name && s.cliSessionId) {
          // Migrate legacy entries without status
          if (!s.status) s.status = "parked";
          if (!s.startedAt) s.startedAt = s.parkedAt;
          this.sessions.set(s.name, s);
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.error(`[ParkedSessionStore] Failed to load ${this.persistPath}: ${err.message}`);
      }
    }
  }

  saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      writeFileSync(this.persistPath, JSON.stringify(this.list(), null, 2), "utf-8");
    } catch {
      // Best-effort persistence
    }
  }
}
