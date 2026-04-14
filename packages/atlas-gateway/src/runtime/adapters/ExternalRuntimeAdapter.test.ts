import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalRuntimeAdapter } from './ExternalRuntimeAdapter.js';
import type { RuntimeSession } from '../RuntimeModels.js';

function makeRuntime(overrides?: Partial<RuntimeSession>): RuntimeSession {
  return {
    id: 'runtime-external-1',
    source: 'external',
    provider: 'claude',
    transport: 'bridge',
    status: 'idle',
    displayName: 'bridge-runtime',
    resumeHandle: { kind: 'remote-runtime', value: 'bridge-runtime' },
    capabilities: {
      streaming: true,
      permissionCards: true,
      fileAccess: true,
      imageInput: false,
      terminalOutput: true,
      patchEvents: true,
    },
    metadata: {},
    createdAt: 1,
    lastActiveAt: 1,
    ...overrides,
  };
}

describe('ExternalRuntimeAdapter', () => {
  const handleMessage = vi.fn();
  const disposeCardEngine = vi.fn();
  const runtimeUpdate = vi.fn();

  beforeEach(() => {
    handleMessage.mockReset();
    disposeCardEngine.mockReset();
    runtimeUpdate.mockReset();
  });

  it('queues prompt, cancel, and permission responses for polling external runtimes', async () => {
    const runtime = makeRuntime();
    const adapter = new ExternalRuntimeAdapter({
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
    });

    await adapter.sendPrompt(runtime, {
      text: 'hello from chat',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });
    await adapter.cancel(runtime);
    await adapter.respondToPermission?.(runtime, 'perm-1', true);

    expect(adapter.drainInbox(runtime.id)).toEqual([
      {
        kind: 'prompt',
        prompt: {
          text: 'hello from chat',
          channelId: 'feishu',
          chatId: 'chat-1',
          messageId: 'msg-1',
        },
      },
      { kind: 'cancel' },
      { kind: 'permission-response', requestId: 'perm-1', approved: true },
    ]);
    expect(adapter.drainInbox(runtime.id)).toEqual([]);
  });

  it('ingests agent messages back into card rendering and runtime status', async () => {
    const runtime = makeRuntime({
      metadata: { lastChatId: 'chat-1' },
    });
    const adapter = new ExternalRuntimeAdapter({
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
    });

    adapter.ingest(runtime, { type: 'model-output', textDelta: 'hello' });
    adapter.ingest(runtime, { type: 'status', status: 'idle' });

    expect(handleMessage).toHaveBeenNthCalledWith(1, 'runtime-external-1', 'chat-1', {
      type: 'model-output',
      textDelta: 'hello',
    });
    expect(handleMessage).toHaveBeenNthCalledWith(2, 'runtime-external-1', 'chat-1', {
      type: 'status',
      status: 'idle',
    });
    expect(runtimeUpdate).toHaveBeenCalledWith('runtime-external-1', expect.objectContaining({
      lastActiveAt: expect.any(Number),
    }));
    expect(runtimeUpdate).toHaveBeenCalledWith('runtime-external-1', expect.objectContaining({
      status: 'idle',
    }));
  });

  it('prefers explicit chatId when ingesting events', async () => {
    const runtime = makeRuntime({
      metadata: { lastChatId: 'chat-old' },
    });
    const adapter = new ExternalRuntimeAdapter({
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
    });

    adapter.ingest(runtime, { type: 'terminal-output', data: 'out' }, { chatId: 'chat-new' });

    expect(handleMessage).toHaveBeenCalledWith('runtime-external-1', 'chat-new', {
      type: 'terminal-output',
      data: 'out',
    });
  });
});
