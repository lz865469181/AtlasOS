import type { ConversationBinding } from './RuntimeModels.js';

export class BindingStoreImpl {
  private bindings = new Map<string, ConversationBinding>();

  get(bindingId: string): ConversationBinding | undefined {
    return this.bindings.get(bindingId);
  }

  getOrCreate(channelId: string, chatId: string, threadKey: string): ConversationBinding {
    const bindingId = `${channelId}:${chatId}:${threadKey}`;
    const existing = this.bindings.get(bindingId);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const binding: ConversationBinding = {
      bindingId,
      channelId,
      chatId,
      threadKey,
      activeRuntimeId: null,
      watchRuntimeId: null,
      attachedRuntimeIds: [],
      watchState: {},
      defaultRuntimeId: null,
      createdAt: now,
      lastActiveAt: now,
    };
    this.bindings.set(bindingId, binding);
    return binding;
  }

  attach(bindingId: string, runtimeId: string): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;
    binding.attachedRuntimeIds = binding.attachedRuntimeIds.filter(id => id !== runtimeId);
    binding.attachedRuntimeIds.unshift(runtimeId);
    binding.lastActiveAt = Date.now();
  }

  detach(bindingId: string, runtimeId: string): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;
    binding.attachedRuntimeIds = binding.attachedRuntimeIds.filter(id => id !== runtimeId);
    if (binding.activeRuntimeId === runtimeId) {
      binding.activeRuntimeId = null;
    }
    if (binding.watchRuntimeId === runtimeId) {
      binding.watchRuntimeId = null;
    }
    delete binding.watchState[runtimeId];
    if (binding.defaultRuntimeId === runtimeId) {
      binding.defaultRuntimeId = null;
    }
    binding.lastActiveAt = Date.now();
  }

  setActive(bindingId: string, runtimeId: string | null): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;
    binding.activeRuntimeId = runtimeId;
    if (runtimeId && binding.watchRuntimeId === runtimeId) {
      binding.watchRuntimeId = null;
    }
    binding.lastActiveAt = Date.now();
  }

  setWatching(bindingId: string, runtimeId: string | null): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;

    binding.watchRuntimeId = runtimeId && runtimeId !== binding.activeRuntimeId
      ? runtimeId
      : null;

    if (binding.watchRuntimeId) {
      binding.watchState[binding.watchRuntimeId] ??= { unreadCount: 0 };
    }

    binding.lastActiveAt = Date.now();
  }

  setDefault(bindingId: string, runtimeId: string | null): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;
    binding.defaultRuntimeId = runtimeId;
    binding.lastActiveAt = Date.now();
  }

  serialize(): ConversationBinding[] {
    return Array.from(this.bindings.values());
  }

  list(): ConversationBinding[] {
    return this.serialize();
  }

  listByChat(channelId: string, chatId: string): ConversationBinding[] {
    return this.list().filter(binding => binding.channelId === channelId && binding.chatId === chatId);
  }

  restoreFrom(items: ConversationBinding[]): void {
    this.bindings.clear();
    for (const item of items) {
      this.bindings.set(item.bindingId, {
        ...item,
        watchRuntimeId: item.watchRuntimeId ?? null,
        watchState: item.watchState ?? {},
      });
    }
  }

  async persist(): Promise<void> {}

  async restore(): Promise<void> {}
}
