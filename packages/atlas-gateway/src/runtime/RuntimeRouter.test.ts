import { describe, expect, it, vi } from 'vitest';
import { RuntimeRouterImpl } from './RuntimeRouter.js';

describe('RuntimeRouterImpl', () => {
  it('returns the active runtime when a binding already has one', async () => {
    const router = new RuntimeRouterImpl({
      bindingStore: {
        getOrCreate: vi.fn().mockReturnValue({
          bindingId: 'b1',
          activeRuntimeId: 'r1',
          watchRuntimeId: null,
          attachedRuntimeIds: ['r1'],
          watchState: {},
          defaultRuntimeId: null,
        }),
      } as any,
      runtimeRegistry: { get: vi.fn().mockReturnValue({ id: 'r1' }) } as any,
    });

    const result = await router.resolveTarget({
      channelId: 'feishu',
      chatId: 'c1',
      userId: 'u1',
      userName: '',
      messageId: 'm1',
      content: { type: 'text', text: 'hi' },
      timestamp: 1,
    });

    expect(result).toEqual({ kind: 'runtime', bindingId: 'b1', runtimeId: 'r1' });
  });
});
