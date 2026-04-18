import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '../../core/AgentMessage.js';

const runStreamed = vi.fn();
const startThread = vi.fn();
const resumeThread = vi.fn();
const constructedInstances: Array<Record<string, unknown> | undefined> = [];

vi.mock('@openai/codex-sdk', () => ({
  Codex: class Codex {
    constructor(public opts?: Record<string, unknown>) {
      constructedInstances.push(opts);
    }

    startThread = startThread;
    resumeThread = resumeThread;
  },
}));

const { CodexBackend } = await import('./CodexBackend.js');

function collectMessages(backend: InstanceType<typeof CodexBackend>): AgentMessage[] {
  const messages: AgentMessage[] = [];
  backend.onMessage((msg: AgentMessage) => messages.push(msg));
  return messages;
}

function streamFrom(events: Array<Record<string, unknown>>) {
  return (async function* generate() {
    for (const event of events) {
      yield event;
    }
  })();
}

describe('CodexBackend', () => {
  const envKeysToIsolate = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_MODEL', 'CODEX_CLI_PATH'];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeysToIsolate) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    vi.clearAllMocks();
    constructedInstances.length = 0;
    startThread.mockImplementation(() => ({
      runStreamed: vi.fn(async () => ({
        events: streamFrom([
          { type: 'item.updated', item: { id: 'msg-1', type: 'agent_message', text: 'Hello' } },
          { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Hello world' } },
          { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2 } },
        ]),
      })),
    }));
  });

  afterEach(() => {
    for (const key of envKeysToIsolate) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('startSession returns sessionId and emits starting then idle', async () => {
    const backend = new CodexBackend({ cwd: '/repo', env: { OPENAI_API_KEY: 'test-key' } });
    const messages = collectMessages(backend);

    const result = await backend.startSession();

    expect(result.sessionId).toBeTruthy();
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      workingDirectory: '/repo',
      approvalPolicy: 'never',
    }));
    expect(messages).toEqual([
      { type: 'status', status: 'starting' },
      { type: 'status', status: 'idle' },
    ]);
  });

  it('sendPrompt emits running, streaming text, final text, then idle', async () => {
    const backend = new CodexBackend({ cwd: '/repo', env: { OPENAI_API_KEY: 'test-key' } });
    const messages = collectMessages(backend);
    const { sessionId } = await backend.startSession();
    messages.length = 0;

    await backend.sendPrompt(sessionId, 'Fix the failing test');

    expect(messages).toEqual([
      { type: 'status', status: 'running' },
      { type: 'model-output', textDelta: 'Hello' },
      { type: 'model-output', textDelta: ' world' },
      { type: 'model-output', fullText: 'Hello world' },
      { type: 'status', status: 'idle' },
    ]);
  });

  it('cancel aborts the active streamed turn and emits idle', async () => {
    let observedAbort = false;
    startThread.mockImplementationOnce(() => ({
      runStreamed: vi.fn(async (_prompt: string, opts?: { signal?: AbortSignal }) => ({
        events: streamFrom([
          {
            type: 'item.updated',
            item: {
              id: 'msg-1',
              type: 'agent_message',
              get text() {
                observedAbort = opts?.signal?.aborted ?? false;
                return 'partial';
              },
            },
          },
        ]),
      })),
    }));

    const backend = new CodexBackend({ cwd: '/repo', env: { OPENAI_API_KEY: 'test-key' } });
    const messages = collectMessages(backend);
    const { sessionId } = await backend.startSession();
    messages.length = 0;

    const pending = backend.sendPrompt(sessionId, 'Long running task');
    await backend.cancel(sessionId);
    await pending;

    expect(observedAbort).toBe(true);
    expect(messages).toContainEqual({ type: 'status', status: 'idle' });
  });

  it('passes Codex SDK options from env overrides', async () => {
    const backend = new CodexBackend({
      cwd: '/repo',
      env: {
        OPENAI_API_KEY: 'sdk-key',
        CODEX_MODEL: 'gpt-5-codex',
        CODEX_CLI_PATH: '/usr/local/bin/codex',
      },
    });
    collectMessages(backend);

    const { sessionId } = await backend.startSession();
    await backend.sendPrompt(sessionId, 'Inspect the repo');

    expect(constructedInstances[0]).toEqual(expect.objectContaining({
      apiKey: 'sdk-key',
      codexPathOverride: '/usr/local/bin/codex',
    }));
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5-codex',
      workingDirectory: '/repo',
    }));
  });

  it('honors an explicit approval policy from env overrides', async () => {
    const backend = new CodexBackend({
      cwd: '/repo',
      env: {
        OPENAI_API_KEY: 'sdk-key',
        CODEX_APPROVAL_POLICY: 'on-request',
      },
    });
    collectMessages(backend);

    await backend.startSession();

    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      approvalPolicy: 'on-request',
    }));
  });

  it('emits command lifecycle messages from command_execution items', async () => {
    startThread.mockImplementationOnce(() => ({
      runStreamed: vi.fn(async () => ({
        events: streamFrom([
          {
            type: 'item.updated',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'npm test',
              aggregated_output: 'running tests\n',
              status: 'in_progress',
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'npm test',
              aggregated_output: 'running tests\n',
              exit_code: 1,
              status: 'failed',
            },
          },
          { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2 } },
        ]),
      })),
    }));

    const backend = new CodexBackend({ cwd: '/repo', env: { OPENAI_API_KEY: 'test-key' } });
    const messages = collectMessages(backend);
    const { sessionId } = await backend.startSession();
    messages.length = 0;

    await backend.sendPrompt(sessionId, 'Run the test suite');

    expect(messages).toEqual([
      { type: 'status', status: 'running' },
      { type: 'command-start', commandId: 'cmd-1', command: 'npm test' },
      { type: 'terminal-output', data: 'running tests\n' },
      { type: 'command-exit', commandId: 'cmd-1', exitCode: 1 },
      { type: 'status', status: 'idle' },
    ]);
  });

  it('emits command start as soon as a command_execution item starts', async () => {
    startThread.mockImplementationOnce(() => ({
      runStreamed: vi.fn(async () => ({
        events: streamFrom([
          {
            type: 'item.started',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'npm test',
              aggregated_output: '',
              status: 'in_progress',
            },
          },
          {
            type: 'item.updated',
            item: {
              id: 'msg-1',
              type: 'agent_message',
              text: 'Preparing command',
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'msg-1',
              type: 'agent_message',
              text: 'Preparing command',
            },
          },
          {
            type: 'item.completed',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: 'npm test',
              aggregated_output: '',
              exit_code: 0,
              status: 'completed',
            },
          },
          { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2 } },
        ]),
      })),
    }));

    const backend = new CodexBackend({ cwd: '/repo', env: { OPENAI_API_KEY: 'test-key' } });
    const messages = collectMessages(backend);
    const { sessionId } = await backend.startSession();
    messages.length = 0;

    await backend.sendPrompt(sessionId, 'Run the test suite');

    expect(messages).toEqual([
      { type: 'status', status: 'running' },
      { type: 'command-start', commandId: 'cmd-1', command: 'npm test' },
      { type: 'model-output', textDelta: 'Preparing command' },
      { type: 'model-output', fullText: 'Preparing command' },
      { type: 'command-exit', commandId: 'cmd-1', exitCode: 0 },
      { type: 'status', status: 'idle' },
    ]);
  });
});
