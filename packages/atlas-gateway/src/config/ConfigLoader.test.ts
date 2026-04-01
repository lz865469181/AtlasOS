import { describe, it, expect } from 'vitest';
import { ConfigLoader } from './ConfigLoader.js';

describe('ConfigLoader.fromEnv', () => {
  it('maps FEISHU env vars to channels.feishu', () => {
    const env = { FEISHU_APP_ID: 'fid', FEISHU_APP_SECRET: 'fs' };
    const result = ConfigLoader.fromEnv(env);
    expect(result.channels?.feishu).toEqual({ appId: 'fid', appSecret: 'fs' });
  });

  it('maps DINGTALK env vars', () => {
    const env = { DINGTALK_APP_KEY: 'dk', DINGTALK_APP_SECRET: 'ds', DINGTALK_MODE: 'stream' };
    const result = ConfigLoader.fromEnv(env);
    expect(result.channels?.dingtalk).toEqual({ appKey: 'dk', appSecret: 'ds', mode: 'stream' });
  });

  it('maps agent env vars', () => {
    const env = { AGENT_CWD: '/opt', AGENT_DEFAULT_AGENT: 'gpt', AGENT_PERMISSION_MODE: 'deny' };
    const result = ConfigLoader.fromEnv(env);
    expect(result.agent?.cwd).toBe('/opt');
    expect(result.agent?.defaultAgent).toBe('gpt');
    expect(result.agent?.defaultPermissionMode).toBe('deny');
  });

  it('converts ATLAS_IDLE_TIMEOUT to number', () => {
    const env = { ATLAS_IDLE_TIMEOUT: '300000' };
    const result = ConfigLoader.fromEnv(env);
    expect(result.idleTimeoutMs).toBe(300000);
  });

  it('skips empty values', () => {
    const env: Record<string, string | undefined> = { FEISHU_APP_ID: '', FEISHU_APP_SECRET: undefined };
    const result = ConfigLoader.fromEnv(env as Record<string, string>);
    expect(result.channels).toBeUndefined();
  });
});

describe('ConfigLoader.merge', () => {
  it('deep merges configs (later wins)', () => {
    const a = { channels: { feishu: { appId: 'old', appSecret: 's' } }, logLevel: 'info' as const };
    const b = { channels: { feishu: { appId: 'new' } } };
    const result = ConfigLoader.merge(a, b);
    expect((result.channels?.feishu as any)?.appId).toBe('new');
    expect((result.channels?.feishu as any)?.appSecret).toBe('s');
    expect(result.logLevel).toBe('info');
  });

  it('merges three configs', () => {
    const result = ConfigLoader.merge(
      { agent: { cwd: '/a' } },
      { agent: { cwd: '/b' } },
      { agent: { cwd: '/c' } },
    );
    expect(result.agent?.cwd).toBe('/c');
  });
});

describe('ConfigLoader.fromFile', () => {
  it('returns null when file does not exist', async () => {
    const result = await ConfigLoader.fromFile('/nonexistent/atlas.config.json');
    expect(result).toBeNull();
  });
});

describe('ConfigLoader.load', () => {
  it('loads config from env + overrides (no file)', async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, FEISHU_APP_ID: 'eid', FEISHU_APP_SECRET: 'es' };
    try {
      const config = await ConfigLoader.load({
        overrides: { logLevel: 'debug' },
      });
      expect(config.channels.feishu?.appId).toBe('eid');
      expect(config.logLevel).toBe('debug');
      expect(config.agent.cwd).toBe('.');
      expect(config.idleTimeoutMs).toBe(600000);
    } finally {
      process.env = origEnv;
    }
  });

  it('overrides take precedence over env', async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, ATLAS_LOG_LEVEL: 'warn' };
    try {
      const config = await ConfigLoader.load({
        overrides: { logLevel: 'error' },
      });
      expect(config.logLevel).toBe('error');
    } finally {
      process.env = origEnv;
    }
  });
});
