import type { ChannelEvent } from '../channel/channelEvent.js';
import type { RuntimeAdapterResolver } from './RuntimeAdapter.js';
import type { RuntimeRegistryImpl } from './RuntimeRegistry.js';

export class RuntimeBridgeImpl {
  constructor(private deps: {
    runtimeRegistry: Pick<RuntimeRegistryImpl, 'get' | 'update'>;
    adapters: RuntimeAdapterResolver;
  }) {}

  async sendPrompt(runtimeId: string, event: ChannelEvent): Promise<void> {
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) {
      throw new Error(`Unknown runtime: ${runtimeId}`);
    }

    const adapter = this.deps.adapters.resolve(runtime);
    await adapter.start(runtime);
    this.deps.runtimeRegistry.update(runtimeId, {
      status: 'running',
      lastActiveAt: Date.now(),
      metadata: {
        ...runtime.metadata,
        lastChannelId: event.channelId,
        lastChatId: event.chatId,
        lastPromptPreview: event.content.type === 'text'
          ? (event.content.text.length > 60 ? event.content.text.slice(0, 60) + '...' : event.content.text)
          : `(${event.content.type})`,
      },
    });

    await adapter.sendPrompt(runtime, {
      text: event.content.type === 'text' ? event.content.text : '',
      channelId: event.channelId,
      chatId: event.chatId,
      messageId: event.messageId,
    });
  }

  async cancel(runtimeId: string): Promise<void> {
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) return;
    await this.deps.adapters.resolve(runtime).cancel(runtime);
  }

  async respondToPermission(runtimeId: string, requestId: string, approved: boolean): Promise<void> {
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) return;
    const adapter = this.deps.adapters.resolve(runtime);
    if (adapter.respondToPermission) {
      await adapter.respondToPermission(runtime, requestId, approved);
    }
  }

  async dispose(runtimeId: string): Promise<void> {
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) return;
    await this.deps.adapters.resolve(runtime).dispose(runtime);
  }
}
