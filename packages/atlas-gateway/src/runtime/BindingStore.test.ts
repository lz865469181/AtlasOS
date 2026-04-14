import { describe, expect, it } from 'vitest';
import { BindingStoreImpl } from './BindingStore.js';

describe('BindingStoreImpl', () => {
  it('creates a binding and keeps MRU runtime order', () => {
    const store = new BindingStoreImpl();
    const binding = store.getOrCreate('feishu', 'chat-1', 'thread-1');

    store.attach(binding.bindingId, 'r1');
    store.attach(binding.bindingId, 'r2');
    store.attach(binding.bindingId, 'r1');

    expect(store.get(binding.bindingId)?.attachedRuntimeIds).toEqual(['r1', 'r2']);
  });

  it('keeps watch state separate from the active runtime', () => {
    const store = new BindingStoreImpl();
    const binding = store.getOrCreate('feishu', 'chat-1', 'thread-1');

    store.attach(binding.bindingId, 'r1');
    store.attach(binding.bindingId, 'r2');
    store.setActive(binding.bindingId, 'r1');
    store.setWatching(binding.bindingId, 'r2');

    expect(store.get(binding.bindingId)).toMatchObject({
      activeRuntimeId: 'r1',
      watchRuntimeId: 'r2',
      watchRuntimeIds: ['r2'],
      watchState: {
        r2: { unreadCount: 0 },
      },
    });
  });

  it('supports multiple watching runtimes while keeping the first watcher as the primary alias', () => {
    const store = new BindingStoreImpl();
    const binding = store.getOrCreate('feishu', 'chat-1', 'thread-1');

    store.attach(binding.bindingId, 'r1');
    store.attach(binding.bindingId, 'r2');
    store.attach(binding.bindingId, 'r3');
    store.setActive(binding.bindingId, 'r1');
    store.addWatching(binding.bindingId, 'r2');
    store.addWatching(binding.bindingId, 'r3');

    expect(store.get(binding.bindingId)).toMatchObject({
      activeRuntimeId: 'r1',
      watchRuntimeId: 'r3',
      watchRuntimeIds: ['r3', 'r2'],
      watchState: {
        r2: { unreadCount: 0 },
        r3: { unreadCount: 0 },
      },
    });
  });
});
