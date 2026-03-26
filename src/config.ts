import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

// Load .env before anything else
loadDotenv();

export type BackendType = "claude" | "opencode" | "codex" | "cursor" | "gemini";

export interface AgentConfig {
  /** Which CLI backend to use: "claude" (default) or "opencode". */
  backend: BackendType;
  claude_cli_path: string;
  claude_cli_args: string[];
  /** Path to the OpenCode CLI binary. */
  opencode_cli_path: string;
  anthropic_api_key: string;
  claude_api_key: string;
  timeout: string;
  max_retries: number;
  max_concurrent_per_agent: number;
  workspace_root: string;
  /** Default model ID. Empty string or omitted = let CLI decide. */
  default_model?: string;
  bash: {
    allowed_commands: string[];
    blocked_commands: string[];
    blocked_patterns: string[];
    timeout: string;
    max_output: string;
    network: boolean;
  };
}

export interface FeishuChannelConfig {
  enabled: boolean;
  app_id: string;
  app_secret: string;
  ws_endpoint: string;
}

export interface ChannelConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface ChannelsConfig {
  feishu: FeishuChannelConfig;
  telegram: ChannelConfig;
  discord: ChannelConfig;
  dingtalk: ChannelConfig;
}

export interface GatewayConfig {
  host: string;
  port: number;
  max_sessions: number;
  session_ttl: string;
  context_compress_threshold: number;
}

export interface HealthConfig {
  enabled: boolean;
  port: number;
  endpoint: string;
}

export interface LoggingConfig {
  level: string;
  format: string;
  output: string;
}

export interface MemoryConfig {
  compaction: {
    enabled: boolean;
    schedule: string;
    max_file_size: string;
    expire_overridden_days: number;
    summarize_threshold: number;
  };
}

export interface WebUIConfig {
  enabled: boolean;
  port: number;
}

export interface McpConfig {
  config_path: string;
}

export interface RateLimitCfg {
  max_messages: number;
  window: string;
}

export interface UserRoleCfg {
  name: string;
  user_ids: string[];
  disabled_commands?: string[];
  rate_limit?: RateLimitCfg;
}

export interface VoiceConfig {
  stt?: {
    enabled: boolean;
    provider: "whisper" | "groq";
    api_key: string;
    base_url?: string;
    model?: string;
    language?: string;
  };
  tts?: {
    enabled: boolean;
    provider: "openai" | "edge";
    api_key?: string;
    base_url?: string;
    voice?: string;
    model?: string;
    max_text_len?: number;
  };
}

export interface CronConfig {
  enabled: boolean;
  data_path?: string;
}

export interface RelayConfig {
  enabled: boolean;
  timeout_ms?: number;
}

export interface AccessControlConfig {
  allow_from?: string[];
  admin_from?: string[];
  roles?: UserRoleCfg[];
  default_role?: string;
  rate_limit?: RateLimitCfg;
}

export interface ManagementConfig {
  enabled?: boolean;
  port?: number;
  token?: string;
  cors_origins?: string[];
}

export interface AppConfig {
  agent: AgentConfig;
  channels: ChannelsConfig;
  gateway: GatewayConfig;
  health: HealthConfig;
  logging: LoggingConfig;
  memory: MemoryConfig;
  mcp?: McpConfig;
  webui: WebUIConfig;
  voice?: VoiceConfig;
  cron?: CronConfig;
  relay?: RelayConfig;
  access_control?: AccessControlConfig;
  management?: ManagementConfig;

  /** Workspace routing mode: "single" (default) or "multi-workspace". */
  mode?: "single" | "multi-workspace";
  /** Parent directory for workspaces (required when mode = "multi-workspace"). */
  base_dir?: string;
}

/**
 * Expand ${VAR_NAME} placeholders with values from process.env.
 * Leaves ENC:... values and unresolved vars as-is.
 */
function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    return process.env[varName] ?? match;
  });
}

function expandDeep(obj: unknown): unknown {
  if (typeof obj === "string") {
    return expandEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(expandDeep);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = expandDeep(val);
    }
    return result;
  }
  return obj;
}

let _config: AppConfig | null = null;
let _configPath: string = "";

export function loadConfig(configPath?: string): AppConfig {
  _configPath = configPath ?? resolve(process.cwd(), "config.json");
  const raw = readFileSync(_configPath, "utf-8");
  const parsed = JSON.parse(raw);
  _config = expandDeep(parsed) as AppConfig;
  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }
  return _config;
}

export function getConfigPath(): string {
  return _configPath;
}

/**
 * Read raw config without env expansion (for WebUI editor).
 */
export function readRawConfig(): string {
  return readFileSync(_configPath, "utf-8");
}

/**
 * Write raw config JSON (for WebUI editor).
 */
export function writeRawConfig(json: string): void {
  writeFileSync(_configPath, json, "utf-8");
}

/**
 * Parse duration string like "120s" or "30m" to milliseconds.
 */
export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return 120_000; // default 120s
  const [, num, unit] = match;
  const n = parseInt(num!, 10);
  switch (unit) {
    case "ms": return n;
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    default: return 120_000;
  }
}
