import type { Agent } from "../../agent/types.js";
import { normalizeWorkspacePath } from "../session/normalize.js";

interface WorkspaceEntry {
  agent: Agent;
  workspace: string;        // normalized absolute path
  lastActivity: number;     // Date.now()
}

export interface WorkspacePoolOptions {
  /** Factory function to create a new Agent for a workspace path */
  createAgent: (workDir: string) => Agent;
  /** Idle timeout in ms before reaping (default: 15 minutes) */
  idleTimeoutMs?: number;
  /** Reap check interval in ms (default: 60 seconds) */
  reapIntervalMs?: number;
}

export class WorkspacePool {
  private entries = new Map<string, WorkspaceEntry>();
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  private createAgent: (workDir: string) => Agent;
  private idleTimeoutMs: number;

  constructor(opts: WorkspacePoolOptions) {
    this.createAgent = opts.createAgent;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 15 * 60 * 1000;
    const reapInterval = opts.reapIntervalMs ?? 60 * 1000;
    this.reapTimer = setInterval(() => this.reap(), reapInterval);
  }

  /**
   * Get or create an Agent for the given workspace path.
   * Path is normalized before lookup.
   */
  getOrCreate(workspace: string): { agent: Agent; workspace: string } {
    const normalized = normalizeWorkspacePath(workspace);
    let entry = this.entries.get(normalized);
    if (!entry) {
      console.log(`[workspace-pool] spawning agent for ${normalized}`);
      const agent = this.createAgent(normalized);
      entry = { agent, workspace: normalized, lastActivity: Date.now() };
      this.entries.set(normalized, entry);
    } else {
      entry.lastActivity = Date.now();
    }
    return { agent: entry.agent, workspace: normalized };
  }

  /** Check if a workspace has an active agent */
  has(workspace: string): boolean {
    return this.entries.has(normalizeWorkspacePath(workspace));
  }

  /** Get the agent for a workspace without creating one */
  get(workspace: string): Agent | undefined {
    const entry = this.entries.get(normalizeWorkspacePath(workspace));
    if (entry) entry.lastActivity = Date.now();
    return entry?.agent;
  }

  /** Touch a workspace to update its last activity timestamp */
  touch(workspace: string): void {
    const entry = this.entries.get(normalizeWorkspacePath(workspace));
    if (entry) entry.lastActivity = Date.now();
  }

  /** List all active workspaces */
  list(): Array<{ workspace: string; idleMs: number }> {
    const now = Date.now();
    return [...this.entries.values()].map(e => ({
      workspace: e.workspace,
      idleMs: now - e.lastActivity,
    }));
  }

  /** Reap idle workspaces */
  private reap(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      const idle = now - entry.lastActivity;
      if (idle > this.idleTimeoutMs) {
        console.log(`[workspace-pool] reaping idle workspace ${key} (idle ${Math.round(idle / 1000)}s)`);
        entry.agent.stop().catch(err => {
          console.error(`[workspace-pool] error stopping agent for ${key}:`, err);
        });
        this.entries.delete(key);
      }
    }
  }

  /** Stop all agents and clear the pool */
  async stopAll(): Promise<void> {
    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    const stops = [...this.entries.values()].map(e =>
      e.agent.stop().catch(err => console.error(`[workspace-pool] error stopping:`, err))
    );
    await Promise.all(stops);
    this.entries.clear();
  }

  /** Number of active workspaces */
  get size(): number {
    return this.entries.size;
  }
}
