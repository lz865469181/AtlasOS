import { describe, it, expect } from 'vitest';
import {
  CodeLinkConfigSchema,
  AtlasConfigSchema,
  FeishuChannelConfigSchema,
  DingTalkChannelConfigSchema,
  AgentConfigSchema,
} from './ConfigSchema.js';

describe('FeishuChannelConfigSchema', () => {
  it('accepts valid config', () => {
    const result = FeishuChannelConfigSchema.parse({ appId: 'id', appSecret: 'secret' });
    expect(result.appId).toBe('id');
  });

  it('rejects empty appId', () => {
    expect(() => FeishuChannelConfigSchema.parse({ appId: '', appSecret: 's' })).toThrow();
  });

  it('accepts optional verificationToken', () => {
    const result = FeishuChannelConfigSchema.parse({ appId: 'id', appSecret: 's', verificationToken: 'tok' });
    expect(result.verificationToken).toBe('tok');
  });
});

describe('DingTalkChannelConfigSchema', () => {
  it('defaults mode to webhook', () => {
    const result = DingTalkChannelConfigSchema.parse({ appKey: 'k', appSecret: 's' });
    expect(result.mode).toBe('webhook');
  });

  it('accepts stream mode', () => {
    const result = DingTalkChannelConfigSchema.parse({ appKey: 'k', appSecret: 's', mode: 'stream' });
    expect(result.mode).toBe('stream');
  });

  it('rejects invalid mode', () => {
    expect(() => DingTalkChannelConfigSchema.parse({ appKey: 'k', appSecret: 's', mode: 'invalid' })).toThrow();
  });
});

describe('AgentConfigSchema', () => {
  it('applies defaults', () => {
    const result = AgentConfigSchema.parse({});
    expect(result.cwd).toBe('.');
    expect(result.defaultAgent).toBe('claude');
    expect(result.defaultPermissionMode).toBe('auto');
  });

  it('accepts overrides', () => {
    const result = AgentConfigSchema.parse({ cwd: '/opt', defaultAgent: 'gpt', defaultPermissionMode: 'deny' });
    expect(result.cwd).toBe('/opt');
    expect(result.defaultAgent).toBe('gpt');
    expect(result.defaultPermissionMode).toBe('deny');
  });
});

describe('AtlasConfigSchema', () => {
  it('keeps CodeLinkConfigSchema as the primary alias of AtlasConfigSchema', () => {
    expect(CodeLinkConfigSchema).toBe(AtlasConfigSchema);
  });

  it('applies all defaults for empty input', () => {
    const result = AtlasConfigSchema.parse({});
    expect(result.channels).toEqual({});
    expect(result.agent.cwd).toBe('.');
    expect(result.idleTimeoutMs).toBe(600000);
    expect(result.logLevel).toBe('info');
  });

  it('accepts full config', () => {
    const result = AtlasConfigSchema.parse({
      channels: {
        feishu: { appId: 'fid', appSecret: 'fs' },
        dingtalk: { appKey: 'dk', appSecret: 'ds', mode: 'stream' },
      },
      agent: { cwd: '/tmp', defaultAgent: 'claude' },
      idleTimeoutMs: 300000,
      logLevel: 'debug',
    });
    expect(result.channels.feishu?.appId).toBe('fid');
    expect(result.channels.dingtalk?.mode).toBe('stream');
    expect(result.idleTimeoutMs).toBe(300000);
  });

  it('rejects invalid logLevel', () => {
    expect(() => AtlasConfigSchema.parse({ logLevel: 'verbose' })).toThrow();
  });
});
