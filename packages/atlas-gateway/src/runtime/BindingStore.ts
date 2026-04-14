import type { ConversationBinding } from './RuntimeModels.js';

export class BindingStoreImpl {
  private bindings = new Map<string, ConversationBinding>();

  private syncWatchAlias(binding: ConversationBinding): void {
    binding.watchRuntimeIds = binding.watchRuntimeIds.filter((runtimeId, index, all) =>
      runtimeId !== binding.activeRuntimeId && all.indexOf(runtimeId) === index);
    binding.watchRuntimeId = binding.watchRuntimeIds[0] ?? null;
  }

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
      watchRuntimeIds: [],
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
    binding.watchRuntimeIds = binding.watchRuntimeIds.filter(id => id !== runtimeId);
    this.syncWatchAlias(binding);
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
    if (runtimeId) {
      binding.watchRuntimeIds = binding.watchRuntimeIds.filter(id => id !== runtimeId);
    }
    this.syncWatchAlias(binding);
    if (runtimeId && binding.watchState[runtimeId]) {
      binding.watchState[runtimeId] = {
        ...binding.watchState[runtimeId],
        unreadCount: 0,
      };
    }
    binding.lastActiveAt = Date.now();
  }

  setWatching(bindingId: string, runtimeId: string | null): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;
    for (const watchedRuntimeId of binding.watchRuntimeIds) {
      delete binding.watchState[watchedRuntimeId];
    }
    binding.watchRuntimeIds = [];
    this.syncWatchAlias(binding);
    if (runtimeId) {
      this.addWatching(bindingId, runtimeId);
      return;
    }
    binding.lastActiveAt = Date.now();
  }

  addWatching(bindingId: string, runtimeId: string | null): void {
    const binding = this.bindings.get(bindingId);
    if (!binding || !runtimeId || runtimeId === binding.activeRuntimeId) return;

    binding.watchRuntimeIds = binding.watchRuntimeIds.filter(id => id !== runtimeId);
    binding.watchRuntimeIds.unshift(runtimeId);
    this.syncWatchAlias(binding);

    binding.watchState[runtimeId] = {
      ...binding.watchState[runtimeId],
      unreadCount: 0,
    };

    binding.lastActiveAt = Date.now();
  }

  removeWatching(bindingId: string, runtimeId: string): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;

    binding.watchRuntimeIds = binding.watchRuntimeIds.filter(id => id !== runtimeId);
    this.syncWatchAlias(binding);
    delete binding.watchState[runtimeId];

    binding.lastActiveAt = Date.now();
  }

  clearWatching(bindingId: string): void {
    const binding = this.bindings.get(bindingId);
    if (!binding) return;

    for (const runtimeId of binding.watchRuntimeIds) {
      delete binding.watchState[runtimeId];
    }
    binding.watchRuntimeIds = [];
    this.syncWatchAlias(binding);

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
        watchRuntimeIds: item.watchRuntimeIds?.length
          ? [...item.watchRuntimeIds]
          : (item.watchRuntimeId ? [item.watchRuntimeId] : []),
        watchState: item.watchState ?? {},
      });
      this.syncWatchAlias(this.bindings.get(item.bindingId)!);
    }
  }

  async persist(): Promise<void> {}

  async restore(): Promise<void> {}
}
