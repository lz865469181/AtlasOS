import { readFileSync, writeFileSync } from "node:fs";

export interface ParkedSession {
  name: string;
  cliSessionId: string;
  parkedAt: number;
  parkedBy?: string;
}

export class ParkedSessionStore {
  private sessions = new Map<string, ParkedSession>();
  private persistPath: string | null;

  constructor(persistPath?: string) {
    this.persistPath = persistPath ?? null;
  }

  park(session: ParkedSession): void {
    this.sessions.set(session.name, session);
  }

  get(name: string): ParkedSession | undefined {
    return this.sessions.get(name);
  }

  remove(name: string): boolean {
    return this.sessions.delete(name);
  }

  list(): ParkedSession[] {
    return [...this.sessions.values()].sort((a, b) => b.parkedAt - a.parkedAt);
  }

  loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as ParkedSession[];
      for (const s of data) {
        if (s && s.name && s.cliSessionId) {
          this.sessions.set(s.name, s);
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        // Silently ignore parse errors on corrupt files
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
