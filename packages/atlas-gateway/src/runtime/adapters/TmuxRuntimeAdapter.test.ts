import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TmuxRuntimeAdapter } from './TmuxRuntimeAdapter.js';
import type { RuntimeSession } from '../RuntimeModels.js';

function makeRuntime(): RuntimeSession {
  return {
    id: 'runtime-1',
    source: 'external',
    provider: 'claude',
    transport: 'tmux',
    status: 'idle',
    displayName: 'local-claude',
    resumeHandle: { kind: 'tmux-session', value: 'atlas-local-claude' },
    capabilities: {
      streaming: true,
      permissionCards: false,
      fileAccess: true,
      imageInput: false,
      terminalOutput: true,
      patchEvents: false,
    },
    metadata: {
      tmuxSessionName: 'atlas-local-claude',
      tmuxTarget: 'atlas-local-claude:0.0',
      tmuxManaged: 'true',
    },
    createdAt: 1,
    lastActiveAt: 1,
  };
}

function makeAdoptedRuntime(): RuntimeSession {
  return {
    ...makeRuntime(),
    id: 'runtime-adopted-1',
    displayName: 'codex-live',
    provider: 'codex',
    metadata: {
      tmuxSessionName: 'codex-lab',
      tmuxTarget: 'codex-lab:2.1',
      tmuxManaged: 'false',
      tmuxAdopted: 'true',
    },
  };
}

describe('TmuxRuntimeAdapter', () => {
  const commandRunner = vi.fn<(...args: any[]) => Promise<string>>();
  const handleMessage = vi.fn();
  const disposeCardEngine = vi.fn();
  const runtimeUpdate = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    commandRunner.mockReset();
    handleMessage.mockReset();
    disposeCardEngine.mockReset();
    runtimeUpdate.mockReset();
  });

  it('forwards prompts into tmux and streams capture-pane output back into cards', async () => {
    const runtime = makeRuntime();
    let captureCount = 0;
    commandRunner.mockImplementation(async (args) => {
      if (args[0] !== 'capture-pane') {
        return '';
      }

      captureCount += 1;
      return captureCount === 1 ? '' : 'Claude> hi\nworking...\n';
    });

    const adapter = new TmuxRuntimeAdapter({
      commandRunner,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      pollIntervalMs: 100,
      idleAfterMs: 250,
    });

    await adapter.sendPrompt(runtime, {
      text: 'hi',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    expect(commandRunner).toHaveBeenNthCalledWith(1, ['capture-pane', '-p', '-t', 'atlas-local-claude:0.0']);
    expect(commandRunner).toHaveBeenNthCalledWith(2, ['set-buffer', '--', 'hi']);
    expect(commandRunner).toHaveBeenNthCalledWith(3, ['paste-buffer', '-t', 'atlas-local-claude:0.0']);
    expect(commandRunner).toHaveBeenNthCalledWith(4, ['send-keys', '-t', 'atlas-local-claude:0.0', 'Enter']);

    await vi.advanceTimersByTimeAsync(100);

    expect(commandRunner).toHaveBeenNthCalledWith(5, ['capture-pane', '-p', '-t', 'atlas-local-claude:0.0']);
    expect(handleMessage).toHaveBeenCalledWith('runtime-1', 'chat-1', {
      type: 'terminal-output',
      data: 'Claude> hi\nworking...\n',
    });
  });

  it('sends ctrl-c on cancel and kills managed tmux sessions on dispose', async () => {
    const runtime = makeRuntime();
    commandRunner.mockResolvedValue('');

    const adapter = new TmuxRuntimeAdapter({
      commandRunner,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      pollIntervalMs: 100,
      idleAfterMs: 250,
    });

    await adapter.start(runtime);
    await adapter.cancel(runtime);
    await adapter.dispose(runtime);

    expect(commandRunner).toHaveBeenNthCalledWith(1, ['capture-pane', '-p', '-t', 'atlas-local-claude:0.0']);
    expect(commandRunner).toHaveBeenNthCalledWith(2, ['send-keys', '-t', 'atlas-local-claude:0.0', 'C-c']);
    expect(commandRunner).toHaveBeenNthCalledWith(3, ['kill-session', '-t', 'atlas-local-claude']);
    expect(disposeCardEngine).toHaveBeenCalledWith('runtime-1');
  });

  it('does not kill adopted tmux sessions on dispose', async () => {
    const runtime = makeAdoptedRuntime();
    commandRunner.mockResolvedValue('');

    const adapter = new TmuxRuntimeAdapter({
      commandRunner,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      pollIntervalMs: 100,
      idleAfterMs: 250,
    });

    await adapter.start(runtime);
    await adapter.dispose(runtime);

    expect(commandRunner).toHaveBeenNthCalledWith(1, ['capture-pane', '-p', '-t', 'codex-lab:2.1']);
    expect(commandRunner).not.toHaveBeenCalledWith(['kill-session', '-t', 'codex-lab']);
    expect(disposeCardEngine).toHaveBeenCalledWith('runtime-adopted-1');
  });
});
