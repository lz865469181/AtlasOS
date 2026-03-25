import type { Agent, AgentSessionOpts, SessionInfo } from "../types.js";
import { registerAgent } from "../registry.js";
import { OpenCodeSession } from "./session.js";

export class OpenCodeAgent implements Agent {
  readonly name = "opencode";
  private cliPath: string;

  constructor(opts?: Record<string, unknown>) {
    this.cliPath = (opts?.cliPath as string) ?? "opencode";
  }

  async startSession(opts: AgentSessionOpts): Promise<OpenCodeSession> {
    const sessionId = opts.sessionId ?? `opencode-${Date.now()}`;
    return new OpenCodeSession(sessionId, {
      cliPath: this.cliPath, workDir: opts.workDir, model: opts.model,
    });
  }

  async listSessions(): Promise<SessionInfo[]> { return []; }
  async stop(): Promise<void> {}
}

registerAgent("opencode", (opts) => new OpenCodeAgent(opts));
