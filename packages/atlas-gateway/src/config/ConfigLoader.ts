import { AtlasConfigSchema } from './ConfigSchema.js';
import type { AtlasConfig } from './ConfigSchema.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ConfigLoaderOptions {
  /** Path to config file. If omitted, searches CWD. */
  configPath?: string;
  /** Runtime overrides (highest priority). */
  overrides?: DeepPartial<AtlasConfig>;
}

/** Deep partial helper — makes all nested properties optional. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ── Environment variable mapping ────────────────────────────────────────────

const ENV_MAP: Array<{ env: string; path: string[] }> = [
  { env: 'FEISHU_APP_ID', path: ['channels', 'feishu', 'appId'] },
  { env: 'FEISHU_APP_SECRET', path: ['channels', 'feishu', 'appSecret'] },
  { env: 'FEISHU_VERIFICATION_TOKEN', path: ['channels', 'feishu', 'verificationToken'] },
  { env: 'DINGTALK_APP_KEY', path: ['channels', 'dingtalk', 'appKey'] },
  { env: 'DINGTALK_APP_SECRET', path: ['channels', 'dingtalk', 'appSecret'] },
  { env: 'DINGTALK_MODE', path: ['channels', 'dingtalk', 'mode'] },
  { env: 'AGENT_CWD', path: ['agent', 'cwd'] },
  { env: 'AGENT_DEFAULT_AGENT', path: ['agent', 'defaultAgent'] },
  { env: 'AGENT_DEFAULT_MODEL', path: ['agent', 'defaultModel'] },
  { env: 'AGENT_PERMISSION_MODE', path: ['agent', 'defaultPermissionMode'] },
  { env: 'ATLAS_LOG_LEVEL', path: ['logLevel'] },
  { env: 'ATLAS_IDLE_TIMEOUT', path: ['idleTimeoutMs'] },
];

// ── ConfigLoader ────────────────────────────────────────────────────────────

export class ConfigLoader {
  /**
   * Load and validate config from all sources.
   * Resolution order: file → env → overrides (later wins).
   */
  static async load(opts?: ConfigLoaderOptions): Promise<AtlasConfig> {
    const fileConfig = await ConfigLoader.fromFile(opts?.configPath);
    const envConfig = ConfigLoader.fromEnv();
    const merged = ConfigLoader.merge(
      fileConfig ?? {},
      envConfig,
      opts?.overrides ?? {},
    );
    return AtlasConfigSchema.parse(merged);
  }

  /**
   * Build partial config from environment variables.
   */
  static fromEnv(env?: Record<string, string | undefined>): DeepPartial<AtlasConfig> {
    const source = env ?? process.env;
    const result: Record<string, unknown> = {};

    for (const mapping of ENV_MAP) {
      const value = source[mapping.env];
      if (value === undefined || value === '') continue;

      // Convert numeric values
      let parsed: unknown = value;
      if (mapping.env === 'ATLAS_IDLE_TIMEOUT') {
        const num = Number(value);
        if (!Number.isNaN(num)) parsed = num;
      }

      // Set nested path
      setNestedValue(result, mapping.path, parsed);
    }

    return result as DeepPartial<AtlasConfig>;
  }

  /**
   * Read config file if it exists.
   * Supports JSON files only (atlas.config.json).
   */
  static async fromFile(path?: string): Promise<DeepPartial<AtlasConfig> | null> {
    const candidates = path
      ? [path]
      : [
          join(process.cwd(), 'atlas.config.json'),
        ];

    for (const candidate of candidates) {
      try {
        const raw = await readFile(candidate, 'utf-8');
        return JSON.parse(raw) as DeepPartial<AtlasConfig>;
      } catch {
        // File not found or parse error — try next
        continue;
      }
    }
    return null;
  }

  /**
   * Deep merge configs. Later sources override earlier ones.
   */
  static merge(...configs: Array<DeepPartial<AtlasConfig>>): DeepPartial<AtlasConfig> {
    const result: Record<string, unknown> = {};
    for (const config of configs) {
      deepMerge(result, config as Record<string, unknown>);
    }
    return result as DeepPartial<AtlasConfig>;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1]!;
  current[lastKey] = value;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      target[key] = srcVal;
    }
  }
}
