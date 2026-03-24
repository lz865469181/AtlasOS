import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getConfig, parseDuration } from "../config.js";

export interface ClaudeResult {
  type: string;
  result: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
}

/** A chunk emitted during streaming. */
export interface StreamChunk {
  type: "assistant_text" | "tool_use" | "tool_result" | "result" | "error";
  /** Accumulated text so far (for assistant_text) or final result (for result). */
  text: string;
}

export interface AskOptions {
  /** The user's message (positional argument). */
  prompt: string;
  /** System prompt (SOUL + MEMORY context, passed to --append-system-prompt). */
  systemPrompt?: string;
  /** Working directory for Claude CLI. */
  workDir?: string;
  /** Additional directories to grant tool access to. */
  addDirs?: string[];
  /** Max retry attempts. */
  maxRetries?: number;
  /** Model to use (e.g. "claude-haiku-4-5-20251001"). */
  model?: string;
  /** CLI session ID for --session-id (persistent sessions). */
  sessionId?: string;
  /** Recent conversation history for context recovery after session reset. */
  recentHistory?: string;
}

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

/**
 * Execute Claude CLI with the given prompt and return the parsed result.
 */
/** Check if an error message indicates context window overflow. */
function isContextOverflow(errMsg: string): boolean {
  return /context.*(window|limit|length|overflow)|too (many|long)|token.*limit|conversation.*(too long|length)/i.test(errMsg);
}

/** Check if an error message indicates the session ID is locked by another process. */
function isSessionInUse(errMsg: string): boolean {
  return /session.*(already in use|locked|in use)/i.test(errMsg);
}

export async function ask(options: AskOptions): Promise<ClaudeResult> {
  const config = getConfig();
  const {
    prompt,
    systemPrompt,
    workDir,
    addDirs = [],
    maxRetries = config.agent.max_retries,
    model,
    sessionId,
    recentHistory,
  } = options;

  const timeoutMs = parseDuration(config.agent.timeout);
  let lastError: Error | null = null;
  let effectiveSessionId = sessionId;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await execClaude(prompt, systemPrompt, workDir, addDirs, timeoutMs, model, effectiveSessionId);
      // If session ID changed during retries, attach it to the result
      if (effectiveSessionId !== sessionId) {
        result.session_id = effectiveSessionId;
      }
      return result;
    } catch (err) {
      lastError = err as Error;
      const errMsg = lastError.message;

      // Context overflow: signal caller to reset session and retry with history
      if (isContextOverflow(errMsg)) {
        log("warn", "Context overflow detected, signalling session reset", { sessionId });
        const overflowErr = new Error(errMsg);
        (overflowErr as any).contextOverflow = true;
        throw overflowErr;
      }

      // Session locked by previous process: generate a fresh session ID and retry
      if (isSessionInUse(errMsg) && effectiveSessionId) {
        effectiveSessionId = randomUUID();
        log("warn", "Session in use, retrying with new session ID", {
          oldSessionId: sessionId,
          newSessionId: effectiveSessionId,
        });
        // Signal the caller about the new session ID
        (lastError as any).newSessionId = effectiveSessionId;
      }

      log("warn", `Claude CLI attempt ${attempt}/${maxRetries} failed`, {
        error: errMsg,
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
  sessionId?: string,
): Promise<ClaudeResult> {
  const config = getConfig();
  const cliPath = config.agent.claude_cli_path;

  // -p (--print) = non-interactive mode, prompt is a positional arg at the end
  const args = [
    "-p",
    "--output-format", "json",
  ];

  // Use persistent session if sessionId provided, otherwise stateless
  if (sessionId) {
    args.push("--session-id", sessionId);
  } else {
    args.push("--no-session-persistence");
  }

  if (model) {
    args.push("--model", model);
  }

  // Append to default system prompt (keeps Claude Code built-in + adds ours)
  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }

  // MCP server configuration
  if (config.mcp?.config_path) {
    args.push("--mcp-config", config.mcp.config_path);
  }

  for (const dir of addDirs) {
    args.push("--add-dir", dir);
  }

  // Prompt is piped via stdin (not as positional arg) to avoid Windows
  // command-line length limits and shell escaping issues with special chars.

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

    // Write prompt to stdin and close
    proc.stdin?.on("error", (err) => {
      log("warn", "stdin write error", { error: err.message });
    });
    proc.stdin?.write(prompt);
    proc.stdin?.end();
  });
}

/**
 * Streaming version of ask() — spawns Claude CLI with stream-json output
 * and yields chunks as they arrive.
 *
 * The returned async iterable yields StreamChunk objects. The caller should
 * accumulate assistant_text chunks and display them incrementally.
 * The final "result" chunk contains the complete response.
 */
export async function* askStreaming(options: AskOptions): AsyncGenerator<StreamChunk> {
  const config = getConfig();
  const {
    prompt,
    systemPrompt,
    workDir,
    addDirs = [],
    maxRetries = config.agent.max_retries,
    model,
    sessionId,
  } = options;

  const timeoutMs = parseDuration(config.agent.timeout);
  let effectiveSessionId = sessionId;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      yield* execClaudeStreaming(
        prompt, systemPrompt, workDir, addDirs, timeoutMs, model, effectiveSessionId,
      );
      return; // success — exit retry loop
    } catch (err) {
      lastError = err as Error;
      const errMsg = lastError.message;

      // Context overflow: propagate immediately
      if ((lastError as any).contextOverflow) {
        throw lastError;
      }

      // Session locked: generate a fresh session ID and retry
      if ((lastError as any).sessionInUse && effectiveSessionId) {
        effectiveSessionId = randomUUID();
        log("warn", "Streaming session in use, retrying with new session ID", {
          oldSessionId: sessionId,
          newSessionId: effectiveSessionId,
        });
        (lastError as any).newSessionId = effectiveSessionId;
      }

      log("warn", `Claude CLI streaming attempt ${attempt}/${maxRetries} failed`, {
        error: errMsg,
      });
      if (attempt < maxRetries) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError ?? new Error("Claude CLI streaming failed after retries");
}

function execClaudeStreaming(
  prompt: string,
  systemPrompt: string | undefined,
  workDir: string | undefined,
  addDirs: string[],
  timeoutMs: number,
  model?: string,
  sessionId?: string,
): AsyncGenerator<StreamChunk> {
  return execClaudeStreamingImpl(prompt, systemPrompt, workDir, addDirs, timeoutMs, model, sessionId);
}

async function* execClaudeStreamingImpl(
  prompt: string,
  systemPrompt: string | undefined,
  workDir: string | undefined,
  addDirs: string[],
  timeoutMs: number,
  model?: string,
  sessionId?: string,
): AsyncGenerator<StreamChunk> {
  const config = getConfig();
  const cliPath = config.agent.claude_cli_path;

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
  ];

  if (sessionId) {
    args.push("--session-id", sessionId);
  } else {
    args.push("--no-session-persistence");
  }

  if (model) {
    args.push("--model", model);
  }

  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }

  if (config.mcp?.config_path) {
    args.push("--mcp-config", config.mcp.config_path);
  }

  for (const dir of addDirs) {
    args.push("--add-dir", dir);
  }

  // Prompt is piped via stdin (not as positional arg) to avoid Windows
  // command-line length limits and shell escaping issues with special chars.

  const child = spawn(cliPath, args, {
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  // Manual timeout since spawn() does not support the timeout option
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, timeoutMs);

  // Write prompt to stdin and close
  child.stdin?.on("error", (err) => {
    log("warn", "streaming stdin write error", { error: err.message });
  });
  child.stdin?.write(prompt);
  child.stdin?.end();

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  // Capture process exit BEFORE reading stdout (event may fire during iteration)
  const exitPromise = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  // Accumulate text from assistant messages
  let accumulatedText = "";
  let finalResult = "";

  // Yield chunks from stdout line by line
  const lineIterator = createLineIterator(child.stdout);

  for await (const line of lineIterator) {
    if (!line.trim()) continue;

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // skip non-JSON lines
    }

    if (obj.type === "assistant" && obj.message?.content) {
      // Extract text parts from assistant message
      for (const part of obj.message.content) {
        if (part.type === "text" && part.text) {
          accumulatedText += part.text;
          yield { type: "assistant_text", text: accumulatedText };
        }
      }
    } else if (obj.type === "result") {
      finalResult = obj.result || accumulatedText;
      if (obj.is_error) {
        const errMsg = obj.result || "Unknown error";
        if (isContextOverflow(errMsg)) {
          const err = new Error(errMsg);
          (err as any).contextOverflow = true;
          throw err;
        }
        throw new Error(`Claude returned error: ${errMsg}`);
      }
      yield { type: "result", text: finalResult };
    } else if (obj.type === "error") {
      const errMsg = obj.error || obj.message || "Unknown error";
      if (isContextOverflow(errMsg)) {
        const err = new Error(errMsg);
        (err as any).contextOverflow = true;
        throw err;
      }
      if (isSessionInUse(errMsg)) {
        const err = new Error(errMsg);
        (err as any).sessionInUse = true;
        throw err;
      }
      throw new Error(`Claude CLI error: ${errMsg}`);
    }
  }

  // Wait for process to fully exit (promise was captured before stdout iteration)
  const exitCode = await exitPromise;

  if (exitCode !== 0 && !finalResult) {
    const errMsg = stderr || `Process exited with code ${exitCode}`;
    if (isContextOverflow(errMsg)) {
      const err = new Error(errMsg);
      (err as any).contextOverflow = true;
      throw err;
    }
    if (isSessionInUse(errMsg)) {
      const err = new Error(errMsg);
      (err as any).sessionInUse = true;
      throw err;
    }
    throw new Error(`Claude CLI error (exit ${exitCode}): ${errMsg}`);
  }

  // If no result chunk was emitted, yield the accumulated text
  if (!finalResult && accumulatedText) {
    yield { type: "result", text: accumulatedText };
  }
}

/**
 * Convert a Node.js Readable stream into an async iterable of lines.
 */
async function* createLineIterator(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      yield line;
    }
  }
  if (buffer.trim()) {
    yield buffer;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
