import type { Agent, AgentSessionOpts, SessionInfo } from "../types.js";
import { registerAgent } from "../registry.js";
import { CodexSession } from "./session.js";

export class CodexAgent implements Agent {
  readonly name = "codex";
  private cliPath: string;
  private mode: string;

  constructor(opts?: Record<string, unknown>) {
    this.cliPath = (opts?.cliPath as string) ?? "codex";
    this.mode = (opts?.mode as string) ?? "suggest";
  }

  async startSession(opts: AgentSessionOpts): Promise<CodexSession> {
    const sessionId = opts.sessionId ?? `codex-${Date.now()}`;
    return new CodexSession(sessionId, {
      cliPath: this.cliPath, workDir: opts.workDir,
      mode: opts.mode ?? this.mode, model: opts.model,
    });
  }

  async listSessions(): Promise<SessionInfo[]> { return []; }
  async stop(): Promise<void> {}
}

registerAgent("codex", (opts) => new CodexAgent(opts));
