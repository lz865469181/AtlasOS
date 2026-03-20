import { execFile } from "node:child_process";
import { getConfig, parseDuration } from "../config.js";

export interface ClaudeResult {
  type: string;
  result: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
}

export interface AskOptions {
  /** The user's message (passed to -p). */
  prompt: string;
  /** System prompt (SOUL + MEMORY + history context, passed to --append-system-prompt). */
  systemPrompt?: string;
  /** Working directory for Claude CLI. */
  workDir?: string;
  /** Additional directories to grant tool access to. */
  addDirs?: string[];
  /** Max retry attempts. */
  maxRetries?: number;
  /** Model to use (e.g. "claude-haiku-4-5-20251001"). */
  model?: string;
}

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

/**
 * Execute Claude CLI with the given prompt and return the parsed result.
 */
export async function ask(options: AskOptions): Promise<ClaudeResult> {
  const config = getConfig();
  const {
    prompt,
    systemPrompt,
    workDir,
    addDirs = [],
    maxRetries = config.agent.max_retries,
    model,
  } = options;

  const timeoutMs = parseDuration(config.agent.timeout);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await execClaude(prompt, systemPrompt, workDir, addDirs, timeoutMs, model);
      return result;
    } catch (err) {
      lastError = err as Error;
      log("warn", `Claude CLI attempt ${attempt}/${maxRetries} failed`, {
        error: lastError.message,
      });
      if (attempt < maxRetries) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError ?? new Error("Claude CLI failed after retries");
}

function execClaude(
  prompt: string,
  systemPrompt: string | undefined,
  workDir: string | undefined,
  addDirs: string[],
  timeoutMs: number,
  model?: string,
): Promise<ClaudeResult> {
  const config = getConfig();
  const cliPath = config.agent.claude_cli_path;

  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--no-session-persistence",
  ];

  // Set model (e.g. --model claude-haiku-4-5-20251001)
  if (model) {
    args.push("--model", model);
  }

  // Inject system context via --append-system-prompt (keeps Claude Code defaults + adds ours)
  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }

  for (const dir of addDirs) {
    args.push("--add-dir", dir);
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
          reject(new Error(`Claude CLI error: ${error.message}\nstderr: ${stderr}`));
          return;
        }

        try {
          // Claude --output-format json outputs one JSON object
          const result = JSON.parse(stdout.trim()) as ClaudeResult;
          if (result.is_error) {
            reject(new Error(`Claude returned error: ${result.result}`));
            return;
          }
          resolve(result);
        } catch {
          // If not JSON, treat stdout as plain text result
          resolve({
            type: "result",
            result: stdout.trim(),
          });
        }
      },
    );

    // Pipe nothing to stdin, then close
    proc.stdin?.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
