import { describe, expect, it, vi } from 'vitest';
import { adoptTmuxRuntime, discoverTmuxSessions, findExistingTmuxRuntime, launchTmuxRuntime } from './runtimeLauncher.js';

describe('launchTmuxRuntime', () => {
  it('creates a tmux-backed external runtime registration payload', async () => {
    const runCommand = vi.fn(async () => '');
    const registerRuntime = vi.fn(async () => {});

    const launched = await launchTmuxRuntime({
      provider: 'claude',
      name: 'fix-login',
      cwd: '/work/project',
      cliPath: 'claude',
      serverUrl: 'http://127.0.0.1:20263',
    }, {
      runCommand,
      registerRuntime,
      createRuntimeId: () => 'runtime-1234',
    });

    expect(runCommand).toHaveBeenCalledWith([
      'new-session',
      '-d',
      '-s',
      'codelink-fix-login',
      '-c',
      '/work/project',
      "claude --session-id runtime-1234",
    ]);

    expect(registerRuntime).toHaveBeenCalledWith({
      runtimeId: 'runtime-1234',
      source: 'external',
      provider: 'claude',
      transport: 'tmux',
      displayName: 'fix-login',
      resumeHandle: { kind: 'tmux-session', value: 'codelink-fix-login' },
      capabilities: {
        streaming: true,
        permissionCards: false,
        fileAccess: true,
        imageInput: false,
        terminalOutput: true,
        patchEvents: false,
      },
      metadata: {
        agentId: 'claude',
        launcher: 'codelink-runtime',
        tmuxManaged: 'true',
        tmuxSessionName: 'codelink-fix-login',
        tmuxTarget: 'codelink-fix-login:0.0',
        cwd: '/work/project',
      },
    });

    expect(launched).toEqual({
      runtimeId: 'runtime-1234',
      displayName: 'fix-login',
      sessionName: 'codelink-fix-login',
      tmuxTarget: 'codelink-fix-login:0.0',
    });
  });

  it('creates a codex tmux runtime without a claude session-id flag', async () => {
    const runCommand = vi.fn(async () => '');
    const registerRuntime = vi.fn(async () => {});

    const launched = await launchTmuxRuntime({
      provider: 'codex',
      name: 'spec-review',
      cwd: '/work/project',
      cliPath: 'codex',
      serverUrl: 'http://127.0.0.1:20263',
    }, {
      runCommand,
      registerRuntime,
      createRuntimeId: () => 'runtime-codex-1',
    });

    expect(runCommand).toHaveBeenCalledWith([
      'new-session',
      '-d',
      '-s',
      'codelink-spec-review',
      '-c',
      '/work/project',
      'codex',
    ]);

    expect(registerRuntime).toHaveBeenCalledWith({
      runtimeId: 'runtime-codex-1',
      source: 'external',
      provider: 'codex',
      transport: 'tmux',
      displayName: 'spec-review',
      resumeHandle: { kind: 'tmux-session', value: 'codelink-spec-review' },
      capabilities: {
        streaming: true,
        permissionCards: false,
        fileAccess: true,
        imageInput: false,
        terminalOutput: true,
        patchEvents: false,
      },
      metadata: {
        agentId: 'codex',
        launcher: 'codelink-runtime',
        tmuxManaged: 'true',
        tmuxSessionName: 'codelink-spec-review',
        tmuxTarget: 'codelink-spec-review:0.0',
        cwd: '/work/project',
      },
    });

    expect(launched).toEqual({
      runtimeId: 'runtime-codex-1',
      displayName: 'spec-review',
      sessionName: 'codelink-spec-review',
      tmuxTarget: 'codelink-spec-review:0.0',
    });
  });

  it('allows codex tmux runtimes to override the launch command and register proxy metadata', async () => {
    const runCommand = vi.fn(async () => '');
    const registerRuntime = vi.fn(async () => {});

    const launched = await launchTmuxRuntime({
      provider: 'codex',
      name: 'spec-review',
      cwd: '/work/project',
      cliPath: 'codex',
      serverUrl: 'http://127.0.0.1:20263',
      commandOverride: 'node /runtime-proxy/codex-proxy.js',
      metadata: {
        inputProtocol: 'codelink-jsonl-v1',
      },
    }, {
      runCommand,
      registerRuntime,
      createRuntimeId: () => 'runtime-codex-proxy-1',
    });

    expect(runCommand).toHaveBeenCalledWith([
      'new-session',
      '-d',
      '-s',
      'codelink-spec-review',
      '-c',
      '/work/project',
      "node /runtime-proxy/codex-proxy.js",
    ]);

    expect(registerRuntime).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'runtime-codex-proxy-1',
      metadata: expect.objectContaining({
        inputProtocol: 'codelink-jsonl-v1',
      }),
    }));

    expect(launched.runtimeId).toBe('runtime-codex-proxy-1');
  });

  it('discovers existing tmux session names', async () => {
    const sessions = await discoverTmuxSessions({
      runCommand: vi.fn(async () => 'claude-main\ncodex-lab\n'),
    });

    expect(sessions).toEqual([
      { sessionName: 'claude-main' },
      { sessionName: 'codex-lab' },
    ]);
  });

  it('normalizes psmux list-sessions fallback output to bare session names', async () => {
    const sessions = await discoverTmuxSessions({
      runCommand: vi.fn(async () => 'claude-main: 1 windows (created Tue Apr 14 17:34:11 2026)\ncodex-lab: 2 windows (created Tue Apr 14 17:34:12 2026)\n'),
    });

    expect(sessions).toEqual([
      { sessionName: 'claude-main' },
      { sessionName: 'codex-lab' },
    ]);
  });

  it('adopts an existing tmux session without marking it managed', async () => {
    const runCommand = vi.fn(async (args: string[]) => {
      if (args[0] === 'display-message') {
        return 'codex-lab:2.1\n';
      }
      return '';
    });
    const registerRuntime = vi.fn(async () => {});

    const adopted = await adoptTmuxRuntime({
      provider: 'codex',
      sessionName: 'codex-lab',
      displayName: 'codex-live',
      serverUrl: 'http://127.0.0.1:20263',
    }, {
      runCommand,
      registerRuntime,
      createRuntimeId: () => 'runtime-adopt-1',
    });

    expect(runCommand).toHaveBeenNthCalledWith(1, ['has-session', '-t', 'codex-lab']);
    expect(runCommand).toHaveBeenNthCalledWith(2, [
      'display-message',
      '-p',
      '-t',
      'codex-lab',
      '#{session_name}:#{window_index}.#{pane_index}',
    ]);

    expect(registerRuntime).toHaveBeenCalledWith({
      runtimeId: 'runtime-adopt-1',
      source: 'external',
      provider: 'codex',
      transport: 'tmux',
      displayName: 'codex-live',
      resumeHandle: { kind: 'tmux-session', value: 'codex-lab' },
      capabilities: {
        streaming: true,
        permissionCards: false,
        fileAccess: true,
        imageInput: false,
        terminalOutput: true,
        patchEvents: false,
      },
      metadata: {
        agentId: 'codex',
        launcher: 'codelink-runtime',
        tmuxManaged: 'false',
        tmuxSessionName: 'codex-lab',
        tmuxTarget: 'codex-lab:2.1',
        tmuxAdopted: 'true',
      },
    });

    expect(adopted).toEqual({
      runtimeId: 'runtime-adopt-1',
      displayName: 'codex-live',
      sessionName: 'codex-lab',
      tmuxTarget: 'codex-lab:2.1',
    });
  });

  it('finds an already registered tmux runtime for the same provider and session', async () => {
    const existing = findExistingTmuxRuntime([
      {
        id: 'runtime-1',
        provider: 'claude',
        transport: 'tmux',
        displayName: 'local-claude',
        resumeHandle: { kind: 'tmux-session', value: 'claude-main' },
      },
      {
        id: 'runtime-2',
        provider: 'codex',
        transport: 'tmux',
        displayName: 'codex-live',
        resumeHandle: { kind: 'tmux-session', value: 'codex-lab' },
      },
    ], {
      provider: 'codex',
      sessionName: 'codex-lab',
    });

    expect(existing).toEqual({
      id: 'runtime-2',
      provider: 'codex',
      transport: 'tmux',
      displayName: 'codex-live',
      resumeHandle: { kind: 'tmux-session', value: 'codex-lab' },
    });
  });
});
