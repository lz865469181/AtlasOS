import type { ChannelEvent } from '../channel/channelEvent.js';
import type { BindingStoreImpl } from './BindingStore.js';
import type { RuntimeRegistryImpl } from './RuntimeRegistry.js';

export type RuntimeResolution =
  | { kind: 'runtime'; bindingId: string; runtimeId: string }
  | { kind: 'missing'; bindingId: string };

export class RuntimeRouterImpl {
  constructor(private deps: {
    bindingStore: Pick<BindingStoreImpl, 'getOrCreate'>;
    runtimeRegistry: Pick<RuntimeRegistryImpl, 'get'>;
  }) {}

  async resolveTarget(event: ChannelEvent): Promise<RuntimeResolution> {
    const threadKey = event.threadId ?? event.chatId;
    const binding = this.deps.bindingStore.getOrCreate(
      event.channelId,
      event.chatId,
      threadKey,
    );

    if (binding.activeRuntimeId && this.deps.runtimeRegistry.get(binding.activeRuntimeId)) {
      return {
        kind: 'runtime',
        bindingId: binding.bindingId,
        runtimeId: binding.activeRuntimeId,
      };
    }

    if (binding.defaultRuntimeId && this.deps.runtimeRegistry.get(binding.defaultRuntimeId)) {
      return {
        kind: 'runtime',
        bindingId: binding.bindingId,
        runtimeId: binding.defaultRuntimeId,
      };
    }

    return { kind: 'missing', bindingId: binding.bindingId };
  }
}
