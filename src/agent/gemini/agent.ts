import type { Agent, AgentSessionOpts, SessionInfo } from "../types.js";
import { registerAgent } from "../registry.js";
import { GeminiSession } from "./session.js";

export class GeminiAgent implements Agent {
  readonly name = "gemini";
  private cliPath: string;
  private mode: string;

  constructor(opts?: Record<string, unknown>) {
    this.cliPath = (opts?.cliPath as string) ?? "gemini";
    this.mode = (opts?.mode as string) ?? "default";
  }

  async startSession(opts: AgentSessionOpts): Promise<GeminiSession> {
    const sessionId = opts.sessionId ?? `gemini-${Date.now()}`;
    return new GeminiSession(sessionId, {
      cliPath: this.cliPath, workDir: opts.workDir,
      mode: opts.mode ?? this.mode, model: opts.model,
    });
  }

  async listSessions(): Promise<SessionInfo[]> { return []; }
  async stop(): Promise<void> {}
}

registerAgent("gemini", (opts) => new GeminiAgent(opts));
