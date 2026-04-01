import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '../../core/AgentMessage.js';

// ---- mock Anthropic SDK ----

const mockOn = vi.fn();
const mockFinalMessage = vi.fn();
const mockStream = { on: mockOn, finalMessage: mockFinalMessage };

// Track all instances created
const constructedInstances: Array<{ opts: any; messages: { stream: ReturnType<typeof vi.fn> } }> = [];

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      messages = { stream: vi.fn().mockReturnValue(mockStream) };
      constructor(public opts?: any) {
        constructedInstances.push({ opts, messages: this.messages });
      }
    },
  };
});

// Must import after vi.mock
const { ClaudeBackend } = await import('./ClaudeBackend.js');

// ---- helpers ----

function collectMessages(backend: InstanceType<typeof ClaudeBackend>): AgentMessage[] {
  const messages: AgentMessage[] = [];
  backend.onMessage((msg: AgentMessage) => messages.push(msg));
  return messages;
}

function setupStreamResponse(text: string) {
  mockOn.mockImplementation((event: string, cb: (delta: string) => void) => {
    if (event === 'text') {
      cb(text);
    }
  });
  mockFinalMessage.mockResolvedValue({
    content: [{ type: 'text', text }],
  });
}

// ---- tests ----

describe('ClaudeBackend', () => {
  let backend: InstanceType<typeof ClaudeBackend>;
  let messages: AgentMessage[];

  beforeEach(() => {
    vi.clearAllMocks();
    constructedInstances.length = 0;
    backend = new ClaudeBackend({ cwd: '/tmp', env: { ANTHROPIC_API_KEY: 'test-key' } });
    messages = collectMessages(backend);
    setupStreamResponse('Hello world');
  });

  it('startSession returns sessionId and emits starting then idle', async () => {
    const result = await backend.startSession();

    expect(result.sessionId).toBeTruthy();
    expect(messages).toEqual([
      { type: 'status', status: 'starting' },
      { type: 'status', status: 'idle' },
    ]);
  });

  it('sendPrompt emits running, model-output delta, fullText, then idle', async () => {
    const { sessionId } = await backend.startSession();
    messages.length = 0;

    await backend.sendPrompt(sessionId, 'Hi');

    expect(messages).toEqual([
      { type: 'status', status: 'running' },
      { type: 'model-output', textDelta: 'Hello world' },
      { type: 'model-output', fullText: 'Hello world' },
      { type: 'status', status: 'idle' },
    ]);
  });

  it('sendPrompt throws on unknown session', async () => {
    await expect(backend.sendPrompt('nonexistent', 'Hi')).rejects.toThrow(
      'Unknown session: nonexistent',
    );
  });

  it('cancel aborts stream and emits idle', async () => {
    const { sessionId } = await backend.startSession();
    messages.length = 0;

    await backend.cancel(sessionId);

    expect(messages).toEqual([{ type: 'status', status: 'idle' }]);
  });

  it('dispose cleans up all sessions', async () => {
    const { sessionId: s1 } = await backend.startSession();
    await backend.startSession();
    messages.length = 0;

    await backend.dispose();

    const idleMessages = messages.filter(
      (m) => m.type === 'status' && (m as any).status === 'idle',
    );
    expect(idleMessages.length).toBe(2);

    await expect(backend.sendPrompt(s1, 'test')).rejects.toThrow('Unknown session');
  });

  it('API key from opts.env takes precedence', () => {
    expect(constructedInstances[0].opts).toEqual({ apiKey: 'test-key' });
  });

  it('emits status error on API failure', async () => {
    mockFinalMessage.mockRejectedValueOnce(new Error('API rate limit'));
    mockOn.mockImplementation(() => {});

    const { sessionId } = await backend.startSession();
    messages.length = 0;

    await backend.sendPrompt(sessionId, 'fail');

    expect(messages).toEqual([
      { type: 'status', status: 'running' },
      { type: 'status', status: 'error', detail: 'API rate limit' },
    ]);
  });

  it('offMessage removes handler', async () => {
    const extra: AgentMessage[] = [];
    const handler = (msg: AgentMessage) => extra.push(msg);
    backend.onMessage(handler);
    backend.offMessage(handler);

    await backend.startSession();

    expect(extra).toEqual([]);
  });

  it('respects CLAUDE_MODEL, CLAUDE_MAX_TOKENS, and CLAUDE_SYSTEM_PROMPT', async () => {
    constructedInstances.length = 0;
    const customBackend = new ClaudeBackend({
      cwd: '/tmp',
      env: {
        ANTHROPIC_API_KEY: 'k',
        CLAUDE_MODEL: 'claude-opus-4-6',
        CLAUDE_MAX_TOKENS: '4096',
        CLAUDE_SYSTEM_PROMPT: 'Be helpful',
      },
    });
    collectMessages(customBackend);
    setupStreamResponse('ok');

    const { sessionId } = await customBackend.startSession();
    await customBackend.sendPrompt(sessionId, 'test');

    const instance = constructedInstances[0];
    expect(instance.messages.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: 'Be helpful',
      }),
      expect.any(Object),
    );
  });
});
