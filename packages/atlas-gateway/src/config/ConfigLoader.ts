import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CodeLinkConfigSchema } from './ConfigSchema.js';
import type { CodeLinkConfig } from './ConfigSchema.js';

export interface ConfigLoaderOptions {
  configPath?: string;
  overrides?: DeepPartial<CodeLinkConfig>;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

interface EnvMapping {
  envNames: string[];
  path: string[];
  parser?: (value: string) => unknown;
}

const numberParser = (value: string): number | string => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
};

const ENV_MAP: EnvMapping[] = [
  { envNames: ['FEISHU_APP_ID'], path: ['channels', 'feishu', 'appId'] },
  { envNames: ['FEISHU_APP_SECRET'], path: ['channels', 'feishu', 'appSecret'] },
  { envNames: ['FEISHU_VERIFICATION_TOKEN'], path: ['channels', 'feishu', 'verificationToken'] },
  { envNames: ['DINGTALK_APP_KEY'], path: ['channels', 'dingtalk', 'appKey'] },
  { envNames: ['DINGTALK_APP_SECRET'], path: ['channels', 'dingtalk', 'appSecret'] },
  { envNames: ['DINGTALK_MODE'], path: ['channels', 'dingtalk', 'mode'] },
  { envNames: ['AGENT_CWD'], path: ['agent', 'cwd'] },
  { envNames: ['AGENT_DEFAULT_AGENT'], path: ['agent', 'defaultAgent'] },
  { envNames: ['AGENT_DEFAULT_MODEL'], path: ['agent', 'defaultModel'] },
  { envNames: ['AGENT_PERMISSION_MODE'], path: ['agent', 'defaultPermissionMode'] },
  { envNames: ['CODELINK_LOG_LEVEL', 'ATLAS_LOG_LEVEL'], path: ['logLevel'] },
  {
    envNames: ['CODELINK_IDLE_TIMEOUT', 'ATLAS_IDLE_TIMEOUT'],
    path: ['idleTimeoutMs'],
    parser: numberParser,
  },
];

export class ConfigLoader {
  static async load(opts?: ConfigLoaderOptions): Promise<CodeLinkConfig> {
    const fileConfig = await ConfigLoader.fromFile(opts?.configPath);
    const envConfig = ConfigLoader.fromEnv();
    const merged = ConfigLoader.merge(
      fileConfig ?? {},
      envConfig,
      opts?.overrides ?? {},
    );
    return CodeLinkConfigSchema.parse(merged);
  }

  static fromEnv(env?: Record<string, string | undefined>): DeepPartial<CodeLinkConfig> {
    const source = env ?? process.env;
    const result: Record<string, unknown> = {};

    for (const mapping of ENV_MAP) {
      const value = resolveEnvValue(source, mapping.envNames);
      if (value === undefined || value === '') {
        continue;
      }
      setNestedValue(result, mapping.path, mapping.parser ? mapping.parser(value) : value);
    }

    return result as DeepPartial<CodeLinkConfig>;
  }

  static async fromFile(path?: string): Promise<DeepPartial<CodeLinkConfig> | null> {
    const candidates = path
      ? [path]
      : [
          join(process.cwd(), 'codelink.config.json'),
          join(process.cwd(), 'atlas.config.json'),
        ];

    for (const candidate of candidates) {
      try {
        const raw = await readFile(candidate, 'utf-8');
        return JSON.parse(raw) as DeepPartial<CodeLinkConfig>;
      } catch {
        continue;
      }
    }

    return null;
  }

  static merge(...configs: Array<DeepPartial<CodeLinkConfig>>): DeepPartial<CodeLinkConfig> {
    const result: Record<string, unknown> = {};
    for (const config of configs) {
      deepMerge(result, config as Record<string, unknown>);
    }
    return result as DeepPartial<CodeLinkConfig>;
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[path[path.length - 1]!] = value;
}

function resolveEnvValue(
  source: Record<string, string | undefined>,
  envNames: string[],
): string | undefined {
  for (const envName of envNames) {
    const value = source[envName];
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return undefined;
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
