import { execFile } from "node:child_process";
import { getConfig, parseDuration } from "../config.js";

/**
 * OpenCode CLI integration — mirrors the Claude client API surface.
 *
 * CLI mapping (Claude → OpenCode):
 *   claude -p "prompt"                    → opencode run "prompt"
 *   --output-format json                  → --format json
 *   --output-format stream-json           → --format json (streamed line-by-line)
 *   --model claude-sonnet-4-6             → --model anthropic/claude-sonnet-4-6
 *   --append-system-prompt "..."          → (prepended to prompt as [SYSTEM] block)
 *   --no-session-persistence              → (default — opencode run is stateless)
 *   --add-dir dir                         → (not supported — rely on cwd)
 */

export interface OpenCodeResult {
  type: string;
  result: string;
  is_error?: boolean;
  duration_ms?: number;
}

export interface OpenCodeAskOptions {
  /** The user's message. */
  prompt: string;
  /** System prompt — injected as a preamble since OpenCode has no --system-prompt flag. */
  systemPrompt?: string;
  /** Working directory for the CLI process. */
  workDir?: string;
  /** Files to attach via -f flag. */
  attachFiles?: string[];
  /** Max retry attempts. */
  maxRetries?: number;
  /** Model in provider/model format (e.g. "anthropic/claude-sonnet-4-6"). */
  model?: string;
}

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

/**
 * Execute OpenCode CLI with the given prompt and return the parsed result.
 */
export async function ask(options: OpenCodeAskOptions): Promise<OpenCodeResult> {
  const config = getConfig();
  const {
    prompt,
    systemPrompt,
    workDir,
    attachFiles = [],
    maxRetries = config.agent.max_retries,
    model,
  } = options;

  const timeoutMs = parseDuration(config.agent.timeout);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await execOpenCode(prompt, systemPrompt, workDir, attachFiles, timeoutMs, model);
    } catch (err) {
      lastError = err as Error;
      log("warn", `OpenCode CLI attempt ${attempt}/${maxRetries} failed`, {
        error: lastError.message,
      });
      if (attempt < maxRetries) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError ?? new Error("OpenCode CLI failed after retries");
}

function execOpenCode(
  prompt: string,
  systemPrompt: string | undefined,
  workDir: string | undefined,
  attachFiles: string[],
  timeoutMs: number,
  model?: string,
): Promise<OpenCodeResult> {
  const config = getConfig();
  const cliPath = config.agent.opencode_cli_path ?? "opencode";

  // OpenCode has no --append-system-prompt flag, so we prepend it to the prompt
  const fullPrompt = systemPrompt
    ? `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\n${prompt}`
    : prompt;

  // opencode run --format json [--model provider/model] [-f file]*
  // Prompt is piped via stdin to avoid command-line length limits on Windows
  const args = [
    "run",
    "--format", "json",
  ];

  if (model) {
    args.push("--model", model);
  }

  for (const f of attachFiles) {
    args.push("-f", f);
  }

  return new Promise((resolve, reject) => {
    const proc = execFile(
      cliPath,
      args,
      {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`OpenCode CLI error: ${error.message}\nstderr: ${stderr}`));
          return;
        }

        try {
          const result = parseOpenCodeOutput(stdout);
          resolve(result);
        } catch {
          // Fallback: treat stdout as plain text
          resolve({ type: "result", result: stdout.trim() });
        }
      },
    );

    // Write prompt to stdin and close (avoids command-line length limits)
    proc.stdin?.on("error", () => {});
    proc.stdin?.write(fullPrompt);
    proc.stdin?.end();
  });
}

/**
 * Parse OpenCode --format json output.
 *
 * OpenCode emits newline-delimited JSON events. The final result is in the
 * last event with a "result" or text content.
 */
function parseOpenCodeOutput(stdout: string): OpenCodeResult {
  const trimmed = stdout.trim();

  // Try single JSON object first
  try {
    const obj = JSON.parse(trimmed);
    if (obj.result !== undefined) {
      return { type: "result", result: String(obj.result), is_error: obj.is_error };
    }
  } catch {
    // Not a single JSON object — try NDJSON
  }

  // NDJSON: scan from the end for a result
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]!);
      // Check for result-type event
      if (obj.type === "result" && obj.result) {
        return { type: "result", result: obj.result };
      }
      // Check for assistant message with text content
      if (obj.type === "assistant" && obj.message?.content) {
        const texts = obj.message.content
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text);
        if (texts.length > 0) {
          return { type: "result", result: texts.join("\n") };
        }
      }
      // Check for a text field directly
      if (obj.text) {
        return { type: "result", result: obj.text };
      }
    } catch {
      // skip non-JSON lines
    }
  }

  // Last resort: return raw output
  return { type: "result", result: trimmed.slice(-4000) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
