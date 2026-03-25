import type { Agent, AgentSessionOpts, SessionInfo } from "../types.js";
import { registerAgent } from "../registry.js";
import { CursorSession } from "./session.js";

export class CursorAgent implements Agent {
  readonly name = "cursor";
  private cliPath: string;
  private mode: string;

  constructor(opts?: Record<string, unknown>) {
    this.cliPath = (opts?.cliPath as string) ?? "agent";
    this.mode = (opts?.mode as string) ?? "default";
  }

  async startSession(opts: AgentSessionOpts): Promise<CursorSession> {
    const sessionId = opts.sessionId ?? `cursor-${Date.now()}`;
    return new CursorSession(sessionId, {
      cliPath: this.cliPath, workDir: opts.workDir,
      mode: opts.mode ?? this.mode, model: opts.model,
    });
  }

  async listSessions(): Promise<SessionInfo[]> { return []; }
  async stop(): Promise<void> {}
}

registerAgent("cursor", (opts) => new CursorAgent(opts));
