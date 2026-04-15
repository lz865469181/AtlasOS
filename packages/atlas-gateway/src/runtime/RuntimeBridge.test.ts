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

  it('materializes non-text prompts before forwarding them to the adapter', async () => {
    const adapter = {
      start: vi.fn(),
      sendPrompt: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
      onMessage: vi.fn(),
    };
    const materializePrompt = vi.fn().mockResolvedValue({
      text: 'User attached a file saved at /tmp/runtime-1/report.pdf\nPlease inspect it.',
      preview: '(file) report.pdf',
    });
    const update = vi.fn();
    const runtime = {
      id: 'r1',
      transport: 'tmux',
      provider: 'claude',
      metadata: {},
    };
    const bridge = new RuntimeBridgeImpl({
      runtimeRegistry: {
        get: vi.fn().mockReturnValue(runtime),
        update,
      } as any,
      adapters: { resolve: vi.fn().mockReturnValue(adapter) } as any,
      materializePrompt,
    });

    const event = {
      channelId: 'feishu',
      chatId: 'c1',
      userId: 'u1',
      userName: '',
      messageId: 'm1',
      content: { type: 'file', url: 'file-key-1', filename: 'report.pdf' },
      timestamp: 1,
    };

    await bridge.sendPrompt('r1', event as any);

    expect(materializePrompt).toHaveBeenCalledWith(runtime, event);
    expect(update).toHaveBeenCalledWith('r1', expect.objectContaining({
      metadata: expect.objectContaining({
        lastPromptPreview: '(file) report.pdf',
      }),
    }));
    expect(adapter.sendPrompt).toHaveBeenCalledWith(runtime, expect.objectContaining({
      text: 'User attached a file saved at /tmp/runtime-1/report.pdf\nPlease inspect it.',
    }));
  });
});
