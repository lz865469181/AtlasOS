import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PtyRuntimeAdapter } from './PtyRuntimeAdapter.js';
import type { RuntimeSession } from '../RuntimeModels.js';

interface FakeTerminal extends EventEmitter {
  write: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function makeRuntime(): RuntimeSession {
  return {
    id: 'runtime-pty-1',
    source: 'external',
    provider: 'claude',
    transport: 'pty',
    status: 'idle',
    displayName: 'windows-shell',
    resumeHandle: { kind: 'local-process', value: 'runtime-pty-1' },
    capabilities: {
      streaming: true,
      permissionCards: false,
      fileAccess: true,
      imageInput: false,
      terminalOutput: true,
      patchEvents: false,
    },
    metadata: {
      launcher: 'codelink-runtime',
      ptyCwd: 'C:/workspace',
    },
    createdAt: 1,
    lastActiveAt: 1,
  };
}

function makeProxyRuntime(): RuntimeSession {
  return {
    ...makeRuntime(),
    provider: 'codex',
    metadata: {
      launcher: 'codelink-runtime',
      ptyCwd: 'C:/workspace',
      inputProtocol: 'codelink-jsonl-v1',
    },
  };
}

function makeTerminal(): FakeTerminal {
  const terminal = new EventEmitter() as FakeTerminal;
  terminal.write = vi.fn();
  terminal.kill = vi.fn();
  terminal.pid = 4242;
  return terminal;
}

describe('PtyRuntimeAdapter', () => {
  const spawnTerminal = vi.fn();
  const handleMessage = vi.fn();
  const disposeCardEngine = vi.fn();
  const runtimeUpdate = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    spawnTerminal.mockReset();
    handleMessage.mockReset();
    disposeCardEngine.mockReset();
    runtimeUpdate.mockReset();
  });

  it('spawns the local process once, forwards prompts, and streams output back into cards', async () => {
    const runtime = makeRuntime();
    const terminal = makeTerminal();
    spawnTerminal.mockReturnValue(terminal);

    const adapter = new PtyRuntimeAdapter({
      spawnTerminal,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      idleAfterMs: 250,
    });

    await adapter.start(runtime);
    await adapter.sendPrompt(runtime, {
      text: 'hello from feishu',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    expect(spawnTerminal).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith('hello from feishu\r');

    terminal.emit('data', 'Claude> working...\r\n');

    expect(handleMessage).toHaveBeenCalledWith('runtime-pty-1', 'chat-1', {
      type: 'terminal-output',
      data: 'Claude> working...\r\n',
    });
  });

  it('sends ctrl-c on cancel, marks idle after output quiesces, and kills the process on dispose', async () => {
    const runtime = makeRuntime();
    const terminal = makeTerminal();
    spawnTerminal.mockReturnValue(terminal);
    const onMessage = vi.fn();

    const adapter = new PtyRuntimeAdapter({
      spawnTerminal,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      idleAfterMs: 250,
    });
    adapter.onMessage(onMessage);

    await adapter.start(runtime);
    await adapter.sendPrompt(runtime, {
      text: 'status',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    terminal.emit('data', 'running\r\n');
    await vi.advanceTimersByTimeAsync(300);
    await adapter.cancel(runtime);
    await adapter.dispose(runtime);

    expect(onMessage).toHaveBeenCalledWith('runtime-pty-1', {
      type: 'status',
      status: 'idle',
      detail: 'pty runtime is quiescent',
    });
    expect(terminal.write).toHaveBeenCalledWith('\u0003');
    expect(terminal.kill).toHaveBeenCalledTimes(1);
    expect(disposeCardEngine).toHaveBeenCalledWith('runtime-pty-1');
  });

  it('emits structured command lifecycle messages from terminal markers and hides markers from cards', async () => {
    const runtime = makeRuntime();
    const terminal = makeTerminal();
    spawnTerminal.mockReturnValue(terminal);
    const onMessage = vi.fn();

    const adapter = new PtyRuntimeAdapter({
      spawnTerminal,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      idleAfterMs: 250,
    });
    adapter.onMessage(onMessage);

    await adapter.start(runtime);
    await adapter.sendPrompt(runtime, {
      text: 'npm test',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    terminal.emit(
      'data',
      '@@ATLAS:CMD_START:{"commandId":"cmd-1","command":"npm test","cwd":"C:/workspace"}\r\n' +
      'running tests\r\n' +
      '@@ATLAS:CMD_END:{"commandId":"cmd-1","exitCode":0}\r\n',
    );

    expect(onMessage).toHaveBeenCalledWith('runtime-pty-1', {
      type: 'command-start',
      commandId: 'cmd-1',
      command: 'npm test',
      cwd: 'C:/workspace',
    });
    expect(onMessage).toHaveBeenCalledWith('runtime-pty-1', {
      type: 'command-exit',
      commandId: 'cmd-1',
      exitCode: 0,
    });
    expect(handleMessage).toHaveBeenCalledWith('runtime-pty-1', 'chat-1', {
      type: 'terminal-output',
      data: 'running tests\r\n',
    });
    expect(handleMessage).not.toHaveBeenCalledWith(
      'runtime-pty-1',
      'chat-1',
      expect.objectContaining({
        data: expect.stringContaining('@@ATLAS:CMD_START'),
      }),
    );
  });

  it('emits structured permission requests from terminal markers', async () => {
    const runtime = makeRuntime();
    const terminal = makeTerminal();
    spawnTerminal.mockReturnValue(terminal);
    const onMessage = vi.fn();

    const adapter = new PtyRuntimeAdapter({
      spawnTerminal,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      idleAfterMs: 250,
    });
    adapter.onMessage(onMessage);

    await adapter.start(runtime);
    await adapter.sendPrompt(runtime, {
      text: 'install deps',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    terminal.emit(
      'data',
      '@@ATLAS:PERMISSION_REQUEST:{"id":"perm-1","reason":"Allow npm install?","payload":{"toolName":"shell"}}\r\n',
    );

    expect(onMessage).toHaveBeenCalledWith('runtime-pty-1', {
      type: 'permission-request',
      id: 'perm-1',
      reason: 'Allow npm install?',
      payload: { toolName: 'shell' },
    });
    expect(handleMessage).toHaveBeenCalledWith('runtime-pty-1', 'chat-1', {
      type: 'permission-request',
      id: 'perm-1',
      reason: 'Allow npm install?',
      payload: { toolName: 'shell' },
    });
  });

  it('encodes prompts as JSONL frames for proxy-backed runtimes', async () => {
    const runtime = makeProxyRuntime();
    const terminal = makeTerminal();
    spawnTerminal.mockReturnValue(terminal);

    const adapter = new PtyRuntimeAdapter({
      spawnTerminal,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      idleAfterMs: 250,
    });

    await adapter.sendPrompt(runtime, {
      text: 'line 1\nline 2',
      channelId: 'feishu',
      chatId: 'chat-1',
      messageId: 'msg-1',
    });

    expect(terminal.write).toHaveBeenCalledWith('{"type":"prompt","text":"line 1\\nline 2"}\r');
  });

  it('writes permission responses as JSONL frames for proxy-backed runtimes', async () => {
    const runtime = makeProxyRuntime();
    const terminal = makeTerminal();
    spawnTerminal.mockReturnValue(terminal);

    const adapter = new PtyRuntimeAdapter({
      spawnTerminal,
      cardEngine: {
        handleMessage,
        dispose: disposeCardEngine,
      } as any,
      runtimeRegistry: { update: runtimeUpdate } as any,
      idleAfterMs: 250,
    });

    await adapter.respondToPermission?.(runtime, 'perm-1', true);

    expect(terminal.write).toHaveBeenCalledWith('{"type":"permission-response","requestId":"perm-1","approved":true}\r');
  });
});
