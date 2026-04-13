import { randomUUID } from 'node:crypto';
import type { AgentSpec, RuntimeSession } from './RuntimeModels.js';

export class RuntimeRegistryImpl {
  private runtimes = new Map<string, RuntimeSession>();

  async create(spec: AgentSpec, opts: { displayName?: string; workspaceId?: string; projectId?: string; metadata?: Record<string, string> } = {}): Promise<RuntimeSession> {
    const now = Date.now();
    const runtime: RuntimeSession = {
      id: randomUUID(),
      source: 'atlas-managed',
      provider: spec.provider,
      transport: spec.transport,
      status: 'idle',
      displayName: opts.displayName ?? spec.displayName,
      workspaceId: opts.workspaceId,
      projectId: opts.projectId,
      capabilities: { ...spec.defaultCapabilities },
      metadata: { agentId: spec.id, ...(opts.metadata ?? {}) },
      createdAt: now,
      lastActiveAt: now,
    };
    this.runtimes.set(runtime.id, runtime);
    return runtime;
  }

  async registerExternal(runtime: RuntimeSession): Promise<void> {
    this.runtimes.set(runtime.id, runtime);
  }

  get(id: string): RuntimeSession | undefined {
    return this.runtimes.get(id);
  }

  list(): RuntimeSession[] {
    return Array.from(this.runtimes.values());
  }

  remove(id: string): void {
    this.runtimes.delete(id);
  }

  update(id: string, patch: Partial<RuntimeSession>): void {
    const current = this.runtimes.get(id);
    if (!current) return;
    this.runtimes.set(id, { ...current, ...patch });
  }

  serialize(): RuntimeSession[] {
    return this.list();
  }

  restoreFrom(items: RuntimeSession[]): void {
    this.runtimes.clear();
    for (const item of items) {
      this.runtimes.set(item.id, item);
    }
  }

  findByPrefix(prefix: string): RuntimeSession | null {
    const lower = prefix.toLowerCase();
    const exactName = this.list().find(runtime => runtime.displayName?.toLowerCase() === lower);
    if (exactName) return exactName;

    const nameMatches = this.list().filter(runtime => runtime.displayName?.toLowerCase().startsWith(lower));
    if (nameMatches.length === 1) return nameMatches[0];

    const idMatches = this.list().filter(runtime => runtime.id.toLowerCase().startsWith(lower));
    if (idMatches.length === 1) return idMatches[0];

    return null;
  }

  async persist(): Promise<void> {}

  async restore(): Promise<void> {}
}
