import type { AgentBackend, AgentId } from './AgentBackend.js';

export interface AgentFactoryOptions {
  cwd: string;
  env?: Record<string, string>;
}

export type AgentFactory = (opts: AgentFactoryOptions) => AgentBackend;

export class AgentRegistry {
  private factories = new Map<string, AgentFactory>();

  register(id: AgentId, factory: AgentFactory): void {
    this.factories.set(id, factory);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }

  create(id: string, opts: AgentFactoryOptions): AgentBackend {
    const factory = this.factories.get(id);
    if (!factory) {
      const available = this.list().join(', ') || 'none';
      throw new Error(`Unknown agent: ${id}. Available agents: ${available}`);
    }
    return factory(opts);
  }
}

export const agentRegistry = new AgentRegistry();
