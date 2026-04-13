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
});
