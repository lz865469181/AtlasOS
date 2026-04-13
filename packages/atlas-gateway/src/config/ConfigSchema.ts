import * as z from 'zod';

// ── Channel Schemas ─────────────────────────────────────────────────────────

export const FeishuChannelConfigSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  verificationToken: z.string().optional(),
});

export const DingTalkChannelConfigSchema = z.object({
  appKey: z.string().min(1),
  appSecret: z.string().min(1),
  mode: z.enum(['stream', 'webhook']).default('webhook'),
});

// ── Agent Schema ────────────────────────────────────────────────────────────

export const AgentConfigSchema = z.object({
  cwd: z.string().default('.'),
  env: z.record(z.string(), z.string()).optional(),
  defaultAgent: z.string().default('claude'),
  defaultModel: z.string().optional(),
  defaultPermissionMode: z.enum(['auto', 'confirm', 'deny']).default('auto'),
});

// ── Top-level Schema ────────────────────────────────────────────────────────

export const CodeLinkConfigSchema = z.object({
  channels: z.object({
    feishu: FeishuChannelConfigSchema.optional(),
    dingtalk: DingTalkChannelConfigSchema.optional(),
  }).default({}),
  agent: AgentConfigSchema.default({}),
  idleTimeoutMs: z.number().default(10 * 60 * 1000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const AtlasConfigSchema = CodeLinkConfigSchema;

// ── Inferred Types ──────────────────────────────────────────────────────────

export type FeishuChannelConfig = z.infer<typeof FeishuChannelConfigSchema>;
export type DingTalkChannelConfig = z.infer<typeof DingTalkChannelConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type CodeLinkConfig = z.infer<typeof CodeLinkConfigSchema>;
export type AtlasConfig = CodeLinkConfig;
