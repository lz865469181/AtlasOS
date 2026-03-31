import { describe, it, expect, vi } from 'vitest';
import { createApp } from './createApp.js';

// Mock atlas-agent so we don't need a real registry
vi.mock('atlas-agent', () => ({
  agentRegistry: {
    create: vi.fn(() => ({
      startSession: vi.fn(async () => ({ sessionId: 'agent-s1' })),
      sendPrompt: vi.fn(async () => {}),
      onMessage: vi.fn(),
      offMessage: vi.fn(),
      dispose: vi.fn(async () => {}),
    })),
  },
}));

describe('createApp', () => {
  it('returns an object with start and stop methods', () => {
    const app = createApp({
      feishuAppId: 'test-id',
      feishuAppSecret: 'test-secret',
      agentCwd: '/tmp',
    });

    expect(app).toBeDefined();
    expect(typeof app.start).toBe('function');
    expect(typeof app.stop).toBe('function');
  });

  it('stop() is safe to call without start()', async () => {
    const app = createApp({
      feishuAppId: 'test-id',
      feishuAppSecret: 'test-secret',
      agentCwd: '/tmp',
    });

    // stop() before start() should not throw
    await expect(app.stop()).resolves.toBeUndefined();
  });

  it('accepts optional agentEnv', () => {
    const app = createApp({
      feishuAppId: 'test-id',
      feishuAppSecret: 'test-secret',
      agentCwd: '/tmp',
      agentEnv: { FOO: 'bar' },
    });

    expect(app).toBeDefined();
  });
});
