/**
 * Unified backend abstraction — routes to Claude CLI or OpenCode CLI
 * based on config.agent.backend.
 */
import { getConfig } from "../config.js";
import { emit } from "../webui/events.js";
import { ask as claudeAsk } from "../claude/client.js";
import type { ClaudeResult, AskOptions as ClaudeAskOptions } from "../claude/client.js";
import { ask as opencodeAsk } from "../opencode/client.js";
import type { OpenCodeResult, OpenCodeAskOptions } from "../opencode/client.js";

export interface BackendAskOptions {
  prompt: string;
  systemPrompt?: string;
  workDir?: string;
  addDirs?: string[];
  maxRetries?: number;
  model?: string;
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
 * Claude:   claude -p "prompt" --output-format json --no-session-persistence --model X --add-dir dir
 * OpenCode: opencode run "prompt" --format json --model X
 */
export function buildSpawnArgs(options: {
  prompt: string;
  outputFormat: "json" | "stream-json";
  model?: string;
  systemPrompt?: string;
  addDirs?: string[];
}): string[] {
  const backend = getConfig().agent.backend ?? "claude";

  if (backend === "opencode") {
    const fullPrompt = options.systemPrompt
      ? `[SYSTEM INSTRUCTIONS]\n${options.systemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\n${options.prompt}`
      : options.prompt;

    const args = ["run", fullPrompt, "--format", "json"];
    if (options.model) {
      args.push("--model", options.model);
    }
    return args;
  }

  // Claude
  const args = [
    "-p", options.prompt,
    "--output-format", options.outputFormat,
    "--no-session-persistence",
  ];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt);
  }
  for (const dir of options.addDirs ?? []) {
    args.push("--add-dir", dir);
  }
  return args;
}
