import { spawn } from "node:child_process";
import type { Agent, AgentSessionOpts, SessionInfo, ModelSwitcher, ModeSwitcher, MemoryFileProvider, ContextCompressor } from "../types.js";
import { registerAgent } from "../registry.js";
import { ClaudeSession } from "./session.js";
import { log } from "../../core/logger.js";

export class ClaudeAgent implements Agent, ModelSwitcher, ModeSwitcher, MemoryFileProvider, ContextCompressor {
  readonly name = "claude";
  readonly contextWindowSize = 200_000;
  private cliPath: string;
  private model = "claude-sonnet-4-6";
  private mode = "default";
  private mcpConfigPath?: string;
  private activeSessions = new Map<string, ClaudeSession>();

  constructor(opts?: Record<string, unknown>) {
    this.cliPath = (opts?.cliPath as string) ?? "claude";
    if (opts?.model) this.model = opts.model as string;
    if (opts?.mode) this.mode = opts.mode as string;
    if (opts?.mcpConfigPath) this.mcpConfigPath = opts.mcpConfigPath as string;
  }

  async startSession(opts: AgentSessionOpts): Promise<ClaudeSession> {
    const args = [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--permission-prompt-tool", "stdio",
      "--verbose",
    ];

    if (opts.model ?? this.model) {
      args.push("--model", opts.model ?? this.model);
    }

    if (opts.sessionId) {
      args.push("--session-id", opts.sessionId);
    } else if (opts.continueSession) {
      args.push("--continue");
    }

    if (opts.systemPrompt) {
      args.push("--append-system-prompt", opts.systemPrompt);
    }

    if (this.mcpConfigPath) {
      args.push("--mcp-config", this.mcpConfigPath);
    }

    const env = { ...process.env, ...opts.env };

    const child = spawn(this.cliPath, args, {
      cwd: opts.workDir,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      windowsHide: true,
    });

    const sessionId = opts.sessionId ?? `claude-${Date.now()}`;
    const session = new ClaudeSession(sessionId, child);
    this.activeSessions.set(sessionId, session);

    child.on("close", () => {
      this.activeSessions.delete(sessionId);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      log("debug", "claude stderr", { data: chunk.toString().slice(0, 200) });
    });

    log("info", "Claude session started", { sessionId, model: opts.model ?? this.model });
    return session;
  }

  async listSessions(_workDir: string): Promise<SessionInfo[]> {
    return [...this.activeSessions.entries()].map(([id, _]) => ({ id }));
  }

  async stop(): Promise<void> {
    for (const session of this.activeSessions.values()) {
      await session.close();
    }
    this.activeSessions.clear();
  }

  // ModelSwitcher
  setModel(model: string): void { this.model = model; }
  async availableModels(): Promise<Record<string, string>> {
    return {
      "claude-haiku-4-5-20251001": "Haiku (fast)",
      "claude-sonnet-4-6": "Sonnet (balanced)",
      "claude-opus-4-6": "Opus (most capable)",
    };
  }
  currentModel(): string { return this.model; }

  // ModeSwitcher
  setMode(mode: string): void { this.mode = mode; }
  availableModes(): string[] { return ["default", "plan", "bypassPermissions"]; }
  currentMode(): string { return this.mode; }

  // MemoryFileProvider
  projectMemoryFile(): string { return "CLAUDE.md"; }
  globalMemoryFile(): string { return "~/.claude/CLAUDE.md"; }

  // ContextCompressor
  compactCommand(): string { return "/compact"; }
}

// Register in the factory
registerAgent("claude", (opts) => new ClaudeAgent(opts));
