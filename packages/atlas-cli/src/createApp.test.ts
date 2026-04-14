import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createApp } from './createApp.js';
import type { AtlasConfig, CodeLinkConfig } from './createApp.js';

const expressMocks = vi.hoisted(() => ({
  json: vi.fn(() => 'json-middleware'),
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  use: vi.fn(),
  listen: vi.fn((_port: number, cb?: () => void) => {
    cb?.();
    return { close: vi.fn() };
  }),
}));

vi.mock('express', () => ({
  default: Object.assign(
    () => ({
      use: expressMocks.use,
      get: expressMocks.get,
      post: expressMocks.post,
      delete: expressMocks.delete,
      listen: expressMocks.listen,
    }),
    {
      json: expressMocks.json,
    },
  ),
}));

vi.mock('codelink-gateway', async () => {
  return vi.importActual('../../atlas-gateway/src/index.ts');
});

// Mock codelink-agent so we don't need a real registry
vi.mock('codelink-agent', () => ({
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

function findRouteHandler(mock: ReturnType<typeof vi.fn>, path: string) {
  const call = mock.mock.calls.find((entry) => entry[0] === path);
  expect(call).toBeTruthy();
  return call?.[1] as (req: any, res: any) => unknown;
}

function makeResponseRecorder() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
  };

  return response;
}

describe('createApp', () => {
  beforeEach(() => {
    expressMocks.json.mockClear();
    expressMocks.get.mockClear();
    expressMocks.post.mockClear();
    expressMocks.delete.mockClear();
    expressMocks.use.mockClear();
    expressMocks.listen.mockClear();
  });

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

  it('accepts CodeLinkConfig as the preferred config alias', () => {
    const config: CodeLinkConfig = {
      channels: {
        feishu: { appId: 'fid', appSecret: 'fsecret' },
      },
      agent: { cwd: '/tmp', defaultAgent: 'claude', defaultPermissionMode: 'auto' },
      idleTimeoutMs: 300000,
      logLevel: 'info',
    };

    const app = createApp(config);
    expect(app).toBeDefined();
  });

  it('registers inbox and event ingestion routes for external runtimes', async () => {
    const app = createApp({
      agentCwd: '/tmp',
    });

    await app.start();

    const registeredGets = expressMocks.get.mock.calls.map((call) => call[0]);
    const registeredPosts = expressMocks.post.mock.calls.map((call) => call[0]);

    expect(registeredGets).toContain('/api/runtimes/:runtimeId/inbox');
    expect(registeredPosts).toContain('/api/runtimes/:runtimeId/events');

    await app.stop();
  });

  it('returns 404 when polling inbox for an unknown runtime', async () => {
    const app = createApp({
      agentCwd: '/tmp',
    });

    await app.start();

    const inboxHandler = findRouteHandler(expressMocks.get, '/api/runtimes/:runtimeId/inbox');
    const response = makeResponseRecorder();

    inboxHandler({ params: { runtimeId: 'runtime-missing' } }, response);

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'runtime not found' });

    await app.stop();
  });

  it('rejects empty event ingestion payloads for a known runtime', async () => {
    const app = createApp({
      agentCwd: '/tmp',
    });

    await app.start();

    const registerHandler = findRouteHandler(expressMocks.post, '/api/runtimes/register');
    const eventsHandler = findRouteHandler(expressMocks.post, '/api/runtimes/:runtimeId/events');

    const registerResponse = makeResponseRecorder();
    await registerHandler({
      body: {
        runtimeId: 'runtime-external-1',
        source: 'external',
        provider: 'claude',
        transport: 'bridge',
        displayName: 'bridge-runtime',
      },
    }, registerResponse);

    expect(registerResponse.statusCode).toBe(200);

    const response = makeResponseRecorder();
    eventsHandler({
      params: { runtimeId: 'runtime-external-1' },
      body: {},
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'message or messages is required' });

    await app.stop();
  });
});
