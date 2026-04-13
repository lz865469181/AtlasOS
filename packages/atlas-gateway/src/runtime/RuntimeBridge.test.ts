import { describe, expect, it, vi } from 'vitest';
import { RuntimeBridgeImpl } from './RuntimeBridge.js';

describe('RuntimeBridgeImpl', () => {
  it('forwards prompts to the adapter selected by runtime', async () => {
    const adapter = {
      start: vi.fn(),
      sendPrompt: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
      onMessage: vi.fn(),
    };
    const bridge = new RuntimeBridgeImpl({
      runtimeRegistry: {
        get: vi.fn().mockReturnValue({ id: 'r1', transport: 'sdk', provider: 'claude' }),
        update: vi.fn(),
      } as any,
      adapters: { resolve: vi.fn().mockReturnValue(adapter) } as any,
    });

    await bridge.sendPrompt('r1', {
      channelId: 'feishu',
      chatId: 'c1',
      userId: 'u1',
      userName: '',
      messageId: 'm1',
      content: { type: 'text', text: 'hi' },
      timestamp: 1,
    });

    expect(adapter.sendPrompt).toHaveBeenCalled();
  });
});
