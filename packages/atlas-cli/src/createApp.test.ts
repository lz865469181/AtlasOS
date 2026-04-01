import { describe, it, expect, vi } from 'vitest';
import { createApp } from './createApp.js';
import type { AtlasConfig } from './createApp.js';

// Mock atlas-agent so we don't need a real registry
vi.mock('atlas-agent', () => ({
  agentRegistry: {
    create: vi.fn(() => ({
      startSession: vi.fn(async () => ({ sessionId: 'agent-s1' })),
      sendPrompt: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      onMessage: vi.fn(),
      offMessage: vi.fn(),
      dispose: vi.fn(async () => {}),
    })),
  },
}));

describe('createApp', () => {
  // ── Legacy AppConfig ───────────────────────────────────────────────────

  it('returns an object with start and stop methods (legacy config)', () => {
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

  it('accepts DingTalk config', () => {
    const app = createApp({
      dingtalkAppKey: 'dk-key',
      dingtalkAppSecret: 'dk-secret',
      dingtalkMode: 'webhook',
      agentCwd: '/tmp',
    });

    expect(app).toBeDefined();
    expect(typeof app.start).toBe('function');
  });

  it('accepts both Feishu and DingTalk config', () => {
    const app = createApp({
      feishuAppId: 'test-id',
      feishuAppSecret: 'test-secret',
      dingtalkAppKey: 'dk-key',
      dingtalkAppSecret: 'dk-secret',
      agentCwd: '/tmp',
    });

    expect(app).toBeDefined();
  });

  // ── AtlasConfig ────────────────────────────────────────────────────────

  it('accepts AtlasConfig with feishu channel', () => {
    const config: AtlasConfig = {
      channels: {
        feishu: { appId: 'fid', appSecret: 'fsecret' },
      },
      agent: { cwd: '/tmp', defaultAgent: 'claude', defaultPermissionMode: 'auto' },
      idleTimeoutMs: 300000,
      logLevel: 'info',
    };

    const app = createApp(config);
    expect(app).toBeDefined();
    expect(typeof app.start).toBe('function');
  });

  it('accepts AtlasConfig with dingtalk channel', () => {
    const config: AtlasConfig = {
      channels: {
        dingtalk: { appKey: 'dk', appSecret: 'ds', mode: 'stream' },
      },
      agent: { cwd: '/tmp', defaultAgent: 'claude', defaultPermissionMode: 'auto' },
      idleTimeoutMs: 600000,
      logLevel: 'debug',
    };

    const app = createApp(config);
    expect(app).toBeDefined();
  });

  it('accepts AtlasConfig with both channels', () => {
    const config: AtlasConfig = {
      channels: {
        feishu: { appId: 'fid', appSecret: 'fsecret' },
        dingtalk: { appKey: 'dk', appSecret: 'ds', mode: 'webhook' },
      },
      agent: { cwd: '.', defaultAgent: 'claude', defaultPermissionMode: 'confirm' },
      idleTimeoutMs: 600000,
      logLevel: 'warn',
    };

    const app = createApp(config);
    expect(app).toBeDefined();
  });
});
