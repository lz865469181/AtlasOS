/**
 * Unified backend abstraction — routes to Claude CLI or OpenCode CLI
 * based on config.agent.backend.
 */
import { getConfig } from "../config.js";
import { emit } from "../webui/events.js";
import { ask as claudeAsk, askStreaming as claudeAskStreaming } from "../claude/client.js";
import type { ClaudeResult, AskOptions as ClaudeAskOptions, StreamChunk } from "../claude/client.js";
import { ask as opencodeAsk } from "../opencode/client.js";
import type { OpenCodeResult, OpenCodeAskOptions } from "../opencode/client.js";

export interface BackendAskOptions {
  prompt: string;
  systemPrompt?: string;
  workDir?: string;
  addDirs?: string[];
  maxRetries?: number;
  model?: string;
  /** CLI session ID for persistent sessions (Claude backend only). */
  sessionId?: string;
  /** Recent conversation history for context recovery after session reset. */
  recentHistory?: string;
}

export interface BackendResult {
  type: string;
  result: string;
  is_error?: boolean;
  duration_ms?: number;
}

/**
 * Send a prompt to the configured backend (Claude or OpenCode).
 */
export async function ask(options: BackendAskOptions): Promise<BackendResult> {
  const backend = getConfig().agent.backend ?? "claude";

  emit("backend", { backend, model: options.model });

  if (backend === "opencode") {
    return opencodeAsk({
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      workDir: options.workDir,
      maxRetries: options.maxRetries,
      model: options.model,
    });
  }

  // Default: Claude
  return claudeAsk({
    prompt: options.prompt,
    systemPrompt: options.systemPrompt,
    workDir: options.workDir,
    addDirs: options.addDirs,
    maxRetries: options.maxRetries,
    model: options.model,
    sessionId: options.sessionId,
    recentHistory: options.recentHistory,
  });
}

/**
 * Get the CLI binary path for the current backend.
 */
export function getCliPath(): string {
  const config = getConfig();
  const backend = config.agent.backend ?? "claude";
  return backend === "opencode"
    ? (config.agent.opencode_cli_path ?? "opencode")
    : config.agent.claude_cli_path;
}

/**
 * Build CLI args for spawning a subprocess (used by dev-agent, feedback).
 *
 * Claude:   echo "prompt" | claude -p --output-format json --session-id <uuid> --model X --add-dir dir
 * OpenCode: echo "prompt" | opencode run --format json --model X
 *
 * IMPORTANT: The prompt is NOT included in args — it must be written to stdin
 * by the caller. This avoids Windows command-line length limits (32768 chars).
 */
export function buildSpawnArgs(options: {
  prompt: string;
  outputFormat: "json" | "stream-json";
  model?: string;
  systemPrompt?: string;
  addDirs?: string[];
  sessionId?: string;
  /** Permission mode for non-interactive use (e.g. "auto" for autonomous agents). */
  permissionMode?: string;
}): string[] {
  const backend = getConfig().agent.backend ?? "claude";

  if (backend === "opencode") {
    // OpenCode: prompt via stdin, not as positional arg
    const args = ["run", "--format", "json"];
    if (options.model) {
      args.push("--model", options.model);
    }
    // System prompt prepended to the prompt text (caller writes to stdin)
    return args;
  }

  // Claude: -p = --print (non-interactive), prompt via stdin
  const args = [
    "-p",
    "--output-format", options.outputFormat,
  ];

  // stream-json requires --verbose when using -p (Claude CLI requirement)
  if (options.outputFormat === "stream-json") {
    args.push("--verbose");
  }

  // Use persistent session if sessionId provided, otherwise stateless
  if (options.sessionId) {
    args.push("--session-id", options.sessionId);
  } else {
    args.push("--no-session-persistence");
  }

  // Permission mode for autonomous/non-interactive agents
  if (options.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }

  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt);
  }

  // MCP server configuration
  const mcpConfigPath = getConfig().mcp?.config_path;
  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
  }

  for (const dir of options.addDirs ?? []) {
    args.push("--add-dir", dir);
  }
  // No prompt in args — caller must write it to stdin
  return args;
}

/**
 * Get the full prompt string to write to stdin for a spawned subprocess.
 */
export function getStdinPrompt(options: {
  prompt: string;
  systemPrompt?: string;
}): string {
  const backend = getConfig().agent.backend ?? "claude";

  if (backend === "opencode" && options.systemPrompt) {
    return `[SYSTEM INSTRUCTIONS]\n${options.systemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\n${options.prompt}`;
  }

  // Claude reads prompt from stdin directly; systemPrompt is via --append-system-prompt flag
  return options.prompt;
}

/**
 * Streaming version of ask() — only supported for Claude backend.
 * Falls back to buffered ask() for OpenCode.
 */
export async function* askStreaming(options: BackendAskOptions): AsyncGenerator<StreamChunk> {
  const backend = getConfig().agent.backend ?? "claude";

  emit("backend", { backend, model: options.model, streaming: true });

  if (backend === "opencode") {
    // OpenCode doesn't support streaming — fall back to buffered
    const result = await opencodeAsk({
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      workDir: options.workDir,
      maxRetries: options.maxRetries,
      model: options.model,
    });
    yield { type: "result", text: result.result };
    return;
  }

  yield* claudeAskStreaming({
    prompt: options.prompt,
    systemPrompt: options.systemPrompt,
    workDir: options.workDir,
    addDirs: options.addDirs,
    model: options.model,
    sessionId: options.sessionId,
  });
}

export type { StreamChunk };
