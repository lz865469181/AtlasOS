import type { AgentMessage } from 'codelink-agent';
import type { RuntimeAdapter, RuntimePrompt } from '../RuntimeAdapter.js';
import type { RuntimeSession } from '../RuntimeModels.js';

export class ExternalRuntimeAdapter implements RuntimeAdapter {
  private handler: ((runtimeId: string, msg: AgentMessage) => void) | null = null;

  onMessage(handler: (runtimeId: string, msg: AgentMessage) => void): void {
    this.handler = handler;
  }

  async start(_runtime: RuntimeSession): Promise<void> {}

  async sendPrompt(runtime: RuntimeSession, _prompt: RuntimePrompt): Promise<void> {
    throw new Error(`Runtime ${runtime.displayName ?? runtime.id} is externally registered and does not support prompt forwarding yet.`);
  }

  async cancel(_runtime: RuntimeSession): Promise<void> {}

  async dispose(_runtime: RuntimeSession): Promise<void> {}
}
