import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";

// Project root: src/config.ts compiles to dist/config.js, so root = dirname(..)
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), "..");

/** Absolute path to the project root directory. */
export const projectRoot = PROJECT_ROOT;

/** Absolute path to the ~/.atlasOS/ runtime home directory. */
export const ATLAS_HOME = resolve(homedir(), ".atlasOS");

// Ensure ~/.atlasOS/ exists
mkdirSync(ATLAS_HOME, { recursive: true });

// Bootstrap config.json → ~/.atlasOS/config.json
const atlasConfigPath = join(ATLAS_HOME, "config.json");
if (!existsSync(atlasConfigPath)) {
  const templatePath = join(PROJECT_ROOT, "config.json");
  if (existsSync(templatePath)) {
    copyFileSync(templatePath, atlasConfigPath);
    console.log(`[bootstrap] Copied config.json → ${atlasConfigPath}`);
  } else {
    // Minimal default config when no template available (e.g. global npm install)
    const defaultConfig = {
      agent: { backend: "claude", claude_cli_path: "claude", claude_cli_args: ["--print", "--output-format", "json"], timeout: "120s", max_retries: 3, max_concurrent_per_agent: 5, workspace_root: "" },
      channels: { feishu: { app_id: "${FEISHU_APP_ID}", app_secret: "${FEISHU_APP_SECRET}", enabled: true, ws_endpoint: "wss://open.feishu.cn/event/ws" }, telegram: { enabled: false }, discord: { enabled: false }, dingtalk: { enabled: false } },
      gateway: { host: "127.0.0.1", port: 18789, max_sessions: 200, session_ttl: "30m", context_compress_threshold: 0.8 },
      health: { enabled: true, port: 18790, endpoint: "/health" },
      logging: { level: "info", format: "json", output: "stdout" },
      memory: { compaction: { enabled: true, schedule: "0 3 * * *", max_file_size: "50KB", expire_overridden_days: 30, summarize_threshold: 20 } },
      webui: { enabled: true, port: 20263 },
      cron: { enabled: true },
      access_control: { rate_limit: { max_messages: 30, window: "1m" } },
    };
    writeFileSync(atlasConfigPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
    console.log(`[bootstrap] Created default config.json → ${atlasConfigPath}`);
  }
}

// Bootstrap .env → ~/.atlasOS/.env
const atlasEnvPath = join(ATLAS_HOME, ".env");
if (!existsSync(atlasEnvPath)) {
  const templateEnvPath = join(PROJECT_ROOT, ".env");
  if (existsSync(templateEnvPath)) {
    copyFileSync(templateEnvPath, atlasEnvPath);
    console.log(`[bootstrap] Copied .env → ${atlasEnvPath}`);
  } else {
    writeFileSync(atlasEnvPath, `# Feishu AI Assistant - Environment Variables\n# Edit this file and restart the server.\n\nFEISHU_APP_ID=\nFEISHU_APP_SECRET=\n# ANTHROPIC_API_KEY=\n`, "utf-8");
    console.log(`[bootstrap] Created .env template → ${atlasEnvPath}`);
  }
}

// Load .env from ~/.atlasOS/
loadDotenv({ path: atlasEnvPath });

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
  _configPath = configPath ?? atlasConfigPath;
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
