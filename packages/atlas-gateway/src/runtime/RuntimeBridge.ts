import type { ChannelEvent } from '../channel/channelEvent.js';
import type { RuntimeAdapterResolver } from './RuntimeAdapter.js';
import type { RuntimeRegistryImpl } from './RuntimeRegistry.js';
import type { RuntimeSession } from './RuntimeModels.js';

export interface MaterializedPrompt {
  text: string;
  preview?: string;
}

export class RuntimeBridgeImpl {
  constructor(private deps: {
    runtimeRegistry: Pick<RuntimeRegistryImpl, 'get' | 'update'>;
    adapters: RuntimeAdapterResolver;
    materializePrompt?: (
      runtime: RuntimeSession,
      event: ChannelEvent,
    ) => Promise<MaterializedPrompt | null> | MaterializedPrompt | null;
  }) {}

  async sendPrompt(runtimeId: string, event: ChannelEvent): Promise<void> {
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) {
      throw new Error(`Unknown runtime: ${runtimeId}`);
    }

    const adapter = this.deps.adapters.resolve(runtime);
    await adapter.start(runtime);
    const materialized = await this.deps.materializePrompt?.(runtime, event);
    const promptText = materialized?.text ?? (event.content.type === 'text' ? event.content.text : '');
    const promptPreview = materialized?.preview ?? (
      event.content.type === 'text'
        ? (event.content.text.length > 60 ? event.content.text.slice(0, 60) + '...' : event.content.text)
        : `(${event.content.type})`
    );
    this.deps.runtimeRegistry.update(runtimeId, {
      status: 'running',
      lastActiveAt: Date.now(),
      metadata: {
        ...runtime.metadata,
        lastChannelId: event.channelId,
        lastChatId: event.chatId,
        lastPromptPreview: promptPreview,
      },
    });

    await adapter.sendPrompt(runtime, {
      text: promptText,
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
